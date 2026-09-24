#!/usr/bin/env node
/**
 * Screenshots signed-in pages of the running web app with headless Chrome
 * over CDP (Node 24's built-in WebSocket, no dependencies).
 *
 *   TOKEN=$(bash session.sh)
 *   node shoot.mjs "$TOKEN" 1280 /tmp/shots/clients \
 *     'http://localhost:3000/clients|fr' \
 *     'http://localhost:3000/clients|ar|document.querySelectorAll("div[role=row]")[1].click()'
 *
 * Each spec is `url|locale|js`: the bp-locale cookie is set to `locale`
 * (en/fr/ar/es) before navigating, and `js` (optional) runs in the page
 * before the capture — click a row, open a dialog, type into a field. Files
 * are `<prefix>-<n>-<locale>.png`; console errors are printed at the end.
 *
 * Selectors that matter here:
 *   - DataTable rows are `div[role="row"]`; index 0 is the header row.
 *   - Dialogs are native `<dialog>` with no role: query `dialog[open]`.
 *   - The top bar's "Go to…" box matches generic `input[type=search]`
 *     selectors first; pick a table's search by its placeholder text.
 *   - React inputs: set the value through the prototype setter, then
 *     dispatch `input`, or React ignores the change.
 *
 * Env: CHROME (binary, default google-chrome), WAIT_MS (settle time after
 * navigation, default 3500), SHOT_HEIGHT cap (default 2000).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [token, widthArg, prefix, ...specs] = process.argv.slice(2);
if (!token || !widthArg || !prefix || specs.length === 0) {
  console.error("usage: node shoot.mjs <token> <width> <prefix> '<url>|<locale>[|<js>]'...");
  process.exit(2);
}
const width = Number(widthArg);
const port = 9222 + Math.floor(Math.random() * 1000);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "bica-shoot-"));
fs.mkdirSync(path.dirname(prefix), { recursive: true });

const chrome = spawn(
  process.env.CHROME ?? "google-chrome",
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    "--no-sandbox",
    "--disable-gpu",
    "--no-first-run",
    "--hide-scrollbars",
    `--window-size=${width},900`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);
// Chrome keeps writing to its profile for a moment after SIGTERM, so the
// directory is removed after the process has exited, with retries.
const removeProfile = () => {
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    /* a leftover temp dir is not worth failing the run */
  }
};
const shutdown = async () => {
  if (chrome.exitCode === null) {
    chrome.kill();
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 3000);
      chrome.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
  removeProfile();
};
process.on("exit", removeProfile);
process.on("SIGINT", async () => {
  await shutdown();
  process.exit(130);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
for (let i = 0; i < 80 && !page; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    page = targets.find((t) => t.type === "page");
  } catch {
    /* not up yet */
  }
  if (!page) await sleep(250);
}
if (!page) {
  console.error("chrome did not start (set CHROME to the binary path)");
  await shutdown();
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let nextId = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  } else if (d.method === "Runtime.exceptionThrown") {
    consoleErrors.push(d.params.exceptionDetails?.exception?.description ?? "exception");
  } else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
    consoleErrors.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value ?? r.result?.exceptionDetails?.text ?? null;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
// `localhost` covers both :3000 and :3001; the session cookie is HttpOnly on the API origin.
await send("Network.setCookie", { name: "better-auth.session_token", value: token, domain: "localhost", path: "/", httpOnly: true });

const waitMs = Number(process.env.WAIT_MS ?? 3500);
const heightCap = Number(process.env.SHOT_HEIGHT ?? 2000);
let n = 0;
for (const spec of specs) {
  const [url, locale = "en", ...rest] = spec.split("|");
  const js = rest.join("|"); // a `||` inside the snippet survives the split
  await send("Network.setCookie", { name: "bp-locale", value: locale, domain: "localhost", path: "/" });
  await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url });
  await sleep(waitMs);
  if (js) {
    const out = await evaluate(js);
    console.log(`js -> ${JSON.stringify(out)}`);
    await sleep(1500);
  }
  const height = Math.min(Number(await evaluate("document.documentElement.scrollHeight")) || 900, heightCap);
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const file = `${prefix}-${n++}-${locale}.png`;
  fs.writeFileSync(file, Buffer.from(shot.result.data, "base64"));
  const dirLang = await evaluate("document.documentElement.dir + ' ' + document.documentElement.lang");
  console.log(`wrote ${file}  (${width}x${height}, html dir/lang: ${dirLang})`);
}
console.log(`console errors: ${consoleErrors.length ? JSON.stringify(consoleErrors) : "none"}`);
ws.close();
await shutdown();
process.exit(0);
