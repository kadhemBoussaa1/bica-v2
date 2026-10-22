import { z } from "zod";
import { PAPER_TYPES, optionalText, type TypeSac } from "./orders.js";

/**
 * Raw material prices — the catalogue the order form prefills its paper and
 * glue kilo prices from (docs/raw-material-prices-plan.md). Paper and the
 * three glues only: cartons, transport and inks keep their own fields.
 *
 * Every price is per kilogram, which is what the pricing engine reads, so
 * there is no unit. There is no currency yet either: that is its own
 * decision, deferred (plan decision 2).
 */

/** `RawMaterialType` in the schema. */
export const RAW_MATERIAL_TYPES = ["PAPER", "GLUE"] as const;
export type RawMaterialType = (typeof RAW_MATERIAL_TYPES)[number];

/** The four kilo prices `priceOrder` reads — `PricingSlot` in the schema. */
export const PRICING_SLOTS = ["PAPER", "HANDLE_GLUE", "SIDE_GLUE", "BASE_ADHESIVE"] as const;
export type PricingSlot = (typeof PRICING_SLOTS)[number];

/** The slots a glue may be the default of; the paper line is matched on the product. */
export const GLUE_SLOTS = ["HANDLE_GLUE", "SIDE_GLUE", "BASE_ADHESIVE"] as const;
export type GlueSlot = (typeof GLUE_SLOTS)[number];

/** Which kind of material a slot takes. */
export function materialTypeForSlot(slot: PricingSlot): RawMaterialType {
  return slot === "PAPER" ? "PAPER" : "GLUE";
}

/** A catalogue price: per kilogram, and above zero, or it is not a price. */
const kiloPrice = z
  .number({ error: "Enter the price" })
  .positive("Enter a price above zero")
  .max(1e9);

const materialFields = {
  code: z.string().trim().min(1, "Code is required").max(50),
  label: z.string().trim().min(1, "Label is required").max(150),
};

/**
 * A paper names its supplier, because that is what its price depends on
 * (plan decision 3), and the paper type it is matched on. `grammage` narrows
 * it to one weight; null means any. Optional so an edit that leaves it out
 * keeps what is stored, and null clears it.
 */
const paperFields = {
  type: z.literal("PAPER"),
  supplierId: z.string({ error: "Choose the supplier" }).min(1, "Choose the supplier"),
  paperType: z.enum(PAPER_TYPES, { error: "Choose the paper type" }),
  grammage: z.number().positive("Enter a grammage above zero").max(2000).nullable().optional(),
};

/**
 * The order glue lines this glue starts as. One glue may serve several; a
 * line has one default, so naming it here moves it off any other glue.
 */
const glueFields = {
  type: z.literal("GLUE"),
  defaultSlots: z
    .array(z.enum(GLUE_SLOTS))
    .max(GLUE_SLOTS.length)
    .refine((slots) => new Set(slots).size === slots.length, "A line is listed twice")
    .default([]),
};

/**
 * Created with its first price, which is required: a material without one
 * could be picked on an order and price nothing (plan adjustment 14).
 */
const firstPrice = { kiloPrice, comment: optionalText(300) };

export const createRawMaterialInput = z.discriminatedUnion("type", [
  z.object({ ...materialFields, ...paperFields, ...firstPrice }),
  z.object({ ...materialFields, ...glueFields, ...firstPrice }),
]);

/**
 * The price is not here: it moves only through `setRawMaterialPriceInput`,
 * which keeps the history. `type` is sent so the right fields are checked,
 * and must match the stored one: order lines rely on it.
 */
export const updateRawMaterialInput = z.discriminatedUnion("type", [
  z.object({ id: z.string().min(1), ...materialFields, ...paperFields }),
  z.object({ id: z.string().min(1), ...materialFields, ...glueFields }),
]);

export const rawMaterialIdInput = z.object({ id: z.string().min(1) });

export const setRawMaterialActiveInput = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});

/**
 * `currentPriceId` is the price the dialog showed. If another admin changed
 * it since, the new price is refused rather than replacing one its author
 * never saw — the same rule the order form follows (plan §4).
 */
