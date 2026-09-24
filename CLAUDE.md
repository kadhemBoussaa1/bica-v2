# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Bicapack ERP — a kraft paper bag production ERP. Turborepo + pnpm workspaces.
Planned modules (job orders, production, stock, shipments) are not built yet; what
exists today is auth, RBAC, and the users module.

## Commands

```sh
pnpm dev                    # everything (web :3000, api :3001)
pnpm build                  # all workspaces
pnpm lint                   # eslint --max-warnings 0
pnpm check-types            # tsc --noEmit

pnpm --filter web  <script> # scope to one workspace
pnpm --filter api  <script>
```

Database (from `apps/api`, or `pnpm --filter api`):

```sh
docker compose up -d        # Postgres on host port 5433, not 5432
pnpm db:migrate             # prisma migrate dev
pnpm db:generate            # regenerate client after a schema edit
pnpm db:seed                # idempotent; creates the super admin
pnpm db:studio
```

Dev login: `admin@bica.local` / the password in `apps/api/.env`. There is no
public sign-up — every other account is created through the app.

**There are no tests and no test infrastructure.** Verification is manual: `lint`,
`check-types`, and exercising the running app. When changing behaviour, verify
against the live API (curl with a real session cookie) or a browser — not just by
reading types.

## Architecture

### tRPC owns the API surface; Nest is the DI container

There is no `nestjs-trpc` bridge and there are no Nest controllers. `TrpcRouter`
([apps/api/src/trpc/trpc.router.ts](apps/api/src/trpc/trpc.router.ts)) is an
`@Injectable()` provider that builds the router from injected services; `main.ts`
resolves it from the container and hands it to `createExpressMiddleware`. Adding an
endpoint means adding a procedure to that router literal, not a controller.

`apps/api` is built with **plain `tsc`, not `@nestjs/cli`** — the Nest CLI does not
work on TypeScript 7 (it needs a programmatic compiler API that returns in 7.1). So
`nest generate` is unavailable; create files by hand.

### Type flow

`apps/web` imports `AppRouter` as a **type only** from `api/src/trpc/trpc.router`,
so procedure inputs and outputs propagate to the client automatically. Never
hand-write a row interface on the web side to mirror a server `select` — derive it
from `inferRouterOutputs` instead, or the two silently drift.

`@repo/api-contract` holds Zod schemas and the RBAC rules shared by both sides. It
**compiles to `dist/`**, and `check-types` dependsOn `^check-types`, *not* `^build` —
so a newly added export is invisible to the apps until `pnpm build --filter=@repo/api-contract`
(or the `dev` watch task) has run. This is the most common source of a confusing
"typechecks in the package, fails in the app".

`@repo/ui` is the opposite: not compiled, exports raw `.tsx` via `"./*": "./src/*.tsx"`,
transpiled by Next. It is a component library, not a route — it has no pages.

### RBAC

Rank-based with sibling isolation, defined once in
[packages/api-contract/src/roles.ts](packages/api-contract/src/roles.ts):

```
SUPER_ADMIN 100 > ADMIN 75 > PRODUCTION 50 == MAGASINIER 50
```

PRODUCTION and MAGASINIER share a rank deliberately, so neither inherits the other's
privileges. Use `canAccess` (exact match at equal rank) for feature gating and
`hasRank` (`>=`) only where sibling bleed-through is acceptable.

Creating and managing users requires a **strictly higher** rank, except for roles in
`PEER_MANAGING_ROLES` — currently `SUPER_ADMIN`, which can create and manage its own
peers. That is a deliberate, documented weakening: every super admin can ban, demote
or delete every other one.

Better Auth is told about these roles but is **not** the authority on them; the rank
functions gate every call in `UserService`. Do not add privilege logic to the auth
plugin's access-control DSL — it would duplicate and diverge.

### Auth

Better Auth is **ESM-only** while `apps/api` compiles to CommonJS, so it is loaded
through a cached dynamic `import()` in [apps/api/src/auth/auth.ts](apps/api/src/auth/auth.ts).
It is mounted at `/api/auth/*` **before** the body parser, which it requires.

