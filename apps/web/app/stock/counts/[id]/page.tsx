import { CountScan } from "./count-scan";

/**
 * The shop-floor scan screen for one stocktake — docs/inventory-plan.md §6c.
 *
 * No page furniture of its own: `CountScan` owns the whole viewport under
 * `data-surface="floor"`, because the header, the progress and the scanner all
 * change on every scan.
 */
export default async function StocktakeScanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CountScan countId={id} />;
}
