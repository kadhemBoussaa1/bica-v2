"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { TableSkeleton } from "@repo/ui/skeleton";
import { DataTable, type DataTableState } from "@repo/ui/data-table";
import type { SalesInvoiceFacet, SalesInvoiceSortKey } from "api/src/invoice/invoice.list";
import { formatDay, formatMoney } from "../invoice-ui";
import { formatMonth } from "../../../i18n/formats";
import { useTRPC } from "../../trpc/client";
import { KpiRow, KpiTile } from "../../records/kpi";
import { NewRecordButton, RecordActions } from "../../records/new-record-button";
import { NO_PERIOD, PeriodFilter, type PeriodState } from "../../records/period-filter";
import records from "../../records/records.module.css";
import shell from "../../records/banded-list.module.css";
import styles from "../invoice-list.module.css";

/*
 * From `Sales invoices v3.dc.html`. The list is banded by month of issue
 * rather than ruled as a table: each band names the month and what it
 * comes to per currency, drafts as a band of their own at the top. A row
 * reads as a sentence — number, when it was issued, the client and the
 * order it bills — with the due date, the amount and a status pill beside
 * it, and the whole row is the click target.
 *
 * The header carries one money tile per currency — what the listed issued
 * invoices come to in EUR, USD and TND — and one for what is overdue. All
 * of them are summed server-side over the same rows the pager counts, so
 * they narrow with the chip, the search and the date window. Drafts stay
 * in the list under any window but never in a tile: a draft is not yet an
 * amount billed (`salesFigures`).
 *
 * Built with the handoff's month sums rather than the page's: the list is
 * paged, so a month can straddle two pages, and a band that only summed
 * the rows on screen would say "3 invoices" about a month of eight. The
 * server sends every band's figures with the page (`months`).
 *
 * The sort is fixed on the issue date, newest first, drafts (no date)
 * first of all: bands by month make no sense under any other order, and
 * the handoff shows no other sort.
 *
 * The date window is `PeriodState`: keys and scalars the server turns into
 * the predicate (`salesInvoicePeriodScope`), AND-ed into `scope` so the
 * draft/issued chips keep counting inside it.
 */
interface SalesInvoicesTableState extends DataTableState, PeriodState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: SalesInvoiceSortKey;
  filter: "all" | SalesInvoiceFacet;
}

const INITIAL_STATE: SalesInvoicesTableState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  sortBy: "issuedAt",
  sortDir: "desc",
  filter: "all",
};

