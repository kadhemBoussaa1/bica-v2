"use client";

import { useTranslations } from "next-intl";
import {
  PRODUCT_MENTIONS,
  invoiceLineFigures,
  type ProductMention,
  type SalesInvoiceLineInput,
} from "@repo/api-contract";
import { Button } from "@repo/ui/button";
import records from "../records/records.module.css";
import styles from "./invoices.module.css";

/*
 * The editable lines table both invoice kinds share — the sales draft and
 * the purchase form. It knows nothing about either document: it edits a
 * list of lines, shows each line's tax-inclusive total from the same
 * `invoiceLineFigures` the server writes with, and reports every change up.
 */

/**
 * One line as edited. Numbers are held as strings so a half-typed "1," is
 * not clobbered by a re-render; they are parsed once, on submit.
 */
export interface EditableLine {
  key: number;
  /** A sales line billing an order: locked in place, never removable. */
  orderId: string | null;
  /** Only meaningful on a line billing an order — the one place it can be chosen. */
  mention: ProductMention | null;
  product: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  taxPct: string;
}

/**
 * A stored float as the editor first shows it: at most six decimals, so a
 * snapshot like 6.9638141440000005 reads as 6.963814. Only the seed is
 * rounded — what the user types is kept verbatim until saved.
 */
function seed(value: number | null, fallback = ""): string {
  return value === null ? fallback : String(Number(value.toFixed(6)));
}

export function toEditable(
  line: {
    orderId?: string | null;
    mention?: ProductMention | null;
    product: string | null;
    description: string | null;
    quantity: number | null;
    unitPrice: number | null;
    discountPct: number | null;
    taxPct: number | null;
  },
  key: number,
): EditableLine {
  return {
    key,
    orderId: line.orderId ?? null,
    mention: line.mention ?? null,
    product: line.product ?? "",
    description: line.description ?? "",
    quantity: seed(line.quantity),
    unitPrice: seed(line.unitPrice),
    discountPct: seed(line.discountPct, "0"),
    taxPct: seed(line.taxPct, "0"),
  };
}

export function newEditableLine(key: number, taxPct = 0): EditableLine {
  return {
    key,
    orderId: null,
    mention: null,
    product: "",
    description: "",
    quantity: "1",
    unitPrice: "0",
    discountPct: "0",
    taxPct: String(taxPct),
  };
}