export const setRawMaterialPriceInput = z.object({
  materialId: z.string().min(1),
  currentPriceId: z.string().min(1),
  kiloPrice,
  comment: optionalText(300),
});

export type CreateRawMaterialInput = z.infer<typeof createRawMaterialInput>;
export type UpdateRawMaterialInput = z.infer<typeof updateRawMaterialInput>;
export type SetRawMaterialPriceInput = z.infer<typeof setRawMaterialPriceInput>;

// ---------------------------------------------------------------------------
// The order's four price lines (plan §3)
// ---------------------------------------------------------------------------

/** The order input's four lines, as the form names them, and the slot each fills. */
export const MATERIAL_LINE_SLOTS = {
  paper: "PAPER",
  handleGlue: "HANDLE_GLUE",
  sideGlue: "SIDE_GLUE",
  baseAdhesive: "BASE_ADHESIVE",
} as const satisfies Record<string, PricingSlot>;
export type MaterialLineKey = keyof typeof MATERIAL_LINE_SLOTS;
export const MATERIAL_LINE_KEYS = ["paper", "handleGlue", "sideGlue", "baseAdhesive"] as const satisfies readonly MaterialLineKey[];

/**
 * One line of an order's save. The server is never sent a catalogue price,
 * only WHICH one the form showed: if it is no longer current the save is
 * refused (CONFLICT) rather than storing a total nobody saw.
 *
 *   - `keep`: the stored line, verbatim — so saving a draft for a typo fix
 *     never refreshes its prices. Update only.
 *   - `catalog`: the material's current price, which must be `priceId`.
 *   - `manual`: a price typed over the catalogue's, for a named material.
 *   - `null`: no line.
 *
 * Ignored entirely on an order whose pricing is locked (plan §2).
 */
export const orderMaterialLineInput = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("keep") }),
    z.object({
      mode: z.literal("catalog"),
      materialId: z.string().min(1),
      priceId: z.string().min(1),
    }),
    z.object({
      mode: z.literal("manual"),
      materialId: z.string().min(1, "Choose the material"),
      kiloPrice,
    }),
  ])
  .nullable();
export type OrderMaterialLineInput = z.infer<typeof orderMaterialLineInput>;

export const orderMaterialsInput = z.object({
  paper: orderMaterialLineInput,
  handleGlue: orderMaterialLineInput,
  sideGlue: orderMaterialLineInput,
  baseAdhesive: orderMaterialLineInput,
});
export type OrderMaterialsInput = z.infer<typeof orderMaterialsInput>;

/**
 * Whether a product's price reads a slot at all: a sheet is not glued, and
 * the handle glue counts only on a bag with a handle — the same rules as
 * `priceOrder`. A new line on an unused slot is refused, since the engine
 * would ignore it and the order would still show it.
 */
export function slotUsedBy(slot: PricingSlot, product: { typeSac: TypeSac; hasHandle: boolean }): boolean {
  if (slot === "PAPER") return true;
  if (product.typeSac === "SOUS_PLAT") return false;
  return slot !== "HANDLE_GLUE" || product.hasHandle;
}

/** The four kilo prices the engine reads, per line; null where there is no line. */
export interface SlotKiloPrices {
  paper: number | null;
  handleGlue: number | null;
  sideGlue: number | null;
  baseAdhesive: number | null;
}

/** An order's stored lines as the engine's four kilo prices. */
export function kiloPricesFromLines(
  lines: readonly { slot: PricingSlot; kiloPrice: number }[],
): SlotKiloPrices {
  const price = (slot: PricingSlot) => lines.find((line) => line.slot === slot)?.kiloPrice ?? null;
  return {
    paper: price("PAPER"),
    handleGlue: price("HANDLE_GLUE"),
    sideGlue: price("SIDE_GLUE"),
    baseAdhesive: price("BASE_ADHESIVE"),
  };
}

/** No lines at all: every figure that needs a price stays null. */
export const NO_KILO_PRICES: SlotKiloPrices = {
  paper: null,
  handleGlue: null,
  sideGlue: null,
  baseAdhesive: null,
};
