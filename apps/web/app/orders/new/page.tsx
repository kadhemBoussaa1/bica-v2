import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { OrderForm } from "../order-form";
import styles from "../../records/records.module.css";

export default async function NewOrderPage() {
  const t = await getTranslations("orders");
  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/orders">
        {t("backToList")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("newTitle")}</h1>
        </div>
        <p className={styles.subtitle}>{t("newSubtitle")}</p>
      </header>

      <OrderForm />
    </div>
  );
}
