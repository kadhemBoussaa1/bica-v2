import { z } from "zod";

/**
 * Uploading assets to the legacy S3 bucket — docs/s3-assets-plan.md "Step 2".
 *
 * `assets.ts` reads URLs the legacy Spring app minted; this file is the other
 * half, for the URLs bica-v2 mints itself. Both apps write to the same bucket
 * under the same flat `{epochMillis}_{sanitizedName}` keys and store the full
 * public URL, so each keeps resolving the other's files while they coexist.
 *
 * The rules here are ported from `back-bica-pack`'s `S3Service`, not invented:
 * `sanitizeFilename` mirrors its private method of the same name, and
 * `assetKey`/`assetUrlForKey` mirror its `uploadFile` and `getFileUrl`. Keeping
 * them identical is what makes the shared bucket safe to write to from two
 * places. Shapes live in the contract rather than the service because the
 * browser previews the key it is about to receive and the server pins it.
 */

/**
 * What an upload may be. The two document fields this serves — a packing list
 * and a customs declaration — are scans, so images and PDFs and nothing else.
 *
 * An allowlist, not a blocklist: the bucket is world-readable behind
 * unguessable names, so an uploaded `.html` would be a same-origin-looking
 * page hosted on an AWS domain, and an `.svg` is script-bearing too. Neither
 * is a scan, so neither is here.
 */
export const UPLOAD_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/tiff",
] as const;
export const uploadContentTypeSchema = z.enum(UPLOAD_CONTENT_TYPES);
export type UploadContentType = (typeof UPLOAD_CONTENT_TYPES)[number];

/**
 * 25 MB. A phone photo of a packing list runs 2–8 MB and a multi-page scanned
 * PDF a little more; this leaves headroom without letting a mistaken video
 * through. The presigned PUT carries it as a signed condition, so the cap is
 * enforced by S3 rather than trusted from the browser.
 */
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/** How long a minted upload URL stays usable, in seconds. */
export const UPLOAD_URL_TTL_SECONDS = 300;

/**
 * Strip a file name down to what the legacy sanitizer would have produced.
 *
 * Ported from `S3Service.sanitizeFilename` (NFD-normalise, drop combining
 * marks, map anything outside `[a-zA-Z0-9._-]` to `_`, collapse runs). The
 * result is ASCII-safe, which is why new keys need no percent-encoding at all —
 * `assetUrl()` exists for the pre-sanitizer rows (149 with raw spaces, 9
 * non-ASCII) rather than for anything written from here.
 *
 * Two guards are ours, not legacy's. Legacy maps `/` to `_` and so cannot
 * escape the flat bucket by accident, but it will happily build a key from
 * `..` or a leading dot; and an empty or all-unsafe name would collapse to
 * `""` or `"_"`. A name that reduces to nothing recognisable becomes `file`,
 * matching legacy's own null case, so a key is never just a timestamp with a
 * trailing underscore.
 */
export function sanitizeFilename(filename: string | null | undefined): string {
  if (filename === null || filename === undefined) return "file";

  // \u0300-\u036f is the combining diacritical marks block — Java's
  // \p{InCombiningDiacriticalMarks}. Written as escapes on purpose: as literal
  // characters these are invisible in a diff and any tool that mangles
  // non-ASCII would silently stop stripping accents.
  const withoutMarks = filename.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const safe = withoutMarks.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
  const trimmed = safe.replace(/^[._]+/, "").replace(/[._]+$/, "");

  return trimmed === "" ? "file" : trimmed;
}

/**
 * The object key for a new upload: `{epochMillis}_{sanitizedName}`.
 *
 * Mirrors `S3Service.uploadFile`. The timestamp prefix is what keeps two
 * uploads of the same `facture.pdf` from overwriting one another, and it is
 * minted server-side for a sharper reason: the bucket is flat, so a
 * client-chosen key could name — and overwrite — any existing object in it,
 * including another client's invoice.
 */
export function assetKey(filename: string | null | undefined, now: Date = new Date()): string {
  return `${now.getTime()}_${sanitizeFilename(filename)}`;
}

