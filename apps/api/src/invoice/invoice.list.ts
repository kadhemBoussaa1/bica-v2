import { listQueryBase } from "@repo/api-contract";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import { contains, type ListDeclaration } from "../list/list-query";
import { periodInput, periodWindow, todayUtc, type PeriodInput } from "../list/period";

/**
 * The invoice lists' vocabulary — a security boundary, like every other
 * `*.list.ts`: `sortBy` is a closed enum whose every key is also selected,
 * facets are keys the server maps to predicates, and search names its
 * columns explicitly.
 *
 * Purchase and sales invoices get separate declarations because the partner
 * relation differs (`supplier`, required, vs `client`, optional) and Prisma's
 * where/orderBy types are per model. Everything else — the payment facets,
 * the sort keys, the line search — is the same rule stated twice, and the
 * two must be kept in step by hand.
 */

// ---------------------------------------------------------------------------
// Payment state
// ---------------------------------------------------------------------------

/**
 * Payment state as facet chips. These must PARTITION the table for
 * `runListQuery`'s summed "all" count to match the pager, so each excludes
 * the ones before it:
 *   - paid:    `paidAt` is set
 *   - overdue: unpaid, and `dueAt` is before today
 *   - open:    unpaid, and either not yet due or with no due date
 *
 * Legacy `brouillon` is NOT a facet: it is true on every migrated invoice.
 *
 * "Today" makes the declaration a function of the request time rather than a
 * constant — the only list with that property. It is evaluated once per call
 * in the service, so rows, total and facet counts all use the same day.
 */
export const INVOICE_FACET_KEYS = ["open", "overdue", "paid", "unpaid"] as const;
export type InvoiceFacet = (typeof INVOICE_FACET_KEYS)[number];

/**
 * `unpaid` is open + overdue — the "à payer" segment of `Purchase invoices
 * v3.dc.html`, which asks "what do we still owe" without caring whether
 * the term has passed. It overlaps the other two, so it is declared
 * `nonPartitioning` and stays out of the summed "all".
 */
const OVERLAPPING_INVOICE_FACETS: readonly InvoiceFacet[] = ["unpaid"];

/** Re-exported: the day the payment facets are judged on lives with the other date mechanics. */
export { todayUtc };

/**
 * The payment predicates, typed loosely because they are structurally
 * identical for both models; each declaration below narrows them to its own
 * WhereInput. `paidAt: null` matches SQL `IS NULL` in Prisma's equality form.
 *
 * Exported so the header figures and the dashboard count with the facet's
 * own predicate rather than a re-typed copy of it.
 *
 * PURCHASE side only. A sales invoice has a `status`, and a draft has a null
 * `paidAt` too — so on the sales side every one of these must be AND-ed with
 * `status: "ISSUED"`, which `SALES_UNPAID_WHERE` and `salesOverdueWhere`
 * below do. Reusing these two for sales counts drafts as money owed.
 */
export const UNPAID_WHERE = { paidAt: null } as const;
export function overdueWhere(today: Date) {
  return { paidAt: null, dueAt: { lt: today } } as const;
}

function paymentFacets(today: Date) {
  return {
    open: {
      paidAt: null,
      OR: [{ dueAt: null }, { dueAt: { gte: today } }],
    },
    overdue: overdueWhere(today),
    paid: { paidAt: { not: null } },
    unpaid: UNPAID_WHERE,
  };
}

/**
 * The sales-side pair — see the note on `UNPAID_WHERE`. Nothing can record a
 * payment on a sales invoice yet, so "unpaid" equals "issued" for now (credit
 * notes included, as negative rows); the shape is right for when it can.
 */
export const SALES_UNPAID_WHERE = {
  status: "ISSUED",
  paidAt: null,
} satisfies Prisma.SalesInvoiceWhereInput;
export function salesOverdueWhere(today: Date) {
  return { status: "ISSUED", paidAt: null, dueAt: { lt: today } } satisfies Prisma.SalesInvoiceWhereInput;
}

/**
 * `salesOverdueWhere`, for one row: issued, not paid, and due strictly before
 * `today` (UTC midnight, as `@db.Date` reads). The list sends this per row so
 * a badge can never disagree with the tile that counted it.
 */
export function isOverdue(
  row: { status: "DRAFT" | "ISSUED"; paidAt: Date | null; dueAt: Date | null },
  today: Date,
): boolean {
  return row.status === "ISSUED" && row.paidAt === null && row.dueAt !== null && row.dueAt < today;
}

/**
 * The same three-way split, for one row. The list and detail responses carry
 * this so the badge on a row can never disagree with the chip that counted
 * it — both are evaluated against the one `today` the service picked.
 */
export type PaymentState = "open" | "overdue" | "paid";
export function paymentState(
  row: { paidAt: Date | null; dueAt: Date | null },
  today: Date,
): PaymentState {
  if (row.paidAt !== null) return "paid";
  if (row.dueAt !== null && row.dueAt < today) return "overdue";
  return "open";
}

// ---------------------------------------------------------------------------
// Purchase invoices
// ---------------------------------------------------------------------------

