/**
 * The languages the app speaks. The choice is per browser — a cookie the
 * server reads before rendering, so the first paint is already in the right
 * language — and it follows the user through the picker in the top bar and
 * on the login page (docs/i18n.md).
 */
export const LOCALES = ["en", "fr", "ar", "es"] as const;
export type Locale = (typeof LOCALES)[number];

/** English is what the app spoke before it had a picker: the no-surprise default. */
export const DEFAULT_LOCALE: Locale = "en";

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
