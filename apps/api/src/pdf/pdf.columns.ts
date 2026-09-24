import type { PurchaseCategory } from "../generated/prisma/enums.js";

/**
 * Which columns a purchase order's and a goods receipt's lines table shows,
 * per category.
 *
 * Transcribed from the legacy Thymeleaf templates — there were nine of each
 * (`bonDeCommandeInk.html`, `bonDeReceptionBoxes.html`, …) and they genuinely
 * differ, so this is a table of what each one printed rather than a guess:
 *
 *   PO       PAPER        désignation, grammage, laize, qté, PU, total
 *            INK / GLUE   désignation, qté (Kg), PU, total HT
 *            PLATE        désignation, hauteur, largeur, qté, PU, total
 *            BOXES        désignation, longueur, largeur, hauteur, qté, PU, total
 *            PALLETS      désignation, longueur, largeur, qté, PU, total
 *            STRETCH_FILM désignation, épaisseur, longueur, largeur, qté, PU, total
 *            MISC         désignation, qté, PU, total HT
 *            TRANSPORT    destinataire, désignation, colis, poids, incoterm, PU
 *
 *   GR       as above, but the quantity columns become
 *            "qté commandée / qté reçue / qté restante" (paper, ink, glue,
 *            plate) or "qté commandée / qté reçue / observation" (boxes,
 *            pallets, film, misc), and transport keeps its own shape.
 *
 * A `unit` is appended to the figure exactly where the legacy template did:
 * ` mm` on dimensions, ` g` on grammage, ` kg` on a transport weight. The
 * currency suffix is per-document, so it is not here.
 */

/** One column of a lines table. */
export interface LineColumn {
  /** Key into the `pdf` message namespace, e.g. `columns.designation`. */
  key: string;
  /** Which value the row supplies. */
  field:
    | "designation"
    | "grammage"
    | "laize"
    | "length"
    | "width"
    | "height"
    | "thickness"
    | "quantity"
    | "unitPrice"
    | "total"
    | "ordered"
    | "received"
    | "remaining"
    | "notes";
  /** Appended to a non-empty figure, as the legacy templates did. */
  unit?: string;
  /** Money is formatted with the document's currency and aligned right. */
  money?: boolean;
  align: "left" | "center" | "right";
  /** Relative width; the renderer normalises these to the table width. */
  flex: number;
}

const designation: LineColumn = {
  key: "columns.designation",
  field: "designation",
  align: "left",
  flex: 3,
};

const qty = (key: string, field: LineColumn["field"]): LineColumn => ({
  key,
  field,
  align: "right",
  flex: 1.4,
});

const mm = (key: string, field: LineColumn["field"]): LineColumn => ({
  key,
  field,
  unit: " mm",
  align: "center",
  flex: 1.2,
});

const money = (key: string, field: LineColumn["field"]): LineColumn => ({
  key,
  field,
  money: true,
  align: "right",
  flex: 1.6,
});

