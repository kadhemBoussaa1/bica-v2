import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import {
  actionStartedAfter,
  canCancelManufacturingOrder,
  canCompleteAction,
  canDeleteManufacturingOrder,
  canEditActionDefinition,
  canFillAction,
  canSkipAction,
  canStartAction,
  currentActionIndex,
  firstOpenPosition,
  isActionFinished,
  MANUFACTURING_ACTIONS_MAX,
  MANUFACTURING_STALE_DAYS,
  manufacturingOrderIsFrozen,
  manufacturingOrderNumero,
  manufacturingStatusOf,
  undoSteps,
  type AddManufacturingActionInput,
  type AddManufacturingAttachmentInput,
  type AddManufacturingCommentInput,
  type CancelManufacturingOrderInput,
  type CreateManufacturingOrderInput,
  type MoveManufacturingActionInput,
  type SetManufacturingActionEmployeesInput,
  type SetManufacturingActionMachineInput,
  type UpdateManufacturingActionInput,
} from "@repo/api-contract";
import { Prisma } from "../generated/prisma/client.js";
import { runListQuery } from "../list/list-query";
import { PrismaService } from "../prisma.service";
import { MailService } from "../mail/mail.service";
import { actionAssignedMail, type MailMessage } from "../mail/templates";
import { StorageService } from "../storage/storage.service";
import type { SessionUser } from "../trpc/trpc";
import {
  MANUFACTURING_ORDER_DETAIL_SELECT,
  MANUFACTURING_ORDER_LIST_SELECT,
  manufacturingOrderListDeclaration,
  type ListManufacturingOrdersInput,
} from "./manufacturing.list";

type Tx = Prisma.TransactionClient;

