import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmployeeDetail } from "../employee-detail";
import styles from "../../records/records.module.css";

export default async function EmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("employees");

  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/employees">
        {t("back")}
      </Link>
      <EmployeeDetail id={id} />
    </div>
  );
}
