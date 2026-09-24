import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
  CreateOrderInput,
  OrderProductRef,
  OrderStatus,
  TransitionOrderInput,
  UpdateOrderInput,
} from "@repo/api-contract";
import {
  canAcceptQuote,
  kindAllowsTransition,
  canAccess,
  findOrderTransition,
  legacyFlagsForStatus,
  normaliseProductSpec,
  parcelBalance,
  plannedParcels,
  priceOrder,
  productSpecFromRow,
  toPricingInputs,
} from "@repo/api-contract";
import { AllocationService } from "../allocation/allocation.service";
import { Prisma } from "../generated/prisma/client.js";
import { runListQuery } from "../list/list-query";
import { PrismaService } from "../prisma.service";
import { ProductService } from "../product/product.service";
import type { SessionUser } from "../trpc/trpc";
import {
  ORDER_DETAIL_SELECT,
  ORDER_DETAIL_SELECT_PRICED,
  ORDER_LIST_SELECT,
  ORDER_LIST_SELECT_PRICED,
  orderListDeclaration,
  type ListOrdersInput,
  type OrderDetail,
  type OrderDetailPriced,
} from "./order.list";
import { orderScopeFor } from "./order.scope";

const RETURN_SELECT = { id: true, numero: true, active: true } as const;

/**
 * How many numbers past the counter `allocateNumero` will look at for a free
 * one. Generous against the real data (one legacy number sits ahead of the
 * counter today); a block this long of hand-typed numbers means something
 * other than a gap is wrong, and a refusal says so.
 */
const NUMERO_SEARCH_WINDOW = 1000;

/** `numero` values the counter owns — see `assertNumeroNotAhead`. */
const COUNTER_NUMERO = /^CMD-(\d+)$/;

function isUniqueViolation(cause: unknown): boolean {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002";
}

/**
 * What a lifecycle write runs against: the service's own client, or the
 * interactive transaction a caller is already inside. `PrismaClient` is
 * structurally a `TransactionClient` (the latter is the former minus
 * `$transaction`/`$connect`/…), so the plain client passes without a cast.
 */
export type Db = Prisma.TransactionClient;

/** What `transition`/`acceptQuote` need off the current row before writing. */
const LIFECYCLE_SELECT = {
  id: true,
  numero: true,
  kind: true,
  status: true,
} as const;

