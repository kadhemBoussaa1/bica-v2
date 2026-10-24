-- A goods receipt's `validated` is the explicit "Confirm reception" sign-off
-- again (PurchasingService.confirmReceipt), as it was in the legacy app, and
-- confirming raises the purchase invoice. Until now this app derived it: a
-- receipt raised here was marked validated the moment its quantities were
-- complete, without anyone confirming anything and without an invoice.
--
-- Those receipts go back to unconfirmed so they can be confirmed for real —
-- and get their invoice. Only receipts raised here (`legacyId` NULL) that no
-- invoice names: a migrated receipt keeps the sign-off its operator gave in
-- the legacy app, and one already invoiced has nothing to gain.
--
-- Data only; the column is unchanged. No explicit BEGIN/COMMIT: Prisma
-- already runs the file as one transaction (see
-- 20261023110000_drop_purchase_withholding).

UPDATE "GoodsReceipt" r
   SET "validated" = false
 WHERE r."legacyId" IS NULL
   AND r."validated"
   AND NOT EXISTS (SELECT 1 FROM "PurchaseInvoice" i WHERE i."receiptId" = r."id");
