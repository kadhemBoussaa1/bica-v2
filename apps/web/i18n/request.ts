import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "./config";

/**
 * Messages live in `messages/<locale>/<namespace>.json`, one file per
 * module, merged here into one object keyed by namespace. One file per
 * module rather than one per language so that adding a module's strings
 * never touches another module's file.
 */
function loadMessages(locale: Locale): Record<string, unknown> {
  const dir = join(process.cwd(), "messages", locale);
  const messages: Record<string, unknown> = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    messages[file.slice(0, -5)] = JSON.parse(readFileSync(join(dir, file), "utf8"));
  }
  return messages;
}

export default getRequestConfig(async () => {
  const store = await cookies();
  const raw = store.get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return {
    locale,
    messages: loadMessages(locale),
    timeZone: "Africa/Tunis",
  };
});
