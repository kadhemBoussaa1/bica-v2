"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { KpiRow, KpiTile } from "../records/kpi";
import records from "../records/records.module.css";
import { SegmentedFilter } from "../records/segmented-filter";
import { useTRPC } from "../trpc/client";
import { ManufacturingOrdersTable } from "./manufacturing-orders-table";
import { ManufacturingTemplates } from "./manufacturing-templates";
import styles from "./manufacturing.module.css";

type View = "ofs" | "templates";

/**
 * The module's two screens under one header: the OFs, and the templates
 * they are opened from. The figures describe the whole shop — every OF, not
 * the page or the filter under them — so they sit in the header and only
 * on the OF list.
 */
export function ManufacturingView({ initialSearch }: { initialSearch: string }) {
  const t = useTranslations("manufacturing");
  const trpc = useTRPC();
  const [view, setView] = useState<View>("ofs");
  const summary = useQuery(trpc.manufacturing.summary.queryOptions()).data;

  return (
    <>
      <header className={records.header}>
        <div className={records.heading}>
          <span className={records.eyebrow}>{t("eyebrow")}</span>
          <h1 className={records.title}>{t("title")}</h1>
          <p className={records.subtitle}>{t("subtitle")}</p>
        </div>
        <SegmentedFilter
          label={t("tabs.label")}
          segments={[
            { key: "ofs", label: t("tabs.ofs"), count: summary?.total },
            { key: "templates", label: t("tabs.templates"), count: summary?.templates },
          ]}
          value={view}
          onChange={setView}
        />

        {view === "ofs" && summary && (
          <div className={styles.figures}>
            <KpiRow>
              <KpiTile
                label={t("tiles.inProgress")}
                value={String(summary.inProgress)}
                unit={t("tiles.unit")}
                meta={t("tiles.inProgressMeta", { count: summary.actionsInProgress })}
                tone="pending"
              />
              <KpiTile
                label={t("tiles.stale", { days: summary.stale.days })}
                value={String(summary.stale.count)}
                unit={t("tiles.unit")}
                meta={
                  summary.stale.count === 0 ? (
                    t("tiles.staleNone")
                  ) : (
                    <>
                      {summary.stale.sample.map((of, index) => (
                        <span key={of.id}>
                          {index > 0 && ", "}
                          <bdi>{of.numero}</bdi>
                          {of.client && (
                            <>
                              {" · "}
                              <bdi>{of.client}</bdi>
                            </>
                          )}
                        </span>
                      ))}
                      {summary.stale.count > summary.stale.sample.length &&
                        t("tiles.staleMore", {
                          count: summary.stale.count - summary.stale.sample.length,
                        })}
                    </>
                  )
                }
                tone={summary.stale.count > 0 ? "danger" : "success"}
              />
              <KpiTile
                label={t("tiles.done")}
                value={String(summary.done)}
                unit={t("tiles.unit")}
                meta={t("tiles.doneMeta")}
                tone="success"
              />
              <KpiTile
                label={t("tiles.templates")}
                value={String(summary.templates)}
                meta={t("tiles.templatesMeta")}
              />
            </KpiRow>
          </div>
        )}
      </header>

      {view === "ofs" ? (
        <ManufacturingOrdersTable initialSearch={initialSearch} />
      ) : (
        <ManufacturingTemplates />
      )}
    </>
  );
}
