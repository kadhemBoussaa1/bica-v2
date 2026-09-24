import { calendarDate, listQueryBase } from "@repo/api-contract";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import { contains, type ListDeclaration } from "../list/list-query";

export const PRODUCTION_SORT_KEYS = [
  "dateProduction",
  "order",
  "quantite",
  "stage",
  "employee",
] as const;
export type ProductionSortKey = (typeof PRODUCTION_SORT_KEYS)[number];

/**
 * Facets over the workshop station that recorded the run.
 *
 * These replace the old verified/assigned/unassigned split, which facetted
 * on columns almost nothing used — `verifiedAt` was set on 2 of 942 rows and
 * `employeeId` on 43. The station is what people actually filter by.
 *
 * They partition the table exactly, by construction: `stage` is a non-null
 * enum with these four values and every facet is one equality on it. If a
 * fifth station is ever added to `WorkshopStage` it MUST be added here too —
 * an unlisted value would vanish from every chip while still counting in the
 * pager, the same trap documented at length in `order.list.ts`.
 */
export const PRODUCTION_FACET_KEYS = [
  "printing",
  "producer",
  "qualityControl",
  "packaging",
] as const;
export type ProductionFacet = (typeof PRODUCTION_FACET_KEYS)[number];

export const productionListDeclaration: ListDeclaration<
  Prisma.ProductionRunWhereInput,
  Prisma.ProductionRunOrderByWithRelationInput,
  ProductionSortKey,
  ProductionFacet
> = {
  sortable: {
    dateProduction: (dir) => ({ dateProduction: dir }),
    order: (dir) => ({ order: { numero: dir } }),
    quantite: (dir) => ({ quantite: dir }),
    stage: (dir) => ({ stage: dir }),
    // A null relation orders last in Postgres by default, which puts the 899
    // unassigned runs after the 43 named ones rather than interleaving them.
    employee: (dir) => ({ employee: { lastName: dir } }),
  },
  defaultSort: "dateProduction",
  // String columns only — Prisma rejects `contains` on an enum, so `stage` is
  // a facet rather than something the search box reaches.
  searchable: (term) => ({
    OR: [
      { note: contains(term) },
      { verifiedBy: contains(term) },
      { order: { numero: contains(term) } },
      { order: { product: { name: contains(term) } } },
      { employee: { lastName: contains(term) } },
    ],
  }),
  facets: {
    printing: { stage: "PRINTING" },
    producer: { stage: "PRODUCER" },
    qualityControl: { stage: "QUALITY_CONTROL" },
    packaging: { stage: "PACKAGING" },
  },
};

export const PRODUCTION_SELECT = {
  id: true,
  dateProduction: true,
  stage: true,
  quantite: true,
  unit: true,

  // Per-stage measures. All nullable — a row only ever carries its own
  // station's, enforced by the discriminated input in `production.ts`.
  metersPrinted: true,
  piecesProduced: true,
  wastePieces: true,
  piecesToFix: true,
  goodPieces: true,
  defectivePieces: true,
  piecesControlled: true,
  parcelsClosed: true,

  note: true,
  verifiedAt: true,
  verifiedBy: true,
  orderId: true,
  order: {
    select: {
      id: true,
      numero: true,
      /// The day view shows a run's state as its order's lifecycle state —
      /// "In production" while the job is open, "Produced" once closed.
      kind: true,
      status: true,
      quantite: true,
      quantityUnit: true,
      /// `images`: the day view shows the product's photo on each entry, so
      /// a card is recognisable from across the room.
      product: { select: { id: true, name: true, typeSac: true, images: true } },
      client: { select: { id: true, name: true } },
    },
  },
  employeeId: true,
  employee: { select: { id: true, firstName: true, lastName: true, matricule: true } },
  /// Which machine ran it — PRINTING and PRODUCER only; null on the other two
  /// stations and on every migrated row.
  machineId: true,
  /// `imageUrl` is the machine photo the day view shows over each station;
  /// null on machines without one, which render a placeholder.
  machine: { select: { id: true, code: true, name: true, type: true, imageUrl: true } },
  /// Who typed it in, and when — `createdAt` is the insertion time that pairs
  /// with `recordedBy`, distinct from `dateProduction` (when the work
  /// happened). Null on every migrated row.
  /// `image` is null on every user today (nothing in the app uploads one), so
  /// the daily view renders initials. Selected anyway so it renders a photo
  /// the moment avatars exist, without another schema pass.
  recordedBy: { select: { id: true, name: true, image: true, role: true } },
  createdAt: true,
} satisfies Prisma.ProductionRunSelect;

export const listProductionInput = listQueryBase.extend({
  sortBy: z.enum(PRODUCTION_SORT_KEYS).default("dateProduction"),
  filter: z.enum(["all", ...PRODUCTION_FACET_KEYS]).default("all"),
  sortDir: listQueryBase.shape.sortDir.default("desc"),
});
export type ListProductionInput = z.infer<typeof listProductionInput>;

/**
 * Runs for one order, on the order detail page. Not paginated: about a
 * thousand runs across a few hundred orders, so one order is a screenful.
 */
export const productionForOrderInput = z.object({ orderId: z.string().min(1) });

/**
 * One day of production, for the daily dashboard at `/production`.
 *
 * A single date, not a range: the page answers "what did the workshop do
 * today?", and its KPI tiles are that day's totals. `dateProduction` is a
 * `@db.Date` column, so this compares whole days with no timezone arithmetic.
 */
export const productionDailyInput = z.object({
  // A real day, not just the shape: "2026-13-01" would otherwise become an
  // Invalid Date and reach Prisma as a 500.
  date: calendarDate,
});
export type ProductionDailyInput = z.infer<typeof productionDailyInput>;

/** The widest range `production.monthly` answers in one call, in months. */
const PRODUCTION_MONTHLY_MAX_MONTHS = 24;

// 01-12 only: "2026-13" would pass a bare \d{2}, become an Invalid Date and
// reach Prisma as a 500 instead of a BAD_REQUEST.
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");

/** Months since year 0, so two YYYY-MM strings subtract into a span. */
function monthIndex(value: string): number {
  return Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7));
}

/**
 * A range of whole months, both ends included, for the monthly view at
 * `/production`. Capped so a client cannot pull the whole history in one
 * call. `dateProduction` is a `@db.Date` column, so month bounds are plain
 * UTC dates with no timezone arithmetic.
 */
export const productionMonthlyInput = z
  .object({ from: month, to: month })
  // Zero-padded YYYY-MM sorts as text the same way it sorts as a date.
  .refine((range) => range.from <= range.to, {
    message: "`from` must not be after `to`",
    path: ["from"],
  })
  .refine(
    (range) =>
      monthIndex(range.to) - monthIndex(range.from) + 1 <= PRODUCTION_MONTHLY_MAX_MONTHS,
    {
      message: `A range covers at most ${PRODUCTION_MONTHLY_MAX_MONTHS} months`,
      path: ["to"],
    },
  );
export type ProductionMonthlyInput = z.infer<typeof productionMonthlyInput>;
