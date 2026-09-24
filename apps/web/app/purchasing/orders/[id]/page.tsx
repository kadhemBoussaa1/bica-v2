import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PurchaseOrderDetail } from "./purchase-order-detail";
import styles from "../../../records/records.module.css";

export default async function PurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("purchasing");

  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/purchasing/orders">
        {t("orders.back")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("orders.detailTitle")}</h1>
        </div>
        <p className={styles.subtitle}>{t("orders.detailSubtitle")}</p>
      </header>

      <PurchaseOrderDetail id={id} />
    </div>
  );
}
