/**
 * Imports legacy paper stock and production:
 *   - `import_model`   (32)   -> ImportShipment
 *   - `rouleau_import` (1688) -> PaperRoll
 *   - `production`     (942)  -> ProductionRun
 *   - `rouleau_commande` (214) -> RollAllocation
 *
 * Step 4 of the migration order in docs/legacy-migration.md; requires steps 1
 * to 3, because shipments reference suppliers, and production references
 * orders and employees.
 *
 *   pnpm --filter api db:import:step4
 *
 * Idempotent: every table upserts on `legacyId`, which is also the only thing
 * identifying a `PaperRoll` — see the model comment for why `numero` and
 * `code` are labels rather than keys.
 *
 * Read-only against the legacy database.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PAPER_TYPES } from "@repo/api-contract";
import { PrismaClient } from "../generated/prisma/client.js";
import type {
  AllocationState as PrismaAllocationState,
  PaperType as PrismaPaperType,
  ProductionUnit as PrismaProductionUnit,
} from "../generated/prisma/enums.js";
import { legacyDate, legacyPool, text } from "./legacy.js";

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // `production.quantite` is NUMERIC, which pg returns as a string.
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** For the NOT NULL numeric columns, where absent means 0. */
function numOr0(value: unknown): number {
  return num(value) ?? 0;
}

