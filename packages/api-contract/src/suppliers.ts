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

/**
 * The code a new family is given, derived from its label rather than typed:
 * accents dropped, upper-cased, every run of anything else one underscore —
 * "Hygiène & soins" -> HYGIENE_SOINS. Shared so the create form previews
 * exactly what the server will store.
 *
 * A label that slugs to nothing the code rule accepts (Arabic script, a
 * leading digit, a single letter) gets FAMILLE_<n>, the first number not in
 * `takenCodes`: the code is a machine key, and a neutral one beats refusing
 * the label. A slug that is valid but taken is returned as is — that is the
 * same family spelled differently, and the caller refuses it.
 */
export function supplierFamilyCode(label: string, takenCodes: readonly string[]): string {
  const slug = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .slice(0, 40)
    .replace(/^_+|_+$/g, "");
  if (supplierFamilyCodeSchema.safeParse(slug).success) return slug;
  const taken = new Set(takenCodes);
  let n = 1;
  while (taken.has(`FAMILLE_${n}`)) n++;
  return `FAMILLE_${n}`;
}

const label = z.string().trim().min(1, "Label is required").max(60);

/** No `code`: the server derives it with `supplierFamilyCode`. */
export const createSupplierFamilyInput = z.object({
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

/**
 * Archive or restore. `moveToId` is for archiving only: the family's
 * suppliers go to that (active) family in the same transaction. Left out,
 * they keep the archived family — nothing is ever uncategorised by this.
 */
export const setSupplierFamilyActiveInput = z
  .object({
    id: z.string().min(1),
    active: z.boolean(),
    moveToId: z.string().min(1).optional(),
  })
  .refine((input) => input.moveToId === undefined || !input.active, {
    message: "Suppliers are only moved when a family is archived",
    path: ["moveToId"],
  })
  .refine((input) => input.moveToId !== input.id, {
    message: "Suppliers cannot be moved to the family being archived",
    path: ["moveToId"],
  });

export type CreateSupplierFamilyInput = z.infer<typeof createSupplierFamilyInput>;
export type UpdateSupplierFamilyInput = z.infer<typeof updateSupplierFamilyInput>;
