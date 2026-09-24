-- Outbound shipments (exports) — docs/export-plan.md Step 1.
--
-- Prisma's own DDL (`migrate diff`), purely additive: two enums, the
-- Shipment / ShipmentLine tables, the per-year ShipmentCounter and the
-- foreign keys back to Client, SalesInvoice, Order and User. Nothing is
-- backfilled: the legacy export tables are empty, so no row exists yet.


-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('DRAFT', 'SHIPPED');

-- CreateEnum
CREATE TYPE "ShipmentKind" AS ENUM ('COMPLETE', 'PARTIAL');

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "numero" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'DRAFT',
    "kind" "ShipmentKind" NOT NULL DEFAULT 'COMPLETE',
    "exportDate" DATE,
    "clientId" TEXT NOT NULL,
    "salesInvoiceId" TEXT,
    "packingListNumber" TEXT,
    "packingListDocument" TEXT,
    "customsDeclarationNumber" TEXT,
    "customsDeclarationDate" DATE,
    "customsDeclarationDocument" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "shippedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentLine" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "orderId" TEXT,
    "description" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "units" DOUBLE PRECISION,

    CONSTRAINT "ShipmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentCounter" (
    "year" INTEGER NOT NULL,
    "next" INTEGER NOT NULL,

    CONSTRAINT "ShipmentCounter_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_numero_key" ON "Shipment"("numero");

-- CreateIndex
CREATE INDEX "Shipment_status_exportDate_id_idx" ON "Shipment"("status", "exportDate", "id");

-- CreateIndex
CREATE INDEX "Shipment_exportDate_id_idx" ON "Shipment"("exportDate", "id");

-- CreateIndex
CREATE INDEX "Shipment_createdAt_id_idx" ON "Shipment"("createdAt", "id");

-- CreateIndex
CREATE INDEX "Shipment_clientId_idx" ON "Shipment"("clientId");

-- CreateIndex
CREATE INDEX "Shipment_salesInvoiceId_idx" ON "Shipment"("salesInvoiceId");

-- CreateIndex
CREATE INDEX "Shipment_createdById_idx" ON "Shipment"("createdById");

-- CreateIndex
CREATE INDEX "Shipment_shippedById_idx" ON "Shipment"("shippedById");

-- CreateIndex
CREATE INDEX "ShipmentLine_shipmentId_position_idx" ON "ShipmentLine"("shipmentId", "position");

-- CreateIndex
CREATE INDEX "ShipmentLine_orderId_idx" ON "ShipmentLine"("orderId");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "SalesInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_shippedById_fkey" FOREIGN KEY ("shippedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

