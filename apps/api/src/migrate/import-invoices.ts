/**
 * Imports legacy invoices:
 *   - `facture_achat`        (614)  -> PurchaseInvoice
 *   - `ligne_facture_achat`  (2928) -> PurchaseInvoiceLine
 *   - `facture_vente`        (47)   -> SalesInvoice
 *   - `ligne_facture_vente`  (314)  -> SalesInvoiceLine
 *   - `document_facturation` (686)  -> `documents` on either, as URLs
 *
 * Step 5 of the migration order in docs/legacy-migration.md; requires step 1,
 * because purchase invoices reference suppliers and sales invoices clients.
 *
 *   pnpm --filter api db:import:step5 [-- --dry-run]
 *
 * Idempotent: invoices upsert on `legacyId`. Lines are deleted and re-inserted
 * per invoice rather than upserted — the same rule as order colours: a line
 * has no natural key, and replacing keeps a re-run in step with the source
 * even if a line was deleted there. Scoped to the invoices touched by THIS
 * run, never a blanket delete. Documents are a union with what is already
 * stored, like `Product.images`, so a re-run converges rather than flapping.
 *
 * Read-only against the legacy database.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import type { PaymentMethod as PrismaPaymentMethod } from "../generated/prisma/enums.js";
import { legacyDate, legacyPool, text } from "./legacy.js";

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * Legacy `cours` (exchange rate) is 0 on every row that has one — "not set",
 * not a rate. Mapped to null so a real rate can never be mistaken for it.
 */
function rateOrNull(value: unknown): number | null {
  const parsed = num(value);
  return parsed === null || parsed === 0 ? null : parsed;
}

/** Legacy `mode_paiement`: free text that only ever held these three. */
const PAYMENT_METHODS = ["VIREMENT", "CHEQUE", "ESPECES"] as const;

/**
 * Validates a legacy string against the closed enum rather than casting it.
 * An unknown value is reported through `unresolved` and imports as null, so
 * it cannot become a value the rest of the app has never heard of.
 */
function paymentMethod(raw: unknown, invoice: string, unresolved: string[]): PrismaPaymentMethod | null {
  const value = text(raw);
  if (value === null) return null;
  const upper = value.toUpperCase();
  if ((PAYMENT_METHODS as readonly string[]).includes(upper)) return upper as PrismaPaymentMethod;
  unresolved.push(`${invoice}: unknown mode_paiement "${value}"`);
  return null;
}

/** The line columns are identical on both legacy tables. */
function lineData(row: Record<string, unknown>, position: number) {
  return {
    position,
    product: text(row.produit),
    description: text(row.description),
    quantity: num(row.quantite),
    unitPrice: num(row.prix_unitaire),
    discountPct: num(row.reduction),
    taxPct: num(row.taxe),
    total: num(row.total),
    legacyId: BigInt(String(row.id)),
  };
}

/**
 * Merges the legacy scans onto an invoice as a union of what is already
 * there, in legacy upload order, skipping the write when nothing is new.
 */
function mergeDocuments(existing: string[], legacy: string[]): string[] | null {
  const merged = [...existing];
  for (const url of legacy) if (!merged.includes(url)) merged.push(url);
  return merged.length === existing.length ? null : merged;
}

/** Legacy id -> new cuid, for the two partner tables invoices point at. */
async function foreignKeyMaps(prisma: PrismaClient) {
  const [suppliers, clients] = await Promise.all([
    prisma.supplier.findMany({
      where: { legacyId: { not: null } },
      select: { id: true, legacyId: true },
    }),
    prisma.client.findMany({
      where: { legacyId: { not: null } },
      select: { id: true, legacyId: true },
    }),
  ]);
  const asMap = (rows: { id: string; legacyId: bigint | null }[]) =>
    new Map(rows.map((row) => [String(row.legacyId), row.id]));
  return { suppliers: asMap(suppliers), clients: asMap(clients) };
}

/**
 * `document_facturation` keyed by the invoice it belongs to. The XOR check
 * on that table guarantees each row names exactly one of the two.
 */
