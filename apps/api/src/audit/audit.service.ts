import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "../generated/prisma/client.js";
import { runListQuery } from "../list/list-query";
import { PrismaService } from "../prisma.service";
import {
  AUDIT_DETAIL_SELECT,
  AUDIT_SELECT,
  auditListDeclaration,
  type ListAuditInput,
} from "./audit.list";

/**
 * Reads the activity trace. Writes happen in the audit middleware and the
 * Better Auth hooks, never here: this service is the admin's window onto
 * rows the request pipeline produced.
 *
 * ADMIN and above see every user's rows, super admins included — a decision
 * in docs/audit-log-plan.md, so no session-derived scope narrows the list.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(input: ListAuditInput) {
    const { actorId, entityId, module, ...query } = input;
    // The three prefilters are the scope: AND-ed first, before search and
    // the active facet, exactly where a session scope would sit.
    const scope: Prisma.AuditLogWhereInput = {
      ...(actorId ? { actorId } : {}),
      ...(entityId ? { OR: [{ entityId }, { relatedId: entityId }] } : {}),
      ...(module ? { module } : {}),
    };
    return runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) => this.prisma.auditLog.findMany({ ...args, select: AUDIT_SELECT }),
        count: (args) => this.prisma.auditLog.count(args),
      },
      query,
      declaration: auditListDeclaration,
      scope,
    });
  }

  /**
   * The settings rail's figures: every row the trace holds, and the failed
   * ones. Two counts on one snapshot; the `(outcome, at, id)` index serves
   * the second, the first is the table's own count.
   */
  async summary() {
    const [total, errors] = await this.prisma.$transaction([
      this.prisma.auditLog.count(),
      this.prisma.auditLog.count({ where: { outcome: "ERROR" } }),
    ]);
    return { total, errors };
  }

  async byId(id: string) {
    const row = await this.prisma.auditLog.findUnique({
      where: { id },
      select: AUDIT_DETAIL_SELECT,
    });
    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Activity row not found" });
    }
    // Prisma's `JsonValue` is recursive, and React Query's inference over
    // it through `AppRouter` fails with "type instantiation is excessively
    // deep" on the web. Widened here: the panel treats it as opaque JSON.
    const { input, ...rest } = row;
    return { ...rest, input: input as unknown };
  }

  /**
   * Every actor that has left a row, for a filter dropdown. Grouped on the
   * snapshot columns so a deleted user still appears under the name they
   * had; a rename produces two entries, which is what the rows say.
   */
  async actors() {
    const rows = await this.prisma.auditLog.groupBy({
      by: ["actorId", "actorName", "actorEmail"],
      where: { actorId: { not: null } },
      orderBy: [{ actorName: "asc" }, { actorEmail: "asc" }, { actorId: "asc" }],
    });
    return rows.map((row) => ({
      actorId: row.actorId,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
    }));
  }
}
