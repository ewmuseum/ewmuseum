#!/usr/bin/env node
/**
 * scripts/build-find-record-index.mjs — the compact name index behind GET /api/find-record (D448, the Janitor, 2026-10-08:
 * "the cheaper exact-name lookup instead"; hook c136).
 *
 *   node scripts/build-find-record-index.mjs            write data/find-record-index.json (only if the bytes change)
 *   node scripts/build-find-record-index.mjs --check    write nothing; exit 1 if the file on disk is not what would be written
 *   node scripts/build-find-record-index.mjs --root DIR build for the museum tree at DIR (default: this script's repo)
 *
 * RUN IN EVERY GATE (scripts/gate.sh `gate_step find-record:index`, after `stats`, before `privacy` and `check`; and in
 * `npm run refresh`), so the index is rebuilt from the registry each time a chain builds and cannot go stale. It reads the
 * registry files the pages are rendered from, characters.json, units.json, titles.json, promotions.json and memorials.json (whose
 * rows are records of their own since D566), and writes one file under data/, which is already a served, allowlisted top-level
 * directory; r2-sync uploads it
 * with the rest of the site and worker/find-record.mjs reads it from the bucket.
 *
 * WHAT GOES IN: one row per record that has a served page in THIS tree: a character or a unit (characters/<id>.html), a title (its
 * own `page`), a wing (promotions/<id>/index.html), a memorial (memorials/<id>.html) and In Memoriam itself (in-memoriam.html).
 * A row whose page file is missing is left out (withdrawn, not yet rendered).
 * Each row: [kind c|t|w|m, id, display name, [indexes into wings[]], extras?] where extras = { a: [aka names], s: unit kind,
 * p: page when it is not the default }. A character's wings are the promotions of its tenures; a title's wing is its promotion;
 * a wing's list is itself; a memorial's list is empty, and In Memoriam's row is the one row whose page comes from `p`.
 *
 * THE PRIVACY FILTER (hook c136, after the coordinator's privacy-lookup run on the first cut): every string is scanned as the gate would scan this
 * file (scripts/find-record-privacy-filter.py: the ledger's deny rows and the four takedown libraries; counts only are logged). A name, aka or
 * id that hits is dropped, the record with it when its id or display name is the string; no ALLOW is ever needed. `--check` fails if the
 * file on disk would still hit.
 *
 * THE MEMORIAL REGISTER IS IN (D566, the Janitor, 2026-10-12, verbatim: "First option"; GAVELS 2026-10-12: the record lookup
 * "INCLUDES the memorial pages and In Memoriam (the D448 'Care' exclusion was the coordinator's proposal, never separately
 * ruled)"). So memorials.json yields one "m" row per memorial — the register's own `name` and any `aka`, page
 * /memorials/<id>.html — plus the one In Memoriam row, and the D448 drop of a record whose id is a memorial's id is GONE: such a
 * name is TWO rows, of two kinds, with two pages, and a lookup returns both. Memorial subjects are named by law (CURATION
 * #privacy v74 and the memorial register, v65; GAVELS 2026-09-24 D2), which is why these names need no new exemption here: the
 * privacy filter below already scans them under the gate's own register exemption, and what it drops it reports.
 *
 * WHAT STILL STAYS OUT: the units listings (units/a-z) and the a-z indexes are not records; no row's page may be outside
 * /characters/<id>.html, /titles/<id>.html, /promotions/<id>/, /memorials/<id>.html or /in-memoriam.html, and only an "m" row may
 * carry one of the last two (pageOkForKind; the self-check below fails the build otherwise); the register's `characters` field is
 * a list of entity IDS, not display names, so it is never a row's aka — those 51 characters stay ORDINARY character rows and
 * nothing about the memorial link is stored on them.
 *
 * The file is deterministic (rows sorted by kind then id, no timestamp), one row per line so a diff reads, and carries
 * _schema_version (registry-validate wants it on every data/*.json). It names no path of the machine (the PATH-SCRUB check) and
 * holds only names the served pages already show.
 */
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, lookup, allRows, isMemorialPage, pageOkForKind, FIND_MAX_RESULTS } from "../worker/find-record.mjs";

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const ri = args.indexOf("--root");
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = ri !== -1 && args[ri + 1] ? resolve(args[ri + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = resolve(ROOT, "data");
const OUT = resolve(DATA, "find-record-index.json");
// In Memoriam itself is a record (D566): the one memorial-kind row that is not a memorials.json row.
const IN_MEMORIAM_ID = "in-memoriam", IN_MEMORIAM_NAME = "In Memoriam", IN_MEMORIAM_PAGE = "/in-memoriam.html";

function load(name, key) {
  const p = resolve(DATA, name);
  if (!existsSync(p)) throw new Error(`find-record index: data/${name} is missing`);
  const j = JSON.parse(readFileSync(p, "utf8"));
  if (!Array.isArray(j[key])) throw new Error(`find-record index: data/${name} has no ${key}[]`);
  return j[key];
}

function build() {
  let raw;
  const characters = load("characters.json", "characters");
  const units = load("units.json", "units");
  const titles = load("titles.json", "titles");
  const promotions = load("promotions.json", "promotions");
  const memorials = load("memorials.json", "memorials");
  const stats = { characters: 0, units: 0, titles: 0, wings: 0, memorials: 0, noPage: 0, noName: 0 };

  raw = [];
  const akaOf = (r) => (Array.isArray(r.aka) ? r.aka.filter((a) => typeof a === "string" && a.trim()).map((a) => a.trim()) : []);

  const consider = (kind, r, wings, page, sub) => {
    const id = String(r.id || "");
    const name = String(r.name || "").trim();
    if (!id || !name) { stats.noName++; return; }
    // D566: the D448 drop of a record whose id is a memorial's id is gone — a memorial is its own kind now, with its own page
    if (!existsSync(resolve(ROOT, page.replace(/^\//, "").replace(/\/$/, "/index.html")))) { stats.noPage++; return; }
    raw.push({ kind, id, name, wings: [...new Set(wings)].sort(), akas: [...new Set(akaOf(r))], sub, page });
  };

  for (const c of characters) {
    const w = (c.tenures || []).map((t) => t && t.promotion).filter(Boolean);
    const before = raw.length;
    consider("c", c, w, `/characters/${c.id}.html`, "");
    stats.characters += raw.length - before;
  }
  for (const u of units) {
    const w = (u.tenures || []).map((t) => t && t.promotion).filter(Boolean);
    const before = raw.length;
    consider("c", u, w, `/characters/${u.id}.html`, String(u.unit_kind || "unit"));
    stats.units += raw.length - before;
  }
  for (const t of titles) {
    const before = raw.length;
    consider("t", t, [t.promotion].filter(Boolean), typeof t.page === "string" && t.page ? t.page : `/titles/${t.id}.html`, "");
    stats.titles += raw.length - before;
  }
  for (const p of promotions) {
    const before = raw.length;
    // a wing's name is its short name; its full name is an aka of it
    const full = typeof p.full_name === "string" && p.full_name.trim() && p.full_name.trim() !== p.name ? [p.full_name.trim()] : [];
    consider("w", { ...p, aka: [...full, ...akaOf(p)] }, [p.id], `/promotions/${p.id}/`, "");
    stats.wings += raw.length - before;
  }

  // THE MEMORIAL REGISTER (D566): one row per data/memorials.json row — the register's own names only (`name` and any `aka`;
  // `characters` holds entity ids, never display names, so it is never an aka here) — and one row for In Memoriam itself.
  for (const m of memorials) {
    const before = raw.length;
    consider("m", { id: m.id, name: m.name, aka: akaOf(m) }, [], `/memorials/${m.id}.html`, "");
    stats.memorials += raw.length - before;
  }
  {
    const before = raw.length;
    consider("m", { id: IN_MEMORIAM_ID, name: IN_MEMORIAM_NAME }, [], IN_MEMORIAM_PAGE, "");
    stats.memorials += raw.length - before;
  }

  // One kind may never hold one id twice. (A memorial id that is ALSO a character id is two rows of two kinds with two pages —
  // that is what D566 asks for — but the same kind twice over one id would be a defect, and would make the file ambiguous.)
  const seenKindId = new Set();
  for (const r of raw) {
    const k = r.kind + ":" + r.id.toLowerCase();
    if (seenKindId.has(k)) throw new Error(`find-record index: two "${r.kind}" rows share one id (${r.id})`);
    seenKindId.add(k);
  }

  const order = { w: 0, t: 1, c: 2, m: 3 };
  raw.sort((a, b) => order[a.kind] - order[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // THE PRIVACY FILTER (the coordinator's finding on the first cut: 37 gate-enforced deny rows with no covering allow, and a
  // takedown residual, in names the pages carry under scoped allows that do not reach this new path). Fix it here, never with an
  // ALLOW: any name, aka or id the gate's ledger scan or a takedown library would flag is dropped; a record whose id or display name
  // is flagged is dropped whole; an aka alone is dropped and the record kept by its other names. Counts only are ever logged.
  const priv = { passes: 0, droppedRecords: 0, droppedAkas: 0, droppedMemorials: 0, blankedWings: 0, ledgerRows: 0, lib: {} };
  const blank = new Set();
  let text;
  for (let pass = 1; pass <= 4; pass++) {
    text = render(raw, blank);
    const res = privacyScan(text);
    priv.passes = pass;
    if (pass === 1) { priv.ledgerRows = res.ledger_rows; priv.lib = res.lib; priv.hitLines = Object.keys(res.hit_lines).length; }
    const hits = Object.entries(res.hit_lines);
    if (!hits.length) break;
    if (pass === 4) throw new Error(`find-record index: ${hits.length} line(s) still flagged after ${pass - 1} privacy passes`);
    const dropRec = new Set();
    for (const [ln, flags] of hits) {
      const i = Number(ln) - ROW_LINE0;
      if (i < 0 || i >= raw.length) {
        // the wings table line: blank the flagged wing ids; any other header line hitting is a defect
        const wf = flags.filter((f) => f.startsWith("w:"));
        if (Number(ln) === WINGS_LINE && wf.length) { for (const f of wf) blank.add(wingList(raw)[Number(f.slice(2))]); continue; }
        throw new Error(`find-record index: privacy scan flagged a header line (${ln})`);
      }
      const rec = raw[i];
      const bad = flags.filter((f) => f.startsWith("a:")).map((f) => Number(f.slice(2)));
      const whole = flags.some((f) => f === "id" || f === "name" || f === "p" || f === "s" || f === "line");
      if (whole || !bad.length) dropRec.add(rec);
      else { rec.akas = rec.akas.filter((_, k) => !bad.includes(k)); priv.droppedAkas += bad.length; }
    }
    if (dropRec.size) {
      priv.droppedRecords += dropRec.size;
      for (const r of dropRec) if (r.kind === "m") priv.droppedMemorials++;   // reported, never exempted: the register's own exemption is the gate's, and no more
      raw = raw.filter((r) => !dropRec.has(r));
    }
    priv.blankedWings = blank.size;
  }
  stats.privacy = priv;
  return { text, stats, rows: raw.length, memorials, expectMemorialRows: stats.memorials - priv.droppedMemorials };
}

// The file's fixed layout: line 1 "{", 2 _schema_version, 3 _about, 4 _rows, 5 wings, 6 "rows": [, then one row per line.
const WINGS_LINE = 5, ROW_LINE0 = 7 - 0;   // row i is on line ROW_LINE0 + i (1-based)
const wingList = (raw) => [...new Set(raw.flatMap((r) => r.wings))].sort();

function render(raw, blank) {
  const ids = wingList(raw);
  const table = ids.map((w) => (blank.has(w) ? "" : w));
  const idx = new Map(ids.map((w, i) => [w, i]));
  const lines = raw.map((r) => {
    const ex = {};
    if (r.akas.length) ex.a = r.akas;
    if (r.sub) ex.s = r.sub;
    const dflt = r.kind === "c" ? `/characters/${r.id}.html` : r.kind === "t" ? `/titles/${r.id}.html`
      : r.kind === "m" ? `/memorials/${r.id}.html` : `/promotions/${r.id}/index.html`;
    const page = r.kind === "w" ? `/promotions/${r.id}/index.html` : r.page;
    if (page !== dflt) ex.p = page;
    const row = [r.kind, r.id, r.name, r.wings.map((w) => idx.get(w))];
    if (Object.keys(ex).length) row.push(ex);
    return JSON.stringify(row);
  });
  return `{\n"_schema_version": 1,\n` +
    `"_about": "The compact name index behind GET /api/find-record (D448). Rebuilt by scripts/build-find-record-index.mjs in every gate; do not edit.",\n` +
    `"_rows": ${raw.length},\n` +
    `"wings": ${JSON.stringify(table)},\n` +
    `"rows": [\n${lines.join(",\n")}\n]\n}\n`;
}

/** The gate's ledger scan and the takedown libraries over the index text, by scripts/find-record-privacy-filter.py. Counts and field kinds only. */
function privacyScan(text) {
  const py = resolve(HERE, "find-record-privacy-filter.py");
  const r = spawnSync("python3", ["-I", py, "--root", ROOT], { input: text, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`find-record index: the privacy filter failed (${r.error ? r.error.code : "exit " + r.status}): ${String(r.stderr || "").slice(0, 200).replace(/\s+/g, " ")}`);
  let j;
  try { j = JSON.parse(r.stdout); } catch { throw new Error("find-record index: the privacy filter returned no JSON"); }
  return j;
}

function selfCheck(text, memorials, expectMemorialRows) {
  // 1. the file parses and loads through the Worker's own loader
  const doc = JSON.parse(text);
  const idx = buildIndex(doc);
  if (idx.count !== doc.rows.length) throw new Error(`self-check: ${doc.rows.length - idx.count} row(s) failed the Worker's page-shape test`);
  // 2. every row's page is one of ITS OWN kind's shapes: a memorial page or In Memoriam only ever under kind "m" (D566), a
  //    character, title or wing page never a memorial's, and no row at all is a units listing or an a-z index.
  let memRows = 0;
  for (const r of allRows(idx)) {
    if (!pageOkForKind(r.kind, r.pagePath)) throw new Error(`self-check: a "${r.kind}" row has a page that is not a record of that kind: ${r.pagePath}`);
    if (/^\/units\/|\/a-z\//.test(r.pagePath)) throw new Error(`self-check: a row has a listing page: ${r.pagePath}`);
    if (isMemorialPage(r.pagePath)) memRows++;
  }
  // 3. the memorial register answers for itself (D566): as many memorial rows as the register has pages, less what the privacy
  //    filter dropped; In Memoriam findable by its own name and id; every surviving memorial findable by its own name and id.
  if (memRows !== expectMemorialRows) throw new Error(`self-check: ${memRows} memorial row(s), expected ${expectMemorialRows}`);
  const pages = (q) => lookup(idx, { q, n: FIND_MAX_RESULTS }).results.map((h) => h.row.pagePath);
  for (const [what, q] of [["name", IN_MEMORIAM_NAME], ["id", IN_MEMORIAM_ID]]) {
    if (!pages(q).includes(IN_MEMORIAM_PAGE)) throw new Error(`self-check: In Memoriam is not findable by its own ${what}`);
  }
  for (const m of memorials) {
    if (!idx.rows.some((r) => r[0] === "m" && r[1] === String(m.id))) continue;   // no page file yet, or dropped by the privacy filter
    for (const [what, q] of [["name", m.name], ["id", m.id]]) {
      if (!pages(q).includes(`/memorials/${m.id}.html`)) throw new Error(`self-check: the memorial ${m.id} is not findable by its own ${what}`);
    }
  }
  // 4. no machine path in any string (the PATH-SCRUB check would fail the gate)
  if (/\/(?:home|tmp|mnt|var|root|Users)\/[^\s"]/.test(text)) throw new Error("self-check: a local path is in the index");
  // 5. the right order of magnitude (a half-empty registry must not silently replace a whole index)
  if (idx.count < 1000) throw new Error(`self-check: only ${idx.count} rows`);
  return idx.count;
}

const { text, stats, rows, memorials, expectMemorialRows } = build();
selfCheck(text, memorials, expectMemorialRows);
const have = existsSync(OUT) ? readFileSync(OUT, "utf8") : null;
const same = have === text;
const pv = stats.privacy;
const summary = `${rows} rows (${stats.characters} characters, ${stats.units} units, ${stats.titles} titles, ${stats.wings} wings, ` +
  `${stats.memorials} memorial register rows, before the privacy filter; ` +
  `left out: ${stats.noPage} with no page file, ${stats.noName} unnamed), ` +
  `privacy filter: ${pv.hitLines} line(s) flagged by ${pv.ledgerRows} ledger row(s) and ${Object.values(pv.lib).reduce((a, b) => a + b, 0)} takedown-library line(s), ` +
  `${pv.droppedRecords} record(s) (${pv.droppedMemorials} of them memorial rows) and ${pv.droppedAkas} aka string(s) dropped, ${pv.blankedWings} wing id(s) blanked, ${pv.passes} pass(es), final scan clean; ` +
  `${Buffer.byteLength(text)} bytes`;
if (CHECK) {
  // the file ON DISK must be what would be written, and must itself scan clean (the self-check: any hit fails)
  let diskClean = true;
  if (have !== null) {
    const r = privacyScan(have);
    if (Object.keys(r.hit_lines).length) { diskClean = false; console.log(`find-record-index: the file on disk has ${Object.keys(r.hit_lines).length} flagged line(s) (${r.ledger_rows} ledger row(s), takedown ${JSON.stringify(r.lib)})`); }
  }
  console.log(`find-record-index: ${same ? "current" : "STALE"}: ${summary}`);
  process.exit(same && diskClean ? 0 : 1);
}
if (same) {
  console.log(`find-record-index: unchanged: ${summary}`);
} else {
  const tmp = OUT + ".new";
  writeFileSync(tmp, text);
  renameSync(tmp, OUT);
  console.log(`find-record-index: written: ${summary}`);
}
