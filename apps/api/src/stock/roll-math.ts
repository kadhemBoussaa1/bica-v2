import { Prisma } from "../generated/prisma/client.js";

/**
 * The arithmetic of a reel's counters, shared by `StockService` (cut, slit)
 * and `AllocationService` (reserve, consume, cancel) — docs/roll-allocation-plan.md §4.
 *
 * Every movement goes through `moveRollCounters`: one UPDATE whose WHERE
 * carries the guard, so the balance can never be read, judged and written
 * in three steps that another request could interleave. Postgres re-checks
 * the WHERE under the row lock, which is what makes "two people reserving
 * the last 60 m at once" end with exactly one of them succeeding.
 */

/** The columns every counter move reads back. */
export interface RollCounters {
  id: string;
  numero: string | null;
  metrage: number | null;
  metrageRestant: number;
  metrageReserve: number;
  poids: number | null;
  poidsRestant: number;
  poidsReserve: number;
  laize: number | null;
  grammage: number | null;
  consomme: boolean;
  archived: boolean;
}

export const ROLL_COUNTER_SELECT = {
  id: true,
  numero: true,
  metrage: true,
  metrageRestant: true,
  metrageReserve: true,
  poids: true,
  poidsRestant: true,
  poidsReserve: true,
  laize: true,
  grammage: true,
  consomme: true,
  archived: true,
} satisfies Prisma.PaperRollSelect;

const RETURNING = Prisma.sql`
  RETURNING "id", "numero", "metrage", "metrageRestant", "metrageReserve",
            "poids", "poidsRestant", "poidsReserve", "laize", "grammage",
            "consomme", "archived"`;

/**
 * Kilograms per metre of this reel. The remaining weight over the remaining
 * length is the reel's own ratio; the width × grammage product is the
 * fallback for a reel whose length was never entered. Measured on the
 * migrated stock the two agree to 13 digits.
 */
export function kgPerMetre(
  roll: Pick<RollCounters, "poidsRestant" | "metrageRestant" | "laize" | "grammage">,
): number {
  if (roll.metrageRestant > 0 && roll.poidsRestant > 0) {
    return roll.poidsRestant / roll.metrageRestant;
  }
  if (roll.laize !== null && roll.grammage !== null) {
    return (roll.laize / 1000) * (roll.grammage / 1000);
  }
  return 0;
}

/** Metres not yet promised to a reservation. */
export function freeMetres(roll: Pick<RollCounters, "metrageRestant" | "metrageReserve">): number {
  return Math.max(0, roll.metrageRestant - roll.metrageReserve);
}

/**
 * Metres in a server-side error message: plain `.` decimal, at most 2 places.
 * These messages are English and untranslated (docs/i18n.md), so they do not
 * go through the web app's French figure grouping.
 */
export const metresFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/**
 * The legacy state flags, derived from the counters rather than typed, and
 * written by `writeRollFlags` below after every counter move — the stock
 * list's facets still read them (`stock.list.ts`).
 */
function flagsFor(roll: RollCounters): {
  disponible: boolean;
  reserved: boolean;
  partiel: boolean;
} {
  return {
    disponible: !roll.consomme && !roll.archived && freeMetres(roll) > 0,
    reserved: roll.metrageReserve > 0,
    partiel: roll.metrage !== null && roll.metrageRestant < roll.metrage,
  };
}

/** `"col" - n`, snapped to 0 below a float hair so a spent reel reads 0, not 1e-13. */
function minus(column: Prisma.Sql, n: number): Prisma.Sql {
  return Prisma.sql`CASE WHEN ${column} - ${n} <= 1e-9 THEN 0 ELSE ${column} - ${n} END`;
}

const METRAGE_RESTANT = Prisma.sql`"metrageRestant"`;
const METRAGE_RESERVE = Prisma.sql`"metrageReserve"`;
const POIDS_RESERVE = Prisma.sql`"poidsReserve"`;

/** The reel is live and has `metres` free: the guard for reserve and cut. */
export function freeGuard(metres: number): Prisma.Sql {
  return Prisma.sql`"consomme" = false AND "archived" = false
    AND "metrageRestant" - "metrageReserve" >= ${metres}`;
}

/** Promise `metres` (and their weight) to a reservation. */
export function reserveSet(metres: number, kg: number): Prisma.Sql {
  return Prisma.sql`"metrageReserve" = "metrageReserve" + ${metres},
    "poidsReserve" = "poidsReserve" + ${kg}`;
}

/**
 * Take `metres` off the reel. The weight follows the length: when the last
 * metre goes, the weight is zeroed with it rather than left as a residue.
 */
export function takeSet(metres: number, kg: number): Prisma.Sql {
  return Prisma.sql`"metrageRestant" = ${minus(METRAGE_RESTANT, metres)},
    "poidsRestant" = CASE WHEN "metrageRestant" - ${metres} <= 1e-9 THEN 0
                          ELSE GREATEST("poidsRestant" - ${kg}, 0) END`;
}

/** Give a reservation back, in full or in part. */
export function releaseSet(metres: number, kg: number): Prisma.Sql {
  return Prisma.sql`"metrageReserve" = ${minus(METRAGE_RESERVE, metres)},
    "poidsReserve" = ${minus(POIDS_RESERVE, kg)}`;
}

/**
 * The conditional move. Null when no row matched — the guard failed, or the
 * reel is gone — so the caller can read the reel and say why.
 */
export async function moveRollCounters(
  tx: Prisma.TransactionClient,
  rollId: string,
  set: Prisma.Sql,
  guard: Prisma.Sql,
): Promise<RollCounters | null> {
  const rows = await tx.$queryRaw<RollCounters[]>`
    UPDATE "PaperRoll" SET ${set}
    WHERE "id" = ${rollId} AND ${guard}
    ${RETURNING}`;
  return rows[0] ?? null;
}

/**
 * Rewrites the derived flags from the counters just returned, plus whatever
 * else the operation decided (consumption, a note). Same transaction as the
 * move, so the flags never describe a different state than the numbers.
 */
export async function writeRollFlags(
  tx: Prisma.TransactionClient,
  roll: RollCounters,
  extra: Prisma.PaperRollUncheckedUpdateInput = {},
): Promise<void> {
  const consomme = extra.consomme === true || roll.consomme;
  const archived = extra.archived === true || roll.archived;
  await tx.paperRoll.update({
    where: { id: roll.id },
    data: { ...flagsFor({ ...roll, consomme, archived }), ...extra },
    select: { id: true },
  });
}
