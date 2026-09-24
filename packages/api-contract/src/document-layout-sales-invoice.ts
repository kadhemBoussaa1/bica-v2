import { z } from "zod";
import {
  LAYOUT_ALIGNS,
  LAYOUT_SCHEMA_VERSION,
  fixedPlacement,
  flowPlacement,
  pageSchema,
  placementIssues,
} from "./document-layout.js";

/**
 * The sales invoice template: which blocks exist, what each one binds to and
 * where it may sit. The generic half — page, placements, mirroring — is
 * `document-layout.ts`.
 *
 * The block `type` is a **closed** union and the type alone decides the data
 * binding: a `totals` block prints the invoice's totals, a `parties` block the
 * client. There are no binding expressions, no field paths and no URLs — a
 * logo names one of two bundled assets. A layout is client-supplied data that
 * the server renders, so it must not be able to reach anything the type did
 * not already mean.
 *
 * Adding a block type is backwards compatible (old layouts simply lack it).
 * Renaming a prop is not: bump `LAYOUT_SCHEMA_VERSION` and add an upgrade.
 */

const either = z.discriminatedUnion("mode", [fixedPlacement, flowPlacement]);
const id = z.string().min(1).max(40);

/** The columns the lines table can show. `designation` always goes through `withMention`. */
export const SALES_INVOICE_COLUMN_KEYS = [
  "position",
  "product",
  "designation",
  "quantity",
  "unitPrice",
  "discountPct",
  "taxPct",
  "net",
  "total",
] as const;
export type SalesInvoiceColumnKey = (typeof SALES_INVOICE_COLUMN_KEYS)[number];

export const salesInvoiceColumn = z.object({
  key: z.enum(SALES_INVOICE_COLUMN_KEYS),
  /**
   * Width in mm. When a `hideWhenEmpty` column drops out, the rest scale up
   * to fill the block, so these are exact only with every column showing.
   */
  w: z.number().min(4).max(210),
  align: z.enum(LAYOUT_ALIGNS),
  /** Drop the column when no line has a non-zero value in it (discount, VAT). */
  hideWhenEmpty: z.boolean().optional(),
});
export type SalesInvoiceColumn = z.infer<typeof salesInvoiceColumn>;

/** The rows the meta box can list under the title, in the order given. */
export const SALES_INVOICE_META_ROWS = [
  "number",
  "issuedAt",
  "dueAt",
  "paymentMethod",
  "orders",
] as const;
export type SalesInvoiceMetaRow = (typeof SALES_INVOICE_META_ROWS)[number];

export const SALES_INVOICE_PARTY_BOXES = ["issuer", "client"] as const;
export type SalesInvoicePartyBox = (typeof SALES_INVOICE_PARTY_BOXES)[number];

export const salesInvoiceBlock = z.discriminatedUnion("type", [
  z.object({
    id,
    type: z.literal("letterhead"),
    placement: fixedPlacement,
    /** `full`: logo, name, address, contacts. `compact`: one line, for following pages. */
    props: z.object({ variant: z.enum(["full", "compact"]) }),
  }),
  z.object({
    id,
    type: z.literal("logo"),
    placement: fixedPlacement,
    props: z.object({ asset: z.enum(["company", "fsc"]) }),
  }),
  z.object({
    id,
    type: z.literal("meta"),
    placement: either,
    props: z.object({
      showTitle: z.boolean(),
      rows: z.array(z.enum(SALES_INVOICE_META_ROWS)).max(SALES_INVOICE_META_ROWS.length),
    }),
  }),
  z.object({
    id,
    type: z.literal("parties"),
    placement: flowPlacement,
    props: z.object({
      boxes: z.array(z.enum(SALES_INVOICE_PARTY_BOXES)).min(1).max(2),
    }),
  }),
  z.object({
    id,
    type: z.literal("lines"),
    placement: flowPlacement,
    props: z.object({
      columns: z.array(salesInvoiceColumn).min(1).max(SALES_INVOICE_COLUMN_KEYS.length),
      zebra: z.boolean(),
    }),
  }),
  z.object({
    id,
    type: z.literal("totals"),
    placement: flowPlacement,
    /** `auto` hides the VAT row (and the ex-VAT total with it) when VAT is zero. */
    props: z.object({ vat: z.enum(["auto", "always"]) }),
  }),
  z.object({
    id,
    type: z.literal("notes"),
    placement: either,
    /** Printed as typed, in every language: payment terms, bank details. */
    props: z.object({ title: z.string().trim().max(120), text: z.string().trim().max(1500) }),
  }),
  z.object({
    id,
    type: z.literal("footer"),
    placement: fixedPlacement,
    /** Empty prints the translated contact line with the tax ID. */
    props: z.object({ text: z.string().trim().max(500) }),
  }),
  z.object({
    id,
    type: z.literal("pageNumber"),
    placement: fixedPlacement,
    props: z.object({}),
  }),
  z.object({
    id,
    type: z.literal("watermark"),
    placement: fixedPlacement,
    /** `draft`: only while the invoice is a draft. The word itself is translated. */
    props: z.object({ when: z.enum(["draft", "always"]) }),
  }),
]);
export type SalesInvoiceBlock = z.infer<typeof salesInvoiceBlock>;
export type SalesInvoiceBlockType = SalesInvoiceBlock["type"];

