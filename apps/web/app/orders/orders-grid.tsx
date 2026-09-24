"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useState, type CSSProperties } from "react";
import {
  assetUrl,
  canAccess,
  ordersAreScopedFor,
  PAGE_SIZES,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { TableSkeleton } from "@repo/ui/skeleton";
import { DataTable, type DataTableState } from "@repo/ui/data-table";
import { Dialog } from "@repo/ui/dialog";
// Type-only import, the same rule as `AppRouter`: the module's list vocabulary
// lives server-side, so the web build must never pull in the module itself.
import type { OrderFacet, OrderSortKey } from "api/src/order/order.list";
import { useCurrentUser } from "../auth/use-auth";
import { useTRPC } from "../trpc/client";
import { OrderStatusBadge } from "./order-status";
import records from "../records/records.module.css";
import styles from "./orders.module.css";

interface OrdersGridState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: OrderSortKey;
  filter: "all" | OrderFacet;
}

const INITIAL_STATE: OrdersGridState = {
  page: 1,
  // A card grid fills three or four columns; ten cards left a ragged last
  // row on every page. Twenty-five is a screenful and a half.
  pageSize: 25,
  search: "",
  sortBy: "numero",
  sortDir: "asc",
  filter: "all",
};

/** Thousands separators, so 52702 reads as 52 702 at a glance. */
const int = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/**
 * Job orders as a progress grid: one card per order, the produced-against-
 * ordered ring the loudest element on each. Best when the daily question is
 * "how far along is each order".
 *
 * The toolbar, pager and empty state are DataTable's; only the body is ours.
 */
