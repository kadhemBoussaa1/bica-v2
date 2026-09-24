-- Introduces Product (the bag specification, extracted out of Order) and the
-- live pricing engine's snapshot columns on Order. Written by hand, following
-- 20260901160000_supplier_family_table/migration.sql: park -> transform ->
-- RAISE EXCEPTION on any mismatch -> drop, all inside the one transaction
-- `prisma migrate deploy` wraps this file in.
--
-- Ordering is forced two ways:
--   * TypeSac must lose SAC_LUXE, but an enum cannot be ALTERed to drop a
--     value in Postgres, and cannot be DROPped while Order.typeSac uses it —
--     so the column is parked as text first (step 2), same trick as the
--     supplier-family migration used for a table/enum name collision.
--   * Order.productId (NOT NULL, FK to Product) must be backfilled before it
--     can be made NOT NULL, and Product rows must exist before that backfill
--     can run — so Product is created and populated (steps 3-5) before
--     Order gets its productId column (step 6).
--
-- docs/product-pricing-plan.md has the full reasoning; this file is the
-- executable form of the "Target schema" and "Phase B" sections there.

-- ============================================================================
-- 1. new enums
-- ============================================================================

CREATE TYPE "QuantityUnit" AS ENUM ('PIECES', 'KILOGRAMS');
CREATE TYPE "PricingSource" AS ENUM ('LEGACY', 'COMPUTED');

-- ============================================================================
-- 2. park bag type as text, then recreate TypeSac without SAC_LUXE
-- ============================================================================

ALTER TABLE "Order" ADD COLUMN "typeSacLegacy" TEXT;
UPDATE "Order" SET "typeSacLegacy" = "typeSac"::text;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM "Order" WHERE "typeSacLegacy" = 'SAC_LUXE';
  IF n > 0 THEN
    RAISE EXCEPTION 'Aborting: % order(s) use SAC_LUXE, which is being removed from TypeSac', n;
  END IF;

  SELECT count(*) INTO n FROM "Order" WHERE "typeSacLegacy" IS NULL OR "grammage" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'Aborting: % order(s) lack a bag type or grammage; Product requires both', n;
  END IF;
END $$;

ALTER TABLE "Order" DROP COLUMN "typeSac";
DROP TYPE "TypeSac";
CREATE TYPE "TypeSac" AS ENUM ('FOND_V', 'FOND_CARRE', 'SOUS_PLAT');

-- ============================================================================
-- 3. Product table + indexes (Prisma's exact CREATE TABLE / index shape,
--    verified against `prisma migrate diff --from-empty --to-schema=...`;
--    the FK to Client is added now, the one to Order.productId does not exist
--    yet because Order has no productId column until step 6)
-- ============================================================================

CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT,
    "typeSac" "TypeSac" NOT NULL,
    "widthCm" DOUBLE PRECISION NOT NULL,
    "lengthCm" DOUBLE PRECISION NOT NULL,
    "gussetCm" DOUBLE PRECISION,
    "pleatWidthCm" DOUBLE PRECISION,
    "pleatLengthCm" DOUBLE PRECISION,
    "grammage" DOUBLE PRECISION NOT NULL,
    "paperType" "PaperType",
    "hasHandle" BOOLEAN NOT NULL DEFAULT false,
    "handleWeightG" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Product_clientId_idx" ON "Product"("clientId");
CREATE INDEX "Product_active_name_id_idx" ON "Product"("active", "name", "id");
CREATE INDEX "Product_typeSac_idx" ON "Product"("typeSac");

ALTER TABLE "Product" ADD CONSTRAINT "Product_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- 4. one normalised spec row per order, used by both the Product INSERT and
--    the Order.productId backfill below.
--
-- The null-vs-0 rule here MUST match `normaliseProductSpec` in
-- packages/api-contract/src/products.ts exactly, or a product created here
-- and an otherwise-identical one created later through the app will not
-- dedupe. Today's data never exercises the gap (no FOND order has a null
-- gusset), so this equivalence is not covered by any automated check — see
-- the "Canonical spec form drift" risk in docs/product-pricing-plan.md.
-- ============================================================================

