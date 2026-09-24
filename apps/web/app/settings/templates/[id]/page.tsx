import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TemplateEditor } from "./template-editor";
import styles from "../../../records/records.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("templates");
  return { title: t("editor.metaTitle") };
}

export default async function DocumentTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("templates");

  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/settings/templates">
        {t("back")}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t("eyebrow")}</span>
          <h1 className={styles.title}>{t("editor.title")}</h1>
        </div>
        <p className={styles.subtitle}>{t("editor.subtitle")}</p>
      </header>

      <TemplateEditor id={id} />
    </div>
  );
}
