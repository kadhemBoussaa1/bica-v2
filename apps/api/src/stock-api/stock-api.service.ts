import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import type { PaperType } from "../generated/prisma/enums.js";
import { PrismaService } from "../prisma.service";
import {
  CURRENCY,
  SCHEMA_VERSION,
  TENANT_REF,
  UNIT,
  WAREHOUSE,
  decimal3,
  decimal6,
  productName,
  sumDecimal3,
} from "./stock-api.contract";
import { StockReferenceService, headSequence, type MovementFields } from "./stock-api.reference";

type Db = Prisma.TransactionClient;

const EVENT_SELECT = {
  sequence: true,
  eventId: true,
  type: true,
  occurredAt: true,
  recordedAt: true,
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
  metres: string;
  unitCost: string;
  totalValue: string;
  /** Reels on hand. */
  lots: number;
}

/** Which events a `/stock/movements` page returns. */
export interface MovementFilter {
  eventType?: "stock.movement" | "stock.snapshot";
  /** Only events that occurred at or after this instant. */
  since?: Date;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly reference: StockReferenceService,
  ) {}

  /**
   * Events after `afterSequence`, oldest first: movements and snapshots
   * alike, unless filtered.
   *
   * The head is read before the page, so a short page means every event up
   * to it was looked at: `nextAfterSequence` then moves past the ones the
   * filter skipped, and a cursor never sticks on a run of snapshots.
   */
  async movements(afterSequence: number, limit: number, filter: MovementFilter = {}) {
    const head = await headSequence(this.prisma);
    const rows = await this.prisma.stockEvent.findMany({
      where: {
        sequence: { gt: BigInt(afterSequence) },
        ...(filter.eventType
          ? { type: filter.eventType === "stock.snapshot" ? "SNAPSHOT" : "MOVEMENT" }
          : {}),
        ...(filter.since ? { occurredAt: { gte: filter.since } } : {}),
      },
      orderBy: { sequence: "asc" },
      take: limit,
      select: EVENT_SELECT,
    });
    const last = rows.at(-1);
    const scanned = last ? Number(last.sequence) : afterSequence;
    return {
      movements: await this.envelopes(rows),
      nextAfterSequence: rows.length < limit ? Math.max(scanned, head) : scanned,
      lastSequence: Math.max(head, scanned),
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
   * In the past: summed lot by lot from the movements that had OCCURRED by
   * `asOf` — not the `resulting` block of the last one, since a movement
   * written later can be dated earlier (sync-paper) and the resulting block
   * is the level when it was written. Each lot is valued at the cost of its
   * last movement among those, as the trigger values the live stock, so the
   * sum at an instant after the last movement equals the live levels.
   * `sequence` is the newest movement included. The log starts at the
   * opening balance, so an earlier instant throws `HistoryUnavailableError`.
   */
  async levels(asOf?: Date) {
    const now = new Date();
    if (!asOf || asOf >= now) {
      const { sequence, rows } = await this.prisma.$transaction(
        async (tx) => ({ sequence: await headSequence(tx), rows: await this.liveLevels(tx) }),
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      return this.levelsBody(now, sequence, rows);
    }

    const first = await this.prisma.stockEvent.findFirst({
      orderBy: { occurredAt: "asc" },
      select: { occurredAt: true },
    });
    if (first && asOf < first.occurredAt) throw new HistoryUnavailableError(first.occurredAt);

    const rows = await this.prisma.$queryRaw<(LevelRow & { sequence: string })[]>`
      WITH moved AS (
        SELECT * FROM "StockEvent"
         WHERE "type" = 'MOVEMENT'
           AND "occurredAt" <= (${asOf.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      ), lots AS (
        SELECT "sku", "lotId",
               sum(round("quantity"::numeric, 3)) AS kg,
               sum(round("metres"::numeric, 3)) AS m,
               (array_agg("unitCost" ORDER BY "sequence" DESC))[1]::numeric AS cost
          FROM moved
         GROUP BY "sku", "lotId"
      ), names AS (
        SELECT DISTINCT ON ("sku") "sku", "paperType", "grammage", "laizeMm"
          FROM moved
         ORDER BY "sku", "sequence" DESC
      ), skus AS (
        SELECT "sku", sum(kg) AS quantity, sum(m) AS metres,
               sum(round(kg * cost, 3)) AS value,
               count(*) FILTER (WHERE kg <> 0)::integer AS lots
          FROM lots
         GROUP BY "sku"
      )
      SELECT s."sku", n."paperType", n."grammage", n."laizeMm",
             s.quantity::numeric(18, 3)::text AS "quantity",
             s.metres::numeric(18, 3)::text AS "metres",
             (CASE WHEN s.quantity > 0 THEN round(s.value / s.quantity, 6) ELSE 0 END)
               ::numeric(18, 6)::text AS "unitCost",
             s.value::numeric(18, 3)::text AS "totalValue",
             s.lots AS "lots",
             (SELECT max("sequence") FROM moved)::text AS "sequence"
        FROM skus s
        JOIN names n ON n."sku" = s."sku"
       ORDER BY 1`;
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

  /**
   * `lastEventAt` is when the newest event was written: with the daily
   * snapshot it is never more than a day old, so an older one means the
   * feed has stalled rather than gone quiet.
   */
  async health() {
    const [lastSequence, last] = await Promise.all([
      headSequence(this.prisma),
      this.prisma.stockEvent.findFirst({
        orderBy: { sequence: "desc" },
        select: { recordedAt: true },
      }),
    ]);
    const now = new Date().toISOString();
    return {
      ok: true,
      time: now,
      asOf: now,
      lastSequence,
      lastEventAt: last?.recordedAt.toISOString() ?? null,
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
          recordedAt: asOf,
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

  /**
   * The contract's envelopes for a page of events — pulled and pushed
   * alike. A movement's lot and order are looked up for the whole page at
   * once (`StockReferenceService.movementPayload`).
   */
  async envelopes(rows: readonly StockEventRow[]) {
    const fields = rows.flatMap((row) => (row.type === "MOVEMENT" ? [movementFields(row)] : []));
    const lookups = await this.reference.lookups(this.prisma, fields);
    return rows.map((row) => {
      const base = {
        eventId: row.eventId,
        eventType: row.type === "SNAPSHOT" ? "stock.snapshot" : "stock.movement",
        schemaVersion: SCHEMA_VERSION,
        tenantRef: TENANT_REF,
        sequence: Number(row.sequence),
        occurredAt: row.occurredAt.toISOString(),
      };
      if (row.type === "SNAPSHOT") return { ...base, payload: row.payload };

      const quantity = row.resultingQuantity ?? 0;
      const value = row.resultingValue ?? 0;
      return {
        ...base,
        payload: {
          ...this.reference.movementPayload(movementFields(row), lookups),
          resulting: {
            quantity: decimal3(quantity),
            avgCost: decimal6(quantity > 0 ? value / quantity : 0),
            totalValue: decimal3(value),
          },
        },
      };
    });
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
               round("metrageRestant"::numeric, 3) AS m,
               COALESCE("price", 0)::numeric AS price
          FROM "PaperRoll"
         WHERE "receivedAt" IS NOT NULL AND NOT "consomme" AND NOT "archived"
      ), live AS (
        SELECT sku, min("paperType") AS "paperType", min("grammage") AS "grammage",
               min("laizeMm") AS "laizeMm", sum(kg) AS quantity, sum(m) AS metres,
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
             COALESCE(l.metres, 0)::numeric(18, 3)::text AS "metres",
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
      metres: row.metres,
      unitCost: row.unitCost,
      totalValue: row.totalValue,
      currency: CURRENCY,
      asOf: at,
      product: { name: productName(row.paperType, row.grammage, row.laizeMm), unit: UNIT },
      lots: row.lots,
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

/** A logged movement's own facts, for `movementPayload`. */
function movementFields(row: StockEventRow): MovementFields {
  return {
    movementId: String(row.sequence),
    type: row.movementType ?? "ADJUSTMENT",
    occurredAt: row.occurredAt,
    recordedAt: row.recordedAt,
    sku: row.sku,
    paperType: row.paperType,
    grammage: row.grammage,
    laizeMm: row.laizeMm,
    lotId: row.lotId,
    lotNumber: row.lotNumber,
    quantity: row.quantity ?? 0,
    metres: row.metres ?? 0,
    unitCost: row.unitCost ?? 0,
    sourceType: row.sourceType,
    sourceNumber: row.sourceNumber,
  };
}
