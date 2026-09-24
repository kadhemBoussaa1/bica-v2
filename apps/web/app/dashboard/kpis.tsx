"use client";

import { useTranslations } from "next-intl";
import { numberFormat } from "../../i18n/formats";
import { Dot, type DotTone } from "./section";
import { countOf, type Summary } from "./summary";
import styles from "./dashboard.module.css";

const int = () => numberFormat({ maximumFractionDigits: 0 });

/**
 * Four figures under the to-do list: what is being made, the floor's
 * tickets, late sales money, and the planner's inbox. Paper on hand is not
 * a tile any more — the stock panel leads with it.
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
    </div>
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
