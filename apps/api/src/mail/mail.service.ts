import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import { canAccess, ROLES } from "@repo/api-contract";
import type { Prisma } from "../generated/prisma/client.js";
import type { NotificationOutbox } from "../notification/notification.service";
import type { MailMessage } from "./templates";

type Db = Prisma.TransactionClient;

/** ADMIN and SUPER_ADMIN — the same list the bell's `admins()` resolves. */
const ADMIN_ROLES = ROLES.filter((role) => canAccess(role, "ADMIN"));

/**
 * Email notifications — docs/email-notifications-plan.md: the old app's
 * emails, through its Gmail account, to its two fixed addresses plus every
 * admin's account email.
 *
 * Optional, like push and S3: without SMTP_HOST / SMTP_USER / SMTP_PASSWORD
 * the API boots with mail off and `send` logs the email it would have sent
 * — which is also how development runs. `send` never rejects and is never
 * awaited by a business call: a mail problem is a log line, never a failed
 * save, and a slow SMTP never delays a response. The old app did the same
 * (every send in a try/catch), only synchronously.
 *
 * Gmail: port 587 with STARTTLS and an APP password; the From address is
 * the account's own (Gmail rewrites any other), so only the display name
 * is ours. A plain account may send to 500 recipients a day — far above
 * the few orders and production entries a day this sends.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;
  private readonly from: string;
  /** The old app's two fixed recipients, either possibly unset. */
  private readonly boss: string | null;
  private readonly creations: string | null;

  constructor() {
    const host = process.env.SMTP_HOST ?? "";
    const user = process.env.SMTP_USER ?? "";
    const password = process.env.SMTP_PASSWORD ?? "";
    const port = Number(process.env.SMTP_PORT ?? "587") || 587;
    const name = process.env.MAIL_FROM_NAME || "BICA-PACK - Système de Gestion";
    this.from = `"${name.replace(/"/g, "")}" <${user}>`;
    this.boss = normalise(process.env.MAIL_TO_BOSS);
    this.creations = normalise(process.env.MAIL_TO_CREATIONS);
    // A sink on this machine (development) speaks no TLS; anywhere else TLS
    // is required — 465 implicit, 587 (Gmail's) upgraded with STARTTLS.
    const local = host === "localhost" || host === "127.0.0.1";
    this.transport =
      host && user && password
        ? createTransport({
            host,
            port,
            secure: port === 465,
            requireTLS: !local && port !== 465,
            ignoreTLS: local,
            auth: { user, pass: password },
            connectionTimeout: 10_000,
            socketTimeout: 15_000,
          })
        : null;
    if (this.transport === null) {
      this.logger.log("SMTP not configured: emails are logged, not sent");
    }
  }

  onModuleDestroy(): void {
    this.transport?.close();
  }

  get enabled(): boolean {
    return this.transport !== null;
  }

  // ---- recipients -----------------------------------------------------------
  //
  // Resolved on the caller's transaction, never cached: a role change, a ban
  // or a changed address applies to the next email. The actor is NOT left
  // out, unlike the bell: the old app emailed the boss for the boss's own
  // entries, and an email is a record.

  /** Every live ADMIN and SUPER_ADMIN account's address. */
  async admins(db: Db): Promise<string[]> {
    const rows = await db.user.findMany({
      where: { role: { in: [...ADMIN_ROLES] }, banned: { not: true } },
      select: { email: true },
    });
    return rows.map((row) => row.email);
  }

  /** The boss's fixed address and the admins': HR and production news. */
  async bossAndAdmins(db: Db): Promise<string[]> {
    return dedupe([this.boss, ...(await this.admins(db))]);
  }

  /** The "creations" fixed address and the admins': new orders and purchase orders. */
  async creationsAndAdmins(db: Db): Promise<string[]> {
    return dedupe([this.creations, ...(await this.admins(db))]);
  }

  // ---- sending --------------------------------------------------------------

  /**
   * Sends once the owning transaction has committed — through the bell's
   * outbox when the caller has one, at once otherwise (a caller with no
   * outbox calls this after its transaction has returned). `null` is "no
   * email": a recipient list that came back empty, say.
   */
  queue(outbox: NotificationOutbox | null, message: MailMessage | null): void {
    if (message === null || message.to.length === 0) return;
    if (outbox) outbox.defer(() => void this.send(message));
    else void this.send(message);
  }

  /** Never rejects: a failure is logged with the subject and recipients. */
  async send(message: MailMessage): Promise<void> {
    const to = dedupe(message.to);
    if (to.length === 0) return;
    if (this.transport === null) {
      this.logger.log(`would send "${message.subject}" to ${to.join(", ")}`);
      return;
    }
    try {
      await this.transport.sendMail({
        from: this.from,
        to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      this.logger.log(`sent "${message.subject}" to ${to.join(", ")}`);
    } catch (cause) {
      this.logger.error(
        `failed to send "${message.subject}" to ${to.join(", ")}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
}

function normalise(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return trimmed.includes("@") ? trimmed : null;
}

/** Lower-cased, trimmed, blanks and repeats dropped, order kept. */
function dedupe(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const email = normalise(value);
    if (email && !seen.has(email)) {
      seen.add(email);
      out.push(email);
    }
  }
  return out;
}