/** Lenient decimal parse: French commas accepted, blank or garbage is 0. */
export function parseNum(value: string): number {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The submit shape. Carries `orderId` and `mention` for the sales draft; the
 * purchase input's Zod object strips both, so the same helper serves both.
 * The mention always goes with an order line, `null` included — the draft
 * replaces its lines wholesale, and `null` is how "none" is said.
 */
export function toLineInput(line: EditableLine, position: number): SalesInvoiceLineInput {
  return {
    position,
    orderId: line.orderId,
    mention: line.orderId === null ? undefined : line.mention,
    product: line.product.trim() || undefined,
    description: line.description.trim() || undefined,
    quantity: parseNum(line.quantity),
    unitPrice: parseNum(line.unitPrice),
    discountPct: parseNum(line.discountPct),
    taxPct: parseNum(line.taxPct),
  };
}

const amount = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

export function InvoiceLinesEditor({
  lines,
  onChange,
  currency,
  busy,
  maxLines = 100,
  /** The default VAT rate a new line starts with. */
  newLineTaxPct = 0,
}: {
  lines: EditableLine[];
  onChange: (next: EditableLine[]) => void;
  currency: string | null;
  busy: boolean;
  maxLines?: number;
  newLineTaxPct?: number;
}) {
  const t = useTranslations("invoices");
  const edit = (key: number, patch: Partial<EditableLine>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const add = () => {
    const nextKey = lines.reduce((max, line) => Math.max(max, line.key), 0) + 1;
    onChange([...lines, newEditableLine(nextKey, newLineTaxPct)]);
  };
  const remove = (key: number) => onChange(lines.filter((line) => line.key !== key));

  const total = lines.reduce(
    (sum, line, index) => sum + invoiceLineFigures(toLineInput(line, index + 1)).total,
    0,
  );
  const cell = (extra?: string) => [styles.cellInput, extra].filter(Boolean).join(" ");

  return (
    <>
      <div className={styles.linesScroll}>
        <table className={[styles.lines, styles.editLines].filter(Boolean).join(" ")}>
          <thead>
            <tr>
              <th className={styles.num}>#</th>
              <th>{t("lines.product")}</th>
              <th>{t("lines.description")}</th>
              <th className={styles.num}>{t("lines.qty")}</th>
              <th className={styles.num}>{t("lines.unitPrice")}</th>
              <th className={styles.num}>{t("lines.discountPct")}</th>
              <th className={styles.num}>{t("lines.vatPct")}</th>
              <th className={styles.num}>{t("lines.total")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const figures = invoiceLineFigures(toLineInput(line, index + 1));
              const n = index + 1;
              return (
                <tr key={line.key}>
                  <td className={styles.num}>{n}</td>
                  <td>
                    <input
                      className={cell()}
                      value={line.product}
                      onChange={(e) => edit(line.key, { product: e.target.value })}
                      disabled={busy}
                      aria-label={t("lines.aria.product", { n })}
                    />
                  </td>
                  <td className={styles.description}>
                    <div className={styles.descriptionCell}>
                      <input
                        className={cell()}
                        value={line.description}
                        onChange={(e) => edit(line.key, { description: e.target.value })}
                        disabled={busy}
                        aria-label={t("lines.aria.description", { n })}
                      />
                      {line.orderId !== null ? (
                        <select
                          className={cell(styles.cellMention)}
                          value={line.mention ?? ""}
                          onChange={(e) =>
                            edit(line.key, {
                              mention:
                                e.target.value === "" ? null : (e.target.value as ProductMention),
                            })
                          }
                          disabled={busy}
                          aria-label={t("lines.aria.mention", { n })}
                          title={t("mention.label")}
                        >
                          <option value="">{t("mention.none")}</option>
                          {PRODUCT_MENTIONS.map((mention) => (
                            <option key={mention} value={mention}>
                              {mention}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                  </td>
                  <td className={styles.num}>
                    <input
                      className={cell(styles.cellNum)}
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(e) => edit(line.key, { quantity: e.target.value })}
                      disabled={busy}
                      aria-label={t("lines.aria.quantity", { n })}
                    />
                  </td>
                  <td className={styles.num}>
                    <input
                      className={cell(styles.cellNum)}
                      inputMode="decimal"
                      value={line.unitPrice}
                      onChange={(e) => edit(line.key, { unitPrice: e.target.value })}
                      disabled={busy}
                      aria-label={t("lines.aria.unitPrice", { n })}
                    />
                  </td>
                  <td className={styles.num}>
                    <input
                      className={cell(styles.cellPct)}
                      inputMode="decimal"
                      value={line.discountPct}
                      onChange={(e) => edit(line.key, { discountPct: e.target.value })}
                      disabled={busy}
                      aria-label={t("lines.aria.discount", { n })}
                    />
                  </td>
                  <td className={styles.num}>
                    <input
                      className={cell(styles.cellPct)}
                      inputMode="decimal"
                      value={line.taxPct}
                      onChange={(e) => edit(line.key, { taxPct: e.target.value })}
                      disabled={busy}
                      aria-label={t("lines.aria.vat", { n })}
                    />
                  </td>
                  <td className={[styles.num, styles.total].filter(Boolean).join(" ")}>
                    {amount.format(figures.total)}
                  </td>
                  <td>
                    {line.orderId === null ? (
                      <Button
                        size="dense"
                        variant="secondary"
                        onClick={() => remove(line.key)}
                        disabled={busy || lines.length === 1}
                      >
                        {t("lines.remove")}
                      </Button>
                    ) : (
                      <span className={records.hint}>{t("lines.billsOrder")}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={7} className={styles.footLabel}>
                {currency ? t("lines.sumCurrency", { currency }) : t("lines.sum")}
              </td>
              <td className={[styles.num, styles.total].filter(Boolean).join(" ")}>
                {amount.format(total)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className={styles.linesFoot}>
        <Button size="dense" variant="secondary" onClick={add} disabled={busy || lines.length >= maxLines}>
          {t("lines.add")}
        </Button>
      </div>
    </>
  );
}
