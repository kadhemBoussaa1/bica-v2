"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseRollScan } from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import { useTRPC } from "../../trpc/client";
import { RollDetail } from "../[id]/roll-detail";
import { primeAudio, signalReceived, signalRefused } from "../receiving/scan-feedback";
import { cameraScanSupported, useCameraScan } from "../receiving/use-camera-scan";
import { useScanCapture } from "../receiving/use-scan-capture";
import records from "../../records/records.module.css";
import receiving from "../receiving/receiving.module.css";
import styles from "./scan.module.css";

/** Why the last scan showed no reel. */
type Failure = "notALabel" | "notFound" | "networkError";

/**
 * Scan a reel label, see the reel.
 *
 * The same three inputs as receiving — the wedge scanner, the camera, a typed
 * code for a torn label — all landing on one `submit`, with the same 1.5 s
 * double-trigger window and the same tones. The difference is what a scan
 * does: it only READS. The code is resolved with `stock.resolveScan` (which
 * knows v2 and legacy labels) and the reel is rendered below with the reel
 * page's own `RollDetail`, so the operator sees exactly what the reel page
 * shows — prices are already withheld server-side below ADMIN.
 *
 * The screen stays armed while a reel is showing: scanning the next label
 * replaces it, so walking a row of reels is scan, read, scan.
 */
export function RollLookup() {
  const t = useTranslations("stock");
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [armed, setArmed] = useState(false);
  const [camera, setCamera] = useState(false);
  const [manual, setManual] = useState(false);
  const [typed, setTyped] = useState("");
  const [rollId, setRollId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ reason: Failure; code: string } | null>(null);
  const [looking, setLooking] = useState(false);
  const zoneRef = useRef<HTMLDivElement | null>(null);

  /** See receive-scan.tsx: held in refs because two scans can share a batch. */
  const lastRef = useRef<{ code: string; at: number } | null>(null);
  const inFlightRef = useRef(false);

  const fail = useCallback((reason: Failure, code: string) => {
    signalRefused();
    // The previous reel goes away: left on screen under a red card it would
    // read as the answer to this scan.
    setRollId(null);
    setFailure({ reason, code });
  }, []);

  const submit = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      if (!trimmed || inFlightRef.current) return;

      const now = Date.now();
      const last = lastRef.current;
      if (last && last.code === trimmed && now - last.at < 1500) return;
      lastRef.current = { code: trimmed, at: now };

      // A supplier's barcode or a stray keypress is refused here, without a
      // round trip — `parseRollScan` is the same parser the server runs.
      if (!parseRollScan(trimmed)) {
        fail("notALabel", trimmed);
        return;
      }

      inFlightRef.current = true;
      setLooking(true);
      try {
        const roll = await queryClient.fetchQuery({
          ...trpc.stock.resolveScan.queryOptions({ code: trimmed }),
          staleTime: 0,
          retry: false,
        });
        // Re-read the reel even when it is the one already showing: the
        // operator scans because they want what is true now.
        await queryClient.invalidateQueries({
          queryKey: trpc.stock.rollById.queryKey({ id: roll.id }),
        });
        signalReceived();
        setFailure(null);
        setRollId(roll.id);
        zoneRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      } catch (cause) {
        const code = (cause as { data?: { code?: string } | null } | null)?.data?.code;
        fail(
          code === "NOT_FOUND" ? "notFound" : code === "BAD_REQUEST" ? "notALabel" : "networkError",
          trimmed,
        );
      } finally {
        inFlightRef.current = false;
        setLooking(false);
      }
    },
    [fail, queryClient, trpc],
  );

  const onScan = useCallback((code: string) => void submit(code), [submit]);
  const { buffer } = useScanCapture({ enabled: armed && !manual, onScan });
  const { videoRef, error: cameraError } = useCameraScan({ enabled: camera, onScan });

  /** Taking focus back after an app switch or a screen lock — see receive-scan.tsx. */
  useEffect(() => {
    if (!armed) return;
    const refocus = () => {
      if (document.visibilityState === "visible") zoneRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener("focus", refocus);
    document.addEventListener("visibilitychange", refocus);
    return () => {
      window.removeEventListener("focus", refocus);
      document.removeEventListener("visibilitychange", refocus);
    };
  }, [armed]);

  const arm = useCallback(() => {
    // The tap is the gesture the AudioContext needs, or the first beep is silent.
    primeAudio();
    setArmed(true);
    zoneRef.current?.focus();
  }, []);

  return (
    <div className={receiving.scan}>
      <div
        ref={zoneRef}
        className={[
          receiving.zone,
          armed ? receiving.zoneArmed : null,
          rollId ? styles.zoneCompact : null,
        ]
          .filter(Boolean)
          .join(" ")}
        // Focusable but not an input, so Android keeps its soft keyboard shut.
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
        {camera ? <video ref={videoRef} className={receiving.video} muted playsInline /> : null}
        <span className={receiving.zoneHint}>
          {armed ? t("receiving.waiting") : t("receiving.tapToArm")}
        </span>
        {buffer ? <span className={receiving.zoneBuffer}>{buffer}</span> : null}
        {looking ? <span className={styles.looking}>{t("lookup.looking")}</span> : null}
      </div>

      <div className={receiving.scanActions}>
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
        <Button type="button" variant="secondary" size="floor" onClick={() => setManual((on) => !on)}>
          {t("receiving.manualEntry")}
        </Button>
      </div>

      {cameraError ? <p className={records.muted}>{t("receiving.cameraUnsupported")}</p> : null}

      {manual ? (
        <form
          className={receiving.manual}
          onSubmit={(event) => {
            event.preventDefault();
            void submit(typed);
            setTyped("");
          }}
        >
          <label className={receiving.manualLabel} htmlFor="lookup-code">
            {t("receiving.manualLabel")}
          </label>
          <div className={receiving.manualRow}>
            <input
              id="lookup-code"
              className={receiving.manualInput}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" variant="primary" size="floor" busy={looking}>
              {t("lookup.manualSubmit")}
            </Button>
          </div>
          <span className={receiving.manualHint}>{t("receiving.manualHint")}</span>
        </form>
      ) : null}

      {failure ? (
        <div
          className={[receiving.status, receiving.statusRefused].filter(Boolean).join(" ")}
          role="status"
          aria-live="polite"
        >
          <span className={receiving.statusOutcome}>
            {failure.reason === "networkError"
              ? t("lookup.networkError")
              : t(`receiving.${failure.reason}`)}
          </span>
          <span className={receiving.statusReel}>{failure.code}</span>
        </div>
      ) : null}

      {/* Keyed so a dialog or error left open on one reel never carries over. */}
      {rollId ? <RollDetail key={rollId} id={rollId} /> : null}
    </div>
  );
}
