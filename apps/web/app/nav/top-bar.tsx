"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LanguagePicker } from "../../i18n/language-picker";
import { useCurrentUser, useSignOut } from "../auth/use-auth";
import { NAV_SECTIONS, activeChild, canSee, isActive } from "./nav-items";
import { initials } from "./initials";
import { MenuIcon, NAV_ICONS, SearchIcon, SignOutIcon } from "./nav-icons";
import { useDrawer } from "./use-sidebar";
import styles from "./top-bar.module.css";

function cx(...classes: (string | undefined | false | null)[]) {
  return classes.filter(Boolean).join(" ");
}

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
 * The bar above every page: breadcrumb, a jump box, the signed-in user and
 * a sign-out button beside them. On a phone it also carries the menu
 * button that opens the navigation drawer, since the rail is off-canvas.
 *
 * Renders nothing without a session, like the sidebar, so the login page is
 * unaffected.
 */
export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isPending } = useCurrentUser();
  const signOut = useSignOut();
  const { open: drawerOpen, setOpen: setDrawerOpen } = useDrawer(pathname);
  const t = useTranslations("shell");
  const nav = useTranslations("nav");
  const common = useTranslations("common");
  const enums = useTranslations("enums");

  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // The jump popover closes on an outside click and on Escape.
  useEffect(() => {
    if (!searchFocused) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (searchRef.current && !searchRef.current.contains(target))
        setSearchFocused(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSearchFocused(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [searchFocused]);

  if (isPending || !user) return null;

  /*
   * The jump box: type a module's name, Enter opens it. Only modules this
   * role can reach and that exist, filtered the same way the sidebar is —
   * plus the pages inside a module that has them, so "users" still lands on
   * the users page now that it is a tile under Settings rather than a row.
   * Not a record search — that lives on each list, where the server does it.
   */
  const term = query.trim().toLowerCase();
  const matches = NAV_SECTIONS.flatMap((section) => {
    const group = section.title
      ? nav(`sections.${section.title.toLowerCase()}`)
      : null;
    return section.items
      .filter((item) => item.href !== null && canSee(user.role, item))
      .flatMap((item) => [item, ...(item.children ?? [])])
      .filter((entry) => canSee(user.role, entry))
      .map((entry) => ({
        key: entry.key,
        label: nav(`items.${entry.key}`),
        href: entry.href as string,
        group,
      }))
      .filter((entry) => term === "" || entry.label.toLowerCase().includes(term));
  });
  const showMatches = searchFocused && term !== "";

  const jump = (href: string) => {
    setQuery("");
    setSearchFocused(false);
    router.push(href);
  };

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && matches[0] && term !== "") {
      event.preventDefault();
      jump(matches[0].href);
    }
  };

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

      <div className={styles.search} ref={searchRef}>
        <span className={styles.searchIcon} aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          type="search"
          className={styles.searchInput}
          placeholder={t("goTo")}
          aria-label={t("goToModule")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearchFocused(true);
          }}
          onFocus={() => setSearchFocused(true)}
          onKeyDown={onSearchKey}
          autoComplete="off"
        />
        {showMatches && (
          <div className={styles.popover} role="listbox" aria-label={t("modules")}>
            {matches.length === 0 && (
              <div className={styles.popoverEmpty}>{t("noModuleMatches")}</div>
            )}
            {matches.map((item, index) => {
              const Icon = NAV_ICONS[item.key];
              return (
                <button
                  key={item.key}
                  type="button"
                  role="option"
                  aria-selected={index === 0}
                  className={cx(
                    styles.popoverItem,
                    index === 0 && styles.popoverItemFirst,
                  )}
                  onClick={() => jump(item.href)}
                >
                  <span className={styles.popoverIcon}>
                    {Icon ? <Icon /> : null}
                  </span>
                  <span className={styles.popoverLabel}>{item.label}</span>
                  {item.group && (
                    <span className={styles.popoverGroup}>{item.group}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className={styles.account}>
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
