import { z } from "zod";
import { optionalText } from "./orders.js";
import { createUploadInput, UPLOAD_MAX_BYTES, uploadContentTypeSchema } from "./storage.js";

/**
 * Manufacturing orders (ordres de fabrication, OF) —
 * docs/manufacturing-orders-plan.md.
 *
 * An OF is one order's pipeline: an ordered list of actions, worked strictly
 * one after the other. Everything that decides what may change, and when, is
 * a pure function in this file, used by the server to refuse a call and by
 * the page to disable the button that would make it — one test, two readers.
 *
 * The invariant every rule below leans on: **started actions form a prefix
 * of the pipeline**. A waiting action never sits before a started one,
 * because an action only starts when everything before it is finished, and
 * an action is only ever added or moved below the last started one. That is
 * what makes "the last action that moved" readable off the list itself, with
 * no log of moves.
 */

export const MANUFACTURING_ORDER_STATUSES = ["DRAFT", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
export type ManufacturingOrderStatus = (typeof MANUFACTURING_ORDER_STATUSES)[number];

export const MANUFACTURING_ACTION_STATUSES = ["WAITING", "IN_PROGRESS", "DONE", "SKIPPED"] as const;
export type ManufacturingActionStatus = (typeof MANUFACTURING_ACTION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

/** The only order numbers an OF can be numbered from: the counter's `CMD-<n>`. */
const ORDER_SEQUENCE = /^CMD-(\d+)$/;

/**
 * `CMD-721` in 2026 -> `OF-2026-721`; null for an order numbered any other
 * way, which must be given a `CMD-<n>` number before it can have an OF.
 *
 * The digits are carried as written — the order numbers are not padded, so
 * neither is this — and `year` is the year the OF was opened, stored on it,
 * so renumbering the order later rebuilds the number without moving the year.
 */
export function manufacturingOrderNumero(orderNumero: string, year: number): string | null {
  const match = ORDER_SEQUENCE.exec(orderNumero);
  return match ? `OF-${year}-${match[1]}` : null;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** What the rules need of an action; the pipeline is always passed in order. */
export interface ManufacturingActionState {
  status: ManufacturingActionStatus;
  /** Null on an action skipped while it was still waiting. */
  startedAt?: Date | string | null;
}

/** "Started" means no longer waiting — in progress, done or skipped. */
export function isActionStarted(status: ManufacturingActionStatus): boolean {
  return status !== "WAITING";
}

export function isActionFinished(status: ManufacturingActionStatus): boolean {
  return status === "DONE" || status === "SKIPPED";
}

/**
 * The OF's status from its actions. CANCELLED is not in the result: it is
 * the one status set by hand, and the caller keeps it until a reopen.
 *
 * No actions is a DRAFT, not DONE: "every action is finished" is vacuously
 * true of an empty pipeline, and an OF opened without a template must not
 * read as finished work.
 */
export function manufacturingStatusOf(
  actions: readonly Pick<ManufacturingActionState, "status">[],
): Exclude<ManufacturingOrderStatus, "CANCELLED"> {
  if (actions.every((action) => !isActionStarted(action.status))) return "DRAFT";
  return actions.every((action) => isActionFinished(action.status)) ? "DONE" : "IN_PROGRESS";
}

/** Index of the last started action, or -1 when none has started. */
export function lastStartedIndex(actions: readonly Pick<ManufacturingActionState, "status">[]): number {
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const action = actions[index];
    if (action && isActionStarted(action.status)) return index;
  }
  return -1;
}

/** Index of the action whose turn it is — the first not finished — or -1. */
export function currentActionIndex(actions: readonly Pick<ManufacturingActionState, "status">[]): number {
  return actions.findIndex((action) => !isActionFinished(action.status));
}

/** A waiting action starts only when it is next and nothing is in progress. */
export function canStartAction(
  actions: readonly Pick<ManufacturingActionState, "status">[],
  index: number,
): boolean {
  return actions[index]?.status === "WAITING" && currentActionIndex(actions) === index;
}

export function canCompleteAction(
  actions: readonly Pick<ManufacturingActionState, "status">[],
  index: number,
): boolean {
  return actions[index]?.status === "IN_PROGRESS";
}

/** Skip applies to the action in progress, or to the next waiting one. */
export function canSkipAction(
  actions: readonly Pick<ManufacturingActionState, "status">[],
  index: number,
): boolean {
  return canCompleteAction(actions, index) || canStartAction(actions, index);
}

/**
 * Finishing the action in progress hands the pipeline on: the action right
 * after it starts by itself, so nobody has to "start" each step of a job
 * that is simply moving along. Only when one was in progress — skipping an
 * action that never started hands nothing on, and the first start of an OF
 * (or a restart after such a skip) stays a deliberate click.
 *
 * Returns the index of the action to start, or -1.
 */
export function actionStartedAfter(
  actions: readonly Pick<ManufacturingActionState, "status">[],
  finishedIndex: number,
): number {
  if (actions[finishedIndex]?.status !== "IN_PROGRESS") return -1;
  return actions[finishedIndex + 1]?.status === "WAITING" ? finishedIndex + 1 : -1;
}

/**
 * What "undo" does: the pipeline steps back one action — the inverse of
 * the last move, hand-on included.
 *
 * - An action is in progress: it goes back to waiting, and the one before
 *   it, if finishing that one is what handed the pipeline on (it is done,
 *   or was skipped while in progress), becomes the action in progress again.
 * - Nothing is in progress: the last started action steps back one status —
 *   done to in progress, skipped to wherever it was skipped from.
 *
 * Empty when nothing has started.
 */
export function undoSteps(
  actions: readonly ManufacturingActionState[],
): { index: number; to: ManufacturingActionStatus }[] {
  const current = actions.findIndex((action) => action.status === "IN_PROGRESS");
  if (current !== -1) {
    const steps: { index: number; to: ManufacturingActionStatus }[] = [
      { index: current, to: "WAITING" },
    ];
    const before = actions[current - 1];
    if (before && (before.status === "DONE" || (before.status === "SKIPPED" && before.startedAt))) {
      steps.push({ index: current - 1, to: "IN_PROGRESS" });
    }
    return steps;
  }
  const index = lastStartedIndex(actions);
  const action = actions[index];
  if (!action) return [];
  if (action.status === "DONE") return [{ index, to: "IN_PROGRESS" }];
  return [{ index, to: action.startedAt ? "IN_PROGRESS" : "WAITING" }];
}

/** The lowest position a new or moved action may take: below every started one. */
export function firstOpenPosition(actions: readonly Pick<ManufacturingActionState, "status">[]): number {
  return lastStartedIndex(actions) + 1;
}

/** Name, switches, position and removal: only while the action is waiting. */
export function canEditActionDefinition(status: ManufacturingActionStatus): boolean {
  return status === "WAITING";
}

/** People, machine and files stay editable until the action is done or skipped. */
export function canFillAction(status: ManufacturingActionStatus): boolean {
  return !isActionFinished(status);
}

/** A cancelled OF takes no change but a comment, until it is reopened. */
export function manufacturingOrderIsFrozen(status: ManufacturingOrderStatus): boolean {
  return status === "CANCELLED";
}

/** Cancelling is for work that will not be finished; a done OF has none. */
export function canCancelManufacturingOrder(status: ManufacturingOrderStatus): boolean {
  return status === "DRAFT" || status === "IN_PROGRESS";
}

/** An OF is deleted only while no action has started. */
export function canDeleteManufacturingOrder(
  actions: readonly Pick<ManufacturingActionState, "status">[],
): boolean {
  return lastStartedIndex(actions) === -1;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
//
// The activity trace reads a call's record from the first `id` it finds, so
// an OF is always named `id` and an action always `actionId`: an action's
// row then never passes for an OF's.

/** An in-progress OF nobody has touched for this many days reads as stale on the list. */
export const MANUFACTURING_STALE_DAYS = 5;

export const MANUFACTURING_LABEL_MAX = 200;
export const MANUFACTURING_COMMENT_MAX = 2000;
export const MANUFACTURING_REASON_MAX = 500;
/** Far above the longest pipeline in the old data (20), and a sane ceiling. */
export const MANUFACTURING_ACTIONS_MAX = 60;
export const MANUFACTURING_ASSIGNEES_MAX = 30;

/** What an admin sets on an action: its name and what it offers. */
export const manufacturingActionDefinition = z.object({
  label: z.string().trim().min(1, "Name the action").max(MANUFACTURING_LABEL_MAX),
  handlesEmployees: z.boolean(),
  handlesMachine: z.boolean(),
  handlesAttachments: z.boolean(),
});
export type ManufacturingActionDefinition = z.infer<typeof manufacturingActionDefinition>;

export const manufacturingOrderIdInput = z.object({ id: z.string().min(1) });
export const manufacturingActionIdInput = z.object({ actionId: z.string().min(1) });

/** `templateId` absent opens an empty OF, to be filled action by action. */
export const createManufacturingOrderInput = z.object({
  orderId: z.string().min(1),
  templateId: z.string().min(1).optional(),
});
export type CreateManufacturingOrderInput = z.infer<typeof createManufacturingOrderInput>;

export const cancelManufacturingOrderInput = z.object({
  id: z.string().min(1),
  reason: z.string().trim().min(1, "Say why").max(MANUFACTURING_REASON_MAX),
});
export type CancelManufacturingOrderInput = z.infer<typeof cancelManufacturingOrderInput>;

/** `position` absent adds at the end. 0-based, in the pipeline's order. */
export const addManufacturingActionInput = manufacturingActionDefinition.extend({
  id: z.string().min(1),
  position: z.number().int().min(0).max(MANUFACTURING_ACTIONS_MAX).optional(),
});
export type AddManufacturingActionInput = z.infer<typeof addManufacturingActionInput>;

export const updateManufacturingActionInput = manufacturingActionDefinition.extend({
  actionId: z.string().min(1),
});
export type UpdateManufacturingActionInput = z.infer<typeof updateManufacturingActionInput>;

export const moveManufacturingActionInput = z.object({
  actionId: z.string().min(1),
  position: z.number().int().min(0).max(MANUFACTURING_ACTIONS_MAX),
});
export type MoveManufacturingActionInput = z.infer<typeof moveManufacturingActionInput>;

/** Replaces the action's people wholesale. */
export const setManufacturingActionEmployeesInput = z.object({
  actionId: z.string().min(1),
  employeeIds: z.array(z.string().min(1)).max(MANUFACTURING_ASSIGNEES_MAX),
});
export type SetManufacturingActionEmployeesInput = z.infer<typeof setManufacturingActionEmployeesInput>;

export const setManufacturingActionMachineInput = z.object({
  actionId: z.string().min(1),
  machineId: z.string().min(1).nullable(),
});
export type SetManufacturingActionMachineInput = z.infer<typeof setManufacturingActionMachineInput>;

/** A presigned PUT for a file on one action; refused before minting if the action cannot take one. */
export const manufacturingAttachmentUploadInput = createUploadInput.extend({
  actionId: z.string().min(1),
});
export type ManufacturingAttachmentUploadInput = z.infer<typeof manufacturingAttachmentUploadInput>;

/** Files an uploaded attachment. `url` is what the upload returned; the server checks the bucket. */
export const addManufacturingAttachmentInput = z.object({
  actionId: z.string().min(1),
  url: z.string().max(1000),
  filename: z.string().trim().min(1).max(255),
  contentType: uploadContentTypeSchema,
  size: z.number().int().min(1).max(UPLOAD_MAX_BYTES),
});
export type AddManufacturingAttachmentInput = z.infer<typeof addManufacturingAttachmentInput>;

export const removeManufacturingAttachmentInput = z.object({ attachmentId: z.string().min(1) });

export const addManufacturingCommentInput = z.object({
  actionId: z.string().min(1),
  body: z.string().trim().min(1, "Write something").max(MANUFACTURING_COMMENT_MAX),
});
export type AddManufacturingCommentInput = z.infer<typeof addManufacturingCommentInput>;

/** A template's actions are saved as a whole set, in the order given. */
export const createManufacturingTemplateInput = z.object({
  name: z.string().trim().min(1, "Name the template").max(120),
  description: optionalText(500),
  actions: z.array(manufacturingActionDefinition).min(1, "Add an action").max(MANUFACTURING_ACTIONS_MAX),
});
export type CreateManufacturingTemplateInput = z.infer<typeof createManufacturingTemplateInput>;

export const updateManufacturingTemplateInput = createManufacturingTemplateInput.extend({
  id: z.string().min(1),
});
export type UpdateManufacturingTemplateInput = z.infer<typeof updateManufacturingTemplateInput>;
