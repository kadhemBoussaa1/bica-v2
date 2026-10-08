/**
 * Imports the legacy ink stock:
 *   - `couleur`          (79 in the 24-Sep dump) -> InkColour (+ its OPENING movement)
 *   - `commande_couleur` (27)                    -> InkUsage
 *
 * Step 8; requires step 3 (orders carry the `legacyId` usages resolve through).
 *
 *   pnpm --filter api db:import:step8 [--dry-run]
 *
 * Reads the **raw** legacy dump (LEGACY_RAW_DATABASE_URL) like step 7: the
 * ETL never carried these two tables, so the converted database lacks them.
 *
 * The legacy balance is the balance: the usage lines were already deducted
 * from `quantite_stock` in the old app, so they are copied as history and
 * never drawn again. Each new colour gets an OPENING movement at that
 * balance, which is where its v2 history starts.
 *
 * Idempotent on `legacyId`. A re-run updates a colour's code, name, unit and
 * threshold but never its balance: once a colour exists here its stock moves
 * through v2 (restock, adjust, usage), and overwriting it would silently undo
 * those. A colour whose code already belongs to a non-legacy colour is
 * reported and skipped, never merged. One transaction; `--dry-run` rolls back.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import type { InkUnit } from "../generated/prisma/enums.js";
import { legacyRawPool, text } from "./legacy.js";

type Row = Record<string, unknown>;

class DryRunRollback extends Error {}

function num(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const legacy = legacyRawPool();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const counts: string[] = [];
  const unresolved: string[] = [];

  try {
    const orders = await prisma.order.findMany({
      where: { legacyId: { not: null } },
      select: { id: true, legacyId: true },
    });
    const orderIds = new Map(orders.map((row) => [String(row.legacyId), row.id]));

    const colours = (
      await legacy.query<Row>(
        `SELECT id, code, nom, quantite_stock, seuil_alerte, unite FROM couleur ORDER BY id`,
      )
    ).rows;
    // Timestamps without a time zone, written in UTC by the Java app — see
    // import-pipeline.ts.
    const usages = (
      await legacy.query<Row>(
        `SELECT id, couleur_id, commande_id, quantite_utilisee,
                date_consommation AT TIME ZONE 'UTC' AS date_consommation
         FROM commande_couleur ORDER BY id`,
      )
    ).rows;

    await prisma.$transaction(
      async (tx) => {
        const colourIds = new Map<string, string>();
        let created = 0;
        let updated = 0;
        for (const row of colours) {
          const legacyId = BigInt(row.id as string);
          const code = text(row.code);
          if (!code) {
            unresolved.push(`couleur ${row.id}: no code`);
            continue;
          }
          const rawUnit = (text(row.unite) ?? "KG").toUpperCase();
          const unit: InkUnit = rawUnit === "L" ? "L" : "KG";
          if (rawUnit !== "KG" && rawUnit !== "L") unresolved.push(`couleur ${row.id}: unit "${rawUnit}" read as KG`);
          const meta = {
            code,
            name: text(row.nom),
            unit,
            alertThreshold: num(row.seuil_alerte),
          };

          const existing = await tx.inkColour.findFirst({
            where: { OR: [{ legacyId }, { code }] },
            select: { id: true, legacyId: true },
          });
          if (existing && existing.legacyId === null) {
            unresolved.push(`couleur ${row.id}: code ${code} is already a v2 colour — skipped`);
            continue;
          }
          if (existing) {
            await tx.inkColour.update({ where: { id: existing.id }, data: meta });
            colourIds.set(String(row.id), existing.id);
            updated += 1;
            continue;
          }

          const stock = Math.max(0, num(row.quantite_stock) ?? 0);
          const colour = await tx.inkColour.create({
            data: { ...meta, stock, legacyId },
            select: { id: true },
          });
          await tx.inkMovement.create({
            data: { colourId: colour.id, kind: "OPENING", delta: stock, balanceAfter: stock },
          });
          colourIds.set(String(row.id), colour.id);
          created += 1;
        }
        counts.push(`colours: ${colourIds.size}/${colours.length} (${created} new, ${updated} updated)`);

        let usageCount = 0;
        const missingOrders = new Set<string>();
        for (const row of usages) {
          const colourId = colourIds.get(String(row.couleur_id));
          const orderId = orderIds.get(String(row.commande_id));
          const quantity = num(row.quantite_utilisee);
          if (!orderId) missingOrders.add(String(row.commande_id));
          if (!colourId) unresolved.push(`commande_couleur ${row.id}: colour ${String(row.couleur_id)} not imported`);
          if (colourId && orderId && (quantity === null || quantity <= 0)) {
            unresolved.push(`commande_couleur ${row.id}: quantity ${String(row.quantite_utilisee)}`);
          }
          if (!colourId || !orderId || quantity === null || quantity <= 0) continue;
          const legacyId = BigInt(row.id as string);
          const data = {
            colourId,
            orderId,
            quantity,
            usedAt: row.date_consommation instanceof Date ? row.date_consommation : new Date(0),
          };
          // The pair first: a usage line may only name a colour chosen for
          // its order (the composite FK — docs/order-inks-plan.md §2), and a
          // re-run's `update` may move a line to another colour.
          await tx.orderInk.upsert({
            where: { orderId_colourId: { orderId, colourId } },
            create: { orderId, colourId },
            update: {},
          });
          await tx.inkUsage.upsert({ where: { legacyId }, create: { ...data, legacyId }, update: data });
          usageCount += 1;
        }
        counts.push(`usages:  ${usageCount}/${usages.length}`);
        if (missingOrders.size > 0) {
          counts.push(`orders not in this database (legacy ids): ${[...missingOrders].join(", ")}`);
        }

        if (dryRun) throw new DryRunRollback();
      },
      { timeout: 300_000, maxWait: 10_000 },
    );
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  } finally {
    for (const line of counts) console.log(line);
    if (unresolved.length > 0) {
      console.warn(`\nnot imported as-is:`);
      for (const value of unresolved) console.warn(`  ${value}`);
    }
    if (dryRun) console.log("\n(dry run — rolled back, nothing written)");
    await legacy.end();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
