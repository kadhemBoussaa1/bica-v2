// Type-only import, the same rule as `AppRouter`: the module's list vocabulary
// lives server-side, so the web build must never pull in the module itself.
import type { OrderFacet } from "api/src/order/order.list";

/**
 * The orders list's lifecycle facets, in the order work flows through them:
 * quotes first, then the three module inboxes, then the two terminal buckets.
 *
 * They are rows under Orders in the sidebar rather than chips above the grid
 * (2026-10-21): each links to `/orders?filter=<key>`, and the page reads the
 * parameter back with `orderViewOf`. One list, so the rows and the page
 * cannot disagree about which views exist.
 */
export const ORDER_VIEWS = [
  "quotes",
  "draft",
  "inProduction",
  "produced",
  "invoicing",
  "completed",
  "archived",
] as const satisfies readonly OrderFacet[];

/** `?filter=` as a view; "all" when it is missing or names none of them. */
export function orderViewOf(
  param: string | string[] | null | undefined,
): "all" | OrderFacet {
  const value = Array.isArray(param) ? param[0] : param;
  return ORDER_VIEWS.find((view) => view === value) ?? "all";
}
