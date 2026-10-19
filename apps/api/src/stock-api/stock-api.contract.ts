import type { PaperType } from "../generated/prisma/enums.js";

/**
 * The fixed parts of the stock contract with BICA Expert —
 * docs/erp-stock-api.md. One tenant (this company), one warehouse (there is
 * no warehouse model here), one currency (every paper shipment is EUR), one
 * unit (reels are priced per kilogram).
 */

/** Bumped only when a field changes meaning. */
export const SCHEMA_VERSION = 1;

/** This ERP's own id for the company — the envelope's `tenantRef`. */
export const TENANT_REF = "bicapack";

export const WAREHOUSE = { code: "BICAPACK", name: "Bicapack — stock papier" } as const;

/**
 * Every `ImportShipment.currency` is EUR (37 of 37 on 2026-10-19) and reel
 * prices are in it. A shipment in another currency would be summed as euros
 * — the open point in docs/erp-stock-api.md.
 */
export const CURRENCY = "EUR";

export const UNIT = "kg";

/**
 * Not one of the contract's WAC · FIFO · STANDARD: each reel is a lot valued
 * at its own purchase price (specific identification), and a level's unit
 * cost is the weighted average of the lots on hand. Flagged to BICA Expert.
 */
export const VALUATION_METHOD = "SPECIFIC";

/** The most events one `/stock/movements` page returns. */
export const MAX_PAGE = 500;

/** Kilograms, metres and money: a decimal string with 3 places. */
export function decimal3(value: number): string {
  const text = value.toFixed(3);
  return text === "-0.000" ? "0.000" : text;
}

/** A cost per kilogram: 6 places, so a weighted average keeps its precision. */
export function decimal6(value: number): string {
  const text = value.toFixed(6);
  return text === "-0.000000" ? "0.000000" : text;
}

/** Sums 3-place decimal strings exactly, in integer thousandths. */
export function sumDecimal3(values: readonly string[]): string {
  const total = values.reduce((sum, value) => sum + toThousandths(value), 0n);
  const sign = total < 0n ? "-" : "";
  const abs = total < 0n ? -total : total;
  const whole = abs / 1000n;
  const frac = (abs % 1000n).toString().padStart(3, "0");
  return `${sign}${whole}.${frac}`;
}

function toThousandths(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole = "0", frac = ""] = value.replace(/^[-+]/, "").split(".");
  const amount = BigInt(whole) * 1000n + BigInt(frac.padEnd(3, "0").slice(0, 3));
  return negative ? -amount : amount;
}

const PAPER_NAMES: Record<PaperType, string> = {
  PAPIER_KRAFT: "Papier kraft",
  PAPIER_BLANC: "Papier blanc",
};

/** "Papier kraft 90 g/m² 920 mm" — the product name BICA Expert displays. */
export function productName(
  paperType: PaperType | null,
  grammage: number | null,
  laizeMm: number | null,
): string {
  return [
    paperType ? PAPER_NAMES[paperType] : "Papier",
    grammage === null ? "? g/m²" : `${grammage} g/m²`,
    laizeMm === null ? "? mm" : `${laizeMm} mm`,
  ].join(" ");
}