export const PURCHASE_INVOICE_SORT_KEYS = [
  "issuedAt",
  "dueAt",
  "numero",
  "supplier",
  "totalTtc",
] as const;
export type PurchaseInvoiceSortKey = (typeof PURCHASE_INVOICE_SORT_KEYS)[number];

export function purchaseInvoiceListDeclaration(
  today: Date,
): ListDeclaration<
  Prisma.PurchaseInvoiceWhereInput,
  Prisma.PurchaseInvoiceOrderByWithRelationInput,
  PurchaseInvoiceSortKey,
  InvoiceFacet
> {
  return {
    sortable: {
      issuedAt: (dir) => ({ issuedAt: dir }),
      dueAt: (dir) => ({ dueAt: dir }),
      numero: (dir) => ({ numero: dir }),
      supplier: (dir) => ({ supplier: { name: dir } }),
      totalTtc: (dir) => ({ totalTtc: dir }),
    },
    defaultSort: "issuedAt",
    // Function form: the supplier name is on a relation, and the lines are
    // one-to-many — "ENCRE" should find every ink invoice, which only the
    // line text can say.
    searchable: (term) => ({
      OR: [
        { numero: contains(term) },
        { supplier: { name: contains(term) } },
        { lines: { some: { OR: [{ product: contains(term) }, { description: contains(term) }] } } },
        // "26MSBC-200" finds the invoice for that order's delivery.
        { receipt: { numero: contains(term) } },
        { receipt: { order: { numero: contains(term) } } },
      ],
    }),
    facets: paymentFacets(today),
    nonPartitioning: OVERLAPPING_INVOICE_FACETS,
  };
}

export const PURCHASE_INVOICE_SELECT = {
  id: true,
  numero: true,
  issuedAt: true,
  dueAt: true,
  paidAt: true,
  paymentMethod: true,
  supplierId: true,
  supplier: { select: { id: true, name: true, active: true } },
  totalHt: true,
  vatAmount: true,
  totalTtc: true,
  netPayable: true,
  currency: true,
  documents: true,
  category: true,
  _count: { select: { lines: true } },
  // What the invoice is for, in one line under the supplier: the order
  // whose delivery it bills, else the receipt, else its category, else the
  // first line. Folded into `subject` by the service.
  receipt: { select: { numero: true, order: { select: { numero: true } } } },
  lines: {
    select: { product: true, description: true },
    orderBy: { position: "asc" },
    take: 1,
  },
} satisfies Prisma.PurchaseInvoiceSelect;

/** Detail adds the lines and the remaining header fields the list has no room for. */
export const PURCHASE_INVOICE_DETAIL_SELECT = {
  ...PURCHASE_INVOICE_SELECT,
  forProduction: true,
  withholdingTax: true,
  exchangeRate: true,
  legacyReceiptType: true,
  legacyReceiptId: true,
  // The goods receipt this was raised against, resolved by the step-6
  // importer from the two legacy columns above (135 of 136).
  receipt: { select: { id: true, numero: true, category: true } },
  createdAt: true,
  lines: {
    select: {
      id: true,
      position: true,
      product: true,
      description: true,
      quantity: true,
      unitPrice: true,
      discountPct: true,
      taxPct: true,
      total: true,
    },
    orderBy: { position: "asc" },
  },
} satisfies Prisma.PurchaseInvoiceSelect;

export const listPurchaseInvoicesInput = listQueryBase.extend({
  sortBy: z.enum(PURCHASE_INVOICE_SORT_KEYS).default("issuedAt"),
  filter: z.enum(["all", ...INVOICE_FACET_KEYS]).default("all"),
  sortDir: listQueryBase.shape.sortDir.default("desc"),
  ...periodInput,
});
export type ListPurchaseInvoicesInput = z.infer<typeof listPurchaseInvoicesInput>;

/**
 * The `issuedAt` window a period means for purchase invoices, as scope — or
 * `undefined` when no period is active. A purchase invoice is recorded as
 * received, never drafted, so unlike the sales side nothing passes through
 * a window: an invoice without an issue date simply falls outside every one.
 */
export function purchaseInvoicePeriodScope(
  input: PeriodInput,
  now = new Date(),
): Prisma.PurchaseInvoiceWhereInput | undefined {
  const window = periodWindow(input, now);
  return window ? { issuedAt: window } : undefined;
}

// ---------------------------------------------------------------------------
// Sales invoices
// ---------------------------------------------------------------------------

/**
 * The sales list facets on `status` alone, which partitions the table.
 *
 * Payment state (open / overdue / paid) is deliberately NOT shown on sales
 * invoices for now: nothing can record a payment on an issued invoice yet, so
 * a chip nobody can move would only mislead. `paidAt`/`dueAt` stay in the
 * model and keep their legacy values. When payment recording lands, split
 * `issued` into the three `paymentFacets`, each AND-ed with
 * `status: "ISSUED"` so a draft is still counted exactly once, and send a
 * per-row state like the purchase side's `paymentState`.
 */
export const SALES_INVOICE_FACET_KEYS = ["draft", "issued"] as const;
export type SalesInvoiceFacet = (typeof SALES_INVOICE_FACET_KEYS)[number];

