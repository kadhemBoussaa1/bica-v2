import type { SVGProps } from "react";

/**
 * Nav glyphs, hand-authored on an 18px grid with a 1.5px stroke.
 *
 * Inline rather than an icon dependency: it is a small closed set, they must
 * stay legible at rail size, and the shapes are deliberately literal about
 * the trade — a paper reel, a press, a kraft bag — rather than generic
 * dashboard glyphs.
 *
 * Everything is `currentColor`, so one `color` on the link drives icon and
 * label together and the active/disabled states need no icon-specific rules.
 */

function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

/** Overview — a gauge, the shape of "state of the plant at a glance". */
function HomeIcon() {
  return (
    <Svg>
      <path d="M2.5 12.5a6.5 6.5 0 1 1 13 0" />
      <path d="M9 12.5 12 8" />
      <circle cx="9" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Products — a kraft bag: the flared body and folded top of what is made. */
function ProductsIcon() {
  return (
    <Svg>
      <path d="M5 6.5 6 2.5h6l1 4" />
      <path d="M4 6.5h10l-0.8 9H4.8z" />
      <path d="M7 9.5v-2M11 9.5v-2" />
    </Svg>
  );
}

/** Job orders — a spec sheet: the order document with its lines. */
function JobOrdersIcon() {
  return (
    <Svg>
      <path d="M4 2.5h7l3 3v10H4z" />
      <path d="M10.75 2.75v3h3" />
      <path d="M6.25 9.5h5M6.25 12h3.5" />
    </Svg>
  );
}

/** Production — a reel on the press: web feeding off a roll. */
function ProductionIcon() {
  return (
    <Svg>
      <circle cx="6" cy="6" r="3.5" />
      <circle cx="6" cy="6" r="0.9" fill="currentColor" stroke="none" />
      <path d="M9.2 7.4 15 11v4.5H3.5" />
    </Svg>
  );
}

/** Stock — stacked bales, counted from the floor up. */
function StockIcon() {
  return (
    <Svg>
      <path d="M2.5 11h13v4.5h-13zM4.75 6.5h8.5V11h-8.5zM7 2.5h4v4H7z" />
    </Svg>
  );
}

/**
 * Paper shipments — a reel arriving, with the arrow pointing IN. Deliberately
 * the mirror of ShipmentsIcon below (a truck leaving): these are opposite
 * directions, and the glyphs should read that way at rail size.
 */
function PaperShipmentsIcon() {
  return (
    <Svg>
      <circle cx="11" cy="7" r="4" />
      <circle cx="11" cy="7" r="0.9" fill="currentColor" stroke="none" />
      <path d="M2.5 14.5h13" />
      <path d="M5 11.5 2.5 14 5 16.5" />
    </Svg>
  );
}

/** Ink stock — a tin of ink with its lid, a drop on the label. */
function InkStockIcon() {
  return (
    <Svg>
      <rect x="4" y="6" width="10" height="9" rx="1.5" />
      <path d="M3 6h12" />
      <path d="M6.5 3.5h5v2.5h-5z" />
      <path d="M9 9.5c-1 1.2-1.4 1.9-1.4 2.5a1.4 1.4 0 0 0 2.8 0c0-.6-.4-1.3-1.4-2.5Z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Shipments — the truck that leaves the yard. */
function ShipmentsIcon() {
  return (
    <Svg>
      <path d="M1.5 4.5h8v8h-8zM9.5 7.5h3.5l2.5 2.5v2.5h-6z" />
      <circle cx="5" cy="14" r="1.4" />
      <circle cx="12.5" cy="14" r="1.4" />
    </Svg>
  );
}

/** Users — one figure, not a crowd: the row you act on is a person. */
function UsersIcon() {
  return (
    <Svg>
      <circle cx="9" cy="5.75" r="3.25" />
      <path d="M3.25 15.5a5.75 5.75 0 0 1 11.5 0" />
    </Svg>
  );
}

/** Clients: a storefront — the buying side of the trade. */
function ClientsIcon() {
  return (
    <Svg>
      <path d="M2.5 6.5h13v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
      <path d="M2.5 6.5 4 2.5h10l1.5 4" />
      <path d="M7 15.5v-4h4v4" />
    </Svg>
  );
}

/** Suppliers: an inbound crate — the supplying side. */
function SuppliersIcon() {
  return (
    <Svg>
      <path d="M9 2.5 15.5 6v6L9 15.5 2.5 12V6z" />
      <path d="M2.5 6 9 9.5 15.5 6" />
      <path d="M9 9.5v6" />
    </Svg>
  );
}

/** Machines: a press frame with a roller. */
function MachinesIcon() {
  return (
    <Svg>
      <path d="M2.5 12.5h13v3h-13z" />
      <path d="M4.5 12.5v-4h9v4" />
      <circle cx="9" cy="5.5" r="2.5" />
    </Svg>
  );
}

/** Employees: two figures. */
function EmployeesIcon() {
  return (
    <Svg>
      <circle cx="6.5" cy="6" r="2.5" />
      <path d="M2.5 15v-1.5a4 4 0 0 1 8 0V15" />
      <path d="M12 4.2a2.5 2.5 0 0 1 0 5.1" />
      <path d="M13 11.5a4 4 0 0 1 2.5 3.5V15" />
    </Svg>
  );
}

/** Purchase orders — a clipboard: what was asked of a supplier. */
function PurchaseOrdersIcon() {
  return (
    <Svg>
      <path d="M4.5 4h9v11.5h-9z" />
      <path d="M6.75 4V2.75h4.5V4" />
      <path d="M6.75 8.5h4.5M6.75 11.5h3" />
    </Svg>
  );
}

/** Goods receipts — a carton with a tick: what actually arrived. */
function GoodsReceiptsIcon() {
  return (
    <Svg>
      <path d="M2.5 6.5 9 3.5l6.5 3v7L9 16.5l-6.5-3z" />
      <path d="M2.5 6.5 9 9.5l6.5-3M9 9.5v7" />
      <path d="M5 9.75l1.25 1.25 2-2.25" />
    </Svg>
  );
}

/** Purchase invoices — a bill with an inbound arrow: money owed out. */
function PurchaseInvoicesIcon() {
  return (
    <Svg>
      <path d="M4 2.5h10v13l-1.7-1.2-1.6 1.2-1.7-1.2-1.6 1.2-1.7-1.2L4 15.5z" />
      <path d="M9 5.5v5M7 8.5l2 2 2-2" />
    </Svg>
  );
}

/** Sales invoices — a bill with an outbound arrow: money owed in. */
function SalesInvoicesIcon() {
  return (
    <Svg>
      <path d="M4 2.5h10v13l-1.7-1.2-1.6 1.2-1.7-1.2-1.6 1.2-1.7-1.2L4 15.5z" />
      <path d="M9 10.5v-5M7 7.5l2-2 2 2" />
    </Svg>
  );
}

/** Activity: a pulse line, the trace of what happened. */
function ActivityIcon() {
  return (
    <Svg>
      <path d="M2 9h3l2-5 3 10 2-5h4" />
    </Svg>
  );
}

/** Maps a NavItem key to its glyph. Keys come from nav-items.ts. */
/** Receiving — a scanner beam crossing a label: reading a reel in. */
function ReceivingIcon() {
  return (
    <Svg>
      <path d="M2.5 5.5v-3h3M12.5 2.5h3v3M15.5 12.5v3h-3M5.5 15.5h-3v-3" />
      <path d="M2.5 9h13" />
      <path d="M6 6v1.5M9 6v1.5M12 6v1.5M6 10.5V12M9 10.5V12M12 10.5V12" />
    </Svg>
  );
}

/** Stocktake — a clipboard with a tick: walking the floor, checking reels off. */
function StocktakeIcon() {
  return (
    <Svg>
      <path d="M6 3.5H4.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-10a1 1 0 0 0-1-1H12" />
      <path d="M6.5 2.5h5v2h-5z" />
      <path d="m6.5 9.5 1.5 1.5 3.5-3.5" />
    </Svg>
  );
}

/** A speech bubble for the shared notice stream. */
function ChatIcon() {
  return (
    <Svg>
      <path d="M15.5 9c0 3-2.9 5.5-6.5 5.5-.86 0-1.68-.14-2.43-.4L3 15.5l1.1-2.9A5.2 5.2 0 0 1 2.5 9C2.5 6 5.4 3.5 9 3.5S15.5 6 15.5 9Z" />
    </Svg>
  );
}

/** Document templates: a sheet with its blocks ruled in. */
function TemplatesIcon() {
  return (
    <Svg>
      <path d="M4.5 2.5h9v13h-9z" />
      <path d="M6.5 5h3M6.5 8h5M6.5 10.5h5M9.5 13h2" />
    </Svg>
  );
}

/** Settings: three sliders — the knobs behind the app, not a gear. */
function SettingsIcon() {
  return (
    <Svg>
      <path d="M2.5 4.75h7.25M13.25 4.75h2.25" />
      <circle cx="11.5" cy="4.75" r="1.75" />
      <path d="M2.5 9h1.75M7.75 9h7.75" />
      <circle cx="5.75" cy="9" r="1.75" />
      <path d="M2.5 13.25h8.25M14.25 13.25h1.25" />
      <circle cx="12.5" cy="13.25" r="1.75" />
    </Svg>
  );
}

/** Shift planning — a week strip with three cells filled: the roster grid. */
function ShiftsIcon() {
  return (
    <Svg>
      <path d="M2.5 4.5h13v11h-13z" />
      <path d="M2.5 8h13M6.75 4.5v11M11.25 4.5v11" />
      <path d="M4 2.5v2M9 2.5v2M14 2.5v2" />
    </Svg>
  );
}

/** My shifts — a clock face over a person: when I am on. */
function MyShiftsIcon() {
  return (
    <Svg>
      <circle cx="11.5" cy="6" r="3.75" />
      <path d="M11.5 4v2.25l1.5 1" />
      <circle cx="5.75" cy="7" r="2.25" />
      <path d="M2 15.5c0-2.5 1.7-4 3.75-4s3.75 1.5 3.75 4" />
    </Svg>
  );
}

export const NAV_ICONS: Record<string, () => React.JSX.Element> = {
  home: HomeIcon,
  chat: ChatIcon,
  clients: ClientsIcon,
  suppliers: SuppliersIcon,
  products: ProductsIcon,
  "job-orders": JobOrdersIcon,
  machines: MachinesIcon,
  employees: EmployeesIcon,
  production: ProductionIcon,
  shifts: ShiftsIcon,
  "my-shifts": MyShiftsIcon,
  stock: StockIcon,
  "paper-shipments": PaperShipmentsIcon,
  receiving: ReceivingIcon,
  stocktake: StocktakeIcon,
  "ink-stock": InkStockIcon,
  shipments: ShipmentsIcon,
  "purchase-orders": PurchaseOrdersIcon,
  "goods-receipts": GoodsReceiptsIcon,
  "purchase-invoices": PurchaseInvoicesIcon,
  "sales-invoices": SalesInvoicesIcon,
  settings: SettingsIcon,
  // The settings module's pages: tiles on its hub and the jump box.
  users: UsersIcon,
  activity: ActivityIcon,
  templates: TemplatesIcon,
};

/** Hamburger for the mobile bar. */
export function MenuIcon() {
  return (
    <Svg>
      <path d="M2.5 5h13M2.5 9h13M2.5 13h13" />
    </Svg>
  );
}

/** Close for the open drawer. */
export function CloseIcon() {
  return (
    <Svg>
      <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
    </Svg>
  );
}

/**
 * Collapse chevron. It points the way the rail will move, and the CSS rotates
 * it 180° when collapsed rather than swapping in a second glyph.
 */
export function ChevronIcon() {
  return (
    <Svg>
      <path d="M11 4.5 6.5 9l4.5 4.5" />
    </Svg>
  );
}

/** Sign out — a door with the arrow leaving it. */
export function SignOutIcon() {
  return (
    <Svg>
      <path d="M7 15.5H3.5v-13H7" />
      <path d="M11 5.5 14.5 9 11 12.5M14.5 9h-8" />
    </Svg>
  );
}

/** Search — the top bar's jump box. */
export function SearchIcon() {
  return (
    <Svg>
      <circle cx="8" cy="8" r="5" />
      <path d="m12 12 3.5 3.5" />
    </Svg>
  );
}
