import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NewRecordButton } from "../../records/new-record-button";
import { SettingsHeader } from "../settings-header";
import { UsersTable } from "./users-table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("users");
  return { title: t("listMetaTitle") };
}

export default async function UsersPage() {
  const t = await getTranslations("users");
  return (
    <>
      <SettingsHeader
        group="access"
        title={t("title")}
        intro={t("subtitle")}
        action={<NewRecordButton href="/settings/users/new" label={t("newUser")} />}
      />
      <UsersTable />
    </>
  );
}