export function OrdersGrid() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const t = useTranslations("orders");
  const common = useTranslations("common");
  const enums = useTranslations("enums");
  const { user: me } = useCurrentUser();
  const canWrite = me ? canAccess(me.role, "ADMIN") : false;
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<OrdersGridState>(INITIAL_STATE);

  const ordersQuery = useQuery({
    ...trpc.order.list.queryOptions(state),
    placeholderData: (prev) => prev,
  });

  type OrderRow = NonNullable<typeof ordersQuery.data>["rows"][number];

  const [pending, setPending] = useState<OrderRow | null>(null);

  const setActive = useMutation(
    trpc.order.setActive.mutationOptions({
      onSuccess: () => {
        setPending(null);
        return queryClient.invalidateQueries({
          queryKey: trpc.order.list.queryKey(),
        });
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) =>
      setState((current) => ({ ...current, ...next }) as OrdersGridState),
    [],
  );

  const pageCount = ordersQuery.data?.pageCount ?? 1;
  if (!ordersQuery.isFetching && state.page > pageCount) {
    setState((current) => ({ ...current, page: pageCount }));
  }

  if (ordersQuery.isPending) return <TableSkeleton />;

  if (ordersQuery.isError) {
    return (
      <p
        className={[records.notice, records.error].filter(Boolean).join(" ")}
        role="alert"
      >
        {ordersQuery.error.message}
      </p>
    );
  }

  /** One order. */
  function OrderCard({ row }: { row: OrderRow }) {
    const p = row.product;
    const dims =
      p.typeSac === "SOUS_PLAT"
        ? `${p.widthCm}×${p.lengthCm}`
        : `${p.widthCm}×${p.lengthCm}×${p.gussetCm ?? 0}`;
    const unit = row.quantityUnit === "KILOGRAMS" ? "kg" : "pcs";
    // Capped at 100: a run can exceed the order, and the ring should read
    // "done", not spill past its own circle.
    const pct =
      row.quantite > 0
        ? Math.min(100, Math.round((row.produced / row.quantite) * 100))
        : 0;
    const ringStyle = {
      "--pct": pct,
      "--ring": pct >= 100 ? "var(--bp-success)" : "var(--bp-orange-500)",
    } as CSSProperties;
    const photo = assetUrl(p.images[0]);

    return (
      <article
        className={[styles.card, row.active ? null : styles.cardArchived]
          .filter(Boolean)
          .join(" ")}
      >
        <Link
          href={`/orders/${row.id}`}
          className={styles.cardLink}
          aria-label={t("grid.openOrder", { numero: row.numero, product: p.name })}
        />

        <div className={styles.photo}>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" loading="lazy" />
          ) : (
            <span>{t("grid.noPhoto")}</span>
          )}
        </div>

        <div className={styles.body}>
          <div className={styles.head}>
            <span className={styles.title}>
              <span className={styles.no}>
                {row.numero}
                {!row.active && (
                  <span className={records.archivedTag}>{t("archTag")}</span>
                )}
              </span>
              <span className={styles.product}>{p.name}</span>
              <span className={styles.client}>
                {row.client ? row.client.name : t("noClient")}
              </span>
            </span>
            <span className={styles.status}>
              <OrderStatusBadge kind={row.kind} status={row.status} />
            </span>
          </div>

          <div className={styles.progress}>
            <span
              className={styles.ring}
              style={ringStyle}
              role="meter"
              aria-label={t("grid.producedAgainstOrdered")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <span className={styles.ringInner}>{pct}%</span>
            </span>
            <span className={styles.figures}>
              <span className={styles.figureLabel}>{t("grid.produced")}</span>
              <span className={styles.figure}>{int.format(row.produced)}</span>
              <span className={styles.figureOf}>
                {t("grid.ofOrdered", { quantity: int.format(row.quantite), unit })}
              </span>
            </span>
          </div>

          <div className={styles.foot}>
            <span className={styles.chipSpec}>
              {dims}
              {p.hasHandle ? ` · ${t("grid.handleChip")}` : ""}
            </span>
            <span className={styles.chip}>{p.grammage} g</span>
            <span
              className={[styles.chip, styles.chipText]
                .filter(Boolean)
                .join(" ")}
            >
              {enums(`typeSac.${p.typeSac}`)}
            </span>
            {canWrite && (
              <span className={styles.cardActions}>
                <Button
                  size="dense"
                  variant={row.active ? "danger" : "secondary"}
                  onClick={() => {
                    setError(null);
                    setPending(row);
                  }}
                >
                  {row.active ? common("archive") : common("restore")}
                </Button>
              </span>
            )}
          </div>
        </div>
      </article>
    );
  }

  return (
    <>
      {error && (
        <p
          className={[records.notice, records.error].filter(Boolean).join(" ")}
          role="alert"
        >
          {error}
        </p>
      )}

      <DataTable
        rows={ordersQuery.data.rows}
        columns={[]}
        rowKey={(row) => row.id}
        renderBody={(rows) => (
          <div className={styles.grid}>
            {rows.map((row) => (
              <OrderCard key={row.id} row={row} />
            ))}
          </div>
        )}
        // Order matches the pipeline: quotes first, then the three module
        // inboxes in the sequence work actually flows through, then the two
        // terminal buckets. No chips for a scoped role — the server only ever
        // hands PRODUCTION the in-production slice, so every other chip would
        // read a permanent 0.
        filters={
          me && ordersAreScopedFor(me.role)
            ? []
            : [
                { key: "quotes", label: t("filters.quotes") },
                { key: "draft", label: t("filters.draft") },
                { key: "inProduction", label: t("filters.inProduction") },
                { key: "invoicing", label: t("filters.invoicing") },
                { key: "completed", label: t("filters.completed") },
                { key: "archived", label: t("filters.archived") },
              ]
        }
        facetCounts={ordersQuery.data.facetCounts}
        total={ordersQuery.data.total}
        pageCount={ordersQuery.data.pageCount}
        loading={ordersQuery.isFetching}
        state={state}
        onStateChange={onStateChange}
        searchPlaceholder={t("grid.searchPlaceholder")}
        emptyMessage={t("grid.empty")}
      />

      <Dialog
        open={pending !== null}
        title={pending?.active ? t("grid.archiveTitle") : t("grid.restoreTitle")}
        confirmLabel={pending?.active ? common("archive") : common("restore")}
        destructive={pending?.active ?? false}
        busy={setActive.isPending}
        onConfirm={() =>
          pending &&
          setActive.mutate({ id: pending.id, active: !pending.active })
        }
        onClose={() => !setActive.isPending && setPending(null)}
      >
        {pending?.active
          ? t.rich("grid.archiveBody", {
              numero: pending.numero,
              strong: (chunks) => <strong>{chunks}</strong>,
            })
          : t.rich("grid.restoreBody", {
              numero: pending?.numero ?? "",
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
      </Dialog>
    </>
  );
}
