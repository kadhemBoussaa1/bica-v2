import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type { CreateProductionRunInput, UpdateProductionRunInput } from "@repo/api-contract";
import { machineTypesForStage, ordersAreScopedFor } from "@repo/api-contract";
import type { Prisma } from "../generated/prisma/client.js";
import { runListQuery } from "../list/list-query";
import { orderScopeFor } from "../order/order.scope";
import { PrismaService } from "../prisma.service";
import type { SessionUser } from "../trpc/trpc";
import {
  PRODUCTION_SELECT,
  productionListDeclaration,
  type ListProductionInput,
  type ProductionDailyInput,
  type ProductionMonthlyInput,
} from "./production.list";

/**
 * Recorded production runs — what was made against an order on one day.
 *
 * PRODUCTION records and corrects runs here (from the order detail page),
 * alongside ADMIN and above; the cross-order roll-ups (`list`, `daily`,
 * `monthly`) are ADMIN and above only — see the router. A run is attributed to whoever recorded it through the
 * session rather than naming an employee — see `createProductionRunInput` for
 * why `employeeId` is not part of the input.
 *
 * Everything a PRODUCTION user can see or touch is bounded by the order
 * behind the run: the same `orderScopeFor` predicate the orders list uses. Without that, hiding an order from the orders list would
 * still leak it through its production history.
 */
