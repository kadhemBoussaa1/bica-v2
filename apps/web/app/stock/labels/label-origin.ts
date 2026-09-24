/**
 * The origin a printed label's QR should encode.
 *
 * `NEXT_PUBLIC_APP_URL` wins because the label outlives the session that
 * printed it: the office prints from a laptop on localhost, and the label is
 * then scanned on a handheld where `localhost` is the handheld itself. The
 * fallback to the current origin keeps dev working without configuration.
 */
export function labelOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}
