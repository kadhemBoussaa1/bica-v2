import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type { CreateProductInput, ListResult, UpdateProductInput } from "@repo/api-contract";
import { canAccess, normaliseProductSpec, toProductSpec } from "@repo/api-contract";
import type { Prisma } from "../generated/prisma/client.js";
import { runListQuery } from "../list/list-query";
import { orderScopeFor } from "../order/order.scope";
import { PrismaService } from "../prisma.service";
import type { SessionUser } from "../trpc/trpc";
import { findOrCreateProduct, productMatchWhere, type ProductKey } from "./product.match";
import {
  PRODUCT_ORDER_SELECT,
  PRODUCT_ORDER_SELECT_PRICED,
  PRODUCT_SELECT,
  productListDeclaration,
  productOrderListDeclaration,
  type ListProductsInput,
  type OrdersForProductInput,
  type ProductOrderFacet,
  type ProductOrderRow,
  type ProductOrderRowPriced,
} from "./product.list";

const RETURN_SELECT = { id: true, name: true, active: true } as const;

/** `PRODUCT_SELECT`'s `_count.orders` mapped to a plain `orderCount`. */
function withOrderCount<T extends { _count: { orders: number } }>({
  _count,
  ...product
}: T) {
  return { ...product, orderCount: _count.orders };
}

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListProductsInput) {
    const result = await runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) =>
          this.prisma.product.findMany({ ...args, select: PRODUCT_SELECT }),
        count: (args) => this.prisma.product.count(args),
      },
      query,
      declaration: productListDeclaration,
      scope: {},
    });
    return { ...result, rows: result.rows.map(withOrderCount) };
  }

  async byId(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: PRODUCT_SELECT,
    });
    if (!product) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
    }
    return withOrderCount(product);
  }

  /**
   * The orders placed for one product — the detail page's list.
   *
   * A procedure of its own rather than a nested select on `byId`, for the
   * reason `StockService.rollsForShipment` gives: this one searches, sorts
   * and pages, and embedding the whole set would fetch every order on every
   * page view to render ten of them. `byId`'s `orderCount` still gives the
   * headline figure.
   *
   * The scope is `productId` AND the caller's order scope (`orderScopeFor`,
   * the same predicate `OrderService` applies), AND-ed in before anything
   * the client sent — the client never supplies a `where`. Without the
   * second half this procedure would be a side door onto every order the
   * orders list hides from PRODUCTION: drafts, quotes, the invoicing tail.
   *
   * The select follows pricing access like `OrderService.list`: ADMIN and
   * above get `orderTotal`, everyone else a row without a money column.
   * Chosen before the query, so the unpriced figure is never fetched. Two
   * explicit branches rather than a ternary `select`, so the return type is
   * a union the web app must narrow before it touches a total, declared
   * explicitly because an inferred one would collapse to the unpriced shape.
   */
  async ordersForProduct(
    actor: SessionUser,
    input: OrdersForProductInput,
  ): Promise<
    | ListResult<ProductOrderRow, ProductOrderFacet>
    | ListResult<ProductOrderRowPriced, ProductOrderFacet>
  > {
    await this.byId(input.productId);
    const scope: Prisma.OrderWhereInput = {
      AND: [{ productId: input.productId }, orderScopeFor(actor.role)],
    };
    if (canAccess(actor.role, "ADMIN")) {
      return runListQuery({
        prisma: this.prisma,
        delegate: {
          findMany: (args) =>
            this.prisma.order.findMany({ ...args, select: PRODUCT_ORDER_SELECT_PRICED }),
          count: (args) => this.prisma.order.count(args),
        },
        query: input,
        declaration: productOrderListDeclaration,
        scope,
      });
    }
    return runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) =>
          this.prisma.order.findMany({ ...args, select: PRODUCT_ORDER_SELECT }),
        count: (args) => this.prisma.order.count(args),
      },
      query: input,
      declaration: productOrderListDeclaration,
      scope,
    });
  }

  /**
   * The order form's picker: active products visible to `clientId` — that
   * client's own plus the shared (`clientId: null`) ones. `clientId: null`
   * lists shared products only, for an order that has no client yet.
   *
   * Not paginated, like `supplierFamily.list`: this fills a `<select>`, which
   * needs the whole list at once, and a client's product catalogue is not
   * expected to outgrow a picker.
   */
  async forClient(clientId: string | null) {
    const products = await this.prisma.product.findMany({
      where: {
        active: true,
        OR: [{ clientId }, { clientId: null }],
      },
      select: PRODUCT_SELECT,
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return products.map(withOrderCount);
  }

  /**
   * `reused` tells the caller (the order form, mainly) whether this matched
   * an existing product or created a new one, so it can say so explicitly.
   * Done as an explicit find-then-create, rather than through
   * `findOrCreateProduct`, only so the two branches can be told apart —
   * `findOrCreateProduct` itself returns a plain row either way, which is
   * what the importer and `OrderService` want.
   */
  async create(input: CreateProductInput) {
    await this.assertClientAssignable(input.clientId);
    const key = this.toKey(input);

    const existing = await this.prisma.product.findFirst({
      where: { ...productMatchWhere(key), active: true },
      select: RETURN_SELECT,
      orderBy: { createdAt: "asc" },
    });
    if (existing) return { ...existing, reused: true };

    const created = await this.prisma.product.create({
      data: {
        name: key.name,
        clientId: key.clientId,
        typeSac: key.typeSac,
        widthCm: key.widthCm,
        lengthCm: key.lengthCm,
        gussetCm: key.gussetCm,
        pleatWidthCm: key.pleatWidthCm,
        pleatLengthCm: key.pleatLengthCm,
        grammage: key.grammage,
        paperType: key.paperType,
        hasHandle: key.hasHandle,
        handleWeightG: key.handleWeightG,
        images: input.images ?? [],
      },
      select: RETURN_SELECT,
    });
    return { ...created, reused: false };
  }

  /**
   * No merge-on-match: unlike `create`, which dedupes against an existing
   * product, editing an existing one always writes exactly what was submitted
   * — the user is looking at this specific row, not asking "give me something
   * like this".
   */
  async update(input: UpdateProductInput) {
    await this.assertExists(input.id);
    await this.assertClientAssignable(input.clientId);
    const key = this.toKey(input);
    return this.prisma.product.update({
      where: { id: input.id },
      data: {
        name: key.name,
        clientId: key.clientId,
        typeSac: key.typeSac,
        widthCm: key.widthCm,
        lengthCm: key.lengthCm,
        gussetCm: key.gussetCm,
        pleatWidthCm: key.pleatWidthCm,
        pleatLengthCm: key.pleatLengthCm,
        grammage: key.grammage,
        paperType: key.paperType,
        hasHandle: key.hasHandle,
        handleWeightG: key.handleWeightG,
        ...this.writableImages(input),
      },
      select: RETURN_SELECT,
    });
  }

  /**
   * `images` is written only when the input carries it. Omitting it means
   * "leave the stored artwork alone" rather than "clear it" — a form that
   * does not render the field must not be able to wipe 467 migrated URLs by
   * simply not sending one. Passing `[]` explicitly still clears it, which is
   * how a real "remove all artwork" action would work.
   */
  private writableImages(input: UpdateProductInput) {
    return input.images === undefined ? {} : { images: input.images };
  }

  /**
   * Archive or restore. Never locked, never deleted: a product with orders
   * stays editable and archiving does not touch them — see the model comment.
   */
  async setActive(id: string, active: boolean) {
    await this.assertExists(id);
    return this.prisma.product.update({
      where: { id },
      data: { active },
      select: RETURN_SELECT,
    });
  }

  /**
   * Used by `OrderService.resolveProduct` when an order defines a new product
   * inline. `db` is the order's transaction, so a product created here rolls
   * back with a failed order insert.
   */
  async findOrCreate(key: ProductKey, db: Prisma.TransactionClient = this.prisma) {
    return findOrCreateProduct(db, key, PRODUCT_SELECT);
  }

  /** Existence only — `byId`'s full select and order count are not needed to write. */
  private async assertExists(id: string) {
    const found = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
    }
  }

  private toKey(input: CreateProductInput): ProductKey {
    const normalised = normaliseProductSpec(toProductSpec(input));
    return {
      ...normalised,
      name: input.name,
      clientId: input.clientId ?? null,
      paperType: input.paperType ?? null,
    };
  }

  private async assertClientAssignable(clientId: string | undefined) {
    if (clientId === undefined) return;
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, active: true },
    });
    if (!client) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "That client no longer exists" });
    }
    if (!client.active) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "That client is archived and cannot be assigned",
      });
    }
  }
}
