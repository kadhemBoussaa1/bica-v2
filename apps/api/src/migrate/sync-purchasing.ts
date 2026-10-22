/**
 * Brings the old app's purchasing up to date here while both apps are in use
 * (2026-10-22): purchase orders, goods receipts and supplier invoices typed
 * or changed in the old app since the first import.
 *
 *   node dist/migrate/sync-purchasing.js           # dry run: reports, writes nothing
 *   node dist/migrate/sync-purchasing.js --apply
 *
 * Reads the old app's RAW database (LEGACY_RAW_DATABASE_URL) and applies the
 * ETL's rules itself (bicapack packages/db/etl/05_purchasing.sql and
 * 06_invoices.sql) with the importers' mapping (import-purchasing.ts,
 * import-invoices.ts): 05 no longer runs on the old app's data, which has a
 * film type it does not know. A record nobody touched maps to exactly what
 * the first import wrote.
 *
 * The old app is the source for a record until this app changes it. "Changed
 * here" is read off the audit log: every write to these three documents goes
 * through an audited procedure, and this script's own writes are not
 * audited, so a later run still follows the old app on a record it updated.
 *
 *   - missing here: created, with its lines. A number this app has already
 *     given to another order or receipt takes the next free number of its
 *     series, the old one going into the notes; an invoice number (the
 *     supplier's) already here is reported and left out. A document deleted
 *     here is not brought back.
 *   - here and unchanged here: rewritten to the old app's figures — header,
 *     lines (matched on `legacyId`; an invoice's are replaced as a whole),
 *     an invoice's files as a union with what is here.
 *   - deleted in the old app and unchanged here: deleted, unless an invoice
 *     here still points at the receipt.
 *   - changed here: left as it is, and reported.
 *
 * Then every order line of an order it touched gets its received-to-date
 * figure recomputed, and both number counters move past every number in use.
 *
 * Documents only: no stock moves. The old app's paper comes in through
 * sync-paper.ts and its ink went over once (import-inks.ts).
 *
 * One transaction, so all of it or none. A second run on the same backup
 * writes nothing.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma/client.js";
import type {
  PaymentMethod,
  PurchaseCategory,
  ReceiptStatus,
  StretchFilmType,
} from "../generated/prisma/enums.js";
import { formatNumero, ORDER_PREFIX, RECEIPT_PREFIX } from "../purchasing/purchasing.numbering.js";
import { legacyDate, legacyRawPool, text } from "./legacy.js";

type Row = Record<string, unknown>;
type Tx = Prisma.TransactionClient;
type Value = string | number | boolean | bigint | Date | null | undefined;

class DryRunRollback extends Error {}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function int(value: unknown): number | null {
  const parsed = num(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** Legacy `cours` is 0 on every row that has one: "not set", not a rate. */
function rateOrNull(value: unknown): number | null {
  const parsed = num(value);
  return parsed === null || parsed === 0 ? null : parsed;
}

function same(a: Value, b: Value): boolean {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  return (a ?? null) === (b ?? null);
}

/** The keys of `desired` whose value differs from the record's. */
function changedFields(current: object, desired: Record<string, Value>): string[] {
  const record = current as Record<string, Value>;
  return Object.keys(desired).filter((key) => !same(record[key], desired[key]));
}

function groupBy(rows: Row[], key: string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const value = String(row[key]);
    const list = groups.get(value);
    if (list) list.push(row);
    else groups.set(value, [row]);
  }
  return groups;
}

/**
 * One legacy table family, as in import-purchasing.ts. The old app names a
 * family's foreign keys after its tables — `bon_de_commande_ink_id` — and
 * paper's plainly, `bon_de_commande_id`.
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

/** 05_purchasing.sql's default for an order with no currency. */
const EURO_FAMILIES = new Set<PurchaseCategory>(["PAPER", "TRANSPORT"]);

/**
 * The AMB supplier is in the old app twice. The first import merged 183 into
 * 182 (docs/production-data-import.md, 2026-09-25); the old app still uses 183.
 */
const SUPPLIER_ALIASES = new Map([["183", "182"]]);

const RECEIPT_STATUS: Record<string, ReceiptStatus> = {
  EN_ATTENTE: "PENDING",
  PARTIELLEMENT_RECU: "PARTIAL",
  TOTALEMENT_RECU: "COMPLETE",
};

const FILM_TYPES = ["STRETCH_FILM", "THERMO_PVC_STRETCH_FILM"] as const;

const PAYMENT_METHODS = ["VIREMENT", "CHEQUE", "ESPECES"] as const;

/**
 * A legacy invoice date: text holding either a bare day or a UTC instant.
 * 06_invoices.sql reads both as Tunis days; a bare day is that day.
 */
