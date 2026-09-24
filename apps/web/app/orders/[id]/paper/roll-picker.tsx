"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import type { CandidateSortKey } from "api/src/allocation/allocation.list";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, reserveRollInput } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { DataTable, type Column, type DataTableState } from "@repo/ui/data-table";
import { TextField } from "@repo/ui/field";
import { FormDialog } from "@repo/ui/form-dialog";
import type { FormNav } from "../../../records/form-nav";
import { RollSlitForm } from "../../../stock/roll-slit-form";
import { invalidateRollQueries } from "../../../stock/roll-queries";
import { useTRPC } from "../../../trpc/client";
import records from "../../../records/records.module.css";
import styles from "../../order-detail.module.css";

type Candidate = inferRouterOutputs<AppRouter>["allocation"]["candidates"]["rows"][number];

interface PickerState extends DataTableState {
  pageSize: (typeof PAGE_SIZES)[number];
  sortBy: CandidateSortKey;
  filter: "all";
}

const INITIAL_STATE: PickerState = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  search: "",
  sortBy: "laize",
  sortDir: "asc",
  filter: "all",
};

const metresFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

/** Today as YYYY-MM-DD in local time. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

type Action =
  | { kind: "reserve" | "cutAndReserve"; row: Candidate }
  | { kind: "slit"; row: Candidate };

/**
 * The warehouse's reel picker for one order (docs/roll-allocation-plan.md §7.2):
 * every live reel of the product's grammage at or above the production width,
 * exact fits first. Allocate reserves metres on the reel; Cut and allocate
 * makes a child of exactly the needed length and reserves it; Slit turns a
 * wider reel into bands, after which the new bands show up as fits.
 */
