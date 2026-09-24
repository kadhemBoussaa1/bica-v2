import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PurchaseInvoiceForm } from "../purchase-invoice-form";
import styles from "../../../records/records.module.css";

export default async function NewPurchaseInvoicePage() {
  const t = await getTranslations("invoices");
  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/invoices/purchases">
        {t("purchases.back")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("purchases.new")}</h1>
        </div>
        <p className={styles.subtitle}>{t("purchases.newSubtitle")}</p>
      </header>

      <PurchaseInvoiceForm />
    </div>
  );
}
