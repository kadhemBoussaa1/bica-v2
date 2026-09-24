import { ReceiveScan } from "./receive-scan";

/**
 * The shop-floor scan screen for one delivery — docs/receiving-plan.md §6e.
 *
 * No page furniture of its own: `ReceiveScan` owns the whole viewport under
 * `data-surface="floor"`, because the header, the progress and the scanner
 * all change on every scan and splitting them across a server shell would
 * only mean passing the same query result down twice.
 */
export default async function ReceivingScanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReceiveScan shipmentId={id} />;
}
