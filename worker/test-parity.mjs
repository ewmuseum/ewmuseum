#!/usr/bin/env node
/**
 * THE MUSEUM — R2 Worker parity test.
 *
 * Runs `worker/index.mjs` for real, in the real Workers runtime (workerd, via
 * `wrangler dev --local`), against a real R2 binding (miniflare's local
 * simulator), seeded with real files out of this repo by the real deploy script
 * (`scripts/r2-sync.mjs --local`). Nothing here is a mock. The only thing that
 * is not production is the storage backend and the domain.
 *
 * No Cloudflare account, no login, no credentials: `wrangler dev --local` and
 * `wrangler r2 object put --local` both run entirely on this machine.
 *
 *   node worker/test-parity.mjs            # run the suite
 *   node worker/test-parity.mjs --keep     # leave the dev server up afterwards
 *   node worker/test-parity.mjs --verbose  # print every assertion, not just fails
 *
 * Exits 0 on green, 1 on any failure. Per this repo's first invariant, read the
 * exit code, not the printed output.
 *
 * WHAT "PARITY" MEANS HERE, STATED HONESTLY. The expectations below are derived
 * from two things:
 *   (a) what is checked into this repo and therefore knowable exactly — the
 *       gate's cookie name, token format and status codes (functions/_middleware.js),
 *       the header policy (`_headers`), the 404 page, the served file tree, and
 *       the routing assumption docs/OPERATIONS.md states in its own words for
 *       promotions.html vs promotions/ ("/promotions resolves to promotions.html
 *       ... /promotions/<id>/ resolves to promotions/<id>/index.html");
 *   (b) Cloudflare Pages' documented default asset routing
 *       (`html_handling: "auto-trailing-slash"`, `not_found_handling: "404-page"`),
 *       which is where the `.html` -> pretty 308 rule comes from.
 *
 * (a) is verified. (b) is documented-but-not-observed from this machine: the
 * live site is behind the invite gate and no session here holds a cookie or
 * Cloudflare credentials. So the 308 rules are asserted against the documented
 * model, not against a captured live response. `worker/probe-pages.mjs` exists
 * for exactly this gap — the Janitor runs it against the live Pages site with
 * their own gate cookie and it prints the same table these tests assert, so the
 * two can be diffed by eye before cutover. If Pages turns out to differ, the
 * fix is in resolvePath() in worker/index.mjs and nowhere else.
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "node:net";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PORT = Number(process.env.PARITY_PORT || 8977);
const HOST = "127.0.0.1";
const BASE = `http://${HOST}:${PORT}`;
const STATE = resolve(ROOT, ".wrangler", "parity-state");

const SECRET = "parity-test-secret-not-a-real-one";
const CODE = "OPEN SESAME";

const argv = process.argv.slice(2);
const KEEP = argv.includes("--keep");
const VERBOSE = argv.includes("--verbose");

// ---------------------------------------------------------------------------
// The sample. Small enough to seed in under a minute, chosen so that every
// routing rule and every interesting collision in the real tree is covered.
// ---------------------------------------------------------------------------
const SAMPLE = [
  "index.html",                                            // the front page
  "404.html",                                              // the site's own 404
  "style.css",                                             // a static asset
  "js/list.js",                                            // a script
  "promotions.html",                                       // a wing listing
  "promotions/giwf/index.html",                            // a wing's own page
  "promotions/giwf/holdings.html",                         // a page inside a wing
  "promotions/nticw/archive/chapter-one-2003-02-19.html",  // a served archive doc
  "rps.html",                                              // collision A: the file
  "rps/index.html",                                        // collision A: the dir
  "shows.html",                                            // collision B: the file
  "shows/index.html",                                      // collision B: the dir
  "data/aliases.json",                                     // a data JSON
  "galleries/img/characters/seymour-almasy-posed.jpg",     // a binary
];

// ---------------------------------------------------------------------------
// Assertion plumbing
// ---------------------------------------------------------------------------

const results = [];
let currentGroup = "";

function group(name) { currentGroup = name; }

function record(name, ok, detail) {
  results.push({ group: currentGroup, name, ok, detail });
  if (!ok) console.log(`  FAIL  ${name}\n        ${detail}`);
  else if (VERBOSE) console.log(`  ok    ${name}`);
}

function check(name, actual, expected, how = "===") {
  const ok = how === "includes" ? String(actual).includes(expected) : actual === expected;
  record(name, ok, ok ? "" : `expected ${how === "includes" ? "to include " : ""}${JSON.stringify(expected)}, got ${JSON.stringify(typeof actual === "string" && actual.length > 200 ? actual.slice(0, 200) + "…" : actual)}`);
  return ok;
}

function fileText(rel) { return readFileSync(resolve(ROOT, rel), "utf8"); }

// ---------------------------------------------------------------------------
// Raw HTTP, for the one question fetch() cannot answer: does the runtime put
// the six clacks lines on the wire as six separate header lines, or fold them
// into one comma-joined line? `_headers`' own comment flags this as the thing
// to watch ("If Cloudflare Pages ever collapses repeated same-key header lines
// into one on the wire, switch to a single comma-joined line instead"), so the
// test looks at the actual bytes rather than at Headers.get()'s tidy join.
// ---------------------------------------------------------------------------
function rawGet(path, cookie) {
  return new Promise((res, rej) => {
    const socket = connect(PORT, HOST, () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: ${HOST}:${PORT}\r\nConnection: close\r\n` +
          (cookie ? `Cookie: ${cookie}\r\n` : "") +
          `\r\n`,
      );
    });
    let buf = "";
    socket.setEncoding("utf8");
    socket.on("data", (d) => { buf += d; });
    socket.on("error", rej);
    socket.on("close", () => {
      const split = buf.indexOf("\r\n\r\n");
      const head = split === -1 ? buf : buf.slice(0, split);
      const lines = head.split("\r\n");
      res({ statusLine: lines[0], headerLines: lines.slice(1) });
    });
    setTimeout(() => { socket.destroy(); rej(new Error("raw request timed out")); }, 15000);
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", ...opts });
  return { code: r.status ?? 1, out: r.stdout || "", err: r.stderr || "" };
}

/**
 * The bucket name `wrangler dev` will actually bind MUSEUM_BUCKET to.
 *
 * THIS COST A DEBUGGING ROUND, so it is written down: `wrangler dev` binds the
 * PREVIEW bucket (`preview_bucket_name`), not `bucket_name` — in local mode as
 * well as remote. Seed `bucket_name` and every content request 404s while every
 * pure-routing assertion still passes, which reads exactly like a broken router
 * and is not. The same trap is waiting for anyone who rehearses a sync against
 * `wrangler dev --remote`: the objects land in the production bucket and the
 * dev server serves the empty staging one. Falls back to `bucket_name` when no
 * preview bucket is configured.
 */
