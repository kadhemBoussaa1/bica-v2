import { TYPE_SACS, listQueryBase } from "@repo/api-contract";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import { contains, type ListDeclaration } from "../list/list-query";

export const PRODUCT_SORT_KEYS = ["name", "client", "typeSac", "createdAt"] as const;
export type ProductSortKey = (typeof PRODUCT_SORT_KEYS)[number];

/**
 * One facet per bag type plus "archived". Partitions the table because
 * `typeSac` is NOT NULL on every product (unlike Order's nullable workflow
 * flags, which needed the `notTrue` trick) — every active row falls into
 * exactly one type facet, every inactive row into `archived`.
 */
export const PRODUCT_FACET_KEYS = [...TYPE_SACS, "archived"] as const;
export type ProductFacet = (typeof PRODUCT_FACET_KEYS)[number];

/**
 * The products module's list vocabulary — a security boundary, see
 * client.list.ts. Every sort fragment leads with `active: "desc"` so archived
 * rows sink to the bottom of an unfiltered view; `runListQuery` appends the
 * `id` tiebreaker. `client` sorts by the related name, not the raw foreign
 * key, which would order by cuid and look random.
 */
export const productListDeclaration: ListDeclaration<
  Prisma.ProductWhereInput,
  Prisma.ProductOrderByWithRelationInput,
  ProductSortKey,
  ProductFacet
> = {
  sortable: {
    name: (dir) => [{ active: "desc" }, { name: dir }],
    client: (dir) => [{ active: "desc" }, { client: { name: dir } }],
    typeSac: (dir) => [{ active: "desc" }, { typeSac: dir }],
    createdAt: (dir) => [{ active: "desc" }, { createdAt: dir }],
  },
  defaultSort: "name",
  // Function form: `client.name` is a related field and cannot be named as a
  // flat column — see the `searchable` doc comment on `ListDeclaration`.
  searchable: (term) => ({
    OR: [{ name: contains(term) }, { client: { name: contains(term) } }],
  }),
  facets: {
    ...Object.fromEntries(
      TYPE_SACS.map((typeSac) => [
        typeSac,
        { active: true, typeSac } satisfies Prisma.ProductWhereInput,
      ]),
    ),
    archived: { active: false },
  } as Record<ProductFacet, Prisma.ProductWhereInput>,
};

/** The spec columns, shared between the list and detail selects. */
export const PRODUCT_SPEC_SELECT = {
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
} satisfies Prisma.ProductSelect;

export const PRODUCT_SELECT = {
  id: true,
  name: true,
  clientId: true,
  client: { select: { id: true, name: true, active: true } },
  ...PRODUCT_SPEC_SELECT,
  /// Feeds the edit form and the order form's picker fallback. The table does
  /// not render thumbnails, but this select serves `byId` too, and splitting
  /// it in two to save one array column per row is not worth the divergence.
  images: true,
  active: true,
  createdAt: true,
  _count: { select: { orders: true } },
} satisfies Prisma.ProductSelect;

export const listProductsInput = listQueryBase.extend({
  sortBy: z.enum(PRODUCT_SORT_KEYS).default("name"),
  filter: z.enum(["all", ...PRODUCT_FACET_KEYS]).default("all"),
  sortDir: listQueryBase.shape.sortDir.default("asc"),
});
export type ListProductsInput = z.infer<typeof listProductsInput>;

/**
 * The order form's picker: every active product visible to a given client —
 * that client's own plus the shared (`clientId: null`) ones. `clientId: null`
 * (not omitted) means the order itself has no client yet, so only shared
 * products are offered.
 */
export const productsForClientInput = z.object({
  clientId: z.string().min(1).nullable(),
});

// ---------------------------------------------------------------------------
// The orders placed for one product — the product detail page's list.
// ---------------------------------------------------------------------------

/**
 * Sortable columns for a product's orders. A per-module enum, never a free
 * string: Prisma will happily `orderBy` a column that is not in the select
 * and leak its values through row order, so a column is sortable only if it
 * is also selected below — in BOTH shapes. No money column is sortable here,
 * so `PRODUCT_ORDER_SELECT` (unpriced) carries every key; adding one would
 * need `ProductService.ordersForProduct` to refuse it below ADMIN, the way
 * `OrderService.list` refuses `orderTotal`.
 */
export const PRODUCT_ORDER_SORT_KEYS = ["numero", "createdAt", "quantite", "status"] as const;
export type ProductOrderSortKey = (typeof PRODUCT_ORDER_SORT_KEYS)[number];

/**
 * No facets. The orders under one product are few — 355 products share 402
 * orders, so the median is one — and a chip row over a handful of rows is
 * noise. Status is a column here, not a filter.
 */
export type ProductOrderFacet = never;

export const productOrderListDeclaration: ListDeclaration<
  Prisma.OrderWhereInput,
  Prisma.OrderOrderByWithRelationInput,
  ProductOrderSortKey,
  ProductOrderFacet
> = {
  // Every sort carries the `id` tiebreaker `runListQuery` adds, so ties on a
  // low-cardinality column (`status`) cannot reorder across pages.
  sortable: {
    numero: (dir) => [{ numero: dir }],
    createdAt: (dir) => [{ createdAt: dir }],
    quantite: (dir) => [{ quantite: dir }],
    status: (dir) => [{ status: dir }],
  },
  // Newest first: "what was made from this spec lately" is the question this
  // page gets opened with.
  defaultSort: "createdAt",
  // `numero` only. The client name is on the order but is the same for most
  // rows here, and searching a description would need a join this list does
  // not otherwise take.
  searchable: ["numero"],
  facets: {} as Record<ProductOrderFacet, Prisma.OrderWhereInput>,
};

/**
 * The row shape for an order listed under its product, without a money
 * column — what the shop floor gets. A `select` split, not a filter, for the
 * reason `ORDER_LIST_SELECT` gives.
 */
export const PRODUCT_ORDER_SELECT = {
  id: true,
  numero: true,
  kind: true,
  status: true,
  quantite: true,
  quantityUnit: true,
  createdAt: true,
  client: { select: { id: true, name: true } },
} satisfies Prisma.OrderSelect;

/** ADMIN and above: adds the order's total. */
export const PRODUCT_ORDER_SELECT_PRICED = {
  ...PRODUCT_ORDER_SELECT,
  orderTotal: true,
} satisfies Prisma.OrderSelect;

/**
 * Named so `ordersForProduct` can declare its return type as the union of
 * the two. An inferred return type would subtype-reduce it to the unpriced
 * shape (the priced one is a subtype), and the web app could never narrow
 * to the total — the same reason `OrderService.byId` spells out its own.
 */
export type ProductOrderRow = Prisma.OrderGetPayload<{ select: typeof PRODUCT_ORDER_SELECT }>;
export type ProductOrderRowPriced = Prisma.OrderGetPayload<{
  select: typeof PRODUCT_ORDER_SELECT_PRICED;
}>;

export const ordersForProductInput = listQueryBase.extend({
  productId: z.string().min(1),
  sortBy: z.enum(PRODUCT_ORDER_SORT_KEYS).default("createdAt"),
  // Present so the shape matches `ListQuery`; there is only ever "all".
  filter: z.literal("all").default("all"),
  sortDir: listQueryBase.shape.sortDir.default("desc"),
});
export type OrdersForProductInput = z.infer<typeof ordersForProductInput>;