@Injectable()
export class ProductionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Session-derived scope, expressed through the run's `order` relation —
   * `orderScopeFor`, one level of indirection out. Empty (not `{ order: {} }`)
   * for the unscoped roles so their query plan takes no join.
   */
  private scopeFor(actor: SessionUser): Prisma.ProductionRunWhereInput {
    return ordersAreScopedFor(actor.role) ? { order: orderScopeFor(actor.role) } : {};
  }

  async list(actor: SessionUser, query: ListProductionInput) {
    return runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) =>
          this.prisma.productionRun.findMany({ ...args, select: PRODUCTION_SELECT }),
        count: (args) => this.prisma.productionRun.count(args),
      },
      query,
      declaration: productionListDeclaration,
      scope: this.scopeFor(actor),
    });
  }

  async byId(actor: SessionUser, id: string) {
    const run = await this.prisma.productionRun.findFirst({
      where: { AND: [{ id }, this.scopeFor(actor)] },
      select: PRODUCTION_SELECT,
    });
    if (!run) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Production run not found" });
    }
    return run;
  }

  /**
   * Every run against one order, newest first — for the order detail page.
   * Not paginated: about a thousand runs across a few hundred orders in the
   * migrated data, so no single order has more than a screenful.
   *
   * Returns an empty list rather than throwing when the order is out of
   * scope: the caller already got NOT_FOUND from `order.byId` for that same
   * order, and this query is a panel on that page rather than the thing being
   * asked for.
   */
  async forOrder(actor: SessionUser, orderId: string) {
    return this.prisma.productionRun.findMany({
      where: { AND: [{ orderId }, this.scopeFor(actor)] },
      select: PRODUCTION_SELECT,
      orderBy: [{ dateProduction: "desc" }, { id: "asc" }],
    });
  }

  /**
   * One day of production, shaped for the daily dashboard.
   *
   * Returns the day's runs grouped by station, plus that day's totals. The
   * grouping and the sums are done HERE rather than in the browser for two
   * reasons: the KPI tiles must agree with the sections beneath them (one
   * pass over one result set guarantees that), and a client that re-derives
   * totals from a paginated list would quietly report the page's sum rather
   * than the day's.
   *
   * Not paginated — the busiest day in the migrated data has 10 runs, so a
   * day is always a screenful. Scoped like every other read here, so a
   * PRODUCTION user's day only covers orders on the floor.
   *
   * PRINTING and PRODUCER are grouped by MACHINE (each machine listing the
   * people who ran it); QUALITY_CONTROL and PACKAGING by PERSON, since
   * neither records a machine at all.
   */
  async daily(actor: SessionUser, input: ProductionDailyInput) {
    const day = new Date(`${input.date}T00:00:00.000Z`);
    const runs = await this.prisma.productionRun.findMany({
      where: { AND: [{ dateProduction: day }, this.scopeFor(actor)] },
      select: PRODUCTION_SELECT,
      orderBy: [{ createdAt: "asc" }],
    });

    // Two different fallback rules, and conflating them is a real bug:
    //
    //   `headline` — the stage's main figure. A migrated row has only
    //   `quantite`, so fall back to it; that IS the row's output.
    //
    //   `breakdown` — the producer's good/waste/to-fix split. A migrated row
    //   has NO breakdown, so a null must contribute 0. Falling back to
    //   `quantite` here would report every legacy row's full output as
    //   simultaneously good AND waste AND needing repair.
    const forStage = (stage: string) => runs.filter((r) => r.stage === stage);
    const headline = (stage: string, pick: (r: DailyRun) => number | null) =>
      forStage(stage).reduce((total, r) => total + (pick(r) ?? r.quantite), 0);
    const breakdown = (stage: string, pick: (r: DailyRun) => number | null) =>
      forStage(stage).reduce((total, r) => total + (pick(r) ?? 0), 0);

    return {
      date: input.date,
      totals: {
        metersPrinted: headline("PRINTING", (r) => r.metersPrinted),
        piecesProduced: headline("PRODUCER", (r) => r.piecesProduced),
        piecesControlled: headline("QUALITY_CONTROL", (r) => r.piecesControlled),
        parcelsClosed: headline("PACKAGING", (r) => r.parcelsClosed),
        // The producer breakdown, which does not have to sum to
        // `piecesProduced` — see the note on those columns.
        goodPieces: breakdown("PRODUCER", (r) => r.goodPieces),
        wastePieces: breakdown("PRODUCER", (r) => r.wastePieces),
        piecesToFix: breakdown("PRODUCER", (r) => r.piecesToFix),
        runCount: runs.length,
      },
      /** Machine-grouped: one entry per machine used that day. */
      byMachine: {
        PRINTING: groupByMachine(runs.filter((r) => r.stage === "PRINTING")),
        PRODUCER: groupByMachine(runs.filter((r) => r.stage === "PRODUCER")),
      },
      /** Person-grouped: these two stations record no machine. */
      byPerson: {
        QUALITY_CONTROL: groupByPerson(runs.filter((r) => r.stage === "QUALITY_CONTROL")),
        PACKAGING: groupByPerson(runs.filter((r) => r.stage === "PACKAGING")),
      },
    };
  }

  /**
   * A range of whole months, per machine and per operator, shaped for the
   * monthly view: the months' totals, then one pivot row per machine
   * (PRINTING, PRODUCER) and per person (all four stations), each with one
   * cell per month. Every row is zero-filled for every month in the range, so
   * the client lays cells out by position and never looks one up.
   *
   * The headline is `SUM(quantite)`, for every station and both eras. That
   * rests on an invariant kept by `writable()`: a new run copies its station's
   * headline (`metersPrinted`, `piecesProduced`, ...) into `quantite`, and a
   * migrated row has only `quantite`. So the sum equals what `daily` reaches
   * with its `pick(r) ?? r.quantite` fallback, and a month's tiles agree with
   * its days. If `writable()` ever stops doing that, this silently drifts.
   * The breakdown columns need no fallback: a null contributes nothing to a
   * `SUM`, which is the same rule as `daily`'s `?? 0`.
   *
   * Aggregated in the database rather than by fetching runs as `daily` does:
   * a range is up to 24 months. Prisma cannot group by a month expression, so
   * the grouping is by DAY and the fold into months happens here — at most a
   * few thousand small rows.
   *
   * "Per person" is `recordedBy`, the session that typed the run in, not the
   * legacy `employee` link. `machineId` and `recordedById` are null on every
   * migrated row and were first written in 2026-09, so every earlier month
   * lands in ONE unattributed row per station. That row is real output and
   * stays in the table — which machine ran a job in 2024 is not something to
   * guess (see the schema note on `machineId`).
   */
  async monthly(actor: SessionUser, input: ProductionMonthlyInput) {
    const { months, where } = this.monthRange(actor, input);

    const groups = await this.prisma.productionRun.groupBy({
      by: ["stage", "machineId", "recordedById", "dateProduction"],
      where,
      _sum: MONTHLY_SUM,
      _count: { _all: true },
    });

    const idsOf = (pick: (g: (typeof groups)[number]) => string | null) => [
      ...new Set(groups.map(pick).filter((id): id is string => id !== null)),
    ];
    // Same selects as `PRODUCTION_SELECT`, so a machine or a person reads the
    // same in the month view as in the day view. One snapshot for both.
    const [machineRows, personRows] = await this.prisma.$transaction([
      this.prisma.machine.findMany({
        where: { id: { in: idsOf((g) => g.machineId) } },
        select: PRODUCTION_SELECT.machine.select,
      }),
      this.prisma.user.findMany({
        where: { id: { in: idsOf((g) => g.recordedById) } },
        select: PRODUCTION_SELECT.recordedBy.select,
      }),
    ]);
    const machines = new Map(machineRows.map((m) => [m.id, m]));
    const people = new Map(personRows.map((p) => [p.id, p]));

    const tallies = groups.map((g) => ({
      ...dayTally(g),
      // An id that did not hydrate (an account deleted between the two
      // reads) folds into the unattributed row rather than making a second.
      machineId: g.machineId !== null && machines.has(g.machineId) ? g.machineId : null,
      personId: g.recordedById !== null && people.has(g.recordedById) ? g.recordedById : null,
    }));

    const forStage = (stage: string) => tallies.filter((t) => t.stage === stage);
    // The `!`s below cannot miss: `tallies` keeps an id only when the map has
    // it (see above), and `pivot` hands back exactly the ids it was given.
    const machinePivot = (stage: string) =>
      pivot(forStage(stage), months, (t) => t.machineId)
        .map(({ id, ...row }) => ({ machine: id === null ? null : machines.get(id)!, ...row }))
        .sort(namedFirst((row) => row.machine?.name ?? null));
    const personPivot = (stage: string) =>
      pivot(forStage(stage), months, (t) => t.personId)
        .map(({ id, ...row }) => ({ person: id === null ? null : people.get(id)!, ...row }))
        .sort(namedFirst((row) => row.person?.name ?? null));

    return {
      months,
      totals: foldTotals(months, tallies),
      /** One row per machine that ran in the range, per machine station. */
      byMachine: {
        PRINTING: machinePivot("PRINTING"),
        PRODUCER: machinePivot("PRODUCER"),
      },
      /** One row per person who recorded in the range, per station. */
      byPerson: {
        PRINTING: personPivot("PRINTING"),
        PRODUCER: personPivot("PRODUCER"),
        QUALITY_CONTROL: personPivot("QUALITY_CONTROL"),
        PACKAGING: personPivot("PACKAGING"),
      },
    };
  }

  /**
   * `monthly`'s `totals` alone — the figure the dashboard's trend reads.
   *
   * Grouped by station and day only, with no machine or person key and no
   * lookups: the same `where`, the same sums and the same `foldTotals`, so a
   * month here equals that month's tiles on the production page. Cheaper by
   * the pivots and the two hydration reads, which is what a per-minute poll
   * of twelve months wants.
   */
  async monthlyTotals(actor: SessionUser, input: ProductionMonthlyInput) {
    const { months, where } = this.monthRange(actor, input);
    const groups = await this.prisma.productionRun.groupBy({
      by: ["stage", "dateProduction"],
      where,
      _sum: MONTHLY_SUM,
      _count: { _all: true },
    });
    return { months, totals: foldTotals(months, groups.map(dayTally)) };
  }

  /** The months of a range and the run predicate that bounds it, for both monthly reads. */
  private monthRange(actor: SessionUser, input: ProductionMonthlyInput) {
    const months = monthsBetween(input.from, input.to);
    const start = new Date(`${input.from}-01T00:00:00.000Z`);
    // The first day of the month after `to`: `Date.UTC` takes a 0-based
    // month, so the 1-based month number IS the next month, and 12 rolls the
    // year over by itself.
    const end = new Date(
      Date.UTC(Number(input.to.slice(0, 4)), Number(input.to.slice(5, 7)), 1),
    );
    // `scopeFor` is `{}` for every role the router lets in; it stays so
    // this read is scoped the same way as every other one here.
    const where: Prisma.ProductionRunWhereInput = {
      AND: [{ dateProduction: { gte: start, lt: end } }, this.scopeFor(actor)],
    };
    return { months, where };
  }

  /**
   * Records one run against an order.
   *
   * The order must exist AND be in the caller's scope — so a PRODUCTION user
   * cannot record against a draft, an invoiced order, or a quote. Hidden with
   * NOT_FOUND rather than FORBIDDEN, per the repo convention.
   *
   * Deliberately does NOT transition the order: recording output and
   * declaring the job finished are separate acts, and
   * `IN_PRODUCTION -> PRODUCED` stays an explicit, audited decision through
   * `OrderService.transition` (see docs/order-lifecycle-plan.md §3.2 — the
   * shortfall is warned about, never enforced, so nothing here can infer
   * "done" from a quantity either).
   *
   * Note that a PACKAGING run recorded here is what later UNBLOCKS that
   * transition for a PRODUCTION user — see `OrderService.transition`. The
   * dependency runs one way only: packaging does not advance anything by
   * itself, it just stops being a reason the transition is refused.
   */
  async create(actor: SessionUser, input: CreateProductionRunInput) {
    await this.assertOrderInScope(actor, input.orderId);
    await this.assertMachineFitsStage(input);
    return this.prisma.productionRun.create({
      data: {
        orderId: input.orderId,
        recordedById: actor.id,
        ...this.writable(input),
      },
      select: RETURN_SELECT,
    });
  }

  /**
   * Corrects a run in place. Neither `orderId` nor `stage` is updatable — a
   * run recorded against the wrong order or station is deleted and
   * re-recorded, rather than moved, so it cannot be walked out of the
   * caller's scope, or turn a PACKAGING run (the produced gate's evidence)
   * into another station's, by editing it. `stage` is in the input only as
   * the union's discriminant; a value that differs from the row's is refused.
   */
  async update(actor: SessionUser, input: UpdateProductionRunInput) {
    const run = await this.assertRunInScope(actor, input.id);
    if (input.stage !== run.stage) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A run's station cannot be changed — delete it and record it again",
      });
    }
    await this.assertMachineFitsStage(input);
    return this.prisma.productionRun.update({
      where: { id: input.id },
      data: this.writable(input),
      select: RETURN_SELECT,
    });
  }

  /**
   * Hard delete, unlike the archive flag every other module uses: a run is a
   * dated measurement, not a record other rows reference, so a mis-keyed one
   * is noise rather than history worth keeping. ADMIN-gated at the router.
   */
  async remove(id: string) {
    const found = await this.prisma.productionRun.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Production run not found" });
    }
    await this.prisma.productionRun.delete({ where: { id } });
    return { id };
  }

  /**
   * The columns to write for one run, chosen by its stage.
   *
   * Every stage-specific column not belonging to this stage is written as
   * NULL rather than omitted, so a row only ever carries its own station's
   * measures — including a migrated row that predates the stage split.
   * `stage` itself is written on update too, but `update` has already
   * refused any value other than the row's own.
   *
   * `quantite` is the legacy column all 942 migrated rows use. New runs set
   * it to the stage's headline figure so the existing list, its `quantite`
   * sort key and the order page's totals keep working across both eras
   * without a second "which number do I show?" branch everywhere. `unit`
   * follows: metres for printing, pieces for the three that count pieces.
   */
  private writable(input: CreateProductionRunInput | UpdateProductionRunInput) {
    const common = {
      dateProduction: new Date(`${input.dateProduction}T00:00:00.000Z`),
      note: input.note ?? null,
      stage: input.stage,
      // Cleared on every write; the matching branch below sets its own back.
      metersPrinted: null as number | null,
      piecesProduced: null as number | null,
      goodPieces: null as number | null,
      wastePieces: null as number | null,
      piecesToFix: null as number | null,
      piecesControlled: null as number | null,
      parcelsClosed: null as number | null,
      // Cleared like every other stage-specific column; the two machine
      // stations set it back below.
      machineId: null as string | null,
    };

    switch (input.stage) {
      case "PRINTING":
        return {
          ...common,
          machineId: input.machineId,
          metersPrinted: input.metersPrinted,
          quantite: input.metersPrinted,
          unit: "METER" as const,
        };
      case "PRODUCER":
        return {
          ...common,
          machineId: input.machineId,
          piecesProduced: input.piecesProduced,
          goodPieces: input.goodPieces ?? null,
          wastePieces: input.wastePieces ?? null,
          piecesToFix: input.piecesToFix ?? null,
          quantite: input.piecesProduced,
          unit: "PIECE" as const,
        };
      case "QUALITY_CONTROL":
        return {
          ...common,
          piecesControlled: input.piecesControlled,
          quantite: input.piecesControlled,
          unit: "PIECE" as const,
        };
      case "PACKAGING":
        return {
          ...common,
          parcelsClosed: input.parcelsClosed,
          quantite: input.parcelsClosed,
          unit: "PIECE" as const,
        };
    }
  }

  /**
   * The machine named by a PRINTING or PRODUCER run must exist, be active,
   * and be a type that station actually runs — a printing run cannot name a
   * bag machine, and vice versa.
   *
   * The contract requires `machineId` on those two stages but cannot check
   * the TYPE: that needs the row. Hence this, and hence the mapping living in
   * `machineTypesForStage` where both sides read the same rule.
   *
   * A no-op for QUALITY_CONTROL and PACKAGING, which carry no machine at all
   * (the union rejects the field outright for them).
   */
  private async assertMachineFitsStage(
    input: CreateProductionRunInput | UpdateProductionRunInput,
  ) {
    // Narrow on the stage, not on the mapping's return: only these two
    // branches of the union carry `machineId` at all, and TypeScript needs to
    // see the discriminant tested to know that.
    if (input.stage !== "PRINTING" && input.stage !== "PRODUCER") return;
    const allowed = machineTypesForStage(input.stage) ?? [];

    const machine = await this.prisma.machine.findUnique({
      where: { id: input.machineId },
      select: { id: true, active: true, type: true, name: true },
    });
    if (!machine) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "That machine no longer exists" });
    }
    if (!machine.active) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "That machine is archived and cannot be used",
      });
    }
    if (!allowed.includes(machine.type)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${machine.name} is not a machine the ${input.stage === "PRINTING" ? "printing" : "producer"} station runs`,
      });
    }
  }

  private async assertOrderInScope(actor: SessionUser, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { AND: [{ id: orderId }, orderScopeFor(actor.role)] },
      select: { id: true },
    });
    if (!order) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
    }
    return order;
  }

  private async assertRunInScope(actor: SessionUser, id: string) {
    const run = await this.prisma.productionRun.findFirst({
      where: { AND: [{ id }, this.scopeFor(actor)] },
      select: { id: true, stage: true },
    });
    if (!run) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Production run not found" });
    }
    return run;
  }
}

const RETURN_SELECT = { id: true, orderId: true, quantite: true } as const;

/** A run as the daily view returns it. */
type DailyRun = Prisma.ProductionRunGetPayload<{ select: typeof PRODUCTION_SELECT }>;

/**
 * Groups printing/producer runs under the machine that ran them.
 *
 * A machine of `null` collects runs recorded before `machineId` existed —
 * every migrated row, and anything logged between the stages landing and the
 * machine link landing. Those are real runs and must not be dropped from the
 * day, so they group under an explicit "no machine recorded" bucket rather
 * than being filtered out.
 */
function groupByMachine(runs: DailyRun[]) {
  const groups = new Map<string, { machine: DailyRun["machine"]; runs: DailyRun[] }>();
  for (const run of runs) {
    const key = run.machine?.id ?? "";
    const existing = groups.get(key);
    if (existing) existing.runs.push(run);
    else groups.set(key, { machine: run.machine, runs: [run] });
  }
  return [...groups.values()].sort(namedFirst((group) => group.machine?.name ?? null));
}

/**
 * Groups QC/packaging runs by the person who recorded them. `recordedBy` is
 * null on every migrated row, so those collect under one unattributed bucket
 * for the same reason as above.
 */
function groupByPerson(runs: DailyRun[]) {
  const groups = new Map<string, { person: DailyRun["recordedBy"]; runs: DailyRun[] }>();
  for (const run of runs) {
    const key = run.recordedBy?.id ?? "";
    const existing = groups.get(key);
    if (existing) existing.runs.push(run);
    else groups.set(key, { person: run.recordedBy, runs: [run] });
  }
  return [...groups.values()].sort(namedFirst((group) => group.person?.name ?? null));
}

/** Named rows first, alphabetically; the unattributed bucket (no name) last. */
function namedFirst<T>(nameOf: (item: T) => string | null) {
  return (a: T, b: T) => {
    const left = nameOf(a);
    const right = nameOf(b);
    return left === null ? 1 : right === null ? -1 : left.localeCompare(right);
  };
}

/** Every YYYY-MM from `from` to `to`, both included, ascending. */
function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  for (;;) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    months.push(key);
    if (key >= to) return months;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
}

/** The sums both monthly reads take; `quantite` is the headline (see `monthly`). */
const MONTHLY_SUM = { quantite: true, goodPieces: true, wastePieces: true, piecesToFix: true } as const;

/** One (stage, ..., day) group out of a monthly `groupBy`, with the station kept for `foldTotals`. */
interface DayTally {
  day: string;
  headline: number;
  goodPieces: number;
  wastePieces: number;
  piecesToFix: number;
  runCount: number;
}

/** A `groupBy` row over `MONTHLY_SUM` into the tally both folds read. */
function dayTally(g: {
  stage: string;
  dateProduction: Date;
  _sum: { quantite: number | null; goodPieces: number | null; wastePieces: number | null; piecesToFix: number | null };
  _count: { _all: number };
}): DayTally & { stage: string } {
  return {
    stage: g.stage,
    day: g.dateProduction.toISOString().slice(0, 10),
    headline: g._sum.quantite ?? 0,
    goodPieces: g._sum.goodPieces ?? 0,
    wastePieces: g._sum.wastePieces ?? 0,
    piecesToFix: g._sum.piecesToFix ?? 0,
    runCount: g._count._all,
  };
}

/**
 * The months' totals: each station's headline per month, the producer
 * breakdown, and the run count. One row per station through `pivot`, so the
 * tiles read off the same fold as the pivots in `monthly`; `monthlyTotals`
 * reads the same function, which is what keeps the two equal.
 */
function foldTotals(months: string[], tallies: readonly (DayTally & { stage: string })[]) {
  const stationCell = (stage: string, index: number) =>
    pivot(
      tallies.filter((t) => t.stage === stage),
      months,
      () => null,
    )[0]?.cells[index];

  return months.map((month, index) => {
    const producer = stationCell("PRODUCER", index);
    return {
      month,
      metersPrinted: stationCell("PRINTING", index)?.headline ?? 0,
      piecesProduced: producer?.headline ?? 0,
      piecesControlled: stationCell("QUALITY_CONTROL", index)?.headline ?? 0,
      parcelsClosed: stationCell("PACKAGING", index)?.headline ?? 0,
      // The producer breakdown, as in `daily`.
      goodPieces: producer?.goodPieces ?? 0,
      wastePieces: producer?.wastePieces ?? 0,
      piecesToFix: producer?.piecesToFix ?? 0,
      runCount: tallies
        .filter((t) => t.day.startsWith(month))
        .reduce((sum, t) => sum + t.runCount, 0),
    };
  });
}

const FIGURES = ["headline", "goodPieces", "wastePieces", "piecesToFix", "runCount"] as const;

/**
 * Folds day tallies into one row per `idOf`, with one cell per month.
 *
 * `daysActive` is a distinct count, not a count of tallies: the `groupBy` key
 * carries both the machine and the person, so a machine two people recorded
 * on the same day arrives as two tallies for that one day (and a person who
 * ran two machines likewise). Months do not share days, so a row's total is
 * the plain sum of its cells.
 */
function pivot<T extends DayTally>(
  tallies: T[],
  months: string[],
  idOf: (tally: T) => string | null,
) {
  const blank = () => ({
    headline: 0,
    goodPieces: 0,
    wastePieces: 0,
    piecesToFix: 0,
    runCount: 0,
    days: new Set<string>(),
  });
  const rows = new Map<string, { id: string | null; byMonth: Map<string, ReturnType<typeof blank>> }>();

  for (const tally of tallies) {
    const id = idOf(tally);
    let row = rows.get(id ?? "");
    if (!row) rows.set(id ?? "", (row = { id, byMonth: new Map() }));
    const month = tally.day.slice(0, 7);
    let cell = row.byMonth.get(month);
    if (!cell) row.byMonth.set(month, (cell = blank()));
    for (const figure of FIGURES) cell[figure] += tally[figure];
    cell.days.add(tally.day);
  }

  return [...rows.values()].map(({ id, byMonth }) => {
    const cells = months.map((month) => {
      const { days, ...figures } = byMonth.get(month) ?? blank();
      return { month, ...figures, daysActive: days.size };
    });
    const total = { headline: 0, goodPieces: 0, wastePieces: 0, piecesToFix: 0, runCount: 0, daysActive: 0 };
    for (const cell of cells) {
      for (const figure of FIGURES) total[figure] += cell[figure];
      total.daysActive += cell.daysActive;
    }
    return { id, cells, total };
  });
}