/** The tiles' fixed order: export currencies first, the way the business reads them. */
const CURRENCIES = ["EUR", "USD", "TND"] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today at UTC midnight, the way `@db.Date` values are read, so a due date compares by day. */
function todayUtc(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** `YYYY-MM` of an issue date, the band key; drafts have none. */
function monthOf(issuedAt: string | Date | null): string | null {
  return issuedAt === null ? null : new Date(issuedAt).toISOString().slice(0, 7);
}

export function SalesInvoicesTable() {
  const trpc = useTRPC();
  const t = useTranslations("invoices");
  const enums = useTranslations("enums");
  const [tableState, setTableState] = useState<SalesInvoicesTableState>(INITIAL_STATE);

  const invoicesQuery = useQuery({
    ...trpc.salesInvoice.list.queryOptions(tableState),
    placeholderData: (prev) => prev,
  });

  type InvoiceRow = NonNullable<typeof invoicesQuery.data>["rows"][number];
  type MonthBand = NonNullable<typeof invoicesQuery.data>["months"][number];

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) =>
      setTableState((current) => ({ ...current, ...next }) as SalesInvoicesTableState),
    [],
  );

  const pageCount = invoicesQuery.data?.pageCount ?? 1;
  if (!invoicesQuery.isFetching && tableState.page > pageCount) {
    setTableState((current) => ({ ...current, page: pageCount }));
  }

  const today = todayUtc();

  /** "12 j de retard", "aujourd'hui", "dans 4 j", "payée le …" or "sans échéance". */
  const dueMeta = (row: InvoiceRow): string => {
    if (row.paidAt !== null) return t("sales.row.paidOn", { date: formatDay(row.paidAt) ?? "" });
    if (row.dueAt === null) return t("sales.row.noDue");
    const days = Math.round((new Date(row.dueAt).getTime() - today) / DAY_MS);
    if (days < 0) return t("sales.row.late", { count: -days });
    if (days === 0) return t("sales.row.dueToday");
    return t("sales.row.dueIn", { count: days });
  };

  const stateOf = (row: InvoiceRow): "draft" | "issued" | "overdue" =>
    row.status === "DRAFT" ? "draft" : row.overdue ? "overdue" : "issued";

  /** Colour and dot shape per state, from the handoff's `STATUS` table. */
  const TONE = {
    draft: shell.toneNeutral,
    issued: shell.toneSuccess,
    overdue: shell.toneDanger,
  } as const;

  const stateLabel = (state: "draft" | "issued" | "overdue") =>
    state === "overdue"
      ? t("paymentState.overdue")
      : enums(state === "draft" ? "salesInvoiceStatus.DRAFT" : "salesInvoiceStatus.ISSUED");

  const row = (invoice: InvoiceRow): ReactNode => {
    const state = stateOf(invoice);
    const late = state === "overdue";
    return (
      <Link
        key={invoice.id}
        href={`/invoices/sales/${invoice.id}`}
        className={[shell.row, TONE[state]].filter(Boolean).join(" ")}
      >
        <span className={shell.main}>
          <i className={shell.dot} aria-hidden />
          <span className={shell.mainText}>
            <span className={shell.head}>
              {/* A draft has no number until it is issued. */}
              <span className={invoice.numero === null ? styles.noDraft : shell.no}>
                {invoice.numero ?? enums("salesInvoiceStatus.DRAFT")}
              </span>
              <span className={shell.headMeta}>
                {invoice.issuedAt
                  ? t("sales.row.issuedOn", { date: formatDay(invoice.issuedAt) ?? "" })
                  : t("sales.row.notIssued")}
              </span>
            </span>
            {/* `<bdi>` per part: in Arabic a Latin order number would otherwise
                jump to the other side of the separator. */}
            <span className={shell.sub}>
              {invoice.client ? (
                <bdi
                  className={[shell.subStrong, invoice.client.active ? null : records.archivedRow]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {invoice.client.name}
                  {!invoice.client.active && (
                    <span className={records.archivedTag}>{t("archivedTag")}</span>
                  )}
                </bdi>
              ) : (
                <bdi className={shell.subMuted}>{t("noClient")}</bdi>
              )}
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
            {dueMeta(invoice)}
          </span>
        </span>

        <span className={[styles.amount, shell.col].filter(Boolean).join(" ")}>
          <span className={shell.figure}>
            {invoice.totalTtc === null ? "—" : formatMoney(invoice.totalTtc, null)}
          </span>
          <span className={shell.meta}>{invoice.currency ?? ""}</span>
        </span>

        <span className={[styles.state, shell.col].filter(Boolean).join(" ")}>
          <span className={shell.pill}>
            <i className={shell.pillDot} aria-hidden />
            {stateLabel(state)}
          </span>
        </span>
      </Link>
    );
  };

  /** A band's head: the month, then how many invoices and what they come to per currency. */
  const bandHead = (key: string | null, band: MonthBand | undefined): ReactNode => (
    <div className={shell.band}>
      <span className={shell.bandLabel}>
        {key === null ? t("sales.groups.drafts") : formatMonth(key)}
      </span>
      {band && (
        <span className={shell.bandMeta}>
          <bdi>{t("sales.kpis.invoices", { count: band.count })}</bdi>
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
   * first, drafts before all). A band opens whenever the key changes; its
   * figures are the server's for the whole month, not this page's slice.
   */
  const renderBody = (rows: readonly InvoiceRow[]) => {
    const months = invoicesQuery.data?.months ?? [];
    const out: ReactNode[] = [];
    let current: string | null | undefined;
    for (const invoice of rows) {
      const key = monthOf(invoice.issuedAt === null || invoice.status === "DRAFT" ? null : invoice.issuedAt);
      if (key !== current) {
        current = key;
        out.push(
          <div key={`band-${key ?? "drafts"}`}>
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
   * One tile per currency that has something in it, then the overdue tile,
   * which is always there: "nothing late" is worth a line, where "0,00 EUR"
   * would read as a balance rather than an absence.
   */
  const data = invoicesQuery.data;
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
          <h1 className={records.title}>{t("sales.title")}</h1>
        </div>
        <p className={records.subtitle}>{t("sales.subtitle")}</p>
        <RecordActions>
          <NewRecordButton href="/invoices/sales/new" label={t("sales.new")} />
        </RecordActions>

        {data && (
          <div className={styles.figures}>
            <KpiRow>
              {tiles.map((tile) => (
                <KpiTile
                  key={tile.currency}
                  label={t("sales.kpis.billed", { currency: tile.currency })}
                  value={formatMoney(tile.total, null) ?? ""}
                  unit={tile.currency}
                  meta={t("sales.kpis.invoices", { count: tile.count })}
                />
              ))}
              <KpiTile
                label={t("sales.kpis.overdue")}
                value={String(data.overdue)}
                unit={t("sales.kpis.overdueUnit", { count: data.overdue })}
                meta={data.overdue > 0 ? t("sales.kpis.toChase") : t("sales.kpis.nothingOverdue")}
                tone={data.overdue > 0 ? "danger" : "success"}
              />
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
          filters={[
            { key: "draft", label: t("filters.draft") },
            { key: "issued", label: t("filters.issued") },
          ]}
          facetCounts={invoicesQuery.data.facetCounts}
          total={invoicesQuery.data.total}
          pageCount={invoicesQuery.data.pageCount}
          loading={invoicesQuery.isFetching}
          state={tableState}
          onStateChange={onStateChange}
          // Any change to the window changes which rows exist, so the pager
          // goes back to the first page — the rule the chips and search follow.
          toolbar={
            <PeriodFilter
              label={t("sales.period.label")}
              state={tableState}
              onChange={(next) => setTableState((current) => ({ ...current, ...next, page: 1 }))}
              note={t("sales.period.inRange", { count: invoicesQuery.data.total })}
            />
          }
          searchPlaceholder={t("sales.searchPlaceholder")}
          emptyMessage={t("sales.empty.title")}
          emptyText={t("sales.empty.text")}
          emptyActions={
            <Button variant="secondary" onClick={reset}>
              {t("sales.empty.reset")}
            </Button>
          }
        />
      )}
    </>
  );
}
