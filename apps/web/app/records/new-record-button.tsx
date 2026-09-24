"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { canAccess } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { useCurrentUser } from "../auth/use-auth";
import styles from "./records.module.css";

/**
 * Header actions, hidden from callers who cannot use them.
 *
 * A client component because the role comes from `me`, which is fetched. The
 * pages themselves stay server components; only this needs the session.
 * Rendering nothing until `me` resolves avoids flashing a button that then
 * disappears.
 */
function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useCurrentUser();
  if (!user || !canAccess(user.role, "ADMIN")) return null;
  return <>{children}</>;
}

/** The primary "New …" action. */
export function NewRecordButton({ href, label }: { href: string; label: string }) {
  return (
    <AdminOnly>
      <Link href={href}>
        <Button variant="primary">{label}</Button>
      </Link>
    </AdminOnly>
  );
}

/**
 * A page's header actions as one flex group, so several buttons sit together on
 * the right rather than being spread by the header's `space-between`.
 *
 * Each child decides its own visibility, so a group whose children all hide
 * collapses to an empty box rather than leaving a gap — `gap` only applies
 * between rendered children.
 */
export function RecordActions({ children }: { children: ReactNode }) {
  return <div className={styles.headerActions}>{children}</div>;
}

/**
 * A secondary action alongside the primary one — currently "Supplier families",
 * which is reached from the suppliers page rather than the sidebar: it is a
 * sub-page of that module, not a peer of it.
 */
export function SecondaryRecordButton({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <AdminOnly>
      <Link href={href}>
        <Button variant="secondary">{label}</Button>
      </Link>
    </AdminOnly>
  );
}
