import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import {
  parseRollScan,
  type CountScanInput,
  type ListStockCountsInput,
  type OpenStockCountInput,
  type VarianceInput,
} from "@repo/api-contract";
import type { Prisma } from "../generated/prisma/client.js";
import { runListQuery } from "../list/list-query";
import { PrismaService } from "../prisma.service";
import type { SessionUser } from "../trpc/trpc";
import {
  COUNTABLE_ROLL_WHERE,
  SCANNABLE_ROLL_WHERE,
  STOCK_COUNT_SELECT,
  VARIANCE_LINE_SELECT,
  VARIANCE_ROLL_SELECT,
  stockCountListDeclaration,
  varianceLineListDeclaration,
  varianceRollListDeclaration,
} from "./inventory.list";

/** What one scan did. `notCountable` is a finding, not a failure. */
const OUTCOME = {
  counted: "counted",
  alreadyCounted: "alreadyCounted",
  notCountable: "notCountable",
} as const;

/** The reel fields a scan echoes back, and the audit heuristic reads. */
const SCAN_ROLL_SELECT = {
  id: true,
  numero: true,
  paperGrade: true,
  grammage: true,
  laize: true,
  consomme: true,
  archived: true,
} satisfies Prisma.PaperRollSelect;

/**
 * Stocktakes — docs/inventory-plan.md §4.
 *
 * A count records what was seen and nothing else. `PaperRoll` is NEVER written
 * here: not a flag, not a counter, and above all not `receivedAt`, which is
 * receiving's monotonic column — stamping it for an unreceived reel found on
 * the floor would forge a receiving event. Acting on a variance is a manual
 * admin decision through the existing stock screens.
 *
 * Idempotency is the unique constraint's job. A re-scan collides on
 * `(countId, paperRollId)`, updates nothing, and reports `alreadyCounted`:
 * the warehouse scans fast, the imager double-triggers on a long press, and
 * refusing those would train people to ignore the buzzer.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Opens the one stocktake.
   *
   * Both denominators are frozen here. `expectedCount` is the countable
   * population, so a reel consumed mid-count cannot retroactively change what
   * the count was measured against. `labelledCount` is the scannable subset —
   * progress is shown against it, because a reel with no printed sticker
   * cannot be scanned however present it is, and a bar that can never reach
   * 100% reads as a broken feature rather than as missing labels.
   *
   * A second open hits the partial unique index rather than a read-then-write
   * check, so two tabs racing cannot both win.
   */
  async open(actor: SessionUser, input: OpenStockCountInput) {
    // One transaction: both figures are frozen from the same snapshot.
    const [expectedCount, labelledCount] = await this.prisma.$transaction([
      this.prisma.paperRoll.count({ where: COUNTABLE_ROLL_WHERE }),
      this.prisma.paperRoll.count({ where: SCANNABLE_ROLL_WHERE }),
    ]);

    try {
      return await this.prisma.stockCount.create({
        data: {
          expectedCount,
          labelledCount,
          openedById: actor.id,
          notes: input.notes ?? null,
        },
        select: STOCK_COUNT_SELECT,
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "A stocktake is already open — close it before starting another",
        });
      }
      throw error;
    }
  }

  /**
   * Records one scanned reel against the open count.
   *
   * Checks in order, each with the message the floor needs: parse, session,
   * reel, then the write. There is no cross-session refusal — unlike
   * receiving there is no "wrong pallet" concept, so any reel is valid in the
   * one open session.
   */
  async scan(actor: SessionUser, input: CountScanInput) {
    const parsed = parseRollScan(input.code);
    if (!parsed) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Not a reel label" });
    }

    return this.prisma.$transaction(async (tx) => {
      const count = await tx.stockCount.findUnique({
        where: { id: input.countId },
        select: { id: true, status: true, expectedCount: true, labelledCount: true },
      });
      if (!count) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Stocktake not found" });
      }
      if (count.status !== "OPEN") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This stocktake is closed",
        });
      }

      const where =
        parsed.kind === "id" ? { id: parsed.id } : { legacyId: BigInt(parsed.legacyId) };
      const roll = await tx.paperRoll.findUnique({ where, select: SCAN_ROLL_SELECT });
      if (!roll) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No reel matches this label",
        });
      }

      // A snapshot, not a derivation: whether the reel was consumed or archived
      // AT SCAN TIME. Recomputing this later would silently change a closed
      // count's findings.
      const unexpected = roll.consomme || roll.archived;

      // The row may already exist from an earlier scan in this same session.
      // Read first so the outcome is honest, then write only if it is new —
      // the unique constraint is what makes the write safe under a race, and
      // an empty `update` keeps the FIRST sighting's timestamp, which is the
      // one that actually happened.
      const existing = await tx.stockCountLine.findUnique({
        where: { countId_paperRollId: { countId: count.id, paperRollId: roll.id } },
        select: { id: true },
      });

      await tx.stockCountLine.upsert({
        where: { countId_paperRollId: { countId: count.id, paperRollId: roll.id } },
        create: { countId: count.id, paperRollId: roll.id, unexpected },
        update: {},
        select: { id: true },
      });

      const outcome = existing
        ? OUTCOME.alreadyCounted
        : unexpected
          ? OUTCOME.notCountable
          : OUTCOME.counted;

      const counted = await tx.stockCountLine.count({
        where: { countId: count.id, unexpected: false },
      });

      return {
        outcome,
        // `id` is the reel, so the audit heuristic reads the entity off the
        // result and the session off the input's top-level `countId`.
        id: roll.id,
        numero: roll.numero,
        paperGrade: roll.paperGrade,
        grammage: roll.grammage,
        laize: roll.laize,
        unexpected,
        countId: count.id,
        progress: {
          counted,
          expected: count.expectedCount,
          labelled: count.labelledCount,
        },
      };
    });
  }

  /** Closes the count. Guarded so a double-tap is idempotent, not an error. */
  async close(input: { id: string }) {
    const changed = await this.prisma.stockCount.updateMany({
      where: { id: input.id, status: "OPEN" },
      data: { status: "CLOSED", closedAt: new Date() },
    });

    const count = await this.prisma.stockCount.findUnique({
      where: { id: input.id },
      select: STOCK_COUNT_SELECT,
    });
    if (!count) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Stocktake not found" });
    }
    return { ...count, closedNow: changed.count === 1 };
  }

  async list(query: ListStockCountsInput) {
    return runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) =>
          this.prisma.stockCount.findMany({ ...args, select: STOCK_COUNT_SELECT }),
        count: (args) => this.prisma.stockCount.count(args),
      },
      query,
      declaration: stockCountListDeclaration,
      scope: {},
    });
  }

  async byId(id: string) {
    const count = await this.prisma.stockCount.findUnique({
      where: { id },
      select: STOCK_COUNT_SELECT,
    });
    if (!count) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Stocktake not found" });
    }
    return count;
  }

  /**
   * The three variance figures, on one snapshot.
   *
   * `counted + missing` need not equal `expectedCount` exactly: the expected
   * set is a frozen NUMBER, not a list of ids, so a reel legitimately consumed
   * mid-count leaves a gap. That is deliberate — freezing ids would make
   * "missing" mean "missing as of Tuesday" and report such a reel missing
   * forever. The report shows all three figures so the drift is visible.
   */
  async summary(id: string) {
    const count = await this.byId(id);

    const [counted, unexpected, missing] = await this.prisma.$transaction([
      this.prisma.stockCountLine.count({ where: { countId: id, unexpected: false } }),
      this.prisma.stockCountLine.count({ where: { countId: id, unexpected: true } }),
      this.prisma.paperRoll.count({
        where: { ...COUNTABLE_ROLL_WHERE, countLines: { none: { countId: id } } },
      }),
    ]);

    return { count, counted, missing, unexpected };
  }

  /**
   * One page of one side of the report.
   *
   * "missing" pages over `PaperRoll` and the other two over `StockCountLine`,
   * so they cannot share a delegate — the side is a discriminator on the input
   * rather than a facet, and neither list declares facets at all.
   */
  async variance(input: VarianceInput) {
    await this.byId(input.id);

    if (input.side === "missing") {
      const rows = await runListQuery({
        prisma: this.prisma,
        delegate: {
          findMany: (args) =>
            this.prisma.paperRoll.findMany({ ...args, select: VARIANCE_ROLL_SELECT }),
          count: (args) => this.prisma.paperRoll.count(args),
        },
        query: { ...input, sortBy: "numero" as const },
        declaration: varianceRollListDeclaration,
        // Scope is session-derived and AND-ed first: countable reels with no
        // line in THIS count. Never client-supplied.
        scope: {
          ...COUNTABLE_ROLL_WHERE,
          countLines: { none: { countId: input.id } },
        },
      });
      return { side: input.side, ...rows };
    }

    const rows = await runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) =>
          this.prisma.stockCountLine.findMany({ ...args, select: VARIANCE_LINE_SELECT }),
        count: (args) => this.prisma.stockCountLine.count(args),
      },
      query: { ...input, sortBy: "scannedAt" as const },
      declaration: varianceLineListDeclaration,
      scope: { countId: input.id, unexpected: input.side === "unexpected" },
    });
    return { side: input.side, ...rows };
  }

  /** The nav badge: 1 while a stocktake is open, 0 otherwise. */
  async openCount(): Promise<number> {
    return this.prisma.stockCount.count({ where: { status: "OPEN" } });
  }

  /** Prisma's unique-constraint code, without importing the error class. */
  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002"
    );
  }
}
