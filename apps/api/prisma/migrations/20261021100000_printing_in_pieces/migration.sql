-- AlterEnum
ALTER TYPE "MachineType" ADD VALUE 'IMPRESSION_SAC';

-- AlterTable
ALTER TABLE "ProductionRun" ADD COLUMN "piecesPrinted" INTEGER;
