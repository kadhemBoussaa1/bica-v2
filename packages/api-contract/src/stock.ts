import { z } from "zod";
import { PAPER_TYPES } from "./orders.js";

/**
 * Input schemas for paper shipments (inbound deliveries of reels).
 *
 * Shared by the API and the form, so a rule cannot drift between them. Every
 * optional text field normalises "" -> undefined, matching the convention in
 * `partners.ts`: the form binds controlled inputs whose empty state is "",
 * and the legacy import established that a blank field means absent.
 *
 * Reels are editable too, but their WEIGHTS are only editable while nothing
 * depends on them — see `createRollInput` and the service's `assertRollEditable`.
 */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    });

/** A non-negative money or measurement value; blank is "not set". */
const amount = z.number().min(0, "Cannot be negative").max(1e9).optional();

/**
 * The delivery's own reference, e.g. "SA 658114", "02-2026" or "BICA 2026" —
 * the legacy data uses all three shapes, so this is free text rather than a
 * pattern. Unique across shipments, checked by the service.
 */
const numeroImport = z
  .string()
  .trim()
  .min(1, "Shipment number is required")
  .max(60);

/**
 * A calendar day, sent by the form as "YYYY-MM-DD" and stored in a
 * `@db.Date` column. Kept as a string end-to-end rather than a `Date`: a
 * `new Date("2026-07-14")` on a machine east of UTC serialises to the
 * previous day, which is exactly the bug `legacyDate` had to fix across all
 * three importers. The service pins it to midnight UTC.
 */
const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-07-14")
  .optional();

export const createShipmentInput = z.object({
  numeroImport,
  dateImport: dateOnly,

  /**
   * A `Supplier` row id. **Required**: a delivery always came from someone,
   * and the free-text `supplierName` it used to fall back on was dropped on
   * 2026-09-03 — it had recorded the same company as both `PEREVALLS` and
   * `PERE VALLS`, so reporting by supplier missed a third of the deliveries.
   * Validated against the table by the service: an unknown or archived id is
   * a BAD_REQUEST. If the supplier does not exist yet, create it first.
   */
  supplierId: z.string().min(1, "Choose a supplier"),

  productName: optionalText(200),

  totalMetrage: amount,
  /** Reels declared on the packing list, which need not match how many exist. */
  totalRolls: z.number().int().min(0).max(100000).optional(),
  price: amount,
  priceTotal: amount,

  /**
   * Every migrated row is EUR, but the column exists, so a second currency
   * must not silently become euros. Uppercased so "eur" and "EUR" are one.
   */
  currency: z
    .string()
    .trim()
    .max(8)
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed.toUpperCase() : undefined;
    }),

  transportIncluded: z.boolean().optional(),
  transportPrice: amount,

  hasCertificate: z.boolean().optional(),
  /** URLs into someone else's bucket, like order artwork — not managed assets. */
  certificate: optionalText(1000),
  packingList: optionalText(1000),
  importFile: optionalText(1000),

  observations: optionalText(2000),
});

export const updateShipmentInput = createShipmentInput.extend({
  id: z.string().min(1),
});

export const shipmentIdInput = z.object({ id: z.string().min(1) });

export const setShipmentActiveInput = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});

/**
 * Attaches or detaches reels. Separate from `update` because it changes which
 * reels claim this delivery as their provenance, which is a different action
 * from correcting the delivery's own details — and it is the only writable
 * thing about a reel in this module.
 */
export const setShipmentRollsInput = z.object({
  id: z.string().min(1),
  /** The complete set of reel ids for this shipment; omitted ones are detached. */
  rollIds: z.array(z.string().min(1)).max(500),
});

export type CreateShipmentInput = z.infer<typeof createShipmentInput>;
export type UpdateShipmentInput = z.infer<typeof updateShipmentInput>;
export type SetShipmentRollsInput = z.infer<typeof setShipmentRollsInput>;

// ---------------------------------------------------------------------------
// Reels
// ---------------------------------------------------------------------------

/** Paper grade, e.g. "KRS-80" or "KRP-120". A label, shared by many reels. */
const paperGrade = optionalText(60);

