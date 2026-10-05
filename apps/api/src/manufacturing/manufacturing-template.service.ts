import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
  CreateManufacturingTemplateInput,
  UpdateManufacturingTemplateInput,
} from "@repo/api-contract";
import { PrismaService } from "../prisma.service";
import { MANUFACTURING_TEMPLATE_SELECT } from "./manufacturing.list";

const RETURN_SELECT = { id: true, name: true, active: true } as const;

/**
 * Pipeline templates — the reusable lists of actions an OF is opened from.
 *
 * An OF copies its template's actions when it is created and keeps no link
 * back, so nothing here can change an existing OF: a template is edited,
 * archived or rewritten freely.
 */
@Injectable()
export class ManufacturingTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every template with its actions, active ones first. A handful of rows: not paginated. */
  async list() {
    return this.prisma.manufacturingTemplate.findMany({
      select: MANUFACTURING_TEMPLATE_SELECT,
      orderBy: [{ active: "desc" }, { name: "asc" }, { id: "asc" }],
    });
  }

  async create(input: CreateManufacturingTemplateInput) {
    return this.prisma.manufacturingTemplate.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        actions: { create: input.actions.map((action, position) => ({ ...action, position })) },
      },
      select: RETURN_SELECT,
    });
  }

  /**
   * The actions are replaced as a whole set, in the order sent: a template
   * row has no identity an OF depends on, so there is nothing to diff.
   */
  async update(input: UpdateManufacturingTemplateInput) {
    await this.assertExists(input.id);
    return this.prisma.$transaction(async (tx) => {
      await tx.manufacturingTemplateAction.deleteMany({ where: { templateId: input.id } });
      return tx.manufacturingTemplate.update({
        where: { id: input.id },
        data: {
          name: input.name,
          description: input.description ?? null,
          actions: { create: input.actions.map((action, position) => ({ ...action, position })) },
        },
        select: RETURN_SELECT,
      });
    });
  }

  /** Archive / restore: an archived template leaves the "Create OF" picker. */
  async setActive(id: string, active: boolean) {
    await this.assertExists(id);
    return this.prisma.manufacturingTemplate.update({
      where: { id },
      data: { active },
      select: RETURN_SELECT,
    });
  }

  private async assertExists(id: string) {
    const found = await this.prisma.manufacturingTemplate.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
    }
  }
}
