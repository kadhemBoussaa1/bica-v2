-- Stock and production: `ImportShipment`, `PaperRoll` and `ProductionRun`,
-- migrated from legacy `import_model` (32), `rouleau_import` (1688) and
-- `production` (942).
--
-- Purely additive — three new tables, and not one ALTER against an existing
-- one. Unlike 20260903100025_product_and_pricing_engine there is nothing to
-- park, transform or drop, so this is Prisma's own DDL verbatim: the rows are
-- loaded afterwards by `db:import:step4`, which is idempotent on `legacyId`
-- and reports anything that fails to resolve rather than casting it.
--
-- Two shapes here are deliberate and worth not "fixing" later:
--
--   * `PaperRoll` has NO unique business key. Legacy `numero` is not unique
--     (17 rolls are literally numbered "0", each a distinct reel with its own
--     weight) and `code` is a paper grade shared by many rolls — 36 distinct
--     values across 1688 rows. Identity rides on `legacyId`, as it does for
--     Client and Order.
--
--   * `PaperRoll.parentId` is a self-relation carrying the split history:
--     cutting a roll creates a child pointing at its parent, nesting up to 16
--     deep in this data (391 children, zero dangling parents). It is
--     NO ACTION rather than CASCADE so deleting a reel can never silently
--     take the remnants cut from it — those are real stock.
--
-- See docs/legacy-migration.md for the analysis behind both.


-- CreateEnum
CREATE TYPE "ProductionUnit" AS ENUM ('PIECE', 'METER');

-- CreateTable
CREATE TABLE "ImportShipment" (
    "id" TEXT NOT NULL,
    "numeroImport" TEXT NOT NULL,
    "dateImport" DATE,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "productName" TEXT,
    "totalMetrage" DOUBLE PRECISION,
    "totalRolls" INTEGER,
    "price" DOUBLE PRECISION,
    "priceTotal" DOUBLE PRECISION,
    "currency" TEXT,
    "transportIncluded" BOOLEAN,
    "transportPrice" DOUBLE PRECISION,
    "hasCertificate" BOOLEAN,
    "certificate" TEXT,
    "packingList" TEXT,
    "importFile" TEXT,
    "observations" TEXT,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperRoll" (
    "id" TEXT NOT NULL,
    "numero" TEXT,
    "numeroInterne" TEXT,
    "numeroSource" TEXT,
    "paperGrade" TEXT,
    "description" TEXT,
    "metrage" DOUBLE PRECISION,
    "metrageRestant" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "poids" DOUBLE PRECISION,
    "poidsRestant" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "poidsReserve" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "laize" DOUBLE PRECISION,
    "grammage" INTEGER,
    "paperType" "PaperType",
    "price" DOUBLE PRECISION,
    "priceWithTransport" DOUBLE PRECISION,
    "valide" BOOLEAN,
    "disponible" BOOLEAN NOT NULL DEFAULT true,
    "partiel" BOOLEAN,
    "reserved" BOOLEAN,
    "consomme" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "dateConsommation" TIMESTAMP(3),
    "consumedByNote" TEXT,
    "qrCodeUrl" TEXT,
    "parentId" TEXT,
    "importShipmentId" TEXT,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperRoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionRun" (
    "id" TEXT NOT NULL,
    "dateProduction" DATE NOT NULL,
    "quantite" DOUBLE PRECISION NOT NULL,
    "unit" "ProductionUnit",
    "goodPieces" INTEGER,
    "defectivePieces" INTEGER,
    "note" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "orderId" TEXT NOT NULL,
    "employeeId" TEXT,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportShipment_numeroImport_key" ON "ImportShipment"("numeroImport");

-- CreateIndex
CREATE UNIQUE INDEX "ImportShipment_legacyId_key" ON "ImportShipment"("legacyId");

-- CreateIndex
CREATE INDEX "ImportShipment_dateImport_id_idx" ON "ImportShipment"("dateImport", "id");

-- CreateIndex
CREATE INDEX "ImportShipment_supplierId_idx" ON "ImportShipment"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperRoll_legacyId_key" ON "PaperRoll"("legacyId");

-- CreateIndex
CREATE INDEX "PaperRoll_importShipmentId_idx" ON "PaperRoll"("importShipmentId");

-- CreateIndex
CREATE INDEX "PaperRoll_parentId_idx" ON "PaperRoll"("parentId");

-- CreateIndex
CREATE INDEX "PaperRoll_paperGrade_idx" ON "PaperRoll"("paperGrade");

-- CreateIndex
CREATE INDEX "PaperRoll_disponible_paperGrade_id_idx" ON "PaperRoll"("disponible", "paperGrade", "id");

-- CreateIndex
CREATE INDEX "PaperRoll_createdAt_id_idx" ON "PaperRoll"("createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionRun_legacyId_key" ON "ProductionRun"("legacyId");

-- CreateIndex
CREATE INDEX "ProductionRun_orderId_idx" ON "ProductionRun"("orderId");

-- CreateIndex
CREATE INDEX "ProductionRun_employeeId_idx" ON "ProductionRun"("employeeId");

-- CreateIndex
CREATE INDEX "ProductionRun_dateProduction_id_idx" ON "ProductionRun"("dateProduction", "id");

-- AddForeignKey
ALTER TABLE "ImportShipment" ADD CONSTRAINT "ImportShipment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperRoll" ADD CONSTRAINT "PaperRoll_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PaperRoll"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PaperRoll" ADD CONSTRAINT "PaperRoll_importShipmentId_fkey" FOREIGN KEY ("importShipmentId") REFERENCES "ImportShipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

