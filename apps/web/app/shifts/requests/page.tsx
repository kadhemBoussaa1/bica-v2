import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { RequestsTable } from "./requests-table";
import styles from "../../records/records.module.css";

export default async function ShiftRequestsPage() {
  const t = await getTranslations("shifts");
  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/shifts">
        {t("requests.back")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("requests.title")}</h1>
        </div>
      </header>

      <RequestsTable />
    </div>
  );
}
