/**
 * Imports legacy purchase orders and goods receipts:
 *   - `bon_de_commande*`        (9 tables, 556 rows)  -> PurchaseOrder
 *   - `ligne_bon_de_commande*`  (9 tables, 1871 rows) -> PurchaseOrderLine
 *   - `bon_de_reception*`       (9 tables, 551 rows)  -> GoodsReceipt
 *   - `ligne_bon_de_reception*` (9 tables, 1856 rows) -> GoodsReceiptLine
 * and then resolves `PurchaseInvoice.legacyReceiptType`/`legacyReceiptId`
 * (the legacy `gr_type`/`gr_id`) into `PurchaseInvoice.receiptId`.
 *
 * Step 6 of the migration order in docs/legacy-migration.md; requires step 1
 * (suppliers) and step 5 (the invoices whose receipt link is backfilled).
 *
 *   pnpm --filter api db:import:step6 [-- --dry-run]
 *
 * The nine legacy table families are one model each here, keyed by
 * `PurchaseCategory` — see the enum's doc comment in schema.prisma. Because
 * every family had its own id sequence, the upsert key is
 * `(category, legacyId)`, not `legacyId` alone.
 *
 * Idempotent: headers upsert; lines are deleted and re-inserted per header,
 * scoped to the headers touched by THIS run — the same rule as invoices.
 * Receipt lines are rebuilt after order lines so their `orderLineId` always
 * points at the line ids of this run (deleting an order line SetNulls it).
 *
 * Read-only against the legacy database.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import type {
  PurchaseCategory,
  ReceiptStatus,
  StretchFilmType,
} from "../generated/prisma/enums.js";
import { legacyDate, legacyPool, text } from "./legacy.js";

type Row = Record<string, unknown>;

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function int(value: unknown): number | null {
  const parsed = num(value);
  return parsed === null ? null : Math.trunc(parsed);
}

/** A legacy BIGINT arrives as a string from `pg`; null stays null. */
function bigint(value: unknown): bigint | null {
  return value === null || value === undefined ? null : BigInt(String(value));
}

/**
 * One legacy table family. `suffix` is what the legacy names append to
 * `bon_de_commande` / `bon_de_reception` / `ligne_…`; `grType` is the
 * `GrType` enum value `facture_achat.gr_type` uses to point at the family's
 * receipt table.
 */
interface Family {
  category: PurchaseCategory;
  suffix: string;
  grType: string;
}

const FAMILIES: readonly Family[] = [
  { category: "PAPER", suffix: "", grType: "BON_DE_RECEPTION" },
  { category: "INK", suffix: "_ink", grType: "BON_DE_RECEPTION_INK" },
  { category: "PLATE", suffix: "_plate", grType: "BON_DE_RECEPTION_PLATE" },
  { category: "GLUE", suffix: "_glue", grType: "BON_DE_RECEPTION_GLUE" },
  { category: "BOXES", suffix: "_boxes", grType: "BON_DE_RECEPTION_BOXES" },
  { category: "PALLETS", suffix: "_pallets", grType: "BON_DE_RECEPTION_PALLETS" },
  { category: "STRETCH_FILM", suffix: "_stretch_film", grType: "BON_DE_RECEPTION_STRETCH_FILM" },
  { category: "TRANSPORT", suffix: "_transport", grType: "BON_DE_RECEPTION_TRANSPORT" },
  { category: "MISC", suffix: "_misc", grType: "BON_DE_RECEPTION_MISC" },
];

const RECEIPT_STATUS: Record<string, ReceiptStatus> = {
  EN_ATTENTE: "PENDING",
  PARTIELLEMENT_RECU: "PARTIAL",
  TOTALEMENT_RECU: "COMPLETE",
};

const FILM_TYPES = ["STRETCH_FILM", "THERMO_PVC_STRETCH_FILM"] as const;

/**
 * Validates a legacy enum string against the closed enum rather than casting
 * it; an unknown value is reported and imports as null (see `paymentMethod`
 * in the invoice importer for the same rule).
 */
