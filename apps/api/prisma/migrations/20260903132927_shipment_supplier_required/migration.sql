-- Drop `ImportShipment.supplierName` and make `supplierId` required.
--
-- The column was a migration crutch: 14 of the 32 shipments arrived with a
-- hand-typed supplier name and no link, even though the matching `Supplier`
-- rows existed in the legacy database all along. That left the same company
-- recorded two ways — `PEREVALLS` (7 shipments, linked) and `PERE VALLS`
-- (11 shipments, unlinked text) — so filtering or reporting by supplier
-- silently missed a third of the deliveries.
--
-- Resolved here rather than left to data entry, because with the column gone
-- the name would simply be lost. Three cases, in order of how they are matched:
--
--   1. Whitespace/case-insensitive match against an existing supplier. This
--      is what fixes `PERE VALLS` -> `PEREVALLS` (11 rows) and is the only
--      rule applied in bulk.
--   2. One explicit pair: `DURU SELULOZ VE KAGIT SA` -> `DURU SELULOZ & KAGIT`
--      (2 rows). Turkish "ve" is "and", and the legacy supplier name carries a
--      trailing space and no "SA" suffix, so no general rule reaches it.
--      Spelled out so nothing is matched by accident.
--   3. `IBERGUM` (1 row, shipment SA 673633) has no supplier row anywhere, in
--      this database or the legacy one. Created as a name-only supplier, like
--      the 20 uncategorised rows the supplier import already produced, on the
--      user's decision — the alternative was discarding the only record of
--      who that delivery came from.
--
-- Every step is guarded: the column is dropped and the FK tightened only
-- after a check proves all 32 shipments resolved.

-- 1. The general rule: ignore spacing and case.
UPDATE "ImportShipment" s
SET "supplierId" = sup."id"
FROM "Supplier" sup
WHERE s."supplierId" IS NULL
  AND s."supplierName" IS NOT NULL
  AND upper(replace(trim(sup."name"), ' ', '')) = upper(replace(trim(s."supplierName"), ' ', ''));

-- 2. The one explicit pair the general rule cannot reach.
UPDATE "ImportShipment" s
SET "supplierId" = sup."id"
FROM "Supplier" sup
WHERE s."supplierId" IS NULL
  AND upper(trim(s."supplierName")) = 'DURU SELULOZ VE KAGIT SA'
  AND upper(trim(sup."name")) = 'DURU SELULOZ & KAGIT';

-- 3. IBERGUM: create the supplier, then link. `INSERT ... WHERE NOT EXISTS`
--    so re-running this migration against a database that already has it is
--    harmless. `updatedAt` has no default in Prisma's shape, hence explicit.
INSERT INTO "Supplier" ("id", "name", "active", "updatedAt")
SELECT 'cseedsup000000000ibergum', 'IBERGUM', true, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Supplier" WHERE upper(trim("name")) = 'IBERGUM');

UPDATE "ImportShipment" s
SET "supplierId" = sup."id"
FROM "Supplier" sup
WHERE s."supplierId" IS NULL
  AND upper(trim(s."supplierName")) = 'IBERGUM'
  AND upper(trim(sup."name")) = 'IBERGUM';

-- 4. Refuse to go on unless every shipment resolved. Without this the
--    SET NOT NULL below would fail with a constraint error naming no row,
--    and a partial match would be invisible.
DO $$
DECLARE unresolved INTEGER; names TEXT;
BEGIN
  SELECT count(*), string_agg(DISTINCT coalesce("supplierName", '(no name)'), ', ')
  INTO unresolved, names
  FROM "ImportShipment" WHERE "supplierId" IS NULL;

  IF unresolved > 0 THEN
    RAISE EXCEPTION
      'Aborting: % shipment(s) still have no supplier (%). Add the supplier or extend the mapping above.',
      unresolved, names;
  END IF;

  RAISE NOTICE 'All % shipments linked to a supplier', (SELECT count(*) FROM "ImportShipment");
END $$;

-- 5. The crutch has served its purpose.
ALTER TABLE "ImportShipment" DROP COLUMN "supplierName";

-- 6. Now that every row has one, a shipment must name a real supplier.
--    Restrict rather than SetNull: nulling this on supplier delete would
--    recreate exactly the orphaned state this migration removes. A supplier
--    with deliveries can be archived, not deleted.
ALTER TABLE "ImportShipment" ALTER COLUMN "supplierId" SET NOT NULL;
ALTER TABLE "ImportShipment" DROP CONSTRAINT "ImportShipment_supplierId_fkey";
ALTER TABLE "ImportShipment" ADD CONSTRAINT "ImportShipment_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
