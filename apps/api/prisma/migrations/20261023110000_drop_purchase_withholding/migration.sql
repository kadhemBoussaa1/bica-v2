-- Drops the withholding tax (retenue à la source) from purchase invoices.
-- It was never used: zero on all 691 invoices of the old app, which never
-- had a withholding account to compute one from (checked on its live
-- database, 2026-10-23), and on every invoice of this one — so the user
-- dropped it. `netPayable` stays, equal to `totalTtc`.
--
-- The guard comes first, in the same transaction: a non-zero withholding, or
-- a net payable that differs from the total (a withholding in effect), would
-- be lost with the column, so either one aborts with nothing changed. Clear
-- the withholding on that invoice through the app (or decide otherwise) and
-- deploy again.

BEGIN;

DO $$
DECLARE withheld INT; reduced INT;
BEGIN
  SELECT count(*) INTO withheld FROM "PurchaseInvoice"
   WHERE coalesce("withholdingTax", 0) <> 0;
  SELECT count(*) INTO reduced FROM "PurchaseInvoice"
   WHERE abs(coalesce("netPayable", 0) - coalesce("totalTtc", 0)) > 0.0005;
  IF withheld > 0 OR reduced > 0 THEN
    RAISE EXCEPTION
      'Aborting: % invoice(s) carry a withholding and % have a net payable below their total',
      withheld, reduced;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "PurchaseInvoice" DROP COLUMN "withholdingTax";

COMMIT;
