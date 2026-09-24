import { PurchaseOrdersTable } from "./purchase-orders-table";
import styles from "../../records/records.module.css";

/**
 * The header is part of the client component: its figure tiles come from
 * the same query as the list (`Purchase orders v4.dc.html` puts them inside
 * the header panel), so the whole panel is drawn there.
 */
export default function PurchaseOrdersPage() {
  return (
    <div className={styles.page}>
      <PurchaseOrdersTable />
    </div>
  );
}
