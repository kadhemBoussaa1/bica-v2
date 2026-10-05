"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { assetUrl, DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@repo/api-contract";
import { DataTable, type DataTableState } from "@repo/ui/data-table";
import { TableSkeleton } from "@repo/ui/skeleton";
import { Thumbnail } from "@repo/ui/thumbnail";
import type {
  ManufacturingOrderFacet,
  ManufacturingOrderSortKey,
} from "api/src/manufacturing/manufacturing.list";
import { Avatar } from "../employees/avatar";
import { employeeName } from "../employees/employee-name";
import shell from "../records/banded-list.module.css";
import records from "../records/records.module.css";
import { SegmentedFilter } from "../records/segmented-filter";
import { useTRPC } from "../trpc/client";
import { formatDay, ORDER_TONE } from "./manufacturing-ui";
import styles from "./manufacturing.module.css";

interface ManufacturingOrdersTableState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: ManufacturingOrderSortKey;
  filter: "all" | ManufacturingOrderFacet;
}

const INITIAL_STATE: ManufacturingOrdersTableState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  sortBy: "createdAt",
  sortDir: "desc",
  filter: "all",
};

const FACETS: readonly ("all" | ManufacturingOrderFacet)[] = [
  "all",
  "draft",
  "inProgress",
  "done",
  "cancelled",
];

/**
 * Every OF, one per order: who it is for, how far its pipeline has got —
 * one segment per action — and what is being worked right now, by whom. A
 * row opens the OF's own page.
 */
