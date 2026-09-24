"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { useTRPC } from "../../trpc/client";
import { dateFormat } from "../../../i18n/formats";
import records from "../../records/records.module.css";
import styles from "./receiving.module.css";

const day = () => dateFormat({ dateStyle: "medium" });

/** A delivery nobody has touched in this many days is called out on the card. */
const STALE_DAYS = 5;

function daysSince(value: string | Date | null): number | null {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

/**
 * Deliveries with reels still to scan, plus the ones just finished.
 *
 * A delivery that has been fully scanned stays on the screen for a few days
 * (the server's window) marked "Fully scanned", rather than vanishing the
 * moment its last reel goes in — finishing a pallet and watching the card
 * disappear reads as "did that save?". Finished ones sort last so the
 * actionable work is always at the top.
 *
 * Polled rather than invalidated: two people scan the same delivery from two
 * handhelds, and the inbox is the one screen where someone else's progress
 * matters. Thirty seconds is slow enough to be free and fast enough that a
 * finished pallet clears itself while you walk to the next one.
 *
 * The server orders by `dateImport desc`, which is the order the office
 * thinks in; this only lifts the unfinished ones above the finished, leaving
 * that order intact within each group. The cards do the rest of the triage:
 * the count of reels still to scan is the biggest number on each one, and a
 * delivery that has been sitting for a week says so.
 */
export function ReceivingInbox() {
  const t = useTranslations("stock");
  const trpc = useTRPC();

  const inboxQuery = useQuery({
    ...trpc.stock.receivingInbox.queryOptions(),
    refetchInterval: 30_000,
  });

  if (inboxQuery.isPending) {
    return <p className={records.muted}>{t("receiving.loading")}</p>;
  }

  if (inboxQuery.isError) {
    return (
      <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
        {inboxQuery.error.message}
      </p>
    );
  }

  const rows = inboxQuery.data;

  if (rows.length === 0) {
    return <EmptyState title={t("receiving.empty")} text={t("receiving.emptyText")} />;
  }

  // The tiles describe outstanding work, so finished deliveries are excluded
  // from every figure except their own count.
  const open = rows.filter((row) => !row.done);
  const finished = rows.length - open.length;
  const pendingReels = open.reduce((n, row) => n + row.pending, 0);
  const longest = open.reduce<number | null>((worst, row) => {
    const age = daysSince(row.dateImport);
    if (age === null) return worst;
    return worst === null || age > worst ? age : worst;
  }, null);

  // Still-to-scan first, then most recently arrived — the finished ones are a
  // receipt, not a queue, so they sit under the work.
  const ordered = [...rows].sort((a, b) => Number(a.done) - Number(b.done));

  return (
    <>
      {/* The three numbers someone wants before walking to the floor: how
          many pallets, how many labels, and whether anything has been left. */}
      <div className={styles.tiles}>
        <span className={styles.tile}>
          <span className={styles.tileLabel}>{t("receiving.tileDeliveries")}</span>
          <span className={styles.tileValue}>{open.length}</span>
        </span>
        <span className={styles.tile}>
          <span className={styles.tileLabel}>{t("receiving.tileReels")}</span>
          <span className={[styles.tileValue, styles.tileValueWarn].filter(Boolean).join(" ")}>
            {pendingReels}
          </span>
        </span>
        <span className={styles.tile}>
          <span className={styles.tileLabel}>{t("receiving.tileLongest")}</span>
          <span className={styles.tileValue}>
            {longest === null ? "—" : t("receiving.days", { count: longest })}
          </span>
        </span>
        <span className={styles.tile}>
          <span className={styles.tileLabel}>{t("receiving.tileDone")}</span>
          <span className={[styles.tileValue, styles.tileValueDone].filter(Boolean).join(" ")}>
            {finished}
          </span>
        </span>
      </div>

      <div className={styles.inbox}>
        {ordered.map((row) => {
          const pct = row.total === 0 ? 0 : Math.round((row.received / row.total) * 100);
          const age = daysSince(row.dateImport);
          // A finished delivery is never stale and never "in progress".
          const stale = !row.done && age !== null && age >= STALE_DAYS;
          const started = row.received > 0;

          return (
            <article
              key={row.id}
              className={[
                styles.card,
                stale ? styles.cardStale : null,
                row.done ? styles.cardDone : null,
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className={styles.cardHead}>
                <span className={styles.cardNumber}>{row.numeroImport}</span>
                <span
                  className={[
                    styles.state,
                    row.done ? styles.stateDone : started ? styles.stateStarted : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {row.done
                    ? t("receiving.doneStatus")
                    : started
                      ? t("receiving.inProgress")
                      : t("receiving.notStarted")}
                </span>
              </div>
              <span className={styles.cardSupplier}>{row.supplier.name}</span>
              <span className={styles.cardDate}>
                {row.dateImport ? day().format(new Date(row.dateImport)) : "—"}
                {age === null ? null : ` · ${t("receiving.waitingDays", { count: age })}`}
              </span>

              {/*
               * A ring rather than a bar: the number that matters on this
               * screen is what is LEFT, and the ring puts the percentage and
               * the count in the same glance without a second row of chrome.
               */}
              <div className={styles.cardBody}>
                <span
                  className={[styles.ring, row.done ? styles.ringDone : null]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ "--pct": `${pct}%` } as React.CSSProperties}
                  role="img"
                  aria-label={t("receiving.progress", {
                    received: row.received,
                    total: row.total,
                  })}
                >
                  <span className={styles.ringHole}>{pct}%</span>
                </span>
                <span className={styles.counts}>
                  <span className={styles.count}>
                    <span className={styles.countLabel}>{t("receiving.scanned")}</span>
                    <span className={styles.countValue}>{row.received}</span>
                  </span>
                  <span
                    className={[styles.count, row.done ? null : styles.countLeft]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span className={styles.countLabel}>{t("receiving.stillToScan")}</span>
                    <span className={styles.countValue}>{row.pending}</span>
                  </span>
                </span>
              </div>

              <Link className={styles.cardAction} href={`/stock/receiving/${row.id}`}>
                <Button variant={row.done ? "secondary" : "primary"} size="floor">
                  {row.done ? t("receiving.openAgain") : t("receiving.open")}
                </Button>
              </Link>
            </article>
          );
        })}
      </div>
    </>
  );
}
