import { getTranslations } from "next-intl/server";
import { InksTable } from "./inks-table";
import { NewRecordButton } from "../../records/new-record-button";
import styles from "../../records/records.module.css";

export default async function InksPage() {
  const t = await getTranslations("stock");
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("inks.title")}</h1>
        </div>
        <p className={styles.subtitle}>{t("inks.subtitle")}</p>
        <NewRecordButton href="/stock/inks/new" label={t("inks.newColour")} />
      </header>

      <InksTable />
    </div>
  );
}
