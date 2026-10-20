import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { OrderStatus, type PaperType, type QuantityUnit } from "../generated/prisma/enums.js";
import { PrismaService } from "../prisma.service";
import {
  CURRENCY,
  OPEN_ORDER_STATUSES,
  RECEIPT_SOURCE,
  SCHEMA_VERSION,
  TENANT_REF,
  UNIT,
  VALUATION_METHOD,
  WAREHOUSE,
  adjustmentReason,
  decimal3,
  decimal6,
  historyEventId,
  productName,
  productionStatus,
  sourceDocumentType,
  sumDecimal3,
  tunisDay,
  type ProductionStatus,
} from "./stock-api.contract";

type Db = Prisma.TransactionClient;

/** A supplier or customer as BICA Expert matches it to its own contacts. */
export interface Partner {
  role: "SUPPLIER" | "CUSTOMER";
  /** Our id for the company. There is no other code here. */
  code: string;
  name: string;
  /** Matricule fiscal, when it was entered. */
  taxId: string | null;
}

interface LotInfo {
  receivedAt: string | null;
  supplier: Partner | null;
  shipment: { number: string; date: string | null } | null;
}

/** An order that consumed paper, as BICA Expert's production order. */
export interface ProductionOrderBlock {
  number: string;
  manufacturingOrder: string | null;
  /** Null for a number that is not an order here. */
  status: ProductionStatus | null;
  startedAt: string | null;
  completedAt: string | null;
  /** The product made. Finished goods are not stocked here, so this is our product id. */
  outputSku: string | null;
  outputName: string | null;
  outputQuantity: string | null;
  outputUnit: QuantityUnit | null;
  customer: Partner | null;
}

/** One movement's own facts, from the log or reconstructed. */
export interface MovementFields {
  movementId: string | null;
  type: string;
  occurredAt: Date;
  recordedAt: Date | null;
  sku: string | null;
  paperType: PaperType | null;
  grammage: number | null;
  laizeMm: number | null;
  lotId: string | null;
  lotNumber: string | null;
  quantity: number;
  /** Null where no length was recorded (the old app's allocations). */
  metres: number | null;
  unitCost: number;
  sourceType: string | null;
  sourceNumber: string | null;
}

/** What a page of movements needs to know about its lots and orders. */
export interface Lookups {
  lots: Map<string, LotInfo>;
  orders: Map<string, ProductionOrderBlock>;
}

const LOT_SELECT = {
  id: true,
  receivedAt: true,
  receivedById: true,
  importShipment: {
    select: {
      numeroImport: true,
      dateImport: true,
      supplier: { select: { id: true, name: true, taxId: true } },
    },
  },
} satisfies Prisma.PaperRollSelect;

type LotRoll = Prisma.PaperRollGetPayload<{ select: typeof LOT_SELECT }>;

/**
 * A day on which the old app marked this many reels used up or more was a
 * clean-up, not a day of production — see `history`.
 */
const CLEANUP_REELS_PER_DAY = 25;

const ORDER_SELECT = {
  id: true,
  numero: true,
  status: true,
  quantite: true,
  quantityUnit: true,
  product: { select: { id: true, name: true } },
  client: { select: { id: true, name: true, taxId: true } },
  manufacturingOrder: { select: { numero: true } },
  // Only the moves a person made: the importers' rows (no user) carry the
  // day of the import, not of the order.
  statusChanges: {
    where: { byUserId: { not: null } },
    orderBy: [{ at: "asc" }, { id: "asc" }],
    select: { fromStatus: true, toStatus: true, at: true },
  },
} satisfies Prisma.OrderSelect;

type OrderRow = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

const isOpen = (status: OrderStatus) => OPEN_ORDER_STATUSES.includes(status);

/** The order statuses behind one production status. */
function orderStatusesFor(status: ProductionStatus): OrderStatus[] {
  return Object.values(OrderStatus).filter((value) => productionStatus(value) === status);
}

function earliest(...dates: (Date | null | undefined)[]): Date | null {
  const known = dates.filter((date): date is Date => date instanceof Date);
  return known.length ? new Date(Math.min(...known.map((date) => date.getTime()))) : null;
}

