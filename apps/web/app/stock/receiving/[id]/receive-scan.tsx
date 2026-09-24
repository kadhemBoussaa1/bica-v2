"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { Tabs } from "@repo/ui/tabs";
import { useTRPC } from "../../../trpc/client";
import { formatDay, numberFormat } from "../../../../i18n/formats";
import { invalidateRollQueries } from "../../roll-queries";
import {
  primeAudio,
  signalAlready,
  signalReceived,
  signalRefused,
} from "../scan-feedback";
import { cameraScanSupported, useCameraScan } from "../use-camera-scan";
import { useScanCapture } from "../use-scan-capture";
import records from "../../../records/records.module.css";
import stock from "../../stock.module.css";
import styles from "../receiving.module.css";

/** What the last scan did, or nothing yet. */
type Outcome = "received" | "alreadyReceived" | "refused" | "notFound" | "notALabel";

interface Result {
  outcome: Outcome;
  /** The reel's number when the server knew which reel; the raw code otherwise. */
  reel: string;
  spec: string | null;
  /** A refusal's server message, shown verbatim: it names the real shipment. */
  detail: string | null;
}

/** Which reels the side list shows. */
type ReelTab = "pending" | "received" | "all";

const mm = numberFormat({ maximumFractionDigits: 0 });

/**
 * Receiving one delivery: scan every reel label, each scan puts that reel
 * into stock — docs/receiving-plan.md §6e.
 *
 * The whole screen is `data-surface="floor"`: this is the handheld's page,
 * held at arm's length over a pallet, and the ink ground is easier on the
 * eyes in a warehouse than the wash the office pages use.
 *
 * Three ways in, one handler. The wedge scanner (the real path) types into
 * the document with no field focused; the camera is the fallback for a phone;
 * the typed box is for a torn label. All three land on `submit`, so the
 * duplicate window, the feedback tones and the result card behave the same
 * however the code arrived.
 */
