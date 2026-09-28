import { Injectable } from "@nestjs/common";
import { canAccessAny, SEARCH_KINDS, type Role, type SearchKind } from "@repo/api-contract";
import type { Prisma } from "../generated/prisma/client.js";
import { clientListDeclaration } from "../client/client.list";
import { employeeListDeclaration } from "../employee/employee.list";
import { inkListDeclaration } from "../ink/ink.list";
import { stockCountListDeclaration } from "../inventory/inventory.list";
import {
  purchaseInvoiceListDeclaration,
  salesInvoiceListDeclaration,
} from "../invoice/invoice.list";
import { searchWhere } from "../list/list-query";
import { machineListDeclaration } from "../machine/machine.list";
import { orderListDeclaration } from "../order/order.list";
import { orderScopeFor } from "../order/order.scope";
import { PrismaService } from "../prisma.service";
import { productListDeclaration } from "../product/product.list";
import {
  goodsReceiptListDeclaration,
  purchaseOrderListDeclaration,
} from "../purchasing/purchasing.list";
import { exportShipmentListDeclaration } from "../shipment/shipment.list";
import { rollListDeclaration, shipmentListDeclaration } from "../stock/stock.list";
import { supplierListDeclaration } from "../supplier/supplier.list";
import type { SessionUser } from "../trpc/trpc";

/** One record in the results: what the popover row says about it. */
export interface SearchHit {
  id: string;
  /** Its number or its name. Null for a draft not yet numbered, or a stocktake. */
  title: string | null;
  /** One line of context: whose it is, what it is for. */
  detail: string | null;
  /** The date the record is known by — an invoice's, a delivery's. */
  date: Date | null;
  /** Archived or retired: still found, since it can still be opened. */
  archived: boolean;
}

export interface SearchGroup {
  kind: SearchKind;
  hits: SearchHit[];
  /** More records match than the group shows; the list has the rest. */
  more: boolean;
}

/** Records shown per group — a popover, not a list. */
const GROUP_SIZE = 4;

/**
 * Records read per group before ranking. Wider than the group so an exact
 * or leading match further down the natural order still makes the cut.
 */
const WINDOW = 20;

/**
 * A second name a record goes by — a code, a matricule, a tax ID. Ranked
 * like the title, never sent.
 */
type Candidate = SearchHit & { alt: string | null };

interface SourceDefinition<TWhere, TRow> {
  kind: SearchKind;
  /**
   * Who may search it: the module's own gate, as `canAccessAny` reads it.
   * Where the sidebar is narrower than the procedure (stock, machines and
   * inks are readable below ADMIN through the order pages, but only ADMIN
   * gets the module), the sidebar's gate is used — a hit must open a page
   * the caller has.
   */
  roles: readonly Role[];
  /** Session-derived and AND-ed first, like `runListQuery`'s scope. */
  scope?: (role: Role) => TWhere;
  /** The module's list vocabulary — the same columns its search box matches. */
  search: (term: string) => TWhere;
  /**
   * The identity column(s) equal to the term, so "CMD-319" finds that order
   * however many others contain it. Always a subset of `search`, so it
   * cannot reach a record the list's search would not.
   */
  exact?: (term: string) => TWhere;
  find: (db: PrismaService, where: TWhere, take: number) => Prisma.PrismaPromise<TRow[]>;
  toHit: (row: TRow) => Candidate;
}

/** A definition with its row type erased, so the sources fit one array. */
interface Source {
  kind: SearchKind;
  roles: readonly Role[];
  queries: (db: PrismaService, role: Role, term: string) => Prisma.PrismaPromise<unknown[]>[];
  toHit: (row: unknown) => Candidate;
}

function source<TWhere, TRow>(definition: SourceDefinition<TWhere, TRow>): Source {
  return {
    kind: definition.kind,
    roles: definition.roles,
    queries: (db, role, term) => {
      const scope = definition.scope?.(role);
      // Structural, like `runListQuery`: every model's WhereInput takes AND.
      const scoped = (fragment: TWhere) =>
        (scope ? { AND: [scope, fragment] } : fragment) as TWhere;
      const window = definition.find(db, scoped(definition.search(term)), WINDOW);
      if (!definition.exact) return [window];
      // Two, not one: a legacy reel number is not unique.
      return [definition.find(db, scoped(definition.exact(term)), 2), window];
    },
    toHit: (row) => definition.toHit(row as TRow),
  };
}

const equalsTerm = (term: string) => ({ equals: term, mode: "insensitive" as const });

/** Present parts joined into one line, or null when there are none. */
function line(...parts: (string | null | undefined)[]): string | null {
  const present = parts.filter((part): part is string => Boolean(part));
  return present.length > 0 ? present.join(" · ") : null;
}

