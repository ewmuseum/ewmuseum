#!/usr/bin/env node
/**
 * validate-provenance-notes.mjs -- standalone check for the typed
 * provenance-claim records produced by convert-provenance-notes.py
 * (PROVENANCE-NOTES-01, 2026-09-13; schema.md). Read-only. Checks, per
 * `promotions.json[].provenance_notes[]` entry:
 *
 *   1. `kind` is one of the 14 enum values (schema.md's KIND_ENUM);
 *   2. exactly one of `date`/`span` is non-null, or both are null;
 *   3. `date` (when set) is well-formed: precision in
 *      exact|month|year|unknown, value shape matches precision (same rule
 *      as validate-documents.mjs's document_date check);
 *   4. `span` (when set) has a well-formed `from` (required) and `to`
 *      (nullable), each shaped like `date` above;
 *   5. `sources` is a non-empty array, OR `grade === "presumed"`;
 *   6. every `sources[]` entry has a `kind` in the known-kinds list (same
 *      list validate-documents.mjs uses);
 *   7. `grade` is one of primary-source|user-attested|presumed;
 *   8. `recorded` matches YYYY-MM-DD;
 *   9. `summary.length <= 160`;
 *  10. `summary` matches neither PROCESS_MARKER_RE nor NAME_PROCESS_TEXT_RE
 *      (imported from museum/scripts/text-markers.mjs -- the shared
 *      module, not a second hand-copied regex);
 *  11. `related`, when present, is an array of strings.
 *
 * A record still carrying `claim`/`evidence` (i.e. never converted) is
 * reported as NOT YET CONVERTED, a separate count from a genuine failure,
 * so this check can run against a partially-migrated file without every
 * un-migrated row drowning out real problems.
 *
 * Exit non-zero on any FAIL. Designed to be wired into `npm run check` the
 * same way validate-documents.mjs is (or folded into registry-validate.mjs
 * directly) -- stands alone deliberately so it can be reviewed/landed
 * separately. Run: `node validate-provenance-notes.mjs [promotions.json path] [museum-root]`.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const KIND_ENUM = [
  "founding", "closure", "rename", "membership-alliance", "title-lineage",
  "roster-character", "document-served", "document-collected",
  "identity-guard", "correction", "tier-depth-change", "liveness-host",
  "cross-reference", "other",
];
const GRADE_ENUM = ["primary-source", "user-attested", "presumed"];
const KNOWN_SOURCE_KINDS = ["newsgroup", "wayback", "arquivo", "geocities-torrent", "direct", "commoncrawl", "unknown", "forum"];  // forum: GAVELS 2026-09-23
const DATE_SHAPES = { exact: /^\d{4}-\d{2}-\d{2}$/, month: /^\d{4}-\d{2}$/, year: /^\d{4}$/ };

const LAW_ARGV = process.argv.slice(2).filter((a) => a !== "--law-baseline");
const museumRoot = LAW_ARGV[1] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");  // repo root from the script's own location (2026-09-15)
const promosPath = LAW_ARGV[0] || path.join(museumRoot, "data", "promotions.json");

if (!existsSync(promosPath)) {
  console.error(`FAIL: ${promosPath} does not exist`);
  process.exit(1);
}

// Dynamic import (not a static one) because the marker module's path
// depends on --museum-root, a runtime argument -- ES module static
// import specifiers can't be parameterized. Same shared module every
// other consumer (registry-validate.mjs, cross-reference.mjs,
// validate-documents.mjs's sibling lane) imports; no regex is
// hand-copied into this file.
const markersPath = path.join(museumRoot, "scripts", "text-markers.mjs");
if (!existsSync(markersPath)) {
  console.error(`FAIL: shared marker module not found at ${markersPath} (pass museum-root as the 2nd argument)`);
  process.exit(1);
}
const { PROCESS_MARKER_RE, NAME_PROCESS_TEXT_RE } = await import(pathToFileURL(markersPath).href);

const data = JSON.parse(readFileSync(promosPath, "utf-8"));
const promos = Array.isArray(data) ? data : data.promotions;
if (!Array.isArray(promos)) {
  console.error("FAIL: promotions.json has no usable `promotions` array");
  process.exit(1);
}

const errors = [];
const fail = (m) => errors.push(m);

// ---------------------------------------------------------------------------
// THE LAW RATCHET (LAW-ENFORCEMENT-01, 2026-09-19) — see the long comment in
// scripts/registry-validate.mjs for the doctrine. Counted every run, compared
// against scripts/law-baseline.json; a `max` rule whose count rose, or a `min`
// rule whose count fell, is a hard failure. `npm run law:baseline` rewrites
// the file and is a Janitor-or-coordinator act, never routine. Duplicated
// verbatim across the four validators on purpose (this lane's file scope).
//
// THE FINDING THIS FILE EXISTS TO STOP REPEATING. On 2026-09-13 (commit
// 492a27ff5e) 1,384 of 1,388 promotions.json rows carried provenance_notes.
// On 2026-09-14 (commit e82bf9dbc2, chain 140) ZERO did, and every one has
// been empty since. The narratives survive in the workshop
// (the per-wing provenance narratives in the workshop, 1,397 files) — the standing
// preflight fixer wrote them out and never wrote the typed records back. This
// validator reported "0 provenance_notes[] entries seen ... OK" through every
// gate of that week: a validator that iterates a list is VACUOUSLY GREEN when
// the list is empty. The two rules below are the fix — the count of rows
// missing their typed records may not rise, and the total number of typed
// records may not fall.
// ---------------------------------------------------------------------------
const LAW_SCOPE = "validate-provenance-notes";
const LAW_BASELINE_PATH = path.join(museumRoot, "scripts", "law-baseline.json");
const LAW_RULES = {
  "promotion-provenance-notes-missing": { dir: "max", law: "SCHEMA provenance_notes[] + CURATION #provenance-per-accession-lot: every promotion row carries at least one TYPED provenance record — an empty array is a mint with no recorded founding" },
  "provenance-note-total": { dir: "min", law: "THE FIELD-COUNT RATCHET, and the reason it exists: the floor is 6,389 — the number of typed provenance records standing on 1,384 of 1,388 promotion rows at commit fbb3965d87 (chain 139, 2026-09-13), every one of which was gone by e82bf9dbc2 (chain 140, 2026-09-14) with five days of gates reporting '0 entries seen ... OK'. The floor is DELIBERATELY set above today's count: this rule is RED until the records are rebuilt from the pre-drop commit and the per-wing narratives (in the workshop), which is the correct state for a gate to be in while 6,389 authored records are missing" },
  "provenance-note-untyped": { dir: "max", law: "PROVENANCE-NOTES-01 (2026-09-13): a legacy {claim, evidence} note is converted to a typed record, never left in place" },
};
const lawCounts = Object.fromEntries(Object.keys(LAW_RULES).map((r) => [r, 0]));
const lawHit = (rule, n = 1) => { lawCounts[rule] += n; };
function lawRatchet(report) {
  const writing = process.argv.includes("--law-baseline");
  let base = { _comment: "THE LAW BASELINE — see the LAW RATCHET comment in scripts/registry-validate.mjs. Rewritten only by `npm run law:baseline`, a Janitor-or-coordinator act after debt is paid, never routine.", _written: new Date().toISOString().slice(0, 10), rules: {} };
  if (existsSync(LAW_BASELINE_PATH)) {
    try { base = JSON.parse(readFileSync(LAW_BASELINE_PATH, "utf8")); } catch { /* rewritten below when --law-baseline */ }
  }
  if (!base.rules || typeof base.rules !== "object") base.rules = {};
  const over = [];
  const lines = [];
  for (const [rule, spec] of Object.entries(LAW_RULES)) {
    const n = lawCounts[rule];
    if (writing) {
      base.rules[rule] = { scope: LAW_SCOPE, direction: spec.dir, count: n, law: spec.law };
      lines.push(`  ${rule.padEnd(34)} ${String(n).padStart(6)}  recorded`);
      continue;
    }
    const b = base.rules[rule];
    if (!b || typeof b.count !== "number") {
      lines.push(`  ${rule.padEnd(34)} ${String(n).padStart(6)}  NO BASELINE`);
      over.push(`${rule}: ${n} counted but scripts/law-baseline.json records no baseline for it — run \`npm run law:baseline\` (a Janitor-or-coordinator act)`);
      continue;
    }
    const risen = spec.dir === "max" ? n > b.count : n < b.count;
    lines.push(`  ${rule.padEnd(34)} ${String(n).padStart(6)} / ${spec.dir} ${String(b.count).padEnd(6)} ${risen ? (spec.dir === "max" ? "ROSE - FAIL" : "FELL - FAIL") : "ok"}`);
    if (risen) {
      over.push(spec.dir === "max"
        ? `${rule}: ${n} violations, baseline ${b.count} (+${n - b.count}) — ${spec.law}`
        : `${rule}: ${n}, floor ${b.count} (-${b.count - n}) — ${spec.law}`);
    }
  }
  console.log(`\nlaw-ratchet [${LAW_SCOPE}] — counted this run vs scripts/law-baseline.json:`);
  for (const l of lines) console.log(l);
  if (writing) {
    writeFileSync(LAW_BASELINE_PATH, JSON.stringify(base, null, 2) + "\n");
    console.log(`  baseline rewritten for ${LAW_SCOPE} (${Object.keys(LAW_RULES).length} rules)`);
    return;
  }
  for (const o of over) report(`LAW RATCHET (${LAW_SCOPE}) ${o}`);
}


