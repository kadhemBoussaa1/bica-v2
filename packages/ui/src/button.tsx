import type { ButtonHTMLAttributes } from "react";
import styles from "./components.module.css";

export type ButtonVariant =
  "primary" | "secondary" | "ghost" | "danger" | "dark";

/**
 * Touch (48px) is the default — a gloved hand first. Dense (36px) is opt-in
 * for desktop toolbars and table-row controls, never a primary action. Floor
 * (56px) is the tablet mounted beside a machine, tapped at arm's length.
 */
export type ButtonSize = "touch" | "dense" | "floor";

// CSS-module class lookups are typed `string | undefined` by Next's
// generated declarations, so the map value type follows suit.
const VARIANTS: Record<ButtonVariant, string | undefined> = {
  primary: styles.btnPrimary,
  secondary: styles.btnSecondary,
  ghost: styles.btnGhost,
  danger: styles.btnDanger,
  dark: styles.btnDark,
};

const SIZES: Record<ButtonSize, string | undefined> = {
  touch: undefined,
  dense: styles.btnDense,
  floor: styles.btnFloor,
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * The action is in flight: a ring spins before the label, the button
   * refuses clicks, and it keeps its colours rather than greying out, so
   * "Saving…" still reads as the primary action.
   */
  busy?: boolean;
}

export function Button({
  variant = "secondary",
  size = "touch",
  busy = false,
  className,
  type = "button",
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    styles.btn,
    VARIANTS[variant],
    SIZES[size],
    busy ? styles.btnBusy : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy && <span className={styles.btnSpinner} aria-hidden="true" />}
      {children}
    </button>
  );
}
