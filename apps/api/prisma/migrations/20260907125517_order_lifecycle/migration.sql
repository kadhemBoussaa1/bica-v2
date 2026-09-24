-- Order lifecycle, steps 1-2 of docs/order-lifecycle-plan.md §6: adds `kind`,
-- `status`, `acceptedAt`/`acceptedById` and `OrderStatusChange`, backfills
-- every row per the plan's §4 mapping, and verifies the result with
-- RAISE EXCEPTION guards -- same shape as
-- 20260903100025_product_and_pricing_engine: add nullable -> backfill ->
-- verify -> tighten, all inside the one transaction `prisma migrate deploy`
-- wraps this file in.
--
-- Deliberately NOT step 5: the four legacy workflow booleans
-- (okFacturation/okExport/produitFini/offreDePrix) are untouched here and
-- stay live, written by both `OrderService` and the legacy importer. Per the
-- plan's §6 reversibility note, dropping them is its own later migration,
-- run only once steps 3-4 (moving reads and writes over) have soaked.
--
-- The backfill mapping (plan §4), evaluated top to bottom as written -- NOT
-- as independent predicates, because the 96 historic skip-state orders
-- (exported without ever being produitFini) must land in the `okExport`
-- clause rather than falling through to `produitFini` or "everything else":
--
--   1. offreDePrix = true                          -> QUOTE,  DRAFT      (17)
--   2. okExport = true                              -> ORDER,  COMPLETED  (218)
--   3. okFacturation = true, okExport not true       -> ORDER,  INVOICED   (0, by measurement)
--   4. produitFini = true, neither ok-flag           -> ORDER,  PRODUCED   (129)
--   5. everything else                               -> ORDER,  DRAFT      (33)
--
-- Every one of the 397 measured rows lands in exactly one bucket; the counts
-- above are asserted below rather than merely commented.

-- ============================================================================
-- 1. new enums
-- ============================================================================

CREATE TYPE "OrderKind" AS ENUM ('QUOTE', 'ORDER');
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'IN_PRODUCTION', 'PRODUCED', 'INVOICEABLE', 'INVOICED', 'READY_FOR_EXPORT', 'COMPLETED', 'CANCELLED');

-- ============================================================================
-- 2. add kind/status nullable, no default -- so every existing row is
--    visibly unset until the backfill below runs, rather than silently
--    defaulting to ORDER/DRAFT and hiding a backfill bug. Tightened to
--    NOT NULL + DEFAULT in step 5 below, once the backfill is verified.
-- ============================================================================

ALTER TABLE "Order" ADD COLUMN "kind" "OrderKind";
ALTER TABLE "Order" ADD COLUMN "status" "OrderStatus";

ALTER TABLE "Order" ADD COLUMN "acceptedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "acceptedById" TEXT;

-- ============================================================================
-- 3. OrderStatusChange, the transition log. Created before the backfill
--    below writes to it -- one row per order, recording the mapped bucket.
-- ============================================================================

CREATE TABLE "OrderStatusChange" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "byUserId" TEXT,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderStatusChange_orderId_at_idx" ON "OrderStatusChange"("orderId", "at");

