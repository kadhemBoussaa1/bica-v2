/**
 * Figures and dates as the generated documents print them.
 *
 * The legacy templates used Thymeleaf's
 * `#numbers.formatDecimal(x, 1, 'COMMA', 2, 'POINT')` — comma thousands
 * separator, two decimals, point decimal mark — and `dd/MM/yyyy` for the
 * date. That is what a supplier has seen on every previous document, so the
 * output here matches it rather than following the reader's locale.
 *
 * This is the same reasoning as the web app's `i18n/formats.ts`: dates follow
 * the language, figures keep one grouping in every language so the same sheet
 * reads the same to everyone. On a document that leaves the building, both
 * are fixed.
 */

/**
 * Two decimals, French grouping: `1 234,50`.
 *
 * `fr-FR` groups with U+202F (narrow no-break space), which the Arabic face
 * does not carry — an Arabic document showed `7845,80` with the separator
 * silently dropped. Normalising it to a plain space keeps the grouping
 * visible in both faces, and a figure on a document must not depend on which
 * language it was rendered in.
 */
const decimal = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Up to three decimals and no forced padding, for quantities. */
const quantity = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 3,
});

/** U+202F / U+00A0 -> a plain space, so every face can draw the grouping. */
function plainSpaces(text: string): string {
  return text.replace(/[\u202F\u00A0]/g, " ");
}

/**
 * Marks a left-to-right token so it survives inside right-to-left text.
 *
 * Without this, Arabic documents mangled anything Latin that carried digits
 * and letters or a leading sign: the tax ID `1862322SAM000` split into
 * `1862322` … `ISAM000` around the Arabic label, and `+216 58 402 164`
 * reversed to `164 402 58 216+`.
 *
 * U+200E (LEFT-TO-RIGHT MARK) on both ends, NOT the U+2066/U+2069 isolates
 * that would be the textbook answer. Noto Sans Arabic has no glyph for the
 * isolates, so react-pdf drew them as visible fallback boxes — every phone
 * number came out as `ǁ+216 58 402 164i`, which is worse than the reordering
 * it fixed. LRM is zero-width in this face and reorders correctly; verified
 * by rendering all four candidates side by side and reading the raster.
 *
 * Applied only where such a token sits in prose; table cells are already
 * single-value and aligned per column.
 */
export function ltrIsolate(text: string): string {
  return `\u200E${text}\u200E`;
}

/** One formatter per precision, built on first use: `Intl.NumberFormat` is not free to construct. */
const decimals = new Map<string, Intl.NumberFormat>([["2-2", decimal]]);
function decimalFormat(min: number, max: number): Intl.NumberFormat {
  const key = `${min}-${max}`;
  let format = decimals.get(key);
  if (!format) {
    format = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: min, maximumFractionDigits: max });
    decimals.set(key, format);
  }
  return format;
}

/**
 * How many decimals a currency's amounts print with. The dinar is divided
 * into 1000 millimes, so a TND invoice at two decimals rounds away money;
 * everything else is two. The purchasing documents never pass this, and keep
 * the two decimals every supplier has seen.
 */
export function currencyDigits(currency: string | null | undefined): number {
  return currency === "TND" ? 3 : 2;
}

/**
 * A money figure with the document's currency appended, as the templates did.
 * A null currency (30 legacy sales invoices) prints the bare figure rather
 * than guessing a symbol.
 */
export function money(value: number | null | undefined, currency: string | null, digits = 2): string {
  if (value === null || value === undefined) return "-";
  const figures = plainSpaces(decimalFormat(digits, digits).format(value));
  return currency === null ? figures : `${figures} ${symbol(currency)}`;
}

/**
 * A unit price: at least the currency's decimals, and up to five. A kraft bag
 * sells for `0,012 €`; at two decimals that prints as `0,01 €` and the line
 * no longer multiplies out.
 */
export function unitMoney(value: number | null | undefined, currency: string | null, digits = 2): string {
  if (value === null || value === undefined) return "-";
  const figures = plainSpaces(decimalFormat(digits, Math.max(digits, 5)).format(value));
  return currency === null ? figures : `${figures} ${symbol(currency)}`;
}

/** A percentage, `5 %`; dash when absent. */
export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${plainSpaces(quantity.format(value))} %`;
}

/**
 * The legacy templates printed `€` for EUR and the raw code otherwise
 * (`th:with="deviseSymbol=${bon.devise == 'EUR' ? '€' : ...}"`), so TND shows
 * as `TND` rather than a symbol nobody prints.
 */
function symbol(currency: string): string {
  return currency === "EUR" ? "€" : currency;
}

/** A quantity, with an optional unit suffix (` mm`, ` g`, ` kg`). */
export function figure(value: number | null | undefined, unit = ""): string {
  if (value === null || value === undefined) return "-";
  return `${plainSpaces(quantity.format(value))}${unit}`;
}

/** A received or ordered quantity: two decimals, and 0 rather than a dash. */
export function receivedFigure(value: number | null | undefined): string {
  return value === null || value === undefined ? "0,00" : plainSpaces(decimal.format(value));
}

/** An ordered quantity: two decimals, dash when genuinely absent. */
export function orderedFigure(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : plainSpaces(decimal.format(value));
}

/**
 * `dd/MM/yyyy`, from a `@db.Date` column.
 *
 * Read in UTC, because those columns store a bare day at UTC midnight and a
 * local-time read would show the previous day west of Greenwich.
 */
export function day(value: Date | null | undefined): string {
  if (value === null || value === undefined) return "-";
  const d = String(value.getUTCDate()).padStart(2, "0");
  const m = String(value.getUTCMonth() + 1).padStart(2, "0");
  return `${d}/${m}/${value.getUTCFullYear()}`;
}

/** `dd/MM/yyyy` from the `YYYY-MM-DD` string a snapshot carries; dash when absent. */
export function isoDay(value: string | null | undefined): string {
  if (value === null || value === undefined) return "-";
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
}

/** What goes in the PDF's file name: `bon_de_commande_26PBC-036.pdf`. */
export function fileName(prefix: string, numero: string): string {
  const safe = numero.replace(/[^A-Za-z0-9._-]+/g, "_");
  return `${prefix}_${safe}.pdf`;
}