function latest(...dates: (Date | null | undefined)[]): Date | null {
  const known = dates.filter((date): date is Date => date instanceof Date);
  return known.length ? new Date(Math.max(...known.map((date) => date.getTime()))) : null;
}

/**
 * The day a lot arrived. A reel someone scanned in arrived at the scan; one
 * that was not — stamped at the receiving cutover, or copied from the old
 * app, both of which carry that moment rather than the arrival — arrived
 * with its shipment. A cut piece carries its mother's receipt, so it ages
 * from the mother's arrival.
 */
function arrivalDay(receivedAt: Date | null, scanned: boolean, shipmentDay: Date | null) {
  return tunisDay(scanned || !shipmentDay ? receivedAt : shipmentDay);
}

function lotInfoOf(roll: LotRoll): LotInfo {
  const shipment = roll.importShipment;
  return {
    receivedAt: arrivalDay(roll.receivedAt, roll.receivedById !== null, shipment?.dateImport ?? null),
    supplier: shipment
      ? {
          role: "SUPPLIER",
          code: shipment.supplier.id,
          name: shipment.supplier.name,
          taxId: shipment.supplier.taxId || null,
        }
      : null,
    shipment: shipment ? { number: shipment.numeroImport, date: tunisDay(shipment.dateImport) } : null,
  };
}

/** The last sequence handed out: the newest event, committed or about to be. */
export async function headSequence(db: Db): Promise<number> {
  const head = await db.stockEventCounter.findUnique({ where: { id: 1 }, select: { last: true } });
  return Number(head?.last ?? 0);
}

interface Page {
  page: number;
  pageSize: number;
}

interface LotRow {
  id: string;
  numero: string | null;
  sku: string;
  state: "ON_HAND" | "USED_UP" | "ARCHIVED";
  quantity: string;
  metres: string;
  unitCost: string;
  totalValue: string;
  receivedAt: Date | null;
  scanned: boolean;
  parentId: string | null;
  numeroImport: string | null;
  dateImport: Date | null;
  supplierId: string | null;
  supplierName: string | null;
}

interface IssueRow {
  number: string;
  sku: string;
  quantity: string;
  metres: string | null;
  occurredAt: Date;
  movementId: string | null;
  lotId: string;
  lotNumber: string | null;
}

interface HistoryRow {
  key: string;
  type: string;
  occurredAt: Date;
  lotId: string;
  lotNumber: string | null;
  paperType: PaperType | null;
  grammage: number | null;
  laizeMm: number | null;
  sku: string;
  quantity: number;
  metres: number | null;
  unitCost: number;
  sourceType: string | null;
  sourceNumber: string | null;
}

/**
 * What BICA Expert reads beside the movement log — docs/erp-stock-api.md
 * §9: the lots on hand, the partners behind them, the orders that consumed
 * paper, and the history from before the log began. Also the one place a
 * movement is described (`movementPayload`), so a pulled, pushed or
 * reconstructed movement carries the same fields.
 *
 * Read-only. The lot and order facts on a movement are read when it is
 * served, not frozen with it: a shipment's supplier corrected later reads
 * corrected on every movement, and an order's status is its status now.
 */
