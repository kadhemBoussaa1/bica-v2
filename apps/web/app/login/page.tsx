import Image from "next/image";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ROLES } from "@repo/api-contract";
import { LanguagePicker } from "../../i18n/language-picker";
import { LoginForm } from "./login-form";
import styles from "./login.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("login");
  return { title: t("metaTitle"), description: t("subtitle") };
}

export default async function LoginPage() {
  const t = await getTranslations("login");
  const common = await getTranslations("common");
  return (
    <div className={styles.page}>
      <div className={styles.formSide}>
        <div className={styles.form}>
          <div className={styles.brand}>
            <Image
              src="/bicapack-logo.png"
              alt="Bicapack"
              width={40}
              height={40}
              priority
            />
            <span className={styles.eyebrow}>Bicapack ERP</span>
            <LanguagePicker className={styles.language} label={common("language")} />
          </div>
          <LoginForm />
        </div>
      </div>

      <aside className={styles.aside}>
        <span className={styles.asideMark}>{t("asideMark")}</span>
        <div>
          <h2 className={styles.asideTitle}>{t("asideTitle")}</h2>
          <p className={styles.asideBody}>{t("asideBody")}</p>
        </div>
        <div className={styles.asideRoles}>
          {ROLES.map((role) => (
            <span key={role} className={styles.roleChip}>
              {role.replace("_", " ")}
            </span>
          ))}
        </div>
      </aside>
    </div>
  );
}
