import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmployeesTable, type OffRosterFilter } from "../employees-table";
import { initialSearchOf, type ListPageProps } from "../../records/list-search";
import styles from "../../records/records.module.css";

/**
 * Everyone off the roster — the legacy `suspended` flag and this app's
 * archive — kept out of the main list. Reached from the list's suspended
 * tile. `?filter=archived` opens it on the archive (the roster's search
 * link does when only archived records match); initial only, like
 * `?search=`.
 */
export default async function OffRosterPage({
  searchParams,
}: {
  searchParams: Promise<
    Awaited<ListPageProps["searchParams"]> & { filter?: string | string[] }
  >;
}) {
  const search = await initialSearchOf(searchParams);
  const { filter: filterParam } = await searchParams;
  const filter: OffRosterFilter =
    (Array.isArray(filterParam) ? filterParam[0] : filterParam) === "archived"
      ? "archived"
      : "suspended";
  const t = await getTranslations("employees");
  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/employees">
        {t("back")}
      </Link>
      <EmployeesTable
        key={`${search}\n${filter}`}
        view="off"
        initialSearch={search}
        initialFilter={filter}
      />
    </div>
  );
}
