import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import type { PaperType } from "../generated/prisma/enums.js";
import { PrismaService } from "../prisma.service";
import {
  CURRENCY,
  SCHEMA_VERSION,
  TENANT_REF,
  UNIT,
  VALUATION_METHOD,
  WAREHOUSE,
  decimal3,
  decimal6,
  productName,
  sumDecimal3,
} from "./stock-api.contract";

type Db = Prisma.TransactionClient;

const EVENT_SELECT = {
  sequence: true,
  eventId: true,
  type: true,
  occurredAt: true,
  movementType: true,
  sku: true,
  paperType: true,
  grammage: true,
  laizeMm: true,
  lotId: true,
  lotNumber: true,
  quantity: true,
  metres: true,
  unitCost: true,
  resultingQuantity: true,
  resultingValue: true,
  sourceType: true,
  sourceNumber: true,
  payload: true,
} satisfies Prisma.StockEventSelect;

export type StockEventRow = Prisma.StockEventGetPayload<{ select: typeof EVENT_SELECT }>;

/** One SKU's level, every figure already a decimal string from Postgres. */
interface LevelRow {
  sku: string;
  paperType: PaperType | null;
  grammage: number | null;
  laizeMm: number | null;
  quantity: string;
  unitCost: string;
  totalValue: string;
  /** Reels on hand; unknown for a past `asOf`. */
  lots: number | null;
}

/** A past `asOf` earlier than the first event: the log cannot answer it. */
export class HistoryUnavailableError extends Error {
  constructor(readonly historyStartsAt: Date) {
    super(`Stock history starts at ${historyStartsAt.toISOString()}`);
  }
}

/**
 * The paper stock as BICA Expert reads it — docs/erp-stock-api.md.
 *
 * Read-only over `PaperRoll` and the `StockEvent` log the trigger writes;
 * the one write is a snapshot event. Served by the plain Express routes in
 * `stock-api.http.ts` (an external, key-authenticated surface, not tRPC) and
 * used by `StockPushService` to build what it pushes, so the pull and the
 * push can never describe an event differently.
 */
@Injectable()
export class StockApiService {
  constructor(private readonly prisma: PrismaService) {}

  /** Events after `afterSequence`, oldest first: movements and snapshots alike. */
  async movements(afterSequence: number, limit: number) {
    const [rows, head] = await Promise.all([
      this.prisma.stockEvent.findMany({
        where: { sequence: { gt: BigInt(afterSequence) } },
        orderBy: { sequence: "asc" },
        take: limit,
        select: EVENT_SELECT,
      }),
      this.headSequence(this.prisma),
    ]);
    const last = rows.at(-1);
    return {
      movements: rows.map((row) => this.envelope(row)),
      nextAfterSequence: last ? Number(last.sequence) : afterSequence,
      lastSequence: head,
    };
  }

