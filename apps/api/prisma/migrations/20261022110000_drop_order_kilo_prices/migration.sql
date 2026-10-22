-- The four kilo prices now live on `OrderMaterialPrice` (copied by the
-- previous migration, 20261022100000_order_material_prices) — step 8 of
-- docs/raw-material-prices-plan.md. Nothing reads or writes these columns
-- any more.
ALTER TABLE "Order" DROP COLUMN "baseAdhesiveKiloPrice",
DROP COLUMN "handleGlueKiloPrice",
DROP COLUMN "paperKiloPrice",
DROP COLUMN "sideGlueKiloPrice";
