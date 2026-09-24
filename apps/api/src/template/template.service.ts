import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import {
  LAYOUT_SCHEMA_VERSION,
  salesInvoiceLayoutSchema,
  type CreateDocumentTemplateInput,
  type PublishDocumentTemplateInput,
  type RenameDocumentTemplateInput,
  type SaveDocumentTemplateVersionInput,
} from "@repo/api-contract";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma.service";
import type { SessionUser } from "../trpc/trpc";
import { ensureDefaultSalesInvoiceVersion } from "./template.defaults";

const VERSION_SUMMARY = {
  id: true,
  version: true,
  publishedAt: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
  _count: { select: { salesInvoices: true } },
} satisfies Prisma.DocumentTemplateVersionSelect;

const TEMPLATE_SELECT = {
  id: true,
  kind: true,
  name: true,
  isDefault: true,
  updatedAt: true,
  versions: { select: VERSION_SUMMARY, orderBy: { version: "desc" } },
} satisfies Prisma.DocumentTemplateSelect;

/**
 * Document templates: named layouts and their versions —
 * docs/sales-invoice-pdf-plan.md, phase 2.
 *
 * The one rule everything here protects: **a published version never
 * changes.** An issued invoice pins the version it printed with, and its
 * other languages are minted from that pin later, so an edit to a published
 * row would restyle a legal document after the fact. Editing therefore works
 * on a draft — one per template, overwritten by each save — and `publish`
 * freezes it. What an invoice pins at issue is the default template's newest
 * published version (`ensureDefaultSalesInvoiceVersion`), so publishing the
 * default is the moment new invoices change.
 */
