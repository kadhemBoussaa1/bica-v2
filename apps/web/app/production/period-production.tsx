"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { WORKSHOP_STAGES, type WorkshopStage } from "@repo/api-contract";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import { EmptyState } from "@repo/ui/empty-state";
import { TableSkeleton } from "@repo/ui/skeleton";
import { useTRPC } from "../trpc/client";
import { runsOf, Station } from "./daily-production";
import { rankRows, Ranking, Unattributed } from "./monthly-production";
import { Dotted, FlowPanel, int, stageClass, stageUnit } from "./production-shared";
import records from "../records/records.module.css";
import styles from "./production.module.css";
import { dateFormat } from "../../i18n/formats";

/** Derived from the router, never hand-written — see the day view. */
type RangeData = inferRouterOutputs<AppRouter>["production"]["range"];
type DayLine = RangeData["days"][number];

/** A YYYY-MM-DD as dd/mm/yyyy, pinned to UTC like the day view's. */
function dayLabel(date: string): string {
  return dateFormat({ dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00.000Z`),
  );
}

/** The weekday's name, in the reader's language: it is a word. */
function weekday(date: string): string {
  return dateFormat({ weekday: "short", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00.000Z`),
  );
}

function useRangeQuery(from: string, to: string) {
  const trpc = useTRPC();
  return useQuery(trpc.production.range.queryOptions({ from, to }));
}

/**
 * The line beside the period's dates: entries, working days and operators.
 * Reads the view's own query, so it costs no request.
 */
export function PeriodMeta({ from, to }: { from: string; to: string }) {
  const t = useTranslations("production");
  const enums = useTranslations("enums");
  const { data } = useRangeQuery(from, to);
  if (!data || data.totals.runCount === 0) return null;

  const { people } = rankRows(data, 0, enums, t);
  const personCount = new Set(people.map((row) => row.key.split(":")[1])).size;
  return (
    <Dotted
      className={styles.periodMeta}
      parts={[
        t("entryCount", { count: data.totals.runCount }),
        t("dayCount", { count: data.days.length }),
        personCount > 0 ? t("operatorCount", { count: personCount }) : null,
      ]}
    />
  );
}

/**
 * One day's figures as the line shows them: a chip per station that
 * recorded anything, printing with both its units when a bag printer ran.
 */
function dayFigures(day: DayLine, t: (key: string) => string) {
  const figures: { stage: WorkshopStage; value: number; unit: string }[] = [];
  if (day.metersPrinted > 0) {
    figures.push({ stage: "PRINTING", value: day.metersPrinted, unit: stageUnit("PRINTING", t) });
  }
  if (day.piecesPrinted > 0) figures.push({ stage: "PRINTING", value: day.piecesPrinted, unit: "pcs" });
  if (day.piecesProduced > 0) {
    figures.push({ stage: "PRODUCER", value: day.piecesProduced, unit: stageUnit("PRODUCER", t) });
  }
  if (day.piecesControlled > 0) {
    figures.push({
      stage: "QUALITY_CONTROL",
      value: day.piecesControlled,
      unit: stageUnit("QUALITY_CONTROL", t),
    });
  }
  if (day.parcelsClosed > 0) {
    figures.push({ stage: "PACKAGING", value: day.parcelsClosed, unit: stageUnit("PACKAGING", t) });
  }
  return figures;
}

/**
 * An opened day: its entries exactly as the day view draws them, station by
 * station, from the same `daily` query — so a day here is that day there.
 * Stations with nothing that day are left out; there is no "record" offer.
 */
function DayEntries({ date }: { date: string }) {
  const trpc = useTRPC();
  const dayQuery = useQuery(trpc.production.daily.queryOptions({ date }));
  if (dayQuery.isPending) return <TableSkeleton rows={3} />;
  if (dayQuery.isError) {
    return (
      <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
        {dayQuery.error.message}
      </p>
    );
  }
  const day = dayQuery.data;
  return (
    <div className={styles.dayEntries}>
      {WORKSHOP_STAGES.map((stage) => {
        const runs = runsOf(day, stage);
        return runs.length === 0 ? null : (
          <Station key={stage} stage={stage} runs={runs} onRecord={null} />
        );
      })}
    </div>
  );
}

