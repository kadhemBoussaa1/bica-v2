"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import {
  assetUrl,
  canAccess,
  DEFAULT_PAGE_SIZE,
  MACHINE_TYPES,
  PAGE_SIZES,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { TableSkeleton } from "@repo/ui/skeleton";
import { DataTable, type Column, type DataTableState } from "@repo/ui/data-table";
import { Dialog } from "@repo/ui/dialog";
import { Thumbnail } from "@repo/ui/thumbnail";
import { useCurrentUser } from "../auth/use-auth";
import { useTRPC } from "../trpc/client";
import styles from "../records/records.module.css";
import grid from "./machines.module.css";

interface MachinesTableState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: "name" | "code" | "type" | "purchaseDate" | "createdAt";
  filter: "all" | (typeof MACHINE_TYPES)[number] | "archived";
}

const INITIAL_STATE: MachinesTableState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  sortBy: "name",
  sortDir: "asc",
  filter: "all",
};

/**
 * Card or row, from "Machines v3.dc.html" — the handoff offers both and lets
 * the user choose, as the products list now does. Cards lead with the
 * machine's photo (20 of the 22 carry one) and draw its capability ranges as
 * span bars; rows are what you want when comparing ranges down a column.
 */
type MachineView = "grid" | "list";

/** The switch's two buttons, with the handoff's own icon paths. */
const VIEWS: readonly { key: MachineView; icon: string }[] = [
  { key: "grid", icon: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z" },
  { key: "list", icon: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01" },
];

const int = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/**
 * The scales the span bars are drawn against. Fixed rather than derived from
 * the page, so a bar means the same thing on every card and between pages —
 * a bar that rescaled with whatever happened to be listed would make two
 * machines look comparable when they are not.
 *
 * Both are taken from the widest recorded capability with headroom: the
 * widest web is 1 630 mm and the heaviest grammage 160 g/m².
 */
const WIDTH_MAX = 1800;
const GSM_MAX = 200;

/** A header figure: the count, its unit, and an optional tone. */
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
    <div className={grid.kpi}>
      <div className={grid.kpiLabel}>{label}</div>
      <div className={grid.kpiFigure}>
        <span className={[grid.kpiValue, tone].filter(Boolean).join(" ")}>{value}</span>
        {unit && <span className={grid.kpiUnit}>{unit}</span>}
      </div>
    </div>
  );
}

/** Renders a capability range as "60 – 160", or a single bound, or nothing. */
function Range({ min, max }: { min: number | null; max: number | null }) {
  if (min === null && max === null) return <span className={styles.absent} />;
  if (min !== null && max !== null) {
    return <span className={styles.date}>{min} – {max}</span>;
  }
  return <span className={styles.date}>{min ?? max}</span>;
}

/**
 * One capability as a span bar: the label, the figure, and a bar that starts
 * at the lower bound and ends at the upper one against a fixed scale.
 *
 * `min`/`max` are both nullable and often partly recorded — 15 of 22
 * machines state a single rated width and only 6 a range — so a lone bound
 * draws a short mark at its own position rather than pretending to a span.
 * With nothing recorded the track stays empty: a full bar would read as
 * "handles everything", which is the opposite of what a missing range means.
 */
function RangeBar({
  label,
  min,
  max,
  unit,
  max_,
  tone,
  unsetLabel,
}: {
  label: string;
  min: number | null;
  max: number | null;
  unit: string;
  max_: number;
  tone: string | undefined;
  unsetLabel: string;
}) {
  const lo = min ?? max;
  const hi = max ?? min;
  const pct = (v: number) => Math.max(0, Math.min(100, (v / max_) * 100));

  return (
    <span style={{ display: "block" }}>
      <span className={grid.rangeHead}>
        <span className={grid.rangeLabel}>{label}</span>
        <span
          className={[grid.rangeValue, lo === null ? grid.rangeUnset : null]
            .filter(Boolean)
            .join(" ")}
        >
          {lo === null ? (
            unsetLabel
          ) : (
            <>
              {lo === hi ? int.format(lo) : `${int.format(lo)} – ${int.format(hi ?? lo)}`}{" "}
              <span className={grid.rangeUnit}>{unit}</span>
            </>
          )}
        </span>
      </span>
      <span className={grid.rangeTrack}>
        {lo !== null && (
          <span
            className={[grid.rangeSpan, tone].filter(Boolean).join(" ")}
            style={{
              insetInlineStart: `${pct(lo)}%`,
              // A single value would otherwise be a zero-width span and draw
              // nothing, so it keeps a 2% minimum mark.
              insetInlineEnd: `${Math.max(0, 100 - Math.max(pct(hi ?? lo), pct(lo) + 2))}%`,
            }}
          />
        )}
      </span>
    </span>
  );
}