const tunisDay = (column: string) =>
  `CASE WHEN NULLIF(${column}, '') IS NULL THEN NULL
        WHEN ${column} ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN ${column}
        ELSE ((${column}::timestamptz AT TIME ZONE 'Africa/Tunis')::date)::text END AS ${column}`;

interface Report {
  created: string[];
  renumbered: string[];
  updated: string[];
  deleted: string[];
  keptHere: string[];
  skipped: string[];
  unresolved: string[];
}

function filmType(raw: unknown, label: string, report: Report): StretchFilmType | null {
  const value = text(raw);
  if (value === null) return null;
  if ((FILM_TYPES as readonly string[]).includes(value)) return value as StretchFilmType;
  report.unresolved.push(`${label}: film type "${value}" has no equivalent here, left empty`);
  return null;
}

/** import-purchasing.ts's per-family dimensions, read off the raw column names. */
function dimensions(row: Row, label: string, report: Report) {
  return {
    grammage: num(row.grammage),
    laize: num(row.laize),
    length: num(row.longueur ?? row.longeur),
    width: num(row.largeur),
    height: num(row.hauteur),
    thickness: num(row.epaisseur),
    filmType: filmType(row.type, label, report),
    colourCount: int(row.number_of_colors),
  };
}

function orderData(row: Row, family: Family, supplierId: string) {
  const issuedAt = legacyDate(row.date) ?? legacyDate(row.estimated_receiving_date);
  return {
    // The ETL made a missing date today's; kept as imported when it is.
    ...(issuedAt ? { issuedAt } : {}),
    expectedAt: legacyDate(row.estimated_receiving_date),
    supplierId,
    totalHt: num(row.total_ht),
    totalQuantity: num(row.total_quantity_ordered),
    currency: (text(row.devise) ?? (EURO_FAMILIES.has(family.category) ? "EUR" : "TND")).toUpperCase(),
    address: text(row.addresse),
    notes: text(row.observation),
    createdByName: text(row.created_by),
  };
}

/** A transport order line is a lump sum: one unit at its price (05_purchasing.sql). */
function orderLineData(row: Row, family: Family, position: number, report: Report) {
  const label = `ligne_bon_de_commande${family.suffix} ${String(row.id)}`;
  const transport = family.category === "TRANSPORT";
  const price = num(row.prix_unitaire_hors_taxe) ?? 0;
  const designation = transport ? (text(row.designation) ?? "(transport)") : text(row.designation);
  const quantity = transport ? 1 : num(row.quantite);
  const unitPrice = transport ? price : num(row.prix_unit);
  const total = transport ? price : num(row.total_ht);
  if (designation === null || quantity === null || unitPrice === null || total === null) {
    report.unresolved.push(`${label}: missing designation/quantity/price/total, left out`);
    return null;
  }
  return {
    position,
    designation,
    quantity,
    unitPrice,
    total,
    ...dimensions(row, label, report),
    unitSurface: num(row.unit_surface),
    legacyId: BigInt(String(row.id)),
  };
}

function receiptData(row: Row, family: Family, orderId: string, supplierId: string, report: Report) {
  const numero = text(row.numero_ref) ?? "";
  const issuedAt = legacyDate(row.date) ?? legacyDate(row.reception_date);
  let status: ReceiptStatus | null = null;
  const rawStatus = text(row.status);
  if (rawStatus !== null) {
    status = RECEIPT_STATUS[rawStatus] ?? null;
    if (status === null) report.unresolved.push(`${numero}: unknown status "${rawStatus}", left empty`);
  }
  return {
    ...(issuedAt ? { issuedAt } : {}),
    orderId,
    supplierId,
    receivedAt: legacyDate(row.reception_date),
    status,
    validated: text(row.validation_status) === "VALIDE",
    receivedQuantity: num(row.received_quantity),
    invoiceNumber: text(row.numero_facture),
    invoiceUrl: text(row.invoice_url),
    notes: text(row.observation),
    updatedByName: text(row.updated_by),
    category: family.category,
  };
}

/** 05_purchasing.sql carries no note on a transport receipt line. */
function receiptLineData(row: Row, family: Family, position: number, orderLineId: string | null, report: Report) {
  const label = `ligne_bon_de_reception${family.suffix} ${String(row.id)}`;
  const designation = text(row.designation);
  if (designation === null) {
    report.unresolved.push(`${label}: blank designation, left out`);
    return null;
  }
  return {
    orderLineId,
    position,
    designation,
    receivedQuantity: num(row.received_quantity),
    unitPrice: num(row.prix_unitaire_hors_taxe),
    ...dimensions(row, label, report),
    notes: family.category === "TRANSPORT" ? null : text(row.observation),
    legacyId: BigInt(String(row.id)),
  };
}

function paymentMethod(raw: unknown, invoice: string, report: Report): PaymentMethod | null {
  const value = text(raw);
  if (value === null) return null;
  const upper = value.toUpperCase();
  if ((PAYMENT_METHODS as readonly string[]).includes(upper)) return upper as PaymentMethod;
  report.unresolved.push(`${invoice}: unknown payment method "${value}", left empty`);
  return null;
}

