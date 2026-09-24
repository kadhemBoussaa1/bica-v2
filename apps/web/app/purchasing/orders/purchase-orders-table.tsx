"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { TableSkeleton } from "@repo/ui/skeleton";
import { DataTable, type DataTableState } from "@repo/ui/data-table";
import type {
  OrderState,
  OrderStateKey,
  PurchaseOrderSortKey,
  PurchasingFacet,
} from "api/src/purchasing/purchasing.list";
import { formatDay, formatMoney } from "../../invoices/invoice-ui";
import { formatMonth } from "../../../i18n/formats";
import { usePurchasingFilters } from "../purchasing-ui";
import { useTRPC } from "../../trpc/client";
import { KpiRow, KpiTile } from "../../records/kpi";
import { NewRecordButton, RecordActions } from "../../records/new-record-button";
import { NO_PERIOD, PeriodFilter, type PeriodState } from "../../records/period-filter";
import { SegmentedFilter } from "../../records/segmented-filter";
import records from "../../records/records.module.css";
import shell from "../../records/banded-list.module.css";
import styles from "./orders-list.module.css";

/*
 * From `Purchase orders v4.dc.html`. The list is banded by month of issue
 * over sentence-like rows: number and category tag, what the first line is
 * for, the supplier, a reception pill with when the goods are expected,
 * and the amount. The whole row is the click target.
 *
 * Two facets, independent: the category chips (the server's nine) and a
 * segmented reception state — all, awaiting, late, received. Each counts
 * ignoring only itself, so a chip says how many rows it would show given
 * the state, and a segment given the chip. The date window narrows both.
 *
 * The header carries the money committed per currency and two counts —
 * awaiting delivery, late — all summed server-side over exactly the rows
 * the pager counts (`orderFigures`). The band figures are the server's for
 * the whole month, since a month can straddle two pages.
 *
 * The v3 list's per-category dimension columns are gone with this
 * handoff: the designation line carries what the lines measure, in words.
 *
 * The sort is fixed on the issue date, newest first: bands by month make no
 * sense under any other order, and the handoff shows no other sort.
 */
interface PurchaseOrdersTableState extends DataTableState, PeriodState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: PurchaseOrderSortKey;
  filter: "all" | PurchasingFacet;
  state: "all" | OrderStateKey;
}

const INITIAL_STATE: PurchaseOrdersTableState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  sortBy: "issuedAt",
  sortDir: "desc",
  filter: "all",
  state: "all",
};

/** The tiles' fixed order: the local currency first, as the v3 page had it. */
const CURRENCIES = ["TND", "EUR"] as const;

const STATE_KEYS: readonly ("all" | OrderStateKey)[] = ["all", "waiting", "late", "received"];

