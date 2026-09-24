"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, PAPER_TYPES } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { CheckboxField, SelectField, TextField } from "@repo/ui/field";
import { TableSkeleton } from "@repo/ui/skeleton";
import { DataTable, type Column, type DataTableState } from "@repo/ui/data-table";
// Type-only import, the same rule as `AppRouter`: the list vocabulary lives
// server-side and must never be pulled into the browser bundle.
import type { RollFacet, RollSortKey } from "api/src/stock/stock.list";
import { useToast } from "@repo/ui/toast";
import { useTRPC } from "../trpc/client";
import styles from "../records/records.module.css";
import stock from "./stock.module.css";

/**
 * The facet chip plus the four advanced dimensions.
 *
 * The chips stay a partition — their counts sum to "all" — and these narrow
 * whatever the chips selected, the same relationship the audit module has
 * between its facets and its prefilters. Keys and scalars only; the server
 * turns them into the AND-ed scope (`splitRollFilter`).
 */
interface RollsTableState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: RollSortKey;
  filter: "all" | RollFacet;
  grammage?: number | "unknown";
  laizeMin?: number;
  laizeMax?: number;
  laizeUnknown?: boolean;
  paperType?: (typeof PAPER_TYPES)[number] | "unknown";
  supplierId?: string;
}

const INITIAL_STATE: RollsTableState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  sortBy: "paperGrade",
  sortDir: "asc",
  filter: "all",
};

/** How many of the four dimensions are narrowing the list right now. */
function activeFilterCount(state: RollsTableState): number {
  return (
    (state.grammage !== undefined ? 1 : 0) +
    (state.laizeUnknown || state.laizeMin !== undefined || state.laizeMax !== undefined ? 1 : 0) +
    (state.paperType !== undefined ? 1 : 0) +
    (state.supplierId !== undefined ? 1 : 0)
  );
}

const kg = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const int = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const tonnes = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

/** A header figure: the count or weight, its unit, and an optional tone. */
function Kpi({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: string;
}) {
  return (
    <div className={stock.kpi}>
      <div className={stock.kpiLabel}>{label}</div>
      <div className={stock.kpiFigure}>
        <span className={[stock.kpiValue, tone].filter(Boolean).join(" ")}>{value}</span>
        {unit && <span className={stock.kpiUnit}>{unit}</span>}
      </div>
    </div>
  );
}

/**
 * Remaining against received, with the proportion drawn.
 *
 * `received` is nullable on 159 migrated reels, and a bar needs a
 * denominator: with no received weight there is no proportion to draw, so the
 * figure stands alone rather than implying a full reel.
 */
function RemainingCell({ remaining, received }: { remaining: number; received: number | null }) {
  const pct =
    received === null || received <= 0
      ? null
      : Math.max(0, Math.min(100, Math.round((remaining / received) * 100)));

  const tone =
    pct === null ? null : pct >= 100 ? stock.pctFull : pct === 0 ? stock.pctEmpty : stock.pctPart;
  const fill =
    pct === null
      ? null
      : pct >= 100
        ? stock.barFillFull
        : pct === 0
          ? stock.barFillEmpty
          : null;

  return (
    <div className={stock.remainingCell}>
      <div className={stock.remainingFigures}>
        <span className={stock.remainingValue}>{kg.format(remaining)}</span>
        {received !== null && (
          <span className={stock.remainingOf}>/ {kg.format(received)} kg</span>
        )}
        {pct !== null && (
          <span className={[stock.remainingPct, tone].filter(Boolean).join(" ")}>{pct}%</span>
        )}
      </div>
      {pct !== null && (
        <span className={stock.bar}>
          <span
            className={[stock.barFill, fill].filter(Boolean).join(" ")}
            style={{ width: `${pct}%` }}
          />
        </span>
      )}
    </div>
  );
}

/**
 * Grammage, width, paper type and supplier — combinable, and each with an
 * explicit "unknown" answer rather than silently dropping the rows that have
 * no value: 160 reels have no grammage, 6 no paper type and 159 no shipment
 * at all, so hiding nulls would hide a tenth of the stock.
 *
 * Width is a min/max pair, not a select: its 71 distinct values are a long
 * tail of singletons, so a dropdown would be unusable. Its "unknown" is a
 * separate checkbox, since a range and a null test are different questions.
 *
 * Every change resets the page — the rule `DataTable` states for search,
 * sort and filter applies to these too, or page 7 of an unfiltered list
 * becomes an empty page 7 of a filtered one.
 */
