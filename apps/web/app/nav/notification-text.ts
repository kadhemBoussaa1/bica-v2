import type { inferRouterOutputs } from "@trpc/server";
// Type-only import: erased at compile time, so no server code reaches the bundle.
import type { AppRouter } from "api/src/trpc/trpc.router";
import { canAccess, weekStartOf, type Role } from "@repo/api-contract";
import { formatShiftDate, formatWeekRange, formatWeekday } from "../shifts/week";

/**
 * One bell row as the API sends it: common fields plus `kind` and its
 * typed `params`, a union discriminated on `kind`. Derived from the router,
 * never hand-written, so a change to the contract's params reaches here.
 */
export type NotificationItem =
  inferRouterOutputs<AppRouter>["notification"]["list"]["items"][number];

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * First-strong isolate around a name or a number, so "CMD-658" or a Latin
 * client name keeps its own order inside an Arabic sentence. Characters
 * (U+2068 FIRST STRONG ISOLATE … U+2069 POP DIRECTIONAL ISOLATE) rather
 * than `<bdi>` because the same strings fill toasts, which take plain text;
 * written as escapes so an editor can see them.
 */
function iso(text: string): string {
  return `\u2068${text}\u2069`;
}

/**
 * What a row says, in the reader's language, from the frozen params: a
 * title and an optional detail line. The toast uses the same two strings,
 * so the popup and the bell never word one event differently.
 */
export function describeNotification(
  item: NotificationItem,
  t: Translate,
  enums: Translate,
): { title: string; detail: string | null } {
  const shiftLine = (p: { shiftType: string; shiftDate: string }) =>
    t("shiftOn", {
      shift: enums(`shiftType.${p.shiftType}`),
      day: formatWeekday(p.shiftDate),
      date: formatShiftDate(p.shiftDate),
    });
  const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(" · ");

  switch (item.kind) {
    case "ORDER_CREATED":
    case "QUOTE_CREATED":
      return {
        title: t(`kinds.${item.kind}`, { numero: iso(item.params.numero) }),
        detail: item.params.clientName ? iso(item.params.clientName) : t("noClient"),
      };
    case "ORDER_IN_PRODUCTION":
      return {
        title: t(`kinds.${item.kind}`, { numero: iso(item.params.numero) }),
        detail: null,
      };
    case "SHIFT_WEEK_PUBLISHED":
      return {
        title: t(`kinds.${item.kind}`),
        detail: formatWeekRange(item.params.weekStart),
      };
    case "TASK_DONE":
      return {
        title: t(`kinds.${item.kind}`, { type: enums(`shiftTaskType.${item.params.type}`) }),
        detail: join(
          iso(item.params.employeeName),
          shiftLine(item.params),
          item.params.machineName && iso(item.params.machineName),
        ),
      };
    default:
      // The three personal ticket kinds: the reader is the ticket's person.
      return {
        title: t(`kinds.${item.kind}`, { type: enums(`shiftTaskType.${item.params.type}`) }),
        detail: join(
          shiftLine(item.params),
          item.params.machineName && iso(item.params.machineName),
          item.params.orderNumero && iso(item.params.orderNumero),
        ),
      };
  }
}

/**
 * Where a row opens. Orders go to their page (a 404 there, if the order was
 * deleted since, is that page's own not-found). A week or a ticket opens on
 * its week: the planner for ADMIN and above when the row is about the
 * planning, "My shifts" for the ticket's own person and for every worker.
 */
export function notificationHref(item: NotificationItem, role: Role): string {
  switch (item.kind) {
    case "ORDER_CREATED":
    case "QUOTE_CREATED":
    case "ORDER_IN_PRODUCTION":
      return `/orders/${encodeURIComponent(item.entityId)}`;
    case "SHIFT_WEEK_PUBLISHED":
      return canAccess(role, "ADMIN")
        ? `/shifts?week=${item.params.weekStart}`
        : `/shifts/me?week=${item.params.weekStart}`;
    case "TASK_DONE":
      return `/shifts?week=${weekStartOf(item.params.shiftDate)}`;
    default:
      return `/shifts/me?week=${weekStartOf(item.params.shiftDate)}`;
  }
}