CREATE TEMP TABLE order_spec ON COMMIT DROP AS
SELECT
  o."id" AS order_id,
  o."clientId",
  COALESCE(
    NULLIF(trim(o."productName"), ''),
    o."typeSacLegacy" || ' ' || o."largeur"::text || '×' || o."longueur"::text ||
      CASE WHEN o."typeSacLegacy" <> 'SOUS_PLAT' THEN '×' || COALESCE(o."soufflet", 0)::text ELSE '' END ||
      ' · ' || o."grammage"::text || ' g'
  ) AS name,
  o."typeSacLegacy"::"TypeSac" AS type_sac,
  o."largeur" AS width_cm,
  o."longueur" AS length_cm,
  -- canonical form, identical to normaliseProductSpec: FOND gusset is never
  -- null (0 when absent), SOUS_PLAT has no gusset/pleats/handle at all.
  CASE WHEN o."typeSacLegacy" = 'SOUS_PLAT' THEN NULL ELSE COALESCE(o."soufflet", 0) END AS gusset_cm,
  CASE WHEN o."typeSacLegacy" = 'SOUS_PLAT' THEN NULL ELSE o."pliEnLargeur" END AS pleat_w,
  CASE WHEN o."typeSacLegacy" = 'SOUS_PLAT' THEN NULL ELSE o."pliEnLongueur" END AS pleat_l,
  o."grammage",
  o."paperType",
  CASE WHEN o."typeSacLegacy" = 'SOUS_PLAT' THEN false ELSE COALESCE(o."poidsPoigner", 0) > 0 END AS has_handle,
  CASE WHEN o."typeSacLegacy" <> 'SOUS_PLAT' AND COALESCE(o."poidsPoigner", 0) > 0 THEN o."poidsPoigner" END AS handle_g
FROM "Order" o;

-- ============================================================================
-- 5. dedupe into Product. DISTINCT ON treats NULLs in the key as equal, so a
--    FOND row with a null gusset would NOT collapse with one holding 0 (they
--    differ) -- moot today since no FOND order has a null gusset (verified
--    against the live data), but noted because the SQL does not enforce it.
--    The first order's name casing wins.
-- ============================================================================

INSERT INTO "Product"
  ("id", "name", "clientId", "typeSac", "widthCm", "lengthCm", "gussetCm", "pleatWidthCm",
   "pleatLengthCm", "grammage", "paperType", "hasHandle", "handleWeightG", "updatedAt")
SELECT DISTINCT ON
  ("clientId", lower(name), type_sac, width_cm, length_cm, gusset_cm, pleat_w, pleat_l, grammage, "paperType", has_handle, handle_g)
  gen_random_uuid()::text, name, "clientId", type_sac, width_cm, length_cm, gusset_cm, pleat_w, pleat_l,
  grammage, "paperType", has_handle, handle_g, CURRENT_TIMESTAMP
FROM order_spec
ORDER BY "clientId", lower(name), type_sac, width_cm, length_cm, gusset_cm, pleat_w, pleat_l,
  grammage, "paperType", has_handle, handle_g, order_id;

-- ============================================================================
-- 6. backfill Order.productId with a null-safe join on the same columns used
--    to dedupe. The FK and NOT NULL constraint are added only after the
--    backfill succeeds, so a mismatch aborts before either exists.
-- ============================================================================

ALTER TABLE "Order" ADD COLUMN "productId" TEXT;

UPDATE "Order" o SET "productId" = p."id"
FROM order_spec s
JOIN "Product" p
  ON  p."clientId" IS NOT DISTINCT FROM s."clientId"
  AND lower(p."name") = lower(s.name)
  AND p."typeSac" = s.type_sac
  AND p."widthCm" = s.width_cm
  AND p."lengthCm" = s.length_cm
  AND p."gussetCm" IS NOT DISTINCT FROM s.gusset_cm
  AND p."pleatWidthCm" IS NOT DISTINCT FROM s.pleat_w
  AND p."pleatLengthCm" IS NOT DISTINCT FROM s.pleat_l
  AND p."grammage" = s.grammage
  AND p."paperType" IS NOT DISTINCT FROM s."paperType"
  AND p."hasHandle" = s.has_handle
  AND p."handleWeightG" IS NOT DISTINCT FROM s.handle_g
WHERE s.order_id = o."id";

DO $$
DECLARE n INT; product_count INT; referenced_count INT;
BEGIN
  SELECT count(*) INTO n FROM "Order" WHERE "productId" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'Aborting: % order(s) matched no Product in the backfill join', n;
  END IF;

  SELECT count(*) INTO product_count FROM "Product";
  SELECT count(DISTINCT "productId") INTO referenced_count FROM "Order";
  IF product_count <> referenced_count THEN
    RAISE EXCEPTION 'Aborting: % Product row(s) created but only % are referenced by an Order',
      product_count, referenced_count;
  END IF;

  RAISE NOTICE 'Products created: % (from % orders)', product_count, (SELECT count(*) FROM "Order");
END $$;

ALTER TABLE "Order" ALTER COLUMN "productId" SET NOT NULL;
ALTER TABLE "Order" ADD CONSTRAINT "Order_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Order_productId_idx" ON "Order"("productId");

