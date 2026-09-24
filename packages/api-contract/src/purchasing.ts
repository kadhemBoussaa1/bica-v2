import { z } from "zod";

/**
 * Input schemas for purchase orders and the goods receipts raised against
 * them. Shared by the API and the forms, so a rule cannot drift between the
 * two — the web forms `safeParse` with these before calling.
 *
 * Two things are deliberately NOT in any input here:
 *
 *   - `numero`. The server owns the numbering rule, continuing the legacy
 *     per-category series (`PurchaseOrderCounter` / `GoodsReceiptCounter`).
 *     A client-supplied number would race the counter and could collide.
 *   - A receipt's `category` and `supplierId`. Both are denormalised from the
 *     order, so taking them from the client would let the copy disagree with
 *     the source. The service reads them from `orderId`.
 *
 * `status` and `receivedQuantity` on a receipt are likewise derived from its
 * lines, not submitted.
 */

/** ISO date, `YYYY-MM-DD`, as the `@db.Date` columns are exchanged. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** A free-text header field: `null` clears, `undefined` leaves alone. */
const clearableText = (max: number) => z.string().trim().max(max).nullable().optional();

/** The nine categories, as `PurchaseCategory` in the schema. */
export const PURCHASE_CATEGORIES = [
  "PAPER",
  "INK",
  "PLATE",
  "GLUE",
  "BOXES",
  "PALLETS",
  "STRETCH_FILM",
  "TRANSPORT",
  "MISC",
] as const;
export type PurchaseCategoryValue = (typeof PURCHASE_CATEGORIES)[number];

/** `StretchFilmType`, on stretch-film lines only. */
export const STRETCH_FILM_TYPES = ["STRETCH_FILM", "THERMO_PVC_STRETCH_FILM"] as const;

/**
 * A quantity or a price. Non-negative and bounded: the largest migrated line
 * quantity is in the tens of thousands, so a million is generous headroom
 * while still catching a mistyped figure.
 */
const figure = z.number().min(0).max(1e9);

/** A per-category dimension: positive, or absent when it does not apply. */
const dimension = z.number().min(0).max(1e6).nullable().optional();

/**
 * One line of a purchase order.
 *
 * `total` is NOT accepted: the server computes it. On plate lines the price
 * is per cm², so the total is `quantity × unitPrice × unitSurface` rather
 * than the usual product — one rule, applied in one place.
 *
 * The dimension columns are per category (paper carries grammage and laize,
 * boxes their three sides, plates a colour count and a unit surface) and the
 * form sends only the ones it showed. None is required: the legacy data has
 * categories that carry none at all.
 */
export const purchaseOrderLineInput = z.object({
  position: z.number().int().min(1).max(200),
  designation: z.string().trim().min(1, "A designation is required").max(500),
  quantity: figure,
  unitPrice: figure,
  grammage: dimension,
  laize: dimension,
  length: dimension,
  width: dimension,
  height: dimension,
  thickness: dimension,
  filmType: z.enum(STRETCH_FILM_TYPES).nullable().optional(),
  colourCount: z.number().int().min(0).max(100).nullable().optional(),
  unitSurface: dimension,
});
export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineInput>;

/**
 * Everything on a purchase order. A full form, so this is
 * create-or-replace: every nullable header field is written from the
 * payload, and `null`/absent both clear it.
 *
 * `totalHt` and `totalQuantity` are absent because the server derives them
 * from the lines. The migrated rows carry copied figures — null on the
 * transport orders that never had them — and deriving keeps a stored total
 * from contradicting the lines beneath it.
 */
export const purchaseOrderInput = z.object({
  category: z.enum(PURCHASE_CATEGORIES),
  supplierId: z.string().min(1, "Choose a supplier"),
  issuedAt: isoDate,
  expectedAt: isoDate.nullable().optional(),
  currency: z.string().trim().min(1, "A currency is required").max(10),
  address: clearableText(500),
  notes: clearableText(1000),
  createdByName: clearableText(200),
  lines: z.array(purchaseOrderLineInput).min(1, "An order needs at least one line").max(200),
});
export type PurchaseOrderInput = z.infer<typeof purchaseOrderInput>;

export const createPurchaseOrderInput = purchaseOrderInput;
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderInput>;

