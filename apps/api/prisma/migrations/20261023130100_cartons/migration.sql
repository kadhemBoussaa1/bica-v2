-- Step C1 of the cartons addition to docs/raw-material-prices-plan.md: a
-- carton's size, a product's usual carton, and `kiloPrice` renamed `price` on
-- the catalogue and on the order lines, since a carton is priced per carton.
-- Nothing writes a carton yet.
--
-- The rename is hand-written: Prisma's diff drops the column and adds an
-- empty one, which would lose every stored price. RENAME keeps the data, and
-- the CHECKs on the column follow it; their names are updated to match.

-- RenameColumn
ALTER TABLE "RawMaterialPrice" RENAME COLUMN "kiloPrice" TO "price";
ALTER TABLE "RawMaterialPrice"
  RENAME CONSTRAINT "RawMaterialPrice_kiloPrice_positive" TO "RawMaterialPrice_price_positive";

-- RenameColumn
ALTER TABLE "OrderMaterialPrice" RENAME COLUMN "kiloPrice" TO "price";
ALTER TABLE "OrderMaterialPrice"
  RENAME CONSTRAINT "OrderMaterialPrice_kiloPrice_nonneg" TO "OrderMaterialPrice_price_nonneg";

-- AlterTable
ALTER TABLE "RawMaterial" ADD COLUMN     "lengthMm" DOUBLE PRECISION,
ADD COLUMN     "widthMm" DOUBLE PRECISION,
ADD COLUMN     "heightMm" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "cartonId" TEXT;

-- CreateIndex
CREATE INDEX "Product_cartonId_idx" ON "Product"("cartonId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_cartonId_fkey" FOREIGN KEY ("cartonId") REFERENCES "RawMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A carton names its supplier and all three dimensions, positive, and none
-- of the paper fields; nothing else has dimensions. IS NOT NULL is spelt out
-- because a CHECK passes on NULL: `NULL > 0` alone would let a carton
-- through with no size.
ALTER TABLE "RawMaterial"
  ADD CONSTRAINT "RawMaterial_box_fields" CHECK (
    "type" <> 'BOX' OR (
      "supplierId" IS NOT NULL AND "paperType" IS NULL AND "grammage" IS NULL
      AND "lengthMm" IS NOT NULL AND "widthMm" IS NOT NULL AND "heightMm" IS NOT NULL
      AND "lengthMm" > 0 AND "widthMm" > 0 AND "heightMm" > 0)),
  ADD CONSTRAINT "RawMaterial_dimensions_box_only" CHECK (
    "type" = 'BOX' OR ("lengthMm" IS NULL AND "widthMm" IS NULL AND "heightMm" IS NULL));

-- Still glue lines only: the carton line starts from the product's carton,
-- as the paper line is matched on the product.
ALTER TABLE "PricingSlotDefault" DROP CONSTRAINT "PricingSlotDefault_glue_only";
ALTER TABLE "PricingSlotDefault"
  ADD CONSTRAINT "PricingSlotDefault_glue_only" CHECK ("slot" NOT IN ('PAPER', 'CARTON'));
