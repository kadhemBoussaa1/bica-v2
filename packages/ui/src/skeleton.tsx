"use client";

import type { CSSProperties } from "react";
import styles from "./components.module.css";
import { useUiStrings } from "./strings";

interface SkeletonProps {
  /** CSS width, e.g. "40%" or "120px". Defaults to filling the row. */
  width?: string;
  height?: number;
  className?: string;
}

/** One shimmering bar. Compose several to sketch the shape of what loads. */
export function Skeleton({ width, height = 12, className }: SkeletonProps) {
  const style: CSSProperties = { width: width ?? "100%", height };
  return (
    <span
      className={[styles.skeleton, className].filter(Boolean).join(" ")}
      style={style}
      aria-hidden="true"
    />
  );
}

/* Varied first-column widths so the block reads as rows, not a barcode. */
const WIDTHS = ["38%", "52%", "30%", "46%", "34%", "58%", "42%", "36%"];

/**
 * A first load draws the table's shape; a refetch dims the real rows in
 * place instead (DataTable's `loading`). Same height as the rows it stands
 * in for, so the page does not jump when data lands.
 */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  const ui = useUiStrings();
  return (
    <div className={styles.skeletonRows} role="status" aria-label={ui.loading}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={styles.skeletonRow}>
          <Skeleton width={WIDTHS[index % WIDTHS.length]} />
          <Skeleton />
        </div>
      ))}
    </div>
  );
}
