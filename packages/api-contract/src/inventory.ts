import { z } from "zod";
import { listQueryBase } from "./list.js";
import { optionalText } from "./orders.js";

/**
 * Stocktake by QR scan — docs/inventory-plan.md.
 *
 * A stocktake is a walk of the warehouse confirming which reels are physically
 * present. Presence only: no locations, no measured quantities, and no writes
 * to `PaperRoll`. A closed count produces a variance report; acting on it is a
 * separate, manual admin decision.
 *
 * The sibling of receiving (`scan.ts`, `stock.ts`), and it reuses that
 * feature's parser unchanged — both label generations resolve the same way.
 */

/** Where a stocktake is in its life. Only one may be OPEN at a time. */
export const STOCK_COUNT_STATUSES = ["OPEN", "CLOSED"] as const;
export type StockCountStatus = (typeof STOCK_COUNT_STATUSES)[number];

/**
 * What one scan did.
 *
 * `alreadyCounted` is an OUTCOME, not an error: the warehouse scans fast and
 * the imager double-triggers on a long press, so a second scan of the same
 * label reports "already in" rather than refusing. Refusing would train people
 * to ignore the buzzer.
 *
 * `notCountable` is a finding too — a reel that is consumed or archived in the
 * system but physically on the floor is exactly what a stocktake exists to
 * surface. Only `notALabel` and `notFound` are failures, and both come from
 * `parseRollScan` / the lookup rather than from counting rules.
 */
export const COUNT_SCAN_OUTCOMES = [
  "counted",
  "alreadyCounted",
  "notCountable",
] as const;
export type CountScanOutcome = (typeof COUNT_SCAN_OUTCOMES)[number];

export const openStockCountInput = z.object({
  notes: optionalText(500),
});

export const countScanInput = z.object({
  /**
   * Top level by requirement, not by style. The audit heuristic reads the
   * related-entity id from the input's top level only (`firstString` does a
   * flat key lookup), and `countId` is registered in its `PARENT_KEYS` — fold
   * this into `code` or nest it and every stocktake audit row loses its
   * session link. See `audit.util.ts` and docs/inventory-plan.md Step 4a.
   */
  countId: z.string().min(1),
  /** The raw scan: a URL, a bare cuid, or whatever the wedge typed. */
  code: z.string().trim().min(1, "Scan a label").max(500),
});

export const stockCountIdInput = z.object({ id: z.string().min(1) });

export const STOCK_COUNT_SORT_KEYS = ["openedAt", "status"] as const;
export type StockCountSortKey = (typeof STOCK_COUNT_SORT_KEYS)[number];

export const STOCK_COUNT_FACET_KEYS = ["open", "closed"] as const;
export type StockCountFacet = (typeof STOCK_COUNT_FACET_KEYS)[number];

export const listStockCountsInput = listQueryBase.extend({
  sortBy: z.enum(STOCK_COUNT_SORT_KEYS).default("openedAt"),
  filter: z.enum(["all", ...STOCK_COUNT_FACET_KEYS]).default("all"),
  sortDir: listQueryBase.shape.sortDir.default("desc"),
});

/**
 * Which side of the variance report to page through.
 *
 * Three disjoint questions rather than three facets on one list: "missing" is
 * a query over `PaperRoll` (countable reels with no line), while the other two
 * are queries over `StockCountLine`. They cannot share a delegate, so they are
 * a discriminator on the input instead of a facet key.
 */
export const VARIANCE_SIDES = ["counted", "missing", "unexpected"] as const;
export type VarianceSide = (typeof VARIANCE_SIDES)[number];

export const varianceInput = listQueryBase.extend({
  id: z.string().min(1),
  side: z.enum(VARIANCE_SIDES).default("missing"),
  // Present so the shape matches `ListQuery`; there is only ever "all". The
  // three sides are the chips, and they are not facets of one set.
  filter: z.literal("all").default("all"),
  sortDir: listQueryBase.shape.sortDir.default("asc"),
});

export type OpenStockCountInput = z.infer<typeof openStockCountInput>;
export type CountScanInput = z.infer<typeof countScanInput>;
export type StockCountIdInput = z.infer<typeof stockCountIdInput>;
export type ListStockCountsInput = z.infer<typeof listStockCountsInput>;
export type VarianceInput = z.infer<typeof varianceInput>;
