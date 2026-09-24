import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import {
  ordersAreScopedFor,
  PRODUCTION_VISIBLE_ORDER_STATUSES,
  rollFit,
  WIDTH_TOLERANCE_MM,
  type ConsumeAllocationInput,
  type CutAndReserveInput,
  type ReserveRollInput,
} from "@repo/api-contract";
import { Prisma } from "../generated/prisma/client.js";
import { runListQuery } from "../list/list-query";
import { dayOrNow } from "../list/period";
import { PrismaService } from "../prisma.service";
import {
  ROLL_COUNTER_SELECT,
  freeGuard,
  freeMetres,
  kgPerMetre,
  metresFmt,
  moveRollCounters,
  releaseSet,
  reserveSet,
  takeSet,
  writeRollFlags,
  type RollCounters,
} from "../stock/roll-math";
import { StockService } from "../stock/stock.service";
import type { SessionUser } from "../trpc/trpc";
import {
  ALLOCATION_SELECT,
  CANDIDATE_SELECT,
  candidateListDeclaration,
  type CandidatesInput,
} from "./allocation.list";

type Db = Prisma.TransactionClient;

const RETURN_SELECT = { id: true, orderId: true, paperRollId: true } as const;

/** What reserve and consume need to know about the order. */
const ORDER_SELECT = {
  id: true,
  numero: true,
  kind: true,
  status: true,
  active: true,
  metrageNecessaire: true,
  productionWidthCm: true,
  product: { select: { grammage: true, paperType: true } },
} as const;

/** The order statuses paper can be reserved for — `assertReservable` and `reserveIn` agree. */
const RESERVABLE_ORDER_STATUSES = ["DRAFT", "IN_PRODUCTION"] as const;

/**
 * Paper reserved for orders — docs/roll-allocation-plan.md §5.2.
 *
 * Everything is in metres. A reservation promises a length of a reel to an
 * order (`PaperRoll.metrageReserve` goes up, the reel's free length goes
 * down); consuming it takes the metres actually used off the reel and gives
 * the rest back; cancelling gives it all back. Every reel counter move is
 * the conditional UPDATE in `roll-math.ts`, so two reservations racing for
 * the same paper cannot both win.
 *
 * The 214 migrated allocations were recorded by weight and carry NULL
 * metres. They are "legacy" here: shown in kilograms, cancellable
 * state-only (no reel counter moves — 42 of the 43 RESERVED ones sit on
 * archived or consumed reels whose counters are already 0), and not
 * consumable through this service.
 *
 * Scope follows the ink usage lines: a PRODUCTION user reaches only the
 * orders on the floor, through `PRODUCTION_VISIBLE_ORDER_STATUSES`.
 */