/** 06_invoices.sql gave the one invoice with no number a placeholder. */
function invoiceNumero(row: Row): string | null {
  return text(row.numero_facture) ?? (row.numero_facture == null ? `MIGR-NULL-${String(row.id)}` : null);
}

function invoiceData(row: Row, numero: string, supplierId: string, report: Report) {
  return {
    numero,
    issuedAt: legacyDate(row.date_facture),
    dueAt: legacyDate(row.date_echeance),
    paidAt: legacyDate(row.date_paiement),
    paymentMethod: paymentMethod(row.mode_paiement, numero, report),
    category: text(row.categorisation),
    forProduction: bool(row.achat_production),
    supplierId,
    totalHt: num(row.totalht),
    vatAmount: num(row.tva),
    totalTtc: num(row.totalttc),
    withholdingTax: num(row.total_retenue),
    netPayable: num(row.netapayer),
    currency: text(row.devise)?.toUpperCase() ?? null,
    exchangeRate: rateOrNull(row.cours),
    legacyReceiptType: text(row.gr_type),
    legacyReceiptId: row.gr_id == null ? null : BigInt(String(row.gr_id)),
  };
}

/** What an invoice line says, without its legacy id. */
function invoiceLineContent(row: Row, position: number) {
  return {
    position,
    product: text(row.produit),
    description: text(row.description),
    quantity: num(row.quantite),
    unitPrice: num(row.prix_unitaire),
    discountPct: num(row.reduction),
    taxPct: num(row.taxe),
    total: num(row.total),
  };
}

/**
 * Lines matched on `legacyId`: which to rewrite, which to add, which the old
 * app no longer has. A line made here (no `legacyId`) is never touched.
 */
function planLines<D extends { legacyId: bigint }>(
  current: { id: string; legacyId: bigint | null }[],
  desired: D[],
) {
  const byLegacy = new Map(current.flatMap((line) => (line.legacyId === null ? [] : [[String(line.legacyId), line]])));
  const update: { id: string; data: D }[] = [];
  const create: D[] = [];
  for (const line of desired) {
    const here = byLegacy.get(String(line.legacyId));
    byLegacy.delete(String(line.legacyId));
    if (!here) create.push(line);
    else if (changedFields(here, line).length > 0) update.push({ id: here.id, data: line });
  }
  const remove = [...byLegacy.values()].map((line) => line.id);
  return { update, create, remove, changes: update.length + create.length + remove.length };
}

