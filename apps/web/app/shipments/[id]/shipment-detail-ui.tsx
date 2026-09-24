"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { assetFileName } from "@repo/api-contract";
import records from "../../records/records.module.css";
import styles from "../shipments.module.css";

/*
 * The pieces the draft editor and the shipped record share, from "Shipment
 * detail v4.dc.html": the glass section with its meta line, the fact tiles
 * and rows, the two document cards, the rail links, the trail and the
 * per-line balance pill.
 */

/**
 * `@db.Date` arrives as an ISO timestamp at UTC midnight; a date input wants
 * its date part. Lives here, not in the record, because the draft editor
 * needs it too and the record imports the editor.
 */
export function dateInput(value: string | Date | null): string {
  return value === null ? "" : new Date(value).toISOString().slice(0, 10);
}

/** "PDF", "JPG"… from the stored name, for the attached file's meta line. */
export function fileKind(url: string): string | null {
  const ext = assetFileName(url).split(".").pop()?.toUpperCase() ?? "";
  return ext.length >= 2 && ext.length <= 4 ? ext : null;
}

/** A glass panel with the handoff's head: a mono title and a meta line on the right. */
export function Section({
  title,
  meta,
  metaTone,
  children,
}: {
  title: string;
  meta: string;
  metaTone?: "ok" | "warn";
  children: ReactNode;
}) {
  return (
    <section className={records.detailPanel}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        <span
          className={[
            styles.sectionMeta,
            metaTone === "ok" ? styles.sectionMetaOk : null,
            metaTone === "warn" ? styles.sectionMetaWarn : null,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {meta}
        </span>
      </div>
      {children}
    </section>
  );
}

/** One of the facts about the truck, as a small tile. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <span className={styles.factLabel}>{label}</span>
      <span className={styles.factValue}>{children}</span>
    </div>
  );
}

/** The rail's label / value row. */
export function FactRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.factRow}>
      <span className={styles.factRowLabel}>{label}</span>
      <span className={styles.factRowValue}>{children}</span>
    </div>
  );
}

/**
 * One of the two papers: an icon, a title, the pill that says whether it is
 * attached, then whatever the caller puts inside (the references, the
 * dropzone, the declaration's form).
 */
export function DocumentCard({
  title,
  note,
  attached,
  required = false,
  missing = false,
  editing = false,
  icon,
  children,
}: {
  title: string;
  note: string;
  attached: boolean;
  required?: boolean;
  /** The slot is frozen and empty: "missing", since "required" would promise a fix. */
  missing?: boolean;
  /** Draws the orange edge while the card's form is open. */
  editing?: boolean;
  icon: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("shipments");
  // The list's chips, with one more tone: "required" is orange, not the
  // list's yellow "part" — nothing is half-done, something is owed.
  const pill = attached
    ? { className: styles.docChipOk, label: t("docs.attached"), dot: styles.docDotOk }
    : missing
      ? { className: styles.docChipRequired, label: t("record.missing"), dot: styles.docDotOk }
      : required
      ? { className: styles.docChipRequired, label: t("editor.documents.required"), dot: styles.docDotOk }
      : { className: styles.docChipNone, label: t("editor.documents.optional"), dot: styles.docDotPart };
  return (
    <div
      className={[
        styles.docCard,
        attached ? styles.docCardOk : null,
        editing ? styles.docCardEditing : null,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.docCardHead}>
        <span className={[styles.docIcon, attached ? styles.docIconOk : null].filter(Boolean).join(" ")} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            {icon}
          </svg>
        </span>
        <span className={styles.docCardText}>
          <span className={styles.docCardTitle}>{title}</span>
          <span className={styles.docCardNote}>{note}</span>
        </span>
        <span className={[styles.docChip, pill.className].filter(Boolean).join(" ")}>
          <i className={[styles.docDot, pill.dot].filter(Boolean).join(" ")} aria-hidden="true" />
          {pill.label}
        </span>
      </div>
      <div className={styles.docBody}>{children}</div>
    </div>
  );
}

/** The paper's references above its file: the number it carries, the date it was declared. */
export function DocRefs({ refs }: { refs: { label: string; value: string | null }[] }) {
  return (
    <div className={styles.docRefs}>
      {refs.map((ref) => (
        <span key={ref.label} className={styles.docRef}>
          <span className={styles.docRefLabel}>{ref.label}</span>
          <span className={styles.docRefValue}>
            {ref.value === null || ref.value === "" ? <span className={records.absent} /> : <bdi>{ref.value}</bdi>}
          </span>
        </span>
      ))}
    </div>
  );
}

export const PACKING_ICON = (
  <path d="M16 3H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM9 8h6M9 12h6M9 16h3" />
);
export const CUSTOMS_ICON = (
  <path d="M12 3 4 7v6c0 4 3.4 7.4 8 8 4.6-.6 8-4 8-8V7l-8-4zM9 12l2 2 4-4" />
);

/** A rail link with its label over its value; static when the reader may not open the target. */
export function RailLink({ label, value, href }: { label: string; value: string; href: string | null }) {
  const inner = (
    <>
      <span className={styles.railLinkText}>
        <span className={styles.railLinkLabel}>{label}</span>
        <span className={styles.railLinkValue}>{value}</span>
      </span>
      {href && (
        <span className={styles.railLinkArrow} aria-hidden="true">
          →
        </span>
      )}
    </>
  );
  return href ? (
    <Link className={styles.railLink} href={href}>
      {inner}
    </Link>
  ) : (
    <span className={styles.railLink}>{inner}</span>
  );
}

export function TrailRow({
  tone,
  label,
  meta,
  muted,
}: {
  tone: "info" | "ok" | "warn";
  label: string;
  /** Joined with " · "; one `bdi` per part, so a name and a date keep their order in Arabic. */
  meta: string[];
  muted?: boolean;
}) {
  const dot = {
    info: styles.trailDotInfo,
    ok: styles.trailDotOk,
    warn: styles.trailDotWarn,
  }[tone];
  return (
    <div className={styles.trailRow}>
      <i className={[styles.trailDot, dot].filter(Boolean).join(" ")} aria-hidden="true" />
      <span className={styles.trailText}>
        <span className={[styles.trailLabel, muted ? styles.trailLabelMuted : null].filter(Boolean).join(" ")}>
          {label}
        </span>
        <span className={styles.trailMeta}>
          {meta.map((part, i) => (
            <span key={i}>
              {i > 0 && " · "}
              <bdi>{part}</bdi>
            </span>
          ))}
        </span>
      </span>
    </div>
  );
}

/**
 * The line's balance: settled once the order has nothing left to ship after
 * this line, otherwise what remains. Green round / orange round, like the
 * document chips.
 */
export function SoldePill({ remaining }: { remaining: number | null }) {
  const t = useTranslations("shipments");
  if (remaining === null) return <span className={records.absent} />;
  const settled = remaining === 0;
  return (
    <span
      className={[styles.docChip, settled ? styles.docChipOk : styles.docChipRequired]
        .filter(Boolean)
        .join(" ")}
    >
      <i className={[styles.docDot, styles.docDotOk].filter(Boolean).join(" ")} aria-hidden="true" />
      {settled ? t("editor.cargo.settled") : t("editor.cargo.remaining")}
    </span>
  );
}
