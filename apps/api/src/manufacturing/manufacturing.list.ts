import { listQueryBase } from "@repo/api-contract";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import { contains, type ListDeclaration } from "../list/list-query";

export const MANUFACTURING_ORDER_SORT_KEYS = ["createdAt", "numero", "order", "client"] as const;
export type ManufacturingOrderSortKey = (typeof MANUFACTURING_ORDER_SORT_KEYS)[number];

/** The four OF statuses partition the table. */
export const MANUFACTURING_ORDER_FACET_KEYS = ["draft", "inProgress", "done", "cancelled"] as const;
export type ManufacturingOrderFacet = (typeof MANUFACTURING_ORDER_FACET_KEYS)[number];

/**
 * The OF list's vocabulary — a security boundary, see client.list.ts.
 *
 * `order` and `client` sort by the related number and name rather than a
 * foreign key, which would order by cuid. The search reaches the old app's
 * number too: staff still hold sheets printed with it, and 27 of those
 * numbers end in the digits of another order's number.
 */
export const manufacturingOrderListDeclaration: ListDeclaration<
  Prisma.ManufacturingOrderWhereInput,
  Prisma.ManufacturingOrderOrderByWithRelationInput,
  ManufacturingOrderSortKey,
  ManufacturingOrderFacet
> = {
  sortable: {
    createdAt: (dir) => ({ createdAt: dir }),
    numero: (dir) => ({ numero: dir }),
    order: (dir) => ({ order: { numero: dir } }),
    client: (dir) => ({ order: { client: { name: dir } } }),
  },
  defaultSort: "createdAt",
  searchable: (term) => ({
    OR: [
      { numero: contains(term) },
      { legacyNumero: contains(term) },
      { order: { numero: contains(term) } },
      { order: { client: { name: contains(term) } } },
    ],
  }),
  facets: {
    draft: { status: "DRAFT" },
    inProgress: { status: "IN_PROGRESS" },
    done: { status: "DONE" },
    cancelled: { status: "CANCELLED" },
  },
};

const EMPLOYEE = {
  select: { id: true, firstName: true, lastName: true, matricule: true, photo: true },
} as const;

/**
 * Every action rides along (10–20 per OF) so the service can derive the
 * progress strip and the current action without a second query; they are
 * not sortable. One assignee per action is enough: the row shows who is on
 * the current one.
 */
export const MANUFACTURING_ORDER_LIST_SELECT = {
  id: true,
  numero: true,
  legacyNumero: true,
  status: true,
  adapted: true,
  lastActivityAt: true,
  createdAt: true,
  createdByName: true,
  template: { select: { id: true, name: true } },
  order: {
    select: {
      id: true,
      numero: true,
      client: { select: { id: true, name: true } },
      // The order's photo is its product's first image, as on the orders grid.
      product: { select: { name: true, images: true } },
    },
  },
  actions: {
    select: {
      label: true,
      status: true,
      startedAt: true,
      completedAt: true,
      assignees: {
        select: { employee: EMPLOYEE },
        orderBy: [{ employee: { lastName: "asc" } }, { employeeId: "asc" }],
        take: 1,
      },
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.ManufacturingOrderSelect;

/** One action as the OF page draws it: its definition, its state and all it holds. */
export const MANUFACTURING_ACTION_SELECT = {
  id: true,
  position: true,
  label: true,
  handlesEmployees: true,
  handlesMachine: true,
  handlesAttachments: true,
  status: true,
  startedAt: true,
  completedAt: true,
  machine: { select: { id: true, name: true, code: true } },
  assignees: {
    select: { employee: EMPLOYEE },
    orderBy: [{ employee: { lastName: "asc" } }, { employeeId: "asc" }],
  },
  attachments: {
    select: { id: true, url: true, filename: true, contentType: true, size: true, createdAt: true },
    orderBy: { id: "asc" },
  },
  comments: {
    select: { id: true, body: true, authorId: true, authorName: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.ManufacturingActionSelect;

export const MANUFACTURING_ORDER_DETAIL_SELECT = {
  id: true,
  numero: true,
  legacyNumero: true,
  status: true,
  adapted: true,
  template: { select: { id: true, name: true } },
  cancelledAt: true,
  cancelReason: true,
  cancelledBy: { select: { id: true, name: true } },
  createdAt: true,
  createdByName: true,
  order: {
    select: {
      id: true,
      numero: true,
      active: true,
      client: { select: { id: true, name: true } },
      product: { select: { id: true, name: true, images: true } },
    },
  },
  actions: {
    select: MANUFACTURING_ACTION_SELECT,
    orderBy: [{ position: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.ManufacturingOrderSelect;

export const MANUFACTURING_TEMPLATE_SELECT = {
  id: true,
  name: true,
  description: true,
  active: true,
  // How many OFs were opened from it — a figure on its card.
  _count: { select: { manufacturingOrders: true } },
  actions: {
    select: {
      id: true,
      label: true,
      handlesEmployees: true,
      handlesMachine: true,
      handlesAttachments: true,
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.ManufacturingTemplateSelect;

export const listManufacturingOrdersInput = listQueryBase.extend({
  sortBy: z.enum(MANUFACTURING_ORDER_SORT_KEYS).default("createdAt"),
  filter: z.enum(["all", ...MANUFACTURING_ORDER_FACET_KEYS]).default("all"),
  sortDir: listQueryBase.shape.sortDir.default("desc"),
});

export type ListManufacturingOrdersInput = z.infer<typeof listManufacturingOrdersInput>;
