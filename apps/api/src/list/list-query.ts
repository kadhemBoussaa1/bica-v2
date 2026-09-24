import type { ListResult, SortDir } from "@repo/api-contract";
import type { Prisma } from "../generated/prisma/client.js";
import type { PrismaService } from "../prisma.service";

/**
 * The per-module vocabulary. `TWhere`/`TOrderBy` are the model's Prisma input
 * types, so a declaration cannot name a column the model does not have.
 *
 * The invariant every declaration must hold: a column is sortable only if it is
 * also selected. Ordering by something the caller cannot read leaks it through
 * row order, so `sortable` is an allowlist checked against the module's
 * `select`, not a blocklist of known-sensitive columns.
 */
export interface ListDeclaration<
  TWhere,
  TOrderBy,
  TSortKey extends string,
  TFacetKey extends string,
> {
  /**
   * Allowlisted sort keys -> Prisma orderBy fragments. Must be a subset of
   * `select`.
   *
   * A key may return an array to sort on more than one column: the clients and
   * suppliers lists lead with `active: "desc"` so archived rows sink to the
   * bottom of an unfiltered view. `runListQuery` appends the `id` tiebreaker
   * after whatever comes back either way.
   */
  sortable: Record<TSortKey, (dir: SortDir) => TOrderBy | TOrderBy[]>;
  defaultSort: TSortKey;
  /**
   * How `query.search` becomes a `where` fragment.
   *
   * The common case is a list of column names: each is searched with
   * case-insensitive `contains`, OR'd together. String columns only — Prisma
   * rejects `contains` on an enum at runtime.
   *
   * A function is the escape hatch for a search that reaches across a
   * relation (`product.name`, `client.name`), which cannot be named as a flat
   * column: the module builds its own `TWhere` fragment from the term, e.g.
   * `(term) => ({ OR: [contains(term, "numero"), { product: { name:
   * contains(term) } }] })`.
   */
  searchable: readonly string[] | ((term: string) => TWhere);
  /**
   * Facet key -> Prisma where fragment. "all" is implicit and adds no fragment.
   *
   * Declared facets are assumed to partition the scoped set: the "all" count is
   * their sum rather than a fifth query. Overlapping facets would over-count it.
   */
  facets: Record<TFacetKey, TWhere>;
  /**
   * Facet keys that overlap the partition rather than extend it, e.g. the
   * clients list's `duplicates`, which cuts across "has contact" / "needs
   * contact". They are counted like any other facet but left out of the
   * "all" sum, or every row they match would be counted twice.
   */
  nonPartitioning?: readonly TFacetKey[];
}

/**
 * The two queries the helper needs from a Prisma model delegate.
 *
 * Supplied as closures rather than the delegate itself so the module can apply
 * its own `select` and have the row type flow back out — `TRow` ends up being
 * the exact selected payload instead of the full model. The return type is
 * `PrismaPromise`, not `Promise`, because that is what `$transaction`'s array
 * form accepts; a plain `Promise` typechecks and then throws at runtime.
 */
interface ListDelegate<TRow, TWhere, TOrderBy> {
  findMany(args: {
    where: TWhere;
    orderBy: TOrderBy[];
    skip: number;
    take: number;
  }): Prisma.PrismaPromise<TRow[]>;
  count(args: { where: TWhere }): Prisma.PrismaPromise<number>;
}

export interface ListQuery<TSortKey extends string, TFacetKey extends string> {
  page: number;
  pageSize: number;
  search?: string;
  sortDir: SortDir;
  sortBy: TSortKey;
  filter: TFacetKey | "all";
}

/**
 * Runs one page of a list: rows, the matching total, and a count per facet.
 *
 * `sortBy` and `filter` arrive already defaulted by the module's Zod schema, so
 * they are required here — a `?? defaultSort` fallback could silently diverge
 * from the schema's default.
 */
export async function runListQuery<
  TRow,
  TWhere,
  TOrderBy,
  TSortKey extends string,
  TFacetKey extends string,
