"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import styles from "./components.module.css";
import { useUiStrings } from "./strings";

export type ToastTone = "info" | "success" | "warning" | "error";

export interface ToastInput {
  title: string;
  /** One line under the title, e.g. what was created or why it failed. */
  text?: string;
  tone?: ToastTone;
  /** Milliseconds before it dismisses itself; 0 keeps it until closed. */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastContextValue {
  push: (toast: ToastInput) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_CLASS: Record<ToastTone, string | undefined> = {
  info: undefined,
  success: styles.toastSuccess,
  warning: styles.toastWarning,
  error: styles.toastError,
};

/**
 * Mount once, near the root. Toasts stack bottom-right, newest last, and
 * errors stay until closed — a failure should not slide away unread.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++;
      setItems((current) => [...current, { ...toast, id }]);
      const duration = toast.duration ?? (toast.tone === "error" ? 0 : 5000);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastStack items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/** `const { push } = useToast(); push({ title: "Client created", tone: "success" })` */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return context;
}

/** One toast, on its own — for a page that renders its own feedback. */
export function Toast({
  title,
  text,
  tone = "info",
  onClose,
}: ToastInput & { onClose?: () => void }) {
  const ui = useUiStrings();
  return (
    <div
      className={[styles.toast, TONE_CLASS[tone]].filter(Boolean).join(" ")}
      role={tone === "error" ? "alert" : "status"}
    >
      <span className={styles.toastBody}>
        <span className={styles.toastTitle}>{title}</span>
        {text && <span className={styles.toastText}>{text}</span>}
      </span>
      {onClose && (
        <button
          type="button"
          className={styles.toastClose}
          aria-label={ui.dismiss}
          onClick={onClose}
        >
          ×
        </button>
      )}
    </div>
  );
}

function ToastStack({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className={styles.toastStack}>
      {items.map((item) => (
        <Toast
          key={item.id}
          title={item.title}
          text={item.text}
          tone={item.tone}
          onClose={() => onDismiss(item.id)}
        />
      ))}
    </div>
  );
}
