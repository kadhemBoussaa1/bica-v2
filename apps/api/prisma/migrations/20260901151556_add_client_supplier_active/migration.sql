-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Client_active_name_id_idx" ON "Client"("active", "name", "id");

-- CreateIndex
CREATE INDEX "Supplier_active_name_id_idx" ON "Supplier"("active", "name", "id");
