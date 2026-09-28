"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Skeleton } from "@repo/ui/skeleton";
import { useTRPC } from "../../trpc/client";
import records from "../../records/records.module.css";
import { formatDay } from "../../../i18n/formats";
import {
  formatDelta,
  formatQty,
  InkMeter,
  inkLevel,
  LevelPill,
  swatchStyle,
  type InkDetail,
  type InkRow,
} from "./ink-ui";
import styles from "./inks.module.css";

type HistoryRow = InkDetail["history"][number];

const ICONS: Record<HistoryRow["kind"], string> = {
  DELIVERY: "+",
  USAGE: "−",
  ADJUSTMENT: "=",
  OPENING: "○",
  ARCHIVED: "·",
  RESTORED: "·",
};

/**
 * A colour's drawer (`Ink stock v3.dc.html`): its balance against the
 * threshold, how fast it goes, the balance actions, and every movement —
 * the ledger's deliveries, counts and archive events merged with the
 * orders' usage lines by `ink.detail`. A native `<dialog>`, like the
 * employee drawer, so focus trap and Escape come from the browser.
 */
export function InkDrawer({
  id,
  canWrite,
  onClose,
  onRestock,
  onAdjust,
  onEdit,
  onChanged,
}: {
  id: string;
  canWrite: boolean;
  onClose: () => void;
  onRestock: (colour: InkRow) => void;
  onAdjust: (colour: InkRow) => void;
  onEdit: (colour: InkRow) => void;
  onChanged: (message: string) => void | Promise<void>;
}) {
  const t = useTranslations("stock");
  const common = useTranslations("common");
  const units = useTranslations("enums");
  const trpc = useTRPC();
  const ref = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detailQuery = useQuery(trpc.ink.detail.queryOptions({ id }));

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const setActive = useMutation(
    trpc.ink.setActive.mutationOptions({
      onSuccess: async (colour) => {
        setConfirming(false);
        await onChanged(t(colour.active ? "inks.v3.restoredToast" : "inks.v3.archivedToast", { code: colour.code }));
      },
      onError: (cause) => setError(cause.message),
    }),
  );

  const data = detailQuery.data;
  const colour = data?.colour;
  const level = colour ? inkLevel(colour) : "ok";
  const unit = colour ? units(`inkUnit.${colour.unit}`) : "";

  return (
    <dialog
      ref={ref}
      className={styles.drawer}
      onClose={onClose}
      aria-labelledby="ink-drawer-title"
    >
      <div className={styles.drawerSwatch} style={colour ? swatchStyle(colour.hex) : undefined}>
        <button type="button" className={styles.drawerClose} onClick={onClose} aria-label={common("close")}>
          ×
        </button>
        {colour && (
          <span className={styles.drawerCode}>
            <bdi>{colour.code}</bdi>
          </span>
        )}
      </div>

      <div className={styles.drawerBody}>
        {detailQuery.isPending && (
          <>
            <Skeleton width="60%" height={28} />
            <Skeleton width="100%" height={140} />
          </>
        )}
        {detailQuery.isError && (
          <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
            {detailQuery.error.message}
          </p>
        )}

        {data && colour && (
          <>
            <div>
              <div className={styles.drawerHeading}>
                <h2 id="ink-drawer-title" className={styles.drawerTitle}>
                  {colour.name ?? colour.code}
                </h2>
                <LevelPill level={level} soft />
              </div>
              <div className={styles.cardMeta}>
                {data.orderCount === 0
                  ? t("inks.v3.neverOnOrder")
                  : t("inks.v3.usedOnOrders", { count: data.orderCount })}
              </div>
            </div>

            <div className={styles.balance}>
              <div className={styles.figureRow}>
                <span className={[styles.figure, styles.figureLarge, styles[`figure_${level}`]].filter(Boolean).join(" ")}>
                  {formatQty(colour.stock)}
                </span>
                <span className={styles.figureUnit}>{t("inks.v3.onShelf", { unit })}</span>
              </div>
              <InkMeter stock={colour.stock} alertThreshold={colour.alertThreshold} level={level} size="large" />
              <div className={styles.facts}>
                <Fact
                  label={t("inks.form.alertThreshold")}
                  value={colour.alertThreshold === null ? "—" : `${formatQty(colour.alertThreshold)} ${unit}`}
                />
                <Fact
                  label={t("inks.v3.perMonth")}
                  value={data.perMonth === null ? "—" : `${formatQty(Math.round(data.perMonth * 10) / 10)} ${unit}`}
                />
                <Fact
                  label={t("inks.v3.lasts")}
                  value={
                    colour.stock <= 0
                      ? t("inks.v3.standing.out")
                      : data.weeksLeft === null
                        ? "—"
                        : t("inks.v3.weeks", { count: Math.max(1, Math.round(data.weeksLeft)) })
                  }
                  tone={level}
                />
              </div>
            </div>

            {canWrite && (
              <div className={styles.drawerActions}>
                <Button variant="primary" className={styles.grow} onClick={() => onRestock(colour)}>
                  {t("inks.v3.restock")}
                </Button>
                <Button onClick={() => onAdjust(colour)}>{t("inks.adjust")}</Button>
                <Button onClick={() => onEdit(colour)}>{common("edit")}</Button>
              </div>
            )}

            <section>
              <h3 className={styles.historyTitle}>{t("inks.v3.history")}</h3>
              {data.history.length === 0 ? (
                <p className={styles.fieldHint}>{t("inks.v3.noHistory")}</p>
              ) : (
                <ol className={styles.history}>
                  {data.history.map((row) => (
                    <HistoryItem key={`${row.kind}-${row.id}`} row={row} unit={unit} />
                  ))}
                </ol>
              )}
            </section>

            {canWrite && (
              <>
                {error && (
                  <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
                    {error}
                  </p>
                )}
                <Button
                  variant={colour.active ? "danger" : "secondary"}
                  className={styles.archive}
                  onClick={() => {
                    setError(null);
                    setConfirming(true);
                  }}
                >
                  {colour.active ? t("inks.v3.archive") : t("inks.v3.restore")}
                </Button>
                <Dialog
                  open={confirming}
                  title={colour.active ? t("inks.archiveTitle") : t("inks.restoreTitle")}
                  confirmLabel={colour.active ? common("archive") : common("restore")}
                  destructive={colour.active}
                  busy={setActive.isPending}
                  onConfirm={() => setActive.mutate({ id: colour.id, active: !colour.active })}
                  onClose={() => !setActive.isPending && setConfirming(false)}
                >
                  {t.rich(colour.active ? "inks.archiveBody" : "inks.restoreBody", {
                    code: colour.code,
                    strong: (chunks) => <strong>{chunks}</strong>,
                  })}
                </Dialog>
              </>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={styles.fact}>
      <div className={styles.factLabel}>{label}</div>
      <div className={[styles.factValue, tone ? styles[`figure_${tone}`] : null].filter(Boolean).join(" ")}>{value}</div>
    </div>
  );
}

function HistoryItem({ row, unit }: { row: HistoryRow; unit: string }) {
  const t = useTranslations("stock");
  const date = formatDay(row.at);
  const by = row.by;

  const label =
    row.kind === "USAGE" && row.order ? (
      <Link href={`/orders/${row.order.id}`} className={styles.historyLink}>
        {t("inks.v3.move.USAGE", { order: row.order.numero })}
      </Link>
    ) : row.kind === "ADJUSTMENT" && row.reason ? (
      t("inks.v3.move.ADJUSTMENT_reason", { reason: t(`inks.v3.reasons.${row.reason}`) })
    ) : (
      t(`inks.v3.move.${row.kind}`, { order: "" })
    );

  const meta = [
    row.kind === "DELIVERY" ? t("inks.v3.moveMeta.received", { date }) : row.kind === "USAGE" ? t("inks.v3.moveMeta.used", { date }) : date,
    row.receiptRef,
    by,
  ].filter(Boolean);

  return (
    <li className={styles.historyRow}>
      <span className={[styles.historyIcon, styles[`historyIcon_${row.kind}`]].filter(Boolean).join(" ")} aria-hidden="true">
        {ICONS[row.kind]}
      </span>
      <span className={styles.historyText}>
        <span className={styles.historyLabel}>{label}</span>
        <span className={styles.historyMeta}>
          {meta.map((part, index) => (
            <span key={index}>
              {index > 0 && " · "}
              <bdi>{part}</bdi>
            </span>
          ))}
        </span>
      </span>
      <span className={styles.historyFigures}>
        {row.kind !== "ARCHIVED" && row.kind !== "RESTORED" && (
          <span className={[styles.delta, row.delta > 0 ? styles.deltaUp : row.delta < 0 ? styles.deltaDown : null].filter(Boolean).join(" ")}>
            <bdi>{formatDelta(row.delta)}</bdi>
          </span>
        )}
        {row.after !== null && (
          <span className={styles.historyAfter}>
            <span className={styles.arrow} aria-hidden="true">
              →
            </span>{" "}
            <bdi>
              {formatQty(row.after)} {unit}
            </bdi>
          </span>
        )}
      </span>
    </li>
  );
}
