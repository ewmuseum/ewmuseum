#!/usr/bin/env node
/**
 * THE MUSEUM — incremental R2 deploy.
 *
 * Cloudflare Pages caps a deploy at 20,000 files and the museum is past 15,600.
 * R2 has no such ceiling, so the served tree lives in a bucket and
 * `worker/index.mjs` serves it. This script is what puts it there.
 *
 * It is INCREMENTAL by design, and that is the whole point. Pages re-uploads a
 * whole site every deploy; at this file count that is slow and, past 20,000,
 * impossible. Here, a manifest of path -> sha256 lives in the bucket alongside
 * the tree (`_manifest.json`), and each run uploads only what actually changed.
 * A typical accession wave touches a few hundred files out of 15,600 — so a
 * deploy is a few hundred puts, not fifteen thousand.
 *
 *   node scripts/r2-sync.mjs --dry-run     # print the diff, change nothing
 *   node scripts/r2-sync.mjs               # sync to the real bucket
 *   node scripts/r2-sync.mjs --local --persist-to .wrangler/state
 *                                          # seed the local miniflare R2 (tests)
 *
 * FLAGS
 *   --dry-run            print the diff and exit; touches nothing
 *   --local              use wrangler's local (miniflare) R2 instead of the real
 *                        bucket — this is what worker/test-parity.mjs uses
 *   --remote             force the real bucket (the default when --local is absent)
 *   --persist-to DIR     local-storage directory (must match `wrangler dev`'s)
 *   --bucket NAME        override the bucket name from worker/wrangler.toml
 *   --concurrency N      parallel wrangler processes (default 8)
 *   --include PREFIX     restrict the walk to paths under PREFIX (repeatable);
 *                        used by the parity test to seed a sample
 *   --manifest-key KEY   store the manifest under a different object name; a
 *                        restricted (--include) run refuses to rewrite the real
 *                        manifest, but will write a differently-named one, which
 *                        is how worker/test-sync.mjs exercises the diff
 *   --prune / --no-prune delete bucket objects the tree no longer has
 *                        (default: prune)
 *   --yes                skip the confirmation prompt on a destructive run
 *   --first-run          authorise a FIRST RUN (full upload) against the real
 *                        bucket when it holds no manifest; without it a
 *                        remote run that finds no manifest stops (exit 4)
 *   --budget DUR         a time budget for the whole run (90s, 35m, 1h; a bare
 *                        number is seconds), counted from the script's start.
 *                        When it runs out the script starts no new put or
 *                        delete, lets the in-flight ones finish, writes a
 *                        checkpoint manifest and exits 5 ("partial, progress
 *                        kept"). Default: no budget.
 *   --checkpoint-every N write a checkpoint manifest after every N successful
 *                        puts (default 500) ...
 *   --checkpoint-secs S  ... or S seconds after the last one, whichever comes
 *                        first (default 120). 0 for both leaves only the
 *                        checkpoint written when a run stops on a failure or
 *                        on its budget.
 *   --transport T        how objects reach the bucket: `wrangler` (the default:
 *                        one `wrangler r2 object put` process per file, through
 *                        Cloudflare's API — about 2 puts/s and capped at 1,200
 *                        requests per 5 minutes) or `s3` (R2's S3-compatible
 *                        endpoint, signed requests straight from this process;
 *                        remote only). See S3 TRANSPORT below. The
 *                        environment's R2_SYNC_TRANSPORT sets the default (so
 *                        scripts/ops/chain.sh can switch without an edit);
 *                        the flag wins.
 *   --verify-sample N    with --dry-run --transport s3 only, READ-ONLY: HEAD N
 *                        objects the diff calls unchanged (spread across the
 *                        tree) and compare each one's ETag with the local
 *                        file's MD5 and its Content-Type with what a put would
 *                        send. Exit 6 if any differs or is missing.
 *
 * S3 TRANSPORT (2026-10-04, D279 (d)). Same walk, same guards, same diff, same
 * manifest format, same checkpoints, same --budget drain and exit codes; only
 * the wire changes. Each put sends the SAME Content-Type the wrangler path
 * sends (contentTypeFor(); wrangler sets nothing else — no cache-control, no
 * custom metadata), plus Content-MD5 and the body's sha256, so R2 refuses a
 * body that was damaged in transit, and the put is refused locally if the file
 * changed since it was hashed (the manifest only ever records the bytes that
 * were sent). Default concurrency 16; 408/429/5xx and network errors retry with
 * exponential backoff and jitter (6 tries); past the --budget no retry starts.
 *   Credentials: read at run time from $R2_ENV_FILE (default
 *   ~/.config/wwv/r2.env; keys R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY), never
 *   printed, logged or written. Requests are signed in headers (SigV4); no
 *   presigned URL is ever made. Account id: $R2_ACCOUNT_ID, else an
 *   R2_ACCOUNT_ID line in that file, else `wrangler whoami` (exactly one
 *   account, or the run stops). Endpoint https://<account>.r2.cloudflarestorage.com,
 *   region auto; $R2_S3_ENDPOINT overrides it (offline tests only).
 *
 * EXIT CODES. 0 done (or nothing to do); 1 refused or an operation failed
 * (progress kept, see below); 2 bad usage; 3 the manifest could not be read
 * (nothing uploaded); 4 a remote first run without --first-run; 5 the --budget
 * ran out (partial, progress kept: the next run carries on from the checkpoint);
 * 6 a --verify-sample dry run found an object that differs (read-only; nothing changed).
 *
 * FIRST RUN. With no `_manifest.json` in the bucket, everything is "added" and
 * the script says so plainly before it starts. Against the real bucket a first
 * run must be asked for with --first-run (2026-09-29: cycle 216 read a failed
 * manifest fetch as "no manifest" and began re-putting all 96,088 objects).
 * Only wrangler's own missing-object message counts as "no manifest"; any
 * other failure to read it is retried with backoff and then STOPS the sync
 * (exit 3) — it is never a full upload. --local runs (the test harnesses)
 * still treat a missing manifest as a first run without the flag. 15,600 objects through
 * `wrangler r2 object put` is one process per file; even at --concurrency 8
 * that is roughly an hour of wall clock. That is a one-time cost and it is
 * fine, but it is not a surprise anyone should discover at minute forty. See
 * docs/OPERATIONS.md's R2 MIGRATION section for the rclone fast path if the
 * Janitor would rather seed the bucket in a few minutes and let this script
 * take over incrementally afterwards — the manifest is written either way, and
 * a first run after an rclone seed correctly finds nothing to do.
 *
 * INTERRUPTION SAFETY. The FULL manifest (the tree as it now is) is written
 * LAST, after every put and delete has succeeded. Before that, the script only
 * ever writes CHECKPOINTS (2026-10-04, chain 248: a 91,198-put diff timed out at
 * put 5,800 with nothing recorded, so every later chain re-diffed the same 91k
 * and timed out again). A checkpoint is
 *     the previous manifest
 *   + every key whose put SUCCEEDED in this run, at the sha that was put
 *   - every key whose delete SUCCEEDED in this run
 * and nothing else: a key still pending, in flight, or whose put failed keeps
 * its previous sha (or stays absent). So every sha a checkpoint records is one
 * the bucket was confirmed to hold for that key — carried from a manifest that
 * was itself true, or confirmed by a put that returned 0 in this run — and
 * deletes only ever take keys OUT of a checkpoint. One checkpoint write at a time;
 * the full manifest waits for any in-flight checkpoint, so an older snapshot can
 * never land after it. Kill the script halfway and the next run diffs against
 * the last checkpoint: it re-puts only what was not yet confirmed. The failure
 * mode is still redundant work (an object whose put landed but was not yet
 * checkpointed is put again), never a manifest that claims an object the bucket
 * does not hold. A restricted (--include) run writes no checkpoints, as it
 * writes no manifest.
 *
 * SERVING SCOPE — what goes in the bucket, and why exactly this set.
 * Parity with what Cloudflare Pages serves today, which is:
 *   - everything in the repo, MINUS
 *   - everything `.assetsignore` lists (read at runtime, so that file stays the
 *     single source of truth — add a line there and this script obeys it), MINUS
 *   - the Pages control files Pages consumes rather than serves
 *     (`_headers`, `_redirects`, `_routes.json`, `_worker.js`), MINUS
 *   - `functions/`, which Pages compiles into middleware rather than serving,
 *     and which the Worker replaces outright.
 * Plus two additions of our own: `worker/` (the Worker's own source is not
 * museum content) and the local-only cruft that never reaches a CI checkout
 * anyway (`.claude/`, `.wrangler/`, `node_modules/`, `.dev.vars`, `*.log`).
 *
 * ONE DELIBERATE DEVIATION from Pages' scope: dot-prefixed files and
 * directories are not uploaded. In practice this changes exactly one URL —
 * `/.allowed_signers`, the SSH allowed-signers list for commit verification,
 * which Pages serves today and this will not. It is repo metadata, not museum
 * content, and a private memorial archive has no reason to publish it. Flip
 * INCLUDE_DOTFILES below to restore strict parity.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, createReadStream, mkdtempSync, rmSync } from "node:fs";
import { resolve, dirname, relative, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { tmpdir, homedir } from "node:os";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { isAllowedTopLevel } from "./deploy-allowlist.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** --budget counts from here: hashing and the manifest read spend it too. */
const T_START = Date.now();

