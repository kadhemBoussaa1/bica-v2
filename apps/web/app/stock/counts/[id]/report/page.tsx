import { getTranslations } from "next-intl/server";
import { VarianceReport } from "./variance-report";
import styles from "../../../../records/records.module.css";

export default async function VarianceReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("stock");

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("stocktake.title")}</span>
          <h1 className={styles.title}>{t("stocktake.reportTitle")}</h1>
        </div>
        <p className={styles.subtitle}>{t("stocktake.reportSubtitle")}</p>
      </header>

      <VarianceReport countId={id} />
    </div>
  );
}
