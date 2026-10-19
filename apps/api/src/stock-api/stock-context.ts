import type { Prisma } from "../generated/prisma/client.js";
import type { StockMovementType } from "../generated/prisma/enums.js";

/**
 * Why the reels a transaction writes are moving — docs/erp-stock-api.md.
 *
 * The movements themselves are written by Postgres: the `paper_stock_event`
 * trigger on `PaperRoll` (migration `20261019073207_stock_events`) records a
 * `StockEvent` for every change to a reel's on-hand weight, whoever made it.
 * What the trigger cannot see is the reason, so a service names it here,
 * inside its transaction, before it touches the reel. A write with no
 * context still moves stock and is still recorded, as an ADJUSTMENT — the
 * context only makes the movement more precise, it is never what makes it
 * exist.
 *
 * Reservations move no stock and need no context.
 */
export type StockReason =
  | "RECEIPT"
  | "CONSUME"
  | "CUT"
  | "UNDO_CUT"
  | "SLIT"
  | "EDIT"
  | "ARCHIVE"
  | "RESTORE"
  | "DELETE"
  | "LEGACY_SYNC";

interface ReasonTypes {
  /** The type of a gain on a reel's on-hand weight. */
  in: StockMovementType;
  /** The type of a loss. */
  out: StockMovementType;
  /** `sourceDocument.type` in the contract. */
  sourceType: string;
}

const ADJUSTMENT = { in: "ADJUSTMENT", out: "ADJUSTMENT" } as const;

/**
 * A cut moves length from one reel to another of the same SKU, so its two
 * legs are a TRANSFER pair that nets to zero. A slit is a conversion: the
 * wide reel goes out to production and narrower bands come back in, and the
 * trim is the yield loss between the two — which is why its legs are
 * PRODUCTION and do not balance.
 */
const REASONS: Record<StockReason, ReasonTypes> = {
  RECEIPT: { ...ADJUSTMENT, in: "RECEIPT", sourceType: "PURCHASE" },
  CONSUME: { ...ADJUSTMENT, out: "PRODUCTION_OUT", sourceType: "PRODUCTION_ORDER" },
  CUT: { in: "TRANSFER_IN", out: "TRANSFER_OUT", sourceType: "CUT" },
  UNDO_CUT: { in: "TRANSFER_IN", out: "TRANSFER_OUT", sourceType: "UNDO_CUT" },
  SLIT: { in: "PRODUCTION_IN", out: "PRODUCTION_OUT", sourceType: "SLIT" },
  EDIT: { ...ADJUSTMENT, sourceType: "EDIT" },
  ARCHIVE: { ...ADJUSTMENT, sourceType: "ARCHIVE" },
  RESTORE: { ...ADJUSTMENT, sourceType: "RESTORE" },
  DELETE: { ...ADJUSTMENT, sourceType: "DELETE" },
  LEGACY_SYNC: { ...ADJUSTMENT, sourceType: "LEGACY_SYNC" },
};

/**
 * Names the reason for the rest of the transaction. `set_config(…, true)` is
 * transaction-local, so it must run on an interactive transaction's client:
 * on a bare client it would last one statement and the trigger would never
 * see it.
 *
 * `documentNumber` is the number a person would recognise — the shipment a
 * reel arrived on, the order that consumed it, the piece a cut made — or
 * null where no document stands behind the change.
 */
export async function setStockContext(
  tx: Prisma.TransactionClient,
  reason: StockReason,
  documentNumber: string | null = null,
): Promise<void> {
  const { in: gain, out: loss, sourceType } = REASONS[reason];
  const context = JSON.stringify({ in: gain, out: loss, sourceType, sourceNumber: documentNumber });
  await tx.$executeRaw`SELECT set_config('bica.stock_context', ${context}, true)`;
}
