"use client";

import { useState } from "react";
import { assetUrl } from "@repo/api-contract";
import { initials } from "../nav/initials";
import { employeeName } from "./week";
import styles from "./shifts.module.css";

interface AvatarProps {
  employee: { id: string; firstName: string; lastName: string; matricule: string; photo?: string | null };
  size?: "sm" | "md" | "lg";
}

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
 * a tint otherwise. A squircle, like every avatar in the toolkit. The mock
 * drew initials only; the user asked for photos, so the photo leads and the
 * initials are the fallback (and the state while a dead legacy URL fails).
 */
export function Avatar({ employee, size = "md" }: AvatarProps) {
  const src = assetUrl(employee.photo);
  const [failed, setFailed] = useState<string | null>(null);
  const sizeClass = size === "sm" ? styles.avSm : size === "lg" ? styles.avLg : styles.avMd;
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