function receiptStatus(raw: unknown, label: string, unresolved: string[]): ReceiptStatus | null {
  const value = text(raw);
  if (value === null) return null;
  const mapped = RECEIPT_STATUS[value];
  if (mapped) return mapped;
  unresolved.push(`${label}: unknown status "${value}"`);
  return null;
}

function filmType(raw: unknown, label: string, unresolved: string[]): StretchFilmType | null {
  const value = text(raw);
  if (value === null) return null;
  if ((FILM_TYPES as readonly string[]).includes(value)) return value as StretchFilmType;
  unresolved.push(`${label}: unknown stretch film type "${value}"`);
  return null;
}

/**
 * The per-family dimension columns, read by their legacy names. A family
 * that never had a column yields `undefined` from the row, which `num`
 * turns into null — so one function covers all nine line shapes. Note the
 * legacy spelling drift: `longueur` on boxes/pallets, `longeur` on film.
 */
function dimensions(row: Row, label: string, unresolved: string[]) {
  return {
    grammage: num(row.grammage),
    laize: num(row.laize),
    length: num(row.longueur ?? row.longeur),
    width: num(row.largeur),
    height: num(row.hauteur),
    thickness: num(row.epaisseur),
    filmType: filmType(row.type, label, unresolved),
    colourCount: int(row.number_of_colors),
  };
}

/** Legacy supplier id -> new cuid. */
async function supplierMap(prisma: PrismaClient) {
  const rows = await prisma.supplier.findMany({
    where: { legacyId: { not: null } },
    select: { id: true, legacyId: true },
  });
  return new Map(rows.map((row) => [String(row.legacyId), row.id]));
}

interface Counts {
  orders: number;
  orderLines: number;
  receipts: number;
  receiptLines: number;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const legacy = legacyPool();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const suppliers = await supplierMap(prisma);
    if (suppliers.size === 0) {
      throw new Error("No suppliers found. Run db:import:step1 first — every order names one.");
    }

    /** Anything that fails to resolve, reported at the end rather than swallowed. */
    const unresolved: string[] = [];
    const seen: Counts = { orders: 0, orderLines: 0, receipts: 0, receiptLines: 0 };
    const written: Counts = { orders: 0, orderLines: 0, receipts: 0, receiptLines: 0 };

    /** `${category}:${legacy receipt id}` -> new receipt id, for the invoice backfill. */
    const receiptIds = new Map<string, string>();

