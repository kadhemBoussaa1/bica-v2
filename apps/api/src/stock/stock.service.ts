import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
  CreateRollInput,
  CreateShipmentInput,
  CutRollInput,
  ReceiveRollInput,
  RollLabelsInput,
  SetShipmentRollsInput,
  SlitRollInput,
  UpdateRollInput,
  UpdateShipmentInput,
} from "@repo/api-contract";
import { canAccess, parseRollScan } from "@repo/api-contract";
import type { SessionUser } from "../trpc/trpc";
import type { Prisma } from "../generated/prisma/client.js";
import { runListQuery } from "../list/list-query";
import { COUNTABLE_ROLL_WHERE } from "../inventory/inventory.list";
import { PrismaService } from "../prisma.service";
import {
  ROLL_COUNTER_SELECT,
  freeGuard,
  freeMetres,
  kgPerMetre,
  metresFmt,
  moveRollCounters,
  takeSet,
  writeRollFlags,
} from "./roll-math";
import {
  PENDING_ROLL_WHERE,
  RECEIVING_SHIPMENT_SELECT,
  ROLL_DETAIL_SELECT,
  ROLL_DETAIL_SELECT_PRICED,
  ROLL_LABEL_SELECT,
  ROLL_SELECT,
  ROLL_SELECT_PRICED,
  SHIPMENT_ROLL_SELECT,
  SHIPMENT_SELECT,
  SHIPMENT_SELECT_PRICED,
  rollListDeclaration,
  shipmentRollListDeclaration,
  shipmentListDeclaration,
  type ExportRollsInput,
  type ListRollsInput,
  type ListShipmentsInput,
  type RollsForShipmentInput,
} from "./stock.list";

const SHIPMENT_RETURN_SELECT = { id: true, numeroImport: true, active: true } as const;
const ROLL_RETURN_SELECT = { id: true, numero: true, archived: true } as const;

/** What a cut or slit reads off the mother reel before it moves anything. */
const MOTHER_SELECT = {
  ...ROLL_COUNTER_SELECT,
  numeroSource: true,
  paperGrade: true,
  description: true,
  paperType: true,
  price: true,
  priceWithTransport: true,
  importShipmentId: true,
  consumedByNote: true,
  // A split inherits the mother's receipt: the paper is the same paper, and
  // it is already on the floor. Without this the children would be born
  // pending and refuse the very operations that just created them.
  receivedAt: true,
  receivedById: true,
  _count: { select: { children: true } },
} satisfies Prisma.PaperRollSelect;

/**
 * Hard ceiling on an export, ~12x today's 1688 reels. Bounds a runaway
 * request without truncating any real stock take; `exportRolls` reports
 * `truncated` if it is ever reached, so a caller is told rather than handed
 * a quietly short file.
 */
const EXPORT_ROW_CAP = 20000;

/**
 * How long a finished delivery stays on the receiving screen.
 *
 * Seven days, not thirty. `receivedAt` was backfilled from `createdAt` at
 * migration, so 1526 legacy reels share a single timestamp that records the
 * import rather than a physical scan (docs/receiving-plan.md, "Backfill"); a
 * month-long window would surface that whole fleet as freshly received and
 * bury the deliveries that actually need someone to walk to them.
 */
const RECENTLY_RECEIVED_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Peels the advanced filter off a list/export input and turns it into the
 * AND-ed scope, leaving the paging/sort/facet query behind.
 *
 * Modelled on `AuditService.list`: the client sends keys and scalars, the
 * service builds the `where`. Nothing here trusts a client-supplied
 * fragment, and every dimension is AND-ed, so combining them narrows rather
 * than widens.
 *
 * `"unknown"` maps to an explicit `null` test on each dimension — the reason
 * it is offered at all is that 160 reels have no grammage, 6 no paper type
 * and 159 no shipment, and a filter that dropped them would quietly hide a
 * tenth of the stock.
 *
 * Supplier reaches across `importShipment`, the one predicate here with no
 * supporting index on the reel side (`@@index([importShipmentId])` covers the
 * join, not the supplier). Fine at 1690 rows; worth an index if stock grows
 * an order of magnitude.
 */
function splitRollFilter<T extends Record<string, unknown>>(
  input: T & {
    grammage?: number | "unknown";
    laizeMin?: number;
    laizeMax?: number;
    laizeUnknown?: boolean;
    paperType?: string;
    supplierId?: string;
  },
) {
  const { grammage, laizeMin, laizeMax, laizeUnknown, paperType, supplierId, ...query } = input;

  const and: Prisma.PaperRollWhereInput[] = [];

  if (grammage !== undefined) {
    and.push(grammage === "unknown" ? { grammage: null } : { grammage });
  }

  // The range and the null test are exclusive by construction: a reel with no
  // width cannot also sit inside a band.
  if (laizeUnknown) {
    and.push({ laize: null });
  } else if (laizeMin !== undefined || laizeMax !== undefined) {
    and.push({
      laize: {
        ...(laizeMin !== undefined ? { gte: laizeMin } : {}),
        ...(laizeMax !== undefined ? { lte: laizeMax } : {}),
      },
    });
  }

  if (paperType !== undefined) {
    and.push(
      paperType === "unknown"
        ? { paperType: null }
        : { paperType: paperType as Prisma.PaperRollWhereInput["paperType"] },
    );
  }

  if (supplierId !== undefined) {
    and.push(
      supplierId === "unknown"
        ? // No shipment at all, or one whose supplier has gone: both read as
          // "no supplier" to someone looking at the list.
          { importShipmentId: null }
        : { importShipment: { supplierId } },
    );
  }

  return {
    scope: (and.length > 0 ? { AND: and } : {}) as Prisma.PaperRollWhereInput,
    query,
  };
}

