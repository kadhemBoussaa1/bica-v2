/**
 * Creates the initial SUPER_ADMIN. No self-registration path exists and no
 * role can create a superior, so the first SUPER_ADMIN has to come from here;
 * after that, a SUPER_ADMIN can create its own peers in the app
 * (PEER_MANAGING_ROLES in @repo/api-contract).
 *
 * Idempotent — re-running reports the existing account instead of failing.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { getAuth } from "./auth/auth.js";

const email = process.env.SUPER_ADMIN_EMAIL;
const password = process.env.SUPER_ADMIN_PASSWORD;
const name = process.env.SUPER_ADMIN_NAME ?? "Super Admin";

async function main() {
  if (!email || !password) {
    throw new Error(
      "SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set (see apps/api/.env.example)",
    );
  }
  if (password.length < 12) {
    throw new Error("SUPER_ADMIN_PASSWORD must be at least 12 characters");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const existing = await prisma.user.findUnique({
      where: { email },
      include: { accounts: { where: { providerId: "credential" } } },
    });

    if (existing) {
      // A user row with no credential account cannot sign in. That happens if a
      // previous seed failed part-way, so remove it and recreate rather than
      // reporting a false success.
      if (existing.accounts.length > 0) {
        console.log(`Super admin already exists: ${email} (role: ${existing.role})`);
        return;
      }
      console.warn(`Found ${email} with no credentials — recreating.`);
      await prisma.user.delete({ where: { id: existing.id } });
    }

    const auth = await getAuth(prisma);
    const created = await auth.api.createUser({
      body: { email, password, name, role: "SUPER_ADMIN" },
    });

    await prisma.user.update({
      where: { id: created.user.id },
      data: { role: "SUPER_ADMIN", emailVerified: true },
    });

    console.log(`Created super admin: ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
