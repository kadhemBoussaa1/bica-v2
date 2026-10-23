import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PurchaseInvoiceDetail } from "./purchase-invoice-detail";
import styles from "../../../records/records.module.css";

/** The header is the detail's own: it carries the invoice's number and state. */
export default async function PurchaseInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("invoices");

  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/invoices/purchases">
        {t("purchases.back")}
      </Link>
      <PurchaseInvoiceDetail id={id} />
    </div>
  );
}
