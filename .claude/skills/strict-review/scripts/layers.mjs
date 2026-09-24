#!/usr/bin/env node
/**
 * Widens a review target to the other layer, so a review never covers the
 * web without the API behind it, or the API without the pages that call it.
 *
 *   printf '%s\n' <files> | node layers.mjs      # prints the ADDED files
 *
 * Web -> API: every `trpc.<key>.<proc>.queryOptions|mutationOptions(` call names a router section in
 * apps/api/src/trpc/trpc.router.ts; the services that section calls
 * (`this.<name>Service.`) resolve through the router's constructor and
 * imports to their folders under apps/api/src, and every source file in
 * those folders is added (service, list vocabulary, helpers).
 *
 * API -> web: every API module folder in the target is mapped back to the
 * router sections whose handlers call its services, and every web file that
 * uses one of those keys is added.
 *
 * A summary goes to stderr as `# other layer: ...` lines.
 */
import fs from "node:fs";
import path from "node:path";

const ROUTER = "apps/api/src/trpc/trpc.router.ts";
const WEB_ROOTS = ["apps/web/app", "apps/web/i18n", "packages/ui/src"];
const SKIP = /\/(node_modules|dist|\.next|\.turbo|generated)\//;

const input = fs
  .readFileSync(0, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);
const inTarget = new Set(input);

if (!fs.existsSync(ROUTER)) {
  console.error(`# other layer: ${ROUTER} not found, not widened`);
  process.exit(0);
}
const router = fs.readFileSync(ROUTER, "utf8");

// --- router map: section key -> service property names ------------------
const sectionRe = /^ {4}([a-zA-Z]+): router\(/gm;
const starts = [...router.matchAll(sectionRe)].map((m) => ({ key: m[1], at: m.index }));
const sections = new Map();
starts.forEach((s, i) => {
  const body = router.slice(s.at, starts[i + 1]?.at ?? router.length);
  const services = new Set([...body.matchAll(/this\.([a-zA-Z]+Service)\b/g)].map((m) => m[1]));
  sections.set(s.key, services);
});

// service property -> class -> folder
const propToClass = new Map(
  [...router.matchAll(/private readonly ([a-zA-Z]+): ([A-Z][a-zA-Z]+)/g)].map((m) => [m[1], m[2]]),
);
const classToDir = new Map(
  [...router.matchAll(/import \{[^}]*\b([A-Z][a-zA-Z]+Service)\b[^}]*\} from "\.\.\/([^/"]+)\//g)].map(
    (m) => [m[1], `apps/api/src/${m[2]}`],
  ),
);
const propToDir = (prop) => classToDir.get(propToClass.get(prop) ?? "");

function listSource(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (SKIP.test(`/${p}/`)) continue;
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|mts|css|json)$/.test(e.name)) out.push(p);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

const added = new Set();
const add = (f) => {
  if (!inTarget.has(f)) added.add(f);
};

// --- web -> api ----------------------------------------------------------
const webFiles = input.filter((f) => /^(apps\/web|packages\/ui)\//.test(f) && /\.(ts|tsx)$/.test(f));
const keysUsed = new Set();
for (const f of webFiles) {
  if (!fs.existsSync(f)) continue;
  const src = fs.readFileSync(f, "utf8");
  // Calls only: `trpc.x.y.queryOptions(` / `mutationOptions(`. A bare
  // `queryKey()` is a cache invalidation and does not make x's module part of
  // the review (roll-detail invalidating nav.counts is not a nav review).
  for (const m of src.matchAll(/\btrpc\.([a-zA-Z]+)\.[a-zA-Z]+\.(?:queryOptions|mutationOptions|infiniteQueryOptions)\(/g))
    keysUsed.add(m[1]);
}
const apiDirs = new Set();
for (const key of keysUsed) {
  for (const prop of sections.get(key) ?? []) {
    const dir = propToDir(prop);
    if (dir) apiDirs.add(dir);
  }
}
for (const dir of apiDirs) listSource(dir).forEach(add);

// --- api -> web ----------------------------------------------------------
const targetApiDirs = new Set(
  input.map((f) => f.match(/^(apps\/api\/src\/[^/]+)\//)?.[1]).filter((d) => d && d !== "apps/api/src/trpc"),
);
const routerInTarget = inTarget.has(ROUTER);
const keysForApi = new Set();
for (const [key, services] of sections) {
  if (routerInTarget) {
    keysForApi.add(key);
    continue;
  }
  for (const prop of services) if (targetApiDirs.has(propToDir(prop))) keysForApi.add(key);
}
const webCallers = [];
if (keysForApi.size > 0) {
  const pattern = new RegExp(`\\btrpc\\.(${[...keysForApi].join("|")})\\.`);
  for (const root of WEB_ROOTS) {
    for (const f of listSource(root)) {
      if (!/\.(ts|tsx)$/.test(f)) continue;
      if (pattern.test(fs.readFileSync(f, "utf8"))) {
        webCallers.push(f);
        add(f);
      }
    }
  }
}

console.error(
  `# other layer (web -> api): router keys ${[...keysUsed].sort().join(", ") || "none"} -> ${
    [...apiDirs].sort().join(" ") || "no API module"
  }`,
);
console.error(
  `# other layer (api -> web): ${
    routerInTarget ? "router in target, every key" : [...keysForApi].sort().join(", ") || "no router key"
  } -> ${webCallers.length} web file(s)`,
);
for (const f of [...added].sort()) console.log(f);
