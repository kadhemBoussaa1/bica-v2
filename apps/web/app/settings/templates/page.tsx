import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsHeader } from "../settings-header";
import { NewTemplateButton } from "./new-template-button";
import { TemplatesList } from "./templates-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("templates");
  return { title: t("metaTitle") };
}

export default async function DocumentTemplatesPage() {
  const t = await getTranslations("templates");
  return (
    <>
      <SettingsHeader
        group="documents"
        title={t("title")}
        intro={t("subtitle")}
        action={<NewTemplateButton />}
      />
      <TemplatesList />
    </>
  );
}