/**
 * The public URL of a key in the given bucket and region.
 *
 * Mirrors `S3Service.getFileUrl`, which is the form already stored in every
 * migrated row: `https://{bucket}.s3.{region}.amazonaws.com/{key}`. What gets
 * written to Postgres is this string, so the column keeps meaning the same
 * thing whichever app produced it.
 */
export function assetUrlForKey(bucket: string, region: string, key: string): string {
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

/**
 * A request for an upload URL: the file's name, type and size.
 *
 * The name is only a suggestion — the server sanitizes it and prefixes the
 * timestamp — but the type and size are load-bearing: both are signed into
 * the presigned PUT (as Content-Type and Content-Length), and S3 rejects an
 * upload that does not match. `size` must therefore be the file's exact
 * byte length, not an estimate.
 */
export const createUploadInput = z.object({
  filename: z.string().trim().min(1, "File name is required").max(255),
  contentType: uploadContentTypeSchema,
  size: z
    .number()
    .int()
    .min(1, "File is empty")
    .max(UPLOAD_MAX_BYTES, "File is larger than 25 MB"),
});
export type CreateUploadInput = z.infer<typeof createUploadInput>;

/**
 * What an employee's photo may be: images a browser can draw in an `<img>`.
 * Narrower than the scans allowlist — no PDF, and no HEIC or TIFF, which
 * Chrome cannot display, so a portrait stored in either would render as the
 * initials fallback everywhere.
 */
export const EMPLOYEE_PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const employeePhotoUploadInput = createUploadInput.extend({
  contentType: z.enum(EMPLOYEE_PHOTO_CONTENT_TYPES),
});
export type EmployeePhotoUploadInput = z.infer<typeof employeePhotoUploadInput>;

/**
 * The papers an employee's record holds — mirrors `EmployeeDocumentKind` in
 * the Prisma schema; duplicated rather than imported, like every enum in
 * this package. The fixed kinds are one slot each; OTHER accumulates, each
 * under the name it was filed with.
 */
export const EMPLOYEE_DOCUMENT_KINDS = [
  "CONTRACT",
  "ID_CARD",
  "CNSS_CERTIFICATE",
  "FITNESS_CERTIFICATE",
  "CIVP_AGREEMENT",
  "OTHER",
] as const;
export type EmployeeDocumentKind = (typeof EMPLOYEE_DOCUMENT_KINDS)[number];

/**
 * A presigned PUT for a document on one employee's record. The scans
 * allowlist rather than the photo one: a contract is usually a PDF, a CIN a
 * phone shot. The id lets the procedure refuse an unknown record before it
 * hands out a capability.
 */
export const employeeDocumentUploadInput = createUploadInput.extend({
  employeeId: z.string().min(1),
});
export type EmployeeDocumentUploadInput = z.infer<typeof employeeDocumentUploadInput>;

/**
 * Files an uploaded document on the record. `url` is what the upload
 * returned; the server checks it is on this app's bucket before storing it,
 * since a client could send any string. OTHER needs a name to be told apart
 * from the rest; the fixed kinds are named by their kind.
 */
export const addEmployeeDocumentInput = z
  .object({
    employeeId: z.string().min(1),
    kind: z.enum(EMPLOYEE_DOCUMENT_KINDS),
    name: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((value) => value || undefined),
    url: z.string().max(1000),
    contentType: uploadContentTypeSchema,
  })
  .refine((input) => input.kind !== "OTHER" || input.name !== undefined, {
    message: "Name the document",
    path: ["name"],
  });
export type AddEmployeeDocumentInput = z.infer<typeof addEmployeeDocumentInput>;

export const removeEmployeeDocumentInput = z.object({ id: z.string().min(1) });
export type RemoveEmployeeDocumentInput = z.infer<typeof removeEmployeeDocumentInput>;

/**
 * What the browser gets back: where to PUT the bytes, and the URL to store on
 * the row once that succeeds.
 *
 * Two values rather than one because the upload is two steps — PUT to S3, then
 * save `url` through the module's own update mutation, which is where the
 * record's own rank and status checks live. Nothing is written to the row by
 * minting a URL, so an abandoned upload leaves the shipment untouched.
 */
export interface CreateUploadResult {
  uploadUrl: string;
  url: string;
  key: string;
  expiresInSeconds: number;
}