function AdvancedFilter({
  state,
  onChange,
}: {
  state: RollsTableState;
  onChange: (next: Partial<RollsTableState>) => void;
}) {
  const t = useTranslations("stock");
  const enums = useTranslations("enums");
  const trpc = useTRPC();
  const optionsQuery = useQuery(trpc.stock.supplierOptions.queryOptions());

  const active = activeFilterCount(state);
  const set = (next: Partial<RollsTableState>) => onChange({ ...next, page: 1 });
  const num = (raw: string) => {
    const parsed = Number(raw.replace(",", "."));
    return raw.trim() === "" || !Number.isFinite(parsed) ? undefined : parsed;
  };

  return (
    <div className={stock.filterBar}>
      <div className={stock.filterField}>
        <SelectField
          label={t("rolls.advanced.grammage")}
          size="dense"
          placeholder={t("rolls.advanced.any")}
          allowEmpty
          value={state.grammage === undefined ? "" : String(state.grammage)}
          onChange={(e) =>
            set({
              grammage:
                e.target.value === ""
                  ? undefined
                  : e.target.value === "unknown"
                    ? "unknown"
                    : Number(e.target.value),
            })
          }
          options={[
            { value: "unknown", label: t("rolls.advanced.unknown") },
            ...(optionsQuery.data?.grammages ?? []).map((g) => ({
              value: String(g),
              label: `${g} g/m²`,
            })),
          ]}
        />
      </div>

      <div className={stock.filterRange}>
        <span className={stock.filterRangeLabel}>{t("rolls.advanced.width")}</span>
        <div className={stock.filterRangeRow}>
          <TextField
            label={t("rolls.advanced.widthMin")}
            size="dense"
            format="numeric"
            inputMode="numeric"
            value={state.laizeMin === undefined ? "" : String(state.laizeMin)}
            onChange={(e) => set({ laizeMin: num(e.target.value), laizeUnknown: false })}
            disabled={state.laizeUnknown === true}
          />
          <TextField
            label={t("rolls.advanced.widthMax")}
            size="dense"
            format="numeric"
            inputMode="numeric"
            value={state.laizeMax === undefined ? "" : String(state.laizeMax)}
            onChange={(e) => set({ laizeMax: num(e.target.value), laizeUnknown: false })}
            disabled={state.laizeUnknown === true}
          />
        </div>
      </div>

      {/* Its own item in the bar, not part of the range block above: the bar
          aligns to flex-end, so a taller column would pin its own label 75px
          above the labels of the selects beside it. */}
      <CheckboxField
        label={t("rolls.advanced.widthUnknown")}
        checked={state.laizeUnknown === true}
        onChange={(e) =>
          set({
            laizeUnknown: e.target.checked ? true : undefined,
            // A null test and a band are exclusive: keeping a stale range
            // beside the checkbox would suggest both applied.
            ...(e.target.checked ? { laizeMin: undefined, laizeMax: undefined } : {}),
          })
        }
      />

      <div className={stock.filterField}>
        <SelectField
          label={t("rolls.advanced.paperType")}
          size="dense"
          placeholder={t("rolls.advanced.any")}
          allowEmpty
          value={state.paperType ?? ""}
          onChange={(e) =>
            set({
              paperType:
                e.target.value === ""
                  ? undefined
                  : (e.target.value as RollsTableState["paperType"]),
            })
          }
          options={[
            { value: "unknown", label: t("rolls.advanced.unknown") },
            ...PAPER_TYPES.map((type) => ({
              value: type,
              label: enums(`paperType.${type}`),
            })),
          ]}
        />
      </div>

      <div className={stock.filterField}>
        <SelectField
          label={t("rolls.advanced.supplier")}
          size="dense"
          placeholder={t("rolls.advanced.any")}
          allowEmpty
          value={state.supplierId ?? ""}
          onChange={(e) => set({ supplierId: e.target.value === "" ? undefined : e.target.value })}
          disabled={optionsQuery.isPending}
          options={[
            { value: "unknown", label: t("rolls.advanced.unknown") },
            ...(optionsQuery.data?.suppliers ?? []).map((s) => ({
              value: s.id,
              label: s.name,
            })),
          ]}
        />
      </div>

      {active > 0 && (
        <div className={stock.filterTail}>
          <span className={stock.filterCount}>
            {t("rolls.advanced.activeCount", { count: active })}
          </span>
          <Button
            size="dense"
            onClick={() =>
              set({
                grammage: undefined,
                laizeMin: undefined,
                laizeMax: undefined,
                laizeUnknown: undefined,
                paperType: undefined,
                supplierId: undefined,
              })
            }
          >
            {t("rolls.advanced.clear")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function RollsTable() {
  const t = useTranslations("stock");
  const enums = useTranslations("enums");
  const trpc = useTRPC();
  const [tableState, setTableState] = useState<RollsTableState>(INITIAL_STATE);

  const rollsQuery = useQuery({
    ...trpc.stock.listRolls.queryOptions(tableState),
    placeholderData: (prev) => prev,
  });

  type RollRow = NonNullable<typeof rollsQuery.data>["rows"][number];

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) =>
      setTableState((current) => ({ ...current, ...next }) as RollsTableState),
    [],
  );

  const pageCount = rollsQuery.data?.pageCount ?? 1;
  if (!rollsQuery.isFetching && tableState.page > pageCount) {
    setTableState((current) => ({ ...current, page: pageCount }));
  }

  const columns: ReadonlyArray<Column<RollRow>> = [
    {
      key: "numero",
      header: t("rolls.columns.roll"),
      width: "minmax(120px,1fr)",
      cell: (row) => (
        <div
          className={[styles.mono, row.archived ? styles.archivedRow : null]
            .filter(Boolean)
            .join(" ")}
        >
          {/* `numero` is a label, not a key — 17 legacy rolls are called "0". */}
          {row.numero ?? "—"}
          {row.consomme && <span className={styles.archivedTag}>{t("usedTag")}</span>}
        </div>
      ),
    },
    {
      key: "paperGrade",
      header: t("rolls.columns.grade"),
      width: "100px",
      sortKey: "paperGrade",
      cell: (row) => <span className={styles.text}>{row.paperGrade ?? "—"}</span>,
    },
    {
      key: "grammage",
      header: t("rolls.columns.grammage"),
      width: "90px",
      numeric: true,
      sortKey: "grammage",
      cell: (row) =>
        row.grammage === null ? (
          <span className={styles.absent} />
        ) : (
          <span className={styles.date}>{row.grammage} g</span>
        ),
    },
    {
      key: "laize",
      header: t("rolls.columns.width"),
      width: "80px",
      numeric: true,
      sortKey: "laize",
      cell: (row) =>
        row.laize === null ? (
          <span className={styles.absent} />
        ) : (
          <span className={styles.date}>{row.laize} mm</span>
        ),
    },
    {
      key: "paperType",
      header: t("rolls.columns.paper"),
      width: "110px",
      cell: (row) =>
        row.paperType ? (
          <span className={styles.text}>{enums(`paperType.${row.paperType}`)}</span>
        ) : (
          <span className={styles.absent} />
        ),
    },
    {
      key: "poidsRestant",
      header: t("rolls.columns.remaining"),
      width: "220px",
      sortKey: "poidsRestant",
      // Remaining against received, with the proportion drawn: a part-used
      // reel reads at a glance instead of asking the reader to divide.
      cell: (row) => <RemainingCell remaining={row.poidsRestant} received={row.poids} />,
    },
    {
      key: "shipment",
      header: t("rolls.columns.shipment"),
      width: "minmax(110px,1fr)",
      cell: (row) =>
        row.importShipment ? (
          <span className={styles.text}>{row.importShipment.numeroImport}</span>
        ) : (
          <span className={styles.absent} />
        ),
    },
    {
      key: "actions",
      header: "",
      width: "80px",
      cell: (row) => (
        <div className={styles.actions}>
          <Link href={`/stock/${row.id}`}>
            <Button className={styles.actionBtn}>{t("open")}</Button>
          </Link>
        </div>
      ),
    },
  ];

  if (rollsQuery.isPending) return <TableSkeleton />;

  if (rollsQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {rollsQuery.error.message}
      </p>
    );
  }

  const counts = rollsQuery.data.facetCounts;
  // `poidsRestant` summed over the same rows `total` counts — scope, search
  // and the active facet — inside the list's own transaction, so the tonnage
  // never describes a different snapshot than the table beneath it.
  const remainingKg = rollsQuery.data.aggregates?.poidsRestant ?? 0;

  return (
    <>
      <div className={stock.kpis}>
        <Kpi label={t("rolls.kpis.reels")} value={int.format(counts.all)} />
        <Kpi
          label={t("rolls.kpis.weightInStock")}
          value={tonnes.format(remainingKg / 1000)}
          unit={t("rolls.kpis.tonnes")}
        />
        <Kpi
          label={t("rolls.kpis.available")}
          value={int.format(counts.available)}
          unit={counts.available === 1 ? t("rolls.kpis.reelUnit") : t("rolls.kpis.reelsUnit")}
          tone={stock.kpiAvailable}
        />
        <Kpi
          label={t("rolls.kpis.reserved")}
          value={int.format(counts.reserved)}
          unit={counts.reserved === 1 ? t("rolls.kpis.reelUnit") : t("rolls.kpis.reelsUnit")}
          tone={stock.kpiReserved}
        />
        <Kpi
          label={t("rolls.kpis.archived")}
          value={int.format(counts.archived)}
          unit={counts.archived === 1 ? t("rolls.kpis.reelUnit") : t("rolls.kpis.reelsUnit")}
          tone={stock.kpiArchived}
        />
      </div>

      <AdvancedFilter state={tableState} onChange={onStateChange} />

      <div className={stock.listActions}>
        <ExportButton state={tableState} />
      </div>

      <DataTable
      rows={rollsQuery.data.rows}
      columns={columns}
      rowKey={(row) => row.id}
      filters={[
        { key: "available", label: t("rolls.filters.available") },
        { key: "reserved", label: t("rolls.filters.reserved") },
        { key: "pending", label: t("rolls.filters.pending") },
        { key: "consumed", label: t("rolls.filters.consumed") },
        { key: "archived", label: t("rolls.filters.archived") },
      ]}
      facetCounts={rollsQuery.data.facetCounts}
      total={rollsQuery.data.total}
      pageCount={rollsQuery.data.pageCount}
      loading={rollsQuery.isFetching}
      state={tableState}
      onStateChange={onStateChange}
      searchPlaceholder={t("rolls.searchPlaceholder")}
      emptyMessage={t("rolls.emptyMessage")}
      />
    </>
  );
}

/**
 * Downloads the current view as a CSV.
 *
 * The file arrives as a string through tRPC rather than from a raw Express
 * route: tRPC is the whole HTTP surface here, so a second endpoint would mean
 * a second auth path for the same data. The browser then saves it the only
 * way it can — a Blob behind an object URL and a synthetic click. There is no
 * precedent for this in the repo; it is the first download.
 *
 * Fetched on demand (`refetch`), never on mount: a stock take is 1690 rows,
 * and nobody wants that built on every visit to the list.
 */
function ExportButton({ state }: { state: RollsTableState }) {
  const t = useTranslations("stock");
  const trpc = useTRPC();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  const exportQuery = useQuery({
    // The four advanced dimensions ride along, so an export always matches
    // the screen it was taken from rather than silently ignoring the filter.
    ...trpc.stock.exportRolls.queryOptions({
      sortBy: state.sortBy,
      sortDir: state.sortDir,
      filter: state.filter,
      search: state.search,
      grammage: state.grammage,
      laizeMin: state.laizeMin,
      laizeMax: state.laizeMax,
      laizeUnknown: state.laizeUnknown,
      paperType: state.paperType,
      supplierId: state.supplierId,
    }),
    enabled: false,
  });

  const run = async () => {
    setBusy(true);
    try {
      const result = await exportQuery.refetch({ throwOnError: true });
      const data = result.data;
      if (!data) throw new Error("no data");

      // A BOM so Excel reads the UTF-8 reel numbers and accented grades
      // correctly instead of mojibake. Written as an escape: as a literal
      // character it is invisible in a diff, and lint rejects it.
      const blob = new Blob([`\ufeff${data.csv}`], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = data.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      push({ title: t("rolls.export.done", { count: data.rowCount }), tone: "success" });
      if (data.truncated) {
        push({ title: t("rolls.export.truncated", { count: data.rowCount }), tone: "warning" });
      }
    } catch {
      // `error` (not `danger` — `ToastTone` has no such variant) also pins the
      // toast open, per the duration rule in toast.tsx: a failed export is
      // something the user must notice, not a message that fades.
      push({ title: t("rolls.export.failed"), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button size="dense" busy={busy} onClick={() => void run()}>
      {busy ? t("rolls.export.working") : t("rolls.export.button")}
    </Button>
  );
}
