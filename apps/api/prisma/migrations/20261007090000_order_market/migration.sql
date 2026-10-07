-- Orders: which market the sale is for, local or export. Required on the
-- creation form from now on; the DEFAULT is the backfill, since every order
-- that exists today is an export order, and keeps the legacy importer
-- working unchanged.
-- CreateEnum
CREATE TYPE "OrderMarket" AS ENUM ('LOCAL', 'INTERNATIONAL');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "market" "OrderMarket" NOT NULL DEFAULT 'INTERNATIONAL';
