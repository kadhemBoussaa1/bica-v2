"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LanguagePicker } from "../../i18n/language-picker";
import { useCurrentUser, useSignOut } from "../auth/use-auth";
import { GlobalSearch } from "./global-search";
import { NAV_SECTIONS, activeChild, isActive } from "./nav-items";
import { initials } from "./initials";
import { MenuIcon, SignOutIcon } from "./nav-icons";
import { NotificationsBell } from "./notifications-bell";
import { useDrawer } from "./use-sidebar";
import { cx } from "./cx";
import styles from "./top-bar.module.css";

/**
 * Where the user is, read off the nav: the group, the module, and — one
 * level deeper — what they are doing in it. Derived from the same table the
 * sidebar renders, so the two can never disagree about a module's name.
 */
function crumbsFor(
  pathname: string,
  nav: (key: string) => string,
  shell: (key: string) => string,
): string[] {
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (!item.href || !isActive(pathname, item.href)) continue;
      const crumbs = [
        section.title ? nav(`sections.${section.title.toLowerCase()}`) : nav("overview"),
      ];
      if (section.title) crumbs.push(nav(`items.${item.key}`));
      // A module with pages inside it names the page too, and what follows
      // is read relative to that page: /settings/users/new → … / Users / New.
      const child = activeChild(pathname, item);
      if (child) crumbs.push(nav(`items.${child.key}`));
      const rest = pathname.slice(child ? child.href.length : item.href.length);
      if (rest.endsWith("/new")) crumbs.push(shell("new"));
      else if (rest.endsWith("/edit")) crumbs.push(shell("edit"));
      else if (rest.length > 1) crumbs.push(shell("detail"));
      return crumbs;
    }
  }
  return [nav("brand")];
}

/**
 * The bar above every page: breadcrumb, the search box, the signed-in user and
 * a sign-out button beside them. On a phone it also carries the menu
 * button that opens the navigation drawer, since the rail is off-canvas.
 *
 * Renders nothing without a session, like the sidebar, so the login page is
 * unaffected.
 */
export function TopBar() {
  const pathname = usePathname();
  const { user, isPending } = useCurrentUser();
  const signOut = useSignOut();
  const { open: drawerOpen, setOpen: setDrawerOpen } = useDrawer(pathname);
  const t = useTranslations("shell");
  const nav = useTranslations("nav");
  const common = useTranslations("common");
  const enums = useTranslations("enums");

  if (isPending || !user) return null;

  const crumbs = crumbsFor(pathname, nav, t);
  const displayName = user.name || user.email;

  return (
    <header className={styles.bar}>
      <button
        type="button"
        className={styles.menuButton}
        onClick={() => setDrawerOpen(true)}
        aria-label={nav("openNav")}
        aria-expanded={drawerOpen}
      >
        <MenuIcon />
      </button>
      <Link href="/" className={styles.mobileBrand} aria-label={nav("overview")}>
        <Image src="/bicapack-logo.png" alt="" width={24} height={24} />
      </Link>

      <nav className={styles.crumbs} aria-label={t("breadcrumb")}>
        {crumbs.map((crumb, index) => (
          <span key={`${crumb}-${index}`} className={styles.crumbPair}>
            {index > 0 && (
              <span className={styles.crumbSep} aria-hidden="true">
                /
              </span>
            )}
            <span
              className={cx(
                styles.crumb,
                index === crumbs.length - 1 && styles.crumbCurrent,
              )}
              aria-current={index === crumbs.length - 1 ? "page" : undefined}
            >
              {crumb}
            </span>
          </span>
        ))}
      </nav>

      <GlobalSearch role={user.role} />

      <div className={styles.account}>
        {/* Every role's bell; also where this tab's notification stream
            lives, since the top bar is on every signed-in page. */}
        <NotificationsBell role={user.role} />

        <div className={styles.accountChip}>
          <span className={styles.avatar} aria-hidden="true">
            {initials(displayName)}
          </span>
          <span className={styles.identity}>
            <span className={styles.userName}>{displayName}</span>
            <span className={styles.userRole}>
              {enums(`role.${user.role}`)}
            </span>
          </span>
        </div>

        <LanguagePicker className={styles.language} label={common("language")} />

        <button
          type="button"
          className={styles.signOut}
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
          title={t("signOut")}
        >
          <span className={styles.menuIcon} aria-hidden="true">
            <SignOutIcon />
          </span>
          <span className={styles.signOutLabel}>
            {signOut.isPending ? t("signingOut") : t("signOut")}
          </span>
        </button>
      </div>
    </header>
  );
}
