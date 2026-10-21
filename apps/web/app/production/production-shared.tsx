"use client";

import { Fragment, useState } from "react";
import { useTranslations } from "next-intl";
import { WORKSHOP_STAGES, type WorkshopStage } from "@repo/api-contract";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import styles from "./production.module.css";
import {
  formatMonth,
  formatMonthName,
  formatMonthShort,
  formatShare,
  numberFormat,
} from "../../i18n/formats";

/**
 * One month's totals, as the router returns them — derived, never
 * hand-written, so a figure added server-side reaches every reader. Shared
 * by the monthly view and the dashboard's trend (`monthlyTotals` returns
 * the same rows).
 */
export type MonthTotals = inferRouterOutputs<AppRouter>["production"]["monthly"]["totals"][number];

/** Whole figures, French grouping in every language — see `formats.ts`. */
export const int = () => numberFormat({ maximumFractionDigits: 0 });

/**
 * The station's own unit for its headline figure. `m` and `pcs` are symbols
 * and stay as they are; "parcels" is a word, so it comes from the messages.
 */
export function stageUnit(stage: WorkshopStage, t: (key: string) => string): string {
  switch (stage) {
    case "PRINTING":
      return "m";
    case "PACKAGING":
      return t("parcels");
    default:
      return "pcs";
  }
}

/**
 * One run's own unit: its station's, except a printing run on a bag printer,
 * which counts pieces (`piecesPrinted`) where a reel press counts metres.
 */
export function runUnit(
  run: { stage: WorkshopStage; piecesPrinted: number | null },
  t: (key: string) => string,
): string {
  return run.stage === "PRINTING" && run.piecesPrinted !== null ? "pcs" : stageUnit(run.stage, t);
}

/**
 * The class that carries a station's colours (`--st-*`) and its dot shape.
 * Colour plus shape, so the four stations survive a grayscale print.
 */
export function stageClass(stage: WorkshopStage): string | undefined {
  switch (stage) {
    case "PRINTING":
      return styles.stPrinting;
    case "PRODUCER":
      return styles.stProducer;
    case "QUALITY_CONTROL":
      return styles.stControl;
    case "PACKAGING":
      return styles.stPackaging;
  }
}

/**
 * Initials for a mark. Two letters where the name has two words, so
 * "Nabil Ben Ali" reads NB rather than N; the first two of a single word,
 * so a machine called "RKP4-1200" reads RK.
 */
export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0];
  if (!first) return "?";
  const second = words[1];
  return ((first[0] ?? "") + (second ? (second[0] ?? "") : (first[1] ?? ""))).toUpperCase();
}

/**
 * Parts of one line, joined by a middle dot, each in its own `<bdi>`.
 *
 * Not a plain `join(" · ")`: in Arabic a Latin unit or machine code pulls
 * the numbers around it into one left-to-right run, and "5 machines ·
 * 4 770 m · 1 700 pcs" comes out with its figures shuffled. Isolated, every
 * part keeps its own order and the parts follow the page's direction.
 */
export function Dotted({
  parts,
  className,
}: {
  parts: ReadonlyArray<React.ReactNode>;
  className?: string;
}) {
  const shown = parts.filter((part) => part !== null && part !== false && part !== "");
  return (
    <span className={className}>
      {shown.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && " · "}
          <bdi>{part}</bdi>
        </Fragment>
      ))}
    </span>
  );
}

/** The figures the flow panel reads — the part of a month's totals that a day totals to as well. */
export type FlowTotals = Pick<
  MonthTotals,
  | "metersPrinted"
  | "piecesPrinted"
  | "piecesProduced"
  | "piecesControlled"
  | "parcelsClosed"
  | "goodPieces"
  | "piecesToFix"
  | "wastePieces"
>;

/** Each station's headline, as the totals name it. */
export const HEADLINE_OF = {
  PRINTING: "metersPrinted",
  PRODUCER: "piecesProduced",
  QUALITY_CONTROL: "piecesControlled",
  PACKAGING: "parcelsClosed",
} as const satisfies Record<WorkshopStage, keyof MonthTotals>;


const FLOW = [
  { stage: "PRINTING", key: "metersPrinted", label: "printed" },
  { stage: "PRODUCER", key: "piecesProduced", label: "produced" },
  { stage: "QUALITY_CONTROL", key: "piecesControlled", label: "controlled" },
  { stage: "PACKAGING", key: "parcelsClosed", label: "parcelsClosed" },
] as const satisfies ReadonlyArray<{
  stage: (typeof WORKSHOP_STAGES)[number];
  key: keyof FlowTotals;
  label: string;
}>;

