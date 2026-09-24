import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import {
  RECEIPT_TOLERANCE,
  type CreateGoodsReceiptInput,
  type CreatePurchaseOrderInput,
  type GoodsReceiptLineInput,
  type PurchaseOrderLineInput,
  type UpdateGoodsReceiptInput,
  type UpdatePurchaseOrderInput,
} from "@repo/api-contract";
import { Prisma } from "../generated/prisma/client.js";
import type { PurchaseCategory, ReceiptStatus } from "../generated/prisma/enums.js";
import { runListQuery } from "../list/list-query";
import { PrismaService } from "../prisma.service";
import {
  GOODS_RECEIPT_DETAIL_SELECT,
  GOODS_RECEIPT_SELECT,
  PURCHASE_ORDER_DETAIL_SELECT,
  PURCHASE_ORDER_SELECT,
  goodsReceiptListDeclaration,
  orderAmount,
  orderDimensions,
  orderFulfilment,
  orderPeriodFilter,
  orderState,
  purchaseOrderListDeclaration,
  stateMatches,
  type ListGoodsReceiptsInput,
  type ListPurchaseOrdersInput,
} from "./purchasing.list";
import { ORDER_PREFIX, RECEIPT_PREFIX, formatNumero } from "./purchasing.numbering";
import { todayUtc } from "../list/period";

/**
 * Purchase orders (what we asked suppliers for) and goods receipts (what
 * arrived against them), migrated from the legacy system and now writable.
 *
 * The module owns the numbering rule: `numero` is never client-supplied but
 * allocated from `PurchaseOrderCounter` / `GoodsReceiptCounter` inside the
 * creating transaction, continuing the legacy per-category series
 * (purchasing.numbering.ts).
 *
 * It deliberately does NOT own a stock side effect. A PAPER receipt records
 * the delivery note and nothing else: reels enter stock by being scanned
 * against an `ImportShipment` (`StockService.receiveRoll`), which is a
 * physical check on the floor rather than a paper one in the office. Bridging
 * the two would need a reel identity the receipt does not carry — the note
 * says "12 tonnes of 90 g/m²", not which reels arrived — so it stays a
 * separate, deliberate step.
 */
@Injectable()
export class PurchasingService {
  constructor(private readonly prisma: PrismaService) {}

