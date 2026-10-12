#!/usr/bin/env node
/**
 * THE MATCH-SIDE CONVENTION NORMALISER (the Janitor's gavel, 2026-09-02).
 *
 * The gavel: "a tag team wired into a match side names BOTH the unit and its
 * members" — adopted as the forward convention AND applied backwards over the
 * held corpus wherever the roster supports it. The law itself lives in
 * docs/SCHEMA.md's `matches[]`/`sides[]` section and CURATION.md's
 * #match-side-convention paragraph; this script is the mechanical arm of it,
 * kept in the repo so a wing re-processed later can be re-normalised without
 * anyone re-deriving the method.
 *
 * IT IS IDEMPOTENT. Every pass reclassifies from the data on disk; a side that
 * already names both the unit and its roster classifies as `both` and is never
 * touched again. Re-running on an unchanged tree writes nothing.
 *
 * Usage (from the repo root):
 *   node scripts/normalise-match-sides.mjs --report
 *       Classify every `sides`-shaped match side in every
 *       data/shards/<wing>/shows.json and print the counts by class (the
 *       audit's own four buckets), plus the feasibility split inside
 *       `unit_only`.
 *   node scripts/normalise-match-sides.mjs --apply=unit-to-both [--skipped-tsv=PATH]
 *       Phase 2. For every `unit_only` side naming a unit whose units.json row
 *       carries members[] with resolvable character_ids, insert those member
 *       ids into the side immediately after the unit id (roster order), and add
 *       the matching appearance rows to that same show. Units with no recovered
 *       roster are SKIPPED and listed (--skipped-tsv); everything the
 *       over-assertion guard below stops is skipped and listed too
 *       (--ambiguity-tsv, which both phases accept).
 *   node scripts/normalise-match-sides.mjs --apply=members-to-both [--ambiguity-tsv=PATH]
 *       Phase 3. For every `members_only` side whose characters are the WHOLE
 *       recovered roster of a unit with a tenure in that show's promotion,
 *       insert the unit id at the head of the side and add the unit's own
 *       `kind: "match"` appearance row. Genuine ambiguities (two shared units,
 *       no tag-team tiebreak) and partial-roster sides are skipped and listed.
 *   node scripts/normalise-match-sides.mjs --apply=... --dry-run
 *       Classify and plan, print what would change, write nothing.
 *
 * WHY TEXT SURGERY AND NOT A RE-DUMP. The 166 shard files are not uniformly
 * formatted — indentation is 1 space in some wings and 2 in others, 15 wings
 * write compact single-line rows (`{ "who": "x", "kind": "match" }`), and some
 * files end without a trailing newline. Re-serialising a whole file would
 * rewrite thousands of untouched lines. So this parses each file into a
 * span-annotated tree and splices ONLY the insertion points, copying the local
 * separator and indentation from the neighbouring element. A pure-insertion
 * edit also makes the WINNER-FLIP RULE trivially safe: `winner_side` indexes
 * `sides[]`, never the ids inside a side, and no side array is ever added,
 * removed or reordered here. The script re-checks that invariant on every
 * touched match anyway (see `verifyFile`).
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHARDS = resolve(ROOT, "data", "shards");

// ---------------------------------------------------------------------------
// A span-annotated JSON parser. Returns the ordinary parsed value on `.value`
// plus `.start`/`.end` character offsets for every node, so an edit can be a
// splice into the original text rather than a re-serialisation of it.
// ---------------------------------------------------------------------------
function parseSpans(src) {
  let i = 0;
  const isWs = (c) => c === " " || c === "\n" || c === "\t" || c === "\r";
  function ws() { while (i < src.length && isWs(src[i])) i++; }
  function parseValue() {
    ws();
    const start = i;
    const c = src[i];
    if (c === "{") {
      i++;
      const entries = [];
      ws();
      if (src[i] === "}") i++;
      else for (;;) {
        ws();
        const keyNode = parseValue();
        ws();
        if (src[i] !== ":") throw new Error(`expected ":" at ${i}`);
        i++;
        const valNode = parseValue();
        entries.push({ key: keyNode.value, keyNode, valNode });
        ws();
        if (src[i] === ",") { i++; continue; }
        if (src[i] === "}") { i++; break; }
        throw new Error(`expected "," or "}" at ${i}`);
      }
      const node = { type: "object", entries, start, end: i };
      node.value = {};
      for (const e of entries) node.value[e.key] = e.valNode.value;
      return node;
    }
    if (c === "[") {
      i++;
      const elements = [];
      ws();
      if (src[i] === "]") i++;
      else for (;;) {
        elements.push(parseValue());
        ws();
        if (src[i] === ",") { i++; continue; }
        if (src[i] === "]") { i++; break; }
        throw new Error(`expected "," or "]" at ${i}`);
      }
      return { type: "array", elements, start, end: i, value: elements.map((e) => e.value) };
    }
    if (c === '"') {
      i++;
      while (src[i] !== '"') { if (src[i] === "\\") i++; i++; }
      i++;
      return { type: "string", start, end: i, value: JSON.parse(src.slice(start, i)) };
    }
    while (i < src.length && !isWs(src[i]) && src[i] !== "," && src[i] !== "]" && src[i] !== "}") i++;
    return { type: "literal", start, end: i, value: JSON.parse(src.slice(start, i)) };
  }
  return parseValue();
}

const prop = (objNode, key) => objNode.entries.find((e) => e.key === key)?.valNode ?? null;

// The separator text that would sit between element k-1 and element k of this
// array — lifted verbatim from the file so the splice inherits the wing's own
// indentation and line style.
function separatorFor(src, arrNode, k) {
  const els = arrNode.elements;
  if (els.length > 1) {
    const j = k > 0 ? k : 1;
    return src.slice(els[j - 1].end, els[j].start);
  }
  return "," + src.slice(arrNode.start + 1, els[0].start);
}

function compactText(v, spaced) {
  if (Array.isArray(v)) {
    const inner = v.map((x) => compactText(x, spaced)).join(", ");
    return v.length === 0 ? "[]" : spaced ? `[ ${inner} ]` : `[${inner}]`;
  }
  if (v && typeof v === "object") {
    const inner = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${compactText(x, spaced)}`).join(", ");
    return Object.keys(v).length === 0 ? "{}" : spaced ? `{ ${inner} }` : `{${inner}}`;
  }
  return JSON.stringify(v);
}

// Render a new element in the same shape as an existing sibling: compact if the
// sibling is compact, otherwise multi-line at the sibling's own indentation.
function renderLike(src, siblingNode, obj, indentUnit) {
  const raw = src.slice(siblingNode.start, siblingNode.end);
  if (!raw.includes("\n")) return compactText(obj, raw.startsWith("{ ") || raw.startsWith("[ "));
  const before = src.slice(0, siblingNode.start);
  const baseIndent = before.slice(before.lastIndexOf("\n") + 1).match(/^[ \t]*/)[0];
  return JSON.stringify(obj, null, indentUnit).split("\n").join("\n" + baseIndent);
}

