"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { canAccess, PAGE_SIZES } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { DataTable, type DataTableState } from "@repo/ui/data-table";
import { TableSkeleton } from "@repo/ui/skeleton";
import { useToast } from "@repo/ui/toast";
import type { InkFacet, InkSortKey } from "api/src/ink/ink.list";
import { useCurrentUser } from "../../auth/use-auth";
import { useTRPC } from "../../trpc/client";
import { KpiRow, KpiTile } from "../../records/kpi";
import { SegmentedFilter } from "../../records/segmented-filter";
import records from "../../records/records.module.css";
import { InkCard } from "./ink-card";
import { InkColourDialog } from "./ink-colour-dialog";
import { InkDrawer } from "./ink-drawer";
import { InkQuantityDialog } from "./ink-quantity-dialog";
import { formatQty, type InkRow } from "./ink-ui";
import styles from "./inks.module.css";

/** The three orders the handoff offers, each with the direction it reads in. */
const SORTS = [
  { key: "level", dir: "asc" },
  { key: "name", dir: "asc" },
  { key: "usage", dir: "desc" },
] as const satisfies ReadonlyArray<{ key: InkSortKey; dir: "asc" | "desc" }>;

type SortKey = (typeof SORTS)[number]["key"];

interface InkStockState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: SortKey;
  filter: "all" | InkFacet;
}

type Modal =
  | { kind: "new" }
  | { kind: "edit"; colour: InkRow }
  | { kind: "restock"; colour: InkRow }
  | { kind: "adjust"; colour: InkRow };

/**
 * Ink stock v3 (`Ink stock v3.dc.html`): the shelf as a grid of colour
 * cards, figures in the header, a drawer per colour with its history.
 *
 * Server-side like every list: the chips, search, sort and pager are the
 * ink list's, and `DataTable` draws the toolbar and pager around a card
 * grid (`renderBody`). One departure from the handoff: "All" includes the
 * archive, sunk to the end and dimmed, as on every other list, rather than
 * hiding it — the "Archived" chip still isolates it.
 *
 * `/stock/inks/<id>` (where global search lands) and `/stock/inks/new` are
 * this page with the drawer or the create dialog open.
 */
