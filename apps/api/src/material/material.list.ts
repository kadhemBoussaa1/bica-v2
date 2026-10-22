import { listQueryBase } from "@repo/api-contract";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import { contains, type ListDeclaration } from "../list/list-query";

/**
 * No sort by price: the price lives in `RawMaterialPrice`, and Prisma cannot
 * order by a filtered relation (the current row). `type` sorts papers before
 * glues, then by label.
 */
export const MATERIAL_SORT_KEYS = ["label", "code", "type"] as const;
export type MaterialSortKey = (typeof MATERIAL_SORT_KEYS)[number];

/**
 * `paper` and `glue` count live materials only, and `archived` every archived
 * one, so the three partition the catalogue and "all" is their sum.
 */
export const MATERIAL_FACET_KEYS = ["paper", "glue", "archived"] as const;
export type MaterialFacet = (typeof MATERIAL_FACET_KEYS)[number];

/**
 * The material list's vocabulary — a security boundary, see client.list.ts.
 *
 * `type` and `paperType` are enum columns, so they are never searched
 * (Prisma rejects `contains` on an enum at runtime); the chips cover `type`.
 */
export const materialListDeclaration: ListDeclaration<
  Prisma.RawMaterialWhereInput,
  Prisma.RawMaterialOrderByWithRelationInput,
  MaterialSortKey,
  MaterialFacet
> = {
  sortable: {
    label: (dir) => [{ active: "desc" }, { label: dir }],
    code: (dir) => [{ active: "desc" }, { code: dir }],
    type: (dir) => [{ active: "desc" }, { type: dir }, { label: "asc" }],
  },
  defaultSort: "label",
  searchable: (term) => ({
    OR: [
      { code: contains(term) },
      { label: contains(term) },
      { supplier: { name: contains(term) } },
    ],
  }),
  facets: {
    paper: { active: true, type: "PAPER" },
    glue: { active: true, type: "GLUE" },
    archived: { active: false },
  },
};

/** The price a material is at now: the one row with no `validTo`. */
export const CURRENT_PRICE = {
  where: { validTo: null },
  take: 1,
  select: { id: true, kiloPrice: true, validFrom: true },
} satisfies Prisma.RawMaterial$pricesArgs;

export const MATERIAL_SELECT = {
  id: true,
  code: true,
  label: true,
  type: true,
  supplier: { select: { id: true, name: true } },
  paperType: true,
  grammage: true,
  active: true,
  updatedAt: true,
  prices: CURRENT_PRICE,
  defaults: { select: { slot: true }, orderBy: { slot: "asc" } },
} satisfies Prisma.RawMaterialSelect;

export const listMaterialsInput = listQueryBase.extend({
  sortBy: z.enum(MATERIAL_SORT_KEYS).default("label"),
  filter: z.enum(["all", ...MATERIAL_FACET_KEYS]).default("all"),
  sortDir: listQueryBase.shape.sortDir.default("asc"),
});

export type ListMaterialsInput = z.infer<typeof listMaterialsInput>;
