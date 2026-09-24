/**
 * Creates a PRODUCTION account for every employee on the roster who has none,
 * and links it — docs/shift-planning-plan.md Phase 0.
 *
 *   pnpm --filter api db:employee-accounts --dry-run   # who would get what
 *   pnpm --filter api db:employee-accounts > accounts.csv
 *   pnpm --filter api db:employee-accounts --reset-password 003,017 > reset.csv
 *
 * `--reset-password` is for a lost sheet or a forgotten password: each named
 * employee's linked account gets a fresh temporary password, printed the same
 * way. Nothing else about the account changes.
 *
 * The CSV of temporary passwords goes to STDOUT ONLY; progress and warnings go
 * to stderr. Print the sheet, hand each line to its person, destroy the file.
 * No password persists anywhere but Better Auth's hash.
 *
 * Idempotent: linked employees are skipped, and a half-run is repaired on the
 * next run by the link-only branch (an existing unlinked PRODUCTION account
 * at the employee's email is linked rather than recreated). Any other account
 * at that email is left alone and reported: this never re-roles or
 * re-passwords an account it did not create.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { getAuth } from "../auth/auth.js";

/** Above `minPasswordLength` (12) in auth.ts, with a margin. */
const PASSWORD_LENGTH = 16;
/** Unambiguous: no 0/O, 1/l/I — it is read off paper and typed on a tablet. */
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function temporaryPassword(): string {
  const bytes = randomBytes(PASSWORD_LENGTH);
  let out = "";
  for (const byte of bytes) out += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
  return out;
}

/** "003" -> "003@bica.local"; anything outside [a-z0-9.-] becomes a dash. */
function generatedEmail(matricule: string): string {
  const slug = matricule.trim().toLowerCase().replace(/[^a-z0-9.-]+/g, "-");
  return `${slug}@bica.local`;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The matricules after `--reset-password`, or null when not asked. */
function resetList(argv: readonly string[]): string[] | null {
  const at = argv.indexOf("--reset-password");
  if (at === -1) return null;
  const raw = argv[at + 1];
  if (!raw || raw.startsWith("--")) {
    throw new Error("--reset-password needs a comma-separated list of matricules");
  }
  return raw.split(",").map((m) => m.trim()).filter(Boolean);
}

async function resetPasswords(prisma: PrismaClient, matricules: readonly string[]) {
  const auth = await getAuth(prisma);
  console.log("matricule,name,email,tempPassword");
  for (const matricule of matricules) {
    const employee = await prisma.employee.findUnique({
      where: { matricule },
      select: {
        matricule: true,
        firstName: true,
        lastName: true,
        user: { select: { id: true, email: true } },
      },
    });
    if (!employee) {
      console.error(`  ${matricule}: no such employee`);
      continue;
    }
    if (!employee.user) {
      console.error(`  ${matricule}: no linked account — run without --reset-password first`);
      continue;
    }
    const password = temporaryPassword();
    // Hashed by Better Auth's own hasher so sign-in verifies it, written to
    // the credential Account row directly: the admin plugin's set-password
    // route wants a session even when called server-side, and this script
    // has none. Sessions are left alone — a reset is for a lost sheet, not
    // a compromise.
    const hash = await (await auth.$context).password.hash(password);
    await prisma.account.updateMany({
      where: { userId: employee.user.id, providerId: "credential" },
      data: { password: hash },
    });
    const name = [employee.firstName, employee.lastName].filter(Boolean).join(" ") || matricule;
    console.error(`  reset    ${matricule} -> ${employee.user.email}`);
    console.log([matricule, name, employee.user.email, password].map(csvCell).join(","));
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL;
  if (!superAdminEmail) {
    throw new Error("SUPER_ADMIN_EMAIL must be set (see apps/api/.env.example)");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const log = (line: string) => console.error(line);

  try {
    const reset = resetList(process.argv);
    if (reset) {
      await resetPasswords(prisma, reset);
      return;
    }

    const actor = await prisma.user.findUnique({
      where: { email: superAdminEmail },
      select: { id: true },
    });
    if (!actor) {
      throw new Error(`${superAdminEmail} does not exist — run db:seed first`);
    }

    const employees = await prisma.employee.findMany({
      where: { active: true, suspended: false, userId: null },
      select: { id: true, matricule: true, firstName: true, lastName: true, email: true },
      orderBy: { matricule: "asc" },
    });
    log(`${dryRun ? "[dry run] " : ""}${employees.length} employees on the roster without an account`);

    const auth = dryRun ? null : await getAuth(prisma);

    let created = 0;
    let linked = 0;
    let generatedEmails = 0;
    const warnings: string[] = [];

    console.log("matricule,name,email,tempPassword");

    for (const employee of employees) {
      const name = [employee.firstName, employee.lastName].filter(Boolean).join(" ") || employee.matricule;
      const own = employee.email?.trim().toLowerCase();
      const email = own || generatedEmail(employee.matricule);
      if (!own) generatedEmails += 1;

      try {
        const existing = await prisma.user.findUnique({
          where: { email },
          select: { id: true, role: true, employee: { select: { id: true } } },
        });

        if (existing) {
          if (existing.role === "PRODUCTION" && existing.employee === null) {
            if (!dryRun) {
              await prisma.employee.update({
                where: { id: employee.id },
                data: { userId: existing.id },
              });
            }
            linked += 1;
            log(`  linked   ${employee.matricule} -> existing ${email}`);
            console.log([employee.matricule, name, email, ""].map(csvCell).join(","));
          } else {
            warnings.push(
              `${employee.matricule} (${name}): ${email} already belongs to a ${existing.role} account` +
                (existing.employee ? ` linked to employee ${existing.employee.id}` : "") +
                " — skipped, link by hand",
            );
          }
          continue;
        }

        const password = dryRun ? "" : temporaryPassword();
        if (!dryRun && auth) {
          const result = await auth.api.createUser({
            body: { email, password, name, role: "PRODUCTION" },
          });
          await prisma.user.update({
            where: { id: result.user.id },
            data: { role: "PRODUCTION", emailVerified: true, createdById: actor.id },
          });
          await prisma.employee.update({
            where: { id: employee.id },
            data: { userId: result.user.id },
          });
        }
        created += 1;
        log(`  ${dryRun ? "would create" : "created"} ${employee.matricule} -> ${email}`);
        console.log([employee.matricule, name, email, password].map(csvCell).join(","));
      } catch (cause) {
        warnings.push(
          `${employee.matricule} (${name}): ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }

    log("");
    log(`created: ${created}   linked to existing: ${linked}   generated addresses: ${generatedEmails}`);
    if (warnings.length > 0) {
      log(`warnings (${warnings.length}):`);
      for (const warning of warnings) log(`  - ${warning}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
