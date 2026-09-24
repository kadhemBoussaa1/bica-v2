/**
 * The engine's test suite: no test infrastructure exists (see CLAUDE.md), so
 * this script is what stands in for one. It loads every `Order` with its
 * `Product`, runs the engine independently of anything either the migration
 * SQL or `OrderService` computed, and compares against the stored snapshot.
 *
 *   pnpm --filter api db:verify-pricing
 *
 * Two comparison groups, for different reasons:
 *   - **dimensions** (productionWidthCm, cuttingLengthCm, unitWeightG) checks
 *     the migration SQL's copy of the per-type formulas against the engine —
 *     the only check that covers SOUS_PLAT weights, which a per-kilo price
 *     cannot exercise (SOUS_PLAT has no weight-derived unit price).
 *   - **prices** (unitPrice, unitPriceWithMargins, finalUnitPrice,
 *     finalParcelPrice) checks that the engine reproduces the legacy figures,
 *     which is the central claim of docs/product-pricing-plan.md.
 * `orderTotal` is reported separately, never folded into "prices": its
 * formula changed (parcelCount is now an exact fraction), so a mismatch there
 * is expected on every legacy order, not a bug.
 *
 * Read-only against the new database.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  isIncompleteSpec,
  pricingInputsFromRow,
  priceOrder,
  productSpecFromRow,
} from "@repo/api-contract";
import { PrismaClient } from "../generated/prisma/client.js";
import type { TypeSac } from "../generated/prisma/enums.js";

/** Both null, or within 0.1% of each other. */
function closeEnough(expected: number | null, actual: number | null): boolean {
  if (expected === null && actual === null) return true;
  if (expected === null || actual === null) return false;
  if (expected === 0) return Math.abs(actual) < 1e-9;
  return Math.abs((actual - expected) / expected) < 0.001;
}