/**
 * A reel arriving on a delivery.
 *
 * The weight fields are the load-bearing ones. `poids` is what arrived;
 * `poidsRestant` is what is left and is NOT accepted here — the service sets
 * it from `poids` on create, because a reel that has just arrived is by
 * definition untouched, and letting the two be set independently is how stock
 * starts lying. After creation they can only be changed while nothing depends
 * on the reel (no allocations, no splits, not consumed).
 */
export const createRollInput = z.object({
  /**
   * The shipment this reel arrived on. Required: every reel comes from a
   * delivery, which is the whole point of creating it here.
   */
  importShipmentId: z.string().min(1, "Choose a shipment"),

  /**
   * The reel's own label. NOT unique and not a key — 17 migrated reels are
   * literally numbered "0". Identity is the row id; see the `PaperRoll` model
   * comment.
   */
  numero: optionalText(60),
  numeroSource: optionalText(60),
  paperGrade,
  description: optionalText(300),

  /** Kilograms that arrived. The reel's defining quantity. */
  poids: z.number().min(0, "Cannot be negative").max(1e7).optional(),
  /** Metres that arrived. */
  metrage: z.number().min(0, "Cannot be negative").max(1e7).optional(),

  /** Reel width in mm. */
  laize: z.number().min(0).max(100000).optional(),
  /** g/m². An integer in the legacy data. */
  grammage: z.number().int().min(0).max(2000).optional(),
  paperType: z.enum(PAPER_TYPES).optional(),

  price: amount,
  priceWithTransport: amount,

  qrCodeUrl: optionalText(1000),
});

/**
 * `poidsRestant` and `metrageRestant` ARE accepted on update, unlike create —
 * correcting a mis-keyed remaining weight is exactly what this is for. The
 * service refuses them once the reel has allocations, split children or is
 * consumed, so a correction cannot contradict a record that already exists.
 */
export const updateRollInput = createRollInput.extend({
  id: z.string().min(1),
  poidsRestant: z.number().min(0).max(1e7).optional(),
  metrageRestant: z.number().min(0).max(1e7).optional(),
});

export const rollIdInput = z.object({ id: z.string().min(1) });

export const setRollArchivedInput = z.object({
  id: z.string().min(1),
  archived: z.boolean(),
});

/**
 * Receiving: a reel is pending until a warehouse user scans its label on the
 * floor — see docs/receiving-plan.md.
 *
 * `shipmentId` is the shipment open on the scan screen, NOT the reel's own: the
 * service compares the two and refuses a reel from a different delivery rather
 * than re-parenting it. It must also stay a top-level field, because the audit
 * heuristic reads the related-entity id from the input's top level only — fold
 * it into `code` and the audit row loses its shipment link.
 *
 * `code` is the raw scanner output, parsed by `parseRollScan` server-side. The
 * bound is generous because a mis-set scanner suffix can append junk; anything
 * that is not one of our labels is rejected after parsing, not by length.
 */
export const receiveRollInput = z.object({
  shipmentId: z.string().min(1),
  code: z.string().trim().min(1, "Scan a label").max(500),
});

/** Legacy `/scan/rouleau/<legacyId>` labels resolve to a reel id to redirect to. */
export const resolveScanInput = z.object({
  code: z.string().trim().min(1).max(500),
});

/**
 * Labels to print: a whole shipment, or a hand-picked set of reels. Exactly
 * one, because "both" and "neither" have no sensible sheet to produce. The cap
 * matches the service's `take` — a print run past 500 sheets is a mistake, not
 * a request.
 */
export const rollLabelsInput = z
  .object({
    shipmentId: z.string().min(1).optional(),
    rollIds: z.array(z.string().min(1)).min(1).max(500).optional(),
  })
  .refine(
    (value) => (value.shipmentId === undefined) !== (value.rollIds === undefined),
    { message: "Pass either a shipment or a set of reels" },
  );

export type CreateRollInput = z.infer<typeof createRollInput>;
export type UpdateRollInput = z.infer<typeof updateRollInput>;
export type ReceiveRollInput = z.infer<typeof receiveRollInput>;
export type RollLabelsInput = z.infer<typeof rollLabelsInput>;
