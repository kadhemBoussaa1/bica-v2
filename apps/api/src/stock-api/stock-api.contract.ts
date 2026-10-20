import { createHash } from "node:crypto";
import type { OrderStatus, PaperType } from "../generated/prisma/enums.js";

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

/** The most rows one page returns, and how many a page holds by default. */
export const MAX_PAGE = 1000;
export const DEFAULT_PAGE = 500;

/** Where the events of a delivery come from: a reel scanned in, or synced. */
export const RECEIPT_SOURCE = "SUPPLIER_DELIVERY";

/**
 * `sourceDocument.type` on the wire. Receipts were written as PURCHASE until
 * 2026-10-20, when BICA Expert asked for SUPPLIER_DELIVERY: what stands
 * behind a receipt here is the import shipment the reel arrived on, not a
 * purchase order.
 */
export function sourceDocumentType(stored: string): string {
  return stored === "PURCHASE" ? RECEIPT_SOURCE : stored;
}

/**
 * BICA Expert's `reason` on an ADJUSTMENT, from what caused it here. A
 * weight typed over an untouched reel corrects a count; everything else —
 * an archive, a restore, a deleted reel, the old app's untyped changes — is
 * OTHER, because nothing here records whether the paper was damaged,
 * scrapped or sampled. The opening balance and a revaluation (quantity 0)
 * are not losses and carry none.
 */
export function adjustmentReason(
  movementType: string | null,
  sourceType: string | null,
  quantity: number,
): string | null {
  if (movementType !== "ADJUSTMENT" || sourceType === "OPENING" || quantity === 0) return null;
  return sourceType === "EDIT" ? "COUNT_CORRECTION" : "OTHER";
}

/**
 * An order as BICA Expert's production order: OPEN while paper consumed
 * for it is work in progress ("en cours"), COMPLETED once it is produced —
 * every later step (invoicing, export) is past production — and CANCELLED.
 * Paper is consumed only from IN_PRODUCTION on; a DRAFT with consumption is
 * a legacy row, and counts as open.
 */
export type ProductionStatus = "OPEN" | "COMPLETED" | "CANCELLED";

export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = ["DRAFT", "IN_PRODUCTION"];

export function productionStatus(status: OrderStatus): ProductionStatus {
  if (status === "CANCELLED") return "CANCELLED";
  return OPEN_ORDER_STATUSES.includes(status) ? "OPEN" : "COMPLETED";
}

/**
 * A fixed UUID for a reconstructed history row, so pulling `/stock/history`
 * twice gives the same `eventId` and BICA Expert's deduplication holds. A
 * version-5 UUID (RFC 9562) of `key` in this API's own namespace.
 */
export function historyEventId(key: string): string {
  const bytes = createHash("sha1").update(HISTORY_NAMESPACE).update(key).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The namespace's bytes: UUID 6f1c3a52-9a0e-4d1b-8c61-2b7f4e9d0a13. */
const HISTORY_NAMESPACE = Buffer.from("6f1c3a529a0e4d1b8c612b7f4e9d0a13", "hex");

const TUNIS_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Tunis",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The calendar day of an instant in Tunis, `YYYY-MM-DD` — what a lot's
 * reception and an order's start are measured in. A `@db.Date` column
 * (midnight UTC) reads back as its own day, since Tunis is ahead of UTC.
 */
export function tunisDay(instant: Date | null | undefined): string | null {
  if (!instant) return null;
  const parts = TUNIS_DAY.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((piece) => piece.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

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
