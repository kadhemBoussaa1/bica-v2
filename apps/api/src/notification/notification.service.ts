import { Injectable, type BeforeApplicationShutdown } from "@nestjs/common";
import type { Response } from "express";
import {
  canAccess,
  isToastNotification,
  notificationPayload,
  ROLES,
  visibleNotificationKinds,
  type ListNotificationsInput,
  type MarkNotificationsReadInput,
  type NotificationEvent,
  type NotificationKind,
  type NotificationPayload,
} from "@repo/api-contract";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma.service";
import type { SessionUser } from "../trpc/trpc";

type Db = Prisma.TransactionClient;

/** ADMIN and above, expanded from the rank function rather than listed. */
const ADMIN_ROLES = ROLES.filter((role) => canAccess(role, "ADMIN"));

/**
 * A comment line every 25 s: under nginx's `proxy_read_timeout` on the
 * `/events` location and under any NAT idle timeout between a phone and
 * the plant's router.
 */
const HEARTBEAT_MS = 25_000;

/**
 * The server ends every stream after 15 minutes. A clean end is one of the
 * two cases `EventSource` retries by itself, and the retry re-authenticates,
 * so a revoked session or a changed role is enforced within this window
 * without checking the session on every event. `closeUser` makes ban and
 * delete immediate.
 */
const STREAM_LIFETIME_MS = 15 * 60_000;

/** A written row the stream has not been told about yet. */
interface PendingPush {
  id: string;
  userId: string;
  kind: NotificationKind;
}

/**
 * The rows one business transaction wrote, held until it commits.
 *
 * "Push after commit": a row that exists but was never pushed is fine — the
 * bell's poll and the next stream connect find it — whereas a push for a
 * row that then rolled back would announce something that never happened.
 * So the method that OWNS the `$transaction` makes an outbox, hands it to
 * `emit` inside, and flushes it once `$transaction` has returned. A method
 * running on a caller's transaction passes `null`: its rows are written
 * with the caller's commit and reach the bell through the poll.
 */
export class NotificationOutbox {
  private readonly pending: PendingPush[] = [];

  constructor(private readonly deliver: (rows: PendingPush[]) => void) {}

  add(rows: readonly PendingPush[]): void {
    this.pending.push(...rows);
  }

  flush(): void {
    const rows = this.pending.splice(0);
    if (rows.length > 0) this.deliver(rows);
  }
}

export interface EmitInput {
  payload: NotificationPayload;
  /** Account ids; `null` (an employee without an account) is dropped. */
  recipients: readonly (string | null)[];
  entityId: string;
  /** Excluded from `recipients` — nobody is told about their own act. */
  actorId: string | null;
}

/**
 * In-app notifications — docs/notifications-plan.md §4.1.
 *
 * Three jobs. Emission: one row per recipient on the caller's transaction,
 * called from the service choke points (OrderService.create / transition,
 * ShiftService.publish and the ticket writes), never from the router or the
 * audit middleware. Reads: the bell's list, count and mark-read, scoped to
 * the caller's own rows and to the kinds their role may read NOW. Streams:
 * the open `GET /events` responses, per account, in this process — the API
 * runs as one container; a second replica would need a shared bus here.
 */
@Injectable()
export class NotificationService implements BeforeApplicationShutdown {
  private readonly streams = new Map<string, Set<Response>>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ends every open stream before Nest closes the HTTP server.
   *
   * Nest destroys open sockets on close only when the app is created with
   * `forceCloseConnections`, which this one is not, and `server.close()`
   * waits for every open response. Without this, one open tab holds a
   * restart until its stream's 15-minute end — `node --watch` hangs, and
   * `docker stop` waits out its grace period and kills the process. This
   * hook runs before the server closes, and a clean end is what EventSource
   * retries on, so every tab reconnects to the next process by itself.
   */
  beforeApplicationShutdown(): void {
    for (const open of this.streams.values()) {
      for (const res of open) res.end();
    }
  }

