import type { ReactNode } from "react";
import styles from "./components.module.css";

interface EmptyStateProps {
  title: string;
  /** What to do about it: clear the filter, add the first one. */
  text?: string;
  /** Usually one or two buttons. */
  actions?: ReactNode;
}

/**
 * A dashed box that says what is missing and offers the way out. Used by
 * DataTable when a page has no rows, and by any list that starts empty.
 */
export function EmptyState({ title, text, actions }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      {text && <p className={styles.emptyText}>{text}</p>}
      {actions && <div className={styles.emptyActions}>{actions}</div>}
    </div>
  );
}
