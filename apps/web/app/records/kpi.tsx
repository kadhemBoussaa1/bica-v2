import type { ReactNode } from "react";
import Link from "next/link";
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
 *
 * A tile can also act: `href` makes it the way into the list behind the
 * figure, `toggle` a filter it switches on and off (pressed while on).
 * Every part is a `<span>` so the same markup is valid inside a button.
 */
export function KpiTile({
  label,
  value,
  unit,
  meta,
  tone = "neutral",
  href,
  toggle,
}: {
  label: string;
  /** Already formatted: money through `formatMoney`, a count as digits. */
  value: string;
  /** Omitted when the value is a word ("Visible") or carries its own ("3 ans"). */
  unit?: string;
  /** A node, not a string, so a caller can isolate a date or a name with `<bdi>`. */
  meta?: ReactNode;
  tone?: "neutral" | "success" | "danger" | "pending" | "warning";
  href?: string;
  toggle?: {
    pressed: boolean;
    onToggle: () => void;
    /** What pressing does, for the tooltip: the tile itself only counts. */
    hint: string;
    /** A filter that would only empty the list. */
    disabled?: boolean;
  };
}) {
  const classes = [
    styles.kpi,
    href !== undefined || toggle !== undefined ? styles.kpiAction : null,
    toggle?.pressed ? styles.kpiPressed : null,
    tone === "danger" ? styles.kpiDanger : null,
    tone === "success" ? styles.kpiSuccess : null,
    tone === "pending" ? styles.kpiPending : null,
    tone === "warning" ? styles.kpiWarning : null,
  ]
    .filter(Boolean)
    .join(" ");
  const body = (
    <>
      <span className={styles.kpiLabel}>
        <i className={styles.kpiDot} aria-hidden />
        {label}
      </span>
      <span className={styles.kpiRow}>
        <span className={styles.kpiValue}>{value}</span>
        {unit !== undefined && <span className={styles.kpiUnit}>{unit}</span>}
      </span>
      {meta !== undefined && <span className={styles.kpiMeta}>{meta}</span>}
    </>
  );
  if (href !== undefined) {
    return (
      <Link href={href} className={classes}>
        {body}
      </Link>
    );
  }
  if (toggle !== undefined) {
    return (
      <button
        type="button"
        className={classes}
        aria-pressed={toggle.pressed}
        title={toggle.hint}
        disabled={toggle.disabled}
        onClick={toggle.onToggle}
      >
        {body}
      </button>
    );
  }
  return <div className={classes}>{body}</div>;
}
