import styles from "./components.module.css";

/**
 * Job orders, rolls and shipments all live in state machines, so status
 * gets a first-class, colour-blind-safe system: colour, dot shape and label
 * all carry the meaning, so the set survives a grayscale print.
 */
export const STATUSES = [
  "DRAFT",
  "PLANNED",
  "IN RUN",
  "ON HOLD",
  "DONE",
  "SCRAPPED",
  "QC PENDING",
] as const;

export type Status = (typeof STATUSES)[number];

/** The dot's shape is the second, non-colour signal. */
type DotShape = "square" | "round" | "soft";

const STATUS_STYLES: Record<
  Status,
  { className: string | undefined; shape: DotShape }
> = {
  DRAFT: { className: styles.badgeDraft, shape: "square" },
  PLANNED: { className: styles.badgePlanned, shape: "square" },
  "IN RUN": { className: styles.badgeInRun, shape: "round" },
  "ON HOLD": { className: styles.badgeOnHold, shape: "square" },
  DONE: { className: styles.badgeDone, shape: "round" },
  SCRAPPED: { className: styles.badgeScrapped, shape: "soft" },
  "QC PENDING": { className: styles.badgeQcPending, shape: "round" },
};

const SHAPE_CLASS: Record<DotShape, string | undefined> = {
  square: undefined,
  round: styles.badgeDotRound,
  soft: styles.badgeDotSoft,
};

interface StatusBadgeProps {
  status: Status;
  /** Compact sits inside dense table rows. */
  compact?: boolean;
}

export function StatusBadge({ status, compact = false }: StatusBadgeProps) {
  const { className, shape } = STATUS_STYLES[status];

  const dotClasses = [styles.badgeDot, SHAPE_CLASS[shape]]
    .filter(Boolean)
    .join(" ");

  const classes = [
    styles.badge,
    className,
    compact ? styles.badgeCompact : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes}>
      <span className={dotClasses} aria-hidden />
      {status}
    </span>
  );
}
