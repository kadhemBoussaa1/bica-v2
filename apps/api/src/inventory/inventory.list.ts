import type { Prisma } from "../generated/prisma/client.js";
import type { ListDeclaration } from "../list/list-query";

/**
 * The stocktake module's list vocabulary — docs/inventory-plan.md §3.
 *
 * This file is a security boundary: `sortBy` is a per-module enum rather than
 * a free string, because Prisma will happily `orderBy` a column that is not in
 * the `select` and leak its values through row order. A column is sortable only
 * if it is also selected.
 */

/**
 * Countable: physically on the floor and expected to be findable.
 *
 * Deliberately WIDER than `PENDING_ROLL_WHERE` (`stock.list.ts`), which adds
 * `receivedAt: null` — a reel typed into the office but never scanned in is
 * still a physical reel that should turn up during a stocktake. Measured
 * 2026-09-12, that widening covers exactly 3 of 353 reels, so it is a
 * correctness point rather than a valuable one.
 *
 * Not a new concept: this is receiving's own denominator, which was inlined at
 * three call sites in `stock.service.ts` before this export existed. Those now
 * import it, so the four readers of "which reels are live" cannot drift apart.
 */
export const COUNTABLE_ROLL_WHERE = {
  consomme: false,
  archived: false,
} satisfies Prisma.PaperRollWhereInput;

/**
 * In stock: countable AND scanned in. The dashboard's "reels" figure.
 *
 * Deliberately NARROWER than `COUNTABLE_ROLL_WHERE`: a reel typed into the
 * office and still on a truck is countable (it should turn up in a
 * stocktake once it lands) but it is not paper on hand, and its weight is
 * not tonnage in the warehouse. Equals the stock page's `available` plus
 * `reserved` facets (`stock.list.ts`); the pending reels are the receiving
 * inbox's figure instead.
 */
export const IN_STOCK_ROLL_WHERE = {
  ...COUNTABLE_ROLL_WHERE,
  receivedAt: { not: null },
} satisfies Prisma.PaperRollWhereInput;

/**
 * Countable AND carrying a printed label, so a scanner can actually resolve it.
 *
 * `qrCodeUrl` is the printed-sticker marker: 213 of the 353 countable reels
 * carry one, and every one of those also has a `legacyId`, so this is exactly
 * the scannable set. Frozen into `StockCount.labelledCount` at open time and
 * used as the progress denominator — see the plan's `expectedCount` risk.
 */
export const SCANNABLE_ROLL_WHERE = {
  ...COUNTABLE_ROLL_WHERE,
  qrCodeUrl: { not: null },
} satisfies Prisma.PaperRollWhereInput;

export const STOCK_COUNT_SELECT = {
  id: true,
  status: true,
  expectedCount: true,
  labelledCount: true,
  openedAt: true,
  closedAt: true,
  notes: true,
  openedBy: { select: { id: true, name: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.StockCountSelect;

export const STOCK_COUNT_SORT_KEYS = ["openedAt", "status"] as const;
export type StockCountSortKey = (typeof STOCK_COUNT_SORT_KEYS)[number];

export const STOCK_COUNT_FACET_KEYS = ["open", "closed"] as const;
export type StockCountFacet = (typeof STOCK_COUNT_FACET_KEYS)[number];

export const stockCountListDeclaration: ListDeclaration<
  Prisma.StockCountWhereInput,
  Prisma.StockCountOrderByWithRelationInput,
  StockCountSortKey,
  StockCountFacet
> = {
  sortable: {
    openedAt: (dir) => ({ openedAt: dir }),
    // Open sessions first on the default descending sort: there is at most one
    // and it is the only row anyone can act on.
    status: (dir) => [{ status: dir }, { openedAt: "desc" }],
  },
  defaultSort: "openedAt",
  // `notes` only. Everything else on a count is a date, a status or a figure,
  // and `contains` on the enum would be rejected by Prisma at runtime.
  searchable: ["notes"],
  // Two statuses, so these partition the set exactly and "all" is their sum.
  facets: {
    open: { status: "OPEN" },
    closed: { status: "CLOSED" },
  },
};

/** A reel on the "missing" side: countable, but never scanned in this count. */
export const VARIANCE_ROLL_SELECT = {
  id: true,
  numero: true,
  paperGrade: true,
  grammage: true,
  laize: true,
  qrCodeUrl: true,
  receivedAt: true,
  importShipment: { select: { id: true, numeroImport: true } },
} satisfies Prisma.PaperRollSelect;

/** A line on the "counted" / "unexpected" sides, with the reel it names. */
export const VARIANCE_LINE_SELECT = {
  id: true,
  scannedAt: true,
  unexpected: true,
  paperRoll: { select: VARIANCE_ROLL_SELECT },
} satisfies Prisma.StockCountLineSelect;

/**
 * No facets on either variance list.
 *
 * `runListQuery` sums declared facets for the "all" chip and an empty set gives
 * all = 0, so the caller must not render chips here. The three sides
 * (counted / missing / unexpected) are NOT facets of one set: "missing" is a
 * query over `PaperRoll` while the other two are queries over
 * `StockCountLine`, so they cannot share a delegate and arrive as a
 * discriminator on the input instead. Precedent: `ShipmentRollFacet`.
 */
export type VarianceFacet = never;

export const varianceRollListDeclaration: ListDeclaration<
  Prisma.PaperRollWhereInput,
  Prisma.PaperRollOrderByWithRelationInput,
  "numero",
  VarianceFacet
> = {
  sortable: {
    numero: (dir) => ({ numero: dir }),
  },
  defaultSort: "numero",
  searchable: ["numero", "paperGrade"],
  facets: {} as Record<VarianceFacet, Prisma.PaperRollWhereInput>,
};

export const varianceLineListDeclaration: ListDeclaration<
  Prisma.StockCountLineWhereInput,
  Prisma.StockCountLineOrderByWithRelationInput,
  "scannedAt",
  VarianceFacet
> = {
  sortable: {
    scannedAt: (dir) => ({ scannedAt: dir }),
  },
  defaultSort: "scannedAt",
  // Across the relation: the reel's number is what someone reads off a label.
  searchable: (term) => ({
    paperRoll: {
      OR: [
        { numero: { contains: term, mode: "insensitive" } },
        { paperGrade: { contains: term, mode: "insensitive" } },
      ],
    },
  }),
  facets: {} as Record<VarianceFacet, Prisma.StockCountLineWhereInput>,
};
