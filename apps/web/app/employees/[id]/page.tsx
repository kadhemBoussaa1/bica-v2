import { EmployeeBackLink } from "../employee-back-link";
import { EmployeeDetail } from "../employee-detail";
import styles from "../../records/records.module.css";

export default async function EmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className={styles.page}>
      <EmployeeBackLink id={id} className={styles.back} />
      <EmployeeDetail id={id} />
    </div>
  );
}
