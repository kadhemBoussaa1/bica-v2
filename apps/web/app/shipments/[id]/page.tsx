import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ExportShipmentDetail } from "./export-shipment-detail";
import styles from "../../records/records.module.css";

/**
 * Only the frame: the header depends on the shipment's status, which the
 * client component learns from `byId` — a DRAFT carries its readiness card
 * in the header (v4 handoff), a SHIPPED record keeps the module's.
 */
export default async function ShipmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("shipments");

  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/shipments">
        {t("back")}
      </Link>
      <ExportShipmentDetail id={id} />
    </div>
  );
}
