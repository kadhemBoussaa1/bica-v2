import { getTranslations } from "next-intl/server";
import { MachinesTable } from "./machines-table";
import { NewRecordButton } from "../records/new-record-button";
import styles from "../records/records.module.css";

export default async function MachinesPage() {
  const t = await getTranslations("machines");
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("title")}</h1>
        </div>
        <p className={styles.subtitle}>{t("subtitle")}</p>
        <NewRecordButton href="/machines/new" label={t("newMachine")} />
      </header>

      <MachinesTable />
    </div>
  );
}
