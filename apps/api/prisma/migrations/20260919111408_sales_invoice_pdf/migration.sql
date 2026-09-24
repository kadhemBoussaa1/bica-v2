-- CreateEnum
CREATE TYPE "DocumentTemplateKind" AS ENUM ('SALES_INVOICE');

-- AlterTable
ALTER TABLE "SalesInvoice" ADD COLUMN     "issuedSnapshot" JSONB,
ADD COLUMN     "templateVersionId" TEXT;

-- CreateTable
CREATE TABLE "SalesInvoicePdf" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesInvoicePdf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "kind" "DocumentTemplateKind" NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "layout" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesInvoicePdf_invoiceId_locale_key" ON "SalesInvoicePdf"("invoiceId", "locale");

-- CreateIndex
CREATE INDEX "DocumentTemplate_kind_name_id_idx" ON "DocumentTemplate"("kind", "name", "id");

-- CreateIndex
CREATE INDEX "DocumentTemplateVersion_createdById_idx" ON "DocumentTemplateVersion"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplateVersion_templateId_version_key" ON "DocumentTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "SalesInvoice_templateVersionId_idx" ON "SalesInvoice"("templateVersionId");

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "DocumentTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoicePdf" ADD CONSTRAINT "SalesInvoicePdf_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SalesInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplateVersion" ADD CONSTRAINT "DocumentTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplateVersion" ADD CONSTRAINT "DocumentTemplateVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one default template per kind. Prisma cannot express a partial
-- unique index, so it lives here; `ensureDefaultSalesInvoiceVersion` relies on
-- it to settle two first issues racing to create the default.
CREATE UNIQUE INDEX "DocumentTemplate_kind_default_key" ON "DocumentTemplate"("kind") WHERE "isDefault";
