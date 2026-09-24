/**
 * One-off backfill of `Order.metrageNecessaire` — docs/roll-allocation-plan.md §3.
 *
 *   pnpm --filter api db:backfill-metrage
 *
 * The column is part of the pricing snapshot and is rewritten on every save
 * by `OrderService.priced`, but the 398 migrated orders were saved before it
 * existed. This runs the same engine (`computeDimensions` +
 * `computeMetrageNecessaire`) over product and quantity and writes ONLY that
 * column: `pricingSource` and every other snapshot figure are untouched, so a
 * LEGACY order stays LEGACY. Verified beforehand that every order's stored
 * `productionWidthCm` / `cuttingLengthCm` equals what the engine gives from
 * its product, so the metres written here agree with the geometry shown.
 *
 * Orders whose product cannot be priced (grammage 0, 11 products) get NULL,
 * which the UI renders as "grammage missing". Idempotent: rerunning writes
 * the same values.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  computeDimensions,
  computeMetrageNecessaire,
  isIncompleteSpec,
  productSpecFromRow,
  quantityUnitFor,
} from "@repo/api-contract";
import { PrismaClient } from "../generated/prisma/client.js";

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const orders = await prisma.order.findMany({
      select: {
        id: true,
        numero: true,
        quantite: true,
        metrageNecessaire: true,
        product: {
          select: {
            typeSac: true,
            widthCm: true,
            lengthCm: true,
            gussetCm: true,
            pleatWidthCm: true,
            pleatLengthCm: true,
            grammage: true,
            paperType: true,
            hasHandle: true,
            handleWeightG: true,
          },
        },
      },
      orderBy: { numero: "asc" },
    });

    let written = 0;
    let nulled = 0;
    let unchanged = 0;
    const samples: string[] = [];

    for (const order of orders) {
      let metres: number | null = null;
      if (!isIncompleteSpec(order.product)) {
        const spec = productSpecFromRow(order.product);
        metres = computeMetrageNecessaire(
          computeDimensions(spec),
          quantityUnitFor(spec.typeSac),
          order.quantite,
        );
      }
      if (metres === order.metrageNecessaire) {
        unchanged += 1;
        continue;
      }
      await prisma.order.update({
        where: { id: order.id },
        data: { metrageNecessaire: metres },
        select: { id: true },
      });
      if (metres === null) nulled += 1;
      else written += 1;
      if (samples.length < 6) {
        samples.push(
          `${order.numero} ${order.product.typeSac} qty=${order.quantite} -> ${
            metres === null ? "NULL" : `${metres.toFixed(2)} m`
          }`,
        );
      }
    }

    console.log(
      `${orders.length} orders: ${written} written, ${nulled} set NULL (grammage 0), ${unchanged} unchanged`,
    );
    for (const line of samples) console.log(`  ${line}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
