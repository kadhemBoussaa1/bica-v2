import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
  CreateClientInput,
  SimilarPartnerNameInput,
  UpdateClientInput,
} from "@repo/api-contract";
import { runListQuery } from "../list/list-query";
import { findLookAlikes, findSimilar } from "../list/look-alikes";
import { PrismaService } from "../prisma.service";
import {
  CLIENT_SELECT,
  clientListDeclaration,
  type ListClientsInput,
} from "./client.list";

/** The row shape every mutation returns, so the client can patch its cache. */
const RETURN_SELECT = { id: true, name: true, active: true } as const;

@Injectable()
export class ClientService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Customers are shared reference data: unlike users there is no per-row
   * visibility rule, so nothing here is derived from the session. The scope
   * exists only to hide archived rows by default.
   *
   * `archived` is a facet, and a facet is AND-ed onto this scope — so the scope
   * cannot itself say `active: true` or selecting that chip would ask for rows
   * that are both active and not. Instead the scope is empty and the two
   * *contact* facets carry `active: true`, which keeps the three partitioning
   * the table. The one gap that leaves is the unfiltered "All" view, which shows
   * archived rows too; `archivedLast` below is what stops that being confusing.
   */
  async list(query: ListClientsInput) {
    // Computed outside the list's transaction: a client created between the
    // two queries would at worst be missing a "possible duplicate" tag for
    // one render, which is not worth an interactive transaction.
    const lookAlikes = await this.lookAlikes();
    const result = await runListQuery({
      prisma: this.prisma,
      delegate: {
        findMany: (args) =>
          this.prisma.client.findMany({ ...args, select: CLIENT_SELECT }),
        count: (args) => this.prisma.client.count(args),
      },
      query,
      declaration: clientListDeclaration([...lookAlikes.keys()]),
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
   * The figures above the list. Whole-table counts, independent of the
   * current page, search or chip — the strip answers "how is the client book
   * doing", not "what does this filter match", which is the chips' job.
   */
  async stats() {
    const [total, reachable, archived] = await this.prisma.$transaction([
      this.prisma.client.count({ where: { active: true } }),
      this.prisma.client.count({
        where: {
          active: true,
          OR: [{ email: { not: null } }, { phone: { not: null } }],
        },
      }),
      this.prisma.client.count({ where: { active: false } }),
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
    const rows = await this.prisma.client.findMany({
      where: input.excludeId ? { id: { not: input.excludeId } } : {},
      select: { id: true, name: true, active: true },
      orderBy: { name: "asc" },
    });
    return findSimilar(rows, name);
  }

  /** Active clients whose name resembles another's — see `findLookAlikes`. */
  private async lookAlikes(): Promise<Map<string, string>> {
    const rows = await this.prisma.client.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return findLookAlikes(rows);
  }

  async create(input: CreateClientInput) {
    await this.assertNameFree(input.name);
    return this.prisma.client.create({
      data: {
        name: input.name,
        taxId: input.taxId ?? null,
        address: input.address ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        // A bare YYYY-MM-DD parses as UTC midnight, which is what @db.Date
        // stores. Appending a time would shift the date in negative offsets.
        registeredAt: input.registeredAt ? new Date(input.registeredAt) : null,
      },
      select: RETURN_SELECT,
    });
  }

  async update(input: UpdateClientInput) {
    await this.assertExists(input.id);
    await this.assertNameFree(input.name, input.id);
    return this.prisma.client.update({
      where: { id: input.id },
      data: {
        name: input.name,
        taxId: input.taxId ?? null,
        address: input.address ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        registeredAt: input.registeredAt ? new Date(input.registeredAt) : null,
      },
      select: RETURN_SELECT,
    });
  }

  /**
   * Archive or restore. This is what the UI's "delete" does: the row keeps its
   * id and history, so anything that references it later (`commande.client_id`
   * once that module lands) still resolves. There is deliberately no hard
   * delete — see docs/legacy-migration.md.
   */
  async setActive(id: string, active: boolean) {
    await this.assertExists(id);
    return this.prisma.client.update({
      where: { id },
      data: { active },
      select: RETURN_SELECT,
    });
  }

  async byId(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      select: CLIENT_SELECT,
    });
    if (!client) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
    }
    return client;
  }

  /** Live clients, for the sidebar's count. */
  count() {
    return this.prisma.client.count({ where: { active: true } });
  }

  private async assertExists(id: string) {
    const found = await this.prisma.client.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
    }
  }

  /**
   * `name` is unique in the schema, so this only turns a Prisma P2002 into a
   * message naming the field. `excludeId` lets an update keep its own name.
   */
  private async assertNameFree(name: string, excludeId?: string) {
    const existing = await this.prisma.client.findUnique({
      where: { name },
      select: { id: true },
    });
    if (existing && existing.id !== excludeId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `A client named "${name}" already exists`,
      });
    }
  }
}
