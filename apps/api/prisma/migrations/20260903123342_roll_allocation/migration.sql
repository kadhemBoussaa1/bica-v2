-- Paper allocation: `RollAllocation`, migrated from legacy `rouleau_commande`
-- (214 rows across 75 orders and 198 reels).
--
-- The legacy table has no "allocation" in its name, but that is what it is:
-- its state column is the enum `EtatAllocation` and its timestamps are
-- `date_allocation` / `date_consommation` / `date_annulation`. It links a reel
-- to an order with a reserved weight, which is the individual reservation
-- behind the running totals in `Order.poidsReserve` / `poidsConsomme`.
--
-- Purely additive: one enum, one table, no ALTER against anything existing.
-- Rows are loaded by `db:import:step4`, idempotent on `legacyId`.
--
-- **No unique index on (orderId, paperRollId)** — the real data would reject
-- it. Seven rows sit in two duplicate groups: CMD-260 holds five
-- byte-identical 775 kg allocations of reel 695, and CMD-603 two that differ
-- only in cancellation date. All 214 migrate verbatim by decision; see
-- docs/legacy-migration.md.


-- CreateEnum
CREATE TYPE "AllocationState" AS ENUM ('RESERVED', 'CONSUMED', 'CANCELED');

-- CreateTable
CREATE TABLE "RollAllocation" (
    "id" TEXT NOT NULL,
    "poidsReserve" DOUBLE PRECISION NOT NULL,
    "metrageReserve" DOUBLE PRECISION,
    "state" "AllocationState" NOT NULL,
    "dateAllocation" TIMESTAMP(3) NOT NULL,
    "dateConsommation" TIMESTAMP(3),
    "dateAnnulation" TIMESTAMP(3),
    "orderId" TEXT NOT NULL,
    "paperRollId" TEXT NOT NULL,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RollAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RollAllocation_legacyId_key" ON "RollAllocation"("legacyId");

-- CreateIndex
CREATE INDEX "RollAllocation_orderId_idx" ON "RollAllocation"("orderId");

-- CreateIndex
CREATE INDEX "RollAllocation_paperRollId_idx" ON "RollAllocation"("paperRollId");

-- CreateIndex
CREATE INDEX "RollAllocation_dateAllocation_id_idx" ON "RollAllocation"("dateAllocation", "id");

-- CreateIndex
CREATE INDEX "RollAllocation_state_idx" ON "RollAllocation"("state");

-- AddForeignKey
ALTER TABLE "RollAllocation" ADD CONSTRAINT "RollAllocation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RollAllocation" ADD CONSTRAINT "RollAllocation_paperRollId_fkey" FOREIGN KEY ("paperRollId") REFERENCES "PaperRoll"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

