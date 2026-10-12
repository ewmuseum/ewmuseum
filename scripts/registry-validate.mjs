#!/usr/bin/env node
/**
 * THE MUSEUM — entity registry validator (THE REGISTRY WAVE, hardened).
 *
 * No framework, no dependencies. Checks the data/ registry is internally
 * consistent, and that every entity link woven into curated pages by
 * scripts/cross-reference.mjs resolves to a real entity. Exit non-zero on
 * any failure so CI blocks the deploy — wired alongside scripts/validate.mjs
 * in the `check` job. Run: `npm run check:registry`.
 *
 * Every data/*.json file (SCHEMA-HARDENING WAVE) carries a top-level
 * `_schema_version` field. Array-shaped files are wrapped as
 * `{ _schema_version, <key>: [...] }`; frontier.json (already an object)
 * just gained the field alongside its existing `_dead_only_rule` /
 * `_status_values` header. `loadArray()` below unwraps either shape
 * transparently — it's the Node-side twin of js/list.js's
 * `MuseumList.fetchJSON`, which does the same thing client-side.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeStats, computeClacksNames, computeRecentlyAdded, recentlyAddedListHtml, computeCurationVersion, computeListTotals } from "./stamp-stats.mjs";
import { buildAll as buildAllShards, listShardDirs, readShardRows } from "./build-data.mjs";
// THE SHARED MARKER MODULE (PROSE-FIX-01, 2026-09-13; proposal.md #0) — the
// gate's own PROCESS_TEXT_RE/NAME_PROCESS_TEXT_RE now come from the same
// tagged source list cross-reference.mjs's render-time filter compiles
// from, so a fix to one no longer silently misses the other. See
// text-markers.mjs's own header for what changed in this pass (the Janitor
// tightening, the curator-title/co-owner phrase fix, MEMORIAL GUARD, the workshop-date
// shape) and why "member federation"/bare "near-miss" stay gate-only.
import { PROCESS_TEXT_RE, NAME_PROCESS_TEXT_RE, FIELD_CAPS } from "./text-markers.mjs";
import { SHARD_TYPES, UNASSIGNED_SHARD, buildTitlePromotionMap, shardOf } from "./shard-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = resolve(ROOT, "data");
const errors = [];
const warnings = [];
const warn = (msg) => errors.push(msg);
const soft = (msg) => warnings.push(msg);

// ---------------------------------------------------------------------------
// THE LAW RATCHET (LAW-ENFORCEMENT-01, 2026-09-19 — the Janitor: "stop
// walking and landing wings until you can adequately enforce the law as
// we've written it. This cannot be on me to ask about ad hoc.")
//
// Several rules of the law were written, gaveled, and then enforced only by
// a soft() advisory that every gate printed and nobody read — 13,928 of them
// on the day this was written. A soft warning is not enforcement. But hard-
// failing them outright would red the gate on ~1,000 wings of accumulated
// debt that predates the rule's machinery, which just means the gate gets
// bypassed instead.
//
// The ratchet is the middle: every rule below is COUNTED every run and
// compared against scripts/law-baseline.json, the count recorded on the day
// the rule was wired. A rule whose count ROSE above its baseline (or, for a
// `min` rule, FELL below it — the shape that catches a regeneration silently
// stripping authored prose) is a HARD FAILURE. Debt may be paid down, never
// added to. The per-rule counts print every run, baseline beside them, so
// the debt is visible instead of buried in an advisory wall.
//
// `npm run law:baseline` rewrites the file. That is a JANITOR-OR-COORDINATOR
// ACT, taken after debt has actually been paid down (or after a rule's own
// definition deliberately changed) — never a routine step, never a way past
// a red gate. The gate is the thing that is supposed to be hard to move.
//
// The helper below is deliberately duplicated, verbatim, in validate.mjs,
// validate-documents.mjs and validate-provenance-notes.mjs rather than
// factored into a fifth shared module: this lane's file scope was fixed at
// four validators plus the baseline JSON, and a shared module would be a
// fifth file the coordinator did not review. If a later pass widens the
// scope, fold the four copies into scripts/law-ratchet.mjs first.
// ---------------------------------------------------------------------------
const LAW_SCOPE = "registry-validate";
const LAW_BASELINE_PATH = resolve(ROOT, "scripts", "law-baseline.json");
const LAW_RULES = {
  "epitaph-missing-tier1plus": { dir: "max", law: "CURATION #promotion-epitaphs + PROCESS 'Frontier -> Tier 0' step 4 (no epitaph owed BELOW tier 1): every wing at tier 1 or above carries a written Epitaph section on its own landing page" },
  "epitaph-present-total":     { dir: "min", law: "CURATION #promotion-epitaphs: an epitaph already written is never lost — a regeneration that strips one (wce/whq/wwe-the-efed, 2026-09) drops this count and fails here" },
  "house-style-missing-tier2plus": { dir: "max", law: "CURATION #tier-and-storylines + PROCESS 'Tier 1 -> Tier 2' step 4: a tier-2+ federation owes a graded, sourced house_style (community hubs owe none)" },
  "storylines-missing-tier3":  { dir: "max", law: "CURATION #tier-and-storylines: storylines are tier 3's OUTPUT — a tier-3 wing without a Storylines section has not had the crawl that earned its tier" },
  "served-text-narration":     { dir: "max", law: "CURATION #protagonist-test + THE SERVED-TEXT RULE (the Janitor 2026-09-05): no served field carries workshop process narration" },
  "award-recipient-unminted":  { dir: "max", law: "GAVELS 2026-09-13 rule 10 (AWARD RECIPIENTS ARE MINTED) + LAW-INDEX 2b: every bestowal recipient carries a character/unit id, even when the bestowal is all that is known" },
  "promotion-source-kind-unknown": { dir: "max", law: "CURATION #medium-defined discipline, applied to sources[].kind: a source kind is a deliberate, documented addition, never a value invented in the data (the 'attachment' kind, gate 143 run 6)" },
  "controlled-value-outside-enum": { dir: "max", law: "CURATION #medium-defined + the Janitor's 2026-09-10 gavel (medium is the PLATFORM; form is what the canon physically is; authorship is who writes it): a medium/form/play/authorship value outside its documented set is a typo or an undocumented invention, never a silent new vocabulary — the served placard reads it straight out ('Play: Booked')" },
  "aka-narration": { dir: "max", law: "SCHEMA aka[] ('a label the fed itself used') + THE SERVED-TEXT RULE: an aka is a LABEL, never a sentence about the label — a parenthetical explanation belongs in provenance_notes" },
  "promotion-provenance-notes-missing": { dir: "max", law: "docs/SCHEMA.md provenance_notes[] ('individually graded founding-fact claims'): every promotion row carries at least one TYPED provenance record. See the PROVENANCE BREACH note below — while the recorded debt is above zero this is ratcheted; the moment the baseline reads 0 the per-row check below becomes a HARD FAILURE on its own" },
  "house-style-present-total": { dir: "min", law: "the field-count ratchet (coordinator, 2026-09-19): a count that only ever grows may not fall — house styles are written once and never lost to a regeneration" },
};
// The baseline is read ONCE here, not just at report time, because two checks
// below arm themselves off it: a rule whose recorded debt has reached zero
// stops being a ratchet and becomes an ordinary hard failure, automatically,
// the moment the coordinator re-baselines after paying the debt down. That is
// the whole point of writing the debt down as a number instead of a promise.
let LAW_BASE = { rules: {} };
if (existsSync(resolve(ROOT, "scripts", "law-baseline.json"))) {
  try { LAW_BASE = JSON.parse(readFileSync(resolve(ROOT, "scripts", "law-baseline.json"), "utf8")); } catch { LAW_BASE = { rules: {} }; }
}
if (!LAW_BASE.rules || typeof LAW_BASE.rules !== "object") LAW_BASE.rules = {};
const lawDebtPaid = (rule) => (LAW_BASE.rules[rule]?.count ?? Infinity) === 0;
const lawCounts = Object.fromEntries(Object.keys(LAW_RULES).map((r) => [r, 0]));
const lawHit = (rule, n = 1) => { lawCounts[rule] += n; };
const lawSet = (rule, n) => { lawCounts[rule] = n; };
function lawRatchet(report) {
  const writing = process.argv.includes("--law-baseline");
  let base = existsSync(LAW_BASELINE_PATH) ? LAW_BASE : { _comment: "THE LAW BASELINE — see the LAW RATCHET comment in scripts/registry-validate.mjs. Rewritten only by `npm run law:baseline`, a Janitor-or-coordinator act after debt is paid, never routine.", _written: new Date().toISOString().slice(0, 10), rules: {} };
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


// ---------------------------------------------------------------------------
// 0. THE JSON-INTEGRITY FLOOR (found 2026-08-23: promotion-style-families.json
// carried unresolved merge-conflict markers — `<<<<<<<`/`=======`/`>>>>>>>`
// lines from a botched rebase — straight through a fully green gate. The
// gate hole was structural, not a one-off miss: every check below this one
// only ever inspects the small set of data/*.json files a hand-written
// `loadArray()`/`loadRaw()` call actually names (see below) or that some
// later, type-specific block happens to open — a cross-promotion file like
// promotion-style-families.json that no check explicitly asks for is never
// opened at all, so a syntactically broken file on disk simply never gets
// read, let alone parsed. This check is deliberately NOT keyed to any
// per-file allowlist: it globs every data/*.json file and every
// data/shards/**/*.json file straight off disk — the same files
// `build-data.mjs`/`cross-reference.mjs`/the stampers all eventually read —
// and hard-fails, by name, the first time any one of them (a) fails to
// JSON.parse, or (b) contains a raw line starting `<<<<<<<`, `=======`, or
// `>>>>>>>` (checked independently of parse success — a conflict that
// somehow leaves valid JSON behind, e.g. landing entirely inside a string
// value, would otherwise sail through the parse check alone). Every other
// check in this file assumes its own data already parses; this is the one
// that makes that assumption safe.
function listJsonFilesRecursive(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listJsonFilesRecursive(full));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      out.push(full);
    }
  }
  return out;
}
const CONFLICT_MARKERS = ["<<<<<<<", "=======", ">>>>>>>"];
{
  const topLevelJson = readdirSync(DATA, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => join(DATA, e.name));
  const shardsDir = resolve(DATA, "shards");
  const shardJson = existsSync(shardsDir) ? listJsonFilesRecursive(shardsDir) : [];
  for (const absPath of [...topLevelJson, ...shardJson]) {
    const relPath = relative(ROOT, absPath);
    let text;
    try {
      text = readFileSync(absPath, "utf8");
    } catch (e) {
      warn(`${relPath}: could not be read: ${e.message}`);
      continue;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const marker = CONFLICT_MARKERS.find((m) => lines[i].startsWith(m));
      if (marker) {
        warn(`${relPath}: line ${i + 1} starts with an unresolved merge-conflict marker ("${marker}") — this file carried a conflict straight through a merge`);
      }
    }
    try {
      JSON.parse(text);
    } catch (e) {
      warn(`${relPath}: does not parse as JSON: ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Shared by rps.json and shows.json below — a date's precision must be one
// of these, declared once here so both validation blocks can use it
// regardless of which one runs first in file order.
const PRECISIONS = new Set(["exact", "month", "year", "circa", "unknown"]);

// ---------------------------------------------------------------------------
// IMPOSSIBLE-DATE GUARD (2026-08-20, Janitor-directed: the Janitor thought
// they saw a show dated "20005" on a chronology — it turned out to be the
// `circa` label "2000s" misread, no bad data actually existed, but nothing
// in the gate would have STOPPED an impossible date from entering the
// registry, which is the actual gap this closes). One shared checker, run
// against every `{date, precision}` pair the schema defines anywhere
// (shows.json, rps.json, reigns.json's own `won`/`lost`, titles.json's own
// `events[].date`) — hard fail, not soft, per the Janitor's own directive:
// a five-digit year or a malformed string should fail loudly, not print a
// warning someone can miss. Declared here, ahead of every check that calls
// it (the titles.json events check runs long before the shows/rps/reigns
// checks further down the file), so call order never matters.
//
// YEAR_MIN/YEAR_MAX are a deliberately narrow, named window (this is an
// e-fed-era museum, not a general calendar) — 2027 is next calendar year, a
// one-year buffer against a near-future date that's honestly dated rather
// than a typo. A real accession outside this window is a reason to widen
// the constant deliberately, not a reason to weaken the check — exactly
// what happened here: widened from 1990 to 1988 (THE 1990s INVESTIGATION,
// 2026-08-23) once CSWA's own out-of-fiction founding memoir ("The Real
// Story," the workshop's fw_1988_realstory.html) receipted a
// genuine March 1988 origin as a two-person dice-and-paper tabletop game,
// three years before it found PRODIGY — a real accession, not a typo.
const DATE_YEAR_MIN = 1983; // widened 1988→1983 at the print-era opening (the Janitor, 2026-08-24): the frontier now admits the play-by-mail/tabletop hobby, whose own press (Paper Mayhem) begins 1983 — the registry's floor follows the record, not the web.
const DATE_YEAR_MAX = 2027;

// exact: YYYY-MM-DD, every component a real calendar date (rejects
// 2003-02-30, 2003-13-01, etc. — not just shape, actual validity, via
// Date's own UTC round-trip, which normalizes an invalid day/month
// forward rather than throwing, so the round-trip check catches it where
// a bare regex wouldn't).
function isValidExactDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [, y, mo, d] = m.map(Number);
  if (y < DATE_YEAR_MIN || y > DATE_YEAR_MAX) return false;
  if (mo < 1 || mo > 12) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
// month: YYYY-MM, a real month, year in bounds.
function isValidMonthDate(s) {
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [, y, mo] = m.map(Number);
  return y >= DATE_YEAR_MIN && y <= DATE_YEAR_MAX && mo >= 1 && mo <= 12;
}
// year: exactly four digits, in bounds — this is precisely the shape a
// mis-set "20005" would take if it were ever stored bare rather than as
// part of a "2000s" circa label.
function isValidYearDate(s) {
  const m = /^(\d{4})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  return y >= DATE_YEAR_MIN && y <= DATE_YEAR_MAX;
}
// circa/unknown: genuinely free text ("c. May 2014", "circa Oct 2003",
// "2000s", "today", "unknown", "12/2", "2002-06-01" (an ISO-shaped date
// someone simply graded softer than "exact") are all real, honest values
// already on file — see docs/PROCESS.md's "no live Wayback access" section
// on `circa`/`unknown` existing exactly to carry this kind of imprecision.
// Never forced into a strict shape; a day/month component (01-31), a bare
// list number, a partial "12/2" is ordinary and expected here, not
// checked at all. The ONLY thing flagged: a run of 5-OR-MORE digits — a
// run no legitimate day, month, or year in this schema is ever shaped
// like, and precisely what a mistyped "20005" (meant to read the circa
// label "2000s") would produce. This is deliberately narrower than
// bounds-checking every 4-digit run: two real incidents, both caught live
// running an earlier, stricter draft of this exact check, argued the
// point down to this shape —
//   1. Five UWF roleplays (promo-467 and siblings, a Cold War-set spy
//      storyline) carry `date: "1979"`, `precision: "unknown"`, with their
//      own `source` field reading "as written on the page; not resolvable
//      to a calendar date" — an honestly out-of-era IN-FICTION date,
//      already caveated as exactly that, not a data error. Bounds-checking
//      a real 4-digit run would have relitigated that honesty every run.
//   2. Dozens of `circa`/`unknown` shows/reigns/rps carry an already
//      ISO-shaped date ("2002-06-01", "1998-12") graded softer than
//      "exact"/"month" on purpose — splitting on `\d+` breaks that into
//      "2002"/"06"/"01", and flagging the "06"/"01" runs as not-4-digits
//      would hard-fail perfectly good, already-valid dates for no reason
//      connected to the Janitor's own "20005" catch at all.
function checkFreeTextYears(s) {
  return (s.match(/\d{5,}/g) ?? []);
}

// `label` is a short human-readable pointer to the row/field for the error
// message (e.g. `show "uwf-quake-1999"` or `reigns[12] ("UWF World
// Heavyweight Championship").won`). Hard fail (via `warn`, this file's own
// error-pushing function) on anything genuinely impossible; a `circa`/
// `unknown` value with no bad digit run is left exactly as free as the
// schema always intended.
function checkImpossibleDate(label, d) {
  if (!d || typeof d !== "object" || typeof d.date !== "string" || !d.precision) return;
  const { date, precision } = d;
  if (precision === "exact") {
    if (!isValidExactDate(date)) warn(`${label}: "exact" date "${date}" isn't a real calendar date within ${DATE_YEAR_MIN}–${DATE_YEAR_MAX} (YYYY-MM-DD)`);
  } else if (precision === "month") {
    if (!isValidMonthDate(date)) warn(`${label}: "month" date "${date}" isn't a valid YYYY-MM within ${DATE_YEAR_MIN}–${DATE_YEAR_MAX}`);
  } else if (precision === "year") {
    if (!isValidYearDate(date)) warn(`${label}: "year" date "${date}" isn't a plausible four-digit year within ${DATE_YEAR_MIN}–${DATE_YEAR_MAX} (an impossible date like a mistyped five-digit year fails here)`);
  } else if (precision === "circa" || precision === "unknown") {
    const bad = checkFreeTextYears(date);
    if (bad.length) warn(`${label}: "${precision}" date "${date}" contains a 5-or-more-digit run (${bad.join(", ")}) — no legitimate day, month, or year is ever shaped like that; this is what a mistyped "20005" (meant to read the circa label "2000s") looks like`);
  }
}

// ---------------------------------------------------------------------------
// PROMOTION FOUNDED/CLOSED (THE FOUNDING-EDGES WAVE, 2026-08-21, the Janitor's
// own directive, verbatim: "every promotion needs founded and closed date
// edges — which would make it so you could sort promotions by which were
// founded the earliest or latest, filter down to specific years for
// either, filter to tenure... and prioritize the frontier based on
// founding year age"). Same `{date, precision, source}` shape as
// shows.json/rps.json/reigns.json's own won/lost — one deliberate
// difference: `source` is REQUIRED here, not optional, per the Janitor's
// own words: "no date invented from vibes... every value carries a source
// naming its receipt." Every held promotion has, by the dead-only rule,
// actually ended — so `closed` is never absent, only ever honestly
// imprecise (`precision: "unknown"`, `date: "unknown"` for the genuinely
// unrecoverable case — see docs/SCHEMA.md).
function checkFoundingDate(label, d) {
  if (!d || typeof d !== "object") { warn(`${label}: missing — every promotion needs both a "founded" and a "closed" date edge (CURATION.md's founding-edges gavel)`); return; }
  if (typeof d.date !== "string" || !d.date) warn(`${label}: "date" must be a non-empty string — use the literal "unknown" for a genuinely unrecoverable date, paired with precision "unknown"`);
  if (!PRECISIONS.has(d.precision)) warn(`${label}: precision "${d.precision}" is not one of exact|month|year|circa|unknown`);
  if (typeof d.source !== "string" || !d.source.trim()) warn(`${label}: missing "source" — every founded/closed value must name its own receipt (the fed's own document, a wing epitaph/placard, a mining digest)`);
  checkImpossibleDate(label, d);
}

// A deliberately coarse, best-effort COMPARABLE for a founded/closed pair
// on the SAME promotion — month/year precision rounds to the first of the
// period (never used to assert a real day, only to order two dates
// against each other); `circa`/`unknown` free text is read for a leading
// YYYY only. Returns null when no year is recoverable at all, the same
// honest-skip posture the impossible-date guard itself takes on free
// text — a promotion with a genuinely unknown founded or closed date
// simply isn't ordering-checked, never defaulted to a guess.
function foundingComparable(d) {
  if (!d || typeof d.date !== "string") return null;
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(d.date);
  if (!m) return null;
  return `${m[1]}-${m[2] || "01"}-${m[3] || "01"}`;
}
function closedComparable(d) {
  if (!d || typeof d.date !== "string") return null;
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(d.date);
  if (!m) return null;
  return `${m[1]}-${m[2] || "12"}-${m[3] || "31"}`;
}
function foundingYear(d) {
  if (!d || typeof d.date !== "string") return null;
  const m = /^(\d{4})/.exec(d.date);
  return m ? Number(m[1]) : null;
}

function loadRaw(name) {
  const p = resolve(DATA, `${name}.json`);
  if (!existsSync(p)) { warn(`data/${name}.json is missing`); return null; }
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    warn(`data/${name}.json does not parse: ${e.message}`);
    return null;
  }
}
// Unwrap `{ _schema_version, <key>: [...] }` (or a bare legacy array, for
// belt-and-braces tolerance) into the plain array every check below wants.
// Also verifies _schema_version is present — the whole point of this wave.
function loadArray(name, required = true) {
  const raw = loadRaw(name);
  if (raw === null) return required ? [] : null;
  if (Array.isArray(raw)) {
    warn(`data/${name}.json is a bare array — expected { _schema_version, ... } (schema-hardening wave)`);
    return raw;
  }
  if (typeof raw !== "object") { warn(`data/${name}.json: expected an object, got ${typeof raw}`); return []; }
  if (raw._schema_version === undefined) warn(`data/${name}.json: missing "_schema_version"`);
  const arrayKeys = Object.keys(raw).filter((k) => k[0] !== "_" && Array.isArray(raw[k]));
  if (arrayKeys.length !== 1) {
    warn(`data/${name}.json: expected exactly one array-valued top-level key besides "_schema_version*" fields, found ${arrayKeys.length} (${arrayKeys.join(", ") || "none"})`);
    return [];
  }
  return raw[arrayKeys[0]];
}

const promotions = loadArray("promotions");
const characters = loadArray("characters");
const units = loadArray("units");
const titles = loadArray("titles");
const shows = loadArray("shows");
const aliases = loadArray("aliases");
const reviewQueue = loadArray("review-queue");
const wanted = existsSync(resolve(DATA, "wanted.json")) ? loadArray("wanted", false) ?? [] : [];
const memorials = existsSync(resolve(DATA, "memorials.json")) ? loadArray("memorials", false) ?? [] : [];
const attestorHandles = new Set((existsSync(resolve(DATA, "attestors.json")) ? loadArray("attestors", false) ?? [] : []).map((a) => a.handle));
const essays = existsSync(resolve(DATA, "essays.json")) ? loadArray("essays", false) ?? [] : [];
const affiliations = existsSync(resolve(DATA, "affiliations.json")) ? loadArray("affiliations", false) ?? [] : [];
const inductions = existsSync(resolve(DATA, "inductions.json")) ? loadArray("inductions", false) ?? [] : [];
const rps = existsSync(resolve(DATA, "rps.json")) ? loadArray("rps", false) ?? [] : [];
const externalFigures = existsSync(resolve(DATA, "external-figures.json")) ? loadArray("external-figures", false) ?? [] : [];
const collections = existsSync(resolve(DATA, "collections.json")) ? loadArray("collections", false) ?? [] : [];
const reigns = existsSync(resolve(DATA, "reigns.json")) ? loadArray("reigns", false) ?? [] : [];
const awards = existsSync(resolve(DATA, "awards.json")) ? loadArray("awards", false) ?? [] : [];
const relationships = existsSync(resolve(DATA, "relationships.json")) ? loadArray("relationships", false) ?? [] : [];
const rpCatalog = existsSync(resolve(DATA, "rp-catalog.json")) ? loadArray("rp-catalog", false) ?? [] : [];
// frontier.json keeps its own header shape (_dead_only_rule, _status_values,
// rows) — load it raw rather than through loadArray, but still check
// _schema_version on it below alongside every other file.
const frontier = existsSync(resolve(DATA, "frontier.json")) ? loadRaw("frontier") : null;

// ---------------------------------------------------------------------------
// 0. _schema_version present on every data/*.json file that exists.
//    (loadArray() already warns for the array-shaped files above; this
//    covers frontier.json's own object shape, which loadArray() doesn't
//    touch.)
// ---------------------------------------------------------------------------
if (frontier !== null && frontier._schema_version === undefined) {
  warn(`data/frontier.json: missing "_schema_version"`);
}

// ---------------------------------------------------------------------------
// 1. Slugs are unique across the WHOLE registry — every entity type shares
//    one identifier namespace ("slug IDs, unique forever"). External figures
//    (data/external-figures.json) share the same namespace even though
//    they're not part of any collection.
// ---------------------------------------------------------------------------
const allEntities = [
  ...promotions.map((e) => ({ ...e, _kind: "promotion" })),
  ...characters.map((e) => ({ ...e, _kind: "character" })),
  ...units.map((e) => ({ ...e, _kind: "unit" })),
  ...titles.map((e) => ({ ...e, _kind: "title" })),
  ...shows.map((e) => ({ ...e, _kind: "show" })),
  ...memorials.map((e) => ({ ...e, _kind: "memorial" })),
  ...essays.map((e) => ({ ...e, _kind: "essay" })),
  ...externalFigures.map((e) => ({ ...e, _kind: "external-figure" })),
  ...rps.map((e) => ({ ...e, _kind: "rp" })),
];
const idIndex = new Map();
for (const e of allEntities) {
  if (!e.id) { warn(`${e._kind} entity with no id: ${JSON.stringify(e).slice(0, 80)}`); continue; }
  if (idIndex.has(e.id)) {
    warn(`duplicate slug "${e.id}" — used by both a ${idIndex.get(e.id)} and a ${e._kind} entity`);
  } else {
    idIndex.set(e.id, e._kind);
  }
}

// ---------------------------------------------------------------------------
// 1b. THE PROVENANCE WAVE (accession-lots correction, user gavel: "0001 is
// just the reference to my hard drive... Wayback supplementation is
// distinct from it") — `collection` now means "which acquisition LOT this
// piece of MATERIAL arrived in" (data/collections.json), not "which
// registry entity does this belong to": 0001 is the promoter's private
// donation (drives + personally-provided documents), 0002+ are individually
// bounded public-recovery campaigns, one per acquisition event, numbered in
// true chronological order. Only served MATERIAL carries it now — shows.json
// and rps.json rows, whose own source path names the campaign that
// recovered them. Characters and units DROP the field entirely: an entity
// is museum-synthesized from whatever materials mention it, so it doesn't
// have a single collection of its own — its provenance is its receipts.
// ---------------------------------------------------------------------------
if (existsSync(resolve(DATA, "collections.json")) && collections.length === 0) {
  warn(`data/collections.json exists but has no entries — every "collection" field value needs a matching accession row`);
}
const collectionIds = new Set(collections.map((c) => c.id));
// ACCESSION PAGES ("accession ids become clickable"): every collections.json
// row must have a generated /collections/<id>.html page for the rendered
// "accession 0001" links (provenance panels) to actually resolve.
for (const c of collections) {
  if (!existsSync(resolve(ROOT, "collections", `${c.id}.html`))) {
    warn(`data/collections.json row "${c.id}": no /collections/${c.id}.html page exists — run \`npm run refresh:links\` to generate it`);
  }
}
for (const c of [...characters, ...units]) {
  if (c.collection !== undefined) warn(`${c.type ?? "entity"} "${c.id}": carries a "collection" field — characters/units no longer carry accession attribution directly (see data/collections.json's own note); that belongs on the material (shows/rps) that receipts them`);
}
for (const e of [...shows, ...rps]) {
  const vals = Array.isArray(e.collection) ? e.collection : [e.collection];
  for (const v of vals) {
    if (v !== undefined && !collectionIds.has(v)) {
      warn(`${e.type ?? "material"} "${e.id}": collection "${v}" does not resolve to a data/collections.json id`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Promotions referenced by tenures / titles / shows must exist.
// ---------------------------------------------------------------------------
const promoIds = new Set(promotions.map((p) => p.id));
// Evidence grades shared by identity assertions, promotion provenance_notes,
// and character/unit `portrays` links: primary-source (contemporary record),
// user-attested (a contributor's own memory/ruling), presumed (a curator's
// best reading).
const GRADES = new Set(["primary-source", "user-attested", "presumed"]);
for (const c of [...characters, ...units]) {
  for (const t of c.tenures ?? []) {
    if (!promoIds.has(t.promotion)) warn(`${c.id}: tenure references unknown promotion "${t.promotion}"`);
  }
}
// THE CAPTIONS WAVE: every character and unit gets exactly one hand-drafted
// museum-label sentence, distinct from `notes` (a curator's working note,
// not display prose). Hard requirement now that the batch is complete —
// a newly minted entity without one is caught here, not discovered later
// on a blank wrestler-page lede.
for (const c of [...characters, ...units]) {
  if (typeof c.caption !== "string" || !c.caption.trim()) {
    warn(`${c.type ?? "entity"} "${c.id}": missing "caption" — every character/unit needs one hand-drafted museum-label sentence`);
  } else if (c.caption.split(/(?<=[.!?])\s+/).filter(Boolean).length > 1 && !/["“].*[.!?]["”]/.test(c.caption)) {
    soft(`${c.type ?? "entity"} "${c.id}": caption reads as more than one sentence — captions should be ONE sentence (quoted dialogue containing its own punctuation is fine)`);
  }
  // THE BOOZLER-REGISTER RULE (user gavel: "I'm not sure any characters need
  // their entire existence boiled down to 'we can't even speak of this'") —
  // the Boozler rule governs performance, never biography. A caption citing
  // Curation or the rule BY NAME is the exact failure mode: the page-level
  // flag box is the rule's home, not the caption.
  if (typeof c.caption === "string" && /see curation|bum boozler rule|boozler rule/i.test(c.caption)) {
    warn(`${c.type ?? "entity"} "${c.id}": caption cites Curation/the Boozler rule by name — a caption is captioned from the record like anyone else; the rule's home is the page-level flag box, not the caption`);
  }
  // THE NONHUMAN DATATYPE WAVE, 2026-08-18: "species" is meaningless without
  // "nonhuman: true" alongside it — the reverse (nonhuman with no species)
  // is fine and honest (staged as not-a-person, but the era's own record
  // never named what kind of not-a-person).
  if ("species" in c && c.nonhuman !== true) {
    warn(`${c.type ?? "entity"} "${c.id}": carries "species" without "nonhuman: true" — species only means something alongside the flag`);
  }
  if ("nonhuman" in c && typeof c.nonhuman !== "boolean") {
    warn(`${c.type ?? "entity"} "${c.id}": "nonhuman" must be true or false (or omitted)`);
  }
  // THE STAGED-GENDER WAVE: staged_gender_grade only means something
  // alongside a real staged_gender value — the exact species/nonhuman
  // mutual-requirement shape, one field pair over. "unknown" needs no
  // grade (it isn't a graded claim, it's the honest absence of one).
  const STAGED_GENDER_VALUES = new Set(["male", "female", "unknown"]);
  const STAGED_GENDER_GRADES = new Set(["bio-explicit", "pronoun-observed"]);
  if ("staged_gender" in c && !STAGED_GENDER_VALUES.has(c.staged_gender)) {
    soft(`${c.type ?? "entity"} "${c.id}": "staged_gender" value "${c.staged_gender}" is not one of male|female|unknown — the vocabulary is expected to grow (a staged nonbinary/ambiguous character, say); flagged, not failed`);
  }
  if ("staged_gender_grade" in c && (!("staged_gender" in c) || c.staged_gender === "unknown")) {
    warn(`${c.type ?? "entity"} "${c.id}": carries "staged_gender_grade" without a real "staged_gender" value — the grade only means something alongside male/female/etc, not "unknown"`);
  }
  if ("staged_gender_grade" in c && !STAGED_GENDER_GRADES.has(c.staged_gender_grade)) {
    warn(`${c.type ?? "entity"} "${c.id}": "staged_gender_grade" must be "bio-explicit" or "pronoun-observed"`);
  }
  // THE COMMUNAL/PASSED HANDLING WAVE: controlled-but-soft vocabulary, and
  // a HARD contradiction guard — "handling: communal" (owned by no one
  // hand) is structurally incompatible with carrying a same-handler edge
  // (a claim about exactly one shared hand); the two facts can't both be
  // true about the same entity, so this is a real fail, not a style note.
  if ("handling" in c) {
    if (!["communal", "passed"].includes(c.handling)) {
      soft(`${c.type ?? "entity"} "${c.id}": "handling" value "${c.handling}" is not one of communal|passed — the vocabulary is expected to grow; flagged, not failed`);
    }
    if (c.handling === "communal" && relationships.some((r) => r.nature === "same-handler" && (r.a === c.id || r.b === c.id))) {
      warn(`${c.type ?? "entity"} "${c.id}": "handling: communal" (owned by no one hand) contradicts a same-handler edge naming this entity — the two claims can't both stand`);
    }
  }
}

// THE CAPTION-STALENESS WAVE, 2026-08-18 (user gavel, verbatim: "as evidence
// accumulates it should be updatable; I wouldn't want the Phenomenons frozen
// as of what we had in the GIWF without the NAPW, WWA, etc. eras
// acknowledged"). A caption is living prose, not a write-once snapshot —
// this is a SOFT, advisory check (never fails the build; a caption reading
// behind the record is a prompt for a curator to look, not a defect to
// block a push over) that flags when an entity's own evidence has moved on
// from whatever it was last actually checked against. `caption_asof`
// (stamped whenever a caption is written or deliberately re-reviewed)
// records the counts it was checked against; this recomputes the SAME six
// counts live and flags a material divergence: any count differing by 2+,
// OR the tenures count going up AT ALL (a new fed-era tenure is treated as
// an automatic flag on its own, even a difference of exactly one — that's
// precisely the Phenomenons/GIWF-only-caption failure mode the gavel named).
// No queue file is auto-written here (this script is a read-only checker,
// same discipline as everywhere else in it); a curator who sees the warning
// adds a `data/review-queue.json` `caption-stale` entry by hand if they want
// it tracked past the current session, same as any other flagged pair.
{
  const reignHolderCount = new Map();
  for (const r of reigns) for (const h of r.holder ?? []) if (h.id) reignHolderCount.set(h.id, (reignHolderCount.get(h.id) ?? 0) + 1);
  const appearanceCount = new Map();
  for (const s of shows) for (const a of s.appearances ?? []) if (a.who) appearanceCount.set(a.who, (appearanceCount.get(a.who) ?? 0) + 1);
  const rpCount = new Map();
  for (const r of rps) for (const cid of [...(r.involves ?? []), ...(r.references ?? [])]) rpCount.set(cid, (rpCount.get(cid) ?? 0) + 1);
  // THE AWARD ENTITIES WAVE: awards.json nests bestowals[] under each
  // award entity now — walk into them for the per-entity evidence count.
  const awardCount = new Map();
  for (const a of awards) for (const b of a.bestowals ?? []) for (const h of [...(b.recipient ?? []), ...(b.runner_up ?? [])]) if (h?.id) awardCount.set(h.id, (awardCount.get(h.id) ?? 0) + 1);
  const relCount = new Map();
  for (const r of relationships) {
    if (r.a) relCount.set(r.a, (relCount.get(r.a) ?? 0) + 1);
    if (r.b) relCount.set(r.b, (relCount.get(r.b) ?? 0) + 1);
  }
  for (const c of [...characters, ...units]) {
    const asof = c.caption_asof;
    if (!asof || typeof asof !== "object" || !asof.evidence) continue;
    const live = {
      tenures: (c.tenures ?? []).length,
      reigns: reignHolderCount.get(c.id) ?? 0,
      appearances: appearanceCount.get(c.id) ?? 0,
      rps: rpCount.get(c.id) ?? 0,
      awards: awardCount.get(c.id) ?? 0,
      relationships: relCount.get(c.id) ?? 0,
    };
    const stale = asof.evidence.tenures !== undefined && live.tenures > asof.evidence.tenures;
    const materialFields = Object.keys(live).filter((k) => Math.abs((live[k] ?? 0) - (asof.evidence[k] ?? 0)) >= 2);
    if (stale || materialFields.length) {
      const reason = stale ? "a new tenure (fed-era) since last checked" : `${materialFields.join(", ")} moved by 2+`;
      soft(`${c.type ?? "entity"} "${c.id}": caption may be stale — ${reason} (last checked ${asof.written ?? "?"}: ${JSON.stringify(asof.evidence)}, now: ${JSON.stringify(live)}) — see docs/PROCESS.md's caption-refresh step`);
    }
  }
}
for (const t of titles) if (!promoIds.has(t.promotion)) warn(`title "${t.id}": unknown promotion "${t.promotion}"`);
for (const s of shows) if (!promoIds.has(s.promotion)) warn(`show "${s.id}": unknown promotion "${s.promotion}"`);
// JOINT-WING SHOWS (the Janitor, 2026-09-24, on the Chris Williams Memorial
// Cup's 2001 GIWF and 2007 PTC stagings: "those should be joint-wing shows
// IMO"; CURATION.md v121, #joint-wing-shows). ONE row, still shard-assigned to
// its canonical `promotion` (shard-lib.mjs's shardOf is untouched), which may
// now NAME the other wings that jointly staged the night instead of making a
// reader find them through an affiliation edge. Four hard checks, exactly the
// four the gavel names — the field is a graph edge like any other, so a
// dangling id is a typo and never a soft note:
//   (1) every id resolves to a HELD promotions.json row (an unheld co-host is
//       a fact for the row's own `note` until its wing exists — PRIME/GCW,
//       4 Nov 2007, is the worked case);
//   (2) no entry equals the row's own `promotion` — a wing does not co-host
//       with itself;
//   (3) no entry repeats;
//   (4) the field is absent on a `collected: false` row (checked with the rest
//       of the collected edge's forbidden-field list, §6e below) — there is no
//       document for a second wing to point at.
for (const s of shows) {
  if (!("also_promotions" in s)) continue;
  if (!Array.isArray(s.also_promotions) || s.also_promotions.length === 0) {
    warn(`show "${s.id}": "also_promotions", if present, must be a non-empty array of held promotion ids (JOINT-WING SHOWS, CURATION.md v121(b)) — a show staged by one wing simply omits it`);
    continue;
  }
  const seen = new Set();
  for (const [i, pid] of s.also_promotions.entries()) {
    if (typeof pid !== "string" || !pid) {
      warn(`show "${s.id}".also_promotions[${i}]: must be a promotion id string (JOINT-WING SHOWS, CURATION.md v121(b))`);
      continue;
    }
    if (!promoIds.has(pid)) warn(`show "${s.id}".also_promotions[${i}]: "${pid}" does not resolve to a held promotion — this field names HELD wings only; an unheld co-host is a fact for the row's own note until its wing lands (CURATION.md v121(b))`);
    if (pid === s.promotion) warn(`show "${s.id}".also_promotions[${i}]: "${pid}" is the row's own canonical promotion — a wing does not co-host with itself (CURATION.md v121(b))`);
    if (seen.has(pid)) warn(`show "${s.id}".also_promotions[${i}]: "${pid}" is listed twice`);
    seen.add(pid);
  }
}
const titleIds = new Set(titles.map((t) => t.id));
const showIds = new Set(shows.map((s) => s.id));

// ---------------------------------------------------------------------------
// 2b. THE PER-TITLE PAGES WAVE (2026-08-18): every titles.json row gets a
// generated /titles/<id>.html page (scripts/cross-reference.mjs), exactly
// the same "generate, don't hand-edit" discipline wrestlers/ already has —
// and the same living-epitaph doctrine (CURATION.md's promotion-epitaphs rule) extended down to
// one belt at a time via a required `epitaph` field, `epitaph_asof` for
// staleness the same shape as a character/unit's own `caption_asof`.
// ---------------------------------------------------------------------------
for (const t of titles) {
  if (!existsSync(resolve(ROOT, "titles", `${t.id}.html`))) {
    warn(`data/titles.json row "${t.id}": no /titles/${t.id}.html page exists — run \`npm run refresh:links\` to generate it`);
  }
  if (typeof t.epitaph !== "string" || !t.epitaph.trim()) {
    warn(`title "${t.id}": missing "epitaph" — every title needs one, per the per-title-pages wave (CURATION.md's promotion-epitaphs living-epitaph doctrine, scoped to one belt)`);
  }
  if (t.restarted_from && !titleIds.has(t.restarted_from)) {
    warn(`title "${t.id}": restarted_from "${t.restarted_from}" does not resolve to a data/titles.json id`);
  }
}
// THE TITLE-STATUS REFRAME (2026-08-18, the Janitor's gavel): the old
// controlled-but-soft `status` field ("every title is retired by default
// if the bar for entry is a dead promotion") is retired outright, not
// just deprecated — a `status` key reappearing on any titles.json row is
// a regression, hard-failed rather than soft-warned so it can't drift
// back in unnoticed. `nature` (self-awarded, never a lifecycle state) and
// `events[]` (dated, sourced, fed-acted lifecycle events — retired_by_fed/
// unified_into/rename) are what actually replaced it; see docs/SCHEMA.md.
const TITLE_NATURE_VALUES = new Set(["self-awarded"]);
const TITLE_EVENT_TYPES = new Set(["retired_by_fed", "unified_into", "rename"]);
for (const t of titles) {
  if (t.status !== undefined) {
    warn(`title "${t.id}": carries a "status" field — retired by THE TITLE-STATUS REFRAME (CURATION.md changelog); use "nature" and/or "events[]" instead (see docs/SCHEMA.md)`);
  }
  if (t.nature !== undefined && !TITLE_NATURE_VALUES.has(t.nature)) {
    soft(`title "${t.id}": nature "${t.nature}" is not one of the recognized values (${[...TITLE_NATURE_VALUES].join("|")}) — controlled-but-soft, the vocabulary is expected to grow`);
  }
  if (t.events !== undefined) {
    if (!Array.isArray(t.events)) {
      warn(`title "${t.id}": "events" must be an array`);
    } else {
      t.events.forEach((e, i) => {
        if (!e || typeof e !== "object") { warn(`title "${t.id}" events[${i}]: not an object`); return; }
        if (!TITLE_EVENT_TYPES.has(e.type)) {
          soft(`title "${t.id}" events[${i}]: type "${e.type}" is not one of the recognized values (${[...TITLE_EVENT_TYPES].join("|")}) — controlled-but-soft, the vocabulary is expected to grow`);
        }
        if (!e.note || typeof e.note !== "string" || !e.note.trim()) {
          warn(`title "${t.id}" events[${i}]: missing "note" — every lifecycle event needs a sourced, dated note, per THE TITLE-STATUS REFRAME`);
        }
        if (!e.date || typeof e.date !== "object" || !e.date.precision) {
          warn(`title "${t.id}" events[${i}]: missing "date" ({date, precision}) — an unknown exact date still needs an honest precision value`);
        } else {
          checkImpossibleDate(`title "${t.id}" events[${i}].date`, e.date);
        }
        if (e.title !== undefined && !titleIds.has(e.title)) {
          warn(`title "${t.id}" events[${i}]: "title" ("${e.title}") does not resolve to a data/titles.json id`);
        }
      });
    }
  }
}
// epitaph_asof staleness — same non-blocking spirit as caption_asof above,
// scoped to the one axis a title actually has: its own reign count.
{
  const reignCountByTitle = new Map();
  for (const r of reigns) reignCountByTitle.set(r.title, (reignCountByTitle.get(r.title) ?? 0) + 1);
  for (const t of titles) {
    const asof = t.epitaph_asof;
    if (!asof || typeof asof !== "object" || !asof.evidence) continue;
    const liveReigns = reignCountByTitle.get(t.id) ?? 0;
    const checkedReigns = asof.evidence.reigns ?? 0;
    if (liveReigns !== checkedReigns) {
      soft(`title "${t.id}": epitaph may be stale — reign count moved from ${checkedReigns} to ${liveReigns} since last checked (${asof.written ?? "?"})`);
    }
  }
}

// Every promotion carries the required schema fields. Between-promotion
// relations (predecessor/successor/sister) and connections to OTHER promotions
// (alliance, academy, rivalry...) live in data/affiliations.json as edges,
// never on the promotion record itself: the `lineage`, `family` and
// `family_note` promotion fields are retired (CURATION.md v47).
const DEPTH_VALUES = new Set([
  "deeply documented", "documented", "partially recovered",
  "a single surviving document", "in preparation", "documented on its own terms",
]);
// THE DEPTH-TIER LADDER, structured (THE WING COLLAPSE WAVE, 2026-08-22) —
// docs/PROCESS.md's own depth-tier doctrine (0 attested / 1 collected /
// 2 structured / 3 full-crawl) gets its structured edge here: `tier` is the
// controlled integer, `tier_source` is the receipt (what in the registry or
// digest state actually justifies this grade — a show-structured/total-shows
// fraction, a "single beacon row" note, a mining-campaign digest cite). The
// existing free-text `depth` field stays the human phrase; `tier` is what a
// filter/sort can act on. Both required going forward, same "every
// promotion gets one" posture `founded`/`closed` already set.
const TIER_VALUES = new Set([0, 1, 2, 3]);
// MEDIUM TAXONOMY (THE FLATTENING WAVE addendum, user gavel: "not everything
// needs to be the shape my fed was in") — how a promotion was actually
// played, distinct from its depth of documentation. Controlled but meant to
// grow: this is a starting set, not a closed one (Usenet-era RSPW-style feds
// etc. are known gaps) — soft-warn on an unrecognized value rather than
// hard-fail, same posture as depth.
// THE TYPE-AXIS GAVEL (the Janitor, 2026-09-05: "both medium and type"):
// what an entity IS is a separate axis from the platform it ran on. Every
// promotions.json row carries `type` — federation (the default kind: it
// books its own roster and cards) | community-hub (a newsgroup, portal,
// directory or hosting hub held as a wing: RSPWF, RSPW, Scoops, Titan Zone)
// | interfed-alliance (a structure over separately-run member feds, no
// roster of its own). `medium` keeps naming ONLY the platform, so RSPWF is
// {type: community-hub, medium: usenet} and PTC is {type: interfed-alliance,
// medium: website-efed}. The three medium values that used to carry a kind —
// community-hub, interfed-alliance, house-network — are RETIRED and now
// soft-warn through the unknown-medium path below.
// PROCESS_TEXT_RE / NAME_PROCESS_TEXT_RE now imported from ./text-markers.mjs
// (THE SHARED MARKER MODULE, PROSE-FIX-01, 2026-09-13; proposal.md #0) — see
// the import at the top of this file.
// THE INDEPENDENT TOURNAMENT (the Janitor, 2026-09-24, on the Chris Williams
// Memorial Cup: "Yes on Chris Williams memorial cup wing"; CURATION.md v118,
// #tournament-type) — a fourth kind: an independent (interfederation)
// tournament, which stages a tournament across federations it does not own and
// carries no roster of its own. interfed-alliance's near neighbour and
// deliberately not that value: an alliance is a standing structure with member
// feds plugged into it, a tournament is one recurring event a community puts
// on. type_note carries the longer phrase ("independent interfederation
// tournament"), per v111(f) — a note, never a second stored type.
// THE TRAINING ACADEMY (the Janitor, 2026-09-24, on the Primetime Wrestling
// Academy's own accession plan: "New academy type."; CURATION.md v120,
// #academy-type) — a fifth kind: a school whose subject is the hobby's own
// craft. It teaches and GRADES the writing against a published rubric, sits
// its students in classes, runs a card for them to be graded on, and sends its
// graduates to federations it does not own — in the founding case's own words,
// "an ewrestling school and not an efed". Two near neighbours deliberately not
// taken: a community-hub stages nothing of its own, and a federation books a
// card because the card is the point where an academy books one so there is
// something to grade. UNLIKE `tournament`, an academy carries titles and
// reigns like any federation (v120(c)) — it runs a standing roster week to
// week — so the tournament soft-warn below is NOT extended to it.
const TYPE_VALUES = new Set(["federation", "community-hub", "interfed-alliance", "tournament", "academy"]);
const RETIRED_KIND_MEDIA = new Set(["community-hub", "interfed-alliance", "house-network"]);
// THE ECOSYSTEM EXPANSION GAVEL (the Janitor, 2026-09-05: "Aligned with
// everything for the expansion. Gaveled!"; CURATION.md v111(c)) — the two
// fields the pile's own best finding, parallel invention in four countries,
// could not be recorded without. `language` is BCP-47 and ABSENT MEANS "en"
// (the frontier `medium` / promotions `discipline` default-by-absence
// precedent: all 804 rows held at the gavel entered through an
// English-language corpus, so writing the field onto every one of them would
// add 804 facts nobody checked to state one fact true of the set). `country`
// is ISO 3166-1 alpha-2 with NO default at all (the roster_policy posture:
// absent means undetermined, never guessed, and there is deliberately no
// "unknown" value — the Anglophone scene is not one country). `country` is
// the REAL-WORLD country of the community that ran the fed; the fed's own
// staged home base stays in `location`, and the two may legitimately disagree.
const BCP47_RE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-(?:[A-Z]{2}|[0-9]{3}))?$/;
const LANGUAGE_VALUES = new Set([
  "en", "de", "it", "pl", "ko", "fr", "es", "pt", "pt-BR", "ja", "nl", "sv",
  "da", "nb", "fi", "ru", "ar", "tr", "cs", "hu", "el", "he", "hi", "id",
  "th", "vi", "zh-Hans", "zh-Hant",
]); // controlled-but-soft, expected to grow with the scenes (the medium posture)
const ISO3166_RE = /^[A-Z]{2}$/;
const ISO3166_RESERVED = /^(AA|Q[M-Z]|X[A-Z]|ZZ)$/; // user-assigned/reserved ranges
const COUNTRY_VALUES = new Set([
  "US", "CA", "GB", "IE", "AU", "NZ", "ZA", "DE", "AT", "CH", "IT", "PL",
  "FR", "BE", "ES", "MX", "AR", "PT", "BR", "NL", "SE", "NO", "DK", "FI",
  "RU", "KR", "JP", "CN", "TW", "TR", "IN", "PH", "ID", "IL", "GR", "CZ", "HU",
]); // controlled-but-soft, expected to grow with the scenes
// The set the "en" default is honest about. A row placed outside it with no
// language of its own is the one way the default can quietly make a claim.
const ANGLOPHONE_DEFAULT = new Set(["US", "CA", "GB", "IE", "AU", "NZ", "ZA"]);
const LANGUAGES_ENTRY_KEYS = new Set(["language", "era", "note"]);
const COUNTRIES_ENTRY_KEYS = new Set(["country", "era", "note"]);
const MEDIUM_VALUES = new Set(["newsgroup", "website", "forum", "bbs", "fidonet", "email", "mail", "online-service", "chat", "wiki", "virtual-world", "video", "audio", "social-media", "game", "in-person", "other", "unknown"]); // the Janitor's gavel 2026-09-10: PLATFORM ONLY (the compound -efed / figure-fed / tabletop values were decomposed into medium + form; interfed-alliance and community-hub live on `type`)
const FORM_VALUES = new Set(["text", "figures", "avatars", "tabletop", "sim", "other", "unknown"]); // the Janitor's gavel 2026-09-10: what the canon physically is
// DISCIPLINE (the Janitor's ruling, 2026-08-23: "Agreed with the
// sport/discipline marker") — WHAT SPORT the promotion staged, orthogonal to
// `medium` (how it was played) and `style_family` (what its booking reads
// as). "pro-wrestling" is the DEFAULT and may be omitted entirely: an absent
// field means pro-wrestling, and almost every row correctly carries none.
// Controlled but soft, same posture as medium — a genuinely new sport is a
// deliberate addition, not a typo. See docs/SCHEMA.md's own discipline
// paragraph.
const DISCIPLINE_VALUES = new Set(["pro-wrestling", "mma", "mixed", "other"]);
// HOUSE-STYLE-SKIPPED-FOR-HUBS (the Janitor, 2026-08-23, the v76-rider
// ruling): house_style describes staged booking, which a community
// institution doesn't do — a usenet/community-hub wing owes no house_style
// at all, so the tier-owed soft-warn below doesn't fire for those media
// rather than nagging for a field the wing can never honestly fill.
const HOUSE_STYLE_EXEMPT_MEDIA = new Set(["usenet", "community-hub", "house-network"]);
// PLAY (the Janitor's ruling, 2026-08-23) — HOW OUTCOMES WERE DECIDED, the
// half of the question `medium` never answered. Shaped like house_style:
// `play` + `play_grade` + `play_source`, plus an optional free-text
// `play_detail` for a promotion whose own answer isn't uniform (NFW's Season
// 2 split by conference). The vocabulary's own poles are the hobby's, not
// this project's — DEFIANCE Wrestling's own public "This is DEFIANCE" page
// names the angled/competitive-RP distinction outright, and NFW's own
// application form asks an applicant "RP-based, or Angle-based?" in period.
// Soft-warn an unrecognized value; HARD-fail a set play with no grade beside
// it (unknown excepted — nothing to grade). Never guessed: set only where a
// promotion's own record states it.
// "strat" (the Janitor's gavel, 2026-08-26): competitive WRITTEN STRAT — a
// submitted written match strategy judged for a verdict; distinct from
// competitive-rp (judged in-character roleplay) though both are judged
// writing. Occasioned by the CHZ/GDWA vocabulary gap the plural-plays
// migration diagnosed: both feds ran a roleplay half AND a strat half.
const PLAY_VALUES = new Set(["competitive-rp", "strat", "angled", "generated", "hybrid", "unknown"]);
const AUTHORSHIP_VALUES = new Set(["open-fed", "single-author", "troupe", "vote-league", "unknown"]); // the Janitor's gavel 2026-09-10: who writes the canon
// THE PLURAL-MEDIUM SHAPE — `media[]` / `plays[]` (the Janitor's gavel,
// 2026-08-26, verbatim: "why should we [chain] promotions to one medium? If
// they operated under multiple mediums we should just document all of them.
// Same with play."). Both are OPTIONAL arrays that sit BESIDE the scalars
// `medium`/`play`, never instead of them: the scalar stays the PRIMARY value
// — the wing's single most-characteristic answer, which every instrument,
// filter, card sub and placard already reads — and the array documents the
// full truth one value cannot hold (CSWA's four venues across twenty-six
// years; a fed whose `play` is the summary word "hybrid").
//
// ENTRY SHAPE, per runs[]'s own precedent (whose entries reuse the parent
// field names `founded`/`closed` rather than a generic `value`): each entry
// keys its value on the SAME name the scalar uses — `medium` inside
// `media[]`, `play` inside `plays[]` — plus optional free-text `era` (the
// span or era label, at whatever precision the receipt actually supports,
// never invented) and `note` (the receipt in prose, the job `medium_detail`
// has always done). The key choice is not cosmetic: js/query.js's
// flattenFields() folds an array-of-objects' own keys up UNPREFIXED, so
// `medium:online-service` finds CSWA through its PRODIGY era for free, with
// nothing hand-wired on any page. See docs/SCHEMA.md's own worked example.
const MEDIA_ENTRY_KEYS = new Set(["medium", "era", "note"]);
const PLAYS_ENTRY_KEYS = new Set(["play", "era", "note"]);
const AUTHORSHIPS_ENTRY_KEYS = new Set(["authorship", "era", "note"]);
// Shared shape check for the two plural arrays. Values validate against the
// SAME enum the scalar does, with the same soft-warn posture (the
// vocabularies are controlled-but-growing); era/note are free text;
// unrecognized keys soft-warn, the tenures[]/record{} posture one level up.
function checkPluralField(p, field, valueKey, values, keys) {
  const arr = p[field];
  if (!Array.isArray(arr)) {
    warn(`promotion "${p.id}": "${field}" must be an array of { ${valueKey}, era?, note? } entries`);
    return;
  }
  if (arr.length < 2) {
    soft(`promotion "${p.id}": "${field}" carries ${arr.length} entr${arr.length === 1 ? "y" : "ies"} — the plural shape exists to document a promotion that operated under MORE THAN ONE; a single-entry array says nothing the scalar "${valueKey}" doesn't already say`);
  }
  for (const [i, e] of arr.entries()) {
    if (!e || typeof e !== "object" || Array.isArray(e)) {
      warn(`promotion "${p.id}".${field}[${i}]: must be an object`);
      continue;
    }
    if (typeof e[valueKey] !== "string" || !e[valueKey].trim()) {
      warn(`promotion "${p.id}".${field}[${i}]: needs a non-empty "${valueKey}"`);
    } else if (!values.has(e[valueKey])) {
      soft(`promotion "${p.id}".${field}[${i}]: ${valueKey} "${e[valueKey]}" is not one of the known values — same posture as the scalar: fine if it's a genuinely new one, just flagging so it's a deliberate addition, not a typo`);
    }
    for (const k of ["era", "note"]) {
      if (k in e && (typeof e[k] !== "string" || !e[k].trim())) {
        warn(`promotion "${p.id}".${field}[${i}]: "${k}" must be a non-empty string when present`);
      }
    }
    for (const k of Object.keys(e)) {
      if (!keys.has(k)) soft(`promotion "${p.id}".${field}[${i}]: unrecognized key "${k}" (expected one of ${[...keys].join("|")}) — if the plural shape needs a new field, document it in docs/SCHEMA.md first`);
    }
  }
}
// SCALE (user gavel: "company pages should probably have some type of scale
// attribute... the bingo hall, the local/regional/national/global
// promotions... carried over as their creators intended them") — a fed's
// OWN self-presented kayfabe scope, not the museum's judgment of realism or
// real attendance. Smallest to largest; "unknown" where the record doesn't
// say. Controlled but soft — same posture as depth/medium.
const SCALE_VALUES = new Set([
  "bingo-hall", "local", "regional", "national", "global", "unknown",
]);
// ROSTER POLICY (PORTRAYALS OF REAL PROFESSIONAL WRESTLERS, the Janitor,
// 2026-08-24; CURATION.md v78(f)) — WHOSE NAMES the fed booked. Early
// e-wrestling split into REAL feds (rosters of actual WWF/WCW-era wrestlers,
// played by handlers), FANTASY feds (original characters), and BLENDS, and
// the museum documents all three honestly. Shaped exactly like `play`:
// `roster_policy` + `roster_policy_grade` + `roster_policy_source`, read off
// the corpus's OWN voice. There is deliberately no "unknown" value and no
// default — ABSENT means not yet determined, and v78(f)'s own last clause is
// "never guessed," so an unsourced guess must be impossible to write rather
// than merely discouraged. Hence both the grade and the source hard-fail
// when the field is set at all, which is one notch stricter than `scale`'s
// soft source nudge: a roster policy is a claim about what a fed WAS.
const ROSTER_POLICY_VALUES = new Set(["real", "fantasy", "blended"]);
// unit_kind (THE LOBBY STATS WAVE) — declared up here alongside the other
// controlled-but-soft value sets so section 3 (units) can use it below.
// ROSTER QA WAVE (tiny refinement, user-endorsed): "entourage" — one clean
// value, not "army/entourage" — for anything that travels WITH a wrestler
// (a manager-collective, a valet cluster) rather than competing AS a unit.
// "trio" joins alongside "tag-team" for the (rarer) three-member in-ring
// units that aren't quite a full "stable."
const UNIT_KIND_VALUES = new Set(["tag-team", "trio", "stable", "entourage", "other"]);
// sources[] (THE PROVENANCE WAVE, user gavel: "the UWF data is built from
// uwf.org.uk and uwfonline.com via the WayBackMachine on X date and the
// Yahoo Group and a specific collection") — a per-promotion bibliography of
// WHAT the holdings were built from, distinct from provenance_notes (which
// are individual graded factual claims): drive paths, Wayback captures,
// Yahoo-group threads, tabletop play-notes, standalone documents. Controlled
// but soft, same posture as medium/scale — a genuinely new kind of source
// is fine, just flagged so it isn't a typo.
const SOURCE_KIND_VALUES = new Set([
  "drive", "wayback", "live-site", "yahoo-group", "local-documents", "tabletop-notes",
  "usenet-post", // the Janitor, 2026-09-20: holdings drawn from a newsgroup walk (docs/SCHEMA.md sources[])
  // "cd-archive" (the Janitor, 2026-08-25, folding in the BBS-era lane's
  // deliberate soft-warned value): holdings recovered from archived CD-ROM /
  // disk-image media (IA-hosted or physical) — the NetNews-on-CD and
  // shareware-CD acquisitions are the founding uses.
  "cd-archive",
  // "common-crawl" (the Janitor, 2026-08-25, the fwrestling.com census):
  // holdings recovered from the Common Crawl web archive via range-request
  // recovery against a WARC record — a different crawler, index, and capture
  // mechanism than Wayback's own timestamp lookup, used when a tenant's own
  // Wayback captures were unreachable during a paused IA lane but its bytes
  // survived in a Common Crawl snapshot instead.
  "common-crawl",
]);
// KNOWN_COLLECTIONS: accession lot ids (data/collections.json), used below to
// validate promotions.sources[].accession. Promotions no longer carry a bare
// `collection` field themselves (THE PROVENANCE WAVE accession-lots
// correction) — a promotion's holdings can span several acquisition lots
// (e.g. UWF: 0001 drive + 0002/0011/0012/0014 separate web-recovery
// campaigns), which is exactly what sources[] exists to express precisely.
const KNOWN_COLLECTIONS = collectionIds;

// ACCESSION-ID WIDTH-PROOFING, 2026-08-18 (user foresight: at 14 lots from
// ONE collection, 9999 is genuinely reachable in Phase 3). Accession ids are
// decimal integers rendered as strings; existing ids keep their own
// zero-padding forever once minted (slug-immutability doctrine), but a
// future id past 9999 simply continues as "10000" with no re-padding. The
// one real trap this creates is LEXICAL sorting/comparison ("9999" > "10000"
// as strings) — this codebase sidesteps it by relying on
// data/collections.json's own file order (true acquisition order,
// append-only) everywhere an accession list renders, rather than re-sorting
// ids at all. This check is the guard for that: collections.json's own row
// order must be a strictly increasing sequence of INTEGERS (parsed, never
// string-compared) — the one place a width-proofing regression would first
// show up if someone ever appended a new lot out of order or reintroduced a
// lexical sort.
for (let i = 1; i < collections.length; i++) {
  const prev = parseInt(collections[i - 1].id, 10), cur = parseInt(collections[i].id, 10);
  if (!Number.isNaN(prev) && !Number.isNaN(cur) && cur <= prev) {
    warn(`data/collections.json: accession "${collections[i].id}" (row ${i}) does not numerically follow "${collections[i - 1].id}" (row ${i - 1}) — rows must stay in true acquisition order, parsed as integers, never string-compared`);
  }
}

for (const p of promotions) {
  for (const field of ["id", "name", "band", "visibility"]) {
    if (!(field in p)) warn(`promotion "${p.id ?? "?"}" is missing required field "${field}"`);
  }
  // THE PAGE SKELETON DOCTRINE (2026-08-18 gavel: "same skeleton at every
  // scale is the right design") — promotions get exactly the same one-
  // sentence `caption` requirement characters/units already carry, for the
  // same reason: name -> subtitle -> placard -> caption -> sections is one
  // anatomy, not a per-entity-type improvisation.
  if (typeof p.caption !== "string" || !p.caption.trim()) {
    warn(`promotion "${p.id}": missing "caption" — every promotion needs one hand-drafted museum-label sentence (see docs/PROCESS.md's page-skeleton doctrine)`);
  } else if (p.caption.split(/(?<=[.!?])\s+/).filter(Boolean).length > 1 && !/["“].*[.!?]["”]/.test(p.caption)) {
    soft(`promotion "${p.id}": caption reads as more than one sentence — captions should be ONE sentence (quoted dialogue containing its own punctuation is fine)`);
  }
  if ("full_name" in p && /\([^)]*\)/.test(p.full_name)) {
    warn(`promotion "${p.id}": "full_name" contains a parenthetical — full_name is a NAME ONLY (2026-08-18 gavel); a descriptor like this belongs on the optional "qualifier" field instead`);
  }
  if ("collection" in p) warn(`promotion "${p.id}": carries a bare "collection" field — promotions now express provenance only through sources[].accession (see the PROVENANCE WAVE accession-lots correction)`);
  // THE PROMOTION-LEVEL aka (the Janitor's gavel, 2026-08-23; CURATION.md
  // v78). Shape only here — the cross-promotion collision guard is its own
  // block below, since it has to see every row before it can rule.
  if ("aka" in p) {
    if (!Array.isArray(p.aka) || p.aka.some((a) => typeof a !== "string" || !a.trim())) {
      warn(`promotion "${p.id}": "aka" must be an array of non-empty strings — former names, alternate expansions, and former acronyms the fed itself used`);
    } else {
      for (const a of p.aka) {
        if (a.trim().toLowerCase() === String(p.name ?? "").trim().toLowerCase()) {
          soft(`promotion "${p.id}": aka "${a}" duplicates the row's own name — an aka records a label the row's own \`name\` does NOT already carry`);
        }
      }
    }
  }
  if ("aka_unlinkable" in p) {
    const akas = new Set(Array.isArray(p.aka) ? p.aka : []);
    if (!Array.isArray(p.aka_unlinkable) || p.aka_unlinkable.some((a) => typeof a !== "string" || !a.trim())) {
      warn(`promotion "${p.id}": "aka_unlinkable" must be an array of non-empty strings`);
    } else {
      for (const a of p.aka_unlinkable) {
        if (!akas.has(a)) warn(`promotion "${p.id}": aka_unlinkable "${a}" is not one of this row's own aka[] entries — the field names which RECORDED akas the auto-linker must not link, so every entry must appear in aka[] verbatim`);
      }
    }
  }
  if (p.visibility !== "gated") warn(`promotion "${p.id}" has visibility "${p.visibility}" — expected "gated" (nothing is public yet)`);
  // THE FANDOM CROSS-CHECK WAVE (the Janitor's directive, 2026-08-24) —
  // "fandom" is the EXACT article title on the e-wrestling fandom wiki
  // (https://ewrestling.fandom.com/wiki/<Title>), verbatim as the wiki
  // spells it, spaces and all: the renderer does the underscoring and the
  // URL-encoding, so a hand-encoded title here would double-encode. Shape
  // is a hard fail; whether the article is the RIGHT one is a curation
  // judgement no validator can make (see the collision guard below).
  if ("fandom" in p && (typeof p.fandom !== "string" || !p.fandom.trim())) {
    warn(`promotion "${p.id}": "fandom" must be a non-empty string when present — the exact e-wrestling fandom wiki article title, as the wiki spells it`);
  }
  if (p.depth && !DEPTH_VALUES.has(p.depth)) {
    soft(`promotion "${p.id}": depth "${p.depth}" is not one of the defined criteria (see CURATION.md's registry rule) — meant to mean the same thing for every collection`);
  }
  // THE DEPTH-TIER LADDER (docs/PROCESS.md's depth-tier doctrine) — every
  // promotion carries a structured `tier` (0-3) plus a receipts-bearing
  // `tier_source`, hard fail on either being missing/malformed. This is the
  // "if it can be an edge, it's an edge" completion of the ladder: `depth`
  // stays the human phrase, `tier` is what a filter/sort can act on.
  if (typeof p.tier !== "number" || !TIER_VALUES.has(p.tier)) {
    warn(`promotion "${p.id}": missing or invalid "tier" — every promotion needs a depth-tier integer 0 (attested) through 3 (full-crawl), see docs/PROCESS.md's depth-tier ladder`);
  }
  if (typeof p.tier_source !== "string" || !p.tier_source.trim()) {
    warn(`promotion "${p.id}": missing "tier_source" — the tier assignment needs a receipt (a show-structured/total-shows fraction, a digest cite, or an honest "beacon row only" note)`);
  }
  // PROSE-BY-TIER DOCTRINE soft-warns (THE WING COLLAPSE WAVE, 2026-08-22):
  // a Tier 2+ promotion owes a house_style; a Tier 3 promotion owes a
  // Storylines section on its own wing page (folded into index.html, not a
  // separate tab — see docs/PROCESS.md's Prose section). Both soft, never
  // hard-fail — depth is a debt payable later, not a build-breaker today.
  if (typeof p.tier === "number") {
    // THE HOUSE-STYLE EXEMPTION, ALIGNED (LAW-ENFORCEMENT-01, 2026-09-19).
    // The 2026-08-23 ruling exempts a COMMUNITY WING — "the field describes
    // staged booking, which an institution doesn't do". It was written when
    // "community-hub" was a `medium` value; THE TYPE-AXIS GAVEL (v111,
    // 2026-09-05) moved the kind to `type` and left `medium` naming only the
    // platform, so the medium-only test stopped catching the eight wings the
    // rule is actually about (rspwf, rspw, scoops, prodigy, titan-zone,
    // rec-games-pbm, wrestle-rpg, fpw) while `medium: "usenet"` now matches
    // only 8 rows and `"newsgroup"` — 1,194 rows, nearly all of them ordinary
    // federations that DO stage booking — matches none. Reading the type axis
    // beside the legacy media only ever REMOVES false debt; it never adds a
    // wing to the ledger. An interfed alliance is deliberately NOT exempt: it
    // stages joint supercards, so it books (open for a coordinator ruling —
    // journal 2026-09-19 08:31).
    if (typeof p.house_style === "string" && p.house_style.trim()) lawHit("house-style-present-total");
    const houseStyleExempt = HOUSE_STYLE_EXEMPT_MEDIA.has(p.medium) || p.type === "community-hub";
    if (p.tier >= 2 && !houseStyleExempt && !(typeof p.house_style === "string" && p.house_style.trim())) {
      lawHit("house-style-missing-tier2plus");
      soft(`promotion "${p.id}": tier ${p.tier} (structured or full-crawl) owes a "house_style" — none on file`);
    }
    // THE EPITAPH CHECK (LAW-ENFORCEMENT-01, 2026-09-19; CURATION
    // #promotion-epitaphs, PROCESS's "Frontier -> Tier 0" step 4: "No epitaph
    // is owed below Tier 1"). The walk campaign's own brief told lanes a
    // minted wing needed no hand-written landing page; 1,074 tier-1+ wings
    // landed and 11 carried an epitaph. Counted at both ends: the tier-1+
    // DEBT may not grow, and the number of epitaphs that EXIST may not fall
    // (three pre-campaign epitaphs — wce, whq, wwe-the-efed — were stripped
    // by a regeneration and nothing noticed).
    if (p.page) {
      const wingIndexPath = resolve(ROOT, p.page.replace(/^\//, ""), "index.html");
      const wingHtml = existsSync(wingIndexPath) ? readFileSync(wingIndexPath, "utf8") : "";
      const epi = wingHtml.match(/<!--\s*epitaph:start\s*-->([\s\S]*?)<!--\s*epitaph:end\s*-->/);
      const hasEpitaph = !!(epi && epi[1].replace(/<[^>]*>/g, "").trim().length > 40);
      if (hasEpitaph) lawHit("epitaph-present-total");
      if (p.tier >= 1 && !hasEpitaph) {
        lawHit("epitaph-missing-tier1plus");
        soft(`promotion "${p.id}": tier ${p.tier} owes a written Epitaph section on ${p.page}index.html — none found (CURATION's promotion-epitaphs rule; no epitaph is owed below tier 1)`);
      }
      if (p.tier >= 3 && existsSync(wingIndexPath)) {
        if (!wingHtml.includes("<!-- storylines:start -->") && !/<h2[^>]*>\s*Storylines/i.test(wingHtml)) {
          lawHit("storylines-missing-tier3");
          soft(`promotion "${p.id}": tier 3 (full-crawl) owes a Storylines section on its own wing page — none found on ${p.page}index.html`);
        }
      }
    }
  }
  if (!p.type) {
    warn(`promotion "${p.id}": missing "type" — every row says what it IS (${[...TYPE_VALUES].join("|")}) separately from the platform it ran on (THE TYPE-AXIS GAVEL, 2026-09-05; the tournament value, CURATION.md v118; the academy value, CURATION.md v120)`);
  } else if (!TYPE_VALUES.has(p.type)) {
    warn(`promotion "${p.id}": type "${p.type}" is not one of ${[...TYPE_VALUES].join("|")} (THE TYPE-AXIS GAVEL, 2026-09-05)`);
  }
  // A TOURNAMENT'S WINNERS ARE ITS AWARD'S BESTOWALS, NEVER REIGNS (CURATION.md
  // v118(b), the Janitor, 2026-09-24): nobody holds or defends the trophy
  // between stagings, so a `tournament` wing carries no title row and no reign
  // row — its roll of winners is ONE awards.json award entity with one bestowal
  // per staging. A belt a FEDERATION named after the same person is that
  // federation's title and files to that federation's wing (the PWW-era Chris
  // Williams Television Title -> pww-worldwide-1999). SOFT, not hard: the value
  // is one day old, the shape it is steering is a wing nobody has landed yet,
  // and a mis-filed belt is a filing to move rather than a build to break.
  if (p.type === "tournament") {
    const tourneyTitles = titles.filter((t) => t && t.promotion === p.id).map((t) => t.id);
    if (tourneyTitles.length) {
      soft(`promotion "${p.id}": type "tournament" carries ${tourneyTitles.length} titles.json row(s) (${tourneyTitles.slice(0, 5).join(", ")}${tourneyTitles.length > 5 ? ", …" : ""}) — a tournament's winners are its AWARD's bestowals, never a title's reigns (CURATION.md v118(b)); a belt a federation named after the same person belongs to that federation's wing`);
    }
    // reigns.json rows key to a TITLE, never to a promotion, so the reign
    // count is read through the wing's own titles rather than off a field
    // reigns does not carry.
    const tourneyReignCount = tourneyTitles.length
      ? reigns.filter((r) => r && tourneyTitles.includes(r.title)).length
      : 0;
    if (tourneyReignCount) {
      soft(`promotion "${p.id}": type "tournament" carries ${tourneyReignCount} reigns.json row(s) through its own title(s) — nobody holds or defends the trophy between stagings, so the roll of winners is one awards.json award entity with one bestowal per staging (CURATION.md v118(b))`);
    }
  }
  // type_note (THE ECOSYSTEM EXPANSION GAVEL, 2026-09-05; CURATION.md
  // v111(f)) — the type axis names exactly ONE kind, and the note is where a
  // fed that is genuinely two things at once (the figure-fed anchor that is a
  // federation and its scene's hub in the same breath) says so. Free text, no
  // enum, deliberately: a second stored type value would make every filter,
  // chip and placard ask which one was meant.
  if ("type_note" in p) {
    if (typeof p.type_note !== "string" || !p.type_note.trim()) {
      warn(`promotion "${p.id}": "type_note" must be a non-empty string when present (CURATION.md v111(f))`);
    } else if (p.type_note.length > 240) {
      soft(`promotion "${p.id}": "type_note" runs ${p.type_note.length} characters — it is a note on the placard, not a paragraph; the long version belongs in the wing's own epitaph`);
    }
  }
  // THE SERVED-TEXT RULE (the Janitor review 2026-09-05, Summit/UFWS: "accessions are
  // just smuggling process narration into any chunk they can fit it into") —
  // a placard detail is one short clause, and no served free-text field carries
  // workshop reasoning (identity searches, do-not-merge guards, lane/ledger talk).
  if (typeof p.medium_detail === "string" && p.medium_detail.length > 60) {
    soft(`promotion "${p.id}": medium_detail is ${p.medium_detail.length} characters — the placard's Medium row takes one short clause (≤ 60); longer text belongs in provenance_notes (THE SERVED-TEXT RULE, 2026-09-05)`);
  }
  if (typeof p.qualifier === "string" && p.qualifier.length > 40) {
    soft(`promotion "${p.id}": qualifier is ${p.qualifier.length} characters — a qualifier is a short disambiguator (platform, host, year), not a note (THE SERVED-TEXT RULE, 2026-09-05)`);
  }
  // THE SERVED-PROSE MARKER GATE EXTENSION (PROSE-FIX-01, 2026-09-13;
  // proposal.md #1) — promotions.caption joins medium_detail/qualifier's own
  // length-cap posture (soft-warn only, same as every cap in this file).
  if (typeof p.caption === "string" && p.caption.length > FIELD_CAPS["promotions.caption"]) {
    soft(`promotion "${p.id}": caption is ${p.caption.length} characters — a museum-label caption takes one short sentence (≤ ${FIELD_CAPS["promotions.caption"]}); longer text belongs in provenance_notes (THE SERVED-TEXT RULE, 2026-09-05)`);
  }
  // caption_asof SHAPE (proposal.md #1) — one promotions.json row on file
  // today (fwrestling) carries caption_asof as a bare date string instead
  // of the documented {author, evidence, written} object; a naive
  // caption_asof.author read would silently see undefined instead of
  // erroring. Soft, not hard: the row still renders, it just can't be
  // read the way every other row's caption_asof can.
  if (p.caption_asof != null && typeof p.caption_asof !== "object") {
    soft(`promotion "${p.id}": caption_asof is a bare ${typeof p.caption_asof} ("${p.caption_asof}"), not the documented {author, evidence, written} object — every other row's caption_asof.author/evidence read would silently miss this one`);
  }
  // THE PROVENANCE BREACH (LAW-ENFORCEMENT-01, 2026-09-19). docs/SCHEMA.md
  // has always required provenance_notes[] — "individually graded
  // founding-fact claims" — on every promotion row, and nothing ever checked
  // it. At commit fbb3965d87 (chain 139, 2026-09-13) 1,384 of 1,388 rows
  // carried 6,389 typed records between them. At e82bf9dbc2 (chain 140,
  // 2026-09-14) every array was empty, and every array has been empty since;
  // the per-wing narratives survive in the workshop
  // (the per-wing provenance narratives in the workshop, 1,397 files) but the typed records on
  // the rows do not. Five days of gates reported
  // "validate-provenance-notes: 0 entries seen ... OK" — a validator that
  // iterates a list is VACUOUSLY GREEN when the list is empty, which is the
  // single most expensive lesson of this whole pass.
  //
  // Every mint is sent back for an empty provenance_notes[] at landing
  // (land-check LAW L-PROV). Here it is ratcheted while the recorded debt is
  // above zero — hard-failing 1,477 rows today would simply red the gate until
  // somebody bypassed it — and the per-row hard failure below ARMS ITSELF the
  // moment the baseline for this rule reads 0, i.e. the moment the coordinator
  // has rebuilt the records and re-run `npm run law:baseline`.
  if (!Array.isArray(p.provenance_notes) || p.provenance_notes.length === 0) {
    lawHit("promotion-provenance-notes-missing");
    if (lawDebtPaid("promotion-provenance-notes-missing")) {
      warn(`promotion "${p.id}": provenance_notes[] is empty — every row carries at least one typed provenance record (docs/SCHEMA.md; the 2026-09-14 wipe of 6,389 records is why this is checked)`);
    }
  }

  // AKA IS A LABEL, NEVER A SENTENCE (LAW-ENFORCEMENT-01, 2026-09-19;
  // docs/SCHEMA.md's aka[] — "a label the fed itself used"). A parenthetical
  // disambiguator is a label ("OWA (Orlando)", "XWA (2001)") and stays; a
  // parenthetical that runs to a clause is workshop reasoning that the wing
  // placard renders straight out, and it belongs in provenance_notes.
  for (const a of p.aka ?? []) {
    if (typeof a !== "string") { lawHit("aka-narration"); soft(`promotion "${p.id}": aka entry ${JSON.stringify(a)} is not a string`); continue; }
    const paren = [...a.matchAll(/\(([^)]*)\)/g)].find((m) => m[1].trim().split(/\s+/).length >= 4);
    const reason = a.length > 60 ? `runs ${a.length} characters` : paren ? `carries a ${paren[1].trim().split(/\s+/).length}-word parenthetical explanation` : /\s--\s|;|\.\s/.test(a) ? "carries sentence punctuation" : null;
    if (reason) {
      lawHit("aka-narration");
      soft(`promotion "${p.id}": aka "${a.slice(0, 70)}" ${reason} — an aka is a LABEL the fed itself used, not a note about it (docs/SCHEMA.md aka[]; the explanation belongs in provenance_notes)`);
    }
  }
  for (const f of ["name", "full_name", "caption", "tagline", "medium_detail", "house_style", "qualifier", "depth"]) {
    const re = (f === "name" || f === "full_name" || f === "qualifier") ? NAME_PROCESS_TEXT_RE : PROCESS_TEXT_RE;
    if (typeof p[f] === "string" && re.test(p[f])) {
      lawHit("served-text-narration");
      soft(`promotion "${p.id}": ${f} carries workshop process text (${p[f].match(re)[0]}) — served fields state the fact; the reasoning stays in provenance_notes (THE SERVED-TEXT RULE, 2026-09-05)`);
    }
  }
  if (p.medium && RETIRED_KIND_MEDIA.has(p.medium)) {
    warn(`promotion "${p.id}": medium "${p.medium}" is retired — medium names the PLATFORM (usenet, website-efed, online-service …); the kind goes in "type" (THE TYPE-AXIS GAVEL, 2026-09-05)`);
  }
  if (p.form && !FORM_VALUES.has(p.form)) {
    lawHit("controlled-value-outside-enum");
    soft(`promotion "${p.id}": form "${p.form}" is not one of ${[...FORM_VALUES].join("|")} (see docs/SCHEMA.md) — flagging so it's not a typo`);
  }
  if (p.medium && !MEDIUM_VALUES.has(p.medium)) {
    lawHit("controlled-value-outside-enum");
    soft(`promotion "${p.id}": medium "${p.medium}" is not one of the known values (see CURATION.md's registry rule) — fine if it's a genuinely new medium, just flagging so it's a deliberate addition, not a typo`);
  }
  if (p.discipline && !DISCIPLINE_VALUES.has(p.discipline)) {
    soft(`promotion "${p.id}": discipline "${p.discipline}" is not one of pro-wrestling|mma|mixed|other (see docs/SCHEMA.md) — fine if it's a genuinely new sport, just flagging so it's a deliberate addition, not a typo`);
  }
  if (p.play && !PLAY_VALUES.has(p.play)) {
    lawHit("controlled-value-outside-enum");
    soft(`promotion "${p.id}": play "${p.play}" is not one of ${[...PLAY_VALUES].join("|")} (see docs/SCHEMA.md) — fine if it's deliberate, just flagging so it's not a typo`);
  }
  if (p.play && p.play !== "unknown" && !GRADES.has(p.play_grade)) {
    warn(`promotion "${p.id}": has "play" set to "${p.play}" but no valid "play_grade" — a play assignment is evidence-graded like house_style (primary-source|user-attested|presumed); only "unknown" needs no grade`);
  }
  // authorship — WHO WRITES THE CANON (the Janitor gavel 2026-09-10), orthogonal to medium and play;
  // same never-guessed, evidence-graded posture as play. Absent = undetermined.
  if (p.authorship && !AUTHORSHIP_VALUES.has(p.authorship)) {
    lawHit("controlled-value-outside-enum");
    soft(`promotion "${p.id}": authorship "${p.authorship}" is not one of ${[...AUTHORSHIP_VALUES].join("|")} (see docs/SCHEMA.md) — flagging so it's not a typo`);
  }
  if (p.authorship && p.authorship !== "unknown" && !GRADES.has(p.authorship_grade)) {
    warn(`promotion "${p.id}": has "authorship" set to "${p.authorship}" but no valid "authorship_grade" — an authorship assignment is evidence-graded like play (primary-source|user-attested|presumed); only "unknown" needs no grade`);
  }
  if (p.authorship && p.authorship !== "unknown" && !(typeof p.authorship_source === "string" && p.authorship_source.trim())) {
    warn(`promotion "${p.id}": has "authorship" set to "${p.authorship}" but no "authorship_source" — name the document that states who wrote the promotion`);
  }
  if ("authorships" in p) {
    checkPluralField(p, "authorships", "authorship", AUTHORSHIP_VALUES, AUTHORSHIPS_ENTRY_KEYS);
    if (!p.authorship) warn(`promotion "${p.id}": carries "authorships" but no scalar "authorship" — the array is the full truth, the scalar the primary every instrument reads`);
  }
  // media[] — the plural medium shape, see MEDIA_ENTRY_KEYS above. OPTIONAL
  // and absent on the overwhelming majority of rows, which genuinely had one
  // venue; written only where the row's own record ATTESTS a second, never
  // inferred from a fed having had a message board bolted onto its website.
  if ("media" in p) {
    checkPluralField(p, "media", "medium", MEDIUM_VALUES, MEDIA_ENTRY_KEYS);
    if (!p.medium) {
      warn(`promotion "${p.id}": carries "media" but no scalar "medium" — the array documents the full truth, the scalar names the PRIMARY value every instrument, filter and placard reads; a plural with no primary is a row nothing can filter`);
    } else if (Array.isArray(p.media) && !p.media.some((e) => e && e.medium === p.medium)) {
      warn(`promotion "${p.id}": scalar medium "${p.medium}" does not appear among its own media[] entries — the primary is the most-characteristic ONE OF the media the promotion operated under, never a value the array itself doesn't carry (runs[]'s own envelope discipline, one field over)`);
    }
  }
  // plays[] — same shape, same enum posture. The scalar rule here is
  // deliberately LOOSER than media[]'s: "hybrid" is DEFINED as "genuinely
  // more than one of the above at once", i.e. it is the SUMMARY of a
  // multi-entry plays[] rather than a member of it, so a hybrid scalar over
  // [competitive-rp, angled] is the shape working exactly as intended.
  if ("plays" in p) {
    checkPluralField(p, "plays", "play", PLAY_VALUES, PLAYS_ENTRY_KEYS);
    if (!p.play) {
      warn(`promotion "${p.id}": carries "plays" but no scalar "play" — same rule media[] follows: the array is the full truth, the scalar the primary every instrument reads`);
    } else if (p.play !== "hybrid" && Array.isArray(p.plays) && !p.plays.some((e) => e && e.play === p.play)) {
      soft(`promotion "${p.id}": scalar play "${p.play}" is neither "hybrid" (the summary word for a multi-entry plays[]) nor one of its own plays[] entries — worth a second look at which answer is the primary one`);
    }
  }
  if (p.scale && !SCALE_VALUES.has(p.scale)) {
    soft(`promotion "${p.id}": scale "${p.scale}" is not one of bingo-hall|local|regional|national|global|unknown — fine if it's deliberate, just flagging so it's not a typo`);
  }
  // roster_policy — see ROSTER_POLICY_VALUES above. Absent is a legitimate
  // state and the common one; set, it owes both a grade and a receipt.
  if ("roster_policy" in p) {
    if (!ROSTER_POLICY_VALUES.has(p.roster_policy)) {
      warn(`promotion "${p.id}": roster_policy "${p.roster_policy}" is not one of real|fantasy|blended (CURATION.md v78(f)) — there is no "unknown" value; a fed whose record hasn't been read yet carries no roster_policy at all`);
    }
    if (!GRADES.has(p.roster_policy_grade)) {
      warn(`promotion "${p.id}": has "roster_policy" set to "${p.roster_policy}" but no valid "roster_policy_grade" — a roster policy is evidence-graded like house_style and play (primary-source|user-attested|presumed)`);
    }
    if (typeof p.roster_policy_source !== "string" || !p.roster_policy_source.trim()) {
      warn(`promotion "${p.id}": has "roster_policy" set to "${p.roster_policy}" but no "roster_policy_source" — v78(f) reads the policy off the corpus's own voice and says in as many words that it is never guessed, so the receipt is required, not encouraged`);
    }
  }
  if ("roster_policy_grade" in p && !("roster_policy" in p)) {
    soft(`promotion "${p.id}": carries "roster_policy_grade" with no "roster_policy" — a grade with nothing to grade`);
  }
  // language / country (THE ECOSYSTEM EXPANSION GAVEL, 2026-09-05;
  // CURATION.md v111(c)) — see the constants above. Both OPTIONAL and absent
  // on every row held at the gavel. MALFORMED is a HARD FAIL (a typo'd tag is
  // never a deliberate act); WELL-FORMED-BUT-UNKNOWN is a soft warn, since
  // both vocabularies grow with the scenes — the `medium` posture exactly.
  if ("language" in p) {
    if (typeof p.language !== "string" || !BCP47_RE.test(p.language)) {
      warn(`promotion "${p.id}": language "${p.language}" is not a well-formed BCP-47 tag (language[-Script][-REGION], e.g. "pl", "pt-BR", "zh-Hans") — CURATION.md v111(c)`);
    } else if (!LANGUAGE_VALUES.has(p.language)) {
      soft(`promotion "${p.id}": language "${p.language}" is well-formed but not one of the known tags — fine if it's a genuinely new scene, just flagging so it's a deliberate addition, not a typo`);
    }
  }
  if ("country" in p) {
    if (typeof p.country !== "string" || !ISO3166_RE.test(p.country) || ISO3166_RESERVED.test(p.country)) {
      warn(`promotion "${p.id}": country "${p.country}" is not an ISO 3166-1 alpha-2 code in upper case (PL, DE, KR) — CURATION.md v111(c); this is the REAL-WORLD country of the community that ran the fed, never the kayfabe billing, which stays in "location"`);
    } else if (!COUNTRY_VALUES.has(p.country)) {
      soft(`promotion "${p.id}": country "${p.country}" is well-formed but not one of the known codes — fine if it's a genuinely new scene, just flagging so it's a deliberate addition, not a typo`);
    }
  }
  // THE DEFAULT'S OWN GUARD (v111(c)): absence of "language" means "en",
  // which is true of every row on file and false the moment a non-Anglophone
  // row forgets the field. A row placed outside the Anglophone scene says its
  // language out loud — including an explicit "en", which is a fact worth
  // storing for an English-language fed inside a non-English scene.
  if (p.country && typeof p.country === "string" && ISO3166_RE.test(p.country) && !ANGLOPHONE_DEFAULT.has(p.country) && !("language" in p)) {
    soft(`promotion "${p.id}": country "${p.country}" is outside the Anglophone scene but no "language" is set — absence means "en" (CURATION.md v111(c)), so the default is making a claim nobody checked; state the language explicitly, or write "en" on purpose if the fed really did run in English`);
  }
  // languages[] / countries[] — the plural shapes, the exact media[]/plays[]
  // envelope: the scalar stays the PRIMARY every instrument reads, the array
  // records the plurality one value cannot hold. Same bar for a second entry
  // as media[]: a language the fed actually CONDUCTED ITSELF IN over an era
  // its own record attests — never a language it was merely discussed in.
  if ("languages" in p) {
    checkPluralField(p, "languages", "language", LANGUAGE_VALUES, LANGUAGES_ENTRY_KEYS);
    if (!p.language) {
      warn(`promotion "${p.id}": carries "languages" but no scalar "language" — same rule media[] follows: the array is the full truth, the scalar the primary every instrument reads`);
    } else if (Array.isArray(p.languages) && !p.languages.some((e) => e && e.language === p.language)) {
      warn(`promotion "${p.id}": scalar language "${p.language}" does not appear among its own languages[] entries — the primary is one OF them, never a value the array itself doesn't carry`);
    }
  }
  if ("countries" in p) {
    checkPluralField(p, "countries", "country", COUNTRY_VALUES, COUNTRIES_ENTRY_KEYS);
    if (!p.country) {
      warn(`promotion "${p.id}": carries "countries" but no scalar "country" — the array is the full truth, the scalar the primary`);
    } else if (Array.isArray(p.countries) && !p.countries.some((e) => e && e.country === p.country)) {
      warn(`promotion "${p.id}": scalar country "${p.country}" does not appear among its own countries[] entries`);
    }
  }
  // CAPTION_EN — THE MUSEUM-VOICE SIBLING (THE ECOSYSTEM EXPANSION GAVEL,
  // 2026-09-05, step 2; CURATION.md v112(c), #caption-en). The translation
  // doctrine's layer (b): the museum writes its own voice in the scene's
  // language and stores an English rendering as a SIBLING FIELD — a second
  // original, never a translation of the first, and never a translation of a
  // served document. Two rules and one soft one. The sibling is legal only
  // where the caption is not already English, and it is REQUIRED wherever a
  // non-English wing carries a caption at all: the label sentence is the one
  // sentence the museum owes every holding, and an English reader must never
  // be shut out of it. SOFT: an authorship flag it forgot, on the
  // caption_asof.author precedent.
  if ("caption_en" in p) {
    if (typeof p.caption_en !== "string" || !p.caption_en.trim()) {
      warn(`promotion "${p.id}": "caption_en" must be a non-empty string when present`);
    }
    if (!p.language || p.language === "en") {
      warn(`promotion "${p.id}": carries "caption_en" but runs in English (${p.language ? `language "${p.language}"` : `no "language", and absence means "en" — CURATION.md v111(c)`}) — the English sibling exists only beside a caption written in another language; this row's caption is already the English one`);
    }
  }
  if (p.language && p.language !== "en" && p.caption && !p.caption_en) {
    warn(`promotion "${p.id}": runs in "${p.language}" and carries a caption, but no "caption_en" — the museum's own label sentence owes an English reader a rendering (CURATION.md #caption-en); write a second original, never a translation of the first`);
  }
  if ("caption_en_author" in p && p.caption_en_author !== "ai" && p.caption_en_author !== "human") {
    warn(`promotion "${p.id}": "caption_en_author" must be "ai" or "human" — got "${p.caption_en_author}"`);
  }
  if (p.caption_en && !("caption_en_author" in p)) {
    soft(`promotion "${p.id}": "caption_en" with no "caption_en_author" — absence means "ai", which is the honest default; set "human" only where a person actually wrote it`);
  }
  if ("scale" in p && !("scale_source" in p)) {
    soft(`promotion "${p.id}": has a "scale" but no "scale_source" — every scale assignment should be sourced (the fed's own self-presentation), even when the source is "not yet mined"`);
  }
  // provenance_notes: optional array of memory/evidence-graded founding-fact
  // claims (e.g. who founded a promotion, per the promoter's own recall).
  // Character names only — never a real name (see CURATION.md's privacy rule).
  if ("provenance_notes" in p) {
    if (!Array.isArray(p.provenance_notes)) warn(`promotion "${p.id}": "provenance_notes" must be an array`);
    else for (const [i, n] of p.provenance_notes.entries()) {
      // 2026-09-13 (the Janitor gavel: typed claim records): a note is either the legacy {claim, evidence, grade} object or a
      // typed record {kind, summary, grade, sources, …}; validate-provenance-notes.mjs checks the typed shape in depth.
      const typed = typeof n.kind === "string" && typeof n.summary === "string";
      if (!typed && (!n.claim || !n.evidence)) warn(`promotion "${p.id}".provenance_notes[${i}]: needs "claim" and "evidence" (or a typed record with "kind" and "summary")`);
      if (!GRADES.has(n.grade)) warn(`promotion "${p.id}".provenance_notes[${i}]: grade "${n.grade}" is not one of primary-source|user-attested|presumed`);
    }
  }
  // quirks: short receipted flavor traits (THE GAME-VALUABLE DATAPOINTS
  // WAVE) — a fed's own texture (a tagline, a house venue, a running
  // format habit), one line each, always sourced. Game-facing like `band`
  // and `scale`: a future importer reads this field directly.
  if ("quirks" in p) {
    if (!Array.isArray(p.quirks)) warn(`promotion "${p.id}": "quirks" must be an array`);
    else for (const [i, q] of p.quirks.entries()) {
      if (!q.text || !q.source) warn(`promotion "${p.id}".quirks[${i}]: needs "text" and "source"`);
    }
  }
  // sources[]: see SOURCE_KIND_VALUES above. "window" is the capture/mining
  // date range, at whatever precision is honestly known — "not separately
  // recorded" is a legitimate value, a guessed date is not. "accession"
  // should resolve to a real collection id (almost always this promotion's
  // own p.collection, but a source can also be attested from a DIFFERENT
  // promotion's accession — e.g. a promotion known only from another wing's
  // own digest namedropping it).
  if ("sources" in p) {
    if (!Array.isArray(p.sources)) warn(`promotion "${p.id}": "sources" must be an array`);
    else for (const [i, s] of p.sources.entries()) {
      // THE PRE-ACCESSION BEACON EXCEPTION (2026-08-22, the Tim Fitzgerald
      // memorial mint): a tier-0 beacon may cite workshop-held attestation
      // material that has no accession lot YET — accession becomes required
      // the moment anything is actually served (tier 1+). Everything else
      // about the source row is still required.
      if (!s.kind || !s.identifier || !s.window || (!s.accession && p.tier !== 0)) {
        warn(`promotion "${p.id}".sources[${i}]: needs "kind", "identifier", "window", and "accession" (accession may be omitted only on a tier-0 beacon citing pre-accession workshop material)`);
      }
      if (s.kind && !SOURCE_KIND_VALUES.has(s.kind)) {
        lawHit("promotion-source-kind-unknown");
        soft(`promotion "${p.id}".sources[${i}]: kind "${s.kind}" is not one of drive|wayback|live-site|yahoo-group|local-documents|tabletop-notes — fine if deliberate, just flagging so it's not a typo`);
      }
      if (s.accession && !KNOWN_COLLECTIONS.has(s.accession)) {
        warn(`promotion "${p.id}".sources[${i}]: accession "${s.accession}" doesn't resolve to any promotion's own "collection" id`);
      }
    }
  }

  // founded/closed — required on every row; see checkFoundingDate above.
  checkFoundingDate(`promotion "${p.id}".founded`, p.founded);
  checkFoundingDate(`promotion "${p.id}".closed`, p.closed);

  if (Array.isArray(p.runs) && p.runs.length) {
    // THE INTERMITTENT-PROMOTIONS EXTENSION (coordinator amendment under
    // the same founding-edges gavel, 2026-08-21) — a promotion that ran,
    // went dark, and revived (NAPW is the founding case) carries an
    // optional runs[] envelope instead of one continuous span. Each entry
    // is its own {founded, closed, label?} pair, the same tenures[]-on-
    // characters idiom one level up. Top-level founded/closed are DERIVED
    // — they must equal the first/last run's own edge exactly, never
    // independently edited (rule 2 of the coordinator's own design: "the
    // envelope is derived truth, never independently editable drift").
    p.runs.forEach((run, i) => {
      checkFoundingDate(`promotion "${p.id}".runs[${i}].founded`, run.founded);
      checkFoundingDate(`promotion "${p.id}".runs[${i}].closed`, run.closed);
      // a run's closed edge compares at the END of its period (a year-only "2018" is 2018-12-31), as the top-level check does
      const fc = foundingComparable(run.founded), cc = closedComparable(run.closed);
      if (fc && cc && cc < fc) warn(`promotion "${p.id}".runs[${i}]: closed ("${run.closed?.date}") precedes founded ("${run.founded?.date}")`);
      if (i > 0) {
        const prevClosed = foundingComparable(p.runs[i - 1].closed), curFounded = foundingComparable(run.founded);
        if (prevClosed && curFounded && curFounded < prevClosed) {
          warn(`promotion "${p.id}".runs[${i}]: founded ("${run.founded?.date}") precedes the previous run's own closed ("${p.runs[i - 1].closed?.date}") — runs must stay in chronological order`);
        }
      }
    });
    const first = p.runs[0].founded, last = p.runs[p.runs.length - 1].closed;
    if (p.founded && first && (p.founded.date !== first.date || p.founded.precision !== first.precision)) {
      warn(`promotion "${p.id}": top-level "founded" must equal runs[0].founded exactly (date+precision) — the envelope is derived, never independently edited`);
    }
    if (p.closed && last && (p.closed.date !== last.date || p.closed.precision !== last.precision)) {
      warn(`promotion "${p.id}": top-level "closed" must equal the last run's own "closed" exactly (date+precision) — the envelope is derived, never independently edited`);
    }
  } else {
    // 2026-09-22 (GPW): a closed date at year or month precision covers its whole period — "2001" (year) does not precede
    // a founding on 2001-07-17. Compare the LAST day the closed value can mean, not its first.
    const fc = foundingComparable(p.founded), cc = closedComparable(p.closed);
    if (fc && cc && cc < fc) warn(`promotion "${p.id}": closed ("${p.closed?.date}") precedes founded ("${p.founded?.date}")`);
  }

  // Consistency against the free-text `years` prose span (docs/SCHEMA.md
  // documents this shape choice in full) — deliberately lenient: only the
  // years mentioned BEFORE any parenthetical aside are read, since a
  // parenthetical routinely carries a later, unrelated detail (WWA's own
  // "...including a real, previously-unknown 2019 phpBB revival" would
  // otherwise poison the comparison). founded's year must not be LATER
  // than the earliest year the string mentions; closed's year must not be
  // EARLIER than the latest — i.e. founded/closed may always REFINE what
  // the prose already says (an earlier founding, a later closing), never
  // contradict it outright. Skipped for a runs[] promotion (NAPW) — an
  // intermittent promotion's years string encodes more than one sub-range
  // in a shape this simple check can't parse.
  if (!(Array.isArray(p.runs) && p.runs.length) && typeof p.years === "string") {
    const head = p.years.split("(")[0];
    const nums = (head.match(/\d{4}/g) || []).map(Number).filter((y) => y >= DATE_YEAR_MIN && y <= DATE_YEAR_MAX);
    if (nums.length) {
      const boundMin = Math.min(...nums), boundMax = Math.max(...nums);
      const fy = foundingYear(p.founded), cy = foundingYear(p.closed);
      if (fy !== null && fy > boundMin) warn(`promotion "${p.id}": founded year ${fy} is later than the earliest year in its own "years" string ("${p.years}") — founded/closed and years have drifted out of sync`);
      if (cy !== null && cy < boundMax) warn(`promotion "${p.id}": closed year ${cy} is earlier than the latest year in its own "years" string ("${p.years}") — founded/closed and years have drifted out of sync`);
    }
  }
}

// ---------------------------------------------------------------------------
// DOCUMENT LANGUAGE ON THE MATERIAL (THE ECOSYSTEM EXPANSION GAVEL,
// 2026-09-05; CURATION.md v111(c)) — a served document may honestly differ
// from its wing's own language (a guest column in English inside a Polish
// fed, a bilingual board post). Both fields are OPTIONAL on shows.json and
// rps.json rows and ABSENT MEANS THE PROMOTION'S OWN VALUE. They exist so a
// document's language is queryable from the instrument pages; they are NOT
// the source of truth. The PAGE is — the per-wing holdings register is
// disk-derived by design ("a served file cannot exist unlisted"), and most
// supplemental documents (news, staff, rules, column, board, other) have no
// registry row at all. Hence the soft warn on an override that overrides
// nothing: a document-level value exists to record a DIFFERENCE.
// ---------------------------------------------------------------------------
{
  const promoByIdForLang = new Map(promotions.map((p) => [p.id, p]));
  for (const [kind, rows] of [["show", shows], ["rp", rps]]) {
    for (const row of rows) {
      for (const [field, RE, MSG] of [
        ["language", BCP47_RE, 'a well-formed BCP-47 tag (language[-Script][-REGION], e.g. "pl", "pt-BR")'],
        ["country", ISO3166_RE, "an ISO 3166-1 alpha-2 code in upper case (PL, DE, KR)"],
      ]) {
        if (!(field in row)) continue;
        if (typeof row[field] !== "string" || !RE.test(row[field]) || (field === "country" && ISO3166_RESERVED.test(row[field]))) {
          warn(`${kind} "${row.id}": ${field} "${row[field]}" is not ${MSG} (CURATION.md v111(c))`);
        } else if (promoByIdForLang.get(row.promotion)?.[field] === row[field]) {
          soft(`${kind} "${row.id}": ${field} "${row[field]}" is identical to its promotion's own value — a document-level override exists to record a DIFFERENCE; drop it and let it inherit`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// THE PROMOTION-AKA COLLISION GUARD (the Janitor's gavel, 2026-08-23;
// CURATION.md v78) — the collision doctrine applied one level up from the
// character mint guard it mirrors. An `aka` that equals another promotion's
// own `name` or `aka` (case-insensitively, EXACTLY — same bar as 4f's
// entity check) is a HARD FAIL: two held wings would be claiming the same
// label, the linker would have to guess between them, and "when in doubt we
// do not merge" means the registry never gets to state the ambiguity in the
// first place. Deliberately NOT extended to a name/name collision: two rows
// legitimately share a bare acronym today (ewa-extreme and ewa-empire are
// both "EWA"), which the linker already handles by leaving a shared label
// unlinked, and this guard is about akas being ADDED, not about acronyms
// the record itself made ambiguous.
// ---------------------------------------------------------------------------
{
  const labelOwners = new Map(); // lowercased label -> [{id, field, label}]
  for (const p of promotions) {
    const seen = new Set();
    for (const [field, label] of [["name", p.name], ...(Array.isArray(p.aka) ? p.aka.map((a) => ["aka", a]) : [])]) {
      if (typeof label !== "string" || !label.trim()) continue;
      const key = label.trim().toLowerCase();
      if (seen.has(key)) continue; // a row colliding with itself is the soft-warn above
      seen.add(key);
      const list = labelOwners.get(key) ?? [];
      list.push({ id: p.id, field, label });
      labelOwners.set(key, list);
    }
  }
  for (const [, owners] of labelOwners) {
    if (owners.length < 2) continue;
    if (!owners.some((o) => o.field === "aka")) continue; // pre-existing name/name acronym sharing
    const desc = owners.map((o) => `${o.id}.${o.field} ("${o.label}")`).join(" vs ");
    warn(
      `promotion aka collision: ${desc} — an aka may not equal another promotion's own name or aka ` +
      `(CURATION.md's collision doctrine, v77's promotion-level aka: when in doubt we do not merge, and a ` +
      `label two held wings both claim can never be auto-linked to either). Qualify the aka, drop it, or ` +
      `record it as unlinkable on a row that genuinely owns it.`
    );
  }
}

// ---------------------------------------------------------------------------
// THE FANDOM-TITLE COLLISION ADVISORY (the Janitor's directive, 2026-08-24) —
// the soft half of the collision doctrine. Two held rows pointing at ONE
// fandom-wiki article is not automatically wrong: the wiki is a secondary,
// community-authored source that routinely covers a character across every
// fed it worked, and it merges what our own collision doctrine keeps apart
// (one article per handler's character, where we hold one row per fed). So
// this ADVISES rather than fails — a shared title is either that honest
// many-to-one, or it is a name-twin that slipped the cross-check, and only a
// curator reading the article can tell which.
// ---------------------------------------------------------------------------
{
  const fandomOwners = new Map(); // exact title -> [labels]
  const claim = (title, label) => {
    if (typeof title !== "string" || !title.trim()) return;
    const list = fandomOwners.get(title.trim()) ?? [];
    list.push(label);
    fandomOwners.set(title.trim(), list);
  };
  for (const p of promotions) claim(p.fandom, `promotion "${p.id}"`);
  for (const e of [...characters, ...units]) claim(e.fandom, `${e.type === "unit" ? "unit" : "character"} "${e.id}"`);
  for (const [title, owners] of fandomOwners) {
    if (owners.length < 2) continue;
    soft(
      `fandom article "${title}" is claimed by ${owners.length} rows (${owners.join(", ")}) — advisory only: the wiki covers a ` +
      `character across every fed it worked, so one article legitimately serves several of our per-fed rows. Confirm it is that, ` +
      `and not a name-twin the cross-check missed (docs/PROCESS.md's fandom cross-check step).`
    );
  }
}

// THE CAPTION-STALENESS WAVE, extended to promotions (THE PAGE SKELETON
// DOCTRINE, 2026-08-18) — same living-prose discipline as characters/units:
// `caption_asof.evidence` records what a promotion's own caption was
// checked against; this recomputes the same four counts live (wrestlers
// with a tenure here, shows, rps, awards — a promotion's own analogue of
// the six character/unit counts) and soft-warns on material drift. Never a
// hard fail, same reasoning as the character version: a caption reading
// behind the record is a prompt to look, not a defect blocking a push.
{
  const wrestlerCountByPromo = new Map();
  for (const e of [...characters, ...units]) {
    for (const t of e.tenures ?? []) {
      if (!t.promotion) continue;
      wrestlerCountByPromo.set(t.promotion, (wrestlerCountByPromo.get(t.promotion) ?? 0) + 1);
    }
  }
  const showCountByPromo = new Map();
  for (const s of shows) if (s.promotion) showCountByPromo.set(s.promotion, (showCountByPromo.get(s.promotion) ?? 0) + 1);
  const rpCountByPromo = new Map();
  for (const r of rps) if (r.promotion) rpCountByPromo.set(r.promotion, (rpCountByPromo.get(r.promotion) ?? 0) + 1);
  // THE AWARD ENTITIES WAVE: awards.json is now one row per award ENTITY,
  // each carrying a bestowals[] array — count BESTOWALS here (sum of
  // bestowals.length per promotion), not entities, so this evidence count
  // keeps meaning what it always meant (how many ceremonies/results a
  // promotion's caption was checked against) rather than silently
  // shrinking to "how many distinct awards" the moment the shape changed.
  const awardCountByPromo = new Map();
  for (const a of awards) {
    if (!a.promotion) continue;
    const n = (a.bestowals ?? []).length || 1;
    awardCountByPromo.set(a.promotion, (awardCountByPromo.get(a.promotion) ?? 0) + n);
  }
  for (const p of promotions) {
    const asof = p.caption_asof;
    if (!asof || typeof asof !== "object" || !asof.evidence) continue;
    const live = {
      wrestlers: wrestlerCountByPromo.get(p.id) ?? 0,
      shows: showCountByPromo.get(p.id) ?? 0,
      rps: rpCountByPromo.get(p.id) ?? 0,
      awards: awardCountByPromo.get(p.id) ?? 0,
    };
    const materialFields = Object.keys(live).filter((k) => Math.abs((live[k] ?? 0) - (asof.evidence[k] ?? 0)) >= 2);
    if (materialFields.length) {
      soft(`promotion "${p.id}": caption may be stale — ${materialFields.join(", ")} moved by 2+ (last checked ${asof.written ?? "?"}: ${JSON.stringify(asof.evidence)}, now: ${JSON.stringify(live)})`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Unit member references must resolve to a real character (when set).
// ---------------------------------------------------------------------------
const charIds = new Set(characters.map((c) => c.id));
const unitIds = new Set(units.map((u) => u.id));

// ORPHANED-CHARACTER-PAGE GUARD, 2026-08-18 — found live: three wrestler
// pages (bondage-sex-fiend.html, lyle-in-style-wile.html,
// the-rabbi-of-pain.html) were stale leftovers from an entity slug that
// later got renamed (bondage-the-sex-fiend, lyle-wile) or folded into a
// unit's own member list, with the OLD file never deleted. Invisible to
// the rest of this checker (nothing links to an orphan, so the link-
// resolution checks never see it) and invisible to cross-reference.mjs
// (writeFileSync only ever ADDS/overwrites a current entity's own file,
// it never deletes a stale one for an id that stopped existing) — these
// three were missing the ENTIRE pager block (a much older page shape,
// predating THE SELFISH-REVIEWER FEATURE), discovered while chasing an
// unrelated filter-inheritance bug report. Permanent guard: every
// `characters/*.html` file's own basename must resolve to a CURRENT
// character or unit id, or it's dead weight from a rename that was never
// cleaned up — hard fail so a future rename can't leave the same kind of
// orphan behind unnoticed again. (Directory renamed wrestlers/ ->
// characters/ THE FRONT-ENTRANCE RENAME, 2026-08-20 — same guard, same
// discipline, new name.)
{
  const characterFiles = readdirSync(resolve(ROOT, "characters")).filter((f) => f.endsWith(".html"));
  for (const f of characterFiles) {
    const slug = f.slice(0, -5);
    if (!charIds.has(slug) && !unitIds.has(slug)) {
      warn(`characters/${f}: orphaned page — "${slug}" does not resolve to any current character/unit id (a stale leftover from a rename? delete it, or add the current id to data/aliases.json if it's meant to redirect)`);
    }
  }
}
for (const u of units) {
  // unit_kind (THE LOBBY STATS WAVE): tolerant by design — an unset value is
  // fine (nothing invents a classification the record can't support), an
  // unrecognized one is a soft flag, never a hard fail.
  if ("unit_kind" in u && !UNIT_KIND_VALUES.has(u.unit_kind)) {
    soft(`unit "${u.id}": unit_kind "${u.unit_kind}" is not one of tag-team|stable|other`);
  }
  // hook c281 (lane MERGE-HYGIENE, 2026-10-11): a member listed twice. A merge's repoint once turned the retired id into the
  // survivor beside the survivor's own entry; scripts/fixers/merge_hygiene.py now keeps the first. A string member is its id;
  // an object member's key is character_id, else id, else unit_id (merge-batch.py's _mkey). A name-only member has no key.
  {
    const seenMember = new Set();
    for (const m of u.members ?? []) {
      const k = typeof m === "string" ? m : (m && typeof m === "object" ? (m.character_id || m.id || m.unit_id) : null);
      if (!k) continue;
      if (seenMember.has(k)) warn(`unit "${u.id}": member "${k}" is listed twice in members[] — keep the first (a merge's repoint makes this; scripts/fixers/merge_hygiene.py)`);
      seenMember.add(k);
    }
  }
  for (const m of u.members ?? []) {
    if (m.character_id && !charIds.has(m.character_id)) {
      warn(`unit "${u.id}": member "${m.name}" references unknown character_id "${m.character_id}"`);
    }
    if (m.unit_id && !unitIds.has(m.unit_id)) {
      warn(`unit "${u.id}": member "${m.name}" references unknown unit_id "${m.unit_id}"`);
    }
  }
  // ROSTER QA WAVE (THE LAW, user gavel: "full edge-node unit relationships,
  // both directions, everywhere") — a unit lists its members OR says
  // plainly, in data, that they're not recoverable. A missing members
  // array that's just... missing, with nothing explaining why, is exactly
  // the silent gap this rule exists to catch.
  if ((!u.members || u.members.length === 0) && u.membership_unknown !== true) {
    warn(`unit "${u.id}": no members[] and no membership_unknown flag — either list who's in it (sourced) or set membership_unknown: true`);
  }
  if (u.members?.length && u.membership_unknown === true) {
    soft(`unit "${u.id}": has members[] AND membership_unknown: true — drop the flag, the membership isn't unknown anymore`);
  }
}

// ---------------------------------------------------------------------------
// 4. Identity assertions carry a valid evidence grade. An assertion MAY
//    reference other entities via `with: [id, ...]` — required for the
//    assertion-graph consistency check in §4b to see it at all; a "distinct"
//    or "merged" assertion with no `with` is just prose, not a graph edge.
// ---------------------------------------------------------------------------
// "presumed-same" minted at the Janitor's gavel (2026-08-26, the Rocko Daymon
// shape): name + adjacency evidence that clears presumption but not proof —
// the rows stay separate, the graph edge says they are believed one person,
// and a revisit trigger (typically the counterpart wing reaching tier 3)
// belongs in the note. Distinct from "merged" (rows collapsed) and
// "distinct" (believed different people).
const ASSERTIONS = new Set(["merged", "distinct", "presumed-same"]);
for (const e of [...characters, ...units]) {
  for (const id of e.identity ?? []) {
    if (!GRADES.has(id.grade)) warn(`${e.id}: identity assertion has invalid grade "${id.grade}"`);
    if (!id.assertion) warn(`${e.id}: identity assertion missing "assertion" field`);
    else if (!ASSERTIONS.has(id.assertion)) warn(`${e.id}: identity assertion "${id.assertion}" is not "merged", "distinct", or "presumed-same"`);
    for (const other of id.with ?? []) {
      if (!idIndex.has(other)) warn(`${e.id}: identity assertion "with" references unknown entity "${other}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4b. ASSERTION-GRAPH CONSISTENCY CHECK. A "merged" edge (A identity-asserts
//     merged, with: [B]) unions A and B into one group — the same discipline
//     a literal merge already applies by collapsing two rows into one, made
//     explicit for the rarer case where a `with` link is recorded without
//     collapsing the rows. A "distinct" edge forbids its pair from EVER
//     landing in the same group. Transitivity: A=B, B=C, A≠C is a
//     contradiction and fails CI with the specific chain named.
// ---------------------------------------------------------------------------
{
  const parent = new Map();
  function find(x) {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    // path compression
    let cur = x;
    while (parent.get(cur) !== r) { const next = parent.get(cur); parent.set(cur, r); cur = next; }
    return r;
  }
  function union(a, b) { parent.set(find(a), find(b)); }

  const mergedPairs = [];
  const distinctPairs = [];
  for (const e of [...characters, ...units]) {
    for (const id of e.identity ?? []) {
      for (const other of id.with ?? []) {
        if (id.assertion === "merged") mergedPairs.push([e.id, other]);
        if (id.assertion === "distinct") distinctPairs.push([e.id, other]);
      }
    }
  }
  for (const [a, b] of mergedPairs) union(a, b);
  for (const [a, b] of distinctPairs) {
    if (idIndex.has(a) && idIndex.has(b) && find(a) === find(b)) {
      warn(
        `assertion graph inconsistent: "${a}" and "${b}" are asserted DISTINCT but are also ` +
        `connected via a chain of MERGED assertions (a transitivity contradiction — A=B=...=C but A≠C somewhere in the chain). ` +
        `Fix one of the assertions.`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 4b2. THE DEPICTION RECORD (THE ECOSYSTEM EXPANSION GAVEL, the Janitor,
//     2026-09-05; CURATION.md v111(d)) — one more level of specificity under
//     a figure, so a portrayal can say whether it is Hulk Hogan, Hogan's 1984
//     LJN figure, or one creator's CAW of Hogan. A DEPICTION is a NODE: a
//     thing that exists, which a portrayal edge may point at.
//
//     WHERE IT HANGS. `depictions[]` is OPTIONAL on an external-figures row
//     (the memo's own words: "a depiction record under a figure") AND, per
//     the coordinator's ruling of 2026-09-05 on this amendment's first open
//     question, on one of our OWN characters or units — CAW circulation
//     plainly includes CAWs of other federations' ORIGINAL characters, and
//     the depiction simply points at the character that already exists. v78
//     is untouched by that: no figure row is ever seeded from a character's
//     name, because no figure row is minted at all.
//
//     `of` is OPTIONAL and REDUNDANT — nested under its subject, the parent
//     row IS the `of` — but a lane may write it for legibility, in which
//     case it must name its own parent, so the truth can never live in two
//     places and disagree. That is also why the id namespace is one: a
//     depiction id is unique across figures, characters and units together.
//
//     A DEPICTION NOTHING POINTS AT IS FINE and gets no warning. That is the
//     deliberate difference from an external-figures row, which generates no
//     page when unreferenced: the memo's character-commons case is exactly a
//     set of depictions with no portrayal edge yet. Collected is not served.
// ---------------------------------------------------------------------------
// CLOSED set, gaveled: an unrecognised kind is a typo, not a new vocabulary
// item, so this hard-fails where `medium` would soft-warn — the roster_policy
// posture. A sixth kind needs a gavel.
const DEPICTION_KINDS = new Set(["person", "toy-figure", "caw", "drawn", "canon-character"]);
const DEPICTION_ENTRY_KEYS = new Set(["id", "kind", "of", "line_or_maker", "year", "source", "note"]);
const DEPICTION_MAKER_REQUIRED = new Set(["toy-figure", "caw", "drawn"]);
const DEPICTION_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const depictionOwner = new Map(); // depiction id -> its owning row's id
{
  const checkDepictions = (row, where) => {
    if (!("depictions" in row)) return;
    if (!Array.isArray(row.depictions) || !row.depictions.length) {
      warn(`${where} "${row.id}": has "depictions" but it is not a non-empty array (CURATION.md v111(d))`);
      return;
    }
    for (const [i, d] of row.depictions.entries()) {
      const tag = `${where} "${row.id}".depictions[${i}]`;
      if (!d || typeof d !== "object" || Array.isArray(d)) {
        warn(`${tag}: must be an object { id, kind, of?, line_or_maker?, year?, source, note? }`);
        continue;
      }
      for (const k of Object.keys(d)) {
        if (!DEPICTION_ENTRY_KEYS.has(k)) soft(`${tag}: unrecognised key "${k}" — the depiction shape is { id, kind, of?, line_or_maker?, year?, source, note? }; if it needs a new field, document it in docs/SCHEMA.md first`);
      }
      if (typeof d.id !== "string" || !DEPICTION_SLUG_RE.test(d.id)) {
        warn(`${tag}: "id" must be a lowercase hyphenated slug — a depiction id is a label, not a claim, and is never renamed once minted`);
      } else if (depictionOwner.has(d.id)) {
        warn(`${tag}: depiction id "${d.id}" is already used by "${depictionOwner.get(d.id)}" — depiction ids are unique across the WHOLE record, not per subject`);
      } else {
        depictionOwner.set(d.id, row.id);
      }
      if (!DEPICTION_KINDS.has(d.kind)) {
        warn(`${tag}: kind "${d.kind}" is not one of ${[...DEPICTION_KINDS].join("|")} — the five are gaveled (THE ECOSYSTEM EXPANSION, 2026-09-05); a sixth needs a gavel, not a typo`);
      }
      if ("of" in d && d.of !== row.id) {
        warn(`${tag}: "of" is "${d.of}" but this depiction is nested under "${row.id}" — "of" is optional and redundant here; where written it must name its own parent, so the truth can never live in two places and disagree`);
      }
      if (DEPICTION_MAKER_REQUIRED.has(d.kind) && (typeof d.line_or_maker !== "string" || !d.line_or_maker.trim())) {
        warn(`${tag}: kind "${d.kind}" needs "line_or_maker" — a toy figure without its line, or a CAW or a drawing without its maker, names nothing. CAW makers are named by HANDLE or ROLE, never by real name (CURATION.md v74)`);
      }
      if (typeof d.source !== "string" || !d.source.trim()) {
        warn(`${tag}: needs a "source" — a depiction is a claim about a physical or digital artifact, and an unsourced one should be impossible to write, not merely discouraged (the roster_policy_source posture)`);
      }
      if ("year" in d && (!Number.isInteger(d.year) || d.year < 1900 || d.year > 2100)) {
        soft(`${tag}: "year" ${d.year} is not a plausible four-digit year`);
      }
    }
  };
  for (const f of externalFigures) checkDepictions(f, "data/external-figures.json");
  for (const e of [...characters, ...units]) checkDepictions(e, e.type ?? "entity");
}

// ---------------------------------------------------------------------------
// 4c. Entity-vs-tenure shape (SCHEMA-HARDENING WAVE): a character/unit
//     entity carries IDENTITY fields only — display name, aka, identity
//     assertions, portrays, caption, and bookkeeping (id/type/tenures/
//     handler/notes/boozler_rule/relationship/members). Kayfabe BIO facts
//     (height, hometown, alignment, weight, finisher, entrance music, style,
//     ...) belong inside each tenure, since different feds canonically
//     disagreed on them for the same carried-over character. This does not
//     invent or move any data (none exists yet) — it just fences the shape
//     going forward.
// ---------------------------------------------------------------------------
const ENTITY_ALLOWED = new Set([
  "id", "type", "name", "aka", "tenures", "identity",
  "handler", "notes", "boozler_rule", "relationship", "members", "portrays",
  // PORTRAYALS OF REAL PROFESSIONAL WRESTLERS (the Janitor's gavel,
  // 2026-08-24; CURATION.md v78(d)-(e)): "portrayal_of" — an
  // external-figures id, the shared node every portrayal of one real
  // wrestler gathers on. An IDENTITY field by the same reasoning every
  // other one here is: what this character IS, not what one fed booked it
  // as. Its presence is itself the distinguishing facet between a
  // portrayal and an original character (v78(e)), which is why it sits on
  // the entity and never inside a tenure.
  "portrayal_of",
  // hook c116 (the Janitor's D430, "(B) role words"; CURATION.md v78(g)): the role the fed's own fiction gave the real
  // person, where tenures[].roles cannot say it; it sets the depiction placard's words. Checked with portrayal_of below.
  "portrayal_role",
  // THE DEPICTION RECORD (THE ECOSYSTEM EXPANSION GAVEL, 2026-09-05;
  // CURATION.md v111(d)) — "depictions": the coordinator's ruling that a
  // depiction may hang off one of our OWN characters as well as an external
  // figure (a CAW of another fed's original character). An IDENTITY field by
  // the same reasoning portrayal_of is one: what this character IS depicted
  // AS, never what a single fed booked it as, so it sits on the entity and
  // never inside a tenure.
  "depictions",
  // THE CAPTIONS WAVE: "caption" — one hand-drafted museum-label sentence
  // per entity, distinct from `notes` (a curator's working/research note).
  "caption",
  // THE MUSEUM-VOICE SIBLING (THE ECOSYSTEM EXPANSION GAVEL, 2026-09-05,
  // step 2; CURATION.md v112(c), #caption-en) — "caption_en" and its own
  // authorship flag, so a character or unit held in a step-3 non-English
  // wing carries the English sibling without a soft-warn and step 3 never
  // has to re-open this file. Unused on every row held at the gavel.
  "caption_en",
  "caption_en_author",
  // THE LOBBY STATS WAVE (W7): "unit_kind" — tag-team|stable|other, a UNIT-
  // only classification. Named unit_kind rather than the brief's own "type"
  // to avoid colliding with the entity-kind field EVERY entity already
  // carries (character vs. unit) — that field is load-bearing across
  // cross-reference.mjs and can't be repurposed.
  "unit_kind",
  // ROSTER QA WAVE: "membership_unknown" — a unit-only flag, the explicit
  // "we looked, no roster survives" companion to `members` (never both at
  // once; see the check just below where units are validated).
  "membership_unknown",
  // THE CAPTION-STALENESS WAVE, 2026-08-18 (user gavel: captions are living
  // prose, revised as evidence arrives, never frozen at write-time) —
  // "caption_asof": {written, evidence: {tenures, reigns, appearances, rps,
  // awards, relationships}}, the counts a caption's own prose was actually
  // checked against, stamped the day it was last written/reviewed. Bookkeeping,
  // not display prose — see the freshness check below.
  "caption_asof",
  // THE NONHUMAN DATATYPE WAVE, 2026-08-18 (user gavel, gleeful: "the A-
  // Table precedent graduates from prose case-law to data") — "nonhuman":
  // true + optional "species" (free text, the era's own staging: "camel,"
  // "table," "imp," ...). CRITERION is staging-based, not appearance-
  // based: the era itself billed the entity as not a human person
  // (animal/object/creature). A kayfabe-monstrous HUMAN (a demon-gimmick
  // wrestler, say) stays human unless staged as literally not a person —
  // a judgment call made and noted per entity, never guessed wholesale.
  "nonhuman", "species",
  // THE STAGED-GENDER WAVE, 2026-08-19 (the Janitor's own rider, mid-session:
  // "that actually feels like it would be a really interesting datapoint,
  // showing interest in women's wrestling among ewrestling over time") —
  // "staged_gender" + "staged_gender_grade", the same doctrine as
  // nonhuman/species one level down: the CHARACTER's gender as the fed
  // itself staged it (a bio-card field, the show text's own pronouns, a
  // division carve-out like OSW's own Queen of Extreme), never the
  // handler's (CURATION.md's privacy rule — this is never a real person's
  // gender), never inferred from a ring name alone. `staged_gender_grade`
  // is required alongside a real `staged_gender` value, same as species
  // requiring nonhuman: true — "bio-explicit" (a bio card's own field, or
  // explicit division/roster membership) outranks "pronoun-observed" (the
  // served text's own pronouns for the character, nothing more explicit
  // on file). "unknown" is the honest default and needs no grade at all;
  // most of the registry correctly carries neither field yet — this wave
  // seeds the shape and backfills only what one promotion's own accession
  // pass directly verified, not a sitewide sweep.
  "staged_gender", "staged_gender_grade",
  // THE COMMUNAL/PASSED HANDLING WAVE (the Janitor's rider on the same-handler
  // edges item, the Corky Spectre question): "handling" — optional,
  // "communal" (a character created and staged by more than one hand over
  // its own life, owned by no one in particular) or "passed" (a gimmick/
  // mask that changed hands, one owner at a time, in succession) — absent
  // means the ordinary default assumption, a single hand throughout.
  // Node-edge minimalism: no paired grade field: the evidence for a
  // "handling" value lives in the entity's own `notes` (the existing
  // free-text research-note field), the same place any other curator
  // reasoning already lives.
  "handling",
  // THE FANDOM CROSS-CHECK WAVE (the Janitor's directive, 2026-08-24):
  // "fandom" — the EXACT title of this character's own article on the
  // e-wrestling fandom wiki, where one exists and is unambiguous. An
  // outbound pointer, never content: the museum links to the wiki and
  // never serves a word of it. Set ONLY on an exact-unique-title match
  // whose article text names a fed this character is actually tenured in
  // (docs/PROCESS.md's fandom cross-check step); when in doubt, unset,
  // for the same reason the collision doctrine says we do not merge.
  "fandom",
  // THE HOLDER'S-OWN-SITE LINK-OUT (CURATION.md v124, #holders-site-links):
  // "links_out" — outbound {url, label, kind, checked} pointers to this
  // character's or unit's own page on its promotion holder's living site. An
  // outbound pointer like `fandom`, never content; its shape, route match and
  // host rule are checked in 6b2 below.
  "links_out",
]);
const TENURE_BIO_FIELDS = new Set([
  "height", "hometown", "alignment", "weight", "finisher", "entrance_music", "style",
  // THE BIO MINING WAVE (W5b): "manager" joins the set — a kayfabe fact that
  // varies by tenure exactly like the rest (a carried-over character's
  // manager in one fed says nothing about another fed's telling).
  "manager",
  // THE GAME-VALUABLE DATAPOINTS WAVE: "signature_moves" (an array,
  // distinct from the single `finisher` string) joins the set framework-
  // only — the 27 IWF bio pages were re-checked for a distinct signature-
  // move list beyond the finisher and none carried one; the field is ready
  // for the day a source does.
  "signature_moves",
]);
// "source" (a receipt for where a tenure's bio facts came from) and "note"
// (a short caveat — a filename/content mismatch, a conflict between two
// bios for the SAME tenure) are provenance fields, not bio facts themselves,
// so they sit alongside first_seen/last_seen/role rather than inside
// TENURE_BIO_FIELDS.
// "observed_moves" (THE MATCH-PROSE EXTRACTION WAVE, W6) is a TENURE field
// but NOT a kayfabe bio fact — it's an index, not a claim the fed's bio
// asserted: an array of { move, count, sources: [showId,...] }, mined from
// the show corpus's own prose ("X hits Y with the MOVE", "X executes the
// MOVE on Y", ...) rather than declared by a bio/roster page. Kept out of
// TENURE_BIO_FIELDS (whose flat string-per-fact shape and BIO_LABEL
// rendering in cross-reference.mjs don't fit an array) and validated on its
// own shape below.
// "grade" (THE TENURE-DERIVATION WAVE, W7): an evidence grade on the
// TENURE ITSELF, same three values as an identity assertion's own grade —
// distinct from those, since a tenure isn't asserting two entities are the
// same, it's asserting a fed/period relationship exists at all. Exists
// because a mechanically-derived tenure (built from a receipted show
// appearance, never a bio/roster page) needs to say so plainly rather than
// reading identically to a hand-mined, primary-source-bio tenure with no
// hedge visible at all.
// THE FLAT-FILE DATABASE WAVE (W8): four more tenure-scoped registers, all
// mined from the UWF's own recovered CGI roster database (per-username flat
// files the live engine actually read) rather than any prose page:
// "bio" (a verbatim written backstory — a plain string, not an array,
// same shape as declaring it once per tenure the way `finisher` already
// is), "catchphrases" (verbatim quotes, an array of strings — "the register
// the game treasures," per the brief), "record" (win/loss/draw counts AS
// THE SOURCE STATES THEM, never recomputed — an object with fixed numeric
// keys, validated below), and "declared_moves" (an array of { move, desc? }
// — what the wrestler's OWN roster page claimed as their arsenal, kept
// deliberately distinct from `observed_moves`, W6's index of what the show
// corpus's prose actually attributed to them by name; the two registers
// can and do diverge, and that divergence is data, not an error).
const TENURE_ALLOWED = new Set([
  "promotion", "first_seen", "last_seen", "role", "source", "note", "observed_moves", "grade",
  "bio", "catchphrases", "record", "declared_moves",
  // THE RECORDS WAVE, 2026-08-18: "record_declared" — a plain {w,l,d,
  // source?} for a fed's own stated record recovered OUTSIDE the flat-
  // file breakdown shape `record` already carries (a roster page's own
  // bare "W: 1 / L: 0 / D: 0" line, say). Never coexists with `record` on
  // the same tenure — see cross-reference.mjs's own rendering, which
  // prefers `record` when both are somehow present.
  "record_declared",
  // ROSTER QA WAVE (user directive): "roles" — a STRUCTURED, filterable
  // classification per tenure, distinct from `role` (free prose, e.g.
  // "wrestler — the Bum Boozler rule"). A tenure can carry more than one
  // (Lew Spectre: wrestler + authority-figure).
  "roles",
  ...TENURE_BIO_FIELDS,
]);
// TENURE_GRADES — the three registry-wide GRADES plus one the tenure field
// alone carries, `billing` (THE BILLED APPEARANCE, the Janitor's gavel,
// 2026-08-23, CURATION.md v76). A tenure grade has always been a
// DERIVATION marker as much as a provenance one — that is the whole reason
// it exists, so a mechanically-derived tenure doesn't read identically to
// a hand-mined bio one — and `billing` is the weakest honest rung on that
// same ladder: the promotion's own card billed this entity and nothing
// held says they ever worked. The document is a primary source; the
// WORKING relationship it is evidence of is a promise, not a record, and
// the grade says so rather than letting the tenure overclaim. Registry-
// internal, never rendered; it pairs with the `kind: "billed"` appearance
// row that receipts it.
const TENURE_GRADES = new Set([...GRADES, "billing"]);
const RECORD_KEYS = new Set(["single_w", "single_l", "single_d", "tag_w", "tag_l", "tag_d", "cluster_w", "cluster_l", "ppv_w", "ppv_l", "ppv_d", "me_w", "me_l", "me_d"]);
const ROLE_VALUES = new Set(["wrestler", "manager", "referee", "authority-figure", "commentator", "mascot", "other"]);
// THE MUSEUM-VOICE SIBLING (v112(c), 2026-09-05) — built once for the
// caption_en legality test inside the loop below.
const promoByIdForCaptionEn = new Map(promotions.map((p) => [p.id, p]));
for (const e of [...characters, ...units]) {
  for (const k of Object.keys(e)) {
    if (!ENTITY_ALLOWED.has(k)) {
      warn(`${e.id}: entity-level field "${k}" is not an identity field — kayfabe bio facts belong inside tenures (CURATION.md's registry rule)`);
    }
  }
  // THE FANDOM CROSS-CHECK WAVE, entity half — same shape contract the
  // promotion rows carry: the exact article title, never a URL, never a
  // pre-encoded slug. The renderer builds the link.
  if ("fandom" in e && (typeof e.fandom !== "string" || !e.fandom.trim())) {
    warn(`${e.id}: "fandom" must be a non-empty string when present — the exact e-wrestling fandom wiki article title, as the wiki spells it`);
  }
  if (typeof e.fandom === "string" && /^https?:/i.test(e.fandom.trim())) {
    warn(`${e.id}: "fandom" is a URL — the field holds the article TITLE only; the renderer builds the link`);
  }
  // CAPTION_EN on an entity (CURATION.md v112(c), #caption-en). Same shape
  // rules as a promotion's. An entity carries no `language` of its own, so
  // the legality test reads the scenes it actually worked in: the sibling is
  // legal where at least one tenure wing ran in a language other than
  // English. Zero entities carry the field today, so this fires on nothing.
  if ("caption_en" in e) {
    if (typeof e.caption_en !== "string" || !e.caption_en.trim()) {
      warn(`${e.id}: "caption_en" must be a non-empty string when present`);
    }
    const foreignScene = (e.tenures ?? []).some((t) => {
      const wing = promoByIdForCaptionEn.get(t.promotion);
      return wing && wing.language && wing.language !== "en";
    });
    if (!foreignScene) {
      warn(`${e.id}: carries "caption_en" but every wing it worked in runs in English (absence of a wing "language" means "en" — CURATION.md v111(c)) — the English sibling exists only beside a caption written in another language`);
    }
  }
  if ("caption_en_author" in e && e.caption_en_author !== "ai" && e.caption_en_author !== "human") {
    warn(`${e.id}: "caption_en_author" must be "ai" or "human" — got "${e.caption_en_author}"`);
  }
  if (e.caption_en && !("caption_en_author" in e)) {
    soft(`${e.id}: "caption_en" with no "caption_en_author" — absence means "ai", which is the honest default; set "human" only where a person actually wrote it`);
  }
  for (const [i, t] of (e.tenures ?? []).entries()) {
    for (const k of Object.keys(t)) {
      if (!TENURE_ALLOWED.has(k)) soft(`${e.id}.tenures[${i}]: unrecognized tenure field "${k}" — if it's a kayfabe bio fact, add it to TENURE_BIO_FIELDS in registry-validate.mjs`);
    }
    if ("grade" in t && !TENURE_GRADES.has(t.grade)) warn(`${e.id}.tenures[${i}]: grade "${t.grade}" is not one of ${[...TENURE_GRADES].join("|")}`);
    if ("roles" in t) {
      if (!Array.isArray(t.roles) || !t.roles.length) {
        warn(`${e.id}.tenures[${i}]: "roles" must be a non-empty array when present`);
      } else {
        for (const r of t.roles) if (!ROLE_VALUES.has(r)) warn(`${e.id}.tenures[${i}]: role "${r}" is not one of ${[...ROLE_VALUES].join("|")}`);
      }
    }
    if ("observed_moves" in t) {
      if (!Array.isArray(t.observed_moves)) warn(`${e.id}.tenures[${i}]: "observed_moves" must be an array`);
      else for (const [mi, m] of t.observed_moves.entries()) {
        if (!m.move || typeof m.count !== "number" || !Array.isArray(m.sources) || !m.sources.length) {
          warn(`${e.id}.tenures[${i}].observed_moves[${mi}]: needs "move", a numeric "count", and a non-empty "sources" array`);
          continue;
        }
        if (m.sources.length > 3) soft(`${e.id}.tenures[${i}].observed_moves[${mi}] ("${m.move}"): ${m.sources.length} sources — the convention is up to 3 receipts per move`);
        for (const sid of m.sources) {
          if (!showIds.has(sid)) warn(`${e.id}.tenures[${i}].observed_moves[${mi}] ("${m.move}"): source "${sid}" does not resolve to a data/shows.json id`);
        }
      }
    }
    if ("bio" in t && typeof t.bio !== "string") warn(`${e.id}.tenures[${i}]: "bio" must be a string`);
    if ("catchphrases" in t) {
      if (!Array.isArray(t.catchphrases) || !t.catchphrases.every((c) => typeof c === "string")) {
        warn(`${e.id}.tenures[${i}]: "catchphrases" must be an array of strings`);
      }
    }
    if ("record" in t) {
      if (typeof t.record !== "object" || t.record === null || Array.isArray(t.record)) {
        warn(`${e.id}.tenures[${i}]: "record" must be an object`);
      } else {
        for (const k of Object.keys(t.record)) {
          if (!RECORD_KEYS.has(k)) soft(`${e.id}.tenures[${i}].record: unrecognized key "${k}" (expected one of ${[...RECORD_KEYS].join("|")})`);
          else if (typeof t.record[k] !== "number") warn(`${e.id}.tenures[${i}].record.${k}: must be a number`);
        }
      }
    }
    if ("record_declared" in t) {
      const rd = t.record_declared;
      if (typeof rd !== "object" || rd === null || Array.isArray(rd)) {
        warn(`${e.id}.tenures[${i}]: "record_declared" must be an object`);
      } else {
        for (const k of ["w", "l", "d"]) if (k in rd && typeof rd[k] !== "number") warn(`${e.id}.tenures[${i}].record_declared.${k}: must be a number`);
        if ("source" in rd && typeof rd.source !== "string") warn(`${e.id}.tenures[${i}].record_declared.source: must be a string`);
        if (t.record) soft(`${e.id}.tenures[${i}]: carries both "record" and "record_declared" — the two never coexist by convention (cross-reference.mjs renders whichever "record" prefers); pick one`);
      }
    }
    if ("declared_moves" in t) {
      if (!Array.isArray(t.declared_moves)) warn(`${e.id}.tenures[${i}]: "declared_moves" must be an array`);
      else for (const [mi, m] of t.declared_moves.entries()) {
        if (!m.move || typeof m.move !== "string") warn(`${e.id}.tenures[${i}].declared_moves[${mi}]: needs a "move" string`);
      }
    }
  }
  // `portrays`: { figure, grade, note? } pointing at data/external-figures.json
  // — OR, THE ALMASY FUSION FIX (2026-08-18), an ARRAY of the same shape when
  // a single ring name honestly derives from more than one external figure
  // (seymour-almasy fuses FFVIII's Seifer Almasy with FFX's Seymour; neither
  // half is the whole story on its own). A bare single object is still
  // accepted unchanged — plural is opt-in, not a forced migration for every
  // other portrays entry that only ever needed one source.
  if ("portrays" in e) {
    const list = Array.isArray(e.portrays) ? e.portrays : [e.portrays];
    if (!list.length) warn(`${e.id}: "portrays" array is empty`);
    for (const pt of list) {
      if (!pt || typeof pt !== "object" || !pt.figure) {
        warn(`${e.id}: "portrays" entries must be objects { figure, grade }`);
        continue;
      }
      const figure = externalFigures.find((f) => f.id === pt.figure);
      if (!figure) warn(`${e.id}: portrays.figure "${pt.figure}" does not resolve in data/external-figures.json`);
      if (!GRADES.has(pt.grade)) warn(`${e.id}: portrays.grade "${pt.grade}" is not one of primary-source|user-attested|presumed`);
      // `depiction` (THE ECOSYSTEM EXPANSION GAVEL, 2026-09-05; CURATION.md
      // v111(d)) — OPTIONAL. ABSENT MEANS THE FIGURE AS THEMSELVES (kind
      // "person"), which is why every row carrying portrays today is already
      // correct and none was migrated. The same-figure rule below is the
      // invariant that keeps cross-reference.mjs safe: it reads `pt.figure`
      // and nothing else, so a depiction pointer can never move a portrayal
      // off the figure page it already belongs on.
      if ("depiction" in pt) {
        if (typeof pt.depiction !== "string" || !depictionOwner.has(pt.depiction)) {
          warn(`${e.id}: portrays.depiction "${pt.depiction}" does not resolve to a depiction on file (CURATION.md v111(d))`);
        } else if (depictionOwner.get(pt.depiction) !== pt.figure) {
          warn(`${e.id}: portrays.depiction "${pt.depiction}" belongs to "${depictionOwner.get(pt.depiction)}" but this entry portrays "${pt.figure}" — a depiction is always one OF the figure the same entry names`);
        }
      }
      // PORTRAYAL-FORMAT WAVE (user gavel): every portrayal renders sitewide
      // as "Name (Source)" — a figure with no `source` would render a bare
      // name with no parenthetical, quietly breaking that consistency, so
      // it's worth a soft nudge (never a hard fail — the field is honestly
      // optional for a figure that isn't ever rendered via a portrays link).
      if (figure && !figure.source) soft(`data/external-figures.json: "${figure.id}" is portrayed by ${e.id} but carries no "source" — the sitewide "Name (Source)" portrayal format will render it bare`);
    }
  }
  // PORTRAYALS OF REAL PROFESSIONAL WRESTLERS (the Janitor's gavel,
  // 2026-08-24; CURATION.md v78). `portrayal_of` is a BARE external-figures
  // id — the shared node (v78(d)), and the marker (v78(e)) that separates a
  // portrayal from an original character in both directions of the listing
  // filter. It is deliberately NOT a second, parallel edge to `portrays`:
  // `portrays` stays the general external-figure link every kind of
  // namesake uses (a sitcom dad, a tea-advert chimp, a Nintendo enemy), and
  // `portrayal_of` is the narrow v78 FACET laid on top of it for the one
  // case v78 governs — a fed staging a real professional wrestler. Hence
  // the containment check below: a portrayal_of figure must ALSO be on the
  // row's own portrays[], so the general edge is never routed around and
  // the figure page's own reverse list stays whole.
  if ("portrayal_of" in e) {
    if (typeof e.portrayal_of !== "string" || !e.portrayal_of.trim()) {
      warn(`${e.id}: "portrayal_of" must be a non-empty external-figures id string (CURATION.md v78(d))`);
    } else if (depictionOwner.has(e.portrayal_of)) {
      // THE ECOSYSTEM EXPANSION GAVEL, 2026-09-05 (CURATION.md v111(d)):
      // portrayal_of stays a BARE external-figures id (v78(d)). What a fed
      // staged is a portrayal of the FIGURE; the depiction says through what.
      warn(`${e.id}: portrayal_of "${e.portrayal_of}" names a DEPICTION, not a figure — portrayal_of stays a bare external-figures id (CURATION.md v78(d)); the depiction belongs on the matching "portrays" entry instead (v111(d))`);
    } else {
      const figure = externalFigures.find((f) => f.id === e.portrayal_of);
      if (!figure) {
        warn(`${e.id}: portrayal_of "${e.portrayal_of}" does not resolve in data/external-figures.json`);
      } else if (figure.type !== "real-person") {
        // v78's own subject is "a real professional wrestler" — a portrayal
        // of a fictional character or a brand mascot is not a portrayal in
        // this rule's sense, it is a namesake, and namesakes carry a bare
        // `portrays` and nothing more.
        warn(`${e.id}: portrayal_of "${e.portrayal_of}" is type "${figure.type}" — v78 governs portrayals of REAL professional wrestlers only; a fictional or brand namesake carries a bare "portrays" link instead`);
      }
      const portraysList = "portrays" in e ? (Array.isArray(e.portrays) ? e.portrays : [e.portrays]) : [];
      if (!portraysList.some((pt) => pt && pt.figure === e.portrayal_of)) {
        warn(`${e.id}: carries portrayal_of "${e.portrayal_of}" but no matching "portrays" entry for the same figure — portrayal_of is a FACET on the general external-figure link, never a replacement for it (CURATION.md v78(d))`);
      }
      // v78(b): "Portrayal ids are always promotion-qualified
      // (lex-luger-faw), never bare." The qualifier must be one of the
      // row's OWN tenure promotions — a suffix that names some other fed
      // would be worse than no suffix at all.
      const ownPromos = (Array.isArray(e.tenures) ? e.tenures : []).map((t) => t?.promotion).filter(Boolean);
      // hook c220 (D407, D474): a WINGLESS portrayal (no tenure; a roleplay character with no fed) is qualified by the
      // hub it was posted on, so its id must end in some real promotion id; a row with tenures is checked as before.
      const qualifiers = ownPromos.length ? ownPromos : [...promoIds];
      if (!qualifiers.some((pid) => e.id.endsWith(`-${pid}`))) {
        warn(`${e.id}: carries "portrayal_of" but its slug is not promotion-qualified — a portrayal id always ends in its own promotion's id (lex-luger-faw), never bare, so one fed's Lex Luger can never collide with another's (CURATION.md v78(b))`);
      }
    }
  }
  // hook c116 (the Janitor's D430, desk send 2026-10-07: "(B) role words"; CURATION.md v78(g)): `portrayal_role` names the
  // role the fed's own fiction gave the real person where tenures[].roles cannot (a public figure booked as a wrestler, a
  // ring announcer). A controlled value (cross-reference.mjs PORTRAYAL_ROLE_WORDS, kept in sync by hand), on a portrayal only.
  if ("portrayal_role" in e) {
    const PORTRAYAL_ROLES = ["wrestler", "manager", "commentator", "referee", "authority-figure", "ring-announcer", "promoter", "public-figure"];
    if (!PORTRAYAL_ROLES.includes(e.portrayal_role)) warn(`${e.id}: portrayal_role "${e.portrayal_role}" is not one of ${PORTRAYAL_ROLES.join("|")} (CURATION.md v78(g), D430)`);
    if (!("portrayal_of" in e)) warn(`${e.id}: carries "portrayal_role" but no "portrayal_of" — the role words belong to a portrayal's depiction placard only (CURATION.md v78(g), D430)`);
  }
}

// ---------------------------------------------------------------------------
// 4d. Generic-name slug policy (advisory, non-blocking — CURATION.md's generic-names-qualified-at-mint rule).
//     New entities minted with a short, generic gimmick-archetype name
//     should get a promotion/year-qualified slug even without a live
//     collision, since the next contributed collection is very likely to
//     reuse the same generic name. Existing clean slugs are grandfathered —
//     this is a warning, never a mass rename.
// ---------------------------------------------------------------------------
const GENERIC_NAME_WORDS = new Set([
  "wolf", "plague", "fool", "reaper", "demon", "angel", "warrior", "killer",
  "phoenix", "ghost", "spectre", "specter", "hunter", "shadow", "storm",
  "viper", "cobra", "hawk", "raven", "wildcard", "outlaw", "maverick",
  "renegade", "champion", "rookie", "prodigy", "legend", "beast",
]);
// THE DERIVED-QUALIFIER FIX (eWa accession, 2026-08-22): this used to be a
// hand-typed allowlist of promotion ids that went stale the moment a new
// promotion was minted (mwe, wwa, scwf, wce, whq, npw, the-x and both EWAs
// were all missing, so correctly-qualified mints soft-warned). Derived from
// the live promotions.json ids now — a `-<promotion-id>` suffix qualifies.
const YEAR_OR_FED_QUALIFIED = new RegExp("(-\\d{4}$|-(" + promotions.map((p) => p.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length).join("|") + ")$)");
for (const e of [...characters, ...units]) {
  // Strip a leading article (matches the sort-key convention elsewhere in
  // the site) and test the LAST word — "The Plague" and "White Wolf" are
  // both generic-archetype names even though neither is a single bare word.
  const words = e.name.trim().toLowerCase().replace(/^(the|a|an)\s+/, "").split(/\s+/);
  const last = words[words.length - 1];
  if (last && GENERIC_NAME_WORDS.has(last) && !YEAR_OR_FED_QUALIFIED.test(e.id)) {
    soft(`${e.id}: generic archetype name "${e.name}" has an unqualified slug — future NEW entities with this pattern should mint promotion/year-qualified slugs even without a live collision (existing clean slugs like this one are grandfathered, see CURATION.md's generic-names-qualified-at-mint rule)`);
  }
}

// ---------------------------------------------------------------------------
// 4e. external-figures.json: minimal records only (real people, fictional
//     characters, brand mascots that a fan-written character portrays).
//     Never bio-scraped — id/type/name/note/source (+optional provenance)
//     only. `source` (THE PORTRAYAL-FORMAT WAVE, 2026-08-18) is a short
//     citation tag, not a biography — the work the figure is FROM ("FFVIII,"
//     "Hellblazer"), sanctioned onto the allow-list because every portrayal
//     renders sitewide as "Name (Source)"; a real bio field would still
//     trip this warning, on purpose.
// ---------------------------------------------------------------------------
// "musical-act" (2026-08-24, the v78 pass, paying the XWF wing's own flagged
// debt): a band or performer taken as a ring name. Neither a `real-person`
// (an act is a group and a brand, not one figure whose page the museum would
// be making claims about) nor a `brand-mascot` (nobody invented Limp Bizkit
// to sell anything). Deliberate addition, documented in docs/SCHEMA.md's own
// external-figures paragraph — the `community-hub` precedent one file over.
// "real-promotion" (hook c101, 2026-10-07; the Janitor, desk D400: "(a) a
// "real-promotion" type in the external-figures register"; CURATION.md v128):
// a real wrestling company a fan federation's fiction portrays, the node a
// wing's own `portrays` points at. Validated at 4e2 below.
const EXTERNAL_TYPES = new Set(["real-person", "fictional-character", "brand-mascot", "musical-act", "real-promotion"]);
// "depictions" (THE ECOSYSTEM EXPANSION GAVEL, 2026-09-05; CURATION.md
// v111(d)) — the depiction record, validated in full at 4b2 above. It is the
// one field here that is not a minimal-record field about the PERSON: it
// records the artifacts a fed depicted them THROUGH (a toy line, a CAW), so
// it carries no bio and trips no bio-scraping concern.
const EXTERNAL_ALLOWED = new Set(["id", "type", "name", "note", "provenance", "source", "depictions"]);
// A real-promotion row may also carry `years` and `aka` (hook c101): a
// company's names and span are the whole of its record, names and edges only,
// never a history (CURATION.md v100, v128 (e)).
const REAL_PROMOTION_EXTRA = new Set(["years", "aka"]);
for (const f of externalFigures) {
  if (!f.id || !f.name) warn(`external-figures: entry missing "id" or "name": ${JSON.stringify(f).slice(0, 80)}`);
  if (!EXTERNAL_TYPES.has(f.type)) warn(`external-figures "${f.id}": type "${f.type}" is not ${[...EXTERNAL_TYPES].join("|")}`);
  for (const k of Object.keys(f)) {
    if (!EXTERNAL_ALLOWED.has(k) && !(f.type === "real-promotion" && REAL_PROMOTION_EXTRA.has(k))) soft(`external-figures "${f.id}": field "${k}" — records here are meant to stay minimal (id/type/name/note/provenance), no bio-scraping`);
  }
}

// ---------------------------------------------------------------------------
// 4e2. A FEDERATION THAT PORTRAYS A REAL PROMOTION (hook c101, 2026-10-07; the
//      Janitor, desk D400: "(a) a `portrays` field on the wing's row"; D406:
//      "(a) the wing only"; CURATION.md v128 (c), #real-promotion-fan-feds).
//      A promotion row's `portrays` is {figure, grade, source} or an array of
//      that shape: `figure` a real-promotion row, `grade` the ladder, `source`
//      the referent-test receipt in the fed's own words (v103), never the
//      fed's name alone. Absent means not determined. The edge is the WING's
//      only: a title row never carries it (D406: the fed's "WWF Championship"
//      is its own belt), and a character never points at a real promotion (a
//      fed portrays a company; a character portrays a person or a figure).
// ---------------------------------------------------------------------------
{
  const figureTypeOf = new Map(externalFigures.map((f) => [f.id, f.type]));
  const listOf = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
  const PORTRAYS_KEYS = new Set(["figure", "grade", "source", "note"]);
  for (const f of externalFigures) {
    if (f.type !== "real-promotion") continue;
    if (typeof f.note !== "string" || !f.note.trim()) warn(`external-figures "${f.id}": a real-promotion row needs a "note" — one line saying what the institution is, never its history (CURATION.md v100, v128 (e))`);
    if ("years" in f && (typeof f.years !== "string" || !f.years.trim())) warn(`external-figures "${f.id}": "years" must be a non-empty string`);
    if ("aka" in f && (!Array.isArray(f.aka) || f.aka.some((a) => typeof a !== "string" || !a.trim()))) warn(`external-figures "${f.id}": "aka" must be an array of names`);
  }
  for (const p of promotions) {
    if (!("portrays" in p)) continue;
    const list = listOf(p.portrays);
    if (!list.length) warn(`promotion "${p.id}": "portrays" is empty — absent means not determined; an empty list says nothing`);
    const seen = new Set();
    for (const pt of list) {
      if (!pt || typeof pt !== "object" || Array.isArray(pt)) { warn(`promotion "${p.id}": "portrays" entries are objects { figure, grade, source }`); continue; }
      const t = figureTypeOf.get(pt.figure);
      if (!t) warn(`promotion "${p.id}": portrays.figure "${pt.figure}" does not resolve in data/external-figures.json`);
      else if (t !== "real-promotion") warn(`promotion "${p.id}": portrays.figure "${pt.figure}" is type "${t}" — a federation portrays a real PROMOTION (CURATION.md v128 (c)); a person or a fictional figure is portrayed by a character, never by a wing`);
      if (!GRADES.has(pt.grade)) warn(`promotion "${p.id}": portrays.grade "${pt.grade}" is not one of primary-source|user-attested|presumed`);
      if (typeof pt.source !== "string" || !pt.source.trim()) warn(`promotion "${p.id}": portrays "${pt.figure}" needs a "source" — the referent test's receipt in the fed's own words (its self-presentation as the promotion, or its recognition of that promotion's history as its own; CURATION.md v103, v128 (c)), never the fed's name alone`);
      if (seen.has(pt.figure)) warn(`promotion "${p.id}": portrays "${pt.figure}" twice`);
      seen.add(pt.figure);
      for (const k of Object.keys(pt)) if (!PORTRAYS_KEYS.has(k)) soft(`promotion "${p.id}": portrays entry key "${k}" is not one of ${[...PORTRAYS_KEYS].join("|")} — document a new field in docs/SCHEMA.md first`);
    }
  }
  for (const e of [...characters, ...units]) {
    for (const pt of listOf(e.portrays)) {
      if (pt && typeof pt === "object" && figureTypeOf.get(pt.figure) === "real-promotion") warn(`${e.id}: portrays "${pt.figure}", a real-promotion row — a character portrays a person or a figure; a real promotion is portrayed by a wing's own row (promotions.json "portrays", CURATION.md v128 (c))`);
    }
    if (typeof e.portrayal_of === "string" && figureTypeOf.get(e.portrayal_of) === "real-promotion") warn(`${e.id}: portrayal_of "${e.portrayal_of}" names a real-promotion row — v78's facet is for real professional wrestlers, and a promotion is portrayed by a wing (CURATION.md v128 (c))`);
  }
  for (const t of titles) {
    if ("portrays" in t) warn(`title "${t.id}": carries "portrays" — a fan federation's titles stay its own rows with no link to the real belts (the Janitor, desk D406: "(a) the wing only"; CURATION.md v128 (c))`);
  }
}

// ---------------------------------------------------------------------------
// 4f. AKA-COLLISION MINT GUARD (the shiatsu/kitsune incident: a fresh
//     `shiatsu` character was minted whole, duplicating a name already on
//     file as an aka of the already-registered `kitsune` — caught by the
//     Janitor reviewing the wave, not by any gate). Hard-fails when a
//     newly-present entity (an id not yet in HEAD's own committed
//     characters.json/units.json — i.e., minted this working-tree session,
//     the exact moment a mint decision is still live) carries a name or aka
//     that matches, case-insensitively, another existing entity's own name
//     or aka — UNLESS the new entity carries an explicit `identity[]` entry
//     (assertion/grade/note, same shape §4 above already requires) that is
//     either `with: [thatEntity]` or whose own `note` names the collision.
//     A silent name collision at mint time is exactly the no-silent-
//     distinctness gap this closes — CURATION.md's no-auto-merge-and-no-
//     silent-distinctness rule already requires a human verdict for a
//     collision once someone notices it; this makes sure one gets noticed.
//     Uses `git show HEAD:...` to know what's "new" — the same working-tree-
//     vs-HEAD boundary the gates→commit workflow already runs on, so a mint
//     is always caught before it ships, never after. Falls back to skipping
//     silently (not failing) outside a git repo or on the very first commit,
//     since there's no baseline to diff against yet.
// ---------------------------------------------------------------------------
{
  let headCharacters = null, headUnits = null;
  try {
    const { execFileSync } = await import("node:child_process");
    const readAtHead = (name) => {
      // PERFECTION WAVE A FIX (2026-08-21): no `maxBuffer` here meant
      // Node's own 1MB default silently truncated this call the moment
      // data/characters.json (1.5MB+ and growing) crossed it — execFileSync
      // threw ENOBUFS, the surrounding try/catch swallowed it exactly like
      // "not a git repo," and the WHOLE aka-collision mint guard (4f, and
      // 4g below) had been silently never running, registry-wide, for however
      // long the file's been over the threshold. 64MB is comfortable
      // headroom past any plausible near-term registry size.
      const raw = execFileSync("git", ["show", `HEAD:data/${name}.json`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
      const parsed = JSON.parse(raw);
      const key = Object.keys(parsed).find((k) => k[0] !== "_" && Array.isArray(parsed[k]));
      return key ? parsed[key] : [];
    };
    headCharacters = readAtHead("characters");
    headUnits = readAtHead("units");
  } catch {
    // Not a git repo, no HEAD commit yet, or the file didn't exist at HEAD
    // (e.g. a brand-new data file) — nothing to diff against, skip quietly.
  }

  if (headCharacters !== null && headUnits !== null) {
    const headIds = new Set([...headCharacters, ...headUnits].map((e) => e.id));
    const norm = (s) => (s ?? "").trim().toLowerCase();

    // ---------------------------------------------------------------------
    // 4g. THE DECORATED-AKA GAP, CLOSED (WARNING, not a hard fail).
    //     `docs/PROCESS.md`'s Registry section and `docs/SCHEMA.md`'s own
    //     `aka[]` entry both documented this as a known, unfixed gap since
    //     the fleet era: 4f above is an EXACT match only (case-insensitive,
    //     nothing more) — it never caught a new `rabbi-of-pain-uwf` mint
    //     against the already-registered `rabbi-mort-schwartzman`, the same
    //     character under two DECORATED names that read as obviously the
    //     same person in fiction without literally equaling or containing
    //     each other as raw strings. `normDecorated()` closes that gap:
    //     lowercase, strip quotes/punctuation, drop one leading article
    //     ("the"/"a"/"an"), collapse whitespace — then check CONTAINMENT
    //     BOTH DIRECTIONS (a new entity's own normalized label containing,
    //     or contained by, an existing entity's own normalized label)
    //     against every entity in the registry, every shard, characters and
    //     units alike (headNameIndex/headDecoratedList already span all of
    //     it). Deliberately a `soft()` advisory, never a `warn()` hard
    //     fail: legitimate similar names exist at this scale (a short
    //     generic archetype two unrelated feds both landed on, a real
    //     coincidence the no-auto-merge rule already protects) and a
    //     decorated-substring match is real evidence of a POSSIBLE
    //     duplicate, not proof of one — a human check, not a block. A
    //     5-character floor on the normalized string keeps short
    //     initialisms/acronyms ("AK," "DJ," "CK") from generating noise as
    //     a trivial substring of half the registry.
    // ---------------------------------------------------------------------
    const normDecorated = (s) => (s ?? "")
      .toLowerCase()
      .replace(/["'"'‘’“”`]/g, "")
      .replace(/[.,!?;:()]/g, "")
      .replace(/^(the|a|an)\s+/, "")
      .replace(/\s+/g, " ")
      .trim();

    // Every (lowercased name/aka) -> [ids] as of HEAD — the "existing at
    // mint time" baseline a newly-present entity's own name/aka is checked
    // against. headDecoratedList is the same baseline, normalized for 4g's
    // substring scan.
    const headNameIndex = new Map();
    const headDecoratedList = [];
    for (const e of [...headCharacters, ...headUnits]) {
      for (const label of [e.name, ...(e.aka ?? [])]) {
        const key = norm(label);
        if (key) {
          const list = headNameIndex.get(key) ?? [];
          list.push(e.id);
          headNameIndex.set(key, list);
        }
        const dkey = normDecorated(label);
        if (dkey.length >= 5) headDecoratedList.push({ id: e.id, label, normDecorated: dkey });
      }
    }

    // A RENAME IS NOT A MINT (2026-08-24, the v78 pass). An id that
    // aliases.json carries forward from an id that existed at HEAD is the
    // SAME entity under a new slug — `hulk-hogan` -> `hulk-hogan-nfw`,
    // bringing a pre-v78 portrayal up to v78(b)'s promotion-qualified bar.
    // The guard above sees only "an id not in HEAD" and so read the rename
    // as a fresh mint colliding with its own former self, and demanded an
    // identity[] entry asserting a relationship to an entity that no longer
    // exists. aliases.json is the registry's own record of which ids are
    // the same thing, so it is the right place to read the answer from.
    const renamedFrom = new Map();
    for (const a of aliases) {
      if (a?.from && a?.to && headIds.has(a.from) && !headIds.has(a.to)) renamedFrom.set(a.to, a.from);
    }

    // 2026-09-30 (takedown #2, preflight 225): a TAKEDOWN rename carries NO alias by law (CURATION #no-forward-rename), so
    // renamedFrom can't see it, and the new id read as a fresh mint colliding with its own retired HEAD self. A HEAD entity
    // that is gone from the live registry can't be duplicated: preflight's fix-lost-records restores every HEAD record that
    // isn't deliberately retired (the workshop's retired-ids.tsv), so "gone" here means "retired on purpose". Compare only
    // against entities that still exist.
    const liveIds = new Set([...characters, ...units].map((x) => x.id));
    for (const e of [...characters, ...units]) {
      if (headIds.has(e.id)) continue; // not new this session
      const priorSelf = renamedFrom.get(e.id) ?? null;
      const ownLabels = [e.name, ...(e.aka ?? [])];
      const ownNormLabels = ownLabels.map(norm).filter(Boolean);

      // 4f. EXACT collisions (hard fail).
      const collisions = new Set();
      for (const label of ownNormLabels) {
        for (const otherId of headNameIndex.get(label) ?? []) {
          if (otherId !== e.id && otherId !== priorSelf && liveIds.has(otherId)) collisions.add(otherId);
        }
      }

      // 4g. DECORATED/normalized substring collisions (soft warn) — skips
      // any (entity, id) PAIR 4f already caught via the raw exact match
      // (collisions.has(otherId)), but deliberately does NOT skip a pair
      // whose normalized forms are equal-but-not-raw-equal: that's exactly
      // the real rabbi-of-pain-uwf/rabbi-mort-schwartzman incident (an aka
      // stored with literal decorating quote marks, "\"The Rabbi of
      // Pain\"", which normDecorated()'s quote-stripping resolves to the
      // same string as the plain name/aka it duplicates but norm()'s bare
      // case-fold never would) — equality after normalization is the
      // containment check's own degenerate case, not an exemption from it.
      const decoratedCollisions = new Map(); // otherId -> ["own"/"other" label pairs]
      for (const ownLabel of ownLabels) {
        const ownD = normDecorated(ownLabel);
        if (ownD.length < 5) continue;
        for (const { id: otherId, label: otherLabel, normDecorated: otherD } of headDecoratedList) {
          if (otherId === e.id || otherId === priorSelf || collisions.has(otherId) || !liveIds.has(otherId)) continue;
          if (ownD.includes(otherD) || otherD.includes(ownD)) {
            const list = decoratedCollisions.get(otherId) ?? [];
            list.push(`"${ownLabel}" / "${otherLabel}"`);
            decoratedCollisions.set(otherId, list);
          }
        }
      }

      const allCollisionIds = new Set([...collisions, ...decoratedCollisions.keys()]);
      if (!allCollisionIds.size) continue;

      const hasIdentityNote = (e.identity ?? []).some((id) => {
        if (typeof id.note !== "string" || !id.note.trim()) return false;
        if ((id.with ?? []).some((w) => allCollisionIds.has(w))) return true;
        // A note that at least names one of the colliding entities' own ids
        // counts too, for the case a curator wrote the note before `with`
        // was populated.
        return [...allCollisionIds].some((otherId) => id.note.includes(otherId));
      });
      if (hasIdentityNote) continue;

      if (collisions.size) {
        warn(
          `${e.id}: newly-minted entity's name/aka collides with existing ` +
          `entity/entities [${[...collisions].join(", ")}] but carries no ` +
          `identity[] entry (assertion/grade/note, with: [...]) acknowledging ` +
          `it — mint an aka-collision guard note (see CURATION.md's no-auto-` +
          `merge-and-no-silent-distinctness rule) or confirm this is really a ` +
          `new, distinct entity and record that explicitly.`
        );
      }
      for (const [otherId, pairs] of decoratedCollisions) {
        soft(
          `${e.id}: newly-minted entity's name/aka is a normalized substring ` +
          `match against existing entity "${otherId}"'s own name/aka (${pairs.join(", ")}) ` +
          `— possible duplicate under a decorated/nickname aka (the ` +
          `aka-collision mint guard's decorated-aka gap, CURATION.md's v45 ` +
          `changelog entry; the rabbi-of-pain-uwf / rabbi-mort-schwartzman ` +
          `near-miss is the worked precedent). Check by hand; if it's really ` +
          `the same character, merge or add an identity[] note. If it's a ` +
          `real coincidence, an identity[] note recording that (with: ` +
          `["${otherId}"]) silences this on future runs.`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4h. THE STANDING NEAR-NAME SWEEP (QA-REGISTRY-AUDIT, 2026-08-28) — the
//     permanent, full-corpus twin of §4g above. §4g only ever compares a
//     NEWLY-minted entity (this working-tree session, vs. committed HEAD)
//     against the rest of the registry — the moment a mint lands and gets
//     committed, its own decorated-aka collisions go permanently invisible
//     to every later run, because nothing re-checks the ALREADY-committed
//     registry against itself. That's exactly how cwfpro's ~18 and the
//     UWOW-constellation's ~4 team-vs-unrelated-character decorated-aka
//     pairs sat unacknowledged for a full accession cycle: real at mint
//     time, silently uncatchable afterward. This check re-runs the same
//     normalized-containment logic (`normDecorated`, the 5-char floor,
//     identity[] `with`/`note` silencing) across EVERY character/unit pair
//     on file, every run, forever — soft-warn only, same non-blocking
//     posture as §4g itself (a short generic name two unrelated feds both
//     landed on is common and expected at this scale, per the
//     generic-names-qualified-at-mint rule; this is a possible-duplicate
//     flag for a human to judge, never a merge and never a block).
//     Deliberately summarized rather than one warning per pair (the
//     `style-families`/`stipulation-families` "N distinct, first few: ..."
//     convention below) — thousands of individual lines would bury the
//     signal the same way an un-triaged flood always does; the full ranked
//     list belongs in a research digest's own audit pass, not the gate's
//     own console output.
// ---------------------------------------------------------------------------
{
  const norm2 = (s) => (s ?? "").trim().toLowerCase();
  const normDecorated2 = (s) => (s ?? "")
    .toLowerCase()
    .replace(/["'"'‘’“”`]/g, "")
    .replace(/[.,!?;:()]/g, "")
    .replace(/^(the|a|an)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  const allEntities = [...characters, ...units];
  const decoratedList = [];
  for (const e of allEntities) {
    for (const label of [e.name, ...(e.aka ?? [])]) {
      if (!label) continue;
      const d = normDecorated2(label);
      if (d.length >= 5) decoratedList.push({ id: e.id, label, d });
    }
  }
  // Bucket by normalized-decorated string so equal-or-containing pairs are
  // found without a full O(labels^2) scan of raw strings twice over.
  const byD = new Map();
  for (const l of decoratedList) {
    const list = byD.get(l.d) ?? [];
    if (!list.some((x) => x.id === l.id)) list.push(l);
    byD.set(l.d, list);
  }
  const uniqueD = [...byD.keys()];
  const ackIndex = new Map();
  for (const e of allEntities) {
    const set = new Set();
    for (const idn of e.identity ?? []) {
      for (const w of idn.with ?? []) set.add(w);
      if (typeof idn.note === "string") {
        for (const m of idn.note.matchAll(/[a-z0-9]+(?:-[a-z0-9]+)+/g)) set.add(m[0]);
      }
    }
    if (set.size) ackIndex.set(e.id, set);
  }
  const acknowledged = (a, b) => (ackIndex.get(a)?.has(b)) || (ackIndex.get(b)?.has(a));

  const pairKeys = new Set();
  const samples = [];
  for (let i = 0; i < uniqueD.length; i++) {
    const a = uniqueD[i];
    for (let j = i + 1; j < uniqueD.length; j++) {
      const b = uniqueD[j];
      if (a === b) continue; // exact-normalized equality is §4f/§4g's own job at mint time
      if (!(a.includes(b) || b.includes(a))) continue;
      for (const oa of byD.get(a)) {
        for (const ob of byD.get(b)) {
          if (oa.id === ob.id) continue;
          if (acknowledged(oa.id, ob.id)) continue;
          const key = [oa.id, ob.id].sort().join("|");
          if (pairKeys.has(key)) continue;
          pairKeys.add(key);
          if (samples.length < 15) samples.push(`${oa.id} ("${oa.label}") / ${ob.id} ("${ob.label}")`);
        }
      }
    }
  }
  if (pairKeys.size) {
    soft(
      `THE STANDING NEAR-NAME SWEEP: ${pairKeys.size} unacknowledged decorated-aka ` +
      `substring-containment pair(s) across the full character/unit registry ` +
      `(possible duplicates or coincidental generic-name collisions — a human ` +
      `check, never a merge; silence a real coincidence with an identity[] ` +
      `"distinct" entry naming the other id, per CURATION.md's no-auto-merge-` +
      `and-no-silent-distinctness rule). First ${samples.length}: ${samples.join("; ")}` +
      (pairKeys.size > samples.length ? `; ... and ${pairKeys.size - samples.length} more (see a dedicated near-dup audit pass for the full ranked list)` : "")
    );
  }
}

// ---------------------------------------------------------------------------
// 5. Review queue is well-formed: candidates reference real entities, status
//    is a known value, and (the whole point of the queue) a "distinct"
//    verdict must not still be sitting in an "open" row.
// ---------------------------------------------------------------------------
// "deferred" minted at the Janitor's gavel (2026-08-26): parked on a named revisit trigger, stated in the note.
const STATUS = new Set(["open", "distinct", "merged", "dismissed", "deferred"]);
for (const [i, q] of reviewQueue.entries()) {
  if (!q.type || !q.name || !q.candidates || !q.status) warn(`review-queue[${i}]: missing required field(s)`);
  if (q.status && !STATUS.has(q.status)) warn(`review-queue[${i}] ("${q.name}"): unknown status "${q.status}"`);
  for (const cand of q.candidates ?? []) {
    if (!idIndex.has(cand)) warn(`review-queue[${i}] ("${q.name}"): candidate "${cand}" does not resolve to any entity`);
  }
}

// ---------------------------------------------------------------------------
// 6. aliases.json: array of { from, to } old-slug -> new-slug records; every
//    "to" must resolve (the escape hatch only ever points at a real entity).
// ---------------------------------------------------------------------------
// 6a. THE NO-CROSS-PROMOTION-PORTRAYAL-MERGE GUARD (CURATION.md v78(c),
//     the Janitor, 2026-08-24, verbatim: "One fed's Lex Luger and another's
//     are different characters portraying the same figure; the
//     external-figures entry is their only shared node. The three-Spectres
//     doctrine, applied to portrayals, with NO DISCRETIONARY ESCAPE
//     HATCH."). aliases.json is the one file in the registry that can
//     perform a merge after the fact — a retired id pointed at a survivor —
//     so it is the one place that clause has to be enforced, and it is
//     enforced HARD, with no `merge_ok`-style override, because the gavel
//     declined to give itself one.
//
//     What is detectable here matters: a merged-away `from` id no longer
//     resolves to a row, so its own portrayal_of can't be read back. The
//     signature that CAN be read is the one a cross-promotion portrayal
//     merge always leaves — a promotion-qualified `from` whose qualifier
//     names a DIFFERENT fed than the portrayal `to` belongs to. That is
//     exactly the shape v78(b) mints portrayals in, which is half of why it
//     mints them that way.
//
//     Deliberately NOT caught, because it is legitimate: a BARE `from`
//     pointing at a portrayal (`hulk-hogan` -> `hulk-hogan-nfw`). That is a
//     pre-v78 mint being brought up to the v78(b) qualified-slug bar, the
//     opposite of a merge — one character keeping one identity and gaining
//     a suffix.
const portrayalPromoOf = (id, entity) => {
  const tenurePromos = (Array.isArray(entity?.tenures) ? entity.tenures : []).map((t) => t?.promotion).filter(Boolean);
  return tenurePromos.find((pid) => id.endsWith(`-${pid}`)) ?? null;
};
// idIndex maps id -> entity KIND, which is all every other check here needs;
// this guard needs the row itself, so it indexes the two entity types that
// can carry a portrayal_of.
const rowIndex = new Map();
for (const e of [...characters, ...units]) if (e?.id) rowIndex.set(e.id, e);
for (const [i, a] of aliases.entries()) {
  if (!a.from || !a.to) { warn(`aliases[${i}]: needs "from" and "to"`); continue; }
  if (!idIndex.has(a.to)) warn(`aliases[${i}]: "to" target "${a.to}" does not resolve to any entity`);
  const target = rowIndex.get(a.to);
  if (!target || !target.portrayal_of) continue;
  const toPromo = portrayalPromoOf(a.to, target);
  // The `from` side: read its own promotion qualifier off the registry if
  // it somehow still resolves (a live double-mint), otherwise off the
  // suffix, which is all a retired id leaves behind.
  const fromEntity = rowIndex.get(a.from);
  const fromPromo = fromEntity
    ? portrayalPromoOf(a.from, fromEntity)
    : ([...promoIds].filter((pid) => a.from.endsWith(`-${pid}`)).sort((x, y) => y.length - x.length)[0] ?? null);
  if (fromPromo && toPromo && fromPromo !== toPromo) {
    warn(`aliases[${i}]: "${a.from}" -> "${a.to}" would merge a portrayal across promotions (${fromPromo} into ${toPromo}) — "${a.to}" carries portrayal_of "${target.portrayal_of}". One fed's portrayal of a wrestler and another fed's are DIFFERENT CHARACTERS; the external-figures entry is their only shared node (CURATION.md v78(c), no escape hatch). If the two ids are genuinely one character, the thing to revisit is whether either is a portrayal at all.`);
  }
  if (fromEntity && fromEntity.portrayal_of && fromPromo === toPromo && fromPromo) {
    soft(`aliases[${i}]: both "${a.from}" and "${a.to}" carry portrayal_of and both resolve live — a same-promotion portrayal fold is not barred by v78(c), but check it is a duplicate mint rather than two staged characters`);
  }
}

// ---------------------------------------------------------------------------
// 6b. memorials.json (if present): in-memoriam entries. Every linked
//     character/unit id must resolve to a real registry entity (field is
//     `characters`, holding character AND unit ids alike).
// ---------------------------------------------------------------------------
// THE MEMORIAL LINK-OUT (the Janitor, 2026-09-24, on Mike Sanzone and the
// living Empire Pro Wrestling: "We don't serve it but we should link to it";
// CURATION.md v119, #memorial-links-out) — `links_out[]` is forum_accounts'
// {url, label} shape pointed the OTHER way: out of the museum, at a living
// federation the dead-only rule means it will never hold. Four things are
// enforced here rather than remembered, because a memorial page is the one
// surface where a wrong link costs the most:
//   1. an http(s) scheme (a bare host renders as a broken relative href, the
//      same defect the frontier's own url check exists for);
//   2. a non-empty label — the living institution's own name, plainly;
//   3. NEVER a museum-hosted address. A museum-hosted account is exactly what
//      forum_accounts is for, and the two fields must not blur: one says "his
//      own account, here", the other says "them, out there".
//   4. the target must be an address a VERIFIED-ALIVE frontier row already
//      carries. This is the guard that matters. The frontier is where liveness
//      is actually checked and re-checked on a cadence (v55, v84), so a
//      memorial can only ever point somewhere the ledger has already verified
//      is alive — and a link that rots is a frontier row that changed status,
//      which the re-check sweep is built to catch.
// Compared by HOST (the Janitor, desk D395, 2026-10-06: "memorial links match
// by host"; hook c95), the comparison v124(d) already makes for record
// link-outs: the link's host (lowercased, www. dropped) must be the host of a
// "verified-alive" frontier row, or a subdomain of one (the row's host as its
// registrable parent). A held or unverified row on the same host never
// satisfies it. The scheme itself is still required on the memorial's own
// value by (1).
const MUSEUM_HOSTS = (() => {
  const hosts = new Set(["fw-museum.org"]); // the named crawler's own home (v98)
  try {
    const cfg = JSON.parse(readFileSync(resolve(DATA, "site-config.json"), "utf8"));
    if (typeof cfg.site_url === "string") hosts.add(new URL(cfg.site_url).hostname.toLowerCase().replace(/^www\./, ""));
  } catch { /* no site-config, or no site_url: the crawler host alone still holds */ }
  return hosts;
})();
const isMuseumHost = (host) => [...MUSEUM_HOSTS].some((h) => host === h || host.endsWith(`.${h}`));
// v124(d)'s hostOf / aliveHosts / notAliveHosts / aliveCover, mirrored line for
// line (v124's own live inside its block scope below; hook c95, D395).
const memorialHostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; } };
const aliveFrontierHosts = new Map();     // host -> the verified-alive row's own name
const notAliveFrontierHosts = new Map();  // host -> that row's status (held, unverified, …)
for (const r of (frontier && Array.isArray(frontier.rows) ? frontier.rows : [])) {
  if (!r || typeof r.url !== "string") continue;
  const h = memorialHostOf(r.url);
  if (!h) continue;
  if (r.status === "verified-alive") { if (!aliveFrontierHosts.has(h)) aliveFrontierHosts.set(h, r.name ?? r.url); }
  else if (!notAliveFrontierHosts.has(h)) notAliveFrontierHosts.set(h, r.status ?? "(no status)");
}
// hook c262 (the workshop's approved memorial rewrites of 10-10, the Janitor 2026-10-10: "an outbound link to
// https://en.wikipedia.org/wiki/Daniel_Quirk on his memorial"): a REFERENCE link-out, an article about the memorial's own
// subject on a reference work, is not a living federation: it needs no frontier row (v119(b) clause 4) and renders as
// "Further reading:", never "Still online:". Clauses 1-3 still apply. Kept identical in registry-validate.mjs and cross-reference.mjs.
const MEMORIAL_REFERENCE_HOSTS = new Set(["en.wikipedia.org"]);
const isMemorialReferenceLink = (u) => { try { const x = new URL(u); return x.protocol === "https:" && MEMORIAL_REFERENCE_HOSTS.has(x.hostname.toLowerCase()) && x.pathname.startsWith("/wiki/"); } catch { return false; } };
const aliveFrontierCover = (host) => {
  if (aliveFrontierHosts.has(host)) return { on: host, name: aliveFrontierHosts.get(host) };
  for (const [h, name] of aliveFrontierHosts) if (host.endsWith(`.${h}`)) return { on: h, name };
  return null;
};
for (const [i, m] of memorials.entries()) {
  if (!m.id || !m.name || !m.years) warn(`memorials[${i}]: needs "id", "name", and "years"`);
  for (const [j, a] of (m.forum_accounts ?? []).entries()) {   // 2026-09-23: the subject's own account on a museum-hosted forum
    if (!a || typeof a.url !== "string" || !/^https:\/\/forum\.ewmuseum\.org\/u\/[^\s]+$/.test(a.url) || !a.label)
      warn(`memorials[${i}].forum_accounts[${j}]: needs {url: "https://forum.ewmuseum.org/u/<username>", label}`);
  }
  // v119(b): the four clauses, in the order the gavel states them.
  for (const [j, a] of (m.links_out ?? []).entries()) {
    const where = `memorials[${i}] ("${m.name}").links_out[${j}]`;
    if (!a || typeof a.url !== "string" || !a.url.trim() || typeof a.label !== "string" || !a.label.trim()) {
      warn(`${where}: needs {url, label} — the living institution's own address and its own name (CURATION.md v119(b))`);
      continue;
    }
    if (!/^https?:\/\/[^\s]+$/i.test(a.url)) {
      warn(`${where}: "url" needs an http(s):// scheme and no whitespace (got "${a.url}") — a bare host renders as a broken relative href (CURATION.md v119(b))`);
      continue;
    }
    const host = (() => { try { return new URL(a.url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; } })();
    if (!host) {
      warn(`${where}: "url" does not parse as a URL ("${a.url}")`);
      continue;
    }
    if (isMuseumHost(host)) {
      warn(`${where}: "${a.url}" is a MUSEUM-HOSTED address — links_out points OUT, at a living federation the museum will never hold; the subject's own account on a museum-hosted forum is forum_accounts' job (CURATION.md v119(b))`);
      continue;
    }
    if (isMemorialReferenceLink(a.url)) continue;   // hook c262: a reference article, not a federation (clause 4 does not apply)
    const cover = aliveFrontierCover(host);
    if (!cover) {
      const other = notAliveFrontierHosts.get(host);
      warn(`${where}: "${a.url}" is on a host that no "verified-alive" frontier row covers${other ? `, and the only frontier row on ${host} is "${other}" — a held or unverified row NEVER satisfies this clause` : ""} — a memorial never links to a host nobody checked; add or update the frontier row first, and the ledger's own re-check cadence then keeps the link honest (CURATION.md v119(b), matched by HOST per D395 as v124(d) does, the dead-only rule)`);
      continue;
    }
    if (notAliveFrontierHosts.has(host)) {
      soft(`${where}: ${host} is covered by the "verified-alive" frontier row on ${cover.on} ("${cover.name}") and ALSO carries a "${notAliveFrontierHosts.get(host)}" row of its own — v124(d)'s own case: the older row is a dead fed that lived on this domain before its present holder had it. The link stands on the alive row; the two ledger rows should say which is which.`);
    }
    // Deliberately NOT ratcheted: a new LAW_RULES key needs a baseline rewrite
    // (`npm run law:baseline`), which is a Janitor-or-coordinator act. The hard
    // warn above is this gavel's mechanical check at the gate (v115).
  }
  // hook c281 (lane MERGE-HYGIENE, 2026-10-11): an id twice in a memorial's characters[] (a merge's repoint made one, wave
  // CHAD-DUPREE-MERGE; scripts/fixers/merge_hygiene.py now keeps the first).
  {
    const seenChar = new Set();
    for (const cid of m.characters ?? []) {
      if (seenChar.has(cid)) warn(`memorials[${i}] ("${m.name}"): character/unit "${cid}" is listed twice in characters[] — keep the first`);
      seenChar.add(cid);
    }
  }
  for (const cid of m.characters ?? []) {
    if (!charIds.has(cid) && !unitIds.has(cid)) {
      warn(`memorials[${i}] ("${m.name}"): character/unit "${cid}" does not resolve to any entity`);
    }
  }
  // THE MEMORIAL PAGES WAVE (2026-08-19): every memorial gets its own
  // generated /memorials/<id>.html page (scripts/cross-reference.mjs) —
  // same "generate, don't hand-edit" discipline as titles/awards/wrestlers.
  if (m.id && !existsSync(resolve(ROOT, "memorials", `${m.id}.html`))) {
    warn(`memorials[${i}] ("${m.name}"): no /memorials/${m.id}.html page exists — run \`npm run refresh:links\` to generate it`);
  }
  // THE MEMORIAL REGISTER (CURATION.md v65): a memorial page carries
  // facts, links, images, and dedication only — never a quote from a
  // working conversation. `verification` (a Janitor-welcome quote plus a
  // real-world verification URL, once rendered on joe-smallze's own page)
  // is retired from this schema outright; the fact belongs in
  // CURATION.md's own changelog, never on a served page.
  if (m.verification) {
    warn(`memorials[${i}] ("${m.name}"): carries a "verification" field — retired by THE MEMORIAL REGISTER (CURATION.md v65); move the fact to CURATION.md's own changelog and delete it here`);
  }
}

// ---------------------------------------------------------------------------
// 6b2. THE HOLDER'S-OWN-SITE LINK-OUT (the Janitor, 2026-09-27: "I feel like
//      we should link to promotions, bios, etc on Argyle's site in the
//      placards"; CURATION.md v124, #holders-site-links) — v119's
//      `links_out[]`, a memorials-only field until this gavel, now rides a
//      promotion, show, character, unit, title and rp row too, wherever the
//      promotion's own holder runs a living site of it.
//
//      THE MEMORIAL CHECKS ABOVE ARE UNTOUCHED, deliberately: v119 stands
//      word for word, a memorial's link is still {url, label}, and its
//      frontier clause is still host AND path. This block is purely additive
//      and borrows nothing from 6b but the two things 6b already built for
//      exactly this job — isMuseumHost(), and MUSEUM_HOSTS behind it.
//
//      What is enforced, in the order v124 states it:
//        (b) THE SHAPE — {url, label, kind, checked}, all four present; an
//            http(s) scheme with no whitespace; a URL that parses; never a
//            museum-hosted address (a museum-hosted account is
//            forum_accounts' job, and the two must not blur); a non-empty
//            label; a `kind` from the documented set; an ISO `checked` that
//            is not in the future (a date an address was verified is read off
//            the clock, never estimated).
//        (b) THE kind<->url ROUTE MATCH. `kind` is the route family the URL
//            itself uses, which is the whole reason the gavel stores it:
//            `promotion` is the site root and carries no route segment, and
//            every other kind must be the URL path's own first segment. A
//            wrong label is invisible to a validator; a wrong route is not.
//        (d) THE HOST RULE. The target's host must be covered by a
//            `verified-alive` frontier row — that exact host, or its
//            registrable parent domain. The frontier's own row IS the parent
//            here: a target passes on a parent row only when its host is a
//            sub-domain of that row's host, so no public-suffix list is
//            guessed at and no coverage is invented. A `held` or `unverified`
//            row NEVER satisfies the clause — this map is built from
//            `verified-alive` rows alone — and never confuses it: the
//            frontier's five held/unverified *.e-wrestling.org rows are old,
//            dead feds that lived on that domain before its present holder
//            had it (prime.e-wrestling.org's row describes a site last active
//            in 2012, while the same host today serves its holder's own
//            page), so a target whose exact host also carries one of those
//            says so in a soft note instead of passing in silence.
//      Deliberately NOT ratcheted, for v119's own reason: a new LAW_RULES key
//      needs a baseline rewrite (`npm run law:baseline`), which is a
//      Janitor-or-coordinator act. The hard warn below is this gavel's
//      mechanical check at the gate (v115, the landing hold).
// ---------------------------------------------------------------------------
{
  const LINKOUT_KINDS = new Map([
    ["promotion", null],               // the site root: no route segment
    ["results", "results"],            // a card
    ["bio", "bio"],                    // a wrestler or a team
    ["titlehistory", "titlehistory"],  // a belt
    ["rp", "rp"],                      // a roleplay
  ]);
  // The route family each record type's OWN page is. A soft note, not a hard
  // failure: v124 rules on the route the URL uses, and documents the pairing.
  const LINKOUT_KIND_BY_TYPE = { promotions: "promotion", shows: "results", characters: "bio", units: "bio", titles: "titlehistory", rps: "rp" };
  const frontierRows = frontier && Array.isArray(frontier.rows) ? frontier.rows : [];
  const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; } };
  const aliveHosts = new Map();     // host -> the verified-alive row's own name
  const notAliveHosts = new Map();  // host -> that row's status (held, unverified, …)
  for (const r of frontierRows) {
    if (!r || typeof r.url !== "string") continue;
    const h = hostOf(r.url);
    if (!h) continue;
    if (r.status === "verified-alive") { if (!aliveHosts.has(h)) aliveHosts.set(h, r.name ?? r.url); }
    else if (!notAliveHosts.has(h)) notAliveHosts.set(h, r.status ?? "(no status)");
  }
  const aliveCover = (host) => {
    if (aliveHosts.has(host)) return { on: host, name: aliveHosts.get(host) };
    for (const [h, name] of aliveHosts) if (host.endsWith(`.${h}`)) return { on: h, name };
    return null;
  };
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const TODAY = new Date().toISOString().slice(0, 10);
  const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  for (const [typeKey, rows] of [["promotions", promotions], ["shows", shows], ["characters", characters], ["units", units], ["titles", titles], ["rps", rps]]) {
    for (const [i, rec] of (Array.isArray(rows) ? rows : []).entries()) {
      if (!rec || rec.links_out === undefined) continue;
      const who = `${typeKey}[${i}] ("${rec.id ?? rec.name ?? "?"}")`;
      if (!Array.isArray(rec.links_out)) {
        warn(`${who}: "links_out" must be an ARRAY of {url, label, kind, checked} (CURATION.md v124(b), #holders-site-links)`);
        continue;
      }
      const seen = new Set();
      for (const [j, a] of rec.links_out.entries()) {
        const where = `${who}.links_out[${j}]`;
        const url = a && str(a.url), label = a && str(a.label), kind = a && str(a.kind), checked = a && str(a.checked);
        if (!url || !label || !kind || !checked) {
          warn(`${where}: needs {url, label, kind, checked} — the holder's own address for THIS record, the site's own name for that page, the route family the URL uses, and the ISO date the address was verified (CURATION.md v124(b))`);
          continue;
        }
        if (!/^https?:\/\/[^\s]+$/i.test(url)) {
          warn(`${where}: "url" needs an http(s):// scheme and no whitespace (got "${url}") — a bare host renders as a broken relative href (CURATION.md v124(b), v119(b))`);
          continue;
        }
        let parsed = null;
        try { parsed = new URL(url); } catch { parsed = null; }
        if (!parsed) {
          warn(`${where}: "url" does not parse as a URL ("${url}")`);
          continue;
        }
        const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
        if (isMuseumHost(host)) {
          warn(`${where}: "${url}" is a MUSEUM-HOSTED address — links_out points OUT, at a living site the museum will never hold; a museum-hosted account is forum_accounts' job and the two must not blur (CURATION.md v124(b), v119(b))`);
          continue;
        }
        if (!LINKOUT_KINDS.has(kind)) {
          warn(`${where}: "kind" is "${kind}", which is not one of the documented route families (${[...LINKOUT_KINDS.keys()].join(", ")}) — kind is the route family the URL itself uses, never a label of our own (CURATION.md v124(b))`);
          continue;
        }
        const seg = parsed.pathname.replace(/^\/+/, "").split("/")[0] || "";
        const wantSeg = LINKOUT_KINDS.get(kind);
        if (wantSeg === null && seg !== "") {
          warn(`${where}: kind "promotion" is the site ROOT, but "${url}" routes on "/${seg}/" — kind is the route family the URL itself uses (CURATION.md v124(b))`);
        } else if (wantSeg !== null && seg !== wantSeg) {
          warn(`${where}: kind "${kind}" does not match the URL's own route ("${url}" routes on "/${seg}") — the kind is stored precisely so it can be checked against the url instead of trusted (CURATION.md v124(b))`);
        }
        if (!ISO_DATE.test(checked)) {
          warn(`${where}: "checked" is "${checked}" — it is the ISO date (YYYY-MM-DD) the address was verified by request (CURATION.md v124(b))`);
        } else if (checked > TODAY) {
          warn(`${where}: "checked" is ${checked}, which is in the FUTURE (today is ${TODAY}) — the date an address was verified is read off the clock, never estimated`);
        }
        const cover = aliveCover(host);
        if (!cover) {
          const other = notAliveHosts.get(host);
          warn(`${where}: "${url}" is on a host that no "verified-alive" frontier row covers${other ? `, and the only frontier row on ${host} is "${other}" — a held or unverified row NEVER satisfies this clause` : ""} — the HOST (that exact host, or its registrable parent) must carry a verified-alive row first, and the ledger's own last_checked/check_cadence sweep then keeps the link honest (CURATION.md v124(d), the dead-only rule)`);
          continue;
        }
        if (notAliveHosts.has(host)) {
          soft(`${where}: ${host} is covered by the "verified-alive" frontier row on ${cover.on} ("${cover.name}") and ALSO carries a "${notAliveHosts.get(host)}" row of its own — v124(d)'s own case: the older row is a dead fed that lived on this domain before its present holder had it. The link stands on the alive row; the two ledger rows should say which is which.`);
        }
        if (LINKOUT_KIND_BY_TYPE[typeKey] && kind !== LINKOUT_KIND_BY_TYPE[typeKey]) {
          soft(`${where}: a ${typeKey} row carries kind "${kind}" where its own page on the holder's site is a "${LINKOUT_KIND_BY_TYPE[typeKey]}" — check the crosswalk row it came from (CURATION.md v124(b))`);
        }
        const key = `${host}${parsed.pathname.replace(/\/+$/, "")}`;
        if (seen.has(key)) soft(`${where}: "${url}" is already linked by this same record — one address per record is enough`);
        seen.add(key);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 6c. essays.json (if present): curatorial/narrative writing, as distinct
//     from database records and verbatim artifacts. Every id an essay
//     links to (promotions/characters/units/titles/shows/awards) must resolve.
// ---------------------------------------------------------------------------
const essayAwardIds = new Set(awards.map((a) => a.id)); // hook c247: linked.awards (an award page an essay names)
for (const [i, e] of essays.entries()) {
  if (!e.id || !e.title || (!e.page && e.status !== "linked")) warn(`essays[${i}]: needs "id", "title", and "page"`);
  const linked = e.linked ?? {};
  for (const pid of linked.promotions ?? []) {
    if (!promoIds.has(pid)) warn(`essays[${i}] ("${e.title}"): linked promotion "${pid}" does not resolve`);
  }
  for (const cid of linked.characters ?? []) {
    if (!charIds.has(cid)) warn(`essays[${i}] ("${e.title}"): linked character "${cid}" does not resolve`);
  }
  for (const uid of linked.units ?? []) {
    if (!unitIds.has(uid)) warn(`essays[${i}] ("${e.title}"): linked unit "${uid}" does not resolve`);
  }
  for (const tid of linked.titles ?? []) {
    if (!titleIds.has(tid)) warn(`essays[${i}] ("${e.title}"): linked title "${tid}" does not resolve`);
  }
  for (const sid of linked.shows ?? []) {
    if (!showIds.has(sid)) warn(`essays[${i}] ("${e.title}"): linked show "${sid}" does not resolve`);
  }
  for (const aid of linked.awards ?? []) {
    if (!essayAwardIds.has(aid)) warn(`essays[${i}] ("${e.title}"): linked award "${aid}" does not resolve`);
  }
}
// 6c2. THE ESSAYS REOPENED (hook c108, 2026-10-07; CURATION.md v129, #essays-reopened; the Janitor's D142 + D169):
//     a row carrying `status` is a v129 row, outside, human-written work, and is held to its shape here (hard). A row
//     with no `status` is judged by the block above only, exactly as before. scripts/fixers/apply-essays-append.py
//     refuses the same shapes at landing; this is the gate's own reading.
//       linked: a live article. Its own http(s) `url` (never a museum-hosted address) and `checked` (YYYY-MM-DD, the
//               day it was last found live); nothing copied: no page, text, collection, sources or served_since.
//       served: a dead article or a paper with no other home. page = /essays/<id>.html (rendered by
//               cross-reference.mjs, so it must exist on disk), its full `text`, an accession `collection`,
//               `sources[]` saying where our copy came from, `served_since` YYYY-MM-DD.
//       both:   type "essay", a slug id, title, byline and venue named (v129(c)), form article|paper,
//               published {date, precision}, written (optional) YYYY[-MM[-DD]], a language code.
{
  // hook c142 (CURATION.md v130, #museum-own-essays): "own" is the museum's own writing, a third class beside v129's two.
  // hook c253 (the GAVELS ruling log, the Janitor's 2026-10-10 chat row): "wing" is an essay already served inside a wing.
  const ESSAY_STATUS = new Set(["linked", "served", "own", "wing"]);
  // hook c279 (the Janitor, chat 2026-10-11: "Maybe add a "review" chip as well for game reviews? I'm not sure
  // "journalism" exactly covers them"): a fifth shelf, `reviews` — a piece whose main purpose is to evaluate a specific
  // game or product (a video game, a tabletop RPG, a board game, a sim), a retrospective review included. A feature,
  // history, interview or news piece about a game is not one. scripts/fixers/apply-essays-append.py holds the same five.
  const ESSAY_SHELF = new Set(["museum", "academic", "journalism", "community", "reviews"]);
  // The tag set a museum-own essay's `html` body may use. cross-reference.mjs places that body UNESCAPED, so this is the
  // whole of what the museum will render from it, and every link in it must be an http(s) address or site-relative.
  const ESSAY_OWN_TAGS = new Set(["p", "a", "i", "em", "strong", "br"]);
  const ESSAY_FORMS = new Set(["article", "paper"]);
  const ESSAY_OWN_FORMS = new Set([...ESSAY_FORMS, "essay"]); // only an own row may carry the museum's own form
  // hook c259 (the GAVELS ruling log, the Janitor's 2026-10-10 chat row (c)): a podcast episode or a video about the hobby is
  // LINKED from the Essays page, never served, so these two forms are a linked row's only.
  const ESSAY_MEDIA_FORMS = new Set(["audio", "video"]);
  const ESSAY_LINKED_FORMS = new Set([...ESSAY_FORMS, ...ESSAY_MEDIA_FORMS]);
  const ESSAY_ALLOWED = new Set(["id", "type", "status", "shelf", "title", "byline", "form", "venue", "published", "written",
    "url", "checked", "not_checked", "page", "text", "html", "collection", "sources", "served_since", "language", "linked", "about"]); // hook c253: about
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  let essayDocPageSet = null; // hook c253: data/documents.json's pages, read once and only when a "wing" row is on file
  for (const [i, e] of essays.entries()) {
    if (!e || e.status === undefined) continue;
    const at = `essays[${i}] ("${e.id}")`;
    if (!ESSAY_STATUS.has(e.status)) { warn(`${at}: status "${e.status}" is not linked|served|own|wing (CURATION.md v129, v130; GAVELS 2026-10-10)`); continue; }
    if (e.type !== "essay") warn(`${at}: type must be "essay"`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(e.id ?? "")) warn(`${at}: id must be a lowercase slug`);
    for (const k of ["title", "byline", "venue"]) {
      if (typeof e[k] !== "string" || !e[k].trim()) warn(`${at}: needs a non-empty "${k}" (v129(c): the byline and the original publication are named)`);
    }
    const forms = e.status === "own" ? ESSAY_OWN_FORMS : e.status === "linked" ? ESSAY_LINKED_FORMS : ESSAY_FORMS;
    if (ESSAY_MEDIA_FORMS.has(e.form) && e.status !== "linked") warn(`${at}: form "${e.form}" is linked from the Essays page, never served: status must be "linked" (GAVELS 2026-10-10 (c); hook c259)`);
    else if (!forms.has(e.form)) warn(`${at}: form must be ${[...forms].join("|")}`);
    // hook c142 (v130(c)): a piece is shelved by WHAT it is, never by where it is kept. hook c279: essays.html is ONE
    // list, newest first, and the shelf rides its row as the first chip in the row's own chip run.
    if (!ESSAY_SHELF.has(e.shelf)) warn(`${at}: shelf must be ${[...ESSAY_SHELF].join("|")} (CURATION.md v130(c); hook c279: essays.html is one list and the shelf is the row's own chip)`);
    const pub = e.published;
    if (!pub || typeof pub !== "object" || !("date" in pub) || !["exact", "month", "year", "unknown"].includes(pub.precision)) {
      warn(`${at}: published must be {date, precision} (precision exact|month|year|unknown)`);
    } else if (pub.precision === "exact" && !DAY_RE.test(String(pub.date))) warn(`${at}: an exact published date is YYYY-MM-DD`);
    if (e.written != null && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(String(e.written))) warn(`${at}: written is YYYY, YYYY-MM or YYYY-MM-DD`);
    if (typeof e.language !== "string" || !/^[a-z]{2,3}$/.test(e.language)) warn(`${at}: needs a language code`);
    for (const k of Object.keys(e)) if (!ESSAY_ALLOWED.has(k)) soft(`${at}: field "${k}" is not one v129's row shape names`);
    // hook c253 (the GAVELS ruling log, the Janitor, chat 2026-10-10: "We should tag/chip the essays with what parts of the hobby
    // they talk about, consistent with how our wings are already labeled"): `about` names the parts of the hobby the piece
    // discusses on the wings' own axes, each value one the promotions enums above take (MEDIUM_VALUES, FORM_VALUES,
    // PLAY_VALUES, AUTHORSHIP_VALUES; apply-essays-append.py reads these same lists from this file), several per axis, each
    // once. "unknown" says nothing about an essay: an axis the piece does not discuss is left out.
    if (e.about !== undefined) {
      const AXES = { medium: MEDIUM_VALUES, form: FORM_VALUES, play: PLAY_VALUES, authorship: AUTHORSHIP_VALUES };
      if (!e.about || typeof e.about !== "object" || Array.isArray(e.about) || !Object.keys(e.about).length) warn(`${at}: about is {medium?, form?, play?, authorship?}, at least one axis, each a non-empty list (GAVELS 2026-10-10)`);
      else for (const [axis, vals] of Object.entries(e.about)) {
        if (!Object.hasOwn(AXES, axis)) { warn(`${at}: about.${axis} is not a wing axis (medium|form|play|authorship)`); continue; }
        if (!Array.isArray(vals) || !vals.length) { warn(`${at}: about.${axis} is a non-empty list`); continue; }
        if (new Set(vals).size !== vals.length) warn(`${at}: about.${axis} names a value twice`);
        for (const v of vals) if (v === "unknown" || !AXES[axis].has(v)) warn(`${at}: about.${axis} "${v}" is not one of ${[...AXES[axis]].filter((x) => x !== "unknown").join("|")} (the promotions ${axis} vocabulary, docs/SCHEMA.md)`);
      }
    }
    if (e.url != null && !/^https?:\/\//.test(String(e.url))) warn(`${at}: url must be an http(s) address`);
    if (e.status === "linked") {
      if (!e.url) warn(`${at}: a linked essay needs the article's own url (v129(b))`);
      else if (/(^|[/.])ewmuseum\.(org|com)(\/|$)/i.test(String(e.url).split("://")[1]?.split("?")[0] ?? "")) warn(`${at}: a linked essay links out, never to a museum-hosted address`);
      // hook c112 (the Janitor's D428 default 3: "articles we could not check are linked, marked not checked by us"): a linked
      // row carries `checked` (the day its address was last found live) OR `not_checked` (the reason we could not check), never both
      if (e.not_checked != null) {
        if (typeof e.not_checked !== "string" || !e.not_checked.trim()) warn(`${at}: not_checked is a non-empty string, the reason we could not check (D428 default 3)`);
        if (e.checked != null) warn(`${at}: a linked essay carries checked or not_checked, never both (D428 default 3)`);
      } else if (!DAY_RE.test(String(e.checked ?? ""))) warn(`${at}: a linked essay needs checked (YYYY-MM-DD, the day its address was last found live), unless it carries not_checked (D428 default 3)`);
      for (const k of ["page", "text", "collection", "sources", "served_since"]) {
        if (e[k] != null) warn(`${at}: a linked essay is never copied (v129(b)); "${k}" belongs to a served row only`);
      }
    } else if (e.status === "wing") {
      // hook c253 (the GAVELS ruling log, the Janitor, chat 2026-10-10: "And yeah we should serve essays there even when they're
      // already tied to wings we hold"): an essay the museum already serves inside a wing. Its `page` is that wing document's
      // own page, a data/documents.json row's page and on disk; nothing is copied, so it carries none of a served or own
      // row's body or apparatus (its provenance is the documents row's) and none of a linked row's url/checked.
      if (!essayDocPageSet) {
        const docRaw = existsSync(resolve(DATA, "documents.json")) ? JSON.parse(readFileSync(resolve(DATA, "documents.json"), "utf8")) : {};
        essayDocPageSet = new Set((Array.isArray(docRaw) ? docRaw : docRaw.documents ?? []).map((d) => d && d.page).filter(Boolean));
      }
      if (typeof e.page !== "string" || !e.page.startsWith("/") || e.page.startsWith("/essays/")) warn(`${at}: an essay served in a wing points at the wing document's own page, never /essays/ (GAVELS 2026-10-10)`);
      else if (!essayDocPageSet.has(e.page)) warn(`${at}: page "${e.page}" is not a served document (no data/documents.json row carries it)`);
      else if (!existsSync(resolve(ROOT, e.page.replace(/^\//, "")))) warn(`${at}: page "${e.page}" is not on disk`);
      if (essays.some((o, j) => j !== i && o && o.status === "wing" && o.page === e.page)) warn(`${at}: page "${e.page}" is listed by another essay row too`);
      for (const k of ["text", "html", "collection", "sources", "served_since", "url", "checked", "not_checked"]) {
        if (e[k] != null) warn(`${at}: an essay served in a wing is not copied (GAVELS 2026-10-10); "${k}" belongs to another status`);
      }
    } else if (e.status === "own") {
      // hook c142 (CURATION.md v130): the museum's own writing. Its page is rendered from this row, like a served one, and
      // the line names the refresh in preflight's own deferral form (the gate's check runs after its refresh:links). Its
      // body is HTML the writer wrote here and the renderer places it UNESCAPED, so the tag set is narrow and every link
      // must resolve. It carries none of a collected document's apparatus.
      if (e.page !== `/essays/${e.id}.html`) warn(`${at}: a museum-own essay's page is /essays/<id>.html`);
      else if (!existsSync(resolve(ROOT, "essays", `${e.id}.html`))) warn(`${at}: ${e.page} is not on disk — stale, run \`npm run refresh:links\` (cross-reference.mjs renders it from this row; the gate's check runs after its refresh)`);
      const body = typeof e.html === "string" ? e.html : "";
      if (!body.trim()) warn(`${at}: a museum-own essay needs its own "html" body (v130(a))`);
      else {
        for (const t of body.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b/g)) {
          if (!ESSAY_OWN_TAGS.has(t[1].toLowerCase())) warn(`${at}: html carries <${t[1]}> — a museum-own essay's body is ${[...ESSAY_OWN_TAGS].join(", ")} only (it is rendered unescaped)`);
        }
        for (const a of body.matchAll(/<a\b([^>]*)>/g)) {
          const href = a[1].match(/\bhref\s*=\s*"([^"]*)"/);
          if (!href) warn(`${at}: html carries an <a> with no href`);
          else if (!/^(https?:\/\/|\/)/.test(href[1])) warn(`${at}: html's link "${href[1]}" is neither an http(s) address nor site-relative`);
        }
      }
      for (const k of ["text", "collection", "sources", "served_since", "url", "checked", "not_checked"]) {
        if (e[k] != null) warn(`${at}: a museum-own essay is the museum's own writing (v130); "${k}" belongs to an outside piece`);
      }
    } else {
      if (e.page !== `/essays/${e.id}.html`) warn(`${at}: a served essay's page is /essays/<id>.html`);
      // hook c112 (cycle 312, 2026-10-07: ESSAYS-1 landed in window 311 and the preflight stopped half an hour here): the page
      // is cross-reference's own output, rendered from this row, and only the gate runs cross-reference. So the line names the
      // refresh in preflight's deferral form (scripts/ops/preflight.sh DEFER): preflight defers it to the gate, and the gate's
      // check, run after its own refresh:links, keeps it hard. Only a renderable row gets here (page is /essays/<id>.html).
      else if (!existsSync(resolve(ROOT, "essays", `${e.id}.html`))) warn(`${at}: ${e.page} is not on disk — stale, run \`npm run refresh:links\` (cross-reference.mjs renders it from this row; the gate's check runs after its refresh)`);
      if (typeof e.text !== "string" || !e.text.trim()) warn(`${at}: a served essay needs its full text (v129(c))`);
      if (!collectionIds.has(e.collection)) warn(`${at}: collection "${e.collection}" is not an accession lot in data/collections.json`);
      if (!Array.isArray(e.sources) || !e.sources.length) warn(`${at}: a served essay needs sources[] (where our copy came from)`);
      else for (const [j, s] of e.sources.entries()) {
        if (!s || typeof s.kind !== "string" || !s.kind) warn(`${at}: sources[${j}] needs a kind`);
        else if (s.url != null && !/^https?:\/\//.test(String(s.url))) warn(`${at}: sources[${j}].url must be an http(s) address`);
      }
      if (!DAY_RE.test(String(e.served_since ?? ""))) warn(`${at}: a served essay needs served_since (YYYY-MM-DD)`);
      if (e.checked != null) warn(`${at}: checked belongs to a linked row only`);
      if (e.not_checked != null) warn(`${at}: not_checked belongs to a linked row only`);
    }
  }
}

// ---------------------------------------------------------------------------
// 6d. affiliations.json (if present): an EDGE LIST between promotions —
//     connection, distinct from a promotion's own `lineage` (family). Each
//     endpoint is either { id } resolving to a held promotion, or
//     { name, unheld: true } for a promotion this collection doesn't hold
//     yet — never a bare/fake id standing in for something we don't have.
// ---------------------------------------------------------------------------
const AFFIL_NATURES = new Set([
  "alliance-member", "alliance-operator", "shared-continuity", "ownership",
  "acquisition", "academy", "sister-promotion", "invading-faction",
  "crossover-booking", "rivalry", "affiliate-listing",
  // A6 (THE SHARED-OWNERSHIP EDGE): a genuine out-of-fiction common-owner
  // fact, distinct from "sister-promotion" (an in-fiction/narrative
  // continuity claim) and from "alliance-member/-operator" (an in-fiction
  // alliance structure) — a receipted business fact, never named prose (no
  // family label, no operator name; see CURATION.md's privacy rule).
  "shared-ownership",
  // A-LEGAL (the Janitor, 2026-08-25, on the Nike/NIKE PRO COMBAT receipt):
  // a receipted legal demand from a real-world rights-holder against a
  // promotion — b = {name: the company, unheld: true}. The note SHOULD name
  // the instrument per the Janitor's DMCA-vs-C&D distinction
  // (cease-and-desist | dmca-takedown | lawsuit | unspecified-legal-demand,
  // defaulting to the last when the source only says "C&D" colloquially).
  "legal-action",
  // A8 (THE COMMUNITY-PRESENCE EDGE, the Janitor, 2026-08-24): "a had a
  // presence in the community b" — a = the promotion, b = the community
  // itself, held here as a promotion row like any other (rspwf, the
  // newsgroup; cyberslam, a house network). DELIBERATELY MEDIUM-AGNOSTIC:
  // the venue's own medium is read off the target's own `medium` field, so
  // ONE nature covers a fed posting to Usenet, advertising on a board, or
  // turning up in a subreddit — the relation is the presence, not the
  // channel. Recruitment and advertising count; a fed does not have to have
  // carded a show there. Drawn only on positive identification, one wing at
  // a time (an acronym overlapping a span is not an identification), and the
  // point of drawing them at all is the migration map: which communities a
  // promotion lived in, and so which communities rise and fall over time.
  "community-presence",
  // A7 (LINEAGE EDGES REPLACE CONNECTED-HISTORY): "a is successor-of b" —
  // one continuous history under a different name, the same fact the old
  // promotions.json `lineage` field held (predecessors[]/successors[]),
  // now expressed as a scalable edge instead of a bespoke per-promotion
  // field + a hand-picked essay callout.
  "successor-of",
]);
function checkAffilEndpoint(e, i, side) {
  if (!e || typeof e !== "object") { warn(`affiliations[${i}].${side}: must be an object`); return; }
  if (e.unheld === true) {
    if (!e.name) warn(`affiliations[${i}].${side}: unheld endpoint needs a "name"`);
  } else if (e.id) {
    if (!promoIds.has(e.id)) warn(`affiliations[${i}].${side}: id "${e.id}" does not resolve to a held promotion (mark unheld:true if it isn't one)`);
  } else {
    warn(`affiliations[${i}].${side}: needs either an "id" (held promotion) or "name" + unheld:true`);
  }
}
for (const [i, e] of affiliations.entries()) {
  checkAffilEndpoint(e.a, i, "a");
  checkAffilEndpoint(e.b, i, "b");
  if (!AFFIL_NATURES.has(e.nature)) warn(`affiliations[${i}]: nature "${e.nature}" is not one of ${[...AFFIL_NATURES].join("|")}`);
  if (!e.source) warn(`affiliations[${i}]: missing "source" (digest/receipt)`);
  // AFFILIATIONS FINALLY RENDER addendum: an optional `period` — a
  // TIME PERIOD the edge is attested for, only ever pulled from a
  // receipt that already carries a date ("PTC's own April 2002 channel
  // map"); never invented. Soft-checked shape only.
  if ("period" in e && (typeof e.period !== "string" || !e.period.trim())) {
    warn(`affiliations[${i}]: "period" must be a non-empty string when present`);
  }
  // USER REVIEW addendum: an optional `status_note` (a qualifying fact
  // that doesn't fit the dated `period` field — e.g. an operator
  // relationship that later ended) plus a `grade` (same
  // primary-source|user-attested|presumed vocabulary as everywhere else
  // in the registry) marking how firmly that note is attested.
  if ("status_note" in e && (typeof e.status_note !== "string" || !e.status_note.trim())) {
    warn(`affiliations[${i}]: "status_note" must be a non-empty string when present`);
  }
  if ("grade" in e && !GRADES.has(e.grade)) {
    warn(`affiliations[${i}]: grade "${e.grade}" is not one of primary-source|user-attested|presumed`);
  }
}

// AFFILIATIONS FINALLY RENDER addendum: every affiliation edge touching a
// HELD promotion must actually be rendered on that promotion's own wing
// page — "data first, rendering can wait" (the registry wave's own
// deferral) ends here. Checked against the wing's own served HTML
// (post-`npm run refresh:links`), not the data alone, so a rendering
// regression or a forgotten promotion fails CI the same way a broken
// link would.
for (const [i, e] of affiliations.entries()) {
  for (const side of ["a", "b"]) {
    const party = e[side];
    if (!party?.id) continue;
    const promo = promotions.find((p) => p.id === party.id);
    if (!promo?.page) continue;
    const wingIndexPath = resolve(ROOT, promo.page.replace(/^\//, ""), "index.html");
    if (!existsSync(wingIndexPath)) { warn(`affiliations[${i}].${side}: promotion "${party.id}" has no wing index at ${promo.page}`); continue; }
    const html = readFileSync(wingIndexPath, "utf8");
    const other = e[side === "a" ? "b" : "a"];
    const otherName = other.id ? (promotions.find((p) => p.id === other.id)?.name ?? other.id) : other.name;
    // 2026-09-22: the affiliations card renders a held party as `full_name || name` (cross-reference.mjs), so a wing whose
    // name differs from its full name ("SHOOTFIRE" / "Shootfire Pro Wrestling") is rendered under the full name — accept it
    const otherFull = other.id ? promotions.find((p) => p.id === other.id)?.full_name : null;
    // USER REVIEW FIX (full-name-primary rendering): the rendered label no
    // longer matches the raw stored string verbatim (an unheld "ACRONYM
    // (Full Name)" edge value renders flipped to "Full Name (ACRONYM)"),
    // so check the ACRONYM substring resolves instead of exact inclusion
    // — order-independent, still fails if the party genuinely isn't
    // rendered anywhere.
    const acronymOnly = otherName.match(/^([^(]+?)\s*(?:\(|$)/)?.[1]?.trim() || otherName;
    // 2026-09-08: wing pages render names HTML-escaped ("Blood, Sweat &amp; Chairs Wrestling"); compare the escaped forms too
    const escName = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (!html.includes(otherName) && !html.includes(acronymOnly) && !html.includes(escName(otherName)) && !html.includes(escName(acronymOnly)) && !(otherFull && (html.includes(otherFull) || html.includes(escName(otherFull))))) {
      warn(`affiliations[${i}]: "${otherName}" (the other party in a ${e.nature} edge with "${party.id}") is not rendered anywhere on ${promo.page} — run \`npm run refresh:links\``);
    }
  }
}

// ---------------------------------------------------------------------------
// 6d2. inductions.json (if present, THE HALLS OF FAME WAVE): one row per
//      hall-of-fame induction. Every row names the PROMOTION THAT RAN THE
//      HALL (the inducting institution), which is not necessarily the
//      promotion the inductee is best known for — e.g. every row currently
//      reads promotion:"uwf", because the UWF's hall was the only hall this
//      line ever ran, even for figures honored from its IWF/GIWF history.
//      No per-row "id" — like affiliations.json, this is a fact/relationship
//      record, not an identity-bearing entity, so it isn't in idIndex.
// ---------------------------------------------------------------------------
//      CLASS YEAR MAY BE UNKNOWN (the Janitor's gavel, 2026-09-02, on the
//      CSW Hall of Fame): a hall the record ATTESTS but never dates still
//      belongs in the Hall of Fame section — "a Hall of Fame is the Hall of
//      Fame section (inductions), not an awards bestowal" — so `class_year`
//      may be null PROVIDED `observed_by` carries the year by which the
//      induction is attested. That is an honest upper bound read off the
//      document that carries the credit, never a guessed class year; the
//      same posture the registry already takes to an unknown `closed` date.
//      One of the two is always required, and both are numbers when set.
//      THE UNMINTED INDUCTEE (the Janitor's gavel of 2026-09-02 on
//      out-of-character inductions, CURATION v108 #induct-by-character):
//      `inductee` is EITHER an entity id string, as it always was, OR the
//      same honest `{ name, unminted: true, fed? }` shape reigns.json and
//      awards.json already use for a holder or a recipient the registry
//      holds no row for. A community hall inducts whoever it inducts; the
//      museum does not mint a character to make a seat fileable, and it
//      does not drop the seat either. `fed` is the free-text federation tag
//      the inducting document itself gives — never a promotion id, because
//      the point of the field is that the wing is not held.
for (const [i, ind] of inductions.entries()) {
  const hasYear = typeof ind.class_year === "number";
  const hasObserved = typeof ind.observed_by === "number";
  if (!ind.inductee || !ind.promotion || (!hasYear && !hasObserved)) {
    warn(`inductions[${i}]: needs "inductee", "promotion", and either a numeric "class_year" or — where no document dates the induction — a null "class_year" beside a numeric "observed_by" (the year by which it is attested; the Janitor's gavel, 2026-09-02)`);
    continue;
  }
  if (typeof ind.inductee === "object") {
    if (ind.inductee.unminted !== true) {
      warn(`inductions[${i}]: an object "inductee" is the unminted shape and needs "unminted": true beside its "name"`);
    } else if (!ind.inductee.name) {
      warn(`inductions[${i}]: unminted inductee needs a "name"`);
    } else if (!ind.citation_url) {
      warn(`inductions[${i}]: unminted inductee "${ind.inductee.name}" needs a "citation_url" — with no entity page to land on, the row owes a link to the document that carries the induction`);
    }
  } else if (!idIndex.has(ind.inductee)) {
    warn(`inductions[${i}]: inductee "${ind.inductee}" does not resolve to any entity`);
  }
  if (!promoIds.has(ind.promotion)) warn(`inductions[${i}]: promotion "${ind.promotion}" does not resolve to a held promotion`);
  if (!hasYear && ind.class_year !== null && ind.class_year !== undefined) {
    warn(`inductions[${i}]: class_year "${ind.class_year}" should be a number, or null where the induction's own year is unknown`);
  }
  if ("observed_by" in ind && !hasObserved) {
    warn(`inductions[${i}]: observed_by "${ind.observed_by}" should be a number — the year by which the induction is attested`);
  }
  if (!hasYear && hasObserved && !ind.note) {
    soft(`inductions[${i}]: carries an undated class ("class_year": null) with no "note" saying what bounds the year — an undated induction owes the sentence that makes "observed by ${ind.observed_by}" honest`);
  }
}

// ---------------------------------------------------------------------------
// 6d3. rps.json (if present, THE ROLEPLAY REGISTER, framework-only wave):
//      individual roleplays, connected to characters/units never handlers
//      (the privacy rule applies to RPs exactly as it does everywhere
//      else). `involves` (appears/participates) and `references`
//      (merely named, not present) are deliberately distinct — an entity
//      may be in one or the other for a given RP, never both. Same
//      date-precision shape as shows.json. Starts empty by design — not an
//      error, just nothing curated onto a served page yet.
// ---------------------------------------------------------------------------
//      THE CHARACTER-FIRST ROLEPLAY (hook c106; the Janitor, 2026-10-06: "Roleplays attach to characters and characters
//      should be capable of being independent of wings"; D407). `promotion` is optional: it is set only when a held fed
//      claims the text, and a roleplay naming a fed not yet held is "(A) serve now, add the fed later" (rps-corrections
//      adds `promotion` when the wing lands, the page address unchanged). A row with no `promotion` is attached by
//      `involves` alone, so it must hold at least one resolving character/unit id (hard). `venue` (optional) is the
//      community-hub wing the roleplay was posted on, "(A) on the hub", and must resolve to a `type: community-hub`
//      row (hard); it records where the text appeared, never a fed's claim.
const promoTypeById = new Map(promotions.map((p) => [p.id, p.type]));
for (const [i, rp] of rps.entries()) {
  if (!rp.id || !rp.title || !Array.isArray(rp.involves)) {
    warn(`rps[${i}]: needs "id", "title", and an "involves" array`);
    continue;
  }
  if ("promotion" in rp && !promoIds.has(rp.promotion)) warn(`rps[${i}] ("${rp.title}"): promotion "${rp.promotion}" does not resolve`);
  if (!("promotion" in rp) && !rp.involves.some((cid) => charIds.has(cid) || unitIds.has(cid))) {
    warn(`rps[${i}] ("${rp.title}"): no "promotion" and no resolving character/unit in "involves" — a roleplay no fed claims is attached to its character(s) by "involves" alone (the Janitor's D407)`);
  }
  if ("venue" in rp && promoTypeById.get(rp.venue) !== "community-hub") {
    warn(`rps[${i}] ("${rp.title}"): venue "${rp.venue}" ${promoIds.has(rp.venue) ? "is not a type: community-hub row" : "does not resolve"} — "venue" names the community hub the roleplay was posted on (the Janitor's D407)`);
  }
  function checkRpRefs(ids, field) {
    for (const cid of ids ?? []) {
      if (!charIds.has(cid) && !unitIds.has(cid)) {
        warn(`rps[${i}] ("${rp.title}"): "${field}" references unknown character/unit "${cid}" — RPs connect to characters or units, never handlers`);
      }
    }
  }
  checkRpRefs(rp.involves, "involves");
  checkRpRefs(rp.references, "references");
  const overlap = (rp.involves ?? []).filter((id) => (rp.references ?? []).includes(id));
  if (overlap.length) warn(`rps[${i}] ("${rp.title}"): ${overlap.join(", ")} appear in both "involves" and "references" — an entity is one or the other per RP, never both`);
  if (rp.date) {
    if (typeof rp.date !== "object" || typeof rp.date.date !== "string") {
      warn(`rps[${i}] ("${rp.title}"): "date" must be an object { date, precision, source? }`);
    } else if (!PRECISIONS.has(rp.date.precision)) {
      warn(`rps[${i}] ("${rp.title}"): precision "${rp.date.precision}" is not one of exact|month|year|circa|unknown`);
    } else {
      checkImpossibleDate(`rps[${i}] ("${rp.title}").date`, rp.date);
    }
  }
  if (rp.served_url === undefined) soft(`rps[${i}] ("${rp.title}"): no "served_url" — fine while unserved, but the field should be present (even as null) once the row exists`);
}

// ---------------------------------------------------------------------------
// 6d4. rp-catalog.json (if present, THE FLAT-FILE DATABASE WAVE, W8):
//      every RP/match-report/in-card the UWF's own CGI database's
//      per-username catalog files (roleplays/, matches/, incarders/) name
//      as having existed, whether or not this collection holds the actual
//      served page — distinct from rps.json, which holds only what's
//      actually served. `held: true` rows carry `rps_id` pointing back at
//      the served row; `held: false` rows are the Wayback probe list's own
//      source data (the workshop's W8-rp-probes.txt is generated from
//      exactly these).
//
//      THE AUTHOR-OPTIONALITY WAVE (OSW batch 6): `author` is optional —
//      a catalog row records a title known to exist from a fed's own
//      results/promo index, and the author isn't always recoverable from
//      that index alone (a bare match-report title naming no one, say).
//      The row must carry EITHER a resolvable `author` OR the explicit
//      `author_unknown: true` flag, never neither, never both — the exact
//      same mutual-exclusivity doctrine `membership_unknown` already
//      enforces for units.json. This is NOT a license to leave author
//      off by default: set it whenever the source text names one.
//
//      THE SHOW_ID ALTERNATIVE (OSW final push): a "match-report" or
//      "incard" catalog row's own served destination is routinely
//      data/shows.json (a match result, a backstage segment — both
//      belong on the appearances-carrying record a card lives on), not
//      data/rps.json — unlike the UWF-era catalog this file started
//      from, where every row really was a roleplay. `held: true` now
//      accepts EITHER `rps_id` (served into rps.json, the original
//      shape) OR `show_id` (served into shows.json) — never neither,
//      and never both on the same row (one document has one true home).
// ---------------------------------------------------------------------------
const RP_CATALOG_KINDS = new Set(["roleplay", "match-report", "incard"]);
for (const [i, c] of rpCatalog.entries()) {
  if (!c.title || !c.kind || typeof c.held !== "boolean") {
    warn(`rp-catalog[${i}]: needs "title", "kind", and a boolean "held"`);
    continue;
  }
  if (!c.author && c.author_unknown !== true) {
    warn(`rp-catalog[${i}] ("${c.title}"): no "author" and no "author_unknown: true" — either name who wrote it (sourced) or set author_unknown: true`);
  }
  if (c.author && c.author_unknown === true) {
    soft(`rp-catalog[${i}] ("${c.title}"): has "author" AND "author_unknown: true" — drop the flag, the author isn't unknown anymore`);
  }
  if (c.author && !charIds.has(c.author) && !unitIds.has(c.author)) warn(`rp-catalog[${i}] ("${c.title}"): author "${c.author}" does not resolve to a character or unit`);
  if (!RP_CATALOG_KINDS.has(c.kind)) warn(`rp-catalog[${i}] ("${c.title}"): kind "${c.kind}" is not one of ${[...RP_CATALOG_KINDS].join("|")}`);
  if (c.held && !c.rps_id && !c.show_id) warn(`rp-catalog[${i}] ("${c.title}"): held:true but no "rps_id" or "show_id" linking the served row`);
  if (c.held && c.rps_id && c.show_id) warn(`rp-catalog[${i}] ("${c.title}"): has both "rps_id" and "show_id" — one served document, one home`);
  if (c.held && c.rps_id && !rps.some((r) => r.id === c.rps_id)) warn(`rp-catalog[${i}] ("${c.title}"): rps_id "${c.rps_id}" does not resolve to any data/rps.json row`);
  if (c.held && c.show_id && !shows.some((s) => s.id === c.show_id)) warn(`rp-catalog[${i}] ("${c.title}"): show_id "${c.show_id}" does not resolve to any data/shows.json row`);
}

// ---------------------------------------------------------------------------
// 6e. frontier.json (if present): the expansion ledger — promotions named in
//     our corpora but not held. { _schema_version, _dead_only_rule,
//     _status_values, rows }. Gated by CURATION.md's dead-only rule.
// ---------------------------------------------------------------------------
// "verified-alive" (the Janitor, 2026-08-25): renamed from "living-do-not-touch"
// for enum consistency with verified-dead — the do-not-touch was always the
// dead-only rule's job, not the value's.
const FRONTIER_STATUS = new Set(["unverified", "verified-dead", "verified-alive", "mined", "held"]);
// "weekly" added 2026-08-24 for the r/efeds RSS birth-registry monitor: the
// feed holds 25 entries and the sub runs ~2 posts/day, so a monthly pull
// would overflow the window and silently drop births — the cadence follows
// the feed's own arithmetic, not preference.
const FRONTIER_CADENCE = new Set(["weekly", "monthly", "quarterly"]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
if (frontier !== null) {
  const frontierMemorialIds = new Set(memorials.map((m) => m.id).filter(Boolean));
  if (!frontier || !Array.isArray(frontier.rows)) warn("data/frontier.json must be an object with a \"rows\" array");
  else for (const [i, r] of frontier.rows.entries()) {
    if (!r.name || !r.first_seen_in || !r.status) warn(`frontier.rows[${i}]: needs "name", "first_seen_in", and "status"`);
    if (r.status && !FRONTIER_STATUS.has(r.status)) warn(`frontier.rows[${i}] ("${r.name}"): unknown status "${r.status}"`);
    // CONTENT, not just presence (PROSE-FIX-01, 2026-09-13; proposal.md #1)
    // — first_seen_in is fetched whole, client-side, by frontier.html for
    // every visitor (see findings.md's "not quite the same guarantee as
    // 'not rendered'" side finding); the presence check above never reads
    // what's actually in the string.
    if (typeof r.first_seen_in === "string") {
      if (r.first_seen_in.length > FIELD_CAPS["frontier.community_presence[].hub"] * 4 /* no dedicated cap proposed; generous multiple of the shortest sibling cap */) {
        soft(`frontier.rows[${i}] ("${r.name}"): first_seen_in is ${r.first_seen_in.length} characters — a short citation label, not a paragraph`);
      }
      if (PROCESS_TEXT_RE.test(r.first_seen_in)) {
        lawHit("served-text-narration");
        soft(`frontier.rows[${i}] ("${r.name}"): first_seen_in carries workshop process text (${r.first_seen_in.match(PROCESS_TEXT_RE)[0]}) — this field is downloaded whole by every visitor to frontier.html`);
      }
    }
    if (Array.isArray(r.community_presence)) {
      for (const [ci, cp] of r.community_presence.entries()) {
        if (typeof cp?.hub !== "string") continue;
        if (cp.hub.length > FIELD_CAPS["frontier.community_presence[].hub"]) {
          soft(`frontier.rows[${i}] ("${r.name}").community_presence[${ci}]: hub is ${cp.hub.length} characters — a hub name, not a paragraph (cap ${FIELD_CAPS["frontier.community_presence[].hub"]})`);
        }
        if (PROCESS_TEXT_RE.test(cp.hub)) {
          lawHit("served-text-narration");
          soft(`frontier.rows[${i}] ("${r.name}").community_presence[${ci}]: hub carries workshop process text (${cp.hub.match(PROCESS_TEXT_RE)[0]})`);
        }
      }
    }
    // MALFORMED-URL GUARD (QA-REGISTRY-AUDIT, 2026-08-28) — found live: 19
    // frontier rows carried a `url` value that was never actually a clean
    // outbound link — 13 bare-domain strings with no "http(s)://" scheme
    // (rendered as a broken RELATIVE href by frontier.html's own `r.url ||
    // null`, since nothing here normalizes a scheme before use) and 6 with
    // literal wikitext/HTML residue concatenated past the real URL (a
    // Fandom-XML-dump infobox parse that captured the field's own
    // "|param = value}}" template tail, or a second URL/HTML tag glued on
    // after a stray space — every one still legible byte-for-byte in that
    // row's own `notes`, so no information was lost fixing the `url` field
    // itself). Hard fail, not soft: an outbound link this schema exists to
    // render should never render broken.
    if (typeof r.url === "string" && r.url) {
      if (!/^https?:\/\//i.test(r.url)) {
        warn(`frontier.rows[${i}] ("${r.name}"): "url" has no http(s):// scheme ("${r.url}") — frontier.html renders it as a bare href, which resolves as a broken relative link`);
      } else if (/\s/.test(r.url) || /[{}|]/.test(r.url) || /<[a-z]/i.test(r.url)) {
        warn(`frontier.rows[${i}] ("${r.name}"): "url" contains whitespace, "{", "}", "|", or an HTML tag ("${r.url}") — looks like extraction residue (wikitext template syntax, a concatenated second URL/tag) past the real address rather than a clean link`);
      }
    }
    // THE ACTIVE-EFEDS REGISTER REFINEMENT (2026-08-20): a verified-alive
    // row is the register the Janitor already observed it to be — it gets a
    // recurring re-check cadence like anything else worth watching, distinct
    // from the dead-only rule's own mining gate (unaffected by either field).
    if (r.status === "verified-alive") {
      if (r.last_checked !== undefined && (typeof r.last_checked !== "string" || !ISO_DATE_RE.test(r.last_checked))) {
        warn(`frontier.rows[${i}] ("${r.name}"): "last_checked" must be an ISO date string (YYYY-MM-DD)`);
      }
      if (r.check_cadence !== undefined && !FRONTIER_CADENCE.has(r.check_cadence)) {
        warn(`frontier.rows[${i}] ("${r.name}"): "check_cadence" must be "weekly", "monthly" or "quarterly"`);
      }
    } else {
      if ("last_checked" in r || "check_cadence" in r) soft(`frontier.rows[${i}] ("${r.name}"): "last_checked"/"check_cadence" are meant for verified-alive rows (status is "${r.status}") — check this is intentional`);
    }
    // founded_year (THE FOUNDING-EDGES WAVE, 2026-08-21) — OPTIONAL, an
    // integer year, populated only where the row's own first_seen_in/notes
    // already carry a receipt (never researched fresh for this field —
    // bulk population is Phase 3's own Fandom-dump enrichment path, per
    // the Janitor's own framing; see docs/SCHEMA.md).
    // medium (the Janitor, 2026-08-24, the print-era opening): OPTIONAL on a
    // frontier row; ABSENT MEANS WEB-ERA (no backfill, per the no-redundant-
    // narration rule) — set it only for non-web entities (tabletop-rpg,
    // play-by-mail, ...). Validated against the promotions media enum.
    if ("medium" in r && !MEDIUM_VALUES.has(r.medium)) {
      warn(`frontier.rows[${i}] ("${r.name}"): "medium" must be one of the promotions media values (got "${r.medium}")`);
    }
    // language / country (THE ECOSYSTEM EXPANSION GAVEL, 2026-09-05;
    // CURATION.md v111(c); widened onto the frontier by the coordinator's
    // ruling of the same day, because the discovery lanes per non-English
    // scene cannot record what they find without them). Same shapes and the
    // same postures as promotions.json's own: OPTIONAL, absent `language`
    // MEANS "en" exactly as absent `medium` above means web-era, `country`
    // has no default and no "unknown", malformed hard-fails and
    // well-formed-but-unknown soft-warns. Every row already on the frontier
    // stays valid untouched — there is no backfill here either.
    if ("language" in r) {
      if (typeof r.language !== "string" || !BCP47_RE.test(r.language)) {
        warn(`frontier.rows[${i}] ("${r.name}"): "language" is not a well-formed BCP-47 tag (got "${r.language}") — CURATION.md v111(c)`);
      } else if (!LANGUAGE_VALUES.has(r.language)) {
        soft(`frontier.rows[${i}] ("${r.name}"): language "${r.language}" is well-formed but not one of the known tags — fine if it's a genuinely new scene, just flagging so it's a deliberate addition, not a typo`);
      }
    }
    if ("country" in r) {
      if (typeof r.country !== "string" || !ISO3166_RE.test(r.country) || ISO3166_RESERVED.test(r.country)) {
        warn(`frontier.rows[${i}] ("${r.name}"): "country" is not an ISO 3166-1 alpha-2 code in upper case (got "${r.country}") — CURATION.md v111(c); this is the REAL-WORLD country of the community, never a kayfabe billing`);
      } else if (!COUNTRY_VALUES.has(r.country)) {
        soft(`frontier.rows[${i}] ("${r.name}"): country "${r.country}" is well-formed but not one of the known codes — fine if it's a genuinely new scene, just flagging so it's a deliberate addition, not a typo`);
      }
    }
    if (r.country && typeof r.country === "string" && ISO3166_RE.test(r.country) && !ANGLOPHONE_DEFAULT.has(r.country) && !("language" in r)) {
      soft(`frontier.rows[${i}] ("${r.name}"): country "${r.country}" is outside the Anglophone scene but no "language" is set — absence means "en" (CURATION.md v111(c)), so the default is making a claim nobody checked`);
    }
    // community_presence (the Janitor, 2026-08-24): OPTIONAL array — where and
    // when we saw a promotion ADVERTISED in a community we track (r-efeds,
    // rspwf, etc.). The frontier-layer twin of the held-graph community-presence
    // affiliation edge (e.g. giwf->rspwf): held wings carry the edge in
    // affiliations.json, frontier rows carry the relationship here. Each entry
    // {hub, first_seen (year int), last_seen (year int), source}. Feeds the
    // migration map — which communities a fed lived in, and when.
    if ("aka" in r) {
      if (!Array.isArray(r.aka) || r.aka.some((x) => typeof x !== "string")) {
        warn(`frontier.rows[${i}] ("${r.name}"): "aka" must be an array of strings`);
      }
    }
    if ("community_presence" in r) {
      if (!Array.isArray(r.community_presence)) {
        warn(`frontier.rows[${i}] ("${r.name}"): "community_presence" must be an array`);
      } else for (const cp of r.community_presence) {
        if (!cp || typeof cp.hub !== "string" || !cp.hub) warn(`frontier.rows[${i}] ("${r.name}"): community_presence entry needs a "hub" string`);
        for (const yk of ["first_seen", "last_seen"]) {
          if (yk in cp && !(Number.isInteger(cp[yk]) && cp[yk] >= DATE_YEAR_MIN && cp[yk] <= DATE_YEAR_MAX)) {
            warn(`frontier.rows[${i}] ("${r.name}"): community_presence ${yk} must be a plausible year`);
          }
        }
      }
    }
    // observed_year (the Janitor, 2026-08-24, on the DCLinks harvest): OPTIONAL,
    // the earliest year a source ATTESTS the promotion operating — "operational
    // as of X, so founding <= X." Weaker than founded_year (which asserts the
    // founding itself) and never a substitute for it; a dated directory listing,
    // a capture, a card all qualify. Broad dating for the heat-map horizon.
    if ("observed_year" in r) {
      if (!Number.isInteger(r.observed_year) || r.observed_year < DATE_YEAR_MIN || r.observed_year > DATE_YEAR_MAX) {
        warn(`frontier.rows[${i}] ("${r.name}"): "observed_year" must be a plausible integer year (${DATE_YEAR_MIN}–${DATE_YEAR_MAX})`);
      }
      if ("founded_year" in r && Number.isInteger(r.founded_year) && Number.isInteger(r.observed_year) && r.observed_year < r.founded_year) {
        warn(`frontier.rows[${i}] ("${r.name}"): observed_year precedes founded_year — one of the two is wrong`);
      }
    }
    if ("founded_year" in r) {
      if (!Number.isInteger(r.founded_year) || r.founded_year < DATE_YEAR_MIN || r.founded_year > DATE_YEAR_MAX) {
        warn(`frontier.rows[${i}] ("${r.name}"): "founded_year" must be a plausible integer year (${DATE_YEAR_MIN}–${DATE_YEAR_MAX})`);
      }
    }
    // kind (the Janitor's gavel, 2026-08-25, THE HUB ADMISSION): OPTIONAL —
    // "hub" marks a community hub row (toplist, interfed news board, forum
    // community, directory) admitted to the frontier alongside promotions.
    // Absent means promotion, the default the whole ledger was born with.
    // The instrument filters on it both ways (kind:hub / -kind:hub).
    if ("kind" in r && r.kind !== "hub") {
      warn(`frontier.rows[${i}] ("${r.name}"): "kind" must be "hub" when present (got "${r.kind}") — promotions carry no kind field`);
    }
    // memorial (the Janitor, 2026-08-24, on the frontier-instrument pass):
    // OPTIONAL string naming WHOSE memory a memorial_linked row stands in —
    // a data/memorials.json id, so the served frontier can say "in memory of
    // Joe Smallze" rather than a bare "memorial-linked". Precision over
    // completeness: an ambiguous memorial_linked row leaves this unset (and
    // renders the generic label) rather than guess a person. Only meaningful
    // when the row is memorial_linked in the first place.
    if ("memorial" in r) {
      if (typeof r.memorial !== "string" || !frontierMemorialIds.has(r.memorial)) {
        warn(`frontier.rows[${i}] ("${r.name}"): "memorial" must be a data/memorials.json id (got "${r.memorial}")`);
      }
      if (!r.memorial_linked) {
        warn(`frontier.rows[${i}] ("${r.name}"): carries "memorial" but is not memorial_linked — set memorial_linked or drop the field`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 6e2. THE COLLECTED EDGE (the Janitor's directive, 2026-08-22, superseding THE
//      MISSING-SHOWS LEDGER of 2026-08-20): a show the surviving record
//      proves ran but the collection does not hold is an ordinary
//      shows.json row carrying `collected: false` — filed in its own
//      promotion's shard, listed by every instrument and register, isolated
//      by a collected:no query. The old standalone data/missing-shows.json
//      ledger, its /missing-shows.html page, and the per-wing panel are all
//      retired; the "no speculative rows" discipline survives structurally:
//      an uncollected row must carry a non-empty evidence[] of receipts.
//      An uncollected row never has a page/collection/matches, and carries
//      appearances only in the one shape THE BILLED APPEARANCE allows
//      (kind: "billed", below) — nothing is held to serve, register, or
//      structure.
// ---------------------------------------------------------------------------
// EVIDENCE SHAPE (PROSE-FIX-01, 2026-09-13; proposal.md #1) — 3 rows on file
// carry "evidence" as a bare string instead of the documented array-of-
// {source, note} objects, on EITHER a collected or uncollected row (the
// collected:false check just below only ever looks at uncollected rows).
// Soft, not hard: a naive .map()/.filter() over the field would silently
// break on these three rather than throw, so this is a heads-up, not a
// build-breaker the corpus isn't ready for.
for (const s of shows) {
  if (typeof s.evidence === "string") {
    soft(`show "${s.id}": "evidence" is a bare string, not the documented array of {source, note} objects — a .map()/.filter() reader over this field would silently break on this row`);
  }
}
for (const s of shows) {
  if (!("collected" in s)) continue;
  if (s.collected !== false) { warn(`show "${s.id}": "collected", if present, must be literal false (an ordinary held show simply omits it)`); continue; }
  if (!Array.isArray(s.evidence) || s.evidence.length === 0) {
    warn(`show "${s.id}": collected:false requires a non-empty "evidence" array — every uncollected row carries receipts, no speculative rows`);
  } else {
    for (const [ei, ev] of s.evidence.entries()) {
      if (!ev || typeof ev !== "object" || !ev.source || !ev.note) warn(`show "${s.id}".evidence[${ei}]: needs "source" and "note"`);
    }
  }
  // THE BILLED APPEARANCE (the Janitor's gavel, 2026-08-23, CURATION.md v76)
  // relaxes exactly one clause of this rule, for exactly one kind: an
  // uncollected row MAY carry `appearances` provided EVERY row in it is
  // `kind: "billed"`. A billing is an assertion about a primary source —
  // this document billed this entity for this show — not about the show,
  // so it survives the show itself never having been collected, and indeed
  // that is the case it exists for. `page`/`collection`/`matches`, and any
  // match/angle appearance, are as forbidden here as they ever were.
  const billedOnlyAppearances = Array.isArray(s.appearances) && s.appearances.length > 0
    && s.appearances.every((a) => a && a.kind === "billed");
  for (const banned of ["page", "collection", "appearances", "matches", "also_promotions"]) {
    if (!(banned in s)) continue;
    if (banned === "appearances" && billedOnlyAppearances) continue;
    const extra = banned === "appearances"
      ? ' (only kind:"billed" appearances are permitted on an uncollected row)'
      : "";
    warn(`show "${s.id}": collected:false row carries "${banned}"${extra} — an uncollected show holds nothing to serve or structure; drop the field or drop collected:false`);
  }
  if ("partial" in s && typeof s.partial !== "boolean") warn(`show "${s.id}": "partial", if present, must be a boolean`);
}

// ---------------------------------------------------------------------------
// 6f. wanted.json (if present): array of { name, seen_on: [...] } — informational,
//     just needs to be well-shaped so future tooling can trust it.
// ---------------------------------------------------------------------------
for (const [i, w] of wanted.entries()) {
  if (!w.name || !Array.isArray(w.seen_on)) warn(`wanted[${i}]: needs "name" and "seen_on" array`);
}

// ---------------------------------------------------------------------------
// 6g. shows.json date-precision shape (SCHEMA-HARDENING WAVE): every show's
//     date is { date, precision: exact|month|year|circa|unknown, source? },
//     not a bare string. Also: an optional `appearances` array (THE
//     DISCOVERY LATTICE addendum, framework only) — { who, kind } rows,
//     `kind` restricted to match|angle (deliberately not extended to
//     commentary/refereeing/etc. — a speculative value here is a value
//     someone has to design around later for nothing; the staff-presence
//     question is answered by `capacity` instead), plus `billed` since
//     2026-08-23, added because real data demanded it. Populating this from
//     the card archives is future curation work; it is NOT done this wave.
// ---------------------------------------------------------------------------
// THE BILLED APPEARANCE (the Janitor's gavel, 2026-08-23, CURATION.md v76):
//     a third kind, `billed` — a primary source BILLED this entity for this
//     show, and that is the entire claim. It never asserts the appearance
//     happened; the show may have no results page, or may never have taken
//     place at all. Because the claim is about a document rather than about
//     the show, a `billed` row REQUIRES its own `source` receipt naming the
//     document that did the billing, and is permitted on rows the other two
//     kinds are not: a `collected: false` row (see 6e2 above, the one clause
//     of the collected edge this gavel relaxes) and a held card-only row
//     whose results were never captured.
const APPEARANCE_KINDS = new Set(["match", "angle", "billed"]);
for (const s of shows) {
  if (!s.date || typeof s.date !== "object" || typeof s.date.date !== "string") {
    warn(`show "${s.id}": "date" must be an object { date, precision, source? } (schema-hardening wave), got ${JSON.stringify(s.date)}`);
    continue;
  }
  if (!PRECISIONS.has(s.date.precision)) warn(`show "${s.id}": precision "${s.date.precision}" is not one of exact|month|year|circa|unknown`);
  checkImpossibleDate(`show "${s.id}".date`, s.date);
  for (const [ai, a] of (s.appearances ?? []).entries()) {
    if (!a.who || !a.kind) { warn(`show "${s.id}".appearances[${ai}]: needs "who" and "kind"`); continue; }
    if (!charIds.has(a.who) && !unitIds.has(a.who)) warn(`show "${s.id}".appearances[${ai}]: "who" references unknown character/unit "${a.who}"`);
    if (!APPEARANCE_KINDS.has(a.kind)) warn(`show "${s.id}".appearances[${ai}]: kind "${a.kind}" is not one of ${[...APPEARANCE_KINDS].join("|")}`);
    if (a.kind === "billed" && (typeof a.source !== "string" || !a.source.trim())) {
      warn(`show "${s.id}".appearances[${ai}]: kind "billed" requires a non-empty "source" — the receipt naming the primary source that did the billing (THE BILLED APPEARANCE, the Janitor's gavel, 2026-08-23)`);
    }
  }
  // PHASE-1 PUNCH WAVE item 3: an optional `no_appearances_reason` — a
  // show with genuinely nothing to extract (a listing/index page, an
  // essay-format recap with no structural markers, a non-wrestling-engine
  // document) documents WHY honestly instead of just sitting silently
  // empty. Soft-checked only: present without `appearances` is the normal
  // case this field exists for, but doesn't forbid a show having both
  // (e.g. a partially-recovered card that's mostly-index).
  if ("no_appearances_reason" in s) {
    if (typeof s.no_appearances_reason !== "string" || !s.no_appearances_reason.trim()) {
      warn(`show "${s.id}": "no_appearances_reason" must be a non-empty string`);
    }
  }
}

// ---------------------------------------------------------------------------
// 6h. shows.json `matches` (THE OPPONENTS-PER-MATCH WAVE) — a re-parse of
//     the same structural markers `appearances` came from (W6), one level
//     deeper: which SIDE each participant was on, and (where it parses
//     cleanly) who won. { order, sides?: [[id,...],...], participants?:
//     [id,...], winner_side? }. PRECISION FIRST, same posture as
//     appearances itself: exactly one of sides/participants (never both,
//     never neither) — `sides` only when every side resolved to at least
//     one real entity AND no entity double-books across sides (nobody
//     fights themselves; a cross-side duplicate means the parse itself
//     was contaminated, and the extraction fell back to `participants`
//     rather than keep a self-contradicting shape). `winner_side` is an
//     index into `sides` (so it requires `sides`, never `participants`)
//     and is OMITTED, not guessed, whenever the corpus's own outcome line
//     didn't resolve cleanly to one side.
//     RECONCILIATION: every id named in a show's `matches` must also
//     appear in that SAME show's `appearances` with kind "match" — the
//     extraction pass enriches `appearances` at merge time so this holds
//     by construction; this check exists to catch future drift (a hand
//     edit to one without the other), not to do the enrichment itself.
//
//     THE DECLARED-DRAW / BATTLE-ROYAL-WINNER SCHEMA FIXES (2026-08-20,
//     Janitor-gaveled, both consistent with the existing winner_side/sides
//     shapes rather than a parallel mechanism): (1) `result` — a declared-
//     OUTCOME representation, not a draw-only boolean: for a `sides`-shaped
//     match the served text explicitly resolves to something other than a
//     clean winner — `"draw"` ("The Match is a Draw!", a double-countout
//     call) or `"no-contest"` (an explicit on-page no-contest ruling,
//     surfaced generalizing the Janitor's own draw-specific gavel one
//     value further: declared outcomes are facts either way, `winner_side`
//     simply being absent is reserved for the third, genuinely different
//     case — the outcome wasn't parsed at all, i.e. unset/unresolved). A
//     row never carries both a `result` value and `winner_side` — that's a
//     contradiction, not a hedge. (2) `winner` — a single entity id,
//     usable only alongside `participants` (never `sides`, which already
//     has `winner_side` for exactly this), for a many-entity field (a
//     battle royal, a rumble) whose winner the corpus resolves cleanly
//     even though the entrants weren't parsed into sides at all. Absence
//     of `winner` on a `participants` row means what it always meant —
//     the winner wasn't resolved, never guessed.
// ---------------------------------------------------------------------------
//     THE DOUBLE-PIN MINT (2026-08-26, coordinator-delegated dry mint on
//     the NFW tier-3 crawl). A third declared value, `"double-pin"`: the
//     served text explicitly rules that BOTH sides scored the fall at once
//     — a referee announcing a simultaneous three-count — which is neither
//     a declared draw (the fed did not call it a draw; it called it two
//     pins) nor a no-contest (the match resolved, it resolved twice) nor
//     unset (nothing was left unparsed). Three NFW extraction lanes hit
//     the shape independently and left it unset with the ruling in a note
//     because the vocabulary had no room for it. Receipt:
//     `nfw-crash-tv-9-2002-04-25`, Steel Viper vs. Tempesta del Fuerte,
//     guest referee Adrenaline ruling both men's shoulders down and both
//     men to have scored the pinfall — the fed then booked all three into
//     a three-way off that ruling. Distinct from `winners[]`, which
//     records plural VICTORS of one match; `double-pin` records the
//     opposite reading, a match the fed declined to award to either side
//     while refusing to call it a draw.
const MATCH_RESULTS = new Set(["draw", "no-contest", "double-pin"]);
// ---------------------------------------------------------------------------
//     THE MATCH-SIDE CONVENTION (the Janitor's gavel, 2026-09-02, GAVELS.md; law
//     text in docs/SCHEMA.md's `sides[]` section and CURATION.md
//     #match-side-convention). A side that includes a registered unit names
//     BOTH the unit id AND every member id that unit's own roster gives, and
//     `appearances[]` mirrors the side 1:1 — so a tag match yields a unit row
//     and one row per member. The two checks below are SOFT, never hard
//     fails, deliberately: the gavel carved its own exception (a unit with no
//     recovered roster stands alone, flagged), a members-only side is a fact
//     about how that fed's own card text billed the match rather than a
//     defect, and 166 wings' worth of pre-gavel accession is honest history.
//     `scripts/normalise-match-sides.mjs` is the mechanical arm that closes
//     the gap wherever the roster supports closing it; these warnings are how
//     a newly-processed wing announces it has drifted from the convention.
//     Only members that resolve to a real character id are ever counted, so
//     the roster-less exception never warns.
// ---------------------------------------------------------------------------
const unitRoster = new Map(
  units.map((u) => [
    u.id,
    (u.members ?? []).filter((m) => m && typeof m === "object" && m.character_id).map((m) => m.character_id),
  ]),
);
const unitsOfChar = new Map();
for (const [uid, roster] of unitRoster) {
  for (const cid of roster) {
    if (!unitsOfChar.has(cid)) unitsOfChar.set(cid, []);
    unitsOfChar.get(cid).push(uid);
  }
}
const sideConvention = { missingMembers: 0, missingUnit: 0, memberSamples: [], unitSamples: [] };
for (const s of shows) {
  if (!("matches" in s)) continue;
  if (!Array.isArray(s.matches)) { warn(`show "${s.id}": "matches" must be an array`); continue; }
  const matchAppearanceIds = new Set(
    (s.appearances ?? []).filter((a) => a.kind === "match").map((a) => a.who),
  );
  for (const [mi, m] of s.matches.entries()) {
    const tag = `show "${s.id}".matches[${mi}]`;
    if (typeof m.order !== "number") warn(`${tag}: needs a numeric "order"`);
    const hasSides = "sides" in m, hasParticipants = "participants" in m;
    if (hasSides === hasParticipants) { warn(`${tag}: needs exactly one of "sides" or "participants", not both/neither`); continue; }
    let allIds = [];
    if (hasSides) {
      if (!Array.isArray(m.sides) || m.sides.length < 2) warn(`${tag}: "sides" must be an array of 2+ side arrays`);
      else {
        const seenInSide = new Set();
        for (const [si, side] of m.sides.entries()) {
          if (!Array.isArray(side) || !side.length) { warn(`${tag}.sides[${si}]: must be a non-empty array of entity ids`); continue; }
          for (const id of side) {
            if (!charIds.has(id) && !unitIds.has(id)) warn(`${tag}.sides[${si}]: unknown entity id "${id}"`);
            if (seenInSide.has(id)) warn(`${tag}: entity "${id}" appears in more than one side — a match can't have the same entity on both sides of it`);
            seenInSide.add(id);
            allIds.push(id);
          }
          // THE MATCH-SIDE CONVENTION, the soft half (see this section's own
          // header note). (a) a side naming a unit whose roster members are
          // absent from it; (b) a side naming 2+ characters who share a
          // units.json membership, with no unit id alongside them.
          const sideUnits = side.filter((id) => unitIds.has(id));
          for (const uid of sideUnits) {
            const absent = (unitRoster.get(uid) ?? []).filter((cid) => charIds.has(cid) && !side.includes(cid));
            if (!absent.length) continue;
            sideConvention.missingMembers++;
            if (sideConvention.memberSamples.length < 6) {
              sideConvention.memberSamples.push(`${tag}.sides[${si}] names unit "${uid}" without its own member(s) ${absent.map((x) => `"${x}"`).join(", ")}`);
            }
          }
          if (!sideUnits.length) {
            const shared = new Map();
            for (const cid of side) {
              if (!charIds.has(cid)) continue;
              for (const uid of unitsOfChar.get(cid) ?? []) shared.set(uid, (shared.get(uid) ?? 0) + 1);
            }
            const whole = [...shared.entries()].filter(([, n]) => n >= 2);
            if (whole.length) {
              sideConvention.missingUnit++;
              if (sideConvention.unitSamples.length < 6) {
                sideConvention.unitSamples.push(`${tag}.sides[${si}] names ${whole[0][1]} members of unit "${whole[0][0]}" without the unit id`);
              }
            }
          }
        }
      }
      if ("winner_side" in m) {
        if (typeof m.winner_side !== "number" || m.winner_side < 0 || m.winner_side >= (m.sides?.length ?? 0)) {
          warn(`${tag}: "winner_side" (${m.winner_side}) is not a valid index into "sides"`);
        }
      }
      if ("result" in m) {
        if (!MATCH_RESULTS.has(m.result)) warn(`${tag}: "result" ("${m.result}") is not a recognized value ("draw", "no-contest" or "double-pin")`);
        if ("winner_side" in m) warn(`${tag}: carries both "result" and "winner_side" — a declared draw and a resolved winner are a contradiction, pick one`);
      }
      if ("winner" in m) warn(`${tag}: "winner" requires "participants", not "sides" — use "winner_side" for a sides-shaped match`);
    } else {
      if (!Array.isArray(m.participants) || !m.participants.length) warn(`${tag}: "participants" must be a non-empty array of entity ids`);
      else for (const id of m.participants) {
        if (!charIds.has(id) && !unitIds.has(id)) warn(`${tag}.participants: unknown entity id "${id}"`);
        allIds.push(id);
      }
      if ("winner_side" in m) warn(`${tag}: "winner_side" requires "sides", not "participants"`);
      // result on a participants-shaped match: originally rejected ("only
      // meaningful once entrants are sided") until WWA lane VIII hit two
      // served declared outcomes (a double-DQ, a double-KO draw) on matches
      // whose opponents never resolve to ids — a fed's own declared ruling
      // is a fact regardless of whether every entrant is mintable.
      if ("result" in m) {
        if (!MATCH_RESULTS.has(m.result)) warn(`${tag}: "result" ("${m.result}") is not a recognized value ("draw", "no-contest" or "double-pin")`);
        if ("winner" in m) warn(`${tag}: carries both "result" and "winner" — a declared non-winner outcome and a resolved winner are a contradiction, pick one`);
      }
      if ("winner" in m) {
        if (typeof m.winner !== "string" || !m.winner) warn(`${tag}: "winner" must be a single entity id string`);
        else {
          if (!charIds.has(m.winner) && !unitIds.has(m.winner)) warn(`${tag}: "winner" references unknown entity id "${m.winner}"`);
          if (Array.isArray(m.participants) && !m.participants.includes(m.winner)) warn(`${tag}: "winner" ("${m.winner}") is not one of this match's own "participants"`);
        }
      }
    }
    // winners[]/losers[] (Janitor-gaveled, 2026-08-21): symmetric optional
    // arrays for outcomes the singular fields can't hold — plural winners
    // (co-champions from a double pin, a multi-winner scramble) and the
    // rarer one-loser-many-survivors match. Use ONLY when not derivable:
    // a single winner is winner/winner_side; losers are ordinarily just
    // everyone-else and need no field at all.
    for (const key of ["winners", "losers"]) {
      if (!(key in m)) continue;
      if (!Array.isArray(m[key]) || m[key].length < (key === "winners" ? 2 : 1)) {
        warn(`${tag}: "${key}" must be an array${key === "winners" ? " of 2+ entity ids (a single winner is \"winner\"/\"winner_side\")" : " of 1+ entity ids"}`);
        continue;
      }
      for (const id of m[key]) {
        if (typeof id !== "string" || !id) warn(`${tag}.${key}: entries must be entity id strings`);
        else if (!charIds.has(id) && !unitIds.has(id)) warn(`${tag}.${key}: unknown entity id "${id}"`);
        else if (!allIds.includes(id)) warn(`${tag}.${key}: "${id}" is not one of this match's own entrants`);
      }
    }
    if ("winners" in m) {
      if ("winner" in m || "winner_side" in m) warn(`${tag}: carries "winners" alongside "winner"/"winner_side" — plural and singular outcomes are mutually exclusive, pick one`);
      if ("result" in m) warn(`${tag}: carries both "winners" and "result" — a resolved plural outcome and a declared non-winner outcome are a contradiction, pick one`);
    }
    if ("eliminations" in m) {
      if (!Array.isArray(m.eliminations) || !m.eliminations.length) {
        warn(`${tag}: "eliminations" must be a non-empty array (array order is the elimination sequence)`);
      } else {
        const inMatch = new Set(allIds);
        for (const [ei, e] of m.eliminations.entries()) {
          const etag = `${tag}.eliminations[${ei}]`;
          if (!e || typeof e !== "object" || Array.isArray(e)) { warn(`${etag}: must be an object`); continue; }
          if (typeof e.who !== "string" || !e.who.trim()) warn(`${etag}: needs a non-empty "who" (entity id if minted, else the verbatim billed label)`);
          else if ((charIds.has(e.who) || unitIds.has(e.who)) && !inMatch.has(e.who)) {
            warn(`${etag}: "who" ("${e.who}") is a registered entity that is not in this match's own sides/participants`);
          }
          const bys = e.by === undefined ? [] : Array.isArray(e.by) ? e.by : [e.by];
          for (const b of bys) {
            if (typeof b !== "string" || !b.trim()) warn(`${etag}: "by" entries must be non-empty strings`);
            else if ((charIds.has(b) || unitIds.has(b)) && !inMatch.has(b)) {
              warn(`${etag}: "by" ("${b}") is a registered entity that is not in this match's own sides/participants`);
            }
          }
          for (const k of ["time", "note"]) {
            if (e[k] !== undefined && (typeof e[k] !== "string" || !e[k].trim())) warn(`${etag}: "${k}" must be a non-empty string when present`);
          }
        }
      }
    }
    for (const id of allIds) {
      if (!matchAppearanceIds.has(id)) {
        warn(`${tag}: entity "${id}" is not in show "${s.id}"'s own appearances with kind "match" — run the reconciliation merge`);
      }
    }
  }
}
if (sideConvention.missingMembers) {
  soft(
    `THE MATCH-SIDE CONVENTION (the Janitor's gavel, 2026-09-02): ${sideConvention.missingMembers} match ` +
    `side(s) name a registered unit without listing the member ids its own units.json members[] gives. ` +
    `Roster-less units are the gavel's own exception and are NOT counted here. Close the ones the ` +
    `roster supports with \`node scripts/normalise-match-sides.mjs --apply=unit-to-both\`. First ` +
    `${sideConvention.memberSamples.length}: ${sideConvention.memberSamples.join(" | ")}` +
    (sideConvention.missingMembers > sideConvention.memberSamples.length ? ` | ... and ${sideConvention.missingMembers - sideConvention.memberSamples.length} more` : "")
  );
}
if (sideConvention.missingUnit) {
  soft(
    `THE MATCH-SIDE CONVENTION (the Janitor's gavel, 2026-09-02): ${sideConvention.missingUnit} match ` +
    `side(s) name two or more characters who share a units.json membership, with no unit id alongside ` +
    `them. Each one needs a human read before it moves — the shared unit may be a stable only partly ` +
    `in the match, or a team with no tenure in that fed — which is why this is advisory. ` +
    `\`node scripts/normalise-match-sides.mjs --apply=members-to-both\` closes the unambiguous ones. ` +
    `First ${sideConvention.unitSamples.length}: ${sideConvention.unitSamples.join(" | ")}` +
    (sideConvention.missingUnit > sideConvention.unitSamples.length ? ` | ... and ${sideConvention.missingUnit - sideConvention.unitSamples.length} more` : "")
  );
}

// ---------------------------------------------------------------------------
// 7. Cross-reference links baked into curated HTML pages by
//    scripts/cross-reference.mjs (marked `data-entity="<id>"`) must resolve,
//    and must never appear inside a verbatim artifact page.
// ---------------------------------------------------------------------------
import { statSync } from "node:fs";
function walkHTML(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === ".claude" || name === "node_modules" || name === "functions") continue;
    const p = resolve(dir, name);
    if (statSync(p).isDirectory()) walkHTML(p, out);
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}
const ARTIFACT_RE = /promotions\/[a-z0-9-]+\/archive\/(?!index\.html)/;

// ROSTER QA WAVE: the "name-*" disambiguation-anchor concept is RETIRED
// (user gavel — the fourth recurrence of this fix; see
// scripts/cross-reference.mjs's own header note). A name still ambiguous
// after promotion-context narrowing is left as plain, unlinked text now,
// so no "name-*" pseudo-id is ever a valid link/holder target anymore —
// `disambigAnchors` used to hold the valid set; there isn't one to hold.

// ---------------------------------------------------------------------------
// 7b. reigns.json (if present, THE STRUCTURED REIGNS WAVE): one row per title
//     reign, extracted from the served promotions/*/titles.html ledgers (plus a
//     small, clearly-annotated set of museum-compiled rows sourced from the
//     show corpus where it documents changes beyond even the fed's own
//     revised ledgers — see CURATION.md, "a drive is not the site"). Each
//     holder is either { id } resolving to a real entity (or a "name-*"
//     disambiguation anchor, same convention as #7 above) or an honestly
//     unminted { name, unminted: true } — reign rows never silently invent
//     an entity to fill a gap. "won"/"lost" carry their own date-precision
//     shape; "lost: null" means the record ends there (still champion at
//     the source's own last word), not that the reign is known-open forever.
// ---------------------------------------------------------------------------
{
  const reignIds = new Set();
  function checkReignDate(field, r, i) {
    const d = r[field];
    if (d === null || d === undefined) return; // null is meaningful (see header note)
    if (typeof d !== "object" || !("precision" in d)) {
      warn(`reigns[${i}] ("${r.label}"): "${field}" must be null or an object with a "precision"`);
      return;
    }
    if (!PRECISIONS.has(d.precision)) warn(`reigns[${i}] ("${r.label}"): ${field}.precision "${d.precision}" is not one of exact|month|year|circa|unknown`);
    if (d.date !== null && typeof d.date !== "string") warn(`reigns[${i}] ("${r.label}"): ${field}.date must be a string or null`);
    if (typeof d.date === "string") checkImpossibleDate(`reigns[${i}] ("${r.label}").${field}`, d);
  }
  function checkHolderRef(h, i, r) {
    if (!h || typeof h !== "object") { warn(`reigns[${i}] ("${r.label}"): holder entry must be an object`); return; }
    if (h.unminted === true) {
      if (!h.name) warn(`reigns[${i}] ("${r.label}"): unminted holder needs a "name"`);
    } else if (h.id) {
      // ROSTER QA WAVE: "name-*" pseudo-ids (a holder known to exist but
      // not resolvable to one specific registered entity) are a
      // recognized pattern in their own right now that the disambiguation-
      // anchor concept is retired — not linked anywhere, same as
      // `unminted: true`, just spelled differently in older rows.
      if (!h.id.startsWith("name-") && !idIndex.has(h.id)) {
        warn(`reigns[${i}] ("${r.label}"): holder "${h.id}" does not resolve to any entity`);
      }
    } else {
      warn(`reigns[${i}] ("${r.label}"): holder entry needs either an "id" or "name"+unminted:true`);
    }
  }
  const byTitle = new Map();
  // THE REIGN-END ENUM (prose-shadow audit item 7, 2026-08-22): an optional
  // reign-level `end_how` — how the reign concluded, as a queryable value
  // the how/note prose alone couldn't offer ("every stripped champion" is
  // now a filter). Optional: absent means unrecorded or simply
  // lost-in-match with nothing notable; the prose keeps the story, the
  // enum keeps the query. (Named end_how because `end` already carries a
  // rare end-of-reign date object — see wwa-diablo-r002.)
  const REIGN_END_VALUES = new Set(["lost-in-match", "stripped", "vacated", "forfeited", "awarded-on", "retired", "departed", "still-champion-at-record-end"]);

  for (const [i, r] of reigns.entries()) {
    if (!r.id || !r.title || !Array.isArray(r.holder)) { warn(`reigns[${i}]: needs "id", "title", and a "holder" array`); continue; }
    if (reignIds.has(r.id)) warn(`reigns[${i}]: duplicate reign id "${r.id}"`);
    reignIds.add(r.id);
    if (!titleIds.has(r.title)) warn(`reigns[${i}] ("${r.label}"): title "${r.title}" does not resolve to a data/titles.json id`);
    for (const h of r.holder) checkHolderRef(h, i, r);
    checkReignDate("won", r, i);
    checkReignDate("lost", r, i);
    if ("end_how" in r && !REIGN_END_VALUES.has(r.end_how)) {
      warn(`reigns[${i}] ("${r.label}"): "end_how" value "${r.end_how}" is not one of ${[...REIGN_END_VALUES].join("|")}`);
    }
    // `end` (rare, pre-existing): an end-of-reign DATE object for a reign
    // that concluded without a losing match (a departure) — same shape as
    // won/lost, validated the same way.
    if ("end" in r) checkReignDate("end", r, i);
    if (r.event && !showIds.has(r.event)) warn(`reigns[${i}] ("${r.label}"): event "${r.event}" does not resolve to a data/shows.json id`);
    if (r.conflict?.other_holder && !idIndex.has(r.conflict.other_holder)) {
      warn(`reigns[${i}] ("${r.label}"): conflict.other_holder "${r.conflict.other_holder}" does not resolve to any entity`);
    }
    if (!byTitle.has(r.title)) byTitle.set(r.title, []);
    byTitle.get(r.title).push(r);
  }
  // Chronological ordering within a belt — lenient by design (CURATION.md's registry rule:
  // "documented overlaps/vacancies" are allowed, e.g. same-day hot-potato
  // reigns, or a museum-compiled continuation whose exact start date is
  // honestly unknown). Only flag when TWO consecutive exact-precision "won"
  // dates run backwards — a real ordering bug, not an attested oddity.
  for (const [titleId, rows] of byTitle) {
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1].won, cur = rows[i].won;
      if (prev?.precision === "exact" && cur?.precision === "exact" &&
          typeof prev.date === "string" && typeof cur.date === "string" && cur.date < prev.date) {
        warn(`reigns for "${titleId}": "${rows[i].label}" (won ${cur.date}) is listed after "${rows[i - 1].label}" (won ${prev.date}) but dates run backwards — check ordering`);
      }
    }
  }

  // THE REIGN-SHOW LINKAGE INVARIANT, 2026-08-18 (user gavel, verbatim: "an
  // unlinked date must MEAN the show is missing"). A reign row's own `event`
  // is what makes its "won" cell (and, via the next reign's own `event`
  // chaining above cross-reference.mjs, the PREVIOUS reign's "lost" cell) a
  // link on every generated page instead of a bare date — see
  // `docs/PROCESS.md`. Hard-fail, not soft: a derivation pass just ran and
  // wired every case it could find (uniquely-matching promotion+exact-date,
  // or disambiguated by an initials/name match against the reign's own
  // `how` text where more than one show shared the date); from here on, a
  // reign carrying an exact `won` date and a promotion for which EXACTLY ONE
  // served show shares that date, with no `event` wired, is a regression —
  // most likely a new show landing without its own reigns being reconciled
  // against it. A genuinely ambiguous same-date multi-show case (more than
  // one candidate, no disambiguator) stays unlinked on purpose and is not
  // flagged here — see the reign's own `note` for those, never guessed.
  {
    const titleById = new Map(titles.map((t) => [t.id, t]));
    const showsByPromoDate = new Map();
    for (const s of shows) {
      const d = s.date;
      if (d?.precision === "exact" && d.date) {
        const key = `${s.promotion} ${d.date}`;
        if (!showsByPromoDate.has(key)) showsByPromoDate.set(key, []);
        showsByPromoDate.get(key).push(s.id);
      }
    }
    for (const [i, r] of reigns.entries()) {
      if (r.event || r.won?.precision !== "exact" || !r.won?.date) continue;
      const promo = titleById.get(r.title)?.promotion;
      if (!promo) continue;
      const candidates = showsByPromoDate.get(`${promo} ${r.won.date}`) ?? [];
      if (candidates.length === 1) {
        warn(`reigns[${i}] ("${r.label}"): won ${r.won.date} uniquely matches served show "${candidates[0]}" but "event" isn't wired — link it (or if genuinely ambiguous/wrong, say so in the row's own "note")`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 7c. awards.json — THE AWARD ENTITIES WAVE (2026-08-19): one row per award
//     ENTITY (a promotion + award name), each carrying a bestowals[] array
//     — one entry per documented year/ceremony result, real award names/
//     vote shares recovered from in-character ceremony scripts and served
//     corpus pages, never invented. A bestowal's `recipient`/`runner_up`
//     entries are the same shape as a reigns.json holder: `{ id }`
//     resolving to a real entity, or an honest `{ name, unminted: true }`.
//     `result` defaults to "won" when omitted; `"nominated"` is the only
//     other value, for a documented nomination whose outcome the record
//     doesn't know. Same "generate, don't hand-edit" discipline as
//     titles.json/reigns.json: every award entity needs a generated
//     /awards/<id>.html page — but UNLIKE a title, `epitaph` is optional
//     (most awards are a single bestowal with nothing more to say than the
//     bestowal itself already says), so its absence is never flagged.
// ---------------------------------------------------------------------------
{
  const AWARD_RESULTS = new Set(["won", "nominated"]);
  const awardIds = new Set();
  function checkAwardRefs(list, field, i, a, y) {
    for (const r of list ?? []) {
      if (!r || typeof r !== "object") { warn(`awards[${i}] ("${a.name}", ${y}): "${field}" entry must be an object`); continue; }
      if (r.unminted === true) {
        // RULE 10 (the Janitor gavel 2026-09-13, AWARD RECIPIENTS ARE MINTED;
        // LAW-INDEX 2b): every bestowal RECIPIENT gets a character/unit
        // record, even when the bestowal is all that is known. `unminted`
        // stays a legal shape (a recipient that is a SHOW or a MATCH — "Match
        // of the Year" — has no character to mint), so this is ratcheted
        // rather than hard-failed: the count of unminted recipients may fall,
        // never rise.
        if (field === "recipient") lawHit("award-recipient-unminted");
        if (!r.name) warn(`awards[${i}] ("${a.name}", ${y}): unminted "${field}" entry needs a "name"`);
      } else if (r.id) {
        if (!idIndex.has(r.id)) warn(`awards[${i}] ("${a.name}", ${y}): "${field}" "${r.id}" does not resolve to any entity`);
      } else {
        warn(`awards[${i}] ("${a.name}", ${y}): "${field}" entry needs either an "id" or "name"+unminted:true`);
      }
    }
  }
  for (const [i, a] of awards.entries()) {
    if (!a.id || a.type !== "award" || !a.promotion || !a.name || !a.page || !Array.isArray(a.bestowals)) {
      warn(`awards[${i}]: needs "id", type:"award", "promotion", "name", "page", and a "bestowals" array`);
      continue;
    }
    if (awardIds.has(a.id)) warn(`awards[${i}]: duplicate award id "${a.id}"`);
    awardIds.add(a.id);
    if (!promoIds.has(a.promotion)) warn(`awards[${i}] ("${a.name}"): promotion "${a.promotion}" does not resolve`);
    if (!existsSync(resolve(ROOT, a.page.replace(/^\//, "")))) {
      warn(`awards[${i}] ("${a.name}"): no ${a.page} page exists — run \`npm run refresh:links\` to generate it`);
    }
    if (a.epitaph !== undefined && (typeof a.epitaph !== "string" || !a.epitaph.trim())) {
      warn(`awards[${i}] ("${a.name}"): "epitaph" is present but empty — omit the key entirely rather than an empty string (epitaph is optional here, unlike titles.json)`);
    }
    if (!a.bestowals.length) warn(`awards[${i}] ("${a.name}"): "bestowals" array is empty — an award entity with nothing bestowed shouldn't exist`);
    for (const [j, b] of a.bestowals.entries()) {
      if (!b.year || !Array.isArray(b.recipient) || !b.source) {
        warn(`awards[${i}] ("${a.name}") bestowal[${j}]: needs "year", a "recipient" array, and "source"`);
        continue;
      }
      if (typeof b.year !== "number") warn(`awards[${i}] ("${a.name}") bestowal[${j}]: "year" should be a number`);
      // THE RANKED BESTOWAL (the RSPWF Top 200 accession, 2026-08-23):
      // `rank` is an OPTIONAL positive integer for an award whose own
      // bestowal is a PLACE in an ordered field rather than a single
      // winner — a year-end ranked poll, a tournament's own finishing
      // order. Absent on every ordinary award, and its absence means
      // exactly that (no place was recorded), never rank 0 or rank 1.
      if (b.rank !== undefined && (!Number.isInteger(b.rank) || b.rank < 1)) {
        warn(`awards[${i}] ("${a.name}", ${b.year}) bestowal[${j}]: "rank" must be a positive integer (a place in an ordered field), got ${JSON.stringify(b.rank)} — omit the key entirely where the record records no place`);
      }
      if (b.result !== undefined && !AWARD_RESULTS.has(b.result)) warn(`awards[${i}] ("${a.name}", ${b.year}): result "${b.result}" is not "won" or "nominated"`);
      checkAwardRefs(b.recipient, "recipient", i, a, b.year);
      checkAwardRefs(b.runner_up, "runner_up", i, a, b.year);
    }
  }
}

// ---------------------------------------------------------------------------
// 7d. relationships.json (if present, THE GAME-VALUABLE DATAPOINTS WAVE):
//     character/unit relationship edges — feud, tag-partner, manager-of,
//     kayfabe-kin, kayfabe-spouse, mentor. `a`/`b` are always real entity
//     ids (never an unheld/unminted escape hatch — a relationship needs two
//     actual entities to connect, unlike an award's recipient). For
//     `manager-of`, `a` is the manager and `b` the managed, by convention.
//     Evidence-graded exactly like an identity assertion.
// ---------------------------------------------------------------------------
{
  // "ally" (THE FLAT-FILE DATABASE WAVE, W8) joins the set — the UWF's own
  // CGI roster database tracked a plain, undirected "ally" relationship
  // distinct from tag-partner (a specific in-ring pairing) or manager-of (a
  // specific managerial one); kept as its own nature rather than forced
  // into tag-partner, since the source itself didn't conflate them.
  const RELATIONSHIP_NATURES = new Set(["feud", "tag-partner", "manager-of", "kayfabe-kin", "kayfabe-spouse", "mentor", "ally", "same-handler"]);
  const relIds = new Set();
  for (const [i, r] of relationships.entries()) {
    if (!r.id || !r.a || !r.b || !r.nature || !r.grade || !r.source) {
      warn(`relationships[${i}]: needs "id", "a", "b", "nature", "grade", and "source"`);
      continue;
    }
    if (relIds.has(r.id)) warn(`relationships[${i}]: duplicate relationship id "${r.id}"`);
    relIds.add(r.id);
    if (!idIndex.has(r.a)) warn(`relationships[${i}] ("${r.id}"): "a" references unknown entity "${r.a}"`);
    if (!idIndex.has(r.b)) warn(`relationships[${i}] ("${r.id}"): "b" references unknown entity "${r.b}"`);
    // hook c281 (lane MERGE-HYGIENE, 2026-10-11): a self-edge. A merge of the two ends once left one (a = b, wave
    // CHAD-DUPREE-MERGE); scripts/fixers/merge_hygiene.py now removes it at the repoint.
    if (r.a === r.b) warn(`relationships[${i}] ("${r.id}"): a self-edge — "a" and "b" are both "${r.a}"; an edge needs two entities (a merge of its two ends leaves this; remove the row)`);
    if (!RELATIONSHIP_NATURES.has(r.nature)) warn(`relationships[${i}] ("${r.id}"): nature "${r.nature}" is not one of ${[...RELATIONSHIP_NATURES].join("|")}`);
    if (!GRADES.has(r.grade)) warn(`relationships[${i}] ("${r.id}"): grade "${r.grade}" is not one of primary-source|user-attested|presumed`);
  }
}

let linkCount = 0;
for (const file of walkHTML(ROOT)) {
  const rel = file.slice(ROOT.length + 1);
  const html = readFileSync(file, "utf8");
  const re = /data-entity="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    linkCount++;
    const id = m[1];
    if (ARTIFACT_RE.test(rel)) warn(`${rel}: entity link found inside a verbatim artifact page — cross-references must live only on curated pages`);
    // ROSTER QA WAVE: a "name-*" data-entity attribute shouldn't exist in
    // freshly-generated HTML anymore (see cross-reference.mjs's strip
    // pass) — if one somehow survives, flag it plainly rather than check
    // it against a disambiguation-anchor set that no longer exists.
    if (id.startsWith("name-")) {
      warn(`${rel}: stale "name-*" disambiguation link "${id}" — the concept is retired; run \`npm run refresh:links\` to strip it`);
    } else if (!idIndex.has(id)) {
      warn(`${rel}: entity link references unknown id "${id}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// 7b. CLACKS HEADER FRESHNESS (Terry Pratchett's Discworld "GNU" convention
//    — "a man is not dead while his name is still spoken"). `_headers`
//    carries one `X-Clacks-Overhead: GNU <name>` line per data/memorials.json
//    entry, BUILD-STAMPED by scripts/stamp-stats.mjs between the
//    "# clacks:start" / "# clacks:end" markers. A remembered name silently
//    missing from the overhead is exactly the drift this museum exists to
//    prevent, so this hard-fails rather than warns. Fix: `npm run stats`.
// ---------------------------------------------------------------------------
{
  const headersPath = resolve(ROOT, "_headers");
  if (!existsSync(headersPath)) {
    warn("_headers is missing — can't verify clacks-header freshness");
  } else {
    const raw = readFileSync(headersPath, "utf8");
    const m = raw.match(/# clacks:start\n([\s\S]*?)  # clacks:end/);
    if (!m) {
      warn('_headers: no "# clacks:start" / "# clacks:end" marker pair found — run `npm run stats`');
    } else {
      const stampedNames = [...m[1].matchAll(/X-Clacks-Overhead: GNU (.+)/g)].map((mm) => mm[1].trim());
      const liveNames = computeClacksNames();
      if (stampedNames.length !== liveNames.length || stampedNames.some((n, i) => n !== liveNames[i])) {
        warn(`_headers: clacks header (${stampedNames.join(", ") || "none"}) doesn't match data/memorials.json (${liveNames.join(", ")}) — stale, run \`npm run stats\``);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 8. LOBBY DOOR-COUNT FRESHNESS (THE LOBBY STATS WAVE, W7; retargeted onto
//    the door lines themselves, W9 rider) — same chrome-system pattern as
//    the masthead/footer: each counted door's own "(N)" on index.html is
//    BUILD-STAMPED by scripts/stamp-stats.mjs via a
//    `<!--stat:KEY-->(N)<!--/stat-->` marker sitting right after the door's
//    title text, not hand-typed and not fetched by client-side JS. This
//    recomputes the same counts from the SAME shared computeStats()
//    (imported, not re-implemented) and fails the build if any door's
//    stamped number doesn't match what the registry actually says right
//    now. Fix: `npm run stats`, then commit.
// ---------------------------------------------------------------------------
{
  const indexPath = resolve(ROOT, "index.html");
  if (!existsSync(indexPath)) {
    warn("index.html is missing — can't verify lobby door-count freshness");
  } else {
    const indexHtml = readFileSync(indexPath, "utf8");
    const stamped = new Map();
    const markerRe = /<!--stat:([a-z]+)-->\(([\d,]+)\)<!--\/stat-->/g;   // D255 (2026-10-03): counts print with thousands separators
    let tm;
    while ((tm = markerRe.exec(indexHtml))) stamped.set(tm[1], parseInt(tm[2].replace(/,/g, ""), 10));
    if (!stamped.size) {
      warn("index.html: no <!--stat:KEY-->(N)<!--/stat--> door markers found — run `npm run stats`");
    } else {
      const live = computeStats();
      for (const s of live) {
        if (!stamped.has(s.key)) { warn(`index.html: door marker "${s.key}" is missing — run \`npm run stats\``); continue; }
        if (stamped.get(s.key) !== s.count) {
          warn(`index.html: door "${s.key}" is stamped (${stamped.get(s.key)}) but the registry currently says ${s.count} — stale, run \`npm run stats\``);
        }
      }
      for (const key of stamped.keys()) {
        if (!live.some((s) => s.key === key)) warn(`index.html: door marker "${key}" is not produced by computeStats() anymore`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 8-bis. LIST-PAGE TOTAL FRESHNESS (THE LIST-PAGES WAVE, 2026-10-03) — the
//    same marker discipline as the doors above, one level in: each of the six
//    instrument pages carries its own total as plain text, stamped by
//    stamp-stats.mjs's stampListTotals() from the index's own `_rows` header,
//    so the page says how much is there before the index has arrived and
//    without any JavaScript at all. Recomputed here from the SAME shared
//    computeListTotals(). Fix: `npm run stats`, then commit.
// ---------------------------------------------------------------------------
{
  for (const row of computeListTotals()) {
    const path = resolve(ROOT, row.page);
    if (!existsSync(path)) { warn(`${row.page} is missing — can't verify its list total`); continue; }
    const html = readFileSync(path, "utf8");
    const m = /<!--stat:listtotal-->([\d,]*)<!--\/stat-->/.exec(html);
    if (!m) { warn(`${row.page}: no <!--stat:listtotal--> marker pair found — run \`npm run stats\``); continue; }
    if (row.count == null) { warn(`data/${row.index} is missing or carries no "_rows" header — run \`npm run refresh:links\``); continue; }
    const stamped = parseInt(m[1].replace(/,/g, ""), 10);
    if (stamped !== row.count) {
      warn(`${row.page}: the list total is stamped (${m[1]}) but data/${row.index} carries ${row.count} rows — stale, run \`npm run stats\``);
    }
  }
}

// ---------------------------------------------------------------------------
// 8a. RECENTLY-ADDED BLOCK FRESHNESS (THE GENERATED-BLURB GAVEL, 2026-08-18)
//     — same chrome-system pattern again: index.html's "Recently added"
//     list is BUILD-STAMPED by scripts/stamp-stats.mjs's stampRecentlyAdded()
//     between `<!-- recently-added:start/end -->` markers, computed fresh
//     from the live registry alone — the newest accession lots in
//     data/collections.json plus each lot's own live fact line
//     (mechanized selection, THE PROMOTIONS-PATH WAVE, 2026-08-22;
//     site-config.json's hand list is retired), never hand-typed. This exists specifically because the
//     block's own prior hand-written version once centered a held
//     character's cameo in another promotion's own line (the WWA/NAPW
//     blurbs) — regenerating it from scratch every time makes that class of
//     mistake structurally impossible, not just fixed once. Fix: `npm run
//     stats`, then commit.
// ---------------------------------------------------------------------------
{
  const indexPath = resolve(ROOT, "index.html");
  if (existsSync(indexPath)) {
    const indexHtml = readFileSync(indexPath, "utf8");
    const m = indexHtml.match(/<!-- recently-added:start -->\n([\s\S]*?)\n\s*<!-- recently-added:end -->/);
    if (!m) {
      warn("index.html: no recently-added:start/end marker pair found — run `npm run stats`");
    } else {
      const live = computeRecentlyAdded();
      const expected = `  ${recentlyAddedListHtml(live)}`;
      if (m[1].trim() !== expected.trim()) {
        warn("index.html: recently-added block is stale against the live registry (the newest accession rows from collections.json and documents.json) — run `npm run stats`");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 8a1b. REGISTER COMPLETENESS FRESHNESS (the A-Z REGISTERS rider, THE
//       PROMOTIONS-PATH WAVE, 2026-08-22) — every entity surface carries a
//       complete no-JS alphabetical register, every event surface a
//       chronological one, all generated by scripts/cross-reference.mjs.
//       A register whose total row count has drifted from the live
//       registry means someone forgot `npm run refresh:links` — the same
//       row-count freshness guarantee the instrument indexes already have.
//       Rows are counted the way validate.mjs's row-budget heuristic
//       counts them: roster-cards for card-shaped registers, <li> for
//       list-shaped ones. A register directory holding only index.html is
//       the single-page shape (rows live in the index); otherwise the
//       index is a letter/year link list and only the non-index pages
//       carry rows.
// ---------------------------------------------------------------------------
{
  const countRows = (files, kind) => files.reduce((n, f) => {
    const html = readFileSync(f, "utf8");
    return n + (kind === "cards"
      ? (html.match(/class="roster-card"/g) || []).length
      : (html.match(/<li[\s>]/g) || []).length);
  }, 0);
  const alphaSpecs = [
    { dir: "characters/a-z", kind: "cards", expected: characters.length, label: "characters" },
    { dir: "units/a-z", kind: "cards", expected: units.length, label: "units" },
    { dir: "promotions/a-z", kind: "list", expected: promotions.length, label: "promotions" },
    { dir: "titles/a-z", kind: "list", expected: titles.length, label: "championships" },
    { dir: "awards/a-z", kind: "list", expected: awards.length, label: "awards" },
  ];
  for (const spec of alphaSpecs) {
    const dirAbs = resolve(ROOT, ...spec.dir.split("/"));
    if (!existsSync(dirAbs)) { warn(`${spec.dir}/: alphabetical register missing — run \`npm run refresh:links\``); continue; }
    let files = readdirSync(dirAbs).filter((f) => f.endsWith(".html")).map((f) => resolve(dirAbs, f));
    if (files.length > 1) files = files.filter((f) => !f.endsWith("index.html"));
    const n = countRows(files, spec.kind);
    if (n !== spec.expected) warn(`${spec.dir}/: register carries ${n} ${spec.label} rows, registry has ${spec.expected} — run \`npm run refresh:links\``);
  }
  const chronoSpecs = [
    { root: "shows", expected: shows.length, label: "shows" },
    { root: "rps", expected: rps.length, label: "roleplays" },
  ];
  for (const spec of chronoSpecs) {
    const rootAbs = resolve(ROOT, spec.root);
    if (!existsSync(rootAbs)) { warn(`${spec.root}/: chronological register missing — run \`npm run refresh:links\``); continue; }
    const files = [];
    for (const de of readdirSync(rootAbs, { withFileTypes: true })) {
      if (!de.isDirectory()) continue;
      for (const f of readdirSync(resolve(rootAbs, de.name))) {
        if (f.endsWith(".html")) files.push(resolve(rootAbs, de.name, f));
      }
    }
    const n = countRows(files, "list");
    if (n !== spec.expected) warn(`${spec.root}/<year>/: chronological register carries ${n} ${spec.label} rows, registry has ${spec.expected} — run \`npm run refresh:links\``);
  }
}

// ---------------------------------------------------------------------------
// 8a2. CURATION.HTML VERSION-LINE FRESHNESS (PERFECTION WAVE A, 2026-08-21)
//      — same chrome-system pattern once more: curation.html's own "Current
//      version: vNN, <title>, <date>" line is BUILD-STAMPED by
//      scripts/stamp-stats.mjs's stampCurationVersion() between
//      `<!-- curation-version:start/end -->` markers, derived from
//      CURATION.md's OWN changelog tail (computeCurationVersion(), the same
//      shared code path, never hand-typed and never re-implemented here).
//      This exists because the line drifted TWICE by hand before this wave
//      (stale at v47, hand-corrected since, with nothing catching the next
//      drift) — the same "a fact lives in exactly one place, and every
//      rendering of it is checked against that place" discipline the door
//      counts and clacks header already enforce, closing the one remaining
//      hand-stamped fact on this page. Hard fail, same as stale chrome.
//      Fix: `npm run stats`, then commit.
// ---------------------------------------------------------------------------
{
  const curationPath = resolve(ROOT, "curation.html");
  if (!existsSync(curationPath)) {
    warn("curation.html is missing — can't verify version-line freshness");
  } else {
    const html = readFileSync(curationPath, "utf8");
    const m = html.match(/<!-- curation-version:start -->([\s\S]*?)<!-- curation-version:end -->/);
    // hook c142 (2026-10-08): the Janitor's own edit of curation.html took the "Current version" paragraph off the page. A
    // page that does not print the line cannot drift from CURATION.md, so its absence is not a finding — stamp-stats.mjs
    // skips the stamp for the same reason. The freshness check below is unchanged, and still hard wherever the pair IS there.
    if (m) {
      let live;
      try {
        live = computeCurationVersion();
      } catch (e) {
        warn(`curation.html: couldn't derive the expected version line from CURATION.md's own changelog — ${e.message}`);
        live = null;
      }
      if (live) {
        const expected = `v${live.v}, ${live.title}, ${live.date.replace(/-/g, "&#8209;")}`;
        if (m[1] !== expected) {
          warn(`curation.html: version line is stamped ("${m[1]}") but CURATION.md's own changelog tail currently says "${expected}" — stale, run \`npm run stats\``);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 8b. characters-index.json / units-index.json FRESHNESS (THE 397/400 FUSE
//     WAVE; file renamed from wrestlers-index.json THE FRONT-ENTRANCE
//     RENAME, 2026-08-20; split per-type by THE UNITS SPLIT, REVIEW-FIXES
//     WAVE 2026-08-22) — the JSON characters.html/units.html (the
//     instruments) fetch at runtime; build artifacts, not hand-authored
//     data, so each row count should always equal its own type's registry
//     total. A mismatch means someone minted/edited an entity and forgot
//     `npm run refresh:links`.
// ---------------------------------------------------------------------------
{
  const idxPath = resolve(DATA, "characters-index.json");
  if (!existsSync(idxPath)) {
    warn("data/characters-index.json is missing — run `npm run refresh:links`");
  } else {
    const idx = loadArray("characters-index");
    // hook c113 (ONE ROW PER PORTRAYED REAL PERSON, scripts/cross-reference.mjs): a character carrying `portrayal_of`
    // whose figure resolves and sits on its own `portrays` is listed once per figure, not once per portrayal. So the
    // index holds the registry's characters, less those, plus one row per figure they portray.
    const figIds = new Set(externalFigures.map((f) => f.id));
    const folded = characters.filter((c) => c && c.type !== "unit" && typeof c.portrayal_of === "string" && figIds.has(c.portrayal_of)
      && ("portrays" in c ? (Array.isArray(c.portrays) ? c.portrays : [c.portrays]) : []).some((pt) => pt && pt.figure === c.portrayal_of));
    const expected = characters.length - folded.length + new Set(folded.map((c) => c.portrayal_of)).size;
    if (idx.length !== expected) {
      warn(`data/characters-index.json has ${idx.length} rows but the registry currently has ${characters.length} characters (${expected} index rows: ${folded.length} portrayals listed under their ${expected - characters.length + folded.length} figures) — stale, run \`npm run refresh:links\``);
    }
  }
}
{
  const idxPath = resolve(DATA, "units-index.json");
  if (!existsSync(idxPath)) {
    warn("data/units-index.json is missing — run `npm run refresh:links`");
  } else {
    const idx = loadArray("units-index");
    if (idx.length !== units.length) {
      warn(`data/units-index.json has ${idx.length} rows but the registry currently has ${units.length} units — stale, run \`npm run refresh:links\``);
    }
  }
}

// ---------------------------------------------------------------------------
// 8b-2. matches-index.json FRESHNESS (THE MATCH SECTION, 2026-08-20) — same
//     discipline as 8b above: matches-index.json is a build artifact
//     matches.html fetches at runtime, one row per data/shows.json
//     matches[] entry across every promotion. Its own row count should
//     always equal the live total, or someone edited shows.json and forgot
//     `npm run refresh:links`.
// ---------------------------------------------------------------------------
{
  const idxPath = resolve(DATA, "matches-index.json");
  // THE MATCHES-INDEX PURITY RULE (REVIEW-FIXES WAVE, 2026-08-22, the Janitor:
  // a participant search returned "UWF Contest of Champions II — Seymour
  // Almasy" with no match actually noted — an under-parsed matches[] row
  // with one resolvable entrant and no outcome/stipulation/note renders as
  // a bare name, not a match): only a matches[] row with actual match
  // content indexes — two-plus entrants, or any outcome/stipulation/
  // eliminations/note. MUST mirror cross-reference.mjs's own
  // matchHasIndexableContent() exactly, or this freshness count lies.
  const matchIndexable = (m) => {
    const entrants = (m.sides ?? []).flat().length + (m.participants?.length ?? 0);
    return entrants >= 2 || m.winner_side != null || m.winner != null ||
      (m.winners?.length ?? 0) > 0 || (m.losers?.length ?? 0) > 0 ||
      m.result != null || m.stipulation != null ||
      (m.eliminations?.length ?? 0) > 0 || m.note != null;
  };
  const expectedMatches = shows.reduce((n, s) => n + (s.matches ?? []).filter(matchIndexable).length, 0);
  if (!existsSync(idxPath)) {
    warn("data/matches-index.json is missing — run `npm run refresh:links`");
  } else {
    const idx = loadArray("matches-index");
    if (idx.length !== expectedMatches) {
      warn(`data/matches-index.json has ${idx.length} rows but data/shows.json currently carries ${expectedMatches} indexable matches[] rows — stale, run \`npm run refresh:links\``);
    }
  }
}

// ---------------------------------------------------------------------------
// 8b-3/4/5. reigns-index.json / appearances-index.json / awards-index.json
//     FRESHNESS (THE INSTRUMENTS WAVE, 2026-08-22) — same discipline as
//     8b/8b-2 above, one hard-fail block per new instrument: each index is a
//     build artifact a page (reigns.html/appearances.html/awards.html)
//     fetches at runtime, and its own row count should always equal the
//     live registry total, or someone edited reigns.json/shows.json/
//     awards.json and forgot `npm run refresh:links`.
// ---------------------------------------------------------------------------
{
  const idxPath = resolve(DATA, "reigns-index.json");
  if (!existsSync(idxPath)) {
    warn("data/reigns-index.json is missing — run `npm run refresh:links`");
  } else {
    const idx = loadArray("reigns-index");
    if (idx.length !== reigns.length) {
      warn(`data/reigns-index.json has ${idx.length} rows but data/reigns.json currently carries ${reigns.length} rows — stale, run \`npm run refresh:links\``);
    }
  }
}
{
  const idxPath = resolve(DATA, "appearances-index.json");
  // QA round 2 (2026-08-22): the index bakes NON-MATCH presences only —
  // match rows live whole in the Matches instrument. Must mirror
  // cross-reference.mjs's bake filter exactly.
  const expectedAppearances = shows.reduce((n, s) => n + (s.appearances ?? []).filter((a) => a.kind !== "match").length, 0);
  if (!existsSync(idxPath)) {
    warn("data/appearances-index.json is missing — run `npm run refresh:links`");
  } else {
    const idx = loadArray("appearances-index");
    if (idx.length !== expectedAppearances) {
      warn(`data/appearances-index.json has ${idx.length} rows but data/shows.json currently carries ${expectedAppearances} appearances[] rows — stale, run \`npm run refresh:links\``);
    }
  }
}
{
  const idxPath = resolve(DATA, "awards-index.json");
  const expectedBestowals = awards.reduce((n, a) => n + (a.bestowals?.length ?? 0), 0);
  if (!existsSync(idxPath)) {
    warn("data/awards-index.json is missing — run `npm run refresh:links`");
  } else {
    const idx = loadArray("awards-index");
    if (idx.length !== expectedBestowals) {
      warn(`data/awards-index.json has ${idx.length} rows but data/awards.json currently carries ${expectedBestowals} bestowals[] rows — stale, run \`npm run refresh:links\``);
    }
  }
}

// ---------------------------------------------------------------------------
// 8b-6/7/8/9. shows-index.json / rps-index.json / halloffame-index.json /
//     relationships-index.json FRESHNESS (hook c177, adversarial review
//     2026-10-09 finding B01 -- the four indexes hooks c168 and c174 add) --
//     the same discipline as 8b / 8b-2 / 8b-3/4/5 above, one hard-fail block
//     per instrument: each index is a build artifact a page
//     (shows.html / rps.html / halloffame.html / relationships.html) fetches
//     at runtime, and its own row count should always equal the live total,
//     or someone edited shows.json / rps.json / rp-catalog.json /
//     inductions.json / relationships.json and forgot
//     `npm run refresh:links`. Section 8-bis checks each page's STAMPED
//     total against its index's own `_rows` header -- index against page,
//     never index against registry -- so a stale index whose header matches
//     its own stale body passes 8-bis; this is the fuse that does not.
//     Each expected count MUST mirror its builder in cross-reference.mjs
//     exactly, the same rule 8b-2's own matchIndexable comment states, or
//     the freshness count lies.
//     THE FIRST-CYCLE CASE: a new index is written only by the gate's own
//     refresh:links, which runs after preflight's data check, so on the
//     first cycle after c168/c174 go in the file is not there yet. Every
//     message below ends "run `npm run refresh:links`", which is
//     scripts/ops/preflight.sh's own DEFER regex, so preflight defers the
//     line to the gate instead of reding, and the gate -- which checks
//     after its own refresh -- judges it for real. Same route hook c176's
//     section-8-bis line takes (the 2026-10-08 stamp-stats skip rule).
// ---------------------------------------------------------------------------
{
  const idxPath = resolve(DATA, "shows-index.json");
  // cross-reference.mjs's showsIndex is `shows.map(...)`, every row, no filter
  // -- including THE COLLECTED EDGE rows (the Janitor, 2026-08-22: a show the
  // record proves ran but the collection does not hold is a row like any
  // other), which is why this is the registry's plain total.
  if (!existsSync(idxPath)) {
    warn("data/shows-index.json is missing — run `npm run refresh:links`");
  } else {
    const idx = loadArray("shows-index");
    if (idx.length !== shows.length) {
      warn(`data/shows-index.json has ${idx.length} rows but data/shows.json currently carries ${shows.length} shows — stale, run \`npm run refresh:links\``);
    }
  }
}
{
  const idxPath = resolve(DATA, "rps-index.json");
  // MUST mirror cross-reference.mjs's rps-index builder: every data/rps.json
  // row (THE INDEX OPENS PRE-FILTERED, CURATION.md v122(b): collected "yes"
  // is every rps.json row, which is what the lobby's Roleplays door counts),
  // plus one GHOST row per rp-catalog.json row whose own `held` is false --
  // THE COLLECTED EDGE for roleplays: the record proves it existed, the
  // collection does not hold it.
  const expectedRps = rps.length + rpCatalog.filter((c) => c.held === false).length;
  if (!existsSync(idxPath)) {
    warn("data/rps-index.json is missing — run `npm run refresh:links`");
  } else {
    const idx = loadArray("rps-index");
    if (idx.length !== expectedRps) {
      warn(`data/rps-index.json has ${idx.length} rows but data/rps.json + data/rp-catalog.json currently carry ${expectedRps} roleplay rows (${rps.length} held, ${expectedRps - rps.length} recorded but not held) — stale, run \`npm run refresh:links\``);
    }
  }
}
{
  const idxPath = resolve(DATA, "halloffame-index.json");
  // MUST mirror cross-reference.mjs's hofRows filter -- `.filter((r) => r.label)`
  // over inductions.map(renderInductionRow): an induction indexes when it
  // renders a label at all. THE UNMINTED INDUCTEE (CURATION.md v108) takes its
  // label from the inline `inductee` object's own name; a minted one from the
  // entity, and cross-reference.mjs renames a blank-named character or unit to
  // "Unnamed (<id>)" before it builds any row, so a resolved inductee always
  // carries one; an id that resolves to nothing is its own label. Only an
  // induction with no usable inductee at all drops out of the index.
  const hofEntity = new Map([...characters, ...units].map((e) => [e.id, e]));
  const hofLabel = (ind) => {
    if (ind.inductee && typeof ind.inductee === "object") return String(ind.inductee.name ?? "");
    const e = hofEntity.get(ind.inductee);
    if (e) return String(e.name ?? "").trim() ? String(e.name) : `Unnamed (${e.id})`;
    return String(ind.inductee ?? "");
  };
  const expectedInductions = inductions.filter((ind) => hofLabel(ind) !== "").length;
  if (!existsSync(idxPath)) {
    warn("data/halloffame-index.json is missing — run `npm run refresh:links`");
  } else {
    const idx = loadArray("halloffame-index");
    if (idx.length !== expectedInductions) {
      warn(`data/halloffame-index.json has ${idx.length} rows but data/inductions.json currently carries ${expectedInductions} inductions that render a label (of ${inductions.length} rows) — stale, run \`npm run refresh:links\``);
    }
  }
}
{
  const idxPath = resolve(DATA, "relationships-index.json");
  // cross-reference.mjs's relRows is `relationships.map(...)`, every edge, no
  // filter: one row per data/relationships.json row.
  if (!existsSync(idxPath)) {
    warn("data/relationships-index.json is missing — run `npm run refresh:links`");
  } else {
    const idx = loadArray("relationships-index");
    if (idx.length !== relationships.length) {
      warn(`data/relationships-index.json has ${idx.length} rows but data/relationships.json currently carries ${relationships.length} rows — stale, run \`npm run refresh:links\``);
    }
  }
}

// ---------------------------------------------------------------------------
// 8b-10. titles-index.json FRESHNESS (hook c199, adversarial review
//     2026-10-09 finding B01 — the index championships.html now reads) —
//     the same discipline as 8b / 8b-2 / 8b-3/4/5 / 8b-6/7/8/9 above: the
//     index is a build artifact the page fetches at runtime, and its own
//     row count should always equal the live total, or someone edited
//     data/titles.json and forgot `npm run refresh:links`. Section 8-bis
//     checks a page's STAMPED total against the index's own `_rows` header
//     — index against page, never index against registry — so a stale
//     index whose header matches its own stale body passes it; this is the
//     fuse that does not. The expected count MIRRORS the builder in
//     cross-reference.mjs exactly (`titles.map(titleListRow)`, every row,
//     no filter), or the freshness count lies.
//     THE FIRST-CYCLE CASE: the message ends "run `npm run refresh:links`",
//     which is scripts/ops/preflight.sh's own DEFER regex, so preflight
//     defers the line to the gate instead of reding, and the gate — which
//     checks after its own refresh — judges it for real.
// ---------------------------------------------------------------------------
{
  const idxPath = resolve(DATA, "titles-index.json");
  if (!existsSync(idxPath)) {
    warn("data/titles-index.json is missing — run `npm run refresh:links`");
  } else {
    const idx = loadArray("titles-index");
    if (idx.length !== titles.length) {
      warn(`data/titles-index.json has ${idx.length} rows but data/titles.json currently carries ${titles.length} championships — stale, run \`npm run refresh:links\``);
    }
  }
}

// ---------------------------------------------------------------------------
// 8b-11. awards-list-index.json FRESHNESS (hook c201, adversarial review
//     2026-10-09 finding B01 — the index awards.html now reads; NOT
//     data/awards-index.json, which is the bestowal ledger
//     /bestowals.html reads and which section 8b-5 already fuses) — the
//     same discipline as its siblings above: the index is a build artifact
//     the page fetches at runtime, and its own row count should always
//     equal the live total, or someone edited data/awards.json and forgot
//     `npm run refresh:links`. The expected count MIRRORS the builder in
//     cross-reference.mjs exactly (`awards.map(awardListRow)`, every row,
//     one row per award ENTITY, no filter), or the freshness count lies.
//     THE FIRST-CYCLE CASE: the message ends "run `npm run refresh:links`",
//     which is scripts/ops/preflight.sh's own DEFER regex, so preflight
//     defers the line to the gate instead of reding, and the gate — which
//     checks after its own refresh — judges it for real.
// ---------------------------------------------------------------------------
{
  const idxPath = resolve(DATA, "awards-list-index.json");
  if (!existsSync(idxPath)) {
    warn("data/awards-list-index.json is missing — run `npm run refresh:links`");
  } else {
    const idx = loadArray("awards-list-index");
    if (idx.length !== awards.length) {
      warn(`data/awards-list-index.json has ${idx.length} rows but data/awards.json currently carries ${awards.length} awards — stale, run \`npm run refresh:links\``);
    }
  }
}

// ---------------------------------------------------------------------------
// 8b-12. promotions-index.json FRESHNESS (hook c202, adversarial review
//     2026-10-09 finding B01 — the index promotions.html, the Wings door,
//     now reads) — the same discipline as its siblings above: the index is
//     a build artifact the page fetches at runtime, and its own row count
//     should always equal the live total, or someone minted, renamed or
//     retired a wing and forgot `npm run refresh:links`. The expected
//     count MIRRORS the builder in cross-reference.mjs exactly
//     (`promotions.map(wingListRow)`, every row, no filter), or the
//     freshness count lies.
//     THE FIRST-CYCLE CASE: the message ends "run `npm run refresh:links`",
//     which is scripts/ops/preflight.sh's own DEFER regex, so preflight
//     defers the line to the gate instead of reding, and the gate — which
//     checks after its own refresh — judges it for real.
// ---------------------------------------------------------------------------
{
  const idxPath = resolve(DATA, "promotions-index.json");
  if (!existsSync(idxPath)) {
    warn("data/promotions-index.json is missing — run `npm run refresh:links`");
  } else {
    const idx = loadArray("promotions-index");
    if (idx.length !== promotions.length) {
      warn(`data/promotions-index.json has ${idx.length} rows but data/promotions.json currently carries ${promotions.length} wings — stale, run \`npm run refresh:links\``);
    }
  }
}

// ---------------------------------------------------------------------------
// 8c. STYLE FAMILIES — data/style-families.json is a NAVIGATION-ONLY finding
//     aid over the verbatim tenure `style` strings (docs/SCHEMA.md, the
//     controlled-vocabulary-over-verbatim-records doctrine): grouping is a
//     browse convenience, never a claim about the record, and the strings
//     themselves are never touched. Two soft-warning hygiene checks, never
//     hard fails — the whole point of "soft" here is that an uncategorized
//     or stale style string is a normal, ongoing state of a finding aid
//     racing a growing corpus, not a build-breaking defect:
//       - every DISTINCT style string actually in the registry that no
//         family claims (an honest gap — some source `style` fields are
//         role notes or noise, not a style at all, and stay unmapped on
//         purpose; see the census in the wave report, not enumerated here);
//       - every mapped variant that does NOT correspond to any style string
//         currently in the registry (mapping hygiene — a family drifting
//         out of sync with the corpus, usually because a variant was
//         retyped by hand instead of copied byte-for-byte).
// ---------------------------------------------------------------------------
{
  const familiesPath = resolve(DATA, "style-families.json");
  if (!existsSync(familiesPath)) {
    soft("data/style-families.json is missing — the style finding-aid layer (docs/SCHEMA.md) has no navigation grouping to offer");
  } else {
    let famRaw;
    try { famRaw = JSON.parse(readFileSync(familiesPath, "utf8")); } catch (e) { famRaw = null; warn(`data/style-families.json does not parse: ${e.message}`); }
    if (famRaw) {
      if (famRaw._schema_version === undefined) warn(`data/style-families.json: missing "_schema_version"`);
      const families = famRaw.families || {};
      const registryStyles = new Set();
      for (const e of [...characters, ...units]) for (const t of e.tenures || []) if (t.style) registryStyles.add(t.style);
      const mappedSet = new Set();
      for (const [fam, variants] of Object.entries(families)) {
        for (const v of variants || []) {
          mappedSet.add(v);
          if (!registryStyles.has(v)) {
            soft(`data/style-families.json: family "${fam}" maps variant not found in any current tenure's own "style" string (mapping hygiene): ${JSON.stringify(v)}`);
          }
        }
      }
      const unmapped = [...registryStyles].filter((s) => !mappedSet.has(s)).sort((a, b) => a.localeCompare(b));
      if (unmapped.length) {
        soft(`data/style-families.json: ${unmapped.length} distinct registry style string(s) not claimed by any family (honest gaps, not a defect) — see the wave report for the full list; first few: ${unmapped.slice(0, 5).map((s) => JSON.stringify(s.length > 40 ? s.slice(0, 40) + "…" : s)).join(", ")}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 8d. STIPULATION FAMILIES — data/stipulation-families.json, the exact same
//     navigation-only doctrine as 8c one field over (docs/SCHEMA.md): a
//     finding-aid grouping over verbatim `shows.json` matches[].stipulation
//     strings, never a claim about the record, strings never touched.
// ---------------------------------------------------------------------------
{
  const stipFamiliesPath = resolve(DATA, "stipulation-families.json");
  if (!existsSync(stipFamiliesPath)) {
    soft("data/stipulation-families.json is missing — the stipulation finding-aid layer (docs/SCHEMA.md) has no navigation grouping to offer");
  } else {
    let stipRaw;
    try { stipRaw = JSON.parse(readFileSync(stipFamiliesPath, "utf8")); } catch (e) { stipRaw = null; warn(`data/stipulation-families.json does not parse: ${e.message}`); }
    if (stipRaw) {
      if (stipRaw._schema_version === undefined) warn(`data/stipulation-families.json: missing "_schema_version"`);
      const families = stipRaw.families || {};
      const registryStips = new Set();
      for (const s of shows) for (const m of s.matches ?? []) if (m.stipulation) registryStips.add(m.stipulation);
      const mappedSet = new Set();
      for (const [fam, variants] of Object.entries(families)) {
        for (const v of variants || []) {
          mappedSet.add(v);
          if (!registryStips.has(v)) {
            soft(`data/stipulation-families.json: family "${fam}" maps variant not found in any current match's own "stipulation" string (mapping hygiene): ${JSON.stringify(v)}`);
          }
        }
      }
      const unmapped = [...registryStips].filter((s) => !mappedSet.has(s)).sort((a, b) => a.localeCompare(b));
      if (unmapped.length) {
        soft(`data/stipulation-families.json: ${unmapped.length} distinct registry stipulation string(s) not claimed by any family (honest gaps, not a defect): ${unmapped.slice(0, 8).map((s) => JSON.stringify(s)).join(", ")}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 8e. THE GRAPH-ENRICHMENT WAVE, schema batch — remaining new fields/kinds:
//     appearances[].subtype (angle-only), appearances[].capacity, shows[]
//     venue/city, matches[].stipulation shape, tenures[].entrance_music
//     structured shape, and relationships.json nature "same-handler".
// ---------------------------------------------------------------------------
// "interference" minted at the Janitor's gavel (2026-09-27, desk D100,
// verbatim: "add the interference subtype"; CURATION.md v125,
// #match-method-and-interference) — the 688 `interfered` credits Argyle's
// verified split carries flatten to a plain angle, the same as a backstage
// segment, so this is one more subtype value and NOT a new appearance kind.
// The kind:"angle"-only rule below is what keeps it honest: an interferer is
// never also in that match's own sides/participants, and a competitor's own
// foul inside his own match is the match's `note` plus method:"dq", not this.
const ANGLE_SUBTYPE_VALUES = new Set(["turn-heel", "turn-face", "unmasking", "kayfabe-death", "wedding", "betrayal", "debut", "retirement", "reveal", "interference"]);
// "manager" minted at the Janitor's gavel (2026-08-26) — six independent CSWA
// tier-3 extraction lanes hit the missing value; a manager at ringside is a
// capacity, not a competitor.
const APPEARANCE_CAPACITY_VALUES = new Set(["commentary", "referee", "ring-announcer", "authority", "interviewer", "manager"]);
// ---------------------------------------------------------------------------
// matches[].method — HOW THE MATCH ENDED (the Janitor's gavel, 2026-09-27,
// desk D105, verbatim: "a new field, method"; CURATION.md v125,
// #match-method-and-interference). The eleven values are Argyle's own
// decision vocabulary, slugged the house way; his code 0 ("no method") is
// ABSENCE, never a stored value. `method` and `result` answer different
// questions and coexist freely — a double-countout is result:"draw" +
// method:"countout", a clean fall is winner_side + method:"pinfall" — so
// there is deliberately NO contradiction check here to mirror the one that
// forbids result beside winner_side.
//
// THE SET IS CLOSED, AND THIS IS A PLAIN ENUM CHECK ON PURPOSE. D100 first
// proposed putting the controlled value in `finish`, which would have needed
// a slug-vs-prose split here, because 2,062 rows already carry a `finish`
// SENTENCE. D105 ruled a NEW field instead ("a new field, method"), so
// `method` is minted EMPTY: every value in it is post-gavel, and a value
// outside the eleven is a typo or an undocumented invention, which hard-fails
// (medium's own doctrine, one level down). No legacy tolerance, no advisory,
// no migration.
//
// `finish` IS NOT CHECKED AGAINST THIS SET, EVER (v125(d)). It is the told
// sentence — free prose, the museum's own one-line telling of how the night's
// match ended — and it keeps its own name and its own 2,062 rows untouched.
// The only thing asked of it is what is asked of any optional string: present
// means non-empty, checked beside `stipulation` below. `win_method` and `how`
// are informal siblings, not documented keys, and are not checked here
// either; a later lane maps their clean values into `method` and leaves their
// prose where it is.
//
// Deliberately NOT ratcheted (v119's and v124's own reason): a new LAW_RULES
// key needs `npm run law:baseline`, a Janitor-or-coordinator act.
// ---------------------------------------------------------------------------
const MATCH_METHOD_VALUES = new Set([
  "pinfall",            // a fall scored
  "submission",         // a hold conceded
  "dq",                 // a disqualification, whoever it favours
  "countout",           // a competitor failed to beat the count
  "knockout",           // could not continue; no fall, no submission
  "stipulation",        // the stipulation itself was the method
  "forfeit",            // one side never contested it
  "time-limit",         // the bell beat the finish
  "no-decision",        // the fed recorded that no decision was rendered
  "reversed-decision",  // an announced decision was reversed
  "sleeper",            // his eleventh code, kept rather than folded
]);
for (const s of shows) {
  for (const [ai, a] of (s.appearances ?? []).entries()) {
    const tag = `show "${s.id}".appearances[${ai}]`;
    if ("subtype" in a) {
      if (a.kind !== "angle") warn(`${tag}: "subtype" is only meaningful on kind: "angle" (this row is kind: "${a.kind}")`);
      if (!ANGLE_SUBTYPE_VALUES.has(a.subtype)) soft(`${tag}: subtype "${a.subtype}" is not one of ${[...ANGLE_SUBTYPE_VALUES].join("|")} (controlled-but-soft, expected to grow)`);
    }
    if ("capacity" in a && !APPEARANCE_CAPACITY_VALUES.has(a.capacity)) {
      soft(`${tag}: capacity "${a.capacity}" is not one of ${[...APPEARANCE_CAPACITY_VALUES].join("|")} (controlled-but-soft, expected to grow)`);
    }
  }
  for (const [mi, m] of (s.matches ?? []).entries()) {
    if ("stipulation" in m && (typeof m.stipulation !== "string" || !m.stipulation.trim())) {
      warn(`show "${s.id}".matches[${mi}]: "stipulation" must be a non-empty string when present`);
    }
    // `finish` is the TOLD SENTENCE (v125(d)) — free prose, NEVER measured
    // against MATCH_METHOD_VALUES. Shape only, exactly as `stipulation` above.
    if ("finish" in m && (typeof m.finish !== "string" || !m.finish.trim())) {
      warn(`show "${s.id}".matches[${mi}]: "finish" must be a non-empty string when present — it is the told sentence, free prose (CURATION.md v125(d), #match-method-and-interference); the controlled value goes in "method"`);
    }
    if ("method" in m) {
      const tag = `show "${s.id}".matches[${mi}]`;
      if (typeof m.method !== "string" || !m.method.trim()) {
        warn(`${tag}: "method" must be a non-empty string when present — one of ${[...MATCH_METHOD_VALUES].join("|")}, or no field at all where the text does not say how the match ended (CURATION.md v125(a), #match-method-and-interference)`);
      } else if (!MATCH_METHOD_VALUES.has(m.method)) {
        warn(`${tag}: method "${m.method}" is not one of the eleven (${[...MATCH_METHOD_VALUES].join("|")}) — the set is closed by gavel, so a twelfth value is a typo or an undocumented invention, never a silent new vocabulary; absence is the twelfth case and is simply no field, and a SENTENCE about the finish belongs in "finish", which is never checked against this set (CURATION.md v125(a), v125(d))`);
      } else if (m.method === "stipulation" && !(typeof m.stipulation === "string" && m.stipulation.trim())) {
        soft(`${tag}: method "stipulation" says the match's own stipulation was the method, but the row carries no "stipulation" — name it verbatim, or use the method the text actually describes (CURATION.md v125(a))`);
      }
    }
  }
  if ("venue" in s && (typeof s.venue !== "string" || !s.venue.trim())) warn(`show "${s.id}": "venue" must be a non-empty string when present`);
  if ("city" in s && (typeof s.city !== "string" || !s.city.trim())) warn(`show "${s.id}": "city" must be a non-empty string when present`);
}

// ---------------------------------------------------------------------------
// matches[].stip — ARGYLE'S STIPULATION CODES (the Janitor's gavel, 2026-10-03,
// desk D249, verbatim: "1. Add `matches[].stip` (his codes, a list; schema +
// converters; the families stay for wording)"; CURATION.md v127,
// #match-stip-codes). An optional LIST of his shortnames, verbatim, BESIDE the
// fed's own `stipulation` string and never instead of it: `stipulation` is how
// the fed worded it (what renders), `stip` is his database's code for the kind
// of match (what links across promotions). The known list is
// data/stip-codes.json ({code, name, families}); a value outside it is a typo
// or an invented code and HARD-FAILS, because his list is the vocabulary and a
// stipulation his list lacks is a question for him, never a new code of ours
// (his own rule, 1340Z: "Ask for anything that's missing"). `standard` is his
// code for "no special rules" and stands alone; beside another code it is a
// soft line. A family a code names that stipulation-families.json lacks is a
// soft line (the crosswalk names families c30 lands). Minted empty: no legacy
// shape to tolerate. Deliberately NOT ratcheted (v119/v124's reason).
// ---------------------------------------------------------------------------
{
  const stipCodesPath = resolve(DATA, "stip-codes.json");
  let STIP_CODES = null;
  if (existsSync(stipCodesPath)) {
    let raw = null;
    try { raw = JSON.parse(readFileSync(stipCodesPath, "utf8")); } catch (e) { warn(`data/stip-codes.json does not parse: ${e.message}`); }
    if (raw) {
      if (raw._schema_version === undefined) warn(`data/stip-codes.json: missing "_schema_version"`);
      if (!Array.isArray(raw.codes) || !raw.codes.length) warn(`data/stip-codes.json: "codes" must be a non-empty array of {code, name, families}`);
      STIP_CODES = new Set();
      let famNames = null;
      try { famNames = new Set(Object.keys(JSON.parse(readFileSync(resolve(DATA, "stipulation-families.json"), "utf8")).families || {})); } catch { famNames = null; }
      for (const [i, c] of (Array.isArray(raw.codes) ? raw.codes : []).entries()) {
        const tag = `data/stip-codes.json codes[${i}]`;
        if (!c || typeof c.code !== "string" || !/^[a-z0-9]+$/.test(c.code)) { warn(`${tag}: "code" must be his shortname, lowercase letters and digits only`); continue; }
        if (STIP_CODES.has(c.code)) warn(`${tag}: code "${c.code}" is listed twice`);
        STIP_CODES.add(c.code);
        if ("name" in c && c.name !== null && (typeof c.name !== "string" || !c.name.trim())) warn(`${tag} ("${c.code}"): "name" is his display name, a non-empty string, or null until the export gives it`);
        if (!Array.isArray(c.families)) warn(`${tag} ("${c.code}"): "families" must be an array (empty for a code with no family)`);
        else if (famNames) for (const f of c.families) if (!famNames.has(f)) soft(`${tag} ("${c.code}"): family "${f}" is not in data/stipulation-families.json — the code links to nothing under it until the family lands`);
      }
    }
  }
  let stipRows = 0;
  for (const s of shows) {
    for (const [mi, m] of (s.matches ?? []).entries()) {
      if (!("stip" in m)) continue;
      stipRows++;
      const tag = `show "${s.id}".matches[${mi}]`;
      if (!Array.isArray(m.stip) || !m.stip.length || m.stip.some((v) => typeof v !== "string" || !v.trim())) {
        warn(`${tag}: "stip" must be a non-empty LIST of Argyle's stipulation shortnames (CURATION.md v127, #match-stip-codes); no field at all where no code is known`);
        continue;
      }
      if (!STIP_CODES) { warn(`${tag}: "stip" is present but data/stip-codes.json is missing or unreadable — the codes cannot be checked`); continue; }
      const seen = new Set();
      for (const v of m.stip) {
        if (seen.has(v)) warn(`${tag}: stip code "${v}" is listed twice`);
        seen.add(v);
        if (!STIP_CODES.has(v)) warn(`${tag}: stip code "${v}" is not in data/stip-codes.json — his list is the vocabulary; a stipulation it lacks is a question for him, never an invented code (CURATION.md v127)`);
      }
      if (seen.has("standard") && seen.size > 1) soft(`${tag}: stip "standard" (no special rules) sits beside ${[...seen].filter((v) => v !== "standard").join(", ")} — his key gives a match with no special rules "standard" alone`);
    }
  }
  if (stipRows && !STIP_CODES) warn(`${stipRows} match row(s) carry "stip" but data/stip-codes.json is missing`);
}

// entrance_music: structured {title?, artist?, verbatim} going forward
// (THE ENTRANCE MUSIC STRUCTURED WAVE) — verbatim always required; a
// bare legacy string is soft-warned (migrate it) rather than hard-failed,
// so an unmigrated future accession's own fresh bio-mine doesn't block
// the build on a shape it hasn't been touched by this wave's script yet.
for (const e of [...characters, ...units]) {
  for (const [i, t] of (e.tenures ?? []).entries()) {
    if (!("entrance_music" in t)) continue;
    const em = t.entrance_music;
    if (typeof em === "string") {
      soft(`${e.id}.tenures[${i}]: "entrance_music" is a bare string — migrate to {title?, artist?, verbatim} (THE ENTRANCE MUSIC STRUCTURED WAVE)`);
    } else if (em && typeof em === "object") {
      if (typeof em.verbatim !== "string" || !em.verbatim.trim()) warn(`${e.id}.tenures[${i}].entrance_music: needs a non-empty "verbatim"`);
      if ("title" in em && typeof em.title !== "string") warn(`${e.id}.tenures[${i}].entrance_music.title: must be a string`);
      if ("artist" in em && typeof em.artist !== "string") warn(`${e.id}.tenures[${i}].entrance_music.artist: must be a string`);
    } else {
      warn(`${e.id}.tenures[${i}]: "entrance_music" must be a string or {title?, artist?, verbatim} object`);
    }
  }
}

// same-handler relationships: anonymous by construction — no "detail" ever
// (that's the whole point; a role-safe "source" citation is fine, a name
// or biographical detail is exactly what this shape forecloses).
for (const [i, r] of relationships.entries()) {
  if (r.nature === "same-handler" && "detail" in r) {
    warn(`relationships[${i}] ("${r.id}"): a same-handler edge carries no "detail" — anonymous linkage only (docs/SCHEMA.md)`);
  }
}

// ---------------------------------------------------------------------------
// SHARD INTEGRITY (THE SHARDING MIGRATION) — data/shards/<promotion>/<type>.json
// is now the SOURCE OF TRUTH for characters/units/shows/rps/reigns/titles/
// awards; data/<type>.json is a generated artifact (npm run build:data).
// Three checks, same "gates catch drift mechanically" posture as every
// other freshness check in this file:
//
//   (a) every shard row's id is unique across every shard of its type (no
//       row filed twice, no row silently dropped between shards) —
//   (b) shard-assignment rule enforcement: every row actually filed under
//       data/shards/<dir>/<type>.json resolves, via the SAME rule
//       scripts/shard-lib.mjs's shardOf() uses at build time, to that same
//       <dir> — catches a row hand-filed into the wrong promotion's shard,
//       which would still build fine (build-data.mjs doesn't care which
//       directory a row came from) but would be a silent lie about which
//       promotion owns it —
//   (c) rebuild-diff freshness: data/<type>.json on disk, byte-for-byte,
//       must equal what scripts/build-data.mjs would produce RIGHT NOW from
//       the current shards — same "stale artifact = hard fail" pattern
//       npm run chrome / npm run stats already enforce; run `npm run
//       build:data` (first in the pipeline, before refresh:links/chrome/
//       stats) whenever a shard changes.
// ---------------------------------------------------------------------------
{
  const titlePromotionMap = buildTitlePromotionMap(titles);
  const shardDirs = listShardDirs();

  for (const type of SHARD_TYPES) {
    // (a) + (b): read every shard file directly (not through the already-
    // loaded monolith) so a row present in two shards, missing from all of
    // them, or filed under a directory shardOf() disagrees with, is caught
    // even if it happens to net out to the same byte count on rebuild.
    const seen = new Map(); // id -> dir
    for (const dir of shardDirs) {
      const p = resolve(DATA, "shards", dir, `${type}.json`);
      if (!existsSync(p)) { warn(`data/shards/${dir}/${type}.json is missing — every promotion (+ ${UNASSIGNED_SHARD}) must carry a shard file for every shardable type, even an empty array`); continue; }
      let rows;
      try { rows = JSON.parse(readFileSync(p, "utf8")); } catch (e) { warn(`data/shards/${dir}/${type}.json does not parse: ${e.message}`); continue; }
      if (!Array.isArray(rows)) { warn(`data/shards/${dir}/${type}.json must be a bare JSON array (no _schema_version wrapper — that lives in data/shards/_headers/${type}.json)`); continue; }
      for (const row of rows) {
        if (!row.id) { warn(`data/shards/${dir}/${type}.json: a row with no "id"`); continue; }
        if (seen.has(row.id)) {
          warn(`shard-integrity: "${row.id}" (${type}) appears in both data/shards/${seen.get(row.id)}/${type}.json and data/shards/${dir}/${type}.json — every row belongs to exactly one shard`);
        } else {
          seen.set(row.id, dir);
        }
        const expectedDir = shardOf(type, row, titlePromotionMap);
        if (expectedDir !== dir) {
          warn(`shard-assignment: "${row.id}" (${type}) is filed under data/shards/${dir}/ but the assignment rule (docs/SCHEMA.md's Sharding section) resolves it to "${expectedDir}" — refile it, or if the row's own promotion/tenures[0] genuinely changed, that's the fix, not the shard location`);
        }
      }
    }
  }

  // (c) rebuild-diff freshness — build every type fresh in memory and
  // compare, byte for byte, against what's currently on disk.
  let built = null;
  try {
    built = buildAllShards();
  } catch (e) {
    warn(`build-data: failed to build monoliths from shards: ${e.message}`);
  }
  if (built) {
    for (const [type, { text }] of built) {
      const onDiskPath = resolve(DATA, `${type}.json`);
      const onDisk = existsSync(onDiskPath) ? readFileSync(onDiskPath, "utf8") : null;
      if (onDisk === null) {
        warn(`data/${type}.json is missing — run npm run build:data`);
      } else if (onDisk !== text) {
        warn(`data/${type}.json is stale relative to data/shards/ — run npm run build:data (must run FIRST in the pipeline, before refresh:links/chrome/stats)`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// THE AI-AUTHORSHIP FLAG (2026-08-22) — soft-warn (never a hard fail: an
// unflagged field is a housekeeping gap, not a build-breaking defect) on
// any rendered bounded-prose field carrying no paired authorship metadata,
// so nothing slips through unflagged going forward as new captions/
// epitaphs/notes are minted. The marker itself renders mechanically from
// the field (cross-reference.mjs's aiFlag()) — this only catches the field
// never being set at all.
// ---------------------------------------------------------------------------
for (const e of [...characters, ...units]) {
  if (e.caption && (!e.caption_asof || e.caption_asof.author === undefined)) {
    soft(`${e.id}: has a "caption" with no caption_asof.author — AI-authorship flag can't render (defaults to "ai" once set)`);
  }
}
// Promotions too (REVIEW-FIXES WAVE, 2026-08-22, the Janitor: promotion-page
// captions were missing the flag) — same caption_asof.author convention.
for (const p of promotions) {
  if (p.caption && (!p.caption_asof || p.caption_asof.author === undefined)) {
    soft(`${p.id}: has a "caption" with no caption_asof.author — AI-authorship flag can't render (defaults to "ai" once set)`);
  }
}
for (const t of titles) {
  if (t.epitaph && (!t.epitaph_asof || t.epitaph_asof.author === undefined)) {
    soft(`${t.id}: has an "epitaph" with no epitaph_asof.author — AI-authorship flag can't render`);
  }
}
for (const a of awards) {
  if (a.epitaph && (!a.epitaph_asof || a.epitaph_asof.author === undefined)) {
    soft(`${a.id}: has an "epitaph" with no epitaph_asof.author — AI-authorship flag can't render`);
  }
}
for (const m of memorials) {
  if (m.note && m.note_author === undefined) {
    soft(`${m.id}: has a "note" with no note_author — AI-authorship flag can't render`);
  }
  if (m.note_author && !["ai","human"].includes(m.note_author) && !attestorHandles.has(m.note_author)) {
    warn(`${m.id}: note_author "${m.note_author}" is neither ai/human nor a registered attestor handle (data/attestors.json)`);
  }
}

// ---------------------------------------------------------------------------
// THE PROMOTION-SPAN DATE SWEEP (QA-REGISTRY-AUDIT, 2026-08-28) — a reign
// won/lost, a show's own date, or an rp's own date, entirely OUTSIDE its own
// promotion's founded/closed span. None of the existing date checks above
// compare across these two fields — checkFoundingDate/checkImpossibleDate
// validate a date is a real calendar date; the founded<closed ordering
// check (above, promotion.runs) only ever compares a promotion against
// itself. This is the missing cross-field check: is the promotion's own
// held record actually the record of when it says it ran?
//
// INTERVAL-OVERLAP, not point comparison — a "year"/"circa" precision date
// is a RANGE (the whole year, or a year either side for circa's own honest
// fuzz), and only flagging when the two ranges have NO overlap at all
// avoids the false-positive a naive first-of-period rounding produces (a
// "year": "1988" reign is not actually "before" a "1988-03" founding date —
// it might have happened any time in 1988, including after March). Hand-
// verified against a sample of real hits during the audit: several are
// genuine curatorial findings (a fed's own held archive containing dated
// material years past its recorded "closed," a title-history ledger vs. a
// served show's own dateline disagreeing by months) that need a human's
// judgment — a rewritten founded/closed date, a corrected reign, or an
// honest note — never a script's guess; this stays a soft, non-blocking
// advisory for exactly that reason, same posture as every other
// possible-but-unproven finding in this file.
// ---------------------------------------------------------------------------
{
  const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const looseYearInterval = (s, wide = false) => {
    const m = /(\d{4})/.exec(s ?? "");
    if (!m) return null;
    const y = Number(m[1]);
    const lo = wide ? y - 1 : y, hi = wide ? y + 1 : y;
    return [`${lo}-01-01`, `${hi}-12-31`];
  };
  const dateInterval = (d) => {
    if (!d || typeof d.date !== "string") return null;
    const { date, precision } = d;
    if (precision === "exact") {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
      return m ? [date, date] : looseYearInterval(date);
    }
    if (precision === "month") {
      const m = /^(\d{4})-(\d{2})$/.exec(date);
      if (!m) return looseYearInterval(date);
      const [, y, mo] = m;
      const last = String(lastDayOfMonth(Number(y), Number(mo))).padStart(2, "0");
      return [`${y}-${mo}-01`, `${y}-${mo}-${last}`];
    }
    if (precision === "year") {
      const m = /^(\d{4})$/.exec(date);
      return m ? [`${m[1]}-01-01`, `${m[1]}-12-31`] : looseYearInterval(date);
    }
    return looseYearInterval(date, true); // circa/unknown — widened a year either side
  };
  const outsideSpan = (sub, span) => {
    if (!sub || !span) return null;
    if (sub[1] < span[0]) return "entirely before";
    if (sub[0] > span[1]) return "entirely after";
    return null;
  };
  const promoSpan = new Map();
  for (const p of promotions) {
    const f = dateInterval(p.founded), c = dateInterval(p.closed);
    if (!f && !c) continue;
    promoSpan.set(p.id, [f ? f[0] : "0000-01-01", c ? c[1] : "9999-12-31"]);
  }

  let spanHits = 0;
  const spanSamples = [];
  const reportSpan = (label, span, promoId, sub) => {
    const v = outsideSpan(sub.interval, span);
    if (!v) return;
    spanHits++;
    if (spanSamples.length < 15) {
      spanSamples.push(`${label} — ${sub.raw} (${sub.precision}) is ${v} promotion "${promoId}"'s own founded/closed span (${span[0]}..${span[1]})`);
    }
  };
  const titleByIdLocal = new Map(titles.map((t) => [t.id, t]));
  for (const r of reigns) {
    const t = titleByIdLocal.get(r.title);
    if (!t) continue;
    const span = promoSpan.get(t.promotion);
    if (!span) continue;
    if (r.won?.date) reportSpan(`reign "${r.id}" won`, span, t.promotion, { raw: r.won.date, precision: r.won.precision, interval: dateInterval(r.won) });
    if (r.lost?.date) reportSpan(`reign "${r.id}" lost`, span, t.promotion, { raw: r.lost.date, precision: r.lost.precision, interval: dateInterval(r.lost) });
  }
  for (const s of shows) {
    const span = promoSpan.get(s.promotion);
    if (!span || !s.date?.date) continue;
    reportSpan(`show "${s.id}"`, span, s.promotion, { raw: s.date.date, precision: s.date.precision, interval: dateInterval(s.date) });
  }
  for (const rp of rps) {
    if (!rp.promotion) continue;
    const span = promoSpan.get(rp.promotion);
    if (!span || !rp.date?.date) continue;
    reportSpan(`rp "${rp.id}"`, span, rp.promotion, { raw: rp.date.date, precision: rp.date.precision, interval: dateInterval(rp.date) });
  }
  if (spanHits) {
    soft(
      `THE PROMOTION-SPAN DATE SWEEP: ${spanHits} reign/show/rp date(s) fall entirely ` +
      `outside their own promotion's founded/closed span (interval-overlap, not a ` +
      `naive point comparison — see this check's own comment). Each one needs a ` +
      `human read: a founded/closed date that needs correcting against newer-held ` +
      `evidence, a reign/show honestly misfiled under the wrong promotion, or (for ` +
      `a Wayback-capture-only date already marked precision "unknown") simply no ` +
      `issue at all. First ${spanSamples.length}: ${spanSamples.join(" | ")}` +
      (spanHits > spanSamples.length ? ` | ... and ${spanHits - spanSamples.length} more` : "")
    );
  }
}

// ---------------------------------------------------------------------------
// THE SERVED-PROSE MARKER GATE EXTENSION (PROSE-FIX-01, 2026-09-13;
// proposal.md #1) — the promotions-only marker+length gate above
// (PROCESS_TEXT_RE's field loop, line ~962) extended to every other served
// free-text field this lane's own audit found rendered with no gate
// coverage at all. Same posture throughout: soft(), never warn() — this is
// additive advisory coverage on a corpus that was never checked this way
// before, not a new class of build-breaker. One shared helper so the same
// two checks (length cap, marker hit) aren't hand-copied eight times.
// ---------------------------------------------------------------------------
function checkServedProse(label, id, field, value, capKey) {
  if (typeof value !== "string" || !value) return;
  const cap = FIELD_CAPS[capKey];
  if (cap && value.length > cap) {
    soft(`${label} "${id}": ${field} is ${value.length} characters — a served field takes a short clause, not a paragraph (cap ${cap}, see proposal.md #1)`);
  }
  if (PROCESS_TEXT_RE.test(value)) {
    lawHit("served-text-narration");
    soft(`${label} "${id}": ${field} carries workshop process text (${value.match(PROCESS_TEXT_RE)[0]}) — served fields state the fact; the reasoning stays in a workshop-only field (THE SERVED-TEXT RULE, generalised, PROSE-FIX-01 2026-09-13)`);
  }
}

for (const [kind, rows] of [["characters", characters], ["units", units]]) {
  for (const e of rows) {
    checkServedProse(kind, e.id, "caption", e.caption, `${kind}.caption`);
    // NOTES UNSERVED (D114) checks — the Janitor, desk D114 (2026-09-28): a character's or unit's own `notes` is a
    // workshop note, no longer rendered (cross-reference.mjs UNSERVED_NOTES_TYPES), so it is not judged as a served
    // field here and no longer counts toward the served-text-narration ratchet. Tenure notes (below) still do.
    for (const [ti, t] of (e.tenures ?? []).entries()) {
      checkServedProse(kind, e.id, `tenures[${ti}].note`, t.note, `${kind}.tenures[].note`);
    }
  }
}
for (const t of titles) {
  checkServedProse("title", t.id, "epitaph", t.epitaph, "titles.epitaph");
  checkServedProse("title", t.id, "notes", t.notes, "titles.notes");
  for (const [ei, ev] of (t.events ?? []).entries()) {
    checkServedProse("title", t.id, `events[${ei}].note`, ev.note, "titles.events[].note");
  }
}
for (const a of awards) {
  checkServedProse("award", a.id, "epitaph", a.epitaph, "awards.epitaph");
  // awards.notes carries no proposed cap (proposal.md #1's table names only
  // epitaph and bestowals[].vote_detail for awards) — marker check only.
  checkServedProse("award", a.id, "notes", a.notes, null);
  for (const [bi, b] of (a.bestowals ?? []).entries()) {
    checkServedProse("award", a.id, `bestowals[${bi}].vote_detail`, b.vote_detail, "awards.bestowals[].vote_detail");
  }
}
for (const r of reigns) {
  // reigns.note carries no proposed length cap in proposal.md #1's table
  // (only memorials.note/collections.blurb/titles.epitaph/awards.epitaph do,
  // at 500) — marker check only, matching the table as written.
  checkServedProse("reign", r.id, "note", r.note, null);
  checkServedProse("reign", r.id, "conflict.note", r.conflict?.note, null);
}
for (const m of memorials) {
  checkServedProse("memorial", m.id, "note", m.note, "memorials.note");
  for (const [gi, g] of (m.gallery ?? []).entries()) {
    checkServedProse("memorial", m.id, `gallery[${gi}].caption`, g.caption, "memorials.gallery[].caption");
  }
}
for (const [ai, e] of affiliations.entries()) {
  const label = `${e.a?.id ?? "?"}~${e.b?.id ?? "?"}`;
  checkServedProse("affiliation", `${ai}:${label}`, "note", e.note, "affiliations.note");
  checkServedProse("affiliation", `${ai}:${label}`, "status_note", e.status_note, "affiliations.status_note");
}
for (const c of collections) {
  if (c.attestor && !attestorHandles.has(c.attestor)) {
    warn(`collections ${c.id}: attestor "${c.attestor}" is not a registered attestor handle (data/attestors.json; docs/ATTESTATION.md §2)`);
  }
  checkServedProse("accession", c.id, "blurb", c.blurb, "collections.blurb");
  checkServedProse("accession", c.id, "note", c.note, "collections.note");
}

// ---------------------------------------------------------------------------
// SERVED DATA NAMES NO LOCAL OR WORKSHOP PATH (PATH-SCRUB, hook c111, 2026-10-07; the Janitor, chat 2026-10-07: "The publicly exposed
// frontier list exposes details of files and file structure on my local machine, which doesn't seem appropriate."). The museum serves
// data/*.json and data/shards/*/*.json. A local absolute path (/home/..., /tmp/..., /mnt/...) in ANY string of any of them FAILS the
// gate. A workshop-relative path (one of the workshop folders PS_WSP names below, hook c122 added the two usenet collections)
// is an advisory here: scripts/fixers/scrub-workshop-paths.py (ORDER.txt, before build:data) takes it out at every preflight, so one still
// here means the fixer has not run since it was written. A served page's own address (promotions/<wing>/archive/...), a real http(s)
// address and a wing-relative served page (archive/<name>.html) are never matched. The raw text of each file is scanned, so no registry
// or field is skipped.
{
  const PS_LB = String.raw`(?:(?<![\w./:@~%-])|(?<=\\[nt]))`;
  const PS_ABS = new RegExp(PS_LB + String.raw`\/(?:home|tmp|mnt|var|root|Users)\/[^\s"\;,()<>]*`, "g");
  const PS_WSP = new RegExp(PS_LB + String.raw`(?:archive|url-walk|ops-scratch|fwrestling-census|direct-collected|usenet-collected|usenet-retro|wwv-vault)\/[^\s"\;,()<>]*`, "g");
  const psFiles = [];
  for (const n of readdirSync(DATA).sort()) if (n.endsWith(".json")) psFiles.push(n);
  const psShards = resolve(DATA, "shards");
  if (existsSync(psShards)) {
    for (const d of readdirSync(psShards).sort()) {
      let kids = [];
      try { kids = readdirSync(resolve(psShards, d)).sort(); } catch { continue; }
      for (const n of kids) if (n.endsWith(".json")) psFiles.push(`shards/${d}/${n}`);
    }
  }
  const psSrc = [], psGen = [];
  for (const rel of psFiles) {
    const text = readFileSync(resolve(DATA, rel), "utf8");
    const abs = text.match(PS_ABS);
    if (abs) {
      warn(`data/${rel}: ${abs.length} local absolute path${abs.length > 1 ? "s" : ""} in served data (e.g. ${[...new Set(abs)].slice(0, 3).join(" ; ")}) — the museum serves this file, and a path on the operator's machine never belongs in it (PATH-SCRUB, hook c111; scripts/fixers/scrub-workshop-paths.py takes it out)`);
    }
    const wsp = (text.match(PS_WSP) ?? []).filter((t) => !/^archive\/[^/]+\.html?$/.test(t.replace(/[.:]+$/, "")) && !/^archive\/index\.php/.test(t));
    if (wsp.length) (/(-index|^wanted)\.json$/.test(rel) ? psGen : psSrc).push(`${rel} ${wsp.length}`);
  }
  const psShow = (a) => a.slice(0, 6).join(", ") + (a.length > 6 ? ", ..." : "");
  if (psSrc.length) soft(`served source data carries workshop-relative paths (${psShow(psSrc)}) — scripts/fixers/scrub-workshop-paths.py takes these out at the next preflight (PATH-SCRUB, hook c111)`);
  if (psGen.length) soft(`generated served data carries workshop-relative paths (${psShow(psGen)}) — regenerated from the sources by the next cross-reference build (PATH-SCRUB, hook c111)`);
}

// ---------------------------------------------------------------------------
if (warnings.length) {
  console.warn(`\nregistry-validate: ${warnings.length} advisory warning${warnings.length > 1 ? "s" : ""} (non-blocking)\n`);
  for (const w of warnings) console.warn("  ⚠ " + w);
  console.warn("");
}

lawRatchet(warn);

if (errors.length) {
  console.error(`\nregistry-validate: FAILED (${errors.length} issue${errors.length > 1 ? "s" : ""})\n`);
  for (const e of errors) console.error("  ✗ " + e);
  console.error("");
  process.exit(1);
}

console.log(
  `registry-validate: OK — ${promotions.length} promotions, ${characters.length} characters, ` +
  `${units.length} units, ${titles.length} titles, ${shows.length} shows, ` +
  `${memorials.length} memorials, ${essays.length} essays, ${affiliations.length} affiliations, ` +
  `${inductions.length} inductions, ${rps.length} rps, ${frontier?.rows?.length ?? 0} frontier rows, ` +
  `${externalFigures.length} external figures, ${reigns.length} reigns, ` +
  `${awards.length} award entities (${awards.reduce((n, a) => n + (a.bestowals?.length ?? 0), 0)} bestowals), ${relationships.length} relationships, ${rpCatalog.length} rp-catalog rows, ` +
  `${reviewQueue.length} review-queue entries, ${shows.filter((s) => s.collected === false).length} uncollected show rows, ${linkCount} entity links, all resolve.`,
);
