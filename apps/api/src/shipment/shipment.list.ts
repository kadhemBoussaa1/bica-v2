import { listQueryBase } from "@repo/api-contract";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import { contains, type ListDeclaration } from "../list/list-query";

/**
 * The outbound shipments list's vocabulary — a security boundary, like every
 * other `*.list.ts`: `sortBy` is a closed enum whose every key is also
 * selected, facets are keys the server maps to predicates, and search names
 * its columns explicitly.
 *
 * Everything here is prefixed `EXPORT_SHIPMENT_*` / `exportShipment*`:
 * `stock.list.ts` owns the bare `SHIPMENT_*` names for INBOUND paper
 * shipments, and the two must never be confused (docs/export-plan.md
 * "Naming trap").
 *
 * No money column anywhere in these selects: MAGASINIER reads them. The
 * invoice number is the only link to the commercial side.
 */

export const EXPORT_SHIPMENT_SORT_KEYS = ["exportDate", "numero", "client", "createdAt"] as const;
export type ExportShipmentSortKey = (typeof EXPORT_SHIPMENT_SORT_KEYS)[number];

/**
 * `draft` and `shipped` partition the table. `missingCustoms` — shipped, no
 * customs declaration number yet — is the warehouse's to-do list and
 * overlaps `shipped`, so it is declared `nonPartitioning` or "all" would
 * count those rows twice.
 */
export const EXPORT_SHIPMENT_FACET_KEYS = ["draft", "shipped", "missingCustoms"] as const;
export type ExportShipmentFacet = (typeof EXPORT_SHIPMENT_FACET_KEYS)[number];

export const exportShipmentListDeclaration: ListDeclaration<
  Prisma.ShipmentWhereInput,
  Prisma.ShipmentOrderByWithRelationInput,
  ExportShipmentSortKey,
  ExportShipmentFacet
> = {
  sortable: {
    // Drafts have no export date or number yet; keep them together at the
    // end whichever way the column is sorted.
    exportDate: (dir) => ({ exportDate: { sort: dir, nulls: "last" } }),
    numero: (dir) => ({ numero: { sort: dir, nulls: "last" } }),
    client: (dir) => ({ client: { name: dir } }),
    createdAt: (dir) => ({ createdAt: dir }),
  },
  defaultSort: "exportDate",
  // Function form: the client and invoice are relations, the order number
  // and spec live on the lines. Enum columns (`status`, `kind`) are not
  // searchable — Prisma rejects `contains` on them at runtime.
  searchable: (term) => ({
    OR: [
      { numero: contains(term) },
      { packingListNumber: contains(term) },
      { customsDeclarationNumber: contains(term) },
      { client: { name: contains(term) } },
      { salesInvoice: { numero: contains(term) } },
      { lines: { some: { order: { numero: contains(term) } } } },
      { lines: { some: { description: contains(term) } } },
    ],
  }),
  facets: {
    draft: { status: "DRAFT" },
    shipped: { status: "SHIPPED" },
    missingCustoms: { status: "SHIPPED", customsDeclarationNumber: null },
  },
  nonPartitioning: ["missingCustoms"],
};

export const EXPORT_SHIPMENT_SELECT = {
  id: true,
  numero: true,
  status: true,
  kind: true,
  exportDate: true,
  clientId: true,
  client: { select: { id: true, name: true, active: true } },
  salesInvoice: { select: { id: true, numero: true } },
  packingListNumber: true,
  customsDeclarationNumber: true,
  // The declaration's scan, so the list can tell "number recorded, scan still
  // missing" from "nothing at all" — the middle state of the v3 list's customs
  // chip. A URL, not money, so MAGASINIER may read it like the number beside it.
  customsDeclarationDocument: true,
  createdAt: true,
  // Parcels and pieces per line, summed by the service for the row's figures.
  // `units` is the packing-list snapshot (quantity × units per parcel), which
  // the row shows beside the order count; a count, so no money crosses here.
  lines: {
    select: {
      quantity: true,
      units: true,
      order: { select: { numero: true, quantityUnit: true } },
    },
  },
} satisfies Prisma.ShipmentSelect;

/**
 * Detail adds the packing-list scan and the customs date (the customs scan is
 * already in the list select), the stamps, the invoice's own lines and the
 * full line list.
 */
export const EXPORT_SHIPMENT_DETAIL_SELECT = {
  ...EXPORT_SHIPMENT_SELECT,
  packingListDocument: true,
  customsDeclarationDate: true,
  note: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
  shippedBy: { select: { id: true, name: true } },
  // The invoice's own lines, so the draft editor can show and cap against
  // the figure it bills without an (ADMIN-only) `salesInvoice.byId` call.
  // Quantity is a parcel count, not money.
  salesInvoice: {
    select: {
      id: true,
      numero: true,
      status: true,
      issuedAt: true,
      lines: { select: { orderId: true, quantity: true } },
    },
  },
  lines: {
    select: {
      id: true,
      position: true,
      orderId: true,
      description: true,
      mention: true,
      quantity: true,
      units: true,
      order: {
        select: {
          id: true,
          numero: true,
          status: true,
          quantityUnit: true,
          parcelCount: true,
        },
      },
    },
    orderBy: { position: "asc" },
  },
} satisfies Prisma.ShipmentSelect;

/** Named to avoid `listShipmentsInput` in `stock.list.ts` (inbound). */
export const listExportShipmentsInput = listQueryBase.extend({
  sortBy: z.enum(EXPORT_SHIPMENT_SORT_KEYS).default("exportDate"),
  filter: z.enum(["all", ...EXPORT_SHIPMENT_FACET_KEYS]).default("all"),
  sortDir: listQueryBase.shape.sortDir.default("desc"),
});
export type ListExportShipmentsInput = z.infer<typeof listExportShipmentsInput>;
