/**
 * Legacy S3 asset URLs.
 *
 * The legacy Spring app (`back-bica-pack`) uploads to the bucket below under
 * flat `{epochMillis}_{sanitizedName}` keys and stores the **full public URL**
 * in Postgres. The migration copied those strings across verbatim, so bica-v2
 * renders URLs it did not mint and must not rewrite: both apps keep reading and
 * writing the same rows, and the stored form is what resolves to a real object.
 *
 * Reads need no credentials — anonymous `GetObject` works on this bucket — so
 * nothing here touches the AWS SDK.
 */

export const LEGACY_ASSET_HOST = "sip-api-assets.s3.us-east-2.amazonaws.com";

/**
 * Make a stored URL safe to put in `src`/`href`.
 *
 * Older uploads predate the legacy `sanitizeFilename`, so their keys contain
 * raw spaces and accented characters that a browser will not fetch as-is. Of
 * the 591 non-empty URLs in the migrated data, 149 carry a raw space and 9 are
 * non-ASCII (`WhatsApp Image ... à 12.16.38...`, `sous plat imprimeé`); both
 * shapes were verified to return 206 once encoded this way.
 *
 * `decodeURI` first is what makes this idempotent: an already-encoded `%20`
 * decodes back to a space and re-encodes to the same `%20`, rather than
 * becoming `%2520` on every render.
 *
 * The catch deliberately returns `raw` untouched rather than `encodeURI(raw)`.
 * `decodeURI` throws only on a malformed `%` sequence, and encoding that `%`
 * to `%25` would name a *different* key than the one in the bucket — inventing
 * a 404 in precisely the case the guard exists to handle. A literal `%` is
 * already in the form the legacy app stored and serves, so passing it through
 * preserves the behaviour. No migrated row has one today; the unit case does.
 */
export function assetUrl(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;

  const trimmed = raw.trim();
  if (trimmed === "") return null;

  try {
    return encodeURI(decodeURI(trimmed));
  } catch {
    return trimmed;
  }
}

/**
 * The file name at the end of an asset URL, for link labels.
 *
 * Mirrors the legacy `substring(lastIndexOf('/') + 1)` rule, then decodes so a
 * label reads `sabaidi 2.jpg` rather than `sabaidi%202.jpg`.
 *
 * **Display only.** Legacy does not decode — `MachineService.delete` hands that
 * raw substring straight to S3 as the object key — and because it stores
 * unencoded URLs, its raw substring *is* the true key. Any future delete path
 * must therefore derive the key from the **stored** column, never from
 * `assetUrl()` output or this function: asking S3 to delete
 * `..._sabaidi%202.jpg` when the object is `..._sabaidi 2.jpg` is a silent
 * no-op that orphans the file.
 */
export function assetFileName(url: string): string {
  const name = url.slice(url.lastIndexOf("/") + 1);

  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}