export function ReceiveScan({ shipmentId }: { shipmentId: string }) {
  const t = useTranslations("stock");
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [armed, setArmed] = useState(false);
  const [camera, setCamera] = useState(false);
  const [manual, setManual] = useState(false);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [recent, setRecent] = useState<{ code: string; numero: string }[]>([]);
  const [tab, setTab] = useState<ReelTab>("pending");
  const zoneRef = useRef<HTMLDivElement | null>(null);

  const shipmentQuery = useQuery(trpc.stock.shipmentById.queryOptions({ id: shipmentId }));
  const reelsQuery = useQuery(
    trpc.stock.rollsForShipment.queryOptions({
      shipmentId,
      // Pending first: the list is a checklist of what is left, and the
      // reels already in are the ones nobody needs to look at.
      sortBy: "receivedAt",
      sortDir: "asc",
      page: 1,
      pageSize: 100,
    }),
  );

  /**
   * The last code and when it landed, so a scanner that double-triggers does
   * not fire two mutations. Held in a ref: two scans can arrive inside one
   * React batch and a state read would still see the first one's value.
   */
  const lastRef = useRef<{ code: string; at: number } | null>(null);
  const inFlightRef = useRef(false);

  const receive = useMutation(
    trpc.stock.receiveRoll.mutationOptions({
      onSuccess: async (row, variables) => {
        // `numero` is a label, not a key, and is nullable on migrated reels;
        // the code that was scanned is the next best thing to show.
        const numero = row.numero ?? variables.code;
        const spec = [
          row.paperGrade || null,
          row.grammage ? `${mm.format(row.grammage)} g/m²` : null,
          row.laize ? `${mm.format(row.laize)} mm` : null,
        ]
          .filter(Boolean)
          .join(" · ");

        if (row.outcome === "received") {
          signalReceived();
          setRecent((rows) => [{ code: row.id, numero }, ...rows].slice(0, 10));
        } else {
          signalAlready();
        }
        setResult({
          outcome: row.outcome,
          reel: numero,
          spec: spec || null,
          detail: null,
        });

        await Promise.all([
          invalidateRollQueries(queryClient, trpc),
          queryClient.invalidateQueries({ queryKey: trpc.stock.receivingInbox.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.nav.counts.queryKey() }),
        ]);
      },
      onError: (cause, variables) => {
        signalRefused();
        // The server's own wording is the useful part of a refusal — it names
        // the reel's real shipment, or says it is archived or used up — so it
        // is shown verbatim rather than flattened into one "refused" string.
        const outcome: Outcome =
          cause.data?.code === "NOT_FOUND"
            ? "notFound"
            : cause.data?.code === "BAD_REQUEST"
              ? "notALabel"
              : "refused";
        setResult({
          outcome,
          reel: variables.code,
          spec: null,
          detail: outcome === "refused" ? cause.message : null,
        });
      },
    }),
  );

  // Cleared here rather than in an `onSettled`: a ref written from inside the
  // options object is a render-phase write as far as the linter is concerned,
  // and this says the same thing about the same moment.
  useEffect(() => {
    if (!receive.isPending) inFlightRef.current = false;
  }, [receive.isPending]);

  const submit = useCallback(
    (code: string) => {
      const trimmed = code.trim();
      if (!trimmed || inFlightRef.current) return;

      // A 1.5 s window on the same code. The Inateck fires twice on a long
      // press often enough to matter, and a second scan would only ever read
      // back "already received" — a beep that says nothing.
      const now = Date.now();
      const last = lastRef.current;
      if (last && last.code === trimmed && now - last.at < 1500) return;
      lastRef.current = { code: trimmed, at: now };

      inFlightRef.current = true;
      receive.mutate({ shipmentId, code: trimmed });
    },
    [receive, shipmentId],
  );

  const { buffer } = useScanCapture({ enabled: armed && !manual, onScan: submit });
  const { videoRef, error: cameraError } = useCameraScan({ enabled: camera, onScan: submit });

  /**
   * The wedge types into whatever has focus, so the page has to hold it. An
   * app switch or a screen lock hands focus away and the next scan would go
   * nowhere; taking it back on return is what makes the screen survive being
   * put down between pallets.
   */
  useEffect(() => {
    if (!armed) return;
    const refocus = () => {
      if (document.visibilityState === "visible") zoneRef.current?.focus();
    };
    window.addEventListener("focus", refocus);
    document.addEventListener("visibilitychange", refocus);
    return () => {
      window.removeEventListener("focus", refocus);
      document.removeEventListener("visibilitychange", refocus);
    };
  }, [armed]);

  const arm = useCallback(() => {
    // The tap is the user gesture the AudioContext needs; without priming it
    // here the first scan of the delivery is silent.
    primeAudio();
    setArmed(true);
    zoneRef.current?.focus();
  }, []);

  if (shipmentQuery.isPending) {
    return (
      <div className={records.page} data-surface="floor">
        <p className={records.muted}>{t("receiving.loading")}</p>
      </div>
    );
  }

  if (shipmentQuery.isError) {
    return (
      <div className={records.page} data-surface="floor">
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {shipmentQuery.error.message}
        </p>
      </div>
    );
  }

  const shipment = shipmentQuery.data;
  const total = shipment.receivableCount;
  const received = total - shipment.pendingCount;
  const pct = total === 0 ? 0 : Math.round((received / total) * 100);
  const done = shipment.pendingCount === 0;

  const rows = reelsQuery.data?.rows ?? [];
  const visible = rows.filter((row) =>
    tab === "all" ? true : tab === "pending" ? row.receivedAt === null : row.receivedAt !== null,
  );

  return (
    <div className={records.page} data-surface="floor">
      <Link className={records.back} href="/stock/receiving">
        {t("receiving.backToInbox")}
      </Link>

      <header className={records.header}>
        <div className={records.heading}>
          <span className={records.eyebrow}>{shipment.numeroImport}</span>
          <h1 className={records.title}>{shipment.supplier?.name ?? t("receiving.scanTitle")}</h1>
          <p className={records.subtitle}>{t("receiving.scanSubtitle")}</p>
        </div>
        <div className={styles.scanHead}>
          <span className={styles.scanProgress}>
            {t("receiving.progress", { received, total })}
          </span>
          <span className={[stock.bar, stock.barTall].filter(Boolean).join(" ")}>
            <span
              className={[stock.barFill, done ? stock.barFillFull : null]
                .filter(Boolean)
                .join(" ")}
              style={{ inlineSize: `${pct}%` }}
            />
          </span>
        </div>
      </header>

      {!shipment.active ? (
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {t("receiving.shipmentArchived")}
        </p>
      ) : null}

      <div className={styles.scan}>
        <div
          ref={zoneRef}
          className={[styles.zone, armed ? styles.zoneArmed : null].filter(Boolean).join(" ")}
          // Focusable but not an input: the wedge needs the document to hold
          // focus, while an `<input>` would open Android's soft keyboard over
          // a screen the operator is holding one-handed.
          tabIndex={0}
          role="button"
          aria-label={t("receiving.tapToArm")}
          onClick={arm}
          onKeyDown={(event) => {
            if (event.key === " ") {
              event.preventDefault();
              arm();
            }
          }}
        >
          {camera ? <video ref={videoRef} className={styles.video} muted playsInline /> : null}
          <span className={styles.zoneHint}>
            {armed ? t("receiving.waiting") : t("receiving.tapToArm")}
          </span>
          {/* What the wedge has typed so far: proof that keys are arriving
              even before the terminator commits the scan. */}
          {buffer ? <span className={styles.zoneBuffer}>{buffer}</span> : null}
        </div>

        {result ? (
          <div
            className={[
              styles.status,
              result.outcome === "received"
                ? styles.statusReceived
                : result.outcome === "alreadyReceived"
                  ? styles.statusAlready
                  : styles.statusRefused,
            ]
              .filter(Boolean)
              .join(" ")}
            role="status"
            aria-live="polite"
          >
            <span className={styles.statusOutcome}>{t(`receiving.${result.outcome}`)}</span>
            <span className={styles.statusReel}>{result.reel}</span>
            {result.spec ? <span className={styles.statusSpec}>{result.spec}</span> : null}
            {result.detail ? <span className={styles.statusSpec}>{result.detail}</span> : null}
          </div>
        ) : null}

        <div className={styles.scanActions}>
          {cameraScanSupported() ? (
            <Button
              type="button"
              variant="secondary"
              size="floor"
              onClick={() => {
                primeAudio();
                setCamera((on) => !on);
              }}
            >
              {camera ? t("receiving.cameraOff") : t("receiving.camera")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="floor"
            onClick={() => setManual((on) => !on)}
          >
            {t("receiving.manualEntry")}
          </Button>
        </div>

        {cameraError ? (
          <p className={records.muted}>{t("receiving.cameraUnsupported")}</p>
        ) : null}

        {manual ? (
          <form
            className={styles.manual}
            onSubmit={(event) => {
              event.preventDefault();
              submit(typed);
              setTyped("");
            }}
          >
            <label className={styles.manualLabel} htmlFor="reel-code">
              {t("receiving.manualLabel")}
            </label>
            <div className={styles.manualRow}>
              <input
                id="reel-code"
                className={styles.manualInput}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <Button type="submit" variant="primary" size="floor" busy={receive.isPending}>
                {t("receiving.manualSubmit")}
              </Button>
            </div>
            <span className={styles.manualHint}>{t("receiving.manualHint")}</span>
          </form>
        ) : null}

        {recent.length > 0 ? (
          <div className={styles.recent}>
            <span className={styles.recentTitle}>{t("receiving.recent")}</span>
            {recent.map((row) => (
              <span key={row.code} className={styles.recentRow}>
                <span className={styles.recentReel}>{row.numero}</span>
                <span>{t("receiving.received")}</span>
              </span>
            ))}
          </div>
        ) : null}

        <section className={styles.reels}>
          <span className={styles.recentTitle}>{t("receiving.reelsTitle")}</span>
          <Tabs
            label={t("receiving.reelsTitle")}
            value={tab}
            onChange={setTab}
            tabs={[
              { key: "pending", label: t("receiving.tabPending") },
              { key: "received", label: t("receiving.tabReceived") },
              { key: "all", label: t("receiving.tabAll") },
            ]}
          />
          {reelsQuery.isPending ? (
            <p className={records.muted}>{t("receiving.loading")}</p>
          ) : visible.length === 0 ? (
            <EmptyState title={t("receiving.allIn")} text={t("receiving.allInText")} />
          ) : (
            visible.map((row) => (
              <span key={row.id} className={styles.reelRow}>
                <span className={styles.recentReel}>{row.numero}</span>
                <span className={styles.reelMeta}>
                  {row.receivedAt
                    ? `${t("receiving.received")} · ${formatDay(row.receivedAt)}`
                    : t("rolls.filters.pending")}
                </span>
              </span>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