function detectIndent(src) {
  for (const line of src.split("\n").slice(1)) {
    const m = line.match(/^( +)\S/);
    if (m) return m[1].length;
  }
  return 2;
}

function applyInsertions(src, insertions) {
  const sorted = insertions.map((x, n) => ({ ...x, n })).sort((a, b) => a.offset - b.offset || a.n - b.n);
  let out = "";
  let cursor = 0;
  for (const ins of sorted) {
    out += src.slice(cursor, ins.offset) + ins.text;
    cursor = ins.offset;
  }
  return out + src.slice(cursor);
}

// ---------------------------------------------------------------------------
// The registry: every character id, every unit id, each unit's recovered
// roster (members[] entries that carry a character_id), its unit_kind, and the
// promotions its tenures name.
// ---------------------------------------------------------------------------
function loadRows(file) {
  if (!existsSync(file)) return [];
  const d = JSON.parse(readFileSync(file, "utf8"));
  if (Array.isArray(d)) return d;
  for (const v of Object.values(d)) if (Array.isArray(v)) return v;
  return [];
}

function buildRegistry() {
  const wings = readdirSync(SHARDS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const charIds = new Set();
  const units = new Map();
  for (const w of wings) {
    for (const c of loadRows(join(SHARDS, w, "characters.json"))) if (c?.id) charIds.add(c.id);
    for (const u of loadRows(join(SHARDS, w, "units.json"))) {
      if (!u?.id) continue;
      const roster = (u.members ?? []).filter((m) => m && typeof m === "object" && m.character_id).map((m) => m.character_id);
      units.set(u.id, {
        id: u.id,
        wing: w,
        kind: u.unit_kind ?? null,
        roster,
        promotions: new Set((u.tenures ?? []).map((t) => t.promotion).filter(Boolean)),
      });
    }
  }
  const unitsOfChar = new Map();
  for (const u of units.values()) {
    for (const cid of u.roster) {
      if (!unitsOfChar.has(cid)) unitsOfChar.set(cid, []);
      unitsOfChar.get(cid).push(u.id);
    }
  }
  return { wings, charIds, units, unitsOfChar };
}

const TAG_RE = /(\btag\b|\btrios?\b|\bsix-man\b|\bhandicap\b|\b\d+-man\b)/i;
const isTagText = (m) => TAG_RE.test(`${m.stipulation ?? ""} ${m.note ?? ""}`);

// ---------------------------------------------------------------------------
// Classification — the audit's own four buckets (the workshop digest
// match-side-convention-audit-2026-09-02.md, "Method"), reproduced so
// before/after counts are comparable to it line for line.
// ---------------------------------------------------------------------------
function classifySide(side, match, reg) {
  const unitsInSide = side.filter((id) => reg.units.has(id));
  const charsInSide = side.filter((id) => reg.charIds.has(id));
  if (unitsInSide.length) {
    for (const uid of unitsInSide) {
      const u = reg.units.get(uid);
      if (u.roster.some((cid) => charsInSide.includes(cid))) return { cls: "both", unit: uid, units: unitsInSide };
    }
    return { cls: "unit_only", unit: unitsInSide[0], units: unitsInSide };
  }
  const shared = new Map();
  for (const cid of charsInSide) {
    for (const uid of reg.unitsOfChar.get(cid) ?? []) {
      if (!shared.has(uid)) shared.set(uid, []);
      shared.get(uid).push(cid);
    }
  }
  const strong = [...shared.entries()].filter(([, hits]) => hits.length >= 2).map(([unit, hits]) => ({ unit, hits }));
  if (strong.length) return { cls: "members_only", shared: strong };
  const weak = [...shared.entries()].map(([unit, hits]) => ({ unit, hits }));
  if (weak.length && isTagText(match)) return { cls: "members_only_single_stip_tag", shared: weak };
  return { cls: "not_unit_wired" };
}

function eachSide(reg, fn) {
  for (const wing of reg.wings) {
    const file = join(SHARDS, wing, "shows.json");
    if (!existsSync(file)) continue;
    for (const show of loadRows(file)) {
      for (const [mi, m] of (show.matches ?? []).entries()) {
        if (!Array.isArray(m.sides)) continue;
        for (const [si, side] of m.sides.entries()) {
          if (!Array.isArray(side) || !side.length) continue;
          fn({ wing, show, mi, m, si, side, ...classifySide(side, m, reg) });
        }
      }
    }
  }
}

function report(reg) {
  const counts = {};
  const extra = { unit_only_roster_known: 0, unit_only_rosterless: 0, both_complete: 0, both_partial: 0 };
  let shows = 0, matches = 0, sides = 0;
  for (const wing of reg.wings) {
    const file = join(SHARDS, wing, "shows.json");
    if (!existsSync(file)) continue;
    for (const show of loadRows(file)) {
      shows++;
      for (const m of show.matches ?? []) {
        matches++;
        if (!Array.isArray(m.sides)) continue;
        for (const side of m.sides) if (Array.isArray(side) && side.length) sides++;
      }
    }
  }
  eachSide(reg, (s) => {
    counts[s.cls] = (counts[s.cls] ?? 0) + 1;
    if (s.cls === "unit_only") {
      const known = s.units.some((uid) => reg.units.get(uid).roster.length > 0);
      extra[known ? "unit_only_roster_known" : "unit_only_rosterless"]++;
    }
    if (s.cls === "both") {
      const u = reg.units.get(s.unit);
      extra[u.roster.every((cid) => s.side.includes(cid)) ? "both_complete" : "both_partial"]++;
    }
  });
  const wired = (counts.unit_only ?? 0) + (counts.members_only ?? 0) + (counts.members_only_single_stip_tag ?? 0) + (counts.both ?? 0);
  return { counts, extra, shows, matches, sides, wired };
}

// ---------------------------------------------------------------------------
// The two normalisation phases.
//
// THE OVER-ASSERTION GUARD (added the same day, after the first full pass over
// the corpus produced two provably wrong shapes). Expanding a unit into a side
// is not free: because `appearances[]` mirrors `sides[]` 1:1, every member id
// inserted also asserts that that person WRESTLED on that card. Two families of
// case break under the plain rule, and both are skipped and listed rather than
// written:
//
//   (a) THE SIDE THE TEXT WON'T HOLD. `arrogance-aawc` carries a roster of
//       three, one of whom the fed's own note names as the team's manager at
//       ringside ("Peyton Wright and Joey Melton with Ray S. Cornette"), and it
//       is wired into a two-man tag title match. `ultra-violents` carries five
//       and is wired into "XUW Tag Team Title Match". Writing the whole roster
//       into those sides would put men in matches the served text says they
//       were not in. So: where the match's own stipulation/note states a
//       per-side count, a roster LARGER than that count is skipped; where it
//       states nothing at all, a roster of four or more is skipped, since the
//       gavel's own word is "tag team" and a four-man side is a claim the
//       record has to make rather than the roster. A roster SMALLER than the
//       stated count is written — those members really were in the match, the
//       side is merely still incomplete, which is honest.
//
//   (b) THE ENTITY ON BOTH SIDES. Two units whose rosters overlap, wired one
//       per side of the same match, expand into a side array that names the
//       same person twice — which the validator hard-fails, correctly. GIWF's
//       `law-and-order` and `the-youngbloods` share Corporal Punishment;
//       `the-phenomenons` and `the-r-p-a` have IDENTICAL two-man rosters, which
//       is a real identity question and not this pass's to answer. So every
//       match is planned as a whole and skipped whole if any id would land on
//       two sides.
// ---------------------------------------------------------------------------

const COUNT_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };

