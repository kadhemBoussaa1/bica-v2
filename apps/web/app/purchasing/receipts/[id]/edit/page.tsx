import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EditGoodsReceipt } from "./edit-goods-receipt";
import styles from "../../../../records/records.module.css";

export default async function EditGoodsReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("purchasing");

  return (
    <div className={styles.page}>
      <Link className={styles.back} href={`/purchasing/receipts/${id}`}>
        {t("receipts.backToReceipt")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("receipts.editTitle")}</h1>
        </div>
        <p className={styles.subtitle}>{t("receipts.editSubtitle")}</p>
      </header>

      <EditGoodsReceipt id={id} />
    </div>
  );
}
