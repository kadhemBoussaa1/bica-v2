import { createHash } from "node:crypto";
import type { ReactElement } from "react";
import { Injectable, Logger } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import { Font, renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import {
  SAMPLE_SALES_INVOICE,
  isRtl,
  pdfTranslator,
  salesInvoiceModelSchema,
  type PdfLocale,
  type SalesInvoiceLayout,
  type SalesInvoiceModel,
  type UpdateSalesInvoiceDraftInput,
} from "@repo/api-contract";
import { PrismaService } from "../prisma.service";
import { ASSETS } from "./pdf.identity";
import { fileName } from "./pdf.format";
import {
  GoodsReceiptDocument,
  PurchaseOrderDocument,
  type DocumentHeader,
  type DocumentLine,
} from "./pdf.document";
import { SalesInvoiceDocument } from "./pdf.blocks.sales-invoice";
import { SALES_INVOICE_PDF_SELECT, toSalesInvoiceModel } from "./sales-invoice.model";
import { salesInvoiceLayoutFor } from "../template/template.defaults";

/**
 * A document ready to serve. `etag` is set only on a stored file — the one
 * kind that never changes, and so the only one worth revalidating.
 */
export interface RenderedPdf {
  body: Buffer;
  fileName: string;
  etag?: string;
}

/**
 * Generates the purchase-order, goods-receipt and sales-invoice PDFs.
 *
 * These are documents bica-v2 mints itself, unlike the scanned supplier
 * invoices the purchasing pages already link to: an order has no paper
 * original, so the only way to hand one to a supplier is to render it. The
 * layout is a rebuild of the legacy Thymeleaf templates — see pdf.document.tsx.
 *
 * `@react-pdf/renderer` is required directly rather than through a cached
 * dynamic `import()` like better-auth: its CommonJS build exposes the render
 * functions on the top-level namespace, so a plain require works. (The
 * *default* export carries only the components, which is easy to trip over.)
 *
 * Fonts are registered once, lazily, on the first render. Registering at
 * module load would make an unrelated API boot fail if an asset were missing,
 * and registering per render leaks font buffers.
 */
@Injectable()
export class PdfService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly logger = new Logger(PdfService.name);

  private fontsReady = false;

  /**
   * Two families, each with a regular and a bold face.
   *
   * Arabic needs its own family: react-pdf shapes and reorders the run, but
   * only with a face that actually has the glyphs, and Noto Sans has no
   * Arabic coverage. Verified by rendering `طلب شراء` and reading the glyphs
   * back — joined and right-to-left, with Latin digits still left-to-right
   * inside the run, and shaping intact with the bold face registered too.
   *
   * The paths are relative to the API's working directory (`apps/api`), which
   * is where `node dist/main.js` runs from. `tsc` copies no assets into
   * `dist/`, so a `__dirname`-relative path would break in the built app.
   */
  private registerFonts() {
    if (this.fontsReady) return;
    Font.register({
      family: "NotoSans",
      fonts: [
        { src: ASSETS.latinRegular },
        { src: ASSETS.latinBold, fontWeight: 700 },
      ],
    });
    Font.register({
      family: "NotoArabic",
      fonts: [
        { src: ASSETS.arabicRegular },
        { src: ASSETS.arabicBold, fontWeight: 700 },
      ],
    });
    this.fontsReady = true;
  }

  /**
   * What a rendered document carries back to the route that serves it.
   *
   * The element is typed as the renderer's own `DocumentProps` element rather
   * than a bare `ReactElement`: `renderToBuffer` only accepts a `<Document>`
   * at the root, and taking the looser type here would move that mistake to
   * runtime.
   */
  private async render(
    element: ReactElement<DocumentProps>,
    prefix: string,
    numero: string,
  ): Promise<{ body: Buffer; fileName: string }> {
    this.registerFonts();
    const body = await renderToBuffer(element);
    return { body, fileName: fileName(prefix, numero) };
  }

  /**
   * A purchase order as a PDF.
   *
   * The figures are read fresh rather than taken from the caller: this is the
   * document a supplier acts on, so it must say what the order says now.
   */
  async purchaseOrder(id: string, locale: PdfLocale) {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      select: {
        numero: true,
        category: true,
        currency: true,
        issuedAt: true,
        totalHt: true,
        notes: true,
        supplier: {
          select: { name: true, address: true, phone: true, email: true },
        },
        lines: {
          select: {
            designation: true,
            quantity: true,
            unitPrice: true,
            total: true,
            grammage: true,
            laize: true,
            length: true,
            width: true,
            height: true,
            thickness: true,
          },
          orderBy: { position: "asc" },
        },
      },
    });
    if (!order) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order not found" });
    }

    const header: DocumentHeader = {
      numero: order.numero,
      category: order.category,
      currency: order.currency,
      date: order.issuedAt,
      supplier: {
        name: order.supplier.name,
        address: order.supplier.address,
        phone: order.supplier.phone,
        email: order.supplier.email,
      },
      notes: order.notes,
    };
    const lines: DocumentLine[] = order.lines.map((line) => ({ ...line }));

    return this.render(
      PurchaseOrderDocument({
        header,
        lines,
        totalHt: order.totalHt,
        fontFamily: isRtl(locale) ? "NotoArabic" : "NotoSans",
        rtl: isRtl(locale),
        t: pdfTranslator(locale),
      }),
      "bon_de_commande",
      order.numero,
    );
  }

  /**
   * A goods receipt as a PDF, with what was ordered beside what arrived.
   *
   * The ordered and remaining figures come from the order line each receipt
   * line points at. A line whose order line has since been detached
   * (`SetNull`) shows an absent ordered figure rather than a guess, exactly as
   * the detail page does. Remaining is `max(0, ordered − received)`, clamped
   * as the legacy service clamped it.
   */
  async goodsReceipt(id: string, locale: PdfLocale) {
    const receipt = await this.prisma.goodsReceipt.findUnique({
      where: { id },
      select: {
        numero: true,
        category: true,
        receivedAt: true,
        issuedAt: true,
        receivedQuantity: true,
        notes: true,
        order: { select: { numero: true, currency: true, totalQuantity: true } },
        supplier: {
          select: { name: true, address: true, phone: true, email: true },
        },
        lines: {
          select: {
            designation: true,
            receivedQuantity: true,
            unitPrice: true,
            notes: true,
            grammage: true,
            laize: true,
            length: true,
            width: true,
            height: true,
            thickness: true,
            orderLine: { select: { quantity: true } },
          },
          orderBy: { position: "asc" },
        },
      },
    });
    if (!receipt) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Goods receipt not found" });
    }

    const header: DocumentHeader = {
      numero: receipt.numero,
      category: receipt.category,
      currency: receipt.order.currency,
      // The reception date is the one the note is about; it falls back to the
      // day the note was raised, which is all a pending receipt has.
      date: receipt.receivedAt ?? receipt.issuedAt,
      supplier: {
        name: receipt.supplier.name,
        address: receipt.supplier.address,
        phone: receipt.supplier.phone,
        email: receipt.supplier.email,
      },
      notes: receipt.notes,
    };

    const lines: DocumentLine[] = receipt.lines.map((line) => {
      const ordered = line.orderLine?.quantity ?? null;
      const received = line.receivedQuantity;
      return {
        designation: line.designation,
        grammage: line.grammage,
        laize: line.laize,
        length: line.length,
        width: line.width,
        height: line.height,
        thickness: line.thickness,
        unitPrice: line.unitPrice,
        notes: line.notes,
        ordered,
        received,
        remaining:
          ordered === null ? null : Math.max(0, ordered - (received ?? 0)),
      };
    });

    // Null, not zero, when no line has an ordered figure to sum: the totals
    // block prints an absent marker rather than claiming nothing was ordered.
    // `ordered` is optional on `DocumentLine`, so normalise before adding.
    const orderedTotal = lines.reduce<number | null>((sum, line) => {
      const ordered = line.ordered ?? null;
      return ordered === null ? sum : (sum ?? 0) + ordered;
    }, null);

    return this.render(
      GoodsReceiptDocument({
        header,
        orderNumero: receipt.order.numero,
        lines,
        totals: {
          ordered: orderedTotal,
          received: receipt.receivedQuantity,
          remaining:
            orderedTotal === null
              ? null
              : Math.max(0, orderedTotal - (receipt.receivedQuantity ?? 0)),
        },
        fontFamily: isRtl(locale) ? "NotoArabic" : "NotoSans",
        rtl: isRtl(locale),
        t: pdfTranslator(locale),
      }),
      "bon_de_reception",
      receipt.numero,
    );
  }

  /**
   * A sales invoice as a PDF. Three cases, by what the row is:
   *
   * - **DRAFT** — rendered from the row as it is now, on the current default
   *   layout, and never stored: a draft is still being typed.
   * - **ISSUED with a snapshot** — the stored file for this language, minted
   *   on the first request from the snapshot and the pinned layout, never
   *   from live tables. `issue()` renders nothing, so this one path is both
   *   "the first render" and "the recovery when a file is lost". Two racing
   *   first requests both render; `skipDuplicates` lets one row win and both
   *   serve it, so everyone is handed identical bytes.
   * - **ISSUED without one** — the 47 migrated invoices. Their scan is the
   *   original; this is a convenience render from live data, never stored.
   */
  async salesInvoice(id: string, locale: PdfLocale): Promise<RenderedPdf> {
    const invoice = await this.prisma.salesInvoice.findUnique({
      where: { id },
      select: SALES_INVOICE_PDF_SELECT,
    });
    if (!invoice) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
    }

    if (invoice.status === "DRAFT" || invoice.issuedSnapshot === null) {
      const layout = await salesInvoiceLayoutFor(this.prisma, invoice.templateVersionId);
      return this.renderSalesInvoice(toSalesInvoiceModel(invoice), layout, locale);
    }

    const stored = await this.storedSalesInvoicePdf(id, locale);
    if (stored) return stored;

    const snapshot = salesInvoiceModelSchema.safeParse(invoice.issuedSnapshot);
    if (!snapshot.success) {
      // Loud, not a silent fall back to live data: printing today's client
      // details on an issued invoice is what the snapshot exists to prevent.
      this.logger.error(`Invoice ${id} holds an unreadable snapshot: ${snapshot.error.message}`);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "The invoice's issued snapshot cannot be read",
      });
    }
    const layout = await salesInvoiceLayoutFor(this.prisma, invoice.templateVersionId);
    const rendered = await this.renderSalesInvoice(snapshot.data, layout, locale);

    await this.prisma.salesInvoicePdf.createMany({
      data: [
        {
          invoiceId: id,
          locale,
          // A fresh view: Prisma wants a `Uint8Array` over its own buffer,
          // and a pooled Node `Buffer` shares one with its neighbours.
          bytes: new Uint8Array(rendered.body),
          byteLength: rendered.body.length,
          sha256: createHash("sha256").update(rendered.body).digest("hex"),
        },
      ],
      skipDuplicates: true,
    });
    return (await this.storedSalesInvoicePdf(id, locale)) ?? rendered;
  }

  /**
   * The draft as it would print if the unsaved `draft` payload were saved.
   * Nothing is written. Refused on an issued invoice: that one has a file.
   */
  async salesInvoicePreview(
    draft: UpdateSalesInvoiceDraftInput,
    locale: PdfLocale,
  ): Promise<RenderedPdf> {
    const invoice = await this.prisma.salesInvoice.findUnique({
      where: { id: draft.id },
      select: SALES_INVOICE_PDF_SELECT,
    });
    if (!invoice) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
    }
    if (invoice.status !== "DRAFT") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "An issued invoice has no preview — open its PDF instead",
      });
    }
    const layout = await salesInvoiceLayoutFor(this.prisma, null);
    return this.renderSalesInvoice(toSalesInvoiceModel(invoice, draft), layout, locale);
  }

  /**
   * An unsaved layout printed with the sample invoice — the template
   * settings' preview. No record is read and nothing is written.
   */
  salesInvoiceSample(
    layout: SalesInvoiceLayout,
    status: SalesInvoiceModel["status"],
    locale: PdfLocale,
  ): Promise<RenderedPdf> {
    const model: SalesInvoiceModel =
      status === "DRAFT"
        ? { ...SAMPLE_SALES_INVOICE, status, numero: null, issuedAt: null }
        : SAMPLE_SALES_INVOICE;
    return this.renderSalesInvoice(model, layout, locale);
  }

  /** The one place `bytes` is selected. */
  private async storedSalesInvoicePdf(
    invoiceId: string,
    locale: PdfLocale,
  ): Promise<RenderedPdf | null> {
    const stored = await this.prisma.salesInvoicePdf.findUnique({
      where: { invoiceId_locale: { invoiceId, locale } },
      select: { bytes: true, sha256: true, invoice: { select: { numero: true } } },
    });
    if (!stored) return null;
    return {
      body: Buffer.from(stored.bytes),
      fileName: fileName("facture", stored.invoice.numero ?? "brouillon"),
      etag: `"${stored.sha256}"`,
    };
  }

  private renderSalesInvoice(
    model: SalesInvoiceModel,
    layout: SalesInvoiceLayout,
    locale: PdfLocale,
  ): Promise<RenderedPdf> {
    return this.render(
      SalesInvoiceDocument({
        model,
        layout,
        fontFamily: isRtl(locale) ? "NotoArabic" : "NotoSans",
        rtl: isRtl(locale),
        t: pdfTranslator(locale),
      }),
      "facture",
      model.numero ?? "brouillon",
    );
  }
}
