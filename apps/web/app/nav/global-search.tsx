"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import { GLOBAL_SEARCH_MIN_LENGTH, type Role, type SearchKind } from "@repo/api-contract";
import { formatDay } from "../../i18n/formats";
import { useDebounced } from "../records/partner-ui";
import { useTRPC } from "../trpc/client";
import { NAV_SECTIONS, canSee } from "./nav-items";
import { NAV_ICONS, SearchIcon } from "./nav-icons";
import { cx } from "./cx";
import styles from "./global-search.module.css";

type SearchGroup = inferRouterOutputs<AppRouter>["search"]["global"]["groups"][number];
type SearchHit = SearchGroup["hits"][number];

/**
 * The sidebar entry each record type lives under. It lends the group its
 * name and icon, and its href is the list: every record page sits at
 * `<list>/<id>`, and "see all" opens the list with the term in its search.
 */
const KIND_NAV: Record<SearchKind, string> = {
  client: "clients",
  supplier: "suppliers",
  product: "products",
  order: "job-orders",
  manufacturingOrder: "manufacturing-orders",
  machine: "machines",
  employee: "employees",
  roll: "stock",
  paperShipment: "paper-shipments",
  stockCount: "stocktake",
  ink: "ink-stock",
  exportShipment: "shipments",
  purchaseOrder: "purchase-orders",
  goodsReceipt: "goods-receipts",
  purchaseInvoice: "purchase-invoices",
  salesInvoice: "sales-invoices",
};

const NAV_HREFS = new Map(
  NAV_SECTIONS.flatMap((section) => section.items).map((item) => [item.key, item.href]),
);

/** A record type's list page; the server only returns types that have one. */
function listHref(kind: SearchKind): string {
  return NAV_HREFS.get(KIND_NAV[kind]) ?? "/";
}

/** One row the arrow keys can land on. */
type Option = { id: string; href: string } & (
  | { type: "module"; key: string; label: string; group: string | null }
  | { type: "record"; kind: SearchKind; hit: SearchHit }
  | { type: "more"; kind: SearchKind }
);

/** A labelled run of rows; `index` is each row's place in the arrow-key order. */
interface Section {
  key: string;
  label: string;
  rows: { option: Option; index: number }[];
}

/** How long typing must pause before the records are asked for. */
const DEBOUNCE_MS = 300;

/**
 * The top bar's search box. Module names match as you type, in the browser,
 * exactly as before; from two characters on it also asks the server for
 * records — suppliers, orders, invoices, reels… — in every module this role
 * opens (`search.global`, which applies each module's own gate, scope and
 * search columns). Arrow keys move through both, Enter opens the one that
 * is lit.
 *
 * Each server search is a row in the activity trace, by decision, so it
 * waits for a pause in typing and never refetches on its own.
 */
