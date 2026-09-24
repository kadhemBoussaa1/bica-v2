---
name: strict-review
description: Strict, evidence-based code review for this repo — the NestJS+tRPC+Prisma API, the Next 16 web app, and the shared contract and UI packages. Use it whenever the user asks to review, audit, check, critique, grade, or sanity-check code, a diff, a module, a folder, a PR, staged changes, "what I just wrote", or "is this ready / clean / safe / good enough"; before a commit; or whenever they mention N+1, bad queries, dead code, slop, unused code, best practices, conventions, or code quality — even casually and even without the word "review". Also use it when a feature is declared finished and the user wants a second pair of eyes. Not for writing features, fixing one named bug, or visual/UI polish (that is `impeccable`).
---

# strict-review

A review of this codebase, held to the codebase's own standard. The repo is
disciplined (no `any`, `select` everywhere, `TRPCError` everywhere, four
locales key-identical), so a useful review finds the things lint and tsc
cannot: a query count that grows with the data, a race a unique index does
not cover, a gate that admits a sibling role, a comment that no longer tells
the truth, a token that does not exist, a key missing in Arabic.

## Stance

- **Strict means every house rule is a rule**, not a preference. CLAUDE.md,
  the `docs/*-plan.md` decisions and the references here are the standard.
  Report a violation even when the code works.
- **Evidence over opinion.** Every finding names a file and line, states the
  defect in one sentence, says why it matters *here* (cite the rule or the
  failure path), gives the concrete fix, and says how you confirmed it.
  A finding you could not confirm is labelled PLAUSIBLE, never dressed up.
- **Ranked, not exhaustive.** BLOCKER and HIGH first; LOW grouped. A reader
  should be able to stop after the first screen and know whether to ship.
- **No praise, no hedging, no "consider".** If it is wrong, say what is
  right. If it is fine, say nothing — the "checked, nothing found" lines
  at the end carry the coverage.
- **Documented decisions are not findings.** `references/decisions.md`
  lists them and sets the severity of known debt; the checklists name a
  few standing cases too, and for those decisions.md wins. Misreporting a
  decision costs more than missing a LOW.
- **Both layers, every time.** A review covers the web and the API behind
  it, whatever the target names: a page is reviewed with the procedures it
  calls, a service with the pages that call it. `target.sh` widens the
  target to the other layer by itself; the report states each layer's result
  separately, and a layer with no finding says so under "Checked, nothing
  found" rather than going unmentioned. Only `--one-layer` narrows it, and
  only when the user asks for that.
- **Do not eyeball what a tool can run.** Lint, typecheck, the scanner, a
  curl against the live API, a grep across the repo — run them and paste
  the result.

## Arguments

`/strict-review [target] [flags]`

| Target | Meaning |
| --- | --- |
| *(none)* | uncommitted work: modified + untracked files (this repo has one commit, so this is everything — narrow it) |
| `--staged` | what `git add` has staged |
| `--diff <ref>` | working tree vs a branch, tag or sha |
| `--all` | the whole repo (review in module passes) |
| `clients`, `ink`, `orders`… | a module: API folder, web route, modal interceptors, message files, contract schema |
| a path or several | those files or folders |

| Flag | Meaning |
| --- | --- |
| `--quick` | skip lint/typecheck/build; scanner + reading only |
| `--fix` | after reporting, apply CONFIRMED findings whose fix is local and mechanical (see step 7) |
| `--one-layer` | do not widen to the other layer (only when the user asks for a single-layer review) |
| `--focus <area>` | `queries`, `rbac`, `i18n`, `css`, `dead`, `slop`: run the whole procedure but report only that area |

## Procedure

Work through every step. Skipping one is the usual way a review misses the
finding that mattered.

### 1. Resolve the target

```sh
bash .claude/skills/strict-review/scripts/target.sh [args]
```

Pass the whole argument list; the script swallows `--quick`, `--fix` and
`--focus` itself. It prints one file per line and, on stderr, the count,
the total lines, a router-section hint for every API module in the
target, the `# shared` files the target imports from outside itself
(read them; the scanner checks their classes and keys on the target's
behalf), and which references to load. A module target also pulls in the
contract file that defines its `create<Module>Input` schemas.

It then **widens the target to the other layer** (`scripts/layers.mjs`):
every web file's `trpc.x.y.queryOptions(`/`mutationOptions(` call adds the
API module folders behind router section `x`, and every API module in the
target adds the web files that use its router keys. The two `# other layer`
lines on stderr say what was added; copy them into the report. Above ~80
files, split into passes by module **and by layer** (one pass per API
module group, one per web area), run the API and web passes in parallel,
and merge them into one report; say so in the report.