async function documentsByInvoice(legacy: ReturnType<typeof legacyPool>) {
  const { rows } = await legacy.query<Record<string, unknown>>(
    `SELECT facture_achat_id, facture_vente_id, file_url
       FROM document_facturation
      ORDER BY created_at, id`,
  );
  const purchase = new Map<string, string[]>();
  const sales = new Map<string, string[]>();
  let blank = 0;
  for (const row of rows) {
    const url = text(row.file_url);
    if (url === null) {
      blank += 1;
      continue;
    }
    const target = row.facture_achat_id !== null ? purchase : sales;
    const key = String(row.facture_achat_id ?? row.facture_vente_id);
    const list = target.get(key);
    if (list) list.push(url);
    else target.set(key, [url]);
  }
  return { purchase, sales, total: rows.length, blank };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const legacy = legacyPool();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const maps = await foreignKeyMaps(prisma);
    if (maps.suppliers.size === 0 || maps.clients.size === 0) {
      throw new Error(
        "No suppliers/clients found. Run db:import:step1 first — invoices reference both.",
      );
    }
    const documents = await documentsByInvoice(legacy);

    /** Anything that fails to resolve, reported at the end rather than swallowed. */
    const unresolved: string[] = [];

    // ---- purchase invoices ------------------------------------------------
    //
    // Dates are selected as text so the driver cannot shift them by a day —
    // see `legacyDate`.
    const { rows: purchases } = await legacy.query<Record<string, unknown>>(
      `SELECT *,
              date_facture::text  AS date_facture,
              date_echeance::text AS date_echeance,
              date_paiement::text AS date_paiement
         FROM facture_achat
        ORDER BY id`,
    );
    const { rows: purchaseLines } = await legacy.query<Record<string, unknown>>(
      `SELECT * FROM ligne_facture_achat ORDER BY facture_achat_id, id`,
    );

    let purchaseCount = 0;
    let purchaseLineCount = 0;
    let purchaseDocCount = 0;
    const purchaseIds = new Map<string, string>();

    for (const row of purchases) {
      const numero = text(row.numero_facture);
      if (numero === null) {
        // Cannot happen — the legacy column is NOT NULL and its one blank was
        // already rewritten to "MIGR-NULL-560" there — but a skipped row must
        // never be silent.
        unresolved.push(`facture_achat ${String(row.id)}: blank numero, skipped`);
        continue;
      }
      const legacyId = BigInt(String(row.id));
      const supplierId = maps.suppliers.get(String(row.fournisseur_id));
      if (supplierId === undefined) {
        unresolved.push(`${numero}: supplier ${String(row.fournisseur_id)} not found, skipped`);
        continue;
      }

      const data = {
        numero,
        issuedAt: legacyDate(row.date_facture),
        dueAt: legacyDate(row.date_echeance),
        paidAt: legacyDate(row.date_paiement),
        paymentMethod: paymentMethod(row.mode_paiement, numero, unresolved),
        category: text(row.categorisation),
        forProduction: bool(row.achat_production),
        supplierId,
        totalHt: num(row.total_ht),
        vatAmount: num(row.tva),
        totalTtc: num(row.total_ttc),
        withholdingTax: num(row.total_retenue),
        netPayable: num(row.net_a_payer),
        currency: text(row.devise)?.toUpperCase() ?? null,
        exchangeRate: rateOrNull(row.cours),
        legacyReceiptType: text(row.gr_type),
        legacyReceiptId: row.gr_id === null || row.gr_id === undefined ? null : BigInt(String(row.gr_id)),
      };
      const legacyDocs = documents.purchase.get(String(row.id)) ?? [];

      if (dryRun) {
        purchaseIds.set(String(row.id), "dry-run");
      } else {
        const existing = await prisma.purchaseInvoice.findUnique({
          where: { legacyId },
          select: { id: true, documents: true },
        });
        const merged = mergeDocuments(existing?.documents ?? [], legacyDocs);
        const saved = await prisma.purchaseInvoice.upsert({
          where: { legacyId },
          create: { ...data, documents: legacyDocs, legacyId },
          update: { ...data, ...(merged ? { documents: merged } : {}) },
          select: { id: true },
        });
        purchaseIds.set(String(row.id), saved.id);
      }
      purchaseCount += 1;
      purchaseDocCount += legacyDocs.length;
    }

    if (!dryRun && purchaseIds.size > 0) {
      await prisma.purchaseInvoiceLine.deleteMany({
        where: { invoiceId: { in: [...purchaseIds.values()] } },
      });
    }
    {
      let position = 0;
      let lastInvoice = "";
      for (const row of purchaseLines) {
        const legacyInvoice = String(row.facture_achat_id);
        const invoiceId = purchaseIds.get(legacyInvoice);
        if (invoiceId === undefined) {
          unresolved.push(`ligne_facture_achat ${String(row.id)}: invoice ${legacyInvoice} was skipped`);
          continue;
        }
        position = legacyInvoice === lastInvoice ? position + 1 : 1;
        lastInvoice = legacyInvoice;
        if (!dryRun) {
          await prisma.purchaseInvoiceLine.create({ data: { ...lineData(row, position), invoiceId } });
        }
        purchaseLineCount += 1;
      }
    }
    console.log(
      `purchase invoices: ${purchaseCount}/${purchases.length}, lines ${purchaseLineCount}/${purchaseLines.length}, documents ${purchaseDocCount}`,
    );

    // ---- sales invoices ---------------------------------------------------
    const { rows: sales } = await legacy.query<Record<string, unknown>>(
      `SELECT *,
              date_facture::text  AS date_facture,
              date_echeance::text AS date_echeance,
              date_paiement::text AS date_paiement
         FROM facture_vente
        ORDER BY id`,
    );
    const { rows: salesLines } = await legacy.query<Record<string, unknown>>(
      `SELECT * FROM ligne_facture_vente ORDER BY facture_vente_id, id`,
    );

    let salesCount = 0;
    let salesLineCount = 0;
    let salesDocCount = 0;
    let salesWithoutClient = 0;
    const salesIds = new Map<string, string>();

    for (const row of sales) {
      const numero = text(row.numero_facture);
      if (numero === null) {
        unresolved.push(`facture_vente ${String(row.id)}: blank numero, skipped`);
        continue;
      }
      const legacyId = BigInt(String(row.id));
      // Nullable in the source: 24 of 47 rows name no client. Null is the
      // honest value; a dangling id (none in the data) is reported.
      let clientId: string | null = null;
      if (row.client_id !== null && row.client_id !== undefined) {
        clientId = maps.clients.get(String(row.client_id)) ?? null;
        if (clientId === null) unresolved.push(`${numero}: client ${String(row.client_id)} not found`);
      } else {
        salesWithoutClient += 1;
      }

      const data = {
        numero,
        issuedAt: legacyDate(row.date_facture),
        dueAt: legacyDate(row.date_echeance),
        paidAt: legacyDate(row.date_paiement),
        paymentMethod: paymentMethod(row.mode_paiement, numero, unresolved),
        category: text(row.categorisation),
        clientId,
        totalHt: num(row.total_ht),
        vatAmount: num(row.tva),
        totalTtc: num(row.total_ttc),
        // A blank `devise` on a legacy sales invoice means euros: those rows
        // are the export invoices, whose form left the field empty (30 of
        // 57; backfilled the same way by the 20260922100000 migration).
        currency: text(row.devise)?.toUpperCase() ?? "EUR",
      };
      const legacyDocs = documents.sales.get(String(row.id)) ?? [];

      if (dryRun) {
        salesIds.set(String(row.id), "dry-run");
      } else {
        const existing = await prisma.salesInvoice.findUnique({
          where: { legacyId },
          select: { id: true, documents: true },
        });
        const merged = mergeDocuments(existing?.documents ?? [], legacyDocs);
        const saved = await prisma.salesInvoice.upsert({
          where: { legacyId },
          create: { ...data, documents: legacyDocs, legacyId },
          update: { ...data, ...(merged ? { documents: merged } : {}) },
          select: { id: true },
        });
        salesIds.set(String(row.id), saved.id);
      }
      salesCount += 1;
      salesDocCount += legacyDocs.length;
    }

    if (!dryRun && salesIds.size > 0) {
      await prisma.salesInvoiceLine.deleteMany({
        where: { invoiceId: { in: [...salesIds.values()] } },
      });
    }
    {
      let position = 0;
      let lastInvoice = "";
      for (const row of salesLines) {
        const legacyInvoice = String(row.facture_vente_id);
        const invoiceId = salesIds.get(legacyInvoice);
        if (invoiceId === undefined) {
          unresolved.push(`ligne_facture_vente ${String(row.id)}: invoice ${legacyInvoice} was skipped`);
          continue;
        }
        position = legacyInvoice === lastInvoice ? position + 1 : 1;
        lastInvoice = legacyInvoice;
        if (!dryRun) {
          await prisma.salesInvoiceLine.create({ data: { ...lineData(row, position), invoiceId } });
        }
        salesLineCount += 1;
      }
    }
    console.log(
      `sales invoices:    ${salesCount}/${sales.length} (${salesWithoutClient} without a client), lines ${salesLineCount}/${salesLines.length}, documents ${salesDocCount}`,
    );
    console.log(
      `documents:         ${purchaseDocCount + salesDocCount}/${documents.total} attached` +
        (documents.blank ? ` (${documents.blank} with no URL, skipped)` : ""),
    );

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
