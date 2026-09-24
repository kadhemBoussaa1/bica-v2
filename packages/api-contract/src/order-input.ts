import { z } from "zod";
import { ORDER_KINDS, ORDER_STATUSES, TYPE_IMPRESSIONS, optionalText } from "./orders.js";
import { pricingInput } from "./pricing.js";
import { createProductInput } from "./products.js";

/**
 * Order create/update input. Split into its own module, not `orders.ts`,
 * because it composes `pricingInput` and `createProductInput` — see the note
 * in `orders.ts` on why that dependency direction cannot run the other way.
 */

/**
 * Which product an order names: an existing one by id, or a brand-new spec
 * defined inline. `new` is `createProductInput` plus the literal discriminant
 * as a genuinely new key, which keeps `productSpecInput`'s `superRefine`
 * intact — see the Zod 4.5.4 note in the pricing plan: `.extend()` with a new
 * key preserves refinements, and a refined object is a valid
 * `z.discriminatedUnion` member.
 */
const existingProductRef = z.object({
  mode: z.literal("existing"),
  id: z.string().min(1),
});
const newProductRef = createProductInput.extend({ mode: z.literal("new") });
export const orderProductRef = z.discriminatedUnion("mode", [
  existingProductRef,
  newProductRef,
]);
export type OrderProductRef = z.infer<typeof orderProductRef>;

/**
 * Fields shared by create and update. `pricingInput`'s shape is spread in
 * directly — it deliberately has no `legacyGlueCostPerUnit` (see the doc
 * comment on `pricingInput`), so nothing here can set that column; the server
 * reads it from the stored row on update and writes `null` on create.
 *
 * The four "negotiated" fields (`clientParcelPrice`, `salePrice`,
 * `clientPiecesPerParcel`, `parcelMarginPct`) were removed with their columns
 * (2026-09-18): they were recorded alongside the computed figures and never
 * fed the pricing engine, so nothing derived from them. `nombreCouleurs` went
 * the same way — the ink list on `Product`/`OrderColour` is the record of what
 * a job prints, and the loose count was never reconciled against it.
 */
const orderBase = z.object({
  // No `numero` here: it is allocated by the server on create and only
  // editable afterwards, so the two sides of this input disagree about it.
  // See `createOrderInput` / `updateOrderInput` below.
  description: optionalText(500),
  clientId: z.string().min(1).optional(),

  product: orderProductRef,

  // Required by the legacy schema, so required here.
  quantite: z.number().min(0, "Quantity cannot be negative").max(1e9),

  ...pricingInput.shape,

  // `kind`, `status` and `exportStatus` are not fields of this SHARED input —
  // see docs/order-lifecycle-plan.md §5: `kind` is set once at creation (the
  // quote-vs-order choice on `createOrderInput` below, never on update — see
  // `acceptQuoteInput` for the only way it ever changes) and `status`
  // moves exclusively through `transitionOrderInput` below. The four legacy
  // booleans they replace (okFacturation/okExport/produitFini/offreDePrix)
  // are removed from this input entirely, not merely left optional — the
  // columns themselves are still written by `OrderService` from the mapped
  // status during the soak period (plan §6 steps 1-4), but never again from
  // client input.
  //
  // `exportStatus` left this input with the workflow section of the order form
  // (2026-09-18). It is set only by the two transitions that own it
  // (`INVOICED` -> `READY_FOR_EXPORT` sets PREPARATION, `READY_FOR_EXPORT` ->
  // `COMPLETED` sets EXPORTED). While it was a form field the server wrote
  // `input.exportStatus ?? null`, so saving the edit form with the select left
  // blank silently nulled a value a transition had just set.

  // No paper figures. The need (`metrageNecessaire`) is a pricing-snapshot
  // column computed on every save, and what is reserved or consumed is the
  // sum of the order's `RollAllocation` rows — docs/roll-allocation-plan.md.
  // The legacy running totals (`poidsReserve`, `poidsConsomme`) are importer
  // columns the app no longer writes.

  // What the print job is, not who does it — the assignment fields were
  // removed with the RBAC change. See the Order model.
  typeImpression: z.enum(TYPE_IMPRESSIONS).optional(),
});

/**
 * Neither carries `images` any more: artwork moved to `Product` (2026-09-03),
 * since it describes the bag rather than the run. It is edited through
 * `createProductInput`/`updateProductInput`, and an order reaches it through
 * its product.
 */
/**
 * `numero` is NOT an input on create (2026-09-18): `OrderService.create`
 * allocates it from `OrderCounter` inside the insert, so the client cannot
 * choose, guess or collide with one. The form no longer shows the field at
 * all — the number exists only once the order does.
 */
export const createOrderInput = orderBase.extend({
  /**
   * Quote or order, chosen once when the document is drafted (2026-09-21).
   * Create-only on purpose: `updateOrderInput` has no `kind`, so the one way
   * it changes afterwards stays `acceptQuoteInput` (QUOTE -> ORDER, one-way,
   * stamped). Defaults to ORDER, which is what every create was before.
   */
  kind: z.enum(ORDER_KINDS).default("ORDER"),
});

/**
 * Update still carries `numero`, and still requires it: an existing order
 * has one, the edit form shows it, and someone correcting a legacy number
 * must be able to. `assertNumeroFree` keeps it unique.
 */
export const updateOrderInput = orderBase.extend({
  id: z.string().min(1),
  numero: z.string().trim().min(1, "Order number is required").max(60),
});

export type CreateOrderInput = z.infer<typeof createOrderInput>;
export type UpdateOrderInput = z.infer<typeof updateOrderInput>;

/**
 * The only way `status` ever changes post-creation — see
 * docs/order-lifecycle-plan.md §3. `note` is optional here and required by
 * specific transitions (cancel, either reopen); `OrderService.transition`
 * enforces that against `OrderTransition.noteRequired`, not this schema,
 * because whether it is required depends on which transition `to` resolves
 * to from the order's current status, which this input alone cannot express.
 *
 * `exportStatus` is never part of this input: the two transitions that
 * touch it (`INVOICED` -> `READY_FOR_EXPORT` sets PREPARATION,
 * `READY_FOR_EXPORT` -> `COMPLETED` sets EXPORTED) set it as an automatic
 * side effect (plan §3), not a client-supplied value.
 */
export const transitionOrderInput = z.object({
  orderId: z.string().min(1),
  to: z.enum(ORDER_STATUSES),
  note: optionalText(500),
});
export type TransitionOrderInput = z.infer<typeof transitionOrderInput>;

/** The `kind` axis's one transition, QUOTE -> ORDER — plan §3.1. */
export const acceptQuoteInput = z.object({
  orderId: z.string().min(1),
});
export type AcceptQuoteInput = z.infer<typeof acceptQuoteInput>;
