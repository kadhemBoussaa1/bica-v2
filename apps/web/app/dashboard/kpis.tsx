"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { addDays } from "@repo/api-contract";
import { numberFormat } from "../../i18n/formats";
import { stageClass, stageUnit } from "../production/production-shared";
import { formatShiftDate, formatWeekdayLong } from "../shifts/week";
import { STAGES } from "./production-section";
import { Dot, type DotTone } from "./section";
import { countOf, type Summary } from "./summary";
import styles from "./dashboard.module.css";

const int = () => numberFormat({ maximumFractionDigits: 0 });

/**
 * Five tiles under the to-do list: what is being made, the floor's tickets,
 * late sales money, the planner's inbox, and the last production day's
 * output. Paper on hand is not a tile any more — the stock panel leads with
 * it.
 *
 * The row's columns follow its own width (a container query in the
 * stylesheet), not the viewport: the production tile is two tiles wide,
 * so the row is one line when there is room for six, and otherwise the
 * four tiles keep their line and the production tile takes the next.
 */
export function Kpis({ data }: { data: Summary }) {
  const t = useTranslations("dashboard.kpis");
  const status = (key: string) => data.orders.byStatus.find((row) => row.status === key)?.count ?? 0;
  const inProduction = status("IN_PRODUCTION");
  const produced = status("PRODUCED");
  const { open, done, missed } = data.shifts.tickets;
  const tickets = open + done;
  const overdue = countOf(data.money.sales.overdue);
  const issued = countOf(data.money.sales.unpaid);
  const pending = data.shifts.pendingRequests;

  return (
    <div className={styles.kpisFrame}>
      <div className={styles.kpis}>
        <Kpi
          tone="live"
          label={t("inProduction")}
          value={inProduction}
          unit={t("ordersUnit", { count: inProduction })}
          meta={t("inProductionMeta", { count: produced })}
        />
        <Kpi
          tone={missed > 0 ? "danger" : "ok"}
          label={t("tickets")}
          value={tickets}
          unit={t("ticketsUnit", { count: tickets })}
          meta={t("ticketsMeta", { done, missed })}
        />
        <Kpi
          tone={overdue > 0 ? "danger" : "ok"}
          label={t("overdue")}
          value={overdue}
          unit={t("invoicesUnit", { count: overdue })}
          meta={t("overdueMeta", { count: issued })}
        />
        <Kpi
          tone={pending > 0 ? "live" : "ok"}
          label={t("requests")}
          value={pending}
          unit={t("requestsUnit")}
          meta={t("requestsMeta", { count: pending })}
        />
        <LastDayKpi data={data} />
      </div>
    </div>
  );
}

/**
 * The last production day's output, one figure per station: the day
 * before, or Saturday on a Monday, since a shift's output belongs to the day
 * it ends and Sunday has none (`previousProductionDay`). The totals are the
 * production page's day view, and the tile opens that page on that day.
 * An amber dot when nothing was entered: on a production day that is a
 * missing record, not a quiet day.
 */
function LastDayKpi({ data }: { data: Summary }) {
  const t = useTranslations("dashboard.kpis");
  const p = useTranslations("production");
  const { date, totals } = data.lastProductionDay;
  const yesterday = date === addDays(data.plantToday, -1);

  return (
    <Link
      href={`/production?date=${date}`}
      className={[styles.kpi, styles.kpiWide].filter(Boolean).join(" ")}
    >
      <div className={styles.kpiLabel}>
        <Dot tone={totals.runCount > 0 ? "ok" : "warn"} />
        {yesterday ? t("yesterday") : t("lastDay")}
      </div>
      <div className={styles.kpiStations}>
        {STAGES.map((entry, index) => (
          <div
            key={entry.stage}
            className={[styles.kpiStation, stageClass(entry.stage)].filter(Boolean).join(" ")}
          >
            <span className={styles.kpiStationLabel}>
              <span className={styles.step}>{index + 1}</span>
              {p(entry.label)}
            </span>
            <span className={styles.kpiStationFigure}>
              <span className={styles.kpiStationValue}>{int().format(totals[entry.figure])}</span>
              <span className={styles.kpiUnit}>{stageUnit(entry.stage, p)}</span>
            </span>
          </div>
        ))}
      </div>
      <div className={styles.kpiMeta}>
        {formatWeekdayLong(date)} <bdi>{formatShiftDate(date)}</bdi> ·{" "}
        {t("entries", { count: totals.runCount })}
      </div>
    </Link>
  );
}

function Kpi({
  tone,
  label,
  value,
  unit,
  meta,
}: {
  tone: DotTone;
  label: string;
  value: number;
  unit: string;
  meta: string;
}) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>
        <Dot tone={tone} />
        {label}
      </div>
      <div className={styles.kpiFigure}>
        <span className={styles.kpiValue}>{int().format(value)}</span>
        {unit && <span className={styles.kpiUnit}>{unit}</span>}
      </div>
      <div className={styles.kpiMeta}>{meta}</div>
    </div>
  );
}
