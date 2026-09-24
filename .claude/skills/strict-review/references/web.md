# Web checklist — Next 16 + React 19 + TanStack Query 5 + next-intl (`apps/web`, `packages/ui`)

Load this when the target touches `apps/web/` or `packages/ui/`. Your
training data predates this Next; when a rule below and your memory
disagree, open the bundled docs and cite them:

```
apps/web/node_modules/next/dist/docs/01-app/
  01-getting-started/05-server-and-client-components.md
  01-getting-started/06-fetching-data.md   07-mutating-data.md   08-caching.md
  01-getting-started/16-proxy.md           03-api-reference/03-file-conventions/proxy.md
  02-guides/data-security.md               02-guides/upgrading/version-16.md
```

## 1. Server / client boundary

- **`page.tsx` and `layout.tsx` are async server components**: `await
  getTranslations(ns)`, render the shell, mount one client leaf
  (`<XTable />`). `"use client"` on a route file is a finding — with one
  exception: the `app/@modal/(.)…/page.tsx` interceptors are thin
  `RouteModal` wrappers and are client by design. [MEDIUM]
- **Shared client-only leaves may omit the directive** and inherit the
  boundary from their importer (`orders/order-status.tsx` uses
  `useTranslations` with no directive). That is fine; a server component
  importing it would fail at build, which `check-types` does not run. [LOW]
- **Server → client props are serialisable**: no functions, class instances
  or `Date` objects across the boundary; dates cross as strings and are
  formatted client-side through `i18n/formats.ts`. [HIGH]
- **`AppRouter` is a type-only import** (`import type … from "api/src/trpc/trpc.router"`).
  A value import from `api/` drags Nest and Prisma into the bundle. [BLOCKER]
- **No server actions.** Mutations go through tRPC, which is where the gate,
  the scope and the audit row live. The one `"use server"` is the locale
  cookie setter in `i18n/actions.ts`. [HIGH]
- **Next 16 request APIs are async**: `await params`, `await searchParams`,
  `await cookies()`, `await headers()`. Sync access is the Next 15
  compatibility shim and is gone. [HIGH]
- **`middleware.ts` is deprecated in Next 16** in favour of `proxy.ts`
  exporting `proxy()` (node runtime). The repo still has `middleware.ts`;
  report it once, as MEDIUM, only when that file is in the target. Its
  existence check on the cookie is UX, not authorisation — do not ask it to
  verify sessions. [MEDIUM]
- `useSearchParams` needs a `<Suspense>` boundary only on a route that is
  statically prerendered (`use-search-params.md` in the bundled docs). Every
  route here is dynamic — the root layout awaits `cookies()` through
  `getLocale()` — so a bare `useSearchParams` is not a finding in this app;
  `activity/page.tsx` wraps it anyway, which is harmless. Re-check if a
  route ever opts into static rendering. [—]
- Parallel routes need a `default.tsx` (the `@modal` slot has one). A new
  slot without it 404s on hard navigation. [HIGH]
- `next/link` for internal navigation, `next/image` for raster images. The
  `<img>` sites with an eslint-disable are S3/blob URLs; a new one must say
  why in the disable comment, and a shared `unoptimized` wrapper beats seven
  disables. [LOW]
- No `export const dynamic|revalidate|runtime` without a comment; the app is
  fully dynamic behind a session already. [LOW]

## 2. Data: queries, mutations, cache

- **`useQuery(trpc.x.y.queryOptions(input))`**, never `useEffect` + fetch.
  Dependent queries use `enabled:`; the only raw `fetch` calls are the tRPC
  link and the PDF blob preview. [HIGH]
- **Paginated lists pass `placeholderData: (prev) => prev`** so paging dims
  instead of blanking. Every list table does this; a new one that does not
  flashes the skeleton on each page turn. [MEDIUM]
- **`page` resets to 1 on search, sort or filter.** `DataTable` emits
  `page: 1` for the changes it owns; any custom toolbar control (period
  pills, segmented facets) must add `page: 1` itself or the user lands on an
  empty page 4. Check every `setTableState` call outside `onStateChange`. [HIGH]