    for (const family of FAMILIES) {
      const { category, suffix } = family;
      const label = category.toLowerCase();

      // ---- orders ----------------------------------------------------------
      //
      // Dates as text so the driver cannot shift them by a day — `legacyDate`.
      const { rows: orders } = await legacy.query<Row>(
        `SELECT *,
                date::text                     AS date,
                estimated_receiving_date::text AS estimated_receiving_date
           FROM bon_de_commande${suffix}
          ORDER BY id`,
      );
      const { rows: orderLines } = await legacy.query<Row>(
        `SELECT * FROM ligne_bon_de_commande${suffix} ORDER BY bon_de_commande_id, id`,
      );

      /** legacy order id -> new id */
      const orderIds = new Map<string, string>();
      /** legacy order id -> legacy supplier id, for the receipt cross-check */
      const orderSuppliers = new Map<string, string>();

      for (const row of orders) {
        seen.orders += 1;
        const numero = text(row.numero_bon);
        const legacyId = bigint(row.id);
        if (numero === null || legacyId === null) {
          unresolved.push(`bon_de_commande${suffix} ${String(row.id)}: blank numero, skipped`);
          continue;
        }
        const supplierId = suppliers.get(String(row.fournisseur_id));
        if (supplierId === undefined) {
          unresolved.push(`${numero}: supplier ${String(row.fournisseur_id)} not found, skipped`);
          continue;
        }
        const issuedAt = legacyDate(row.date);
        if (issuedAt === null) {
          unresolved.push(`${numero}: no date, skipped`);
          continue;
        }
        const currency = text(row.devise)?.toUpperCase();
        if (!currency) {
          unresolved.push(`${numero}: no currency, skipped`);
          continue;
        }

        const data = {
          numero,
          category,
          issuedAt,
          expectedAt: legacyDate(row.estimated_receiving_date),
          supplierId,
          totalHt: num(row.total_ht),
          totalQuantity: num(row.total_quantity_ordered),
          currency,
          address: text(row.addresse),
          notes: text(row.observation),
          createdByName: text(row.created_by),
        };

        orderSuppliers.set(String(row.id), String(row.fournisseur_id));
        if (dryRun) {
          orderIds.set(String(row.id), "dry-run");
        } else {
          const saved = await prisma.purchaseOrder.upsert({
            where: { category_legacyId: { category, legacyId } },
            create: { ...data, legacyId },
            update: data,
            select: { id: true },
          });
          orderIds.set(String(row.id), saved.id);
        }
        written.orders += 1;
      }

      /** legacy order line id -> new id, for the receipt lines */
      const orderLineIds = new Map<string, string>();
      if (!dryRun && orderIds.size > 0) {
        await prisma.purchaseOrderLine.deleteMany({
          where: { orderId: { in: [...orderIds.values()] } },
        });
      }
      {
        let position = 0;
        let lastOrder = "";
        for (const row of orderLines) {
          seen.orderLines += 1;
          const legacyOrder = String(row.bon_de_commande_id);
          const orderId = orderIds.get(legacyOrder);
          if (orderId === undefined) {
            unresolved.push(
              `ligne_bon_de_commande${suffix} ${String(row.id)}: order ${legacyOrder} was skipped`,
            );
            continue;
          }
          const designation = text(row.designation);
          const quantity = num(row.quantite);
          const unitPrice = num(row.prix_unit ?? row.prix_unitaire_hors_taxe);
          const total = num(row.total_ht);
          if (designation === null || quantity === null || unitPrice === null || total === null) {
            unresolved.push(
              `ligne_bon_de_commande${suffix} ${String(row.id)}: missing designation/quantity/price/total, skipped`,
            );
            continue;
          }
          position = legacyOrder === lastOrder ? position + 1 : 1;
          lastOrder = legacyOrder;
          const lineLabel = `ligne_bon_de_commande${suffix} ${String(row.id)}`;
          if (dryRun) {
            orderLineIds.set(String(row.id), "dry-run");
          } else {
            const saved = await prisma.purchaseOrderLine.create({
              data: {
                orderId,
                position,
                designation,
                quantity,
                unitPrice,
                total,
                ...dimensions(row, lineLabel, unresolved),
                unitSurface: num(row.unit_surface),
                legacyId: bigint(row.id),
              },
              select: { id: true },
            });
            orderLineIds.set(String(row.id), saved.id);
          }
          written.orderLines += 1;
        }
      }

      // ---- receipts --------------------------------------------------------
      const { rows: receipts } = await legacy.query<Row>(
        `SELECT *,
                date::text           AS date,
                reception_date::text AS reception_date
           FROM bon_de_reception${suffix}
          ORDER BY id`,
      );
      const { rows: receiptLines } = await legacy.query<Row>(
        `SELECT * FROM ligne_bon_de_reception${suffix} ORDER BY bon_de_reception_id, id`,
      );

      /** legacy receipt id -> new id */
      const localReceiptIds = new Map<string, string>();

      for (const row of receipts) {
        seen.receipts += 1;
        const numero = text(row.numero_bon_reception);
        const legacyId = bigint(row.id);
        if (numero === null || legacyId === null) {
          unresolved.push(`bon_de_reception${suffix} ${String(row.id)}: blank numero, skipped`);
          continue;
        }
        const legacyOrder = String(row.bon_de_commande_id);
        const orderId = orderIds.get(legacyOrder);
        if (orderId === undefined) {
          unresolved.push(`${numero}: order ${legacyOrder} was skipped`);
          continue;
        }
        // The receipt's own supplier column is nullable in the legacy schema
        // (never null in the data) and agrees with the order's on every row;
        // the order's is authoritative, a disagreement is reported.
        const orderSupplier = orderSuppliers.get(legacyOrder);
        const ownSupplier = row.fournisseur_id === null ? null : String(row.fournisseur_id);
        if (ownSupplier !== null && ownSupplier !== orderSupplier) {
          unresolved.push(
            `${numero}: supplier ${ownSupplier} differs from its order's ${String(orderSupplier)}; using the order's`,
          );
        }
        const supplierId = suppliers.get(String(orderSupplier));
        if (supplierId === undefined) {
          unresolved.push(`${numero}: supplier ${String(orderSupplier)} not found, skipped`);
          continue;
        }
        const issuedAt = legacyDate(row.date);
        if (issuedAt === null) {
          unresolved.push(`${numero}: no date, skipped`);
          continue;
        }

        const data = {
          numero,
          category,
          orderId,
          supplierId,
          issuedAt,
          receivedAt: legacyDate(row.reception_date),
          status: receiptStatus(row.status, numero, unresolved),
          validated: text(row.validation_status) === "VALIDE",
          receivedQuantity: num(row.received_quantity),
          invoiceNumber: text(row.numero_facture),
          invoiceUrl: text(row.invoice_url),
          notes: text(row.observation),
          updatedByName: text(row.updated_by),
        };

        if (dryRun) {
          localReceiptIds.set(String(row.id), "dry-run");
        } else {
          const saved = await prisma.goodsReceipt.upsert({
            where: { category_legacyId: { category, legacyId } },
            create: { ...data, legacyId },
            update: data,
            select: { id: true },
          });
          localReceiptIds.set(String(row.id), saved.id);
        }
        receiptIds.set(`${category}:${String(row.id)}`, localReceiptIds.get(String(row.id)) ?? "dry-run");
        written.receipts += 1;
      }

      if (!dryRun && localReceiptIds.size > 0) {
        await prisma.goodsReceiptLine.deleteMany({
          where: { receiptId: { in: [...localReceiptIds.values()] } },
        });
      }
      {
        let position = 0;
        let lastReceipt = "";
        for (const row of receiptLines) {
          seen.receiptLines += 1;
          const legacyReceipt = String(row.bon_de_reception_id);
          const receiptId = localReceiptIds.get(legacyReceipt);
          if (receiptId === undefined) {
            unresolved.push(
              `ligne_bon_de_reception${suffix} ${String(row.id)}: receipt ${legacyReceipt} was skipped`,
            );
            continue;
          }
          const designation = text(row.designation);
          if (designation === null) {
            unresolved.push(
              `ligne_bon_de_reception${suffix} ${String(row.id)}: blank designation, skipped`,
            );
            continue;
          }
          // SetNull in the legacy schema too; every migrated line has one,
          // but a dangling one is reported rather than silently dropped.
          let orderLineId: string | null = null;
          if (row.ligne_bon_de_commande_id !== null && row.ligne_bon_de_commande_id !== undefined) {
            orderLineId = orderLineIds.get(String(row.ligne_bon_de_commande_id)) ?? null;
            if (orderLineId === null) {
              unresolved.push(
                `ligne_bon_de_reception${suffix} ${String(row.id)}: order line ${String(row.ligne_bon_de_commande_id)} not found`,
              );
            }
          }
          position = legacyReceipt === lastReceipt ? position + 1 : 1;
          lastReceipt = legacyReceipt;
          const lineLabel = `ligne_bon_de_reception${suffix} ${String(row.id)}`;
          if (!dryRun) {
            await prisma.goodsReceiptLine.create({
              data: {
                receiptId,
                orderLineId: orderLineId === "dry-run" ? null : orderLineId,
                position,
                designation,
                receivedQuantity: num(row.received_quantity),
                unitPrice: num(row.prix_unitaire_hors_taxe),
                ...dimensions(row, lineLabel, unresolved),
                notes: text(row.observation),
                legacyId: bigint(row.id),
              },
            });
          }
          written.receiptLines += 1;
        }
      }

      console.log(
        `${label.padEnd(13)} orders ${String(orders.length).padStart(3)} / lines ${String(orderLines.length).padStart(4)}` +
          `   receipts ${String(receipts.length).padStart(3)} / lines ${String(receiptLines.length).padStart(4)}`,
      );
    }

