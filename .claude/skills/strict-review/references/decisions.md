# Deliberate decisions and known debt — do not report as findings

Always loaded. Each of these looks like an oversight and is a choice made
after the alternative was weighed. Reporting one wastes the reader's trust
and buries real findings. Where a line says "flag once", report it as a
single note, at the severity given here, only when the file is in the
target. **This file sets the severity of anything it names**: a checklist
may describe the same item at its "new instance" level, and a *new*
instance gets that level; the known instance gets this file's.

When the user makes a new deliberate decision, add it here in the same
session, or the next review will report it.

## Data and schema

- **`Float` for money, quantities, weights**; `Int` for counts and mm. Chosen
  knowingly over `Decimal`; rounding is a display concern. Do not propose
  `Decimal` or a money type.
- **Legacy import gaps**: nullable `grammage`/`paperType` on a third of live
  rolls; 214 `RollAllocation` rows with NULL metres (shown by weight, cancel
  is state-only, consume refuses them); 30 legacy sales invoices backfilled
  to EUR; 64 purchase invoices with `currency: null` kept as their own
  group. No backfill without the user asking.
- **No hard delete on reference data**: clients, suppliers, machines,
  employees, products, ink colours archive with `active: false`.
- **Ink stock has no movement ledger**: `InkColour.stock` is the balance,
  `InkUsage` lines are the history; draws are conditional `updateMany`.
- **Roll allocation is in metres**; `Order.metrageNecessaire` is a computed
  snapshot column; `poidsNecessaire` was dropped.
- **Sales invoice `issue()` stores a snapshot and renders nothing**; the PDF
  per language is minted on first GET and stored in `SalesInvoicePdf`. The
  47 migrated invoices have no snapshot and render live. Do not move
  rendering into `issue()`.
- Test invoice F260032 and the 2026 counter at 33 are left in dev on
  purpose.
- Product mention (FSC/PEFC) is optional, invoice and packing list only,
  refused on manual invoices; no logo or claim wording yet.

## API and auth

- **Better Auth is not the RBAC authority**; the rank functions in
  `roles.ts` gate every call. Do not add privilege logic to the auth
  plugin's access-control DSL.
- **SUPER_ADMIN manages its own peers** (`PEER_MANAGING_ROLES`): every super
  admin can ban, demote or delete every other one. Documented trade-off.
- **`me` returns `impersonatedBy`** though nothing reads it yet; the
  impersonate permission is deliberately not granted.
- **Audit opt-outs**: `audit.list` and `audit.actors` (their own row landed
  at the top of the list they had just read), `nav.counts`,
  `settings.summary` (the settings rail's figures, polled every 60 s like
  `nav.counts`),
  `chat.unread` and `chat.markRead`. `audit.byId` stays audited. Reads are logged despite
  refetch volume; the purge is the hand-run `db:audit:purge`.
- **AUTH rows have no IP** and `trust proxy` is off until a reverse proxy
  exists (a forwarded header would be spoofable).
- **PDF routes are plain Express**, do their own `requireAdmin`, and are not
  audited (a document read is a read). The preview route's JSON-only content
  type is the CSRF defence; one render per user at a time is the backstop.
- **`middleware.ts` only checks that a cookie exists.** It is a UX redirect;
  every tRPC procedure is the boundary. It reads a cookie set on another
  port, which works on localhost only. (The Next 16 rename to `proxy.ts` is
  separate and *is* reportable — flag once when the file is in the target.)
- **Leading-wildcard `ILIKE` search** is a sequential scan by construction,
  accepted at admin scale; pg_trgm is the upgrade path.
- **Look-alike scan** loads every active client/supplier per list page and
  is O(n²); accepted at "hundreds". The existing callers are `list`,
  `stats` and `similar` in both partner services (`similar` reads archived
  rows on purpose: an archived row still holds its unique name). Flag a
  new caller or a new whole-table read, not these.
- **`as Role` casts on Better Auth session output** in `main.ts` and the
  `{} as Record<Facet, …>` accumulators in `*.list.ts` are the documented
  escapes.
- **Whole-table reads that are small by nature**: supplier families,
  document templates, machines of one order, production runs of one day,
  ink colours, the roll picker's candidates for one order.
- **Per-row writes in `purchasing`, `stock.slit`, `invoice` line updates**
  carry a distinct value per row; accepted. A new loop must meet the same
  bar.
