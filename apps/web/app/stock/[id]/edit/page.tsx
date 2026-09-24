import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EditRoll } from "./edit-roll";
import styles from "../../../records/records.module.css";

export default async function EditRollPage({ params }: { params: Promise<{ id: string }> }) {
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
          <h1 className={styles.title}>{t("rolls.editReel")}</h1>
        </div>
        <p className={styles.subtitle}>{t("rolls.editSubtitle")}</p>
      </header>

      <EditRoll id={id} />
    </div>
  );
}
