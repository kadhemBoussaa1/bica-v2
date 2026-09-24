"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { DataTable, type Column, type DataTableState } from "@repo/ui/data-table";
import { TableSkeleton } from "@repo/ui/skeleton";
import { useToast } from "@repo/ui/toast";
import { useTRPC } from "../../trpc/client";
import { dateFormat } from "../../../i18n/formats";
import records from "../../records/records.module.css";
import styles from "./stocktake.module.css";

interface CountsState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: "openedAt" | "status";
  filter: "all" | "open" | "closed";
}

const INITIAL_STATE: CountsState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  sortBy: "openedAt",
  sortDir: "desc",
  filter: "all",
};

const stamp = (value: string | Date | null) =>
  value ? dateFormat({ dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";

type CountRow = {
  id: string;
  status: "OPEN" | "CLOSED";
  expectedCount: number;
  labelledCount: number;
  openedAt: string | Date;
  closedAt: string | Date | null;
  notes: string | null;
  openedBy: { id: string; name: string };
  _count: { lines: number };
};

/**
 * Every stocktake, newest first, with the open one lifted into its own panel.
 *
 * At most one count can be open at a time (a partial unique index enforces
 * it), so "open a stocktake" is a single button that disables itself rather
 * than a form — and the open session gets a panel above the table because it
 * is the only row anyone can act on.
 */
export function CountsList() {
  const t = useTranslations("stock");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { push } = useToast();

  const [tableState, setTableState] = useState<CountsState>(INITIAL_STATE);
  const [error, setError] = useState<string | null>(null);

  const countsQuery = useQuery({
    ...trpc.inventory.list.queryOptions(tableState),
    placeholderData: (prev) => prev,
  });

  const open = useMutation(
    trpc.inventory.open.mutationOptions({
      onSuccess: async (count) => {
        setError(null);
        await queryClient.invalidateQueries({ queryKey: trpc.inventory.list.queryKey() });
        await queryClient.invalidateQueries({ queryKey: trpc.nav.counts.queryKey() });
        router.push(`/stock/counts/${count.id}`);
      },
      onError: (cause) => {
        setError(cause.message);
        push({ title: t("stocktake.alreadyOpen"), text: cause.message, tone: "error" });
      },
    }),
  );

  const rows = countsQuery.data?.rows ?? [];
  // At most one count can be open (a partial unique index enforces it), so
  // this is "the" open one, not "an" open one. Its presence is what decides
  // whether the panel offers to continue or to open.
  const openRow = rows.find((row) => row.status === "OPEN");

  const columns: ReadonlyArray<Column<CountRow>> = [
    {
      key: "status",
      header: t("stocktake.statusOpen"),
      width: "110px",
      sortKey: "status",
      cell: (row) => (
        <span
          className={[
            records.statusBadge,
            row.status === "OPEN" ? records.statusSuccess : records.statusNeutral,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {row.status === "OPEN" ? t("stocktake.statusOpen") : t("stocktake.statusClosed")}
        </span>
      ),
    },
    {
      key: "openedAt",
      header: t("stocktake.openedAt"),
      width: "minmax(160px, 1fr)",
      sortKey: "openedAt",
      cell: (row) => stamp(row.openedAt),
    },
    {
      key: "openedBy",
      header: t("stocktake.openedBy"),
      width: "minmax(140px, 1fr)",
      cell: (row) => row.openedBy.name,
    },
    {
      key: "progress",
      header: t("stocktake.sideCounted"),
      width: "minmax(160px, 1fr)",
      cell: (row) => {
        const pct =
          row.labelledCount === 0
            ? 0
            : Math.min(100, Math.round((row._count.lines / row.labelledCount) * 100));
        return (
          <span className={styles.progressCell}>
            <span>
              {t("stocktake.countedOf", {
                counted: row._count.lines,
                labelled: row.labelledCount,
              })}
            </span>
            <span className={styles.progressBar}>
              <span
                className={[styles.progressFill, pct === 100 ? styles.progressFillDone : null]
                  .filter(Boolean)
                  .join(" ")}
                style={{ inlineSize: `${pct}%` }}
              />
            </span>
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      width: "160px",
      cell: (row) => (
        <Link
          href={
            row.status === "OPEN"
              ? `/stock/counts/${row.id}`
              : `/stock/counts/${row.id}/report`
          }
        >
          <Button className={records.actionBtn}>
            {row.status === "OPEN" ? t("stocktake.continue") : t("stocktake.viewReport")}
          </Button>
        </Link>
      ),
    },
  ];

  if (countsQuery.isPending) return <TableSkeleton />;

  if (countsQuery.isError) {
    return (
      <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
        {countsQuery.error.message}
      </p>
    );
  }

  return (
    <>
      {error ? (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.openPanel}>
        <div className={styles.openPanelHead}>
          <span className={styles.openPanelTitle}>
            {openRow ? t("stocktake.statusOpen") : t("stocktake.empty")}
          </span>
          {openRow ? (
            <span className={styles.openPanelMeta}>
              {t("stocktake.expectedNote", {
                expected: openRow.expectedCount,
                labelled: openRow.labelledCount,
              })}
            </span>
          ) : null}
        </div>
        <div className={styles.openPanelActions}>
          {openRow ? (
            // The open count is the only thing anyone can act on, so
            // continuing it is the primary action — not a greyed-out "open"
            // button sitting where the primary belongs.
            <Link href={`/stock/counts/${openRow.id}`}>
              <Button size="floor" variant="primary">
                {t("stocktake.continue")}
              </Button>
            </Link>
          ) : (
            <Button
              size="floor"
              variant="primary"
              busy={open.isPending}
              onClick={() => open.mutate({})}
            >
              {t("stocktake.open")}
            </Button>
          )}
        </div>
      </div>

      <DataTable<CountRow>
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        filters={[
          { key: "open", label: t("stocktake.statusOpen") },
          { key: "closed", label: t("stocktake.statusClosed") },
        ]}
        facetCounts={countsQuery.data.facetCounts}
        total={countsQuery.data.total}
        pageCount={countsQuery.data.pageCount}
        loading={countsQuery.isFetching}
        state={tableState}
        // Any change to search, sort or filter resets to page 1: the row that
        // was on page 3 of the old result is not on page 3 of the new one.
        onStateChange={(next) =>
          setTableState((prev) => ({
            ...prev,
            ...next,
            // `next.pageSize` is a plain `number` on DataTableState; the
            // server's input only accepts a PAGE_SIZES literal, and the table
            // never emits anything else.
            pageSize: (next.pageSize ?? prev.pageSize) as CountsState["pageSize"],
            sortBy: (next.sortBy ?? prev.sortBy) as CountsState["sortBy"],
            filter: (next.filter ?? prev.filter) as CountsState["filter"],
            page: "page" in next ? (next.page ?? 1) : 1,
          }))
        }
        density="dense"
        searchable
        emptyMessage={t("stocktake.emptyText")}
      />
    </>
  );
}
