import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FamiliesManager, FamilyFigures } from "./families-manager";
import styles from "../../records/records.module.css";

/** From `Familles Fournisseurs.dc.html` (Kraft paper bag ERP toolkit). */
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
          <p className={styles.subtitle}>{t("families.subtitle")}</p>
        </div>
        <FamilyFigures />
      </header>

      <FamiliesManager />
    </div>
  );
}
