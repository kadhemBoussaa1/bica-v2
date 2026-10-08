import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import {
  canAddOrderInks,
  canChangeOrderInks,
  inkUnitLabel,
  ordersAreScopedFor,
  PRODUCTION_VISIBLE_ORDER_STATUSES,
  type AddOrderInksInput,
  type AdjustInkStockInput,
  type CreateInkColourInput,
  type RecordInkUsageInput,
  type RemoveOrderInkInput,
  type RestockInkInput,
  type UpdateInkColourInput,
  type UpdateInkUsageInput,
} from "@repo/api-contract";
import { Prisma } from "../generated/prisma/client.js";
import type { InkAdjustReason, InkMovementKind } from "../generated/prisma/enums.js";
import { runListQuery } from "../list/list-query";
import { dayOrNow } from "../list/period";
import { PrismaService } from "../prisma.service";
import type { SessionUser } from "../trpc/trpc";
import {
  INK_SELECT,
  INK_USAGE_SELECT,
  inkListDeclaration,
  type ListInkColoursInput,
} from "./ink.list";

const RETURN_SELECT = {
  id: true,
  code: true,
  name: true,
  unit: true,
  stock: true,
  active: true,
} as const;

const USAGE_RETURN_SELECT = {
  id: true,
  orderId: true,
  colourId: true,
  quantity: true,
} as const;

const qty = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

/** A foreign key refused the write — here, the composite one on `InkUsage`. */
function isForeignKeyError(cause: unknown): boolean {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2003";
}

/** The window "consumption per month" is averaged over. */
const CONSUMPTION_DAYS = 90;
/** How many history rows the drawer shows, newest first. */
const HISTORY_LIMIT = 60;

/**
 * The ink catalogue and its stock balance — docs/legacy-migration.md "Step 7".
 *
 * `InkColour.stock` is the one live figure and every write to it is atomic
 * at the row: `increment`/`decrement` for movements, and a conditional
 * `updateMany` (`stock >= quantity`) for anything that takes ink OUT, so two
 * people drawing from the same tin at once cannot take it below zero — the
 * second one's `updateMany` matches no row and is refused. No read-then-write
 * on the balance anywhere in this file; the legacy service reached the same
 * guarantee with a pessimistic row lock.
 *
 * Usage lines are scoped like production runs: a PRODUCTION user only sees
 * (and records against) the orders on the floor, through the same status
 * list the orders list uses.
 */
