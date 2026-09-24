"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@repo/ui/button";
import { useToast } from "@repo/ui/toast";
import { useCameraScan, cameraScanSupported } from "../../receiving/use-camera-scan";
import { useScanCapture } from "../../receiving/use-scan-capture";
import {
  primeAudio,
  signalAlready,
  signalReceived,
  signalRefused,
} from "../../receiving/scan-feedback";
import { useTRPC } from "../../../trpc/client";
import records from "../../../records/records.module.css";
import styles from "../stocktake.module.css";

/**
 * What the last scan did. The three server outcomes plus the two client-side
 * failures, which never reach the server as a successful call.
 */
type Outcome =
  | "counted"
  | "alreadyCounted"
  | "notCountable"
  | "notFound"
  | "notALabel"
  | "closed";

interface Result {
  outcome: Outcome;
  numero: string | null;
  spec: string | null;
}

/** How long the same code is ignored after a scan. */
const DUPLICATE_MS = 1500;

/**
 * Scanning reels during a stocktake.
 *
 * A rewrite against receiving's shared hooks rather than a copy of its screen:
 * the generic machinery (`useScanCapture`, `useCameraScan`, `scan-feedback`)
 * is imported, and everything else here is stocktake-specific. There is no
 * reel checklist — "still to scan" over 353 reels across 24 deliveries is not
 * a useful list on a handheld, and the variance report answers that question
 * properly once the count is closed.
 *
 * Progress runs against `labelledCount`, not `expectedCount`: a reel with no
 * printed sticker cannot be scanned however present it is, so counting against
 * the full countable set would show a bar that can never fill.
 */