interface Bucket {
  matched: number;
  mismatched: string[];
  unpriced: number;
}
function emptyBucket(): Bucket {
  return { matched: 0, mismatched: [], unpriced: 0 };
}

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const orders = await prisma.order.findMany({
      select: {
        numero: true,
        quantite: true,
        orderTotal: true,

        productionWidthCm: true,
        cuttingLengthCm: true,
        unitWeightG: true,
        unitPrice: true,
        unitPriceWithMargins: true,
        finalUnitPrice: true,
        finalParcelPrice: true,

        paperKiloPrice: true,
        profitMarginPct: true,
        lossMarginPct: true,
        handleGlueKiloPrice: true,
        handleGlueWeightG: true,
        sideGlueKiloPrice: true,
        sideGlueWeightG: true,
        baseAdhesiveKiloPrice: true,
        baseAdhesiveWeightG: true,
        legacyGlueCostPerUnit: true,
        piecesPerParcel: true,
        kilosPerParcel: true,
        parcelPrice: true,
        transportCost: true,

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
    });

    const dimensionsByType = new Map<TypeSac, Bucket>();
    const pricesByType = new Map<TypeSac, Bucket>();
    const parcelPricesByType = new Map<TypeSac, Bucket>();
    const incompleteByType = new Map<TypeSac, number>();
    let orderTotalMatched = 0;
    let orderTotalMismatched = 0;
    let orderTotalUnpriced = 0;

    for (const order of orders) {
      const typeSac = order.product.typeSac;
      if (!dimensionsByType.has(typeSac)) dimensionsByType.set(typeSac, emptyBucket());
      if (!pricesByType.has(typeSac)) pricesByType.set(typeSac, emptyBucket());
      if (!parcelPricesByType.has(typeSac)) parcelPricesByType.set(typeSac, emptyBucket());
      const dimBucket = dimensionsByType.get(typeSac);
      const priceBucket = pricesByType.get(typeSac);
      const parcelBucket = parcelPricesByType.get(typeSac);
      if (!dimBucket || !priceBucket || !parcelBucket) continue;

      if (isIncompleteSpec(order.product)) {
        incompleteByType.set(typeSac, (incompleteByType.get(typeSac) ?? 0) + 1);
        continue;
      }

      const spec = productSpecFromRow(order.product);
      const inputs = pricingInputsFromRow(order, order.quantite);
      const figures = priceOrder(spec, inputs);

      const dimensionsOk =
        closeEnough(order.productionWidthCm, figures.dimensions.productionWidthCm) &&
        closeEnough(order.cuttingLengthCm, figures.dimensions.cuttingLengthCm) &&
        closeEnough(order.unitWeightG, figures.dimensions.unitWeightG);
      if (dimensionsOk) {
        dimBucket.matched += 1;
      } else {
        dimBucket.mismatched.push(order.numero);
      }

      // Unit-level price: whether the engine reproduces the per-piece (or
      // per-kilogram) figure the legacy system stored. This is the plan's
      // central claim and is checked independently of the parcel price
      // below — a unit price can be exactly right on an order whose parcel
      // was simply never priced, or whose packing count is itself bad data.
      const hasStoredUnitPrice = order.unitPrice !== null;
      if (!hasStoredUnitPrice && figures.unitPrice === null) {
        priceBucket.unpriced += 1;
      } else {
        const unitPricesOk =
          closeEnough(order.unitPrice, figures.unitPrice) &&
          closeEnough(order.unitPriceWithMargins, figures.unitPriceWithMargins) &&
          closeEnough(order.finalUnitPrice, figures.finalUnitPrice);
        if (unitPricesOk) {
          priceBucket.matched += 1;
        } else {
          priceBucket.mismatched.push(order.numero);
        }
      }

      // Parcel-level price: depends on `piecesPerParcel`/`kilosPerParcel`
      // being present AND correct, which some legacy rows lack even when
      // their unit price is fine (no packing info was ever recorded) or
      // hold inconsistent data (a parcel price recorded against a zero
      // packing count). Reported separately so a unit-price success is
      // never hidden by an unrelated packing-data gap.
      const hasStoredParcelPrice = order.finalParcelPrice !== null;
      if (!hasStoredParcelPrice && figures.finalParcelPrice === null) {
        parcelBucket.unpriced += 1;
      } else if (closeEnough(order.finalParcelPrice, figures.finalParcelPrice)) {
        parcelBucket.matched += 1;
      } else {
        parcelBucket.mismatched.push(order.numero);
      }

      if (order.orderTotal === null && figures.orderTotal === null) {
        orderTotalUnpriced += 1;
      } else if (closeEnough(order.orderTotal, figures.orderTotal)) {
        orderTotalMatched += 1;
      } else {
        orderTotalMismatched += 1;
      }
    }

    console.log(`Verified ${orders.length} orders.\n`);

    console.log("Dimensions (productionWidthCm, cuttingLengthCm, unitWeightG):");
    for (const [typeSac, bucket] of [...dimensionsByType].sort(([a], [b]) => a.localeCompare(b))) {
      const total = bucket.matched + bucket.mismatched.length;
      console.log(`  ${typeSac}: ${bucket.matched}/${total} matched`);
      if (bucket.mismatched.length > 0) {
        console.log(`    mismatched: ${bucket.mismatched.join(", ")}`);
      }
    }

    console.log("\nUnit prices (unitPrice, unitPriceWithMargins, finalUnitPrice):");
    for (const [typeSac, bucket] of [...pricesByType].sort(([a], [b]) => a.localeCompare(b))) {
      const priced = bucket.matched + bucket.mismatched.length;
      console.log(
        `  ${typeSac}: ${bucket.matched}/${priced} matched, ${bucket.unpriced} unpriced` +
          (incompleteByType.get(typeSac) ? `, ${incompleteByType.get(typeSac)} incomplete` : ""),
      );
      if (bucket.mismatched.length > 0) {
        console.log(`    mismatched: ${bucket.mismatched.join(", ")}`);
      }
    }

    console.log(
      "\nParcel prices (finalParcelPrice — depends on piecesPerParcel/kilosPerParcel being" +
        " both present and correct, which some orders with a perfectly good unit price lack):",
    );
    for (const [typeSac, bucket] of [...parcelPricesByType].sort(([a], [b]) => a.localeCompare(b))) {
      const priced = bucket.matched + bucket.mismatched.length;
      console.log(`  ${typeSac}: ${bucket.matched}/${priced} matched, ${bucket.unpriced} unpriced`);
      if (bucket.mismatched.length > 0) {
        console.log(`    mismatched: ${bucket.mismatched.join(", ")}`);
      }
    }

    console.log(
      `\norderTotal (reported separately — the formula changed, mismatches are expected on legacy orders):`,
    );
    console.log(
      `  ${orderTotalMatched} matched, ${orderTotalMismatched} mismatched, ${orderTotalUnpriced} unpriced`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
