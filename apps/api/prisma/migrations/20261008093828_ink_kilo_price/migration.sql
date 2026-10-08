-- Ink colours: an optional purchase price per unit (per kilogram today).
-- Nullable, no backfill: the legacy table carried no price.
-- AlterTable
ALTER TABLE "InkColour" ADD COLUMN     "kiloPrice" DOUBLE PRECISION;
