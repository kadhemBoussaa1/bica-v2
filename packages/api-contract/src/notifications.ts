import { z } from "zod";
import { PAGE_SIZES } from "./list.js";
import { canAccess, type Role } from "./roles.js";
import { SHIFT_TASK_TYPES, SHIFT_TYPES } from "./shifts.js";

/**
 * In-app notifications — docs/notifications-plan.md §3.
 *
 * A notification is a row per recipient, written with the change it
 * reports; the SSE stream only says one exists. What is shared here is what
 * both sides must agree on: the kinds, which role may read which, which
 * kinds pop a toast, and the shape of each kind's frozen `params`.
 */

export const NOTIFICATION_KINDS = [
  "ORDER_CREATED",
  "QUOTE_CREATED",
  "ORDER_IN_PRODUCTION",
  "SHIFT_WEEK_PUBLISHED",
  "TASK_ASSIGNED",
  "TASK_REASSIGNED_AWAY",
  "TASK_REOPENED",
  "TASK_DONE",
] as const;
export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * The kinds only ADMIN and above may read: the commercial ones and the
 * admins' ticket feed. A LEAK SET, not "what a role usually receives"
 * (plan decision 13): an ADMIN can hold an employee row and be assigned a
 * ticket, and must still see that TASK_ASSIGNED; a demoted admin must stop
 * seeing the orders they were told about.
 */
export const ADMIN_ONLY_NOTIFICATION_KINDS: readonly NotificationKind[] = [
  "ORDER_CREATED",
  "QUOTE_CREATED",
  "TASK_DONE",
];

/**
 * What `role` may read, checked on every list, count and mark-read — at
 * read time, not at delivery, because a role can change after a row was
 * written. Same rank function as every other gate.
 */
export function visibleNotificationKinds(role: Role): NotificationKind[] {
  if (canAccess(role, "ADMIN")) return [...NOTIFICATION_KINDS];
  return NOTIFICATION_KINDS.filter((kind) => !ADMIN_ONLY_NOTIFICATION_KINDS.includes(kind));
}

/**
 * The personal kinds, which pop a toast as well as landing in the bell
 * (plan fact 8). A new order or quote and a finished ticket are bell-only:
 * they are the admins' ambient feed, not something addressed to one person.
 */
export const TOAST_NOTIFICATION_KINDS: readonly NotificationKind[] = [
  "ORDER_IN_PRODUCTION",
  "SHIFT_WEEK_PUBLISHED",
  "TASK_ASSIGNED",
  "TASK_REASSIGNED_AWAY",
  "TASK_REOPENED",
];

export function isToastNotification(kind: NotificationKind): boolean {
  return TOAST_NOTIFICATION_KINDS.includes(kind);
}

/** The badge shows at most this, then "99+" (plan decision 17). */
export const NOTIFICATION_BADGE_MAX = 99;

/** The SSE route, on the API origin; nginx gives it its own location. */
export const NOTIFICATION_STREAM_PATH = "/events";

// ---- params, one schema per kind -------------------------------------------

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/** A new order or quote. `clientName` is null: an order may have no client. */
const orderCreatedParams = z.object({
  numero: z.string(),
  clientName: z.string().nullable(),
});

/**
 * An order released to production. The number only: production accounts
 * receive this, and nothing commercial — not even the client — goes to them
 * through a notification that their order scope would not show them anyway.
 */
const orderReleasedParams = z.object({ numero: z.string() });

const weekPublishedParams = z.object({ weekStart: isoDay });

/**
 * A ticket, as the row names it: what, when, where. `employeeName` is the
 * ticket's person at emit time — the admins' TASK_DONE row says whose
 * ticket it was; the personal kinds do not need it and do not render it.
 */
const taskParams = z.object({
  type: z.enum(SHIFT_TASK_TYPES),
  shiftDate: isoDay,
  shiftType: z.enum(SHIFT_TYPES),
  machineName: z.string().nullable(),
  orderNumero: z.string().nullable(),
  employeeName: z.string(),
});
export type TaskNotificationParams = z.infer<typeof taskParams>;

/**
 * A kind with its params, discriminated on `kind`. The API validates with it
 * on write (`NotificationService.emit`) and on read (`list`), so the client
 * receives a typed union and never guesses a shape.
 */
export const notificationPayload = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ORDER_CREATED"), params: orderCreatedParams }),
  z.object({ kind: z.literal("QUOTE_CREATED"), params: orderCreatedParams }),
  z.object({ kind: z.literal("ORDER_IN_PRODUCTION"), params: orderReleasedParams }),
  z.object({ kind: z.literal("SHIFT_WEEK_PUBLISHED"), params: weekPublishedParams }),
  z.object({ kind: z.literal("TASK_ASSIGNED"), params: taskParams }),
  z.object({ kind: z.literal("TASK_REASSIGNED_AWAY"), params: taskParams }),
  z.object({ kind: z.literal("TASK_REOPENED"), params: taskParams }),
  z.object({ kind: z.literal("TASK_DONE"), params: taskParams }),
]);
export type NotificationPayload = z.infer<typeof notificationPayload>;

// ---- inputs ----------------------------------------------------------------

/**
 * One page of the bell, newest first. Cursor pagination on the last row's
 * id — not `listQueryBase`: there is no sort, search or facet, and offset
 * paging on a list that grows at the top would repeat rows. `cursor` is
 * nullish because the infinite query starts from null.
 */
export const listNotificationsInput = z.object({
  cursor: z.string().min(1).nullish(),
  take: z.literal(PAGE_SIZES).default(25),
  unreadOnly: z.boolean().default(false),
});
export type ListNotificationsInput = z.infer<typeof listNotificationsInput>;

/** Some rows by id, or every unread row the caller may read. */
export const markNotificationsReadInput = z.union([
  z.object({ ids: z.array(z.string().min(1)).min(1).max(100) }),
  z.object({ all: z.literal(true) }),
]);
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadInput>;

// ---- the stream -------------------------------------------------------------

/**
 * The only thing that crosses the SSE stream per notification: enough to
 * decide on a toast and to invalidate the bell. The row itself is read
 * through tRPC, so the stream never carries anything a tRPC read would not.
 */
export const notificationEvent = z.object({
  id: z.string(),
  kind: notificationKindSchema,
  toast: z.boolean(),
});
export type NotificationEvent = z.infer<typeof notificationEvent>;
