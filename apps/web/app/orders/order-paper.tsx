"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import { canAccessAny, type OrderKind, type OrderStatus } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { TextField } from "@repo/ui/field";
import { useCurrentUser } from "../auth/use-auth";
import { invalidateRollQueries } from "../stock/roll-queries";
import { useTRPC } from "../trpc/client";
import records from "../records/records.module.css";
import styles from "./order-detail.module.css";
import { dateFormat } from "../../i18n/formats";

type Paper = inferRouterOutputs<AppRouter>["allocation"]["forOrder"];
type Allocation = Paper["allocations"][number];

const metresFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const kg = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const day = () => dateFormat({ dateStyle: "medium" });

/** Statuses at or past PRODUCED: an open reservation there is a loose end. */
const PAST_PRODUCTION: ReadonlySet<OrderStatus> = new Set([
  "PRODUCED",
  "INVOICEABLE",
  "INVOICED",
  "READY_FOR_EXPORT",
  "COMPLETED",
]);

const STATE_CLASS: Record<Allocation["state"], string | undefined> = {
  RESERVED: records.statusActive,
  CONSUMED: records.statusSuccess,
  CANCELED: records.statusNeutral,
};

/**
 * The paper reserved for an order and the figures around it — need,
 * reserved, used, outstanding — in metres (docs/roll-allocation-plan.md §7.1).
 *
 * Reserving happens in the reel picker (`/orders/[id]/paper`), which is the
 * warehouse's; this panel closes reservations: Consume for the metres
 * actually run (the floor, the warehouse or an admin) and Cancel (the
 * warehouse or an admin). The 214 migrated allocations were recorded by
 * weight and show in kilograms, outside the metre totals.
 */
