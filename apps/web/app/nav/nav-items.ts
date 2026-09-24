import { canAccessAny, type Role } from "@repo/api-contract";

/**
 * One nav entry. `href` is null for a module that is planned but not built:
 * the item still renders, so the sidebar states the app's full scope rather
 * than growing new rows as modules land, but it is inert and unfocusable.
 *
 * `requires` gates visibility: the item shows when the user's role passes
 * `canAccessAny` against the list. A LIST rather than a single role, because
 * several modules are "ADMIN and above, or PRODUCTION" — a shape a single
 * required role cannot express, since PRODUCTION and MAGASINIER share a rank
 * and must not inherit each other (see roles.ts). Omit it for items everyone
 * signed in can reach.
 *
 * `only` is the opposite shape: the item shows for EXACTLY these roles and
 * nobody above them. For a worker's own screen ("My shifts"), which an admin
 * has no use for even though rank would let them in. The two are exclusive;
 * `canSee` is the one reader of both.
 *
 * It is UX only — every tRPC procedure authorizes the real session
 * server-side — but hiding a link the caller cannot use beats offering a dead
 * end, and with the shop floor now locked out of most modules the sidebar
 * would otherwise be mostly dead ends for them.
 */
export interface NavItem {
  /** Also the label: the sidebar, breadcrumb and jump box read `nav.items.<key>`. */
  key: string;
  href: string | null;
  requires?: readonly Role[];
  only?: readonly Role[];
  /**
   * Pages inside the module. They are not sidebar rows: the module's hub
   * lists them as tiles, its layout as a tab strip, and the breadcrumb and
   * jump box name them. Only the settings module has them today.
   */
  children?: readonly NavChild[];
}

/**
 * A page inside a module. `requires` narrows the parent's gate for this page
 * only — omit it when every role that reaches the module can open the page.
 * Same UX-only caveat as `NavItem.requires`: the server authorizes.
 */
export interface NavChild {
  key: string;
  href: string;
  requires?: readonly Role[];
  only?: readonly Role[];
  /** The rail groups pages under a heading; `settings.groups.<group>` names it. */
  group: SettingsGroup;
}

/**
 * Whether `role` sees a nav entry: `only` is an exact-role list, `requires`
 * is rank-inclusive through `canAccessAny`, and an entry with neither is for
 * everyone signed in. The sidebar, the jump box and the settings rail all
 * read through this, so the three cannot disagree about who sees a row.
 */
export function canSee(role: Role, entry: { requires?: readonly Role[]; only?: readonly Role[] }): boolean {
  if (entry.only) return entry.only.includes(role);
  return !entry.requires || canAccessAny(role, entry.requires);
}

/** The settings rail's groups, in display order. */
export const SETTINGS_GROUPS = ["access", "documents"] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

interface NavSection {
  /** Rendered as a group label above the items; null for the primary group. */
  title: string | null;
  items: readonly NavItem[];
}

/**
 * The pages of the settings module, in the order its hub and tab strip show
 * them. One list, so the tiles, the tabs, the breadcrumb and the jump box
 * cannot disagree about what the module contains.
 */
export const SETTINGS_CHILDREN: readonly NavChild[] = [
  { key: "users", href: "/settings/users", group: "access" },
  // The activity trace: every API call and sign-in, per user and per
  // record (docs/audit-log-plan.md). Read-only, ADMIN and above.
  { key: "activity", href: "/settings/activity", group: "access" },
  // How generated documents look (docs/sales-invoice-pdf-plan.md).
  // SUPER_ADMIN only: publishing the default restyles every invoice
  // issued afterwards, and the server gates every write the same way.
  { key: "templates", href: "/settings/templates", requires: ["SUPER_ADMIN"], group: "documents" },
];

