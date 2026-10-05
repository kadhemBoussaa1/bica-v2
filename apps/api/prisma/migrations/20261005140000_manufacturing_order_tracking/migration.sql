-- Manufacturing orders: what the v3 screens show beside the pipeline
-- ("Ordres de fabrication v3.dc.html") — the template an OF was opened from,
-- whether its pipeline was adapted since, and when it last saw activity.
-- Additive. The backfill at the end dates the OFs already loaded by
-- `import-pipeline.ts` from their own actions and comments, so an old OF
-- does not read as touched today.
-- AlterTable
ALTER TABLE "ManufacturingOrder" ADD COLUMN     "adapted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "templateId" TEXT;

-- CreateIndex
CREATE INDEX "ManufacturingOrder_templateId_idx" ON "ManufacturingOrder"("templateId");

-- AddForeignKey
ALTER TABLE "ManufacturingOrder" ADD CONSTRAINT "ManufacturingOrder_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ManufacturingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: the latest date found on the OF itself, its actions and their
-- comments. `updatedAt` is left out: on imported rows it is the import time.
UPDATE "ManufacturingOrder" AS m
SET "lastActivityAt" = GREATEST(
  m."createdAt",
  COALESCE((
    SELECT MAX(GREATEST(a."createdAt", COALESCE(a."startedAt", a."createdAt"), COALESCE(a."completedAt", a."createdAt")))
    FROM "ManufacturingAction" a
    WHERE a."manufacturingOrderId" = m."id"
  ), m."createdAt"),
  COALESCE((
    SELECT MAX(c."createdAt")
    FROM "ManufacturingActionComment" c
    JOIN "ManufacturingAction" a ON a."id" = c."actionId"
    WHERE a."manufacturingOrderId" = m."id"
  ), m."createdAt")
);
