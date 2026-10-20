import { getTranslations } from "next-intl/server";
import { SuppliersTable } from "./suppliers-table";
import { initialSearchOf, type ListPageProps } from "../records/list-search";
import {
  NewRecordButton,
  RecordActions,
  SecondaryRecordButton,
} from "../records/new-record-button";
import styles from "../records/records.module.css";

/**
 * `?filter=` opens the table on one chip — a family code or `unassigned`,
 * which the families page links to. Initial only, like `?search=`; the server
 * still checks it against the facets that exist.
 */
export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<
    Awaited<ListPageProps["searchParams"]> & { filter?: string | string[] }
  >;
}) {
  const search = await initialSearchOf(searchParams);
  const { filter: filterParam } = await searchParams;
  const filter = (Array.isArray(filterParam) ? filterParam[0] : filterParam) ?? "all";
  const t = await getTranslations("suppliers");
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("title")}</h1>
        </div>
        <p className={styles.subtitle}>{t("subtitle")}</p>
        <RecordActions>
          {/* Families live under this module rather than in the sidebar, so
              this is the way in. */}
          <SecondaryRecordButton
            href="/suppliers/families"
            label={t("supplierFamilies")}
          />
          <NewRecordButton href="/suppliers/new" label={t("newSupplier")} />
        </RecordActions>
      </header>

      <SuppliersTable
        key={`${search}\n${filter}`}
        initialSearch={search}
        initialFilter={filter}
      />
    </div>
  );
}
