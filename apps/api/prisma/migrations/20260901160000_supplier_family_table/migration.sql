-- Promote SupplierFamily from a Postgres enum to a table.
--
-- Written by hand: `prisma migrate dev` would emit `ALTER TABLE "Supplier" DROP
-- COLUMN "family"` before the new table exists, destroying the 116 family
-- assignments that arrived with the legacy import.
--
-- The ordering is forced by two constraints pulling in opposite directions:
--
--   * A table cannot be named "SupplierFamily" while the enum TYPE of that name
--     exists (Postgres 42710 — every table owns a composite type of its name),
--     so the enum has to go first.
--   * But the enum cannot be dropped while "Supplier"."family" still uses it,
--     and that column holds the data being migrated.
--
-- So the old values are copied to a plain text column first. That column is the
-- source for the backfill and is dropped at the end, and everything runs in the
-- migration's transaction: any mismatch rolls the whole thing back.

-- 1. Park the existing enum values as text.
ALTER TABLE "Supplier" ADD COLUMN "familyLegacy" TEXT;
UPDATE "Supplier" SET "familyLegacy" = "family"::text WHERE "family" IS NOT NULL;

-- 2. Now the enum and its column are free to go.
DROP INDEX "Supplier_family_idx";
ALTER TABLE "Supplier" DROP COLUMN "family";
DROP TYPE "SupplierFamily";

-- 3. The new table can finally take the name.
CREATE TABLE "SupplierFamily" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierFamily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplierFamily_code_key" ON "SupplierFamily"("code");
CREATE UNIQUE INDEX "SupplierFamily_label_key" ON "SupplierFamily"("label");
CREATE INDEX "SupplierFamily_active_sortOrder_label_idx"
    ON "SupplierFamily"("active", "sortOrder", "label");

-- 4. Seed one row per former enum value.
--
-- `sortOrder` follows how common each family is in the migrated data
-- (ACCESSOIRE 57, SERVICE 46, CHIMIQUE 5, TRANSPORT 3, FOURNITURE 2, then the
-- singletons), which is the order the facet chips already used.
--
-- Fixed 26-char ids rather than generated ones: this is plain SQL with no access
-- to Prisma's cuid(), and constants make the migration reproducible. The
-- `cseedfam` prefix marks them as seeded here rather than created in the app.
INSERT INTO "SupplierFamily" ("id", "code", "label", "sortOrder", "updatedAt") VALUES
    ('cseedfam00000000accessoire', 'ACCESSOIRE', 'Accessoire', 10, CURRENT_TIMESTAMP),
    ('cseedfam00000000service000', 'SERVICE',    'Service',    20, CURRENT_TIMESTAMP),
    ('cseedfam00000000chimique00', 'CHIMIQUE',   'Chimique',   30, CURRENT_TIMESTAMP),
    ('cseedfam00000000transport0', 'TRANSPORT',  'Transport',  40, CURRENT_TIMESTAMP),
    ('cseedfam00000000fourniture', 'FOURNITURE', 'Fourniture', 50, CURRENT_TIMESTAMP),
    ('cseedfam00000000papier0000', 'PAPIER',     'Papier',     60, CURRENT_TIMESTAMP),
    ('cseedfam00000000encre00000', 'ENCRE',      'Encre',      70, CURRENT_TIMESTAMP),
    ('cseedfam00000000hygiene000', 'HYGIENE',    'Hygiene',    80, CURRENT_TIMESTAMP);

-- 5. The new foreign key, backfilled from the parked text.
ALTER TABLE "Supplier" ADD COLUMN "familyId" TEXT;

UPDATE "Supplier" AS s
SET "familyId" = f."id"
FROM "SupplierFamily" AS f
WHERE s."familyLegacy" = f."code";

-- 6. Fail loudly if anything did not carry over, rather than silently losing it.
DO $$
DECLARE orphaned INTEGER;
BEGIN
    SELECT count(*) INTO orphaned
    FROM "Supplier"
    WHERE "familyLegacy" IS NOT NULL AND "familyId" IS NULL;

    IF orphaned > 0 THEN
        RAISE EXCEPTION
            'Aborting: % supplier(s) have a family that matched no SupplierFamily row', orphaned;
    END IF;
END $$;

-- 7. The parked column has served its purpose.
ALTER TABLE "Supplier" DROP COLUMN "familyLegacy";

-- 8. Wire up the constraint and index Prisma expects.
CREATE INDEX "Supplier_familyId_idx" ON "Supplier"("familyId");
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_familyId_fkey"
    FOREIGN KEY ("familyId") REFERENCES "SupplierFamily"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
