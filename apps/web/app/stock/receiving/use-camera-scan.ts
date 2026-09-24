"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reads QR codes from the device camera, for phones with no wedge scanner.
 *
 * A fallback, not the main path: the warehouse handheld has a real imager and
 * the wedge is faster and works in poor light. This exists so someone with a
 * phone can receive a reel without hunting for the scanner.
 *
 * Uses the browser's own Barcode Detection API rather than shipping a WASM
 * decoder — a QR library is ~50 kB of JavaScript for a secondary path, and
 * the device that needs this most (Android Chrome) is the one that has the
 * API. Where it is missing the caller hides the button entirely.
 */
export function useCameraScan({
  enabled,
  onScan,
}: {
  enabled: boolean;
  onScan: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Assigned in an effect rather than during render: a ref written while
  // rendering is not part of the committed tree.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    async function start() {
      try {
        const Detector = window.BarcodeDetector;
        if (!Detector) return;
        stream = await navigator.mediaDevices.getUserMedia({
          // The back camera: the operator points the phone at the pallet.
          video: { facingMode: "environment" },
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const detector = new Detector({ formats: ["qr_code"] });
        // 150 ms is well inside "feels instant" and leaves the main thread
        // alone between frames; detect() on a full frame is not free.
        timer = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const found = await detector.detect(videoRef.current);
            const first = found[0];
            if (first?.rawValue) onScanRef.current(first.rawValue);
          } catch {
            // A single failed frame is not worth surfacing; the next one runs.
          }
        }, 150);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }

    void start();

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };
  }, [enabled]);

  return { videoRef, error };
}

/** Whether this browser can decode a QR from the camera at all. */
export function cameraScanSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}