const SALES_FACETS: Record<SalesInvoiceFacet, Prisma.SalesInvoiceWhereInput> = {
  draft: { status: "DRAFT" },
  issued: { status: "ISSUED" },
};

export const SALES_INVOICE_SORT_KEYS = [
  "issuedAt",
  "dueAt",
  "numero",
  "client",
  "totalTtc",
] as const;
export type SalesInvoiceSortKey = (typeof SALES_INVOICE_SORT_KEYS)[number];

export function salesInvoiceListDeclaration(): ListDeclaration<
  Prisma.SalesInvoiceWhereInput,
  Prisma.SalesInvoiceOrderByWithRelationInput,
  SalesInvoiceSortKey,
  SalesInvoiceFacet
> {
  return {
    sortable: {
      issuedAt: (dir) => ({ issuedAt: dir }),
      dueAt: (dir) => ({ dueAt: dir }),
      // Drafts have no number yet; keep them together at the end whichever
      // way the column is sorted, rather than Prisma's default of "nulls
      // first on desc".
      numero: (dir) => ({ numero: { sort: dir, nulls: "last" } }),
      // Nullable relation: Prisma sorts rows without a client first or last
      // by direction, which is acceptable — they are a visible group anyway.
      client: (dir) => ({ client: { name: dir } }),
      totalTtc: (dir) => ({ totalTtc: dir }),
    },
    defaultSort: "issuedAt",
    searchable: (term) => ({
      OR: [
        { numero: contains(term) },
        { client: { name: contains(term) } },
        { lines: { some: { OR: [{ product: contains(term) }, { description: contains(term) }] } } },
        // "CMD-319" finds the invoice billing that order.
        { lines: { some: { order: { numero: contains(term) } } } },
      ],
    }),
    facets: SALES_FACETS,
  };
}

export const SALES_INVOICE_SELECT = {
  id: true,
  numero: true,
  status: true,
  issuedAt: true,
  dueAt: true,
  paidAt: true,
  paymentMethod: true,
  clientId: true,
  client: { select: { id: true, name: true, active: true } },
  totalHt: true,
  vatAmount: true,
  totalTtc: true,
  currency: true,
  documents: true,
  _count: { select: { lines: true } },
  // What the invoice is for, in one line under the client: the order(s) it
  // bills, or failing that the first line's product. Folded into `subject`
  // by the service; the lines themselves are not shipped to the list.
  lines: {
    select: { product: true, order: { select: { numero: true } } },
    orderBy: { position: "asc" },
  },
} satisfies Prisma.SalesInvoiceSelect;

export const SALES_INVOICE_DETAIL_SELECT = {
  ...SALES_INVOICE_SELECT,
  category: true,
  createdAt: true,
  // Non-null exactly when the invoice was issued by this app and so has a
  // generated PDF; the migrated rows have their scan instead.
  templateVersionId: true,
  createdBy: { select: { id: true, name: true } },
  issuedBy: { select: { id: true, name: true } },
  // The outbound shipment this invoice travelled with (docs/export-plan.md);
  // at most one by rule, several only if a discarded draft was re-created.
  shipments: {
    select: { id: true, numero: true, status: true },
    orderBy: { createdAt: "asc" },
  },
  lines: {
    select: {
      id: true,
      position: true,
      product: true,
      description: true,
      mention: true,
      quantity: true,
      unitPrice: true,
      discountPct: true,
      taxPct: true,
      total: true,
      orderId: true,
      // What the draft page compares the line against (plan §8): the
      // order's current price and planned parcel count. Money, but this
      // select serves an ADMIN+ procedure only.
      order: {
        select: {
          id: true,
          numero: true,
          status: true,
          parcelCount: true,
          finalParcelPrice: true,
        },
      },
    },
    orderBy: { position: "asc" },
  },
} satisfies Prisma.SalesInvoiceSelect;

export const listSalesInvoicesInput = listQueryBase.extend({
  sortBy: z.enum(SALES_INVOICE_SORT_KEYS).default("issuedAt"),
  filter: z.enum(["all", ...SALES_INVOICE_FACET_KEYS]).default("all"),
  sortDir: listQueryBase.shape.sortDir.default("desc"),
  ...periodInput,
});
export type ListSalesInvoicesInput = z.infer<typeof listSalesInvoicesInput>;

/**
 * The `issuedAt` window a period means for sales invoices, as scope — or
 * `undefined` when no period is active.
 *
 * A draft has no `issuedAt` yet, so a plain window would make every draft
 * vanish the moment a period is picked — and the draft chip along with it,
 * since the chips count inside the scope. Drafts therefore pass through any
 * window (decided 2026-09-22): the period asks "what did we issue in that
 * time", and a draft is work in progress rather than an answer to that
 * question either way. The header figures still exclude them: they sum
 * ISSUED rows only, see `InvoiceService.salesFigures`.
 */
export function salesInvoicePeriodScope(
  input: PeriodInput,
  now = new Date(),
): Prisma.SalesInvoiceWhereInput | undefined {
  const window = periodWindow(input, now);
  return window ? { OR: [{ status: "DRAFT" }, { issuedAt: window }] } : undefined;
}
