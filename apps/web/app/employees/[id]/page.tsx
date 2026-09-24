import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EditEmployee } from "./edit-employee";
import styles from "../../records/records.module.css";

export default async function EditEmployeePage({
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
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("editEmployee")}</h1>
        </div>
      </header>

      <EditEmployee id={id} />
    </div>
  );
}
