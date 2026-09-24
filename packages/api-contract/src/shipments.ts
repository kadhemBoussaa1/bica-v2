import { z } from "zod";

/**
 * Outbound shipments (exports) raised from invoiced orders —
 * docs/export-plan.md.
 *
 * A leaf module like `invoices.ts`: the enums, the parcel arithmetic the
 * server's guards and the web's figures must agree on, and the Zod inputs
 * for the write path. Named `*Shipment*` with an "export"/"draft"
 * qualifier throughout because `stock.ts` already owns the bare
 * `createShipmentInput` family for INBOUND paper shipments, and `index.ts`
 * re-exports both files wholesale.
 */

/** DRAFT until shipped; SHIPPED is final — only the customs fields still change. */
export const SHIPMENT_STATUSES = ["DRAFT", "SHIPPED"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** Whether the truck took the whole un-shipped balance or part of it. */
export const SHIPMENT_KINDS = ["COMPLETE", "PARTIAL"] as const;
export type ShipmentKind = (typeof SHIPMENT_KINDS)[number];

// ---------------------------------------------------------------------------
// Parcel arithmetic
// ---------------------------------------------------------------------------

/**
 * The parcels an order is planned to ship: its exact (possibly fractional)
 * `parcelCount`, rounded up — a part-filled last parcel still goes on the
 * truck. Null when the order is unpriced and has no count at all.
 */
export function plannedParcels(parcelCount: number | null): number | null {
  return parcelCount === null ? null : Math.ceil(parcelCount);
}

/**
 * Parcels still to account for: the plan minus what the given lines already
 * claim, never below zero. The same helper serves both balances —
 * un-invoiced (over ISSUED invoice lines) and un-shipped (over DRAFT and
 * SHIPPED shipment lines); the caller decides which lines to pass.
 */
export function parcelBalance(
  planned: number,
  lines: readonly { quantity: number | null }[],
): number {
  const claimed = lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0);
  return Math.max(0, planned - claimed);
}

/** COMPLETE when this shipment covers everything that was left; else PARTIAL. */
export function deriveShipmentKind(quantity: number, balanceBefore: number): ShipmentKind {
  return quantity >= balanceBefore ? "COMPLETE" : "PARTIAL";
}

/** "EXP" + two-digit year + four-digit sequence: `EXP260001`. */
export function shipmentNumero(year: number, sequence: number): string {
  return `EXP${String(year).padStart(2, "0")}${String(sequence).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const exportShipmentIdInput = z.object({ id: z.string().min(1) });

export const createShipmentFromOrderInput = z.object({
  orderId: z.string().min(1),
});
export type CreateShipmentFromOrderInput = z.infer<typeof createShipmentFromOrderInput>;

/** ISO date, `YYYY-MM-DD`, as the `@db.Date` columns are exchanged. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** A free-text header field: `null` clears, `undefined` leaves alone. */
const clearableText = (max: number) => z.string().trim().max(max).nullable().optional();

/**
 * One line as the draft editor submits it. Parcels are whole, and a line
 * with none is a removed line, so the quantity is an integer of at least 1.
 * `orderId` is accepted only so an edit round-trips the link the server
 * wrote at creation — the service refuses a changed or newly added one, as
 * the invoice does.
 */
export const shipmentLineInput = z.object({
  position: z.number().int().min(1).max(100),
  orderId: z.string().min(1).nullable().optional(),
  description: z.string().trim().max(1000).optional(),
  quantity: z.number().int().min(1).max(1e6),
});
export type ShipmentLineInput = z.infer<typeof shipmentLineInput>;

/**
 * Everything a DRAFT lets you change: the header, and the lines replaced
 * wholesale. The three customs fields are here too, since a draft may as
 * well carry them early; `updateShipmentCustomsInput` is the one edit that
 * survives shipping.
 */
export const updateShipmentDraftInput = z.object({
  id: z.string().min(1),
  exportDate: isoDate.nullable().optional(),
  packingListNumber: clearableText(100),
  packingListDocument: clearableText(500),
  customsDeclarationNumber: clearableText(100),
  customsDeclarationDate: isoDate.nullable().optional(),
  customsDeclarationDocument: clearableText(500),
  note: clearableText(1000),
  lines: z.array(shipmentLineInput).min(1).max(50),
});
export type UpdateShipmentDraftInput = z.infer<typeof updateShipmentDraftInput>;

/** The customs declaration is recorded after the truck has left; allowed on SHIPPED. */
export const updateShipmentCustomsInput = z.object({
  id: z.string().min(1),
  customsDeclarationNumber: clearableText(100),
  customsDeclarationDate: isoDate.nullable().optional(),
  customsDeclarationDocument: clearableText(500),
});
export type UpdateShipmentCustomsInput = z.infer<typeof updateShipmentCustomsInput>;

/**
 * DRAFT -> SHIPPED. `closeOrder` closes the order even though parcels
 * remain (the last truck is short) — ADMIN and above, and the note lands on
 * the order's `COMPLETED` transition, so it is required with it.
 */
export const shipShipmentInput = z
  .object({
    id: z.string().min(1),
    /** Defaults to the draft's export date, else today, on the server. */
    exportDate: isoDate.optional(),
    closeOrder: z.boolean().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((input) => !input.closeOrder || (input.note ?? "").length > 0, {
    message: "Closing the order short requires a note",
    path: ["note"],
  });
export type ShipShipmentInput = z.infer<typeof shipShipmentInput>;

/** The note lands on the order's `READY_FOR_EXPORT -> INVOICED` transition, so it is required. */
export const discardShipmentDraftInput = z.object({
  id: z.string().min(1),
  note: z.string().trim().min(1, "A note is required").max(500),
});
export type DiscardShipmentDraftInput = z.infer<typeof discardShipmentDraftInput>;
