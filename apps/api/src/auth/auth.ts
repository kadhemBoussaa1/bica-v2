import { ROLES, type Role } from "@repo/api-contract";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { clip, ERROR_MESSAGE_MAX, USER_AGENT_MAX } from "../audit/audit.util";

/**
 * Better Auth ships ESM only, while this app compiles to CommonJS, so it is
 * loaded through dynamic import and cached. Everything that needs the instance
 * awaits `getAuth()`.
 */
let authPromise: Promise<Awaited<ReturnType<typeof build>>> | null = null;

async function build(prisma: PrismaClient) {
  const { betterAuth } = await import("better-auth");
  const { prismaAdapter } = await import("better-auth/adapters/prisma");
  const { admin } = await import("better-auth/plugins/admin");
  const { createAccessControl } = await import("better-auth/plugins/access");
  const { createAuthMiddleware, APIError, getSessionFromCtx } = await import("better-auth/api");

  /**
   * One AUTH row in the activity trace (docs/audit-log-plan.md Step 4).
   * Never throws: a failed write is logged and the auth call proceeds.
   */
  interface AuthActor {
    id: string;
    email: string;
    name: string;
    role?: string | null;
  }
  const writeAuthRow = (row: {
    actor: AuthActor | null;
    action: "auth.signIn" | "auth.signOut";
    outcome: "OK" | "ERROR";
    errorCode?: string | null;
    errorMessage?: string | null;
    entityId?: string | null;
    entityLabel?: string | null;
    userAgent?: string | null;
  }) =>
    prisma.auditLog
      .create({
        data: {
          actorId: row.actor?.id ?? null,
          actorEmail: row.actor?.email ?? null,
          actorName: row.actor?.name ?? null,
          // Better Auth types the role as a string; only a known role is stored.
          actorRole:
            row.actor?.role && (ROLES as readonly string[]).includes(row.actor.role)
              ? (row.actor.role as Role)
              : null,
          kind: "AUTH",
          action: row.action,
          module: "auth",
          entityId: row.entityId ?? null,
          entityLabel: row.entityLabel ?? null,
          input: Prisma.DbNull,
          outcome: row.outcome,
          errorCode: row.errorCode ?? null,
          errorMessage: clip(row.errorMessage, ERROR_MESSAGE_MAX),
          durationMs: 0,
          // No IP on AUTH rows: `trust proxy` is off and Better Auth reads the
          // client-supplied X-Forwarded-For, so the value would be spoofable.
          ip: null,
          userAgent: clip(row.userAgent, USER_AGENT_MAX),
        },
        select: { id: true },
      })
      .then(
        () => undefined,
        (cause: unknown) => console.error(`[audit] failed to record ${row.action}`, cause),
      );

  const userActions = ["create", "list", "set-role", "ban", "delete", "set-password"] as const;
  const sessionActions = ["list", "revoke", "delete"] as const;

  const ac = createAccessControl({
    user: [...userActions],
    session: [...sessionActions],
  });

  return betterAuth({
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
    trustedOrigins: [process.env.CORS_ORIGIN ?? "http://localhost:3000"],

    emailAndPassword: {
      enabled: true,
      // No self-registration: accounts exist only when a higher-ranked user
      // creates them, so the public sign-up route is disabled.
      disableSignUp: true,
      minPasswordLength: 12,
    },

    user: {
      additionalFields: {
        role: { type: "string", required: true, input: false },
        createdById: { type: "string", required: false, input: false },
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },

    /**
     * The two auth events the activity trace records. Path-guarded on
     * purpose: `auth.api.createUser` dispatches `/admin/create-user` through
     * these same hooks, and widening them would double-log `user.create`.
     * A request rejected by a *before* hook (origin check) never reaches
     * `after` and leaves no row — a documented exclusion.
     */
    hooks: {
      // /admin/* is refused over HTTP: see the comment above `plugins`.
      //
      // Sign-out deletes the session before any after-hook runs, so the actor
      // is captured first. No session → no row (an anonymous POST is noise).
      // Written before the endpoint runs: a sign-out that fails afterwards
      // still reads OK; the Session table is the authority on whether it
      // happened.
      before: createAuthMiddleware(async (ctx) => {
        // `ctx.request` is set only when the call came through the HTTP
        // router; a server-side `auth.api.*` call has none.
        if (ctx.path.startsWith("/admin/") && ctx.request) {
          throw new APIError("NOT_FOUND");
        }
        if (ctx.path !== "/sign-out") return;
        const s = await getSessionFromCtx(ctx).catch(() => null);
        if (!s) return;
        await writeAuthRow({
          actor: s.user,
          action: "auth.signOut",
          outcome: "OK",
          entityId: s.user.id,
          entityLabel: s.user.email,
          userAgent: s.session.userAgent ?? ctx.headers?.get("user-agent"),
        });
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        // The attempted email only — never the password.
        const body = ctx.body as { email?: unknown } | undefined;
        const email = typeof body?.email === "string" ? body.email : null;
        const returned = ctx.context.returned;
        if (returned instanceof APIError) {
          await writeAuthRow({
            actor: null,
            action: "auth.signIn",
            outcome: "ERROR",
            errorCode: String(returned.status),
            errorMessage: returned.message,
            entityLabel: email,
            userAgent: ctx.headers?.get("user-agent"),
          });
          return;
        }
        const s = ctx.context.newSession;
        if (!s) return;
        await writeAuthRow({
          actor: s.user,
          action: "auth.signIn",
          outcome: "OK",
          entityId: s.user.id,
          entityLabel: s.user.email,
          userAgent: s.session.userAgent,
        });
      }),
    },

    // Supplies `auth.api.createUser` (hashes the password, writes the Account
    // row), which UserService and the seed call server-side with no request.
    // It is NOT the authority on privileges: the rank rules in
    // @repo/api-contract gate every call in UserService, and role, ban and
    // delete are plain Prisma writes there.
    //
    // Every /admin/* endpoint is refused over HTTP by the before hook above.
    // Left reachable, an ADMIN could POST /api/auth/admin/set-role on itself,
    // or set-user-password / remove-user on a super admin, skipping the rank
    // rules and the audit log. The grants below are empty for the same
    // reason (defence in depth): a server-side call without headers has no
    // session and the plugin skips its permission check, so nothing needs them.
    plugins: [
      admin({
        ac,
        roles: {
          SUPER_ADMIN: ac.newRole({}),
          ADMIN: ac.newRole({}),
          PRODUCTION: ac.newRole({}),
          MAGASINIER: ac.newRole({}),
        },
        defaultRole: "MAGASINIER",
        adminRoles: ["SUPER_ADMIN", "ADMIN"],
      }),
    ],
  });
}

export function getAuth(prisma: PrismaClient) {
  authPromise ??= build(prisma);
  return authPromise;
}

export type Auth = Awaited<ReturnType<typeof build>>;
