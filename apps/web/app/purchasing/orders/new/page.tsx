import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PurchaseOrderForm } from "../purchase-order-form";
import styles from "../../../records/records.module.css";

export default async function NewPurchaseOrderPage() {
  const t = await getTranslations("purchasing");
  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/purchasing/orders">
        {t("orders.back")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("orders.new")}</h1>
        </div>
        <p className={styles.subtitle}>{t("orders.newSubtitle")}</p>
      </header>

      <PurchaseOrderForm />
    </div>
  );
}