/** 2dp, or null through. Keeps computed metres out of float-noise territory. */
function round2(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

/**
 * The two money columns off a row that was selected with `ROLL_SELECT_PRICED`.
 *
 * The cast is confined here, and is sound only under its one precondition:
 * the caller must have chosen the priced select. `runListQuery` infers its
 * row type from the select it is handed, so a ternary select collapses the
 * static type to the unpriced shape even though the runtime row carries the
 * columns. Widening through `unknown` at this single point is preferable to
 * selecting money unconditionally and filtering it out of the output, which
 * would move the gate from "never fetched" to "not printed".
 */
function moneyFields(row: unknown): (number | null)[] {
  const money = row as { price: number | null; priceWithTransport: number | null };
  // Rounded like the metres: a migrated unit price carries values such as
  // 1.3541666666666667, which is noise in a spreadsheet column rather than a
  // meaningful fourth decimal of a dinar.
  return [round2(money.price), round2(money.priceWithTransport)];
}

/**
 * One CSV record, CRLF-terminated by the caller.
 *
 * Quotes every field rather than only the ones that need it: it is valid CSV
 * either way, and unconditional quoting means a value that later grows a
 * comma cannot silently shift the columns. Embedded quotes are doubled, per
 * RFC 4180.
 *
 * Numbers are emitted with a plain `.` decimal point — machine-readable, not
 * the French grouping the UI uses; a grouped "1 126,5" would be a broken
 * number in a spreadsheet set to another locale.
 */
function csvRow(fields: readonly (string | number | null | undefined)[]): string {
  return fields
    .map((field) => {
      if (field === null || field === undefined) return '""';
      const text = typeof field === "number" ? String(field) : field;
      return `"${text.replace(/"/g, '""')}"`;
    })
    .join(",");
}

/**
 * Paper stock: reels and the shipments they arrived in.
 *
 * Shipments and reels are both editable, with one asymmetry that matters: a
 * reel's WEIGHTS can only change while nothing depends on the reel. See
 * `assertRollWeightsEditable` for what "depends" means and why.
 */
@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Who may read what a reel cost.
   *
   * The stock list and detail are `orderModuleProcedure`, so PRODUCTION and
   * MAGASINIER reach them — they pick and cut paper, which is the point — but
   * supplier pricing is not theirs to read. Same line, and same helper name,
   * as `OrderService.canReadPricing`.
   */
  private canReadPricing(actor: SessionUser): boolean {
    return canAccess(actor.role, "ADMIN");
  }

  async listRolls(actor: SessionUser, input: ListRollsInput) {
    const select = this.canReadPricing(actor) ? ROLL_SELECT_PRICED : ROLL_SELECT;
    const { scope, query } = splitRollFilter(input);
    return runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) => this.prisma.paperRoll.findMany({ ...args, select }),
        count: (args) => this.prisma.paperRoll.count(args),
      },
      query,
      declaration: rollListDeclaration,
      scope,
      // The header's weight figure. Summed over the same `where` as `total`,
      // inside the list's own transaction, so the tonnage and the row count
      // can never describe different snapshots. `poidsRestant` is NOT NULL
      // with a default, so this is a real sum rather than a partial one.
      aggregate: (where) => [
        this.prisma.paperRoll.aggregate({
          where: where as Prisma.PaperRollWhereInput,
          _sum: { poidsRestant: true },
        }),
      ],
    });
  }

  /**
   * The suppliers that actually own paper shipments — the advanced filter's
   * dropdown.
   *
   * Its own procedure on `orderModuleProcedure` rather than reusing
   * `supplier.list`, which is ADMIN-only: the stock list is the warehouse's
   * and the shop floor's, so a supplier filter fed from an admin read would
   * 403 for exactly the people who need it. Returns a name and an id and
   * nothing else — no contact, no commercial data.
   *
   * Derived from the shipments rather than the supplier table, so the list is
   * only ever suppliers a reel can actually have come from (31 shipments
   * across a handful of suppliers, not all 136 on file).
   */
  async supplierOptions() {
    // One transaction, like `runListQuery`: independent reads on one snapshot.
    const [suppliers, grammages] = await this.prisma.$transaction([
      this.prisma.supplier.findMany({
        // `shipments` is the relation's name on Supplier — inbound paper
        // deliveries, not the outbound export shipments of the same word.
        where: { shipments: { some: {} } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      // Distinct grammages as they actually occur, rather than a hard-coded
      // list that would drift from the data the moment a new grade arrives.
      // Eleven values today; NULL is offered as "unknown" by the filter, so
      // it is excluded here rather than appearing as a blank option.
      this.prisma.paperRoll.groupBy({
        by: ["grammage"],
        where: { grammage: { not: null } },
        orderBy: { grammage: "asc" },
      }),
    ]);

    return {
      suppliers,
      grammages: grammages.flatMap((row) => (row.grammage === null ? [] : [row.grammage])),
    };
  }

  async rollById(actor: SessionUser, id: string) {
    const roll = await this.prisma.paperRoll.findUnique({
      where: { id },
      select: this.canReadPricing(actor) ? ROLL_DETAIL_SELECT_PRICED : ROLL_DETAIL_SELECT,
    });
    if (!roll) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Roll not found" });
    }
    return roll;
  }

  /**
   * The stock list as a CSV — every reel the current facet and search match,
   * not one page (docs/toolkit-v3.md "Stock").
   *
   * Built from `rollListDeclaration` through the same `runListQuery`, with
   * the page size raised to the row cap, so the export cannot reach a column
   * or a row the list itself would refuse: the declaration is the security
   * boundary, and duplicating its `where` here would be a second place for
   * it to drift.
   *
   * Price columns are present only for ADMIN+, so a warehouse export carries
   * no supplier pricing.
   *
   * Returned as a string for the browser to save. tRPC is the whole HTTP
   * surface here — no Express controller, no second auth path — and a stock
   * take is tens of thousands of characters, not a streamed file.
   */
  async exportRolls(actor: SessionUser, input: ExportRollsInput) {
    const priced = this.canReadPricing(actor);
    const { scope, query } = splitRollFilter(input);
    const { rows } = await runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) =>
          this.prisma.paperRoll.findMany({
            ...args,
            select: priced ? ROLL_SELECT_PRICED : ROLL_SELECT,
          }),
        count: (args) => this.prisma.paperRoll.count(args),
      },
      query: { ...query, page: 1, pageSize: EXPORT_ROW_CAP },
      declaration: rollListDeclaration,
      scope,
    });

    const headers = [
      "Reel",
      "Source number",
      "Grade",
      "Description",
      "Paper",
      "Grammage (g/m2)",
      "Width (mm)",
      "Weight (kg)",
      "Remaining (kg)",
      "Reserved (kg)",
      "Length (m)",
      "Length remaining (m)",
      "State",
      "Shipment",
      "Imported",
      ...(priced ? ["Price", "Price with transport"] : []),
    ];

    const lines = rows.map((row) => {
      // Same precedence as the facet declaration, so a row's State column
      // matches the chip it is counted under: consumed, archived, then
      // pending (no receipt) before reserved and available, which both
      // require one.
      const state = row.consomme
        ? "consumed"
        : row.archived
          ? "archived"
          : row.receivedAt === null
            ? "pending"
            : row.reserved === true
              ? "reserved"
              : "available";
      return csvRow([
        row.numero,
        row.numeroSource,
        row.paperGrade,
        row.description,
        // Raw enum token: there is no translation layer on the server, so a
        // localised label here would be English-only and lie to the reader.
        row.paperType,
        row.grammage,
        row.laize,
        // Rounded to 2dp: metres are computed from kg ÷ (grammage × width),
        // so a raw float prints as 178730.15873015873 and fills a spreadsheet
        // column with noise. Weights are stored figures and pass through.
        row.poids,
        row.poidsRestant,
        row.poidsReserve,
        round2(row.metrage),
        round2(row.metrageRestant),
        state,
        row.importShipment?.numeroImport ?? null,
        row.importShipment?.dateImport
          ? row.importShipment.dateImport.toISOString().slice(0, 10)
          : null,
        // `priced` chose the select above, so it is the guard — not a
        // per-property `in` probe, which narrows only the key it names.
        // `TRow` is inferred from that ternary and so collapses to the
        // unpriced shape, hence the widening cast: it is sound exactly
        // because `priced` is the same flag that selected the columns.
        ...(priced ? moneyFields(row) : []),
      ]);
    });

    const stamp = new Date().toISOString().slice(0, 10);
    return {
      filename: `stock-${query.filter}-${stamp}.csv`,
      rowCount: rows.length,
      truncated: rows.length === EXPORT_ROW_CAP,
      csv: [csvRow(headers), ...lines].join("\r\n"),
    };
  }

  async listShipments(actor: SessionUser, query: ListShipmentsInput) {
    const select = this.canReadPricing(actor) ? SHIPMENT_SELECT_PRICED : SHIPMENT_SELECT;
    const result = await runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) => this.prisma.importShipment.findMany({ ...args, select }),
        count: (args) => this.prisma.importShipment.count(args),
      },
      query,
      declaration: shipmentListDeclaration,
      scope: {},
    });
    return {
      ...result,
      rows: result.rows.map(({ _count, ...row }) => ({ ...row, rollCount: _count.rolls })),
    };
  }

  async createShipment(input: CreateShipmentInput) {
    await this.assertNumeroFree(input.numeroImport);
    const supplierId = await this.resolveSupplier(input.supplierId);
    return this.prisma.importShipment.create({
      data: this.writableShipment(input, supplierId),
      select: SHIPMENT_RETURN_SELECT,
    });
  }

  async updateShipment(input: UpdateShipmentInput) {
    await this.assertShipmentExists(input.id);
    await this.assertNumeroFree(input.numeroImport, input.id);
    const supplierId = await this.resolveSupplier(input.supplierId);
    return this.prisma.importShipment.update({
      where: { id: input.id },
      data: this.writableShipment(input, supplierId),
      select: SHIPMENT_RETURN_SELECT,
    });
  }

  /**
   * Archive or restore — what the UI calls "delete". Archiving keeps the reels
   * attached and their provenance intact; it only removes the shipment from
   * the default list.
   */
  async setShipmentActive(id: string, active: boolean) {
    await this.assertShipmentExists(id);
    return this.prisma.importShipment.update({
      where: { id },
      data: { active },
      select: SHIPMENT_RETURN_SELECT,
    });
  }

  /**
   * Hard delete, permitted only while no reel references the shipment.
   *
   * `PaperRoll.importShipmentId` is `SetNull`, so deleting one with reels
   * attached would quietly strip their purchase provenance — which delivery,
   * supplier and price they came from — and report success. 31 of the 32
   * migrated shipments have reels, one of them 136. Once a shipment is in
   * use, archiving is the only way to retire it. Same rule as
   * `SupplierFamilyService.remove`.
   */
  async removeShipment(id: string) {
    const shipment = await this.prisma.importShipment.findUnique({
      where: { id },
      select: {
        id: true,
        numeroImport: true,
        _count: { select: { rolls: true } },
      },
    });
    if (!shipment) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Shipment not found" });
    }
    if (shipment._count.rolls > 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          `${shipment.numeroImport} has ${shipment._count.rolls} reel(s) attached. ` +
          "Archive it instead, or detach those reels first — deleting it would " +
          "strip their purchase history.",
      });
    }
    await this.prisma.importShipment.delete({ where: { id } });
    return { id };
  }

  /**
   * Replaces the set of reels claiming this shipment as their provenance.
   *
   * Wholesale rather than diffed, like `OrderService.setColours`: the caller
   * sends the complete set and anything omitted is detached. Done in a
   * transaction so a failure cannot leave reels half-reassigned.
   *
   * Only reels that are unattached or already on this shipment may be added —
   * silently stealing a reel from another delivery would falsify that
   * delivery's provenance too.
   */
  async setShipmentRolls(input: SetShipmentRollsInput) {
    await this.assertShipmentExists(input.id);

    if (input.rollIds.length > 0) {
      const rolls = await this.prisma.paperRoll.findMany({
        where: { id: { in: input.rollIds } },
        select: { id: true, numero: true, importShipmentId: true },
      });
      if (rolls.length !== input.rollIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "One of those reels no longer exists",
        });
      }
      const stolen = rolls.filter(
        (roll) => roll.importShipmentId !== null && roll.importShipmentId !== input.id,
      );
      if (stolen.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            `Reel ${stolen[0]?.numero ?? stolen[0]?.id} already belongs to another ` +
            "shipment. Detach it there first.",
        });
      }
    }

    await this.prisma.$transaction([
      // Detach whatever is currently attached but not in the new set.
      this.prisma.paperRoll.updateMany({
        where: { importShipmentId: input.id, id: { notIn: input.rollIds } },
        data: { importShipmentId: null },
      }),
      this.prisma.paperRoll.updateMany({
        where: { id: { in: input.rollIds } },
        data: { importShipmentId: input.id },
      }),
    ]);
    return { id: input.id, count: input.rollIds.length };
  }

  /**
   * Reels on one shipment, searchable by reel number and paginated.
   *
   * The shipment is the SCOPE, taken from the input and AND-ed in by
   * `runListQuery` before anything else — a caller cannot widen it to reels on
   * another delivery, which is the same rule every other list follows.
   *
   * Separate from the reels embedded in `shipmentById`: that nested select
   * returns the whole set for the detail panel, which is fine at 47.8 reels on
   * average but is not searchable or paged. This is the query the page's
   * search box drives.
   */
  async rollsForShipment(input: RollsForShipmentInput) {
    await this.assertShipmentExists(input.shipmentId);
    return runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) =>
          this.prisma.paperRoll.findMany({ ...args, select: SHIPMENT_ROLL_SELECT }),
        count: (args) => this.prisma.paperRoll.count(args),
      },
      query: input,
      declaration: shipmentRollListDeclaration,
      scope: { importShipmentId: input.shipmentId },
    });
  }

  async shipmentById(actor: SessionUser, id: string) {
    // No nested `rolls`: the detail page lists them through
    // `rollsForShipment`, which searches and pages. Embedding the whole set
    // here would fetch 136 reels on every page view to render a fixed number
    // of them. `_count.rolls` still gives the headline figure.
    const select = this.canReadPricing(actor) ? SHIPMENT_SELECT_PRICED : SHIPMENT_SELECT;
    // One transaction so the two counts and the header cannot straddle a scan.
    const [shipment, pendingCount, receivableCount] = await this.prisma.$transaction([
      this.prisma.importShipment.findUnique({ where: { id }, select }),
      this.prisma.paperRoll.count({
        where: { importShipmentId: id, ...PENDING_ROLL_WHERE },
      }),
      // The receiving denominator. NOT `rollCount`: that counts consumed and
      // archived reels too, which are never pending, so "received / rollCount"
      // could not reach its total — one delivery here has 78 reels and 0 live.
      // Same predicate the stocktake counts against, hence the shared export.
      this.prisma.paperRoll.count({
        where: { importShipmentId: id, ...COUNTABLE_ROLL_WHERE },
      }),
    ]);
    if (!shipment) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Shipment not found" });
    }
    const { _count, ...rest } = shipment;
    return { ...rest, rollCount: _count.rolls, pendingCount, receivableCount };
  }

  // ---- receiving ----------------------------------------------------------

  /**
   * Scans a reel in on the warehouse floor — docs/receiving-plan.md §4.
   *
   * `shipmentId` is the delivery open on the scan screen, not the reel's own:
   * a reel belonging to another delivery is REFUSED by name rather than
   * re-parented, because a label turning up under the wrong shipment means
   * someone is looking at the wrong pallet, and silently moving it would hide
   * that.
   *
   * Idempotent by design. `receivedAt` is monotonic, so the guarded
   * `updateMany(where: { receivedAt: null })` either stamps the reel or tells
   * us somebody else just did — a second scan of the same label is an
   * `alreadyReceived` outcome, not an error. The warehouse scans fast and
   * double-triggers happen; refusing them would train people to ignore the
   * buzzer.
   *
   * Returns the reel so the audit heuristic reads `id`/`numero` off the
   * result and the shipment off the input; see the note on `receiveRollInput`.
   */
  async receiveRoll(actor: SessionUser, input: ReceiveRollInput) {
    const scan = parseRollScan(input.code);
    if (!scan) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Not a reel label",
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const shipment = await tx.importShipment.findUnique({
        where: { id: input.shipmentId },
        select: { id: true, numeroImport: true, active: true },
      });
      if (!shipment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Shipment not found" });
      }
      if (!shipment.active) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${shipment.numeroImport} is archived — restore it before receiving reels`,
        });
      }

      const where =
        scan.kind === "id" ? { id: scan.id } : { legacyId: BigInt(scan.legacyId) };
      const roll = await tx.paperRoll.findUnique({
        where,
        select: {
          id: true,
          numero: true,
          paperGrade: true,
          grammage: true,
          laize: true,
          consomme: true,
          archived: true,
          receivedAt: true,
          receivedById: true,
          importShipmentId: true,
          importShipment: { select: { numeroImport: true } },
        },
      });
      if (!roll) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No reel matches this label",
        });
      }

      if (roll.importShipmentId !== shipment.id) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: roll.importShipment
            ? `${this.label(roll)} belongs to shipment ${roll.importShipment.numeroImport}, not ${shipment.numeroImport}`
            : `${this.label(roll)} belongs to no shipment`,
        });
      }
      if (roll.consomme) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${this.label(roll)} is used up`,
        });
      }
      if (roll.archived) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${this.label(roll)} is archived — restore it first`,
        });
      }

      const stamped =
        roll.receivedAt === null
          ? await tx.paperRoll.updateMany({
              where: { id: roll.id, receivedAt: null },
              data: { receivedAt: new Date(), receivedById: actor.id },
            })
          : { count: 0 };

      // Re-read either way: on a fresh stamp for the timestamp the database
      // actually wrote, and on a lost race for whoever won it.
      const now = await tx.paperRoll.findUniqueOrThrow({
        where: { id: roll.id },
        select: {
          receivedAt: true,
          receivedBy: { select: { id: true, name: true } },
        },
      });

      const [pending, receivable] = await Promise.all([
        tx.paperRoll.count({
          where: { importShipmentId: shipment.id, ...PENDING_ROLL_WHERE },
        }),
        tx.paperRoll.count({
          where: { importShipmentId: shipment.id, ...COUNTABLE_ROLL_WHERE },
        }),
      ]);

      return {
        outcome: stamped.count === 1 ? ("received" as const) : ("alreadyReceived" as const),
        id: roll.id,
        numero: roll.numero,
        paperGrade: roll.paperGrade,
        grammage: roll.grammage,
        laize: roll.laize,
        receivedAt: now.receivedAt,
        receivedBy: now.receivedBy,
        shipment: { id: shipment.id, numeroImport: shipment.numeroImport },
        progress: { received: receivable - pending, total: receivable },
      };
    });
  }

  /**
   * Resolves a scanned label to a reel id, for the legacy redirect route.
   *
   * The 732 printed legacy labels encode `/scan/rouleau/<legacyId>`, which no
   * v2 route can serve without this lookup. Read-only and deliberately thin:
   * it says which reel, and the page decides where to send the browser.
   */
  async resolveScan(code: string) {
    const scan = parseRollScan(code);
    if (!scan) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Not a reel label" });
    }
    const roll = await this.prisma.paperRoll.findUnique({
      where: scan.kind === "id" ? { id: scan.id } : { legacyId: BigInt(scan.legacyId) },
      select: { id: true },
    });
    if (!roll) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No reel matches this label" });
    }
    return roll;
  }

  /**
   * Deliveries to scan, plus the ones just finished — the warehouse's screen.
   *
   * Two populations in one list. Anything with a pending reel is the to-do
   * part and is always included. A delivery whose last reel went in RECENTLY
   * is kept as well, so finishing a pallet does not make it vanish while the
   * operator is still standing next to it — `done: true` marks those and the
   * caller renders them as scanned rather than actionable.
   *
   * The window is deliberately short. `receivedAt` was backfilled from
   * `createdAt` at migration (docs/receiving-plan.md, "Backfill"), so 1526
   * reels share one timestamp and are NOT real receiving events; a month-long
   * window would replay the entire legacy fleet as if it had just been
   * scanned and bury the one delivery that needs action.
   *
   * Grouped first and then fetched, the same shape as `grammageOptions`: one
   * pass for the counts, one for the shipments they name. Archived deliveries
   * are left out; their reels are not what anyone is walking to.
   */
  async receivingInbox() {
    const since = new Date(Date.now() - RECENTLY_RECEIVED_MS);

    // Each pair in one transaction, so the counts in it share a snapshot.
    const [groups, recent] = await this.prisma.$transaction([
      this.prisma.paperRoll.groupBy({
        by: ["importShipmentId"],
        where: {
          ...PENDING_ROLL_WHERE,
          importShipmentId: { not: null },
          importShipment: { active: true },
        },
        _count: { _all: true },
      }),
      // Finished recently: a live reel scanned inside the window. A shipment
      // that still has pending reels can appear here too; the id set is
      // merged, and `pending` decides how it renders.
      this.prisma.paperRoll.groupBy({
        by: ["importShipmentId"],
        where: {
          consomme: false,
          archived: false,
          receivedAt: { gte: since },
          importShipmentId: { not: null },
          importShipment: { active: true },
        },
        _count: { _all: true },
      }),
    ]);
    if (groups.length === 0 && recent.length === 0) return [];

    const ids = [
      ...new Set(
        [...groups, ...recent].flatMap((g) =>
          g.importShipmentId ? [g.importShipmentId] : [],
        ),
      ),
    ];
    const [shipments, receivable] = await this.prisma.$transaction([
      this.prisma.importShipment.findMany({
        where: { id: { in: ids } },
        select: RECEIVING_SHIPMENT_SELECT,
        orderBy: [{ dateImport: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      }),
      this.prisma.paperRoll.groupBy({
        by: ["importShipmentId"],
        where: { importShipmentId: { in: ids }, consomme: false, archived: false },
        _count: { _all: true },
      }),
    ]);

    const pendingBy = new Map(groups.map((g) => [g.importShipmentId, g._count._all]));
    const totalBy = new Map(receivable.map((g) => [g.importShipmentId, g._count._all]));
    return shipments.map(({ _count, ...row }) => {
      const pending = pendingBy.get(row.id) ?? 0;
      // Same denominator as `shipmentById`: live reels, not every reel ever
      // recorded against the delivery.
      const total = totalBy.get(row.id) ?? 0;
      return {
        ...row,
        rollCount: _count.rolls,
        total,
        pending,
        received: total - pending,
        // Nothing left to scan. A delivery with no live reels at all is not
        // "done" in any useful sense — it has nothing to have scanned — so
        // `total > 0` guards against an empty shipment reading as finished.
        done: pending === 0 && total > 0,
      };
    });
  }

  /** The sidebar badge: how many deliveries still have reels to scan. */
  async receivingCount(): Promise<number> {
    return this.prisma.importShipment.count({
      where: { active: true, rolls: { some: PENDING_ROLL_WHERE } },
    });
  }

  /**
   * The reels to print labels for: a whole delivery, or a hand-picked set.
   *
   * Capped at the input's 500, which is also a sane ceiling on one print run
   * — `rollLabelsInput` refuses a larger set before this is reached.
   */
  async rollLabels(input: RollLabelsInput) {
    const where: Prisma.PaperRollWhereInput = input.shipmentId
      ? { importShipmentId: input.shipmentId }
      : { id: { in: input.rollIds ?? [] } };
    return this.prisma.paperRoll.findMany({
      where,
      select: ROLL_LABEL_SELECT,
      orderBy: [{ numero: "asc" }, { id: "asc" }],
      take: 500,
    });
  }

  // ---- reels ------------------------------------------------------------

  /**
   * Creates a reel on a delivery.
   *
   * `poidsRestant`/`metrageRestant` are set from `poids`/`metrage` rather
   * than accepted: a reel that has just arrived is by definition untouched,
   * and letting "arrived" and "remaining" be set independently is how stock
   * starts contradicting itself. Correct them later via `updateRoll`, which
   * does accept them — while the reel is still untouched.
   */
  async createRoll(input: CreateRollInput) {
    await this.assertShipmentExists(input.importShipmentId);
    return this.prisma.paperRoll.create({
      data: {
        ...this.writableRoll(input),
        poids: input.poids ?? null,
        metrage: input.metrage ?? null,
        importShipmentId: input.importShipmentId,
        poidsRestant: input.poids ?? 0,
        metrageRestant: input.metrage ?? 0,
      },
      select: ROLL_RETURN_SELECT,
    });
  }

  async updateRoll(input: UpdateRollInput) {
    const roll = await this.loadRollDependencies(input.id);
    await this.assertShipmentExists(input.importShipmentId);

    const wantsWeightChange =
      (input.poids !== undefined && input.poids !== roll.poids) ||
      (input.metrage !== undefined && input.metrage !== roll.metrage) ||
      (input.poidsRestant !== undefined && input.poidsRestant !== roll.poidsRestant) ||
      (input.metrageRestant !== undefined && input.metrageRestant !== roll.metrageRestant);

    if (wantsWeightChange) this.assertRollWeightsEditable(roll);

    return this.prisma.paperRoll.update({
      where: { id: input.id },
      data: {
        ...this.writableRoll(input),
        importShipmentId: input.importShipmentId,
        // Weights are written only when the guard above allowed it, so an
        // edit to a label on an in-use reel cannot smuggle one through. A
        // blank weight arrives as `undefined` (the contract has no null for
        // them) and means "leave alone": writing it as null would clear the
        // weight of an in-use reel without ever passing the guard.
        ...(wantsWeightChange
          ? {
              ...(input.poids !== undefined ? { poids: input.poids } : {}),
              ...(input.metrage !== undefined ? { metrage: input.metrage } : {}),
              poidsRestant: input.poidsRestant ?? input.poids ?? roll.poidsRestant,
              metrageRestant: input.metrageRestant ?? input.metrage ?? roll.metrageRestant,
            }
          : {}),
      },
      select: ROLL_RETURN_SELECT,
    });
  }

  // ---- cutting and slitting ---------------------------------------------

  /**
   * Cuts `metres` off a reel into a new child reel — docs/roll-allocation-plan.md §5.1.
   *
   * The child is a full reel in its own right (same grade, width, grammage,
   * provenance; its own number `<mother>/n`), and the mother keeps the
   * remainder. The mother's decrement is the conditional move from
   * `roll-math.ts`, guarded on its FREE length: paper already promised to an
   * order cannot be cut away from under that order. A mother cut down to
   * nothing is marked consumed, the way the legacy split notes did it.
   *
   * `db` lets `AllocationService.cutAndReserve` run the cut inside its own
   * transaction so the child cannot exist without its reservation.
   */
  async cut(input: CutRollInput, db?: Prisma.TransactionClient) {
    if (db) return this.cutIn(db, input);
    return this.prisma.$transaction((tx) => this.cutIn(tx, input));
  }

  private async cutIn(tx: Prisma.TransactionClient, input: CutRollInput) {
    const mother = await tx.paperRoll.findUnique({
      where: { id: input.rollId },
      select: MOTHER_SELECT,
    });
    if (!mother) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Roll not found" });
    }
    this.assertLive(mother);
    this.assertReceived(mother);
    const free = freeMetres(mother);
    if (free < input.metres) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          `Only ${metresFmt.format(free)} m of ${this.label(mother)} is free — ` +
          `cannot cut ${metresFmt.format(input.metres)} m`,
      });
    }

    const kg = input.metres * kgPerMetre(mother);
    const after = await moveRollCounters(
      tx,
      mother.id,
      takeSet(input.metres, kg),
      freeGuard(input.metres),
    );
    if (!after) {
      // The guard held a moment ago; someone reserved or cut in between.
      throw new TRPCError({
        code: "CONFLICT",
        message: `${this.label(mother)} changed while you were cutting it — reload and retry`,
      });
    }

    const numero = this.childLabel(mother, 1);
    const child = await tx.paperRoll.create({
      data: {
        ...this.inherited(mother),
        numero,
        parentId: mother.id,
        metrage: input.metres,
        metrageRestant: input.metres,
        poids: kg,
        poidsRestant: kg,
        disponible: true,
        reserved: false,
        partiel: false,
      },
      select: { id: true, numero: true, metrageRestant: true, parentId: true },
    });

    const spent = after.metrageRestant <= 0;
    await writeRollFlags(tx, after, {
      partiel: true,
      ...(spent
        ? {
            consomme: true,
            dateConsommation: new Date(),
            consumedByNote: this.appendNote(mother.consumedByNote, `Cut into ${numero}`),
          }
        : {
            consumedByNote: this.appendNote(
              mother.consumedByNote,
              `Cut ${metresFmt.format(input.metres)} m into ${numero}`,
            ),
          }),
    });
    return child;
  }

  /**
   * Slits a reel lengthwise into bands of the given widths — plan §5.1.
   *
   * The mother is retired in the same transaction (consumed and archived,
   * as the legacy app did for its "Split by weight" reels) and each band
   * becomes a child of the mother's full remaining length at its own width
   * and a proportional share of the weight. Whatever width is left over is
   * trim: it leaves stock with no row of its own, and the note records it.
   *
   * Reserved paper cannot be slit: a reservation names a reel and a length,
   * and the reel would no longer exist. The mother update is guarded on
   * `metrageReserve = 0` so a reservation landing between the read and the
   * write is caught, not overwritten.
   */
  async slit(input: SlitRollInput) {
    return this.prisma.$transaction(async (tx) => {
      const mother = await tx.paperRoll.findUnique({
        where: { id: input.rollId },
        select: MOTHER_SELECT,
      });
      if (!mother) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Roll not found" });
      }
      this.assertLive(mother);
      this.assertReceived(mother);
      if (mother.laize === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${this.label(mother)} has no width recorded — enter it before slitting`,
        });
      }
      if (mother.metrageRestant <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${this.label(mother)} has no length recorded — enter it before slitting`,
        });
      }
      if (mother.metrageReserve > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            `${metresFmt.format(mother.metrageReserve)} m of ${this.label(mother)} is reserved ` +
            "— cancel those reservations before slitting it",
        });
      }
      const total = input.widthsMm.reduce((sum, w) => sum + w, 0);
      if (total > mother.laize) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `The bands add up to ${total} mm but ${this.label(mother)} is ${mother.laize} mm wide`,
        });
      }
      const trim = mother.laize - total;
      const laize = mother.laize;

      const bands = input.widthsMm.map((width, index) => ({
        width,
        numero: this.childLabel(mother, index + 1),
        kg: (mother.poidsRestant * width) / laize,
      }));
      const note =
        `Slit into ${bands.map((b) => `${b.numero} (${b.width} mm)`).join(", ")}` +
        (trim > 0 ? `; trim ${trim} mm` : "");

      // The mother first, so a concurrent reservation fails the whole slit
      // before any band exists.
      const retired = await tx.paperRoll.updateMany({
        where: { id: mother.id, metrageReserve: 0, consomme: false, archived: false },
        data: {
          metrageRestant: 0,
          poidsRestant: 0,
          consomme: true,
          archived: true,
          disponible: false,
          reserved: false,
          partiel: true,
          dateConsommation: new Date(),
          consumedByNote: this.appendNote(mother.consumedByNote, note),
        },
      });
      if (retired.count !== 1) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `${this.label(mother)} changed while you were slitting it — reload and retry`,
        });
      }

      const children = [];
      for (const band of bands) {
        children.push(
          await tx.paperRoll.create({
            data: {
              ...this.inherited(mother),
              numero: band.numero,
              parentId: mother.id,
              laize: band.width,
              metrage: mother.metrageRestant,
              metrageRestant: mother.metrageRestant,
              poids: band.kg,
              poidsRestant: band.kg,
              disponible: true,
              reserved: false,
              partiel: false,
            },
            select: { id: true, numero: true, laize: true, metrageRestant: true },
          }),
        );
      }
      // The mother is the entity for the audit row; the bands ride along.
      return { id: mother.id, numero: mother.numero, trimMm: trim, children };
    });
  }

  /** The columns a child reel takes from its mother. */
  private inherited(mother: {
    numeroSource: string | null;
    paperGrade: string | null;
    description: string | null;
    laize: number | null;
    grammage: number | null;
    paperType: Prisma.PaperRollCreateInput["paperType"];
    price: number | null;
    priceWithTransport: number | null;
    importShipmentId: string | null;
    receivedAt: Date | null;
    receivedById: string | null;
  }) {
    return {
      numeroSource: mother.numeroSource,
      paperGrade: mother.paperGrade,
      description: mother.description,
      laize: mother.laize,
      grammage: mother.grammage,
      paperType: mother.paperType ?? null,
      price: mother.price,
      priceWithTransport: mother.priceWithTransport,
      importShipmentId: mother.importShipmentId,
      // Carried, not re-stamped: the child is a piece of paper that was
      // already received, so it keeps the mother's receipt and scanner.
      receivedAt: mother.receivedAt,
      receivedById: mother.receivedById,
    };
  }

  /**
   * `<mother>/n`, numbered after the children the mother already has, so a
   * reel cut once and then slit in three gets /2, /3, /4. A label, not a
   * key — it is what gets written on the reel.
   */
  private childLabel(
    mother: { id: string; numero: string | null; _count: { children: number } },
    offset: number,
  ): string {
    return `${mother.numero ?? mother.id.slice(-6)}/${mother._count.children + offset}`;
  }

  private label(roll: { numero: string | null }): string {
    return roll.numero ?? "this reel";
  }

  /**
   * Refuses a reel nobody has scanned in yet.
   *
   * Cutting, slitting and reserving all act on paper someone has to find on
   * the floor. A reel that was typed into the office but never scanned may
   * not be there at all — that is the whole point of receiving — so these
   * operations refuse it rather than move counters for stock that might not
   * exist. Called after `assertLive`, so "used up" and "archived" win the
   * message when several apply.
   */
  private assertReceived(roll: { numero: string | null; receivedAt: Date | null }) {
    if (roll.receivedAt === null) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `${this.label(roll)} has not been received yet — scan it in first`,
      });
    }
  }

  private assertLive(roll: { numero: string | null; consomme: boolean; archived: boolean }) {
    // PRECONDITION_FAILED, like `receiveRoll`: the reel's state refuses the
    // operation, the input itself is fine.
    if (roll.consomme) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `${this.label(roll)} is used up`,
      });
    }
    if (roll.archived) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `${this.label(roll)} is archived — restore it first`,
      });
    }
  }

  private appendNote(existing: string | null, line: string): string {
    return existing ? `${existing}; ${line}` : line;
  }

  /**
   * Archive or restore a reel. Always allowed: archiving is how a reel in use
   * is retired, and it changes no quantity.
   */
  async setRollArchived(id: string, archived: boolean) {
    await this.assertRollExists(id);
    return this.prisma.paperRoll.update({
      where: { id },
      data: { archived },
      select: ROLL_RETURN_SELECT,
    });
  }

  /**
   * Hard delete, permitted only while nothing depends on the reel — the same
   * shape as `removeShipment`.
   *
   * Split children matter as much as allocations here: `PaperRoll.parentId` is
   * `NoAction`, so deleting a parent would leave its children pointing at a
   * row that no longer exists and the lineage unreadable. Stocktake lines are
   * `Restrict`: a reel seen in a count is part of that count's record, and
   * the database would refuse the delete with a bare P2003 anyway.
   */
  async removeRoll(id: string) {
    const roll = await this.loadRollDependencies(id);
    const blockers: string[] = [];
    if (roll._count.allocations > 0) {
      blockers.push(`${roll._count.allocations} allocation(s)`);
    }
    if (roll._count.children > 0) {
      blockers.push(`${roll._count.children} reel(s) cut from it`);
    }
    if (roll._count.countLines > 0) {
      blockers.push(`it was seen in ${roll._count.countLines} stocktake(s)`);
    }
    if (roll.consomme) blockers.push("it is marked consumed");

    if (blockers.length > 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          `${roll.numero ?? "This reel"} cannot be deleted: ${blockers.join(", ")}. ` +
          "Archive it instead — deleting it would break records that reference it.",
      });
    }
    await this.prisma.paperRoll.delete({ where: { id } });
    return { id };
  }

  /**
   * Shared by create and update.
   *
   * `dateImport` arrives as "YYYY-MM-DD" and is pinned to **midnight UTC**.
   * Constructing a `Date` from the bare string would land the previous day on
   * a machine east of UTC — the same trap `legacyDate` exists to avoid in the
   * importers, and a `@db.Date` column would then store the wrong day.
   */
  private writableShipment(input: CreateShipmentInput, supplierId: string) {
    return {
      numeroImport: input.numeroImport,
      dateImport:
        input.dateImport === undefined ? null : new Date(`${input.dateImport}T00:00:00.000Z`),
      supplierId,
      productName: input.productName ?? null,
      totalMetrage: input.totalMetrage ?? null,
      totalRolls: input.totalRolls ?? null,
      price: input.price ?? null,
      priceTotal: input.priceTotal ?? null,
      currency: input.currency ?? null,
      transportIncluded: input.transportIncluded ?? null,
      transportPrice: input.transportPrice ?? null,
      hasCertificate: input.hasCertificate ?? null,
      certificate: input.certificate ?? null,
      packingList: input.packingList ?? null,
      importFile: input.importFile ?? null,
      observations: input.observations ?? null,
    };
  }

  private async assertShipmentExists(id: string) {
    const found = await this.prisma.importShipment.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Shipment not found" });
    }
  }

  /**
   * `numeroImport` is the delivery's own reference and is unique, so a clash
   * is reported as a CONFLICT rather than surfacing as a Prisma unique-index
   * error.
   */
  private async assertNumeroFree(numeroImport: string, excludeId?: string) {
    const existing = await this.prisma.importShipment.findUnique({
      where: { numeroImport },
      select: { id: true },
    });
    if (existing && existing.id !== excludeId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Shipment ${numeroImport} already exists`,
      });
    }
  }

  /**
   * Validates the supplier id. Required since 2026-09-03: the free-text
   * fallback was dropped because it recorded the same company two ways.
   *
   * An archived supplier is rejected: it is no longer offered in the picker,
   * so receiving one means a stale form or a hand-made request.
   */
  private async resolveSupplier(supplierId: string): Promise<string> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, active: true },
    });
    if (!supplier) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "That supplier no longer exists",
      });
    }
    if (!supplier.active) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${supplier.name} is archived and cannot be assigned`,
      });
    }
    return supplier.id;
  }

  /**
   * Every reel column except the weights (`poids`, `metrage` and their
   * remainders) and the shipment link. The weights are the caller's: create
   * writes them outright, update only past `assertRollWeightsEditable`.
   */
  private writableRoll(input: CreateRollInput) {
    return {
      numero: input.numero ?? null,
      numeroSource: input.numeroSource ?? null,
      paperGrade: input.paperGrade ?? null,
      description: input.description ?? null,
      laize: input.laize ?? null,
      grammage: input.grammage ?? null,
      paperType: input.paperType ?? null,
      price: input.price ?? null,
      priceWithTransport: input.priceWithTransport ?? null,
      qrCodeUrl: input.qrCodeUrl ?? null,
    };
  }

  /** The reel plus the counts that decide whether its weights may change. */
  private async loadRollDependencies(id: string) {
    const roll = await this.prisma.paperRoll.findUnique({
      where: { id },
      select: {
        id: true,
        numero: true,
        consomme: true,
        poids: true,
        metrage: true,
        poidsRestant: true,
        metrageRestant: true,
        parentId: true,
        _count: { select: { allocations: true, children: true, countLines: true } },
      },
    });
    if (!roll) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Roll not found" });
    }
    return roll;
  }

  private async assertRollExists(id: string) {
    const found = await this.prisma.paperRoll.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Roll not found" });
    }
  }

  /**
   * Weights may only change while NOTHING depends on the reel.
   *
   * Four things count as depending on it, and each would be falsified by a
   * changed weight:
   *   - allocations: 775 kg promised to an order cannot come off a reel that
   *     someone has since edited down to 500;
   *   - split children: the parent's weight is what the children were cut
   *     from, so changing it breaks the arithmetic of the lineage;
   *   - being a split child itself: its weight came out of its parent;
   *   - being consumed: the reel is spent, and its final weight is history.
   *
   * Labels, grade, grammage, width, prices and the QR URL stay editable in
   * every case — this refuses only the quantities. That is what makes fixing
   * a typo at receiving possible without letting stock contradict itself.
   */
  private assertRollWeightsEditable(roll: {
    numero: string | null;
    consomme: boolean;
    parentId: string | null;
    _count: { allocations: number; children: number };
  }) {
    const reasons: string[] = [];
    if (roll._count.allocations > 0) {
      reasons.push(`${roll._count.allocations} allocation(s) depend on it`);
    }
    if (roll._count.children > 0) {
      reasons.push(`${roll._count.children} reel(s) were cut from it`);
    }
    if (roll.parentId !== null) reasons.push("it was cut from another reel");
    if (roll.consomme) reasons.push("it is marked consumed");

    if (reasons.length > 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          `The weights on ${roll.numero ?? "this reel"} cannot be changed: ` +
          `${reasons.join(", ")}. Everything else about it is still editable.`,
      });
    }
  }
}
