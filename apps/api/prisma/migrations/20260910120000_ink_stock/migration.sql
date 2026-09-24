-- Ink stock — docs/legacy-migration.md "Step 7".
--
-- Prisma's own DDL (`migrate dev`), purely additive: the InkUnit enum, the
-- InkColour catalogue with its live balance, and InkUsage lines under an order.
-- Nothing is backfilled: the legacy `couleur` / `commande_couleur` tables were
-- empty.

-- CreateEnum
CREATE TYPE "InkUnit" AS ENUM ('KG', 'L');

-- CreateTable
CREATE TABLE "InkColour" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "unit" "InkUnit" NOT NULL DEFAULT 'KG',
    "stock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "alertThreshold" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InkColour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InkUsage" (
    "id" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "colourId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InkUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InkColour_code_key" ON "InkColour"("code");

-- CreateIndex
CREATE INDEX "InkColour_active_code_id_idx" ON "InkColour"("active", "code", "id");

-- CreateIndex
CREATE INDEX "InkColour_active_name_id_idx" ON "InkColour"("active", "name", "id");

-- CreateIndex
CREATE INDEX "InkColour_active_stock_id_idx" ON "InkColour"("active", "stock", "id");

-- CreateIndex
CREATE INDEX "InkUsage_orderId_usedAt_id_idx" ON "InkUsage"("orderId", "usedAt", "id");

-- CreateIndex
CREATE INDEX "InkUsage_colourId_usedAt_id_idx" ON "InkUsage"("colourId", "usedAt", "id");

-- CreateIndex
CREATE INDEX "InkUsage_recordedById_idx" ON "InkUsage"("recordedById");

-- AddForeignKey
ALTER TABLE "InkUsage" ADD CONSTRAINT "InkUsage_colourId_fkey" FOREIGN KEY ("colourId") REFERENCES "InkColour"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InkUsage" ADD CONSTRAINT "InkUsage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InkUsage" ADD CONSTRAINT "InkUsage_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
