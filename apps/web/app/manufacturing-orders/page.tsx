import { initialSearchOf, type ListPageProps } from "../records/list-search";
import styles from "../records/records.module.css";
import { ManufacturingView } from "./manufacturing-view";

/**
 * Manufacturing orders (OF) and the templates they are opened from —
 * docs/manufacturing-orders-plan.md, drawn from
 * "Ordres de fabrication v3.dc.html". The header lives in the view: its
 * tabs and figures come from the same queries as the lists. No "New"
 * button: an OF belongs to an order and is created from that order's page.
 */
export default async function ManufacturingOrdersPage({ searchParams }: ListPageProps) {
  const search = await initialSearchOf(searchParams);
  return (
    <div className={styles.page}>
      <ManufacturingView key={search} initialSearch={search} />
    </div>
  );
}