/**
 * The period day by day, newest first: one line per day with entries, which
 * opens to that day's entries. Only the opened days are fetched, so a year
 * stays one light list.
 */
function DayList({ days }: { days: DayLine[] }) {
  const t = useTranslations("production");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (date: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });

  return (
    <section className={styles.ranking} aria-label={t("byDay")}>
      <div className={styles.rankingHead}>
        <h2 className={styles.stationName}>{t("byDay")}</h2>
        <span className={styles.unit}>{t("dayCount", { count: days.length })}</span>
      </div>
      <div className={styles.rankingRows}>
        {days.map((day) => {
          const isOpen = open.has(day.date);
          return (
            <div key={day.date} className={styles.dayItem}>
              <button
                type="button"
                className={styles.dayLine}
                aria-expanded={isOpen}
                onClick={() => toggle(day.date)}
              >
                <span className={styles.dayChevron} aria-hidden="true">
                  {isOpen ? "▾" : "▸"}
                </span>
                <span className={styles.dayWhen}>
                  <span className={styles.dayWeekday}>{weekday(day.date)}</span>
                  <bdi className={styles.dayDateText}>{dayLabel(day.date)}</bdi>
                </span>
                <span className={styles.rankMeta}>
                  {t("entryCount", { count: day.runCount })}
                </span>
                <span className={styles.dayFigures}>
                  {dayFigures(day, t).map((figure) => (
                    <span
                      key={`${figure.stage}:${figure.unit}`}
                      className={[styles.dayFigure, stageClass(figure.stage)]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <i className={styles.dot} aria-hidden="true" />
                      <bdi>
                        {int().format(figure.value)} {figure.unit}
                      </bdi>
                    </span>
                  ))}
                </span>
              </button>
              {isOpen && <DayEntries date={day.date} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

interface PeriodProductionProps {
  /** YYYY-MM-DD, both included, owned by the view switcher's toolbar. */
  from: string;
  to: string;
}

/**
 * The period view (user, 2026-10-21): any span of days — "from 01/09 to
 * 10/10" — as the month view reads a month: the span's flow and quality,
 * which machines and which operators did the work, then the days one by one.
 *
 * The figures are `production.range`'s, the same fold as the month view
 * with the whole span as one cell, so the period 1–30 September is the
 * September of the month view, and each day line is that day's tiles.
 */
export function PeriodProduction({ from, to }: PeriodProductionProps) {
  const t = useTranslations("production");
  const enums = useTranslations("enums");
  const rangeQuery = useRangeQuery(from, to);

  if (rangeQuery.isPending) return <TableSkeleton rows={5} />;

  if (rangeQuery.isError) {
    return (
      <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
        {rangeQuery.error.message}
      </p>
    );
  }

  const data = rangeQuery.data;
  if (data.totals.runCount === 0) {
    return <EmptyState title={t("nothingRecorded")} text={t("noPeriodEntries")} />;
  }

  const { machines, people } = rankRows(data, 0, enums, t);
  const span = from === to ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)}`;

  return (
    <>
      <FlowPanel title={t("flowPeriod")} totals={data.totals} meta={() => span} />

      <div className={styles.stations}>
        <Ranking
          title={t("byMachine")}
          rows={machines}
          count={t("machineCount", { count: machines.length })}
          period
        />
        <Ranking
          title={t("byOperator")}
          rows={people}
          count={t("stationCount", { count: people.length })}
          period
        />

        <Unattributed data={{ months: [data.from], byPerson: data.byPerson }} period />

        <DayList days={data.days} />
      </div>
    </>
  );
}
