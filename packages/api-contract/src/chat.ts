import { z } from "zod";
import { optionalText } from "./orders.js";
import { UPLOAD_CONTENT_TYPES, UPLOAD_MAX_BYTES } from "./storage.js";

/**
 * The shared plant-wide notice stream — docs/chat-plan.md §2.
 *
 * One global room, append-only: there is no edit input and no delete input
 * here because there are no such procedures. A correction is a new notice
 * posted under the old one.
 */

/** A notice's body cap. Long enough for a shift handover, short of an essay. */
export const CHAT_BODY_MAX = 4000;

/** Attachments per notice. Six is two rows of thumbnails on a tablet. */
export const CHAT_ATTACHMENTS_MAX = 6;

/** One page of older history. */
export const CHAT_PAGE_SIZE = 30;

/**
 * The most the poll will hand back in one call.
 *
 * A cap, not a page size: `since` has no "load more" affordance, so an
 * overflowing burst is truncated at the OLDEST end and the client's next poll
 * picks up from there. Taking the newest instead would leave a permanent hole
 * in the middle of the feed.
 */
export const CHAT_SINCE_MAX = 100;

/**
 * What a chat attachment may be: the scan types, plus the office documents a
 * notice actually carries.
 *
 * Separate from `UPLOAD_CONTENT_TYPES` rather than a widening of it — that one
 * is scoped in writing to two scan fields (a packing list and a customs
 * declaration), and adding a spreadsheet there would silently change what
 * those accept. Same exclusions for the same reason, though: the bucket is
 * world-readable behind unguessable names, so `text/html` would be a
 * same-origin-looking page hosted on an amazonaws.com domain and
 * `image/svg+xml` is script-bearing. Neither belongs in a notice.
 */
export const CHAT_CONTENT_TYPES = [
  ...UPLOAD_CONTENT_TYPES,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "application/zip",
] as const;
export const chatContentTypeSchema = z.enum(CHAT_CONTENT_TYPES);
export type ChatContentType = (typeof CHAT_CONTENT_TYPES)[number];

/**
 * The feed's cursor, and the whole point of the module.
 *
 * Composite because `createdAt` alone is not unique: two notices posted in the
 * same millisecond are ordinary, and a cursor that names only the timestamp
 * either repeats the boundary row or skips its twin. `z.coerce.date()` because
 * the client round-trips it through JSON as a string — there is no superjson
 * transformer on this app's tRPC link.
 */
export const chatCursor = z.object({
  createdAt: z.coerce.date(),
  id: z.string().min(1),
});
export type ChatCursor = z.infer<typeof chatCursor>;

/**
 * One page of history, older than `cursor`. No cursor means the newest page.
 *
 * Deliberately NOT `listQueryBase`: that carries `page`, `pageSize` from the
 * closed `PAGE_SIZES` set, `search`, `sortBy`, `sortDir` and `filter`, all of
 * which are built for an offset-paginated table and none of which a feed
 * wants. Offset paging on an append-heavy stream shifts rows between requests.
 */
export const chatFeedInput = z.object({
  cursor: chatCursor.optional(),
});
export type ChatFeedInput = z.infer<typeof chatFeedInput>;

/**
 * The poll: everything newer than `after`.
 *
 * `after` is optional, and a call without it is a cold read of the newest page
 * rather than an error or an empty array — see `ChatService.since`. An empty
 * room would otherwise leave the client with no cursor to poll from and no way
 * to learn about the first notice anyone posts.
 */
export const chatSinceInput = z.object({
  after: chatCursor.optional(),
});
export type ChatSinceInput = z.infer<typeof chatSinceInput>;

/**
 * One already-uploaded file, as the composer reports it.
 *
 * `url` is client-supplied and therefore checked server-side against this
 * app's own bucket prefix (`StorageService.isOwnAssetUrl`) before it is
 * stored — the feed renders it to every user in the plant. `size` and
 * `filename` are recorded for the label and are not re-verified against S3:
 * the object may still be uploading when `post` arrives.
 */
export const chatAttachmentInput = z.object({
  url: z.string().url().max(2048),
  contentType: chatContentTypeSchema,
  filename: z.string().trim().min(1).max(255),
  size: z.number().int().nonnegative().max(UPLOAD_MAX_BYTES),
});
export type ChatAttachmentInput = z.infer<typeof chatAttachmentInput>;

/**
 * A new notice. Either words or files, and the `.refine` is what forbids
 * neither — `body` is optional only so a photo can post without a caption.
 */
export const postChatMessageInput = z
  .object({
    body: optionalText(CHAT_BODY_MAX),
    attachments: z.array(chatAttachmentInput).max(CHAT_ATTACHMENTS_MAX).default([]),
  })
  .refine((input) => input.body !== undefined || input.attachments.length > 0, {
    message: "Write something or attach a file",
    path: ["body"],
  });
export type PostChatMessageInput = z.infer<typeof postChatMessageInput>;

/** Pin or unpin one notice. Idempotent in both directions. */
export const setChatPinnedInput = z.object({
  id: z.string().min(1),
  pinned: z.boolean(),
});
export type SetChatPinnedInput = z.infer<typeof setChatPinnedInput>;

/**
 * "I have read up to here": the `createdAt` of the newest notice on
 * screen. The server keeps the stamp monotonic, so a late poll cannot
 * rewind it and resurrect notices already seen, and clamps it to its own
 * clock, so a future date cannot hold the badge at zero. The stamp lives in
 * `ChatRead`, one row per account (see `ChatService.unreadCount`).
 */
export const markChatReadInput = z.object({
  at: z.coerce.date(),
});
export type MarkChatReadInput = z.infer<typeof markChatReadInput>;

/**
 * A presigned PUT for a chat attachment.
 *
 * Cannot reuse `createUploadInput`: that one's `contentType` is the narrow
 * scans allowlist, and a notice may carry a spreadsheet. Same shape otherwise,
 * and the server still builds the key and signs the type into the URL.
 */
export const chatUploadInput = z.object({
  filename: z.string().trim().min(1, "File name is required").max(255),
  contentType: chatContentTypeSchema,
  size: z
    .number()
    .int()
    .positive()
    .max(UPLOAD_MAX_BYTES, "File is larger than 25 MB"),
});
export type ChatUploadInput = z.infer<typeof chatUploadInput>;
