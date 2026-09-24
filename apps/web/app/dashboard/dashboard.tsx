"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { TableSkeleton } from "@repo/ui/skeleton";
import { useTRPC } from "../trpc/client";
import records from "../records/records.module.css";
import { SegmentedFilter } from "../records/segmented-filter";
import { formatPlantTime, formatShiftDate, formatWeekdayLong } from "../shifts/week";
import { FinanceSection } from "./finance-section";
import { Kpis } from "./kpis";
import { OrdersSection } from "./orders-section";
import { ProductionSection } from "./production-section";
import { StockSection } from "./stock-section";
import { RANGES, type Range, type Summary } from "./summary";
import { TeamSection } from "./team-section";
import { TodoSection, useTodos } from "./todo-section";
import styles from "./dashboard.module.css";

/**
 * The super admin's home, from `Dashboard v3.dc.html` — docs/dashboard-plan.md.
 *
 * Read top to bottom as a morning briefing: a sentence saying where things
 * stand, then the production flow first, the money in the middle, then
 * what needs a decision, four headline figures, and orders, teams and paper
 * side by side (user decision, 2026-09-24 — the handoff led with the to-do
 * list and ended on the money). Production and money are also the two
 * panels the header's range control moves, so they sit right under it. One
 * query for all of it, refreshed every minute like the sidebar's counts.
 *
 * The range control moves the two figures that are spans rather than
 * snapshots — the production flow and the invoiced amount. Everything else
 * (orders by status, this week, paper on hand, what is overdue) is a state
 * of now, and the control leaves it alone.
 */
export function Dashboard({ name }: { name: string | null | undefined }) {
  const t = useTranslations("dashboard");
  const trpc = useTRPC();
  const [range, setRange] = useState<Range>("month");
  const query = useQuery({
    ...trpc.dashboard.summary.queryOptions(),
    // Mounted for the whole visit, so it would never refetch on its own;
    // the same minute's refresh as the sidebar's counts.
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return (
    <div className={records.page}>
      {query.isPending ? (
        <TableSkeleton rows={8} />
      ) : query.isError ? (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {t("loadError")}
        </p>
      ) : (
        <Loaded data={query.data} name={name} range={range} onRange={setRange} />
      )}
    </div>
  );
}

function Loaded({
  data,
  name,
  range,
  onRange,
}: {
  data: Summary;
  name: string | null | undefined;
  range: Range;
  onRange: (next: Range) => void;
}) {
  const t = useTranslations("dashboard");
  const todos = useTodos(data);
  const status = (key: string) => data.orders.byStatus.find((row) => row.status === key)?.count ?? 0;

  return (
    <div className={styles.stack}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <div className={styles.date}>
            {formatWeekdayLong(data.plantToday)} <bdi>{formatShiftDate(data.plantToday)}</bdi>
          </div>
          <h1 className={styles.title}>{name ? t("greeting", { name }) : t("title")}</h1>
          <p className={styles.lede}>
            {t("lede", {
              inProduction: status("IN_PRODUCTION"),
              produced: status("PRODUCED"),
              points: todos.length,
            })}
          </p>
        </div>
        <div className={styles.headerSide}>
          <span className={styles.updated}>
            {t("updated", { time: formatPlantTime(data.asOf) })}
          </span>
          <SegmentedFilter
            label={t("range.label")}
            segments={RANGES.map((key) => ({ key, label: t(`range.${key}`) }))}
            value={range}
            onChange={onRange}
          />
        </div>
      </header>

      <ProductionSection data={data} range={range} />
      <FinanceSection data={data} range={range} />
      <TodoSection todos={todos} />
      <Kpis data={data} />
      <div className={styles.columns}>
        <OrdersSection data={data} />
        <TeamSection data={data} />
        <StockSection data={data} />
      </div>
    </div>
  );
}