    console.log(
      `\norders:   ${written.orders}/${seen.orders}, lines ${written.orderLines}/${seen.orderLines}` +
        `\nreceipts: ${written.receipts}/${seen.receipts}, lines ${written.receiptLines}/${seen.receiptLines}`,
    );

    // ---- received-to-date recompute ---------------------------------------
    //
    // `PurchaseOrderLine.receivedQuantity` is denormalised from the receipt
    // lines, and the lines above were just recreated at its DEFAULT 0. So a
    // re-run of this importer would otherwise leave every order line reading
    // "nothing received" while its receipt lines say otherwise.
    //
    // Runs after ALL nine families, not per family: a receipt line and the
    // order line it points at are always in the same family today, but the
    // recompute costs one statement and this way it cannot be wrong if that
    // ever stops being true. Same statement as the migration's backfill.
    if (!dryRun) {
      const updated = await prisma.$executeRaw`
        UPDATE "PurchaseOrderLine" ol
        SET "receivedQuantity" = COALESCE(sums.recv, 0)
        FROM (
            SELECT l.id, COALESCE(SUM(rl."receivedQuantity"), 0) AS recv
            FROM "PurchaseOrderLine" l
            LEFT JOIN "GoodsReceiptLine" rl ON rl."orderLineId" = l.id
            GROUP BY l.id
        ) AS sums
        WHERE ol.id = sums.id AND ol."receivedQuantity" <> COALESCE(sums.recv, 0)`;
      console.log(`received:  ${updated} order line(s) recomputed`);
    }

