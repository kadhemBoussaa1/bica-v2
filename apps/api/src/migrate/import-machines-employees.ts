/**
 * Imports legacy `machine` (22 rows) and `employee` (94 rows). Step 2 of the
 * migration order in docs/legacy-migration.md, and a prerequisite for orders:
 * `commande` references both.
 *
 *   pnpm --filter api db:import:step2
 *
 * Idempotent: rows are upserted on `legacyId`, so re-running updates in place.
 * Read-only against the legacy database.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import type { MachineType } from "../generated/prisma/enums.js";
import { department, jobTitle, legacyDate, legacyPool, text } from "./legacy.js";

/** Legacy numerics are `double precision`; null and NaN both mean "absent". */
function num(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const legacy = legacyPool();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    // ---- machines ----------------------------------------------------------
    //
    // Suppliers are already imported and carry their legacy id, so the FK is
    // resolved through that rather than a separate mapping table.
    const supplierRows = await prisma.supplier.findMany({
      where: { legacyId: { not: null } },
      select: { id: true, legacyId: true },
    });
    const supplierIdByLegacy = new Map(
      supplierRows.map((row) => [String(row.legacyId), row.id]),
    );

    const { rows: machines } = await legacy.query<Record<string, unknown>>(
      `SELECT id, name, code, price, brand, purchase_date::text AS purchase_date, image_url, invoice_url,
              machine_type, fournisseur_id, laize, laize_min, laize_max,
              grammage, grammage_min, grammage_max,
              grammage_min_without_handle, grammage_max_without_handle,
              grammage_min_with_handle, grammage_max_with_handle,
              grammage_min_kraft, grammage_max_kraft,
              grammage_min_laminated_kraft, grammage_max_laminated_kraft,
              length_min, length_max, width_min, width_max
       FROM machine ORDER BY id`,
    );

    let machineCount = 0;
    const missingSuppliers: string[] = [];

    for (const row of machines) {
      const name = text(row.name);
      const code = text(row.code);
      if (name === null || code === null) {
        console.warn(`  skipped machine ${String(row.id)}: blank name or code`);
        continue;
      }

      const legacySupplier = row.fournisseur_id;
      const supplierId =
        legacySupplier === null || legacySupplier === undefined
          ? null
          : (supplierIdByLegacy.get(String(legacySupplier)) ?? null);
      // A supplier id that resolves to nothing means the two imports disagree;
      // report it rather than silently unlinking the machine.
      if (legacySupplier != null && supplierId === null) {
        missingSuppliers.push(`${name} -> fournisseur ${String(legacySupplier)}`);
      }

      const data = {
        code,
        name,
        type: row.machine_type as MachineType,
        brand: text(row.brand),
        price: num(row.price),
        purchaseDate: legacyDate(row.purchase_date),
        imageUrl: text(row.image_url),
        invoiceUrl: text(row.invoice_url),
        supplierId,
        laize: num(row.laize),
        laizeMin: num(row.laize_min),
        laizeMax: num(row.laize_max),
        grammage: num(row.grammage),
        grammageMin: num(row.grammage_min),
        grammageMax: num(row.grammage_max),
        grammageMinWithoutHandle: num(row.grammage_min_without_handle),
        grammageMaxWithoutHandle: num(row.grammage_max_without_handle),
        grammageMinWithHandle: num(row.grammage_min_with_handle),
        grammageMaxWithHandle: num(row.grammage_max_with_handle),
        grammageMinKraft: num(row.grammage_min_kraft),
        grammageMaxKraft: num(row.grammage_max_kraft),
        grammageMinLaminatedKraft: num(row.grammage_min_laminated_kraft),
        grammageMaxLaminatedKraft: num(row.grammage_max_laminated_kraft),
        lengthMin: num(row.length_min),
        lengthMax: num(row.length_max),
        widthMin: num(row.width_min),
        widthMax: num(row.width_max),
      };

      if (!dryRun) {
        await prisma.machine.upsert({
          where: { legacyId: BigInt(String(row.id)) },
          create: { ...data, legacyId: BigInt(String(row.id)) },
          update: data,
        });
      }
      machineCount += 1;
    }
    console.log(`machines:  ${machineCount}/${machines.length}`);

    // ---- employees ---------------------------------------------------------
    const { rows: employees } = await legacy.query<Record<string, unknown>>(
      `SELECT id, matricule, firstname, lastname, department, job_title,
              employment_type, categorie, echelon, gender, email, phone_number,
              second_phone_number, hire_date::text AS hire_date,
              contract_end_date::text AS contract_end_date, photo,
              suspended, date_suspension::text AS date_suspension, raison_suspension,
              salary, salary_brut, cin, social_security_number, birth_date::text AS birth_date, address
       FROM employee ORDER BY id`,
    );

    let employeeCount = 0;
    const cleanedDepartments = new Map<string, string>();
    const cleanedJobTitles = new Map<string, string>();

    for (const row of employees) {
      const matricule = text(row.matricule);
      const firstName = text(row.firstname);
      const lastName = text(row.lastname);
      if (matricule === null || (firstName === null && lastName === null)) {
        console.warn(`  skipped employee ${String(row.id)}: no matricule or name`);
        continue;
      }

      const rawDept = text(row.department);
      const dept = department(row.department);
      if (rawDept !== null && dept !== null && rawDept !== dept) {
        cleanedDepartments.set(rawDept, dept);
      }

      const rawTitle = text(row.job_title);
      const title = jobTitle(row.job_title);
      if (rawTitle !== null && title !== null && rawTitle !== title) {
        cleanedJobTitles.set(rawTitle, title);
      }

      const data = {
        matricule,
        // A row with only one of the two names keeps the other empty rather
        // than duplicating it, so nothing is invented.
        firstName: firstName ?? "",
        lastName: lastName ?? "",
        department: dept,
        jobTitle: title,
        employmentType: text(row.employment_type),
        categorie: text(row.categorie),
        echelon: text(row.echelon),
        gender: text(row.gender),
        email: text(row.email),
        phone: text(row.phone_number),
        phone2: text(row.second_phone_number),
        hireDate: legacyDate(row.hire_date),
        contractEndDate: legacyDate(row.contract_end_date),
        photo: text(row.photo),
        suspended: row.suspended === true,
        suspendedAt: legacyDate(row.date_suspension),
        suspensionReason: text(row.raison_suspension),
        salary: num(row.salary),
        salaryGross: num(row.salary_brut),
        cin: text(row.cin),
        socialSecurityNumber: text(row.social_security_number),
        birthDate: legacyDate(row.birth_date),
        address: text(row.address),
      };

      if (!dryRun) {
        await prisma.employee.upsert({
          where: { legacyId: BigInt(String(row.id)) },
          create: { ...data, legacyId: BigInt(String(row.id)) },
          update: data,
        });
      }
      employeeCount += 1;
    }
    console.log(`employees: ${employeeCount}/${employees.length}`);

    // Report rather than hide: these need a human to confirm, not a default.
    if (missingSuppliers.length > 0) {
      console.warn(`\nmachines whose supplier did not resolve:`);
      for (const value of missingSuppliers) console.warn(`  ${value}`);
    }
    if (cleanedDepartments.size > 0) {
      console.log(`\ndepartments normalised:`);
      for (const [from, to] of cleanedDepartments) console.log(`  ${from} -> ${to}`);
    }
    if (cleanedJobTitles.size > 0) {
      console.log(`\njob titles normalised:`);
      for (const [from, to] of cleanedJobTitles) console.log(`  ${from} -> ${to}`);
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
