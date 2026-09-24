import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsHeader } from "../../settings-header";
import { NewUserForm } from "./new-user-form";
import styles from "../users.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("users");
  return { title: t("metaTitle") };
}

/**
 * The full page behind the creation dialog: a hard load of /settings/users/new
 * (a bookmark, a refresh) lands here; in-app navigation opens the same form
 * over the list (`app/@modal/(.)settings/users/new`).
 */
export default async function NewUserPage() {
  const t = await getTranslations("users");
  return (
    <>
      <Link className={styles.back} href="/settings/users">
        {t("backToUsers")}
      </Link>
      <SettingsHeader group="access" title={t("newUser")} intro={t("newUserSubtitle")} />
      <NewUserForm />
    </>
  );
}
