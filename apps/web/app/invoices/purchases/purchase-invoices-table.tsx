"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { TableSkeleton } from "@repo/ui/skeleton";
import { DataTable, type DataTableState } from "@repo/ui/data-table";
import type { InvoiceFacet, PurchaseInvoiceSortKey } from "api/src/invoice/invoice.list";
import { formatDay, formatMoney } from "../invoice-ui";
import { formatMonth } from "../../../i18n/formats";
import { useTRPC } from "../../trpc/client";
import { KpiRow, KpiTile } from "../../records/kpi";
import { NewRecordButton, RecordActions } from "../../records/new-record-button";
import { NO_PERIOD, PeriodFilter, type PeriodState } from "../../records/period-filter";
import { SegmentedFilter } from "../../records/segmented-filter";
import records from "../../records/records.module.css";
import shell from "../../records/banded-list.module.css";
import styles from "../invoice-list.module.css";

/*
 * From `Purchase invoices v3.dc.html`. The list is banded by month of
 * issue over sentence-like rows — number, when it was received, the
 * supplier and what it bills — with the due date, the amount and a payment
 * pill beside. The whole row is the click target.
 *
 * The payment state is the server's three-way split (`paymentState`: open,
 * overdue, paid) drawn as four: an open invoice with no term is "sans
 * terme", since "à payer dans … jours" cannot be said of it. The segmented
 * control filters on the server's facets, "à payer" being the overlapping
 * `unpaid` one.
 *
 * The header carries what suppliers billed per currency, what we still
 * owe, what is past its term, and — while any remain — how many invoices
 * were recorded without a currency: those are a tile of their own rather
 * than a silent gap in the sums. Everything is summed server-side over the
 * rows the pager counts (`purchaseFigures`), so it narrows with the
 * segment, the search and the date window. Band figures are the server's
 * for the whole month, since a month can straddle two pages.
 *
 * The sort is fixed on the issue date, newest first: bands by month make
 * no sense under any other order, and the handoff shows no other sort.
 */
interface PurchaseInvoicesTableState extends DataTableState, PeriodState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: PurchaseInvoiceSortKey;
  filter: "all" | InvoiceFacet;
}

const INITIAL_STATE: PurchaseInvoicesTableState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  sortBy: "issuedAt",
  sortDir: "desc",
  filter: "all",
};

/** The tiles' fixed order: the local currency first, then the import ones. */
const CURRENCIES = ["TND", "EUR", "USD"] as const;

/** The segments, as facet keys: all, still owed, past term, settled. */
const SEGMENTS = ["all", "unpaid", "overdue", "paid"] as const;

type RowState = "paid" | "late" | "due" | "nodate";

