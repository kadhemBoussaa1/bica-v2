import { listQueryBase } from "@repo/api-contract";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import type { ListDeclaration } from "../list/list-query";

export const INK_SORT_KEYS = ["code", "name", "stock", "updatedAt"] as const;
export type InkSortKey = (typeof INK_SORT_KEYS)[number];

/**
 * Three chips that partition the table: colours with ink left, colours run
 * dry, and the archive. "Low" is deliberately NOT a facet — it compares two
 * columns of the same row (`stock <= alertThreshold`), which the static
 * `where` fragments here cannot express — so it is a badge on the row, drawn
 * from the two values the select already returns.
 */
export const INK_FACET_KEYS = ["inStock", "out", "archived"] as const;
export type InkFacet = (typeof INK_FACET_KEYS)[number];

/**
 * The ink module's list vocabulary — a security boundary, see client.list.ts.
 *
 * `unit` is an enum column: sortable would be pointless with two values and
 * `contains` on it is rejected by Prisma, so it is neither.
 */
export const inkListDeclaration: ListDeclaration<
  Prisma.InkColourWhereInput,
  Prisma.InkColourOrderByWithRelationInput,
  InkSortKey,
  InkFacet
> = {
  sortable: {
    code: (dir) => [{ active: "desc" }, { code: dir }],
    name: (dir) => [{ active: "desc" }, { name: dir }],
    stock: (dir) => [{ active: "desc" }, { stock: dir }],
    updatedAt: (dir) => [{ active: "desc" }, { updatedAt: dir }],
  },
  defaultSort: "code",
  searchable: ["code", "name"],
  facets: {
    inStock: { active: true, stock: { gt: 0 } },
    out: { active: true, stock: { lte: 0 } },
    archived: { active: false },
  },
};

export const INK_SELECT = {
  id: true,
  code: true,
  name: true,
  unit: true,
  stock: true,
  alertThreshold: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  /// How many usage lines name it — what decides whether it can be deleted.
  _count: { select: { usages: true } },
} satisfies Prisma.InkColourSelect;

export const INK_USAGE_SELECT = {
  id: true,
  quantity: true,
  usedAt: true,
  note: true,
  colourId: true,
  colour: { select: { id: true, code: true, name: true, unit: true } },
  orderId: true,
  order: { select: { id: true, numero: true } },
  recordedBy: { select: { id: true, name: true } },
  createdAt: true,
} satisfies Prisma.InkUsageSelect;

export const listInkColoursInput = listQueryBase.extend({
  sortBy: z.enum(INK_SORT_KEYS).default("code"),
  filter: z.enum(["all", ...INK_FACET_KEYS]).default("all"),
  sortDir: listQueryBase.shape.sortDir.default("asc"),
});

export type ListInkColoursInput = z.infer<typeof listInkColoursInput>;
