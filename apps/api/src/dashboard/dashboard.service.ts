import { Injectable } from "@nestjs/common";
import {
  ORDER_STATUSES,
  SHIFT_TYPES,
  inkStockState,
  plantDay,
  utcDay,
  weekStartOf,
  type OrderStatus,
  type ShiftType,
} from "@repo/api-contract";
import type { Prisma } from "../generated/prisma/client.js";
import { ON_ROSTER_WHERE } from "../employee/employee.list";
import { IN_STOCK_ROLL_WHERE } from "../inventory/inventory.list";
import { SALES_UNPAID_WHERE, UNPAID_WHERE, overdueWhere, salesOverdueWhere } from "../invoice/invoice.list";
import { sumByCurrency, type CurrencySum } from "../list/currency-sum";
import { todayUtc } from "../list/period";
import { PrismaService } from "../prisma.service";
import { ProductionService } from "../production/production.service";
import { orderAmount, orderState } from "../purchasing/purchasing.list";
import { PENDING_ROLL_WHERE, rollListDeclaration } from "../stock/stock.list";
import type { SessionUser } from "../trpc/trpc";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The super admin's home page: the plant's figures across every module, on
 * one snapshot — docs/dashboard-plan.md.
 *
 * Nothing here is a new definition. Each figure reuses the predicate or
 * helper its own module counts with (`IN_STOCK_ROLL_WHERE`, `orderState`,
 * `salesOverdueWhere`, ...), so a tile here equals the tile on that module's
 * page — the one property a dashboard has to keep. Where a module's rule is
 * judged in JS because Prisma cannot express it (a reel's reception state
 * from its lines, an ink against its own threshold), this scans the same
 * rows the module scans.
 *
 * Two "todays", on purpose: shifts run on plant time (`plantDay`), invoices
 * and orders on the UTC day their `@db.Date` columns are read as
 * (`todayUtc`). Each figure keeps its module's rule, and both dates are
 * returned so the page can label them.
 *
 * Polled every minute per open super admin tab, so the router exempts it
 * from the activity trace like `nav.counts` and `settings.summary`.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly production: ProductionService,
  ) {}

  async summary(actor: SessionUser) {
    const now = new Date();
    const today = todayUtc(now);
    const todayIso = today.toISOString().slice(0, 10);
    const month = todayIso.slice(0, 7);
    const year = today.getUTCFullYear();
    const monthWindow = {
      gte: new Date(Date.UTC(year, today.getUTCMonth(), 1)),
      lt: new Date(Date.UTC(year, today.getUTCMonth() + 1, 1)),
    };
    const yearWindow = { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) };
    // The page's range control (month / quarter / 12 months) picks among
    // these three; all end with the current month, like the production
    // trend, so an invoiced figure and a production figure read the same span.
    const quarterWindow = {
      gte: new Date(Date.UTC(year, Math.floor(today.getUTCMonth() / 3) * 3, 1)),
      lt: monthWindow.lt,
    };
    const trendFrom = monthsAgo(month, 11);
    const twelveMonthWindow = {
      gte: new Date(`${trendFrom}-01T00:00:00.000Z`),
      lt: monthWindow.lt,
    };

    const plantToday = plantDay(now);
    const weekStart = weekStartOf(plantToday);
    const weekStartDate = utcDay(weekStart);
    // The running shift and every shift that ended since this time
    // yesterday — NOT the shifts dated today: a shift's `date` is its start
    // day and the night shift starts at 22:00, so a calendar day would count
    // tonight's tickets (not begun) and drop the ones that ended at 06:00.
    const ticketWindow = {
      startsAt: { lte: now },
      endsAt: { gt: new Date(now.getTime() - DAY_MS) },
    } satisfies Prisma.ShiftWhereInput;

    const issuedIn = (issuedAt: { gte: Date; lt: Date }) =>
      this.prisma.salesInvoice.groupBy({
        by: ["currency"],
        where: { status: "ISSUED", issuedAt },
        _sum: { totalTtc: true },
        _count: { _all: true },
      });
    const salesWhere = (where: Prisma.SalesInvoiceWhereInput) =>
      this.prisma.salesInvoice.groupBy({
        by: ["currency"],
        where,
        _sum: { totalTtc: true },
        _count: { _all: true },
      });
    const purchasesWhere = (where: Prisma.PurchaseInvoiceWhereInput) =>
      this.prisma.purchaseInvoice.groupBy({
        by: ["currency"],
        where,
        _sum: { totalTtc: true },
        _count: { _all: true },
      });

    // One transaction so every figure describes the same instant; the
    // production trend is the one read outside it (a multi-step method
    // cannot be an element of a batch), and it is month-grained anyway.
    const [
      orderGroups,
      quotes,
      week,
      headcountGroups,
      unplaced,
      rosterSize,
      ticketGroups,
      missedTickets,
      pendingRequests,
      rolls,
      freeRolls,
      reservedRolls,
      inkRows,
      openStocktake,
      receivingPending,
      pendingReels,
      firstDelivery,
      salesMonth,
      salesQuarter,
      salesTwelveMonths,
      salesYear,
      salesUnpaid,
      salesOverdue,
      purchaseUnpaid,
      purchaseOverdue,
      purchaseOrders,
    ] = await this.prisma.$transaction([
      this.prisma.order.groupBy({
        by: ["status"],
        where: { active: true, kind: "ORDER" },
        _count: { _all: true },
      }),
      this.prisma.order.count({ where: { active: true, kind: "QUOTE" } }),
      this.prisma.shiftWeek.findUnique({
        where: { weekStart: weekStartDate },
        select: { id: true, status: true },
      }),
      // An assignee suspended or archived after the week was built is not
      // head count, and is not "unplaced" either.
      this.prisma.shiftAssignment.groupBy({
        by: ["type"],
        where: { week: { weekStart: weekStartDate }, employee: ON_ROSTER_WHERE },
        _count: { _all: true },
      }),
      // Counted directly, never `roster − Σ head count`: stale assignees
      // would make that wrong, or negative.
      this.prisma.employee.count({
        where: { ...ON_ROSTER_WHERE, assignments: { none: { week: { weekStart: weekStartDate } } } },
      }),
      this.prisma.employee.count({ where: ON_ROSTER_WHERE }),
      this.prisma.shiftTask.groupBy({
        by: ["status"],
        where: { shift: ticketWindow },
        _count: { _all: true },
      }),
      // `isTaskMissed` in SQL: open on a shift that has ended (inside the window).
      this.prisma.shiftTask.count({
        where: { status: "OPEN", shift: { ...ticketWindow, endsAt: { ...ticketWindow.endsAt, lt: now } } },
      }),
      this.prisma.shiftChange.count({ where: { status: "PENDING" } }),
      this.prisma.paperRoll.aggregate({
        where: IN_STOCK_ROLL_WHERE,
        _count: { _all: true },
        _sum: { poidsRestant: true },
      }),
      // The stock page's own `available` and `reserved` facets: they
      // partition the in-stock reels, so free + reserved = the total above.
      // NOT `RollAllocation.poidsReserve`: most RESERVED allocations are
      // legacy rows on reels long consumed (3 of 45 on live reels, 2026-09).
      this.prisma.paperRoll.aggregate({
        where: rollListDeclaration.facets.available,
        _count: { _all: true },
        _sum: { poidsRestant: true },
      }),
      this.prisma.paperRoll.aggregate({
        where: rollListDeclaration.facets.reserved,
        _count: { _all: true },
        _sum: { poidsRestant: true },
      }),
      // Every colour that could be low or out; judged below, because the
      // low rule compares two columns of the same row.
      this.prisma.inkColour.findMany({
        where: { active: true, OR: [{ stock: { lte: 0 } }, { alertThreshold: { not: null } }] },
        select: { stock: true, alertThreshold: true },
      }),
      // At most one is open (`InventoryService.open` refuses a second).
      this.prisma.stockCount.findFirst({
        where: { status: "OPEN" },
        select: {
          id: true,
          openedAt: true,
          expectedCount: true,
          labelledCount: true,
          // Scanned = counted lines, as the scan screen's progress reads it;
          // an unexpected reel is recorded but is not progress.
          _count: { select: { lines: { where: { unexpected: false } } } },
        },
      }),
      // Verbatim `StockService.receivingCount`.
      this.prisma.importShipment.count({
        where: { active: true, rolls: { some: PENDING_ROLL_WHERE } },
      }),
      this.prisma.paperRoll.count({
        where: { ...PENDING_ROLL_WHERE, importShipment: { active: true } },
      }),
      // Named on the page when it is the only one: "PEREVALLS 02-2026".
      this.prisma.importShipment.findFirst({
        where: { active: true, rolls: { some: PENDING_ROLL_WHERE } },
        select: { id: true, numeroImport: true, supplier: { select: { name: true } } },
        orderBy: [{ dateImport: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      }),
      issuedIn(monthWindow),
      issuedIn(quarterWindow),
      issuedIn(twelveMonthWindow),
      issuedIn(yearWindow),
      salesWhere(SALES_UNPAID_WHERE),
      salesWhere(salesOverdueWhere(today)),
      purchasesWhere(UNPAID_WHERE),
      purchasesWhere(overdueWhere(today)),
      // The reception state is line-derived (see `PurchasingService.orderFigures`
      // for why a scan is the only honest reading), so this reads every
      // order's lines — a few hundred small rows.
      this.prisma.purchaseOrder.findMany({
        select: {
          id: true,
          expectedAt: true,
          currency: true,
          totalHt: true,
          lines: { select: { quantity: true, receivedQuantity: true, total: true } },
        },
      }),
    ]);

    const production = await this.production.monthlyTotals(actor, { from: trendFrom, to: month });

    const byStatus = new Map(orderGroups.map((g) => [g.status as OrderStatus, g._count._all]));
    const headcount = new Map(headcountGroups.map((g) => [g.type as ShiftType, g._count._all]));
    const tickets = new Map(ticketGroups.map((g) => [g.status, g._count._all]));

    const inkStates = inkRows.map(inkStockState);

    const judgedOrders = purchaseOrders.map((order) => ({
      state: orderState(order, today),
      currency: order.currency,
      amount: orderAmount(order),
    }));
    const openOrders = judgedOrders.filter((o) => o.state !== "received");

    const money = (groups: { currency: string | null; _sum: { totalTtc: number | null }; _count: { _all: number } }[]): CurrencySum[] =>
      sumByCurrency(
        groups.map((g) => ({ currency: g.currency, amount: g._sum.totalTtc ?? 0, count: g._count._all })),
      );

    return {
      asOf: now,
      today: todayIso,
      plantToday,
      month,
      production,
      orders: {
        /** Active job orders per status, zero-filled in enum order; quotes are separate. */
        byStatus: ORDER_STATUSES.map((status) => ({ status, count: byStatus.get(status) ?? 0 })),
        quotes,
      },
      shifts: {
        weekStart,
        week:
          week === null
            ? null
            : {
                id: week.id,
                status: week.status,
                headcount: SHIFT_TYPES.map((type) => ({ type, count: headcount.get(type) ?? 0 })),
                unplaced,
                emptyShifts: SHIFT_TYPES.filter((type) => (headcount.get(type) ?? 0) === 0),
              },
        rosterSize,
        /** Tickets on the shifts of the last 24 h (see `ticketWindow`); `missed` ⊂ `open`. */
        tickets: {
          open: tickets.get("OPEN") ?? 0,
          done: tickets.get("DONE") ?? 0,
          missed: missedTickets,
        },
        pendingRequests,
      },
      stock: {
        rolls: { count: rolls._count._all, kg: rolls._sum.poidsRestant ?? 0 },
        free: { count: freeRolls._count._all, kg: freeRolls._sum.poidsRestant ?? 0 },
        reserved: { count: reservedRolls._count._all, kg: reservedRolls._sum.poidsRestant ?? 0 },
        inks: {
          low: inkStates.filter((state) => state === "low").length,
          out: inkStates.filter((state) => state === "out").length,
        },
        openStocktake:
          openStocktake === null
            ? null
            : {
                id: openStocktake.id,
                openedAt: openStocktake.openedAt,
                expectedCount: openStocktake.expectedCount,
                labelledCount: openStocktake.labelledCount,
                scanned: openStocktake._count.lines,
              },
        receiving: {
          /** Deliveries with reels still to scan in — `StockService.receivingCount`. */
          deliveries: receivingPending,
          reels: pendingReels,
          /** The oldest such delivery, named when it is the only one. */
          first:
            firstDelivery === null
              ? null
              : {
                  id: firstDelivery.id,
                  numero: firstDelivery.numeroImport,
                  supplier: firstDelivery.supplier.name,
                },
        },
      },
      money: {
        sales: {
          /** Issued in each span the range control offers; credit notes net off. */
          invoiced: {
            month: money(salesMonth),
            quarter: money(salesQuarter),
            twelveMonths: money(salesTwelveMonths),
          },
          thisYear: money(salesYear),
          unpaid: money(salesUnpaid),
          overdue: money(salesOverdue),
        },
        purchases: {
          openOrders: sumByCurrency(openOrders),
          lateOrders: openOrders.filter((o) => o.state === "late").length,
          unpaidInvoices: money(purchaseUnpaid),
          overdueInvoices: money(purchaseOverdue),
        },
      },
    };
  }
}

/** The `YYYY-MM` `n` months before `month`. */
function monthsAgo(month: string, n: number): string {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 - n, 1));
  return date.toISOString().slice(0, 7);
}