The session cookie is HttpOnly on the API origin, so the browser tRPC client must set
`credentials: "include"` — without it every request is anonymous and `me` returns null.

[apps/web/middleware.ts](apps/web/middleware.ts) redirects unauthenticated users to
`/login`. It only checks that a cookie **exists** and never verifies it: this is UX,
not authorization. The real boundary is every tRPC procedure. Note it reads a cookie
set on a different port — fine because both are `localhost`, but it breaks if the two
apps ever get different hostnames.

### Server-side list queries

Lists are paginated, sorted, filtered and searched **server-side**, split three ways:

- **Mechanics** (generic, [apps/api/src/list/list-query.ts](apps/api/src/list/list-query.ts)) —
  skip/take, orderBy, the `$transaction` that keeps rows, total and facet counts on
  one snapshot.
- **Vocabulary** (per module, e.g. [apps/api/src/user/user.list.ts](apps/api/src/user/user.list.ts)) —
  which columns sort, which fields search, which facets exist. **This file is a
  security boundary.**
- **Scope** (per request, in the service) — derived from the session, AND-ed first,
  never client-supplied.

Non-obvious rules when adding a module's list:

- `sortBy` must be a **per-module enum**, never a free string. Prisma will happily
  `orderBy` a column that is not in the `select`, leaking its values through row
  order. A column is sortable only if it is also selected.
- The client sends **keys** (`filter: "banned"`), never `where` objects. There is no
  generic `where` DSL, on purpose.
- Every sort carries an `id` tiebreaker. Without it, ties on a low-cardinality column
  have undefined order across pages and a row can appear twice or vanish.
- `total` counts scope + search + the active facet (it divides into `pageCount`);
  facet counts ignore the active facet, or selecting one chip zeroes the others.
