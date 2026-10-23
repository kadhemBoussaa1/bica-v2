import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
  CreateRawMaterialInput,
  GlueSlot,
  SetRawMaterialPriceInput,
  UpdateRawMaterialInput,
} from "@repo/api-contract";
import { Prisma } from "../generated/prisma/client.js";
import { runListQuery } from "../list/list-query";
import { PrismaService } from "../prisma.service";
import type { SessionUser } from "../trpc/trpc";
import {
  CURRENT_PRICE,
  MATERIAL_SELECT,
  materialListDeclaration,
  type ListMaterialsInput,
} from "./material.list";

const RETURN_SELECT = {
  id: true,
  code: true,
  label: true,
  type: true,
  active: true,
} as const;

function isUniqueViolation(cause: unknown): boolean {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002";
}

/**
 * The columns a material's type owns: a paper's supplier, paper type and
 * grammage, a carton's supplier and size, none for a glue (its default lines
 * are rows of their own). `grammage` is clearable: null clears it, omitted
 * leaves it (and on create leaves the column's null, "any grammage").
 */
function typeColumns(input: CreateRawMaterialInput | UpdateRawMaterialInput) {
  switch (input.type) {
    case "PAPER":
      return {
        supplierId: input.supplierId,
        paperType: input.paperType,
        ...(input.grammage !== undefined ? { grammage: input.grammage } : {}),
      };
    case "BOX":
      return {
        supplierId: input.supplierId,
        lengthMm: input.lengthMm,
        widthMm: input.widthMm,
        heightMm: input.heightMm,
      };
    case "GLUE":
      return {};
  }
}

/** A row's `prices` relation (at most the current one) as a single value. */
function withCurrentPrice<T extends { prices: { id: string; price: number; validFrom: Date }[] }>({
  prices,
  ...row
}: T) {
  return { ...row, currentPrice: prices[0] ?? null };
}

/**
 * The raw material price catalogue (docs/raw-material-prices-plan.md §4):
 * papers and cartons per supplier, and glues, each with an append-only price
 * history.
 *
 * Every write path is ADMIN+ (the router), and nothing here reads an order:
 * the order form takes its prefill from `forOrderForm` and writes its own
 * copy of the price it used (§3), so a price changed here never changes a
 * saved document.
 */
@Injectable()
export class MaterialService {
  constructor(private readonly prisma: PrismaService) {}

