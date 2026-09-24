import { z } from "zod";

/**
 * A date window a list can be scoped to, owned by the server.
 *
 * Shared MECHANICS, like `list-query.ts`: which column the window applies to
 * is each module's business (`orderPeriodFilter`, `salesInvoicePeriodScope`),
 * and so is what a row with no date does inside a window.
 *
 * The three year buckets are a closed enum, so the boundaries are computed
 * here from the server's clock — a client cannot pass a window that reaches
 * outside what the enum names. `from`/`to` are only read for `custom`, and
 * they are the one place a caller does supply dates.
 *
 * Fixed relative buckets, deliberately: the migrated data runs 2024–2026, so
 * these three cover all of it today. They will age — in 2027 "the year before
 * last" becomes 2025 and 2024 falls off the end — at which point a year list
 * generated from the data is the better shape. Worth revisiting then rather
 * than building the general case now.
 */
export const PERIODS = ["thisYear", "lastYear", "yearBefore", "custom"] as const;
export type Period = (typeof PERIODS)[number];

/** ISO date, `YYYY-MM-DD`, as the `@db.Date` columns are exchanged. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** The three input fields a list gains when it takes a window; spread into its `extend`. */
export const periodInput = {
  period: z.enum(PERIODS).optional(),
  /** Read only when `period` is "custom"; inclusive of both days. */
  from: isoDate.optional(),
  to: isoDate.optional(),
};

export interface PeriodInput {
  period?: Period;
  from?: string;
  to?: string;
}

/** The half-open `[gte, lt)` bounds of a window; either may be missing on a custom range. */
export interface DateWindow {
  gte?: Date;
  lt?: Date;
}

/**
 * The bounds a period means — or `undefined` when no period is active.
 *
 * Half-open (`gte` … `lt`), and built in UTC. `@db.Date` columns are stored
 * by Postgres as a bare day and read by Prisma as UTC midnight: a local-time
 * boundary would shift the edge by the offset and either drop the first day
 * of the window or pull in the last day of the one before. `lt` the following
 * January rather than `lte` 31 December for the same reason — an `lte` on a
 * timestamp column silently excludes everything after midnight on the last
 * day.
 *
 * `custom` with neither end is not a window at all, so it returns undefined
 * rather than an empty object: an `AND: [{}]` would be a no-op that still
 * reads like a filter is applied.
 */
export function periodWindow(input: PeriodInput, now = new Date()): DateWindow | undefined {
  const { period, from, to } = input;
  if (period === undefined) return undefined;

  if (period === "custom") {
    if (from === undefined && to === undefined) return undefined;
    return {
      ...(from !== undefined ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
      // Exclusive of the day after `to`, which is how a bare day becomes an
      // inclusive range on a timestamp column.
      ...(to !== undefined ? { lt: dayAfter(to) } : {}),
    };
  }

  const thisYear = now.getUTCFullYear();
  const year =
    period === "thisYear" ? thisYear : period === "lastYear" ? thisYear - 1 : thisYear - 2;

  return {
    gte: new Date(Date.UTC(year, 0, 1)),
    lt: new Date(Date.UTC(year + 1, 0, 1)),
  };
}

/** Midnight UTC of the current day, matching how `@db.Date` values are stored. */
export function todayUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** UTC midnight of the day after a `YYYY-MM-DD`, for an inclusive upper bound. */
function dayAfter(day: string): Date {
  const start = new Date(`${day}T00:00:00.000Z`);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * A bare `YYYY-MM-DD` from a form is UTC midnight of that day; absent means
 * now. For the `@db.Date` columns a write stamps (allocation, ink usage).
 */
export function dayOrNow(day: string | undefined): Date {
  return day ? new Date(`${day}T00:00:00.000Z`) : new Date();
}
