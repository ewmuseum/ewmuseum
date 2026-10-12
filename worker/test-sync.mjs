#!/usr/bin/env node
/**
 * THE MUSEUM — incremental-deploy test for scripts/r2-sync.mjs.
 *
 * The Worker's job is easy to eyeball; the sync script's is not. Its diff
 * decides what gets uploaded and, more to the point, what gets DELETED from a
 * bucket holding the entire museum. A bug in the prune path is not a broken
 * page, it is a missing wing. So the add / no-op / change / delete cycle gets
 * exercised for real, against the local R2 simulator, using the real script.
 *
 *   node worker/test-sync.mjs
 *
 * Exits 0 on green, 1 on any failure — read the exit code, not the output.
 *
 * It runs against a small `--include` subset with its own `--manifest-key`, so
 * the whole cycle takes under a minute instead of the hour a real 15,600-file
 * seed would. The logic under test is identical either way: the diff does not
 * know or care how many keys it was handed.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, rmSync, mkdirSync, writeFileSync, copyFileSync, unlinkSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const STATE = resolve(ROOT, ".wrangler", "sync-test-state");
const MANIFEST = "_test_manifest.json";

// A scratch page inside the real tree: the only way to test "changed" and
// "deleted" honestly is with a file the script actually walks. It is created
// and removed by this script and never committed.
const SCRATCH = "promotions/giwf/_synctest-scratch.html";

const SUBSET = ["promotions/giwf", "index.html"];

const results = [];
function check(name, actual, expected) {
  const ok = actual === expected;
  results.push({ name, ok, detail: ok ? "" : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` });
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

function devBucket() {
  const toml = readFileSync(resolve(ROOT, "worker", "wrangler.toml"), "utf8");
  const m = toml.match(/^\s*bucket_name\s*=\s*"([^"]+)"/m);
  if (!m) throw new Error("worker/wrangler.toml has no bucket_name");
  return m[1] + "-synctest";
}
const BUCKET = devBucket();

function sync(extra = []) {
  const includes = SUBSET.flatMap((p) => ["--include", p]);
  const r = spawnSync(
    process.execPath,
    [
      resolve(ROOT, "scripts", "r2-sync.mjs"),
      "--local", "--persist-to", STATE, "--bucket", BUCKET,
      "--manifest-key", MANIFEST, "--yes", ...includes, ...extra,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  const out = (r.stdout || "") + (r.stderr || "");
  return { code: r.status ?? 1, out };
}

/** Pull the "N added, N changed, N deleted" line out of a run's output. */
function diffOf(out) {
  const m = out.match(/diff — (\d+) added, (\d+) changed, (\d+) deleted/);
  if (!m) return null;
  return { added: +m[1], changed: +m[2], deleted: +m[3] };
}

function objectExists(key) {
  const w = existsSync(resolve(ROOT, "node_modules", ".bin", "wrangler"))
    ? { cmd: resolve(ROOT, "node_modules", ".bin", "wrangler"), pre: [] }
    : { cmd: "npx", pre: ["--yes", "wrangler"] };
  const tmp = join(STATE, "probe.bin");
  try { unlinkSync(tmp); } catch { /* not there */ }
  const r = spawnSync(w.cmd, [...w.pre, "r2", "object", "get", `${BUCKET}/${key}`, "--file", tmp, "--local", "--persist-to", STATE], {
    cwd: ROOT, encoding: "utf8",
  });
  const there = r.status === 0 && existsSync(tmp);
  try { unlinkSync(tmp); } catch { /* fine */ }
  return there;
}

function cleanup() {
  try { unlinkSync(resolve(ROOT, SCRATCH)); } catch { /* already gone */ }
}

