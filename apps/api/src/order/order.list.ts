import { listQueryBase } from "@repo/api-contract";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import { contains, type ListDeclaration } from "../list/list-query";
import { PRODUCT_SPEC_SELECT } from "../product/product.list";

export const ORDER_SORT_KEYS = [
  "numero",
  "client",
  "product",
  "quantite",
  "orderTotal",
  "createdAt",
] as const;
export type OrderSortKey = (typeof ORDER_SORT_KEYS)[number];

export const ORDER_FACET_KEYS = [
  "quotes",
  "draft",
  "inProduction",
  "invoicing",
  "completed",
  "archived",
] as const;
export type OrderFacet = (typeof ORDER_FACET_KEYS)[number];

/**
 * The orders module's list vocabulary — a security boundary, see client.list.ts.
 *
 * `client` and `product` sort by the related name rather than the raw foreign
 * key, which would order by cuid and look random. Sort fragments lead with
 * `active: "desc"` so archived orders sink; `runListQuery` appends the `id`
 * tiebreaker. `orderTotal` replaces the legacy `prixTotal` sort key — same
 * column, renamed with the rest of the pricing snapshot (see the pricing
 * plan's schema diff). It is sortable only for callers who get
 * `ORDER_LIST_SELECT_PRICED`: `OrderService.list` refuses it below ADMIN,
 * since `ORDER_LIST_SELECT` does not carry the column and ordering by it
 * would rank every order by value anyway.
 *
 * The facets replace the old `offreDePrix`/`produitFini` split — see
 * docs/order-lifecycle-plan.md §5.1 for the full reasoning, reproduced here
 * because it is easy to get wrong again in a new form:
 *
 * `runListQuery`'s summed "all" count is the sum of the facet counts, not a
 * fifth query, so the facets MUST partition the scoped set exactly. The old
 * nullable-boolean version of this bug (`notTrue`, deleted with this rewrite)
 * is gone now that `kind`/`status` are non-nullable enums — but a NEW way to
 * make the same mistake opened up in its place: `active` is orthogonal to
 * `status` (an archived order keeps whatever status it had), so translating
 * the eight `OrderStatus` values into one facet each, plus `archived`, would
 * double-count every archived order — once under its status, once under
 * `archived`. Every status-based facet below therefore pins `active: true`
 * explicitly, exactly as the four legacy facets did, and `archived` remains
 * the sole `active: false` bucket.
 *
 * Eight status chips (plus quotes and archived) is also more than a user
 * needs to scan, and four of the eight statuses read 0 against the current
 * data — so statuses are grouped into the module inboxes staff actually work
 * from, not exposed one-for-one. The grouping is a display concern only: the
 * transition machine in `order-lifecycle.ts` still distinguishes all eight,
 * unaffected by which ones share a chip here.
 *
 * `kind: "QUOTE"` appears only in `quotes`; every other active facet pins
 * `kind: "ORDER"`, so an accepted quote moves between chips rather than
 * appearing in two. If `OrderStatus` ever gains a member, it MUST be added to
 * exactly one group below — an unlisted status silently vanishes from every
 * facet while still counting in the pager, reproducing the exact
 * 267-against-397 discrepancy the old nullable-boolean version of this bug
 * caused, in a new form.
 */
export const orderListDeclaration: ListDeclaration<
  Prisma.OrderWhereInput,
  Prisma.OrderOrderByWithRelationInput,
  OrderSortKey,
  OrderFacet
> = {
  sortable: {
    numero: (dir) => [{ active: "desc" }, { numero: dir }],
    client: (dir) => [{ active: "desc" }, { client: { name: dir } }],
    product: (dir) => [{ active: "desc" }, { product: { name: dir } }],
    quantite: (dir) => [{ active: "desc" }, { quantite: dir }],
    orderTotal: (dir) => [{ active: "desc" }, { orderTotal: dir }],
    createdAt: (dir) => [{ active: "desc" }, { createdAt: dir }],
  },
  defaultSort: "numero",
  // Function form: `product.name` is a related field and cannot be named as
  // a flat column — see the `searchable` doc comment on `ListDeclaration`.
  // String columns only otherwise — Prisma rejects `contains` on an enum.
  searchable: (term) => ({
    OR: [
      { numero: contains(term) },
      { description: contains(term) },
      { product: { name: contains(term) } },
    ],
  }),
  facets: {
    quotes: { active: true, kind: "QUOTE" },
    draft: { active: true, kind: "ORDER", status: "DRAFT" },
    inProduction: {
      active: true,
      kind: "ORDER",
      status: { in: ["IN_PRODUCTION", "PRODUCED"] },
    },
    invoicing: {
      active: true,
      kind: "ORDER",
      status: { in: ["INVOICEABLE", "INVOICED", "READY_FOR_EXPORT"] },
    },
    completed: {
      active: true,
      kind: "ORDER",
      status: { in: ["COMPLETED", "CANCELLED"] },
    },
    archived: { active: false },
  },
};

