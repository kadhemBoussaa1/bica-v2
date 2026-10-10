import { z } from "zod";
import type { TypeSac } from "./orders.js";
import type { ProductSpec } from "./pricing.js";
import { productSpecInput } from "./pricing.js";
import { createUploadInput } from "./storage.js";

/**
 * The canonical spec form. **The one definition** of what "null" vs "0" means
 * for each nullable spec column: SOUS_PLAT has no gusset, no pleats and no
 * handle; a FOND bag's gusset is `0` when absent, never `null`, but its pleats
 * stay `null` when absent rather than becoming `0`; `hasHandle: false` forces
 * `handleWeightG` to `null`.
 *
 * Every product ever written goes through this — the migration SQL, the
 * importer, `ProductService.create`/`update`, `OrderService.resolveProduct` —
 * or two specs that are conceptually identical stop matching each other, both
 * in the null-safe find-before-create in code and in the migration's
 * `DISTINCT ON`. If this rule ever needs to change, the migration SQL's
 * `order_spec` temp table must change with it.
 */
export function normaliseProductSpec(input: ProductSpec): ProductSpec {
  if (input.typeSac === "SOUS_PLAT") {
    return {
      typeSac: "SOUS_PLAT",
      widthCm: input.widthCm,
      lengthCm: input.lengthCm,
      gussetCm: null,
      pleatWidthCm: null,
      pleatLengthCm: null,
      grammage: input.grammage,
      hasHandle: false,
      handleWeightG: null,
    };
  }
  const hasHandle = input.hasHandle;
  return {
    typeSac: input.typeSac,
    widthCm: input.widthCm,
    lengthCm: input.lengthCm,
    gussetCm: input.gussetCm ?? 0,
    pleatWidthCm: input.pleatWidthCm ?? null,
    pleatLengthCm: input.pleatLengthCm ?? null,
    grammage: input.grammage,
    hasHandle,
    handleWeightG: hasHandle ? (input.handleWeightG ?? null) : null,
  };
}

/**
 * The columns `productSpecFromRow` reads off a stored `Product` (or an
 * order's snapshotted spec). A structural type, not the generated Prisma row,
 * so this package stays Prisma-free — see the module comment on `pricing.ts`.
 * Also used by the web live panel, built straight from a tRPC row.
 */
export interface ProductSpecRow {
  typeSac: TypeSac;
  widthCm: number;
  lengthCm: number;
  gussetCm: number | null;
  pleatWidthCm: number | null;
  pleatLengthCm: number | null;
  grammage: number;
  hasHandle: boolean;
  handleWeightG: number | null;
}

/** Prisma row (or tRPC output row) -> engine `ProductSpec`. No renaming: the columns already match. */
export function productSpecFromRow(row: ProductSpecRow): ProductSpec {
  return {
    typeSac: row.typeSac,
    widthCm: row.widthCm,
    lengthCm: row.lengthCm,
    gussetCm: row.gussetCm,
    pleatWidthCm: row.pleatWidthCm,
    pleatLengthCm: row.pleatLengthCm,
    grammage: row.grammage,
    hasHandle: row.hasHandle,
    handleWeightG: row.handleWeightG,
  };
}

/**
 * A spec is "incomplete" — not priceable, and must never show a unit price of
 * 0 — when its width, length or grammage is not a positive number. This is
 * the state of the 11 migrated products with `grammage = 0`: valid rows that
 * fail `productSpecInput`, tagged INCOMPLETE in the UI rather than fixed by
 * the migration, since there is no value to fix them with.
 */
export function isIncompleteSpec(spec: ProductSpecRow): boolean {
  return !(spec.widthCm > 0 && spec.lengthCm > 0 && spec.grammage > 0);
}

/**
 * A product's name, added to the spec Zod already validates. `safeExtend`
 * because `productSpecInput` is a refined object: `.extend()` would throw on
 * overwriting a key it does not do here, but `.pick()`/`.omit()`/`.partial()`
 * would silently drop the `superRefine` rules — never use those on
 * `productSpecInput`.
 */
export const createProductInput = productSpecInput.safeExtend({
  name: z.string().trim().min(1, "Name is required").max(200),
  clientId: z.string().min(1).optional(),
  /**
   * Artwork and reference photos of the bag.
   *
   * Optional on **both** create and update, and omitting it preserves what is
   * stored rather than clearing it — the same rule `Order.images` needed
   * before the move, and for the same reason: a form that does not render the
   * field must not be able to wipe it by simply not sending it. On create
   * there is nothing to preserve, so the service treats absent as empty.
   *
   * Declared once here rather than overridden on `updateProductInput`: Zod
   * types an overwrite of an existing key as `never` even where `safeExtend`
   * permits it at runtime, and a cast to get around that would be hiding a
   * real rule, not expressing one.
   */
  images: z.array(z.string().max(1000)).max(50).optional(),
});

export const updateProductInput = createProductInput.extend({
  id: z.string().min(1),
});

export type CreateProductInput = z.infer<typeof createProductInput>;
export type UpdateProductInput = z.infer<typeof updateProductInput>;

/**
 * What a product's artwork may be: images a browser draws in an `<img>`,
 * since every place `images` surfaces (the product page, the order card and
 * detail) renders it as one. No PDF, and no HEIC or TIFF, which Chrome cannot
 * display — the same narrowing as an employee's photo, for the same reason.
 */
export const PRODUCT_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * A presigned PUT for one artwork image. No product id: the new-product form
 * uploads before the record exists, so — like the employee photo — the gate
 * is the procedure's rank, and the URL is checked against this app's bucket
 * when it is saved onto a product.
 */
export const productImageUploadInput = createUploadInput.extend({
  contentType: z.enum(PRODUCT_IMAGE_CONTENT_TYPES),
});
export type ProductImageUploadInput = z.infer<typeof productImageUploadInput>;

/**
 * Appends one uploaded image to a product's artwork, for the order page's
 * "add artwork" — which has the product's id but not its whole spec, so it
 * cannot go through `updateProductInput` without rewriting every column.
 */
export const addProductImageInput = z.object({
  productId: z.string().min(1),
  url: z.string().max(1000),
});
export type AddProductImageInput = z.infer<typeof addProductImageInput>;
