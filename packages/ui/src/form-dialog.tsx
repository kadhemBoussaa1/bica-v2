"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./components.module.css";
import { useUiStrings } from "./strings";

interface FormDialogProps {
  /** Small mono label above the title — the module, as on the page header. */
  eyebrow?: string;
  title: string;
  /** `wide` is for the orders form: three columns and a pricing aside. */
  size?: "default" | "wide";
  /** Fires on Escape, on the close button, and on a `method="dialog"` submit. */
  onClose: () => void;
  children: ReactNode;
}

/**
 * A modal that hosts a whole form — the creation forms open in one of these
 * over whatever page the user was on (see `apps/web/app/@modal`).
 *
 * Built on <dialog> like `Dialog`, so the browser supplies the focus trap,
 * Escape handling and inertness of the page behind it. Unlike `Dialog` it
 * has no buttons of its own: the form keeps its actions row, which already
 * knows when it is busy. Opens on mount and stays open for its whole life;
 * closing is the caller unmounting it (a route change) or `onClose`.
 *
 * Under 600px it is a full-height sheet: a 48px control beside a glove needs
 * the whole screen, not a card in the middle of it.
 */
export function FormDialog({
  eyebrow,
  title,
  size = "default",
  onClose,
  children,
}: FormDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const ui = useUiStrings();

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  const classes = [styles.formDialog, size === "wide" ? styles.formDialogWide : null]
    .filter(Boolean)
    .join(" ");

  return (
    <dialog ref={ref} className={classes} onClose={onClose} aria-labelledby="form-dialog-title">
      <div className={styles.formDialogHead}>
        <div>
          {eyebrow && <span className={styles.formDialogEyebrow}>{eyebrow}</span>}
          <h2 id="form-dialog-title" className={styles.formDialogTitle}>
            {title}
          </h2>
        </div>
        <button
          type="button"
          className={styles.formDialogClose}
          onClick={onClose}
          aria-label={ui.close}
        >
          ×
        </button>
      </div>
      <div className={styles.formDialogBody} data-embedded="">
        {children}
      </div>
    </dialog>
  );
}
