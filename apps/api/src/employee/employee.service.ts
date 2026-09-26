import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import {
  canAccess,
  canAccessAny,
  canManageUser,
  CONTRACT_ENDING_SOON_DAYS,
  type CreateEmployeeInput,
  type UpdateEmployeeInput,
} from "@repo/api-contract";
import { Prisma } from "../generated/prisma/client.js";
import { runListQuery } from "../list/list-query";
import { todayUtc } from "../list/period";
import { PrismaService } from "../prisma.service";
import type { SessionUser } from "../trpc/trpc";
import {
  EMPLOYEE_SELECT,
  EMPLOYEE_SELECT_SENSITIVE,
  employeeListDeclaration,
  ON_ROSTER_WHERE,
  type ListEmployeesInput,
} from "./employee.list";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The linked account, by name, on a record page. */
const ACCOUNT_SELECT = {
  user: { select: { name: true, email: true } },
} as const satisfies Prisma.EmployeeSelect;

/**
 * `byId`'s two shapes, declared rather than inferred: a union inferred from
 * two branches is reduced to the narrower member, which would hide the
 * confidential columns from the page's types even when they are sent.
 */
type EmployeeRecord = Prisma.EmployeeGetPayload<{
  select: typeof EMPLOYEE_SELECT & typeof ACCOUNT_SELECT;
}>;
type EmployeeRecordSensitive = Prisma.EmployeeGetPayload<{
  select: typeof EMPLOYEE_SELECT_SENSITIVE & typeof ACCOUNT_SELECT;
}>;

/** How many names the "ending soon" tile spells out before it stops. */
const ENDING_SOON_NAMES = 3;

const RETURN_SELECT = {
  id: true,
  matricule: true,
  firstName: true,
  lastName: true,
  active: true,
} as const;

