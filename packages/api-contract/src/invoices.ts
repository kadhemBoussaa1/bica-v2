import { z } from "zod";
import { enumLabel, type PaperType } from "./orders.js";
import type { ProductSpec } from "./pricing.js";

/**
 * Sales invoices raised from orders — docs/sales-invoice-plan.md.
 *
 * A leaf module like `orders.ts`: the enums, the two pure helpers the server
 * and the draft editor must agree on (line totals, the product description),
 * and the Zod inputs for the write path. Nothing here reaches for Prisma.
 */

/** DRAFT until issued; ISSUED is final — an issued invoice is never deleted. */
export const SALES_INVOICE_STATUSES = ["DRAFT", "ISSUED"] as const;
export type SalesInvoiceStatus = (typeof SALES_INVOICE_STATUSES)[number];

/** The three currencies the migrated invoices use. */
export const CURRENCIES = ["TND", "EUR", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Mirrors `PaymentMethod` in the schema. */
export const PAYMENT_METHODS = ["VIREMENT", "CHEQUE", "ESPECES"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * The VAT rate a new line starts with. Zero for every currency: all 314
 * migrated lines and all 47 invoices carry no VAT, the TND ones included
 * (plan §2.3). Whether TND invoices should carry 19 % from now on is an open
 * business question; if the answer is yes, this is the one place to change.
 */
export function defaultTaxPct(currency: string | null): number {
  void currency; // the parameter is the seam for a per-currency rule
  return 0;
}

/** Non-negative percent, 0..100. */
const percent = z.number().min(0).max(100);

/**
 * One line as an editor submits it — the same shape for both invoice kinds.
 *
 * The sales variant adds `orderId`, accepted only so an edit round-trips the
 * link the server wrote at creation; the service keeps the stored value per
 * position and refuses a changed or newly added one (plan §4) — attaching a
 * second order to a draft is a later feature.
 */
export const invoiceLineInput = z.object({
  position: z.number().int().min(1).max(100),
  product: z.string().trim().max(200).optional(),
  description: z.string().trim().max(1000).optional(),
  quantity: z.number().min(0).max(1e9),
  unitPrice: z.number().min(0).max(1e9),
  discountPct: percent.default(0),
  taxPct: percent.default(0),
});
export type InvoiceLineInput = z.infer<typeof invoiceLineInput>;

/** Mirrors `ProductMention` in the schema. */
export const PRODUCT_MENTIONS = ["FSC", "PEFC"] as const;
export type ProductMention = (typeof PRODUCT_MENTIONS)[number];

/**
 * The designation as every document shows it: the free-text description,
 * then the mention after a dash ("Sac fond carré 25*14*30 … — FSC"). The
 * one place the format lives — the invoice page, the shipment page and both
 * PDFs all go through it, so the stored description never carries the
 * mention and editing one cannot garble the other.
 */
export function withMention(
  description: string | null | undefined,
  mention: ProductMention | null | undefined,
): string {
  const text = description?.trim() ?? "";
  if (!mention) return text;
  return text === "" ? mention : `${text} — ${mention}`;
}

/**
 * `mention` follows the update convention: `undefined` keeps what the line's
 * position already stores, `null` clears it. It is accepted only on a line
 * that bills an order; the service refuses it anywhere else.
 */
export const salesInvoiceLineInput = invoiceLineInput.extend({
  orderId: z.string().min(1).nullable().optional(),
  mention: z.enum(PRODUCT_MENTIONS).nullable().optional(),
});
export type SalesInvoiceLineInput = z.infer<typeof salesInvoiceLineInput>;

/**
 * The tax-inclusive line total the migrated lines use (both kinds), and the
 * header figures derived from it: `totalHt` is the sum of the lines before
 * tax, `vatAmount` the sum of each line's tax, `totalTtc` their sum. With
 * every rate at 0 (the sales data today) this collapses to `totalHt = Σ
 * lines.total`, the invariant the migration verified on all 47 sales rows;
 * on the 87 purchase invoices whose lines carry VAT it is `totalTtc` that
 * equals the line sum, which is exactly this rule.
 *
 * Floats, per the schema-wide decision; rounding is a display concern.
 */
export function invoiceLineFigures(line: {
  quantity: number;
  unitPrice: number;
  discountPct: number;
  taxPct: number;
}): { net: number; tax: number; total: number } {
  const net = line.quantity * line.unitPrice * (1 - line.discountPct / 100);
  const tax = net * (line.taxPct / 100);
  return { net, tax, total: net + tax };
}

export function invoiceTotals(
  lines: readonly { quantity: number; unitPrice: number; discountPct: number; taxPct: number }[],
): { totalHt: number; vatAmount: number; totalTtc: number } {
  let totalHt = 0;
  let vatAmount = 0;
  for (const line of lines) {
    const figures = invoiceLineFigures(line);
    totalHt += figures.net;
    vatAmount += figures.tax;
  }
  return { totalHt, vatAmount, totalTtc: totalHt + vatAmount };
}

/**
 * The one-line product description an invoice line carries, in the style
 * of the migrated lines ("Sac en V 10,5*5,5*23 en papier kraft 35 g").
 * French decimal commas because that is how the existing documents read.
 */
export function describeProductSpec(
  spec: ProductSpec & { paperType?: PaperType | null },
  unitsPerParcel: number | null,
  unit: "PIECES" | "KILOGRAMS",
): string {
  const n = (v: number) => String(v).replace(".", ",");
  const kind =
    spec.typeSac === "SOUS_PLAT"
      ? "Papier plateaux"
      : spec.typeSac === "FOND_V"
        ? "Sac en V"
        : "Sac fond carré";
  const dims =
    spec.typeSac === "SOUS_PLAT"
      ? `${n(spec.widthCm)}*${n(spec.lengthCm)}`
      : `${n(spec.widthCm)}*${n(spec.gussetCm ?? 0)}*${n(spec.lengthCm)}`;
  const paper = spec.paperType ? enumLabel(spec.paperType).toLowerCase() : "papier kraft";
  const handle = spec.hasHandle ? " avec poignées" : "";
  const parcel =
    unitsPerParcel === null
      ? ""
      : ` (${n(unitsPerParcel)}${unit === "KILOGRAMS" ? "kg" : "pcs"}/colis)`;
  return `${kind} ${dims} en ${paper} ${n(spec.grammage)} g${handle}${parcel}`;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const salesInvoiceIdInput = z.object({ id: z.string().min(1) });

export const createSalesInvoiceFromOrderInput = z.object({
  orderId: z.string().min(1),
  /** Optional: the certification mention the draft's line starts with. */
  mention: z.enum(PRODUCT_MENTIONS).nullable().optional(),
});
export type CreateSalesInvoiceFromOrderInput = z.infer<typeof createSalesInvoiceFromOrderInput>;

/** ISO date, `YYYY-MM-DD`, as the `@db.Date` columns are exchanged. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/**
 * A sales invoice typed from scratch, billing whatever the client is being
 * charged for — not a job order.
 *
 * This is the ordinary case, not an edge one: 314 of the 315 migrated lines
 * carry no `orderId` and 47 of the 48 invoices name no order anywhere, so
 * `createFromOrder` is the special path and this is the general one. Nothing
 * in the model had to change to allow it — `SalesInvoice` has no order column
 * at all, and the link is per line.
 *
 * The lines go in with `orderId` null, which is why `salesInvoiceLineInput`
 * is not reused here: accepting one would let a caller attach an order
 * without any of the lifecycle `createFromOrder` owns (the order's
 * `INVOICEABLE -> INVOICED` transition, the one-draft-per-order guard, the
 * un-invoiced balance). Raising an invoice for an order stays that path's job.
 *
 * `clientId` is required even though the column is nullable: the 24 migrated
 * rows without one are a gap in the source data (see the schema comment), and
 * a newly typed invoice with nobody to bill is a mistake, not a case to
 * support. The draft then joins the same DRAFT -> ISSUED lifecycle and takes
 * its number from the same `SalesInvoiceCounter` as every other sales invoice.
 */
export const createSalesInvoiceInput = z.object({
  clientId: z.string().min(1, "Choose a client"),
  currency: z.enum(CURRENCIES).nullable().optional(),
  dueAt: isoDate.nullable().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  category: z.string().trim().max(200).nullable().optional(),
  lines: z.array(invoiceLineInput).min(1).max(50),
});
export type CreateSalesInvoiceInput = z.infer<typeof createSalesInvoiceInput>;

/**
 * Everything a draft lets you change. `null` clears a header field,
 * `undefined` leaves it alone — the update convention used everywhere else.
 * Lines are replaced wholesale, like order colours.
 */
export const updateSalesInvoiceDraftInput = z.object({
  id: z.string().min(1),
  currency: z.enum(CURRENCIES).nullable().optional(),
  dueAt: isoDate.nullable().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  category: z.string().trim().max(200).nullable().optional(),
  lines: z.array(salesInvoiceLineInput).min(1).max(50),
});
export type UpdateSalesInvoiceDraftInput = z.infer<typeof updateSalesInvoiceDraftInput>;

export const issueSalesInvoiceInput = z.object({
  id: z.string().min(1),
  /** Defaults to today on the server. */
  issuedAt: isoDate.optional(),
});
export type IssueSalesInvoiceInput = z.infer<typeof issueSalesInvoiceInput>;

/** The note lands on the order's `INVOICED -> INVOICEABLE` transition, so it is required like every reopen. */
export const discardSalesInvoiceDraftInput = z.object({
  id: z.string().min(1),
  note: z.string().trim().min(1, "A note is required").max(500),
});
export type DiscardSalesInvoiceDraftInput = z.infer<typeof discardSalesInvoiceDraftInput>;

// ---------------------------------------------------------------------------
// Purchase invoices — a supplier's document, recorded as received
// ---------------------------------------------------------------------------

/**
 * Everything on a purchase invoice, for create and update alike. A full
 * form, so this is create-or-replace: every nullable field is written from
 * the payload, and `null`/absent both clear it. No draft/issue lifecycle —
 * the number is the supplier's, printed on the document.
 *
 * `documents` (scanned PDFs) are deliberately not here: uploads are a
 * separate concern, and an edit must never be able to drop the scan.
 */
export const purchaseInvoiceInput = z.object({
  numero: z.string().trim().min(1, "The supplier's invoice number is required").max(100),
  supplierId: z.string().min(1, "Choose a supplier"),
  issuedAt: isoDate.nullable().optional(),
  dueAt: isoDate.nullable().optional(),
  paidAt: isoDate.nullable().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  category: z.string().trim().max(200).nullable().optional(),
  forProduction: z.boolean().nullable().optional(),
  currency: z.enum(CURRENCIES).nullable().optional(),
  exchangeRate: z.number().positive().max(1e6).nullable().optional(),
  /** Retenue à la source, an amount in the invoice's currency. */
  withholdingTax: z.number().min(0).max(1e9).nullable().optional(),
  /** The goods receipt this was raised against; must be the same supplier's. */
  receiptId: z.string().min(1).nullable().optional(),
  lines: z.array(invoiceLineInput).min(1).max(100),
});
export type PurchaseInvoiceInput = z.infer<typeof purchaseInvoiceInput>;

export const createPurchaseInvoiceInput = purchaseInvoiceInput;
export type CreatePurchaseInvoiceInput = z.infer<typeof createPurchaseInvoiceInput>;

export const updatePurchaseInvoiceInput = purchaseInvoiceInput.extend({
  id: z.string().min(1),
});
export type UpdatePurchaseInvoiceInput = z.infer<typeof updatePurchaseInvoiceInput>;

export const purchaseInvoiceIdInput = z.object({ id: z.string().min(1) });
