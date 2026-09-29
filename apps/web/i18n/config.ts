/**
 * The languages the app speaks. The choice is per browser — a cookie the
 * server reads before rendering, so the first paint is already in the right
 * language — and it follows the user through the picker in the top bar and
 * on the login page (docs/i18n.md).
 */
export const LOCALES = ["en", "fr", "ar", "es"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * French, the plant's working language (user decision, 2026-09-29), and
 * the language the generated documents already default to. Only a browser
 * whose user has not picked a language gets it: a choice made in the
 * picker is a cookie, and it wins.
 */
export const DEFAULT_LOCALE: Locale = "fr";

export const LOCALE_COOKIE = "bp-locale";

/** Each language named in itself, as every picker should. */
export const LANGUAGES: readonly { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "ar", label: "العربية" },
  { code: "es", label: "Español" },
];

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Arabic reads right-to-left; the layout mirrors through logical CSS properties. */
export function dirFor(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}