/**
 * GATE GUARD (GAVELS 2026-08-30): a sync deploys only a state the gate
 * stamped green AND that is fully committed. Same digest scheme as
 * scripts/gate.sh / the pre-commit hook. --dry-run is exempt.
 */
if (!process.argv.includes("--dry-run")) {
  const { execSync } = await import("node:child_process");
  const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: "utf8" });
  const dirty = sh("git status --porcelain").trim();
  if (dirty) {
    console.error("r2-sync BLOCKED: uncommitted changes present — commit through the gate first.");
    process.exit(1);
  }
  const gitDir = sh("git rev-parse --git-dir").trim();
  const stampPath = resolve(ROOT, gitDir, "gate-ok");
  if (!existsSync(stampPath)) {
    console.error("r2-sync BLOCKED: no green gate stamp. Run: npm run gate");
    process.exit(1);
  }
  const digest = sh(
    "{ git ls-files -co --exclude-standard -z | sort -z | xargs -0 sha1sum; } | sha1sum | cut -d' ' -f1"
  ).trim();
  const stamped = readFileSync(stampPath, "utf8").trim();
  if (digest !== stamped) {
    console.error("r2-sync BLOCKED: content changed since the last green gate (stamp mismatch). Run: npm run gate");
    process.exit(1);
  }
}

const MANIFEST_KEY = "_manifest.json";
const MANIFEST_VERSION = 1;

/** See the deviation note in this file's header. */
const INCLUDE_DOTFILES = false;

/** Pages consumes these rather than serving them; so does the Worker's build. */
const PAGES_CONTROL_FILES = new Set(["_headers", "_redirects", "_routes.json", "_worker.js"]);

/** Never in the bucket: the Worker's own source, and local-only cruft. */
const ALWAYS_EXCLUDE = new Set([
  "functions", // Pages middleware; replaced by worker/index.mjs
  "worker", // the serving Worker's source, not museum content
  ".claude",
  ".wrangler",
  "node_modules",
  ".dev.vars",
  ".git",
]);

// ---------------------------------------------------------------------------
// Content types — kept in step with worker/index.mjs's own table. The Worker
// derives Content-Type from the extension at request time, so this is belt and
// braces; it means the objects are still correctly typed if the bucket is ever
// read by something other than the Worker (the dashboard, an S3 client, a
// future static host).
// ---------------------------------------------------------------------------
const TYPES = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8", xml: "application/xml; charset=utf-8",
  txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8", tsv: "text/tab-separated-values; charset=utf-8",
  yml: "text/yaml; charset=utf-8", yaml: "text/yaml; charset=utf-8",
  svg: "image/svg+xml", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  pdf: "application/pdf", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav",
  mp4: "video/mp4", webm: "video/webm", zip: "application/zip", gz: "application/gzip",
  ics: "text/calendar; charset=utf-8", // the public upcoming-shows feed (D408, hook c100); the Worker serves the same type
};

function contentTypeFor(key) {
  const base = key.slice(key.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const ext = dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
  return TYPES[ext] || "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    dryRun: false, local: false, persistTo: null, bucket: null,
    concurrency: 8, include: [], prune: true, yes: false, manifestKey: MANIFEST_KEY,
    firstRun: false, budgetMs: 0, checkpointEvery: 500, checkpointSecs: 120,
    transport: process.env.R2_SYNC_TRANSPORT || "wrangler", concurrencySet: false, verifySample: 0,
  };
  if (opts.transport !== "wrangler" && opts.transport !== "s3") { console.error(`r2-sync: R2_SYNC_TRANSPORT wants wrangler or s3 (got ${opts.transport})`); process.exit(2); }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run" || a === "-n") opts.dryRun = true;
    else if (a === "--local") opts.local = true;
    else if (a === "--remote") opts.local = false;
    else if (a === "--persist-to") opts.persistTo = argv[++i];
    else if (a === "--bucket") opts.bucket = argv[++i];
    else if (a === "--manifest-key") opts.manifestKey = String(argv[++i]);
    else if (a === "--concurrency") { opts.concurrency = Math.max(1, Number(argv[++i]) || 8); opts.concurrencySet = true; }
    else if (a === "--transport") {
      opts.transport = String(argv[++i]); opts.transportSet = true;
      if (opts.transport !== "wrangler" && opts.transport !== "s3") { console.error(`r2-sync: --transport wants wrangler or s3 (got ${opts.transport})`); process.exit(2); }
    }
    else if (a === "--verify-sample") opts.verifySample = Math.max(0, Math.floor(Number(argv[++i])) || 0);
    else if (a === "--include") opts.include.push(String(argv[++i]).replace(/^\/+|\/+$/g, ""));
    else if (a === "--prune") opts.prune = true;
    else if (a === "--no-prune") opts.prune = false;
    else if (a === "--yes" || a === "-y") opts.yes = true;
    else if (a === "--first-run") opts.firstRun = true;
    else if (a === "--budget") opts.budgetMs = parseDuration(argv[++i]);
    else if (a === "--checkpoint-every") opts.checkpointEvery = Math.max(0, Math.floor(Number(argv[++i])) || 0);
    else if (a === "--checkpoint-secs") opts.checkpointSecs = Math.max(0, Number(argv[++i]) || 0);
    else if (a === "--help" || a === "-h") { printHelp(); process.exit(0); }
    else { console.error(`r2-sync: unknown flag ${a} (try --help)`); process.exit(2); }
  }
  return opts;
}