// How many wrestlers a side of THIS match holds, if the fed's own text says —
// an explicit man-count divided across the sides, else the plain-tag default of
// two, else null for "the text doesn't say".
function statedPerSide(m) {
  const t = `${m.stipulation ?? ""} ${m.note ?? ""}`;
  const hit = t.match(/\b(\d+|two|three|four|five|six|seven|eight|nine|ten|twelve)[\s-]?man\b/i);
  if (hit) {
    const n = /^\d+$/.test(hit[1]) ? Number(hit[1]) : COUNT_WORDS[hit[1].toLowerCase()];
    if (n && m.sides.length && n % m.sides.length === 0) return n / m.sides.length;
  }
  if (/\btag[\s-]?(team|match|matches|titles?|championships?)\b/i.test(t)) return 2;
  return null;
}

function planFile(wing, reg, phase, log) {
  const file = join(SHARDS, wing, "shows.json");
  if (!existsSync(file)) return null;
  const src = readFileSync(file, "utf8");
  const indentUnit = detectIndent(src);
  const root = parseSpans(src);
  const insertions = [];
  let touchedSides = 0, touchedAppearances = 0;
  const verify = [];

  // one shard is written in the wrapped `{ _schema_version, shows: [...] }`
  // shape rather than as a bare array — unwrap to the row array either way
  const rowsNode = root.type === "array" ? root : root.entries.map((e) => e.valNode).find((n) => n.type === "array");
  if (!rowsNode) return { file, src, out: src, touchedSides, touchedAppearances, verify };

  for (const showNode of rowsNode.elements) {
    const show = showNode.value;
    const matchesNode = prop(showNode, "matches");
    if (!matchesNode || matchesNode.type !== "array") continue;
    const appearancesNode = prop(showNode, "appearances");
    const haveAppearance = new Set((show.appearances ?? []).map((a) => `${a.who} ${a.kind}`));
    const appearanceAdds = [];

    for (const [mi, matchNode] of matchesNode.elements.entries()) {
      const m = matchNode.value;
      const sidesNode = prop(matchNode, "sides");
      if (!sidesNode || sidesNode.type !== "array") continue;

      // Plan the WHOLE match before writing any of it, so an id that would land
      // on two sides kills the match rather than half of it.
      const plans = [];
      for (const [si, sideNode] of sidesNode.elements.entries()) {
        const side = sideNode.value;
        if (!Array.isArray(side) || !side.length) continue;
        const c = classifySide(side, m, reg);

        if (phase === "unit-to-both" && c.cls === "unit_only") {
          const uid = c.units.find((x) => reg.units.get(x).roster.length > 0) ?? c.units[0];
          const u = reg.units.get(uid);
          const ctx = { wing, show: show.id, match: m.order ?? mi, unit: uid, units: [uid] };
          if (!u.roster.length) { log.rosterless.push(ctx); continue; }
          const unresolved = u.roster.filter((cid) => !reg.charIds.has(cid));
          if (unresolved.length) log.unresolvedMembers.push({ ...ctx, units: unresolved });
          // THE OVER-ASSERTION GUARD (a)
          const stated = statedPerSide(m);
          if (stated !== null ? u.roster.length > stated : u.roster.length >= 4) {
            log.overAssert.push({ ...ctx, why: stated !== null ? `roster ${u.roster.length} > ${stated} per side stated by the card` : `roster ${u.roster.length}, card states no per-side count` });
            continue;
          }
          const add = u.roster.filter((cid) => reg.charIds.has(cid) && !side.includes(cid));
          if (!add.length) continue;
          const unitIdx = side.indexOf(uid);
          const anchor = unitIdx >= 0 ? unitIdx : side.length - 1;
          const sep = separatorFor(src, sideNode, anchor + 1 < sideNode.elements.length ? anchor + 1 : anchor);
          const kind = (show.appearances ?? []).find((a) => a.who === uid && a.kind === "match")?.kind ?? "match";
          plans.push({ si, side, add, kind, ctx, offset: sideNode.elements[anchor].end, text: add.map((cid) => sep + JSON.stringify(cid)).join("") });
        }

        if (phase === "members-to-both" && c.cls === "members_only") {
          const ctx = { wing, show: show.id, match: m.order ?? mi };
          // A candidate is a unit with a tenure in THIS show's promotion whose
          // ENTIRE recovered roster is present in this side. A stable with two
          // of six men in a tag match was not "wired into the side" as a unit —
          // adding its id would credit four men who are not in the match — so
          // partial-roster sides are listed, not normalised.
          const inPromo = c.shared.filter((x) => reg.units.get(x.unit).promotions.has(show.promotion));
          if (!inPromo.length) { log.noTenure.push({ ...ctx, units: c.shared.map((x) => x.unit) }); continue; }
          const full = inPromo.filter((x) => reg.units.get(x.unit).roster.every((cid) => side.includes(cid)));
          if (!full.length) { log.partialRoster.push({ ...ctx, units: inPromo.map((x) => x.unit) }); continue; }
          let pick = full;
          if (pick.length > 1) {
            const tag = pick.filter((x) => reg.units.get(x.unit).kind === "tag-team");
            const tagMatch = isTagText(m) || (m.sides.length >= 2 && m.sides.every((o) => Array.isArray(o) && o.length >= 2));
            if (tagMatch && tag.length === 1) pick = tag;
          }
          if (pick.length > 1) { log.ambiguous.push({ ...ctx, units: pick.map((x) => x.unit) }); continue; }
          const uid = pick[0].unit;
          if (side.includes(uid)) continue;
          const sep = separatorFor(src, sideNode, 0);
          plans.push({ si, side, add: [uid], kind: "match", ctx: { ...ctx, units: [uid] }, offset: sideNode.elements[0].start, text: JSON.stringify(uid) + sep, before: true });
        }
      }
      if (!plans.length) continue;

      // THE OVER-ASSERTION GUARD (b): no id may end up on two sides.
      const after = m.sides.map((o, oi) => {
        const p = plans.find((x) => x.si === oi);
        return Array.isArray(o) ? [...o, ...(p ? p.add : [])] : [];
      });
      const flat = after.flat();
      if (new Set(flat).size !== flat.length) {
        const dupes = [...new Set(flat.filter((id, k) => flat.indexOf(id) !== k))];
        log.crossSide.push({ wing, show: show.id, match: m.order ?? mi, units: dupes });
        continue;
      }

      for (const p of plans) {
        insertions.push({ offset: p.offset, text: p.text });
        touchedSides++;
        for (const cid of p.add) {
          const key = `${cid} ${p.kind}`;
          if (haveAppearance.has(key)) continue;
          haveAppearance.add(key);
          appearanceAdds.push({ who: cid, kind: p.kind });
        }
        verify.push({ show: show.id, mi, si: p.si, before: p.side.slice(), added: p.add, winner_side: m.winner_side });
        log.applied.push(p.ctx);
      }
    }

    if (appearanceAdds.length) {
      if (!appearancesNode || appearancesNode.type !== "array" || !appearancesNode.elements.length) {
        throw new Error(`show "${show.id}": expected a non-empty appearances[] to extend`);
      }
      const last = appearancesNode.elements[appearancesNode.elements.length - 1];
      const sep = separatorFor(src, appearancesNode, appearancesNode.elements.length - 1);
      insertions.push({ offset: last.end, text: appearanceAdds.map((a) => sep + renderLike(src, last, a, indentUnit)).join("") });
      touchedAppearances += appearanceAdds.length;
    }
  }

  const out = insertions.length ? applyInsertions(src, insertions) : src;
  return { file, src, out, touchedSides, touchedAppearances, verify };
}

