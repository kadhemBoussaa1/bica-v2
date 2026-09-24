import { partnerKeysLookAlike, partnerNameKey } from "@repo/api-contract";

/** Exported: the web client's inferred router type names it (TS4023 otherwise). */
export interface NamedRow {
  id: string;
  name: string;
}

/**
 * Every row whose name resembles another's, mapped to the name it resembles.
 *
 * Pairwise over what it is given — the caller passes ACTIVE rows only, since
 * resembling an archived record is not worth a flag. Fine at the scale of a
 * customer or supplier book (hundreds, not hundreds of thousands); the keys
 * are computed once per row, so a pair is one string search.
 */
export function findLookAlikes(rows: readonly NamedRow[]): Map<string, string> {
  const keyed = rows.map((row) => ({ ...row, key: partnerNameKey(row.name) }));
  const result = new Map<string, string>();
  // Each row is compared with the ones after it, so every pair is tested once.
  keyed.forEach((a, i) => {
    for (const b of keyed.slice(i + 1)) {
      if (!partnerKeysLookAlike(a.key, b.key)) continue;
      if (!result.has(a.id)) result.set(a.id, b.name);
      if (!result.has(b.id)) result.set(b.id, a.name);
    }
  });
  return result;
}

/**
 * What a form asks while a name is being typed: the row that would make the
 * save fail, and the rows it merely resembles.
 *
 * `exact` is the schema's own rule — `name` is unique, case-sensitively, and
 * an archived row still holds its name — so it is matched against every row
 * and carries `active` so the form can say which. `near` is advisory and
 * only ever names live rows.
 */
export function findSimilar(
  rows: readonly (NamedRow & { active: boolean })[],
  name: string,
): { exact: (NamedRow & { active: boolean }) | null; near: NamedRow[] } {
  const key = partnerNameKey(name);
  const exact = rows.find((row) => row.name === name) ?? null;
  const near = rows
    .filter(
      (row) =>
        row.active &&
        row.id !== exact?.id &&
        partnerKeysLookAlike(key, partnerNameKey(row.name)),
    )
    .slice(0, 3)
    .map((row) => ({ id: row.id, name: row.name }));
  return { exact, near };
}
