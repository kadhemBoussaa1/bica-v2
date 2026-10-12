-- When the old app's paper stock was last written here by `sync-paper`
-- (src/migrate/sync-paper.ts). A row whose updatedAt is later was changed
-- in this app since, and the sync leaves it alone.
ALTER TABLE "PaperRoll" ADD COLUMN "legacySyncedAt" TIMESTAMP(3);
ALTER TABLE "RollAllocation" ADD COLUMN "legacySyncedAt" TIMESTAMP(3);

-- Imported rows still exactly as the import wrote them. On production every
-- imported reel and allocation was last written within 5 s of its creation
-- (2026-09-25 import); anything changed in this app since stays NULL, which
-- the sync reads as "changed here".
UPDATE "PaperRoll" SET "legacySyncedAt" = "updatedAt"
WHERE "legacyId" IS NOT NULL AND "updatedAt" - "createdAt" < INTERVAL '1 minute';
UPDATE "RollAllocation" SET "legacySyncedAt" = "updatedAt"
WHERE "legacyId" IS NOT NULL AND "updatedAt" - "createdAt" < INTERVAL '1 minute';