/** "90s" / "35m" / "1h" / "2400" (seconds) -> ms; anything else is a usage error. */
function parseDuration(s) {
  const m = /^(\d+(?:\.\d+)?)([smh]?)$/.exec(String(s ?? "").trim());
  if (!m || Number(m[1]) <= 0) { console.error(`r2-sync: --budget wants a duration like 35m, 90s or 1h (got ${s})`); process.exit(2); }
  return Math.round(Number(m[1]) * { "": 1000, s: 1000, m: 60000, h: 3600000 }[m[2]]);
}

function printHelp() {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*?/, "").replace(/^ \* ?/gm, ""));
}

// ---------------------------------------------------------------------------
// The bucket name — read from worker/wrangler.toml so there is one source of
// truth. A hand-rolled two-line TOML sniff rather than a dependency; the file
// is ours and its shape is fixed.
// ---------------------------------------------------------------------------

function bucketFromWranglerToml() {
  const p = resolve(ROOT, "worker", "wrangler.toml");
  if (!existsSync(p)) return null;
  const text = readFileSync(p, "utf8");
  // Find the [[r2_buckets]] block whose binding is MUSEUM_BUCKET.
  const blocks = text.split(/^\[\[r2_buckets\]\]\s*$/m).slice(1);
  for (const block of blocks) {
    const body = block.split(/^\[/m)[0];
    if (!/^\s*binding\s*=\s*"MUSEUM_BUCKET"/m.test(body)) continue;
    const m = body.match(/^\s*bucket_name\s*=\s*"([^"]+)"/m);
    if (m) return m[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

function readAssetsIgnore() {
  const p = resolve(ROOT, ".assetsignore");
  if (!existsSync(p)) return new Set();
  return new Set(
    readFileSync(p, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => l.replace(/^\/+|\/+$/g, "")),
  );
}

function buildExclusions() {
  const ignored = readAssetsIgnore();
  return { ignored, always: ALWAYS_EXCLUDE, control: PAGES_CONTROL_FILES };
}

function isExcluded(relPath, name, ex) {
  if (!INCLUDE_DOTFILES && name.startsWith(".")) return true;
  if (ex.always.has(name) || ex.always.has(relPath)) return true;
  if (ex.ignored.has(name) || ex.ignored.has(relPath)) return true;
  if (relPath.indexOf("/") === -1 && ex.control.has(name)) return true; // control files are root-level only
  if (/\.log$/.test(name)) return true;
  if (/\.md$/i.test(name)) return true; // the Janitor 2026-10-07: no .md is served (hook c119)
  return false;
}

/** All deployable files, as POSIX-relative keys, sorted. */
function walkTree(ex, includePrefixes) {
  const keys = [];
  (function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = relative(ROOT, abs).split(sep).join("/");
      if (isExcluded(rel, entry.name, ex)) continue;
      if (entry.isSymbolicLink()) continue; // a symlink is not a file to publish
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) keys.push(rel);
    }
  })(ROOT);
  const filtered = includePrefixes.length
    ? keys.filter((k) => includePrefixes.some((p) => k === p || k.startsWith(p + "/")))
    : keys;
  return filtered.sort();
}

/**
 * TOP-LEVEL ALLOWLIST (STRUCTURAL GUARDRAILS, 2026-09-03) — the same
 * allowlist scripts/validate.mjs enforces on the served tree, enforced
 * here independently on the deploy set. Born from the scratch-directory
 * incident: 62 lane scratch directories were committed with no
 * `.assetsignore`/`.gitignore` entry and this script uploaded every one of
 * them to the R2 bucket, incrementally, for weeks, before a privacy hit
 * inside one surfaced it. `isExcluded`'s ignore-list logic only keeps out
 * what someone remembered to list; this is the opposite shape — a fixed,
 * reviewed, POSITIVE list of what is allowed to leave the repo at all — so
 * a NEW unlisted top-level path (the next scratch directory, a stray
 * workshop file dragged in by an unrelated commit) is refused on sight
 * instead of silently deployed. Returns a Map of offending top-level
 * segment -> one example key, for a clear, named refusal message.
 */
function disallowedTopLevel(keys) {
  const bad = new Map();
  for (const key of keys) {
    const slash = key.indexOf("/");
    const seg = slash === -1 ? key : key.slice(0, slash);
    const isDir = slash !== -1; // a key with a "/" necessarily has a directory as its top segment
    if (!isAllowedTopLevel(seg, isDir) && !bad.has(seg)) bad.set(seg, key);
  }
  return bad;
}

function sha256File(abs) {
  return new Promise((res, rej) => {
    const hash = createHash("sha256");
    createReadStream(abs)
      .on("error", rej)
      .on("data", (d) => hash.update(d))
      .on("end", () => res(hash.digest("hex")));
  });
}

async function hashTree(keys, onProgress) {
  const out = {};
  let done = 0;
  const LANES = 16;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(LANES, keys.length) }, async () => {
      while (cursor < keys.length) {
        const key = keys[cursor++];
        out[key] = await sha256File(resolve(ROOT, key));
        if (++done % 2000 === 0) onProgress?.(done, keys.length);
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------
// wrangler shell-out
// ---------------------------------------------------------------------------

function wranglerBase(opts) {
  const local = existsSync(resolve(ROOT, "node_modules", ".bin", "wrangler"))
    ? [resolve(ROOT, "node_modules", ".bin", "wrangler")]
    : ["npx", "--yes", "wrangler"];
  const scope = opts.local ? ["--local"] : ["--remote"];
  const persist = opts.persistTo ? ["--persist-to", opts.persistTo] : [];
  return { cmd: local[0], head: local.slice(1), tail: [...scope, ...persist] };
}

function run(cmd, args, { capture = false, timeoutMs = 0 } = {}) {
  return new Promise((res) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "ignore", "pipe"],
      env: process.env,
      // A timed call runs in its own process group so a timeout can end the
      // whole npx -> sh -> wrangler -> cli.js chain, not just its first link.
      detached: timeoutMs > 0,
    });
    let out = "", err = "", timedOut = false;
    // timeoutMs (0 = none): only the manifest fetch sets it. The group killed is
    // the one this script's own spawn() just created — never anyone else's.
    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
        }, timeoutMs)
      : null;
    child.stdout?.on("data", (d) => { out += d; });
    child.stderr?.on("data", (d) => { err += d; });
    child.on("error", (e) => { if (timer) clearTimeout(timer); res({ code: 127, out, err: String(e) }); });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) res({ code: 124, out, err: `${err}\nr2-sync: timed out after ${timeoutMs} ms` });
      else res({ code, out, err });
    });
  });
}

/**
 * Retry a wrangler invocation a couple of times before calling it a failure.
 *
 * Two different transient failure modes make this worth having. Remotely, an
 * R2 API call can just lose. Locally, wrangler's miniflare R2 simulator keeps
 * its state in SQLite, and two `wrangler r2 object put --local` processes
 * writing the same persistence directory at once can collide — it surfaces as
 * the wonderfully unhelpful `put: Unspecified error (0)`. Local runs are
 * serialized (see main()) so that collision should not arise, but a retry
 * costs nothing when nothing is wrong and saves a whole run when something is.
 */
async function withRetry(fn, tries = 3, mayRetry = () => true) {
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    last = await fn();
    if (last.code === 0) return last;
    // Past the --budget no retry is started: the drain must end.
    if (attempt < tries && mayRetry()) await new Promise((r) => setTimeout(r, 300 * attempt));
    else break;
  }
  return last;
}

