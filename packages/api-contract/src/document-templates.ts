import { z } from "zod";
import { salesInvoiceLayoutSchema } from "./document-layout-sales-invoice.js";
import { PDF_LOCALES } from "./pdf-locale.js";
import { updateSalesInvoiceDraftInput } from "./invoices.js";
import type { SalesInvoiceModel } from "./sales-invoice-model.js";

/**
 * Document templates — docs/sales-invoice-pdf-plan.md, phase 2.
 *
 * A template is a named layout; its versions are the history. A version is a
 * **draft** until published and **frozen** after: an issued invoice pins the
 * version it printed with, so a published row is never updated. Each template
 * has at most one draft, which saving overwrites — nothing pins a draft, so
 * there is nothing to protect, and a row per keystroke-save would bury the
 * history that matters.
 *
 * Reading is ADMIN (they issue the invoices these style); writing is
 * SUPER_ADMIN, because a published default restyles every invoice issued
 * after it.
 */

/** Mirrors `DocumentTemplateKind` in the schema. */
export const DOCUMENT_TEMPLATE_KINDS = ["SALES_INVOICE"] as const;
export type DocumentTemplateKind = (typeof DOCUMENT_TEMPLATE_KINDS)[number];

const name = z.string().trim().min(1, "Give the template a name").max(80);

export const documentTemplateIdInput = z.object({ id: z.string().min(1) });

/** A new template, starting as a draft copy of another template's newest layout. */
export const createDocumentTemplateInput = z.object({
  name,
  fromTemplateId: z.string().min(1),
});
export type CreateDocumentTemplateInput = z.infer<typeof createDocumentTemplateInput>;

export const renameDocumentTemplateInput = z.object({ id: z.string().min(1), name });
export type RenameDocumentTemplateInput = z.infer<typeof renameDocumentTemplateInput>;

/** Writes the template's draft version: created if there is none, overwritten if there is. */
export const saveDocumentTemplateVersionInput = z.object({
  templateId: z.string().min(1),
  layout: salesInvoiceLayoutSchema,
});
export type SaveDocumentTemplateVersionInput = z.infer<typeof saveDocumentTemplateVersionInput>;

/** Freezes the template's draft. Invoices issued from now on pin it, if the template is the default. */
export const publishDocumentTemplateInput = z.object({ templateId: z.string().min(1) });
export type PublishDocumentTemplateInput = z.infer<typeof publishDocumentTemplateInput>;

/**
 * The second source of the preview endpoint: an unsaved layout printed with
 * the sample invoice, for the template settings and the designer. No record
 * is read, which is why a layout — client-supplied, server-rendered — is
 * accepted at all; SUPER_ADMIN only, like every other template write.
 */
export const salesInvoiceSamplePreviewInput = z.object({
  source: z.literal("sample"),
  lang: z.enum(PDF_LOCALES),
  layout: salesInvoiceLayoutSchema,
  /** Print the sample as a draft (watermark, no number) or as issued. */
  status: z.enum(["DRAFT", "ISSUED"]).default("ISSUED"),
});

/**
 * What `POST /documents/sales-invoice/preview.pdf` accepts. `draft` is the
 * live preview of an invoice being typed; `sample` is a layout being edited.
 */
export const salesInvoicePreviewInput = z.discriminatedUnion("source", [
  updateSalesInvoiceDraftInput.extend({
    source: z.literal("draft"),
    lang: z.enum(PDF_LOCALES),
  }),
  salesInvoiceSamplePreviewInput,
]);
export type SalesInvoicePreviewInput = z.infer<typeof salesInvoicePreviewInput>;

const SAMPLE_PRODUCTS = [
  ["Sac fond carré", "Sac fond carré 25*14*30 kraft brun 90 g (250 pcs/colis)"],
  ["Sac en V", "Sac en V 10,5*5,5*23 en papier kraft blanchi 35 g"],
  ["Poche V imprimée", "Poche en V kraft imprimé 35 g 14*4*32 (1400 pcs/colis)"],
  ["Sac kraft torsadé", "Sac kraft neutre poignées torsadées 28*17*28 (250 pcs/colis)"],
] as const;

/**
 * The invoice a layout is previewed with: forty lines, so the table runs onto
 * a second page and the repeating head, the compact letterhead, the page
 * count and a last-page block all have something to show. A discount, a
 * mention and VAT are in there for the columns that hide when empty.
 * Every figure is made up.
 */
export const SAMPLE_SALES_INVOICE: SalesInvoiceModel = (() => {
  const lines = Array.from({ length: 40 }, (_, index) => {
    const [product, description] = SAMPLE_PRODUCTS[index % SAMPLE_PRODUCTS.length]!;
    const quantity = 20 + ((index * 37) % 180);
    const unitPrice = [17.5, 0.0125, 24.35, 9.58][index % 4]!;
    const discountPct = index === 2 ? 5 : 0;
    const net = quantity * unitPrice * (1 - discountPct / 100);
    return {
      position: index + 1,
      product,
      description,
      mention: index % 5 === 0 ? ("FSC" as const) : null,
      quantity,
      unitPrice,
      discountPct,
      taxPct: 19,
      net,
      total: net * 1.19,
    };
  });
  const totalHt = lines.reduce((sum, line) => sum + line.net, 0);
  return {
    snapshotVersion: 1,
    status: "ISSUED",
    numero: "F260000",
    issuedAt: "2026-01-15",
    dueAt: "2026-02-14",
    paymentMethod: "VIREMENT",
    currency: "TND",
    issuer: {
      name: "BICA PAWN PACKAGING",
      addressLines: ["Z.I BEMBLA ROUTE JEMMEL", "5021 TUNISIE"],
      phones: ["+216 00 000 000"],
      emails: ["contact@example.com"],
      website: "www.bicapack.com",
      taxId: "0000000XXX000",
    },
    client: {
      name: "Client Exemple SARL",
      address: "12 rue de l'Exemple, 4000 Sousse",
      taxId: "1234567ABC000",
      phone: "+216 00 000 000",
      email: "achats@example.com",
    },
    orderNumeros: ["260123"],
    lines,
    totals: { totalHt, vatAmount: totalHt * 0.19, totalTtc: totalHt * 1.19 },
  };
})();
