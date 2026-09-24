import { redirect } from "next/navigation";

/**
 * What a v2 reel label's QR resolves to.
 *
 * The label encodes `https://<host>/scan/roll/<cuid>` so a phone camera can
 * open the reel without the ERP being involved. This route exists only to
 * forward to the real page: keeping the scan URL separate from `/stock/<id>`
 * means the printed labels do not pin the app's routing, and the warehouse
 * screen can recognise a scan by its path.
 *
 * A signed-out hit round-trips through `/login?next=` on its own — the
 * middleware sees this path like any other.
 */
const CUID = /^c[a-z0-9]{24}$/;

export default async function ScanRollPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // A malformed id would 404 on the reel page anyway; send it to the list
  // rather than rendering a dead end for a smudged code.
  redirect(CUID.test(id) ? `/stock/${id}` : "/stock");
}
