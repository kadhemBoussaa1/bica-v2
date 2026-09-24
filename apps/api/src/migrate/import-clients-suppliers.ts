/**
 * Imports legacy `client` (19 rows) and `fournisseur` (136 rows) into Client and
 * Supplier. Step 1 of the migration order in docs/legacy-migration.md.
 *
 *   pnpm --filter api db:import:step1
 *
 * Idempotent: rows are upserted on `legacyId`, so re-running updates in place
 * rather than duplicating. Safe to run after fixing a mapping and rebuilding.
 *
 * Read-only against the legacy database.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { legacyDate, legacyPool, supplierFamily, text, vatRate } from "./legacy.js";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const legacy = legacyPool();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    // ---- clients -----------------------------------------------------------
    const { rows: clients } = await legacy.query<{
      id: string;
      name: string;
      mat_fiscale: string | null;
      date_creation: string | null;
      image_url: string | null;
      created_by: string | null;
      adresse: string | null;
      email: string | null;
      phone1: string | null;
    }>(`SELECT id, name, mat_fiscale, date_creation::text AS date_creation, image_url, created_by,
               adresse, email, phone1
        FROM client ORDER BY id`);

    let clientCount = 0;
    for (const row of clients) {
      const name = text(row.name);
      if (name === null) {
        console.warn(`  skipped client ${row.id}: blank name`);
        continue;
      }

      const data = {
        name,
        taxId: text(row.mat_fiscale),
        address: text(row.adresse),
        email: text(row.email),
        phone: text(row.phone1),
        imageUrl: text(row.image_url),
        registeredAt: legacyDate(row.date_creation),
        legacyCreatedBy: text(row.created_by),
      };

      if (!dryRun) {
        await prisma.client.upsert({
          where: { legacyId: BigInt(row.id) },
          create: { ...data, legacyId: BigInt(row.id) },
          update: data,
        });
      }
      clientCount += 1;
    }
    console.log(`clients:   ${clientCount}/${clients.length}`);

    // ---- suppliers ---------------------------------------------------------
    const { rows: suppliers } = await legacy.query<{
      id: string;
      nom: string;
      mat_fiscale: string | null;
      adresse: string | null;
      email: string | null;
      phone1: string | null;
      phone2: string | null;
      tva: string | null;
      site_web: string | null;
      fax: string | null;
      famille: string | null;
    }>(`SELECT id, nom, mat_fiscale, adresse, email, phone1, phone2, tva,
               site_web, fax, famille
        FROM fournisseur ORDER BY id`);

    // Families are rows now, not an enum, so the legacy `famille` string maps to
    // a code and the code maps to an id. Read once rather than per supplier.
    const familyRows = await prisma.supplierFamily.findMany({
      select: { id: true, code: true },
    });
    const familyIdByCode = new Map(familyRows.map((row) => [row.code, row.id]));

    let supplierCount = 0;
    const unmappedFamilies = new Set<string>();
    const vatNotes: string[] = [];

    for (const row of suppliers) {
      const name = text(row.nom);
      if (name === null) {
        console.warn(`  skipped supplier ${row.id}: blank name`);
        continue;
      }

      const familyCode = supplierFamily(row.famille);
      const rawFamily = text(row.famille);
      if (familyCode === null && rawFamily !== null) {
        unmappedFamilies.add(rawFamily);
      }
      // A code with no row means the families table was changed after this
      // importer's mapping was written; report it rather than silently nulling.
      const familyId =
        familyCode === null ? null : (familyIdByCode.get(familyCode) ?? null);
      if (familyCode !== null && familyId === null) {
        unmappedFamilies.add(`${familyCode} (no SupplierFamily row)`);
      }

      const { rate, note } = vatRate(row.tva);
      if (note !== null) vatNotes.push(`${name}: ${note}`);

      const data = {
        name,
        taxId: text(row.mat_fiscale),
        address: text(row.adresse),
        email: text(row.email),
        phone: text(row.phone1),
        phone2: text(row.phone2),
        fax: text(row.fax),
        website: text(row.site_web),
        familyId,
        vatRate: rate,
        vatRateNote: note,
      };

      if (!dryRun) {
        await prisma.supplier.upsert({
          where: { legacyId: BigInt(row.id) },
          create: { ...data, legacyId: BigInt(row.id) },
          update: data,
        });
      }
      supplierCount += 1;
    }
    console.log(`suppliers: ${supplierCount}/${suppliers.length}`);

    // Report rather than hide: both lists need a human decision, not a default.
    if (unmappedFamilies.size > 0) {
      console.warn(`\nunmapped famille values (left null):`);
      for (const value of unmappedFamilies) console.warn(`  ${value}`);
    }
    if (vatNotes.length > 0) {
      console.warn(`\ntva kept as note, rate null:`);
      for (const value of vatNotes) console.warn(`  ${value}`);
    }
    if (dryRun) console.log("\n(dry run — nothing written)");
  } finally {
    await legacy.end();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
