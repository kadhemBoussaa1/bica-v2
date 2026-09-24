import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FamiliesManager } from "./families-manager";
import styles from "../../records/records.module.css";

export default async function SupplierFamiliesPage() {
  const t = await getTranslations("suppliers");
  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/suppliers">
        {t("backToList")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("families.title")}</h1>
        </div>
        <p className={styles.subtitle}>{t("families.subtitle")}</p>
      </header>

      <FamiliesManager />
    </div>
  );
}