### 2. Read whole files and their neighbours

Read every target file end to end, not the hunk: an N+1 is a loop in one
function calling a helper defined two screens up. Then read what the
target *talks to*, because most real defects sit at a seam:

- a service → its section of `apps/api/src/trpc/trpc.router.ts` (the gate)
  and its `*.list.ts`; the model in `apps/api/prisma/schema.prisma`
- a procedure → the table/form/panel that calls it in `apps/web/app/<module>/`
- a component → the message files of every namespace it passes to
  `useTranslations` (its own module, `common`, `records`, `enums`), the
  shared pieces `target.sh` lists under `# shared`, and any `--bp-*` token
  it uses (`packages/ui/src/styles/tokens.css`, plus the layout tokens in
  `apps/web/app/globals.css`)
- a contract schema → both the service that consumes it and the form that
  builds it
- a `.list.ts` → the module `SELECT` and the model's `@@index` lines

### 3. Run the scanner

```sh
bash .claude/skills/strict-review/scripts/target.sh [args] | node .claude/skills/strict-review/scripts/smell-scan.mjs
```

Every printed line is a **candidate**: open it, then either confirm it as
a finding or dismiss it in your notes with the reason (the scanner trades
precision for recall on purpose). Each section ends with a `# checked …`
line saying what it covered, so `(none)` means "checked, clean", and a
section that could not run says so. Repeated notes in one file are
collapsed after three; they are one finding. Its sections: type escapes and debris;
API query shape (unbounded reads, loops that query, transactions using
the outer client, I/O inside a transaction, Nest exceptions, FORBIDDEN);
web (client/server misplacement, effects that fetch, whole-cache
invalidation, hand-built formatting, literal English, RBAC by string,
`<img>`, index keys, Next 16 async APIs); CSS (physical sides, vendor
prefixes, off-scale spacing, undefined tokens, neutral-ramp text colour,
unused classes); i18n (locale key drift, `t("key")` that does not resolve,
unreferenced keys); dead exports (whole-repo index); env vars, contract
re-exports, Zod idioms, sortable-column ⊆ select, `(col, id)` indexes,
foreign keys without an index.

### 4. Walk the checklists

Load `references/slop.md` and `references/decisions.md` always, plus the
ones `target.sh` named:

- `references/api.md` — gates and scope, query shape, list modules,
  transactions and races, errors and audit, Nest wiring, Prisma 7
- `references/web.md` — server/client boundary, queries and cache, client
  RBAC, translations and RTL, CSS tokens and toolkit, React 19, a11y,
  modal routes
- `references/contract.md` — api-contract build and Zod 4, `@repo/ui`
  contract, schema and migrations, turbo env

Go item by item against the target. For the deep checks, **trace the
path and write the numbers down**: router gate → service method → each
Prisma call, with the query count per request for a list page and for a
mutation; for a scope, the `list` predicate beside the `byId` predicate;
for a race, the two interleavings that break it; for a token, the line in
`tokens.css` that defines it or does not.

### 5. Verify with tools (skip only under `--quick`)

```sh
# contract touched? build it first or the app typecheck lies
pnpm build --filter=@repo/api-contract
pnpm --filter api lint && pnpm --filter api check-types
pnpm --filter web lint && pnpm --filter web check-types
```

Paste failures verbatim. For a behavioural claim (a scope leak, a facet
that over-counts, a missing `page: 1` reset), prefer a real read-only
call: `scripts/session.sh` signs in and prints the token, then `curl -G`
the procedure with the bare input object (the exact recipe is in
`references/api.md` §8). Never write to the dev database to prove a
finding; quote the two code paths instead. A rendering claim (token,
`actionBtn`, RTL, column width) needs a screenshot — `scripts/shoot.mjs`
takes one per page and locale (`references/web.md` §9) — or is PLAUSIBLE.

### 6. Classify and rank

**Confidence**: `CONFIRMED` — you executed the failing path, a tool said
so, or you quoted the two lines that contradict each other. `PLAUSIBLE` —
reasoned from reading, not executed. Say which.

**Severity**:

| Level | Meaning here |
| --- | --- |
| BLOCKER | data loss or corruption, a privilege or scope leak, a race on money/stock/counters, an unbounded read on a growing table, a secret in a log, a broken build or DI wiring |
| HIGH | wrong behaviour a user will hit: N+1 on a list, a missing invalidation, a missing locale key, a drifted row type, a `select`-less write that leaks columns, an unverified comment on a changed rule |
| MEDIUM | a house rule broken in a way lint cannot see: wrong error code, physical CSS side, `hasRank`, `include`, findFirst without order, hand-built formatter, missing `aria-label` |
| LOW | slop, dead exports, unused classes or keys, off-scale spacing, size and naming |

