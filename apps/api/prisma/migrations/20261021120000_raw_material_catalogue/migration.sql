-- The raw material price catalogue: papers (one per supplier) and glues, each
-- with an append-only price history, and the glue each order glue line starts
-- with. Step 1 of docs/raw-material-prices-plan.md; nothing reads it yet.

-- CreateEnum
CREATE TYPE "PricingSlot" AS ENUM ('PAPER', 'HANDLE_GLUE', 'SIDE_GLUE', 'BASE_ADHESIVE');

-- CreateEnum
CREATE TYPE "RawMaterialType" AS ENUM ('PAPER', 'GLUE');

-- CreateTable
CREATE TABLE "RawMaterial" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "RawMaterialType" NOT NULL,
    "supplierId" TEXT,
    "paperType" "PaperType",
    "grammage" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RawMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawMaterialPrice" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "kiloPrice" DOUBLE PRECISION NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "enteredById" TEXT,
    "comment" TEXT,

    CONSTRAINT "RawMaterialPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingSlotDefault" (
    "slot" "PricingSlot" NOT NULL,
    "materialId" TEXT NOT NULL,

    CONSTRAINT "PricingSlotDefault_pkey" PRIMARY KEY ("slot")
);

-- CreateIndex
CREATE UNIQUE INDEX "RawMaterial_code_key" ON "RawMaterial"("code");

-- CreateIndex
CREATE INDEX "RawMaterial_active_type_label_id_idx" ON "RawMaterial"("active", "type", "label", "id");

-- CreateIndex
CREATE INDEX "RawMaterial_supplierId_idx" ON "RawMaterial"("supplierId");

-- CreateIndex
CREATE INDEX "RawMaterialPrice_materialId_validFrom_id_idx" ON "RawMaterialPrice"("materialId", "validFrom", "id");

-- CreateIndex
CREATE INDEX "RawMaterialPrice_enteredById_idx" ON "RawMaterialPrice"("enteredById");

-- CreateIndex
CREATE INDEX "PricingSlotDefault_materialId_idx" ON "PricingSlotDefault"("materialId");

-- AddForeignKey
ALTER TABLE "RawMaterial" ADD CONSTRAINT "RawMaterial_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMaterialPrice" ADD CONSTRAINT "RawMaterialPrice_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "RawMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMaterialPrice" ADD CONSTRAINT "RawMaterialPrice_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingSlotDefault" ADD CONSTRAINT "PricingSlotDefault_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "RawMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most one current price per material. Prisma cannot express a partial
-- unique index, so it lives here (like StockCount's and DocumentTemplate's);
-- `setPrice` closes the current row before inserting the next, and this
-- refuses a second open row if two writers ever slip past its lock.
CREATE UNIQUE INDEX "RawMaterialPrice_current_key"
  ON "RawMaterialPrice"("materialId") WHERE "validTo" IS NULL;

-- A price is positive, and a closed row never ends before it starts.
ALTER TABLE "RawMaterialPrice"
  ADD CONSTRAINT "RawMaterialPrice_kiloPrice_positive" CHECK ("kiloPrice" > 0),
  ADD CONSTRAINT "RawMaterialPrice_valid_range" CHECK ("validTo" IS NULL OR "validTo" >= "validFrom");

-- A paper names its supplier and its paper type; a glue has none of the
-- three paper fields.
ALTER TABLE "RawMaterial"
  ADD CONSTRAINT "RawMaterial_paper_fields" CHECK (
    "type" <> 'PAPER' OR ("supplierId" IS NOT NULL AND "paperType" IS NOT NULL)),
  ADD CONSTRAINT "RawMaterial_glue_fields" CHECK (
    "type" <> 'GLUE' OR ("supplierId" IS NULL AND "paperType" IS NULL AND "grammage" IS NULL));

-- Only glue lines have a default; the paper line is matched on the product.
ALTER TABLE "PricingSlotDefault"
  ADD CONSTRAINT "PricingSlotDefault_glue_only" CHECK ("slot" <> 'PAPER');
