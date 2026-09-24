"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { DataTable, type Column, type DataTableState } from "@repo/ui/data-table";
import type { ShipmentRollSortKey } from "api/src/stock/stock.list";
import { useTRPC } from "../../../trpc/client";
import styles from "../../../records/records.module.css";
import { dateFormat } from "../../../../i18n/formats";

interface ShipmentRollsState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: ShipmentRollSortKey;
  /** Only ever "all": a delivery is a fixed set of reels, so no state facets. */
  filter: "all";
}

const INITIAL_STATE: ShipmentRollsState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  sortBy: "numero",
  sortDir: "asc",
  filter: "all",
};

const kg = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const day = () => dateFormat({ dateStyle: "medium" });

/**
 * The reels on one shipment, searchable by reel number.
 *
 * Server-side: the search, sort and paging all run as a scoped query, so a
 * delivery with 136 reels does not have to be held in the page to be
 * filtered. `DataTable` is controlled, so this owns the state and debounces
 * the search itself — see the note in CLAUDE.md.
 */
export function ShipmentRolls({ shipmentId }: { shipmentId: string }) {
  const t = useTranslations("stock");
  const enums = useTranslations("enums");
  const trpc = useTRPC();
  const [tableState, setTableState] = useState<ShipmentRollsState>(INITIAL_STATE);

  const rollsQuery = useQuery({
    ...trpc.stock.rollsForShipment.queryOptions({ ...tableState, shipmentId }),
    placeholderData: (prev) => prev,
  });

  type RollRow = NonNullable<typeof rollsQuery.data>["rows"][number];

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) =>
      setTableState((current) => ({ ...current, ...next }) as ShipmentRollsState),
    [],
  );

  const pageCount = rollsQuery.data?.pageCount ?? 1;
  if (!rollsQuery.isFetching && tableState.page > pageCount) {
    setTableState((current) => ({ ...current, page: pageCount }));
  }

  const columns: ReadonlyArray<Column<RollRow>> = [
    {
      key: "numero",
      header: t("rolls.columns.reel"),
      width: "minmax(130px,1.2fr)",
      sortKey: "numero",
      cell: (row) => (
        <div
          className={[styles.mono, row.archived ? styles.archivedRow : null]
            .filter(Boolean)
            .join(" ")}
        >
          {row.numero ?? "—"}
          {row.consomme && <span className={styles.archivedTag}>{t("usedTag")}</span>}
        </div>
      ),
    },
    {
      key: "paperGrade",
      header: t("rolls.columns.grade"),
      width: "100px",
      cell: (row) => <span className={styles.text}>{row.paperGrade ?? "—"}</span>,
    },
    {
      key: "grammage",
      header: t("rolls.columns.grammage"),
      width: "90px",
      numeric: true,
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
      width: "115px",
      numeric: true,
      sortKey: "poidsRestant",
      cell: (row) => (
        <span className={styles.date}>
          {kg.format(row.poidsRestant)}
          {row.poids ? ` / ${kg.format(row.poids)}` : ""} kg
        </span>
      ),
    },
    {
      key: "receivedAt",
      header: t("rolls.columns.received"),
      width: "120px",
      sortKey: "receivedAt",
      // A reel is pending until someone scans it on the floor; the warehouse
      // reads this column to see what is left on the pallet.
      cell: (row) =>
        row.receivedAt ? (
          <span className={styles.date}>{day().format(new Date(row.receivedAt))}</span>
        ) : (
          <span className={styles.statusWarning}>{t("rolls.detail.pending")}</span>
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

  if (rollsQuery.isPending) return <p className={styles.muted}>{t("shipments.reels.loading")}</p>;

  if (rollsQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {rollsQuery.error.message}
      </p>
    );
  }

  return (
    <DataTable
      rows={rollsQuery.data.rows}
      columns={columns}
      rowKey={(row) => row.id}
      // No facet chips: the declaration has no facets, so a summed "all" count
      // would read 0. See `shipmentRollListDeclaration`.
      total={rollsQuery.data.total}
      pageCount={rollsQuery.data.pageCount}
      loading={rollsQuery.isFetching}
      state={tableState}
      onStateChange={onStateChange}
      searchPlaceholder={t("shipments.reels.searchPlaceholder")}
      emptyMessage={t("shipments.reels.emptyMessage")}
    />
  );
}
