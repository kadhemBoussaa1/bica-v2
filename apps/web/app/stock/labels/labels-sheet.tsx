"use client";

import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import { rollScanUrl } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { formatPercent, numberFormat } from "../../../i18n/formats";
import { useTRPC } from "../../trpc/client";
import { labelOrigin } from "./label-origin";
import records from "../../records/records.module.css";
import styles from "./labels.module.css";

type LabelRoll = inferRouterOutputs<AppRouter>["stock"]["rollLabels"][number];

// Fixed decimals, so the remaining and initial lines line up figure for figure.
const metresFmt = () => numberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kgFmt = () => numberFormat({ minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * "1 970,77 m · 163,2 kg", one `<bdi>` per figure so Arabic keeps each value
 * beside its unit. A figure that is not known is left out; null when neither is.
 */
function figureParts(metres: number | null, kg: number | null): string[] {
  return [
    metres === null ? null : `${metresFmt().format(metres)} m`,
    kg === null ? null : `${kgFmt().format(kg)} kg`,
  ].filter((part): part is string => part !== null);
}

function Figures({ metres, kg }: { metres: number | null; kg: number | null }) {
  const parts = figureParts(metres, kg);
  if (parts.length === 0) return null;
  return parts.map((part, index) => (
    <span key={part}>
      {index > 0 && " · "}
      <bdi>{part}</bdi>
    </span>
  ));
}

/**
 * The share left, never rounded to a figure that says the wrong thing: a reel
 * with 6 m of 5 984 left is "< 1 %", not "0 %", and one with a few metres
 * cut off is "> 99 %", not "100 %".
 */
function shareText(share: number): string {
  if (share > 0 && share < 0.005) return `< ${formatPercent(0.01)}`;
  if (share < 1 && share >= 0.995) return `> ${formatPercent(0.99)}`;
  return formatPercent(share);
}

/** What the hidden print frame tells the dialog that opened it. */
export const LABELS_PRINT_MESSAGE = "bp-labels-print";
export type LabelsPrintOutcome = "printed" | "failed";

/**
 * The printable sheet: one 100 × 50 mm sticker per reel ("Roll Label" 1b in
 * the design project), pure black on white for a thermal printer.
 *
 * The QR encodes the reel id and nothing else — a URL, so a phone camera
 * opens the reel without the app being involved, and short enough to stay
 * readable at error-correction level M on a 36 mm square. Everything else on
 * the label is for a human holding a reel whose code will not scan: the reel
 * number finds it in the app's search.
 */
export function LabelsSheet({
  shipmentId,
  rollIds,
  title,
  onPrint = () => window.print(),
  printing = false,
  autoPrint = false,
  onClose,
}: {
  shipmentId?: string;
  rollIds?: readonly string[];
  /** The page's heading; left out in the dialog, whose head already says it. */
  title?: string;
  /** The dialog prints through a frame (`LabelsDialog`); the page prints itself. */
  onPrint?: () => void;
  printing?: boolean;
  /** Print as soon as the stickers are drawn — the dialog's hidden frame. */
  autoPrint?: boolean;
  /** In the dialog: puts the actions under the preview, with Close beside Print. */
  onClose?: () => void;
}) {
  const t = useTranslations("stock");
  const common = useTranslations("common");
  const trpc = useTRPC();

  const hasTarget = Boolean(shipmentId) !== Boolean(rollIds && rollIds.length > 0);
  const labelsQuery = useQuery({
    ...trpc.stock.rollLabels.queryOptions(
      shipmentId ? { shipmentId } : { rollIds: [...(rollIds ?? [])] },
    ),
    enabled: hasTarget,
  });

  const drawn = labelsQuery.data !== undefined && labelsQuery.data.length > 0;
  const failed = labelsQuery.isError || labelsQuery.data?.length === 0 || !hasTarget;
  useEffect(() => {
    if (!autoPrint) return;
    let sent = false;
    const report = (outcome: LabelsPrintOutcome) => {
      if (sent || window.parent === window) return;
      sent = true;
      window.parent.postMessage({ type: LABELS_PRINT_MESSAGE, outcome }, window.location.origin);
    };
    if (failed) {
      report("failed");
      return;
    }
    if (!drawn) return;
    let cancelled = false;
    // Fonts first, or the sticker prints in a fallback face with other widths.
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      window.addEventListener("afterprint", () => report("printed"), { once: true });
      window.print();
      // Desktop browsers return once the print dialog closes; some return at
      // once and fire `afterprint` later. `sent` keeps it to one report.
      report("printed");
    });
    return () => {
      cancelled = true;
    };
  }, [autoPrint, drawn, failed]);

  if (!hasTarget) return <EmptyState title={t("labels.missingParams")} />;
  if (labelsQuery.isPending) return <p className={records.muted}>{t("labels.loading")}</p>;

  if (labelsQuery.isError) {
    return (
      <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
        {labelsQuery.error.message}
      </p>
    );
  }

  if (labelsQuery.data.length === 0) return <EmptyState title={t("labels.empty")} />;

  const origin = labelOrigin();

  const count = (
    <span className={styles.note}>
      {t("labels.count", { count: labelsQuery.data.length })} — {t("labels.sheetNote")}
    </span>
  );
  const print = (
    <Button variant="primary" onClick={onPrint} busy={printing}>
      {t("labels.print")}
    </Button>
  );
  const sheet = (
    <div className={styles.sheet}>
      {labelsQuery.data.map((roll) => (
        <RollLabel key={roll.id} roll={roll} origin={origin} />
      ))}
    </div>
  );

  if (onClose) {
    return (
      <>
        {count}
        {sheet}
        <div className={records.formActions}>
          <Button variant="secondary" onClick={onClose}>
            {common("close")}
          </Button>
          {print}
        </div>
      </>
    );
  }

  return (
    <>
      <div className={styles.toolbar}>
        {title && <h1>{title}</h1>}
        {count}
        {print}
      </div>
      {sheet}
    </>
  );
}