export function ManufacturingOrdersTable({ initialSearch = "" }: { initialSearch?: string }) {
  const t = useTranslations("manufacturing");
  const enums = useTranslations("enums");
  const trpc = useTRPC();
  const [tableState, setTableState] = useState<ManufacturingOrdersTableState>({
    ...INITIAL_STATE,
    search: initialSearch,
  });

  const listQuery = useQuery({
    ...trpc.manufacturing.list.queryOptions(tableState),
    placeholderData: (prev) => prev,
  });

  type Row = NonNullable<typeof listQuery.data>["rows"][number];

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) =>
      setTableState((current) => ({ ...current, ...next }) as ManufacturingOrdersTableState),
    [],
  );

  const pageCount = listQuery.data?.pageCount ?? 1;
  if (!listQuery.isFetching && tableState.page > pageCount) {
    setTableState((current) => ({ ...current, page: pageCount }));
  }

  /** What is happening on the OF right now, as a title and a line under it. */
  const now = (row: Row): { title: string; meta: ReactNode; live: boolean; alert: boolean } => {
    const current = row.currentAction;
    if (row.status === "CANCELLED") {
      return { title: t("row.cancelled"), meta: null, live: false, alert: false };
    }
    if (row.status === "DONE") {
      return {
        title: t("row.done"),
        meta: row.finishedAt ? t("row.doneOn", { date: formatDay(row.finishedAt) }) : null,
        live: false,
        alert: false,
      };
    }
    if (!current || row.status === "DRAFT") {
      return { title: t("row.notStarted"), meta: null, live: false, alert: false };
    }
    if (row.staleDays !== null) {
      return {
        title: current.label,
        meta: t("row.stale", { days: row.staleDays }),
        live: true,
        alert: true,
      };
    }
    return {
      title: current.label,
      // `<bdi>` per part: in Arabic a Latin name would otherwise land on
      // the far side of the separator.
      meta: (
        <>
          <bdi>{current.assignee ? employeeName(current.assignee) : t("row.nobody")}</bdi>
          {current.startedAt && (
            <>
              {" · "}
              <bdi>{t("row.since", { date: formatDay(current.startedAt) })}</bdi>
            </>
          )}
        </>
      ),
      live: true,
      alert: false,
    };
  };

  const row = (of: Row): ReactNode => {
    const state = now(of);
    const assignee = state.live ? of.currentAction?.assignee : null;
    return (
      <Link
        key={of.id}
        href={`/manufacturing-orders/${of.id}`}
        className={[shell.row, ORDER_TONE[of.status]].filter(Boolean).join(" ")}
      >
        <span className={shell.main}>
          {/* The order's photo — its product's first image — so an OF is
              recognised on sight. Decorative: the number sits beside it. */}
          <Thumbnail size="sm" src={assetUrl(of.order.product.images[0] ?? null)} />
          <span className={shell.mainText}>
            <span className={shell.head}>
              <span className={shell.no}>{of.numero}</span>
              <span className={shell.pill}>
                <i className={shell.pillDot} aria-hidden />
                {enums(`manufacturingOrderStatus.${of.status}`)}
              </span>
            </span>
            <span className={shell.sub}>
              <span className={shell.subStrong}>{of.order.client?.name ?? "—"}</span>{" "}
              <span className={shell.subMuted}>· {of.order.product.name}</span>
            </span>
            <span className={shell.meta}>
              <bdi>{of.order.numero}</bdi>
              {of.legacyNumero && (
                <>
                  {" · "}
                  <bdi>{t("row.ex", { numero: of.legacyNumero })}</bdi>
                </>
              )}
            </span>
          </span>
        </span>

        <span className={[styles.colPipeline, shell.col].filter(Boolean).join(" ")}>
          <span className={styles.strip}>
            {of.segments.map((segment, index) => (
              <span
                key={index}
                className={[styles.seg, styles[`seg_${segment.status}`]].filter(Boolean).join(" ")}
                title={t("row.segment", {
                  label: segment.label,
                  status: enums(`manufacturingActionStatus.${segment.status}`),
                })}
              />
            ))}
          </span>
          <span className={styles.stripFoot}>
            <strong>
              {of.finishedCount}/{of.segments.length}
            </strong>
            <span>
              {of.template ? (of.adapted ? t("row.adapted") : t("row.fromTemplate")) : t("row.custom")}
            </span>
          </span>
        </span>

        <span className={[styles.colNow, shell.col].filter(Boolean).join(" ")}>
          {assignee && <Avatar employee={assignee} size="sm" />}
          <span className={styles.nowText}>
            <span className={[styles.nowTitle, state.live ? styles.nowLive : null].filter(Boolean).join(" ")}>
              {state.title}
            </span>
            {state.meta !== null && (
              <span className={[shell.meta, state.alert ? shell.danger : null].filter(Boolean).join(" ")}>
                {state.meta}
              </span>
            )}
          </span>
        </span>

        <span className={[styles.colOpened, shell.col].filter(Boolean).join(" ")}>
          <span className={shell.mono}>{formatDay(of.createdAt)}</span>
          {of.createdByName && <span className={[shell.meta, styles.by].filter(Boolean).join(" ")}>{of.createdByName}</span>}
        </span>
      </Link>
    );
  };

  const descending = tableState.sortDir === "desc";
  const renderBody = (rows: readonly Row[]) => (
    <div className={shell.list}>
      <div className={shell.columns}>
        <span className={shell.main}>{t("columns.of")}</span>
        <span className={styles.colPipeline}>{t("columns.pipeline")}</span>
        <span className={styles.colNow}>{t("columns.now")}</span>
        <span className={styles.colOpened}>
          {/* The one sort the list offers: newest or oldest first. */}
          <button
            type="button"
            className={styles.sortBtn}
            title={t("row.sortOpened")}
            onClick={() =>
              setTableState((current) => ({
                ...current,
                sortDir: current.sortDir === "desc" ? "asc" : "desc",
                page: 1,
              }))
            }
          >
            {t("columns.opened")} <span aria-hidden>{descending ? "↓" : "↑"}</span>
          </button>
        </span>
      </div>
      {rows.map(row)}
    </div>
  );

  if (listQuery.isPending) return <TableSkeleton />;

  if (listQuery.isError) {
    return (
      <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
        {listQuery.error.message}
      </p>
    );
  }

  return (
    <DataTable
      rows={listQuery.data.rows}
      columns={[]}
      rowKey={(of) => of.id}
      renderBody={renderBody}
      flush
      total={listQuery.data.total}
      pageCount={listQuery.data.pageCount}
      loading={listQuery.isFetching}
      state={tableState}
      onStateChange={onStateChange}
      toolbar={
        <SegmentedFilter
          label={t("facets.label")}
          segments={FACETS.map((key) => ({
            key,
            label: t(`facets.${key}`),
            count: listQuery.data.facetCounts[key],
          }))}
          value={tableState.filter}
          // A filter changes which rows exist, so the pager goes back to
          // the first page — the rule the search follows.
          onChange={(filter) => setTableState((current) => ({ ...current, filter, page: 1 }))}
        />
      }
      searchPlaceholder={t("searchPlaceholder")}
      emptyMessage={t("empty")}
      emptyText={t("emptyText")}
    />
  );
}
