import { listQueryBase } from "@repo/api-contract";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import type { ListDeclaration } from "../list/list-query";

export const CLIENT_SORT_KEYS = ["name", "registeredAt", "createdAt"] as const;
export type ClientSortKey = (typeof CLIENT_SORT_KEYS)[number];

export const CLIENT_FACET_KEYS = [
  "withContact",
  "withoutContact",
  "duplicates",
  "archived",
] as const;
export type ClientFacet = (typeof CLIENT_FACET_KEYS)[number];

/** The sort the list opens on: A->Z, how you look a customer up by name. */
export const CLIENT_DEFAULT_SORT: ClientSortKey = "name";

/**
 * The clients module's list vocabulary. Like user.list.ts this is a security
 * boundary: the client sends keys from these lists, never `where` objects.
 *
 * A factory rather than a constant because the `duplicates` facet is a set of
 * ids the service computes per request (see `ClientService.lookAlikes`) —
 * "near-identical name" is not a predicate Prisma can express. That facet
 * overlaps the contact split, so it is declared `nonPartitioning` and stays
 * out of the "all" sum.
 *
 * Every `sortable` key also appears in CLIENT_SELECT — ordering by an unselected
 * column leaks its values through row order.
 *
 * Every sort fragment leads with `active: "desc"`, so archived rows sink to the
 * bottom of any unfiltered view rather than interleaving with live ones. Prisma
 * orders `true` before `false` on a descending boolean, and `runListQuery` still
 * appends the `id` tiebreaker after whatever the fragment returns.
 *
 * The first two facets split on whether any contact detail exists, because the
 * legacy import left all 19 rows with none (see docs/legacy-migration.md): the
 * useful question about this table today is which rows still need filling in.
 *
 * They are scoped to active rows, and `archived` covers the rest, so the three
 * partition the table. `runListQuery` sums the facets into the "all" count that
 * DataTable renders, so a row outside every facet would make that chip disagree
 * with the pager.
 */
export function clientListDeclaration(
  duplicateIds: readonly string[],
): ListDeclaration<
  Prisma.ClientWhereInput,
  Prisma.ClientOrderByWithRelationInput,
  ClientSortKey,
  ClientFacet
> {
  return {
    sortable: {
      name: (dir) => [{ active: "desc" }, { name: dir }],
      registeredAt: (dir) => [{ active: "desc" }, { registeredAt: dir }],
      createdAt: (dir) => [{ active: "desc" }, { createdAt: dir }],
    },
    defaultSort: CLIENT_DEFAULT_SORT,
    searchable: ["name", "email", "phone", "taxId", "address"],
    facets: {
      withContact: {
        active: true,
        OR: [{ email: { not: null } }, { phone: { not: null } }],
      },
      withoutContact: { active: true, email: null, phone: null },
      // Only active rows are ever in `duplicateIds`, so no `active` clause.
      duplicates: { id: { in: [...duplicateIds] } },
      archived: { active: false },
    },
    nonPartitioning: ["duplicates"],
  };
}

export const CLIENT_SELECT = {
  id: true,
  name: true,
  taxId: true,
  address: true,
  email: true,
  phone: true,
  registeredAt: true,
  active: true,
  createdAt: true,
} satisfies Prisma.ClientSelect;

export const listClientsInput = listQueryBase.extend({
  sortBy: z.enum(CLIENT_SORT_KEYS).default(CLIENT_DEFAULT_SORT),
  filter: z.enum(["all", ...CLIENT_FACET_KEYS]).default("all"),
  // Overrides the base's "desc": this list defaults to sorting by name, which
  // reads A->Z, unlike the users list where newest-first is what you want.
  sortDir: listQueryBase.shape.sortDir.default("asc"),
});

export type ListClientsInput = z.infer<typeof listClientsInput>;
