import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
  AddPurchaseInvoiceDocumentInput,
  CreatePurchaseInvoiceInput,
  CreateSalesInvoiceInput,
  DiscardSalesInvoiceDraftInput,
  InvoiceLineInput,
  InvoiceableOrdersInput,
  IssueSalesInvoiceInput,
  ProductMention,
  RecordPurchasePaymentInput,
  RemoveOrderFromSalesInvoiceInput,
  SalesInvoiceLineInput,
  UpdatePurchaseInvoiceInput,
  UpdateSalesInvoiceDraftInput,
} from "@repo/api-contract";
import {
  defaultTaxPct,
  describeProductSpec,
  invoiceLineFigures,
  invoiceTotals,
  plannedParcels,
  plantDay,
  productSpecFromRow,
} from "@repo/api-contract";
import { Prisma } from "../generated/prisma/client.js";
import { runListQuery } from "../list/list-query";
import { OrderService, type Db } from "../order/order.service";
import { SALES_INVOICE_PDF_SELECT, toSalesInvoiceModel } from "../pdf/sales-invoice.model";
import { PrismaService } from "../prisma.service";
import { StorageService } from "../storage/storage.service";
import { ensureDefaultSalesInvoiceVersion } from "../template/template.defaults";
import type { SessionUser } from "../trpc/trpc";
import {
  PURCHASE_INVOICE_DETAIL_SELECT,
  PURCHASE_INVOICE_SELECT,
  SALES_INVOICE_DETAIL_SELECT,
  SALES_INVOICE_SELECT,
  UNPAID_WHERE,
  isOverdue,
  overdueWhere,
  paymentState,
  salesOverdueWhere,
  purchaseInvoiceListDeclaration,
  purchaseInvoicePeriodScope,
  salesInvoiceListDeclaration,
  salesInvoicePeriodScope,
  todayUtc,
  type ListPurchaseInvoicesInput,
  type ListSalesInvoicesInput,
} from "./invoice.list";

/**
 * The note an order's `INVOICED -> INVOICEABLE` move carries when an edit of
 * the draft drops its line — that reopen requires one, and the editor has no
 * field for it. The order page's "Remove from draft invoice" asks for its own.
 */
const REMOVED_FROM_DRAFT_NOTE = "removed from the draft invoice";

