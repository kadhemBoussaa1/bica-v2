import { getTranslations } from "next-intl/server";
import { EmployeesTable } from "./employees-table";
import { NewRecordButton } from "../records/new-record-button";
import styles from "../records/records.module.css";

export default async function EmployeesPage() {
  const t = await getTranslations("employees");
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("title")}</h1>
        </div>
        <p className={styles.subtitle}>{t("subtitle")}</p>
        <NewRecordButton href="/employees/new" label={t("newEmployee")} />
      </header>

      <EmployeesTable />
    </div>
  );
}
