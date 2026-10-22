import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import {
  MATERIAL_LINE_KEYS,
  MATERIAL_LINE_SLOTS,
  materialTypeForSlot,
  PRICING_SLOTS,
  slotUsedBy,
  type OrderMaterialsInput,
  type PricingSlot,
  type SlotKiloPrices,
  type TypeSac,
} from "@repo/api-contract";
import type { Prisma } from "../generated/prisma/client.js";
import { CURRENT_PRICE } from "./material.list";

/** What a database handle must offer here: the service's client or a transaction. */
type Db = Prisma.TransactionClient;

/** One order line as it will be written: the price, and where it came from. */
export interface ResolvedLine {
  materialId: string | null;
  label: string | null;
  supplierName: string | null;
  kiloPrice: number;
  sourcePriceId: string | null;
  manual: boolean;
}

/** The four slots of a save: a line to write, or null for none. */
export type ResolvedLines = Record<PricingSlot, ResolvedLine | null>;

/** The words a refusal uses for a slot. */
const SLOT_NAMES: Record<PricingSlot, string> = {
  PAPER: "paper",
  HANDLE_GLUE: "handle glue",
  SIDE_GLUE: "side glue",
  BASE_ADHESIVE: "base adhesive",
};

/** The engine's four kilo prices from a save's resolved lines. */
export function kiloPricesFromResolved(lines: ResolvedLines): SlotKiloPrices {
  return {
    paper: lines.PAPER?.kiloPrice ?? null,
    handleGlue: lines.HANDLE_GLUE?.kiloPrice ?? null,
    sideGlue: lines.SIDE_GLUE?.kiloPrice ?? null,
    baseAdhesive: lines.BASE_ADHESIVE?.kiloPrice ?? null,
  };
}

/**
 * Makes an order's lines exactly `lines`: each slot upserted or deleted. The
 * one write path into `OrderMaterialPrice`, shared by `OrderPriceService` and
 * the importer.
 */
async function writeLines(db: Db, orderId: string, lines: ResolvedLines) {
  for (const slot of PRICING_SLOTS) {
    const line = lines[slot];
    if (line === null) {
      await db.orderMaterialPrice.deleteMany({ where: { orderId, slot } });
    } else {
      await db.orderMaterialPrice.upsert({
        where: { orderId_slot: { orderId, slot } },
        create: { orderId, slot, ...line },
        update: line,
      });
    }
  }
}

/**
 * The importer's lines (docs/raw-material-prices-plan.md §7): the legacy
 * kilo prices as lines carried over from before the catalogue — no material,
 * no source price — exactly as the migration copied the existing ones. A
 * plain function rather than the service, because the importer runs outside
 * Nest; it goes through the same writer.
 */
export async function writeCarriedOverLines(db: Db, orderId: string, prices: SlotKiloPrices) {
  const carried = (kiloPrice: number | null): ResolvedLine | null =>
    kiloPrice === null
      ? null
      : { materialId: null, label: null, supplierName: null, kiloPrice, sourcePriceId: null, manual: false };
  await writeLines(db, orderId, {
    PAPER: carried(prices.paper),
    HANDLE_GLUE: carried(prices.handleGlue),
    SIDE_GLUE: carried(prices.sideGlue),
    BASE_ADHESIVE: carried(prices.baseAdhesive),
  });
}

/**
 * An order's four material lines: the paper and glue kilo prices it is
 * calculated with, copied from the catalogue (or typed over it) and never
 * changed by a catalogue price change — docs/raw-material-prices-plan.md §3.
 *
 * The only writer of `OrderMaterialPrice` besides the importer. It never
 * decides WHETHER an order's lines may change — `OrderService` does, by
 * `isPricingLocked`, and calls this only for an open order.
 */
