"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import {
  assetUrl,
  canAccess,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { DataTable, type Column, type DataTableState } from "@repo/ui/data-table";
import { Thumbnail } from "@repo/ui/thumbnail";
// Type-only, the same rule as `AppRouter`: the list vocabulary is server-side
// and must never be pulled into the browser bundle.
import type { ProductOrderSortKey } from "api/src/product/product.list";
import { useCurrentUser } from "../../auth/use-auth";
import { useTRPC } from "../../trpc/client";
import { dateFormat } from "../../../i18n/formats";
import { Row, Val } from "../../records/record-ui";
import styles from "../../records/records.module.css";
import grid from "../products.module.css";

const int = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const day = () => dateFormat({ dateStyle: "medium" });

interface OrdersState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: ProductOrderSortKey;
  filter: "all";
}

const INITIAL_ORDERS: OrdersState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  sortBy: "createdAt",
  sortDir: "desc",
  filter: "all",
};

/**
 * What a product is and what has been made from it.
 *
 * `/products/[id]` was the edit form until 2026-09-18; the form moved to
 * `/[id]/edit` and this took its place, matching every other module here —
 * stock, orders and clients all read at `/[id]` and edit at `/[id]/edit`.
 *
 * The orders are their own paged query (`product.ordersForProduct`) rather
 * than a nested select on `byId`, for the reason `rollsForShipment` gives:
 * this one searches, sorts and pages, and embedding the set would fetch
 * every order on every page view to render ten.
 */