- API `TRPCError` and Zod messages are English (known gap; plan is key +
  params on the error, web translates). Do not flag per message.

## Web and UI

- **Locale is a cookie (`bp-locale`), not a route segment**; default
  language English; figures keep `fr-FR` grouping and dates are `dd/mm/yyyy`
  on a 24-hour clock in every language (2026-09-23, reversing the earlier
  "dates follow the locale"); only month names follow the reader. Arabic and
  Spanish are drafts pending native review.
- **The `@modal/(.)…` interceptor pages are `"use client"`** thin wrappers;
  the locale setter in `i18n/actions.ts` is the one server action.
- **Invalidation uses un-narrowed `queryKey()`** (prefix match); `pathFilter()`
  is not the house idiom.
- **`<img>` with an eslint-disable for S3/blob URLs** in seven places; a
  shared wrapper is the improvement, not seven findings.
- **Chat**: server-side read stamp (`ChatRead`), own notices never count,
  launcher polls every 20 s and on focus. Do not reintroduce a browser
  stamp.
- **Sales invoices list**: tiles follow the filter; drafts stay visible under
  any date window; overdue = ISSUED, unpaid, `dueAt` < today (payment
  recording is not built, so app-issued invoices past due stay overdue).
  Month bands come from the server.
- **Purchase orders**: reception state derived from lines, `state` facet
  applied as an `id IN (...)` scope from one scan.
- **Export shipment draft**: the UI ship gate (date, packing-list scan,
  customs number + date + scan) is stricter than `ShipmentService.ship`
  (packing-list number + issued invoice). The user has not said the server
  should match; report the gap as a note, not a defect.
- **Design handoffs are authored in English**; French labels need ~30 %
  more width. Column widths that fit English only are real findings, but
  they need a screenshot to confirm.
- Known debt, each reported *once* when its file is in the target, at the
  level given, and any new instance at the checklist's full severity:
  - `orders/[id]/order-detail.tsx` hard-codes English for labels that
    already exist in `orders.json` — MEDIUM (wiring, not authoring)
  - `records.module.css` carries 13 unused classes from the production
    module's migration — LOW
  - ~40 files hand-build `Intl.NumberFormat("fr-FR")` instead of
    `i18n/formats.ts` — LOW per file
  - ~100 `color: var(--bp-neutral-*)` sites and ~300 off-scale spacing
    literals in older stylesheets — LOW, grouped
  - `ProductService.create` is check-then-create with no unique index — LOW
  - the count-scan arm zone lacks `onKeyDown`, `aria-label` and audio
    priming on keyboard focus (receive-scan has them) — MEDIUM
  - `<img>` with an eslint-disable for S3/blob URLs in seven places — LOW,
    one shared wrapper is the fix
  - `apps/web/middleware.ts` still uses the pre-Next-16 name — MEDIUM
  - clients and suppliers mutations do not invalidate `nav.counts`; the
    sidebar's 60 s poll hides it — MEDIUM once (orders, stock and shipments
    invalidate it, which is the rule for new code)
  - the stock CSV export writes dates as an ISO `slice(0, 10)` on purpose:
    a spreadsheet sorts and parses that unambiguously in any Excel locale
- **`busy` and the label swap**: CLAUDE.md says pass `busy` *instead of*
  swapping the submit label; `Button`'s own doc expects "Saving…" to still
  read as the primary action, and eleven forms do both. The rule and the
  toolkit disagree; raise it once as a question, never per form.
- `useSearchParams` without Suspense is **not** debt here: every route is
  dynamic (root layout awaits `cookies()`), and the bundled docs require the
  boundary for static prerendering only.

## Process

- There are no tests and no test infrastructure; verification is `lint`,
  `check-types`, the live API with a session cookie (`scripts/session.sh`)
  and screenshots (`scripts/shoot.mjs`). Do not ask for a test suite as a
  finding; do ask for the specific manual check a change needs.
- **Do not write to the dev database to confirm a finding** (no test
  rows, no mutations, no counter moves) unless the user says so. Confirm a
  write-path claim by quoting the code paths or with a read-only call; the
  dev data and its counters are the user's.
- New `.md` files go in the gitignored root `docs/`.
- Dev servers are killed by port, never by name; `turbo dev` owns its
  processes.
- Prisma migration headers are never edited after apply; the stored
  checksum is fixed instead of resetting.
