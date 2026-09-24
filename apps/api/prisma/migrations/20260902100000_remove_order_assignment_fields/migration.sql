-- Remove the order assignment and printing-progress fields.
--
-- Under the current RBAC the production team records its own work, rather than
-- an order naming who must do it and on which machine. These columns encoded
-- that older model.
--
-- Written by hand because `prisma migrate dev` needs an interactive prompt to
-- confirm the data loss, and this environment has no TTY. The statements are
-- exactly what `prisma migrate diff` produced.
--
-- Data dropped, all of it still present in the legacy database:
--   assignedWorkerId        65 non-null
--   machineProductionId     64 non-null
--   machineImpressionId     32 non-null
--   impressionEmployeeId    14 non-null
--   avecImpression         391 non-null
--   impressionFinie        267 non-null
--   impressionRouleauFaite 267 non-null
--
-- Kept: `typeImpression` (144), `nombreCouleurs` (397) and all 522 OrderColour
-- rows — what the print job IS, rather than who does it or whether it is done.

-- A fourth bag type, added to the schema alongside this change.
ALTER TYPE "TypeSac" ADD VALUE IF NOT EXISTS 'SAC_LUXE';

ALTER TABLE "Order" DROP CONSTRAINT "Order_assignedWorkerId_fkey";
ALTER TABLE "Order" DROP CONSTRAINT "Order_impressionEmployeeId_fkey";
ALTER TABLE "Order" DROP CONSTRAINT "Order_machineImpressionId_fkey";
ALTER TABLE "Order" DROP CONSTRAINT "Order_machineProductionId_fkey";

DROP INDEX "Order_assignedWorkerId_idx";
DROP INDEX "Order_machineProductionId_idx";

ALTER TABLE "Order"
    DROP COLUMN "assignedWorkerId",
    DROP COLUMN "avecImpression",
    DROP COLUMN "impressionEmployeeId",
    DROP COLUMN "impressionFinie",
    DROP COLUMN "impressionRouleauFaite",
    DROP COLUMN "machineImpressionId",
    DROP COLUMN "machineProductionId";
