import { PurchaseInvoicesTable } from "./purchase-invoices-table";
import { initialSearchOf, type ListPageProps } from "../../records/list-search";
import styles from "../../records/records.module.css";

/**
 * The header is part of the client component: its figure tiles come from
 * the same query as the list, as on the sales side, so the whole panel is
 * drawn there.
 */
export default async function PurchaseInvoicesPage({ searchParams }: ListPageProps) {
  const search = await initialSearchOf(searchParams);
  return (
    <div className={styles.page}>
      <PurchaseInvoicesTable key={search} initialSearch={search} />
    </div>
  );
}
