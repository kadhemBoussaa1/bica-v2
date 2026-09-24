import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MachineForm } from "../machine-form";
import styles from "../../records/records.module.css";

export default async function NewMachinePage() {
  const t = await getTranslations("machines");
  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/machines">
        {t("back")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("newMachine")}</h1>
        </div>
      </header>

      <MachineForm />
    </div>
  );
}
