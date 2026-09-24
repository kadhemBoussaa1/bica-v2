import { z } from "zod";

/**
 * Look-alike detection for trading-partner names (clients and suppliers).
 *
 * `name` is unique on both tables, but uniqueness is exact: "Boulangerie
 * Monteil" and "Boulangerie de Monteil" are two rows, and the legacy import
 * brought in exactly that kind of pair. The lists flag them as *possible*
 * duplicates for a human to merge or archive — nothing here decides on its
 * own.
 *
 * Shared between the API (the `duplicates` facet, the `similar` check) and
 * nothing else on purpose: the web only ever sees the server's verdict, so the
 * rule cannot drift between the chip count and the form's warning.
 */

/**
 * Words that carry no identity: articles, conjunctions and legal forms. Two
 * names that differ only by these are the same business as far as a
 * duplicate check is concerned.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "de",
  "du",
  "des",
  "d",
  "la",
  "le",
  "les",
  "l",
  "et",
  "and",
  "the",
  "of",
  "sarl",
  "sa",
  "sas",
  "suarl",
  "eurl",
  "snc",
  "ste",
  "societe",
  "company",
  "co",
  "llc",
  "ltd",
  "inc",
  "gmbh",
  "srl",
  "spa",
  "plc",
]);

/**
 * The comparison key for a name: accents stripped, lower-cased, punctuation
 * collapsed to spaces, stop words dropped. "SARL Belhadj" and "Belhadj"
 * share a key; so do "Boulangerie Monteil" and "Boulangerie de Monteil".
 */
export function partnerNameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word))
    .join(" ");
}

/**
 * True when two keys (from `partnerNameKey`) describe a possible duplicate:
 * identical, or one is a whole-word run inside the other ("Serra" inside
 * "Groupe Serra"). Whole words only, so "Cool" does not match "Coolpack".
 *
 * Keys under three characters never match — a stray "SA" would otherwise
 * pair with everything.
 */
export function partnerKeysLookAlike(a: string, b: string): boolean {
  if (a.length < 3 || b.length < 3) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return ` ${long} `.includes(` ${short} `);
}

/** The name the user is typing, and the row to leave out when editing. */
export const similarPartnerNameInput = z.object({
  name: z.string().trim().max(200),
  excludeId: z.string().min(1).optional(),
});

export type SimilarPartnerNameInput = z.infer<typeof similarPartnerNameInput>;
