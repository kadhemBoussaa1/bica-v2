/**
 * Re-registers the old app's production entries of a date window in the shape
 * the new form records (user, 2026-10-21).
 *
 *   node dist/migrate/reshape-legacy-production.js --from 2026-10-01 --to 2026-10-12           # dry run
 *   node dist/migrate/reshape-legacy-production.js --from 2026-10-01 --to 2026-10-12 --apply
 *
 * The first days of October were still typed in the old app, and the 10-05
 * and 10-09 deltas (import-stock --production-only --only-new) brought them
 * in as migrated rows: every one at the PRODUCER station — printing metres
 * included, so the day and month views added metres to bag pieces — with no
 * machine and nobody behind it. This gives each the station, machine,
 * figures and person the new form would have recorded:
 *
 *   - station: metres are printing; pieces are printing on a bag printer
 *     and production on a bag machine;
 *   - machine: the old app's `employee_commande_assignment` — the admin
 *     assigned an order and a machine to an operator for a day, and the
 *     operator typed his figures against it. The assignment live when the
 *     entry was typed wins; a few were changed after (see `assignedMachine`).
 *     Every metre was printed on the flexo (`REEL_PRESS`). An assignment
 *     without a machine falls back on the nearest evidence
 *     (`inferredMachine`), or none. The old app put machines on its
 *     assignments from August 2026; before that this has nothing to go on;
 *   - figures: good pieces stay good, defective pieces go to "à reprendre",
 *     waste in kg goes to the note (the form's "déchets" counts pieces);
 *   - person: the operator's account (`Employee.userId`), as if he had typed
 *     it here, with the old app's own typing time as `createdAt`.
 *
 * Rows of the window the old app no longer has (deleted there after a delta
 * copied them) are deleted here, and so are the entries the user called
 * false. Entries the deltas never reached are created.
 *
 * Reads two tables of the old app's RAW database (LEGACY_RAW_DATABASE_URL):
 * `production` and `employee_commande_assignment`. Orders, employees and
 * machines are matched by `legacyId`.
 *
 * Only rows still in the migrated shape (no machine, nobody) are rewritten
 * or deleted: a row changed in this app since is reported and left. The one
 * exception is a row this script left unattributed because its operator had
 * no linked account: once an admin links one (employee page), a second run
 * fills in the person and nothing else. An entry it cannot place — no unit,
 * an order not here, metres on a bag machine — is left as it was and
 * reported. One transaction, all or nothing. A second run on the same data
 * writes nothing.
 *
 * Creates no notification, email or audit row, like every import here.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { machineTypesForStage, printingUnitFor } from "@repo/api-contract";
import { PrismaClient } from "../generated/prisma/client.js";
import type { ProductionUnit, WorkshopStage } from "../generated/prisma/enums.js";
import { legacyDate, legacyRawPool, text } from "./legacy.js";

// The old app's timestamps are wall-clock Tunis time with no zone; read them
// as such, as sync-paper does. Written, not read, so it is no build input.
// eslint-disable-next-line turbo/no-undeclared-env-vars
process.env.TZ = "Africa/Tunis";

/** Machines that print bags already made, counted in pieces (user, 2026-10-21). */
const BAG_PRINTERS = ["Y1572"];

/**
 * The press every metre was printed on (user, 2026-10-21). The assignment
 * table puts some on the bag printer Y1572 — six in October, for CMD-736,
 * 739 and 741 — and leaves others without a machine; metres are the flexo's.
 */
const REEL_PRESS = "R2023026";

/**
 * False entries (user, 2026-10-21): metres typed on the V-bag machine
 * R2024333 for CMD-742, which prints and makes bags in one pass — the bags
 * it made are the record.
 */
const FALSE_ENTRIES = new Set(["1810", "1811"]);

class DryRunRollback extends Error {}

type Row = Record<string, unknown>;

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function day(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`not a day: ${value}`);
  return value;
}

