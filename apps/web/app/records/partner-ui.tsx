"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { formatDay } from "../../i18n/formats";
import records from "./records.module.css";
import styles from "./partners.module.css";

/*
 * The pieces the clients and suppliers modules share: the record panel's
 * rows and meter, the list's contact-coverage cell, the figures above the
 * list, and the form's numbered steps and live name check. Each module keeps
 * its own field list and its own panel layout; this file only knows about
 * the shape they have in common.
 */

/** The contact channels both partner tables carry. */
export interface ContactChannels {
  email: string | null;
  phone: string | null;
  /** Suppliers only; a second number to call still makes a row reachable. */
  phone2?: string | null;
  address: string | null;
}

/** How many of `keys` hold a value on `record`. */
export function filledCount<T>(record: T, keys: readonly (keyof T)[]): number {
  return keys.filter((key) => {
    const value = record[key];
    return value !== null && value !== undefined && value !== "";
  }).length;
}

/** Reachable means someone can actually be contacted: an email or a phone. */
export function isReachable(record: ContactChannels): boolean {
  return Boolean(record.email || record.phone || record.phone2);
}

/** The API sends an ISO timestamp for a `@db.Date` column; show the day. */
export function formatDate(value: string | Date | null): string | null {
  return value === null ? null : formatDay(value);
}

/** Trails `value` by `ms`, so a live check does not fire per keystroke. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/** label / value row; a missing value says so in words rather than a dash. */
export function FieldRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  const common = useTranslations("common");
  return (
    <div className={records.detailRow}>
      <span className={records.detailLabel}>{label}</span>
      <span className={records.detailValue}>
        {value === null || value === "" ? (
          <span className={styles.absentValue}>{common("notRecorded")}</span>
        ) : (
          value
        )}
      </span>
    </div>
  );
}

/** Completeness as a labelled bar; shared by the panel and the form preview. */
export function CompletenessMeter({
  filled,
  total,
  label,
  className,
}: {
  filled: number;
  total: number;
  label: string;
  className?: string | undefined;
}) {
  const pct = Math.round((filled / total) * 100);
  return (
    <div className={className}>
      <div className={styles.meterRow}>
        <span className={records.kpiLabel} style={{ marginBottom: 0 }}>
          {label}
        </span>
        <span className={styles.meterValue}>{pct}%</span>
      </div>
      <div
        className={styles.meter}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span className={styles.meterFill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const CHANNELS = [
  { key: "email", initial: "E" },
  { key: "phone", initial: "P" },
  { key: "address", initial: "A" },
] as const;

/**
 * Which contact channels a row has, as three lettered boxes plus an n/total
 * count over every optional field. What the old email + phone columns said
 * in two em-dashes, in a third of the width — and the count is what the
 * "missing contact" figure above the list is made of.
 */
export function Coverage({
  record,
  filled,
  total,
}: {
  record: ContactChannels;
  filled: number;
  total: number;
}) {
  const t = useTranslations("records");
  return (
    <span className={styles.coverage}>
      {CHANNELS.map((channel) => {
        // A second phone counts as "phone" — the box says a number exists.
        const value =
          channel.key === "phone"
            ? (record.phone ?? record.phone2 ?? null)
            : record[channel.key];
        const label = t(`channels.${channel.key}`);
        return (
          <span
            key={channel.key}
            className={[styles.dot, value ? styles.dotOn : null]
              .filter(Boolean)
              .join(" ")}
            title={
              value
                ? t("channelValue", { label, value })
                : t("channelMissing", { label })
            }
          >
            {channel.initial}
          </span>
        );
      })}
      <span className={styles.coverageLabel}>
        {filled}/{total}
      </span>
    </span>
  );
}

/** The same figure as a bar, for when the panel has taken the width. */
export function CoverageBar({
  filled,
  total,
}: {
  filled: number;
  total: number;
}) {
  return (
    <span className={styles.coverage}>
      <span className={styles.coverageBar} aria-hidden="true">
        <span
          className={styles.coverageBarFill}
          style={{ width: `${(filled / total) * 100}%` }}
        />
      </span>
      <span className={styles.coverageLabel}>
        {filled}/{total}
      </span>
    </span>
  );
}

/** One figure above the list. */
export function Stat({
  label,
  value,
}: {
  label: string;
  value: number | undefined;
}) {
  return (
    <div className={records.kpiTile}>
      <span className={records.kpiLabel}>{label}</span>
      <span className={records.kpiValue}>{value ?? "–"}</span>
    </div>
  );
}

/** The whole strip: the same four figures for either partner book. */
export function PartnerStats({
  noun,
  stats,
}: {
  noun: string;
  stats:
    | { total: number; reachable: number; missing: number; duplicates: number }
    | undefined;
}) {
  const t = useTranslations("records");
  return (
    <div className={records.kpiGrid}>
      <Stat label={t("stats.total", { noun })} value={stats?.total} />
      <Stat label={t("stats.reachable")} value={stats?.reachable} />
      <Stat label={t("stats.missingContact")} value={stats?.missing} />
      <Stat label={t("stats.possibleDuplicates")} value={stats?.duplicates} />
    </div>
  );
}

/** The in-row tag on a look-alike name. */
export function DuplicateTag() {
  const t = useTranslations("records");
  return <span className={styles.dupTag}>{t("possibleDuplicate")}</span>;
}

/** The panel's callout naming the row this one resembles. */
export function DuplicateNotice({ of }: { of: string }) {
  const t = useTranslations("records");
  return (
    <div className={styles.dupNotice}>
      <span className={styles.dupNoticeTitle}>{t("possibleDuplicate")}</span>
      {t.rich("duplicateNotice", {
        name: of,
        strong: (chunks) => <strong>{chunks}</strong>,
      })}
    </div>
  );
}

/** Section heading: a numbered step, its title, and what is expected of it. */
export function Step({
  number,
  title,
  meta,
  required,
}: {
  number: number;
  title: string;
  meta: string;
  required: boolean;
}) {
  return (
    <div className={styles.step}>
      <span
        className={[styles.stepNum, required ? null : styles.stepNumMuted]
          .filter(Boolean)
          .join(" ")}
      >
        {number}
      </span>
      <span className={styles.stepTitle}>{title}</span>
      <span className={styles.stepMeta}>{meta}</span>
    </div>
  );
}

/** What the server said about the name being typed. */
export interface NameVerdict {
  exact: { id: string; name: string; active: boolean } | null;
  near: { id: string; name: string }[];
}

/**
 * The line under the name field: a red notice for the row that would make
 * the save fail, a blue one for a row it merely resembles, and the plain
 * uniqueness hint otherwise.
 */
export function NameCheck({ verdict }: { verdict: NameVerdict | undefined }) {
  const t = useTranslations("records");
  const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;
  const clash = verdict?.exact ?? null;
  const near = verdict?.near[0] ?? null;
  if (clash) {
    return (
      <div
        className={[styles.nameNotice, styles.nameNoticeClash]
          .filter(Boolean)
          .join(" ")}
        role="alert"
      >
        {t.rich(clash.active ? "nameClash" : "nameClashArchived", {
          name: clash.name,
          strong,
        })}
      </div>
    );
  }
  if (near) {
    return (
      <div
        className={[styles.nameNotice, styles.nameNoticeNear]
          .filter(Boolean)
          .join(" ")}
      >
        {t.rich("nameNear", { name: near.name, strong })}
      </div>
    );
  }
  return <p className={records.hint}>{t("nameHint")}</p>;
}
