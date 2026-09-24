/**
 * Reel label parsing, shared by the API, the print page and the redirect routes.
 *
 * A label encodes the reel's id as a URL — `https://<host>/scan/roll/<cuid>` —
 * so scanning one with a phone camera opens the reel, and scanning it with the
 * warehouse's keyboard-wedge imager types the same URL into the receiving
 * screen. The parser is the single place that knows both shapes, which is why
 * it lives here rather than in the service: the print page builds the URL, the
 * redirect page reads it, and the server validates it, and all three must agree.
 *
 * Deliberately zod-free and dependency-free. It runs in the browser on a
 * handheld, and it is called once per scan in a tight loop.
 *
 * Two shapes resolve:
 *
 *   - v2 labels, `/scan/roll/<cuid>` — the reel's own id.
 *   - legacy labels, `/scan/rouleau/<digits>` — the legacy bigint key, which
 *     732 printed reels still carry. Resolved through `PaperRoll.legacyId`.
 *
 * A bare cuid is accepted too: it is what the reel detail page's "Receive"
 * button sends, and typing one by hand is a reasonable fallback when a label
 * is too damaged to scan.
 *
 * Bare digits are REFUSED. A supplier's own barcode is plain digits, and
 * treating those as legacy ids would silently receive the wrong reel.
 */

/** What a scanned code resolved to. `null` means "not one of our labels". */
export type RollScan =
  | { kind: "id"; id: string }
  | { kind: "legacyId"; legacyId: string };

/** Cuid v1, as Prisma's `@default(cuid())` generates: `c` + 24 base36 chars. */
const CUID = /^c[a-z0-9]{24}$/;

const ID_PATH = /^\/scan\/roll\/(c[a-z0-9]{24})\/?$/;

/**
 * Legacy ids are a bigint column; 18 digits is comfortably inside its range
 * and stops a pathological string from reaching `BigInt()`.
 */
const LEGACY_PATH = /^\/scan\/rouleau\/(\d{1,18})\/?$/;

/**
 * Parse a scanned code.
 *
 * The scanner is configured to send the QR's text followed by Enter, but a
 * mis-set suffix or a stray keypress can leave control characters in the
 * buffer, so those are stripped before anything else.
 *
 * `legacyId` stays a **string**. It is a bigint on the server, and neither
 * `BigInt` nor a number past 2^53 survives JSON — the caller converts it at
 * the Prisma boundary, where the value is about to be a bigint anyway.
 */
export function parseRollScan(raw: string): RollScan | null {
  // Control characters are exactly what we are stripping: a keyboard-wedge
  // scanner with a mis-set suffix sends them inline with the payload.
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\x00-\x1F\x7F]/g, "").trim().toLowerCase();
  if (!cleaned) return null;

  if (CUID.test(cleaned)) return { kind: "id", id: cleaned };

  const path = pathnameOf(cleaned);
  if (!path) return null;

  const asId = ID_PATH.exec(path);
  if (asId?.[1]) return { kind: "id", id: asId[1] };

  const asLegacy = LEGACY_PATH.exec(path);
  if (asLegacy?.[1]) return { kind: "legacyId", legacyId: asLegacy[1] };

  return null;
}

/**
 * The path part of a scan, or null if this is not a path at all.
 *
 * Accepts a bare path so a label printed against one origin still scans after
 * the app moves host — the id is what identifies the reel, not the domain.
 */
function pathnameOf(cleaned: string): string | null {
  if (cleaned.startsWith("/")) return cleaned;
  if (!/^https?:\/\//.test(cleaned)) return null;
  try {
    return new URL(cleaned).pathname;
  } catch {
    return null;
  }
}

/** The URL a printed label encodes for `id`. Mirror of `ID_PATH`. */
export function rollScanUrl(origin: string, id: string): string {
  return `${origin.replace(/\/+$/, "")}/scan/roll/${id}`;
}
