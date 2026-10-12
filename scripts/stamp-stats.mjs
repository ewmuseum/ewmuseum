#!/usr/bin/env node
/**
 * THE MUSEUM — lobby door-count stamper (THE LOBBY STATS WAVE, W7; retargeted
 * onto the door lines themselves, W9 rider — the user's own call: a separate
 * "By the numbers" block "honestly looks pretty bad"; the counts belong
 * inside each category door's own title line instead, e.g.
 * "Promotions (11)").
 *
 * Computes the registry's own counts and stamps a "(N)" onto each counted
 * door's own <a> title text on index.html, via a
 * `<!--stat:KEY-->…<!--/stat-->` marker pair sitting right after the door's
 * visible title — repo-complete and readable with no JavaScript at all,
 * same "the repo's own files ARE the served site" principle
 * templates/chrome.html documents for site chrome. Not every door is
 * counted: Search and Curation have nothing to count, and stay plain.
 * Idempotent, same three-step workflow as chrome —
 *   1. (nothing to edit here — the counts come from the data, not from
 *      hand-typed numbers)
 *   2. Run `npm run stats` (this script) to re-stamp index.html.
 *   3. Commit and push. `scripts/registry-validate.mjs` RECOMPUTES the same
 *      counts independently and fails the build if index.html's stamped
 *      numbers have drifted from what the data actually says — the same
 *      drift-can't-silently-happen guarantee the chrome system gives the
 *      masthead/footer, applied to these door counts instead.
 *
 * Run: `npm run stats` (also folded into `npm run check` is the FRESHNESS
 * check only, in registry-validate.mjs — re-stamping itself is a separate,
 * deliberate step, same as chrome).
 */
