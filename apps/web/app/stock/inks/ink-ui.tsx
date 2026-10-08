import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import { inkStockState, type InkStockState } from "@repo/api-contract";
import { numberFormat } from "../../../i18n/formats";
import styles from "./inks.module.css";

/*
 * Shared pieces of the ink stock page (`Ink stock v3.dc.html`): the card
 * grid, the drawer and the two dialogs all judge a colour the same way.
 */

export type InkRow = inferRouterOutputs<AppRouter>["ink"]["list"]["rows"][number];
export type InkDetail = inferRouterOutputs<AppRouter>["ink"]["detail"];

/** The contract's three stock states, plus the archive, which trumps them. */
export type InkLevel = InkStockState | "archived";

export function inkLevel(colour: { active: boolean; stock: number; alertThreshold: number | null }): InkLevel {
  return colour.active ? inkStockState(colour) : "archived";
}

/** Ink is weighed to the gram at most; "2,4", "142", "0,25". */
export function formatQty(value: number): string {
  return numberFormat({ maximumFractionDigits: 2 }).format(value);
}

/** A purchase price: two decimals, three when the millimes are there. */
export function formatPrice(value: number): string {
  return numberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(value);
}

/** A signed change: "+60", "−7,5", "±0" (a real minus, not a hyphen). */
export function formatDelta(value: number): string {
  if (value === 0) return "±0";
  return `${value > 0 ? "+" : "−"}${formatQty(Math.abs(value))}`;
}

/**
 * Where the bar fills to and where the threshold mark sits, as percentages
 * of one scale: the larger of the balance, the preview balance, and three
 * times the threshold — so a colour at its threshold fills a third of the
 * bar and the mark never runs off the end.
 */
export function meterScale(stock: number, alertThreshold: number | null, preview?: number) {
  const shown = preview ?? stock;
  const max = Math.max(shown, stock, (alertThreshold ?? 0) * 3, 1);
  return {
    fill: Math.min(100, Math.max(0, (shown / max) * 100)),
    mark: alertThreshold ? (alertThreshold / max) * 100 : null,
  };
}

/** The level bar with its threshold mark; the fill's colour follows the level. */
export function InkMeter({
  stock,
  alertThreshold,
  preview,
  level,
  size = "card",
}: {
  stock: number;
  alertThreshold: number | null;
  preview?: number;
  level: InkLevel;
  size?: "card" | "large";
}) {
  const t = useTranslations("stock");
  const { fill, mark } = meterScale(stock, alertThreshold, preview);
  return (
    <span
      className={[
        styles.meter,
        size === "large" ? styles.meterLarge : null,
        styles[`meter_${level}`],
        // Without a threshold the bar has no scale — every colour would read
        // "full" — so it draws neutral rather than claiming "well stocked".
        mark === null && level !== "out" ? styles.meterUnscaled : null,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden="true"
    >
      <span className={styles.meterFill} style={{ inlineSize: `${fill}%` }} />
      {mark !== null && (
        <span className={styles.meterMark} style={{ insetInlineStart: `${mark}%` }} title={t("inks.v3.threshold")} />
      )}
    </span>
  );
}

/** The state pill: colour, dot shape and word all carry the level. */
export function LevelPill({ level, soft = false }: { level: InkLevel; soft?: boolean }) {
  const t = useTranslations("stock");
  return (
    <span className={[styles.pill, soft ? styles.pillSoft : null, styles[`pill_${level}`]].filter(Boolean).join(" ")}>
      <i className={styles.pillDot} aria-hidden="true" />
      {t(`inks.v3.level.${level}`)}
    </span>
  );
}

/** The swatch behind a card or the drawer's head; a colour with none gets the neutral ground. */
export function swatchStyle(hex: string | null): CSSProperties | undefined {
  return hex ? { background: hex } : undefined;
}
