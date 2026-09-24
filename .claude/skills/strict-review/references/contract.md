# Contract and packages checklist — `@repo/api-contract`, `@repo/ui`, `schema.prisma`

Load this when the target touches `packages/` or the Prisma schema. These
files sit under both apps, so a mistake here is paid twice and a missing
export is invisible until a build.

## 1. `@repo/api-contract` (Zod 4, compiled to `dist/`)

- **A new export must be reachable from `src/index.ts`** (`export * from
  "./file"`). The apps import the package, not the file. [HIGH]
- **The package compiles to `dist/`, and `check-types` does not build it
  first.** After any contract edit, run `pnpm build --filter=@repo/api-contract`
  before trusting an app's typecheck; a review that skips this can report a
  green typecheck against a stale `dist/`. Say in the report that you ran it. [—]
- **Zod 4 idioms**: `z.email()` not `z.string().email()`; `z.literal([10, 25, 50, 100])`
  takes an array; `.default()` values are typed. Advice written for Zod 3
  will fail lint or types here. [MEDIUM]
- **Bounded inputs**: every text field has `.max()` (ids are cuids and are
  exempt), every number is `.int()`, `.finite()`, `.min()`/`.nonnegative()`
  as the domain needs; `search` is capped at 200 and trimmed to `undefined`
  in `listQueryBase`. An unbounded string in a create/update schema is a
  storage and log-size hole. [MEDIUM]
- **Enum literals are derived, not repeated**: `roleSchema`/`ROLES` for
  roles, the model's status list for statuses. A second `z.enum(["SUPER_ADMIN", …])`
  drifts the day a role is added (`schemas.ts` still has two of these;
  a new one is a finding). [MEDIUM]
- **Update schemas are three-valued** for any field the form renders and can
  empty: `clearableText`/`clearableDate` (`undefined` = leave the column,
  `null` = clear it, value = write it). `optionalText` folds `""` into
  `undefined` and cannot express "clear"; in an `update*Input` it silently
  keeps stale data. The service side splits `writable()` for create (`?? null`)
  from `writableUpdate()` (write only when `!== undefined`). [HIGH]
- **The client sends keys, never `where`**: `sortBy` and `filter` are enums
  extended per module from `listQueryBase`; `ListResult` is an interface,
  not a schema, so inference flows from the resolver. Do not add output
  schemas. [HIGH]
- **Pure domain logic lives here when both sides need it** (`order-lifecycle.ts`
  transitions, `pricing.ts`, `invoiceTotals`, `withMention`). A rule
  duplicated in a service and a form is a finding; the contract is where it
  goes. [MEDIUM]
- Unused exports in a library are LOW, not noise: a schema type nobody
  imports (`AcceptQuoteInput`, `signInInput`) is dead. [LOW]

## 2. `@repo/ui` (raw `.tsx`, transpiled by Next)

- Exports are `"./*": "./src/*.tsx"`; a new primitive is a new file, not a
  barrel entry. No pages, no routes, no data fetching. [MEDIUM]
- **No translation layer**: words come from `UiStringsProvider` / `UiStrings`.
  A literal English string in a primitive is a finding unless it is the
  documented fallback in `strings.tsx`. [HIGH]
- **`DataTable` is controlled**: it holds no filter/sort/page state and
  slices nothing. Any change that makes it own state, or slice rows, or
  read a default from props once, breaks every caller's server-side paging. [BLOCKER]
- `DataTable` conventions to keep: `pending` (first load, skeleton) vs
  `loading` (refetch, dim); `cards` on by default under 900 px; `toolbar`,
  `flush`, `emptyText`, `renderBody` props; it emits `page: 1` on search,
  sort and filter changes. [HIGH]
- Primitives read colours from `--bp-ink*` and sizes from the radius and
  spacing scales; `Button` variants: primary is the warm gradient and the
  only element that lifts on hover, dense primaries stay flat. [MEDIUM]
- Avatars are squircles; status and role badges are pills with tinted fill
  and matching border. [LOW]
- A primitive exported but unused by the app (`Tooltip`, `CellDate`…) is a
  library affordance, not dead code — LOW, mention once. [LOW]

## 3. `schema.prisma` and migrations

- Every sortable list column has `@@index([col, id])` (or `[active, col, id]`);
  foreign keys used in `where`/joins have an index; unique business keys
  (`name`, `numero`, `matricule`) are `@unique` so the service's
  "assert free" is a message improvement, not the guard. [MEDIUM]
- **`Float` for money and quantities is the decision**; `Int` for counts
  and millimetre dimensions. Do not propose `Decimal`. [—]
- Nullable columns must have a reason (legacy import gaps are documented
  in `docs/legacy-migration.md`); a new required column on a populated
  table needs a backfill in the migration. [HIGH]
- `onDelete` is explicit on new relations; archiving (`active: false`) is
  the house delete for reference data, so a `Cascade` on a business record
  is suspicious. [HIGH]
- Enums that are really lookup tables (supplier families) stay tables; a
  new `enum` that operators will want to extend is a finding. [MEDIUM]
- Migration files are never edited after apply (checksum); fix forward. [HIGH]
- `Order.metrageNecessaire` is a computed snapshot column; changes to the
  formula need a backfill decision, not a silent recompute. [MEDIUM]

## 4. `turbo.json`, env, tooling

- Every `process.env.X` is in `globalEnv` (or a task's `env`), or
  `turbo/no-undeclared-env-vars` fails lint. `NEXT_PUBLIC_` only for values
  the browser may see. [HIGH]
- No new dependency without a reason in the report; pnpm 11 build scripts
  are allow-listed in `pnpm-workspace.yaml` `allowBuilds`. [LOW]
- The API builds with plain `tsc` (CommonJS); Better Auth is ESM-only and is
  loaded through the cached dynamic `import()` in `auth/auth.ts`. A static
  `import from "better-auth"` in the API breaks the build. [BLOCKER]
- New `.md` notes go in the gitignored root `docs/`, not beside the code. [LOW]
