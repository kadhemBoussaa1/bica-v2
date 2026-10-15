-- A shipment carries every order of one invoice, and an invoice may bill
-- orders of several clients: the consignee is then none in particular, and
-- each line names its own through its order. The foreign key is unchanged.
ALTER TABLE "Shipment" ALTER COLUMN "clientId" DROP NOT NULL;
