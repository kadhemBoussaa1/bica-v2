import { z } from "zod";

/**
 * Order enums, mirroring the Prisma schema. Duplicated rather than imported
 * because this package must not depend on the generated Prisma client — the web
 * app pulls it into the browser bundle.
 */
export const TYPE_SACS = ["FOND_V", "FOND_CARRE", "SOUS_PLAT"] as const;
export const PAPER_TYPES = ["PAPIER_KRAFT", "PAPIER_BLANC"] as const;
export const TYPE_IMPRESSIONS = [
  "IMPRESSION_SUR_ROULEAU",
  "IMPRESSION_SUR_SAC",
] as const;
export const EXPORT_STATUSES = ["PREPARATION", "EXPORTED"] as const;
/**
 * Document kind — see docs/order-lifecycle-plan.md §2.1. The transition table
 * and `canTransition` live in `order-lifecycle.ts`, not here, for the same
 * reason `order-input.ts` is its own module: keeping this file a leaf that
 * nothing else in the package needs to import back from.
 */
export const ORDER_KINDS = ["QUOTE", "ORDER"] as const;
/** The order lifecycle — see docs/order-lifecycle-plan.md §2.2. */
export const ORDER_STATUSES = [
  "DRAFT",
  "IN_PRODUCTION",
  "PRODUCED",
  "INVOICEABLE",
  "INVOICED",
  "READY_FOR_EXPORT",
  "COMPLETED",
  "CANCELLED",
] as const;
/**
 * Whether an order is priced per piece or per kilogram — see
 * `quantityUnitFor` in `pricing.ts`, which is the only place this is derived.
 * Defined here, not duplicated in `pricing.ts`: that module re-exports this
 * type so the barrel has one export, not two.
 */
export const QUANTITY_UNITS = ["PIECES", "KILOGRAMS"] as const;
/** LEGACY = migrated with a recorded price, never recomputed until the next save. COMPUTED = priced by this engine. */
export const PRICING_SOURCES = ["LEGACY", "COMPUTED"] as const;

export type TypeSac = (typeof TYPE_SACS)[number];
export type PaperType = (typeof PAPER_TYPES)[number];
export type TypeImpression = (typeof TYPE_IMPRESSIONS)[number];
export type ExportStatus = (typeof EXPORT_STATUSES)[number];
export type PricingSource = (typeof PRICING_SOURCES)[number];
export type OrderKind = (typeof ORDER_KINDS)[number];
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** "FOND_V" -> "Fond V"; "PAPIER_KRAFT" -> "Papier kraft". */
export function enumLabel(value: string): string {
  const words = value.replace(/_/g, " ").toLowerCase();
  const sentence = words.charAt(0).toUpperCase() + words.slice(1);
  // Keep the single-letter bag shapes readable: "Fond v" -> "Fond V".
  return sentence.replace(/\b([a-z])$/, (m) => m.toUpperCase());
}

export const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    });

/**
 * A stored money or measurement value.
 *
 * Unbounded below zero on purpose for the negotiated pricing fields: the
 * legacy data is migrated verbatim, and rejecting a negative here would make
 * a historical order uneditable. Quantities and dimensions use `positive`
 * instead. Exported for `order-input.ts`, which builds `orderBase` from the
 * same primitives.
 */
export const money = z.number().min(-1e9).max(1e9).optional();
export const positive = z.number().min(0).max(1e9).optional();

/**
 * `createOrderInput`/`updateOrderInput` live in `order-input.ts`, not here:
 * they compose `pricingInput` (from `pricing.ts`) and `createProductInput`
 * (from `products.ts`), and `pricing.ts` imports `TYPE_SACS`/`PAPER_TYPES`
 * from this file. Defining them here would make `orders.ts` import back from
 * a module that imports it — a cycle that fails at runtime with "Cannot
 * access '...' before initialization", since Zod schemas built from these
 * enums run at module-evaluation time, not lazily. `order-input.ts` is a
 * leaf: nothing in this package imports it.
 */

/** Print colours are edited as a set: the whole list replaces the old one. */
export const setOrderColoursInput = z.object({
  orderId: z.string().min(1),
  colours: z
    .array(
      z.object({
        nom: optionalText(120),
        prix: money,
      }),
    )
    .max(20),
});
