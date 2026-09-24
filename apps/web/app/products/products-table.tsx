"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { assetUrl, canAccess, DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { TableSkeleton } from "@repo/ui/skeleton";
import { Thumbnail } from "@repo/ui/thumbnail";
import { DataTable, type Column, type DataTableState } from "@repo/ui/data-table";
import { Dialog } from "@repo/ui/dialog";
// Type-only import, the same rule as `AppRouter`: the module's list vocabulary
// lives server-side, so the web build must never pull in the module itself.
import type { ProductFacet, ProductSortKey } from "api/src/product/product.list";
import { useCurrentUser } from "../auth/use-auth";
import { useTRPC } from "../trpc/client";
import styles from "../records/records.module.css";
import grid from "./products.module.css";

interface ProductsTableState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: ProductSortKey;
  filter: "all" | ProductFacet;
}

/**
 * Card or row, from "Products v3.dc.html" — the handoff offers both and lets
 * the user choose. Cards lead with the product's photo, which is what makes a
 * bag recognisable at a glance; rows are what you want when comparing specs
 * down a column. 348 of 355 products carry an image, so the card view has
 * something to show.
 *
 * Not persisted: it is a per-visit preference, and `DataTable` already drops
 * to its own card layout under 900px regardless.
 */
type ProductView = "grid" | "list";

