import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import {
  assignableRoles,
  canCreateRole,
  canManageUser,
  ROLES,
  type CreateUserInput,
  type Role,
} from "@repo/api-contract";
import { getAuth } from "../auth/auth";
import { Prisma } from "../generated/prisma/client.js";
import { runListQuery } from "../list/list-query";
import { PrismaService } from "../prisma.service";
import type { SessionUser } from "../trpc/trpc";
import {
  USER_SELECT,
  userListDeclaration,
  type ListUsersInput,
} from "./user.list";

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  /** Roles the caller is permitted to assign — drives the UI's role picker. */
  assignableRoles(actor: SessionUser): Role[] {
    return assignableRoles(actor.role);
  }

  /**
   * Roles this actor may see. Derived from `canManageUser` rather than
   * hardcoded, so the authorization rule stays defined in exactly one place.
   *
   * Note this follows PEER_MANAGING_ROLES: adding ADMIN to that set would make
   * every ADMIN visible to every other ADMIN. That is the flag's intended
   * meaning, but re-verify the ADMIN case by hand whenever it changes.
   */
  private visibleRoles(actor: SessionUser): Role[] {
    return ROLES.filter((r) => canManageUser(actor.role, r));
  }

  /**
   * The same predicate the old post-filter used, pushed into SQL. It has to be
   * a `where`: you cannot LIMIT 10 before filtering and still get a correct
   * page or a correct total.
   *
   * An empty `visibleRoles` (PRODUCTION, MAGASINIER — unreachable today behind
   * adminProcedure) matches 0 rows, not all rows, so such a caller would see
   * exactly their own row.
   */
  private scopeFor(actor: SessionUser): Prisma.UserWhereInput {
    return { OR: [{ id: actor.id }, { role: { in: this.visibleRoles(actor) } }] };
  }

  async list(actor: SessionUser, query: ListUsersInput) {
    return runListQuery({
      prisma: this.prisma,
      // Closures rather than the delegate itself, so USER_SELECT decides the
      // row type the client sees.
      delegate: {
        findMany: (args) => this.prisma.user.findMany({ ...args, select: USER_SELECT }),
        count: (args) => this.prisma.user.count(args),
      },
      query,
      declaration: userListDeclaration,
      scope: this.scopeFor(actor),
    });
  }

  /**
   * The settings rail's figure for this page: the accounts the actor can
   * see, split live / banned. Same scope as `list`, so the two never
   * disagree about how many accounts there are.
   */
  async summary(actor: SessionUser) {
    const scope = this.scopeFor(actor);
    const [active, banned] = await this.prisma.$transaction([
      this.prisma.user.count({ where: { AND: [scope, { banned: false }] } }),
      this.prisma.user.count({ where: { AND: [scope, { banned: true }] } }),
    ]);
    return { active, banned };
  }

  async create(actor: SessionUser, input: CreateUserInput) {
    // The core invariant: strictly below the actor's own rank. Blocks both
    // lateral expansion (ADMIN creating ADMIN) and escalation.
    if (!canCreateRole(actor.role, input.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `${actor.role} cannot create a ${input.role} account`,
      });
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });
    }

    // Delegate to Better Auth so the password is hashed and an Account row is
    // created, rather than writing the User row directly.
    // No headers on purpose: without a request or session the admin plugin
    // skips its own permission check, and its HTTP routes are refused
    // (auth.ts), so the rank rule above is the only gate.
    const auth = await getAuth(this.prisma);
    const { isAPIError } = await import("better-auth/api");
    let created: Awaited<ReturnType<typeof auth.api.createUser>>;
    try {
      created = await auth.api.createUser({
        body: {
          email: input.email,
          password: input.password,
          name: input.name,
          role: input.role,
        },
      });
    } catch (cause) {
      if (!isAPIError(cause)) throw cause;
      // The pre-check above misses a concurrent create and a case-only
      // difference (Better Auth lower-cases the email before its own check).
      const code = (cause.body as { code?: unknown } | undefined)?.code;
      if (code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" || code === "USER_ALREADY_EXISTS") {
        throw new TRPCError({ code: "CONFLICT", message: "Email already in use", cause });
      }
      throw new TRPCError({ code: "BAD_REQUEST", message: cause.message, cause });
    }

    return this.prisma.user.update({
      where: { id: created.user.id },
      data: { role: input.role, createdById: actor.id },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
  }

  private async targetFor(actor: SessionUser, id: string) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, email: true },
    });
    if (!target) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    }
    if (target.id === actor.id) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You cannot modify your own account this way",
      });
    }
    if (!canManageUser(actor.role, target.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `${actor.role} cannot manage a ${target.role} account`,
      });
    }
    return target;
  }

  async setRole(actor: SessionUser, id: string, role: Role) {
    await this.targetFor(actor, id);
    // Promoting is bounded by the same rule as creating: strictly below self.
    if (!canCreateRole(actor.role, role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `${actor.role} cannot assign the ${role} role`,
      });
    }
    return this.prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, email: true, role: true },
    });
  }

  async setBanned(actor: SessionUser, id: string, banned: boolean, reason?: string) {
    await this.targetFor(actor, id);
    return this.prisma.user.update({
      where: { id },
      data: { banned, banReason: banned ? (reason ?? null) : null },
      select: { id: true, email: true, banned: true },
    });
  }

  async remove(actor: SessionUser, id: string) {
    await this.targetFor(actor, id);
    try {
      await this.prisma.user.delete({ where: { id } });
    } catch (cause) {
      // StockCount.openedBy is onDelete: Restrict — a stocktake keeps the
      // name of whoever opened it, so that account cannot disappear.
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2003") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This account opened a stocktake — ban it instead",
          cause,
        });
      }
      throw cause;
    }
    return { id };
  }
}