export function InkStock({
  initialSearch = "",
  openId,
  openNew = false,
}: {
  initialSearch?: string;
  openId?: string;
  openNew?: boolean;
}) {
  const t = useTranslations("stock");
  const units = useTranslations("enums");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const { push } = useToast();
  const { user } = useCurrentUser();
  const canWrite = user ? canAccess(user.role, "ADMIN") : false;

  const [tableState, setTableState] = useState<InkStockState>({
    page: 1,
    pageSize: 50,
    search: initialSearch,
    sortBy: "level",
    sortDir: "asc",
    filter: "all",
  });
  const [selected, setSelected] = useState<string | null>(openId ?? null);
  const [modal, setModal] = useState<Modal | null>(openNew ? { kind: "new" } : null);

  const listQuery = useQuery({
    ...trpc.ink.list.queryOptions(tableState),
    placeholderData: (prev) => prev,
  });
  const summaryQuery = useQuery(trpc.ink.summary.queryOptions());

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) => setTableState((current) => ({ ...current, ...next }) as InkStockState),
    [],
  );
  const pageCount = listQuery.data?.pageCount ?? 1;
  if (!listQuery.isFetching && tableState.page > pageCount) {
    setTableState((current) => ({ ...current, page: pageCount }));
  }

  /** Back to the list's own URL once a deep-linked drawer or dialog closes. */
  const settleUrl = () => {
    if (pathname !== "/stock/inks") router.replace("/stock/inks");
  };

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.ink.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.ink.summary.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.ink.detail.queryKey() }),
    ]);

  const closeModal = () => {
    setModal(null);
    if (selected === null) settleUrl();
  };
  const toast = async (title: string) => {
    push({ title, tone: "success" });
    await refresh();
  };

  const summary = summaryQuery.data;
  const facets = listQuery.data?.facetCounts;

  return (
    <>
      <header className={records.header}>
        <div className={records.heading}>
          <span className={records.eyebrow}>{t("eyebrow")}</span>
          <h1 className={records.title}>{t("inks.title")}</h1>
        </div>
        <p className={records.subtitle}>{t("inks.v3.subtitle")}</p>
        {canWrite && (
          <Button variant="primary" onClick={() => setModal({ kind: "new" })}>
            {t("inks.newColour")}
          </Button>
        )}

        {summary && (
          <div className={styles.figures}>
            <KpiRow>
              <KpiTile
                label={t("inks.v3.tiles.onShelf")}
                value={String(summary.live)}
                meta={
                  summary.totals.length === 0
                    ? t("inks.v3.tiles.empty")
                    : (
                        // One <bdi> per figure: joined into one string, Arabic
                        // reorders "2 097,6 kg · 12 L" into nonsense.
                        <>
                          {summary.totals.map((total, index) => (
                            <Fragment key={total.unit}>
                              {index > 0 && " · "}
                              <bdi>
                                {formatQty(total.stock)} {units(`inkUnit.${total.unit}`)}
                              </bdi>
                            </Fragment>
                          ))}{" "}
                          {t("inks.v3.tiles.inAll")}
                        </>
                      )
                }
              />
              <KpiTile
                label={t("inks.v3.tiles.low")}
                value={String(summary.low)}
                unit={t("inks.v3.tiles.colours", { count: summary.low })}
                meta={t("inks.v3.tiles.lowMeta")}
                tone={summary.low > 0 ? "warning" : "neutral"}
              />
              <KpiTile
                label={t("inks.v3.tiles.out")}
                value={String(summary.out)}
                unit={t("inks.v3.tiles.colours", { count: summary.out })}
                meta={
                  summary.out === 0 ? (
                    t("inks.v3.tiles.noOut")
                  ) : (
                    <bdi>
                      {summary.outNames.join(", ")}
                      {summary.out > summary.outNames.length && ` +${summary.out - summary.outNames.length}`}
                    </bdi>
                  )
                }
                tone={summary.out > 0 ? "danger" : "success"}
              />
              <KpiTile
                label={t("inks.v3.tiles.noThreshold")}
                value={String(summary.noThreshold)}
                unit={t("inks.v3.tiles.colours", { count: summary.noThreshold })}
                meta={t("inks.v3.tiles.noThresholdMeta")}
              />
            </KpiRow>
          </div>
        )}
      </header>

      {listQuery.isPending ? (
        <TableSkeleton />
      ) : listQuery.isError ? (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {listQuery.error.message}
        </p>
      ) : (
        <DataTable
          rows={listQuery.data.rows}
          columns={[]}
          rowKey={(row) => row.id}
          renderBody={(rows) => (
            <div className={styles.grid}>
              {rows.map((colour) => (
                <InkCard
                  key={colour.id}
                  colour={colour}
                  canWrite={canWrite}
                  onOpen={() => setSelected(colour.id)}
                  onRestock={() => setModal({ kind: "restock", colour })}
                  onAdjust={() => setModal({ kind: "adjust", colour })}
                />
              ))}
            </div>
          )}
          filters={[
            { key: "low", label: t("inks.v3.filters.low") },
            { key: "out", label: t("inks.v3.filters.out") },
            { key: "ok", label: t("inks.v3.filters.ok") },
            { key: "archived", label: t("inks.filters.archived") },
          ]}
          facetCounts={facets}
          total={listQuery.data.total}
          pageCount={listQuery.data.pageCount}
          loading={listQuery.isFetching}
          state={tableState}
          onStateChange={onStateChange}
          toolbar={
            <SegmentedFilter
              label={t("inks.v3.sortLabel")}
              segments={SORTS.map((sort) => ({ key: sort.key, label: t(`inks.v3.sorts.${sort.key}`) }))}
              value={tableState.sortBy}
              onChange={(key) =>
                setTableState((current) => ({
                  ...current,
                  sortBy: key,
                  sortDir: SORTS.find((sort) => sort.key === key)?.dir ?? "asc",
                  page: 1,
                }))
              }
            />
          }
          searchPlaceholder={t("inks.v3.searchPlaceholder")}
          emptyMessage={t("inks.v3.emptyTitle")}
          emptyText={t("inks.v3.emptyText")}
        />
      )}

      {selected !== null && (
        <InkDrawer
          key={selected}
          id={selected}
          canWrite={canWrite}
          onClose={() => {
            setSelected(null);
            settleUrl();
          }}
          onRestock={(colour) => setModal({ kind: "restock", colour })}
          onAdjust={(colour) => setModal({ kind: "adjust", colour })}
          onEdit={(colour) => setModal({ kind: "edit", colour })}
          onChanged={toast}
        />
      )}

      {modal?.kind === "new" && (
        <InkColourDialog
          onClose={closeModal}
          onDone={async (id) => {
            setModal(null);
            await refresh();
            setSelected(id);
          }}
        />
      )}
      {modal?.kind === "edit" && (
        <InkColourDialog
          colour={modal.colour}
          onClose={closeModal}
          onDone={async () => {
            setModal(null);
            await refresh();
          }}
        />
      )}
      {(modal?.kind === "restock" || modal?.kind === "adjust") && (
        <InkQuantityDialog
          key={`${modal.kind}-${modal.colour.id}`}
          kind={modal.kind}
          colour={modal.colour}
          onClose={closeModal}
          onDone={async (message) => {
            setModal(null);
            await toast(message);
          }}
        />
      )}
    </>
  );
}
