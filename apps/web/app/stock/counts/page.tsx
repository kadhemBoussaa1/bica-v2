import { getTranslations } from "next-intl/server";
import { CountsList } from "./counts-list";
import { initialSearchOf, type ListPageProps } from "../../records/list-search";
import styles from "../../records/records.module.css";

export default async function StocktakePage({ searchParams }: ListPageProps) {
  const search = await initialSearchOf(searchParams);
  const t = await getTranslations("stock");

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("stocktake.title")}</h1>
        </div>
        <p className={styles.subtitle}>{t("stocktake.subtitle")}</p>
      </header>

      <CountsList key={search} initialSearch={search} />
    </div>
  );
}
