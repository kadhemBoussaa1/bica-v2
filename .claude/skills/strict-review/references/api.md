# API checklist — NestJS 12 + tRPC 11 + Prisma 7 (`apps/api`)

Load this when the target touches `apps/api/`. Each item says what to look
for, why it matters *in this codebase*, and how to confirm it. Severity in
brackets is the default; raise it when the blast radius is larger.

The API is disciplined: `select` everywhere, `TRPCError` everywhere, no
`any`, no Nest exceptions, no unsafe raw SQL. That means the findings that
matter are the subtle ones — a query count that grows with the data, a
race the unique index does not cover, a gate that admits a sibling role.
Read the code path, not just the diff hunk.

## 1. Gates and scope (RBAC)

- **Every procedure descends from a named gate** in `src/trpc/trpc.ts`:
  `adminProcedure`, `superAdminProcedure`, `shopFloorProcedure` (ADMIN+ or
  PRODUCTION), `warehouseProcedure` (ADMIN+ or MAGASINIER),
  `orderModuleProcedure` (all three), `protectedProcedure` (any signed-in
  user). `publicProcedure` is for `health` and `me` only. [BLOCKER]
- **Pick the gate by who owns the feature, not by rank.** PRODUCTION and
  MAGASINIER share rank 50 and must not reach each other's procedures. A new
  `roleProcedure("PRODUCTION")` is fine; `hasRank` anywhere in a gate is not.
  Confirm by reading `canAccess` vs `hasRank` in `packages/api-contract/src/roles.ts`. [BLOCKER]
- **The actor comes from `ctx.user`, never from input.** Services take
  `actor: SessionUser` as their first parameter. An `input.userId`,
  `input.role` or `input.actorId` used for authorisation is a hole (the one
  legitimate `input.role` is the *target* role in `UserService`, checked
  against `actor.role`). [BLOCKER]
- **Scope is built in the service and AND-ed first.** A `scopeFor(actor)`
  returning a `Prisma.XWhereInput` goes into `runListQuery({ scope })` and
  into every `byId`/`findFirst` as `{ AND: [{ id }, scope] }`. A `byId` that
  ignores the scope a `list` applies lets a user open by URL what the list
  hides. Confirm by comparing the two methods. [BLOCKER]
- **Privilege-varying shapes are two `select` constants**, chosen before the
  query (`ROLL_SELECT` vs `ROLL_SELECT_PRICED` by `canReadPricing(actor)`), so
  an unauthorised column is never fetched. Filtering the row afterwards is
  wrong: the value still crossed the wire from Postgres and may leak
  through sort order. [HIGH]
- **Hidden rows are `NOT_FOUND`, not `FORBIDDEN`.** `FORBIDDEN` is reserved
  for rank-gate refusals (the gate itself, `UserService`, `ShipmentService.ship`).
  A `FORBIDDEN` on a lookup confirms the record exists. [MEDIUM]
- **Client-side gating is UX only.** If a web change adds a `canAccess`
  check with no matching server gate, the server is the finding, not the UI. [BLOCKER]

## 2. Query shape

- **`select`, never `include`.** `include` pulls every column of the related
  row, including ones the caller may not see. The house has one `include`
  and it is in a CLI script. [HIGH]
- **Every write returns a small `select`** (`RETURN_SELECT = { id, name,
  active }`) so the client can patch its cache without receiving the whole
  model. A discarded return may skip it, but say so in a comment. [LOW]
- **Bounded reads.** A `findMany` with no `take` must be over a set that is
  small *by nature* (supplier families, document templates, the machines of
  one order) and the comment should say so. A whole-table read of a growing
  table (orders, rolls, audit rows, chat, invoices, production runs) is a
  finding. Known standing case: `ClientService`/`SupplierService` load every
  active row on every list page for the look-alike scan (`list/look-alikes.ts`
  is O(n²)); the comment accepts "hundreds". Flag any *new* whole-table load
  or any new caller of `lookAlikes()`. [HIGH]
- **N+1 in any of its costumes.** A query inside `for`/`forEach`/`map`, a
  `Promise.all(rows.map(r => prisma…))` (parallel, still N round trips), a
  helper called per row that queries, or a per-row tRPC query on the web
  side. The fixes, in order of preference: one `findMany({ where: { id: { in } } })`
  plus a `Map`; a nested `select` on the parent; `createMany`/`updateMany`;
  a `$transaction([...])` batch of independent queries. Count the queries per
  request and write the count in the finding. Current per-row writes the
  house tolerates because each row carries a distinct value:
  `purchasing.service.ts` order-line updates, `stock.service.ts` slit
  children (returned to the caller), `invoice.service.ts` line updates. A
  new loop should meet that bar or be batched. [HIGH]
- **`findFirst` needs an `orderBy`** unless the `where` is unique (by id +
  scope) or it is an existence check with `select: { id: true }`. Without
  one, "first" is whatever Postgres returns. [MEDIUM]
