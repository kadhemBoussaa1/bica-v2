-- CreateEnum
CREATE TYPE "MachineType" AS ENUM ('SAC_POIGNE_TORSADE', 'SAC_POIGNE_PLATE', 'SAC_V', 'IMPRESSION', 'CORDON', 'COUPE', 'COUPE_SOUS_PLAT', 'SAC_LUXE');

-- CreateTable
CREATE TABLE "Machine" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "MachineType" NOT NULL,
    "brand" TEXT,
    "price" DOUBLE PRECISION,
    "purchaseDate" DATE,
    "imageUrl" TEXT,
    "invoiceUrl" TEXT,
    "supplierId" TEXT,
    "laize" DOUBLE PRECISION,
    "laizeMin" DOUBLE PRECISION,
    "laizeMax" DOUBLE PRECISION,
    "grammage" DOUBLE PRECISION,
    "grammageMin" DOUBLE PRECISION,
    "grammageMax" DOUBLE PRECISION,
    "grammageMinWithoutHandle" DOUBLE PRECISION,
    "grammageMaxWithoutHandle" DOUBLE PRECISION,
    "grammageMinWithHandle" DOUBLE PRECISION,
    "grammageMaxWithHandle" DOUBLE PRECISION,
    "grammageMinKraft" DOUBLE PRECISION,
    "grammageMaxKraft" DOUBLE PRECISION,
    "grammageMinLaminatedKraft" DOUBLE PRECISION,
    "grammageMaxLaminatedKraft" DOUBLE PRECISION,
    "lengthMin" DOUBLE PRECISION,
    "lengthMax" DOUBLE PRECISION,
    "widthMin" DOUBLE PRECISION,
    "widthMax" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "matricule" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "department" TEXT,
    "jobTitle" TEXT,
    "employmentType" TEXT,
    "categorie" TEXT,
    "echelon" TEXT,
    "gender" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "phone2" TEXT,
    "hireDate" DATE,
    "contractEndDate" DATE,
    "photo" TEXT,
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "suspendedAt" DATE,
    "suspensionReason" TEXT,
    "salary" DOUBLE PRECISION,
    "salaryGross" DOUBLE PRECISION,
    "cin" TEXT,
    "socialSecurityNumber" TEXT,
    "birthDate" DATE,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Machine_code_key" ON "Machine"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Machine_name_key" ON "Machine"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Machine_legacyId_key" ON "Machine"("legacyId");

-- CreateIndex
CREATE INDEX "Machine_createdAt_id_idx" ON "Machine"("createdAt", "id");

-- CreateIndex
CREATE INDEX "Machine_active_name_id_idx" ON "Machine"("active", "name", "id");

-- CreateIndex
CREATE INDEX "Machine_type_idx" ON "Machine"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_matricule_key" ON "Employee"("matricule");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_legacyId_key" ON "Employee"("legacyId");

-- CreateIndex
CREATE INDEX "Employee_createdAt_id_idx" ON "Employee"("createdAt", "id");

-- CreateIndex
CREATE INDEX "Employee_active_lastName_id_idx" ON "Employee"("active", "lastName", "id");

-- CreateIndex
CREATE INDEX "Employee_department_idx" ON "Employee"("department");

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