/** The spec columns `resolveProduct` needs off a candidate `Product` row. */
const PRODUCT_RESOLVE_SELECT = {
  id: true,
  clientId: true,
  active: true,
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
} as const;

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductService,
    private readonly allocations: AllocationService,
  ) {}

  /**
   * Session-derived visibility, AND-ed in before anything the client sent —
   * the `scope` contract from `runListQuery`, never a facet key.
   *
   * PRODUCTION sees only the orders released to the floor
   * (`PRODUCTION_VISIBLE_ORDER_STATUSES`); every other role sees the whole
   * table. The predicate itself is `orderScopeFor`, shared with the other
   * services that read orders.
   *
   * Note this narrows the FACET COUNTS too, which is correct: a PRODUCTION
   * user's chips must count what that user can actually open, and the counts
   * still partition their scoped set because every facet AND-s onto this.
   */
  private scopeFor(actor: SessionUser): Prisma.OrderWhereInput {
    return orderScopeFor(actor.role);
  }

  /**
   * ADMIN and above read every price; everyone else gets the order without a
   * single money column — see `ORDER_LIST_SELECT` for why this is a `select`
   * split rather than a filter applied afterwards.
   *
   * `canAccess` rather than `hasRank`, so the PRODUCTION/MAGASINIER sibling
   * pair cannot reach each other's level. Both sit below ADMIN either way,
   * and neither has any business reading a margin.
   */
  private canReadPricing(actor: SessionUser): boolean {
    return canAccess(actor.role, "ADMIN");
  }

  async list(actor: SessionUser, query: ListOrdersInput) {
    const priced = this.canReadPricing(actor);
    // A column is sortable only if the caller can read it: ordering the
    // unpriced rows by `orderTotal` would rank every order by value without
    // a single figure in the payload. Refused rather than silently swapped
    // for the default, so a client bug surfaces instead of mis-sorting.
    if (!priced && query.sortBy === "orderTotal") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Sorting by order total needs pricing access",
      });
    }
    const select = priced ? ORDER_LIST_SELECT_PRICED : ORDER_LIST_SELECT;
    const result = await runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) => this.prisma.order.findMany({ ...args, select }),
        count: (args) => this.prisma.order.count(args),
      },
      query,
      declaration: orderListDeclaration,
      scope: this.scopeFor(actor),
    });
    const produced = await this.producedFor(result.rows.map((row) => row.id));
    return {
      ...result,
      rows: result.rows.map((row) => ({
        ...row,
        /** Pieces the producer station has recorded against this order. */
        produced: produced.get(row.id) ?? 0,
      })),
    };
  }

  /**
   * What the producer station has recorded against each order — the figure
   * the list's progress ring shows against `quantite`.
   *
   * Two sums, because a run's headline lives in one of two columns: a run
   * recorded here carries `piecesProduced`, a migrated row only `quantite`.
   * Summing `quantite` across the board would double-count nothing but would
   * mix metres of printing into pieces, so only PRODUCER runs count, and a
   * migrated row contributes its `quantite` only where `piecesProduced` is
   * null — the same fallback the daily view uses.
   */
  private async producedFor(orderIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (orderIds.length === 0) return result;
    // One snapshot for both sums, so a run recorded between them cannot be
    // counted in neither or both.
    const [recorded, migrated] = await this.prisma.$transaction([
      this.prisma.productionRun.groupBy({
        by: ["orderId"],
        where: {
          orderId: { in: orderIds },
          stage: "PRODUCER",
          piecesProduced: { not: null },
        },
        _sum: { piecesProduced: true },
      }),
      this.prisma.productionRun.groupBy({
        by: ["orderId"],
        where: {
          orderId: { in: orderIds },
          stage: "PRODUCER",
          piecesProduced: null,
        },
        _sum: { quantite: true },
      }),
    ]);
    for (const group of recorded) {
      result.set(
        group.orderId,
        (result.get(group.orderId) ?? 0) + (group._sum.piecesProduced ?? 0),
      );
    }
    for (const group of migrated) {
      result.set(
        group.orderId,
        (result.get(group.orderId) ?? 0) + (group._sum.quantite ?? 0),
      );
    }
    return result;
  }

  /**
   * Parcels the packaging station has closed against each order — the
   * quantity a sales invoice bills (docs/sales-invoice-plan.md §5.3). One
   * sum, not two: PACKAGING runs only exist post-migration and always carry
   * `parcelsClosed`. Orders with no packaging run are absent from the map,
   * which the invoice service reads as "fall back to the planned count".
   *
   * Public, and takes a `db`, because `InvoiceService` needs the figure
   * inside its own transaction.
   */
  async packedFor(orderIds: string[], db: Db = this.prisma): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (orderIds.length === 0) return result;
    const groups = await db.productionRun.groupBy({
      by: ["orderId"],
      where: { orderId: { in: orderIds }, stage: "PACKAGING" },
      _sum: { parcelsClosed: true },
    });
    for (const group of groups) {
      result.set(group.orderId, group._sum.parcelsClosed ?? 0);
    }
    return result;
  }

  /** Live orders in the caller's scope, for the sidebar's count. */
  count(actor: SessionUser) {
    return this.prisma.order.count({
      where: { AND: [{ active: true }, this.scopeFor(actor)] },
    });
  }

  /**
   * The orders a run can be recorded against right now: `IN_PRODUCTION`, in
   * the caller's scope, oldest number first. The production page's order
   * picker. Not the `inProduction` facet — that one also holds PRODUCED
   * orders, which the floor is done with.
   */
  async onFloor(actor: SessionUser) {
    return this.prisma.order.findMany({
      where: {
        AND: [{ status: "IN_PRODUCTION", active: true }, this.scopeFor(actor)],
      },
      select: {
        id: true,
        numero: true,
        quantite: true,
        product: { select: { name: true } },
        client: { select: { name: true } },
      },
      orderBy: [{ numero: "asc" }, { id: "asc" }],
    });
  }

  /**
   * The same scope as `list`, re-checked here: without it a PRODUCTION user
   * could open any order by guessing or keeping a stale id, which would make
   * the list scope decorative. `NOT_FOUND` rather than `FORBIDDEN` per the
   * repo convention — `FORBIDDEN` confirms the order exists.
   */
  async byId(
    actor: SessionUser,
    id: string,
  ): Promise<OrderDetail | OrderDetailPriced> {
    const where = { AND: [{ id }, this.scopeFor(actor)] };

    // Two explicit branches, not one `findFirst` with a ternary `select`.
    // The ternary collapses to a single inferred type, so the client would
    // only ever see one of the two shapes — the union has to be built here,
    // in the RETURN TYPE, for `inferRouterOutputs` to carry both across to
    // the web app and force it to narrow before touching a price.
    if (this.canReadPricing(actor)) {
      const order = await this.prisma.order.findFirst({
        where,
        select: ORDER_DETAIL_SELECT_PRICED,
      });
      if (!order) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
      }
      return order;
    }

    const order = await this.prisma.order.findFirst({
      where,
      select: ORDER_DETAIL_SELECT,
    });
    if (!order) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
    }
    return order;
  }

  /**
   * `kind` is the one lifecycle value the caller chooses, and only here: the
   * form drafts either a quote or an order (`createOrderInput.kind`, default
   * ORDER), and afterwards only `acceptQuote` moves it (QUOTE -> ORDER — see
   * docs/order-lifecycle-plan.md §3.1). A quote takes a `CMD-<n>` from the
   * same counter as an order, like the 17 migrated ones, and keeps it when
   * accepted. `status` always starts at `DRAFT`, per the transition table's
   * `— -> DRAFT` row (§3): it is fixed here, not read from `input`, so a
   * client cannot hand-pick how far along a new document starts.
   *
   * The first `OrderStatusChange` row is a NESTED create under the order,
   * not a separate `$transaction` call — Prisma sends this as one INSERT
   * cascading into the related table, so it is atomic by construction and
   * needs no interactive transaction. `fromStatus = null` marks it as the
   * start rather than a real transition, matching how the migration backfill
   * wrote its own rows (plan §4).
   */
  async create(input: CreateOrderInput) {
    await this.assertReferencesExist(input.clientId);
    /*
     * The number is allocated here, not sent by the client (2026-09-18).
     * The product resolution, the counter bump and the insert run in one
     * interactive transaction: if the insert fails — a Zod-passing value
     * Postgres rejects — the counter rolls back with it rather than burning
     * a number (the same guarantee `SalesInvoiceService.issue` gives its own
     * sequence), and a product defined inline for this order is not left
     * behind without one.
     */
    try {
      return await this.prisma.$transaction(async (tx) => {
        const product = await this.resolveProduct(
          tx,
          input.product,
          input.clientId ?? null,
          null,
        );
        const numero = await this.allocateNumero(tx);
        return tx.order.create({
          data: {
            numero,
            ...this.writable(input),
            productId: product.id,
            ...this.priced(product, input, null),
            kind: input.kind,
            status: "DRAFT",
            ...legacyFlagsForStatus(input.kind, "DRAFT"),
            statusChanges: {
              create: {
                fromStatus: null,
                toStatus: "DRAFT",
                byUserId: null,
                note: input.kind === "QUOTE" ? "quote created" : "order created",
              },
            },
          },
          select: RETURN_SELECT,
        });
      });
    } catch (cause) {
      // `allocateNumero` skips every taken number under the counter's lock;
      // this is an `update` that saved a hand-typed number in between.
      if (isUniqueViolation(cause)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "That order number was just taken — save again for the next one",
        });
      }
      throw cause;
    }
  }

  /**
   * The next FREE `CMD-<n>`, from the single-row `OrderCounter`.
   *
   * The counter is not the only writer of `CMD-<n>`: the legacy data holds
   * numbers far ahead of it (CMD-6009 against a counter in the 600s), and
   * `update` once let a user type any number. Returning `next` blindly would
   * hit `Order.numero`'s `@unique`, roll the counter back with the failed
   * insert, and jam every later create on the same number. So:
   *
   *   1. lock the counter row (a no-op upsert, which also self-seeds it) —
   *      that lock serialises concurrent creates until this transaction ends,
   *      the same shape `PurchasingService.allocate` relies on;
   *   2. take the lowest number at or above `next` that no order holds,
   *      searching a bounded window so a pathological block of taken numbers
   *      fails loudly instead of scanning forever;
   *   3. move `next` past it.
   *
   * `create` still maps a unique violation to CONFLICT, for the one write
   * this lock does not serialise: `update` saving a hand-typed number.
   *
   * No zero-padding: the legacy numbers are not padded either (CMD-99 sits
   * beside CMD-100), so padding from here on would make the sequence look
   * like two different schemes.
   */
  private async allocateNumero(tx: Prisma.TransactionClient): Promise<string> {
    const locked = await tx.$queryRaw<{ next: number }[]>`
      INSERT INTO "OrderCounter" ("id", "next") VALUES ('CMD', 1)
      ON CONFLICT ("id") DO UPDATE SET "next" = "OrderCounter"."next"
      RETURNING "next"`;
    const start = locked[0]?.next;
    if (start === undefined) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Order counter returned no row",
      });
    }
    const free = await tx.$queryRaw<{ n: number }[]>`
      SELECT c AS n
      FROM generate_series(${start}::int, ${start}::int + ${NUMERO_SEARCH_WINDOW - 1}::int) AS c
      WHERE NOT EXISTS (SELECT 1 FROM "Order" o WHERE o."numero" = 'CMD-' || c)
      ORDER BY c
      LIMIT 1`;
    const sequence = free[0]?.n;
    if (sequence === undefined) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `No free order number within ${NUMERO_SEARCH_WINDOW} of CMD-${start}`,
      });
    }
    await tx.$executeRaw`
      UPDATE "OrderCounter" SET "next" = ${sequence + 1}::int WHERE "id" = 'CMD'`;
    return `CMD-${sequence}`;
  }

  async update(input: UpdateOrderInput) {
    const current = await this.assertExists(input.id);
    await this.assertNumeroFree(input.numero, input.id);
    // Only a CHANGED number is checked against the counter: a legacy order
    // already holding one ahead of it (CMD-6009) must stay saveable.
    if (input.numero !== current.numero) {
      await this.assertNumeroNotAhead(input.numero);
    }
    await this.assertReferencesExist(input.clientId);
    const product = await this.resolveProduct(
      this.prisma,
      input.product,
      input.clientId ?? null,
      current.productId,
    );
    try {
      return await this.prisma.order.update({
        where: { id: input.id },
        data: {
          // Written here, not in `writable`: `create` allocates its own and
          // this is the only path that takes one from the caller.
          numero: input.numero,
          ...this.writable(input),
          productId: product.id,
          ...this.priced(product, input, current.legacyGlueCostPerUnit),
          // kind/status/the legacy booleans are deliberately absent: `update`
          // never touches the lifecycle. Only `create`, `transition` and
          // `acceptQuote` do — see their doc comments.
        },
        select: RETURN_SELECT,
      });
    } catch (cause) {
      // `assertNumeroFree` is a read; two saves racing to the same number
      // both pass it, and the loser lands here.
      if (isUniqueViolation(cause)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Order ${input.numero} already exists`,
        });
      }
      throw cause;
    }
  }

  /**
   * The single authority for moving `status`, per
   * docs/order-lifecycle-plan.md §3. `findOrderTransition` resolves both
   * whether the transition exists in the table at all and, if so, whether
   * `actor.role` may perform it right now — the two failure modes get
   * different error codes so the client can tell "this order cannot do that"
   * from "you cannot do that to this order":
   *
   *   - no such row for (from, to)              -> BAD_REQUEST
   *   - row exists, but the role fails it       -> PRECONDITION_FAILED
   *   - `note` required and missing             -> BAD_REQUEST
   *
   * One side effect the transition table itself specifies, applied here
   * rather than left to the caller (plan §3):
   *
   *   - `INVOICED -> READY_FOR_EXPORT` sets `exportStatus = PREPARATION`;
   *     `READY_FOR_EXPORT -> COMPLETED` sets `exportStatus = EXPORTED`. Never
   *     client-supplied at these two transitions — `transitionOrderInput` has
   *     no `exportStatus` field at all (see its doc comment).
   *
   * Per the repo convention, an order the caller may not see is hidden with
   * NOT_FOUND rather than FORBIDDEN: `assertLifecycleExists` applies the same
   * `scopeFor` as `byId`, so a PRODUCTION user cannot move an order off the
   * floor's list by id.
   *
   * Writes the status, the resolved side effects, the derived legacy-flag
   * mirror (§2.2's monotonic pipeline — see `legacyFlagsForStatus`; left
   * untouched on a cancel, which has no flag combination of its own) and the
   * `OrderStatusChange` row as one nested `update`: the log row is created as
   * part of the same statement that changes `status`, so the two can never be
   * separable — the failure mode plan §2.4 exists to prevent.
   *
   * `db` lets a caller that is already inside an interactive transaction
   * (`InvoiceService`, which inserts an invoice and moves the order in one
   * unit — docs/sales-invoice-plan.md §5) run the transition on its client;
   * the invoice guards in `assertInvoiceGuards` then see that caller's own
   * uncommitted rows. Without one, the transition opens its own.
   */
  async transition(actor: SessionUser, input: TransitionOrderInput, db?: Db) {
    // Callers already inside an interactive transaction (the invoice
    // service) pass theirs; everyone else gets one here, so the status
    // write and its log row are atomic either way — plan §2.4.
    if (db) return this.transitionIn(actor, input, db);
    return this.prisma.$transaction((tx) => this.transitionIn(actor, input, tx));
  }

  private async transitionIn(actor: SessionUser, input: TransitionOrderInput, db: Db) {
    const order = await this.assertLifecycleExists(actor, input.orderId, db);
    const transition = findOrderTransition(order.status, input.to);
    if (!transition) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${order.status} cannot move to ${input.to}`,
      });
    }
    if (!transition.role(actor.role)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Your role cannot perform "${transition.description}"`,
      });
    }
    if (!kindAllowsTransition(order.kind, transition.to)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "This is still a quote — accept it before moving it down the pipeline",
      });
    }
    const trimmedNote = input.note?.trim() || null;
    if (transition.noteRequired && !trimmedNote) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `"${transition.description}" requires a note`,
      });
    }
    // An order is not "produced" until the packaging station has closed at
    // least one parcel against it. A hard block, unlike the quantity
    // shortfall in plan §3.2 — that one could not be enforced because 125 of
    // 251 migrated orders had no runs at all, whereas this rule only ever
    // applies to work recorded from here on.
    //
    // ADMIN and above bypass it: a forgotten packaging entry would otherwise
    // freeze the order until someone logs one, and an admin correcting the
    // record is exactly the case that needs an escape hatch. The bypass is
    // visible in the audit log like any other transition, since the whole
    // move is written to `OrderStatusChange`.
    if (
      transition.from === "IN_PRODUCTION" &&
      transition.to === "PRODUCED" &&
      !canAccess(actor.role, "ADMIN")
    ) {
      const packed = await db.productionRun.findFirst({
        where: { orderId: input.orderId, stage: "PACKAGING" },
        select: { id: true },
      });
      if (!packed) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This order has no packaging recorded yet — the packaging station must close a parcel before it can be marked produced",
        });
      }
    }
    await this.assertInvoiceGuards(order.id, transition.from, transition.to, db);
    await this.assertShipmentGuards(
      order.id,
      transition.from,
      transition.to,
      actor,
      trimmedNote,
      db,
    );
    const exportStatus =
      transition.to === "READY_FOR_EXPORT"
        ? ("PREPARATION" as const)
        : transition.to === "COMPLETED"
          ? ("EXPORTED" as const)
          : undefined;

    // Compare-and-set: the `where` carries the status this decision was
    // made against, so two concurrent transitions cannot both succeed on
    // one read. Prisma raises P2025 when the row no longer matches, which
    // is "someone else moved it first" — a CONFLICT, not a missing order.
    let updated;
    try {
      updated = await db.order.update({
        where: { id: input.orderId, status: order.status },
        data: {
          status: input.to,
          ...(exportStatus ? { exportStatus } : {}),
          // A cancel keeps the flags the order had: CANCELLED is reachable
          // from any live status, so no flag combination means "cancelled"
          // (see `legacyFlagsForStatus`).
          ...(input.to === "CANCELLED" ? {} : legacyFlagsForStatus(order.kind, input.to)),
          statusChanges: {
            create: {
              fromStatus: order.status,
              toStatus: input.to,
              byUserId: actor.id,
              note: trimmedNote,
            },
          },
        },
        select: RETURN_SELECT,
      });
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2025") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This order was changed by someone else — reload and try again",
        });
      }
      throw cause;
    }

    // A cancelled order holds no paper: every open reservation goes back to
    // its reel, in this transaction, so the status write and the release
    // cannot disagree (docs/roll-allocation-plan.md §5.2). After the
    // compare-and-set, not before: the update holds the order's row lock
    // from here to commit, so a reservation racing this cancel (which locks
    // the same row) waits and then sees CANCELLED, rather than landing
    // between the release and the status write.
    if (transition.to === "CANCELLED") {
      await this.allocations.releaseForOrder(db, order.id);
    }
    return updated;
  }

  /**
   * The invoice-shaped guards from docs/sales-invoice-plan.md §5.1, which
   * the transition table cannot express because they depend on another
   * table. Each is conditional on an invoice line referencing the order, so
   * migrated orders — which have none — are never affected.
   *
   * Written for the multi-invoice cycle of docs/export-plan.md: an order
   * that shipped in part carries ISSUED invoices from earlier cycles, so
   * every check asks about the DRAFT specifically rather than "any line".
   */
  private async assertInvoiceGuards(
    orderId: string,
    from: OrderStatus,
    to: OrderStatus,
    db: Db,
  ): Promise<void> {
    const needsLookup =
      (from === "INVOICEABLE" && to === "INVOICED") ||
      to === "CANCELLED" ||
      (from === "INVOICED" && (to === "INVOICEABLE" || to === "READY_FOR_EXPORT"));
    if (!needsLookup) return;

    const lines = await db.salesInvoiceLine.findMany({
      where: { orderId },
      select: {
        invoice: {
          select: {
            id: true,
            numero: true,
            status: true,
            shipments: { select: { id: true }, take: 1 },
          },
        },
      },
    });
    const draft = lines.find((line) => line.invoice.status === "DRAFT")?.invoice;
    const unshippedIssued = lines.find(
      (line) => line.invoice.status === "ISSUED" && line.invoice.shipments.length === 0,
    )?.invoice;

    // Only ever reached from `InvoiceService.createFromOrder`, which has
    // just inserted the draft in this same transaction. A bare
    // `order.transition` finds nothing and is refused — there is no
    // legitimate "invoiced without an invoice", so no admin bypass. Scoped
    // on `from`: the `READY_FOR_EXPORT -> INVOICED` shipment discard shares
    // the `to` and legitimately finds only issued invoices.
    if (from === "INVOICEABLE" && to === "INVOICED" && !draft) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "An order becomes invoiced by creating an invoice from it, not by marking it",
      });
    }
    if (from === "INVOICED" && to === "INVOICEABLE" && !draft) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "There is no draft invoice to discard — the order's invoices are all issued",
      });
    }
    if (from === "INVOICED" && to === "READY_FOR_EXPORT" && draft) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Issue the draft invoice before creating a shipment",
      });
    }
    if (to === "CANCELLED" && draft) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Discard the draft invoice before cancelling this order",
      });
    }
    // An issued invoice that has not travelled blocks the cancel; once
    // every issued one has its shipment, cancelling closes only the
    // un-invoiced remainder (the shipment guard then requires those
    // shipments to have actually left).
    if (to === "CANCELLED" && unshippedIssued) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Invoice ${unshippedIssued.numero} has been issued and has not shipped — it cannot be cancelled`,
      });
    }
  }

  /**
   * The shipment-shaped guards from docs/export-plan.md Step 3, the
   * export-side twin of `assertInvoiceGuards`. Conditional on a shipment
   * line referencing the order, so the migrated orders — none has one —
   * keep today's bare "Mark exported".
   *
   * `to === "READY_FOR_EXPORT"` is reached only from
   * `ShipmentService.createFromOrder`; `READY_FOR_EXPORT -> INVOICEABLE` and
   * the with-lines branch of `-> COMPLETED` only from `ShipmentService.ship`,
   * because outside that transaction an order at `READY_FOR_EXPORT` always
   * has a DRAFT shipment (or none), and both refuse a DRAFT.
   */
  private async assertShipmentGuards(
    orderId: string,
    from: OrderStatus,
    to: OrderStatus,
    actor: SessionUser,
    note: string | null,
    db: Db,
  ): Promise<void> {
    const needsLookup =
      to === "READY_FOR_EXPORT" || from === "READY_FOR_EXPORT" || to === "CANCELLED";
    if (!needsLookup) return;

    const lines = await db.shipmentLine.findMany({
      where: { orderId },
      select: {
        quantity: true,
        shipment: { select: { id: true, numero: true, status: true } },
      },
    });
    const draft = lines.find((line) => line.shipment.status === "DRAFT")?.shipment;

    if (to === "READY_FOR_EXPORT" && !draft) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "An order is released to export by creating a shipment from it, not by marking it",
      });
    }
    if (from === "READY_FOR_EXPORT" && to === "INVOICED" && !draft) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "There is no draft shipment to discard",
      });
    }
    if (to === "CANCELLED" && draft) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Discard the draft shipment before cancelling this order",
      });
    }
    if (from !== "READY_FOR_EXPORT" || (to !== "INVOICEABLE" && to !== "COMPLETED")) return;

    if (draft) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          to === "COMPLETED"
            ? "Ship or discard the draft shipment first — an order is exported by shipping it"
            : "Ship or discard the draft shipment first",
      });
    }
    if (lines.length === 0) {
      if (to === "COMPLETED") return; // the legacy "Mark exported", no shipment involved
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "This order has no shipment — a partial export is recorded by shipping one",
      });
    }

    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { parcelCount: true },
    });
    const planned = plannedParcels(order.parcelCount);
    const balance = planned === null ? 0 : parcelBalance(planned, lines);

    if (to === "INVOICEABLE" && balance === 0) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Every parcel has shipped — mark the order exported instead",
      });
    }
    if (to === "COMPLETED" && balance > 0 && (!note || !canAccess(actor.role, "ADMIN"))) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `${balance} parcel${balance === 1 ? " has" : "s have"} not shipped — an admin must close this order with a note`,
      });
    }
  }

  /**
   * The `kind` axis's one transition, QUOTE -> ORDER (plan §3.1) — the
   * legacy `confirmerOffre`. Guarded by `canAcceptQuote` (kind is QUOTE,
   * status is DRAFT, role is ADMIN+); the two specific checks before it exist
   * only to give a precise message for the two ways a quote can be the wrong
   * shape for this action, before falling back to the same
   * BAD_REQUEST / PRECONDITION_FAILED split `transition` uses for "wrong
   * shape" vs. "wrong actor".
   *
   * The log row it writes has `fromStatus = toStatus = DRAFT` — the pipeline
   * position genuinely does not move, only the document's kind — so
   * acceptance still appears in the transition history rather than only in
   * `acceptedAt`/`acceptedBy`. One-way: there is no path back to QUOTE.
   */
  async acceptQuote(actor: SessionUser, orderId: string) {
    const order = await this.assertLifecycleExists(actor, orderId);
    if (order.kind !== "QUOTE") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This order is not a quote",
      });
    }
    if (order.status !== "DRAFT") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A quote can only be accepted while it is still in DRAFT",
      });
    }
    if (!canAcceptQuote(order.kind, order.status, actor.role)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Your role cannot accept a quote",
      });
    }

    // Compare-and-set on the shape checked above, as `transitionIn` does: a
    // concurrent accept, or a cancel landing between the read and this
    // write, turns into P2025 here rather than a second acceptance.
    try {
      return await this.prisma.order.update({
        where: { id: orderId, kind: "QUOTE", status: "DRAFT" },
        data: {
          kind: "ORDER",
          acceptedAt: new Date(),
          acceptedById: actor.id,
          ...legacyFlagsForStatus("ORDER", "DRAFT"),
          statusChanges: {
            create: {
              fromStatus: "DRAFT",
              toStatus: "DRAFT",
              byUserId: actor.id,
              note: "quote accepted",
            },
          },
        },
        select: RETURN_SELECT,
      });
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2025") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This quote was changed by someone else — reload and try again",
        });
      }
      throw cause;
    }
  }

  /**
   * Archive or restore. No hard delete: nine legacy tables reference an order,
   * and the ones not yet migrated (production, ordre_fabrication, invoicing)
   * will reference these rows too.
   */
  async setActive(id: string, active: boolean) {
    await this.assertExists(id);
    return this.prisma.order.update({
      where: { id },
      data: { active },
      select: RETURN_SELECT,
    });
  }

  /**
   * Replaces an order's print colours wholesale.
   *
   * A colour has no identity worth preserving — it is a name and a price — so
   * the set is replaced rather than diffed. Done in a transaction so a failure
   * cannot leave the order with no colours at all.
   */
  async setColours(
    orderId: string,
    colours: { nom?: string; prix?: number }[],
  ) {
    await this.assertExists(orderId);
    await this.prisma.$transaction([
      this.prisma.orderColour.deleteMany({ where: { orderId } }),
      this.prisma.orderColour.createMany({
        data: colours.map((colour) => ({
          orderId,
          nom: colour.nom ?? null,
          prix: colour.prix ?? null,
        })),
      }),
    ]);
    return { orderId, count: colours.length };
  }

  /**
   * Resolves what `Order.productId` should be, for both create and update.
   *
   * - `mode: "existing"` — must exist; if it belongs to a specific client
   *   (`clientId` non-null) that client must match the order's; if it is
   *   archived, it may only be kept if it is already this order's current
   *   product (so an old order stays readable, but nobody can newly assign an
   *   archived product).
   * - `mode: "new"` — defined inline, resolved through
   *   `ProductService.findOrCreate` (dedupe against an identical existing
   *   product, same as the importer and the migration).
   *
   * Returns the columns `priced()` needs, so the caller does one lookup
   * rather than resolving the id here and re-fetching the spec there.
   *
   * `db` is `create`'s transaction, so an inline product is created only if
   * the order is.
   */
  private async resolveProduct(
    db: Db,
    ref: OrderProductRef,
    orderClientId: string | null,
    currentProductId: string | null,
  ) {
    if (ref.mode === "existing") {
      const product = await db.product.findUnique({
        where: { id: ref.id },
        select: PRODUCT_RESOLVE_SELECT,
      });
      if (!product) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That product no longer exists",
        });
      }
      if (product.clientId !== null && product.clientId !== orderClientId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That product belongs to a different client",
        });
      }
      if (!product.active && product.id !== currentProductId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That product is archived and cannot be assigned",
        });
      }
      return product;
    }

    const { name, clientId, ...spec } = ref;
    const key = {
      ...normaliseProductSpec({
        typeSac: spec.typeSac,
        widthCm: spec.widthCm,
        lengthCm: spec.lengthCm,
        gussetCm: spec.gussetCm ?? null,
        pleatWidthCm: spec.pleatWidthCm ?? null,
        pleatLengthCm: spec.pleatLengthCm ?? null,
        grammage: spec.grammage,
        hasHandle: spec.hasHandle,
        handleWeightG: spec.handleWeightG ?? null,
      }),
      name,
      clientId: clientId ?? orderClientId,
      paperType: spec.paperType ?? null,
    };
    return this.products.findOrCreate(key, db);
  }

  /**
   * The single server pricing path: every create and update recomputes the
   * full snapshot from the resolved product's spec and this input's pricing
   * fields, and re-stores it — see the "never locked" decision on the model.
   *
   * `legacyGlueCostPerUnit` is not a form field (see `pricingInput`'s doc
   * comment) — it is preserved from the current row on update (`current`,
   * read by the caller alongside `assertExists`) and `null` on create, so a
   * client payload can never invent or overwrite it.
   */
  private priced(
    product: { id: string } & Parameters<typeof productSpecFromRow>[0],
    input: CreateOrderInput | UpdateOrderInput,
    currentLegacyGlue: number | null,
  ) {
    const spec = productSpecFromRow(product);
    const inputs = toPricingInputs(input, input.quantite, currentLegacyGlue);
    const figures = priceOrder(spec, inputs);
    return {
      quantityUnit: figures.quantityUnit,
      pricingSource: "COMPUTED" as const,
      productionWidthCm: figures.dimensions.productionWidthCm,
      cuttingLengthCm: figures.dimensions.cuttingLengthCm,
      unitWeightG: figures.dimensions.unitWeightG,
      metrageNecessaire: figures.metrageNecessaire,
      unitPrice: figures.unitPrice,
      unitPriceWithMargins: figures.unitPriceWithMargins,
      glueCostPerUnit: figures.glueCostPerUnit,
      finalUnitPrice: figures.finalUnitPrice,
      baseParcelPrice: figures.baseParcelPrice,
      finalParcelPrice: figures.finalParcelPrice,
      parcelCount: figures.parcelCount,
      orderTotal: figures.orderTotal,
    };
  }

  /**
   * Every column not derived by `priced()`: identity, the flattened pricing
   * inputs and the printing field.
   *
   * No `images`: artwork moved to `Product` (2026-09-03), where the same
   * "omitting it preserves what is stored" rule now lives — see
   * `ProductService.writableImages`.
   *
   * No `kind`/`status`/the legacy booleans: those are the lifecycle (plan
   * §5) and are set exclusively by `create`, `transition` and `acceptQuote`,
   * never through this shared create/update payload — see each of their doc
   * comments for where and why.
   *
   * No `exportStatus` either, since 2026-09-18: it left the form with the
   * workflow section, and `transition` is now its only writer. While it was
   * here as `input.exportStatus ?? null`, an ordinary save with the select
   * left blank nulled whatever the two transitions that own it had set.
   *
   * The four negotiated figures and `nombreCouleurs` were dropped with their
   * columns on the same date — recorded, never computed from, never read back
   * by anything.
   */
  private writable(input: CreateOrderInput | UpdateOrderInput) {
    return {
      // No `numero`: `create` allocates it from `OrderCounter` and `update`
      // writes the one the caller sent. It is not a field the two share any
      // more, so spreading it here would type as `undefined` on create.
      description: input.description ?? null,
      clientId: input.clientId ?? null,

      quantite: input.quantite,

      paperKiloPrice: input.paperKiloPrice ?? null,
      profitMarginPct: input.profitMarginPct ?? null,
      lossMarginPct: input.lossMarginPct ?? null,
      handleGlueKiloPrice: input.handleGlue.kiloPrice ?? null,
      handleGlueWeightG: input.handleGlue.weightG ?? null,
      sideGlueKiloPrice: input.sideGlue.kiloPrice ?? null,
      sideGlueWeightG: input.sideGlue.weightG ?? null,
      baseAdhesiveKiloPrice: input.baseAdhesive.kiloPrice ?? null,
      baseAdhesiveWeightG: input.baseAdhesive.weightG ?? null,
      piecesPerParcel: input.piecesPerParcel ?? null,
      kilosPerParcel: input.kilosPerParcel ?? null,
      parcelPrice: input.parcelPrice ?? null,
      transportCost: input.transportCost ?? null,

      // No paper figures: the need is in `priced()` and what is reserved or
      // consumed lives on `RollAllocation` — docs/roll-allocation-plan.md.

      typeImpression: input.typeImpression ?? null,
    };
  }

  private async assertExists(id: string) {
    const found = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true, numero: true, productId: true, legacyGlueCostPerUnit: true },
    });
    if (!found) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
    }
    return found;
  }

  /**
   * Scoped by the actor, like `byId` — a PRODUCTION user must not be able to
   * transition an order they are not allowed to see. Without the scope here,
   * hiding an order from the list would still leave it writable by id, which
   * is the worse half of the leak.
   */
  private async assertLifecycleExists(actor: SessionUser, id: string, db: Db = this.prisma) {
    const found = await db.order.findFirst({
      where: { AND: [{ id }, this.scopeFor(actor)] },
      select: LIFECYCLE_SELECT,
    });
    if (!found) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
    }
    return found;
  }

  /**
   * Refuses a hand-typed `CMD-<n>` at or past the counter's next value. Such
   * a number is one `allocateNumero` would otherwise hand out later; it
   * would skip it, but the user-chosen number would still sit in the
   * sequence's future, and the counter is the only writer of that range.
   * Anything outside the `CMD-<n>` shape is not the counter's and passes.
   */
  private async assertNumeroNotAhead(numero: string) {
    const match = COUNTER_NUMERO.exec(numero);
    if (!match) return;
    const counter = await this.prisma.orderCounter.findUnique({
      where: { id: "CMD" },
      select: { next: true },
    });
    // A missing row self-seeds at 1 on the next create.
    const next = counter?.next ?? 1;
    if (Number(match[1]) >= next) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `CMD-${next} onwards is allocated automatically — choose a number below it or another format`,
      });
    }
  }

  private async assertNumeroFree(numero: string, excludeId?: string) {
    const existing = await this.prisma.order.findUnique({
      where: { numero },
      select: { id: true },
    });
    if (existing && existing.id !== excludeId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Order ${numero} already exists`,
      });
    }
  }

  /**
   * Validates the order's optional relations, so a stale form reports which
   * reference is wrong rather than failing on a Prisma FK error.
   *
   * Only `clientId` remains: the worker and machine links went with the
   * assignment model, and the product reference is validated by
   * `resolveProduct` instead, since it needs more than an existence check.
   */
  private async assertReferencesExist(clientId: string | undefined) {
    if (clientId === undefined) return;
    const found = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true },
    });
    if (!found) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "That client no longer exists",
      });
    }
  }
}
