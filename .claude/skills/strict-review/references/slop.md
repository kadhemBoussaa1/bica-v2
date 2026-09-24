# Cross-cutting checklist — slop, dead code, structure, types, errors

Always loaded. These apply to every file in the target regardless of
workspace.

## 1. What "slop" means here

This repo comments heavily, and that is house style: a doc comment on every
non-obvious decision, explaining *why*, often citing `docs/*-plan.md`. So
the test for a comment is not length, it is content:

- **Keep**: explains a why, a trap, a rejected alternative, a business
  rule, a scale assumption, an invariant the type system cannot state.
- **Slop**: restates the next line (`// increment the counter`), narrates the
  obvious (`// loop over the rows`), announces a section (`// ---- helpers ----`
  is fine, `// Here we handle the case where…` is not), apologises, or
  describes a process ("first we…, then we…") instead of a reason. [LOW]
- **Stale**: describes behaviour the code no longer has. A change that
  alters a documented behaviour without updating its comment is a finding
  at the severity of the behaviour, because the next reader trusts the
  comment. [MEDIUM]

Other slop signatures, each LOW unless it hides a bug:

- Generic names: `data`, `item`, `result`, `handleData`, `processItems`,
  `utils.ts`, `helpers.ts`, `misc`. Domain names exist for everything here
  (roll, order, run, receipt, allocation) — and French domain nouns
  (`numero`, `grammage`, `metrage`, `poids`, `devise`, `matricule`) are the
  house vocabulary, not a smell.
- Defensive code against states the types or Zod already exclude: `if (!input)`
  after a parsed input, `?? ""` on a non-nullable, `Array.isArray` on a typed
  array, `try/catch` around code that cannot throw.
- Ceremony: `async` with no `await`, `return await`, a one-use helper
  three lines from its only caller, a wrapper that renames a function, a
  constant for a value used once, `Array.from(new Set(x))` where a `Set`
  would do, `JSON.parse(JSON.stringify())` cloning.
- Vague error handling: `catch (e) { throw new Error("Something went wrong") }`,
  a `catch` that logs and continues inside a mutation, `.catch(() => {})`.
- Naming that markets: `Enhanced`, `Improved`, `New`, `V2`, `Smart`, `Helper`
  in an identifier; emoji in code or comments; "TODO" with no owner or ticket.
- A JSDoc longer than the function on a trivial getter; `@param` lines that
  repeat the type.
- Over-abstraction: a generic factory with one instantiation, an options
  object with one key, a hook that wraps one `useState`.

## 2. Dead code — verify before you call it dead

- **Exports nobody imports**: the scanner lists them from a whole-repo
  index. Confirm with a grep that includes `packages/` and `apps/` and
  excludes the defining file; then decide: delete, or drop `export`.
  Exceptions: Next route conventions (`metadata`, `config`), list
  vocabulary constants (`*_SORT_KEYS`, documented as the security
  boundary, LOW), `@repo/ui` primitives (library affordance, LOW). [LOW]
- **Unused CSS classes**, unused translation keys (the scanner finds both;
  a translation key may be built dynamically — check the template-literal
  uses), unused props (an interface field no caller passes), unused
  parameters (prefix `_` or remove), unreachable branches after Zod
  narrowing or an exhaustive `switch`. [LOW]
- **Commented-out code and leftover flags**: the repo has none; any new
  block is a finding. [LOW]
- **Duplicate helpers across modules**: a second `formatDate`, a second
  `round2`, a second "is this reachable" predicate. The fix names where
  the shared one lives (`i18n/formats.ts`, `records/partner-ui.tsx`,
  `@repo/api-contract`). [MEDIUM]
- **Orphan message keys with a hard-coded twin**: keys exist in the JSON
  and the component hard-codes the English. Report once as an i18n
  finding, not as dead keys: HIGH for a new component, MEDIUM once for the
  known `order-detail.tsx` case (decisions.md sets the severity of known
  debt). [HIGH / known: MEDIUM]

## 3. Structure and size

- One concern per file: `x.service.ts` + `x.list.ts` on the API; `page.tsx`
  + `x-table.tsx` + `x-form.tsx` + `x-panel.tsx` + `x-ui.tsx` on the web. A
  file that mixes a table, a form and a detail view is a split candidate;
  the repo has 17 files over 400 lines and forms with 20+ `useState` — say
  it once, LOW, with the seam you would cut at. [LOW]
- Functions do one thing at one altitude: a function that validates, then
  queries, then formats, then renders is three. Positional parameters past
  three become an object. Boolean parameters that change behaviour
  (`load(id, true)`) become named options. [LOW]
- Module boundaries: a service imports another service, not another
  module's `.list.ts` scope; a web module imports another module's `*-ui.tsx`
  exports, not its table internals. [MEDIUM]

## 4. Types

- `any`, `as any`, `as unknown as`, `@ts-ignore`, `@ts-expect-error`, and
  non-null `!` each need a one-line reason at the site, or a fix. The repo
  has near-zero of these; the documented ones (`as Role` on Better Auth
  output in `main.ts`, the confined widening in `stock.service.ts`) are the
  model. [MEDIUM]
- `noUncheckedIndexedAccess` is on: index access is `T | undefined`; handle
  it, do not assert it away without saying why. [MEDIUM]
- Types flow from the source of truth: Prisma `select` → resolver return →
  `AppRouter` → `inferRouterOutputs` → component. Any hand-written type
  along that chain is drift. `satisfies Prisma.XSelect` on select
  constants keeps the row type narrow. [HIGH]
- Prefer unions of literals over `string`, `readonly` arrays for
  vocabularies, `as const` on key lists, discriminated unions over optional
  bags. [LOW]

## 5. Errors and logging

- Errors carry a code and an operator-readable message naming the record.
  User-facing text on the web is translated; server messages are still
  English (known gap) and are shown as-is — do not flag that, do flag a new
  web component that hard-codes its own English *around* one. [MEDIUM]
- Logs: `console.error("[module] what failed", cause)`; never a secret, a
  password field, a session token, a full request body. `console.log`
  outside CLI scripts is a finding. [MEDIUM]
- Swallowed errors, retried side effects, and "best effort" writes need a
  comment stating the consequence of the failure (the audit write is the
  model: logged, never fails the request). [MEDIUM]

## 6. Security (cross-cutting)

- Input reaches the database only through Zod and Prisma; raw SQL only as
  tagged templates or `Prisma.sql`. [BLOCKER]
- Anything user-controlled that ends up in a header (`Content-Disposition`
  file names), a URL, an S3 key or a shell argument is escaped or
  allow-listed. [HIGH]
- Uploads: content type and size validated server-side (`assertUploadable`),
  presigned URLs short-lived, keys not guessable, the record that references
  the asset checks ownership (`assertOwnAsset`). [HIGH]
- No secrets in code, in `NEXT_PUBLIC_`, in the audit row or in a log. [BLOCKER]
- Session, CSRF and CORS are Better Auth's and `main.ts`'s; the JSON-only
  content type on the preview route is the CSRF defence — do not relax it. [BLOCKER]