    // ---- invoice -> receipt backfill --------------------------------------
    //
    // `facture_achat.gr_type`/`gr_id` were carried verbatim by step 5 as
    // `legacyReceiptType`/`legacyReceiptId`. Resolve them now that the
    // receipts exist. The legacy columns stay as they are — the one invoice
    // whose receipt no longer exists in the legacy database keeps its
    // reference visible on the detail page.
    const grTypes = new Map(FAMILIES.map((f) => [f.grType, f.category]));
    const invoices = await prisma.purchaseInvoice.findMany({
      where: { legacyReceiptType: { not: null } },
      select: { id: true, numero: true, legacyReceiptType: true, legacyReceiptId: true, receiptId: true },
    });
    let linked = 0;
    for (const invoice of invoices) {
      const category = grTypes.get(invoice.legacyReceiptType ?? "");
      if (category === undefined) {
        unresolved.push(`${invoice.numero}: unknown gr_type "${String(invoice.legacyReceiptType)}"`);
        continue;
      }
      const receiptId = receiptIds.get(`${category}:${String(invoice.legacyReceiptId)}`);
      if (receiptId === undefined) {
        unresolved.push(
          `${invoice.numero}: receipt ${String(invoice.legacyReceiptType)} #${String(invoice.legacyReceiptId)} does not exist in the legacy database`,
        );
        continue;
      }
      if (!dryRun && invoice.receiptId !== receiptId) {
        await prisma.purchaseInvoice.update({ where: { id: invoice.id }, data: { receiptId } });
      }
      linked += 1;
    }
    console.log(`invoices: ${linked}/${invoices.length} linked to their receipt`);

    if (unresolved.length > 0) {
      console.warn(`\nvalues that did not resolve:`);
      for (const value of unresolved.slice(0, 20)) console.warn(`  ${value}`);
      if (unresolved.length > 20) console.warn(`  … and ${unresolved.length - 20} more`);
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
