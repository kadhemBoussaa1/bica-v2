"use client";

import { useTranslations } from "next-intl";
import type { PurchaseCategory } from "api/src/purchasing/purchasing.list";
import { Button } from "@repo/ui/button";
import records from "../records/records.module.css";
import invoices from "../invoices/invoices.module.css";

/*
 * The editable lines tables for a purchase order and a goods receipt.
 *
 * Both reuse the invoice module's table styles — a document with an ordered
 * list of lines is the same shape whichever document it is — and both hold
 * their numbers as STRINGS while editing, so a half-typed "1," survives a
 * re-render. They are parsed once, on submit.
 *
 * Which dimension columns appear is decided by the category, not by the
 * user: a paper line carries a grammage and a laize, a box line its three
 * sides, a glue line none. The read-only tables in purchasing-ui.tsx infer
 * this from the data ("show a column some line fills"), but a blank new line
 * fills nothing, so here the category has to say up front.
 */

/** One order line as edited. */
export interface EditableOrderLine {
  key: number;
  /** Set once saved; a new line has none. Receipt lines reference this id. */
  id: string | null;
  designation: string;
  quantity: string;
  unitPrice: string;
  grammage: string;
  laize: string;
  length: string;
  width: string;
  height: string;
  thickness: string;
  filmType: string;
  colourCount: string;
  unitSurface: string;
}

/** One receipt line as edited: an order line, and what arrived against it. */
export interface EditableReceiptLine {
  key: number;
  orderLineId: string;
  receivedQuantity: string;
  unitPrice: string;
  notes: string;
}

/** The dimension fields a line can carry, as named on the model. */
export type DimensionKey =
  | "grammage"
  | "laize"
  | "length"
  | "width"
  | "height"
  | "thickness"
  | "filmType"
  | "colourCount"
  | "unitSurface";

/**
 * Which dimensions each category actually uses, from what the legacy data
 * carries (see the `PurchaseOrderLine` model comment): paper is grammage and
 * laize on all 110 lines, boxes their three sides on all 52, plates a colour
 * count and a unit surface on all 279, and glue, misc and transport none.
 *
 * `satisfies Record<PurchaseCategory, …>` so a new category cannot be added
 * without deciding what it measures.
 */
export const CATEGORY_DIMENSIONS = {
  PAPER: ["grammage", "laize"],
  INK: [],
  PLATE: ["height", "width", "colourCount", "unitSurface"],
  GLUE: [],
  BOXES: ["length", "width", "height"],
  PALLETS: ["length", "width"],
  STRETCH_FILM: ["filmType", "length", "width", "thickness"],
  TRANSPORT: [],
  MISC: [],
} as const satisfies Record<PurchaseCategory, readonly DimensionKey[]>;

/** A stored float as the editor first shows it, at most six decimals. */
function seed(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(Number(value.toFixed(6)));
}

export function newOrderLine(key: number): EditableOrderLine {
  return {
    key,
    id: null,
    designation: "",
    quantity: "",
    unitPrice: "",
    grammage: "",
    laize: "",
    length: "",
    width: "",
    height: "",
    thickness: "",
    filmType: "",
    colourCount: "",
    unitSurface: "",
  };
}

export function toEditableOrderLine(
  line: {
    id: string;
    designation: string;
    quantity: number;
    unitPrice: number;
    grammage: number | null;
    laize: number | null;
    length: number | null;
    width: number | null;
    height: number | null;
    thickness: number | null;
    filmType: string | null;
    colourCount: number | null;
    unitSurface?: number | null;
  },
  key: number,
): EditableOrderLine {
  return {
    key,
    id: line.id,
    designation: line.designation,
    quantity: seed(line.quantity),
    unitPrice: seed(line.unitPrice),
    grammage: seed(line.grammage),
    laize: seed(line.laize),
    length: seed(line.length),
    width: seed(line.width),
    height: seed(line.height),
    thickness: seed(line.thickness),
    filmType: line.filmType ?? "",
    colourCount: seed(line.colourCount),
    unitSurface: seed(line.unitSurface),
  };
}

/** Lenient decimal parse: a French comma is accepted, blank is null. */
export function parseOptional(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Blank or unparseable is 0, for the fields the schema requires. */
export function parseRequired(value: string): number {
  return parseOptional(value) ?? 0;
}

/** The submit shape for an order line. `position` comes from the array index. */
export function toOrderLineInput(line: EditableOrderLine, position: number) {
  return {
    position,
    designation: line.designation.trim(),
    quantity: parseRequired(line.quantity),
    unitPrice: parseRequired(line.unitPrice),
    grammage: parseOptional(line.grammage),
    laize: parseOptional(line.laize),
    length: parseOptional(line.length),
    width: parseOptional(line.width),
    height: parseOptional(line.height),
    thickness: parseOptional(line.thickness),
    filmType: line.filmType === "" ? null : line.filmType,
    colourCount: parseOptional(line.colourCount),
    unitSurface: parseOptional(line.unitSurface),
  };
}

export function toReceiptLineInput(line: EditableReceiptLine, position: number) {
  return {
    position,
    orderLineId: line.orderLineId,
    receivedQuantity: parseOptional(line.receivedQuantity),
    unitPrice: parseOptional(line.unitPrice),
    notes: line.notes.trim() === "" ? null : line.notes.trim(),
  };
}

/**
 * A line's total, by the same rule the server writes: a plate line prices
 * per cm², so its total is quantity × price × surface rather than the plain
 * product. Shown live so the figure the operator sees is the figure stored.
 */
export function orderLineTotal(line: EditableOrderLine): number {
  const quantity = parseRequired(line.quantity);
  const price = parseRequired(line.unitPrice);
  const surface = parseOptional(line.unitSurface);
  return surface === null ? quantity * price : quantity * price * surface;
}

const amount = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});
const qty = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });

