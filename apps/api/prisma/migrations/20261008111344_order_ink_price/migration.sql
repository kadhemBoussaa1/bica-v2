-- Order inks: the colour's price frozen at assignment (docs/order-ink-price-plan.md).
-- Nullable, no backfill: existing assignments keep an empty price, never
-- today's (decision 2).
-- AlterTable
ALTER TABLE "OrderInk" ADD COLUMN     "kiloPrice" DOUBLE PRECISION;
