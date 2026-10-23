-- Drops the QUALITY_CONTROL workshop station and its one measure,
-- `piecesControlled`. The production manager judged the station unnecessary
-- (2026-10-23), and it holds no runs in the old app or in this one.
--
-- Postgres cannot drop a value from an enum, so the type is rebuilt without
-- it — the swap Prisma generates. The guard comes first, inside the same
-- transaction: a QUALITY_CONTROL run would fail the cast, and a stray
-- `piecesControlled` would be lost with the column, so either one aborts the
-- migration with nothing changed. Re-record such a run under another station
-- (or delete it) and deploy again.

BEGIN;

DO $$
DECLARE runs INT; figures INT;
BEGIN
  SELECT count(*) INTO runs FROM "ProductionRun" WHERE "stage" = 'QUALITY_CONTROL';
  SELECT count(*) INTO figures FROM "ProductionRun" WHERE "piecesControlled" IS NOT NULL;
  IF runs > 0 OR figures > 0 THEN
    RAISE EXCEPTION
      'Aborting: % quality-control run(s) and % row(s) with piecesControlled would be lost',
      runs, figures;
  END IF;
END $$;

-- AlterEnum
CREATE TYPE "WorkshopStage_new" AS ENUM ('PRINTING', 'PRODUCER', 'PACKAGING');
ALTER TABLE "public"."ProductionRun" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "ProductionRun" ALTER COLUMN "stage" TYPE "WorkshopStage_new" USING ("stage"::text::"WorkshopStage_new");
ALTER TYPE "WorkshopStage" RENAME TO "WorkshopStage_old";
ALTER TYPE "WorkshopStage_new" RENAME TO "WorkshopStage";
DROP TYPE "public"."WorkshopStage_old";
ALTER TABLE "ProductionRun" ALTER COLUMN "stage" SET DEFAULT 'PRODUCER';

-- AlterTable
ALTER TABLE "ProductionRun" DROP COLUMN "piecesControlled";

COMMIT;
