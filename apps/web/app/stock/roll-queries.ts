import type { QueryClient } from "@tanstack/react-query";
import type { useTRPC } from "../trpc/client";

/**
 * A reel's purchase prices, or nulls when the caller may not read them.
 *
 * `listRolls` and `rollById` select the money columns only for ADMIN+
 * (`StockService.canReadPricing`), so the inferred row type no longer
 * promises them — it is the union of the priced and unpriced selects, and
 * tRPC's serialised output is an intersection with `Record<...>`, which a
 * `"price" in row` probe cannot narrow: it yields `{} | undefined`.
 *
 * So the caller branches on the same rank test the server used, and this
 * confines the widening cast to one place. `canRead` is the precondition:
 * pass `canAccess(role, "ADMIN")`, never `true` from a page that has not
 * checked.
 */
export function rollMoney(
  row: unknown,
  canRead: boolean,
): { price: number | null; priceWithTransport: number | null } {
  // `row` is absent on a create form, which seeds from no reel at all — the
  // same nulls as "may not read" are the right answer for "nothing to read".
  if (!canRead || row === null || row === undefined) {
    return { price: null, priceWithTransport: null };
  }
  const money = row as { price?: number | null; priceWithTransport?: number | null };
  return {
    price: money.price ?? null,
    priceWithTransport: money.priceWithTransport ?? null,
  };
}

/**
 * Everything that shows a reel's counters or an order's paper. A cut, slit,
 * reservation, consumption or cancellation can change all of them at once,
 * so every one of those mutations invalidates the lot rather than guessing
 * which page is open behind the dialog.
 */
export async function invalidateRollQueries(
  queryClient: QueryClient,
  trpc: ReturnType<typeof useTRPC>,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: trpc.stock.rollById.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.stock.listRolls.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.stock.rollsForShipment.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.stock.shipmentById.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.allocation.candidates.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.allocation.forOrder.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.order.byId.queryKey() }),
  ]);
}
