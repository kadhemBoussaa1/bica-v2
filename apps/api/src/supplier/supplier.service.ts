import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
  CreateSupplierInput,
  SimilarPartnerNameInput,
  UpdateSupplierInput,
} from "@repo/api-contract";
import { runListQuery } from "../list/list-query";
import { findLookAlikes, findSimilar } from "../list/look-alikes";
import { PrismaService } from "../prisma.service";
import { SupplierFamilyService } from "../supplier-family/supplier-family.service";
import {
  SUPPLIER_FIXED_FACETS,
  SUPPLIER_SELECT,
  supplierListDeclaration,
  type ListSuppliersInput,
} from "./supplier.list";

const RETURN_SELECT = { id: true, name: true, active: true } as const;

@Injectable()
export class SupplierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly families: SupplierFamilyService,
  ) {}

  /**
   * Shared reference data, so no session-derived scope — see ClientService.list.
   *
   * The family facets are data now, so the declaration is built per request from
   * the families that actually exist. `filter` therefore cannot be a Zod enum;
   * it is validated here instead, which keeps the allowlist real — an unknown
   * key is rejected rather than being ignored or reaching Prisma.
   */
  async list(query: ListSuppliersInput) {
    // ALL families, including archived ones. Archiving stops a family being
    // offered for new suppliers, but the ones already in it keep their familyId
    // and must stay reachable: they are neither `unassigned` (they have a
    // family) nor `archived` (that facet is about the supplier). Dropping the
    // chip would leave those rows in no facet at all, and the summed "all" count
    // would then disagree with the pager.
    const families = await this.prisma.supplierFamily.findMany({
      select: { code: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    });
    const codes = families.map((family) => family.code);

    const allowed = new Set<string>([
      ...codes,
      ...SUPPLIER_FIXED_FACETS,
      "all",
    ]);
    if (!allowed.has(query.filter)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Unknown filter "${query.filter}"`,
      });
    }

    // Outside the list's transaction, as in ClientService.list: at worst a
    // row created in between misses its "possible duplicate" tag once.
    const lookAlikes = await this.lookAlikes();
    const result = await runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) =>
          this.prisma.supplier.findMany({ ...args, select: SUPPLIER_SELECT }),
        count: (args) => this.prisma.supplier.count(args),
      },
      query,
      declaration: supplierListDeclaration(codes, [...lookAlikes.keys()]),
      scope: {},
    });
    return {
      ...result,
      rows: result.rows.map((row) => ({
        ...row,
        /** The name this row looks like a duplicate of, or null. */
        duplicateOf: lookAlikes.get(row.id) ?? null,
      })),
    };
  }

  /**
   * The figures above the list — whole-table counts, independent of the
   * current page, search or chip, as in ClientService.stats. "Reachable"
   * counts the second phone too: it is a real number to call.
   */
  async stats() {
    const [total, reachable, archived] = await this.prisma.$transaction([
      this.prisma.supplier.count({ where: { active: true } }),
      this.prisma.supplier.count({
        where: {
          active: true,
          OR: [
            { email: { not: null } },
            { phone: { not: null } },
            { phone2: { not: null } },
          ],
        },
      }),
      this.prisma.supplier.count({ where: { active: false } }),
    ]);
    const lookAlikes = await this.lookAlikes();
    return {
      total,
      reachable,
      missing: total - reachable,
      duplicates: lookAlikes.size,
      archived,
    };
  }

  /** Live duplicate check for the form's name field — see `findSimilar`. */
  async similar(input: SimilarPartnerNameInput) {
    const name = input.name.trim();
    if (!name) return { exact: null, near: [] };
    const rows = await this.prisma.supplier.findMany({
      where: input.excludeId ? { id: { not: input.excludeId } } : {},
      select: { id: true, name: true, active: true },
      orderBy: { name: "asc" },
    });
    return findSimilar(rows, name);
  }

  /** Active suppliers whose name resembles another's — see `findLookAlikes`. */
  private async lookAlikes(): Promise<Map<string, string>> {
    const rows = await this.prisma.supplier.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return findLookAlikes(rows);
  }

  async create(input: CreateSupplierInput) {
    await this.assertNameFree(input.name);
    const familyId = await this.families.resolveAssignable(input.familyId);
    return this.prisma.supplier.create({
      data: this.writable(input, familyId),
      select: RETURN_SELECT,
    });
  }

  async update(input: UpdateSupplierInput) {
    await this.assertExists(input.id);
    await this.assertNameFree(input.name, input.id);
    const familyId = await this.families.resolveAssignable(input.familyId);
    return this.prisma.supplier.update({
      where: { id: input.id },
      data: this.writable(input, familyId),
      select: RETURN_SELECT,
    });
  }

  /**
   * Archive or restore — what the UI calls "delete". 126 of the 136 migrated
   * suppliers are referenced by legacy purchase invoices, so a hard delete would
   * break the moment `facture_achat` is migrated.
   */
  async setActive(id: string, active: boolean) {
    await this.assertExists(id);
    return this.prisma.supplier.update({
      where: { id },
      data: { active },
      select: RETURN_SELECT,
    });
  }

  async byId(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      select: SUPPLIER_SELECT,
    });
    if (!supplier) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Supplier not found" });
    }
    return supplier;
  }

  /**
   * Shared by create and update.
   *
   * Writing `vatRate` also clears `vatRateNote`: the note only exists to hold a
   * legacy string the importer could not parse ("19% /7%", a VAT number), so
   * once someone supplies a real rate the original has served its purpose.
   * Saving with the rate left blank keeps the note, so opening and cancelling
   * out of a form cannot quietly discard it.
   */
  private writable(input: CreateSupplierInput, familyId: string | null) {
    return {
      name: input.name,
      taxId: input.taxId ?? null,
      address: input.address ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      phone2: input.phone2 ?? null,
      fax: input.fax ?? null,
      website: input.website ?? null,
      familyId,
      vatRate: input.vatRate ?? null,
      ...(input.vatRate === undefined ? {} : { vatRateNote: null }),
    };
  }

  /** Live suppliers, for the sidebar's count. */
  count() {
    return this.prisma.supplier.count({ where: { active: true } });
  }

  private async assertExists(id: string) {
    const found = await this.prisma.supplier.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Supplier not found" });
    }
  }

  private async assertNameFree(name: string, excludeId?: string) {
    const existing = await this.prisma.supplier.findUnique({
      where: { name },
      select: { id: true },
    });
    if (existing && existing.id !== excludeId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `A supplier named "${name}" already exists`,
      });
    }
  }
}