function devBucket() {
  const toml = readFileSync(resolve(ROOT, "worker", "wrangler.toml"), "utf8");
  const preview = toml.match(/^\s*preview_bucket_name\s*=\s*"([^"]+)"/m);
  const main = toml.match(/^\s*bucket_name\s*=\s*"([^"]+)"/m);
  const name = (preview && preview[1]) || (main && main[1]);
  if (!name) throw new Error("worker/wrangler.toml has no r2 bucket name");
  return name;
}

function wranglerArgv() {
  return existsSync(resolve(ROOT, "node_modules", ".bin", "wrangler"))
    ? { cmd: resolve(ROOT, "node_modules", ".bin", "wrangler"), pre: [] }
    : { cmd: "npx", pre: ["--yes", "wrangler"] };
}

async function seed() {
  console.log("parity: baking _headers into worker/headers.json…");
  const bake = sh(process.execPath, [resolve(ROOT, "scripts", "build-worker-headers.mjs")]);
  if (bake.code !== 0) { console.error(bake.err || bake.out); throw new Error("build-worker-headers failed"); }
  console.log(`  ${bake.out.trim()}`);

  console.log(`parity: clearing local R2 state at ${STATE}…`);
  rmSync(STATE, { recursive: true, force: true });
  mkdirSync(STATE, { recursive: true });

  console.log(`parity: seeding ${SAMPLE.length} objects into the local R2 simulator via scripts/r2-sync.mjs…`);
  console.log(`  (bucket ${devBucket()} — see devBucket() for why it is the PREVIEW name)`);
  const t0 = Date.now();
  const includes = SAMPLE.flatMap((p) => ["--include", p]);
  const sync = sh(process.execPath, [
    resolve(ROOT, "scripts", "r2-sync.mjs"),
    "--local", "--persist-to", STATE, "--bucket", devBucket(), "--concurrency", "6", "--yes", ...includes,
  ]);
  if (sync.code !== 0) { console.error(sync.out); console.error(sync.err); throw new Error("r2-sync seeding failed"); }
  console.log(`  seeded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // A restricted r2-sync run deliberately does NOT write the manifest, so put a
  // stand-in here — the suite asserts that /_manifest.json is NOT reachable,
  // and that assertion is only meaningful with an object actually sitting there.
  const w = wranglerArgv();
  const bucket = devBucket();
  const tmp = join(STATE, "fake-manifest.json");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(tmp, JSON.stringify({ files: { "index.html": "deadbeef" } }));
  const put = sh(w.cmd, [...w.pre, "r2", "object", "put", `${bucket}/_manifest.json`, "--file", tmp, "--content-type", "application/json", "--local", "--persist-to", STATE]);
  if (put.code !== 0) { console.error(put.err || put.out); throw new Error("could not place the stand-in _manifest.json"); }
  console.log("  placed a stand-in _manifest.json (the suite asserts it is NOT servable)");
}

let devProc = null;

async function startDev() {
  const w = wranglerArgv();
  const args = [
    ...w.pre, "dev",
    "-c", resolve(ROOT, "worker", "wrangler.toml"),
    "--local", "--persist-to", STATE,
    "--ip", HOST, "--port", String(PORT),
    "--var", `GATE_SECRET:${SECRET}`,
    "--var", `INVITE_CODES:${CODE}`,
    "--log-level", "warn",
    "--show-interactive-dev-session=false",
  ];
  console.log(`parity: starting wrangler dev on ${BASE} …`);
  devProc = spawn(w.cmd, args, { cwd: ROOT, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  devProc.stdout.on("data", (d) => { log += d; });
  devProc.stderr.on("data", (d) => { log += d; });

  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (devProc.exitCode !== null) throw new Error(`wrangler dev exited early (code ${devProc.exitCode}):\n${log}`);
    try {
      const r = await fetch(`${BASE}/`, { redirect: "manual" });
      if (r.status) { await r.arrayBuffer(); console.log(`  up after ${((120000 - (deadline - Date.now())) / 1000).toFixed(1)}s`); return; }
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`wrangler dev never came up on ${BASE}:\n${log}`);
}

function stopDev() {
  if (!devProc || KEEP) return;
  try { process.kill(-devProc.pid, "SIGTERM"); } catch { /* already gone */ }
  try { devProc.kill("SIGKILL"); } catch { /* already gone */ }
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

const EXPECTED_CLACKS = [
  "GNU Sean Simon Williams",
  "GNU Jaymes Faulkner",
  "GNU Chris Williams",
  "GNU Joe Smallze",
  "GNU Tim Fitzgerald",
  "GNU Ed Wilson",
];

function get(path, { cookie, headers = {}, method = "GET" } = {}) {
  return fetch(BASE + path, {
    method,
    redirect: "manual",
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers },
  });
}

async function run() {
  // -- THE GATE, unauthenticated -------------------------------------------
  // The gate runs before routing, exactly as functions/_middleware.js runs
  // before Pages' asset router. The point of the first three assertions is
  // that a stranger cannot tell a real path from a fake one — no 308, no 404,
  // no difference at all.
  group("gate — closed door");
  {
    const r = await get("/");
    const body = await r.text();
    check("GET / (no cookie) is 200", r.status, 200);
    check("GET / (no cookie) is the gate page", body, "By appointment only", "includes");
    check("gate page is text/html", r.headers.get("content-type"), "text/html; charset=utf-8");
    check("gate page is no-store", r.headers.get("cache-control"), "no-store");
    check("gate page carries X-Robots-Tag from _headers", r.headers.get("x-robots-tag"), "noindex");
    check("gate page carries the clacks overhead", r.headers.get("x-clacks-overhead"), EXPECTED_CLACKS.join(", "));

    const real = await get("/promotions/giwf/");
    const realBody = await real.text();
    check("a REAL path leaks nothing (status)", real.status, 200);
    check("a REAL path leaks nothing (body is the gate)", realBody === body, true);

    const fake = await get("/no-such-thing-anywhere");
    const fakeBody = await fake.text();
    check("a FAKE path is indistinguishable from a real one", fakeBody === body, true);
    check("a FAKE path does not 404 at a stranger", fake.status, 200);

    const html = await get("/promotions.html");
    check("no 308 leaks to a stranger", html.status, 200);
    await html.text();
  }

  // -- THE GATE, signing in ------------------------------------------------
  group("gate — signing the book");
  let cookie = "";
  {
    const bad = await fetch(`${BASE}/gate`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: "NOT-THE-WORD" }).toString(),
    });
    const badBody = await bad.text();
    check("wrong code is 200", bad.status, 200);
    check("wrong code says so", badBody, "isn't on the appointment book", "includes");

    const good = await fetch(`${BASE}/gate`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      // lowercase + extra whitespace: normalize() must still admit it
      body: new URLSearchParams({ code: "  open   sesame " }).toString(),
    });
    await good.text();
    check("right code is 303", good.status, 303);
    check("right code sends you to the lobby", good.headers.get("location"), "/");
    const setCookie = good.headers.get("set-cookie") || "";
    check("cookie is named museum_gate", setCookie.startsWith("museum_gate="), true);
    check("cookie is HttpOnly", setCookie, "HttpOnly", "includes");
    check("cookie is Secure", setCookie, "Secure", "includes");
    check("cookie is SameSite=Lax", setCookie, "SameSite=Lax", "includes");
    check("cookie lasts a year", setCookie, "Max-Age=31536000", "includes");
    const token = setCookie.split(";")[0].slice("museum_gate=".length);
    check("token is <expiry>.<hmac-hex>", /^\d{10,}\.[0-9a-f]{64}$/.test(token), true);
    cookie = `museum_gate=${token}`;

    const junk = await get("/", { cookie: "museum_gate=9999999999.deadbeef" });
    const junkBody = await junk.text();
    check("a forged cookie gets the closed door", junkBody, "By appointment only", "includes");
    const expired = await get("/", { cookie: "museum_gate=1000000000.deadbeef" });
    check("an expired cookie gets the closed door", (await expired.text()).includes("By appointment only"), true);
  }

  // -- CONTENT -------------------------------------------------------------
  group("content — the front page");
  let frontEtag = "";
  {
    const r = await get("/", { cookie });
    const body = await r.text();
    check("GET / is 200", r.status, 200);
    check("GET / is index.html byte for byte", body === fileText("index.html"), true);
    check("GET / is text/html", r.headers.get("content-type"), "text/html; charset=utf-8");
    check("GET / honours _headers Cache-Control", r.headers.get("cache-control"), "no-cache");
    check("GET / honours _headers X-Robots-Tag", r.headers.get("x-robots-tag"), "noindex");
    check("GET / carries all six clacks names", r.headers.get("x-clacks-overhead"), EXPECTED_CLACKS.join(", "));
    check("GET / has an ETag", /^(W\/)?"/.test(r.headers.get("etag") || ""), true);
    check("GET / advertises range support", r.headers.get("accept-ranges"), "bytes");
    frontEtag = r.headers.get("etag");
  }

  group("content — the clacks on the wire");
  {
    // Six separate header lines, in _headers order, not one folded line.
    const raw = await rawGet("/", cookie);
    const clacks = raw.headerLines.filter((l) => /^x-clacks-overhead:/i.test(l)).map((l) => l.slice(l.indexOf(":") + 1).trim());
    check("six discrete X-Clacks-Overhead lines on the wire", clacks.length, 6);
    check("in _headers order", clacks.join("|"), EXPECTED_CLACKS.join("|"));
  }

  group("routing — pretty URLs");
  {
    const cases = [
      // [path,                             expected status, expected Location]
      ["/index.html",                       308, "/"],
      ["/promotions.html",                  308, "/promotions"],
      ["/promotions/giwf/index.html",       308, "/promotions/giwf/"],
      ["/promotions/giwf",                  308, "/promotions/giwf/"],
      ["/promotions/",                      308, "/promotions"],
      ["/rps.html",                         308, "/rps"],
      ["/shows.html",                       308, "/shows"],
      ["/promotions/nticw/archive/chapter-one-2003-02-19.html", 308, "/promotions/nticw/archive/chapter-one-2003-02-19"],
      ["//index.html",                      308, "/index.html"],
    ];
    for (const [path, status, location] of cases) {
      const r = await get(path, { cookie });
      await r.text();
      check(`${path} -> ${status}`, r.status, status);
      check(`${path} -> Location ${location}`, r.headers.get("location"), location);
    }

    // A 308 must carry the query string across, or /rps.html?promo=mwe (a real
    // link shape in this tree) would lose its filter on the way in.
    const q = await get("/promotions.html?promo=giwf&x=1", { cookie });
    await q.text();
    check("308 carries the query string", q.headers.get("location"), "/promotions?promo=giwf&x=1");
  }

  group("routing — the file/directory collisions");
  {
    // rps.html and rps/index.html are DIFFERENT pages, both linked, both live.
    // The same for shows. If these two ever swap, thousands of links break
    // quietly — they still 200, they just show the wrong page.
    const flat = await get("/rps", { cookie });
    const flatBody = await flat.text();
    check("/rps is 200", flat.status, 200);
    check("/rps is rps.html (the flat instrument)", flatBody === fileText("rps.html"), true);

    const byYear = await get("/rps/", { cookie });
    const byYearBody = await byYear.text();
    check("/rps/ is 200", byYear.status, 200);
    check("/rps/ is rps/index.html (by year)", byYearBody === fileText("rps/index.html"), true);
    check("the two are genuinely different pages", flatBody !== byYearBody, true);

    const sFlat = await get("/shows", { cookie });
    check("/shows is shows.html", (await sFlat.text()) === fileText("shows.html"), true);
    const sYear = await get("/shows/", { cookie });
    check("/shows/ is shows/index.html", (await sYear.text()) === fileText("shows/index.html"), true);

    // docs/OPERATIONS.md's own stated routing assumption, asserted directly.
    const wingList = await get("/promotions", { cookie });
    check("/promotions is promotions.html (the wing listing)", (await wingList.text()) === fileText("promotions.html"), true);
    const wing = await get("/promotions/giwf/", { cookie });
    check("/promotions/giwf/ is the wing's own page", (await wing.text()) === fileText("promotions/giwf/index.html"), true);
  }

  group("content — the other file classes");
  {
    const doc = await get("/promotions/nticw/archive/chapter-one-2003-02-19", { cookie });
    const docBody = await doc.text();
    check("an archive doc serves at its pretty URL", doc.status, 200);
    check("an archive doc is byte-identical (verbatim material is never reshaped)", docBody === fileText("promotions/nticw/archive/chapter-one-2003-02-19.html"), true);

    const json = await get("/data/aliases.json", { cookie });
    const jsonBody = await json.text();
    check("a data JSON is 200", json.status, 200);
    check("a data JSON is application/json", json.headers.get("content-type"), "application/json" /* observed-Pages parity, probe-diff 2026-08-26 */);
    check("a data JSON is byte-identical", jsonBody === fileText("data/aliases.json"), true);
    check("a data JSON parses", (() => { try { JSON.parse(jsonBody); return true; } catch { return false; } })(), true);

    const css = await get("/style.css", { cookie });
    check("style.css is text/css", css.headers.get("content-type"), "text/css; charset=utf-8");
    check("style.css is byte-identical", (await css.text()) === fileText("style.css"), true);

    const js = await get("/js/list.js", { cookie });
    check("list.js is text/javascript", js.headers.get("content-type"), "application/javascript" /* observed-Pages parity, probe-diff 2026-08-26 */);
    await js.text();

    const jpg = await get("/galleries/img/characters/seymour-almasy-posed.jpg", { cookie });
    const bytes = new Uint8Array(await jpg.arrayBuffer());
    const onDisk = readFileSync(resolve(ROOT, "galleries/img/characters/seymour-almasy-posed.jpg"));
    check("a photograph is image/jpeg", jpg.headers.get("content-type"), "image/jpeg");
    check("a photograph is byte-identical", Buffer.from(bytes).equals(onDisk), true);
  }

  group("404");
  {
    const r = await get("/wings/there-is-no-such-wing/", { cookie });
    const body = await r.text();
    check("a missing path is 404", r.status, 404);
    check("a missing path serves the site's own 404.html", body === fileText("404.html"), true);
    check("the 404 is text/html", r.headers.get("content-type"), "text/html; charset=utf-8");
    check("the 404 still carries the clacks overhead", r.headers.get("x-clacks-overhead"), EXPECTED_CLACKS.join(", "));

    const dir = await get("/data/", { cookie });
    await dir.text();
    check("a directory with no index and no sibling .html is 404", dir.status, 404);
  }

  group("the manifest is not museum content");
  {
    const r = await get("/_manifest.json", { cookie });
    await r.text();
    check("/_manifest.json is 404, not a path listing of a private archive", r.status, 404);
  }

  group("conditional and range requests");
  {
    // _headers sets no-cache, which means the browser revalidates on EVERY
    // view. That is only affordable because a revalidation costs a 304 with no
    // body — `_headers`' own comment says exactly this. Assert it works.
    const r = await get("/", { cookie, headers: { "If-None-Match": frontEtag } });
    const body = await r.text();
    check("If-None-Match on a current ETag is 304", r.status, 304);
    check("a 304 carries no body", body, "");

    const stale = await get("/", { cookie, headers: { "If-None-Match": '"not-the-etag"' } });
    check("If-None-Match on a stale ETag is a full 200", stale.status, 200);
    await stale.text();

    // Compared as BYTES, not characters. style.css carries multi-byte
    // punctuation, so a 100-byte range decodes to 98 characters — comparing
    // `.text().length` to 100 fails against a Worker that is behaving perfectly.
    const range = await get("/style.css", { cookie, headers: { Range: "bytes=0-99" } });
    const chunk = Buffer.from(new Uint8Array(await range.arrayBuffer()));
    const whole = readFileSync(resolve(ROOT, "style.css"));
    check("a Range request is 206", range.status, 206);
    check("a Range request returns exactly the bytes asked for", chunk.length, 100);
    check("a Range request reports Content-Range", range.headers.get("content-range"), `bytes 0-99/${whole.length}`);
    check("the range is the head of the file", chunk.equals(whole.subarray(0, 100)), true);
  }

  group("methods");
  {
    const head = await get("/", { cookie, method: "HEAD" });
    const headBody = await head.text();
    check("HEAD / is 200", head.status, 200);
    check("HEAD / has no body", headBody, "");
    check("HEAD / reports the real length", Number(head.headers.get("content-length")), Buffer.byteLength(fileText("index.html")));
    check("HEAD / still carries the clacks overhead", head.headers.get("x-clacks-overhead"), EXPECTED_CLACKS.join(", "));

    const post = await fetch(`${BASE}/index.html`, { method: "POST", redirect: "manual", headers: { Cookie: cookie }, body: "x" });
    await post.text();
    check("POST to a static path is 405", post.status, 405);
    check("405 says what is allowed", post.headers.get("allow"), "GET, HEAD");

    const regate = await fetch(`${BASE}/gate`, { method: "POST", redirect: "manual", headers: { Cookie: cookie, "content-type": "application/x-www-form-urlencoded" }, body: "code=whatever" });
    await regate.text();
    check("an admitted visitor re-posting the gate form is sent inside", regate.status, 303);
  }
}

// ---------------------------------------------------------------------------

let exitCode = 0;
try {
  await seed();
  await startDev();
  console.log("\nparity: running assertions…\n");
  await run();
} catch (e) {
  console.error(`\nparity: HARNESS ERROR — ${e?.stack || e}`);
  exitCode = 1;
} finally {
  if (KEEP) console.log(`\nparity: --keep — dev server still running at ${BASE} (pid ${devProc?.pid}); kill it yourself.`);
  else stopDev();
}

const failed = results.filter((r) => !r.ok);
const groups = [...new Set(results.map((r) => r.group))];
console.log("\n" + "-".repeat(64));
for (const g of groups) {
  const inGroup = results.filter((r) => r.group === g);
  const bad = inGroup.filter((r) => !r.ok).length;
  console.log(`  ${bad ? "FAIL" : "ok  "}  ${g} — ${inGroup.length - bad}/${inGroup.length}`);
}
console.log("-".repeat(64));
console.log(`parity: ${results.length - failed.length}/${results.length} assertions passed.`);
if (failed.length) {
  console.log(`parity: ${failed.length} FAILED:`);
  for (const f of failed) console.log(`  - [${f.group}] ${f.name}: ${f.detail}`);
  exitCode = 1;
}
if (!results.length) exitCode = 1;
console.log(exitCode === 0 ? "parity: GREEN." : "parity: RED.");
process.exit(exitCode);
