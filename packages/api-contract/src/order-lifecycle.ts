import { canAccess, type Role } from "./roles.js";
import { ORDER_STATUSES, type OrderKind, type OrderStatus } from "./orders.js";

/**
 * The order lifecycle transition table — the single authority for which
 * `OrderStatus` changes are legal and who may make them, shared by the server
 * (which enforces it) and the client (which uses it to grey out illegal
 * actions instead of guessing). See docs/order-lifecycle-plan.md §3.
 *
 * Forward transitions are single-step by construction: each row names exactly
 * one `from` and one `to`, so nothing here can skip a state. The 96 historic
 * skip-state orders are a migration concern (plan §4), not a permissive
 * machine — this table has no "skip ahead" row and must never grow one.
 *
 * `role` is a predicate rather than a single required rank, because the
 * table's own "Who" column is not uniform: most rows are "ADMIN or above"
 * (`canAccess(role, "ADMIN")`), but two are "this specific rank-50 sibling, OR
 * ADMIN or above" — a shape `canAccess`/`hasRank` alone cannot express, since
 * PRODUCTION and MAGASINIER share a rank and must not inherit each other's
 * transitions (see roles.ts). Composing the predicate here, once, is what
 * lets `canTransition` stay a single lookup rather than special-casing roles
 * at every call site.
 */
export interface OrderTransition {
  from: OrderStatus;
  to: OrderStatus;
  role: (role: Role) => boolean;
  /** Shown next to the action and required in the transition's `note` when true. */
  noteRequired: boolean;
  /** One line for a UI action label / confirmation prompt. */
  description: string;
  /**
   * A row the machine runs as the consequence of another action, never a
   * person from the rail: `availableOrderTransitions` leaves it out, while
   * `findOrderTransition` still resolves it so the owning service can run
   * it inside its own transaction. See `READY_FOR_EXPORT -> INVOICEABLE`.
   */
  automatic?: boolean;
}

const adminOrAbove = (role: Role) => canAccess(role, "ADMIN");
const productionOrAdmin = (role: Role) => role === "PRODUCTION" || adminOrAbove(role);
const magasinierOrAdmin = (role: Role) => role === "MAGASINIER" || adminOrAbove(role);

/**
 * Terminal states: no row in `ORDER_TRANSITIONS` has one of these as `from`.
 * Exported so a UI can grey out every action on a terminal order without
 * having to scan the whole table first.
 */
export const TERMINAL_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "COMPLETED",
  "CANCELLED",
]);

/**
 * The forward pipeline plus the two audited reopens. `CANCELLED` is handled
 * separately by `canTransition` ("any non-terminal status" — see its doc
 * comment) rather than as one row per source state here: naming every
 * non-terminal status individually would silently miss a state added to
 * `OrderStatus` later, exactly the kind of gap plan §5.1 warns about for the
 * list facets. `ORDER_TRANSITIONS_TO_CANCELLED_NOTE` documents that one rule
 * in one place instead.
 */
export const ORDER_TRANSITIONS: readonly OrderTransition[] = [
  {
    from: "DRAFT",
    to: "IN_PRODUCTION",
    role: adminOrAbove,
    noteRequired: false,
    description: "Release to production",
  },
  {
    from: "IN_PRODUCTION",
    to: "PRODUCED",
    role: productionOrAdmin,
    noteRequired: false,
    description: "Mark produced",
  },
  {
    from: "PRODUCED",
    to: "INVOICEABLE",
    role: adminOrAbove,
    noteRequired: false,
    description: "Release to invoicing",
  },
  // Reached only by raising a sales invoice: `InvoiceService.createFromOrder`
  // inserts the invoice and then runs this transition in the same
  // transaction, and `OrderService.transition` refuses it when no invoice
  // line references the order — so a bare `order.transition` can never get
  // here. The rail dispatches this row to the create-invoice action rather
  // than the generic dialog (docs/sales-invoice-plan.md §7).
  {
    from: "INVOICEABLE",
    to: "INVOICED",
    role: adminOrAbove,
    noteRequired: false,
    description: "Create invoice",
  },
  // Reached only by raising a shipment: `ShipmentService.createFromOrder`
  // inserts the draft and then runs this transition in the same
  // transaction, and `OrderService.transition` refuses it when no DRAFT
  // shipment line references the order. The warehouse raises the shipment,
  // so the row admits MAGASINIER as well as ADMIN+ (docs/export-plan.md).
  {
    from: "INVOICED",
    to: "READY_FOR_EXPORT",
    role: magasinierOrAdmin,
    noteRequired: false,
    description: "Create shipment",
  },
  // `ShipmentService.ship` runs this automatically when the truck takes the
  // last parcel (or an admin closes the order short, with a note). As a
  // bare "Mark exported" it survives only for orders with no shipment at
  // all — the guard in `OrderService.transition` refuses it while a draft
  // shipment exists, so `noteRequired` stays false for the legacy case.
  {
    from: "READY_FOR_EXPORT",
    to: "COMPLETED",
    role: magasinierOrAdmin,
    noteRequired: false,
    description: "Mark exported",
  },
  {
    from: "PRODUCED",
    to: "IN_PRODUCTION",
    role: adminOrAbove,
    noteRequired: true,
    description: "Reopen to production",
  },
  {
    from: "INVOICEABLE",
    to: "PRODUCED",
    role: adminOrAbove,
    noteRequired: true,
    description: "Reopen to produced",
  },
  // The third audited reopen: only while the order's invoice is still a
  // DRAFT (guarded in `OrderService.transition`), and only through
  // `InvoiceService.discardDraft`, which deletes the draft in the same
  // transaction. An issued invoice is never deleted, so an INVOICED order
  // with one cannot come back this way.
  {
    from: "INVOICED",
    to: "INVOICEABLE",
    role: adminOrAbove,
    noteRequired: true,
    description: "Discard draft invoice",
  },
  // The fourth audited reopen, the shipment's twin of the row above: only
  // while a DRAFT shipment exists, and only through
  // `ShipmentService.discardDraft`, which deletes the draft in the same
  // transaction and leaves the issued invoice free to be paired again.
  {
    from: "READY_FOR_EXPORT",
    to: "INVOICED",
    role: adminOrAbove,
    noteRequired: true,
    description: "Discard draft shipment",
  },
  // The order cycles after a partial export (docs/export-plan.md): the
  // truck took some parcels, the rest still need their own invoice and
  // shipment. Every other backward row is a human reversal and ADMIN-only;
  // this one is the machine's consequence of the forward "ship" action the
  // warehouse owns, so it must admit MAGASINIER or `ship` would fail for
  // the role that ships. Not a loophole: `automatic` keeps it off the rail,
  // and the guard refuses it as a bare call whenever a DRAFT shipment
  // exists — which, outside `ship`'s transaction, is always.
  {
    from: "READY_FOR_EXPORT",
    to: "INVOICEABLE",
    role: magasinierOrAdmin,
    noteRequired: true,
    description: "Partial export",
    automatic: true,
  },
];

