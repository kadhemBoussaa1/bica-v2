import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import {
  inkUnitLabel,
  ordersAreScopedFor,
  PRODUCTION_VISIBLE_ORDER_STATUSES,
  type AdjustInkStockInput,
  type CreateInkColourInput,
  type RecordInkUsageInput,
  type RestockInkInput,
  type UpdateInkColourInput,
  type UpdateInkUsageInput,
} from "@repo/api-contract";
import type { Prisma } from "../generated/prisma/client.js";
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

  async create(input: CreateInkColourInput) {
    await this.assertCodeFree(input.code);
    return this.prisma.inkColour.create({
      data: {
        code: input.code,
        name: input.name ?? null,
        unit: input.unit,
        stock: input.stock,
        alertThreshold: input.alertThreshold ?? null,
      },
      select: RETURN_SELECT,
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
        unit: input.unit,
        alertThreshold: input.alertThreshold ?? null,
      },
      select: RETURN_SELECT,
    });
  }

  async setActive(id: string, active: boolean) {
    await this.assertExists(id);
    return this.prisma.inkColour.update({
      where: { id },
      data: { active },
      select: RETURN_SELECT,
    });
  }

  /**
   * Hard delete, refused once any usage line names the colour: the lines are
   * the only movement history there is, so deleting their colour would erase
   * what an order consumed. Archive instead — the legacy service made the
   * same call, with a 400 rather than an FK error.
   */
  async remove(id: string) {
    const colour = await this.prisma.inkColour.findUnique({
      where: { id },
      select: { id: true, code: true, _count: { select: { usages: true } } },
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
    await this.prisma.inkColour.delete({ where: { id } });
    return { id };
  }

  // ---- balance -------------------------------------------------------------

  /** A delivery: the balance goes up by the quantity. Archived colours too — a late delivery is still ink on the shelf. */
  async restock(input: RestockInkInput) {
    await this.assertExists(input.id);
    return this.prisma.inkColour.update({
      where: { id: input.id },
      data: { stock: { increment: input.quantity } },
      select: RETURN_SELECT,
    });
  }

  /** A count: the balance is replaced, whatever it was. */
  async adjust(input: AdjustInkStockInput) {
    await this.assertExists(input.id);
    return this.prisma.inkColour.update({
      where: { id: input.id },
      data: { stock: input.stock },
      select: RETURN_SELECT,
    });
  }

  // ---- usage ---------------------------------------------------------------

  async usageForOrder(actor: SessionUser, orderId: string) {
    return this.prisma.inkUsage.findMany({
      where: { AND: [{ orderId }, this.scopeFor(actor)] },
      select: INK_USAGE_SELECT,
      orderBy: [{ usedAt: "desc" }, { id: "asc" }],
    });
  }

  /**
   * Draws ink from a colour for an order. The decrement and the line are one
   * transaction, and the decrement is conditional on the balance covering
   * it — so a refused draw leaves both untouched.
   */
  async recordUsage(actor: SessionUser, input: RecordInkUsageInput) {
    await this.assertOrderInScope(actor, input.orderId);
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

    return this.prisma.$transaction(async (tx) => {
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
      select: { id: true },
    });
    if (!order) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
    }
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
