import { EmployeesTable } from "./employees-table";
import styles from "../records/records.module.css";

/** The header lives in the table: its figures come from the same queries. */
export default function EmployeesPage() {
  return (
    <div className={styles.page}>
      <EmployeesTable />
    </div>
  );
}
