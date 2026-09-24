"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { PAGE_SIZES } from "@repo/api-contract";
import styles from "./components.module.css";
import { EmptyState } from "./empty-state";
import { TableSkeleton } from "./skeleton";
import { useUiStrings } from "./strings";

export interface Column<T> {
  key: string;
  header: string;
  /** CSS grid track, e.g. "88px" or "minmax(240px,1.4fr)". */
  width: string;
  /**
   * Right-aligns the header and the cell, and renders figures with
   * fixed-width (tabular) numerals so columns align on scan.
   */
  numeric?: boolean;
  /**
   * The server-side sort key for this column. A column is sortable if and only
   * if it declares one, and the server rejects any key outside its allowlist —
   * `cell` returns JSX, so there is no scalar to sort on client-side.
   */
  sortKey?: string;
  cell: (row: T) => ReactNode;
}

/** A facet chip. The server owns the predicate; the client only sends the key. */
export interface Filter {
  key: string;
  label: string;
  /** A small glyph before the label, drawn in `currentColor` so it follows the chip's state. */
  icon?: ReactNode;
}

export interface DataTableState {
  /** 1-based, matching the server and what the pager displays. */
  page: number;
  pageSize: number;
  search: string;
  sortBy?: string;
  sortDir: "asc" | "desc";
  filter: string;
}

