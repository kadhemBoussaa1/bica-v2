import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ShipmentDetail } from "./shipment-detail";
import { NewRecordButton, RecordActions } from "../../../records/new-record-button";
import styles from "../../../records/records.module.css";

export default async function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("stock");

  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/stock/shipments">
        {t("shipments.backToList")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("shipments.detailTitle")}</h1>
        </div>
        <p className={styles.subtitle}>{t("shipments.detailSubtitle")}</p>
        <RecordActions>
          <NewRecordButton href={`/stock/new?shipment=${id}`} label={t("shipments.addReel")} />
          <NewRecordButton
            href={`/stock/labels?shipment=${id}`}
            label={t("shipments.printLabels")}
          />
          <NewRecordButton
            href={`/stock/shipments/${id}/edit`}
            label={t("shipments.editShipment")}
          />
        </RecordActions>
      </header>

      <ShipmentDetail id={id} />
    </div>
  );
}