function arg(name: string): string {
  const at = process.argv.indexOf(name);
  const value = at === -1 ? undefined : process.argv[at + 1];
  if (!value) throw new Error(`${name} YYYY-MM-DD is required`);
  return day(value);
}

/** "17.5" -> "17,5": the note is read in French, like the old app's. */
function kg(value: number): string {
  return `${String(value).replace(".", ",")} kg`;
}

/** One `employee_commande_assignment` row, as the machine rules read it. */
interface Assignment {
  order: string;
  employee: string;
  day: string;
  /** Legacy machine id; null on every July assignment and 30 later ones. */
  machine: string | null;
  active: boolean;
  created: number;
  closed: number;
}

/**
 * The machine the operator was assigned to when he typed the entry: an
 * assignment created by then and not yet closed (`active`, or closed after).
 * The admin sometimes reassigned within seconds, or moved an operator after
 * his entry (CMD-734 on 6 Oct: entry at 13:13 on R2024106-2, moved to
 * R2024133 at 14:17) — so neither the first nor the last one is right.
 * When none was live at that moment, a single machine across them all still
 * answers; otherwise the latest created before the entry, reported. An
 * assignment without a machine says nothing about one, so it is ignored
 * beside one that names it (29 Aug, CMD-686).
 */
function assignedMachine(that: Assignment[], typedAt: Date): { machine: string | null; note: string | null } {
  const named = that.filter((a) => a.machine !== null);
  const machines = (rows: Assignment[]) => [...new Set(rows.map((a) => a.machine))];
  const at = typedAt.getTime();

  const live = named.filter((a) => a.created <= at && (a.active || a.closed > at));
  const liveMachines = machines(live);
  if (liveMachines.length === 1) return { machine: liveMachines[0] ?? null, note: null };

  const all = machines(named);
  if (all.length <= 1) return { machine: all[0] ?? null, note: null };

  const before = named.filter((a) => a.created <= at).sort((a, b) => b.created - a.created);
  return {
    machine: (before[0] ?? named[0])?.machine ?? null,
    note: `${named.length} assignments, ${liveMachines.length} live when typed — took the latest before it`,
  };
}

/**
 * For a piece entry whose assignment names no machine: the nearest evidence,
 * in order — the operator's own machine on this order on other days, the
 * order's only machine, the operator's only machine that day. Each must be
 * the ONLY machine at its level, and a bag machine: a piece count is not
 * placed on a printer by inference. Otherwise none, and the entry keeps its
 * station and figures without a machine.
 */
function inferredMachine(
  all: Assignment[],
  entry: { order: string; employee: string | null; day: string },
  isBagMachine: (legacyMachineId: string) => boolean,
): { machine: string | null; how: string } {
  const only = (rows: Assignment[]) => {
    const machines = [
      ...new Set(rows.map((a) => a.machine).filter((m): m is string => m !== null && isBagMachine(m))),
    ];
    return machines.length === 1 ? (machines[0] ?? null) : null;
  };
  const { order, employee, day } = entry;
  const levels: [string, Assignment[]][] = [
    ["his machine on this order", employee ? all.filter((a) => a.order === order && a.employee === employee) : []],
    ["the order's only machine", all.filter((a) => a.order === order)],
    ["his only machine that day", employee ? all.filter((a) => a.employee === employee && a.day === day) : []],
  ];
  for (const [how, rows] of levels) {
    const machine = only(rows);
    if (machine) return { machine, how };
  }
  return { machine: null, how: "no single machine to infer — left without one" };
}

/** The columns a run is compared and written on. */
const RUN_SELECT = {
  id: true,
  legacyId: true,
  dateProduction: true,
  stage: true,
  quantite: true,
  unit: true,
  metersPrinted: true,
  piecesPrinted: true,
  piecesProduced: true,
  goodPieces: true,
  defectivePieces: true,
  wastePieces: true,
  piecesToFix: true,
  parcelsClosed: true,
  note: true,
  verifiedAt: true,
  verifiedBy: true,
  orderId: true,
  employeeId: true,
  machineId: true,
  recordedById: true,
  createdAt: true,
} as const;