@Injectable()
export class StockReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  /** The lots and orders a set of movements names, in two queries each. */
  async lookups(db: Db, movements: readonly MovementFields[]): Promise<Lookups> {
    const lotIds = [...new Set(movements.flatMap((row) => (row.lotId ? [row.lotId] : [])))];
    const numbers = [
      ...new Set(
        movements.flatMap((row) =>
          row.sourceType === "PRODUCTION_ORDER" && row.sourceNumber ? [row.sourceNumber] : [],
        ),
      ),
    ];
    const [lots, orders] = await Promise.all([
      this.lotInfo(db, lotIds),
      this.productionOrders(db, numbers),
    ]);
    return { lots, orders };
  }

  /** The contract's movement payload, without the `resulting` block. */
  movementPayload(row: MovementFields, { lots, orders }: Lookups) {
    const lot = row.lotId ? lots.get(row.lotId) : undefined;
    const documentType = row.sourceType ? sourceDocumentType(row.sourceType) : null;
    const receipt = row.type === "RECEIPT";
    return {
      movementId: row.movementId,
      type: row.type,
      occurredAt: row.occurredAt.toISOString(),
      recordedAt: row.recordedAt?.toISOString() ?? null,
      product: {
        sku: row.sku,
        name: productName(row.paperType, row.grammage, row.laizeMm),
        unit: UNIT,
      },
      warehouse: WAREHOUSE,
      lot: row.lotId
        ? {
            id: row.lotId,
            number: row.lotNumber,
            receivedAt: lot?.receivedAt ?? null,
            unitCost: decimal6(row.unitCost),
            supplierCode: lot?.supplier?.code ?? null,
          }
        : null,
      quantity: decimal3(row.quantity),
      metres: row.metres === null ? null : decimal3(row.metres),
      unitCost: decimal6(row.unitCost),
      currency: CURRENCY,
      valuationMethod: VALUATION_METHOD,
      reason: adjustmentReason(row.type, row.sourceType, row.quantity),
      sourceDocument: documentType
        ? {
            type: documentType,
            number: row.sourceNumber,
            date: documentType === RECEIPT_SOURCE ? (lot?.shipment?.date ?? null) : null,
          }
        : null,
      partner: receipt ? (lot?.supplier ?? null) : null,
      productionOrder:
        row.sourceType === "PRODUCTION_ORDER" && row.sourceNumber
          ? (orders.get(row.sourceNumber) ?? unknownOrder(row.sourceNumber))
          : null,
    };
  }

  // ---- /stock/lots ---------------------------------------------------------

  /**
   * Every lot on hand (or every lot ever received), summed in one snapshot
   * with the counter like the live levels: the lots of a SKU add up to its
   * level, and `sequence` names the last movement they include.
   */
  async lots(query: Page & { sku?: string; warehouseCode?: string; onHandOnly: boolean }) {
    const offset = (query.page - 1) * query.pageSize;
    const sku = query.sku ?? null;
    const { sequence, total, rows } = await this.prisma.$transaction(
      async (tx) => {
        const sequence = await headSequence(tx);
        if (query.warehouseCode && query.warehouseCode !== WAREHOUSE.code) {
          return { sequence, total: 0, rows: [] as LotRow[] };
        }
        const [counted] = await tx.$queryRaw<{ total: number }[]>`
          SELECT count(*)::integer AS total
            FROM "PaperRoll" r
           WHERE r."receivedAt" IS NOT NULL
             AND (NOT ${query.onHandOnly}::boolean OR (NOT r."consomme" AND NOT r."archived"))
             AND (${sku}::text IS NULL OR paper_stock_sku(r."paperType", r."grammage", r."laize") = ${sku}::text)`;
        const rows = await tx.$queryRaw<LotRow[]>`
          WITH reels AS (
            SELECT r.*, paper_stock_sku(r."paperType", r."grammage", r."laize") AS sku,
                   (NOT r."consomme" AND NOT r."archived") AS on_hand
              FROM "PaperRoll" r
             WHERE r."receivedAt" IS NOT NULL
          )
          SELECT r."id", r."numero", r.sku,
                 (CASE WHEN r.on_hand THEN 'ON_HAND' WHEN r."archived" THEN 'ARCHIVED' ELSE 'USED_UP' END)
                   AS "state",
                 (CASE WHEN r.on_hand THEN round(r."poidsRestant"::numeric, 3) ELSE 0 END)
                   ::numeric(18, 3)::text AS "quantity",
                 (CASE WHEN r.on_hand THEN round(r."metrageRestant"::numeric, 3) ELSE 0 END)
                   ::numeric(18, 3)::text AS "metres",
                 round(COALESCE(r."price", 0)::numeric, 6)::numeric(18, 6)::text AS "unitCost",
                 (CASE WHEN r.on_hand
                       THEN round(round(r."poidsRestant"::numeric, 3) * COALESCE(r."price", 0)::numeric, 3)
                       ELSE 0 END)::numeric(18, 3)::text AS "totalValue",
                 r."receivedAt", r."receivedById" IS NOT NULL AS "scanned", r."parentId",
                 s."numeroImport", s."dateImport", sup."id" AS "supplierId", sup."name" AS "supplierName"
            FROM reels r
            LEFT JOIN "ImportShipment" s ON s."id" = r."importShipmentId"
            LEFT JOIN "Supplier" sup ON sup."id" = s."supplierId"
           WHERE (NOT ${query.onHandOnly}::boolean OR r.on_hand)
             AND (${sku}::text IS NULL OR r.sku = ${sku}::text)
           ORDER BY r.sku, r."id"
           LIMIT ${query.pageSize}::integer OFFSET ${offset}::integer`;
        return { sequence, total: counted?.total ?? 0, rows };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    return {
      asOf: new Date().toISOString(),
      currency: CURRENCY,
      sequence,
      total,
      page: query.page,
      pageSize: query.pageSize,
      lots: rows.map((row) => ({
        id: row.id,
        number: row.numero,
        sku: row.sku,
        warehouseCode: WAREHOUSE.code,
        state: row.state,
        quantity: row.quantity,
        metres: row.metres,
        unit: UNIT,
        unitCost: row.unitCost,
        totalValue: row.totalValue,
        currency: CURRENCY,
        receivedAt: arrivalDay(row.receivedAt, row.scanned, row.dateImport),
        supplierCode: row.supplierId,
        supplierName: row.supplierName,
        sourceDocument: row.numeroImport
          ? { type: RECEIPT_SOURCE, number: row.numeroImport, date: tunisDay(row.dateImport) }
          : null,
        parentLotId: row.parentId,
      })),
    };
  }

  // ---- /partners -----------------------------------------------------------

  /**
   * The suppliers paper comes from (an import shipment or a paper purchase
   * order) and the customers orders are made for. `leadTimeDays` is the
   * median of the days from a paper purchase order to its goods receipt;
   * receipts dated before their order are typing errors and are left out.
   */
  async partners(role?: Partner["role"]) {
    const [suppliers, customers, leadTimes] = await Promise.all([
      role === "CUSTOMER"
        ? []
        : this.prisma.supplier.findMany({
            where: {
              OR: [
                { shipments: { some: {} } },
                { purchaseOrders: { some: { category: "PAPER" } } },
              ],
            },
            orderBy: [{ name: "asc" }, { id: "asc" }],
            select: { id: true, name: true, taxId: true, address: true, active: true },
          }),
      role === "SUPPLIER"
        ? []
        : this.prisma.client.findMany({
            where: { orders: { some: { kind: "ORDER" } } },
            orderBy: [{ name: "asc" }, { id: "asc" }],
            select: { id: true, name: true, taxId: true, address: true, active: true },
          }),
      this.prisma.$queryRaw<{ supplierId: string; days: number; samples: number }[]>`
        SELECT o."supplierId",
               round(percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY (r."receivedAt" - o."issuedAt")::double precision
               ))::integer AS "days",
               count(*)::integer AS "samples"
          FROM "GoodsReceipt" r
          JOIN "PurchaseOrder" o ON o."id" = r."orderId"
         WHERE o."category" = 'PAPER' AND r."receivedAt" IS NOT NULL
           AND r."receivedAt" >= o."issuedAt"
         GROUP BY o."supplierId"`,
    ]);
    const lead = new Map(leadTimes.map((row) => [row.supplierId, row]));
    const row = (
      partnerRole: Partner["role"],
      company: { id: string; name: string; taxId: string | null; address: string | null; active: boolean },
    ) => ({
      code: company.id,
      role: partnerRole,
      name: company.name,
      taxId: company.taxId || null,
      address: company.address || null,
      active: company.active,
      leadTimeDays: lead.get(company.id)?.days ?? null,
      leadTimeSamples: lead.get(company.id)?.samples ?? 0,
    });
    return {
      partners: [
        ...suppliers.map((company) => row("SUPPLIER", company)),
        ...customers.map((company) => row("CUSTOMER", company)),
      ],
    };
  }

  // ---- /production/orders --------------------------------------------------

  /**
   * The orders that consumed paper, with what each consumed: the log's
   * PRODUCTION_ORDER movements, and before the log began the consumed
   * allocations — so paper consumed before go-live for an order still in
   * production counts as work in progress from the first day. An allocation
   * whose lot and order have a logged movement is the log's.
   */
  async productionOrderList(query: Page & { status?: ProductionStatus }) {
    const logged = await this.prisma.stockEvent.findMany({
      where: { sourceType: "PRODUCTION_ORDER", sourceNumber: { not: null } },
      distinct: ["sourceNumber"],
      select: { sourceNumber: true },
    });
    const where: Prisma.OrderWhereInput = {
      OR: [
        { allocations: { some: { state: "CONSUMED" } } },
        { numero: { in: logged.flatMap((row) => (row.sourceNumber ? [row.sourceNumber] : [])) } },
      ],
      ...(query.status ? { status: { in: orderStatusesFor(query.status) } } : {}),
    };
    const [total, page] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: { numero: true },
      }),
    ]);
    const numbers = page.map((row) => row.numero);
    const [blocks, issued] = await Promise.all([
      this.productionOrders(this.prisma, numbers),
      this.issued(numbers),
    ]);

    return {
      asOf: new Date().toISOString(),
      total,
      page: query.page,
      pageSize: query.pageSize,
      orders: numbers.flatMap((number) => {
        const block = blocks.get(number);
        if (!block) return [];
        const lines = (issued.get(number) ?? []).map((line) => ({
          sku: line.sku,
          quantity: line.quantity,
          metres: line.metres,
          unit: UNIT,
          occurredAt: line.occurredAt.toISOString(),
          movementId: line.movementId,
          lot: { id: line.lotId, number: line.lotNumber },
        }));
        return [
          {
            ...block,
            issuedQuantity: sumDecimal3(lines.map((line) => line.quantity)),
            issued: lines,
            // Finished goods are not stocked here: nothing enters stock.
            produced: [],
          },
        ];
      }),
    };
  }

  /** The paper each order consumed, oldest first. */
  private async issued(numbers: string[]): Promise<Map<string, IssueRow[]>> {
    const byOrder = new Map<string, IssueRow[]>();
    if (numbers.length === 0) return byOrder;
    const start = (await this.logStart()).toISOString();
    const rows = await this.prisma.$queryRaw<IssueRow[]>`
      SELECT e."sourceNumber" AS "number", e."sku",
             (-round(e."quantity"::numeric, 3))::numeric(18, 3)::text AS "quantity",
             (-round(e."metres"::numeric, 3))::numeric(18, 3)::text AS "metres",
             e."occurredAt", e."sequence"::text AS "movementId",
             e."lotId", e."lotNumber"
        FROM "StockEvent" e
       WHERE e."type" = 'MOVEMENT' AND e."sourceType" = 'PRODUCTION_ORDER'
         AND e."sourceNumber" = ANY(${numbers}::text[])
      UNION ALL
      SELECT o."numero", paper_stock_sku(r."paperType", r."grammage", r."laize"),
             round(a."poidsReserve"::numeric, 3)::numeric(18, 3)::text,
             round(a."metrageReserve"::numeric, 3)::numeric(18, 3)::text,
             a."dateConsommation", NULL, r."id", r."numero"
        FROM "RollAllocation" a
        JOIN "Order" o ON o."id" = a."orderId"
        JOIN "PaperRoll" r ON r."id" = a."paperRollId"
       WHERE a."state" = 'CONSUMED'
         AND a."dateConsommation" < (${start}::timestamptz AT TIME ZONE 'UTC')
         AND o."numero" = ANY(${numbers}::text[])
         -- Consumed in the old app before go-live but synced after it: the
         -- log has it, at the opening, so the allocation must not count it twice.
         AND NOT EXISTS (SELECT 1 FROM "StockEvent" e
                          WHERE e."lotId" = a."paperRollId" AND e."sourceType" = 'PRODUCTION_ORDER'
                            AND e."sourceNumber" = o."numero")
       ORDER BY 5, 7`;
    for (const row of rows) {
      const list = byOrder.get(row.number) ?? [];
      list.push(row);
      byOrder.set(row.number, list);
    }
    return byOrder;
  }

  /** Orders by number as production orders. An unknown number is absent. */
  async productionOrders(db: Db, numbers: string[]): Promise<Map<string, ProductionOrderBlock>> {
    const blocks = new Map<string, ProductionOrderBlock>();
    if (numbers.length === 0) return blocks;
    const orders = await db.order.findMany({ where: { numero: { in: numbers } }, select: ORDER_SELECT });
    const ids = orders.map((order) => order.id);
    const [consumed, runs] = await Promise.all([
      db.rollAllocation.groupBy({
        by: ["orderId"],
        where: { orderId: { in: ids }, state: "CONSUMED" },
        _min: { dateConsommation: true },
        _max: { dateConsommation: true },
      }),
      db.productionRun.groupBy({
        by: ["orderId"],
        where: { orderId: { in: ids } },
        _min: { dateProduction: true },
        _max: { dateProduction: true },
      }),
    ]);
    const consumedBy = new Map(consumed.map((row) => [row.orderId, row]));
    const runsBy = new Map(runs.map((row) => [row.orderId, row]));

    for (const order of orders) {
      const used = consumedBy.get(order.id);
      const run = runsBy.get(order.id);
      const { startedAt, completedAt } = orderDates(order, {
        first: earliest(used?._min.dateConsommation, run?._min.dateProduction),
        last: latest(used?._max.dateConsommation, run?._max.dateProduction),
      });
      blocks.set(order.numero, {
        number: order.numero,
        manufacturingOrder: order.manufacturingOrder?.numero ?? null,
        status: productionStatus(order.status),
        startedAt: tunisDay(startedAt),
        completedAt: tunisDay(completedAt),
        outputSku: order.product.id,
        outputName: order.product.name,
        outputQuantity: decimal3(order.quantite),
        outputUnit: order.quantityUnit,
        customer: order.client
          ? {
              role: "CUSTOMER",
              code: order.client.id,
              name: order.client.name,
              taxId: order.client.taxId || null,
            }
          : null,
      });
    }
    return blocks;
  }

  // ---- /stock/history ------------------------------------------------------

  /**
   * The paper's movements before the log began, rebuilt from what the
   * records kept — receipts and consumption only, outside the sequence. It
   * is already inside the opening balance, so it describes the past and
   * must never be added to a running balance. Approximate by nature:
   *
   *   - RECEIPT: every reel that came off a shipment (a cut piece is part of
   *     its mother's receipt), at its lot's reception, at its first weight;
   *   - PRODUCTION_OUT on an order: every consumed allocation, on its date;
   *   - PRODUCTION_OUT without an allocation: what a used-up or archived
   *     reel lost beyond its pieces and its allocations, on the day it was
   *     marked used up — most of the old app's consumption, which it
   *     recorded by archiving the reel. The order is named when the reel's
   *     note is exactly an order number (PRODUCTION_ORDER), else USED_UP.
   *     On a day the old app marked `CLEANUP_REELS_PER_DAY` reels or more
   *     used up, the date is a clean-up of reels used earlier, not when the
   *     paper went (313 reels on 24 Mar 2026, 109 on 23 Apr, 49 on 14 Feb
   *     and 23 Mar; no real day reaches 12): such a row is OLD_APP_CLEANUP.
   *
   * A lot the log already covers is left out of the part the log covers: a
   * reel the log received has no history receipt, an allocation whose lot
   * and order have a logged PRODUCTION_OUT has no history consumption, and
   * a reel with any logged movement has no row of the third kind.
   */
  async history(query: Page & { since?: Date; until?: Date }) {
    const start = await this.logStart();
    const since = query.since?.toISOString() ?? null;
    const until = query.until?.toISOString() ?? null;
    const dated = Prisma.sql`
      WITH cleanup_days AS (
        SELECT "dateConsommation"::date AS "day"
          FROM "PaperRoll"
         WHERE ("consomme" OR "archived") AND "dateConsommation" IS NOT NULL
         GROUP BY 1
        HAVING count(*) >= ${CLEANUP_REELS_PER_DAY}::integer
      ), receipts AS (
        SELECT 'receipt:' || r."id" AS "key", 'RECEIPT' AS "type",
               (CASE WHEN r."receivedById" IS NOT NULL OR s."dateImport" IS NULL THEN r."receivedAt"
                     -- A day, placed at noon in Tunis so no zone moves it to another day.
                     ELSE s."dateImport" + interval '11 hours' END) AS "occurredAt",
               r."id" AS "lotId", round(r."poids"::numeric, 3) AS "kg",
               round(r."metrage"::numeric, 3) AS "m",
               'SUPPLIER_DELIVERY' AS "sourceType", s."numeroImport" AS "sourceNumber"
          FROM "PaperRoll" r
          JOIN "ImportShipment" s ON s."id" = r."importShipmentId"
         WHERE r."parentId" IS NULL AND r."receivedAt" IS NOT NULL AND r."poids" > 0
           AND NOT EXISTS (SELECT 1 FROM "StockEvent" e
                            WHERE e."lotId" = r."id" AND e."movementType" = 'RECEIPT')
      ), allocated AS (
        SELECT 'consume:' || a."id" AS "key", 'PRODUCTION_OUT' AS "type",
               a."dateConsommation" AS "occurredAt", a."paperRollId" AS "lotId",
               -round(a."poidsReserve"::numeric, 3) AS "kg",
               -round(a."metrageReserve"::numeric, 3) AS "m",
               'PRODUCTION_ORDER' AS "sourceType", o."numero" AS "sourceNumber"
          FROM "RollAllocation" a
          JOIN "Order" o ON o."id" = a."orderId"
         WHERE a."state" = 'CONSUMED' AND a."dateConsommation" IS NOT NULL AND a."poidsReserve" > 0
           AND NOT EXISTS (SELECT 1 FROM "StockEvent" e
                            WHERE e."lotId" = a."paperRollId" AND e."movementType" = 'PRODUCTION_OUT'
                              AND e."sourceType" = 'PRODUCTION_ORDER' AND e."sourceNumber" = o."numero")
      ), used_up AS (
        SELECT r."id", r."dateConsommation", r."poids", r."metrage", o."numero" AS "orderNumero",
               EXISTS (SELECT 1 FROM cleanup_days d WHERE d."day" = r."dateConsommation"::date) AS "cleanup",
               round(r."poids"::numeric, 3)
                 - COALESCE((SELECT sum(round(c."poids"::numeric, 3)) FROM "PaperRoll" c
                              WHERE c."parentId" = r."id" AND c."poids" > 0), 0)
                 - COALESCE((SELECT sum(round(a."poidsReserve"::numeric, 3)) FROM "RollAllocation" a
                              WHERE a."paperRollId" = r."id" AND a."state" = 'CONSUMED'), 0) AS "kg"
          FROM "PaperRoll" r
          LEFT JOIN "Order" o ON o."numero" = btrim(r."consumedByNote")
         WHERE (r."consomme" OR r."archived") AND r."receivedAt" IS NOT NULL
           AND r."dateConsommation" IS NOT NULL AND r."poids" > 0
           AND NOT EXISTS (SELECT 1 FROM "StockEvent" e WHERE e."lotId" = r."id")
      ), unexplained AS (
        SELECT 'used-up:' || u."id" AS "key", 'PRODUCTION_OUT' AS "type",
               u."dateConsommation" AS "occurredAt", u."id" AS "lotId", -u."kg" AS "kg",
               -(CASE WHEN u."metrage" > 0 THEN round(u."kg" * u."metrage"::numeric / u."poids"::numeric, 3)
                      END) AS "m",
               (CASE WHEN u."cleanup" THEN 'OLD_APP_CLEANUP'
                     WHEN u."orderNumero" IS NULL THEN 'USED_UP'
                     ELSE 'PRODUCTION_ORDER' END) AS "sourceType",
               (CASE WHEN u."cleanup" THEN NULL ELSE u."orderNumero" END) AS "sourceNumber"
          FROM used_up u
         -- Half a kilogram: below it the difference is the old app's rounding.
         WHERE u."kg" > 0.5
      ), everything AS (
        SELECT * FROM receipts UNION ALL SELECT * FROM allocated UNION ALL SELECT * FROM unexplained
      ), dated AS (
        SELECT h.* FROM everything h
         WHERE h."occurredAt" < (${start.toISOString()}::timestamptz AT TIME ZONE 'UTC')
           AND (${since}::timestamptz IS NULL
                OR h."occurredAt" >= (${since}::timestamptz AT TIME ZONE 'UTC'))
           AND (${until}::timestamptz IS NULL
                OR h."occurredAt" <= (${until}::timestamptz AT TIME ZONE 'UTC'))
      )`;

    const [[totals], rows] = await Promise.all([
      this.prisma.$queryRaw<{ total: number; received: string; consumed: string }[]>`
        ${dated}
        SELECT count(*)::integer AS "total",
               COALESCE(sum("kg") FILTER (WHERE "kg" > 0), 0)::numeric(18, 3)::text AS "received",
               COALESCE(-sum("kg") FILTER (WHERE "kg" < 0), 0)::numeric(18, 3)::text AS "consumed"
          FROM dated`,
      this.prisma.$queryRaw<HistoryRow[]>`
        ${dated}
        SELECT d."key", d."type", d."occurredAt", d."lotId", r."numero" AS "lotNumber",
               r."paperType", r."grammage", round(r."laize")::integer AS "laizeMm",
               paper_stock_sku(r."paperType", r."grammage", r."laize") AS "sku",
               d."kg"::double precision AS "quantity", d."m"::double precision AS "metres",
               COALESCE(r."price", 0) AS "unitCost", d."sourceType", d."sourceNumber"
          FROM dated d
          JOIN "PaperRoll" r ON r."id" = d."lotId"
         ORDER BY d."occurredAt", d."key"
         LIMIT ${query.pageSize}::integer OFFSET ${(query.page - 1) * query.pageSize}::integer`,
    ]);

    const fields = rows.map(
      (row): MovementFields => ({
        movementId: null,
        type: row.type,
        occurredAt: row.occurredAt,
        recordedAt: null,
        sku: row.sku,
        paperType: row.paperType,
        grammage: row.grammage,
        laizeMm: row.laizeMm,
        lotId: row.lotId,
        lotNumber: row.lotNumber,
        quantity: row.quantity,
        metres: row.metres,
        unitCost: row.unitCost,
        sourceType: row.sourceType,
        sourceNumber: row.sourceNumber,
      }),
    );
    const lookups = await this.lookups(this.prisma, fields);

    return {
      historyEndsAt: start.toISOString(),
      reconstructed: true,
      currency: CURRENCY,
      total: totals?.total ?? 0,
      receivedQuantity: totals?.received ?? "0.000",
      consumedQuantity: totals?.consumed ?? "0.000",
      page: query.page,
      pageSize: query.pageSize,
      movements: rows.map((row, index) => {
        const field = fields[index] as MovementFields;
        return {
          eventId: historyEventId(row.key),
          eventType: "stock.history",
          schemaVersion: SCHEMA_VERSION,
          tenantRef: TENANT_REF,
          sequence: null,
          occurredAt: row.occurredAt.toISOString(),
          payload: { ...this.movementPayload(field, lookups), historyId: row.key, resulting: null },
        };
      }),
    };
  }

  // ---- helpers -------------------------------------------------------------

  /** When the log began (the opening balance), or now while it is empty. */
  async logStart(): Promise<Date> {
    const first = await this.prisma.stockEvent.findFirst({
      orderBy: { occurredAt: "asc" },
      select: { occurredAt: true },
    });
    return first?.occurredAt ?? new Date();
  }

  private async lotInfo(db: Db, ids: string[]): Promise<Map<string, LotInfo>> {
    if (ids.length === 0) return new Map();
    const rolls = await db.paperRoll.findMany({ where: { id: { in: ids } }, select: LOT_SELECT });
    return new Map(rolls.map((roll) => [roll.id, lotInfoOf(roll)]));
  }
}

