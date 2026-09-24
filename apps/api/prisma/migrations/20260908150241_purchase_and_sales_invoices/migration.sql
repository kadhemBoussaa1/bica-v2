-- Invoices: `PurchaseInvoice` + `PurchaseInvoiceLine` and `SalesInvoice` +
-- `SalesInvoiceLine`, migrated from legacy `facture_achat` (614) with
-- `ligne_facture_achat` (2928), `facture_vente` (47) with `ligne_facture_vente`
-- (314), and the PDF scans in `document_facturation` (686).
--
-- Purely additive — four new tables and one enum, no ALTER against an
-- existing table — so this is Prisma's own DDL verbatim, like
-- 20260903120702_stock_and_production. The rows are loaded afterwards by
-- `db:import:step5`, which upserts invoices on `legacyId`, replaces their
-- lines wholesale, and unions their documents.
--
-- Deliberately not carried from the legacy tables (see the model comments):
--   * `brouillon` — TRUE on every one of the 661 invoices, so it says nothing.
--   * `exonere`   — NULL on every row.
--   * `echeance_facture` and `affectation_ligne_facture` — both empty, so
--     there is no invoice-to-order link to migrate yet.
--
-- See docs/legacy-migration.md for the analysis.

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('VIREMENT', 'CHEQUE', 'ESPECES');

-- CreateTable
CREATE TABLE "PurchaseInvoice" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "issuedAt" DATE,
    "dueAt" DATE,
    "paidAt" DATE,
    "paymentMethod" "PaymentMethod",
    "category" TEXT,
    "forProduction" BOOLEAN,
    "supplierId" TEXT NOT NULL,
    "totalHt" DOUBLE PRECISION,
    "vatAmount" DOUBLE PRECISION,
    "totalTtc" DOUBLE PRECISION,
    "withholdingTax" DOUBLE PRECISION,
    "netPayable" DOUBLE PRECISION,
    "currency" TEXT,
    "exchangeRate" DOUBLE PRECISION,
    "legacyReceiptType" TEXT,
    "legacyReceiptId" BIGINT,
    "documents" TEXT[],
    "legacyId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseInvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "product" TEXT,
    "description" TEXT,
    "quantity" DOUBLE PRECISION,
    "unitPrice" DOUBLE PRECISION,
    "discountPct" DOUBLE PRECISION,
    "taxPct" DOUBLE PRECISION,
    "total" DOUBLE PRECISION,
    "legacyId" BIGINT,

    CONSTRAINT "PurchaseInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesInvoice" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "issuedAt" DATE,
    "dueAt" DATE,
    "paidAt" DATE,
    "paymentMethod" "PaymentMethod",
    "category" TEXT,
    "clientId" TEXT,
    "totalHt" DOUBLE PRECISION,
    "vatAmount" DOUBLE PRECISION,
    "totalTtc" DOUBLE PRECISION,
    "currency" TEXT,
    "documents" TEXT[],
    "legacyId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesInvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "product" TEXT,
    "description" TEXT,
    "quantity" DOUBLE PRECISION,
    "unitPrice" DOUBLE PRECISION,
    "discountPct" DOUBLE PRECISION,
    "taxPct" DOUBLE PRECISION,
    "total" DOUBLE PRECISION,
    "legacyId" BIGINT,

    CONSTRAINT "SalesInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseInvoice_numero_key" ON "PurchaseInvoice"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseInvoice_legacyId_key" ON "PurchaseInvoice"("legacyId");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_issuedAt_id_idx" ON "PurchaseInvoice"("issuedAt", "id");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_dueAt_id_idx" ON "PurchaseInvoice"("dueAt", "id");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_totalTtc_id_idx" ON "PurchaseInvoice"("totalTtc", "id");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_supplierId_idx" ON "PurchaseInvoice"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_paidAt_dueAt_idx" ON "PurchaseInvoice"("paidAt", "dueAt");

-- CreateIndex
CREATE INDEX "PurchaseInvoiceLine_invoiceId_position_idx" ON "PurchaseInvoiceLine"("invoiceId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SalesInvoice_numero_key" ON "SalesInvoice"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "SalesInvoice_legacyId_key" ON "SalesInvoice"("legacyId");

-- CreateIndex
CREATE INDEX "SalesInvoice_issuedAt_id_idx" ON "SalesInvoice"("issuedAt", "id");

-- CreateIndex
CREATE INDEX "SalesInvoice_dueAt_id_idx" ON "SalesInvoice"("dueAt", "id");

-- CreateIndex
CREATE INDEX "SalesInvoice_totalTtc_id_idx" ON "SalesInvoice"("totalTtc", "id");

-- CreateIndex
CREATE INDEX "SalesInvoice_clientId_idx" ON "SalesInvoice"("clientId");

-- CreateIndex
CREATE INDEX "SalesInvoice_paidAt_dueAt_idx" ON "SalesInvoice"("paidAt", "dueAt");

-- CreateIndex
CREATE INDEX "SalesInvoiceLine_invoiceId_position_idx" ON "SalesInvoiceLine"("invoiceId", "position");

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoiceLine" ADD CONSTRAINT "PurchaseInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoiceLine" ADD CONSTRAINT "SalesInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SalesInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