-- ============================================================================
-- 7. rename the pricing-input columns that survive, in place (data-preserving)
-- ============================================================================

ALTER TABLE "Order" RENAME COLUMN "prixKilo" TO "paperKiloPrice";
ALTER TABLE "Order" RENAME COLUMN "marge" TO "profitMarginPct";
ALTER TABLE "Order" RENAME COLUMN "tauxPerte" TO "lossMarginPct";
ALTER TABLE "Order" RENAME COLUMN "nombreDePieceParColis" TO "piecesPerParcel";
ALTER TABLE "Order" RENAME COLUMN "kiloParColis" TO "kilosPerParcel";
ALTER TABLE "Order" RENAME COLUMN "prixCarton" TO "parcelPrice";
ALTER TABLE "Order" RENAME COLUMN "prixTransport" TO "transportCost";
ALTER TABLE "Order" RENAME COLUMN "prixColisClient" TO "clientParcelPrice";
ALTER TABLE "Order" RENAME COLUMN "prixVente" TO "salePrice";
ALTER TABLE "Order" RENAME COLUMN "nbPieceColisClient" TO "clientPiecesPerParcel";
ALTER TABLE "Order" RENAME COLUMN "margeColis" TO "parcelMarginPct";

-- ============================================================================
-- 8. add quantityUnit, the six glue inputs + legacyGlueCostPerUnit, pricingSource,
--    and the eleven snapshot columns. quantityUnit/pricingSource are added
--    nullable (or without their final default) here and tightened in step 9,
--    after they are filled in -- the same reason productId was NOT NULL only
--    after its backfill.
-- ============================================================================

ALTER TABLE "Order" ADD COLUMN "quantityUnit" "QuantityUnit";

ALTER TABLE "Order" ADD COLUMN "handleGlueKiloPrice" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "handleGlueWeightG" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "sideGlueKiloPrice" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "sideGlueWeightG" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "baseAdhesiveKiloPrice" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "baseAdhesiveWeightG" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "legacyGlueCostPerUnit" DOUBLE PRECISION;

ALTER TABLE "Order" ADD COLUMN "pricingSource" "PricingSource";

ALTER TABLE "Order" ADD COLUMN "productionWidthCm" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "cuttingLengthCm" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "unitWeightG" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "unitPrice" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "unitPriceWithMargins" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "glueCostPerUnit" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "finalUnitPrice" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "baseParcelPrice" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "finalParcelPrice" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "parcelCount" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "orderTotal" DOUBLE PRECISION;

-- ============================================================================
-- 9. fill the new columns from the legacy figures.
--
-- Two passes: the first can read only stored/renamed columns and order_spec;
-- the second reads columns the first pass just wrote (unitWeightG needs
-- productionWidthCm/cuttingLengthCm, finalUnitPrice needs
-- unitPriceWithMargins, parcelCount needs quantityUnit), so it has to run
-- after the first pass commits its values within the transaction, not
-- interleaved with them.
-- ============================================================================

UPDATE "Order" o SET
  "quantityUnit" = CASE WHEN s.type_sac = 'SOUS_PLAT' THEN 'KILOGRAMS' ELSE 'PIECES' END::"QuantityUnit",
  "pricingSource" = 'LEGACY',

  -- Legacy glue cost per piece = colleN_prix_total / colleN_quantite, per
  -- line, summed. Null (not 0) when neither line has a price, so the engine's
  -- fallback correctly treats "no legacy glue recorded" as absent rather than
  -- "recorded as free".
  "legacyGlueCostPerUnit" = CASE
      WHEN COALESCE(o."colle1PrixTotal", 0) = 0 AND COALESCE(o."colle2PrixTotal", 0) = 0 THEN NULL
      ELSE COALESCE(o."colle1PrixTotal" / NULLIF(o."colle1Quantite", 0), 0)
         + COALESCE(o."colle2PrixTotal" / NULLIF(o."colle2Quantite", 0), 0)
    END,

  "productionWidthCm" = CASE
      WHEN s.type_sac = 'SOUS_PLAT' THEN s.width_cm
      ELSE (s.width_cm + COALESCE(s.gusset_cm, 0)) * 2 + COALESCE(s.pleat_w, 0)
    END,
  "cuttingLengthCm" = CASE s.type_sac
      WHEN 'FOND_CARRE' THEN s.length_cm + COALESCE(s.gusset_cm, 0) / 2 + COALESCE(s.pleat_l, 0)
      WHEN 'FOND_V'     THEN s.length_cm + COALESCE(s.pleat_l, 0)
      ELSE s.length_cm
    END,

  "unitPrice" = NULLIF(o."prixUnitaire", 0),

  -- Recomputed, not copied: legacy stored 0 in prix_unitaire_avec_marge_et_perte
  -- whenever marge = 0, which is a "not computed" sentinel rather than a real
  -- price of 0 -- see the verified legacy facts in docs/product-pricing-plan.md.
  "unitPriceWithMargins" = CASE
      WHEN COALESCE(o."prixUnitaire", 0) = 0 THEN NULL
      ELSE o."prixUnitaire" * (1 + COALESCE(o."profitMarginPct", 0) / 100) * (1 + COALESCE(o."lossMarginPct", 0) / 100)
    END,

  "finalParcelPrice" = NULLIF(o."prixColis", 0),
  -- As recorded; the order-total formula has since changed (parcelCount is
  -- now an exact fraction rather than whatever colisage logic produced this),
  -- so this is history, not a value the verifier expects to match a recompute.
  "orderTotal" = NULLIF(o."prixTotal", 0)
