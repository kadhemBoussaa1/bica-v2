-- CreateEnum
CREATE TYPE "ProductMention" AS ENUM ('FSC', 'PEFC');

-- AlterTable
ALTER TABLE "SalesInvoiceLine" ADD COLUMN     "mention" "ProductMention";

-- AlterTable
ALTER TABLE "ShipmentLine" ADD COLUMN     "mention" "ProductMention";