import { readFileSync, writeFileSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = resolve(ROOT, "data");

function loadArray(name) {
  const p = resolve(DATA, `${name}.json`);
  if (!existsSync(p)) return [];
  const raw = JSON.parse(readFileSync(p, "utf8"));
  if (Array.isArray(raw)) return raw;
  const key = Object.keys(raw).find((k) => k[0] !== "_" && Array.isArray(raw[k]));
  return key ? raw[key] : [];
}

// computeStats() is exported so registry-validate.mjs's freshness check
// computes the SAME numbers from the SAME code path — two independent
// re-implementations of "how many roleplays count as held" would be exactly
// the kind of drift this check exists to prevent.
//
// Doors and what each counts (user's own list): Promotions (promotions),
// Characters (characters only — units got their own door, THE UNITS SPLIT,
// 2026-08-22; door and stat key renamed from "wrestlers" THE
// FRONT-ENTRANCE RENAME, 2026-08-20), Units (units), Championships
// (titles), Shows (shows), Matches (THE MATCH SECTION, 2026-08-20 — every
// INDEXABLE data/shows.json matches[] row, across every show, per the
// purity rule below), Roleplays (data/rps.json — the HELD
// count; data/rp-catalog.json's larger total would overstate what's
// actually served), Halls of Fame (inductions), Awards (data/awards.json —
// the AWARDS DOOR wave). Search, Curation, Frontier and In Memoriam
// carry no count — there's nothing to count on the first three, and the
// dedications are not a tally (THE FRONT DOOR, the Janitor's D255,
// 2026-10-03: the homepage lands as the Impeccable mock showed it; counts
// print with thousands separators, "(29,020)"). THE ESSAYS
// RETIREMENT (the Janitor's gavel, 2026-08-19/20): Essays dropped from the
// front-door grid — the essay form stays in the schema (`data/essays.json`,
// human-written work only going forward) but no longer has a lobby door or
// a live stat of its own.
export function computeStats() {
  const promotions = loadArray("promotions");
  const units = loadArray("units");
  const titles = loadArray("titles");
  const inductions = loadArray("inductions");
  const awards = loadArray("awards");
  const shows = loadArray("shows");
  const rps = loadArray("rps");
  const reigns = loadArray("reigns");
  const relationships = loadArray("relationships");

  // THE UNITS SPLIT (REVIEW-FIXES WAVE, 2026-08-22): characters and units
  // are separate doors now, each counting its own type only — the merged
  // 1,379 was polluting per-type arithmetic (the Janitor's own gender
  // coverage case).
  // THE MATCHES-INDEX PURITY RULE (same wave): the Matches door counts what
  // the instrument actually lists — a degenerate under-parsed row (fewer
  // than two entrants, no outcome/stipulation/eliminations/note) stays in
  // the registry but earns no instrument row. MUST mirror
  // cross-reference.mjs's matchHasIndexableContent() exactly.
  const matchIndexable = (m) => {
    const entrants = (m.sides ?? []).flat().length + (m.participants?.length ?? 0);
    return entrants >= 2 || m.winner_side != null || m.winner != null ||
      (m.winners?.length ?? 0) > 0 || (m.losers?.length ?? 0) > 0 ||
      m.result != null || m.stipulation != null ||
      (m.eliminations?.length ?? 0) > 0 || m.note != null;
  };
  return [
    { key: "promotions", count: promotions.length },
    // THE CHARACTERS DOOR COUNTS WHAT THE CHARACTERS LIST LISTS (hook c207; the
    // Janitor's D479, 2026-10-09: "keep the fold; make the counts agree with
    // it", superseding his D466 call). The list folds every character who
    // portrays a real-world figure into one row per figure (hook c113, his own
    // 7 October ask), so the registry's own length counted 1,543 rows the list
    // does not show, and the lobby door and the door it opens disagreed. The
    // number is read from data/characters-index.json's "_rows" header -- the
    // same single source the list's own total is stamped from, written by
    // cross-reference.mjs, and "BY CONSTRUCTION the row count the instrument
    // then lists" (computeListTotals' own words below). One number, one place:
    // re-deriving the fold here would be a second definition of it, which is
    // what the shows-count drift on file already cost. registry-validate.mjs
    // audits that index against the registry independently and reds if it is
    // stale, so nothing here is taken on trust. data/characters.json is not
    // loaded in this function any more -- nothing else here read it, and it is
    // the largest file the stats step was opening.
    { key: "characters", count: charactersListRows() },
    { key: "units", count: units.length },
    { key: "relationships", count: relationships.length },
    { key: "championships", count: titles.length },
    // THE INSTRUMENTS WAVE (2026-08-22): Reigns/Appearances join the front
    // door grid the same way Matches did — one row per data/reigns.json
    // entry, one row per data/shows.json appearances[] entry (matches AND
    // angles, registry-wide).
    { key: "reigns", count: reigns.length },
    { key: "hof", count: inductions.length },
    // THE AWARD/BESTOWAL SPLIT (QA round 3, 2026-08-22): two doors now —
    // Awards counts the named honors (entities), Bestowals counts the
    // year-by-year results, mirroring the Championships/Reigns pair.
    { key: "awards", count: awards.length },
    { key: "bestowals", count: awards.reduce((n, a) => n + (a.bestowals?.length ?? 0), 0) },
    // THE COLLECTED EDGE (2026-08-22): the lobby counts what is HELD —
    // uncollected rows (collected:false) are findable, not holdings.
    // QA-FIXES B11 (qa-visitor-walk-2026-08-29.md): was `collected !== false`
    // (true for any row that simply never set `collected` at all, whether or
    // not it was ever actually served) -- every other one of these 13
    // counters counts what's actually SERVED, and a served show is exactly
    // one with a `page`. Confirmed live: one row (wwa-1999-05-23) has no
    // `collected` field and no `page` field either, so the old filter
    // counted an unserved show as served and the homepage stat drifted one
    // over data/shows.json's own served count, every regen, permanently.
    { key: "shows", count: shows.filter((s) => s.page).length },
    { key: "matches", count: shows.reduce((n, s) => n + (s.matches ?? []).filter(matchIndexable).length, 0) },
    { key: "appearances", count: shows.reduce((n, s) => n + (s.appearances ?? []).filter((a) => a.kind !== "match").length, 0) },
    { key: "roleplays", count: rps.length },
  ];
}

// computeClacksNames() — THE CLACKS HEADER (Terry Pratchett's Discworld
// "GNU" convention: "a man is not dead while his name is still spoken").
// One name per data/memorials.json entry, in file order; exported so
// registry-validate.mjs's freshness check recomputes from the SAME code
// path, same drift-can't-silently-happen guarantee as the door counts.
export function computeClacksNames() {
  return loadArray("memorials").map((m) => m.name);
}

export function stampHeaders({ write = true } = {}) {
  const headersPath = resolve(ROOT, "_headers");
  const raw = readFileSync(headersPath, "utf8");
  const names = computeClacksNames();
  const block = names.map((n) => `  X-Clacks-Overhead: GNU ${n}`).join("\n");
  const re = /(  # clacks:start\n)([\s\S]*?)(  # clacks:end)/;
  if (!re.test(raw)) throw new Error("_headers: no \"# clacks:start\" / \"# clacks:end\" marker pair found");
  const newRaw = raw.replace(re, (_whole, start, _old, end) => `${start}${block}\n${end}`);
  const changed = newRaw !== raw;
  if (write && changed) writeFileSync(headersPath, newRaw, "utf8");
  return { names, changed };
}

// computeRecentlyAdded() — THE GENERATED-BLURB GAVEL, 2026-08-18 (every
// rendered word computed live from the registry, never hand-typed),
// completed by THE PROMOTIONS-PATH WAVE, 2026-08-22: the SELECTION is now
// mechanical too. The panel is the newest accession lots from
// data/collections.json — accession ids ARE the acquisition sequence, so
// newest = highest id — each rendered with the same live fact-line
// machinery as the door counts: the promotions whose own provenance
// panels cite the lot, plus the shows/roleplays in the registry that
// trace to it directly (the same derivations the lot's own generated
// /collections/<id>.html page bakes). site-config.json's hand-maintained
// `recently_added` list is retired outright, its stale entries (old wing
// links, the missing-shows ledger row) with it — and no pinned-extras
// affordance survives it either: keeping a hand list alive for pins would
// preserve exactly the hand-stale selection machinery this retires.
const RECENTLY_ADDED_COUNT = 5; // the Janitor, 2026-10-05: "Recently added should only show the most recent five"

// THE WHAT-ARRIVED REWRITE (the Janitor's Impeccable critique, 2026-10-03,
// priority issue 5: the panel was eight identical "Web-recovery campaign"
// rows, four of them a bare accession number — a processing queue where a
// visitor decides whether the museum is worth their own archive). Each row
// now says what arrived, every word computed from the registry:
//   when — the day the lot's first served page went up, written in words
//          ("3 October 2026"), from data/documents.json `served_since`;
//   link — the accession page (unchanged);
//   desc — the wing or wings the lot added to, each by full name and years
//          as the wings list names it, then what it holds.
// Consecutive lots of the same campaign (same `kind`) adding to the same
// wings fold into ONE row ("Accessions 0176–0178"); a lot whose own registry
// facts are empty (no wing, no pages, no shows, no roleplays) is left out —
// silence, never a bare row (museum/CLAUDE.md invariants 6–8). The panel is
// the newest RECENTLY_ADDED_COUNT rows AFTER folding.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function wordDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m || +m[2] < 1 || +m[2] > 12) return "";
  return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
}
const fmtN = (n) => n.toLocaleString("en-US");
const plural = (n, one, many) => `${fmtN(n)} ${n === 1 ? one : many}`;

// A wing as the wings list titles it: its full name (the name when it has
// none), with the years of its own founded/closed edges beside it.
function wingTitle(p) {
  const yearOf = (e) => { const m = /^(\d{4})/.exec(e && typeof e.date === "string" ? e.date : ""); return m ? m[1] : null; };
  const a = yearOf(p.founded) ?? (String(p.years ?? "").match(/\d{4}/) || [null])[0];
  const b = yearOf(p.closed);
  const span = a && b && a !== b ? `${a}–${b}` : (a ?? "");
  const name = String(p.full_name || p.name || "").trim();
  return span ? `${name} (${span})` : name;
}

const DOC_NOUNS = { news: ["news post", "news posts"], column: ["column", "columns"], roster: ["roster", "rosters"], rules: ["rules page", "rules pages"] };
const DOC_ORDER = ["shows", "roleplays", "news", "column", "roster", "rules"];
const MAX_WINGS_NAMED = 3;
const MAX_KINDS_NAMED = 4;

const accessionRange = (ids) => {
  const sorted = [...ids].sort();
  if (sorted.length === 1) return `Accession ${sorted[0]}`;
  const contiguous = sorted.every((id, i) => i === 0 || +id === +sorted[i - 1] + 1);
  return contiguous
    ? `Accessions ${sorted[0]}–${sorted[sorted.length - 1]}`
    : `Accessions ${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
};

export function computeRecentlyAdded() {
  const collections = loadArray("collections");
  const promotions = loadArray("promotions");
  const shows = loadArray("shows");
  const rps = loadArray("rps");
  const documents = loadArray("documents");
  const promoById = new Map(promotions.map((p) => [p.id, p]));
  const listOf = (c) => (Array.isArray(c) ? c : [c]);
  const lotsOf = (rows) => {
    const m = new Map();
    for (const r of rows) for (const id of listOf(r.collection)) if (id != null) (m.get(id) ?? m.set(id, []).get(id)).push(r);
    return m;
  };
  const showsByLot = lotsOf(shows), rpsByLot = lotsOf(rps), docsByLot = lotsOf(documents);

  const lots = [...collections].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const rows = [];
  for (const lot of lots) {
    const id = lot.id;
    // Same derivations the generated accession page itself bakes
    // (cross-reference.mjs generateAccessionPage) — promotions via their
    // own sources[].accession cite, shows/rps via their own collection
    // field — plus the served pages (documents.json) the lot stands behind.
    const lotShows = showsByLot.get(id) ?? [], lotRps = rpsByLot.get(id) ?? [], lotDocs = docsByLot.get(id) ?? [];
    const wingIds = new Set([
      ...promotions.filter((p) => (p.sources || []).some((s) => s.accession === id)).map((p) => p.id),
      ...lotShows.map((s) => s.promotion), ...lotRps.map((r) => r.promotion ?? r.venue), ...lotDocs.map((d) => d.wing),   // hook c106 (D407): an rp no fed claims counts its hub
    ].filter((w) => promoById.has(w)));
    const docClass = new Map();
    for (const d of lotDocs) docClass.set(d.doc_class, (docClass.get(d.doc_class) ?? 0) + 1);
    // Registry shows/roleplays are authoritative; a lot with none of its own
    // falls back to the served show-card / roleplay pages it holds.
    const counts = new Map([
      ["shows", lotShows.length || docClass.get("card") || 0],
      ["roleplays", lotRps.length || docClass.get("rp") || 0],
      ...["news", "column", "roster", "rules"].map((k) => [k, docClass.get(k) ?? 0]),
    ]);
    const total = lotShows.length + lotRps.length + lotDocs.length;
    if (!wingIds.size && !total) continue; // empty registry facts: left out, not shown bare
    const served = lotDocs.map((d) => d.served_since).filter((d) => typeof d === "string").sort()[0];
    const wingDates = [...wingIds].map((w) => (loadPromotionDates()[w] || {}).added).filter(Boolean).sort();
    rows.push({
      ids: [id], kind: lot.kind, wings: [...wingIds].sort(), date: served ?? wingDates[0] ?? null,
      pages: lotDocs.length, counts,
    });
  }

  // Fold consecutive lots of one campaign adding to the same wings.
  const folded = [];
  for (const r of rows) {
    const prev = folded[folded.length - 1];
    if (prev && prev.kind === r.kind && prev.wings.length && prev.wings.join("|") === r.wings.join("|")) {
      prev.ids.push(...r.ids);
      prev.pages += r.pages;
      for (const [k, n] of r.counts) prev.counts.set(k, (prev.counts.get(k) ?? 0) + n);
    } else {
      folded.push({ ...r, counts: new Map(r.counts) });
    }
  }

  return folded.slice(0, RECENTLY_ADDED_COUNT).map((r) => {
    const names = r.wings.map((w) => wingTitle(promoById.get(w)));
    const wingPart = names.length > MAX_WINGS_NAMED
      ? `${names.slice(0, MAX_WINGS_NAMED).join(", ")} and ${fmtN(names.length - MAX_WINGS_NAMED)} more`
      : names.join(", ");
    // Biggest holding first; ties keep DOC_ORDER (a stable sort).
    const kinds = DOC_ORDER.filter((k) => r.counts.get(k))
      .sort((a, b) => r.counts.get(b) - r.counts.get(a))
      .map((k) => {
        const n = r.counts.get(k);
        if (k === "shows") return plural(n, "show", "shows");
        if (k === "roleplays") return plural(n, "roleplay", "roleplays");
        return plural(n, DOC_NOUNS[k][0], DOC_NOUNS[k][1]);
      });
    const parts = [];
    if (r.kind === "private-donation") parts.push("Private donation");
    if (wingPart) parts.push(wingPart);
    if (r.pages) {
      parts.push(`${plural(r.pages, "page", "pages")}${kinds.length ? `: ${kinds.slice(0, MAX_KINDS_NAMED).join(", ")}` : ""}`);
    } else if (kinds.length) {
      parts.push(kinds.slice(0, MAX_KINDS_NAMED).join(", "));
    }
    return {
      when: wordDate(r.date),
      page: `/collections/${r.ids[0]}.html`, // newest accession of the row
      label: accessionRange(r.ids),
      fact: parts.join(" · "),
    };
  });
}

let _promotionDates = null;
function loadPromotionDates() {
  if (_promotionDates) return _promotionDates;
  const p = resolve(DATA, "promotion-dates.json");
  _promotionDates = existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")).dates ?? {}) : {};
  return _promotionDates;
}

// ONE renderer for the block's <ul>, shared with registry-validate.mjs §8a
// so the stamp and its freshness check cannot disagree about markup.
export function recentlyAddedListHtml(items) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const li = items.map((it) =>
    `    <li>${it.when ? `<span class="when">${esc(it.when)}</span>` : ""}<a href="${esc(it.page)}">${esc(it.label)}</a>` +
    (it.fact ? `<span class="desc">${esc(it.fact)}</span>` : "") + `</li>`
  ).join("\n");
  return `<ul class="archive-list">\n${li}\n  </ul>`;
}

export function stampRecentlyAdded({ write = true } = {}) {
  const indexPath = resolve(ROOT, "index.html");
  const html = readFileSync(indexPath, "utf8");
  const items = computeRecentlyAdded();
  const block = recentlyAddedListHtml(items);
  const re = /(<!-- recently-added:start -->\n)([\s\S]*?)(\n\s*<!-- recently-added:end -->)/;
  if (!re.test(html)) throw new Error("index.html: no recently-added:start/end marker pair found");
  const newHtml = html.replace(re, (_whole, start, _old, end) => `${start}  ${block}${end}`);
  const changed = newHtml !== html;
  if (write && changed) writeFileSync(indexPath, newHtml, "utf8");
  return { items, changed };
}

export function stampIndex({ write = true } = {}) {
  const indexPath = resolve(ROOT, "index.html");
  const html = readFileSync(indexPath, "utf8");
  const stats = computeStats();
  const byKey = new Map(stats.map((s) => [s.key, s.count]));
  const re = /<!--stat:([a-z]+)-->(.*?)<!--\/stat-->/g;
  let seen = new Set();
  const newHtml = html.replace(re, (whole, key, _old) => {
    if (!byKey.has(key)) throw new Error(`index.html: door marker "${key}" has no matching computeStats() entry`);
    seen.add(key);
    return `<!--stat:${key}-->(${byKey.get(key).toLocaleString("en-US")})<!--/stat-->`;
  });
  for (const s of stats) {
    if (!seen.has(s.key)) throw new Error(`index.html: no <!--stat:${s.key}--> marker found for a computeStats() entry`);
  }
  const changed = newHtml !== html;
  if (write && changed) writeFileSync(indexPath, newHtml, "utf8");
  return { stats, changed };
}

// computeCurationVersion() / stampCurationVersion() — PERFECTION WAVE A
// (2026-08-21). curation.html's own "Current version: vNN, <title>,
// <date>" line drifted twice by hand (stale at v47, hand-corrected since,
// per this wave's own brief) because nothing derived it or checked it —
// same failure shape the door counts and clacks header already had before
// THE LOBBY STATS WAVE fixed them, applied here to the one remaining
// hand-stamped fact on this page. Source of truth: CURATION.md's OWN
// changelog tail, never a hand-typed vNN/title/date triple — the LAST
// `**vNN — ...**` heading found in the file, parsed for its own title and
// date. Two heading shapes coexist in the changelog's own history (both
// real, neither a typo): most entries read `**vNN — <attribution>,
// <date>: <title>.**` (a gaveled ruling, attributed then dated then
// titled after the colon — "the Janitor's gavel, 2026-08-21: the
// founding-edges wave"); a housekeeping/non-gavel entry instead reads
// `**vNN — <title>, <date> (<attribution>).**` with no colon at all (v60
// itself: "the docs consolidation wave, 2026-08-21 (coordinator...)").
// Tried in that order — colon-shaped first (it's the common case and
// keeps the more informative title), falling back to the comma-shaped
// parse only when no colon separates a date from a title.
export function computeCurationVersion() {
  const md = readFileSync(resolve(ROOT, "CURATION.md"), "utf8");
  const headingRe = /\*\*v(\d+)\s*—\s*([\s\S]*?)\*\*/g;
  let m, last = null;
  while ((m = headingRe.exec(md))) last = { v: m[1], body: m[2].replace(/\s+/g, " ").trim() };
  if (!last) throw new Error("CURATION.md: no \"**vNN — ...**\" changelog heading found");

  const DATE_RE = /\d{4}-\d{2}-\d{2}(?:\/\d{2})?/;
  // Colon-shaped: "<attribution>, <date>: <title>."
  const colon = last.body.match(new RegExp(`,\\s*(${DATE_RE.source}):\\s*([^.]+)\\.?\\s*$`));
  // Comma-shaped fallback: "<title>, <date>" (anything may trail the date —
  // a parenthetical, more prose — only the title and the date are kept).
  const comma = last.body.match(new RegExp(`^([^,]+),\\s*(${DATE_RE.source})`));

  let title, date;
  if (colon) { date = colon[1]; title = colon[2].trim(); }
  else if (comma) { title = comma[1].trim(); date = comma[2]; }
  else throw new Error(`CURATION.md: v${last.v}'s own changelog heading ("${last.body}") doesn't match either recognized title/date shape`);

  return { v: last.v, title, date };
}

export function stampCurationVersion({ write = true } = {}) {
  const path = resolve(ROOT, "curation.html");
  const html = readFileSync(path, "utf8");
  const { v, title, date } = computeCurationVersion();
  // Same non-breaking-hyphen entity the hand-authored line already used
  // between a date's own digit groups, so re-stamping never nudges a
  // reflow mid-date at the edge of the line.
  const dateHtml = date.replace(/-/g, "&#8209;");
  const text = `v${v}, ${title}, ${dateHtml}`;
  const re = /(<!-- curation-version:start -->)([\s\S]*?)(<!-- curation-version:end -->)/;
  // hook c142 (2026-10-08): the Janitor took the "Current version" paragraph off curation.html in his own edit of the page.
  // There is nothing to stamp on a page that does not print the line, and the gate runs `stats` — so a missing marker pair
  // is a SKIP, not a throw. Wherever the pair IS present nothing below changes, and registry-validate.mjs's 8a2 still holds
  // the stamped line to CURATION.md's own changelog tail.
  if (!re.test(html)) return { v, title, date, changed: false, skipped: true };
  const newHtml = html.replace(re, (_whole, start, _old, end) => `${start}${text}${end}`);
  const changed = newHtml !== html;
  if (write && changed) writeFileSync(path, newHtml, "utf8");
  return { v, title, date, changed };
}


// stampFrontierNote() / computeFrontierUnheldCount() — RETIRED 2026-10-08
// (the Janitor's site sweep, hook c146: "Remove `Referenced but not yet
// held: ...`"). They stamped a live count into that paragraph on
// promotions.html between a <!--stat:frontierunheld-->...<!--/stat-->
// marker pair — THE STALE-194 FIX of 2026-08-25, which replaced a
// hard-coded 194. The paragraph and its marker are gone from the page, and
// stampFrontierNote() THREW when the marker was missing, so the two
// retire together. Nothing else in the museum read either function
// (checked across scripts/, js/ and ops/ before removing them); the
// frontier's own size says itself on /frontier.html, which lists the rows
// and counts them in its own status line.

// computeListTotals() / stampListTotals() — THE LIST-PAGES WAVE (2026-10-03).
// Six list pages read a pre-baked index at runtime, and until that file landed
// the page said nothing at all about how much was behind it (the status line
// was empty for the whole download, and a failed one read "0 of 0"). Each one
// carries its own total as plain text now, stamped between a
// `<!--stat:listtotal-->…<!--/stat-->` marker pair exactly the way the lobby
// door counts are: repo-complete, readable with no JavaScript, and watched for
// drift by scripts/registry-validate.mjs.
//
// The number comes from the index's own `_rows` header (cross-reference.mjs
// writes it, index schema v2), which is BY CONSTRUCTION the row count the
// instrument then lists. Re-deriving it from the registry here would be a
// second definition of "how many rows this page has" — and the homepage's own
// shows-count drift is already on file as what that costs.
export const LIST_TOTAL_PAGES = [
  { page: "characters.html", index: "characters-index.json" },
  { page: "units.html", index: "units-index.json" },
  { page: "matches.html", index: "matches-index.json" },
  { page: "appearances.html", index: "appearances-index.json" },
  { page: "reigns.html", index: "reigns-index.json" },
  { page: "bestowals.html", index: "awards-index.json" },
  // hook c176 (adversarial review 2026-10-09): these two joined the pre-baked-index instruments in hook c168,
  // so they can carry their own total the way the five above do. A new list page's index does not exist until
  // the gate's own refresh:links has run once, which is what the skip in stampListTotals below is for.
  { page: "shows.html", index: "shows-index.json" },
  { page: "rps.html", index: "rps-index.json" },
  { page: "collections/index.html", index: "collections-index.json" },
];

// The header sits in the file's first few lines; reading 46 MB to count rows
// that the writer already counted would make `npm run check` pay for it twice.
function indexRowCount(name) {
  const p = resolve(DATA, name);
  if (!existsSync(p)) return null;
  const fd = openSync(p, "r");
  const buf = Buffer.alloc(512);
  let n = 0;
  try { n = readSync(fd, buf, 0, 512, 0); } finally { closeSync(fd); }
  const m = /"_rows"\s*:\s*(\d+)/.exec(buf.slice(0, n).toString("utf8"));
  return m ? Number(m[1]) : null;
}

export function computeListTotals() {
  return LIST_TOTAL_PAGES.map(({ page, index }) => ({ page, index, count: indexRowCount(index) }));
}

// charactersListRows() (hook c207) -- the Characters door's own count, which is
// the Characters list's row count and nothing else. indexRowCount() is a hoisted
// function declaration in this module, so computeStats() above can call this.
// A missing or header-less index throws rather than falling back to the
// registry's unfolded length: a silent fallback is exactly the disagreement
// D479 closed. The message ends in the wording scripts/ops/preflight.sh defers,
// so a first cycle after a fresh clone defers to the gate, which checks after
// its own refresh:links.
function charactersListRows() {
  const n = indexRowCount("characters-index.json");
  if (n == null) throw new Error("data/characters-index.json is missing or carries no \"_rows\" header, so the Characters door cannot count what the Characters list lists (the Janitor's D479) -- run `npm run refresh:links`");
  return n;
}

export function stampListTotals({ write = true } = {}) {
  const results = [];
  for (const row of computeListTotals()) {
    const path = resolve(ROOT, row.page);
    if (!existsSync(path)) throw new Error(`${row.page} is missing — can't stamp its list total`);
    const html = readFileSync(path, "utf8");
    const re = /(<!--stat:listtotal-->)(.*?)(<!--\/stat-->)/;
    if (!re.test(html)) throw new Error(`${row.page}: no <!--stat:listtotal--> marker pair found`);
    // 2026-10-08 (coordinator, after preflight 355 stopped twice): a NEW list page's index is written only by the gate's own
    // refresh:links, which runs after preflight's stats step, so on the first cycle after such a page is added the index does
    // not exist yet. Skip it here (the gate's stats step, after refresh:links, stamps it, and registry-validate's parity count
    // still holds the page to its index). An index that exists without a "_rows" header still throws.
    if (row.count == null && !existsSync(resolve(ROOT, "data", row.index))) { console.log(`stamp-stats: data/${row.index} not built yet (a new list page); skipped until refresh:links writes it`); results.push({ ...row, changed: false, skipped: true }); continue; }
    if (row.count == null) throw new Error(`data/${row.index} is missing or carries no "_rows" header — run \`npm run refresh:links\``);
    const newHtml = html.replace(re, `$1${row.count.toLocaleString("en-US")}$3`);
    const changed = newHtml !== html;
    if (write && changed) writeFileSync(path, newHtml, "utf8");
    results.push({ ...row, changed });
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { stats, changed } = stampIndex({ write: true });
  console.log(`stamp-stats: ${changed ? "index.html updated" : "no change (already fresh)"} — ` +
    stats.map((s) => `${s.key}: ${s.count}`).join(", "));
  const { names, changed: headersChanged } = stampHeaders({ write: true });
  console.log(`stamp-stats: ${headersChanged ? "_headers updated" : "no change (already fresh)"} — clacks: ` +
    names.join(", "));
  const { items, changed: recentChanged } = stampRecentlyAdded({ write: true });
  console.log(`stamp-stats: ${recentChanged ? "index.html recently-added block updated" : "no change (already fresh)"} — ${items.length} entries`);
  const { v, title, date, changed: versionChanged, skipped: versionSkipped } = stampCurationVersion({ write: true });
  console.log(versionSkipped
    ? "stamp-stats: curation.html carries no version line (skipped)"
    : `stamp-stats: ${versionChanged ? "curation.html version line updated" : "no change (already fresh)"} — v${v}, ${title}, ${date}`);
  const listTotals = stampListTotals({ write: true });
  const listChanged = listTotals.filter((r) => r.changed);
  console.log(`stamp-stats: ${listChanged.length ? listChanged.length + " list-page total(s) updated" : "no change (already fresh)"} — ` +
    listTotals.map((r) => `${r.page}: ${r.count}`).join(", "));
}