/**
 * One sticker. The floor reads it in this order: reel number, what is left,
 * grammage and width, then where it came from.
 */
function RollLabel({ roll, origin }: { roll: LabelRoll; origin: string }) {
  const t = useTranslations("stock");

  // A legacy reel can have no recorded length or weight, and its `…Restant`
  // column then reads 0 — leave that figure out rather than print "0 m" on a
  // full reel. The share left goes by length, the unit stock is managed in.
  const metresLeft = roll.metrage === null ? null : roll.metrageRestant;
  const kgLeft = roll.poids === null ? null : roll.poidsRestant;
  const base = roll.metrage ?? roll.poids;
  const left = roll.metrage === null ? kgLeft : metresLeft;
  const share =
    base === null || left === null || base <= 0 ? null : Math.min(1, Math.max(0, left / base));
  const known = metresLeft !== null || kgLeft !== null;
  const numero = roll.numero ?? "—";

  return (
    <article className={styles.label}>
      <div className={styles.qrColumn}>
        <QRCodeSVG
          className={styles.qr}
          value={rollScanUrl(origin, roll.id)}
          level="M"
          size={136}
        />
      </div>

      <div className={styles.body}>
        <div className={styles.head}>
          {/* `<bdi>` on every code: in Arabic "5." would otherwise print as ".5". */}
          <bdi
            className={[
              styles.numero,
              numero.length > 13 ? styles.numeroLonger : numero.length > 9 ? styles.numeroLong : null,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {numero}
          </bdi>
          {roll.paperGrade && <bdi className={styles.grade}>{roll.paperGrade}</bdi>}
        </div>

        <div className={styles.spec}>
          <div className={styles.cell}>
            <span className={styles.key}>{t("labels.grammage")}</span>
            <span className={styles.specValue}>{roll.grammage ?? "—"}</span>
          </div>
          <div className={styles.cell}>
            <span className={styles.key}>{t("labels.width")}</span>
            <span className={styles.specValue}>{roll.laize ?? "—"}</span>
          </div>
        </div>

        <div className={styles.remaining}>
          <span className={styles.key}>
            {t("labels.remaining")}
            {share !== null && (
              <>
                {" · "}
                <bdi>{shareText(share)}</bdi>
              </>
            )}
          </span>
          <span
            className={[
              styles.figures,
              // "17 873,02 m · 1 126,0 kg" is wider than the column at full size.
              figureParts(metresLeft, kgLeft).join(" · ").length > 18 ? styles.figuresLong : null,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {known ? <Figures metres={metresLeft} kg={kgLeft} /> : "—"}
          </span>
          {known && (
            <span className={styles.initial}>
              {t("labels.initialOf")} <Figures metres={roll.metrage} kg={roll.poids} />
            </span>
          )}
        </div>

        <div className={styles.origin}>
          <bdi className={styles.supplier}>{roll.importShipment?.supplier.name}</bdi>
          <bdi className={styles.shipment}>{roll.importShipment?.numeroImport}</bdi>
        </div>
      </div>
    </article>
  );
}