/**
 * Every non-terminal status may move to CANCELLED, ADMIN and above only, with
 * a required `note` — see docs/order-lifecycle-plan.md §3. Kept out of
 * `ORDER_TRANSITIONS` (see that constant's doc comment) so a status added to
 * the enum is cancellable by construction rather than by remembering to add a
 * row for it.
 */
const CANCEL_TRANSITION = {
  to: "CANCELLED" as const,
  role: adminOrAbove,
  noteRequired: true,
  description: "Cancel order",
};

/**
 * Looks up the transition from `from` to `to`, or `undefined` if none exists
 * in the table (including into or out of a terminal status, other than the
 * universal "any non-terminal -> CANCELLED" rule).
 */
export function findOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
): OrderTransition | undefined {
  if (to === "CANCELLED") {
    return TERMINAL_ORDER_STATUSES.has(from) ? undefined : { from, ...CANCEL_TRANSITION };
  }
  return ORDER_TRANSITIONS.find((t) => t.from === from && t.to === to);
}

/**
 * Whether `role` may move an order from `from` to `to` right now. `false`
 * both when the transition does not exist (wrong shape — the caller should
 * reject with `BAD_REQUEST`) and when it exists but this role may not perform
 * it (right shape, wrong actor — `PRECONDITION_FAILED`); `findOrderTransition`
 * is what tells the two apart when the caller needs to.
 */
export function canTransition(from: OrderStatus, to: OrderStatus, role: Role): boolean {
  const transition = findOrderTransition(from, to);
  return transition !== undefined && transition.role(role);
}

/**
 * Every legal `to` from `from` that `role` may currently perform — what a
 * status-badge dropdown or action menu renders, so illegal actions are never
 * offered rather than offered-then-rejected.
 */
export function availableOrderTransitions(from: OrderStatus, role: Role): OrderTransition[] {
  const forward = ORDER_TRANSITIONS.filter(
    (t) => t.from === from && !t.automatic && t.role(role),
  );
  if (TERMINAL_ORDER_STATUSES.has(from) || !CANCEL_TRANSITION.role(role)) return forward;
  return [...forward, { from, ...CANCEL_TRANSITION }];
}

/**
 * The `kind` axis's one transition — QUOTE -> ORDER, the legacy
 * `confirmerOffre`. Not part of `ORDER_TRANSITIONS`: `kind` and `status` are
 * orthogonal (plan §2.1), and folding this in would repeat exactly the
 * conflation plan §1.1(f) diagnoses in the legacy booleans. One-way: there is
 * no ORDER -> QUOTE transition (see the plan for why), so this is a boolean
 * check, not a table lookup.
 *
 * Guarded on `status === "DRAFT"` — a quote cannot have progressed down the
 * pipeline, so acceptance never has to reconcile with a status further along.
 */
export function canAcceptQuote(kind: OrderKind, status: OrderStatus, role: Role): boolean {
  return kind === "QUOTE" && status === "DRAFT" && adminOrAbove(role);
}