FROM order_spec s
WHERE s.order_id = o."id";

UPDATE "Order" SET
  "unitWeightG" = "productionWidthCm" * "cuttingLengthCm"
      * (SELECT grammage FROM order_spec s WHERE s.order_id = "Order"."id") / 10000
    + COALESCE((SELECT handle_g FROM order_spec s WHERE s.order_id = "Order"."id"), 0),
  "glueCostPerUnit" = "legacyGlueCostPerUnit",
  "finalUnitPrice" = CASE
      WHEN "unitPriceWithMargins" IS NULL THEN NULL
      ELSE "unitPriceWithMargins" + COALESCE("legacyGlueCostPerUnit", 0)
    END,
  "baseParcelPrice" = CASE
      WHEN "finalParcelPrice" IS NULL THEN NULL
      ELSE "finalParcelPrice" - COALESCE("parcelPrice", 0) - COALESCE("transportCost", 0)
    END,
  "parcelCount" = "quantite" / NULLIF(
      CASE WHEN "quantityUnit" = 'KILOGRAMS' THEN "kilosPerParcel" ELSE "piecesPerParcel" END, 0);

ALTER TABLE "Order" ALTER COLUMN "quantityUnit" SET NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "pricingSource" SET NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "pricingSource" SET DEFAULT 'COMPUTED';

-- ============================================================================
-- 10. drop moved / superseded columns: the dimension set + productName that
--     moved to Product, typeSacLegacy (its job is done), colisageParKilo
--     (dropped -- see the accepted-losses note in docs/product-pricing-plan.md,
--     CMD-26 is the only order it affects), the four intermediate price
--     columns folded into unitPriceWithMargins, the two colle quantity/total
--     pairs folded into legacyGlueCostPerUnit, and the four price columns now
--     represented by the snapshot (unitPrice/finalParcelPrice/orderTotal above,
--     colisAvecMarge had no equivalent and is simply history no longer carried
--     forward as a distinct column).
-- ============================================================================

ALTER TABLE "Order" DROP COLUMN "longueur";
ALTER TABLE "Order" DROP COLUMN "largeur";
ALTER TABLE "Order" DROP COLUMN "soufflet";
ALTER TABLE "Order" DROP COLUMN "pliEnLongueur";
ALTER TABLE "Order" DROP COLUMN "pliEnLargeur";
ALTER TABLE "Order" DROP COLUMN "grammage";
ALTER TABLE "Order" DROP COLUMN "paperType";
ALTER TABLE "Order" DROP COLUMN "poidsPoigner";
ALTER TABLE "Order" DROP COLUMN "productName";
ALTER TABLE "Order" DROP COLUMN "typeSacLegacy";

ALTER TABLE "Order" DROP COLUMN "colisageParKilo";

ALTER TABLE "Order" DROP COLUMN "prixUnitaireAvecMarge";
ALTER TABLE "Order" DROP COLUMN "prixUnitaireAvecPerte";
ALTER TABLE "Order" DROP COLUMN "prixColisAvecMarge";

ALTER TABLE "Order" DROP COLUMN "colle1Quantite";
ALTER TABLE "Order" DROP COLUMN "colle1PrixTotal";
ALTER TABLE "Order" DROP COLUMN "colle2Quantite";
ALTER TABLE "Order" DROP COLUMN "colle2PrixTotal";

ALTER TABLE "Order" DROP COLUMN "prixUnitaire";
ALTER TABLE "Order" DROP COLUMN "prixUnitaireAvecMargeEtPerte";
ALTER TABLE "Order" DROP COLUMN "prixColis";
ALTER TABLE "Order" DROP COLUMN "prixTotal";
