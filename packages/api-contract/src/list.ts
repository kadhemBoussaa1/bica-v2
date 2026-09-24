import { z } from "zod";

/** The page sizes the UI offers. A closed set, so `pageSize` cannot be abused. */
export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 10;

export const sortDirSchema = z.enum(["asc", "desc"]);
export type SortDir = z.infer<typeof sortDirSchema>;

/**
 * The mechanics half of a list input. Each module `.extend()`s this with its OWN
 * `sortBy` and `filter` enums, which is what lets the declaration live server-side
 * while both stay Zod-validated: the module owns the vocabulary, the contract owns
 * the mechanics.
 *
 * Deliberately a plain object schema rather than a generic factory — `.extend()`
 * gives the same type safety with none of the const-generic inference.
 */
export const listQueryBase = z.object({
  // 1-based to match what the pager displays, so `skip = (page - 1) * pageSize`
  // and `page: 0` is rejected rather than silently meaning page 1.
  page: z.number().int().min(1).default(1),
  pageSize: z.literal(PAGE_SIZES).default(DEFAULT_PAGE_SIZE),
  sortDir: sortDirSchema.default("desc"),
  // Empty / whitespace-only input normalises to undefined so a vacuous
  // `contains: ""` clause never reaches Prisma.
  search: z
    .string()
    .max(200)
    .optional()
    .transform((s) => {
      const trimmed = s?.trim();
      return trimmed ? trimmed : undefined;
    }),
});

export type ListQueryBase = z.infer<typeof listQueryBase>;

/**
 * A page of rows plus everything the pager and facet chips need.
 *
 * Not a Zod schema on purpose: tRPC infers output types from the resolver's
 * return and the web client picks them up through `AppRouter`, so runtime output
 * validation would buy nothing while a generic Zod schema would cost inference.
 */
export interface ListResult<TRow, TFacetKey extends string = string> {
  rows: TRow[];
  /** Matches scope + search + the active facet; this is what divides into `pageCount`. */
  total: number;
  page: number;
  pageSize: number;
  /** Computed server-side so every caller agrees on where the last page is. */
  pageCount: number;
  /**
   * One entry per declared facet key, plus "all". Counted WITHOUT the active
   * facet, so selecting one chip does not zero the others.
   */
  facetCounts: Record<TFacetKey | "all", number>;
  /**
   * Module-defined sums over the same rows `total` counts — scope + search +
   * the active facet — for a list whose header reports a quantity as well as
   * a row count (stock's weight in tonnes, say).
   *
   * Optional, and absent unless the module asks for it: every other list is
   * a row count and gains nothing from a second aggregate query. Computed
   * inside `runListQuery`'s transaction, so a figure in the header can never
   * describe a different snapshot than the page beneath it.
   */
  aggregates?: Record<string, number>;
}
