import { getTranslations } from "next-intl/server";
import { ReceivingInbox } from "./receiving-inbox";
import styles from "../../records/records.module.css";

export default async function ReceivingPage() {
  const t = await getTranslations("stock");

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("receiving.title")}</h1>
        </div>
        <p className={styles.subtitle}>{t("receiving.subtitle")}</p>
      </header>

      <ReceivingInbox />
    </div>
  );
}
