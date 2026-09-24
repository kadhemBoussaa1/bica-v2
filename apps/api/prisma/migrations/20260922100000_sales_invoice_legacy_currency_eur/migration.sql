-- The 30 migrated sales invoices whose legacy row had no `devise` (F2024/001
-- through March 2026, none of them issued by this app) are export invoices in
-- euros; the legacy form simply left the field blank. Decided 2026-09-22 so
-- the list's per-currency totals can account for every issued invoice.
--
-- ISSUED only: a draft's null currency means "not chosen yet" and the issue
-- step refuses it, which is the right behaviour to keep. The importer now
-- defaults a blank `devise` to EUR as well, so a fresh import agrees with
-- this backfill.
UPDATE "SalesInvoice" SET "currency" = 'EUR' WHERE "currency" IS NULL AND "status" = 'ISSUED';
