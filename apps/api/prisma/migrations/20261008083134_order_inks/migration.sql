-- Order inks (docs/order-inks-plan.md): the stock colours an order is printed
-- in, chosen by ADMIN+. A usage line must name one of them — the composite
-- foreign key on "InkUsage" enforces it — so the existing lines are
-- backfilled into "OrderInk" BEFORE that constraint is added.
-- CreateTable
CREATE TABLE "OrderInk" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "colourId" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderInk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderInk_colourId_idx" ON "OrderInk"("colourId");

-- CreateIndex
CREATE INDEX "OrderInk_addedById_idx" ON "OrderInk"("addedById");

-- CreateIndex
CREATE UNIQUE INDEX "OrderInk_orderId_colourId_key" ON "OrderInk"("orderId", "colourId");

-- Backfill: every (order, colour) already drawn from becomes a chosen colour,
-- so the foreign key below holds for the existing usage lines.
INSERT INTO "OrderInk" ("id", "orderId", "colourId", "createdAt")
SELECT gen_random_uuid()::text, "orderId", "colourId", MIN("createdAt")
FROM "InkUsage" GROUP BY "orderId", "colourId"
ON CONFLICT DO NOTHING;

-- AddForeignKey
ALTER TABLE "InkUsage" ADD CONSTRAINT "InkUsage_orderId_colourId_fkey" FOREIGN KEY ("orderId", "colourId") REFERENCES "OrderInk"("orderId", "colourId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderInk" ADD CONSTRAINT "OrderInk_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderInk" ADD CONSTRAINT "OrderInk_colourId_fkey" FOREIGN KEY ("colourId") REFERENCES "InkColour"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderInk" ADD CONSTRAINT "OrderInk_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
