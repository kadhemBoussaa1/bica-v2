-- Drops the four "negotiated" columns and the loose print colour count from
-- `Order`. All five were recorded-only: nothing in the pricing engine
-- (packages/api-contract/src/pricing.ts), invoicing, shipments, production or
-- any report ever read them back, and no derived value depended on them.
--
-- Destructive, and deliberately so — the values are not preserved anywhere:
--
--   clientParcelPrice      396 non-null,  12 non-zero
--   salePrice              396 non-null,   8 non-zero
--   clientPiecesPerParcel  396 non-null,  16 non-zero
--   parcelMarginPct        396 non-null,  18 non-zero
--   nombreCouleurs         397 non-null, 135 non-zero
--
-- The near-miss names are worth keeping straight: the pricing engine's real
-- inputs are `piecesPerParcel`/`kilosPerParcel` and
-- `profitMarginPct`/`lossMarginPct`, which are NOT touched here.
--
-- What a job prints is still recorded by `typeImpression` and the order's
-- `OrderColour` rows; `nombreCouleurs` was never reconciled against that list.

ALTER TABLE "Order"
  DROP COLUMN "clientParcelPrice",
  DROP COLUMN "salePrice",
  DROP COLUMN "clientPiecesPerParcel",
  DROP COLUMN "parcelMarginPct",
  DROP COLUMN "nombreCouleurs";