  async listOrders(input: ListPurchaseOrdersInput) {
    // The period is scope, not a facet: `runListQuery` ANDs scope first and
    // nothing downstream can widen it, and the facet chips must keep counting
    // within the chosen window rather than across all time. Split out of the
    // query the same way stock's advanced filter does (`splitRollFilter`).
    const { period, from, to, state, ...query } = input;
    const window = orderPeriodFilter({ period, from, to });
    // One "today" per request, so a row's late flag, the late tile and the
    // state counts all agree on which day it is.
    const today = todayUtc();

    const { stateIds, ...header } = await this.orderFigures(query, state, window, today);

    // The reception state is derived from the lines, so it cannot be a
    // Prisma predicate; the scan above already judged every order in the
    // window, and the matching ids become the scope. AND-ed with the
    // window, so the category chips count inside both.
    const scope: Prisma.PurchaseOrderWhereInput = {
      AND: [...(window ? [window] : []), ...(stateIds ? [{ id: { in: stateIds } }] : [])],
    };

    const result = await runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) =>
          this.prisma.purchaseOrder.findMany({ ...args, select: PURCHASE_ORDER_SELECT }),
        count: (args) => this.prisma.purchaseOrder.count(args),
      },
      query,
      declaration: purchaseOrderListDeclaration,
      scope,
    });

    return {
      ...result,
      ...header,
      // `lines` stays internal: it is selected to derive the fulfilment
      // figure, the state and the dimension summary, all computed here so
      // the row ships a few small fields instead of every line.
      rows: result.rows.map(({ _count, lines, ...row }) => ({
        ...row,
        lineCount: _count.lines,
        receiptCount: _count.receipts,
        fulfilment: orderFulfilment(lines),
        state: orderState({ expectedAt: row.expectedAt, lines }, today),
        /** What the first line says the order is for; the row's one-line description. */
        designation: lines[0]?.designation ?? null,
        amount: orderAmount({ totalHt: row.totalHt, lines }),
        dimensions: orderDimensions(lines),
      })),
    };
  }

  /**
   * The header's figures, the state counts and the month bands, from one
   * scan of every order in the window that matches the search.
   *
   * A scan rather than aggregates, for three reasons that all come back to
   * the lines. The reception state is derived from them, so a state count
   * or a state filter has no column to query. The EUR figure cannot come
   * from `totalHt` alone: 35 of the 65 EUR orders are transport, whose
   * legacy template had no totals block, so their amount sits only on the
   * lines — summing the header column would report 573 270,33 € against a
   * real commitment of 764 433,65 €. And the bands sum per month, which
   * Prisma cannot group by. Where both figures exist they agree on all 521
   * orders (worst gap 0,01), so the line fallback is safe.
   *
   * It reads through Prisma rather than raw SQL so the search predicate is
   * the declaration's own — re-expressing it by hand is how a header figure
   * starts disagreeing with its list. It runs before the list's transaction
   * rather than inside it: a header figure on an admin screen, against a
   * few hundred small rows a year.
   *
   * What narrows what, so every number ignores only its own control:
   * - `stateIds`, the scope for the rows, is judged on the window and the
   *   search alone.
   * - `states` (the segmented control's counts) adds the category chip.
   * - `totals`, `waiting`, `late` and `months` add the state too: they
   *   describe exactly the rows the pager counts.
   */
  private async orderFigures(
    query: Omit<ListPurchaseOrdersInput, "period" | "from" | "to" | "state">,
    state: ListPurchaseOrdersInput["state"],
    window: Prisma.PurchaseOrderWhereInput | undefined,
    today: Date,
  ) {
    const search =
      query.search && typeof purchaseOrderListDeclaration.searchable === "function"
        ? purchaseOrderListDeclaration.searchable(query.search)
        : undefined;

    const orders = await this.prisma.purchaseOrder.findMany({
      where: { AND: [...(window ? [window] : []), ...(search ? [search] : [])] },
      select: {
        id: true,
        category: true,
        issuedAt: true,
        expectedAt: true,
        currency: true,
        totalHt: true,
        lines: { select: { quantity: true, receivedQuantity: true, total: true } },
      },
    });

    const judged = orders.map((order) => ({
      ...order,
      state: orderState(order, today),
      amount: orderAmount(order),
    }));

    const stateIds =
      state === "all" ? null : judged.filter((o) => stateMatches(o.state, state)).map((o) => o.id);

    const inCategory = judged.filter((o) => query.filter === "all" || o.category === query.filter);
    const states = {
      all: inCategory.length,
      waiting: inCategory.filter((o) => stateMatches(o.state, "waiting")).length,
      late: inCategory.filter((o) => stateMatches(o.state, "late")).length,
      received: inCategory.filter((o) => stateMatches(o.state, "received")).length,
    };

    const listed = inCategory.filter((o) => state === "all" || stateMatches(o.state, state));

    const totals = new Map<string, { total: number; count: number }>();
    const months = new Map<string, { count: number; sums: Map<string, number> }>();
    for (const order of listed) {
      const t = totals.get(order.currency) ?? { total: 0, count: 0 };
      totals.set(order.currency, { total: t.total + order.amount, count: t.count + 1 });
      // `YYYY-MM` in UTC, as `@db.Date` is read; an order always has a date.
      const month = order.issuedAt.toISOString().slice(0, 7);
      const band = months.get(month) ?? { count: 0, sums: new Map<string, number>() };
      band.count += 1;
      band.sums.set(order.currency, (band.sums.get(order.currency) ?? 0) + order.amount);
      months.set(month, band);
    }

    return {
      stateIds,
      states,
      totals: [...totals].map(([currency, t]) => ({ currency, ...t })),
      waiting: listed.filter((o) => stateMatches(o.state, "waiting")).length,
      late: listed.filter((o) => o.state === "late").length,
      // Newest month first, the order the list itself takes.
      months: [...months]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([month, band]) => ({
          month,
          count: band.count,
          sums: [...band.sums].map(([currency, total]) => ({ currency, total })),
        })),
    };
  }

  async orderById(id: string) {
    const [order, receiptsInUse] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.findUnique({
        where: { id },
        select: PURCHASE_ORDER_DETAIL_SELECT,
      }),
      this.prisma.goodsReceipt.count({ where: { orderId: id, ...receiptInUse } }),
    ]);
    if (!order) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found" });
    }
    const { _count, ...rest } = order;
    return {
      ...rest,
      lineCount: _count.lines,
      receiptCount: _count.receipts,
      /**
       * Receipts that freeze the order's lines and supplier (`receiptInUse`);
       * the form disables both while this is above zero, as `updateOrder`
       * would refuse them.
       */
      receiptsInUse,
      fulfilment: orderFulfilment(order.lines),
    };
  }

  async listReceipts(query: ListGoodsReceiptsInput) {
    const result = await runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) =>
          this.prisma.goodsReceipt.findMany({ ...args, select: GOODS_RECEIPT_SELECT }),
        count: (args) => this.prisma.goodsReceipt.count(args),
      },
      query,
      declaration: goodsReceiptListDeclaration,
      scope: {},
    });
    return {
      ...result,
      rows: result.rows.map(({ _count, ...row }) => ({ ...row, lineCount: _count.lines })),
    };
  }

  async receiptById(id: string) {
    const receipt = await this.prisma.goodsReceipt.findUnique({
      where: { id },
      select: GOODS_RECEIPT_DETAIL_SELECT,
    });
    if (!receipt) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Goods receipt not found" });
    }
    const { _count, ...rest } = receipt;
    return { ...rest, lineCount: _count.lines };
  }

  // ---------------------------------------------------------------------------
  // Purchase order write path
  // ---------------------------------------------------------------------------

  /**
   * Raises an order. The number is allocated here, not supplied: the counter
   * upsert and the insert share one transaction, so two concurrent creates
   * cannot take the same sequence.
   */
  async createOrder(input: CreatePurchaseOrderInput) {
    await this.assertSupplierAssignable(input.supplierId);
    this.assertPositionsUnique(input.lines);

    return this.prisma.$transaction(async (tx) => {
      const numero = await this.allocateOrderNumero(tx, input.category);
      const order = await tx.purchaseOrder.create({
        data: {
          ...this.orderHeader(input),
          category: input.category,
          numero,
          lines: { create: input.lines.map((line) => this.orderLineRow(line)) },
        },
        select: { id: true, numero: true },
      });

      await this.createMatchingReceipt(tx, order.id, input.category, input.supplierId);

      return { id: order.id, numero: order.numero };
    });
  }

  /**
   * The goods receipt that is born with its order.
   *
   * Every order gets exactly one, in the same transaction: the receipt is the
   * internal check-off sheet for that delivery, so an order without one has
   * nowhere to record what arrived. The legacy system did the same
   * (`createAutoGeneratedBonDeReceptionBoxes` and its eight siblings) and the
   * migrated data agrees — no order has more than one receipt.
   *
   * It starts empty and PENDING: a line per order line at zero received, and
   * `receivedAt` deliberately null, because nothing has arrived yet and a date
   * would claim otherwise. The operator finds this receipt, fills in what came
   * in, and the status follows from the quantities.
   *
   * A second delivery against the same order is still possible — the relation
   * is one-to-many — but it is raised by hand rather than born here.
   */
  private async createMatchingReceipt(
    tx: Prisma.TransactionClient,
    orderId: string,
    category: PurchaseCategory,
    supplierId: string,
  ) {
    const numero = await this.allocateReceiptNumero(tx, category);
    await tx.goodsReceipt.create({
      data: {
        numero,
        category,
        supplierId,
        orderId,
        // The day the sheet was raised; the reception date stays null until
        // something actually arrives.
        issuedAt: new Date(),
        receivedAt: null,
        ...this.emptyReceiptFigures(category),
        lines: { create: await this.emptyReceiptLines(tx, orderId, category) },
      },
      select: { id: true },
    });
  }

  /** What an untouched receipt's summary says: nothing has arrived. */
  private emptyReceiptFigures(category: PurchaseCategory) {
    return {
      status: category === "TRANSPORT" ? null : ("PENDING" as const),
      validated: false,
      // Null rather than 0 for transport, whose lines carry a price.
      receivedQuantity: category === "TRANSPORT" ? null : 0,
    };
  }

  /**
   * A receipt line per order line, at nothing received — the lines of the
   * receipt born with its order, and of an untouched receipt rebuilt when the
   * order's lines are replaced.
   *
   * Re-read rather than taken as an argument: the receipt copies the
   * designation and every dimension column, which a caller holding only ids
   * and positions could not supply.
   */
  private async emptyReceiptLines(
    tx: Prisma.TransactionClient,
    orderId: string,
    category: PurchaseCategory,
  ) {
    const ordered = await tx.purchaseOrderLine.findMany({
      where: { orderId },
      select: {
        id: true,
        position: true,
        designation: true,
        grammage: true,
        laize: true,
        length: true,
        width: true,
        height: true,
        thickness: true,
        filmType: true,
        colourCount: true,
      },
      orderBy: { position: "asc" },
    });
    return ordered.map(({ id, ...line }) => ({
      ...line,
      orderLineId: id,
      // Zero received, not null: nothing has come in yet, and the
      // difference between "none yet" and "not measured" matters.
      receivedQuantity: category === "TRANSPORT" ? null : 0,
    }));
  }

  /**
   * Edits an order. The category is fixed at creation — it picked the number
   * series, and `numero` encodes it. The lines and the supplier are editable
   * until a receipt against the order is IN USE: some line records a
   * quantity, a price or a note, or a purchase invoice names it
   * (`receiptInUse`). The untouched receipt every app-raised order is born
   * with does not count, or no order could ever be corrected.
   *
   * The lines guard is the important one. Lines are replaced wholesale, and
   * `GoodsReceiptLine.orderLineId` is `SetNull`, so replacing the lines of a
   * received order would quietly detach every receipt line from what it
   * received against — and nothing could put them back: a receipt line's only
   * pointer to the order is that column, and `position` is not unique. So it
   * is prevented rather than repaired. An untouched receipt holds nothing to
   * lose, so its lines are rebuilt from the new order lines in the same
   * transaction instead.
   *
   * The supplier follows the same rule for the same kind of reason: every
   * receipt carries a copy of it. Untouched receipts take the new one in the
   * same transaction; a receipt in use is a delivery that supplier made.
   *
   * The receipts are judged inside the transaction, under the order's row
   * lock (`lockOrder`), so a delivery recorded concurrently cannot slip in
   * between the check and the rebuild.
   *
   * Sending no `lines` key edits the header alone. The archived-supplier
   * check runs only when the supplier changes, so a notes-only save of an
   * order from a since-archived supplier still goes through.
   */
  async updateOrder(input: UpdatePurchaseOrderInput) {
    const { lines } = input;
    if (lines !== undefined) this.assertPositionsUnique(lines);

    return this.prisma.$transaction(async (tx) => {
      await this.lockOrder(tx, input.id);
      // Read under the lock, so the supplier compared against is the one
      // the receipts actually carry.
      const existing = await tx.purchaseOrder.findUnique({
        where: { id: input.id },
        select: { id: true, numero: true, category: true, supplierId: true },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found" });
      }
      if (input.category !== existing.category) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            `${existing.numero}'s category is fixed at creation: its number belongs to that ` +
            "category's series. Raise a new order in the other category instead.",
        });
      }
      const supplierChanged = input.supplierId !== existing.supplierId;
      if (supplierChanged) await this.assertSupplierAssignable(input.supplierId);

      if (lines !== undefined || supplierChanged) {
        const inUse = await tx.goodsReceipt.findMany({
          where: { orderId: input.id, ...receiptInUse },
          select: { numero: true },
          orderBy: { numero: "asc" },
        });
        if (inUse.length > 0) {
          const named = inUse.map((receipt) => receipt.numero).join(", ");
          throw new TRPCError({
            code: "CONFLICT",
            message:
              `${existing.numero} already has deliveries recorded on ${named}, so its ` +
              (lines !== undefined ? "lines" : "supplier") +
              " can no longer be changed. Clear or delete those receipts first, or edit " +
              "only the dates, address and notes.",
          });
        }
      }

      // From here every receipt of the order is untouched.
      if (lines !== undefined) {
        // Receipt lines first: deleting the order lines under them would
        // SetNull them into orphans rather than remove them.
        await tx.goodsReceiptLine.deleteMany({ where: { receipt: { orderId: input.id } } });
        await tx.purchaseOrderLine.deleteMany({ where: { orderId: input.id } });
        await tx.purchaseOrderLine.createMany({
          data: lines.map((line) => ({ orderId: input.id, ...this.orderLineRow(line) })),
        });
        const receipts = await tx.goodsReceipt.findMany({
          where: { orderId: input.id },
          select: { id: true },
        });
        const rebuilt = await this.emptyReceiptLines(tx, input.id, existing.category);
        await tx.goodsReceiptLine.createMany({
          data: receipts.flatMap((receipt) =>
            rebuilt.map((line) => ({ ...line, receiptId: receipt.id })),
          ),
        });
        await tx.goodsReceipt.updateMany({
          where: { orderId: input.id },
          data: this.emptyReceiptFigures(existing.category),
        });
      }
      if (supplierChanged) {
        await tx.goodsReceipt.updateMany({
          where: { orderId: input.id },
          data: { supplierId: input.supplierId },
        });
      }

      return tx.purchaseOrder.update({
        where: { id: input.id },
        data: this.orderHeader(input, lines),
        select: { id: true, numero: true },
      });
    });
  }

  /**
   * A hard delete, lines cascading, together with the order's untouched
   * receipts — the one born with it holds nothing but zeros. Refused while a
   * receipt is in use (`receiptInUse`): the delivery history is what the
   * order is evidence for. `GoodsReceipt.orderId` is `Restrict`, so a receipt
   * that appeared anyway surfaces as P2003 and is reported as a CONFLICT
   * rather than a 500.
   */
  async removeOrder(id: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockOrder(tx, id);
        const order = await tx.purchaseOrder.findUnique({
          where: { id },
          select: { id: true, numero: true },
        });
        if (!order) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found" });
        }
        const inUse = await tx.goodsReceipt.findMany({
          where: { orderId: id, ...receiptInUse },
          select: { numero: true },
          orderBy: { numero: "asc" },
        });
        if (inUse.length > 0) {
          const named = inUse.map((receipt) => receipt.numero).join(", ");
          throw new TRPCError({
            code: "CONFLICT",
            message:
              `${order.numero} has deliveries recorded on ${named}. ` +
              "Delete those first — the delivery history is what the order is evidence for.",
          });
        }
        await tx.goodsReceipt.deleteMany({ where: { orderId: id } });
        await tx.purchaseOrder.delete({ where: { id }, select: { id: true } });
        return { id: order.id, numero: order.numero };
      });
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2003") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A goods receipt was just recorded against this order — reload and try again",
        });
      }
      throw cause;
    }
  }

  // ---------------------------------------------------------------------------
  // Goods receipt write path
  // ---------------------------------------------------------------------------

  /**
   * Records a delivery against an order. `category` and `supplierId` are
   * copied from that order rather than taken from the payload, so the
   * denormalised copies cannot disagree with their source.
   *
   * Everything that reads what other receipts brought in — the over-delivery
   * check, the status, the order lines' totals, the siblings' statuses — runs
   * inside the transaction under the order's row lock. Read before it, two
   * concurrent 1 000 deliveries against a 1 000 line would each see nothing
   * received and both pass.
   */
  async createReceipt(input: CreateGoodsReceiptInput) {
    this.assertPositionsUnique(input.lines);

    return this.prisma.$transaction(async (tx) => {
      await this.lockOrder(tx, input.orderId);
      const order = await this.loadOrderForReceipt(tx, input.orderId);
      const matched = this.assertLinesBelongToOrder(input.lines, order.lines);
      const already = await this.assertWithinOrdered(tx, matched, order, null);
      const derived = this.receiptDerived(matched, order.category, already);

      const numero = await this.allocateReceiptNumero(tx, order.category);
      const receipt = await tx.goodsReceipt.create({
        data: {
          ...this.receiptHeader(input),
          numero,
          category: order.category,
          supplierId: order.supplierId,
          ...derived,
          lines: {
            create: matched.map((pair) => this.receiptLineRow(pair)),
          },
        },
        select: { id: true, numero: true, orderId: true },
      });
      await this.resync(tx, order, this.orderLineIdsOf(input.lines), receipt.id);
      return receipt;
    });
  }

  /**
   * Replaces a receipt's header and lines wholesale. The order it belongs to
   * cannot change: moving a receipt would strand the received quantities on
   * the old order's lines and leave the copied category and supplier wrong.
   *
   * Checked and derived under the order's row lock, as `createReceipt` is.
   * A receipt deleted, or an order line replaced, while this was in flight
   * surfaces as P2025/P2003 and is reported as such rather than as a 500.
   */
  async updateReceipt(input: UpdateGoodsReceiptInput) {
    this.assertPositionsUnique(input.lines);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await this.loadReceiptForWrite(tx, input.id);
        if (existing.orderId !== input.orderId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              `${existing.numero} was received against another order and cannot be moved. ` +
              "Delete it and record the delivery against the right order.",
          });
        }

        const order = await this.loadOrderForReceipt(tx, existing.orderId);
        const matched = this.assertLinesBelongToOrder(input.lines, order.lines);
        const already = await this.assertWithinOrdered(tx, matched, order, existing.id);
        const derived = this.receiptDerived(matched, order.category, already);

        // The union of what this receipt pointed at before and what it points
        // at now: recomputing only the new ids would leave a line stale behind
        // a receipt line that moved from one order line to another.
        const touched = [
          ...new Set([...existing.orderLineIds, ...this.orderLineIdsOf(input.lines)]),
        ];

        await tx.goodsReceiptLine.deleteMany({ where: { receiptId: input.id } });
        await tx.goodsReceiptLine.createMany({
          data: matched.map((pair) => ({ receiptId: input.id, ...this.receiptLineRow(pair) })),
        });
        const receipt = await tx.goodsReceipt.update({
          where: { id: input.id },
          data: { ...this.receiptHeader(input), ...derived },
          select: { id: true, numero: true, orderId: true },
        });
        await this.resync(tx, order, touched, receipt.id);
        return receipt;
      });
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError) {
        if (cause.code === "P2025") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Goods receipt not found" });
        }
        if (cause.code === "P2003") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "The purchase order's lines changed while this receipt was open — reload and try again",
          });
        }
      }
      throw cause;
    }
  }

  /**
   * A hard delete, lines cascading — and the received quantities on the order
   * go back down, and the other receipts' statuses are re-derived.
   *
   * The `orderLineId`s are read BEFORE the delete: the cascade removes the
   * receipt lines without this service running, so after the delete there is
   * nothing left to tell us which order lines to recompute.
   *
   * Refused while a purchase invoice names the receipt. `PurchaseInvoice.receiptId`
   * is `SetNull`, so deleting would quietly unlink a financial record — data
   * loss dressed up as a successful delete, the same reason
   * `SupplierFamilyService.remove` refuses a family still in use. The
   * condition is repeated in the delete's own `where`, so an invoice linked
   * between the check and the delete makes the delete match nothing.
   */
  async removeReceipt(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const receipt = await this.loadReceiptForWrite(tx, id);
      const invoices = await tx.purchaseInvoice.findMany({
        where: { receiptId: id },
        select: { numero: true },
      });
      if (invoices.length > 0) {
        const named = invoices.map((invoice) => invoice.numero).join(", ");
        throw new TRPCError({
          code: "CONFLICT",
          message:
            `${receipt.numero} is billed on invoice ${named}. ` +
            "Point that invoice elsewhere before deleting the delivery it settles.",
        });
      }

      const { count } = await tx.goodsReceipt.deleteMany({
        where: { id, invoices: { none: {} } },
      });
      if (count !== 1) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            `${receipt.numero} was just billed on an invoice. ` +
            "Point that invoice elsewhere before deleting the delivery it settles.",
        });
      }
      const order = await this.loadOrderForReceipt(tx, receipt.orderId);
      await this.resync(tx, order, receipt.orderLineIds, null);
      return { id: receipt.id, numero: receipt.numero, orderId: receipt.orderId };
    });
  }

  // ---- write helpers --------------------------------------------------------

  /**
   * The order's editable header columns, with the totals derived from the
   * lines. `category` is not among them: it is written once, by `createOrder`.
   */
  private orderHeader(
    input: CreatePurchaseOrderInput | UpdatePurchaseOrderInput,
    lines: readonly PurchaseOrderLineInput[] | undefined = input.lines,
  ) {
    return {
      supplierId: input.supplierId,
      issuedAt: this.day(input.issuedAt),
      expectedAt: input.expectedAt ? this.day(input.expectedAt) : null,
      currency: input.currency,
      address: input.address ?? null,
      notes: input.notes ?? null,
      createdByName: input.createdByName ?? null,
      ...this.orderTotals(lines),
    };
  }

  /**
   * `totalHt` and `totalQuantity`, summed from the lines so a stored total
   * can never contradict them. Both stay null when there are no lines to sum
   * — a header edit that does not resend the lines leaves the figures alone.
   *
   * The migrated transport orders carry null totals (only their lines hold an
   * amount), and summing gives those a figure where they had none. That is
   * the intended change: an order with priced lines has a total.
   */
  private orderTotals(lines: readonly PurchaseOrderLineInput[] | undefined) {
    if (lines === undefined) return {};
    return {
      totalHt: lines.reduce((sum, line) => sum + this.orderLineTotal(line), 0),
      totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    };
  }

  /**
   * One order line as stored, with its total computed here rather than
   * trusted from the input.
   *
   * Plate (cliché) lines price per cm², so their total is
   * `quantity × unitPrice × unitSurface`; everything else is the plain
   * product. This mirrors what the legacy figures do — see the model comment
   * on `PurchaseOrderLine` — and is the one place the rule lives.
   */
  private orderLineRow(line: PurchaseOrderLineInput) {
    return {
      position: line.position,
      designation: line.designation,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      total: this.orderLineTotal(line),
      grammage: line.grammage ?? null,
      laize: line.laize ?? null,
      length: line.length ?? null,
      width: line.width ?? null,
      height: line.height ?? null,
      thickness: line.thickness ?? null,
      filmType: line.filmType ?? null,
      colourCount: line.colourCount ?? null,
      unitSurface: line.unitSurface ?? null,
    };
  }

  private orderLineTotal(line: PurchaseOrderLineInput): number {
    const surface = line.unitSurface ?? null;
    return surface === null
      ? line.quantity * line.unitPrice
      : line.quantity * line.unitPrice * surface;
  }

  /** The receipt's own header columns; the derived figures are added separately. */
  private receiptHeader(input: CreateGoodsReceiptInput | UpdateGoodsReceiptInput) {
    return {
      orderId: input.orderId,
      issuedAt: this.day(input.issuedAt),
      receivedAt: input.receivedAt ? this.day(input.receivedAt) : null,
      invoiceNumber: input.invoiceNumber ?? null,
      invoiceUrl: input.invoiceUrl ?? null,
      notes: input.notes ?? null,
      updatedByName: input.updatedByName ?? null,
    };
  }


  /**
   * One receipt line as stored. The designation and dimensions are copied
   * from the order line rather than sent: they describe what was ordered, and
   * a receipt disagreeing with its order about the grammage of the paper
   * would be recording a different product.
   */
  private receiptLineRow({ line, ordered }: MatchedLine) {
    return {
      orderLineId: line.orderLineId,
      position: line.position,
      designation: ordered.designation,
      receivedQuantity: line.receivedQuantity ?? null,
      unitPrice: line.unitPrice ?? null,
      grammage: ordered.grammage,
      laize: ordered.laize,
      length: ordered.length,
      width: ordered.width,
      height: ordered.height,
      thickness: ordered.thickness,
      filmType: ordered.filmType,
      colourCount: ordered.colourCount,
      notes: line.notes ?? null,
    };
  }

  /**
   * The receipt's own summary of its lines: the quantity that arrived and the
   * reception status.
   *
   * `receivedQuantity` is NULL, not 0, when no line carries a quantity — the
   * transport case, whose lines hold a price instead. A service is not
   * delivered in units, and the lists render the absent figure differently
   * from a zero one.
   *
   * `status` is likewise NULL for transport. Elsewhere it follows the lines:
   * nothing arrived is PENDING, every line it touches now fully delivered is
   * COMPLETE, and anything between is PARTIAL — compared with
   * `RECEIPT_TOLERANCE` so Float noise in the figures does not read as a
   * shortfall.
   *
   * Computed on write — this receipt's, or a sibling's on the same order
   * lines (`resync`). A migrated row keeps the status its operator recorded
   * until one of those happens; at the chosen tolerance no stored status
   * actually disagrees with its lines, so nothing is silently corrected
   * behind anyone's back.
   */
  private receiptDerived(
    matched: readonly MatchedLine[],
    category: PurchaseCategory,
    alreadyReceived: ReadonlyMap<string, number>,
  ): { receivedQuantity: number | null; status: ReceiptStatus | null; validated: boolean } {
    const quantities = matched
      .map(({ line }) => line.receivedQuantity)
      .filter((quantity): quantity is number => quantity !== null && quantity !== undefined);

    const receivedQuantity =
      quantities.length === 0 ? null : quantities.reduce((sum, quantity) => sum + quantity, 0);

    if (category === "TRANSPORT") {
      // A service is neither received in parts nor validated against a
      // quantity, so both stay as the legacy transport rows have them.
      return { receivedQuantity, status: null, validated: false };
    }
    const status = this.deriveStatus(
      matched.map(({ line, ordered }) => ({
        received: line.receivedQuantity ?? 0,
        ordered: ordered.quantity,
        already: alreadyReceived.get(ordered.id) ?? 0,
      })),
    );
    return {
      receivedQuantity,
      status,
      // Derived, not ticked: the receipt is validated exactly when every line
      // it touches is fully delivered. Legacy kept a separate sign-off that
      // *refused* to validate unless the quantities matched; deriving it
      // removes the state where the flag and the figures disagree, at the
      // cost of an explicit human sign-off.
      validated: status === "COMPLETE",
    };
  }

  /**
   * Nothing arrived on this note is PENDING. Otherwise the question is
   * whether the order lines this note touches are now fully delivered —
   * counting what the order's other receipts brought in, not just this
   * note's own slice. If every one of them is, COMPLETE; if any is still
   * short, PARTIAL.
   *
   * Cumulative by necessity: a first delivery of 400 against 1000 followed
   * by one of 600 leaves nothing outstanding, and the second note is what
   * completes the order. Judged per line rather than on the totals, so a
   * note that over-delivers one line and short-delivers another is partial
   * rather than averaging out to complete. Every comparison allows
   * `RECEIPT_TOLERANCE`, so Float noise neither reads as a shortfall nor
   * hides one.
   *
   * A note can therefore be COMPLETE while the order as a whole still has
   * untouched lines — which is what a delivery note says: this consignment
   * finished what it was for.
   *
   * `ordered` is null for a receipt line whose order line is gone (the FK is
   * `SetNull`); such a line can arrive but cannot be short.
   */
  private deriveStatus(
    entries: readonly { received: number; ordered: number | null; already: number }[],
  ): ReceiptStatus {
    const arrived = entries.reduce((sum, entry) => sum + entry.received, 0);
    if (arrived <= RECEIPT_TOLERANCE) return "PENDING";

    const short = entries.some(
      (entry) =>
        entry.ordered !== null &&
        entry.already + entry.received < entry.ordered - RECEIPT_TOLERANCE,
    );
    return short ? "PARTIAL" : "COMPLETE";
  }

  /**
   * After a receipt write: recompute the touched order lines' received
   * totals, then re-derive the status of every OTHER receipt on those lines.
   *
   * A sibling's status counts what the rest of the order brought in, so
   * editing or deleting one delivery note can complete, or un-complete,
   * another — left alone, the second 600 of a 400 + 600 order would still
   * read COMPLETE after the 400 was deleted. Only rows whose figures change
   * are written. Transport receipts carry no status, so there is nothing to
   * re-derive.
   *
   * `selfId` is the receipt just written (its own derivation is already
   * current), or null after a delete.
   */
  private async resync(
    tx: Prisma.TransactionClient,
    order: { id: string; category: PurchaseCategory; lines: readonly OrderLineFacts[] },
    touched: readonly string[],
    selfId: string | null,
  ) {
    const totals = await this.syncReceivedQuantities(tx, touched);
    if (order.category === "TRANSPORT" || touched.length === 0) return;

    const siblings = await tx.goodsReceipt.findMany({
      where: {
        orderId: order.id,
        ...(selfId === null ? {} : { id: { not: selfId } }),
        lines: { some: { orderLineId: { in: [...touched] } } },
      },
      select: {
        id: true,
        status: true,
        validated: true,
        lines: { select: { orderLineId: true, receivedQuantity: true } },
      },
    });

    const orderLines = new Map(order.lines.map((line) => [line.id, line]));
    for (const sibling of siblings) {
      const status = this.deriveStatus(
        sibling.lines.map((line) => {
          const received = line.receivedQuantity ?? 0;
          const ordered = line.orderLineId === null ? undefined : orderLines.get(line.orderLineId);
          if (!ordered) return { received, ordered: null, already: 0 };
          // The line's total after this write, less the sibling's own share.
          // Lines this write did not touch still hold the total read under
          // the lock.
          const total = totals.get(ordered.id) ?? ordered.receivedQuantity;
          return { received, ordered: ordered.quantity, already: total - received };
        }),
      );
      const validated = status === "COMPLETE";
      if (status === sibling.status && validated === sibling.validated) continue;
      await tx.goodsReceipt.update({
        where: { id: sibling.id },
        data: { status, validated },
        select: { id: true },
      });
    }
  }

  /**
   * Recomputes `PurchaseOrderLine.receivedQuantity` for the given lines from
   * the receipt lines that point at them, and returns the new totals.
   *
   * A recompute, not a delta. `InkService` moves its balance by the
   * difference because an ink usage line keeps its identity across an edit;
   * receipt lines do not — they are deleted and recreated — so there is no
   * "before" quantity to diff against. A recompute is also self-healing: a
   * missed call shows up as one stale figure the next write corrects, where a
   * missed delta would compound silently.
   *
   * Must run inside the caller's transaction, and for a delete must be given
   * the ids read BEFORE the rows went away.
   */
  private async syncReceivedQuantities(
    tx: Prisma.TransactionClient,
    orderLineIds: readonly string[],
  ): Promise<Map<string, number>> {
    const totals = new Map<string, number>();
    if (orderLineIds.length === 0) return totals;

    const sums = await tx.goodsReceiptLine.groupBy({
      by: ["orderLineId"],
      where: { orderLineId: { in: [...orderLineIds] } },
      _sum: { receivedQuantity: true },
    });
    const received = new Map(
      sums.map((row) => [row.orderLineId, row._sum.receivedQuantity ?? 0] as const),
    );

    for (const orderLineId of orderLineIds) {
      const total = received.get(orderLineId) ?? 0;
      totals.set(orderLineId, total);
      await tx.purchaseOrderLine.update({
        where: { id: orderLineId },
        data: { receivedQuantity: total },
        select: { id: true },
      });
    }
    return totals;
  }

  /** Allocates the next order number for a category. Caller supplies the transaction. */
  private async allocateOrderNumero(tx: Prisma.TransactionClient, category: PurchaseCategory) {
    return this.allocate(tx, "PurchaseOrderCounter", ORDER_PREFIX[category]);
  }

  private async allocateReceiptNumero(tx: Prisma.TransactionClient, category: PurchaseCategory) {
    return this.allocate(tx, "GoodsReceiptCounter", RECEIPT_PREFIX[category]);
  }

  /**
   * One atomic counter upsert, as the sales invoice and shipment numbers do
   * it: the row lock the UPDATE takes serialises concurrent creates, a prefix
   * never seen before self-seeds at 1, and the `@unique` on `numero` is the
   * backstop.
   *
   * The table name is interpolated as raw SQL rather than bound, so it is
   * taken only from the two private callers above — never from input.
   */
  private async allocate(
    tx: Prisma.TransactionClient,
    table: "PurchaseOrderCounter" | "GoodsReceiptCounter",
    prefix: string,
  ): Promise<string> {
    const rows =
      table === "PurchaseOrderCounter"
        ? await tx.$queryRaw<{ n: number }[]>`
            INSERT INTO "PurchaseOrderCounter" ("prefix", "next") VALUES (${prefix}, 2)
            ON CONFLICT ("prefix") DO UPDATE SET "next" = "PurchaseOrderCounter"."next" + 1
            RETURNING "next" - 1 AS n`
        : await tx.$queryRaw<{ n: number }[]>`
            INSERT INTO "GoodsReceiptCounter" ("prefix", "next") VALUES (${prefix}, 2)
            ON CONFLICT ("prefix") DO UPDATE SET "next" = "GoodsReceiptCounter"."next" + 1
            RETURNING "next" - 1 AS n`;

    const sequence = rows[0]?.n;
    if (sequence === undefined) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Counter returned no row" });
    }
    return formatNumero(prefix, sequence);
  }

  /**
   * Takes the order's row lock for the rest of the transaction.
   *
   * Every write that reads what the order's receipts hold and then acts on
   * it — a receipt created, edited or deleted, the order's lines or supplier
   * changed, the order deleted — takes this first, so those writes on one
   * order run one at a time. The order row rather than its lines, because
   * `updateOrder` replaces the lines: a lock on a line that is about to be
   * deleted protects nothing. Reads that follow it in the same transaction
   * see everything committed before the lock was granted (READ COMMITTED,
   * Postgres' and Prisma's default), which is what makes the checks after
   * it current. A missing order locks nothing; the caller's own read reports
   * it.
   */
  private async lockOrder(tx: Prisma.TransactionClient, orderId: string) {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${orderId} FOR UPDATE`;
  }

  /**
   * The receipt about to be edited or deleted, with its order locked and its
   * lines read after the lock. `orderId` is safe to read before it: a
   * receipt never moves to another order.
   */
  private async loadReceiptForWrite(tx: Prisma.TransactionClient, id: string) {
    const head = await tx.goodsReceipt.findUnique({ where: { id }, select: { orderId: true } });
    if (!head) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Goods receipt not found" });
    }
    await this.lockOrder(tx, head.orderId);
    const receipt = await tx.goodsReceipt.findUnique({
      where: { id },
      select: { id: true, numero: true, orderId: true, lines: { select: { orderLineId: true } } },
    });
    if (!receipt) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Goods receipt not found" });
    }
    const { lines, ...rest } = receipt;
    return {
      ...rest,
      orderLineIds: [
        ...new Set(
          lines.map((line) => line.orderLineId).filter((lineId): lineId is string => lineId !== null),
        ),
      ],
    };
  }

  /**
   * The order a receipt is being recorded against, with the lines it may
   * receive. Called after `lockOrder`, so `receivedQuantity` is current.
   */
  private async loadOrderForReceipt(tx: Prisma.TransactionClient, orderId: string) {
    const order = await tx.purchaseOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        numero: true,
        category: true,
        supplierId: true,
        lines: {
          select: {
            id: true,
            position: true,
            designation: true,
            quantity: true,
            receivedQuantity: true,
            grammage: true,
            laize: true,
            length: true,
            width: true,
            height: true,
            thickness: true,
            filmType: true,
            colourCount: true,
          },
        },
      },
    });
    if (!order) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "That purchase order no longer exists",
      });
    }
    return order;
  }

  /** The supplier must exist and not be archived — the picker must not offer one we reject. */
  private async assertSupplierAssignable(supplierId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { name: true, active: true },
    });
    if (!supplier) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "That supplier no longer exists" });
    }
    if (!supplier.active) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${supplier.name} is archived and cannot be ordered from`,
      });
    }
  }

  /**
   * Positions must be unique: nothing in the schema enforces it, and two
   * line 3s make `orderBy: { position: "asc" }` unstable, so the same list
   * can come back in a different order each time it is read.
   */
  private assertPositionsUnique(lines: readonly { position: number }[]) {
    const seen = new Set(lines.map((line) => line.position));
    if (seen.size !== lines.length) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Line positions must be unique" });
    }
  }

  /**
   * Every receipt line must receive against a line of the order being
   * received, and each order line at most once. Returns each receipt line
   * paired with its order line, so nothing downstream looks it up again and
   * has to allow for a miss this has already ruled out.
   */
  private assertLinesBelongToOrder(
    lines: readonly GoodsReceiptLineInput[],
    orderLines: readonly OrderLineFacts[],
  ): MatchedLine[] {
    const known = new Map(orderLines.map((line) => [line.id, line]));
    const matched = lines.map((line) => {
      const ordered = known.get(line.orderLineId);
      if (!ordered) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Line ${line.position} does not belong to this order`,
        });
      }
      return { line, ordered };
    });
    const perOrderLine = new Set(lines.map((line) => line.orderLineId));
    if (perOrderLine.size !== lines.length) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Two lines receive against the same order line — combine them into one",
      });
    }
    return matched;
  }

  /**
   * Refuses a delivery that would take an order line past what was ordered,
   * counting what the order's other receipts already brought in.
   *
   * The comparison allows `RECEIPT_TOLERANCE`, because six migrated MISC
   * lines already exceed their order by 0.004–0.005 — Float rounding in the
   * legacy figures, not over-deliveries. An exact test would make those six
   * receipts un-editable while catching nothing real.
   *
   * `excludeReceiptId` is the receipt being edited: its own current lines
   * must not count against the quantity it is about to replace them with.
   * Runs in the caller's transaction after `lockOrder`, so no concurrent
   * delivery can land between this sum and the write it guards.
   *
   * Returns what the other receipts brought in, per order line, so the status
   * derivation can reuse it rather than issuing the same aggregate again.
   */
  private async assertWithinOrdered(
    tx: Prisma.TransactionClient,
    matched: readonly MatchedLine[],
    order: { numero: string },
    excludeReceiptId: string | null,
  ): Promise<ReadonlyMap<string, number>> {
    const already = new Map<string, number>();
    if (matched.length === 0) return already;

    const elsewhere = await tx.goodsReceiptLine.groupBy({
      by: ["orderLineId"],
      where: {
        orderLineId: { in: matched.map(({ ordered }) => ordered.id) },
        ...(excludeReceiptId === null ? {} : { receiptId: { not: excludeReceiptId } }),
      },
      _sum: { receivedQuantity: true },
    });
    for (const row of elsewhere) {
      if (row.orderLineId !== null) already.set(row.orderLineId, row._sum.receivedQuantity ?? 0);
    }

    for (const { line, ordered } of matched) {
      const total = (already.get(ordered.id) ?? 0) + (line.receivedQuantity ?? 0);
      if (total > ordered.quantity + RECEIPT_TOLERANCE) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            `Line ${line.position} would bring ${format(total)} against ` +
            `${format(ordered.quantity)} ordered on ${order.numero} ` +
            `(line ${ordered.position}, ${ordered.designation}).`,
        });
      }
    }
    return already;
  }

  private orderLineIdsOf(lines: readonly GoodsReceiptLineInput[]): string[] {
    return [...new Set(lines.map((line) => line.orderLineId))];
  }

  /** A bare YYYY-MM-DD is UTC midnight of that day, as the `@db.Date` columns store it. */
  private day(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }
}

/** The order-line facts a receipt copies from and is checked against. */
interface OrderLineFacts {
  id: string;
  position: number;
  designation: string;
  quantity: number;
  /** What every receipt has brought in so far, as last synced. */
  receivedQuantity: number;
  grammage: number | null;
  laize: number | null;
  length: number | null;
  width: number | null;
  height: number | null;
  thickness: number | null;
  filmType: "STRETCH_FILM" | "THERMO_PVC_STRETCH_FILM" | null;
  colourCount: number | null;
}

/** A receipt line with the order line it receives against. */
interface MatchedLine {
  line: GoodsReceiptLineInput;
  ordered: OrderLineFacts;
}

/**
 * A receipt that holds something an edit of its order would destroy: a line
 * recording a quantity, a price or a note, or a purchase invoice billing it.
 * Every other receipt — above all the empty one each order is born with
 * (`createMatchingReceipt`) — can have its lines rebuilt, its supplier
 * replaced, or be deleted with its order without losing anything.
 */
const receiptInUse = {
  OR: [
    { invoices: { some: {} } },
    {
      lines: {
        some: {
          OR: [
            { receivedQuantity: { gt: 0 } },
            { unitPrice: { not: null } },
            { notes: { not: null } },
          ],
        },
      },
    },
  ],
} satisfies Prisma.GoodsReceiptWhereInput;

/** Quantities in messages read as the operator typed them, not as raw floats. */
const figures = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
const format = (value: number) => figures.format(value);
