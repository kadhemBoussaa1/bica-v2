import { listQueryBase } from "@repo/api-contract";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import type { ListDeclaration } from "../list/list-query";

export const SUPPLIER_SORT_KEYS = [
  "name",
  "family",
  "vatRate",
  "createdAt",
] as const;
export type SupplierSortKey = (typeof SUPPLIER_SORT_KEYS)[number];

/**
 * Facets that exist regardless of what is in `SupplierFamily`. The family facets
 * are added per-request by `supplierListDeclaration` below; `duplicates` is the
 * look-alike-name facet, computed per request like the clients list's.
 */
export const SUPPLIER_FIXED_FACETS = [
  "unassigned",
  "duplicates",
  "archived",
] as const;

/**
 * A family facet key is the family's `code`, so the client still sends a key and
 * never a `where` object. Codes are validated as a closed set per request: the
 * procedure's Zod schema cannot know them at build time, so the service checks
 * the incoming filter against the families it just read.
 */
export type SupplierFacet = string;

/**
 * The suppliers module's list vocabulary — a security boundary, see client.list.ts.
 *
 * Unlike the users and clients declarations this one is a FUNCTION, because the
 * facet set is data: families live in `SupplierFamily` and an ADMIN can add one
 * without a deploy. The caller reads the families first and passes their codes,
 * which keeps the "client sends keys, never predicates" rule intact — a code
 * that is not in this list is rejected rather than reaching Prisma.
 *
 * Every sort fragment leads with `active: "desc"` so archived rows sink to the
 * bottom of any unfiltered view; `runListQuery` appends the `id` tiebreaker.
 *
 * `family` sorts by the related row's `sortOrder` then `label` — the same order
 * the picker and the chips use — rather than by the raw foreign key, which would
 * order by cuid and look random. Uncategorised rows sort last on `sortOrder`
 * because a null relation orders after present ones in Postgres by default.
 */
export function supplierListDeclaration(
  familyCodes: readonly string[],
  duplicateIds: readonly string[],
): ListDeclaration<
  Prisma.SupplierWhereInput,
  Prisma.SupplierOrderByWithRelationInput,
  SupplierSortKey,
  SupplierFacet
> {
  return {
    sortable: {
      name: (dir) => [{ active: "desc" }, { name: dir }],
      family: (dir) => [
        { active: "desc" },
        { family: { sortOrder: dir } },
        { family: { label: dir } },
      ],
      vatRate: (dir) => [{ active: "desc" }, { vatRate: dir }],
      createdAt: (dir) => [{ active: "desc" }, { createdAt: dir }],
    },
    defaultSort: "name",
    searchable: [
      "name",
      "email",
      "phone",
      "phone2",
      "taxId",
      "address",
      "website",
    ],
    facets: {
      // One facet per family code. Scoped to active suppliers so these plus
      // `unassigned` and `archived` partition the table — `runListQuery` sums
      // them for the "all" count DataTable renders, and a row outside every
      // facet would make that chip disagree with the pager.
      ...Object.fromEntries(
        familyCodes.map((code) => [
          code,
          {
            active: true,
            family: { code },
          } satisfies Prisma.SupplierWhereInput,
        ]),
      ),
      unassigned: { active: true, familyId: null },
      // Cuts across the family split, so it is `nonPartitioning` and stays
      // out of the "all" sum. Only active rows are ever in `duplicateIds`.
      duplicates: { id: { in: [...duplicateIds] } },
      archived: { active: false },
    },
    nonPartitioning: ["duplicates"],
  };
}

export const SUPPLIER_SELECT = {
  id: true,
  name: true,
  taxId: true,
  address: true,
  email: true,
  phone: true,
  phone2: true,
  fax: true,
  website: true,
  familyId: true,
  /// The label is what the table renders and what `family` sorts on, so the
  /// relation is selected rather than just the foreign key.
  family: { select: { id: true, code: true, label: true } },
  vatRate: true,
  vatRateNote: true,
  active: true,
  createdAt: true,
} satisfies Prisma.SupplierSelect;

/**
 * `filter` is a plain string here rather than a Zod enum, because the valid
 * family codes are rows and are not known at build time. The service checks it
 * against the families it reads and rejects anything else — the allowlist still
 * exists, it just lives one layer in.
 */
export const listSuppliersInput = listQueryBase.extend({
  sortBy: z.enum(SUPPLIER_SORT_KEYS).default("name"),
  filter: z.string().max(40).default("all"),
  sortDir: listQueryBase.shape.sortDir.default("asc"),
});

export type ListSuppliersInput = z.infer<typeof listSuppliersInput>;
