#!/usr/bin/env node
/**
 * strict-review smell scan.
 *
 * A deterministic sweep over the target files. Everything it prints is a
 * CANDIDATE the reviewer must open and confirm, not a finding: the regexes
 * trade precision for recall on purpose, because a reviewer who is handed a
 * short list of places to look is far more reliable than one asked to notice
 * an N+1 loop on page 40 of a diff.
 *
 * Usage:
 *   node smell-scan.mjs <file>...          # explicit files
 *   target.sh clients | node smell-scan.mjs  # from stdin
 *
 * Zero dependencies. Sections print "(none)" when empty so coverage is visible.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const SCAN_VERSION = createHash("sha1").update(fs.readFileSync(fileURLToPath(import.meta.url))).digest("hex").slice(0, 8);

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
process.chdir(root);

const EXCLUDED_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "generated", ".git"]);
const CLI_SCRIPT = /^apps\/api\/src\/(migrate\/|seed\.ts$|audit\/purge\.ts$)/;
const ENTRY_POINT =
  /(^|\/)(page|layout|default|template|loading|error|not-found|route|middleware|proxy|manifest|main|seed|index)\.(ts|tsx|mts)$|\.config\.(ts|js|mjs)$|\.d\.ts$|^apps\/api\/src\/migrate\//;
const NEXT_EXPORT_NAMES = new Set([
  "metadata", "generateMetadata", "viewport", "generateViewport", "config", "dynamic",
  "revalidate", "runtime", "fetchCache", "generateStaticParams", "middleware", "proxy",
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
]);

// ---------------------------------------------------------------- input

let targets = process.argv.slice(2);
if (targets.length === 0) {
  try {
    targets = fs.readFileSync(0, "utf8").split("\n");
  } catch {
    targets = [];
  }
}
targets = [
  ...new Set(
    targets
      .map((t) => t.trim())
      .filter((t) => t && !t.startsWith("#"))
      .map((t) => path.relative(root, path.resolve(root, t)))
      .filter((t) => {
        try {
          return fs.statSync(t).isFile();
        } catch {
          return false;
        }
      }),
  ),
];

if (targets.length === 0) {
  console.log("# smell-scan: no files given");
  process.exit(0);
}

// ---------------------------------------------------------------- helpers

const fileCache = new Map();
function read(file) {
  let entry = fileCache.get(file);
  if (!entry) {
    const text = fs.readFileSync(file, "utf8");
    entry = { text, lines: text.split("\n") };
    fileCache.set(file, entry);
  }
  return entry;
}

function walk(dir, exts, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

let repoSourceIndex;
/** Every ts/tsx/js source in apps/ and packages/, read once. */
function sourceIndex() {
  if (!repoSourceIndex) {
    repoSourceIndex = [
      ...walk("apps", [".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs"]),
      ...walk("packages", [".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs"]),
    ].map((file) => ({ file, text: read(file).text }));
  }
  return repoSourceIndex;
}

let repoCssIndex;
function cssIndex() {
  if (!repoCssIndex) {
    repoCssIndex = [...walk("apps/web", [".css"]), ...walk("packages/ui", [".css"])].map((file) => ({
      file,
      text: read(file).text,
    }));
  }
  return repoCssIndex;
}

const isTs = (f) => /\.(ts|tsx|mts)$/.test(f) && !f.endsWith(".d.ts");
const isApi = (f) => f.startsWith("apps/api/src/");
const isWeb = (f) => f.startsWith("apps/web/") || f.startsWith("packages/ui/src/");
const isCss = (f) => f.endsWith(".css");
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

/**
 * From `startLine`, find the first `open` char at or after column `col` and
 * return the index of the line where its match closes. Strings and comments
 * are not parsed; this is a heuristic, and a wrong end line only widens or
 * narrows a candidate block.
 */
function blockEnd(lines, startLine, col = 0, open = "(", close = ")", maxLines = 120) {
  let depth = 0;
  let started = false;
  for (let i = startLine; i < Math.min(lines.length, startLine + maxLines); i++) {
    const line = lines[i];
    for (let j = i === startLine ? col : 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === open) {
        depth++;
        started = true;
      } else if (ch === close && started) {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return Math.min(lines.length - 1, startLine + maxLines);
}

const sections = new Map();
function report(section, file, line, text, note) {
  if (!sections.has(section)) sections.set(section, []);
  const trimmed = (text ?? "").trim().slice(0, 110);
  sections.get(section).push({ file, line, text: trimmed, note });
}
function ensure(section) {
  if (!sections.has(section)) sections.set(section, []);
}
const infos = new Map();
/** A coverage note printed under the section, so "(none)" reads as "checked, clean" rather than "not run". */
function info(section, text) {
  if (!infos.has(section)) infos.set(section, []);
  infos.get(section).push(text);
}

/** Class names a CSS module defines (selectors only; keyframes and declarations skipped). */
function classesOf(cssFile) {
  const classes = new Set();
  let kf = false;
  for (const line of read(cssFile).lines) {
    if (/@keyframes/.test(line)) kf = true;
    if (kf) {
      if (/^\}/.test(line)) kf = false;
      continue;
    }
    if (/^\s*[\w-]+\s*:/.test(line) && !/\{/.test(line)) continue;
    for (const m of line.matchAll(/\.([a-zA-Z_][\w-]*)/g)) if (!/^\d/.test(m[1])) classes.add(m[1]);
  }
  return classes;
}

// ---------------------------------------------------------------- 1. escapes & debris

ensure("escapes-and-debris");
for (const file of targets) {
  if (!isTs(file)) continue;
  const { lines } = read(file);
  const cli = CLI_SCRIPT.test(file);
  lines.forEach((line, i) => {
    const n = i + 1;
    if (/\b(TODO|FIXME|HACK|XXX)\b/.test(line)) report("escapes-and-debris", file, n, line, "leftover marker");
    if (/eslint-disable/.test(line))
      report("escapes-and-debris", file, n, line, /no-img-element/.test(line) ? "img suppression: S3/blob URLs may need it, but say why, or share one unoptimized next/image wrapper" : "lint suppression: needs a reason on the same line");
    if (isComment(line)) return;
    if (/\bas any\b/.test(line) || /[:<(,]\s*any\b(?!\w)/.test(line)) report("escapes-and-debris", file, n, line, "`any`");
    if (/\bas unknown as\b/.test(line)) report("escapes-and-debris", file, n, line, "double cast");
    if (/@ts-(ignore|expect-error|nocheck)/.test(line)) report("escapes-and-debris", file, n, line, "type check suppressed");
    if (/[\w)\]]!(?=[.\[)(;,}\s]|$)/.test(line) && !/!==?/.test(line.replace(/[\w)\]]!(?=[.\[)(;,}\s]|$)/g, "")))
      report("escapes-and-debris", file, n, line, "non-null assertion");
    if (/\bconsole\.log\(/.test(line)) report("escapes-and-debris", file, n, line, cli ? "console.log in a CLI script (expected)" : "console.log in request-path code");
    if (/\bdebugger\b/.test(line)) report("escapes-and-debris", file, n, line, "debugger");
  });
}