/**
 * Sidebar structure. Operations first because that is the daily path, then
 * preferences, which is occasional and rank-gated.
 *
 * Planned modules mirror the list on the home page. Keep the two in step:
 * when a module ships, give it an `href` here and drop its card there.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: null,
    /*
     * Chat is deliberately NOT here, and has no route of its own. It lives
     * only in the corner launcher (app/chat/chat-launcher.tsx), because a
     * notice stream is something you check while doing something else — a nav
     * row made you leave the page you were working on to read it.
     *
     * `items.chat` stays in nav.json: the launcher's own label reads from it.
     */
    items: [{ key: "home", href: "/" }],
  },
  {
    title: "Contact",
    items: [
      {
        key: "clients",
        href: "/clients",
        requires: ["ADMIN"],
      },
      {
        key: "suppliers",
        href: "/suppliers",
        requires: ["ADMIN"],
      },
    ],
  },
  {
    title: "Operations",
    items: [
      // Products and job orders are the shop floor's two: the spec to make
      // and the order to make it against (runs are recorded from the order
      // detail page). Everything else in this section is ADMIN and above.
      {
        key: "products",
        href: "/products",
        requires: ["ADMIN", "PRODUCTION"],
      },
      {
        key: "job-orders",
        href: "/orders",
        // MAGASINIER too: it owns the export transition, so it reaches the
        // order detail page even though it is not "shop floor" — see
        // `orderModuleProcedure` in the API.
        requires: ["ADMIN", "PRODUCTION", "MAGASINIER"],
      },
      {
        key: "machines",
        href: "/machines",
        requires: ["ADMIN"],
      },
      {
        key: "employees",
        href: "/employees",
        requires: ["ADMIN"],
      },
      // The production module (day view + full history) is supervision, not
      // the floor's own tool: PRODUCTION records runs from the order detail
      // page and does not need the roll-up. Hidden from that role here and
      // gated server-side on `production.list` / `production.daily`.
      {
        key: "production",
        href: "/production",
        requires: ["ADMIN"],
      },
      // Shift planning (docs/shift-planning-plan.md): the admin's planner
      // and inbox, and the worker's own shifts. "My shifts" is the floor's
      // and the warehouse's screen only — `only`, not `requires`, so ADMIN
      // and above do not get a row for a page about shifts they do not work
      // (decided 2026-09-24). The route itself stays reachable by URL and is
      // authorized server-side like every other.
      {
        key: "shifts",
        href: "/shifts",
        requires: ["ADMIN"],
      },
      {
        key: "my-shifts",
        href: "/shifts/me",
        only: ["PRODUCTION", "MAGASINIER"],
      },
      { key: "stock", href: "/stock", requires: ["ADMIN"] },
      // Inbound paper deliveries. A separate entry from `shipments` below,
      // which is the OUTBOUND module ("what left the yard today") — the two
      // are opposite directions and must not share a key.
      {
        key: "paper-shipments",
        href: "/stock/shipments",
        requires: ["ADMIN"],
      },
      // Scanning reels in off the pallet. The warehouse's own screen, so
      // MAGASINIER alongside ADMIN+ — gated server-side by
      // `warehouseProcedure`. Nests under `/stock`, like the shipments.
      {
        key: "receiving",
        href: "/stock/receiving",
        requires: ["ADMIN", "MAGASINIER"],
      },
      // Walking the warehouse confirming which reels are physically there.
      // The second job for the same handheld as `receiving`, and the
      // warehouse's own screen, so MAGASINIER alongside ADMIN+ — gated
      // server-side by `warehouseProcedure`. Nests under `/stock`; `isActive`
      // picks the most specific href, so this and `/stock` cannot both light.
      {
        key: "stocktake",
        href: "/stock/counts",
        requires: ["ADMIN", "MAGASINIER"],
      },
      // Consumables: the ink colours on the shelf and their balances. What an
      // order draws is recorded from the order page; this is the catalogue
      // and the two corrections (restock, adjust). Nests under `/stock` like
      // the shipments — `isActive` picks the most specific.
      {
        key: "ink-stock",
        href: "/stock/inks",
        requires: ["ADMIN"],
      },
      // Outbound exports: the warehouse's module (docs/export-plan.md), so
      // MAGASINIER alongside ADMIN+ — gated server-side by
      // `warehouseProcedure`. `/shipments` and `/stock/shipments` do not
      // nest, so `isActive` needs no special case.
      {
        key: "shipments",
        href: "/shipments",
        requires: ["ADMIN", "MAGASINIER"],
      },
    ],
  },
  {
    // What was bought and what arrived: purchase orders and the goods
    // receipts raised against them. Commercial, so ADMIN and above;
    // read-only history until a purchasing module owns the write path.
    title: "Purchasing",
    items: [
      {
        key: "purchase-orders",
        href: "/purchasing/orders",
        requires: ["ADMIN"],
      },
      {
        key: "goods-receipts",
        href: "/purchasing/receipts",
        requires: ["ADMIN"],
      },
    ],
  },
  {
    // Money in and money out. Commercial data like clients and suppliers, so
    // ADMIN and above; read-only until the facturation module raises invoices
    // from orders.
    title: "Finance",
    items: [
      {
        key: "purchase-invoices",
        href: "/invoices/purchases",
        requires: ["ADMIN"],
      },
      {
        key: "sales-invoices",
        href: "/invoices/sales",
        requires: ["ADMIN"],
      },
    ],
  },
  {
    // The administrative layer is one module with a rail, not three rows:
    // its pages are occasional work, and grouping them keeps the sidebar to
    // the daily modules. ADMIN and above reach the module; see
    // SETTINGS_CHILDREN for what each page inside it requires.
    //
    // The title is lowercased into a `nav.sections.*` key by the sidebar and
    // the breadcrumb, so renaming it means renaming that key too.
    title: "Preferences",
    items: [
      {
        key: "settings",
        href: "/settings",
        requires: ["ADMIN"],
        children: SETTINGS_CHILDREN,
      },
    ],
  },
] as const;

/**
 * Every sidebar href, for the specificity check in `isActive`. Children are
 * deliberately left out: they live under their parent's href, and listing
 * them here would stop the parent row lighting on its own pages.
 */
const ALL_HREFS: readonly string[] = NAV_SECTIONS.flatMap((section) =>
  section.items
    .map((item) => item.href)
    .filter((href): href is string => href !== null),
);

/**
 * True when `href` is the active route.
 *
 * "/" matches only itself; every other route also matches its children, so
 * /users/new keeps Users highlighted. Without the exact case for the root,
 * Overview would be active on every page.
 *
 * **Most specific wins.** Two nav items can nest — `/stock` and
 * `/stock/shipments` — and a plain prefix test would light up both on
 * /stock/shipments, rendering `aria-current="page"` twice. So a prefix match
 * only counts when no longer nav href also matches the same path.
 */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (pathname === href) return true;
  if (!pathname.startsWith(`${href}/`)) return false;
  return !ALL_HREFS.some(
    (other) =>
      other.length > href.length &&
      (pathname === other || pathname.startsWith(`${other}/`)),
  );
}

/** True when `pathname` is on `child` or one of its sub-pages. */
export function isChildActive(pathname: string, child: NavChild): boolean {
  return pathname === child.href || pathname.startsWith(`${child.href}/`);
}

/**
 * The child page of `item` that `pathname` is on, or null. Children do not
 * nest in each other, so the first prefix match is the only one.
 */
export function activeChild(pathname: string, item: NavItem): NavChild | null {
  return item.children?.find((child) => isChildActive(pathname, child)) ?? null;
}
