import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
  CreateSupplierFamilyInput,
  UpdateSupplierFamilyInput,
} from "@repo/api-contract";
import { PrismaService } from "../prisma.service";

const FAMILY_SELECT = {
  id: true,
  code: true,
  label: true,
  sortOrder: true,
  active: true,
} as const;

@Injectable()
export class SupplierFamilyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every family, with how many suppliers each holds.
   *
   * Not paginated: this is a short lookup list that fills a picker and the
   * supplier list's facet chips, and both need all of it at once. If it ever
   * grows past a screenful it should become a real `runListQuery` list.
   *
   * `includeInactive` is for the management screen. The supplier form and the
   * facet chips ask for active only, so an archived family stops being offered
   * without disturbing the suppliers already assigned to it.
   */
  async list(includeInactive = false) {
    const families = await this.prisma.supplierFamily.findMany({
      where: includeInactive ? {} : { active: true },
      // Matches @@index([active, sortOrder, label]); `label` breaks ties so the
      // order is total and cannot shuffle between requests.
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: {
        ...FAMILY_SELECT,
        _count: { select: { suppliers: true } },
      },
    });

    return families.map(({ _count, ...family }) => ({
      ...family,
      supplierCount: _count.suppliers,
    }));
  }

  async create(input: CreateSupplierFamilyInput) {
    await this.assertCodeFree(input.code);
    await this.assertLabelFree(input.label);
    return this.prisma.supplierFamily.create({
      data: {
        code: input.code,
        label: input.label,
        // Default puts a new family after the seeded ones (which use 10..80)
        // rather than silently first.
        sortOrder: input.sortOrder ?? 100,
      },
      select: FAMILY_SELECT,
    });
  }

  /** Label and order only — `code` is immutable, see updateSupplierFamilyInput. */
  async update(input: UpdateSupplierFamilyInput) {
    const existing = await this.byId(input.id);
    await this.assertLabelFree(input.label, input.id);
    return this.prisma.supplierFamily.update({
      where: { id: input.id },
      data: {
        label: input.label,
        sortOrder: input.sortOrder ?? existing.sortOrder,
      },
      select: FAMILY_SELECT,
    });
  }

  /**
   * Archive or restore. Archiving keeps the suppliers assigned to it — they
   * still display their family; it simply stops being offered for new ones.
   */
  async setActive(id: string, active: boolean) {
    await this.byId(id);
    return this.prisma.supplierFamily.update({
      where: { id },
      data: { active },
      select: FAMILY_SELECT,
    });
  }

  /**
   * Hard delete, permitted only while nothing references the family.
   *
   * The schema's `onDelete: SetNull` would otherwise quietly uncategorise every
   * supplier in it, which is data loss disguised as a successful delete. Once a
   * family is in use, archiving is the only way to retire it.
   *
   * The "no suppliers" condition is part of the delete's own `where`, so a
   * supplier assigned between the friendly check and the delete cannot be
   * uncategorised by it: the delete then matches nothing and is refused.
   */
  async remove(id: string) {
    const family = await this.prisma.supplierFamily.findUnique({
      where: { id },
      select: { id: true, label: true, _count: { select: { suppliers: true } } },
    });
    if (!family) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Family not found" });
    }
    if (family._count.suppliers > 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          `${family.label} is used by ${family._count.suppliers} supplier(s). ` +
          "Archive it instead, or move those suppliers to another family first.",
      });
    }
    const { count } = await this.prisma.supplierFamily.deleteMany({
      where: { id, suppliers: { none: {} } },
    });
    if (count !== 1) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          `${family.label} was just assigned to a supplier or removed. ` +
          "Reload; archive it instead if it is in use.",
      });
    }
    return { id };
  }

  async byId(id: string) {
    const family = await this.prisma.supplierFamily.findUnique({
      where: { id },
      select: FAMILY_SELECT,
    });
    if (!family) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Family not found" });
    }
    return family;
  }

  /**
   * Validates a familyId supplied when saving a supplier. Returns null for
   * "uncategorised" so the caller can assign the result directly.
   *
   * An archived family is rejected: it is no longer offered in the picker, so
   * receiving one means a stale form or a hand-made request.
   */
  async resolveAssignable(familyId: string | undefined): Promise<string | null> {
    if (familyId === undefined) return null;
    const family = await this.prisma.supplierFamily.findUnique({
      where: { id: familyId },
      select: { id: true, active: true, label: true },
    });
    if (!family) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "That supplier family no longer exists",
      });
    }
    if (!family.active) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${family.label} is archived and cannot be assigned`,
      });
    }
    return family.id;
  }

  private async assertCodeFree(code: string) {
    const existing = await this.prisma.supplierFamily.findUnique({
      where: { code },
      select: { id: true },
    });
    if (existing) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `The code ${code} is already used by another family`,
      });
    }
  }

  private async assertLabelFree(label: string, excludeId?: string) {
    const existing = await this.prisma.supplierFamily.findUnique({
      where: { label },
      select: { id: true },
    });
    if (existing && existing.id !== excludeId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `A family labelled "${label}" already exists`,
      });
    }
  }
}
