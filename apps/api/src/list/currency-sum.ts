/**
 * A money figure per currency — the shape every header tile and the
 * dashboard read: one row per currency, never a cross-currency total.
 *
 * `currency` is null for the migrated purchase invoices that never recorded
 * one (64 rows, 2026-09); they stay a labelled bucket rather than being
 * dropped or folded into another currency.
 */
export interface CurrencySum {
  currency: string | null;
  total: number;
  count: number;
}

/**
 * Folds `(currency, amount, count)` entries into one `CurrencySum` per
 * currency, sorted by code with the null bucket last. The entries are
 * usually a Prisma `groupBy` over `currency`, mapped to this shape at the
 * call site so the field being summed (`totalTtc`, a line total, ...) is the
 * caller's business.
 */
export function sumByCurrency(
  entries: Iterable<{ currency: string | null; amount: number; count?: number }>,
): CurrencySum[] {
  const sums = new Map<string | null, { total: number; count: number }>();
  for (const entry of entries) {
    const sum = sums.get(entry.currency) ?? { total: 0, count: 0 };
    sums.set(entry.currency, {
      total: sum.total + entry.amount,
      count: sum.count + (entry.count ?? 1),
    });
  }
  return [...sums]
    .map(([currency, sum]) => ({ currency, ...sum }))
    .sort((a, b) =>
      a.currency === null ? 1 : b.currency === null ? -1 : a.currency.localeCompare(b.currency),
    );
}
