import { getTranslations } from "next-intl/server";
import { GoodsReceiptsTable } from "./goods-receipts-table";
import styles from "../../records/records.module.css";

export default async function GoodsReceiptsPage() {
  const t = await getTranslations("purchasing");
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("receipts.title")}</h1>
        </div>
        {/*
          No "new receipt" action: every goods receipt is created with its
          purchase order, so this list is where you find the one to fill in,
          never where you raise one.
        */}
        <p className={styles.subtitle}>{t("receipts.subtitle")}</p>
      </header>

      <GoodsReceiptsTable />
    </div>
  );
}
