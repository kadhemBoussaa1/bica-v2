"use client";

import { Suspense, useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCurrentUser } from "../auth/use-auth";
import { InstallDialog } from "../pwa/install-dialog";
import { InstallIcon } from "../pwa/pwa-icons";
import { useInstall } from "../pwa/use-install";
import { useTRPC } from "../trpc/client";
import { NAV_SECTIONS, canSee, isActive, type NavItem, type NavViews } from "./nav-items";
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

interface ViewRowsProps {
  href: string;
  views: NavViews;
  pathname: string;
  counts: Partial<Record<string, number>> | null | undefined;
  /** The view on screen, or null while the search params are unknown. */
  current: string | null;
  onNavigate: () => void;
}

/** "All", then one link per view, each with its count once it is known. */
function ViewRows({ href, views, pathname, counts, current, onNavigate }: ViewRowsProps) {
  const messages = useTranslations();
  const common = useTranslations("common");
  const onList = pathname === href;

  return ["all", ...views.keys].map((key) => {
    const active = onList && current === key;
    const count = key === "all" ? undefined : counts?.[key];
    return (
      <Link
        key={key}
        href={key === "all" ? href : `${href}?filter=${key}`}
        className={cx(styles.row, styles.viewRow, active && styles.rowActive)}
        aria-current={active ? "page" : undefined}
        // The drawer closes on a path change, and a view only changes the
        // query: without this it would stay over the list it just opened.
        onClick={onNavigate}
      >
        <span className={styles.label}>
          {key === "all" ? common("all") : messages(`${views.labels}.${key}`)}
        </span>
        {count !== undefined && (
          <span className={styles.count}>{int.format(count)}</span>
        )}
      </Link>
    );
  });
}

/** The rows with the one `?filter=` names marked; an unknown one reads as "All". */
function CurrentViewRows(props: Omit<ViewRowsProps, "current">) {
  const filter = useSearchParams().get("filter");
  const current = filter !== null && props.views.keys.includes(filter) ? filter : "all";
  return <ViewRows {...props} current={current} />;
}

/**
 * A row with views (nav-items `views`): a disclosure over the module list's
 * facets rather than a link, opened by clicking its name. It opens by itself
 * on entering the module, so the view on screen is in sight, and is left as
 * it was on leaving. The desktop rail has no room for the views, so there
 * the caller renders the plain row instead.
 *
 * While open, the row is only tinted: the view row below carries the active
 * ground, and two lit rows would not say which page this is.
 */
function NavGroup({
  item,
  href,
  views,
  pathname,
  count,
  viewCounts,
  onNavigate,
}: {
  item: NavItem;
  href: string;
  views: NavViews;
  pathname: string;
  count: number | null | undefined;
  viewCounts: Partial<Record<string, number>> | null | undefined;
  onNavigate: () => void;
}) {
  const nav = useTranslations("nav");
  const label = nav(`items.${item.key}`);
  const Icon = NAV_ICONS[item.key];
  const listId = useId();
  const inModule = isActive(pathname, href);
  const [expanded, setExpanded] = useState(inModule);
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    if (inModule && !isActive(seenPath, href)) setExpanded(true);
  }

  const rows = { href, views, pathname, counts: viewCounts, onNavigate };

  return (
    <div>
      <button
        type="button"
        className={cx(
          styles.row,
          styles.rowButton,
          inModule && (expanded ? styles.rowCurrent : styles.rowActive),
        )}
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((open) => !open)}
      >
        <span className={styles.icon}>{Icon ? <Icon /> : null}</span>
        <span className={styles.label}>{label}</span>
        {count !== null && count !== undefined && (
          <span className={styles.count}>{int.format(count)}</span>
        )}
        <span
          className={cx(styles.disclosure, expanded && styles.disclosureOpen)}
          aria-hidden="true"
        >
          <ChevronIcon />
        </span>
      </button>
      {expanded && (
        <div id={listId} className={styles.views}>
          {/* `useSearchParams` needs a boundary of its own in the root
              layout; until it resolves, no view is marked. */}
          <Suspense fallback={<ViewRows {...rows} current={null} />}>
            <CurrentViewRows {...rows} />
          </Suspense>
        </div>
      )}
    </div>
  );
}

/**
 * "Install app", at the foot of the rail — docs/pwa-plan.md step 6. The
 * rail is the phone's drawer too, so every role sees it. Chrome's own
 * dialog where it offers one (Android, desktop); the "Add to Home Screen"
 * steps on iOS, which has none; nothing once installed, or in a browser
 * that cannot install.
 */
function InstallRow() {
  const shell = useTranslations("shell");
  const { canPrompt, isIos, isStandalone, prompt } = useInstall();
  const [steps, setSteps] = useState(false);
  if (isStandalone || !(canPrompt || isIos)) return null;

  const label = shell("install.row");
  return (
    <div className={styles.foot}>
      <button
        type="button"
        className={cx(styles.row, styles.rowButton)}
        // iOS first: its browsers never offer Chrome's prompt, so the steps
        // are the only way there, whatever else the page has heard.
        onClick={() => (isIos ? setSteps(true) : void prompt())}
        // In rail mode the label is hidden, so the title is the tooltip.
        title={label}
      >
        <span className={styles.icon}>
          <InstallIcon />
        </span>
        <span className={styles.label}>{label}</span>
      </button>
      <InstallDialog open={steps} onClose={() => setSteps(false)} />
    </div>
  );
}

/**
 * The app shell's navigation rail: brand, the modules grouped by who works
 * them, the install row, and the collapse toggle at its foot. Identity and sign-out live in
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

  // The figures beside the view rows, per item with views.
  const viewCounts: Record<string, Partial<Record<string, number>> | null | undefined> = {
    "job-orders": countsQuery.data?.orderViews,
  };

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
                {section.items.map((item) =>
                  item.href &&
                  item.views &&
                  canSee(user.role, item.views) &&
                  // The desktop rail shows icons only; the drawer always
                  // shows labels, whatever the stored rail preference.
                  !(collapsed && !open) ? (
                    <NavGroup
                      key={item.key}
                      item={item}
                      href={item.href}
                      views={item.views}
                      pathname={pathname}
                      count={counts[item.key]}
                      viewCounts={viewCounts[item.key]}
                      onNavigate={() => setOpen(false)}
                    />
                  ) : (
                    <NavRow
                      key={item.key}
                      item={item}
                      pathname={pathname}
                      count={counts[item.key]}
                    />
                  ),
                )}
              </div>
            </div>
          ))}
        </nav>

        <InstallRow />

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
