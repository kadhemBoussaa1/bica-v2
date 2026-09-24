import { getTranslations } from "next-intl/server";
import { ShipmentsTable } from "./shipments-table";
import styles from "../records/records.module.css";

/**
 * No "New shipment" button: a shipment is raised from the order it carries
 * (the "Create shipment" action on an INVOICED order), so it starts with
 * its client, its invoice and its parcels already right.
 */
export default async function ShipmentsPage() {
  const t = await getTranslations("shipments");
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("title")}</h1>
        </div>
        <p className={styles.subtitle}>{t("subtitle")}</p>
      </header>

      <ShipmentsTable />
    </div>
  );
}
