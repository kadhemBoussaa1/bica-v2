"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Filter } from "@repo/ui/data-table";
import type {
  OrderFulfilment,
  PurchaseCategory,
  PurchasingFacet,
  ReceiptStatus,
  StretchFilmType,
} from "api/src/purchasing/purchasing.list";
import records from "../records/records.module.css";
import invoices from "../invoices/invoices.module.css";
import styles from "./purchasing.module.css";
import { CategoryIcon } from "./category-icons";

/*
 * The pieces the purchase-order and goods-receipt pages share: the category
 * and status badges, the facet chips, and the two lines tables. The lines
 * tables reuse the invoice module's table styles — a record with an ordered
 * list of lines is the same shape whichever document it is.
 */

/**
 * The nine chips, in the order the server declares them
 * (`PURCHASING_FACET_KEYS`) — which is the order the factory thinks in:
 * paper first as the raw material, then what goes into making a bag, then
 * what goes around it, then services and everything else.
 */
const PURCHASING_FACETS: readonly PurchasingFacet[] = [
  "PAPER",
  "INK",
  "PLATE",
  "GLUE",
  "BOXES",
  "PALLETS",
  "STRETCH_FILM",
  "TRANSPORT",
  "MISC",
];

/**
 * Labelled from the `enums` namespace rather than a chip-specific one: the
 * facet keys ARE the enum values now, so the badge on a row and the chip that
 * filters to it read the same word in every language, and there is no second
 * set of translations to drift.
 */
export function usePurchasingFilters(): ReadonlyArray<Filter & { key: PurchasingFacet }> {
  const enums = useTranslations("enums");
  return PURCHASING_FACETS.map((key) => ({
    key,
    label: enums(`purchaseCategory.${key}`),
    icon: <CategoryIcon category={key} />,
  }));
}

export function CategoryBadge({ category }: { category: PurchaseCategory }) {
  const enums = useTranslations("enums");
  return (
    <span className={[records.statusBadge, records.statusNeutral].filter(Boolean).join(" ")}>
      {enums(`purchaseCategory.${category}`)}
    </span>
  );
}

const STATUS_CLASS: Record<ReceiptStatus, string | undefined> = {
  PENDING: records.statusWarning,
  PARTIAL: records.statusInfo,
  COMPLETE: records.statusSuccess,
};

/**
 * Pending / partial / received, as the legacy note recorded it. Transport
 * receipts have no status at all (a service is not received in parts), so
 * the badge is absent rather than invented.
 */
export function ReceiptStatusBadge({ status }: { status: ReceiptStatus | null }) {
  const enums = useTranslations("enums");
  if (status === null) return <span className={records.absent} />;
  return (
    <span className={[records.statusBadge, STATUS_CLASS[status]].filter(Boolean).join(" ")}>
      {enums(`receiptStatus.${status}`)}
    </span>
  );
}

const FULFILMENT_CLASS: Record<OrderFulfilment, string | undefined> = {
  PENDING: records.statusWarning,
  PARTIAL: records.statusInfo,
  RECEIVED: records.statusSuccess,
};

/**
 * How much of an order has arrived, derived by the server from its lines'
 * received quantities rather than stored on the order.
 *
 * Deliberately the same three colours as `ReceiptStatusBadge`: an order
 * awaiting delivery and the receipt that is still pending against it are the
 * same fact seen from two sides, so they should not read differently.
 */
export function FulfilmentBadge({ fulfilment }: { fulfilment: OrderFulfilment }) {
  const t = useTranslations("purchasing");
  return (
    <span className={[records.statusBadge, FULFILMENT_CLASS[fulfilment]].filter(Boolean).join(" ")}>
      {t(`fulfilment.${fulfilment}`)}
    </span>
  );
}

const qty = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
const amount = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

export function formatQty(value: number | null): string | null {
  return value === null ? null : qty.format(value);
}

// ---------------------------------------------------------------------------
// Per-category dimensions
// ---------------------------------------------------------------------------

/** The dimension columns a line can carry; which ones apply depends on the category. */
export interface LineDimensions {
  grammage: number | null;
  laize: number | null;
  length: number | null;
  width: number | null;
  height: number | null;
  thickness: number | null;
  filmType: StretchFilmType | null;
  colourCount: number | null;
  unitSurface?: number | null;
}

type Translate = (key: string) => string;

/** The header is `dimensions.<key>` in the purchasing namespace. */
interface DimensionColumn {
  key: keyof LineDimensions;
  render: (line: LineDimensions, t: Translate) => ReactNode;
}

const figure = (value: number | null | undefined) =>
  value === null || value === undefined ? <span className={records.absent} /> : qty.format(value);

const DIMENSION_COLUMNS: readonly DimensionColumn[] = [
  { key: "grammage", render: (l) => figure(l.grammage) },
  { key: "laize", render: (l) => figure(l.laize) },
  { key: "length", render: (l) => figure(l.length) },
  { key: "width", render: (l) => figure(l.width) },
  { key: "height", render: (l) => figure(l.height) },
  { key: "thickness", render: (l) => figure(l.thickness) },
  {
    key: "filmType",
    render: (l, t) =>
      l.filmType === null ? (
        <span className={records.absent} />
      ) : (
        t(`filmType.${l.filmType}`)
      ),
  },
  { key: "colourCount", render: (l) => figure(l.colourCount) },
  { key: "unitSurface", render: (l) => figure(l.unitSurface) },
];