/**
 * The list payload MINUS every money column — what the shop floor sees.
 *
 * Deliberately NOT the whole ~50-column row: a list needs identity, the
 * client, the product's headline spec and the status. The full record — every
 * pricing input, the glue lines, the snapshot — comes from `byId` when
 * someone opens one.
 *
 * Pricing is commercial data, so it is split off into
 * `ORDER_LIST_SELECT_PRICED` rather than filtered out afterwards, exactly as
 * `EMPLOYEE_SELECT` splits salary and CIN off: a caller below ADMIN never has
 * the columns FETCHED, so no later mistake — a log line, a new field on a
 * response — can leak what was never in memory. Hiding the panels in React
 * would leave every figure sitting in the JSON.
 */
export const ORDER_LIST_SELECT = {
  id: true,
  numero: true,
  // `images` because the list is a card grid now, and each card leads with
  // the product's first photo. The detail page renders the whole gallery.
  product: {
    select: { id: true, name: true, images: true, ...PRODUCT_SPEC_SELECT },
  },
  client: { select: { id: true, name: true } },
  quantite: true,
  quantityUnit: true,
  // `kind`/`status` replace `offreDePrix`/`produitFini` for the table's
  // status badge — see docs/order-lifecycle-plan.md §5. The legacy booleans
  // are no longer selected here at all; the table renders from the enums.
  kind: true,
  status: true,
  exportStatus: true,
  active: true,
  createdAt: true,
} satisfies Prisma.OrderSelect;

/**
 * The list payload for ADMIN and above: adds the order's total and where that
 * figure came from. `pricingSource` rides with it — on its own it says
 * nothing useful, and it only ever labels a price.
 */
export const ORDER_LIST_SELECT_PRICED = {
  ...ORDER_LIST_SELECT,
  orderTotal: true,
  pricingSource: true,
} satisfies Prisma.OrderSelect;

/**
 * The detail payload MINUS every money column — the shop floor's view of an
 * order: what to make, how much of it, where it is in the pipeline, and what
 * has been produced against it. See `ORDER_LIST_SELECT` on why this is a
 * `select` split rather than a filter.
 *
 * `unitWeightG` and the two dimension columns stay: they are physical
 * measurements the floor needs to run the job, and they carry no price.
 */
export const ORDER_DETAIL_SELECT = {
  ...ORDER_LIST_SELECT,
  description: true,
  clientId: true,
  productId: true,
  product: {
    select: {
      id: true,
      name: true,
      clientId: true,
      active: true,
      images: true,
      ...PRODUCT_SPEC_SELECT,
    },
  },

  // ---- physical measurements (not pricing) --------------------------------
  // The computed geometry of one unit. Kept in the unpriced select: the floor
  // needs the reel width and cut length to actually run the job, and none of
  // these three is a cost.
  productionWidthCm: true,
  cuttingLengthCm: true,
  unitWeightG: true,
  /// Metres of reel the order needs — what the warehouse allocates against,
  /// so it rides with the geometry rather than the prices.
  metrageNecessaire: true,

  // `acceptedAt`/`acceptedBy` replace `okFacturation`/`okExport` in the
  // detail select — see docs/order-lifecycle-plan.md §5. Acceptance is only
  // ever set for a QUOTE-derived order (`OrderService.acceptQuote`); null on
  // every order created directly as an ORDER.
  acceptedAt: true,
  acceptedBy: { select: { id: true, name: true } },
  /// The full transition history — the visible payoff of the audit log plan
  /// §2.4 exists to enable. Oldest first (`at asc`), like a timeline reads;
  /// `runListQuery`'s own tiebreaker convention does not apply here since
  /// this is not a paginated list.
  statusChanges: {
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      note: true,
      at: true,
      by: { select: { id: true, name: true } },
    },
    orderBy: { at: "asc" },
  },
  /// A count of parcels is physical — the warehouse ships against it — so
  /// it sits here rather than with the parcel PRICE. Null until the order
  /// is first priced, which is what computes it.
  parcelCount: true,
  /// The outbound shipments carrying this order's parcels
  /// (docs/export-plan.md), several after a partial export. Unpriced: a
  /// shipment carries no money, and the warehouse works from this card.
  shipmentLines: {
    select: {
      quantity: true,
      shipment: {
        select: {
          id: true,
          numero: true,
          status: true,
          kind: true,
          exportDate: true,
        },
      },
    },
    orderBy: { shipment: { createdAt: "asc" } },
  },
  /// Paper committed to this order. Newest first, like the legacy screens.
  allocations: {
    select: {
      id: true,
      poidsReserve: true,
      metrageReserve: true,
      state: true,
      dateAllocation: true,
      dateConsommation: true,
      dateAnnulation: true,
      paperRoll: {
        select: { id: true, numero: true, paperGrade: true, grammage: true, laize: true },
      },
      allocatedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ dateAllocation: "desc" }, { id: "asc" }],
  },
} satisfies Prisma.OrderSelect;