/** Colour and dot shape per state, from the handoff's `STATUS` table. */
const TONE: Record<RowState, string | undefined> = {
  paid: shell.toneSuccess,
  late: shell.toneDanger,
  due: shell.tonePending,
  nodate: shell.toneNeutral,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today at UTC midnight, the way `@db.Date` values are read, so a due date compares by day. */
function todayUtc(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** `YYYY-MM` of an issue date, the band key; `null` for an undated invoice. */
function monthOf(issuedAt: string | Date | null): string | null {
  return issuedAt === null ? null : new Date(issuedAt).toISOString().slice(0, 7);
}

export function PurchaseInvoicesTable() {
  const trpc = useTRPC();
  const t = useTranslations("invoices");
  const [tableState, setTableState] = useState<PurchaseInvoicesTableState>(INITIAL_STATE);

  const invoicesQuery = useQuery({
    ...trpc.purchaseInvoice.list.queryOptions(tableState),
    placeholderData: (prev) => prev,
  });

  type InvoiceRow = NonNullable<typeof invoicesQuery.data>["rows"][number];
  type MonthBand = NonNullable<typeof invoicesQuery.data>["months"][number];

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) =>
      setTableState((current) => ({ ...current, ...next }) as PurchaseInvoicesTableState),
    [],
  );

  const pageCount = invoicesQuery.data?.pageCount ?? 1;
  if (!invoicesQuery.isFetching && tableState.page > pageCount) {
    setTableState((current) => ({ ...current, page: pageCount }));
  }

  const today = todayUtc();

  const stateOf = (row: InvoiceRow): RowState =>
    row.paymentState === "paid"
      ? "paid"
      : row.paymentState === "overdue"
        ? "late"
        : row.dueAt === null
          ? "nodate"
          : "due";

  /** "réglée", "12 j de retard", "aujourd'hui", "dans 4 j" or "terme non renseigné". */
  const dueMeta = (row: InvoiceRow, state: RowState): string => {
    if (state === "paid") return t("purchases.row.settled");
    if (row.dueAt === null) return t("purchases.row.noTerm");
    const days = Math.round((new Date(row.dueAt).getTime() - today) / DAY_MS);
    if (days < 0) return t("purchases.row.late", { count: -days });
    if (days === 0) return t("purchases.row.dueToday");
    return t("purchases.row.dueIn", { count: days });
  };

  /** A currency, or the gap said in words. */
  const currencyLabel = (currency: string | null) =>
    currency ?? t("purchases.kpis.noCurrencyShort");

  const row = (invoice: InvoiceRow): ReactNode => {
    const state = stateOf(invoice);
    const late = state === "late";
    return (
      <Link
        key={invoice.id}
        href={`/invoices/purchases/${invoice.id}`}
        className={[shell.row, TONE[state]].filter(Boolean).join(" ")}
      >
        <span className={shell.main}>
          <i className={shell.dot} aria-hidden />
          <span className={shell.mainText}>
            <span className={shell.head}>
              <span className={shell.no}>{invoice.numero}</span>
              <span className={shell.headMeta}>
                {invoice.issuedAt
                  ? t("purchases.row.receivedOn", { date: formatDay(invoice.issuedAt) ?? "" })
                  : t("purchases.row.noDate")}
              </span>
              {!invoice.supplier.active && (
                <span className={shell.tag}>{t("purchases.row.archivedSupplier")}</span>
              )}
            </span>
            {/* `<bdi>` per part: in Arabic a Latin order number would otherwise
                jump to the other side of the separator. */}
            <span className={shell.sub}>
              <bdi className={shell.subStrong}>{invoice.supplier.name}</bdi>
              {invoice.subject !== null && (
                <span className={shell.subMuted}>
                  {" · "}
                  <bdi>{invoice.subject}</bdi>
                </span>
              )}
            </span>
          </span>
        </span>

        <span className={[styles.due, shell.col].filter(Boolean).join(" ")}>
          <span className={[shell.mono, late ? shell.danger : null].filter(Boolean).join(" ")}>
            {invoice.dueAt ? formatDay(invoice.dueAt) : "—"}
          </span>
          <span className={[shell.meta, late ? shell.danger : null].filter(Boolean).join(" ")}>
            {dueMeta(invoice, state)}
          </span>
        </span>

        <span className={[styles.amount, shell.col].filter(Boolean).join(" ")}>
          <span className={shell.figure}>
            {invoice.totalTtc === null ? "—" : formatMoney(invoice.totalTtc, null)}
          </span>
          <span
            className={[shell.meta, invoice.currency === null ? styles.noCurrency : null]
              .filter(Boolean)
              .join(" ")}
          >
            {currencyLabel(invoice.currency)}
          </span>
        </span>

        <span className={[styles.state, shell.col].filter(Boolean).join(" ")}>
          <span className={shell.pill}>
            <i className={shell.pillDot} aria-hidden />
            {t(`purchases.state.${state}`)}
          </span>
        </span>
      </Link>
    );
  };

  /** A band's head: the month, then how many invoices and what they come to per currency. */
  const bandHead = (key: string | null, band: MonthBand | undefined): ReactNode => (
    <div className={shell.band}>
      <span className={shell.bandLabel}>
        {key === null ? t("purchases.groups.noDate") : formatMonth(key)}
      </span>
      {band && (
        <span className={shell.bandMeta}>
          <bdi>{t("purchases.kpis.invoices", { count: band.count })}</bdi>
          {band.sums.map((sum) => (
            <span key={sum.currency ?? "none"}>
              {" · "}
              <bdi>{formatMoney(sum.total, currencyLabel(sum.currency))}</bdi>
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
  const renderBody = (rows: readonly InvoiceRow[]) => {
    const months = invoicesQuery.data?.months ?? [];
    const out: ReactNode[] = [];
    let current: string | null | undefined;
    for (const invoice of rows) {
      const key = monthOf(invoice.issuedAt);
      if (key !== current) {
        current = key;
        out.push(
          <div key={`band-${key ?? "none"}`}>
            {bandHead(
              key,
              months.find((band) => band.month === key),
            )}
          </div>,
        );
      }
      out.push(row(invoice));
    }
    return (
      <div className={shell.list}>
        <div className={shell.columns} aria-hidden>
          <span className={shell.main}>{t("columns.invoice")} ↓</span>
          <span className={styles.due}>{t("columns.due")}</span>
          <span className={styles.amount}>{t("columns.totalInclVat")}</span>
          <span className={styles.state}>{t("fields.status")}</span>
        </div>
        {out}
      </div>
    );
  };

  const reset = () =>
    setTableState((current) => ({ ...current, ...NO_PERIOD, filter: "all", search: "", page: 1 }));

  /*
   * One money tile per currency that has something in it, then what is
   * owed and what is late, which are always there, then — only while any
   * remain — the invoices recorded without a currency. Their amount is not
   * a money tile: a sum with no unit reads as a figure, and it is the count
   * that says how much filling-in is left.
   */
  const data = invoicesQuery.data;
  const tiles = data
    ? CURRENCIES.flatMap((currency) => {
        const figure = data.totals.find((group) => group.currency === currency);
        return figure ? [{ ...figure, currency }] : [];
      })
    : [];
  const noCurrency = data?.totals.find((group) => group.currency === null);

  return (
    <>
      <header className={records.header}>
        <div className={records.heading}>
          <span className={records.eyebrow}>{t("eyebrow")}</span>
          <h1 className={records.title}>{t("purchases.title")}</h1>
        </div>
        <p className={records.subtitle}>{t("purchases.subtitle")}</p>
        <RecordActions>
          <NewRecordButton href="/invoices/purchases/new" label={t("purchases.new")} />
        </RecordActions>

        {data && (
          <div className={styles.figures}>
            <KpiRow>
              {tiles.map((tile) => (
                <KpiTile
                  key={tile.currency}
                  label={t("purchases.kpis.billed", { currency: tile.currency })}
                  value={formatMoney(tile.total, null) ?? ""}
                  unit={tile.currency}
                  meta={t("purchases.kpis.invoices", { count: tile.count })}
                />
              ))}
              <KpiTile
                label={t("purchases.kpis.unpaid")}
                value={String(data.unpaid)}
                unit={t("purchases.kpis.invoiceUnit", { count: data.unpaid })}
                meta={t("purchases.kpis.unpaidMeta")}
                tone="pending"
              />
              <KpiTile
                label={t("purchases.kpis.overdue")}
                value={String(data.overdue)}
                unit={t("purchases.kpis.invoiceUnit", { count: data.overdue })}
                meta={
                  data.overdue > 0
                    ? t("purchases.kpis.overdueMeta")
                    : t("purchases.kpis.nothingOverdue")
                }
                tone={data.overdue > 0 ? "danger" : "success"}
              />
              {noCurrency && (
                <KpiTile
                  label={t("purchases.kpis.noCurrency")}
                  value={String(noCurrency.count)}
                  unit={t("purchases.kpis.invoiceUnit", { count: noCurrency.count })}
                  meta={t("purchases.kpis.noCurrencyMeta")}
                  tone="warning"
                />
              )}
            </KpiRow>
          </div>
        )}
      </header>

      {invoicesQuery.isPending ? (
        <TableSkeleton />
      ) : invoicesQuery.isError ? (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {invoicesQuery.error.message}
        </p>
      ) : (
        <DataTable
          rows={invoicesQuery.data.rows}
          columns={[]}
          rowKey={(invoice) => invoice.id}
          renderBody={renderBody}
          flush
          // The payment facets are the segmented control below, not chips.
          filters={[]}
          total={invoicesQuery.data.total}
          pageCount={invoicesQuery.data.pageCount}
          loading={invoicesQuery.isFetching}
          state={tableState}
          onStateChange={onStateChange}
          // Any change to the segment or the window changes which rows
          // exist, so the pager goes back to the first page — the rule the
          // search follows.
          toolbar={
            <>
              <SegmentedFilter
                label={t("fields.status")}
                segments={SEGMENTS.map((key) => ({
                  key,
                  label: t(`purchases.segments.${key}`),
                  count: invoicesQuery.data.facetCounts[key],
                }))}
                value={tableState.filter === "open" ? "all" : tableState.filter}
                onChange={(filter) =>
                  setTableState((current) => ({ ...current, filter, page: 1 }))
                }
              />
              <PeriodFilter
                label={t("purchases.period.label")}
                state={tableState}
                onChange={(next) =>
                  setTableState((current) => ({ ...current, ...next, page: 1 }))
                }
                note={t("purchases.period.inRange", { count: invoicesQuery.data.total })}
              />
            </>
          }
          searchPlaceholder={t("purchases.searchPlaceholder")}
          emptyMessage={t("purchases.empty.title")}
          emptyText={t("purchases.empty.text")}
          emptyActions={
            <Button variant="secondary" onClick={reset}>
              {t("purchases.empty.reset")}
            </Button>
          }
        />
      )}
    </>
  );
}
