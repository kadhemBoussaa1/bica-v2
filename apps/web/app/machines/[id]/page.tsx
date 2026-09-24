import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EditMachine } from "./edit-machine";
import styles from "../../records/records.module.css";

export default async function EditMachinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("machines");

  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/machines">
        {t("back")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("editMachine")}</h1>
        </div>
      </header>

      <EditMachine id={id} />
    </div>
  );
}
