"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@repo/api-contract";
import { TableSkeleton } from "@repo/ui/skeleton";
import { DataTable, type Column, type DataTableState } from "@repo/ui/data-table";
import type { ExportShipmentFacet, ExportShipmentSortKey } from "api/src/shipment/shipment.list";
import { formatDay } from "../invoices/invoice-ui";
import { formatInt, ShipmentStatusBadge } from "./shipment-ui";
import { useTRPC } from "../trpc/client";
import styles from "../records/records.module.css";
import shipments from "./shipments.module.css";

/*
 * From `Shipments v3.dc.html`. Five columns rather than nine: the handoff
 * folds the number, export date and client into one cell, pairs the parcel
 * count with a load badge and the orders it covers, turns the packing list
 * and the customs declaration into chips, and makes the whole row the click
 * target instead of carrying an "Open" button.
 *
 * All four of the handoff's stat tiles are built. Three come from the facet
 * counts the server already computes; "parcels out" is a server-side sum over
 * `ShipmentLine.quantity` for SHIPPED rows, since parcels live on the lines
 * and not on a header column.
 *
 * Two things in the handoff are deliberately not built:
 *
 * - Its month group bands. `DataTable` has no grouping slot, and a band over
 *   one page would imply it covers the month — it does not, it covers ten
 *   rows. Sorting by export date already puts a month together.
 * - Its "Export list" button. Nothing backs it, and a button that does
 *   nothing is worse than no button. Same call as the Goods receipts import.
 */

interface ShipmentsTableState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: ExportShipmentSortKey;
  filter: "all" | ExportShipmentFacet;
}

const INITIAL_STATE: ShipmentsTableState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  sortBy: "exportDate",
  sortDir: "desc",
  filter: "all",
};