  // ---- emission -----------------------------------------------------------

  outbox(): NotificationOutbox {
    return new NotificationOutbox((rows) => this.push(rows));
  }

  /**
   * Writes one row per recipient on `db`, minus the actor and duplicates.
   * The payload is validated against the contract here, so a malformed
   * `params` fails the business write rather than landing in every bell.
   */
  async emit(db: Db, outbox: NotificationOutbox | null, input: EmitInput): Promise<void> {
    const payload = notificationPayload.parse(input.payload);
    const recipients = [
      ...new Set(
        input.recipients.filter(
          (id): id is string => id !== null && id !== input.actorId,
        ),
      ),
    ];
    if (recipients.length === 0) return;
    const rows = await db.notification.createManyAndReturn({
      data: recipients.map((userId) => ({
        userId,
        kind: payload.kind,
        params: payload.params,
        entityId: input.entityId,
        actorId: input.actorId,
      })),
      select: { id: true, userId: true },
    });
    outbox?.add(rows.map((row) => ({ ...row, kind: payload.kind })));
  }

  // Recipient resolvers: one query each, on the caller's transaction, never
  // a cached list — a role change or a ban applies to the next event.

  /** Every live ADMIN and SUPER_ADMIN. */
  admins(db: Db): Promise<string[]> {
    return this.accountIds(db, { role: { in: ADMIN_ROLES } });
  }

  /** Every live PRODUCTION account (exact role, not rank: siblings stay apart). */
  production(db: Db): Promise<string[]> {
    return this.accountIds(db, { role: "PRODUCTION" });
  }

  /** Every live account, whatever its role (plan fact 2). */
  everyone(db: Db): Promise<string[]> {
    return this.accountIds(db, {});
  }

