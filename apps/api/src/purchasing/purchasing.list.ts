import { listQueryBase, RECEIPT_TOLERANCE } from "@repo/api-contract";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import type { PurchaseCategory } from "../generated/prisma/enums.js";
import { contains, type ListDeclaration } from "../list/list-query";
import { periodInput, periodWindow, type PeriodInput } from "../list/period";

/** Re-exported for the web, which imports this file's types and nothing else of the API. */
export type { PurchaseCategory, ReceiptStatus, StretchFilmType } from "../generated/prisma/enums.js";

/**
 * The purchasing lists' vocabulary — a security boundary, like every other
 * `*.list.ts`: `sortBy` is a closed enum whose every key is also selected,
 * facets are keys the server maps to predicates, and search names its
 * columns explicitly.
 *
 * Purchase orders and goods receipts get separate declarations (different
 * models, different sort keys) but share the category facets below, so the
 * two lists read alike.
 */

// ---------------------------------------------------------------------------
// Category facets
// ---------------------------------------------------------------------------

/**
 * One chip per `PurchaseCategory` — nine of them, each standing for itself.
 *
 * This replaced a five-chip grouping (paper / consumables / packaging /
 * transport / misc) that folded ink, plate and glue together, and boxes,
 * pallets and film together. The groups scanned more easily, but they hid the
 * thing a buyer actually asks for: what did we order in *ink*. Each category
 * has its own suppliers, its own line dimensions and its own number series,
 * so it is its own subject rather than a slice of a bigger one.
 *
 * The keys are the enum values themselves rather than lowercase aliases, so
 * there is no second vocabulary to keep in step and no inverse map to forget.
 * `satisfies Record<PurchaseCategory, …>` still makes a new category a type
 * error until it is given a facet, which matters because `facetCounts.all` is
 * the sum of the declared facets: one missing would count in the pager while
 * showing under no chip.
 *
 * Nothing persisted or linked the old group keys — verified before the
 * change — so no migration was needed.
 */
export const PURCHASING_FACET_KEYS = [
  "PAPER",
  "INK",
  "PLATE",
  "GLUE",
  "BOXES",
  "PALLETS",
  "STRETCH_FILM",
  "TRANSPORT",
  "MISC",
] as const;
export type PurchasingFacet = (typeof PURCHASING_FACET_KEYS)[number];

/**
 * The facet predicates, typed loosely because they are structurally
 * identical for both models; each declaration narrows them to its own
 * WhereInput. An equality test per category now rather than `in` over a
 * group — `in` on an enum column is fine either way (unlike `contains`).
 */