  /**
   * Every SKU's level now, or at a past instant.
   *
   * Now: summed from the reels, with the counter read in the same snapshot,
   * so `sequence` names exactly the last movement these levels include — the
   * figure BICA Expert compares against when it reconciles. SKUs that were
   * stocked at any point since the log began are listed at zero.
   *
   * In the past: each SKU's `resulting` block from its last movement at or
   * before `asOf`. The log starts at the opening balance, so an earlier
   * instant throws `HistoryUnavailableError`.
   */
  async levels(asOf?: Date) {
    const now = new Date();
    if (!asOf || asOf >= now) {
      const { sequence, rows } = await this.prisma.$transaction(
        async (tx) => ({ sequence: await this.headSequence(tx), rows: await this.liveLevels(tx) }),
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      return this.levelsBody(now, sequence, rows);
    }

    const first = await this.prisma.stockEvent.findFirst({
      orderBy: { sequence: "asc" },
      select: { occurredAt: true },
    });
    if (first && asOf < first.occurredAt) throw new HistoryUnavailableError(first.occurredAt);

    const rows = await this.prisma.$queryRaw<(LevelRow & { sequence: string })[]>`
      WITH bound AS (
        SELECT max("sequence") AS seq FROM "StockEvent"
         WHERE "occurredAt" <= (${asOf.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      )
      SELECT DISTINCT ON (e."sku")
             e."sku", e."paperType", e."grammage", e."laizeMm",
             round(e."resultingQuantity"::numeric, 3)::numeric(18, 3)::text AS "quantity",
             (CASE WHEN e."resultingQuantity" > 0
                   THEN round(e."resultingValue"::numeric / e."resultingQuantity"::numeric, 6)
                   ELSE 0 END)::numeric(18, 6)::text AS "unitCost",
             round(e."resultingValue"::numeric, 3)::numeric(18, 3)::text AS "totalValue",
             NULL::integer AS "lots",
             bound.seq::text AS "sequence"
        FROM "StockEvent" e, bound
       WHERE e."type" = 'MOVEMENT' AND e."sequence" <= bound.seq
       ORDER BY e."sku", e."sequence" DESC`;
    return this.levelsBody(asOf, Number(rows[0]?.sequence ?? 0), rows);
  }

  /** The total and per-warehouse value, summed exactly from the levels. */
  async valuation(asOf?: Date) {
    const levels = await this.levels(asOf);
    return {
      asOf: levels.asOf,
      currency: CURRENCY,
      sequence: levels.sequence,
      totalValue: levels.totalValue,
      byWarehouse: [{ code: WAREHOUSE.code, name: WAREHOUSE.name, totalValue: levels.totalValue }],
    };
  }

  async health() {
    return {
      ok: true,
      time: new Date().toISOString(),
      lastSequence: await this.headSequence(this.prisma),
    };
  }

  /**
   * Writes a `stock.snapshot` event: every SKU's level, frozen in the log.
   *
   * The counter is taken first, which holds every stock-moving transaction
   * at its trigger until this one commits, so the levels summed next are
   * exactly the stock after movement `sequence − 1`.
   */
  async createSnapshot(): Promise<{ sequence: number; asOf: Date }> {
    return this.prisma.$transaction(async (tx) => {
      const [head] = await tx.$queryRaw<{ last: bigint }[]>`
        UPDATE "StockEventCounter" SET "last" = "last" + 1 WHERE "id" = 1 RETURNING "last"`;
      if (!head) throw new Error("StockEventCounter has no row — is the migration applied?");
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS "now"`;
      const asOf = clock?.now ?? new Date();
      const { levels, totalValue } = this.levelsBody(asOf, Number(head.last), await this.liveLevels(tx));
      await tx.stockEvent.create({
        data: {
          sequence: head.last,
          type: "SNAPSHOT",
          occurredAt: asOf,
          payload: { asOf: asOf.toISOString(), currency: CURRENCY, levels, totalValue },
        },
        select: { sequence: true },
      });
      return { sequence: Number(head.last), asOf };
    });
  }

  /** When the last snapshot was written, for the daily job. */
  async lastSnapshotAt(): Promise<Date | null> {
    const last = await this.prisma.stockEvent.findFirst({
      where: { type: "SNAPSHOT" },
      orderBy: { sequence: "desc" },
      select: { occurredAt: true },
    });
    return last?.occurredAt ?? null;
  }

  /** The contract's envelope for one event — pulled and pushed alike. */
  envelope(row: StockEventRow) {
    const occurredAt = row.occurredAt.toISOString();
    const base = {
      eventId: row.eventId,
      eventType: row.type === "SNAPSHOT" ? "stock.snapshot" : "stock.movement",
      schemaVersion: SCHEMA_VERSION,
      tenantRef: TENANT_REF,
      sequence: Number(row.sequence),
      occurredAt,
    };
    if (row.type === "SNAPSHOT") return { ...base, payload: row.payload };

    const quantity = row.resultingQuantity ?? 0;
    const value = row.resultingValue ?? 0;
    return {
      ...base,
      payload: {
        movementId: String(row.sequence),
        type: row.movementType,
        occurredAt,
        product: {
          sku: row.sku,
          name: productName(row.paperType, row.grammage, row.laizeMm),
          unit: UNIT,
        },
        warehouse: WAREHOUSE,
        lot: row.lotId ? { id: row.lotId, number: row.lotNumber } : null,
        quantity: decimal3(row.quantity ?? 0),
        metres: decimal3(row.metres ?? 0),
        unitCost: decimal6(row.unitCost ?? 0),
        currency: CURRENCY,
        valuationMethod: VALUATION_METHOD,
        sourceDocument: row.sourceType ? { type: row.sourceType, number: row.sourceNumber } : null,
        resulting: {
          quantity: decimal3(quantity),
          avgCost: decimal6(quantity > 0 ? value / quantity : 0),
          totalValue: decimal3(value),
        },
      },
    };
  }

  /** One undelivered event for the push worker, or null. */
  async nextUndelivered() {
    return this.prisma.stockEvent.findFirst({
      where: { deliveredAt: null },
      orderBy: { sequence: "asc" },
      select: { ...EVENT_SELECT, attempts: true, nextAttemptAt: true },
    });
  }

  // ---- helpers -------------------------------------------------------------

  private async headSequence(db: Db): Promise<number> {
    const head = await db.stockEventCounter.findUnique({ where: { id: 1 }, select: { last: true } });
    return Number(head?.last ?? 0);
  }

  /**
   * The live levels, one row per SKU. The on-hand rule and the rounding are
   * the trigger's (paper_stock_emit), so a level here equals the `resulting`
   * block of the SKU's last movement.
   */
  private liveLevels(db: Db) {
    return db.$queryRaw<LevelRow[]>`
      WITH reels AS (
        SELECT paper_stock_sku("paperType", "grammage", "laize") AS sku,
               "paperType", "grammage", round("laize")::integer AS "laizeMm",
               round("poidsRestant"::numeric, 3) AS kg,
               COALESCE("price", 0)::numeric AS price
          FROM "PaperRoll"
         WHERE "receivedAt" IS NOT NULL AND NOT "consomme" AND NOT "archived"
      ), live AS (
        SELECT sku, min("paperType") AS "paperType", min("grammage") AS "grammage",
               min("laizeMm") AS "laizeMm", sum(kg) AS quantity,
               sum(round(kg * price, 3)) AS value, count(*)::integer AS lots
          FROM reels
         GROUP BY sku
      ), known AS (
        SELECT DISTINCT ON ("sku") "sku", "paperType", "grammage", "laizeMm"
          FROM "StockEvent"
         WHERE "type" = 'MOVEMENT'
         ORDER BY "sku", "sequence" DESC
      )
      SELECT COALESCE(l.sku, k."sku") AS "sku",
             COALESCE(l."paperType", k."paperType") AS "paperType",
             COALESCE(l."grammage", k."grammage") AS "grammage",
             COALESCE(l."laizeMm", k."laizeMm") AS "laizeMm",
             COALESCE(l.quantity, 0)::numeric(18, 3)::text AS "quantity",
             (CASE WHEN l.quantity > 0 THEN round(l.value / l.quantity, 6) ELSE 0 END)
               ::numeric(18, 6)::text AS "unitCost",
             COALESCE(l.value, 0)::numeric(18, 3)::text AS "totalValue",
             COALESCE(l.lots, 0) AS "lots"
        FROM live l
        FULL JOIN known k ON k."sku" = l.sku
       ORDER BY 1`;
  }

  private levelsBody(asOf: Date, sequence: number, rows: LevelRow[]) {
    const at = asOf.toISOString();
    const levels = rows.map((row) => ({
      sku: row.sku,
      warehouseCode: WAREHOUSE.code,
      quantity: row.quantity,
      unitCost: row.unitCost,
      totalValue: row.totalValue,
      currency: CURRENCY,
      asOf: at,
      product: { name: productName(row.paperType, row.grammage, row.laizeMm), unit: UNIT },
      ...(row.lots === null ? {} : { lots: row.lots }),
    }));
    return {
      asOf: at,
      currency: CURRENCY,
      sequence,
      levels,
      totalValue: sumDecimal3(levels.map((level) => level.totalValue)),
    };
  }
}
