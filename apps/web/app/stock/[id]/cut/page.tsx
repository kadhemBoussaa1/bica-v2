import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { RollCutForm } from "../../roll-cut-form";
import styles from "../../../records/records.module.css";

export default async function RollCutFormPage({ params }: { params: Promise<{ id: string }> }) {
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
          <h1 className={styles.title}>{t("rolls.cut.title")}</h1>
        </div>
        <p className={styles.subtitle}>{t("rolls.cut.subtitle")}</p>
      </header>

      <RollCutForm rollId={id} />
    </div>
  );
}
