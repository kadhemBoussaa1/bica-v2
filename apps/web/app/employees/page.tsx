import { EmployeesTable } from "./employees-table";
import { initialSearchOf, type ListPageProps } from "../records/list-search";
import styles from "../records/records.module.css";

/** The header lives in the table: its figures come from the same queries. */
export default async function EmployeesPage({ searchParams }: ListPageProps) {
  const search = await initialSearchOf(searchParams);
  return (
    <div className={styles.page}>
      <EmployeesTable key={search} initialSearch={search} />
    </div>
  );
}