- **Hand-rolled pagination needs the `id` tiebreaker**; `runListQuery` adds
  it, a direct `findMany({ skip, take, orderBy })` must add `{ id: "asc" }`
  itself. [HIGH]
- **Aggregation belongs in SQL.** Loading rows to sum, count or group them in
  JS is a finding when Prisma `aggregate`/`groupBy` or a tagged raw query can
  do it. Exception: a computation Prisma cannot express (the look-alike scan,
  per-currency conditional sums) — then the comment must say why. [MEDIUM]
- **`contains` only on `String` columns.** Prisma rejects it on an enum at
  runtime, which lint and tsc cannot see. Check the model field type. [HIGH]
- **Leading-wildcard `ILIKE` is accepted at admin scale** (documented in
  `list-query.ts`). Flag it only when a new search lands on a table that
  will not stay small (audit log, chat). [LOW]

## 3. List modules (`*.list.ts` is a security boundary)

- `sortBy` is a `z.enum` over the module's keys; `filter` is a `z.enum` over
  facet keys plus `"all"`. Never a free string, never a `where` object. [BLOCKER]
- **Every sortable column is in the module `SELECT`.** Sorting by an
  unselected column leaks its values through row order. Compare the two
  constants by hand; the scanner does too. [BLOCKER]
- **Every sortable column has an index ending in `id`**: `@@index([col, id])`,
  or `@@index([active, col, id])` when the fragment leads with `active`.
  Check `schema.prisma` for the model. Booleans alone are not worth an index. [MEDIUM]
- **Facets partition the scoped set**, or the overlapping one is listed in
  `nonPartitioning`, or the "all" chip over-counts. Reason about the
  predicates: do any two facets admit the same row? [HIGH]
- The scope cannot say `active: true` if `archived` is a facet (the two
  would AND to nothing); read the comment in `ClientService.list` for the
  pattern. [HIGH]
- `total` counts scope + search + active facet; facet counts ignore the
  active facet. A module-level `aggregate` must be a `PrismaPromise` array
  (a plain `Promise` typechecks and throws inside `$transaction`). [HIGH]
- Period scopes go through `list/period.ts`; day strings are parsed as
  explicit UTC midnight (`${date}T00:00:00.000Z`). A bare `new Date("2026-09-01")`
  on a *timestamp* column shifts with the server's zone. [MEDIUM]

## 4. Transactions and races

- **The house pattern for a guarded write is conditional-then-count**:
  `updateMany({ where: { id, status: "DRAFT" } })` and `if (count !== 1) throw CONFLICT`,
  or `update({ where: { id, status } })` and catch `P2025`, or
  create-and-catch-`P2002` when a unique index backs it. Read-then-write on
  a balance or a status (`findUnique` then `update` with `stock - qty`) is a
  race; `InkService` shows the conditional decrement (`stock: { gte: quantity }`). [BLOCKER]
- **Check-then-create needs a unique index** or a transaction. A new one
  is HIGH. Known standing case (decisions.md, LOW once):
  `ProductService.create` does `findFirst` then `create` with no unique
  constraint on the pair it checks. `assertNameFree` in clients/suppliers
  is fine because `name` is `@unique` and the check only improves the
  message. [HIGH / known: LOW once]
- **Counters are single atomic statements** (`INSERT … ON CONFLICT DO UPDATE … RETURNING`
  in tagged raw SQL, `allocateNumero`, `roll-math.ts`). A JS `max + 1` is a
  duplicate waiting for two clicks. [BLOCKER]
