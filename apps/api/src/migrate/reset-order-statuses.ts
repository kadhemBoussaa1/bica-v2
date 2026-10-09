/**
 * One-off correction of order statuses carried over from the old app.
 *
 *   node dist/migrate/reset-order-statuses.js --in-production=744,743,... [--apply]
 *
 * The importer maps the old app's three booleans onto the lifecycle
 * (import-orders.ts `orderKindAndStatus`), and the old app never cleared
 * them reliably: orders long since delivered sit in DRAFT and PRODUCED. The
 * workshop listed by hand the orders actually on the floor (2026-10-09);
 * everything else that came from the old app is finished.
 *
 *   - every listed order        -> IN_PRODUCTION
 *   - every other imported ORDER not yet COMPLETED or CANCELLED -> COMPLETED,
 *     with `exportStatus = EXPORTED`, as `OrderService.transition` sets it
 *
 * Left exactly as they are, and reported:
 *   - quotes (they stay DRAFT quotes);
 *   - orders made in this app (no `legacyId`) that are not on the list;
 *   - imported orders someone has already moved in this app (a status change
 *     with a user) that are not on the list — that move is newer information
 *     than the old app's flags.
 *
 * Paper reservations and manufacturing orders are not touched, by decision.
 *
 * Written directly rather than through `OrderService.transition`: the
 * transition table has no DRAFT/PRODUCED -> COMPLETED edge, and
 * DRAFT -> IN_PRODUCTION would notify every production account once per
 * order. Each moved order still gets its `OrderStatusChange` row (no actor,
 * like the importer's) and the legacy flag mirror, in one transaction, so
 * its timeline shows the correction.
 *
 * Dry run unless `--apply`. `--apply` refuses while any listed number is
 * missing or is a quote — a misread number must be fixed, not skipped.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { legacyFlagsForStatus } from "@repo/api-contract";
import { PrismaClient } from "../generated/prisma/client.js";
import type { OrderStatus } from "../generated/prisma/enums.js";

const NOTE = "Correction du statut — reprise de l'ancienne application";

class DryRunRollback extends Error {}

function listedNumeros(): string[] {
  const arg = process.argv.find((value) => value.startsWith("--in-production="));
  if (!arg) throw new Error("missing --in-production=<numbers, comma-separated>");
  const numeros = arg
    .slice("--in-production=".length)
    .split(",")
    .map((value) => value.trim().toUpperCase().replace(/^CMD[-\s]?/, ""))
    .filter(Boolean)
    .map((value) => {
      if (!/^\d+$/.test(value)) throw new Error(`not an order number: "${value}"`);
      return `CMD-${value}`;
    });
  return [...new Set(numeros)];
}

async function main() {
  const apply = process.argv.includes("--apply");
  const listed = listedNumeros();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const lines: string[] = [];

  try {
    await prisma.$transaction(
      async (tx) => {
        const orders = await tx.order.findMany({
          select: {
            id: true,
            numero: true,
            kind: true,
            status: true,
            legacyId: true,
            statusChanges: { where: { byUserId: { not: null } }, select: { id: true }, take: 1 },
          },
        });
        const byNumero = new Map(orders.map((order) => [order.numero, order]));
        const listedSet = new Set(listed);

        const missing = listed.filter((numero) => !byNumero.has(numero));
        const quotes = listed.filter((numero) => byNumero.get(numero)?.kind === "QUOTE");

        // from-status -> ids, per target, so each group is one compare-and-set.
        const moves: Record<"IN_PRODUCTION" | "COMPLETED", Map<OrderStatus, string[]>> = {
          IN_PRODUCTION: new Map(),
          COMPLETED: new Map(),
        };
        const add = (to: keyof typeof moves, from: OrderStatus, id: string) =>
          moves[to].set(from, [...(moves[to].get(from) ?? []), id]);
        // Unproduced orders about to be closed: few, and the ones a wrong
        // list would hurt, so they are named for a read before --apply.
        const draftsClosed: string[] = [];
        const keptMadeHere: string[] = [];
        const keptMovedHere: string[] = [];

        for (const order of orders) {
          if (order.kind === "QUOTE") continue;
          if (listedSet.has(order.numero)) {
            if (order.status !== "IN_PRODUCTION") add("IN_PRODUCTION", order.status, order.id);
            continue;
          }
          if (order.status === "COMPLETED" || order.status === "CANCELLED") continue;
          if (order.legacyId === null) {
            keptMadeHere.push(`${order.numero} (${order.status})`);
          } else if (order.statusChanges.length > 0) {
            keptMovedHere.push(`${order.numero} (${order.status})`);
          } else {
            add("COMPLETED", order.status, order.id);
            if (order.status === "DRAFT") draftsClosed.push(order.numero);
          }
        }

        for (const to of ["IN_PRODUCTION", "COMPLETED"] as const) {
          let total = 0;
          for (const [from, ids] of moves[to]) {
            const { count } = await tx.order.updateMany({
              where: { id: { in: ids }, status: from },
              data: {
                status: to,
                ...(to === "COMPLETED" ? { exportStatus: "EXPORTED" as const } : {}),
                ...legacyFlagsForStatus("ORDER", to),
              },
            });
            if (count !== ids.length) {
              throw new Error(`${from} -> ${to}: expected ${ids.length} rows, updated ${count}`);
            }
            await tx.orderStatusChange.createMany({
              data: ids.map((orderId) => ({ orderId, fromStatus: from, toStatus: to, note: NOTE })),
            });
            lines.push(`  ${from} -> ${to}: ${ids.length}`);
            total += ids.length;
          }
          lines.push(`=> ${total} order(s) moved to ${to}`);
        }

        const after = await tx.order.groupBy({
          by: ["kind", "status"],
          _count: true,
          orderBy: [{ kind: "asc" }, { status: "asc" }],
        });
        lines.push("", "after:");
        for (const row of after) lines.push(`  ${row.kind} ${row.status}: ${row._count}`);

        lines.push("", `listed: ${listed.length}`);
        if (missing.length > 0) lines.push(`NOT FOUND (${missing.length}): ${missing.join(", ")}`);
        if (quotes.length > 0) lines.push(`QUOTES, left alone (${quotes.length}): ${quotes.join(", ")}`);
        if (draftsClosed.length > 0) {
          lines.push(`DRAFT, not listed, closed as COMPLETED: ${draftsClosed.join(", ")}`);
        }
        if (keptMadeHere.length > 0) {
          lines.push(`made in this app, not listed, left alone: ${keptMadeHere.join(", ")}`);
        }
        if (keptMovedHere.length > 0) {
          lines.push(`already moved in this app, not listed, left alone: ${keptMovedHere.join(", ")}`);
        }

        if (!apply) throw new DryRunRollback();
        if (missing.length > 0 || quotes.length > 0) {
          throw new Error("refusing --apply: fix the listed numbers above first");
        }
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    lines.push("", "APPLIED.");
  } catch (err) {
    if (!(err instanceof DryRunRollback)) {
      for (const line of lines) console.log(line);
      throw err;
    }
    lines.push("", "DRY RUN — nothing written. Re-run with --apply.");
  } finally {
    await prisma.$disconnect();
  }
  for (const line of lines) console.log(line);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