export function RollPicker({ orderId, onDone }: { orderId: string } & FormNav) {
  const t = useTranslations("orders");
  const common = useTranslations("common");
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [tableState, setTableState] = useState<PickerState>(INITIAL_STATE);
  const [action, setAction] = useState<Action | null>(null);

  const paperQuery = useQuery(trpc.allocation.forOrder.queryOptions({ orderId }));
  const candidatesQuery = useQuery({
    ...trpc.allocation.candidates.queryOptions({ orderId, ...tableState }),
    placeholderData: (prev) => prev,
  });

  const onStateChange = useCallback(
    (next: Partial<DataTableState>) =>
      setTableState((current) => ({ ...current, ...next }) as PickerState),
    [],
  );

  const paper = paperQuery.data;
  const need = paper?.order.metrageNecessaire ?? null;
  const outstanding =
    paper && need !== null
      ? Math.max(0, need - paper.reservedMetres - paper.consumedMetres)
      : null;
  const widthCm = paper?.order.productionWidthCm ?? null;

  const finish = () => (onDone ? onDone(`/orders/${orderId}`) : router.push(`/orders/${orderId}`));
  const afterChange = async () => {
    setAction(null);
    await invalidateRollQueries(queryClient, trpc);
  };

  const columns: ReadonlyArray<Column<Candidate>> = [
    {
      key: "numero",
      header: t("picker.columns.reel"),
      width: "minmax(120px,1fr)",
      cell: (row) => <span className={records.mono}>{row.numero ?? "—"}</span>,
    },
    {
      key: "paperGrade",
      header: t("picker.columns.grade"),
      width: "100px",
      sortKey: "paperGrade",
      cell: (row) => <span className={records.text}>{row.paperGrade ?? "—"}</span>,
    },
    {
      key: "grammage",
      header: t("picker.columns.grammage"),
      width: "100px",
      numeric: true,
      cell: (row) =>
        row.grammageKnown ? (
          <span className={records.date}>{row.grammage} g</span>
        ) : (
          <span className={[records.statusBadge, records.statusNeutral].filter(Boolean).join(" ")}>
            {t("picker.unknownGrammage")}
          </span>
        ),
    },
    {
      key: "laize",
      header: t("picker.columns.width"),
      width: "130px",
      numeric: true,
      sortKey: "laize",
      cell: (row) => (
        <span className={records.date}>
          {row.laize} mm{" "}
          <span
            className={[
              records.statusBadge,
              row.fit === "exact" ? records.statusSuccess : records.statusWarning,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {t(`picker.fit.${row.fit}`)}
          </span>
        </span>
      ),
    },
    {
      key: "free",
      header: t("picker.columns.free"),
      width: "110px",
      numeric: true,
      sortKey: "metrageRestant",
      cell: (row) => <span className={records.date}>{metresFmt.format(row.freeMetres)} m</span>,
    },
    {
      key: "actions",
      header: "",
      width: "minmax(200px,auto)",
      cell: (row) => (
        <div className={records.actions}>
          {row.fit === "exact" ? (
            <>
              <Button
                variant="primary"
                className={records.actionBtn}
                onClick={() => setAction({ kind: "reserve", row })}
              >
                {t("picker.allocate")}
              </Button>
              {outstanding !== null && row.freeMetres > outstanding && outstanding > 0 && (
                <Button
                  className={records.actionBtn}
                  onClick={() => setAction({ kind: "cutAndReserve", row })}
                >
                  {t("picker.cutAndAllocate")}
                </Button>
              )}
            </>
          ) : (
            <Button className={records.actionBtn} onClick={() => setAction({ kind: "slit", row })}>
              {t("picker.slit")}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      {paper && (
        <div className={styles.headline} style={{ marginBottom: 16 }}>
          <Cell label={t("paper.width")} value={widthCm === null ? "—" : `${widthCm * 10} mm`} />
          <Cell
            label={t("paper.need")}
            value={need === null ? t("paper.grammageMissing") : `${metresFmt.format(need)} m`}
          />
          <Cell
            label={t("paper.reserved")}
            value={`${metresFmt.format(paper.reservedMetres + paper.consumedMetres)} m`}
          />
          <Cell
            label={t("paper.outstanding")}
            value={outstanding === null ? "—" : `${metresFmt.format(outstanding)} m`}
          />
        </div>
      )}

      {candidatesQuery.isError ? (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {candidatesQuery.error.message}
        </p>
      ) : (
        <DataTable
          rows={candidatesQuery.data?.rows ?? []}
          columns={columns}
          rowKey={(row) => row.id}
          total={candidatesQuery.data?.total ?? 0}
          pageCount={candidatesQuery.data?.pageCount ?? 1}
          pending={candidatesQuery.isPending}
          loading={candidatesQuery.isFetching}
          state={tableState}
          onStateChange={onStateChange}
          density="dense"
          searchPlaceholder={t("picker.searchPlaceholder")}
          emptyMessage={t("picker.empty")}
        />
      )}

      <div className={records.formActions}>
        <Button variant="primary" onClick={finish}>
          {t("picker.done")}
        </Button>
      </div>

      {action && action.kind !== "slit" && (
        <FormDialog
          eyebrow={t("eyebrow")}
          title={t(action.kind === "reserve" ? "picker.reserveTitle" : "picker.cutReserveTitle", {
            reel: action.row.numero ?? t("paper.rollFallback"),
          })}
          onClose={() => setAction(null)}
        >
          <ReserveForm
            orderId={orderId}
            row={action.row}
            cut={action.kind === "cutAndReserve"}
            defaultMetres={
              outstanding === null || outstanding <= 0
                ? action.row.freeMetres
                : action.kind === "cutAndReserve"
                  ? outstanding
                  : Math.min(action.row.freeMetres, outstanding)
            }
            onDone={afterChange}
            onCancel={() => setAction(null)}
          />
        </FormDialog>
      )}

      {action && action.kind === "slit" && (
        <FormDialog
          eyebrow={t("eyebrow")}
          title={t("picker.slitTitle", { reel: action.row.numero ?? t("paper.rollFallback") })}
          onClose={() => setAction(null)}
        >
          <RollSlitForm
            rollId={action.row.id}
            prefillWidthMm={widthCm === null ? undefined : widthCm * 10}
            onDone={afterChange}
            onCancel={() => setAction(null)}
          />
        </FormDialog>
      )}
      <span hidden>{common("close")}</span>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.headlineCell}>
      <div className={styles.headlineLabel}>{label}</div>
      <div className={styles.headlineFigure}>
        <span className={styles.headlineValue}>{value}</span>
      </div>
    </div>
  );
}

/** Metres and a date, for a plain reservation or a cut-and-reserve. */
function ReserveForm({
  orderId,
  row,
  cut,
  defaultMetres,
  onDone,
  onCancel,
}: {
  orderId: string;
  row: Candidate;
  cut: boolean;
  defaultMetres: number;
  onDone: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations("orders");
  const common = useTranslations("common");
  const trpc = useTRPC();
  const [metres, setMetres] = useState(String(Math.round(defaultMetres * 100) / 100));
  const [dateAllocation, setDateAllocation] = useState(today());
  const [error, setError] = useState<string | null>(null);

  const reserve = useMutation(
    trpc.allocation.reserve.mutationOptions({
      onSuccess: () => onDone(),
      onError: (cause) => setError(cause.message),
    }),
  );
  const cutAndReserve = useMutation(
    trpc.allocation.cutAndReserve.mutationOptions({
      onSuccess: () => onDone(),
      onError: (cause) => setError(cause.message),
    }),
  );
  const busy = reserve.isPending || cutAndReserve.isPending;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const trimmed = metres.trim();
    if (trimmed === "" || Number.isNaN(Number(trimmed))) {
      setError(t("paper.mustBeNumber"));
      return;
    }
    const parsed = reserveRollInput.safeParse({
      orderId,
      rollId: row.id,
      metres: Number(trimmed),
      dateAllocation,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? common("checkForm"));
      return;
    }
    if (cut) cutAndReserve.mutate(parsed.data);
    else reserve.mutate(parsed.data);
  }

  return (
    <form className={records.formPanel} onSubmit={handleSubmit} noValidate>
      {error && (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}
      <div className={records.formGrid}>
        <div className={records.formWide}>
          <p className={records.hint}>
            {t(cut ? "picker.cutReserveHint" : "picker.reserveHint", {
              free: metresFmt.format(row.freeMetres),
              reel: row.numero ?? t("paper.rollFallback"),
            })}
          </p>
        </div>
        <TextField
          label={t("picker.metres")}
          unit="m"
          format="numeric"
          value={metres}
          onChange={(e) => setMetres(e.target.value)}
          autoComplete="off"
          autoFocus
          disabled={busy}
        />
        <TextField
          label={t("picker.date")}
          type="date"
          value={dateAllocation}
          onChange={(e) => setDateAllocation(e.target.value)}
          disabled={busy}
        />
      </div>
      <div className={records.formActions}>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {common("cancel")}
        </Button>
        <Button variant="primary" type="submit" busy={busy}>
          {busy
            ? common("working")
            : cut
              ? t("picker.confirmCutReserve")
              : t("picker.confirmReserve")}
        </Button>
      </div>
    </form>
  );
}
