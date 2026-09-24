import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EditClient } from "./edit-client";
import styles from "../../records/records.module.css";

/** Params are a promise in Next 15+. */
export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("clients");

  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/clients">
        {t("backToList")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("editTitle")}</h1>
        </div>
        <p className={styles.subtitle}>{t("editSubtitle")}</p>
      </header>

      <EditClient id={id} />
    </div>
  );
}
