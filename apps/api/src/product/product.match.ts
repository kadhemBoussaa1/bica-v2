import type { PaperType, ProductSpec, TypeSac } from "@repo/api-contract";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

/**
 * Deliberately Nest-free: the importer runs a bare `PrismaClient` outside the
 * DI container (see `import-orders.ts`), so this module and everything it
 * calls must not depend on `@nestjs/common` or `PrismaService`. Used by both
 * the importer and `ProductService` (which passes its injected `PrismaService`
 * — structurally compatible with `PrismaClient` for the one method used here).
 */

/** A product's full identity: its spec, name and owning client. */
export type ProductKey = ProductSpec & {
  name: string;
  clientId: string | null;
  paperType: PaperType | null;
};

/**
 * The find-before-create match, expressed as a `where` clause. Every nullable
 * spec column is passed as its normalised value **or `null`, never
 * `undefined`**: in Prisma's `WhereInput`, `{ gussetCm: null }` compiles to
 * `IS NULL`, but `{ gussetCm: undefined }` drops the condition entirely,
 * which would match products with ANY gusset rather than none. Callers must
 * pass a `ProductKey` already run through `normaliseProductSpec`, or this
 * matches on the wrong null-vs-0 convention.
 *
 * `images` is deliberately NOT part of the key: two products with the same
 * specification are the same product whether or not someone has photographed
 * them, so artwork must never split a match and create a duplicate.
 */
export function productMatchWhere(key: ProductKey): Prisma.ProductWhereInput {
  return {
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
    name: { equals: key.name, mode: "insensitive" },
  };
}

/**
 * Finds an active product matching `key` exactly, or creates one. Ties broken
 * by `createdAt asc` (oldest wins) so a re-run converges on the same product
 * rather than picking arbitrarily among duplicates.
 *
 * Generic over the select shape so callers get back exactly the columns they
 * asked for — the importer wants only `{ id: true }`, `ProductService.create`
 * wants the full row to report back to the caller.
 */
export async function findOrCreateProduct<TSelect extends Prisma.ProductSelect>(
  db: Pick<PrismaClient, "product">,
  key: ProductKey,
  select: TSelect,
): Promise<Prisma.ProductGetPayload<{ select: TSelect }>> {
  const where = { ...productMatchWhere(key), active: true };
  const existing = await db.product.findFirst({
    where,
    select,
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  return db.product.create({
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
    },
    select,
  });
}

/**
 * The generated name for an unnamed product, in the exact form the migration
 * SQL's `order_spec` temp table produces (`o."typeSacLegacy" || ' ' ||
 * o."largeur"::text || '×' || o."longueur"::text || ...`), so a product
 * created here for an unnamed order matches one the migration already
 * created for the same spec: `"FOND_CARRE 28×28×17 · 80 g"`. SOUS_PLAT omits
 * the gusset segment, matching the SQL's `CASE WHEN typeSacLegacy <>
 * 'SOUS_PLAT'`. Postgres's `double precision::text` cast and JavaScript's
 * `String(number)` produce identical output for every dimension in the
 * legacy data (verified: whole numbers print with no decimal, fractional
 * ones print minimally, e.g. `31.5`) — see the "Float equality" risk in
 * docs/product-pricing-plan.md.
 */
export function generatedProductName(
  typeSac: TypeSac,
  widthCm: number,
  lengthCm: number,
  gussetCm: number | null,
  grammage: number,
): string {
  const gussetSegment = typeSac === "SOUS_PLAT" ? "" : `×${String(gussetCm ?? 0)}`;
  return `${typeSac} ${String(widthCm)}×${String(lengthCm)}${gussetSegment} · ${String(grammage)} g`;
}
