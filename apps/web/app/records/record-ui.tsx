import type { ReactNode } from "react";
import records from "./records.module.css";

/*
 * The detail-page primitives every record page shares: a titled panel, a
 * labelled row inside it, and a value that shows the muted dash when it was
 * never recorded. One copy, so an invoice, a reel and a shipment cannot
 * drift apart in how they draw "absent". No hooks and no strings of its
 * own, so it works in server and client components alike.
 */

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={records.detailRow}>
      <span className={records.detailLabel}>{label}</span>
      <span className={records.detailValue}>{children}</span>
    </div>
  );
}

/** A stored value, or the dash that means "not recorded", so absent never reads as zero. */
export function Val({ value, suffix }: { value: string | number | null; suffix?: string }) {
  if (value === null || value === "") return <span className={records.absent} />;
  return (
    <>
      {value}
      {suffix ? ` ${suffix}` : ""}
    </>
  );
}

/** A titled section; `wide` spans both columns of the detail grid. */
export function Panel({
  title,
  wide,
  children,
}: {
  title: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={[records.detailPanel, wide ? records.detailPanelWide : null]
        .filter(Boolean)
        .join(" ")}
    >
      <h2 className={records.detailTitle}>{title}</h2>
      {children}
    </section>
  );
}
