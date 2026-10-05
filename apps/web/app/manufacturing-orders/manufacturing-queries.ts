import type { QueryClient } from "@tanstack/react-query";
import type { useTRPC } from "../trpc/client";

/**
 * Everything a write on an OF can change on screen: the OF page, the list
 * (status, progress, current action), the header's figures and the order
 * page's OF card.
 */
export async function invalidateManufacturingQueries(
  queryClient: QueryClient,
  trpc: ReturnType<typeof useTRPC>,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: trpc.manufacturing.byId.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.manufacturing.list.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.manufacturing.summary.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.order.byId.queryKey() }),
  ]);
}
