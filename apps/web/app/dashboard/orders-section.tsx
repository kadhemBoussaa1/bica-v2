"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { OrderStatus } from "@repo/api-contract";
import { numberFormat } from "../../i18n/formats";
import { Panel } from "./section";
import type { Summary } from "./summary";
import styles from "./dashboard.module.css";

const int = () => numberFormat({ maximumFractionDigits: 0 });

/**
 * Each status's mark, from `Dashboard v3.dc.html`: round for work moving,
 * softly squared for paperwork, square for the one that stopped.
 */
const STATUS_CLASS: Record<OrderStatus, string | undefined> = {
  DRAFT: styles.statusDraft,
  IN_PRODUCTION: styles.statusInProduction,
  PRODUCED: styles.statusProduced,
  INVOICEABLE: styles.statusInvoiceable,
  INVOICED: styles.statusInvoiced,
  READY_FOR_EXPORT: styles.statusReady,
  COMPLETED: styles.statusCompleted,
  CANCELLED: styles.statusCancelled,
};

/** Finished one way or the other: still counted, no longer the point. */
const SETTLED = new Set<OrderStatus>(["COMPLETED", "CANCELLED"]);

/**
 * The active job orders by status, in lifecycle order, each bar scaled to
 * the largest. The label column is a shared subgrid track, so it is as wide
 * as the longest status in the reader's language and every bar starts on
 * the same line.
 */
export function OrdersSection({ data }: { data: Summary }) {
  const t = useTranslations("dashboard.orders");
  const enums = useTranslations("enums");
  const { byStatus, quotes } = data.orders;
  const total = byStatus.reduce((sum, row) => sum + row.count, 0);
  const max = Math.max(...byStatus.map((row) => row.count), 1);

  return (
    <Panel
      title={t("title")}
      sub={t("sub", { total, quotes })}
      subBelow
      links={[{ href: "/orders", label: t("link") }]}
    >
      <div className={styles.statusRows}>
        {byStatus.map((row) => (
          <Link
            key={row.status}
            href="/orders"
            className={[styles.statusRow, STATUS_CLASS[row.status]].filter(Boolean).join(" ")}
          >
            <span
              className={[
                styles.statusLabel,
                row.count > 0 && !SETTLED.has(row.status) ? styles.statusLabelLive : null,
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <i className={styles.dot} aria-hidden="true" />
              {enums(`orderStatus.${row.status}`)}
            </span>
            <span className={styles.statusTrack} aria-hidden="true">
              <span
                className={styles.statusFill}
                style={{ width: row.count > 0 ? `${Math.max(2, Math.round((row.count / max) * 100))}%` : 0 }}
              />
            </span>
            <span
              className={[styles.statusCount, row.count === 0 ? styles.statusCountZero : null]
                .filter(Boolean)
                .join(" ")}
            >
              {int().format(row.count)}
            </span>
          </Link>
        ))}
      </div>
    </Panel>
  );
}