@Injectable()
export class OrderPriceService {
  /**
   * Resolves an open order's save into the lines to write, inside the
   * order's own transaction (after its row lock, on update).
   *
   * The server is never sent a catalogue PRICE, only which one the form
   * showed: a `catalog` line whose material has moved on since is refused
   * with CONFLICT, so the user never saves a total they did not see.
   * `orderId` is null on create, where `keep` has nothing to keep.
   */
  async resolve(
    db: Db,
    materials: OrderMaterialsInput,
    product: { typeSac: TypeSac; hasHandle: boolean },
    orderId: string | null,
  ): Promise<ResolvedLines> {
    const stored = orderId
      ? await db.orderMaterialPrice.findMany({
          where: { orderId },
          select: {
            slot: true,
            materialId: true,
            label: true,
            supplierName: true,
            kiloPrice: true,
            sourcePriceId: true,
            manual: true,
          },
        })
      : [];

    const resolved = {} as ResolvedLines;
    for (const key of MATERIAL_LINE_KEYS) {
      const slot = MATERIAL_LINE_SLOTS[key];
      const line = materials[key];
      const name = SLOT_NAMES[slot];

      if (line === null) {
        resolved[slot] = null;
        continue;
      }

      const current = stored.find((row) => row.slot === slot);
      if (line.mode === "keep") {
        if (!current) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `There is no ${name} price to keep`,
          });
        }
        resolved[slot] = {
          materialId: current.materialId,
          label: current.label,
          supplierName: current.supplierName,
          kiloPrice: current.kiloPrice,
          sourcePriceId: current.sourcePriceId,
          manual: current.manual,
        };
        continue;
      }

      if (!slotUsedBy(slot, product)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            product.typeSac === "SOUS_PLAT"
              ? `A SOUS_PLAT sheet is not glued — remove the ${name} line`
              : `This bag has no handle — remove the ${name} line`,
        });
      }

      const material = await db.rawMaterial.findUnique({
        where: { id: line.materialId },
        select: {
          id: true,
          type: true,
          label: true,
          active: true,
          supplier: { select: { name: true } },
          prices: CURRENT_PRICE,
        },
      });
      if (!material) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That material no longer exists" });
      }
      if (material.type !== materialTypeForSlot(slot)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${material.label} cannot price the ${name} line`,
        });
      }
      const price = material.prices[0] ?? null;
      const named = {
        materialId: material.id,
        label: material.label,
        supplierName: material.supplier?.name ?? null,
      };

      if (line.mode === "catalog") {
        if (!material.active) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${material.label} is archived and cannot be chosen`,
          });
        }
        if (price?.id !== line.priceId) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `The catalogue price of ${material.label} has changed${price ? ` to ${price.kiloPrice}` : ""} — check it and save again`,
          });
        }
        resolved[slot] = { ...named, kiloPrice: price.kiloPrice, sourcePriceId: price.id, manual: false };
        continue;
      }

      // Manual: an archived material only where the line already names it,
      // so an old draft stays saveable but nobody newly picks one.
      if (!material.active && current?.materialId !== material.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${material.label} is archived and cannot be chosen`,
        });
      }
      resolved[slot] = {
        ...named,
        kiloPrice: line.kiloPrice,
        sourcePriceId: price?.id ?? null,
        manual: true,
      };
    }
    return resolved;
  }

  /** Writes a save's resolved lines onto the order. */
  async write(db: Db, orderId: string, lines: ResolvedLines) {
    await writeLines(db, orderId, lines);
  }

  /**
   * "Update prices" on an open order: every line that came from the
   * catalogue moves to its material's current price. Manual lines stay —
   * someone typed them on purpose — and so do lines on an archived material,
   * which has nothing to offer the order any more. Returns the lines as they
   * stand afterwards, and how many moved.
   */
  async refresh(db: Db, orderId: string) {
    const lines = await db.orderMaterialPrice.findMany({
      where: { orderId },
      select: {
        slot: true,
        kiloPrice: true,
        manual: true,
        sourcePriceId: true,
        material: {
          select: {
            label: true,
            active: true,
            supplier: { select: { name: true } },
            prices: CURRENT_PRICE,
          },
        },
      },
    });
    let moved = 0;
    const after: { slot: PricingSlot; kiloPrice: number }[] = [];
    for (const line of lines) {
      const price = line.material?.prices[0];
      if (!line.manual && line.material?.active && price && price.id !== line.sourcePriceId) {
        await db.orderMaterialPrice.update({
          where: { orderId_slot: { orderId, slot: line.slot } },
          data: {
            kiloPrice: price.kiloPrice,
            sourcePriceId: price.id,
            label: line.material.label,
            supplierName: line.material.supplier?.name ?? null,
          },
        });
        moved += 1;
        after.push({ slot: line.slot, kiloPrice: price.kiloPrice });
      } else {
        after.push({ slot: line.slot, kiloPrice: line.kiloPrice });
      }
    }
    return { lines: after, moved };
  }
}