Cap the report at ~25 findings. Beyond that, group the rest of LOW by
kind with counts and one example each, and say the review was capped.

### 7. `--fix` (only when asked)

Apply CONFIRMED findings whose fix is **local and mechanical**: delete dead
code, drop an `export`, add a `select`, replace a token or a literal
colour, wrap a string in `t()` and add the key to all four locales, add
`page: 1`, target an invalidation, add an `aria-label`, add `.max()`.
Never change a business rule, a gate, a transaction boundary, a schema, or
anything decisions.md covers. Rerun step 5 afterwards and report what was
applied and what was left with why.

## Report

Write for someone who did not watch you work. Lead with the verdict.

```
## Verdict: NOT READY — 2 blockers, 3 high        (or: READY with 4 low notes)
Target: clients module (15 files, 1 502 lines). Layers: web 9 files · API 6 files (other layer: +client module, +3 callers). Tools: lint ✓ check-types ✓ scanner ✓ (a1b2c3d4) · live API ✓ · screenshots ✓ (fr, ar)
   (under --quick:)                              Tools: scanner ✓ (a1b2c3d4) · lint/check-types not run (--quick) · live API – · screenshots –
   The scanner prints its build id on its first line; record it, so a rerun can tell whether a candidate came from an older build.

### BLOCKER
1. **Scope not applied on byId** — apps/api/src/order/order.service.ts:262
   `list` ANDs `scopeFor(actor)`; `byId` queries by id alone, so PRODUCTION can open a DRAFT by URL.
   Fix: `where: { AND: [{ id }, this.scopeFor(actor)] }` and NOT_FOUND on miss, as `assertLifecycleExists` does at :990.
   CONFIRMED — curl as production@bica.com returned the draft.

### HIGH
2. **N+1 on the receipt lines** — apps/api/src/purchasing/purchasing.service.ts:823
   One `update` per order line inside the loop: 1 + N queries per receipt (N = 14 on PO-260031).
   Fix: … 
   PLAUSIBLE — counted from the code; not run.

### MEDIUM
…
### LOW (grouped)
- 7 off-scale spacing values in orders.module.css (e.g. :12 `gap: 20px` → `--bp-space-5`)
- 3 exported types with no importer: OrderFormValues, OrderInvoiceRef, OrderShipmentRef

### Checked, nothing found
API: RBAC gates and scope · transactions and counters · dead exports (API)
Web: locale key parity (4/4) · undefined tokens

### Dismissed candidates
scanner: findMany without take at client.service.ts:102 — reference data, comment states the bound (decisions.md)
```

Rules for the write-up: the verdict line counts both layers, and each
finding's file path shows which layer it is in; one finding per numbered item; file:line on the
first line; the fix is concrete enough to apply without re-deriving it;
"Dismissed candidates" lists every scanner line you rejected with the
reason, so the next reviewer does not redo the work; nothing about how
hard the review was.

## Calibration — things that look like smells and are not

- Long "why" comments citing a plan doc: house style. Only a comment that
  restates the code or has gone stale is a finding.
- French domain nouns (`numero`, `grammage`, `metrage`, `poids`, `devise`):
  the vocabulary, not a naming slip.
- Offset pagination with `skip`/`take`: the house mechanic, with the `id`
  tiebreaker.
- `updateMany` + count check instead of `findUnique` + `update`: the house
  race guard, not clumsiness.
- Two `SELECT` constants for one model: privilege-varying shapes, correct.
- `{} as Record<Facet, number>` accumulators, `as Role` on session output:
  the documented escapes.
- `"use client"` on `@modal/(.)…/page.tsx`; no directive on a shared
  client leaf; the locale server action.
- Un-narrowed `queryKey()` in invalidations: prefix match, intended.
- Whole-table reads of reference data with a comment stating the bound.
- Everything in `references/decisions.md`.

## Version notes — trust the installed docs over memory

Next 16.3 (App Router, Turbopack, async request APIs, `proxy.ts`),
React 19.2, TanStack Query 5 with `@trpc/tanstack-react-query`
(`queryOptions`/`mutationOptions`/`queryKey`), tRPC 11, Zod 4
(`z.email()`, array literals), Prisma 7 (driver adapter, `prisma-client`
generator, no `url` in the schema), NestJS 12 as a DI container only,
TypeScript 7 built with plain `tsc`, pnpm 11, next-intl 4 without locale
routing. When a rule from memory conflicts with
`apps/web/node_modules/next/dist/docs/`, the docs win and get cited.