function linesNote(plan: { update: unknown[]; create: unknown[]; remove: unknown[] }): string | null {
  const parts = [
    plan.update.length ? `${plan.update.length} line(s) changed` : "",
    plan.create.length ? `${plan.create.length} line(s) added` : "",
    plan.remove.length ? `${plan.remove.length} line(s) removed` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/**
 * A document renumbered here keeps its old number at the head of its notes,
 * on every run.
 */
function notesFor(oldNumero: string | null, numero: string, observation: string | null): string | null {
  if (oldNumero === null || oldNumero === numero) return observation;
  return [`N° dans l'ancienne application : ${oldNumero}`, observation].filter(Boolean).join("\n");
}

/** The highest `<prefix>-<n>` in use, 0 when none. */
function maxSequence(numbers: Iterable<string>, prefix: string): number {
  let max = 0;
  for (const numero of numbers) {
    const match = /^(.+)-(\d+)$/.exec(numero);
    if (match?.[1] === prefix && match[2] !== undefined) max = Math.max(max, Number(match[2]));
  }
  return max;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const raw = legacyRawPool();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const report: Report = {
    created: [],
    renumbered: [],
    updated: [],
    deleted: [],
    keptHere: [],
    skipped: [],
    unresolved: [],
  };
  const counts: string[] = [];

  try {
    const q = async (sql: string) => (await raw.query<Row>(sql)).rows;

    await prisma.$transaction(
      async (tx: Tx) => {
        const supplierRows = await tx.supplier.findMany({
          where: { legacyId: { not: null } },
          select: { id: true, legacyId: true, name: true },
        });
        const suppliers = new Map(supplierRows.map((row) => [String(row.legacyId), row]));
        const supplierOf = (legacyId: unknown) => {
          const key = String(legacyId);
          return suppliers.get(SUPPLIER_ALIASES.get(key) ?? key);
        };

        // ---- what this app did to these documents ----------------------------
        const audit = await tx.auditLog.findMany({
          where: {
            kind: "MUTATION",
            outcome: "OK",
            module: { in: ["purchaseOrder", "goodsReceipt", "purchaseInvoice"] },
          },
          select: { module: true, action: true, entityId: true, entityLabel: true },
        });
        const changedHere = new Set(audit.flatMap((row) => (row.entityId ? [row.entityId] : [])));
        const removedHere = (module: string) =>
          new Set(
            audit
              .filter((row) => row.module === module && row.action.endsWith(".remove") && row.entityLabel)
              .map((row) => String(row.entityLabel)),
          );
        const removedOrders = removedHere("purchaseOrder");
        const removedReceipts = removedHere("goodsReceipt");
        const removedInvoices = removedHere("purchaseInvoice");

        const orderNumbers = new Set(
          (await tx.purchaseOrder.findMany({ select: { numero: true } })).map((row) => row.numero),
        );
        const receiptNumbers = new Set(
          (await tx.goodsReceipt.findMany({ select: { numero: true } })).map((row) => row.numero),
        );

        /** Orders whose received-to-date figures need recomputing. */
        const touchedOrders = new Set<string>();

        /** The next free number of a series, past the counter and every number in use. */
        const allocate = async (kind: "order" | "receipt", prefix: string) => {
          const numbers = kind === "order" ? orderNumbers : receiptNumbers;
          const counter =
            kind === "order"
              ? await tx.purchaseOrderCounter.findUnique({ where: { prefix } })
              : await tx.goodsReceiptCounter.findUnique({ where: { prefix } });
          let sequence = Math.max(counter?.next ?? 1, maxSequence(numbers, prefix) + 1);
          while (numbers.has(formatNumero(prefix, sequence))) sequence += 1;
          const data = { where: { prefix }, create: { prefix, next: sequence + 1 }, update: { next: sequence + 1 } };
          if (kind === "order") await tx.purchaseOrderCounter.upsert(data);
          else await tx.goodsReceiptCounter.upsert(data);
          return formatNumero(prefix, sequence);
        };

        const tally = { orders: 0, receipts: 0, invoices: 0, relinked: 0 };

        for (const family of FAMILIES) {
          const { category, suffix } = family;
          const fk = (table: string) => `${table}${suffix}_id`;

          const oldOrders = await q(
            `SELECT *, date::text AS date, estimated_receiving_date::text AS estimated_receiving_date
               FROM bon_de_commande${suffix} ORDER BY id`,
          );
          const oldOrderLines = groupBy(
            await q(
              `SELECT *, ${fk("bon_de_commande")} AS order_ref
                 FROM ligne_bon_de_commande${suffix} ORDER BY order_ref, id`,
            ),
            "order_ref",
          );
          const oldReceipts = await q(
            `SELECT *, date::text AS date, reception_date::text AS reception_date,
                    ${category === "PAPER" ? "numer_bon_reception" : "numero_bon_reception"} AS numero_ref,
                    ${fk("bon_de_commande")} AS order_ref
               FROM bon_de_reception${suffix} ORDER BY id`,
          );
          const oldReceiptLines = groupBy(
            await q(
              `SELECT *, ${fk("bon_de_reception")} AS receipt_ref,
                      ${fk("ligne_bon_de_commande")} AS order_line_ref
                 FROM ligne_bon_de_reception${suffix} ORDER BY receipt_ref, id`,
            ),
            "receipt_ref",
          );

          const hereOrders = await tx.purchaseOrder.findMany({
            where: { category, legacyId: { not: null } },
            include: { lines: true, receipts: { include: { invoices: { select: { numero: true } } } } },
          });
          const hereReceipts = await tx.goodsReceipt.findMany({
            where: { category, legacyId: { not: null } },
            include: { lines: true, invoices: { select: { numero: true } } },
          });
          const hereOrderOf = new Map(hereOrders.map((row) => [String(row.legacyId), row]));
          const hereReceiptOf = new Map(hereReceipts.map((row) => [String(row.legacyId), row]));

          /** legacy order id -> id here, and legacy order line id -> id here */
          const orderIds = new Map<string, string>();
          const orderLineIds = new Map<string, string>();
          /** legacy order id -> its legacy supplier, which its receipts take */
          const orderSuppliers = new Map<string, unknown>();

          // ---- orders --------------------------------------------------------
          const clashing: Row[] = [];
          const createOrder = async (row: Row, numero: string) => {
            const supplier = supplierOf(row.fournisseur_id);
            if (!supplier) return;
            const data = orderData(row, family, supplier.id);
            data.notes = notesFor(text(row.numero_bon), numero, data.notes);
            const lines = (oldOrderLines.get(String(row.id)) ?? []).flatMap((line, index) => {
              const built = orderLineData(line, family, index + 1, report);
              return built ? [built] : [];
            });
            const created = await tx.purchaseOrder.create({
              data: {
                ...data,
                issuedAt: data.issuedAt ?? legacyDate(new Date().toISOString()) ?? new Date(),
                numero,
                category,
                legacyId: BigInt(String(row.id)),
                lines: { create: lines },
              },
              select: { id: true, lines: { select: { id: true, legacyId: true } } },
            });
            orderNumbers.add(numero);
            orderIds.set(String(row.id), created.id);
            for (const line of created.lines) orderLineIds.set(String(line.legacyId), line.id);
            touchedOrders.add(created.id);
            tally.orders += 1;
            report.created.push(
              `order   ${numero.padEnd(11)} ${supplier.name}, ${String(row.date ?? "no date")}, ${lines.length} line(s)`,
            );
          };

          for (const row of oldOrders) {
            const legacyId = String(row.id);
            orderSuppliers.set(legacyId, row.fournisseur_id);
            const numero = text(row.numero_bon);
            const supplier = supplierOf(row.fournisseur_id);
            const here = hereOrderOf.get(legacyId);

            if (here) {
              orderIds.set(legacyId, here.id);
              for (const line of here.lines) {
                if (line.legacyId !== null) orderLineIds.set(String(line.legacyId), line.id);
              }
              if (!supplier) {
                report.unresolved.push(`${here.numero}: supplier ${String(row.fournisseur_id)} not here`);
                continue;
              }
              const data = orderData(row, family, supplier.id);
              data.notes = notesFor(numero, here.numero, data.notes);
              const fields = changedFields(here, data);
              const lines = (oldOrderLines.get(legacyId) ?? []).flatMap((line, index) => {
                const built = orderLineData(line, family, index + 1, report);
                return built ? [built] : [];
              });
              const plan = planLines(here.lines, lines);
              if (fields.length === 0 && plan.changes === 0) continue;
              const what = [fields.join(", "), linesNote(plan)].filter(Boolean).join("; ");
              if (changedHere.has(here.id)) {
                report.keptHere.push(`order   ${here.numero}: changed here; the old app's ${what} not taken`);
                continue;
              }
              if (fields.length > 0) await tx.purchaseOrder.update({ where: { id: here.id }, data });
              for (const line of plan.update) await tx.purchaseOrderLine.update({ where: { id: line.id }, data: line.data });
              for (const line of plan.create) {
                const created = await tx.purchaseOrderLine.create({ data: { ...line, orderId: here.id }, select: { id: true } });
                orderLineIds.set(String(line.legacyId), created.id);
              }
              if (plan.remove.length) await tx.purchaseOrderLine.deleteMany({ where: { id: { in: plan.remove } } });
              touchedOrders.add(here.id);
              report.updated.push(`order   ${here.numero}: ${what}`);
              continue;
            }

            if (numero === null) {
              report.unresolved.push(`bon_de_commande${suffix} ${legacyId}: blank number, left out`);
              continue;
            }
            if (removedOrders.has(numero)) {
              report.skipped.push(`order   ${numero}: deleted here, not brought back`);
              continue;
            }
            if (!supplier) {
              report.unresolved.push(`order   ${numero}: supplier ${String(row.fournisseur_id)} not here, left out`);
              continue;
            }
            if (orderNumbers.has(numero)) {
              clashing.push(row);
              continue;
            }
            await createOrder(row, numero);
          }

          for (const row of clashing) {
            const oldNumero = String(text(row.numero_bon));
            const numero = await allocate("order", ORDER_PREFIX[category]);
            await createOrder(row, numero);
            report.renumbered.push(`order   ${oldNumero} -> ${numero}: ${oldNumero} is another order here`);
          }

          // ---- receipts ------------------------------------------------------
          const receiptLinesFor = (row: Row) =>
            (oldReceiptLines.get(String(row.id)) ?? []).flatMap((line, index) => {
              let orderLineId: string | null = null;
              if (line.order_line_ref != null) {
                orderLineId = orderLineIds.get(String(line.order_line_ref)) ?? null;
                if (orderLineId === null) {
                  report.unresolved.push(
                    `ligne_bon_de_reception${suffix} ${String(line.id)}: order line ${String(line.order_line_ref)} not here`,
                  );
                }
              }
              const built = receiptLineData(line, family, index + 1, orderLineId, report);
              return built ? [built] : [];
            });

          const clashingReceipts: { row: Row; orderId: string; supplierId: string }[] = [];
          const createReceipt = async (row: Row, numero: string, orderId: string, supplierId: string) => {
            const data = receiptData(row, family, orderId, supplierId, report);
            data.notes = notesFor(text(row.numero_ref), numero, data.notes);
            const lines = receiptLinesFor(row);
            await tx.goodsReceipt.create({
              data: {
                ...data,
                issuedAt: data.issuedAt ?? legacyDate(new Date().toISOString()) ?? new Date(),
                numero,
                legacyId: BigInt(String(row.id)),
                lines: { create: lines },
              },
            });
            receiptNumbers.add(numero);
            touchedOrders.add(orderId);
            tally.receipts += 1;
            report.created.push(
              `receipt ${numero.padEnd(11)} ${String(row.reception_date ?? "not received")}, ${lines.length} line(s)`,
            );
          };

          for (const row of oldReceipts) {
            const legacyId = String(row.id);
            const numero = text(row.numero_ref);
            const orderRef = String(row.order_ref);
            const orderId = orderIds.get(orderRef);
            const supplier = supplierOf(orderSuppliers.get(orderRef) ?? row.fournisseur_id);
            const here = hereReceiptOf.get(legacyId);

            if (here) {
              if (!orderId || !supplier) {
                report.unresolved.push(`receipt ${here.numero}: its order or supplier is not here`);
                continue;
              }
              const data = receiptData(row, family, orderId, supplier.id, report);
              data.notes = notesFor(numero, here.numero, data.notes);
              const fields = changedFields(here, data);
              const plan = planLines(here.lines, receiptLinesFor(row));
              if (fields.length === 0 && plan.changes === 0) continue;
              const what = [fields.join(", "), linesNote(plan)].filter(Boolean).join("; ");
              if (changedHere.has(here.id)) {
                report.keptHere.push(`receipt ${here.numero}: changed here; the old app's ${what} not taken`);
                continue;
              }
              if (fields.length > 0) await tx.goodsReceipt.update({ where: { id: here.id }, data });
              for (const line of plan.update) await tx.goodsReceiptLine.update({ where: { id: line.id }, data: line.data });
              for (const line of plan.create) await tx.goodsReceiptLine.create({ data: { ...line, receiptId: here.id } });
              if (plan.remove.length) await tx.goodsReceiptLine.deleteMany({ where: { id: { in: plan.remove } } });
              touchedOrders.add(here.orderId);
              touchedOrders.add(orderId);
              report.updated.push(`receipt ${here.numero}: ${what}`);
              continue;
            }

            if (numero === null) {
              report.unresolved.push(`bon_de_reception${suffix} ${legacyId}: blank number, left out`);
              continue;
            }
            if (removedReceipts.has(numero)) {
              report.skipped.push(`receipt ${numero}: deleted here, not brought back`);
              continue;
            }
            if (!orderId || !supplier) {
              report.skipped.push(`receipt ${numero}: its order is not here, left out`);
              continue;
            }
            if (receiptNumbers.has(numero)) {
              clashingReceipts.push({ row, orderId, supplierId: supplier.id });
              continue;
            }
            await createReceipt(row, numero, orderId, supplier.id);
          }

          for (const { row, orderId, supplierId } of clashingReceipts) {
            const oldNumero = String(text(row.numero_ref));
            const numero = await allocate("receipt", RECEIPT_PREFIX[category]);
            await createReceipt(row, numero, orderId, supplierId);
            report.renumbered.push(`receipt ${oldNumero} -> ${numero}: ${oldNumero} is another receipt here`);
          }

          // ---- what the old app deleted ----------------------------------------
          const oldOrderIds = new Set(oldOrders.map((row) => String(row.id)));
          const oldReceiptIds = new Set(oldReceipts.map((row) => String(row.id)));
          const blockers = (receipt: { id: string; legacyId: bigint | null; numero: string; invoices: { numero: string }[] }) => {
            if (receipt.legacyId === null) return `${receipt.numero} was made here`;
            if (changedHere.has(receipt.id)) return `${receipt.numero} was changed here`;
            if (receipt.invoices.length) return `invoice ${receipt.invoices.map((i) => i.numero).join(", ")} points at ${receipt.numero}`;
            return null;
          };
          for (const order of hereOrders) {
            if (oldOrderIds.has(String(order.legacyId))) continue;
            const reason = changedHere.has(order.id)
              ? `${order.numero} was changed here`
              : order.receipts.map(blockers).find((value) => value !== null);
            if (reason) {
              report.keptHere.push(`order   ${order.numero}: deleted in the old app, kept: ${reason}`);
              continue;
            }
            await tx.goodsReceipt.deleteMany({ where: { orderId: order.id } });
            await tx.purchaseOrder.delete({ where: { id: order.id } });
            orderNumbers.delete(order.numero);
            const receipts = order.receipts.map((receipt) => receipt.numero);
            for (const numero of receipts) receiptNumbers.delete(numero);
            report.deleted.push(
              `order   ${order.numero}` + (receipts.length ? ` with receipt ${receipts.join(", ")}` : "") + ": deleted in the old app",
            );
          }
          for (const receipt of hereReceipts) {
            if (oldReceiptIds.has(String(receipt.legacyId))) continue;
            if (!receiptNumbers.has(receipt.numero)) continue; // went with its order above
            const reason = blockers(receipt);
            if (reason) {
              report.keptHere.push(`receipt ${receipt.numero}: deleted in the old app, kept: ${reason}`);
              continue;
            }
            await tx.goodsReceipt.delete({ where: { id: receipt.id } });
            receiptNumbers.delete(receipt.numero);
            touchedOrders.add(receipt.orderId);
            report.deleted.push(`receipt ${receipt.numero}: deleted in the old app`);
          }
        }

        // ---- supplier invoices --------------------------------------------------
        const oldInvoices = await q(
          `SELECT *, ${tunisDay("date_facture")}, ${tunisDay("date_echeance")}, ${tunisDay("date_paiement")}
             FROM facture_achat ORDER BY id`,
        );
        const oldInvoiceLines = groupBy(
          await q(`SELECT * FROM ligne_facture_achat ORDER BY facture_achat_id, id`),
          "facture_achat_id",
        );
        const oldDocuments = new Map<string, string[]>();
        for (const row of await q(
          `SELECT facture_achat_id, file_url FROM document_facturation
            WHERE facture_achat_id IS NOT NULL ORDER BY id`,
        )) {
          const url = text(row.file_url);
          if (url === null) continue;
          const key = String(row.facture_achat_id);
          oldDocuments.set(key, [...(oldDocuments.get(key) ?? []), url]);
        }

        const receiptRows = await tx.goodsReceipt.findMany({
          where: { legacyId: { not: null } },
          select: { id: true, category: true, legacyId: true },
        });
        const receiptOf = new Map(receiptRows.map((row) => [`${row.category}:${String(row.legacyId)}`, row.id]));
        const categoryOf = new Map(FAMILIES.map((family) => [family.grType, family.category]));
        const receiptIdFor = (grType: string | null, grId: bigint | null) => {
          const category = grType === null ? undefined : categoryOf.get(grType);
          return category === undefined || grId === null ? undefined : receiptOf.get(`${category}:${String(grId)}`);
        };

        const hereInvoices = await tx.purchaseInvoice.findMany({
          where: { legacyId: { not: null } },
          include: { lines: { orderBy: { position: "asc" } } },
        });
        const hereInvoiceOf = new Map(hereInvoices.map((row) => [String(row.legacyId), row]));
        const invoiceNumbers = new Set(
          (await tx.purchaseInvoice.findMany({ select: { numero: true } })).map((row) => row.numero),
        );

        for (const row of oldInvoices) {
          const legacyId = String(row.id);
          const numero = invoiceNumero(row);
          const supplier = supplierOf(row.fournisseur_id);
          const here = hereInvoiceOf.get(legacyId);
          if (numero === null) {
            report.unresolved.push(`facture_achat ${legacyId}: blank number, left out`);
            continue;
          }
          if (!supplier) {
            report.unresolved.push(`invoice ${numero}: supplier ${String(row.fournisseur_id)} not here`);
            continue;
          }
          const data = invoiceData(row, numero, supplier.id, report);
          const oldLines = oldInvoiceLines.get(legacyId) ?? [];
          const contents = oldLines.map((line, index) => invoiceLineContent(line, index + 1));
          const lines = oldLines.map((line, index) => ({
            ...invoiceLineContent(line, index + 1),
            legacyId: BigInt(String(line.id)),
          }));
          const documents = oldDocuments.get(legacyId) ?? [];
          const receiptId = receiptIdFor(data.legacyReceiptType, data.legacyReceiptId);

          if (here) {
            const fields = changedFields(here, data);
            if (fields.includes("numero") && invoiceNumbers.has(numero)) {
              report.unresolved.push(`invoice ${here.numero}: renamed ${numero} in the old app, a number already here`);
              fields.splice(fields.indexOf("numero"), 1);
              data.numero = here.numero;
            }
            const merged = [...here.documents, ...documents.filter((url) => !here.documents.includes(url))];
            if (merged.length > here.documents.length) fields.push("files");
            if (receiptId !== undefined && receiptId !== here.receiptId) fields.push("receipt");
            const matches = (desired: Record<string, Value>[]) =>
              here.lines.length === desired.length &&
              desired.every((line, index) => {
                const current = here.lines[index];
                return current !== undefined && changedFields(current, line).length === 0;
              });
            const sameLines = matches(lines);
            if (fields.length === 0 && sameLines) continue;
            // The old app writes an invoice's lines anew on every save: the
            // same lines under new ids are rewritten, but not reported.
            const sameContent = matches(contents);
            if (!sameLines && sameContent) tally.relinked += 1;
            const what = [fields.join(", "), sameContent ? null : "lines"].filter(Boolean).join("; ");
            if (changedHere.has(here.id)) {
              if (what) report.keptHere.push(`invoice ${here.numero}: changed here; the old app's ${what} not taken`);
              continue;
            }
            await tx.purchaseInvoice.update({
              where: { id: here.id },
              data: { ...data, documents: merged, ...(receiptId !== undefined ? { receiptId } : {}) },
            });
            if (!sameLines) {
              await tx.purchaseInvoiceLine.deleteMany({ where: { invoiceId: here.id } });
              await tx.purchaseInvoiceLine.createMany({ data: lines.map((line) => ({ ...line, invoiceId: here.id })) });
            }
            invoiceNumbers.add(data.numero);
            if (what) report.updated.push(`invoice ${here.numero}: ${what}`);
            continue;
          }

          if (removedInvoices.has(numero)) {
            report.skipped.push(`invoice ${numero}: deleted here, not brought back`);
            continue;
          }
          if (invoiceNumbers.has(numero)) {
            report.skipped.push(`invoice ${numero}: the number is already an invoice here, left out`);
            continue;
          }
          await tx.purchaseInvoice.create({
            data: {
              ...data,
              documents,
              receiptId: receiptId ?? null,
              legacyId: BigInt(legacyId),
              lines: { create: lines },
            },
          });
          invoiceNumbers.add(numero);
          tally.invoices += 1;
          report.created.push(
            `invoice ${numero.padEnd(18)} ${supplier.name}, ${String(row.date_facture ?? "no date")}, ` +
              `${lines.length} line(s)` +
              (data.legacyReceiptType && receiptId === undefined ? ", its receipt is not here" : ""),
          );
        }

        const oldInvoiceIds = new Set(oldInvoices.map((row) => String(row.id)));
        for (const invoice of hereInvoices) {
          if (oldInvoiceIds.has(String(invoice.legacyId))) continue;
          if (changedHere.has(invoice.id)) {
            report.keptHere.push(`invoice ${invoice.numero}: deleted in the old app, kept: changed here`);
            continue;
          }
          await tx.purchaseInvoice.delete({ where: { id: invoice.id } });
          report.deleted.push(`invoice ${invoice.numero}: deleted in the old app`);
        }

        // ---- received to date, counters -----------------------------------------
        let recomputed = 0;
        if (touchedOrders.size > 0) {
          recomputed = await tx.$executeRaw`
            UPDATE "PurchaseOrderLine" ol
            SET "receivedQuantity" = sums.recv
            FROM (
                SELECT l.id, COALESCE(SUM(rl."receivedQuantity"), 0) AS recv
                FROM "PurchaseOrderLine" l
                LEFT JOIN "GoodsReceiptLine" rl ON rl."orderLineId" = l.id
                WHERE l."orderId" = ANY(${[...touchedOrders]}::text[])
                GROUP BY l.id
            ) AS sums
            WHERE ol.id = sums.id AND ol."receivedQuantity" <> sums.recv`;
        }

        const counterMoves: string[] = [];
        for (const prefix of Object.values(ORDER_PREFIX)) {
          const counter = await tx.purchaseOrderCounter.findUnique({ where: { prefix } });
          const next = Math.max(counter?.next ?? 1, maxSequence(orderNumbers, prefix) + 1);
          if (counter?.next === next) continue;
          await tx.purchaseOrderCounter.upsert({ where: { prefix }, create: { prefix, next }, update: { next } });
          counterMoves.push(`${prefix} ${counter?.next ?? "-"} -> ${next}`);
        }
        for (const prefix of Object.values(RECEIPT_PREFIX)) {
          const counter = await tx.goodsReceiptCounter.findUnique({ where: { prefix } });
          const next = Math.max(counter?.next ?? 1, maxSequence(receiptNumbers, prefix) + 1);
          if (counter?.next === next) continue;
          await tx.goodsReceiptCounter.upsert({ where: { prefix }, create: { prefix, next }, update: { next } });
          counterMoves.push(`${prefix} ${counter?.next ?? "-"} -> ${next}`);
        }

        counts.push(
          `created:   ${tally.orders} order(s), ${tally.receipts} receipt(s), ${tally.invoices} invoice(s)`,
          `updated:   ${report.updated.length}` +
            (tally.relinked ? ` (+ ${tally.relinked} invoice(s) whose same lines the old app re-saved)` : ""),
          `deleted:   ${report.deleted.length}`,
          `received:  ${recomputed} order line(s) recomputed`,
          `counters:  ${counterMoves.length ? counterMoves.join(", ") : "unchanged"}`,
        );

        if (!apply) throw new DryRunRollback();
      },
      { timeout: 600_000, maxWait: 10_000 },
    );
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  } finally {
    const section = (title: string, lines: string[]) => {
      if (lines.length === 0) return;
      console.log(`\n${title} (${lines.length})`);
      for (const line of lines) console.log(`  ${line}`);
    };
    section("created", report.created);
    section("renumbered: the old number is in the notes", report.renumbered);
    section("updated to the old app's figures", report.updated);
    section("deleted, as in the old app", report.deleted);
    section("left as they are here", report.keptHere);
    section("not brought over", report.skipped);
    section("values that did not resolve", report.unresolved);
    console.log("");
    for (const line of counts) console.log(line);
    if (!apply) console.log("\n(dry run — rolled back, nothing written; --apply to write)");
    await raw.end();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
