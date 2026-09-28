import { listQueryBase } from "@repo/api-contract";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import type { ListDeclaration } from "../list/list-query";

/**
 * `level` is the v3 default: out first, then low, then the rest, each by how
 * much of its threshold is left — `stockLevel`, kept by a trigger (see the
 * InkColour model). `usage` counts the colour's usage lines.
 */
export const INK_SORT_KEYS = ["level", "code", "name", "usage", "stock", "updatedAt"] as const;
export type InkSortKey = (typeof INK_SORT_KEYS)[number];

/**
 * `low`, `out`, `ok` and `archived` partition the table, by the contract's
 * `inkStockState` rule as stored in `stockLevel` (0 out, (1, 2] low, ≥ 3 ok).
 *
 * `inStock` (low + ok: ink left) is the usage picker's filter and overlaps
 * both, so it is excluded from the "all" sum.
 */
export const INK_FACET_KEYS = ["low", "out", "ok", "archived", "inStock"] as const;
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
    // Level and usage tie a lot (every colour without a threshold is level
    // 4), so the code breaks those ties readably before the id does.
    level: (dir) => [{ active: "desc" }, { stockLevel: dir }, { code: "asc" }],
    code: (dir) => [{ active: "desc" }, { code: dir }],
    name: (dir) => [{ active: "desc" }, { name: dir }],
    usage: (dir) => [{ active: "desc" }, { usages: { _count: dir } }, { code: "asc" }],
    stock: (dir) => [{ active: "desc" }, { stock: dir }],
    updatedAt: (dir) => [{ active: "desc" }, { updatedAt: dir }],
  },
  defaultSort: "level",
  searchable: ["code", "name"],
  facets: {
    low: { active: true, stockLevel: { gt: 0, lt: 3 } },
    out: { active: true, stockLevel: 0 },
    ok: { active: true, stockLevel: { gte: 3 } },
    archived: { active: false },
    inStock: { active: true, stock: { gt: 0 } },
  },
  nonPartitioning: ["inStock"],
};

export const INK_SELECT = {
  id: true,
  code: true,
  name: true,
  hex: true,
  unit: true,
  stock: true,
  stockLevel: true,
  alertThreshold: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  /// How many usage lines name it — the `usage` sort, and what decides
  /// whether it can be deleted.
  _count: { select: { usages: true } },
  /// The card's "delivered on / counted on / archived on" line: the latest
  /// movement of any kind, so a restore replaces the archive it undid.
  movements: {
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: 1,
    select: { kind: true, at: true },
  },
  /// "Ran out on": the last draw, for a colour at zero.
  usages: {
    orderBy: [{ usedAt: "desc" }, { id: "desc" }],
    take: 1,
    select: { usedAt: true },
  },
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
  sortBy: z.enum(INK_SORT_KEYS).default("level"),
  filter: z.enum(["all", ...INK_FACET_KEYS]).default("all"),
  sortDir: listQueryBase.shape.sortDir.default("asc"),
});

export type ListInkColoursInput = z.infer<typeof listInkColoursInput>;