/**
 * The other half of that guard: a quote stays out of the pipeline until it is
 * accepted. It may be declined (-> CANCELLED) and reopened (-> DRAFT), nothing
 * else — otherwise a QUOTE could reach IN_PRODUCTION, `canAcceptQuote` would
 * never be true for it again, and `legacyFlagsForStatus` would keep writing
 * it as a quotation. Mattered little while quotes only came from the
 * migration; it does now that the form drafts them (2026-09-21).
 */
export function kindAllowsTransition(kind: OrderKind, to: OrderStatus): boolean {
  return kind === "ORDER" || to === "CANCELLED" || to === "DRAFT";
}

/** Every `OrderStatus` that is not terminal — used to render the full pipeline. */
export const NON_TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ORDER_STATUSES.filter(
  (s) => !TERMINAL_ORDER_STATUSES.has(s),
);

/**
 * The four legacy workflow booleans this migration replaces, still kept live
 * on `Order` for the soak period between plan §6 steps 4 and 5 ("the flags
 * become read-only derived values for one release"). Nothing writes these
 * from client input any more (see `order-input.ts`) — `OrderService` derives
 * them from `kind`/`status` with this function on every create and
 * transition, so an old reader that still checks a boolean keeps working.
 */
export interface LegacyWorkflowFlags {
  offreDePrix: boolean;
  produitFini: boolean;
  okFacturation: boolean;
  okExport: boolean;
}

/**
 * Inverts docs/order-lifecycle-plan.md §4's migration mapping, extended to
 * the statuses that mapping never had to cover (`IN_PRODUCTION`,
 * `INVOICEABLE`, `READY_FOR_EXPORT`, `CANCELLED` — none is a legacy bucket).
 *
 * The extension follows the pipeline diagram in plan §2.2, where each boolean
 * annotates the arrow INTO the status it first becomes true at, and then
 * stays true through every later status — a monotonic pipeline, exactly like
 * the legacy `produitFini`/`okFacturation`/`okExport` never being un-set on
 * forward progress:
 *
 *   - `produitFini` from PRODUCED onward (annotates PRODUCED's arrow)
 *   - `okFacturation` from INVOICEABLE onward (annotates INVOICEABLE's arrow)
 *   - `okExport` from READY_FOR_EXPORT onward (annotates READY_FOR_EXPORT's arrow)
 *
 * `CANCELLED` is deliberately NOT resolved here: it can be reached from any
 * non-terminal status (plan §3), so there is no single boolean combination
 * that means "cancelled" — a cancelled order's flags are left exactly as they
 * were at the moment of cancellation instead of being recomputed. Callers
 * must special-case it: `OrderService.transitionIn` writes no flags at all
 * on a move to CANCELLED. (Called with CANCELLED anyway, this returns the
 * post-production shape — `produitFini: true` — which is why it must not be.)
 */
export function legacyFlagsForStatus(kind: OrderKind, status: OrderStatus): LegacyWorkflowFlags {
  if (kind === "QUOTE") {
    return { offreDePrix: true, produitFini: false, okFacturation: false, okExport: false };
  }
  const produitFini = !["DRAFT", "IN_PRODUCTION"].includes(status);
  const okFacturation = ["INVOICEABLE", "INVOICED", "READY_FOR_EXPORT", "COMPLETED"].includes(
    status,
  );
  const okExport = ["READY_FOR_EXPORT", "COMPLETED"].includes(status);
  return { offreDePrix: false, produitFini, okFacturation, okExport };
}

/**
 * The order statuses a PRODUCTION user is allowed to see at all.
 *
 * The shop floor works from the orders released to it, and only those:
 * `IN_PRODUCTION` is the queue. Everything else — quotes, drafts, and the
 * whole produced/invoicing/export tail — is commercial, not shop-floor, and
 * is hidden. That includes `PRODUCED`: the moment the floor marks an order
 * produced it leaves their view, so the list is exactly the work still open.
 *
 * This is a SCOPE, not a facet: `OrderService.list` AND-s it in from the
 * session before anything the client sent, and `byId` re-checks it, so a
 * PRODUCTION user cannot reach a hidden order by guessing its id either. Per
 * the repo convention a hidden order 404s rather than 403s — `FORBIDDEN`
 * would confirm it exists.
 */
export const PRODUCTION_VISIBLE_ORDER_STATUSES: readonly OrderStatus[] = ["IN_PRODUCTION"];

/**
 * Whether `role` may see an order in `status`. Unscoped roles see every
 * status; PRODUCTION only the list above.
 *
 * The web uses it after a transition to notice the order has just left the
 * caller's view (a PRODUCTION user marking one produced) and leave the
 * detail page before its refetch 404s. It is a UX hint only — the server
 * scopes from the session regardless.
 */
export function canSeeOrderStatus(role: Role, status: OrderStatus): boolean {
  return !ordersAreScopedFor(role) || PRODUCTION_VISIBLE_ORDER_STATUSES.includes(status);
}

/**
 * Whether `role` sees only a slice of the orders table. True for PRODUCTION
 * (see above); false for everyone else, who see all of it — MAGASINIER
 * included, since the export queue they work is at the far end of the
 * pipeline and scoping them is a separate decision nobody has made yet.
 */
export function ordersAreScopedFor(role: Role): boolean {
  return role === "PRODUCTION";
}