function categoryFacets() {
  return {
    PAPER: { category: "PAPER" },
    INK: { category: "INK" },
    PLATE: { category: "PLATE" },
    GLUE: { category: "GLUE" },
    BOXES: { category: "BOXES" },
    PALLETS: { category: "PALLETS" },
    STRETCH_FILM: { category: "STRETCH_FILM" },
    TRANSPORT: { category: "TRANSPORT" },
    MISC: { category: "MISC" },
  } satisfies Record<PurchasingFacet, { category: PurchaseCategory }>;
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

export const PURCHASE_ORDER_SORT_KEYS = [
  "issuedAt",
  "expectedAt",
  "numero",
  "supplier",
  "totalHt",
] as const;
export type PurchaseOrderSortKey = (typeof PURCHASE_ORDER_SORT_KEYS)[number];

export const purchaseOrderListDeclaration: ListDeclaration<
  Prisma.PurchaseOrderWhereInput,
  Prisma.PurchaseOrderOrderByWithRelationInput,
  PurchaseOrderSortKey,
  PurchasingFacet
> = {
  sortable: {
    issuedAt: (dir) => ({ issuedAt: dir }),
    expectedAt: (dir) => ({ expectedAt: dir }),
    numero: (dir) => ({ numero: dir }),
    supplier: (dir) => ({ supplier: { name: dir } }),
    totalHt: (dir) => ({ totalHt: dir }),
  },
  defaultSort: "issuedAt",
  // Function form: the supplier name is on a relation, and the lines are
  // one-to-many — "HOTMELT" should find every glue order, which only the
  // line text can say.
  searchable: (term) => ({
    OR: [
      { numero: contains(term) },
      { supplier: { name: contains(term) } },
      { lines: { some: { designation: contains(term) } } },
    ],
  }),
  facets: categoryFacets(),
};

export const PURCHASE_ORDER_SELECT = {
  id: true,
  numero: true,
  category: true,
  issuedAt: true,
  expectedAt: true,
  supplierId: true,
  supplier: { select: { id: true, name: true, active: true } },
  totalHt: true,
  totalQuantity: true,
  currency: true,
  /// Enough of each line to derive how much of the order has arrived — see
  /// `orderFulfilment` — plus the per-category dimensions the list shows as
  /// columns once a single category is selected.
  ///
  /// Two figures per line rather than a status column: the order's state is a
  /// fact about its receipts, so deriving it means it can never contradict
  /// them. The dimensions come per line because that is where they live, and
  /// the row joins the distinct values: 19 of the 30 paper orders carry more
  /// than one grammage, so an order-level figure would be wrong for most of
  /// them.
  ///
  /// Cheap enough at this shape: 3.4 lines per order on average, so a 10-row
  /// page ships ~34 small objects (390 for a page of the very heaviest).
  lines: {
    select: {
      designation: true,
      quantity: true,
      receivedQuantity: true,
      total: true,
      grammage: true,
      laize: true,
      length: true,
      width: true,
      height: true,
      thickness: true,
      filmType: true,
      colourCount: true,
      unitSurface: true,
    },
    orderBy: { position: "asc" },
  },
  _count: { select: { lines: true, receipts: true } },
} satisfies Prisma.PurchaseOrderSelect;

/**
 * How much of an order has been received: PENDING until something arrives,
 * RECEIVED once every line has its full quantity, PARTIAL in between.
 *
 * Judged per line, not on the totals: a delivery that over-supplies one line
 * and short-supplies another sums to the right figure while plainly not being
 * the order. `RECEIPT_TOLERANCE` absorbs the Float noise in the legacy
 * figures, the same allowance the over-receipt guard uses.
 *
 * An order with no lines is PENDING rather than RECEIVED — nothing has
 * arrived, and claiming completion for an empty order would be a lie of
 * omission.
 */
export type OrderFulfilment = "PENDING" | "PARTIAL" | "RECEIVED";

/**
 * The per-line dimension columns, as keys. Declared here rather than imported
 * from the web's lines editor: the API cannot reach across the app boundary,
 * and this is the file the web imports its purchasing types from anyway.
 */
const DIMENSION_KEYS = [
  "grammage",
  "laize",
  "length",
  "width",
  "height",
  "thickness",
  "filmType",
  "colourCount",
  "unitSurface",
] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

/** The distinct values an order's lines carry, per dimension. */
type OrderDimensions = Record<DimensionKey, (number | string)[]>;

/**
 * What an order measures, collapsed to the distinct values across its lines.
 *
 * Derived server-side so the list row can carry nine short arrays instead of
 * every line: at 3.4 lines per order a 10-row page would otherwise ship ~34
 * line objects purely so the client could de-duplicate them.
 *
 * Distinct values rather than one figure, because a dimension is a fact about
 * a line and not about the order: 19 of the 30 paper orders carry more than
 * one grammage and 23 more than one laize, so a single value would be wrong
 * for most of them. The other eight categories are uniform within an order,
 * so this usually yields exactly one value.
 *
 * Raw values, not formatted text: `filmType` is an enum the web translates,
 * and the figures follow the reader's own number formatting.
 */
export function orderDimensions(
  lines: readonly Partial<Record<DimensionKey, number | string | null>>[],
): OrderDimensions {
  const collected = {} as OrderDimensions;
  for (const key of DIMENSION_KEYS) {
    const seen: (number | string)[] = [];
    for (const line of lines) {
      const value = line[key];
      if (value === null || value === undefined) continue;
      if (!seen.includes(value)) seen.push(value);
    }
    collected[key] = seen;
  }
  return collected;
}

export function orderFulfilment(
  lines: readonly { quantity: number; receivedQuantity: number }[],
): OrderFulfilment {
  if (lines.length === 0) return "PENDING";
  const arrived = lines.reduce((sum, line) => sum + line.receivedQuantity, 0);
  if (arrived <= RECEIPT_TOLERANCE) return "PENDING";
  const short = lines.some((line) => line.receivedQuantity < line.quantity - RECEIPT_TOLERANCE);
  return short ? "PARTIAL" : "RECEIVED";
}

/**
 * The four reception states a row is drawn in and the segmented control
 * filters by. Judged in the handoff's order: received, then partial —
 * something has arrived, so the order is alive even past its date — then
 * late, then pending. `today` is UTC midnight, as `@db.Date` is read; an
 * order expected today is not late.
 */
export type OrderState = "pending" | "partial" | "late" | "received";

export function orderState(
  order: { expectedAt: Date | null; lines: readonly { quantity: number; receivedQuantity: number }[] },
  today: Date,
): OrderState {
  const fulfilment = orderFulfilment(order.lines);
  if (fulfilment === "RECEIVED") return "received";
  if (fulfilment === "PARTIAL") return "partial";
  return order.expectedAt !== null && order.expectedAt < today ? "late" : "pending";
}

/**
 * What an order commits: the header total, or the lines' sum where the
 * legacy template had none (35 of the 65 EUR orders are transport, whose
 * template had no totals block). Where both exist they agree on all 521
 * migrated orders (worst gap 0,01), so the fallback is safe. One rule for
 * the row, the header figures and the dashboard.
 */
export function orderAmount(order: {
  totalHt: number | null;
  lines: readonly { total: number }[];
}): number {
  return order.totalHt ?? order.lines.reduce((sum, line) => sum + line.total, 0);
}

/** Whether a state answers a state chip: "waiting" is everything not received. */
export function stateMatches(state: OrderState, key: OrderStateKey): boolean {
  if (key === "received") return state === "received";
  if (key === "late") return state === "late";
  return state !== "received";
}

/** The per-category dimension columns, shared by order and receipt lines. */
const LINE_DIMENSIONS = {
  grammage: true,
  laize: true,
  length: true,
  width: true,
  height: true,
  thickness: true,
  filmType: true,
  colourCount: true,
} as const;

/** Detail adds the lines, the receipts raised against it, and the header text. */
export const PURCHASE_ORDER_DETAIL_SELECT = {
  ...PURCHASE_ORDER_SELECT,
  address: true,
  notes: true,
  createdByName: true,
  createdAt: true,
  lines: {
    select: {
      id: true,
      position: true,
      designation: true,
      quantity: true,
      /// What has arrived against this line, so the order's lines show what
      /// is outstanding and the receipt form can offer a remaining figure.
      receivedQuantity: true,
      unitPrice: true,
      total: true,
      ...LINE_DIMENSIONS,
      unitSurface: true,
    },
    orderBy: { position: "asc" },
  },
  receipts: {
    select: {
      id: true,
      numero: true,
      issuedAt: true,
      receivedAt: true,
      status: true,
      validated: true,
      receivedQuantity: true,
    },
    orderBy: [{ issuedAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.PurchaseOrderSelect;

/**
 * The reception state as a second, independent facet, from `Purchase orders
 * v4.dc.html`: "waiting" is anything not fully received (pending, partial
 * or late), "late" is pending past its expected date, "received" is done.
 * `orderState` says how a row gets one; the service turns the key into an
 * id list, because the state is derived from the lines and no Prisma
 * predicate can compare two columns.
 */
const ORDER_STATE_KEYS = ["waiting", "late", "received"] as const;
export type OrderStateKey = (typeof ORDER_STATE_KEYS)[number];

export const listPurchaseOrdersInput = listQueryBase.extend({
  sortBy: z.enum(PURCHASE_ORDER_SORT_KEYS).default("issuedAt"),
  filter: z.enum(["all", ...PURCHASING_FACET_KEYS]).default("all"),
  state: z.enum(["all", ...ORDER_STATE_KEYS]).default("all"),
  sortDir: listQueryBase.shape.sortDir.default("desc"),
  ...periodInput,
});
export type ListPurchaseOrdersInput = z.infer<typeof listPurchaseOrdersInput>;

/**
 * The `issuedAt` window a period means, as a Prisma filter — or `undefined`
 * when no period is active. An order always has an `issuedAt`, so a window
 * simply excludes what falls outside it.
 *
 * `issuedAt`, not `expectedAt`: this answers "what did we order in that
 * period", which is the day the order left the building rather than the day
 * the goods are due. A due-date filter would be a different question and a
 * different field. The buckets and their bounds are `list/period.ts`, shared
 * with the sales invoice list.
 */
export function orderPeriodFilter(
  input: PeriodInput,
  now = new Date(),
): Prisma.PurchaseOrderWhereInput | undefined {
  const window = periodWindow(input, now);
  return window ? { issuedAt: window } : undefined;
}

// ---------------------------------------------------------------------------
// Goods receipts
// ---------------------------------------------------------------------------

export const GOODS_RECEIPT_SORT_KEYS = ["issuedAt", "receivedAt", "numero", "supplier"] as const;
export type GoodsReceiptSortKey = (typeof GOODS_RECEIPT_SORT_KEYS)[number];

export const goodsReceiptListDeclaration: ListDeclaration<
  Prisma.GoodsReceiptWhereInput,
  Prisma.GoodsReceiptOrderByWithRelationInput,
  GoodsReceiptSortKey,
  PurchasingFacet
> = {
  sortable: {
    issuedAt: (dir) => ({ issuedAt: dir }),
    receivedAt: (dir) => ({ receivedAt: dir }),
    numero: (dir) => ({ numero: dir }),
    supplier: (dir) => ({ supplier: { name: dir } }),
  },
  defaultSort: "issuedAt",
  // Also the order's number and the typed-in invoice number, so a receipt
  // can be found from either document it sits between.
  searchable: (term) => ({
    OR: [
      { numero: contains(term) },
      { invoiceNumber: contains(term) },
      { order: { numero: contains(term) } },
      { supplier: { name: contains(term) } },
      { lines: { some: { designation: contains(term) } } },
    ],
  }),
  facets: categoryFacets(),
};

export const GOODS_RECEIPT_SELECT = {
  id: true,
  numero: true,
  category: true,
  issuedAt: true,
  receivedAt: true,
  status: true,
  validated: true,
  receivedQuantity: true,
  supplierId: true,
  supplier: { select: { id: true, name: true, active: true } },
  orderId: true,
  order: { select: { id: true, numero: true, currency: true } },
  invoiceNumber: true,
  _count: { select: { lines: true } },
} satisfies Prisma.GoodsReceiptSelect;

/** Detail adds the lines (each with the order line it received against), the invoices raised on it, and the header text. */
export const GOODS_RECEIPT_DETAIL_SELECT = {
  ...GOODS_RECEIPT_SELECT,
  invoiceUrl: true,
  notes: true,
  updatedByName: true,
  createdAt: true,
  lines: {
    select: {
      id: true,
      position: true,
      designation: true,
      receivedQuantity: true,
      unitPrice: true,
      ...LINE_DIMENSIONS,
      orderLine: { select: { id: true, position: true, quantity: true, unitPrice: true } },
    },
    orderBy: { position: "asc" },
  },
  invoices: {
    select: { id: true, numero: true, issuedAt: true, totalTtc: true, currency: true },
    orderBy: [{ issuedAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.GoodsReceiptSelect;

export const listGoodsReceiptsInput = listQueryBase.extend({
  sortBy: z.enum(GOODS_RECEIPT_SORT_KEYS).default("issuedAt"),
  filter: z.enum(["all", ...PURCHASING_FACET_KEYS]).default("all"),
  sortDir: listQueryBase.shape.sortDir.default("desc"),
});
export type ListGoodsReceiptsInput = z.infer<typeof listGoodsReceiptsInput>;
