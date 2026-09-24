import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
  DiscardShipmentDraftInput,
  ShipShipmentInput,
  ShipmentKind,
  ShipmentLineInput,
  UpdateShipmentCustomsInput,
  UpdateShipmentDraftInput,
} from "@repo/api-contract";
import {
  canAccess,
  deriveShipmentKind,
  describeProductSpec,
  plannedParcels,
  productSpecFromRow,
  shipmentNumero,
} from "@repo/api-contract";
import { Prisma } from "../generated/prisma/client.js";
import { runListQuery } from "../list/list-query";
import { todayUtc } from "../list/period";
import { OrderService, type Db } from "../order/order.service";
import { PrismaService } from "../prisma.service";
import type { SessionUser } from "../trpc/trpc";
import {
  EXPORT_SHIPMENT_DETAIL_SELECT,
  EXPORT_SHIPMENT_SELECT,
  exportShipmentListDeclaration,
  type ListExportShipmentsInput,
} from "./shipment.list";

/** What `createFromOrder` reads off the order before writing. */
const EXPORTABLE_ORDER_SELECT = {
  id: true,
  numero: true,
  status: true,
  clientId: true,
  quantityUnit: true,
  piecesPerParcel: true,
  kilosPerParcel: true,
  parcelCount: true,
  product: {
    select: {
      name: true,
      typeSac: true,
      widthCm: true,
      lengthCm: true,
      gussetCm: true,
      pleatWidthCm: true,
      pleatLengthCm: true,
      grammage: true,
      paperType: true,
      hasHandle: true,
      handleWeightG: true,
    },
  },
} as const;

/** What every draft mutation needs off the shipment before deciding anything. */
const DRAFT_SELECT = {
  id: true,
  numero: true,
  status: true,
  exportDate: true,
  packingListNumber: true,
  salesInvoiceId: true,
  salesInvoice: {
    select: {
      id: true,
      numero: true,
      status: true,
      lines: { select: { orderId: true, quantity: true } },
    },
  },
  lines: {
    select: {
      position: true,
      orderId: true,
      mention: true,
      quantity: true,
      order: {
        select: {
          id: true,
          numero: true,
          quantityUnit: true,
          piecesPerParcel: true,
          kilosPerParcel: true,
          parcelCount: true,
        },
      },
    },
    orderBy: { position: "asc" as const },
  },
} as const;

type DraftLine = Prisma.ShipmentGetPayload<{ select: typeof DRAFT_SELECT }>["lines"][number];

/**
 * Outbound shipments — docs/export-plan.md. A draft is raised from an
 * `INVOICED` order and paired with its latest issued invoice, edited by
 * the warehouse, then shipped: it takes its number from `ShipmentCounter`,
 * freezes, and the order either completes (every parcel gone) or returns
 * to `INVOICEABLE` for the next invoice + shipment pair.
 *
 * Every mutation that touches an order's status goes through
 * `OrderService.transition` on the same transaction, so the shipment and
 * the lifecycle can never disagree — the guards in `assertShipmentGuards`
 * read this service's uncommitted rows.
 */