let exitCode = 0;
try {
  console.log(`sync-test: bucket ${BUCKET}, manifest ${MANIFEST}, subset ${SUBSET.join(" + ")}`);
  cleanup();
  rmSync(STATE, { recursive: true, force: true });
  mkdirSync(STATE, { recursive: true });

  // --- 1. dry run on an empty bucket: reports everything, uploads nothing ---
  console.log("\n1. dry run against an empty bucket");
  const dry = sync(["--dry-run"]);
  check("dry run exits 0", dry.code, 0);
  check("dry run says FIRST RUN", /FIRST RUN/.test(dry.out), true);
  check("dry run uploaded nothing", /nothing was uploaded or deleted/.test(dry.out), true);
  check("dry run left the bucket empty", objectExists("index.html"), false);
  const dryDiff = diffOf(dry.out);
  const total = dryDiff?.added ?? 0;
  check("dry run reports every file as added", dryDiff?.changed === 0 && dryDiff?.deleted === 0 && total > 0, true);

  // --- 2. first real run: full upload ---
  console.log("\n2. first real run");
  const first = sync();
  check("first run exits 0", first.code, 0);
  check("first run added the same count the dry run predicted", diffOf(first.out)?.added, total);
  check("index.html is in the bucket", objectExists("index.html"), true);
  check("a wing page is in the bucket", objectExists("promotions/giwf/index.html"), true);
  check("the manifest was written", objectExists(MANIFEST), true);

  // --- 3. re-run with nothing changed: a true no-op ---
  // This is the property the whole design rests on. An accession wave touching
  // 300 files must cost 300 puts, not 15,600.
  console.log("\n3. re-run with nothing changed");
  const noop = sync();
  check("no-op run exits 0", noop.code, 0);
  check("no-op run says the bucket is already current", /already current/.test(noop.out), true);
  const noopDiff = diffOf(noop.out);
  check("no-op run has an empty diff", `${noopDiff?.added}/${noopDiff?.changed}/${noopDiff?.deleted}`, "0/0/0");

  // --- 4. a new file: exactly one addition ---
  console.log("\n4. a new file appears in the tree");
  writeFileSync(resolve(ROOT, SCRATCH), "<!doctype html><title>scratch</title>one\n");
  const added = sync();
  check("added run exits 0", added.code, 0);
  check("exactly one addition", `${diffOf(added.out)?.added}/${diffOf(added.out)?.changed}/${diffOf(added.out)?.deleted}`, "1/0/0");
  check("the new object is in the bucket", objectExists(SCRATCH), true);

  // --- 5. an edited file: exactly one change, detected by content hash ---
  console.log("\n5. that file is edited");
  writeFileSync(resolve(ROOT, SCRATCH), "<!doctype html><title>scratch</title>two — different bytes\n");
  const changed = sync();
  check("changed run exits 0", changed.code, 0);
  check("exactly one change", `${diffOf(changed.out)?.added}/${diffOf(changed.out)?.changed}/${diffOf(changed.out)?.deleted}`, "0/1/0");

  // --- 6. a touched-but-identical file: NOT a change ---
  // The diff is by sha256, not mtime. Regenerating the site rewrites thousands
  // of files with identical content; an mtime-based diff would re-upload all of
  // them every single deploy.
  console.log("\n6. the file is rewritten with identical bytes");
  const sameBytes = readFileSync(resolve(ROOT, SCRATCH));
  writeFileSync(resolve(ROOT, SCRATCH), sameBytes);
  const touched = sync();
  check("touch-only run exits 0", touched.code, 0);
  check("identical bytes are not a change", /already current/.test(touched.out), true);

  // --- 7. deletion: the file leaves the tree, the object leaves the bucket ---
  console.log("\n7. the file is removed from the tree");
  unlinkSync(resolve(ROOT, SCRATCH));
  const deleted = sync();
  check("delete run exits 0", deleted.code, 0);
  check("exactly one deletion", `${diffOf(deleted.out)?.added}/${diffOf(deleted.out)?.changed}/${diffOf(deleted.out)?.deleted}`, "0/0/1");
  check("the object is gone from the bucket", objectExists(SCRATCH), false);
  check("its neighbours survived", objectExists("promotions/giwf/index.html"), true);

  // --- 8. --no-prune: a deletion is reported as nothing to do ---
  console.log("\n8. --no-prune keeps orphans");
  writeFileSync(resolve(ROOT, SCRATCH), "<!doctype html><title>scratch</title>three\n");
  sync();
  unlinkSync(resolve(ROOT, SCRATCH));
  const noPrune = sync(["--no-prune"]);
  check("--no-prune exits 0", noPrune.code, 0);
  check("--no-prune deletes nothing", diffOf(noPrune.out)?.deleted, 0);
  check("--no-prune leaves the orphan in place", objectExists(SCRATCH), true);
  // Put it back the way it was, so a later real sync is not surprised.
  sync();
  check("a following pruning run cleans the orphan up", objectExists(SCRATCH), false);
} catch (e) {
  console.error(`\nsync-test: HARNESS ERROR — ${e?.stack || e}`);
  exitCode = 1;
} finally {
  cleanup();
  rmSync(STATE, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log("\n" + "-".repeat(64));
console.log(`sync-test: ${results.length - failed.length}/${results.length} assertions passed.`);
for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
if (failed.length || !results.length) exitCode = 1;
console.log(exitCode === 0 ? "sync-test: GREEN." : "sync-test: RED.");
process.exit(exitCode);
