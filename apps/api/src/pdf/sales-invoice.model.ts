import {
  SALES_INVOICE_SNAPSHOT_VERSION,
  invoiceLineFigures,
  invoiceTotals,
  type PaymentMethod,
  type SalesInvoiceModel,
  type SalesInvoiceModelLine,
  type UpdateSalesInvoiceDraftInput,
} from "@repo/api-contract";
import type { Prisma } from "../generated/prisma/client.js";
import { COMPANY } from "./pdf.identity";

/*
 * From a sales invoice row to the plain data its PDF prints.
 *
 * One pure mapping with three callers — the GET route, the live preview and
 * the snapshot `issue()` freezes — so the three cannot disagree about what an
 * invoice says. See `salesInvoiceModelSchema` in the contract for why the
 * result is frozen at issue.
 */

/** What the PDF reads. Wider than the detail page's select on the client: the document prints the address and tax ID. */
export const SALES_INVOICE_PDF_SELECT = {
  id: true,
  numero: true,
  status: true,
  issuedAt: true,
  dueAt: true,
  paymentMethod: true,
  currency: true,
  totalHt: true,
  vatAmount: true,
  totalTtc: true,
  templateVersionId: true,
  issuedSnapshot: true,
  client: {
    select: { name: true, address: true, taxId: true, phone: true, email: true },
  },
  lines: {
    select: {
      position: true,
      product: true,
      description: true,
      mention: true,
      quantity: true,
      unitPrice: true,
      discountPct: true,
      taxPct: true,
      total: true,
      orderId: true,
      order: { select: { numero: true } },
    },
    orderBy: { position: "asc" },
  },
} satisfies Prisma.SalesInvoiceSelect;

type StoredSalesInvoice = Prisma.SalesInvoiceGetPayload<{
  select: typeof SALES_INVOICE_PDF_SELECT;
}>;

/** `@db.Date` columns hold a bare day at UTC midnight. */
function isoDay(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

/** An editor sends `""` for a cleared text field; the document treats it as absent. */
function textOrNull(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text === "" ? null : text;
}

/**
 * The model of an invoice as stored, or — given `draft` — as it would be if
 * that unsaved payload were saved.
 *
 * The draft path mirrors `InvoiceService.updateDraft` but never throws on
 * content, because it feeds a live preview of a half-typed form. Where
 * `updateDraft` refuses, this settles:
 *
 * - a line's order link is what its **position stores**. The payload's
 *   `orderId` is ignored outright — never trusted, so a preview cannot be
 *   made to print another order's number, and never an error;
 * - an omitted `mention` keeps the stored one (the update convention), and a
 *   mention on a line that bills no order is dropped;
 * - totals are `invoiceTotals` of the payload, exactly what a save would store.
 */
export function toSalesInvoiceModel(
  stored: StoredSalesInvoice,
  draft?: UpdateSalesInvoiceDraftInput,
): SalesInvoiceModel {
  const storedByPosition = new Map(stored.lines.map((line) => [line.position, line]));

  const lines: SalesInvoiceModelLine[] = draft
    ? [...draft.lines]
        .sort((a, b) => a.position - b.position)
        .map((line) => {
          const kept = storedByPosition.get(line.position);
          const billsOrder = Boolean(kept?.orderId);
          const figures = invoiceLineFigures(line);
          return {
            position: line.position,
            product: textOrNull(line.product),
            description: textOrNull(line.description),
            mention: !billsOrder
              ? null
              : line.mention === undefined
                ? (kept?.mention ?? null)
                : line.mention,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountPct: line.discountPct,
            taxPct: line.taxPct,
            net: figures.net,
            total: figures.total,
          };
        })
    : stored.lines.map((line) => ({
        position: line.position,
        product: textOrNull(line.product),
        description: textOrNull(line.description),
        mention: line.mention,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPct: line.discountPct,
        taxPct: line.taxPct,
        net:
          line.quantity === null || line.unitPrice === null
            ? null
            : invoiceLineFigures({
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                discountPct: line.discountPct ?? 0,
                taxPct: line.taxPct ?? 0,
              }).net,
        total: line.total,
      }));

  // The orders named are those of the positions that survive into the model.
  const orderNumeros: string[] = [];
  for (const line of lines) {
    const numero = storedByPosition.get(line.position)?.order?.numero;
    if (numero && !orderNumeros.includes(numero)) orderNumeros.push(numero);
  }

  const pick = <T>(next: T | undefined, current: T): T => (next === undefined ? current : next);

  return {
    snapshotVersion: SALES_INVOICE_SNAPSHOT_VERSION,
    status: stored.status,
    numero: stored.numero,
    issuedAt: isoDay(stored.issuedAt),
    dueAt: draft ? pick(draft.dueAt, isoDay(stored.dueAt)) : isoDay(stored.dueAt),
    paymentMethod: draft
      ? pick<PaymentMethod | null>(draft.paymentMethod, stored.paymentMethod)
      : stored.paymentMethod,
    currency: draft ? pick<string | null>(draft.currency, stored.currency) : stored.currency,
    issuer: {
      name: COMPANY.name,
      addressLines: [...COMPANY.addressLines],
      phones: [...COMPANY.phones],
      emails: [...COMPANY.emails],
      website: COMPANY.website,
      taxId: COMPANY.taxId,
    },
    client: stored.client
      ? {
          name: stored.client.name,
          address: textOrNull(stored.client.address),
          taxId: textOrNull(stored.client.taxId),
          phone: textOrNull(stored.client.phone),
          email: textOrNull(stored.client.email),
        }
      : null,
    orderNumeros,
    lines,
    totals: draft
      ? invoiceTotals(draft.lines)
      : { totalHt: stored.totalHt, vatAmount: stored.vatAmount, totalTtc: stored.totalTtc },
  };
}
