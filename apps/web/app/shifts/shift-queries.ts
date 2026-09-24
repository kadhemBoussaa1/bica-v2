import type { QueryClient } from "@tanstack/react-query";
import type { useTRPC } from "../trpc/client";

/**
 * Everything that shows a roster, a ticket or a request. A change, an
 * assignment or a decision can move all of them at once, so every mutation
 * invalidates the lot rather than guessing which page is open behind the
 * dialog — the same call `stock/roll-queries.ts` makes for reels.
 */
export async function invalidateShiftQueries(
  queryClient: QueryClient,
  trpc: ReturnType<typeof useTRPC>,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: trpc.shift.weekByStart.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.shift.dayView.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.shift.listChanges.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.shift.myWeek.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.shift.current.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.nav.counts.queryKey() }),
  ]);
}
