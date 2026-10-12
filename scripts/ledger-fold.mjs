#!/usr/bin/env node
// ledger-fold.mjs — COORDINATOR tool. Folds one branch's pending redaction-
// ledger fragment into the workshop's main ledger, at merge time.
//
// Why fragments exist: the main ledger (the workshop's redaction-ledger.tsv)
// is one shared file outside git. When a lane appended a deny row the moment
// it redacted a term in ITS worktree, the gate on main and in every OTHER
// worktree went red on that term wherever it still stood unredacted — until
// that lane's redaction merged. (Seven times on 2026-09-02.) So lanes now
// file their rows in the ledger's pending fragment <branch>.tsv, which only
// their own branch's privacy-check reads; the coordinator folds the fragment
// into the main ledger once the lane's redactions are on main.
//
// Usage (from the museum repo root, main or a worktree):
//   node scripts/ledger-fold.mjs <branch> [--dry-run]
//
// Appends the fragment's rows to the main ledger, skipping (and reporting)
// terms the ledger already carries, then deletes the fragment. Idempotent:
// a missing ledger-pending/ directory or fragment is a no-op, exit 0.

import { execSync } from "node:child_process";
import { readFileSync, existsSync, appendFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const branch = args.find((a) => !a.startsWith("--"));
if (!branch) {
  console.error("usage: node scripts/ledger-fold.mjs <branch> [--dry-run]");
  process.exit(2);
}

// Same resolution privacy-check.mjs uses: main repo root = parent of the
// COMMON git dir, so this works from a worktree too. LEDGER_PATH / PENDING_DIR
// let a test harness point this at scratch copies instead of the real files
// (PRIVACY_LEDGER is kept as a synonym for LEDGER_PATH — privacy-check.mjs's
// own override name).
function findLedger() {
  if (process.env.LEDGER_PATH) return process.env.LEDGER_PATH;
  if (process.env.PRIVACY_LEDGER) return process.env.PRIVACY_LEDGER;
  if (process.env.WORKSHOP_ROOT) return join(process.env.WORKSHOP_ROOT, "privacy", "redaction-ledger.tsv");
  const commonDir = execSync("git rev-parse --path-format=absolute --git-common-dir", { encoding: "utf8" }).trim();
  return join(dirname(commonDir), "..", "archive", "privacy", "redaction-ledger.tsv");
}

const ledgerPath = findLedger();
if (!existsSync(ledgerPath)) {
  console.error("ledger-fold: FAIL — ledger not found at " + ledgerPath);
  process.exit(2);
}

const pendingDir = process.env.PENDING_DIR || join(dirname(ledgerPath), "ledger-pending");
const fragmentPath = join(pendingDir, branch.replace(/\//g, "-") + ".tsv");
if (!existsSync(fragmentPath)) {
  console.log(`ledger-fold: nothing to fold — no fragment for "${branch}" (${fragmentPath}).`);
  process.exit(0);
}

const isRow = (l) => l.trim() && !l.startsWith("#");
const termOf = (l) => (l.split("\t")[0] || "").trim().toLowerCase();

// A row is a duplicate only if the ledger already holds a row with the same
// term (case-insensitive), the same status, and the same scope string — NOT
// on the term alone. That's what lets a page-scoped `allow` row fold in
// alongside an existing unscoped (or differently-scoped) `deny` row for the
// same term: an allow with a new scope, or a deny with a different scope, is
// a new row, not a duplicate. Scope-widening an EXISTING deny row is still
// ledger-merge-scopes.py's job, run before this script; this key only says
// whether the exact (term, status, scope) triple is already on file.
const keyOf = (l) => {
  const cols = l.split("\t");
  const term = (cols[0] || "").trim().toLowerCase();
  if (!term) return "";
  const status = (cols[2] || "").trim().toLowerCase();
  const scope = (cols[3] || "").trim();
  return `${term}${status}${scope}`;
};

// The scan matches case-insensitively, so a case variant is a duplicate too.
const existing = new Set(
  readFileSync(ledgerPath, "utf8").split("\n").filter(isRow).map(keyOf).filter(Boolean),
);

const fragmentRows = readFileSync(fragmentPath, "utf8").split("\n").filter(isRow);
const fresh = [];
const dupes = [];
const seen = new Set();
for (const row of fragmentRows) {
  const t = termOf(row);
  if (!t) continue;
  const k = keyOf(row);
  if (existing.has(k) || seen.has(k)) { dupes.push(row); continue; }
  seen.add(k);
  fresh.push(row);
}

for (const d of dupes) console.log("  already in ledger, skipped: " + d.split("\t").slice(1, 3).join("\t") + " (term withheld)");

if (dryRun) {
  console.log(`ledger-fold: DRY RUN — would append ${fresh.length} row(s) from ${branch}, skip ${dupes.length} duplicate(s); fragment kept.`);
  process.exit(0);
}

if (fresh.length) {
  const tail = readFileSync(ledgerPath, "utf8");
  appendFileSync(ledgerPath, (tail.endsWith("\n") ? "" : "\n") + fresh.join("\n") + "\n");
}
unlinkSync(fragmentPath);
console.log(`ledger-fold: folded ${fresh.length} row(s) from "${branch}" into ${ledgerPath}; ${dupes.length} duplicate(s) skipped; fragment removed.`);
