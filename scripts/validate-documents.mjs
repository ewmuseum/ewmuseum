#!/usr/bin/env node
/**
 * validate-documents.mjs — standalone check for museum/data/documents.json
 * (PROVENANCE-BACKFILL-01, 2026-09-13). Read-only. Checks:
 *
 *   1. every served promotions/*\/archive/*.html and *\/rp/*.html page has
 *      a documents.json row (page match);
 *   2. every row's `page` points at a file that actually exists on disk;
 *   3. every row's `sources` array is non-empty;
 *   4. every row's `document_date` is well-formed (date/precision consistent
 *      — YYYY / YYYY-MM / YYYY-MM-DD matching exact/month/year, or null with
 *      precision "unknown");
 *   5. every row's `collection`, when set, matches a known
 *      data/collections.json id;
 *   6. `doc_class` is "roleplay" for every /rp/ page (never the raw "rp").
 *
 * Exit non-zero on any failure so it can be wired into `npm run check` the
 * same way registry-validate.mjs is (or folded into that file directly —
 * this stands alone deliberately so it can be reviewed/landed separately
 * from a 4000+ line file). Run: `node validate-documents.mjs [museum-root]`.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LAW_ARGV = process.argv.slice(2).filter((a) => a !== "--law-baseline");
const ROOT = LAW_ARGV[0] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");  // repo root from the script's own location — CI checks out elsewhere (2026-09-15)
const errors = [];
const fail = (m) => errors.push(m);

// ---------------------------------------------------------------------------
// THE LAW RATCHET (LAW-ENFORCEMENT-01, 2026-09-19) — see the long comment in
// scripts/registry-validate.mjs for the doctrine. Counted every run, compared
// against scripts/law-baseline.json; a rule whose count rose above its
// baseline is a hard failure. `npm run law:baseline` rewrites the file and is
// a Janitor-or-coordinator act, never routine. Duplicated verbatim across the
// four validators on purpose (this lane's file scope).
//
// Both rules here stand at ZERO today and are written to KEEP standing there:
// the "attachment" source kind that took 473 rows to the gate on 2026-09-15
// (gate 143 run 6) and the workshop file paths served as source urls the same
// night (gate 143 run 4) are each already hard-failed below. The ratchet is
// the second lock: if a later pass ever softens one of those hard failures,
// the count still cannot rise.
// ---------------------------------------------------------------------------
const LAW_SCOPE = "validate-documents";
const LAW_BASELINE_PATH = path.join(ROOT, "scripts", "law-baseline.json");
const LAW_RULES = {
  "document-source-kind-unknown": { dir: "max", law: "CURATION #medium-defined discipline applied to sources[].kind: a source kind is a deliberate, documented addition, never a value invented in a lane brief (the 'attachment' kind, gate 143 run 6)" },
  "document-source-workshop-url": { dir: "max", law: "GAVELS 2026-09-07 SOURCE LINKS + CURATION #provenance-per-accession-lot: a served document cites its PUBLIC source (Google Groups / Wayback / the original URL) — never a workshop file path, which the provenance renderer turns into a broken internal link (gate 143 run 4)" },
  "source-link-missing-forward": { dir: "max", law: "GAVELS 2026-09-07 SOURCE LINKS, a FORWARD rule: every document added from that day on links its public source. A page whose provenance Source line carries no <a href> and whose served_since is 2026-09-08 or later is a breach of the forward rule, not backfill debt" },
  "source-link-missing-total": { dir: "max", law: "the same gavel read as the backfill queue: every served document eventually links its public source (the Janitor's own words: 'ensure every document we add with a public source explicitly links to that source')" },
  "source-link-present-total": { dir: "min", law: "the field-count ratchet (coordinator, 2026-09-19): a count that only ever grows may not fall — a source link, once written, is never lost to a regeneration" },
  "documents-rows-total": { dir: "min", law: "the field-count ratchet: documents.json rows are only ever added (a withdrawal is a deliberate, ruled act that re-baselines); a drop is a lost provenance record, not a curation decision" },
  "document-doc-class-outside-v109": { dir: "max", law: "CURATION #serve-by-document-class v109(a) names ELEVEN classes (card, rp, roster, rules, news, staff, credits, guestbook, board, column, other) plus v111(e)'s machine-translation; `roleplay` is documents.json's own spelling of `rp`. Anything else — index, poll, charter, faq, none — is a class nobody ruled on, and v109(b)-(e) cannot be read off it" },
};
// v109(a)'s eleven, plus machine-translation (v111(e)), plus `roleplay` —
// documents.json's own spelling of `rp` (this file REQUIRES it on every /rp/
// page, while validate.mjs's page attribute takes `rp`; two vocabularies for
// two places, both meaning v109(a) class `rp`).
const V109_DOC_CLASSES = new Set(["card", "rp", "roster", "rules", "news", "staff",
  "credits", "guestbook", "board", "column", "other", "machine-translation", "poll"]); // 2026-09-19: one vocabulary with validate.mjs — `roleplay` is spelled `rp` everywhere; `poll` is the Janitor's new class
// The gavel's own boundary: rows served BEFORE this date are backfill debt,
// rows served on or after it are a breach of the forward rule.
const SOURCE_LINK_FORWARD_FROM = "2026-09-08";
const PROV_SOURCE_RE = /<dt>Source<\/dt>\s*<dd>([\s\S]*?)<\/dd>/i;
// hook c284: every Source row (fix-provenance-block renders one per sources[] entry); a page links its public source when ANY row links
const PROV_SOURCE_RE_ALL = /<dt>Source<\/dt>\s*<dd>([\s\S]*?)<\/dd>/gi;
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
// A source url that is a LOCAL WORKSHOP PATH rather than a public address:
// an absolute machine path, a file: url, a relative path, or any url whose
// own text names one of the workshop's collection trees.
const WORKSHOP_URL_RE = /^(?:file:|\/home\/|\/mnt\/|\.{1,2}\/)|(?:^|[\/"'\s])archive\/(?:digests|usenet-retro|direct-collected|privacy|desk|collect-never-serve|geo-mirrors)\//i;


function loadJson(p) {
  return JSON.parse(readFileSync(p, "utf-8"));
}

const docsPath = path.join(ROOT, "data/documents.json");
if (!existsSync(docsPath)) {
  console.error(`FAIL: ${docsPath} does not exist`);
  process.exit(1);
}
const docsRaw = loadJson(docsPath);
const rows = Array.isArray(docsRaw) ? docsRaw : docsRaw.documents;
if (!Array.isArray(rows)) {
  console.error("FAIL: documents.json has no usable `documents` array");
  process.exit(1);
}

const collectionsPath = path.join(ROOT, "data/collections.json");
const collectionIds = new Set(
  existsSync(collectionsPath) ? loadJson(collectionsPath).collections.map((c) => c.id) : []
);
// THE SOURCE-LINKS GAVEL'S OWN SCOPE (2026-09-07): "ensure every document we add WITH A PUBLIC SOURCE explicitly links to
// that source". A document from a private donation (collections.json kind "private-donation" — e.g. lot 0159, a federation's
// own backstage database given by its former owner) has no public source to link, so it is outside both source-link counts.
// Added 2026-09-22 when preflight 170 counted PCW's database-rendered bio cards as breaches.
const privateDonationLots = new Set(
  existsSync(collectionsPath) ? loadJson(collectionsPath).collections.filter((c) => c.kind === "private-donation").map((c) => c.id) : []
);

const byPage = new Map();
for (const r of rows) {
  if (!r || typeof r !== "object" || !r.page) {
    fail(`row with no "page" field: ${JSON.stringify(r).slice(0, 120)}`);
    continue;
  }
  if (byPage.has(r.page)) fail(`duplicate row for page ${r.page}`);
  byPage.set(r.page, r);
}

// 1 + 6: every served page has a row, and rp pages carry doc_class "roleplay"
const servedFiles = [
  ...globSync(path.join(ROOT, "promotions/*/archive/*.html")),
  ...globSync(path.join(ROOT, "promotions/*/rp/*.html")),
];
let missingRows = 0;
for (const f of servedFiles) {
  const rel = "/" + path.relative(ROOT, f);
  const row = byPage.get(rel);
  if (!row) {
    missingRows++;
    if (missingRows <= 20) fail(`no documents.json row for served page: ${rel}`);
    continue;
  }
  if (rel.includes("/rp/") && row.doc_class !== "rp") {
    fail(`${rel}: rp page but doc_class is "${row.doc_class}", expected "rp"`);
  }
}
if (missingRows > 20) fail(`... and ${missingRows - 20} more served pages with no documents.json row`);

// 2: every row's page exists on disk
for (const [pg, row] of byPage) {
  const full = path.join(ROOT, pg.replace(/^\//, ""));
  if (!existsSync(full)) fail(`documents.json row points at a page that doesn't exist: ${pg}`);
  else {
    // SOURCE LINKS (the Janitor's gavel, 2026-09-07) — the served page's own
    // provenance block links the public source, not just names it.
    const srcRows = [...readFileSync(full, "utf-8").matchAll(PROV_SOURCE_RE_ALL)].map((x) => x[1]);
    const m = srcRows.length ? [null, srcRows.find((d) => /<a\s+href/i.test(d)) ?? srcRows[0]] : null;
    const noPublicSource = privateDonationLots.has(row.collection) && !(row.sources || []).some((s) => s && s.url);
    if (m && /<a\s+href/i.test(m[1])) lawHit("source-link-present-total");
    if (m && !/<a\s+href/i.test(m[1]) && !noPublicSource) {
      lawHit("source-link-missing-total");
      if (typeof row.served_since === "string" && row.served_since >= SOURCE_LINK_FORWARD_FROM) lawHit("source-link-missing-forward");
    }
  }

  // 3: sources[] non-empty
  if (!Array.isArray(row.sources) || row.sources.length === 0) {
    fail(`${pg}: sources[] is empty`);
  } else {
    for (const s of row.sources) {
      if (!s || typeof s !== "object" || !s.kind) {
        fail(`${pg}: a sources[] entry has no "kind"`);
        continue;
      }
      const KNOWN_KINDS = ["newsgroup", "wayback", "arquivo", "geocities-torrent", "direct", "commoncrawl", "unknown", "forum"];  // forum: GAVELS 2026-09-23
      if (!KNOWN_KINDS.includes(s.kind)) { lawHit("document-source-kind-unknown"); fail(`${pg}: unknown source kind "${s.kind}"`); }
      if (typeof s.url === "string" && WORKSHOP_URL_RE.test(s.url)) {
        lawHit("document-source-workshop-url");
        fail(`${pg}: sources[].url "${s.url}" is a workshop file path, not a public source — cite the Google Groups / Wayback / original URL (GAVELS 2026-09-07 SOURCE LINKS); the provenance renderer links this field and a workshop path becomes a broken internal link`);
      }
    }
  }

  // 4: document_date well-formed
  const dd = row.document_date;
  if (!dd || typeof dd !== "object") {
    fail(`${pg}: missing document_date`);
  } else {
    const { date, precision } = dd;
    if (!["exact", "month", "year", "circa", "unknown"].includes(precision)) {  // circa (2026-09-13): the document itself says "circa"
      fail(`${pg}: document_date.precision "${precision}" not recognised`);
    } else if (precision === "unknown") {
      if (date !== null) fail(`${pg}: precision "unknown" but date is "${date}", expected null`);
    } else {
      const shapes = { exact: /^\d{4}-\d{2}-\d{2}$/, month: /^\d{4}-\d{2}$/, year: /^\d{4}$/, circa: /^\d{4}(-\d{2}(-\d{2})?)?$/ };
      if (typeof date !== "string" || !shapes[precision].test(date)) {
        fail(`${pg}: document_date "${date}" doesn't match precision "${precision}"`);
      }
    }
  }

  // v109(a): the class is one the law actually names
  if (row.doc_class && !V109_DOC_CLASSES.has(row.doc_class)) lawHit("document-doc-class-outside-v109");

  // 5: collection, when set, is a known id
  if (row.collection && collectionIds.size && !collectionIds.has(row.collection)) {
    fail(`${pg}: collection "${row.collection}" is not a known collections.json id`);
  }

  // parts, when set, is well-formed
  if (row.parts !== null && row.parts !== undefined) {
    if (typeof row.parts !== "object" || !("of" in row.parts)) {
      fail(`${pg}: parts is set but malformed: ${JSON.stringify(row.parts)}`);
    }
  }
}

lawHit("documents-rows-total", rows.length);
lawRatchet(fail);

if (errors.length) {
  console.error(`validate-documents: ${errors.length} problem(s)`);
  for (const e of errors.slice(0, 200)) console.error("  " + e);
  process.exit(1);
}
console.log(`validate-documents: OK — ${rows.length} rows, ${servedFiles.length} served pages, all consistent`);