// ---------------------------------------------------------------- 2. API queries

ensure("api-queries");
const QUERY_CALL =
  /\b(?:this\.prisma|prisma|tx|db|client)\.\w+\.(?:findMany|findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|create|update|upsert|delete|deleteMany|updateMany|createMany|count|aggregate|groupBy)\(|\$(?:queryRaw|executeRaw)/;
const LOOP_START = /\b(?:for|while)\s*\(|\.(?:forEach|map|flatMap|reduce|filter|some|every)\(\s*(?:async\s*)?\(?/;

for (const file of targets) {
  if (!isApi(file) || !isTs(file)) continue;
  const { lines, text } = read(file);
  const cli = CLI_SCRIPT.test(file);

  lines.forEach((line, i) => {
    const n = i + 1;
    if (isComment(line)) return;

    if (/\binclude:\s*\{/.test(line)) report("api-queries", file, n, line, "`include` pulls whole related rows; use a nested `select`");

    if (/\$(queryRawUnsafe|executeRawUnsafe)\b/.test(line)) report("api-queries", file, n, line, "UNSAFE raw SQL");
    if (/\$(queryRaw|executeRaw)\(/.test(line)) report("api-queries", file, n, line, "raw SQL called as a function, not a tagged template: verify it is `Prisma.sql`");

    if (/\b\w+Exception\b/.test(line) && /@nestjs|new \w+Exception\(/.test(line))
      report("api-queries", file, n, line, "Nest HTTP exception surfaces as a tRPC 500; throw TRPCError");
    if (!cli && /throw new Error\(/.test(line)) report("api-queries", file, n, line, "bare Error in request path; TRPCError with a code");
    if (/code:\s*"FORBIDDEN"/.test(line)) report("api-queries", file, n, line, "FORBIDDEN confirms the row exists; NOT_FOUND unless this is a rank gate");

    if (/\.toISOString\(\)\.slice\(0,\s*(7|10)\)/.test(line))
      report("api-queries", file, n, line, "date sliced from ISO: only correct if the value is UTC midnight (@db.Date)");
    if (/\b(total|amount|sum|price|prix|poids|metrage|quantity|quantite|qty|montant|weight|kg|metres)\w*\s*(===|!==)\s*(?!null\b|undefined\b)[\w.]+/i.test(line))
      report("api-queries", file, n, line, "equality on a figure: float? (integer counts are fine)");

    // findMany without a bound
    let m;
    const fm = /\.findMany\(/g;
    while ((m = fm.exec(line))) {
      const end = blockEnd(lines, i, m.index + m[0].length - 1);
      const block = lines.slice(i, end + 1).join("\n");
      if (!/\btake\b/.test(block) && !/\.\.\.args/.test(block))
        report("api-queries", file, n, line, "findMany with no `take`: whole table? (fine for small reference data; say why)");
      if (/\bskip:/.test(block) && /\borderBy/.test(block) && !/\bid:\s*"(asc|desc)"/.test(block))
        report("api-queries", file, n, line, "hand-rolled pagination without an `id` tiebreaker");
    }
    const ff = /\.findFirst\(/g;
    while ((m = ff.exec(line))) {
      const end = blockEnd(lines, i, m.index + m[0].length - 1);
      const block = lines.slice(i, end + 1).join("\n");
      if (!/\borderBy/.test(block) && !/\bid\b/.test(block) && !/where,|where:\s*where\b/.test(block))
        report("api-queries", file, n, line, "findFirst without orderBy is nondeterministic (fine for an existence check or a by-id lookup)");
    }
    const wr = /\.(?:update|create|upsert)\(/g;
    while ((m = wr.exec(line)) && !cli) {
      if (/\b(?:tx|this\.prisma|prisma|db)\.\w+\.(?:update|create|upsert)\($/.test(line.slice(0, m.index + m[0].length)) || /\.(?:update|create|upsert)\(\{/.test(line)) {
        const end = blockEnd(lines, i, m.index + m[0].length - 1);
        const block = lines.slice(i, end + 1).join("\n");
        if (!/\bselect:/.test(block) && !/\bdata:\s*\w+\s*\}?\)/.test(block))
          report("api-queries", file, n, line, "write returns the whole model; add `select` (or a small RETURN_SELECT)");
      }
    }

    // loops that query
    if (LOOP_START.test(line) && !/^\s*\/\//.test(line)) {
      const braceCol = line.indexOf("{", line.search(LOOP_START));
      const end = braceCol >= 0 ? blockEnd(lines, i, braceCol, "{", "}", 80) : Math.min(lines.length - 1, i + 3);
      for (let k = i; k <= end; k++) {
        if (k !== i && QUERY_CALL.test(lines[k]) && !isComment(lines[k])) {
          report("api-queries", file, n, line, `query inside a loop at :${k + 1} — N+1 candidate (batch with \`in\`, nested select, createMany/updateMany, or $transaction([...]))`);
          break;
        }
      }
    }
    if (/Promise\.all\(/.test(line)) {
      const end = blockEnd(lines, i, line.indexOf("Promise.all(") + 11, "(", ")", 40);
      const block = lines.slice(i, end + 1).join("\n");
      if (/\.map\(/.test(block) && QUERY_CALL.test(block))
        report("api-queries", file, n, line, "Promise.all over .map with a query: N round trips in parallel is still N+1");
    }

    // interactive transactions
    if (/\$transaction\(\s*async/.test(line)) {
      const end = blockEnd(lines, i, line.indexOf("$transaction(") + 12, "(", ")", 300);
      for (let k = i + 1; k <= end; k++) {
        const inner = lines[k];
        if (isComment(inner)) continue;
        if (/\bthis\.prisma\./.test(inner))
          report("api-queries", file, k + 1, inner, "outer client used inside a transaction; use `tx`");
        if (/\b(getAuth|auth\.api|getSignedUrl|S3Client|fetch\(|renderToBuffer|renderToStream|pdfService|storageService)\b/.test(inner))
          report("api-queries", file, k + 1, inner, "network / render I/O inside an open transaction");
        if (/\bawait\s+this\.(?!prisma\b)\w+\.\w+\(|\bawait\s+this\.\w+\(/.test(inner)) {
          // The call may span lines; judge the whole argument list.
          const callEnd = blockEnd(lines, k, inner.search(/\(/), "(", ")", 30);
          const call = lines.slice(k, callEnd + 1).join(" ");
          if (!/[(,]\s*(tx|db)\s*[,)]/.test(call))
            report("api-queries", file, k + 1, inner, "call inside the transaction without `tx`: the callee runs on the outer client (or is slow); pass tx");
        }
      }
    }
  });

  // publicProcedure in the router
  if (file.endsWith("trpc.router.ts")) {
    let inImport = false;
    lines.forEach((line, i) => {
      if (/^import\b/.test(line)) inImport = !/from\s+["']/.test(line);
      else if (inImport && /from\s+["']/.test(line)) {
        inImport = false;
        return;
      }
      if (inImport) return;
      if (/\bpublicProcedure\b/.test(line)) {
        const window = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
        if (!/\b(health|me):/.test(window)) report("api-queries", file, i + 1, line, "publicProcedure outside health/me");
      }
      if (/\bctx\.prisma\b|\bthis\.prisma\b/.test(line)) report("api-queries", file, i + 1, line, "query in the router; delegate to a service");
      if (/z\.any\(\)|z\.unknown\(\)|\.passthrough\(\)/.test(line)) report("api-queries", file, i + 1, line, "open input schema");
      if (/\.(query|mutation)\(\s*(async\s*)?\(/.test(line)) {
        const end = blockEnd(lines, i, line.search(/\.(query|mutation)\(/) + 6, "(", ")", 60);
        if (end - i > 8) report("api-queries", file, i + 1, line, `${end - i}-line handler in the router; move logic to the service`);
      }
      if (/\.mutation\(/.test(line)) {
        const back = lines.slice(Math.max(0, i - 8), i).join("\n");
        if (!/\.input\(/.test(back) && !/\.input\(/.test(line)) report("api-queries", file, i + 1, line, "mutation without .input(): fine only if it truly takes nothing");
      }
    });
  }
  void text;
}

// ---------------------------------------------------------------- 3. web

ensure("web");
for (const file of targets) {
  if (!isWeb(file) || !isTs(file)) continue;
  const { lines, text } = read(file);
  const base = path.basename(file);
  const isClient = /^\s*["']use client["']/m.test(text);

  if (/^(page|layout|template)\.tsx$/.test(base) && isClient && !file.includes("/@modal/"))
    report("web", file, 1, '"use client"', "route file marked client: keep page/layout as server components and push the directive to a leaf (only @modal interceptors are thin client wrappers)");
  if (/["']use server["']/.test(text) && file !== "apps/web/i18n/actions.ts")
    report("web", file, 1, '"use server"', "server action: this app mutates through tRPC; the locale cookie action in i18n/actions.ts is the one exception");
  if (file === "apps/web/middleware.ts") report("web", file, 1, "middleware.ts", "Next 16 deprecates middleware.ts/`middleware` in favour of proxy.ts/`proxy` (node runtime)");
  if (/from ["']next\/router["']/.test(text)) report("web", file, 1, "next/router", "pages-router API; use next/navigation");

  const stateCount = (text.match(/\buseState[<(]/g) ?? []).length;
  if (stateCount > 8) report("web", file, 1, `${stateCount} useState calls`, "state sprawl: reducer, extraction, or a form model");
  if (lines.length > 400) report("web", file, 1, `${lines.length} lines`, "large file: split by responsibility");

  const usesQuery = /\b(useQuery|queryOptions|useInfiniteQuery)\(/.test(text);

  lines.forEach((line, i) => {
    const n = i + 1;
    if (isComment(line)) return;

    if (/\buseEffect\(/.test(line)) {
      const end = blockEnd(lines, i, line.indexOf("useEffect(") + 9, "(", ")", 60);
      const block = lines.slice(i, end + 1).join("\n");
      if (/\b(fetch\(|mutate\(|mutateAsync\(|queryClient\.|\.refetch\()/.test(block))
        report("web", file, n, line, "effect that fetches/mutates: use useQuery/useMutation");
      if (/\bset[A-Z]\w*\(\s*(props\.|initial|value|data)\b/.test(block) && !/\bsetTimeout\(/.test(block))
        report("web", file, n, line, "effect syncing props into state: derive during render or key the component (a timer-based effect is a debounce and is fine)");
    }
    if (/invalidateQueries\(\s*\)|invalidateQueries\(\s*\{\s*\}\s*\)/.test(line))
      report("web", file, n, line, "invalidates the whole cache (and re-audits every read); target with pathFilter/queryKey");
    if (/\b(refetchInterval|refetchOnWindowFocus|refetchIntervalInBackground)\b/.test(line))
      report("web", file, n, line, "polling / focus refetch: must be a documented decision");
    if (!/i18n\/formats\.ts$/.test(file) && /\b(toLocaleDateString|toLocaleTimeString|toLocaleString)\(|\.toFixed\(|new Intl\./.test(line))
      report("web", file, n, line, "hand-built formatting; go through i18n/formats.ts");
    if (/\bhasRank\(/.test(line)) report("web", file, n, line, "hasRank bleeds between PRODUCTION and MAGASINIER; canAccess");
    if (/\.role\s*(===|!==|==|!=)\s*["']/.test(line)) report("web", file, n, line, "role string comparison excludes SUPER_ADMIN; canAccess/canAccessAny");
    if (/<img\b/.test(line)) report("web", file, n, line, "<img>: next/image unless it is an SVG icon or a blob URL");
    if (/<a\s[^>]*href=["']\/(?!\/)/.test(line)) report("web", file, n, line, "internal <a>: next/link");
    if (/className=\{`[^`]*\$\{/.test(line)) report("web", file, n, line, "template-literal class composition; [..].filter(Boolean).join(\" \") under noUncheckedIndexedAccess");
    if (usesQuery && /\binterface\s+\w*Row\b|\btype\s+\w*Row\s*=\s*\{/.test(line)) report("web", file, n, line, "hand-written row type beside a query; derive it: NonNullable<typeof q.data>[\"rows\"][number] or inferRouterOutputs");
    if (/key=\{\s*(index|i|idx)\s*\}/.test(line)) report("web", file, n, line, "index key");
    if (/dangerouslySetInnerHTML/.test(line)) report("web", file, n, line, "raw HTML");
    if (/\buseSearchParams\(/.test(line)) report("web", file, n, line, "useSearchParams: a Suspense boundary matters only on a statically prerendered route; this app's root layout awaits cookies(), so verify before reporting");
    if (/^export const (dynamic|revalidate|runtime|fetchCache)\b/.test(line)) report("web", file, n, line, "route segment config: justify");
    if (/\bReact\.FC\b|\bFunctionComponent\b/.test(line)) report("web", file, n, line, "React.FC; type props directly");
    if (/<(div|span|li|tr)\b[^>]*\bonClick=/.test(line)) report("web", file, n, line, "clickable non-button: role, tabIndex and a key handler, or a <button>");
    if (/(?<!await\s)\b(cookies|headers|draftMode)\(\)\./.test(line)) report("web", file, n, line, "Next 16: cookies()/headers() are async");
    if (/\{\s*params\s*\}\s*:\s*\{\s*params:\s*\{/.test(line)) report("web", file, n, line, "Next 16: params is a Promise; await it");
    if (isClient && /process\.env\.(?!NEXT_PUBLIC_)\w+/.test(line)) report("web", file, n, line, "non-public env var in a client component is undefined in the browser");

    // hard-coded English
    if (!/\bt\(|\bcommon\(|\benums\(|useTranslations|getTranslations/.test(line)) {
      if (/>\s*[A-Z][a-z]+(?:\s+[A-Za-z][a-z']*){1,}[.!?…]?\s*</.test(line)) report("web", file, n, line, "literal text in JSX");
      if (/\b(aria-label|placeholder|title|alt|label|header|emptyText|description|message|eyebrow|caption|hint)=["'][A-Za-z][^"']{2,}["']/.test(line))
        report("web", file, n, line, "literal attribute text");
      if (/\b(label|title|header|message|description|text|hint|placeholder|emptyText|caption|eyebrow):\s*["'][A-Z][a-z][^"']*["']/.test(line))
        report("web", file, n, line, "literal prop text");
      if (/\b(setError|toast|notify|throw new Error)\(\s*["'][A-Z][^"']{3,}["']/.test(line)) report("web", file, n, line, "literal message");
    }

    // icon-only buttons without a label
    if (/<(Button|button)\b/.test(line) && !/aria-label/.test(line)) {
      const closeIdx = lines.slice(i, i + 15).findIndex((l) => /<\/(Button|button)>|\/>/.test(l));
      if (closeIdx >= 0) {
        const block = lines.slice(i, i + closeIdx + 1).join("\n");
        const textContent = block.replace(/<[^>]*>/g, "").replace(/\{[^}]*\}/g, "");
        if (/<svg\b|<Icon|Icon\b/.test(block) && !/aria-label/.test(block) && !/[A-Za-z]{2,}/.test(textContent))
          report("web", file, n, line, "icon-only button without aria-label");
      }
    }
  });
}

// ---------------------------------------------------------------- 4. CSS

ensure("css");
{
  const PHYSICAL =
    /^\s*(margin-left|margin-right|padding-left|padding-right|left|right|border-left(?:-\w+)?|border-right(?:-\w+)?|border-top-left-radius|border-top-right-radius|border-bottom-left-radius|border-bottom-right-radius)\s*:/;
  const tokenDefs = new Set();
  for (const { text } of cssIndex()) for (const m of text.matchAll(/(--bp-[\w-]+)\s*:/g)) tokenDefs.add(m[1]);
  // A custom property can also be set inline from a component (`style={{ "--bp-table-cols": … }}`).
  for (const { file, text } of sourceIndex()) if (/\.tsx$/.test(file)) for (const m of text.matchAll(/["'](--bp-[\w-]+)["']\s*:/g)) tokenDefs.add(m[1]);

  for (const file of targets) {
    if (!isCss(file)) continue;
    const { lines, text } = read(file);
    const isTokenFile = /tokens\.css$|globals\.css$/.test(file);
    let inKeyframes = false;

    lines.forEach((line, i) => {
      const n = i + 1;
      if (/^\s*\/\*/.test(line) && /\*\/\s*$/.test(line)) return;
      if (/@keyframes/.test(line)) inKeyframes = true;
      if (inKeyframes && /^\}/.test(line)) inKeyframes = false;

      if (PHYSICAL.test(line)) report("css", file, n, line, "physical side; Arabic is RTL — logical property");
      if (/text-align:\s*(left|right)\b/.test(line)) report("css", file, n, line, "text-align start/end");
      if (/float:\s*(left|right)\b/.test(line)) report("css", file, n, line, "float side");
      if (/^\s*-(webkit|moz|ms|o)-(backdrop-filter|user-select|appearance|mask(?:-[\w-]+)?|clip-path|hyphens|box-decoration-break|text-size-adjust|tab-size|filter|transform(?:-[\w-]+)?|transition(?:-[\w-]+)?|animation(?:-[\w-]+)?|flex(?:-[\w-]+)?|box-shadow|border-radius|column(?:-[\w-]+)?|text-decoration(?:-[\w-]+)?|background-clip|sticky|position)\s*:/.test(line))
        report("css", file, n, line, "hand-written vendor prefix on a standard property: Lightning CSS then emits only the prefixed form");
      if (!isTokenFile && /#[0-9a-fA-F]{3,8}\b/.test(line) && !/url\(/.test(line)) report("css", file, n, line, "raw colour; tokens only");
      if (/!important/.test(line)) report("css", file, n, line, "!important");
      if (/^\s*color\s*:\s*var\(--bp-neutral-/.test(line)) report("css", file, n, line, "text colour from the neutral ramp; use --bp-ink / --bp-ink-muted / --bp-ink-faint so the floor scope can invert it");
      if (/^\s*color\s*:\s*var\(--bp-orange-500\)/.test(line)) report("css", file, n, line, "orange-500 is a fill only; text uses --bp-orange-700 (on white) or --bp-orange-800 (on tints)");
      if (!isTokenFile && /^\s*--bp-[\w-]+\s*:/.test(line)) report("css", file, n, line, "defines a --bp token outside tokens.css");

      const spacing = line.match(/^\s*(gap|row-gap|column-gap|margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|inset(?:-[\w-]+)?)\s*:\s*([^;]+);/);
      if (spacing && !/var\(/.test(spacing[2]) && /\b(?!0px|1px|2px)\d+px\b/.test(spacing[2]))
        report("css", file, n, line, "literal spacing; --bp-space-* scale");
      if (/^\s*border-radius\s*:/.test(line) && !/var\(/.test(line) && /\d+px/.test(line) && !/\b(0|1|2)px\b/.test(line))
        report("css", file, n, line, "literal radius; --bp-radius-* scale");

      for (const m of line.matchAll(/var\((--bp-[\w-]+)/g)) {
        if (!tokenDefs.has(m[1])) report("css", file, n, line, `undefined token ${m[1]}: the whole declaration is dropped`);
      }
    });

    // unused classes in a CSS module
    if (file.endsWith(".module.css")) {
      const classes = classesOf(file);
      const usage = sourceIndex().filter((e) => /\.(tsx|ts)$/.test(e.file));
      const unused = [];
      for (const cls of classes) {
        const re = new RegExp(`\\.${cls}\\b|["'\\[]${cls}["'\\]]`);
        if (!usage.some((e) => re.test(e.text))) unused.push(cls);
      }
      if (unused.length) report("css", file, 1, `unused classes: ${unused.slice(0, 30).join(", ")}${unused.length > 30 ? ` (+${unused.length - 30})` : ""}`, "no tsx references them (check for styles[dynamic] first)");
    }
    void text;
  }
}

// CSS modules the target components import: a class the component names
// must exist (tsc types module classes as an open string index, so a typo
// renders unstyled and is invisible to check-types), and the module's tokens
// must resolve.
{
  const tokenDefs = new Set();
  for (const { text } of cssIndex()) for (const m of text.matchAll(/(--bp-[\w-]+)\s*:/g)) tokenDefs.add(m[1]);
  for (const { file, text } of sourceIndex()) if (/\.tsx$/.test(file)) for (const m of text.matchAll(/["'](--bp-[\w-]+)["']\s*:/g)) tokenDefs.add(m[1]);
  const derived = new Set();
  let classRefs = 0;
  for (const file of targets) {
    if (!isWeb(file) || !isTs(file)) continue;
    const { text, lines } = read(file);
    for (const m of text.matchAll(/import\s+(\w+)\s+from\s+["'](\.[^"']+\.module\.css)["']/g)) {
      const alias = m[1];
      const cssPath = path.normalize(path.join(path.dirname(file), m[2]));
      const importLine = text.slice(0, m.index).split("\n").length;
      if (!fs.existsSync(cssPath)) {
        report("css", file, importLine, m[0], "stylesheet import does not resolve");
        continue;
      }
      const defined = classesOf(cssPath);
      // Not preceded by `.`: `trpc.settings.summary` is not the `settings` module.
      const access = new RegExp(`(?<![\\w.$])${alias}\\.([A-Za-z_]\\w*)`, "g");
      lines.forEach((line, i) => {
        for (const a of line.matchAll(access)) {
          classRefs++;
          if (!defined.has(a[1])) report("css", file, i + 1, line, `${alias}.${a[1]} is not defined in ${path.basename(cssPath)}: renders unstyled, tsc cannot see it`);
        }
      });
      if (!targets.includes(cssPath)) derived.add(cssPath);
    }
  }
  for (const cssPath of derived) {
    read(cssPath).lines.forEach((line, i) => {
      for (const m of line.matchAll(/var\((--bp-[\w-]+)/g)) {
        if (!tokenDefs.has(m[1])) report("css", cssPath, i + 1, line, `undefined token ${m[1]} (imported module): the whole declaration is dropped`);
      }
    });
  }
  const inTarget = targets.filter(isCss).length;
  if (inTarget === 0 && derived.size === 0) info("css", "no stylesheet in the target and no CSS-module import from it — nothing checked");
  else info("css", `checked ${inTarget} stylesheet(s) in the target fully; ${derived.size} imported module(s) for undefined tokens; ${classRefs} class reference(s) for existence`);
}

// ---------------------------------------------------------------- 5. i18n

ensure("i18n");
{
  const LOCALES = ["en", "fr", "ar", "es"];
  const namespaces = new Set();
  const flatten = (obj, prefix = "", out = new Map()) => {
    for (const [k, v] of Object.entries(obj ?? {})) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object") flatten(v, key, out);
      else out.set(key, v);
    }
    return out;
  };
  const loadNs = (locale, ns) => {
    const file = `apps/web/messages/${locale}/${ns}.json`;
    if (!fs.existsSync(file)) return null;
    try {
      return flatten(JSON.parse(read(file).text));
    } catch (e) {
      report("i18n", file, 1, "invalid JSON", String(e.message));
      return null;
    }
  };

  for (const file of targets) {
    const m = file.match(/^apps\/web\/messages\/(\w+)\/([\w-]+)\.json$/);
    if (m) namespaces.add(m[2]);
    if (isWeb(file) && isTs(file)) {
      for (const mm of read(file).text.matchAll(/(?:useTranslations|getTranslations)\(\s*["']([\w.-]+)["']|namespace:\s*["']([\w.-]+)["']/g))
        namespaces.add((mm[1] ?? mm[2]).split(".")[0]);
    }
  }

  const enByNs = new Map();
  for (const ns of namespaces) {
    const en = loadNs("en", ns);
    if (!en) {
      report("i18n", `apps/web/messages/en/${ns}.json`, 1, "missing", "namespace used but no English file");
      continue;
    }
    enByNs.set(ns, en);
    for (const [key, value] of en) if (value === "") report("i18n", `apps/web/messages/en/${ns}.json`, 1, key, "empty English value");
    for (const locale of LOCALES.slice(1)) {
      const other = loadNs(locale, ns);
      const file = `apps/web/messages/${locale}/${ns}.json`;
      if (!other) {
        report("i18n", file, 1, "missing file", `namespace exists in en only`);
        continue;
      }
      const missing = [...en.keys()].filter((k) => !other.has(k));
      const extra = [...other.keys()].filter((k) => !en.has(k));
      const empty = [...other].filter(([, v]) => v === "").map(([k]) => k);
      if (missing.length) report("i18n", file, 1, `missing ${missing.length}: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? " …" : ""}`, "keys present in en, absent here (renders the key or English)");
      if (extra.length) report("i18n", file, 1, `extra ${extra.length}: ${extra.slice(0, 12).join(", ")}${extra.length > 12 ? " …" : ""}`, "keys absent from en: dead or misspelled");
      if (empty.length) report("i18n", file, 1, `empty ${empty.length}: ${empty.slice(0, 12).join(", ")}`, "empty values");
    }
  }

  // t("key") calls in target components must resolve
  for (const file of targets) {
    if (!isWeb(file) || !isTs(file)) continue;
    const { lines, text } = read(file);
    // A file may hold several components, each binding `t` to a different
    // namespace; a call resolves against the nearest binding above it.
    const bindings = [];
    for (const m of text.matchAll(/const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:["']([\w.-]+)["']|\{[^}]*namespace:\s*["']([\w.-]+)["'][^}]*\})?\s*\)/g)) {
      const bound = m[2] ?? m[3] ?? "";
      const [ns, ...rest] = bound.split(".");
      const lineIdx = text.slice(0, m.index).split("\n").length - 1;
      bindings.push({ name: m[1], ns, prefix: rest.length ? `${rest.join(".")}.` : "", lineIdx });
    }
    if (bindings.length === 0) continue;
    const names = [...new Set(bindings.map((b) => b.name))];
    let dynamic = 0;
    lines.forEach((line, i) => {
      for (const name of names) {
        const active = bindings.filter((b) => b.name === name && b.lineIdx <= i).pop();
        if (!active) continue;
        const { ns, prefix } = active;
        const re = new RegExp(`\\b${name}(?:\\.(?:rich|raw|markup|has))?\\(\\s*(["'\`])([^"'\`]*)\\1`, "g");
        for (const m of line.matchAll(re)) {
          if (m[1] === "`" && m[2].includes("${")) {
            dynamic++;
            report("i18n", file, i + 1, line, `dynamic key \`${prefix}${m[2]}\` in ${ns}: every branch needs a message in all four locales`);
            continue;
          }
          const en = enByNs.get(ns);
          if (!en) continue;
          const key = prefix + m[2];
          if (!en.has(key) && ![...en.keys()].some((k) => k.startsWith(`${key}.`)))
            report("i18n", file, i + 1, line, `key "${ns}.${key}" not in en messages (runtime MISSING_MESSAGE)`);
        }
      }
    });
    void dynamic;
  }

  if (enByNs.size === 0) info("i18n", "no message file or useTranslations binding in the target — parity not checked");
  else info("i18n", `parity checked (en vs fr/ar/es) for: ${[...enByNs.keys()].sort().join(", ")}; every literal t("key") in the target resolved against en`);

  // Keys never referenced. Only for namespaces whose message file is IN the
  // target (a component that merely reads `common` must not dump all of
  // common's keys), and candidates only: a key built at runtime hides its use.
  const targetNamespaces = new Set(targets.map((f) => f.match(/^apps\/web\/messages\/\w+\/([\w-]+)\.json$/)?.[1]).filter(Boolean));
  const tsIndex = sourceIndex().filter((e) => /\.(tsx|ts)$/.test(e.file) && (e.file.startsWith("apps/web/") || e.file.startsWith("packages/ui/")));
  // Every `useTranslations("ns.sub")` binding: a key `sub.x` is then referenced as "x".
  const bindingsByFile = tsIndex.map((e) => ({
    text: e.text,
    bound: [...e.text.matchAll(/(?:useTranslations|getTranslations)\(\s*["']([\w.-]+)["']|namespace:\s*["']([\w.-]+)["']/g)].map((m) => m[1] ?? m[2]),
  }));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const [ns, en] of enByNs) {
    if (!targetNamespaces.has(ns)) continue;
    const unused = [];
    for (const key of en.keys()) {
      const parts = key.split(".");
      const referenced = bindingsByFile.some(({ text, bound }) => {
        // Bound to the namespace itself: full key literal, or a template with the parent prefix.
        if (bound.includes(ns)) {
          if (new RegExp(`["'\`]${esc(key)}["'\`]`).test(text)) return true;
          for (let i = 1; i < parts.length; i++) if (new RegExp(`\`${esc(parts.slice(0, i).join("."))}\\.\\$\\{`).test(text)) return true;
        }
        // Bound to a sub-namespace: the remainder is the literal.
        for (let i = 1; i < parts.length; i++) {
          if (!bound.includes(`${ns}.${parts.slice(0, i).join(".")}`)) continue;
          const rest = parts.slice(i);
          if (new RegExp(`["'\`]${esc(rest.join("."))}["'\`]`).test(text)) return true;
          for (let j = 1; j < rest.length; j++) if (new RegExp(`\`${esc(rest.slice(0, j).join("."))}\\.\\$\\{`).test(text)) return true;
          if (/`\$\{/.test(text)) return true; // fully dynamic key under this binding: cannot tell
        }
        return false;
      });
      if (!referenced) unused.push(key);
    }
    if (unused.length) report("i18n", `apps/web/messages/en/${ns}.json`, 1, `unreferenced ${unused.length}: ${unused.slice(0, 20).join(", ")}${unused.length > 20 ? " …" : ""}`, "no literal, sub-namespace or template-prefix use found; verify before deleting — or the component hard-codes what these keys already say");
  }
}

// ---------------------------------------------------------------- 6. dead exports

ensure("dead-exports");
{
  const index = sourceIndex();
  const capped = 3000;
  let seen = 0;
  for (const file of targets) {
    if (!isTs(file) || ENTRY_POINT.test(file)) continue;
    const { text } = read(file);
    const names = new Set();
    for (const m of text.matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|abstract class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
    for (const m of text.matchAll(/^export\s+\{([^}]+)\}/gm)) {
      for (const part of m[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
      }
    }
    const vocabUnused = [];
    for (const name of names) {
      if (NEXT_EXPORT_NAMES.has(name)) continue;
      if (++seen > capped) {
        report("dead-exports", file, 1, `stopped after ${capped} exports`, "run on a narrower target");
        break;
      }
      const re = new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`);
      const used = index.some((e) => e.file !== file && re.test(e.text));
      if (!used) {
        const line = text.split("\n").findIndex((l) => new RegExp(`^export\\b.*\\b${name.replace(/\$/g, "\\$")}\\b`).test(l)) + 1;
        const vocab = /_(SORT_KEYS|FACET_KEYS|DEFAULT_SORT)$|^(\w+SortKey|\w+Facet)$/.test(name) && /\.list\.ts$/.test(file);
        if (vocab) vocabUnused.push(name);
        else report("dead-exports", file, line || 1, `export ${name}`, "never imported outside this file: delete, or drop `export`");
      }
    }
    if (vocabUnused.length)
      report("dead-exports", file, 1, `list vocabulary exports with no importer: ${vocabUnused.join(", ")}`, "documented exception (slop.md §2): LOW, one note, un-export or leave");
    if (seen > capped) break;
  }
  info("dead-exports", `checked ${seen} export(s) from the target against ${index.length} source files in apps/ and packages/`);
}

// ---------------------------------------------------------------- 7. env, contract, list vocabulary, prisma

ensure("env-and-contract");
{
  let declared = new Set();
  try {
    const turbo = JSON.parse(read("turbo.json").text);
    declared = new Set([...(turbo.globalEnv ?? []), ...Object.values(turbo.tasks ?? {}).flatMap((t) => t.env ?? [])]);
  } catch {
    /* no turbo.json */
  }
  for (const file of targets) {
    if (!isTs(file) && !/\.(js|mjs)$/.test(file)) continue;
    const { lines } = read(file);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        if (!declared.has(m[1])) report("env-and-contract", file, i + 1, line, `${m[1]} not in turbo.json globalEnv (lint fails)`);
      }
    });
  }

  // api-contract: exports must reach index.ts; Zod 4 idioms; bounded inputs
  const indexText = fs.existsSync("packages/api-contract/src/index.ts") ? read("packages/api-contract/src/index.ts").text : "";
  for (const file of targets) {
    if (!file.startsWith("packages/api-contract/src/") || !isTs(file)) continue;
    const base = path.basename(file, ".ts");
    if (base !== "index" && indexText && !new RegExp(`from\\s+["']\\./${base}(\\.js)?["']`).test(indexText))
      report("env-and-contract", file, 1, base, "not re-exported from index.ts: invisible to the apps");
    const { lines } = read(file);
    lines.forEach((line, i) => {
      if (isComment(line)) return;
      if (/z\.string\(\)\.email\(\)/.test(line)) report("env-and-contract", file, i + 1, line, "Zod 4: z.email()");
      const nonId = line.replace(/\b(id|\w+Ids?)\s*:\s*z\.string\(\)[^,}]*/g, "");
      if (/:\s*z\.string\(\)/.test(nonId) && !/\.(max|length|regex|uuid|cuid|cuid2|datetime|date|enum|literal)\(/.test(nonId))
        report("env-and-contract", file, i + 1, line, "unbounded string input; .max() (ids are exempt)");
      if (/z\.number\(\)(?!\.(int|finite|min|max|nonnegative|positive|gte|lte|gt|lt))/.test(line) && /:\s*z\.number\(\)/.test(line))
        report("env-and-contract", file, i + 1, line, "unconstrained number: .finite()/.int()/.min()");
      if (/z\.enum\(\[\s*"SUPER_ADMIN"/.test(line)) report("env-and-contract", file, i + 1, line, "repeats ROLES; use roleSchema");
      if (/optionalText\(/.test(line)) {
        let enclosing = "";
        for (let k = i; k >= 0; k--) {
          const m = lines[k].match(/^export const (\w+)\s*=/);
          if (m) {
            enclosing = m[1];
            break;
          }
        }
        if (/^update/i.test(enclosing))
          report("env-and-contract", file, i + 1, line, `optionalText in ${enclosing} cannot express 'clear'; clearableText (undefined=leave, null=clear)`);
      }
    });
  }

  // *.list.ts: sortable ⊆ select, (col, id) index, searchable are strings
  let schema = null;
  try {
    schema = read("apps/api/prisma/schema.prisma").text;
  } catch {
    /* no schema */
  }
  const modelBlock = (name) => {
    if (!schema) return null;
    const m = schema.match(new RegExp(`\\nmodel\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
    return m ? m[1] : null;
  };
  for (const file of targets) {
    if (!/\.list\.ts$/.test(file)) continue;
    const { text, lines } = read(file);
    const model = text.match(/Prisma\.(\w+)WhereInput/)?.[1];
    const block = model ? modelBlock(model) : null;
    const selectKeys = new Set();
    for (const m of text.matchAll(/_SELECT\s*=\s*\{([\s\S]*?)\}\s*(?:as const|satisfies)/g))
      for (const k of m[1].matchAll(/^\s*(\w+):\s*(?:true|\{)/gm)) selectKeys.add(k[1]);
    const sortableStart = lines.findIndex((l) => /\bsortable:\s*\{/.test(l));
    if (sortableStart >= 0) {
      const end = blockEnd(lines, sortableStart, lines[sortableStart].indexOf("{"), "{", "}", 120);
      // One entry per `key: (dir) => <fragment>`; the fragment may span lines.
      // A nested object is a relation sort and is left to the reviewer.
      for (let k = sortableStart + 1; k <= end; k++) {
        const start = lines[k].match(/^\s*(\w+):\s*\(\s*\w*\s*\)\s*=>\s*(.*)$/);
        if (!start) continue;
        const key = start[1];
        let fragment = start[2];
        let depth = (fragment.match(/[[{]/g) ?? []).length - (fragment.match(/[\]}]/g) ?? []).length;
        let j = k;
        while (depth > 0 && j < end) {
          j++;
          fragment += " " + lines[j].trim();
          depth += (lines[j].match(/[[{]/g) ?? []).length - (lines[j].match(/[\]}]/g) ?? []).length;
        }
        if (/\{[^{}]*\{/.test(fragment)) {
          report("env-and-contract", file, k + 1, lines[k], `relation sort "${key}": confirm the related column is selected and indexed on the related model`);
          continue;
        }
        const seq = [...fragment.matchAll(/\{\s*(\w+):\s*(?:dir|"asc"|"desc")\s*\}/g)].map((m) => m[1]);
        if (seq.length === 0) continue;
        for (const col of seq) {
          if (selectKeys.size && !selectKeys.has(col))
            report("env-and-contract", file, k + 1, `sortable ${key} → ${col}`, "sortable column not in the module SELECT: leaks its values through row order (BLOCKER)");
        }
        if (block) {
          const pattern = seq.map((c) => `${c}(?:\\([^)]*\\))?`).join(",\\s*");
          const indexed =
            new RegExp(`@@index\\(\\[\\s*${pattern},\\s*id\\b`).test(block) ||
            (seq.length === 1 && new RegExp(`\\n\\s*${seq[0]}\\s+\\w+[^\\n]*@(id|unique)\\b`).test(block));
          if (!indexed) report("env-and-contract", file, k + 1, `sortable ${key}`, `no @@index([${seq.join(", ")}, id]) on ${model}: the sort cannot use an index`);
        }
      }
    }
    const searchable = text.match(/searchable:\s*\[([^\]]*)\]/);
    if (searchable && block) {
      for (const m of searchable[1].matchAll(/["'](\w+)["']/g)) {
        const field = block.match(new RegExp(`\\n\\s*${m[1]}\\s+(\\w+)`));
        if (field && field[1] !== "String") report("env-and-contract", file, 1, `searchable ${m[1]}`, `${field[1]} column: \`contains\` on a non-string is rejected at runtime`);
      }
    }
  }

  // schema.prisma: relation columns without an index
  for (const file of targets) {
    if (!file.endsWith("schema.prisma")) continue;
    const { text, lines } = read(file);
    const models = [...text.matchAll(/\nmodel\s+(\w+)\s*\{([\s\S]*?)\n\}/g)];
    for (const [, name, body] of models) {
      for (const m of body.matchAll(/@relation\([^)]*fields:\s*\[(\w+)\]/g)) {
        const col = m[1];
        const indexed = new RegExp(`@@(index|unique)\\(\\[\\s*${col}\\b`).test(body) || new RegExp(`\\n\\s*${col}\\s+\\w+[^\\n]*@(id|unique)\\b`).test(body);
        if (!indexed) {
          const line = lines.findIndex((l) => l.includes(m[0])) + 1;
          report("env-and-contract", file, line || 1, `${name}.${col}`, "foreign key without a leading index: joins and cascades scan");
        }
      }
      if (/\bDecimal\b/.test(body)) report("env-and-contract", file, 1, name, "Decimal column: the schema uses Float for money and quantities by decision; do not mix");
    }
  }
}

// ---------------------------------------------------------------- output

const order = ["escapes-and-debris", "api-queries", "web", "css", "i18n", "dead-exports", "env-and-contract"];
console.log(`# smell-scan ${SCAN_VERSION}: ${targets.length} file(s) — every line is a candidate to verify, not a finding`);
for (const name of order) {
  const items = sections.get(name) ?? [];
  console.log(`\n## ${name} (${items.length})`);
  if (items.length === 0) {
    console.log("(none)");
    for (const line of infos.get(name) ?? []) console.log(`# ${line}`);
    continue;
  }
  items.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  // The same note many times in one file is one candidate, not many: show
  // three and count the rest.
  const groupKey = (it) => `${it.file}\u0000${(it.note ?? "").replace(/\d+/g, "#")}`;
  const totals = new Map();
  for (const it of items) totals.set(groupKey(it), (totals.get(groupKey(it)) ?? 0) + 1);
  const shown = new Map();
  for (const it of items) {
    const key = groupKey(it);
    const n = (shown.get(key) ?? 0) + 1;
    shown.set(key, n);
    const total = totals.get(key);
    if (total > 6 && n > 3) {
      if (n === 4) console.log(`${it.file}: … +${total - 3} more lines with the same note`);
      continue;
    }
    console.log(`${it.file}:${it.line}: ${it.text}${it.note ? `  ← ${it.note}` : ""}`);
  }
  for (const line of infos.get(name) ?? []) console.log(`# ${line}`);
}