/** Colour and dot shape per reception state, from the handoff's `RECEPTION` table. */
const TONE: Record<OrderState, string | undefined> = {
  pending: shell.tonePending,
  late: shell.toneDanger,
  partial: shell.toneWarning,
  received: shell.toneSuccess,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today at UTC midnight, the way `@db.Date` values are read, so a date compares by day. */
function todayUtc(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** `YYYY-MM` of an issue date, the band key. */
function monthOf(issuedAt: string | Date): string {
  return new Date(issuedAt).toISOString().slice(0, 7);
}

export function PurchaseOrdersTable() {
  const trpc = useTRPC();
  const t = useTranslations("purchasing");
  const enums = useTranslations("enums");
  const filters = usePurchasingFilters();
  const [tableState, setTableState] = useState<PurchaseOrdersTableState>(INITIAL_STATE);

  const ordersQuery = useQuery({
    ...trpc.purchaseOrder.list.queryOptions(tableState),
    placeholderData: (prev) => prev,
  });

  type OrderRow = NonNullable<typeof ordersQuery.data>["rows"][number];
  type MonthBand = NonNullable<typeof ordersQuery.data>["months"][number];

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) =>
      setTableState((current) => ({ ...current, ...next }) as PurchaseOrdersTableState),
    [],
  );

  const pageCount = ordersQuery.data?.pageCount ?? 1;
  if (!ordersQuery.isFetching && tableState.page > pageCount) {
    setTableState((current) => ({ ...current, page: pageCount }));
  }

  const today = todayUtc();

  /** "raised 27 Jul" once received; otherwise when it is expected, and by how much it is late. */
  const dueMeta = (row: OrderRow): string => {
    if (row.state === "received") {
      return t("orders.row.issuedOn", { date: formatDay(row.issuedAt) ?? "" });
    }
    if (row.expectedAt === null) return t("orders.row.noExpected");
    const date = formatDay(row.expectedAt) ?? "";
    if (row.state !== "late") return t("orders.row.expectedOn", { date });
    const days = Math.round((today - new Date(row.expectedAt).getTime()) / DAY_MS);
    return t("orders.row.expectedLate", { date, count: days });
  };

  const row = (order: OrderRow): ReactNode => (
    <Link
      key={order.id}
      href={`/purchasing/orders/${order.id}`}
      className={[shell.row, TONE[order.state]].filter(Boolean).join(" ")}
    >
      <span className={shell.main}>
        <i className={shell.dot} aria-hidden />
        <span className={shell.mainText}>
          <span className={shell.head}>
            <span className={shell.no}>{order.numero}</span>
            <span className={shell.tag}>{enums(`purchaseCategory.${order.category}`)}</span>
          </span>
          {/* `<bdi>` per part: in Arabic a Latin designation would otherwise
              jump to the other side of the separator. */}
          <span className={shell.sub}>
            {order.designation !== null && <bdi>{order.designation}</bdi>}
            {order.lineCount > 1 && (
              <span className={shell.subMuted}>
                {order.designation !== null && " · "}
                <bdi>{t("orders.row.moreLines", { count: order.lineCount - 1 })}</bdi>
              </span>
            )}
          </span>
        </span>
      </span>

      <span className={[styles.supplier, shell.col, shell.mono].filter(Boolean).join(" ")}>
        <span className={order.supplier.active ? undefined : records.archivedRow}>
          {order.supplier.name}
        </span>
        {!order.supplier.active && (
          <span className={records.archivedTag}>{t("archivedShort")}</span>
        )}
      </span>

      <span className={[styles.reception, shell.col].filter(Boolean).join(" ")}>
        <span className={shell.pill}>
          <i className={shell.pillDot} aria-hidden />
          {t(`orders.reception.${order.state}`)}
        </span>
        <span
          className={[shell.meta, order.state === "late" ? shell.danger : null]
            .filter(Boolean)
            .join(" ")}
        >
          {dueMeta(order)}
        </span>
      </span>

      <span className={[styles.total, shell.col].filter(Boolean).join(" ")}>
        <span className={shell.figure}>{formatMoney(order.amount, null)}</span>
        <span className={shell.meta}>{order.currency}</span>
      </span>
    </Link>
  );

  /** A band's head: the month, then how many orders and what they come to per currency. */
  const bandHead = (key: string, band: MonthBand | undefined): ReactNode => (
    <div className={shell.band}>
      <span className={shell.bandLabel}>{formatMonth(key)}</span>
      {band && (
        <span className={shell.bandMeta}>
          <bdi>{t("orders.kpis.orders", { count: band.count })}</bdi>
          {band.sums.map((sum) => (
            <span key={sum.currency}>
              {" · "}
              <bdi>{formatMoney(sum.total, sum.currency)}</bdi>
            </span>
          ))}
        </span>
      )}
    </div>
  );

  /**
   * The page's rows, banded by month in the order they arrive (newest
   * first). A band opens whenever the key changes; its figures are the
   * server's for the whole month, not this page's slice.
   */
  const renderBody = (rows: readonly OrderRow[]) => {
    const months = ordersQuery.data?.months ?? [];
    const out: ReactNode[] = [];
    let current: string | undefined;
    for (const order of rows) {
      const key = monthOf(order.issuedAt);
      if (key !== current) {
        current = key;
        out.push(
          <div key={`band-${key}`}>
            {bandHead(
              key,
              months.find((band) => band.month === key),
            )}
          </div>,
        );
      }
      out.push(row(order));
    }
    return (
      <div className={shell.list}>
        <div className={shell.columns} aria-hidden>
          <span className={shell.main}>{t("fields.order")} ↓</span>
          <span className={styles.supplier}>{t("fields.supplier")}</span>
          <span className={styles.reception}>{t("fields.reception")}</span>
          <span className={styles.total}>{t("fields.totalHt")}</span>
        </div>
        {out}
      </div>
    );
  };

  const reset = () =>
    setTableState((current) => ({
      ...current,
      ...NO_PERIOD,
      filter: "all",
      state: "all",
      search: "",
      page: 1,
    }));

  /*
   * One money tile per currency that has something in it — paper is all
   * EUR and nearly everything else TND, so a category chip usually leaves
   * one empty, and "0,00 EUR" would read as a balance rather than an
   * absence — then the two counts, which are always there.
   */
  const data = ordersQuery.data;
  const tiles = data
    ? CURRENCIES.flatMap((currency) => {
        const figure = data.totals.find((group) => group.currency === currency);
        return figure ? [{ ...figure, currency }] : [];
      })
    : [];

  return (
    <>
      <header className={records.header}>
        <div className={records.heading}>
          <span className={records.eyebrow}>{t("eyebrow")}</span>
          <h1 className={records.title}>{t("orders.title")}</h1>
        </div>
        <p className={records.subtitle}>{t("orders.subtitle")}</p>
        <RecordActions>
          <NewRecordButton href="/purchasing/orders/new" label={t("orders.newButton")} />
        </RecordActions>

        {data && (
          <div className={styles.figures}>
            <KpiRow>
              {tiles.map((tile) => (
                <KpiTile
                  key={tile.currency}
                  label={t("orders.kpis.committed", { currency: tile.currency })}
                  value={formatMoney(tile.total, null) ?? ""}
                  unit={tile.currency}
                  meta={t("orders.kpis.orders", { count: tile.count })}
                />
              ))}
              <KpiTile
                label={t("orders.kpis.waiting")}
                value={String(data.waiting)}
                unit={t("orders.kpis.ordersUnit", { count: data.waiting })}
                meta={t("orders.kpis.waitingMeta")}
                tone="pending"
              />
              <KpiTile
                label={t("orders.kpis.late")}
                value={String(data.late)}
                unit={t("orders.kpis.ordersUnit", { count: data.late })}
                meta={data.late > 0 ? t("orders.kpis.toChase") : t("orders.kpis.nothingLate")}
                tone={data.late > 0 ? "danger" : "success"}
              />
            </KpiRow>
          </div>
        )}
      </header>

      {ordersQuery.isPending ? (
        <TableSkeleton />
      ) : ordersQuery.isError ? (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {ordersQuery.error.message}
        </p>
      ) : (
        <DataTable
          rows={ordersQuery.data.rows}
          columns={[]}
          rowKey={(order) => order.id}
          renderBody={renderBody}
          flush
          filters={filters}
          facetCounts={ordersQuery.data.facetCounts}
          total={ordersQuery.data.total}
          pageCount={ordersQuery.data.pageCount}
          loading={ordersQuery.isFetching}
          state={tableState}
          onStateChange={onStateChange}
          // Any change to the state or the window changes which rows exist,
          // so the pager goes back to the first page — the rule the chips
          // and the search follow.
          toolbar={
            <>
              <SegmentedFilter
                label={t("fields.reception")}
                segments={STATE_KEYS.map((key) => ({
                  key,
                  label: t(`orders.states.${key}`),
                  count: ordersQuery.data.states[key],
                }))}
                value={tableState.state}
                onChange={(state) => setTableState((current) => ({ ...current, state, page: 1 }))}
              />
              <PeriodFilter
                label={t("orders.period.label")}
                state={tableState}
                onChange={(next) =>
                  setTableState((current) => ({ ...current, ...next, page: 1 }))
                }
                note={t("orders.period.inRange", { count: ordersQuery.data.total })}
              />
            </>
          }
          searchPlaceholder={t("orders.searchPlaceholder")}
          emptyMessage={t("orders.empty.title")}
          emptyText={t("orders.empty.text")}
          emptyActions={
            <Button variant="secondary" onClick={reset}>
              {t("orders.empty.reset")}
            </Button>
          }
        />
      )}
    </>
  );
}
