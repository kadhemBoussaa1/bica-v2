import { getTranslations } from "next-intl/server";
import { RollBackLink } from "./roll-back-link";
import { RollDetail } from "./roll-detail";
import { NewRecordButton, RecordActions } from "../../records/new-record-button";
import styles from "../../records/records.module.css";

export default async function RollPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("stock");

  return (
    <div className={styles.page}>
      <RollBackLink
        className={styles.back}
        stockLabel={t("rolls.back")}
        scanLabel={t("lookup.back")}
      />
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("rolls.detailTitle")}</h1>
        </div>
        <p className={styles.subtitle}>{t("rolls.detailSubtitle")}</p>
        <RecordActions>
          <NewRecordButton
            href={`/stock/labels?rolls=${id}`}
            label={t("rolls.detail.printLabel")}
          />
          <NewRecordButton href={`/stock/${id}/edit`} label={t("rolls.editReel")} />
        </RecordActions>
      </header>

      <RollDetail id={id} />
    </div>
  );
}