@Injectable()
export class AllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  // ---- reads ---------------------------------------------------------------

  /** The order's allocations, newest first, with the figures the panel sums. */
  async forOrder(actor: SessionUser, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { AND: [{ id: orderId }, this.orderScope(actor)] },
      select: ORDER_SELECT,
    });
    if (!order) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
    }
    const allocations = await this.prisma.rollAllocation.findMany({
      where: { orderId },
      select: ALLOCATION_SELECT,
      orderBy: [{ dateAllocation: "desc" }, { id: "asc" }],
    });

    let reservedMetres = 0;
    let consumedMetres = 0;
    let legacyKgOnly = 0;
    for (const row of allocations) {
      if (row.metrageReserve === null) {
        if (row.state !== "CANCELED") legacyKgOnly += 1;
        continue;
      }
      if (row.state === "RESERVED") reservedMetres += row.metrageReserve;
      if (row.state === "CONSUMED") consumedMetres += row.metrageReserve;
    }
    return {
      order: {
        id: order.id,
        numero: order.numero,
        kind: order.kind,
        status: order.status,
        active: order.active,
        metrageNecessaire: order.metrageNecessaire,
        productionWidthCm: order.productionWidthCm,
      },
      allocations,
      reservedMetres,
      consumedMetres,
      /** RESERVED or CONSUMED rows recorded by weight only: not in the sums above. */
      legacyKgOnly,
    };
  }

  /**
   * Reels that could serve the order: live, received, with length left, the
   * product's grammage (or none recorded — a third of the live stock, shown
   * rather than hidden), the product's paper type when it has one, and at
   * least the production width less the tolerance. `fit` says whether a reel
   * goes on as-is or needs slitting first.
   *
   * Pending reels are excluded: the picker offers paper someone is about to
   * walk to, and a reel nobody has scanned in may not be on the floor at all
   * — see docs/receiving-plan.md.
   */
  async candidates(actor: SessionUser, input: CandidatesInput) {
    const order = await this.prisma.order.findFirst({
      where: { AND: [{ id: input.orderId }, this.orderScope(actor)] },
      select: ORDER_SELECT,
    });
    if (!order) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
    }
    const widthCm = order.productionWidthCm;
    if (widthCm === null) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "This order has no production width yet — save it to compute one",
      });
    }
    const grammage = Math.round(order.product.grammage);
    const paperType = order.product.paperType;

    const scope: Prisma.PaperRollWhereInput = {
      consomme: false,
      archived: false,
      receivedAt: { not: null },
      metrageRestant: { gt: 0 },
      laize: { gte: widthCm * 10 - WIDTH_TOLERANCE_MM },
      AND: [
        // A product with no grammage cannot be matched on it; show the width.
        grammage > 0 ? { OR: [{ grammage }, { grammage: null }] } : {},
        paperType ? { OR: [{ paperType }, { paperType: null }] } : {},
      ],
    };

    const result = await runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) =>
          this.prisma.paperRoll.findMany({ ...args, select: CANDIDATE_SELECT }),
        count: (args) => this.prisma.paperRoll.count(args),
      },
      query: input,
      declaration: candidateListDeclaration,
      scope,
    });
    return {
      ...result,
      rows: result.rows.map((row) => ({
        ...row,
        // The scope guarantees a width at or above the band, so `null` here
        // cannot happen; "slit" is the safe reading if it somehow did.
        fit: rollFit(row.laize ?? 0, widthCm) ?? ("slit" as const),
        freeMetres: freeMetres(row),
        grammageKnown: row.grammage !== null,
      })),
    };
  }

  // ---- writes --------------------------------------------------------------

  /** Promises `metres` of a reel to an order. */
  async reserve(actor: SessionUser, input: ReserveRollInput) {
    const order = await this.assertReservable(actor, input.orderId);
    return this.prisma.$transaction((tx) =>
      this.reserveIn(tx, actor, order.id, input.rollId, input.metres, input.dateAllocation),
    );
  }

  /**
   * Cuts exactly `metres` off the reel into a child and reserves the child
   * whole — one transaction, so the child never exists unreserved.
   */
  async cutAndReserve(actor: SessionUser, input: CutAndReserveInput) {
    const order = await this.assertReservable(actor, input.orderId);
    return this.prisma.$transaction(async (tx) => {
      const child = await this.stock.cut({ rollId: input.rollId, metres: input.metres }, tx);
      return this.reserveIn(tx, actor, order.id, child.id, input.metres, input.dateAllocation);
    });
  }

  /**
   * Closes a reservation for the metres actually used. The used length
   * comes off the reel; the rest of the reservation goes back to free. A
   * reel run down to nothing is marked consumed by the order.
   */
  async consume(actor: SessionUser, input: ConsumeAllocationInput) {
    const allocation = await this.assertAllocationInScope(actor, input.id);
    if (allocation.state !== "RESERVED") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `This allocation is already ${allocation.state.toLowerCase()}`,
      });
    }
    if (allocation.metrageReserve === null) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "This allocation was recorded by weight only, before lengths were tracked — " +
          "it can be cancelled but not consumed here",
      });
    }
    if (allocation.order.status !== "IN_PRODUCTION" && allocation.order.status !== "PRODUCED") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Paper is consumed once the order is in production or produced",
      });
    }
    const reserved = allocation.metrageReserve;
    const used = input.metresUsed ?? reserved;
    if (used > reserved) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          `${metresFmt.format(reserved)} m were reserved — cannot consume ` +
          `${metresFmt.format(used)} m. Reserve more first.`,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const roll = await this.loadRoll(tx, allocation.paperRollId);
      const usedKg = used * kgPerMetre(roll);
      // Claim the row first. The state check above ran outside this
      // transaction; without the predicate two concurrent consumes would both
      // pass it and take the metres off the reel twice.
      const claimed = await tx.rollAllocation.updateMany({
        where: { id: allocation.id, state: "RESERVED" },
        data: {
          state: "CONSUMED",
          dateConsommation: new Date(),
          metrageReserve: used,
          poidsReserve: usedKg,
        },
      });
      if (claimed.count !== 1) throw this.alreadySettled();
      const after = await moveRollCounters(
        tx,
        roll.id,
        // Take the used length off, and release the whole reservation.
        Prisma.join([takeSet(used, usedKg), releaseSet(reserved, allocation.poidsReserve)], ", "),
        Prisma.sql`"metrageRestant" >= ${used}`,
      );
      if (!after) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `${roll.numero ?? "The reel"} no longer has ${metresFmt.format(used)} m — reload and retry`,
        });
      }
      const spent = after.metrageRestant <= 0;
      await writeRollFlags(
        tx,
        after,
        spent
          ? {
              consomme: true,
              dateConsommation: new Date(),
              consumedByNote: allocation.order.numero,
            }
          : {},
      );
      return { id: allocation.id, orderId: allocation.order.id, paperRollId: roll.id };
    });
  }

  /** Gives a reservation back. Legacy rows flip state only (see the class comment). */
  async cancel(actor: SessionUser, id: string) {
    const allocation = await this.assertAllocationInScope(actor, id);
    if (allocation.state !== "RESERVED") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `This allocation is already ${allocation.state.toLowerCase()}`,
      });
    }
    const cancelled = await this.prisma.$transaction((tx) => this.cancelIn(tx, allocation));
    if (!cancelled) throw this.alreadySettled();
    return cancelled;
  }

  /**
   * Every open reservation of an order is cancelled. Called by
   * `OrderService.transitionIn` on `→ CANCELLED`, inside its transaction, so
   * an order cannot be cancelled while still holding paper.
   */
  async releaseForOrder(db: Db, orderId: string): Promise<number> {
    const open = await db.rollAllocation.findMany({
      where: { orderId, state: "RESERVED" },
      select: { id: true, orderId: true, paperRollId: true, metrageReserve: true, poidsReserve: true },
    });
    let released = 0;
    for (const allocation of open) {
      // A row settled by a concurrent consume or cancel since the read is
      // simply skipped: it no longer holds paper, which is all this wants.
      if (await this.cancelIn(db, allocation)) released += 1;
    }
    return released;
  }

  // ---- helpers -------------------------------------------------------------

  private async reserveIn(
    tx: Db,
    actor: SessionUser,
    orderId: string,
    rollId: string,
    metres: number,
    day: string | undefined,
  ) {
    // Take the order's row lock and re-check it is still reservable. The
    // check in `assertReservable` ran outside this transaction; this write
    // makes a concurrent transition (→ CANCELLED, → PRODUCED) wait for the
    // reservation to commit, or makes the reservation see the new status.
    const locked = await tx.order.updateMany({
      where: {
        id: orderId,
        active: true,
        kind: "ORDER",
        status: { in: [...RESERVABLE_ORDER_STATUSES] },
      },
      data: { updatedAt: new Date() },
    });
    if (locked.count !== 1) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This order changed while reserving — reload and retry",
      });
    }
    // `receivedAt` rides along on this one read rather than widening
    // ROLL_COUNTER_SELECT: that constant is mirrored by the raw-SQL
    // RETURNING list in roll-math.ts, and the two have to stay in step.
    const found = await tx.paperRoll.findUnique({
      where: { id: rollId },
      select: { ...ROLL_COUNTER_SELECT, receivedAt: true },
    });
    if (!found) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Roll not found" });
    }
    const { receivedAt, ...roll } = found;
    if (receivedAt === null) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `${roll.numero ?? "This reel"} has not been received yet — scan it in first`,
      });
    }
    const kg = metres * kgPerMetre(roll);
    const after = await moveRollCounters(tx, roll.id, reserveSet(metres, kg), freeGuard(metres));
    if (!after) {
      // Zero rows matched: read the reel now and say why, like InkService.draw.
      const now = await this.loadRoll(tx, rollId);
      const name = now.numero ?? "This reel";
      if (now.consomme || now.archived) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${name} is ${now.consomme ? "used up" : "archived"}`,
        });
      }
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          `Only ${metresFmt.format(freeMetres(now))} m of ${name} is free — ` +
          `cannot reserve ${metresFmt.format(metres)} m`,
      });
    }
    await writeRollFlags(tx, after);
    return tx.rollAllocation.create({
      data: {
        orderId,
        paperRollId: roll.id,
        state: "RESERVED",
        metrageReserve: metres,
        poidsReserve: kg,
        dateAllocation: dayOrNow(day),
        allocatedById: actor.id,
      },
      select: RETURN_SELECT,
    });
  }

  /**
   * Null when the row was no longer RESERVED: a concurrent consume or cancel
   * settled it first, and its counters must not be released a second time.
   * The state flip comes first, as the claim, and the counters move only
   * for the request that won it.
   */
  private async cancelIn(
    tx: Db,
    allocation: {
      id: string;
      orderId: string;
      paperRollId: string;
      metrageReserve: number | null;
      poidsReserve: number;
    },
  ): Promise<{ id: string; orderId: string; paperRollId: string } | null> {
    const claimed = await tx.rollAllocation.updateMany({
      where: { id: allocation.id, state: "RESERVED" },
      data: { state: "CANCELED", dateAnnulation: new Date() },
    });
    if (claimed.count !== 1) return null;
    if (allocation.metrageReserve !== null) {
      const after = await moveRollCounters(
        tx,
        allocation.paperRollId,
        releaseSet(allocation.metrageReserve, allocation.poidsReserve),
        Prisma.sql`TRUE`,
      );
      if (after) await writeRollFlags(tx, after);
    }
    return {
      id: allocation.id,
      orderId: allocation.orderId,
      paperRollId: allocation.paperRollId,
    };
  }

  private alreadySettled(): TRPCError {
    return new TRPCError({
      code: "CONFLICT",
      message: "This allocation was already consumed or cancelled — reload",
    });
  }

  private async loadRoll(tx: Db, rollId: string): Promise<RollCounters> {
    const roll = await tx.paperRoll.findUnique({
      where: { id: rollId },
      select: ROLL_COUNTER_SELECT,
    });
    if (!roll) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Roll not found" });
    }
    return roll;
  }

  /** An order paper can be reserved for: a confirmed, active order not yet produced. */
  private async assertReservable(actor: SessionUser, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { AND: [{ id: orderId }, this.orderScope(actor)] },
      select: ORDER_SELECT,
    });
    if (!order) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
    }
    if (order.kind !== "ORDER") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Paper is reserved for orders, not quotes — accept the quote first",
      });
    }
    if (!order.active) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This order is archived" });
    }
    if (!(RESERVABLE_ORDER_STATUSES as readonly string[]).includes(order.status)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Paper cannot be reserved for an order that is ${order.status.toLowerCase().replace(/_/g, " ")}`,
      });
    }
    return order;
  }

  private async assertAllocationInScope(actor: SessionUser, id: string) {
    const allocation = await this.prisma.rollAllocation.findFirst({
      where: { AND: [{ id }, this.allocationScope(actor)] },
      select: {
        id: true,
        state: true,
        paperRollId: true,
        metrageReserve: true,
        poidsReserve: true,
        orderId: true,
        order: { select: { id: true, numero: true, status: true } },
      },
    });
    if (!allocation) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Allocation not found" });
    }
    return allocation;
  }

  /** Same rule as InkService.scopeFor: PRODUCTION sees the floor's orders only. */
  private orderScope(actor: SessionUser): Prisma.OrderWhereInput {
    return ordersAreScopedFor(actor.role)
      ? { status: { in: [...PRODUCTION_VISIBLE_ORDER_STATUSES] } }
      : {};
  }

  private allocationScope(actor: SessionUser): Prisma.RollAllocationWhereInput {
    return ordersAreScopedFor(actor.role) ? { order: this.orderScope(actor) } : {};
  }
}
