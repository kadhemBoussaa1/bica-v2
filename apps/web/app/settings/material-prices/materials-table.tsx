"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { DataTable, type Column, type DataTableState } from "@repo/ui/data-table";
import { TableSkeleton } from "@repo/ui/skeleton";
import { formatDay } from "../../../i18n/formats";
import records from "../../records/records.module.css";
import { useTRPC } from "../../trpc/client";
import settings from "../settings.module.css";
import {
  formatKiloPrice,
  MaterialTypeBadge,
  useMaterialUse,
  type MaterialRow,
} from "./material-ui";
import { useMaterials } from "./materials-provider";
import styles from "./materials.module.css";

/**
 * The material module's half of the table vocabulary — see
 * `apps/api/src/material/material.list.ts`, which the server enforces.
 */
interface MaterialsTableState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: "label" | "code" | "type";
  filter: "all" | "paper" | "glue" | "archived";
}

const INITIAL_STATE: MaterialsTableState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  sortBy: "label",
  sortDir: "asc",
  filter: "all",
};

/** The header's primary action: opens the create dialog the provider hosts. */
export function NewMaterialButton() {
  const t = useTranslations("materials");
  const { create } = useMaterials();
  return (
    <Button variant="primary" onClick={create}>
      {t("newMaterial")}
    </Button>
  );
}

/**
 * The catalogue: one row per material with what it is for and the price it
 * is at now. A row opens the material — its history, a new price, its edit
 * form — in the provider's dialogs. Mouse-driven, so dense.
 */
export function MaterialsTable() {
  const t = useTranslations("materials");
  const trpc = useTRPC();
  const { open, openId } = useMaterials();
  const describe = useMaterialUse();
  const [tableState, setTableState] = useState<MaterialsTableState>(INITIAL_STATE);

  const listQuery = useQuery({
    ...trpc.material.list.queryOptions(tableState),
    placeholderData: (prev) => prev,
  });

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) =>
      setTableState((current) => ({ ...current, ...next }) as MaterialsTableState),
    [],
  );

  const pageCount = listQuery.data?.pageCount ?? 1;
  if (!listQuery.isFetching && tableState.page > pageCount) {
    setTableState((current) => ({ ...current, page: pageCount }));
  }

  const columns: ReadonlyArray<Column<MaterialRow>> = [
    {
      key: "code",
      header: t("columns.code"),
      width: "minmax(150px,1fr)",
      sortKey: "code",
      cell: (row) => (
        <span className={[records.mono, styles.code].filter(Boolean).join(" ")} title={row.code}>
          {row.code}
        </span>
      ),
    },
    {
      key: "label",
      header: t("columns.material"),
      width: "minmax(180px,1.4fr)",
      sortKey: "label",
      cell: (row) => (
        <span className={styles.material}>
          <span className={records.name}>
            {row.label}
            {!row.active && <span className={records.archivedTag}>{t("archivedTag")}</span>}
          </span>
          {row.supplier && <span className={records.text}>{row.supplier.name}</span>}
        </span>
      ),
    },
    {
      key: "type",
      header: t("columns.type"),
      width: "96px",
      sortKey: "type",
      cell: (row) => <MaterialTypeBadge type={row.type} />,
    },
    {
      key: "use",
      header: t("columns.use"),
      width: "minmax(160px,1.2fr)",
      cell: (row) => <span className={records.text}>{describe(row)}</span>,
    },
    {
      key: "price",
      header: t("columns.price"),
      width: "136px",
      numeric: true,
      cell: (row) =>
        row.currentPrice ? (
          <span className={styles.price}>
            <span className={styles.priceValue}>
              {formatKiloPrice(row.currentPrice.kiloPrice)}
              <span className={styles.priceUnit}>/kg</span>
            </span>
            <span className={styles.since}>
              {t("since", { date: formatDay(row.currentPrice.validFrom) })}
            </span>
          </span>
        ) : (
          <span className={records.muted}>{t("noPrice")}</span>
        ),
    },
    {
      key: "open",
      header: "",
      width: "16px",
      cell: () => (
        <span className={styles.chevron} aria-hidden="true">
          ›
        </span>
      ),
    },
  ];

  if (listQuery.isPending) {
    return <TableSkeleton />;
  }

  if (listQuery.isError) {
    return (
      <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
        {listQuery.error.message}
      </p>
    );
  }

  return (
    <>
      <DataTable
        rows={listQuery.data.rows}
        columns={columns}
        rowKey={(row) => row.id}
        filters={[
          { key: "paper", label: t("filters.paper") },
          { key: "glue", label: t("filters.glue") },
          { key: "archived", label: t("filters.archived") },
        ]}
        facetCounts={listQuery.data.facetCounts}
        total={listQuery.data.total}
        pageCount={listQuery.data.pageCount}
        loading={listQuery.isFetching}
        state={tableState}
        onStateChange={onStateChange}
        onRowClick={(row) => open(row.id)}
        selectedKey={openId}
        density="dense"
        searchPlaceholder={t("searchPlaceholder")}
        emptyMessage={t("emptyMessage")}
        emptyText={t("emptyText")}
      />
      <p className={settings.sectionFoot}>{t("openHint")}</p>
    </>
  );
}
