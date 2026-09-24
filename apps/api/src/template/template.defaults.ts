import { TRPCError } from "@trpc/server";
import {
  DEFAULT_SALES_INVOICE_LAYOUT,
  LAYOUT_SCHEMA_VERSION,
  salesInvoiceLayoutSchema,
  type SalesInvoiceLayout,
} from "@repo/api-contract";
import type { Db } from "../order/order.service";

/*
 * The default sales invoice template, and how an invoice finds its layout.
 *
 * There is no seed step: the first invoice ever issued creates the default
 * template and its version 1 from `DEFAULT_SALES_INVOICE_LAYOUT`, inside its
 * own transaction. A deployment where `db:seed` never ran still issues
 * invoices, and every issued invoice pins a real row — there is no
 * "null means built-in" case to carry around for new invoices.
 */

/** Fixed ids, so creating the built-in rows is an idempotent insert rather than a race. */
const BUILTIN_TEMPLATE_ID = "builtin-sales-invoice";
const BUILTIN_VERSION_ID = "builtin-sales-invoice-v1";

const DEFAULT_PUBLISHED_VERSION = {
  where: {
    publishedAt: { not: null },
    template: { kind: "SALES_INVOICE", isDefault: true },
  },
  orderBy: { version: "desc" },
} as const;

/**
 * The id of the version a newly issued invoice pins: the default template's
 * latest published version, created from the built-in layout when there is
 * none. Call it inside the issuing transaction.
 *
 * `ON CONFLICT DO NOTHING` rather than create-and-catch: a unique violation
 * aborts a Postgres transaction, so a caught error would still lose the
 * issue. Two first issues racing both run the inserts, one of them writes,
 * and both read the same row back.
 */
export async function ensureDefaultSalesInvoiceVersion(tx: Db): Promise<string> {
  const found = await tx.documentTemplateVersion.findFirst({
    ...DEFAULT_PUBLISHED_VERSION,
    select: { id: true },
  });
  if (found) return found.id;

  await tx.$executeRaw`
    INSERT INTO "DocumentTemplate" ("id", "kind", "name", "isDefault", "updatedAt")
    VALUES (${BUILTIN_TEMPLATE_ID}, 'SALES_INVOICE'::"DocumentTemplateKind", 'Bicapack', true, now())
    ON CONFLICT DO NOTHING`;
  await tx.$executeRaw`
    INSERT INTO "DocumentTemplateVersion"
      ("id", "templateId", "version", "schemaVersion", "layout", "publishedAt")
    VALUES (${BUILTIN_VERSION_ID}, ${BUILTIN_TEMPLATE_ID}, 1, ${LAYOUT_SCHEMA_VERSION},
      ${JSON.stringify(DEFAULT_SALES_INVOICE_LAYOUT)}::jsonb, now())
    ON CONFLICT DO NOTHING`;

  const created = await tx.documentTemplateVersion.findFirst({
    ...DEFAULT_PUBLISHED_VERSION,
    select: { id: true },
  });
  if (!created) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "No default sales invoice template could be found or created",
    });
  }
  return created.id;
}

/**
 * The layout an invoice prints with: its pinned version, or — for a draft
 * and for the migrated invoices, which pin nothing — the current default,
 * falling back to the built-in layout while no template row exists yet.
 *
 * A pinned layout that no longer parses is an error, not a fallback: quietly
 * restyling an issued invoice is the one thing pinning exists to prevent.
 */
export async function salesInvoiceLayoutFor(
  db: Db,
  templateVersionId: string | null,
): Promise<SalesInvoiceLayout> {
  const version =
    templateVersionId !== null
      ? await db.documentTemplateVersion.findUnique({
          where: { id: templateVersionId },
          select: { id: true, layout: true },
        })
      : await db.documentTemplateVersion.findFirst({
          ...DEFAULT_PUBLISHED_VERSION,
          select: { id: true, layout: true },
        });
  if (!version) {
    if (templateVersionId === null) return DEFAULT_SALES_INVOICE_LAYOUT;
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The invoice's template version is missing" });
  }
  const parsed = salesInvoiceLayoutSchema.safeParse(version.layout);
  if (!parsed.success) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Template version ${version.id} does not hold a valid layout`,
    });
  }
  return parsed.data;
}