export function GlobalSearch({ role }: { role: Role }) {
  const router = useRouter();
  const trpc = useTRPC();
  const t = useTranslations("shell");
  const nav = useTranslations("nav");
  const listboxId = useId();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // Closes on an outside click and on Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const term = query.trim();
  const settled = useDebounced(term, DEBOUNCE_MS);
  const searching = open && settled.length >= GLOBAL_SEARCH_MIN_LENGTH;
  const records = useQuery({
    ...trpc.search.global.queryOptions({ term: settled }),
    enabled: searching,
    // The last results stay up, dimmed, while the next ones load.
    placeholderData: (previous) => previous,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  /*
   * Modules: the ones this role can reach, filtered the way the sidebar is,
   * plus the pages inside a module that has them, so "users" still lands on
   * the users page under Settings.
   */
  const needle = term.toLowerCase();
  const moduleOptions: Option[] =
    needle === ""
      ? []
      : NAV_SECTIONS.flatMap((section) => {
          const group = section.title ? nav(`sections.${section.title.toLowerCase()}`) : null;
          return section.items
            .filter((item) => item.href !== null && canSee(role, item))
            .flatMap((item) => [item, ...(item.children ?? [])])
            .filter((entry) => canSee(role, entry))
            .map((entry) => ({
              type: "module" as const,
              id: `module:${entry.key}`,
              key: entry.key,
              label: nav(`items.${entry.key}`),
              group,
              href: entry.href as string,
            }))
            .filter((entry) => entry.label.toLowerCase().includes(needle));
        });

  const groups = searching ? (records.data?.groups ?? []) : [];
  const recordSections = groups.map((group) => {
    const list = listHref(group.kind);
    const rows: Option[] = group.hits.map((hit) => ({
      type: "record",
      id: `${group.kind}:${hit.id}`,
      kind: group.kind,
      hit,
      href: `${list}/${hit.id}`,
    }));
    if (group.more) {
      rows.push({
        type: "more",
        id: `more:${group.kind}`,
        kind: group.kind,
        href: `${list}?search=${encodeURIComponent(settled)}`,
      });
    }
    return { key: group.kind, label: nav(`items.${KIND_NAV[group.kind]}`), rows };
  });

  // Numbered in drawing order, so the arrow keys walk the popover top to bottom.
  const options: Option[] = [];
  const number = (rows: Option[]) =>
    rows.map((option) => ({ option, index: options.push(option) - 1 }));
  const moduleSection: Section = {
    key: "modules",
    label: t("modules"),
    rows: number(moduleOptions),
  };
  const sections: Section[] = recordSections.map((section) => ({
    ...section,
    rows: number(section.rows),
  }));

  // A new term, or new results, starts again from the top.
  const resultsKey = `${needle}|${records.dataUpdatedAt}`;
  const [lastKey, setLastKey] = useState(resultsKey);
  if (lastKey !== resultsKey) {
    setLastKey(resultsKey);
    setActive(0);
  }
  const current = Math.min(active, Math.max(options.length - 1, 0));
  const optionId = (index: number) => `${listboxId}-${index}`;
  const showPopover = open && term !== "";
  const activeId = showPopover && options.length > 0 ? optionId(current) : undefined;

  // Keeps the lit row in view as the arrow keys walk past the popover's edge.
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const go = (href: string) => {
    setQuery("");
    setOpen(false);
    router.push(href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (options.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const count = options.length;
      // From the previous state, not `current`: keys held down repeat faster than renders.
      setActive((previous) => (Math.min(previous, count - 1) + step + count) % count);
    } else if (event.key === "Enter") {
      const option = options[current];
      if (!open || !option) return;
      event.preventDefault();
      go(option.href);
    }
  };

  const waiting = term !== settled || records.isFetching;
  const pendingFirst = searching && records.isPending;
  const typingTowardsSearch = term.length >= GLOBAL_SEARCH_MIN_LENGTH && term !== settled;
  const nothing =
    options.length === 0 && !pendingFirst && !typingTowardsSearch && !records.isError;

  const renderOption = ({ option, index }: Section["rows"][number]) => {
    const isActive = index === current;
    return (
      <button
        key={option.id}
        id={optionId(index)}
        type="button"
        role="option"
        tabIndex={-1}
        aria-selected={isActive}
        className={cx(
          styles.option,
          isActive && styles.optionActive,
          option.type === "more" && styles.more,
          option.type === "record" && option.hit.archived && styles.archived,
        )}
        onMouseMove={() => {
          if (!isActive) setActive(index);
        }}
        onClick={() => go(option.href)}
      >
        {option.type === "module" && <ModuleRow option={option} />}
        {option.type === "record" && <RecordRow kind={option.kind} hit={option.hit} />}
        {option.type === "more" && (
          <span className={styles.text}>
            <span className={styles.title}>
              {t("search.seeAll", { module: nav(`items.${KIND_NAV[option.kind]}`) })}{" "}
              <span className={styles.moreArrow} aria-hidden="true">
                →
              </span>
            </span>
          </span>
        )}
      </button>
    );
  };

  const renderSection = (section: Section, stale = false) => (
    <div
      key={section.key}
      className={cx(styles.section, stale && styles.stale)}
      role="group"
      aria-label={section.label}
    >
      <div className={styles.sectionLabel} aria-hidden="true">
        {section.label}
      </div>
      {section.rows.map(renderOption)}
    </div>
  );

  return (
    <div className={styles.search} ref={boxRef}>
      <div className={styles.field}>
        <span className={styles.searchIcon} aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          type="search"
          role="combobox"
          className={styles.searchInput}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchLabel")}
          aria-expanded={showPopover}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="off"
        />
      </div>

      {showPopover && (
        <div className={styles.popover} id={listboxId} role="listbox" aria-label={t("searchLabel")}>
          {moduleSection.rows.length > 0 && renderSection(moduleSection)}
          {sections.map((section) => renderSection(section, waiting))}

          {(pendingFirst || (typingTowardsSearch && groups.length === 0)) && (
            <div className={styles.status} role="status">
              {t("search.searching")}
            </div>
          )}
          {records.isError && searching && (
            <div className={styles.status} role="status">
              {t("search.failed")}
            </div>
          )}
          {nothing && (
            <div className={styles.status} role="status">
              {t("noMatches", { term })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModuleRow({ option }: { option: Extract<Option, { type: "module" }> }) {
  const Icon = NAV_ICONS[option.key];
  return (
    <>
      <span className={styles.icon}>{Icon ? <Icon /> : null}</span>
      <span className={styles.text}>
        <span className={styles.title}>{option.label}</span>
      </span>
      {option.group && <span className={styles.meta}>{option.group}</span>}
    </>
  );
}

function RecordRow({ kind, hit }: { kind: SearchKind; hit: SearchHit }) {
  const t = useTranslations("shell");
  const Icon = NAV_ICONS[KIND_NAV[kind]];
  // No tRPC transformer is configured, so dates arrive as ISO strings.
  const date = hit.date === null ? null : formatDay(hit.date);

  let title: string;
  if (kind === "stockCount") title = t("search.stocktakeOf", { date: date ?? "" });
  else if (hit.title !== null) title = hit.title;
  else if (kind === "salesInvoice" || kind === "exportShipment") title = t("search.draft");
  else title = t("search.noNumber");

  return (
    <>
      <span className={styles.icon}>{Icon ? <Icon /> : null}</span>
      <span className={styles.text}>
        <span className={cx(styles.title, styles.recordTitle)}>
          <bdi>{title}</bdi>
        </span>
        {hit.detail && (
          <span className={styles.detail}>
            <bdi>{hit.detail}</bdi>
          </span>
        )}
      </span>
      {(hit.archived || (date && kind !== "stockCount")) && (
        <span className={styles.meta}>
          {hit.archived && <span className={styles.archivedTag}>{t("search.archived")}</span>}
          {date && kind !== "stockCount" && <span>{date}</span>}
        </span>
      )}
    </>
  );
}
