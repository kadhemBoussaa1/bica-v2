import type { ShiftChangeFacet, ShiftChangeSortKey } from "@repo/api-contract";
import type { Prisma } from "../generated/prisma/client.js";
import { contains, type ListDeclaration } from "../list/list-query";

/**
 * The shift module's vocabulary — docs/shift-planning-plan.md §4.1 (v2).
 * This file is a security boundary: the selects below decide what a WORKER
 * receives about a colleague, and the change list's `sortable` is an
 * allowlist checked against its select.
 */

/**
 * The only employee columns a worker ever receives: enough to read a
 * roster and tell two people with the same name apart. Everything else on
 * an employee stays behind `employee.list`, which is ADMIN and above.
 */
export const ROSTER_EMPLOYEE_SELECT = {
  id: true,
  matricule: true,
  firstName: true,
  lastName: true,
  /// The legacy photo URL, for the avatar on rosters and tickets.
  photo: true,
} satisfies Prisma.EmployeeSelect;

/** A day-shift: when it is. */
export const SHIFT_CORE_SELECT = {
  id: true,
  weekId: true,
  date: true,
  type: true,
  startsAt: true,
  endsAt: true,
} satisfies Prisma.ShiftSelect;

/** A person's shift for the week. */
export const ASSIGNMENT_SELECT = {
  id: true,
  type: true,
  employeeId: true,
  employee: { select: ROSTER_EMPLOYEE_SELECT },
} satisfies Prisma.ShiftAssignmentSelect;

/** Roster order: by name, `id` last so ties are stable across refetches. */
export const ASSIGNMENT_ORDER = [
  { employee: { lastName: "asc" } },
  { employee: { firstName: "asc" } },
  { id: "asc" },
] satisfies Prisma.ShiftAssignmentOrderByWithRelationInput[];

/** The week as the planner reads it: who is on which shift, and the 18 days. */
export const WEEK_SELECT = {
  id: true,
  weekStart: true,
  status: true,
  publishedAt: true,
  publishedBy: { select: { id: true, name: true } },
  assignments: { select: ASSIGNMENT_SELECT, orderBy: ASSIGNMENT_ORDER },
  shifts: {
    select: { ...SHIFT_CORE_SELECT, _count: { select: { tasks: true } } },
    orderBy: [{ startsAt: "asc" as const }],
  },
} satisfies Prisma.ShiftWeekSelect;

export const TASK_SELECT = {
  id: true,
  shiftId: true,
  employeeId: true,
  type: true,
  status: true,
  note: true,
  doneAt: true,
  createdAt: true,
  employee: { select: ROSTER_EMPLOYEE_SELECT },
  machine: { select: { id: true, code: true, name: true, type: true } },
  order: { select: { id: true, numero: true } },
  doneBy: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.ShiftTaskSelect;

export const TASK_ORDER = [
  { createdAt: "asc" },
  { id: "asc" },
] satisfies Prisma.ShiftTaskOrderByWithRelationInput[];

/**
 * One change as the inbox and a worker's own list read it. Carries both
 * sort columns (`createdAt`, `decidedAt`), so the allowlist below is a
 * subset of what is selected.
 */
export const CHANGE_SELECT = {
  id: true,
  weekId: true,
  kind: true,
  status: true,
  fromType: true,
  toType: true,
  reason: true,
  decisionReason: true,
  createdAt: true,
  decidedAt: true,
  assignmentId: true,
  employee: { select: ROSTER_EMPLOYEE_SELECT },
  counterpart: { select: ROSTER_EMPLOYEE_SELECT },
  week: { select: { id: true, weekStart: true } },
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
} satisfies Prisma.ShiftChangeSelect;

/**
 * The inbox. `status` is an enum, so it is faceted and never searched;
 * the search reaches across to the person the change is about.
 */
export const shiftChangeListDeclaration: ListDeclaration<
  Prisma.ShiftChangeWhereInput,
  Prisma.ShiftChangeOrderByWithRelationInput,
  ShiftChangeSortKey,
  ShiftChangeFacet
> = {
  sortable: {
    createdAt: (dir) => ({ createdAt: dir }),
    decidedAt: (dir) => ({ decidedAt: dir }),
  },
  defaultSort: "createdAt",
  searchable: (term) => ({
    employee: {
      OR: [
        { lastName: contains(term) },
        { firstName: contains(term) },
        { matricule: contains(term) },
      ],
    },
  }),
  // Four statuses, so these partition the set exactly and "all" is their sum.
  facets: {
    pending: { status: "PENDING" },
    accepted: { status: "ACCEPTED" },
    rejected: { status: "REJECTED" },
    withdrawn: { status: "WITHDRAWN" },
  },
};