/** Purchase order columns, per category. */
export const ORDER_COLUMNS = {
  PAPER: [
    designation,
    { key: "columns.grammage", field: "grammage", unit: " g", align: "center", flex: 1.2 },
    mm("columns.laize", "laize"),
    qty("columns.quantity", "quantity"),
    money("columns.unitPrice", "unitPrice"),
    money("columns.total", "total"),
  ],
  INK: [
    designation,
    qty("columns.quantityKg", "quantity"),
    money("columns.unitPrice", "unitPrice"),
    money("columns.totalHt", "total"),
  ],
  GLUE: [
    designation,
    qty("columns.quantityKg", "quantity"),
    money("columns.unitPrice", "unitPrice"),
    money("columns.totalHt", "total"),
  ],
  PLATE: [
    designation,
    mm("columns.height", "height"),
    mm("columns.width", "width"),
    qty("columns.quantity", "quantity"),
    money("columns.unitPrice", "unitPrice"),
    money("columns.total", "total"),
  ],
  BOXES: [
    designation,
    mm("columns.length", "length"),
    mm("columns.width", "width"),
    mm("columns.height", "height"),
    qty("columns.quantity", "quantity"),
    money("columns.unitPrice", "unitPrice"),
    money("columns.total", "total"),
  ],
  PALLETS: [
    designation,
    mm("columns.length", "length"),
    mm("columns.width", "width"),
    qty("columns.quantity", "quantity"),
    money("columns.unitPrice", "unitPrice"),
    money("columns.total", "total"),
  ],
  STRETCH_FILM: [
    designation,
    mm("columns.thickness", "thickness"),
    mm("columns.length", "length"),
    mm("columns.width", "width"),
    qty("columns.quantity", "quantity"),
    money("columns.unitPrice", "unitPrice"),
    money("columns.totalHt", "total"),
  ],
  MISC: [
    designation,
    qty("columns.quantity", "quantity"),
    money("columns.unitPrice", "unitPrice"),
    money("columns.totalHt", "total"),
  ],
  // Transport prices a service, so it shows no quantity and no total — which
  // is why 35 of the 48 migrated transport orders carry a null `totalHt`.
  TRANSPORT: [
    designation,
    qty("columns.quantity", "quantity"),
    money("columns.unitPrice", "unitPrice"),
  ],
} as const satisfies Record<PurchaseCategory, readonly LineColumn[]>;

/**
 * Goods receipt columns, per category. Paper, ink, glue and plate print a
 * remaining figure; the others print an observation column instead, as the
 * legacy templates did.
 */
export const RECEIPT_COLUMNS = {
  PAPER: [
    designation,
    { key: "columns.grammage", field: "grammage", unit: " g", align: "center", flex: 1.2 },
    mm("columns.laize", "laize"),
    qty("columns.ordered", "ordered"),
    qty("columns.received", "received"),
    qty("columns.remaining", "remaining"),
  ],
  INK: [
    designation,
    qty("columns.orderedKg", "ordered"),
    qty("columns.receivedKg", "received"),
    qty("columns.remainingKg", "remaining"),
  ],
  GLUE: [
    designation,
    qty("columns.orderedKg", "ordered"),
    qty("columns.receivedKg", "received"),
    qty("columns.remainingKg", "remaining"),
  ],
  PLATE: [
    designation,
    qty("columns.ordered", "ordered"),
    qty("columns.received", "received"),
    qty("columns.remaining", "remaining"),
  ],
  BOXES: [
    designation,
    mm("columns.length", "length"),
    mm("columns.width", "width"),
    mm("columns.height", "height"),
    qty("columns.ordered", "ordered"),
    qty("columns.received", "received"),
    { key: "columns.observation", field: "notes", align: "left", flex: 1.6 },
  ],
  PALLETS: [
    designation,
    mm("columns.length", "length"),
    mm("columns.width", "width"),
    qty("columns.ordered", "ordered"),
    qty("columns.received", "received"),
    { key: "columns.observation", field: "notes", align: "left", flex: 1.6 },
  ],
  STRETCH_FILM: [
    designation,
    mm("columns.thickness", "thickness"),
    mm("columns.length", "length"),
    mm("columns.width", "width"),
    qty("columns.ordered", "ordered"),
    qty("columns.received", "received"),
    { key: "columns.observation", field: "notes", align: "left", flex: 1.6 },
  ],
  MISC: [
    designation,
    qty("columns.ordered", "ordered"),
    qty("columns.received", "received"),
    { key: "columns.observation", field: "notes", align: "left", flex: 1.6 },
  ],
  TRANSPORT: [
    designation,
    qty("columns.ordered", "ordered"),
    qty("columns.received", "received"),
    money("columns.unitPrice", "unitPrice"),
  ],
} as const satisfies Record<PurchaseCategory, readonly LineColumn[]>;

/**
 * Whether a category's goods receipt prints the three quantity totals under
 * the table. Transport has no totals block in the legacy template at all.
 */
export function receiptShowsTotals(category: PurchaseCategory): boolean {
  return category !== "TRANSPORT";
}

/** Same question for a purchase order's TOTAL HT box. */
export function orderShowsTotal(category: PurchaseCategory): boolean {
  return category !== "TRANSPORT";
}
