import { listQueryBase } from "@repo/api-contract";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import type { ListDeclaration } from "../list/list-query";

/**
 * The reel picker's vocabulary — docs/roll-allocation-plan.md §6. A security
 * boundary like every other `*.list.ts`: the scope (grammage, width band,
 * live reels with length) is built by the service from the ORDER and AND-ed
 * in first; nothing here is client-supplied.
 */
export const CANDIDATE_SORT_KEYS = ["laize", "metrageRestant", "paperGrade"] as const;
export type CandidateSortKey = (typeof CANDIDATE_SORT_KEYS)[number];

/** No facets: the scope already says what a candidate is. No chips render. */
export type CandidateFacet = never;

export const candidateListDeclaration: ListDeclaration<
  Prisma.PaperRollWhereInput,
  Prisma.PaperRollOrderByWithRelationInput,
  CandidateSortKey,
  CandidateFacet
> = {
  sortable: {
    // Narrowest first: the scope admits reels from `width − 2 mm` up, so the
    // exact fits are the smallest widths and lead by construction. Longest
    // first within a width.
    laize: (dir) => [{ laize: dir }, { metrageRestant: "desc" }],
    metrageRestant: (dir) => [{ metrageRestant: dir }],
    paperGrade: (dir) => [{ paperGrade: dir }, { laize: "asc" }],
  },
  defaultSort: "laize",
  // A label rather than a key, but what someone reads off the reel.
  searchable: ["numero"],
  facets: {} as Record<CandidateFacet, Prisma.PaperRollWhereInput>,
};

/** Every sortable column above is in here — the invariant list-query.ts states. */
export const CANDIDATE_SELECT = {
  id: true,
  numero: true,
  paperGrade: true,
  description: true,
  grammage: true,
  laize: true,
  paperType: true,
  metrage: true,
  metrageRestant: true,
  metrageReserve: true,
  poidsRestant: true,
  importShipment: { select: { id: true, numeroImport: true } },
} satisfies Prisma.PaperRollSelect;

export const candidatesInput = listQueryBase.extend({
  orderId: z.string().min(1),
  sortBy: z.enum(CANDIDATE_SORT_KEYS).default("laize"),
  filter: z.literal("all").default("all"),
  sortDir: listQueryBase.shape.sortDir.default("asc"),
});
export type CandidatesInput = z.infer<typeof candidatesInput>;

/** What the order panel and the picker read per allocation. */
export const ALLOCATION_SELECT = {
  id: true,
  orderId: true,
  paperRollId: true,
  metrageReserve: true,
  poidsReserve: true,
  state: true,
  dateAllocation: true,
  dateConsommation: true,
  dateAnnulation: true,
  paperRoll: {
    select: { id: true, numero: true, paperGrade: true, grammage: true, laize: true },
  },
  allocatedBy: { select: { id: true, name: true } },
} satisfies Prisma.RollAllocationSelect;