@Injectable()
export class InkService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- catalogue -----------------------------------------------------------

  /** Reference data, so no session-derived scope — see MachineService. */
  async list(query: ListInkColoursInput) {
    return runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) =>
          this.prisma.inkColour.findMany({ ...args, select: INK_SELECT }),
        count: (args) => this.prisma.inkColour.count(args),
      },
      query,
      declaration: inkListDeclaration,
      scope: {},
    });
  }

  /**
   * The header tiles: every live colour, whatever the chips and search say —
   * they describe the shelf, not the page. The level counts use the same
   * `stockLevel` ranges as the list's facets.
   */
  async summary() {
    const live = { active: true } satisfies Prisma.InkColourWhereInput;
    const [units, low, out, outNames, noThreshold] = await this.prisma.$transaction([
      this.prisma.inkColour.groupBy({
        by: ["unit"],
        where: live,
        orderBy: { unit: "asc" },
        _count: { _all: true },
        _sum: { stock: true },
      }),
      this.prisma.inkColour.count({ where: { ...live, stockLevel: { gt: 0, lt: 3 } } }),
      this.prisma.inkColour.count({ where: { ...live, stockLevel: 0 } }),
      this.prisma.inkColour.findMany({
        where: { ...live, stockLevel: 0 },
        select: { code: true, name: true },
        orderBy: [{ code: "asc" }, { id: "asc" }],
        take: 4,
      }),
      this.prisma.inkColour.count({ where: { ...live, alertThreshold: null } }),
    ]);
    return {
      live: units.reduce((sum, group) => sum + (group._count as { _all: number })._all, 0),
      totals: units.map((group) => ({ unit: group.unit, stock: group._sum?.stock ?? 0 })),
      low,
      out,
      outNames: outNames.map((colour) => colour.name ?? colour.code),
      noThreshold,
    };
  }

  /**
   * The drawer: the colour, what it is used for, and its history — the
   * ledger's movements merged with the usage lines, newest first.
   *
   * Each row carries the balance right after it. A movement stored its own
   * (`balanceAfter`); a usage line's is worked back from the next known
   * figure above it. History before a colour's OPENING row is not the
   * balance's (an imported colour's legacy usages were already deducted
   * from the balance it opened with), so those rows show none.
   */
  async detail(id: string) {
    const since = new Date(Date.now() - CONSUMPTION_DAYS * 24 * 3600 * 1000);
    const [colour, movements, usages, orders, recent] = await this.prisma.$transaction([
      this.prisma.inkColour.findUnique({ where: { id }, select: INK_SELECT }),
      this.prisma.inkMovement.findMany({
        where: { colourId: id },
        orderBy: [{ at: "desc" }, { id: "desc" }],
        take: HISTORY_LIMIT,
        select: {
          id: true,
          kind: true,
          delta: true,
          balanceAfter: true,
          reason: true,
          receiptRef: true,
          at: true,
          by: { select: { name: true } },
        },
      }),
      this.prisma.inkUsage.findMany({
        where: { colourId: id },
        orderBy: [{ usedAt: "desc" }, { id: "desc" }],
        take: HISTORY_LIMIT,
        select: {
          id: true,
          quantity: true,
          usedAt: true,
          order: { select: { id: true, numero: true } },
          recordedBy: { select: { name: true } },
        },
      }),
      this.prisma.inkUsage.groupBy({
        by: ["orderId"],
        where: { colourId: id },
        orderBy: { orderId: "asc" },
      }),
      this.prisma.inkUsage.aggregate({
        where: { colourId: id, usedAt: { gte: since } },
        _sum: { quantity: true },
      }),
    ]);
    if (!colour) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Colour not found" });
    }

    type Row =
      | { type: "movement"; at: Date; movement: (typeof movements)[number] }
      | { type: "usage"; at: Date; usage: (typeof usages)[number] };
    const merged: Row[] = [
      ...movements.map((movement) => ({ type: "movement" as const, at: movement.at, movement })),
      ...usages.map((usage) => ({ type: "usage" as const, at: usage.usedAt, usage })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, HISTORY_LIMIT);

    let balance: number | null = colour.stock;
    const history = merged.map((row) => {
      if (row.type === "movement") {
        const { movement } = row;
        balance = movement.kind === "OPENING" ? null : movement.balanceAfter - movement.delta;
        return {
          id: movement.id,
          kind: movement.kind,
          at: movement.at,
          delta: movement.delta,
          after: movement.balanceAfter as number | null,
          reason: movement.reason,
          receiptRef: movement.receiptRef,
          by: movement.by?.name ?? null,
          order: null,
        };
      }
      const { usage } = row;
      const after = balance;
      balance = balance === null ? null : balance + usage.quantity;
      return {
        id: usage.id,
        kind: "USAGE" as const,
        at: usage.usedAt,
        delta: -usage.quantity,
        after,
        reason: null,
        receiptRef: null,
        by: usage.recordedBy?.name ?? null,
        order: usage.order,
      };
    });

    const perMonth = ((recent._sum.quantity ?? 0) / CONSUMPTION_DAYS) * 30;
    return {
      colour,
      orderCount: orders.length,
      /** Average over the last 90 days; null when nothing was drawn. */
      perMonth: perMonth > 0 ? perMonth : null,
      /** At that rate; null without a rate or without stock. */
      weeksLeft: perMonth > 0 && colour.stock > 0 ? colour.stock / ((perMonth * 12) / 52) : null,
      history,
    };
  }

  async byId(id: string) {
    const colour = await this.prisma.inkColour.findUnique({
      where: { id },
      select: INK_SELECT,
    });
    if (!colour) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Colour not found" });
    }
    return colour;
  }

  /** The colour and its OPENING row, which starts its history. */
  async create(actor: SessionUser, input: CreateInkColourInput) {
    await this.assertCodeFree(input.code);
    return this.prisma.$transaction(async (tx) => {
      const colour = await tx.inkColour.create({
        data: {
          code: input.code,
          name: input.name ?? null,
          unit: input.unit,
          stock: input.stock,
          alertThreshold: input.alertThreshold ?? null,
          hex: input.hex ?? null,
          kiloPrice: input.kiloPrice,
        },
        select: RETURN_SELECT,
      });
      await this.record(tx, actor, colour, { kind: "OPENING", delta: colour.stock });
      return colour;
    });
  }

  /** Metadata only — the balance has its own three write paths. */
  async update(input: UpdateInkColourInput) {
    await this.assertExists(input.id);
    await this.assertCodeFree(input.code, input.id);
    return this.prisma.inkColour.update({
      where: { id: input.id },
      data: {
        code: input.code,
        name: input.name ?? null,
        // No `unit`: it is fixed at create (`updateInkColourInput`).
        alertThreshold: input.alertThreshold ?? null,
        kiloPrice: input.kiloPrice,
        // Clearable: null clears the swatch, omitted leaves it.
        ...(input.hex !== undefined ? { hex: input.hex } : {}),
      },
      select: RETURN_SELECT,
    });
  }

  async setActive(actor: SessionUser, id: string, active: boolean) {
    await this.assertExists(id);
    return this.prisma.$transaction(async (tx) => {
      const colour = await tx.inkColour.update({
        where: { id },
        data: { active },
        select: RETURN_SELECT,
      });
      await this.record(tx, actor, colour, { kind: active ? "RESTORED" : "ARCHIVED", delta: 0 });
      return colour;
    });
  }

  /**
   * Hard delete, refused once any usage line names the colour: deleting it
   * would erase what an order consumed. Archive instead — the legacy service
   * made the same call, with a 400 rather than an FK error. Refused too while
   * an order has it chosen (`OrderInk`), which the FK would otherwise turn
   * into a 500. A never-used colour's own movements (its OPENING row,
   * restocks) go with it.
   */
  async remove(id: string) {
    const colour = await this.prisma.inkColour.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        _count: { select: { usages: true, orders: true } },
      },
    });
    if (!colour) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Colour not found" });
    }
    if (colour._count.usages > 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          `${colour.code} has been used on ${colour._count.usages} order line(s). ` +
          "Archive it instead, so that history keeps its colour.",
      });
    }
    if (colour._count.orders > 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          `${colour.code} is chosen on ${colour._count.orders} order(s). ` +
          "Take it off those orders, or archive it instead.",
      });
    }
    await this.prisma.$transaction([
      this.prisma.inkMovement.deleteMany({ where: { colourId: id } }),
      this.prisma.inkColour.delete({ where: { id } }),
    ]);
    return { id };
  }

  // ---- balance -------------------------------------------------------------

  /**
   * A delivery: the balance goes up by the quantity. Archived colours too —
   * a late delivery is still ink on the shelf. The ledger row takes the
   * balance the increment returned, so it is exact under concurrent draws.
   */
  async restock(actor: SessionUser, input: RestockInkInput) {
    await this.assertExists(input.id);
    return this.prisma.$transaction(async (tx) => {
      const colour = await tx.inkColour.update({
        where: { id: input.id },
        data: { stock: { increment: input.quantity } },
        select: RETURN_SELECT,
      });
      await this.record(tx, actor, colour, {
        kind: "DELIVERY",
        delta: input.quantity,
        receiptRef: input.receiptRef ?? null,
      });
      return colour;
    });
  }

  /**
   * A count: the balance is replaced, whatever it was. The ledger needs the
   * difference, so the row is locked (`FOR UPDATE`) before the old figure is
   * read: a draw landing between the read and the write would otherwise
   * make the recorded difference wrong, though not the balance.
   */
  async adjust(actor: SessionUser, input: AdjustInkStockInput) {
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ stock: number }[]>`
        SELECT "stock" FROM "InkColour" WHERE "id" = ${input.id} FOR UPDATE`;
      if (!locked) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Colour not found" });
      }
      const colour = await tx.inkColour.update({
        where: { id: input.id },
        data: { stock: input.stock },
        select: RETURN_SELECT,
      });
      await this.record(tx, actor, colour, {
        kind: "ADJUSTMENT",
        delta: colour.stock - locked.stock,
        reason: input.reason,
      });
      return colour;
    });
  }

  // ---- order colours -------------------------------------------------------

  /**
   * The order's chosen colours (docs/order-inks-plan.md), each with its usage
   * lines on this order, newest first, and the total drawn. Scoped like the
   * usage lines: a PRODUCTION user only reaches the orders on the floor, and
   * any other order is NOT_FOUND.
   */
  async forOrder(actor: SessionUser, orderId: string) {
    await this.assertOrderInScope(actor, orderId);
    const inks = await this.prisma.orderInk.findMany({
      where: { orderId },
      orderBy: [{ colour: { code: "asc" } }, { id: "asc" }],
      select: {
        id: true,
        colour: {
          select: {
            id: true,
            code: true,
            name: true,
            unit: true,
            hex: true,
            active: true,
            stock: true,
          },
        },
        usages: {
          select: INK_USAGE_SELECT,
          orderBy: [{ usedAt: "desc" }, { id: "desc" }],
        },
      },
    });
    return inks.map((ink) => ({
      ...ink,
      used: ink.usages.reduce((sum, line) => sum + line.quantity, 0),
    }));
  }

  /**
   * The Encres card's money, ADMIN+ only (docs/order-ink-price-plan.md): the
   * price frozen on each assignment and the cost of what was drawn against
   * it. Apart from `forOrder` so the floor's query never carries a price and
   * the gate sits on the procedure. Display only — not the order's margin.
   */
  async costForOrder(orderId: string) {
    await this.assertOrderExists(orderId);
    const inks = await this.prisma.orderInk.findMany({
      where: { orderId },
      select: { id: true, kiloPrice: true, usages: { select: { quantity: true } } },
    });
    const byInk = inks.map((ink) => {
      const used = ink.usages.reduce((sum, line) => sum + line.quantity, 0);
      return {
        orderInkId: ink.id,
        kiloPrice: ink.kiloPrice,
        cost: ink.kiloPrice === null ? null : used * ink.kiloPrice,
      };
    });
    return {
      byInk,
      /** The priced colours only; `unpriced` says how many are left out. */
      total: byInk.reduce((sum, ink) => sum + (ink.cost ?? 0), 0),
      unpriced: byInk.filter((ink) => ink.kiloPrice === null).length,
    };
  }

  /**
   * The "add a colour" picker: every active colour the order does not have
   * yet, with the price an assignment would freeze. Not `list` — its "all"
   * includes archived colours, its largest page is 100, and it is audited on
   * every open.
   */
  async choicesForOrder(orderId: string) {
    await this.assertOrderExists(orderId);
    return this.prisma.inkColour.findMany({
      where: { active: true, orders: { none: { orderId } } },
      orderBy: [{ code: "asc" }, { id: "asc" }],
      select: { id: true, code: true, name: true, unit: true, stock: true, kiloPrice: true },
    });
  }

  /**
   * ADMIN+ chooses colours for an order, until it is terminal
   * (`canAddOrderInks`). Archived colours are refused: nobody could draw
   * from them, and so are unpriced ones, since the assignment freezes the
   * colour's price (docs/order-ink-price-plan.md). Adding one the order
   * already has is a no-op that keeps its frozen price.
   *
   * The price read and the insert are not one transaction on purpose: an
   * edit landing between them is indistinguishable from one made a moment
   * before the assignment.
   */
  async addToOrder(actor: SessionUser, input: AddOrderInksInput) {
    const order = await this.assertOrderExists(input.orderId);
    if (!canAddOrderInks(order.kind, order.status)) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          order.kind === "QUOTE"
            ? "Colours are chosen once the quote is accepted"
            : "Colours can no longer be added to this order",
      });
    }
    const colours = await this.prisma.inkColour.findMany({
      where: { id: { in: input.colourIds } },
      select: { id: true, code: true, active: true, kiloPrice: true },
    });
    if (colours.length !== input.colourIds.length) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Colour not found" });
    }
    const archived = colours.find((colour) => !colour.active);
    if (archived) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${archived.code} is archived; restore it before choosing it`,
      });
    }
    const unpriced = colours.find((colour) => colour.kiloPrice === null);
    if (unpriced) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Set a price on ${unpriced.code} before choosing it`,
      });
    }
    const created = await this.prisma.orderInk.createMany({
      data: colours.map((colour) => ({
        orderId: input.orderId,
        colourId: colour.id,
        kiloPrice: colour.kiloPrice,
        addedById: actor.id,
      })),
      skipDuplicates: true,
    });
    return { orderId: input.orderId, added: created.count };
  }

  /**
   * Takes a colour off an order: only before production
   * (`canChangeOrderInks`) and only while no ink was drawn for it. The
   * delete is conditional on the status, and the composite FK on `InkUsage`
   * refuses it if a line landed after the count — the count is only there
   * for the message.
   */
  async removeFromOrder(input: RemoveOrderInkInput) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: input.orderId },
          select: { kind: true, status: true },
        });
        if (!order) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        }
        if (!canChangeOrderInks(order.kind, order.status)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Colours can only be removed before production",
          });
        }
        const used = await tx.inkUsage.count({
          where: { orderId: input.orderId, colourId: input.colourId },
        });
        if (used > 0) throw this.colourDrawn();
        const removed = await tx.orderInk.deleteMany({
          where: {
            orderId: input.orderId,
            colourId: input.colourId,
            order: { kind: "ORDER", status: "DRAFT" },
          },
        });
        if (removed.count !== 1) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This colour is not on this order",
          });
        }
        return { orderId: input.orderId, colourId: input.colourId };
      });
    } catch (cause) {
      if (isForeignKeyError(cause)) throw this.colourDrawn();
      throw cause;
    }
  }

  // ---- usage ---------------------------------------------------------------

  /**
   * Draws ink from a colour for an order. The decrement and the line are one
   * transaction, and the decrement is conditional on the balance covering
   * it — so a refused draw leaves both untouched.
   *
   * Only while the order is IN_PRODUCTION, for every role — the scope holds
   * PRODUCTION to it already, this holds ADMIN+ too. Only against a colour
   * chosen for the order (`OrderInk`): checked for the message, guaranteed by
   * the composite FK if the colour is taken off concurrently.
   */
  async recordUsage(actor: SessionUser, input: RecordInkUsageInput) {
    const order = await this.assertOrderInScope(actor, input.orderId);
    if (order.status !== "IN_PRODUCTION") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Ink is recorded while the order is in production",
      });
    }
    const colour = await this.prisma.inkColour.findUnique({
      where: { id: input.colourId },
      select: { id: true, code: true, unit: true, active: true },
    });
    if (!colour) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Colour not found" });
    }
    if (!colour.active) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${colour.code} is archived; restore it before using it`,
      });
    }

    const notChosen = () =>
      new TRPCError({
        code: "BAD_REQUEST",
        message: `${colour.code} is not one of this order's colours`,
      });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const chosen = await tx.orderInk.findUnique({
          where: { orderId_colourId: { orderId: input.orderId, colourId: colour.id } },
          select: { id: true },
        });
        if (!chosen) throw notChosen();
        await this.draw(tx, colour.id, input.quantity);
        return tx.inkUsage.create({
          data: {
            orderId: input.orderId,
            colourId: colour.id,
            quantity: input.quantity,
            usedAt: dayOrNow(input.usedAt),
            note: input.note ?? null,
            recordedById: actor.id,
          },
          select: USAGE_RETURN_SELECT,
        });
      });
    } catch (cause) {
      if (isForeignKeyError(cause)) throw notChosen();
      throw cause;
    }
  }

  /**
   * Corrects a line. The balance moves by the DIFFERENCE, in one write: an
   * increase is a conditional draw of the extra, a decrease puts the surplus
   * back. Never "return the old, draw the new" as two steps — between them
   * someone else could take the ink this line already held.
   *
   * The delta is taken from a read outside the transaction, so the line is
   * rewritten only while it still holds that quantity: two concurrent edits
   * would otherwise each move the balance by their own delta off the same
   * starting figure, and the stock would drift from the lines.
   */
  async updateUsage(actor: SessionUser, input: UpdateInkUsageInput) {
    const line = await this.assertUsageInScope(actor, input.id);
    const delta = input.quantity - line.quantity;

    return this.prisma.$transaction(async (tx) => {
      const rewritten = await tx.inkUsage.updateMany({
        where: { id: line.id, quantity: line.quantity },
        data: {
          quantity: input.quantity,
          ...(input.usedAt ? { usedAt: dayOrNow(input.usedAt) } : {}),
          note: input.note ?? null,
        },
      });
      if (rewritten.count !== 1) throw this.lineChanged();
      if (delta > 0) {
        await this.draw(tx, line.colourId, delta);
      } else if (delta < 0) {
        await tx.inkColour.update({
          where: { id: line.colourId },
          data: { stock: { increment: -delta } },
          select: { id: true },
        });
      }
      return {
        id: line.id,
        orderId: line.orderId,
        colourId: line.colourId,
        quantity: input.quantity,
      };
    });
  }

  /**
   * Deletes a line and puts its ink back. The delete is conditional on the
   * quantity read, and comes first: a concurrent edit or delete makes it
   * match nothing, so the ink is never returned twice or at a stale figure.
   */
  async removeUsage(actor: SessionUser, id: string) {
    const line = await this.assertUsageInScope(actor, id);
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.inkUsage.deleteMany({
        where: { id: line.id, quantity: line.quantity },
      });
      if (removed.count !== 1) throw this.lineChanged();
      await tx.inkColour.update({
        where: { id: line.colourId },
        data: { stock: { increment: line.quantity } },
        select: { id: true },
      });
    });
    return { id, orderId: line.orderId };
  }

  // ---- helpers -------------------------------------------------------------

  /** One ledger row, in the caller's transaction, at the balance it left. */
  private async record(
    tx: Prisma.TransactionClient,
    actor: SessionUser,
    colour: { id: string; stock: number },
    movement: {
      kind: InkMovementKind;
      delta: number;
      reason?: InkAdjustReason;
      receiptRef?: string | null;
    },
  ) {
    await tx.inkMovement.create({
      data: {
        colourId: colour.id,
        kind: movement.kind,
        delta: movement.delta,
        balanceAfter: colour.stock,
        reason: movement.reason ?? null,
        receiptRef: movement.receiptRef ?? null,
        byId: actor.id,
      },
      select: { id: true },
    });
  }

  /**
   * The conditional decrement: matches the row only while the balance covers
   * `quantity`. Zero rows matched means someone got there first (or the
   * balance never covered it) — read the figure now and say so.
   */
  private async draw(tx: Prisma.TransactionClient, colourId: string, quantity: number) {
    const taken = await tx.inkColour.updateMany({
      where: { id: colourId, stock: { gte: quantity } },
      data: { stock: { decrement: quantity } },
    });
    if (taken.count === 1) return;

    const colour = await tx.inkColour.findUnique({
      where: { id: colourId },
      select: { code: true, unit: true, stock: true },
    });
    if (!colour) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Colour not found" });
    }
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        `Only ${qty.format(colour.stock)} ${inkUnitLabel(colour.unit)} of ` +
        `${colour.code} left — cannot draw ${qty.format(quantity)}`,
    });
  }

  private colourDrawn(): TRPCError {
    return new TRPCError({
      code: "CONFLICT",
      message: "Ink has been drawn for this colour on this order; it cannot be removed",
    });
  }

  private lineChanged(): TRPCError {
    return new TRPCError({
      code: "CONFLICT",
      message: "This ink line was changed or removed by someone else — reload",
    });
  }

  /** Same rule as ProductionService.scopeFor, through the usage's order. */
  private scopeFor(actor: SessionUser): Prisma.InkUsageWhereInput {
    return ordersAreScopedFor(actor.role)
      ? { order: { status: { in: [...PRODUCTION_VISIBLE_ORDER_STATUSES] } } }
      : {};
  }

  private async assertOrderInScope(actor: SessionUser, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        AND: [
          { id: orderId },
          ordersAreScopedFor(actor.role)
            ? { status: { in: [...PRODUCTION_VISIBLE_ORDER_STATUSES] } }
            : {},
        ],
      },
      select: { id: true, status: true },
    });
    if (!order) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
    }
    return order;
  }

  /** ADMIN+ callers only — no session scope. */
  private async assertOrderExists(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, kind: true, status: true },
    });
    if (!order) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
    }
    return order;
  }

  private async assertUsageInScope(actor: SessionUser, id: string) {
    const line = await this.prisma.inkUsage.findFirst({
      where: { AND: [{ id }, this.scopeFor(actor)] },
      select: { id: true, orderId: true, colourId: true, quantity: true },
    });
    if (!line) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Ink usage not found" });
    }
    return line;
  }

  private async assertExists(id: string) {
    const found = await this.prisma.inkColour.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Colour not found" });
    }
  }

  private async assertCodeFree(code: string, excludeId?: string) {
    const existing = await this.prisma.inkColour.findUnique({
      where: { code },
      select: { id: true },
    });
    if (existing && existing.id !== excludeId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `A colour with code ${code} already exists`,
      });
    }
  }
}