/**
 * The period's flow through the four stations, then how the produced pieces
 * broke down. The printing tile carries a second figure when a bag printer
 * ran: its pieces, which no sum may fold into the metres.
 *
 * The quality bar has ONE denominator — the produced figure its tile shows.
 * Good and to-fix split that figure; waste is counted beside it, not inside
 * it, because waste never made it into the produced count. The shift's
 * breakdown does not have to add up (see the schema note on those columns),
 * so whatever is left over is drawn as its own "not broken down" segment
 * rather than silently stretched over.
 *
 * The rate leads, then a small table carries every figure in words and
 * numbers; the bar under it only shows the proportion. A part of a few
 * pieces is a hairline on the bar, so the table — not the bar — is where
 * it is read, which is why shares keep one decimal (`formatShare`).
 */
export function FlowPanel({
  title,
  totals,
  meta,
}: {
  title: string;
  totals: FlowTotals;
  /** The line under a tile that has a figure; an empty tile says so itself. */
  meta: (stage: WorkshopStage) => React.ReactNode;
}) {
  const t = useTranslations("production");
  const produced = totals.piecesProduced;
  // A breakdown larger than the produced figure would overflow the bar.
  const whole = Math.max(produced, totals.goodPieces + totals.piecesToFix);
  const gap = whole - totals.goodPieces - totals.piecesToFix;
  const parts = [
    { key: "good", label: t("good"), value: totals.goodPieces, className: styles.good },
    { key: "fix", label: t("toFix"), value: totals.piecesToFix, className: styles.fix },
    ...(gap > 0
      ? [{ key: "gap", label: t("notBrokenDown"), value: gap, className: styles.gap }]
      : []),
  ];
  const rate = whole > 0 ? totals.goodPieces / whole : 0;
  // Nothing declared good or to fix: a rate would read "0 % conformes",
  // which says the day was all bad when it only says nobody broke it down.
  const brokenDown = totals.goodPieces + totals.piecesToFix > 0;

  return (
    <section className={styles.panel} aria-label={title}>
      <div className={styles.eyebrow}>{title}</div>
      <div className={styles.flow}>
        {FLOW.map((tile) => {
          const figures = [{ value: totals[tile.key], unit: stageUnit(tile.stage, t) }];
          if (tile.stage === "PRINTING" && totals.piecesPrinted > 0) {
            figures.push({ value: totals.piecesPrinted, unit: "pcs" });
          }
          // A bag printer alone: its pieces, not a "0 m" above them.
          const shown = figures.length > 1 && figures[0]?.value === 0 ? figures.slice(1) : figures;
          const value = shown.reduce((sum, figure) => sum + figure.value, 0);
          return (
            <div
              key={tile.stage}
              className={[
                styles.flowTile,
                stageClass(tile.stage),
                value === 0 ? styles.flowTileEmpty : null,
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className={styles.flowLabel}>
                <i className={styles.dot} aria-hidden="true" />
                {t(tile.label)}
              </span>
              {shown.map((figure) => (
                <span key={figure.unit} className={styles.flowFigure}>
                  <span className={styles.flowValue}>{int().format(figure.value)}</span>
                  <span className={styles.unit}>{figure.unit}</span>
                </span>
              ))}
              <span className={styles.flowMeta}>
                {value === 0 ? t("nothingEntered") : meta(tile.stage)}
              </span>
            </div>
          );
        })}
      </div>

      {produced > 0 && (
        <div className={styles.quality}>
          <div className={[styles.eyebrow, styles.qualityTitle].filter(Boolean).join(" ")}>
            {t("qualityTitle")}
          </div>
          <div className={styles.qualityBody}>
            <div className={styles.qualitySummary}>
              {brokenDown ? (
                <span className={styles.qualityFigure}>
                  <bdi
                    className={[styles.qualityRate, rate >= 0.9 ? styles.qualityRateGood : null]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {formatShare(rate)}
                  </bdi>
                  <span className={styles.qualityRateWord}>{t("conformWord")}</span>
                </span>
              ) : (
                <span className={styles.qualityNone}>{t("notBrokenDown")}</span>
              )}
              <span className={styles.qualityBase}>
                {t.rich(brokenDown ? "conformBase" : "noBreakdownBase", {
                  good: int().format(totals.goodPieces),
                  count: int().format(produced),
                  b: (chunks) => <bdi className={styles.qualityBaseFigure}>{chunks}</bdi>,
                })}
              </span>
            </div>

            <table className={styles.qualityTable} aria-label={t("qualityTitle")}>
              <thead className="sr-only">
                <tr>
                  <th scope="col">{t("qualityCategory")}</th>
                  <th scope="col">{t("qualityPieces")}</th>
                  <th scope="col">{t("qualityShare")}</th>
                </tr>
              </thead>
              <tbody>
                {parts.map((part) => (
                  <tr
                    key={part.key}
                    data-part={part.key}
                    className={[styles.qualityRow, part.className].filter(Boolean).join(" ")}
                  >
                    <th scope="row" className={styles.qualityLabel}>
                      <i className={styles.legendDot} aria-hidden="true" />
                      {part.label}
                    </th>
                    <td className={styles.qualityCount}>{int().format(part.value)}</td>
                    <td className={styles.qualityShare}>
                      <bdi>{formatShare(part.value / whole)}</bdi>
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Its own body: waste is counted beside the produced figure, not inside it. */}
              <tbody className={styles.qualityApart}>
                <tr
                  data-part="waste"
                  className={[styles.qualityRow, styles.waste].filter(Boolean).join(" ")}
                >
                  <th scope="row" className={styles.qualityLabel}>
                    <i className={styles.legendDot} aria-hidden="true" />
                    {t("waste")}
                  </th>
                  <td className={styles.qualityCount}>{int().format(totals.wastePieces)}</td>
                  <td className={styles.qualityShare}>
                    <span className={styles.qualityAside}>{t("outsideProduced")}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className={styles.qualityBar} aria-hidden="true">
            {parts
              .filter((part) => part.value > 0)
              .map((part) => (
                <span
                  key={part.key}
                  data-part={part.key}
                  className={[styles.qualitySeg, part.className].filter(Boolean).join(" ")}
                  style={{ "--grow": part.value } as React.CSSProperties}
                />
              ))}
          </div>
          {gap > 0 && brokenDown && (
            <p className={styles.qualityNote}>
              {t("gapNote", { count: int().format(gap) })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * One station's months as a strip of bars — a card per station rather than
 * one chart, because the four stations count in different units and a shared
 * axis would flatten three of them against the fourth.
 *
 * The figure in the card's head follows the bar under the pointer, or the
 * one last tapped: a `title` tooltip never opens on a touch screen, and this
 * is the only place an earlier month's figure can be read.
 */
export function TrendCard({
  stage,
  months,
  values,
}: {
  stage: WorkshopStage;
  months: string[];
  values: number[];
}) {
  const t = useTranslations("production");
  const enums = useTranslations("enums");
  const last = months.length - 1;
  const [picked, setPicked] = useState<number | null>(null);
  const shown = picked !== null && picked <= last ? picked : last;

  const unit = stageUnit(stage, t);
  const max = Math.max(...values, 0);
  const active = values.filter((value) => value > 0);
  const only = active.length === 1 ? months[values.findIndex((value) => value > 0)] : undefined;
  const note =
    active.length === 0
      ? t("nothingEntered")
      : only
        ? t("singleMonthNote", { month: formatMonth(only) })
        : t.rich("activeMonthsNote", {
            active: active.length,
            total: months.length,
            // Isolated: "1 812 065 pcs" must not reorder inside an Arabic line.
            peak: () => (
              <bdi>
                {int().format(max)} {unit}
              </bdi>
            ),
          });

  return (
    <div className={[styles.trendCard, stageClass(stage)].filter(Boolean).join(" ")}>
      <div className={styles.trendHead}>
        <span className={styles.flowLabel}>
          <i className={styles.dot} aria-hidden="true" />
          {enums(`workshopStage.${stage}`)}
        </span>
        <span className={styles.trendFigure}>
          {shown !== last && (
            <span className={styles.unit}>{formatMonthShort(months[shown] ?? "")}</span>
          )}
          <span className={styles.trendValue}>{int().format(values[shown] ?? 0)}</span>
          <span className={styles.unit}>{unit}</span>
        </span>
      </div>
      <div
        className={styles.trendBars}
        role="img"
        aria-label={months
          .map((month, index) => `${formatMonth(month)}: ${int().format(values[index] ?? 0)} ${unit}`)
          .join(", ")}
        onMouseLeave={() => setPicked(null)}
      >
        {months.map((month, index) => {
          const value = values[index] ?? 0;
          return (
            <span
              key={month}
              className={styles.trendSlot}
              title={`${formatMonth(month)} — ${int().format(value)} ${unit}`}
              onMouseEnter={() => setPicked(index)}
              onClick={() => setPicked(index)}
            >
              <span
                className={[
                  styles.trendBar,
                  index === last ? styles.trendBarSelected : null,
                  index === shown && shown !== last ? styles.trendBarPicked : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                // A month with any output keeps a visible sliver.
                style={{ height: value > 0 ? `max(2px, ${(value / max) * 100}%)` : 0 }}
              />
            </span>
          );
        })}
      </div>
      <div className={styles.trendMonths} aria-hidden="true">
        {months.map((month, index) => (
          <span
            key={month}
            className={[styles.trendMonth, index === last ? styles.trendMonthSelected : null]
              .filter(Boolean)
              .join(" ")}
          >
            {/* Every other month, counted from the end, so the selected
                month always keeps its own label. */}
            {(last - index) % 2 === 0 ? formatMonthName(month) : ""}
          </span>
        ))}
      </div>
      <div className={styles.trendNote}>{note}</div>
    </div>
  );
}
