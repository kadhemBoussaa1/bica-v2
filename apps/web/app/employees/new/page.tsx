import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmployeeForm } from "../employee-form";
import styles from "../../records/records.module.css";

export default async function NewEmployeePage() {
  const t = await getTranslations("employees");
  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/employees">
        {t("back")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("newEmployee")}</h1>
        </div>
      </header>

      <EmployeeForm />
    </div>
  );
}
