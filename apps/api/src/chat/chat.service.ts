import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import {
  CHAT_PAGE_SIZE,
  CHAT_SINCE_MAX,
  type ChatCursor,
  type ChatFeedInput,
  type ChatSinceInput,
  type MarkChatReadInput,
  type PostChatMessageInput,
  type SetChatPinnedInput,
} from "@repo/api-contract";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma.service";
import { StorageService } from "../storage/storage.service";
import type { SessionUser } from "../trpc/trpc";

/**
 * What the feed renders.
 *
 * Deliberately does NOT join `author`. `authorName` is denormalised onto the
 * row precisely so the hottest read in the app never touches User — and so a
 * notice still reads after its author's account is deleted. `authorId` is
 * selected anyway, because the UI styles "mine" differently.
 */
const MESSAGE_SELECT = {
  id: true,
  createdAt: true,
  body: true,
  authorId: true,
  authorName: true,
  pinnedAt: true,
  pinnedById: true,
  attachments: {
    select: {
      id: true,
      url: true,
      contentType: true,
      filename: true,
      size: true,
    },
    orderBy: { id: "asc" },
  },
} satisfies Prisma.ChatMessageSelect;

/** How many pinned notices the strip will show at once. */
const PINNED_LIMIT = 20;

/**
 * The shared plant-wide notice stream — docs/chat-plan.md §3.
 *
 * One global room that every signed-in role reads and posts to. Append-only:
 * there is no update and no delete in this file, and that is the decision
 * rather than an omission — a notice posted to the whole plant is a published
 * fact, and a correction is posted under it.
 *
 * Rank is not checked here. `protectedProcedure` is the boundary for
 * everything except pin/unpin, which `adminProcedure` gates, matching how
 * every other service in this app leaves the gate to the router.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * The keyset predicate — strictly older than `cursor` in (createdAt, id).
   *
   * Written out as the lexicographic comparison it is. The second branch is
   * what makes ties safe: a naive `createdAt: { lt: … }` SKIPS every message
   * sharing the boundary timestamp, and `lte` REPEATS the cursor row. Only the
   * composite gets both right.
   *
   * Postgres row-value syntax — `(createdAt, id) < ($1, $2)` — would be
   * tighter, but Prisma cannot express it; this OR form plans acceptably
   * against `@@index([createdAt(sort: Desc), id])`.
   */
  private olderThan(cursor: ChatCursor): Prisma.ChatMessageWhereInput {
    return {
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    };
  }

  /** Strictly newer than `cursor`, the mirror of `olderThan`. */
  private newerThan(cursor: ChatCursor): Prisma.ChatMessageWhereInput {
    return {
      OR: [
        { createdAt: { gt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { gt: cursor.id } },
      ],
    };
  }

  /**
   * One page of history, newest first, older than `input.cursor`.
   *
   * `take: CHAT_PAGE_SIZE + 1` answers "is there more" without a second
   * COUNT: the extra row is dropped before returning and its existence is
   * the whole answer.
   */
  async feed(input: ChatFeedInput) {
    const rows = await this.prisma.chatMessage.findMany({
      where: input.cursor ? this.olderThan(input.cursor) : undefined,
      select: MESSAGE_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: CHAT_PAGE_SIZE + 1,
    });

    const hasMore = rows.length > CHAT_PAGE_SIZE;
    const messages = hasMore ? rows.slice(0, CHAT_PAGE_SIZE) : rows;
    const last = messages[messages.length - 1];

    return {
      messages,
      hasMore,
      nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }

  /**
   * The poll: everything newer than `input.after`.
   *
   * A separate method rather than a direction flag on `feed`, because three
   * things differ. It is capped at `CHAT_SINCE_MAX`; it is ordered ASCENDING
   * at the boundary, so an overflowing burst keeps the OLDEST of the new ones
   * and the next poll continues from there (taking the newest instead would
   * leave a permanent hole in the middle of the feed); and it has no "more
   * older" notion to report.
   *
   * With no `after` this returns the newest page ascending rather than
   * nothing. That case is not hypothetical: `feed` is fetched once and never
   * polled, so on an empty room there is no newest message, a cursor-less poll
   * that returned nothing would leave the client with nothing to poll FROM,
   * and the tab would never learn about the first notice anyone posts until a
   * manual reload. A fresh deploy puts every open tab in exactly that state.
   */
  async since(input: ChatSinceInput) {
    if (input.after) {
      return this.prisma.chatMessage.findMany({
        where: this.newerThan(input.after),
        select: MESSAGE_SELECT,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: CHAT_SINCE_MAX,
      });
    }

    // The cold read. Fetched newest-first so the cap keeps the NEWEST page
    // (the opposite end from the incremental case above, where the cap must
    // keep the oldest), then reversed so every caller sees one ascending
    // order regardless of which branch served it.
    const newest = await this.prisma.chatMessage.findMany({
      select: MESSAGE_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: CHAT_SINCE_MAX,
    });
    return newest.reverse();
  }

  /** The notices held above the flow, most recently pinned first. */
  async pinned() {
    return this.prisma.chatMessage.findMany({
      where: { pinnedAt: { not: null } },
      select: MESSAGE_SELECT,
      orderBy: [{ pinnedAt: "desc" }, { id: "desc" }],
      take: PINNED_LIMIT,
    });
  }

  /**
   * Post a notice.
   *
   * `authorName` is taken from the SESSION, never from input — it is the
   * snapshot that keeps the row readable after the account is gone, so a
   * client-supplied name would be a forgery vector with no upside.
   *
   * One nested `create`, so a notice with half its attachments cannot exist.
   */
  async post(actor: SessionUser, input: PostChatMessageInput) {
    for (const attachment of input.attachments) {
      this.assertOwnAsset(attachment.url);
    }

    return this.prisma.chatMessage.create({
      data: {
        body: input.body,
        authorId: actor.id,
        authorName: actor.name,
        attachments: {
          create: input.attachments.map((attachment) => ({
            url: attachment.url,
            contentType: attachment.contentType,
            filename: attachment.filename,
            size: attachment.size,
          })),
        },
      },
      select: MESSAGE_SELECT,
    });
  }

  /**
   * The attachment gate — docs/chat-plan.md §5.
   *
   * `post` accepts a client-supplied URL string and the feed renders it to
   * every user in the plant, so the URL is the thing to check: every other
   * upload call-site in this app gates on an existing row instead
   * (`assertUploadable`), but a chat attachment is uploaded before its message
   * exists and there is no row to assert against.
   *
   * Not a HEAD request against S3 — the object may still be uploading when
   * `post` arrives, so a liveness check here would reject valid posts.
   */
  private assertOwnAsset(url: string): void {
    if (!this.storage.isOwnAssetUrl(url)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Attachment must be an uploaded file",
      });
    }
  }

  /**
   * Pin or unpin one notice.
   *
   * Existence is checked first so an unknown id is a NOT_FOUND rather than a
   * silent no-op. Rank is NOT re-checked: `adminProcedure` is the boundary,
   * matching every other service in this app.
   *
   * Idempotent in both directions, and re-pinning re-stamps who and when —
   * `pinnedAt` doubles as the strip's sort key, so a re-pin deliberately
   * lifts a notice back to the top.
   */
  async setPinned(actor: SessionUser, input: SetChatPinnedInput) {
    const existing = await this.prisma.chatMessage.findUnique({
      where: { id: input.id },
      select: { id: true },
    });
    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Notice not found" });
    }

    return this.prisma.chatMessage.update({
      where: { id: input.id },
      data: input.pinned
        ? { pinnedAt: new Date(), pinnedById: actor.id }
        : { pinnedAt: null, pinnedById: null },
      select: MESSAGE_SELECT,
    });
  }

  /**
   * Notices newer than the user's read stamp, written by someone else.
   *
   * Someone else's only: a person's own notice is read by definition, and
   * counting it would light the badge for the writer the moment they post.
   *
   * A user with no stamp yet counts from the day their account was created:
   * what the plant said since they joined is theirs to catch up on, while
   * the whole history before it is not. Both the stamp and `createdAt` are
   * one indexed lookup, so this stays cheap enough to poll from every page.
   */
  async unreadCount(user: SessionUser): Promise<number> {
    const [read, account] = await Promise.all([
      this.prisma.chatRead.findUnique({ where: { userId: user.id }, select: { lastSeenAt: true } }),
      this.prisma.user.findUnique({ where: { id: user.id }, select: { createdAt: true } }),
    ]);
    const since = read?.lastSeenAt ?? account?.createdAt;
    if (!since) return 0;
    return this.prisma.chatMessage.count({
      where: { createdAt: { gt: since }, NOT: { authorId: user.id } },
    });
  }

  /**
   * Advances the read stamp, never rewinds it: a poll that lands out of
   * order must not resurrect notices the reader has already seen. The
   * conditional update and the insert are one upsert, so two tabs marking
   * at once cannot race a row into existence twice.
   *
   * Clamped to the server's clock: a stamp in the future would hide every
   * notice posted before it, pinning the badge at zero.
   */
  async markRead(user: SessionUser, input: MarkChatReadInput): Promise<void> {
    const now = new Date();
    const at = input.at > now ? now : input.at;
    await this.prisma.chatRead.upsert({
      where: { userId: user.id },
      create: { userId: user.id, lastSeenAt: at },
      update: {},
      select: { userId: true },
    });
    await this.prisma.chatRead.updateMany({
      where: { userId: user.id, lastSeenAt: { lt: at } },
      data: { lastSeenAt: at },
    });
  }
}
