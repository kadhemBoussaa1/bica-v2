-- `ImportShipment.active`: the archive flag every other record in this app has
-- (Client, Supplier, Product, Order), added so a paper delivery can be retired
-- without being destroyed.
--
-- Safe by construction: NOT NULL DEFAULT true, so all 32 existing shipments
-- stay active and no backfill is needed.
--
-- Why archiving rather than just a delete: `PaperRoll.importShipmentId` is
-- `SetNull`, so deleting a shipment with reels attached would silently strip
-- their purchase provenance — which delivery, supplier and price they came
-- from — rather than failing. 31 of the 32 migrated shipments have reels, one
-- of them 136. `StockService.removeShipment` therefore permits a hard delete
-- only while no reel references the shipment, the same rule
-- `SupplierFamilyService.remove` uses.


-- AlterTable
ALTER TABLE "ImportShipment" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "ImportShipment_active_dateImport_id_idx" ON "ImportShipment"("active", "dateImport", "id");