/**
 * One put or delete may not hang the run (2026-09-29, cycle 216: puts hung on
 * the Cloudflare API with no timeout anywhere). 600 s covers the largest file in
 * the tree (data/appearances-index.json, 43 MB) on a slow link. Its own process
 * group, as the manifest read's; R2_SYNC_PUT_TIMEOUT_MS overrides, 0 = none.
 */
const OBJECT_OP_TIMEOUT_MS = process.env.R2_SYNC_PUT_TIMEOUT_MS !== undefined
  ? Number(process.env.R2_SYNC_PUT_TIMEOUT_MS) || 0 : 600000;

async function putObject(opts, base, bucket, key, mayRetry) {
  const args = [
    ...base.head, "r2", "object", "put", `${bucket}/${key}`,
    "--file", resolve(ROOT, key),
    "--content-type", contentTypeFor(key),
    ...base.tail,
  ];
  return withRetry(() => run(base.cmd, args, { timeoutMs: OBJECT_OP_TIMEOUT_MS }), 3, mayRetry);
}

async function deleteObject(opts, base, bucket, key, mayRetry) {
  const args = [...base.head, "r2", "object", "delete", `${bucket}/${key}`, ...base.tail];
  return withRetry(() => run(base.cmd, args, { timeoutMs: OBJECT_OP_TIMEOUT_MS }), 3, mayRetry);
}

/**
 * wrangler's own words for a missing object (wrangler 4.143.1,
 * wrangler-dist/cli.js, r2ObjectGetCommand's handler): the R2 API answered 404,
 * fetchR2Objects() returned null, and the handler threw
 *   UserError("The specified key does not exist.")
 * — the same text for --remote and --local. It reaches stderr as
 * "✘ [ERROR] The specified key does not exist." (ANSI-coloured) and the exit
 * code is 1 — the SAME exit code as a 429, a 5xx, an auth failure or a network
 * error, so the exit code cannot tell them apart; only this string can.
 * Note wrangler opens the --file for writing BEFORE the request, so an empty
 * file exists after every failure; the file's existence proves nothing.
 */
const MISSING_OBJECT_RE = /The specified key does not exist\./;
const MANIFEST_GET_TRIES = 4;
const MANIFEST_GET_BACKOFF_MS = [5000, 15000, 45000];
const MANIFEST_GET_TIMEOUT_MS = Number(process.env.R2_SYNC_MANIFEST_TIMEOUT_MS) || 300000;  // 2026-09-30: 120 s timed out four times on a slow link (the 11 MB manifest took 78 s)
const MANIFEST_GET_BACKOFF_SCALE = process.env.R2_SYNC_MANIFEST_BACKOFF_SCALE !== undefined
  ? Number(process.env.R2_SYNC_MANIFEST_BACKOFF_SCALE) : 1; // tests only

