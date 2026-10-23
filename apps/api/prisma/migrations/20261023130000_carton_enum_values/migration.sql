-- Cartons join the material catalogue (docs/raw-material-prices-plan.md,
-- "Addition 2026-10-23: cartons"): a third material type and a fifth order
-- price line. In a migration of their own because Postgres refuses to use an
-- enum value in the transaction that added it, and the CHECKs in
-- 20261023130100_cartons name both.

-- AlterEnum
ALTER TYPE "RawMaterialType" ADD VALUE 'BOX';

-- AlterEnum
ALTER TYPE "PricingSlot" ADD VALUE 'CARTON';
