import { PurchaseOrdersTable } from "./purchase-orders-table";
import { initialSearchOf, type ListPageProps } from "../../records/list-search";
import styles from "../../records/records.module.css";

/**
 * The header is part of the client component: its figure tiles come from
 * the same query as the list (`Purchase orders v4.dc.html` puts them inside
 * the header panel), so the whole panel is drawn there.
 */
export default async function PurchaseOrdersPage({ searchParams }: ListPageProps) {
  const search = await initialSearchOf(searchParams);
  return (
    <div className={styles.page}>
      <PurchaseOrdersTable key={search} initialSearch={search} />
    </div>
  );
}
