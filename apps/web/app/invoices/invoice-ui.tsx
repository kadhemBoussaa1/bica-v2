"use client";

import { useTranslations } from "next-intl";
import { assetUrl, withMention, type ProductMention } from "@repo/api-contract";
import { FileLink } from "@repo/ui/file-link";
import type { PaymentState } from "api/src/invoice/invoice.list";
import records from "../records/records.module.css";
import styles from "./invoices.module.css";
import { dateFormat } from "../../i18n/formats";

/*
 * The pieces the purchase and sales invoice pages share: money and date
 * formatting, the payment badge, the document list and the lines table
 * (the detail panel primitives are `records/record-ui`). Each module keeps
 * its own column list and panel layout; this file only knows the shape they
 * have in common.
 */

const day = () => dateFormat({ dateStyle: "medium" });

/**
 * Tunisian dinars carry three decimals (millimes) and the legacy figures use
 * them — 2275.993 is a real amount. Two decimals would round it silently, so
 * amounts show up to three and at least two, whatever the currency.
 */
const amount = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

export function formatDay(value: string | Date | null): string | null {
  return value === null ? null : day().format(new Date(value));
}

/** "1 234,50" — the figure alone, for a layout that sets the currency apart. */
export function formatAmount(value: number): string {
  return amount.format(value);
}

/** "1 234,50 TND", or just the figure when the currency was never recorded. */
export function formatMoney(value: number | null, currency: string | null): string | null {
  if (value === null) return null;
  return currency ? `${formatAmount(value)} ${currency}` : formatAmount(value);
}

/*
 * Parked: neither invoice list shows a payment state for now (hidden on
 * 2026-09-21), so nothing renders this badge. The purchase API still sends
 * `paymentState` and still accepts the open / overdue / paid filters; the
 * sales side needs payment recording first (see `SALES_INVOICE_FACET_KEYS`).
 * Its labels live under `paymentState` in the invoices messages.
 */

/**
 * The badge classes are the records module's status pills, so an invoice
 * reads like an order row. Mapped here rather than in each table so the two
 * lists cannot colour the same state differently.
 */
const PAYMENT_CLASS: Record<PaymentState, string | undefined> = {
  paid: records.statusSuccess,
  overdue: records.statusDanger,
  open: records.statusInfo,
};

/** Paid / overdue / open, as decided by the server against its own "today". */
export function PaymentBadge({ state }: { state: PaymentState }) {
  const t = useTranslations("invoices");
  return (
    <span className={[records.statusBadge, PAYMENT_CLASS[state]].filter(Boolean).join(" ")}>
      {t(`paymentState.${state}`)}
    </span>
  );
}

/**
 * The scanned PDFs. URLs into the legacy bucket, rendered through `assetUrl`
 * like every other migrated file; a purchase invoice can carry several.
 */
export function Documents({ documents }: { documents: string[] }) {
  const t = useTranslations("invoices");
  if (documents.length === 0) {
    return <p className={records.muted}>{t("noScan")}</p>;
  }
  return (
    <ul className={styles.documents}>
      {documents.map((url) => (
        <li key={url}>
          <FileLink href={assetUrl(url)} />
        </li>
      ))}
    </ul>
  );
}

export interface InvoiceLine {
  id: string;
  position: number;
  product: string | null;
  description: string | null;
  /** Sales lines only; a purchase line has none. */
  mention?: ProductMention | null;
  quantity: number | null;
  unitPrice: number | null;
  discountPct: number | null;
  taxPct: number | null;
  total: number | null;
}

const qty = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
const pct = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

/**
 * The lines as printed on the document. A plain table rather than a
 * `DataTable`: it is a fixed, ordered part of one record — never searched,
 * sorted or paged — and at most 39 rows in the migrated data.
 *
 * `total` on a line is tax-inclusive (see the model comment), which is why a
 * column of VAT rates sits beside it: a line at 19 % totals more than
 * quantity × price, and the reader should be able to see why.
 */
export function InvoiceLines({
  lines,
  currency,
}: {
  lines: readonly InvoiceLine[];
  currency: string | null;
}) {
  const t = useTranslations("invoices");
  if (lines.length === 0) {
    return <p className={records.muted}>{t("noLines")}</p>;
  }
  return (
    <div className={styles.linesScroll}>
      <table className={styles.lines}>
        <thead>
          <tr>
            <th className={styles.num}>#</th>
            <th>{t("lines.product")}</th>
            <th>{t("lines.description")}</th>
            <th className={styles.num}>{t("lines.qty")}</th>
            <th className={styles.num}>{t("lines.unitPrice")}</th>
            <th className={styles.num}>{t("lines.discount")}</th>
            <th className={styles.num}>{t("lines.vat")}</th>
            <th className={styles.num}>{t("lines.total")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id}>
              <td className={styles.num}>{line.position}</td>
              <td className={styles.product}>
                {line.product ?? <span className={records.absent} />}
              </td>
              <td className={styles.description}>
                {withMention(line.description, line.mention) || (
                  <span className={records.absent} />
                )}
              </td>
              <td className={styles.num}>
                {line.quantity === null ? <span className={records.absent} /> : qty.format(line.quantity)}
              </td>
              <td className={styles.num}>
                {line.unitPrice === null ? (
                  <span className={records.absent} />
                ) : (
                  amount.format(line.unitPrice)
                )}
              </td>
              <td className={styles.num}>
                {line.discountPct ? `${pct.format(line.discountPct)} %` : <span className={records.absent} />}
              </td>
              <td className={styles.num}>
                {line.taxPct ? `${pct.format(line.taxPct)} %` : <span className={records.absent} />}
              </td>
              <td className={[styles.num, styles.total].filter(Boolean).join(" ")}>
                {line.total === null ? <span className={records.absent} /> : amount.format(line.total)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            {/* Line totals are tax-inclusive, so this is the TTC figure — it
                only equals "Excl. VAT" while every rate is 0. */}
            <td colSpan={7} className={styles.footLabel}>
              {currency ? t("lines.sumCurrency", { currency }) : t("lines.sum")}
            </td>
            <td className={[styles.num, styles.total].filter(Boolean).join(" ")}>
              {amount.format(lines.reduce((sum, line) => sum + (line.total ?? 0), 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
