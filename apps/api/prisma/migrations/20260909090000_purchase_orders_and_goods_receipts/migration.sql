
-- CreateEnum
CREATE TYPE "PurchaseCategory" AS ENUM ('PAPER', 'INK', 'PLATE', 'GLUE', 'BOXES', 'PALLETS', 'STRETCH_FILM', 'TRANSPORT', 'MISC');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('PENDING', 'PARTIAL', 'COMPLETE');

-- CreateEnum
CREATE TYPE "StretchFilmType" AS ENUM ('STRETCH_FILM', 'THERMO_PVC_STRETCH_FILM');

-- AlterTable
ALTER TABLE "PurchaseInvoice" ADD COLUMN     "receiptId" TEXT;

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "category" "PurchaseCategory" NOT NULL,
    "issuedAt" DATE NOT NULL,
    "expectedAt" DATE,
    "supplierId" TEXT NOT NULL,
    "totalHt" DOUBLE PRECISION,
    "totalQuantity" DOUBLE PRECISION,
    "currency" TEXT NOT NULL,
    "address" TEXT,
    "notes" TEXT,
    "createdByName" TEXT,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "designation" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "grammage" DOUBLE PRECISION,
    "laize" DOUBLE PRECISION,
    "length" DOUBLE PRECISION,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "thickness" DOUBLE PRECISION,
    "filmType" "StretchFilmType",
    "colourCount" INTEGER,
    "unitSurface" DOUBLE PRECISION,
    "legacyId" BIGINT,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "category" "PurchaseCategory" NOT NULL,
    "orderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "issuedAt" DATE NOT NULL,
    "receivedAt" DATE,
    "status" "ReceiptStatus",
    "validated" BOOLEAN NOT NULL DEFAULT false,
    "receivedQuantity" DOUBLE PRECISION,
    "invoiceNumber" TEXT,
    "invoiceUrl" TEXT,
    "notes" TEXT,
    "updatedByName" TEXT,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "orderLineId" TEXT,
    "position" INTEGER NOT NULL,
    "designation" TEXT NOT NULL,
    "receivedQuantity" DOUBLE PRECISION,
    "unitPrice" DOUBLE PRECISION,
    "grammage" DOUBLE PRECISION,
    "laize" DOUBLE PRECISION,
    "length" DOUBLE PRECISION,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "thickness" DOUBLE PRECISION,
    "filmType" "StretchFilmType",
    "colourCount" INTEGER,
    "notes" TEXT,
    "legacyId" BIGINT,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_numero_key" ON "PurchaseOrder"("numero");

-- CreateIndex
CREATE INDEX "PurchaseOrder_issuedAt_id_idx" ON "PurchaseOrder"("issuedAt", "id");

-- CreateIndex
CREATE INDEX "PurchaseOrder_expectedAt_id_idx" ON "PurchaseOrder"("expectedAt", "id");

-- CreateIndex
CREATE INDEX "PurchaseOrder_totalHt_id_idx" ON "PurchaseOrder"("totalHt", "id");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_category_issuedAt_id_idx" ON "PurchaseOrder"("category", "issuedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_category_legacyId_key" ON "PurchaseOrder"("category", "legacyId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_orderId_position_idx" ON "PurchaseOrderLine"("orderId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_numero_key" ON "GoodsReceipt"("numero");

-- CreateIndex
CREATE INDEX "GoodsReceipt_issuedAt_id_idx" ON "GoodsReceipt"("issuedAt", "id");

-- CreateIndex
CREATE INDEX "GoodsReceipt_receivedAt_id_idx" ON "GoodsReceipt"("receivedAt", "id");

-- CreateIndex
CREATE INDEX "GoodsReceipt_supplierId_idx" ON "GoodsReceipt"("supplierId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_orderId_idx" ON "GoodsReceipt"("orderId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_category_issuedAt_id_idx" ON "GoodsReceipt"("category", "issuedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_category_legacyId_key" ON "GoodsReceipt"("category", "legacyId");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_receiptId_position_idx" ON "GoodsReceiptLine"("receiptId", "position");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_orderLineId_idx" ON "GoodsReceiptLine"("orderLineId");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_receiptId_idx" ON "PurchaseInvoice"("receiptId");

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