/** What a write needs of the OF it is about to change, read under its lock. */
const LOCKED_SELECT = {
  id: true,
  numero: true,
  orderId: true,
  status: true,
  adapted: true,
  actions: {
    select: {
      id: true,
      position: true,
      label: true,
      status: true,
      startedAt: true,
      handlesEmployees: true,
      handlesMachine: true,
      handlesAttachments: true,
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.ManufacturingOrderSelect;

type Locked = Prisma.ManufacturingOrderGetPayload<{ select: typeof LOCKED_SELECT }>;
type LockedAction = Locked["actions"][number];

/**
 * What every write returns: the OF, never the action. The activity trace
 * names a call's record by the first `id` in its result, and an action has
 * no page — its row must open the OF. `orderId` gives the trace the order as
 * the related record, so an order's own activity shows the work on its OF.
 */
export interface ManufacturingOrderRef {
  id: string;
  numero: string;
  orderId: string;
}

const refOf = (of: Locked): ManufacturingOrderRef => ({
  id: of.id,
  numero: of.numero,
  orderId: of.orderId,
});

const refuse = (message: string) => new TRPCError({ code: "PRECONDITION_FAILED", message });

const DAY_MS = 24 * 60 * 60 * 1000;

function isUniqueViolation(cause: unknown): boolean {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002";
}

/**
 * Manufacturing orders (OF) — docs/manufacturing-orders-plan.md.
 *
 * Every rule that says what may change lives in the contract
 * (`manufacturing.ts`) and is re-checked here under a lock on the OF row, so
 * two admins working one OF serialise: the second reads what the first left
 * and is refused if its move no longer applies. The OF's status is never
 * taken from a caller — it is recomputed from the actions after every write.
 */
@Injectable()
export class ManufacturingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mail: MailService,
  ) {}

  async list(query: ListManufacturingOrdersInput) {
    const result = await runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) =>
          this.prisma.manufacturingOrder.findMany({
            ...args,
            select: MANUFACTURING_ORDER_LIST_SELECT,
          }),
        count: (args) => this.prisma.manufacturingOrder.count(args),
      },
      query,
      declaration: manufacturingOrderListDeclaration,
      // ADMIN and above see every OF; the procedure gate is the whole scope.
      scope: {},
    });

    const now = Date.now();
    return {
      ...result,
      rows: result.rows.map(({ actions, lastActivityAt, ...row }) => {
        const current = actions[currentActionIndex(actions)];
        const last = actions[actions.length - 1];
        const idleDays = Math.floor((now - lastActivityAt.getTime()) / DAY_MS);
        return {
          ...row,
          // One segment per action, in order: the row's progress strip.
          segments: actions.map((action) => ({ label: action.label, status: action.status })),
          finishedCount: actions.filter((action) => isActionFinished(action.status)).length,
          // The action whose turn it is, with the first person on it.
          currentAction: current
            ? {
                label: current.label,
                status: current.status,
                startedAt: current.startedAt,
                assignee: current.assignees[0]?.employee ?? null,
              }
            : null,
          /** When the last action closed — what a done OF shows instead. */
          finishedAt: row.status === "DONE" ? (last?.completedAt ?? null) : null,
          /** Days without any activity, on an in-progress OF past the threshold; null otherwise. */
          staleDays:
            row.status === "IN_PROGRESS" && idleDays >= MANUFACTURING_STALE_DAYS ? idleDays : null,
        };
      }),
    };
  }

  /**
   * The list header's figures: OFs per status, the actions being worked
   * right now, the in-progress OFs gone quiet, and the templates on offer.
   * Counted over every OF, not the page — the tiles describe the shop, the
   * chips and the search narrow the list under them.
   */
  async summary() {
    const quiet = {
      status: "IN_PROGRESS" as const,
      lastActivityAt: { lt: new Date(Date.now() - MANUFACTURING_STALE_DAYS * DAY_MS) },
    };
    const [byStatus, actionsInProgress, staleCount, staleSample, templates] =
      await this.prisma.$transaction([
        this.prisma.manufacturingOrder.groupBy({
          by: ["status"],
          _count: { _all: true },
          orderBy: { status: "asc" },
        }),
        this.prisma.manufacturingAction.count({
          where: { status: "IN_PROGRESS", manufacturingOrder: { status: "IN_PROGRESS" } },
        }),
        this.prisma.manufacturingOrder.count({ where: quiet }),
        // The two quietest, named on the tile; the count says how many more.
        this.prisma.manufacturingOrder.findMany({
          where: quiet,
          orderBy: [{ lastActivityAt: "asc" }, { id: "asc" }],
          take: 2,
          select: {
            id: true,
            numero: true,
            order: { select: { client: { select: { name: true } } } },
          },
        }),
        this.prisma.manufacturingTemplate.count({ where: { active: true } }),
      ]);

    const count = (status: (typeof byStatus)[number]["status"]) => {
      const group = byStatus.find((entry) => entry.status === status)?._count;
      return typeof group === "object" ? (group._all ?? 0) : 0;
    };
    return {
      total: byStatus.reduce((sum, entry) => sum + count(entry.status), 0),
      inProgress: count("IN_PROGRESS"),
      done: count("DONE"),
      actionsInProgress,
      stale: {
        days: MANUFACTURING_STALE_DAYS,
        count: staleCount,
        sample: staleSample.map((of) => ({
          id: of.id,
          numero: of.numero,
          client: of.order.client?.name ?? null,
        })),
      },
      templates,
    };
  }

  async byId(id: string) {
    const found = await this.prisma.manufacturingOrder.findUnique({
      where: { id },
      select: MANUFACTURING_ORDER_DETAIL_SELECT,
    });
    if (!found) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Manufacturing order not found" });
    }
    return found;
  }

  /**
   * Opens the order's OF, copying the template's actions when one is picked.
   *
   * The order row is locked first — the same lock `OrderService.update`
   * takes before renumbering — so the OF number is built from a number that
   * cannot change under it. The quote test is `kind`, never the number's
   * shape: a quote holds a `CMD-<n>` number like any order. Two creates
   * racing on one order serialise on that lock; the unique on `orderId` is
   * the backstop.
   */
  async create(actor: SessionUser, input: CreateManufacturingOrderInput) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE`;
        const order = await tx.order.findUnique({
          where: { id: input.orderId },
          select: {
            id: true,
            numero: true,
            kind: true,
            manufacturingOrder: { select: { numero: true } },
          },
        });
        if (!order) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        }
        if (order.kind !== "ORDER") {
          throw refuse(`${order.numero} is a quote — accept it before opening its manufacturing order`);
        }
        if (order.manufacturingOrder) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Order ${order.numero} already has ${order.manufacturingOrder.numero}`,
          });
        }
        const year = new Date().getUTCFullYear();
        const numero = manufacturingOrderNumero(order.numero, year);
        if (numero === null) {
          throw refuse(`Order ${order.numero} is not numbered CMD-<n> — give it such a number first`);
        }

        const template =
          input.templateId === undefined
            ? null
            : await tx.manufacturingTemplate.findFirst({
                where: { id: input.templateId, active: true },
                select: {
                  id: true,
                  actions: {
                    select: {
                      label: true,
                      handlesEmployees: true,
                      handlesMachine: true,
                      handlesAttachments: true,
                    },
                    orderBy: [{ position: "asc" }, { id: "asc" }],
                  },
                },
              });
        if (input.templateId !== undefined && template === null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That template no longer exists" });
        }

        return tx.manufacturingOrder.create({
          data: {
            numero,
            year,
            orderId: order.id,
            // Only to say so on screen: the actions below are a copy.
            templateId: template?.id ?? null,
            createdById: actor.id,
            createdByName: actor.name,
            actions: {
              // A copy, not a link: editing the template later changes nothing here.
              create: (template?.actions ?? []).map((action, position) => ({ ...action, position })),
            },
          },
          select: { id: true, numero: true, orderId: true },
        });
      });
    } catch (cause) {
      if (isUniqueViolation(cause)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This order already has a manufacturing order",
        });
      }
      throw cause;
    }
  }

  /** Manual, with a reason. Freezes the OF: only comments still land on it. */
  async cancel(actor: SessionUser, input: CancelManufacturingOrderInput) {
    return this.prisma.$transaction(async (tx) => {
      const of = await this.lock(tx, input.id);
      if (!canCancelManufacturingOrder(of.status)) {
        throw refuse(
          of.status === "DONE"
            ? `${of.numero} is done and cannot be cancelled`
            : `${of.numero} is already cancelled`,
        );
      }
      await tx.manufacturingOrder.update({
        where: { id: of.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelReason: input.reason,
          cancelledById: actor.id,
          lastActivityAt: new Date(),
        },
      });
      return refOf(of);
    });
  }

  /** Back to whatever its actions say it is. */
  async reopen(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const of = await this.lock(tx, id);
      if (of.status !== "CANCELLED") {
        throw refuse(`${of.numero} is not cancelled`);
      }
      await tx.manufacturingOrder.update({
        where: { id: of.id },
        data: {
          status: manufacturingStatusOf(of.actions),
          cancelledAt: null,
          cancelReason: null,
          cancelledById: null,
          lastActivityAt: new Date(),
        },
      });
      return refOf(of);
    });
  }

  /** A hard delete, allowed only while no action has started; cancel otherwise. */
  async remove(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const of = await this.lock(tx, id);
      if (!canDeleteManufacturingOrder(of.actions)) {
        throw refuse(`${of.numero} has started — cancel it instead of deleting it`);
      }
      await tx.manufacturingOrder.delete({ where: { id: of.id } });
      return refOf(of);
    });
  }

  // ---- the pipeline's shape ------------------------------------------------

  /**
   * Adds an action at `position`, or at the end. Only below the last started
   * action: a waiting action above a started one would break the sequence
   * every other rule reads.
   */
  async addAction(input: AddManufacturingActionInput) {
    return this.change(input.id, async (tx, of) => {
      if (of.actions.length >= MANUFACTURING_ACTIONS_MAX) {
        throw refuse(`An OF holds at most ${MANUFACTURING_ACTIONS_MAX} actions`);
      }
      const position = input.position ?? of.actions.length;
      if (position < firstOpenPosition(of.actions) || position > of.actions.length) {
        throw refuse("An action can only be added after the last started one");
      }
      const created = await tx.manufacturingAction.create({
        data: {
          manufacturingOrderId: of.id,
          position,
          label: input.label,
          handlesEmployees: input.handlesEmployees,
          handlesMachine: input.handlesMachine,
          handlesAttachments: input.handlesAttachments,
        },
        select: { id: true },
      });
      const ids = of.actions.map((action) => action.id);
      ids.splice(position, 0, created.id);
      await this.renumber(tx, ids);
      await this.markAdapted(tx, of);
    });
  }

  /**
   * Renames an action or flips its switches, while it is still waiting.
   *
   * A switch turned off drops what the action held for it — its people, its
   * machine — since a field the action no longer offers must not keep
   * hidden values. Files are the exception: they are refused rather than
   * dropped, because a file is not re-picked from a list.
   */
  async updateAction(input: UpdateManufacturingActionInput) {
    return this.withAction(input.actionId, async (tx, of, action) => {
      if (!canEditActionDefinition(action.status)) {
        throw refuse("A started action can no longer be changed");
      }
      if (action.handlesAttachments && !input.handlesAttachments) {
        const files = await tx.manufacturingActionAttachment.count({
          where: { actionId: action.id },
        });
        if (files > 0) throw refuse("Remove the action's files before turning attachments off");
      }
      if (action.handlesEmployees && !input.handlesEmployees) {
        await tx.manufacturingActionAssignee.deleteMany({ where: { actionId: action.id } });
      }
      await tx.manufacturingAction.update({
        where: { id: action.id },
        data: {
          label: input.label,
          handlesEmployees: input.handlesEmployees,
          handlesMachine: input.handlesMachine,
          handlesAttachments: input.handlesAttachments,
          ...(input.handlesMachine ? {} : { machineId: null }),
        },
      });
      await this.markAdapted(tx, of);
    });
  }

  async removeAction(actionId: string) {
    return this.withAction(actionId, async (tx, of, action) => {
      if (!canEditActionDefinition(action.status)) {
        throw refuse("A started action cannot be removed");
      }
      await tx.manufacturingAction.delete({ where: { id: action.id } });
      await this.renumber(
        tx,
        of.actions.filter((other) => other.id !== action.id).map((other) => other.id),
      );
      await this.markAdapted(tx, of);
    });
  }

  /** Moves a waiting action to `position`, which must stay below the last started one. */
  async moveAction(input: MoveManufacturingActionInput) {
    return this.withAction(input.actionId, async (tx, of, action, index) => {
      if (!canEditActionDefinition(action.status)) {
        throw refuse("A started action cannot be moved");
      }
      if (input.position < firstOpenPosition(of.actions) || input.position >= of.actions.length) {
        throw refuse("An action can only be moved after the last started one");
      }
      const ids = of.actions.map((other) => other.id);
      ids.splice(index, 1);
      ids.splice(input.position, 0, action.id);
      await this.renumber(tx, ids);
      await this.markAdapted(tx, of);
    });
  }

  // ---- working the pipeline --------------------------------------------------

  async start(actionId: string) {
    return this.withAction(actionId, async (tx, of, action, index) => {
      if (!canStartAction(of.actions, index)) {
        throw refuse(
          action.status === "WAITING"
            ? "An earlier action is not finished yet"
            : "This action has already started",
        );
      }
      await tx.manufacturingAction.update({
        where: { id: action.id },
        data: { status: "IN_PROGRESS", startedAt: new Date(), completedAt: null },
      });
    });
  }

  /** Marks the action in progress done; the next one starts by itself. */
  async complete(actionId: string) {
    const mails: MailMessage[] = [];
    const ref = await this.withAction(actionId, async (tx, of, action, index) => {
      if (!canCompleteAction(of.actions, index)) {
        throw refuse("Only an action in progress can be marked done");
      }
      const now = new Date();
      await tx.manufacturingAction.update({
        where: { id: action.id },
        data: { status: "DONE", completedAt: now },
      });
      mails.push(...(await this.handOn(tx, of, index, now)));
    });
    for (const mail of mails) this.mail.queue(null, mail);
    return ref;
  }

  /**
   * `startedAt` is left as it is: null when the action is skipped while
   * waiting, which is how `undo` knows where to put it back. Skipping the
   * action in progress hands the pipeline on, like finishing it.
   */
  async skip(actionId: string) {
    const mails: MailMessage[] = [];
    const ref = await this.withAction(actionId, async (tx, of, action, index) => {
      if (!canSkipAction(of.actions, index)) {
        throw refuse("Only the action in progress or the next one can be skipped");
      }
      const now = new Date();
      await tx.manufacturingAction.update({
        where: { id: action.id },
        data: { status: "SKIPPED", completedAt: now },
      });
      mails.push(...(await this.handOn(tx, of, index, now)));
    });
    for (const mail of mails) this.mail.queue(null, mail);
    return ref;
  }

  /**
   * Steps the pipeline back one action — a mis-click's way out. The inverse
   * of the last move, hand-on included: see `undoSteps` in the contract.
   */
  async undo(id: string) {
    return this.change(id, async (tx, of) => {
      const steps = undoSteps(of.actions);
      if (steps.length === 0) throw refuse("Nothing to undo");
      for (const step of steps) {
        const action = of.actions[step.index];
        if (!action) continue;
        await tx.manufacturingAction.update({
          where: { id: action.id },
          data:
            step.to === "WAITING"
              ? { status: "WAITING", startedAt: null, completedAt: null }
              : {
                  status: "IN_PROGRESS",
                  // An imported action can be done with no start on record.
                  startedAt: action.startedAt ?? new Date(),
                  completedAt: null,
                },
        });
      }
    });
  }

  // ---- what an action holds --------------------------------------------------

  /**
   * Replaces the action's people wholesale. Someone newly put on the OF's
   * CURRENT action — the one in progress, or the next to start — gets the
   * "action à réaliser" email (email 4, trigger A), as in the old app; on
   * a later action nothing is sent yet, the hand-on will (trigger B).
   */
  async setEmployees(input: SetManufacturingActionEmployeesInput) {
    const employeeIds = [...new Set(input.employeeIds)];
    const mails: MailMessage[] = [];
    const ref = await this.withAction(input.actionId, async (tx, of, action, index) => {
      this.assertFillable(action, action.handlesEmployees, "employees");
      // Existence only: a suspended or archived person stays on an action
      // they already worked, so a later save must not be refused for them.
      const found = await tx.employee.count({ where: { id: { in: employeeIds } } });
      if (found !== employeeIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "An employee no longer exists" });
      }
      const before = new Set(
        (
          await tx.manufacturingActionAssignee.findMany({
            where: { actionId: action.id },
            select: { employeeId: true },
          })
        ).map((row) => row.employeeId),
      );
      await tx.manufacturingActionAssignee.deleteMany({ where: { actionId: action.id } });
      await tx.manufacturingActionAssignee.createMany({
        data: employeeIds.map((employeeId) => ({ actionId: action.id, employeeId })),
      });
      if (currentActionIndex(of.actions) === index) {
        const added = employeeIds.filter((id) => !before.has(id));
        mails.push(...(await this.assignmentMails(tx, of, action, index, added)).mails);
      }
    });
    // The transaction has returned: sent now, never for a rolled-back save.
    for (const mail of mails) this.mail.queue(null, mail);
    return ref;
  }

  /**
   * "Relancer" (trigger C): the action's people get the email again. Only
   * an action still to do, with someone on it — the old app refused the
   * same two. Says how many were reached and how many have no work email.
   */
  async remind(actionId: string) {
    const mails: MailMessage[] = [];
    let withoutEmail = 0;
    const ref = await this.withAction(actionId, async (tx, of, action, index) => {
      if (isActionFinished(action.status)) {
        throw refuse("This action is finished — nothing to remind");
      }
      const assignees = await tx.manufacturingActionAssignee.findMany({
        where: { actionId: action.id },
        select: { employeeId: true },
      });
      if (assignees.length === 0) {
        throw refuse("No employee is assigned to this action");
      }
      const built = await this.assignmentMails(
        tx,
        of,
        action,
        index,
        assignees.map((row) => row.employeeId),
      );
      mails.push(...built.mails);
      withoutEmail = built.withoutEmail;
    });
    for (const mail of mails) this.mail.queue(null, mail);
    return { ...ref, sent: mails.length, withoutEmail };
  }

  async setMachine(input: SetManufacturingActionMachineInput) {
    return this.withAction(input.actionId, async (tx, _of, action) => {
      this.assertFillable(action, action.handlesMachine, "a machine");
      if (input.machineId !== null) {
        const machine = await tx.machine.findUnique({
          where: { id: input.machineId },
          select: { id: true },
        });
        if (!machine) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That machine no longer exists" });
        }
      }
      await tx.manufacturingAction.update({
        where: { id: action.id },
        data: { machineId: input.machineId },
      });
    });
  }

  /**
   * Refuses before `createAttachmentUpload` hands out a capability: a PUT
   * URL is minted only for an action that can take a file right now.
   */
  async assertAttachmentUploadable(actionId: string) {
    const action = await this.prisma.manufacturingAction.findUnique({
      where: { id: actionId },
      select: {
        status: true,
        handlesAttachments: true,
        manufacturingOrder: { select: { numero: true, status: true } },
      },
    });
    if (!action) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Action not found" });
    }
    this.assertNotFrozen(action.manufacturingOrder);
    this.assertFillable(action, action.handlesAttachments, "files");
  }

  /**
   * Files an uploaded attachment. The URL is client-supplied, so it must be
   * on this app's bucket — the gate the chat and the employee documents
   * apply — or any link could be filed and opened by the next admin.
   */
  async addAttachment(input: AddManufacturingAttachmentInput) {
    if (!this.storage.isOwnAssetUrl(input.url)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Attachment must be an uploaded file" });
    }
    return this.withAction(input.actionId, async (tx, _of, action) => {
      this.assertFillable(action, action.handlesAttachments, "files");
      await tx.manufacturingActionAttachment.create({
        data: {
          actionId: action.id,
          url: input.url,
          filename: input.filename,
          contentType: input.contentType,
          size: input.size,
        },
      });
    });
  }

  /** Takes a file off the action. The object stays on S3 — see StorageService. */
  async removeAttachment(attachmentId: string) {
    const found = await this.prisma.manufacturingActionAttachment.findUnique({
      where: { id: attachmentId },
      select: { actionId: true },
    });
    if (!found) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found" });
    }
    return this.withAction(found.actionId, async (tx, _of, action) => {
      if (!canFillAction(action.status)) {
        throw refuse("A finished action can no longer be changed");
      }
      // deleteMany: already gone (a double click) is not an error.
      await tx.manufacturingActionAttachment.deleteMany({ where: { id: attachmentId } });
    });
  }

  /** Always allowed — on a finished action and on a cancelled OF alike. */
  async addComment(actor: SessionUser, input: AddManufacturingCommentInput) {
    return this.withAction(
      input.actionId,
      async (tx, _of, action) => {
        await tx.manufacturingActionComment.create({
          data: {
            actionId: action.id,
            body: input.body,
            authorId: actor.id,
            authorName: actor.name,
          },
        });
      },
      { evenCancelled: true },
    );
  }

  // ---- plumbing ---------------------------------------------------------------

  /**
   * Locks the OF row, then reads it with its actions in order. `tx` must be
   * a transaction: the lock is held until it ends, so every write on one OF
   * queues here and each reads what the one before it left.
   */
  private async lock(tx: Tx, id: string): Promise<Locked> {
    await tx.$queryRaw`SELECT 1 FROM "ManufacturingOrder" WHERE "id" = ${id} FOR UPDATE`;
    const of = await tx.manufacturingOrder.findUnique({ where: { id }, select: LOCKED_SELECT });
    if (!of) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Manufacturing order not found" });
    }
    return of;
  }

  /**
   * One change to an OF's actions: lock, refuse on a cancelled OF, run
   * `work`, then recompute the OF's status from what `work` left and stamp
   * the activity.
   */
  private change(
    id: string,
    work: (tx: Tx, of: Locked) => Promise<void>,
    options: { evenCancelled?: boolean } = {},
  ): Promise<ManufacturingOrderRef> {
    return this.prisma.$transaction(async (tx) => {
      const of = await this.lock(tx, id);
      if (!options.evenCancelled) this.assertNotFrozen(of);
      await work(tx, of);
      // A cancelled OF keeps its status; a comment on it is still activity.
      const status = manufacturingOrderIsFrozen(of.status)
        ? of.status
        : manufacturingStatusOf(
            await tx.manufacturingAction.findMany({
              where: { manufacturingOrderId: of.id },
              select: { status: true },
            }),
          );
      await tx.manufacturingOrder.update({
        where: { id: of.id },
        data: { status, lastActivityAt: new Date() },
      });
      return refOf(of);
    });
  }

  /**
   * `change`, for a call that names an action. The action is looked up
   * twice: once to find its OF, and again in the locked read, since it may
   * have been removed while this call waited for the lock.
   */
  private async withAction(
    actionId: string,
    work: (tx: Tx, of: Locked, action: LockedAction, index: number) => Promise<void>,
    options: { evenCancelled?: boolean } = {},
  ): Promise<ManufacturingOrderRef> {
    const found = await this.prisma.manufacturingAction.findUnique({
      where: { id: actionId },
      select: { manufacturingOrderId: true },
    });
    if (!found) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Action not found" });
    }
    return this.change(
      found.manufacturingOrderId,
      async (tx, of) => {
        const index = of.actions.findIndex((action) => action.id === actionId);
        const action = of.actions[index];
        if (!action) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Action not found" });
        }
        await work(tx, of, action, index);
      },
      options,
    );
  }

  /**
   * Starts the action after `finishedIndex`, when finishing that one hands
   * the pipeline on, and returns the "action à réaliser" emails for its
   * people (email 4, trigger B) — the caller sends them once committed.
   */
  private async handOn(tx: Tx, of: Locked, finishedIndex: number, at: Date): Promise<MailMessage[]> {
    const nextIndex = actionStartedAfter(of.actions, finishedIndex);
    const next = of.actions[nextIndex];
    if (!next) return [];
    await tx.manufacturingAction.update({
      where: { id: next.id },
      data: { status: "IN_PROGRESS", startedAt: at, completedAt: null },
    });
    const assignees = await tx.manufacturingActionAssignee.findMany({
      where: { actionId: next.id },
      select: { employeeId: true },
    });
    return (
      await this.assignmentMails(
        tx,
        of,
        next,
        nextIndex,
        assignees.map((row) => row.employeeId),
      )
    ).mails;
  }

  /**
   * One "action à réaliser" email per person in `employeeIds` who has a
   * work email (`Employee.workEmail`, the old app's `email_professionnel`);
   * the rest are counted, not mailed. Built on the transaction, sent later.
   */
  private async assignmentMails(
    tx: Tx,
    of: Locked,
    action: LockedAction,
    index: number,
    employeeIds: readonly string[],
  ): Promise<{ mails: MailMessage[]; withoutEmail: number }> {
    if (employeeIds.length === 0) return { mails: [], withoutEmail: 0 };
    const [people, order] = await Promise.all([
      tx.employee.findMany({
        where: { id: { in: [...employeeIds] } },
        select: { firstName: true, lastName: true, matricule: true, workEmail: true },
      }),
      tx.order.findUniqueOrThrow({
        where: { id: of.orderId },
        select: {
          numero: true,
          client: { select: { name: true } },
          product: { select: { name: true } },
        },
      }),
    ]);
    const mails: MailMessage[] = [];
    let withoutEmail = 0;
    for (const person of people) {
      if (!person.workEmail) {
        withoutEmail += 1;
        continue;
      }
      mails.push(
        actionAssignedMail({
          to: [person.workEmail],
          employeeName: [person.lastName, person.firstName].filter(Boolean).join(" ") || person.matricule,
          ofId: of.id,
          ofNumero: of.numero,
          actionNumber: index + 1,
          actionLabel: action.label,
          orderNumero: order.numero,
          clientName: order.client?.name ?? null,
          productName: order.product.name,
        }),
      );
    }
    return { mails, withoutEmail };
  }

  /** The pipeline no longer matches the template it was copied from. */
  private async markAdapted(tx: Tx, of: Locked) {
    if (of.adapted) return;
    await tx.manufacturingOrder.update({ where: { id: of.id }, data: { adapted: true } });
  }

  /** Writes each action's place in `orderedIds` as its position, in one statement. */
  private async renumber(tx: Tx, orderedIds: readonly string[]) {
    if (orderedIds.length === 0) return;
    const ids = [...orderedIds];
    const positions = ids.map((_, index) => index);
    await tx.$executeRaw`
      UPDATE "ManufacturingAction" AS a
      SET "position" = v."position"
      FROM unnest(${ids}::text[], ${positions}::int[]) AS v("id", "position")
      WHERE a."id" = v."id" AND a."position" <> v."position"`;
  }

  private assertNotFrozen(of: { numero: string; status: Locked["status"] }) {
    if (manufacturingOrderIsFrozen(of.status)) {
      throw refuse(`${of.numero} is cancelled — reopen it first`);
    }
  }

  /** A field is filled only when the action offers it and is not finished. */
  private assertFillable(action: { status: LockedAction["status"] }, handles: boolean, what: string) {
    if (!handles) throw refuse(`This action does not handle ${what}`);
    if (!canFillAction(action.status)) {
      throw refuse("A finished action can no longer be changed");
    }
  }
}
