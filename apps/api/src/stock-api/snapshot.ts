/**
 * Writes a `stock.snapshot` event now — docs/erp-stock-api.md. The daily one
 * is written by `StockPushService`; this is the "on demand, after a stock
 * count or a revaluation" the contract asks for.
 *
 *   pnpm --filter api stock:snapshot
 *
 * The event joins the log like any other: the next pull returns it and, if
 * the push is on, the running API sends it.
 */
import "dotenv/config";
import { PrismaService } from "../prisma.service";
import { StockApiService } from "./stock-api.service";

async function main() {
  const prisma = new PrismaService();
  try {
    const snapshot = await new StockApiService(prisma).createSnapshot();
    console.log(`Snapshot written as event ${snapshot.sequence} (${snapshot.asOf.toISOString()})`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((cause: unknown) => {
  console.error(cause);
  process.exitCode = 1;
});