const FILM_TYPES = ["STRETCH_FILM", "THERMO_PVC_STRETCH_FILM"] as const;

export function OrderLinesEditor({
  lines,
  category,
  currency,
  onChange,
  busy,
  maxLines = 200,
}: {
  lines: EditableOrderLine[];
  category: PurchaseCategory | "";
  currency: string;
  onChange: (next: EditableOrderLine[]) => void;
  busy: boolean;
  maxLines?: number;
}) {
  const t = useTranslations("purchasing");
  const dimensions: readonly DimensionKey[] = category === "" ? [] : CATEGORY_DIMENSIONS[category];

  const edit = (key: number, patch: Partial<EditableOrderLine>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const add = () => {
    const nextKey = lines.reduce((max, line) => Math.max(max, line.key), 0) + 1;
    onChange([...lines, newOrderLine(nextKey)]);
  };
  const remove = (key: number) => onChange(lines.filter((line) => line.key !== key));

  const total = lines.reduce((sum, line) => sum + orderLineTotal(line), 0);
  const cell = (extra?: string) => [invoices.cellInput, extra].filter(Boolean).join(" ");

  return (
    <>
      <div className={invoices.linesScroll}>
        <table className={[invoices.lines, invoices.editLines].filter(Boolean).join(" ")}>
          <thead>
            <tr>
              <th className={invoices.num}>#</th>
              <th>{t("lines.designation")}</th>
              {dimensions.map((key) => (
                <th key={key} className={invoices.num}>
                  {t(`dimensions.${key}`)}
                </th>
              ))}
              <th className={invoices.num}>{t("lines.qty")}</th>
              <th className={invoices.num}>{t("lines.unitPrice")}</th>
              <th className={invoices.num}>{t("lines.total")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const n = index + 1;
              return (
                <tr key={line.key}>
                  <td className={invoices.num}>{n}</td>
                  <td className={invoices.description}>
                    <input
                      className={cell()}
                      value={line.designation}
                      onChange={(e) => edit(line.key, { designation: e.target.value })}
                      disabled={busy}
                      aria-label={t("lines.aria.designation", { n })}
                    />
                  </td>
                  {dimensions.map((key) => (
                    <td key={key} className={invoices.num}>
                      {key === "filmType" ? (
                        <select
                          className={cell()}
                          value={line.filmType}
                          onChange={(e) => edit(line.key, { filmType: e.target.value })}
                          disabled={busy}
                          aria-label={t("lines.aria.dimension", { n, name: t("dimensions.filmType") })}
                        >
                          <option value="" />
                          {FILM_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {t(`filmType.${type}`)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className={cell(invoices.cellNum)}
                          inputMode="decimal"
                          value={line[key]}
                          onChange={(e) => edit(line.key, { [key]: e.target.value })}
                          disabled={busy}
                          aria-label={t("lines.aria.dimension", { n, name: t(`dimensions.${key}`) })}
                        />
                      )}
                    </td>
                  ))}
                  <td className={invoices.num}>
                    <input
                      className={cell(invoices.cellNum)}
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(e) => edit(line.key, { quantity: e.target.value })}
                      disabled={busy}
                      aria-label={t("lines.aria.quantity", { n })}
                    />
                  </td>
                  <td className={invoices.num}>
                    <input
                      className={cell(invoices.cellNum)}
                      inputMode="decimal"
                      value={line.unitPrice}
                      onChange={(e) => edit(line.key, { unitPrice: e.target.value })}
                      disabled={busy}
                      aria-label={t("lines.aria.unitPrice", { n })}
                    />
                  </td>
                  <td className={[invoices.num, invoices.total].filter(Boolean).join(" ")}>
                    {amount.format(orderLineTotal(line))}
                  </td>
                  <td>
                    <Button
                      size="dense"
                      variant="secondary"
                      onClick={() => remove(line.key)}
                      disabled={busy || lines.length === 1}
                    >
                      {t("lines.remove")}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4 + dimensions.length} className={invoices.footLabel}>
                {t("lines.sumOfLines", { currency })}
              </td>
              <td className={[invoices.num, invoices.total].filter(Boolean).join(" ")}>
                {amount.format(total)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className={invoices.linesFoot}>
        <Button
          size="dense"
          variant="secondary"
          onClick={add}
          disabled={busy || lines.length >= maxLines}
        >
          {t("lines.add")}
        </Button>
      </div>
    </>
  );
}

/** An order line a receipt can be recorded against. */
export interface ReceivableLine {
  id: string;
  position: number;
  designation: string;
  quantity: number;
  receivedQuantity: number;
}

/**
 * What arrived, line by line, beside what the order asked for and what
 * earlier deliveries already brought in.
 *
 * The remaining figure is the point of this table: it is what the server's
 * over-receipt guard measures against, so showing it is what stops the
 * operator hitting a rejection they could not have predicted.
 */
export function ReceiptLinesEditor({
  lines,
  orderLines,
  transport,
  onChange,
  busy,
  maxLines = 200,
}: {
  lines: EditableReceiptLine[];
  orderLines: readonly ReceivableLine[];
  /** Transport lines carry a price instead of a quantity. */
  transport: boolean;
  onChange: (next: EditableReceiptLine[]) => void;
  busy: boolean;
  maxLines?: number;
}) {
  const t = useTranslations("purchasing");

  const edit = (key: number, patch: Partial<EditableReceiptLine>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const add = () => {
    const nextKey = lines.reduce((max, line) => Math.max(max, line.key), 0) + 1;
    const taken = new Set(lines.map((line) => line.orderLineId));
    const free = orderLines.find((line) => !taken.has(line.id));
    onChange([
      ...lines,
      {
        key: nextKey,
        orderLineId: free?.id ?? "",
        receivedQuantity: "",
        unitPrice: "",
        notes: "",
      },
    ]);
  };
  const remove = (key: number) => onChange(lines.filter((line) => line.key !== key));

  const cell = (extra?: string) => [invoices.cellInput, extra].filter(Boolean).join(" ");
  const chosen = new Set(lines.map((line) => line.orderLineId));

  return (
    <>
      <div className={invoices.linesScroll}>
        <table className={[invoices.lines, invoices.editLines].filter(Boolean).join(" ")}>
          <thead>
            <tr>
              <th className={invoices.num}>#</th>
              <th>{t("lines.orderLine")}</th>
              <th className={invoices.num}>{t("lines.ordered")}</th>
              <th className={invoices.num}>{t("lines.remaining")}</th>
              <th className={invoices.num}>
                {transport ? t("lines.unitPrice") : t("lines.received")}
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const n = index + 1;
              const ordered = orderLines.find((candidate) => candidate.id === line.orderLineId);
              // What this line may still bring: the order's quantity less
              // what other receipts already recorded. Its own previous
              // figure is part of `receivedQuantity`, so an edit that leaves
              // the line alone reads as zero remaining rather than negative.
              const remaining =
                ordered === undefined
                  ? null
                  : Math.max(0, ordered.quantity - ordered.receivedQuantity);
              const over =
                ordered !== undefined &&
                remaining !== null &&
                parseRequired(line.receivedQuantity) > remaining + 0.01;
              return (
                <tr key={line.key}>
                  <td className={invoices.num}>{n}</td>
                  <td className={invoices.description}>
                    <select
                      className={cell()}
                      value={line.orderLineId}
                      onChange={(e) => edit(line.key, { orderLineId: e.target.value })}
                      disabled={busy}
                      aria-label={t("lines.aria.orderLine", { n })}
                    >
                      <option value="" disabled>
                        {t("lines.chooseOrderLine")}
                      </option>
                      {orderLines.map((candidate) => (
                        <option
                          key={candidate.id}
                          value={candidate.id}
                          // Each order line may be received once per note;
                          // the server refuses two lines against one.
                          disabled={candidate.id !== line.orderLineId && chosen.has(candidate.id)}
                        >
                          {candidate.position}. {candidate.designation}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={invoices.num}>
                    {ordered === undefined ? (
                      <span className={records.absent} />
                    ) : (
                      qty.format(ordered.quantity)
                    )}
                  </td>
                  <td className={invoices.num}>
                    {remaining === null ? (
                      <span className={records.absent} />
                    ) : (
                      qty.format(remaining)
                    )}
                  </td>
                  <td className={invoices.num}>
                    <input
                      className={cell(invoices.cellNum)}
                      inputMode="decimal"
                      value={transport ? line.unitPrice : line.receivedQuantity}
                      onChange={(e) =>
                        edit(
                          line.key,
                          transport
                            ? { unitPrice: e.target.value }
                            : { receivedQuantity: e.target.value },
                        )
                      }
                      disabled={busy}
                      aria-invalid={over ? true : undefined}
                      aria-label={
                        transport
                          ? t("lines.aria.unitPrice", { n })
                          : t("lines.aria.received", { n })
                      }
                    />
                  </td>
                  <td>
                    <Button
                      size="dense"
                      variant="secondary"
                      onClick={() => remove(line.key)}
                      disabled={busy || lines.length === 1}
                    >
                      {t("lines.remove")}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={invoices.linesFoot}>
        <Button
          size="dense"
          variant="secondary"
          onClick={add}
          disabled={busy || lines.length >= maxLines || lines.length >= orderLines.length}
        >
          {t("lines.add")}
        </Button>
      </div>
    </>
  );
}
