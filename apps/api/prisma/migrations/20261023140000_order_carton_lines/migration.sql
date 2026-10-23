-- Step C4 of the cartons addition to docs/raw-material-prices-plan.md:
-- every order's typed carton price (`Order.parcelPrice`) becomes its CARTON
-- line, as 20261022100000_order_material_prices did for the paper and glue
-- kilo prices (plan decision 7): no material, no label, no source price,
-- `manual` false, the price copied verbatim. The 0s are copied too (395 in
-- the dev data, legacy "not priced"), like that migration's 195 paper 0s:
-- the engine reads 0 as no carton, so no figure moves.
--
-- Data only, and re-runnable: an order that already has a CARTON line is
-- left alone. `parcelPrice` stays until step C5 drops it; the app stops
-- reading and writing it in this same step.

INSERT INTO "OrderMaterialPrice" ("id", "orderId", "slot", "price", "manual", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o."id", 'CARTON'::"PricingSlot", o."parcelPrice", false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Order" o
WHERE o."parcelPrice" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "OrderMaterialPrice" l WHERE l."orderId" = o."id" AND l."slot" = 'CARTON'
  );
