-- Ink stock v3 (the "Ink stock v3.dc.html" redesign): a swatch, a sortable
-- stock level kept by a trigger, a movement ledger for deliveries / counts /
-- archive events, and legacy ids for importing the 24-Sep `couleur` rows.
-- Additive: no existing column changes meaning.
-- CreateEnum
CREATE TYPE "InkMovementKind" AS ENUM ('OPENING', 'DELIVERY', 'ADJUSTMENT', 'ARCHIVED', 'RESTORED');

-- CreateEnum
CREATE TYPE "InkAdjustReason" AS ENUM ('INVENTORY', 'BREAKAGE', 'ENTRY_ERROR', 'OTHER');

-- AlterTable
ALTER TABLE "InkColour" ADD COLUMN     "hex" TEXT,
ADD COLUMN     "legacyId" BIGINT,
ADD COLUMN     "stockLevel" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "InkUsage" ADD COLUMN     "legacyId" BIGINT;

-- CreateTable
CREATE TABLE "InkMovement" (
    "id" TEXT NOT NULL,
    "colourId" TEXT NOT NULL,
    "kind" "InkMovementKind" NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "balanceAfter" DOUBLE PRECISION NOT NULL,
    "reason" "InkAdjustReason",
    "receiptRef" TEXT,
    "byId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InkMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InkMovement_colourId_at_id_idx" ON "InkMovement"("colourId", "at", "id");

-- CreateIndex
CREATE INDEX "InkMovement_byId_idx" ON "InkMovement"("byId");

-- CreateIndex
CREATE UNIQUE INDEX "InkColour_legacyId_key" ON "InkColour"("legacyId");

-- CreateIndex
CREATE INDEX "InkColour_active_stockLevel_id_idx" ON "InkColour"("active", "stockLevel", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InkUsage_legacyId_key" ON "InkUsage"("legacyId");

-- AddForeignKey
ALTER TABLE "InkMovement" ADD CONSTRAINT "InkMovement_colourId_fkey" FOREIGN KEY ("colourId") REFERENCES "InkColour"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InkMovement" ADD CONSTRAINT "InkMovement_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: Prisma cannot express a trigger.
--
-- "stockLevel" is the contract's `inkStockState` as one sortable number, so
-- the list can sort and filter by it in SQL: 0 out, (1, 2] low, 3 + ratio
-- above the threshold, 4 with none. Recomputed on every insert and on every
-- update touching stock, alertThreshold or stockLevel itself, so the app's
-- conditional decrements keep it right without knowing it exists, and a
-- direct write to it is overwritten. In the low branch the threshold is
-- positive (0 < stock <= threshold), so the division is safe.
CREATE FUNCTION ink_colour_stock_level() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."stockLevel" := CASE
    WHEN NEW."stock" <= 0 THEN 0
    WHEN NEW."alertThreshold" IS NOT NULL AND NEW."stock" <= NEW."alertThreshold"
      THEN 1 + NEW."stock" / NEW."alertThreshold"
    WHEN NEW."alertThreshold" > 0 THEN 3 + LEAST(NEW."stock" / NEW."alertThreshold", 1e9)
    ELSE 4
  END;
  RETURN NEW;
END
$$;

CREATE TRIGGER ink_colour_stock_level
  BEFORE INSERT OR UPDATE OF "stock", "alertThreshold", "stockLevel" ON "InkColour"
  FOR EACH ROW EXECUTE FUNCTION ink_colour_stock_level();

-- Existing rows: fire the trigger once.
UPDATE "InkColour" SET "stock" = "stock";

-- Existing colours start their history here, at the balance they hold.
INSERT INTO "InkMovement" ("id", "colourId", "kind", "delta", "balanceAfter", "at")
SELECT gen_random_uuid()::text, "id", 'OPENING', "stock", "stock", CURRENT_TIMESTAMP
FROM "InkColour";
