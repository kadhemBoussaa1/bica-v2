import { listQueryBase, PAPER_TYPES } from "@repo/api-contract";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import { contains, type ListDeclaration } from "../list/list-query";

export const ROLL_SORT_KEYS = [
  "paperGrade",
  "grammage",
  "laize",
  "poidsRestant",
  "metrageRestant",
  "createdAt",
] as const;
export type RollSortKey = (typeof ROLL_SORT_KEYS)[number];

/**
 * Stock state as facet chips. These must PARTITION the table for
 * `runListQuery`'s summed "all" count to match the pager, so they are defined
 * in priority order and each excludes the ones before it:
 *   - consumed:  used up — checked FIRST, see below
 *   - archived:  retired without being consumed
 *   - reserved:  spoken for by an order, still physically present
 *   - available: everything else
 *
 * Consumption outranks archiving deliberately. In the migrated data every one
 * of the 273 consumed rolls is ALSO archived (the old system archived a reel
 * as it used it up), so testing `archived` first would sweep them all into
 * that chip and leave "Consumed" permanently reading 0 — partitioning, but
 * telling the user nothing.
 *
 * `pending` sits between archiving and reservation: a reel typed into the
 * office but not yet scanned in on the floor is not available to pick, so
 * `reserved` and `available` both require a receipt. Measured after the
 * receiving migration: 351 available / 907 archived / 272 consumed / 1
 * reserved / 0 pending = 1531.
 *
 * `disponible` is not used as a facet at all: it is not exclusive with the
 * others, so it would break the partition.
 */
export const ROLL_FACET_KEYS = [
  "available",
  "reserved",
  "pending",
  "consumed",
  "archived",
] as const;
export type RollFacet = (typeof ROLL_FACET_KEYS)[number];

/**
 * Not received yet: typed into the office, never scanned on the floor.
 *
 * Defined once and reused by the facet, the receiving inbox, the nav badge
 * and the per-shipment progress count, so those four can never disagree about
 * what "pending" means. Consumed and archived reels are excluded because they
 * are not waiting for anything — see docs/receiving-plan.md.
 */
export const PENDING_ROLL_WHERE = {
  consomme: false,
  archived: false,
  receivedAt: null,
} satisfies Prisma.PaperRollWhereInput;

export const rollListDeclaration: ListDeclaration<
  Prisma.PaperRollWhereInput,
  Prisma.PaperRollOrderByWithRelationInput,
  RollSortKey,
  RollFacet
> = {
  sortable: {
    // Archived rolls sink, matching how every other list treats retired rows.
    paperGrade: (dir) => [{ archived: "asc" }, { paperGrade: dir }],
    grammage: (dir) => [{ archived: "asc" }, { grammage: dir }],
    laize: (dir) => [{ archived: "asc" }, { laize: dir }],
    poidsRestant: (dir) => [{ archived: "asc" }, { poidsRestant: dir }],
    metrageRestant: (dir) => [{ archived: "asc" }, { metrageRestant: dir }],
    createdAt: (dir) => [{ archived: "asc" }, { createdAt: dir }],
  },
  defaultSort: "paperGrade",
  // Function form: the shipment number is on a relation and cannot be named
  // as a flat column. `numero` is a label, not a key, but it is still what
  // someone reads off a reel.
  searchable: (term) => ({
    OR: [
      { numero: contains(term) },
      { numeroSource: contains(term) },
      { paperGrade: contains(term) },
      { description: contains(term) },
      { importShipment: { numeroImport: contains(term) } },
    ],
  }),
  facets: {
    // `reserved` is a NULLABLE boolean, so `{ not: true }` would drop NULL
    // rows entirely — Prisma compiles it to `<> true`, which is `unknown` for
    // NULL. The top-level OR over the concrete values is the form that works;
    // see the long note in order.list.ts.
    available: {
      consomme: false,
      archived: false,
      receivedAt: { not: null },
      OR: [{ reserved: false }, { reserved: null }],
    },
    reserved: { consomme: false, archived: false, receivedAt: { not: null }, reserved: true },
    pending: PENDING_ROLL_WHERE,
    consumed: { consomme: true },
    archived: { consomme: false, archived: true },
  },
};

/**
 * What the stock list returns to everyone who can read it.
 *
 * Money is NOT here. `listRolls` and `rollById` are `orderModuleProcedure`,
 * so PRODUCTION and MAGASINIER reach them, and paper cost is not the shop
 * floor's to read — the same line the orders module draws with
 * `ORDER_LIST_SELECT` vs `ORDER_LIST_SELECT_PRICED`, and the one the
 * shipments module draws by carrying no money column at all. ADMIN+ gets
 * `ROLL_SELECT_PRICED` instead; see `StockService.canReadPricing`.
 *
 * Splitting the select rather than deleting the columns from the response
 * keeps the guarantee structural: a caller below ADMIN cannot read `price`
 * because it was never selected, so no later refactor can leak it back.
 */
