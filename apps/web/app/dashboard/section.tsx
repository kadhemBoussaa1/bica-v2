"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./dashboard.module.css";

/** "→", mirrored in Arabic so it still points the way the line reads. */
export function Arrow() {
  return (
    <span className={styles.arrow} aria-hidden="true">
      →
    </span>
  );
}

/**
 * One module's glass panel: a title, a line of context and the links out.
 *
 * `sub` sits beside the title in the wide panels (production, finances) and
 * under it in the narrow ones (`subBelow`), where the two would otherwise
 * wrap into each other.
 */
export function Panel({
  title,
  sub,
  subBelow = false,
  links = [],
  children,
}: {
  title: string;
  sub?: ReactNode;
  subBelow?: boolean;
  links?: ReadonlyArray<{ href: string; label: string }>;
  children: ReactNode;
}) {
  return (
    <section className={styles.panel} aria-label={title}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>{title}</h2>
        {sub !== undefined && !subBelow && <span className={styles.panelSub}>{sub}</span>}
        {links.length > 0 && (
          <span className={styles.panelLinks}>
            {links.map((link) => (
              <Link key={link.href} className={styles.panelLink} href={link.href}>
                {link.label} <Arrow />
              </Link>
            ))}
          </span>
        )}
      </div>
      {sub !== undefined && subBelow && <p className={styles.panelSubBelow}>{sub}</p>}
      {children}
    </section>
  );
}

/**
 * A small mark before a label. Colour AND shape carry the tone — round for
 * live or fine, square for trouble — so the page survives a grayscale print,
 * as the list tiles do.
 */
export type DotTone = "live" | "ok" | "danger" | "warn" | "info" | "muted";

const DOT_CLASS: Record<DotTone, string | undefined> = {
  live: styles.dotLive,
  ok: styles.dotOk,
  danger: styles.dotDanger,
  warn: styles.dotWarn,
  info: styles.dotInfo,
  muted: styles.dotMuted,
};

export function Dot({ tone, className }: { tone: DotTone; className?: string }) {
  return (
    <i
      className={[styles.dot, DOT_CLASS[tone], className].filter(Boolean).join(" ")}
      aria-hidden="true"
    />
  );
}
