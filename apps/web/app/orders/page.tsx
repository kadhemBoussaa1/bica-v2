import { getTranslations } from "next-intl/server";
import { OrdersGrid } from "./orders-grid";
import { orderViewOf } from "./order-views";
import { initialSearchOf, type ListPageProps } from "../records/list-search";
import { NewRecordButton } from "../records/new-record-button";
import styles from "../records/records.module.css";

/**
 * `?filter=` is the lifecycle view, set by the rows under Orders in the
 * sidebar — the page has no chips of its own. Unlike `?search=` it is kept,
 * not initial-only: the sidebar is the only way to change it, so the URL is
 * always what is on screen. The heading names the view, since nothing else
 * on the page would say the list is filtered.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<
    Awaited<ListPageProps["searchParams"]> & { filter?: string | string[] }
  >;
}) {
  const search = await initialSearchOf(searchParams);
  const view = orderViewOf((await searchParams).filter);
  const t = await getTranslations("orders");
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>
            {view === "all" ? t("eyebrow") : t("title")}
          </span>
          <h1 className={styles.title}>
            {view === "all" ? t("title") : t(`filters.${view}`)}
          </h1>
        </div>
        <p className={styles.subtitle}>{t("subtitle")}</p>
        <NewRecordButton href="/orders/new" label={t("newOrder")} />
      </header>

      <OrdersGrid key={search} initialSearch={search} filter={view} />
    </div>
  );
}