const stripAnsi = (s) => String(s || "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

/**
 * Fetch the previous manifest. Returns one of
 *   { files, firstRun: false, generatedAt }       — read and parsed
 *   { files: {}, firstRun: true, missing: true }  — wrangler said the object does not exist
 *   { files: {}, error: "…" }                     — anything else, after retries
 * Only the missing-object answer is a first run; an unreadable manifest is an
 * error, never an empty one.
 */
async function fetchManifest(opts, base, bucket, manifestKey, runner = run) {
  let lastReason = "";
  for (let attempt = 1; attempt <= MANIFEST_GET_TRIES; attempt++) {
    const dir = mkdtempSync(join(tmpdir(), "r2-sync-"));
    const file = join(dir, "manifest.json");
    try {
      const args = [...base.head, "r2", "object", "get", `${bucket}/${manifestKey}`, "--file", file, ...base.tail];
      const r = await runner(base.cmd, args, { capture: true, timeoutMs: MANIFEST_GET_TIMEOUT_MS });
      const said = stripAnsi(`${r.err}\n${r.out}`);
      if (r.code !== 0) {
        if (MISSING_OBJECT_RE.test(said)) return { files: {}, firstRun: true, missing: true };
        lastReason = `wrangler exit ${r.code}: ${said.trim().split("\n").filter(Boolean).slice(-3).join(" | ")}`;
      } else {
        try {
          const parsed = JSON.parse(readFileSync(file, "utf8"));
          if (parsed && parsed.files && typeof parsed.files === "object") {
            return { files: parsed.files, firstRun: false, generatedAt: parsed.generatedAt };
          }
          lastReason = "the manifest downloaded but has no files map";
        } catch (e) {
          lastReason = `the manifest downloaded but did not parse: ${String(e?.message || e).replace(/\s+/g, " ")}`;
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    if (attempt < MANIFEST_GET_TRIES) {
      const wait = MANIFEST_GET_BACKOFF_MS[attempt - 1] * MANIFEST_GET_BACKOFF_SCALE;
      console.error(`r2-sync: manifest read failed (attempt ${attempt}/${MANIFEST_GET_TRIES}) — ${lastReason}; retrying in ${Math.round(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return { files: {}, error: lastReason };
}

/** The manifest's bytes — one format whichever transport writes it. */
function manifestBody(files) {
  return JSON.stringify(
    {
      _generated: "scripts/r2-sync.mjs — the bucket's own record of what it holds; never hand-edit",
      version: MANIFEST_VERSION,
      generatedAt: new Date().toISOString(),
      count: Object.keys(files).length,
      files,
    },
    null,
    0,
  ) + "\n";
}

async function putManifest(opts, base, bucket, files, manifestKey) {
  const dir = mkdtempSync(join(tmpdir(), "r2-sync-"));
  const file = join(dir, "manifest.json");
  try {
    writeFileSync(file, manifestBody(files));
    const args = [
      ...base.head, "r2", "object", "put", `${bucket}/${manifestKey}`,
      "--file", file, "--content-type", "application/json", ...base.tail,
    ];
    return await run(base.cmd, args, { capture: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Transports — see S3 TRANSPORT in this file's header. Both expose the same
// four operations and the same { code, out, err } results the pool, the
// checkpointer and the exit paths already read, so nothing above or below
// knows which wire carried a put.
// ---------------------------------------------------------------------------

function makeWranglerTransport(opts, base, bucket) {
  return {
    name: "wrangler",
    put: (key, mayRetry) => putObject(opts, base, bucket, key, mayRetry),
    del: (key, mayRetry) => deleteObject(opts, base, bucket, key, mayRetry),
    getManifest: (manifestKey) => fetchManifest(opts, base, bucket, manifestKey),
    putManifest: (files, manifestKey) => putManifest(opts, base, bucket, files, manifestKey),
  };
}

const S3_TRIES = Math.max(1, Number(process.env.R2_SYNC_S3_TRIES) || 6);
const S3_BACKOFF_MS = process.env.R2_SYNC_S3_BACKOFF_MS !== undefined ? Number(process.env.R2_SYNC_S3_BACKOFF_MS) : 500; // tests shrink it
const S3_BACKOFF_CAP_MS = 15000;
const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");

/** RFC 3986, per path segment, as SigV4's canonical URI wants it ('/' kept). */
function s3EncodeKey(key) {
  return String(key).split("/")
    .map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()))
    .join("/");
}

/** KEY=value lines; the values are kept in memory only, never echoed. */
function readEnvFile(p) {
  const out = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

async function resolveAccountId(env) {
  const direct = process.env.R2_ACCOUNT_ID || env.R2_ACCOUNT_ID;
  if (direct) {
    if (!/^[0-9a-f]{32}$/.test(direct)) throw new Error("R2_ACCOUNT_ID is not a 32-character hex account id");
    return direct;
  }
  const base = wranglerBase({ local: false });
  const r = await run(base.cmd, [...base.head, "whoami"], { capture: true, timeoutMs: 120000 });
  const ids = [...new Set(stripAnsi(`${r.out}\n${r.err}`).match(/\b[0-9a-f]{32}\b/g) || [])];
  if (r.code !== 0 || ids.length !== 1) {
    throw new Error(`could not read exactly one account id from \`wrangler whoami\` (exit ${r.code}, ${ids.length} id(s)); set R2_ACCOUNT_ID`);
  }
  return ids[0];
}

/**
 * A minimal SigV4 client for R2's S3 endpoint: path-style URLs, the
 * Authorization HEADER (never a presigned URL), region "auto". It returns the
 * status, the response headers and the body text; it never returns or prints
 * the request's own headers, so no signature or key can reach a log.
 */
function makeS3Client({ endpoint, accessKeyId, secretAccessKey, region = "auto", now = () => new Date(), fetchImpl = globalThis.fetch }) {
  const u = new URL(endpoint);
  const origin = `${u.protocol}//${u.host}`;
  const host = u.host;
  const hmac = (k, s) => createHmac("sha256", k).update(s, "utf8").digest();
  let cached = { day: "", key: null };
  const signingKey = (day) => {
    if (cached.day !== day) {
      let k = hmac("AWS4" + secretAccessKey, day);
      for (const part of [region, "s3", "aws4_request"]) k = hmac(k, part);
      cached = { day, key: k };
    }
    return cached.key;
  };

  /** Pure signing step (exported through the client for the known-answer test). */
  function sign(method, path, query, headers, payloadSha, date) {
    const amz = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const day = amz.slice(0, 8);
    const h = {};
    for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = String(v).trim();
    h.host = host; h["x-amz-date"] = amz; h["x-amz-content-sha256"] = payloadSha;
    const names = Object.keys(h).sort();
    const canonical = [method, path, query, names.map((n) => `${n}:${h[n]}\n`).join(""), names.join(";"), payloadSha].join("\n");
    const scope = `${day}/${region}/s3/aws4_request`;
    const toSign = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
    const sig = createHmac("sha256", signingKey(day)).update(toSign, "utf8").digest("hex");
    h.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${sig}`;
    delete h.host; // fetch derives Host from the URL; it was signed above
    return h;
  }

  async function request(method, path, { headers = {}, body = null, payloadSha = EMPTY_SHA256, query = "", timeoutMs = 0 } = {}) {
    const signed = sign(method, path, query, headers, payloadSha, now());
    try {
      const res = await fetchImpl(`${origin}${path}${query ? "?" + query : ""}`, {
        method, headers: signed, body: body ?? undefined,
        signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
      });
      const text = method === "HEAD" ? "" : await res.text();
      return { status: res.status, headers: res.headers, text };
    } catch (e) {
      const why = e?.name === "TimeoutError" ? `timed out after ${timeoutMs} ms` : `${e?.cause?.code || e?.name || "error"}: ${String(e?.cause?.message || e?.message || e).replace(/\s+/g, " ").slice(0, 160)}`;
      return { status: 0, headers: new Headers(), text: "", network: why };
    }
  }
  return { request, sign };
}

const s3Code = (text) => (/<Code>([^<]*)<\/Code>/.exec(text || "") || [])[1] || "";
function s3Describe(method, key, r) {
  if (r.status === 0) return `S3 ${method} ${key}: network ${r.network}`;
  const msg = (/<Message>([^<]*)<\/Message>/.exec(r.text || "") || [])[1] || "";
  return `S3 ${method} ${key}: HTTP ${r.status}${s3Code(r.text) ? " " + s3Code(r.text) : ""}${msg ? " — " + msg : ""}`;
}
const s3Retryable = (status) => status === 0 || status === 408 || status === 429 || status >= 500;

/**
 * Retry with exponential backoff and full jitter (Retry-After honoured, capped).
 * `accept(r)` turns a 2xx into { code: 0 } or a reason it is not good enough.
 * Past the --budget (mayRetry() false) no retry starts.
 */
async function s3WithRetry(method, key, attemptFn, mayRetry = () => true, accept = () => null) {
  let last = "";
  for (let attempt = 1; attempt <= S3_TRIES; attempt++) {
    const r = await attemptFn();
    let retry = false;
    if (r.status >= 200 && r.status < 300) {
      const bad = accept(r);
      if (!bad) return { code: 0, out: "", err: "", res: r };
      last = `S3 ${method} ${key}: ${bad}`; retry = true;
    } else {
      last = s3Describe(method, key, r); retry = s3Retryable(r.status);
    }
    if (!retry || attempt === S3_TRIES || !mayRetry()) break;
    const ra = Number(r.headers?.get?.("retry-after"));
    const exp = Math.min(S3_BACKOFF_CAP_MS, S3_BACKOFF_MS * 2 ** (attempt - 1));
    const wait = Number.isFinite(ra) && ra > 0 ? Math.min(S3_BACKOFF_CAP_MS, ra * 1000) : Math.random() * exp;
    await new Promise((res) => setTimeout(res, wait));
  }
  return { code: 1, out: "", err: last };
}

async function makeS3Transport(opts, bucket) {
  const envFile = process.env.R2_ENV_FILE || join(homedir(), ".config", "wwv", "r2.env");
  let env;
  try { env = readEnvFile(envFile); } catch (e) { throw new Error(`cannot read the R2 credentials file ${envFile} (${e?.code || "error"})`); }
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) throw new Error(`${envFile} lacks R2_ACCESS_KEY_ID or R2_SECRET_ACCESS_KEY`);
  const endpoint = process.env.R2_S3_ENDPOINT || `https://${await resolveAccountId(env)}.r2.cloudflarestorage.com`;
  const client = makeS3Client({ endpoint, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY });
  env = null;
  const pathOf = (key) => `/${s3EncodeKey(bucket)}/${s3EncodeKey(key)}`;

  /** One PUT of exact bytes: Content-Type as the wrangler path, Content-MD5 + sha256 so R2 checks the body, ETag checked back. */
  function putBytes(key, body, contentType, sha, mayRetry) {
    const md5 = createHash("md5").update(body).digest();
    const etag = `"${md5.toString("hex")}"`;
    return s3WithRetry("PUT", key, () => client.request("PUT", pathOf(key), {
      headers: { "content-type": contentType, "content-md5": md5.toString("base64") },
      body, payloadSha: sha, timeoutMs: OBJECT_OP_TIMEOUT_MS,
    }), mayRetry, (r) => {
      const got = r.headers.get("etag");
      const _n = (x) => String(x || "").replace(/^W\//, "").replace(/"/g, ""); // c51 weak-ETag: R2 may answer W/"<md5>"
      return got && _n(got) !== _n(etag) ? `ETag ${got} is not the body's MD5 ${etag}` : null;
    });
  }

  return {
    name: "s3",
    /** expectSha: the sha the diff (and so the manifest) holds for this key; a file changed since then is not put. */
    async put(key, mayRetry, expectSha) {
      let body;
      try { body = readFileSync(resolve(ROOT, key)); } catch (e) { return { code: 1, out: "", err: `read ${key}: ${e?.code || e}` }; }
      const sha = createHash("sha256").update(body).digest("hex");
      if (expectSha && sha !== expectSha) return { code: 1, out: "", err: `${key} changed since it was hashed; not put (the next run picks it up)` };
      return putBytes(key, body, contentTypeFor(key), sha, mayRetry);
    },
    /** Read-only: { status, etag, contentType } of one object (for --verify-sample). */
    async head(key) {
      const r = await s3WithRetry("HEAD", key, () => client.request("HEAD", pathOf(key), { timeoutMs: 60000 }));
      if (r.code === 0) return { status: r.res.status, etag: r.res.headers.get("etag"), contentType: r.res.headers.get("content-type") };
      return { status: /HTTP 404/.test(r.err) ? 404 : 0, err: r.err };
    },
    del(key, mayRetry) {
      return s3WithRetry("DELETE", key, () => client.request("DELETE", pathOf(key), { timeoutMs: OBJECT_OP_TIMEOUT_MS }), mayRetry);
    },
    /** fetchManifest's contract: only S3's NoSuchKey is a first run; anything else retries, then is an error. */
    async getManifest(manifestKey) {
      let lastReason = "";
      for (let attempt = 1; attempt <= MANIFEST_GET_TRIES; attempt++) {
        const r = await client.request("GET", pathOf(manifestKey), { timeoutMs: MANIFEST_GET_TIMEOUT_MS });
        if (r.status === 404 && s3Code(r.text) === "NoSuchKey") return { files: {}, firstRun: true, missing: true };
        if (r.status === 200) {
          try {
            const parsed = JSON.parse(r.text);
            if (parsed && parsed.files && typeof parsed.files === "object") return { files: parsed.files, firstRun: false, generatedAt: parsed.generatedAt };
            lastReason = "the manifest downloaded but has no files map";
          } catch (e) {
            lastReason = `the manifest downloaded but did not parse: ${String(e?.message || e).replace(/\s+/g, " ")}`;
          }
        } else {
          lastReason = s3Describe("GET", manifestKey, r);
        }
        if (attempt < MANIFEST_GET_TRIES) {
          const wait = MANIFEST_GET_BACKOFF_MS[attempt - 1] * MANIFEST_GET_BACKOFF_SCALE;
          console.error(`r2-sync: manifest read failed (attempt ${attempt}/${MANIFEST_GET_TRIES}) — ${lastReason}; retrying in ${Math.round(wait / 1000)}s`);
          await new Promise((res) => setTimeout(res, wait));
        }
      }
      return { files: {}, error: lastReason };
    },
    putManifest(files, manifestKey) {
      const body = Buffer.from(manifestBody(files), "utf8");
      return putBytes(manifestKey, body, "application/json", createHash("sha256").update(body).digest("hex"), () => true);
    },
  };
}

/**
 * --verify-sample: parity of what is already in the bucket with what this
 * transport would put. HEAD only; never writes. An ETag of the form "…-N" is a
 * multipart upload (e.g. an rclone seed) and cannot be compared to an MD5.
 */
async function verifySample(tx, keys, previousFiles, current, opts) {
  const unchanged = keys.filter((k) => previousFiles[k] === current[k]);
  const n = Math.min(opts.verifySample, unchanged.length);
  const step = unchanged.length / Math.max(n, 1);
  const sample = Array.from({ length: n }, (_, i) => unchanged[Math.floor(i * step)]);
  const tally = { checked: 0, etagOk: 0, typeOk: 0, multipart: 0, missing: 0, errors: 0 };
  const bad = [];
  await pool(sample, opts.concurrency, async (key) => {
    const h = await tx.head(key);
    tally.checked++;
    if (h.status === 404) { tally.missing++; bad.push(`${key}: MISSING (404) though the manifest records it`); return { code: 0 }; }
    if (h.status !== 200) { tally.errors++; bad.push(`${key}: ${h.err}`); return { code: 0 }; }
    const md5 = createHash("md5").update(readFileSync(resolve(ROOT, key))).digest("hex");
    const etag = String(h.etag || "").replace(/^W\//, "").replace(/"/g, ""); // c51 weak-ETag
    if (/-\d+$/.test(etag)) tally.multipart++;
    else if (etag === md5) tally.etagOk++;
    else bad.push(`${key}: ETag ${etag} != local MD5 ${md5}`);
    if (h.contentType === contentTypeFor(key)) tally.typeOk++;
    else bad.push(`${key}: Content-Type "${h.contentType}" != put's "${contentTypeFor(key)}"`);
    return { code: 0 };
  });
  console.log(`\nr2-sync: verify-sample — ${tally.checked} unchanged object(s) HEADed of ${unchanged.length}: ` +
    `ETag = local MD5 for ${tally.etagOk}, multipart (not comparable) ${tally.multipart}; Content-Type matches for ${tally.typeOk}; ` +
    `missing ${tally.missing}; errors ${tally.errors}.`);
  for (const b of bad.slice(0, 20)) console.log(`  ! ${b}`);
  if (bad.length > 20) console.log(`  … and ${bad.length - 20} more`);
  return bad.length === 0;
}

// ---------------------------------------------------------------------------
// Checkpoints — see INTERRUPTION SAFETY in this file's header.
// ---------------------------------------------------------------------------

/**
 * Keeps this run's confirmed puts and deletes and writes checkpoint manifests.
 * `serial` (local runs): the simulator is single-writer, so the caller awaits
 * each checkpoint before its next put; remotely a checkpoint is written while
 * the puts carry on. Never two manifest writes at once.
 */
function makeCheckpointer({ enabled, every, secs, serial, write, previousFiles }) {
  const confirmed = new Map(); // key -> sha this run put, put returned 0
  const deleted = new Set();   // keys this run deleted, delete returned 0
  let pending = 0;             // confirmations since the last snapshot taken
  let lastAt = Date.now();
  let inflight = null;
  let written = 0, recorded = 0, failedWrites = 0;

  function snapshot() {
    const files = { ...previousFiles };
    for (const k of deleted) delete files[k];
    for (const [k, sha] of confirmed) files[k] = sha;
    const out = {};
    for (const k of Object.keys(files).sort()) out[k] = files[k];
    return out;
  }

  function start(reason) {
    const files = snapshot();
    // What THIS snapshot holds, counted now: puts confirmed while the write is in
    // flight are not in it, so they must not count as recorded when it lands
    // (2026-10-04, lane DEPLOY-FASTPATH: counting at completion let flush() skip them).
    const holds = confirmed.size + deleted.size;
    const taken = pending;
    pending = 0; lastAt = Date.now();
    inflight = (async () => {
      const r = await write(files);
      if (r.code === 0) {
        written++; recorded = holds;
        console.log(`r2-sync: checkpoint ${written} written (${reason}) — ${confirmed.size} put(s)${deleted.size ? ` and ${deleted.size} delete(s)` : ""} of this run recorded, ${Object.keys(files).length} object(s) in the manifest.`);
      } else {
        failedWrites++;
        pending += taken; // the next trigger tries again; the previous manifest still stands, which is safe
        console.error(`r2-sync: checkpoint write FAILED (the previous manifest stands; retried at the next trigger) — ${String(r.err || r.out || "").trim().split("\n").slice(-2).join(" | ")}`);
      }
      inflight = null;
      return r;
    })();
    return inflight;
  }

  function due() {
    if (!enabled || inflight || pending === 0) return false;
    if (every > 0 && pending >= every) return "every " + every;
    if (secs > 0 && Date.now() - lastAt >= secs * 1000) return "every " + secs + "s";
    return false;
  }

  return {
    /** Call only after the put returned 0. Returns a promise to await in serial mode. */
    put(key, sha) { confirmed.set(key, sha); pending++; const why = due(); if (why) { const p = start(why); if (serial) return p; } return null; },
    del(key) { deleted.add(key); pending++; const why = due(); if (why) { const p = start(why); if (serial) return p; } return null; },
    /** Wait for any in-flight checkpoint, then write one more if anything is unrecorded. */
    async flush(reason) {
      if (inflight) await inflight;
      if (!enabled) return { code: 0, skipped: true };
      if (confirmed.size + deleted.size === recorded) return { code: 0, upToDate: true };
      pending = Math.max(pending, 1);
      return start(reason);
    },
    /** Wait for any in-flight checkpoint (before the full manifest is written). */
    async idle() { if (inflight) await inflight; },
    stats() { return { written, failedWrites, confirmed: confirmed.size, deleted: deleted.size, recorded }; },
  };
}

// ---------------------------------------------------------------------------
// The work pool
// ---------------------------------------------------------------------------

async function pool(items, size, worker, onProgress, shouldStop = () => false) {
  let cursor = 0, done = 0;
  const failures = [];
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (cursor < items.length && !shouldStop()) {
        const item = items[cursor++];
        const r = await worker(item);
        done++;
        if (r.code !== 0) failures.push({ item, err: (r.err || r.out || "").trim().split("\n").slice(-4).join("\n") });
        onProgress?.(done, items.length, item);
      }
    }),
  );
  failures.started = cursor; // < items.length only when shouldStop() ended the pool early
  return failures;
}

function confirm(question) {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (a) => { rl.close(); res(/^y(es)?$/i.test(a.trim())); }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const bucket = opts.bucket || bucketFromWranglerToml();
  if (!bucket) {
    console.error("r2-sync: no bucket name — worker/wrangler.toml has no MUSEUM_BUCKET binding and --bucket was not given.");
    process.exit(2);
  }

  // The Worker's baked _headers must be current before any deploy, or the
  // clacks lines and X-Robots-Tag on the wire lag the file the validators
  // police. Checked here rather than only in CI so a manual deploy is safe too.
  const headersCheck = await run(process.execPath, [resolve(ROOT, "scripts", "build-worker-headers.mjs"), "--check"], { capture: true });
  if (headersCheck.code !== 0) {
    console.error(headersCheck.err.trim() || headersCheck.out.trim());
    console.error("r2-sync: refusing to deploy with stale worker/headers.json.");
    process.exit(1);
  }

  // The local (miniflare) R2 simulator is SQLite-backed and does not tolerate
  // concurrent writers to one persistence directory; parallel puts there fail
  // with `put: Unspecified error (0)`. Real R2 has no such problem, so the
  // clamp is local-only. Local runs seed a test sample, not 15,600 files.
  if (opts.local && opts.concurrency > 1) {
    console.log(`r2-sync: --local — clamping concurrency ${opts.concurrency} -> 1 (the local R2 simulator is single-writer).`);
    opts.concurrency = 1;
  }

  // The S3 endpoint is the real bucket's; the simulator has none. An env default
  // never turns a --local test harness into an error; an explicit flag does.
  if (opts.transport === "s3" && opts.local && !opts.transportSet) opts.transport = "wrangler";
  if (opts.transport === "s3" && opts.local) {
    console.error("r2-sync: --transport s3 is remote only (the local R2 simulator is reached through wrangler).");
    process.exit(2);
  }
  if (opts.transport === "s3" && !opts.concurrencySet) opts.concurrency = 16;
  if (opts.verifySample > 0 && !(opts.dryRun && opts.transport === "s3")) {
    console.error("r2-sync: --verify-sample is read-only and needs --dry-run --transport s3.");
    process.exit(2);
  }

  const where = opts.local ? `LOCAL (${opts.persistTo || ".wrangler/state"})` : `REMOTE Cloudflare R2${opts.transport === "s3" ? " via the S3 API" : ""}`;
  console.log(`r2-sync: bucket ${bucket} — ${where}${opts.dryRun ? " — DRY RUN" : ""}`);

  const ex = buildExclusions();
  const keys = walkTree(ex, opts.include);
  if (!keys.length) {
    console.error("r2-sync: the walk found zero deployable files. Refusing to proceed — that would prune the entire bucket.");
    process.exit(1);
  }
  console.log(`r2-sync: walked ${keys.length} deployable file(s)${opts.include.length ? ` (restricted to ${opts.include.join(", ")})` : ""}; hashing…`);

  // REFUSAL (STRUCTURAL GUARDRAILS, 2026-09-03): never upload a top-level
  // path outside the shared allowlist, dry-run or not — see
  // disallowedTopLevel()'s own comment above.
  const disallowed = disallowedTopLevel(keys);
  if (disallowed.size) {
    console.error(`r2-sync REFUSED: ${disallowed.size} top-level path(s) outside scripts/deploy-allowlist.mjs's allowlist would be uploaded:`);
    for (const [seg, example] of disallowed) console.error(`  ! ${seg} (e.g. ${example})`);
    console.error("Lane scratch belongs in archive/, one level up — never in the deployable tree. Add a reviewed allowlist entry only for a genuine new top-level category, then re-run.");
    process.exit(1);
  }

  const current = await hashTree(keys, (d, t) => console.log(`  …hashed ${d}/${t}`));

  const base = wranglerBase(opts);
  let tx;
  if (opts.transport === "s3") {
    try { tx = await makeS3Transport(opts, bucket); } catch (e) {
      console.error(`r2-sync: the S3 transport could not start — ${e?.message || e}. Nothing was uploaded.`);
      process.exit(1);
    }
  } else {
    tx = makeWranglerTransport(opts, base, bucket);
  }
  const previous = await tx.getManifest(opts.manifestKey);
  if (previous.error) {
    console.error(`r2-sync ABORTED: could not read ${opts.manifestKey} from ${bucket} after ${MANIFEST_GET_TRIES} attempts — ${previous.error}`);
    console.error("r2-sync: an unreadable manifest is NOT a missing one; nothing was uploaded. Re-run when the bucket answers.");
    process.exit(3);
  }
  if (previous.firstRun && !opts.local && !opts.firstRun) {
    if (opts.dryRun) {
      console.log(`r2-sync: NOTE — no ${opts.manifestKey} in the bucket; a real run will refuse without --first-run.`);
    } else {
      console.error(`r2-sync REFUSED: ${tx.name === "s3" ? "S3 (NoSuchKey)" : "wrangler"} reports no ${opts.manifestKey} in ${bucket} — a FIRST RUN would re-upload all ${keys.length} objects.`);
      console.error("r2-sync: if the bucket really is new or was emptied, re-run with --first-run. Nothing was uploaded.");
      process.exit(4);
    }
  }

  // A restricted (--include) run must not prune everything outside the subset,
  // and must not overwrite the full manifest with a partial one. Naming a
  // different manifest key is the caller saying "this manifest describes this
  // scope on purpose" — which is exactly what worker/test-sync.mjs needs in
  // order to exercise the add/change/delete diff without a 15,600-file run.
  const scopedManifest = opts.manifestKey !== MANIFEST_KEY;
  const restricted = opts.include.length > 0 && !scopedManifest;

  const added = [], changed = [];
  for (const key of keys) {
    if (!(key in previous.files)) added.push(key);
    else if (previous.files[key] !== current[key]) changed.push(key);
  }
  const currentSet = new Set(keys);
  const removed = restricted || !opts.prune
    ? []
    : Object.keys(previous.files).filter((k) => !currentSet.has(k)).sort();

  if (previous.firstRun) {
    console.log(`r2-sync: no ${opts.manifestKey} in the bucket — treating this as a FIRST RUN (full upload of ${keys.length} objects).`);
  } else {
    console.log(`r2-sync: previous manifest from ${previous.generatedAt || "unknown date"} — ${Object.keys(previous.files).length} object(s).`);
  }

  console.log(
    `r2-sync: diff — ${added.length} added, ${changed.length} changed, ${removed.length} deleted, ` +
      `${keys.length - added.length - changed.length} unchanged.`,
  );

  if (opts.dryRun) {
    const show = (label, list) => {
      if (!list.length) return;
      console.log(`\n  ${label} (${list.length}):`);
      for (const k of list.slice(0, 50)) console.log(`    ${label[0]} ${k}`);
      if (list.length > 50) console.log(`    … and ${list.length - 50} more`);
    };
    show("ADD", added);
    show("CHANGE", changed);
    show("DELETE", removed);
    if (restricted) console.log("\n  (restricted run: nothing outside --include is considered for deletion, and the manifest would not be rewritten)");
    if (opts.verifySample > 0) {
      const ok = await verifySample(tx, keys, previous.files, current, opts);
      console.log("\nr2-sync: dry run — nothing was uploaded or deleted.");
      if (!ok) process.exit(6);
      return;
    }
    console.log("\nr2-sync: dry run — nothing was uploaded or deleted.");
    return;
  }

  if (!added.length && !changed.length && !removed.length) {
    console.log("r2-sync: bucket is already current. Nothing to do.");
    return;
  }

  // A prune that would remove a big share of the bucket is far more likely to
  // be a bad walk than a real deletion. Ask before doing it.
  const prevCount = Object.keys(previous.files).length;
  if (removed.length && prevCount && removed.length / prevCount > 0.1 && !opts.yes) {
    const ok = await confirm(
      `r2-sync: this would DELETE ${removed.length} of ${prevCount} objects (${Math.round((removed.length / prevCount) * 100)}%). Proceed? [y/N] `,
    );
    if (!ok) { console.error("r2-sync: aborted. Re-run with --yes if the deletion is intended."); process.exit(1); }
  }

  const uploads = [...added, ...changed];
  const failures = [];

  // The budget: past the deadline no new put/delete (or retry) starts; in-flight ones finish.
  const deadline = opts.budgetMs > 0 ? T_START + opts.budgetMs : Infinity;
  const pastDeadline = () => Date.now() >= deadline;
  const mayRetry = () => !pastDeadline();
  if (opts.budgetMs > 0) console.log(`r2-sync: budget ${Math.round(opts.budgetMs / 1000)}s — new work stops at ${new Date(deadline).toISOString()}.`);

  // Checkpoints: never on a restricted run (it writes no manifest at all).
  const cp = makeCheckpointer({
    enabled: !restricted,
    every: opts.checkpointEvery, secs: opts.checkpointSecs, serial: opts.local,
    previousFiles: previous.files,
    write: (files) => tx.putManifest(files, opts.manifestKey),
  });
  let stoppedEarly = false;

  if (uploads.length) {
    console.log(`r2-sync: uploading ${uploads.length} object(s) at concurrency ${opts.concurrency} (${tx.name})…`);
    const t0 = Date.now();
    const f = await pool(uploads, opts.concurrency, async (key) => {
      const r = await tx.put(key, mayRetry, current[key]);
      if (r.code === 0) { const wait = cp.put(key, current[key]); if (wait) await wait; }
      return r;
    }, (d, t) => {
      if (d % 100 === 0 || d === t) {
        const rate = d / ((Date.now() - t0) / 1000);
        console.log(`  …put ${d}/${t} (${rate.toFixed(1)}/s, ~${Math.round((t - d) / Math.max(rate, 0.01))}s left)`);
      }
    }, pastDeadline);
    failures.push(...f);
    if (f.started < uploads.length) stoppedEarly = true;
  }

  if (removed.length && !failures.length && !stoppedEarly) {
    console.log(`r2-sync: deleting ${removed.length} object(s)…`);
    const f = await pool(removed, opts.concurrency, async (key) => {
      const r = await tx.del(key, mayRetry);
      if (r.code === 0) { const wait = cp.del(key); if (wait) await wait; }
      return r;
    }, (d, t) => {
      if (d % 100 === 0 || d === t) console.log(`  …deleted ${d}/${t}`);
    }, pastDeadline);
    failures.push(...f);
    if (f.started < removed.length) stoppedEarly = true;
  }

  if (failures.length || stoppedEarly) {
    // Keep what this run confirmed: a checkpoint is old manifest + confirmed puts - confirmed deletes.
    const c = await cp.flush(failures.length ? "after failures" : "budget");
    const s = cp.stats();
    const kept = restricted
      ? "a restricted run records nothing"
      : c.code === 0
        ? `progress kept — the manifest records the ${s.confirmed} put(s)${s.deleted ? ` and ${s.deleted} delete(s)` : ""} this run confirmed (${s.written} checkpoint(s))`
        : `the last checkpoint write FAILED — the manifest records ${s.recorded} of this run's ${s.confirmed + s.deleted} confirmed operation(s)`;
    if (failures.length) {
      console.error(`\nr2-sync: ${failures.length} operation(s) FAILED; ${kept}. The next run retries the rest.`);
      for (const f of failures.slice(0, 10)) console.error(`  ! ${f.item}\n    ${f.err}`);
      if (failures.length > 10) console.error(`  … and ${failures.length - 10} more`);
      process.exit(1);
    }
    console.log(`r2-sync: PARTIAL — the ${Math.round(opts.budgetMs / 1000)}s budget ran out; ${kept}. ${uploads.length - s.confirmed} put(s) and ${removed.length - s.deleted} delete(s) remain for the next run.`);
    process.exit(5);
  }

  // Manifest LAST — see the interruption-safety note in this file's header.
  if (restricted) {
    console.log("r2-sync: restricted run — manifest left untouched (it describes the whole tree, not a subset).");
  } else {
    await cp.idle(); // an older checkpoint must never land after the full manifest
    const r = await tx.putManifest(current, opts.manifestKey);
    if (r.code !== 0) {
      console.error(`r2-sync: objects synced but the manifest write FAILED — the next run will redo this diff (wasteful, not wrong).\n${r.err.trim()}`);
      process.exit(1);
    }
    console.log(`r2-sync: manifest updated — ${keys.length} object(s) recorded.`);
  }

  console.log(`r2-sync: done. ${added.length} added, ${changed.length} changed, ${removed.length} deleted.`);
}

// Only run when invoked directly. Importing this module (a test harness reading
// its exclusion logic, say) must never start a deploy — a stray `import` that
// fired main() against the REAL bucket is exactly the accident this guard is
// here to make impossible.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`r2-sync: ${e?.stack || e}`);
    process.exit(1);
  });
}

export { walkTree, buildExclusions, contentTypeFor, bucketFromWranglerToml, MANIFEST_KEY, disallowedTopLevel, fetchManifest, MISSING_OBJECT_RE,
  makeS3Client, s3EncodeKey, readEnvFile, manifestBody };