export function OrderPaper({
  orderId,
  status,
  kind,
}: {
  orderId: string;
  status: OrderStatus;
  kind: OrderKind;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const t = useTranslations("orders");
  const common = useTranslations("common");
  const enums = useTranslations("enums");
  const { user } = useCurrentUser();
  const paperQuery = useQuery(trpc.allocation.forOrder.queryOptions({ orderId }));
  const [consuming, setConsuming] = useState<Allocation | null>(null);
  const [metresUsed, setMetresUsed] = useState("");
  const [cancelling, setCancelling] = useState<Allocation | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mirrors the procedures' gates — UX only; the server decides.
  const canReserve = user !== null && canAccessAny(user.role, ["ADMIN", "MAGASINIER"]);
  const canConsume =
    user !== null &&
    canAccessAny(user.role, ["ADMIN", "PRODUCTION", "MAGASINIER"]) &&
    (status === "IN_PRODUCTION" || status === "PRODUCED");
  const canPick =
    canReserve && kind === "ORDER" && (status === "DRAFT" || status === "IN_PRODUCTION");

  const refresh = () => invalidateRollQueries(queryClient, trpc);

  const consume = useMutation(
    trpc.allocation.consume.mutationOptions({
      onSuccess: async () => {
        setConsuming(null);
        await refresh();
      },
      onError: (cause) => setError(cause.message),
    }),
  );
  const cancel = useMutation(
    trpc.allocation.cancel.mutationOptions({
      onSuccess: async () => {
        setCancelling(null);
        await refresh();
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  const paper = paperQuery.data;
  const rows = paper?.allocations ?? [];
  const need = paper?.order.metrageNecessaire ?? null;
  const outstanding =
    paper && need !== null ? need - paper.reservedMetres - paper.consumedMetres : null;
  const openRows = rows.filter((row) => row.state === "RESERVED").length;

  function submitConsume() {
    if (!consuming) return;
    setError(null);
    const trimmed = metresUsed.trim();
    if (trimmed === "" || Number.isNaN(Number(trimmed))) {
      setError(t("paper.mustBeNumber"));
      return;
    }
    consume.mutate({ id: consuming.id, metresUsed: Number(trimmed) });
  }

  return (
    <section className={styles.card}>
      <div className={styles.sectionHead}>
        <h2 className={styles.cardTitle}>
          {t("paper.title")}
          {rows.length > 0 && ` (${rows.length})`}
        </h2>
        {canPick && (
          <Link href={`/orders/${orderId}/paper`}>
            <Button size="dense" variant="primary">
              {t("paper.findRolls")}
            </Button>
          </Link>
        )}
      </div>

      {error && (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {error}
        </p>
      )}

      {paperQuery.isPending && <p className={styles.quiet}>{t("loading")}</p>}
      {paperQuery.isError && (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {paperQuery.error.message}
        </p>
      )}

      {paper && (
        <div className={styles.headline} style={{ marginBottom: 12 }}>
          <Figure
            label={t("paper.width")}
            value={
              paper.order.productionWidthCm === null
                ? null
                : `${metresFmt.format(paper.order.productionWidthCm * 10)}`
            }
            unit="mm"
          />
          <Figure
            label={t("paper.need")}
            value={need === null ? null : metresFmt.format(need)}
            unit="m"
            absentText={t("paper.grammageMissing")}
          />
          <Figure label={t("paper.reserved")} value={metresFmt.format(paper.reservedMetres)} unit="m" />
          <Figure label={t("paper.consumed")} value={metresFmt.format(paper.consumedMetres)} unit="m" />
          <Figure
            label={t("paper.outstanding")}
            value={outstanding === null ? null : metresFmt.format(Math.max(0, outstanding))}
            unit="m"
          />
        </div>
      )}

      {paper && PAST_PRODUCTION.has(status) && openRows > 0 && (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")}>
          {t("paper.openWarning", { count: openRows })}
        </p>
      )}

      {paperQuery.isSuccess && rows.length === 0 && (
        <p className={styles.quiet}>{t("paper.empty")}</p>
      )}

      {rows.map((row) => {
        const reel = row.paperRoll.numero ?? row.paperRoll.paperGrade ?? t("paper.rollFallback");
        const legacy = row.metrageReserve === null;
        return (
          <div key={row.id} className={styles.row}>
            <span className={styles.rowDate}>{day().format(new Date(row.dateAllocation))}</span>
            <span className={styles.rowValue}>
              <Link className={records.inlineLink} href={`/stock/${row.paperRoll.id}`}>
                {reel}
              </Link>
              {" · "}
              {legacy
                ? t("paper.kgOnly", { kg: kg.format(row.poidsReserve) })
                : `${metresFmt.format(row.metrageReserve ?? 0)} m`}
            </span>
            <span className={styles.rowMeta}>
              {row.paperRoll.laize !== null && `${row.paperRoll.laize} mm · `}
              {row.paperRoll.grammage !== null && `${row.paperRoll.grammage} g · `}
              <span
                className={[records.statusBadge, STATE_CLASS[row.state]].filter(Boolean).join(" ")}
              >
                {enums(`allocationState.${row.state}`)}
              </span>
              {row.allocatedBy && (
                <span className={styles.quiet}> · {t("paper.by", { name: row.allocatedBy.name })}</span>
              )}
            </span>
            {row.state === "RESERVED" && (canConsume || canReserve) && (
              <span className={records.actions}>
                {canConsume && !legacy && (
                  <Button
                    className={records.actionBtn}
                    onClick={() => {
                      setError(null);
                      setMetresUsed(String(row.metrageReserve ?? 0));
                      setConsuming(row);
                    }}
                  >
                    {t("paper.consume")}
                  </Button>
                )}
                {canReserve && (
                  <Button
                    variant="danger"
                    className={records.actionBtn}
                    onClick={() => {
                      setError(null);
                      setCancelling(row);
                    }}
                  >
                    {t("paper.cancel")}
                  </Button>
                )}
              </span>
            )}
          </div>
        );
      })}

      {paper && paper.legacyKgOnly > 0 && (
        <p className={styles.quiet} style={{ marginTop: 8 }}>
          {t("paper.legacyNote", { count: paper.legacyKgOnly })}
        </p>
      )}

      <Dialog
        open={consuming !== null}
        title={t("paper.consumeTitle")}
        confirmLabel={t("paper.consume")}
        busy={consume.isPending}
        onConfirm={submitConsume}
        onClose={() => !consume.isPending && setConsuming(null)}
      >
        {consuming && (
          <>
            <p style={{ marginTop: 0 }}>
              {t.rich("paper.consumeBody", {
                metres: metresFmt.format(consuming.metrageReserve ?? 0),
                reel: consuming.paperRoll.numero ?? t("paper.rollFallback"),
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
            <TextField
              label={t("paper.metresUsed")}
              unit="m"
              format="numeric"
              value={metresUsed}
              onChange={(e) => setMetresUsed(e.target.value)}
              autoComplete="off"
              autoFocus
              disabled={consume.isPending}
            />
          </>
        )}
      </Dialog>

      <Dialog
        open={cancelling !== null}
        title={t("paper.cancelTitle")}
        confirmLabel={t("paper.cancel")}
        destructive
        busy={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate({ id: cancelling.id })}
        onClose={() => !cancel.isPending && setCancelling(null)}
      >
        {cancelling &&
          (cancelling.metrageReserve === null
            ? t("paper.cancelLegacyBody")
            : t.rich("paper.cancelBody", {
                metres: metresFmt.format(cancelling.metrageReserve),
                reel: cancelling.paperRoll.numero ?? t("paper.rollFallback"),
                strong: (chunks) => <strong>{chunks}</strong>,
              }))}
        <span hidden>{common("cancel")}</span>
      </Dialog>
    </section>
  );
}

function Figure({
  label,
  value,
  unit,
  absentText,
}: {
  label: string;
  value: string | null;
  unit: string;
  absentText?: string;
}) {
  return (
    <div className={styles.headlineCell}>
      <div className={styles.headlineLabel}>{label}</div>
      <div className={styles.headlineFigure}>
        {value === null ? (
          <span className={styles.quiet}>{absentText ?? "—"}</span>
        ) : (
          <>
            <span className={styles.headlineValue}>{value}</span>
            <span className={styles.unit}>{unit}</span>
          </>
        )}
      </div>
    </div>
  );
}
