import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ShipmentForm } from "../shipment-form";
import styles from "../../../records/records.module.css";

export default async function NewShipmentPage() {
  const t = await getTranslations("stock");
  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/stock/shipments">
        {t("shipments.back")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("shipments.newShipment")}</h1>
        </div>
        <p className={styles.subtitle}>{t("shipments.newSubtitle")}</p>
      </header>

      <ShipmentForm />
    </div>
  );
}