function checkDateObj(where, d) {
  if (!d || typeof d !== "object") {
    fail(`${where}: not an object`);
    return;
  }
  const { date, precision } = d;
  if (!["exact", "month", "year", "unknown"].includes(precision)) {
    fail(`${where}: precision "${precision}" not recognised`);
    return;
  }
  if (precision === "unknown") {
    if (date !== null) fail(`${where}: precision "unknown" but date is "${date}", expected null`);
    return;
  }
  if (typeof date !== "string" || !DATE_SHAPES[precision].test(date)) {
    fail(`${where}: date "${date}" doesn't match precision "${precision}"`);
  }
}

let total = 0;
let notYetConverted = 0;
let byKind = {};
let byGrade = {};

for (const p of promos) {
  const wing = p && p.id ? p.id : "?";
  const pns = p && p.provenance_notes;
  if (!Array.isArray(pns) || pns.length === 0) {
    lawHit("promotion-provenance-notes-missing");
    if (!Array.isArray(pns)) continue;
  }
  if (!Array.isArray(pns)) continue;
  pns.forEach((pn, idx) => {
    total++;
    const where = `${wing}[${idx}]`;
    if (!pn || typeof pn !== "object") {
      fail(`${where}: not an object`);
      return;
    }
    if ("claim" in pn || "evidence" in pn) {
      notYetConverted++;
      lawHit("provenance-note-untyped");
      return; // not a typed record yet -- not this check's concern
    }

    // 1. kind
    if (!KIND_ENUM.includes(pn.kind)) {
      fail(`${where}: kind "${pn.kind}" not in the 14-value enum`);
    } else {
      byKind[pn.kind] = (byKind[pn.kind] || 0) + 1;
    }

    // 2/3/4: date xor span
    const hasDate = pn.date !== null && pn.date !== undefined;
    const hasSpan = pn.span !== null && pn.span !== undefined;
    if (hasDate && hasSpan) {
      fail(`${where}: both date and span are set (must be at most one)`);
    }
    if (hasDate) checkDateObj(`${where}.date`, pn.date);
    if (hasSpan) {
      if (!pn.span.from) {
        fail(`${where}.span: missing "from"`);
      } else {
        checkDateObj(`${where}.span.from`, pn.span.from);
      }
      if (pn.span.to !== null && pn.span.to !== undefined) {
        checkDateObj(`${where}.span.to`, pn.span.to);
      }
    }

    // 5/6: sources
    if (!Array.isArray(pn.sources)) {
      fail(`${where}: sources is not an array`);
    } else if (pn.sources.length === 0 && pn.grade !== "presumed") {
      fail(`${where}: sources[] is empty but grade is "${pn.grade}" (only "presumed" may have empty sources)`);
    } else {
      for (const s of pn.sources) {
        if (!s || typeof s !== "object" || !s.kind) {
          fail(`${where}: a sources[] entry has no "kind"`);
        } else if (!KNOWN_SOURCE_KINDS.includes(s.kind)) {
          fail(`${where}: unknown source kind "${s.kind}"`);
        }
      }
    }

    // 7: grade
    if (!GRADE_ENUM.includes(pn.grade)) {
      fail(`${where}: grade "${pn.grade}" not in primary-source|user-attested|presumed`);
    } else {
      byGrade[pn.grade] = (byGrade[pn.grade] || 0) + 1;
    }

    // 8: recorded
    if (typeof pn.recorded !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(pn.recorded)) {
      fail(`${where}: recorded "${pn.recorded}" is not YYYY-MM-DD`);
    }

    // 9/10: summary
    if (typeof pn.summary !== "string") {
      fail(`${where}: summary is not a string`);
    } else {
      if (pn.summary.length > 160) {
        fail(`${where}: summary is ${pn.summary.length} chars, exceeds 160`);
      }
      if (PROCESS_MARKER_RE.test(pn.summary)) {
        fail(`${where}: summary matches PROCESS_MARKER_RE`);
      }
      if (NAME_PROCESS_TEXT_RE.test(pn.summary)) {
        fail(`${where}: summary matches NAME_PROCESS_TEXT_RE`);
      }
    }

    // 11: related
    if (pn.related !== undefined && pn.related !== null) {
      if (!Array.isArray(pn.related) || pn.related.some((r) => typeof r !== "string")) {
        fail(`${where}: related is present but not an array of strings`);
      }
    }
  });
}

lawHit("provenance-note-total", total);
console.log(`validate-provenance-notes: ${total} provenance_notes[] entries seen ` +
  `(${notYetConverted} not yet converted -- skipped, ${total - notYetConverted} checked)`);
if (Object.keys(byKind).length) {
  console.log("  by kind: " + Object.entries(byKind).map(([k, n]) => `${k}=${n}`).join(", "));
}
if (Object.keys(byGrade).length) {
  console.log("  by grade: " + Object.entries(byGrade).map(([k, n]) => `${k}=${n}`).join(", "));
}

lawRatchet(fail);

if (errors.length) {
  console.error(`validate-provenance-notes: ${errors.length} problem(s)`);
  for (const e of errors.slice(0, 200)) console.error("  " + e);
  if (errors.length > 200) console.error(`  ... and ${errors.length - 200} more`);
  process.exit(1);
}
console.log("validate-provenance-notes: OK");
