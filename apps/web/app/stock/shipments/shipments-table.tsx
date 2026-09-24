"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { canAccess, DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { TableSkeleton } from "@repo/ui/skeleton";
import { DataTable, type Column, type DataTableState } from "@repo/ui/data-table";
import { Dialog } from "@repo/ui/dialog";
import type { ShipmentFacet, ShipmentSortKey } from "api/src/stock/stock.list";
import { useCurrentUser } from "../../auth/use-auth";
import { useTRPC } from "../../trpc/client";
import styles from "../../records/records.module.css";
import { dateFormat } from "../../../i18n/formats";

interface ShipmentsTableState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: ShipmentSortKey;
  filter: "all" | ShipmentFacet;
}

const INITIAL_STATE: ShipmentsTableState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  sortBy: "dateImport",
  sortDir: "desc",
  filter: "all",
};

const day = () => dateFormat({ dateStyle: "medium" });
const money = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function ShipmentsTable() {
  const t = useTranslations("stock");
  const common = useTranslations("common");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { user: me } = useCurrentUser();
  // Mirrors the procedures' adminProcedure gate — UX only, see ClientsTable.
  const canWrite = me ? canAccess(me.role, "ADMIN") : false;
  const [error, setError] = useState<string | null>(null);
  const [tableState, setTableState] = useState<ShipmentsTableState>(INITIAL_STATE);

  const shipmentsQuery = useQuery({
    ...trpc.stock.listShipments.queryOptions(tableState),
    placeholderData: (prev) => prev,
  });

  type ShipmentRow = NonNullable<typeof shipmentsQuery.data>["rows"][number];

  /** What the confirm dialog is about: archiving/restoring, or deleting. */
  const [pending, setPending] = useState<
    { row: ShipmentRow; action: "active" | "delete" } | null
  >(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.stock.listShipments.queryKey() });

  const setActive = useMutation(
    trpc.stock.setShipmentActive.mutationOptions({
      onSuccess: () => {
        setPending(null);
        return invalidate();
      },
      onError: (cause) => setError(cause.message),
    }),
  );
  const remove = useMutation(
    trpc.stock.removeShipment.mutationOptions({
      onSuccess: () => {
        setPending(null);
        return invalidate();
      },
      // The API refuses a delete while reels are attached; surface that
      // message rather than a generic failure.
      onError: (cause) => setError(cause.message),
    }),
  );

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) =>
      setTableState((current) => ({ ...current, ...next }) as ShipmentsTableState),
    [],
  );

  const pageCount = shipmentsQuery.data?.pageCount ?? 1;
  if (!shipmentsQuery.isFetching && tableState.page > pageCount) {
    setTableState((current) => ({ ...current, page: pageCount }));
  }

  const columns: ReadonlyArray<Column<ShipmentRow>> = [
    {
      key: "numeroImport",
      header: t("shipments.columns.shipment"),
      width: "minmax(130px,1fr)",
      sortKey: "numeroImport",
      cell: (row) => (
        <div
          className={[styles.mono, row.active ? null : styles.archivedRow]
            .filter(Boolean)
            .join(" ")}
        >
          {row.numeroImport}
          {!row.active && <span className={styles.archivedTag}>{t("archivedTag")}</span>}
        </div>
      ),
    },
    {
      key: "dateImport",
      header: t("shipments.columns.arrived"),
      width: "120px",
      sortKey: "dateImport",
      cell: (row) =>
        row.dateImport ? (
          <span className={styles.date}>{day().format(new Date(row.dateImport))}</span>
        ) : (
          <span className={styles.absent} />
        ),
    },
    {
      key: "supplier",
      header: t("shipments.columns.supplier"),
      width: "minmax(130px,1.2fr)",
      sortKey: "supplier",
      // Always present since `supplierId` became required — the free-text
      // fallback is gone, so there is no "name only" case to distinguish.
      cell: (row) => (
        <span
          className={[styles.name, row.supplier.active ? null : styles.archivedRow]
            .filter(Boolean)
            .join(" ")}
        >
          {row.supplier.name}
          {!row.supplier.active && <span className={styles.archivedTag}>{t("archivedTagShort")}</span>}
        </span>
      ),
    },
    {
      key: "productName",
      header: t("shipments.columns.paper"),
      width: "minmax(110px,1fr)",
      cell: (row) => <span className={styles.text}>{row.productName ?? "—"}</span>,
    },
    {
      key: "rolls",
      header: t("shipments.columns.rolls"),
      width: "70px",
      numeric: true,
      cell: (row) => <span className={styles.date}>{row.rollCount}</span>,
    },
    // Money only for ADMIN+: `listShipments` selects it for nobody else
    // (`SHIPMENT_SELECT` vs `SHIPMENT_SELECT_PRICED`), so the column is not
    // hidden, it has no data to show. Spliced out below rather than rendered
    // empty. The cast is confined to this cell, as `rollMoney` does for reels.
    ...(canWrite
      ? [
          {
            key: "priceTotal",
            header: t("shipments.columns.total"),
            width: "100px",
            numeric: true,
            cell: (row: ShipmentRow) => {
              const cost = row as ShipmentRow & {
                priceTotal?: number | null;
                currency?: string | null;
              };
              return cost.priceTotal ? (
                <span className={styles.date}>
                  {money.format(cost.priceTotal)}
                  {cost.currency ? ` ${cost.currency}` : ""}
                </span>
              ) : (
                <span className={styles.absent} />
              );
            },
          } satisfies Column<ShipmentRow>,
        ]
      : []),
    {
      key: "actions",
      header: "",
      width: canWrite ? "250px" : "80px",
      cell: (row) => (
        <div className={styles.actions}>
          <Link href={`/stock/shipments/${row.id}`}>
            <Button className={styles.actionBtn}>{t("open")}</Button>
          </Link>
          {canWrite && (
            <>
              <Button
                variant={row.active ? "danger" : "secondary"}
                className={styles.actionBtn}
                onClick={() => {
                  setError(null);
                  setPending({ row, action: "active" });
                }}
              >
                {row.active ? common("archive") : common("restore")}
              </Button>
              {/*
                Delete is offered only when nothing references the shipment.
                With reels attached the API refuses it anyway (deleting would
                strip their purchase history), so showing the button would be
                offering a dead end.
              */}
              {row.rollCount === 0 && (
                <Button
                  variant="danger"
                  className={styles.actionBtn}
                  onClick={() => {
                    setError(null);
                    setPending({ row, action: "delete" });
                  }}
                >
                  {common("delete")}
                </Button>
              )}
            </>
          )}
        </div>
      ),
    },
  ];

  if (shipmentsQuery.isPending) return <TableSkeleton />;

  if (shipmentsQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {shipmentsQuery.error.message}
      </p>
    );
  }

  const busy = setActive.isPending || remove.isPending;

  return (
    <>
      {error && (
        <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      <DataTable
      rows={shipmentsQuery.data.rows}
      columns={columns}
      rowKey={(row) => row.id}
      filters={[
        { key: "withRolls", label: t("shipments.filters.withRolls") },
        { key: "empty", label: t("shipments.filters.empty") },
        { key: "archived", label: t("shipments.filters.archived") },
      ]}
      facetCounts={shipmentsQuery.data.facetCounts}
      total={shipmentsQuery.data.total}
      pageCount={shipmentsQuery.data.pageCount}
      loading={shipmentsQuery.isFetching}
      state={tableState}
      onStateChange={onStateChange}
      searchPlaceholder={t("shipments.searchPlaceholder")}
      emptyMessage={t("shipments.emptyMessage")}
      />

      <Dialog
        open={pending !== null}
        title={
          pending?.action === "delete"
            ? t("shipments.deleteTitle")
            : pending?.row.active
              ? t("shipments.archiveTitle")
              : t("shipments.restoreTitle")
        }
        confirmLabel={
          pending?.action === "delete"
            ? common("delete")
            : pending?.row.active
              ? common("archive")
              : common("restore")
        }
        destructive={pending?.action === "delete" || (pending?.row.active ?? false)}
        busy={busy}
        onConfirm={() => {
          if (!pending) return;
          if (pending.action === "delete") {
            remove.mutate({ id: pending.row.id });
          } else {
            setActive.mutate({ id: pending.row.id, active: !pending.row.active });
          }
        }}
        onClose={() => !busy && setPending(null)}
      >
        {pending?.action === "delete"
          ? t.rich("shipments.deleteBody", {
              name: pending.row.numeroImport,
              strong: (chunks) => <strong>{chunks}</strong>,
            })
          : pending?.row.active
            ? t.rich("shipments.archiveBody", {
                name: pending.row.numeroImport,
                count: pending.row.rollCount,
                strong: (chunks) => <strong>{chunks}</strong>,
              })
            : t.rich("shipments.restoreBody", {
                name: pending?.row.numeroImport ?? "",
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
      </Dialog>
    </>
  );
}
