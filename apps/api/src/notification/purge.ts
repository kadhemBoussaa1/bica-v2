/**
 * Trims the bell (docs/notifications-plan.md §4.5). Not scheduled: run by
 * hand, like the audit purge it copies.
 *
 *   NOTIFICATION_PURGE_DAYS=90 pnpm --filter api db:notifications:purge        # dry run: counts only
 *   NOTIFICATION_PURGE_DAYS=90 pnpm --filter api db:notifications:purge --yes  # deletes
 *
 * Deletes READ rows created before the cutoff. Unread rows stay whatever
 * their age (plan fact 4): nobody has seen them yet. 90 is the agreed
 * value; `NOTIFICATION_PURGE_DAYS` has no default on purpose — a missing
 * value must never silently delete.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const raw = process.env.NOTIFICATION_PURGE_DAYS;
  const days = raw === undefined ? NaN : Number(raw);
  if (!Number.isInteger(days) || days < 1) {
    throw new Error("NOTIFICATION_PURGE_DAYS must be a positive integer (days to keep)");
  }
  // pnpm forwards a literal `--` when one is typed; it means nothing here.
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const confirmed = args.includes("--yes");
  const unknown = args.filter((arg) => arg !== "--yes");
  if (unknown.length > 0) {
    throw new Error(`Unknown argument(s): ${unknown.join(" ")} (expected --yes)`);
  }

  const cutoff = new Date(Date.now() - days * DAY_MS);
  const where = { readAt: { not: null }, createdAt: { lt: cutoff } };

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const total = await prisma.notification.count();
    const unreadOld = await prisma.notification.count({
      where: { readAt: null, createdAt: { lt: cutoff } },
    });
    const matching = await prisma.notification.count({ where });
    console.log(
      `${matching} of ${total} Notification rows are read and older than ${cutoff.toISOString()} (${days} days); ${unreadOld} unread rows that old are kept.`,
    );
    if (!confirmed) {
      console.log("Dry run — nothing deleted. Re-run with --yes to delete them.");
      return;
    }
    const { count } = await prisma.notification.deleteMany({ where });
    console.log(`Deleted ${count} rows.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