@Injectable()
export class ShipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
  ) {}

  async list(query: ListExportShipmentsInput) {
    const result = await runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) =>
          this.prisma.shipment.findMany({ ...args, select: EXPORT_SHIPMENT_SELECT }),
        count: (args) => this.prisma.shipment.count(args),
      },
      query,
      declaration: exportShipmentListDeclaration,
      scope: {},
    });

    // The header's "parcels out" figure. Parcels live on the lines, not on a
    // header column, so this cannot be a `shipment.aggregate` — it sums
    // `ShipmentLine.quantity` for the shipments the current filter and search
    // leave, restricted to SHIPPED: a draft's parcels have not gone anywhere.
    // The where is rebuilt from the same declaration the rows use, as
    // `InvoiceService.salesFigures` does, so under the draft chip it is 0.
    //
    // Outside `runListQuery`'s transaction, and so outside its snapshot,
    // exactly as purchasing's EUR fallback is: a header figure over a
    // relation the generic aggregate slot cannot reach.
    const declaration = exportShipmentListDeclaration;
    const search =
      query.search && typeof declaration.searchable === "function"
        ? declaration.searchable(query.search)
        : undefined;
    const facet = query.filter === "all" ? undefined : declaration.facets[query.filter];
    const shippedParcels = await this.prisma.shipmentLine.aggregate({
      where: {
        shipment: {
          AND: [...(search ? [search] : []), ...(facet ? [facet] : []), { status: "SHIPPED" }],
        },
      },
      _sum: { quantity: true },
    });

    return {
      ...result,
      aggregates: { shippedParcels: shippedParcels._sum.quantity ?? 0 },
      rows: result.rows.map(({ lines, ...row }) => ({
        ...row,
        parcels: lines.reduce((sum, line) => sum + line.quantity, 0),
        orderNumeros: lines.flatMap((line) => (line.order ? [line.order.numero] : [])),
        // The packing-list snapshot, summed. Null when no line carries one —
        // the row then shows the order count alone rather than a bare "0 pcs".
        units: lines.some((line) => line.units !== null)
          ? lines.reduce((sum, line) => sum + (line.units ?? 0), 0)
          : null,
        // Every line of one shipment belongs to one client's orders, so the
        // first line's unit speaks for the row; KILOGRAMS only on paper orders.
        unit: lines.find((line) => line.order)?.order?.quantityUnit ?? null,
      })),
    };
  }

  /**
   * The detail, plus per order-linked line the figures the editor and the
   * record both show: the plan, what OTHER shipments carry, what is left
   * after this one, and what the paired invoice bills — all parcel counts,
   * never money.
   */
  async byId(id: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      select: EXPORT_SHIPMENT_DETAIL_SELECT,
    });
    if (!shipment) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Shipment not found" });
    }
    const orderIds = shipment.lines.flatMap((line) => (line.orderId ? [line.orderId] : []));
    const elsewhere = await this.shippedElsewhere(orderIds, this.prisma, id);
    const invoiceQuantities = new Map(
      (shipment.salesInvoice?.lines ?? []).flatMap((line) =>
        line.orderId ? [[line.orderId, line.quantity ?? 0] as const] : [],
      ),
    );
    return {
      ...shipment,
      lines: shipment.lines.map((line) => {
        const planned = line.order ? plannedParcels(line.order.parcelCount) : null;
        const shippedElsewhere = line.orderId ? (elsewhere.get(line.orderId) ?? 0) : null;
        return {
          ...line,
          /** The order's planned parcels, rounded up; null when unpriced or no order. */
          planned,
          /** Parcels on the order's OTHER shipments, draft or shipped. */
          shippedElsewhere,
          /** What the order still has to ship once this line has gone. */
          balanceAfter:
            planned === null || shippedElsewhere === null
              ? null
              : Math.max(0, planned - shippedElsewhere - line.quantity),
          /** What the paired invoice bills for this order; null when it has no line for it. */
          invoiceQuantity: line.orderId ? (invoiceQuantities.get(line.orderId) ?? null) : null,
        };
      }),
    };
  }

  /** Drafts awaiting the truck — the sidebar's figure for the warehouse. */
  count() {
    return this.prisma.shipment.count({ where: { status: "DRAFT" } });
  }

  // ---------------------------------------------------------------------------
  // Write path — docs/export-plan.md Step 5
  // ---------------------------------------------------------------------------

  /**
   * Raises a DRAFT from an `INVOICED` order and moves the order to
   * `READY_FOR_EXPORT` in the same transaction. Pairs it with the most
   * recently issued invoice that has no shipment yet, and prefills one line
   * with that invoice's parcels, capped at the order's un-shipped balance.
   *
   * Guards fire in the order a user can act on them. A concurrent second
   * click is caught by the compare-and-set inside `transition`: the second
   * transaction finds the order already `READY_FOR_EXPORT`, throws
   * CONFLICT, and its shipment rolls back with it.
   */
  async createFromOrder(actor: SessionUser, orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: EXPORTABLE_ORDER_SELECT,
      });
      if (!order) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
      }
      if (order.status !== "INVOICED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Order ${order.numero} is ${order.status}, not ready for export`,
        });
      }
      if (order.clientId === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Set the order's client first — a shipment needs a consignee",
        });
      }
      const existingDraft = await tx.shipmentLine.findFirst({
        where: { orderId, shipment: { status: "DRAFT" } },
        select: { shipmentId: true },
      });
      if (existingDraft) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A draft shipment already exists for ${order.numero}`,
        });
      }
      const invoiceLine = await tx.salesInvoiceLine.findFirst({
        where: { orderId, invoice: { status: "ISSUED", shipments: { none: {} } } },
        orderBy: [{ invoice: { issuedAt: "desc" } }, { invoice: { createdAt: "desc" } }],
        select: {
          quantity: true,
          mention: true,
          invoice: { select: { id: true, numero: true } },
        },
      });
      if (!invoiceLine) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Every issued invoice for ${order.numero} already has a shipment — issue the next invoice first`,
        });
      }
      const planned = plannedParcels(order.parcelCount);
      if (planned === null || planned <= 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "The order has no planned parcel count — price it before shipping",
        });
      }
      // `shippedElsewhere` seeds every requested order at 0, so the fallback never fires.
      const balance = planned - ((await this.shippedElsewhere([orderId], tx)).get(orderId) ?? 0);
      if (balance <= 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Every parcel of ${order.numero} has shipped (${planned} parcels)`,
        });
      }

      // The invoice's figure, whole, never above what is left to ship.
      const quantity = Math.min(Math.max(1, Math.ceil(invoiceLine.quantity ?? 0)), balance);
      const unitsPerParcel =
        order.quantityUnit === "KILOGRAMS" ? order.kilosPerParcel : order.piecesPerParcel;

      const shipment = await tx.shipment.create({
        data: {
          status: "DRAFT",
          kind: deriveShipmentKind(quantity, balance),
          clientId: order.clientId,
          salesInvoiceId: invoiceLine.invoice.id,
          createdById: actor.id,
          lines: {
            create: [
              {
                position: 1,
                orderId,
                description: describeProductSpec(
                  { ...productSpecFromRow(order.product), paperType: order.product.paperType },
                  unitsPerParcel,
                  order.quantityUnit,
                ),
                // The issued line's mention, so the packing list reads like the invoice.
                mention: invoiceLine.mention,
                quantity,
                units: unitsPerParcel === null ? null : quantity * unitsPerParcel,
              },
            ],
          },
        },
        select: { id: true },
      });

      // After the insert, so the guard sees the DRAFT line.
      await this.orders.transition(actor, { orderId, to: "READY_FOR_EXPORT", note: undefined }, tx);
      return shipment;
    });
  }

  /**
   * Replaces the header fields and the lines of a DRAFT. Lines are replaced
   * wholesale; the order links are the one thing the caller cannot change.
   * An order-linked line is capped at the lower of what the paired invoice
   * bills for that order and what the order still has to ship — a truck
   * may take less than invoiced, never more.
   */
  async updateDraft(input: UpdateShipmentDraftInput) {
    return this.prisma.$transaction(async (tx) => {
      const draft = await this.assertDraft(input.id, tx);
      this.assertOrderLinksPreserved(draft.lines, input.lines);

      const positions = new Set(input.lines.map((line) => line.position));
      if (positions.size !== input.lines.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Line positions must be unique" });
      }

      const orders = new Map(
        draft.lines.flatMap((line) => (line.order ? [[line.order.id, line.order] as const] : [])),
      );
      const invoiceQuantities = new Map(
        (draft.salesInvoice?.lines ?? []).flatMap((line) =>
          line.orderId ? [[line.orderId, line.quantity ?? 0] as const] : [],
        ),
      );
      const elsewhere = await this.shippedElsewhere([...orders.keys()], tx, draft.id);
      // Not editable here, so the wholesale replace below must carry each
      // order line's snapshot over or the first save would wipe it.
      const mentions = new Map(
        draft.lines.flatMap((line) => (line.orderId ? [[line.orderId, line.mention] as const] : [])),
      );

      const kinds: ShipmentKind[] = [];
      const rows = [];
      for (const line of input.lines) {
        const order = line.orderId ? orders.get(line.orderId) : undefined;
        let units: number | null = null;
        if (order) {
          const planned = plannedParcels(order.parcelCount);
          if (planned === null) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Order ${order.numero} has no planned parcel count — price it before shipping`,
            });
          }
          const balance = Math.max(0, planned - (elsewhere.get(order.id) ?? 0));
          const billed = invoiceQuantities.get(order.id);
          const cap = billed === undefined ? balance : Math.min(Math.ceil(billed), balance);
          if (line.quantity > cap) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                billed !== undefined && Math.ceil(billed) < balance
                  ? `Invoice ${draft.salesInvoice?.numero ?? ""} bills ${Math.ceil(billed)} parcels of ${order.numero} — this line ships ${line.quantity}`
                  : `Only ${balance} parcels of ${order.numero} remain un-shipped — this line ships ${line.quantity}`,
            });
          }
          kinds.push(deriveShipmentKind(line.quantity, balance));
          const unitsPerParcel =
            order.quantityUnit === "KILOGRAMS" ? order.kilosPerParcel : order.piecesPerParcel;
          units = unitsPerParcel === null ? null : line.quantity * unitsPerParcel;
        }
        rows.push({
          shipmentId: draft.id,
          position: line.position,
          orderId: line.orderId ?? null,
          description: line.description ?? null,
          mention: line.orderId ? (mentions.get(line.orderId) ?? null) : null,
          quantity: line.quantity,
          units,
        });
      }

      await tx.shipmentLine.deleteMany({ where: { shipmentId: draft.id } });
      await tx.shipmentLine.createMany({ data: rows });
      return tx.shipment.update({
        where: { id: draft.id },
        data: {
          kind: kinds.every((kind) => kind === "COMPLETE") ? "COMPLETE" : "PARTIAL",
          ...(input.exportDate !== undefined
            ? { exportDate: input.exportDate === null ? null : new Date(input.exportDate) }
            : {}),
          ...(input.packingListNumber !== undefined
            ? { packingListNumber: blankToNull(input.packingListNumber) }
            : {}),
          ...(input.packingListDocument !== undefined
            ? { packingListDocument: blankToNull(input.packingListDocument) }
            : {}),
          ...(input.note !== undefined ? { note: blankToNull(input.note) } : {}),
          ...this.customsData(input),
        },
        select: { id: true },
      });
    });
  }

  /**
   * The customs declaration is recorded once the file comes back, usually
   * after the truck has left — the one edit a SHIPPED shipment accepts.
   */
  async updateCustoms(input: UpdateShipmentCustomsInput) {
    const found = await this.prisma.shipment.findUnique({
      where: { id: input.id },
      select: { id: true },
    });
    if (!found) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Shipment not found" });
    }
    return this.prisma.shipment.update({
      where: { id: input.id },
      data: this.customsData(input),
      select: { id: true },
    });
  }

  /**
   * DRAFT -> SHIPPED. Takes the next number for the export year from
   * `ShipmentCounter` with the same atomic upsert as `InvoiceService.issue`,
   * then moves every order on it: `COMPLETED` when nothing is left to ship
   * (or when an admin closes it short, with a note), else back to
   * `INVOICEABLE` with the system note, so the next cycle can start.
   *
   * `kind` is re-derived here from the live balance: the plan may have
   * moved since the draft was created (re-pricing), and ship is the figure
   * reporting keeps.
   */
  async ship(actor: SessionUser, input: ShipShipmentInput) {
    return this.prisma.$transaction(async (tx) => {
      const draft = await this.assertDraft(input.id, tx);
      if (input.closeOrder && !canAccess(actor.role, "ADMIN")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only an admin can close an order with parcels remaining",
        });
      }
      if (!draft.packingListNumber?.trim()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Record the packing list number before shipping",
        });
      }
      if (draft.lines.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A shipment needs at least one line" });
      }
      if (!draft.salesInvoice) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The shipment has no invoice attached — the goods travel with one",
        });
      }
      if (draft.salesInvoice.status !== "ISSUED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Issue the invoice before shipping",
        });
      }
      const exportDate = input.exportDate
        ? new Date(input.exportDate)
        : (draft.exportDate ?? todayUtc());
      const year = exportDate.getUTCFullYear() % 100;

      // Per order: what this shipment takes, what was left, what remains.
      const orderIds = [...new Set(draft.lines.flatMap((l) => (l.orderId ? [l.orderId] : [])))];
      const elsewhere = await this.shippedElsewhere(orderIds, tx, draft.id);
      const outcomes: { orderId: string; numero: string; remaining: number }[] = [];
      const kinds: ShipmentKind[] = [];
      for (const orderId of orderIds) {
        const order = draft.lines.find((l) => l.orderId === orderId)?.order;
        const planned = order ? plannedParcels(order.parcelCount) : null;
        if (!order || planned === null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Order ${order?.numero ?? orderId} has no planned parcel count — price it before shipping`,
          });
        }
        const balance = Math.max(0, planned - (elsewhere.get(orderId) ?? 0));
        const taking = draft.lines
          .filter((l) => l.orderId === orderId)
          .reduce((sum, l) => sum + l.quantity, 0);
        kinds.push(deriveShipmentKind(taking, balance));
        outcomes.push({ orderId, numero: order.numero, remaining: Math.max(0, balance - taking) });
      }

      const rows = await tx.$queryRaw<{ n: number }[]>`
        INSERT INTO "ShipmentCounter" ("year", "next") VALUES (${year}, 2)
        ON CONFLICT ("year") DO UPDATE SET "next" = "ShipmentCounter"."next" + 1
        RETURNING "next" - 1 AS n`;
      const sequence = rows[0]?.n;
      if (sequence === undefined) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Counter returned no row" });
      }
      const numero = shipmentNumero(year, sequence);

      // `assertDraft` holds the row lock, so this cannot miss today; the
      // compare-and-set stays as the backstop should a path ever reach here
      // without it.
      try {
        await tx.shipment.update({
          where: { id: draft.id, status: "DRAFT" },
          data: {
            numero,
            status: "SHIPPED",
            kind: kinds.every((kind) => kind === "COMPLETE") ? "COMPLETE" : "PARTIAL",
            exportDate,
            shippedById: actor.id,
          },
          select: { id: true },
        });
      } catch (cause) {
        if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2025") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This shipment was changed by someone else — reload and try again",
          });
        }
        throw cause;
      }

      // The status is SHIPPED within this transaction, so the guards see no
      // draft and the balance they compute is `remaining`.
      const orders = [];
      for (const outcome of outcomes) {
        const closing = outcome.remaining === 0 || input.closeOrder === true;
        const result = await this.orders.transition(
          actor,
          closing
            ? { orderId: outcome.orderId, to: "COMPLETED", note: input.note }
            : {
                orderId: outcome.orderId,
                to: "INVOICEABLE",
                note: `partial export: ${outcome.remaining} parcel${outcome.remaining === 1 ? "" : "s"} remaining`,
              },
          tx,
        );
        orders.push({
          id: result.id,
          numero: result.numero,
          status: closing ? ("COMPLETED" as const) : ("INVOICEABLE" as const),
          remaining: outcome.remaining,
        });
      }
      return { id: draft.id, numero, orders };
    });
  }

  /**
   * Deletes a DRAFT and returns every order on it to `INVOICED`, with the
   * caller's note on the transition. The transition runs FIRST: its guard
   * needs to see the DRAFT line. The invoice becomes free to be paired
   * again by construction — the FK sits on the shipment row.
   */
  async discardDraft(actor: SessionUser, input: DiscardShipmentDraftInput) {
    return this.prisma.$transaction(async (tx) => {
      const draft = await this.assertDraft(input.id, tx);
      const orderIds = [
        ...new Set(draft.lines.flatMap((line) => (line.orderId ? [line.orderId] : []))),
      ];
      for (const orderId of orderIds) {
        await this.orders.transition(actor, { orderId, to: "INVOICED", note: input.note }, tx);
      }
      await tx.shipment.delete({ where: { id: input.id } });
      return { id: input.id, orderIds };
    });
  }

  // ---------------------------------------------------------------------------

  /**
   * The status check a presigned upload needs, before one is minted.
   *
   * A presigned URL is a capability that outlives the check that produced it,
   * so the gate has to be re-applied here rather than left to the update
   * mutation that stores the resulting URL: minting one for a shipped record
   * would hand out a usable PUT for a document the record can no longer accept.
   *
   * `field` picks which rule applies, and they differ on purpose — the packing
   * list freezes at ship, while the customs declaration is the one edit a
   * SHIPPED shipment takes (`updateCustoms`). Both mirror the wording of
   * `assertDraft` so a rejection reads the same wherever it comes from.
   */
  async assertUploadable(id: string, field: "packingList" | "customs"): Promise<void> {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      select: { id: true, numero: true, status: true },
    });
    if (!shipment) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Shipment not found" });
    }
    if (field === "packingList" && shipment.status !== "DRAFT") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Shipment ${shipment.numero ?? ""} has shipped and can no longer be changed — only its customs declaration can`,
      });
    }
  }

  /**
   * Locks the shipment row, then reads it. Every draft mutation (`updateDraft`,
   * `ship`, `discardDraft`) calls this first inside its transaction, so they
   * serialise on the row: a save that queued behind a `ship` reads SHIPPED
   * once the lock is released and is refused here, instead of rewriting the
   * lines of a shipment that has left or deleting it. The same scheme as
   * `InvoiceService.assertDraft`. `db` must be a transaction — the lock is
   * held until it ends.
   */
  private async assertDraft(id: string, db: Db) {
    await db.$queryRaw`SELECT 1 FROM "Shipment" WHERE "id" = ${id} FOR UPDATE`;
    const shipment = await db.shipment.findUnique({ where: { id }, select: DRAFT_SELECT });
    if (!shipment) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Shipment not found" });
    }
    if (shipment.status !== "DRAFT") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Shipment ${shipment.numero ?? ""} has shipped and can no longer be changed — only its customs declaration can`,
      });
    }
    return shipment;
  }

  /**
   * Parcels per order on OTHER shipments, DRAFT and SHIPPED alike: a draft
   * claims its parcels the moment it exists, and counting both keeps the
   * figure valid before and after `ship` flips the status inside its own
   * transaction. Every requested order is present, at 0 when none.
   */
  private async shippedElsewhere(
    orderIds: string[],
    db: Db,
    excludeShipmentId?: string,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>(orderIds.map((id) => [id, 0]));
    if (orderIds.length === 0) return result;
    const groups = await db.shipmentLine.groupBy({
      by: ["orderId"],
      where: {
        orderId: { in: orderIds },
        ...(excludeShipmentId ? { shipmentId: { not: excludeShipmentId } } : {}),
      },
      _sum: { quantity: true },
    });
    for (const group of groups) {
      if (group.orderId) result.set(group.orderId, group._sum.quantity ?? 0);
    }
    return result;
  }

  /**
   * The stored order links must survive an edit unchanged — the invoice
   * rule, copied: each comes back on exactly one line, and nothing new
   * appears. A line whose `orderId` is omitted keeps the link its position
   * had.
   */
  private assertOrderLinksPreserved(stored: readonly DraftLine[], submitted: ShipmentLineInput[]) {
    const byPosition = new Map(stored.map((line) => [line.position, line.orderId]));
    const seen = new Set<string>();
    for (const line of submitted) {
      const kept = byPosition.get(line.position) ?? null;
      if (line.orderId === undefined) {
        line.orderId = kept;
      } else if (line.orderId !== kept) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A line's order link cannot be changed — discard the draft instead",
        });
      }
      if (line.orderId) {
        if (seen.has(line.orderId)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "An order can be carried by one line only",
          });
        }
        seen.add(line.orderId);
      }
    }
    for (const line of stored) {
      if (line.orderId && !seen.has(line.orderId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The line carrying the order cannot be removed — discard the draft instead",
        });
      }
    }
  }

  /** The three customs columns from either input, undefined = leave, null = clear. */
  private customsData(input: UpdateShipmentCustomsInput) {
    return {
      ...(input.customsDeclarationNumber !== undefined
        ? { customsDeclarationNumber: blankToNull(input.customsDeclarationNumber) }
        : {}),
      ...(input.customsDeclarationDate !== undefined
        ? {
            customsDeclarationDate:
              input.customsDeclarationDate === null ? null : new Date(input.customsDeclarationDate),
          }
        : {}),
      ...(input.customsDeclarationDocument !== undefined
        ? { customsDeclarationDocument: blankToNull(input.customsDeclarationDocument) }
        : {}),
    };
  }
}

/** An emptied text field clears the column rather than storing "". */
function blankToNull(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : value;
}
