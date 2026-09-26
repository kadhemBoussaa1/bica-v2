import { EmployeesTable } from "../employees-table";
import styles from "../../records/records.module.css";

/**
 * A deep link to the new-employee form. The form is a sheet over the list,
 * so this is the list with the sheet already open; closing it lands on
 * `/employees`.
 */
export default function NewEmployeePage() {
  return (
    <div className={styles.page}>
      <EmployeesTable startCreating />
    </div>
  );
}
