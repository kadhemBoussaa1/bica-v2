import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { RollSlitForm } from "../../roll-slit-form";
import styles from "../../../records/records.module.css";

export default async function RollSlitFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("stock");

  return (
    <div className={styles.page}>
      <Link className={styles.back} href={`/stock/${id}`}>
        {t("rolls.backToRoll")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("rolls.slit.title")}</h1>
        </div>
        <p className={styles.subtitle}>{t("rolls.slit.subtitle")}</p>
      </header>

      <RollSlitForm rollId={id} />
    </div>
  );
}