- **Search is debounced** (~300 ms): `DataTable`'s own debounce, or
  `useDebounced` from `records/partner-ui.tsx` for a form field. A live
  query per keystroke is a finding. [MEDIUM]
- **Invalidation is targeted**: `queryClient.invalidateQueries({ queryKey:
  trpc.x.list.queryKey() })` — un-narrowed on purpose, it prefix-matches
  every page. `invalidateQueries()` with no key refetches every query on
  screen and writes an audit row for each. `pathFilter()` is not used here;
  do not ask for it. [HIGH]
- **Every mutation invalidates what it changed**, plus the module's stats
  and `nav.counts` when the change moves a sidebar figure (orders, stock
  and shipments do this; the sidebar's 60 s poll is the backstop, not the
  mechanism). Cross-module fan-out goes through a shared helper
  (`stock/roll-queries.ts`); a mutation with no `onSuccess` and no delegate
  is a finding. No `setQueryData` optimism, no `router.refresh()` for data
  (auth and locale only). Known gap: the partner modules (clients,
  suppliers) skip `nav.counts` — MEDIUM once, per decisions.md. [HIGH / known: MEDIUM]
- **Polling is a documented decision** (chat launcher, 20 s + focus). A new
  `refetchInterval` needs the same justification. `staleTime` is 30 s
  globally; do not override it per query without a reason. [MEDIUM]
- **Row types are derived**: `type XRow = NonNullable<typeof q.data>["rows"][number]`
  or `inferRouterOutputs<AppRouter>[…]`. A hand-written `interface XRow` that
  mirrors a server `select` will drift silently. Local view models (chat
  message groups, monthly production cells) are not mirrors and are fine. [HIGH]
- **Zod schemas are reused on the client**: forms parse with the contract's
  `createXInput.safeParse` so the error the user sees is the one the server
  would send. A second validation vocabulary is a finding. [MEDIUM]
- **Table state is one object** `XTableState extends DataTableState` with a
  module-level `INITIAL_STATE` whose `sortBy`/`sortDir` match the server
  default (or the first render re-sorts). `sortBy`/`filter`/`pageSize` are
  literal unions. [MEDIUM]

## 3. RBAC on the client

- `canAccess(me.role, "ADMIN")` for feature gating; `canAccessAny` for
  "ADMIN+ or one sibling". Never `hasRank` (sibling bleed) and never
  `role === "ADMIN"` (excludes SUPER_ADMIN). [HIGH]
