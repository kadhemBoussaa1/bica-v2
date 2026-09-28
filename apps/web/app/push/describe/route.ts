import { createTranslator } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { notificationPayload } from "@repo/api-contract";
import { dirFor, type Locale } from "../../../i18n/config";
import { describeNotification } from "../../nav/notification-text";

/** A payload is a few hundred bytes; anything near this is not one. */
const MAX_BODY = 8 * 1024;

/**
 * Words a push for the service worker — docs/pwa-plan.md step 14.
 *
 * The API cannot word it: it does not know the device's language, which is
 * this browser's `bp-locale` cookie. So the worker (public/sw.js) POSTs the
 * push's `{ kind, params }` here, and the bell's own `describeNotification`
 * answers in that language — one wording for the bell, the toasts and the
 * lock screen, and no translations copied into the API.
 *
 * A pure formatter: it returns text for the input it is given and reads no
 * data, so it is exempt from middleware.ts. It has to be — a device whose
 * session cookie has lapsed still receives pushes until the Session row
 * expires, and would otherwise get "Bicapack" for every one. nginx rate
 * limits it (docker/nginx/snippets/locations.conf): it is the app's only
 * anonymous route that does work per request.
 */
export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return error(413, "Payload too large");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return error(400, "Malformed JSON");
  }
  const parsed = notificationPayload.safeParse(body);
  if (!parsed.success) return error(400, "Not a notification payload");

  // Each call reads the request config — every message file — afresh: a
  // route handler has no React cache to memoise it. So once each, and both
  // translators come from the one set of messages.
  const locale = (await getLocale()) as Locale;
  const messages = await getMessages();
  const t = createTranslator({ locale, messages, namespace: "notifications" });
  const enums = createTranslator({ locale, messages, namespace: "enums" });

  const { title, detail } = describeNotification(parsed.data, t, enums, locale);
  return Response.json(
    { title, ...(detail ? { body: detail } : {}), lang: locale, dir: dirFor(locale) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
