import { listQueryBase } from "@repo/api-contract";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import type { ListDeclaration } from "../list/list-query";

export const AUDIT_SORT_KEYS = ["at", "action", "actor", "durationMs"] as const;
export type AuditSortKey = (typeof AUDIT_SORT_KEYS)[number];

/**
 * The first three partition on `kind`; `error` cuts across them (an error is
 * a query, a mutation or an auth call) so it is `nonPartitioning`, or "all"
 * would count every failed call twice.
 */
export const AUDIT_FACET_KEYS = ["query", "mutation", "auth", "error"] as const;
export type AuditFacet = (typeof AUDIT_FACET_KEYS)[number];

/**
 * The activity trace's list vocabulary — a security boundary, see
 * user.list.ts. Admin-only end to end, but the rules still hold: every sort
 * key is in `AUDIT_SELECT`, and `kind` / `outcome` are enums, so they are
 * facets, never searched (Prisma rejects `contains` on an enum at runtime).
 *
 * `errorMessage` is searched but NOT in the list select — a hit can be
 * invisible in the row. The row's Outcome cell renders `errorCode` and the
 * detail panel shows the full message, so the match is still findable.
 */
export const auditListDeclaration: ListDeclaration<
  Prisma.AuditLogWhereInput,
  Prisma.AuditLogOrderByWithRelationInput,
  AuditSortKey,
  AuditFacet
> = {
  sortable: {
    at: (dir) => ({ at: dir }),
    action: (dir) => ({ action: dir }),
    actor: (dir) => ({ actorName: dir }),
    durationMs: (dir) => ({ durationMs: dir }),
  },
  defaultSort: "at",
  searchable: ["action", "actorEmail", "actorName", "entityLabel", "entityId", "errorMessage"],
  facets: {
    query: { kind: "QUERY" },
    mutation: { kind: "MUTATION" },
    auth: { kind: "AUTH" },
    error: { outcome: "ERROR" },
  },
  nonPartitioning: ["error"],
};

/** The list row: no `input`, `userAgent` or `errorMessage` — those are detail-only. */
export const AUDIT_SELECT = {
  id: true,
  at: true,
  actorId: true,
  actorEmail: true,
  actorName: true,
  actorRole: true,
  impersonatedById: true,
  kind: true,
  action: true,
  module: true,
  entityId: true,
  entityLabel: true,
  relatedId: true,
  outcome: true,
  errorCode: true,
  durationMs: true,
  ip: true,
} satisfies Prisma.AuditLogSelect;

export const AUDIT_DETAIL_SELECT = {
  ...AUDIT_SELECT,
  input: true,
  errorMessage: true,
  userAgent: true,
} satisfies Prisma.AuditLogSelect;

/**
 * Three optional scope keys on top of the base: the actor, the entity (which
 * also matches `relatedId`, so an order's timeline includes what was raised
 * from it) and the module. Keys, never `where` objects; the service turns
 * them into the AND-ed scope.
 */
export const listAuditInput = listQueryBase.extend({
  sortBy: z.enum(AUDIT_SORT_KEYS).default(auditListDeclaration.defaultSort),
  filter: z.enum(["all", ...AUDIT_FACET_KEYS]).default("all"),
  sortDir: listQueryBase.shape.sortDir.default("desc"),
  actorId: z.string().min(1).max(64).optional(),
  entityId: z.string().min(1).max(64).optional(),
  module: z
    .string()
    .regex(/^[a-zA-Z]+$/)
    .max(40)
    .optional(),
});

export type ListAuditInput = z.infer<typeof listAuditInput>;

export const auditIdInput = z.object({ id: z.string().min(1).max(64) });