/**
 * When an order started and finished production. Started: the first move a
 * person made to IN_PRODUCTION, else its first consumption or production
 * day — the only dates a migrated order has. Finished: the last move from
 * an open status to a closed one, which began the order's current closed
 * spell, else its last production day or consumption; a migrated
 * cancellation has no date.
 */
function orderDates(order: OrderRow, activity: { first: Date | null; last: Date | null }) {
  const status = productionStatus(order.status);
  const startedAt =
    order.statusChanges.find((change) => change.toStatus === "IN_PRODUCTION")?.at ?? activity.first;
  if (status === "OPEN") return { startedAt, completedAt: null };
  const closing = order.statusChanges
    .filter(
      (change) =>
        !isOpen(change.toStatus) && (change.fromStatus === null || isOpen(change.fromStatus)),
    )
    .at(-1);
  return {
    startedAt,
    completedAt: closing?.at ?? (status === "COMPLETED" ? activity.last : null),
  };
}

/** A movement naming an order that is not here (a number from the old app). */
function unknownOrder(number: string): ProductionOrderBlock {
  return {
    number,
    manufacturingOrder: null,
    status: null,
    startedAt: null,
    completedAt: null,
    outputSku: null,
    outputName: null,
    outputQuantity: null,
    outputUnit: null,
    customer: null,
  };
}
