"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@repo/api-contract";
import { DataTable, type Column, type DataTableState } from "@repo/ui/data-table";
import { Tabs } from "@repo/ui/tabs";
import { TableSkeleton } from "@repo/ui/skeleton";
import { useTRPC } from "../../../../trpc/client";
import { dateFormat } from "../../../../../i18n/formats";
import records from "../../../../records/records.module.css";
import styles from "../../stocktake.module.css";

type Side = "counted" | "missing" | "unexpected";

interface VarianceState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  filter: "all";
}

const INITIAL_STATE: VarianceState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  sortDir: "asc",
  filter: "all",
};

const stamp = (value: string | Date | null) =>
  value ? dateFormat({ dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";

type Reel = {
  id: string;
  numero: string | null;
  paperGrade: string | null;
  grammage: number | null;
  laize: number | null;
  qrCodeUrl: string | null;
  importShipment: { id: string; numeroImport: string } | null;
};

type Row =
  | Reel
  | { id: string; scannedAt: string | Date; unexpected: boolean; paperRoll: Reel };

const reelOf = (row: Row): Reel => ("paperRoll" in row ? row.paperRoll : row);

/**
 * The variance report: counted, missing and unexpected.
 *
 * Read-only by decision. A count records what was seen; correcting stock is a
 * separate manual job on the reel's own page, so there are no action buttons
 * here however tempting a "mark consumed" would be.
 *
 * The three sides are not facets of one set — "missing" pages over PaperRoll
 * while the other two page over StockCountLine — so they are tabs driving a
 * `side` discriminator, and the table renders no facet chips at all.
 */
export function VarianceReport({ countId }: { countId: string }) {
  const t = useTranslations("stock");
  const trpc = useTRPC();

  const [side, setSide] = useState<Side>("missing");
  const [tableState, setTableState] = useState<VarianceState>(INITIAL_STATE);

  const summaryQuery = useQuery(trpc.inventory.summary.queryOptions({ id: countId }));
  const varianceQuery = useQuery({
    ...trpc.inventory.variance.queryOptions({ ...tableState, id: countId, side }),
    placeholderData: (prev) => prev,
  });

  const columns: ReadonlyArray<Column<Row>> = [
    {
      key: "reel",
      header: t("stocktake.colReel"),
      width: "minmax(180px, 1.2fr)",
      cell: (row) => {
        const reel = reelOf(row);
        return (
          <span className={styles.reelCell}>
            <Link className={styles.reelNumero} href={`/stock/${reel.id}`}>
              {reel.numero ?? "—"}
            </Link>
            <span className={styles.reelMeta}>
              {[
                reel.paperGrade,
                reel.grammage ? `${reel.grammage} g/m²` : null,
                reel.laize ? `${reel.laize} mm` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        );
      },
    },
    {
      key: "shipment",
      header: t("stocktake.colShipment"),
      width: "minmax(140px, 1fr)",
      cell: (row) => {
        const reel = reelOf(row);
        return reel.importShipment ? (
          <Link href={`/stock/shipments/${reel.importShipment.id}`}>
            {reel.importShipment.numeroImport}
          </Link>
        ) : (
          "—"
        );
      },
    },
    side === "missing"
      ? {
          key: "label",
          header: t("stocktake.colLabel"),
          width: "160px",
          cell: (row) =>
            reelOf(row).qrCodeUrl ? "✓" : (
              <span className={records.statusBadge + " " + records.statusWarning}>
                {t("stocktake.noLabel")}
              </span>
            ),
        }
      : {
          key: "scannedAt",
          header: t("stocktake.colScannedAt"),
          width: "180px",
          cell: (row) => ("scannedAt" in row ? stamp(row.scannedAt) : "—"),
        },
  ];

  if (summaryQuery.isPending) return <TableSkeleton />;

  if (summaryQuery.isError) {
    return (
      <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
        {summaryQuery.error.message}
      </p>
    );
  }

  const summary = summaryQuery.data;

  return (
    <>
      <div className={styles.tiles}>
        <div className={styles.tile}>
          <span className={styles.tileLabel}>{t("stocktake.sideCounted")}</span>
          <span className={[styles.tileValue, styles.tileValueDone].join(" ")}>
            {summary.counted}
          </span>
        </div>
        <div className={styles.tile}>
          <span className={styles.tileLabel}>{t("stocktake.sideMissing")}</span>
          <span className={[styles.tileValue, styles.tileValueWarn].join(" ")}>
            {summary.missing}
          </span>
        </div>
        <div className={styles.tile}>
          <span className={styles.tileLabel}>{t("stocktake.sideUnexpected")}</span>
          <span className={styles.tileValue}>{summary.unexpected}</span>
        </div>
        <div className={styles.tile}>
          <span className={styles.tileLabel}>{t("stocktake.openedBy")}</span>
          <span className={styles.reelMeta}>{summary.count.openedBy.name}</span>
          <span className={styles.reelMeta}>{stamp(summary.count.openedAt)}</span>
        </div>
      </div>

      <p className={styles.sideNote}>{t("stocktake.readOnly")}</p>

      <Tabs
        tabs={[
          { key: "missing", label: `${t("stocktake.sideMissing")} (${summary.missing})` },
          { key: "counted", label: `${t("stocktake.sideCounted")} (${summary.counted})` },
          {
            key: "unexpected",
            label: `${t("stocktake.sideUnexpected")} (${summary.unexpected})`,
          },
        ]}
        value={side}
        label={t("stocktake.reportTitle")}
        onChange={(next) => {
          setSide(next as Side);
          // A different side is a different result set: page 3 of "missing"
          // is not page 3 of "counted".
          setTableState((prev) => ({ ...prev, page: 1, search: "" }));
        }}
      />

      <p className={styles.sideNote}>
        {side === "missing"
          ? t("stocktake.sideMissingText")
          : side === "counted"
            ? t("stocktake.sideCountedText")
            : t("stocktake.sideUnexpectedText")}
      </p>

      {varianceQuery.isPending ? (
        <TableSkeleton />
      ) : varianceQuery.isError ? (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {varianceQuery.error.message}
        </p>
      ) : (
        <DataTable<Row>
          rows={varianceQuery.data.rows}
          columns={columns}
          rowKey={(row) => row.id}
          total={varianceQuery.data.total}
          pageCount={varianceQuery.data.pageCount}
          loading={varianceQuery.isFetching}
          state={tableState}
          onStateChange={(next) =>
            setTableState((prev) => ({
              ...prev,
              ...next,
              // `next.pageSize` is a plain `number` on DataTableState; the
              // server's input only accepts a PAGE_SIZES literal, and the
              // table never emits anything else.
              pageSize: (next.pageSize ?? prev.pageSize) as VarianceState["pageSize"],
              // This list declares no facets, so "all" is the only filter the
              // table can ever emit.
              filter: (next.filter ?? prev.filter) as VarianceState["filter"],
              page: "page" in next ? (next.page ?? 1) : 1,
            }))
          }
          density="dense"
          searchable
          emptyMessage={t("stocktake.emptySide")}
        />
      )}
    </>
  );
}
