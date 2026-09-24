-- Roll allocation in metres — docs/roll-allocation-plan.md §3.
--
-- Prisma's own DDL (`migrate diff`), with one drop: `Order.poidsNecessaire`,
-- the hand-typed legacy kg need, non-zero on exactly one migrated row and
-- superseded by `metrageNecessaire`, a computed snapshot column backfilled by
-- `db:backfill-metrage` after this runs. `poidsReserve` / `poidsConsomme`
-- stay for the importer only.
--
-- `PaperRoll.metrageReserve` starts at 0 everywhere. That is correct for the
-- data: every one of the 43 legacy RESERVED allocations has NULL metres, so
-- none of them counts toward the new column (and none may ever move it).
--
-- The plain `RollAllocation(paperRollId)` index is replaced by
-- `(paperRollId, state)`, which it was a prefix of.

-- DropIndex
DROP INDEX "RollAllocation_paperRollId_idx";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "poidsNecessaire",
ADD COLUMN     "metrageNecessaire" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "PaperRoll" ADD COLUMN     "metrageReserve" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RollAllocation" ADD COLUMN     "allocatedById" TEXT;

-- CreateIndex
CREATE INDEX "PaperRoll_grammage_laize_id_idx" ON "PaperRoll"("grammage", "laize", "id");

-- CreateIndex
CREATE INDEX "RollAllocation_paperRollId_state_idx" ON "RollAllocation"("paperRollId", "state");

-- CreateIndex
CREATE INDEX "RollAllocation_allocatedById_idx" ON "RollAllocation"("allocatedById");

-- AddForeignKey
ALTER TABLE "RollAllocation" ADD CONSTRAINT "RollAllocation_allocatedById_fkey" FOREIGN KEY ("allocatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