- **Inside `$transaction(async (tx) => …)` use `tx`, never `this.prisma`.**
  Helpers that must run inside take `tx: Prisma.TransactionClient` (or the
  module's `Db` alias) as their first parameter; look at what the callee
  receives. [BLOCKER]
- **No network I/O inside a transaction**: Better Auth (`getAuth`,
  `auth.api.*`), S3 (`getSignedUrl`), PDF rendering, `fetch`. The default
  interactive timeout is 5 s and a held connection blocks the pool. A tx that
  calls another service's method (`orders.transition` from `ShipmentService.ship`)
  must pass `tx` through and stay short; if it grows, set `timeout`. [HIGH]
- **Independent reads go in the array form** `$transaction([a, b, c])`:
  one connection, one snapshot, no interactive handle. Prefer it for a page
  plus its counts, for stats strips, for nav counts. [MEDIUM]
- **Cross-boundary writes cannot be atomic**: `UserService.create` calls
  Better Auth then updates the row. Accept it, but the order must leave a
  recoverable state (auth user created, role default) rather than a dangling
  one. [MEDIUM]

## 5. Errors, audit, logging

- **`TRPCError` with a code, always.** Nest's `NotFoundException` and a bare
  `Error` both surface as a 500. Codes in use: `BAD_REQUEST` (input that
  passed Zod but fails a business rule), `NOT_FOUND`, `PRECONDITION_FAILED`
  (workflow state refuses the action), `CONFLICT` (unique or optimistic
  loss), `FORBIDDEN` (rank gate only), `UNAUTHORIZED` (no session). Pick the
  same one the neighbouring code picks for the same situation. [HIGH]
- **Messages are operator-readable and name the row** (`"Roll R-1204 has
  not been received yet — scan it in first"`). They are still English (a
  known gap, see decisions.md); do not flag that, but do flag a message that
  says nothing ("Invalid input", "Something went wrong"). [LOW]
- **Every `protectedProcedure` is audited.** `.meta({ audit: false })` needs
  a comment saying why (the accepted ones: `audit.list`, `audit.actors`,
  `nav.counts`, `chat.unread`/`markRead`). New opt-outs are findings. [HIGH]
- **Secrets never reach the audit row or a log.** `audit.util.ts` `redact`
  strips password-like keys; a new input carrying a secret under a new key
  name must be added there. `console.error("[module] …", cause)` is the
  logging idiom; `console.log` is for CLI scripts under `migrate/`, `seed.ts`,
  `audit/purge.ts` only. [HIGH]
- **Empty `catch` swallows.** The one accepted bare catch is `getRawInput`
  in the audit middleware, and it is commented. [MEDIUM]

## 6. Nest specifics (the container, not the framework)

- A new service is `@Injectable()`, takes `private readonly prisma: PrismaService`
  (and sibling services) through the constructor, and is **registered in
  `AppModule.providers`** — forgetting that is a runtime DI error, not a
  compile error, and `check-types` will not catch it. Confirm the array. [HIGH]
- No controllers, no `nest generate`, no `@nestjs/cli` (TypeScript 7). The
  router literal in `trpc.router.ts` is the API surface. Files are created by
  hand and imported explicitly. [MEDIUM]
- Router procedures **delegate in one expression**. A handler that reads
  `ctx.prisma`, branches on business state, or spans more than a few lines
  belongs in the service where the scope and the transaction live. [MEDIUM]
- Module-level mutable state in `main.ts` (the `previewing` set) is
  per-process and acceptable for a single instance; a new one that assumes
  a single process should say so. [LOW]
- `PrismaService` connects in `onModuleInit` and disconnects in
  `onModuleDestroy`; `app.enableShutdownHooks()` makes the latter run. A new
  long-lived client (S3, a worker) should follow the same lifecycle. [LOW]

## 7. Prisma 7 and the schema

- No `url` in `schema.prisma` (it is in `prisma.config.ts`); generator is
  `prisma-client` with an explicit `output`; the client is imported from
  `../generated/prisma/client.js`. Advice that says otherwise is for Prisma 5/6. [HIGH]
- A schema edit ships with a migration **and** `db:generate`; a migration's
  header comment must not be edited after it is applied (checksum drift). [HIGH]
- **Float for money and quantities is a decision** — do not propose
  `Decimal`. What *is* reviewable: a `===` on a computed float (parcel
  counts from `Math.ceil` are integers and fine), and a persisted sum with no
  rounding step where a display or an invoice total will be compared. The
  contract's `invoiceTotals` leaves rounding to display on purpose. [MEDIUM]
- Foreign-key columns used in `where`, joins or cascades want an index;
  Postgres does not create one. Relation columns without `@@index` are LOW
  unless they sit on a hot path. [LOW]
- `@db.Date` columns hold UTC midnight; slicing `toISOString()` is then
  correct **for an input value** (`<input type="date">`). For display it is
  still a finding: the web renders dates through `formatDay`, never a raw
  ISO slice. On a timestamp column the slice is a timezone bug. [MEDIUM]

## 8. Verification moves for this workspace

```sh
pnpm --filter api lint && pnpm --filter api check-types

# Behavioural claim? hit the live API with a real session. session.sh signs
# in with the super admin from apps/api/.env (SUPER_ADMIN_EMAIL/_PASSWORD)
# and prints the token; the jar path is on stderr.
TOKEN=$(bash .claude/skills/strict-review/scripts/session.sh)   # jar path on stderr
# Queries: -G with the BARE input object (no superjson {"json":…} envelope —
# that wrapper strips every field and the call "succeeds" on defaults):
curl -s -G -b "$JAR" --data-urlencode 'input={"page":1,"pageSize":10,"sortBy":"name","sortDir":"asc","filter":"all"}' \
  http://localhost:3001/trpc/client.list | jq .result.data
# Mutations: POST the bare object as JSON. An error response has no `result`
# key — print the raw body when a check "fails". pageSize must be a PAGE_SIZES
# literal. Second account for role checks: production@bica.com.
# Do not write to the dev database to confirm a finding unless the user
# says so: confirm by quotation or by a read-only call.

# Query count: DEBUG=prisma:query on the api dev process, or read the code
# path and count — write the number in the finding either way.
```
