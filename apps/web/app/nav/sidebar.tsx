"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCurrentUser } from "../auth/use-auth";
import { useTRPC } from "../trpc/client";
import { NAV_SECTIONS, canSee, isActive, type NavItem } from "./nav-items";
import { ChevronIcon, CloseIcon, NAV_ICONS } from "./nav-icons";
import { useTranslations } from "next-intl";
import { useDrawer, useSidebarCollapsed } from "./use-sidebar";
import { cx } from "./cx";
import styles from "./sidebar.module.css";

const int = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/** One nav row: a Link when built, an inert span when planned. */
function NavRow({
  item,
  pathname,
  count,
}: {
  item: NavItem;
  pathname: string;
  count: number | null | undefined;
}) {
  const nav = useTranslations("nav");
  const label = nav(`items.${item.key}`);
  const Icon = NAV_ICONS[item.key];
  const glyph = <span className={styles.icon}>{Icon ? <Icon /> : null}</span>;

  if (!item.href) {
    return (
      <span
        className={cx(styles.row, styles.rowPlanned)}
        // Not a link and not focusable, so keyboard users are not sent through
        // dead stops to reach Users. The title carries the reason for anyone
        // who hovers.
        title={nav("planned", { label })}
      >
        {glyph}
        <span className={styles.label}>{label}</span>
        {/* A marker, not a word: the label is dimmed and the dot says "not yet"
            without stacked chips out-shouting the live items. The state is
            spelled out for assistive tech, which cannot see dimming. */}
        <span className="sr-only">{nav("plannedSr")}</span>
        <span className={styles.planned} aria-hidden="true" />
      </span>
    );
  }

  const active = isActive(pathname, item.href);

  return (
    <Link
      href={item.href}
      className={cx(styles.row, active && styles.rowActive)}
      aria-current={active ? "page" : undefined}
      // In rail mode the label is hidden, so the title is the tooltip.
      title={label}
    >
      {glyph}
      <span className={styles.label}>{label}</span>
      {count !== null && count !== undefined && (
        <span className={styles.count}>{int.format(count)}</span>
      )}
    </Link>
  );
}

/**
 * The app shell's navigation rail: brand, the modules grouped by who works
 * them, and the collapse toggle at its foot. Identity and sign-out live in
 * the top bar (see top-bar.tsx), so the rail is navigation and nothing else.
 *
 * Renders nothing without a session, which is what lets it sit in the root
 * layout without appearing on the login page.
 */
export function Sidebar() {
  const pathname = usePathname();
  const trpc = useTRPC();
  const { user, isPending } = useCurrentUser();
  const { collapsed, toggle, ready } = useSidebarCollapsed();
  const nav = useTranslations("nav");
  const { open, setOpen } = useDrawer(pathname);
  const signedOut = !isPending && !user;

  // The figures beside Clients, Suppliers, Job orders and Shipments (draft
  // shipments awaiting a truck). One request; each is null for a role that
  // cannot open the module, and the row is hidden.
  const countsQuery = useQuery({
    ...trpc.nav.counts.queryOptions(),
    enabled: user !== null,
    // The sidebar mounts once, so it would never refetch on its own; a
    // minute's refresh keeps the figures honest after a record is added.
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  // Chat is not in this rail: it lives in the corner launcher, which carries
  // its own unread badge on every page (app/chat/chat-launcher.tsx).
  const counts: Record<string, number | null | undefined> = {
    clients: countsQuery.data?.clients,
    suppliers: countsQuery.data?.suppliers,
    "job-orders": countsQuery.data?.orders,
    shipments: countsQuery.data?.shipments,
    receiving: countsQuery.data?.receiving,
    // 1 while a stocktake is open, 0 otherwise — at most one can exist, so
    // this badge reads "a count is running", not "N things to do".
    stocktake: countsQuery.data?.stocktake,
    // Shift requests awaiting a decision; my open tickets on the running
    // or next shift.
    shifts: countsQuery.data?.shifts,
    "my-shifts": countsQuery.data?.["my-shifts"],
  };

  /*
   * The content column's left padding lives in globals.css and is driven by two
   * classes on <html>. Setting them here — rather than wrapping children in a
   * client component — keeps the root layout a server component, and keeps the
   * rail's width and the column's offset reading the same tokens.
   */
  useEffect(() => {
    const { classList } = document.documentElement;
    classList.toggle("sidebar-collapsed", collapsed && !signedOut);
    classList.toggle("sidebar-hidden", signedOut);
  }, [collapsed, signedOut]);

  // While the session resolves, hold the rail's width with an empty shell so
  // the content column does not jump sideways once nav appears.
  if (isPending) {
    return <div className={cx(styles.sidebar, styles.sidebarLoading)} />;
  }

  if (!user) return null;

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canSee(user.role, item)),
  })).filter((section) => section.items.length > 0);

  return (
    <>
      {open && (
        <div
          className={styles.overlay}
          onClick={() => setOpen(false)}
          // The drawer's own close button and Escape are the accessible paths;
          // this backdrop is a pointer affordance, so it is hidden from AT
          // rather than exposed as a second unlabelled control.
          aria-hidden="true"
        />
      )}

      <aside
        className={cx(
          styles.sidebar,
          collapsed && styles.collapsed,
          open && styles.drawerOpen,
          // Suppress the width animation until the stored preference has been
          // applied, so a restored rail does not visibly slide shut on load.
          !ready && styles.noTransition,
        )}
      >
        <div className={styles.brand}>
          <Link href="/" className={styles.brandLink} title={nav("overview")}>
            <Image
              src="/bicapack-logo.png"
              alt=""
              width={32}
              height={32}
              className={styles.brandMark}
            />
            <span className={styles.brandName}>{nav("brand")}</span>
          </Link>

          <button
            type="button"
            className={cx(styles.iconButton, styles.closeButton)}
            onClick={() => setOpen(false)}
            aria-label={nav("closeNav")}
          >
            <CloseIcon />
          </button>
        </div>

        <nav className={styles.nav} aria-label={nav("main")}>
          {sections.map((section) => (
            <div key={section.title ?? "primary"} className={styles.section}>
              {section.title ? (
                <div className={styles.sectionTitle}>
                  <span className={styles.sectionLabel}>{nav(`sections.${section.title.toLowerCase()}`)}</span>
                  <span className={styles.sectionRule} aria-hidden="true" />
                </div>
              ) : null}
              <div className={styles.rows}>
                {section.items.map((item) => (
                  <NavRow
                    key={item.key}
                    item={item}
                    pathname={pathname}
                    count={counts[item.key]}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <button
          type="button"
          className={styles.collapseButton}
          onClick={toggle}
          aria-label={collapsed ? nav("expandSidebar") : nav("collapseSidebar")}
          title={collapsed ? nav("expand") : nav("collapse")}
        >
          <span className={cx(styles.icon, styles.chevron)}>
            <ChevronIcon />
          </span>
          <span className={styles.label}>{nav("collapse")}</span>
        </button>
      </aside>
    </>
  );
}