export const salesInvoiceLayoutSchema = z
  .object({
    schemaVersion: z.literal(LAYOUT_SCHEMA_VERSION),
    kind: z.literal("SALES_INVOICE"),
    page: pageSchema,
    blocks: z.array(salesInvoiceBlock).min(1).max(24),
  })
  .superRefine((layout, ctx) => {
    const seen = new Set<string>();
    layout.blocks.forEach((block, index) => {
      if (seen.has(block.id)) {
        ctx.addIssue({ code: "custom", path: ["blocks", index, "id"], message: "Block ids must be unique" });
      }
      seen.add(block.id);

      for (const message of placementIssues(layout.page, block.placement, block.type === "watermark")) {
        ctx.addIssue({ code: "custom", path: ["blocks", index, "placement"], message });
      }

      if (block.type === "lines") {
        const keys = block.props.columns.map((column) => column.key);
        if (new Set(keys).size !== keys.length) {
          ctx.addIssue({
            code: "custom",
            path: ["blocks", index, "props", "columns"],
            message: "A column can appear once",
          });
        }
        if (block.placement.keepTogether) {
          ctx.addIssue({
            code: "custom",
            path: ["blocks", index, "placement", "keepTogether"],
            message: "The lines table must be allowed to run onto the next page",
          });
        }
      }
    });

    const count = (type: SalesInvoiceBlockType) =>
      layout.blocks.filter((block) => block.type === type).length;
    if (count("lines") !== 1) {
      ctx.addIssue({ code: "custom", path: ["blocks"], message: "A sales invoice has exactly one lines table" });
    }
    if (count("totals") > 1) {
      ctx.addIssue({ code: "custom", path: ["blocks"], message: "A sales invoice has at most one totals block" });
    }

    const { margins, firstPageTop } = layout.page;
    if (Math.max(margins.top, firstPageTop ?? 0) + margins.bottom > 297 - 60) {
      ctx.addIssue({ code: "custom", path: ["page"], message: "The margins leave too little room for content" });
    }
    if (margins.start + margins.end > 210 - 60) {
      ctx.addIssue({ code: "custom", path: ["page"], message: "The side margins leave too little room for content" });
    }
  });
export type SalesInvoiceLayout = z.infer<typeof salesInvoiceLayoutSchema>;

/**
 * The built-in layout, and the seed of template version 1: the purchasing
 * documents' look (navy letterhead left, title and info box right) carried
 * over to the invoice, with the client on the reader's end side as a French
 * invoice has it.
 *
 * The bottom 24 mm is furniture on every page — FSC mark, contact line, page
 * number — and the first page starts its content at 68 mm to clear the full
 * letterhead; following pages carry the one-line compact one.
 */
export const DEFAULT_SALES_INVOICE_LAYOUT: SalesInvoiceLayout = {
  schemaVersion: LAYOUT_SCHEMA_VERSION,
  kind: "SALES_INVOICE",
  page: {
    size: "A4",
    margins: { top: 26, bottom: 24, start: 10, end: 10 },
    firstPageTop: 68,
  },
  blocks: [
    {
      id: "letterhead",
      type: "letterhead",
      placement: { mode: "fixed", x: 10, y: 10, w: 100, minH: 52, align: "start", repeat: "first" },
      props: { variant: "full" },
    },
    {
      id: "meta",
      type: "meta",
      placement: { mode: "fixed", x: 120, y: 10, w: 80, minH: 40, align: "end", repeat: "first" },
      props: { showTitle: true, rows: ["number", "issuedAt", "dueAt", "paymentMethod", "orders"] },
    },
    {
      id: "letterhead-compact",
      type: "letterhead",
      placement: { mode: "fixed", x: 10, y: 10, w: 190, minH: 10, align: "start", repeat: "notFirst" },
      props: { variant: "compact" },
    },
    {
      id: "parties",
      type: "parties",
      placement: { mode: "flow", x: 110, w: 90, align: "start", spaceBefore: 0, keepTogether: true },
      props: { boxes: ["client"] },
    },
    {
      id: "lines",
      type: "lines",
      placement: { mode: "flow", x: 10, w: 190, align: "start", spaceBefore: 5, keepTogether: false },
      props: {
        zebra: true,
        columns: [
          { key: "position", w: 10, align: "center" },
          { key: "designation", w: 78, align: "start" },
          { key: "quantity", w: 22, align: "end" },
          { key: "unitPrice", w: 26, align: "end" },
          { key: "discountPct", w: 14, align: "end", hideWhenEmpty: true },
          { key: "taxPct", w: 12, align: "end", hideWhenEmpty: true },
          { key: "total", w: 28, align: "end" },
        ],
      },
    },
    {
      id: "totals",
      type: "totals",
      placement: { mode: "flow", x: 115, w: 85, align: "end", spaceBefore: 4, keepTogether: true },
      props: { vat: "auto" },
    },
    {
      id: "fsc",
      type: "logo",
      placement: { mode: "fixed", x: 10, y: 275, w: 13, minH: 16, align: "start", repeat: "all" },
      props: { asset: "fsc" },
    },
    {
      id: "footer",
      type: "footer",
      placement: { mode: "fixed", x: 30, y: 283, w: 150, minH: 6, align: "center", repeat: "all" },
      props: { text: "" },
    },
    {
      id: "page-number",
      type: "pageNumber",
      placement: { mode: "fixed", x: 170, y: 276, w: 30, minH: 5, align: "end", repeat: "all" },
      props: {},
    },
    {
      id: "watermark",
      type: "watermark",
      placement: { mode: "fixed", x: 25, y: 110, w: 160, minH: 60, align: "center", repeat: "all" },
      props: { when: "draft" },
    },
  ],
};
