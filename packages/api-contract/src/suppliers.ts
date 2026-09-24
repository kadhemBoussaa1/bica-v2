import { z } from "zod";

/**
 * Supplier families are rows in `SupplierFamily`, not a compile-time enum: an
 * ADMIN adds a purchasing category in the app rather than waiting on a schema
 * migration. So there is no `SUPPLIER_FAMILIES` constant to import — read the
 * list from `supplierFamily.list` and key on `code`.
 *
 * `code` is the stable machine key (ACCESSOIRE, SERVICE, …) and `label` is what
 * the UI renders, so a family can be renamed without breaking references to it.
 */

/**
 * Uppercase A-Z, digits and underscores. Constrained because `code` is the key
 * the list's facet chips and any future lookup-by-code rely on: allowing spaces
 * or case would recreate the `SERVICE` / `Service` duplication the legacy
 * import had to clean up.
 */
export const supplierFamilyCodeSchema = z
  .string()
  .trim()
  .min(2, "Code must be at least 2 characters")
  .max(40)
  .regex(
    /^[A-Z][A-Z0-9_]*$/,
    "Use uppercase letters, digits and underscores, e.g. EMBALLAGE",
  );

const label = z.string().trim().min(1, "Label is required").max(60);

export const createSupplierFamilyInput = z.object({
  code: supplierFamilyCodeSchema,
  label,
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

/**
 * `code` is deliberately absent: it is the stable key other data refers to, so
 * renaming is done through `label`. Changing a code would silently orphan any
 * saved filter or future lookup that used it.
 */
export const updateSupplierFamilyInput = z.object({
  id: z.string().min(1),
  label,
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const supplierFamilyIdInput = z.object({ id: z.string().min(1) });

export const setSupplierFamilyActiveInput = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});

export type CreateSupplierFamilyInput = z.infer<typeof createSupplierFamilyInput>;
export type UpdateSupplierFamilyInput = z.infer<typeof updateSupplierFamilyInput>;
