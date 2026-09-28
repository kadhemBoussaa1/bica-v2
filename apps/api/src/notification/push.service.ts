import { Injectable, Logger } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import { sendNotification, setVapidDetails, WebPushError } from "web-push";
import {
  isPushNotification,
  notificationHref,
  notificationPayload,
  visibleNotificationKinds,
  type PushMessage,
  type PushSubscriptionInput,
  type PushUnsubscribeInput,
} from "@repo/api-contract";
import { PrismaService } from "../prisma.service";
import type { SessionUser } from "../trpc/trpc";
import type { PendingPush } from "./notification.service";

/** A push nobody could deliver within half a shift is stale; the bell has it. */
const TTL_SECONDS = 12 * 60 * 60;
/** Parallel sends per round, so a burst to every account cannot open hundreds of sockets. */
const CHUNK = 10;
/** Socket timeout per send: a hung push service must not hold the batch. */
const SEND_TIMEOUT_MS = 10_000;

/**
 * Web Push — docs/pwa-plan.md, phase 2: the personal notifications on a
 * phone whose app is closed.
 *
 * Optional, like StorageService: without the three VAPID variables, or with
 * malformed ones, the API boots with push off, `push.config` answers a null
 * key and the bell hides its toggle. `setVapidDetails` throws on a bad key or
 * subject, which in a constructor would stop Nest booting — hence the catch.
 *
 * A subscription is bound to the Better Auth session that made it
 * (`onDelete: Cascade`), so signing out ends a shared phone's pushes even if
 * the browser's own cleanup never runs.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly vapidPublicKey: string | null;

  constructor(private readonly prisma: PrismaService) {
    const publicKey = process.env.VAPID_PUBLIC_KEY ?? "";
    const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
    const subject = process.env.VAPID_SUBJECT ?? "";
    let configured: string | null = null;
    if (publicKey && privateKey && subject) {
      try {
        setVapidDetails(subject, publicKey, privateKey);
        configured = publicKey;
      } catch (error) {
        this.logger.error(`VAPID keys rejected, push is off: ${String(error)}`);
      }
    }
    this.vapidPublicKey = configured;
  }

  get enabled(): boolean {
    return this.vapidPublicKey !== null;
  }

  /** The browser's `applicationServerKey`, or null while push is off. */
  get publicKey(): string | null {
    return this.vapidPublicKey;
  }

  /**
   * Enrols this browser for the caller, in this session. Upsert on the
   * endpoint: a shared device that already held another user's subscription
   * is rebound to the caller, and the same user re-subscribing after a new
   * sign-in moves it to the new session.
   *
   * Refused while impersonating, so an admin's phone never enrols for the
   * account being impersonated. Defence in depth: auth.ts blocks the admin
   * plugin's HTTP routes, so no impersonated session can reach here today.
   */
  async subscribe(user: SessionUser, sessionId: string | null, input: PushSubscriptionInput) {
    if (!this.enabled) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Push notifications are not configured" });
    }
    if (user.impersonatedBy) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Not while impersonating" });
    }
    if (!sessionId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
    }
    const data = {
      userId: user.id,
      sessionId,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
    };
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { endpoint: input.endpoint, ...data },
      update: data,
      select: { id: true },
    });
    return { ok: true as const };
  }

  /** The caller's own row only; anyone else's endpoint matches nothing. */
  async unsubscribe(user: SessionUser, input: PushUnsubscribeInput) {
    await this.prisma.pushSubscription.deleteMany({
      where: { endpoint: input.endpoint, userId: user.id },
    });
    return { ok: true as const };
  }

  /**
   * Pushes the personal kinds among rows a transaction just committed —
   * called by NotificationOutbox's delivery, beside the SSE push.
   *
   * Fire and forget, and NEVER rejects: the caller does not await it (a slow
   * push service must not delay the business response), and an unhandled
   * rejection stops a Node 24 process.
   */
  async send(rows: readonly PendingPush[]): Promise<void> {
    if (!this.enabled) return;
    try {
      const ids = rows.filter((row) => isPushNotification(row.kind)).map((row) => row.id);
      if (ids.length === 0) return;

      // The outbox holds ids only; the params and the recipient's role
      // NOW (the link depends on it) come from the rows.
      const notifications = await this.prisma.notification.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          userId: true,
          kind: true,
          params: true,
          entityId: true,
          user: { select: { role: true } },
        },
      });
      const messages = new Map<string, PushMessage[]>();
      for (const row of notifications) {
        if (!visibleNotificationKinds(row.user.role).includes(row.kind)) continue;
        // Prisma types `params` as JSON; validated as `list` does.
        const parsed = notificationPayload.safeParse({ kind: row.kind, params: row.params });
        if (!parsed.success) continue;
        const url = notificationHref({ ...parsed.data, entityId: row.entityId }, row.user.role);
        const forUser = messages.get(row.userId) ?? [];
        forUser.push({ ...parsed.data, id: row.id, url });
        messages.set(row.userId, forUser);
      }
      if (messages.size === 0) return;

      // Live sessions of live accounts only: an expired session's cookie
      // is gone from its browser, whatever the row says.
      const subscriptions = await this.prisma.pushSubscription.findMany({
        where: {
          userId: { in: [...messages.keys()] },
          user: { banned: false },
          session: { expiresAt: { gt: new Date() } },
        },
        select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true },
      });

      const jobs = subscriptions.flatMap((subscription) =>
        (messages.get(subscription.userId) ?? []).map((message) => ({ subscription, message })),
      );
      const gone: string[] = [];
      for (let start = 0; start < jobs.length; start += CHUNK) {
        const chunk = jobs.slice(start, start + CHUNK);
        const results = await Promise.allSettled(
          chunk.map(({ subscription, message }) =>
            sendNotification(
              {
                endpoint: subscription.endpoint,
                keys: { p256dh: subscription.p256dh, auth: subscription.auth },
              },
              JSON.stringify(message),
              { TTL: TTL_SECONDS, urgency: "high", timeout: SEND_TIMEOUT_MS },
            ),
          ),
        );
        results.forEach((result, index) => {
          if (result.status === "fulfilled") return;
          const job = chunk[index];
          const error: unknown = result.reason;
          // 404/410: the browser unsubscribed or the service expired it.
          if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
            if (job) gone.push(job.subscription.id);
            return;
          }
          const status = error instanceof WebPushError ? error.statusCode : "no response";
          this.logger.warn(`push to ${job?.subscription.id ?? "?"} failed (${status}): ${String(error)}`);
        });
      }
      if (gone.length > 0) {
        await this.prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } });
      }
    } catch (error) {
      this.logger.error(`push delivery failed: ${String(error)}`);
    }
  }
}
