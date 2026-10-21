"use client";

import type { inferRouterOutputs } from "@trpc/server";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
// Type-only import: erased at compile time, so no server code reaches the bundle.
import type { AppRouter } from "api/src/trpc/trpc.router";
import { formatDay } from "../../i18n/formats";
import records from "../records/records.module.css";
import { Avatar } from "./avatar";
import { employeeDisplayName } from "./employee-name";
import { contractEnd, tenureMonths, type ContractEnd } from "./employee-ui";
import styles from "./employee-card.module.css";

export type EmployeeRow = inferRouterOutputs<AppRouter>["employee"]["list"]["rows"][number];

/**
 * A running contract turns amber inside this many days and red inside
 * `CONTRACT_ENDING_SOON_DAYS` (`end.soon`), the header figure's window.
 */
const CONTRACT_WATCH_DAYS = 60;

/** How a contract's end reads on the card: its colour and its bar's. */
type EndTone = "soon" | "watch" | "running" | "quiet" | "unrecorded";

function endTone(end: ContractEnd, employmentType: string | null): EndTone {
  if (end.kind === "ends") {
    if (end.soon) return "soon";
    return end.days <= CONTRACT_WATCH_DAYS ? "watch" : "running";
  }
  // A fixed-term contract with no end date was never recorded, not open-ended.
  if (end.kind === "open" && employmentType !== "CDI") return "unrecorded";
  return "quiet";
}

const END_CLASS: Record<EndTone, string | undefined> = {
  soon: styles.endSoon,
  watch: styles.endWatch,
  running: styles.endRunning,
  quiet: styles.endQuiet,
  unrecorded: styles.endUnrecorded,
};

const BAR_CLASS: Partial<Record<EndTone, string | undefined>> = {
  soon: styles.barSoon,
  watch: styles.barWatch,
};

/**
 * How far a running contract has gone, hire to end, as 0–100: the card's
 * bar. Null without a hire date, or with an end not after it.
 */
function elapsedPercent(hireDate: string | Date | null, end: string | Date, today: number): number | null {
  if (hireDate === null) return null;
  const start = new Date(hireDate).getTime();
  const stop = new Date(end).getTime();
  if (stop <= start) return null;
  return Math.min(100, Math.max(0, Math.round(((today - start) / (stop - start)) * 100)));
}

/**
 * From `Employes Cartes.dc.html`: one person as an ID badge — a lanyard
 * slot and the logo on an orange-ruled band, the portrait, the name, the
 * matricule and time served, then the contract and how far it has run.
 * The whole card opens the record page, like a list row.
 *
 * Only a contract that is still running draws a bar; one already past
 * reads "ended" in the muted tone the list uses, since the legacy data
 * holds many on records still on the roster.
 */
export function EmployeeCard({ employee, today }: { employee: EmployeeRow; today: number }) {
  const t = useTranslations("employees");
  const end = contractEnd(employee.contractEndDate, today);
  const tone = endTone(end, employee.employmentType);
  const months = tenureMonths(employee.hireDate, today);
  const elapsed = end.kind === "ends" ? elapsedPercent(employee.hireDate, end.date, today) : null;

  const endLabel =
    end.kind === "ends"
      ? t("contractEnd.endsIn", { count: end.days })
      : end.kind === "ended"
        ? t("contractEnd.ended", { date: formatDay(end.date) })
        : employee.employmentType === "CDI"
          ? t("contractEnd.open")
          : t("contractEnd.notGiven");

  const tenure =
    months === null
      ? null
      : months === 0
        ? t("card.tenure.new")
        : months < 12
          ? t("card.tenure.months", { count: months })
          : t("card.tenure.years", { years: Math.floor(months / 12), months: months % 12 });

  return (
    <Link href={`/employees/${employee.id}`} className={styles.card}>
      <span className={styles.band}>
        <span className={styles.slot} aria-hidden />
        <Image className={styles.logo} src="/bicapack-logo.png" alt="" width={36} height={36} />
        <span className={styles.bandText}>
          <span className={styles.kicker}>{t("card.kicker")}</span>
          {employee.userId === null && (
            <span className={styles.noAccount}>{t("card.noAccount")}</span>
          )}
        </span>
      </span>

      <span className={styles.photo}>
        <Avatar employee={employee} size="card" />
      </span>

      <span className={styles.identity}>
        <span className={styles.name}>{employeeDisplayName(employee)}</span>
        {(employee.jobTitle !== null || employee.department !== null) && (
          <span className={styles.role}>
            {employee.jobTitle}
            {employee.jobTitle !== null && employee.department !== null && " · "}
            {employee.department !== null && (
              <span className={styles.service}>{employee.department}</span>
            )}
          </span>
        )}
      </span>

      <span className={styles.facts}>
        <span className={styles.fact}>
          <span className={styles.factLabel}>{t("card.matricule")}</span>
          <bdi className={styles.factValue}>{employee.matricule}</bdi>
        </span>
        <span className={styles.fact}>
          <span className={styles.factLabel}>{t("card.tenureLabel")}</span>
          <span className={styles.factValue}>{tenure ?? <span className={records.absent} />}</span>
        </span>
      </span>

      <span className={styles.foot}>
        <span className={styles.contractRow}>
          {employee.employmentType !== null ? (
            <span className={styles.contractType}>{employee.employmentType}</span>
          ) : (
            <span className={records.absent} />
          )}
          <bdi
            className={[styles.end, END_CLASS[tone]].filter(Boolean).join(" ")}
            title={end.kind === "ends" ? formatDay(end.date) : undefined}
          >
            {endLabel}
          </bdi>
        </span>
        {elapsed !== null && (
          // The label above carries the meaning; the bar only shows it.
          <span className={styles.bar} aria-hidden>
            <span
              className={[styles.barFill, BAR_CLASS[tone]].filter(Boolean).join(" ")}
              style={{ width: `${elapsed}%` }}
            />
          </span>
        )}
        {employee.hireDate !== null && (
          <span className={styles.since}>{t("card.since", { date: formatDay(employee.hireDate) })}</span>
        )}
      </span>
    </Link>
  );
}
