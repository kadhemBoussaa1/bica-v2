import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { canAccess, canAccessAny, type Role } from "@repo/api-contract";
import type { PrismaService } from "../prisma.service";
import { auditMiddleware, type AuditMeta } from "../audit/audit.middleware";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  /**
   * The admin behind this session when it was opened through the admin
   * plugin's impersonation; null otherwise. Recorded on every audit row.
   * `me` returns it to the browser too — intentional, nothing reads it yet.
   */
  impersonatedBy: string | null;
}

export interface TrpcContext {
  prisma: PrismaService;
  /** Null for anonymous requests. */
  user: SessionUser | null;
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
}

/**
 * tRPC's `isDev` defaults to `NODE_ENV !== "production"`, and nothing here
 * sets NODE_ENV, so by default every error carried its stack (local paths
 * included) to any caller, anonymous ones too. The stack is kept only when
 * NODE_ENV is explicitly "development".
 */
const exposeStack = process.env.NODE_ENV === "development";

const t = initTRPC
  .context<TrpcContext>()
  .meta<AuditMeta>()
  .create({
    errorFormatter({ shape }) {
      if (exposeStack) return shape;
      const data = { ...shape.data };
      delete data.stack;
      return { ...shape, data };
    },
  });

export const router = t.router;

/**
 * No audit row: `health` and `me` are plumbing the browser polls. Everything
 * that says something about intent descends from `protectedProcedure` and is
 * recorded (docs/audit-log-plan.md).
 */
export const publicProcedure = t.procedure;

/**
 * Every call through here is written to `AuditLog` once it returns — before
 * the auth check below, so a rejected call is a row too. Opt a procedure out
 * with `.meta({ audit: false })`.
 */
const audited = t.procedure.use(auditMiddleware);

/**
 * Requires a signed-in, non-banned user. The middleware narrows `ctx.user` from
 * `SessionUser | null` to `SessionUser`, so downstream procedures get a
 * guaranteed-present user without re-checking.
 */
export const protectedProcedure = audited.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * Requires a role at or above `required`. Uses `canAccess`, so PRODUCTION and
 * MAGASINIER (equal rank) cannot reach each other's procedures, while ADMIN and
 * SUPER_ADMIN inherit downward.
 */
function roleProcedure(required: Role) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!canAccess(ctx.user.role, required)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Requires ${required} privileges`,
      });
    }
    return next({ ctx });
  });
}

/**
 * Requires ANY one of `required` to pass `canAccess` — the gate for a feature
 * owned by ADMIN and above PLUS one specific rank-50 sibling.
 *
 * `roleProcedure` cannot express that: it takes a single role, and the two
 * siblings must not inherit each other. `anyRoleProcedure(["ADMIN",
 * "PRODUCTION"])` admits ADMIN, SUPER_ADMIN and PRODUCTION while still
 * excluding MAGASINIER. See `canAccessAny` in roles.ts.
 */
function anyRoleProcedure(required: readonly Role[]) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!canAccessAny(ctx.user.role, required)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Requires ${required.join(" or ")} privileges`,
      });
    }
    return next({ ctx });
  });
}

export const adminProcedure = roleProcedure("ADMIN");
export const superAdminProcedure = roleProcedure("SUPER_ADMIN");

/**
 * Readable by the shop floor as well as ADMIN+: the product spec that says
 * what to make, the machine and ink lists, the ink used on an order and the
 * production recorded against it. Orders and stock reads sit on the wider
 * `orderModuleProcedure`; outbound shipments, inventory counts and roll
 * receiving on `warehouseProcedure`. Clients, suppliers, employees, invoices,
 * purchasing, the production reports, and every master-data write stay
 * ADMIN+ only.
 *
 * PRODUCTION's view of orders is further narrowed by scope, not just by a
 * gate: see `PRODUCTION_VISIBLE_ORDER_STATUSES` and `OrderService.list`.
 */
export const shopFloorProcedure = anyRoleProcedure(["ADMIN", "PRODUCTION"]);

/**
 * The warehouse gate: ADMIN+ and MAGASINIER — outbound shipments, which the
 * warehouse raises, edits and ships (docs/export-plan.md). Reads too: the
 * order-module gate would admit PRODUCTION, whose view of orders is scoped
 * to `IN_PRODUCTION`, and a shipment row names the whole export tail.
 */
export const warehouseProcedure = anyRoleProcedure(["ADMIN", "MAGASINIER"]);

/**
 * The order-module gate: ADMIN+, PRODUCTION and MAGASINIER.
 *
 * Wider than `shopFloorProcedure` on purpose. MAGASINIER owns the
 * `READY_FOR_EXPORT -> COMPLETED` transition in the table
 * (`order-lifecycle.ts`), so shutting that role out of the order procedures
 * entirely would make a row of the transition table unreachable — the gate
 * would silently contradict the machine it guards.
 *
 * MAGASINIER is deliberately NOT scoped by status the way PRODUCTION is
 * (`ordersAreScopedFor` returns false for it), so it still sees the whole
 * orders table. Narrowing the warehouse role to its own slice is a separate
 * decision that has not been made; when it is, add it to
 * `ordersAreScopedFor` and give it its own visible-status list rather than
 * reusing PRODUCTION's.
 */
export const orderModuleProcedure = anyRoleProcedure([
  "ADMIN",
  "PRODUCTION",
  "MAGASINIER",
]);
