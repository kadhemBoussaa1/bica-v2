-- Reel receiving by QR scan — docs/receiving-plan.md §2 / §2b.
--
-- A reel typed into the office is PENDING until a warehouse user scans its
-- label on the floor. `receivedAt` is the record (monotonic: set once by
-- `receiveRoll`, never cleared), `receivedById` is who scanned it, SetNull so
-- deleting an account cannot erase the fact that the reel arrived.
--
-- Prisma's own DDL (`migrate diff`), followed by two data steps.
--
-- STEP 2b — the 159 shipment-less reels are import-day test rows, deleted
-- here so that every surviving reel is shipment-keyed and receiving needs no
-- orphan case. Verified before writing this migration: all 159 are named
-- TEST-ROULEAU-* or TEST-STKW-R-* with blank paperGrade and grammage, all
-- created on the 2026-09-03 import day, none carries a printed label
-- (qrCodeUrl IS NULL on every one); zero RollAllocation rows reference them,
-- so the ON DELETE RESTRICT foreign key blocks nothing; and there are zero
-- parent/child links in either direction, so no shipment-keyed reel descends
-- from one. Only two foreign keys reference PaperRoll at all
-- (PaperRoll.parentId NO ACTION, RollAllocation.paperRollId RESTRICT).
-- Expect 159 rows deleted, 1690 -> 1531, and stock totals to drop by 22 500 m
-- of metrageRestant — noise from blank-grade test rows, not inventory.
--
-- BACKFILL — receiving did not exist before now, so every reel that survives
-- 2b is physically in the warehouse already. Stamped with its own createdAt;
-- receivedById stays NULL, which is how a backfilled receipt is told apart
-- from a scanned one. Note createdAt records the IMPORT, not physical
-- receipt: it spans only 2026-09-03 and 2026-09-10, so these timestamps are
-- not receiving history and the UI should not present them as such.
-- Idempotent via `WHERE receivedAt IS NULL`.

-- AlterTable
ALTER TABLE "PaperRoll" ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "receivedById" TEXT;

-- CreateIndex
CREATE INDEX "PaperRoll_importShipmentId_receivedAt_idx" ON "PaperRoll"("importShipmentId", "receivedAt");

-- CreateIndex
CREATE INDEX "PaperRoll_receivedById_idx" ON "PaperRoll"("receivedById");

-- AddForeignKey
ALTER TABLE "PaperRoll" ADD CONSTRAINT "PaperRoll_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Drop the test reels (see STEP 2b above). Before the backfill, so the
-- backfill stamps only surviving rows.
DELETE FROM "PaperRoll" WHERE "importShipmentId" IS NULL;

-- Backfill: every surviving reel is already physically here.
UPDATE "PaperRoll" SET "receivedAt" = "createdAt" WHERE "receivedAt" IS NULL;