interface Target {
  dateProduction: Date;
  stage: WorkshopStage;
  quantite: number;
  unit: ProductionUnit;
  metersPrinted: number | null;
  piecesPrinted: number | null;
  piecesProduced: number | null;
  goodPieces: number | null;
  defectivePieces: number | null;
  wastePieces: number | null;
  piecesToFix: number | null;
  parcelsClosed: number | null;
  note: string | null;
  verifiedAt: Date | null;
  verifiedBy: string | null;
  orderId: string;
  employeeId: string | null;
  machineId: string | null;
  recordedById: string | null;
  createdAt: Date;
}

function differs(current: Record<string, unknown>, want: Target): string[] {
  return (Object.keys(want) as (keyof Target)[]).filter((key) => {
    const a = current[key];
    const b = want[key];
    if (a instanceof Date && b instanceof Date) return a.getTime() !== b.getTime();
    return (a ?? null) !== (b ?? null);
  });
}

/** Still as a delta brought it in: nobody here has given it a machine or a person. */
function migratedShape(run: { machineId: string | null; recordedById: string | null }): boolean {
  return run.machineId === null && run.recordedById === null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const from = arg("--from");
  const to = arg("--to");
  const raw = legacyRawPool();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const lines: string[] = [];
  const problems: string[] = [];
  const counts: Record<string, number> = {};
  const count = (key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };

  try {
    const { rows: source } = await raw.query<Row>(
      `SELECT id::text AS id, date_production::text AS day, quantite, unit, commande_id::text AS commande_id,
              employee_id::text AS employee_id, good_pieces, defective_pieces, waste_kg, note,
              verified_at, verified_by, entry_time, created_at, created_by
         FROM production
        WHERE date_production BETWEEN $1::date AND $2::date
        ORDER BY date_production, id`,
      [from, to],
    );
    const { rows: everyId } = await raw.query<{ id: string }>(`SELECT id::text AS id FROM production`);
    const inOldApp = new Set(everyId.map((row) => row.id));
    // All of them, not the window's: the fallback reads an order's other days.
    const { rows: assignmentRows } = await raw.query<Row>(
      `SELECT commande_id::text AS commande_id, employee_id::text AS employee_id,
              production_date::text AS day, machine_id::text AS machine_id, active, created_at, updated_at
         FROM employee_commande_assignment`,
    );
    const allAssignments: Assignment[] = assignmentRows.map((a) => ({
      order: String(a.commande_id),
      employee: String(a.employee_id),
      day: String(a.day),
      machine: a.machine_id == null ? null : String(a.machine_id),
      active: a.active === true,
      created: a.created_at instanceof Date ? a.created_at.getTime() : -Infinity,
      closed: a.updated_at instanceof Date ? a.updated_at.getTime() : Infinity,
    }));
    const assignments = new Map<string, Assignment[]>();
    for (const a of allAssignments) {
      const key = `${a.order}|${a.employee}|${a.day}`;
      assignments.set(key, [...(assignments.get(key) ?? []), a]);
    }

    await prisma.$transaction(
      async (tx) => {
        // ---- the bag printers count pieces --------------------------------
        for (const code of BAG_PRINTERS) {
          const machine = await tx.machine.findFirst({ where: { code }, select: { id: true, type: true } });
          if (!machine) {
            problems.push(`bag printer ${code}: no such machine`);
            continue;
          }
          if (machine.type === "IMPRESSION_SAC") continue;
          if (machine.type !== "IMPRESSION") {
            problems.push(`bag printer ${code} is a ${machine.type}, not a printer — not changed`);
            continue;
          }
          const inMetres = await tx.productionRun.count({
            where: { machineId: machine.id, stage: "PRINTING", metersPrinted: { not: null } },
          });
          if (inMetres > 0) {
            problems.push(`bag printer ${code} already has ${inMetres} printing runs in metres here`);
            continue;
          }
          await tx.machine.update({ where: { id: machine.id }, data: { type: "IMPRESSION_SAC" } });
          lines.push(`machine ${code}: IMPRESSION -> IMPRESSION_SAC (counts pieces)`);
          count("machines made bag printers");
        }

        // ---- lookups by legacyId ------------------------------------------
        const legacyIds = (values: unknown[]) => [...new Set(values.map((v) => BigInt(String(v))))];
        const orders = new Map(
          (
            await tx.order.findMany({
              where: { legacyId: { in: legacyIds(source.map((r) => r.commande_id)) } },
              select: { id: true, numero: true, legacyId: true },
            })
          ).map((o) => [String(o.legacyId), o]),
        );
        const employees = new Map(
          (
            await tx.employee.findMany({
              where: { legacyId: { in: legacyIds(source.map((r) => r.employee_id).filter((v) => v != null)) } },
              select: { id: true, legacyId: true, firstName: true, lastName: true, userId: true },
            })
          ).map((e) => [String(e.legacyId), e]),
        );
        const machineRows = await tx.machine.findMany({
          select: { id: true, code: true, type: true, active: true, legacyId: true },
        });
        const machineByLegacy = new Map(machineRows.filter((m) => m.legacyId !== null).map((m) => [String(m.legacyId), m]));
        const isPrinter = (m: { type: (typeof machineRows)[number]["type"] }) =>
          (machineTypesForStage("PRINTING") ?? []).includes(m.type);
        const isBagMachine = (legacyMachineId: string) => {
          const m = machineByLegacy.get(legacyMachineId);
          return m !== undefined && (machineTypesForStage("PRODUCER") ?? []).includes(m.type);
        };
        const reelPress = machineRows.find((m) => m.code === REEL_PRESS);
        if (!reelPress || !isPrinter(reelPress) || printingUnitFor(reelPress.type) !== "METER") {
          problems.push(`reel press ${REEL_PRESS}: missing, or not a printer that counts metres`);
        }

        const start = new Date(`${from}T00:00:00.000Z`);
        const end = new Date(`${to}T00:00:00.000Z`);
        const here = await tx.productionRun.findMany({
          where: { legacyId: { not: null }, dateProduction: { gte: start, lte: end } },
          select: RUN_SELECT,
        });
        const hereByLegacy = new Map(here.map((run) => [String(run.legacyId), run]));
        // A source row dated in the window may sit outside it here, or the reverse.
        const strays = await tx.productionRun.findMany({
          where: { legacyId: { in: source.map((r) => BigInt(String(r.id))) }, NOT: { id: { in: here.map((r) => r.id) } } },
          select: RUN_SELECT,
        });
        for (const run of strays) hereByLegacy.set(String(run.legacyId), run);

        const before = await tx.productionRun.groupBy({
          by: ["stage", "unit"],
          where: { dateProduction: { gte: start, lte: end } },
          _sum: { quantite: true },
          _count: { _all: true },
        });

        // ---- each entry of the window -------------------------------------
        for (const row of source) {
          const id = String(row.id);
          const label = `${id} ${String(row.day)}`;
          if (FALSE_ENTRIES.has(id)) continue;

          const leave = (why: string) => {
            lines.push(`LEFT     ${label}: ${why} — left as it was`);
            count("runs left as they were");
          };
          const order = orders.get(String(row.commande_id));
          if (!order) {
            leave(`order (legacy ${String(row.commande_id)}) not here`);
            continue;
          }
          const employee = row.employee_id == null ? undefined : employees.get(String(row.employee_id));
          const typedAt =
            row.entry_time instanceof Date ? row.entry_time : row.created_at instanceof Date ? row.created_at : null;
          if (!typedAt) {
            leave(`${order.numero}: no typing time`);
            continue;
          }
          const quantite = num(row.quantite) ?? 0;
          const good = num(row.good_pieces);
          const defective = num(row.defective_pieces);
          const unit = text(row.unit);
          if (unit !== "METER" && unit !== "PIECE") {
            // Typed without a unit (by the office, mostly): no station to give it.
            leave(`${order.numero}: ${quantite} with no unit, typed by ${String(text(row.created_by) ?? "?")}`);
            continue;
          }

          const assigned = assignedMachine(
            assignments.get(`${String(row.commande_id)}|${String(row.employee_id)}|${String(row.day)}`) ?? [],
            typedAt,
          );
          let machine = assigned.machine ? machineByLegacy.get(assigned.machine) : undefined;
          const how: string[] = assigned.note ? [assigned.note] : [];
          if (unit === "METER") {
            if (machine && !isPrinter(machine)) {
              leave(`${order.numero}: ${quantite} m on ${machine.code}, a bag machine`);
              continue;
            }
            if (!machine || printingUnitFor(machine.type) === "PIECE") {
              how.push(machine ? `assigned ${machine.code}, which counts pieces — on ${REEL_PRESS}` : `no machine assigned — on ${REEL_PRESS}`);
              machine = reelPress;
            }
          } else {
            if (machine && isPrinter(machine) && printingUnitFor(machine.type) === "METER") {
              how.push(`assigned ${machine.code}, which counts metres`);
              machine = undefined;
            }
            if (!machine) {
              const inferred = inferredMachine(
                allAssignments,
                { order: String(row.commande_id), employee: row.employee_id == null ? null : String(row.employee_id), day: String(row.day) },
                isBagMachine,
              );
              machine = inferred.machine ? machineByLegacy.get(inferred.machine) : undefined;
              how.push(machine ? `${machine.code}, ${inferred.how}` : inferred.how);
            }
          }
          if (how.length > 0) lines.push(`${label} ${order.numero}: machine ${how.join("; ")}`);

          const stage: WorkshopStage = unit === "METER" || (machine && isPrinter(machine)) ? "PRINTING" : "PRODUCER";
          if (unit === "PIECE" && !Number.isInteger(quantite)) {
            leave(`${order.numero}: ${quantite} pieces is not a whole count`);
            continue;
          }
          if (stage === "PRINTING" && (defective ?? 0) > 0) {
            leave(`${order.numero}: ${defective} defective on a printer — no field for it`);
            continue;
          }

          const waste = num(row.waste_kg);
          const note = [text(row.note), waste !== null && waste > 0 ? `Déchets : ${kg(waste)}` : null]
            .filter(Boolean)
            .join(" — ");
          const target: Target = {
            dateProduction: legacyDate(row.day)!,
            stage,
            quantite,
            unit,
            metersPrinted: stage === "PRINTING" && unit === "METER" ? quantite : null,
            piecesPrinted: stage === "PRINTING" && unit === "PIECE" ? quantite : null,
            piecesProduced: stage === "PRODUCER" ? quantite : null,
            goodPieces: stage === "PRODUCER" && good !== null ? Math.trunc(good) : null,
            defectivePieces: null,
            wastePieces: null,
            piecesToFix: stage === "PRODUCER" && defective !== null ? Math.trunc(defective) : null,
            parcelsClosed: null,
            note: note === "" ? null : note,
            verifiedAt: row.verified_at instanceof Date ? row.verified_at : null,
            verifiedBy: text(row.verified_by),
            orderId: order.id,
            employeeId: employee?.id ?? null,
            machineId: machine?.id ?? null,
            recordedById: employee?.userId ?? null,
            createdAt: typedAt,
          };
          const who = employee ? `${employee.firstName} ${employee.lastName}`.replace(/\s+/g, " ").trim() : "nobody";
          if (!employee?.userId) lines.push(`${label} ${order.numero}: ${who} has no account — entry stays unattributed`);
          const what =
            `${label} ${order.numero} ${stage} ${machine?.code ?? "no machine"} ${quantite} ${unit === "METER" ? "m" : "pcs"}` +
            (target.goodPieces !== null ? ` (good ${target.goodPieces}, to fix ${target.piecesToFix ?? 0})` : "") +
            (target.note ? ` [${target.note}]` : "") +
            ` · ${who}`;

          const current = hereByLegacy.get(id);
          hereByLegacy.delete(id);
          if (!current) {
            await tx.productionRun.create({ data: { ...target, legacyId: BigInt(id) }, select: { id: true } });
            lines.push(`created  ${what}`);
            count("runs created");
            continue;
          }
          const changed = differs(current, target);
          if (changed.length === 0) {
            count("runs already in shape");
            continue;
          }
          // Left unattributed by a first run, its operator linked since.
          const nowAttributed = current.recordedById === null && changed.every((k) => k === "recordedById");
          if (!migratedShape(current) && !nowAttributed) {
            lines.push(`LEFT     ${what} — changed here since (${changed.join(", ")})`);
            count("runs changed here, left");
            continue;
          }
          await tx.productionRun.update({ where: { id: current.id }, data: target, select: { id: true } });
          lines.push(`reshaped ${what}`);
          count("runs reshaped");
        }

        // ---- what the old app no longer has, and the false entries --------
        for (const [legacyId, run] of hereByLegacy) {
          const gone = !inOldApp.has(legacyId);
          if (!gone && !FALSE_ENTRIES.has(legacyId)) continue;
          const why = gone ? "deleted in the old app" : "false entry";
          const what = `${legacyId} ${run.dateProduction.toISOString().slice(0, 10)} ${run.quantite} ${run.unit ?? ""} (${why})`;
          if (!migratedShape(run)) {
            lines.push(`LEFT     ${what} — changed here since`);
            count("runs changed here, left");
            continue;
          }
          await tx.productionRun.delete({ where: { id: run.id } });
          lines.push(`deleted  ${what}`);
          count("runs deleted");
        }

        if (problems.length > 0) throw new DryRunRollback();

        const after = await tx.productionRun.groupBy({
          by: ["stage", "unit"],
          where: { dateProduction: { gte: start, lte: end } },
          _sum: { quantite: true },
          _count: { _all: true },
        });
        lines.push("", `window ${from} .. ${to}, by station and unit:`);
        const key = (g: { stage: string; unit: string | null }) => `${g.stage} ${g.unit ?? "-"}`;
        for (const k of [...new Set([...before, ...after].map(key))].sort()) {
          const b = before.find((g) => key(g) === k);
          const a = after.find((g) => key(g) === k);
          lines.push(
            `  ${k.padEnd(18)} before ${String(b?._count._all ?? 0).padStart(3)} runs ${String(b?._sum.quantite ?? 0).padStart(10)}` +
              `   after ${String(a?._count._all ?? 0).padStart(3)} runs ${String(a?._sum.quantite ?? 0).padStart(10)}`,
          );
        }

        if (!apply) throw new DryRunRollback();
      },
      { timeout: 5 * 60 * 1000, maxWait: 60 * 1000 },
    );
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  } finally {
    await raw.end();
    await prisma.$disconnect();
  }

  for (const line of lines) console.log(line);
  console.log("");
  for (const [key, value] of Object.entries(counts).sort()) console.log(`${key}: ${value}`);
  if (problems.length > 0) {
    console.log("\nSTOPPED — nothing written. Resolve these first:");
    for (const problem of problems) console.log(`  ${problem}`);
    process.exitCode = 1;
    return;
  }
  if (!counts["runs created"] && !counts["runs reshaped"] && !counts["runs deleted"] && !counts["machines made bag printers"]) {
    console.log("nothing to do — the window is already in the new shape");
  }
  console.log(apply ? "\napplied" : "\n(dry run — nothing written; --apply to write)");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