interface DataTableProps<T> {
  rows: readonly T[];
  columns: ReadonlyArray<Column<T>>;
  rowKey: (row: T) => string;
  /**
   * "All" is prepended automatically. Omit or pass an empty array for a list
   * that is searched rather than filtered — no chip row renders at all, since
   * a lone "All" chip cannot change anything.
   */
  filters?: ReadonlyArray<Filter>;
  /** Server-computed, one per filter key plus "all". */
  facetCounts?: Record<string, number>;
  total: number;
  pageCount: number;
  /** A refetch: dims the current rows in place rather than unmounting them. */
  loading?: boolean;
  /** A first load: draws skeleton rows where the data will land. */
  pending?: boolean;
  state: DataTableState;
  onStateChange: (next: Partial<DataTableState>) => void;
  /**
   * Makes every row a click (and Enter/Space) target — for a list whose rows
   * open a detail panel rather than carrying buttons. Rows stay plain
   * `<div>`s otherwise, so a table that only lists has nothing focusable.
   */
  onRowClick?: (row: T) => void;
  /** The row to draw as selected, by `rowKey`. Only meaningful with `onRowClick`. */
  selectedKey?: string | null;
  /**
   * Touch (56px rows, 40px controls) is the default. Dense (40px rows, 32px
   * controls) is for desktop lists driven by a mouse.
   */
  density?: "touch" | "dense";
  /**
   * Under 900px each row becomes a card with its column names inline, since
   * a sideways-scrolling table is unusable with a glove on. Off only for a
   * table whose columns are meaningless stacked, e.g. a pure figures grid.
   */
  cards?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchDebounceMs?: number;
  emptyMessage?: string;
  /** A second line under `emptyMessage`: what to do about it. */
  emptyText?: string;
  /** Rendered inside the empty state, e.g. a "Clear filter" button. */
  emptyActions?: ReactNode;
  /**
   * Replaces the row grid with the caller's own rendering of the page — a
   * card grid, say — while the toolbar, skeleton, empty state and pager stay
   * exactly as they are. `columns` is then only read for nothing; pass `[]`.
   */
  renderBody?: (rows: readonly T[]) => ReactNode;
  /**
   * With `renderBody`: draws the caller's rendering edge to edge on the
   * panel, for a list of full-width rows with their own separators, rather
   * than inset on a tinted ground as a card grid is.
   */
  flush?: boolean;
  /**
   * Extra controls in the toolbar, between the chips and the search box —
   * a date window, say. The caller owns their state as it does the rest.
   */
  toolbar?: ReactNode;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  filters = [],
  facetCounts,
  total,
  pageCount,
  loading = false,
  pending = false,
  state,
  onStateChange,
  onRowClick,
  selectedKey = null,
  density = "touch",
  cards = true,
  searchable = true,
  searchPlaceholder,
  searchDebounceMs = 300,
  emptyMessage,
  emptyText,
  emptyActions,
  renderBody,
  flush = false,
  toolbar,
}: DataTableProps<T>) {
  const ui = useUiStrings();
  const searchLabel = searchPlaceholder ?? ui.search;
  const emptyLabel = emptyMessage ?? ui.nothingMatches;
  // The input is owned locally so typing stays instant, while the query only
  // learns about it once the debounce settles. `search` and the page reset go
  // up in a single update: applying them separately would render once with the
  // new page and the old term, costing an extra request.
  const [searchDraft, setSearchDraft] = useState(state.search);
  const lastEmitted = useRef(state.search);

  // The caller may reset `search` itself — a "clear everything" action in
  // the empty state — and the box must follow, or it keeps showing a term
  // the list no longer applies. Only an external change is adopted: one the
  // debounce just emitted is already the draft.
  useEffect(() => {
    if (state.search === lastEmitted.current) return;
    lastEmitted.current = state.search;
    setSearchDraft(state.search);
  }, [state.search]);

  useEffect(() => {
    if (searchDraft === lastEmitted.current) return;
    const id = setTimeout(() => {
      lastEmitted.current = searchDraft;
      onStateChange({ search: searchDraft, page: 1 });
    }, searchDebounceMs);
    return () => clearTimeout(id);
  }, [searchDraft, searchDebounceMs, onStateChange]);

  // The grid template is shared by the header and every row so the
  // columns line up without a <table>.
  const gridStyle = {
    "--bp-table-cols": columns.map((c) => c.width).join(" "),
  } as CSSProperties;

  const start = rows.length === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const end = start === 0 ? 0 : start + rows.length - 1;

  // Every caller's state carries a PAGE_SIZES value, but a caller that opens
  // on something else would otherwise render the picker blank; folding the
  // current size in keeps it truthful about what the list is doing.
  const sizeOptions = [...new Set([...PAGE_SIZES, state.pageSize])].sort((a, b) => a - b);

  const chipClasses = (key: string) =>
    [styles.filterChip, state.filter === key ? styles.filterChipActive : null]
      .filter(Boolean)
      .join(" ");

  // Facet and sort changes are not debounced, so they reset the page directly.
  const selectFilter = (key: string) => onStateChange({ filter: key, page: 1 });

  const toggleSort = (sortKey: string) =>
    onStateChange({
      sortBy: sortKey,
      sortDir:
        state.sortBy === sortKey && state.sortDir === "asc" ? "desc" : "asc",
      page: 1,
    });

  const tableClasses = [
    styles.table,
    density === "dense" ? styles.tableDense : null,
    cards ? styles.tableCards : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={tableClasses}>
      <div className={styles.tableToolbar}>
        {/*
          No chips at all when the caller declares no filters: a lone "All"
          chip is a control that cannot change anything, and the count it
          would show duplicates the pager's. A filterless list is a real case
          — reels under one shipment are a fixed set, searched not filtered.
        */}
        {filters.length > 0 && (
          <div className={styles.tableFilters}>
            <button
              type="button"
              className={chipClasses("all")}
              aria-pressed={state.filter === "all"}
              onClick={() => selectFilter("all")}
            >
              {ui.all}{" "}
              <span className={styles.filterChipCount}>
                {facetCounts?.all ?? total}
              </span>
            </button>
            {filters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                className={chipClasses(filter.key)}
                aria-pressed={state.filter === filter.key}
                onClick={() => selectFilter(filter.key)}
              >
                {filter.icon !== undefined && (
                  <span className={styles.filterChipIcon} aria-hidden="true">
                    {filter.icon}
                  </span>
                )}
                {filter.label}{" "}
                <span className={styles.filterChipCount}>
                  {facetCounts?.[filter.key] ?? 0}
                </span>
              </button>
            ))}
          </div>
        )}
        {toolbar !== undefined && (
          <div className={styles.tableToolbarExtra}>{toolbar}</div>
        )}
        {searchable && (
          <input
            type="search"
            className={styles.tableSearch}
            placeholder={searchLabel}
            aria-label={searchLabel}
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
          />
        )}
      </div>

      {pending ? (
        <TableSkeleton />
      ) : renderBody ? (
        <div
          className={[
            styles.customBody,
            flush ? styles.customBodyFlush : null,
            loading ? styles.tableBodyLoading : null,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {rows.length === 0 ? (
            <EmptyState title={emptyLabel} text={emptyText} actions={emptyActions} />
          ) : (
            renderBody(rows)
          )}
        </div>
      ) : (
        <div className={styles.tableScroll}>
          <div className={styles.tableGrid} role="table">
            <div className={styles.tableHead} style={gridStyle} role="row">
              {columns.map((column) => {
                const sortKey = column.sortKey;
                const active =
                  sortKey !== undefined && state.sortBy === sortKey;
                return (
                  <div
                    key={column.key}
                    role="columnheader"
                    aria-sort={
                      sortKey === undefined
                        ? undefined
                        : active
                          ? state.sortDir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                    }
                    className={[
                      styles.th,
                      column.numeric ? styles.thNumeric : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {sortKey !== undefined ? (
                      <button
                        type="button"
                        className={styles.thButton}
                        onClick={() => toggleSort(sortKey)}
                      >
                        {column.header}
                        <span
                          aria-hidden="true"
                          className={[
                            styles.thSort,
                            active ? styles.thSortActive : null,
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {active ? (state.sortDir === "asc" ? "↑" : "↓") : "↕"}
                        </span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </div>
                );
              })}
            </div>

            <div
              role="rowgroup"
              className={loading ? styles.tableBodyLoading : undefined}
            >
              {rows.map((row) => {
                const key = rowKey(row);
                const selected =
                  onRowClick !== undefined && key === selectedKey;
                return (
                  <div
                    key={key}
                    role="row"
                    aria-selected={onRowClick ? selected : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    className={[
                      styles.tableRow,
                      onRowClick ? styles.tableRowClickable : null,
                      selected ? styles.tableRowSelected : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={gridStyle}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={
                      onRowClick
                        ? (event) => {
                            // Only the row itself: a control inside a cell
                            // keeps its own keyboard behaviour.
                            if (event.target !== event.currentTarget) return;
                            if (event.key !== "Enter" && event.key !== " ")
                              return;
                            event.preventDefault();
                            onRowClick(row);
                          }
                        : undefined
                    }
                  >
                    {columns.map((column, index) => (
                      <div
                        key={column.key}
                        role="cell"
                        className={[
                          styles.td,
                          index === 0 ? styles.tdPrimary : null,
                          column.numeric ? styles.tdNumeric : null,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {/* The column name, shown only once the row is a card. */}
                        {column.header && index > 0 && (
                          <span className={styles.tdLabel} aria-hidden="true">
                            {column.header}
                          </span>
                        )}
                        {column.cell(row)}
                      </div>
                    ))}
                  </div>
                );
              })}

              {rows.length === 0 && (
                <div role="row">
                  <div role="cell" className={styles.tableEmpty}>
                    <EmptyState title={emptyLabel} text={emptyText} actions={emptyActions} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={styles.tableFooter}>
        <div className={styles.tableFooterStart}>
          <span className={styles.tableCount}>
            {total === 0 ? ui.zeroOfZero : ui.rangeOf(start, end, total)}
          </span>
          {/*
            How many rows a page holds. The server validates it against the
            same closed set (`listQueryBase.pageSize` is a PAGE_SIZES
            literal), so this cannot ask for an unbounded page — which is
            why the options come from the contract rather than a prop.
          */}
          <label className={styles.pageSize}>
            <span className={styles.pageSizeLabel}>{ui.perPage}</span>
            <select
              className={styles.pageSizeSelect}
              value={state.pageSize}
              onChange={(e) =>
                // A bigger page renumbers every page, so the row that was on
                // page 3 is not there any more: back to the first, as for a
                // search or a filter change.
                onStateChange({ pageSize: Number(e.target.value), page: 1 })
              }
            >
              {sizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.tablePager}>
          <button
            type="button"
            className={styles.pagerBtn}
            disabled={state.page <= 1}
            onClick={() => onStateChange({ page: state.page - 1 })}
          >
            {ui.prev}
          </button>
          <button
            type="button"
            className={styles.pagerBtn}
            disabled={state.page >= pageCount}
            onClick={() => onStateChange({ page: state.page + 1 })}
          >
            {ui.next}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Primary identifier in a row — mono, accent-colored (one per table). */
export function CellId({ children }: { children: ReactNode }) {
  return <span className={styles.tdJob}>{children}</span>;
}

/** Two-line cell: a bold primary line over a muted secondary line. */
export function CellStacked({
  primary,
  secondary,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <>
      <div className={styles.tdCustomer}>{primary}</div>
      {secondary != null && <div className={styles.tdSpec}>{secondary}</div>}
    </>
  );
}

/** Emphasized figure, for the one quantity that matters most in a row. */
export function CellFigure({ children }: { children: ReactNode }) {
  return <span className={styles.tdQty}>{children}</span>;
}

/** A date that turns danger-red when overdue. */
export function CellDate({
  children,
  overdue = false,
}: {
  children: ReactNode;
  overdue?: boolean;
}) {
  return (
    <span className={overdue ? styles.tdDueLate : styles.tdDue}>
      {children}
    </span>
  );
}
