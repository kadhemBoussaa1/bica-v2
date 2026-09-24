import type { ReactNode } from "react";
import styles from "./list-header.module.css";

/**
 * A row of figures above a list, one tile per currency and, where a list
 * has one, a tile for what needs chasing. Every figure is summed
 * server-side over the same rows the pager counts, so the tiles narrow
 * with the chips, the search and the date window rather than describing
 * the page on screen.
 *
 * The caller renders nothing for a currency with no rows: "0,00 EUR" would
 * read as a balance rather than an absence, so it passes only the tiles that
 * have something to say and wraps them in `KpiRow` only when there is at
 * least one.
 */
export function KpiRow({ children }: { children: ReactNode }) {
  return <div className={styles.kpis}>{children}</div>;
}

/**
 * One figure: the amount in display type with its unit beside it, a line
 * under it for what it is made of, and a dot before the label whose colour
 * AND shape carry the tone — square for money and for trouble, round for
 * "nothing wrong" — so the set survives a grayscale print.
 */
export function KpiTile({
  label,
  value,
  unit,
  meta,
  tone = "neutral",
}: {
  label: string;
  /** Already formatted: money through `formatMoney`, a count as digits. */
  value: string;
  unit: string;
  meta?: string;
  tone?: "neutral" | "success" | "danger" | "pending" | "warning";
}) {
  const classes = [
    styles.kpi,
    tone === "danger" ? styles.kpiDanger : null,
    tone === "success" ? styles.kpiSuccess : null,
    tone === "pending" ? styles.kpiPending : null,
    tone === "warning" ? styles.kpiWarning : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes}>
      <div className={styles.kpiLabel}>
        <i className={styles.kpiDot} aria-hidden />
        {label}
      </div>
      <div className={styles.kpiRow}>
        <span className={styles.kpiValue}>{value}</span>
        <span className={styles.kpiUnit}>{unit}</span>
      </div>
      {meta !== undefined && <div className={styles.kpiMeta}>{meta}</div>}
    </div>
  );
}
