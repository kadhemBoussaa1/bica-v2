import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PurchaseInvoiceDetail } from "./purchase-invoice-detail";
import styles from "../../../records/records.module.css";

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
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("purchases.detailTitle")}</h1>
        </div>
        <p className={styles.subtitle}>{t("purchases.detailSubtitle")}</p>
      </header>

      <PurchaseInvoiceDetail id={id} />
    </div>
  );
}