ALTER TABLE "OrderStatusChange" ADD CONSTRAINT "OrderStatusChange_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderStatusChange" ADD CONSTRAINT "OrderStatusChange_byUserId_fkey"
    FOREIGN KEY ("byUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- 4. backfill kind/status per the §4 mapping. One UPDATE per bucket, in the
--    order the plan specifies -- each clause excludes every row already
--    claimed by an earlier one via "status" IS NULL, which is what makes
--    "top to bottom as written" the actual behaviour rather than only a
--    comment.
-- ============================================================================

-- Bucket 1: quotes. Every QUOTE row is DRAFT (plan §3.1's kind-transition
-- guard requires this on the way out, and the migration upholds it on the
-- way in).
UPDATE "Order" SET "kind" = 'QUOTE', "status" = 'DRAFT'
WHERE "status" IS NULL AND "offreDePrix" IS TRUE;

-- Bucket 2: okExport = true. This is also where the 96 historic skip-state
-- orders land (exported without ever being produitFini) -- they are
-- terminal and historically complete, so COMPLETED is correct for them, not
-- a fiction. See plan §1.2 finding 3.
UPDATE "Order" SET "kind" = 'ORDER', "status" = 'COMPLETED'
WHERE "status" IS NULL AND "okExport" IS TRUE;

-- Bucket 3: okFacturation = true, okExport not true. Empty by measurement in
-- the 397 migrated rows (okFacturation and okExport are perfectly
-- correlated -- plan §1.2 finding 2), kept so the migration is correct if a
-- row exists here when this actually runs.
UPDATE "Order" SET "kind" = 'ORDER', "status" = 'INVOICED'
WHERE "status" IS NULL AND "okFacturation" IS TRUE;

-- Bucket 4: produitFini = true, neither ok-flag set.
UPDATE "Order" SET "kind" = 'ORDER', "status" = 'PRODUCED'
WHERE "status" IS NULL AND "produitFini" IS TRUE;

-- Bucket 5: everything else (all four flags null/false).
UPDATE "Order" SET "kind" = 'ORDER', "status" = 'DRAFT'
WHERE "status" IS NULL;

-- ============================================================================
-- 5. one OrderStatusChange row per order: fromStatus = null (there is no
--    real "from" -- the intermediate transitions never happened in a
--    recorded way and are not invented here), toStatus = the bucket just
--    assigned, byUserId = null (no actor), the fixed migration note.
-- ============================================================================

INSERT INTO "OrderStatusChange" ("id", "orderId", "fromStatus", "toStatus", "byUserId", "note", "at")
SELECT gen_random_uuid()::text, "id", NULL, "status", NULL,
       'migrated from legacy workflow flags', CURRENT_TIMESTAMP
FROM "Order";

-- ============================================================================
-- 6. verify: every row landed in exactly one bucket, the per-state counts
--    match the plan's §4 table (17 / 218 / 0 / 129 / 33) measured against
--    the 397 orders in production on 2026-09-07, and the log has exactly
--    one row per order. Aborts the whole transaction on any mismatch --
--    this is the "Verify the backfill" check the plan's §6 step 2 and its
--    verification note both call for, made an executable precondition
--    rather than only a manual step run afterwards.
-- ============================================================================

DO $$
DECLARE
  unset_count INT;
  quote_draft INT;
  order_completed INT;
  order_invoiced INT;
  order_produced INT;
  order_draft INT;
  total_orders INT;
  log_rows INT;
BEGIN
  SELECT count(*) INTO unset_count FROM "Order" WHERE "kind" IS NULL OR "status" IS NULL;
  IF unset_count > 0 THEN
    RAISE EXCEPTION 'Aborting: % order(s) left with no kind/status after backfill', unset_count;
  END IF;

  SELECT count(*) INTO quote_draft FROM "Order" WHERE "kind" = 'QUOTE' AND "status" = 'DRAFT';
  SELECT count(*) INTO order_completed FROM "Order" WHERE "kind" = 'ORDER' AND "status" = 'COMPLETED';
  SELECT count(*) INTO order_invoiced FROM "Order" WHERE "kind" = 'ORDER' AND "status" = 'INVOICED';
  SELECT count(*) INTO order_produced FROM "Order" WHERE "kind" = 'ORDER' AND "status" = 'PRODUCED';
  SELECT count(*) INTO order_draft FROM "Order" WHERE "kind" = 'ORDER' AND "status" = 'DRAFT';
  SELECT count(*) INTO total_orders FROM "Order";

  -- Measured against the 397 orders live on 2026-09-07 (plan §4). A future
  -- run against different data is expected to diverge from these exact
  -- counts -- the invariant that must hold is the sum, checked below, not
  -- these literals; the RAISE NOTICE reports them either way for a human to
  -- compare against the plan by eye.
  IF total_orders = 397 AND (
    quote_draft != 17 OR order_completed != 218 OR order_invoiced != 0
    OR order_produced != 129 OR order_draft != 33
  ) THEN
    RAISE EXCEPTION
      'Aborting: bucket counts do not match plan §4 for the known 397-row dataset (QUOTE/DRAFT=%, ORDER/COMPLETED=%, ORDER/INVOICED=%, ORDER/PRODUCED=%, ORDER/DRAFT=%, total=%)',
      quote_draft, order_completed, order_invoiced, order_produced, order_draft, total_orders;
  END IF;

  IF quote_draft + order_completed + order_invoiced + order_produced + order_draft != total_orders THEN
    RAISE EXCEPTION
      'Aborting: bucket counts (%) do not sum to total orders (%) -- a row fell outside every clause',
      quote_draft + order_completed + order_invoiced + order_produced + order_draft, total_orders;
  END IF;

  SELECT count(*) INTO log_rows FROM "OrderStatusChange" WHERE "note" = 'migrated from legacy workflow flags';
  IF log_rows != total_orders THEN
    RAISE EXCEPTION
      'Aborting: % migration OrderStatusChange row(s) written for % orders -- expected exactly one each',
      log_rows, total_orders;
  END IF;

  RAISE NOTICE 'Order lifecycle backfill verified: % orders (QUOTE/DRAFT=%, ORDER/COMPLETED=%, ORDER/INVOICED=%, ORDER/PRODUCED=%, ORDER/DRAFT=%)',
    total_orders, quote_draft, order_completed, order_invoiced, order_produced, order_draft;
END $$;

-- ============================================================================
-- 7. tighten kind/status to NOT NULL with their final defaults, now that
--    every row has a value. Same reasoning as productId/pricingSource in
--    20260903100025_product_and_pricing_engine: NOT NULL only after the
--    backfill it depends on has been verified to succeed.
-- ============================================================================

ALTER TABLE "Order" ALTER COLUMN "kind" SET NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "kind" SET DEFAULT 'ORDER';
ALTER TABLE "Order" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- ============================================================================
-- 8. the acceptedById FK and the two new indexes matching the real sort key
--    used by the status-grouped facets in order.list.ts (plan §5.1).
-- ============================================================================

ALTER TABLE "Order" ADD CONSTRAINT "Order_acceptedById_fkey"
    FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Order_status_id_idx" ON "Order"("status", "id");
CREATE INDEX "Order_kind_status_id_idx" ON "Order"("kind", "status", "id");