/**
 * The full detail payload, for ADMIN and above: everything above plus every
 * pricing input, the negotiated figures, the computed snapshot, and the cost
 * on each ink.
 *
 * This is what the detail page's Pricing / Glue / Packing / Negotiated panels
 * render, and what `order.byId` must return for the edit form to round-trip a
 * save without silently blanking a column it never received.
 */
export const ORDER_DETAIL_SELECT_PRICED = {
  ...ORDER_DETAIL_SELECT,
  orderTotal: true,
  pricingSource: true,

  // ---- pricing inputs -----------------------------------------------------
  paperKiloPrice: true,
  profitMarginPct: true,
  lossMarginPct: true,
  handleGlueKiloPrice: true,
  handleGlueWeightG: true,
  sideGlueKiloPrice: true,
  sideGlueWeightG: true,
  baseAdhesiveKiloPrice: true,
  baseAdhesiveWeightG: true,
  legacyGlueCostPerUnit: true,
  piecesPerParcel: true,
  kilosPerParcel: true,
  parcelPrice: true,
  transportCost: true,

  // ---- pricing snapshot ---------------------------------------------------
  unitPrice: true,
  unitPriceWithMargins: true,
  glueCostPerUnit: true,
  finalUnitPrice: true,
  baseParcelPrice: true,
  finalParcelPrice: true,

  // ---- paper allocation ---------------------------------------------------
  // The running kg totals the old system kept, importer-only since the
  // allocation work: the app sums `allocations` (in the unpriced select)
  // instead. Still returned so a legacy order's history reads as it did.
  poidsReserve: true,
  poidsConsomme: true,

  // ---- printing -----------------------------------------------------------
  // What the print job is. Not shop-floor working data under the current
  // model: printing is not assigned to an operator or a machine any more (see
  // the note on the Order model), so this is commercial/spec detail.
  typeImpression: true,
  colours: {
    select: { id: true, nom: true, prix: true },
    orderBy: { createdAt: "asc" },
  },

  // ---- invoicing ----------------------------------------------------------
  // The sales invoice(s) billing this order, for the detail's Invoices list
  // and the "Discard draft" action (docs/sales-invoice-plan.md §7). Several
  // after a partial export (docs/export-plan.md); on the priced select
  // because an invoice total is money. `quantity` is what the un-invoiced
  // balance is computed from.
  invoiceLines: {
    select: {
      quantity: true,
      invoice: {
        select: {
          id: true,
          numero: true,
          status: true,
          issuedAt: true,
          totalTtc: true,
          currency: true,
        },
      },
    },
    orderBy: { invoice: { createdAt: "asc" } },
  },
} satisfies Prisma.OrderSelect;

export const listOrdersInput = listQueryBase.extend({
  sortBy: z.enum(ORDER_SORT_KEYS).default("numero"),
  filter: z.enum(["all", ...ORDER_FACET_KEYS]).default("all"),
  sortDir: listQueryBase.shape.sortDir.default("asc"),
});

export type ListOrdersInput = z.infer<typeof listOrdersInput>;

/**
 * The two row shapes `order.byId` can return, named so `OrderService.byId`
 * can declare their union explicitly — see the comment there on why the
 * union cannot be left to inference.
 */
export type OrderDetail = Prisma.OrderGetPayload<{
  select: typeof ORDER_DETAIL_SELECT;
}>;
export type OrderDetailPriced = Prisma.OrderGetPayload<{
  select: typeof ORDER_DETAIL_SELECT_PRICED;
}>;
