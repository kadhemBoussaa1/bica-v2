-- Manufacturing orders (ordres de fabrication, OF) — docs/manufacturing-orders-plan.md.
-- One OF per order, an ordered pipeline of actions worked one after the other,
-- and reusable templates the actions are copied from. Additive: seven new
-- tables and two enums, no existing column changes.
-- CreateEnum
CREATE TYPE "ManufacturingOrderStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ManufacturingActionStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'DONE', 'SKIPPED');

-- CreateTable
CREATE TABLE "ManufacturingTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "legacyId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManufacturingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManufacturingTemplateAction" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "handlesEmployees" BOOLEAN NOT NULL DEFAULT false,
    "handlesMachine" BOOLEAN NOT NULL DEFAULT false,
    "handlesAttachments" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ManufacturingTemplateAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManufacturingOrder" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "ManufacturingOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledById" TEXT,
    "legacyNumero" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManufacturingOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManufacturingAction" (
    "id" TEXT NOT NULL,
    "manufacturingOrderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "handlesEmployees" BOOLEAN NOT NULL DEFAULT false,
    "handlesMachine" BOOLEAN NOT NULL DEFAULT false,
    "handlesAttachments" BOOLEAN NOT NULL DEFAULT false,
    "status" "ManufacturingActionStatus" NOT NULL DEFAULT 'WAITING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "machineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManufacturingAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManufacturingActionAssignee" (
    "actionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,

    CONSTRAINT "ManufacturingActionAssignee_pkey" PRIMARY KEY ("actionId","employeeId")
);

-- CreateTable
CREATE TABLE "ManufacturingActionAttachment" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "size" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManufacturingActionAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManufacturingActionComment" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManufacturingActionComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManufacturingTemplate_legacyId_key" ON "ManufacturingTemplate"("legacyId");

-- CreateIndex
CREATE INDEX "ManufacturingTemplate_active_name_id_idx" ON "ManufacturingTemplate"("active", "name", "id");

-- CreateIndex
CREATE INDEX "ManufacturingTemplateAction_templateId_position_idx" ON "ManufacturingTemplateAction"("templateId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ManufacturingOrder_numero_key" ON "ManufacturingOrder"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "ManufacturingOrder_orderId_key" ON "ManufacturingOrder"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "ManufacturingOrder_legacyNumero_key" ON "ManufacturingOrder"("legacyNumero");

-- CreateIndex
CREATE INDEX "ManufacturingOrder_createdAt_id_idx" ON "ManufacturingOrder"("createdAt", "id");

-- CreateIndex
CREATE INDEX "ManufacturingOrder_cancelledById_idx" ON "ManufacturingOrder"("cancelledById");

-- CreateIndex
CREATE INDEX "ManufacturingOrder_createdById_idx" ON "ManufacturingOrder"("createdById");

-- CreateIndex
CREATE INDEX "ManufacturingAction_manufacturingOrderId_position_idx" ON "ManufacturingAction"("manufacturingOrderId", "position");

-- CreateIndex
CREATE INDEX "ManufacturingAction_machineId_idx" ON "ManufacturingAction"("machineId");

-- CreateIndex
CREATE INDEX "ManufacturingActionAssignee_employeeId_idx" ON "ManufacturingActionAssignee"("employeeId");

-- CreateIndex
CREATE INDEX "ManufacturingActionAttachment_actionId_id_idx" ON "ManufacturingActionAttachment"("actionId", "id");

-- CreateIndex
CREATE INDEX "ManufacturingActionComment_actionId_createdAt_idx" ON "ManufacturingActionComment"("actionId", "createdAt");

-- CreateIndex
CREATE INDEX "ManufacturingActionComment_authorId_idx" ON "ManufacturingActionComment"("authorId");

-- AddForeignKey
ALTER TABLE "ManufacturingTemplateAction" ADD CONSTRAINT "ManufacturingTemplateAction_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ManufacturingTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingOrder" ADD CONSTRAINT "ManufacturingOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingOrder" ADD CONSTRAINT "ManufacturingOrder_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingOrder" ADD CONSTRAINT "ManufacturingOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingAction" ADD CONSTRAINT "ManufacturingAction_manufacturingOrderId_fkey" FOREIGN KEY ("manufacturingOrderId") REFERENCES "ManufacturingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingAction" ADD CONSTRAINT "ManufacturingAction_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingActionAssignee" ADD CONSTRAINT "ManufacturingActionAssignee_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "ManufacturingAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingActionAssignee" ADD CONSTRAINT "ManufacturingActionAssignee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingActionAttachment" ADD CONSTRAINT "ManufacturingActionAttachment_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "ManufacturingAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingActionComment" ADD CONSTRAINT "ManufacturingActionComment_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "ManufacturingAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingActionComment" ADD CONSTRAINT "ManufacturingActionComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

