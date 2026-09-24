import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { GoodsReceiptDetail } from "./goods-receipt-detail";
import styles from "../../../records/records.module.css";

export default async function GoodsReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("purchasing");

  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/purchasing/receipts">
        {t("receipts.back")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("receipts.detailTitle")}</h1>
        </div>
        <p className={styles.subtitle}>{t("receipts.detailSubtitle")}</p>
      </header>

      <GoodsReceiptDetail id={id} />
    </div>
  );
}
