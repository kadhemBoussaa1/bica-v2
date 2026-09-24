"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { numberFormat } from "../../i18n/formats";
import { formatShiftDate, formatShiftHours } from "../shifts/week";
import shifts from "../shifts/shifts.module.css";
import { Panel } from "./section";
import type { Summary } from "./summary";
import styles from "./dashboard.module.css";

const int = () => numberFormat({ maximumFractionDigits: 0 });

/**
 * The plant week running now: whether it is opened and published, who is
 * on each of the three shifts (an empty one in red), then who is on no
 * shift and what the planner has to decide. The tickets are the KPI row's.
 */
export function TeamSection({ data }: { data: Summary }) {
  const t = useTranslations("dashboard.team");
  const enums = useTranslations("enums");
  const { weekStart, week, rosterSize, pendingRequests } = data.shifts;
  const planner = `/shifts?week=${weekStart}`;

  return (
    <Panel title={t("title")} links={[{ href: planner, label: t("link") }]}>
      <div className={styles.weekLine}>
        {t("weekOf", { date: formatShiftDate(weekStart) })}
        {week ? (
          <span
            className={[shifts.pill, week.status === "PUBLISHED" ? shifts.pillLive : shifts.pillDraft]
              .filter(Boolean)
              .join(" ")}
          >
            <i className={shifts.pillDot} aria-hidden="true" />
            {enums(`shiftWeekStatus.${week.status}`)}
          </span>
        ) : (
          <span className={[shifts.pill, shifts.pillWarn].filter(Boolean).join(" ")}>
            <i className={shifts.pillDot} aria-hidden="true" />
            {t("notOpened")}
          </span>
        )}
      </div>

      {week ? (
        <div className={styles.shiftRows}>
          {week.headcount.map((shift) => (
            <div
              key={shift.type}
              className={[styles.shiftRow, shift.count === 0 ? styles.shiftRowEmpty : null]
                .filter(Boolean)
                .join(" ")}
            >
              <span className={styles.shiftName}>
                <span className={styles.shiftLabel}>{enums(`shiftType.${shift.type}`)}</span>
                <span className={styles.shiftHours}>{formatShiftHours(shift.type)}</span>
              </span>
              <span className={styles.shiftCount}>{int().format(shift.count)}</span>
              <span className={styles.shiftUnit}>{t("people", { count: shift.count })}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.panelSubBelow}>
          {t("notOpenedText", { count: rosterSize })}{" "}
          <Link className={styles.inlineLink} href={planner}>
            {t("openWeek")}
          </Link>
        </p>
      )}

      <div className={styles.miniStats}>
        {week && (
          <div className={styles.miniStat}>
            <div className={styles.miniLabel}>{t("unplaced")}</div>
            <div className={styles.miniValue}>{int().format(week.unplaced)}</div>
            <div className={styles.miniMeta}>{t("roster", { count: rosterSize })}</div>
          </div>
        )}
        <Link className={[styles.miniStat, styles.miniStatLink].filter(Boolean).join(" ")} href="/shifts/requests">
          <span className={styles.miniLabel}>{t("requests")}</span>
          <span className={styles.miniValue}>{int().format(pendingRequests)}</span>
          <span className={styles.miniMeta}>{t("requestsMeta", { count: pendingRequests })}</span>
        </Link>
      </div>
    </Panel>
  );
}
