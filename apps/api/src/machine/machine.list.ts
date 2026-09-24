import { listQueryBase } from "@repo/api-contract";
import { z } from "zod";
import { MACHINE_TYPES } from "@repo/api-contract";
import type { Prisma } from "../generated/prisma/client.js";
import type { ListDeclaration } from "../list/list-query";

export const MACHINE_SORT_KEYS = ["name", "code", "type", "purchaseDate", "createdAt"] as const;
export type MachineSortKey = (typeof MACHINE_SORT_KEYS)[number];

/** The eight types, plus "archived" so the facets partition the table. */
export const MACHINE_FACET_KEYS = [...MACHINE_TYPES, "archived"] as const;
export type MachineFacet = (typeof MACHINE_FACET_KEYS)[number];

/**
 * The machines module's list vocabulary — a security boundary, see client.list.ts.
 *
 * `type` is sortable but NOT searchable: it is an enum column and Prisma rejects
 * `contains` on an enum at runtime. Filter by it with the facet chips.
 *
 * Sort fragments lead with `active: "desc"` so archived machines sink to the
 * bottom; `runListQuery` appends the `id` tiebreaker. That tiebreaker matters
 * more here than elsewhere — `name` is not unique (two machines share one, see
 * the schema), so without it the two would have undefined relative order.
 */
export const machineListDeclaration: ListDeclaration<
  Prisma.MachineWhereInput,
  Prisma.MachineOrderByWithRelationInput,
  MachineSortKey,
  MachineFacet
> = {
  sortable: {
    name: (dir) => [{ active: "desc" }, { name: dir }],
    code: (dir) => [{ active: "desc" }, { code: dir }],
    type: (dir) => [{ active: "desc" }, { type: dir }],
    purchaseDate: (dir) => [{ active: "desc" }, { purchaseDate: dir }],
    createdAt: (dir) => [{ active: "desc" }, { createdAt: dir }],
  },
  defaultSort: "name",
  searchable: ["name", "code", "brand"],
  facets: {
    ...(Object.fromEntries(
      MACHINE_TYPES.map((type) => [type, { active: true, type }]),
    ) as Record<(typeof MACHINE_TYPES)[number], Prisma.MachineWhereInput>),
    archived: { active: false },
  },
};

/**
 * The sort keys the shop floor may use: the ones `MACHINE_SELECT_FLOOR`
 * carries. `purchaseDate` and `createdAt` are not in that select, so sorting
 * by them would reveal them through row order; `MachineService.list`
 * refuses them below ADMIN.
 */
export const MACHINE_FLOOR_SORT_KEYS = ["name", "code", "type"] as const satisfies readonly MachineSortKey[];

/**
 * The floor's declaration: the same sorts and facets, but searching only the
 * columns the floor select returns. A search over `brand` would let a caller
 * probe a column it is never sent, one match at a time.
 */
export const machineFloorListDeclaration: typeof machineListDeclaration = {
  ...machineListDeclaration,
  searchable: ["name", "code"],
};

/**
 * What PRODUCTION reads: the run form's machine picker, filtered by type and
 * `active`, labelled "name (code)". No purchase price, invoice, supplier or
 * capability ranges — those are the admin record, which `byId` serves to
 * ADMIN only. A `select` split, not a filter, for the reason
 * `ORDER_LIST_SELECT` gives.
 */
export const MACHINE_SELECT_FLOOR = {
  id: true,
  code: true,
  name: true,
  type: true,
  active: true,
} satisfies Prisma.MachineSelect;

/**
 * Named so `MachineService.list` can declare its return type as the union
 * of the two shapes; an inferred one would subtype-reduce to the floor row.
 */
export type MachineRowFloor = Prisma.MachineGetPayload<{ select: typeof MACHINE_SELECT_FLOOR }>;

export const MACHINE_SELECT = {
  id: true,
  code: true,
  name: true,
  type: true,
  brand: true,
  price: true,
  purchaseDate: true,
  imageUrl: true,
  invoiceUrl: true,
  supplierId: true,
  supplier: { select: { id: true, name: true } },
  laize: true,
  laizeMin: true,
  laizeMax: true,
  grammage: true,
  grammageMin: true,
  grammageMax: true,
  grammageMinWithoutHandle: true,
  grammageMaxWithoutHandle: true,
  grammageMinWithHandle: true,
  grammageMaxWithHandle: true,
  grammageMinKraft: true,
  grammageMaxKraft: true,
  grammageMinLaminatedKraft: true,
  grammageMaxLaminatedKraft: true,
  lengthMin: true,
  lengthMax: true,
  widthMin: true,
  widthMax: true,
  active: true,
  createdAt: true,
} satisfies Prisma.MachineSelect;

export const listMachinesInput = listQueryBase.extend({
  sortBy: z.enum(MACHINE_SORT_KEYS).default("name"),
  filter: z.enum(["all", ...MACHINE_FACET_KEYS]).default("all"),
  sortDir: listQueryBase.shape.sortDir.default("asc"),
});

export type ListMachinesInput = z.infer<typeof listMachinesInput>;

export type MachineRow = Prisma.MachineGetPayload<{ select: typeof MACHINE_SELECT }>;
