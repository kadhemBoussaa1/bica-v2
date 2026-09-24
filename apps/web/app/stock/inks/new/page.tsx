import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { InkForm } from "../ink-form";
import styles from "../../../records/records.module.css";

export default async function NewInkPage() {
  const t = await getTranslations("stock");
  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/stock/inks">
        {t("inks.back")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("inks.newColour")}</h1>
        </div>
      </header>

      <InkForm />
    </div>
  );
}
