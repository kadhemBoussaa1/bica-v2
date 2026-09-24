-- Purchasing write path — docs/purchasing-write-path-plan.md.
--
-- Purchase orders and goods receipts were migrated read-only. This adds what
-- a write path needs: a received-to-date figure per order line, and the two
-- number sequences the service allocates from.
--
-- Prisma's own DDL (`migrate diff --script`), followed by three data steps.
--
-- COLUMN — `PurchaseOrderLine.receivedQuantity` is denormalised from the
-- receipt lines so the over-receipt guard has a figure to compare against
-- without a per-row join. `PurchasingService.syncReceivedQuantities`
-- recomputes it (never adds a delta) on every receipt write, and the legacy
-- importer recomputes it too, since re-running step 6 recreates the lines at
-- this DEFAULT 0 while the receipt lines still say otherwise.
--
-- BACKFILL — verified as a SELECT before writing this migration: summing
-- `GoodsReceiptLine.receivedQuantity` per `orderLineId` over the 1871 order
-- lines totals 1 289 455.680, which equals the sum over all 1856 receipt
-- lines exactly, and no receipt line has a NULL `orderLineId`. So the
-- backfill moves every figure that exists and invents none. Expect 1788
-- lines positive and 83 at zero — 1871 order lines against 1856 receipt
-- lines, plus the five orders nothing was ever received against.
-- Idempotent: recomputes from the receipt lines, so re-running is a no-op.
--
-- COUNTERS — one row per number prefix, `next` being the sequence the next
-- created document receives. The `26` in every legacy number is a fixed
-- series marker, NOT the issue year: the 556 orders carry `26` but were
-- raised across 2024 (101), 2025 (272) and 2026 (183), so keying on the
-- issue year would mint `25PBC-001`, a prefix that exists nowhere. Two
-- tables because prefixes differ per category AND per document kind — ink is
-- `26EBC` for orders but `26IBR` for receipts, and transport inverts to
-- `26BCT` / `26BRT`.
--
-- Seeded from `max(sequence) + 1` per prefix, not from the row count: the
-- sequences have gaps (30 paper orders but the highest is 035). Note the
-- SalesInvoiceCounter seed's `max(numero)` shortcut is NOT reused here — it
-- relies on every number being the same width, and while purchasing happens
-- to be 3 digits throughout, extracting the integer is correct regardless.
-- Verified: all 556 order and 551 receipt numbers match `^[0-9A-Z]+-[0-9]+$`.
-- Expect 9 rows in each table, `26PBC` -> 36 and `26MSBC` -> 201 for orders,
-- `26PBR` -> 31 and `26MSBR` -> 201 for receipts.

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "receivedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PurchaseOrderCounter" (
    "prefix" TEXT NOT NULL,
    "next" INTEGER NOT NULL,

    CONSTRAINT "PurchaseOrderCounter_pkey" PRIMARY KEY ("prefix")
);

-- CreateTable
CREATE TABLE "GoodsReceiptCounter" (
    "prefix" TEXT NOT NULL,
    "next" INTEGER NOT NULL,

    CONSTRAINT "GoodsReceiptCounter_pkey" PRIMARY KEY ("prefix")
);

-- Backfill the received-to-date figure from the receipt lines (see BACKFILL).
UPDATE "PurchaseOrderLine" ol
SET "receivedQuantity" = COALESCE(sums.recv, 0)
FROM (
    SELECT l.id, COALESCE(SUM(rl."receivedQuantity"), 0) AS recv
    FROM "PurchaseOrderLine" l
    LEFT JOIN "GoodsReceiptLine" rl ON rl."orderLineId" = l.id
    GROUP BY l.id
) AS sums
WHERE ol.id = sums.id;

-- Seed the order sequences: one row per prefix, at the highest used + 1.
INSERT INTO "PurchaseOrderCounter" ("prefix", "next")
SELECT split_part("numero", '-', 1),
       MAX(split_part("numero", '-', 2)::INTEGER) + 1
FROM "PurchaseOrder"
WHERE "numero" ~ '^[0-9A-Z]+-[0-9]+$'
GROUP BY split_part("numero", '-', 1);

-- Seed the receipt sequences the same way.
INSERT INTO "GoodsReceiptCounter" ("prefix", "next")
SELECT split_part("numero", '-', 1),
       MAX(split_part("numero", '-', 2)::INTEGER) + 1
FROM "GoodsReceipt"
WHERE "numero" ~ '^[0-9A-Z]+-[0-9]+$'
GROUP BY split_part("numero", '-', 1);