- Every client gate is a courtesy; the comment idiom ("the procedure
  remains the boundary") is house style. A client gate with no server gate
  behind it is reported under the API checklist as a BLOCKER. [—]

## 4. Translations (next-intl, four locales, RTL)

- **Every user-visible string goes through `t()`**: JSX text, `aria-label`,
  `title`, `placeholder`, `alt`, toast and error messages, `emptyText`,
  card and column headers. `const t = useTranslations("module")` plus
  `const common = useTranslations("common")`; server pages use
  `getTranslations`. Enum values come from the `enums` namespace. A new
  literal is HIGH. The one standing offender, `orders/[id]/order-detail.tsx`,
  is known debt: once, MEDIUM, per decisions.md; its keys already exist in
  `orders.json`, so the fix is wiring, not authoring. [HIGH / known: MEDIUM once]
- **All four locale files stay key-identical.** A key added to `en` and not
  to `fr`, `ar`, `es` renders as the key. The scanner diffs them; treat any
  drift as blocking. [BLOCKER]
- **Dynamic keys** (`t(\`status.${s}\`)`) need a message for every branch of
  `s` in every locale; check the union against the JSON. [HIGH]
- **No string concatenation of translated fragments**; use ICU parameters
  (`t("rangeOf", { start, end, total })`). Word order differs per language. [MEDIUM]
- **Dates and figures go through `i18n/formats.ts`** (`numberFormat`,
  `formatDay`, `formatDateTime`, `formatMonth`, `formatPercent`). ~40 files
  still hand-build `new Intl.NumberFormat("fr-FR", …)`; a *new* one is a
  finding, an old one in the target is LOW. `toLocaleDateString`,
  `toFixed` and a raw `toISOString().slice(0, 10)` for display are
  findings; the slice for an `<input type="date">` value and `toFixed` for
  input serialisation are not. Figures keep French grouping and dates are
  `dd/mm/yyyy` on a 24-hour clock in every language, on purpose; only month
  names follow the reader. `dateFormat` rewrites `dateStyle`/`timeStyle`
  centrally, so a call site asking for `dateStyle: "medium"` is fine — what
  is not fine is bypassing the helper. Note it renders in the viewer's zone
  while `@db.Date` values are UTC midnight: right for Tunisia (UTC+1), one
  day off west of UTC; if that ever matters, pass `timeZone: "UTC"`. [MEDIUM]
- **RTL**: stylesheets use logical properties (`margin-inline-start`,
  `inset-inline-end`, `text-align: end`, `padding-inline`). Physical sides
  are findings except on absolutely positioned décor that must not mirror,
  and the designer canvas. Directional glyphs (chevrons, arrows, "back")
  need a `[dir="rtl"]` flip; mixed LTR data inside RTL text (a reference
  number, an email) sits in `<bdi>`. [MEDIUM]
- `@repo/ui` has no translation layer: its few words come from
  `UiStringsProvider`. A new primitive that needs a word adds it to
  `UiStrings`, not a literal. [HIGH]

## 5. CSS modules and the toolkit (v3 "Glass")

- **Text colour is semantic**: `--bp-ink`, `--bp-ink-muted`, `--bp-ink-faint`,
  `--bp-accent-text`; on tints `--bp-orange-800`, on white `--bp-orange-700`.
  `color: var(--bp-neutral-…)` is the most common drift (100+ sites) and
  breaks the floor scope's inversion; `--bp-orange-500` is a fill only. [MEDIUM]
- **Font sizes are `rem`**, resolving against `--bp-text-root`. A px font
  size is invisible to the app's one type lever and is a finding; other px
  values (spacing, control heights, radii) are correct as they are. [MEDIUM]
- **Spacing is the scale**: `--bp-space-1..7` (4/8/12/16/24/32/48) and
  `--bp-gutter`. A literal `gap: 20px` is off-scale; `gap: 24px` is
  `--bp-space-5` spelled wrong. Old files are full of these; report new
  ones, and old ones only if the file is the target. [LOW]
- **Radius is the scale**: `--bp-radius-dense` 10, `--bp-radius` 14,
  `--bp-radius-block` 16, `--bp-radius-card` 20, `--bp-radius-panel` 24,
  `--bp-radius-pill`. `50%`, `999px` and `0` are fine; `7px` and `13px` are
  not. [LOW]
- **Grep `tokens.css` before trusting a token name.** `--bp-hairline-strong`,
  `--bp-success-border`, `--bp-orange-border` do not exist; an undefined
  `var()` with no fallback drops the whole declaration silently. The
  scanner checks; confirm any hit by hand. [HIGH]
- **Never hand-write a vendor prefix** (`-webkit-backdrop-filter`): Lightning
  CSS then emits only the prefixed form and Chrome 151 ignores it. [HIGH]
- **Glass goes on the wash, never behind a dense table body**, never as a
  ground. `[data-embedded]` drops a form's own panel inside a dialog. [MEDIUM]
- **Floor scope** (`data-surface="floor"`) inverts `--bp-ink*` but not the
  success/danger tints; a status card there pins its own dark ink. [MEDIUM]
- **Class composition** is `[a, b, cond && c].filter(Boolean).join(" ")`
  because module classes are `string | undefined` under
  `noUncheckedIndexedAccess`. A template literal interpolates `"undefined"`.
  A record of classes may use `!` or `?? ""`; say which and why. [LOW]
- **`.actionBtn` is a size modifier**, not a button. A bare
  `<a className={records.actionBtn}>` renders as text; wrap a `Button`
  inside the `Link`. Any class named like a component: grep its definition. [MEDIUM]
- **Touch first**: `Button`/`TextField`/`SelectField` are 48 px by default;
  `size="dense"` only in desktop toolbars and table rows; `size="floor"`
  only under the floor surface. `DataTable density="dense"` only for
  mouse-driven lists. [LOW]
- Unused classes in a module file are dead code (records.module.css carries
  13 from a production-module migration). Verify no `styles[dynamic]` use
  before calling one dead. [LOW]
- No `:root` token definitions outside `tokens.css`/`globals.css`; no
  `!important`; no raw hex outside the token files (`#fff` on a coloured
  fill is tolerated, a new brand colour is not). [LOW]

## 6. React 19 hygiene

- Effects that fetch, that copy props into state, or that run `setState`
  to "sync" are findings; derive during render, key the component, or use
  the query. [HIGH]
- `useState(() => expensive())` for expensive initial values; `useMemo`/
  `useCallback` only where a measured re-render or a stable identity for a
  dependency needs it. Unneeded memo is slop; missing deps with an
  eslint-disable is a bug. The repo has none of the latter — keep it so. [LOW]
- Keys are stable ids, not indices, on any list that can reorder or delete. [MEDIUM]
- Forms: controlled inputs, `busy` on the submit `Button` (not a label
  swap), errors through `error` state and `role="alert"`, `onDone`/`onCancel`
  props (`FormNav`) so the same form serves the page and the modal. A form
  with 15+ `useState` calls is a reducer or a form-model extraction
  candidate (LOW, but say it). [LOW]
- No `React.FC`; type props directly. No default exports outside route
  files. [LOW]

## 7. Accessibility

- Icon-only buttons carry a translated `aria-label`. [MEDIUM]
- Clickable rows and cards are `<button>`s or carry all four of
  `role="button"`, `tabIndex={0}`, `onKeyDown` (Enter/Space) and an
  `aria-label`; a focus handler that arms without the click path's side
  effects (audio priming) is the same gap. `stock/receiving/[id]/receive-scan.tsx`
  is the reference implementation to diff against. [MEDIUM]
- Inputs go through `Field`/`TextField` (label `htmlFor`) or carry
  `aria-label` in a line editor. [MEDIUM]
- Dialogs are `Dialog`/`FormDialog` over native `<dialog>` (`showModal`
  gives focus trap, Escape, inertness). A hand-rolled overlay is a finding. [HIGH]
- Live regions: errors `role="alert"`; toasts through `useToast`. [LOW]

## 8. Modal routes (`docs/form-dialogs.md`)

- A new `/x/new` or `/x/[id]/edit` route needs its `@modal/(.)x/…` twin
  wrapping the same form in `RouteModal`; the full page still renders on a
  hard load. [MEDIUM]
- `RouteModal` closes itself when `usePathname()` leaves its path; a modal
  that manages its own open state re-creates the partial-rendering trap. [HIGH]

## 9. Verification moves

```sh
pnpm --filter web lint && pnpm --filter web check-types   # next typegen runs first
# If the contract changed, build it first or the web typecheck lies:
pnpm build --filter=@repo/api-contract

# A rendering claim (token, actionBtn, RTL, column width, French label
# width) needs a screenshot; lint and tsc cannot see CSS. Both apps must be
# running (pnpm dev). One page per spec, `url|locale|js`:
TOKEN=$(bash .claude/skills/strict-review/scripts/session.sh)
node .claude/skills/strict-review/scripts/shoot.mjs "$TOKEN" 1280 /tmp/shots/clients \
  'http://localhost:3000/clients|fr' \
  'http://localhost:3000/clients|ar|document.querySelectorAll("div[role=row]")[1].click()'
# Then Read the PNGs. DataTable rows are div[role="row"] (index 0 is the
# header); dialogs are native <dialog[open]>; the top bar's "Go to…" box
# shadows generic search selectors. Console errors print at the end.
```
