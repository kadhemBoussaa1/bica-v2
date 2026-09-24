import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import type { SettingsGroup } from "../nav/nav-items";
import styles from "./settings.module.css";

/**
 * The header above a settings page: "Settings · <group>", the title, the
 * page's primary action at the inline end, and optionally one paragraph on
 * what the page is for. `intro` is omitted where the rail's own hint
 * already says the same thing. A server component — the pages that render
 * it are too — so the action, when it needs the session, is a client
 * component passed in.
 */
export async function SettingsHeader({
  group,
  title,
  intro,
  action,
}: {
  group: SettingsGroup;
  title: string;
  intro?: string;
  action?: ReactNode;
}) {
  const t = await getTranslations("settings");
  return (
    <header className={styles.header}>
      <div className={styles.headerText}>
        <span className={styles.eyebrow}>
          {t("sectionEyebrow", { group: t(`groups.${group}`) })}
        </span>
        <h1 className={styles.title}>{title}</h1>
        {intro !== undefined && <p className={styles.intro}>{intro}</p>}
      </div>
      {action}
    </header>
  );
}