/**
 * An edit. `lines` is optional here, unlike on create, and that is the whole
 * point: once a goods receipt against the order holds something (a quantity,
 * a price or a note on a line, or an invoice) the service refuses a lines
 * array outright, because replacing the lines would SetNull every receipt
 * line pointing at them with no way to re-link. The empty receipt every
 * order is born with does not count; its lines are rebuilt with the order's.
 * Sending no `lines` key edits the header alone, which stays allowed for the
 * life of the order.
 *
 * `category` rides along so the input round-trips, but the service refuses
 * a changed one: it picked the number series. A changed `supplierId` is
 * refused under the same condition as the lines.
 */
export const updatePurchaseOrderInput = purchaseOrderInput
  .extend({ id: z.string().min(1) })
  .partial({ lines: true });
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderInput>;

export const purchaseOrderIdInput = z.object({ id: z.string().min(1) });

/**
 * One line of a goods receipt: what arrived against one line of the order.
 *
 * `orderLineId` is required — a receipt line records a delivery against
 * something ordered, and the service checks the line belongs to the order
 * being received. (The column is nullable in the schema, but only so an
 * order line deleted later cannot take the receipt with it.)
 *
 * `receivedQuantity` is nullable for transport, whose lines carry a price
 * instead of a quantity — a service is not delivered in units. Dimensions
 * are copied from the order line by the service, not sent: they describe
 * what was ordered, and a receipt that disagreed with its order about the
 * grammage of the paper would be recording a different product.
 */
export const goodsReceiptLineInput = z.object({
  position: z.number().int().min(1).max(200),
  orderLineId: z.string().min(1, "Each line must name the order line it received against"),
  receivedQuantity: figure.nullable().optional(),
  unitPrice: figure.nullable().optional(),
  notes: clearableText(1000),
});
export type GoodsReceiptLineInput = z.infer<typeof goodsReceiptLineInput>;

/**
 * Everything on a goods receipt. Create-or-replace like the order above.
 *
 * `orderId` is top level by requirement, not by style: the audit middleware
 * reads a mutation's parent entity from the input's top-level keys only, so
 * nesting it (or naming it `purchaseOrderId`) would leave the order's
 * activity timeline with no record that a delivery against it was recorded.
 * Same reasoning as `countScanInput` in inventory.ts.
 *
 * `validated` is deliberately NOT here: the server derives it from the
 * quantities, so a receipt is validated exactly when every line it touches is
 * fully delivered. Accepting it from the client would let the flag contradict
 * the figures printed beside it.
 */
export const goodsReceiptInput = z.object({
  orderId: z.string().min(1, "Choose the order this delivery is against"),
  issuedAt: isoDate,
  receivedAt: isoDate.nullable().optional(),
  invoiceNumber: clearableText(100),
  invoiceUrl: clearableText(500),
  notes: clearableText(1000),
  updatedByName: clearableText(200),
  lines: z.array(goodsReceiptLineInput).min(1, "A receipt needs at least one line").max(200),
});
export type GoodsReceiptInput = z.infer<typeof goodsReceiptInput>;

export const createGoodsReceiptInput = goodsReceiptInput;
export type CreateGoodsReceiptInput = z.infer<typeof createGoodsReceiptInput>;

/**
 * An edit. `orderId` stays in the payload so the input round-trips, but the
 * service refuses a changed one: moving a receipt to another order would
 * strand the received quantities on the old order's lines, and the category
 * and supplier copied from the original would no longer match.
 */
export const updateGoodsReceiptInput = goodsReceiptInput.extend({
  id: z.string().min(1),
});
export type UpdateGoodsReceiptInput = z.infer<typeof updateGoodsReceiptInput>;

export const goodsReceiptIdInput = z.object({ id: z.string().min(1) });

/**
 * How much a received quantity may exceed what was ordered before the
 * service refuses it.
 *
 * Not zero, because six migrated MISC lines already exceed their order by
 * 0.004–0.005 — Float rounding in the legacy figures (1.955 ordered against
 * 1.960 received), not over-deliveries. An exact comparison would make those
 * six historical receipts un-editable. A hundredth of a unit is far below
 * anything a real over-delivery would be and far above the noise.
 *
 * Exported so the form can warn with the same threshold the server enforces.
 */
export const RECEIPT_TOLERANCE = 0.01;
