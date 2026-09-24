import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";

/** What `dashboard.summary` returns — derived from the router, never hand-written. */
export type Summary = inferRouterOutputs<AppRouter>["dashboard"]["summary"];
export type CurrencySum = Summary["money"]["sales"]["thisYear"][number];

/**
 * The span the page's range control picks: the current month, the current
 * calendar quarter, or the twelve months the production trend covers. All
 * three end with the current month, on the server and here alike.
 */
export const RANGES = ["month", "quarter", "twelveMonths"] as const;
export type Range = (typeof RANGES)[number];

/**
 * Which of the trend's months fall in `range`. The trend's last month is
 * the current one; a quarter starts on January, April, July or October,
 * the same boundary the server's invoiced-this-quarter window uses.
 */
export function rangeIndices(months: readonly string[], range: Range): number[] {
  const last = months.length - 1;
  const current = months[last];
  if (current === undefined) return [];
  if (range === "twelveMonths") return months.map((_, index) => index);
  if (range === "month") return [last];
  const month = Number(current.slice(5, 7));
  const quarterStart = `${current.slice(0, 4)}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, "0")}`;
  return months.flatMap((key, index) => (key >= quarterStart ? [index] : []));
}

/** A money figure's invoice or order count, across its currencies. */
export function countOf(rows: readonly { count: number }[]): number {
  return rows.reduce((sum, row) => sum + row.count, 0);
}
