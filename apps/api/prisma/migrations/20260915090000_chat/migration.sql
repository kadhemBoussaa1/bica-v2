-- Shared notice stream (chat) — docs/chat-plan.md §1.
--
-- Prisma's own DDL (`migrate diff`), purely additive: two tables, their
-- indexes and three foreign keys. Nothing is backfilled; there was no prior
-- way for anyone in the plant to tell anyone else anything.
--
-- Append-only by decision. There is no `updatedAt`, no `deletedAt` and no
-- edit or delete procedure anywhere above this table: a notice posted to the
-- whole plant is a published fact, and a correction is posted under it.
-- Pinning (`pinnedAt`) is the only moderation lever the app has.
--
-- ChatAttachment is a child table rather than a `String[]` on the message.
-- The array columns elsewhere in this schema (`Product.images`,
-- `PurchaseInvoice.documents`) hold URLs into someone else's bucket — legacy
-- data this app renders but does not own. These are assets this app mints,
-- and the feed needs each one's content type to choose between an inline
-- thumbnail and a file link, plus the original filename as a label. An array
-- carries neither.
--
-- Both ChatMessage indexes lead DESCENDING, like `AuditLog.at`: the feed is
-- keyset-paginated newest-first, and a plain ascending btree serves only one
-- direction. The trailing `id` is the tiebreaker that makes a page boundary
-- safe when two notices share a millisecond — without it the boundary row
-- repeats and its twin is skipped.
--
-- No partial index on `pinnedAt IS NOT NULL`, deliberately: it would be the
-- second hand-written index in this repo, and `migrate diff` does not know
-- about those (see the note on `StockCount_one_open`). The plain two-column
-- index is correct, just larger.

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "body" TEXT,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "pinnedAt" TIMESTAMP(3),
    "pinnedById" TEXT,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "size" INTEGER NOT NULL,

    CONSTRAINT "ChatAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatMessage_createdAt_id_idx" ON "ChatMessage"("createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "ChatMessage_pinnedAt_id_idx" ON "ChatMessage"("pinnedAt" DESC, "id");

-- CreateIndex
CREATE INDEX "ChatAttachment_messageId_id_idx" ON "ChatAttachment"("messageId", "id");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_pinnedById_fkey" FOREIGN KEY ("pinnedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatAttachment" ADD CONSTRAINT "ChatAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
