"use client";

import { useState } from "react";
import { assetUrl } from "@repo/api-contract";
import { initials } from "../nav/initials";
import { employeeName } from "./employee-name";
import styles from "./avatar.module.css";

interface AvatarProps {
  employee: { id: string; firstName: string; lastName: string; matricule: string; photo?: string | null };
  /**
   * sm/md/lg (30–42px) for the shift screens' dense rosters; xl (46px) for
   * an employees list row, xxl (84px) for the form's photo slot, and hero
   * (104px) for the head of a record page.
   */
  size?: "sm" | "md" | "lg" | "xl" | "xxl" | "hero";
}

const SIZES: Record<NonNullable<AvatarProps["size"]>, string | undefined> = {
  sm: styles.avSm,
  md: styles.avMd,
  lg: styles.avLg,
  xl: styles.avXl,
  xxl: styles.avXxl,
  hero: styles.avHero,
};

/** Six tints, picked by the id so one person keeps one colour everywhere. */
const TINTS = [
  styles.avTint0,
  styles.avTint1,
  styles.avTint2,
  styles.avTint3,
  styles.avTint4,
  styles.avTint5,
];

function tintFor(id: string): string | undefined {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

/**
 * A person on the roster: their photo when the record has one, initials on
 * a tint otherwise. A squircle, like every avatar in the toolkit. The photo
 * leads and the initials are the fallback (and the state while a dead legacy
 * URL fails). One component for the employees list and every shift screen,
 * so a person looks the same wherever they appear.
 */
export function Avatar({ employee, size = "md" }: AvatarProps) {
  const src = assetUrl(employee.photo);
  const [failed, setFailed] = useState<string | null>(null);
  const sizeClass = SIZES[size];
  const showPhoto = src !== null && failed !== src;

  return (
    <span
      className={[styles.av, sizeClass, showPhoto ? null : tintFor(employee.id)]
        .filter(Boolean)
        .join(" ")}
      aria-hidden="true"
    >
      {showPhoto ? (
        // Plain <img>: DB-sourced URLs on a bucket this app does not own.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.avImg}
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(src)}
        />
      ) : (
        initials(employeeName(employee))
      )}
    </span>
  );
}
