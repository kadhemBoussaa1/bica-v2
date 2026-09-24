/**
 * Trims the activity trace (docs/audit-log.md). Not scheduled: run by hand,
 * the `db:seed` way.
 *
 *   AUDIT_PURGE_DAYS=90 pnpm --filter api db:audit:purge        # dry run: counts only
 *   AUDIT_PURGE_DAYS=90 pnpm --filter api db:audit:purge --yes  # deletes
 *
 * Deletes rows with `at` older than the cutoff. QUERY rows only unless
 * `--all`: the reads are the bulk of the table and the writes are the
 * evidence. `AUDIT_PURGE_DAYS` has no default on purpose — a missing value
 * must never silently delete.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const raw = process.env.AUDIT_PURGE_DAYS;
  const days = raw === undefined ? NaN : Number(raw);
  if (!Number.isInteger(days) || days < 1) {
    throw new Error("AUDIT_PURGE_DAYS must be a positive integer (days to keep)");
  }
  // pnpm forwards a literal `--` when one is typed; it means nothing here.
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const confirmed = args.includes("--yes");
  const all = args.includes("--all");
  const unknown = args.filter((arg) => arg !== "--yes" && arg !== "--all");
  if (unknown.length > 0) {
    throw new Error(`Unknown argument(s): ${unknown.join(" ")} (expected --yes and/or --all)`);
  }

  const cutoff = new Date(Date.now() - days * DAY_MS);
  const where = {
    at: { lt: cutoff },
    ...(all ? {} : { kind: "QUERY" as const }),
  };

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const total = await prisma.auditLog.count();
    const matching = await prisma.auditLog.count({ where });
    console.log(
      `${matching} of ${total} AuditLog rows are ${all ? "" : "QUERY rows "}older than ${cutoff.toISOString()} (${days} days).`,
    );
    if (!confirmed) {
      console.log("Dry run — nothing deleted. Re-run with --yes to delete them.");
      return;
    }
    const { count } = await prisma.auditLog.deleteMany({ where });
    console.log(`Deleted ${count} rows.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
