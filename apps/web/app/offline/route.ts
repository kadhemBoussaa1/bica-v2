import { getLocale, getTranslations } from "next-intl/server";
import { dirFor, type Locale } from "../../i18n/config";

/**
 * The page the service worker (public/sw.js) shows when a navigation fails
 * for want of a network — docs/pwa-plan.md step 3.
 *
 * A route handler rather than a page: the worker caches this one response
 * and nothing else, so it must stand alone — no app shell, no JS chunks, no
 * web fonts, all of which need the network it does not have. The styles are
 * inlined copies of the tokens, and the retry is a plain reload.
 *
 * Exempt from middleware.ts: fetched signed out (the worker installs on
 * /login), it would otherwise be a redirect, and /login would be cached as
 * the offline page. It reads no data. `Content-Language` is how the worker
 * tells which language its cached copy is in (the `offline-locale` message).
 */
export async function GET(): Promise<Response> {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("shell");

  const html = `<!doctype html>
<html lang="${locale}" dir="${dirFor(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f29100">
<title>${escapeHtml(t("offline.title"))}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  /* --bp-text-root and --bp-page, copied: tokens.css is not cached. */
  html { color-scheme: light; background: #efe9e0; font-size: 17.5px; }
  body {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: calc(24px + env(safe-area-inset-top, 0px)) 24px calc(24px + env(safe-area-inset-bottom, 0px));
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #1a1714;
    -webkit-font-smoothing: antialiased;
  }
  main {
    width: min(420px, 100%);
    display: grid;
    justify-items: center;
    gap: 16px;
    padding: 32px 24px;
    text-align: center;
    background: rgb(255 255 255 / 0.72);
    border: 1px solid rgb(255 255 255 / 0.8);
    border-radius: 24px;
    box-shadow: 0 14px 34px rgb(26 23 20 / 0.09);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border-radius: 16px;
    background: #fdebd0;
    color: #8a4e00;
  }
  h1 { font-size: 1.25rem; font-weight: 700; line-height: 1.3; }
  p { font-size: 0.9375rem; line-height: 1.5; color: #5c544b; }
  button {
    min-height: 48px;
    padding: 0 22px;
    border: 0;
    border-radius: 14px;
    background: linear-gradient(135deg, #f29100 0%, #d97c00 100%);
    box-shadow: 0 8px 20px rgb(217 124 0 / 0.34);
    color: #fff;
    font-family: inherit;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
  }
  button:focus-visible { outline: 2px solid #b36500; outline-offset: 2px; }
</style>
</head>
<body>
<main>
  <span class="icon" aria-hidden="true">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 8.8a15 15 0 0 1 4.2-2.6"/><path d="M10 5.1A15 15 0 0 1 22 8.8"/>
      <path d="M5 12.6a10 10 0 0 1 5.2-2.7"/><path d="M15.4 10.5A10 10 0 0 1 19 12.6"/>
      <path d="M8.5 16.4a5 5 0 0 1 7 0"/><circle cx="12" cy="20" r="0.9" fill="currentColor"/>
      <path d="M3 3l18 18"/>
    </svg>
  </span>
  <h1>${escapeHtml(t("offline.title"))}</h1>
  <p>${escapeHtml(t("offline.body"))}</p>
  <button type="button" onclick="location.reload()">${escapeHtml(t("offline.retry"))}</button>
</main>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Language": locale,
    },
  });
}

/** The translations are ours, but a stray `<` or `&` must not become markup. */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
