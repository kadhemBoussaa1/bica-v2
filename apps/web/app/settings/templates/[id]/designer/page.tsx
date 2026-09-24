import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TemplateDesigner } from "./template-designer";
import styles from "../../../../records/records.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("templates");
  return { title: t("designer.metaTitle") };
}

export default async function DocumentTemplateDesignerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("templates");

  return (
    <div className={styles.page}>
      <Link className={styles.back} href={`/settings/templates/${id}`}>
        {t("designer.back")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("designer.title")}</h1>
        </div>
        <p className={styles.subtitle}>{t("designer.subtitle")}</p>
      </header>

      <TemplateDesigner id={id} />
    </div>
  );
}
