"use client";

import { useTranslations } from "next-intl";
import type { WorkshopStage } from "@repo/api-contract";
import { stageClass, stageUnit, type MonthTotals } from "../production/production-shared";
import { formatMonth, formatMonthName, formatMonthShort, formatPercent, numberFormat } from "../../i18n/formats";
import { Panel } from "./section";
import { rangeIndices, type Range, type Summary } from "./summary";
import styles from "./dashboard.module.css";

const int = () => numberFormat({ maximumFractionDigits: 0 });

type Figure = Exclude<keyof MonthTotals, "month">;

/** The four stations in flow order, each with its headline and its label. */
const STAGES = [
  { stage: "PRINTING", figure: "metersPrinted", label: "printed" },
  { stage: "PRODUCER", figure: "piecesProduced", label: "produced" },
  { stage: "QUALITY_CONTROL", figure: "piecesControlled", label: "controlled" },
  { stage: "PACKAGING", figure: "parcelsClosed", label: "parcelsClosed" },
] as const satisfies ReadonlyArray<{ stage: WorkshopStage; figure: Figure; label: string }>;

/** Tallest bar, in px; a month with any output keeps 4px, an empty one 2px. */
const BAR_MAX = 44;

/**
 * The flow from printing to packing over the chosen range, one card per
 * station, then how the produced pieces broke down.
 *
 * The card's figure is the range's sum; its bars are always the twelve
 * months, the ones inside the range drawn in the station's colour. The
 * totals are `monthlyTotals`, the same fold as the production page's, so a
 * month here is that month there.
 */
