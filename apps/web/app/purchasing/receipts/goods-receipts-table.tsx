"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@repo/api-contract";
import { TableSkeleton } from "@repo/ui/skeleton";
import { DataTable, type Column, type DataTableState } from "@repo/ui/data-table";
import type { GoodsReceiptSortKey, PurchasingFacet } from "api/src/purchasing/purchasing.list";
import { formatDay } from "../../invoices/invoice-ui";
import { CategoryBadge, formatQty, ReceiptStatusBadge, usePurchasingFilters } from "../purchasing-ui";
import { useTRPC } from "../../trpc/client";
import styles from "../../records/records.module.css";
import purchasing from "../purchasing.module.css";

/*
 * From `Goods receipts v3.dc.html`. Four columns rather than eight: the
 * handoff folds the number, category and what the note covers into one cell,
 * pairs the status with its date, and stacks received over ordered — so a row
 * reads as a sentence. The whole row is the click target.
 *
 * Not built, for want of anything behind them: the handoff's four tiles
 * (awaiting / part received / arrived this month / not invoiced) and its two
 * status chips. Every order now auto-creates its receipt, so only 8 receipts
 * are PENDING and 1 is PARTIAL — chips reading 8 and 1 beside nine category
 * chips would earn their space poorly. Same call as the purchase-order list.
 */

interface GoodsReceiptsTableState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: GoodsReceiptSortKey;
  filter: "all" | PurchasingFacet;
}

const INITIAL_STATE: GoodsReceiptsTableState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  sortBy: "issuedAt",
  sortDir: "desc",
  filter: "all",
};

/** The dot beside the number: reception at a glance, before the badge is read. */
const DOT_CLASS: Record<string, string | undefined> = {
  PENDING: purchasing.dotPending,
  PARTIAL: purchasing.dotPartial,
  COMPLETE: purchasing.dotReceived,
};

export function GoodsReceiptsTable() {
  const trpc = useTRPC();
  const router = useRouter();
  const t = useTranslations("purchasing");
  const filters = usePurchasingFilters();
  const [tableState, setTableState] = useState<GoodsReceiptsTableState>(INITIAL_STATE);

  const receiptsQuery = useQuery({
    ...trpc.goodsReceipt.list.queryOptions(tableState),
    placeholderData: (prev) => prev,
  });

  type ReceiptRow = NonNullable<typeof receiptsQuery.data>["rows"][number];

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) =>
      setTableState((current) => ({ ...current, ...next }) as GoodsReceiptsTableState),
    [],
  );

  const pageCount = receiptsQuery.data?.pageCount ?? 1;
  if (!receiptsQuery.isFetching && tableState.page > pageCount) {
    setTableState((current) => ({ ...current, page: pageCount }));
  }

  const columns: ReadonlyArray<Column<ReceiptRow>> = [
    {
      key: "numero",
      header: t("fields.receipt"),
      width: "minmax(220px,1.6fr)",
      sortKey: "numero",
      cell: (row) => (
        <span className={purchasing.orderCell}>
          <i
            className={[purchasing.dot, row.status === null ? undefined : DOT_CLASS[row.status]]
              .filter(Boolean)
              .join(" ")}
            aria-hidden="true"
          />
          <span className={purchasing.orderText}>
            <span className={purchasing.orderTop}>
              <span className={purchasing.orderNo}>{row.numero}</span>
              <CategoryBadge category={row.category} />
            </span>
            {/* The order it was raised against — the note's whole purpose. */}
            <span className={purchasing.orderDates}>
              {t("fields.order")} {row.order.numero}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "supplier",
      header: t("fields.supplier"),
      width: "minmax(140px,1fr)",
      sortKey: "supplier",
      cell: (row) => (
        <span
          className={[styles.name, row.supplier.active ? null : styles.archivedRow]
            .filter(Boolean)
            .join(" ")}
        >
          {row.supplier.name}
          {!row.supplier.active && <span className={styles.archivedTag}>{t("archivedShort")}</span>}
        </span>
      ),
    },
    {
      key: "status",
      header: t("fields.reception"),
      width: "160px",
      sortKey: "receivedAt",
      cell: (row) => (
        <span>
          <ReceiptStatusBadge status={row.status} />
          {/* Arrived when it has, else the day the note was raised. */}
          <span className={purchasing.orderDates}>
            {row.receivedAt === null
              ? `${t("fields.raised")} ${formatDay(row.issuedAt) ?? ""}`
              : `${t("fields.received")} ${formatDay(row.receivedAt) ?? ""}`}
          </span>
        </span>
      ),
    },
    {
      key: "receivedQuantity",
      header: t("fields.qtyReceived"),
      width: "130px",
      numeric: true,
      cell: (row) =>
        // Null for transport, whose lines carry a price rather than a count:
        // a service is not received in units.
        row.receivedQuantity === null ? (
          <span className={styles.absent} />
        ) : (
          <span className={purchasing.amount}>{formatQty(row.receivedQuantity)}</span>
        ),
    },
  ];

  if (receiptsQuery.isPending) return <TableSkeleton />;

  if (receiptsQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {receiptsQuery.error.message}
      </p>
    );
  }

  return (
    <DataTable
      rows={receiptsQuery.data.rows}
      columns={columns}
      rowKey={(row) => row.id}
      onRowClick={(row) => router.push(`/purchasing/receipts/${row.id}`)}
      filters={filters}
      facetCounts={receiptsQuery.data.facetCounts}
      total={receiptsQuery.data.total}
      pageCount={receiptsQuery.data.pageCount}
      loading={receiptsQuery.isFetching}
      state={tableState}
      onStateChange={onStateChange}
      searchPlaceholder={t("receipts.searchPlaceholder")}
      emptyMessage={t("receipts.empty")}
    />
  );
}