- Facets are assumed to partition the scoped set: "all" is their sum. A facet that
  overlaps the others (clients' `duplicates`) must be listed in the declaration's
  `nonPartitioning`, or "all" over-counts.
- `contains` on an enum column is rejected by Prisma at runtime — search string
  columns only.
- Index sortable columns as `(column, id)` to match the real sort key. Booleans are
  not worth indexing. Leading-wildcard `ILIKE` cannot use a btree at all.

`DataTable` in `@repo/ui` is **controlled**: it holds no filter/sort/page state and
slices nothing. The caller owns state, debounces search (~300ms), and must reset
`page` to 1 whenever search, sort or filter changes.

## Prisma 7 specifics

Prisma 7 differs sharply from 5/6, and stale advice will break the build:

- `url` is **forbidden** in `schema.prisma`; it lives in `prisma.config.ts`.
- The generator is `prisma-client` (not `prisma-client-js`) with an explicit `output`.
- A driver adapter is required (`@prisma/adapter-pg` + `pg`).
- `.env` is not auto-loaded — hence `import "dotenv/config"`.

A stale Prisma VS Code extension will report `Argument "url" is missing in data source
block "db"` on a perfectly valid schema. Trust `prisma validate`, not the editor.

pnpm 11 no longer reads `pnpm.onlyBuiltDependencies` from `package.json`; Prisma's
postinstall is allowed via `allowBuilds:` in `pnpm-workspace.yaml`.

## UI toolkit (`@repo/ui`, v3 "Glass")

v3 (2026-09-10, from "Bicapack Toolkit v3 - Glass.dc.html" in the Claude Design
project) restyled the surfaces and kept v2's sizes and spacing:

- **Radius scale**, not one radius: `--bp-radius-dense` 10 (dense controls,
  row buttons), `--bp-radius` 14 (touch buttons, inputs, avatars),
  `--bp-radius-block` 16 (inline blocks in a panel), `--bp-radius-card` 20
  (figure tiles, small cards), `--bp-radius-panel` 24 (panels, modals, page
  header), `--bp-radius-pill` (chips, status and role badges). `--bp-radius-sm`
  is an alias of dense for old callers.
- **Glass panels**: `--bp-glass-bg/-border/-blur` + `--bp-shadow-panel` for a
  panel, `--bp-veil-*` for a block nested inside one, the ink recipe on the
  floor scope. Glass needs something behind it: it goes on the wash
  (`--bp-page` + the glows in `globals.css`), never as a ground, and never
  behind a dense table body (`DataTable` keeps a near-solid one).
- **Elevation is shadow**, hairlines are alpha ink (`--bp-hairline*`,
  `--bp-tint*`) so they read the same on every translucent surface.
- The primary `Button` is the warm gradient with a coloured shadow and the
  only element that lifts on hover; dense primaries stay flat orange.
- Avatars are squircles (never circles); status badges are pills with a
  tinted fill and a matching border.

The rules below still hold.

- Controls are **touch-first**: `Button`, `TextField` and `SelectField` are 48px by
  default. Pass `size="dense"` (36px) only for desktop toolbars and table-row
  controls — the `.actionBtn` class already does this for row actions. `size="floor"`
  (56px) is for the shop-floor tablet; wrap that screen in `data-surface="floor"` for
  the ink ground.
- Spacing comes from `--bp-space-1..7` (4/8/12/16/24/32/48) and pages use
  `--bp-gutter`; do not introduce a gap that is not on the scale.
- **Font sizes are `rem`, never px.** They resolve against `--bp-text-root`
  (tokens.css, applied by `html { font-size }` in globals.css), which is the
  one lever for the app's type size. Spacing, control heights and radii stay
  px on purpose, so bigger text never bursts a fixed-height control.
- orange-500 is a fill only. Text on tints uses `--bp-orange-800`; text on white uses
  `--bp-orange-700`. Component text colours go through `--bp-ink*`, never the neutrals
  directly, so the floor scope can invert them.
- `DataTable` turns rows into cards under 900px (`cards`, on by default), draws a
  skeleton on first load (`pending`, or `<TableSkeleton />` from the caller), dims on
  refetch (`loading`), and is `density="dense"` only for mouse-driven lists.
- New primitives: `Tabs`, `ToastProvider`/`useToast`, `EmptyState`, `Tooltip`,
  `Skeleton`. Pass `busy` to a submit `Button` instead of swapping its label.

## Translations

The web app speaks English, French, Arabic and Spanish through `next-intl`
without locale routing: the `bp-locale` cookie picks the language, the picker
in the top bar sets it (docs/i18n.md). Messages live in
`apps/web/messages/<locale>/<namespace>.json`, one file per module; enum
values are in the `enums` namespace, generic words in `common`. Every
user-facing string in a component goes through `useTranslations` /
`getTranslations` — never hard-code English in JSX. `@repo/ui` has no
translation layer: it reads its few words from `UiStringsProvider`. Arabic is
right-to-left, so stylesheets use logical properties (`margin-inline-start`,
`inset-inline-end`, `text-align: end`), never physical sides.

Dates and figures go through `apps/web/i18n/formats.ts`, never a hand-built
`Intl` formatter. Both are fixed in every language so the same sheet reads the
same to every operator: dates are `dd/mm/yyyy` on a 24-hour clock, matching
what the generated documents have always printed, and figures keep French
grouping. Only month NAMES follow the language, since a month name is a word.
`dateFormat` rewrites any `dateStyle`/`timeStyle` a caller asks for, so the
decision lives in one function. An ISO `slice(0, 10)` is correct only for an
`<input type="date">` value, never for display.

## Conventions

- **New `.md` files go in the gitignored root `docs/`.** Existing tracked READMEs stay
  where they are.
- Add every new env var to `globalEnv` in `turbo.json`, or `turbo/no-undeclared-env-vars`
  fails lint.
- `noUncheckedIndexedAccess` is on, so CSS-module classes are `string | undefined` —
  compose them with `[...].filter(Boolean).join(" ")`, not template literals.
- Throw `TRPCError` in code tRPC serves. Nest's `NotFoundException` means nothing to
  tRPC and surfaces as a 500.
- Prefer `NOT_FOUND` over `FORBIDDEN` when hiding a record the caller may not see —
  `FORBIDDEN` confirms it exists.
- `docker-compose.yml` maps Postgres to host **5433** to avoid a local 5432.
- Do not kill dev servers by name (`pkill -f node`); kill by port, and let `turbo dev`
  own its own processes rather than starting a competing detached server.
