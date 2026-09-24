import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import {
  addDays,
  canAccess,
  canWorkerMarkDone,
  isoDayOf,
  plantDay,
  PRODUCTION_VISIBLE_ORDER_STATUSES,
  shiftBounds,
  taskMachineTypes,
  utcDay,
  WEEK_SHIFTS,
  weekEndsAt,
  weekStartOf,
  type AdminChangeInput,
  type AssignWeekInput,
  type ChangeIdInput,
  type CopyWeekInput,
  type CreateShiftTaskInput,
  type DayInput,
  type ListShiftChangesInput,
  type MoveDraftInput,
  type MyWeekInput,
  type RejectChangeInput,
  type RequestChangeInput,
  type SetTaskDoneInput,
  type ShiftChangeKind,
  type ShiftTaskType,
  type ShiftType,
  type UpdateShiftTaskInput,
  type WeekStartInput,
} from "@repo/api-contract";
import type { Prisma } from "../generated/prisma/client.js";
import { runListQuery } from "../list/list-query";
import { PrismaService } from "../prisma.service";
import type { SessionUser } from "../trpc/trpc";
import {
  ASSIGNMENT_ORDER,
  ASSIGNMENT_SELECT,
  CHANGE_SELECT,
  ROSTER_EMPLOYEE_SELECT,
  SHIFT_CORE_SELECT,
  shiftChangeListDeclaration,
  TASK_ORDER,
  TASK_SELECT,
  WEEK_SELECT,
} from "./shift.list";

type Tx = Prisma.TransactionClient;

/** A week as the change logic needs it: its state and when it ends. */
const WEEK_ROW_SELECT = { id: true, status: true, weekStart: true } satisfies Prisma.ShiftWeekSelect;
type WeekRow = Prisma.ShiftWeekGetPayload<{ select: typeof WEEK_ROW_SELECT }>;

/** A person's weekly row, as the change logic reads it. */
const ROW_SELECT = { id: true, type: true } satisfies Prisma.ShiftAssignmentSelect;
type Row = Prisma.ShiftAssignmentGetPayload<{ select: typeof ROW_SELECT }>;

/** The id fields a change names; what `adminChangeInput` and a stored row share. */
interface ChangeFields {
  weekId: string;
  kind: ShiftChangeKind;
  employeeId: string;
  toType?: ShiftType | null;
  counterpartEmployeeId?: string | null;
}

/** A change with its rows loaded and every precondition checked. */
interface ResolvedChange {
  weekId: string;
  kind: ShiftChangeKind;
  employeeId: string;
  /** The person's row — every kind but ADD. */
  row: Row | null;
  fromType: ShiftType | null;
  toType: ShiftType | null;
  counterpartEmployeeId: string | null;
  /** SWAP only: the counterpart's row. */
  counterpartRow: Row | null;
}

const unique = (ids: readonly string[]) => [...new Set(ids)];

/**
 * Shift planning and daily tickets — docs/shift-planning-plan.md §4.2 (v2).
 *
 * A person is on one shift type for the whole week; the row is the roster.
 * Three scopes, all derived from the session and AND-ed first:
 *
 * - A week is visible to ADMIN and above in any state, and to a worker only
 *   once PUBLISHED. A draft reads as "not opened" to a worker — `null`, not
 *   FORBIDDEN — so nothing leaks about what is being planned.
 * - A ticket is its person's to read and mark done; ADMIN reads all.
 * - A change is a worker's own to request or withdraw; deciding is ADMIN's.
 *
 * Every write that moves a person is a conditional write (`updateMany` /
 * `deleteMany` with the expected state in the `where`), so two admins
 * racing on one roster get one success and one CONFLICT rather than a
 * silent double move. The database's unique on (week, employee) is the last
 * word on "one shift per person" and is caught as CONFLICT.
 */
