import { createHmac } from "node:crypto";
import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { StockApiService } from "./stock-api.service";

/** How often the worker looks for work. Inside the contract's 5-second target. */
const TICK_MS = 2_000;
/** Events delivered per tick at most, so a backlog drains without one long tick. */
const BATCH = 50;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The daily snapshot goes out at 02:00 in Tunis, as BICA Expert suggested.
 * Tunisia has kept UTC+1 all year since 2009, so that is 01:00 UTC.
 */
const SNAPSHOT_HOUR_UTC = 1;
/** The snapshot check is a query, so it runs once a minute, not every tick. */
const SNAPSHOT_CHECK_MS = 60_000;

/** The waits between attempts: 1 min, 5 min, 30 min, 2 h, then every 6 h. */
const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000];
/** An event still undelivered this long after it happened is a person's problem. */
const ALERT_AFTER_MS = 24 * 3_600_000;
const ALERT_AFTER_ATTEMPTS = 10;

/**
 * Pushes the `StockEvent` log to BICA Expert's webhook and writes the daily
 * snapshot — docs/erp-stock-api.md.
 *
 * The log is the outbox: the trigger writes each event in the transaction
 * that moved the stock, and this worker only ever reads committed rows, so
 * an event can be late but never lost. Delivery is strictly in sequence
 * order — a failing event holds the ones behind it, which keeps BICA's
 * sequence free of holes; BICA pulls in the meantime.
 *
 * Off unless STOCK_WEBHOOK_URL and STOCK_WEBHOOK_SECRET are both set (BICA
 * Expert issues both), the way PushService and MailService boot without
 * their keys. The snapshot runs either way: it is also served by the pull.
 *
 * In-process and single-instance, like the rest of the API: one container
 * runs it. A second instance would deliver some events twice, which BICA
 * tolerates (it deduplicates on `eventId`), and could write two snapshots.
 */
@Injectable()
export class StockPushService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastSnapshotCheck = 0;
  /** The head event already alerted on, so a stuck event logs once, not every tick. */
  private alerted: bigint | null = null;

  private readonly url = process.env.STOCK_WEBHOOK_URL ?? "";
  private readonly secret = process.env.STOCK_WEBHOOK_SECRET ?? "";

  constructor(
    private readonly prisma: PrismaService,
    private readonly stockApi: StockApiService,
  ) {}

  onModuleInit(): void {
    if (!this.url || !this.secret) {
      console.log("[stock-api] push is off: STOCK_WEBHOOK_URL / STOCK_WEBHOOK_SECRET not set");
    }
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    // A slow webhook must not stack ticks on top of each other.
    if (this.running) return;
    this.running = true;
    try {
      await this.snapshotIfDue();
      if (this.url && this.secret) await this.deliver();
    } catch (cause) {
      console.error("[stock-api] worker tick failed", cause);
    } finally {
      this.running = false;
    }
  }

  private async snapshotIfDue(): Promise<void> {
    const now = Date.now();
    if (now - this.lastSnapshotCheck < SNAPSHOT_CHECK_MS) return;
    this.lastSnapshotCheck = now;

    const due = new Date(now);
    due.setUTCHours(SNAPSHOT_HOUR_UTC, 0, 0, 0);
    if (now < due.getTime()) due.setUTCDate(due.getUTCDate() - 1);
    const last = await this.stockApi.lastSnapshotAt();
    if (last && last >= due) return;

    const snapshot = await this.stockApi.createSnapshot();
    console.log(`[stock-api] daily snapshot written as event ${snapshot.sequence}`);
  }

  private async deliver(): Promise<void> {
    for (let sent = 0; sent < BATCH; sent += 1) {
      const event = await this.stockApi.nextUndelivered();
      if (!event) return;
      // Waiting out a backoff. The rest of the queue waits with it.
      if (event.nextAttemptAt && event.nextAttemptAt.getTime() > Date.now()) return;

      const [envelope] = await this.stockApi.envelopes([event]);
      const error = await this.post(JSON.stringify(envelope));
      if (error === null) {
        await this.prisma.stockEvent.update({
          where: { sequence: event.sequence },
          data: { deliveredAt: new Date(), lastError: null, nextAttemptAt: null },
          select: { sequence: true },
        });
        continue;
      }

      const attempts = event.attempts + 1;
      const wait = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1] ?? 21_600_000;
      await this.prisma.stockEvent.update({
        where: { sequence: event.sequence },
        data: {
          attempts,
          lastError: error.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + wait),
        },
        select: { sequence: true },
      });
      const stuck =
        attempts >= ALERT_AFTER_ATTEMPTS ||
        Date.now() - event.occurredAt.getTime() >= ALERT_AFTER_MS;
      if (stuck && this.alerted !== event.sequence) {
        this.alerted = event.sequence;
        console.error(
          `[stock-api] ALERT: event ${event.sequence} undelivered after ${attempts} attempts ` +
            `(${error}); every later event waits behind it — BICA Expert must pull`,
        );
      }
      return;
    }
  }

  /**
   * One signed POST. Null on a 2xx, otherwise why it failed. The signature
   * is HMAC-SHA256 over `timestamp + "." + body` — BICA Expert's request
   * document; their internal plan's body-only variant is not what they ask
   * partners for.
   */
  private async post(body: string): Promise<string | null> {
    const timestamp = new Date().toISOString();
    const signature = createHmac("sha256", this.secret).update(`${timestamp}.${body}`).digest("hex");
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Timestamp": timestamp,
          "X-Signature": `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      // Drain the body so the connection is released.
      await response.arrayBuffer().catch(() => undefined);
      return response.ok ? null : `HTTP ${response.status}`;
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  }
}
