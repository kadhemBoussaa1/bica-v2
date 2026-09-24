import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { RollPicker } from "./roll-picker";
import styles from "../../../records/records.module.css";

/** The full-page fallback for the reel picker; in-app it opens as a modal. */
export default async function OrderPaperPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("orders");

  return (
    <div className={styles.page}>
      <Link className={styles.back} href={`/orders/${id}`}>
        {t("backToOrder")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("picker.title")}</h1>
        </div>
        <p className={styles.subtitle}>{t("picker.subtitle")}</p>
      </header>

      <RollPicker orderId={id} />
    </div>
  );
}
