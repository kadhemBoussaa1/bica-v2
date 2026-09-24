-- Which machine a production run happened on.
--
-- Reverses part of the RBAC pass that locked machines to ADMIN on the
-- reasoning that "production runs no longer name a machine" — they do again,
-- for the two stations that run one. `machine.list` reopens to the shop floor
-- in the same change; see the note left on that router block.
--
-- Purely additive, nothing to backfill:
--
--   * Nullable at the DATABASE level even though PRINTING and PRODUCER
--     require it, because QUALITY_CONTROL and PACKAGING have no machine at
--     all. A NOT NULL column would be wrong for half the stations. The
--     requirement is per-stage and lives in `createProductionRunInput`, the
--     only write path.
--
--   * All 942 migrated rows stay NULL. The legacy `machine_production_id`
--     link was dropped with the assignment model, and guessing which machine
--     ran a job in 2024 is not something a migration should do.
--
--   * ON DELETE RESTRICT, not SET NULL: a machine with recorded output must
--     not be deletable out from under its runs. Machines are archived via
--     `active`, not deleted — same rule as Order -> Product.

ALTER TABLE "ProductionRun" ADD COLUMN "machineId" TEXT;

ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_machineId_fkey"
    FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- "What has this machine produced, and when?" — the reporting query the link
-- exists to enable.
CREATE INDEX "ProductionRun_machineId_dateProduction_idx"
    ON "ProductionRun"("machineId", "dateProduction");

DO $$
DECLARE stray INT;
BEGIN
  SELECT count(*) INTO stray FROM "ProductionRun" WHERE "machineId" IS NOT NULL;
  IF stray > 0 THEN
    RAISE EXCEPTION 'Aborting: % row(s) already carry a machine on a fresh column', stray;
  END IF;
  RAISE NOTICE 'ProductionRun.machineId added (% existing run(s), all null)',
    (SELECT count(*) FROM "ProductionRun");
END $$;
