import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import {
  canAccess,
  type CreateMachineInput,
  type ListResult,
  type UpdateMachineInput,
} from "@repo/api-contract";
import { Prisma } from "../generated/prisma/client.js";
import { runListQuery } from "../list/list-query";
import { PrismaService } from "../prisma.service";
import type { SessionUser } from "../trpc/trpc";
import {
  MACHINE_FLOOR_SORT_KEYS,
  MACHINE_SELECT,
  MACHINE_SELECT_FLOOR,
  machineFloorListDeclaration,
  machineListDeclaration,
  type ListMachinesInput,
  type MachineFacet,
  type MachineRow,
  type MachineRowFloor,
} from "./machine.list";

const RETURN_SELECT = { id: true, code: true, name: true, active: true } as const;

@Injectable()
export class MachineService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Shop-floor reference data, so no session-derived ROW scope — see
   * ClientService. The gate is which COLUMNS come back: ADMIN and above get
   * the full record, everyone else `MACHINE_SELECT_FLOOR`, chosen before the
   * query so the price and invoice are never fetched for them. Two explicit
   * branches so the return type is a union the web must narrow.
   */
  async list(
    actor: SessionUser,
    query: ListMachinesInput,
  ): Promise<ListResult<MachineRow, MachineFacet> | ListResult<MachineRowFloor, MachineFacet>> {
    if (canAccess(actor.role, "ADMIN")) {
      return runListQuery({
        prisma: this.prisma,
        delegate: {
          findMany: (args) =>
            this.prisma.machine.findMany({ ...args, select: MACHINE_SELECT }),
          count: (args) => this.prisma.machine.count(args),
        },
        query,
        declaration: machineListDeclaration,
        scope: {},
      });
    }
    // Sortable must stay within what is selected: refuse the rest rather
    // than silently re-sorting, so a client bug surfaces.
    if (!(MACHINE_FLOOR_SORT_KEYS as readonly string[]).includes(query.sortBy)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Machines cannot be sorted by ${query.sortBy} here`,
      });
    }
    return runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) =>
          this.prisma.machine.findMany({ ...args, select: MACHINE_SELECT_FLOOR }),
        count: (args) => this.prisma.machine.count(args),
      },
      query,
      declaration: machineFloorListDeclaration,
      scope: {},
    });
  }

  async create(input: CreateMachineInput) {
    await this.assertCodeFree(input.code);
    await this.assertSupplierExists(input.supplierId);
    try {
      return await this.prisma.machine.create({
        data: this.writable(input),
        select: RETURN_SELECT,
      });
    } catch (cause) {
      throw codeConflict(cause, input.code);
    }
  }

  async update(input: UpdateMachineInput) {
    await this.assertExists(input.id);
    await this.assertCodeFree(input.code, input.id);
    await this.assertSupplierExists(input.supplierId);
    try {
      return await this.prisma.machine.update({
        where: { id: input.id },
        data: this.writable(input),
        select: RETURN_SELECT,
      });
    } catch (cause) {
      throw codeConflict(cause, input.code);
    }
  }

  /**
   * Archive or restore. No hard delete: a machine is named by historical orders
   * (`commande.machine_production_id`), so removing one would break them.
   */
  async setActive(id: string, active: boolean) {
    await this.assertExists(id);
    return this.prisma.machine.update({
      where: { id },
      data: { active },
      select: RETURN_SELECT,
    });
  }

  async byId(id: string) {
    const machine = await this.prisma.machine.findUnique({
      where: { id },
      select: MACHINE_SELECT,
    });
    if (!machine) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Machine not found" });
    }
    return machine;
  }

  private writable(input: CreateMachineInput) {
    return {
      code: input.code,
      name: input.name,
      type: input.type,
      brand: input.brand ?? null,
      price: input.price ?? null,
      // A bare YYYY-MM-DD parses as UTC midnight, matching @db.Date.
      purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : null,
      imageUrl: input.imageUrl ?? null,
      invoiceUrl: input.invoiceUrl ?? null,
      supplierId: input.supplierId ?? null,
      laize: input.laize ?? null,
      laizeMin: input.laizeMin ?? null,
      laizeMax: input.laizeMax ?? null,
      grammage: input.grammage ?? null,
      grammageMin: input.grammageMin ?? null,
      grammageMax: input.grammageMax ?? null,
      grammageMinWithoutHandle: input.grammageMinWithoutHandle ?? null,
      grammageMaxWithoutHandle: input.grammageMaxWithoutHandle ?? null,
      grammageMinWithHandle: input.grammageMinWithHandle ?? null,
      grammageMaxWithHandle: input.grammageMaxWithHandle ?? null,
      grammageMinKraft: input.grammageMinKraft ?? null,
      grammageMaxKraft: input.grammageMaxKraft ?? null,
      grammageMinLaminatedKraft: input.grammageMinLaminatedKraft ?? null,
      grammageMaxLaminatedKraft: input.grammageMaxLaminatedKraft ?? null,
      lengthMin: input.lengthMin ?? null,
      lengthMax: input.lengthMax ?? null,
      widthMin: input.widthMin ?? null,
      widthMax: input.widthMax ?? null,
    };
  }

  private async assertExists(id: string) {
    const found = await this.prisma.machine.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Machine not found" });
    }
  }

  /**
   * `code` identifies a machine; `name` is only a label and may repeat.
   * A read, so two saves racing to one code both pass it: the write's
   * unique violation is mapped to the same CONFLICT by `codeConflict`.
   */
  private async assertCodeFree(code: string, excludeId?: string) {
    const existing = await this.prisma.machine.findUnique({
      where: { code },
      select: { id: true },
    });
    if (existing && existing.id !== excludeId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `A machine with code ${code} already exists`,
      });
    }
  }

  private async assertSupplierExists(supplierId: string | undefined) {
    if (supplierId === undefined) return;
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
    });
    if (!supplier) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "That supplier no longer exists",
      });
    }
  }
}

/**
 * The error to throw for a failed machine write: CONFLICT naming the code
 * when it lost a race on `code`'s unique index, otherwise the cause as is.
 */
function codeConflict(cause: unknown, code: string): unknown {
  if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
    return new TRPCError({
      code: "CONFLICT",
      message: `A machine with code ${code} already exists`,
    });
  }
  return cause;
}
