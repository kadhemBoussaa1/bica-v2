"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { WORKSHOP_STAGES, type WorkshopStage } from "@repo/api-contract";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/src/trpc/trpc.router";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { TableSkeleton } from "@repo/ui/skeleton";
import { useTRPC } from "../trpc/client";
import {
  Dotted,
  FlowPanel,
  HEADLINE_OF,
  TrendCard,
  initials,
  int,
  stageClass,
  stageUnit,
} from "./production-shared";
import records from "../records/records.module.css";
import styles from "./production.module.css";
import { formatChange, formatMonth, formatMonthShort, formatPercent } from "../../i18n/formats";

/** Derived from the router, never hand-written — see the day view. */
type MonthData = inferRouterOutputs<AppRouter>["production"]["monthly"];
type Cell = MonthData["byMachine"]["PRINTING"][number]["cells"][number];

/** How far back the trend looks, the selected month included. */
const TREND_MONTHS = 12;

/** Matches the API's input: a bare `\d{2}` would let "2026-13" through. */
export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Local-time YYYY-MM, for the same reason as `isoDay`. */
export function isoMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** `month` shifted by `count` months, as YYYY-MM. Plain arithmetic, no `Date`. */
export function shiftMonth(month: string, count: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The range ends on the selected month; both views of it share one query. */
function useMonthQuery(month: string) {
  const trpc = useTRPC();
  return useQuery(
    trpc.production.monthly.queryOptions({
      from: shiftMonth(month, -(TREND_MONTHS - 1)),
      to: month,
    }),
  );
}

/** One line of a ranking: a machine, or a person at one station. */
interface RankRow {
  key: string;
  name: string;
  /** The machine's code, or the person's role. */
  detail: string;
  stage: WorkshopStage;
  cell: Cell;
}

/** Everything named that worked in the selected month — the range's last cell. */
function rankRows(data: MonthData, enums: (key: string) => string) {
  const last = data.months.length - 1;
  const machines: RankRow[] = [];
  const people: RankRow[] = [];
  for (const stage of WORKSHOP_STAGES) {
    if (stage === "PRINTING" || stage === "PRODUCER") {
      for (const row of data.byMachine[stage]) {
        const cell = row.cells[last];
        if (row.machine && cell && cell.runCount > 0) {
          machines.push({
            key: `${stage}:${row.machine.id}`,
            name: row.machine.name,
            detail: row.machine.code,
            stage,
            cell,
          });
        }
      }
    }
    for (const row of data.byPerson[stage]) {
      const cell = row.cells[last];
      if (row.person && cell && cell.runCount > 0) {
        people.push({
          key: `${stage}:${row.person.id}`,
          name: row.person.name,
          detail: enums(`role.${row.person.role}`),
          stage,
          cell,
        });
      }
    }
  }
  return { machines, people };
}

/**
 * The line beside the month navigation: entries, machines and operators in
 * the selected month. Reads the view's own query, so it costs no request.
 */
export function MonthMeta({ month }: { month: string }) {
  const t = useTranslations("production");
  const enums = useTranslations("enums");
  const { data } = useMonthQuery(month);
  const current = data?.totals[data.totals.length - 1];
  if (!data || !current || current.runCount === 0) return null;

  const { machines, people } = rankRows(data, enums);
  const machineCount = new Set(machines.map((row) => row.key.split(":")[1])).size;
  const personCount = new Set(people.map((row) => row.key.split(":")[1])).size;
  return (
    <Dotted
      className={styles.periodMeta}
      parts={[
        t("entryCount", { count: current.runCount }),
        machineCount > 0 ? t("machineCount", { count: machineCount }) : null,
        personCount > 0 ? t("operatorCount", { count: personCount }) : null,
      ]}
    />
  );
}

/**
 * Who did the selected month's work: one row per machine, or per person at
 * a station, with its share of that station's volume.
 *
 * Ordered by station, then by volume. Not by volume alone: metres, pieces
 * and parcels share no scale, so a single league table across them would
 * rank a press above a bag machine for no reason but its unit.
 */
function Ranking({
  title,
  rows,
  count,
}: {
  title: string;
  rows: RankRow[];
  /** The "5 machines" / "4 stations" that opens the summary line. */
  count: string;
}) {
  const t = useTranslations("production");
  const enums = useTranslations("enums");

  const stationSum = (stage: WorkshopStage) =>
    rows.filter((row) => row.stage === stage).reduce((sum, row) => sum + row.cell.headline, 0);
  // One sum per unit — the two piece-counting stations add up, metres do not.
  const sums = new Map<string, number>();
  for (const row of rows) {
    const unit = stageUnit(row.stage, t);
    sums.set(unit, (sums.get(unit) ?? 0) + row.cell.headline);
  }
  const ordered = [...rows].sort(
    (a, b) =>
      WORKSHOP_STAGES.indexOf(a.stage) - WORKSHOP_STAGES.indexOf(b.stage) ||
      b.cell.headline - a.cell.headline,
  );

  return (
    <section className={styles.ranking} aria-label={title}>
      <div className={styles.rankingHead}>
        <h2 className={styles.stationName}>{title}</h2>
        {rows.length > 0 && (
          <Dotted
            className={styles.unit}
            parts={[count, ...[...sums].map(([unit, sum]) => `${int().format(sum)} ${unit}`)]}
          />
        )}
      </div>
      <div className={styles.rankingRows}>
        {rows.length === 0 && <p className={styles.rankEmpty}>{t("noMonthEntries")}</p>}
        {ordered.map((row) => {
          const peers = rows.filter((other) => other.stage === row.stage).length;
          const total = stationSum(row.stage);
          const share = total > 0 ? row.cell.headline / total : 0;
          return (
            <div
              key={row.key}
              className={[styles.rankRow, stageClass(row.stage)].filter(Boolean).join(" ")}
            >
              <span className={styles.mark} aria-hidden="true">
                {initials(row.name)}
              </span>
              <span className={styles.rankWho}>
                <span className={styles.rankName}>
                  <span className={styles.operator}>{row.name}</span>
                  <span className={styles.stationPill}>{enums(`workshopStage.${row.stage}`)}</span>
                </span>
                <Dotted
                  className={styles.rankMeta}
                  parts={[
                    row.detail,
                    t("entryCount", { count: row.cell.runCount }),
                    t("activeDays", { count: row.cell.daysActive }),
                    row.cell.wastePieces > 0
                      ? t("wasteCount", { count: int().format(row.cell.wastePieces) })
                      : null,
                  ]}
                />
              </span>
              <span className={styles.rankShare}>
                {peers < 2 ? (
                  <span className={styles.rankMeta}>{t("aloneOnStation")}</span>
                ) : (
                  <>
                    <span className={styles.rankShareHead}>
                      <span className={styles.rankMeta}>{t("onStation", { count: peers })}</span>
                      <bdi className={styles.rankSharePct}>
                        {/* A real contribution never rounds down to "0 %". */}
                        {share > 0 && share < 0.01 ? `< ${formatPercent(0.01)}` : formatPercent(share)}
                      </bdi>
                    </span>
                    <span className={styles.rankTrack} aria-hidden="true">
                      <span className={styles.rankFill} style={{ width: `${share * 100}%` }} />
                    </span>
                  </>
                )}
              </span>
              <span className={styles.rankValue}>
                <span>{int().format(row.cell.headline)}</span>
                <span className={styles.rankMeta}>{stageUnit(row.stage, t)}</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The migrated volume, set apart. Every run carried over from the old system
 * has neither a machine nor an operator, so in a ranking it could only be one
 * enormous anonymous row above the real machines. It is counted here instead
 * — over the same months the trend shows — with its months one tap away.
 */
function Unattributed({ data }: { data: MonthData }) {
  const t = useTranslations("production");
  const [open, setOpen] = useState(false);

  const perMonth = data.months.map((month, index) => {
    const volumes = new Map<string, number>();
    let entries = 0;
    let days = 0;
    for (const stage of WORKSHOP_STAGES) {
      for (const row of data.byPerson[stage]) {
        const cell = row.cells[index];
        if (row.person !== null || !cell || cell.runCount === 0) continue;
        const unit = stageUnit(stage, t);
        volumes.set(unit, (volumes.get(unit) ?? 0) + cell.headline);
        entries += cell.runCount;
        days += cell.daysActive;
      }
    }
    return { month, volumes, entries, days };
  });
  const withData = perMonth.filter((row) => row.entries > 0);
  const lastMonth = withData[withData.length - 1];
  if (!lastMonth) return null;

  const volumes = new Map<string, number>();
  for (const row of withData) {
    for (const [unit, sum] of row.volumes) volumes.set(unit, (volumes.get(unit) ?? 0) + sum);
  }
  const volumeParts = (map: Map<string, number>) =>
    [...map].map(([unit, sum]) => `${int().format(sum)} ${unit}`);

  return (
    <section className={styles.apart} aria-label={t("outsideRanking")}>
      <div className={styles.apartRow}>
        <span className={styles.apartIcon} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8v4 M12 16h.01 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />
          </svg>
        </span>
        <div className={styles.apartText}>
          <div className={styles.apartEyebrow}>{t("outsideRanking")}</div>
          <div className={styles.apartTitle}>
            {t.rich("unattributedTitle", {
              volume: () => <Dotted parts={volumeParts(volumes)} />,
            })}
          </div>
          <p className={styles.apartBody}>
            {t("unattributedText", {
              entries: t("entryCount", {
                count: withData.reduce((sum, row) => sum + row.entries, 0),
              }),
              days: t("dayCount", { count: withData.reduce((sum, row) => sum + row.days, 0) }),
              month: formatMonth(lastMonth.month),
            })}
          </p>
        </div>
        <Button
          variant="secondary"
          size="dense"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? t("hideDetail") : t("seeDetail")}
        </Button>
      </div>
      {open && (
        <div className={styles.apartDetail}>
          {withData.map((row) => (
            <div key={row.month} className={styles.apartLine}>
              <span className={styles.apartMonth}>{formatMonth(row.month)}</span>
              <Dotted
                className={styles.rankMeta}
                parts={[
                  t("entryCount", { count: row.entries }),
                  t("activeDays", { count: row.days }),
                ]}
              />
              <Dotted className={styles.apartValue} parts={volumeParts(row.volumes)} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

interface MonthlyProductionProps {
  /** YYYY-MM — the selected month, and the last one of the trend. */
  month: string;
}

/**
 * The monthly production view: the selected month's flow and quality, each
 * station's trend over the twelve months ending on it, then which machines
 * and which operators did that month's work.
 *
 * Machines and operators are only known for runs recorded here (2026-09
 * on). The migrated runs have neither, so they stay out of the rankings and
 * are counted apart — see `Unattributed`.
 */
export function MonthlyProduction({ month }: MonthlyProductionProps) {
  const t = useTranslations("production");
  const enums = useTranslations("enums");
  const monthQuery = useMonthQuery(month);

  if (monthQuery.isPending) return <TableSkeleton rows={5} />;

  if (monthQuery.isError) {
    return (
      <p
        className={[records.notice, records.error].filter(Boolean).join(" ")}
        role="alert"
      >
        {monthQuery.error.message}
      </p>
    );
  }

  const data = monthQuery.data;
  if (data.totals.every((total) => total.runCount === 0)) {
    return <EmptyState title={t("nothingRecorded")} text={t("noMonthEntries")} />;
  }

  const current = data.totals[data.totals.length - 1]!;
  const previous = data.totals[data.totals.length - 2];
  // A month still running is a part month: measured against a whole one it
  // reads as a collapse, so it is labelled instead of compared.
  const partial = month === isoMonth(new Date());
  const compare = (stage: WorkshopStage) => {
    if (partial) return t("monthToDate");
    const before = previous?.[HEADLINE_OF[stage]] ?? 0;
    if (before === 0) return t("noPrevious");
    return (
      <>
        <bdi>{formatChange(current[HEADLINE_OF[stage]] / before - 1)}</bdi>{" "}
        {t("vsPreviousMonth")}
      </>
    );
  };

  const { machines, people } = rankRows(data, enums);
  const first = data.months[0] ?? month;

  return (
    <>
      <FlowPanel title={t("flowMonth")} totals={current} meta={compare} />

      <div className={styles.stations}>
        <section className={styles.panel} aria-label={t("monthsByStation", { count: data.months.length })}>
          <div className={styles.panelHead}>
            <span className={styles.eyebrow}>
              {t("monthsByStation", { count: data.months.length })}
            </span>
            <span className={styles.unit}>
              {formatMonthShort(first)} – {formatMonthShort(month)}
            </span>
          </div>
          <div className={styles.trend}>
            {WORKSHOP_STAGES.map((stage) => (
              <TrendCard
                key={stage}
                stage={stage}
                months={data.months}
                values={data.totals.map((total) => total[HEADLINE_OF[stage]])}
              />
            ))}
          </div>
        </section>

        <Ranking
          title={t("byMachine")}
          rows={machines}
          count={t("machineCount", { count: machines.length })}
        />
        <Ranking
          title={t("byOperator")}
          rows={people}
          count={t("stationCount", { count: people.length })}
        />

        <Unattributed data={data} />
      </div>
    </>
  );
}
