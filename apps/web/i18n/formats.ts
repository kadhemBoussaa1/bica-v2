import { DEFAULT_LOCALE, isLocale, type Locale } from "./config";

/**
 * Locale-aware Intl formatters for the app's figures and dates.
 *
 * These exist because most call sites are module-level constants or plain
 * helper functions, not components, so they cannot read the locale through
 * `useLocale()`. The locale is instead taken from `<html lang>`, which the
 * root layout sets from the same cookie next-intl reads — so the two can
 * never disagree — and formatters are memoised per locale so switching the
 * language does not rebuild one on every row.
 *
 * On the server (no `document`) this falls back to the default locale. That
 * only affects text rendered before hydration; every date and figure below
 * is inside a client component.
 */
function activeLocale(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const lang = document.documentElement.lang;
  return isLocale(lang) ? lang : DEFAULT_LOCALE;
}

/**
 * Figures keep French grouping in every language: they are business data
 * read off the same sheets by French, Arabic and Spanish speakers, and a
 * quantity that regroups as "12,750" for one reader and "12 750" for
 * another is a transcription error waiting to happen. Only the language of
 * words changes; the language of numbers does not.
 */
const FIGURE_LOCALE = "fr-FR";

/**
 * Dates are `dd/mm/yyyy` in every language (user decision, 2026-09-23),
 * which reverses the earlier rule that dates followed the reader's
 * language. Same reasoning as the figures above, and the same format the
 * generated documents have always printed (`pdf.format.ts`), so a date on
 * screen and a date on an invoice now read alike.
 *
 * `fr-FR` renders exactly that from explicit numeric fields, keeps Western
 * digits under `ar`, and gives a 24-hour clock rather than English AM/PM.
 *
 * Month NAMES still follow the reader's language: a month name is a word,
 * and "août" on an Arabic page is simply wrong. `resolveDate` below is what
 * draws the line between the two.
 */
const DATE_LOCALE = "fr-FR";

/** What every `dateStyle` becomes: 23/09/2026. */
const NUMERIC_DAY: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
};

/**
 * What every `timeStyle` becomes. Intl rejects `timeStyle` alongside
 * explicit date fields, so the shorthand has to be expanded rather than
 * passed through once the date half is spelled out.
 */
const NUMERIC_TIME: Record<string, Intl.DateTimeFormatOptions> = {
  short: { hour: "2-digit", minute: "2-digit" },
  medium: { hour: "2-digit", minute: "2-digit", second: "2-digit" },
  long: { hour: "2-digit", minute: "2-digit", second: "2-digit" },
  full: { hour: "2-digit", minute: "2-digit", second: "2-digit" },
};

/**
 * Decides which language a request is in and rewrites the shorthand.
 *
 * Anything naming a calendar day or a clock is pinned to `DATE_LOCALE` and
 * spelled out numerically, so `dateStyle: "medium"` at any of the call
 * sites renders `23/09/2026` without each of them having to know. Anything
 * asking only for a month or a weekday is left alone and follows the
 * reader.
 */
function resolveDate(options: Intl.DateTimeFormatOptions): {
  locale: string;
  options: Intl.DateTimeFormatOptions;
} {
  const { dateStyle, timeStyle, ...rest } = options;
  const namesADayOrAClock =
    dateStyle !== undefined ||
    timeStyle !== undefined ||
    rest.day !== undefined ||
    rest.hour !== undefined ||
    rest.minute !== undefined ||
    rest.second !== undefined;
  if (!namesADayOrAClock) return { locale: activeLocale(), options };
  return {
    locale: DATE_LOCALE,
    options: {
      ...(dateStyle === undefined ? {} : NUMERIC_DAY),
      ...(timeStyle === undefined ? {} : NUMERIC_TIME[timeStyle]),
      ...rest,
    },
  };
}

const numberCache = new Map<string, Intl.NumberFormat>();
const dateCache = new Map<string, Intl.DateTimeFormat>();

export function numberFormat(options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let fmt = numberCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(FIGURE_LOCALE, options);
    numberCache.set(key, fmt);
  }
  return fmt;
}

export function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const resolved = resolveDate(options);
  // Keyed on what was resolved, not on what was asked for: two different
  // requests that resolve to the same formatter should share one.
  const key = `${resolved.locale}:${JSON.stringify(resolved.options)}`;
  let fmt = dateCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(resolved.locale, resolved.options);
    dateCache.set(key, fmt);
  }
  return fmt;
}

/** The app's one date style, in every language: "23/09/2026". */
export function formatDay(value: string | number | Date): string {
  return dateFormat({ dateStyle: "medium" }).format(new Date(value));
}

export function formatDateTime(value: string | number | Date, seconds = false): string {
  return dateFormat({
    dateStyle: "short",
    timeStyle: seconds ? "medium" : "short",
  }).format(new Date(value));
}

/** "2026-09" as a UTC date, so the month never slips with the viewer's zone. */
function monthDate(month: string): Date {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1));
}

/** A `YYYY-MM` month in words: "septembre 2026" / "September 2026". */
export function formatMonth(month: string): string {
  return dateFormat({ month: "long", year: "numeric", timeZone: "UTC" }).format(
    monthDate(month),
  );
}

/** The same month, short enough for a column head: "sept. 26" / "Sep 26". */
export function formatMonthShort(month: string): string {
  return dateFormat({ month: "short", year: "2-digit", timeZone: "UTC" }).format(
    monthDate(month),
  );
}

/** Just the month's name, short — under a bar, where the year is context. */
export function formatMonthName(month: string): string {
  return dateFormat({ month: "short", timeZone: "UTC" }).format(monthDate(month));
}

/** A share of a whole: `0.87` is "87 %". */
export function formatPercent(ratio: number): string {
  return numberFormat({ style: "percent", maximumFractionDigits: 0 }).format(ratio);
}

/**
 * A change between two figures, as a signed percentage: `0.12` is "+12 %".
 * Wrap the result in `<bdi>` — in Arabic a leading sign is a neutral
 * character and otherwise lands on the far side of the number.
 */
export function formatChange(ratio: number): string {
  return numberFormat({
    style: "percent",
    maximumFractionDigits: 0,
    signDisplay: "exceptZero",
  }).format(ratio);
}