export function ProductionSection({ data, range }: { data: Summary; range: Range }) {
  const t = useTranslations("dashboard.production");
  const p = useTranslations("production");
  const { months, totals } = data.production;
  const picked = new Set(rangeIndices(months, range));
  const sum = (figure: Figure) =>
    totals.reduce((acc, row, index) => (picked.has(index) ? acc + row[figure] : acc), 0);

  const inRange = months.filter((_, index) => picked.has(index));
  const first = inRange[0] ?? data.month;
  const last = inRange[inRange.length - 1] ?? data.month;
  const period = first === last ? formatMonth(first) : `${formatMonthShort(first)} – ${formatMonthShort(last)}`;

  const produced = sum("piecesProduced");
  const controlled = sum("piecesControlled");

  return (
    <Panel
      title={t("title")}
      sub={t("sub", { period })}
      links={[{ href: "/production", label: t("link") }]}
    >
      <div className={styles.stages}>
        {STAGES.map((entry, index) => {
          const values = totals.map((row) => row[entry.figure]);
          const unit = stageUnit(entry.stage, p);
          const firstWithData = values.findIndex((value) => value > 0);
          const peak = values.indexOf(Math.max(...values));
          // Control above production is not wrong, but it asks a question:
          // pieces controlled that this range never produced.
          const overControlled = entry.stage === "QUALITY_CONTROL" && controlled > produced;
          const note = overControlled
            ? t("moreThanProduced")
            : firstWithData === -1
              ? t("nothing")
              : firstWithData > 0
                ? t("since", { month: formatMonth(months[firstWithData] ?? data.month) })
                : t.rich("peak", {
                    month: formatMonthShort(months[peak] ?? data.month),
                    // Isolated: "1 812 065 pcs" must not reorder in an Arabic line.
                    figure: () => (
                      <bdi>
                        {int().format(values[peak] ?? 0)} {unit}
                      </bdi>
                    ),
                  });
          return (
            <div
              key={entry.stage}
              className={[styles.stage, stageClass(entry.stage)].filter(Boolean).join(" ")}
            >
              <div className={styles.stageHead}>
                <span className={styles.step}>{index + 1}</span>
                <span className={styles.stageLabel}>{p(entry.label)}</span>
              </div>
              <div className={styles.stageFigure}>
                <span className={styles.stageValue}>{int().format(sum(entry.figure))}</span>
                <span className={styles.stageUnit}>{unit}</span>
              </div>
              <div
                className={styles.bars}
                role="img"
                aria-label={months
                  .map((month, i) => `${formatMonth(month)}: ${int().format(values[i] ?? 0)} ${unit}`)
                  .join(", ")}
              >
                {values.map((value, i) => (
                  <span
                    key={months[i]}
                    title={`${formatMonth(months[i] ?? "")} · ${int().format(value)} ${unit}`}
                    className={[
                      styles.bar,
                      value === 0 ? styles.barEmpty : picked.has(i) ? styles.barInRange : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={{
                      height: value === 0 ? 2 : Math.max(4, Math.round((value / Math.max(...values)) * BAR_MAX)),
                    }}
                  />
                ))}
              </div>
              <div className={styles.barMonths} aria-hidden="true">
                <span>{formatMonthName(months[0] ?? data.month)}</span>
                <span>{formatMonthName(data.month)}</span>
              </div>
              <div className={[styles.stageNote, overControlled ? styles.noteWarn : null].filter(Boolean).join(" ")}>
                {note}
              </div>
            </div>
          );
        })}
      </div>

      <Quality
        produced={produced}
        good={sum("goodPieces")}
        toFix={sum("piecesToFix")}
        waste={sum("wastePieces")}
      />
    </Panel>
  );
}

/**
 * How the produced pieces broke down, on ONE denominator — the same rule as
 * the production page's flow panel: good and to-fix split the produced
 * figure, waste is beside it, and whatever the shift did not classify is
 * its own "not broken down" share rather than silently stretched over. A
 * large unclassified share gets the callout, because it is what keeps the
 * conformity rate low, not the quality of the bags.
 */
function Quality({
  produced,
  good,
  toFix,
  waste,
}: {
  produced: number;
  good: number;
  toFix: number;
  waste: number;
}) {
  const t = useTranslations("dashboard.production");
  const p = useTranslations("production");

  if (produced === 0) {
    return (
      <div className={styles.quality}>
        <div className={styles.qualityHead}>
          <span className={styles.qualityTitle}>{t("qualityTitle")}</span>
          <span className={styles.qualityBase}>{t("nothingProduced")}</span>
        </div>
      </div>
    );
  }

  // A breakdown larger than the produced figure would overflow the bar.
  const whole = Math.max(produced, good + toFix);
  const gap = whole - good - toFix;
  const rate = good / whole;
  const parts = [
    { key: "good", label: p("good"), value: good, className: styles.partGood },
    { key: "fix", label: p("toFix"), value: toFix, className: styles.partFix },
    ...(gap > 0 ? [{ key: "gap", label: p("notBrokenDown"), value: gap, className: styles.partGap }] : []),
  ];

  return (
    <div className={styles.quality}>
      <div className={styles.qualityHead}>
        <span className={styles.qualityTitle}>{t("qualityTitle")}</span>
        <span className={styles.qualityBase}>{t("qualityBase", { count: int().format(produced) })}</span>
        <span className={[styles.qualityRate, rate >= 0.9 ? styles.qualityRateGood : null].filter(Boolean).join(" ")}>
          {t("qualityRate", { percent: formatPercent(rate) })}
        </span>
      </div>
      <div className={styles.qualityBar} aria-hidden="true">
        {parts.map((part) => (
          <span
            key={part.key}
            className={part.className}
            style={{ width: `${(part.value / whole) * 100}%` }}
          />
        ))}
      </div>
      <div className={styles.legend}>
        {parts.map((part) => (
          <span key={part.key} className={styles.legendItem}>
            <i className={[styles.swatch, part.className].filter(Boolean).join(" ")} aria-hidden="true" />
            {part.label}
            <strong className={styles.legendValue}>{int().format(part.value)}</strong>
            <span className={styles.muted}>{formatPercent(part.value / whole)}</span>
          </span>
        ))}
        <span className={[styles.legendItem, styles.muted].filter(Boolean).join(" ")}>
          {p("waste")} {p("outsideProduced")}
          <strong className={styles.legendValueInk}>{int().format(waste)}</strong>
        </span>
      </div>
      {gap > 0 && (
        <p className={styles.callout}>
          <strong>{t("gapTitle")}</strong>
          <span>{t("gapText", { count: int().format(gap) })}</span>
        </p>
      )}
    </div>
  );
}
