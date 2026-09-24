import { getTranslations } from "next-intl/server";
import { SuppliersTable } from "./suppliers-table";
import {
  NewRecordButton,
  RecordActions,
  SecondaryRecordButton,
} from "../records/new-record-button";
import styles from "../records/records.module.css";

export default async function SuppliersPage() {
  const t = await getTranslations("suppliers");
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("title")}</h1>
        </div>
        <p className={styles.subtitle}>{t("subtitle")}</p>
        <RecordActions>
          {/* Families live under this module rather than in the sidebar, so
              this is the way in. */}
          <SecondaryRecordButton
            href="/suppliers/families"
            label={t("supplierFamilies")}
          />
          <NewRecordButton href="/suppliers/new" label={t("newSupplier")} />
        </RecordActions>
      </header>

      <SuppliersTable />
    </div>
  );
}
