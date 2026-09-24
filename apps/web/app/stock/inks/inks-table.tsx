"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import {
  adjustInkStockInput,
  canAccess,
  DEFAULT_PAGE_SIZE,
  inkStockState,
  PAGE_SIZES,
  restockInkInput,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { DataTable, type Column, type DataTableState } from "@repo/ui/data-table";
import { Dialog } from "@repo/ui/dialog";
import { TextField } from "@repo/ui/field";
import { TableSkeleton } from "@repo/ui/skeleton";
import { useToast } from "@repo/ui/toast";
import { useCurrentUser } from "../../auth/use-auth";
import { useTRPC } from "../../trpc/client";
import styles from "../../records/records.module.css";

interface InksTableState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: "code" | "name" | "stock" | "updatedAt";
  filter: "all" | "inStock" | "out" | "archived";
}

const INITIAL_STATE: InksTableState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  sortBy: "code",
  sortDir: "asc",
  filter: "all",
};

const qty = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });

/** Which balance dialog is open, and for which row. */
type Movement =
  | { kind: "restock"; row: InkRow }
  | { kind: "adjust"; row: InkRow }
  | { kind: "archive"; row: InkRow };

type InkRow = {
  id: string;
  code: string;
  name: string | null;
  unit: "KG" | "L";
  stock: number;
  alertThreshold: number | null;
  active: boolean;
  _count: { usages: number };
};

