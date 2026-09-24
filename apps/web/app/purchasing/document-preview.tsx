"use client";

import { useLocale, useTranslations } from "next-intl";
import { Button } from "@repo/ui/button";
import records from "../records/records.module.css";
import styles from "./purchasing.module.css";

/*
 * A generated document — purchase order, goods receipt, issued sales invoice
 * — previewed on its own detail page. (A sales invoice *draft* previews live
 * on a canvas instead: see `documents/pdf-canvas.tsx`.)
 *
 * An <iframe> rather than a canvas renderer: the document is already a PDF on
 * the API, the browser has a viewer, and embedding by URL needs no CORS —
 * which matters because the legacy asset bucket sends no CORS headers at all,
 * so anything fetch-based would fail for the scanned invoices next door.
 *
 * The API mints the file, so the src goes to the API origin with credentials
 * carried by the cookie. `lang` follows whoever is reading: the same order
 * prints in French for the office and Arabic for the floor.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type DocumentKind = "purchase-order" | "goods-receipt" | "sales-invoice";

/** The API route proven by `/documents/:kind/:id.pdf?lang=`. */
export function documentUrl(kind: DocumentKind, id: string, locale: string): string {
  return `${API_URL}/documents/${kind}/${encodeURIComponent(id)}.pdf?lang=${locale}`;
}

export function DocumentPreview({
  kind,
  id,
  numero,
  hint,
}: {
  kind: DocumentKind;
  id: string;
  numero: string;
  /** Replaces the "re-renders each time" note, which is untrue of a stored invoice. */
  hint?: string;
}) {
  const t = useTranslations("purchasing");
  const locale = useLocale();
  const url = documentUrl(kind, id, locale);

  return (
    <div className={styles.preview}>
      <div className={styles.previewActions}>
        {/*
          A plain anchor, not a fetch-and-save: the bucket and the API both
          serve these directly, and `download` on a cross-origin URL is
          ignored by the browser anyway — so this opens the PDF in a tab,
          where the viewer's own save button works.
        */}
        <a href={url} target="_blank" rel="noreferrer">
          <Button size="dense" variant="secondary">
            {t("preview.openTab")}
          </Button>
        </a>
      </div>
      <iframe
        // Keyed on the URL so switching language reloads the frame rather
        // than leaving the previous language's render in place.
        key={url}
        className={styles.previewFrame}
        src={url}
        title={t("preview.title", { numero })}
      />
      <p className={records.hint}>{hint ?? t("preview.hint")}</p>
      <noscript>
        <a href={url}>{t("open")}</a>
      </noscript>
    </div>
  );
}

/**
 * A scanned document already on the legacy bucket — a supplier's invoice on a
 * goods receipt, or a purchase invoice's attachments.
 *
 * Same iframe for the same reason, but the URL is the stored one passed
 * through `assetUrl` by the caller: these are files bica-v2 did not mint and
 * must not rewrite.
 */
export function ScanPreview({ url, label }: { url: string; label: string }) {
  const t = useTranslations("purchasing");

  return (
    <div className={styles.preview}>
      <div className={styles.previewActions}>
        <a href={url} target="_blank" rel="noreferrer">
          <Button size="dense" variant="secondary">
            {t("preview.openTab")}
          </Button>
        </a>
      </div>
      <iframe key={url} className={styles.previewFrame} src={url} title={label} />
    </div>
  );
}
