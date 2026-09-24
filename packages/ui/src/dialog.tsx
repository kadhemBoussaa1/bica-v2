"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./button";
import styles from "./components.module.css";
import { useUiStrings } from "./strings";

interface DialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  /** Label for the confirming action. */
  confirmLabel: string;
  /** Destructive actions get the danger treatment. */
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Confirmation dialog built on <dialog>, so the browser supplies the focus
 * trap, Escape handling and inertness of the page behind it rather than us
 * reimplementing them.
 */
export function Dialog({
  open,
  title,
  children,
  confirmLabel,
  destructive = false,
  busy = false,
  onConfirm,
  onClose,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const ui = useUiStrings();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      // Fires on Escape and on form-method=dialog submits.
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
    >
      <h2 className={styles.dialogTitle}>{title}</h2>
      {children && <div className={styles.dialogBody}>{children}</div>}
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {ui.cancel}
        </Button>
        <Button
          variant={destructive ? "danger" : "primary"}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? ui.working : confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
