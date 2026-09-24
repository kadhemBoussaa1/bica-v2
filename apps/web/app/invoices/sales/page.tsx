import { SalesInvoicesTable } from "./sales-invoices-table";
import styles from "../../records/records.module.css";

/**
 * The header is part of the client component: its figure tiles come from
 * the same query as the list (`Sales invoices v3.dc.html` puts them inside
 * the header panel), so the whole panel is drawn there.
 */
export default function SalesInvoicesPage() {
  return (
    <div className={styles.page}>
      <SalesInvoicesTable />
    </div>
  );
}
