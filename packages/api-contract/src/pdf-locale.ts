import { z } from "zod";

/**
 * The four languages a generated document can be rendered in.
 *
 * Deliberately NOT named `LOCALES` / `Locale`: `apps/web/i18n/config.ts`
 * already owns those names for the app's own locale handling, and the web
 * imports this package with `export *`, so sharing the names would shadow
 * them at every call site. The list is duplicated rather than imported
 * because that config is a Next.js app module the API cannot reach across the
 * app boundary — the two must be kept in step by hand, which is why both
 * files say so.
 */
export const PDF_LOCALES = ["en", "fr", "ar", "es"] as const;
export type PdfLocale = (typeof PDF_LOCALES)[number];

/** French, not English: the legacy documents were French and suppliers expect them. */
export const DEFAULT_PDF_LOCALE: PdfLocale = "fr";

/**
 * The `?lang=` a document request may carry. Defaults rather than rejects: a
 * missing or unknown language should still produce the document, in the
 * language the supplier has always received it in.
 */
export const pdfLocaleSchema = z
  .enum(PDF_LOCALES)
  .optional()
  .transform((value) => value ?? DEFAULT_PDF_LOCALE);

export function isPdfLocale(value: unknown): value is PdfLocale {
  return typeof value === "string" && (PDF_LOCALES as readonly string[]).includes(value);
}