export function InksTable() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const { user: me } = useCurrentUser();
  const t = useTranslations("stock");
  const common = useTranslations("common");
  const units = useTranslations("enums");
  const unitLabel = (value: "KG" | "L") => units(`inkUnit.${value}`);
  const canWrite = me ? canAccess(me.role, "ADMIN") : false;
  const [error, setError] = useState<string | null>(null);
  const [tableState, setTableState] = useState<InksTableState>(INITIAL_STATE);

  const inksQuery = useQuery({
    ...trpc.ink.list.queryOptions(tableState),
    placeholderData: (prev) => prev,
  });

  const [movement, setMovement] = useState<Movement | null>(null);
  const [amount, setAmount] = useState("");

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.ink.list.queryKey() });
  const close = () => {
    setMovement(null);
    setAmount("");
  };
  const onError = (cause: { message: string }) => setError(cause.message);

  const restock = useMutation(
    trpc.ink.restock.mutationOptions({
      onSuccess: async (colour) => {
        close();
        push({
          title: t("inks.restockedToast", {
            code: colour.code,
            stock: qty.format(colour.stock),
            unit: unitLabel(colour.unit),
          }),
          tone: "success",
        });
        await refresh();
      },
      onError,
    }),
  );
  const adjust = useMutation(
    trpc.ink.adjust.mutationOptions({
      onSuccess: async (colour) => {
        close();
        push({
          title: t("inks.adjustedToast", {
            code: colour.code,
            stock: qty.format(colour.stock),
            unit: unitLabel(colour.unit),
          }),
          tone: "success",
        });
        await refresh();
      },
      onError,
    }),
  );
  const setActive = useMutation(
    trpc.ink.setActive.mutationOptions({
      onSuccess: async () => {
        close();
        await refresh();
      },
      onError,
    }),
  );
  const busy = restock.isPending || adjust.isPending || setActive.isPending;

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) =>
      setTableState((current) => ({ ...current, ...next }) as InksTableState),
    [],
  );

  const pageCount = inksQuery.data?.pageCount ?? 1;
  if (!inksQuery.isFetching && tableState.page > pageCount) {
    setTableState((current) => ({ ...current, page: pageCount }));
  }

  function confirmMovement() {
    if (!movement) return;
    setError(null);
    if (movement.kind === "archive") {
      setActive.mutate({ id: movement.row.id, active: !movement.row.active });
      return;
    }
    const trimmed = amount.trim();
    if (trimmed === "" || Number.isNaN(Number(trimmed))) {
      setError(t("inks.enterNumber"));
      return;
    }
    if (movement.kind === "restock") {
      const parsed = restockInkInput.safeParse({ id: movement.row.id, quantity: Number(trimmed) });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? t("inks.checkQuantity"));
        return;
      }
      restock.mutate(parsed.data);
      return;
    }
    const parsed = adjustInkStockInput.safeParse({ id: movement.row.id, stock: Number(trimmed) });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("inks.checkBalance"));
      return;
    }
    adjust.mutate(parsed.data);
  }

  const columns: ReadonlyArray<Column<InkRow>> = [
    {
      key: "code",
      header: t("inks.columns.code"),
      width: "90px",
      sortKey: "code",
      cell: (row) => (
        <span
          className={[styles.mono, row.active ? null : styles.archivedRow]
            .filter(Boolean)
            .join(" ")}
        >
          {row.code}
        </span>
      ),
    },
    {
      key: "name",
      header: t("inks.columns.colour"),
      width: "minmax(150px,1fr)",
      sortKey: "name",
      cell: (row) => (
        <div
          className={[styles.name, row.active ? null : styles.archivedRow]
            .filter(Boolean)
            .join(" ")}
        >
          {row.name ?? <span className={styles.absent} />}
          {!row.active && <span className={styles.archivedTag}>{t("archivedTag")}</span>}
        </div>
      ),
    },
    {
      key: "stock",
      header: t("inks.columns.inStock"),
      width: "125px",
      numeric: true,
      sortKey: "stock",
      // The low flag compares two columns of the row, which the server's
      // facets cannot — so it is judged here, on the values the select
      // returns, by the contract's one rule (the dashboard reads the same).
      cell: (row) => {
        const state = inkStockState(row);
        const out = state === "out";
        const low = state === "low";
        return (
          <span className={styles.date}>
            {qty.format(row.stock)} {unitLabel(row.unit)}
            {out && (
              <span className={[styles.statusBadge, styles.statusDanger].filter(Boolean).join(" ")}>
                {t("inks.out")}
              </span>
            )}
            {low && (
              <span className={[styles.statusBadge, styles.statusWarning].filter(Boolean).join(" ")}>
                {t("inks.low")}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "alertThreshold",
      header: t("inks.columns.alertAt"),
      width: "80px",
      numeric: true,
      cell: (row) =>
        row.alertThreshold !== null ? (
          <span className={styles.date}>
            {qty.format(row.alertThreshold)} {unitLabel(row.unit)}
          </span>
        ) : (
          <span className={styles.absent} />
        ),
    },
    {
      key: "usages",
      header: t("inks.columns.usedOn"),
      width: "70px",
      numeric: true,
      cell: (row) => (
        <span className={styles.date}>
          {row._count.usages === 0
            ? "—"
            : t("inks.usedOnLines", { count: row._count.usages })}
        </span>
      ),
    },
    ...(canWrite
      ? [
          {
            key: "actions",
            // Four row actions; with the other columns this stays inside
            // the card at the 1280px desktop width (see the Machines list).
            header: "",
            width: "320px",
            cell: (row: InkRow) => (
              <div className={styles.actions}>
                <Link href={`/stock/inks/${row.id}`}>
                  <Button className={styles.actionBtn}>{common("edit")}</Button>
                </Link>
                <Button
                  className={styles.actionBtn}
                  onClick={() => {
                    setError(null);
                    setMovement({ kind: "restock", row });
                  }}
                >
                  {t("inks.restock")}
                </Button>
                <Button
                  className={styles.actionBtn}
                  onClick={() => {
                    setError(null);
                    setAmount(String(row.stock));
                    setMovement({ kind: "adjust", row });
                  }}
                >
                  {t("inks.adjust")}
                </Button>
                <Button
                  variant={row.active ? "danger" : "secondary"}
                  className={styles.actionBtn}
                  onClick={() => {
                    setError(null);
                    setMovement({ kind: "archive", row });
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

  if (inksQuery.isPending) return <TableSkeleton />;

  if (inksQuery.isError) {
    return (
      <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
        {inksQuery.error.message}
      </p>
    );
  }

  const row = movement?.row;
  const unit = row ? unitLabel(row.unit) : "";

  return (
    <>
      {error && movement === null && (
        <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      <DataTable
        rows={inksQuery.data.rows}
        columns={columns}
        rowKey={(r) => r.id}
        filters={[
          { key: "inStock", label: t("inks.filters.inStock") },
          { key: "out", label: t("inks.filters.out") },
          { key: "archived", label: t("inks.filters.archived") },
        ]}
        facetCounts={inksQuery.data.facetCounts}
        total={inksQuery.data.total}
        pageCount={inksQuery.data.pageCount}
        loading={inksQuery.isFetching}
        state={tableState}
        onStateChange={onStateChange}
        searchPlaceholder={t("inks.searchPlaceholder")}
        emptyMessage={t("inks.emptyMessage")}
      />

      <Dialog
        open={movement?.kind === "restock"}
        title={row ? t("inks.restockTitle", { code: row.code }) : t("inks.restock")}
        confirmLabel={t("inks.addToStock")}
        busy={busy}
        onConfirm={confirmMovement}
        onClose={() => !busy && close()}
      >
        {row && (
          <>
            <p className={styles.hint}>
              {t.rich("inks.restockHint", {
                stock: qty.format(row.stock),
                unit,
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
            {error && (
              <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
                {error}
              </p>
            )}
            <TextField
              label={t("inks.quantityReceived")}
              unit={unit}
              format="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoComplete="off"
              autoFocus
              disabled={busy}
            />
          </>
        )}
      </Dialog>

      <Dialog
        open={movement?.kind === "adjust"}
        title={row ? t("inks.adjustTitle", { code: row.code }) : t("inks.adjust")}
        confirmLabel={t("inks.setBalance")}
        busy={busy}
        onConfirm={confirmMovement}
        onClose={() => !busy && close()}
      >
        {row && (
          <>
            <p className={styles.hint}>
              {t.rich("inks.adjustHint", {
                stock: qty.format(row.stock),
                unit,
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
            {error && (
              <p className={[styles.notice, styles.error].filter(Boolean).join(" ")} role="alert">
                {error}
              </p>
            )}
            <TextField
              label={t("inks.countedBalance")}
              unit={unit}
              format="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoComplete="off"
              autoFocus
              disabled={busy}
            />
          </>
        )}
      </Dialog>

      <Dialog
        open={movement?.kind === "archive"}
        title={row?.active ? t("inks.archiveTitle") : t("inks.restoreTitle")}
        confirmLabel={row?.active ? common("archive") : common("restore")}
        destructive={row?.active ?? false}
        busy={busy}
        onConfirm={confirmMovement}
        onClose={() => !busy && close()}
      >
        {row?.active
          ? t.rich("inks.archiveBody", {
              code: row.code,
              strong: (chunks) => <strong>{chunks}</strong>,
            })
          : t.rich("inks.restoreBody", {
              code: row?.code ?? "",
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
      </Dialog>
    </>
  );
}
