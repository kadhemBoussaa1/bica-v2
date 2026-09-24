import { z } from "zod";

/**
 * Ink stock — the colour catalogue and the ink drawn from it per order.
 *
 * Rebuilt from the legacy `couleur` / `commande_couleur` tables (Spring Boot
 * V22), which were designed but never filled: both were empty in the
 * production database. See docs/legacy-migration.md "Step 7".
 */

/** Units an ink colour is stocked in — the `InkUnit` enum in the schema. */
export const INK_UNITS = ["KG", "L"] as const;
export const inkUnitSchema = z.enum(INK_UNITS);
export type InkUnit = (typeof INK_UNITS)[number];

export function inkUnitLabel(unit: InkUnit): string {
  switch (unit) {
    case "KG":
      return "kg";
    case "L":
      return "L";
  }
}

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    });

/** A stock level or threshold: zero is meaningful, negative is not. */
const level = z.number().min(0, "Cannot be negative").max(1e9);

/** A movement: strictly positive, or it is not a movement. */
const movement = z
  .number()
  .positive("Enter a quantity above zero")
  .max(1e9);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .optional()
  .transform((value) => value || undefined);

export const createInkColourInput = z.object({
  /// The identifier — see the InkColour model. Name is only a label.
  code: z.string().trim().min(1, "Code is required").max(50),
  name: optionalText(150),
  unit: inkUnitSchema.default("KG"),
  /**
   * Opening balance, on create only. Afterwards the balance moves through
   * `restock`, `adjust` and the usage lines, never through the edit form —
   * a form that resubmits every field would otherwise silently overwrite a
   * balance that changed underneath it.
   */
  stock: level.default(0),
  alertThreshold: level.optional(),
});

export const updateInkColourInput = createInkColourInput
  .omit({ stock: true })
  .extend({ id: z.string().min(1) });

export const inkColourIdInput = z.object({ id: z.string().min(1) });

export const setInkColourActiveInput = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});

/** A delivery from the supplier: added to the balance. */
export const restockInkInput = z.object({
  id: z.string().min(1),
  quantity: movement,
});

/** A correction after a physical count: replaces the balance. */
export const adjustInkStockInput = z.object({
  id: z.string().min(1),
  stock: level,
});

export const recordInkUsageInput = z.object({
  orderId: z.string().min(1, "Choose the order"),
  colourId: z.string().min(1, "Choose the colour"),
  quantity: movement,
  /** Defaults to today server-side. */
  usedAt: isoDate,
  note: optionalText(300),
});

/**
 * `orderId` and `colourId` are not editable: a line keyed against the wrong
 * order or colour is deleted and re-recorded, so the balance it moved goes
 * back to the colour it came from.
 */
export const updateInkUsageInput = z.object({
  id: z.string().min(1),
  quantity: movement,
  usedAt: isoDate,
  note: optionalText(300),
});

export const inkUsageIdInput = z.object({ id: z.string().min(1) });

export const inkUsageForOrderInput = z.object({ orderId: z.string().min(1) });

export type CreateInkColourInput = z.infer<typeof createInkColourInput>;
export type UpdateInkColourInput = z.infer<typeof updateInkColourInput>;
export type RestockInkInput = z.infer<typeof restockInkInput>;
export type AdjustInkStockInput = z.infer<typeof adjustInkStockInput>;
export type RecordInkUsageInput = z.infer<typeof recordInkUsageInput>;
export type UpdateInkUsageInput = z.infer<typeof updateInkUsageInput>;

/**
 * How a colour's balance reads against its threshold: `out` at or below
 * zero, `low` at or below the threshold when one is set, `ok` otherwise.
 *
 * Compares two columns of the same row, which a Prisma `where` cannot, so
 * it is judged on the values a select returns — by the inks table for its
 * badge and by the dashboard for its "needs ordering" list. One rule, so
 * the two cannot disagree about which colour is low.
 */
export type InkStockState = "out" | "low" | "ok";
export function inkStockState(ink: { stock: number; alertThreshold: number | null }): InkStockState {
  if (ink.stock <= 0) return "out";
  if (ink.alertThreshold !== null && ink.stock <= ink.alertThreshold) return "low";
  return "ok";
}
