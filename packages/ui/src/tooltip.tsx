"use client";

import { useId, type ReactNode } from "react";
import styles from "./components.module.css";

interface TooltipProps {
  /** Short, one line. Anything longer belongs in a hint, not a tooltip. */
  text: string;
  children: ReactNode;
}

/**
 * Shows `text` above the child on hover and on keyboard focus. The child
 * should itself be focusable (a button, a link) so keyboard users reach it;
 * the text is also wired in through aria-describedby.
 */
export function Tooltip({ text, children }: TooltipProps) {
  const id = useId();
  return (
    <span className={styles.tipWrap} aria-describedby={id}>
      {children}
      <span id={id} role="tooltip" className={styles.tip}>
        {text}
      </span>
    </span>
  );
}