const int = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/** The switch's two buttons, with the handoff's own icon paths. */
const VIEWS: readonly { key: ProductView; icon: string }[] = [
  { key: "grid", icon: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z" },
  { key: "list", icon: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01" },
];

/**
 * The bag type as a badge tone. The handoff gives each type its own colour so
 * a card reads at a glance; `records.module.css` already owns the palette.
 */
const TYPE_TONE: Record<string, string | undefined> = {
  FOND_CARRE: styles.statusActive,
  FOND_V: styles.statusInfo,
  SOUS_PLAT: styles.statusSuccess,
};

/** A header figure: the count, its unit, and an optional tone. */
function Kpi({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: string;
}) {
  return (
    <div className={grid.kpi}>
      <div className={grid.kpiLabel}>{label}</div>
      <div className={grid.kpiFigure}>
        <span className={[grid.kpiValue, tone].filter(Boolean).join(" ")}>{value}</span>
        {unit && <span className={grid.kpiUnit}>{unit}</span>}
      </div>
    </div>
  );
}

/** Rich-text chunk for the dialog bodies: `<strong>…</strong>` in the message. */
const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;

const INITIAL_STATE: ProductsTableState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  sortBy: "name",
  sortDir: "asc",
  filter: "all",
};

export function ProductsTable() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { user: me } = useCurrentUser();
  const t = useTranslations("products");
  const common = useTranslations("common");
  const enums = useTranslations("enums");
  const canWrite = me ? canAccess(me.role, "ADMIN") : false;
  const [error, setError] = useState<string | null>(null);
  const [tableState, setTableState] = useState<ProductsTableState>(INITIAL_STATE);

  const productsQuery = useQuery({
    ...trpc.product.list.queryOptions(tableState),
    placeholderData: (prev) => prev,
  });

  type ProductRow = NonNullable<typeof productsQuery.data>["rows"][number];

  const [pending, setPending] = useState<ProductRow | null>(null);
  // Cards by default: 348 of the 355 products carry a photo, and the photo is
  // what makes a bag recognisable — the spec row tells you the numbers, but
  // not which bag it is. The switch is one click away for the other job.
  const [view, setView] = useState<ProductView>("grid");

  const setActive = useMutation(
    trpc.product.setActive.mutationOptions({
      onSuccess: () => {
        setPending(null);
        return queryClient.invalidateQueries({ queryKey: trpc.product.list.queryKey() });
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) =>
      setTableState((current) => ({ ...current, ...next }) as ProductsTableState),
    [],
  );

  const pageCount = productsQuery.data?.pageCount ?? 1;
  if (!productsQuery.isFetching && tableState.page > pageCount) {
    setTableState((current) => ({ ...current, page: pageCount }));
  }

  /** `w×L(×g)`: SOUS_PLAT has no gusset, so the third figure is omitted. */
  const dims = (row: ProductRow) =>
    row.typeSac === "SOUS_PLAT"
      ? `${row.widthCm}×${row.lengthCm}`
      : `${row.widthCm}×${row.lengthCm}×${row.gussetCm ?? 0}`;

  const columns: ReadonlyArray<Column<ProductRow>> = [
    {
      // The same photo the cards lead with, so switching views does not lose
      // the one thing that identifies a bag on sight. Decorative here: the
      // name sits in the very next column, so an alt text would only repeat
      // it to a screen reader.
      key: "image",
      header: "",
      width: "60px",
      cell: (row) => <Thumbnail size="sm" src={assetUrl(row.images[0] ?? null)} />,
    },
    {
      key: "name",
      header: t("table.product"),
      width: "minmax(160px,1.4fr)",
      sortKey: "name",
      cell: (row) => (
        <div
          className={[styles.name, row.active ? null : styles.archivedRow]
            .filter(Boolean)
            .join(" ")}
        >
          {row.name}
          {!row.active && <span className={styles.archivedTag}>{t("table.archivedTag")}</span>}
          {(row.widthCm <= 0 || row.lengthCm <= 0 || row.grammage <= 0) && (
            <span className={styles.flag}>{t("table.incompleteTag")}</span>
          )}
        </div>
      ),
    },
    {
      key: "client",
      header: t("table.client"),
      width: "minmax(110px,1fr)",
      sortKey: "client",
      cell: (row) =>
        row.client ? (
          <span
            className={[styles.text, row.client.active ? null : styles.archivedRow]
              .filter(Boolean)
              .join(" ")}
          >
            {row.client.name}
            {!row.client.active && <span className={styles.archivedTag}>{t("table.archTag")}</span>}
          </span>
        ) : (
          <span className={styles.text}>{t("table.shared")}</span>
        ),
    },
    {
      key: "typeSac",
      header: t("table.type"),
      width: "100px",
      sortKey: "typeSac",
      cell: (row) => <span className={styles.text}>{enums(`typeSac.${row.typeSac}`)}</span>,
    },
    {
      key: "dims",
      header: t("table.dimensions"),
      width: "115px",
      cell: (row) => <span className={styles.mono}>{dims(row)}</span>,
    },
    {
      key: "grammage",
      header: t("table.grammage"),
      width: "90px",
      numeric: true,
      cell: (row) => <span className={styles.date}>{row.grammage} g</span>,
    },
    {
      key: "handle",
      header: t("table.handle"),
      width: "80px",
      cell: (row) => (
        <span className={styles.text}>
          {row.hasHandle
            ? t("table.handleYes", { weight: row.handleWeightG ?? 0 })
            : t("table.handleNo")}
        </span>
      ),
    },
    {
      key: "orders",
      header: t("table.orders"),
      width: "70px",
      numeric: true,
      cell: (row) => <span className={styles.date}>{row.orderCount}</span>,
    },
    ...(canWrite
      ? [
          {
            key: "actions",
            header: "",
            width: "150px",
            cell: (row: ProductRow) => (
              <div className={styles.actions}>
                <Link href={`/products/${row.id}/edit`}>
                  <Button className={styles.actionBtn}>{common("edit")}</Button>
                </Link>
                <Button
                  variant={row.active ? "danger" : "secondary"}
                  className={styles.actionBtn}
                  onClick={() => {
                    setError(null);
                    setPending(row);
                  }}
                >
                  {row.active ? common("archive") : common("restore")}
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  if (productsQuery.isPending) return <TableSkeleton />;

  if (productsQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {productsQuery.error.message}
      </p>
    );
  }

  const counts = productsQuery.data.facetCounts;
  const rows = productsQuery.data.rows;

  /*
   * The header figures. Drawn from the facet counts the list already
   * returns, so they describe the same snapshot as the page beneath them.
   *
   * The handoff's fourth tile, "Never ordered", is deliberately absent:
   * every one of the 355 products has at least one order (the migration
   * built products FROM orders), so it would read 0 for good. The bag-type
   * split is the figure that actually varies here.
   */
  const initials = (name: string) =>
    name
      .replace(/[^\p{L}\p{N} ]/gu, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0] ?? "")
      .join("")
      .toUpperCase();

  const ProductCard = ({ row }: { row: ProductRow }) => {
    const image = assetUrl(row.images[0] ?? null);
    return (
      <article className={grid.card}>
        <Link href={`/products/${row.id}`} className={grid.cardMedia}>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" loading="lazy" />
          ) : (
            <span className={grid.cardMediaEmpty} aria-hidden="true">
              {initials(row.name)}
            </span>
          )}
          <span
            className={[grid.cardType, styles.statusBadge, TYPE_TONE[row.typeSac]]
              .filter(Boolean)
              .join(" ")}
          >
            {enums(`typeSac.${row.typeSac}`)}
          </span>
        </Link>

        <div className={grid.cardBody}>
          <div>
            <div className={grid.cardName}>
              {row.name}
              {!row.active && <span className={styles.archivedTag}>{t("table.archivedTag")}</span>}
            </div>
            <div className={grid.cardClient}>
              {row.client ? row.client.name : t("table.shared")}
            </div>
          </div>

          <div className={grid.cardChips}>
            <span className={grid.chip}>
              <span className={grid.chipValue}>{dims(row)}</span>
              <span className={grid.chipUnit}>cm</span>
            </span>
            <span className={grid.chip}>
              <span className={grid.chipValue}>{row.grammage}</span>
              <span className={grid.chipUnit}>g/m²</span>
            </span>
            <span
              className={[grid.chipHandle, row.hasHandle ? grid.chipHandleOn : null]
                .filter(Boolean)
                .join(" ")}
            >
              <i className={grid.chipDot} />
              {row.hasHandle
                ? t("table.handleYes", { weight: row.handleWeightG ?? 0 })
                : t("table.handleNo")}
            </span>
          </div>

          <div className={grid.cardFoot}>
            <span className={grid.cardOrders}>
              <span
                className={[grid.cardOrdersValue, row.orderCount > 3 ? grid.cardOrdersMany : null]
                  .filter(Boolean)
                  .join(" ")}
              >
                {row.orderCount}
              </span>
              <span className={grid.cardOrdersLabel}>
                {t("table.ordersLabel", { count: row.orderCount })}
              </span>
            </span>
            {canWrite && (
              <span className={grid.cardActions}>
                <Link href={`/products/${row.id}/edit`}>
                  <Button size="dense">{common("edit")}</Button>
                </Link>
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
  };

  return (
    <>
      {error && (
        <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      <div className={grid.kpis}>
        <Kpi label={t("kpis.products")} value={int.format(counts.all)} unit={t("kpis.specs")} />
        <Kpi
          label={enums("typeSac.FOND_CARRE")}
          value={int.format(counts.FOND_CARRE)}
          unit={t("kpis.products")}
        />
        <Kpi
          label={enums("typeSac.FOND_V")}
          value={int.format(counts.FOND_V)}
          unit={t("kpis.products")}
        />
        <Kpi
          label={enums("typeSac.SOUS_PLAT")}
          value={int.format(counts.SOUS_PLAT)}
          unit={t("kpis.products")}
          tone={grid.kpiHandle}
        />
      </div>

      {/* Card or row — the handoff's own switch. */}
      <div className={grid.viewBar}>
        <div className={grid.viewSwitch} role="group" aria-label={t("view.label")}>
          {VIEWS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={[grid.viewBtn, view === entry.key ? grid.viewBtnOn : null]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setView(entry.key)}
              aria-pressed={view === entry.key}
              aria-label={t(`view.${entry.key}`)}
              title={t(`view.${entry.key}`)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                width="17"
                height="17"
                aria-hidden="true"
              >
                <path d={entry.icon} />
              </svg>
            </button>
          ))}
        </div>
      </div>

      {/*
        One `DataTable` for both views: `renderBody` swaps the row grid for
        the card grid while the toolbar, facet chips, search, skeleton, empty
        state and pager stay exactly as they are. Building a second list
        beside it would have forked all of that — and the page state with it.
      */}
      <DataTable
        rows={rows}
        columns={view === "grid" ? [] : columns}
        renderBody={
          view === "grid"
            ? (cardRows) => (
                <div className={grid.grid}>
                  {cardRows.map((row) => (
                    <ProductCard key={row.id} row={row} />
                  ))}
                </div>
              )
            : undefined
        }
        rowKey={(row) => row.id}
        filters={[
          { key: "FOND_CARRE", label: enums("typeSac.FOND_CARRE") },
          { key: "FOND_V", label: enums("typeSac.FOND_V") },
          { key: "SOUS_PLAT", label: enums("typeSac.SOUS_PLAT") },
          { key: "archived", label: t("table.filterArchived") },
        ]}
        facetCounts={productsQuery.data.facetCounts}
        total={productsQuery.data.total}
        pageCount={productsQuery.data.pageCount}
        loading={productsQuery.isFetching}
        state={tableState}
        onStateChange={onStateChange}
        searchPlaceholder={t("table.searchPlaceholder")}
        emptyMessage={t("table.empty")}
      />

      <Dialog
        open={pending !== null}
        title={pending?.active ? t("table.archiveTitle") : t("table.restoreTitle")}
        confirmLabel={pending?.active ? common("archive") : common("restore")}
        destructive={pending?.active ?? false}
        busy={setActive.isPending}
        onConfirm={() =>
          pending && setActive.mutate({ id: pending.id, active: !pending.active })
        }
        onClose={() => !setActive.isPending && setPending(null)}
      >
        {pending?.active ? (
          <>
            {t.rich("table.archiveBody", { name: pending.name, strong })}
            {pending.orderCount > 0 && (
              <>
                {" "}
                {t.rich("table.archiveBodyUsed", { count: pending.orderCount, strong })}
              </>
            )}
          </>
        ) : (
          <>{t.rich("table.restoreBody", { name: pending?.name ?? "", strong })}</>
        )}
      </Dialog>
    </>
  );
}
