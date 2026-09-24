-- Workshop stages on ProductionRun: one run now says WHICH station recorded
-- it, and carries that station's own measures.
--
-- The four stations — printing, producer, quality control, packaging — are a
-- SECOND AXIS, deliberately not values of `Role`. `Role` is a rank and the
-- whole RBAC is built on it being strictly ordered; these four are peers (a
-- printer does not outrank a packer), so folding them in would force a
-- meaningless rank onto each. Same two-axes-in-one-enum mistake the four
-- workflow booleans made — see docs/order-lifecycle-plan.md §1.1(f).
--
-- Purely additive. Unlike 20260907125517_order_lifecycle there is nothing to
-- park or transform: every existing row is a producer run, which the column
-- default states directly rather than needing a backfill UPDATE.
--
--   * `stage` DEFAULT 'PRODUCER' labels all 942 migrated rows correctly. The
--     legacy system had no notion of stations and every row is shop output.
--
--   * `quantite`/`unit` are NOT touched. All 942 rows use them and the new
--     per-stage columns are for new runs; rewriting the legacy figures into
--     stage columns would invent a precision the old data never had.
--
--   * The per-stage measures are nullable by necessity — each stage fills
--     its own subset. The invariant "a PRINTING row has no parcelsClosed" is
--     enforced by `createProductionRunInput`, a Zod discriminated union on
--     `stage`, which is the only write path. No CHECK constraint: it would
--     need one per stage and the union already refuses the input.

-- ============================================================================
-- 1. the station enum
-- ============================================================================

CREATE TYPE "WorkshopStage" AS ENUM ('PRINTING', 'PRODUCER', 'QUALITY_CONTROL', 'PACKAGING');

-- ============================================================================
-- 2. stage + the per-stage measures
--
--    goodPieces / defectivePieces already exist and are REUSED by the
--    PRODUCER stage rather than duplicated. They are populated on just 2 of
--    942 rows, and on both the parts sum to LESS than `quantite`
--    (9100+1416 = 10516 of 11500; 12250+1710 = 13960 of 14200) — so nothing
--    here enforces that the breakdown adds up to the total. It does not, in
--    the only real data there is.
-- ============================================================================

ALTER TABLE "ProductionRun" ADD COLUMN "stage" "WorkshopStage" NOT NULL DEFAULT 'PRODUCER';

ALTER TABLE "ProductionRun" ADD COLUMN "metersPrinted" DOUBLE PRECISION;
ALTER TABLE "ProductionRun" ADD COLUMN "piecesProduced" INTEGER;
ALTER TABLE "ProductionRun" ADD COLUMN "wastePieces" INTEGER;
ALTER TABLE "ProductionRun" ADD COLUMN "piecesToFix" INTEGER;
ALTER TABLE "ProductionRun" ADD COLUMN "piecesControlled" INTEGER;
ALTER TABLE "ProductionRun" ADD COLUMN "parcelsClosed" INTEGER;

-- ============================================================================
-- 3. who entered the run, from the session.
--
--    Distinct from the existing `employeeId`, which is historic: it named a
--    worker the legacy row happened to record (null on 899 of 942) under an
--    assignment model that no longer exists. `recordedById` is the account
--    that typed it in, which is the one the app can actually vouch for.
--    SetNull so the record survives a deleted user, matching
--    `Order.acceptedBy` and `OrderStatusChange.by`.
--
--    Null on every migrated row: nobody entered them.
-- ============================================================================

ALTER TABLE "ProductionRun" ADD COLUMN "recordedById" TEXT;

ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- 4. indexes
--
--    (orderId, stage) serves the IN_PRODUCTION -> PRODUCED guard, which asks
--    "does this order have a PACKAGING run?" on every attempt, and the
--    production list's stage facets.
-- ============================================================================

CREATE INDEX "ProductionRun_orderId_stage_idx" ON "ProductionRun"("orderId", "stage");
CREATE INDEX "ProductionRun_recordedById_idx" ON "ProductionRun"("recordedById");

-- ============================================================================
-- 5. verify: every existing row landed on PRODUCER and nothing else moved.
--    Cheap, and it makes the "all 942 are producer runs" claim above an
--    executable precondition rather than a comment.
-- ============================================================================

DO $$
DECLARE total INT; producers INT; stray INT;
BEGIN
  SELECT count(*) INTO total FROM "ProductionRun";
  SELECT count(*) INTO producers FROM "ProductionRun" WHERE "stage" = 'PRODUCER';
  IF producers <> total THEN
    RAISE EXCEPTION 'Aborting: % of % production run(s) are not PRODUCER after the default',
      total - producers, total;
  END IF;

  SELECT count(*) INTO stray FROM "ProductionRun"
   WHERE "metersPrinted" IS NOT NULL OR "piecesProduced" IS NOT NULL
      OR "wastePieces" IS NOT NULL OR "piecesToFix" IS NOT NULL
      OR "piecesControlled" IS NOT NULL OR "parcelsClosed" IS NOT NULL
      OR "recordedById" IS NOT NULL;
  IF stray > 0 THEN
    RAISE EXCEPTION 'Aborting: % row(s) already carry a per-stage value on a fresh column', stray;
  END IF;

  RAISE NOTICE 'Workshop stages added: % run(s), all PRODUCER', total;
END $$;
