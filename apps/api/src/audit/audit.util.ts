import type { Prisma } from "../generated/prisma/client.js";

/*
 * Pure helpers for the activity trace (docs/audit-log-plan.md Step 2). No
 * Prisma calls, no request context: everything here takes plain values so
 * the middleware and the Better Auth hooks stay a page each.
 */

/** Keys whose values are never stored, whatever their type. */
const SECRET_KEY = /password|token|secret/i;

/** Deeper than any tRPC input in this app; guards against cyclic objects. */
const MAX_DEPTH = 8;

/** Above this the input is stored as a preview, not verbatim. */
const INPUT_CAP_BYTES = 16 * 1024;

export const ERROR_MESSAGE_MAX = 500;
export const USER_AGENT_MAX = 300;

/**
 * Deep copy with secret-looking keys replaced by "[redacted]". Arrays are
 * preserved; bigints become strings (JSON cannot carry them); Dates become
 * ISO strings; anything below `MAX_DEPTH` is summarised.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[depth]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY.test(key) ? "[redacted]" : redact(item, depth + 1);
  }
  return out;
}

/**
 * The value the `input` column stores. `undefined` stays undefined (a query
 * with no input); anything else is serialised, and above the cap only a
 * preview survives so one oversized payload cannot bloat the table.
 *
 * Returns a JSON-safe value: `redact` has already removed bigints and Dates,
 * and the round-trip through `JSON.stringify` drops functions and symbols.
 */
export function capInput(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  const text = JSON.stringify(value);
  // `JSON.stringify(undefined)` is undefined; a lone function or symbol too.
  if (text === undefined) return undefined;
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= INPUT_CAP_BYTES) return JSON.parse(text) as Prisma.InputJsonValue;
  return { truncated: true, bytes, preview: text.slice(0, INPUT_CAP_BYTES) };
}

interface AuditEntity {
  entityId: string | null;
  entityLabel: string | null;
  /** The parent the call was raised from, when it is not `entityId` itself. */
  relatedId: string | null;
}

const NO_ENTITY: AuditEntity = { entityId: null, entityLabel: null, relatedId: null };

const ID_KEYS = ["id", "orderId", "shipmentId", "invoiceId"] as const;
const LABEL_KEYS = ["numero", "email", "name"] as const;
// `rollId`: the reel a cut, slit or reservation was raised from. On a
// reservation the order wins (it comes first), so the reel's timeline shows
// its cuts and slits but not what was reserved off it — one slot, one parent.
//
// `countId`: the stocktake a scan belongs to. Last, so it never displaces an
// order or shipment on a call that carries both. A stocktake scan returns the
// REEL as its entity, so the two always differ and the session link lands —
// see docs/inventory-plan.md Step 4a.
//
// Chat deliberately adds nothing here. docs/chat-plan.md §4 called for a
// `messageId` entry, but `setChatPinnedInput` names the notice `id`, which
// `ID_KEYS` already resolves as the row's own `entityId` — and `relatedId` is
// only set when the parent DIFFERS from it. A `messageId` key would therefore
// never match anything. Verified against the audit rows a pin actually writes.
//
// `shiftId`, `weekId`: the shift a ticket or an assignment belongs to, and
// the week a change belongs to (docs/shift-planning-plan.md §4.2). Last, so
// they never displace an order on a call that carries both.
const PARENT_KEYS = [
  "orderId",
  "shipmentId",
  "invoiceId",
  "rollId",
  "countId",
  "shiftId",
  "weekId",
] as const;

/**
 * Parent keys read from the RESULT when the input names none. `orderId` is
 * the historical case (a run's row carries its order). The shift module's
 * `updateTask`, `removeTask`, `setTaskDone` and `withdraw` take only `{ id }`
 * and return `{ id, shiftId }` / `{ id, weekId }` precisely so this finds the
 * parent; no other module's result carries either key.
 */
const RESULT_PARENT_KEYS = ["orderId", "shiftId", "weekId"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(
  source: Record<string, unknown> | null,
  keys: readonly string[],
): string | null {
  if (!source) return null;
  for (const key of keys) {
    const candidate = source[key];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

/** Walks a dotted path ("order.id") through plain objects; null on any miss. */
function pick(source: unknown, path: string): string | null {
  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (!isPlainObject(current)) return null;
    current = current[segment];
  }
  return typeof current === "string" && current.length > 0 ? current : null;
}

/**
 * Which record a call is about, guessed from the result first (the created or
 * updated row) and the raw input second. Only string candidates on plain
 * objects count, so a list's `{ rows }` yields nothing and a primitive result
 * is ignored. `hint` is a dotted path from `meta.audit.entity` for the rare
 * procedure the heuristic gets wrong.
 *
 * `relatedId` is the first parent id in the input (or `orderId` on the
 * result) that differs from the chosen entity: one id cannot say "run X was
 * created from order Y", and the order detail's Activity link needs the Y.
 */
export function extractEntity(result: unknown, input: unknown, hint?: string): AuditEntity {
  const res = isPlainObject(result) ? result : null;
  const inp = isPlainObject(input) ? input : null;
  if (!res && !inp) return NO_ENTITY;

  const hinted = hint ? (pick(result, hint) ?? pick(input, hint)) : null;
  const entityId = hinted ?? firstString(res, ID_KEYS) ?? firstString(inp, ID_KEYS);
  const entityLabel = firstString(res, LABEL_KEYS) ?? firstString(inp, LABEL_KEYS);

  const parent = firstString(inp, PARENT_KEYS) ?? firstString(res, RESULT_PARENT_KEYS);
  const relatedId = parent && parent !== entityId ? parent : null;

  return { entityId, entityLabel, relatedId };
}

/** "shipment.ship" -> "shipment"; "health" -> "health". */
export function firstSegment(path: string): string {
  const dot = path.indexOf(".");
  return dot === -1 ? path : path.slice(0, dot);
}

/** Truncates to `max` characters; null for a missing or empty value. */
export function clip(text: unknown, max: number): string | null {
  if (typeof text !== "string" || text.length === 0) return null;
  return text.length > max ? text.slice(0, max) : text;
}
