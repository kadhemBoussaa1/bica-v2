"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Reads a keyboard-wedge barcode scanner without an input field.
 *
 * The Inateck N6029 types the QR's text plus a terminator into whatever has
 * focus. The obvious implementation — an `<input>` — is wrong on a handheld:
 * focusing one opens Android's soft keyboard over the screen, and the
 * operator is holding the device in one hand over a pallet. So the buffer
 * lives in a closure and the events are read off `window`.
 *
 * Three terminators, because a scanner's suffix is configurable and the one
 * in the warehouse may not be the one on the bench:
 *   - Enter / Tab, the configured suffix;
 *   - an idle gap, for a scanner set to send nothing at all. A human types
 *     far slower than 120 ms per character, so the gap cannot split a scan
 *     but also cannot be reached mid-burst.
 *
 * The buffer is mirrored to state only so the screen can show what is
 * arriving; the closure copy is what commits, because two keystrokes can land
 * in one React batch and a state read would miss the first.
 */
export function useScanCapture({
  enabled,
  onScan,
  idleMs = 120,
}: {
  enabled: boolean;
  onScan: (code: string) => void;
  idleMs?: number;
}) {
  const [buffer, setBuffer] = useState("");
  const bufferRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Held in a ref so the window listener never goes stale and never has to be
  // torn down and rebound on every render. Assigned in an effect, not during
  // render: a ref write during render is invisible to the committed tree.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const reset = useCallback(() => {
    bufferRef.current = "";
    setBuffer("");
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const commit = useCallback(() => {
    const code = bufferRef.current.trim();
    reset();
    if (code) onScanRef.current(code);
  }, [reset]);

  useEffect(() => {
    if (!enabled) {
      // Clear the closure buffer and any pending idle timer directly. Calling
      // `reset()` here would setState synchronously in an effect body and
      // cascade a render; the displayed buffer is cleared on the way out
      // instead, in this effect's own cleanup.
      bufferRef.current = "";
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      // Never steal typing from a real field: the page still has a search box
      // and buttons, and a scan aimed at those is not ours.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        // A bare Enter with nothing buffered is someone pressing a button.
        if (bufferRef.current === "") return;
        event.preventDefault();
        commit();
        return;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        bufferRef.current = bufferRef.current.slice(0, -1);
        setBuffer(bufferRef.current);
        return;
      }

      // Printable characters only. `key.length === 1` excludes every named
      // key (Shift, F1, ArrowLeft) without listing them.
      if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      bufferRef.current += event.key;
      setBuffer(bufferRef.current);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(commit, idleMs);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
      bufferRef.current = "";
      setBuffer("");
    };
  }, [enabled, commit, idleMs]);

  return { buffer, reset };
}