export function CountScan({ countId }: { countId: string }) {
  const t = useTranslations("stock");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { push } = useToast();

  const [armed, setArmed] = useState(false);
  const [camera, setCamera] = useState(false);
  const [manual, setManual] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [recent, setRecent] = useState<readonly Result[]>([]);

  const zoneRef = useRef<HTMLDivElement | null>(null);
  // Two distinct guards, both needed: `lastRef` swallows the imager's
  // double-trigger on a long press, `inFlightRef` stops overlapping mutations.
  const lastRef = useRef<{ code: string; at: number } | null>(null);
  const inFlightRef = useRef(false);

  const countQuery = useQuery(trpc.inventory.byId.queryOptions({ id: countId }));
  const summaryQuery = useQuery(trpc.inventory.summary.queryOptions({ id: countId }));

  const record = (next: Result) => {
    setResult(next);
    setRecent((prev) => [next, ...prev].slice(0, 10));
  };

  const scan = useMutation(
    trpc.inventory.scan.mutationOptions({
      onSuccess: async (data) => {
        const spec = [data.paperGrade, data.grammage ? `${data.grammage} g/m²` : null, data.laize ? `${data.laize} mm` : null]
          .filter(Boolean)
          .join(" · ");
        record({ outcome: data.outcome, numero: data.numero, spec: spec || null });
        if (data.outcome === "counted") signalReceived();
        else if (data.outcome === "alreadyCounted") signalAlready();
        else signalRefused();

        await queryClient.invalidateQueries({ queryKey: trpc.inventory.summary.queryKey() });
        await queryClient.invalidateQueries({ queryKey: trpc.inventory.byId.queryKey() });
      },
      onError: (cause) => {
        const code = cause.data?.code;
        const outcome: Outcome =
          code === "BAD_REQUEST"
            ? "notALabel"
            : code === "NOT_FOUND"
              ? "notFound"
              : code === "PRECONDITION_FAILED"
                ? "closed"
                : "notFound";
        // A network failure is not a scan outcome — it is the one case the
        // operator must not read as "this reel is not here".
        if (!code) {
          push({ title: t("stocktake.networkError"), tone: "error" });
          return;
        }
        record({ outcome, numero: null, spec: null });
        signalRefused();
      },
    }),
  );

  useEffect(() => {
    if (!scan.isPending) inFlightRef.current = false;
  }, [scan.isPending]);

  const submit = useCallback(
    (code: string) => {
      const trimmed = code.trim();
      if (!trimmed || inFlightRef.current) return;

      const now = Date.now();
      const last = lastRef.current;
      if (last && last.code === trimmed && now - last.at < DUPLICATE_MS) return;
      lastRef.current = { code: trimmed, at: now };

      inFlightRef.current = true;
      scan.mutate({ countId, code: trimmed });
    },
    [scan, countId],
  );

  const { buffer } = useScanCapture({ enabled: armed && !manual, onScan: submit });
  const { videoRef, error: cameraError } = useCameraScan({ enabled: camera, onScan: submit });

  /**
   * The wedge types into whatever has focus, so the page has to hold it. An
   * app switch or a screen lock hands focus away and the next scan would go
   * nowhere; taking it back on return is what makes the screen survive being
   * put down between racks.
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
    // here the first scan of the count is silent.
    primeAudio();
    setArmed(true);
    zoneRef.current?.focus();
  }, []);

  const close = useMutation(
    trpc.inventory.close.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.inventory.list.queryKey() });
        await queryClient.invalidateQueries({ queryKey: trpc.nav.counts.queryKey() });
        router.push(`/stock/counts/${countId}/report`);
      },
      onError: (cause) => push({ title: cause.message, tone: "error" }),
    }),
  );

  if (countQuery.isPending) {
    return (
      <div className={records.page} data-surface="floor">
        <p className={records.muted}>{t("stocktake.loading")}</p>
      </div>
    );
  }

  if (countQuery.isError) {
    return (
      <div className={records.page} data-surface="floor">
        <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
          {countQuery.error.message}
        </p>
      </div>
    );
  }

  const count = countQuery.data;
  const counted = summaryQuery.data?.counted ?? count._count.lines;
  const labelled = count.labelledCount;
  const isClosed = count.status === "CLOSED";

  const statusClass =
    result === null
      ? null
      : result.outcome === "counted"
        ? styles.statusCounted
        : result.outcome === "alreadyCounted"
          ? styles.statusAlready
          : result.outcome === "notCountable"
            ? styles.statusUnexpected
            : styles.statusRefused;

  const outcomeLabel = (outcome: Outcome) =>
    outcome === "closed" ? t("stocktake.closedRefusal") : t(`stocktake.${outcome}`);

  return (
    <div className={records.page} data-surface="floor">
      <Link className={records.back} href="/stock/counts">
        {t("stocktake.backToList")}
      </Link>

      <header className={records.header}>
        <div className={styles.scanHead}>
          <span className={records.eyebrow}>{t("stocktake.title")}</span>
          <h1 className={records.title}>{t("stocktake.scanTitle")}</h1>
          <span className={styles.scanProgress}>
            {t("stocktake.countedOf", { counted, labelled })}
          </span>
          <span className={styles.scanNote}>
            {t("stocktake.expectedNote", {
              expected: count.expectedCount,
              labelled,
            })}
          </span>
        </div>
      </header>

      <div className={styles.scan}>
        {isClosed ? (
          <p className={[records.notice, records.error].filter(Boolean).join(" ")} role="alert">
            {t("stocktake.closedRefusal")}
          </p>
        ) : (
          <div
            ref={zoneRef}
            className={[styles.zone, armed ? styles.zoneArmed : null]
              .filter(Boolean)
              .join(" ")}
            tabIndex={0}
            role="button"
            onClick={arm}
            onFocus={() => setArmed(true)}
          >
            <span className={styles.zoneHint}>
              {armed ? t("stocktake.waiting") : t("stocktake.tapToArm")}
            </span>
            {buffer ? <span className={styles.zoneBuffer}>{buffer}</span> : null}
          </div>
        )}

        {result ? (
          <div className={[styles.status, statusClass].filter(Boolean).join(" ")} role="status">
            <span className={styles.statusOutcome}>{outcomeLabel(result.outcome)}</span>
            {result.numero ? <span className={styles.statusReel}>{result.numero}</span> : null}
            {result.spec ? <span className={styles.statusSpec}>{result.spec}</span> : null}
            {result.outcome === "notCountable" ? (
              <span className={styles.statusSpec}>{t("stocktake.notCountableHint")}</span>
            ) : null}
          </div>
        ) : null}

        {!isClosed ? (
          <div className={styles.scanActions}>
            {cameraScanSupported() ? (
              <Button
                size="floor"
                variant="secondary"
                onClick={() => {
                  primeAudio();
                  setCamera((on) => !on);
                }}
              >
                {camera ? t("stocktake.cameraOff") : t("stocktake.camera")}
              </Button>
            ) : null}
            <Button size="floor" variant="secondary" onClick={() => setManual((on) => !on)}>
              {t("stocktake.manualEntry")}
            </Button>
            <Button size="floor" busy={close.isPending} onClick={() => close.mutate({ id: countId })}>
              {t("stocktake.close")}
            </Button>
          </div>
        ) : (
          <div className={styles.scanActions}>
            <Link href={`/stock/counts/${countId}/report`}>
              <Button size="floor" variant="primary">
                {t("stocktake.viewReport")}
              </Button>
            </Link>
          </div>
        )}

        {camera ? (
          <>
            <video ref={videoRef} className={styles.video} muted playsInline />
            {cameraError ? <p className={records.muted}>{cameraError}</p> : null}
          </>
        ) : null}

        {manual && !isClosed ? (
          <div className={styles.manual}>
            <label className={styles.manualLabel} htmlFor="stocktake-manual">
              {t("stocktake.manualLabel")}
            </label>
            <div className={styles.manualRow}>
              <input
                id="stocktake-manual"
                className={styles.manualInput}
                value={manualCode}
                onChange={(event) => setManualCode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  submit(manualCode);
                  setManualCode("");
                }}
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                size="floor"
                onClick={() => {
                  submit(manualCode);
                  setManualCode("");
                }}
              >
                {t("stocktake.manualSubmit")}
              </Button>
            </div>
            <p className={styles.manualHint}>{t("stocktake.manualHint")}</p>
          </div>
        ) : null}

        {recent.length > 0 ? (
          <div className={styles.recent}>
            <span className={styles.recentTitle}>{t("stocktake.recent")}</span>
            {recent.map((entry, index) => (
              <div className={styles.recentRow} key={`${entry.numero ?? "?"}-${index}`}>
                <span className={styles.recentReel}>{entry.numero ?? "—"}</span>
                <span>{outcomeLabel(entry.outcome)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
