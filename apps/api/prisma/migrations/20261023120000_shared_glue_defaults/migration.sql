-- Lets several glues be the default of the same order line (the user's
-- request, 2026-10-23). The key was the slot alone, so ticking a line on one
-- glue took it off the other; it becomes the pair. Existing rows already
-- satisfy the wider key, so nothing is copied or lost.

ALTER TABLE "PricingSlotDefault" DROP CONSTRAINT "PricingSlotDefault_pkey";

ALTER TABLE "PricingSlotDefault"
  ADD CONSTRAINT "PricingSlotDefault_pkey" PRIMARY KEY ("slot", "materialId");