export const ROLL_SELECT = {
  id: true,
  numero: true,
  numeroSource: true,
  paperGrade: true,
  description: true,
  metrage: true,
  metrageRestant: true,
  metrageReserve: true,
  poids: true,
  poidsRestant: true,
  poidsReserve: true,
  laize: true,
  grammage: true,
  paperType: true,
  valide: true,
  disponible: true,
  partiel: true,
  reserved: true,
  consomme: true,
  archived: true,
  dateConsommation: true,
  consumedByNote: true,
  qrCodeUrl: true,
  receivedAt: true,
  parentId: true,
  importShipmentId: true,
  importShipment: {
    select: { id: true, numeroImport: true, dateImport: true },
  },
  createdAt: true,
} satisfies Prisma.PaperRollSelect;

/**
 * `ROLL_SELECT` plus what a reel cost. ADMIN+ only — see the note above.
 *
 * The two selects must stay row-compatible: the web derives its row type from
 * whichever one the procedure returns, so a column added here and not there
 * would be `undefined` at runtime for the shop floor while the type promised
 * a number.
 */
export const ROLL_SELECT_PRICED = {
  ...ROLL_SELECT,
  price: true,
  priceWithTransport: true,
} satisfies Prisma.PaperRollSelect;

/** Detail adds the split lineage, which the list has no room for. */
export const ROLL_DETAIL_SELECT = {
  ...ROLL_SELECT,
  /// Null on a backfilled receipt: the reel predates receiving, so it has a
  /// stamp but nobody scanned it.
  receivedBy: { select: { id: true, name: true } },
  parent: { select: { id: true, numero: true, paperGrade: true } },
  children: {
    select: {
      id: true,
      numero: true,
      poids: true,
      poidsRestant: true,
      metrage: true,
      metrageRestant: true,
      laize: true,
      consomme: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  /// Which orders this reel is committed to, and in what state.
  allocations: {
    select: {
      id: true,
      poidsReserve: true,
      metrageReserve: true,
      state: true,
      dateAllocation: true,
      order: { select: { id: true, numero: true } },
      allocatedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ dateAllocation: "desc" }, { id: "asc" }],
  },
  /// Stocktakes that saw this reel: their lines are `Restrict`, so a count
  /// above zero blocks `removeRoll` and the page hides Delete.
  _count: { select: { countLines: true } },
} satisfies Prisma.PaperRollSelect;

/** `ROLL_DETAIL_SELECT` plus what the reel cost. ADMIN+ only. */
export const ROLL_DETAIL_SELECT_PRICED = {
  ...ROLL_DETAIL_SELECT,
  price: true,
  priceWithTransport: true,
} satisfies Prisma.PaperRollSelect;

/**
 * The advanced filter: grammage, width, paper type and supplier, combinable.
 *
 * Keys and scalars, never `where` objects — the same contract as the audit
 * module's prefilters (`listAuditInput`), which the service turns into the
 * AND-ed scope. This is deliberately NOT a facet: facets must partition the
 * table for the "all" count to be their sum, and four independent dimensions
 * do not partition anything.
 *
 * `"unknown"` is a first-class answer on each dimension rather than a hidden
 * default. 160 reels have no grammage, 6 no paper type and 159 no shipment at
 * all, so a filter that silently dropped nulls would hide a tenth of the
 * stock — the same call the allocation picker made by admitting NULL-grammage
 * reels on purpose.
 *
 * Width is a min/max range, not a select: its 71 distinct values are a long
 * tail of singletons (four widths carry half the stock, and 1380 mm names one
 * reel), so a dropdown would be unusable. Its "unknown" is therefore a
 * separate flag — a range and a null test are different predicates, and
 * folding them into one field would muddle both.
 */
const rollAdvancedFilter = {
  grammage: z.union([z.number().int().min(0).max(2000), z.literal("unknown")]).optional(),
  laizeMin: z.number().min(0).max(100000).optional(),
  laizeMax: z.number().min(0).max(100000).optional(),
  laizeUnknown: z.boolean().optional(),
  paperType: z.enum([...PAPER_TYPES, "unknown"]).optional(),
  supplierId: z.union([z.string().min(1).max(64), z.literal("unknown")]).optional(),
};

export const listRollsInput = listQueryBase.extend({
  sortBy: z.enum(ROLL_SORT_KEYS).default("paperGrade"),
  filter: z.enum(["all", ...ROLL_FACET_KEYS]).default("all"),
  sortDir: listQueryBase.shape.sortDir.default("asc"),
  ...rollAdvancedFilter,
});
export type ListRollsInput = z.infer<typeof listRollsInput>;

/**
 * The stock export: the list's scope, search, facet and sort — without
 * pagination, because "export the stock" means every reel the current view
 * matches, not the 25 rows on screen.
 *
 * `page`/`pageSize` are omitted rather than ignored, so a caller cannot pass
 * them and be quietly misled about what came back. Sort is kept so a CSV
 * reads in the order the user was looking at.
 *
 * Defined here, next to the list it mirrors, rather than in the contract:
 * `sortBy` and `filter` are per-module enums and this file is the security
 * boundary for them (see the header of `rollListDeclaration`). Sharing the
 * declaration is what stops the export reaching a column the list cannot.
 */
export const exportRollsInput = z.object({
  sortBy: z.enum(ROLL_SORT_KEYS).default("paperGrade"),
  sortDir: listQueryBase.shape.sortDir.default("asc"),
  filter: z.enum(["all", ...ROLL_FACET_KEYS]).default("all"),
  search: listQueryBase.shape.search,
  // The same four dimensions as the list, so an export always matches the
  // screen it was taken from.
  ...rollAdvancedFilter,
});
export type ExportRollsInput = z.infer<typeof exportRollsInput>;

// ---------------------------------------------------------------------------
// Shipments
// ---------------------------------------------------------------------------

export const SHIPMENT_SORT_KEYS = ["numeroImport", "dateImport", "supplier"] as const;
export type ShipmentSortKey = (typeof SHIPMENT_SORT_KEYS)[number];

/**
 * Facets must PARTITION the table for `runListQuery`'s summed "all" count to
 * match the pager. `archived` is checked FIRST and the other two are scoped to
 * active rows, so an archived shipment lands in exactly one chip.
 *
 * These replaced `linked`/`unlinked` when `supplierId` became required on
 * 2026-09-03 — every shipment has a supplier now, so "unlinked" would always
 * read 0. "Has reels" is the split that actually matters: it is what decides
 * whether a shipment can be deleted or only archived.
 */
export const SHIPMENT_FACET_KEYS = ["withRolls", "empty", "archived"] as const;
export type ShipmentFacet = (typeof SHIPMENT_FACET_KEYS)[number];

export const shipmentListDeclaration: ListDeclaration<
  Prisma.ImportShipmentWhereInput,
  Prisma.ImportShipmentOrderByWithRelationInput,
  ShipmentSortKey,
  ShipmentFacet
> = {
  sortable: {
    // Archived shipments sink, matching every other list.
    numeroImport: (dir) => [{ active: "desc" }, { numeroImport: dir }],
    dateImport: (dir) => [{ active: "desc" }, { dateImport: dir }],
    supplier: (dir) => [{ active: "desc" }, { supplier: { name: dir } }],
  },
  defaultSort: "dateImport",
  searchable: (term) => ({
    OR: [
      { numeroImport: contains(term) },
      { productName: contains(term) },
      { observations: contains(term) },
      { supplier: { name: contains(term) } },
    ],
  }),
  facets: {
    withRolls: { active: true, rolls: { some: {} } },
    empty: { active: true, rolls: { none: {} } },
    archived: { active: false },
  },
};

/**
 * What a delivery looks like to everyone who can read it.
 *
 * Money is NOT here. Receiving put these procedures on `warehouseProcedure`
 * so a MAGASINIER can open the delivery they are scanning, and what the
 * company paid its supplier is not the warehouse's to read — the same line
 * `ROLL_SELECT` vs `ROLL_SELECT_PRICED` draws for reels. ADMIN+ gets
 * `SHIPMENT_SELECT_PRICED`; see `StockService.canReadPricing`.
 *
 * `transportIncluded` stays on the unpriced select: it says whether transport
 * was part of the deal, which is a fact about the delivery, not a figure.
 */
export const SHIPMENT_SELECT = {
  id: true,
  numeroImport: true,
  dateImport: true,
  supplierId: true,
  supplier: { select: { id: true, name: true, active: true } },
  productName: true,
  totalMetrage: true,
  totalRolls: true,
  transportIncluded: true,
  hasCertificate: true,
  certificate: true,
  packingList: true,
  importFile: true,
  observations: true,
  active: true,
  createdAt: true,
  _count: { select: { rolls: true } },
} satisfies Prisma.ImportShipmentSelect;

/**
 * `SHIPMENT_SELECT` plus what the delivery cost. ADMIN+ only.
 *
 * The two selects must stay row-compatible, for the same reason as the reel
 * pair above: the web derives its row type from whichever one the procedure
 * returned, so a column added here and not there is `undefined` at runtime
 * for the warehouse while the type promises a number.
 */
export const SHIPMENT_SELECT_PRICED = {
  ...SHIPMENT_SELECT,
  price: true,
  priceTotal: true,
  currency: true,
  transportPrice: true,
} satisfies Prisma.ImportShipmentSelect;

/**
 * Reels on one shipment, searched by reel number.
 *
 * A separate declaration from `rollListDeclaration` rather than a reuse: the
 * scope is a single shipment (AND-ed in by the service, never client-supplied),
 * the only search field is `numero`, and there are no state facets — a delivery
 * is a fixed set of reels, so filtering it by availability is not what anyone
 * is doing on this page. Sorting by number is the point.
 */
/**
 * Every key here must be a column of `SHIPMENT_ROLL_SELECT`: an unselected
 * sort column still leaks its values through the row order.
 */
export const SHIPMENT_ROLL_SORT_KEYS = ["numero", "poidsRestant", "receivedAt"] as const;
export type ShipmentRollSortKey = (typeof SHIPMENT_ROLL_SORT_KEYS)[number];

/**
 * No facets. `runListQuery` sums declared facets for the "all" chip, and an
 * empty set gives all = 0, so the caller must not render chips for this list.
 */
export type ShipmentRollFacet = never;

export const shipmentRollListDeclaration: ListDeclaration<
  Prisma.PaperRollWhereInput,
  Prisma.PaperRollOrderByWithRelationInput,
  ShipmentRollSortKey,
  ShipmentRollFacet
> = {
  sortable: {
    // Archived reels sink, as everywhere else.
    numero: (dir) => [{ archived: "asc" }, { numero: dir }],
    poidsRestant: (dir) => [{ archived: "asc" }, { poidsRestant: dir }],
    // Pending reels first ascending: "what is still to scan" is the question
    // this column gets sorted for.
    receivedAt: (dir) => [{ archived: "asc" }, { receivedAt: { sort: dir, nulls: "first" } }],
  },
  defaultSort: "numero",
  // `numero` only, by decision. It is a label rather than a key (17 migrated
  // reels are numbered "0"), but it is what someone reads off a physical reel.
  searchable: ["numero"],
  facets: {} as Record<ShipmentRollFacet, Prisma.PaperRollWhereInput>,
};

/** The row shape for a reel listed under its shipment. */
export const SHIPMENT_ROLL_SELECT = {
  id: true,
  numero: true,
  numeroSource: true,
  paperGrade: true,
  grammage: true,
  laize: true,
  paperType: true,
  poids: true,
  poidsRestant: true,
  consomme: true,
  archived: true,
  receivedAt: true,
  receivedBy: { select: { name: true } },
} satisfies Prisma.PaperRollSelect;

/**
 * What a printed label carries: the QR encodes only the id, and everything
 * else on the sheet is there for a human reading a reel whose code will not
 * scan. Ordered and capped by the service.
 */
export const ROLL_LABEL_SELECT = {
  id: true,
  numero: true,
  paperGrade: true,
  grammage: true,
  laize: true,
  importShipment: {
    select: { numeroImport: true, supplier: { select: { name: true } } },
  },
} satisfies Prisma.PaperRollSelect;

/** One card in the receiving inbox: a delivery with reels still to scan. */
export const RECEIVING_SHIPMENT_SELECT = {
  id: true,
  numeroImport: true,
  dateImport: true,
  productName: true,
  supplier: { select: { id: true, name: true } },
  _count: { select: { rolls: true } },
} satisfies Prisma.ImportShipmentSelect;

export const rollsForShipmentInput = listQueryBase.extend({
  shipmentId: z.string().min(1),
  sortBy: z.enum(SHIPMENT_ROLL_SORT_KEYS).default("numero"),
  // Present so the shape matches `ListQuery`; there is only ever "all".
  filter: z.literal("all").default("all"),
  sortDir: listQueryBase.shape.sortDir.default("asc"),
});
export type RollsForShipmentInput = z.infer<typeof rollsForShipmentInput>;

export const listShipmentsInput = listQueryBase.extend({
  sortBy: z.enum(SHIPMENT_SORT_KEYS).default("dateImport"),
  filter: z.enum(["all", ...SHIPMENT_FACET_KEYS]).default("all"),
  sortDir: listQueryBase.shape.sortDir.default("desc"),
});
export type ListShipmentsInput = z.infer<typeof listShipmentsInput>;
