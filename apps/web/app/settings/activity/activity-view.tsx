"use client";

import { useSearchParams } from "next/navigation";
import { ActivityTable } from "./activity-table";

/**
 * Reads the two prefilters off the URL. Split out from the page so it can
 * sit inside `<Suspense>`: Next 16 refuses to build a page that calls
 * `useSearchParams` outside one.
 */
export function ActivityView() {
  const params = useSearchParams();
  const actor = params.get("actor") ?? undefined;
  const entity = params.get("entity") ?? undefined;
  // Keyed so switching prefilters remounts the table with fresh state.
  return <ActivityTable key={`${actor ?? ""}|${entity ?? ""}`} actorId={actor} entityId={entity} />;
}
