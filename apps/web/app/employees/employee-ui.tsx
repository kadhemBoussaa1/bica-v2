"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { CONTRACT_ENDING_SOON_DAYS } from "@repo/api-contract";
import { formatDay } from "../../i18n/formats";
import type { useTRPC } from "../trpc/client";
import shell from "../records/banded-list.module.css";

/*
 * What the list, the record page and the form share: how a record's
 * standing and its contract read, from `Employees v3.dc.html`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today at UTC midnight, the way `@db.Date` values are read, so a date compares by day. */
export function todayUtc(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * Where a record stands. Archive wins: an archived record is out of the app
 * whatever the legacy `suspended` flag says, which is also how the list's
 * facets split them (`suspended` there means active and suspended).
 */
export type EmployeeStatus = "onRoster" | "suspended" | "archived";

export function statusOf(employee: { active: boolean; suspended: boolean }): EmployeeStatus {
  if (!employee.active) return "archived";
  return employee.suspended ? "suspended" : "onRoster";
}

/** The shell's tone per status: colour AND dot shape, so it survives grayscale. */
export const STATUS_TONE: Record<EmployeeStatus, string | undefined> = {
  onRoster: shell.toneSuccess,
  suspended: shell.toneDanger,
  archived: shell.toneNeutral,
};

export function StatusPill({ status }: { status: EmployeeStatus }) {
  const t = useTranslations("employees.status");
  return (
    <span className={[shell.pill, STATUS_TONE[status]].filter(Boolean).join(" ")}>
      <i className={shell.pillDot} aria-hidden />
      {t(status)}
    </span>
  );
}

/**
 * A contract's end, judged against today. `ends` carries whether it falls
 * inside the window the list's header tile counts, so a red row and the
 * tile always agree (`CONTRACT_ENDING_SOON_DAYS`). A date already past is
 * `ended` — the legacy data holds many on records still on the roster, and
 * saying so is more useful than hiding it.
 */
export type ContractEnd =
  | { kind: "open" }
  | { kind: "ended"; date: string | Date }
  | { kind: "ends"; date: string | Date; days: number; soon: boolean };

export function contractEnd(end: string | Date | null, today: number): ContractEnd {
  if (end === null) return { kind: "open" };
  const days = Math.round((new Date(end).getTime() - today) / DAY_MS);
  if (days < 0) return { kind: "ended", date: end };
  return { kind: "ends", date: end, days, soon: days <= CONTRACT_ENDING_SOON_DAYS };
}

/**
 * "ends in 12 d · 06/10/2026". A `<bdi>` per part: in Arabic the date would
 * otherwise jump to the far side of the separator. No end date means
 * open-ended only for a CDI; on any other contract it was never recorded.
 */
export function ContractEndText({
  end,
  employmentType,
}: {
  end: ContractEnd;
  employmentType: string | null;
}) {
  const t = useTranslations("employees.contractEnd");
  if (end.kind === "open") return <>{employmentType === "CDI" ? t("open") : t("notGiven")}</>;
  if (end.kind === "ended") return <bdi>{t("ended", { date: formatDay(end.date) })}</bdi>;
  return (
    <>
      <bdi>{t("endsIn", { count: end.days })}</bdi>
      {" · "}
      <bdi>{formatDay(end.date)}</bdi>
    </>
  );
}

/** Whole months from hire to today, or null with no hire date. */
export function tenureMonths(hireDate: string | Date | null, today: number): number | null {
  if (hireDate === null) return null;
  const hired = new Date(hireDate);
  const now = new Date(today);
  const months =
    (now.getUTCFullYear() - hired.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - hired.getUTCMonth()) -
    (now.getUTCDate() < hired.getUTCDate() ? 1 : 0);
  return Math.max(0, months);
}

/** "1 year 3 months", dropping a zero part; "less than a month" for none. */
export function useTenureText(): (months: number) => string {
  const t = useTranslations("employees.tenure");
  return (months) => {
    if (months === 0) return t("underAMonth");
    const years = Math.floor(months / 12);
    const rest = months % 12;
    return [years > 0 ? t("years", { count: years }) : null, rest > 0 ? t("months", { count: rest }) : null]
      .filter(Boolean)
      .join(" ");
  };
}

/**
 * The stored gender, in the reader's language. The column is free text
 * holding the legacy's French words; anything else is shown as stored.
 */
export function useGenderLabel(): (gender: string | null) => string | null {
  const t = useTranslations("employees.gender");
  return (gender) => {
    if (gender === "Homme") return t("male");
    if (gender === "Femme") return t("female");
    return gender;
  };
}

/**
 * Everything that shows an employee: the list, its header figures and the
 * record pages. A save or an archive can move all of them at once.
 */
export async function invalidateEmployeeQueries(
  queryClient: QueryClient,
  trpc: ReturnType<typeof useTRPC>,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: trpc.employee.list.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.employee.summary.queryKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.employee.byId.queryKey() }),
  ]);
}
