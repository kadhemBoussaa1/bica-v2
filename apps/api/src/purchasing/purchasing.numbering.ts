import type { PurchaseCategory } from "../generated/prisma/enums.js";

/**
 * The number prefixes for purchase orders and goods receipts, one per
 * category per document kind, continuing the legacy series.
 *
 * The legacy system encoded the category in the number, and the two document
 * kinds do NOT share a rule: ink orders are `26EBC` (encre) but ink receipts
 * are `26IBR`; plate is `26CLBC` / `26CLBR`; transport inverts the letters
 * entirely, `26BCT` / `26BRT`. Neither map is derivable from the other, so
 * both are written out and checked by the compiler.
 *
 * The leading `26` is a fixed series marker, not the issue year — all 556
 * migrated orders carry it although they were raised across 2024, 2025 and
 * 2026. It stays literal in the prefix, and the counter rows are keyed on the
 * whole prefix string (see `PurchaseOrderCounter` in schema.prisma).
 *
 * Every migrated number is `<prefix>-<3 digits>`: verified across all 556
 * orders and 551 receipts, none without the dash and none of another width.
 */

/** `satisfies Record<PurchaseCategory, string>` so a new category is a type error. */
export const ORDER_PREFIX = {
  PAPER: "26PBC",
  INK: "26EBC",
  PLATE: "26CLBC",
  GLUE: "26CBC",
  BOXES: "26CSBC",
  PALLETS: "26CSPC",
  STRETCH_FILM: "26FEBC",
  TRANSPORT: "26BCT",
  MISC: "26MSBC",
} as const satisfies Record<PurchaseCategory, string>;

export const RECEIPT_PREFIX = {
  PAPER: "26PBR",
  INK: "26IBR",
  PLATE: "26CLBR",
  GLUE: "26CBR",
  BOXES: "26CSBR",
  PALLETS: "26CSPR",
  STRETCH_FILM: "26FEBR",
  TRANSPORT: "26BRT",
  MISC: "26MSBR",
} as const satisfies Record<PurchaseCategory, string>;

/**
 * The sequence padded as the legacy numbers are: three digits, so `36`
 * becomes `26PBC-036`. A sequence past 999 simply grows wider rather than
 * wrapping or truncating — MISC is already at 200, and a number that reads
 * oddly is better than a duplicate.
 */
export function formatNumero(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(3, "0")}`;
}
