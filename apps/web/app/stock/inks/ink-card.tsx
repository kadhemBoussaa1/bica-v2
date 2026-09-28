"use client";

import { useTranslations } from "next-intl";
import { Button } from "@repo/ui/button";
import { formatDay } from "../../../i18n/formats";
import { formatQty, InkMeter, inkLevel, LevelPill, swatchStyle, type InkRow } from "./ink-ui";
import styles from "./inks.module.css";

/**
 * One colour on the shelf: its swatch, balance against its threshold, and
 * the two balance actions. The whole card opens the drawer; the name is the
 * real button, so the card is reachable by keyboard without nesting the
 * action buttons inside another button.
 */
export function InkCard({
  colour,
  canWrite,
  onOpen,
  onRestock,
  onAdjust,
}: {
  colour: InkRow;
  canWrite: boolean;
  onOpen: () => void;
  onRestock: () => void;
  onAdjust: () => void;
}) {
  const t = useTranslations("stock");
  const units = useTranslations("enums");
  const level = inkLevel(colour);
  const unit = units(`inkUnit.${colour.unit}`);
  const threshold = colour.alertThreshold;

  // What the figure means against the threshold, beside the figure.
  const standing =
    level === "out"
      ? t("inks.v3.standing.out")
      : level === "low" && threshold !== null
        ? colour.stock < threshold
          ? t("inks.v3.standing.under", { qty: formatQty(threshold - colour.stock), unit })
          : t("inks.v3.standing.at")
        : level === "ok" && threshold
          ? t("inks.v3.standing.cover", { times: formatQty(Math.round((colour.stock / threshold) * 10) / 10) })
          : null;

  return (
    <article
      className={[styles.card, styles[`card_${level}`]].filter(Boolean).join(" ")}
      onClick={onOpen}
    >
      <div className={styles.swatch} style={swatchStyle(colour.hex)}>
        <span className={styles.codePill}>
          <bdi>{colour.code}</bdi>
        </span>
        <span className={styles.swatchPill}>
          <LevelPill level={level} />
        </span>
      </div>

      <div className={styles.cardBody}>
        <div>
          <button
            type="button"
            className={styles.cardName}
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
          >
            {colour.name ?? colour.code}
          </button>
          <div className={styles.cardMeta}>
            {colour._count.usages === 0 ? t("inks.v3.neverUsed") : t("inks.v3.usedTimes", { count: colour._count.usages })}
          </div>
        </div>

        <div>
          <div className={styles.figureRow}>
            <span className={[styles.figure, styles[`figure_${level}`]].filter(Boolean).join(" ")}>
              {formatQty(colour.stock)}
            </span>
            <span className={styles.figureUnit}>{unit}</span>
            {standing && (
              <span className={[styles.standing, styles[`standing_${level}`]].filter(Boolean).join(" ")}>
                {standing}
              </span>
            )}
          </div>
          <InkMeter stock={colour.stock} alertThreshold={threshold} level={level} />
          <div className={styles.meterLegend}>
            <span>
              {threshold === null
                ? t("inks.v3.noThreshold")
                : t("inks.v3.alertAt", { qty: formatQty(threshold), unit })}
            </span>
            <LastEvent colour={colour} level={level} />
          </div>
        </div>

        {canWrite && (
          <div className={styles.cardActions}>
            <Button
              variant={level === "out" || level === "low" ? "primary" : "secondary"}
              className={styles.restock}
              onClick={(event) => {
                event.stopPropagation();
                onRestock();
              }}
            >
              {t("inks.v3.restock")}
            </Button>
            <Button
              onClick={(event) => {
                event.stopPropagation();
                onAdjust();
              }}
            >
              {t("inks.adjust")}
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * The last thing that happened to the balance: when it ran out, was
 * delivered, counted, archived, or opened. Nothing when there is no record.
 */
function LastEvent({ colour, level }: { colour: InkRow; level: ReturnType<typeof inkLevel> }) {
  const t = useTranslations("stock");
  const movement = colour.movements[0];
  const lastDraw = colour.usages[0];
  if (level === "out" && lastDraw) {
    return <bdi>{t("inks.v3.last.ranOut", { date: formatDay(lastDraw.usedAt) })}</bdi>;
  }
  if (!movement) return null;
  return <bdi>{t(`inks.v3.last.${movement.kind}`, { date: formatDay(movement.at) })}</bdi>;
}
