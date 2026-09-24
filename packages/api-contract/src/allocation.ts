import { z } from "zod";

/**
 * Paper allocation — cutting, slitting and reserving reels for an order.
 * docs/roll-allocation-plan.md.
 *
 * Everything is in METRES. The legacy system allocated by weight; the 214
 * migrated `RollAllocation` rows carry kilograms only and a NULL length, and
 * are read but never re-computed (see the service).
 */

/**
 * How far a reel's width may miss the production width and still be used
 * as-is. Beyond it on the wide side the reel needs slitting; on the narrow
 * side it is not a candidate at all.
 */
export const WIDTH_TOLERANCE_MM = 2;

export const ROLL_FITS = ["exact", "slit"] as const;
export type RollFit = (typeof ROLL_FITS)[number];

/**
 * Classifies a reel against an order's production width. The server uses
 * this to label candidates and the picker uses it to label the bands a slit
 * would create, so the two can never disagree.
 */
export function rollFit(laizeMm: number, productionWidthCm: number): RollFit | null {
  const needMm = productionWidthCm * 10;
  if (Math.abs(laizeMm - needMm) <= WIDTH_TOLERANCE_MM) return "exact";
  if (laizeMm > needMm + WIDTH_TOLERANCE_MM) return "slit";
  return null;
}

/** A length in metres: strictly positive, and no reel is 10 000 km long. */
const metres = z.number().positive("Enter a length above zero").max(1e7);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .optional()
  .transform((value) => value || undefined);

/** Cut `metres` off a reel into a new child reel. */
export const cutRollInput = z.object({
  rollId: z.string().min(1),
  metres,
});

/**
 * Slit a reel into bands of these widths. Two at least — one band is not a
 * slit — and eight at most, which is more than any slitter here has knives.
 * The sum may be below the reel's width; the difference is trim.
 */
export const slitRollInput = z.object({
  rollId: z.string().min(1),
  widthsMm: z
    .array(z.number().int("Whole millimetres").min(1).max(100000))
    .min(2, "A slit makes at least two bands")
    .max(8),
});

export const reserveRollInput = z.object({
  orderId: z.string().min(1),
  rollId: z.string().min(1),
  metres,
  /** Defaults to today server-side. */
  dateAllocation: isoDate,
});

/** Same shape: cut exactly `metres` off the reel and reserve the child whole. */
export const cutAndReserveInput = reserveRollInput;

export const consumeAllocationInput = z.object({
  id: z.string().min(1),
  /** Defaults to the reserved length. Zero is a valid outcome (nothing used). */
  metresUsed: z.number().min(0, "Cannot be negative").max(1e7).optional(),
});

export const allocationIdInput = z.object({ id: z.string().min(1) });

export const allocationForOrderInput = z.object({ orderId: z.string().min(1) });

export type CutRollInput = z.infer<typeof cutRollInput>;
export type SlitRollInput = z.infer<typeof slitRollInput>;
export type ReserveRollInput = z.infer<typeof reserveRollInput>;
export type CutAndReserveInput = z.infer<typeof cutAndReserveInput>;
export type ConsumeAllocationInput = z.infer<typeof consumeAllocationInput>;
