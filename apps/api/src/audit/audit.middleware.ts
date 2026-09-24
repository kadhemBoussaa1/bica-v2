import { Prisma } from "../generated/prisma/client.js";
import type { TrpcContext } from "../trpc/trpc";
import {
  capInput,
  clip,
  ERROR_MESSAGE_MAX,
  extractEntity,
  firstSegment,
  redact,
  USER_AGENT_MAX,
} from "./audit.util";

/**
 * Per-procedure switches, read by the audit middleware through tRPC `meta`.
 * `audit: false` opts a procedure out entirely (plumbing such as
 * `nav.counts`); `entity` is a dotted path into the result or input naming
 * the record the call is about, for the few the heuristic gets wrong.
 */
export interface AuditMeta {
  audit?: false | { entity?: string };
}

/**
 * What `next()` resolves to in tRPC 11: it never throws, and a non-TRPCError
 * thrown by a resolver arrives already wrapped as INTERNAL_SERVER_ERROR.
 *
 * Typed structurally rather than through `initTRPC`'s own middleware types so
 * this file needs nothing from `trpc.ts` but the context — the import goes
 * one way, and `trpc.ts` stays a page of RBAC gates.
 */
type AuditMiddlewareResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string } };

/**
 * Records one AuditLog row per procedure call, after the resolver returns.
 *
 * Sits on `protectedProcedure`'s chain *before* the auth check, so an
 * UNAUTHORIZED, FORBIDDEN or Zod BAD_REQUEST failure is a row too — with a
 * null actor when there is no session. `next()` resolves after the resolver's
 * own `$transaction` has committed, so an OK row always describes a committed
 * change. The write is awaited (one INSERT per call); a failing write is
 * logged and never fails the request.
 */
export async function auditMiddleware<TResult extends AuditMiddlewareResult>(opts: {
  ctx: TrpcContext;
  path: string;
  type: "query" | "mutation" | "subscription";
  meta: AuditMeta | undefined;
  getRawInput: () => Promise<unknown>;
  next: () => Promise<TResult>;
}): Promise<TResult> {
  const { ctx, path, type, meta, getRawInput, next } = opts;
  if (meta?.audit === false) return next();

  const started = performance.now();
  const result = await next();
  const durationMs = Math.round(performance.now() - started);

  // The raw, pre-Zod input: this middleware runs before `.input()` parses it.
  let raw: unknown;
  try {
    raw = await getRawInput();
  } catch {
    raw = undefined;
  }

  const entity = extractEntity(
    result.ok ? result.data : undefined,
    raw,
    meta?.audit === undefined ? undefined : meta.audit.entity,
  );
  const user = ctx.user;

  try {
    await ctx.prisma.auditLog.create({
      data: {
        actorId: user?.id ?? null,
        actorEmail: user?.email ?? null,
        actorName: user?.name ?? null,
        actorRole: user?.role ?? null,
        impersonatedById: user?.impersonatedBy ?? null,
        kind: type === "mutation" ? "MUTATION" : "QUERY",
        action: path,
        module: firstSegment(path),
        entityId: entity.entityId,
        entityLabel: entity.entityLabel,
        relatedId: entity.relatedId,
        input: capInput(redact(raw)) ?? Prisma.DbNull,
        outcome: result.ok ? "OK" : "ERROR",
        errorCode: result.ok ? null : result.error.code,
        errorMessage: result.ok ? null : clip(result.error.message, ERROR_MESSAGE_MAX),
        durationMs,
        // The socket peer until a reverse proxy exists — see docs/audit-log.md.
        ip: ctx.req.ip ?? null,
        userAgent: clip(ctx.req.headers["user-agent"], USER_AGENT_MAX),
      },
      select: { id: true },
    });
  } catch (cause) {
    console.error(`[audit] failed to record ${path}`, cause);
  }

  return result;
}
