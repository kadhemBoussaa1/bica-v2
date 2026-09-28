import { getTranslations } from "next-intl/server";
import { ShipmentsTable } from "./shipments-table";
import { initialSearchOf, type ListPageProps } from "../../records/list-search";
import { NewRecordButton } from "../../records/new-record-button";
import styles from "../../records/records.module.css";

export default async function ShipmentsPage({ searchParams }: ListPageProps) {
  const search = await initialSearchOf(searchParams);
  const t = await getTranslations("stock");
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("shipments.title")}</h1>
        </div>
        <p className={styles.subtitle}>{t("shipments.subtitle")}</p>
        <NewRecordButton href="/stock/shipments/new" label={t("shipments.newShipment")} />
      </header>

      <ShipmentsTable key={search} initialSearch={search} />
    </div>
  );
}
