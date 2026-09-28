import { getTranslations } from "next-intl/server";
import { RollsTable } from "./rolls-table";
import { initialSearchOf, type ListPageProps } from "../records/list-search";
import styles from "../records/records.module.css";

export default async function StockPage({ searchParams }: ListPageProps) {
  const search = await initialSearchOf(searchParams);
  const t = await getTranslations("stock");
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("rolls.title")}</h1>
        </div>
        <p className={styles.subtitle}>{t("rolls.subtitle")}</p>
      </header>

      <RollsTable key={search} initialSearch={search} />
    </div>
  );
}
