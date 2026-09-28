import { z } from "zod";

/**
 * The top bar's record search — one box over every module's records.
 *
 * Below this many characters the box only filters module names, in the
 * browser: a one-letter term would match most of every table and say
 * nothing, and each server search is a row in the activity trace.
 */
export const GLOBAL_SEARCH_MIN_LENGTH = 2;

export const globalSearchInput = z.object({
  term: z.string().trim().min(GLOBAL_SEARCH_MIN_LENGTH).max(100),
});
export type GlobalSearchInput = z.infer<typeof globalSearchInput>;

/**
 * The record types the search reaches, one per module that has a record
 * page, in the sidebar's order — the order the groups fall back to when no
 * group holds a better match than another. Users and document templates
 * are left out on purpose (decided 2026-09-28); so are production runs and
 * shift requests, which have no page of their own and are reached through
 * the order and the employee they belong to.
 */
export const SEARCH_KINDS = [
  "client",
  "supplier",
  "product",
  "order",
  "machine",
  "employee",
  "roll",
  "paperShipment",
  "stockCount",
  "ink",
  "exportShipment",
  "purchaseOrder",
  "goodsReceipt",
  "purchaseInvoice",
  "salesInvoice",
] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];
