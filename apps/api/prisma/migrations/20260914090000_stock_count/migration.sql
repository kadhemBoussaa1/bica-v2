-- Reel stocktake by QR scan — docs/inventory-plan.md §2.
--
-- The second job for the warehouse handheld. Receiving (20260911090000) is
-- per-delivery, once-per-reel and monotonic: `PaperRoll.receivedAt` is set
-- once and never cleared. A stocktake is recurring, spans the whole live reel
-- population, and must be repeatable, so it cannot reuse that column and gets
-- its own two tables instead.
--
-- Presence only: a line existing IS the fact that the reel was seen. No
-- locations, no measured quantities. Counting NEVER writes to PaperRoll — a
-- count records what was seen, and acting on a variance is a separate manual
-- admin decision. In particular nothing here may stamp `receivedAt` on an
-- unreceived reel found on the floor; that would forge a receiving event.
--
-- StockCount.openedById is ON DELETE RESTRICT, which departs from every other
-- actor relation in this schema (PaperRoll.receivedBy, ProductionRun.recordedBy,
-- RollAllocation.allocatedBy, InkUsage.recordedBy and the rest are all
-- SetNull). A count is a signed document whose value is "who walked the floor
-- and said this", so an anonymous count is not a weaker record but a
-- meaningless one. Archive the account instead of deleting it — which is what
-- the users module already does. Revisit if account deletion ever becomes
-- routine, because RESTRICT makes a stocktake block user administration.
--
-- Prisma's own DDL (`migrate diff`), followed by one hand-written index.

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'OPEN',
    "expectedCount" INTEGER NOT NULL,
    "labelledCount" INTEGER NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedById" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "paperRollId" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unexpected" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockCount_status_openedAt_id_idx" ON "StockCount"("status", "openedAt", "id");

-- CreateIndex
CREATE INDEX "StockCount_openedAt_id_idx" ON "StockCount"("openedAt", "id");

-- CreateIndex
CREATE INDEX "StockCount_openedById_idx" ON "StockCount"("openedById");

-- CreateIndex
CREATE INDEX "StockCountLine_countId_scannedAt_id_idx" ON "StockCountLine"("countId", "scannedAt", "id");

-- CreateIndex
CREATE INDEX "StockCountLine_countId_unexpected_id_idx" ON "StockCountLine"("countId", "unexpected", "id");

-- CreateIndex
CREATE INDEX "StockCountLine_paperRollId_idx" ON "StockCountLine"("paperRollId");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountLine_countId_paperRollId_key" ON "StockCountLine"("countId", "paperRollId");

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_paperRollId_fkey" FOREIGN KEY ("paperRollId") REFERENCES "PaperRoll"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- One open stocktake at a time.
--
-- HAND-WRITTEN, and the FIRST partial unique index in this repo: all 32 earlier
-- migrations use a plain CREATE UNIQUE INDEX. Prisma cannot express a WHERE
-- clause on an index, so this exists ONLY here — `prisma migrate diff` does not
-- know about it and a future diff may propose dropping it or report drift. Do
-- not "fix" such a diff by removing it; re-add it instead.
--
-- Semantics, verified on this database before writing the migration:
--   * a second INSERT with status = 'OPEN' fails on this index
--   * an INSERT with status = 'OPEN' SUCCEEDS once the previous row is CLOSED
--   * unlimited CLOSED rows coexist
-- The middle one is the one that matters: this constrains concurrency without
-- ever blocking the next stocktake.
--
-- This makes "one device, one operator, one open session" the database's
-- invariant rather than the service's, so two tabs cannot both open a count.
-- If a night shift or a second warehouse ever needs to count concurrently,
-- THIS INDEX is the thing to drop, and the scan screen then needs a session
-- picker.
CREATE UNIQUE INDEX "StockCount_one_open" ON "StockCount" ("status")
  WHERE "status" = 'OPEN';
