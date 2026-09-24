"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  canAccessAny,
  type OrderStatus,
  type WorkshopStage,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
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
 * The headline figure for one run, in its station's unit. A migrated row has
 * only `quantite`, so that is the fallback — it IS the row's output. `m` and
 * `pcs` are symbols and stay as they are; "parcels" is a word, so it comes
 * from the messages.
 */
export function runHeadline(
  run: {
    stage: WorkshopStage;
    metersPrinted: number | null;
    piecesProduced: number | null;
    piecesControlled: number | null;
    parcelsClosed: number | null;
    quantite: number;
  },
  t: Translate,
): string {
  switch (run.stage) {
    case "PRINTING":
      return `${int.format(run.metersPrinted ?? run.quantite)} m`;
    case "PRODUCER":
      return `${int.format(run.piecesProduced ?? run.quantite)} pcs`;
    case "QUALITY_CONTROL":
      return `${int.format(run.piecesControlled ?? run.quantite)} pcs`;
    case "PACKAGING": {
      const parcels = run.parcelsClosed ?? run.quantite;
      return t("parcels", { count: parcels, n: int.format(parcels) });
    }
  }
}

/**
 * The production entries on an order's page: what each station has
 * recorded, and the form to add another.
 *
 * The workshop's four stations are a second axis from `Role`: the stage lives
 * on the RUN, not the user, so someone covering two stations picks the stage
 * each time rather than needing two accounts.
 *
 * Recording is deliberately separate from the lifecycle actions in the rail.
 * Logging output does not advance the order — but a PACKAGING entry is what
 * lets a PRODUCTION user later mark it produced, since that transition is
 * blocked until one exists (`OrderService.transition`; ADMIN bypasses).
 */
export function OrderProduction({
  orderId,
  status,
}: {
  orderId: string;
  status: OrderStatus;
}) {
  const trpc = useTRPC();
  const t = useTranslations("orders");
  const enums = useTranslations("enums");
  const { user } = useCurrentUser();
  const runsQuery = useQuery(
    trpc.production.forOrder.queryOptions({ orderId }),
  );
  const [open, setOpen] = useState(false);

  const canRecord =
    user !== null &&
    canAccessAny(user.role, ["ADMIN", "PRODUCTION"]) &&
    status === "IN_PRODUCTION";

  const runs = runsQuery.data ?? [];

  return (
    <section className={styles.card}>
      <div className={styles.sectionHead}>
        <h2 className={styles.cardTitle}>
          {t("production.title")}
          {runs.length > 0 && ` (${runs.length})`}
        </h2>
        {canRecord && !open && (
          <Button size="dense" onClick={() => setOpen(true)}>
            {t("production.record")}
          </Button>
        )}
      </div>

      {runs.length === 0 && (
        <p className={styles.quiet}>{t("production.empty")}</p>
      )}

      {runs.map((run) => (
        <div key={run.id} className={styles.row}>
          <span className={styles.rowStation}>
            {enums(`workshopStage.${run.stage}`)}
          </span>
          <span className={styles.rowDate}>
            {day().format(new Date(run.dateProduction))}
          </span>
          <span className={styles.rowValue}>{runHeadline(run, t)}</span>
          <span className={styles.rowMeta}>
            {/* The machine for the two machine stations; otherwise who typed
                it in, falling back to the legacy employee where the old
                system recorded one. */}
            {run.machine
              ? run.machine.name
              : run.recordedBy
                ? run.recordedBy.name
                : run.employee
                  ? `${run.employee.firstName} ${run.employee.lastName}`
                  : "—"}
            {run.note && <span className={styles.quiet}> · {run.note}</span>}
          </span>
        </div>
      ))}

      {canRecord && open && (
        <div style={{ marginTop: 16 }}>
          <RunForm
            orderId={orderId}
            initialStage="PRODUCER"
            onDone={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </div>
      )}
    </section>
  );
}
