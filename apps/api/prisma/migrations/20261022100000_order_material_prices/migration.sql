-- Each order's own copy of the paper and glue kilo prices it was calculated
-- with, one row per slot — step 5 of docs/raw-material-prices-plan.md. The
-- four Order columns are copied here verbatim and dropped by the next
-- migration, so every figure is unchanged.
-- CreateTable
CREATE TABLE "OrderMaterialPrice" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "slot" "PricingSlot" NOT NULL,
    "materialId" TEXT,
    "label" TEXT,
    "supplierName" TEXT,
    "kiloPrice" DOUBLE PRECISION NOT NULL,
    "sourcePriceId" TEXT,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderMaterialPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderMaterialPrice_materialId_idx" ON "OrderMaterialPrice"("materialId");

-- CreateIndex
CREATE INDEX "OrderMaterialPrice_sourcePriceId_idx" ON "OrderMaterialPrice"("sourcePriceId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderMaterialPrice_orderId_slot_key" ON "OrderMaterialPrice"("orderId", "slot");

-- AddForeignKey
ALTER TABLE "OrderMaterialPrice" ADD CONSTRAINT "OrderMaterialPrice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMaterialPrice" ADD CONSTRAINT "OrderMaterialPrice_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "RawMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMaterialPrice" ADD CONSTRAINT "OrderMaterialPrice_sourcePriceId_fkey" FOREIGN KEY ("sourcePriceId") REFERENCES "RawMaterialPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A line names a material exactly when it carries its label; a carried-over
-- line has neither. A price may be 0: the legacy data holds 195 of them,
-- which the engine already reads as "not priced".
ALTER TABLE "OrderMaterialPrice"
  ADD CONSTRAINT "OrderMaterialPrice_label_iff_material" CHECK (("materialId" IS NULL) = ("label" IS NULL)),
  ADD CONSTRAINT "OrderMaterialPrice_kiloPrice_nonneg" CHECK ("kiloPrice" >= 0);

-- Existing documents (plan decision 7): every non-null kilo price becomes a
-- line with no material and no source price, `manual` false. Ids are
-- random UUIDs rather than cuids: the column is text and only unique.
INSERT INTO "OrderMaterialPrice" ("id", "orderId", "slot", "kiloPrice", "manual", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o."id", s."slot"::"PricingSlot", s."price", false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Order" o
CROSS JOIN LATERAL (VALUES
  ('PAPER', o."paperKiloPrice"),
  ('HANDLE_GLUE', o."handleGlueKiloPrice"),
  ('SIDE_GLUE', o."sideGlueKiloPrice"),
  ('BASE_ADHESIVE', o."baseAdhesiveKiloPrice")
) AS s("slot", "price")
WHERE s."price" IS NOT NULL;