function int(value: unknown): number | null {
  const parsed = num(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** For the NOT NULL flags, where absent means the safe default. */
function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * A legacy `timestamp` column. Unlike a bare `DATE` this carries a real time
 * of day, so the driver's own parse is correct and it passes straight
 * through — `legacyDate` would flatten it to midnight and lose that.
 */
function timestamp(value: unknown): Date | null {
  return value instanceof Date ? value : null;
}

/**
 * Validates a legacy string against a closed enum rather than casting it.
 * An unknown value is reported through `unresolved` and imports as null, so
 * it cannot become a value the rest of the app has never heard of.
 */
function enumValue<T extends string>(
  allowed: readonly T[],
  raw: unknown,
  what: string,
  row: string,
  unresolved: string[],
): T | null {
  const value = text(raw);
  if (value === null) return null;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  unresolved.push(`${row}: unknown ${what} "${value}"`);
  return null;
}

const PRODUCTION_UNITS = ["PIECE", "METER"] as const;
/** Legacy enum `EtatAllocation`. CANCELED keeps the legacy single-L spelling. */
const ALLOCATION_STATES = ["RESERVED", "CONSUMED", "CANCELED"] as const;

/** Ignores spacing and case, so "PERE VALLS" matches "PEREVALLS". */
function normaliseSupplierName(name: string): string {
  return name.replace(/\s+/g, "").toUpperCase();
}

/**
 * Legacy supplier names that no normalisation rule reaches. Turkish "ve" is
 * "and", and the supplier row carries neither that nor the "SA" suffix, so
 * this one pair is spelled out rather than guessed at. Mirrors the mapping in
 * 20260903132927_shipment_supplier_required.
 */
const SUPPLIER_NAME_ALIASES = new Map<string, string>([
  [normaliseSupplierName("DURU SELULOZ VE KAGIT SA"), normaliseSupplierName("DURU SELULOZ & KAGIT")],
]);

/**
 * Legacy id -> new cuid, for each table orders/rolls/production point at.
 * Every one was imported with its `legacyId` preserved, which is what makes
 * this possible without a separate mapping table.
 */
async function foreignKeyMaps(prisma: PrismaClient) {
  const [suppliers, orders, employees] = await Promise.all([
    prisma.supplier.findMany({
      select: { id: true, legacyId: true, name: true },
    }),
    prisma.order.findMany({
      where: { legacyId: { not: null } },
      select: { id: true, legacyId: true },
    }),
    prisma.employee.findMany({
      where: { legacyId: { not: null } },
      select: { id: true, legacyId: true },
    }),
  ]);
  const asMap = (rows: { id: string; legacyId: bigint | null }[]) =>
    new Map(rows.map((row) => [String(row.legacyId), row.id]));
  return {
    suppliers: asMap(suppliers),
    orders: asMap(orders),
    employees: asMap(employees),
    /**
     * Supplier name -> id, keyed on a whitespace- and case-insensitive form.
     * `import_model.fournisseur_id` is null on 14 of 32 legacy rows even
     * though the supplier exists, and those rows recorded the same company as
     * both "PEREVALLS" and "PERE VALLS" — so a fresh import has to resolve by
     * name as well, or it cannot satisfy the now-required `supplierId`.
     */
    suppliersByName: new Map(
      suppliers.map((row) => [normaliseSupplierName(row.name), row.id]),
    ),
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const legacy = legacyPool();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const maps = await foreignKeyMaps(prisma);
    if (maps.orders.size === 0) {
      throw new Error(
        "No orders found. Run db:import:step3 first — production references orders.",
      );
    }

    const unresolved: string[] = [];
    const resolve = (
      map: Map<string, string>,
      value: unknown,
      what: string,
      row: string,
    ): string | null => {
      if (value === null || value === undefined) return null;
      const id = map.get(String(value));
      if (id === undefined) {
        unresolved.push(`${row}: ${what} ${String(value)}`);
        return null;
      }
      return id;
    };

    // ---- shipments --------------------------------------------------------

    const { rows: shipments } = await legacy.query<Record<string, unknown>>(
      // `date_import` as text: a bare DATE through the driver lands a day early.
      // See `legacyDate`.
      `SELECT *, date_import::text AS date_import FROM import_model ORDER BY id`,
    );

    let shipmentCount = 0;
    let skippedShipment = 0;
    /** Legacy import_model.id -> new cuid, for the roll pass below. */
    const shipmentIds = new Map<string, string>();

    for (const row of shipments) {
      const legacyId = BigInt(String(row.id));
      const label = text(row.numero_import) ?? `import_model ${String(row.id)}`;

      // `supplierId` is required, but the legacy row may only carry a name.
      // Try the id, then the name (normalised), then the explicit alias.
      const legacyName = text(row.fournisseur_name);
      const normalised = legacyName === null ? null : normaliseSupplierName(legacyName);
      const supplierId =
        resolve(maps.suppliers, row.fournisseur_id, "supplier", label) ??
        (normalised === null
          ? null
          : (maps.suppliersByName.get(normalised) ??
            maps.suppliersByName.get(SUPPLIER_NAME_ALIASES.get(normalised) ?? "") ??
            null));

      if (supplierId === null) {
        unresolved.push(
          `${label}: no supplier for "${legacyName ?? "(no name)"}" — create it, then re-run`,
        );
        skippedShipment += 1;
        continue;
      }

      const data = {
        // NOT NULL and unique in the legacy data on all 32 rows, so a blank
        // here would be a real problem rather than something to paper over.
        numeroImport: text(row.numero_import) ?? `LEGACY-${String(row.id)}`,
        dateImport: legacyDate(row.date_import),
        supplierId,
        productName: text(row.nom_produit),
        totalMetrage: num(row.total_metrage),
        totalRolls: int(row.total_rouleaux),
        price: num(row.prix),
        priceTotal: num(row.prix_total),
        currency: text(row.currency),
        transportIncluded: bool(row.transport_inclus),
        transportPrice: num(row.prix_transport),
        hasCertificate: bool(row.has_certificate),
        certificate: text(row.certificat),
        packingList: text(row.packing_list),
        importFile: text(row.fichier_import),
        observations: text(row.observations),
      };

      if (dryRun) {
        shipmentIds.set(String(row.id), "dry-run");
      } else {
        const saved = await prisma.importShipment.upsert({
          where: { legacyId },
          create: { ...data, legacyId },
          update: data,
          select: { id: true },
        });
        shipmentIds.set(String(row.id), saved.id);
      }
      shipmentCount += 1;
    }
    console.log(
      `shipments:  ${shipmentCount}/${shipments.length}` +
        (skippedShipment ? ` (${skippedShipment} skipped: no supplier)` : ""),
    );

    // ---- rolls ------------------------------------------------------------
    //
    // Two passes. A child roll can appear before its parent in id order, so
    // every row is written first with `parentId` left null, and the split
    // lineage is wired afterwards once every roll has a cuid. Doing it in one
    // pass would fail the self-FK on whichever child came first.

    const { rows: rolls } = await legacy.query<Record<string, unknown>>(
      `SELECT * FROM rouleau_import ORDER BY id`,
    );

    let rollCount = 0;
    /** Legacy rouleau_import.id -> new cuid. */
    const rollIds = new Map<string, string>();
    /** Legacy child id -> legacy parent id, applied in the second pass. */
    const rollParents = new Map<string, string>();

    for (const row of rolls) {
      const legacyId = BigInt(String(row.id));
      const label = `rouleau ${String(row.id)}`;

      const data = {
        numero: text(row.numero),
        numeroInterne: text(row.numero_interne),
        numeroSource: text(row.numero_source),
        paperGrade: text(row.code),
        description: text(row.description),

        metrage: num(row.metrage),
        metrageRestant: numOr0(row.metrage_restant),
        poids: num(row.poids),
        poidsRestant: numOr0(row.poids_restant),
        poidsReserve: numOr0(row.poids_reserve),

        laize: num(row.laize),
        grammage: int(row.grammage),
        paperType: enumValue(
          PAPER_TYPES,
          row.paper_type,
          "paper_type",
          label,
          unresolved,
        ) as PrismaPaperType | null,

        price: num(row.prix),
        priceWithTransport: num(row.prix_avec_transport),

        valide: bool(row.valide),
        disponible: boolOr(row.disponible, true),
        partiel: bool(row.partiel),
        reserved: bool(row.reserved),
        consomme: boolOr(row.consomme, false),
        archived: boolOr(row.archived, false),

        dateConsommation: timestamp(row.date_consommation),
        // Kept verbatim by decision: of 205 non-null legacy values, 151 look
        // like an order number, 120 are split notes ("Split by weight: ...")
        // and 123 are something else. Structuring it is data cleaning, not
        // something this import can decide. See docs/legacy-migration.md.
        consumedByNote: text(row.consomme_par),
        qrCodeUrl: text(row.qr_code_url),

        importShipmentId:
          row.import_id === null || row.import_id === undefined
            ? null
            : (shipmentIds.get(String(row.import_id)) ?? null),
      };

      if (row.import_id !== null && row.import_id !== undefined && !shipmentIds.has(String(row.import_id))) {
        unresolved.push(`${label}: import_model ${String(row.import_id)}`);
      }
      if (row.parent_id !== null && row.parent_id !== undefined) {
        rollParents.set(String(row.id), String(row.parent_id));
      }

      if (dryRun) {
        rollIds.set(String(row.id), "dry-run");
      } else {
        const saved = await prisma.paperRoll.upsert({
          where: { legacyId },
          create: { ...data, legacyId },
          update: data,
          select: { id: true },
        });
        rollIds.set(String(row.id), saved.id);
      }
      rollCount += 1;
    }

    // Second pass: the split lineage, now that every roll has an id.
    let lineageCount = 0;
    if (!dryRun) {
      for (const [childLegacyId, parentLegacyId] of rollParents) {
        const childId = rollIds.get(childLegacyId);
        const parentId = rollIds.get(parentLegacyId);
        if (childId === undefined || parentId === undefined) {
          unresolved.push(`rouleau ${childLegacyId}: parent ${parentLegacyId}`);
          continue;
        }
        await prisma.paperRoll.update({
          where: { id: childId },
          data: { parentId },
        });
        lineageCount += 1;
      }
    }
    console.log(
      `rolls:      ${rollCount}/${rolls.length}` +
        (dryRun ? ` (${rollParents.size} split links pending)` : ` (${lineageCount} split links)`),
    );

    // ---- production -------------------------------------------------------

    const { rows: runs } = await legacy.query<Record<string, unknown>>(
      // `date_production` as text — see `legacyDate`.
      `SELECT *, date_production::text AS date_production FROM production ORDER BY id`,
    );

    let runCount = 0;
    let skippedNoOrder = 0;

    for (const row of runs) {
      const legacyId = BigInt(String(row.id));
      const label = `production ${String(row.id)}`;

      // `orderId` is required: a run with no order is not a valid record, and
      // the legacy data has none. Reported and skipped rather than dropped
      // silently if that ever stops being true.
      const orderId = resolve(maps.orders, row.commande_id, "order", label);
      if (orderId === null) {
        unresolved.push(`${label}: no resolvable order, run skipped`);
        skippedNoOrder += 1;
        continue;
      }

      const productionDate = legacyDate(row.date_production);
      if (productionDate === null) {
        unresolved.push(`${label}: no date_production, run skipped`);
        skippedNoOrder += 1;
        continue;
      }

      const data = {
        dateProduction: productionDate,
        quantite: numOr0(row.quantite),
        unit: enumValue(
          PRODUCTION_UNITS,
          row.unit,
          "unit",
          label,
          unresolved,
        ) as PrismaProductionUnit | null,
        goodPieces: int(row.good_pieces),
        defectivePieces: int(row.defective_pieces),
        note: text(row.note),
        verifiedAt: timestamp(row.verified_at),
        // A typed-in name, not a user id — the same call as
        // `Client.legacyCreatedBy`.
        verifiedBy: text(row.verified_by),
        orderId,
        employeeId: resolve(maps.employees, row.employee_id, "employee", label),
      };

      if (!dryRun) {
        await prisma.productionRun.upsert({
          where: { legacyId },
          create: { ...data, legacyId },
          update: data,
          select: { id: true },
        });
      }
      runCount += 1;
    }
    console.log(
      `production: ${runCount}/${runs.length}` +
        (skippedNoOrder ? ` (${skippedNoOrder} skipped)` : ""),
    );

    // ---- allocations ------------------------------------------------------
    //
    // Runs last: an allocation references both an order and a reel, so both
    // passes above must have populated their id maps first.

    const { rows: allocations } = await legacy.query<Record<string, unknown>>(
      `SELECT * FROM rouleau_commande ORDER BY id`,
    );

    let allocationCount = 0;
    let skippedAllocation = 0;

    for (const row of allocations) {
      const legacyId = BigInt(String(row.id));
      const label = `allocation ${String(row.id)}`;

      // Both sides are required: an allocation naming neither an order nor a
      // reel is not a valid record. The legacy data has no such row (verified:
      // zero dangling on either side), so this reports rather than guesses.
      const orderId = resolve(maps.orders, row.commande_id, "order", label);
      const paperRollId =
        row.rouleau_id === null || row.rouleau_id === undefined
          ? null
          : (rollIds.get(String(row.rouleau_id)) ?? null);
      if (row.rouleau_id !== null && paperRollId === null) {
        unresolved.push(`${label}: rouleau ${String(row.rouleau_id)}`);
      }

      const state = enumValue(
        ALLOCATION_STATES,
        row.etat,
        "etat",
        label,
        unresolved,
      ) as PrismaAllocationState | null;

      const dateAllocation = timestamp(row.date_allocation);

      if (orderId === null || paperRollId === null || state === null || dateAllocation === null) {
        unresolved.push(`${label}: incomplete, allocation skipped`);
        skippedAllocation += 1;
        continue;
      }

      const data = {
        // NOT NULL in the legacy schema on every row.
        poidsReserve: numOr0(row.poids_reserve),
        // NULL on all 214 rows; carried in case it starts being used.
        metrageReserve: num(row.metrage_reserve),
        state,
        dateAllocation,
        dateConsommation: timestamp(row.date_consommation),
        dateAnnulation: timestamp(row.date_annulation),
        orderId,
        paperRollId,
      };

      if (!dryRun) {
        await prisma.rollAllocation.upsert({
          where: { legacyId },
          create: { ...data, legacyId },
          update: data,
          select: { id: true },
        });
      }
      allocationCount += 1;
    }
    console.log(
      `allocations: ${allocationCount}/${allocations.length}` +
        (skippedAllocation ? ` (${skippedAllocation} skipped)` : ""),
    );

    if (unresolved.length > 0) {
      console.warn(`\nreferences / enum values that did not resolve (left null, or row skipped):`);
      for (const value of unresolved.slice(0, 20)) console.warn(`  ${value}`);
      if (unresolved.length > 20) {
        console.warn(`  … and ${unresolved.length - 20} more`);
      }
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
