"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { numberFormat } from "../../i18n/formats";
import { useCurrentUser } from "../auth/use-auth";
import { NAV_ICONS } from "../nav/nav-icons";
import { SETTINGS_CHILDREN, SETTINGS_GROUPS, canSee, isChildActive, type NavChild } from "../nav/nav-items";
import { useTRPC } from "../trpc/client";
import styles from "./settings.module.css";

type Summary = {
  users: { active: number; banned: number };
  activity: { total: number; errors: number };
  templates: { defaultVersion: number | null; drafts: number };
};

/**
 * The rail beside every settings page: the module's pages grouped, each
 * with its live figure — accounts, trace errors, the default template's
 * version. Reads the same list as the breadcrumb and the jump box, filtered
 * by role the way the sidebar is: UX only, every procedure authorizes the
 * real session. Links, not tabs: these are pages with their own URLs.
 */
export function SettingsRail() {
  const pathname = usePathname();
  const { user } = useCurrentUser();
  const nav = useTranslations("nav");
  const t = useTranslations("settings");
  const trpc = useTRPC();

  const summaryQuery = useQuery({
    ...trpc.settings.summary.queryOptions(),
    enabled: user !== null,
    // Mounted for the whole visit to the module, so it would never refetch
    // on its own; the same minute's refresh as the sidebar's counts.
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (!user) return null;

  const pages = SETTINGS_CHILDREN.filter((child) => canSee(user.role, child));
  const summary = summaryQuery.data;
  const figure = numberFormat({ maximumFractionDigits: 0 });

  /** The short figure beside the label, and whether it is a warning. */
  const countFor = (child: NavChild): { text: string; warn: boolean } => {
    if (!summary) return { text: "", warn: false };
    switch (child.key) {
      case "users":
        return { text: figure.format(summary.users.active), warn: false };
      case "activity":
        return {
          text: t("counts.errors", { count: figure.format(summary.activity.errors) }),
          warn: summary.activity.errors > 0,
        };
      case "templates":
        return {
          text:
            summary.templates.defaultVersion === null
              ? ""
              : t("counts.version", { version: summary.templates.defaultVersion }),
          warn: false,
        };
      default:
        return { text: "", warn: false };
    }
  };

  return (
    <nav className={styles.rail} aria-label={t("pagesAria")}>
      <div className={styles.railHead}>
        <span className={styles.railEyebrow}>{t("eyebrow")}</span>
        <span className={styles.railTitle}>{t("title")}</span>
      </div>

      <div className={styles.groups}>
        {SETTINGS_GROUPS.map((group) => {
          const items = pages.filter((child) => child.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group} className={styles.group}>
              <div className={styles.groupLabel}>{t(`groups.${group}`)}</div>
              {items.map((child) => {
                const Icon = NAV_ICONS[child.key];
                const active = isChildActive(pathname, child);
                const count = countFor(child);
                return (
                  <Link
                    key={child.key}
                    href={child.href}
                    className={[styles.item, active ? styles.itemActive : null]
                      .filter(Boolean)
                      .join(" ")}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className={styles.itemIcon} aria-hidden="true">
                      {Icon ? <Icon /> : null}
                    </span>
                    <span className={styles.itemText}>
                      <span className={styles.itemTop}>
                        <span className={styles.itemLabel}>{nav(`items.${child.key}`)}</span>
                        {count.text !== "" && (
                          <span
                            className={[styles.itemCount, count.warn ? styles.itemCountWarn : null]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            {count.text}
                          </span>
                        )}
                      </span>
                      <span className={styles.itemHint}>{t(`hints.${child.key}`)}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>

      <p className={styles.railNote}>{t("railNote")}</p>
    </nav>
  );
}

export type { Summary as SettingsSummary };