@Injectable()
export class TemplateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every template, newest version first, with how many invoices pin each
   * version. Makes sure the built-in default exists first: it is otherwise
   * created by the first issue, and a settings page with nothing to edit
   * until someone issues an invoice would be a puzzle. The insert is
   * idempotent and, once the row exists, a single read.
   */
  async list() {
    await ensureDefaultSalesInvoiceVersion(this.prisma);
    const templates = await this.prisma.documentTemplate.findMany({
      select: TEMPLATE_SELECT,
      orderBy: [{ isDefault: "desc" }, { name: "asc" }, { id: "asc" }],
    });
    return templates.map((template) => ({
      ...template,
      versions: template.versions.map(flattenVersion),
    }));
  }

  /**
   * The settings rail's figures: the default template's newest version (and
   * whether it is still a draft) plus how many drafts exist across every
   * template. Read-only — unlike `list` it does not seed the built-in
   * version, so before the first `list` call the default may be null.
   */
  async summary() {
    const [defaultTemplate, drafts] = await this.prisma.$transaction([
      this.prisma.documentTemplate.findFirst({
        where: { isDefault: true },
        orderBy: [{ kind: "asc" }, { id: "asc" }],
        select: {
          name: true,
          versions: {
            select: { version: true, publishedAt: true },
            orderBy: { version: "desc" },
            take: 1,
          },
        },
      }),
      this.prisma.documentTemplateVersion.count({ where: { publishedAt: null } }),
    ]);
    const newest = defaultTemplate?.versions[0] ?? null;
    return {
      defaultName: defaultTemplate?.name ?? null,
      defaultVersion: newest?.version ?? null,
      defaultIsDraft: newest !== null && newest.publishedAt === null,
      drafts,
    };
  }

  /**
   * One template with the layout the editor opens on: its draft when it has
   * one, else its newest published version (saving then starts a draft).
   */
  async byId(id: string) {
    const template = await this.prisma.documentTemplate.findUnique({
      where: { id },
      select: TEMPLATE_SELECT,
    });
    if (!template) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
    }
    // The layout is read for the newest version only: the history is a list
    // of summaries, and a layout is the one heavy column here.
    const newest = await this.prisma.documentTemplateVersion.findFirst({
      where: { templateId: id },
      orderBy: { version: "desc" },
      select: { id: true, version: true, publishedAt: true, layout: true },
    });
    if (!newest) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The template has no version" });
    }
    const layout = salesInvoiceLayoutSchema.safeParse(newest.layout);
    if (!layout.success) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Template version ${newest.id} does not hold a valid layout`,
      });
    }
    return {
      ...template,
      versions: template.versions.map(flattenVersion),
      layout: layout.data,
      /** Which version `layout` came from, and whether it can still change. */
      editing: { version: newest.version, draft: newest.publishedAt === null },
    };
  }

  /** A new template, its version 1 a draft copy of another template's newest layout. */
  async create(actor: SessionUser, input: CreateDocumentTemplateInput) {
    const source = await this.prisma.documentTemplate.findUnique({
      where: { id: input.fromTemplateId },
      select: {
        kind: true,
        versions: { select: { layout: true }, orderBy: { version: "desc" }, take: 1 },
      },
    });
    const layout = source?.versions[0]?.layout;
    if (!source || layout === undefined) {
      throw new TRPCError({ code: "NOT_FOUND", message: "The template to copy was not found" });
    }
    return this.prisma.documentTemplate.create({
      data: {
        kind: source.kind,
        name: input.name,
        versions: {
          create: {
            version: 1,
            schemaVersion: LAYOUT_SCHEMA_VERSION,
            layout: layout as Prisma.InputJsonValue,
            createdById: actor.id,
          },
        },
      },
      select: { id: true, name: true },
    });
  }

  async rename(input: RenameDocumentTemplateInput) {
    await this.assertExists(input.id);
    return this.prisma.documentTemplate.update({
      where: { id: input.id },
      data: { name: input.name },
      select: { id: true, name: true },
    });
  }

  /**
   * Writes the template's draft: overwritten when there is one, created as
   * the next version when the newest is published. The `where` on
   * `publishedAt: null` is what makes overwriting safe — it cannot match a
   * frozen row even if two saves race a publish. Two saves racing to create
   * the same next version meet the `[templateId, version]` unique instead;
   * the loser is told to reload rather than shown a 500.
   *
   * Both paths stamp the template's `updatedAt` explicitly (it is selected
   * as the template's last edit): saving a draft is editing the template,
   * and an empty `data` leaves it to Prisma whether the row is touched.
   */
  async saveVersion(actor: SessionUser, input: SaveDocumentTemplateVersionInput) {
    try {
      return await this.writeVersion(actor, input);
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Someone else saved a new version of this template a moment ago — reload and edit again",
        });
      }
      throw cause;
    }
  }

  private async writeVersion(actor: SessionUser, input: SaveDocumentTemplateVersionInput) {
    return this.prisma.$transaction(async (tx) => {
      const template = await tx.documentTemplate.findUnique({
        where: { id: input.templateId },
        select: {
          id: true,
          versions: {
            select: { id: true, version: true, publishedAt: true },
            orderBy: { version: "desc" },
            take: 1,
          },
        },
      });
      if (!template) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
      }
      const newest = template.versions[0];

      if (newest && newest.publishedAt === null) {
        const { count } = await tx.documentTemplateVersion.updateMany({
          where: { id: newest.id, publishedAt: null },
          data: {
            layout: input.layout,
            schemaVersion: LAYOUT_SCHEMA_VERSION,
            createdById: actor.id,
          },
        });
        if (count === 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "That draft was published a moment ago — reload and edit again",
          });
        }
        await this.touch(tx, template.id);
        return { id: newest.id, version: newest.version };
      }

      const created = await tx.documentTemplateVersion.create({
        data: {
          templateId: template.id,
          version: (newest?.version ?? 0) + 1,
          schemaVersion: LAYOUT_SCHEMA_VERSION,
          layout: input.layout,
          createdById: actor.id,
        },
        select: { id: true, version: true },
      });
      await this.touch(tx, template.id);
      return created;
    });
  }

  /** Freezes the template's draft. From here on the row is never written again. */
  async publish(input: PublishDocumentTemplateInput) {
    const draft = await this.prisma.documentTemplateVersion.findFirst({
      where: { templateId: input.templateId, publishedAt: null },
      select: { id: true, version: true, layout: true },
    });
    if (!draft) {
      await this.assertExists(input.templateId);
      throw new TRPCError({ code: "BAD_REQUEST", message: "There is no draft to publish" });
    }
    // Saved through the schema, but re-checked: this is the last moment the
    // row can still be refused rather than pinned by an invoice.
    if (!salesInvoiceLayoutSchema.safeParse(draft.layout).success) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "The draft does not hold a valid layout" });
    }
    const { count } = await this.prisma.documentTemplateVersion.updateMany({
      where: { id: draft.id, publishedAt: null },
      data: { publishedAt: new Date() },
    });
    if (count === 0) {
      throw new TRPCError({ code: "CONFLICT", message: "That draft has already been published" });
    }
    return { id: draft.id, version: draft.version };
  }

  /**
   * Makes this the template new invoices of its kind are issued with. It
   * must have a published version, or the next issue would find nothing to
   * pin. The old default is cleared first: the partial unique index allows
   * one default per kind at every instant, not only at commit. Two
   * concurrent calls for the same kind can still both pass the clear and
   * meet `DocumentTemplate_kind_default_key`; the loser gets a CONFLICT.
   */
  async setDefault(id: string) {
    try {
      return await this.makeDefault(id);
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Another template was made the default at the same moment — reload and try again",
        });
      }
      throw cause;
    }
  }

  private async makeDefault(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const template = await tx.documentTemplate.findUnique({
        where: { id },
        select: {
          id: true,
          kind: true,
          name: true,
          _count: { select: { versions: { where: { publishedAt: { not: null } } } } },
        },
      });
      if (!template) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
      }
      if (template._count.versions === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Publish a version before making this template the default",
        });
      }
      await tx.documentTemplate.updateMany({
        where: { kind: template.kind, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
      await tx.documentTemplate.update({ where: { id }, data: { isDefault: true }, select: { id: true } });
      return { id: template.id, name: template.name };
    });
  }

  /** Marks the template as edited now; see `saveVersion`. */
  private async touch(tx: Prisma.TransactionClient, id: string) {
    await tx.documentTemplate.update({
      where: { id },
      data: { updatedAt: new Date() },
      select: { id: true },
    });
  }

  private async assertExists(id: string) {
    const found = await this.prisma.documentTemplate.findUnique({ where: { id }, select: { id: true } });
    if (!found) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
    }
  }
}

/** `_count` folded into a plain `invoiceCount`. */
function flattenVersion<V extends { _count: { salesInvoices: number } }>({ _count, ...version }: V) {
  return { ...version, invoiceCount: _count.salesInvoices };
}
