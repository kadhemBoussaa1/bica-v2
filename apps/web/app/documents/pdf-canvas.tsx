"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./pdf-canvas.module.css";

/*
 * A PDF the API minted, drawn on canvases by pdf.js.
 *
 * For bytes this app fetched itself — the live invoice preview. It is NOT a
 * replacement for the `<iframe>` in `purchasing/document-preview.tsx`: the
 * legacy scans live on a bucket that sends no CORS headers, so nothing
 * fetch-based can read them, and a finished document is better served by the
 * browser's own viewer anyway. What an iframe cannot do is swap frames
 * without a white flash on every keystroke, which is the whole job here.
 *
 * pdf.js is ~1 MB with its worker, so both are loaded on first use, never in
 * the page bundle.
 */

type Pdfjs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<Pdfjs> | null = null;

/** One pdf.js and one worker for the whole tab. */
function loadPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= import("pdfjs-dist").then((pdfjs) => {
    // `new URL(…, import.meta.url)` is what lets the bundler find and emit
    // the worker as its own chunk; a bare string would 404 in a build.
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(
      new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
      { type: "module" },
    );
    return pdfjs;
  });
  return pdfjsPromise;
}

/**
 * The teardown of the previous document. pdf.js shares one worker port, and
 * refuses to open a document on it while another is still being destroyed
 * ("the worker is being destroyed — await destroy()"); a cleanup cannot be
 * awaited by React, so the next load awaits it here instead.
 */
let teardown: Promise<unknown> = Promise.resolve();

export function PdfCanvas({
  data,
  stale = false,
  label,
  errorLabel,
}: {
  /** The PDF's bytes; null until the first one arrives. */
  data: ArrayBuffer | null;
  /** A newer render is on its way: keep the frame, dim it. */
  stale?: boolean;
  /** Accessible name of each page; `{page}` is replaced by its number. */
  label: string;
  errorLabel: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const target = host.current;
    if (!data || !target) return;

    let cancelled = false;
    let loadingTask: ReturnType<Pdfjs["getDocument"]> | null = null;
    const renderTasks: { cancel: () => void }[] = [];

    void (async () => {
      const pdfjs = await loadPdfjs();
      await teardown;
      if (cancelled) return;
      // pdf.js transfers the buffer to its worker, which would leave the
      // caller's copy detached; hand it a copy.
      loadingTask = pdfjs.getDocument({ data: data.slice(0) });
      const document_ = await loadingTask.promise;

      const width = target.clientWidth || 520;
      // Sharp on a retina tablet without quadrupling the work past 2x.
      const density = Math.min(window.devicePixelRatio || 1, 2);
      const pages: HTMLCanvasElement[] = [];
      for (let number = 1; number <= document_.numPages; number += 1) {
        const page = await document_.getPage(number);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width / base.width) * density });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        if (styles.page) canvas.className = styles.page;
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", label.replace("{page}", String(number)));
        const task = page.render({ canvas, viewport });
        renderTasks.push(task);
        await task.promise;
        pages.push(canvas);
      }
      if (cancelled) return;
      // Every page is drawn off-screen first and swapped in at once, so the
      // old frame stays up until the new one is whole: no flash, no half page.
      target.replaceChildren(...pages);
      setFailed(false);
    })().catch((cause: unknown) => {
      if (cancelled) return;
      if ((cause as { name?: string } | null)?.name === "RenderingCancelledException") return;
      setFailed(true);
    });

    return () => {
      cancelled = true;
      for (const task of renderTasks) task.cancel();
      const closing = loadingTask;
      if (closing) teardown = teardown.then(() => closing.destroy()).catch(() => undefined);
    };
  }, [data, label]);

  return (
    <>
      {failed && (
        <p className={styles.error} role="alert">
          {errorLabel}
        </p>
      )}
      {/*
        `dir="ltr"`: the sheet is physical geometry. An Arabic invoice is
        mirrored by the renderer, inside the PDF; mirroring the viewer as well
        would only reorder the pages' scrollbar side.
      */}
      <div
        ref={host}
        dir="ltr"
        className={styles.pages}
        data-stale={stale ? "" : undefined}
        aria-busy={stale}
      />
    </>
  );
}
