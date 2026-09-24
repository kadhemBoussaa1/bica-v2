"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { canAccessAny, type WorkshopStage } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { useCurrentUser } from "../auth/use-auth";
import { DailyProduction, DayMeta, isoDay } from "./daily-production";
import {
  isoMonth,
  MONTH_PATTERN,
  MonthlyProduction,
  MonthMeta,
  shiftMonth,
} from "./monthly-production";
import { RunForm } from "./run-form";
import records from "../records/records.module.css";
import styles from "./production.module.css";

/** `date` shifted by `days`, as YYYY-MM-DD. */
function shiftDay(date: string, days: number): string {
  const parts = date.split("-").map(Number);
  const d = new Date(parts[0]!, (parts[1] ?? 1) - 1, parts[2] ?? 1);
  d.setDate(d.getDate() + days);
  return isoDay(d);
}

/**
 * The production page: its header, the view switch, the day navigation, and
 * the recording form, above whichever view is open.
 *
 * `day` is the dashboard the shop runs on — one day, grouped by station, with
 * that day's totals. `month` is the same question a step back: the selected
 * month's flow, a year of trend behind it, and who did the month's work.
 *
 * Recording lives here as well as on the order page: from here the operator
 * picks the order, from there the order is already known.
 */
export function ProductionViews() {
  const { user } = useCurrentUser();
  const t = useTranslations("production");
  const enums = useTranslations("enums");
  const [view, setView] = useState<"day" | "month">("day");
  const [date, setDate] = useState(() => isoDay(new Date()));
  const [month, setMonth] = useState(() => isoMonth(new Date()));
  const [recording, setRecording] = useState<WorkshopStage | null>(null);

  const today = isoDay(new Date());
  const thisMonth = isoMonth(new Date());
  const canRecord =
    user !== null && canAccessAny(user.role, ["ADMIN", "PRODUCTION"]);

  const startRecording = (stage: WorkshopStage) => {
    setRecording(stage);
    // The form sits under the toolbar; bring it into view from a station
    // further down the page.
    requestAnimationFrame(() =>
      document
        .getElementById("record-entry")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  return (
    <>
      <header className={records.header}>
        <div className={records.heading}>
          <span className={records.eyebrow}>{t("eyebrow")}</span>
          <h1 className={records.title}>{t("title")}</h1>
        </div>
        <p className={records.subtitle}>
          {view === "day" ? t("ledeDay") : t("ledeMonth")}
        </p>
        {canRecord && (
          <Button variant="primary" onClick={() => startRecording("PRODUCER")}>
            {t("recordEntry")}
          </Button>
        )}
      </header>

      <div className={styles.toolbar}>
        <div
          className={styles.segmented}
          role="tablist"
          aria-label={t("viewSwitch")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === "day"}
            className={[
              styles.segment,
              view === "day" ? styles.segmentActive : null,
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => setView("day")}
          >
            {t("dayView")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "month"}
            className={[
              styles.segment,
              view === "month" ? styles.segmentActive : null,
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => setView("month")}
          >
            {t("monthView")}
          </button>
        </div>

        {view === "day" && (
          <div className={styles.dayNav}>
            <Button
              className={styles.dayBtn}
              onClick={() => setDate(shiftDay(date, -1))}
            >
              {t("previousDay")}
            </Button>
            <input
              type="date"
              className={styles.dayInput}
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              aria-label={t("productionDay")}
            />
            <Button
              className={styles.dayBtn}
              onClick={() => setDate(shiftDay(date, 1))}
            >
              {t("nextDay")}
            </Button>
            <Button
              className={styles.dayBtn}
              disabled={date === today}
              onClick={() => setDate(today)}
            >
              {t("today")}
            </Button>
            <DayMeta date={date} />
          </div>
        )}

        {view === "month" && (
          <div className={styles.dayNav}>
            <Button
              className={styles.dayBtn}
              onClick={() => setMonth(shiftMonth(month, -1))}
            >
              {t("previousMonth")}
            </Button>
            {/* Desktop Firefox and Safari have no month picker and render
                this as a plain text box, so anything that is not a whole
                YYYY-MM is ignored rather than sent to the query. */}
            <input
              type="month"
              className={styles.dayInput}
              value={month}
              onChange={(e) =>
                MONTH_PATTERN.test(e.target.value) && setMonth(e.target.value)
              }
              aria-label={t("productionMonth")}
            />
            <Button
              className={styles.dayBtn}
              onClick={() => setMonth(shiftMonth(month, 1))}
            >
              {t("nextMonth")}
            </Button>
            <Button
              className={styles.dayBtn}
              disabled={month === thisMonth}
              onClick={() => setMonth(thisMonth)}
            >
              {t("thisMonth")}
            </Button>
            <MonthMeta month={month} />
          </div>
        )}
      </div>

      {canRecord && recording && (
        <section
          id="record-entry"
          className={styles.recordPanel}
          aria-label={t("recordPanel")}
        >
          <h2 className={styles.recordTitle}>
            {t("recordStageEntry", {
              stage: enums(`workshopStage.${recording}`).toLowerCase(),
            })}
          </h2>
          <RunForm
            key={recording}
            initialStage={recording}
            initialDate={date}
            onDone={() => setRecording(null)}
            onCancel={() => setRecording(null)}
          />
        </section>
      )}

      {view === "day" ? (
        <DailyProduction
          date={date}
          onRecord={canRecord ? startRecording : null}
        />
      ) : (
        <MonthlyProduction month={month} />
      )}
    </>
  );
}