  /** Reference data, so no session-derived scope — see MachineService. */
  async list(query: ListMaterialsInput) {
    const result = await runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) =>
          this.prisma.rawMaterial.findMany({ ...args, select: MATERIAL_SELECT }),
        count: (args) => this.prisma.rawMaterial.count(args),
      },
      query,
      declaration: materialListDeclaration,
      scope: {},
    });
    return { ...result, rows: result.rows.map(withCurrentPrice) };
  }

  /** The material, its default lines and its whole price history, newest first. */
  async byId(id: string) {
    const material = await this.prisma.rawMaterial.findUnique({
      where: { id },
      select: {
        ...MATERIAL_SELECT,
        createdAt: true,
        prices: {
          orderBy: [{ validFrom: "desc" }, { id: "desc" }],
          select: {
            id: true,
            price: true,
            validFrom: true,
            validTo: true,
            comment: true,
            enteredBy: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!material) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Material not found" });
    }
    const { prices, ...rest } = material;
    return {
      ...rest,
      currentPrice: prices.find((price) => price.validTo === null) ?? null,
      history: prices,
    };
  }

  /**
   * The material, its first price and, for a glue, the lines it is the
   * default of — one transaction, so a material never exists without a price
   * (plan adjustment 14).
   */
  async create(actor: SessionUser, input: CreateRawMaterialInput) {
    await this.assertCodeFree(input.code);
    if (input.type !== "GLUE") await this.assertSupplierAssignable(input.supplierId, null);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const material = await tx.rawMaterial.create({
          data: {
            code: input.code,
            label: input.label,
            type: input.type,
            ...typeColumns(input),
            prices: {
              create: {
                price: input.price,
                validFrom: new Date(),
                enteredById: actor.id,
                comment: input.comment ?? null,
              },
            },
          },
          select: RETURN_SELECT,
        });
        if (input.type === "GLUE") await this.setDefaults(tx, material.id, input.defaultSlots);
        return material;
      });
    } catch (cause) {
      // `assertCodeFree` is a read; two creates racing to one code both pass it.
      if (isUniqueViolation(cause)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A material with code ${input.code} already exists`,
        });
      }
      throw cause;
    }
  }

  /**
   * Everything but the type and the price. The type is fixed because order
   * lines rely on it (a paper slot names a paper); the price moves only
   * through `setPrice`, which keeps the history. A glue's default lines are
   * replaced by the ones sent.
   */
  async update(input: UpdateRawMaterialInput) {
    const current = await this.prisma.rawMaterial.findUnique({
      where: { id: input.id },
      select: { type: true, active: true, supplierId: true },
    });
    if (!current) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Material not found" });
    }
    if (current.type !== input.type) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A material's type cannot change — create a new one instead",
      });
    }
    await this.assertCodeFree(input.code, input.id);
    if (input.type !== "GLUE") {
      await this.assertSupplierAssignable(input.supplierId, current.supplierId);
    } else if (!current.active && input.defaultSlots.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "An archived glue cannot be a line's default — restore it first",
      });
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const material = await tx.rawMaterial.update({
          where: { id: input.id },
          data: {
            code: input.code,
            label: input.label,
            ...typeColumns(input),
          },
          select: RETURN_SELECT,
        });
        if (input.type === "GLUE") await this.setDefaults(tx, material.id, input.defaultSlots);
        return material;
      });
    } catch (cause) {
      if (isUniqueViolation(cause)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A material with code ${input.code} already exists`,
        });
      }
      throw cause;
    }
  }

  /**
   * Archive or restore — what the UI calls "delete": price rows and, later,
   * order lines keep naming the material. Archiving takes it off every line
   * it was the default of, so the form never preselects an archived glue.
   */
  async setActive(id: string, active: boolean) {
    await this.assertExists(id);
    return this.prisma.$transaction(async (tx) => {
      if (!active) await tx.pricingSlotDefault.deleteMany({ where: { materialId: id } });
      return tx.rawMaterial.update({
        where: { id },
        data: { active },
        select: RETURN_SELECT,
      });
    });
  }

  /**
   * Closes the current price and opens the next, under a lock of the
   * material row so two admins cannot both close the same one.
   *
   * `currentPriceId` is the price the caller saw. The second of two
   * concurrent calls waits on the lock, then finds the first one's price
   * current instead of the one it saw, and gets CONFLICT rather than
   * silently replacing a price its author never saw.
   *
   * One timestamp closes the old row and opens the new, taken in code after
   * the lock: Postgres `now()` is the transaction's START, so a call that
   * waited could otherwise close a row before it opened, which the
   * `valid_range` CHECK refuses. Never earlier than the old row's start,
   * whatever the clock says.
   */
  async setPrice(actor: SessionUser, input: SetRawMaterialPriceInput) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ active: boolean }[]>`
          SELECT "active" FROM "RawMaterial" WHERE "id" = ${input.materialId} FOR UPDATE`;
        const material = locked[0];
        if (!material) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Material not found" });
        }
        if (!material.active) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This material is archived — restore it before changing its price",
          });
        }
        const current = await tx.rawMaterialPrice.findFirst({
          where: { materialId: input.materialId, validTo: null },
          select: { id: true, price: true, validFrom: true },
        });
        if (current?.id !== input.currentPriceId) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              current === null
                ? "This material has no current price"
                : `The price was changed to ${current.price} in the meantime — check it and try again`,
          });
        }
        if (current.price === input.price) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That is already the current price",
          });
        }
        const at = new Date(Math.max(Date.now(), current.validFrom.getTime()));
        await tx.rawMaterialPrice.update({
          where: { id: current.id },
          data: { validTo: at },
        });
        return tx.rawMaterialPrice.create({
          data: {
            materialId: input.materialId,
            price: input.price,
            validFrom: at,
            enteredById: actor.id,
            comment: input.comment ?? null,
          },
          select: { id: true, materialId: true, price: true, validFrom: true },
        });
      });
    } catch (cause) {
      // The partial unique index is the backstop behind the lock.
      if (isUniqueViolation(cause)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "The price was changed in the meantime — check it and try again",
        });
      }
      throw cause;
    }
  }

  /**
   * Everything the order form's prefill needs, in one read: every live
   * material with its current price, and the glue each line starts with.
   * A material without a current price is left out (none should exist —
   * `create` requires one), since a line cannot name a price it does not have.
   */
  async forOrderForm() {
    const [materials, defaults] = await this.prisma.$transaction([
      this.prisma.rawMaterial.findMany({
        where: { active: true, prices: { some: { validTo: null } } },
        orderBy: [{ type: "asc" }, { label: "asc" }, { id: "asc" }],
        select: {
          id: true,
          code: true,
          label: true,
          type: true,
          supplier: { select: { id: true, name: true } },
          paperType: true,
          grammage: true,
          // A carton's size, which the order form's carton picker searches.
          lengthMm: true,
          widthMm: true,
          heightMm: true,
          prices: CURRENT_PRICE,
        },
      }),
      this.prisma.pricingSlotDefault.findMany({
        where: { material: { active: true } },
        select: { slot: true, materialId: true },
      }),
    ]);
    return {
      materials: materials.flatMap(({ prices, ...material }) => {
        const price = prices[0];
        return price ? [{ ...material, currentPrice: price }] : [];
      }),
      defaults,
    };
  }

  /**
   * The supplier picker of the paper and carton forms: every live supplier,
   * flagged by what it has sold here — paper (`paper`: inbound paper
   * deliveries) and cartons (`boxes`: purchase orders for boxes). The form
   * lists the ones matching the material first, since the full list is over
   * a hundred names. `currentId` keeps an archived supplier a material
   * already names in the list, so editing that material does not lose it.
   */
  async supplierOptions(currentId: string | undefined) {
    const suppliers = await this.prisma.supplier.findMany({
      where: { OR: [{ active: true }, ...(currentId ? [{ id: currentId }] : [])] },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        // `shipments` is the relation's name on Supplier — inbound paper
        // deliveries, not the outbound export shipments of the same word.
        _count: {
          select: { shipments: true, purchaseOrders: { where: { category: "BOXES" } } },
        },
      },
    });
    return suppliers.map(({ _count, ...supplier }) => ({
      ...supplier,
      paper: _count.shipments > 0,
      boxes: _count.purchaseOrders > 0,
    }));
  }

  /**
   * The products page's carton picker: every live carton with its supplier
   * and size, and no price — the page is not about prices. `currentId` keeps
   * an archived carton a product already names in the list, so editing that
   * product does not lose it.
   */
  async cartonOptions(currentId: string | undefined) {
    return this.prisma.rawMaterial.findMany({
      where: { type: "BOX", OR: [{ active: true }, ...(currentId ? [{ id: currentId }] : [])] },
      orderBy: [{ label: "asc" }, { id: "asc" }],
      select: {
        id: true,
        code: true,
        label: true,
        active: true,
        lengthMm: true,
        widthMm: true,
        heightMm: true,
        supplier: { select: { name: true } },
      },
    });
  }

  /** The settings rail's figure: live materials. */
  async summary() {
    const active = await this.prisma.rawMaterial.count({ where: { active: true } });
    return { active };
  }

  /**
   * Makes `slots` exactly the lines this glue is the default of. Other glues
   * keep theirs: a line may have several defaults.
   */
  private async setDefaults(
    tx: Prisma.TransactionClient,
    materialId: string,
    slots: readonly GlueSlot[],
  ) {
    await tx.pricingSlotDefault.deleteMany({
      where: { materialId, slot: { notIn: [...slots] } },
    });
    await tx.pricingSlotDefault.createMany({
      data: slots.map((slot) => ({ slot, materialId })),
      skipDuplicates: true,
    });
  }

  /**
   * A paper's or a carton's supplier must exist, and a newly named one must
   * be live: an archived supplier stays on the materials that already name
   * it, like an archived product on its orders.
   */
  private async assertSupplierAssignable(supplierId: string, currentSupplierId: string | null) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { active: true },
    });
    if (!supplier) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "That supplier no longer exists" });
    }
    if (!supplier.active && supplierId !== currentSupplierId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "That supplier is archived and cannot be assigned",
      });
    }
  }

  private async assertExists(id: string) {
    const found = await this.prisma.rawMaterial.findUnique({ where: { id }, select: { id: true } });
    if (!found) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Material not found" });
    }
  }

  private async assertCodeFree(code: string, excludeId?: string) {
    const existing = await this.prisma.rawMaterial.findUnique({
      where: { code },
      select: { id: true },
    });
    if (existing && existing.id !== excludeId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `A material with code ${code} already exists`,
      });
    }
  }
}