>(args: {
  prisma: PrismaService;
  delegate: ListDelegate<TRow, TWhere, TOrderBy>;
  query: ListQuery<TSortKey, TFacetKey>;
  declaration: ListDeclaration<TWhere, TOrderBy, TSortKey, TFacetKey>;
  /** Session-derived. AND-ed with everything else; never client-supplied. */
  scope: TWhere;
  /**
   * Optional module-defined sums over the rows `total` counts, for a header
   * figure like stock's weight in tonnes. Receives the fully-assembled
   * `where` — scope AND search AND the active facet — and returns a query
   * that joins the same transaction, so the figure and the page can never
   * describe different snapshots.
   *
   * Prefer a Prisma `aggregate` here. Each must be a `PrismaPromise`: a plain
   * `Promise` typechecks in `$transaction`'s array form and then throws.
   *
   * An ARRAY, because one query cannot always carry the figure a header wants.
   * Purchasing reports its orders' value per currency, which is two sums over
   * the same rows with a different `where` each — Prisma's `aggregate` has no
   * conditional form, so it takes two queries. They are appended to the same
   * transaction and their results merged in order, so a later entry's column
   * wins if two name the same key.
   */
  aggregate?: (where: TWhere) => Prisma.PrismaPromise<Record<string, unknown>>[];
}): Promise<ListResult<TRow, TFacetKey>> {
  const { prisma, delegate, query, declaration, scope, aggregate } = args;

  // The where fragments below are assembled structurally, which TypeScript
  // cannot check against an unresolved `TWhere`. The shapes are Prisma's own
  // `AND`/`OR` combinators, which every model's WhereInput accepts.
  //
  // A leading-wildcard ILIKE cannot use a btree index — this is a sequential
  // scan by construction. Fine at admin scale; pg_trgm is the upgrade path
  // once a list outgrows it.
  const searchFragment = query.search
    ? typeof declaration.searchable === "function"
      ? declaration.searchable(query.search)
      : ({
          OR: declaration.searchable.map((field) => ({
            [field]: { contains: query.search, mode: "insensitive" },
          })),
        } as TWhere)
    : undefined;

  // Scope comes first and is never optional. Everything else is AND-ed onto it,
  // so no input can widen what the caller is allowed to see.
  const base = {
    AND: searchFragment ? [scope, searchFragment] : [scope],
  } as TWhere;

  const facets = declaration.facets as Record<string, TWhere | undefined>;
  const activeFacet = query.filter === "all" ? undefined : facets[query.filter];
  const where = activeFacet ? ({ AND: [base, activeFacet] } as TWhere) : base;

  const sortFragment = declaration.sortable[query.sortBy];
  const sortValue = sortFragment(query.sortDir);
  const orderBy = [
    // A declaration may sort on several columns; flatten so the tiebreaker
    // stays last rather than being nested inside the fragment.
    ...(Array.isArray(sortValue) ? sortValue : [sortValue]),
    // A unique tiebreaker on every sort. Without it a low-cardinality ORDER BY
    // leaves ties whose order across pages is undefined, so a row can show up
    // on two pages or on none.
    { id: "asc" } as TOrderBy,
  ];

  const skip = (query.page - 1) * query.pageSize;

  // Facet counts must ignore the active facet — they count scope + search only,
  // which is exactly `base`. Counting against `where` instead would make every
  // inactive chip read 0 as soon as one is selected.
  const facetKeys = Object.keys(declaration.facets) as TFacetKey[];
  const facetQueries = facetKeys.map((key) =>
    delegate.count({ where: { AND: [base, facets[key]] } as TWhere }),
  );

  // One transaction so `rows`, `total`, the facet counts and any aggregate all
  // describe the same snapshot; a concurrent insert between separate queries
  // would make the total disagree with the page. The array form keeps this to
  // one connection with no long-running interactive transaction.
  //
  // Positions are read back by index rather than with a trailing rest: the
  // facet counts are a variable-length run, so an `...counts` rest would
  // swallow anything appended after them and shift every chip's number by
  // one. The aggregate therefore has a fixed slot, and `counts` is sliced to
  // exactly the facets that were queried.
  const results = await prisma.$transaction([
    delegate.findMany({ where, orderBy, skip, take: query.pageSize }),
    delegate.count({ where }),
    ...facetQueries,
    ...(aggregate ? aggregate(where) : []),
  ]);

  const rows = results[0] as TRow[];
  const total = results[1] as number;
  const counts = results.slice(2, 2 + facetQueries.length) as number[];
  // Everything after the facet run, which is however many queries the module
  // asked for. Sliced rather than indexed: the count is the module's, not a
  // fixed one.
  const aggregateRows = aggregate
    ? (results.slice(2 + facetQueries.length) as Record<string, unknown>[])
    : [];

  // Built from `facetKeys` rather than from the results, so a declared facet
  // with no matching rows is present as an explicit 0 instead of missing.
  const facetCounts = {} as Record<TFacetKey | "all", number>;
  let all = 0;
  const overlapping = declaration.nonPartitioning ?? [];
  facetKeys.forEach((key, index) => {
    const count = counts[index] ?? 0;
    facetCounts[key] = count;
    if (!overlapping.includes(key)) all += count;
  });
  // No declared facets: nothing to sum, and "all" is exactly `total` (the
  // filter can only be "all").
  facetCounts.all = facetKeys.length === 0 ? total : all;

  // Prisma's aggregate nests by operation (`{ _sum: { poidsRestant: 12 } }`),
  // while `aggregates` is flat so a caller reads `aggregates.poidsRestant`.
  // Flattened one level here, skipping nulls: `_sum` over an empty set is
  // NULL per column, and a header figure wants 0 rather than a missing key.
  const aggregates =
    aggregateRows.length > 0
      ? aggregateRows.reduce<Record<string, number>>((flat, row) => {
          for (const group of Object.values(row)) {
            if (group === null || typeof group !== "object") continue;
            for (const [column, value] of Object.entries(group)) {
              flat[column] = typeof value === "number" ? value : 0;
            }
          }
          return flat;
        }, {})
      : undefined;

  return {
    rows,
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    facetCounts,
    ...(aggregates ? { aggregates } : {}),
  };
}

/**
 * `{ contains: term, mode: "insensitive" }` — the fragment a function-form
 * `searchable` builds by hand for each field it names, e.g. `contains(term)`
 * for a flat column or `{ product: { name: contains(term) } }` for a related
 * one. Matches exactly what the array form of `searchable` already produces
 * per field, so a module can mix a flat column and a relation in one search
 * without the two behaving differently.
 */
export function contains(term: string): { contains: string; mode: "insensitive" } {
  return { contains: term, mode: "insensitive" };
}
