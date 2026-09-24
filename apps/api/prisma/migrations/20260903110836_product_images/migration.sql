-- Move artwork from `Order` to `Product`: the images describe the bag, not the
-- production run, so they belong to the specification.
--
-- Backfill is the **union** of every distinct URL across a product's orders,
-- chosen by the user over "first set wins" so that nothing is discarded. The
-- trade-off accepted: 30 products whose orders carried genuinely different job
-- artwork (up to 4 distinct sets — generic sizes like "FOND_CARRE 28×28×17 ·
-- 80 g" are shared by several clients) now hold all of it in one gallery.
-- Separating those is data entry, not something this migration can decide.
--
-- Measured on the data this runs against: 467 distinct URLs across 348 of 354
-- products, at most 7 per product — comfortably under the 50-image cap the
-- Zod schema enforces on writes.
--
-- Same shape as 20260901160000_supplier_family_table: add → backfill → verify
-- with RAISE EXCEPTION → drop, inside the transaction `migrate deploy` wraps
-- this file in. The verification is what makes dropping `Order.images` safe:
-- it aborts unless every URL that existed is reachable from its product.

-- 1. The new column. Defaulted so existing rows start empty rather than NULL —
--    Prisma models a `String[]` as NOT NULL with an empty-array default, and
--    the backfill below only touches products that actually have images.
ALTER TABLE "Product" ADD COLUMN "images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 2. Backfill: one row per product, holding every distinct URL from its orders.
--    `unnest` flattens the per-order arrays first, so DISTINCT works on
--    individual URLs rather than on whole arrays (two orders sharing one image
--    of three would otherwise count as two unrelated sets).
--
--    ORDER BY inside array_agg keeps the result deterministic: without it the
--    URL order varies between runs, which would make the migration's output
--    depend on scan order and any re-run diff noisy.
UPDATE "Product" p
SET "images" = u.imgs
FROM (
  SELECT o."productId", array_agg(DISTINCT img ORDER BY img) AS imgs
  FROM "Order" o, unnest(o."images") AS img
  GROUP BY o."productId"
) u
WHERE u."productId" = p."id";

-- 3. Refuse to drop the source until every URL is provably reachable.
DO $$
DECLARE
  source_urls INTEGER;
  moved_urls INTEGER;
  orphaned INTEGER;
BEGIN
  -- Every distinct (product, url) pair that exists on the order side.
  SELECT count(*) INTO source_urls
  FROM (SELECT DISTINCT o."productId", img FROM "Order" o, unnest(o."images") AS img) s;

  SELECT count(*) INTO moved_urls
  FROM (SELECT p."id", img FROM "Product" p, unnest(p."images") AS img) t;

  IF source_urls <> moved_urls THEN
    RAISE EXCEPTION
      'Aborting: % distinct (product, image) pairs on orders but % landed on products',
      source_urls, moved_urls;
  END IF;

  -- Belt and braces: no order may hold a URL its product does not now have.
  SELECT count(*) INTO orphaned
  FROM "Order" o, unnest(o."images") AS img
  WHERE NOT EXISTS (
    SELECT 1 FROM "Product" p
    WHERE p."id" = o."productId" AND img = ANY(p."images")
  );

  IF orphaned > 0 THEN
    RAISE EXCEPTION 'Aborting: % order image(s) did not reach their product', orphaned;
  END IF;

  RAISE NOTICE 'Images moved: % URLs across % products',
    moved_urls, (SELECT count(*) FROM "Product" WHERE array_length("images", 1) > 0);
END $$;

-- 4. The source column has served its purpose.
ALTER TABLE "Order" DROP COLUMN "images";

-- 5. Match Prisma's own shape for a `String[]`, which carries no default.
--    Dropping it after the backfill keeps step 1 simple; the column stays
--    NOT NULL, so existing and future rows are an empty array, never NULL.
ALTER TABLE "Product" ALTER COLUMN "images" DROP DEFAULT;
