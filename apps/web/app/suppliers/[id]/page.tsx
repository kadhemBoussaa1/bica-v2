import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EditSupplier } from "./edit-supplier";
import styles from "../../records/records.module.css";

export default async function EditSupplierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("suppliers");

  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/suppliers">
        {t("backToList")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("editTitle")}</h1>
        </div>
        <p className={styles.subtitle}>{t("editSubtitle")}</p>
      </header>

      <EditSupplier id={id} />
    </div>
  );
}