@Injectable()
export class EmployeeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ADMIN and above read salary, CIN, social security number, date of birth and
   * home address; everyone else gets the roster fields only.
   *
   * The decision is a `select`, not a post-filter: a caller below ADMIN never
   * has those columns fetched, so no later mistake — a log line, a new field
   * added to a response — can leak what was never in memory.
   *
   * `canAccess` rather than `hasRank`, so the PRODUCTION/MAGASINIER sibling pair
   * cannot reach each other's level. Both sit below ADMIN either way.
   */
  private selectFor(actor: SessionUser) {
    return canAccess(actor.role, "ADMIN")
      ? EMPLOYEE_SELECT_SENSITIVE
      : EMPLOYEE_SELECT;
  }

  async list(actor: SessionUser, input: ListEmployeesInput) {
    const select = this.selectFor(actor);
    const { department, ...query } = input;
    return runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) => this.prisma.employee.findMany({ ...args, select }),
        count: (args) => this.prisma.employee.count(args),
      },
      query,
      declaration: employeeListDeclaration,
      // Personnel records are visible to anyone who can reach the module; the
      // gate is which COLUMNS come back, not which rows. The service chip is
      // the only narrowing, and it is scope so the status counts follow it.
      scope: department ? { department } : {},
    });
  }

  /**
   * The list header's figures and the service chips, over every record —
   * they describe the roster, not the filtered page, so no chip or search
   * moves them (the status control's own counts do that).
   *
   * - `endingSoon`: on the roster, with a contract ending between today and
   *   `CONTRACT_ENDING_SOON_DAYS` from now. A date already past is not
   *   "ending"; the row says "ended" instead.
   * - `withoutAccount`: on the roster with no linked account, which keeps
   *   them off the shift planner (it plans accounts, not records).
   * - `departments`: the distinct services, most staffed first, for the
   *   list's chips and the form's picker. Free text, so read from the data.
   */
  async summary() {
    const today = todayUtc();
    const horizon = new Date(today.getTime() + CONTRACT_ENDING_SOON_DAYS * DAY_MS);
    const endingWhere = {
      ...ON_ROSTER_WHERE,
      contractEndDate: { gte: today, lte: horizon },
    } satisfies Prisma.EmployeeWhereInput;

    const [total, onRoster, suspended, endingCount, ending, withoutAccount, departments] =
      await this.prisma.$transaction([
        this.prisma.employee.count(),
        this.prisma.employee.count({ where: ON_ROSTER_WHERE }),
        this.prisma.employee.count({ where: employeeListDeclaration.facets.suspended }),
        this.prisma.employee.count({ where: endingWhere }),
        this.prisma.employee.findMany({
          where: endingWhere,
          select: { firstName: true, lastName: true, matricule: true },
          orderBy: [{ contractEndDate: "asc" }, { id: "asc" }],
          take: ENDING_SOON_NAMES,
        }),
        this.prisma.employee.count({ where: { ...ON_ROSTER_WHERE, userId: null } }),
        this.prisma.employee.groupBy({
          by: ["department"],
          where: { department: { not: null } },
          _count: { _all: true },
          orderBy: [{ _count: { department: "desc" } }, { department: "asc" }],
        }),
      ]);

    return {
      total,
      onRoster,
      suspended,
      endingSoon: { count: endingCount, people: ending },
      withoutAccount,
      departments: departments.flatMap((group) =>
        group.department === null ? [] : [group.department],
      ),
    };
  }

  /**
   * One record, with the account it is linked to by name: the record page
   * says which account puts this person on the shift planner. Name and
   * email only — the account's role and standing belong to the users
   * module, which applies its own rank rules to them.
   */
  async byId(
    actor: SessionUser,
    id: string,
  ): Promise<EmployeeRecord | EmployeeRecordSensitive> {
    // Two branches rather than `select: this.selectFor(actor)`: Prisma types
    // a union select by the columns its members share, so the result would
    // lose the confidential ones. The declared return type keeps the union
    // honest, and the page narrows it with `"cin" in record`.
    const employee: EmployeeRecord | EmployeeRecordSensitive | null = canAccess(
      actor.role,
      "ADMIN",
    )
      ? await this.prisma.employee.findUnique({
          where: { id },
          select: { ...EMPLOYEE_SELECT_SENSITIVE, ...ACCOUNT_SELECT },
        })
      : await this.prisma.employee.findUnique({
          where: { id },
          select: { ...EMPLOYEE_SELECT, ...ACCOUNT_SELECT },
        });
    if (!employee) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Employee not found" });
    }
    return employee;
  }

  async create(input: CreateEmployeeInput) {
    if (input.matricule !== undefined) {
      const matricule = input.matricule;
      await this.assertMatriculeFree(matricule);
      try {
        return await this.prisma.employee.create({
          data: this.writable({ ...input, matricule }),
          select: RETURN_SELECT,
        });
      } catch (cause) {
        throw matriculeConflict(cause, matricule);
      }
    }

    // Left blank: the next free number. Two creates racing to the same one
    // both read the same maximum; the loser's unique violation is retried
    // with a fresh read rather than surfaced, since the user chose nothing.
    for (let attempt = 0; attempt < 3; attempt++) {
      const matricule = await this.nextMatricule();
      try {
        return await this.prisma.employee.create({
          data: this.writable({ ...input, matricule }),
          select: RETURN_SELECT,
        });
      } catch (cause) {
        if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
          continue;
        }
        throw cause;
      }
    }
    throw new TRPCError({
      code: "CONFLICT",
      message: "Could not assign a matricule, try again or enter one",
    });
  }

  /**
   * One past the highest all-digit matricule, zero-padded to the legacy's
   * three digits ("098" after "097"). The migrated rows also hold forms
   * like "MIGR-MAT-39" and "061-59"; those are skipped rather than parsed,
   * so they never push the sequence somewhere odd. Read in full because the
   * table is the plant's headcount — hundreds of rows, not millions.
   */
  private async nextMatricule(): Promise<string> {
    const rows = await this.prisma.employee.findMany({ select: { matricule: true } });
    const highest = rows.reduce((max, row) => {
      if (!/^\d+$/.test(row.matricule)) return max;
      return Math.max(max, Number(row.matricule));
    }, 0);
    return String(highest + 1).padStart(3, "0");
  }

  async update(input: UpdateEmployeeInput) {
    await this.assertExists(input.id);
    await this.assertMatriculeFree(input.matricule, input.id);
    try {
      return await this.prisma.employee.update({
        where: { id: input.id },
        data: this.writableUpdate(input),
        select: RETURN_SELECT,
      });
    } catch (cause) {
      throw matriculeConflict(cause, input.matricule);
    }
  }

  /**
   * Archive or restore. No hard delete: an employee is named by historical
   * orders and production records.
   *
   * Distinct from `suspended`, which is the legacy roster flag — someone can be
   * suspended and still active, and archiving is this app's "delete".
   */
  async setActive(id: string, active: boolean) {
    await this.assertExists(id);
    return this.prisma.employee.update({
      where: { id },
      data: { active },
      select: RETURN_SELECT,
    });
  }

  /**
   * Links the person to the account they sign in with, or clears the link
   * (docs/shift-planning-plan.md Phase 0). Two rules on the account:
   *
   * - It must pass the shop-floor pages' own gate — ADMIN and above, or
   *   PRODUCTION — so a supervisor who works shifts can be linked and a
   *   MAGASINIER, who cannot open those pages, cannot be.
   * - It must be one the caller outranks, the same `canManageUser` rule the
   *   users module applies to its own targets: an ADMIN links PRODUCTION
   *   accounts, and only a SUPER_ADMIN links an ADMIN.
   *
   * One account is one person: the unique on `userId` turns a second link to
   * the same account into a CONFLICT rather than a silent move.
   */
  async linkUser(actor: SessionUser, id: string, userId: string | null) {
    await this.assertExists(id);
    if (userId !== null) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true },
      });
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
      }
      if (!canAccessAny(user.role, ["ADMIN", "PRODUCTION"])) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only a production or admin account can be linked to an employee",
        });
      }
      if (!canManageUser(actor.role, user.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `${actor.role} cannot link a ${user.role} account`,
        });
      }
    }
    try {
      return await this.prisma.employee.update({
        where: { id },
        data: { userId },
        select: { ...RETURN_SELECT, userId: true },
      });
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "That account is already linked to another employee",
          cause,
        });
      }
      throw cause;
    }
  }

  /**
   * Create writes every column, so an omitted optional field is genuinely
   * empty: `?? null` is right here.
   */
  private writable(input: CreateEmployeeInput & { matricule: string }) {
    return {
      matricule: input.matricule,
      firstName: input.firstName,
      lastName: input.lastName,
      department: input.department ?? null,
      jobTitle: input.jobTitle ?? null,
      employmentType: input.employmentType ?? null,
      categorie: input.categorie ?? null,
      echelon: input.echelon ?? null,
      gender: input.gender ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      phone2: input.phone2 ?? null,
      hireDate: input.hireDate ? new Date(input.hireDate) : null,
      contractEndDate: input.contractEndDate ? new Date(input.contractEndDate) : null,
      photo: input.photo ?? null,
      suspended: input.suspended,
      suspendedAt: input.suspendedAt ? new Date(input.suspendedAt) : null,
      suspensionReason: input.suspensionReason ?? null,
      salary: input.salary ?? null,
      salaryGross: input.salaryGross ?? null,
      cin: input.cin ?? null,
      socialSecurityNumber: input.socialSecurityNumber ?? null,
      birthDate: input.birthDate ? new Date(input.birthDate) : null,
      address: input.address ?? null,
    };
  }

  /**
   * Update writes a column only when the input actually carries it.
   *
   * `writable()`'s `?? null` is correct on create and destructive on update: a
   * form that does not send a field would blank it. That is not hypothetical —
   * `EmployeeForm` deliberately omits `salary`, `cin`, `socialSecurityNumber`,
   * `birthDate` and `address` for a non-admin, because a lower rank is never
   * sent those values and must not echo blanks back over them. Under the old
   * behaviour that safeguard was precisely what destroyed payroll and national
   * ID data on any save by a PRODUCTION or MAGASINIER user. `photo` had the
   * same fault for every caller: no form sent it, so every save wiped it.
   *
   * So the optional fields are three-valued, via `clearableText`/`clearableDate`
   * in the contract:
   *
   * - `undefined` — not sent, this caller never saw it. Leave the column alone.
   * - `null`      — sent empty by a caller that *did* render it. Clear it.
   * - a value     — write it.
   *
   * Both halves matter: without the first, a non-admin's save destroys payroll
   * data; without the second, emptying a box in the form silently does nothing.
   *
   * Same shape as `ProductService.writableImages`, for the same reason.
   */
  private writableUpdate(input: UpdateEmployeeInput): Prisma.EmployeeUpdateInput {
    const full = this.writable(input);
    // `undefined` is Prisma's "leave this column alone". `full` has already
    // normalised dates and `?? null`, so an explicit `null` in the input
    // arrives as `null` — exactly what clears it.
    const ifSent = <T>(sent: unknown, value: T): T | undefined =>
      sent === undefined ? undefined : value;

    return {
      // Required by the schema, so they are always present and always written.
      matricule: full.matricule,
      firstName: full.firstName,
      lastName: full.lastName,
      suspended: full.suspended,

      // Optional: written only when the caller sent them.
      department: ifSent(input.department, full.department),
      jobTitle: ifSent(input.jobTitle, full.jobTitle),
      employmentType: ifSent(input.employmentType, full.employmentType),
      categorie: ifSent(input.categorie, full.categorie),
      echelon: ifSent(input.echelon, full.echelon),
      gender: ifSent(input.gender, full.gender),
      email: ifSent(input.email, full.email),
      phone: ifSent(input.phone, full.phone),
      phone2: ifSent(input.phone2, full.phone2),
      hireDate: ifSent(input.hireDate, full.hireDate),
      contractEndDate: ifSent(input.contractEndDate, full.contractEndDate),
      photo: ifSent(input.photo, full.photo),
      suspendedAt: ifSent(input.suspendedAt, full.suspendedAt),
      suspensionReason: ifSent(input.suspensionReason, full.suspensionReason),
      salary: ifSent(input.salary, full.salary),
      salaryGross: ifSent(input.salaryGross, full.salaryGross),
      cin: ifSent(input.cin, full.cin),
      socialSecurityNumber: ifSent(input.socialSecurityNumber, full.socialSecurityNumber),
      birthDate: ifSent(input.birthDate, full.birthDate),
      address: ifSent(input.address, full.address),
    };
  }

  private async assertExists(id: string) {
    const found = await this.prisma.employee.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Employee not found" });
    }
  }

  /**
   * A read, so two saves racing to one matricule both pass it: the write's
   * unique violation is mapped to the same CONFLICT by `matriculeConflict`.
   */
  private async assertMatriculeFree(matricule: string, excludeId?: string) {
    const existing = await this.prisma.employee.findUnique({
      where: { matricule },
      select: { id: true },
    });
    if (existing && existing.id !== excludeId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Matricule ${matricule} is already used by another employee`,
      });
    }
  }
}

/**
 * The error to throw for a failed employee write: CONFLICT naming the
 * matricule when it lost a race on its unique index, otherwise the cause.
 */
function matriculeConflict(cause: unknown, matricule: string): unknown {
  if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
    return new TRPCError({
      code: "CONFLICT",
      message: `Matricule ${matricule} is already used by another employee`,
    });
  }
  return cause;
}
