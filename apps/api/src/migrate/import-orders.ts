/**
 * Imports legacy `commande` (397 rows) and its `produit` print colours (522).
 * Step 3 of the migration order in docs/legacy-migration.md; requires steps 1
 * and 2, because orders reference clients, machines and employees.
 *
 *   pnpm --filter api db:import:step3
 *
 * Idempotent: orders upsert on `legacyId`. Colours are deleted and re-inserted
 * per order rather than upserted — see the note at the colour loop.
 *
 * Each commande also resolves (or creates) a `Product` — see
 * `resolveProduct` below for why that resolution does not depend on the
 * generated-name string matching byte-for-byte with the migration SQL.
 *
 * `kind`/`status` are computed with the exact same five-bucket mapping as the
 * `20260907125517_order_lifecycle` migration's backfill — see
 * docs/order-lifecycle-plan.md §4 and §5 (this file is the one named there
 * as needing to be "ported to apply the §4 mapping directly", the option
 * chosen over retiring the importer, since upsert-on-legacyId makes it safe
 * to re-run against a refreshed legacy export). The `OrderStatusChange` row
 * for the mapped status is written ONLY on first insert (the `create` branch
 * of the upsert below), never on `update` — otherwise a re-run would append
 * a duplicate log row per order every time, corrupting the one thing this
 * table exists to make trustworthy.
 *
 * Read-only against the legacy database.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  EXPORT_STATUSES,
  PAPER_TYPES,
  TYPE_IMPRESSIONS,
  TYPE_SACS,
  legacyFlagsForStatus,
  normaliseProductSpec,
  type ProductSpec,
  type TypeSac,
} from "@repo/api-contract";
import { PrismaClient } from "../generated/prisma/client.js";
import type {
  ExportStatus as PrismaExportStatus,
  OrderKind as PrismaOrderKind,
  OrderStatus as PrismaOrderStatus,
  QuantityUnit as PrismaQuantityUnit,
  TypeImpression as PrismaTypeImpression,
} from "../generated/prisma/enums.js";
import { findOrCreateProduct, generatedProductName, type ProductKey } from "../product/product.match.js";
import { legacyPool, text } from "./legacy.js";

function num(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

/** For the three NOT NULL numeric columns, where absent means 0. */
function numOr0(value: unknown): number {
  return num(value) ?? 0;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * The exact five-bucket mapping from docs/order-lifecycle-plan.md §4,
 * evaluated top to bottom as written — NOT as independent predicates, for
 * the same reason as the migration SQL: the historic skip-state orders
 * (`okExport` true without ever being `produitFini`) must land in bucket 2,
 * not fall through past it. Kept as its own function, rather than inlined,
 * so it stays trivially comparable to the migration SQL's five UPDATEs by
 * eye if the mapping is ever revisited.
 */
function orderKindAndStatus(flags: {
  offreDePrix: boolean | null;
  okExport: boolean | null;
  okFacturation: boolean | null;
  produitFini: boolean | null;
}): { kind: PrismaOrderKind; status: PrismaOrderStatus } {
  if (flags.offreDePrix === true) return { kind: "QUOTE", status: "DRAFT" };
  if (flags.okExport === true) return { kind: "ORDER", status: "COMPLETED" };
  if (flags.okFacturation === true) return { kind: "ORDER", status: "INVOICED" };
  if (flags.produitFini === true) return { kind: "ORDER", status: "PRODUCED" };
  return { kind: "ORDER", status: "DRAFT" };
}

/** Nonzero legacy figure, else null — matches the engine's own `positive()`. */
function positiveOrNull(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

/**
 * Validates a legacy string against one of the contract's closed enums,
 * rather than casting it. An unknown value is reported through `unresolved`
 * (same list the foreign-key resolution uses) and imports as null, instead of
 * silently becoming a value the rest of the app has never heard of.
 */
function enumValue<T extends string>(
  allowed: readonly T[],
  raw: unknown,
  what: string,
  order: string,
  unresolved: string[],
): T | null {
  const value = text(raw);
  if (value === null) return null;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  unresolved.push(`${order}: unknown ${what} "${value}"`);
  return null;
}

/**
 * Builds a legacy-id -> new-cuid map for the tables orders point at. Each was
 * imported with its `legacyId` preserved, which is what makes this possible
 * without a separate mapping table.
 *
 * Only clients now: the worker and machine links were removed with the
 * assignment model, so those maps would be built and never read.
 */
async function foreignKeyMaps(prisma: PrismaClient) {
  const clients = await prisma.client.findMany({
    where: { legacyId: { not: null } },
    select: { id: true, legacyId: true },
  });
  return {
    clients: new Map(clients.map((row) => [String(row.legacyId), row.id])),
  };
}

/**
 * The commande's bag spec, normalised to `ProductSpec` plus the identity
 * fields `findOrCreateProduct` needs. `hasHandle` and the SOUS_PLAT
 * null-outs go through `normaliseProductSpec` — the one place that rule is
 * defined, shared with `ProductService` and the migration SQL's temp table.
 */
function deriveProductKey(
  row: Record<string, unknown>,
  typeSac: TypeSac,
  clientId: string | null,
  unresolved: string[],
  numero: string,
): ProductKey {
  const paperType = enumValue(PAPER_TYPES, row.paper_type, "paper_type", numero, unresolved);
  const widthCm = numOr0(row.largeur);
  const lengthCm = numOr0(row.longueur);
  const rawGusset = num(row.soufflet);
  const poidsPoigner = num(row.poids_poigner);

  const spec: ProductSpec = {
    typeSac,
    widthCm,
    lengthCm,
    gussetCm: typeSac === "SOUS_PLAT" ? null : (rawGusset ?? 0),
    pleatWidthCm: typeSac === "SOUS_PLAT" ? null : num(row.pli_en_largeur),
    pleatLengthCm: typeSac === "SOUS_PLAT" ? null : num(row.pli_en_longueur),
    grammage: numOr0(row.grammage),
    hasHandle: typeSac !== "SOUS_PLAT" && (poidsPoigner ?? 0) > 0,
    handleWeightG: typeSac !== "SOUS_PLAT" && (poidsPoigner ?? 0) > 0 ? poidsPoigner : null,
  };
  const normalised = normaliseProductSpec(spec);

  const rawName = text(row.product_name);
  const name = rawName ?? generatedProductName(typeSac, widthCm, lengthCm, normalised.gussetCm, normalised.grammage);

  return { ...normalised, name, clientId, paperType };
}

/**
 * Resolves the `Product` for one commande, in two steps so a re-run does not
 * depend on the generated name matching the migration SQL byte-for-byte:
 *
 *   1. If an `Order` with this `legacyId` already exists (true on every
 *      re-run after the initial migration or a prior import), load its
 *      current product. If that product's client and normalised spec still
 *      equal `key` — name deliberately NOT compared, since it may be the
 *      migration's generated string rather than this run's — reuse its id.
 *      This is what makes `db:import:step3` idempotent against the 354
 *      products the migration already created, without either side needing
 *      to reproduce the other's name formatting.
 *   2. Otherwise, `findOrCreateProduct`. Only reachable on a fresh import
 *      into a database the migration never touched, where the generated name
 *      here is the only name that will ever exist for that spec.
 */
async function resolveProduct(
  prisma: PrismaClient,
  legacyId: bigint,
  key: ProductKey,
): Promise<string> {
  const existingOrder = await prisma.order.findUnique({
    where: { legacyId },
    select: {
      product: {
        select: {
          id: true,
          clientId: true,
          typeSac: true,
          widthCm: true,
          lengthCm: true,
          gussetCm: true,
          pleatWidthCm: true,
          pleatLengthCm: true,
          grammage: true,
          paperType: true,
          hasHandle: true,
          handleWeightG: true,
        },
      },
    },
  });
  const current = existingOrder?.product;
  if (
    current &&
    current.clientId === key.clientId &&
    current.typeSac === key.typeSac &&
    current.widthCm === key.widthCm &&
    current.lengthCm === key.lengthCm &&
    current.gussetCm === key.gussetCm &&
    current.pleatWidthCm === key.pleatWidthCm &&
    current.pleatLengthCm === key.pleatLengthCm &&
    current.grammage === key.grammage &&
    current.paperType === key.paperType &&
    current.hasHandle === key.hasHandle &&
    current.handleWeightG === key.handleWeightG
  ) {
    return current.id;
  }

  const created = await findOrCreateProduct(prisma, key, { id: true });
  return created.id;
}

/**
 * Merges a commande's legacy artwork onto its product, as a **union** of what
 * is already there — the same rule the `20260903110836_product_images`
 * migration used to move 467 URLs off `Order`.
 *
 * Union, not replace, for two reasons: several orders can share one product
 * and each may carry different job artwork (30 products in the migrated data
 * do), and a re-run must converge on the same result as the migration rather
 * than letting whichever order happens to be imported last win.
 *
 * Skips the write entirely when there is nothing new, so a re-run over
 * unchanged data touches no rows.
 */
async function mergeProductImages(
  prisma: PrismaClient,
  productId: string,
  legacyImages: string[],
): Promise<void> {
  if (legacyImages.length === 0) return;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { images: true },
  });
  if (!product) return;

  const merged = [...new Set([...product.images, ...legacyImages])].sort();
  const unchanged =
    merged.length === product.images.length &&
    merged.every((url, i) => url === product.images[i]);
  if (unchanged) return;

  await prisma.product.update({
    where: { id: productId },
    data: { images: merged },
  });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const legacy = legacyPool();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const maps = await foreignKeyMaps(prisma);
    if (maps.clients.size === 0) {
      throw new Error(
        "No clients found. Run db:import:step1 first — orders reference clients.",
      );
    }

    const { rows: orders } = await legacy.query<Record<string, unknown>>(
      `SELECT * FROM commande ORDER BY id`,
    );

    /** Legacy FK -> resolved id, recording anything that fails to resolve. */
    const unresolved: string[] = [];
    const resolve = (
      map: Map<string, string>,
      value: unknown,
      what: string,
      order: string,
    ): string | null => {
      if (value === null || value === undefined) return null;
      const id = map.get(String(value));
      if (id === undefined) {
        unresolved.push(`${order}: ${what} ${String(value)}`);
        return null;
      }
      return id;
    };

    let orderCount = 0;
    let skippedNoType = 0;
    const importedOrderIds: string[] = [];
    const legacyToNewId = new Map<string, string>();

    for (const row of orders) {
      const numero = text(row.numero_commande);
      if (numero === null) {
        console.warn(`  skipped commande ${String(row.id)}: blank numero`);
        continue;
      }

      const legacyId = BigInt(String(row.id));
      const clientId = resolve(maps.clients, row.client_id, "client", numero);

      // Product requires a bag type; the migration's own guard rejects any
      // order without one, so a commande missing type_sac cannot be given a
      // product here either. Reported, not silently dropped.
      const typeSac = enumValue(TYPE_SACS, row.type_sac, "type_sac", numero, unresolved);
      if (typeSac === null) {
        unresolved.push(`${numero}: no usable type_sac, order skipped`);
        skippedNoType += 1;
        continue;
      }

      const productKey = deriveProductKey(row, typeSac, clientId, unresolved, numero);
      const { kind, status } = orderKindAndStatus({
        offreDePrix: bool(row.offre_de_prix),
        okExport: bool(row.ok_export),
        okFacturation: bool(row.ok_facturation),
        produitFini: bool(row.produit_fini),
      });
      // Legacy `export_status` was a free string; blank means "not started",
      // which is null here rather than a third enum value.
      const exportStatus = enumValue(
        EXPORT_STATUSES,
        row.export_status,
        "export_status",
        numero,
        unresolved,
      ) as PrismaExportStatus | null;
      const typeImpression = enumValue(
        TYPE_IMPRESSIONS,
        row.type_impression,
        "type_impression",
        numero,
        unresolved,
      ) as PrismaTypeImpression | null;

      const quantityUnit: PrismaQuantityUnit = typeSac === "SOUS_PLAT" ? "KILOGRAMS" : "PIECES";

      // Legacy glue cost per piece = colleN_prix_total / colleN_quantite, per
      // line, summed — same formula as migration.sql step 9. Null (not 0)
      // when neither line has a price.
      const colle1Total = num(row.colle1_prix_total);
      const colle1Qty = num(row.colle1_quantite);
      const colle2Total = num(row.colle2_prix_total);
      const colle2Qty = num(row.colle2_quantite);
      const legacyGlueCostPerUnit =
        (colle1Total ?? 0) === 0 && (colle2Total ?? 0) === 0
          ? null
          : (colle1Total && colle1Qty ? colle1Total / colle1Qty : 0) +
            (colle2Total && colle2Qty ? colle2Total / colle2Qty : 0);

      const prixUnitaire = num(row.prix_unitaire);
      const marge = num(row.marge);
      const tauxPerte = num(row.taux_perte);
      // Recomputed, not copied: legacy stored 0 in
      // prix_unitaire_avec_marge_et_perte whenever marge = 0, a "not
      // computed" sentinel rather than a real price of 0.
      const unitPriceWithMargins =
        prixUnitaire === null || prixUnitaire === 0
          ? null
          : prixUnitaire * (1 + (marge ?? 0) / 100) * (1 + (tauxPerte ?? 0) / 100);

      const data = {
        numero,
        description: text(row.description),
        clientId,

        quantite: numOr0(row.quantite),
        quantityUnit,

        paperKiloPrice: num(row.prix_kilo),
        profitMarginPct: marge,
        lossMarginPct: tauxPerte,

        // No new glue lines on a migrated order — only the legacy fallback.
        handleGlueKiloPrice: null,
        handleGlueWeightG: null,
        sideGlueKiloPrice: null,
        sideGlueWeightG: null,
        baseAdhesiveKiloPrice: null,
        baseAdhesiveWeightG: null,
        legacyGlueCostPerUnit,

        piecesPerParcel: num(row.nombre_de_piece_par_colis),
        kilosPerParcel: num(row.kilo_par_colis),
        parcelPrice: num(row.prix_carton),
        transportCost: num(row.prix_transport),

        pricingSource: "LEGACY" as const,

        unitPrice: positiveOrNull(prixUnitaire),
        unitPriceWithMargins,
        finalParcelPrice: positiveOrNull(num(row.prix_colis)),
        orderTotal: positiveOrNull(num(row.prix_total)),
        // productionWidthCm / cuttingLengthCm / unitWeightG / glueCostPerUnit /
        // finalUnitPrice / baseParcelPrice / parcelCount are left null here:
        // they depend on the resolved Product and are filled in below, once
        // the product (and therefore its spec) is known.

        // The raw legacy booleans feed `orderKindAndStatus` below; they are
        // not stored on the row themselves. `kind`/`status` are the source of
        // truth from here on, and `legacyFlagsForStatus` regenerates the four
        // booleans as a derived mirror — the exact same relationship
        // `OrderService` maintains for orders created through the app, so an
        // order from either path looks identical to an old reader that still
        // checks a boolean. Verified to round-trip exactly onto the raw
        // values for all five §4 buckets before this was wired in.
        ...legacyFlagsForStatus(kind, status),
        kind,
        status,
        exportStatus,

        // `poids_necessaire` is not carried: the need is now computed in
        // metres (`metrageNecessaire`, `db:backfill-metrage`). The two
        // running totals stay as importer-only columns.
        poidsReserve: numOr0(row.poids_reserve),
        poidsConsomme: numOr0(row.poids_consomme),

        // The legacy worker and machine links are deliberately NOT imported:
        // orders are no longer assigned. `assigned_worker_id`,
        // `machine_production_id`, `machine_impression_id` and
        // `impression_employee_id` stay in the legacy database only.
        typeImpression,

        // Legacy `commande.images` no longer lands here — artwork belongs to
        // the product now. Carried in `legacyImages` below and merged onto
        // the resolved product instead.
      };
      const legacyImages = Array.isArray(row.images) ? (row.images as string[]) : [];

      if (dryRun) {
        // A placeholder id keeps the colour pass below meaningful in a dry run:
        // without it every colour would be reported as an orphan.
        legacyToNewId.set(String(row.id), "dry-run");
      } else {
        const productId = await resolveProduct(prisma, legacyId, productKey);
        await mergeProductImages(prisma, productId, legacyImages);

        // Dimensions and weight depend on the resolved product's spec, so
        // this second pass runs after resolveProduct — the same ordering the
        // migration SQL uses (its update splits on the same dependency).
        const s = normaliseProductSpec({
          typeSac,
          widthCm: productKey.widthCm,
          lengthCm: productKey.lengthCm,
          gussetCm: productKey.gussetCm,
          pleatWidthCm: productKey.pleatWidthCm,
          pleatLengthCm: productKey.pleatLengthCm,
          grammage: productKey.grammage,
          hasHandle: productKey.hasHandle,
          handleWeightG: productKey.handleWeightG,
        });
        const productionWidthCm =
          typeSac === "SOUS_PLAT" ? s.widthCm : (s.widthCm + (s.gussetCm ?? 0)) * 2 + (s.pleatWidthCm ?? 0);
        const cuttingLengthCm =
          typeSac === "FOND_CARRE"
            ? s.lengthCm + (s.gussetCm ?? 0) / 2 + (s.pleatLengthCm ?? 0)
            : typeSac === "FOND_V"
              ? s.lengthCm + (s.pleatLengthCm ?? 0)
              : s.lengthCm;
        const unitWeightG =
          (productionWidthCm * cuttingLengthCm * s.grammage) / 10000 + (s.hasHandle ? (s.handleWeightG ?? 0) : 0);
        const finalUnitPrice =
          data.unitPriceWithMargins === null
            ? null
            : data.unitPriceWithMargins + (legacyGlueCostPerUnit ?? 0);
        const baseParcelPrice =
          data.finalParcelPrice === null
            ? null
            : data.finalParcelPrice - (data.parcelPrice ?? 0) - (data.transportCost ?? 0);
        const unitsPerParcel = quantityUnit === "KILOGRAMS" ? data.kilosPerParcel : data.piecesPerParcel;
        const parcelCount = unitsPerParcel && unitsPerParcel !== 0 ? data.quantite / unitsPerParcel : null;

        const saved = await prisma.order.upsert({
          where: { legacyId },
          create: {
            ...data,
            productId,
            productionWidthCm,
            cuttingLengthCm,
            unitWeightG,
            glueCostPerUnit: legacyGlueCostPerUnit ?? 0,
            finalUnitPrice,
            baseParcelPrice,
            parcelCount,
            legacyId,
            // Nested create, first insert ONLY — see this file's header
            // comment on why this must never also be in `update` below.
            // Matches the migration SQL's own one-row-per-order rule (plan
            // §4): `fromStatus = null` marks the start, not a transition.
            statusChanges: {
              create: {
                fromStatus: null,
                toStatus: status,
                byUserId: null,
                note: "migrated from legacy workflow flags",
              },
            },
          },
          update: {
            ...data,
            productId,
            productionWidthCm,
            cuttingLengthCm,
            unitWeightG,
            glueCostPerUnit: legacyGlueCostPerUnit ?? 0,
            finalUnitPrice,
            baseParcelPrice,
            parcelCount,
            // No `statusChanges` here — see the `create` branch's comment.
          },
          select: { id: true },
        });
        legacyToNewId.set(String(row.id), saved.id);
        importedOrderIds.push(saved.id);
      }
      orderCount += 1;
    }
    console.log(`orders:  ${orderCount}/${orders.length}` + (skippedNoType ? ` (${skippedNoType} skipped: no type_sac)` : ""));

    // ---- print colours -----------------------------------------------------
    //
    // Replaced per order rather than upserted on legacyId: a colour has no
    // natural key beyond its legacy id, and replacing keeps a re-run in step
    // with the source even if a colour was deleted there. Scoped to the
    // orders touched by THIS run — not a blanket `deleteMany({})` — so a
    // partial re-run (e.g. after fixing one bad row) cannot wipe colours on
    // orders it did not revisit.
    const { rows: colours } = await legacy.query<Record<string, unknown>>(
      `SELECT id, nom, prix, commande_id FROM produit ORDER BY commande_id, id`,
    );

    let colourCount = 0;
    const orphanColours: string[] = [];

    if (!dryRun && importedOrderIds.length > 0) {
      await prisma.orderColour.deleteMany({ where: { orderId: { in: importedOrderIds } } });
    }

    for (const row of colours) {
      const orderId = legacyToNewId.get(String(row.commande_id));
      if (orderId === undefined) {
        // Only reachable in a dry run, or if a commande was skipped above.
        orphanColours.push(`produit ${String(row.id)} -> commande ${String(row.commande_id)}`);
        continue;
      }
      if (!dryRun) {
        await prisma.orderColour.create({
          data: {
            nom: text(row.nom),
            prix: num(row.prix),
            orderId,
            legacyId: BigInt(String(row.id)),
          },
        });
      }
      colourCount += 1;
    }
    console.log(`colours: ${colourCount}/${colours.length}`);

    if (unresolved.length > 0) {
      console.warn(`\nforeign keys / enum values that did not resolve (left null, or order skipped):`);
      for (const value of unresolved.slice(0, 20)) console.warn(`  ${value}`);
      if (unresolved.length > 20) {
        console.warn(`  … and ${unresolved.length - 20} more`);
      }
    }
    if (orphanColours.length > 0) {
      console.warn(`\ncolours whose order was skipped: ${orphanColours.length}`);
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
