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

/** A client as the "bill to" box prints it. */
export const CLIENT_BLOCK_SELECT = {
  id: true,
  name: true,
  address: true,
  taxId: true,
  phone: true,
  email: true,
} satisfies Prisma.ClientSelect;

type ClientRow = Prisma.ClientGetPayload<{ select: typeof CLIENT_BLOCK_SELECT }>;

/** An order a draft's unsaved line names, as the caller looked it up. */
export interface AttachableOrder {
  numero: string;
  client: ClientRow | null;
}

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
  client: { select: CLIENT_BLOCK_SELECT },
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
      // The order's client: an invoice billing several clients' orders
      // prints them all in its "bill to" box.
      order: { select: { numero: true, client: { select: CLIENT_BLOCK_SELECT } } },
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

function clientBlock(client: Omit<ClientRow, "id">) {
  return {
    name: client.name,
    address: textOrNull(client.address),
    taxId: textOrNull(client.taxId),
    phone: textOrNull(client.phone),
    email: textOrNull(client.email),
  };
}

/**
 * The model of an invoice as stored, or — given `draft` — as it would be if
 * that unsaved payload were saved.
 *
 * The draft path mirrors `InvoiceService.updateDraft` but never throws on
 * content, because it feeds a live preview of a half-typed form. Where
 * `updateDraft` refuses, this settles:
 *
 * - a line's order link is the payload's `orderId` only when that order is
 *   already on the draft or is one `attachable` names — the orders a save
 *   could add, looked up by the caller. Any other id prints as no order, so
 *   a preview cannot be made to print an arbitrary order's number, and is
 *   never an error. An omitted `orderId` keeps what its position stores;
 * - an omitted `mention` keeps the one stored for that order (the update
 *   convention), and a mention on a line that bills no order is dropped;
 * - totals are `invoiceTotals` of the payload, exactly what a save would store.
 *
 * The client billed follows the orders the lines name, as `InvoiceService`
 * derives `SalesInvoice.clientId`: their client when they share one, all of
 * them (`clients`) when they are several, and the stored client when no line
 * names an order.
 */
export function toSalesInvoiceModel(
  stored: StoredSalesInvoice,
  draft?: UpdateSalesInvoiceDraftInput,
  attachable: ReadonlyMap<string, AttachableOrder> = new Map(),
): SalesInvoiceModel {
  const storedByPosition = new Map(stored.lines.map((line) => [line.position, line]));
  const storedByOrder = new Map(
    stored.lines.flatMap((line) => (line.orderId ? [[line.orderId, line] as const] : [])),
  );
  /** The order number each model line names, in line order; null for none. */
  const lineNumeros: (string | null)[] = [];
  /** The client of each line's order, in line order; null for none. */
  const lineClients: (ClientRow | null)[] = [];

  const lines: SalesInvoiceModelLine[] = draft
    ? [...draft.lines]
        .sort((a, b) => a.position - b.position)
        .map((line) => {
          const asked =
            line.orderId === undefined
              ? (storedByPosition.get(line.position)?.orderId ?? null)
              : line.orderId;
          const kept = asked === null ? undefined : storedByOrder.get(asked);
          const added = asked === null ? undefined : attachable.get(asked);
          const numero = kept?.order?.numero ?? added?.numero ?? null;
          const billsOrder = numero !== null;
          lineNumeros.push(numero);
          lineClients.push(kept?.order?.client ?? added?.client ?? null);
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
    : stored.lines.map((line) => {
        lineNumeros.push(line.order?.numero ?? null);
        lineClients.push(line.order?.client ?? null);
        return {
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
        };
      });

  // The orders named are those of the lines that survive into the model.
  const orderNumeros: string[] = [];
  for (const numero of lineNumeros) {
    if (numero && !orderNumeros.includes(numero)) orderNumeros.push(numero);
  }
  const orderClients = new Map<string, ClientRow>();
  for (const client of lineClients) {
    if (client && !orderClients.has(client.id)) orderClients.set(client.id, client);
  }
  const billed = [...orderClients.values()];

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
    client:
      billed.length === 1 && billed[0]
        ? clientBlock(billed[0])
        : billed.length > 1 || !stored.client
          ? null
          : clientBlock(stored.client),
    clients: billed.length > 1 ? billed.map(clientBlock) : [],
    orderNumeros,
    lines,
    totals: draft
      ? invoiceTotals(draft.lines)
      : { totalHt: stored.totalHt, vatAmount: stored.vatAmount, totalTtc: stored.totalTtc },
  };
}
