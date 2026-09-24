import { z } from "zod";
import { PAYMENT_METHODS, PRODUCT_MENTIONS, SALES_INVOICE_STATUSES } from "./invoices.js";

/**
 * Everything a sales invoice PDF prints, as plain data.
 *
 * One shape with three jobs: it is what the renderer consumes, what the live
 * preview builds from a half-typed draft, and what `issue()` freezes into
 * `SalesInvoice.issuedSnapshot`. The freeze is the point. `Client` is a live
 * relation and the issuer block is a code constant, so a PDF rendered from the
 * tables months after issue would print whatever they say by then — and the
 * four languages of one legal document, each minted on first request, could
 * disagree. Rendering from the snapshot makes every language, and every
 * re-mint of a lost file, say what the invoice said the day it was issued.
 *
 * It comes back out of a `Json` column, hence a schema rather than a type:
 * parse on read, and bump `snapshotVersion` with an upgrade step if a field is
 * ever renamed. Dates are `YYYY-MM-DD` strings for the same reason.
 *
 * Figures are the stored Floats, untouched. `net` is the one derived number
 * (the line before tax) and is derived when the model is built, never in the
 * renderer, so a snapshot prints the same figures forever.
 */

export const SALES_INVOICE_SNAPSHOT_VERSION = 1;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().max(max);
const amount = z.number().nullable();

export const salesInvoiceModelLine = z.object({
  position: z.number().int(),
  product: text(200).nullable(),
  description: text(1000).nullable(),
  mention: z.enum(PRODUCT_MENTIONS).nullable(),
  quantity: amount,
  unitPrice: amount,
  discountPct: amount,
  taxPct: amount,
  /** Before tax, after discount. Null when the line has no figures to derive it from. */
  net: amount,
  /** Tax-inclusive, as stored. */
  total: amount,
});
export type SalesInvoiceModelLine = z.infer<typeof salesInvoiceModelLine>;

export const salesInvoiceModelSchema = z.object({
  snapshotVersion: z.literal(SALES_INVOICE_SNAPSHOT_VERSION),
  status: z.enum(SALES_INVOICE_STATUSES),
  /** Null while DRAFT: the number is assigned at issue. */
  numero: text(100).nullable(),
  issuedAt: isoDay.nullable(),
  dueAt: isoDay.nullable(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  /** A plain string, not the enum: 30 legacy rows have none and the column is free text. */
  currency: text(10).nullable(),
  issuer: z.object({
    name: text(200),
    addressLines: z.array(text(200)).max(6),
    phones: z.array(text(50)).max(4),
    emails: z.array(text(200)).max(4),
    website: text(200),
    taxId: text(50),
  }),
  /** Null on the 24 legacy rows raised without one. */
  client: z
    .object({
      name: text(300),
      address: text(1000).nullable(),
      taxId: text(100).nullable(),
      phone: text(100).nullable(),
      email: text(300).nullable(),
    })
    .nullable(),
  /** The orders the lines bill, in line order, without repeats. */
  orderNumeros: z.array(text(100)).max(100),
  lines: z.array(salesInvoiceModelLine).max(100),
  totals: z.object({ totalHt: amount, vatAmount: amount, totalTtc: amount }),
});
export type SalesInvoiceModel = z.infer<typeof salesInvoiceModelSchema>;