@Injectable()
export class ShiftService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- weeks ---------------------------------------------------------------

  /**
   * The week starting on `weekStart`: who is on which shift, and its 18
   * day-shifts. `week: null` for a week not yet opened — and for a draft, to
   * a worker. ADMIN also gets the previous week's id and status, which is
   * what "copy previous week" needs to know whether it has a source.
   */
  async weekByStart(actor: SessionUser, input: WeekStartInput) {
    const admin = canAccess(actor.role, "ADMIN");
    const [week, previousWeek] = await Promise.all([
      this.prisma.shiftWeek.findFirst({
        where: { AND: [{ weekStart: utcDay(input.weekStart) }, this.weekScope(actor)] },
        select: WEEK_SELECT,
      }),
      admin
        ? this.prisma.shiftWeek.findUnique({
            where: { weekStart: utcDay(addDays(input.weekStart, -7)) },
            select: { id: true, status: true },
          })
        : Promise.resolve(null),
    ]);
    return { week, previousWeek };
  }

  /**
   * Opens a week: the row and its 18 day-shifts in one nested create, each
   * shift's bounds computed from the plant's fixed offset. The unique on
   * `weekStart` makes a second open a CONFLICT rather than a duplicate.
   */
  async openWeek(input: WeekStartInput) {
    try {
      return await this.prisma.shiftWeek.create({
        data: {
          weekStart: utcDay(input.weekStart),
          shifts: {
            create: WEEK_SHIFTS.map(({ dayOffset, type }) => {
              const day = addDays(input.weekStart, dayOffset);
              const { startsAt, endsAt } = shiftBounds(day, type);
              return { date: utcDay(day), type, startsAt, endsAt };
            }),
          },
        },
        select: { id: true, weekStart: true, status: true },
      });
    } catch (cause) {
      if (this.isUniqueViolation(cause)) {
        throw new TRPCError({ code: "CONFLICT", message: "This week is already opened", cause });
      }
      throw cause;
    }
  }

  /**
   * Repeats another week's roster onto a draft, person for person. A merge,
   * not a replacement: whoever is already placed this week is kept (the
   * unique absorbs the duplicate), and people no longer on the roster are
   * skipped. `clearWeek` is the way back from a wrong copy.
   */
  async copyWeek(input: CopyWeekInput) {
    if (input.weekId === input.fromWeekId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a different week to copy from" });
    }
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.shiftWeek.findUnique({
        where: { id: input.weekId },
        select: { id: true, status: true },
      });
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Week not found" });
      }
      this.assertDraft(target.status);

      const source = await tx.shiftAssignment.findMany({
        where: { weekId: input.fromWeekId },
        select: {
          employeeId: true,
          type: true,
          employee: { select: { active: true, suspended: true } },
        },
      });

      let skippedOffRoster = 0;
      const rows: { weekId: string; employeeId: string; type: ShiftType }[] = [];
      for (const a of source) {
        if (!a.employee.active || a.employee.suspended) {
          skippedOffRoster += 1;
          continue;
        }
        rows.push({ weekId: target.id, employeeId: a.employeeId, type: a.type });
      }
      const created =
        rows.length > 0
          ? await tx.shiftAssignment.createMany({ data: rows, skipDuplicates: true })
          : { count: 0 };
      return {
        id: target.id,
        copied: created.count,
        skippedOffRoster,
        skippedAlreadyPlaced: rows.length - created.count,
      };
    });
  }

  /**
   * Puts people on one shift for the whole week — the add modal's bulk
   * action, on a draft and on a published week alike. On a draft the rows
   * are simply written; on a published week each arrival is also an ADD
   * change (and each move a MOVE change), created ACCEPTED with the admin as
   * requester and decider, so the inbox history says who did what.
   *
   * Someone already on another shift is reported back untouched, unless
   * `moveIfPlaced` — the modal's "everyone" scope — in which case they are
   * moved, their open future tickets on the old shift going with them.
   */
  async assign(actor: SessionUser, input: AssignWeekInput) {
    return this.prisma.$transaction(async (tx) => {
      const week = await tx.shiftWeek.findUnique({
        where: { id: input.weekId },
        select: WEEK_ROW_SELECT,
      });
      if (!week) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Week not found" });
      }
      const published = week.status === "PUBLISHED";
      if (published) this.assertWeekOpen(week);

      const ids = unique(input.employeeIds);
      await this.assertOnRoster(tx, ids);

      const placed = await tx.shiftAssignment.findMany({
        where: { weekId: week.id, employeeId: { in: ids } },
        select: { id: true, employeeId: true, type: true },
      });
      const placedById = new Map(placed.map((p) => [p.employeeId, p]));
      const arriving = ids.filter((id) => !placedById.has(id));
      const moving = input.moveIfPlaced
        ? placed.filter((p) => p.type !== input.type)
        : [];
      const now = new Date();
      const record = (data: Prisma.ShiftChangeUncheckedCreateInput) =>
        tx.shiftChange.create({
          data: { ...data, status: "ACCEPTED", requestedById: actor.id, decidedById: actor.id, decidedAt: now },
          select: { id: true },
        });

      let added = 0;
      if (!published) {
        const created =
          arriving.length > 0
            ? await tx.shiftAssignment.createMany({
                data: arriving.map((employeeId) => ({ weekId: week.id, employeeId, type: input.type })),
                skipDuplicates: true,
              })
            : { count: 0 };
        added = created.count;
      } else {
        for (const employeeId of arriving) {
          // One row and one ADD change per person; a race on the unique is
          // a CONFLICT for the whole batch rather than a half-recorded one.
          await this.createRow(tx, week.id, employeeId, input.type);
          await record({ weekId: week.id, kind: "ADD", employeeId, toType: input.type });
          added += 1;
        }
      }

      let ticketsRemoved = 0;
      for (const row of moving) {
        ticketsRemoved += await this.detach(tx, week.id, row.employeeId, row.type);
        await this.retype(tx, row.id, row.type, input.type);
        if (published) {
          await this.supersedePending(tx, actor, {
            weekId: week.id, kind: "MOVE", employeeId: row.employeeId,
            row: { id: row.id, type: row.type }, fromType: row.type, toType: input.type,
            counterpartEmployeeId: null, counterpartRow: null,
          });
          await record({
            weekId: week.id, kind: "MOVE", employeeId: row.employeeId,
            assignmentId: row.id, fromType: row.type, toType: input.type,
          });
        }
      }

      return {
        id: week.id,
        type: input.type,
        added,
        moved: moving.length,
        ticketsRemoved,
        alreadyPlaced: input.moveIfPlaced
          ? placed.filter((p) => p.type === input.type).map(({ employeeId, type }) => ({ employeeId, type }))
          : placed.map(({ employeeId, type }) => ({ employeeId, type })),
      };
    });
  }

  /** Takes someone off a draft week; their open tickets on it go with them. */
  async unassign(assignmentId: string) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.shiftAssignment.findUnique({
        where: { id: assignmentId },
        select: {
          id: true,
          weekId: true,
          employeeId: true,
          type: true,
          week: { select: { status: true } },
        },
      });
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Assignment not found" });
      }
      this.assertDraft(row.week.status);
      const ticketsRemoved = await this.detach(tx, row.weekId, row.employeeId, row.type);
      await tx.shiftAssignment.delete({ where: { id: assignmentId } });
      return { id: assignmentId, weekId: row.weekId, ticketsRemoved };
    });
  }

  /**
   * Moves someone to another shift on a draft, in one write. A published
   * week goes through `change` so the move is recorded; a draft is untracked
   * and just edited. Their open tickets on the old shift go with them.
   */
  async moveDraft(input: MoveDraftInput) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.shiftAssignment.findUnique({
        where: { id: input.assignmentId },
        select: {
          id: true,
          weekId: true,
          employeeId: true,
          type: true,
          week: { select: { status: true } },
        },
      });
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Assignment not found" });
      }
      this.assertDraft(row.week.status);
      if (row.type === input.type) return { id: row.id, weekId: row.weekId, ticketsRemoved: 0 };
      const ticketsRemoved = await this.detach(tx, row.weekId, row.employeeId, row.type);
      await this.retype(tx, row.id, row.type, input.type);
      return { id: row.id, weekId: row.weekId, ticketsRemoved };
    });
  }

  /**
   * Empties a draft: every ticket and every row (a draft's tickets are
   * drafts too). The way out of a wrong "copy previous week".
   */
  async clearWeek(weekId: string) {
    return this.prisma.$transaction(async (tx) => {
      const week = await tx.shiftWeek.findUnique({
        where: { id: weekId },
        select: { id: true, status: true },
      });
      if (!week) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Week not found" });
      }
      this.assertDraft(week.status);
      const tasks = await tx.shiftTask.deleteMany({ where: { shift: { weekId } } });
      const assignments = await tx.shiftAssignment.deleteMany({ where: { weekId } });
      return { id: weekId, assignments: assignments.count, tasks: tasks.count };
    });
  }

  /**
   * Freezes the week for workers. Guarded update: a second publish, or a
   * publish racing another, finds no DRAFT row to flip and reads why.
   */
  async publish(actor: SessionUser, weekId: string) {
    const flipped = await this.prisma.shiftWeek.updateMany({
      where: { id: weekId, status: "DRAFT" },
      data: { status: "PUBLISHED", publishedAt: new Date(), publishedById: actor.id },
    });
    if (flipped.count !== 1) {
      const week = await this.prisma.shiftWeek.findUnique({
        where: { id: weekId },
        select: { id: true },
      });
      if (!week) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Week not found" });
      }
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "This week is already published",
      });
    }
    return { id: weekId, status: "PUBLISHED" as const };
  }

  // ---- changes on a published week ----------------------------------------

  /**
   * An admin's change, for the rest of the week: recorded ACCEPTED with the
   * admin as both requester and decider, and applied in the same
   * transaction. Any pending request on a row it touches is superseded
   * first, so the inbox never offers a decision on a row the roster has
   * already moved past.
   */
  async change(actor: SessionUser, input: AdminChangeInput) {
    return this.prisma.$transaction(async (tx) => {
      const resolved = await this.resolveChange(tx, input);
      await this.supersedePending(tx, actor, resolved);
      const now = new Date();
      const row = await tx.shiftChange.create({
        data: {
          weekId: resolved.weekId,
          kind: resolved.kind,
          status: "ACCEPTED",
          employeeId: resolved.employeeId,
          assignmentId: resolved.row?.id ?? null,
          fromType: resolved.fromType,
          toType: resolved.toType,
          counterpartEmployeeId: resolved.counterpartEmployeeId,
          reason: input.reason ?? null,
          requestedById: actor.id,
          decidedById: actor.id,
          decidedAt: now,
        },
        select: { id: true, weekId: true },
      });
      const ticketsRemoved = await this.applyChange(tx, resolved);
      return { ...row, ticketsRemoved };
    });
  }

  /**
   * A worker's request on their own row, for the rest of the week. The row
   * is looked up WITH the caller's employee id on a published week, so
   * someone else's, or a draft's, is NOT_FOUND. A move must change the
   * shift; a swap names someone on another shift.
   */
  async requestChange(actor: SessionUser, input: RequestChangeInput) {
    const me = await this.requireEmployee(actor);
    return this.prisma.$transaction(async (tx) => {
      const week = await tx.shiftWeek.findFirst({
        where: { id: input.weekId, status: "PUBLISHED" },
        select: WEEK_ROW_SELECT,
      });
      const mine = week
        ? await tx.shiftAssignment.findUnique({
            where: { weekId_employeeId: { weekId: week.id, employeeId: me.id } },
            select: ROW_SELECT,
          })
        : null;
      if (!week || !mine) {
        throw new TRPCError({ code: "NOT_FOUND", message: "You are not on this week's roster" });
      }
      this.assertWeekOpen(week);

      let toType: ShiftType;
      let counterpartEmployeeId: string | null = null;
      if (input.kind === "MOVE") {
        if (!input.toType || input.toType === mine.type) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "You are already on that shift" });
        }
        toType = input.toType;
      } else {
        const other = input.counterpartEmployeeId;
        const theirs = other
          ? await tx.shiftAssignment.findUnique({
              where: { weekId_employeeId: { weekId: week.id, employeeId: other } },
              select: ROW_SELECT,
            })
          : null;
        if (!other || other === me.id || !theirs) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That person is not on this week's roster",
          });
        }
        if (theirs.type === mine.type) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That person is already on your shift",
          });
        }
        toType = theirs.type;
        counterpartEmployeeId = other;
      }

      try {
        return await tx.shiftChange.create({
          data: {
            weekId: week.id,
            kind: input.kind,
            status: "PENDING",
            employeeId: me.id,
            assignmentId: mine.id,
            fromType: mine.type,
            toType,
            counterpartEmployeeId,
            reason: input.reason,
            requestedById: actor.id,
          },
          select: { id: true, weekId: true },
        });
      } catch (cause) {
        if (this.isUniqueViolation(cause)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "You already have a pending request this week",
            cause,
          });
        }
        throw cause;
      }
    });
  }

  /**
   * Accepts a pending request and applies it, in one transaction: a failing
   * apply (the person moved since, the counterpart left) rolls the decision
   * back, so a row is never ACCEPTED with nothing done.
   */
  async accept(actor: SessionUser, input: ChangeIdInput) {
    return this.prisma.$transaction(async (tx) => {
      const flipped = await tx.shiftChange.updateMany({
        where: { id: input.changeId, status: "PENDING" },
        data: { status: "ACCEPTED", decidedById: actor.id, decidedAt: new Date() },
      });
      if (flipped.count !== 1) await this.throwNotPending(tx, input.changeId);

      const change = await tx.shiftChange.findUniqueOrThrow({
        where: { id: input.changeId },
        select: {
          weekId: true,
          kind: true,
          employeeId: true,
          toType: true,
          counterpartEmployeeId: true,
        },
      });
      // Re-resolved against the roster as it is NOW, not as it was requested.
      const resolved = await this.resolveChange(tx, change);
      await this.supersedePending(tx, actor, resolved);
      const ticketsRemoved = await this.applyChange(tx, resolved);
      return { id: input.changeId, weekId: change.weekId, ticketsRemoved };
    });
  }

  async reject(actor: SessionUser, input: RejectChangeInput) {
    const flipped = await this.prisma.shiftChange.updateMany({
      where: { id: input.changeId, status: "PENDING" },
      data: {
        status: "REJECTED",
        decisionReason: input.reason ?? null,
        decidedById: actor.id,
        decidedAt: new Date(),
      },
    });
    if (flipped.count !== 1) await this.throwNotPending(this.prisma, input.changeId);
    return this.prisma.shiftChange.findUniqueOrThrow({
      where: { id: input.changeId },
      select: { id: true, weekId: true },
    });
  }

  /**
   * The requester takes a pending request back. Scoped to their own row in
   * the `where`, so someone else's request is NOT_FOUND. Frees the
   * one-pending-per-row slot for a corrected request.
   */
  async withdraw(actor: SessionUser, input: ChangeIdInput) {
    const flipped = await this.prisma.shiftChange.updateMany({
      where: { id: input.changeId, status: "PENDING", requestedById: actor.id },
      data: { status: "WITHDRAWN", decidedById: actor.id, decidedAt: new Date() },
    });
    if (flipped.count !== 1) {
      await this.throwNotPending(this.prisma, input.changeId, { requestedById: actor.id });
    }
    return this.prisma.shiftChange.findUniqueOrThrow({
      where: { id: input.changeId },
      select: { id: true, weekId: true },
    });
  }

  async listChanges(query: ListShiftChangesInput) {
    return runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) => this.prisma.shiftChange.findMany({ ...args, select: CHANGE_SELECT }),
        count: (args) => this.prisma.shiftChange.count(args),
      },
      query,
      declaration: shiftChangeListDeclaration,
      scope: {},
    });
  }

  /** The nav badge for the inbox. */
  async pendingChangeCount(): Promise<number> {
    return this.prisma.shiftChange.count({ where: { status: "PENDING" } });
  }

  // ---- reading a day, one's own week, the running shift ------------------

  /**
   * One day for the admin's ticket screen: its day-shifts (one on Sunday,
   * two on Saturday, three otherwise), each with the people whose weekly
   * shift it is and every ticket on it.
   */
  async dayView(input: DayInput) {
    const shifts = await this.prisma.shift.findMany({
      where: { date: utcDay(input.date) },
      select: {
        ...SHIFT_CORE_SELECT,
        week: { select: WEEK_ROW_SELECT },
        tasks: { select: TASK_SELECT, orderBy: TASK_ORDER },
      },
      orderBy: [{ startsAt: "asc" }],
    });
    const weekId = shifts[0]?.weekId;
    const rows = weekId
      ? await this.prisma.shiftAssignment.findMany({
          where: { weekId },
          select: ASSIGNMENT_SELECT,
          orderBy: ASSIGNMENT_ORDER,
        })
      : [];
    return {
      date: input.date,
      week: shifts[0]?.week ?? null,
      shifts: shifts.map((shift) => ({
        id: shift.id,
        weekId: shift.weekId,
        date: shift.date,
        type: shift.type,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        tasks: shift.tasks,
        people: rows.filter((r) => r.type === shift.type),
      })),
    };
  }

  /**
   * A worker's own week: their shift for it (or none), the days that shift
   * covers with their tickets, and the whole roster — a published roster is
   * readable by everyone on the floor, and the request dialog names a swap
   * counterpart from it. `employee: null` when the account is linked to
   * nobody, which the page says in words.
   */
  async myWeek(actor: SessionUser, input: MyWeekInput) {
    const me = await this.employeeFor(actor);
    const weekStart = input.weekStart ?? weekStartOf(plantDay());
    if (!me) return { employee: null, weekStart, week: null, requests: [] };

    const week = await this.prisma.shiftWeek.findFirst({
      where: { weekStart: utcDay(weekStart), status: "PUBLISHED" },
      select: {
        id: true,
        weekStart: true,
        status: true,
        assignments: { select: ASSIGNMENT_SELECT, orderBy: ASSIGNMENT_ORDER },
        shifts: {
          select: {
            ...SHIFT_CORE_SELECT,
            tasks: { where: { employeeId: me.id }, select: TASK_SELECT, orderBy: TASK_ORDER },
          },
          orderBy: [{ startsAt: "asc" }],
        },
      },
    });
    if (!week) return { employee: me, weekStart, week: null, requests: [] };

    const mine = week.assignments.find((a) => a.employeeId === me.id) ?? null;
    const requests = await this.prisma.shiftChange.findMany({
      where: { weekId: week.id, employeeId: me.id, requestedById: actor.id },
      select: CHANGE_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    return {
      employee: me,
      weekStart,
      week: {
        id: week.id,
        weekStart: week.weekStart,
        status: week.status,
        assignments: week.assignments,
        mine: mine ? { id: mine.id, type: mine.type } : null,
        shifts: mine ? week.shifts.filter((s) => s.type === mine.type) : [],
      },
      requests,
    };
  }

  /**
   * The shift running now on a published week, whether the caller is on it,
   * who is, the caller's tickets on it (all of them for ADMIN), and the
   * caller's next day-shift. Between Saturday 22:00 and Sunday 22:00
   * nothing runs and `current` is null.
   */
  async current(actor: SessionUser) {
    const now = new Date();
    const admin = canAccess(actor.role, "ADMIN");
    const me = await this.employeeFor(actor);

    const running = await this.prisma.shift.findFirst({
      where: { startsAt: { lte: now }, endsAt: { gt: now }, week: { status: "PUBLISHED" } },
      select: SHIFT_CORE_SELECT,
    });
    let current = null;
    if (running) {
      const people = await this.prisma.shiftAssignment.findMany({
        where: { weekId: running.weekId, type: running.type },
        select: ASSIGNMENT_SELECT,
        orderBy: ASSIGNMENT_ORDER,
      });
      const mine = me !== null && people.some((p) => p.employeeId === me.id);
      const tasks =
        admin || mine
          ? await this.prisma.shiftTask.findMany({
              where: { shiftId: running.id, ...(admin ? {} : { employeeId: me?.id ?? "" }) },
              select: TASK_SELECT,
              orderBy: TASK_ORDER,
            })
          : [];
      current = { ...running, people, mine, tasks };
    }

    return {
      now,
      employee: me,
      current,
      next: me ? await this.nextShiftFor(me.id, now) : null,
    };
  }

  /**
   * The nav badge for "My shifts": open tickets for me on the shift running
   * now if I am on it, otherwise on my next one. 0 for an unlinked account.
   */
  async openTaskCount(actor: SessionUser): Promise<number> {
    const me = await this.employeeFor(actor);
    if (!me) return 0;
    const now = new Date();
    const running = await this.prisma.shift.findFirst({
      where: { startsAt: { lte: now }, endsAt: { gt: now }, week: { status: "PUBLISHED" } },
      select: { id: true, weekId: true, type: true },
    });
    const onRunning =
      running &&
      (await this.prisma.shiftAssignment.findFirst({
        where: { weekId: running.weekId, employeeId: me.id, type: running.type },
        select: { id: true },
      }));
    const shiftId = onRunning ? running.id : (await this.nextShiftFor(me.id, now))?.id;
    if (!shiftId) return 0;
    return this.prisma.shiftTask.count({
      where: { shiftId, employeeId: me.id, status: "OPEN" },
    });
  }

  /**
   * The earliest day-shift after `now` that the person works: their weekly
   * rows on published weeks from this week on, joined by (week, type) to the
   * generated day-shifts. Two queries, because "the shift's type equals the
   * person's type for that week" cannot be written as one Prisma filter.
   */
  private async nextShiftFor(employeeId: string, now: Date) {
    const rows = await this.prisma.shiftAssignment.findMany({
      where: {
        employeeId,
        week: { status: "PUBLISHED", weekStart: { gte: utcDay(weekStartOf(plantDay(now))) } },
      },
      select: { weekId: true, type: true },
    });
    if (rows.length === 0) return null;
    return this.prisma.shift.findFirst({
      where: { startsAt: { gt: now }, OR: rows.map((r) => ({ weekId: r.weekId, type: r.type })) },
      select: SHIFT_CORE_SELECT,
      orderBy: [{ startsAt: "asc" }],
    });
  }

  // ---- tickets -------------------------------------------------------------

  async createTask(actor: SessionUser, input: CreateShiftTaskInput) {
    return this.prisma.$transaction(async (tx) => {
      const shift = await tx.shift.findUnique({
        where: { id: input.shiftId },
        select: { id: true, weekId: true, type: true, endsAt: true },
      });
      if (!shift) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Shift not found" });
      }
      this.assertNotEnded(shift);
      await this.assertOnShift(tx, shift.weekId, input.employeeId, shift.type);
      if (input.machineId) await this.assertMachineForTask(tx, input.type, input.machineId);
      if (input.orderId) await this.assertOrderOnFloor(tx, input.orderId);
      return tx.shiftTask.create({
        data: {
          shiftId: shift.id,
          employeeId: input.employeeId,
          type: input.type,
          machineId: input.machineId ?? null,
          orderId: input.orderId ?? null,
          note: input.note ?? null,
          createdById: actor.id,
        },
        select: { id: true, shiftId: true },
      });
    });
  }

  /**
   * Edits a ticket in place. Refused on a DONE ticket: reopen it first, so a
   * finished ticket's content is what was finished. `machineId` and
   * `orderId` are three-valued (undefined leaves it, null clears it).
   */
  async updateTask(input: UpdateShiftTaskInput) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.shiftTask.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          shiftId: true,
          status: true,
          shift: { select: { weekId: true, type: true, endsAt: true } },
        },
      });
      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
      this.assertNotEnded(task.shift);
      if (task.status === "DONE") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Reopen the ticket before editing it",
        });
      }
      await this.assertOnShift(tx, task.shift.weekId, input.employeeId, task.shift.type);
      if (input.machineId) await this.assertMachineForTask(tx, input.type, input.machineId);
      if (input.orderId) await this.assertOrderOnFloor(tx, input.orderId);
      return tx.shiftTask.update({
        where: { id: task.id },
        data: {
          employeeId: input.employeeId,
          type: input.type,
          machineId: input.machineId === undefined ? undefined : input.machineId,
          orderId: input.orderId === undefined ? undefined : input.orderId,
          note: input.note === undefined ? undefined : (input.note ?? null),
        },
        select: { id: true, shiftId: true },
      });
    });
  }

  /** Hard delete: a ticket is a to-do, like a production run (`production.remove`). */
  async removeTask(id: string) {
    const task = await this.prisma.shiftTask.findUnique({
      where: { id },
      select: { id: true, shiftId: true, shift: { select: { endsAt: true } } },
    });
    if (!task) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
    }
    this.assertNotEnded(task.shift);
    await this.prisma.shiftTask.delete({ where: { id } });
    return { id, shiftId: task.shiftId };
  }

  /**
   * Done / reopen. The ticket's person may mark it done until shortly after
   * the shift ends (`canWorkerMarkDone`), so a missed ticket stays missed
   * unless an admin closes it; only an admin reopens. FORBIDDEN is fine for
   * the reopen refusal: the caller can already see the row. The guarded
   * update makes a double tap idempotent — `changedNow` says whether this
   * call did it.
   */
  async setTaskDone(actor: SessionUser, input: SetTaskDoneInput) {
    const now = new Date();
    const admin = canAccess(actor.role, "ADMIN");
    const me = admin ? null : await this.employeeFor(actor);
    if (!admin && !me) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
    }
    const task = await this.prisma.shiftTask.findFirst({
      where: {
        AND: [
          { id: input.id },
          admin ? {} : { employeeId: me?.id, shift: { week: { status: "PUBLISHED" } } },
        ],
      },
      select: { id: true, shiftId: true, shift: { select: { startsAt: true, endsAt: true } } },
    });
    if (!task) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
    }
    if (!input.done && !admin) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only an admin can reopen a ticket" });
    }
    if (input.done && !admin && !canWorkerMarkDone(task.shift, now)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          task.shift.startsAt.getTime() > now.getTime()
            ? "You can mark it done once the shift has started"
            : "This shift is over — ask an admin to close the ticket",
      });
    }
    const changed = await this.prisma.shiftTask.updateMany({
      where: { id: task.id, status: input.done ? "OPEN" : "DONE" },
      data: input.done
        ? { status: "DONE", doneAt: now, doneById: actor.id }
        : { status: "OPEN", doneAt: null, doneById: null },
    });
    return { id: task.id, shiftId: task.shiftId, changedNow: changed.count === 1 };
  }

  // ---- applying a change ---------------------------------------------------

  /**
   * Loads and checks everything a change names: the week is published and
   * not over; the person's row (its type is `fromType`); a move's target
   * differs; a swap's counterpart is on another shift (their type is
   * `toType`); a replacement or addition is on the roster and free this
   * week. Shared by an admin's change and by accepting a worker's request,
   * so a request is re-checked against the roster as it is NOW.
   */
  private async resolveChange(tx: Tx, input: ChangeFields): Promise<ResolvedChange> {
    const { kind, employeeId } = input;
    const week = await tx.shiftWeek.findUnique({
      where: { id: input.weekId },
      select: WEEK_ROW_SELECT,
    });
    if (!week) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Week not found" });
    }
    if (week.status !== "PUBLISHED") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "This week is still a draft — edit the roster directly",
      });
    }
    this.assertWeekOpen(week);

    const row = await tx.shiftAssignment.findUnique({
      where: { weekId_employeeId: { weekId: week.id, employeeId } },
      select: ROW_SELECT,
    });

    if (kind === "ADD") {
      if (row) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That person is already on a shift this week",
        });
      }
      if (!input.toType) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the shift to add them to" });
      }
      await this.assertOnRoster(tx, [employeeId]);
      return {
        weekId: week.id,
        kind,
        employeeId,
        row: null,
        fromType: null,
        toType: input.toType,
        counterpartEmployeeId: null,
        counterpartRow: null,
      };
    }

    if (!row) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "That person is not on a shift this week",
      });
    }
    const fromType = row.type;
    let toType: ShiftType | null = null;
    let counterpartEmployeeId: string | null = null;
    let counterpartRow: Row | null = null;

    if (kind === "MOVE") {
      if (!input.toType || input.toType === fromType) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That is the same shift" });
      }
      toType = input.toType;
    } else if (kind === "SWAP" || kind === "REPLACE") {
      const other = input.counterpartEmployeeId;
      if (!other || other === employeeId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the other person" });
      }
      counterpartEmployeeId = other;
      counterpartRow = await tx.shiftAssignment.findUnique({
        where: { weekId_employeeId: { weekId: week.id, employeeId: other } },
        select: ROW_SELECT,
      });
      if (kind === "SWAP") {
        if (!counterpartRow) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The other person is not on a shift this week",
          });
        }
        if (counterpartRow.type === fromType) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The other person is already on the same shift",
          });
        }
        toType = counterpartRow.type;
      } else {
        if (counterpartRow) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The replacement is already on a shift this week",
          });
        }
        await this.assertOnRoster(tx, [other]);
      }
    }

    return {
      weekId: week.id,
      kind,
      employeeId,
      row,
      fromType,
      toType,
      counterpartEmployeeId,
      counterpartRow,
    };
  }

  /**
   * Writes a resolved change to the roster. Conditional throughout: every
   * update or delete names the type the row is expected to have, and a
   * miss is a CONFLICT that rolls the caller's transaction back. Returns
   * how many open future tickets the leavers lost.
   */
  private async applyChange(tx: Tx, change: ResolvedChange): Promise<number> {
    const { weekId, employeeId, row, fromType, toType, counterpartEmployeeId, counterpartRow } =
      change;
    let removed = 0;
    switch (change.kind) {
      case "MOVE":
        if (!row || !fromType || !toType) break;
        removed += await this.detach(tx, weekId, employeeId, fromType);
        await this.retype(tx, row.id, fromType, toType);
        break;
      case "SWAP":
        if (!row || !fromType || !toType || !counterpartEmployeeId || !counterpartRow) break;
        removed += await this.detach(tx, weekId, employeeId, fromType);
        removed += await this.detach(tx, weekId, counterpartEmployeeId, toType);
        await this.retype(tx, row.id, fromType, toType);
        await this.retype(tx, counterpartRow.id, toType, fromType);
        break;
      case "REPLACE":
        if (!row || !fromType || !counterpartEmployeeId) break;
        removed += await this.detach(tx, weekId, employeeId, fromType);
        await this.deleteRow(tx, row.id, fromType);
        await this.createRow(tx, weekId, counterpartEmployeeId, fromType);
        break;
      case "REMOVE":
        if (!row || !fromType) break;
        removed += await this.detach(tx, weekId, employeeId, fromType);
        await this.deleteRow(tx, row.id, fromType);
        break;
      case "ADD":
        if (!toType) break;
        await this.createRow(tx, weekId, employeeId, toType);
        break;
    }
    return removed;
  }

  private async retype(tx: Tx, id: string, from: ShiftType, to: ShiftType) {
    const moved = await tx.shiftAssignment.updateMany({
      where: { id, type: from },
      data: { type: to },
    });
    if (moved.count !== 1) throw this.rosterChanged();
  }

  private async deleteRow(tx: Tx, id: string, type: ShiftType) {
    const deleted = await tx.shiftAssignment.deleteMany({ where: { id, type } });
    if (deleted.count !== 1) throw this.rosterChanged();
  }

  private async createRow(tx: Tx, weekId: string, employeeId: string, type: ShiftType) {
    try {
      await tx.shiftAssignment.create({ data: { weekId, employeeId, type } });
    } catch (cause) {
      if (this.isUniqueViolation(cause)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "That person is already on a shift this week",
          cause,
        });
      }
      throw cause;
    }
  }

  private rosterChanged() {
    return new TRPCError({
      code: "CONFLICT",
      message: "The roster changed underneath this — reload and try again",
    });
  }

  /**
   * Overtakes any pending request on a row the change moves. The
   * requester's words are kept in `reason`; the decision says why.
   */
  private async supersedePending(tx: Tx, actor: SessionUser, change: ResolvedChange) {
    const touched = [change.row?.id, change.counterpartRow?.id].filter(
      (id): id is string => typeof id === "string",
    );
    if (touched.length === 0) return;
    await tx.shiftChange.updateMany({
      where: { assignmentId: { in: touched }, status: "PENDING" },
      data: {
        status: "REJECTED",
        decisionReason: "superseded",
        decidedById: actor.id,
        decidedAt: new Date(),
      },
    });
  }

  /**
   * Runs before any write that takes a person off a shift type — a move, a
   * swap (both sides), a replacement, a removal, and a draft unassign: their
   * OPEN tickets on that type's day-shifts that have not started are
   * deleted, since they will not be there to do them. Done tickets and
   * tickets on started or past days stay as history. Returns the count.
   */
  private async detach(tx: Tx, weekId: string, employeeId: string, type: ShiftType) {
    const gone = await tx.shiftTask.deleteMany({
      where: {
        employeeId,
        status: "OPEN",
        shift: { weekId, type, startsAt: { gt: new Date() } },
      },
    });
    return gone.count;
  }

  // ---- scopes and guards ---------------------------------------------------

  /** The employee behind the session, or null for an account linked to nobody. */
  private async employeeFor(actor: SessionUser) {
    return this.prisma.employee.findUnique({
      where: { userId: actor.id },
      select: ROSTER_EMPLOYEE_SELECT,
    });
  }

  private async requireEmployee(actor: SessionUser) {
    const me = await this.employeeFor(actor);
    if (!me) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No employee record is linked to your account",
      });
    }
    return me;
  }

  /** Drafts are the admin's; workers see published weeks only. */
  private weekScope(actor: SessionUser): Prisma.ShiftWeekWhereInput {
    return canAccess(actor.role, "ADMIN") ? {} : { status: "PUBLISHED" };
  }

  private assertDraft(status: "DRAFT" | "PUBLISHED") {
    if (status !== "DRAFT") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "This week is published — record a change instead",
      });
    }
  }

  /** A change applies to the rest of the week; once it is over there is none. */
  private assertWeekOpen(week: WeekRow) {
    if (weekEndsAt(isoDayOf(week.weekStart)).getTime() <= Date.now()) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "That week is over" });
    }
  }

  private assertNotEnded(shift: { endsAt: Date }) {
    if (shift.endsAt.getTime() <= Date.now()) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "That shift has ended" });
    }
  }

  /** Every id names an active, unsuspended employee. */
  private async assertOnRoster(tx: Tx, ids: readonly string[]) {
    const employees = await tx.employee.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, active: true, suspended: true },
    });
    const onRoster = employees.filter((e) => e.active && !e.suspended);
    if (onRoster.length !== ids.length) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Only people on the roster can be put on a shift",
      });
    }
  }

  /** The person's weekly row has this day-shift's type. */
  private async assertOnShift(tx: Tx, weekId: string, employeeId: string, type: ShiftType) {
    const row = await tx.shiftAssignment.findFirst({
      where: { weekId, employeeId, type },
      select: { id: true },
    });
    if (!row) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "That person is not on this shift this week",
      });
    }
  }

  /**
   * A machine named on a ticket must exist, be active, and be a type the
   * ticket's kind runs on — the production module's rule, through
   * `taskMachineTypes`, so the form's filter and this check agree.
   */
  private async assertMachineForTask(tx: Tx, type: ShiftTaskType, machineId: string) {
    const machine = await tx.machine.findUnique({
      where: { id: machineId },
      select: { id: true, active: true, type: true, name: true },
    });
    if (!machine) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "That machine no longer exists" });
    }
    if (!machine.active) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "That machine is archived and cannot be used",
      });
    }
    const allowed = taskMachineTypes(type);
    if (allowed && !allowed.includes(machine.type)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${machine.name} is not a machine a ${type.toLowerCase()} ticket runs on`,
      });
    }
  }

  /** Only an order the floor can open — IN_PRODUCTION and live — goes on a ticket. */
  private async assertOrderOnFloor(tx: Tx, orderId: string) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, active: true },
    });
    if (!order || !order.active || !PRODUCTION_VISIBLE_ORDER_STATUSES.includes(order.status)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Only an order in production can be put on a ticket",
      });
    }
  }

  /** NOT_FOUND for a row that is not there (or not the caller's), CONFLICT for one already decided. */
  private async throwNotPending(
    db: Tx | PrismaService,
    changeId: string,
    extra: Prisma.ShiftChangeWhereInput = {},
  ): Promise<never> {
    const row = await db.shiftChange.findFirst({
      where: { AND: [{ id: changeId }, extra] },
      select: { id: true },
    });
    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
    }
    throw new TRPCError({ code: "CONFLICT", message: "This request was already decided" });
  }

  /** Prisma's unique-constraint code, without importing the error class. */
  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002"
    );
  }
}
