/**
 * Shared plumbing for importing the legacy `bicapack` database.
 *
 * The legacy DB is a separate Postgres (see docs/legacy-migration.md). It is read
 * through plain `pg` rather than a second Prisma client: we only ever SELECT from
 * it, and generating a client for 72 legacy models would be dead weight.
 */
import { Pool } from "pg";

/**
 * Legacy rows satisfy NOT NULL with '' in many places (every contact column on
 * `client`, for one), so an empty or whitespace-only string means "absent".
 */
export function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * A legacy `DATE` column, read WITHOUT a timezone shift.
 *
 * The `pg` driver parses a bare `DATE` into a JavaScript `Date` at **local**
 * midnight. On a machine east of UTC (CET here, +01:00) that is the previous
 * day in UTC — `2024-07-03` becomes `2024-07-02T23:00:00Z` — and a Prisma
 * `@db.Date` column then stores 2024-07-02. Every date lands one day early.
 *
 * So SELECT the column as text (`some_date::text`) and pass the string here:
 * it is pinned to midnight UTC, which is the same calendar day the legacy
 * database shows. A `Date` object is accepted too and normalised the same
 * way, so a caller that has not switched to `::text` yet still gets the right
 * day rather than silently drifting.
 *
 * This is not hypothetical: it shifted every `hireDate`, `purchaseDate`,
 * `birthDate`, `contractEndDate` and `registeredAt` in the first two import
 * steps before it was caught. See docs/legacy-migration.md.
 */
export function legacyDate(value: unknown): Date | null {
  if (typeof value === "string") {
    const day = value.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    return new Date(`${day}T00:00:00.000Z`);
  }
  if (value instanceof Date) {
    // Already a driver-parsed Date: rebuild from its LOCAL calendar day,
    // which is the day the legacy row actually holds.
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  }
  return null;
}

/**
 * Legacy `fournisseur.tva` is a string holding a percentage: "19%", "0%", "7%".
 * Returns the numeric rate, or `null` plus the original in `note` when it is not
 * a single rate — two real rows: "ATU58113767" (a VAT number in the rate column)
 * and "19% /7%" (two rates at once). Nothing is dropped silently.
 */
export function vatRate(raw: unknown): { rate: number | null; note: string | null } {
  const value = text(raw);
  if (value === null) return { rate: null, note: null };

  const match = /^(\d+(?:[.,]\d+)?)\s*%?$/.exec(value);
  if (match?.[1] === undefined) return { rate: null, note: value };

  const parsed = Number(match[1].replace(",", "."));
  return Number.isFinite(parsed) ? { rate: parsed, note: null } : { rate: null, note: value };
}

/**
 * Legacy `fournisseur.famille` is free text: inconsistent casing (`Service`) and
 * two overlapping FOURNITURE* values. Anything unrecognised returns null rather
 * than inventing a family — the value stays visible in the legacy DB.
 */
const FAMILIES = new Map<string, string>([
  ["ACCESSOIRE", "ACCESSOIRE"],
  ["SERVICE", "SERVICE"],
  ["CHIMIQUE", "CHIMIQUE"],
  ["TRANSPORT", "TRANSPORT"],
  ["PAPIER", "PAPIER"],
  ["ENCRE", "ENCRE"],
  ["HYGIENE", "HYGIENE"],
  ["FOURNITURES DES BUREAUX", "FOURNITURE"],
  ["FOURNITURE CONSOMMABLE", "FOURNITURE"],
]);

export function supplierFamily(raw: unknown): string | null {
  const value = text(raw);
  return value === null ? null : (FAMILIES.get(value.toUpperCase()) ?? null);
}

/**
 * Legacy `employee.department` is free text that drifted: Production /
 * Productionn / PRODUCTION were three distinct values, as were administratif /
 * Administratif / ADMINISTRATION. Collapsed to one spelling per department.
 *
 * Kept as free text rather than an enum or lookup table (a deliberate choice —
 * see docs/legacy-migration.md), so this map is the only thing standing between
 * the data and that drift returning. Anything unrecognised is title-cased and
 * passed through rather than dropped: an unknown department is still real.
 */
const DEPARTMENTS = new Map<string, string>([
  ["PRODUCTION", "Production"],
  ["PRODUCTIONN", "Production"],
  ["ADMINISTRATIF", "Administratif"],
  ["ADMINISTRATION", "Administratif"],
  ["SECURITE", "Sécurité"],
  ["SÉCURITÉ", "Sécurité"],
  ["DIRECTION", "Direction"],
  ["HYGIENE", "Hygiène"],
  ["HYGIÈNE", "Hygiène"],
]);

/** Title case for a value with no known mapping: "FR" -> "Fr". */
function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function department(raw: unknown): string | null {
  const value = text(raw);
  if (value === null) return null;
  return DEPARTMENTS.get(value.toUpperCase()) ?? titleCase(value);
}

/**
 * Legacy `employee.job_title` drifted the same way, worse: "Ouvrier
 * manoeuvrier", "OUVRIER MAINOEUVRE", "Ouvrier manoeuvre", "MANOUEUVRE" and
 * "Ouvrier manœuvrier" (with the œ ligature) are all the same job — 56 of the
 * 94 rows between them. Everything else is title-cased and passed through.
 */
const JOB_TITLES = new Map<string, string>([
  ["OUVRIER MANOEUVRIER", "Ouvrier manoeuvre"],
  ["OUVRIER MAINOEUVRE", "Ouvrier manoeuvre"],
  ["OUVRIER MANOEUVRE", "Ouvrier manoeuvre"],
  ["OUVRIER MANŒUVRIER", "Ouvrier manoeuvre"],
  ["OUVRIER MANŒUVRE", "Ouvrier manoeuvre"],
  ["MANOUEUVRE", "Ouvrier manoeuvre"],
  ["MANOEUVRE", "Ouvrier manoeuvre"],
  // Single-row typos of a title that already exists in the data.
  ["AGENT ADMINISTARTIF", "Agent administratif"],
  ["AGENT ADMINISTRATIF", "Agent administratif"],
  ["MAQUETISTE", "Maquettiste"],
]);

export function jobTitle(raw: unknown): string | null {
  const value = text(raw);
  if (value === null) return null;
  const key = value.toUpperCase();
  const mapped = JOB_TITLES.get(key);
  if (mapped) return mapped;
  // Preserve internal capitals for titles that are already mixed case; only
  // rescue the all-caps ones, which are shouting rather than meaningful.
  return value === key ? titleCase(value) : value;
}

/**
 * The legacy connection string. Kept separate from DATABASE_URL so a mistyped
 * env var can never point the importer at the new database and read itself.
 */
export function legacyPool(): Pool {
  const connectionString = process.env.LEGACY_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "LEGACY_DATABASE_URL must be set (see docs/legacy-migration.md). " +
        "Start the old container first: docker start bicapack-postgres",
    );
  }
  return new Pool({ connectionString, max: 4 });
}