/*
 * The declarations below are factories for their facets (family codes,
 * look-alike ids, today's date); `searchable` depends on none of their
 * arguments, so empty ones are enough.
 */
const SOURCES: readonly Source[] = [
  source({
    kind: "client",
    roles: ["ADMIN"],
    search: (term: string) => searchWhere(clientListDeclaration([]).searchable, term),
    exact: (term: string): Prisma.ClientWhereInput => ({ name: equalsTerm(term) }),
    find: (db, where, take) =>
      db.client.findMany({
        where,
        take,
        orderBy: [{ active: "desc" }, { name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, taxId: true, email: true, phone: true, active: true },
      }),
    toHit: (row) => ({
      id: row.id,
      title: row.name,
      alt: row.taxId,
      detail: row.taxId ?? row.email ?? row.phone,
      date: null,
      archived: !row.active,
    }),
  }),
  source({
    kind: "supplier",
    roles: ["ADMIN"],
    search: (term: string) => searchWhere(supplierListDeclaration([], []).searchable, term),
    exact: (term: string): Prisma.SupplierWhereInput => ({ name: equalsTerm(term) }),
    find: (db, where, take) =>
      db.supplier.findMany({
        where,
        take,
        orderBy: [{ active: "desc" }, { name: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          taxId: true,
          family: { select: { label: true } },
          active: true,
        },
      }),
    toHit: (row) => ({
      id: row.id,
      title: row.name,
      alt: row.taxId,
      detail: line(row.family?.label, row.taxId),
      date: null,
      archived: !row.active,
    }),
  }),
  source({
    kind: "product",
    roles: ["ADMIN", "PRODUCTION"],
    search: (term: string) => searchWhere(productListDeclaration.searchable, term),
    exact: (term: string): Prisma.ProductWhereInput => ({ name: equalsTerm(term) }),
    find: (db, where, take) =>
      db.product.findMany({
        where,
        take,
        orderBy: [{ active: "desc" }, { name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, client: { select: { name: true } }, active: true },
      }),
    toHit: (row) => ({
      id: row.id,
      title: row.name,
      alt: null,
      detail: row.client?.name ?? null,
      date: null,
      archived: !row.active,
    }),
  }),
  source({
    kind: "order",
    roles: ["ADMIN", "PRODUCTION", "MAGASINIER"],
    // PRODUCTION sees only the orders on the floor, here as on the list.
    scope: orderScopeFor,
    search: (term: string) => searchWhere(orderListDeclaration.searchable, term),
    exact: (term: string): Prisma.OrderWhereInput => ({ numero: equalsTerm(term) }),
    find: (db, where, take) =>
      db.order.findMany({
        where,
        take,
        orderBy: [{ active: "desc" }, { createdAt: "desc" }, { id: "asc" }],
        // No money column: every role that reaches orders reads these.
        select: {
          id: true,
          numero: true,
          client: { select: { name: true } },
          product: { select: { name: true } },
          active: true,
        },
      }),
    toHit: (row) => ({
      id: row.id,
      title: row.numero,
      alt: null,
      detail: line(row.client?.name, row.product.name),
      date: null,
      archived: !row.active,
    }),
  }),
  source({
    kind: "machine",
    roles: ["ADMIN"],
    search: (term: string) => searchWhere(machineListDeclaration.searchable, term),
    exact: (term: string): Prisma.MachineWhereInput => ({
      OR: [{ name: equalsTerm(term) }, { code: equalsTerm(term) }],
    }),
    find: (db, where, take) =>
      db.machine.findMany({
        where,
        take,
        orderBy: [{ active: "desc" }, { name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, code: true, brand: true, active: true },
      }),
    toHit: (row) => ({
      id: row.id,
      title: row.name,
      alt: row.code,
      detail: line(row.code, row.brand),
      date: null,
      archived: !row.active,
    }),
  }),
  source({
    kind: "employee",
    roles: ["ADMIN"],
    // The list's vocabulary, which leaves out CIN and pay on purpose.
    search: (term: string) => searchWhere(employeeListDeclaration.searchable, term),
    exact: (term: string): Prisma.EmployeeWhereInput => ({ matricule: equalsTerm(term) }),
    find: (db, where, take) =>
      db.employee.findMany({
        where,
        take,
        orderBy: [{ active: "desc" }, { lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
        select: {
          id: true,
          firstName: true,
          lastName: true,
          matricule: true,
          jobTitle: true,
          active: true,
        },
      }),
    toHit: (row) => ({
      id: row.id,
      // Surname first, as `employeeName` on the web writes it.
      title: [row.lastName, row.firstName].filter(Boolean).join(" ") || row.matricule,
      alt: row.matricule,
      detail: line(row.matricule, row.jobTitle),
      date: null,
      archived: !row.active,
    }),
  }),
  source({
    kind: "roll",
    roles: ["ADMIN"],
    search: (term: string) => searchWhere(rollListDeclaration.searchable, term),
    exact: (term: string): Prisma.PaperRollWhereInput => ({
      OR: [{ numero: equalsTerm(term) }, { numeroSource: equalsTerm(term) }],
    }),
    find: (db, where, take) =>
      db.paperRoll.findMany({
        where,
        take,
        orderBy: [{ archived: "asc" }, { createdAt: "desc" }, { id: "asc" }],
        select: {
          id: true,
          numero: true,
          numeroSource: true,
          paperGrade: true,
          archived: true,
          importShipment: { select: { numeroImport: true } },
        },
      }),
    toHit: (row) => ({
      id: row.id,
      title: row.numero ?? row.numeroSource,
      alt: row.numeroSource,
      detail: line(row.paperGrade, row.importShipment?.numeroImport),
      date: null,
      archived: row.archived,
    }),
  }),
  source({
    kind: "paperShipment",
    roles: ["ADMIN"],
    search: (term: string) => searchWhere(shipmentListDeclaration.searchable, term),
    exact: (term: string): Prisma.ImportShipmentWhereInput => ({
      numeroImport: equalsTerm(term),
    }),
    find: (db, where, take) =>
      db.importShipment.findMany({
        where,
        take,
        orderBy: [{ active: "desc" }, { dateImport: "desc" }, { id: "asc" }],
        select: {
          id: true,
          numeroImport: true,
          dateImport: true,
          supplier: { select: { name: true } },
          active: true,
        },
      }),
    toHit: (row) => ({
      id: row.id,
      title: row.numeroImport,
      alt: null,
      detail: row.supplier.name,
      date: row.dateImport,
      archived: !row.active,
    }),
  }),
  source({
    kind: "stockCount",
    roles: ["ADMIN", "MAGASINIER"],
    // Notes only, as on the list; a count has no number, so nothing is exact.
    search: (term: string) => searchWhere(stockCountListDeclaration.searchable, term),
    find: (db, where, take) =>
      db.stockCount.findMany({
        where,
        take,
        orderBy: [{ openedAt: "desc" }, { id: "asc" }],
        select: { id: true, notes: true, openedAt: true },
      }),
    toHit: (row) => ({
      id: row.id,
      title: null,
      alt: null,
      detail: row.notes,
      date: row.openedAt,
      archived: false,
    }),
  }),
  source({
    kind: "ink",
    roles: ["ADMIN"],
    search: (term: string) => searchWhere(inkListDeclaration.searchable, term),
    exact: (term: string): Prisma.InkColourWhereInput => ({
      OR: [{ code: equalsTerm(term) }, { name: equalsTerm(term) }],
    }),
    find: (db, where, take) =>
      db.inkColour.findMany({
        where,
        take,
        orderBy: [{ active: "desc" }, { code: "asc" }, { id: "asc" }],
        select: { id: true, code: true, name: true, active: true },
      }),
    toHit: (row) => ({
      id: row.id,
      title: row.name,
      alt: row.code,
      detail: row.code,
      date: null,
      archived: !row.active,
    }),
  }),
  source({
    kind: "exportShipment",
    roles: ["ADMIN", "MAGASINIER"],
    search: (term: string) => searchWhere(exportShipmentListDeclaration.searchable, term),
    exact: (term: string): Prisma.ShipmentWhereInput => ({ numero: equalsTerm(term) }),
    find: (db, where, take) =>
      db.shipment.findMany({
        where,
        take,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        select: {
          id: true,
          numero: true,
          exportDate: true,
          client: { select: { name: true } },
        },
      }),
    toHit: (row) => ({
      id: row.id,
      title: row.numero,
      alt: null,
      detail: row.client.name,
      date: row.exportDate,
      archived: false,
    }),
  }),
  source({
    kind: "purchaseOrder",
    roles: ["ADMIN"],
    search: (term: string) => searchWhere(purchaseOrderListDeclaration.searchable, term),
    exact: (term: string): Prisma.PurchaseOrderWhereInput => ({ numero: equalsTerm(term) }),
    find: (db, where, take) =>
      db.purchaseOrder.findMany({
        where,
        take,
        orderBy: [{ issuedAt: "desc" }, { id: "asc" }],
        select: { id: true, numero: true, issuedAt: true, supplier: { select: { name: true } } },
      }),
    toHit: (row) => ({
      id: row.id,
      title: row.numero,
      alt: null,
      detail: row.supplier.name,
      date: row.issuedAt,
      archived: false,
    }),
  }),
  source({
    kind: "goodsReceipt",
    roles: ["ADMIN"],
    search: (term: string) => searchWhere(goodsReceiptListDeclaration.searchable, term),
    exact: (term: string): Prisma.GoodsReceiptWhereInput => ({
      OR: [{ numero: equalsTerm(term) }, { invoiceNumber: equalsTerm(term) }],
    }),
    find: (db, where, take) =>
      db.goodsReceipt.findMany({
        where,
        take,
        orderBy: [{ issuedAt: "desc" }, { id: "asc" }],
        select: {
          id: true,
          numero: true,
          issuedAt: true,
          invoiceNumber: true,
          supplier: { select: { name: true } },
          order: { select: { numero: true } },
        },
      }),
    toHit: (row) => ({
      id: row.id,
      title: row.numero,
      alt: row.invoiceNumber,
      detail: line(row.supplier.name, row.order.numero),
      date: row.issuedAt,
      archived: false,
    }),
  }),
  source({
    kind: "purchaseInvoice",
    roles: ["ADMIN"],
    search: (term: string) =>
      searchWhere(purchaseInvoiceListDeclaration(new Date()).searchable, term),
    exact: (term: string): Prisma.PurchaseInvoiceWhereInput => ({ numero: equalsTerm(term) }),
    find: (db, where, take) =>
      db.purchaseInvoice.findMany({
        where,
        take,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        select: { id: true, numero: true, issuedAt: true, supplier: { select: { name: true } } },
      }),
    toHit: (row) => ({
      id: row.id,
      title: row.numero,
      alt: null,
      detail: row.supplier.name,
      date: row.issuedAt,
      archived: false,
    }),
  }),
  source({
    kind: "salesInvoice",
    roles: ["ADMIN"],
    search: (term: string) => searchWhere(salesInvoiceListDeclaration().searchable, term),
    exact: (term: string): Prisma.SalesInvoiceWhereInput => ({ numero: equalsTerm(term) }),
    find: (db, where, take) =>
      db.salesInvoice.findMany({
        where,
        take,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        select: { id: true, numero: true, issuedAt: true, client: { select: { name: true } } },
      }),
    toHit: (row) => ({
      id: row.id,
      title: row.numero,
      alt: null,
      detail: row.client?.name ?? null,
      date: row.issuedAt,
      archived: false,
    }),
  }),
];

/**
 * 0 equal, 1 leading, 2 inside, 3 not in this text at all — the record
 * matched on another column (an address, an invoice line).
 */
function rankText(text: string | null, needle: string): number {
  if (!text) return 3;
  const value = text.toLowerCase();
  if (value === needle) return 0;
  if (value.startsWith(needle)) return 1;
  return value.includes(needle) ? 2 : 3;
}

/**
 * The top bar's search over every module's records.
 *
 * Adds no vocabulary of its own: each source searches with its module's
 * list declaration, so it matches exactly the columns that list's search
 * box matches and can reveal nothing the list would not, and is gated to
 * the roles that open the module. Only the orders carry a session scope,
 * and it is `orderScopeFor`, the list's own.
 *
 * Every query runs in one `$transaction` array — one connection, not one
 * per module, so a search cannot drain the pool for everyone else.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async global(actor: SessionUser, term: string): Promise<{ groups: SearchGroup[] }> {
    const sources = SOURCES.filter((entry) => canAccessAny(actor.role, entry.roles));
    const planned = sources.map((entry) => entry.queries(this.prisma, actor.role, term));
    const results = await this.prisma.$transaction(planned.flat());

    const needle = term.toLowerCase();
    let offset = 0;
    const ranked = sources.map((entry, index) => {
      const count = planned[index]?.length ?? 0;
      const rows = results.slice(offset, offset + count).flat();
      offset += count;

      // A record found by both queries is kept once.
      const byId = new Map<string, Candidate>();
      for (const row of rows) {
        const hit = entry.toHit(row);
        if (!byId.has(hit.id)) byId.set(hit.id, hit);
      }
      const candidates = [...byId.values()]
        .map((hit) => ({
          hit,
          rank: Math.min(rankText(hit.title, needle), rankText(hit.alt, needle)),
        }))
        // Stable, so equal ranks keep the source's natural order.
        .sort((a, b) => a.rank - b.rank);

      return {
        kind: entry.kind,
        best: candidates[0]?.rank ?? Infinity,
        more: candidates.length > GROUP_SIZE,
        hits: candidates.slice(0, GROUP_SIZE).map(({ hit }) => ({
          id: hit.id,
          title: hit.title,
          detail: hit.detail,
          date: hit.date,
          archived: hit.archived,
        })),
      };
    });

    // The group holding the best match first; the sidebar's order between equals.
    const groups = ranked
      .filter((group) => group.hits.length > 0)
      .sort(
        (a, b) =>
          a.best - b.best || SEARCH_KINDS.indexOf(a.kind) - SEARCH_KINDS.indexOf(b.kind),
      )
      .map(({ kind, hits, more }) => ({ kind, hits, more }));

    return { groups };
  }
}
