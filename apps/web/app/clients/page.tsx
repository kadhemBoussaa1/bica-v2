import { getTranslations } from "next-intl/server";
import { ClientsTable } from "./clients-table";
import { NewRecordButton } from "../records/new-record-button";
import styles from "../records/records.module.css";

export default async function ClientsPage() {
  const t = await getTranslations("clients");
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("title")}</h1>
        </div>
        <p className={styles.subtitle}>{t("subtitle")}</p>
        <NewRecordButton href="/clients/new" label={t("newClient")} />
      </header>

      <ClientsTable />
    </div>
  );
}