export function ProductDetail({ id }: { id: string }) {
  const t = useTranslations("products");
  const common = useTranslations("common");
  const enums = useTranslations("enums");
  const trpc = useTRPC();
  const { user: me } = useCurrentUser();
  const canWrite = me ? canAccess(me.role, "ADMIN") : false;
  const [ordersState, setOrdersState] = useState<OrdersState>(INITIAL_ORDERS);

  const productQuery = useQuery(trpc.product.byId.queryOptions({ id }));
  const ordersQuery = useQuery({
    ...trpc.product.ordersForProduct.queryOptions({ ...ordersState, productId: id }),
    placeholderData: (prev) => prev,
  });

  // A union: ADMIN and above get rows with `orderTotal`, everyone else rows
  // without a money column at all (`ProductService.ordersForProduct`).
  type OrderRow = NonNullable<typeof ordersQuery.data>["rows"][number];
  type PricedOrderRow = Extract<OrderRow, { orderTotal: unknown }>;
  const isPriced = (row: OrderRow): row is PricedOrderRow => "orderTotal" in row;

  const onOrdersState = useCallback(
    (next: Partial<DataTableState>) =>
      setOrdersState((current) => ({ ...current, ...next }) as OrdersState),
    [],
  );

  if (productQuery.isPending) return <p className={styles.muted}>{t("loading")}</p>;

  if (productQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {productQuery.error.message}
      </p>
    );
  }

  const p = productQuery.data;
  /** `w×L(×g)`: SOUS_PLAT has no gusset, so the third figure is omitted. */
  const dims =
    p.typeSac === "SOUS_PLAT"
      ? `${p.widthCm}×${p.lengthCm}`
      : `${p.widthCm}×${p.lengthCm}×${p.gussetCm ?? 0}`;
  // The same rule the list flags with: a spec missing any of these cannot be
  // priced, and 11 migrated products carry a grammage of 0.
  const incomplete = p.widthCm <= 0 || p.lengthCm <= 0 || p.grammage <= 0;

  // Keyed off the payload, not the role: the column exists only when the
  // server actually sent the figure.
  const priced = (ordersQuery.data?.rows ?? []).some(isPriced);

  const columns: ReadonlyArray<Column<OrderRow>> = [
    {
      key: "numero",
      header: t("orders.columns.order"),
      width: "minmax(110px,1fr)",
      sortKey: "numero",
      cell: (row) => (
        <Link className={styles.inlineLink} href={`/orders/${row.id}`}>
          {row.numero}
        </Link>
      ),
    },
    {
      key: "client",
      header: t("orders.columns.client"),
      width: "minmax(110px,1fr)",
      cell: (row) =>
        row.client ? (
          <span className={styles.text}>{row.client.name}</span>
        ) : (
          <span className={styles.absent} />
        ),
    },
    {
      key: "status",
      header: t("orders.columns.status"),
      width: "130px",
      sortKey: "status",
      cell: (row) => (
        <span className={styles.text}>{enums(`orderStatus.${row.status}`)}</span>
      ),
    },
    {
      key: "quantite",
      header: t("orders.columns.quantity"),
      width: "110px",
      numeric: true,
      sortKey: "quantite",
      cell: (row) => (
        <span className={styles.date}>
          {int.format(row.quantite)} {row.quantityUnit === "KILOGRAMS" ? "kg" : "pcs"}
        </span>
      ),
    },
    ...(priced
      ? [
          {
            key: "orderTotal",
            header: t("orders.columns.total"),
            width: "110px",
            numeric: true,
            cell: (row: OrderRow) =>
              isPriced(row) && row.orderTotal !== null ? (
                <span className={styles.date}>{money.format(row.orderTotal)}</span>
              ) : (
                <span className={styles.absent} />
              ),
          } satisfies Column<OrderRow>,
        ]
      : []),
    {
      key: "createdAt",
      header: t("orders.columns.created"),
      width: "120px",
      sortKey: "createdAt",
      cell: (row) => (
        <span className={styles.date}>{day().format(new Date(row.createdAt))}</span>
      ),
    },
  ];

  return (
    <>
      {/* The product's own identity line, as the reel detail carries one. */}
      <div className={grid.identity}>
        <Thumbnail size="md" src={assetUrl(p.images[0] ?? null)} />
        <div className={grid.identityText}>
          <div className={grid.identityName}>
            {p.name}
            {!p.active && <span className={styles.archivedTag}>{t("table.archivedTag")}</span>}
            {incomplete && <span className={styles.flag}>{t("table.incompleteTag")}</span>}
          </div>
          <div className={grid.identityMeta}>
            {p.client ? p.client.name : t("table.shared")} · {enums(`typeSac.${p.typeSac}`)} ·{" "}
            {dims} cm · {p.grammage} g/m²
          </div>
        </div>
        {canWrite && (
          <Link href={`/products/${id}/edit`}>
            <Button variant="primary">{common("edit")}</Button>
          </Link>
        )}
      </div>

      <div className={styles.detailGrid}>
        <section className={styles.detailPanel}>
          <h2 className={styles.detailTitle}>{t("detail.specPanel")}</h2>
          <Row label={t("table.type")}>{enums(`typeSac.${p.typeSac}`)}</Row>
          <Row label={t("detail.width")}><Val value={p.widthCm} suffix="cm" /></Row>
          <Row label={t("detail.length")}><Val value={p.lengthCm} suffix="cm" /></Row>
          {p.typeSac !== "SOUS_PLAT" && (
            <Row label={t("detail.gusset")}><Val value={p.gussetCm} suffix="cm" /></Row>
          )}
          <Row label={t("table.grammage")}><Val value={p.grammage} suffix="g/m²" /></Row>
          <Row label={t("detail.paper")}>
            <Val value={p.paperType ? enums(`paperType.${p.paperType}`) : null} />
          </Row>
          <Row label={t("table.handle")}>
            {p.hasHandle
              ? t("table.handleYes", { weight: p.handleWeightG ?? 0 })
              : t("table.handleNo")}
          </Row>
        </section>

        <section className={styles.detailPanel}>
          <h2 className={styles.detailTitle}>{t("detail.usagePanel")}</h2>
          <Row label={t("detail.orderCount")}>{int.format(p.orderCount)}</Row>
          <Row label={t("detail.client")}>
            {p.client ? (
              <Link className={styles.inlineLink} href={`/clients/${p.client.id}`}>
                {p.client.name}
              </Link>
            ) : (
              t("table.shared")
            )}
          </Row>
          <Row label={t("detail.created")}>
            <Val value={day().format(new Date(p.createdAt))} />
          </Row>
          <Row label={t("detail.status")}>
            {p.active ? t("detail.statusActive") : t("detail.statusArchived")}
          </Row>
        </section>
      </div>

      {/*
        The orders made from this spec. Its own paged query, so a product with
        many orders pages rather than rendering them all — and searching a
        number here does not reload the product above it.
      */}
      <section className={grid.ordersSection}>
        <h2 className={styles.detailTitle}>
          {t("detail.ordersPanel", { count: p.orderCount })}
        </h2>
        {ordersQuery.isError ? (
          <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
            {ordersQuery.error.message}
          </p>
        ) : (
          <DataTable
            rows={ordersQuery.data?.rows ?? []}
            columns={columns}
            rowKey={(row) => row.id}
            total={ordersQuery.data?.total ?? 0}
            pageCount={ordersQuery.data?.pageCount ?? 1}
            pending={ordersQuery.isPending}
            loading={ordersQuery.isFetching}
            state={ordersState}
            onStateChange={onOrdersState}
            density="dense"
            searchPlaceholder={t("detail.searchOrders")}
            emptyMessage={t("detail.noOrders")}
          />
        )}
      </section>
    </>
  );
}
