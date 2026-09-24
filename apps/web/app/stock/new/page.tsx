import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { RollForm } from "../roll-form";
import styles from "../../records/records.module.css";

export default async function NewRollPage({
  searchParams,
}: {
  searchParams: Promise<{ shipment?: string }>;
}) {
  // Pre-selects the delivery when arriving from a shipment's own page.
  const { shipment } = await searchParams;
  const t = await getTranslations("stock");

  return (
    <div className={styles.page}>
      <Link className={styles.back} href={shipment ? `/stock/shipments/${shipment}` : "/stock"}>
        {shipment ? t("shipments.backToShipment") : t("rolls.back")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("rolls.newTitle")}</h1>
        </div>
        <p className={styles.subtitle}>{t("rolls.newSubtitle")}</p>
      </header>

      <RollForm shipmentId={shipment} />
    </div>
  );
}