// WINNER-FLIP RULE. Re-read the written file and prove, per touched match, that
// sides[] still has the same sides in the same order, that winner_side is
// unchanged and still in range, and that the touched side is exactly its old
// entity set plus the ids this pass added.
function verifyFile(file, verify) {
  const byId = new Map(loadRows(file).map((s) => [s.id, s]));
  for (const v of verify) {
    const m = byId.get(v.show)?.matches?.[v.mi];
    if (!m) throw new Error(`verify: lost match ${v.show}[${v.mi}]`);
    if (m.winner_side !== v.winner_side) throw new Error(`verify: winner_side moved on ${v.show}[${v.mi}]`);
    if (typeof v.winner_side === "number" && !(v.winner_side >= 0 && v.winner_side < m.sides.length)) {
      throw new Error(`verify: winner_side out of range on ${v.show}[${v.mi}]`);
    }
    const now = m.sides[v.si];
    const expected = new Set([...v.before, ...v.added]);
    if (now.length !== expected.size || !now.every((id) => expected.has(id))) {
      throw new Error(`verify: side ${v.show}[${v.mi}][${v.si}] is not before+added`);
    }
  }
}

// ---------------------------------------------------------------------------
function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  const valOf = (name) => { const f = flag(name); return f && f.includes("=") ? f.slice(f.indexOf("=") + 1) : null; };
  const reg = buildRegistry();

  if (!flag("apply")) {
    const r = report(reg);
    console.log(`corpus: ${r.shows} shows, ${r.matches} matches, ${r.sides} side-arrays, ${r.wired} unit-wired`);
    for (const k of ["unit_only", "members_only", "members_only_single_stip_tag", "both", "not_unit_wired"]) {
      console.log(`  ${k.padEnd(30)} ${String(r.counts[k] ?? 0).padStart(6)}`);
    }
    console.log(`  unit_only w/ recovered roster  ${String(r.extra.unit_only_roster_known).padStart(5)}`);
    console.log(`  unit_only rosterless           ${String(r.extra.unit_only_rosterless).padStart(5)}`);
    console.log(`  both, full roster listed       ${String(r.extra.both_complete).padStart(5)}`);
    console.log(`  both, partial roster listed    ${String(r.extra.both_partial).padStart(5)}`);
    return;
  }

  const phase = valOf("apply");
  if (!["unit-to-both", "members-to-both"].includes(phase)) {
    console.error('--apply must be "unit-to-both" or "members-to-both"');
    process.exit(2);
  }
  const dry = !!flag("dry-run");
  const log = { applied: [], rosterless: [], unresolvedMembers: [], overAssert: [], crossSide: [], ambiguous: [], partialRoster: [], noTenure: [] };
  let files = 0, sidesTouched = 0, appearancesAdded = 0;

  for (const wing of reg.wings) {
    const plan = planFile(wing, reg, phase, log);
    if (!plan || plan.out === plan.src) continue;
    files++;
    sidesTouched += plan.touchedSides;
    appearancesAdded += plan.touchedAppearances;
    JSON.parse(plan.out); // never write a file that no longer parses
    if (!dry) {
      writeFileSync(plan.file, plan.out);
      verifyFile(plan.file, plan.verify);
    }
  }

  console.log(`phase ${phase}${dry ? " (dry run)" : ""}: ${files} shard files, ${sidesTouched} sides, ${appearancesAdded} appearance rows added`);
  for (const [k, v] of Object.entries(log)) if (k !== "applied" && v.length) console.log(`  ${k}: ${v.length}`);

  const tsv = valOf("skipped-tsv");
  if (tsv && log.rosterless.length) {
    writeFileSync(tsv, "wing\tshow\tmatch\tunit\n" + log.rosterless.map((r) => `${r.wing}\t${r.show}\t${r.match}\t${r.unit}`).join("\n") + "\n");
    console.log(`  skipped (rosterless) written to ${tsv}`);
  }
  const atsv = valOf("ambiguity-tsv");
  if (atsv) {
    const rows = [
      ...log.overAssert.map((r) => ({ ...r, why: `over-assertion-guard: ${r.why}` })),
      ...log.crossSide.map((r) => ({ ...r, why: "expanding-would-put-an-id-on-two-sides-of-this-match" })),
      ...log.unresolvedMembers.map((r) => ({ ...r, why: "roster-member-id-does-not-resolve-to-a-character" })),
      ...log.ambiguous.map((r) => ({ ...r, why: "two-shared-units-no-tag-team-tiebreak" })),
      ...log.partialRoster.map((r) => ({ ...r, why: "only-part-of-the-roster-is-in-the-side" })),
      ...log.noTenure.map((r) => ({ ...r, why: "shared-unit-has-no-tenure-in-this-promotion" })),
    ];
    if (rows.length) {
      writeFileSync(atsv, "wing\tshow\tmatch\twhy\tunits\n" + rows.map((r) => `${r.wing}\t${r.show}\t${r.match}\t${r.why}\t${(r.units ?? []).join(",")}`).join("\n") + "\n");
      console.log(`  ambiguities written to ${atsv}`);
    }
  }
}

main();
