-- CreateEnum
CREATE TYPE "TypeSac" AS ENUM ('FOND_V', 'FOND_CARRE', 'SOUS_PLAT');

-- CreateEnum
CREATE TYPE "PaperType" AS ENUM ('PAPIER_BLANC', 'PAPIER_KRAFT');

-- CreateEnum
CREATE TYPE "TypeImpression" AS ENUM ('IMPRESSION_SUR_ROULEAU', 'IMPRESSION_SUR_SAC');

-- CreateEnum
CREATE TYPE "DestinationCommande" AS ENUM ('CLIENT', 'STOCK');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('PREPARATION', 'EXPORTED');

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "description" TEXT,
    "productName" TEXT,
    "clientId" TEXT,
    "quantite" DOUBLE PRECISION NOT NULL,
    "longueur" DOUBLE PRECISION NOT NULL,
    "largeur" DOUBLE PRECISION NOT NULL,
    "soufflet" DOUBLE PRECISION,
    "pliEnLongueur" DOUBLE PRECISION,
    "pliEnLargeur" DOUBLE PRECISION,
    "typeSac" "TypeSac",
    "grammage" DOUBLE PRECISION,
    "paperType" "PaperType",
    "poidsPoigner" DOUBLE PRECISION,
    "prixKilo" DOUBLE PRECISION,
    "prixUnitaire" DOUBLE PRECISION,
    "prixUnitaireAvecMarge" DOUBLE PRECISION,
    "prixUnitaireAvecPerte" DOUBLE PRECISION,
    "prixUnitaireAvecMargeEtPerte" DOUBLE PRECISION,
    "prixTotal" DOUBLE PRECISION,
    "prixCarton" DOUBLE PRECISION,
    "prixTransport" DOUBLE PRECISION,
    "prixColis" DOUBLE PRECISION,
    "prixColisAvecMarge" DOUBLE PRECISION,
    "prixColisClient" DOUBLE PRECISION,
    "prixVente" DOUBLE PRECISION,
    "marge" DOUBLE PRECISION,
    "margeColis" DOUBLE PRECISION,
    "tauxPerte" DOUBLE PRECISION,
    "nbPieceColisClient" DOUBLE PRECISION,
    "nombreDePieceParColis" DOUBLE PRECISION,
    "kiloParColis" DOUBLE PRECISION,
    "colisageParKilo" BOOLEAN,
    "colle1Quantite" DOUBLE PRECISION,
    "colle1PrixTotal" DOUBLE PRECISION,
    "colle2Quantite" DOUBLE PRECISION,
    "colle2PrixTotal" DOUBLE PRECISION,
    "okFacturation" BOOLEAN,
    "okExport" BOOLEAN,
    "produitFini" BOOLEAN,
    "offreDePrix" BOOLEAN,
    "destination" "DestinationCommande",
    "exportStatus" "ExportStatus",
    "poidsNecessaire" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "poidsReserve" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "poidsConsomme" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assignedWorkerId" TEXT,
    "machineProductionId" TEXT,
    "avecImpression" BOOLEAN,
    "typeImpression" "TypeImpression",
    "impressionFinie" BOOLEAN,
    "impressionRouleauFaite" BOOLEAN,
    "nombreCouleurs" INTEGER,
    "machineImpressionId" TEXT,
    "impressionEmployeeId" TEXT,
    "images" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderColour" (
    "id" TEXT NOT NULL,
    "nom" TEXT,
    "prix" DOUBLE PRECISION,
    "orderId" TEXT NOT NULL,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderColour_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_numero_key" ON "Order"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "Order_legacyId_key" ON "Order"("legacyId");

-- CreateIndex
CREATE INDEX "Order_createdAt_id_idx" ON "Order"("createdAt", "id");

-- CreateIndex
CREATE INDEX "Order_active_numero_id_idx" ON "Order"("active", "numero", "id");

-- CreateIndex
CREATE INDEX "Order_clientId_idx" ON "Order"("clientId");

-- CreateIndex
CREATE INDEX "Order_assignedWorkerId_idx" ON "Order"("assignedWorkerId");

-- CreateIndex
CREATE INDEX "Order_machineProductionId_idx" ON "Order"("machineProductionId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderColour_legacyId_key" ON "OrderColour"("legacyId");

-- CreateIndex
CREATE INDEX "OrderColour_orderId_idx" ON "OrderColour"("orderId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_assignedWorkerId_fkey" FOREIGN KEY ("assignedWorkerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_machineProductionId_fkey" FOREIGN KEY ("machineProductionId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_machineImpressionId_fkey" FOREIGN KEY ("machineImpressionId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_impressionEmployeeId_fkey" FOREIGN KEY ("impressionEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderColour" ADD CONSTRAINT "OrderColour_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
