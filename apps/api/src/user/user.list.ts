import { listQueryBase } from "@repo/api-contract";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import type { ListDeclaration } from "../list/list-query";

export const USER_SORT_KEYS = ["name", "email", "role", "createdAt"] as const;
export type UserSortKey = (typeof USER_SORT_KEYS)[number];

export const USER_FACET_KEYS = ["active", "banned"] as const;
export type UserFacet = (typeof USER_FACET_KEYS)[number];

/**
 * The users module's list vocabulary. This file is a security boundary: the
 * client sends keys from these lists, never `where` objects.
 *
 * Every key in `sortable` also appears in `USER_SELECT` below. banReason,
 * banExpires and image are absent from both — ordering by an unselected column
 * leaks its values through row order even though the column is never returned.
 *
 * `role` is sortable but deliberately NOT searchable: it is an enum column and
 * Prisma rejects `contains` on an enum at runtime. Sorting by it exposes enum
 * declaration order, which is nothing the caller cannot already read from the
 * rendered column — the invariant doing its job, not an exception to it.
 */
export const userListDeclaration: ListDeclaration<
  Prisma.UserWhereInput,
  Prisma.UserOrderByWithRelationInput,
  UserSortKey,
  UserFacet
> = {
  sortable: {
    name: (dir) => ({ name: dir }),
    email: (dir) => ({ email: dir }),
    role: (dir) => ({ role: dir }),
    createdAt: (dir) => ({ createdAt: dir }),
  },
  defaultSort: "createdAt",
  searchable: ["name", "email"],
  facets: {
    active: { banned: false },
    banned: { banned: true },
  },
};

export const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  banned: true,
  createdAt: true,
  createdById: true,
  /// Whose account this is, for the employee form's "Linked account" picker
  /// (it offers unlinked accounts) and to say on the users list who signs
  /// in with it. A relation, not a sort or search key.
  employee: { select: { id: true, matricule: true } },
} satisfies Prisma.UserSelect;

/**
 * Built from the module's own key lists, so the procedure's validation and the
 * declaration cannot drift: adding a sort key in one place adds it in both.
 */
export const listUsersInput = listQueryBase.extend({
  sortBy: z.enum(USER_SORT_KEYS).default(userListDeclaration.defaultSort),
  filter: z.enum(["all", ...USER_FACET_KEYS]).default("all"),
});

export type ListUsersInput = z.infer<typeof listUsersInput>;