export function ShipmentsTable() {
  const t = useTranslations("shipments");
  const trpc = useTRPC();
  const router = useRouter();
  const [tableState, setTableState] = useState<ShipmentsTableState>(INITIAL_STATE);

  const shipmentsQuery = useQuery({
    ...trpc.shipment.list.queryOptions(tableState),
    placeholderData: (prev) => prev,
  });

  type ShipmentRow = NonNullable<typeof shipmentsQuery.data>["rows"][number];

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) =>
      setTableState((current) => ({ ...current, ...next }) as ShipmentsTableState),
    [],
  );

  const pageCount = shipmentsQuery.data?.pageCount ?? 1;
  if (!shipmentsQuery.isFetching && tableState.page > pageCount) {
    setTableState((current) => ({ ...current, page: pageCount }));
  }

  /**
   * One document's chip. Three states, because the customs declaration has
   * three: a number and a scan (ok), a number but no scan yet (part — the
   * declaration comes back days after the truck left), or nothing. The
   * packing list has no middle state, so it passes `part` as false.
   */
  const docChip = (
    key: string,
    ok: boolean,
    part: boolean,
    labels: { ok: string; part: string; none: string },
    titles: { ok: string; part: string; none: string },
  ) => {
    const tone = ok ? "Ok" : part ? "Part" : "None";
    return (
      <span
        key={key}
        title={ok ? titles.ok : part ? titles.part : titles.none}
        className={[shipments.docChip, shipments[`docChip${tone}`]].filter(Boolean).join(" ")}
      >
        <i
          className={[
            shipments.docDot,
            ok ? shipments.docDotOk : part ? shipments.docDotPart : null,
          ]
            .filter(Boolean)
            .join(" ")}
          aria-hidden="true"
        />
        {ok ? labels.ok : part ? labels.part : labels.none}
      </span>
    );
  };

  const columns: ReadonlyArray<Column<ShipmentRow>> = [
    {
      key: "numero",
      header: t("columns.shipment"),
      width: "minmax(200px,1.6fr)",
      sortKey: "numero",
      cell: (row) => (
        <span className={shipments.rowCell}>
          <i
            className={[
              shipments.dot,
              row.status === "SHIPPED" ? shipments.dotShipped : shipments.dotDraft,
            ]
              .filter(Boolean)
              .join(" ")}
            aria-hidden="true"
          />
          <span className={shipments.rowText}>
            <span className={shipments.rowTop}>
              {/* A draft has no number until it ships. */}
              <span className={shipments.rowNo}>
                {row.numero ?? <span className={styles.muted}>{t("draft")}</span>}
              </span>
              <span className={shipments.rowMeta}>{formatDay(row.exportDate) ?? ""}</span>
            </span>
            <span
              className={[shipments.rowClient, row.client.active ? null : styles.archivedRow]
                .filter(Boolean)
                .join(" ")}
            >
              {row.client.name}
              {!row.client.active && (
                <span className={styles.archivedTag}>{t("archivedShort")}</span>
              )}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "content",
      header: t("columns.parcels"),
      width: "150px",
      cell: (row) => (
        <span>
          <span className={shipments.contentTop}>
            <span className={shipments.parcels}>
              {t("parcelCount", { count: row.parcels })}
            </span>
            <span
              className={[
                shipments.load,
                row.kind === "PARTIAL" ? shipments.loadPartial : shipments.loadComplete,
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {t(`load.${row.kind}`)}
            </span>
          </span>
          {/* One order: name it. Several: say how many, with the pieces they
              come to — the packing-list figure, not a money total. */}
          <span className={shipments.rowMeta}>
            {row.orderNumeros.length === 1
              ? row.orderNumeros[0]
              : row.orderNumeros.length > 1
                ? [
                    t("content.orders", { count: row.orderNumeros.length }),
                    row.units === null
                      ? null
                      : `${formatInt(row.units)} ${row.unit === "KILOGRAMS" ? t("units.kg") : t("units.pcs")}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : ""}
          </span>
        </span>
      ),
    },
    {
      key: "invoice",
      header: t("columns.invoice"),
      width: "120px",
      cell: (row) =>
        row.salesInvoice?.numero ? (
          <span className={styles.mono}>{row.salesInvoice.numero}</span>
        ) : (
          <span className={styles.absent} />
        ),
    },
    {
      key: "documents",
      header: t("columns.customs"),
      // Wider than the handoff's 196px: its English labels ("Customs part")
      // are shorter than the French ones ("Douane partielle"), which need
      // 253px for the pair. At 196px the two chips wrapped onto a second
      // line and every French row grew to 59px. French is the binding
      // language here, so the column is sized for it.
      width: "minmax(265px,1fr)",
      cell: (row) => (
        <span className={shipments.docChips}>
          {docChip(
            "packing",
            row.packingListNumber !== null,
            false,
            {
              ok: t("docChips.packingOk"),
              part: t("docChips.packingOk"),
              none: t("docChips.packingNone"),
            },
            {
              ok: t("docChips.packingOkTitle"),
              part: t("docChips.packingOkTitle"),
              none: t("docChips.packingNoneTitle"),
            },
          )}
          {docChip(
            "customs",
            row.customsDeclarationNumber !== null && row.customsDeclarationDocument !== null,
            row.customsDeclarationNumber !== null,
            {
              ok: t("docChips.customsOk"),
              part: t("docChips.customsPart"),
              none: t("docChips.customsNone"),
            },
            {
              ok: t("docChips.customsOkTitle"),
              part: t("docChips.customsPartTitle"),
              none: t("docChips.customsNoneTitle"),
            },
          )}
        </span>
      ),
    },
    {
      key: "status",
      header: t("columns.status"),
      width: "120px",
      cell: (row) => <ShipmentStatusBadge status={row.status} />,
    },
    {
      key: "chevron",
      header: "",
      width: "28px",
      cell: () => (
        <span className={shipments.chevron} aria-hidden="true">
          ›
        </span>
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

  const facets = shipmentsQuery.data.facetCounts;
  const kpi = (label: string, value: string, unit: string, alert?: boolean) => (
    <div className={shipments.kpi} key={label}>
      <div className={shipments.kpiLabel}>{label}</div>
      <div className={shipments.kpiRow}>
        <span
          className={[shipments.kpiValue, alert ? shipments.kpiValueAlert : null]
            .filter(Boolean)
            .join(" ")}
        >
          {value}
        </span>
        <span className={shipments.kpiUnit}>{unit}</span>
      </div>
    </div>
  );

  return (
    <>
      <div className={shipments.kpis}>
        {kpi(t("kpis.shipped"), formatInt(facets.shipped ?? 0), t("kpis.shippedUnit"))}
        {kpi(t("kpis.drafts"), formatInt(facets.draft ?? 0), t("kpis.draftsUnit"))}
        {kpi(
          t("kpis.parcelsOut"),
          formatInt(shipmentsQuery.data.aggregates?.shippedParcels ?? 0),
          t("kpis.parcelsOutUnit"),
        )}
        {kpi(
          t("kpis.missingDocs"),
          formatInt(facets.missingCustoms ?? 0),
          t("kpis.missingDocsUnit"),
          (facets.missingCustoms ?? 0) > 0,
        )}
      </div>

      <DataTable
        rows={shipmentsQuery.data.rows}
        columns={columns}
        rowKey={(row) => row.id}
        onRowClick={(row) => router.push(`/shipments/${row.id}`)}
        filters={[
          { key: "draft", label: t("facets.draft") },
          { key: "shipped", label: t("facets.shipped") },
          { key: "missingCustoms", label: t("facets.missingCustoms") },
        ]}
        facetCounts={facets}
        total={shipmentsQuery.data.total}
        pageCount={shipmentsQuery.data.pageCount}
        loading={shipmentsQuery.isFetching}
        state={tableState}
        onStateChange={onStateChange}
        searchPlaceholder={t("searchPlaceholder")}
        emptyMessage={t("empty")}
      />
    </>
  );
}
