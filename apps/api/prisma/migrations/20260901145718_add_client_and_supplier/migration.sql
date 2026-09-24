-- CreateEnum
CREATE TYPE "SupplierFamily" AS ENUM ('ACCESSOIRE', 'SERVICE', 'CHIMIQUE', 'TRANSPORT', 'PAPIER', 'ENCRE', 'HYGIENE', 'FOURNITURE');

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "address" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "imageUrl" TEXT,
    "registeredAt" DATE,
    "legacyCreatedBy" TEXT,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "address" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "phone2" TEXT,
    "fax" TEXT,
    "website" TEXT,
    "family" "SupplierFamily",
    "vatRate" DOUBLE PRECISION,
    "vatRateNote" TEXT,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Client_name_key" ON "Client"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Client_legacyId_key" ON "Client"("legacyId");

-- CreateIndex
CREATE INDEX "Client_createdAt_id_idx" ON "Client"("createdAt", "id");

-- CreateIndex
CREATE INDEX "Client_name_id_idx" ON "Client"("name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_legacyId_key" ON "Supplier"("legacyId");

-- CreateIndex
CREATE INDEX "Supplier_createdAt_id_idx" ON "Supplier"("createdAt", "id");

-- CreateIndex
CREATE INDEX "Supplier_name_id_idx" ON "Supplier"("name", "id");

-- CreateIndex
CREATE INDEX "Supplier_family_idx" ON "Supplier"("family");
