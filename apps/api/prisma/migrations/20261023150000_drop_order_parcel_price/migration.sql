-- Step C5 of the cartons addition to docs/raw-material-prices-plan.md: the
-- carton price now lives on the order's CARTON line (copied by
-- 20261023140000_order_carton_lines), and nothing reads or writes
-- `Order.parcelPrice` any more.
--
-- The guard comes first: an order that still has a carton price here but no
-- CARTON line at all would lose it with the column — what a skipped or failed
-- copy would leave. It cannot compare the two values: once step C4 is live,
-- a draft's line may be changed in the app while this column keeps the old
-- figure. C4 and C5 deploy together, and migrations run before the app
-- starts, so in practice the guard only ever trips on a real gap. If it
-- does, it names the count and changes nothing.
--
-- No explicit BEGIN/COMMIT: Prisma already runs the file as one transaction
-- (see 20261023110000_drop_purchase_withholding).

DO $$
DECLARE uncopied INT;
BEGIN
  SELECT count(*) INTO uncopied FROM "Order" o
   WHERE o."parcelPrice" IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM "OrderMaterialPrice" l WHERE l."orderId" = o."id" AND l."slot" = 'CARTON'
     );
  IF uncopied > 0 THEN
    RAISE EXCEPTION
      'Aborting: % order(s) have a carton price but no CARTON line — run 20261023140000_order_carton_lines first',
      uncopied;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "parcelPrice";
