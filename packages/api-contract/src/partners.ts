import { z } from "zod";

/**
 * Input schemas for clients and suppliers ("trading partners").
 *
 * Shared by the API and the forms, so validation messages match on both sides
 * and a rule cannot drift. The web forms `safeParse` with these before calling.
 *
 * Every optional text field normalises "" -> undefined. The forms bind to
 * controlled inputs whose empty state is "", and the legacy import already
 * established that a blank contact field means absent, not an empty string.
 */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    });

/**
 * Email is validated only when non-empty: most migrated rows have none, and
 * `z.email()` on "" would block saving a record whose email is genuinely absent.
 */
const optionalEmail = z
  .string()
  .max(200)
  .optional()
  .transform((value) => value?.trim() || undefined)
  .refine(
    (value) => value === undefined || z.email().safeParse(value).success,
    { message: "Enter a valid email address, or leave it blank" },
  );

const name = z.string().trim().min(1, "Name is required").max(200);

export const createClientInput = z.object({
  name,
  taxId: optionalText(60),
  address: optionalText(300),
  email: optionalEmail,
  phone: optionalText(40),
  /**
   * When the customer relationship began — a date the user knows, distinct from
   * the row's `createdAt`. A bare YYYY-MM-DD string rather than a Date: it comes
   * from `<input type="date">`, and no tRPC transformer is configured, so a Date
   * would arrive at the server as a string anyway.
   */
  registeredAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional()
    .transform((value) => value || undefined),
});

export const updateClientInput = createClientInput.extend({
  id: z.string().min(1),
});

export const createSupplierInput = z.object({
  name,
  taxId: optionalText(60),
  address: optionalText(300),
  email: optionalEmail,
  phone: optionalText(40),
  phone2: optionalText(40),
  fax: optionalText(40),
  website: optionalText(200),
  /**
   * A `SupplierFamily` row id, or omitted for uncategorised. Validated against
   * the table by the service — an unknown id is a BAD_REQUEST, not a silent null.
   */
  familyId: z.string().min(1).optional(),
  /**
   * A percentage (19 means 19%), not a fraction. Capped at 100 and rejecting
   * negatives — the legacy data holds 0, 7 and 19.
   */
  vatRate: z
    .number()
    .min(0, "VAT rate cannot be negative")
    .max(100, "VAT rate is a percentage, so at most 100")
    .optional(),
});

export const updateSupplierInput = createSupplierInput.extend({
  id: z.string().min(1),
});

/** Archive / restore. `active: false` is what the UI calls "delete". */
export const setPartnerActiveInput = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});

export const partnerIdInput = z.object({ id: z.string().min(1) });

/**
 * Links an employee to the account they sign in with, or clears the link.
 * The account must be one the shop-floor pages admit (ADMIN and above, or
 * PRODUCTION) and one the caller outranks — checked by the service.
 */
export const linkEmployeeUserInput = z.object({
  id: z.string().min(1),
  userId: z.string().min(1).nullable(),
});
export type LinkEmployeeUserInput = z.infer<typeof linkEmployeeUserInput>;

export type CreateClientInput = z.infer<typeof createClientInput>;
export type UpdateClientInput = z.infer<typeof updateClientInput>;
export type CreateSupplierInput = z.infer<typeof createSupplierInput>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierInput>;