export function MachinesTable() {
  const t = useTranslations("machines");
  const common = useTranslations("common");
  const enums = useTranslations("enums");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { user: me } = useCurrentUser();
  const canWrite = me ? canAccess(me.role, "ADMIN") : false;
  const [error, setError] = useState<string | null>(null);
  const [tableState, setTableState] = useState<MachinesTableState>(INITIAL_STATE);

  const machinesQuery = useQuery({
    ...trpc.machine.list.queryOptions(tableState),
    placeholderData: (prev) => prev,
  });

  // `machine.list` answers ADMIN with the full record and the floor with a
  // picker-sized row (`MACHINE_SELECT_FLOOR`). This page is ADMIN-only, so
  // it keeps the full shape; the guard makes TypeScript agree.
  type AnyMachineRow = NonNullable<typeof machinesQuery.data>["rows"][number];
  type MachineRow = Extract<AnyMachineRow, { price: unknown }>;
  const isFullRecord = (row: AnyMachineRow): row is MachineRow => "price" in row;
  // Widened to one array type first: `rows` is `A[] | B[]`, on which
  // `filter` loses the type-guard overload.
  const fullRecords = (rows: readonly AnyMachineRow[]) => rows.filter(isFullRecord);

  const [pending, setPending] = useState<MachineRow | null>(null);
  // Cards by default, as the products list does: 20 of the 22 machines carry
  // a photo, and a photo is how someone on the floor knows which machine.
  const [view, setView] = useState<MachineView>("grid");

  const setActive = useMutation(
    trpc.machine.setActive.mutationOptions({
      onSuccess: () => {
        setPending(null);
        return queryClient.invalidateQueries({ queryKey: trpc.machine.list.queryKey() });
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) =>
      setTableState((current) => ({ ...current, ...next }) as MachinesTableState),
    [],
  );

  const pageCount = machinesQuery.data?.pageCount ?? 1;
  if (!machinesQuery.isFetching && tableState.page > pageCount) {
    setTableState((current) => ({ ...current, page: pageCount }));
  }

  const columns: ReadonlyArray<Column<MachineRow>> = [
    {
      // The same photo the cards lead with, so switching views does not lose
      // the one thing that identifies a machine on sight. Decorative: the
      // name is in the very next column, so alt text would only repeat it.
      key: "image",
      header: "",
      width: "60px",
      cell: (row) => <Thumbnail size="sm" src={assetUrl(row.imageUrl)} />,
    },
    {
      key: "name",
      header: t("columns.machine"),
      width: "minmax(190px,1.6fr)",
      sortKey: "name",
      cell: (row) => (
        <div
          className={[styles.name, row.active ? null : styles.archivedRow]
            .filter(Boolean)
            .join(" ")}
        >
          {row.name}
          {!row.active && <span className={styles.archivedTag}>{t("archivedTag")}</span>}
        </div>
      ),
    },
    {
      key: "code",
      header: t("columns.code"),
      width: "110px",
      sortKey: "code",
      cell: (row) => <span className={styles.mono}>{row.code}</span>,
    },
    {
      key: "type",
      header: t("columns.type"),
      width: "150px",
      sortKey: "type",
      cell: (row) => <span className={styles.text}>{enums(`machineType.${row.type}`)}</span>,
    },
    {
      key: "laize",
      header: t("columns.laize"),
      width: "110px",
      numeric: true,
      cell: (row) =>
        row.laize !== null ? (
          <span className={styles.date}>{row.laize}</span>
        ) : (
          <Range min={row.laizeMin} max={row.laizeMax} />
        ),
    },
    {
      key: "grammage",
      header: t("columns.grammage"),
      width: "115px",
      numeric: true,
      // A machine states either one rated grammage or a range, and bag machines
      // state the without-handle range instead. Show whichever exists.
      cell: (row) => {
        if (row.grammage !== null) return <span className={styles.date}>{row.grammage}</span>;
        if (row.grammageMin !== null || row.grammageMax !== null) {
          return <Range min={row.grammageMin} max={row.grammageMax} />;
        }
        return (
          <Range
            min={row.grammageMinWithoutHandle}
            max={row.grammageMaxWithoutHandle}
          />
        );
      },
    },
    {
      key: "supplier",
      header: t("columns.supplier"),
      width: "minmax(130px,1fr)",
      cell: (row) =>
        row.supplier ? (
          <span className={styles.text}>{row.supplier.name}</span>
        ) : (
          <span className={styles.absent} />
        ),
    },
    ...(canWrite
      ? [
          {
            key: "actions",
            header: "",
            width: "150px",
            cell: (row: MachineRow) => (
              <div className={styles.actions}>
                <Link href={`/machines/${row.id}`}>
                  <Button className={styles.actionBtn}>{common("edit")}</Button>
                </Link>
                <Button
                  variant={row.active ? "danger" : "secondary"}
                  className={styles.actionBtn}
                  onClick={() => {
                    setError(null);
                    setPending(row);
                  }}
                >
                  {row.active ? common("archive") : common("restore")}
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  if (machinesQuery.isPending) return <TableSkeleton />;

  if (machinesQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {machinesQuery.error.message}
      </p>
    );
  }

  const counts = machinesQuery.data.facetCounts;

  /*
   * The grammage a card shows, following the same fallback chain the table's
   * grammage column already uses: a single rated value, else the plain
   * range, else the without-handle range. One rule, stated once — inventing
   * a second here would let a card and its row disagree.
   */
  const gsmRange = (row: MachineRow): { min: number | null; max: number | null } => {
    if (row.grammage !== null) return { min: row.grammage, max: row.grammage };
    if (row.grammageMin !== null || row.grammageMax !== null) {
      return { min: row.grammageMin, max: row.grammageMax };
    }
    return { min: row.grammageMinWithoutHandle, max: row.grammageMaxWithoutHandle };
  };

  /** The same chain for width: a rated `laize`, else the min/max pair. */
  const widthRange = (row: MachineRow): { min: number | null; max: number | null } =>
    row.laize !== null ? { min: row.laize, max: row.laize } : { min: row.laizeMin, max: row.laizeMax };

  const initials = (name: string) =>
    name
      .replace(/[^\p{L}\p{N} -]/gu, " ")
      .trim()
      .split(/[\s-]+/)
      .filter(Boolean)[0]
      ?.slice(0, 2)
      .toUpperCase() ?? "??";

  const MachineCard = ({ row }: { row: MachineRow }) => {
    const image = assetUrl(row.imageUrl);
    const width = widthRange(row);
    const gsm = gsmRange(row);
    return (
      <article className={grid.card}>
        <Link href={`/machines/${row.id}`} className={grid.cardMedia}>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" loading="lazy" />
          ) : (
            <span className={grid.cardMediaEmpty} aria-hidden="true">
              {initials(row.name)}
            </span>
          )}
          <span
            className={[grid.cardType, styles.statusBadge, styles.statusNeutral]
              .filter(Boolean)
              .join(" ")}
          >
            {enums(`machineType.${row.type}`)}
          </span>
        </Link>

        <div className={grid.cardBody}>
          <div>
            <div className={grid.cardName}>
              {row.name}
              {!row.active && <span className={styles.archivedTag}>{t("archivedTag")}</span>}
            </div>
            <div className={grid.cardMeta}>
              <span className={grid.cardCode}>{row.code}</span>
              {row.supplier && <span className={grid.cardSupplier}>{row.supplier.name}</span>}
            </div>
          </div>

          <div className={grid.ranges}>
            <RangeBar
              label={t("columns.laize")}
              min={width.min}
              max={width.max}
              unit="mm"
              max_={WIDTH_MAX}
              tone={grid.rangeSpanWidth}
              unsetLabel={t("cards.notSet")}
            />
            <RangeBar
              label={t("columns.grammage")}
              min={gsm.min}
              max={gsm.max}
              unit="g/m²"
              max_={GSM_MAX}
              tone={grid.rangeSpanGsm}
              unsetLabel={t("cards.notSet")}
            />
          </div>

          {canWrite && (
            <div className={grid.cardFoot}>
              <span className={grid.cardActions}>
                <Link href={`/machines/${row.id}`}>
                  <Button size="dense">{common("edit")}</Button>
                </Link>
                <Button
                  size="dense"
                  variant={row.active ? "danger" : "secondary"}
                  onClick={() => {
                    setError(null);
                    setPending(row);
                  }}
                >
                  {row.active ? common("archive") : common("restore")}
                </Button>
              </span>
            </div>
          )}
        </div>
      </article>
    );
  };

  return (
    <>
      {error && (
        <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      <div className={grid.kpis}>
        <Kpi label={t("kpis.machines")} value={int.format(counts.all)} unit={t("kpis.onFloor")} />
        <Kpi
          label={enums("machineType.SAC_V")}
          value={int.format(counts.SAC_V)}
          unit={t("kpis.machinesUnit")}
        />
        <Kpi
          label={enums("machineType.CORDON")}
          value={int.format(counts.CORDON)}
          unit={t("kpis.machinesUnit")}
        />
        <Kpi
          label={t("kpis.archived")}
          value={int.format(counts.archived)}
          unit={t("kpis.machinesUnit")}
          tone={grid.kpiWidth}
        />
      </div>

      {/* Card or row — the handoff's own switch. */}
      <div className={grid.viewBar}>
        <div className={grid.viewSwitch} role="group" aria-label={t("view.label")}>
          {VIEWS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={[grid.viewBtn, view === entry.key ? grid.viewBtnOn : null]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setView(entry.key)}
              aria-pressed={view === entry.key}
              aria-label={t(`view.${entry.key}`)}
              title={t(`view.${entry.key}`)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                width="17"
                height="17"
                aria-hidden="true"
              >
                <path d={entry.icon} />
              </svg>
            </button>
          ))}
        </div>
      </div>

      {/*
        One `DataTable` for both views: `renderBody` swaps the row grid for
        the card grid while the toolbar, facet chips, search, skeleton, empty
        state and pager stay exactly as they are.
      */}
      <DataTable
        rows={fullRecords(machinesQuery.data.rows)}
        columns={view === "grid" ? [] : columns}
        renderBody={
          view === "grid"
            ? (cardRows) => (
                <div className={grid.grid}>
                  {cardRows.map((row) => (
                    <MachineCard key={row.id} row={row} />
                  ))}
                </div>
              )
            : undefined
        }
        rowKey={(row) => row.id}
        filters={[
          ...MACHINE_TYPES.map((type) => ({ key: type, label: enums(`machineType.${type}`) })),
          { key: "archived", label: t("filters.archived") },
        ]}
        facetCounts={machinesQuery.data.facetCounts}
        total={machinesQuery.data.total}
        pageCount={machinesQuery.data.pageCount}
        loading={machinesQuery.isFetching}
        state={tableState}
        onStateChange={onStateChange}
        searchPlaceholder={t("searchPlaceholder")}
        emptyMessage={t("emptyMessage")}
      />

      <Dialog
        open={pending !== null}
        title={pending?.active ? t("archiveTitle") : t("restoreTitle")}
        confirmLabel={pending?.active ? common("archive") : common("restore")}
        destructive={pending?.active ?? false}
        busy={setActive.isPending}
        onConfirm={() =>
          pending && setActive.mutate({ id: pending.id, active: !pending.active })
        }
        onClose={() => !setActive.isPending && setPending(null)}
      >
        {pending?.active
          ? t.rich("archiveBody", {
              name: pending.name,
              strong: (chunks) => <strong>{chunks}</strong>,
            })
          : t.rich("restoreBody", {
              name: pending?.name ?? "",
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
      </Dialog>
    </>
  );
}