  /**
   * The account an employee signs in with, or null — no account, or a
   * banned one. Null means no notification and no error: 55 of 94 legacy
   * employees have no account, and the ticket form says so (fact 9).
   */
  async accountOf(db: Db, employeeId: string): Promise<string | null> {
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: { user: { select: { id: true, banned: true } } },
    });
    const user = employee?.user;
    return user && !user.banned ? user.id : null;
  }

  private async accountIds(db: Db, where: Prisma.UserWhereInput): Promise<string[]> {
    const users = await db.user.findMany({
      where: { AND: [{ banned: false }, where] },
      select: { id: true },
    });
    return users.map((user) => user.id);
  }

  // ---- reads ----------------------------------------------------------------

  /**
   * The caller's own rows, of the kinds their role may read right now
   * (plan decision 13). AND-ed first into every read and write below.
   */
  private scopeFor(actor: SessionUser): Prisma.NotificationWhereInput {
    return { userId: actor.id, kind: { in: visibleNotificationKinds(actor.role) } };
  }

  /**
   * One page, newest first, keyset on (createdAt, id) after the cursor row.
   * The cursor is looked up among the caller's own rows only; one that no
   * longer exists (purged) ends the list rather than restarting it.
   */
  async list(actor: SessionUser, input: ListNotificationsInput) {
    const after = input.cursor
      ? await this.prisma.notification.findFirst({
          where: { id: input.cursor, userId: actor.id },
          select: { id: true, createdAt: true },
        })
      : null;
    if (input.cursor && !after) return { items: [], nextCursor: null };

    const rows = await this.prisma.notification.findMany({
      where: {
        AND: [
          this.scopeFor(actor),
          input.unreadOnly ? { readAt: null } : {},
          after
            ? {
                OR: [
                  { createdAt: { lt: after.createdAt } },
                  { createdAt: after.createdAt, id: { lt: after.id } },
                ],
              }
            : {},
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.take + 1,
      select: {
        id: true,
        kind: true,
        params: true,
        entityId: true,
        readAt: true,
        createdAt: true,
        actor: { select: { name: true } },
      },
    });
    const page = rows.slice(0, input.take);
    const items = page.flatMap((row) => {
      // Validated on the way out too, so the client receives a typed union.
      // A row the contract no longer describes is skipped, not a 500.
      const parsed = notificationPayload.safeParse({ kind: row.kind, params: row.params });
      if (!parsed.success) return [];
      return [
        {
          id: row.id,
          entityId: row.entityId,
          readAt: row.readAt,
          createdAt: row.createdAt,
          actorName: row.actor?.name ?? null,
          ...parsed.data,
        },
      ];
    });
    return {
      items,
      nextCursor: rows.length > input.take ? (page.at(-1)?.id ?? null) : null,
    };
  }

  unreadCount(actor: SessionUser): Promise<number> {
    return this.prisma.notification.count({
      where: { AND: [this.scopeFor(actor), { readAt: null }] },
    });
  }

  /** Only the caller's own unread rows move; anyone else's id matches nothing. */
  async markRead(actor: SessionUser, input: MarkNotificationsReadInput) {
    const { count } = await this.prisma.notification.updateMany({
      where: {
        AND: [
          this.scopeFor(actor),
          { readAt: null },
          "ids" in input ? { id: { in: input.ids } } : {},
        ],
      },
      data: { readAt: new Date() },
    });
    return { count };
  }

  // ---- streams ----------------------------------------------------------------

  /**
   * Serves one `GET /events` response for an authenticated account (main.ts
   * checks the session). `ready` goes out at once, on every (re)connect: the
   * client re-reads the bell on it, which is what replaces Last-Event-ID
   * replay — the database is the truth, and a missed event shows in the
   * bell rather than as a late toast.
   */
  openStream(userId: string, res: Response): void {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Connection", "keep-alive");
    // nginx would otherwise buffer the response and deliver events only
    // when the stream closes. The /events location also turns it off.
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let open = this.streams.get(userId);
    if (!open) {
      open = new Set();
      this.streams.set(userId, open);
    }
    open.add(res);
    this.write(userId, res, "event: ready\ndata: {}\n\n");

    const heartbeat = setInterval(() => this.write(userId, res, ": ping\n\n"), HEARTBEAT_MS);
    const lifetime = setTimeout(() => res.end(), STREAM_LIFETIME_MS);
    heartbeat.unref();
    lifetime.unref();

    // On the RESPONSE: since Node 16 the request's `close` means "request
    // body done", not "connection gone". Fires on our own `end()` too.
    res.on("close", () => {
      clearInterval(heartbeat);
      clearTimeout(lifetime);
      this.unsubscribe(userId, res);
    });
  }

  /**
   * Ends every open stream of one account — for UserService on ban,
   * delete and role change, so a stream does not outlive the session that
   * opened it by up to 15 minutes. The browser's retry then meets a 401.
   */
  closeUser(userId: string): void {
    for (const res of this.streams.get(userId) ?? []) res.end();
  }

  private push(rows: readonly PendingPush[]): void {
    for (const row of rows) {
      const open = this.streams.get(row.userId);
      if (!open) continue;
      const event: NotificationEvent = {
        id: row.id,
        kind: row.kind,
        toast: isToastNotification(row.kind),
      };
      // No `id:` line: the client never replays from Last-Event-ID (it
      // re-reads the bell on `ready`), so there is nothing to resume from.
      const chunk = `event: notification\ndata: ${JSON.stringify(event)}\n\n`;
      for (const res of open) this.write(row.userId, res, chunk);
    }
  }

  /** A write to a dead socket unsubscribes it rather than throwing. */
  private write(userId: string, res: Response, chunk: string): void {
    if (res.writableEnded || res.destroyed) {
      this.unsubscribe(userId, res);
      return;
    }
    try {
      res.write(chunk);
    } catch {
      this.unsubscribe(userId, res);
      res.destroy();
    }
  }

  private unsubscribe(userId: string, res: Response): void {
    const open = this.streams.get(userId);
    if (!open) return;
    open.delete(res);
    if (open.size === 0) this.streams.delete(userId);
  }
}
