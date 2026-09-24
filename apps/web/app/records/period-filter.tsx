"use client";

import { useTranslations } from "next-intl";
import { TextField } from "@repo/ui/field";
import type { Period } from "api/src/list/period";
import styles from "./list-header.module.css";

/**
 * The window a list is scoped to, as the client holds it: keys and scalars
 * only. The server turns them into the predicate (`periodWindow` and each
 * module's own scope function), so nothing here can widen what it returns.
 */
export interface PeriodState {
  period?: Period;
  from?: string;
  to?: string;
}

/** The three fields at rest: no window. Spread into a table's initial state. */
export const NO_PERIOD: PeriodState = { period: undefined, from: undefined, to: undefined };

const PERIODS: readonly Period[] = ["thisYear", "lastYear", "yearBefore", "custom"];

/**
 * The period as a row of pills — "any date" first, then the buckets, then a
 * custom range that unfolds its two date fields — from `Sales invoices
 * v3.dc.html`. It sits in the list's toolbar beside the facet chips: a
 * period and a facet are independent questions, and the server AND-s the
 * window into `scope` so the chips keep counting inside it.
 *
 * The buckets are labelled relatively ("this year", "the year before") rather
 * than by number: they are computed from the server's clock, so a hard-coded
 * "2024" would be wrong the moment the year turns. Only `label` — which date
 * the window is on — is the caller's: "Raised" for an order, "Issued" for an
 * invoice.
 */
export function PeriodFilter({
  label,
  state,
  onChange,
  note,
}: {
  label: string;
  state: PeriodState;
  /** Receives the window fields only; the caller adds `page: 1` however it resets its pager. */
  onChange: (next: PeriodState) => void;
  /**
   * Shown after a custom range's dates: how many rows the window holds once
   * a bound is set. Before that, the hint that an empty bound is open-ended.
   */
  note?: string;
}) {
  const t = useTranslations("common.period");
  const pill = (active: boolean) =>
    [styles.pill, active ? styles.pillActive : null].filter(Boolean).join(" ");

  return (
    <div className={styles.periods} role="group" aria-label={label}>
      <span className={styles.periodLabel}>{label}</span>
      <button
        type="button"
        className={pill(state.period === undefined)}
        aria-pressed={state.period === undefined}
        // Clearing the period clears its dates too: a stale range left
        // behind would suggest a filter that is not applied.
        onClick={() => onChange(NO_PERIOD)}
      >
        {t("any")}
      </button>
      {PERIODS.map((period) => (
        <button
          key={period}
          type="button"
          className={pill(state.period === period)}
          aria-pressed={state.period === period}
          onClick={() => onChange({ ...state, period })}
        >
          {t(period)}
        </button>
      ))}

      {state.period === "custom" && (
        <span className={styles.periodRange}>
          <TextField
            label={t("from")}
            size="dense"
            type="date"
            format="mono"
            value={state.from ?? ""}
            onChange={(e) => onChange({ ...state, from: e.target.value || undefined })}
          />
          <TextField
            label={t("to")}
            size="dense"
            type="date"
            format="mono"
            value={state.to ?? ""}
            onChange={(e) => onChange({ ...state, to: e.target.value || undefined })}
          />
        </span>
      )}
      {state.period === "custom" && (
        <span className={styles.periodNote}>
          {state.from === undefined && state.to === undefined ? t("openEnded") : note}
        </span>
      )}
    </div>
  );
}
