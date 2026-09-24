"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/*
 * Keeps a PDF preview in step with a form, one request at a time.
 *
 * The server cannot cancel a render once it has started, so racing requests
 * and aborting the losers would only stack work there (and it answers 429 to
 * a second concurrent preview for exactly that reason). Instead: while a
 * request is pending, a change only records the newest body; when the pending
 * one settles, the newest body goes out if it differs from what was sent.
 * The last keystroke is therefore always the frame that ends up shown, and
 * there is never more than one request in flight.
 *
 * Responses arrive in order by construction, so nothing can land stale. An
 * intermediate frame is shown rather than dropped — on a long burst of typing
 * it is progress — and `pending` stays true until the newest body is drawn.
 */

export interface PdfPreview {
  /** The latest PDF's bytes; null before the first one. */
  data: ArrayBuffer | null;
  /** A request is pending, or a newer body is waiting its turn. */
  pending: boolean;
  /** Why the last request produced no PDF; the previous frame is kept. */
  error: string | null;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param url    the POST endpoint answering `application/pdf`
 * @param body   the JSON body as a string, so a change is a plain `!==`; null sends nothing
 * @param delay  quiet time before a change is sent. A render is ~100 ms, so
 *               this only needs to outlast a burst of keystrokes.
 */
export function usePdfPreview(url: string, body: string | null, delay = 350): PdfPreview {
  const [preview, setPreview] = useState<PdfPreview>({ data: null, pending: false, error: null });

  const latest = useRef<string | null>(body);
  const sent = useRef<string | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);

  const pump = useCallback(async () => {
    if (inFlight.current || !alive.current) return;
    const next = latest.current;
    if (next === null || next === sent.current) return;

    inFlight.current = true;
    sent.current = next;
    controller.current = new AbortController();
    setPreview((current) => ({ ...current, pending: true }));
    try {
      const response = await fetch(url, {
        method: "POST",
        // The session cookie lives on the API origin.
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: next,
        signal: controller.current.signal,
      });
      if (response.status === 429) {
        // Another tab's render holds the slot: count this body as unsent and
        // go round again shortly.
        sent.current = null;
        await wait(800);
      } else if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as { error?: string } | null;
        if (alive.current) {
          setPreview((current) => ({ ...current, error: problem?.error ?? response.statusText }));
        }
      } else {
        const data = await response.arrayBuffer();
        if (alive.current) setPreview((current) => ({ ...current, data, error: null }));
      }
    } catch (cause) {
      // An abort is this hook unmounting, not a failure.
      if (alive.current && !(cause instanceof DOMException && cause.name === "AbortError")) {
        setPreview((current) => ({
          ...current,
          error: cause instanceof Error ? cause.message : "Preview failed",
        }));
      }
    } finally {
      inFlight.current = false;
      if (alive.current) {
        if (latest.current !== null && latest.current !== sent.current) void pump();
        else setPreview((current) => ({ ...current, pending: false }));
      }
    }
  }, [url]);

  useEffect(() => {
    latest.current = body;
    const timer = setTimeout(() => void pump(), delay);
    return () => clearTimeout(timer);
  }, [body, delay, pump]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);

  return preview;
}
