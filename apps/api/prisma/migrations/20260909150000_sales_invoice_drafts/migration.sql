-- Sales invoices raised from orders — docs/sales-invoice-plan.md §3.
--
-- Prisma's own DDL (`migrate diff`) plus two hand-written data steps that
-- the schema alone cannot express:
--   * every one of the 47 migrated invoices is a historical, issued document,
--     so `status` is backfilled to ISSUED before the DRAFT default can apply
--     to anything;
--   * the per-year counter is seeded from the legacy 2026 numbers. The 2026
--     series is `I260001, I260002, F260003 … F260021` — ONE sequence across
--     both prefixes — so the seed reads both, or a re-derivation would miss
--     the two `I` rows. Older years are not seeded: nobody issues a 2025
--     invoice today, and a new year self-seeds at 1 (§3.3).

-- CreateEnum
CREATE TYPE "SalesInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED');

-- AlterTable
ALTER TABLE "SalesInvoice" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "issuedById" TEXT,
ADD COLUMN     "status" "SalesInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "numero" DROP NOT NULL;

-- Backfill: every row that exists at this point was migrated from the legacy
-- system and is issued. Same migration as the column, so no draft can exist
-- yet by construction.
UPDATE "SalesInvoice" SET "status" = 'ISSUED';

-- AlterTable
ALTER TABLE "SalesInvoiceLine" ADD COLUMN     "orderId" TEXT;

-- CreateTable
CREATE TABLE "SalesInvoiceCounter" (
    "year" INTEGER NOT NULL,
    "next" INTEGER NOT NULL,

    CONSTRAINT "SalesInvoiceCounter_pkey" PRIMARY KEY ("year")
);

-- Seed the 2026 counter from the highest legacy number, both prefixes.
-- `max(numero)` is safe here because every match is the same width.
INSERT INTO "SalesInvoiceCounter" ("year", "next")
SELECT 26, COALESCE(MAX(SUBSTRING("numero" FROM 4)::INTEGER), 0) + 1
FROM "SalesInvoice"
WHERE "numero" ~ '^[FI]26\d{4}$';

-- CreateIndex
CREATE INDEX "SalesInvoice_status_issuedAt_id_idx" ON "SalesInvoice"("status", "issuedAt", "id");

-- CreateIndex
CREATE INDEX "SalesInvoice_createdById_idx" ON "SalesInvoice"("createdById");

-- CreateIndex
CREATE INDEX "SalesInvoice_issuedById_idx" ON "SalesInvoice"("issuedById");

-- CreateIndex
CREATE INDEX "SalesInvoiceLine_orderId_idx" ON "SalesInvoiceLine"("orderId");

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoiceLine" ADD CONSTRAINT "SalesInvoiceLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
