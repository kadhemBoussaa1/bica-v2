"use client";

import styles from "./list-header.module.css";

export interface Segment<K extends string> {
  key: K;
  label: string;
  count?: number;
}

/**
 * A segmented control for a facet with a handful of exclusive answers —
 * "all / awaiting / late / received" — from `Purchase orders v4.dc.html`.
 * One dark segment is the answer; the others sit flat on a shared veil.
 * Counts come from the server like the chips' do, so a segment says how
 * many rows it would show before it is picked.
 */
export function SegmentedFilter<K extends string>({
  label,
  segments,
  value,
  onChange,
}: {
  label: string;
  segments: ReadonlyArray<Segment<K>>;
  value: K;
  onChange: (next: K) => void;
}) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {segments.map((segment) => {
        const active = segment.key === value;
        return (
          <button
            key={segment.key}
            type="button"
            className={[styles.segment, active ? styles.segmentActive : null]
              .filter(Boolean)
              .join(" ")}
            aria-pressed={active}
            onClick={() => onChange(segment.key)}
          >
            {segment.label}
            {segment.count !== undefined && (
              <span className={styles.segmentCount}>{segment.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