/**
 * Only the dimension columns at least one line fills in. A paper order shows
 * grammage and laize, a box order its three sides, a glue order none — the
 * data decides, so no page has to know which category carries what.
 */
function dimensionColumns(lines: readonly LineDimensions[]): DimensionColumn[] {
  return DIMENSION_COLUMNS.filter((column) =>
    lines.some((line) => line[column.key] !== null && line[column.key] !== undefined),
  );
}

// ---------------------------------------------------------------------------
// Lines tables
// ---------------------------------------------------------------------------

export interface OrderLine extends LineDimensions {
  id: string;
  position: number;
  designation: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

/**
 * The lines as printed on the order. A plain table rather than a
 * `DataTable`: a fixed, ordered part of one record, never searched or paged
 * — at most 39 lines in the migrated data.
 *
 * `total` is copied as recorded: on plate lines the price is per cm² and the
 * total is quantity × price × surface, which is why the surface column sits
 * beside it there.
 */
export function OrderLines({
  lines,
  currency,
  /**
   * Drop the table's own "Sum of lines" row. The purchase-order detail draws
   * the total as a banded row beneath the table (the v3 handoff has one
   * total, not two), so it suppresses this one; every other caller keeps it.
   */
  hideTotal = false,
}: {
  lines: readonly OrderLine[];
  currency: string;
  hideTotal?: boolean;
}) {
  const t = useTranslations("purchasing");
  if (lines.length === 0) {
    return <p className={records.muted}>{t("lines.orderEmpty")}</p>;
  }
  const dimensions = dimensionColumns(lines);
  return (
    <div className={invoices.linesScroll}>
      <table className={invoices.lines}>
        <thead>
          <tr>
            <th className={invoices.num}>#</th>
            <th>{t("lines.designation")}</th>
            {dimensions.map((column) => (
              <th key={column.key} className={invoices.num}>
                {t(`dimensions.${column.key}`)}
              </th>
            ))}
            <th className={invoices.num}>{t("lines.qty")}</th>
            <th className={invoices.num}>{t("lines.unitPrice")}</th>
            <th className={invoices.num}>{t("lines.total")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id}>
              <td className={invoices.num}>{line.position}</td>
              <td className={invoices.description}>{line.designation}</td>
              {dimensions.map((column) => (
                <td key={column.key} className={invoices.num}>
                  {column.render(line, t)}
                </td>
              ))}
              <td className={invoices.num}>{qty.format(line.quantity)}</td>
              <td className={invoices.num}>{amount.format(line.unitPrice)}</td>
              <td className={[invoices.num, invoices.total].filter(Boolean).join(" ")}>
                {amount.format(line.total)}
              </td>
            </tr>
          ))}
        </tbody>
        {!hideTotal && (
          <tfoot>
            <tr>
              <td colSpan={4 + dimensions.length} className={invoices.footLabel}>
                {t("lines.sumOfLines", { currency })}
              </td>
              <td className={[invoices.num, invoices.total].filter(Boolean).join(" ")}>
                {amount.format(lines.reduce((sum, line) => sum + line.total, 0))}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export interface ReceiptLine extends LineDimensions {
  id: string;
  position: number;
  designation: string;
  receivedQuantity: number | null;
  unitPrice: number | null;
  orderLine: { id: string; position: number; quantity: number; unitPrice: number } | null;
}

/**
 * What arrived, line by line, beside what the order asked for. The ordered
 * quantity comes from the order line each one received against; a line
 * whose order line has since gone shows an absent ordered figure rather
 * than a guess. Transport lines carry a price instead of a quantity.
 */
export function ReceiptLines({ lines }: { lines: readonly ReceiptLine[] }) {
  const t = useTranslations("purchasing");
  if (lines.length === 0) {
    return <p className={records.muted}>{t("lines.receiptEmpty")}</p>;
  }
  const dimensions = dimensionColumns(lines);
  const priced = lines.some((line) => line.unitPrice !== null);
  return (
    <div className={invoices.linesScroll}>
      <table className={invoices.lines}>
        <thead>
          <tr>
            <th className={invoices.num}>#</th>
            <th>{t("lines.designation")}</th>
            {dimensions.map((column) => (
              <th key={column.key} className={invoices.num}>
                {t(`dimensions.${column.key}`)}
              </th>
            ))}
            <th className={invoices.num}>{t("lines.ordered")}</th>
            <th className={invoices.num}>{t("lines.received")}</th>
            {priced && <th className={invoices.num}>{t("lines.unitPrice")}</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const short =
              line.orderLine !== null &&
              line.receivedQuantity !== null &&
              line.receivedQuantity < line.orderLine.quantity;
            return (
              <tr key={line.id}>
                <td className={invoices.num}>{line.position}</td>
                <td className={invoices.description}>{line.designation}</td>
                {dimensions.map((column) => (
                  <td key={column.key} className={invoices.num}>
                    {column.render(line, t)}
                  </td>
                ))}
                <td className={invoices.num}>{figure(line.orderLine?.quantity ?? null)}</td>
                <td
                  className={[invoices.num, invoices.total, short ? styles.short : null]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {figure(line.receivedQuantity)}
                </td>
                {priced && (
                  <td className={invoices.num}>
                    {line.unitPrice === null ? (
                      <span className={records.absent} />
                    ) : (
                      amount.format(line.unitPrice)
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