/** What attaching an order, and the order picker, read off it. */
const INVOICEABLE_ORDER_SELECT = {
  id: true,
  numero: true,
  status: true,
  clientId: true,
  market: true,
  quantityUnit: true,
  piecesPerParcel: true,
  kilosPerParcel: true,
  finalParcelPrice: true,
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

/** What every draft mutation needs off the invoice before deciding anything. */
const DRAFT_SELECT = {
  id: true,
  numero: true,
  status: true,
  clientId: true,
  currency: true,
  totalTtc: true,
  lines: {
    select: {
      id: true,
      position: true,
      orderId: true,
      mention: true,
      quantity: true,
      // The figures `refreshFromPackaging` recomputes a line's total from.
      unitPrice: true,
      discountPct: true,
      taxPct: true,
      order: { select: { numero: true } },
    },
    orderBy: { position: "asc" as const },
  },
} as const;

/**
 * Purchase invoices (what suppliers bill us) and sales invoices (what we bill
 * customers).
 *
 * Purchase invoices are still read-only migrated history. Sales invoices are
 * the write path from docs/sales-invoice-plan.md: a draft billing one or more
 * of a client's `INVOICEABLE` orders (and any typed lines), edited, then
 * issued — at which point it takes its number from `SalesInvoiceCounter` and
 * freezes. Every mutation that touches
 * an order's status goes through `OrderService.transition` on the same
 * transaction, so the invoice and the lifecycle can never disagree.
 */
/**
 * "CMD-141", or "CMD-141, CMD-142" — the order(s) an invoice bills, in line
 * order without repeats; failing any, what the first line sells. Empty when
 * a draft has no lines yet.
 */
function invoiceSubject(
  lines: ReadonlyArray<{ product: string | null; order: { numero: string } | null }>,
): string | null {
  const orders = [...new Set(lines.flatMap((line) => (line.order ? [line.order.numero] : [])))];
  if (orders.length > 0) return orders.join(", ");
  return lines[0]?.product ?? null;
}

/**
 * The clients of the orders an invoice bills, in line order without
 * repeats — what a row shows when the invoice bills several and so names
 * no client of its own.
 */
function orderClients(
  lines: ReadonlyArray<{ order: { client: { id: string; name: string } | null } | null }>,
): { id: string; name: string }[] {
  const seen = new Map<string, { id: string; name: string }>();
  for (const line of lines) {
    const client = line.order?.client;
    if (client && !seen.has(client.id)) seen.set(client.id, client);
  }
  return [...seen.values()];
}

@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
    private readonly storage: StorageService,
  ) {}

  async listPurchase(input: ListPurchaseInvoicesInput) {
    // The period is scope, not a facet, as on the sales side: `runListQuery`
    // ANDs scope first, so the payment chips keep counting inside the
    // window rather than across all time.
    const { period, from, to, ...query } = input;
    const today = todayUtc();
    // One "today" per request, so rows, total, chips, each row's badge and
    // the overdue tile agree on which invoices are overdue.
    const declaration = purchaseInvoiceListDeclaration(today);
    const scope = purchaseInvoicePeriodScope({ period, from, to }) ?? {};

    const [result, figures] = await Promise.all([
      runListQuery({
        prisma: this.prisma,
        delegate: {
          findMany: (args) =>
            this.prisma.purchaseInvoice.findMany({ ...args, select: PURCHASE_INVOICE_SELECT }),
          count: (args) => this.prisma.purchaseInvoice.count(args),
        },
        query,
        declaration,
        scope,
      }),
      this.purchaseFigures(query, declaration, scope, today),
    ]);

    return {
      ...result,
      ...figures,
      rows: result.rows.map(({ _count, receipt, lines, ...row }) => ({
        ...row,
        lineCount: _count.lines,
        paymentState: paymentState(row, today),
        subject:
          receipt?.order?.numero ??
          receipt?.numero ??
          row.category ??
          lines[0]?.product ??
          lines[0]?.description ??
          null,
      })),
    };
  }

  /**
   * The header's figures and the month bands, narrowed exactly as the rows
   * are (window, search, active segment), so nothing on the page describes
   * a different set than the list beneath it. Same shape and same trade as
   * the sales side (`salesFigures`): one `groupBy` by day and currency
   * beside the list's transaction, days folded into months here.
   *
   * - `totals`: what the listed invoices come to per currency. Invoices
   *   recorded without a currency are a group of their own
   *   (`currency: null`) rather than dropped: 64 migrated rows carry none,
   *   and a sum that silently left them out would under-report what
   *   suppliers billed. The UI shows them as a tile of their own.
   * - `unpaid`, `overdue`: what we still owe, and what is past its term.
   * - `months`: the same sums per month of issue.
   */
  private async purchaseFigures(
    query: Omit<ListPurchaseInvoicesInput, "period" | "from" | "to">,
    declaration: ReturnType<typeof purchaseInvoiceListDeclaration>,
    scope: Prisma.PurchaseInvoiceWhereInput,
    today: Date,
  ) {
    const search =
      query.search && typeof declaration.searchable === "function"
        ? declaration.searchable(query.search)
        : undefined;
    const facet = query.filter === "all" ? undefined : declaration.facets[query.filter];
    const where: Prisma.PurchaseInvoiceWhereInput = {
      AND: [scope, ...(search ? [search] : []), ...(facet ? [facet] : [])],
    };

    const [groups, unpaid, overdue] = await Promise.all([
      this.prisma.purchaseInvoice.groupBy({
        by: ["issuedAt", "currency"],
        where,
        _sum: { totalTtc: true },
        _count: { _all: true },
      }),
      this.prisma.purchaseInvoice.count({ where: { AND: [where, UNPAID_WHERE] } }),
      this.prisma.purchaseInvoice.count({ where: { AND: [where, overdueWhere(today)] } }),
    ]);

    const totals = new Map<string | null, { total: number; count: number }>();
    const months = new Map<string | null, { count: number; sums: Map<string | null, number> }>();
    for (const group of groups) {
      const amount = group._sum.totalTtc ?? 0;
      const t = totals.get(group.currency) ?? { total: 0, count: 0 };
      totals.set(group.currency, { total: t.total + amount, count: t.count + group._count._all });
      // `YYYY-MM` in UTC, as `@db.Date` is read; an invoice recorded without
      // a date (none today) would band under `null`.
      const month = group.issuedAt === null ? null : group.issuedAt.toISOString().slice(0, 7);
      const band = months.get(month) ?? { count: 0, sums: new Map<string | null, number>() };
      band.count += group._count._all;
      band.sums.set(group.currency, (band.sums.get(group.currency) ?? 0) + amount);
      months.set(month, band);
    }

    return {
      totals: [...totals].map(([currency, t]) => ({ currency, ...t })),
      unpaid,
      overdue,
      // Newest month first, an undated band last of all.
      months: [...months]
        .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : b.localeCompare(a)))
        .map(([month, band]) => ({
          month,
          count: band.count,
          sums: [...band.sums].map(([currency, total]) => ({ currency, total })),
        })),
    };
  }

  async purchaseById(id: string) {
    const invoice = await this.prisma.purchaseInvoice.findUnique({
      where: { id },
      select: PURCHASE_INVOICE_DETAIL_SELECT,
    });
    if (!invoice) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
    }
    const { _count, legacyReceiptId, ...rest } = invoice;
    return {
      ...rest,
      // A BigInt has no JSON form and there is no transformer on the tRPC
      // link, so it goes out as a string — it is a reference, not a number.
      legacyReceiptId: legacyReceiptId === null ? null : legacyReceiptId.toString(),
      lineCount: _count.lines,
      paymentState: paymentState(rest, todayUtc()),
    };
  }

  /**
   * A new draft: the orders it bills, one line each — of one client or of
   * several — and any typed lines billing something else (the ordinary case
   * in the migrated data — 314 of 315 lines name no order).
   *
   * The client is derived from the orders (`billedClient`); only an invoice
   * of typed lines alone takes the one the caller picked. Each order line
   * attaches its order — `attachOrders` checks it and moves it to
   * `INVOICED` — after the insert, because the transition's guard looks for
   * the DRAFT line. One transaction, so an order that fails its checks takes
   * the whole invoice with it.
   */
  async createSales(actor: SessionUser, input: CreateSalesInvoiceInput) {
    const orderIds = this.settleOrderLines([], input.lines);
    if (orderIds.length === 0) {
      if (!input.clientId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Choose the client this invoice bills" });
      }
      await this.assertClientBillable(input.clientId);
    }
    return this.prisma.$transaction(async (tx) => {
      const clientId = await this.billedClient(orderIds, input.clientId ?? null, tx);
      const invoice = await tx.salesInvoice.create({
        data: {
          status: "DRAFT",
          createdById: actor.id,
          clientId,
          currency: input.currency ?? null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          paymentMethod: input.paymentMethod ?? null,
          category: input.category ?? null,
          documents: [],
          ...invoiceTotals(input.lines),
          lines: { create: input.lines.map((line) => this.lineRow(line)) },
        },
        // `numero` is null until issued, so the caller gets the id to navigate
        // to; the toast names the client instead of a number that does not
        // exist yet.
        select: { id: true, clientId: true },
      });
      await this.attachOrders(actor, invoice.id, orderIds, tx);
      return invoice;
    });
  }

  /**
   * A client who can be billed a new invoice. Mirrors
   * `ProductService.assertClientAssignable`: `BAD_REQUEST` for both cases,
   * since the client id comes from a picker that should never have offered
   * either.
   *
   * Archived clients are refused on a *new* invoice only. The column stays
   * nullable and the existing invoices of an archived client keep naming it —
   * archiving is this app's "delete", so it must not rewrite history.
   */
  private async assertClientBillable(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, active: true },
    });
    if (!client) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "That client no longer exists" });
    }
    if (!client.active) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "That client is archived and cannot be invoiced",
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Purchase invoice write path
  // ---------------------------------------------------------------------------

  /**
   * Records a supplier's invoice. No lifecycle: the document already exists
   * on paper, numbered by the supplier, so this is a plain create with the
   * totals derived from the lines and `netPayable = totalTtc` (no withholding:
   * see the model note).
   */
  async createPurchase(input: CreatePurchaseInvoiceInput) {
    await this.assertPurchaseNumeroFree(input.numero);
    await this.assertSupplierAndReceipt(input.supplierId, input.receiptId ?? null);
    return this.prisma.purchaseInvoice.create({
      data: {
        ...this.purchaseHeader(input),
        documents: [],
        lines: { create: input.lines.map((line) => this.lineRow(line)) },
      },
      select: { id: true, numero: true },
    });
  }

  /**
   * Replaces the header and the lines wholesale — a full form, like the
   * order colours. `documents` and the legacy reference columns are left
   * untouched: neither is part of the input.
   */
  async updatePurchase(input: UpdatePurchaseInvoiceInput) {
    await this.assertPurchaseExists(input.id);
    await this.assertPurchaseNumeroFree(input.numero, input.id);
    await this.assertSupplierAndReceipt(input.supplierId, input.receiptId ?? null);
    return this.prisma.$transaction(async (tx) => {
      await tx.purchaseInvoiceLine.deleteMany({ where: { invoiceId: input.id } });
      await tx.purchaseInvoiceLine.createMany({
        data: input.lines.map((line) => ({ invoiceId: input.id, ...this.lineRow(line) })),
      });
      return tx.purchaseInvoice.update({
        where: { id: input.id },
        data: this.purchaseHeader(input),
        select: { id: true, numero: true },
      });
    });
  }

  /**
   * A hard delete, lines cascading. Unlike partners, an invoice is not
   * referenced by anything else — nothing dangles — and a mis-keyed one is
   * noise, not history. ADMIN and above only, and the UI confirms.
   */
  async removePurchase(id: string) {
    await this.assertPurchaseExists(id);
    await this.prisma.purchaseInvoice.delete({ where: { id } });
    return { id };
  }

  /**
   * Records the payment of an unpaid invoice — the detail page's "Record the
   * payment". Only `paidAt` and `paymentMethod` are written, so nothing the
   * form would recompute moves (see `recordPurchasePaymentInput`).
   *
   * An invoice already paid is refused rather than overwritten: a second
   * click, or a second tab, must not silently move the date of a payment
   * already on the books — the edit form is where a wrong one is corrected.
   * The date is the plant's calendar day and may not be in the future.
   */
  async recordPurchasePayment(input: RecordPurchasePaymentInput) {
    if (input.paidAt > plantDay()) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "A payment cannot be dated in the future" });
    }
    const paidAt = new Date(input.paidAt);
    // Conditional on `paidAt IS NULL`, so two concurrent records cannot both win.
    const { count } = await this.prisma.purchaseInvoice.updateMany({
      where: { id: input.id, paidAt: null },
      data: { paidAt, paymentMethod: input.paymentMethod },
    });
    if (count === 0) {
      await this.assertPurchaseExists(input.id);
      throw new TRPCError({ code: "CONFLICT", message: "This invoice's payment is already recorded" });
    }
    return { id: input.id, paidAt, paymentMethod: input.paymentMethod };
  }

  /** The gate before minting an upload URL: the invoice must exist. */
  async assertPurchaseDocumentUploadable(id: string) {
    await this.assertPurchaseExists(id);
  }

  /**
   * Files an uploaded scan after the invoice's others. The URL is
   * client-supplied, so it must be on this app's bucket — the same gate the
   * employee documents and the chat apply — or any link could be filed as a
   * "scan" and opened from the record by the next admin.
   */
  async addPurchaseDocument(input: AddPurchaseInvoiceDocumentInput) {
    await this.assertPurchaseExists(input.id);
    if (!this.storage.isOwnAssetUrl(input.url)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Document must be an uploaded file" });
    }
    return this.prisma.purchaseInvoice.update({
      where: { id: input.id },
      data: { documents: { push: input.url } },
      select: { id: true, documents: true },
    });
  }

  /** The header columns written from the form, with the derived totals. */
  private purchaseHeader(input: CreatePurchaseInvoiceInput) {
    const totals = invoiceTotals(input.lines);
    const date = (value: string | null | undefined) => (value ? new Date(value) : null);
    return {
      numero: input.numero,
      supplierId: input.supplierId,
      issuedAt: date(input.issuedAt),
      dueAt: date(input.dueAt),
      paidAt: date(input.paidAt),
      paymentMethod: input.paymentMethod ?? null,
      category: input.category ?? null,
      forProduction: input.forProduction ?? null,
      currency: input.currency ?? null,
      exchangeRate: input.exchangeRate ?? null,
      receiptId: input.receiptId ?? null,
      ...totals,
      netPayable: totals.totalTtc,
    };
  }

  private async assertPurchaseExists(id: string) {
    const found = await this.prisma.purchaseInvoice.findUnique({ where: { id }, select: { id: true } });
    if (!found) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
    }
  }

  /** `numero` is unique across the table: the same supplier number twice is a double entry. */
  private async assertPurchaseNumeroFree(numero: string, excludeId?: string) {
    const existing = await this.prisma.purchaseInvoice.findUnique({
      where: { numero },
      select: { id: true },
    });
    if (existing && existing.id !== excludeId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Purchase invoice ${numero} is already recorded`,
      });
    }
  }

  /**
   * The supplier must exist, and the goods receipt (when named) must be that
   * supplier's — an invoice cannot settle another supplier's delivery.
   * Precise messages rather than a Prisma FK error.
   */
  private async assertSupplierAndReceipt(supplierId: string, receiptId: string | null) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
    });
    if (!supplier) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "That supplier no longer exists" });
    }
    if (receiptId === null) return;
    const receipt = await this.prisma.goodsReceipt.findUnique({
      where: { id: receiptId },
      select: { supplierId: true },
    });
    if (!receipt) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "That goods receipt no longer exists" });
    }
    if (receipt.supplierId !== supplierId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "That goods receipt is from a different supplier",
      });
    }
  }

  async listSales(input: ListSalesInvoicesInput) {
    // The period is scope, not a facet, as on purchase orders: `runListQuery`
    // ANDs scope first, so the draft/issued chips keep counting inside the
    // window rather than across all time.
    const { period, from, to, ...query } = input;
    const declaration = salesInvoiceListDeclaration();
    const scope = salesInvoicePeriodScope({ period, from, to }) ?? {};
    // One "today" per request, so the overdue tile, each row's flag and the
    // figures all agree on which day it is.
    const today = todayUtc();

    const [result, figures] = await Promise.all([
      runListQuery({
        prisma: this.prisma,
        delegate: {
          findMany: (args) =>
            this.prisma.salesInvoice.findMany({ ...args, select: SALES_INVOICE_SELECT }),
          count: (args) => this.prisma.salesInvoice.count(args),
        },
        query,
        declaration,
        scope,
      }),
      this.salesFigures(query, declaration, scope, today),
    ]);

    return {
      ...result,
      ...figures,
      rows: result.rows.map(({ _count, lines, ...row }) => ({
        ...row,
        lineCount: _count.lines,
        subject: invoiceSubject(lines),
        orderClients: orderClients(lines),
        /**
         * Issued, unpaid, and past its due date on the server's day. Sent
         * rather than derived on the client so the row's badge can never
         * disagree with the tile that counts it.
         */
        overdue: isOverdue(row, today),
      })),
    };
  }

  /**
   * The header's figures and the month bands, narrowed exactly as the rows
   * are — the date window, the search and the active chip — so nothing on
   * the page describes a different set than the list beneath it.
   *
   * - `totals`: what the listed ISSUED invoices come to, per currency, with
   *   how many make up each sum. Drafts are left out, because a draft is
   *   not yet an amount billed; under the draft chip this is empty and the
   *   UI shows no tiles.
   * - `months`: the same figures per month of issue, drafts as one band of
   *   their own (`month: null`). The list is paged, so a month can straddle
   *   two pages; its band says what the whole month comes to rather than
   *   the slice on screen.
   * - `overdue`: issued, unpaid, due before today.
   *
   * One `groupBy` by day and currency rather than `runListQuery`'s
   * `aggregate` slot: that slot flattens per-column sums into one record,
   * so several sums over `totalTtc` would collide on the key, and Prisma
   * cannot group by an expression such as the month. Days fold into months
   * here; a year of invoicing is a few hundred groups at most. It runs
   * beside the list's transaction rather than inside it, which is the same
   * trade purchasing makes for its EUR figure.
   *
   * Credit notes carry a negative total and so net off the sum of their
   * currency, which is what "billed" should read.
   */
  private async salesFigures(
    query: Omit<ListSalesInvoicesInput, "period" | "from" | "to">,
    declaration: ReturnType<typeof salesInvoiceListDeclaration>,
    scope: Prisma.SalesInvoiceWhereInput,
    today: Date,
  ) {
    const search =
      query.search && typeof declaration.searchable === "function"
        ? declaration.searchable(query.search)
        : undefined;
    const facet = query.filter === "all" ? undefined : declaration.facets[query.filter];
    const where: Prisma.SalesInvoiceWhereInput = {
      AND: [scope, ...(search ? [search] : []), ...(facet ? [facet] : [])],
    };

    const [groups, overdue] = await Promise.all([
      this.prisma.salesInvoice.groupBy({
        by: ["status", "issuedAt", "currency"],
        where,
        _sum: { totalTtc: true },
        _count: { _all: true },
      }),
      this.prisma.salesInvoice.count({ where: { AND: [where, salesOverdueWhere(today)] } }),
    ]);

    const totals = new Map<string, { total: number; count: number }>();
    const months = new Map<string | null, { count: number; sums: Map<string, number> }>();
    for (const group of groups) {
      const amount = group._sum.totalTtc ?? 0;
      // A draft is a band of its own whatever its (absent) date; an issued
      // invoice always has one. `YYYY-MM` in UTC, as `@db.Date` is read.
      const month =
        group.status === "DRAFT" || group.issuedAt === null
          ? null
          : group.issuedAt.toISOString().slice(0, 7);
      const band = months.get(month) ?? { count: 0, sums: new Map<string, number>() };
      band.count += group._count._all;
      // Issuing requires a currency and the migrated rows were backfilled to
      // EUR (2026-09-22); a draft may still have none, and then has no sum
      // to show yet.
      if (group.currency !== null) {
        band.sums.set(group.currency, (band.sums.get(group.currency) ?? 0) + amount);
        if (group.status === "ISSUED") {
          const t = totals.get(group.currency) ?? { total: 0, count: 0 };
          totals.set(group.currency, {
            total: t.total + amount,
            count: t.count + group._count._all,
          });
        }
      }
      months.set(month, band);
    }

    return {
      totals: [...totals].map(([currency, t]) => ({ currency, ...t })),
      overdue,
      // Newest month first, the drafts band before all of them: it is work
      // in progress, and it is where the list's null-first sort puts them.
      months: [...months]
        .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : b.localeCompare(a)))
        .map(([month, band]) => ({
          month,
          count: band.count,
          sums: [...band.sums].map(([currency, total]) => ({ currency, total })),
        })),
    };
  }

  /**
   * The detail, plus — for each line that bills an order — how many parcels
   * packaging has actually closed against it, so the draft page can say
   * whether the quantity is packed or planned and whether it has moved
   * since (plan §2.2, §8), and how many parcels OTHER issued invoices
   * already bill, for the "6 of 10 already invoiced" hint of a later cycle
   * (docs/export-plan.md Step 4).
   */
  async salesById(id: string) {
    const invoice = await this.prisma.salesInvoice.findUnique({
      where: { id },
      select: SALES_INVOICE_DETAIL_SELECT,
    });
    if (!invoice) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
    }
    const { _count, ...rest } = invoice;
    const orderIds = rest.lines.flatMap((line) => (line.orderId ? [line.orderId] : []));
    const [packed, invoiced] = await Promise.all([
      this.orders.packedFor(orderIds),
      this.invoicedElsewhere(orderIds, this.prisma, id),
    ]);
    return {
      ...rest,
      lines: rest.lines.map((line) => ({
        ...line,
        /** Parcels closed by packaging against the line's order; null when it bills none. */
        packed: line.orderId ? (packed.get(line.orderId) ?? 0) : null,
        /** Parcels other ISSUED invoices already bill on that order; null when it bills none. */
        invoicedBefore: line.orderId ? (invoiced.get(line.orderId) ?? 0) : null,
        /** The order's planned parcel count, rounded up; null when unpriced or no order. */
        planned: line.order ? plannedParcels(line.order.parcelCount) : null,
      })),
      lineCount: _count.lines,
    };
  }

  // ---------------------------------------------------------------------------
  // Sales invoice write path — docs/sales-invoice-plan.md §5.2
  // ---------------------------------------------------------------------------

  /**
   * The orders a new line can bill, for the order picker: active, confirmed
   * and `INVOICEABLE` — an order already on a draft is `INVOICED`, so it is
   * never offered twice. Every client's, grouped by client name, since one
   * invoice may bill several; `clientId` narrows to one. Each comes with
   * the line it would start as: the order's product, its parcel price, and
   * its packed parcels less what issued invoices already bill, capped at
   * the un-invoiced balance (the planned remainder while packaging has
   * closed nothing).
   *
   * An order that cannot be billed is listed with the reason rather than
   * hidden, so nobody hunts for a missing one: no client, no parcel price
   * yet, or every planned parcel already invoiced.
   *
   * `clientCurrency` is the order's client's last invoice currency, to seed
   * a new invoice — nothing on an order or a client says what it trades in
   * (plan §2.3).
   */
  async invoiceableOrders(input: InvoiceableOrdersInput) {
    const orders = await this.prisma.order.findMany({
      where: {
        status: "INVOICEABLE",
        kind: "ORDER",
        active: true,
        ...(input.clientId ? { clientId: input.clientId } : {}),
      },
      select: { ...INVOICEABLE_ORDER_SELECT, client: { select: { id: true, name: true } } },
      orderBy: [{ client: { name: "asc" } }, { numeroSeq: "asc" }, { id: "asc" }],
    });
    const ids = orders.map((order) => order.id);
    const clientIds = [
      ...new Set(orders.flatMap((order) => (order.clientId ? [order.clientId] : []))),
    ];
    const [packed, invoiced, currencies] = await Promise.all([
      this.orders.packedFor(ids),
      this.invoicedElsewhere(ids, this.prisma),
      this.lastCurrencies(clientIds),
    ]);

    return {
      orders: orders.map((order) => {
        const planned = plannedParcels(order.parcelCount);
        const before = invoiced.get(order.id) ?? 0;
        const remaining = planned === null ? 0 : Math.max(0, planned - before);
        const priced = order.finalParcelPrice !== null && order.finalParcelPrice > 0;
        const fromPacking = (packed.get(order.id) ?? 0) - before;
        const unitsPerParcel =
          order.quantityUnit === "KILOGRAMS" ? order.kilosPerParcel : order.piecesPerParcel;
        const currency = order.clientId ? (currencies.get(order.clientId) ?? null) : null;
        return {
          id: order.id,
          numero: order.numero,
          client: order.client,
          clientCurrency: currency,
          market: order.market,
          quantityUnit: order.quantityUnit,
          planned,
          packed: packed.get(order.id) ?? 0,
          invoicedBefore: before,
          remaining,
          /** Why the order cannot be billed yet; null when it can. */
          blocked:
            order.client === null
              ? ("noClient" as const)
              : !priced || planned === null || planned <= 0
                ? ("noPrice" as const)
                : remaining <= 0
                  ? ("fullyInvoiced" as const)
                  : null,
          /** The line it starts as: editable before saving, like any other. */
          line: {
            orderId: order.id,
            product: order.product.name,
            description: describeProductSpec(
              { ...productSpecFromRow(order.product), paperType: order.product.paperType },
              unitsPerParcel,
              order.quantityUnit,
            ),
            quantity: fromPacking > 0 ? Math.min(fromPacking, remaining) : remaining,
            unitPrice: order.finalParcelPrice ?? 0,
            discountPct: 0,
            taxPct: defaultTaxPct(currency),
          },
        };
      }),
    };
  }

  /**
   * Replaces the header fields and the lines of a DRAFT. Lines are replaced
   * wholesale, like order colours, and the order lines are diffed against
   * what is stored: an order whose line is gone returns to `INVOICEABLE`, a
   * new one is attached (`attachOrders`), the rest stay as they are.
   *
   * The order moves straddle the replace on purpose. Each transition's
   * guard looks for the order's DRAFT line, so the detaches run while the
   * old lines still exist and the attaches once the new ones do.
   */
  async updateDraft(actor: SessionUser, input: UpdateSalesInvoiceDraftInput) {
    return this.prisma.$transaction(async (tx) => {
      const draft = await this.assertDraft(input.id, tx);
      const submitted = this.settleOrderLines(draft.lines, input.lines);

      const positions = new Set(input.lines.map((line) => line.position));
      if (positions.size !== input.lines.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Line positions must be unique" });
      }

      const stored = new Set(draft.lines.flatMap((line) => (line.orderId ? [line.orderId] : [])));
      const kept = new Set(submitted);
      for (const orderId of stored) {
        if (kept.has(orderId)) continue;
        await this.orders.transition(
          actor,
          { orderId, to: "INVOICEABLE", note: REMOVED_FROM_DRAFT_NOTE },
          tx,
        );
      }

      await tx.salesInvoiceLine.deleteMany({ where: { invoiceId: input.id } });
      await tx.salesInvoiceLine.createMany({
        data: input.lines.map((line) => ({ invoiceId: input.id, ...this.lineRow(line) })),
      });
      await this.attachOrders(
        actor,
        draft.id,
        submitted.filter((orderId) => !stored.has(orderId)),
        tx,
      );
      return tx.salesInvoice.update({
        where: { id: input.id },
        data: {
          // Follows the orders: a draft whose orders change client changes too.
          clientId: await this.billedClient(submitted, draft.clientId, tx),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.dueAt !== undefined
            ? { dueAt: input.dueAt === null ? null : new Date(input.dueAt) }
            : {}),
          ...(input.paymentMethod !== undefined ? { paymentMethod: input.paymentMethod } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...invoiceTotals(input.lines),
        },
        select: { id: true },
      });
    });
  }

  /**
   * Re-reads the packed parcel sum for every line that bills an order and
   * adopts it where packaging has recorded anything — the "Refresh from
   * packaging" button (plan §8). What earlier ISSUED invoices already bill
   * is taken off the packed figure, and the result is capped at the
   * un-invoiced balance; a line is skipped when that leaves nothing, so a
   * planned-quantity draft is not zeroed.
   */
  async refreshFromPackaging(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const draft = await this.assertDraft(id, tx);
      const orderIds = draft.lines.flatMap((line) => (line.orderId ? [line.orderId] : []));
      const [packed, invoiced, balances] = await Promise.all([
        this.orders.packedFor(orderIds, tx),
        this.invoicedElsewhere(orderIds, tx, id),
        this.plannedFor(orderIds, tx),
      ]);
      let changed = 0;
      const next = [];
      for (const line of draft.lines) {
        let sum: number | undefined;
        if (line.orderId && packed.has(line.orderId)) {
          const before = invoiced.get(line.orderId) ?? 0;
          const planned = balances.get(line.orderId);
          const remaining = planned === undefined ? Infinity : Math.max(0, planned - before);
          sum = Math.min((packed.get(line.orderId) ?? 0) - before, remaining);
        }
        const figures = {
          quantity: sum !== undefined && sum > 0 ? sum : (line.quantity ?? 0),
          unitPrice: line.unitPrice ?? 0,
          discountPct: line.discountPct ?? 0,
          taxPct: line.taxPct ?? 0,
        };
        if (figures.quantity !== line.quantity) {
          changed += 1;
          await tx.salesInvoiceLine.update({
            where: { id: line.id },
            data: { quantity: figures.quantity, total: invoiceLineFigures(figures).total },
            select: { id: true },
          });
        }
        next.push(figures);
      }
      if (changed > 0) {
        await tx.salesInvoice.update({
          where: { id },
          data: invoiceTotals(next),
          select: { id: true },
        });
      }
      return { id, changed };
    });
  }

  /**
   * DRAFT -> ISSUED. Takes the next number for the issue year from
   * `SalesInvoiceCounter` with one atomic upsert (plan §3.3): the row lock
   * the UPDATE takes serialises concurrent issues, a new year self-seeds at
   * 1, and the unique on `numero` is the backstop. The year is the issue
   * year, not the creation year.
   *
   * Issue also freezes the document: the template version is pinned and the
   * printed data snapshotted (docs/sales-invoice-pdf-plan.md). The PDF itself
   * is minted per language on first request — see `PdfService.salesInvoice`.
   */
  async issue(actor: SessionUser, input: IssueSalesInvoiceInput) {
    return this.prisma.$transaction(async (tx) => {
      const draft = await this.assertDraft(input.id, tx);
      if (draft.lines.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "An invoice needs at least one line" });
      }
      if (draft.currency === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Set the invoice's currency before issuing it",
        });
      }
      // Reachable only when every order line was removed from a draft that
      // billed several clients: nothing is left to say whom it bills.
      if (draft.clientId === null && !draft.lines.some((line) => line.orderId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This invoice names no client and bills no order — discard it and create it again with a client",
        });
      }
      if (draft.totalTtc === null || draft.totalTtc <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "An invoice cannot be issued for a zero or negative total",
        });
      }
      // A draft edited UP must not over-bill the order: each order-linked
      // line is capped at what other ISSUED invoices leave un-invoiced.
      const orderIds = draft.lines.flatMap((line) => (line.orderId ? [line.orderId] : []));
      const [invoiced, planned] = await Promise.all([
        this.invoicedElsewhere(orderIds, tx, input.id),
        this.plannedFor(orderIds, tx),
      ]);
      for (const line of draft.lines) {
        if (!line.orderId) continue;
        const plan = planned.get(line.orderId);
        if (plan === undefined) continue;
        const remaining = Math.max(0, plan - (invoiced.get(line.orderId) ?? 0));
        if ((line.quantity ?? 0) > remaining) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Line ${line.position} bills ${line.quantity} parcels but only ${remaining} remain un-invoiced on ${line.orderNumero}`,
          });
        }
      }
      const issuedAt = input.issuedAt ? new Date(input.issuedAt) : todayUtc();
      const year = issuedAt.getUTCFullYear() % 100;

      const rows = await tx.$queryRaw<{ n: number }[]>`
        INSERT INTO "SalesInvoiceCounter" ("year", "next") VALUES (${year}, 2)
        ON CONFLICT ("year") DO UPDATE SET "next" = "SalesInvoiceCounter"."next" + 1
        RETURNING "next" - 1 AS n`;
      const sequence = rows[0]?.n;
      if (sequence === undefined) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Counter returned no row" });
      }
      const numero = `F${String(year).padStart(2, "0")}${String(sequence).padStart(4, "0")}`;

      // Pinned here, not at render: a change of default template tomorrow
      // must not restyle an invoice issued today.
      const templateVersionId = await ensureDefaultSalesInvoiceVersion(tx);
      // `assertDraft` holds the row lock, so this cannot miss today; the
      // compare-and-set stays as the backstop, and its miss is a CONFLICT
      // rather than Prisma's P2025 surfacing as a 500.
      let issued;
      try {
        issued = await tx.salesInvoice.update({
          where: { id: input.id, status: "DRAFT" },
          data: { numero, status: "ISSUED", issuedAt, issuedById: actor.id, templateVersionId },
          select: SALES_INVOICE_PDF_SELECT,
        });
      } catch (cause) {
        if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2025") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This invoice was issued by someone else — reload and try again",
          });
        }
        throw cause;
      }

      // Freeze what the PDF prints, from the row as just written (it needs
      // the number and the date). `Client` is a live relation, so every
      // language minted later — and any re-mint — reads this, never the
      // tables. Data only: no render runs inside the issuing transaction.
      await tx.salesInvoice.update({
        where: { id: input.id },
        data: { issuedSnapshot: toSalesInvoiceModel(issued) },
        select: { id: true },
      });
      return { id: issued.id, numero: issued.numero };
    });
  }

  /**
   * Deletes a DRAFT and returns every order it billed to `INVOICEABLE`,
   * with the caller's note on the transition. The transition runs FIRST:
   * its guard checks the invoice is still a draft, so it must see the row —
   * both are in the same transaction, so the order is not observable.
   */
  async discardDraft(actor: SessionUser, input: DiscardSalesInvoiceDraftInput) {
    return this.prisma.$transaction(async (tx) => {
      const draft = await this.assertDraft(input.id, tx);
      const orderIds = [
        ...new Set(draft.lines.flatMap((line) => (line.orderId ? [line.orderId] : []))),
      ];
      for (const orderId of orderIds) {
        await this.orders.transition(
          actor,
          { orderId, to: "INVOICEABLE", note: input.note },
          tx,
        );
      }
      await tx.salesInvoice.delete({ where: { id: input.id } });
      return { id: input.id, orderIds };
    });
  }

  /**
   * Takes one order off a draft, from the order's page: the order returns to
   * `INVOICEABLE` with the caller's note, and the draft keeps its other
   * lines — renumbered, totals recomputed — or is deleted when that order's
   * line was all it had. Same ordering rule as `updateDraft`: the transition
   * runs while the line still exists, because its guard looks for it.
   */
  async removeOrder(actor: SessionUser, input: RemoveOrderFromSalesInvoiceInput) {
    return this.prisma.$transaction(async (tx) => {
      const draft = await this.assertDraft(input.id, tx);
      const line = draft.lines.find((l) => l.orderId === input.orderId);
      if (!line) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That order is not on this draft invoice",
        });
      }
      await this.orders.transition(
        actor,
        { orderId: input.orderId, to: "INVOICEABLE", note: input.note },
        tx,
      );

      const rest = draft.lines.filter((l) => l.id !== line.id);
      if (rest.length === 0) {
        await tx.salesInvoice.delete({ where: { id: input.id } });
        return { id: input.id, deleted: true };
      }
      await tx.salesInvoiceLine.delete({ where: { id: line.id } });
      for (const [index, kept] of rest.entries()) {
        if (kept.position === index + 1) continue;
        await tx.salesInvoiceLine.update({
          where: { id: kept.id },
          data: { position: index + 1 },
          select: { id: true },
        });
      }
      const remaining = rest.flatMap((kept) => (kept.orderId ? [kept.orderId] : []));
      await tx.salesInvoice.update({
        where: { id: input.id },
        data: {
          clientId: await this.billedClient(remaining, draft.clientId, tx),
          ...invoiceTotals(
            rest.map((kept) => ({
              quantity: kept.quantity ?? 0,
              unitPrice: kept.unitPrice ?? 0,
              discountPct: kept.discountPct ?? 0,
              taxPct: kept.taxPct ?? 0,
            })),
          ),
        },
        select: { id: true },
      });
      return { id: input.id, deleted: false };
    });
  }

  // ---------------------------------------------------------------------------

  /**
   * Locks the invoice row, then reads it. Every draft mutation (`updateDraft`,
   * `refreshFromPackaging`, `issue`, `discardDraft`) calls this first inside
   * its transaction, so they serialise on the row: a save that queued behind
   * an `issue` reads ISSUED once the lock is released and is refused here,
   * instead of rewriting an issued invoice's lines or deleting it — and
   * `issue` validates the lines as they will be frozen, not a stale read.
   * A lock rather than a `status: "DRAFT"` guard on each write because the
   * line writes key on the lines, not on the invoice, and would slip past
   * it. `db` must be a transaction — the lock is held until it ends.
   */
  private async assertDraft(id: string, db: Db) {
    await db.$queryRaw`SELECT 1 FROM "SalesInvoice" WHERE "id" = ${id} FOR UPDATE`;
    const invoice = await db.salesInvoice.findUnique({ where: { id }, select: DRAFT_SELECT });
    if (!invoice) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
    }
    if (invoice.status !== "DRAFT") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Invoice ${invoice.numero ?? ""} has been issued and can no longer be changed`,
      });
    }
    return {
      ...invoice,
      lines: invoice.lines.map(({ order, ...line }) => ({
        ...line,
        orderNumero: order?.numero ?? "the order",
      })),
    };
  }

  /**
   * Parcels ISSUED invoices bill per order, `excludeInvoiceId` left out —
   * the draft being edited, whose own quantity is the provisional figure
   * under discussion. Orders with none are absent from the map.
   *
   * Why this counts ISSUED only while the shipment side counts DRAFT and
   * SHIPPED: creation is refused while a draft invoice exists, so a draft's
   * quantity never needs to reserve anything; a shipment draft, by
   * contrast, claims its parcels the moment it exists (docs/export-plan.md
   * Step 4).
   */
  private async invoicedElsewhere(
    orderIds: string[],
    db: Db,
    excludeInvoiceId?: string,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (orderIds.length === 0) return result;
    const groups = await db.salesInvoiceLine.groupBy({
      by: ["orderId"],
      where: {
        orderId: { in: orderIds },
        invoice: {
          status: "ISSUED",
          ...(excludeInvoiceId ? { id: { not: excludeInvoiceId } } : {}),
        },
      },
      _sum: { quantity: true },
    });
    for (const group of groups) {
      if (group.orderId) result.set(group.orderId, group._sum.quantity ?? 0);
    }
    return result;
  }

  /** Planned parcels per order (`plannedParcels`); unpriced orders are absent. */
  private async plannedFor(orderIds: string[], db: Db): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (orderIds.length === 0) return result;
    const orders = await db.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, parcelCount: true },
    });
    for (const order of orders) {
      const planned = plannedParcels(order.parcelCount);
      if (planned !== null) result.set(order.id, planned);
    }
    return result;
  }

  /**
   * Checks an order's line may be added to this draft, then moves the order
   * to `INVOICED`. Called once the lines are written: the transition's guard
   * looks for the order's DRAFT line. The checks fire in the order a user
   * can act on them; the compare-and-set inside `transition` is the backstop
   * against two drafts racing for one order (the second finds it `INVOICED`
   * and rolls back).
   */
  private async attachOrders(
    actor: SessionUser,
    invoiceId: string,
    orderIds: string[],
    db: Db,
  ): Promise<void> {
    if (orderIds.length === 0) return;
    const [orders, issued, otherDrafts] = await Promise.all([
      db.order.findMany({ where: { id: { in: orderIds } }, select: INVOICEABLE_ORDER_SELECT }),
      this.invoicedElsewhere(orderIds, db),
      db.salesInvoiceLine.findMany({
        where: {
          orderId: { in: orderIds },
          invoice: { status: "DRAFT", id: { not: invoiceId } },
        },
        select: { orderId: true },
      }),
    ]);
    const byId = new Map(orders.map((order) => [order.id, order]));
    const onOtherDraft = new Set(otherDrafts.map((line) => line.orderId));

    for (const orderId of orderIds) {
      const order = byId.get(orderId);
      if (!order) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
      }
      if (order.status !== "INVOICEABLE") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Order ${order.numero} is ${order.status}, not ready for invoicing`,
        });
      }
      if (order.clientId === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Set the client of order ${order.numero} first — an invoice needs someone to bill`,
        });
      }
      if (order.finalParcelPrice === null || order.finalParcelPrice <= 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Order ${order.numero} has no parcel price — open it in the edit form and save it to compute one`,
        });
      }
      if (onOtherDraft.has(orderId)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Order ${order.numero} is already on another draft invoice`,
        });
      }
      const planned = plannedParcels(order.parcelCount) ?? 0;
      if (planned - (issued.get(orderId) ?? 0) <= 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            planned <= 0
              ? `Order ${order.numero} has no planned parcel count to bill`
              : `Order ${order.numero} is fully invoiced (${planned} parcels)`,
        });
      }
      await this.orders.transition(actor, { orderId, to: "INVOICED", note: undefined }, db);
    }
  }

  /**
   * The client an invoice bills, from the orders on its lines: theirs when
   * they share one, null when they belong to several (the PDF then lists
   * them all). An invoice billing no order keeps `fallback` — the client
   * picked for it, or the one it already had.
   */
  private async billedClient(
    orderIds: string[],
    fallback: string | null,
    db: Db,
  ): Promise<string | null> {
    if (orderIds.length === 0) return fallback;
    const clients = await db.order.findMany({
      where: { id: { in: orderIds } },
      select: { clientId: true },
      distinct: ["clientId"],
    });
    return clients.length === 1 ? (clients[0]?.clientId ?? null) : null;
  }

  /** Each client's most recent invoice currency; clients with none are absent. */
  private async lastCurrencies(clientIds: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (clientIds.length === 0) return result;
    const rows = await this.prisma.salesInvoice.findMany({
      where: { clientId: { in: clientIds }, currency: { not: null } },
      orderBy: [{ issuedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      distinct: ["clientId"],
      select: { clientId: true, currency: true },
    });
    for (const row of rows) {
      if (row.clientId && row.currency) result.set(row.clientId, row.currency);
    }
    return result;
  }

  /**
   * Settles the submitted lines' order links and mentions before a write,
   * and returns the orders they bill. A line whose `orderId` is omitted
   * keeps the order its position stores (the editor need not echo it); an
   * order may appear on one line only. An omitted mention keeps the one
   * stored for that order — the lines are deleted and recreated, so without
   * this a caller that does not echo the field would wipe it — and a
   * mention on a line billing no order is refused.
   */
  private settleOrderLines(
    stored: readonly { position: number; orderId: string | null; mention: ProductMention | null }[],
    submitted: SalesInvoiceLineInput[],
  ): string[] {
    const orderByPosition = new Map(stored.map((line) => [line.position, line.orderId]));
    const mentionByOrder = new Map(
      stored.flatMap((line) => (line.orderId ? [[line.orderId, line.mention] as const] : [])),
    );
    const seen = new Set<string>();
    for (const line of submitted) {
      if (line.orderId === undefined) line.orderId = orderByPosition.get(line.position) ?? null;
      if (!line.orderId) {
        if (line.mention) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A product mention applies only to a line that bills an order",
          });
        }
        line.mention = null;
        continue;
      }
      if (seen.has(line.orderId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "An order can be billed by one line only",
        });
      }
      seen.add(line.orderId);
      if (line.mention === undefined) line.mention = mentionByOrder.get(line.orderId) ?? null;
    }
    return [...seen];
  }

  /** One line as stored, with its tax-inclusive total computed here, never trusted from input. */
  private lineRow(
    line: InvoiceLineInput & { orderId?: string | null; mention?: ProductMention | null },
  ) {
    return {
      position: line.position,
      ...("orderId" in line ? { orderId: line.orderId ?? null } : {}),
      ...("mention" in line ? { mention: line.mention ?? null } : {}),
      product: line.product ?? null,
      description: line.description ?? null,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPct: line.discountPct,
      taxPct: line.taxPct,
      total: invoiceLineFigures(line).total,
    };
  }
}
