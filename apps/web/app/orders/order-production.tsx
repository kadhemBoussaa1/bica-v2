"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  canAccessAny,
  WORKSHOP_STAGES,
  type OrderStatus,
  type WorkshopStage,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { FormDialog } from "@repo/ui/form-dialog";
import { useCurrentUser } from "../auth/use-auth";
import { RunForm } from "../production/run-form";
import { useTRPC } from "../trpc/client";
import styles from "./order-detail.module.css";
import { dateFormat } from "../../i18n/formats";

const int = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const day = () => dateFormat({ dateStyle: "medium" });

/** The `orders` translator, as `runHeadline` needs it for the one worded unit. */
type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/**
 * The headline figure for one run, in its station's unit — or pieces, for a
 * printing run on a bag printer. A migrated row has only `quantite`, so that
 * is the fallback — it IS the row's output. `m` and `pcs` are symbols and
 * stay as they are; "parcels" is a word, so it comes from the messages.
 */
export function runHeadline(
  run: {
    stage: WorkshopStage;
    metersPrinted: number | null;
    piecesPrinted: number | null;
    piecesProduced: number | null;
    parcelsClosed: number | null;
    quantite: number;
  },
  t: Translate,
): string {
  switch (run.stage) {
    case "PRINTING":
      return run.piecesPrinted !== null
        ? `${int.format(run.piecesPrinted)} pcs`
        : `${int.format(run.metersPrinted ?? run.quantite)} m`;
    case "PRODUCER":
      return `${int.format(run.piecesProduced ?? run.quantite)} pcs`;
    case "PACKAGING": {
      const parcels = run.parcelsClosed ?? run.quantite;
      return t("parcels", { count: parcels, n: int.format(parcels) });
    }
  }
}

/**
 * The production entries on an order's page: one card per station that has
 * recorded something, in the order the work flows, each with a button that
 * opens the recording form in a dialog. An order with no entries at all keeps
 * a single empty card.
 *
 * The workshop's three stations are a second axis from `Role`: the stage lives
 * on the RUN, not the user, so someone covering two stations picks the stage
 * each time rather than needing two accounts. A card's button only presets
 * the form's stage — the picker still offers all three, which is how the first
 * entry of a station with no card yet gets recorded.
 *
 * Recording is deliberately separate from the lifecycle actions in the rail.
 * Logging output does not advance the order — but a PACKAGING entry is what
 * lets a PRODUCTION user later mark it produced, since that transition is
 * blocked until one exists (`OrderService.transition`; ADMIN bypasses).
 */
export function OrderProduction({
  orderId,
  numero,
  status,
}: {
  orderId: string;
  numero: string;
  status: OrderStatus;
}) {
  const trpc = useTRPC();
  const t = useTranslations("orders");
  const { user } = useCurrentUser();
  const runsQuery = useQuery(
    trpc.production.forOrder.queryOptions({ orderId }),
  );
  // The stage the form opens on; null while the dialog is closed.
  const [openStage, setOpenStage] = useState<WorkshopStage | null>(null);

  const canRecord =
    user !== null &&
    canAccessAny(user.role, ["ADMIN", "PRODUCTION"]) &&
    status === "IN_PRODUCTION";

  const runs = runsQuery.data ?? [];
  const stages = WORKSHOP_STAGES.filter((stage) =>
    runs.some((run) => run.stage === stage),
  );

  const recordButton = (stage: WorkshopStage) =>
    canRecord && (
      <Button size="dense" onClick={() => setOpenStage(stage)}>
        {t("production.record")}
      </Button>
    );

  return (
    <>
      {stages.length === 0 && (
        <section className={styles.card}>
          <div className={styles.sectionHead}>
            <h2 className={styles.cardTitle}>{t("production.title")}</h2>
            {recordButton("PRODUCER")}
          </div>
          <p className={styles.quiet}>{t("production.empty")}</p>
        </section>
      )}

      {stages.map((stage) => {
        const stageRuns = runs.filter((run) => run.stage === stage);
        return (
          <section key={stage} className={styles.card}>
            <div className={styles.sectionHead}>
              <h2 className={styles.cardTitle}>
                {t(`production.stageTitle.${stage}`)} ({stageRuns.length})
              </h2>
              {recordButton(stage)}
            </div>

            {stageRuns.map((run) => (
              <div key={run.id} className={styles.row}>
                <span className={styles.rowDate}>
                  {day().format(new Date(run.dateProduction))}
                </span>
                <span className={styles.rowValue}>{runHeadline(run, t)}</span>
                <span className={styles.rowMeta}>
                  {/* The machine for the two machine stations; otherwise who
                      typed it in, falling back to the legacy employee where
                      the old system recorded one. */}
                  {run.machine
                    ? run.machine.name
                    : run.recordedBy
                      ? run.recordedBy.name
                      : run.employee
                        ? `${run.employee.firstName} ${run.employee.lastName}`
                        : "—"}
                  {run.note && (
                    <span className={styles.quiet}> · {run.note}</span>
                  )}
                </span>
              </div>
            ))}
          </section>
        );
      })}

      {canRecord && openStage !== null && (
        <FormDialog
          eyebrow={numero}
          title={t("production.record")}
          onClose={() => setOpenStage(null)}
        >
          <RunForm
            orderId={orderId}
            initialStage={openStage}
            onDone={() => setOpenStage(null)}
            onCancel={() => setOpenStage(null)}
          />
        </FormDialog>
      )}
    </>
  );
}
