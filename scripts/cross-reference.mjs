#!/usr/bin/env node
/**
 * THE MUSEUM — the cross-referencer (THE REGISTRY WAVE).
 *
 * Auto-links entity mentions on curated pages only — never inside a verbatim
 * artifact document (each wing's archive folder, e.g. promotions/uwf/archive/ —
 * excluding that folder's own index.html, which is a curated listing page).
 * Every character and unit in
 * data/characters.json + data/units.json is a candidate; a name that resolves
 * to exactly one entity (globally, or within the page's own promotion once
 * narrowed) gets linked straight to its /characters.html entry. A name that
 * stays ambiguous even after narrowing is left as plain, unlinked text —
 * two same-named entities sort next to each other in the ordinary
 * characters.html list either way, which is disambiguation enough.
 *
 * Also regenerates characters.html (the entity hub every link points into,
 * flat and alphabetical — THE FLATTENING WAVE, no per-promotion grouping —
 * with "Appears in" backlinks) and data/wanted.json (capitalized names seen
 * in curated prose that match no registry entity — the mining wish-list).
 *
 * No dependencies. Run: `npm run refresh:links` (idempotent — safe to re-run;
 * it always re-derives links from a clean copy of each page's prose, never
 * compounding old link markup).
 */

import { readFileSync, writeFileSync as _rawWriteFileSync, readdirSync, statSync, existsSync, mkdirSync, unlinkSync, rmdirSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { stampHtml } from "./stamp-chrome.mjs";
// THE SHARED MARKER MODULE (PROSE-FIX-01, 2026-09-13; proposal.md #0) —
// PROCESS_MARKER_RE/SOURCE_MARKER_RE now compile from the same tagged
// source list registry-validate.mjs's gate-time PROCESS_TEXT_RE does, so a
// fix to one no longer silently misses the other. See text-markers.mjs's
// own header for what changed in this pass and why.
import { PROCESS_MARKER_RE, SOURCE_MARKER_RE } from "./text-markers.mjs";

// THE TRAILING-WHITESPACE FIX (2026-08-30): every writeFileSync call in this
// script writes through here so no generated page ever carries a trailing-
// whitespace-only line again. The template engine's own empty conditional
// blocks (an unfilled aka/identity/relationships section, etc.) collapse to
// an indent with nothing after it — harmless to every renderer, but a hard
// stop for the pre-commit hook's `git diff --cached --check` conflict-marker
// scan (GAVELS 2026-08-30, gate guardrails), which flags trailing whitespace
// on any newly-added line. A brand-new entity's page is 100% new lines, so
// this tripped on the FIRST fresh mint after the guardrail rollout. Stripping
// trailing spaces/tabs at end-of-line changes no rendered output (HTML
// collapses that whitespace anyway) and touches only files this run already
// regenerates.
function writeFileSync(path, content, ...rest) {
  if (typeof content === "string") content = content.replace(/[ \t]+$/gm, "");
  return _rawWriteFileSync(path, content, ...rest);
}

// UNIT KIND LABELS (QA sample 2026-09-05): words, not enum tokens.
const UNIT_KIND_LABEL = { "tag-team": "Tag team", "tag team": "Tag team", stable: "Stable", trio: "Trio", entourage: "Entourage", other: "Group" };

// L312: wingLabelFor (v2) — ONE label rule for a wing, shared by the promotions
// A-Z register below and mirrored by hand in stamp-promotion-headers.mjs's own
// wingheader h1, so the two surfaces can never disagree again (rename-qa-
// 2026-09-06, defects C1/C2/M1).
//
// L283's correction wave moved a wing's disambiguator INTO its `name`
// ("ADW (All Desert Wrestling)", "EWA (2005-09)"), which is exactly the shape
// every label composition on this file assumed could not happen.  The label is
// now the registry `name`, and `full_name` is appended after an em-dash ONLY
// when it is not already visible inside that name.  That single containment
// guard kills all three observed duplications at once:
//
//   C1  "All Desert Wrestling (All Desert Wrestling) (ADW (All Desert Wrestling))"
//       (qualifiedFullName() re-appending a `qualifier` that mirrors the name's
//       own parenthetical, then the a-z builder nesting acronymLabel()'s return
//       value -- which IS the whole `name` -- a second time)
//   C2  "ADW (All Desert Wrestling) - All Desert Wrestling"
//   M1  "CWF (1996) - CWF"  (a `full_name` that is a bare-acronym placeholder)
//
// A missing `full_name` is tolerated by construction: there is nothing to
// append, so the 77 rows whose placeholder expansion this wave removes render
// their bare corrected name and nothing else.
//
// Verified against the live registry before shipping: 807 wings, 807 distinct
// labels, no collisions -- so acronymLabel()'s year twin is not needed here.
// (The a-z row renders the wing's own `years` span two lines down anyway.)
//
// ORDER: acronym-first, matching the wing h1's own em-dash form, so the
// register entry and the page it links to read identically.  Flip
// WING_LABEL_ORDER to "full-name-first" for "FULL NAME (NAME)" instead -- the
// one-line switch back to the pre-correction full-names-primary convention.
const WING_LABEL_ORDER = "acronym-first";
function wingLabelFor(p, base) {
  if (!p) return "";
  // `base` lets a surface that MUST keep the era pass acronymLabel(p) in place
  // of the bare `name`: a lot page's held row carries no `years` span of its
  // own, where the A-Z row does.  Defaults to the registry name.
  const name = String(base ?? p.name ?? "").trim();
  const full = p.full_name == null ? "" : String(p.full_name).trim();
  if (!full || full === name) return name;
  if (name.toLowerCase().includes(full.toLowerCase())) return name;
  return WING_LABEL_ORDER === "full-name-first" ? `${full} (${name})` : `${name} \u2014 ${full}`;
}
// L312: wingLabelFullNameFirst -- the same no-repeat discipline for the ONE
// surface whose order runs the other way.  affilPartyHtml's affiliation rows
// carry the 2026-09-05 UNIFORM RULE (full name primary, acronym secondary);
// that order gavel is UNTOUCHED here, only the duplication goes.  The row used
// to compose `${qualifiedFullName(p)} (${acro})`, where qualifiedFullName()
// re-appended a `qualifier` mirroring the name's own parenthetical and `acro`
// was the whole `name` -- three copies of one string, exactly as in the a-z:
// "All Desert Wrestling (All Desert Wrestling) (ADW (All Desert Wrestling))".
//
// The era is NOT dropped.  Every secondary part -- the acronym, the name's own
// parenthetical, a twin's year -- is comma-joined inside the ONE secondary
// parenthesis, which is this row's own established shape: "a twin's year joins
// with a comma, never a nested parenthesis" (QA sample 2, 2026-09-05),
// generalised from the twin year to every part.  A part already visible in the
// primary is dropped rather than repeated, and a row with no `full_name` at all
// falls back to its acronym as the primary.
function wingLabelFullNameFirst(p, twins) {
  if (!p) return "";
  const name = String(p.name ?? "").trim();
  const cut = name.indexOf(" (");
  const acro = (cut >= 0 ? name.slice(0, cut) : name).trim();
  const era = cut >= 0 ? name.slice(cut + 2).replace(/\)\s*$/, "").trim() : "";
  const full = p.full_name == null ? "" : String(p.full_name).trim();
  const primary = full || acro || name;
  const parts = [];
  const addPart = (raw) => {
    const v = String(raw ?? "").trim();
    if (!v) return;
    if (primary.toLowerCase().includes(v.toLowerCase())) return;
    // ...or already inside a part we have (a twin's "1998" inside the name's
    // own era "1998-99"), not merely equal to one.
    if (parts.some((q) => q.toLowerCase().includes(v.toLowerCase()))) return;
    parts.push(v);
  };
  addPart(acro);
  addPart(era);
  if (twins) addPart(firstYear(p.years) ?? "year unknown");
  return parts.length ? `${primary} (${parts.join(", ")})` : primary;
}
// CHARACTER KIND CHIP LABELS (wave-C90-L286, the Janitor, 2026-09-06): the
// depiction/nonhuman distinction on the wrestler/character primary listing
// — see entityCard() below. Declared here, at the top of the file, beside
// UNIT_KIND_LABEL — NOT further down near entityCard's own first use of it
// — because a top-level const declared below its first use has crashed
// this file with a TDZ error twice already.
// hook c113: "real-person" is the kind of the character index's one row per portrayed real person (ONE ROW PER
// PORTRAYED REAL PERSON, at the index below); "depiction" stays on every per-promotion portrayal's own card.
const CHARACTER_KIND_LABEL = { depiction: "Depiction", nonhuman: "Nonhuman", "real-person": "Real person" };
// MEDIUM LABELS (wave-C90-L286) — mirrors promotions.html's own inline
// MEDIUM_LABELS table verbatim (source of truth: promotions.html's own
// <script>, not this file); duplicated here because this build script has
// no way to load that inline script at generation time and characters.html
// renders its rows from server-baked HTML, not a client-side rebuild the
// way promotions.html does. Keep the two tables in sync by hand if
// promotions.html's table ever changes.
const MEDIUM_LABEL = { "newsgroup": "Newsgroup", "website": "Website", "forum": "Forum", "bbs": "BBS", "fidonet": "FidoNet", "email": "E-mail", "mail": "Postal mail", "online-service": "Online service", "chat": "Chat", "wiki": "Wiki", "virtual-world": "Virtual world", "video": "Video", "audio": "Audio", "social-media": "Social media", "game": "Video game", "in-person": "In person", "other": "Other medium", "unknown": "Medium unknown" };
// LIVE LOT-COUNT SUBSTITUTION (L217, 2026-09-06): the visitor-facing lot
// `blurb` (data/collections.json, L120/apply-lot-blurbs.py) types its
// wing-count and document-count clause by hand at accession time; every
// publish that adds served pages under an already-accessioned wing makes
// that number stale without anyone re-editing the blurb (L214,
// wave-C90-L214/digest.md: 113/146 blurbs stale against the tree). These
// regexes match ONLY the exact count-sentence shapes
// wave-C90-L120/delta/data/gen_blurbs.py can produce; liveBlurbCounts()
// below swaps just the numbers (and "wing"/"wings", "document"/"documents")
// for the live figures the renderer already computes (holdingPromos.length)
// plus a live per-lot document count, leaving every other sentence in the
// blurb untouched. Literal-only, no dependency on anything defined later in
// this file, so -- like SOURCE_DOC_PATH_RE just above -- safe to hoist here
// (gate-61/hoist-note lesson: a const WITH a dependency crashes the
// top-level index build if hoisted before that dependency initialises).
const BLURB_BROUGHT_WING_RE = /\bIt brought \d+ wings? into the museum\b/;
const BLURB_BROUGHT_DOC_RE = /, which together hold roughly \d+ documents? today\b/;
const BLURB_STANDS_DOC_RE = /, which holds \d+ documents? today\b/;
// Per-lot live stats cache: populated once per lot as generateAccessionPage
// runs (the for-loop below it, before generateAccessionIndex is ever
// called), so the index page's row rendering reuses the same figures
// instead of re-walking every wing's promotions/<wing>/archive/rp directories a second time.
const lotLiveStats = new Map();
function pluralWord(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
function liveBlurbCounts(blurb, liveWings, liveDocs) {
  if (typeof blurb !== "string" || !blurb) return blurb;
  let out = blurb;
  if (typeof liveWings === "number" && BLURB_BROUGHT_WING_RE.test(out)) {
    out = out.replace(BLURB_BROUGHT_WING_RE, `It brought ${pluralWord(liveWings, "wing")} into the museum`);
  }
  if (typeof liveDocs === "number") {
    if (BLURB_BROUGHT_DOC_RE.test(out)) {
      out = out.replace(BLURB_BROUGHT_DOC_RE, `, which together hold roughly ${pluralWord(liveDocs, "document")} today`);
    } else if (BLURB_STANDS_DOC_RE.test(out)) {
      out = out.replace(BLURB_STANDS_DOC_RE, `, which holds ${pluralWord(liveDocs, "document")} today`);
    }
  }
  return out;
}
// Live per-wing served-document count: same convention the per-wing
// holdings.html generator further down this file already uses for its own
// docCount line (files under promotions/<wing>/archive/ and .../rp/,
// counting a nested archive/index.html or rp/index.html as a genuine
// document -- only the WING-ROOT index.html/holdings*.html are the site's
// own landing pages and stay excluded here by construction, since they
// live outside archive/ and rp/ entirely). Matches wave-C90-L214's
// git-ls-tree-verified methodology (digest.md).
function wingDocCount(promo) {
  const pdir = resolve(ROOT, "promotions", promo.id);
  let n = 0;
  for (const sub of ["archive", "rp"]) {
    const d = resolve(pdir, sub);
    if (!existsSync(d)) continue;
    n += readdirSync(d).filter((f) => f.endsWith(".html")).length;
  }
  return n;
}
// SOURCE-PATH LINKING WAVE (L199, entity-page residue sweep, 2026-09-06,
// ranked #1 by page count -- 8,136 pages): a tenure.source citation the
// curator wrote with a bare site-relative document path baked in
// ("promotions/agw/archive/title-histories.html") rendered as inert text,
// never a link -- servedSourceText() below now finds every such path and
// turns it into a real one. Pure regex, no runtime dependency, so it lives
// here beside UNIT_KIND_LABEL rather than near its own call site further
// down (gate-61/hoist-note lesson: a const with a dependency crashes the
// top-level index build if hoisted before that dependency initialises --
// this one has none, so it is safe here).
// eslint-disable-next-line no-unused-vars -- read by linkSourceDocPaths(), declared further down
const SOURCE_DOC_PATH_RE = /(?:\.\/)?\b(?:promotions|archive|data)\/[\w.-]+(?:\/[\w.-]+)*\.html?\b/g;
// hoisted 2026-09-06 (coordinator, preflight 64b): consts referenced above their original position
// hoisted 2026-09-06 (coordinator, preflight 64d): literal consts used by servedText()/stripProcessSentences() during top-level index building
const AFFIL_CARD_LABEL = {
  // [body when this page is "a", body when this page is "b"] — describing
  // the card's subject (the OTHER party), not this page.
  "affiliate-listing": ["Affiliate of {P}", "Affiliate of {P}"],
  ownership: ["Owned by {P}", "Owns {P}"],
  acquisition: ["Acquired by {P}", "Acquired {P}"],
  academy: ["Academy &mdash; feeds into {P}", "Fed by its academy {P}"],
  "sister-promotion": ["Sister promotion of {P}", "Sister promotion of {P}"],
  "shared-continuity": ["Shared continuity with {P}", "Shared continuity with {P}"],
  "invading-faction": ["Invaded {P}", "Invaded by {P}"],
  "crossover-booking": ["Crossover booking with {P}", "Crossover booking with {P}"],
  rivalry: ["Rivalry with {P}", "Rivalry with {P}"],
  "successor-of": ["Predecessor to {P}", "Successor to {P}"],
  "alliance-operator": ["Operated by {P}", "Operates {P}"],
  // A8 (THE COMMUNITY-PRESENCE EDGE): a = the promotion, b = the community.
  // On the promotion's own page the card names the community; on the
  // community's own page it names the promotion present in it.
  "community-presence": ["Community &mdash; {P} was present here", "Present in {P}"],
};
const SOURCE_KIND_LABEL = {
  drive: "Drive",
  "usenet-post": "Usenet posts",
  usenet: "Usenet",
  "web-recovery": "Web recovery",
  wayback: "Wayback Machine",
  "live-site": "Live site",
  "yahoo-group": "Yahoo group",
  "local-documents": "Local document",
  "tabletop-notes": "Tabletop notes",
  // cd-archive (the Janitor's enum fold, 2026-08-25): archived CD-ROM /
  // disk-image media — the NetNews-on-CD and shareware-CD acquisitions.
  "cd-archive": "CD archive",
  // wiki-dump: label only for now — the enum fold rides the pending wiki-efed gavel.
  "wiki-dump": "Wiki dump",
  // common-crawl (the Janitor, 2026-08-25, the fwrestling.com census):
  // holdings recovered from the Common Crawl web archive rather than from
  // web.archive.org directly — see docs/SCHEMA.md's sources[].kind note.
  "common-crawl": "Common Crawl",
};
const KIND_LABEL = { "private-donation": "Private donation", "web-recovery": "Web-recovery campaign" };
const DATE_SORT_LAST = "9999-99-99";
const CAPACITY_LABEL = {
  commentary: "commentary", referee: "referee", "ring-announcer": "ring announcer",
  authority: "authority", interviewer: "interviewer",
};
// PROCESS_MARKER_RE now imported from ./text-markers.mjs (THE SHARED MARKER
// MODULE, PROSE-FIX-01, 2026-09-13; proposal.md #0) — see the import at the
// top of this file.
const BIO_GRADE_TAG_RE = /[ \t]*\(presumed\)/gi;
const RELATIONSHIP_VERB = {
  feud: "Feud with", "tag-partner": "Tag partner of", ally: "Ally of",
  "kayfabe-kin": "Kayfabe kin of", "kayfabe-spouse": "Kayfabe spouse of", mentor: "Mentor of",
  "manager-of": "Manages",
};
const AUTO_PORTRAYAL_NOTE_RE = /^The real professional wrestler, staged under this ring name by .+\.$/;
// THE DEPICTION PLACARD'S ROLE WORDS (hook c116; the Janitor's D430, desk send 2026-10-07, verbatim "(B) role words";
// CURATION.md v78(g)). The placard keeps "a portrayal of the professional wrestler, staged by this promotion." for a person
// the fed staged as a wrestler, and otherwise names the role the fed's own fiction gave them. The role is the PORTRAYAL's:
// its own `portrayal_role` when it carries one (registry-validate.mjs holds the same values), else its tenures' roles — a
// recorded "wrestler", no role, or only other/mascot keep the gavel's words; otherwise the first of manager, commentator,
// referee, authority-figure.
const PORTRAYAL_ROLE_WORDS = {
  wrestler: "the professional wrestler",
  manager: "the wrestling manager",
  commentator: "the commentator",
  referee: "the referee",
  "authority-figure": "the authority figure",
  "ring-announcer": "the ring announcer",
  promoter: "the wrestling promoter",
  "public-figure": "the public figure",
};
const PORTRAYAL_ROLE_FROM_TENURES = ["manager", "commentator", "referee", "authority-figure"];
function portrayalRole(e) {
  if (typeof e.portrayal_role === "string" && Object.prototype.hasOwnProperty.call(PORTRAYAL_ROLE_WORDS, e.portrayal_role)) return e.portrayal_role;
  const roles = new Set((e.tenures ?? []).flatMap((t) => (t && Array.isArray(t.roles) ? t.roles : [])));
  if (!roles.size || roles.has("wrestler")) return "wrestler";
  return PORTRAYAL_ROLE_FROM_TENURES.find((r) => roles.has(r)) ?? "wrestler";
}
const FIGURE_TYPE_LABEL = {
  "real-person": "Real person",
  "fictional-character": "Fictional character",
  "brand-mascot": "Brand mascot",
  "musical-act": "Musical act",
  "real-promotion": "Real promotion", // hook c101 (desk D400)
};
const STOP = new Set([
  "The Museum", "The Orbit", "Hall of Fame", "Card Archive",
  "The Era", "Curation", "Galleries", "About", "Read", "See", "This",
  "Live and Loud", "Christmas Clash", "Blood Bath", "Written", "Source",
  "PPV", "SAS", "WNU", "Quick Facts", "Wayback Machine",
  "In Memoriam", "Search Characters", "Search Titles", "Search Shows",
  "Search Promotions", "Filter By",
]);
const SENTENCE_END_RE = /[.!?]+["'’”)\]]?(?=\s|$)/g;
// LEDGER-SPELLED ENTRIES (hook c118; the Janitor's D429, the repositories go public). A few exclusion entries below must
// spell a word the privacy ledger denies as a person's real name (a real wrestler's ring name; a served page's file name).
// The source does not carry such a word: the entry names the ledger row by its fingerprint (sha1 of the lowercased term,
// first 8 hex, as privacy-lookup.py and the gate's reports cite a row) and the term is read from the ledger here, when the
// build runs, from where scripts/privacy-check.mjs finds it (WORKSHOP_ROOT, else the workshop beside the repo): the main
// ledger, then ledger-pending/*.tsv in name order, the first row with that fingerprint. The entry spells the case itself
// (ledgerCap, or toLowerCase), so the built Set holds exactly the old literal. A checkout without the workshop builds
// without these entries and says so (one warning line each, fingerprints only). A comment citing such a page writes the
// word as "[ledger term <fp>]".
let _ledgerTermsByFp = null;
function ledgerSpelled(fps, make) {
  if (_ledgerTermsByFp === null) {
    _ledgerTermsByFp = new Map();
    const priv = resolve(process.env.WORKSHOP_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "archive"), "privacy");
    const files = [resolve(priv, "redaction-ledger.tsv")];
    try {
      files.push(...readdirSync(resolve(priv, "ledger-pending")).filter((f) => f.endsWith(".tsv")).sort().map((f) => resolve(priv, "ledger-pending", f)));
    } catch { /* no ledger-pending/: the main ledger alone */ }
    for (const f of files) {
      let text;
      try { text = readFileSync(f, "utf8"); } catch { continue; }
      for (const line of text.split("\n")) {
        if (!line.trim() || line.startsWith("#")) continue;
        const term = (line.split("\t")[0] || "").trim();
        if (!term) continue;
        const fp = createHash("sha1").update(term.toLowerCase(), "utf8").digest("hex").slice(0, 8);
        if (!_ledgerTermsByFp.has(fp)) _ledgerTermsByFp.set(fp, term);
      }
    }
  }
  const terms = fps.map((fp) => _ledgerTermsByFp.get(fp));
  if (terms.some((t) => t === undefined)) {
    console.warn(`cross-reference: ledger row ${fps.join("+")} not found (WORKSHOP_ROOT's privacy ledger); its exclusion entry is left out`);
    return [];
  }
  return make(...terms);
}
const ledgerCap = (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
const EXCLUDE_LINKS = new Set([
  // Each entry "page::name". Real-world/cross-fed namedrop collisions caught
  // live in the MWE tier-3 crawl (the workshop's mwe-tier3-2026-08-31.md),
  // verified: the target id has a genuine prose auto-link elsewhere that a
  // sitewide EXCLUDE_NAMES entry would have destroyed.
  // SCWF tier-3 crawl (the workshop's scwf-tier3-2026-08-31.md), verified
  // distinct (Chosen One/Joe Stock) or held-open interim (Mark Harrington,
  // review-queue identity question pending):
  "promotions/scwf/rp/hooligans-and-shenanigans.html::the Chosen One",
  // Coordinator, 2026-09-01 (newa-1992 t3 digest §8): an NFW roleplay's own
  // Karate-Kid-MOVIE reference ("Daniel Son... wax on-wax off") was
  // auto-linking to the newly-minted karate-kid-newa-1992 wrestler — a
  // pop-culture mention, not the NeWA character. Scoped, not global: the
  // NeWA wrestler's own pages keep their links.
  "promotions/nfw/rp/week-8-kin-hiroshi-vs-shawn-hart.html::Karate Kid",
  // Coordinator, 2026-09-02 (iwa-icon completion digest): the wing's own
  // Epitaph names its OWN served Barbed Wire; the auto-linker was ALSO
  // matching an unrelated SEWF character's aka on the same phrase.
  "promotions/iwa-icon/index.html::Barbed Wire",
  // Coordinator, 2026-09-02 (bcw-2008 lane): a LOW rp's real song-credit
  // mention of the real musician Fat Joe was linking to the fictional
  // bcw-2008 wrestler.
  "promotions/low/rp/a-new-day-begins.html::Fat Joe",
  // Coordinator, 2026-09-02 (avenger-deathmatch lane): an NFW rp's own
  // Star Wars trash-talk aside was linking to the new canonical-portrayal
  // mint.
  "promotions/nfw/rp/brawl-sydney.html::Luke Skywalker",
  // Coordinator, 2026-09-01 (pwa-1992 t3 digest §9): five rp docs in TWO
  // other wings reference their OWN unrelated "Dogs of War" teams (NFW's
  // Dread/Payne former team; a WWA team) — all were auto-linking to the
  // pwa-1992 mint. Scoped entries; the PWA team's own pages keep links.
  "promotions/wwa/rp/time-for-reflection-2003-02-20.html::the Dogs of War",
  "promotions/wwa/rp/time-for-reflection-ii-2003-02-28.html::the Dogs of War",
  "promotions/nfw/rp/nfw-desire-mister-dread.html::the Dogs of War",
  "promotions/nfw/rp/repent-now.html::the Dogs of War",
  "promotions/nfw/rp/why-why-i-ll-tell-you-why.html::the Dogs of War",
  // Coordinator, 2026-09-01 (cwf-continental t3 digest): 41 caption-page
  // substring collisions — "Friday Night Blitz"/"Hardcore Championship"/
  // "Red Hook" fragments hitting unrelated night-oww/blitz-nticw/hardcore/
  // red-aicw entities. Scoped per page; verified programmatically by lane.
  "characters/2-cool-leroy-cwf-continental.html::Night",
  "characters/2-cool-leroy-cwf-continental.html::Blitz",
  "characters/apocalypse-cwf-continental.html::Night",
  "characters/apocalypse-cwf-continental.html::Blitz",
  "characters/avirex-cwf-continental.html::Night",
  "characters/avirex-cwf-continental.html::Blitz",
  "characters/dane-gerous-cwf-continental.html::Night",
  "characters/dane-gerous-cwf-continental.html::Blitz",
  "characters/destructor-cwf-continental.html::Night",
  "characters/destructor-cwf-continental.html::Blitz",
  "characters/dr-doom-cwf-continental.html::Night",
  "characters/dr-doom-cwf-continental.html::Blitz",
  "characters/exodus-cwf-continental.html::Night",
  "characters/exodus-cwf-continental.html::Blitz",
  "characters/exodus-cwf-continental.html::Hardcore",
  "characters/kula-cwf-continental.html::Night",
  "characters/kula-cwf-continental.html::Blitz",
  "characters/kyrupt-cwf-continental.html::Night",
  "characters/kyrupt-cwf-continental.html::Blitz",
  "characters/mike-maddness-cwf-continental.html::Night",
  "characters/mike-maddness-cwf-continental.html::Blitz",
  "characters/mike-maddness-cwf-continental.html::Hardcore",
  "characters/nick-mccleud-cwf-continental.html::Night",
  "characters/nick-mccleud-cwf-continental.html::Blitz",
  "characters/phantom-cwf-continental.html::Night",
  "characters/phantom-cwf-continental.html::Blitz",
  "characters/phoenix-cwf-continental.html::Night",
  "characters/phoenix-cwf-continental.html::Blitz",
  "characters/seven-cwf-continental.html::Night",
  "characters/seven-cwf-continental.html::Blitz",
  "characters/the-living-highlight-cwf-continental.html::Night",
  "characters/the-living-highlight-cwf-continental.html::Blitz",
  "characters/the-punisher-cwf-continental.html::Night",
  "characters/the-punisher-cwf-continental.html::Blitz",
  "characters/x-tinct-cwf-continental.html::Night",
  "characters/x-tinct-cwf-continental.html::Blitz",
  "characters/xtreme-t-cwf-continental.html::Red",
  "characters/xtreme-t-cwf-continental.html::Night",
  "characters/xtreme-t-cwf-continental.html::Blitz",
  "characters/zero-cwf-continental.html::Night",
  "characters/zero-cwf-continental.html::Blitz",
  "promotions/scwf/index.html::Joe Stock",
  "promotions/scwf/index.html::Mark Harrington",
  // RWA tier-3 crawl (the workshop's rwa-rugged-tier3-2026-08-31.md): 4WW's own
  // in-fiction "Body Count" stable is not body-count-rwa-rugged — per-page, verified:
  "promotions/4ww/rp/shadow-file-9-loyalty.html::Body Count",
  "promotions/4ww/rp/shadow-file-10-fate.html::Body Count",
  "promotions/4ww/rp/shadow-file-11-omen.html::Body Count",
  "promotions/4ww/rp/walk-in-the-park.html::Body Count",
  // ICBINR tier-3 crawl (the workshop's icbinr-tier3-2026-08-31.md): generic mints
  // claimed unrelated same-name mentions on other wings — verified, per-page:
  "promotions/4ww/rp/artemis-and-fey-related.html::Mr. Black",
  "promotions/4ww/rp/friends-come-to-stay.html::Mr. Black",
  "promotions/low/rp/agitated-volatility-femme-fatale.html::Mr. Black",
  ...ledgerSpelled(["3b04227a"], (t) => [`promotions/low/rp/classic-deimos-pulp-${t.toLowerCase()}.html::Mr. Black`]), // hook c118: the page's name word, from the ledger
  "promotions/nfw/rp/brawl-sydney.html::Mr. Black",
  "promotions/nfw/rp/brawlhalla-asgard.html::Mr. Black",
  "promotions/nfw/rp/reloaded-13-jones-beach-ny.html::Mr. Black",
  "promotions/fortune-fwrestling/index.html::Pressure Point",
  "promotions/mwe/rp/unknown-soldier.html::The Machine",
  "promotions/mwe/rp/silence-of-the-laughs.html::The Machine",
  "promotions/mwe/rp/the-departed.html::The Machine",
  // steve-cowan-mwe (MWE's own aka for Steve Cowan) — but "The Machine" is
  // ALSO the-machine-faw's and the-machine-xcwf's own registered name, both
  // with live genuine prose auto-links (e.g. apocolypse-xcwf's own caption,
  // "meeting The Machine more often than anyone else"), which rules out
  // EXCLUDE_NAMES. All 3 MWE anchors were false: 2 named a different,
  // unregistered GWC faction ("Danny Vice... forming a new faction, calling
  // themselves 'The Machine'") and 1 named the real band, Rage Against the
  // Machine ("'Bulls on Parade' by Rage Against The Machine").
  "promotions/mwe/rp/fear-redefined.html::Grim Reaper",
  "promotions/mwe/rp/breaking-the-mould.html::Grim Reaper",
  "promotions/low/rp/confidence-personified.html::Grim Reaper",
  "promotions/4ww/rp/shadow-file-8-letter.html::Grim Reaper",
  "promotions/4ww/rp/shadow-file-11-omen.html::Grim Reaper",
  // grim-reaper (IWF/GIWF, 1998-2001) — but "Grim Reaper" is ALSO
  // the-grim-reaper-cswa's own registered aka, with a live genuine prose
  // auto-link (doctor-slice-cswa's own caption, "Grim Reaper was his
  // first-round draw..."), which rules out EXCLUDE_NAMES. All 5 MWE/LOW/4WW
  // anchors were the ordinary personification-of-death idiom, not either
  // wrestler.
  "promotions/mwe/rp/home.html::El Dorado",
  "promotions/uwf/rp/promo-482.html::El Dorado",
  // el-dorado (an unelaborated IWF roster name) — but "El Dorado" is ALSO
  // el-dorado-rspwf's own registered name, so kept per-page rather than
  // EXCLUDE_NAMES on principle even though no live genuine link to
  // el-dorado-rspwf was found in this pass. Both anchors named the Cadillac
  // model ("Cadillac El Dorado").
  "promotions/mwe/rp/the-laundry-list-of-mwe-s-true-hardcore-legend.html::Ric Flair",
  "promotions/mwe/rp/eric.html::Ric Flair",
  "promotions/mwe/rp/the-experience-and-ring-presents.html::Ric Flair",
  // ric-flair-uwf-uwow: all 3 above are real-Flair compliments/mannerisms in
  // MWE prose ("the Ric Flair of the Havoc division", a Flair-accent bit, "the
  // next Ric Flair"); the genuine link stands on promotions/uwf-uwow/index.html
  // ("Matthew Hopkins stripped... Ric Flair") and promotions/dreamcard/index.html.
  "promotions/mwe/rp/this-is-your-life.html::Hillary Clinton",
  // hillary-clinton-faw: FAW's own real-figure portrayal (a recurring on-screen
  // commentator, unmasked as the "Mystery Woman" — CURATION.md v96). The MWE
  // anchor is a pantsuit joke about the real First Lady, unrelated to FAW.
  "promotions/mwe/rp/the-next-tag-team-champions.html::Triple Threat",
  "promotions/mwe/rp/recuperating-after-ww-ii.html::Triple Threat",
  "promotions/mwe/rp/exclusive-interview.html::Triple Threat",
  "promotions/mwe/rp/streets-of-pittsburg.html::Triple Threat",
  "promotions/mwe/rp/viewer-discretion-is-advised.html::Triple Threat",
  "promotions/mwe/rp/death-of-the-babyface.html::Triple Threat",
  "promotions/mwe/rp/finally-world-champion.html::Triple Threat",
  "promotions/mwe/rp/don-t-bite-more-than-you-can-chew.html::Triple Threat",
  "promotions/mwe/rp/what-happened-to-me.html::Triple Threat",
  // triple-threat-wwa: WWA's own 1997 stable (Brian Cairo, Drake Blackthorne,
  // Mark Lynch). NOT a candidate for EXCLUDE_NAMES — the Unified Knights of
  // America's own caption genuinely reads "Triple Threat's own Mark Lynch,
  // Drake Blackthorne and Brian Cairo" (units/a-z/u.html and
  // characters/unified-knights-of-america-wwa.html), a real sourced connection
  // that a sitewide bar would have silently broken. Every MWE anchor above is
  // the generic "Triple Threat match" stipulation, or (on
  // the-next-tag-team-champions.html/recuperating-after-ww-ii.html/
  // exclusive-interview.html) MWE's own unregistered in-story tag team of the
  // same name (The Wraith and The RingMaster) — a different false referent,
  // same false link.
  "promotions/mwe/rp/i-got-a-big-ego.html::Curt Hennig",
  "promotions/mwe/rp/my-15-minutes-are-up-but-i-got-more-to-say.html::Curt Hennig",
  // curt-hennig-uwf-uwow: both are real-Hennig compliments ("From Curt Hennig
  // to Joseph Rios in WZCW", "with all due respect to Curt Hennig"). The
  // genuine link stands on promotions/dreamcard/index.html's own fantasy-card
  // prose ("Lex Luger against Curt Hennig").
  "promotions/mwe/rp/payback-is-a-b-tch.html::Owen Hart",
  // owen-hart-uwf-uwow: dialogue referencing the real Owen Hart's fatal 1999
  // fall ("land on your head, like Owen Hart did a decade ago").
  "promotions/mwe/rp/blown-like-a-dandelion.html::Lindsey",
  // lindsey-mwe: "if they where Britney and Lindsey" is the real-world
  // Britney Spears/Lindsay Lohan tabloid pairing, not this character — a live
  // false positive confirmed against dozens of genuine lindsey-mwe anchors
  // elsewhere in the same corpus (a second, contextually genuine "Lindsay"
  // spelling resolves correctly to the same id, per the tier-3 digest).
  "promotions/mwe/rp/a-daydream-you-can-believe-in.html::Joe the Plumber",
  // joe-the-plumber: a real, well-populated NFW character (three
  // championship reigns, 35 appearances) — not a nonexistent id, contrary to
  // the tier-3 digest's own guess; this is the same real-world-namedrop
  // collision pattern as every entry above (the 2008 US political meme "Joe
  // the Plumber"), not a linker bug or stale data. MWE's own line jokes about
  // "Joey the Plumber" as a nickname for Joey Dallas, and the "rim shot...
  // that has heard of Joe the Plumber" line means the meme, not NFW's
  // wrestler.
  "promotions/mwe/rp/brian-michaels-on-jimmy-kimmel-live.html::Generation X",
  // euwc-generation-x: the registered name is "Generation X" (the anchor's
  // "D-" prefix is plain text, not part of the match) — Kimmel namedropping
  // the real WWE stable ("WWE's D-Generation X"). Not excluded sitewide —
  // EUWC's own "Generation X" name
  // is used, plausibly genuinely, in at least one NFW crossover joke
  // elsewhere (promotions/nfw/rp/montezuma-strife-vs-hart-stevens.html,
  // "Generation X's rendition of Steve Guttenburg").
  "promotions/mwe/rp/history-according-to-zack.html::The Shooting Star",
  // kenny-mercury: "The Shooting Star" is Kenny Mercury's own registered UWF
  // aka (genuinely self-referential on promotions/uwf/rp/promo-828.html,
  // "'The Shooting Star' Kenny Mercury"). The MWE anchor names a different,
  // in-story "Shooting Star Wrestling Academy" — a coincidental name
  // collision, not the same referent.
  // ---- PWE-BOARD GUARD BATCH (coordinator, 2026-09-02) ----
  // Receipts: the workshop's tpg-tier3-2026-09-02.md §7b,
  // the workshop's fob-tier3-2026-09-02.md §7b,
  // the workshop's guard-batch-2026-09-02.md. Every pair below was
  // re-verified against a full regen on this branch: the anchor is live, it
  // is false, and the target keeps a genuine auto-link elsewhere that a
  // sitewide bar would have destroyed.
  "promotions/mwe/rp/the-departed.html::Phil Brooks",
  "promotions/mwe/rp/dinner-and-a-promo.html::Phil Brooks",
  "promotions/mwe/rp/raging-devil-equals-imminent-death.html::Phil Brooks",
  "promotions/mwe/rp/afflicted.html::Phil Brooks",
  // phil-brooks-tpg: TPG's own December 2005 wrestler, billed by that name on
  // the fed's own booking sheet. All four MWE anchors are the same commentator
  // speaker tag ("Phil Brooks: ...") in MWE's own roleplays — the real
  // performer's legal name used as a broadcast-desk namedrop, not TPG's
  // wrestler. Scoped, not sitewide: the TPG identity question is live and
  // unresolved (tpg digest §10.2), so the id keeps its own wing's links.
  "characters/jbl-uwf-uwow.html::John Bradshaw Layfield",
  "characters/mvp-uwf-uwow.html::Montel Vontavious Porter",
  // Two of another wing's OWN per-promotion portrayal rows of the same real
  // performers: UWF's jbl-uwf-uwow and mvp-uwf-uwow each name the performer in
  // full inside their own caption, and the caption linker was sending that
  // name to TPG's portrayal row instead. v96 keeps per-promotion portrayals
  // distinct, so neither link is wanted. Caption-scoped entries — the
  // "characters/<ownId>.html::name" form also suppresses the same caption's
  // mirror on the A-Z register pages (see linkCaptionHtml).
  // montel-vontavious-porter-tpg keeps its genuine link on
  // promotions/tpg/index.html ("...defending it in May 2007").
  "promotions/mwe/rp/glory-road.html::Jonathan Coachman",
  // jonathan-coachman-fob: FoB's own broadcaster portrayal. The MWE anchor is
  // an in-story television set showing the real broadcaster talking about a
  // Yankees game — a real-world namedrop, not FoB's staged announcer.
  "promotions/nfw/rp/reloaded-16-new-jersey-full-updated-lineup.html::Future Perfect",
  // future-perfect-fob: FoB's own 2005 stable. The NFW anchor is a 2014
  // roleplay's own trash-talk about an opponent "that has deemed himself
  // 'Future Perfect'" — a different, unregistered NFW epithet. The FoB stable
  // keeps its genuine links on its own wing's served shows and captions.
  "characters/jenny-calloway-wwa.html::Kraven",
  // kraven-fob: PRE-EXISTING collision surfaced by the fob lane's adversarial
  // sweep, not created by it. WWA's own caption ("Vik Ventressa's reach from
  // the rafters to help Kraven reclaim it") means WWA's own unregistered
  // Kraven. FoB's keeps its genuine links on promotions/fob/index.html and
  // characters/jamie-noble-fob.html.
  "characters/ryan-lee-wwa.html::Todd",
  "characters/latex-lex.html::Todd",
  "characters/moongirl-wwo.html::Todd",
  "characters/carnage-a-trois-wwo.html::Todd",
  "characters/turner-brown.html::Todd",
  // todd-fob: FoB's own wrestler, billed by that bare first name and never
  // expanded. The fob digest §7a asked for sitewide EXCLUDE_NAMES; the regen
  // on this branch shows why it cannot be — "Todd" carries ONE genuine
  // auto-link, in FoB's own storyline prose on promotions/fob/index.html
  // ("Jericho and Todd were covered in a red substance"), which a sitewide bar
  // would have silently destroyed. Scoped instead, exactly per this block's
  // own doctrine. All five anchors are other entities' captions splitting a
  // longer first-name-plus-surname string: Todd "The Irish Hammer" Logan
  // (ryan-lee-wwa), Todd "The Rod" Johnstone (latex-lex), Todd Johnstone's
  // stable (moongirl-wwo, carnage-a-trois-wwo) and Todd "Ratboy" Prentiss
  // (turner-brown). The caption form covers the A-Z register mirrors too.
  // Coordinator, 2026-09-02 (guard-batch-2026-09-02.md item A finding 1e):
  // the wanted-list heuristic below flagged "New Age" on three pages purely
  // because NAWF's own fed name/tagline contains the phrase — there is no
  // auto-link to suppress on any of the three (nawf/index.html's own name is
  // "North American Wrestling Federation", never auto-linked as prose; the
  // /collections/ pages just narrate NAWF's own name). Scoped here so the
  // wanted loop's newly-added excludedOnPage() check clears the three false
  // hits while leaving the genuine one — FAW's own "Power Of Two: New Age"
  // tag-team component on /titles/faw-tag-team.html — untouched.
  "promotions/nawf/index.html::New Age",
  "collections/0140.html::New Age",
  "collections/index.html::New Age",
  // Coordinator batch, 2026-09-02 (ufws accession digest §14, applied by the
  // uewf t3 lane): the UFWS's own joke belt — "something the federation called
  // the Chastity Belt" — was splitting on its first word and auto-linking to
  // chastity-low, an unrelated LOW wrestler. Scoped rather than sitewide
  // because that LOW row has genuine prose links of its own; the caption form
  // covers the A-Z register mirror too.
  "characters/captain-condom-ufws.html::Chastity",
  // Coordinator, 2026-09-08 (the Janitor ruling on accession 0150): "Rock Solid
  // Enterprises" is the company that ran OSW Online; the RSPWF Top-200 persona
  // rock-solid-rspwf (1999, tagged UIW) is unrelated, and a string match is
  // not a join. Scoped to the three pages that name the company.
  "collections/index.html::Rock Solid",
  "collections/0150.html::Rock Solid",
  "promotions/osw-online/index.html::Rock Solid",
  // 2026-09-24 (MEMORIAL-PLACARDS): memorial pages must not link a memorial subject's own words to a stranger
  "memorials/mike-sanzone.html::Adrenaline",   // his EPW's show, not NFW's guest referee
  "memorials/andrew-doran.html::Andy",          // his own name in his crumb, not andy-ewa-extreme
  // c82 (lane XREF-FOLLOWUPS, 2026-10-05): "CCW and Lone Star Wrestling" on Paul Scanlan's memorial row names a
  // federation, not lone-star-faw (an FAW character); a two-word match the static-page rule below lets through.
  "in-memoriam.html::Lone Star",
  // LINK-FIX-1 + care read (hook c149, 2026-10-08): six roleplay anchors the page's own words rule out. Three fWo misnamings:
  // a sarcastic "Roland Washington" (Michelle to Killjoy, he is not in the scene) and Eli Flair's epithet "The Original Nobody"
  // twice ("The Original" is only an aka of jeff-garvin). Three auto-links that put a memorial subject's character on other
  // words: "Logic" in the pun "Lowell Logic" (david-walter-smith's aka), "Total Eclipse" a song on an album track list
  // (total-eclipse-fwo-1998), "Inferno" Boogie Smallz's Disco Express partner (disco-inferno-cswa, not jay-phoenix's aka).
  // An entry here also UNWRAPS a baked anchor.
  "promotions/fwo-fans-1998/rp/the-price-of-freedom-starring-killjoy-2009-06-24.html::Roland Washington",
  "promotions/fwo-fans-1998/rp/the-press-conference-2003-03-19.html::The Original",
  "promotions/fwo-fans-1998/rp/someone-had-to-go-this-far-2003-07-04.html::The Original",
  "promotions/fwo-fans-1998/rp/absolutely-hopeless-2009-01-08.html::Logic",
  "promotions/fwo-fans-1998/rp/the-dark-side-of-the-moon-part-6-2002-02-21.html::Total Eclipse",
  "promotions/cswa/rp/cswa-versus-02-team-viagra-vs-urban-legends-2013-01-21.html::Inferno",
  // (hook c231, lane D270-HONOURS-REBASE, 2026-10-09; entry drafted 2026-10-03 by lane D270-WAVE) ryan-moore-pcw is PCW's own
  // wrestler. The UWF anchor is a one-off in-story Chicago police officer in Seymour Almasy's roleplay "Via Chrono Purifico:
  // Time Purifies (II)" ("Police Chief: I'm Officer Ryan Moore, Chicago police department."), not PCW's wrestler
  // (CARE-LEAD-JOY-PLAYER F19). Scoped, not sitewide: the PCW record keeps its genuine links.
  "promotions/uwf/rp/promo-818.html::Ryan Moore",
]);
const EXCLUDE_ALIASES = new Set([
  "Asianic Spike", // WWA fleet-lane handoff (2026-08-19/20): a wrestling MOVE
               // name (Steele "banned" it, per the fed's own commentary,
               // 1999-04-30) that contains spike-wwa's own bare name "Spike"
               // as its last word — bare "Spike" has real true-positive
               // mentions elsewhere (the-victor.html's caption, etc.), so a
               // blanket EXCLUDE_NAMES entry would cost more than it saves.
  "Desert Spike", // caught live during this same wave's verification pass:
               // Shaman's (shaman-wwa) own finisher, "the standing suplex
               // Desert Spike" (shaman-wwa.html's own caption) — a SECOND,
               // independent move name ending in "Spike," confirming this
               // is a recurring wrestling-move-suffix collision, not a
               // one-off.
  "Twist of Fate", // WWA fleet-lane handoff (2026-08-19/20): the WWE finisher
               // (Matt Hardy's, borrowed/parodied by multiple WWA wrestlers)
               // that contains fate-wwa's own bare name "Fate." Bare "Fate"
               // is already in EXCLUDE_NAMES above (a 100% false-positive
               // rate against ordinary prose, no true-positive loss), which
               // already fully covers this case — listed here too so the
               // trap stays documented in the same place EXCLUDE_ALIASES
               // catalogs its siblings, in case "Fate" is ever narrowed
               // to a finer-grained exclusion later.
  "Fuel My Fire", // WWA fleet-lane handoff: another variant of the
               // already-known "Fuel" ↔ entrance-music collision (the
               // Prodigy song, distinct from the "Fuel's 'Won't Back Down'"
               // instance EXCLUDE_NAMES's own "Fuel" entry cites). Bare
               // "Fuel" is already in EXCLUDE_NAMES above and fully covers
               // this; listed here for the same documentation reason as
               // "Twist of Fate."
  "Black Inferno", // PTC New Era RP handoff (2026-08-23): Kai Shinobi's own
               // sword attack, shouted twice on the New Era board
               // (promotions/ptc/rp/the-reincarnation-of-who-extreme-
               // clusterfuck-rp-3.html, promotions/ptc/rp/tuguro-strikes-
               // extreme-clusterfuck-rp-2.html) — the word "Inferno" inside
               // it is jay-phoenix's own registered aka. Exactly the "Twist
               // of Fate"/"Desert Spike" shape: bare "Inferno" has real
               // true positives elsewhere (an "Inferno Match" stipulation,
               // other served RPs), so a blanket EXCLUDE_NAMES entry would
               // cost more than it saves.
  "Fanfare For The Common Man", // NFW boards lane audit (2026-08-23): Aaron
               // Copland's fanfare, cued as entrance music inside an NFW
               // roleplay — contains "The Common Man," an aka of ezra-kazee.
               // Bare "The Common Man" has 8 real true-positive links
               // elsewhere in the museum, so a blanket EXCLUDE_NAMES entry
               // would cost more than it saves; exactly the case this
               // mechanism exists for.

  // QA-FIXES lane, 2026-08-29 (qa-visitor-walk-2026-08-29.md B8) — the same
  // substring class, three more instances, confirmed live: a memorial name
  // and a glossary term were each getting torn apart by two SEPARATE
  // registered bare names they happen to contain, one from each half of a
  // two-token phrase, rather than one longer phrase swallowing a single
  // shorter name (the shape every entry above is). EXCLUDE_ALIASES still
  // covers it the same way: the whole phrase suppresses every match that
  // falls inside it, regardless of how many separate names that phrase
  // happens to contain.
  "Sean Simon Williams", // about.html's own memorial line, "Sean Simon
               // Williams (1985–2018)" — "Simon" (simons-wwa) and "Williams"
               // (williams-maximum-overdrive-wwa) each independently
               // resolved and split the Janitor's own dedication name in
               // two, wrongly, mid-sentence.
  "Chris Williams Memorial Cup", // in-memoriam.html's own caption for the
               // real Chris Williams memorial — "Chris" (the unrelated
               // christopher-chaos-pwf) and "Williams" (the same
               // williams-maximum-overdrive-wwa as above) each resolved
               // independently inside the honor's own name.
  "Title / Reign", // structure.html's own glossary entry defining the
               // generic term "Reign" — the bare word is also
               // reign-oww's own registered name (an OWW wrestler), and
               // linking the glossary's OWN definition of the word to an
               // unrelated character undermines the definition it's part
               // of.
]);
// SOURCE_MARKER_RE now imported from ./text-markers.mjs (THE SHARED MARKER
// MODULE, PROSE-FIX-01, 2026-09-13; proposal.md #0) — see the import at the
// top of this file.
const GRADE_LABEL = { "primary-source": "primary source", "user-attested": "user-attested", presumed: "presumed" };
// hoisted 2026-09-06 (coordinator): used by reign labelling during top-level index building, before its original position (gate-61 UNIT_KIND_LABEL lesson)
const REIGN_END_LABEL = {
  "lost": "lost",
  "lost-in-match": "lost",
  "vacated": "vacated",
  "stripped": "stripped",
  "forfeited": "forfeited",
  "departed": "departed",
  "awarded-on": "awarded on",
  "retired": "title retired",
  "still-champion-at-record-end": "champion when the record ends",
  // "unknown" is deliberately absent: an unknown end renders nothing at all,
  // the same silence the placard keeps for an unset staged gender.
};
const REIGN_END_TOKEN_RE = /\b(?:still-champion-at-record-end|lost-in-match|awarded-on|vacated|stripped|forfeited|departed)\b/g;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = resolve(ROOT, "data");

// ===========================================================================
// c57 XREF-INCREMENTAL (the Janitor's D297, item 3) — THE RE-CHECK-ONLY-WHAT-
// CHANGED MODE.  refresh:links was 2,670 s of gate 254's 2,712 s, and ~98% of
// that is two full-corpus prose passes (the entity-link walk and the wanted-
// list walk) redone from scratch over ~34,000 pages whose bytes, and whose
// answer, had not moved since the last gate.
//
// THE RULE THIS MODE OBEYS: a page's pass is skipped only where the skip is
// PROVABLE, never where it is merely likely.  Both passes are pure functions
// of (the page's own bytes, its path, the name/alias universe, the page's own
// figure/memorial allowlist) — everything else they touch is page-local or a
// counter.  So a page may be reused when ALL of these hold:
//   1. its bytes hash exactly as they did when the entry was written;
//   2. none of the names whose registry entry MOVED since then occurs
//      anywhere in those bytes (a literal includes() per moved name);
//   3. every data-entity id on the page still resolves the same way
//      (in byId, or through the same alias target);
//   4. its own allowlist signature is unchanged (figures/, memorials/).
// An entry is RECORDED only for a page the entity-link pass left BYTE-
// UNCHANGED, so reusing one never skips a write; and because a page the pass
// changes is always written, every reused page contributed 0 to
// pageLinkCount/totalLinks/linkedPages on a full run too — the printed
// counters come out identical, not merely close.
//
// FULL REBUILD (no partial, ever) whenever: --full / XREF_MODE=full is given;
// the manifest is missing, unreadable, of another schema or another museum
// root; this script, stamp-chrome.mjs, text-markers.mjs or templates/
// chrome.html changed; or the moved-name set is larger than XREF_DELTA_CAP
// (a big registry wave is cheaper to rebuild than to test name by name).
// A full run still REFRESHES the manifest, so the next run is incremental.
//
// The manifest lives OUTSIDE the museum tree (the workshop's ops-scratch by
// default) on purpose: the gate stamps a digest of every tracked and
// untracked-unignored file in the repo, and a build cache is neither museum
// content nor something a clone should have to carry.  No manifest = a full
// run, which is exactly what a fresh clone wants.
// ===========================================================================
const XREF_SCHEMA = 1;
const XREF_DELTA_CAP = Number(process.env.XREF_DELTA_CAP || 2000);
const _argv = process.argv.slice(2);
const XREF_WANT_FULL = _argv.includes("--full") || process.env.XREF_MODE === "full";
const XREF_NO_MANIFEST = _argv.includes("--no-manifest") || process.env.XREF_MODE === "pristine";
const XREF_MANIFEST_PATH = process.env.XREF_MANIFEST
  ? resolve(process.env.XREF_MANIFEST)
  : resolve(
      process.env.SCRATCH_ROOT
        ? resolve(process.env.SCRATCH_ROOT)
        : process.env.WORKSHOP_ROOT
          ? resolve(process.env.WORKSHOP_ROOT, "ops-scratch")
          : resolve(ROOT, "..", "archive", "ops-scratch"),
      "xref-manifest.json",
    );
function xsha1(s) { return createHash("sha1").update(s).digest("hex"); }
function xfilehash(abs) { try { return xsha1(readFileSync(abs)); } catch { return "?"; } }
let xPrev = null;            // the manifest from the previous run, if usable
let xFullReason = "";        // why this run is full, if it is
if (XREF_NO_MANIFEST) {
  xFullReason = "--no-manifest";
} else {
  try {
    const m = JSON.parse(readFileSync(XREF_MANIFEST_PATH, "utf8"));
    if (!m || m.schema !== XREF_SCHEMA) xFullReason = "manifest schema is not this build's";
    else if (m.root !== ROOT) xFullReason = "manifest belongs to another museum root";
    else if (!m.pages || !m.wanted || !m.names) xFullReason = "manifest is missing a section";
    else xPrev = m;
  } catch (e) { xFullReason = `no usable manifest (${e.code || e.message})`; }
}
if (!xFullReason && XREF_WANT_FULL) xFullReason = "--full";
// Written back at the end of the run, whichever mode this is.
const xPages = Object.create(null);
const xWanted = Object.create(null);
let xReusedPages = 0, xWalkedPages = 0, xReusedWanted = 0, xWalkedWanted = 0;

// THE CHROME-COLLAPSE WAVE (2026-08-19): every full-page generator below
// used to carry its OWN hardcoded copy of the masthead/nav/footer wrapper —
// seven near-identical literals, one per generator, that could (and did)
// drift from templates/chrome.html's own copy with nothing to catch it
// except a human diffing seven functions by eye. That drift is exactly why
// a plain `npm run refresh:links` used to strip the `<!-- chrome:head/
// footer:start/end -->` markers from every generated page: this file's own
// template never emitted them, so a full regen silently produced pages
// `stamp-chrome.mjs` could no longer find its own splice points in without
// a LATER `npm run chrome` pass gluing them back on (masked in practice
// because that pass is always run right after, per the documented
// workflow — see the clobbering-bug-fix comment lower in this file for the
// exact same failure shape hitting characters.html once already).
//
// `pageShell` is the fix: every generator below builds a MINIMAL raw shell
// (just enough structure — a `<!doctype html>`, a `<title>`, a `<footer>`
// — for `stampHtml` to find its splice points) and hands it to the SAME
// stamping function `npm run chrome` itself uses, so the real chrome
// (markers included) is spliced in from templates/chrome.html at
// generation time. One chrome system, no exempt class of page: a generated
// page is now stamp-compatible by construction, not by a second pass
// hoping to catch up to it.
function pageShell({ title, main, footerLine, rel = "" }) {
  const raw = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${SITE_PUBLIC ? "" : '<meta name="robots" content="noindex,nofollow">\n'}<title>${title}</title>
<link rel="stylesheet" href="/style.css?v=12">
</head>
<body>
<header class="masthead"></header>

<main class="wrap">
  ${main}

  <footer>
${footerLine}
  </footer>
</main>
</body>
</html>
`;
  const { output, skipped } = stampHtml(raw, rel);
  if (skipped) throw new Error(`pageShell: stampHtml could not find chrome splice points for ${rel || "(no rel)"}`);
  // THE TRAILING-WHITESPACE TRIM (2026-08-30): an optional-content
  // interpolation left empty (aka/captionLine/placardHtml/boozlerNote/
  // memorialLine/notesLine and their siblings on other page types) still
  // leaves its own template line's leading indentation behind — a
  // whitespace-only line, invisible in the browser but flagged by git's
  // own `diff --check` (the pre-commit hook's conflict-marker/whitespace
  // scan). Trimmed at this one choke point every generated page already
  // passes through, rather than chasing each interpolation site
  // individually — content-neutral, since HTML collapses the difference.
  return output.split("\n").map((line) => line.replace(/[ \t]+$/, "")).join("\n");
}

// SCHEMA-HARDENING WAVE: every data/*.json file is now { _schema_version,
// <key>: [...] } (frontier.json keeps extra header fields alongside `rows`).
// loadJSON returns the raw parsed file; loadArray unwraps it into the plain
// array callers actually want — the Node-side twin of js/list.js's
// MuseumList.fetchJSON, which does the same unwrap client-side.
function loadJSON(name) { return JSON.parse(readFileSync(resolve(DATA, `${name}.json`), "utf8")); }
function loadArray(name) {
  const raw = loadJSON(name);
  if (Array.isArray(raw)) return raw;
  const key = Object.keys(raw).find((k) => k[0] !== "_" && Array.isArray(raw[k]));
  return key ? raw[key] : [];
}
const characters = loadArray("characters");
const units = loadArray("units");
// THE IDENTITY WAVE (2026-08-22): data/aliases.json — retired-id -> canonical-id
// redirects from a merge. Consulted below so a stale entity-link anchor baked
// by an earlier run (data-entity="<now-retired-id>") migrates forward to its
// merge survivor on the next regen, the same "migrate, don't strand" treatment
// the PER-WRESTLER PAGES WAVE already gives a pre-rename /wrestlers.html#id
// href. Without this, a retired id's own href/data-entity is left exactly as
// a prior run baked it — not a content edit (the anchor's own wrapping is
// presentation, same as any other chrome/crumb repair) but a broken link, the
// exact bug an al-crud-shaped merge would otherwise reintroduce every time.
const aliasMap = existsSync(resolve(DATA, "aliases.json"))
  ? new Map(loadArray("aliases").map((a) => [a.from, a.to]))
  : new Map();
function resolveAlias(id) {
  let cur = id, seen = new Set();
  while (aliasMap.has(cur) && !seen.has(cur)) { seen.add(cur); cur = aliasMap.get(cur); }
  return cur;
}
const externalFigures = existsSync(resolve(DATA, "external-figures.json")) ? loadArray("external-figures") : [];
const externalById = new Map(externalFigures.map((f) => [f.id, f]));
// STYLE FAMILIES (finding-aid layer, docs/SCHEMA.md) — a NAVIGATION-ONLY
// grouping over verbatim tenure `style` strings, never a rewrite of them.
// Reverse index: verbatim style string -> [family names it's mapped into]
// (a composite string like "Mat Technician/High Flyer" can map to more than
// one family on purpose). Used only to widen characters.html's own
// `data-style` filter attribute (below) so picking a family from the
// typeahead still works as a plain substring match — the verbatim strings
// themselves are untouched everywhere else.
const styleFamiliesRaw = existsSync(resolve(DATA, "style-families.json")) ? loadJSON("style-families") : { families: {} };
const styleFamilyByVariant = new Map();
for (const [fam, variants] of Object.entries(styleFamiliesRaw.families ?? {})) {
  for (const v of variants) {
    const list = styleFamilyByVariant.get(v) ?? [];
    list.push(fam);
    styleFamilyByVariant.set(v, list);
  }
}
// THE STRUCTURED REIGNS WAVE: a per-entity reign COUNT only (never a list —
// reign-by-reign detail stays on the promotions/*/titles.html ledgers, one source
// of truth, per the registry wave's own limitation-by-design). Unminted
// holders ({ name, unminted: true }) have no id and are correctly not
// counted here.
const reigns = existsSync(resolve(DATA, "reigns.json")) ? loadArray("reigns") : [];
const reignCountById = new Map();
for (const r of reigns) {
  for (const h of r.holder ?? []) {
    if (!h.id || h.id.startsWith("name-")) continue;
    reignCountById.set(h.id, (reignCountById.get(h.id) ?? 0) + 1);
  }
}
// PER-WRESTLER PAGES WAVE: titles/shows (for reign show-links) and the full
// rps.json (rps.length was already implied by the reign-count wave, but this
// is the first time the actual rows are needed) — used to build each
// entity's generated /characters/<id>.html page below.
// Moved up from its original spot further down this file (THE CAPTION
// GRAPH-LINKING WAVE needs `promotions` to build its own promo-acronym
// index well before that original line) — `promoById`/`promoName` still
// used in exactly the places they always were.
const promotions = loadArray("promotions");
const promoById = new Map(promotions.map((p) => [p.id, p]));
const promoName = new Map(promotions.map((p) => [p.id, p.name]));
const titles = loadArray("titles");
const titleById = new Map(titles.map((t) => [t.id, t]));
const shows = loadArray("shows");
const showById = new Map(shows.map((s) => [s.id, s]));
// THE TEAM REIGNS (hook c96, 2026-10-06; the Janitor's catch: Seymour Almasy's
// memorial block read 24 title reigns where his caption reads 27). A reign held
// by a UNIT also counts for each member who was IN the unit at the reign's
// start, kept apart in reignTeamCountById so a line can say how many came as
// part of a team. Who was in the unit is read from the unit's own record:
//   - a member carrying eras[] (a year "1998", a month "1998-04", or a
//     promotion id "giwf") or first_seen/last_seen is credited when the
//     reign's won date falls inside them (year/month by prefix, a promotion
//     era by the title's promotion); a won date missing, "circa", "unknown"
//     or too coarse to decide credits that member nothing;
//   - in a unit where any member is dated, an undated member is not credited
//     (that roster changed, and nothing says when);
//   - a unit with no dated member credits its listed members only when it is
//     a fixed-membership team by its own record: unit_kind "tag-team" (or
//     "duo") with at most two members listed, or exactly two members listed
//     with no member note (never a "trio": two listed is not its whole
//     roster), or unit_kind "trio" with exactly three members listed (the
//     Janitor, desk D404: "credit trios with all three listed"), crediting
//     each of its registered members as the two-listed branch does.
//     Anything else (a stable, a trio listing fewer or more than three, a
//     tag team listing three or more, membership_unknown) credits no one;
//     the build's log line counts those reigns.
// A member already named in the reign's own holder[] is never counted twice,
// a member is credited once per reign however many of its units hold it, and
// only registered characters are credited (ids through the alias map). The
// unit's own count is unchanged.
const reignTeamCountById = new Map();
const reignTeamKindsById = new Map(); // character id -> Set of the crediting units' unit_kind
const reignTeamStats = { credits: 0, unitReigns: 0, creditedNoOne: 0 };
{
  const unitRowById = new Map(units.map((u) => [u.id, u]));
  const characterIds = new Set(characters.map((c) => c.id));
  const canon = (id) => (typeof id === "string" && id ? resolveAlias(id) : null);
  const ISO = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;
  const wonOf = (r) => {
    const w = r.won;
    if (!w || typeof w.date !== "string" || w.precision === "circa" || w.precision === "unknown") return null;
    return ISO.test(w.date) ? w.date : null;
  };
  const isDated = (m) => (Array.isArray(m.eras) && m.eras.length > 0) || m.first_seen != null || m.last_seen != null;
  // -1 / 0 / 1 at the shared precision, or null when the coarser side leaves it undecided
  const cmp = (a, b) => {
    const n = Math.min(a.length, b.length), x = a.slice(0, n), y = b.slice(0, n);
    if (x !== y) return x < y ? -1 : 1;
    return a.length === b.length ? 0 : null;
  };
  // true / false / null (undecided): was this dated member in the unit when the reign began?
  const memberAt = (m, won, promo) => {
    let undecided = false;
    for (const era of Array.isArray(m.eras) ? m.eras : []) {
      if (typeof era !== "string" || !era) continue;
      if (ISO.test(era)) {
        if (!won) { undecided = true; continue; }
        if (won.startsWith(era)) return true;
        if (era.startsWith(won)) undecided = true;
      } else if (promo == null) undecided = true;
      else if (era === promo) return true;
    }
    if (m.first_seen != null || m.last_seen != null) {
      const fs = typeof m.first_seen === "string" && ISO.test(m.first_seen) ? m.first_seen : null;
      const ls = typeof m.last_seen === "string" && ISO.test(m.last_seen) ? m.last_seen : null;
      if (!won || (m.first_seen != null && !fs) || (m.last_seen != null && !ls)) undecided = true;
      else {
        const lo = fs ? cmp(fs, won) : -1, hi = ls ? cmp(won, ls) : -1;
        if (lo === null || hi === null) undecided = true;
        else if (lo <= 0 && hi <= 0) return true;
      }
    }
    return undecided ? null : false;
  };
  for (const r of reigns) {
    const holders = (r.holder ?? []).map((h) => canon(h?.id)).filter(Boolean);
    const unitHolders = holders.filter((id) => unitRowById.has(id));
    if (!unitHolders.length) continue;
    const direct = new Set(holders);
    const won = wonOf(r);
    const promo = titleById.get(r.title)?.promotion ?? r.promotion ?? null;
    const credited = new Map(); // character id -> unit_kind
    let unresolved = false;
    for (const uid of unitHolders) {
      const u = unitRowById.get(uid);
      const mem = Array.isArray(u.members) ? u.members : [];
      const entries = mem.map((m) => (typeof m === "string" ? { id: canon(m), m: {} } : { id: canon(m?.character_id ?? m?.id), m: m ?? {} }));
      const dated = entries.some((x) => isDated(x.m));
      const fixed = !dated && mem.length > 0 && (
        ((u.unit_kind === "tag-team" || u.unit_kind === "duo") && mem.length <= 2) ||
        (mem.length === 2 && u.unit_kind !== "trio" && entries.every((x) => x.m.note == null)) ||
        (u.unit_kind === "trio" && mem.length === 3));
      if (!mem.length) unresolved = true;
      for (const x of entries) {
        if (!x.id || !characterIds.has(x.id)) continue;
        const ok = dated ? (isDated(x.m) ? memberAt(x.m, won, promo) : null) : (fixed ? true : null);
        if (ok === null) unresolved = true;
        if (ok === true && !direct.has(x.id) && !credited.has(x.id)) credited.set(x.id, u.unit_kind ?? "");
      }
    }
    reignTeamStats.unitReigns += 1;
    if (!credited.size && unresolved) reignTeamStats.creditedNoOne += 1;
    for (const [cid, kind] of credited) {
      reignTeamCountById.set(cid, (reignTeamCountById.get(cid) ?? 0) + 1);
      if (!reignTeamKindsById.has(cid)) reignTeamKindsById.set(cid, new Set());
      reignTeamKindsById.get(cid).add(kind);
      reignTeamStats.credits += 1;
    }
  }
}
const reignTotal = (id) => (reignCountById.get(id) ?? 0) + (reignTeamCountById.get(id) ?? 0);
// " (3 as part of a tag team)", or "" when none came through a team
const reignTeamNote = (id) => {
  const n = reignTeamCountById.get(id) ?? 0;
  if (!n) return "";
  const allTag = [...(reignTeamKindsById.get(id) ?? [])].every((k) => k === "tag-team" || k === "duo");
  return ` (${n} as part of a ${allTag ? "tag team" : "team"})`;
};
console.log(`cross-reference: team reigns: ${reignTeamStats.credits} member credits to ${reignTeamCountById.size} characters from ${reignTeamStats.unitReigns} unit-held reigns; ${reignTeamStats.creditedNoOne} unit-held reigns credit no member (membership not fixed or not dated).`);

// THE RECORDS WAVE, 2026-08-18 — OBSERVED win/loss, museum-computed from
// data/shows.json's own matches[] (`sides`/`winner_side`), distinct from
// (and never blended with) a fed's own DECLARED record rendered from a
// tenure's own `record` field below. Recomputed fresh on every regen —
// never hand-maintained, never persisted back into data/*.json — same
// "derived, not stored" discipline reigns.json's own lost-show chaining
// already uses. Three honesty buckets per the brief: a match with `sides`
// but no parsed `winner_side` is "unresolved" (sides are known, the
// outcome isn't); a match with no `sides` at all (a flat `participants`
// list) isn't a W/L fact at all and is skipped here entirely — it's
// already counted as an appearance elsewhere, never guessed into a
// won/lost bucket it was never parsed to support.
// THE W-L-D RECORDS (hook c227, lane RECORDS-WLD, 2026-10-09; the Janitor, chat: "we have a ton of match results, but
// we don't have an aggregate win-loss-draw record per character do we? I feel like we should have that per tenure and
// aggregated at the character level"). Still the OBSERVED register above, never blended with the declared one. Five
// buckets per credit now, not three: a match whose `result` is "draw" or "double-pin" is a draw (d) for every side;
// "no-contest" is its own bucket (nc); a match with `sides` but neither a parsed `winner_side` nor a result stays
// "unresolved" (u); a parsed `winner_side` decides the match as before (each member of the winning side a win, every
// other side a loss). A match with no `sides` (flat participants) is still not counted. Each credit keeps its show's
// date range, so a tenure gets the matches of ITS run (observedSplitFor): a fed's only run takes all of that fed's
// matches; where a character has two or more runs in one fed, a match goes to the one run whose first_seen..last_seen
// window holds the show's date, and a match no single run settles (an undated show, undated or overlapping runs) is
// shown as the fed's, "not placed in a run", never guessed into one. The career line (generatePersonPage) and the
// listing row count every credit in every fed, tenure or not.
const OBS_DRAW_RESULTS = new Set(["draw", "double-pin"]);
const obsEmpty = () => ({ w: 0, l: 0, d: 0, nc: 0, u: 0 });
const observedByEntityPromo = new Map(); // `${id} ${promo}` -> {w,l,d,nc,u}
const observedCreditsById = new Map();   // id -> [{p, lo, hi, o}]: o one of w/l/d/nc/u; lo..hi the show's date range, or null
let observedMatchesParsed = 0, observedShowsWithSides = 0;
const observedCorpus = { w: 0, d: 0, nc: 0, u: 0, credits: 0 }; // per MATCH (w = decided by a parsed winner) + credits issued
for (const s of shows) {
  let sawSides = false;
  const dk = showDateKey(s.date);
  const lo = dk ? dk.replace(/-99/g, "-00") : null, hi = dk;
  for (const m of s.matches ?? []) {
    if (!Array.isArray(m.sides) || m.sides.length < 2) continue;
    sawSides = true;
    observedMatchesParsed++;
    const hasWinner = typeof m.winner_side === "number" && m.winner_side >= 0 && m.winner_side < m.sides.length;
    const kind = hasWinner ? "win" : OBS_DRAW_RESULTS.has(m.result) ? "d" : m.result === "no-contest" ? "nc" : "u";
    observedCorpus[kind === "win" ? "w" : kind]++;
    for (let sideIdx = 0; sideIdx < m.sides.length; sideIdx++) {
      for (const id of m.sides[sideIdx] ?? []) {
        const o = kind === "win" ? (sideIdx === m.winner_side ? "w" : "l") : kind;
        const key = id + " " + s.promotion;
        const rec = observedByEntityPromo.get(key) ?? obsEmpty();
        rec[o]++;
        observedByEntityPromo.set(key, rec);
        const list = observedCreditsById.get(id) ?? [];
        list.push({ p: s.promotion, lo, hi, o });
        observedCreditsById.set(id, list);
        observedCorpus.credits++;
      }
    }
  }
  if (sawSides) observedShowsWithSides++;
}
{
  const c = obsEmpty();
  for (const r of observedByEntityPromo.values()) for (const k of Object.keys(c)) c[k] += r[k];
  console.log(`cross-reference: observed records (hook c227): ${observedMatchesParsed} matches with sides on ${observedShowsWithSides} shows (${observedCorpus.w} decided, ${observedCorpus.d} drawn, ${observedCorpus.nc} no contest, ${observedCorpus.u} unresolved); ${observedCorpus.credits} credits to ${observedCreditsById.size} characters/units: W ${c.w}, L ${c.l}, D ${c.d}, NC ${c.nc}, unresolved ${c.u}.`);
}
function observedRecordFor(entityId, promo) {
  return observedByEntityPromo.get(entityId + " " + promo) ?? null;
}
const obsTotal = (r) => r.w + r.l + r.d + r.nc + r.u;
// "W-L-D", then the two honesty buckets, each only when non-zero
const obsText = (r) => `${r.w}-${r.l}-${r.d}${r.nc ? `, ${r.nc} no contest` : ""}${r.u ? `, ${r.u} unresolved` : ""}`;
const obsMatchesWord = (n) => `${n} parsed match${n === 1 ? "" : "es"}`;
// every credit, every fed: the career line and the listing row
function observedCareerFor(entityId) {
  const list = observedCreditsById.get(entityId);
  if (!list || !list.length) return null;
  const rec = obsEmpty();
  const promos = new Set();
  for (const c of list) { rec[c.o]++; promos.add(c.p); }
  return { rec, n: list.length, promos: promos.size };
}
// a tenure's first_seen / last_seen as a comparable bound ("YYYY-MM-DD"; a month or year widened to its whole span);
// null = open. A first_seen written "by <date>" says the run began no later than that date, so its start is open.
function obsTenureBound(v, end) {
  if (v && typeof v === "object") { if (v.precision === "unknown") return null; v = v.date; }
  if (typeof v !== "string") return null;
  if (!end && /^\s*by\b/i.test(v)) return null;
  const m = v.match(/(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return null;
  return `${m[1]}-${m[2] ?? (end ? "99" : "00")}-${m[3] ?? (end ? "99" : "00")}`;
}
// one page's split: per[i] = tenure i's record (or null); unplaced = promo -> the matches no single run of that fed
// settles; multi = the feds with two or more runs; firstOf = promo -> the index of that fed's first run
function observedSplitFor(e) {
  const tenures = e.tenures ?? [];
  const per = tenures.map(() => null);
  const unplaced = new Map();
  const byPromo = new Map();
  tenures.forEach((t, i) => { const a = byPromo.get(t.promotion) ?? []; a.push(i); byPromo.set(t.promotion, a); });
  const bounds = tenures.map((t) => ({ lo: obsTenureBound(t.first_seen, false), hi: obsTenureBound(t.last_seen, true) }));
  for (const c of observedCreditsById.get(e.id) ?? []) {
    const idxs = byPromo.get(c.p);
    if (!idxs) continue;
    let target = -1;
    if (idxs.length === 1) target = idxs[0];
    else if (c.lo) {
      const hits = idxs.filter((i) => (bounds[i].lo === null || c.hi >= bounds[i].lo) && (bounds[i].hi === null || c.lo <= bounds[i].hi));
      if (hits.length === 1) target = hits[0];
    }
    if (target >= 0) { per[target] = per[target] ?? obsEmpty(); per[target][c.o]++; }
    else { const r = unplaced.get(c.p) ?? obsEmpty(); r[c.o]++; unplaced.set(c.p, r); }
  }
  const multi = new Set([...byPromo].filter(([, a]) => a.length > 1).map(([p]) => p));
  const firstOf = new Map([...byPromo].map(([p, a]) => [p, a[0]]));
  return { per, unplaced, multi, firstOf };
}
const rps = existsSync(resolve(DATA, "rps.json")) ? loadArray("rps") : [];
const essays = existsSync(resolve(DATA, "essays.json")) ? loadArray("essays") : [];
// THE FLAT-FILE DATABASE WAVE (W8): rp-catalog.json — every RP/match-
// report/in-card the UWF's own CGI database's per-username catalogs named
// as having existed, whether or not the served collection holds it. Held
// rows link back into rps.json (rendered as a normal link); lost rows are
// listed plainly, per standing doctrine — never narrated as an absence,
// just not linked.
const rpCatalog = existsSync(resolve(DATA, "rp-catalog.json")) ? loadArray("rp-catalog") : [];
const rpCatalogByAuthor = new Map();
// A8 (THE WRESTLER-PAGE TEMPLATE WAVE): rps_id -> catalog row, so a
// "Referencing" list (someone ELSE's RP that merely namedrops this
// entity) can attribute each row to the character who actually wrote it.
const rpCatalogByRpsId = new Map();
// THE AUTHOR-OPTIONALITY WAVE: an author_unknown:true row has no entity to
// group under — deliberately not pushed into rpCatalogByAuthor at all
// (never grouped under a bogus `undefined` key that no real entity id
// could ever look up). The row still exists, honestly, in rp-catalog.json
// itself; it simply has no per-entity page to render onto until an
// attribution is found.
for (const c of rpCatalog) {
  if (c.author) {
    const list = rpCatalogByAuthor.get(c.author) ?? [];
    list.push(c);
    rpCatalogByAuthor.set(c.author, list);
  }
  if (c.rps_id) rpCatalogByRpsId.set(c.rps_id, c);
}
const rpsById = new Map(rps.map((r) => [r.id, r]));
// SOURCE-PATH LINKING WAVE (L199): docTitleByPath maps every already-
// indexed served document route (a show's own recap page, a roleplay's
// own served page) to the label a reader would recognise it by, so a raw
// path embedded in a tenure.source citation can become a real link with
// real link text. A reference/archive document with no shows.json/
// rps.json row of its own (a title-history page, a roster dump, a bio
// card) falls through to readDocTitleFromDisk() (declared further down,
// beside servedSourceText -- a function declaration, hoisted, so calling
// it from here would be safe too, but it is not needed until render time).
// Must be built AFTER shows/rps/promoById are initialised, so it stays
// here rather than beside SOURCE_DOC_PATH_RE at the top of the file.
const docTitleByPath = new Map();
for (const s of shows) {
  if (s.page) docTitleByPath.set(s.page.replace(/^\.?\//, ""), showLabel(s));
}
for (const r of rps) {
  if (r.served_url) {
    // hook c106 (the Janitor's D407): a roleplay no fed claims is labelled by the hub it was posted on (`venue`).
    const acro = bareAcronym(promoById.get(r.promotion ?? r.venue)) || r.promotion || r.venue || "";
    docTitleByPath.set(r.served_url.replace(/^\.?\//, ""), acro ? `${r.title} (${acro})` : r.title);
  }
}
// THE SHOW_ID ALTERNATIVE: a rp-catalog row's own served destination is
// often shows.json (a match report, a backstage segment), not rps.json —
// this map lets the catalog renderer below resolve either shape the same
// way, by the served page's own `page` field.
const showsById = new Map(shows.map((s) => [s.id, s]));
// THE MATCH-PROSE EXTRACTION WAVE (W6): shows.json's own `appearances`
// ({ who, kind: match|angle }), inverted into entityId -> [{show, kind}] for
// each entity's own "Shows" section. Sorted chronologically by the show's
// own date string — precision-mixed dates ("2001" vs "2001-03-05") still
// compare sanely under plain string comparison since a bare year is always
// a PREFIX of a fuller date for the same year, so it sorts immediately
// before it; good enough for a chronological list, not a claim of exact
// ordering across differently-precise dates.
// THE OPPONENTS-PER-MATCH WAVE used to build a matchInfoByShowEntity join
// here (partners/opponents/result per show+entity) so renderShowsSection
// could render a linked opponent list inline. THE MATCH SECTION (2026-08-20)
// retired that inline rendering — the same result/opponent detail is now
// the searchable match index's own job (data/matches-index.json,
// renderMatchRow() above), never duplicated here — so the join is gone too;
// `opponentJoinById` (below, for the entityCard's own data-opponent facet)
// is a separate computation and is unaffected.
const appearancesByEntity = new Map();
for (const s of shows) {
  for (const a of s.appearances ?? []) {
    const list = appearancesByEntity.get(a.who) ?? [];
    list.push({ show: s, kind: a.kind });
    appearancesByEntity.set(a.who, list);
  }
}
for (const list of appearancesByEntity.values()) {
  list.sort((x, y) => {
    const dx = x.show.date?.date ?? "", dy = y.show.date?.date ?? "";
    return dx < dy ? -1 : dx > dy ? 1 : 0;
  });
}
// THE GAME-VALUABLE DATAPOINTS WAVE: awards + relationship edges, rendered
// on each entity's own generated page (and awards, additionally, on
// promotions.html client-side).
// THE AWARD ENTITIES WAVE: awards.json is now one row per award ENTITY
// (promotion + award name), each carrying a bestowals[] array — one entry
// per year/ceremony. awardsByEntity still keys off a WRESTLER's own id
// (unchanged contract for every caller below), but each list item now
// carries both the parent award entity (name, page, promotion) and the
// specific bestowal (year, result, vote_detail) that named them.
const awards = existsSync(resolve(DATA, "awards.json")) ? loadArray("awards") : [];
const relationships = existsSync(resolve(DATA, "relationships.json")) ? loadArray("relationships") : [];
const awardsByEntity = new Map(); // entityId -> [{award, bestowal, role: "recipient"|"runner_up"}]
for (const a of awards) {
  for (const b of a.bestowals ?? []) {
    for (const r of b.recipient ?? []) {
      if (!r.id) continue;
      const list = awardsByEntity.get(r.id) ?? [];
      list.push({ award: a, bestowal: b, role: "recipient" });
      awardsByEntity.set(r.id, list);
    }
    for (const r of b.runner_up ?? []) {
      if (!r.id) continue;
      const list = awardsByEntity.get(r.id) ?? [];
      list.push({ award: a, bestowal: b, role: "runner_up" });
      awardsByEntity.set(r.id, list);
    }
  }
}
const relationshipsByEntity = new Map(); // entityId -> [{other, rel}]
for (const r of relationships) {
  const la = relationshipsByEntity.get(r.a) ?? [];
  la.push({ other: r.b, rel: r, side: "a" });
  relationshipsByEntity.set(r.a, la);
  const lb = relationshipsByEntity.get(r.b) ?? [];
  lb.push({ other: r.a, rel: r, side: "b" });
  relationshipsByEntity.set(r.b, lb);
}

// THE SAME-HANDLER EDGES WAVE: rendering is CLUSTER-WIDE, not pairwise —
// the Janitor's own worked example ("Lew Spectre's relationships would
// point to the Phenomenons and hardkore alike") means every member of a
// same-handler group has to see every OTHER member, not just whichever
// ones happen to carry a direct edge to it. A small spanning set of edges
// (not a full pairwise mesh) is enough: union-find over every
// nature:"same-handler" edge computes the connected components once,
// here, at build time.
const sameHandlerParent = new Map();
function shFind(x) {
  if (!sameHandlerParent.has(x)) sameHandlerParent.set(x, x);
  let root = x;
  while (sameHandlerParent.get(root) !== root) root = sameHandlerParent.get(root);
  while (sameHandlerParent.get(x) !== root) {
    const next = sameHandlerParent.get(x);
    sameHandlerParent.set(x, root);
    x = next;
  }
  return root;
}
function shUnion(a, b) {
  const ra = shFind(a), rb = shFind(b);
  if (ra !== rb) sameHandlerParent.set(ra, rb);
}
for (const r of relationships) {
  if (r.nature === "same-handler") shUnion(r.a, r.b);
}
const sameHandlerClusters = new Map(); // entityId -> [other entity ids in its own cluster]
{
  const byRoot = new Map();
  for (const id of sameHandlerParent.keys()) {
    const root = shFind(id);
    const list = byRoot.get(root) ?? [];
    list.push(id);
    byRoot.set(root, list);
  }
  for (const members of byRoot.values()) {
    if (members.length < 2) continue;
    for (const id of members) {
      sameHandlerClusters.set(id, members.filter((m) => m !== id));
    }
  }
}

// Reign chronology, per title (data/reigns.json rows already appear in
// chronological order WITHIN a given title — extraction order for the
// ledger-sourced rows, append order for any museum-compiled continuation —
// even though rows for DIFFERENT titles interleave in the flat array).
// "Lost" show links are derived, not stored: the show where a reign ended is
// the same night the NEXT reign in that title's own chronology began, i.e.
// the next row's own `event`. A reign with no next row (still champion at
// the record's end) simply has no derived lost-show.
const reignsByTitle = new Map();
for (const r of reigns) {
  const list = reignsByTitle.get(r.title) ?? [];
  list.push(r);
  reignsByTitle.set(r.title, list);
}
const lostEventByReignId = new Map();
for (const rows of reignsByTitle.values()) {
  for (let i = 0; i < rows.length - 1; i++) {
    if (rows[i + 1].event) lostEventByReignId.set(rows[i].id, rows[i + 1].event);
  }
}
const reignsByEntity = new Map(); // entityId -> [reign, ...] (order preserved)
for (const r of reigns) {
  for (const h of r.holder ?? []) {
    if (!h.id || h.id.startsWith("name-")) continue;
    const list = reignsByEntity.get(h.id) ?? [];
    list.push(r);
    reignsByEntity.set(h.id, list);
  }
}

// RPs, split by connection kind (CURATION.md's registry rule: an entity is one or the
// other per RP, never both) — used for each entity's "Roleplays" section.
const rpsInvolvingById = new Map();
const rpsReferencingById = new Map();
for (const rp of rps) {
  for (const id of rp.involves ?? []) {
    const list = rpsInvolvingById.get(id) ?? [];
    list.push(rp);
    rpsInvolvingById.set(id, list);
  }
  for (const id of rp.references ?? []) {
    const list = rpsReferencingById.get(id) ?? [];
    list.push(rp);
    rpsReferencingById.set(id, list);
  }
}

// THE PROMOTION-DERIVATION WAVE (the Janitor catch: promotion:ptc returned no
// wrestlers or roleplays at all, despite the wing's own record naming real
// interfed cameo appearances — Seymour Almasy, Jay Phoenix, the Phenomenons,
// the Plague all appear on served PTC shows with no PTC *tenure* of their
// own, since PTC has almost no native roster of its own — "most PTC
// participation runs through a member fed's own roster instead," per the
// wing's own text). An entity's own registered `tenures[]` is genuine fed
// MEMBERSHIP and stays the source of truth for prose ("Character · UWF
// (2001)") — but the machine-FILTERABLE promotion facet (data-promo, the
// characters-index.json `promo` field, and the nameIndex context this file's
// own auto-linker narrows against) is broader than membership: a wrestler
// who appeared on a promotion's own show (`shows.json` appearances), was
// involved in one of its roleplays (`rps.json` involves), or held one of
// its titles (`reigns.json`, resolved holders only) is genuinely connected
// to that promotion even without ever joining its roster, and a search or
// filter scoped to that promotion should surface them. Appearances/RPs/
// reigns maps are all already built above this point.
function derivedPromoIds(e) {
  const ids = new Set((e.tenures ?? []).map((t) => t.promotion));
  for (const a of appearancesByEntity.get(e.id) ?? []) {
    if (a.show?.promotion) ids.add(a.show.promotion);
  }
  for (const rp of rpsInvolvingById.get(e.id) ?? []) {
    if (rp.promotion) ids.add(rp.promotion);
  }
  for (const r of reignsByEntity.get(e.id) ?? []) {
    const t = titleById.get(r.title);
    if (t?.promotion) ids.add(t.promotion);
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// 1. Build the name index: displayName/aka -> [{id, promos}]
// ---------------------------------------------------------------------------
// SITE GUARD (GCW-NAMELESS-0929, 2026-09-29): a record whose registry name is empty must still render a clickable label in every
// index row, A-Z register row, pager link and page heading (an empty <a></a> is zero-width, so the row cannot be clicked and the
// prev/next step to it shows only an arrow). Build-time fallback only; the registry keeps its own value.
for (const e of [...characters, ...units]) {
  if (!String(e.name ?? "").trim()) e.name = `Unnamed (${e.id})`;
}
const entities = [...characters, ...units];
const byId = new Map(entities.map((e) => [e.id, e]));
const nameIndex = new Map(); // name -> [{id, promos:Set}]

// Bare words too generic/common (or too shorthand-prone in casual prose) to
// safely auto-link — confirmed by hand-review to false-positive against
// prose that means someone else, or means the word, not the wrestler. The
// entity still exists and is reachable from characters.html; it just isn't
// auto-linked from a bare mention of the word.
const EXCLUDE_NAMES = new Set([
  // THE GEO-WAVE-B SIX (2026-08-26, receipts in the workshop's geo-wave-b-2026-08-26.md):
  // real-wrestler/move names minted as wave-B characters that auto-link from
  // unrelated promotions' own real-world namedrops.
  "Splash", "Bill Goldberg", "Juventud Guerrera", "Bam Bam Bigelow",
  "Barry Horowitz", "Steve Armstrong", "Lance Storm",
  // CSWA TIER-3 EXTERNAL FIGURES (2026-08-26): real-world cameos staged
  // under their own names on CSWA's own served cards (a coach/ring announcer,
  // an actor, a real judge and prosecutor, two athletes, two wrestling
  // broadcasters) — portrayal doctrine per CURATION.md v78/v96, same
  // bare-name-excluded / qualified-id-only discipline.
  "Mike Krzyzewski",
  "Coach K",
  "Mark Hamill",
  "Lance Ito",
  "Judge Ito",
  "Marcia Clark",
  "Charles Barkley",
  "Michael Jordan",
  "Jim Ross",
  "Gene Okerlund",
  "Mean Gene",

  // FF TIER-3 EXTERNAL FIGURE (2026-08-30): the real ring announcer staged
  // under his own name and catchphrase on FF's own Pride & Victory PPV —
  // same portrayal doctrine, same bare-name-excluded discipline.
  "Michael Buffer",

  // THE TWF PORTRAYAL MINT (2026-08-26): 149 real-wrestler bare names
  // (portrayal characters minted into data/shards/wwe-the-efed/characters.json,
  // qualified -twf ids) per CURATION.md v78(b) and the per-promotion portrayal
  // doctrine (GAVELS.md, 2026-08-26) — every qualified id auto-links only within
  // its own promotion's pages; the bare name below is barred sitewide.
  "A.J. Styles",
  "AJ Lee",
  "AJ Styles",
  "Adam Cole",
  "Adam Page",
  "Alberto Del Patron",
  "Alberto El Patrón",
  "Alexa Bliss",
  "Alexxis Nevaeh",
  "Alicia Fox",
  "Allie",
  "Amy Zidian",
  "Andrade",
  "Angelina Love",
  "Ashley Massaro",
  "Asuka",
  "Austin Gunn",
  "Baron Corbin",
  "Bayley",
  "Becky Lynch",
  "Bianca Belair",
  "Big E",
  "Billie Kay",
  "Bobby Roode",
  "Boogeyman",
  "Brad Maddox",
  "Bray Wyatt",
  "Brie Bella",
  "Brooke Adams",
  "CM Punk",
  "Candice LeRae",
  "Candice Michelle",
  "Carmella",
  "Carmella DeCesare",
  "Carmen Alexandria Rodriguez",
  "Cassie Lee",
  "Cedric Alexander",
  "Charlie Haas",
  "Charlotte",
  "Chelsea Green",
  "Chris Jericho",
  "Chris Masters",
  "Christian",
  "Cody Rhodes",
  "Colt Cabana",
  "Cookie",
  "Corey Graves",
  "Curtis Axel",
  "Dakota Kai",
  "Damien Sandow",
  "Daniel Bryan",
  "Danielle Moinet",
  "Dexter Lumis",
  "Dolph Ziggler",
  "Drake Maverick",
  "Drew McIntyre",
  "Enzo Amore",
  "Eric Bischoff",
  "Eva Marie",
  "Eve Torres",
  "Fandango",
  "Finn Bálor",
  "Goldust",
  "Hangman Page",
  "Io Shirai",
  "James Storm",
  "Jay White",
  "Jeff Hardy",
  "Jen England",
  "Jillian Hall",
  "Jimmy Havoc",
  "Jimmy Jacobs",
  "Jinder Mahal",
  "Joey Janela",
  "John Cena",
  "Johnny Gargano",
  "Jon Moxley",
  "Jordan Devlin",
  "Justin Gabriel",
  "Kaitlyn",
  "Kane",
  "Karrion Kross",
  "Kelly Kelly",
  "Kenny Omega",
  "Kevin Owens",
  "Killer Kelly",
  "Kip Sabian",
  "Konnor",
  "Kris Statlander",
  "Kyle O'Reilly",
  "Lacey Evans",
  "Lacey Von Erich",
  "Layla El",
  "Lita",
  "Liv Morgan",
  "Madison Rayne",
  "Madman Fulton",
  "Mandy Leon",
  "Mandy Rose",
  "Maria Kanellis",
  "Marty Scurll",
  "Maryse Ouellet",
  "Matt Hardy",
  "Maxwell Jacob Friedman",
  "Mickie James",
  "Miz",
  "Natalie Nova",
  "Nikki Bella",
  "Nikki Cross",
  "Nixon Newell",
  "PCO",
  "Paige",
  "Pastor William Eaver",
  "Paul Heyman",
  "Paul London",
  "Penelope Ford",
  "Peyton Royce",
  "Ricochet",
  "Rock",
  "Roderick Strong",
  "Roman Reigns",
  "Ronda Rousey",
  "Roni Jonah",
  "Rosa Mendes",
  "Rosemary",
  "Ruby Riott",
  "Sami Zayn",
  "Sammy Guevara",
  "Samuel Shaw",
  "Sasha Banks",
  "Scarlett",
  "Scarlett Bordeaux",
  "Seth Rollins",
  "Shane Thorne",
  "Sonya Deville",
  "Stacy Keibler",
  "Taryn Terrell",
  "Ted DiBiase",
  "Tenille Dashwood",
  "The Boogeyman",
  "The Miz",
  "The Rock",
  "Torrie Wilson",
  "Tyler Breeze",
  "Velvet Sky",
  "Velveteen Dream",
  "Vickie Guerrero",
  "Vince McMahon",
  "Wade Barrett",

  // NFW tier-3 registry pass (2026-08-26): mints from the fed's own show corpus,
  // each caught live in this pass's own post-refresh:links cross-promotion diff
  // wiring itself into ANOTHER promotion's served pages. Every anchor was read
  // in context before the name was listed here.
  "Doctor Doom", // an aka on NFW's own Jeff Cummins; caught on "Like the Joker or Doctor Doom" in another fed's roleplay
  "Dirty Sanchez", // a billed NFW entrant; also crude slang, caught mid-joke in another fed's roleplay
  "Brandon Jacobs", // an NFW manager; caught in a list of real celebrities in another fed's roleplay
  "Robert Robertson", // an NFW referee; another fed's own Robert Robertson answers the phone "from the UWF"
  "Triple X", // an NFW mystery partner; caught on "the Triple X Book Store"
  "El Toro", // an NFW masked ally; caught on another fed's own El Toro mask, worn in 1995
  "Jacobs", // an NFW Southern Baptist Coalition man billed by bare surname; caught linking itself INSIDE another character's full name, "Brandon Jacobs"
  // CSWA tier-3 crawl (lot 0062, 2026-08-27): mints from the fed's own card
  // corpus, each caught live in this lane's own post-refresh:links diff wiring
  // itself into OTHER promotions' served pages. Every anchor was read in
  // context before the name was listed.
  "Problem Child", // ordinary prose and a John Ritter film reference in other feds' roleplays
  "ICE MAN", // "forever be ICE MAN in Top Gun to me"
  "Ice Man", // same name, mixed case
  "Road Runner", // "the Road Runner that Wile E. Coyote is always trying to catch"
  "Dark Knight", // another fed's own prose; also an ordinary epithet
  "Dark Warrior", // another fed's own Dark Warrior, swinging an NRW title
  "Tidal Wave", // a move/epithet in UWF prose ("Tidal Wave Demon destroyer")
  "Law and Order", // "Law and Order Special Victims Unit"
  "The Chosen One", // an ordinary epithet across several feds
  // The PRODIGY-diaspora identity questions: the same ring names appear in the
  // feds this roster went on to, and a link would assert an identity nobody has
  // ruled on. Excluded pending a verdict, the JT Tyler precedent above.
  "Shane Southern",
  "Shawn Matthews",
  "Steel Viper",
  "Avery Prosser",
  "Poison Ivy",
  "Chris Shepherd",
  "Sweet Melissa",
  "The Dark Carnival",
  // the same names in the fed's own ALL-CAPS card billing, which the linker
  // treats as separate aka strings:
  "SHANE SOUTHERN",
  "SHAWN MATTHEWS",
  "\"SHOWTIME\" SHAWN MATTHEWS",
  "\"Showtime\" SHAWN MATTHEWS",
  "STEEL VIPER",
  "AVERY PROSSER",
  "POISON IVY",
  "Kamikaze Kid", // a nickname in another fed's prose ("because of his reckless high-flying")
  "SWAT Team", // another fed's own SWAT Team on its own card listing
  // CSWA lot 0062 (applied at the coordinator's merge, 2026-08-26):
  "Simply Stunning", // 7 false anchors into 4WW, where it's Sean Summers' own moniker
  "JT Tyler", // 11 anchors asserting a cross-fed identity nobody ruled on — excluded pending the review verdict
  // Wiki-native lot 0061 (applied at the coordinator's merge, 2026-08-25):
  "The Beautiful People", // obw unit wired into the-spectre's caption where the words are the Marilyn Manson song — the one live false positive of the whole adversarial regen
  "Ray", // pre-emptive, same class (bare common name, obw roster)
  "Kitten", // pre-emptive, same class
  // XCWF deepening pass (lot 0051, 2026-08-25): seven mints from the fed's
  // own weekly cards, each caught live in this lane's own post-refresh:links
  // diff, wiring itself into OTHER promotions' served roleplays and curated
  // prose. Every anchor listed was read in context and every one is false.
  "British Bomber", // british-bomber-xcwf — nine anchors, all inside FAW
               // roleplays about FAW's OWN British Bomber
               // (the-british-bomber-faw, which links from its own aka
               // "Bomber" in the same sentence in one of them): "he then
               // remembered hearing the bell ringing and British Bomber being
               // announced as the New FAW World Champion."
  "John Doe", // john-doe-xcwf — ten anchors, none XCWF's: WWA's own John Doe
               // across six WWA roleplays, plus the ordinary placeholder use
               // ("I'll call you John Doe, since that's an easier way to go
               // by") in an unrelated fed's promo.
  "New Breed", // new-breed-xcwf — four anchors, all other things entirely:
               // NGW's own New Breed stable ("at first my loyalty was in the
               // New Breed"), LOW's, and a GYM ("a place others called the
               // New Breed Gym").
  "Syphon X", // syphon-x-xcwf — three anchors, all FAW's own Syphon X, two of
               // them the bare byline of a roleplay titled for him
               // (promotions/faw/rp/syphon-in-da-house.html).
  "Double D", // double-d-xcwf — two anchors, neither XCWF's: PTC's own Donny
               // Diamond under his nickname ("Double D became PTC Global
               // Champion") and an unrelated "Team Double D."
  "John Hancock", // john-hancock-xcwf — one anchor, and it is the IDIOM: "her
               // eyes reached the bottom of the paper, where she should find
               // the young man's John Hancock." The Nobody/Flash class exactly.
  "The New Era", // the-new-era-xcwf — one anchor, a TOURNAMENT name in a PTC
               // roleplay ("It's called The New Era and they want you to
               // compete in the Extreme tournament").
  // LCW cluster (lot 0057, applied at the coordinator's merge, 2026-08-25):
  // caption-register false positives the lane caught in its own adversarial
  // regen — "a caption is a context-less register the bare-name rule can't
  // narrow." Lost linked 138 wrong captions; Rush 16 (incl. MWE's own
  // Adrenaline Rush II); Picasso was the same class as an aka.
  "Lost", // lcw-cluster mint, withdrawn — see lcw-cluster-accession.md
  "Rush", // lcw-cluster mint, withdrawn — see lcw-cluster-accession.md
  "Picasso", // lcw-cluster aka, removed — see lcw-cluster-accession.md
  "Limp Bizkit", // PTC wave Lane B (2026-08-23): live false positives caught in the lane's own adversarial regen — applied at the coordinator's merge; see ptc-wave-laneB-handoff.md.
  "The Blood Brothers", // PTC wave Lane B (2026-08-23): live false positives caught in the lane's own adversarial regen — applied at the coordinator's merge; see ptc-wave-laneB-handoff.md.
  "Canadian Perfect", // PTC wave Lane B (2026-08-23): live false positives caught in the lane's own adversarial regen — applied at the coordinator's merge; see ptc-wave-laneB-handoff.md.
  "Mr. Showtime", // PTC wave Lane B (2026-08-23): live false positives caught in the lane's own adversarial regen — applied at the coordinator's merge; see ptc-wave-laneB-handoff.md.
  "Uncle Sam", // GW accession (2026-08-23): re-added at the rspwf merge — a live caught false positive from the GW handoff pass; see 045084d1d for the incident comments.
  "Mile High Club", // GW accession (2026-08-23): re-added at the rspwf merge — a live caught false positive from the GW handoff pass; see 045084d1d for the incident comments.
  "Tragic Hero", // GW accession (2026-08-23): re-added at the rspwf merge — a live caught false positive from the GW handoff pass; see 045084d1d for the incident comments.
  "The Nevermore", // GW accession (2026-08-23): re-added at the rspwf merge — a live caught false positive from the GW handoff pass; see 045084d1d for the incident comments.
  // DWO accession handoff §1 (lot 0039, applied 2026-08-23): two roster-only
  // mints from the DWO's own August 2003 roster page auto-linked onto
  // different men of the same name inside OTHER promotions' served
  // roleplays. Both were 100% false — one anchor each repo-wide, no true
  // hit anywhere — and the DWO lane proved the strip alone is not durable:
  // it unbaked both byte-identically and the next `refresh:links` put them
  // straight back, which is what this list is for.
  // — GDWA accession (lot 0050, 2026-08-24): a live caught false positive in
  // the lane's own adversarial regen. GDWA's own ring announcer, minted from
  // its January 2000 card, linked onto MWE's own unrelated Spud McKenzie in
  // three served MWE roleplays (confined, drunk, sweet-child-o-mine) — three
  // anchors, all false, no true hit anywhere outside the GDWA wing itself.
  "Spud McKenzie", // spud-mckenzie-gdwa
  "Scott Curtis", // scott-curtis (DWO, listed inactive) linked the Scott
               // Curtis in a Donny Diamond promo's list of New Era
               // opponents — PWE's own Undisputed Champion
               // (promotions/ptc/rp/chapter-four-research-and-abilities-gt-rp-1.html).
  // — PTC wave Lane A (2026-08-23): twelve strips with live receipts, each an
  // anchor actually found in PWE/NGW/FF corpora and stripped at merge.
  // — PORTRAYALS OF REAL PROFESSIONAL WRESTLERS (CURATION.md v78, 2026-08-24).
  // v78(b) in as many words: "The bare name lives permanently in
  // EXCLUDE_NAMES; the qualified id auto-links only within its own
  // promotion's pages." Every entry below is a real wrestler whose name a
  // held fed booked as a portrayal, and every one of them was a LIVE
  // regression at the time it was added, not a precaution — a unique
  // multi-word name never reaches promotion-context narrowing (see the
  // DANGEROUS CASE note above), so one fed's portrayal was linking every
  // passing mention of the wrestler in every OTHER fed's documents.
  "Hulk Hogan", // hulk-hogan-nfw (NFW's own bio.php gag roster account,
               // username=hogan, one show). Eight live false anchors across
               // three unrelated feds at the v78 pass — six MWE roleplays,
               // one UWF promo, one WWA roleplay — every one of them a
               // wrestler name-dropping the real Hogan and none of them
               // NFW's. Renamed from the bare `hulk-hogan` in the same pass
               // (data/aliases.json carries the old id forward).
  "Lex Luger", // lex-luger-faw — FAW's own 2001 portrayal, minted under
               // v78(a) on staged activity. The bare name is barred
               // sitewide the moment the qualified id exists.
  "British Bulldog", // FAW's own 2001 billing. On the list whether or not a
               // character is ever minted for it: the name belongs to a
               // real wrestler and means him in every corpus but FAW's.
  "Trish Stratus", // trish-stratus-tpg (TPG's own Diva Champion, 2005) —
               // caught live in the v78 pass's own adversarial regen, in
               // the worst possible place: the FAW wing's new 2001
               // paragraph names her among FAW's OWN billed roster and the
               // linker pointed it straight at TPG's character. Two feds
               // billed the same real wrestler five years apart, which is
               // the entire fact v78(c) exists for. Accounting, stated
               // honestly: 1 false anchor against 1 true one (TPG's own
               // epitaph prose, which keeps its already-baked link — the
               // linker only ever adds). Excluded anyway, because the
               // false hit asserts a cross-promotion identity and the true
               // hit is a convenience on the character's own wing page.
  "Shawn Michaels", // real wrestler; 3 anchors in Lane A corpora (name-drops in promos)
  "Triple H",  // real wrestler; 3 anchors
  "Brock Lesnar", // real wrestler; 3 anchors
  "Big Show",  // real wrestler; 3 anchors
  "Eddy Guerrero", // real wrestler; 2 anchors
  ...ledgerSpelled(["e30bfd0c", "9ce5770b"], (a, b) => [`${ledgerCap(a)} Cold ${ledgerCap(b)} Austin`]), // real wrestler; 1 anchor (hook c118: spelled from the ledger)
  "Shelton Benjamin", // real wrestler; 1 anchor
  "Sting",     // real wrestler + "The Sting" the move; 1 anchor
  "Homicide",  // common word / real wrestler; linked on james-trevel-mwe's own caption
  "Dunn",      // "the Ten Dunn Salute" (FF); common surname fragment
  // "Landen Ozz" was here, and is deliberately gone (the PTC wave's combined
  // handoff pass, 2026-08-23): the entry was Lane A's stopgap for
  // pwe-projectefed's Landen Ozz auto-linking five anchors in 4WW roleplays
  // that mean 4WW's OWN Landen Ozz, Zane Ozz's brother. The lane named the
  // better fix and the coordinator ruled it — `landen-ozz-4ww` is now minted
  // from 4WW's own record, so promotion-context narrowing resolves all five
  // anchors on the fed's own pages and neither man needs excluding. Verified
  // post-regen, anchor by anchor.
  "Jeff James", // two Jeff Jameses (NAPW/NGW); NAPW's own caption linked his own
               // name to the NGW id — 2 anchors stripped
  // — The PWE-board siblings accession (2026-08-24): seven strips with live
  // receipts, every one an anchor actually found in another promotion's own
  // prose after the first full regen of this wave and stripped at merge. The
  // four rosters this accession minted mixed their own characters freely with
  // wrestlers taken straight from television, and ran a lot of one-word
  // billings besides.
  "Christopher Daniels", // 1 in an ACW roleplay + 2 captions ("the RVD/Christopher Daniels mould")
  "Scott Steiner",     // real wrestler; 2 in NFW/WWA roleplays ("Scott Steiner would be proud of that white goatee")
  "Shane Helms",       // real wrestler; 1 in a WWA roleplay ("The guy who used to go around dressed as a Superhero")
  "Randy Orton",       // real wrestler; 2 in 4WW/MWE roleplays ("Randy Orton still has no personality")
  "Eternal",           // ordinary word; 3 captions — "Eternal Damnation", "Eternal Darkness", "Eternal Slumber"
  "Junior",            // ordinary word; 4 PURE captions, every one of them "Junior Heavyweight"
  "Mouse",             // ordinary word; 1 MWE caption — "one of them called it a Mickey Mouse name"
  // — PTC wave Lane C (2026-08-23), applied at the coordinator's merge. Five
  // real, documented entities the lane deliberately did NOT mint, because
  // minting them would have wired the auto-linker into pages across the whole
  // museum that mean something else entirely. Counts below are matches against
  // served pages OUTSIDE the eleven promotions of that batch, taken before
  // minting. The lane's own rule of thumb, and the reason these five and not
  // the two near-misses beside them (Johnny Blaze, Xtra Ordinary, both minted
  // safely): A MULTI-WORD NAME THAT IS CURRENTLY UNIQUE IN THE REGISTRY IS THE
  // DANGEROUS CASE — a unique multi-word name never reaches promotion-context
  // narrowing and never trips the bare-name rule's own one-word test, so it
  // links on every page in the collection; a multi-word name that already
  // collides goes through narrowing instead and resolves correctly on both
  // sides. Once excluded, each entity can be minted safely; the per-character
  // data is in the served documents named beside each one.
  "Main Event", // NAW's own roster bills a wrestler literally "Main Event"
               // (6'2, 200lbs, finisher ReAKshon, half of the tag team
               // Kuruption — promotions/naw/archive/roster-2003-05.html). The
               // two words are ordinary wrestling prose in every corpus the
               // museum holds: 682 matches outside the batch. The Nobody/DDT
               // class exactly.
  "Ace Of Spades", // a UCWF roster name (promotions/ucwf/archive/singles-roster-2003-06.html)
               // that is also a Motörhead song in wide use as entrance music —
               // all 4 out-of-fed hits are entrance-music lines in other feds'
               // scripts. The Purple Haze incident again.
  "Chris Daniels", // an NAW roster name (promotions/naw/archive/roster-2003-05.html);
               // the 1 out-of-fed hit is a real-wrestler namedrop in an ACW bio
               // card's own "Favorite Pro Wrestlers" list.
  "Julia Roberts", // NAW's own fictional interviewer (promotions/naw/archive/staff-2003-04.html,
               // promotions/naw/archive/anarchy-2003-03-27.html), sharing a bare
               // name with the real actress; the 1 out-of-fed hit is an MWE
               // roleplay's own namedrop of the actress herself, in a list beside
               // Nicholas Cage at a wax museum (promotions/mwe/rp/it-s-a-walk-in-the-park.html).
  "Brad Douglas", // an NSW wrestler with a full served bio card
               // (promotions/nsw/archive/brad-douglas-bio-card.html); the 1
               // out-of-fed hit is a name on ACW's own retired roster — a
               // genuine same-name-different-fed collision.
  "Money Train", // a UCWF stable (promotions/ucwf/archive/stable-roster-2003-06.html);
               // the 1 out-of-fed hit is an NFW roleplay's own idiom ("a
               // BONA-FIDE Money Train").
  // — PTC wave Lane C, Tier 2 pass (2026-08-23): santa-claus-ucwf, minted
  // from a real UCWF Breakout 2003 Vamped title match, is exactly the
  // Nobody/DDT class: a seasonal figure named in ordinary prose across the
  // whole collection, not another registered entity. A pre-commit adversarial
  // regen caught it auto-linking into six other feds' own roleplays (FAW,
  // LOW, MWE, NFW, UWF, WWA) the moment it minted — none of them mean UCWF's
  // wrestler. The entity stands, structured into its own show; the bare name
  // is excluded the same way "Main Event" and "Ace Of Spades" are.
  "Santa Claus",
  // dark-carnival-ucwf, the same wave: its own bare two-word name is a exact
  // match nothing else in the registry carries (FAW's own dark-carnival-faw
  // is registered under the fuller "Dark Carnival eVolution"), so the
  // bare-name rule's multi-word exemption let it link into seven of FAW's
  // and MWE's own roleplays wherever THEIR OWN "Dark Carnival eVolution" is
  // mentioned in shortened form — a same-collection false positive, not an
  // out-of-collection one, caught the same adversarial-regen pass.
  "Dark Carnival",
  "Mike Anderson", // mike-anderson-dwo (a DWO referee) linked a LOW tag
               // wrestler — "2 Legit, AJ and Mike Anderson, stepping out
               // here to receive boos" (promotions/low/rp/untitled-roleplay-11.html).
  "War",       // DWO handoff §1's own flag-don't-fix finding, ruled and
               // fixed by the coordinator in the same pass (2026-08-23):
               // james-thornhill-wwa carries the aka "War" for the mask he
               // wrestled the 2002 Bourbon Street Brawl under. The bare word
               // had baked 33 false anchors across 33 served UWF and WWA
               // roleplays — "the God of War," "The Art of War," "World War
               // II," "Ratings War," "the Dogs of War," "war paint" — against
               // 2 true ones, both the same caption rendered twice (The
               // Magician's own, "alongside Shaman and War"). The aka itself
               // STAYS: it is a real billing, it renders on his own page and
               // it is searchable; only the bare word stops linking, the same
               // ruling Edge/Chuck/Mac/Frank already carry below.
  // NFW accession (2026-08-23): NFW's own roster genuinely included
  // characters named for real people and for fictional properties (Hulk
  // Hogan, William Shatner, Leonard Nimoy, Snow White, Koopa Troopa) --
  // in-universe characters per the generic-name doctrine, but every one of
  // these names also appears across the corpus as the real person or the
  // property itself. Caught live in the NFW lane's own adversarial regen:
  // 8 real-Hogan namedrops in UWF/WWA/MWE roleplays, 4 Disney Snow Whites,
  // 2 Shatner-the-actor references. "Brandon Youngblood" is another fed's
  // own wrestler of the same name inside a WWA roleplay; "Craig Miles"
  // appeared in a UWF tournament roleplay placing him in the fWo, not NFW;
  // "Joe the Plumber" is the 2008 political meme in an MWE roleplay.
  // Watch-only (NOT added until a live false positive appears, per the
  // hand-audit law): Leonard Nimoy, Koopa Troopa, Mittens T. Cat, Legion,
  // Impulse.
  "Hulk Hogan",
  "Snow White",
  "William Shatner",
  "Brandon Youngblood",
  "Craig Miles",
  "Joe the Plumber",
  // NFW's own roster included a wrestler named for the city its arena was in
  // (Lowell, Massachusetts -- the Tsongas Arena was the fed's home through
  // 2004), one named Cancer, and a tag team named Dos Equis. All three names
  // are ordinary words that recur constantly inside the fed's own roleplay
  // corpus as the city, the disease and the beer. Caught live in the NFW
  // roleplay lane's own post-regen audit: 9 Lowell-the-city, 8 Cancer (seven
  // of them one character's "Locker Room Cancer" epithet), 1 Dos-Equis-the-
  // beer, and no true positive for any of the three anywhere in the museum.
  "Lowell",
  "Cancer",
  "Dos Equis",
  "Future Shock", // NFW boards lane audit (2026-08-23): future-shock-napw --
               // "Future Shock" is also the name of NFW's own pay-per-view,
               // so the phrase recurs in NFW's own served roleplays by
               // construction. Coordinator ruling: 4 false hits inside
               // promotions/nfw/rp/ (all NFW's own PPV) against 3 true hits
               // elsewhere (scars's own caption, rendered twice, and one
               // NAPW roleplay) -- false positives outnumber true, excluded.
  "Dark Ages", // NFW boards lane audit (2026-08-23): dark-ages (UWF) -- the
               // NFW hit is the historical period, not the unit. Coordinator
               // ruling: 2 false hits repo-wide (the NFW one, plus a
               // pre-existing false positive this same audit found inside a
               // served UWF roleplay, promotions/uwf/rp/promo-740.html, "The
               // Dark Ages would begin...") against 1 true hit
               // (promotions/uwf/rp/promo-792.html, "Hardcore Champ and Dark
               // Ages member Clyde"). False outnumber true, excluded; the
               // pre-existing false anchor was hand-unwrapped in
               // promo-740.html to match.
  "The One and Only", // eWa accession, Lane 2 (2026-08-22): the-one-and-only-
               // ewa-extreme is the fed's own CEO billing, but the phrase is
               // also a UWF roleplay's own title — it wired into that page's
               // crumb (promotions/uwf/rp/promo-841.html) on first regen.
  "D.C.",      // MWE accession, Lane 2 (2026-08-22): dc-mwe is the fed's own
               // registered billing for its first Undisputed Champion, but
               // the bare token wired itself into "Washington, D.C." inside
               // two UWF roleplay stage directions on first regen
               // (promotions/uwf/rp/promo-469.html, promo-686.html).
  "Milenko",   // MWE accession, Lane 2 (2026-08-22): milenko-mwe — the name
               // riffs on a real wrestler's, and the bare word wired into a
               // WWA roleplay's list of admired real wrestlers
               // (promotions/wwa/rp/why-managers-exist-2003-01-14.html).
  "A-Rod",     // MWE accession, Lane 2 (2026-08-22): a real fed billing (aka
               // of alejandro-rodriguez-mwe), but it wired into a baseball-
               // player list in a WWA roleplay (promotions/wwa/rp/giving-
               // thanks-and-re-united-at-last-rp3415.html).
  "Edge",      // EXTRACTION 1 (2026-08-22): edge-iwf, a founding-era IWF
               // champion registered under the bare word "Edge" — linked it
               // false-positives everywhere English uses the word (including
               // a script comment on relationships.html on first regen).
               // His own reign/entity rows link him by id; the bare word
               // stays unlinked, same rule as Chuck/Mac/Frank below.
  "Chuck",     // WWA lane XIV receipts (2026-08-21): a newly-minted 2004
               // Meltdown competitor, but the bare name false-positives
               // across four promotions' pages, including the-chuckster's
               // own quoted material (identity[] asserts they're distinct).
  "Mac",       // WWA lane XIV receipts (2026-08-21): bare common ring name;
               // corrupted a different wrestler's own quoted nickname
               // "E-Mac" on his own page and a PCW title-history cell.
  "Frank",     // UWF lane VII incident (2026-08-21): frank-uwf (Dr Franken's
               // monster) is BILLED "Frank" — his registered name, not an aka,
               // so this can't be routed around at mint time. The bare word
               // wired 9 false links across three promotions on first regen
               // (a Sinatra lyric, "Frank's All Night Gym," a deposit-station
               // worker, "that punny doctor Frank," ...).
  "Charles",   // UWF lane V handoff (2026-08-20): charles-uwf is a real one-off
               // commentator, but the bare name wired into 4 unrelated spots on
               // its first regen — a WWA RP's different Charles, "Charles
               // Dickens"/"Ray Charles" namedrops in served RPs, and Mustang
               // Charlie's "Charles Tucker" caption.
  "Jobber",    // XUW fleet-lane handoff (2026-08-19): jobber-xuw is a real
               // minted character (AT's 2001 commentary partner), but the
               // bare word "jobber" is everyday wrestling prose — it wired
               // into ~8 unrelated UWF pages on the lane's own branch.
  "Superstar", // curatorial ruling: stays unresolved — must not get wired to
               // Jay Phoenix's "Native American Superstar" billing epithet
  "Phoenix",   // short-form prose for Jay Phoenix outnumbers the one IWF
               // "Phoenix" mention this bare word actually belongs to
  "Flash",     // W3 census mint (IWF roster.htm) — the only corpus hit is
               // "Flash bulbs go off," ordinary prose, not the wrestler
  "Force",     // W3 census mint (IWF Brute Force) — every corpus hit is
               // either "Masked Security Force" (a different team's own
               // name) or unrelated prose, not this wrestler
  "Cage",      // W3 census mint (IWF Bladerunners) — outnumbered by plain
               // "Cage Match" (the match type) everywhere else in the corpus
  "Freak",     // W3 census mint (IWF Misled Youth) — a UWF show script uses
               // "Freak" as an ad hoc dialogue tag for an unrelated,
               // unnamed monster character; different fed, different guy
  "Havoc",     // W8 relationships mint (IWF manager, havoc-iwf) — caught a
               // real false positive live, W10: the NAPW wing's own prose
               // about the show "Heritage Havoc" was auto-linking the bare
               // word "Havoc" to this unrelated IWF character
  "Nobody",    // W10 mint (NAPW, half of Those That Would Inflict Ill,
               // billed exactly as "Nobody" on the fed's own site) — an
               // ordinary English word first, caught wiring itself into
               // served UWF documents' own plain prose ("Nobody will be
               // able to stop him," "Nobody ever fixed it") the moment it
               // was minted; same treatment as every other common-word name
               // on this list
  "Meltdown",  // an aka for Jay Phoenix (IWF), but also WWA's own house-show
               // brand name (W11) — caught live wiring itself into the WWA
               // wing's own prose about WWA's Meltdown show; different fed,
               // different thing entirely
  // "Chris Storm" WAS excluded here (PHASE-1 PUNCH WAVE, false-positive
  // wiring into promotions/ptc/index.html's own PTC Global Championship
  // lineage, which names a different, then-unminted "Chris Storm (RPW)")
  // — retired by THE PROMOTION-DERIVATION WAVE: that second Chris Storm
  // is now its own entity (chris-storm-rpw, explicitly marked distinct
  // from chris-storm-uwf), and derivedPromoIds()'s reign-derived
  // promotion linkage lets ordinary context-narrowing tell them apart on
  // the PTC page correctly, no exclusion required.
  "Purple Haze", // UWF wrestler purple-haze — caught live wiring into the
               // resurrected incard "Kenny Returns" (incarders-9.html)'s
               // own opening stage direction, "['Purple Haze' by Jimi
               // Hendrix hits the sound system.]" — the SONG, playing the
               // returning Kenny Mercury to the ring, not this wrestler.
  "Python",    // NAPW W10 mint (python-napw, a Sole Survivor '14 battle-royal
               // entrant) — caught live wiring into two served UWF roleplays
               // (yg-i-need-an-hero.html, yg-next-tv-champ.html) that name a
               // completely different, unminted UWF wrestler also called
               // "Python" — a generic enough ring name that two unrelated
               // feds landed on it independently.
  "Storm",     // NAPW W10 mint (storm-napw) — an ordinary English word first;
               // caught live wiring into a dozen unrelated UWF/PTC pages'
               // own weather imagery and prose ("the storm of punches"),
               // none of which are this wrestler.
  "Diamond",   // NAPW W10 mint (diamond-napw) — caught live wiring into a
               // UWF roleplay's own "Diamond Cutter" (the move), not this
               // wrestler.
  "Gary",      // NAPW W10 mint (gary-mr-slicks-double, a WGA stable member and
               // Mr. Slick's body double) — caught live wiring into a UWF
               // roleplay's own stage direction naming a completely different
               // person, "Gary Clark," in the very same sentence.
  "Angel",     // UWF wrestler angel-uwf — caught live wiring into the XUW
               // wing's own prose naming El Terrible's entrance music, "One
               // Winged Angel" (the Final Fantasy VII theme) — the SONG
               // title, not this wrestler.
  "The Final Fantasy", // an aka for seymour-almasy (UWF) — also XUW's own
               // El Terrible's nickname, per his own bio card. The XUW
               // mining digest flags the naming convention as suggestive
               // (both riff on Final Fantasy) but explicitly unconfirmed;
               // auto-linking the phrase would assert an identity the
               // registry's own no-auto-merge rule forbids without a graded
               // assertion neither entity currently carries.
  "Destroyer", // XUW win-loss-table mint (destroyer, a single Television
               // title reign, nothing else recovered) — caught live wiring
               // into a completely unrelated, already-established UWF
               // gimmick, the "(Raving Jewish/Dutch) Destroyer," across
               // promotions/uwf/roster.html and half a dozen served UWF RPs.
  "Money",     // XUW win-loss-table mint (a thin roster entry) — an ordinary
               // English word first; caught live wiring into a served UWF
               // promo's own unrelated rhetorical line, "Power? Money? Fame?"
  "Rage",      // XUW win-loss-table mint (a thin roster entry) — caught live
               // wiring into UWF's own "Silent Rage" (a distinct name in its
               // title history) and WWA's own "Rage in the Cage" event name.
  "DDT",       // XUW bio-card mint (ddt, a real multi-time champion) — but
               // "DDT" is also one of the single most common wrestling move
               // names in the entire corpus; caught live wiring itself into
               // GIWF/IWF/UWF roster and Hall of Fame pages and half a dozen
               // served UWF RPs, none of which are this wrestler.
               // Pre-existing correct links elsewhere (titles.html,
               // promo-246.html, genuine in-ring context) are untouched.
  "Jay",       // XUW show-text mint (jay-xuw, a thin undercard entry billed
               // by this bare first name alone) — caught live wiring itself
               // into unrelated UWF RPs' own ordinary prose the moment it
               // was minted (pete-pg-tips-chimp-hype.html, promo-361.html,
               // promo-774.html), none of which are this wrestler.
  "Mal Somers", // WWA W10-Phase-2 mint (mal-somers) — caught live wiring
               // into a served UWF roleplay's own bracket-listing of
               // wrestlers from an unrelated, unheld "PRIME federation"
               // ("...it's got (Dawn) McFarlane, Killean Sirrajin, Mal
               // Somers, Vangels Olsig..." — classic-[ledger term 3b04227a]-believe.html);
               // a different, unminted PRIME-fed character, not this one.
  "Shaman",    // WWA W10-Phase-2 mint (shaman-wwa) — an ordinary word and a
               // generic gimmick archetype first; caught live wiring itself
               // mid-phrase into a served UWF roleplay's own unrelated
               // jobber nickname, "'The Shaman Man' Lester Commie"
               // (incarders-9.html) — a different character, not this one.
  "Dave Harley", // WWA W10-Phase-2 mint (dave-harley) — caught live wiring
               // into a served UWF Universal Promo whose own title names a
               // DIFFERENT, unminted UWF wrestler of the same name
               // ("Dave Harley will lose to me.", promo-200.html) — two
               // distinct feds' own characters sharing an ordinary name,
               // not the same person.
  "The Outlaw", // WWA W10-Phase-2 mint (the-outlaw-wwa) — caught live wiring
               // into the ALREADY-REGISTERED NAPW character "'The Outlaw'
               // Patrick Kidd" (patrick-kidd, napw)'s own caption, turning
               // his own nickname quote into a link pointing at this
               // unrelated WWA wrestler — two distinct feds' own characters
               // sharing the same generic gimmick nickname.
  "Jackson",   // WWA W10-Phase-2 bio-batch mint (jackson-wwa) — caught live
               // wiring itself mid-name into the ALREADY-REGISTERED,
               // unminted WWA World Champion "Jackson Kraven," inside this
               // very wave's own craven-moore caption — a different person
               // this bare first name happens to be a substring of.
  "SEAL",      // WWA W10-Phase-2 bio-batch mint (seal-wwa) — caught live
               // wiring into an unrelated IWF wrestler's own "ex-Navy-SEAL
               // gimmick" caption phrase (rob-williams) — the real-world
               // military term, not this wrestler.
  "Depth",     // WWA W10-Phase-2 bio-batch mint (depth-wwa) — an ordinary
               // English word first; caught live wiring into ten different
               // wings' own unrelated prose ("documented in depth," etc.)
               // the moment it was minted.
  "Draco",     // WWA W10-Phase-2 bio-batch mint (draco-wwa) — caught live
               // wiring into an already-served SCWF roleplay's own
               // namedrop of an unrelated, unminted flavor character also
               // called Draco (scwf/rp/hooligans-and-shenanigans.html); no
               // evidence ties the two per the no-auto-merge rule.
  "Kirk Urban", // WWA W10-Phase-2 bio-batch mint (kirk-urban) — caught live
               // wiring into a served UWF promo's own DIFFERENT,
               // unminted "Kirk Urban" character (explicitly debated as
               // English vs. American in the promo's own dialogue) — two
               // distinct feds' own characters sharing a full name.
  "Fuel",      // WWA W10-Phase-2 bio-batch mint (fuel-wwa) — caught live
               // wiring into a served UWF promo's own entrance-music cue,
               // "Fuel's 'Won't Back Down'" — the BAND, not this wrestler.
  "Chance",    // WWA W10-Phase-2 bio-batch mint (chance-wwa) — an ordinary
               // English word first; caught live wiring into a served UWF
               // promo's own unrelated line, "now I finally get my Chance
               // at the World Champion."
  "Miguel",    // WWA W10-Phase-2 bio-batch mint (miguel-wwa) — caught live
               // wiring into a served UWF promo's own unrelated namedrop
               // ("To my boys, Jaime and Miguel") — a different, unminted
               // person.
  "Fate",      // WWA W10-Phase-2 bio-batch mint (fate-wwa) — an ordinary
               // English word first; caught live wiring into five separate
               // served UWF promos' own unrelated prose ("Fate could be a
               // cruel mistress"), none of which are this wrestler.
  "Kash",      // WWA W10-Phase-2 reign-reconciliation mint (kash-wwa) —
               // caught live wiring into a served UWF promo's own unrelated
               // PRIME-federation bracket-listing sentence (the same
               // false-positive-prone list "Mal Somers" was caught in
               // earlier this wave, classic-[ledger term 3b04227a]-believe.html) — a
               // different, unminted PRIME-fed character, not this one.
  "Ember",     // WWA W10-Phase-2 reign-reconciliation mint (ember-wwa) —
               // caught live wiring into the same UWF PRIME-federation
               // bracket-listing sentence as "Kash" above; a different,
               // unminted character, not this one.
  "Jonathon Winters", // WWA W10-Phase-2 reign-reconciliation mint
               // (jonathon-winters) — caught live wiring into the same UWF
               // PRIME-federation bracket-listing sentence as "Kash" and
               // "Ember" above; a different, unminted character, not this
               // one (also, coincidentally, a real comedian's name).
  "Mr. Darkness", // WWA W10-Phase-2 reign-reconciliation mint (mr-darkness)
               // — caught live wiring into a served UWF promo's own
               // unrelated, unminted tournament-bracket opponent of the
               // same generic villain name (promo-730.html).
  "Jack",      // WWA units/finishing-pass mint (jack-wwa, a bare-first-name
               // 1998 US/TV champion) — caught live wiring into dozens of
               // OTHER wrestlers' own full names across multiple feds
               // ("Jack Griffiths," XUW's "Jack \"the Ripper\" Nobbledy,"
               // "Jack \"Attack\" Jones," etc.), swallowing just the first
               // word and leaving the rest as orphaned plain text — a bare
               // first name is too common to ever safely auto-link.
  "Silence",   // WWA units/finishing-pass mint (silence-wwa) — an ordinary
               // English word first; caught live wiring into unrelated
               // UWF/WWA promos' own prose ("Silence fills every crevice,"
               // "an awkward Silence") across 30+ served documents, only a
               // handful of which were genuinely about this wrestler.
  "Agony",     // WWA units/finishing-pass mint (agony-wwa, half of the Pain
               // Syndicate) — caught live wiring into a served WWA promo's
               // own unrelated namedrop of a DIFFERENT fed's own PPV,
               // "EWA Agony Inc." (advantages-rp1436.html), plus enough
               // ordinary-word usage elsewhere ("Agony Joy Sweat...") to
               // stay excluded rather than risk more of the same.
  "Propaganda", // OSW mint (propaganda-osw, half of Heaven & Hell) — caught
               // live wiring into a served UWF promo's own title, "Operation:
               // Bunny Propaganda" (promo-47.html) — the ordinary word, not
               // this wrestler.
  "Hessian",   // OSW mint (hessian) — caught live wiring into a served UWF
               // roleplay's own unrelated insult ("the biggest embarrassment
               // this family's ever seen since Hessian," love.html) with no
               // connection to this wrestler.
  "Steven Caldera", // an aka for kimbusa (OSW) — caught live wiring into a
               // served UWF promo's own namedrop of a different fed's
               // ("GCW") locker room three years before the OSW mine's own
               // earliest date (promo-152.html); no evidence ties the two,
               // and the coincidence is exactly what the no-auto-merge rule
               // is for.
  "The Hardcore Legend", // an aka for trashcan-man-osw (OSW) — caught live
               // wiring into a served UWF promo's own unrelated epithet for
               // a different wrestler, Killer Dude (promo-617.html).
  "Thunder", // an aka for jimmy-thunder-hayes (UWF) — caught live wiring
               // into promotions/uwf/shows.html's own bare "Thunder & Lightning"
               // (a distinct, already-registered tag team of Chris Thunder
               // and Max Lightning, neither of them this wrestler).
  "Danny", // an aka for danniella-jones (OSW) — caught live wiring into a
               // dozen-plus served UWF/WWA promos' own unrelated "Danny"
               // namedrops (Danny Tanner, Danny-Jaye, and others), by far
               // the worst single collision this wave found.
  "The Darkness", // an aka for anna-keyson (OSW) — caught live wiring into
               // served UWF/WWA promos' own unrelated mood-word usage of
               // the phrase, not this wrestler.
  "Mandy", // an aka for amanda-osw (OSW) — caught live wiring into a served
               // WWA promo's own unrelated character of the same name
               // ("Meet Candy and Mandy").
  "Diablo", // COORDINATOR-APPLICATIONS wave mint (diablo-napw, a recurring
               // NAPW competitor) — caught live wiring into WWA's own,
               // unrelated "Diablo Championship" (titles/wwa-diablo.html,
               // promotions/wwa/index.html), turning the title's own bare-word
               // mentions into a false link to this NAPW character. A title
               // name, not a character/unit name, so the ordinary
               // mint-time collision check (against characters.json/
               // units.json) didn't catch it; excluded the moment it was
               // caught.
  "Frank", // UWF lane VII mint (frank-uwf, Dr Franken's second monster
               // creation) — his own literal billed ring name, not just an
               // aka, so this is the widest single collision the campaign
               // has hit: caught live wiring into 9 unrelated served
               // documents across three promotions the moment it was minted
               // — a WWA Frank Sinatra lyric, a WWA wrestler named Frank
               // Erik's, two more incidental WWA "Frank" namedrops, a NAPW
               // promo's own "punny doctor Frank," and four separate
               // unrelated UWF "Frank"s (a deposit-station worker, a
               // bullying kid in a flashback RP, and the owner of "Frank's
               // All Night Gym").
  "Old School", // FAW's own Skipster/Omega Fro stable (old-school-faw) —
               // caught live by the FAW accession's own adversarial regen
               // wiring into 27 unrelated served documents across MWE, OSW,
               // UWF and WWA, every one of them the ordinary English phrase
               // ("old school" wrestling, an old-school promo) rather than
               // this stable.
  "House of Pain", // FAW's own Valentine/Rogue tag team (house-of-pain-faw) —
               // caught the same pass wiring into 19 served UWF and WWA
               // documents, all of them the band or the phrase, none of them
               // this team.
  "New School", // FAW's own Bomber/La Fontaine stable (new-school-faw) —
               // same pass, same disease: an MWE roleplay's own ordinary
               // "new school" usage.
  "The Great One", // a FAW character (the-great-one-faw) — caught wiring into
               // an MWE roleplay's own unrelated use of the epithet.
  "Damien Ryan", // a FAW Extreme Championship challenger (damien-ryan-faw) —
               // caught wiring into three served WWA roleplays that introduce
               // "WWA's new superstar, Damien Ryan", a different character in
               // a different fed with no WWA entity of his own to link to.
               // A multi-word name, so THE BARE-NAME RULE doesn't reach it.
  "The Dark Angel", // PTC New Era RP handoff (2026-08-23): the-dark-angel-
               // ewa-extreme is eWa's own billing, but the phrase is
               // Callisto Bane's own forum rank on PTC's board — it sits in
               // the post header of both her roleplays and is used in-text
               // as an epithet for her in a third. 3 hits sitewide, all 3
               // false, 0 true — no cost to this exclusion.
  "Next Generation", // PTC New Era RP handoff (2026-08-23): next-generation-
               // napw is an NAPW unit, but the sole live hit is "the day I
               // joined Next Generation Wrestling last year" — a fed's own
               // name, not the unit. 1 hit sitewide, 1 false, 0 true.
  // "Wednesday" — a TRAUMA:fighting fighter billed under the weekday itself,
  // which auto-linked into UWF's own "Wednesday Night Universal" across six
  // UWF character captions the moment he was minted (TF accession, 2026-08-23).
  "Wednesday",
  "Alice",    // LOW accession (2026-08-23): alice-low (one line on LOW's own
              // retired-division roster) auto-linked into "Alice Cooper"
              // inside a served LOW roleplay (promotions/low/rp/turning-the-
              // times-ppv.html) — the real musician namedropped in dialogue,
              // not this wrestler.
  "Mad Max",  // LOW accession (2026-08-23): mad-max-low (one line on LOW's
              // own February 2003 roster) auto-linked into an NFW roleplay's
              // own joke, "So are you doing another Mad Max?"
              // (promotions/nfw/rp/the-nfw-east.html) — the film, not this
              // wrestler.
  "Viper",    // LOW continuation, second lane (2026-08-23): viper-low (one of
              // three men in CATASTROPHIC's Realm Championship handicap
              // match) auto-linked into two places it does not belong, both
              // inside LOW's own served roleplays — "Matt's undamaged Viper"
              // (a car) in promotions/low/rp/love-at-first-sight-again.html,
              // and a character called Viper alongside "Bladez" and "Raptor"
              // in a May 2003 Jesse Jamester roleplay
              // (promotions/low/rp/revolution-the-rising-sun.html), eighteen
              // months before LOW's own Viper appears. The Purple Haze class
              // exactly.
  "Dan Logan", // 4WW handoff (2026-08-23): dan-logan-4ww is a single
              // Maelstrom III entrant, but FAW has its own Dan Logan on a
              // roster list (promotions/faw/rp/big-baby-issues-a-challnge-
              // to-the-faw.html, promotions/faw/rp/the-truck-stop.html) and
              // LOW books one in an interfed match
              // (promotions/low/rp/set-up-for-a-stryke-out.html). Verified
              // live: 3 false hits sitewide, 0 true — dan-logan-4ww has no
              // in-text mention on 4WW's own served pages to lose.
  "Ego Trip", // 4WW handoff (2026-08-23): ego-trip-4ww is a unit, but the
              // sole live hit is ordinary English — "this 'Ego Trip' in the
              // flesh" (promotions/mwe/rp/a-spoon-full-of-sugar-helps-
              // reality-go-down.html). Verified live: 1 false hit sitewide,
              // 0 true.
  // "Scott Thomas" was proposed by the same handoff (mwe's own "James Eddie
  // Scott Thomas" substring, 1 false hit) but verified live to ALSO carry a
  // true hit — 4WW's own power-vs-strength.html correctly links
  // scott-thomas-4ww in a match listing. 1 false against 1 true: not
  // excluded, since false does not outnumber true. Not added.
  // "Dark Angel" was proposed by the same handoff for darek-deangelo-4ww
  // (his own registered aka) against 3 false PTC hits and, per the
  // handoff's own accounting, "one correct hit" in
  // promotions/uwf/rp/promo-537.html. Verified live before deciding: the
  // real cost is far larger than that one hit — darek-deangelo-4ww's own
  // "Dark Angel" aka correctly auto-links on ~40 of 4WW's own served
  // roleplays, all of which a blanket EXCLUDE_NAMES entry would also kill,
  // on top of the UWF hit. 3 false against 41+ true: not excluded.
  "Madison",        // ACW's own one-match wrestler; wired into "Madison Square Garden"
  // ---------------------------------------------------------------------
  // THE RSPWF TOP 200 ACCESSION (2026-08-23). The poll ranked 1,121 distinct
  // wrestlers across seven editions, and minting every one of them put 1,090
  // brand-new linkable names into the index at once — by far the largest
  // single addition this list has ever had to absorb. Every mint is
  // TENURE-LESS (the poll records a fed TAG, never a run this record could
  // date), so it carries an EMPTY promotion set: THE BARE-NAME RULE already
  // blocks a one-word mint on any page that belongs to a promotion, and the
  // multi-word ones link there only on an exact full-name match, which is the
  // graph working. What the bare-name rule does NOT cover is a CAPTION (which
  // has no page context of its own) or a context-less generated register, and
  // that is where these forty-seven were caught.
  //
  // Caught the way this list requires — a real false positive, verified, never
  // a preemptive guess: before a single mint shipped, every candidate name was
  // run against the exact surfaces the linker walks (all 2,642 captions on
  // file plus all 474 curated pages) with the linker's own word-boundary rule.
  // Forty-seven produced a hit; every hit was read; every one of them is
  // ordinary prose, another character's own finisher or nickname, a PPV or
  // roleplay title, or a document label in a generated register — 288 false
  // links in one regen if left in. The other 1,043 mints produced no hit at
  // all and are linkable exactly as normal.
  "Assassin",          // RSPWF Top 200 mint — wired into Ashley Ward's own "The Assassin" billing
  "Bane",              // RSPWF Top 200 mint — wired into Callisto Bane / Lexis Bane's own captions across the DWO
  "Blue",              // RSPWF Top 200 mint — wired into Blue Chip, Blue Rogues, and the UVA Blue Chipper
  "Brass Knuckles",    // RSPWF Top 200 mint — a 4WW roleplay title of exactly that name
  "Candyman",          // RSPWF Top 200 mint — wired into The Candyman's own reign row
  "Creed",             // RSPWF Top 200 mint — wired into a show title in the generated year register
  "Crimson",           // RSPWF Top 200 mint — wired into Crimson Warrior, Crimson Mask, and the Crimson Dance card
  "Crisis",            // RSPWF Top 200 mint — roleplay titles in the generated year registers
  "Daddy",             // RSPWF Top 200 mint — ordinary prose
  "Deliverance",       // RSPWF Top 200 mint — wired into a WWA finisher name
  "Despair",           // RSPWF Top 200 mint — a roleplay title in the generated year register
  "Doomsday",          // RSPWF Top 200 mint — wired into a WWA tag-team reign row
  "EVIL",              // RSPWF Top 200 mint — a roleplay title in the generated year register
  "Fallen Angel",      // RSPWF Top 200 mint — wired into Gabriel's own finisher, the Fallen Angel
  "Fury",              // RSPWF Top 200 mint — ordinary prose and "The Fury" as a moniker
  "Garvin",            // RSPWF Top 200 mint — wired into Jeff Garvin's own caption
  "Gorilla",           // RSPWF Top 200 mint — wired into Raid's own caption
  "Ground Zero",       // RSPWF Top 200 mint — the UWF PPV of exactly that name, on two title ledgers
  "Hero",              // RSPWF Top 200 mint — wired into Pulp Hero, Mang-A-Hero and Rent-A-Hero
  "Holocaust",         // RSPWF Top 200 mint — a roleplay title in the generated year register
  "Icon",              // RSPWF Top 200 mint — ordinary prose and "The Icon Has Arrived", a roleplay title
  "Kain",              // RSPWF Top 200 mint — wired into Azrael Cain and Osyrus's own caption
  "Kodiak",            // RSPWF Top 200 mint — wired into Kevin Kodiak and "Kodiak" Nathan Bedford
  "Lancer",            // RSPWF Top 200 mint — wired into Jak Lancer's own WWA reign row
  "Lightning",         // RSPWF Top 200 mint — wired into Max Lightning and the Thunder & Lightning team
  "Masked Man",        // RSPWF Top 200 mint — wired into The Masked Man's own GIWF reign rows
  "Messiah",           // RSPWF Top 200 mint — ordinary prose and other characters' own monikers
  "Nightmare",         // RSPWF Top 200 mint — wired into Nightmare King, The Nightmare, and finisher prose
  "November",          // RSPWF Top 200 mint — the month, everywhere in the corpus (32 hits, all calendar dates)
  "Outlaw",            // RSPWF Top 200 mint — wired into The Outlaw's own reigns and "The Outlaw" as a moniker
  "Plague",            // RSPWF Top 200 mint — wired into The Plague's own reign rows on three title ledgers
  "Post",              // RSPWF Top 200 mint — wired into roleplay titles — "The Beating Post", "Post-Meltdown"
  "Rampage",           // RSPWF Top 200 mint — wired into the UWF Rampage Championship and roleplay titles
  "Rated X",           // RSPWF Top 200 mint — an MWE roleplay title, "A Rated X Reunion"
  "Reaper",            // RSPWF Top 200 mint — wired into Grim Reaper, Reaper Strain and "The Dark Reaper"
  "Reich",             // RSPWF Top 200 mint — wired into the Fourth Reich, a stable name
  "Renegade",          // RSPWF Top 200 mint — wired into The Renegade's own reign rows
  "Retribution",       // RSPWF Top 200 mint — wired into WWA title-ledger prose
  "Sebastian",         // RSPWF Top 200 mint — wired into Alexander Sebastian Saunders the Third's own name
  "Shrapnel",          // RSPWF Top 200 mint — wired into Johnny Shrapnel's own caption
  "Suicide",           // RSPWF Top 200 mint — wired into UWF's own Sunday Afternoon Suicide show name
  "Survival",          // RSPWF Top 200 mint — ordinary prose and survival-match stipulations
  "The Icon",          // RSPWF Top 200 mint — "The Icon Has Arrived", a FAW roleplay title
  //
  // Five more, caught by the ADVERSARIAL REGEN rather than by that
  // pre-mint sweep — because the sweep walked captions and curated pages and
  // the linker also walks `promotions/*/rp/`, where only `archive/` is
  // fenced. A tenure-less mint has no promotion of its own, so the
  // bare-name rule never fires for it on ANY page, and a two-word name
  // reaches every served roleplay in the collection. (A sixth, "Mike
  // Manson," was excluded here too until the RSPWF wing handoff's own
  // better fix landed: `data/shards/nfw/characters.json`'s Michael
  // Manson now carries "Mike Manson" as an `aka`, so all fourteen hits
  // link to NFW's own commissioner correctly instead of being suppressed.)
  "Deja Vu",            // RSPWF Top 200 mint — 3 hits, the ordinary phrase,
                        // in 4WW, MWE and NFW roleplays.
  "Tommy Danger",       // RSPWF Top 200 mint — 1 hit, a man of that name
                        // walking through a FAW roleplay. Same name, no
                        // shared promotion and nothing to check it against:
                        // an unverified cross-fed match, filed to the handoff
                        // as a review-queue candidate rather than asserted by
                        // a link.
  "Todd Bishop",        // RSPWF Top 200 mint — 1 hit, same shape, same FAW
                        // roleplay.
  "Noah Hanson",        // RSPWF Top 200 mint — 1 hit, a photograph named in a
                        // LOW roleplay. Same shape.
  "Kenny Rock",         // RSPWF Top 200 mint — 1 hit, an ACW roleplay. Same
                        // shape.
  "Unknown",           // RSPWF Top 200 mint — the ordinary word, including title-ledger "Unknown" cells
  "Vigilante",         // RSPWF Top 200 mint — wired into Tony Vigilante's own captions across FAW
  "WAR",               // RSPWF Top 200 mint — wired into FAW is WAR, the show name
  "Zero",              // RSPWF Top 200 mint — wired into Ground Zero, the PPV
  "New Generation",    // WWO accession (lot 0059, 2026-08-25): new-generation-wwo, a
                        // WWO tag team mint. Live false positives in its own adversarial
                        // regen — the ordinary promo phrase "Leader/Hero/Choice of a New
                        // Generation" in three unrelated feds' own roleplays (4WW, ACW,
                        // NFW). No true hit anywhere outside the WWO wing itself.
  "Williams",          // WWA-MD-EARLY-3 (2026-08-28): williams-maximum-overdrive-wwa, a
                        // bare-surname tag-team mint. Live false positive caught in its own
                        // adversarial regen — a bare "Williams" addressing Kade Williams by
                        // surname in a served WWA roleplay (promotions/wwa/rp/the-job-comes-
                        // first-rp3410.html) linked to the new mint instead, one sentence
                        // after "Kade Williams" itself correctly linked to kade-williams. One
                        // of the most common surnames in the whole registry (30+ decorated-aka
                        // soft-warns at mint time); the qualified id stays reachable from
                        // characters.html, it just isn't auto-linked from the bare word.
  "Gravity",           // LCW TIER-3 (2026-08-29): gravity-lcw. Live false positive in the
                        // same adversarial regen this mint was made in — an unrelated ACW
                        // character's own finisher, "Gravity's Deficit Disorder," linked to
                        // this character instead of standing as the physics pun it is.
  "Sickness",          // LCW TIER-3 (2026-08-29): sickness-lcw. Live false positive in the
                        // same regen — an unrelated character's entrance music, "Down with
                        // the Sickness" by Disturbed, linked to this character instead of
                        // standing as the song title it is.
  "Blues Brothers",    // FWF-1992 TIER-3 (2026-08-30): blues-brothers-fwf-1992, a ledger-only
                        // tag team. Live false positive in the same regen — an unrelated MWE
                        // roleplay's own reference to the real comedy duo/band
                        // (promotions/mwe/rp/not-once.html, "the Blues Brothers album...
                        // BRIEFCASE OF BLUES") linked to this character instead of standing
                        // as the real-world namedrop it is.

  // OBW TIER-3 (2026-08-30): two live false positives caught in this regen.
  "Ryan Daniels",      // ryan-daniels-obw, a thin mint (one of four wrestlers who jumped
                        // MVP Lux). Live false positives — three MWE roleplays
                        // (promotions/mwe/rp/payback-is-a-b-tch.html,
                        // raging-devil-equals-imminent-death.html,
                        // reflection-in-the-fire.html) have their own "Leon" bragging about
                        // beating a Ryan Daniels in a defunct fed called GWC, unrelated to
                        // OBW and with no receipt joining the two namesakes.
  "Hardcore Heaven",   // hardcore-heaven-obw, a Hall of Fame inductee (class of 2008), name
                        // only. Live false positive in the same regen — xwf-uwow's own wing
                        // page names "Hardcore Heaven" as one of the real WCW pay-per-view
                        // names its own scripts drew from, not this OBW inductee.
  "Jersey",             // jersey-obw, a thin mint (Snickers's boyfriend). Live false positives
                        // across ten unrelated character pages whose own captions say "New
                        // Jersey" — the US state, not this wrestler.
  "Genesis",            // genesis-obw, Manny Fresh's OBW stable. Live false positives on
                        // several unrelated MWE/GIWF character captions naming a real album,
                        // event, or the Biblical book, none of them this stable.
  "Armageddon",         // an aka of mike-solomon-obw. Live false positives on several
                        // unrelated feds' own supershow names ("Night of Armageddon", "Autumn
                        // of Armageddon", "Masters of Armageddon") — a common wrestling
                        // event name, not this wrestler.
  "Nathan",             // nathan-obw, a Hall of Fame inductee. Live false positive — an
                        // unrelated WWA character's own caption uses "Nathan" as an ordinary
                        // first name, not this inductee.
  "Eagle",              // eagle-obw, a Hall of Fame inductee. Live false positive — an
                        // unrelated WWA character's own caption uses "Eagle" as an ordinary
                        // word/nickname element, not this inductee.
  "T-Rex",              // t-rex-obw, a roster-page mint. Live false positive — WICeW's own
                        // t-rex-wicew caption ("billed under the name T-Rex") linked to this
                        // OBW entity instead of standing as its own subject's own name.
  "Velvet",             // velvet-obw, a Vixens 2.0/title-holder mint. Live false positive —
                        // WWA's own velvet-wwa caption self-referentially linked to this OBW
                        // entity instead of standing as its own subject's own name.
  "Tiffany",            // tiffany-obw, a title-ledger opponent. Live false positive — an
                        // unrelated CSWA character's own caption uses "Tiffany" as an ordinary
                        // first name, not this wrestler.
  "Bubbles",            // bubbles-obw, a Party Girls mint. Live false positive — NAPW's own
                        // lady-sparks caption ("under the name Bubbles") self-referentially
                        // linked to this OBW entity instead of standing as its own subject's
                        // own aka.

  // MWE TIER-3 QA (2026-08-31, the workshop's mwe-tier3-2026-08-31.md's own
  // handoff): two idiomatic/pop-cultural names caught wiring MWE's 629
  // served roleplays into unrelated registered entities by bare-name
  // collision, verified against every served page in the museum (not just
  // MWE's own) before exclusion, including confirming each name resolves to
  // exactly ONE registered entity sitewide — "The Machine", "Grim Reaper",
  // and "El Dorado" all turned out to be held by 2+ DIFFERENT entities in
  // different wings (the-machine-faw + the-machine-xcwf + steve-cowan-mwe's
  // own aka; grim-reaper + the-grim-reaper-cswa's own aka; el-dorado +
  // el-dorado-rspwf), so those three are handled per-page in EXCLUDE_LINKS
  // below instead — a sitewide bar would have also silenced whichever OTHER
  // entity's own promotion-narrowed caption legitimately uses the same name
  // (caught live: apocolypse-xcwf's and doctor-slice-cswa's own captions,
  // first regen of this pass, before this split).
  // UWF-UWOW PORTRAYAL BATCH (coordinator, 2026-08-31, v78(b): "the bare
  // name lives permanently in EXCLUDE_NAMES" for every real wrestler a
  // held fed booked as a portrayal). 111 real-person names minted as
  // uwf-uwow portrayals at its tier-3 pass — added in one batch at merge
  // so the first post-merge regen could not spray cross-wing false links
  // (see digests/uwf-uwow-tier3-2026-08-31.md, "Deliberately out of
  // scope"). Qualified ids keep linking within their own promotion.
  "Afa",
  "Akebono",
  "Alex Wright",
  "Andre the Giant",
  "Austin Aries",
  "BG James",
  "Baby Doll",
  "Bastien Booger",
  "Bertha Faye",
  "Big Boss Man",
  "Billy Kidman",
  "Booker T",
  "Bret \"Hitman\" Hart",
  "Brian Christopher",
  "Brian Pillman",
  "Brother Devon",
  "Brother Love",
  "Brother Ray",
  "Butch Reed",
  "Chris Harris",
  "Christy Hemme",
  "Colonel Robert Parker",
  "Damien Demento",
  "Dave Batista",
  "Davey Boy Smith",
  "David Taylor",
  "Debra McMichael",
  "Diamond Dallas Page",
  "Doink the Clown",
  "Dustin Rhodes",
  "Dusty Rhodes",
  "Earthquake",
  "Eric Young",
  "Faarooq",
  "Fatu",
  "Gerald Brisco",
  "Giant Bernard",
  "Haiti Kid",
  "Haku",
  "Harry Smith",
  "Harvey Wippleman",
  "Hercules Hernandez",
  "Hornswoggle",
  "IRS",
  "Iron Sheik",
  "Ivory",
  "Jackie Moore",
  "Jazz",
  "Jerry Lawler",
  "Jesse \"The Body\" Ventura",
  "Jim Duggan",
  "Jim Neidhart",
  "John Heidenreich",
  "Johnny Grunge",
  "Kenny Dykstra",
  "Kimberly Page",
  "King Kong Bundy",
  "Kip James",
  "Larry Zbyszko",
  "Lord Littlebrook",
  "Lou Albano",
  "MVP",
  "Madusa Miceli",
  "Magnum TA",
  "Matt Morgan",
  "Mike Awesome",
  "Molly Holly",
  "Monty Brown",
  "Mr. Fuji",
  "Nathan Jones",
  "One Man Gang",
  "Pat Patterson",
  "Paul Orndorff",
  "Paul Roma",
  "Paul Wight",
  "Rhyno",
  "Rick Martel",
  "Ricky Morton",
  "Robert Gibson",
  "Robert Rude",
  "Rocco Rock",
  "Ron Simmons",
  "Sable",
  "Sabu",
  "Samu",
  "Scott Hall",
  "Scott Taylor",
  "Shane McMahon",
  "Shark Boy",
  "Shawn Daivari",
  "Sheik Adnan El Kaisse",
  "Sky Low Low",
  "Stephanie McMahon",
  "Taka Michinoku",
  "Tammy Sytch",
  "Terri Power",
  "Terri Runnels",
  "Terry Funk",
  "The Godfather",
  "Tina Morretti",
  "Trevor Murdoch",
  "Typhoon",
  "Tyson Tomko",
  "Umaga",
  "Undertaker",
  "Val Venis",
  "Vince Russo",
  "Virgil",
  "Wendy Richter",
  "Woman",
  "Yokozuna",
  // WCCW PORTRAYAL BATCH (coordinator, 2026-08-31, v78(b)): four real
  // wrestlers minted as wccw portrayals at its tier-3 pass.
  "Mitsuharu Misawa",
  "Toshiaki Kawada",
  "Roddy Piper",
  "Dan Severn",
  // AGW REAL-NAME BATCH (coordinator, 2026-08-31, v78(b)): AGW's own
  // ledger bills real-wrestler names (minted original-with-identity-notes
  // by its tier-3 lane); their bare names were live-regressing 16 other
  // wings' pages until this batch (digests/agw-tier3-2026-08-31.md).
  "Bill Goldberg",
  "Bret Hart",
  "Dean Malenko",
  "Kris Kanyon",
  "Rick Steiner",
  "William Regal",
  // ICWC PORTRAYAL BATCH (coordinator, 2026-08-31, v78(b)): 113 real
  // wrestlers minted as icwc portrayals at its tier-3 pass; bare names
  // guarded in the same merge (digests/icwc-tier3-2026-08-31.md).
  "\"Mr. Wonderful\" Paul Orndorff",
  "Aja Kong",
  "Akeem",
  "Akira Hokuto",
  "Al Snow",
  "Andrew \"The Punisher\" Martin",
  "Barbarian",
  "Big Bossman",
  "Big Daddy V",
  "Big Van Vader",
  "Billy Gunn",
  "Blue Meanie",
  "Bobby Lashley",
  "Brian Knobbs",
  "Brutus Beefcake",
  "Buff Bagwell",
  "Cactus Jack",
  "Chavo Guerrero Jr.",
  "Chris Candido",
  "Crush",
  "D-Lo Brown",
  "David \"Squire\" Taylor",
  "Disco Inferno",
  "Dynamite Kid",
  "Elix Skipper",
  "Eugene",
  "Fit Finlay",
  "Gangrel",
  "Godfather",
  "Great Khali",
  "Greg Valentine",
  "Hakushi",
  "Honky Tonk Man",
  "Hurricane Helms",
  "Insane Boogeyman",
  "Ivan Koloff",
  "Jacques Rougeau",
  "Jake \"The Snake\" Roberts",
  "Jerry Sags",
  "Jim \"Hacksaw\" Duggan",
  "Jim \"The Anvil\" Neidhart",
  "Johnny B. Badd",
  "Judas Mesias",
  "Jushin Thunder Liger",
  "Kevin Nash",
  "Kofi Kingston",
  "Lance Storm",
  "Luna Vachon",
  "Mark Henry",
  "Meng",
  "Mikey Whipwreck",
  "Mr. Kennedy",
  "Nikita Koloff",
  "Owen Hart",
  "Perry Saturn",
  "Pierre Ouellette",
  "Randy Savage",
  "Raven",
  "Ravishing Rick Rude",
  "Rey Mysterio",
  "Road Dogg Jesse James",
  "Rob Van Dam",
  "Ron Killings",
  "Samoa Joe",
  "Sandman",
  "Santino Marella",
  "Senshi",
  "Sgt. Slaughter",
  "Sid Vicious",
  "Sika",
  "Smash",
  "Sonjay Dutt",
  "Steve Corino",
  "Stevie Ray",
  "Tank Abbott",
  "Tazz",
  "Ted DiBiase Jr.",
  "Tommy Dreamer",
  "Ultimo Dragon",
  "Warlord",
  "X-Pac",
  // XWF-UWOW PORTRAYAL BATCH (coordinator, 2026-08-31, v78(b)): real names
  // from xwf-uwow's 85 portrayal mints, guarded at merge. "Victoria"
  // deliberately NOT excluded: victoria-rawf is an ORIGINAL character
  // (Victor Synn's sister, no portrayal fields) whose own wing legitimately
  // auto-links the bare name — the multi-entity EXCLUDE_LINKS rule applies
  // if an XWF-side false anchor ever surfaces.
  "Bob Backlund",
  "Paul Bearer",
  "Percy Pringle",
  "Gary Hart",
  "Masahiro Chono",
  "The Great Muta",
  "Great Muta",
  "Rene Dupree",
  "Sylvan Grenier",
  "Scott Norton",
  "Debbie Malenko",
  "Michael P.S. Hayes",
  "Jimmy Garvin",
  "Terry Gordy",
  "Mike Tenay",
  "Don West",
  "Jeremy Borash",
  "Donald Trump",
  "Boris Zhukov",
  "Classy Freddie Blassie",
  "Freddie Blassie",
  "Frenchy Martin",
  "\"Superstar\" Billy Graham",
  "Billy Graham",
  "Tito Santana",
  "Outback Jack",
  "Mike Rotundo",
  "Paul Burchill",
  "Katie Lea Burchill",
  "Todd Grisham",
  "Kim Chee",
  "The Grand Wizard",
  "Cowboy Bob Orton",
  "Bob Orton",
  "El Gigante",
  "Henry Godwinn",
  "Phineus Godwinn",
  "Hillbilly Jim",
  "Ken Shamrock",
  "Bryan Danielson",
  "Harley Race",
  "Nikolai Volkoff",
  "Hernandez",
  "Precious",
  "Kamala",
  "Ax",
  "Chyna",
  "Layla",
  // UWOW guard batch (the workshop's uwow-tier3-2026-08-31.md): 104 real-wrestler
  // portrayal bare names; "Victoria" skipped (victoria-rawf original, standing exception)
  "Abdullah the Butcher",
  "Abyss",
  "Adrian Adonis",
  "Adrian Street",
  "Alex Shelley",
  "Alpha Male",
  "American Dragon",
  "Amy Dumas",
  "Andrew Martin",
  "Andy Kaufman",
  "Arn Anderson",
  "Awesome Kong",
  "Bad News Brown",
  "Bam Bam Bigelow",
  "Barry Windham",
  "Batista",
  "Big John Studd",
  "Bobby \"The Brain\" Heenan",
  "Bobby Eaton",
  "Brent Albright",
  "Bruno Sammartino",
  "Bull Nakano",
  "Bushwhacker Butch",
  "Bushwhacker Luke",
  "Captain Lou Albano",
  "Chris Benoit",
  "Chris Sabin",
  "Christian Cage",
  "Curt Hennig",
  "Dick the Bruiser",
  "Dino Bravo",
  "Don Muraco",
  "Dump Matsumoto",
  "Fabulous Moolah",
  "Francine",
  "Gail Kim",
  "George \"The Animal\" Steele",
  "Giant Baba",
  "Greg \"The Hammer\" Valentine",
  "Hacksaw Jim Duggan",
  "Howard Finkel",
  "Irwin R. Schyster",
  "JBL",
  "Jackie Fargo",
  "Jacqueline Moore",
  "Jacques",
  "Jamie Noble",
  "Jay Lethal",
  "Jeff Jarrett",
  "Jesse Ventura",
  "Jim Cornette",
  "Jimmy Hart",
  "Jimmy Snuka",
  "Junkyard Dog",
  "Justin Credible",
  "Kevin Sullivan",
  "Killer Kowalski",
  "Koko B. Ware",
  "Konnan",
  "Kurt Angle",
  "Lisa Morretti",
  "Little Beaver",
  "Mae Young",
  "Magnus Hassan",
  "Masa Chono",
  "Maxx Payne",
  "Mean Gene Okerlund",
  "Melina",
  "Miss Brooks",
  "Miss Elizabeth",
  "Missy Hyatt",
  "Natalya Neidhart",
  "Nick Bockwinkel",
  "Nora Greenwald",
  "Norman the Lunatic",
  "Petey Williams",
  "Pierre",
  "Rena Mero",
  "Rene Dupre",
  "Rhonda Singh",
  "Ric Flair",
  "Rick Rude",
  "Ricky Steamboat",
  "Road Warrior Animal",
  "Road Warrior Hawk",
  "Rowdy Roddy Piper",
  "Shane Douglas",
  "Sharmell",
  "Sheik Adnan el Kaisse",
  "Sheik Daivari",
  "Sherri Martel",
  "Stan Lane",
  "Superstar Billy Graham",
  "Terri",
  "The Crusher",
  "Tomko",
  "Tony Clifton",
  "Tony Schiavonie",
  "Tor Kamata",
  "Tully Blanchard",
  "Ultimate Warrior",
  "Vampiro",
  "Verne Gagne",
  "Yoshihiro Tajiri",
  // NEWF guard batch (the workshop's newf-tier3-2026-08-31.md): 5 portrayal bare names; skipped (original bearers exist): Syxx
  "Bolo Yeung",
  "Brooklyn Brawler",
  "Duncan MacLeod",
  "Silkk the Shocker",
  "Total Package",
  // RSWA guard batch (the workshop's rswa-tier3-2026-08-31.md): 27 portrayal bare names
  "\"Cowboy\" Bill Watts",
  "\"Dr. Death\" Steve Williams",
  "Al Perez",
  "Austin Idol",
  "Bill Dundee",
  "Bruiser Brody",
  "Carlos Col\u00f3n",
  "Chris Von Erich",
  "Dan Spivey",
  "David Von Erich",
  "Dick Murdoch",
  "Dory Funk Jr.",
  "Eddie Gilbert",
  "Fritz Von Erich",
  "Greg Gagne",
  "John Studd",
  "Ken Patera",
  "Kerry Von Erich",
  "Kevin Von Erich",
  "Michael Hayes",
  "Mike Von Erich",
  "Ray Stevens",
  "Stan Hansen",
  "The Genius",
  "The Original Sheik",
  "Tommy Rich",
  "Wahoo McDaniel",
  // Dreamcard guard batch (the workshop's dreamcard-tier3-2026-08-31.md): 8 portrayal names
  // (skipped, original bearers exist: "Mr. Perfect" aka of euwc-perfect-pugilest;
  //  "Steve Armstrong" = steve-armstrong-glw — full-phrase collision check, Victoria class)
  "Jushin \"Thunder\" Liger",
  "Nature Boy",
  "Ronnie Garvin",
  "Rugged Ronnie Garvin",
  "Sid Justice",
  "The Ultimate Warrior",
  "The Undertaker",
  "Young Pistol Steve Armstrong",
  // CZWF-2005 guard batch (the workshop's czwf-2005-tier3-2026-08-31.md): 1 portrayal names/akas
  "Ministry Undertaker",
  // ZWF guard batch (the workshop's zwf-tier3-2026-08-31.md): 2 portrayal names/akas
  "Jerry Lynn",
  "Lillian Garcia",
  // WCOTW guard batch (the workshop's wcotw-tier3-2026-08-31.md): 18 portrayal names/akas (incl. musicians); skipped (original bearers): Mystikal, Saturn, Warrior
  "Bad Ass",
  "Bad Ass Billy Gunn",
  "Bradshaw",
  "Buff",
  "C-Murda",
  "Crimson Beast Kane",
  "Diesel",
  "Flesh-n-Bone",
  "Glacier",
  "Goldberg",
  "Krayzie Bone",
  "Layzie Bone",
  "Mankind",
  "Silkk",
  "Steve Austin",
  "Taz",
  "The Giant",
  "Vinnie Vegas",
  // UBF guard batch (the workshop's ubf-tier3-2026-08-31.md): 1 portrayal names/akas
  "Mr. Ass",
  // UWL guard batch (the workshop's uwl-tier3-2026-08-31.md): 5 portrayal names/akas
  "\"Big Poppa Pump\" Scott Steiner",
  "\"Heartbreak Kid\" Shawn Michaels",
  "\"The Human Suplex Machine\" Taz",
  "\"The Man of a Thousand Holds\" Dean Malenko",
  "Hunter Hearst Hemsley",
  // MFF guard batch (the workshop's mff-tier3-2026-08-31.md): 18 fictional-canon portrayal names; skipped (original bearers): Blizzard, Deadpool, Nightcrawler, Spawn
  "Anthilus",
  "Black Bolt",
  "Cable",
  "Cannonball",
  "Dare Devil",
  "Daredevil",
  "Dead Pool",
  "Deathlok",
  "GW Bridge",
  "Mighty Thor",
  "Night Crawler",
  "Red Tornado",
  "Red Tornato",
  "Stryfe",
  "Terrax",
  "Thor",
  "Weapon X",
  "Weapon-X",
  "Chris Williams",     // MEMORIAL GUARD (coordinator, 2026-08-31): "Chris Williams"
                        // (d. 1999) is one of the museum's seven memorialized people
                        // (the clacks). The gwf-2006 crawl minted a fictional
                        // chris-williams-gwf whose bare name would otherwise auto-link
                        // memorial prose on promotions/4ww/index.html and
                        // promotions/uwf/rp/promo-513.html to a fictional wrestler.
                        // The name NEVER auto-links; the fictional character keeps his
                        // links via structured rows only. See
                        // digests/gwf-2006-tier3-2026-08-31.md (Incidents).
  "Twisted Metal",      // twisted-metal-osw (OSW's own billed-robots stable), the ONLY
                        // registered entity with this exact name. The 1 live anchor named
                        // the PS2 video game in a list with Smackdown vs. Raw and Guitar
                        // Hero (promotions/mwe/rp/hell-in-a-hand-basket.html).
  "The Masked Man",     // the-masked-man (GIWF/UWF), the ONLY registered entity with this
                        // exact name. The 1 live anchor was an unnamed, in-story mugger
                        // given "Masked Man:" as his own speaker tag within the same MWE
                        // roleplay (promotions/mwe/rp/how-criminal-is-it.html) — a bit
                        // character invented for that scene, not GIWF's wrestler.
  // PWE-BOARD GUARD BATCH (coordinator, 2026-09-02; receipts in
  // the workshop's tpg-tier3-2026-09-02.md §7a and
  // the workshop's guard-batch-2026-09-02.md). Two bare surnames The Proving
  // Grounds' own booking sheet gives and never expands. Both re-verified
  // against a full regen on this branch BEFORE the entries were written:
  // NEITHER id has a single genuine prose or caption auto-link anywhere in the
  // museum, which is what makes the sitewide instrument the right one here
  // (contrast "Todd" below, which does have one and is therefore scoped).
  "Regal",              // regal-tpg. 11 false anchor pages + their register mirrors, every
                        // one a longer real name the linker split: "William Regal"
                        // (characters/the-undertaker-faw.html, ethan-williams-owa.html,
                        // jo-hardy-agw.html, hhh-faw.html, david-taylor-uwf-uwow.html),
                        // "Lord Stephen Regal" (william-regal-agw.html), and UWF's own
                        // annual "Regal Rumble" (championships.html, blaze.html,
                        // jason-christy-uwf.html, smokey-weed-uwf.html, tsunami-oni.html).
  "Helms",              // helms-tpg. 6 false anchor pages + register mirrors, all the same
                        // split: "Matt Helms" (characters/keyser-soze-chz.html,
                        // jt-fringe-chz.html, chazzy-2-cool-chz.html), "Brian Helms"
                        // (frankie-kazarian-pwe-inc.html, jbl-pwe-inc.html) and
                        // "Shane Helms" (hawk-icw-pweboard.html).
  // EBWF PORTRAYAL BATCH (coordinator, 2026-09-27, v78(b)): EBWF (ebwf-2001) is a real-wrestler fed; its roster
  // wave (wave-WSO-EBWF-D1) mints 108 portrayals and 4 portrayal units. These are the 41 of their names and akas
  // not already here, added in one batch at merge (the UWF-UWOW batch's shape). Qualified ids keep linking
  // within their own promotion.
  "Arik Cannon",
  "Bubba Ray Dudley",
  "Carlito",
  "Chris Hero",
  "D'Von Dudley",
  "DDP",
  "Daffney",
  "David Flair",
  "E & C",
  "Ernest Miller",
  "Evan Karagias",
  "HHH",
  "Joey Mercury",
  "Johnny Stamboli",
  "Julio Dinero",
  "Kanyon",
  "Karen Angle",
  "Mark Jindrak",
  "Mick Foley",
  "Midajah",
  "Miss Jackie",
  "New Jack",
  "Nick Mondo",
  "Rey Mysterio Jr.",
  "Scotty 2 Hotty",
  "Sean O'Haire",
  "Shannon Moore",
  "Simon Dean",
  "Sonny Siaki",
  "Stevie Richards",
  "Sunny",
  "Syxx",
  "The APA",
  "The Brothers of Destruction",
  "The Dudley Boys",
  "The Hurricane",
  "The Kat",
  "The Road Dogg",
  "Trinity",
  "Victoria",
  "Y2J Chris Jericho",
  // hook c149 (2026-10-08, LINK-FIX-1): the seven first-name-only fWo records (mike-, steve-, kevin-, john-, matt-, eddie-,
  // jake-fwo-1998). Inside the fWo wing a bare first name narrowed to the stub, so the linker wrapped the first word of
  // "Mike Bear", "Kevin MacKay" and every other "<First> <Surname>" on 306 served pages. A bare first name is too common to
  // auto-link safely (the "Jack" class). By name: a bare first name of any wing stops auto-linking; baked anchors stay.
  "Mike", "Steve", "Kevin", "John", "Matt", "Eddie", "Jake",
]);

// ---------------------------------------------------------------------------
// EXCLUDE_LINKS — the per-page companion to EXCLUDE_NAMES (MWE TIER-3 QA,
// 2026-08-31). EXCLUDE_NAMES bars a name sitewide, which is wrong for a name
// that legitimately auto-links SOMEWHERE (a real cross-registry entity's own
// promotion, a portrayal's own wing) but collides falsely on one specific
// OTHER page — barring it globally would kill the true link along with the
// false one. This is that surgical alternative: a {page, name} pair means
// "this exact registered name must not auto-link on this exact page,"
// leaving every other page's use of the name (including the genuine one
// that justified not using EXCLUDE_NAMES) untouched. `page` is the file's
// path relative to the repo root, exactly as `relative(ROOT, file)` produces
// it. Keep tiny and receipted, same discipline as EXCLUDE_NAMES.
function excludedOnPage(rel, name) {
  return EXCLUDE_LINKS.has(`${rel}::${name}`);
}

// ---------------------------------------------------------------------------
// REVIEWED ALLOWLIST — the common-first-name/common-word linkability audit
// (PERFECTION WAVE A, audited 2026-08-21, Janitor-directed). The registry
// carries roughly 365 single-token (no-space) linkable names/akas across
// characters.json + units.json that AREN'T already in EXCLUDE_NAMES above.
// Of those, every one that reads as a COMMON ENGLISH FIRST NAME or an
// ordinary English word — the exact shape every entry above turned out to
// be — was pulled out (74 candidates: ~32 first names — Amanda, Bailey,
// Bethany, Bubba, Cain, Clyde, Dante, Duke, Elijah, Esteban, Gabriel,
// Gabrielle, Giovanni, Gregory, Greta, Joanna, Kate, Khaled, Maurice, Mikey,
// Misty, Rick, Samson, Sandman, Sara, Shawn, Sheri, Solomon, Teddy, Tiffani,
// Violet, Winter; ~42 common words — Alien, Armour, Bigfoot, Blaze, Bubbles,
// Chaos, Clearance, Coma, Dynamite, Evil, Freestyle, Freeze, Hammer, Juice,
// Lockdown, Memory, Monkey, Overkill, Predator, Psycho, Raid, Roadkill,
// Sacrifice, Scars, Showtime, Skull, Slasher, Sniper, Spike, Static, Steel,
// Surge, Switchblade, Tank, Toxic, Trapper, Tremor, Venom, Vicious, Wanderer,
// War) and hand-audited: every actual `data-entity="<id>"` anchor the bare
// name currently produces across the generated, curated (non-verbatim) site
// was grepped and read in context — the same "diff every file the toolchain
// touches" discipline `docs/PROCESS.md`'s EXCLUDE_NAMES hand-audit law
// already prescribes, run as a batch sweep instead of waiting for a live
// incident. Verdict, all 74: **ALLOW.** Every live hit found points at the
// correct, already-disambiguated entity — a bare name shared across two+
// entities (Dante/dante-xuw, Chaos/chaos-wwa, Sniper, Sandman) resolves
// correctly via the existing promotion-context narrowing (nameIndex above),
// never wired cross-promotion; no ordinary-English-sentence false positive
// (the "Nobody"/"Purple Haze"/"Frank" shape above) turned up anywhere in
// this batch. Several candidates (Amanda, Esteban, Gabrielle, Greta, Joanna,
// Kate, Misty, Sara, Teddy, Tiffani, Violet, Winter, Samson, Armour, Juice,
// Memory, Predator, Roadkill, Skull, Static, Tremor, Wanderer, among others)
// currently produce ZERO auto-link hits anywhere in the corpus — nothing to
// audit, and per the standing EXCLUDE_NAMES doctrine ("a name goes on the
// list... the moment a real false positive is caught — never preemptively,
// never 'just in case'") a zero-hit name is left alone, not pre-excluded on
// spec. The remaining ~291 not-yet-excluded single-token names/akas outside
// this candidate set (Bahamut, Cerberus, Xaeroh, Kata, L.U.C.A.B.O.T.,
// Krenshov, and the like) are wrestling-gimmick coinages, invented words, or
// acronyms — not common English first names or common words — and fall
// outside this audit's own scope by the Janitor's own framing.
//
// THE "JAY" HOT CASE, resolved. Bare "Jay" is the audit's own named test
// case: in ordinary prose across this corpus it overwhelmingly means Jay
// Phoenix (GIWF/IWF), but the registry's own bare-token "Jay" belongs to
// two DIFFERENT, unrelated entities — `jay-uwf` and `jay-xuw`, both
// literally named just "Jay," neither of them Jay Phoenix (whose own
// display name, "Jay Phoenix," is two tokens and was never itself a
// candidate here). "Jay" was already caught and excluded above (the XUW
// wave, jay-xuw) before this audit began; reconfirmed here rather than
// re-litigated: it stays excluded (a wrong link — sending "Jay" to a thin
// UWF or XUW undercard entry when the surrounding prose means Jay Phoenix —
// is worse than a missing one), and the pre-existing exclusion already
// covers both colliding entities, not just the one it names.
// ---------------------------------------------------------------------------

// Longer PHRASES (not bare entity names) that are known 100%-false-positive
// contexts for a shorter registered name/aka they happen to contain as a
// substring — a finer-grained sibling to EXCLUDE_NAMES above. EXCLUDE_NAMES
// removes a bare name from the index entirely, killing every link to that
// entity everywhere (the right call when the bare word itself is noise, or
// when true positives are rare/nonexistent); EXCLUDE_ALIASES instead keeps
// the bare name linkable everywhere EXCEPT inside one of these specific
// longer phrases, for the case where the bare name has real true-positive
// mentions elsewhere that a blanket EXCLUDE_NAMES entry would also kill.
// Checked at match time by insideExcludedAlias() below, in both places
// bigRe.replace() resolves a match (curated-page prose and captions).

// True when the bigRe match at `offset` (length `matchLen`) in `haystack`
// falls entirely inside one of EXCLUDE_ALIASES' own longer phrases — i.e.
// the match is real substring-wise but is actually naming the phrase's own
// (unrelated) thing, not the shorter entity name it happens to contain.
function insideExcludedAlias(haystack, offset, matchLen) {
  for (const phrase of EXCLUDE_ALIASES) {
    let idx = haystack.indexOf(phrase);
    while (idx !== -1) {
      if (offset >= idx && offset + matchLen <= idx + phrase.length) return true;
      idx = haystack.indexOf(phrase, idx + 1);
    }
  }
  return false;
}

function addName(name, id, promos) {
  if (!name || name.length < 3) return; // skip 1-2 char names, too noisy
  // GCW-NAMELESS-0929: a name with no letter or digit ("????", "???", "----") is punctuation, never a name to find in prose. Without
  // this the linker linked every "????"/"???" (and any run of question marks, since the lookarounds only exclude alphanumerics)
  // to the placeholder record: five GCW roleplay dates, two EWA pages, and PURE/WWA title pages.
  if (!/[\p{L}\p{N}]/u.test(name)) return;
  if (EXCLUDE_NAMES.has(name)) return;
  const list = nameIndex.get(name) ?? [];
  list.push({ id, promos });
  nameIndex.set(name, list);
}
for (const e of entities) {
  // Promotion-context narrowing uses the same broadened, derived set (see
  // derivedPromoIds above) — an entity with only a PTC-show cameo and no
  // PTC tenure still narrows correctly when a PTC page mentions their name.
  const promos = new Set(derivedPromoIds(e));
  addName(e.name, e.id, promos);
  for (const a of e.aka ?? []) addName(a, e.id, promos);
}

// Names appearing on more than one entity (globally) are candidates for
// context-narrowing or disambiguation.
const allNames = [...nameIndex.keys()].sort((a, b) => b.length - a.length);
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
// THE PIPELINE-SCALING FIX (the Janitor QA, 2026-08-22): one giant alternation
// of every entity name, each branch carrying its own lookbehind/lookahead,
// was 99.6% of the whole pipeline's runtime (463s of 470s, CPU-profiled) —
// V8 runs lookbehind alternations on its slow path, so cost grew as
// pages × entities. bigReFor(text) prefilters with native includes() (a
// fast literal scan) and compiles the precise regex from only the names
// actually present in that text — identical matches, ~100x cheaper, and
// the growth axis drops from pages × all-entities to pages × names-present.
const bigReBranch = new Map(allNames.map((n) => [n, `(?<![A-Za-z0-9])${escapeRe(n)}(?![A-Za-z0-9])`]));
// c82 (lane XREF-FOLLOWUPS, 2026-10-05; the Janitor's D308): THE TRIGRAM
// PREFILTER. `allNames.filter(includes)` was ~1.2 ms a call over ~30,000 names
// and, after c76, most of a full link pass (1,292 s over 1.09 million calls).
// Every name is filed under ONE of its own 3-character substrings (addName
// drops names under 3 characters, so each has one): the substring the fewest
// names share. A name that occurs in the text has all its substrings in the
// text, its filing trigram among them, so scanning the text's trigrams and
// includes()-testing only the names filed under them finds every name the
// full filter finds, and no other (the same includes() test decides).
// Sorting the hits by their index in allNames restores the full filter's
// order exactly. Same `present` list, same regex, same matches, by
// construction; no state survives a call.
const bigReRank = new Map(allNames.map((n, i) => [n, i]));
const bigReTriBuckets = new Map(); // trigram -> names filed under it
{
  const triOf = (n) => { const s = new Set(); for (let i = 0; i + 3 <= n.length; i++) s.add(n.slice(i, i + 3)); return s; };
  const triCount = new Map();
  const tris = allNames.map((n) => triOf(n));
  for (const s of tris) for (const g of s) triCount.set(g, (triCount.get(g) ?? 0) + 1);
  allNames.forEach((n, k) => {
    let best = null, bestC = Infinity;
    for (const g of tris[k]) { const c = triCount.get(g); if (c < bestC) { best = g; bestC = c; } }
    const b = bigReTriBuckets.get(best); if (b) b.push(n); else bigReTriBuckets.set(best, [n]);
  });
}
function bigReFor(text) {
  const present = [];
  const seen = new Set();
  for (let i = 0; i + 3 <= text.length; i++) {
    const g = text.slice(i, i + 3);
    const bucket = bigReTriBuckets.get(g);
    if (!bucket || seen.has(g)) continue;
    seen.add(g);
    for (const n of bucket) if (text.includes(n)) present.push(n);
  }
  if (!present.length) return null;
  present.sort((a, b) => bigReRank.get(a) - bigReRank.get(b));
  return new RegExp(present.map((n) => bigReBranch.get(n)).join("|"), "g");
}

// ---------------------------------------------------------------------------
// 1b. THE CAPTION GRAPH-LINKING WAVE (user gavel: "make sure the captions
// point to everyone else as part of our edge-node graph") — a caption is
// short, hand-vetted prose, but it's still prose, and it names other
// entities and promotions constantly ("Alibaba... Montezuma... the
// Phenomenons," "Corky... UWF... UiWF... NAPW"). Run every caption through
// the SAME entity-name linker as curated page prose (same nameIndex, same
// EXCLUDE_NAMES, same context-narrowing-by-the-entity's-own-promotions
// discipline — a bare mention still left unlinked if it stays ambiguous
// after narrowing), PLUS a second pass linking bare promotion acronyms
// ("UWF", "GIWF", ...) to their own wing — captions are the one place on
// the site that mentions a promotion by bare acronym in free prose outside
// a tenure tag, and they do it constantly.
// ---------------------------------------------------------------------------
// THE SHARED-ACRONYM FIX (eWa accession, 2026-08-22): two held promotions
// can share a bare acronym (ewa-extreme and ewa-empire are both "EWA"); a
// Map keyed on name silently let the last row win, mislinking every bare
// "EWA" in every caption sitewide — including two pre-existing captions
// that meant two OTHER, unheld EWAs. A name held by more than one
// promotion is ambiguous and is left as plain text, the same no-guess
// rule entity names already follow; a promotion is reached by its full
// name or its own page, never by a bare acronym it doesn't own alone.
// ---------------------------------------------------------------------------
// THE PROMOTION-LEVEL aka (the Janitor's gavel, 2026-08-23: "Should GWF just
// be an aka?"). A fed that renamed itself, or styled its own name more than
// one way, is ONE promotion under several labels — and a caption naming it by
// a label that isn't its current registered `name` was, until this, plain
// text. `promotions.json` rows now carry an optional `aka[]`, and every aka
// enters this index on exactly the same terms `name` already does: same
// word-boundary rule, same shared-acronym ambiguity rule below, same "a
// promotion is reached by a label it owns alone, never by one it shares."
//
// `aka_unlinkable[]` (a subset of the row's own `aka[]`) is the one
// exception, and it is the collision doctrine's own posture rendered in
// data: a label the museum has RECORDED but must not ASSERT. GW's own
// former name "GWF" is the founding case — the corpus mentions at least
// three other GWFs (a 2006 fed, a 2002 GeWA franchise, the GWF an early UWF
// bio says split into the WWA), so linking every "GWF" to this wing would
// silently merge four feds on an acronym. See docs/SCHEMA.md's promotions
// section and CURATION.md's v78.
const promoLabelsOf = (p) => {
  const unlinkable = new Set(p.aka_unlinkable ?? []);
  return [p.name, ...(p.aka ?? []).filter((a) => !unlinkable.has(a))].filter(Boolean);
};
const promoNameCounts = new Map();
for (const p of promotions) for (const label of promoLabelsOf(p)) promoNameCounts.set(label, (promoNameCounts.get(label) ?? 0) + 1);
const promoNameIndex = new Map();
for (const p of promotions) {
  for (const label of promoLabelsOf(p)) {
    if (promoNameCounts.get(label) === 1) promoNameIndex.set(label, p);
  }
}
const promoNames = [...promoNameIndex.keys()].sort((a, b) => b.length - a.length);
const promoBigRe = promoNames.length
  ? new RegExp(promoNames.map(escapeRe).map((n) => `(?<![A-Za-z0-9])${n}(?![A-Za-z0-9])`).join("|"), "g")
  : null;
// c76 (lane XREF-PHASES, 2026-10-05; the Janitor's D308): THE CAPTION-PASS
// SCALING FIX — the PIPELINE-SCALING FIX above (bigReFor), applied to the two
// passes it never reached. promoBigRe (~2,200 labels) and titleBigRe (~2,650
// names) are each ONE alternation with a lookbehind on every branch, which V8
// runs on its slow path: measured on the live registry, ~12 ms and ~20 ms per
// caption, and every character/unit caption goes through both TWICE (its A-Z
// register card and its own page) — about 40 of refresh:links' minutes. The
// regex is now compiled per text segment from only the labels that segment
// actually contains (a native includes() scan), in the SAME longest-first
// order. A branch whose literal does not occur in the segment can never match
// at any position, and the surviving branches keep their relative order, so
// every match (position, length, branch chosen) is the one the full
// alternation finds: byte-identical output, by construction. The branches
// carry no capture groups, so the replace callback's (match, offset,
// haystack) arguments are unchanged too. promoBigRe/titleBigRe stay as the
// "any labels at all" guards the two passes already test.
const promoReBranch = new Map(promoNames.map((n) => [n, `(?<![A-Za-z0-9])${escapeRe(n)}(?![A-Za-z0-9])`]));
function promoReFor(text) {
  const present = promoNames.filter((n) => text.includes(n));
  return present.length ? new RegExp(present.map((n) => promoReBranch.get(n)).join("|"), "g") : null;
}

function linkPromosInPlainSegments(html) {
  if (!promoBigRe) return html;
  // Tokenize on tags so a promo acronym that landed INSIDE an <a> the entity
  // pass just created (e.g. a character name that itself contains a promo
  // acronym substring — doesn't happen today, but idempotent-by-construction
  // costs nothing) is never touched, same discipline as the main page walker.
  const segments = html.split(/(<[^>]+>)/);
  let insideA = 0, insideScript = 0;
  return segments.map((seg) => {
    if (seg.startsWith("<")) {
      if (/^<a[\s>]/i.test(seg)) insideA++;
      else if (/^<\/a>/i.test(seg)) insideA = Math.max(0, insideA - 1);
      // SCRIPT GUARD (2026-09-12): never link inside <script>/<style> — an anchor written into a JS
      // string literal killed search.html's whole script for 18 days (found by the Janitor).
      else if (/^<(script|style)[\s>]/i.test(seg)) insideScript++;
      else if (/^<\/(script|style)>/i.test(seg)) insideScript = Math.max(0, insideScript - 1);
      return seg;
    }
    if (insideA || insideScript || !seg) return seg;
    const segRe = promoReFor(seg); // c76: same matches as promoBigRe, see promoReFor
    if (!segRe) return seg;
    return seg.replace(segRe, (match, offset, haystack) => {
      // L199 (entity-page residue sweep, 2026-09-06, ranked #3): the same
      // single-token-fragment guard the entity-link pass already runs --
      // this pass had none at all, which is exactly how "WAR" split out of
      // "Monday Night WAR!fare" and linked to an unrelated promotion
      // (faw-1997) on aderondac-brothers-war-1995.html.
      if (!/\s/.test(match) && (partOfLargerCapitalizedRun(haystack, offset, match.length) || insideLongerQuotedOrParenPhrase(haystack, offset, match.length))) return match;
      const p = promoNameIndex.get(match);
      if (!p || !p.page) return match;
      return `<a href="${esc(p.page)}">${match}</a>`;
    });
  }).join("");
}

// A8 (THE WRESTLER-PAGE TEMPLATE WAVE, the Janitor's catch on Hot Mask's own
// caption: the "Baja Blast Championship Sponsored by Taco Bell" mention
// stayed unlinked plain text): title names get the same bare-mention
// auto-link treatment promotions already have in captions — context-
// narrowed by promotion exactly like an entity mention, since several
// promotions share a generic belt name outright ("World Heavyweight
// Championship" alone names four) — a title name still ambiguous after
// narrowing stays plain, unlinked text, the same no-guess rule entity
// mentions already follow.
const titleNameIndex = new Map(); // name -> [{promotion, page}]
function addTitleName(name, t) {
  if (!name) return;
  const list = titleNameIndex.get(name) ?? [];
  list.push({ promotion: t.promotion, page: t.page });
  titleNameIndex.set(name, list);
}
for (const t of titles) {
  addTitleName(t.name, t);
  for (const a of t.aka ?? []) addTitleName(a, t);
}
// THE PREFIX-COLLISION FIX (2026-08-20, WWA lane VIII catch): a title's own
// registered `name` is often promotion-prefixed ("WWA Extreme
// Championship"), but a page in that title's own promotion routinely drops
// the prefix in prose ("the Extreme Championship") — and when another
// promotion happens to register that exact bare string as ITS OWN title's
// `name` outright (PCW's own "Extreme Championship"), the bare mention
// only ever had ONE candidate in the index (PCW's), so the promotion-
// narrowing below never got a second candidate to narrow BETWEEN and
// silently linked the wrong promotion's title every time. Only registers
// the stripped form when it COLLIDES with an already-registered name from
// another title — this never invents a brand-new match on a page that
// wouldn't otherwise have linked at all, same "no guess, only narrow"
// discipline as everywhere else in this file.
for (const t of titles) {
  const acro = bareAcronym(promoById.get(t.promotion));
  if (!acro || !t.name.startsWith(`${acro} `)) continue;
  const stripped = t.name.slice(acro.length + 1);
  if (stripped && titleNameIndex.has(stripped)) addTitleName(stripped, t);
}
const titleNames = [...titleNameIndex.keys()].sort((a, b) => b.length - a.length);
const titleBigRe = titleNames.length
  ? new RegExp(titleNames.map(escapeRe).map((n) => `(?<![A-Za-z0-9])${n}(?![A-Za-z0-9])`).join("|"), "g")
  : null;
// c76: the per-segment form of titleBigRe — see promoReFor above.
const titleReBranch = new Map(titleNames.map((n) => [n, `(?<![A-Za-z0-9])${escapeRe(n)}(?![A-Za-z0-9])`]));
function titleReFor(text) {
  const present = titleNames.filter((n) => text.includes(n));
  return present.length ? new RegExp(present.map((n) => titleReBranch.get(n)).join("|"), "g") : null;
}

function linkTitlesInPlainSegments(html, contextPromos) {
  if (!titleBigRe) return html;
  const segments = html.split(/(<[^>]+>)/);
  let insideA = 0, insideScript = 0;
  return segments.map((seg) => {
    if (seg.startsWith("<")) {
      if (/^<a[\s>]/i.test(seg)) insideA++;
      else if (/^<\/a>/i.test(seg)) insideA = Math.max(0, insideA - 1);
      // SCRIPT GUARD (2026-09-12): never link inside <script>/<style> — an anchor written into a JS
      // string literal killed search.html's whole script for 18 days (found by the Janitor).
      else if (/^<(script|style)[\s>]/i.test(seg)) insideScript++;
      else if (/^<\/(script|style)>/i.test(seg)) insideScript = Math.max(0, insideScript - 1);
      return seg;
    }
    if (insideA || insideScript || !seg) return seg;
    const segRe = titleReFor(seg); // c76: same matches as titleBigRe, see titleReFor
    if (!segRe) return seg;
    return seg.replace(segRe, (match, offset, haystack) => {
      // L199 (entity-page residue sweep, 2026-09-06, ranked #3): same guard
      // as the promo-link pass just above -- this pass had none either.
      if (!/\s/.test(match) && (partOfLargerCapitalizedRun(haystack, offset, match.length) || insideLongerQuotedOrParenPhrase(haystack, offset, match.length))) return match;
      let candidates = titleNameIndex.get(match);
      if (!candidates) return match;
      if (candidates.length > 1 && contextPromos && contextPromos.size) {
        const narrowed = candidates.filter((c) => contextPromos.has(c.promotion));
        if (narrowed.length >= 1) candidates = narrowed;
      }
      if (candidates.length !== 1) return match;
      return `<a href="${esc(candidates[0].page)}">${match}</a>`;
    });
  }).join("");
}

// ownId: the entity whose OWN caption this is — never self-link. ownPromos:
// that entity's own tenure promotions, used to narrow an ambiguous name
// exactly like promoContext() does for page prose (an entity can span
// several promotions, unlike a single page's own context, so this checks
// "any," not "the one").
// L174 (titles-units-figures QA, 2026-09-06, class 3) -- is `match` (a
// SINGLE token, no internal space; callers only invoke this for a
// single-token match) sitting directly beside another capitalised word?
// If so it reads as one fragment of a longer proper-noun phrase or quoted
// show name ("Monday NIGHT WAR!fare", "Kevin NASH") and should never be
// pulled out and linked on its own -- only the full multi-token name, or a
// genuinely standalone single-token name, is ever a real entity reference.
// Deliberately conservative: only the three sentence-initial ARTICLES
// ("the"/"a"/"an") are excluded from triggering the guard, so a legitimate
// lone-name entity like "Sting" or "Rock" preceded by a sentence-initial
// "The" or "A" is never blocked.
//
// L199 (entity-page residue sweep, 2026-09-06, ranked #3 -- confirmed
// still live at ~4% of all caption entity-links, unchanged since L174):
// two more permissive carve-outs in this same guard were themselves the
// bug, not a false-positive shield.
//   1. Every non-article function word ("and", "of", "vs", ...) was ALSO
//      excluded from triggering -- but a capitalised connector only ever
//      appears capitalised here when it is itself glue INSIDE a longer
//      stylised phrase ("Trial And Error", "Best Of The Best"); ordinary
//      sentence prose never capitalises "and"/"of" mid-sentence. Treating
//      it as harmless let "Error" split out of "Trial And Error" and link
//      to an unrelated character. Narrowed to just the three true
//      sentence-initial articles.
//   2. A short ALL-CAPS adjacent word ("WAR", "II") was exempted outright
//      as presumed "stray acronym noise" -- but a short all-caps word
//      beside the match is exactly as likely to be a stylised fragment of
//      the SAME longer name ("Monday Night WAR!fare", "Maelstrom II") as to
//      be unrelated noise, and the corpus's own confirmed mislinks
//      (aderondac-brothers-war-1995.html's own "WAR", blackjack-4ww.html's
//      own "Maelstrom") are exactly this shape. This carve-out's own
//      comment already hedged "fine to ignore ... skip stray acronym
//      noise" with no real evidence behind it; removed outright rather
//      than re-tuned, since nothing in the sweep showed a genuine false
//      positive it was protecting against.
const CAP_RUN_STOPWORDS = new Set(["the", "a", "an"]);
function partOfLargerCapitalizedRun(haystack, offset, matchLen) {
  const before = haystack.slice(0, offset);
  const after = haystack.slice(offset + matchLen);
  const prevWord = before.match(/([A-Za-z][A-Za-z'’.!-]*)\s*$/);
  const nextWord = after.match(/^\s*([A-Za-z][A-Za-z'’.!-]*)/);
  const isTriggerWord = (w) => {
    if (!w) return false;
    if (!/^[A-Z]/.test(w)) return false; // must itself start uppercase
    return !CAP_RUN_STOPWORDS.has(w.toLowerCase());
  };
  if (prevWord && isTriggerWord(prevWord[1])) return true;
  if (nextWord && isTriggerWord(nextWord[1])) return true;
  return false;
}
// L199 (entity-page residue sweep, 2026-09-06, ranked #3, second half of
// the same fix): a single-token match sitting inside a QUOTED or
// PARENTHESISED span that holds more than just that one word is also a
// fragment of a longer name, not a standalone reference -- the sibling
// half of the task's own restated rule ("...or inside quotes/parentheses
// of a longer name"), distinct from the bare-adjacency check above (no
// adjacent capitalised word is required for this shape -- a quoted phrase
// can open with a lowercase word). Runs against the ESCAPED caption text
// (esc() has already turned a literal `"` into `&quot;` by the time any
// caller reaches this), so the ASCII pair checked is the entity form, not
// the bare character.
const QUOTE_PAREN_PAIRS = [["&quot;", "&quot;"], ["\u201c", "\u201d"], ["(", ")"]];
function insideLongerQuotedOrParenPhrase(haystack, offset, matchLen) {
  for (const [open, close] of QUOTE_PAREN_PAIRS) {
    const before = haystack.slice(0, offset);
    const openIdx = before.lastIndexOf(open);
    if (openIdx === -1) continue;
    if (open === close) {
      const between = before.slice(openIdx + open.length);
      const occurrences = between.split(open).length - 1;
      if (occurrences % 2 !== 0) continue; // already closed before the match
    } else if (before.indexOf(close, openIdx + open.length) !== -1) {
      continue; // already closed before the match
    }
    const closeIdx = haystack.indexOf(close, offset + matchLen);
    if (closeIdx === -1) continue;
    const inner = haystack.slice(openIdx + open.length, closeIdx).trim();
    if (inner.length > matchLen && /\s/.test(inner)) return true;
  }
  return false;
}

function linkCaptionHtml(caption, ownId, ownPromos) {
  if (!caption) return "";
  const escaped = esc(caption);
  const bigRe = bigReFor(escaped);
  const withEntities = !bigRe ? escaped : escaped.replace(bigRe, (match, offset, haystack) => {
    if (insideExcludedAlias(haystack, offset, match.length)) return match;
    // Coordinator, 2026-09-01 (cwf-continental t3): captions render on the
    // entity's own page, so EXCLUDE_LINKS "characters/<ownId>.html::name"
    // entries must suppress here too — previously only curated-page prose
    // consulted excludedOnPage, leaving caption substring collisions
    // (e.g. "Friday Night Blitz" fragments) unsuppressable.
    if (excludedOnPage(`characters/${ownId}.html`, match)) return match;
    // L174 (titles-units-figures QA, 2026-09-06, class 3): a bare
    // single-token name auto-linked out of a longer show/name phrase
    // in caption prose ("Monday Night WAR!fare" linking "Night",
    // "Kevin Nash" linking "Nash") -- the figure-page auto-linker
    // already guards this shape via figureLinkAllowlist() (line 2778);
    // the caption path had no equivalent. Only a single-token match can
    // sit "inside" a longer capitalised run -- a multi-token match like
    // "Kevin Nash" is always the full name, never a fragment of one, so
    // this never touches a resolved multi-word entity name.
    if (!/\s/.test(match) && (partOfLargerCapitalizedRun(haystack, offset, match.length) || insideLongerQuotedOrParenPhrase(haystack, offset, match.length))) return match;
    const candidates = nameIndex.get(match);
    if (!candidates) return match;
    let winners = candidates.filter((c) => c.id !== ownId);
    if (!winners.length) return match;
    if (winners.length > 1 && ownPromos && ownPromos.size) {
      const narrowed = winners.filter((c) => [...ownPromos].some((p) => c.promos.has(p)));
      if (narrowed.length >= 1) winners = narrowed;
    }
    // Still ambiguous after narrowing: leave as plain, unlinked text — same
    // "no disambiguation anchor, no guess" rule as curated page prose.
    if (winners.length !== 1) return match;
    const winner = winners[0];
    return `<a href="/characters/${winner.id}.html" class="entity-link" data-entity="${winner.id}">${match}</a>`;
  });
  return linkTitlesInPlainSegments(linkPromosInPlainSegments(withEntities), ownPromos);
}

// ---------------------------------------------------------------------------
// 2. Walk curated HTML files.
// ---------------------------------------------------------------------------
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    // WORKTREE-ISOLATION FIX (2026-08-20): ".claude" (parallel-writer
    // worktrees live under the repo root, ".claude/worktrees/<agent>/") was
    // missing from this exclusion — validate.mjs's own walk() and
    // registry-validate.mjs's own walkHTML() already excluded it, this one
    // didn't. A main-checkout regen walking into a live worktree copy would
    // auto-link entity mentions into that worktree's own pages using MAIN's
    // registry state (including any uncommitted mints), writing phantom
    // links into a sibling lane's files it doesn't own — the root cause of
    // this session's own cross-worktree pollution symptoms. Same fix,
    // same exact-name-match pattern, as the two validators already carry.
    if (name === ".git" || name === ".claude" || name === "bot" || name === "node_modules" || name === "functions" || name === "characters.html") continue;
    // PER-WRESTLER PAGES WAVE: characters/ is generated data-driven templates,
    // not curated prose — it has its own generator below and is never fed
    // through the auto-linker (which would otherwise try to link entity
    // names inside another entity's own reign/RP tables).
    if (name === "characters") continue;
    if (name === "who.html" || name === "collections.html" || name === "orbit.html") continue; // meta-refresh stubs, nothing to link
    const p = resolve(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}
// hook c108 (CURATION.md v129, #essays-reopened): a served essay (essays/<id>.html, rendered from its
// data/essays.json row below) is a verbatim artifact too: the linker and the wanted scan never read it.
const ARTIFACT_RE = /promotions\/[a-z0-9-]+\/archive\/(?!index\.html)|^essays\//;
// promotions/*/rp/*.html is a served verbatim artifact too (CURATION.md's
// verbatim-serving rule) — the PROCESS.md "auto-linker's reach includes
// rp/, deliberately" precedent lets the ORDINARY entity-linking pass below
// touch it (a link is presentation, not a content edit, same as a chrome
// repair), but THE FRONT-ENTRANCE RENAME's own legacy-href normalizer is a
// narrower, one-off bulk find/replace, not that same sanctioned per-entity
// mechanism — it stays off both archive/ and rp/ so neither verbatim
// artifact's own links move a single byte outside the ordinary linker.
const RP_ARTIFACT_RE = /promotions\/[a-z0-9-]+\/rp\//;
// LEGACY /wrestlers/ HREF NORMALIZATION (THE FRONT-ENTRANCE RENAME, 2026-08-20)
// — a fleet lane worktree writing concurrently under the old section name can
// still emit "/wrestlers/<id>.html" / "/wrestlers.html" hrefs; every curated
// (non-verbatim) page this generator already walks gets those normalized to
// the current path before anything else runs, so a stale lane's own output
// converges the next time refresh:links touches it. Never applied to a
// verbatim served artifact (promotions/<wing>/archive/rp) — see RP_ARTIFACT_RE above; archive/
// is excluded from `walk()`'s own output already (ARTIFACT_RE).
function normalizeLegacyWrestlerHrefs(html) {
  return html
    .replace(/(href="|url=)\/wrestlers\//g, "$1/characters/")
    .replace(/(href="|url=)\/wrestlers\.html/g, "$1/characters.html");
}

function promoContext(relPath) {
  // THE HYPHENATED-ID FIX (eWa accession, 2026-08-22): ewa-extreme and
  // ewa-empire were the first hyphenated promotion ids to serve documents;
  // `[a-z]+` silently returned null here, so neither the artifact fence nor
  // the bare-name rule ever applied to their pages (10 foreign anchors baked
  // in on first regen). Same fix in ARTIFACT_RE/RP_ARTIFACT_RE above and in
  // stamp-chrome/validate/registry-validate's own copies.
  const m = relPath.match(/^promotions\/([a-z0-9-]+)\//);
  return m ? m[1] : null;
}

function pageTitle(html) {
  const m = html.match(/<title>(.*?)<\/title>/);
  return m ? m[1].replace(/ &mdash; E-WRESTLING MUSEUM$/, "") : "?";
}

const appearsIn = new Map(); // entityId -> [{page, title}]
let linkedPages = 0;
let totalLinks = 0;
const wantedHits = new Map(); // name -> Set(pages)

// ROSTER QA WAVE (user gavel, the FOURTH recurrence of this fix — box, then
// labeled line, then an orphaned float, then an ordinary-but-still-
// annotated row): the "Name shared by multiple entities" disambiguation
// concept is retired outright, not restyled again. A name still ambiguous
// after promotion-context narrowing is left as plain, unlinked text —
// the adjacent rows on characters.html (two "Blade"s, sorted next to each
// other) are self-evident without a pointer sentence explaining it. This
// strips every already-baked disambiguation anchor from a PRIOR run back
// to plain text before the fresh pass below, so old pages converge too —
// permanently idempotent (a no-op once nothing matches).
const DISAMBIG_ANCHOR_RE = /<a href="\/wrestlers\.html#name-[a-z0-9-]+" class="entity-link entity-link-ambiguous" data-entity="name-[a-z0-9-]+">([^<]*)<\/a>/g;
// UNWRAP-ON-EXCLUSION (guard-batch 2026-09-02, item A finding 1d): an
// EXCLUDE_LINKS entry only ever blocks a NEW insertion — the ordinary
// text-segment pass a few hundred lines down already calls excludedOnPage()
// before linking. It never re-examines an anchor an earlier run already
// baked into the page, so an entry added AFTER that bake was permanently
// inert: six such anchors (scwf/rp/hooligans-and-shenanigans.html::the Chosen
// One, low/rp/a-new-day-begins.html::Fat Joe, nfw/rp/brawl-sydney.html::Luke
// Skywalker, scwf/index.html::Joe Stock, scwf/index.html::Mark Harrington,
// fortune-fwrestling/index.html::Pressure Point) stayed live from other
// batches. Matches ONLY the linker's own exact emitted markup — same href/
// class/data-entity shape as the fresh-link line below, id backreferenced so
// href and data-entity must agree — so a hand-authored link is never
// touched. Runs once per page, ahead of the DISAMBIG strip and the fresh
// pass, same "rebuild from scratch every run" idempotency those already
// use: if the (page, visible-text) pair is excluded now, unwrap back to
// plain text; the fresh pass below will then correctly leave it unlinked.
const ENTITY_LINK_ANCHOR_RE = /<a href="\/characters\/([a-zA-Z0-9-]+)\.html" class="entity-link" data-entity="\1">([^<]*)<\/a>/g;

// A FIGURE PAGE LINKS ONLY ITS OWN PORTRAYALS (entity-page QA sample,
// 2026-09-05, ranked defect #3: "a figure page's own breadcrumb auto-links a
// word of the real person's plain name to an unrelated character page that has
// nothing to do with that person" — 109 of 541 figure pages, and 190 such
// links in all, from dan-severn-real's own "Dan" reaching a WWA wrestler
// called NYC Slugger Dan to shelton-benjamin-real's "Benjamin" reaching a
// character sharing nothing but that one word).
//
// The linker's own bare-name rule already refuses this on a page that belongs
// to a promotion (promoContext narrows there), but a figure page belongs to no
// promotion, so `context` is null and every globally-unique single-word name
// linked freely — on a page whose entire text is a real person's name.
//
// A figure page has an allowlist by construction: the characters that point AT
// it. Built here, from the same `portrays` / `portrayal_of` edges the page's
// own "Portrayed in" / "Named for" lists are built from further down (that
// map, portrayedBy, is constructed after this walk, so this one is built
// independently rather than reaching forward into a const that is still in its
// temporal dead zone). Anything not on the list stays plain text, which is the
// no-guess rule this file keeps everywhere else.
const figureLinkAllowlists = new Map(); // figureId -> Set(entityId)
for (const e of entities) {
  const pts = e.portrays == null ? [] : (Array.isArray(e.portrays) ? e.portrays : [e.portrays]);
  for (const pt of pts) {
    if (!pt || !pt.figure) continue;
    if (!figureLinkAllowlists.has(pt.figure)) figureLinkAllowlists.set(pt.figure, new Set());
    figureLinkAllowlists.get(pt.figure).add(e.id);
  }
  if (e.portrayal_of) {
    if (!figureLinkAllowlists.has(e.portrayal_of)) figureLinkAllowlists.set(e.portrayal_of, new Set());
    figureLinkAllowlists.get(e.portrayal_of).add(e.id);
  }
}
// A MEMORIAL PAGE LINKS ONLY ITS SUBJECT'S OWN CHARACTERS (coordinator,
// 2026-09-25; the figure-page rule above, carried to memorials/). Sean Simon
// Williams' own fWrestling tribute page, memorials/sean-simon-williams/
// rip-sean-williams-fwrestling-2018-05-17.html, had its breadcrumb "RIP Sean
// Williams" linked word by word: "RIP" to rip-rwa-rugged, a stranger's
// character named RIP, and a condolence poster's "Dan" to nyc-slugger-dan-wwa,
// the same false link the figure rule was built to stop. A memorial page's
// allowlist is its subject's own `characters[]` in data/memorials.json, built
// here independently (the `memorials` const is loaded further down). The
// page-scoped EXCLUDE_LINKS rows for memorials/ stay; this is the structural
// guard, so a new tribute page is safe the day it lands.
const memorialLinkAllowlists = new Map(); // memorialId -> Set(entityId)
for (const m of (existsSync(resolve(DATA, "memorials.json")) ? loadArray("memorials") : [])) {
  if (m && m.id) memorialLinkAllowlists.set(m.id, new Set(m.characters ?? []));
}
function figureLinkAllowlist(rel) {
  const m = rel.match(/^figures\/([a-zA-Z0-9-]+)\.html$/);
  if (m) return figureLinkAllowlists.get(m[1]) ?? new Set();
  // memorials/<id>.html and every page under memorials/<id>/
  const mm = rel.match(/^memorials\/([a-zA-Z0-9-]+)(?:\.html$|\/)/);
  if (mm) return memorialLinkAllowlists.get(mm[1]) ?? new Set();
  return null;
}

// ---------------------------------------------------------------------------
// c57: THE KEYS.  `xCode` covers every byte of logic the two prose passes run
// (this file, the two modules it imports, the chrome template every generated
// page is stamped from); `xNames` is one digest per linkable name over that
// name's own candidate list and each candidate's promotion set — i.e. exactly
// what nameIndex gives the linker.  A name whose digest moved, appeared or
// vanished is a name whose answer on a page could differ, so such a page is
// re-walked; nothing else about the registry can change a link.  (Alternation
// order is not a key: bigReFor sorts by length, and two names of EQUAL length
// matching at one position are the same string, so ties cannot change a match.)
// ---------------------------------------------------------------------------
const xCode = xsha1([
  xfilehash(resolve(ROOT, "scripts", "cross-reference.mjs")),
  xfilehash(resolve(ROOT, "scripts", "stamp-chrome.mjs")),
  xfilehash(resolve(ROOT, "scripts", "text-markers.mjs")),
  xfilehash(resolve(ROOT, "templates", "chrome.html")),
  String(XREF_SCHEMA),
].join("|"));
const xNames = Object.create(null);
for (const [n, list] of nameIndex) {
  xNames[n] = xsha1(list.map((c) => `${c.id}:${[...c.promos].sort().join(",")}`).join(";"));
}
let xDelta = [];
if (xPrev && xPrev.code !== xCode) xFullReason = "this script, stamp-chrome, text-markers or the chrome template changed";
if (xPrev && !xFullReason) {
  const prevNames = xPrev.names;
  for (const n in xNames) if (prevNames[n] !== xNames[n]) xDelta.push(n);
  for (const n in prevNames) if (!(n in xNames)) xDelta.push(n);
  if (xDelta.length > XREF_DELTA_CAP) xFullReason = `${xDelta.length} names moved (cap ${XREF_DELTA_CAP})`;
}
const XINC = Boolean(xPrev) && !xFullReason;
if (!XINC) xDelta = [];
// A page's own data-entity ids, resolved the way the walk below resolves them:
// present in byId, or migrated to an alias target.  Recomputed from the ids
// the entry recorded (the bytes are unchanged, so the ids still are), never by
// re-scanning — so the test is cheap and exact.
function xEntSig(ids) {
  return xsha1(ids.map((id) => `${id}>${byId.has(id) ? "@" : resolveAlias(id)}`).join(";"));
}
function xAllowSig(allowed) {
  return allowed === null ? "-" : xsha1([...allowed].sort().join(","));
}
// c82 (lane XREF-FOLLOWUPS, 2026-10-05): A TOP-LEVEL STATIC PAGE LINKS NO LONE
// ORDINARY WORD. museum/*.html (about, structure, search-help, shows, crawler,
// halloffame, appearances, in-memoriam, ...) belongs to no promotion, so the
// BARE-NAME RULE below (which needs a page's promotion) never fires there and
// every globally unique one-word name linked wherever its word stood: "the
// Wayback Machine" -> machine-cswa, "Halls of Fame" -> fame-fwa-pbm-1989,
// "Show", "Tier", "Unit", "Human"-written, "Cross"-promotion, "Referees",
// "Fantasy wrestling", "Mayhem Wrestling Entertainment". On such a page a match
// that is ONE capitalised ordinary word (an uppercase letter, then lowercase
// letters only) is a guess, and the linker never guesses: it stays plain text,
// and an anchor an earlier run baked there in the linker's own exact markup is
// unwrapped (the UNWRAP-ON-EXCLUSION pass). Multi-word names ("Seymour
// Almasy", "Marcus Broussard") and stylised single tokens ("H.I.T.") link as
// before; a hand-written link without class="entity-link" is never touched, so
// an author can still link a one-word name by hand. No page text is consulted
// beyond the match itself, so hand-authoring a page needs nothing from anyone.
function staticPageLoneWord(rel, match) {
  return !rel.includes("/") && /^\p{Lu}\p{Ll}+$/u.test(match);
}
function xReusable(rel, hash, text, figureAllowed) {
  const prev = xPrev.pages[rel] ?? null;
  if (!prev || prev.h !== hash) return null;
  if (prev.a !== xAllowSig(figureAllowed)) return null;
  if (xEntSig(prev.i ?? []) !== prev.e) return null;
  for (const n of xDelta) if (text.includes(n)) return null;
  return prev;
}
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (rel === "curation.html") continue; // constitution text, leave untouched
  if (ARTIFACT_RE.test(rel)) continue; // verbatim artifact — never touched
  // null on every page but a figure or memorial page; a Set (possibly empty) there.
  const figureAllowed = figureLinkAllowlist(rel);

  const onDiskHtml = readFileSync(file, "utf8");
  // c57: the four-part reuse test above.  On a hit, replay the `appearsIn`
  // rows this page contributed last run — in the same page order, so every
  // "Appears in" list comes out in the same order a full run produces — and
  // skip the pass.  Nothing was written for this page last run and nothing is
  // written now.
  const xHash = XREF_NO_MANIFEST ? "" : xsha1(onDiskHtml);
  xWalkedPages++;
  if (XINC) {
    const hit = xReusable(rel, xHash, onDiskHtml, figureAllowed);
    if (hit) {
      const pageHref = "/" + rel.replace(/index\.html$/, "");
      for (const id of hit.r) {
        const list = appearsIn.get(id) ?? [];
        list.push({ page: pageHref, title: hit.t });
        appearsIn.set(id, list);
      }
      xPages[rel] = hit;
      xReusedPages++;
      continue;
    }
  }
  const xEntIds = [...new Set([...onDiskHtml.matchAll(/data-entity="([^"]+)"/g)].map((m) => m[1]))];
  const originalHtml = RP_ARTIFACT_RE.test(rel) ? onDiskHtml : normalizeLegacyWrestlerHrefs(onDiskHtml);
  const normalizedLegacyHrefs = originalHtml !== onDiskHtml;
  const disambigStripped = originalHtml.replace(DISAMBIG_ANCHOR_RE, "$1");
  const html = disambigStripped.replace(ENTITY_LINK_ANCHOR_RE, (full, id, text) => (
    (excludedOnPage(rel, text) || staticPageLoneWord(rel, text) || (figureAllowed && !figureAllowed.has(id))) ? text : full));
  const strippedAnAnchor = html !== originalHtml || normalizedLegacyHrefs;
  const mainMatch = html.match(/<main[^>]*>[\s\S]*<\/main>/);
  if (!mainMatch) {
    // c57: no <main> — the pass writes nothing and yields no rows.
    if (!XREF_NO_MANIFEST) xPages[rel] = { h: xHash, t: "", r: [], i: xEntIds, e: xEntSig(xEntIds), a: xAllowSig(figureAllowed) };
    continue;
  }
  const mainStart = html.indexOf(mainMatch[0]);
  const before = html.slice(0, mainStart);
  const after = html.slice(mainStart + mainMatch[0].length);
  let main = mainMatch[0];

  // Cut the footer out entirely for the duration of linking (boilerplate).
  // ATTRIBUTE-TOLERANT (v112(a), 2026-09-05): the footer carries lang="en"
  // on a page whose own language is not English.
  const footerMatch = main.match(/<footer\b[^>]*>[\s\S]*<\/footer>/);
  let footer = "";
  if (footerMatch) {
    footer = footerMatch[0];
    main = main.replace(footer, " FOOTER ");
  }

  const context = promoContext(rel);
  const title = pageTitle(html);
  const linkedHere = new Set();
  let pageLinkCount = 0;
  const xRows = []; // c57: the ids this page pushes into appearsIn, in order

  // Tokenize into tag / text segments; track whether we're inside an <a>,
  // <h1..h3>, or already-injected entity link (so re-runs stay idempotent).
  const segments = main.split(/(<[^>]+>)/);
  let insideA = 0, insideHeading = 0, insideScript = 0;
  // Which entity the <a> we're currently inside was generated for, read
  // straight off its own data-entity attribute — not re-derived from the
  // visible text, which is
  // what let the old idempotency path go wrong (see below).
  let currentLinkEntity = null;
  const out = segments.map((seg) => {
    if (seg.startsWith("<")) {
      // SCRIPT GUARD (2026-09-12): text inside <script>/<style> is code, never prose — skip it entirely.
      if (/^<(script|style)[\s>]/i.test(seg)) { insideScript++; return seg; }
      if (/^<\/(script|style)>/i.test(seg)) { insideScript = Math.max(0, insideScript - 1); return seg; }
      if (/^<a[\s>]/i.test(seg)) {
        insideA++;
        const m = seg.match(/data-entity="([^"]+)"/);
        currentLinkEntity = m ? m[1] : null;
        // THE IDENTITY WAVE: a data-entity naming a now-RETIRED id (an
        // al-crud-shaped merge folded it into a survivor) migrates forward
        // via data/aliases.json before the byId check below — same
        // "rewrite to exactly what a fresh link would produce" idempotency
        // the PER-WRESTLER PAGES WAVE migration already gives a pre-rename
        // href. Wrapping only (href + data-entity); the anchor's own visible
        // text — the served corpus's actual words — is never touched.
        if (currentLinkEntity && !byId.has(currentLinkEntity)) {
          const canonical = resolveAlias(currentLinkEntity);
          if (canonical !== currentLinkEntity && byId.has(canonical)) {
            seg = seg
              .replace(/data-entity="[^"]+"/, `data-entity="${canonical}"`)
              .replace(/href="\/characters\/[a-zA-Z0-9-]+\.html"/, `href="/characters/${canonical}.html"`);
            currentLinkEntity = canonical;
          }
        }
        // PER-WRESTLER PAGES WAVE: migrate (and, on every future run,
        // re-affirm) a resolved entity link's href to its own generated
        // page. Idempotent by construction — rewriting to the exact value a
        // fresh link would produce, whether this tag pre-dates the wave or
        // not.
        if (currentLinkEntity && byId.has(currentLinkEntity)) {
          seg = seg.replace(/href="\/wrestlers\.html#[a-zA-Z0-9-]+"/, `href="/characters/${currentLinkEntity}.html"`);
        }
      } else if (/^<\/a>/i.test(seg)) {
        insideA = Math.max(0, insideA - 1);
        if (insideA === 0) currentLinkEntity = null;
      } else if (/^<h[123][\s>]/i.test(seg)) insideHeading++;
      else if (/^<\/h[123]>/i.test(seg)) insideHeading = Math.max(0, insideHeading - 1);
      return seg;
    }
    if (insideScript || insideA || insideHeading || !seg.trim()) {
      // IDEMPOTENCY, FIXED AT THE ROOT: relinking an already-linked corpus
      // must reconstruct exactly what a fresh link would have produced —
      // not just `linkedHere` (dedup-within-page), but `appearsIn`
      // (backlinks) too. The old version only did the first, so a second
      // `refresh:links` run over a fully-linked site emitted characters.html
      // with every "Appears in" line silently empty — the entity links
      // themselves looked fine, but everything DERIVED from them vanished.
      // The old code also re-derived the entity from the visible TEXT
      // (nameIndex.get(trimmed)), which only worked when that text happened
      // to be globally unambiguous; reading data-entity straight off the
      // existing tag is exact, not a guess.
      if (insideA) {
        const trimmed = seg.trim();
        if (trimmed && currentLinkEntity) {
          if (byId.has(currentLinkEntity) && !linkedHere.has(currentLinkEntity)) {
            linkedHere.add(currentLinkEntity);
            const list = appearsIn.get(currentLinkEntity) ?? [];
            list.push({ page: "/" + rel.replace(/index\.html$/, ""), title });
            appearsIn.set(currentLinkEntity, list);
            xRows.push(currentLinkEntity);
          }
        } else if (trimmed) {
          // A hand-authored <a> with no data-entity at all (e.g. plain
          // prose links) — best-effort fallback, unchanged from before.
          const hit = nameIndex.get(trimmed);
          if (hit && hit.length === 1) linkedHere.add(hit[0].id);
        }
      }
      return seg;
    }

    const bigRe = bigReFor(seg);
    if (!bigRe) return seg;
    return seg.replace(bigRe, (match, offset, haystack) => {
      if (insideExcludedAlias(haystack, offset, match.length)) return match;
      if (excludedOnPage(rel, match)) return match;
      if (staticPageLoneWord(rel, match)) return match; // c82, see staticPageLoneWord
      const candidates = nameIndex.get(match);
      if (!candidates) return match;
      let winners = candidates;
      if (context && candidates.length > 1) {
        const narrowed = candidates.filter((c) => c.promos.has(context));
        if (narrowed.length >= 1) winners = narrowed;
      }
      // ROSTER QA WAVE: a name still ambiguous after promotion-context
      // narrowing is left as PLAIN, UNLINKED TEXT — no disambiguation
      // anchor, no explanatory note. See the strip pass at the top of this
      // loop for what happens to anchors an earlier run already baked in.
      if (winners.length > 1 || (winners.length === 1 && candidates.length > 1 && !context)) {
        return match;
      }
      const winner = winners[0];
      // THE BARE-NAME RULE (MWE accession, 2026-08-22): narrowing above only
      // ever fires when a name has 2+ candidates — a name registered to
      // exactly ONE entity anywhere in the registry linked everywhere it
      // appeared, in every promotion's prose. The MWE roleplay lane's own
      // post-regen diff caught 83 such false positives pulled INTO one
      // promotion's 628 served roleplays from other feds' bare names:
      // "Sara" (an XUW character) wiring into MWE's own Sara Patterson,
      // "Shawn" (GIWF) into MWE's Shawn Spitzer, "Dev" (XUW) into Devlin
      // Sharpe, "Evil" into "Evil Dead 2", "Steel" into "Steel Cage",
      // "Hammer" into "MC Hammer". Per-name EXCLUDE_NAMES entries don't
      // scale to that (the Janitor's own 500-promotion test), so the rule
      // is structural: on a page that belongs to a promotion, a single
      // resolved candidate with NO tenure/appearance in that promotion is
      // linked only when the matched name is more than one bare word
      // (a leading article doesn't count). "John Austin" (WHQ) and
      // "Rocky Stevens" (WcE) named in an MWE promo still link — real
      // cross-promotion mentions of a full name are exactly what the
      // graph is for; a lone first name or common word from another fed's
      // roster is a guess, and the linker never guesses.
      if (context && !winner.promos.has(context)) {
        const bare = match.replace(/^(the|a|an)\s+/i, "").trim();
        if (!/\s/.test(bare)) return match;
      }
      // See the figure-page allowlist above the loop.
      if (figureAllowed && !figureAllowed.has(winner.id)) return match;
      if (linkedHere.has(winner.id)) return match; // one link per entity per page
      linkedHere.add(winner.id);
      totalLinks++;
      pageLinkCount++;
      const list = appearsIn.get(winner.id) ?? [];
      list.push({ page: "/" + rel.replace(/index\.html$/, ""), title });
      appearsIn.set(winner.id, list);
      xRows.push(winner.id);
      return `<a href="/characters/${winner.id}.html" class="entity-link" data-entity="${winner.id}">${match}</a>`;
    });
  });

  let newMain = out.join("");
  if (footer) newMain = newMain.replace(" FOOTER ", footer);

  // Write whenever the page actually changed — not just when a brand-new
  // link was inserted (pageLinkCount). PER-WRESTLER PAGES WAVE: the
  // idempotent "already linked" path now also MIGRATES existing hrefs
  // (/characters.html#id -> /characters/id.html), which changes `newMain`
  // without touching `pageLinkCount` at all — gating the write on the
  // wrong signal would silently skip every already-linked page forever.
  if (newMain !== mainMatch[0] || strippedAnAnchor) {
    writeFileSync(file, before + newMain + after);
    linkedPages++;
  } else if (!XREF_NO_MANIFEST) {
    // c57: AN ENTRY IS RECORDED ONLY HERE — on the branch where the pass
    // left the file byte-for-byte alone.  That is what makes a later reuse
    // a skip of work and never a skip of a write, and it is why no
    // idempotency assumption is needed anywhere in this design.
    xPages[rel] = { h: xHash, t: title, r: xRows, i: xEntIds, e: xEntSig(xEntIds), a: xAllowSig(figureAllowed) };
  }
}
if (XINC) console.log(`cross-reference: incremental link pass — ${xReusedPages}/${xWalkedPages} pages reused unchanged, ${xWalkedPages - xReusedPages} re-walked (${xDelta.length} name(s) moved).`);
else console.log(`cross-reference: FULL link pass over ${xWalkedPages} pages (${xFullReason || "no manifest"}); the manifest is refreshed for the next run.`);

// ---------------------------------------------------------------------------
// 3. Emit characters.html — the entity hub every link points into. Flat,
//    alphabetical (THE FLATTENING WAVE) — no per-promotion grouping, a
//    typeahead promotion filter instead. Handler attribution is gone except
//    for memorial-linked entities (CURATION.md's privacy rule): the museum documents
//    characters, not the people who played them, and that now holds for
//    "a contributor" as much as for any name.
// ---------------------------------------------------------------------------
// Escapes for both text content AND attribute values (data-search/data-promo
// now put entity names inside double-quoted attributes, where a literal "
// in a name like "Strictly Business" Lew Spectre would otherwise break the
// markup) — &quot; and &lt;/&gt; render as plain characters in text content,
// so escaping them everywhere is always safe, not just where it's required.
// THE DOUBLE-ESCAPE FIX (4WW handoff §12, 2026-08-23): the `&` lookahead
// only ever recognized a NAMED entity (`&amp;`, `&quot;`, ...) as already
// escaped — a NUMERIC character reference (`&#x27;`, `&#39;`) starts with
// `#`, not a word character, so it slipped past `(?!\w+;)` and got
// re-escaped into `&amp;#x27;`. Repo-wide: any raw HTML read from disk
// (the holdings generator's own `<title>` extraction, chief among them)
// and passed back through esc() carried this — 11 promotions' own
// holdings.html pages were rendering it live before this fix. Widened to
// recognize both numeric forms as already-escaped, the same idempotency
// the named-entity check already gave &amp;/&quot;/&lt;/&gt;/&nbsp;/etc.
function esc(s) {
  return (s ?? "")
    .replace(/&(?!(?:\w+|#\d+|#x[0-9A-Fa-f]+);)/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ===========================================================================
// THE SLIM-INDEX WAVE (2026-10-03) — the instrument indexes
// (characters/units/matches/appearances/reigns/awards-index.json) are the only
// generated files a VISITOR downloads whole, and three of them were the
// museum's largest served objects (30 MB, 33 MB, 46 MB). Each row paid for the
// same facts twice or three times: its query fields, written once as
// HTML-escaped data-* attributes inside `html` and again as top-level keys
// beside it; its wrapper element, identical on all 29,020 of them; the unused
// HTML-escaped `search` duplicate; and two spaces of indentation per line of a
// file nothing reads by hand.
//
// v2 writes each row once —
//   {"i": id, "s": <plain-word blob>, "a": {field: value}, "h": <inner markup>}
// — one row per LINE, which is what lets js/list.js's wireIndexList paint the
// first window of rows while the rest of the file is still arriving.
//
// The card markup itself does not move: it is still rendered here, by the same
// renderers, and `a` holds exactly what the data-* attributes held (unescaped,
// since JSON carries its own quoting), which js/query.js's fieldsFromAttrMap
// reads into the same {field: [values]} map fieldsFromElement built from the
// attributes themselves. splitIndexRow() derives the split from each
// renderer's own output rather than asking five renderers to emit two shapes,
// and writeIndexV2() re-assembles every row from the split and REFUSES TO
// WRITE unless every one of them comes back byte-for-byte identical to what
// the renderer produced — so the split can't quietly drop an attribute or a
// nested element.
// ===========================================================================
const INDEX_SCHEMA_VERSION = 2;

// The browser decodes an attribute value before any filter ever sees it, so
// the index carries the decoded value and the two paths agree by construction.
// This table is every entity that actually occurs in a rendered row's
// attributes: the four esc() above produces, plus the two numeric apostrophe
// spellings that reach it already-escaped from served source text.
const ATTR_ENTITIES = [[/&quot;/g, '"'], [/&#0?39;/g, "'"], [/&#x27;/gi, "'"],
  [/&lt;/g, "<"], [/&gt;/g, ">"], [/&amp;/g, "&"]];
function unescAttr(s) {
  let out = String(s);
  for (const [re, ch] of ATTR_ENTITIES) out = out.replace(re, ch);
  return out;
}

// One rendered row -> its parts. Throws rather than guessing: a row that
// isn't a single element with quoted attributes, or that carries a
// non-data attribute other than class/id, is a renderer change this
// function has to be told about.
function splitIndexRow(html, where) {
  const m = /^<([a-z]+)((?:\s+[a-zA-Z0-9_-]+="[^"]*")*)>([\s\S]*)<\/([a-z]+)>$/.exec(html);
  if (!m || m[1] !== m[4]) {
    throw new Error(`${where}: an index row must be one element with quoted attributes — got ${html.slice(0, 160)}`);
  }
  const [, tag, attrText, inner] = m;
  const attrsRaw = {};
  let cls = "", id = "";
  for (const a of attrText.matchAll(/\s+([a-zA-Z0-9_-]+)="([^"]*)"/g)) {
    const name = a[1], value = a[2];
    if (name === "class") { cls = value; continue; }
    if (name === "id") { id = value; continue; }
    if (!name.startsWith("data-")) {
      throw new Error(`${where}: unexpected attribute "${name}" on an index row — only class, id and data-* are carried`);
    }
    attrsRaw[name.slice(5)] = value;
  }
  return { tag, cls, id, attrsRaw, inner, source: html, attrText };
}

// Re-assembles a split row exactly as the renderer wrote it. The ONLY
// verification that matters: if this doesn't reproduce the renderer's own
// bytes, the split lost something.
function rebuildIndexRow(part) {
  return `<${part.tag}${part.attrText}>${part.inner}</${part.tag}>`;
}

// rows: [{ id, html }] in display order. `withRowId` says whether the
// renderer put the row's id on the element itself (the roster cards do; the
// archive-list <li> rows never did), so the browser re-wraps each row exactly
// as it was served.
function writeIndexV2(path, key, rows, { where }) {
  const out = [];
  let tag = null, cls = null, withRowId = null;
  for (const r of rows) {
    const part = splitIndexRow(r.html, where);
    const back = rebuildIndexRow(part);
    if (back !== part.source) {
      throw new Error(`${where}: row "${r.id}" does not round-trip through splitIndexRow — refusing to write a lossy index`);
    }
    const hasRowId = part.id !== "";
    if (hasRowId && part.id !== r.id) {
      throw new Error(`${where}: row "${r.id}" carries a different element id ("${part.id}")`);
    }
    if (tag === null) { tag = part.tag; cls = part.cls; withRowId = hasRowId; }
    else if (part.tag !== tag || part.cls !== cls || hasRowId !== withRowId) {
      throw new Error(`${where}: row "${r.id}" renders <${part.tag} class="${part.cls}"> where the index's other rows render <${tag} class="${cls}"> — one index, one row shape`);
    }
    const a = {};
    let blob = "";
    for (const [name, value] of Object.entries(part.attrsRaw)) {
      if (name === "search") { blob = unescAttr(value); continue; }
      if (value === "") continue; // never queryable; js/query.js skips an empty attribute too
      a[name] = unescAttr(value);
    }
    const row = { i: r.id };
    if (blob) row.s = blob;
    if (Object.keys(a).length) row.a = a;
    // THE SORT-EXTRAS CHANNEL (hook c203, adversarial review 2026-10-09,
    // finding B01's remainder): a row may carry `x`, a flat object of
    // SORT-ONLY SCALARS -- never markup, never a queryable field, never
    // rendered as it stands. Two instruments offer a sort control over their
    // own list (awards.html, promotions.html), and a pre-baked row has no
    // record behind it to sort on; this is that record's sort keys and
    // nothing else. js/list.js's indexRow passes it through to the page,
    // which reads it in its own onReady handler. Anything but a plain object
    // of scalars stops the build here rather than letting this channel grow
    // into a second data payload.
    if (r.x !== undefined) {
      if (!r.x || typeof r.x !== "object" || Array.isArray(r.x)) {
        throw new Error(`${where}: row "${r.id}" carries a non-object \`x\``);
      }
      for (const [k, v] of Object.entries(r.x)) {
        if (v !== null && typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
          throw new Error(`${where}: row "${r.id}" carries a non-scalar \`x.${k}\``);
        }
      }
      row.x = r.x;
    }
    row.h = part.inner;
    out.push(JSON.stringify(row));
  }
  const header = [
    `"_schema_version": ${INDEX_SCHEMA_VERSION}`,
    `"_rows": ${rows.length}`,
    `"_row_tag": ${JSON.stringify(tag ?? "div")}`,
    `"_row_class": ${JSON.stringify(cls ?? "")}`,
    `"_row_id": ${withRowId === true}`,
    `${JSON.stringify(key)}: [`,
  ].join(",\n");
  writeFileSync(path, `{\n${header}\n${out.join(",\n")}${out.length ? "\n" : ""}]\n}\n`);
  return rows.length;
}
// THE AI-AUTHORSHIP FLAG (2026-08-22, the Janitor's own words: "a small `AI`
// flag next to anything that is AI-generated prose... But with the option
// that humans could manually write these as well and they'd drop the
// flag") — one shared marker, rendered mechanically from the field, never
// hand-inserted: any bounded-prose field (caption/epitaph/memorial note)
// carries its own paired authorship metadata (`caption_asof.author` /
// `epitaph_asof.author` / a memorial's own `note_author`), "ai" or
// "human"; this renders the badge for "ai" (and any unset/legacy value —
// the honest default, per the Janitor's own "DEFAULT everything currently
// in the registry to ai" instruction) and nothing at all for "human".
// THE ATTESTOR CREDIT (docs/ATTESTATION.md §2, first wired 2026-08-23):
// "ai" renders the AI badge; a registered attestor handle renders that
// attestor's credit; bare "human" (the pre-registry form) renders nothing,
// pending a handle. One convention for the Janitor and stranger alike.
const attestorsById = new Map(
  (existsSync(resolve(DATA, "attestors.json"))
    ? JSON.parse(readFileSync(resolve(DATA, "attestors.json"), "utf8")).attestors ?? []
    : []).map((a) => [a.handle, a]));
function aiFlag(author) {
  if (author === "human") return "";
  const att = attestorsById.get(author);
  if (att) return ` <span class="attestor-flag" title="human-written, attested">${esc(att.display)}</span>`;
  // hook c187 (the Janitor's D466, 2026-10-09; findings C02/C05 of the adversarial review): the mark says what it means, in
  // text a phone can show and a screen reader reads once. The class is unchanged (style.css, land-check's L-EPI); the tooltip
  // is gone because the words are now on the page. The legend is on /about.html#ai-prose.
  return ` <span class="ai-flag">Written by AI, 2026</span>`;
}
// THE MUSEUM-VOICE SIBLING (THE ECOSYSTEM EXPANSION GAVEL, 2026-09-05, step
// 2; CURATION.md v112(c), #caption-en). Returns the English sibling of a
// scene-language caption, badged off its OWN author field, or "" — which is
// what every row held at the gavel returns, so every caption surface below
// is byte-identical on the English tree. It is a second original, never a
// translation of the caption above it, and never a translation of a served
// document: no served document is ever translated into a stored field.
function captionEn(row) {
  if (!row || !row.caption_en) return "";
  return `<span class="caption-en" lang="en">${esc(row.caption_en)}${aiFlag(row.caption_en_author)}</span>`;
}
// And the scene-language marker for the caption itself — a caption written
// in Polish inside an English page is marked so a browser's own translator
// reads it as Polish (v112(a)). "" on every row held at the gavel.
function captionLangAttr(row, wing) {
  const lang = (row && row.language) || (wing && wing.language) || "en";
  return lang === "en" ? "" : ` lang="${esc(lang)}"`;
}
// THE SELFISH-REVIEWER FEATURE — baked prev/next. `type` is the sessionStorage
// key js/list.js's savePagerSequence()/js/pager.js's filter-inheritance
// reads/writes under ("wrestlers", "promotions", ...); prevItem/nextItem are
// {href, label} or null at either end of the type's own sortKey order. Works
// with no JS at all (a plain <a>); js/pager.js progressively rewires it to
// arrow keys + a visitor's own current filter when present. Returns "" (no
// markup, no script tag) when both ends are null — nothing to page through.
function pagerNav(type, prevItem, nextItem) {
  if (!prevItem && !nextItem) return "";
  const prev = prevItem
    ? `<a class="pager-prev" href="${esc(prevItem.href)}" rel="prev">&larr; ${esc(prevItem.label)}</a>`
    : "";
  const next = nextItem
    ? `<a class="pager-next" href="${esc(nextItem.href)}" rel="next">${esc(nextItem.label)} &rarr;</a>`
    : "";
  return `
  <nav class="pager" data-pager-type="${esc(type)}" aria-label="Browse ${esc(type)}">
${[prev, `<span class="pager-indicator" hidden></span>`, next].filter(Boolean).map((l) => `    ${l}`).join("\n")}
  </nav>
  <script src="/js/pager.js?v=4"></script>`;
}

const memorials = existsSync(resolve(DATA, "memorials.json")) ? loadArray("memorials") : [];

// Mirrors js/list.js's sortKey()/acronymLabel() — kept in sync by hand,
// since one runs in Node at build time and the other in the browser.
// Leading "The " ignored for sort purposes only; display strings untouched.
function sortKeyStr(name) {
  return String(name ?? "").replace(/^the\s+/i, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function firstYear(yearsStr) {
  const m = String(yearsStr ?? "").match(/\d{4}/);
  return m ? m[0] : null;
}
function acronymLabel(promo) {
  if (!promo) return "";
  const y = firstYear(promo.years);
  // No year twin when the name already carries ITS OWN trailing
  // parenthetical, whatever year (or non-year) that parenthetical names.
  // The old test asked whether the name's own paren repeated the SAME year
  // this function is about to append, which misses a wing whose full-name
  // parenthetical bakes in a DIFFERENT year than `years` starts on (gwa-aol-
  // 1997: name "GWA (Global Wrestling Alliance, AOL, 1997)", years "1994")
  // — the guard passed straight through and appended " (1994)" onto a name
  // that already ends in its own parenthetical, doubling it (L135, entity-
  // page QA sample 2026-09-05, open question 7). A bare name with no
  // trailing paren of its own (EWA, UWF, ...) is unaffected either way.
  const base = /\([^)]*\)\s*$/.test(promo.name) ? promo.name : `${promo.name} (${y ?? "year unknown"})`;
  const group = promotions
    .filter((p) => p.name === promo.name && firstYear(p.years) === y)
    .sort((a, b) => {
      const fa = sortKeyStr(a.full_name || a.name), fb = sortKeyStr(b.full_name || b.name);
      return fa < fb ? -1 : fa > fb ? 1 : 0;
    });
  if (group.length < 2) return base;
  const idx = group.findIndex((p) => p.id === promo.id);
  return idx <= 0 ? base : `${base} (${idx + 1})`;
}

// ROSTER QA WAVE: a tenure's own fed tag ("UWF (2001)") is now a link to
// the fed's wing, and the whole run is a plain comma list in tenure-start
// order — not an arrow chain. Arrows read as a sequence/succession
// ("became," "led to"), which is misleading once every step already
// carries its own founding year: "GIWF (1999) -> UWF (2001) -> WWA (1997)"
// reads like WWA came AFTER UWF, when 1997 is right there saying it
// didn't. `tenurePromoIds` is already built by walking `e.tenures` in
// array order, which the mint convention keeps in tenure-start order.
function promoLinkedLabel(pid) {
  const promo = promoById.get(pid);
  const label = acronymLabel(promo) || promoName.get(pid) || pid;
  return promo?.page ? `<a href="${esc(promo.page)}">${esc(label)}</a>` : esc(label);
}

// SHOW-NAME PROMOTION PREFIX (PROFILE QUALITY WAVE, user review: "GIWF
// Quake", never bare "Quake") — mirrors js/list.js's bareAcronym()/
// showLabel() by hand (Node build time vs. browser run time, same split
// every other Node/browser helper pair in this file already has).
function bareAcronym(promo) {
  if (!promo) return "";
  const dupes = promotions.filter((p) => p.name === promo.name);
  if (dupes.length > 1) return acronymLabel(promo);
  return promo.name;
}
function showLabel(show) {
  const promo = promoById.get(show.promotion);
  const prefix = bareAcronym(promo) || String(show.promotion ?? "").toUpperCase();
  // Some shows' own `name` already carries the promotion acronym as part
  // of its own title ("GIWF Global — 4 May 1999") — don't double it.
  if (show.name.toUpperCase().startsWith(`${prefix.toUpperCase()} `)) return show.name;
  return `${prefix} ${show.name}`;
}

// THE INDEX-FEEDBACK WAVE (2026-09-08, the Janitor: "Shows, Matches,
// Appearances indexes: each row shows the promotion name with a link to
// the wing") — showLabel() above stays plain TEXT (search blobs, data-*
// attributes still want an unlinked string); this is the HTML twin used
// only where a row actually RENDERS the label, splitting the same
// promotion-prefix convention into two links instead of one: the
// promotion prefix points at the wing, the remainder of the show's own
// name points at the show. Mirrors js/list.js's own showLabelHtml()
// (Node build time vs. browser run time, same split every other Node/
// browser helper pair in this file already has).
function showLabelHtml(show, promo) {
  const prefix = bareAcronym(promo) || String(show.promotion ?? "").toUpperCase();
  let rest = show.name;
  if (show.name.toUpperCase().startsWith(`${prefix.toUpperCase()} `)) {
    rest = show.name.slice(prefix.length).replace(/^\s+/, "");
  }
  const promoHtml = promo?.page ? `<a href="${esc(promo.page)}">${esc(prefix)}</a>` : esc(prefix);
  const showHtml = show.page ? `<a href="${esc(show.page)}">${esc(rest)}</a>` : esc(rest);
  return `${promoHtml} ${showHtml}`;
}

// Moved up from the per-entity-page section (§3) so both that section AND
// the season-page generator (§2c) below can call it — a function
// declaration hoists, but the const it closes over does not.
// hook c189 (the Janitor's D466, 2026-10-09; the adversarial review's date-style call): ONE DATE STYLE ON THE CHRONOLOGICAL
// LISTS. These twelve strings are read in one place, dateLabel()'s exact-date branch, which is the formatter the year pages,
// matches, appearances, reigns, bestowals and every entity page share; shows.html and rps.html already spell the month out
// through listDateLabel/LIST_MONTH_NAMES. Spelling them out here makes the whole site read the one way instead of two.
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
// THE UNKNOWN-DATE RULE (the Janitor's site sweep, 2026-10-08, "Meta": "unknown dates labeled unknown (not default dates
// like 1979) listed at the end in alphabetical order"; hook c150). ONE rule for every chronological list - shows,
// roleplays, matches, appearances, reigns, bestowals - written once here and called by each:
//   1. A date is UNKNOWN when it is missing, when its precision is "unknown", or when its text carries no 4-digit year:
//      exactly when showDateKey(date) is null. An unknown date NEVER sorts as a date, whatever text it
//      stores: a Wayback capture bound, an in-fiction year, a range such as "2001-2005" are all in the tail.
//   2. The tail comes after every dated row and is ALPHABETICAL BY THE LABEL THE ROW DISPLAYS (the show's "ACRO name", the
//      roleplay's title, the title or award name ...), not by a hidden key: chronoKey(date, tailLabel) gives the tail a
//      key "9999-99-99 <sortKeyStr(label)>", so a plain string sort of the keys puts dated rows first, in date order, then
//      the unknown ones in label order. chronoKey(date) with no label keeps the old behaviour (a bare "9999-99-99" for
//      every unknown row, registry order inside the tail).
//   3. The row's date column reads unknownDateLabel(date): "unknown", or "unknown (by YYYY-MM-DD)" when the stored date is
//      a CAPTURE BOUND (isCaptureBound: precision "unknown", a full YYYY-MM-DD, and the date's own `source` text names
//      the Wayback Machine or a capture - "Wayback capture timestamp only", "the Wayback Machine's capture (5 December
//      1998) is the only anchor": the page existed by then, nothing says when it ran). An in-fiction or unresolvable year
//      ("as written on the page; not resolvable to a calendar date", the 1979 promos), a year-only value and any date whose
//      source is not a capture all read plain "unknown". dateLabel(d) calls this for precision "unknown", so every page the
//      build bakes says the same thing.
//   4. The year an unknown row is filed under is the word "unknown" (dateYearOrUnknown), never a year: the in-place year
//      row's "unknown" link (js/list.js wireYearLinks, data-year="unknown") selects the tail, and a row's data-year is
//      its date's year or that word.
// The browser twin of this rule is inline in shows.html and rps.html (dateKey / captureBound / dateLabel / yearValue):
// change them together.
function isCaptureBound(d) {
  return !!d && d.precision === "unknown" && /^\d{4}-\d{2}-\d{2}$/.test(String(d.date ?? "")) &&
    /wayback|captur/i.test(String(d.source ?? ""));
}
function unknownDateLabel(d) {
  return isCaptureBound(d) ? `unknown (by ${d.date})` : "unknown";
}
function dateYearOrUnknown(d) {
  const k = showDateKey(d);
  return k ? k.slice(0, 4) : "unknown";
}
function dateLabel(d) {
  if (d && d.precision === "unknown") return unknownDateLabel(d);
  if (!d || d.date == null) return "";
  if (d.precision === "exact" && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
    const [y, m, day] = d.date.split("-");
    return `${parseInt(day, 10)} ${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
  }
  return d.precision && d.precision !== "exact" ? `${d.date} (${d.precision})` : String(d.date);
}

// Reverse lookups: which memorial (if any) a character belongs to; which
// unit(s) a character is a member of.
const memorialByCharacterId = new Map();
for (const m of memorials) for (const cid of m.characters ?? []) memorialByCharacterId.set(cid, m);
const unitsByCharacterId = new Map();
for (const u of units) {
  for (const mem of u.members ?? []) {
    if (!mem.character_id) continue;
    const list = unitsByCharacterId.get(mem.character_id) ?? [];
    list.push(u);
    unitsByCharacterId.set(mem.character_id, list);
  }
}

// OPPONENTS-PER-MATCH JOIN, AT BUILD TIME (FIELD PARITY BY BUILD-TIME
// STAMPING) — a Node-side twin of search.html's own client-side
// "OPPONENTS-PER-MATCH WAVE" join (see that comment there): for every
// `matches[]` row with `sides`, every entity on one side is an opponent
// of every entity on every OTHER side, once per match. search.html joins
// this live, at page load, over the full data/shows.json; characters.html
// can't (it only ever sees whatever data-* a row's own card carries), so
// this stamps the SAME join onto each entity's generated roster card
// instead — `opponent:`/`opponents:` then work identically on both
// pages. Kept semantically identical to search.html's loop on purpose
// (same per-side/per-match traversal); the one deliberate difference is
// DISTINCT names here (a build-time attribute has no reason to repeat a
// name once per match the way search.html's live join does — a
// substring match against the distinct set finds a rival exactly as
// well, and `opponents` was already the DISTINCT count on both sides).
const opponentJoinById = new Map(); // id -> { names: Set<string>, countById: Map<oppId, count> }
for (const s of shows) {
  for (const m of s.matches ?? []) {
    if (!m.sides) continue;
    m.sides.forEach((side, si) => {
      let opponents = [];
      m.sides.forEach((side2, sj) => { if (sj !== si) opponents = opponents.concat(side2); });
      for (const id of side) {
        const o = opponentJoinById.get(id) ?? { names: new Set(), countById: new Map() };
        for (const oppId of opponents) {
          const oppEntity = byId.get(oppId);
          o.names.add(oppEntity ? oppEntity.name : oppId);
          o.countById.set(oppId, (o.countById.get(oppId) ?? 0) + 1);
        }
        opponentJoinById.set(id, o);
      }
    });
  }
}

// THE INDEX-FEEDBACK WAVE (2026-09-08, the Janitor): kebab-case registry
// vocabulary ("tag-team", "manager-of") reads as machinery on a served
// page — this is the one place a raw enum value becomes the plain English
// a visitor actually reads (a chip label, here; a relationship-nature
// chip in relationships.html borrows the same convention client-side).
function humanizeKind(k) {
  return String(k ?? "").split("-").filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function entityCard(e, opts = {}) {
  // THE HEADING LEVEL (2026-10-03): a card title is an h2 wherever the page
  // around it is a flat list under one h1 with nothing in between — the
  // instrument indexes AND the A-Z letter pages (kicker, h1, lede, cards)
  // both read that way, so both pass titleLevel: 2. It stays an h3 where a
  // section head already holds the h2 above it (a memorial page's own
  // Characters section, a wing's roster). Same type either way — style.css
  // holds a card title at the 20px Title register whichever element carries
  // it.
  const hl = opts.titleLevel === 2 ? "h2" : "h3";
  const tenurePromoIds = [...new Set((e.tenures ?? []).map((t) => t.promotion))];
  const promos = tenurePromoIds.map(promoLinkedLabel).join(", ");
  const aka = e.aka?.length ? `<div class="handle">aka ${e.aka.map(esc).join(", ")}</div>` : "";

  // Handler attribution: gone, except for a memorial. No "character of a
  // contributor" / "character of the promoter" rendering — the field can
  // stay in the data for later use, it just isn't shown here.
  const memorial = memorialByCharacterId.get(e.id);
  // A5 (THE MEMORIAL PAGES WAVE): every sitewide link to a memorial subject
  // re-points to that PERSON's own generated page, not the memorial hall's
  // front door — "every link to Sean elsewhere should be to his page, not
  // to the memorial front page" (the Janitor).
  const memorialLine = memorial
    ? `<div class="handle">in memoriam: <a href="/memorials/${esc(memorial.id)}.html">${esc(memorial.name)} (${esc(memorial.years)})</a></div>`
    : "";

  // ROSTER QA WAVE: the portrayal line moves OFF the list row entirely —
  // it's exactly the kind of prose color the "no prose blobs in the list"
  // rule above already keeps out; it belongs on the wrestler's own page
  // (generatePersonPage) only, not repeated on every directory listing.

  // ROSTER QA WAVE: the Boozler-rule badge moves OFF the list row — it
  // rendered inconsistently there (a data-completeness problem dressed as
  // a display bug) and belongs on the wrestler's own page only, where
  // generatePersonPage's full note block already renders it consistently
  // for every boozler_rule entity.
  // NO PROSE BLOBS IN THE LIST (THE HALLS OF FAME WAVE addendum, user gavel):
  // rows are name, aka, promotion tags, and unit links — full stop. `notes`
  // and `identity` reasoning are real, useful, and stay exactly where they
  // are in data/characters.json and data/units.json; they just don't belong
  // in a flat directory row. "A Table keeps its dignity in the data" — the
  // color is for a future per-wrestler page, not for the list.

  // Units (stables/teams) a character belongs to; members, for a unit —
  // linked straight to each other entity's own generated page now that one
  // exists, rather than a same-page characters.html anchor.
  let unitsLine = "";
  if (e.type !== "unit") {
    const memberOf = unitsByCharacterId.get(e.id) ?? [];
    if (memberOf.length) {
      unitsLine = `<div class="handle">Units: ${memberOf.map((u) => `<a href="/characters/${u.id}.html">${esc(u.name)}</a>`).join(", ")}</div>`;
    }
  } else if (e.members?.length) {
    // A member is linked only when its character is in the registry, through the alias map (preflight 176:
    // PRIME-ROSTER-1's theUPstarts named two PRIME-ROSTER-2 wrestlers while that wave was held a window, and
    // this row linked both to pages that did not exist). A member carrying only an id is billed by its
    // character's own name, never as an empty link; one with neither a known id nor a name is left out.
    const memberHtml = e.members.map((m) => {
      const raw = typeof m === "string" ? m : (m?.character_id ?? m?.id ?? null);
      const cid = raw ? (byId.has(raw) ? raw : resolveAlias(raw)) : null;
      const known = cid && byId.has(cid) ? byId.get(cid) : null;
      const name = (typeof m === "string" ? null : m?.name) ?? known?.name ?? null;
      if (known) return `<a href="/characters/${cid}.html">${esc(name ?? "")}</a>`;
      return name ? esc(name) : null;
    }).filter(Boolean);
    if (memberHtml.length) unitsLine = `<div class="handle">Members: ${memberHtml.join(", ")}</div>`;
  }

  // appearsIn is still tracked in full (see the idempotency fix above) even
  // though the list view no longer renders it — the backlink data is real
  // and correct, just reserved for a future per-wrestler page rather than
  // cluttering this row.

  // Reign count only — no list, no dates. Reign-by-reign detail stays on
  // the promotions/*/titles.html ledgers (the one source of truth); this is
  // just a pointer that there's a title history worth reading there.
  // THE TEAM REIGNS (hook c96): the total counts reigns won as part of a team,
  // and so does data-reigns (the min-reigns filter) below.
  const reignCount = reignTotal(e.id);
  const reignsLine = reignCount
    ? `<div class="handle">Title reigns: ${reignCount}${reignTeamNote(e.id)}</div>`
    : "";
  // hook c227 (THE W-L-D RECORDS): the observed career record beside the reign count this row already shows;
  // display-only (no data- attribute, no new index field), the same museum-observed register as the page's career line.
  const obsCareerRow = observedCareerFor(e.id);
  const observedRowLine = obsCareerRow
    ? `<div class="handle">Observed record (W-L-D): ${obsText(obsCareerRow.rec)} <span class="muted small">(museum-counted, ${obsMatchesWord(obsCareerRow.n)})</span></div>`
    : "";
  // THE RECORDS AS SEARCH FIELDS (hook c229, lane RECORDS-INDEX-SEARCH, 2026-10-09; the Janitor, chat: "we should
  // display the per character records on the character index with search functionality"). The same career record, as
  // data attributes on the INDEX row only (includeCaption === false is entityIndexRows; the A-Z registers have no filter
  // script and stay as they are), so writeIndexV2 carries them in the row's `a` and js/query.js takes them as numbers:
  // wins:>=20, winpct:60..100, matches:10..50, nc:>0, -matches: (never parsed). wins/losses/draws/nc/matches whenever the
  // row has a parsed match; winpct = round(100 * wins / (wins + losses)) only when wins + losses >= 5 (a draw, a no
  // contest or an unresolved match decides nothing). characters.html / units.html sort on them. A figure row (hook c113)
  // does not get them: it unions named card attributes only, and summing separate portrayals' records would merge them
  // across promotions (CURATION v96).
  const recordAttrs = obsCareerRow && opts.includeCaption === false
    ? (() => {
      const r = obsCareerRow.rec, dec = r.w + r.l;
      return ` data-wins="${r.w}" data-losses="${r.l}" data-draws="${r.d}" data-nc="${r.nc}" data-matches="${obsCareerRow.n}"${dec >= 5 ? ` data-winpct="${Math.round((100 * r.w) / dec)}"` : ""}`;
    })()
    : "";

  // THE NONHUMAN DATATYPE WAVE: "species" joins the search blob so typing
  // "camel" or "chimpanzee" on characters.html actually surfaces these
  // entities — the blob was name+aka only before this, and neither field
  // says what an entity IS. Not free by construction; wired deliberately.
  // THE UNITS SPLIT (REVIEW-FIXES WAVE, 2026-08-22): a unit's own members
  // and kind join its blob too, so units.html finds a team by any member's
  // name or by "tag-team"/"stable" typed plain.
  const unitBlobBits = e.type === "unit"
    ? [(e.unit_kind ?? ""), ...(e.members ?? []).map((m) => m.name ?? "")]
    : [];
  const searchBlob = esc([e.name, ...(e.aka ?? []), e.species ?? "", ...unitBlobBits].join(" ").toLowerCase());
  // Pipe-delimited acronym-year labels, not raw ids — the filter input
  // holds what the visitor typed/picked ("IWF (1998)"), and boundaryMatch()
  // needs a real delimiter between entries so "iwf" can't false-positive
  // match inside "GIWF (1999)" (their letters overlap). THE
  // PROMOTION-DERIVATION WAVE: this is the one FILTERABLE field, so it
  // draws on derivedPromoIds (tenure + appearance + RP + reign) rather than
  // tenurePromoIds alone — the prose line above (`promos`) stays
  // tenure-only, a cameo is never displayed as a membership, but a search
  // or promo filter still has to be able to FIND the cameo.
  const searchPromoIds = derivedPromoIds(e);
  // THE DEEP-LINK ID FIX: the raw promotion id rides along beside the
  // acronym-year label (same fix as renderMatchRow's data-participant,
  // above) — a wing's own ?promo=<id> link and a promotion whose id
  // happens to differ from its acronym both resolve correctly, not just
  // the coincidental case where id === acronym.toLowerCase().
  const promoAttr = esc(searchPromoIds.flatMap((pid) => [(acronymLabel(promoById.get(pid)) || pid).toLowerCase(), pid]).join(" | "));

  // RICHER ROSTER FILTERS (user directive, folded into this wave):
  // data-reigns for a numeric "min title reigns" filter (0 default — a
  // plain number, not the "Title reigns: N" prose line above, which stays
  // display-only); data-style over the per-tenure DECLARED style vocabulary
  // only (never observed_moves — moves are vocabulary, not style, per the
  // same directive); data-memorial holds the linked memorial's own name(s),
  // omitted entirely (not emitted empty) when there's no link, so the
  // filter's own datalist never has to special-case "no memorial."
  const rawStyles = [...new Set((e.tenures ?? []).map((t) => t.style).filter(Boolean))];
  // STYLE FAMILIES: widen the filterable value with every family a raw
  // style resolves to (docs/SCHEMA.md's finding-aid layer) — typing/picking
  // a family name ("Hardcore") still hits this row via the same plain
  // substring filter that already matches raw style text; the verbatim
  // strings stay first in the joined value and alone are what ever renders
  // anywhere else.
  const styleFamilies = [...new Set(rawStyles.flatMap((s) => styleFamilyByVariant.get(s) ?? []))];
  const styleAttr = esc([...rawStyles, ...styleFamilies].join(" | ").toLowerCase());
  const memorialAttr = memorial ? ` data-memorial="${esc(memorial.name)}"` : "";
  // THE NONHUMAN DATATYPE WAVE, roster-parity pass: a species typeahead
  // needs its own filter attribute distinct from the free-text search blob
  // above (that blob is substring-anywhere; a dedicated attribute lets the
  // filter row offer a real typeahead of known species values). Omitted
  // entirely for an ordinary human entity, same "don't emit empty" contract
  // memorialAttr already uses.
  const speciesAttr = e.nonhuman && e.species ? ` data-species="${esc(e.species)}"` : "";
  const nonhumanAttr = e.nonhuman ? ` data-nonhuman="true"` : "";

  // ROSTER-CARD STAMPS (THE GRAPH-ENRICHMENT WAVE): data-roles (every
  // distinct tenure roles[] value, pipe-joined, the same aggregate-and-
  // join convention data-style already uses one field over — named
  // "roles" plural, not "role", so it matches search.html's own live
  // flattenFields() join field name exactly) and data-staged-gender
  // (the raw value, "unknown" included — a real checked-and-recorded
  // state, not an absent one; js/query.js aliases the attribute's own
  // hyphenated name back to the JSON field's real underscore) — list-page
  // query parity with what search.html already supports.
  const rawRoles = [...new Set((e.tenures ?? []).flatMap((t) => t.roles ?? []))];
  const rolesAttr = rawRoles.length ? ` data-roles="${esc(rawRoles.join(" | "))}"` : "";
  const stagedGenderAttr = e.staged_gender ? ` data-staged-gender="${esc(e.staged_gender)}"` : "";
  // THE UNITS SPLIT: `kind:` as a real filterable field on a unit row
  // (tag-team/trio/stable/entourage/other — units.json's own unit_kind
  // vocabulary), omitted entirely off character rows per the usual
  // don't-emit-empty contract.
  const unitKindAttr = e.type === "unit" && e.unit_kind ? ` data-kind="${esc(e.unit_kind)}"` : "";
  // PORTRAYALS (CURATION.md v78(e), 2026-08-24): "The presence of
  // `portrayal_of` IS the distinguishing facet between portrayal and
  // original characters; character listings filter on it in BOTH
  // directions." Both directions is why this attribute breaks the
  // don't-emit-empty contract every attribute above it keeps, and it is the
  // only one here that does: an absent attribute is unqueryable, so
  // `portrayal:no` would have no rows to match and "show me the fed's own
  // creations" — the more interesting half of the filter — could not be
  // asked at all. The value is yes/no rather than the figure id because the
  // question the listing answers is which KIND of character this is; the
  // figure itself is on the card's own page, and gathers its portrayals on
  // its own page.
  const portrayalAttr = ` data-portrayal="${e.portrayal_of ? "yes" : "no"}"`;

  // FIELD PARITY BY BUILD-TIME STAMPING — opponentJoinById (built above,
  // see its own comment) widened onto the card as `opponent`/`opponents`,
  // the same two fields search.html's own live join produces off the same
  // data/shows.json matches[].sides. Omitted entirely for an entity with
  // no parsed match, same "don't emit empty" contract memorialAttr/
  // speciesAttr already use. Pipe-delimited, same multi-value convention
  // every other multi-value attribute here (data-promo, data-style) uses —
  // js/query.js's fieldsFromElement() already splits on it.
  const opponentJoin = opponentJoinById.get(e.id);
  const opponentNames = opponentJoin ? [...opponentJoin.names] : [];
  const opponentAttr = opponentNames.length
    ? ` data-opponent="${esc(opponentNames.join(" | "))}" data-opponents="${opponentJoin.countById.size}"`
    : "";

  // THE CAPTIONS WAVE: the ONE sanctioned exception to "no prose blobs in
  // the list" above — a hand-vetted, one-sentence museum label (never raw
  // `notes`/`identity` research prose) renders as the row's own sub-line,
  // truncated by CSS (.caption-line) where space doesn't allow the full
  // sentence rather than omitted outright.
  // THE INDEX-FEEDBACK WAVE (2026-09-08, the Janitor): the caption line
  // truncates most of the time on the flat aggregate index (characters.html
  // /units.html, one row of many in a fast-scrolling list) and is dropped
  // there — `opts.includeCaption === false` is how entityIndexRows (below)
  // asks for that. The A-Z registers (generateAlphaRegister's own call
  // sites) pass no opts and keep the caption exactly as before — those are
  // the complete, one-sentence-per-entity reference documents, not the
  // fast list, and the Janitor's ask was scoped to "the aggregate index."
  const captionLine = (opts.includeCaption !== false && e.caption) ? (() => { const v = servedText(e.caption); return v ? `<p class="muted small caption-line"${captionLangAttr(e, promoById.get(tenurePromoIds[0]))}>${linkCaptionHtml(v, e.id, new Set(tenurePromoIds))}${captionEn(e)}</p>` : ""; })() : "";

  // THE INDEX-FEEDBACK WAVE: "Character"/"Unit" was a leftover label from
  // when both types shared one listing (every row said it, redundantly,
  // on a page that's already type-scoped) — retired outright, no
  // replacement text for a character row. A unit's own KIND (tag team,
  // stable, trio, entourage) is real information, not filler, so it
  // survives as a chip instead of prose — visually distinct the way
  // promotions.html's own tag-style sub-line reads, not a plain word.
  // THE UNIT CHIPS (hook c145, the Janitor's site sweep 2026-10-08): the type and the wing are two chips on the card's own
  // chip line, under the name, not a chip and bare linked text run together at the foot: the type is a stamp that differs by
  // kind (style.css .chip-unit[data-unit-kind=...]), the wing a plain-case pill that links to it (.chip-wing). The
  // data-unit-kind is the unit_kind value itself; the row's own data-kind (unitKindAttr) carries the card-edge styling.
  const kindChip = e.type === "unit" && e.unit_kind
    ? `<span class="chip chip-unit" data-unit-kind="${esc(e.unit_kind)}">${esc(humanizeKind(e.unit_kind))}</span>`
    : "";
  const wingChip = (pid) => {
    const h = promoLinkedLabel(pid);
    return h.startsWith("<a ") ? h.replace("<a ", '<a class="chip chip-wing" ') : `<span class="chip chip-wing">${h}</span>`;
  };
  const unitWingChips = e.type === "unit" ? tenurePromoIds.map(wingChip).join("") : "";
  // CHARACTER CHIPS (wave-C90-L286, the Janitor's direction 2026-09-06: "a
  // visible distinction between real wrestler ... depictions and fictional
  // characters. Also probably the medium they were observed in ... years
  // they were seen active" — in line with promotions.html's own tier/
  // medium/years chip row). Units carry their own unit_kind chip already
  // (unitKindAttr, above) and are excluded here — this is a
  // characters-only surface, matching the Janitor's own wording ("wrestler
  // primary listing"). `kind` restates the same fact data-portrayal
  // already carries (yes/no) as a queryable value (`kind:depiction`) plus
  // a visible chip; `medium` is read off each tenure's own promotion
  // (promoById, already built above, keyed by tenures[].promotion, which
  // every tenure on file carries); `years` is the min first_seen / max
  // last_seen across tenures, year precision only (first_seen/last_seen
  // are plain strings, YYYY or longer — never {date,...} objects the way
  // promotions.json's founded/closed are), omitted entirely when no
  // tenure carries one. All three ride as data-* attributes on the SAME
  // .roster-card div every other filterable field here already uses, so
  // js/query.js's existing, fully-generic fieldsFromElement() picks them
  // up for free — no js/query.js change needed, same as data-portrayal/
  // data-species/data-roles above.
  let kindAttr = "", mediumAttr = "", yearsAttr = "", chipsLine = "";
  if (e.type !== "unit") {
    const kindValues = [];
    if (e.portrayal_of) kindValues.push("depiction");
    if (e.nonhuman) kindValues.push("nonhuman");
    const kindChipsHtml = kindValues.map((k) => `<span class="chip chip-kind" data-kind="${esc(k)}">${esc(CHARACTER_KIND_LABEL[k] || k)}</span>`).join("");
    if (kindValues.length) kindAttr = ` data-kind="${esc(kindValues.join(" | "))}"`;

    const tenureMediums = [...new Set((e.tenures ?? []).map((t) => promoById.get(t.promotion)?.medium).filter(Boolean))];
    const mediumChipsHtml = tenureMediums.map((m) => `<span class="chip chip-medium" data-medium="${esc(m)}">${esc(MEDIUM_LABEL[m] || m)}</span>`).join("");
    if (tenureMediums.length) mediumAttr = ` data-medium="${esc(tenureMediums.join(" | "))}"`;

    const tenureYears = (e.tenures ?? []).flatMap((t) => [t.first_seen, t.last_seen]).map((d) => { const m = typeof d === "string" ? /^(\d{4})/.exec(d) : null; return m ? m[1] : null; }).filter(Boolean);
    let yearsChipHtml = "";
    if (tenureYears.length) {
      const fy = tenureYears.reduce((a, b) => (b < a ? b : a));
      const cy = tenureYears.reduce((a, b) => (b > a ? b : a));
      yearsChipHtml = `<span class="chip chip-years">${esc(fy === cy ? fy : `${fy}\u2013${cy}`)}</span>`;
      yearsAttr = ` data-years="${esc(fy === cy ? fy : `${fy} | ${cy}`)}"`;
    }
    if (kindChipsHtml || mediumChipsHtml || yearsChipHtml) chipsLine = `<div class="handle">${kindChipsHtml}${mediumChipsHtml}${yearsChipHtml}</div>`;
  } else if (kindChip || unitWingChips) {
    chipsLine = `<div class="handle">${kindChip}${unitWingChips}</div>`;
  }
  const html = `<div class="roster-card" id="${e.id}" data-search="${searchBlob}" data-promo="${promoAttr}" data-reigns="${reignCount}" data-style="${styleAttr}"${memorialAttr}${speciesAttr}${nonhumanAttr}${opponentAttr}${rolesAttr}${stagedGenderAttr}${unitKindAttr}${portrayalAttr}${kindAttr}${mediumAttr}${yearsAttr}${recordAttrs}><${hl}><a href="/characters/${e.id}.html">${esc(e.name)}</a></${hl}>${memorialLine}${aka}${chipsLine}${unitsLine}${reignsLine}${observedRowLine}${e.type === "unit" ? "" : `<p class="muted small">${promos || "—"}</p>`}${captionLine}</div>`;

  // THE 397/400 FUSE WAVE: entityCard now returns the row's full metadata,
  // not just its HTML — characters.html (the search/filter INSTRUMENT) needs
  // the raw search/promo/style/reigns/memorial values to build
  // data/characters-index.json, the JSON it fetches at runtime instead of
  // having every row baked into its own HTML source. The A-Z pages (the
  // complete, no-JS, repo-complete documents) still just want `.html`.
  return {
    html, search: searchBlob, promo: promoAttr, style: styleAttr, reigns: reignCount,
    memorial: memorial ? memorial.name : null,
    opponent: opponentNames.length ? opponentNames.join(" | ") : null,
    opponents: opponentJoin ? opponentJoin.countById.size : 0
  };
}

// DISAMBIGUATION DE-NARRATION, RETIRED (user gavel — this is the FOURTH
// recurrence of a fix here: a box, then a labeled line, then an orphaned
// pre-list float, then an ordinary-but-still-annotated row. The concept
// itself is gone now, not restyled again — a name still ambiguous after
// promotion-context narrowing is left as plain, unlinked text wherever it's
// mentioned in prose (see the strip pass + `bigRe` branch above), and the
// wrestlers list carries no synthetic "shared name" row at all: two
// same-named entities sorted next to each other in the ordinary alphabetical
// flow are self-evident on their own, per the user's own words.

// Flat, alphabetical — sortKeyStr() ignores a leading "The " so "The
// Phenomenons" files under P, not T. No per-promotion sections: family and
// promotion are a filter you reach for, never page structure.
const flatEntities = [...entities].sort((a, b) => {
  const ka = sortKeyStr(a.name), kb = sortKeyStr(b.name);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
});
// THE 397/400 FUSE WAVE — the JSON index characters.html (the instrument)
// fetches at runtime, one row object per entity, HTML pre-rendered server
// side (entityCard) so the browser never re-implements the roster-card
// business logic — it just injects `.html` strings and filters on the
// plain metadata fields alongside them, same contract shows.html/rps.html
// already used for their own rows. This is what keeps characters.html's OWN
// served HTML near-zero rows regardless of registry size — the row-budget
// validator watches the BAKED pages (the A-Z pages) instead, which is
// where the real growth-vs-budget tension now lives.
// THE UNITS SPLIT (REVIEW-FIXES WAVE, 2026-08-22, the Janitor: a coverage count
// over characters was polluted by the genderless unit rows sharing the same
// listing): characters.html and units.html are now SEPARATE instruments over
// separate indexes — one row set per type, so each page's own results
// counter reads a true per-type total. Per-entity pages are unchanged (a
// unit's page still lives at /characters/<id>.html); the A-Z registers are
// split to match, one per type (the A-Z REGISTERS rider, §2b below).
function entityIndexRows(list) {
  return list
    .map((e) => {
      // includeCaption: false — see entityCard's own comment: the aggregate
      // index (this function's two callers, charactersIndex/unitsIndex
      // below) drops the caption line; the A-Z registers keep it.
      const c = entityCard(e, { includeCaption: false, titleLevel: 2 });
      // THE SLIM-INDEX WAVE (2026-10-03): the row carries its markup and
      // nothing else. search/promo/style/reigns/memorial/opponent(s) were
      // written here a second time, HTML-escaped, beside the same values
      // the card's own data-* attributes already held, and characters.html
      // never read one of them; writeIndexV2 derives the queryable map
      // from the markup instead, so there is only one copy to keep true.
      return { id: e.id, sortName: e.name, html: c.html };
    })
    .sort((a, b) => {
      const ka = sortKeyStr(a.sortName), kb = sortKeyStr(b.sortName);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    })
    .map(({ sortName, ...row }) => row);
}
// ONE ROW PER PORTRAYED REAL PERSON (hook c113, 2026-10-07). The Janitor, in
// chat: "Is there a way to have the portrayals be unique per depiction but
// perhaps not aggregated on the character index? I'm just thinking that over
// time there would presumably be 1000 depictions of Austin, which seems silly
// to list one after another on the character index, and fixing this now
// structurally would save us frustration in the future." So the character
// index lists a portrayed real wrestler ONCE, as the figure: its row names
// the figure, links to /figures/<id>.html (CURATION.md v78(d): "the one place
// all portrayals of a given wrestler gather, and the search surface for
// them"), and says how many promotions staged him and when. The per-promotion
// portrayal rows themselves are untouched (v96: "exclusively in the
// per-promotion portrayals, never merged across promotions, always linked by
// the portrayal edge"): each keeps its own page, its A-Z register row, its
// roster/card/match links, and is listed on the figure page.
//   * Folded: a character (never a unit) carrying `portrayal_of` whose figure
//     resolves and sits on its own `portrays` (registry-validate.mjs holds
//     both). `portrayal_of` ONLY: a `portrays` edge without it (a namesake,
//     or a canon portrayal) stays an ordinary row.
//   * The figure row is queryable on everything its portrayals were: every
//     multi-value field is the union of theirs, `reigns` and `opponents` the
//     totals, `years` the span, and the search blob carries the figure's name
//     and every portrayal's own name and aka. `promotion:faw` still finds
//     FAW's Lex Luger, by his figure. v78(e) "character listings filter on it
//     in both directions": data-portrayal stays, "yes" on a figure row and
//     "no" on every original; the kind is "real-person" (chip "Real person"),
//     the "Depiction" chip stays on the A-Z registers' per-promotion rows.
//   * registry-validate.mjs 8b counts the index the same way (characters,
//     less the folded rows, plus one row per figure).
function entityYearSpan(e) {
  const ys = (e.tenures ?? []).flatMap((t) => [t.first_seen, t.last_seen]).map((d) => { const m = typeof d === "string" ? /^(\d{4})/.exec(d) : null; return m ? m[1] : null; }).filter(Boolean);
  if (!ys.length) return null;
  return [ys.reduce((a, b) => (b < a ? b : a)), ys.reduce((a, b) => (b > a ? b : a))];
}
function isIndexFoldedPortrayal(e) {
  if (e.type === "unit" || typeof e.portrayal_of !== "string" || !externalById.has(e.portrayal_of)) return false;
  const list = e.portrays ? (Array.isArray(e.portrays) ? e.portrays : [e.portrays]) : [];
  return list.some((pt) => pt && pt.figure === e.portrayal_of);
}
const indexFoldByFigure = new Map(); // figure id -> [entity], in flatEntities (name) order
for (const e of flatEntities) {
  if (!isIndexFoldedPortrayal(e)) continue;
  const arr = indexFoldByFigure.get(e.portrayal_of) ?? [];
  arr.push(e);
  indexFoldByFigure.set(e.portrayal_of, arr);
}
function figureIndexRow(f, members) {
  const where = "characters-index.json";
  const cards = members.map((e) => splitIndexRow(entityCard(e, { includeCaption: false, titleLevel: 2 }).html, where).attrsRaw);
  const union = (name) => {
    const seen = new Set(), out = [];
    for (const a of cards) for (const v of unescAttr(a[name] ?? "").split(" | ")) if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    return out;
  };
  const blobSeen = new Set(), blob = [];
  for (const b of [f.name.toLowerCase(), ...(Array.isArray(f.aka) ? f.aka : []).map((a) => String(a).toLowerCase()), ...cards.map((a) => unescAttr(a.search ?? "").trim())]) {
    if (b && !blobSeen.has(b)) { blobSeen.add(b); blob.push(b); }
  }
  const reigns = cards.reduce((n, a) => n + (Number(unescAttr(a.reigns ?? "0")) || 0), 0);
  const opp = new Set();
  for (const e of members) for (const id of opponentJoinById.get(e.id)?.countById.keys() ?? []) opp.add(id);
  const kinds = ["real-person", ...union("kind").filter((k) => k !== "depiction" && k !== "real-person")];
  const mediums = union("medium");
  const yearVals = union("years").filter((y) => /^\d{4}$/.test(y));
  const fy = yearVals.length ? yearVals.reduce((a, b) => (b < a ? b : a)) : null;
  const cy = yearVals.length ? yearVals.reduce((a, b) => (b > a ? b : a)) : null;
  const attr = (name, vals) => (vals.length ? ` data-${name}="${esc(vals.join(" | "))}"` : "");
  const memorials = union("memorial"), species = union("species"), opponents = union("opponent"), roles = union("roles"), genders = union("staged-gender");
  const attrs = `data-search="${esc(blob.join(" "))}" data-promo="${esc(union("promo").join(" | "))}" data-reigns="${reigns}" data-style="${esc(union("style").join(" | "))}"`
    + attr("memorial", memorials) + attr("species", species) + (cards.some((a) => a.nonhuman === "true") ? ` data-nonhuman="true"` : "")
    + (opponents.length ? ` data-opponent="${esc(opponents.join(" | "))}" data-opponents="${opp.size}"` : "")
    + attr("roles", roles) + attr("staged-gender", genders) + ` data-portrayal="yes"` + attr("kind", kinds) + attr("medium", mediums)
    + (fy ? ` data-years="${esc(fy === cy ? fy : `${fy} | ${cy}`)}"` : "");
  const chips = kinds.map((k) => `<span class="chip chip-kind" data-kind="${esc(k)}">${esc(CHARACTER_KIND_LABEL[k] || k)}</span>`).join("")
    + mediums.map((m) => `<span class="chip chip-medium" data-medium="${esc(m)}">${esc(MEDIUM_LABEL[m] || m)}</span>`).join("")
    + (fy ? `<span class="chip chip-years">${esc(fy === cy ? fy : `${fy}–${cy}`)}</span>` : "");
  const promoIds = [...new Set(members.flatMap((e) => (e.tenures ?? []).map((t) => t.promotion)))];
  let line;
  if (members.length <= 3) {
    line = "Portrayed as " + members.map((e) => {
      const ps = [...new Set((e.tenures ?? []).map((t) => t.promotion))].map(promoLinkedLabel).join(", ");
      return `<a href="/characters/${e.id}.html">${esc(e.name)}</a>${ps ? ` in ${ps}` : ""}`;
    }).join("; ");
  } else {
    const n = promoIds.length;
    line = !n ? `${members.length} portrayals` : members.length === n ? `Portrayed in ${n} promotions` : `${members.length} portrayals in ${n} promotion${n === 1 ? "" : "s"}`;
  }
  const id = `figure-${f.id}`;
  return { id, sortName: f.name, html: `<div class="roster-card" id="${id}" ${attrs}><h2><a href="/figures/${esc(f.id)}.html">${esc(f.name)}</a></h2><div class="handle">${chips}</div><p class="muted small">${line}</p></div>` };
}
const figureIndexRows = [...indexFoldByFigure.entries()].map(([fid, members]) => figureIndexRow(externalById.get(fid), members));
const indexOwnCharacters = flatEntities.filter((e) => e.type !== "unit" && !isIndexFoldedPortrayal(e));
const indexOwnNames = new Map(indexOwnCharacters.map((e) => [e.id, e.name]));
const charactersIndex = [
  ...entityIndexRows(indexOwnCharacters).map((r) => ({ ...r, sortName: indexOwnNames.get(r.id) })),
  ...figureIndexRows,
].sort((a, b) => {
  const ka = sortKeyStr(a.sortName), kb = sortKeyStr(b.sortName);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}).map(({ sortName, ...row }) => row); // wrestlersIndex, renamed THE FRONT-ENTRANCE RENAME (2026-08-20)
writeIndexV2(resolve(DATA, "characters-index.json"), "characters_index", charactersIndex, { where: "characters-index.json" });
const unitsIndex = entityIndexRows(flatEntities.filter((e) => e.type === "unit"));
writeIndexV2(resolve(DATA, "units-index.json"), "units_index", unitsIndex, { where: "units-index.json" });
console.log(`cross-reference: ${charactersIndex.length} character rows + ${unitsIndex.length} unit rows indexed (characters-index.json / units-index.json).`);

// ---------------------------------------------------------------------------
// 2b. Generated alphabetical registers (THE PAGINATION ARCHITECTURE WAVE,
//     generalized by the A-Z REGISTERS rider of THE PROMOTIONS-PATH WAVE,
//     2026-08-22): every ENTITY surface carries a complete, no-JS
//     alphabetical register — characters and units each their own (the
//     old merged register split in two), plus promotions, championships,
//     and awards. EVENT-shaped types register chronologically instead
//     (shows/<year>/ and rps/<year>/, §2c/§2d below): entities register
//     alphabetically, events chronologically. A register is the
//     completeness fallback, not the instrument — each instrument page
//     links its own register through the `<!-- register:start/end -->`
//     marker it carries (patched below, same idempotent convention as
//     chrome/seasons), and every register page links back.
//     One shared generator: a single letter-grouped index.html while the
//     whole register fits row_budget; one file per letter once it doesn't,
//     sub-split within a letter only past row_budget again (characters
//     today; anything else the day it grows there).
// ---------------------------------------------------------------------------
const siteConfig = JSON.parse(readFileSync(resolve(DATA, "site-config.json"), "utf8"));
const SITE_PUBLIC = siteConfig.public === true;  // kept beside siteConfig (coordinator 2026-09-06): depends on it
const ROW_BUDGET = siteConfig.row_budget;

function registerShell({ title, instrumentHref, instrumentLabel, rootHref, rootLabel, crumbTail, bodyHtml, rel }) {
  const crumbTailHtml = crumbTail
    ? `<a href="${rootHref}">${rootLabel}</a> &nbsp;/&nbsp; ${esc(crumbTail)}`
    : rootLabel;
  const main = `<p class="crumb"><a href="/">Museum</a> &nbsp;/&nbsp; <a href="${instrumentHref}">${esc(instrumentLabel)}</a> &nbsp;/&nbsp; ${crumbTailHtml}</p>

  ${bodyHtml}`;
  const footerLine = `THE E-WRESTLING MUSEUM <span class="rule">/</span> ${esc(instrumentLabel)} <span class="rule">/</span>
    <a href="${rootHref}">back to ${rootLabel}</a><br>
    Generated 2026 from the entity registry &mdash; not backdated. See
    <a href="/curation.html">Curation</a>.`;
  return pageShell({ title: `${title} &mdash; E-WRESTLING MUSEUM`, main, footerLine, rel });
}

// Sub-split label: first-two-sortKey-chars span of a chunk's own first/last
// entry ("sa-sm" style) — only used once a single letter exceeds budget.
function chunkKeyOf(key) {
  return key.slice(0, 2).replace(/[^a-z0-9]/g, "").padEnd(2, "-");
}

// DESIGN-REGISTER (2026-10-03, Impeccable critique P1): human range labels for a letter's chunks.  The old label
// repeated the letter in front of a two-character span that already began with it ("Aa–Aak" was really "A–AK"; "Jja–Jja"
// merged nothing).  A label is now the entries' own first letters, each word capitalised: the letter's first range starts at the
// letter ("A–Aak"), every other boundary uses the shortest prefix (min 3 chars) that tells the two neighbouring chunks
// apart, equal endpoints merge ("Jja–Jja" -> "Jja"), and a still-colliding label takes a "(2)" suffix.  File names
// (chunkKeyOf slugs) are NOT touched: they are published URLs.
function rangeLabels(letter, chunks) {
  const title = letter === "0-9" ? "0\u20139" : letter.toUpperCase();
  const cap = (s) => s.trimEnd().replace(/(^|\s)([a-z])/g, (m, sp, ch) => sp + ch.toUpperCase());
  const first = (c) => c[0].key, last = (c) => c[c.length - 1].key;
  const boundary = (a, b) => {
    const max = Math.max(a.length, b.length);
    for (let n = 3; ; n++) if (a.slice(0, n) !== b.slice(0, n) || n >= max) return [cap(a.slice(0, n)), cap(b.slice(0, n))];
  };
  const labels = chunks.map((c, i) => {
    const from = i === 0 ? title : boundary(last(chunks[i - 1]), first(c))[1];
    const to = i === chunks.length - 1 ? cap(last(c).slice(0, 3)) : boundary(last(c), first(chunks[i + 1]))[0];
    return from.toLowerCase() === to.toLowerCase() ? from : `${from}\u2013${to}`;
  });
  const seen = new Map();
  return labels.map((l) => { const n = (seen.get(l) ?? 0) + 1; seen.set(l, n); return n === 1 ? l : `${l} (${n})`; });
}

// rows: [{ key, html }], key = sortKeyStr-shaped, presorted; html is either
// a roster-card block (shape "cards") or a bare <li> (shape "list", wrapped
// in an archive-list <ul> per letter/page here).
// `indexLede` (hook c207, the Janitor's D479) -- optional HTML for the register
// INDEX page's own lede paragraph, in place of the default one below. Only the
// characters register passes it, to say the folded count the Characters list
// shows; every other register leaves it undefined and its lede is unchanged.
function generateAlphaRegister({ dirName, urlBase, instrumentHref, instrumentLabel, noun, rows, shape, indexLede }) {
  const dirAbs = resolve(ROOT, ...dirName.split("/"));
  mkdirSync(dirAbs, { recursive: true });
  const byLetter = new Map();
  for (const r of rows) {
    const ch = r.key.charAt(0);
    const letter = ch >= "a" && ch <= "z" ? ch : "0-9";
    const list = byLetter.get(letter) ?? [];
    list.push(r);
    byLetter.set(letter, list);
  }
  const sortedLetters = [...byLetter.keys()].sort();
  const wrapRows = (list) => shape === "list"
    ? `<ul class="archive-list">\n    ${list.map((r) => r.html).join("\n    ")}\n  </ul>`
    : list.map((r) => r.html).join("\n");
  const shellOpts = { instrumentHref, instrumentLabel, rootHref: urlBase, rootLabel: "A&ndash;Z" };

  // Whole register within budget: one letter-grouped page, letters as
  // in-page anchors (the single-A-Z-page shape — promotions, championships,
  // awards, units today).
  if (rows.length <= ROW_BUDGET) {
    const sections = sortedLetters.map((letter) =>
      `<h2 id="${esc(letter)}">${esc(letter.toUpperCase())}</h2>\n  ${wrapRows(byLetter.get(letter))}`
    ).join("\n\n  ");
    const body = `<span class="kicker">${esc(instrumentLabel)} &mdash; A&ndash;Z</span>
  <h1>Browse alphabetically.</h1>
  <p class="lede">${indexLede ?? `${rows.length} ${noun}${rows.length === 1 ? "" : "s"}, complete and unfiltered, one static
  no-JS document (leading &ldquo;The&rdquo; ignored, same rule the search
  instrument sorts by) &mdash; see <a href="${instrumentHref}">${esc(instrumentLabel)}</a>
  for search/filter over the full registry.`}</p>

  ${sections}`;
    writeFileSync(resolve(dirAbs, "index.html"), registerShell({ ...shellOpts, title: `${instrumentLabel} A–Z`, crumbTail: null, bodyHtml: body, rel: `${dirName}/` }));
    return { single: true, urlBase, letters: sortedLetters, byLetter, pages: 1, rows: rows.length };
  }

  // Over budget: one file per letter, sub-split within a letter only past
  // budget again (the characters shape).
  const letterPages = [];
  for (const letter of sortedLetters) {
    const list = byLetter.get(letter);
    if (list.length <= ROW_BUDGET) {
      letterPages.push({ letter, file: `${letter}.html`, label: letter.toUpperCase(), rows: list });
      continue;
    }
    const chunks = [];
    for (let i = 0; i < list.length; i += ROW_BUDGET) chunks.push(list.slice(i, i + ROW_BUDGET));
    // 2026-09-22 (preflight 167): two consecutive chunks can share the same two-letter span (hundreds of "Mi…" names:
    // Mike, Michael, Mitch) — both were named mmi-mmi.html and the second silently overwrote the first, dropping 400 rows
    // from the register. A repeated span now takes a numeric suffix, so every chunk keeps its own file.
    const usedSlugs = new Set();
    const chunkLabels = rangeLabels(letter, chunks);
    chunks.forEach((chunk, ci) => {
      const from = chunkKeyOf(chunk[0].key), to = chunkKeyOf(chunk[chunk.length - 1].key);
      let slug = `${letter}${from}-${letter}${to}`;
      for (let n = 2; usedSlugs.has(slug); n++) slug = `${letter}${from}-${letter}${to}-${n}`;
      usedSlugs.add(slug);
      letterPages.push({ letter, file: `${slug}.html`, label: chunkLabels[ci], rows: chunk });
    });
  }
  for (const page of letterPages) {
    const body = `<span class="kicker">${esc(instrumentLabel)} &mdash; A&ndash;Z</span>
  <h1>${esc(page.label)}</h1>
  <p class="lede">${page.rows.length} entr${page.rows.length === 1 ? "y" : "ies"}. Complete, unfiltered &mdash; see
  <a href="${instrumentHref}">${esc(instrumentLabel)}</a> for search/filter over the full registry.</p>

  ${wrapRows(page.rows)}`;
    writeFileSync(resolve(dirAbs, page.file), registerShell({ ...shellOpts, title: `${instrumentLabel} ${page.label}`, crumbTail: page.label, bodyHtml: body, rel: `${dirName}/` }));
  }
  // THE STALE-SPLIT SWEEP (2026-08-25): when a letter's row count crosses the
  // budget boundary, its split filenames change (s.html <-> ss--ssy.html
  // style) and the superseded files used to linger, unreachable — the gate
  // caught this four separate times across four accession waves before this
  // fix. Any .html in the register dir this run didn't just write (index
  // aside) is a stale artifact of an earlier boundary: delete it here, at the
  // one place that knows the current page set.
  {
    const wrote = new Set([...letterPages.map((p) => p.file), "index.html"]);
    for (const f of readdirSync(dirAbs)) {
      if (f.endsWith(".html") && !wrote.has(f)) unlinkSync(resolve(dirAbs, f));
    }
  }
  const indexBody = `<span class="kicker">${esc(instrumentLabel)} &mdash; A&ndash;Z</span>
  <h1>Browse alphabetically.</h1>
  <p class="lede">${indexLede ?? `Complete, static, no-JS documents &mdash; every ${noun},
  split by first letter (leading &ldquo;The&rdquo; ignored, same rule the
  search instrument sorts by). For search/filter over the whole registry
  at once, see <a href="${instrumentHref}">${esc(instrumentLabel)}</a>.`}</p>

  <ul class="archive-list">
    ${sortedLetters.map((letter) => {
      const pages = letterPages.filter((p) => p.letter === letter);
      const count = byLetter.get(letter).length;
      if (pages.length === 1) {
        return `<li><a href="${urlBase}${pages[0].file}">${esc(letter.toUpperCase())}</a> <span class="muted small">(${count})</span></li>`;
      }
      return `<li>${esc(letter.toUpperCase())} <span class="muted small">(${count}, split)</span> &mdash; ${pages.map((p) => `<a href="${urlBase}${p.file}">${esc(p.label)}</a>`).join(", ")}</li>`;
    }).join("\n    ")}
  </ul>`;
  writeFileSync(resolve(dirAbs, "index.html"), registerShell({ ...shellOpts, title: `${instrumentLabel} A–Z`, crumbTail: null, bodyHtml: indexBody, rel: `${dirName}/` }));
  return { single: false, urlBase, letters: sortedLetters, byLetter, letterPages, pages: letterPages.length + 1, rows: rows.length };
}

// DESIGN-REGISTER (2026-10-03): the line an instrument page carries inside its own `<!-- register:start/end -->` marker
// is ONE row of letters, 0-9 then A-Z, each linking that letter's first browse page (letter file when the register is
// letter-split, in-page anchor when it is a single document); a letter with no entries is plain text.  The range
// links stay on the A-Z index page itself.  Inline markup only (spans and anchors), so it is valid wherever the marker
// sits, inside a <p> or between blocks; styled by .az-row in style.css (see style-additions.css).
function registerBrowseLine(reg) {
  const hrefFor = (letter) => {
    if (reg.single) return `${reg.urlBase}#${letter}`;
    return `${reg.urlBase}${reg.letterPages.find((p) => p.letter === letter).file}`;
  };
  const cells = ["0-9", ..."abcdefghijklmnopqrstuvwxyz"].map((letter) => {
    const text = letter === "0-9" ? "0&ndash;9" : letter.toUpperCase();
    return reg.byLetter.has(letter)
      ? `<a href="${hrefFor(letter)}">${text}</a>`
      : `<span class="az-off">${text}</span>`;
  }).join("");
  return `<span class="az-row"><span class="az-label">Browse by letter</span><span class="az-letters">${cells}</span> <a class="az-all" href="${reg.urlBase}">${reg.single ? "Whole list" : "All ranges"}</a></span>`;
}

// hook c198 (findings B08/B09 of the 2026-10-09 adversarial review, the Janitor's D466): one marker patcher, by NAME. This
// was patchRegisterMarker and knew only the word "register"; halloffame.html now carries a second marker (hofrows) holding
// its baked list, so the marker name is a parameter and patchRegisterMarker is the one-line wrapper it always was.
function patchMarker(fileName, marker, innerHtml) {
  const p = resolve(ROOT, fileName);
  if (!existsSync(p)) return false;
  const cur = readFileSync(p, "utf8");
  const re = new RegExp(`<!-- ${marker}:start -->[\\s\\S]*?<!-- ${marker}:end -->`);
  if (!re.test(cur)) { console.warn(`cross-reference: ${fileName} has no ${marker}:start/end marker — bootstrap it by hand once`); return false; }
  const patched = cur.replace(re, `<!-- ${marker}:start -->\n    ${innerHtml}\n    <!-- ${marker}:end -->`);
  if (patched !== cur) writeFileSync(p, patched);
  return true;
}
function patchRegisterMarker(fileName, innerHtml) {
  return patchMarker(fileName, "register", innerHtml);
}

// hook c198: THE BAKED LIST. The server-side twin of js/list.js's renderRow(), fed the SAME { id, html } rows writeIndexV2 is
// given, so a page's baked rows and its painted rows cannot drift: tag and class come from the row itself (the same
// splitIndexRow the index writer uses), and the element id is emitted only when the row carries one. wireIndexList's paint()
// assigns container.innerHTML, so the first paint replaces these rows and nothing is drawn twice.
function bakedIndexRows(rows, where) {
  return rows.map((r) => {
    const part = splitIndexRow(r.html, where);
    return `<${part.tag}${part.cls ? ` class="${part.cls}"` : ""}${r.id ? ` id="${esc(r.id)}"` : ""}>${part.inner}</${part.tag}>`;
  }).join("");
}

// Characters — their own register now (the old merged characters+units
// register split, A-Z REGISTERS rider).
const charactersRegister = generateAlphaRegister({
  dirName: "characters/a-z", urlBase: "/characters/a-z/",
  instrumentHref: "/characters.html", instrumentLabel: "Characters", noun: "character",
  rows: flatEntities.filter((e) => e.type !== "unit").map((e) => ({ key: sortKeyStr(e.name), html: entityCard(e, { titleLevel: 2 }).html })),
  shape: "cards",
  // THE TWO DOORS SAY THE SAME NUMBER (hook c207; the Janitor's D479,
  // 2026-10-09, "keep the fold; make the counts agree with it"). The register
  // still LISTS every character one by one -- it is the completeness fallback,
  // and registry-validate.mjs holds it to the registry's own length -- so the
  // per-letter counts and each letter page's "N entries." count their own page
  // and are left alone. What the index now states is the museum's own count,
  // the folded one the Characters list shows, computed here every cycle from
  // the same rows that list is built from, so the two can never drift.
  indexLede: `${charactersIndex.length.toLocaleString("en-US")} characters and figures, the same count the Characters list shows. These pages list every character one by one, each portrayal of a real-world figure included, split by first letter (leading &ldquo;The&rdquo; ignored, same rule the search instrument sorts by). For search/filter over the whole registry at once, see <a href="/characters.html">Characters</a>.`,
});

// Units — the parallel register, units' own a-z/ dir.
const unitsRegister = generateAlphaRegister({
  dirName: "units/a-z", urlBase: "/units/a-z/",
  instrumentHref: "/units.html", instrumentLabel: "Units", noun: "unit",
  rows: flatEntities.filter((e) => e.type === "unit").map((e) => ({ key: sortKeyStr(e.name), html: entityCard(e, { titleLevel: 2 }).html })),
  shape: "cards",
});

// Wings — full name primary, acronym secondary, same convention as the
// wings listing itself. THE WINGS GAVEL (the Janitor, 2026-08-23): the
// DISPLAY LABEL is "Wings"; every path, id and url stays as minted.
const promotionsRegister = generateAlphaRegister({
  dirName: "promotions/a-z", urlBase: "/promotions/a-z/",
  instrumentHref: "/promotions.html", instrumentLabel: "Wings", noun: "promotion",
  rows: promotions.map((p) => {
    // L312 (C1): one label rule -- wingLabelFor(), declared beside
    // UNIT_KIND_LABEL.  The old composition nested acronymLabel()'s return
    // value (which IS the whole `name`, once the name carries its own trailing
    // parenthetical) inside `${qualifiedFullName(p)} (${acro})`, while
    // qualifiedFullName() re-appended a `qualifier` that mirrors that same
    // parenthetical -- three copies of one string on 367 of 807 wings.
    // `acro` is gone with it: the year twin it existed to add is redundant
    // here, since the row renders the wing's own `years` span two lines down.
    const label = wingLabelFor(p) || p.name;
    const years = p.years ? ` <span class="muted small">${esc(p.years)}</span>` : "";
    return { key: sortKeyStr(p.full_name ?? p.name), html: `<li><a href="${esc(p.page)}">${esc(label)}</a>${years}</li>` };
  }).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  shape: "list",
});

// Championships — title name, promotion acronym secondary.
const championshipsRegister = generateAlphaRegister({
  dirName: "titles/a-z", urlBase: "/titles/a-z/",
  instrumentHref: "/championships.html", instrumentLabel: "Championships", noun: "championship",
  rows: titles.map((t) => {
    const acro = bareAcronym(promoById.get(t.promotion)) || t.promotion;
    const wingPage = promoById.get(t.promotion)?.page;   // the promotion links to its wing (the Janitor's site sweep, hook c147)
    const acroHtml = wingPage ? `<a href="${esc(wingPage)}">${esc(acro)}</a>` : esc(acro);
    return { key: sortKeyStr(t.name), html: `<li><a href="${esc(t.page)}">${esc(t.name)}</a> <span class="muted small">(${acroHtml})</span></li>` };
  }).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  shape: "list",
});

// AWARD LABEL (hook c147, the Janitor's site sweep 2026-10-08): "GIWF Active Wrestler of the Year", wing first, the wing's own
// trailing year parenthetical stripped; the parenthetical (acronymLabel's qualified form) is put back only on a row whose
// stripped label another wing's award would read identically. The Node twin of awards.html's awardLabel(), kept in step by
// hand (build time vs. browser run time); it keys the static /awards/a-z/ register so the register's letters and the page's
// in-place A-Z filter agree.
const stripWingParen = (n) => String(n ?? "").replace(/\s*\([^)]*\)\s*$/, "") || String(n ?? "");
const awardLabelWith = (prefix, a) => (a.name.toUpperCase().startsWith(`${prefix.toUpperCase()} `) ? a.name : `${prefix} ${a.name}`);
const plainAwardLabel = (a) => {
  const p = promoById.get(a.promotion);
  return awardLabelWith(p ? stripWingParen(p.name) : String(a.promotion ?? "").toUpperCase(), a);
};
const awardWingsByLabel = new Map();
for (const a of awards) {
  const k = plainAwardLabel(a).toLowerCase();
  if (!awardWingsByLabel.has(k)) awardWingsByLabel.set(k, new Set());
  awardWingsByLabel.get(k).add(a.promotion);
}
function awardLabelFor(a) {
  const plain = plainAwardLabel(a), p = promoById.get(a.promotion);
  if (!p || awardWingsByLabel.get(plain.toLowerCase()).size < 2) return plain;
  return awardLabelWith(acronymLabel(p), a);
}

// Awards — award entities (the bestowal-level record stays the instrument's). Filed and labelled wing first (awardLabelFor), as
// awards.html lists them; the row's wing follows as a link.
const awardsRegister = generateAlphaRegister({
  dirName: "awards/a-z", urlBase: "/awards/a-z/",
  instrumentHref: "/awards.html", instrumentLabel: "Awards", noun: "award",
  rows: awards.map((a) => {
    const label = awardLabelFor(a);
    const wing = promoById.get(a.promotion);
    const wingLabel = acronymLabel(wing) || a.promotion;
    const wingHtml = wing?.page ? `<a href="${esc(wing.page)}">${esc(wingLabel)}</a>` : esc(wingLabel);
    return { key: sortKeyStr(label), html: `<li><a href="${esc(a.page)}">${esc(label)}</a> <span class="muted small">&middot; ${wingHtml}</span></li>` };
  }).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  shape: "list",
});

patchRegisterMarker("characters.html", registerBrowseLine(charactersRegister));
patchRegisterMarker("units.html", registerBrowseLine(unitsRegister));
patchRegisterMarker("promotions.html", registerBrowseLine(promotionsRegister));
patchRegisterMarker("championships.html", registerBrowseLine(championshipsRegister));
patchRegisterMarker("awards.html", registerBrowseLine(awardsRegister));
console.log(`cross-reference: alphabetical registers — characters ${charactersRegister.rows} rows/${charactersRegister.pages} pages, units ${unitsRegister.rows}/${unitsRegister.pages}, promotions ${promotionsRegister.rows}/${promotionsRegister.pages}, championships ${championshipsRegister.rows}/${championshipsRegister.pages}, awards ${awardsRegister.rows}/${awardsRegister.pages}.`);

// ---------------------------------------------------------------------------
// 2c. Generated /shows/<year>/ season pages (THE PAGINATION ARCHITECTURE
//     WAVE item 3) — complete static documents, every promotion's shows
//     that year interleaved chronologically, promotion-prefixed names
//     (showLabel — PROFILE QUALITY WAVE item a) making the interleave
//     actually readable. shows.html (387 rows, near budget already) stays
//     the search/filter instrument; these are the no-JS browse path, and
//     the one place a season genuinely groups shows regardless of which
//     promotion staged them. A year splits into row_budget-sized parts the
//     moment it exceeds budget — the identical idiom the rps/<year>/
//     register below already uses. (2002 crossed the cap during the FAW
//     accession, 2026-08-23: 380 rows before it, 442 after.)
// ---------------------------------------------------------------------------
function showDateKey(dateObj) {
  if (!dateObj || dateObj.precision === "unknown") return null;
  const m = String(dateObj.date ?? "").match(/(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return null;
  return `${m[1]}-${m[2] ?? "99"}-${m[3] ?? "99"}`;
}
const showsByYear = new Map();
for (const s of shows) {
  const k = showDateKey(s.date);
  // Undated shows bucket under "undated" — the register is the
  // completeness fallback, so a show with no recoverable date still
  // appears somewhere (A-Z REGISTERS rider, 2026-08-22).
  const year = k ? k.slice(0, 4) : "undated";
  const list = showsByYear.get(year) ?? [];
  list.push({ show: s, key: k ?? `zzzz-${sortKeyStr(showLabel(s))}` });
  showsByYear.set(year, list);
}
const seasonYears = [...showsByYear.keys()].filter((y) => y !== "undated").sort();
if (showsByYear.has("undated")) seasonYears.push("undated");

const showsDir = resolve(ROOT, "shows");
mkdirSync(showsDir, { recursive: true });

const showYearParts = new Map(); // year -> [{ file, n, rows }]
for (const year of seasonYears) {
  const yearDir = resolve(showsDir, year);
  mkdirSync(yearDir, { recursive: true });
  const ordered = showsByYear.get(year).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const chunks = [];
  for (let i = 0; i < ordered.length; i += ROW_BUDGET) chunks.push(ordered.slice(i, i + ROW_BUDGET));
  const parts = chunks.map((chunk, i) => ({ file: i === 0 ? "index.html" : `${i + 1}.html`, n: i + 1, rows: chunk }));
  showYearParts.set(year, parts);
  const yearLabel = year === "undated" ? "Unknown" : year;
  for (const part of parts) {
    const rows = part.rows.map(({ show: s }) => {
      // THE COLLECTED EDGE (the Janitor, 2026-08-22): an uncollected show has no
      // page to link — its name and date stand in the register unlinked,
      // with the same plain chip the instrument shows.
      const title = s.page
        ? `<a href="${esc(s.page)}">${esc(showLabel(s))}</a>`
        : `${esc(showLabel(s))} <span class="muted small">&middot; not collected</span>`;
      return `<li><span class="when">${esc(dateLabel(s.date) || "unknown")}</span>${title}</li>`;
    }).join("\n    ");
    const partLabel = parts.length > 1 ? `${yearLabel}, part ${part.n} of ${parts.length}` : yearLabel;
    const partNav = parts.length > 1
      ? `\n  <p class="muted small">${parts.map((pp) => pp.n === part.n
          ? `part ${pp.n}`
          : `<a href="/shows/${year}/${pp.file === "index.html" ? "" : pp.file}">part ${pp.n}</a>`).join(" &middot; ")}</p>`
      : "";
    const ledeLine = year === "undated"
      ? `${part.rows.length} show${part.rows.length === 1 ? "" : "s"} with no recoverable date, alphabetical.
  See <a href="/shows.html">the Show Archive</a> to search/filter every show at once.`
      : `${part.rows.length} show${part.rows.length === 1 ? "" : "s"}, every promotion, interleaved
  chronologically. See <a href="/shows.html">the Show Archive</a> to search/filter every show at once.`;
    const body = `<span class="kicker">Show Archive &mdash; ${esc(yearLabel)}</span>
  <h1>${esc(partLabel)}</h1>
  <p class="lede">${ledeLine}</p>${partNav}

  <ul class="archive-list">
    ${rows}
  </ul>`;
    writeFileSync(resolve(yearDir, part.file), registerShell({
      title: `Shows — ${partLabel}`, instrumentHref: "/shows.html", instrumentLabel: "Shows",
      rootHref: "/shows/", rootLabel: "By year", crumbTail: partLabel, bodyHtml: body, rel: `shows/${year}/`,
    }));
  }
}

const seasonsIndexBody = `<span class="kicker">Show Archive &mdash; by year</span>
  <h1>Every season.</h1>
  <p class="lede">Complete, static, no-JS documents &mdash; every
  promotion's shows for that year, interleaved chronologically. For
  search/filter over every show at once, see <a href="/shows.html">the Show
  Archive</a>.</p>

  <ul class="archive-list">
    ${seasonYears.map((y) => {
      const parts = showYearParts.get(y);
      const label = y === "undated" ? "Unknown" : y;
      const count = showsByYear.get(y).length;
      if (parts.length === 1) return `<li><a href="/shows/${y}/">${esc(label)}</a> <span class="muted small">(${count})</span></li>`;
      return `<li><a href="/shows/${y}/">${esc(label)}</a> <span class="muted small">(${count}, ${parts.length} parts)</span> &mdash; ${parts.map((pp) => `<a href="/shows/${y}/${pp.file === "index.html" ? "" : pp.file}">part ${pp.n}</a>`).join(", ")}</li>`;
    }).join("\n    ")}
  </ul>`;
writeFileSync(resolve(showsDir, "index.html"), registerShell({
  title: "Shows by year", instrumentHref: "/shows.html", instrumentLabel: "Shows",
  rootHref: "/shows/", rootLabel: "By year", crumbTail: null, bodyHtml: seasonsIndexBody, rel: "shows/",
}));

// Patch shows.html's own marker block with real year links (idempotent —
// same start/end marker convention as scripts/stamp-chrome.mjs).
const showsHtmlPath = resolve(ROOT, "shows.html");
if (existsSync(showsHtmlPath)) {
  const current = readFileSync(showsHtmlPath, "utf8");
  const seasonLinks = seasonYears.map((y) => `<a href="/shows/${y}/"${y === "undated" ? ' data-year="unknown"' : ""}>${esc(y === "undated" ? "unknown" : y)}</a>`).join(" &middot; ");
  const replacement = `<!-- seasons:start -->\n    <a href="/shows/">Shows by year</a> &mdash; ${seasonLinks}\n    <!-- seasons:end -->`;
  const patched = current.replace(/<!-- seasons:start -->[\s\S]*?<!-- seasons:end -->/, replacement);
  if (patched !== current) writeFileSync(showsHtmlPath, patched);
}

// ---------------------------------------------------------------------------
// 2d. Generated /rps/<year>/ chronological register (A-Z REGISTERS rider,
//     2026-08-22): roleplays are event-shaped, so their completeness
//     fallback registers chronologically, mirroring shows/<year>/ — every
//     held roleplay, by year, undated bucket last, a year split into
//     row_budget-sized parts the moment it exceeds budget (2003 and 2004
//     both do today). rps.html (the instrument) links here through its own
//     `<!-- register:start/end -->` marker.
// ---------------------------------------------------------------------------
const rpsByYear = new Map();
for (const r of rps) {
  const k = showDateKey(r.date);
  const year = k ? k.slice(0, 4) : "undated";
  const list = rpsByYear.get(year) ?? [];
  list.push({ rp: r, key: k ?? `zzzz-${sortKeyStr(r.title)}` });
  rpsByYear.set(year, list);
}
const rpYears = [...rpsByYear.keys()].filter((y) => y !== "undated").sort();
if (rpsByYear.has("undated")) rpYears.push("undated");
const rpsDir = resolve(ROOT, "rps");
mkdirSync(rpsDir, { recursive: true });

let rpRegisterPages = 0;
const rpYearParts = new Map(); // year -> [{ file, n, rows }]
for (const year of rpYears) {
  const yearDir = resolve(rpsDir, year);
  mkdirSync(yearDir, { recursive: true });
  const ordered = rpsByYear.get(year).sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : (sortKeyStr(a.rp.title) < sortKeyStr(b.rp.title) ? -1 : 1));
  const chunks = [];
  for (let i = 0; i < ordered.length; i += ROW_BUDGET) chunks.push(ordered.slice(i, i + ROW_BUDGET));
  const parts = chunks.map((chunk, i) => ({ file: i === 0 ? "index.html" : `${i + 1}.html`, n: i + 1, rows: chunk }));
  rpYearParts.set(year, parts);
  const yearLabel = year === "undated" ? "Unknown" : year;
  for (const part of parts) {
    const rows = part.rows.map(({ rp: r }) => {
      const acro = bareAcronym(promoById.get(r.promotion ?? r.venue)) || r.promotion || r.venue || "";   // hook c106 (D407): the hub of a roleplay no fed claims
      // 2026-09-24 (preflight 175): a structured roleplay whose page is not served yet (the forum rows, serving held) has no
      // served_url — list its title unlinked, never an empty href (validate.mjs fails the gate on href="").
      const titleCell = r.served_url ? `<a href="${esc(r.served_url)}">${esc(r.title)}</a>` : esc(r.title);
      return `<li><span class="when">${esc(dateLabel(r.date) || "unknown")}</span>${titleCell}${acro ? ` <span class="muted small">(${esc(acro)})</span>` : ""}</li>`;
    }).join("\n    ");
    const partLabel = parts.length > 1 ? `${yearLabel}, part ${part.n} of ${parts.length}` : yearLabel;
    const partNav = parts.length > 1
      ? `\n  <p class="muted small">${parts.map((p) => p.n === part.n
          ? `part ${p.n}`
          : `<a href="/rps/${year}/${p.file === "index.html" ? "" : p.file}">part ${p.n}</a>`).join(" &middot; ")}</p>`
      : "";
    const ledeLine = year === "undated"
      ? `${part.rows.length} roleplay${part.rows.length === 1 ? "" : "s"} with no recoverable date, alphabetical.
  See <a href="/rps.html">Roleplays</a> to search/filter every held roleplay at once.`
      : `${part.rows.length} roleplay${part.rows.length === 1 ? "" : "s"}, every promotion, interleaved
  chronologically. See <a href="/rps.html">Roleplays</a> to search/filter every held roleplay at once.`;
    const body = `<span class="kicker">Roleplays &mdash; ${esc(yearLabel)}</span>
  <h1>${esc(partLabel)}</h1>
  <p class="lede">${ledeLine}</p>${partNav}

  <ul class="archive-list">
    ${rows}
  </ul>`;
    writeFileSync(resolve(yearDir, part.file), registerShell({
      title: `Roleplays — ${partLabel}`, instrumentHref: "/rps.html", instrumentLabel: "Roleplays",
      rootHref: "/rps/", rootLabel: "By year", crumbTail: partLabel, bodyHtml: body, rel: `rps/${year}/`,
    }));
    rpRegisterPages++;
  }
}

const rpYearsIndexBody = `<span class="kicker">Roleplays &mdash; by year</span>
  <h1>Every year.</h1>
  <p class="lede">Complete, static, no-JS documents &mdash; every held
  roleplay for that year, every promotion, interleaved chronologically.
  For search/filter over every roleplay at once, see
  <a href="/rps.html">Roleplays</a>.</p>

  <ul class="archive-list">
    ${rpYears.map((y) => {
      const parts = rpYearParts.get(y);
      const label = y === "undated" ? "Unknown" : y;
      const count = rpsByYear.get(y).length;
      if (parts.length === 1) return `<li><a href="/rps/${y}/">${esc(label)}</a> <span class="muted small">(${count})</span></li>`;
      return `<li><a href="/rps/${y}/">${esc(label)}</a> <span class="muted small">(${count}, ${parts.length} parts)</span> &mdash; ${parts.map((p) => `<a href="/rps/${y}/${p.file === "index.html" ? "" : p.file}">part ${p.n}</a>`).join(", ")}</li>`;
    }).join("\n    ")}
  </ul>`;
writeFileSync(resolve(rpsDir, "index.html"), registerShell({
  title: "Roleplays by year", instrumentHref: "/rps.html", instrumentLabel: "Roleplays",
  rootHref: "/rps/", rootLabel: "By year", crumbTail: null, bodyHtml: rpYearsIndexBody, rel: "rps/",
}));
rpRegisterPages++;
const rpYearLinks = rpYears.map((y) => `<a href="/rps/${y}/"${y === "undated" ? ' data-year="unknown"' : ""}>${esc(y === "undated" ? "unknown" : y)}</a>`).join(" &middot; ");
// THE MACHINERY WORDING (2026-10-03, CLAUDE.md invariant 6): this line used to
// read "Browse by year (complete, no-JS documents — every held roleplay,
// chronological)", which is the page telling the visitor how it was built.
patchRegisterMarker("rps.html", `Browse by year &mdash; ${rpYearLinks} &middot; <a href="/rps/">every year</a>`);
console.log(`cross-reference: ${rpRegisterPages} roleplay by-year register pages generated (${rps.length} rows, ${rpYears.length} years).`);

// ---------------------------------------------------------------------------
// AFFILIATIONS FINALLY RENDER (user gavel: the registry wave's "data
// first, rendering can wait" deferral ends) — every promotion wing gets
// an "Affiliations" section built straight from data/affiliations.json,
// patched into a `<!-- affiliations:start/end -->` marker every wing page
// now carries (same idempotent convention as chrome/seasons above).
// Memberships (alliance-member/-operator) get their own subsection;
// everything else (ownership, acquisition, academy, sister-promotion,
// shared-continuity, rivalry, invading-faction, crossover-booking,
// affiliate-listing) renders as one flat list, nature spelled out in
// plain words, with a TIME PERIOD only where the edge's own `period`
// field carries one (never invented here — see the data mutation that
// added it, sourced only from receipts that already had a date).
// ---------------------------------------------------------------------------
const affiliations = existsSync(resolve(DATA, "affiliations.json")) ? loadArray("affiliations") : [];

// USER REVIEW FIX: PTC's own Members list rendered held members (UWF, XUW)
// as bare acronyms while unheld members rendered spelled-out names from
// the edge data — an inconsistent seam. UNIFORM RULE for every promotion-
// reference row in an affiliations section: full name primary, acronym
// secondary — matching the promotions-list page's own full-names-primary
// convention. Held: pull `full_name` from promotions.json, paired with
// the same "ACRONYM (year)" label used everywhere else on the site
// (acronymLabel()) — "Universal Wrestling Federation (UWF (2001))".
// Unheld with a recovered expansion already stored in the edge data as
// "ACRONYM (Full Name)" (the mint-time convention): flipped to "Full Name
// (ACRONYM)". Unheld with NO recovered expansion (bare acronym only, e.g.
// "PRIME"): stays bare — nothing to flip, and inventing an expansion here
// would be exactly the kind of fabrication CURATION.md forbids.
function splitAcronymName(name) {
  const m = String(name ?? "").match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  return m ? { primary: m[2], secondary: m[1] } : { primary: name, secondary: null };
}
// `full_name` is a NAME ONLY (2026-08-18 gavel — PTC's own used to bake in
// "(interfed alliance)", which then self-parenthesized against the wing
// header's own "Full Name (ACRO)" format). `qualifier` (optional) is the
// one shared place that descriptor lives now; every render that
// legitimately wants it composes it explicitly, here, rather than finding
// it pre-baked into the name.
function qualifiedFullName(p) {
  return p.qualifier ? `${p.full_name} (${p.qualifier})` : p.full_name;
}
function affilPartyHtml(party) {
  if (party.id) {
    const p = promoById.get(party.id);
    if (!p) return esc(party.id);
    // THE AFFILIATION LABEL (QA sample 2026-09-05): no nested parentheses — the
    // acronym alone, the year only when another held wing shares the name.
    const twins = promotions.filter((q) => q.name === p.name && q.id !== p.id).length > 0;
    // a twin's year joins with a comma, never a nested parenthesis (QA sample 2, 2026-09-05)
    // L312 (C1b): one composer, wingLabelFullNameFirst() -- declared beside
    // UNIT_KIND_LABEL.  The affiliation row's own full-name-primary order is
    // unchanged; what goes is the triple copy this row rendered for every
    // corrected wing ("All Desert Wrestling (All Desert Wrestling) (ADW (All
    // Desert Wrestling))"), because qualifiedFullName() re-appended a
    // `qualifier` that mirrors the name's own parenthetical and `acro` was the
    // whole `name`.  The era survives, comma-joined inside the one secondary
    // parenthesis alongside the acronym and any twin year -- this row's own
    // "comma, never a nested parenthesis" convention, one part wider.
    const label = wingLabelFullNameFirst(p, twins);
    return `<a href="${esc(p.page || "/promotions.html")}">${esc(label)}</a>`;
  }
  if (!party.unheld) return esc(party.name);
  const { primary, secondary } = splitAcronymName(party.name);
  const label = secondary ? `${primary} (${secondary})` : primary;
  return `<a href="/frontier.html">${esc(label)}</a>`;
}

// USER REVIEW FIX: an edge may carry an optional `status_note` (a
// qualifying fact that doesn't fit the dated `period` field — e.g. "true
// initially, but later went independent") plus a `grade` marking how
// firmly that specific note is attested (same primary-source|user-
// attested|presumed vocabulary as everywhere else in the registry). Reused
// on every line type, not just operator/member ones.
// PROSE-FIX-01 (2026-09-13; proposal.md #2.2) — status_note was raw esc()
// only, the one affiliation-row field with no filtering at all (renderTenuresSection's
// own `note` sets the truthiness-after-compute idiom this now matches: a
// status_note that is ENTIRELY process narration renders no tag at all).
function affilStatusTag(e) {
  if (!e.status_note) return "";
  const v = servedText(e.status_note);
  if (!v) return "";
  const gradeTag = e.grade === "user-attested" ? " (user-attested)" : "";
  return ` <span class="muted small">&mdash; ${esc(v)}${gradeTag}</span>`;
}

// THE ROSTER-CARD RESTYLE (REVIEW-FIXES WAVE, 2026-08-22, the Janitor's rider):
// the affiliations section joins the same card pattern the character pages'
// relationships/tenures now use — the OTHER promotion's linked name as the
// card heading, the affiliation's nature/description as the card body. As
// on the relationship cards, the body describes the CARD SUBJECT relative
// to this page's own promotion, by acronym label ("IWF (1998) / Predecessor
// to GIWF (1999)") — unambiguous in either direction. Each template's {P}
// is this page's own acronym label. Direction lore, preserved from the
// retired AFFIL_LABEL map: "invading-faction" a = the promotion whose OWN
// roster names the invading stable, b = the invader itself (the IWF/XEWF
// edge); "successor-of" a = the later name/promotion, b = the earlier one
// it continues from (A7); "academy" b = the academy that feeds into a;
// "alliance-operator" a operates b.
function renderAffiliationsSection(promoId) {
  const mine = affiliations.filter((e) => e.a?.id === promoId || e.b?.id === promoId);
  if (!mine.length) return "";
  const self = promoById.get(promoId);
  const P = (self ? acronymLabel(self) : null) || promoId;

  const card = (headingHtml, bodyHtml) => `<div class="roster-card"><h3>${headingHtml}</h3><div class="muted small">${bodyHtml}</div></div>`;
  const memberCards = []; // this promo IS the alliance (alliance-member, this promo on the "b" side)
  const cards = [];
  const sharedOwnershipParties = []; // A6: every shared-ownership edge touching this promo, grouped into ONE card
  // L382: the family's own note text, once, not once per party -- see
  // wave-C90-L382/affiliation-render-qa-2026-09-06.md for the repetition
  // this replaces (a shared-ownership family of N members was showing N
  // near-identical "sister sites under one owner" paragraphs back to back).
  const sharedOwnershipNotes = [];

  for (const e of mine) {
    const isA = e.a?.id === promoId;
    const other = isA ? e.b : e.a;
    const otherHtml = affilPartyHtml(other);
    const periodTag = e.period ? ` <span class="muted small">(${esc(e.period)})</span>` : "";
    const statusTag = affilStatusTag(e);
    // L363: an edge may also carry a visitor-facing `note` (distinct from
    // `status_note` — see affilStatusTag above); same styling, its own line.
    // PROSE-FIX-01 (2026-09-13; proposal.md #2.2) — was raw esc() only;
    // now routed through servedText() like every other note field on the
    // site. Verified against all 237 live affiliations.note rows before
    // this patch shipped: "member federation" (the field's single most
    // common load-bearing phrase, describing real alliance membership)
    // is NOT a PROCESS_MARKER_RE marker — see text-markers.mjs's own
    // header for why it stays gate-only — so this does not touch that
    // content; the two rows this DID change (one long citation-and-URL
    // dump) are documented in findings.md's render-parity test.
    const noteTag = e.note ? (() => {
      const v = servedText(e.note);
      return v ? `<br><span class="muted small">${esc(v)}</span>` : "";
    })() : "";

    // A6 (THE SHARED-OWNERSHIP EDGE): every promotion sharing a real-world
    // owner with this one, GROUPED into one card — "Shared ownership: A,
    // B, C" — never one card per pairwise edge (a promotion in a large
    // shared-ownership family would otherwise read as a wall of identical
    // cards). No family label, no operator prose, no names — see the
    // edge's own `note`/`source` for the receipt.
    if (e.nature === "shared-ownership") {
      sharedOwnershipParties.push(`${otherHtml}${periodTag}${statusTag}`);
      if (e.note && !sharedOwnershipNotes.includes(e.note)) sharedOwnershipNotes.push(e.note);
      continue;
    }
    if (e.nature === "alliance-member") {
      // USER REVIEW FIX: direction-aware phrasing. "a" is always the
      // MEMBER, "b" the alliance it belongs to (data now matches this
      // convention throughout — see the affiliations.json mutation note).
      // On the member's own page: a card for the alliance, "{P}, member".
      // On the alliance's own page: one card per member under a Members
      // subheading — name link as heading, "Member" + period as body, so
      // no card renders as a bare, unlabeled name.
      if (isA) cards.push(card(otherHtml, `Member of ${esc(P)}${periodTag}${statusTag}${noteTag}`));
      else memberCards.push(card(otherHtml, `Member${e.period ? ` <span class="muted small">(${esc(e.period)})</span>` : ""}${statusTag}${noteTag}`));
      continue;
    }
    const tpl = AFFIL_CARD_LABEL[e.nature];
    const body = tpl ? tpl[isA ? 0 : 1].replace("{P}", esc(P)) : esc(e.nature);
    cards.push(card(otherHtml, `${body}${periodTag}${statusTag}${noteTag}`));
  }

  if (sharedOwnershipParties.length) {
    // One family-level note (the first on file for this card), instead of
    // repeating each edge's own near-duplicate disclosure once per party.
    // PROSE-FIX-01 (2026-09-13; proposal.md #2.2) — same field (e.note) as
    // noteTag above, same servedText() fix.
    const familyNoteText = sharedOwnershipNotes.length ? servedText(sharedOwnershipNotes[0]) : "";
    const familyNoteTag = familyNoteText
      ? `<br><span class="muted small">${esc(familyNoteText)}</span>`
      : "";
    cards.push(card("Shared ownership", `${sharedOwnershipParties.join(", ")}${familyNoteTag}`));
  }

  let out = `<h2>Affiliations</h2>`;
  if (cards.length) out += cards.join("\n  ");
  if (memberCards.length) {
    out += `<h3>Members</h3><p class="muted small">Every member promotion this alliance's own record names.</p>${memberCards.join("\n  ")}`;
  }
  return out;
}

let affilPatched = 0;
for (const p of promotions) {
  if (!p.page) continue;
  const wingIndexPath = resolve(ROOT, p.page.replace(/^\//, ""), "index.html");
  if (!existsSync(wingIndexPath)) continue;
  const current = readFileSync(wingIndexPath, "utf8");
  if (!current.includes("<!-- affiliations:start -->")) continue;
  const section = renderAffiliationsSection(p.id);
  const replacement = `<!-- affiliations:start -->\n  ${section}\n  <!-- affiliations:end -->`;
  const patched = current.replace(/<!-- affiliations:start -->[\s\S]*?<!-- affiliations:end -->/, replacement);
  if (patched !== current) { writeFileSync(wingIndexPath, patched); affilPatched++; }
}

// ---------------------------------------------------------------------------
// THE PROVENANCE WAVE (user gavel: "the UWF data is built from uwf.org.uk
// and uwfonline.com via the WayBackMachine on X date and the Yahoo Group and
// a specific collection") — every wing gets a plain-language "Provenance"
// section built straight from promotions.json's own `sources[]`, patched
// into a `<!-- provenance:start/end -->` marker (same idempotent convention
// as chrome/seasons/affiliations above). Kind labels are plain words, not
// the raw schema tokens; no mining-war stories here — those stay in the
// digests, this is just "built from X, window Y, accession Z."
// ---------------------------------------------------------------------------
function renderProvenanceSection(promo) {
  const sources = promo.sources;
  if (!Array.isArray(sources) || !sources.length) return "";
  const rows = sources.map((s) => {
    const kind = SOURCE_KIND_LABEL[s.kind] || esc(s.kind || "Source");
    // A source with no accession id is a pre-accession attestation (a tier-0
    // beacon citing workshop-held material) — the window stands alone.
    const accessionLink = s.accession ? ` &middot; <a href="/collections/${esc(s.accession)}.html">accession ${esc(s.accession)}</a>` : "";
    return `<li><span class="k">${esc(kind)}</span> &mdash; ${esc(s.identifier)}. ` +
      `<span class="muted small">${esc(s.window)}${accessionLink}</span></li>`;
  });
  return `<h2>Provenance</h2><p class="muted small">Built from:</p><ul class="meta">${rows.join("")}</ul>`;
}

let provPatched = 0;
for (const p of promotions) {
  if (!p.page) continue;
  const wingIndexPath = resolve(ROOT, p.page.replace(/^\//, ""), "index.html");
  if (!existsSync(wingIndexPath)) continue;
  const current = readFileSync(wingIndexPath, "utf8");
  if (!current.includes("<!-- provenance:start -->")) continue;
  const section = renderProvenanceSection(p);
  const replacement = `<!-- provenance:start -->\n  ${section}\n  <!-- provenance:end -->`;
  const patched = current.replace(/<!-- provenance:start -->[\s\S]*?<!-- provenance:end -->/, replacement);
  if (patched !== current) { writeFileSync(wingIndexPath, patched); provPatched++; }
}


// ---------------------------------------------------------------------------
// THE CONNECTIONS SLOT — retired by A7, see below. Originally the
// salience-inversion fix from a live-caught crew-centering incident on the
// XUW wing (a wing's own epitaph and roster prose built around ITS
// connection to sister feds rather than the promotion's own arc); kept
// giving lineage a fixed, one-sentence, data-rendered home so free prose
// had nowhere left to smuggle the thesis into. The marker itself
// (`<!-- connections:start/end -->`) is unchanged in every wing's own HTML
// — only what renders into it has changed.
// ---------------------------------------------------------------------------
// A7 (LINEAGE EDGES REPLACE CONNECTED-HISTORY, the Janitor's gavel): "affiliations
// should just note that it was the successor to IWF and the predecessor to
// the UWF. That's a much more scalable format." The family+family_note+essay
// callout this function used to render is retired outright — every wing's
// own "Connected history" section is gone, everywhere, replaced by the plain
// "Successor to: X"/"Predecessor to: Y" rows the Affiliations section now
// renders mechanically off the new `successor-of` edges. The `<!--
// connections:start/end -->` marker stays in every wing's own HTML (same
// idempotent-marker discipline every other section uses) — it simply never
// renders anything again, the same way "browse" would for a promotion with
// nothing to browse. THE ESSAYS RETIREMENT (v49): the essay itself
// (essays/iwf-line.html) was retired outright, per the Janitor's own
// later call, and is gone from the tree; docs/SCHEMA.md's own
// essays.json entry carries the full ruling.
// THE PORTRAYAL LINE (hook c101; the Janitor, desk D400/D406; CURATION.md
// v128 (c)): the one thing this long-empty marker renders again is the wing's
// own `portrays` edge, as one plain line in the museum's voice linking the
// real promotion's figure page. It says what the fed's fiction depicts and
// nothing about the real company (v78(g)'s posture, one level up). The page
// it links exists: wingPortrayalsByFigure adds it, from the same edge.
function renderConnectionsSection(promo) {
  const list = promo.portrays == null ? [] : (Array.isArray(promo.portrays) ? promo.portrays : [promo.portrays]);
  const seen = new Set();
  const links = [];
  for (const pt of list) {
    const f = pt && pt.figure ? externalById.get(pt.figure) : null;
    if (!f || f.type !== "real-promotion" || seen.has(f.id)) continue;
    seen.add(f.id);
    links.push(`the <a href="/figures/${esc(f.id)}.html">${esc(f.name)}</a>`);
  }
  if (!links.length) return "";
  return `<p class="muted small">This federation&rsquo;s fiction portrays ${joinOxfordAnd(links)}.</p>`;
}

let connPatched = 0;
for (const p of promotions) {
  if (!p.page) continue;
  const wingIndexPath = resolve(ROOT, p.page.replace(/^\//, ""), "index.html");
  if (!existsSync(wingIndexPath)) continue;
  const current = readFileSync(wingIndexPath, "utf8");
  if (!current.includes("<!-- connections:start -->")) continue;
  const section = renderConnectionsSection(p);
  const replacement = `<!-- connections:start -->\n  ${section}\n  <!-- connections:end -->`;
  const patched = current.replace(/<!-- connections:start -->[\s\S]*?<!-- connections:end -->/, replacement);
  if (patched !== current) { writeFileSync(wingIndexPath, patched); connPatched++; }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// JOINT-WING SHOWS (the Janitor's gavel, 2026-09-24, on the Chris Williams
// Memorial Cup's 2001 GIWF and 2007 PTC stagings: "those should be joint-wing
// shows IMO"; CURATION.md v121, #joint-wing-shows).
//
// ONE row, still shard-assigned to its canonical `promotion` — the
// canonical-copy rule is untouched, and shard-lib.mjs's shardOf() never sees
// this field. `also_promotions[]` names the OTHER held wings that staged the
// same night, and this pass is the two generated surfaces the gavel owes
// them (the third, the shows instrument's own `data-promo`, needs no code
// here: shows.html already joins acronym+id pipe-delimited per THE DEEP-LINK
// ID BUG's fix, v67(b), and now joins the co-wings into the same attribute,
// so `?promo=` and a typed `promotion:` match either with js/query.js
// unchanged).
//
//   1. `jointByPromo` — read further down by the disk-derived holdings
//      register, which gains ONE clearly labelled pointer group per
//      co-staging wing. A pointer, never a second copy: `docCount` does not
//      move, so the wing's own document count stays honest (v121(d)).
//   2. The canonical show page's own one-line, links-only, marker-delimited
//      "Jointly staged" row. Museum-inserted presentation inside a served
//      document — the verbatim rule's chrome carve-out (v64, v70) — never a
//      word of the document's own text, and refreshed in place on every run
//      so it can never drift from the registry. The marker pair is
//      BOOTSTRAPPED at a fixed anchor (immediately before the content
//      notice) on the v112(b) precedent: "a stamper never invents a marker"
//      is a rule about PROSE, and this marker carries generated links only.
//      A page with no content notice to anchor on is counted and skipped,
//      never guessed at.
// ---------------------------------------------------------------------------
// 2026-10-03 (gate 241 red: "/promotions/wmw/undefined/gw-crossfire-2004"): a jointly staged night with no served
// document of its own (gw-crossfire-2004, structured from its board threads) has no page to point at — skip it here;
// the shows instrument still lists it under both wings through data-promo.
const jointShows = shows.filter((s) => Array.isArray(s.also_promotions) && s.also_promotions.length && s.collected !== false && s.page);
const jointByPromo = new Map();
for (const s of jointShows) {
  for (const pid of s.also_promotions) {
    if (!promoById.has(pid) || pid === s.promotion) continue; // registry-validate hard-fails both
    if (!jointByPromo.has(pid)) jointByPromo.set(pid, []);
    jointByPromo.get(pid).push(s);
  }
}
{
  let stamped = 0, unanchored = 0;
  for (const s of jointShows) {
    if (!s.page) continue;
    const f = resolve(ROOT, s.page.replace(/^\//, ""));
    if (!existsSync(f)) continue;
    const wings = [s.promotion, ...s.also_promotions].filter((pid) => promoById.has(pid));
    const seen = new Set();
    const ordered = wings.filter((pid) => !seen.has(pid) && seen.add(pid));
    if (ordered.length < 2) continue;
    const links = ordered.map((pid) => {
      const p = promoById.get(pid);
      return `<a href="/promotions/${encodeURIComponent(pid)}/">${esc(acronymLabel(p) || p.name || pid)}</a>`;
    }).join(" &middot; ");
    const blk = `<!-- jointwings:start -->\n  <p class="muted small">Jointly staged: ${links}</p>\n  <!-- jointwings:end -->`;
    const src = readFileSync(f, "utf8");
    let out;
    if (src.includes("<!-- jointwings:start -->")) {
      out = src.replace(/<!-- jointwings:start -->[\s\S]*?<!-- jointwings:end -->/, blk);
    } else {
      const at = src.indexOf('<div class="archival-notice"');
      if (at === -1) { unanchored++; continue; }
      out = src.slice(0, at) + blk + "\n\n  " + src.slice(at);
    }
    if (out !== src) { writeFileSync(f, out); stamped++; }
  }
  console.log(`cross-reference: ${jointShows.length} joint-wing show row(s), ${stamped} page line(s) stamped${unanchored ? `, ${unanchored} with no content notice to anchor on (run \`npm run chrome\` first)` : ""}.`);
}

// ---------------------------------------------------------------------------
// ACCESSION PAGES (the addendum: "accession ids become clickable" — every
// "accession 0001" mention links to a generated per-accession page). Each
// page is a small DOCUMENT: the lot's own bookkeeping record (kind, note,
// digest), in absolutes — plus prefilled live links for everything
// attributable to it (a small baked list of promotions, since accessions
// stay few even at scale; instrument links for the rest, always current).
// ---------------------------------------------------------------------------
const collections = existsSync(resolve(DATA, "collections.json")) ? loadArray("collections") : [];

// ---------------------------------------------------------------------------
// HELD-LIST CHUNKING (the accession rider to THE PAGINATION ARCHITECTURE
// WAVE, 2026-09-04) — the 1997 Usenet census (0148) put 467 wings under a
// single lot, and a baked 467-row "Held under this accession" list blows
// data/site-config.json's row_budget exactly the way a monolithic A-Z
// register would. Same answer, same conventions as the registers in §2b
// above: under budget the lot page bakes the whole list as it always has
// (byte-identical for every ordinary lot); over budget the rows move to
// per-letter chunk pages and the lot page keeps its own bookkeeping record
// — kind, note, live material line, prev/next lot — plus a counts summary
// and an index of the chunks. Filenames follow the register's own scheme
// (`<letter>.html`, and `<letter><from>-<letter><to>.html` when a single
// letter is itself over budget) so the site has one splitting convention,
// not two.
//
// WHY THE CHUNKS SIT IN A DIRECTORY BESIDE THE LOT PAGE
// (collections/0148/a.html next to collections/0148.html, no index.html of
// its own — the lot page IS the index): worker/index.mjs's resolvePath()
// tries `<stem>.html` BEFORE `<stem>/index.html` (the load-bearing
// rps.html-vs-rps/ precedent documented there), so /collections/0148 keeps
// resolving to the lot page and never to the chunk directory.
// ---------------------------------------------------------------------------
const chunkedLots = [];

// rows: [{ key, html }] presorted by key. Letter-grouped, sub-split within a
// letter only past budget again — the generateAlphaRegister() rule, reusing
// its own chunkKeyOf() so the two never drift apart.
function heldChunkPlan(rows) {
  const byLetter = new Map();
  for (const r of rows) {
    const ch = r.key.charAt(0);
    const letter = ch >= "a" && ch <= "z" ? ch : "0-9";
    const list = byLetter.get(letter) ?? [];
    list.push(r);
    byLetter.set(letter, list);
  }
  const pages = [];
  for (const letter of [...byLetter.keys()].sort()) {
    const list = byLetter.get(letter);
    if (list.length <= ROW_BUDGET) {
      pages.push({ letter, file: `${letter}.html`, label: letter.toUpperCase(), rows: list });
      continue;
    }
    for (let i = 0; i < list.length; i += ROW_BUDGET) {
      const chunk = list.slice(i, i + ROW_BUDGET);
      const from = chunkKeyOf(chunk[0].key), to = chunkKeyOf(chunk[chunk.length - 1].key);
      pages.push({
        letter,
        file: `${letter}${from}-${letter}${to}.html`,
        label: `${letter.toUpperCase()}${from.replace(/-+$/, "")}–${letter.toUpperCase()}${to.replace(/-+$/, "")}`,
        rows: chunk,
      });
    }
  }
  return pages;
}

function writeHeldChunkPages(id, pages) {
  const dirAbs = resolve(ROOT, "collections", id);
  mkdirSync(dirAbs, { recursive: true });
  pages.forEach((page, i) => {
    const prev = i > 0 ? pages[i - 1] : null;
    const next = i < pages.length - 1 ? pages[i + 1] : null;
    // A pager type of its own: js/pager.js has no saved sequence and no
    // category index for it, and degrades exactly as documented there
    // (baked links keep working, arrow keys keep working, no random
    // affordance) — what it must NOT do is inherit the "collections" type,
    // whose sequence walks LOTS, not a lot's own chunks.
    const pagerHtml = pagerNav(
      "collections-held",
      prev ? { href: `/collections/${id}/${prev.file}`, label: prev.label } : null,
      next ? { href: `/collections/${id}/${next.file}`, label: next.label } : null,
    );
    const main = `<p class="crumb"><a href="/">Museum</a> &nbsp;/&nbsp; <a href="/collections/">Collections</a> &nbsp;/&nbsp; <a href="/collections/${esc(id)}.html">${esc(id)}</a> &nbsp;/&nbsp; ${esc(page.label)}</p>

  <span class="kicker">Accession ${esc(id)} &mdash; held wings</span>
  <h1>${esc(page.label)}</h1>
  <p class="lede">${page.rows.length} wing${page.rows.length === 1 ? "" : "s"} whose own provenance panel cites
  accession ${esc(id)}, ${esc(page.label)}. Complete and unfiltered &mdash; the whole lot is
  summarised and indexed on <a href="/collections/${esc(id)}.html">the accession's own page</a>.</p>

  <ul>${page.rows.map((r) => r.html).join("")}</ul>
  ${pagerHtml}`;
    const footerLine = `THE E-WRESTLING MUSEUM <span class="rule">/</span> Accession ${esc(id)} <span class="rule">/</span>
    <a href="/collections/${esc(id)}.html">back to the accession</a><br>
    Generated 2026 from the accession registry &mdash; not backdated. See
    <a href="/curation.html">Curation</a>.`;
    writeFileSync(
      resolve(dirAbs, page.file),
      pageShell({ title: `Accession ${esc(id)} &mdash; held wings ${esc(page.label)} &mdash; E-WRESTLING MUSEUM`, main, footerLine, rel: `collections/${id}/${page.file}` }),
    );
  });
  // THE STALE-SPLIT SWEEP, borrowed wholesale from the registers
  // (2026-08-25): when a letter crosses the budget boundary its filenames
  // change and the superseded files would otherwise linger, unreachable.
  // Anything in this lot's chunk directory this run didn't just write is a
  // stale artifact of an earlier boundary.
  const wrote = new Set(pages.map((p) => p.file));
  for (const f of readdirSync(dirAbs)) {
    if (f.endsWith(".html") && !wrote.has(f)) unlinkSync(resolve(dirAbs, f));
  }
}

// The other half of that sweep: a lot that has fallen back UNDER budget (or
// never was over it) must leave no chunk directory behind — its rows are
// baked on the lot page again, and any leftover chunk page would be both
// stale and unreachable.
function clearHeldChunkDir(id) {
  const dirAbs = resolve(ROOT, "collections", id);
  if (!existsSync(dirAbs) || !statSync(dirAbs).isDirectory()) return;
  for (const f of readdirSync(dirAbs)) {
    if (f.endsWith(".html")) unlinkSync(resolve(dirAbs, f));
  }
  if (readdirSync(dirAbs).length === 0) rmdirSync(dirAbs);
}

// PROSE-FIX-01 (2026-09-13; proposal.md #2.7) — the accession-page lede was
// the last unfiltered/partially-filtered served surface on the site:
// `blurb` got liveBlurbCounts()'s count substitution ONLY, no marker pass
// at all; `note` (the fallback when no blurb exists) got sanitizeMachineryLeak()
// only, skipping the sentence-level strip. Both render on all 154 accession
// pages (leaks.md's #9 top leak — literal .md digest filenames and local
// drive-folder paths were found rendering verbatim).
//
// The proposal's own design called for a NARROWER sentence-strip on this
// page type that specifically excludes "the museum"/"this collection" as
// markers, reasoning that ordinary accession-page prose ("the museum's own
// individual wings") would otherwise be gutted. Checked against
// PROCESS_MARKER_RE before writing this function: neither bare phrase is
// actually IN that regex today (only the much narrower "the museum's own
// voice" is) — that carve-out lives in registry-validate.mjs's separate,
// broader gate-time PROCESS_TEXT_RE, which this render path never used and
// still doesn't. So the full, ordinary stripProcessSentences() is safe
// here AS WRITTEN, with one addition this lane's own verification pass DID
// find necessary: 5 of 154 live collections.note rows are ENTIRELY workshop
// citation (a mining-campaign description with no other sentence) and would
// render as a bare empty <p></p> under the plain two-pass pipeline. Rather
// than a blank lede on a real accession page, this falls back to the
// mechanically-sanitized-but-unstripped text for those five rows only —
// sanitizeMachineryLeak()'s own rewrites still apply, just not the
// sentence deletion. Verified against all 154 blurb + 154 note rows before
// this patch shipped (see findings.md's render-parity test): 149 of 154
// notes improve or are unchanged, 5 fall back, 0 blurbs change (today's
// blurb text carries no PROCESS_MARKER_RE marker at all — preventative).
function sanitizeAccessionBlurb(text) {
  if (!text) return text;
  const sanitized = sanitizeMachineryLeak(text);
  const stripped = stripProcessSentences(sanitized);
  return stripped || sanitized;
}

function generateAccessionPage(lot, prevLot, nextLot) {
  const id = lot.id;
  const kindLabel = KIND_LABEL[lot.kind] || lot.kind || "Accession";
    const attestorCredit = (lot.attestor && attestorsById.get(lot.attestor)) ? ` &middot; Contributed by ${esc(attestorsById.get(lot.attestor).display)}` : "";  // THE ATTESTOR CREDIT on contributed material (docs/ATTESTATION.md §2; the Janitor 2026-09-21)
  const pagerHtml = pagerNav(
    "collections",
    prevLot ? { href: `/collections/${prevLot.id}.html`, label: prevLot.id } : null,
    nextLot ? { href: `/collections/${nextLot.id}.html`, label: nextLot.id } : null,
  );

  // Promotions whose own sources[] cite this accession — baked as an actual
  // list rather than a search-only instrument. Bounded for an ordinary lot
  // (a dozen promotions, dozens more even at real scale); a GRAND accession
  // is not bounded at all — 0148, the 1997 Usenet census, holds 467 wings —
  // so past row_budget the rows move to chunk pages and this section becomes
  // the summary + index of them (heldChunkPlan/writeHeldChunkPages above).
  const holdingPromos = promotions.filter((p) => (p.sources || []).some((s) => s.accession === id));
  const liveWingCount = holdingPromos.length;
  const liveDocCount = holdingPromos.reduce((n, p) => n + wingDocCount(p), 0);
  lotLiveStats.set(id, { wings: liveWingCount, docs: liveDocCount });
  const heldRowHtml = (p) => {
    // L312 (C1c): the A-Z register's own label rule, composed over
    // acronymLabel(p) rather than the bare `name` -- a held row carries no
    // `years` span of its own, so the era has to stay inside the label here.
    const label = wingLabelFor(p, acronymLabel(p)) || p.name;
    return `<li><a href="${esc(p.page || "/promotions.html")}">${esc(label)}</a></li>`;
  };
  let promosSection;
  if (!holdingPromos.length) {
    promosSection = `<p class="muted small">No promotion's own provenance panel cites this accession yet.</p>`;
    clearHeldChunkDir(id);
  } else if (holdingPromos.length <= ROW_BUDGET) {
    // Under budget: byte-for-byte the page this generator has always
    // written — the split is invisible to every ordinary lot.
    promosSection = `<h2>Held under this accession</h2><ul>${holdingPromos.map(heldRowHtml).join("")}</ul>`;
    clearHeldChunkDir(id);
  } else {
    const heldRows = holdingPromos
      .map((p) => {
        // L312 (C1c, chunked path): heldRowHtml above renders the row; this
        // branch has to compute the SAME label because it sorts on it.
        const label = wingLabelFor(p, acronymLabel(p)) || p.name;
        return { key: sortKeyStr(label), label, html: heldRowHtml(p) };
      })
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const pages = heldChunkPlan(heldRows);
    writeHeldChunkPages(id, pages);
    chunkedLots.push({ id, wings: holdingPromos.length, pages: pages.length });

    // Counts by the source kind each wing cites UNDER THIS LOT (the
    // accession vocabulary's own `kind` field — "usenet-post",
    // "local-documents", ...), one count per wing per distinct kind, so the
    // reader learns what the lot is made of before clicking into it.
    const kindCounts = new Map();
    for (const p of holdingPromos) {
      const kinds = new Set(
        (p.sources || []).filter((sc) => sc.accession === id).map((sc) => sc.kind).filter(Boolean),
      );
      if (!kinds.size) kinds.add("unclassified");
      for (const k of kinds) kindCounts.set(k, (kindCounts.get(k) ?? 0) + 1);
    }
    const kindLine = [...kindCounts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([k, n]) => `${esc(k)} (${n})`)
      .join(", ");

    const letters = [...new Set(pages.map((pg) => pg.letter))];
    const indexRows = letters.map((letter) => {
      const own = pages.filter((pg) => pg.letter === letter);
      const count = own.reduce((n, pg) => n + pg.rows.length, 0);
      if (own.length === 1) {
        return `<li><a href="/collections/${esc(id)}/${own[0].file}">${esc(own[0].label)}</a> <span class="muted small">(${count})</span></li>`;
      }
      return `<li>${esc(letter.toUpperCase())} <span class="muted small">(${count}, split)</span> &mdash; ${own.map((pg) => `<a href="/collections/${esc(id)}/${pg.file}">${esc(pg.label)}</a>`).join(", ")}</li>`;
    });

    promosSection = `<h2>Held under this accession</h2>
  <p>${holdingPromos.length} wings cite this accession in their own provenance panel &mdash; more
  rows than one served page may bake (the row budget, data/site-config.json), so the
  list is split alphabetically across ${pages.length} pages, complete and unfiltered.</p>
  <p class="muted small">By the source kind each wing cites under this accession: ${kindLine}
  (a wing citing two kinds is counted under both).</p>

  <ul class="archive-list">
    ${indexRows.join("\n    ")}
  </ul>`;
  }

  const showCount = shows.filter((s) => (Array.isArray(s.collection) ? s.collection : [s.collection]).includes(id)).length;
  const rpCount = rps.filter((r) => (Array.isArray(r.collection) ? r.collection : [r.collection]).includes(id)).length;
  const materialLine = `<p class="muted small">${showCount} show${showCount === 1 ? "" : "s"} and ${rpCount} roleplay${rpCount === 1 ? "" : "s"} in the registry trace to this accession directly (live, always current: <a href="/search.html?collection=${esc(id)}">search, filtered to accession ${esc(id)}</a>).</p>`;

  const main = `<p class="crumb"><a href="/">Museum</a> &nbsp;/&nbsp; <a href="/collections/">Collections</a> &nbsp;/&nbsp; ${esc(id)}</p>

  <span class="kicker">Accession</span>
  <h1>${esc(id)}</h1>
  <p class="lede">${kindLabel}${attestorCredit}.</p>

  <p>${esc(lot.blurb ? sanitizeAccessionBlurb(liveBlurbCounts(lot.blurb, liveWingCount, liveDocCount)) : sanitizeAccessionBlurb(lot.note))}</p>

  ${promosSection}

  ${materialLine}
  ${pagerHtml}`;
  const footerLine = `THE E-WRESTLING MUSEUM <span class="rule">/</span> Accession ${esc(id)} <span class="rule">/</span>
    <a href="/">back to the museum</a><br>
    Generated 2026 from the accession registry &mdash; not backdated. See
    <a href="/curation.html">Curation</a>.`;
  return pageShell({ title: `Accession ${esc(id)} &mdash; E-WRESTLING MUSEUM`, main, footerLine, rel: `collections/${id}.html` });
}

mkdirSync(resolve(ROOT, "collections"), { recursive: true });
let accessionPageCount = 0;
for (let ci = 0; ci < collections.length; ci++) {
  const lot = collections[ci];
  const prevLot = ci > 0 ? collections[ci - 1] : null;
  const nextLot = ci < collections.length - 1 ? collections[ci + 1] : null;
  writeFileSync(resolve(ROOT, "collections", `${lot.id}.html`), generateAccessionPage(lot, prevLot, nextLot));
  accessionPageCount++;
}

function generateAccessionIndex() {
  // THE COLLECTIONS INDEX (hook c158; the Janitor's site sweep, 2026-10-08, /collections: "This list is likely to scale in an
  // unmanageable way in the future. Build 200 at a time similar to the other indexes?"). The page used to bake one <li> per
  // lot into its own HTML; it is now the instrument shell the other index pages use, and the rows live in
  // data/collections-index.json (writeIndexV2, schema v2), which js/list.js wireIndexList paints 200 at a time. The row markup
  // is byte-for-byte the row the page baked (a <li> with the lot's kind and credit, its link and its blurb); the <li> now also
  // carries the data-* the search reads (id, kind, attestor, wings, docs, shows, rps) and a data-search blob. Each lot's own
  // accession page is unchanged and is still the complete record: its prev/next pager walks the lots in order, which is the
  // no-script way through (the shell's <noscript> says so).
  const countByLot = (list) => {
    const m = new Map();
    for (const x of list) {
      for (const c of new Set(Array.isArray(x.collection) ? x.collection : [x.collection])) m.set(c, (m.get(c) ?? 0) + 1);
    }
    return m;
  };
  const showsByLot = countByLot(shows), rpsByLot = countByLot(rps);
  const rows = collections.map((lot) => {
    const kindLabel = KIND_LABEL[lot.kind] || lot.kind || "Accession";
    const attestorCredit = (lot.attestor && attestorsById.get(lot.attestor)) ? ` &middot; Contributed by ${esc(attestorsById.get(lot.attestor).display)}` : "";  // THE ATTESTOR CREDIT on contributed material (docs/ATTESTATION.md §2; the Janitor 2026-09-21)
    const live = lotLiveStats.get(lot.id);
    const blurbText = lot.blurb ? sanitizeAccessionBlurb(liveBlurbCounts(lot.blurb, live?.wings, live?.docs)) : sanitizeAccessionBlurb(lot.note);
    const att = lot.attestor ? attestorsById.get(lot.attestor) : null;
    const kindVals = [...new Set([lot.kind, kindLabel].filter(Boolean))];
    const searchBlob = [lot.id, kindLabel, att ? att.display : "", blurbText].filter(Boolean).join(" | ").toLowerCase();
    const attrs = [
      `data-search="${esc(searchBlob)}"`,
      `data-id="${esc(lot.id)}"`,
      `data-kind="${esc(kindVals.join(" | "))}"`,
      lot.attestor ? `data-attestor="${esc([lot.attestor, att?.display].filter(Boolean).join(" | "))}"` : "",
      `data-wings="${live?.wings ?? 0}"`,
      `data-docs="${live?.docs ?? 0}"`,
      `data-shows="${showsByLot.get(lot.id) ?? 0}"`,
      `data-rps="${rpsByLot.get(lot.id) ?? 0}"`,
    ].filter(Boolean).join(" ");
    return { id: lot.id, html: `<li ${attrs}><span class="when">${esc(kindLabel)}${attestorCredit}</span><a href="/collections/${esc(lot.id)}.html">${esc(lot.id)}</a> &mdash; ${esc(blurbText)}</li>` };
  });
  writeIndexV2(resolve(DATA, "collections-index.json"), "collections_index", rows, { where: "collections-index.json" });
  const firstLot = collections[0]?.id, lastLot = collections[collections.length - 1]?.id;
  const main = `<p class="crumb"><a href="/">Museum</a> &nbsp;/&nbsp; Collections</p>

  <span class="kicker">Collections</span>
  <h1>Every accession, in acquisition order.</h1>
  <p class="lede">
    This documents the museum's acquisition history, one row per lot,
    numbered as it arrived. Everything the museum serves can be
    transparently traced back to a lot documented here.
  </p>

  <p class="muted small"><a href="/feed.xml" type="application/rss+xml">RSS</a></p>

  <p>
    <label class="label-offscreen" for="q">Search the accessions</label>
    <input id="q" class="filter-input filter-input--search" type="text" placeholder="Search by lot number, kind, contributor or contents" autocomplete="off" spellcheck="false">
    <label class="label-offscreen" for="filter">Add a filter</label>
    <input id="filter" class="filter-input" type="text" list="filter-options" placeholder="Add a filter&hellip;" autocomplete="off" spellcheck="false">
    <datalist id="filter-options"></datalist>
  </p>
  <p class="query-examples"><span class="query-examples-label">Start with</span><button type="button" class="query-chip" data-q="kind:private-donation">Private donations</button><button type="button" class="query-chip" data-q="attestor:">Contributed by a named person</button><button type="button" class="query-chip" data-q="wings:&gt;50">Lots of 50+ wings</button></p>
  <p id="status" class="muted small" aria-live="polite"><!--stat:listtotal-->${rows.length.toLocaleString("en-US")}<!--/stat--> accessions</p>
  <div id="fields-help"></div>
  <noscript><p class="muted">The searchable list needs JavaScript. Every accession is also its own page, numbered in the order it arrived: start at <a href="/collections/${esc(firstLot)}.html">${esc(firstLot)}</a> and follow <em>next</em> through to <a href="/collections/${esc(lastLot)}.html">${esc(lastLot)}</a>.</p></noscript>
  <ul id="results" class="archive-list">${bakedIndexRows(rows, "collections-index.json")}</ul>
  <script src="/js/query.js?v=7"></script>
  <script src="/js/list.js?v=14"></script>
  <script>
(function () {
  "use strict";
  // THE COLLECTIONS INDEX (hook c158): every row is rendered at build time (cross-reference.mjs, generateAccessionIndex) into
  // data/collections-index.json and painted 200 at a time, as on the other index pages. An accession's own page is the complete
  // record, and its baked prev/next pager (keyed "collections") walks the filtered list saved here.
  var qInput = document.getElementById("q");
  MuseumList.wireIndexList({
    url: "/data/collections-index.json",
    container: document.getElementById("results"),
    input: qInput,
    filterInput: document.getElementById("filter"),
    filterDatalist: document.getElementById("filter-options"),
    status: document.getElementById("status"),
    fieldsHelp: document.getElementById("fields-help"),
    windowSize: 200,
    pagerType: "collections",
    noun: "accession",
    browseHtml: '<a href="/collections/${esc(firstLot)}.html">the first accession</a> and its next links'
  });
})();
  </script>`;
  const footerLine = `THE E-WRESTLING MUSEUM <span class="rule">/</span> Collections <span class="rule">/</span>
    <a href="/">back to the museum</a><br>
    Generated 2026 from the accession registry &mdash; not backdated. See
    <a href="/curation.html">Curation</a>.`;
  return pageShell({ title: "Collections &mdash; E-WRESTLING MUSEUM", main, footerLine, rel: "collections/index.html" });
}
writeFileSync(resolve(ROOT, "collections", "index.html"), generateAccessionIndex());

console.log(
  `cross-reference: ${accessionPageCount} accession pages generated` +
  (chunkedLots.length
    ? ` (${chunkedLots.map((l) => `${l.id}: ${l.wings} held wings over ${l.pages} chunk pages`).join("; ")}).`
    : "."),
);

// THE CLOBBERING-BUG FIX (prev/next navigation wave, discovered live):
// characters.html used to be baked here too, from a `wrestlersHtml` template
// that quietly stopped being updated once THE 397/400 FUSE WAVE turned
// characters.html into a hand-maintained INSTRUMENT page (fetches
// data/characters-index.json at runtime, filters/windows client-side — see
// that file's own header comment). The stale template kept silently
// overwriting the real, current characters.html on every run — missing the
// Roleplays nav link, an un-versioned style.css, no chrome markers, no
// pagerType wiring — invisible in practice because `npm run chrome`
// (always run right after, per the documented workflow) re-stamped the
// head/footer back into shape and masked most of the damage, except
// anything unique to characters.html's own hand-edited body. Removed for
// good: this generator no longer touches characters.html at all. Its own
// promo/style/memorial `<datalist>` options are consequently hand-
// maintained now too, same as its A-Z links and filter markup already
// were — a future registry change (a new promotion, a new style string,
// a new memorial) needs a matching hand-edit there, not a regeneration.

// ---------------------------------------------------------------------------
// 3b. THE PER-WRESTLER PAGES WAVE — one generated page per character/unit,
//     /characters/<id>.html, the drill-down the registry was built for.
//     Renders ONLY what the data holds: an empty section simply doesn't
//     appear (no "nothing here yet" narration, same rule as everywhere else
//     in the museum). Reign-by-reign detail, RPs, identity hedges, and
//     kayfabe tenure attributes all live here — the flat characters.html list
//     stays a directory, this is where the record actually lives.
// ---------------------------------------------------------------------------
function entityLink(id) {
  const e = byId.get(id);
  return e ? `<a href="/characters/${id}.html">${esc(e.name)}</a>` : esc(id);
}

// ---------------------------------------------------------------------------
// 3a2. THE MATCH SECTION (2026-08-20, the Janitor's own brief: "we now are very
//     close to an extensive match documentation system with results and
//     stipulations with no good way to search through it. Plus that would
//     make wrestler pages leaner: no need to document their match history
//     when we can just point to the live match search.") — NO per-match
//     pages, ever; every row here links straight to its own show's page
//     (and that show's own served archive page where one exists — `page`
//     already points there). data/shows.json's own `matches[]` (thousands
//     of rows across every promotion) is the sole source; this section is
//     the search SURFACE over it, not a second copy of the data. Same
//     "instrument fetches a pre-baked JSON index" shape THE 397/400 FUSE
//     WAVE established for characters.html — see matches.html's own script
//     for the client half.
// ---------------------------------------------------------------------------
const titlesById = new Map(titles.map((t) => [t.id, t]));
// STIPULATION FAMILIES AND ARGYLE'S CODES (the Janitor's D249, 2026-10-03; CURATION.md v127, #match-stip-codes;
// docs/SCHEMA.md stipulation-families.json and stip-codes.json). A match row's filterable `data-stipulation` is
// widened, exactly as characters.html's `data-style` is by style-families.json, with every family its verbatim
// `stipulation` string resolves to AND every family data/stip-codes.json gives its `stip` codes, so a family filter
// (`stipulation:"iron man"`) finds the match by the fed's wording or by Argyle's code. The verbatim string is still
// the only stipulation text that renders. `data-stip` carries the codes themselves, plus his display names where
// stip-codes.json has them (`stip:ironman`). Both files are optional here: absent, nothing widens.
const stipFamiliesRaw = existsSync(resolve(DATA, "stipulation-families.json")) ? loadJSON("stipulation-families") : { families: {} };
const stipFamilyByVariant = new Map();
for (const [fam, variants] of Object.entries(stipFamiliesRaw.families ?? {})) {
  for (const v of variants ?? []) {
    const list = stipFamilyByVariant.get(v) ?? [];
    if (!list.includes(fam)) list.push(fam);
    stipFamilyByVariant.set(v, list);
  }
}
const stipCodesRaw = existsSync(resolve(DATA, "stip-codes.json")) ? loadJSON("stip-codes") : { codes: [] };
const stipCodeByCode = new Map((stipCodesRaw.codes ?? []).map((c) => [c.code, c]));

// TITLE-MATCH DERIVATION — cheap and high-confidence only, never a guess.
// matches[] itself carries no `title` field anywhere in the corpus (checked
// live before writing this). THE REIGN-SHOW LINKAGE INVARIANT already wires
// every reign's own `event` to the show id it was WON on — a match is
// flagged as a title match only when a reign's own holder-id set matches
// exactly one match's own side on that same show, with every holder
// resolvable to a real id (an `unminted` holder makes the set unverifiable,
// so it's skipped rather than guessed) and no OTHER match on the same show
// sharing that same side (an unresolved tie is left unflagged, same
// discipline `event`-linking itself uses for a same-date ambiguity).
const reignsByShowId = new Map();
for (const r of reigns) {
  if (!r.event) continue;
  const list = reignsByShowId.get(r.event) ?? [];
  list.push(r);
  reignsByShowId.set(r.event, list);
}
function sameIdSet(side, idSet) {
  return side.length === idSet.size && side.every((id) => idSet.has(id));
}
function deriveMatchTitle(show, match) {
  if (!match.sides?.length) return null;
  const candidates = reignsByShowId.get(show.id);
  if (!candidates) return null;
  for (const r of candidates) {
    const holders = r.holder ?? [];
    if (!holders.length || holders.some((h) => !h.id)) continue; // unminted/unresolvable — never guessed
    const holderSet = new Set(holders.map((h) => h.id));
    const hits = match.sides.filter((side) => sameIdSet(side, holderSet));
    if (!hits.length) continue;
    const otherMatchesShareIt = show.matches.some((m2) => m2 !== match && (m2.sides ?? []).some((side) => sameIdSet(side, holderSet)));
    if (otherMatchesShareIt) continue; // ambiguous across the show's own matches — left unflagged, not guessed
    return r.title;
  }
  return null;
}

function nameFor(id) {
  return byId.get(id)?.name ?? id;
}
function sideLinks(ids) {
  return ids.map(entityLink).join(" &amp; ");
}

// THE EVENT ROW (the Janitor's site sweep, 2026-10-08, "Meta": "All of the chronological categories (shows, matches, appearances,
// reigns, bestowals, and roleplays) have mostly the same datapoints but in practice there's large varieties in formatting. Can we
// design a more consistent visual presentation for all of these? Characters throughout should always link to their characters,
// promotions should always link to their wings, bestowals should always link to their award, reigns should always link to their
// championship, matches and appearances should always link to their shows"; hook c151). ONE row anatomy for the four event
// instruments - Matches, Appearances, Reigns, Bestowals - built by eventRowHtml and nothing else:
//   <li data-...>
//     <span class="when">DATE &middot; WING</span>     the date column, then the wing as a link (promoLinkedLabel)
//     EVENT                                             what happened, every character in it a link to its page
//     &mdash; REF                                       what it belongs to: the show (matches, appearances), the
//                                                       championship (reigns), the award (bestowals)
//     TAIL                                              muted small clauses: stipulation, title match, how, note, conflict
//   </li>
// The DATE is the row's sort date and goes through THE UNKNOWN-DATE RULE (the block above dateLabel): a date, or "unknown" /
// "unknown (by YYYY-MM-DD)", never an empty cell and never a default year. A reign's column is the date it was WON (its end is a
// clause of the event); a bestowal's is its year (its rank leads the event). Unknown dates come last, alphabetical by the label the
// row displays (chronoKey(date, label): the show, the championship, the award), each group in registry order. The shows and
// roleplays lists (inline in shows.html / rps.html) read the same way.
function eventRowDateText(d) {
  return showDateKey(d) ? dateLabel(d) : unknownDateLabel(d);
}
// The show's own name as a link, the wing's prefix left to the wing link beside the date (showLabelHtml's twin, second half).
function showNameLinkHtml(show, promo) {
  const prefix = bareAcronym(promo) || String(show.promotion ?? "").toUpperCase();
  let rest = show.name;
  if (show.name.toUpperCase().startsWith(`${prefix.toUpperCase()} `)) {
    rest = show.name.slice(prefix.length).replace(/^\s+/, "");
  }
  return show.page ? `<a href="${esc(show.page)}">${esc(rest)}</a>` : esc(rest);
}
function eventRowHtml({ attrs, dateText, wingHtml, eventHtml, refHtml, tailHtml }) {
  const eyebrow = wingHtml ? `${esc(dateText)} &middot; ${wingHtml}` : esc(dateText);
  return `<li ${attrs}><span class="when">${eyebrow}</span>${eventHtml}${refHtml ? ` &mdash; ${refHtml}` : ""}${tailHtml ?? ""}</li>`;
}
// The year row each of the four pages carries between its register markers (the same patchRegisterMarker the A-Z rows and the
// roleplays' year row use): one link per year the index holds, and "unknown" for the tail. No static year pages exist for these
// lists, so each link is a ?q=year:NNNN deep link; js/list.js wireYearLinks (hook c145) intercepts a plain click and filters in place.
function patchEventYearRow(fileName, rows) {
  const years = new Set();
  let unknown = false;
  for (const r of rows) {
    const m = /data-year="([^"]*)"/.exec(r.html);
    if (!m) continue;
    if (m[1] === "unknown") unknown = true; else years.add(m[1]);
  }
  const links = [...years].sort().map((y) => `<a href="/${fileName}?q=year:${y}" data-year="${y}">${y}</a>`);
  if (unknown) links.push(`<a href="/${fileName}?q=year:unknown" data-year="unknown">unknown</a>`);
  patchRegisterMarker(fileName, `Browse by year &mdash; ${links.join(" &middot; ")}`);
}
// A reign's unknown-date label: its wing and championship, as the row displays them.
function reignTailLabel(r) {
  const t = titleById.get(r.title);
  const promo = t ? promoById.get(t.promotion) : null;
  return `${acronymLabel(promo)} ${t?.name ?? r.title}`.trim();
}

// One row's baked HTML — an archive-list `<li>`, same shape shows.html's
// own rows use, not a roster-card (a match is a fact about a night, not an
// entity). `data-*` carries every filterable field; nothing here needs a
// bespoke widget — js/query.js's mechanical field discovery makes each one
// a `field:` filter-typeahead entry automatically the moment the attribute
// exists, same as every other list page on the site.
function renderMatchRow(show, match, promo) {
  const promoAcro = (promo ? acronymLabel(promo) : null) || String(show.promotion ?? "").toUpperCase();
  const dateText = eventRowDateText(show.date);
  const dateSort = showDateKey(show.date) || "";
  const stip = match.stipulation ?? "";
  const titleId = deriveMatchTitle(show, match);
  const title = titleId ? titlesById.get(titleId) : null;

  let bodyHtml, participantIds = [], winnerIds = [];
  if (match.sides?.length) {
    participantIds = match.sides.flat();
    const hasWinner = typeof match.winner_side === "number" && match.sides[match.winner_side];
    if (match.sides.length === 2) {
      const [a, b] = match.sides;
      if (hasWinner) {
        const winSide = match.sides[match.winner_side];
        const loseSide = match.sides[1 - match.winner_side];
        winnerIds = winSide;
        bodyHtml = `${sideLinks(winSide)} defeated ${sideLinks(loseSide)}`;
      } else {
        bodyHtml = `${sideLinks(a)} vs ${sideLinks(b)} <span class="muted small">(no decision recorded)</span>`;
      }
    } else if (hasWinner) {
      const winSide = match.sides[match.winner_side];
      winnerIds = winSide;
      const others = match.sides.filter((_, i) => i !== match.winner_side);
      bodyHtml = `${sideLinks(winSide)} won a ${match.sides.length}-way match over ${others.map(sideLinks).join(", ")}`;
    } else {
      bodyHtml = match.sides.map(sideLinks).join(" vs ");
    }
  } else if (match.participants?.length) {
    participantIds = match.participants;
    bodyHtml = match.participants.map(entityLink).join(", ");
  } else {
    bodyHtml = `<span class="muted small">no participants recorded</span>`;
  }

  // TITLE-DIRECTORY DISAMBIGUATION convention (championships.html,
  // MuseumList.titleLabel() client-side): a standalone title mention
  // carries a BARE acronym prefix, not the year-qualified filter-chip form
  // — promoAcro (below) is deliberately reserved for the filterable
  // data-promotion/data-title attributes, not for what actually renders.
  const titleTag = title
    ? ` <span class="muted small">(title match &mdash; <a href="${esc(title.page)}">${esc(bareAcronym(promo))} ${esc(title.name)}</a>)</span>`
    : "";
  const stipTag = stip ? ` <span class="muted small">(${esc(stip)})</span>` : "";

  const participantNames = participantIds.map(nameFor);
  const winnerNames = winnerIds.map(nameFor);
  // c64 SEARCH-SEPARATOR (2026-10-05, D325): parts join with " | ", never a bare space, so one name's last word and
  // the next name's first word can never read as a third name (gate 256 went red on two fWo names fused that way).
  const searchBlob = [showLabel(show), promoAcro, ...participantNames, stip, title?.name ?? ""].join(" | ").toLowerCase();

  // THE DEEP-LINK ID FIX (2026-08-22): a character page's own "search the
  // match index" link (renderShowsSection, below) passes the entity's ID
  // (`?participant=<id>`, e.g. "seymour-almasy") — but this attribute used
  // to carry DISPLAY NAMES only ("Seymour Almasy"). js/query.js's own
  // id-like-value matcher requires an EXACT token match for a hyphenated,
  // space-free value like an id, and a name never equals its own id, so
  // the deep link silently returned zero rows every time. Fix: the raw ids
  // ride along as ADDITIONAL pipe-delimited values in the SAME field —
  // `participant:seymour-almasy` now matches the id-shaped value exactly,
  // while `participant:almasy` still substring-matches the name-shaped
  // value exactly as before. Same mechanism, applied identically to every
  // other id-driven deep link on the site (data-promo below, and the new
  // reigns/appearances/awards instruments) — see js/query.js's own header
  // comment on isIdLikeValue for why mixing shapes in one field is safe.
  const participantIdVals = [...new Set(participantIds)];
  // D249 (CURATION.md v127): the stipulation filter widens with the families of the verbatim string and of the
  // row's own `stip` codes; `data-stip` carries the codes and his names for them. Nothing new renders.
  const stipCodes = Array.isArray(match.stip) ? match.stip : [];
  const stipFams = [...new Set([...(stip ? stipFamilyByVariant.get(stip) ?? [] : []),
    ...stipCodes.flatMap((c) => stipCodeByCode.get(c)?.families ?? [])])].filter((f) => f !== stip);
  const stipAttr = [stip, ...stipFams].filter(Boolean).join(" | ");
  const stipCodeVals = [...new Set([...stipCodes, ...stipCodes.map((c) => stipCodeByCode.get(c)?.name).filter(Boolean)])];
  const attrs = [
    `class="match-row"`,
    `data-search="${esc(searchBlob)}"`,
    `data-promotion="${esc([promoAcro.toLowerCase(), show.promotion].join(" | "))}"`,
    `data-show="${esc(showLabel(show).toLowerCase())}"`,
    `data-date="${esc(dateSort)}"`,
    `data-year="${esc(dateYearOrUnknown(show.date))}"`,
    (participantNames.length || participantIdVals.length) ? `data-participant="${esc([...participantNames, ...participantIdVals].join(" | "))}"` : "",
    winnerNames.length ? `data-winner="${esc(winnerNames.join(" | "))}"` : "",
    stipAttr ? `data-stipulation="${esc(stipAttr)}"` : "",
    stipCodeVals.length ? `data-stip="${esc(stipCodeVals.join(" | "))}"` : "",
    title ? `data-title="${esc(promoAcro.toLowerCase() + " " + title.name.toLowerCase())}"` : "",
  ].filter(Boolean).join(" ");

  return eventRowHtml({
    attrs, dateText, wingHtml: promoLinkedLabel(show.promotion),
    eventHtml: `${bodyHtml}${titleTag}${stipTag}`, refHtml: showNameLinkHtml(show, promo),
  });
}

// THE MATCHES-INDEX PURITY RULE (REVIEW-FIXES WAVE, 2026-08-22, the Janitor:
// participant:seymour-almasy returned "UWF Contest of Champions II — Seymour
// Almasy but no match is actually noted there"). The phantom rows were
// genuine matches[] entries, but DEGENERATE ones: an under-parsed row with a
// single resolvable entrant and no outcome, stipulation, eliminations, or
// note (the CoC II card lists "Seymour Almasy (c) -v- Jamie Shock", but the
// structured row only ever resolved `participants: ["seymour-almasy"]`) —
// rendered on the instrument, that's a bare name, not a match. Such a row
// stays in the registry (it's honest partial data, and the show page is the
// record) but does NOT index: only a row with actual match content — two-
// plus entrants, or any outcome/stipulation/eliminations/note — earns an
// instrument row. registry-validate.mjs's own matches-index freshness count
// mirrors this rule exactly (its `matchIndexable`); change both together.
function matchHasIndexableContent(m) {
  const entrants = (m.sides ?? []).flat().length + (m.participants?.length ?? 0);
  return entrants >= 2 || m.winner_side != null || m.winner != null ||
    (m.winners?.length ?? 0) > 0 || (m.losers?.length ?? 0) > 0 ||
    m.result != null || m.stipulation != null ||
    (m.eliminations?.length ?? 0) > 0 || m.note != null;
}
// THE CHRONOLOGICAL DEFAULT (REVIEW-FIXES WAVE, 2026-08-22, the Janitor): every
// instrument's baked row order is chronological ascending — the archival
// register's own direction, oldest first — so the fetched document order IS
// the default sort, no client-side sorting step to drift. Precision-aware
// via showDateKey (year-only sorts within its year, after that year's dated
// months); a date it can't place at all sorts last. The sort is stable, so
// same-key rows keep registry order (a show's own card order, a title's own
// ledger order).
// THE UNKNOWN-DATE RULE (see the block above dateLabel): an unknown date's key is DATE_SORT_LAST, and with a tailLabel
// the tail sorts alphabetically by it (sortKeyStr, the same fold every register uses); no label = the old bare key.
function chronoKey(dateObj, tailLabel) {
  const k = showDateKey(dateObj);
  if (k) return k;
  return tailLabel == null ? DATE_SORT_LAST : `${DATE_SORT_LAST} ${sortKeyStr(tailLabel)}`;
}
const matchesIndex = [];
let matchRowCount = 0, degenerateMatchRows = 0;
for (const s of shows) {
  if (!s.matches?.length) continue;
  const promo = promoById.get(s.promotion);
  for (const [i, m] of s.matches.entries()) {
    if (!matchHasIndexableContent(m)) { degenerateMatchRows++; continue; }
    matchesIndex.push({ id: `${s.id}-m${m.order ?? i}`, key: chronoKey(s.date, showLabel(s)), html: renderMatchRow(s, m, promo) });
    matchRowCount++;
  }
}
matchesIndex.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
for (const r of matchesIndex) delete r.key;
writeIndexV2(resolve(DATA, "matches-index.json"), "matches_index", matchesIndex, { where: "matches-index.json" });
patchEventYearRow("matches.html", matchesIndex);
console.log(`cross-reference: ${matchRowCount} match rows indexed chronologically (data/matches-index.json); ${degenerateMatchRows} degenerate single-entrant rows not indexed.`);

// ---------------------------------------------------------------------------
// 3a3. THE INSTRUMENTS WAVE (2026-08-22) — three more "instrument fetches a
//     pre-baked JSON index" pages, same shape as matches.html/matches-index
//     above: reigns.html (one row per data/reigns.json entry), appearances.html
//     (one row per data/shows.json appearances[] entry, the largest index on
//     the site), and data/awards-index.json (one row per bestowal, extending
//     the existing awards.html award-ENTITY directory rather than replacing
//     it — awards.html keeps its one-row-per-award list and gains a second,
//     bestowal-level search beneath it). The Janitor's doctrine, the governing
//     principle for all three: "nothing enumerable lives on a page" — a
//     character/title/show page states identity and LINKS to these
//     instruments, never re-lists what they already hold; the search is the
//     truth and grows without page maintenance. THE DEEP-LINK ID FIX above
//     is baked in from the start here, not bolted on after: every entity-
//     reference field (holder/title/promotion/who/recipient/award) carries
//     BOTH its display label AND its raw id as alternate pipe-delimited
//     values in the same data-* attribute, so a `?field=<id>` deep link and
//     a typed `field:name` search both resolve correctly through the same
//     mechanism js/query.js's isIdLikeValue already implements.
// ---------------------------------------------------------------------------

// 3a3-i. REIGNS — one row per data/reigns.json entry (~994). reignHolderCell
// (defined further down, in the /titles/ page section) is a function
// declaration and hoists, so it's callable here even though it's defined
// later in the file — same "the title's own reign table and this index
// render identically-shaped holder cells" contract on purpose.
function renderReignRow(r) {
  const t = titleById.get(r.title);
  const promo = t ? promoById.get(t.promotion) : null;
  const promoAcro = (promo ? acronymLabel(promo) : null) || "";
  const titleCell = t ? `<a href="${esc(t.page)}">${esc(t.name)}</a>` : esc(r.title);
  const holderCell = reignHolderCell(r);
  const wonShow = r.event ? showById.get(r.event) : null;
  // THE EVENT ROW: the date column is the date the reign was WON (its sort date; "unknown" when it is not on record, as for
  // the 1,401 reigns that carry no won date); the show it was won at and the end of the reign are clauses of the event.
  const wonText = eventRowDateText(r.won);
  const wonShowCell = wonShow && wonShow.page
    ? ` <span class="muted small">won at ${showNameLinkHtml(wonShow, promoById.get(wonShow.promotion))}</span>` : "";
  const lostShowId = lostEventByReignId.get(r.id);
  const lostShow = lostShowId ? showById.get(lostShowId) : null;
  const lostLabel = r.lost ? esc(dateLabel(r.lost)) : "";
  const lostCell = lostLabel ? (lostShow && lostShow.page ? `<a href="${esc(lostShow.page)}">${lostLabel}</a>` : lostLabel) : "";
  // THE INDEX-FEEDBACK WAVE (2026-09-08, the Janitor): the museum serves only
  // dead promotions, so no reign is genuinely CURRENT — an open-ended span
  // (no lost date on record) reads "unknown", never "present" (which
  // asserts a state relative to today, the one thing this museum never
  // does about a closed fed).
  const span = r.lost && showDateKey(r.lost) ? ` <span class="muted small">until ${lostCell}</span>` : ` <span class="muted small">end unknown</span>`;
  // L380 (reigns-index/title-page parity fix, 2026-09-06): this builder used
  // to run only sanitizeMachineryLeak() on how/note/conflict.note, one stage
  // short of what renderTitleReignsTable (below -- the /titles/*.html path
  // for these exact same fields) already does with servedText(): strip
  // process-marked SENTENCES first, on the raw text, before any laundering
  // can hide them; sanitize; then strip once more, because the sanitizer's
  // own rewrites can put a fresh marker word into a sentence that didn't
  // have one before. That one missing stage is exactly why 66 reign rows
  // across 9 wings leaked raw coordinator/wave/lane narration on /reigns.html
  // while the same rows' own title pages already rendered clean
  // (non-wing-pages-qa-2026-09-06.md, defect #5). Matching the title-page
  // call here, field for field, closes the gap without touching
  // renderTitleReignsTable itself.
  const howText = servedText(r.how || "");
  const how = howText ? ` <span class="muted small">(${esc(howText)})</span>` : "";
  const noteText = r.note ? servedText(r.note) : "";
  const note = noteText ? ` <span class="muted small">${esc(noteText)}</span>` : "";
  const conflictText = r.conflict ? servedText(r.conflict.note) : "";
  const conflict = conflictText
    ? `<div class="note"><span class="flag">Sources disagree</span>${esc(conflictText)}</div>`
    : "";

  const holderIds = (r.holder ?? []).filter((h) => h.id && !h.id.startsWith("name-") && byId.has(h.id)).map((h) => h.id);
  const holderNames = (r.holder ?? []).map((h) => (h.id ? nameFor(h.id) : h.name)).filter(Boolean);
  const year = dateYearOrUnknown(r.won);
  // Same L380 fix: the row's own `data-search` attribute (below) was built
  // from raw r.how, so a visitor's "view source" (or anything reading the
  // markup directly, e.g. a scraper) saw the same raw narration even where
  // the visible <span> text was already sanitizeMachineryLeak-cleaned.
  // howText is the same servedText() output rendered above -- reuse it so
  // the search index and the visible text never disagree on this field.
  const searchBlob = [t?.name ?? r.title, promoAcro, ...holderNames, howText, r.label ?? ""].join(" | ").toLowerCase();

  const attrs = [
    `class="reign-row"`,
    `data-search="${esc(searchBlob)}"`,
    `data-title="${esc([t?.name ?? "", r.title].filter(Boolean).join(" | ").toLowerCase())}"`,
    `data-promotion="${esc([promoAcro.toLowerCase(), t?.promotion ?? ""].filter(Boolean).join(" | "))}"`,
    (holderNames.length || holderIds.length) ? `data-holder="${esc([...holderNames, ...holderIds].join(" | "))}"` : "",
    year ? `data-year="${esc(year)}"` : "",
  ].filter(Boolean).join(" ");

  // QA PASS (the Janitor, 2026-08-22): reigns read in the same event-row shape
  // shows/matches/roleplays use — the dated span leads, the substance
  // follows — instead of a one-off prose-ish line format.
  return eventRowHtml({
    attrs, dateText: wonText, wingHtml: t ? promoLinkedLabel(t.promotion) : "",
    eventHtml: holderCell, refHtml: titleCell, tailHtml: `${wonShowCell}${span}${how}${note}${conflict}`,
  });
}
const reignsIndex = [];
for (const r of reigns) reignsIndex.push({ id: r.id, key: chronoKey(r.won, reignTailLabel(r)), html: renderReignRow(r) });
// Chronological ascending on the won-date, stable (see THE CHRONOLOGICAL
// DEFAULT above) — an unknown-precision won-date sorts last, in ledger order.
reignsIndex.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
for (const r of reignsIndex) delete r.key;
writeIndexV2(resolve(DATA, "reigns-index.json"), "reigns_index", reignsIndex, { where: "reigns-index.json" });
patchEventYearRow("reigns.html", reignsIndex);
console.log(`cross-reference: ${reignsIndex.length} reign rows indexed chronologically (data/reigns-index.json).`);

// 3a3-ii. APPEARANCES — one row per data/shows.json appearances[] entry,
// registry-wide. The largest index on the site (every match AND angle
// presence, not just matches) — checked at generation time below; no
// special windowing needed yet at this row count (see matches.html's own
// windowSize:200 client-side reveal, the same pattern this page reuses).
function renderAppearanceRow(show, a, promo, idx) {
  const promoAcro = (promo ? acronymLabel(promo) : null) || String(show.promotion ?? "").toUpperCase();
  const dateText = eventRowDateText(show.date);
  const dateSort = showDateKey(show.date) || "";
  const who = byId.get(a.who);
  const whoLabel = who ? entityLink(a.who) : esc(a.who);
  // THE BILLED APPEARANCE (the Janitor's gavel, 2026-08-23): `billed` is a
  // third kind and labels itself — it is emphatically NOT a match, and
  // rendering it as one would assert exactly the thing the kind refuses to.
  const kindBits = [a.kind === "angle" || a.kind === "billed" ? a.kind : "match"];
  if (a.kind === "angle" && a.subtype) kindBits.push(a.subtype.replace(/-/g, " "));
  if (a.capacity) kindBits.push(CAPACITY_LABEL[a.capacity] || a.capacity);
  const kindTag = ` <span class="muted small">(${esc(kindBits.join(", "))})</span>`;
  const whoName = who?.name ?? a.who;
  const year = dateYearOrUnknown(show.date);
  const searchBlob = [whoName, showLabel(show), promoAcro, a.kind ?? "", a.subtype ?? "", a.capacity ?? ""].join(" | ").toLowerCase();

  const attrs = [
    `class="appearance-row"`,
    `data-search="${esc(searchBlob)}"`,
    `data-who="${esc([whoName, a.who].join(" | ").toLowerCase())}"`,
    `data-promotion="${esc([promoAcro.toLowerCase(), show.promotion].join(" | "))}"`,
    `data-show="${esc([showLabel(show), show.id].join(" | ").toLowerCase())}"`,
    `data-kind="${esc(kindBits.join(" | ").toLowerCase())}"`,
    `data-date="${esc(dateSort)}"`,
    year ? `data-year="${esc(year)}"` : "",
  ].filter(Boolean).join(" ");

  return eventRowHtml({
    attrs, dateText, wingHtml: promoLinkedLabel(show.promotion),
    eventHtml: `${whoLabel}${kindTag}`, refHtml: showNameLinkHtml(show, promo),
  });
}
const appearancesIndex = [];
for (const s of shows) {
  if (!s.appearances?.length) continue;
  const promo = promoById.get(s.promotion);
  for (const [i, a] of s.appearances.entries()) {
    // QA round 2 (the Janitor, 2026-08-22): the instrument IS non-match
    // appearances — match presences live whole in the Matches instrument,
    // so kind:match rows never bake into this index at all (the registry's
    // appearances[] stays complete; per-entity pages still merge both).
    if (a.kind === "match") continue;
    appearancesIndex.push({ id: `${s.id}-a${i}`, key: chronoKey(s.date, showLabel(s)), html: renderAppearanceRow(s, a, promo, i) });
  }
}
// Chronological ascending, stable (see THE CHRONOLOGICAL DEFAULT above).
appearancesIndex.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
for (const r of appearancesIndex) delete r.key;
writeIndexV2(resolve(DATA, "appearances-index.json"), "appearances_index", appearancesIndex, { where: "appearances-index.json" });
patchEventYearRow("appearances.html", appearancesIndex);
console.log(`cross-reference: ${appearancesIndex.length} appearance rows indexed chronologically (data/appearances-index.json).`);

// 3a3-iii. AWARDS BESTOWALS — one row per award.bestowals[] entry (~142+),
// extending awards.html (which keeps its own one-row-per-award-ENTITY
// directory) with a second, bestowal-level search surface underneath it.
function renderBestowalRow(a, b) {
  const promoAcro = acronymLabel(promoById.get(a.promotion)) || a.promotion;
  const who = (list) => (list ?? []).map((r) => (r.id ? entityLink(r.id) : esc(r.name))).join(", ");
  const recipientCell = who(b.recipient) || `<span class="muted small">no recipient recorded</span>`;
  const runnerUpCell = b.runner_up?.length ? ` <span class="muted small">(over ${who(b.runner_up)})</span>` : "";
  const resultTag = b.result === "nominated" ? ` <span class="muted small">(nominated)</span>` : "";
  const awardLink = `<a href="${esc(a.page)}">${esc(a.name)}</a>`;
  const recipientNames = (b.recipient ?? []).map((r) => (r.id ? nameFor(r.id) : r.name)).filter(Boolean);
  const recipientIds = (b.recipient ?? []).filter((r) => r.id).map((r) => r.id);
  const runnerUpNames = (b.runner_up ?? []).map((r) => (r.id ? nameFor(r.id) : r.name)).filter(Boolean);
  const runnerUpIds = (b.runner_up ?? []).filter((r) => r.id).map((r) => r.id);
  const searchBlob = [a.name, promoAcro, ...recipientNames, ...runnerUpNames, String(b.year ?? "")].join(" | ").toLowerCase();

  const attrs = [
    `class="bestowal-row"`,
    `data-search="${esc(searchBlob)}"`,
    `data-award="${esc([a.name, a.id].join(" | ").toLowerCase())}"`,
    `data-promotion="${esc([promoAcro.toLowerCase(), a.promotion].join(" | "))}"`,
    (recipientNames.length || recipientIds.length) ? `data-recipient="${esc([...recipientNames, ...recipientIds].join(" | "))}"` : "",
    (runnerUpNames.length || runnerUpIds.length) ? `data-runner-up="${esc([...runnerUpNames, ...runnerUpIds].join(" | "))}"` : "",
    `data-year="${esc(b.year != null ? String(b.year) : "unknown")}"`,
    // THE RANKED BESTOWAL: `rank:` is a filterable token of its own, so
    // "rank:1" finds every ranked poll's own winner across every year.
    b.rank != null ? `data-rank="${esc(String(b.rank))}"` : "",
  ].filter(Boolean).join(" ");

  // QA PASS (the Janitor, 2026-08-22): same event-row shape as reigns above.
  // THE INDEX-FEEDBACK WAVE (2026-09-08, the Janitor: "Bestowals index: each
  // row links to the awarding wing") — promoLinkedLabel (defined above,
  // §1's own promotion-tenure linking) is the sitewide "promotion name as
  // a link" convention; promoAcro itself stays plain text for the
  // search/data-* attributes above.
  // THE EVENT ROW: the date column is the year; the rank of a ranked poll leads the event.
  const rankTag = b.rank != null ? `<span class="muted small">#${esc(String(b.rank))}</span> ` : "";
  return eventRowHtml({
    attrs, dateText: b.year != null ? String(b.year) : "unknown", wingHtml: promoLinkedLabel(a.promotion),
    eventHtml: `${rankTag}${recipientCell}${resultTag}${runnerUpCell}`, refHtml: awardLink,
  });
}
const awardsIndex = [];
let bestowalCount = 0;
for (const a of awards) {
  for (const b of a.bestowals ?? []) {
    // Chronological ascending by year; within a year, by rank where the
    // award records one (THE RANKED BESTOWAL) — a poll's own countdown
    // order, not the order the rows happened to be extracted in.
    const rankKey = b.rank != null ? String(b.rank).padStart(6, "0") : "999999";
    awardsIndex.push({ id: `${a.id}-${b.year}-${bestowalCount}`, key: chronoKey(b.year != null ? { date: String(b.year), precision: "year" } : null,
      `${acronymLabel(promoById.get(a.promotion)) || a.promotion} ${a.name}`) + "|" + rankKey, html: renderBestowalRow(a, b) });
    bestowalCount++;
  }
}
// Chronological ascending by bestowal year, stable (see THE CHRONOLOGICAL
// DEFAULT above) — a yearless bestowal sorts last, in award-ledger order.
awardsIndex.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
for (const r of awardsIndex) delete r.key;
writeIndexV2(resolve(DATA, "awards-index.json"), "awards_index", awardsIndex, { where: "awards-index.json" });
patchEventYearRow("bestowals.html", awardsIndex);
console.log(`cross-reference: ${awardsIndex.length} bestowal rows indexed chronologically (data/awards-index.json).`);

// ---------------------------------------------------------------------------
// 3a4. THE SLIM-INDEX WAVE, SECOND HALF (hook c168, adversarial review
//     2026-10-09, finding B01): shows.html and rps.html joined the
//     pre-baked-index instruments. They used to fetch the REGISTRIES to
//     draw their rows — shows.html data/shows.json + data/promotions.json
//     (65 MB), rps.html data/rps.json + promotions + characters + units +
//     rp-catalog (90 MB, 13.6 MB gzipped) — and then build every <li> in
//     the browser before showing one. First rows landed after 16.7 s
//     (shows) and 13.2 s (rps) at 4x CPU on localhost; on a phone over
//     mobile data the pages stalled or ran out of memory. Nothing about
//     either list needed the registry: each row is a fixed string of
//     markup plus its filter fields, both knowable here.
//
//     These two builders are the BROWSER TWINS those pages' own inline
//     scripts used to be, moved to build time byte for byte: same row
//     order, same row markup, same data-* fields, same search blob. The
//     one deliberate difference is that writeIndexV2 carries each row's
//     id, so a row is addressable; the browser built <li> with no id.
//
//     THE MONTH NAME (listDateLabel below): shows.html and rps.html spell
//     the month out ("12 January 1998") where dateLabel() above
//     abbreviates it ("12 Jan 1998"), so these two pages' rows have always
//     read differently from the /shows/<year>/ registers and from the four
//     event instruments. This keeps each page's own spelling exactly as it
//     served it — one wording question for a ruling, not a change to smuggle
//     in under a performance fix.
// ---------------------------------------------------------------------------
const LIST_MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
// The browser twin of shows.html's dateLabel() / rps.html's fmtDate(): THE
// UNKNOWN-DATE RULE (the block above dateLabel) for an unknown date, a spelled-out
// month for an exact one, the stored value with its precision named for a softer one.
function listDateLabel(d) {
  if (!showDateKey(d)) return unknownDateLabel(d);
  const m = String(d.date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (d.precision === "exact" && m) {
    return `${parseInt(m[3], 10)} ${LIST_MONTH_NAMES[parseInt(m[2], 10) - 1]} ${m[1]}`;
  }
  return d.precision && d.precision !== "exact" ? `${d.date} (${d.precision})` : String(d.date);
}

// --- shows.html: data/shows-index.json ------------------------------------
function renderShowListRow(s) {
  const promo = promoById.get(s.promotion);
  const acro = promo ? acronymLabel(promo) : String(s.promotion ?? "").toUpperCase();
  // THE INDEX-FEEDBACK WAVE / hook c157: the date line reads DATE &middot; WING, the wing a link to its page.
  const wingHtml = promo?.page ? `<a href="${esc(promo.page)}">${esc(acro)}</a>` : esc(acro);
  // THE COLLECTED EDGE (the Janitor, 2026-08-22): a show the record proves ran but the collection does not
  // hold is a row like any other — collected:"no", no link, a plain chip.
  let titleHtml = showNameLinkHtml(s, promo);
  if (!s.page) titleHtml += ' <span class="muted small">&middot; not collected</span>';
  // JOINT-WING SHOWS (the Janitor, 2026-09-24; CURATION.md v121(c)): a row that names other wings in
  // also_promotions[] joins THEIR acronym and id into the same pipe-delimited field, so ?promo=<either wing>
  // and a typed promotion:<either wing> both return it.
  const promoValue = [acro.toLowerCase(), String(s.promotion ?? "")]
    .concat((s.also_promotions ?? []).flatMap((pid) => {
      const cp = promoById.get(pid);
      return [cp ? acronymLabel(cp).toLowerCase() : String(pid).toLowerCase(), String(pid)];
    }))
    .filter(Boolean).join(" | ");
  const attrs = [
    `data-search="${esc(`${s.name} ${acro}`.toLowerCase())}"`,
    `data-promo="${esc(promoValue)}"`,
    `data-year="${esc(dateYearOrUnknown(s.date))}"`,
    `data-collected="${s.page ? "yes" : "no"}"`,
  ].join(" ");
  return `<li ${attrs}><span class="when">${esc(listDateLabel(s.date))} &middot; ${wingHtml}</span>${titleHtml}</li>`;
}
const showsIndex = shows.map((s) => ({ id: s.id, key: chronoKey(s.date, showLabel(s)), html: renderShowListRow(s) }));
// THE CHRONOLOGICAL DEFAULT / THE UNKNOWN-DATE RULE: dated ascending, the unknown tail last and
// alphabetical by the label the row displays (the wing's acronym and the show's name).
showsIndex.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
for (const r of showsIndex) delete r.key;
writeIndexV2(resolve(DATA, "shows-index.json"), "shows_index", showsIndex, { where: "shows-index.json" });
console.log(`cross-reference: ${showsIndex.length} show rows indexed chronologically (data/shows-index.json).`);

// --- rps.html: data/rps-index.json ----------------------------------------
// hook c106 (the Janitor's D407): a roleplay no fed claims shows the community hub it was posted on
// (`venue`) as its label; the promotion facet stays the fed's claim only, so promotion:<hub> never lists it.
function rpListPromoHtml(promo, acro) {
  return promo?.page ? `<a href="${esc(promo.page)}">${esc(acro)}</a>` : esc(acro);
}
function rpNamesOf(ids) {
  return (ids ?? []).map((id) => byId.get(id)?.name ?? id).join(", ");
}
function rpIdsAndNames(ids) {
  return (ids ?? []).map((id) => {
    const e = byId.get(id);
    return e ? `${e.name} | ${id}` : id;
  }).join(" | ");
}
// Cheap discovery for team-attributed RPs: a unit's own members are folded into the search blob (not the
// visible "by" line), so searching a member's name still surfaces an RP credited to the team as a whole.
function rpSearchableMembers(ids) {
  const names = [];
  for (const id of ids ?? []) {
    const u = byId.get(id);
    // A member row with no name contributes an empty string, as the browser's own push(m.name) did:
    // byte-identical blobs, so the before/after proof has nothing to explain away.
    for (const m of u?.members ?? []) names.push(m.name ?? "");
  }
  return names.join(" ");
}
// THE RPS INSTRUMENT TOKENS WAVE (item 3): a catalog row's own `author` (who WROTE it, distinct from who it
// `involves`) is only recorded in rp-catalog.json, keyed by rps_id.
const rpAuthorByRpsId = new Map();
for (const c of rpCatalog) if (c.rps_id && c.author) rpAuthorByRpsId.set(c.rps_id, c.author);
function renderRpListRow(r) {
  const attrs = [`data-search="${esc(r.search)}"`, `data-promo="${esc(r.promoValue)}"`, `data-year="${esc(r.year)}"`];
  if (r.authorValue) attrs.push(`data-author="${esc(r.authorValue)}"`);
  if (r.involvesValue) attrs.push(`data-involves="${esc(r.involvesValue)}"`);
  if (r.referencesValue) attrs.push(`data-references="${esc(r.referencesValue)}"`);
  let label = r.href ? `<a href="${esc(r.href)}">${esc(r.title)}</a>` : `<span>${esc(r.title)}</span>`;
  if (r.collected === "no") label += ' <span class="muted small">&middot; not collected</span>';
  attrs.push(`data-collected="${r.collected}"`);
  const when = `${esc(r.date || "unknown")}${r.acroHtml ? ` &middot; ${r.acroHtml}` : ""}${r.byHtml ? ` &middot; ${r.byHtml}` : ""}`;
  return `<li ${attrs.join(" ")}><span class="when">${when}</span>${label}</li>`;
}
const rpListRows = rps.map((rp) => {
  const promo = promoById.get(rp.promotion);
  const venue = rp.promotion ? null : promoById.get(rp.venue);
  const acro = promo ? acronymLabel(promo)
    : rp.promotion ? String(rp.promotion).toUpperCase()
      : venue ? acronymLabel(venue) : "";
  const involves = rpNamesOf(rp.involves);
  const authorId = rpAuthorByRpsId.get(rp.id);
  const authorEntity = authorId ? byId.get(authorId) : null;
  return {
    id: rp.id,
    key: showDateKey(rp.date),
    title: rp.title,
    acroHtml: rp.promotion ? rpListPromoHtml(promo, acro) : venue ? rpListPromoHtml(venue, acro) : "",
    byHtml: (rp.involves ?? []).map(entityLink).join(", "),
    date: listDateLabel(rp.date),
    year: dateYearOrUnknown(rp.date),
    href: rp.served_url,
    search: `${rp.title} ${involves} ${rpNamesOf(rp.references)} ${acro} ${rpSearchableMembers(rp.involves)} ${rpSearchableMembers(rp.references)}`.toLowerCase(),
    // THE DEEP-LINK ID FIX: the raw promotion id rides along beside the acronym label, so ?promo=<id>
    // resolves correctly even where an id and its acronym ever diverge.
    promoValue: rp.promotion ? `${acro.toLowerCase()} | ${rp.promotion}` : "",
    authorValue: authorEntity ? `${authorEntity.name} | ${authorId}` : "",
    involvesValue: rpIdsAndNames(rp.involves),
    referencesValue: rpIdsAndNames(rp.references),
    // THE INDEX OPENS PRE-FILTERED (the Janitor, 2026-09-25; CURATION.md v122(b)): "yes" is every
    // data/rps.json row, which is what the lobby's Roleplays door counts.
    collected: "yes",
  };
});
// THE COLLECTED EDGE for roleplays: rp-catalog.json's own held:false rows — the record proves they existed,
// the collection does not hold them. The promotion is derived mechanically from each ghost's own recorded
// address (uwfonline.com -> uwf; the WWA Insider repository's relative viewer URLs -> wwa).
function rpGhostPromo(c) {
  const u = String(c.url ?? "");
  if (u.includes("uwfonline.com")) return "uwf";
  if (u.includes("insider-viewer.php") || /WWA Insider/.test(String(c.location ?? ""))) return "wwa";
  if (u.includes("ccw.rpcommunity.com") || u.includes("ccw.wrestleonline.org")) return "ccw-cyberspace";
  if (u.includes("pwe.projectefed.com")) return "pwe-projectefed";
  if (u.includes("ngw.theewe.net")) return "ngw";
  if (u.includes("ff.ewplanet.net")) return "ff";
  return "";
}
let rpGhostSeq = 0;
const rpGhostRows = rpCatalog.filter((c) => c.held === false)
  .sort((a, b) => (sortKeyStr(a.title) < sortKeyStr(b.title) ? -1 : sortKeyStr(a.title) > sortKeyStr(b.title) ? 1 : 0))
  .map((c) => {
    const pid = rpGhostPromo(c);
    const promo = promoById.get(pid);
    const acro = promo ? acronymLabel(promo) : "";
    const authorEntity = c.author ? byId.get(c.author) : null;
    const authorName = authorEntity ? authorEntity.name : "";
    return {
      id: c.id ?? `rp-ghost-${++rpGhostSeq}`,
      key: null,
      title: c.title,
      acroHtml: pid ? rpListPromoHtml(promo, acro) : "",
      byHtml: authorEntity ? entityLink(c.author) : "",
      date: "unknown", year: "unknown", href: null,
      search: `${c.title} ${authorName} ${acro}`.toLowerCase(),
      promoValue: pid ? `${acro.toLowerCase()} | ${pid}` : "",
      authorValue: authorEntity ? `${authorEntity.name} | ${c.author}` : (c.author ?? ""),
      involvesValue: "", referencesValue: "",
      collected: "no",
    };
  });
// THE UNKNOWN-DATE RULE: the dated rows keep their date order; the unknown tail (the held roleplays whose
// date is unknown and the ghosts, one list) is alphabetical by title, the label the row displays.
const rpDated = rpListRows.filter((r) => r.key)
  .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
const rpTail = rpListRows.filter((r) => !r.key)
  .sort((a, b) => (sortKeyStr(a.title) < sortKeyStr(b.title) ? -1 : sortKeyStr(a.title) > sortKeyStr(b.title) ? 1 : 0))
  .concat(rpGhostRows)
  .sort((a, b) => (sortKeyStr(a.title) < sortKeyStr(b.title) ? -1 : sortKeyStr(a.title) > sortKeyStr(b.title) ? 1 : 0));
const rpsIndex = rpDated.concat(rpTail).map((r) => ({ id: r.id, html: renderRpListRow(r) }));
writeIndexV2(resolve(DATA, "rps-index.json"), "rps_index", rpsIndex, { where: "rps-index.json" });
console.log(`cross-reference: ${rpsIndex.length} roleplay rows indexed chronologically (data/rps-index.json).`);

// ---------------------------------------------------------------------------
// 3a5. THE SLIM-INDEX WAVE, THIRD HALF (hook c174, adversarial review
//     2026-10-09, finding B01, the two rows hook c168 left behind):
//     halloffame.html and relationships.html joined the pre-baked-index
//     instruments.
//
//     WHAT THEY DID. /halloffame.html fetched data/inductions.json,
//     data/characters.json, data/units.json and data/promotions.json —
//     64.7 MB measured — to print 233 rows, and /relationships.html fetched
//     data/relationships.json plus the same three — 64.9 MB — to print 812.
//     Neither page wanted the registries: it wanted NAMES and ACRONYMS, both
//     knowable here. 64 MB for 233 rows is the worst ratio on the site.
//
//     WHAT THEY ASK FOR, AND WHY IT IS HERE. Both pages filter over fields
//     discovered MECHANICALLY from the record — js/query.js's
//     flattenFields(), which walks an arbitrary registry row into a flat
//     {field: [values]} map, so a field the data grows tomorrow is queryable
//     tomorrow with nothing hand-wired. That function had no Node twin;
//     flattenQueryFields() below is it, line for line, and the index carries
//     its output as the row's own data-* attributes, which js/query.js's
//     fieldsFromAttrMap() reads back into the same map. The attribute name IS
//     the field name (data-class_year, not a hyphenated spelling with an
//     alias entry to keep in sync), which is why splitIndexRow's attribute
//     pattern now admits a digit and an underscore.
//
//     THE ONE FIELD THAT CHANGES SHAPE. relationships.html built its `who`
//     field as TWO blobs, "<name> | <id>" each, where every other index on
//     the site carries names and ids as one pipe-delimited run ("<name> |
//     <id> | <name> | <id>" — appearances' own data-who, matches' own
//     data-participant). Pipe-delimited is what fieldsFromAttrMap splits on,
//     so the baked field is four values where the page's own was two. That
//     makes `who:` mean on this page exactly what it already means on
//     /appearances.html: a whole name or a whole id, not a substring of
//     either (SLUG IDS MATCH WHOLE, 2026-10-02). Bare-word search is
//     untouched — both names are still in the row's search blob, where a
//     partial word has always matched.
//
//     NO ROW ID FOR THE HALLS OF FAME. data/inductions.json carries no `id`
//     of its own, so that index carries none and its rows render byte for
//     byte as the browser built them. data/relationships.json does carry
//     one, so each edge row becomes addressable, the same way every
//     roster-card index already is.
//
//     THE LETTER AND YEAR ROWS (hook c147's own words: "add both
//     alphabetical and year filters, in the same way as wings") were built
//     in the browser from the fetched registry, which is why with
//     JavaScript off /halloffame.html served two labelled EMPTY sections.
//     They are baked here through patchRegisterMarker, the idiom
//     patchEventYearRow already uses, so the rows are in the document before
//     any script runs and a letter or year with nothing behind it is dimmed
//     rather than offered.
// ---------------------------------------------------------------------------
const inductions = existsSync(resolve(DATA, "inductions.json")) ? loadArray("inductions") : [];

// THE NODE TWIN of js/query.js's flattenFields() — same walk, same order,
// same skips: a leading-underscore key and `id` are not fields; null and
// undefined are not values; an array of objects folds ITS OWN keys up
// UNPREFIXED; a nested object shaped like the registry's standard date
// object ({date, precision, source}) ALSO exposes its own parent key, valued
// at the date string, before the ordinary recursion runs over it too. Proved
// against the browser's own flattenFields over every row of the two
// registries this block indexes (the workshop's 10-09 adversarial review,
// its FIXPREP-HEAVY-2 field comparison).
function flattenQueryFields(obj, out) {
  out = out ?? Object.create(null);
  if (!obj || typeof obj !== "object") return out;
  for (const k of Object.keys(obj)) {
    if (k.charAt(0) === "_" || k === "id") continue;
    const v = obj[k];
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length && typeof v[0] === "object") {
        for (const item of v) flattenQueryFields(item, out);
      } else if (v.length) {
        out[k] = (out[k] ?? []).concat(v.map(String));
      }
    } else if (typeof v === "object") {
      if (typeof v.date === "string") out[k] = (out[k] ?? []).concat([v.date]);
      flattenQueryFields(v, out);
    } else {
      out[k] = (out[k] ?? []).concat([String(v)]);
    }
  }
  return out;
}

// A discovered field map -> the row's own data-* attributes, the pipe-delimited
// roster-card convention for a multi-value field. The attribute name IS the
// field name; a name the HTML parser would fold differently (an uppercase
// letter) or that collides with the reserved search blob stops the gate here
// rather than writing an index whose filters quietly disagree with the page's.
function fieldsAttrText(fields, where) {
  let out = "";
  for (const name of Object.keys(fields)) {
    if (name === "search") {
      throw new Error(`${where}: a row carries a field literally named "search", which the index reserves for the plain-word blob`);
    }
    if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
      throw new Error(`${where}: field name "${name}" cannot ride as a data-* attribute (lowercase letter first, then letters, digits, "_" or "-")`);
    }
    const joined = fields[name].map((v) => String(v)).join(" | ");
    if (joined === "") continue; // never queryable; writeIndexV2 and js/query.js both skip an empty value
    out += ` data-${name}="${esc(joined)}"`;
  }
  return out;
}

// The Node twin of js/list.js's letterKey() — sortKeyStr is already the twin
// of its sortKey, so this is the one line on top of it.
function listLetterKey(name) {
  const k = sortKeyStr(name).charAt(0);
  return k >= "a" && k <= "z" ? k : "0-9";
}
// One row of letters, 0-9 then A-Z, each a ?q=letter: deep link the page's own
// search box reads on load (js/list.js wireLetterLinks intercepts a plain
// click and filters in place); a letter with nothing behind it is plain text.
// Same cells registerBrowseLine writes, minus the A-Z-register link these two
// lists have no register to point at.
function azQueryLetterRow(page, seen) {
  const cells = ["0-9", ..."abcdefghijklmnopqrstuvwxyz"].map((letter) => {
    const text = letter === "0-9" ? "0&ndash;9" : letter.toUpperCase();
    return seen.has(letter)
      ? `<a href="/${page}?q=letter:${letter}">${text}</a>`
      : `<span class="az-off">${text}</span>`;
  }).join("");
  return cells;
}

// --- halloffame.html: data/halloffame-index.json ---------------------------
// The browser twin of halloffame.html's own row builder, moved to build time:
// same label, same sub-line, same links, same sort. THE UNMINTED INDUCTEE
// (CURATION v108) and the UNDATED CLASS (the Janitor's gavel, 2026-09-02)
// render exactly as they did.
function renderInductionRow(ind) {
  const unminted = !!ind.inductee && typeof ind.inductee === "object";
  const entity = unminted ? null : byId.get(ind.inductee);
  const label = unminted ? ind.inductee.name : (entity ? entity.name : ind.inductee);
  const promo = promoById.get(ind.promotion);
  const acro = promo ? acronymLabel(promo) : String(ind.promotion ?? "").toUpperCase();
  let sub = `${acro} Hall of Fame · ` + (typeof ind.class_year === "number"
    ? `class of ${ind.class_year}`
    : (typeof ind.observed_by === "number"
      ? `class year unknown, observed by ${ind.observed_by}`
      : "class year unknown"));
  if (unminted && ind.inductee.fed) sub += ` · ${ind.inductee.fed}, unminted`;
  else if (unminted) sub += " · unminted";
  // THE WING LINK (hook c147): the sub-line's wing is a link to its page.
  const subHtml = (promo?.page ? `<a href="${esc(promo.page)}">${esc(acro)}</a>` : esc(acro)) + esc(sub.slice(acro.length));
  const href = unminted ? (ind.citation_url || "") : `/characters/${ind.inductee}.html`;
  const doc = unminted ? "" : (ind.citation_url || "");
  const yearKey = typeof ind.class_year === "number" ? String(ind.class_year) : "unknown";
  return { label: String(label ?? ""), href, doc, subHtml, yearKey, record: ind };
}
function hofRowHtml(r) {
  const fields = flattenQueryFields(r.record);
  // the letter and year rows filter this list in place through a `letter:` /
  // `year:` token (js/list.js, THE IN-PLACE LETTER / YEAR FILTER); the page's
  // own wireList `derive` computed these two in the browser.
  fields.letter = [listLetterKey(r.label)];
  fields.year = [r.yearKey];
  const attrs = ` data-search="${esc(r.label.toLowerCase())}"` + fieldsAttrText(fields, "halloffame-index.json");
  const title = r.href ? `<a href="${esc(r.href)}">${esc(r.label)}</a>` : esc(r.label);
  const sub = r.subHtml + (r.doc ? ` · <a href="${esc(r.doc)}">the induction, as served</a>` : "");
  return `<div class="roster-card"${attrs}><h2>${title}</h2><div class="handle">${sub}</div></div>`;
}
const hofRows = inductions.map(renderInductionRow).filter((r) => r.label)
  .sort((a, b) => {
    const ka = sortKeyStr(a.label), kb = sortKeyStr(b.label);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
writeIndexV2(resolve(DATA, "halloffame-index.json"), "halloffame_index",
  hofRows.map((r) => ({ id: "", html: hofRowHtml(r) })), { where: "halloffame-index.json" });
{
  const seenLetters = new Set(hofRows.map((r) => listLetterKey(r.label)));
  const seenYears = new Set(hofRows.map((r) => r.yearKey));
  const years = [...seenYears].filter((y) => y !== "unknown").sort();
  if (seenYears.has("unknown")) years.push("unknown");
  const yearCells = years.map((y) =>
    `<a href="/halloffame.html?q=year:${y}" data-year="${y}">${y === "unknown" ? "Unknown" : y}</a>`).join("");
  patchMarker("halloffame.html", "hofrows",
    bakedIndexRows(hofRows.map((r) => ({ id: "", html: hofRowHtml(r) })), "halloffame-index.json"));
  patchRegisterMarker("halloffame.html",
    `<span class="az-row"><span class="az-label">Browse by letter</span><span class="az-letters" id="hof-letters">${azQueryLetterRow("halloffame.html", seenLetters)}</span></span>\n    ` +
    `<span class="az-row"><span class="az-label">Browse by year</span><span class="az-letters" id="hof-years">${yearCells}</span></span>`);
}
console.log(`cross-reference: ${hofRows.length} induction rows indexed alphabetically (data/halloffame-index.json).`);

// --- relationships.html: data/relationships-index.json --------------------
// THE INDEX-FEEDBACK WAVE (2026-09-08, the Janitor: "we don't need a paragraph
// about how we know Crud and Spectre were rivals in GIWF, just a chip showing
// it was a feud and a link to the GIWF") — the free-text `detail` prose stays
// out of the rendered row (it is still in the registry and still in the search
// blob below), `nature` is a chip, and `era` links to its wing.
const REL_NATURE_LABELS = {
  feud: "Feud", ally: "Ally", "manager-of": "Manager",
  "tag-partner": "Tag Partners", "kayfabe-kin": "Kayfabe Kin",
  "kayfabe-spouse": "Kayfabe Spouse", "same-handler": "Same Handler",
  mentor: "Mentor",
};
function relEntityLinkHtml(id) {
  const e = byId.get(id);
  return e ? `<a href="/characters/${esc(id)}.html">${esc(e.name)}</a>` : esc(id);
}
// `era` is a single promotion id today but treated as "one or more" (the
// Janitor's own "promotion(s)") so a future multi-value record renders
// correctly without a second pass here.
function relEraIds(r) {
  if (!r.era) return [];
  return Array.isArray(r.era) ? r.era : [r.era];
}
function relRowHtml(r) {
  const an = byId.get(r.a)?.name ?? r.a;
  const bn = byId.get(r.b)?.name ?? r.b;
  const eras = relEraIds(r);
  const eraLabels = eras.map((pid) => {
    const promo = promoById.get(pid);
    return promo ? acronymLabel(promo) : String(pid).toUpperCase();
  });
  const eraHtml = eras.map((pid, i) => {
    const promo = promoById.get(pid);
    return promo?.page ? `<a href="${esc(promo.page)}">${esc(eraLabels[i])}</a>` : esc(eraLabels[i]);
  }).join(", ");
  const fields = Object.create(null);
  // the sitewide pipe-delimited names-and-ids convention (see the block
  // header): both sides of the edge resolve by whole name or whole id.
  fields.who = [`${an} | ${r.a}`, `${bn} | ${r.b}`];
  fields.nature = [r.nature];
  fields.grade = [r.grade || ""];
  // the A-Z row matches EITHER character of the edge
  fields.letter = listLetterKey(an) === listLetterKey(bn)
    ? [listLetterKey(an)] : [listLetterKey(an), listLetterKey(bn)];
  // Don't-emit-empty: `promotion:` only exists as a filterable field for the
  // rows that actually carry an `era`.
  if (eras.length) {
    fields.promotion = eras.map((pid, i) => `${eraLabels[i].toLowerCase()} | ${pid}`);
  }
  const search = `${an} ${bn} ${r.nature} ${r.detail || ""} ${eraLabels.join(" ")}`.toLowerCase();
  const attrs = ` data-search="${esc(search)}"` + fieldsAttrText(fields, "relationships-index.json");
  return {
    label: `${an} ↔ ${bn}`,
    html: `<div class="roster-card" id="${esc(r.id)}"${attrs}>` +
      `<h2>${relEntityLinkHtml(r.a)} <span class="muted">&harr;</span> ${relEntityLinkHtml(r.b)}</h2>` +
      `<div class="handle"><span class="chip">${esc(REL_NATURE_LABELS[r.nature] ?? r.nature)}</span>${eraHtml ? ` ${eraHtml}` : ""}</div></div>`,
    letters: fields.letter,
    id: r.id,
  };
}
const relRows = relationships.map(relRowHtml).sort((a, b) => {
  const ka = sortKeyStr(a.label), kb = sortKeyStr(b.label);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
});
writeIndexV2(resolve(DATA, "relationships-index.json"), "relationships_index",
  relRows.map((r) => ({ id: r.id, html: r.html })), { where: "relationships-index.json" });
patchRegisterMarker("relationships.html",
  `<span class="az-row"><span class="az-label">Browse by letter</span><span class="az-letters">` +
  `${azQueryLetterRow("relationships.html", new Set(relRows.flatMap((r) => r.letters)))}</span></span>`);
console.log(`cross-reference: ${relRows.length} relationship rows indexed alphabetically (data/relationships-index.json).`);

// ---------------------------------------------------------------------------
// 3a8. THE SLIM-INDEX WAVE, THIRD HALF (hook c202, adversarial review
//     2026-10-09, finding B01 — the remainder): promotions.html, the Wings
//     door and the museum's own front instrument, joined the pre-baked-index
//     instruments. It used to fetch data/promotions.json + the landing stamps
//     (15.2 MB measured) and build all 2,205 roster cards in the browser
//     before it showed one, to print a wing's name, its acronym and up to
//     eight chips.
//
//     This builder is the BROWSER TWIN promotions.html's own inline script
//     was, moved to build time: the same INDEX NAMING GAVEL label (the
//     Janitor, 2026-09-09 — full name, the year only where two wings share
//     it, a numbered tiebreak where the year is shared too), the same chip
//     row in the same gaveled order (tier, type, medium, form, play,
//     authorship, language, years), the same search blob, the same
//     mechanically discovered query fields (plus the computed `tenure` and
//     the `roster_policy: undetermined` bucket the registry cannot carry),
//     the same letter field and the same default name order.
//     THE TIER CHIP IS UNTOUCHED here: finding C13's tier wording is the
//     Janitor's own open call (D475), and this hook is a performance fix.
//
//     THE SORT CONTROL (THE FOUNDING-EDGES WAVE, and the Janitor's own
//     2026-08-25 legibility fix and 2026-10-03 worded-date fix) keeps
//     working, and keeps rewriting the years chip in place: each row's sort
//     values and the words those rewrites need ride the index's own
//     sort-extras channel (`x`, hook c203) — sort-only scalars, never
//     fields, never markup.
//     THE LANDING STAMPS STAY A FETCH, and a LAZY one. data/promotion-dates.json
//     is stamped by scripts/stamp-stats.mjs, which runs AFTER
//     `npm run refresh:links` in `npm run refresh` — so a baked copy of it
//     would always be one cycle behind the file itself. The page fetches it
//     (172 KB) only when a visitor actually picks "Recently added" or
//     "Recently updated", which is less than it fetched before, never stale,
//     and the only thing the row's `x.id` is for.
//     NO ROW ID on the card: the page's own renderRow put none there, so the
//     index carries none and every row renders byte for byte as served.
// ---------------------------------------------------------------------------
// THE NODE TWINS of js/list.js's dateSortValue() / promotionTenureYears() —
// sort-only values, never displayed. Tenure is the SUM of run spans where
// runs[] is present (a fed dark for 3 of 6 years didn't last 6), and null —
// never 0 — the moment any span it needs is unpinnable to a real date
// (docs/SCHEMA.md, the Janitor's own directive).
function dateSortValueOf(d) {
  if (!d || typeof d.date !== "string") return null;
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(d.date);
  if (!m) return null;
  return `${m[1]}-${m[2] ?? "01"}-${m[3] ?? "01"}`;
}
function promotionTenureYearsOf(p) {
  const spans = (p.runs && p.runs.length) ? p.runs : (p.founded && p.closed ? [p] : null);
  if (!spans) return null;
  let totalDays = 0;
  for (const s of spans) {
    const f = dateSortValueOf(s.founded), c = dateSortValueOf(s.closed);
    if (!f || !c) return null;
    const fd = new Date(`${f}T00:00:00Z`), cd = new Date(`${c}T00:00:00Z`);
    if (isNaN(fd.getTime()) || isNaN(cd.getTime())) return null;
    totalDays += Math.max(0, (cd - fd) / 86400000);
  }
  return Math.round(totalDays / 365.25);
}
// The page's own chip vocabularies, verbatim (THE DIRECTORY-STRUCTURE PASS,
// THE TYPE-AXIS GAVEL, THE CHROME I18N STEP, THE AXIS GAVELS).
const WING_TYPE_LABELS = { "community-hub": "Community hub", "interfed-alliance": "Interfed alliance", "tournament": "Independent tournament", "academy": "Training academy" };
const WING_MEDIUM_LABELS = { "newsgroup": "Newsgroup", "website": "Website", "forum": "Forum", "bbs": "BBS", "fidonet": "FidoNet", "email": "E-mail", "mail": "Postal mail", "online-service": "Online service", "chat": "Chat", "wiki": "Wiki", "virtual-world": "Virtual world", "video": "Video", "audio": "Audio", "social-media": "Social media", "game": "Video game", "in-person": "In person", "other": "Other medium", "unknown": "Medium unknown" };
const WING_FORM_LABELS = { "text": "Text", "figures": "Figures", "avatars": "Avatars", "tabletop": "Tabletop", "sim": "Sim", "other": "Other form", "unknown": "Form unknown" };
const WING_PLAY_LABELS = { "competitive-rp": "Competitive roleplay", "strat": "Strat", "angled": "Angled", "generated": "Generated", "hybrid": "Hybrid play", "booked": "Booked", "blended": "Blended play", "unknown": "Play unknown" };
const WING_AUTHORSHIP_LABELS = { "open-fed": "Open fed", "single-author": "Single author", "troupe": "Troupe", "vote-league": "Vote league", "unknown": "Authorship unknown" };
const WING_LANGUAGE_LABELS = { "zh": "Chinese", "de": "German", "it": "Italian", "pl": "Polish", "ko": "Korean", "fr": "French", "es": "Spanish", "pt": "Portuguese", "pt-BR": "Portuguese (Brazil)", "ja": "Japanese", "nl": "Dutch", "sv": "Swedish", "da": "Danish", "nb": "Norwegian", "fi": "Finnish", "ru": "Russian", "ar": "Arabic", "tr": "Turkish", "cs": "Czech", "hu": "Hungarian", "el": "Greek", "he": "Hebrew", "hi": "Hindi", "id": "Indonesian", "th": "Thai", "vi": "Vietnamese", "zh-Hans": "Chinese (simplified)", "zh-Hant": "Chinese (traditional)" };
const WING_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function wingPlainYear(q) {
  const d = q.founded && typeof q.founded.date === "string" ? q.founded.date : "";
  const m = /^(\d{4})/.exec(d);
  if (m) return m[1];
  const r = String(q.years ?? "").match(/\d{4}/);
  return r ? r[0] : null;
}
// `||`, not `??`, exactly as the page has it: a wing whose `full_name` is an
// EMPTY STRING is titled by its name (two wings carry one).
function wingFullKey(q) { return String(q.full_name || q.name || "").trim().toLowerCase(); }
// INDEX NAMING GAVEL (the Janitor, 2026-09-09), the page's own label rule.
function wingListLabel(p) {
  let label = String(p.full_name || p.name || "").trim();
  const twins = promotions.filter((q) => wingFullKey(q) === wingFullKey(p));
  if (twins.length > 1) {
    const py = wingPlainYear(p);
    label = `${label} (${py ?? "year unknown"})`;
    const sameYear = twins.filter((q) => wingPlainYear(q) === py)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (sameYear.length > 1) {
      const ti = sameYear.findIndex((q) => q.id === p.id);
      if (ti > 0) label = `${label} (${ti + 1})`;
    }
  }
  return label;
}
function wingEdgeYear(d) {
  if (!d || typeof d.date !== "string") return null;
  const m = /^(\d{4})/.exec(d.date);
  if (!m) return null;
  const approx = d.precision === "circa" || d.precision === "unknown";
  return (approx ? "c." : "") + m[1];
}
function wingYearsLabel(p) {
  let fy = wingEdgeYear(p.founded), cy = wingEdgeYear(p.closed);
  if (!fy && !cy) {
    const runs = String(p.years ?? "").match(/\d{4}/g);
    if (!runs) return "";
    fy = runs[0]; cy = runs[runs.length - 1];
  }
  if (!cy || cy === fy) return fy || "";
  if (!fy) return `–${cy}`;
  return `${fy}–${cy}`;
}
// THE WORDED-DATE FIX (the Janitor, 2026-10-03): every exact date in a chip is
// written in words, so the only dash in a chip is the range.
function wingWordDate(s) {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(String(s ?? ""));
  if (!m) return null;
  if (m[2] && m[3]) return `${Number(m[3])} ${WING_MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  if (m[2]) return `${WING_MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return m[1];
}
function wingEdgeWords(d) {
  if (!d || typeof d.date !== "string") return null;
  const w = wingWordDate(d.date.replace(/^circa\s*/, ""));
  if (!w) return null;
  return (d.precision === "circa" || d.precision === "unknown" || /^circa/.test(d.date) ? "c. " : "") + w;
}
function wingListRow(p) {
  const acro = acronymLabel(p);
  const label = wingListLabel(p);
  const sameAsAcronym = !acro || acro.toLowerCase() === label.toLowerCase();
  const chips = [];
  // NO TIER CHIP ON A LIST ROW (hook c206; the Janitor's D475, 2026-10-09, "both as drafted"): the row
  // carried a bare "Tier 1" chip, which told a visitor nothing -- the Janitor's own note on that line
  // said "the tier needs no explainer on every row" -- and the label it becomes is a sentence, not a
  // chip: "How far we've got: pages collected", on the wing's own placard, linked to the one legend in
  // Rule Seven on the Curation page. `tier:` is still typeable here: the field rides
  // flattenQueryFields into the row's data attributes, never the chip, so no filter is lost.
  if (p.type && p.type !== "federation") chips.push(`<span class="chip chip-type" data-type="${esc(p.type)}">${esc(WING_TYPE_LABELS[p.type] || p.type)}</span>`);
  if (p.medium) chips.push(`<span class="chip chip-medium" data-medium="${esc(p.medium)}">${esc(WING_MEDIUM_LABELS[p.medium] || p.medium)}</span>`);
  if (p.form) chips.push(`<span class="chip chip-form" data-form="${esc(p.form)}">${esc(WING_FORM_LABELS[p.form] || p.form)}</span>`);
  if (p.play) chips.push(`<span class="chip chip-play" data-play="${esc(p.play)}">${esc(WING_PLAY_LABELS[p.play] || p.play)}</span>`);
  if (p.authorship) chips.push(`<span class="chip chip-authorship" data-authorship="${esc(p.authorship)}">${esc(WING_AUTHORSHIP_LABELS[p.authorship] || p.authorship)}</span>`);
  if (p.language && p.language !== "en") chips.push(`<span class="chip chip-language" data-language="${esc(p.language)}">${esc(WING_LANGUAGE_LABELS[p.language] || p.language)}</span>`);
  const yl = wingYearsLabel(p);
  if (yl) chips.push(`<span class="chip chip-years">${esc(yl)}</span>`);
  const subHtml = (sameAsAcronym ? "" : `<span class="acro">${esc(acro)}</span>`) + chips.join("");
  const quirkText = (p.quirks ?? []).map((q) => q.text).join(" ");
  const fields = flattenQueryFields(p);
  const tenure = promotionTenureYearsOf(p);
  if (tenure !== null) fields.tenure = [String(tenure)];
  // ROSTER POLICY (CURATION.md v77(f)): absence is a real answer ("not yet
  // determined — never guessed"), so the unread wings stay askable.
  if (!p.roster_policy) fields.roster_policy = ["undetermined"];
  // the A-Z row's own key, the static /promotions/a-z/ register's key too
  fields.letter = [listLetterKey(p.full_name != null ? p.full_name : p.name)];
  const search = `${label} ${acro} ${p.years ?? ""} ${p.medium ?? ""} ${p.medium_detail ?? ""} ${p.form ?? ""} ${p.play ?? ""} ${p.authorship ?? ""} ${p.scale ?? ""} ${p.location ?? ""} ${p.house_style ?? ""} ${(p.style_family ?? []).join(" ")} ${quirkText}`.toLowerCase();
  // A FIELD NAME NO ONE CAN TYPE. js/query.js's own token syntax
  // (/^(-?)([A-Za-z_][\w-]*):/, field name lower-cased before it matches) can
  // only ever name a field whose name is letters, digits, "_" and "-", lower
  // case; a registry key shaped otherwise has never been reachable from any
  // search box, and it cannot ride as a data-* attribute either (the HTML
  // parser folds an attribute name, so fieldsAttrText refuses one). Today
  // three wings carry such a key ("sources[0].accession" on two,
  // "provenance_notes[23].claim" on one — registry data-entry slips, a desk
  // question of their own and NOT this hook's to fix). They are dropped here
  // rather than stopping the gate; every field a visitor can actually type is
  // carried.
  for (const name of Object.keys(fields)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(name)) delete fields[name];
  }
  const attrs = ` data-search="${esc(search)}"` + fieldsAttrText(fields, "promotions-index.json");
  const title = p.page ? `<a href="${esc(p.page)}">${esc(label)}</a>` : esc(label);
  return {
    key: sortKeyStr(label),
    html: `<div class="roster-card"${attrs}><h2>${title}</h2><div class="handle">${subHtml}</div></div>`,
    // THE SORT KEYS AND THE WORDS THE CHIP REWRITES NEED (hook c203's `x`):
    // nothing here is rendered as it stands and nothing here is queryable.
    x: {
      id: String(p.id ?? ""),
      name_key: sortKeyStr(label),
      founded: dateSortValueOf(p.founded),
      closed: dateSortValueOf(p.closed),
      tenure: tenure,
      years_plain: yl,
      fy: wingEdgeYear(p.founded),
      cy: wingEdgeYear(p.closed),
      f_words: wingEdgeWords(p.founded),
      c_words: wingEdgeWords(p.closed),
    },
  };
}
const promotionsIndex = promotions.map(wingListRow)
  .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
writeIndexV2(resolve(DATA, "promotions-index.json"), "promotions_index",
  promotionsIndex.map((r) => ({ id: "", html: r.html, x: r.x })), { where: "promotions-index.json" });
console.log(`cross-reference: ${promotionsIndex.length} wing rows indexed alphabetically (data/promotions-index.json).`);

// ---------------------------------------------------------------------------
// 3a7. THE SLIM-INDEX WAVE, THIRD HALF (hook c201, adversarial review
//     2026-10-09, finding B01 — the remainder): awards.html joined the
//     pre-baked-index instruments. It used to fetch data/awards.json +
//     data/promotions.json (16.8 MB measured, 15.0 MB of it the promotions
//     registry) to print 503 rows of an award's name, its wing, its year
//     span and a bestowal count.
//
//     ITS OWN INDEX, NOT data/awards-index.json. That file already exists and
//     is NOT this list: it is the BESTOWAL ledger /bestowals.html reads (one
//     row per bestowal, 2,201 of them — THE AWARD/BESTOWAL SPLIT, QA pass
//     2026-08-22). This page is the award DIRECTORY, one row per award
//     entity, so it gets data/awards-list-index.json of its own.
//
//     This builder is the BROWSER TWIN awards.html's own inline script was,
//     moved to build time: same label (awardLabelFor, already the Node twin
//     of the page's awardLabel, which keys the /awards/a-z/ register), same
//     sub-line, same default order (wing, then the award's own name), same
//     query fields, same letter field.
//     THE SORT CONTROL (THE INDEX-FEEDBACK WAVE, 2026-09-08) keeps working:
//     each row's four sort keys ride the index's own sort-extras channel
//     (`x`, hook c203) — sort-only scalars, never fields, never markup — and
//     the page's onReady handler sorts the loaded set with the very same
//     comparators it used to run over the fetched registry.
//     NO ROW ID: the browser's default renderRow put no id on these cards,
//     so the index carries none and every row renders byte for byte.
// ---------------------------------------------------------------------------
function awardListRow(a) {
  const promo = promoById.get(a.promotion);
  const acro = promo ? acronymLabel(promo) : String(a.promotion ?? "").toUpperCase();
  const years = (a.bestowals ?? []).map((b) => b.year).filter(Boolean);
  const yearSpan = years.length
    ? (years.length > 1 ? `${Math.min(...years)}–${Math.max(...years)}` : String(years[0]))
    : "";
  const count = (a.bestowals ?? []).length;
  const sub = [acro, yearSpan, `${count}${count === 1 ? " bestowal" : " bestowals"}`].filter(Boolean).join(" · ");
  const label = awardLabelFor(a);
  const fields = flattenQueryFields(a);
  // the A-Z row filters this list in place through a `letter:` token
  // (js/list.js, THE IN-PLACE LETTER / YEAR FILTER); the page's own wireList
  // `derive` computed this in the browser, off the row's own label.
  fields.letter = [listLetterKey(label)];
  // A FIELD NAME NO ONE CAN TYPE. js/query.js's own token syntax
  // (/^(-?)([A-Za-z_][\w-]*):/, field name lower-cased before it matches) can
  // only ever name a field whose name is letters, digits, "_" and "-", lower
  // case; a registry key shaped otherwise has never been reachable from any
  // search box, and it cannot ride as a data-* attribute either (the HTML
  // parser folds an attribute name, so fieldsAttrText refuses one). Today
  // three wings carry such a key ("sources[0].accession" on two,
  // "provenance_notes[23].claim" on one — registry data-entry slips, a desk
  // question of their own and NOT this hook's to fix). They are dropped here
  // rather than stopping the gate; every field a visitor can actually type is
  // carried.
  for (const name of Object.keys(fields)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(name)) delete fields[name];
  }
  const attrs = ` data-search="${esc(`${a.name} ${acro}`.toLowerCase())}"`
    + fieldsAttrText(fields, "awards-list-index.json");
  const title = a.page ? `<a href="${esc(a.page)}">${esc(label)}</a>` : esc(label);
  const handle = sub ? `<div class="handle">${esc(sub)}</div>` : "";
  return {
    html: `<div class="roster-card"${attrs}><h2>${title}</h2>${handle}</div>`,
    // THE SORT KEYS (hook c203's `x`): the page's own cmpWing / nameCollator /
    // byYear read exactly these, and nothing else reads them at all. `earliest`
    // and `latest` are null — never 0 — where the award has no dated bestowal,
    // so an honestly undated row sorts last in either direction.
    x: {
      id: String(a.id ?? a.page ?? ""),
      wing: sortKeyStr(promo ? stripWingParen(promo.name) : a.promotion),
      prefix: sortKeyStr(acro),
      name: sortKeyStr(a.name),
      bare_name: sortKeyStr(a.name),
      bare_acro: sortKeyStr(acro),
      earliest: years.length ? Math.min(...years) : null,
      latest: years.length ? Math.max(...years) : null,
    },
  };
}
const awardsListIndex = awards.map(awardListRow).sort((p, q) => {
  const a = p.x, b = q.x;
  const k = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  return k(a.wing, b.wing) || k(a.prefix, b.prefix) || k(a.name, b.name) || k(a.id, b.id);
});
writeIndexV2(resolve(DATA, "awards-list-index.json"), "awards_list_index",
  awardsListIndex.map((r) => ({ id: "", html: r.html, x: r.x })), { where: "awards-list-index.json" });
console.log(`cross-reference: ${awardsListIndex.length} award rows indexed wing-first (data/awards-list-index.json).`);

// ---------------------------------------------------------------------------
// 3a6. THE SLIM-INDEX WAVE, THIRD HALF (hook c199, adversarial review
//     2026-10-09, finding B01 — the REMAINDER the review's row 1 names
//     beside shows/rps/halloffame/relationships): championships.html joined
//     the pre-baked-index instruments. It used to fetch data/titles.json +
//     data/promotions.json + data/reigns.json (26.6 MB measured) and build
//     all 2,891 roster cards in the browser before it showed one, just to
//     print a title's name, its wing's acronym and a reign count.
//
//     Nothing about the list needed the registry: each row is a fixed string
//     of markup plus its filter fields, both knowable here. This builder is
//     the BROWSER TWIN championships.html's own inline script was, moved to
//     build time byte for byte — same label (TITLE-DIRECTORY
//     DISAMBIGUATION), same sub-line (the wing as a link, hook c147's own
//     shape, then THE ANNUAL CHAMPIONSHIPS WAVE's "contested annually" and
//     the reign count), same order (the bare title name, the bare acronym
//     breaking a tie), same query fields.
//
//     THE REIGN COUNT is baked: reignsByTitle above is the same count the
//     page computed in the browser (one row per data/reigns.json row whose
//     `title` is this title), so /championships.html no longer downloads the
//     10.6 MB reign ledger to print "3 reigns".
//     THE LETTER FIELD is baked too (the page's own wireList `derive`
//     computed it in the browser): listLetterKey of the title's own NAME,
//     which is what this list sorts by and what the static /titles/a-z/
//     register files it under.
//     NO ROW ID: the browser's own renderRow put no id on these cards, so
//     the index carries none and every row renders byte for byte as it was
//     served (the halls-of-fame index's own rule, hook c174).
// ---------------------------------------------------------------------------
// THE NODE TWIN of js/list.js's titleLabel() — the one standalone-label rule
// a title-directory row follows (the Janitor's gavel 2026-08-18, "so we don't
// just end up with 400 consecutive 'World Championship' entries"): a bare
// acronym prefix, except where the title's own name already opens with it.
function titleListLabel(t) {
  const promo = promoById.get(t.promotion);
  const prefix = bareAcronym(promo) || String(t.promotion ?? "").toUpperCase();
  if (String(t.name ?? "").toUpperCase().startsWith(`${prefix.toUpperCase()} `)) return String(t.name ?? "");
  return `${prefix} ${t.name}`;
}
function titleListRow(t) {
  const promo = promoById.get(t.promotion);
  const acro = promo ? acronymLabel(promo) : String(t.promotion ?? "").toUpperCase();
  // THE ANNUAL CHAMPIONSHIPS WAVE: `cadence` distinguishes a standing belt
  // from an annual honor — same championships list, contested on a different
  // clock. Only the notable case earns a sub-line word.
  const reignCount = (reignsByTitle.get(t.id) ?? []).length;
  const tail = (t.cadence === "annual" ? " · contested annually" : "")
    + (reignCount ? ` · ${reignCount}${reignCount === 1 ? " reign" : " reigns"}` : "");
  // THE PROMOTION LINKS (hook c147): the sub-line's promotion is a link to its wing.
  const subHtml = (promo?.page ? `<a href="${esc(promo.page)}">${esc(acro)}</a>` : esc(acro)) + esc(tail);
  const fields = flattenQueryFields(t);
  fields.letter = [listLetterKey(t.name)];
  // A FIELD NAME NO ONE CAN TYPE. js/query.js's own token syntax
  // (/^(-?)([A-Za-z_][\w-]*):/, field name lower-cased before it matches) can
  // only ever name a field whose name is letters, digits, "_" and "-", lower
  // case; a registry key shaped otherwise has never been reachable from any
  // search box, and it cannot ride as a data-* attribute either (the HTML
  // parser folds an attribute name, so fieldsAttrText refuses one). Today
  // three wings carry such a key ("sources[0].accession" on two,
  // "provenance_notes[23].claim" on one — registry data-entry slips, a desk
  // question of their own and NOT this hook's to fix). They are dropped here
  // rather than stopping the gate; every field a visitor can actually type is
  // carried.
  for (const name of Object.keys(fields)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(name)) delete fields[name];
  }
  const attrs = ` data-search="${esc(`${t.name} ${acro}`.toLowerCase())}"`
    + fieldsAttrText(fields, "titles-index.json");
  const href = `/titles/${t.id}.html`;
  const title = `<a href="${esc(href)}">${esc(titleListLabel(t))}</a>`;
  return {
    bareName: String(t.name ?? ""),
    bareAcro: acro,
    html: `<div class="roster-card"${attrs}><h2>${title}</h2>`
      + (subHtml ? `<div class="handle">${subHtml}</div>` : "") + "</div>",
  };
}
const titlesIndex = titles.map(titleListRow).sort((a, b) => {
  const ka = sortKeyStr(a.bareName), kb = sortKeyStr(b.bareName);
  if (ka < kb) return -1;
  if (ka > kb) return 1;
  const aa = sortKeyStr(a.bareAcro), ab = sortKeyStr(b.bareAcro);
  return aa < ab ? -1 : aa > ab ? 1 : 0;
});
writeIndexV2(resolve(DATA, "titles-index.json"), "titles_index",
  titlesIndex.map((r) => ({ id: "", html: r.html })), { where: "titles-index.json" });
console.log(`cross-reference: ${titlesIndex.length} championship rows indexed alphabetically (data/titles-index.json).`);

// ---------------------------------------------------------------------------
// MOVED HERE BY HOOK c175 (adversarial review 2026-10-09, finding B03). This
// block used to sit ~1,000 lines up, before a single instrument index had been
// built. It is here, after the last of them, because it now COUNTS — and the
// counts ARE the indexes.
//
// WHAT WAS WRONG. /promotions/aapw-version54-2002/ is a wing attested by one
// surviving Usenet post. Its placard offered ten "Browse live" links and every
// one of them landed on "Nothing matches — 32,481 total": ten dead ends on a
// page the museum presents as complete for that wing, under a line promising
// "Live, filtered to this promotion, always current". A link is dropped now
// when its own count is zero, and only then.
//
// A BUILD-TIME COUNT IS NOT A HAND-KEPT LIST. The comment below has said since
// this row was written that counts are never hand-typed here, and that still
// holds — nothing here is typed. Every count is read, in this same process,
// off the rows this run just indexed, from those rows' own data-promo /
// data-promotion fields, under the SAME exact-id rule hook c169 gives the link
// (`promotion:=<id>` matches the stored value and nothing else). So the number
// that decides whether a link is offered is the number the link itself will
// report. The staleness bug that comment exists to kill is a number written
// down once and left to rot; a number recomputed from the registry on every
// build is its opposite — the same discipline patchEventYearRow already uses
// to decide which year links a list page offers, and the A-Z rows use to
// decide which letters are live. `npm run refresh:links` is gate step 2, so
// the whole set recomputes every cycle.
// NO COUNT IS DISPLAYED: the live instrument still reports its own.
// ---------------------------------------------------------------------------

// The exact-id row count per wing, off an index's own rows. Reads the field out
// of the row's markup — the same read patchEventYearRow does for data-year —
// splits it on the pipe the roster-card/archive-list convention uses, and
// compares each value WHOLE and lowercased, which is precisely what
// `promotion:=<id>` does in the browser (js/query.js valueMatches, hook c169).
// A row naming the same wing twice counts once.
function exactIdCounts(rows, attr) {
  const re = new RegExp(` data-${attr}="([^"]*)"`);
  const counts = new Map();
  for (const r of rows) {
    const m = re.exec(r.html);
    if (!m) continue;
    const seen = new Set();
    for (const part of unescAttr(m[1]).split("|")) {
      const v = part.trim().toLowerCase();
      if (!v || seen.has(v)) continue;
      seen.add(v);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  return counts;
}
// The same count for the two instruments that have no index: championships.html
// and awards.html filter data/titles.json and data/awards.json directly, where
// the queryable `promotion` field is js/query.js's flattenFields reading the
// record's own key — one raw id, so one whole-value comparison.
function recordIdCounts(records, key) {
  const counts = new Map();
  for (const rec of records) {
    const v = String(rec[key] ?? "").trim().toLowerCase();
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return counts;
}
// One row per link the placard can offer, in the order it has always printed
// them, each beside the count that decides whether it is offered at all.
const BROWSE_LIVE_LINKS = [
  ["All characters", "/characters.html", exactIdCounts(charactersIndex, "promo")],
  ["All units", "/units.html", exactIdCounts(unitsIndex, "promo")],
  ["All shows", "/shows.html", exactIdCounts(showsIndex, "promo")],
  ["All matches", "/matches.html", exactIdCounts(matchesIndex, "promotion")],
  ["All appearances", "/appearances.html", exactIdCounts(appearancesIndex, "promotion")],
  ["All championships", "/championships.html", recordIdCounts(titles, "promotion")],
  ["All reigns", "/reigns.html", exactIdCounts(reignsIndex, "promotion")],
  ["All roleplays", "/rps.html", exactIdCounts(rpsIndex, "promo")],
  ["All awards", "/awards.html", recordIdCounts(awards, "promotion")],
  ["All bestowals", "/bestowals.html", exactIdCounts(awardsIndex, "promotion")],
];
let browseLinksHidden = 0;
let browseSectionsEmptied = 0;

// THE PROMOTER'S GAVEL: "wings keep DOCUMENTS; every derivable VIEW becomes
// a prefilled-instrument link." Every wing gets a compact "Browse live" row
// linking to the registry-wide instruments, prefilled to this promotion via
// the same `?promo=<id>` convention characters.html already used — patched
// into a `<!-- browse:start/end -->` marker. Counts are never hand-typed
// here (that's exactly the staleness bug this wave exists to kill) — the
// live instrument reports its own count once loaded.
// ---------------------------------------------------------------------------
function renderBrowseLiveSection(promoId) {
  const q = encodeURIComponent(promoId);
  // THE ORPHAN AUDIT (2026-08-22): promotions holding served documents also
  // link their disk-derived holdings register (generated further down) — the
  // fix for served documents whose only inbound links died with the wing
  // tabs. Presence is checked against DISK, same as the generator itself.
  // JOINT-WING SHOWS (v121(c)): a wing whose register carries only a pointer
  // to a night it co-staged but does not itself hold still HAS a register.
  const hasHoldings = ["archive", "rp", "news"].some((sub) => {
    const d = resolve(ROOT, "promotions", promoId, sub);
    return existsSync(d) && readdirSync(d).some((f) => f.endsWith(".html"));
  }) || (jointByPromo.get(promoId) || []).length > 0;
  const holdingsLink = hasHoldings
    ? `<a href="/promotions/${q}/holdings.html">All held documents</a>`
    : "";
  // THE INSTRUMENTS WAVE (2026-08-22, item 6): Reigns/Appearances join the
  // same pre-filtered "Browse live" row every wing already carries — the
  // cheap start on the wing-roster delegation the Janitor flagged (a
  // dedicated roster.html enumeration is the more expensive case, already
  // retired to a redirect stub sitewide; this marker-stamped row is the
  // ordinary case every wing's own index.html carries, and needed no new
  // per-wing work, just the two new instruments added to its own list).
  // THE UNITS SPLIT (REVIEW-FIXES WAVE, 2026-08-22): Units joins the row —
  // the characters instrument no longer lists unit rows.
  // EVERY LINK HAS SOMETHING BEHIND IT (hook c175, finding B03): a link whose
  // own exact-id count is zero is not offered. A wing with nothing in any
  // instrument and no held documents gets no section at all, rather than a
  // "Browse live" heading over ten dead ends.
  const links = BROWSE_LIVE_LINKS
    .filter(([, , counts]) => (counts.get(promoId) ?? 0) > 0)
    .map(([label, path]) => `<a href="${path}?promo=${q}">${label}</a>`);
  browseLinksHidden += BROWSE_LIVE_LINKS.length - links.length;
  if (holdingsLink) links.push(holdingsLink);
  if (!links.length) { browseSectionsEmptied++; return ""; }
  return `<h2>Browse live</h2><p class="muted">` + links.join(" &middot; ") +
    `<br><span class="muted small">Live, filtered to this promotion, always current — not a hand-kept list.</span></p>`;
}

let browsePatched = 0;
for (const p of promotions) {
  if (!p.page) continue;
  const wingIndexPath = resolve(ROOT, p.page.replace(/^\//, ""), "index.html");
  if (!existsSync(wingIndexPath)) continue;
  const current = readFileSync(wingIndexPath, "utf8");
  if (!current.includes("<!-- browse:start -->")) continue;
  const section = renderBrowseLiveSection(p.id);
  // An empty section leaves an empty marker in the shape the wing placard's own
  // connections/affiliations markers already use — never a line of spaces,
  // which the gate's whitespace check would stop.
  const replacement = section
    ? `<!-- browse:start -->\n  ${section}\n  <!-- browse:end -->`
    : "<!-- browse:start -->\n\n  <!-- browse:end -->";
  const patched = current.replace(/<!-- browse:start -->[\s\S]*?<!-- browse:end -->/, replacement);
  if (patched !== current) { writeFileSync(wingIndexPath, patched); browsePatched++; }
}
console.log(`cross-reference: ${browsePatched} wing placard(s) restamped with their Browse live row; ${browseLinksHidden} link(s) with nothing behind them not offered, ${browseSectionsEmptied} wing(s) with nothing in any instrument and no held documents given no section.`);

function renderTenuresSection(e) {
  const tenures = e.tenures ?? [];
  if (!tenures.length) return "";
  // THE BIO MINING WAVE (W5b): "manager" joins the rendered bio facts
  // alongside height/hometown/etc — same tenure-scoped shape, since a
  // carried-over character's manager is exactly the kind of thing one fed's
  // telling states and another's doesn't.
  // NO PLACARD ECHO (entity-page QA sample, 2026-09-05, ranked defect #5:
  // "a character's placard fields are repeated verbatim a second time inside
  // the Tenure-detail disclosure directly below it" — 1,661 character pages
  // carried both a Height placard row and a repeated "Height:" line inside
  // Tenure detail). renderPlacard already renders height, weight, hometown,
  // alignment, style, finisher and entrance music for the whole entity, and
  // where the tenures disagree it renders the per-era breakdown itself
  // (consensusRow's own "differs by era" <details>, verbatimListRow's own
  // per-promotion list) — so nothing is lost by dropping them here, and the
  // reader stops being told the same six facts twice on one screen.
  // `manager` stays: it is the one bio field the placard does NOT carry.
  const BIO_LABEL = { manager: "Manager" };
  const obsSplit = observedSplitFor(e); // hook c227: this page's observed W-L-D, run by run
  const rows = tenures.map((t) => {
    const label = acronymLabel(promoById.get(t.promotion)) || promoName.get(t.promotion) || t.promotion;
    const linkedLabel = promoLinkedLabel(t.promotion);
    const span = [t.first_seen, t.last_seen].filter((x) => x !== null && x !== undefined).join(" – ");
    const bio = Object.keys(BIO_LABEL)
      .filter((k) => t[k])
      .map((k) => `<div class="muted small">${BIO_LABEL[k]}: ${esc(entranceMusicText(t[k]))}</div>`)
      .join("");
    // servedText, not sanitizeMachineryLeak alone (entity-page QA sample,
    // 2026-09-05, ranked defect #1): the citation-layer rewrites upstream
    // cannot reach a sentence whose whole subject is the accession that wrote
    // it — binkie-horowitz's own tenure box opened "CORROBORATED 2026-09-02 by
    // the WeWF enrichment lane (accession 0144) ... which is the tenure line
    // the same day's gavel settled on." Those sentences go; the dated facts
    // around them stay.
    const note = t.note ? (() => { const v = servedText(t.note); return v ? `<div class="muted small">${esc(v)}</div>` : ""; })() : "";
    // servedSourceText (entity-page QA residue sample, 2026-09-05, follow-up
    // to servedText() above): t.source is a citation, not a note, and this
    // line rendered it raw — the entity-page residue's own "this session",
    // rule-code and raw-row-id hits all traced here, plus "wave-SWEEP-05"/
    // "wave-C90-T02" style internal lane-slug mentions the show corpus text
    // never carries. A bare "(accession NNNN)" citation is not a marker under
    // SOURCE_MARKER_RE and survives untouched, same as
    // renderProvenanceSection's own "accession NNNN" link above.
    const sourceText = t.source ? servedSourceText(t.source, t.first_seen || t.last_seen) : "";
    const source = sourceText ? `<div class="muted small">Source: ${sourceText}</div>` : "";
    // THE MATCH-PROSE EXTRACTION WAVE (W6): observed_moves is an INDEX, not
    // a bio claim — moves the show corpus's own prose attributes to this
    // wrestler by name, with a receipt trail. Rendered as its own small
    // list under the tenure it belongs to, distinct from the declared
    // `finisher` bio field above (which came from a fed's own bio page,
    // where one exists at all).
    const moves = (t.observed_moves ?? []).length
      ? `<div class="muted small">Observed moves: <ul>${t.observed_moves.map((m) => {
          const srcLinks = m.sources.map((sid) => {
            const sh = showById.get(sid);
            return sh ? `<a href="${esc(sh.page)}">${esc(sh.name)}</a>` : esc(sid);
          }).join(", ");
          return `<li>${esc(m.move)} <span class="muted small">(&times;${m.count} &mdash; ${srcLinks})</span></li>`;
        }).join("")}</ul></div>`
      : "";
    // THE FLAT-FILE DATABASE WAVE (W8): four more per-tenure registers,
    // mined from the UWF's own recovered CGI roster database rather than
    // any prose page. `biography` (the wrestler's own written backstory,
    // verbatim) gets its own note block, same visual weight as an
    // identity hedge, since it's real prose, not a one-line fact.
    // `declaredMoves` is a list; `recordLine` is a single compact summary.
    // `declared_moves` is deliberately labeled "per the wrestler's own
    // roster page" to keep it visually distinct from `observed_moves`
    // above (W6's index of what the show corpus's own prose actually
    // attributed to them) — the two registers are allowed to disagree,
    // and both stay visible when they do. `catchphrases` used to render
    // here too — THE CHARACTER PAGES FINAL FORM (item 4) folds it into
    // the placard instead (see catchphrasesRow, below renderPlacard),
    // rendered from this same tenure-level data, not its own section.
    // servedBioText (entity-page QA residue follow-up, L141, 2026-09-05):
    // t.bio is fan-authored CGI-roster trivia, not curator prose — this
    // strips only the "(presumed)" grade-tag this workshop's own vocabulary
    // occasionally leaves on a scraped detail, never a sentence or fact.
    const bioText = t.bio ? servedBioText(t.bio) : "";
    const biography = bioText
      ? `<div class="note"><span class="flag">Biography (${esc(label)})</span><p class="bio-text">${esc(bioText)}</p></div>`
      : "";
    const RECORD_LABEL = { single: "Singles", tag: "Tag", cluster: "Cluster", ppv: "PPV", me: "Main Event" };
    function fmtRecordBreakdown(r) {
      return Object.keys(RECORD_LABEL)
        .map((key) => {
          const w = r[`${key}_w`] || 0, l = r[`${key}_l`] || 0, d = r[`${key}_d`] || 0;
          return w || l || d ? `${RECORD_LABEL[key]} ${w}-${l}${d ? `-${d}` : ""}` : null;
        })
        .filter(Boolean)
        .join(" &middot; ");
    }
    // DECLARED register, register 1 of 2 (THE RECORDS WAVE) — the fed's
    // own stated record. `single`/`tag`/`cluster` are the mutually-
    // exclusive match-FORMAT buckets (every match falls in exactly one);
    // `ppv`/`me` are cross-cutting tags on a subset of those same matches
    // (a singles PPV main event counts in single_w AND ppv_w AND me_w at
    // once) — the "Overall" total sums only the three exclusive buckets,
    // never ppv/me on top, which would double-count. `record_declared`
    // (THE RECORDS WAVE, new): a plain {w,l,d,source} for a declared
    // figure recovered OUTSIDE the flat-file breakdown shape (a roster
    // page's own bare "W: 1 / L: 0 / D: 0" line, say) — the two never
    // coexist on the same tenure; whichever is present renders.
    function fmtOverall(r) {
      const w = (r.single_w || 0) + (r.tag_w || 0) + (r.cluster_w || 0);
      const l = (r.single_l || 0) + (r.tag_l || 0) + (r.cluster_l || 0);
      const d = (r.single_d || 0) + (r.tag_d || 0) + (r.cluster_d || 0);
      return w || l || d ? `${w}-${l}${d ? `-${d}` : ""}` : null;
    }
    const declaredLabel = promoLinkedLabel(t.promotion);
    let recordLine = "";
    if (t.record) {
      const overall = fmtOverall(t.record);
      const breakdown = fmtRecordBreakdown(t.record);
      if (overall || breakdown) {
        recordLine = `<div class="muted small">Record (fed's own)${overall ? `: ${overall}` : ""} <span class="muted small">(${declaredLabel})</span>${breakdown ? ` &mdash; ${breakdown}` : ""}</div>`;
      }
    } else if (t.record_declared) {
      const rd = t.record_declared;
      const total = `${rd.w || 0}-${rd.l || 0}${rd.d ? `-${rd.d}` : ""}`;
      const rdSourceText = rd.source ? servedSourceText(rd.source, t.first_seen || t.last_seen) : "";
      recordLine = `<div class="muted small">Record (fed's own): ${total} <span class="muted small">(${declaredLabel})</span>${rdSourceText ? ` <span class="muted small">&mdash; ${rdSourceText}</span>` : ""}</div>`;
    }
    // OBSERVED register, register 2 of 2 — museum-computed from the show
    // corpus's own parsed matches[], per promotion. Never rendered as if
    // it were the fed's own claim, and never blended into the line above:
    // separate sentence, honestly labeled with its own parse count so a
    // reader can see exactly how much of the corpus it's actually built
    // from, not asserted as complete.
    // hook c227 (THE W-L-D RECORDS): this RUN's observed W-L-D from observedSplitFor, not the fed's whole number. In a
    // fed with two or more runs each line says it was placed by show date, and the fed's first run card also carries the
    // matches no run's dates settle, as the fed's, "not placed in a run". Rendered in the visible card (below), not in
    // the collapsed Tenure detail, which keeps the fed's own declared record.
    const tIdx = tenures.indexOf(t);
    const observed = obsSplit.per[tIdx];
    const sameFedRuns = obsSplit.multi.has(t.promotion);
    const unplacedRec = sameFedRuns && obsSplit.firstOf.get(t.promotion) === tIdx ? (obsSplit.unplaced.get(t.promotion) ?? null) : null;
    const observedLine = (observed
      ? `<div class="muted small">Observed by the museum, W-L-D (from ${obsMatchesWord(obsTotal(observed))}, ${declaredLabel}${sameFedRuns ? ", this run, placed by show date" : ""}): ${obsText(observed)}</div>`
      : "") + (unplacedRec
      ? `<div class="muted small">Observed by the museum, W-L-D (from ${obsMatchesWord(obsTotal(unplacedRec))}, ${declaredLabel}, not placed in a run: the show or the runs are undated, or more than one run's dates hold it): ${obsText(unplacedRec)}</div>`
      : "");
    const declaredMoves = (t.declared_moves ?? []).length
      ? `<div class="muted small">Declared moves, per the wrestler's own roster page: <ul>${t.declared_moves.map((m) => `<li>${esc(m.move)}${m.desc ? ` <span class="muted small">&mdash; ${esc(m.desc)}</span>` : ""}</li>`).join("")}</ul></div>`
      : "";
    // A8 (THE WRESTLER-PAGE TEMPLATE WAVE, the Janitor: "that's going to look
    // awful for a character that ends up in 20 promotions") — every
    // per-tenure KAYFABE detail (bio facts, catchphrases, records, moves,
    // and the full biography text) collapses behind one <details> per
    // tenure, always, not just past some length threshold: the promo
    // link + span + role stays visible at a glance (so a 20-tenure
    // character's own page still reads as a clean list of promotions),
    // the deep-dive facts are one click away on whichever tenure a reader
    // actually wants.
    const detail = `${bio}${note}${source}${moves}${recordLine}${declaredMoves}${biography}`;
    const detailBlock = detail ? `<details><summary>Tenure detail</summary>${detail}</details>` : "";
    // THE ROSTER-CARD RESTYLE (REVIEW-FIXES WAVE, 2026-08-22, the Janitor:
    // "use a format more like the Characters listing on the memorium
    // pages... Maybe something similar for tenures as well") — each tenure
    // is its own .roster-card, the memorial character-block shape: linked
    // promotion as the card heading, span/role as the card body, the
    // per-tenure <details> deep-dive unchanged inside it.
    return `<div class="roster-card"><h3>${linkedLabel}</h3>${span ? `<div class="muted small">${esc(span)}</div>` : ""}${t.role ? `<div class="muted small">${esc(t.role)}</div>` : ""}${observedLine}${detailBlock}</div>`;
  });
  return `<h2>Tenures</h2>${rows.join("\n")}`;
}

// THE CHARACTER PAGES FINAL FORM (2026-08-22, item 4): a CHARACTER's own
// membership in a unit used to get its own "Units" section here — it now
// folds into renderRelationshipsSection instead, as a relationship-styled
// row alongside feud/ally/manager-of edges, per the Janitor's own "unified
// Relationships" directive. This function now handles the UNIT's own side
// only: a unit's own roster of members is core defining content for the
// unit (not an enumeration of some OTHER entity's holdings), and stays.
// EVERY members[] SHAPE THE REGISTRY USES (entity-page QA sample, 2026-09-05).
// The old one-liner read exactly one of the five shapes on file and rendered
// an EMPTY <li> for three of the others — aka-bwa's own Members list is two
// blank bullets today, because its members[] is a pair of bare id strings and
// `m.character_id` is undefined on a string. Across data/units.json: 2,153
// entries are {character_id, name}, 182 are {name}, 159 are bare id strings,
// 59 are {id} or {id, name}, 43 carry extra keys (eras, note, unit_id) — and
// 95 units render at least one empty bullet as a result. Every id on file
// resolves, so this reads the id first (through the alias map, like every
// other id-following render in this file), falls back to the billed name, and
// renders nothing at all for an entry that carries neither.
function memberEntryHtml(m) {
  if (m == null) return null;
  const id = typeof m === "string" ? m : (m.character_id ?? m.id ?? null);
  const canonical = id ? resolveAlias(id) : null;
  if (canonical && byId.has(canonical)) return entityLink(canonical);
  const name = typeof m === "string" ? null : (m.name ?? null);
  if (name) return esc(name);
  return id ? esc(id) : null;
}
function renderUnitsSection(e) {
  if (e.type !== "unit") return "";
  if (!e.members?.length) return "";
  // The unlinked wing-name line that used to sit between the heading and the
  // list is gone (QA ranked defect #6, 1,079 of 1,487 unit pages): it repeated,
  // as plain text, the same label the tenure card one line above already
  // carries as a working link, and added nothing a visitor had not just read.
  const items = e.members.map(memberEntryHtml).filter(Boolean).map((h) => `<li>${h}</li>`);
  if (!items.length) return "";
  return `<h2>Members</h2><ul>${items.join("")}</ul>`;
}

// THE MACHINERY-LEAK SANITIZER (qa-visitor-walk-2026-08-29.md L2/L3/L4,
// lane QA-FIXES, 2026-08-29). The digest's single highest-reach finding:
// identity[].note (and the same museum-voice prose on reign notes/conflict
// hedges and title epitaphs/notes) was drafted as an internal accession
// changelog and then served verbatim — doctrine names, version numbers
// ("CURATION.md v96"), internal tool names ("the aka-collision mint
// guard"), internal file paths (data/review-queue.json), and accession-
// process language ("this lane", "the coordinator desk", "THE IDENTITY
// WAVE") all printed straight onto a public character/title page.
//
// Fix applied at the RENDERER, not by rewriting the underlying data notes
// (the digest's own preferred fix: "prefer fixing the renderer/template...
// over rewriting thousands of data notes") — every one of the ~1,270
// identity notes, ~810 reign notes, and title epitaphs/notes in the
// registry keeps its full internal citation in data/*.json (still useful
// to a human curator re-reading the registry later); this function strips
// exactly that citation layer at render time, preserving the plain factual
// disambiguation reasoning around it. Verified against the full corpus
// (every identity note, reign note, reign conflict note, title note and
// title epitaph) with zero remaining doctrine/tool-name/file-path/version
// citations and zero introduced grammar defects (including a check that a
// genuine "..." ellipsis inside quoted dialogue is never touched).
function sanitizeMachineryLeak(raw) {
  if (!raw) return raw;
  let s = raw;

  s = s.replace(/\s*\((?:the )?aka-collision mint guard\)/gi, "");
  s = s.replace(/\bFlagged by the (?:standing |aka-collision )?mint guard as a? ?/g, "This is a ");
  s = s.replace(/\bflagged by the (?:standing |aka-collision )?mint guard\b/gi, "flagged");
  s = s.replace(/\bThe (?:aka-collision |standing |registry'?s own )?mint guard'?s decorated(?:-aka)? check flags /gi, "This flags ");
  s = s.replace(/\bThe (?:aka-collision |standing )?mint guard flags /gi, "This flags ");
  s = s.replace(/\bThe (?:registry'?s own )?decorated-aka guard reads /gi, "This flags ");
  s = s.replace(/\bThe registry'?s own aka-collision guard reads this name as a /gi, "This name is a ");
  s = s.replace(/,("\s*)surfaced by the standing mint guard(?: and near-name sweep)?\b/gi, "$1");
  s = s.replace(/,?\s*surfaced by the standing mint guard(?: and near-name sweep)?\b/gi, "");
  s = s.replace(/\bRecorded so the mint guard'?s own decorated(?:-aka)? check does not resurface it\.?/gi,
                 "Recorded so this does not resurface as an open question.");
  s = s.replace(/^\x46OUNDER VERDICT,\s*THE IDENTITY WAVE\s*\([\d-]+\):\s*/i, "");
  s = s.replace(/\bTHE IDENTITY WAVE\b/g, "the accession");
  s = s.replace(/\bthe Identity Wave\b/gi, "the accession");
  s = s.replace(/\bPer CURATION\.md'?s per-promotion portrayal doctrine \(v\d+\)(?:\s*and the canonical-portrayal clause \(v\d+\))?,?\s*/gi,
                 "Per the museum's own portrayal rule, ");
  s = s.replace(/\(CURATION\.md'?s ([a-z][a-z-]*?) rule\)/gi, "(the standing $1 rule)");
  s = s.replace(/\bthe coordinator has not yet ruled on\b/gi, "has not yet been ruled on");
  s = s.replace(/\bflagged to the desk\b/gi, "flagged for review");
  s = s.replace(/\bthe QA registry audit of [\d-]+'?s finding\b/gi, "a registry-audit finding");
  s = s.replace(/\bthe QA registry audit of [\d-]+\b/gi, "a registry audit");
  s = s.replace(/\bper CURATION\.md'?s own merge-doctrine addition\b/gi, "under an added merge rule");
  s = s.replace(/\bthis collision is the doctrine working as designed\b/gi, "this collision is the rule working as designed");
  s = s.replace(/^COLLISION:\s*/i, "");
  s = s.replace(/^MERGED \(the (?:Janitor|\x66ounder|coordinator)'?s ruling,\s*[\d-]+(?::\s*"[^"]*")?\):\s*/i, "Merged: ");
  s = s.replace(/\bMERGED with\b/g, "Merged with");
  s = s.replace(/\bMERGED\.\s*/g, "");
  s = s.replace(/^THE [A-Z][A-Z -]+ DOCTRINE \(v\d+\):\s*/g, "");
  s = s.replace(/^THE [A-Z][A-Z -]+ \(v\d+\):\s*/g, "");
  s = s.replace(/^User gavel,\s*[\d-]+:\s*/i, "");
  s = s.replace(/^\x46ounder'?s gavel,\s*[\d-]+:\s*/i, "");
  s = s.replace(/,?\s*which CURATION\.md v\d+[a-z]? treats as distinct characters by design/gi,
                 ", which the museum treats as distinct characters by design");
  s = s.replace(/\bper CURATION\.md v\d+[a-z]?,?\s*/gi, "");
  s = s.replace(/\bCURATION\.md'?s own v\d+[a-z]?\b/gi, "the museum's own rule");
  s = s.replace(/\bCURATION\.md v\d+[a-z]?\b/gi, "the museum's own rule");
  s = s.replace(/\bCURATION\.md\b/gi, "the museum's own rule");
  s = s.replace(/\bthe collision doctrine'?s own four-signal test\b/gi, "a four-signal test");
  s = s.replace(/\bthe collision doctrine'?s (?:own )?four signals\b/gi, "those four signals");
  s = s.replace(/\bthree of the collision doctrine'?s (?:own )?four signals\b/gi, "three of those four signals");
  s = s.replace(/\bunder the collision doctrine'?s own four-signal test\b/gi, "under a four-signal test");
  s = s.replace(/\bthe collision doctrine'?s default is a new row\b/gi, "the default is a new row absent evidence");
  s = s.replace(/\bunder the collision doctrine\b/gi, "");
  s = s.replace(/,?\s*per the collision doctrine\b/gi, "");
  s = s.replace(/\bthe collision doctrine\b/gi, "the standing no-merge default");
  s = s.replace(/,?\s*per the no-auto-merge doctrine\b/gi, "");
  s = s.replace(/\bunder the no-auto-merge doctrine\b/gi, "under the standing no-merge default");
  s = s.replace(/\bthe no-auto-merge doctrine\b/gi, "the standing no-merge default");
  s = s.replace(/\bper the no-auto-merge-and-no-silent-distinctness rule and the (?:standing no-merge default|collision doctrine)'?s when-in-doubt-we-do-not-merge default\b/gi,
                 "by the standing when-in-doubt default");
  s = s.replace(/\bper the no-auto-merge-and-no-silent-distinctness rule\b/gi, "by the standing no-merge default");
  s = s.replace(/,?\s*per the portrayals-never-merge-on-name-alone rule\b/gi, "");
  s = s.replace(/,?\s*under the Janitor'?s (?:standing )?(?:merge-)?delegation doctrine\b/gi, "");
  // The recurring "originally an identity[] edge... collapsed into a true
  // merge" boilerplate (identical wording confirmed on brandon-youngblood,
  // chris-storm-uwf, tessa-windsor): two chained Janitor-ruling citations,
  // each with its own dated parenthetical quote. Keep both dates and both
  // quotes -- they're the actual verbatim ruling, real museum voice, the
  // same precedent as CURATION.md's own changelog quoting the Janitor --
  // drop only "the Janitor's ruling"/"the Janitor's clarification" as the
  // internal-role subject.
  s = s.replace(/\bper the Janitor'?s ruling \((\d{4}-\d{2}-\d{2}),/g, "($1,");
  s = s.replace(/\bper the Janitor'?s clarification \((\d{4}-\d{2}-\d{2}):/g, "($1:");
  s = s.replace(/\bon the PTCpedia identity-edge pass'?s proposal:/gi, "on this proposal:");
  s = s.replace(/\ban identity\[\] edge\b/gi, "an identity note");
  // Any other bare "identity[]" bracket-array field-name citation. NOTE: no
  // trailing \b -- "]" is non-word and is very often followed by another
  // non-word character (a space, a quote, a close-paren), so \b right after
  // it never matches and silently no-ops the whole rule (caught live: this
  // exact bug left "identity[]" standing on four pages after the rule
  // "fired" with no effect).
  s = s.replace(/\bidentity\[\]/g, "identity note");
  s = s.replace(/\bCOLLISION-GUARDED\b/gi, "Checked");
  s = s.replace(/\bGUARDS:\s*/g, "");
  s = s.replace(/\bon the coordinator'?s ruling the same day\b/gi, "the same day");
  s = s.replace(/\bRuled at the coordinator desk under the merge-delegation doctrine,[^.]*\./gi,
                 "Ruled distinct on the evidence recorded above.");
  s = s.replace(/,?\s*which puts receipted evidence past the bar with the coordinator and sends genuine ambiguity to the Janitor instead\.?/gi, "");
  s = s.replace(/\s*Guard added at the coordinator'?s merge \([\d-]+\)[^.]*\./gi, "");
  s = s.replace(/\s*Cross-wave parallel mint reconciled at the coordinator desk,\s*[\d-]+\.?/gi, "");
  s = s.replace(/\bFiled to the review queue\.?/gi, "Recorded as pending, not resolved.");
  s = s.replace(/\band referred to the review queue\.?/gi, ".");
  s = s.replace(/\bheld open in the review queue rather than merged on the name alone\.?/gi,
                 "held open rather than merged on the name alone.");
  s = s.replace(/\bFiled for a review-queue entry in this accession'?s own digest\.?/gi,
                 "Recorded as pending, not resolved.");
  s = s.replace(/,?\s*and the (?:question|pair) is (?:open|filed) (?:in|for) data\/review-queue\.json\.?/gi, "");
  s = s.replace(/\bthe question is open in data\/review-queue\.json\b/gi, "the question is recorded as open");
  s = s.replace(/\bin data\/review-queue\.json\b/gi, "in the open-questions record");
  s = s.replace(/\bthe pair is filed for a \x66ounder verdict\.?/gi, "the pair awaits a ruling.");
  s = s.replace(/\bFiled to data\/review-queue\.json\b/gi, "Recorded as pending");
  s = s.replace(/\bper review-queue\.json'?s own\b/gi, "per the open-questions record's own");
  s = s.replace(/\bdata\/review-queue\.json\b/gi, "the open-questions record");
  s = s.replace(/\breview-queue\.json\b/gi, "the open-questions record");
  s = s.replace(/\bdata\/aliases\.json\b/gi, "the registry's own alias record");
  s = s.replace(/\bin this accession'?s own digest\b/gi, "in the accession record");
  s = s.replace(/\b(?:on|at) the Janitor'?s gavel,\s*([\d-]+)(?:\s*\(\s*"[^"]*"\s*\))?(?::\s*"[^"]*")?:?\s*/gi, "($1) ");
  s = s.replace(/\bthe Janitor'?s protocol,\s*([\d-]+)\b/gi, "a name-collision check ($1)");
  s = s.replace(/\bat the Janitor'?s direction\b/gi, "");
  s = s.replace(/,?\s*in the Janitor'?s own framing,\s*/gi, ", ");
  s = s.replace(/\bflagging for the coordinator:\s*/gi, "flagged: ");
  s = s.replace(/\bCOLLISION RISK,\s*/gi, "");
  s = s.replace(/\bthis (?:pass|session|wave)'?s own shard scope\b/gi, "the scope of what this pass read");
  s = s.replace(/\bCURATION v(\d+[a-z]?)\b/g, "the museum's own rule");
  s = s.replace(/\bon the coordinator'?s ruling,\s*([\d-]+)\b/gi, "($1)");
  s = s.replace(/\bthe identity call rides the Janitor'?s delegation doctrine rather than a document literally stating the identity\b/gi,
                 "the identity call rests on the pattern of evidence rather than a document literally stating the identity");
  s = s.replace(/\bby the (?:registry'?s own )?decorated-aka guard\b/gi, "by name-normalization");
  s = s.replace(/\bthe mint guard'?s own normalization\b/gi, "the name-matching normalization");
  s = s.replace(/\bThe (?:registry'?s own )?decorated-aka guard flags /gi, "This flags ");
  s = s.replace(/,?\s*filed at the coordinator'?s \w+ merge \([\d-]+\) when[^.]*\./gi,
                 " filed separately when two accession passes minted it independently.");
  s = s.replace(/^MINTED,\s*/i, "");
  s = s.replace(/\bREOPENABLE\s*—\s*in the (?:open-questions record|review queue) for a proper read\.?/gi,
                 "Reopenable pending a fuller read.");
  s = s.replace(/—\s*in the review queue for a proper read\.?/gi, "— pending a fuller read.");
  s = s.replace(/\bin the review queue for a proper read\.?/gi, "pending a fuller read.");
  s = s.replace(/\bREOPENABLE\b/g, "Reopenable");
  // L174 (titles-units-figures QA, 2026-09-06, class 1): the old rule
  // matched only the bare word `reigns.json`, leaving a preceding
  // "data/" (or "data/shards/<slug>/") prefix glued onto the
  // replacement text -- "...structured into data/the registry's own
  // reign record" on 5+ CWF-Pro title rows (data/titles.json, confirmed
  // live). Consumes an optional "data/" or "data/shards/<slug>/" prefix
  // first so nothing is left glued on.
  s = s.replace(/\b(?:data\/(?:shards\/[a-z0-9_-]+\/)?)?reigns\.json\b/gi, "the registry's own reign record");
  s = s.replace(/\bflagged prominently for a \x66ounder verdict\.?/gi, "flagged prominently for a ruling.");
  s = s.replace(/^OPEN QUESTION,\s*/i, "");
  s = s.replace(/\bCROSS-ERA MINT,\s*/gi, "");
  s = s.replace(/^IDENTITY \(the \w+ accession,\s*lot \d+,\s*applied [\d-]+\):\s*/i, "");
  s = s.replace(/\b\x66ounder'?s?(?: own)? gavel\b/gi, "\x66ounder's own ruling");
  s = s.replace(/\bis coordinator-ruled, not desk-escalated\b/gi, "was ruled directly rather than escalated");
  s = s.replace(/\bcoordinator-ruled\b/gi, "ruled directly");
  s = s.replace(/\bCharles Janitor'?s gavel\b/gi, "\x66ounder's own ruling");
  s = s.replace(/,\s*[A-Za-z0-9-]+ lane [IVXLCDM]+,/g, ",");
  s = s.replace(/\bflagged for the pre-2000 lane\.?/gi, "flagged for a pre-2000 cross-check.");
  s = s.replace(/\bminted by a parallel lane the same day\b/gi, "minted independently the same day");
  s = s.replace(/\bThe (\w+) lane had filed distinct pending this verdict\.?/gi, "");
  s = s.replace(/\bheld distinct with guard pending evidence\.?/gi, "held distinct pending evidence.");
  s = s.replace(/,?\s*surfaced by the standing near-name sweep\b/gi, "");
  s = s.replace(/\bChecked against the registry'?s own near-name sweep\b/gi,
                 "Checked against the registry's own held names");
  s = s.replace(/\bthe standing near-name sweep\b/gi, "a name-similarity check");
  s = s.replace(/\bfrom the standing sweep\b/gi, "from a name-similarity check");
  s = s.replace(/\bin another promotion'?s shard\b/gi, "in another promotion's own registry file");
  s = s.replace(/\bthe regen auto-linked\b/gi, "an automated cross-link pass connected");
  s = s.replace(/\baccessioned in the same wave as this batch\b/gi, "accessioned in the same batch");
  s = s.replace(/\bin the same wave\b/gi, "in the same accession batch");
  s = s.replace(/\bwhose own v\d+ note\b/gi, "whose own earlier note");
  s = s.replace(/\bits own v\d+ note\b/gi, "its own earlier note");
  s = s.replace(/\bwould fail the gate here\b/gi, "would not yet be a safe reference");
  s = s.replace(/\bfail the gate\b/gi, "break validation");
  s = s.replace(/\s*\(No `with` array:[^)]*\)/g, "");
  s = s.replace(/\bclosed via data\/review-queue\.json'?s own resolved entry\b/gi, "closed on the evidence below");
  s = s.replace(/\bFiled for a review-queue entry\.?/gi, "Recorded as pending.");
  s = s.replace(/\breview-queue entry\b/gi, "open-questions record");
  s = s.replace(/\bqueue entry\b/gi, "record");
  s = s.replace(/\bminted by the ([\w-]+) lane\b/gi, (m, p1) => `minted independently by the ${p1} pass`);
  s = s.replace(/\bthis (\w[\w-]*) lane\b/gi, (m, p1) => `this ${p1} record`);
  s = s.replace(/\bthe (\w[\w-]*) lane\b/gi, (m, p1) => `the ${p1} review`);
  s = s.replace(/\bthe v\d+ ([a-z][a-z -]*?) doctrine established\b/gi, "the same rule established");
  s = s.replace(/\bprecedent v\d+'?s own\b/gi, "an earlier precedent's");
  s = s.replace(/\(the museum'?s own rule §\d+\)/gi, "");
  s = s.replace(/\(the museum'?s own rule'?s ([a-z][a-z-]*) doctrine\)/gi, "(a $1 pattern)");
  s = s.replace(/\bthe ([a-z][a-z -]*?) doctrine\b/gi, (m, p1) => `the standing ${p1} rule`);
  s = s.replace(/\bthe doctrine\b/gi, "the rule");
  s = s.replace(/\ba doctrine\b/gi, "a rule");
  // Absolute last-resort mop-up: any remaining bare "doctrine" the specific
  // rules above didn't match (e.g. "the schema's own X doctrine" -- an
  // apostrophe-s breaks the "the <words> doctrine" pattern those rules
  // require; a quoted phrase immediately before "doctrine" does too).
  s = s.replace(/\bdoctrine\b/gi, "rule");
  s = s.replace(/\btrips the decorated-aka guard\b/gi, "coincides in name");
  s = s.replace(/\bthe QA-registry-audit'?s (?:own )?decorated-aka sweep,?\s*(\d{4}-\d{2}-\d{2})\.?/gi, "a name-similarity check ($1).");

  // Reign/title-note specific patterns
  s = s.replace(/\b(RESOLVED FURTHER|RESOLVED|MINTED|LOST)\s*\([^)]*\)[.:—-]?\s*/g, (m, verb) => `${verb[0]}${verb.slice(1).toLowerCase()}: `);
  s = s.replace(/\bOMEGA CHECK\s*\([^)]*\):\s*/gi, "");
  s = s.replace(/\bGAP STILL FLAGGED, NOT RESOLVED:\s*/gi, "Still an open gap: ");
  s = s.replace(/\bGAP STILL OPEN,\s*/gi, "Still open: ");
  s = s.replace(/\bGAP FLAGGED:\s*/gi, "Open gap: ");
  s = s.replace(/\bHONEST GAP:\s*/g, "");
  s = s.replace(/\bHONEST GAP\b/g, "An honest gap");
  s = s.replace(/\bSOURCES DISAGREE\s*\(the [^)]*\):\s*/gi, "Sources disagree: ");
  s = s.replace(/\bSOURCES DISAGREE\s*\(a sources-disagree pattern\):\s*/gi, "Sources disagree: ");
  s = s.replace(/\bSOURCES DISAGREE\b/g, "Sources disagree");
  s = s.replace(/\bSOURCES ORDER UNRESOLVED:\s*/gi, "");
  s = s.replace(/\bCAUTION flagged for a future audit:\s*/gi, "");
  s = s.replace(/,?\s*\(a sources-disagree pattern\)/gi, "");
  s = s.replace(/\bdata\/shards\/[\w/-]+\.json\b/gi, "the registry's own record");
  s = s.replace(/\bdata\/[\w/-]+\.json\b/gi, "the registry's own record");
  s = s.replace(/\s*\([A-Z]{2,}-[A-Z0-9]{2,}-[A-Z0-9]{2,}\)/g, "");
  s = s.replace(/\bpredecessor lane\b/gi, "earlier pass");
  s = s.replace(/\bout-of-lane\b/gi, "not yet cross-checked");
  s = s.replace(/\bFlagged for the coordinator:\s*/gi, "");
  s = s.replace(/\bfor a review-queue filing request\.?/gi, "for a closer future read.");
  s = s.replace(/\bthe review-queue'?s own prior flag\b/gi, "an earlier open-questions flag");
  s = s.replace(/\btitles\.json\b/gi, "the title's own record");
  const ROW_ID = "(?:r|ext)\\d{2,3}[a-z]?";
  s = s.replace(new RegExp(`\\s*\\((${ROW_ID})\\)`, "g"), "");
  s = s.replace(new RegExp(`\\bsee ([\\w-]+-${ROW_ID})'?s own note\\b`, "gi"), "see the reign that precedes/follows this one");
  s = s.replace(new RegExp(`\\((${ROW_ID})'?s own note:\\s*`, "gi"), "(the title's own earlier note: ");
  s = s.replace(new RegExp(`\\(([\\w-]+-${ROW_ID}),\\s*above\\)`, "gi"), "");
  s = s.replace(new RegExp(`\\(([\\w-]+-${ROW_ID})\\)`, "g"), "");
  s = s.replace(new RegExp(`\\bsame pattern as ${ROW_ID}\\/${ROW_ID}\\b`, "gi"), "the same pattern as elsewhere on this belt");
  s = s.replace(new RegExp(`\\bsee ${ROW_ID}'?s own note\\b`, "gi"), "see the earlier note");
  s = s.replace(new RegExp(`,?\\s*same pattern as ${ROW_ID}\\/${ROW_ID}\\b`, "gi"), "");
  s = s.replace(/\bthis lane'?s own\b/gi, "this pass's own");
  s = s.replace(/\bthis lane\b/gi, "this pass");
  s = s.replace(/\bout of this lane'?s (?:own )?slice\b/gi, "not yet re-read this pass");
  s = s.replace(/\ba future pass that can read\b/gi, "a future read of");
  s = s.replace(/\bsame-shard,\s*/gi, "");
  s = s.replace(/\bthis shard\b/gi, "this promotion's own record");
  s = s.replace(/\bthe coordinator handoff\b/gi, "a future pass");
  s = s.replace(/\bthis (?:pass|wave)('s own)?\b/gi, (m, poss) => (poss ? "this pass's own" : "this pass"));
  s = s.replace(/\bthis session'?s own\b/gi, "this pass's own");
  s = s.replace(/\bthe ledger-derived pass\b/gi, "an earlier pass");
  s = s.replace(/\bthis session\b/gi, "this pass");
  s = s.replace(/\bthe museum'?s own rule'?s sources-disagree doctrine\b/gi, "the standing sources-disagree rule");

  // Bare "aka-collision" as a standalone descriptive noun (not part of "aka-
  // collision mint guard," already handled above) -- confirmed live on
  // fox-wwa.html: "A bare \"Fox\" aka-collision with CCW commentator...".
  s = s.replace(/\baka-collision\b/gi, "name-collision");

  // "at/on the Janitor's [own] <codename ruling/verdict> (DATE):" -- more
  // Janitor-citation shapes than the gavel-specific rule above catches,
  // confirmed live (aaron-douglas.html: "at the Janitor's own
  // PRODIGY-diaspora set verdict (2026-08-26)"; apocalypse-faw.html: "at
  // the Janitor's merge ruling (2026-08-23)"). Keeps the date, drops the
  // role citation and any internal codename before it.
  s = s.replace(/\b(?:at|on) the Janitor'?s (?:own )?[A-Za-z][A-Za-z'-]*(?: [A-Za-z][A-Za-z'-]*){0,4} \((\d{4}-\d{2}-\d{2})\):?\s*/g, "($1) ");

  s = s.replace(/[ \t]{2,}/g, " ");
  s = s.replace(/\s+([.,;:])/g, "$1");
  s = s.replace(/\(\s*\)/g, "");
  s = s.replace(/,\s*,/g, ",");
  s = s.replace(/(?<!\.)\.\s*\.(?!\.)/g, ".");
  s = s.replace(/^\s+/, "").replace(/\s+$/, "");

  return s;
}

// THE SERVED-TEXT STAGE (entity-page QA sample, 2026-09-05, ranked defect #1:
// "literal internal-process language ... narrated directly into a
// visitor-facing tenure box"). sanitizeMachineryLeak above rewrites the
// CITATION layer phrase by phrase; it cannot reach a sentence whose whole
// subject is the accession that wrote it ("CORROBORATED 2026-09-02 by the WeWF
// enrichment lane (accession 0144), which served thirty-eight of that wing's
// own held documents"). Two more passes finish the job, and both run only on
// the way to an ENTITY page (characters/, titles/) — the registry keeps every
// note whole, as it always has.
//
// Pass A, reignEndWords: a reign's `end_how` vocabulary is a set of enum
// TOKENS, and the tokens leak into served free text both as a bare value
// (gewa-tag-team-r01's own `how` is literally "still-champion-at-record-end")
// and inside prose. Wherever one is rendered it renders as words. Runs BEFORE
// pass B on purpose: an enum VALUE standing in for content becomes English,
// while a sentence that names the FIELD (`end_how`) is process narration and
// is dropped by pass B whatever its value says.
//
// Pass B, stripProcessSentences: drop a parenthetical that carries a process
// marker, then drop any whole sentence that still carries one. Sentence-level,
// not phrase-level, because the sentences this catches are process narration
// end to end; the surrounding sentences of the same note are ordinary facts
// and survive untouched. THE WING-PAGE CLEANUP (the Janitor, 2026-09-05, on
// the ASWF wing: "the museum narrating its own machinery which we don't do")
// is this same rule one layer up, on provenance_notes.
function reignEndWords(s) {
  if (!s) return s;
  return s.replace(REIGN_END_TOKEN_RE, (m) => REIGN_END_LABEL[m] ?? m);
}

// Every marker below is a term of this workshop's own art, never a fed's.
// Two of them are deliberately CASE-SENSITIVE and lowercase-only: "lane" and
// "wave" are also perfectly ordinary in kayfabe prose as proper nouns (nine
// held characters are named Lane — Stan Lane, Lamar Lane, Lane Cash — and the
// corpus stages a Heat Wave, a Tidal Wave and a Johnny Wave), and the
// process sense is always lowercase ("this lane", "the WeWF enrichment lane",
// "lanes A+B", "minted this wave"). A bare \bledger\b is NOT a marker for the
// same reason and a stronger one: 1,108 of the notes on file use it for a
// fed's own title-history ledger, which is exactly the kind of fact these
// pages exist to state — only the internal ledgers are named here.

// Sentence split that does NOT break on a period inside a filename, a
// version, an initial or an abbreviation: only a terminator followed by
// whitespace and an opening character (or end of string) ends a sentence.
//
// A PARTITION, NOT A FILTER. splitSentences(s).join("") === s for every input,
// which is the whole safety property here: keeping every sentence has to
// return the note unchanged. The first cut of this used one sentence-shaped
// global regex with String.match, which silently DISCARDS the text BETWEEN
// matches — a note whose opening sentence ended in a filename ("the
// rec.sport.pro-wrestling.fantasy newsgroup's own year-end poll.") lost that
// opening outright, and 3,130 notes carrying no process marker at all came out
// altered. Caught by this lane's own smoke run before the patch left the
// workshop; the invariant below is checked there on every field on file.
// The boundary rule: a terminator, an optional closing quote/bracket, then
// WHITESPACE (or end of text). Whitespace is what separates "the fed's own
// 1997 card. The next" from "data/reigns.json", "CURATION.md v96", "U.S." and
// "wnu-2003-03-05.html)" — every abbreviation-shaped period in this corpus is
// followed immediately by a letter, never by a space. Requiring an UPPERCASE
// letter after the space, as the first cut did, was worse than useless here:
// these notes routinely open a sentence in lower case ("this pass's own
// Evo-corpus read ..."), which welded a clean sentence to the process
// sentence after it and dropped both.
//
// And never inside an open quotation: a fed's own dialogue is full of
// terminators ("___? The Asylum? Any of that ring a bell?"), and splitting
// there leaves a served page showing half a quote.
function insideQuote(s, idx) {
  const head = s.slice(0, idx);
  const straight = (head.match(/"/g) || []).length;
  if (straight % 2 === 1) return true;
  const opens = (head.match(/[“]/g) || []).length;
  const closes = (head.match(/[”]/g) || []).length;
  return opens > closes;
}
function splitSentences(s) {
  const out = [];
  let last = 0, m;
  SENTENCE_END_RE.lastIndex = 0;
  while ((m = SENTENCE_END_RE.exec(s)) !== null) {
    const end = m.index + m[0].length;
    if (SENTENCE_END_RE.lastIndex <= m.index) SENTENCE_END_RE.lastIndex = m.index + 1;
    if (insideQuote(s, end)) continue;
    out.push(s.slice(last, end));
    last = end;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
function stripProcessSentences(s) {
  if (!s) return s;
  // Parentheticals first: "(read by this lane, not separately served)" is the
  // whole leak, and dropping only it keeps the sentence around it.
  let out = s.replace(/\s*\((?:[^()]*)\)/g, (m) => (PROCESS_MARKER_RE.test(m) ? "" : m));
  out = out.replace(/\s*\[(?:[^\[\]]*)\]/g, (m) => (PROCESS_MARKER_RE.test(m) ? "" : m));
  const sentences = splitSentences(out);
  const kept = sentences.filter((sent) => sent.trim() && !PROCESS_MARKER_RE.test(sent));
  if (kept.length === sentences.length) out = sentences.join("");
  else out = kept.map((sent) => sent.trim()).filter(Boolean).join(" ");
  out = out.replace(/[ \t]{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").replace(/^[\s;,:-]+/, "").trim();
  // A note whose every sentence was process narration renders as nothing —
  // silence over a box with a fragment in it, the museum's own voice rule.
  if (!/[A-Za-z0-9]/.test(out)) return "";
  return out;
}

// The one function every ENTITY-page renderer calls on a free-text field.
//
// TWICE, and the first time on the RAW note, because sanitizeMachineryLeak
// launders some of the very words the markers look for: its own rules rewrite
// "The UeWF lane of the same morning" to "the UeWF review" and "THE IDENTITY
// WAVE" to "the accession". Strip the raw text first, where the internal
// vocabulary is still itself; sanitize what survives; then strip once more,
// because the sanitizer's own replacements can put "accession" or "this pass"
// into a sentence that did not have one before. (binkie-horowitz, the QA's own
// first row, is the case that proved the first pass has to see the raw note.)
function servedText(raw) {
  if (typeof raw !== "string") return raw;  // coordinator 2026-09-06: entityCard passes non-strings (arrays/objects) through untouched
  // hook c171 (adversarial review 1009, C06 + B11): a field that was built from an empty value once printed the literal word
  // "undefined" at the start or the end of a note (three FAW tenure notes); and an affiliation edge's working note
  // ("REPOINTS ... superseded, not additional.") is registry bookkeeping, never prose for a visitor. Both drop here, on the one
  // path every served note takes; the registry keeps its own text.
  raw = raw.replace(/\s*\bREPOINTS\b[^]*?superseded, not additional\.?/g, "").replace(/^\s*undefined\s+/, "").replace(/\s+undefined\s*$/, "");
  const first = stripProcessSentences(reignEndWords(raw || ""));
  if (!first) return "";
  const second = stripProcessSentences(sanitizeMachineryLeak(first) || "");
  if (!second) return "";
  // A note whose opening sentence was process narration can leave the survivor
  // starting mid-thought in lower case. Restore the capital the sentence would
  // have had if it had always been first — cosmetic, and only ever the first
  // character of a note whose original first character was itself a capital.
  if (/^[a-z]/.test(second) && /^[A-Z]/.test(String(raw).trim())) {
    return second[0].toUpperCase() + second.slice(1);
  }
  return second;
}

// THE SOURCE-STRING STAGE (L139, entity-page residue follow-up to L128's
// servedText(), 2026-09-05): servedText() above was built for `note`-shaped
// free text and is called on `note`/`notes`/`how`/`conflict.note`/`epitaph`
// fields; it was never wired to a `source` field (tenure.source,
// tenure.record_declared.source), so a source string's own process narration
// ("...served this pass...", "...this join's own lane digest carries the
// reading", a raw registry row id, a rule code, "under the no-merge rule")
// rendered straight into the Tenure-detail box's "Source: " line untouched --
// entity-page QA residue sample, 2026-09-05: 105 "this pass", 23 rule code, 9
// raw row id, 8 lane, 7 coordinator, 2 wave- pages, all traced to this one
// unrouted field (see smoke/digest.md for the full accounting).
//
// A DELIBERATELY NARROWER MARKER SET than PROCESS_MARKER_RE, because a
// source string's whole job is a CITATION and "(accession 0037)" is the
// sanctioned citation format for a Wayback-Machine lot (renderProvenanceSection
// above renders the identical "accession NNNN" convention as a live link) --
// stripping a bare "accession" out of a source sentence would delete the
// citation itself, not the process narration. See the file-level comment
// above PROCESS_MARKER_RE for why "lane"/"wave-" stay case-sensitive and
// hyphen-anchored (Stan Lane, Heat Wave, "charter-and-heat-wave-card-1997-
// 07-15.html" are all real, all legitimate, and none of them is this
// workshop's own apparatus).

// Same two-pass parenthetical-then-sentence algorithm as stripProcessSentences,
// against SOURCE_MARKER_RE instead of PROCESS_MARKER_RE. A source string that
// is ENTIRELY process text (no marker-free sentence survives) renders as
// nothing -- same silence-over-a-fragment rule stripProcessSentences applies,
// so the Tenure-detail box's dated facts stand with no "Source: " line under
// them rather than an empty one.
function stripProcessSentencesSource(s) {
  if (!s) return s;
  let out = s.replace(/\s*\((?:[^()]*)\)/g, (m) => (SOURCE_MARKER_RE.test(m) ? "" : m));
  out = out.replace(/\s*\[(?:[^\[\]]*)\]/g, (m) => (SOURCE_MARKER_RE.test(m) ? "" : m));
  const sentences = splitSentences(out);
  const kept = sentences.filter((sent) => sent.trim() && !SOURCE_MARKER_RE.test(sent));
  if (kept.length === sentences.length) out = sentences.join("");
  else out = kept.map((sent) => sent.trim()).filter(Boolean).join(" ");
  out = out.replace(/[ \t]{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").replace(/^[\s;,:-]+/, "").trim();
  if (!/[A-Za-z0-9]/.test(out)) return "";
  return out;
}

// The one function every SOURCE field (tenure.source,
// tenure.record_declared.source) is rendered through. No reignEndWords pass
// (end_how enum tokens do not appear in a source citation) and no
// sanitizeMachineryLeak pass (that function's own rewrites are keyed to
// note-shaped doctrine prose -- "the collision doctrine", "THE IDENTITY WAVE"
// -- not citation strings; running it over a source string risked introducing
// the word "accession" into a sentence that did not have one, which is
// harmless under SOURCE_MARKER_RE's own accession-is-not-a-marker rule but
// adds a rewrite pass with nothing in the live corpus for it to fix -- see
// digest.md open questions). One pass is enough because, unlike a note,
// nothing upstream launders a source string's own vocabulary before this
// runs.
// SOURCE-PATH LINKING WAVE (L199): reads the served page's own
// <title>/<h1> straight off disk for a document neither shows.json nor
// rps.json indexes (a reference/archive page like title-histories.html or
// a roster bio card) -- the same <title> extraction pageTitle() already
// does for the page currently being walked, applied here on demand to an
// arbitrary already-served route instead. Returns null (never a raw path,
// never a guess) when the file does not exist on disk or carries no title
// this build can read at all.
function readDocTitleFromDisk(rel) {
  const abs = resolve(ROOT, rel);
  if (!existsSync(abs)) return null;
  let html;
  try { html = readFileSync(abs, "utf8"); } catch { return null; }
  const title = pageTitle(html);
  if (title && title !== "?") return title;
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  if (h1) return h1[1].replace(/<[^>]+>/g, "").trim() || null;
  return null;
}
// SOURCE-PATH LINKING WAVE (L199, entity-page residue sweep, 2026-09-06,
// ranked #1 -- 8,136 pages): a tenure.source citation the curator wrote
// with a bare site-relative document path baked in rendered as inert
// text, never a link, never even a label a reader would recognise
// ("promotions/agw/archive/title-histories.html", unleaded-agw.html's own
// case). Turns every such path into a real <a href> whose text is the
// document's own title (docTitleByPath's shows/rps lookup first, then a
// direct disk read for a reference document neither shard indexes) -- or,
// when this build can find nothing at all for the path, a plain (UNLINKED
// -- there is nothing on disk to link to) "the wing's own document[, of
// <date>]" placeholder, never the raw path. Runs on the ALREADY-CLEANED
// text (post stripProcessSentencesSource), and does its own esc()'ing, so
// callers must stop esc()'ing its return value a second time -- this
// return value is safe HTML, not plain text, the one exception among this
// file's `served*Text` family (documented on servedSourceText below).
//
// Also fixes the malformed-double-path shape (euwc-marcus-slayton.html's
// own tenure.source, two paths joined "PATH1 / ./PATH2") as a side effect
// of matching each embedded path independently: once both become real
// links, the leftover " / " between them reads as an ordinary separator
// instead of stray "/./" glue -- no separate collapsing pass needed.
function linkSourceDocPaths(text, fallbackDate) {
  if (!text) return text;
  let out = "";
  let last = 0;
  SOURCE_DOC_PATH_RE.lastIndex = 0;
  let m;
  while ((m = SOURCE_DOC_PATH_RE.exec(text))) {
    out += esc(text.slice(last, m.index));
    const rel = m[0].replace(/^\.\//, "");
    const known = docTitleByPath.get(rel) || readDocTitleFromDisk(rel);
    out += known
      ? `<a href="/${esc(rel)}">${esc(known)}</a>`
      : esc(fallbackDate ? `the wing's own document of ${fallbackDate}` : "the wing's own document");
    last = m.index + m[0].length;
  }
  out += esc(text.slice(last));
  return out;
}
// The one function every SOURCE field (tenure.source,
// tenure.record_declared.source) is rendered through. No reignEndWords pass
// (end_how enum tokens do not appear in a source citation) and no
// sanitizeMachineryLeak pass (that function's own rewrites are keyed to
// note-shaped doctrine prose -- "the collision doctrine", "THE IDENTITY WAVE"
// -- not citation strings; running it over a source string risked introducing
// the word "accession" into a sentence that did not have one, which is
// harmless under SOURCE_MARKER_RE's own accession-is-not-a-marker rule but
// adds a rewrite pass with nothing in the live corpus for it to fix -- see
// digest.md open questions). One pass is enough because, unlike a note,
// nothing upstream launders a source string's own vocabulary before this
// runs.
//
// L199 addendum: this now returns already-escaped, already-linked HTML
// (via linkSourceDocPaths), not plain text -- the two call sites below stop
// wrapping the result in esc() a second time. `fallbackDate` is an optional
// hint (a tenure's own first_seen/last_seen) used only for the "the wing's
// own document of <date>" placeholder when a path resolves to nothing.
function servedSourceText(raw, fallbackDate) {
  const out = stripProcessSentencesSource(raw || "");
  if (!out) return "";
  const capped = (/^[a-z]/.test(out) && /^[A-Z]/.test(String(raw).trim()))
    ? out[0].toUpperCase() + out.slice(1)
    : out;
  return linkSourceDocPaths(capped, fallbackDate);
}

// THE BIO GRADE-TAG STAGE (L141, entity-page residue follow-up to L139's own
// open question #3, 2026-09-05): a tenure's own `bio` field is mined
// VERBATIM from a fed's own CGI roster page — fan-authored trivia with
// literal field labels ("Hair color: Black"), not curator prose. It
// occasionally embeds this workshop's OWN evidence-grade vocabulary as a
// bracketed qualifier an editor left on one scraped detail ("Black
// (presumed)"). Neither PROCESS_MARKER_RE (this field isn't sentence-shaped
// process narration — it's raw fan trivia the sentence splitter has no
// business touching) nor SOURCE_MARKER_RE (this isn't a citation) apply
// here: the bio's OWN content is what is being graded, not its provenance.
// So this drops ONLY the "(presumed)" tag text itself — never a sentence,
// never the fact it qualifies ("Black" stands; the workshop's own grading
// word about it doesn't) — and nothing else in the bio moves.
function servedBioText(raw) {
  if (!raw) return raw;
  return raw.replace(BIO_GRADE_TAG_RE, "");
}

// Identity assertions AND conflict-hedges alike (CURATION.md's sources-disagree rule: "when
// sources disagree, the museum records both") — an entity's own `identity`
// array (merged/distinct, evidence-graded) plus, separately, any reign this
// entity holds that carries a `conflict` object (e.g. the Crow/Hades IWF
// Hardcore inaugural-reign disagreement) surfaces its hedge here too.
// GRADE_LABEL is no longer read by the Identity section (see below) — it is
// kept because renderRelationshipsSection still references it.
// THE IDENTITY SECTION STATES THE FACT (entity-page QA sample, 2026-09-05,
// ranked defect #1 — "a page's own 'Identity' section narrates the
// dedup/registry-matching machinery directly to the visitor": 3,959 pages
// carried an Identity heading, 3,797 of them narrating literal "distinct"
// reasoning, 3,818 showing the raw `(presumed)` grade tag, 458 the literal
// word "no-merge", 157 an internal rule version in parentheses and 33 the
// bracketed `[self-insert]` tag). This renderer now reads exactly two
// registry fields — `assertion` and `with` — and writes one plain sentence
// from them. It never renders `note` (the accession's own working argument:
// substring matches, four-signal tests, no-merge defaults, review-queue
// status, "the museum's own portrayal rule"), never the grade token, never a
// rule code. The note is not deleted anywhere; it stays in data/*.json where
// a curator re-reading the registry still wants it, exactly as THE WING-PAGE
// CLEANUP (the Janitor, 2026-09-05) left provenance_notes.
//
// The wing is named because "also held as X" is only a fact once you know
// WHERE — and it is named with bareAcronym, the same label the tenure cards
// and kickers already use, so a reader meets one name for a wing sitewide.
function identityTargetHtml(id) {
  const target = byId.get(resolveAlias(id)) || byId.get(id);
  if (!target) return null;
  const link = entityLink(target.id);
  const pid = (target.tenures ?? [])[0]?.promotion;
  const promo = pid ? promoById.get(pid) : null;
  if (!promo) return link;
  const label = bareAcronym(promo) || promo.name;
  const wing = promo.page ? `<a href="${esc(promo.page)}">${esc(label)}</a>` : esc(label);
  return `${link} in ${wing}`;
}
function identityTargetList(ids, seen) {
  const parts = [];
  for (const id of ids ?? []) {
    const canonical = resolveAlias(id);
    if (seen) {
      if (seen.has(canonical)) continue;
      seen.add(canonical);
    }
    const html = identityTargetHtml(canonical);
    if (html) parts.push(html);
  }
  return parts;
}
function renderIdentitySection(e) {
  const assertions = e.identity ?? [];
  if (!assertions.length) return "";
  // EVERY entry distinct — 3,401 of the 3,961 rows on file — is a page with
  // nothing to say beyond the shared name itself, and saying it once, as one
  // line, is the whole of it. Where nothing on the other side resolves (336
  // rows), the section does not render at all: silence over a heading with a
  // sentence about nothing under it.
  if (assertions.every((a) => a.assertion !== "merged" && a.assertion !== "presumed-same")) {
    const seen = new Set([e.id]);
    const links = [];
    for (const a of assertions) links.push(...identityTargetList(a.with, seen));
    if (!links.length) return "";
    return `<h2>Identity</h2><p class="muted small">Other characters share this name: ${links.join(", ")}.</p>`;
  }
  const rows = [];
  for (const a of assertions) {
    const parts = identityTargetList(a.with, null);
    if (!parts.length) continue;
    const list = parts.length > 1
      ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
      : parts[0];
    const tail = a.assertion === "merged" ? "recorded as the same character."
      : a.assertion === "presumed-same" ? "presumed the same character."
      : "a different character with the same name.";
    rows.push(`<div class="note">Also held as ${list}; ${tail}</div>`);
  }
  if (!rows.length) return "";
  return `<h2>Identity</h2>${rows.join("\n")}`;
}

// THE CHARACTER PAGES FINAL FORM (2026-08-22, item 4, the Janitor's doctrine:
// "nothing enumerable lives on a page" — a character page states identity
// and LINKS to the instruments that hold the actual record, never re-lists
// what they already hold). The four section renderers this used to carry —
// Title reigns (a per-title reign table), Shows (an appearances list plus
// a match-index link), Roleplays (the catalog + referencing lists) and
// Awards (a bestowal list) — are RETIRED outright, not just unlinked: every
// fact they rendered still lives in the registry and is still reachable,
// but through the five searchable instruments below, pre-filtered to this
// entity, rather than re-enumerated on every one of ~1,200 pages a fact
// change would otherwise have to fan out to. One bare link per instrument,
// always rendered (a zero-result search is a normal, correct state for a
// live instrument, not a "nothing here yet" the museum's own voice would
// ever narrate) — no counts, per the same doctrine.
function renderInstrumentLinksSection(e) {
  const id = encodeURIComponent(e.id);
  const links = [
    `<a href="/matches.html?participant=${id}">Matches</a>`,
    `<a href="/appearances.html?who=${id}">Appearances</a>`,
    `<a href="/reigns.html?holder=${id}">Reigns</a>`,
    `<a href="/bestowals.html?recipient=${id}">Awards</a>`,
    `<a href="/relationships.html?who=${id}">Relationships</a>`,
    `<a href="/rps.html?involves=${id}">Roleplays</a>`,
  ];
  return `<h2>Records</h2><p>${links.join(" &middot; ")}</p>`;
}

// THE GAME-VALUABLE DATAPOINTS WAVE: a "Relationships" section — feud,
// tag-partner, kayfabe-kin, kayfabe-spouse, mentor, AND (2026-08-18 layout
// ruling, "Manages moves under Relationships") manager-of edges, all in one
// list rather than manager-of getting its own separate top-of-page slot.
// Bidirectional by construction, not by per-entity code: relationshipsByEntity
// is built once from data/relationships.json by pushing BOTH r.a and r.b
// into the map (see above), so the manager's own page sees side "a" (renders
// "Manages: <managed>") and the managed entity's page sees side "b" (renders
// "Managed by: <manager>") automatically — every manager-of edge, both ways,
// with no special-casing per pair.
// THE ROSTER-CARD RESTYLE (REVIEW-FIXES WAVE, 2026-08-22, the Janitor: "use a
// format more like the Characters listing on the memorium pages... The box
// formatting, the character link, the relationship descriptions") — each
// relationship is its own .roster-card, the memorial character-block shape:
// the OTHER entity's linked name as the card heading, the relationship's
// nature/detail/grade as the card body. Because the card subject is now the
// OTHER entity (not this page's own perspective sentence), the directional
// verbs flip to describe the card subject's relation to this page's entity,
// by name — "Jamie Shock / Feud with Seymour Almasy", "Aerith Heartilly /
// Manages Seymour Almasy" — unambiguous either direction.
function renderRelationshipsSection(e) {
  const mine = (relationshipsByEntity.get(e.id) ?? []).filter(({ rel }) => rel.nature !== "same-handler");
  const cluster = sameHandlerClusters.get(e.id) ?? [];
  // THE CHARACTER PAGES FINAL FORM (item 4): a character's own unit
  // membership folds in HERE as a relationship-styled row, rather than
  // keeping its own separate "Units" section (renderUnitsSection now
  // handles only a UNIT's own member roster, the other direction).
  const memberOf = e.type !== "unit" ? (unitsByCharacterId.get(e.id) ?? []) : [];
  if (!mine.length && !cluster.length && !memberOf.length) return "";
  const card = (headingHtml, bodyHtml) => `<div class="roster-card"><h3>${headingHtml}</h3><div class="muted small">${bodyHtml}</div></div>`;
  const rows = mine.map(({ other, rel, side }) => {
    // Verb describes the CARD SUBJECT (the other entity) relative to this
    // page's own entity — the inverse of the old page-perspective line.
    let verb;
    if (rel.nature === "mentor") verb = side === "a" ? "Mentored by" : "Mentor of";
    else if (rel.nature === "manager-of") verb = side === "a" ? "Managed by" : "Manages";
    else verb = RELATIONSHIP_VERB[rel.nature] ?? rel.nature;
    const detail = rel.detail ? ` <span class="muted small">(${esc(rel.detail)})</span>` : "";
    const grade = ` <span class="muted small">[${esc(GRADE_LABEL[rel.grade] || rel.grade)}]</span>`;
    return card(entityLink(other), `${esc(verb)} ${esc(e.name)}${detail}${grade}`);
  });
  for (const u of memberOf) {
    const era = [...new Set((u.tenures ?? []).map((t) => acronymLabel(promoById.get(t.promotion)) || t.promotion))].join(", ");
    rows.push(card(entityLink(u.id), `${esc(e.name)}, member${era ? ` <span class="muted small">(${esc(era)})</span>` : ""}`));
  }
  // THE SAME-HANDLER EDGES WAVE: one cluster-wide card, never a name, never
  // pairwise repetition — every OTHER entity sharing this one's own
  // real-world handler, sorted for stable output.
  if (cluster.length) {
    const names = cluster
      .map((id) => ({ id, name: byId.get(id)?.name ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ id }) => entityLink(id));
    rows.push(card("Same handler", names.join(" &middot; ")));
  }
  return `<h2>Relationships</h2>${rows.join("\n")}`;
}

// THE PLACARD (2026-08-18, user layout ruling) — the per-entity page's own
// museum-label fact box, header anatomy: name (h1) -> aka subtitle ->
// caption (lede) -> THIS. Only populated fields render, never a narrated
// absence (standing invariant #6). Two different disciplines share the box
// on purpose, same "declared vs. observed"-flavored honesty the rest of the
// schema already practices:
//   - height/weight/hometown/alignment get an actual CONSENSUS: where every
//     tenure carrying a value agrees, one plain fact renders; where tenures
//     DISAGREE, the most-recent tenure's own value renders up front with a
//     <details> naming every tenure's own value by era — nothing is
//     silently averaged or overwritten.
//   - style/finisher(s)/entrance music stay VERBATIM per tenure, never
//     consensus-collapsed (a fed's own telling of a fighting style is not a
//     fact two feds can be reconciled into one "true" answer) — every
//     distinct value across tenures lists, promotion-tagged once more than
//     one tenure carries the field.
// "Most-recent-tenure wins" (the one documented tie-break): recency is the
// tenure's own parsed last_seen year, falling back to first_seen, falling
// back to LAST position in tenures[] when nothing parses at all — the
// registry's own tenures are entered chronologically as mined, so array
// order is an honest last resort, never the first choice.
function tenureRecencyYear(t) {
  const m = String(t.last_seen ?? t.first_seen ?? "").match(/\d{4}/);
  return m ? parseInt(m[0], 10) : null;
}
function mostRecentTenure(tenures) {
  let best = tenures[tenures.length - 1];
  let bestYear = tenureRecencyYear(best);
  for (const t of tenures) {
    const y = tenureRecencyYear(t);
    if (y !== null && (bestYear === null || y >= bestYear)) { best = t; bestYear = y; }
  }
  return best;
}
// ONE PLACARD COMPONENT, TWO CONSUMERS (2026-08-18 styling-unification
// gavel): every `.placard` sitewide — the 12 wing pages' own hand-authored
// boxes and this generated one — shares the exact same inner shape: a
// single `<p class="meta">`, one `<span class="k">Label</span> &nbsp;
// value` fragment per fact, joined with `<br>`. The wrestler placard's
// first cut used `<ul class="meta"><li>` instead, which LOOKS like the same
// component (same class name) but isn't — `.meta` has no list-style reset
// anywhere in style.css because every other consumer is a `<p>`, so the
// `<ul>` form silently grew its own bulleted, differently-spaced local
// variant. Fixed here by conforming to the established `<p>` shape rather
// than by adding new CSS — the tokens already existed, only the wrong tag
// was in use. A <details> disagreement expander is genuinely block content
// (invalid inside a <p>, whatever the visual similarity), so it renders as
// a sibling AFTER the <p>, never nested inside it.
// THE FANDOM CROSS-CHECK WAVE (2026-08-24) — mirrors the helper in
// stamp-promotion-headers.mjs: a `fandom` field holds the EXACT article
// title as the wiki spells it, and MediaWiki's own URL form is
// spaces-to-underscores then percent-encoding. `encodeURI` (not
// `encodeURIComponent`) so a title carrying a slash or a colon survives
// intact, the same shape the wiki's own canonical links use.
function fandomUrl(title) {
  return "https://ewrestling.fandom.com/wiki/" + encodeURI(String(title).trim().replace(/ /g, "_"));
}
function metaRowFragment(label, valueHtml) {
  return `<span class="k">${esc(label)}</span> &nbsp; ${valueHtml}`;
}
function consensusRow(label, field, tenures, promoLabelFn) {
  const withVal = tenures.filter((t) => t[field]);
  if (!withVal.length) return null;
  const distinct = [...new Set(withVal.map((t) => t[field]))];
  if (distinct.length === 1) return { line: metaRowFragment(label, esc(distinct[0])), details: "" };
  const recent = mostRecentTenure(withVal);
  const byEra = withVal.map((t) => `<div>${esc(promoLabelFn(t.promotion))}: ${esc(t[field])}</div>`).join("");
  return {
    line: metaRowFragment(label, `${esc(recent[field])} <span class="muted small">(differs by era, below)</span>`),
    details: `<details><summary class="muted small">${esc(label)} — differs by era</summary>${byEra}</details>`,
  };
}
// THE ENTRANCE MUSIC STRUCTURED WAVE: entrance_music is now {title?,
// artist?, verbatim} rather than a bare string — every render site quotes
// `verbatim` (never title/artist alone, which exist for indexing/filtering
// only, not display). A still-unmigrated legacy string tenure (if any)
// renders as-is, unchanged.
function entranceMusicText(val) {
  if (val && typeof val === "object") return val.verbatim ?? "";
  return val;
}
function verbatimListRow(label, field, tenures, promoLabelFn) {
  const textOf = (t) => (field === "entrance_music" ? entranceMusicText(t[field]) : t[field]);
  const withVal = tenures.filter((t) => textOf(t));
  if (!withVal.length) return null;
  const multi = withVal.length > 1;
  const seen = new Set();
  const parts = [];
  for (const t of withVal) {
    const text = textOf(t);
    const key = multi ? `${text}::${t.promotion}` : text;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(multi
      ? `${esc(text)} <span class="muted small">(${esc(promoLabelFn(t.promotion))})</span>`
      : esc(text));
  }
  return { line: metaRowFragment(label, parts.join("; ")), details: "" };
}
// THE CHARACTER PAGES FINAL FORM (item 4): catchphrases fold INSIDE the
// placard, not their own section — rendered from the same tenure-level
// `catchphrases[]` data renderTenuresSection used to render inline, per
// era, same era-tagging convention verbatimListRow already uses (a single
// tenure's own list stays unlabeled; more than one tenure carrying
// catchphrases tags each era so they don't blend into one undifferentiated
// list a reader can't attribute to a promotion).
function catchphrasesRow(tenures, promoLabelFn) {
  const withVal = tenures.filter((t) => (t.catchphrases ?? []).length);
  if (!withVal.length) return null;
  const multi = withVal.length > 1;
  const parts = withVal.map((t) => {
    const quotes = t.catchphrases.map((c) => `&ldquo;${esc(c)}&rdquo;`).join(", ");
    return multi
      ? `${quotes} <span class="muted small">(${esc(promoLabelFn(t.promotion))})</span>`
      : quotes;
  });
  return { line: metaRowFragment("Catchphrases", parts.join("; ")), details: "" };
}
// PORTRAYAL-FORMAT WAVE (user gavel) — every portrayal renders sitewide as
// "Name (Source)", grade/type dropped from the compact row (still graded
// and validated in the data, just not repeated inline every time); grouped
// by verb (Portrays / Inspired by) so a fused derivation like
// seymour-almasy's — TWO source figures behind one ring name — renders as
// one row: "Inspired by: Seifer Almasy (FFVIII) · Seymour (FFX)". `portrays`
// accepts a bare object OR an array (THE ALMASY FUSION FIX) — normalized to
// an array here, once, so every caller downstream never has to branch on
// the shape.
//
// PORTRAYALS OF REAL PROFESSIONAL WRESTLERS (CURATION.md v78, 2026-08-24).
// The reverse index the whole mechanism turns on: v78(d) puts every
// portrayal of one wrestler on that wrestler's own figure page, "the one
// place all portrayals of a given wrestler gather, and the search surface
// for them." Both edges feed it — `portrayal_of` (the v78 facet, a fed
// staging a real professional wrestler) and the general `portrays` link
// (every other kind of namesake: a sitcom dad, a Nintendo enemy, a band) —
// because the page is the figure's whole inbound record, not just the part
// v78 legislates.
//
// A figure page is generated ONLY for a figure something actually points
// at. That is not tidiness: validate.mjs's own reachability audit fails the
// build on any served page no link chain reaches, and a figure with no
// inbound edge has nothing to reach it from. lew-spectre-original is the
// live case — a real figure held on the record precisely because this
// collection's Lew Spectre is NOT him, so nothing portrays him and no page
// is owed.
// THE CANON PORTRAYAL (hook c101, 2026-10-07; JOBS CANON-PORTRAYAL-VERB).
// v99's canonical-portrayal clause: a diary set in a game world's own canon
// (the CornellVerse) stages that canon's figures in its own continuity, so a
// character's `portrays` to a fictional-character figure whose `source` names
// such a canon IS a portrayal, though `portrayal_of` stays real people only
// (v78). Before this the "Portrays" verb and the figure page's "Portrayed in"
// list keyed on `portrayal_of` alone, and every CornellVerse portrayal read
// "Inspired by" / "Named for". No data shape changes: the canon is named by
// the figure's own `source`, and a new canon joins by its source tag here.
const PORTRAYAL_CANON_SOURCES = new Set(["CornellVerse"]);
const isCanonPortrayal = (figureId) => {
  const f = externalById.get(figureId);
  return !!f && f.type === "fictional-character" && PORTRAYAL_CANON_SOURCES.has(f.source);
};
const portrayedBy = new Map(); // external-figure id -> [{ entity, facet }]
for (const e of entities) {
  const list = e.portrays ? (Array.isArray(e.portrays) ? e.portrays : [e.portrays]) : [];
  for (const pt of list) {
    if (!pt || !pt.figure || !externalById.has(pt.figure)) continue;
    const arr = portrayedBy.get(pt.figure) || [];
    if (arr.some((r) => r.entity.id === e.id)) continue;
    arr.push({ entity: e, facet: e.portrayal_of === pt.figure || isCanonPortrayal(pt.figure) ? "portrayal" : "namesake" });
    portrayedBy.set(pt.figure, arr);
  }
}
const figurePageIds = new Set(portrayedBy.keys());
// A FEDERATION THAT PORTRAYS A REAL PROMOTION (hook c101; the Janitor, desk
// D400: "(a) a "real-promotion" type in the external-figures register" and
// "(a) a `portrays` field on the wing's row"; D406: "(a) the wing only";
// CURATION.md v128 (c), #real-promotion-fan-feds). A wing's own `portrays`
// names the real promotion its fiction depicts. The figure page lists those
// wings ("Portrayed by"), apart from the two character lists, because it is a
// different claim; the wing page carries one line (renderConnectionsSection).
// Nothing about the real company is assembled here (v100, v128 (e)): the page
// is the registry row and its inbound edges. A served wing only: its index
// page must exist, as the wing-page marker passes require.
const wingPortrayalsByFigure = new Map(); // real-promotion figure id -> [promotion row]
for (const p of promotions) {
  if (!p.page || !existsSync(resolve(ROOT, p.page.replace(/^\//, ""), "index.html"))) continue;
  const list = p.portrays == null ? [] : (Array.isArray(p.portrays) ? p.portrays : [p.portrays]);
  for (const pt of list) {
    const f = pt && pt.figure ? externalById.get(pt.figure) : null;
    if (!f || f.type !== "real-promotion") continue; // registry-validate hard-fails the rest
    const arr = wingPortrayalsByFigure.get(f.id) || [];
    if (!arr.includes(p)) arr.push(p);
    wingPortrayalsByFigure.set(f.id, arr);
  }
}
for (const id of wingPortrayalsByFigure.keys()) figurePageIds.add(id);
function portraysRow(e) {
  if (!e.portrays) return null;
  const list = Array.isArray(e.portrays) ? e.portrays : [e.portrays];
  const byVerb = new Map();
  for (const pt of list) {
    const figure = externalById.get(pt.figure);
    if (!figure) continue;
    // THE VERB IS THE PORTRAYAL FACET, NOT THE FIGURE'S TYPE (2026-08-24).
    // This used to key off `figure.type === "real-person"` plus the grade,
    // which got the common case right by accident and the real question
    // wrong: it called every real-person namesake a portrayal. GDWA's
    // heidi-leick-gdwa rendered "Portrays Hudson Leick" though its own note
    // says the opposite in as many words — a NAMESAKE, the character takes
    // the actress's true given name, GDWA barred real wrestlers and never
    // staged her. `portrayal_of` is the one fact that separates the two
    // (see the facet split at portrayedBy above, and v78): a fed STAGING a
    // real professional wrestler carries it; a name that merely borrows
    // does not. So: "Portrays" only when this entity's portrayal_of names
    // THIS figure. Everything else — an actor, an NFL coach, a wrestler the
    // character only resembles (the 4WW ruling: resemblance is not
    // portrayal) — is "Inspired by".
    // hook c101: a canon portrayal (v99, isCanonPortrayal above) reads as one.
    const verb = e.portrayal_of === pt.figure || isCanonPortrayal(pt.figure) ? "Portrays" : "Inspired by";
    const sourceTag = figure.source ? ` <span class="muted small">(${esc(figure.source)})</span>` : "";
    // PORTRAYALS (v78(d), 2026-08-24): the figure's own name is now the way
    // to the figure's page, which is the one place every portrayal of one
    // wrestler gathers. Bold when there is no page to reach — a figure
    // nothing links to doesn't get one (see figurePageIds below).
    const label = figurePageIds.has(figure.id)
      ? `<a href="/figures/${esc(figure.id)}.html">${esc(figure.name)}</a>`
      : `<b>${esc(figure.name)}</b>`;
    const entry = `${label}${sourceTag}`;
    const arr = byVerb.get(verb) || [];
    arr.push(entry);
    byVerb.set(verb, arr);
  }
  if (!byVerb.size) return null;
  const lines = [...byVerb.entries()].map(([verb, entries]) => metaRowFragment(verb, entries.join(" &middot; ")));
  return { lines };
}
// THE HOLDER'S-OWN-SITE LINK-OUT (the Janitor, 2026-09-27: "I feel like we
// should link to promotions, bios, etc on Argyle's site in the placards";
// CURATION.md v124, #holders-site-links) — v119's `links_out[]`, until now a
// memorial-only field, now rides a promotion, show, character, unit and title
// record too, wherever the promotion's own holder runs a living site of it.
// Same posture as the memorial link-out and the fandom cross-check row above
// it, for the same reasons:
//   * `rel="noopener nofollow"` — the museum sends a reader onward and passes
//     nothing else along (v112(b), the no-third-party-embed rule).
//   * the label lives INSIDE the anchor, which is what keeps the auto-linker
//     off it (linkPromosInPlainSegments' own insideA counter), so a label
//     carrying a held wing's own acronym is never quietly relinked inward.
//   * the museum's own words are two: "Also at". They name no federation, so
//     the one line around the links has nothing in it to link.
// A link is not a holding: nothing on the far side is a source for anything
// here, and no `checked` date is rendered — the date is the registry's receipt
// for WHEN the address was verified, not a claim this page makes today. The
// frontier's own re-check cadence on the host is what keeps the link honest,
// and registry-validate.mjs is where that is enforced.
function linksOutRow(rec) {
  const links = (rec.links_out ?? []).filter((l) => l && l.url && l.label);
  if (!links.length) return null;
  const items = links.map((l) => `<a href="${esc(l.url)}" rel="noopener nofollow">${esc(l.label)}</a>`).join(" &middot; ");
  return metaRowFragment("Also at", `${items} <span class="muted small">&mdash; the promotion's own surviving site, linked, not held.</span>`);
}
function renderPlacard(e) {
  const tenures = e.tenures ?? [];
  const promoLabelFn = (id) => acronymLabel(promoById.get(id)) || promoName.get(id) || id;
  const built = [
    consensusRow("Height", "height", tenures, promoLabelFn),
    consensusRow("Weight", "weight", tenures, promoLabelFn),
    consensusRow("Hometown", "hometown", tenures, promoLabelFn),
    consensusRow("Alignment", "alignment", tenures, promoLabelFn),
    verbatimListRow("Style", "style", tenures, promoLabelFn),
    verbatimListRow("Finisher(s)", "finisher", tenures, promoLabelFn),
    verbatimListRow("Entrance music", "entrance_music", tenures, promoLabelFn),
    catchphrasesRow(tenures, promoLabelFn),
  ].filter(Boolean);
  const lines = built.map((b) => b.line);
  const detailsBlocks = built.map((b) => b.details).filter(Boolean);
  // QA (the Janitor, 2026-08-22): no Roles line — it duplicated what every
  // tenure line already says, and a placard whose ONLY content was a
  // mechanical role union read as noise (the Lew Spectre case). With it
  // gone, a character with no recovered bio facts gets no placard at all
  // — silence over a near-empty box, per the museum's own voice rule.
  // Species (THE NONHUMAN DATATYPE WAVE) — moved into the placard per the
  // user's own ruling ("Species: table should definitely be in the
  // placard"); same straight-faced staging-not-appearance framing as ever.
  if (e.nonhuman) {
    lines.push(metaRowFragment("Species", `${e.species ? esc(e.species) : "unspecified"} <span class="muted small">(per the fed's own billing)</span>`));
  }
  // THE STAGED-GENDER WAVE: only rendered where actually known (male/
  // female/etc) — "unknown" is the silent default everywhere else, per
  // the museum's own never-narrate-machinery rule; no row for it.
  if (e.staged_gender && e.staged_gender !== "unknown") {
    const gradeNote = e.staged_gender_grade === "bio-explicit" ? "the fed's own bio card" : "the fed's own staged pronouns";
    lines.push(metaRowFragment("Staged gender", `${esc(e.staged_gender)} <span class="muted small">(per ${gradeNote})</span>`));
  }
  const portrays = portraysRow(e);
  if (portrays) lines.push(...portrays.lines);
  // v78(g), the placard language, fixed by the gavel word for word: "A
  // portrayal of the professional wrestler, staged by this promotion." The
  // figure, not the person; the fed's fiction, not the museum's claim — the
  // sentence is doing legal work as much as descriptive work, so it is not
  // paraphrased per-page and the wrestler's name is carried by the LINK
  // rather than by the sentence. Hook c116 (D430, "(B) role words"): a person
  // the fed staged in another role gets the same sentence with that role's
  // words (portrayalRole / PORTRAYAL_ROLE_WORDS, at the top of this file).
  if (e.portrayal_of && externalById.has(e.portrayal_of)) {
    const fig = externalById.get(e.portrayal_of);
    const href = figurePageIds.has(fig.id) ? `/figures/${esc(fig.id)}.html` : null;
    const figLabel = href ? `<a href="${href}">${esc(fig.name)}</a>` : `<b>${esc(fig.name)}</b>`;
    lines.push(metaRowFragment("Portrayal", `${figLabel} <span class="muted small">&mdash; a portrayal of ${PORTRAYAL_ROLE_WORDS[portrayalRole(e)]}, staged by this promotion.</span>`));
  }

  // THE FANDOM CROSS-CHECK WAVE (the Janitor's directive, 2026-08-24) — the
  // same OUTBOUND pointer the wing placards carry, on the entities that
  // earned one. The bar is deliberately higher here than for a wing: an
  // exact, unique article title whose own text names a fed this entity is
  // actually tenured in. Everything ambiguous is left unset, because a
  // wrong link here would assert an identity the museum has not
  // established — the collision doctrine's "when in doubt we do not merge,"
  // pointed outward. Linked, never held: nothing on the far side is a
  // source for anything on this page.
  if (e.fandom) {
    lines.push(metaRowFragment("Elsewhere", `<a href="${esc(fandomUrl(e.fandom))}">On the e-wrestling fandom wiki</a> <span class="muted small">&mdash; a community-authored article, linked, not held.</span>`));
  }

  // v124, #holders-site-links: last row on the placard, after "Elsewhere" —
  // the holder's own living site is a nearer neighbour than a wiki, and reads
  // best as the placard's closing line rather than buried among bio facts.
  const alsoAt = linksOutRow(e);
  if (alsoAt) lines.push(alsoAt);

  if (!lines.length) return "";
  const metaHtml = `<p class="meta">${lines.join("<br>\n      ")}</p>`;
  return `<div class="placard"><span class="placard-label">Placard</span>\n      ${metaHtml}${detailsBlocks.join("")}</div>`;
}

// NOTES UNSERVED (the Janitor, desk D114, 2026-09-28, verbatim: "I actually
// don't think we should serve the notes on the museum site at all. As
// workshop notes, even within GitHub, is fine." — GAVELS 2026-09-28,
// D113-D115 row). The registry keeps every `notes` field exactly as it is;
// only the SITE stops rendering it, for the record types listed here. D116
// (desk, 2026-09-28) asks whether the rule reaches other record types'
// notes too (matches, roleplays, reigns, titles) — this lane (character and
// unit only) is scoped to widen by adding to this one constant, not by a
// new render change at each future call site.
const UNSERVED_NOTES_TYPES = new Set(["character", "unit"]);

// hook c171 (adversarial review 1009, C10): a neighbour that carries the SAME name as the page (three characters are named "Wasp")
// is told apart by its wing, so the pager never reads "<- WASP ... Wasp ->" with nothing to say which Wasp is which.
function pagerNeighbour(self, nb) {
  if (!nb || !nb.id) return null;
  let label = nb.name;
  if (sortKeyStr(nb.name) === sortKeyStr(self.name)) {
    const pid = (nb.tenures ?? [])[0]?.promotion;
    const wing = pid ? (acronymLabel(promoById.get(pid)) || promoName.get(pid) || pid) : "";
    if (wing) label = `${nb.name} — ${wing}`;
  }
  return { href: `/characters/${nb.id}.html`, label };
}

function generatePersonPage(e, prevEntity, nextEntity) {
  const pagerHtml = pagerNav(
    "characters",
    pagerNeighbour(e, prevEntity),
    pagerNeighbour(e, nextEntity),
  );
  const tenurePromoIds = [...new Set((e.tenures ?? []).map((t) => t.promotion))];
  const promos = tenurePromoIds.map(promoLinkedLabel).join(", ");
  const boozlerNote = e.boozler_rule
    ? `<div class="note"><span class="flag">${esc(e.name)} &mdash; the Bum Boozler rule</span>This name belonged to a caricature the museum does not perform today. The reigns/appearances below are facts of the lineage and stand; see <a href="/curation.html">Curation</a>.</div>`
    : "";
  // HEADER ANATOMY (2026-08-18 layout ruling): name (h1) -> aka as a styled
  // subtitle directly under the name -> caption as the lede sentence ->
  // THE PLACARD. aka is no longer a floating body paragraph — THE SUBTITLE
  // COMPONENT (style.css's own .subtitle, shared with the promotion wing
  // header's own tagline line) renders it italic and brass-tinted, not
  // stray prose.
  const aka = e.aka?.length ? `<p class="subtitle">aka ${e.aka.map(esc).join(", ")}</p>` : "";
  // THE CAPTIONS WAVE: one hand-drafted museum-label sentence per entity —
  // a distillation, not a bio (that's `notes`, a curator's own working
  // note, still rendered separately below). Renders as the page's own lede,
  // directly under the aka subtitle, ahead of the placard.
  const captionLine = e.caption ? (() => { const v = servedText(e.caption); return v ? `<p class="lede caption"${captionLangAttr(e, promoById.get(tenurePromoIds[0]))}>${linkCaptionHtml(v, e.id, new Set(tenurePromoIds))}${aiFlag(e.caption_asof?.author)}${captionEn(e)}</p>` : ""; })() : "";
  const placardHtml = renderPlacard(e);
  // hook c227 (THE W-L-D RECORDS): the CAREER line, visible under the placard: every observed credit in every fed
  // (observedCareerFor), museum-counted from parsed match results, never a fed's declared record.
  const obsCareerPage = observedCareerFor(e.id);
  const careerRecordHtml = obsCareerPage
    ? `<p class="muted small">Career, observed by the museum, W-L-D: ${obsText(obsCareerPage.rec)} &mdash; from ${obsMatchesWord(obsCareerPage.n)} in ${obsCareerPage.promos} promotion${obsCareerPage.promos === 1 ? "" : "s"}. Counted from the match results the museum has parsed, not a record any fed declared.</p>`
    : "";
  const memorial = memorialByCharacterId.get(e.id);
  const memorialLine = memorial
    ? `<div class="note"><span class="flag">In memoriam</span>Linked to <a href="/memorials/${esc(memorial.id)}.html">${esc(memorial.name)} (${esc(memorial.years)})</a>.</div>`
    : "";
  // servedText (entity-page QA sample, 2026-09-05) — same rule as the tenure
  // note above: an entity's own notes line states facts, not the pass that
  // recorded them.
  // NOTES UNSERVED (D114, above): a character/unit's own `notes` field is a
  // workshop note now, not a served fact — the registry keeps it, the page
  // doesn't render it. `e.type === "unit" ? "unit" : "character"` mirrors
  // every other type-check in this function (see the kicker span below):
  // data/characters.json rows carry `type: "character"`, no `type` at all,
  // or (one on-file row) `type: "wrestler"`, and only data/units.json rows
  // ever carry `type: "unit"` — so a raw `e.type` lookup against this set
  // would silently miss the untyped/mistyped character rows.
  const notesLine = (e.notes && !UNSERVED_NOTES_TYPES.has(e.type === "unit" ? "unit" : "character")) ? (() => { const v = servedText(e.notes); return v ? `<p class="muted small">${esc(v)}</p>` : ""; })() : "";

  const sections = [
    renderTenuresSection(e),
    renderUnitsSection(e),
    renderIdentitySection(e),
    // QA (the Janitor, 2026-08-22): no rendered Relationships section — the
    // pre-filtered instrument link above IS the relationships surface now.
    renderInstrumentLinksSection(e),
  ].filter(Boolean).join("\n\n  ");

  const footerLine = `THE E-WRESTLING MUSEUM <span class="rule">/</span> Characters <span class="rule">/</span> ${esc(e.name)} <span class="rule">/</span>
    <a href="/characters.html">back to characters</a><br>
    Generated 2026 from the entity registry &mdash; not backdated. See
    <a href="/curation.html">Curation</a>.`;

  const main = `<p class="crumb"><a href="/">Museum</a> &nbsp;/&nbsp; <a href="/characters.html">Characters</a> &nbsp;/&nbsp; ${esc(e.name)}</p>

  <span class="kicker">${e.type === "unit" ? "Unit" : "Character"}${promos ? " &middot; " + promos : ""}</span>
  <h1>${esc(e.name)}</h1>
  ${aka}
  ${captionLine}
  ${placardHtml}
  ${careerRecordHtml}
  ${boozlerNote}
  ${memorialLine}
  ${notesLine}

  ${sections}
  ${pagerHtml}`;
  return pageShell({ title: `${esc(e.name)} &mdash; E-WRESTLING MUSEUM`, main, footerLine, rel: `characters/${e.id}.html` });
}

mkdirSync(resolve(ROOT, "characters"), { recursive: true });
let personPageCount = 0;
for (let i = 0; i < flatEntities.length; i++) {
  const e = flatEntities[i];
  const prevEntity = i > 0 ? flatEntities[i - 1] : null;
  const nextEntity = i < flatEntities.length - 1 ? flatEntities[i + 1] : null;
  writeFileSync(resolve(ROOT, "characters", `${e.id}.html`), generatePersonPage(e, prevEntity, nextEntity));
  personPageCount++;
}

// THE PERFECTION WAVE'S OWN GAVEL (2026-08-22): the LEGACY wrestlers/<id>.html
// REDIRECT STUBS this section used to generate (one per current character/unit
// id, plus a bare wrestlers.html stub) are retired outright, not regenerated.
// They existed only to keep the OLD path resolving to a real file on disk for
// this repo's own validate.mjs link check, because ~1,200 already-served
// verbatim artifacts (promotions/*/archive/*.html, promotions/*/rp/*.html) carried baked
// "/wrestlers/<id>.html" entity-links from before THE FRONT-ENTRANCE RENAME
// (v51) that had to stay byte-identical, full stop, per the verbatim-serving
// rule. The Janitor's own gavel closed that gap the other direction instead:
// those baked hrefs are museum-inserted presentation (the mined 2002-era
// source text never contained museum paths), squarely inside the
// verbatim rule's own chrome/crumb/wrapping carve-out — so every one of them
// was rewritten in place, /wrestlers/<id>.html -> /characters/<id>.html,
// proven byte-identical on visible text per file (strip-tags diff, zero
// failures). With zero on-disk references left, the stub apparatus has
// nothing left to protect and leaves the pass with zero trace of the rename:
// no wrestlers/ directory, no wrestlers.html, no generation code. The Janitor,
// verbatim, on why no redirect courtesy is owed either: "literally two people
// other than me have the link... Until phase 3, there's no courtesy for us to
// maintain." See CURATION.md's changelog for the full ruling.

// ---------------------------------------------------------------------------
// 3b. /titles/<id>.html — THE PER-TITLE PAGES WAVE (2026-08-18): every
// data/titles.json row gets its own generated page, exactly the same
// "never hand-edited, regenerate instead" discipline as wrestlers/ — the
// the Janitor's own anchor, verbatim: "the Championships brings us to the
// index/search for championships, but each championship gets its own page
// with its history documented there, rather than nested to the
// promotion." Every sentence on the page comes from a registry field —
// the `epitaph` field is the one piece of authored prose, mirroring a
// promotion's own Epitaph section, stored as data instead of hand-edited
// HTML because the page around it is generated, not curated.
// ---------------------------------------------------------------------------
const flatTitles = [...titles].sort((a, b) => {
  const ka = sortKeyStr(a.name), kb = sortKeyStr(b.name);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
});
// THE TITLE'S OWN BASE NAME (L162, entity-pages-qa-2-2026-09-06.md
// regression #1 / ranked #3): extracted, unchanged, from generateTitlePage's
// own former inline computation, so the collision census below and the
// page renderer itself can never compute two different answers for the
// same title. `wingLabel` is the era-qualified label the kicker line
// renders; `h1` is the bare base heading before any collision suffix.
function titleBaseH1(t) {
  const promo = promoById.get(t.promotion);
  const wingLabel = bareAcronym(promo) || String(t.promotion ?? "").toUpperCase();
  const wingShort = String(promo?.name ?? wingLabel).replace(/\s*\([^)]*\)\s*$/, "").trim() || wingLabel;
  const alreadyNamed = [wingShort, promo?.name, promo?.full_name, promo ? qualifiedFullName(promo) : null, wingLabel]
    .filter(Boolean)
    .some((c) => t.name.toUpperCase().startsWith(String(c).toUpperCase()));
  const h1 = alreadyNamed ? t.name : `${wingShort} ${t.name}`;
  return { h1, wingLabel };
}
// A NAME COLLISION, DISAMBIGUATED BY WING (regression #1 above): two
// different titles -- almost always the same bare acronym staged by two
// unrelated era-scoped promotions -- can render the identical base H1
// ("CCW International Championship"), with nothing left to tell their
// pages apart by heading, breadcrumb or browser-tab title. Computed once,
// over every title on file, before any page is generated. Verified against
// the live registry before this edit shipped: 21 groups, 45 title pages.
const titleH1Counts = new Map();
for (const t of flatTitles) {
  const { h1 } = titleBaseH1(t);
  titleH1Counts.set(h1, (titleH1Counts.get(h1) ?? 0) + 1);
}
// Lineage, the other direction: `restarted_from` is stored on the SUCCESSOR
// title only (uwf-world-heavyweight points back at giwf-world-heavyweight);
// a predecessor title's own page wants to say what it continues AS, too.
const successorByTitleId = new Map();
for (const t of titles) {
  if (t.restarted_from) successorByTitleId.set(t.restarted_from, t.id);
}
function titleLink(tid) {
  const t = titleById.get(tid);
  return t ? `<a href="/titles/${tid}.html">${esc(t.name)}</a>` : esc(tid);
}
// A reign's own year span, from its first recorded won-date to its last
// recorded lost-date (or won-date, if it's still held at the record's own
// end) — honest-precision, never smoothed: any 4-digit year found in
// either date string, nothing invented where neither carries one.
function titleYearSpan(rows) {
  if (!rows.length) return "";
  const firstY = String(rows[0].won?.date ?? "").match(/\d{4}/)?.[0];
  const last = rows[rows.length - 1];
  const lastRaw = last.lost?.date ?? last.won?.date ?? "";
  const lastY = String(lastRaw).match(/\d{4}/)?.[0];
  if (!firstY) return "";
  return !lastY || lastY === firstY ? firstY : `${firstY}&ndash;${lastY}`;
}
// Holder linking (the Janitor's own anchor: "every reign: holder linked").
// r.label already carries the full billed-name display text (reign-count
// suffixes, unit-vs-members breakdowns) and isn't safely splittable — so a
// SINGLE resolvable holder gets the whole label wrapped in their own link
// (the common case); a co-held reign keeps the label as plain text (it's
// often composite, e.g. "The S.A.S. (Studog Escobar & The Shark)") and
// gets a trailing linked list of whoever resolves. An unminted holder
// (name only, no registry id) links nothing — honest, nothing to link to.
function reignHolderCell(r) {
  // Flags the reign's own billed name without naming the internal rule by
  // its working title -- the character's own page (generatePersonPage's
  // boozlerNote) carries the full explanation and a link to Curation;
  // qa-visitor-walk-2026-08-29.md L4 found the bare "[Boozler-rule name]"
  // tag printed literally, unexplained, in four served reign tables.
  const boozler = r.boozler_rule ? ` <span class="muted small">[name not performed today]</span>` : "";
  const ids = (r.holder ?? []).filter((h) => h.id && !h.id.startsWith("name-") && byId.has(h.id));
  // A reign minted without its own `label` (holder's own billed name at
  // the time) falls back to the holder's own registered/held name rather
  // than rendering an empty anchor or an empty cell -- confirmed live on
  // 29 title pages (qa-visitor-walk-2026-08-29.md B1): a minted holder
  // whose id resolves (single-holder case, e.g. aew-hardcore-r001) rendered
  // a valid link with no text, and an unminted holder (name-only, no id,
  // e.g. iml-central-mob-r001) rendered a wholly empty cell, in both cases
  // because `r.label` was simply absent from the row, not because the
  // holder itself was unknown. `docs/SCHEMA.md` still calls `label`
  // required going forward; this is a display-side safety net for rows
  // minted before that was enforced, not a substitute for backfilling it.
  // THE RAW-ID-AS-LABEL FIX (L162, entity-pages-qa-2-2026-09-06.md ranked
  // #2): a stored `label` is trusted as the reign's own billed name UNLESS
  // it is literally one of the reign's own holder ids verbatim -- a
  // data-entry slip (a raw registry id typed into the label field instead
  // of a display name) that must never render as visible link text. Live
  // examples: cswa-world-heavyweight-c005's own label "guns-aawc" and
  // -c006's own label "steve-radder" -- both ids resolve fine in `byId`
  // (real display names "GUNS" and "Steve Radder" on file), so the id
  // itself was never the problem; the stored label field was. 11 rows
  // across 4 CSWA-family title pages carry this exact slip.
  const labelIsRawId = !!r.label && (r.holder ?? []).some((h) => h.id === r.label);
  // Registry name if the holder resolves; the holder's OWN bundled name
  // for an unminted (name-only) holder; and -- the other half of the same
  // QA finding, "a holder id whose character row lives in another wing's
  // shard or is missing" -- a plain, honest placeholder rather than a raw
  // id or a silent blank, for a holder id that resolves nowhere at all.
  // Zero live reigns hit this last case today (every co-held holder id on
  // file already resolves); kept as a defensive floor, not a guess.
  const holderDisplayName = (h) => (h.id && byId.has(h.id) ? byId.get(h.id).name : h.name) || "(record incomplete)";
  const label = (r.label && !labelIsRawId) ? r.label : (r.holder ?? []).map(holderDisplayName).join(" & ");
  if (ids.length === 1) {
    return `<a href="/characters/${esc(ids[0].id)}.html">${esc(label)}</a>${boozler}`;
  }
  const links = ids.map((h) => entityLink(h.id)).join(", ");
  const trail = links ? ` <span class="muted small">(${links})</span>` : "";
  return `${esc(label)}${trail}${boozler}`;
}
// L199 (entity-page residue sweep, 2026-09-06, ranked #4 -- 930 title
// pages carry a reign-table cell that renders as a silently blank <td>
// even when the ROW as a whole is not the fully-undated shape
// renderTitleReignsTable's own "undated" branch below already handles (a
// row with a won date and a note, but no lost date, e.g.
// 4ww-tempest.html's own "Superstar" Eddie B. and Chris Sanchez rows) --
// same discipline as reignHolderCell's own "(record incomplete)" floor
// just above: a visitor sees an honest, tooltipped placeholder, never a
// bare empty cell that reads as a table left unfinished.
function emptyCellFallback(html) {
  return html && html.trim() ? html : '<span class="muted small" title="not recorded">&mdash;</span>';
}
function renderTitleReignsTable(t, rows) {
  if (!rows.length) return "";
  const trs = rows.map((r, i) => {
    const wonShow = r.event ? showById.get(r.event) : null;
    const wonLabel = esc(dateLabel(r.won));
    const wonCell = wonShow && wonShow.page ? `<a href="${esc(wonShow.page)}">${wonLabel}</a>` : wonLabel;
    const lostShowId = lostEventByReignId.get(r.id);
    const lostShow = lostShowId ? showById.get(lostShowId) : null;
    const lostLabel = r.lost ? esc(dateLabel(r.lost)) : "";
    const lostCell = lostLabel ? (lostShow && lostShow.page ? `<a href="${esc(lostShow.page)}">${lostLabel}</a>` : lostLabel) : "";
    // servedText (entity-page QA sample, 2026-09-05, ranked defect #1): a
    // reign detail carried raw registry row ids in prose on 58 title pages
    // ("matching wwa-united-states-r015", "iml-tag-team-r001"), the literal
    // field name `end_how` with its raw enum value on 6 more, and "this
    // pass"/"enrichment pass"/"bycatch" workshop framing throughout.
    const noteText = r.note ? servedText(r.note) : "";
    const note = noteText ? `<div class="muted small">${esc(noteText)}</div>` : "";
    const conflictText = r.conflict ? servedText(r.conflict.note) : "";
    const conflict = conflictText
      ? `<div class="note"><span class="flag">Sources disagree</span>${esc(conflictText)}</div>`
      : "";
    const howText = servedText(r.how || "");
    // AN UNDATED REIGN STILL HOLDS ITS PLACE (entity-page QA sample,
    // 2026-09-05, ranked defect #8: "a title page's reign table has entirely
    // blank Won, Lost and Detail cells for most of its own rows" — 35 title
    // pages, 925 rows). There is no unread `reigns.json` shape behind this:
    // those 925 rows carry exactly four fields — id, title, label, holder —
    // and no date, no `how`, no note at all, because the fed's own served
    // title-history ledgers list a succession of names and nothing else.
    // What the data DOES hold, and what the old table threw away, is the
    // row's PLACE in that succession — the same fact the fed's own text
    // means by "the 1st XXX Champion" and the same one the labels count off
    // as "(2)", "(3)". So an otherwise-empty row states its position and
    // says plainly that no date was recorded, instead of rendering a name
    // beside three silent blanks. Computed from the RAW fields, so only the
    // rows the QA found change: a row whose only content was process
    // narration is left as it renders, not promoted into this shape.
    const undated = !wonLabel && !lostLabel && !r.how && !r.note && !r.conflict;
    const wonOut = undated ? `<span class="muted small">not recorded</span>` : emptyCellFallback(wonCell);
    const lostOut = emptyCellFallback(lostCell);
    const detailOut = undated
      ? `<span class="muted small">Reign ${i + 1} in the fed&rsquo;s own recorded succession.</span>`
      : emptyCellFallback(`${esc(howText)}${note}${conflict}`);
    return `<tr><td class="holder">${reignHolderCell(r)}</td><td class="num">${wonOut}</td><td class="num">${lostOut}</td><td>${detailOut}</td></tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="ledger"><caption>Title reigns</caption><thead><tr><th>Reign</th><th class="num">Won</th><th class="num">Lost</th><th>Detail</th></tr></thead><tbody>${trs}</tbody></table></div>`;
}
function renderTitlePlacard(t, rows) {
  const promo = promoById.get(t.promotion);
  const lines = [];
  lines.push(metaRowFragment("Promotion", promoLinkedLabel(t.promotion)));
  const span = titleYearSpan(rows);
  if (span) lines.push(metaRowFragment("Active", span));
  // THE ANNUAL CHAMPIONSHIPS WAVE (2026-08-18, the Janitor's gavel: "you can
  // include annual honors like Stable Wars, Regal Rumble, and Contest of
  // Champions under Championships, just clarifying the distinction:
  // they're championships, just annual ones") — cadence states plainly
  // whether a belt is defended on an open schedule or contested once a
  // year on a fixed one; renders for both values once set, same
  // always-renders discipline as Scale/Medium on a wing's own placard.
  if (t.cadence === "annual") lines.push(metaRowFragment("Cadence", "contested annually"));
  else if (t.cadence === "standing") lines.push(metaRowFragment("Cadence", "standing"));
  // THE TITLE-STATUS REFRAME (2026-08-18, the Janitor's gavel): the old
  // controlled-but-soft `status` field is gone — "every title is retired
  // by default if the bar for entry is a dead promotion" made the field
  // meaningless. `nature` (self-awarded, never a lifecycle state) and
  // `events[]` (dated, sourced, in-fed lifecycle events — the fed itself
  // retiring, unifying, or renaming the belt) replace it; NO event renders
  // NOTHING — no label, no narration of the default — since the reign
  // ledger already shows where a title's own record simply ends.
  if (t.nature === "self-awarded") lines.push(metaRowFragment("Nature", "self-awarded (never a sanctioned title)"));
  else if (t.nature) lines.push(metaRowFragment("Nature", esc(t.nature)));
  // PROSE-FIX-01 (2026-09-13; proposal.md #2.3) — e.note was raw esc()
  // only, the one completely unfiltered field on the Title Placard sitting
  // right next to epitaph (which IS filtered) — see leaks.md's own #3 top
  // leak. servedText() returns "" for a note that is ENTIRELY process
  // narration; verified against all 48 live rows before this patch
  // shipped, zero rows changed today (leaks.md found no live leak in this
  // field's current data), so this is preventative, not a visible change.
  for (const e of t.events ?? []) {
    const when = e.date ? esc(dateLabel(e.date)) : "";
    const target = e.title ? titleLink(e.title) : "";
    const eventNote = servedText(e.note || "");
    if (e.type === "retired_by_fed") {
      const value = [when, esc(eventNote)].filter(Boolean).join(" — ");
      lines.push(metaRowFragment("Retired by the fed", value));
    } else if (e.type === "unified_into") {
      const head = [target, when].filter(Boolean).join(" ");
      const value = [head, esc(eventNote)].filter(Boolean).join(" — ");
      lines.push(metaRowFragment("Unified into", value));
    } else if (e.type === "rename") {
      const head = [target, when].filter(Boolean).join(" ");
      const value = [head, esc(eventNote)].filter(Boolean).join(" — ");
      lines.push(metaRowFragment("Renamed", value));
    }
  }
  if (t.restarted_from) lines.push(metaRowFragment("Restarted from", titleLink(t.restarted_from)));
  const successor = successorByTitleId.get(t.id);
  if (successor) lines.push(metaRowFragment("Continues as", titleLink(successor)));
  // v124, #holders-site-links — the holder's own /titlehistory/<id> page for
  // this belt. Same closing-line placement as the character placard.
  const titleAlsoAt = linksOutRow(t);
  if (titleAlsoAt) lines.push(titleAlsoAt);
  if (!lines.length) return "";
  return `<div class="placard"><span class="placard-label">Placard</span>\n      <p class="meta">${lines.join("<br>\n      ")}</p></div>`;
}
function generateTitlePage(t, prevTitle, nextTitle) {
  const pagerHtml = pagerNav(
    "titles",
    prevTitle ? { href: `/titles/${prevTitle.id}.html`, label: prevTitle.name } : null,
    nextTitle ? { href: `/titles/${nextTitle.id}.html`, label: nextTitle.name } : null,
  );
  // THE TITLE HEADER, ONE NAME NOT TWO (entity-page QA sample, 2026-09-05,
  // ranked defect #2: "a wing's disambiguated display name is glued directly
  // onto an entity's own name with no separator" — 327 of 1,316 title pages
  // read "MAWA (Mid-Atlantic Wrestling Alliance) MAWA North American
  // Heavyweight Championship" or "FWA (1996) FWA World Heavyweight
  // Championship" in H1, breadcrumb and <title> alike). Two faults, one line:
  // the old test asked whether the title's name began with the DISAMBIGUATED
  // label ("FWA (1996)"), which a title name never does, so a title already
  // carrying its own fed's acronym got it prepended a second time; and when it
  // did prepend, it prepended the disambiguator with it.
  //
  // `titleBaseH1()` (above, by flatTitles) holds the unchanged logic: the
  // qualified `wingLabel` is used in the KICKER only, which is the one line
  // on the page whose whole job is saying which wing this is; the base `h1`
  // never carries a "(1996)" or a "(2)" of its own.
  const { h1: baseH1, wingLabel } = titleBaseH1(t);
  // THE WING-COLLISION FIX (L162, entity-pages-qa-2-2026-09-06.md regression
  // #1): where the base H1 above is not unique -- another held title renders
  // the identical name -- append the wing's own qualified label so the H1,
  // breadcrumb and browser-tab title (all three built from this one `h1`
  // below) stop reading identical. Never a nested parenthesis; a title with
  // no collision is byte-for-byte unchanged from `baseH1`.
  const h1 = (titleH1Counts.get(baseH1) ?? 0) > 1 ? `${baseH1} — ${wingLabel}` : baseH1;
  const acro = wingLabel;
  const aka = t.aka?.length ? `<p class="subtitle">aka ${t.aka.map(esc).join(", ")}</p>` : "";
  // THE HEADER-BADGE CONVENTION (REVIEW-FIXES WAVE, 2026-08-22, the Janitor):
  // where a whole SECTION is AI-authored prose, the badge sits on the
  // section header itself, not trailing the prose; inline prose with no
  // header of its own (a caption) keeps the trailing-badge shape.
  // servedText (entity-page QA sample, 2026-09-05, ranked defect #1): a title
  // epitaph is museum prose about a belt, not about the pass that read it —
  // pfwl-world-tag-team's own closed "per the RSPWF awards-ballot sig-block
  // bycatch record", naming this workshop's term for off-target sweep.
  const epitaphText = t.epitaph ? servedText(t.epitaph) : "";
  const epitaphHtml = epitaphText ? `<h2>Epitaph${aiFlag(t.epitaph_asof?.author)}</h2>\n  <p>${esc(epitaphText)}</p>` : "";
  const rows = reignsByTitle.get(t.id) ?? [];
  const placardHtml = renderTitlePlacard(t, rows);
  const notesLine = t.notes ? (() => { const v = servedText(t.notes); return v ? `<p class="muted small">${esc(v)}</p>` : ""; })() : "";
  const ledgerHtml = renderTitleReignsTable(t, rows);
  // hook c171 (adversarial review 1009, C09): 577 titles hold no reign yet; the page says so instead of ending at its placard.
  const sections = [ledgerHtml || `<p class="muted">The museum holds no reigns for this title yet.</p>`].join("\n\n  ");
  const footerLine = `THE E-WRESTLING MUSEUM <span class="rule">/</span> Championships <span class="rule">/</span> ${esc(t.name)} <span class="rule">/</span>
    <a href="/championships.html">back to championships</a><br>
    Generated 2026 from the entity registry &mdash; not backdated. See
    <a href="/curation.html">Curation</a>.`;

  const main = `<p class="crumb"><a href="/">Museum</a> &nbsp;/&nbsp; <a href="/championships.html">Championships</a> &nbsp;/&nbsp; ${esc(h1)}</p>

  <span class="kicker">Title &middot; ${esc(acro)}</span>
  <h1>${esc(h1)}</h1>
  ${aka}
  ${placardHtml}
  ${epitaphHtml}
  ${notesLine}

  ${sections}
  ${pagerHtml}`;
  return pageShell({ title: `${esc(h1)} &mdash; E-WRESTLING MUSEUM`, main, footerLine, rel: `titles/${t.id}.html` });
}

mkdirSync(resolve(ROOT, "titles"), { recursive: true });
let titlePageCount = 0;
for (let i = 0; i < flatTitles.length; i++) {
  const t = flatTitles[i];
  const prevTitle = i > 0 ? flatTitles[i - 1] : null;
  const nextTitle = i < flatTitles.length - 1 ? flatTitles[i + 1] : null;
  writeFileSync(resolve(ROOT, "titles", `${t.id}.html`), generateTitlePage(t, prevTitle, nextTitle));
  titlePageCount++;
}

// ---------------------------------------------------------------------------
// 3c. /awards/<id>.html — THE AWARD ENTITIES WAVE (2026-08-19): every
// data/awards.json row is now an award ENTITY (a promotion + award name)
// carrying a bestowals[] array, and every one gets its own generated page —
// the Janitor's own anchor, verbatim: "awards should be treated the same
// as championships: each award has its own page, which documents the
// history of that award." Structurally the same recipe as
// generateTitlePage above (same page shell, same crumb-under-its-own-
// index-page discipline), with two deliberate differences: `epitaph` is
// OPTIONAL (most awards are one bestowal with nothing more to say than the
// bestowal itself already says — a mint-only-where-the-record-supports-
// prose discipline, not a field manufactured to fill every one of a
// hundred-plus rows), and the ledger is bestowals-by-year rather than
// reigns-by-holder.
// ---------------------------------------------------------------------------
const flatAwards = [...awards].sort((a, b) => {
  const ka = sortKeyStr(a.name), kb = sortKeyStr(b.name);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
});
function bestowalHolderCell(list) {
  return (list ?? []).map((r) => (r.id ? entityLink(r.id) : esc(r.name))).join(", ");
}
// THE RANKED BESTOWAL (the RSPWF Top 200 accession, 2026-08-23): a bestowal
// may carry an optional positive-integer `rank` — a PLACE in an ordered
// field (a year-end ranked poll, a tournament's finishing order) rather than
// a single winner. A ranked bestowal renders its place beside its year
// ("#168, 1999"); a rank-less one renders exactly as it always did. An award
// carrying ANY ranked bestowal lists in rank order within each year (a
// ranked poll's own reading order is the countdown, not the array order it
// happened to be extracted in); an award with none is left in ledger order
// untouched, so no existing award's page moves.
function bestowalYearCell(b) {
  return b.rank != null ? `#${esc(String(b.rank))}, ${esc(String(b.year))}` : esc(String(b.year));
}
function orderBestowals(rows) {
  if (!rows.some((b) => b.rank != null)) return rows;
  return rows.map((b, i) => ({ b, i })).sort((x, y) => {
    const ya = x.b.year ?? Infinity, yb = y.b.year ?? Infinity;
    if (ya !== yb) return ya - yb;
    const ra = x.b.rank ?? Infinity, rb = y.b.rank ?? Infinity;
    if (ra !== rb) return ra - rb;
    return x.i - y.i;
  }).map((e) => e.b);
}
function renderAwardBestowalsTable(rows) {
  if (!rows.length) return "";
  const ranked = rows.some((b) => b.rank != null);
  const trs = orderBestowals(rows).map((b) => {
    const resultTag = b.result === "nominated" ? ` <span class="muted small">(nominated)</span>` : "";
    const runnerUp = b.runner_up?.length ? `<div class="muted small">Over ${bestowalHolderCell(b.runner_up)}</div>` : "";
    // PROSE-FIX-01 (2026-09-13; proposal.md #2.6) — sanitizeMachineryLeak()
    // alone skips the sentence-level stripProcessSentences pass every
    // other note-shaped field runs; servedText() is the full two-pass
    // pipeline. Truthiness-after-compute (renderTenuresSection's own
    // idiom) so a vote_detail that is ENTIRELY process narration renders
    // no <div> at all — 2 of 2348 live rows go empty this way (both
    // whole-note workshop citations with no other content; see
    // findings.md's render-parity test).
    const voteDetailText = b.vote_detail ? servedText(b.vote_detail) : "";
    const voteDetail = voteDetailText ? `<div class="muted small">${esc(voteDetailText)}</div>` : "";
    return `<tr><td class="num">${bestowalYearCell(b)}</td><td class="holder">${bestowalHolderCell(b.recipient)}${resultTag}</td><td>${runnerUp}${voteDetail}</td></tr>`;
  }).join("");
  const head = ranked ? "Place" : "Year";
  const caption = ranked ? "Year by year, in rank order" : "Year-by-year";
  return `<div class="table-wrap"><table class="ledger"><caption>${caption}</caption><thead><tr><th class="num">${head}</th><th>Recipient</th><th>Detail</th></tr></thead><tbody>${trs}</tbody></table></div>`;
}
function generateAwardPage(a, prevAward, nextAward) {
  const pagerHtml = pagerNav(
    "awards",
    prevAward ? { href: prevAward.page, label: prevAward.name } : null,
    nextAward ? { href: nextAward.page, label: nextAward.name } : null,
  );
  const promo = promoById.get(a.promotion);
  const acro = bareAcronym(promo) || String(a.promotion ?? "").toUpperCase();
  const h1 = a.name.toUpperCase().startsWith(acro.toUpperCase()) ? a.name : `${acro} ${a.name}`;
  // Header-badge convention — see the title page's own epitaphHtml comment.
  // PROSE-FIX-01 (2026-09-13; proposal.md #2.6) — was sanitizeMachineryLeak()
  // only (skips the sentence-level pass); now the same servedText() +
  // truthiness-after-compute idiom the title page's own epitaphHtml above
  // uses, so an award epitaph that is ENTIRELY process narration renders
  // no Epitaph section at all rather than an empty one. 1 of 53 live rows
  // changes (a trailing sentence drops; see findings.md's render-parity
  // test), zero go empty.
  const awardEpitaphText = a.epitaph ? servedText(a.epitaph) : "";
  const epitaphHtml = awardEpitaphText ? `<h2>Epitaph${aiFlag(a.epitaph_asof?.author)}</h2>\n  <p>${esc(awardEpitaphText)}</p>` : "";
  const rows = a.bestowals ?? [];
  const placardHtml = `<div class="placard"><span class="placard-label">Placard</span>\n      <p class="meta">${metaRowFragment("Promotion", promoLinkedLabel(a.promotion))}</p></div>`;
  const ledgerHtml = renderAwardBestowalsTable(rows);
  const footerLine = `THE E-WRESTLING MUSEUM <span class="rule">/</span> Awards <span class="rule">/</span> ${esc(a.name)} <span class="rule">/</span>
    <a href="/awards.html">back to awards</a><br>
    Generated 2026 from the entity registry &mdash; not backdated. See
    <a href="/curation.html">Curation</a>.`;

  const main = `<p class="crumb"><a href="/">Museum</a> &nbsp;/&nbsp; <a href="/awards.html">Awards</a> &nbsp;/&nbsp; ${esc(h1)}</p>

  <span class="kicker">Award &middot; ${esc(acro)}</span>
  <h1>${esc(h1)}</h1>
  ${placardHtml}
  ${epitaphHtml}

  ${ledgerHtml}
  ${pagerHtml}`;
  return pageShell({ title: `${esc(h1)} &mdash; E-WRESTLING MUSEUM`, main, footerLine, rel: a.page.replace(/^\//, "") });
}

mkdirSync(resolve(ROOT, "awards"), { recursive: true });
let awardPageCount = 0;
for (let i = 0; i < flatAwards.length; i++) {
  const a = flatAwards[i];
  const prevAward = i > 0 ? flatAwards[i - 1] : null;
  const nextAward = i < flatAwards.length - 1 ? flatAwards[i + 1] : null;
  writeFileSync(resolve(ROOT, a.page.replace(/^\//, "")), generateAwardPage(a, prevAward, nextAward));
  awardPageCount++;
}

// ---------------------------------------------------------------------------
// 3d. /memorials/<id>.html — THE MEMORIAL PAGES WAVE (2026-08-19): every
// data/memorials.json row gets its own generated page — the Janitor's own
// anchor, verbatim: "That's where the epitaphs should live and backlinks to
// everything we have: their characters, their RPs, their pitched feds... as
// easy as possible for someone to go to Sean and see every RP we have in
// the collection, find his pitch for BBW... every link to Sean elsewhere
// should be to his page, not to the memorial front page." The dedication
// prose itself (`note`) is relocated from in-memoriam.html's own placard
// VERBATIM, never rewritten without need (same "served pages never carry
// their own work-log" discipline as everywhere else); everything below it
// is MECHANICAL backlink aggregation off the graph — linked characters
// (with their own tenures/reigns/awards, already-computed maps below),
// essays whose own `linked.characters` names one, and three hand-curated
// arrays for the things the graph has no edge for yet: `gallery` (a
// portrait already held in `/galleries/`), `served_docs` (a raw served
// artifact — a tribute, an induction ceremony script — with no other
// structured pointer to it), and `shows` (a held show page that actually
// STAGES something memorial-relevant — a title win/loss the dedication
// itself recounts — with no other structured pointer to it). THE SHOWS
// STANDARD (the Janitor's second review round, 2026-08-22): a show qualifies
// only if the thing is FOUGHT/STAGED on that page; a mere mention,
// announcement, recap, or fan-sign reference never does. The fifteen
// Memorial Cup references once listed on Chris Williams' page all died by
// that standard — the Cup was an external interfed event, and no held
// page stages it; an empty section renders nothing, which is honest. A
// designed/pitched fed (BBW, Sean's own pitch) is a real edge:
// `promotions.json`'s `memorial_designed_by` field, checked against every
// promotion for a match on this memorial's own id.
// THE MEMORIAL REGISTER (CURATION.md v65, the Janitor's gavel): a memorial page
// carries facts, links, images, and dedication only — never process,
// provenance narration, curation machinery, or quotes from working
// conversations. Two casualties of that rule, both structural: roleplays
// are no longer LISTED here (a memorial's own character block already
// links straight to `/characters/<id>.html`, and that page carries the
// full roleplay section — the enumeration was a duplicate, not a fact);
// and `verification` (a Janitor-welcome quote plus a real-world
// verification URL) is never rendered on a served page at all — it lives
// in CURATION.md's own changelog, the RULING history, not on the memorial
// itself.
// ---------------------------------------------------------------------------
const flatMemorials = [...memorials].sort((a, b) => sortKeyStr(a.name) < sortKeyStr(b.name) ? -1 : 1);
// THE GRAPH-DERIVED CHARACTER BLOCKS (the Janitor's second review round,
// 2026-08-22): each memorial character gets its own clearly-separated
// block — a .roster-card with its own heading — instead of running
// together as one text blob, and everything inside it is derived
// MECHANICALLY from the graph at generation time: the promotion links come
// from the character's own registered tenures[] (each linked to its wing),
// the reign/award counts from the same maps every other page uses. The
// design principle: the memorial page derives from the graph so it grows
// automatically as accessions land — a new tenure or a newly-registered
// character appears on the memorial without anyone editing memorials.json
// prose.
function memorialCharacterBlock(cid) {
  const e = byId.get(cid);
  if (!e) return "";
  // hook c197 (finding A10 of the 2026-10-09 adversarial review, the Janitor's D466): ONE WING, ONE LINK. A character can
  // hold two registered tenures in the same wing (angelo-deville-pcw holds two RPW rows and two PTC rows, each with its own
  // dates), and this line used to print the wing once per row -- on a memorial page that reads as sloppiness. The tenure
  // rows themselves are not touched anywhere: only this display line dedupes, keeping each wing's first appearance.
  const promoLine = (e.tenures ?? []).length
    ? `<div class="muted small">${(e.tenures ?? []).filter((t, i, a) => a.findIndex((u) => u.promotion === t.promotion) === i).map((t) => {
        const p = promoById.get(t.promotion);
        const label = p ? acronymLabel(p) : t.promotion;
        return p && p.page ? `<a href="${esc(p.page)}">${esc(label)}</a>` : esc(label);
      }).join(", ")}</div>`
    : "";
  const reignCount = reignTotal(e.id); // THE TEAM REIGNS (hook c96)
  const reignLine = reignCount ? `<div class="muted small">${reignCount} title reign${reignCount === 1 ? "" : "s"}${reignTeamNote(e.id)}</div>` : "";
  const awardCount = (awardsByEntity.get(e.id) ?? []).length;
  const awardLine = awardCount ? `<div class="muted small">${awardCount} documented award${awardCount === 1 ? "" : "s"}</div>` : "";
  const captionLine = e.caption ? (() => { const v = servedText(e.caption); return v ? `<div class="muted small"${captionLangAttr(e, promoById.get((e.tenures ?? [])[0]?.promotion))}>${esc(v)}${captionEn(e)}</div>` : ""; })() : "";
  return `<div class="roster-card"><h3><a href="/characters/${e.id}.html">${esc(e.name)}</a></h3>${promoLine}${reignLine}${awardLine}${captionLine}</div>`;
}
function renderMemorialEssaySection(m) {
  const rows = essays.filter((e) => (e.linked?.characters ?? []).some((cid) => (m.characters ?? []).includes(cid)));
  if (!rows.length) return "";
  // hook c247: a v129 "linked" essay has no page here, only its own outbound url (esc(e.page) was "", an empty href that
  // pointed back at the memorial page itself); it links out the house way, rel="noopener nofollow".
  const items = rows.map((e) => (e.status === "linked" && e.url
    ? `<li><a href="${esc(e.url)}" rel="noopener nofollow">${esc(e.title)}</a></li>`
    : `<li><a href="${esc(e.page)}">${esc(e.title)}</a></li>`)).join("");
  return `<h2>Essays</h2><ul>${items}</ul>`;
}
function renderMemorialFedsSection(m) {
  const rows = promotions.filter((p) => p.memorial_designed_by === m.id);
  if (!rows.length) return "";
  // QA PASS (the Janitor, 2026-08-22): same roster-card blocks the Characters
  // section already uses — one card per designed promotion, caption line
  // pulled from the promotion's own placard label.
  const items = rows.map((p) => {
    const yearsLine = p.years ? `<div class="muted small">${esc(p.years)}</div>` : "";
    // PROSE-FIX-01 (2026-09-13; proposal.md #2.1) — the ONE unfiltered
    // render path for promotions.caption: every other caption render on
    // the site (memorialCharacterBlock above, entityCard, the wing page
    // itself) routes through servedText() first; this "Designed" card was
    // the sole exception, esc()'ing the raw field. Same truthiness-after-
    // compute idiom memorialCharacterBlock's own captionLine already uses,
    // so a caption that is ENTIRELY process narration renders no line at
    // all rather than an empty one.
    const captionLine = p.caption ? (() => {
      const v = servedText(p.caption);
      return v ? `<div class="muted small"${captionLangAttr(p, p)}>${esc(v)}${captionEn(p)}</div>` : "";
    })() : "";
    return `<div class="roster-card"><h3><a href="${esc(p.page)}">${esc(p.full_name || p.name)}</a></h3>${yearsLine}${captionLine}</div>`;
  }).join("\n");
  return `<h2>Designed</h2><p class="muted small">A promotion this person pitched or designed themselves, held in the collection on that strength alone.</p>\n${items}`;
}
function renderMemorialServedDocsSection(m) {
  const rows = m.served_docs ?? [];
  if (!rows.length) return "";
  const items = rows.map((d) => `<li><a href="${esc(d.page)}">${esc(d.label)}</a></li>`).join("");
  return `<h2>Served documents</h2><ul>${items}</ul>`;
}
// THE GALLERIES REMOVAL (2026-08-20, the Janitor: the standalone galleries
// entrance "suffers from main character syndrome and doesn't scale") — the
// entrance pages (/galleries/*.html) are gone; a memorial's own image(s)
// stay, unlinked from the retired "Full gallery" pointer.
// PROSE-FIX-01 (2026-09-13; proposal.md #2.5) — g.caption was raw esc()
// only; now servedText() first, same value reused for both the <img alt>
// and the <figcaption> so the two never disagree. Verified against all 12
// live rows before this patch shipped — all short and clean today, zero
// changed; preventative, matching the field's own KEEP-AUTHORED-SHORT
// verdict in findings.md.
function renderMemorialGallerySection(m) {
  const rows = m.gallery ?? [];
  if (!rows.length) return "";
  const figs = rows.map((g) => {
    const caption = servedText(g.caption);
    return `<figure><a class="shot" href="${esc(g.image)}"><img src="${esc(g.image)}" alt="${esc(caption)}" loading="lazy"></a><figcaption>${esc(caption)}</figcaption></figure>`;
  }).join("");
  return `<h2>Gallery</h2><div class="gallery-grid">${figs}</div>`;
}
// THE MEMORIAL FORUM LINK (2026-09-23, the Janitor: "should we add links to the forum accounts for Sean and Jay on memorial pages?"):
// the memorial subject's own account on a forum the museum hosts (the PTC Forum Archive). Members-only on the forum side.
function renderMemorialForumSection(m) {
  const accts = (m.forum_accounts ?? []).filter((a) => a && a.url && a.label);
  if (!accts.length) return "";
  const items = accts.map((a) => `<li><a href="${esc(a.url)}">${esc(a.label)}</a></li>`).join("\n    ");
  return `<h2>On the forum</h2>\n  <ul class="archive-list">\n    ${items}\n  </ul>`;
}

// THE MEMORIAL LINK-OUT (the Janitor, 2026-09-24, on Mike Sanzone and the living
// Empire Pro Wrestling: "We don't serve it but we should link to it"; CURATION.md
// v119, #memorial-links-out) — a living federation the dead-only rule means the
// museum will never hold, named on the memorial of someone its own community
// mourned. Three things about this render are the ruling, not styling:
//   * `rel="noopener nofollow"` — the museum sends a reader onward and passes
//     nothing else along, the same posture the no-third-party-embed rule holds
//     for the pages themselves (v112(b)).
//   * The label lives INSIDE the anchor, which is what keeps the auto-linker off
//     it: the entity/promotion passes both tokenize on tags and skip every text
//     segment inside an <a> (linkPromosInPlainSegments' own insideA counter), so
//     a living federation's name is never quietly turned into a link to a held
//     wing that merely shares it.
//   * The museum's own line names no federation — "Still online:" and nothing
//     more — so the one sentence around the links has nothing in it to link.
// The address itself is checked at the gate against the frontier's own
// verified-alive rows (registry-validate.mjs); this function renders what the
// registry holds and asserts nothing about liveness on its own.
// hook c262 (the workshop's approved memorial rewrites of 10-10, the Janitor 2026-10-10: "an outbound link to
// https://en.wikipedia.org/wiki/Daniel_Quirk on his memorial"): a REFERENCE link-out, an article about the memorial's own
// subject on a reference work, is not a living federation: it needs no frontier row (v119(b) clause 4) and renders as
// "Further reading:", never "Still online:". Clauses 1-3 still apply. Kept identical in registry-validate.mjs and cross-reference.mjs.
const MEMORIAL_REFERENCE_HOSTS = new Set(["en.wikipedia.org"]);
const isMemorialReferenceLink = (u) => { try { const x = new URL(u); return x.protocol === "https:" && MEMORIAL_REFERENCE_HOSTS.has(x.hostname.toLowerCase()) && x.pathname.startsWith("/wiki/"); } catch { return false; } };
function renderMemorialLinksOutSection(m) {
  const all = (m.links_out ?? []).filter((l) => l && l.url && l.label);
  if (!all.length) return "";
  const anchors = (ls) => ls.map((l) => `<a href="${esc(l.url)}" rel="noopener nofollow">${esc(l.label)}</a>`).join(" &middot; ");
  const links = all.filter((l) => !isMemorialReferenceLink(l.url));
  const refs = all.filter((l) => isMemorialReferenceLink(l.url));
  return [
    links.length ? `<p class="muted small">Still online: ${anchors(links)}</p>` : "",
    refs.length ? `<p class="muted small">Further reading: ${anchors(refs)}</p>` : "",
  ].filter(Boolean).join("\n  ");
}

// THE MEMORIAL NOTE'S PARAGRAPHS (hook c90, lane DEVILLE-OWN-WORDS, 2026-10-06; the Janitor's D382 on Jeffrey Ward's note:
// "The last line should just be the >=) emoji without context; anyone who knew him, knows."). A blank line in `note` ("\n\n")
// is a paragraph break, and each part renders as its own <p class="lede">, through the same servedText() and esc() the
// one-paragraph note has always taken. Two riders:
//   * a part with no letter or digit at all (a sign-off such as ">=)") carries no word for the process markers to find, and
//     servedText()'s own empty-result rule would silence it, so it is escaped and served exactly as written;
//   * the authorship flag rides the first paragraph, the museum's own words, never a sign-off quoted after them.
// A note with no blank line renders byte for byte as it did before.
function memorialNoteHtml(m) {
  const parts = typeof m.note === "string" ? m.note.split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean) : [];
  // hook c187 (the Janitor's D466; finding C02): NEVER AN AUTHORSHIP MARK WITHOUT THE SENTENCE IT LABELS. A memorial with no
  // note rendered an empty placard holding the pill alone (/memorials/steelmoose.html), which said "AI" about prose that does
  // not exist, on the museum's most tone-sensitive page type. No note, no paragraph -- and no placard (generateMemorialPage).
  if (!parts.length) return "";
  if (parts.length < 2) return `<p class="lede">${esc(servedText(m.note))}${aiFlag(m.note_author)}</p>`;
  const paras = parts.map((p) => esc(/[A-Za-z0-9]/.test(p) ? servedText(p) : p)).filter(Boolean);
  return paras.map((p, i) => `<p class="lede">${p}${i === 0 ? aiFlag(m.note_author) : ""}</p>`).join("\n    ");
}

function generateMemorialPage(m, prevM, nextM) {
  const pagerHtml = pagerNav(
    "memorials",
    prevM ? { href: `/memorials/${prevM.id}.html`, label: prevM.name } : null,
    nextM ? { href: `/memorials/${nextM.id}.html`, label: nextM.name } : null,
  );
  const charactersHtml = (m.characters ?? []).map(memorialCharacterBlock).join("\n");
  const sections = [
    renderMemorialFedsSection(m),
    renderMemorialEssaySection(m),
    renderMemorialServedDocsSection(m),
    renderMemorialForumSection(m),
    renderMemorialLinksOutSection(m),
    renderMemorialGallerySection(m),
  ].filter(Boolean).join("\n\n  ");
  const footerLine = `THE E-WRESTLING MUSEUM <span class="rule">/</span> In Memoriam <span class="rule">/</span> ${esc(m.name)} <span class="rule">/</span>
    <a href="/in-memoriam.html">back to In Memoriam</a><br>
    Written 2026 &mdash; not backdated. See <a href="/curation.html">Curation</a>.`;

  // PROSE-FIX-01 (2026-09-13; proposal.md #2.4) — m.note was raw esc() only, the museum's most tone-sensitive page type with zero
  // technical protection (leaks.md's own top leak). Verified against all 9 live rows before this patch shipped: zero changed today.
  // hook c171 (adversarial review 1009): this note rode in every memorial page's HTML as a comment; it lives here, in the builder.
  const noteHtml = memorialNoteHtml(m);   // hook c187 (finding C02): no sentence, no placard -- never a mark beside nothing
  const main = `<p class="crumb"><a href="/">Museum</a> &nbsp;/&nbsp; <a href="/in-memoriam.html">In Memoriam</a> &nbsp;/&nbsp; ${esc(m.name)}</p>

  <span class="kicker">In Memoriam</span>
  <h1>${esc(m.name)}</h1>
  <p class="subtitle">${esc(m.years)}</p>
${noteHtml ? `
  <div class="placard">
    ${noteHtml}
  </div>
` : ""}
  ${charactersHtml ? `<h2>Characters</h2>\n  ${charactersHtml}\n\n  ` : ""}${sections}
  ${pagerHtml}`;
  return pageShell({ title: `${esc(m.name)} &mdash; E-WRESTLING MUSEUM`, main, footerLine, rel: `memorials/${m.id}.html` });
}

mkdirSync(resolve(ROOT, "memorials"), { recursive: true });
let memorialPageCount = 0;
for (let i = 0; i < flatMemorials.length; i++) {
  const m = flatMemorials[i];
  const prevM = i > 0 ? flatMemorials[i - 1] : null;
  const nextM = i < flatMemorials.length - 1 ? flatMemorials[i + 1] : null;
  writeFileSync(resolve(ROOT, "memorials", `${m.id}.html`), generateMemorialPage(m, prevM, nextM));
  memorialPageCount++;
}

// ---------------------------------------------------------------------------
// THE ESSAYS REOPENED (hook c108, 2026-10-07; CURATION.md v129, #essays-reopened). The Janitor, desk D142 (2026-10-01):
// "I think we should also serve all of the published articles we previously mapped under essays; if those articles are
// still live ... then we link to the live site; if the site is down then we serve it ourselves." D169: "Okay." to the
// plan. A data/essays.json row carrying `status` is a v129 row:
//   * "linked": a live article. It is listed on essays.html as an outbound anchor (rel="noopener nofollow") to its own
//     address, with its byline, venue and date. Nothing of it is copied and it has no page here.
//   * "served": a dead article, or a paper with no other home. Its full text (`text`, verbatim) is served on
//     /essays/<id>.html: the document head, the byline and original publication, the house content notice
//     (scripts/templates/content-notice.tpl, the same file fix-content-notice.py reads), the text in the house
//     <div class="document">, and a provenance block in the house rows (Collection, Source, Document date, First
//     published, Redactions counted from the text's own markers, Served since). The page is rebuilt from the row on every
//     run, and essays/ is a verbatim artifact to the linker and the wanted scan (ARTIFACT_RE above).
// A row with no `status` (none is on file; v49 retired the four the old form held) is untouched here, and with no v129
// row on file this block writes nothing at all: essays.html stays the kept stub it has been since v49.
// ---------------------------------------------------------------------------
// hook c142 (2026-10-08; CURATION.md v130, #museum-own-essays): a THIRD class, status "own" — the museum's own writing, an
// essay the Janitor or Argyle wrote here under their own name. It renders to its own page like a served row, but carries
// none of a period document's apparatus: no content notice (that notice warns a reader about a document we did not write),
// no provenance block (there is no collection, no source of a copy and no served-since date to give), and its `html` body
// is placed as the writer wrote it. Every row also carries a `shelf`, and essays.html is one section per shelf.
// hook c253 (the GAVELS ruling log, the Janitor, chat 2026-10-10: "And yeah we should serve essays there even when they're
// already tied to wings we hold"): a FOURTH status, "wing" — an essay the museum already serves inside a wing as one of its
// documents. Its row points at that page and nothing is rendered a second time (no essays/<id>.html, no place in the pager);
// essays.html lists it on its shelf. And any row may carry `about`, the parts of the hobby it discusses, as the wings' chips.
const v129Essays = essays.filter((e) => e && (e.status === "linked" || e.status === "served" || e.status === "own" || e.status === "wing"));
let essayPageCount = 0;
if (v129Essays.length) {
  const ESSAY_FORM_LABEL = { article: "Article", paper: "Paper" };
  const ESSAY_LANG_NAME = { de: "German", es: "Spanish", fr: "French", it: "Italian", nl: "Dutch", pt: "Portuguese" };
  const essayNoticeTpl = readFileSync(resolve(ROOT, "scripts", "templates", "content-notice.tpl"), "utf8").trim();
  const essayDate = (d) => (d && typeof d === "object" ? dateLabel(d) : "");
  const essayDay = (s) => (s ? dateLabel({ date: String(s), precision: /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? "exact" : "year" }) : "");
  const essayCite = (e) => {
    const pub = [e.venue ? esc(e.venue) : "", esc(essayDate(e.published))].filter(Boolean).join(", ");
    return [e.byline ? `by ${esc(e.byline)}` : "", pub].filter(Boolean).join(" &middot; ");
  };
  // The text is plain and verbatim; the one markup it gains is the house span around a privacy marker
  // ("[redacted — a real name, per the privacy rule]"), the same span forum-serve.py writes.
  // hook c208 (the Janitor's D480, 2026-10-09: "(a) plain rename"): the marker is "[name withheld]" or
  // "[detail withheld]" and carries no category word; the older eight are still wrapped, for the transition.
  const essayTextHtml = (t) => esc(String(t ?? ""))
    .replace(/\[redacted (?:—|&mdash;) ([^\]\n]*)\]/g, (_m, why) => `<span class="redacted">[redacted &mdash; ${why}]</span>`)
    .replace(/\[(name|detail) withheld\]/g, (_m, w) => `<span class="redacted">[${w} withheld]</span>`);
  const essayKey = (e) => `${(e.published && e.published.date) || "9999"} ${String(e.title).toLowerCase()}`;
  const byEssayDate = (a, b) => (essayKey(a) < essayKey(b) ? -1 : essayKey(a) > essayKey(b) ? 1 : 0);
  // ONE LIST, NEWEST FIRST (hook c279; the Janitor, chat 2026-10-11: "For the essays, I think we should also just list them
  // all in chronological order without the headings, and the headings should become chips. And we should add the option to
  // filter on those chips. It's getting long enough to improve the machinery now" — then "Perhaps reverse chronological
  // order so my essay shows at the top by default"). The order is the DATES' own: the newest `published.date` first, ties
  // by title, and a row with no date after every dated one, by title. No row is ever pinned to the head.
  const essayDateStr = (e) => String((e.published && e.published.date) || "");
  const essayTitleKey = (e) => String(e.title ?? "").toLowerCase();
  const byEssayNewest = (a, b) => {
    const da = essayDateStr(a), db = essayDateStr(b);
    if (!da !== !db) return da ? -1 : 1;                  // every undated row after every dated one
    if (da !== db) return da < db ? 1 : -1;               // newest first
    const ta = essayTitleKey(a), tb = essayTitleKey(b);
    return ta < tb ? -1 : ta > tb ? 1 : 0;                // a tie reads by title
  };
  const servedEssays = v129Essays.filter((e) => e.status === "served").sort(byEssayDate);
  const linkedEssays = v129Essays.filter((e) => e.status === "linked").sort(byEssayDate);
  const ownEssays = v129Essays.filter((e) => e.status === "own").sort(byEssayDate);
  // THE SHELVES (hook c142; the Janitor's Site Sweep for /essays, 2026-10-08): "Replace the 'served here' and 'still
  // online' section headers with something more useful. Where it's served isn't the critical detail. Maybe more relevantly
  // academic writing vs journalism, the museum's own writing, etc." Since hook c279 a shelf is no longer a section: it is
  // a CHIP on its row, labelled with the heading its section used to print. Every row carries its own `shelf`, and
  // registry-validate.mjs holds it to this vocabulary.
  // hook c279 (the Janitor, chat 2026-10-11: "Maybe add a "review" chip as well for game reviews? I'm not sure
  // "journalism" exactly covers them"): a fifth value, `reviews` — a piece whose main purpose is to evaluate a specific
  // game or product (a video game, a tabletop RPG, a board game, a sim), a retrospective review included.
  const ESSAY_SHELVES = [["museum", "From the museum"], ["academic", "Academic writing"], ["journalism", "Journalism"], ["community", "Columns and blogs"], ["reviews", "Reviews"]];
  // LISTEN AND WATCH (hook c259; the GAVELS ruling log, the Janitor, chat 2026-10-10: "We could still link to podcasts?",
  // applied as "podcasts and other audio/video pieces about the hobby are LINKED from the Essays page in their own section,
  // never served"). A linked row whose `form` is "audio" or "video" (registry-validate holds those forms to "linked") is
  // left off its shelf and listed in that section after the shelves. Nothing of it is rendered or copied here.
  const ESSAY_MEDIA_FORMS = new Set(["audio", "video"]);
  const isEssayMedia = (e) => e.status === "linked" && ESSAY_MEDIA_FORMS.has(e.form);
  const mediaEssays = v129Essays.filter(isEssayMedia).sort(byEssayDate);
  const essaysOnShelf = (key) => v129Essays.filter((e) => e.shelf === key && !isEssayMedia(e)).sort(byEssayDate);
  // THE SHELF CHIP's own key and label (hook c279). The five shelves, plus "Listen and watch" — the heading c259's
  // audio/video section carried, which is now the shelf key those rows wear ("listen"). The labels are those headings,
  // word for word: what was a heading is a chip now, and nothing else about a row moved.
  const ESSAY_SHELF_LABEL = new Map([...ESSAY_SHELVES, ["listen", "Listen and watch"]]);
  const essayShelfKey = (e) => (isEssayMedia(e) ? "listen" : (typeof e.shelf === "string" ? e.shelf : ""));
  // THE ONE LIST (hook c279): every status row, the shelves and the audio/video rows together, newest first.
  const allEssays = [...v129Essays].sort(byEssayNewest);
  // THE ORDER, ASSERTED (hook c279). A CHECK, never a rule: it holds the list to "dated rows newest first, undated last"
  // and pins nothing, so the museum's own essay heads the list only for as long as its date is the newest one on file.
  for (let i = 1; i < allEssays.length; i++) {
    const dPrev = essayDateStr(allEssays[i - 1]), dThis = essayDateStr(allEssays[i]);
    if (!dPrev && dThis) throw new Error(`cross-reference: essays: ${allEssays[i].id} (${dThis}) sorted after an undated row (hook c279: dated rows newest first, undated last)`);
    if (dPrev && dThis && dPrev < dThis) throw new Error(`cross-reference: essays: ${allEssays[i].id} (${dThis}) sorted after ${allEssays[i - 1].id} (${dPrev}) — essays.html is one list, newest first (hook c279)`);
  }
  // The pager walks every essay page this museum serves — its own and the served ones, together — in the page's own
  // reading order, so prev/next steps down essays.html exactly as a reader reads it (hook c279: that order is newest first).
  const pageEssays = allEssays.filter((e) => e.status === "own" || e.status === "served");

  // THE ESSAYS' HOLDINGS (hook c247; the Janitor, chat 2026-10-10: "For the essays, we should link to museum holdings for
  // Feds and characters referenced in them."). A row's `linked` (registry-validate.mjs resolves every id in it) names the
  // wings, award pages, characters and units the piece itself names. essays.html prints them under the item ("In the
  // museum:") and a hosted page prints them after the piece ("Mentioned in this essay"): wings first, then award pages,
  // then characters, then units, each in the row's own order. An id that does not resolve is skipped here (the validator
  // names it). A row with no `linked` renders exactly as before; the essay's own text is never touched.
  const essayAwardById = new Map(awards.map((a) => [a.id, a]));
  const essayHoldingLinks = (e) => {
    const L = e.linked ?? {};
    const out = [];
    for (const id of L.promotions ?? []) {
      const p = promoById.get(id);
      if (p && p.page) out.push(`<a href="${esc(p.page)}">${esc(acronymLabel(p))}</a>`);
    }
    for (const id of L.awards ?? []) {
      const a = essayAwardById.get(id);
      if (!a || !a.page) continue;
      const acro = bareAcronym(promoById.get(a.promotion)) || String(a.promotion ?? "").toUpperCase();
      out.push(`<a href="${esc(a.page)}">${esc(a.name.toUpperCase().startsWith(acro.toUpperCase()) ? a.name : `${acro} ${a.name}`)}</a>`);
    }
    for (const id of [...(L.characters ?? []), ...(L.units ?? [])]) {
      const c = byId.get(id);
      if (c) out.push(`<a href="/characters/${esc(c.id)}.html">${esc(c.name)}</a>`);
    }
    return out;
  };
  const essayInMuseum = (e) => {
    const l = essayHoldingLinks(e);
    return l.length ? `<div class="muted small">In the museum: ${l.join(", ")}</div>` : "";
  };
  const essayMentioned = (e) => {
    const l = essayHoldingLinks(e);
    return l.length ? `\n  <h2>Mentioned in this essay</h2>\n  <ul>\n${l.map((a) => `    <li>${a}</li>`).join("\n")}\n  </ul>` : "";
  };

  // THE HOBBY CHIPS (hook c253; the GAVELS ruling log, the Janitor, chat 2026-10-10: "We should tag/chip the essays with what
  // parts of the hobby they talk about, consistent with how our wings are already labeled"). A row's `about` names, on the
  // wings' own axes and vocabularies (registry-validate.mjs holds every value to the promotions enum), the parts of the
  // hobby the piece discusses, several per axis. They render as the wings' own chips (wingListRow's markup, WING_*_LABELS),
  // axis by axis in the wings' order (medium, form, play, authorship), each axis in the row's own order. No `about`, no chips.
  const ESSAY_ABOUT_AXES = [["medium", WING_MEDIUM_LABELS], ["form", WING_FORM_LABELS], ["play", WING_PLAY_LABELS], ["authorship", WING_AUTHORSHIP_LABELS]];
  // A CHIP IS A FILTER (hook c279; the Janitor: "we should add the option to filter on those chips"). On essays.html every
  // chip carries the whole query it stands for in `data-q`, and js/list.js's own delegated example-token handler
  // (wireQueryTokens, the one the list pages' example chips already use) puts it in that page's search box, replacing what
  // is there. No inline handler — the validator refuses those — and the box round-trips to ?q=, so the view is linkable.
  // An essay's OWN page carries no search box, so the same chips render there without `data-q`.
  const essayQAttr = (field, v) => ` data-q="${esc(`${field}:${v}`)}"`;
  const essayAboutChips = (e, filterable) => ESSAY_ABOUT_AXES.flatMap(([axis, labels]) => (Array.isArray(e.about?.[axis]) ? e.about[axis] : [])
    .map((v) => `<span class="chip chip-${axis}" data-${axis}="${esc(v)}"${filterable ? essayQAttr(axis, v) : ""}>${esc(labels[v] || v)}</span>`)).join(" ");
  // THE SHELF CHIP (hook c279; the Janitor: "the headings should become chips"). First in the row's chip run, before the
  // hobby chips and the language chip, carrying the heading that row's section used to print.
  const essayShelfChip = (e, filterable) => {
    const k = essayShelfKey(e);
    return k ? `<span class="chip chip-shelf" data-shelf="${esc(k)}"${filterable ? essayQAttr("shelf", k) : ""}>${esc(ESSAY_SHELF_LABEL.get(k) || k)}</span>` : "";
  };
  const essayAbout = (e, tag, onRow = false) => {
    const c = [onRow ? essayShelfChip(e, true) : "", essayAboutChips(e, onRow), essayLangChip(e, onRow)].filter(Boolean).join(" "); // hook c259: the language chip after the hobby chips, as on a wing's row; hook c279: the shelf chip before both, and data-q, on a list row only
    return c ? `<${tag} class="essay-about">${c}</${tag}>` : "";
  };
  // THE LANGUAGE CHIP (hook c259; the GAVELS ruling log, the Janitor, chat 2026-10-10: "We should add a language chip on all
  // essays as well", applied as "every Essays row shows a language chip beside its hobby chips"). The row's own `language`
  // code, named from the house list the provenance block uses (scripts/fixers/fix-provenance-block.py LANG_NAMES, read out
  // of that file here, so no list of ours); a code that list does not name falls back to the wings' own chip names
  // (WING_LANGUAGE_LABELS above), then to the code. The wings' language-chip markup; every row, English ones too.
  const ESSAY_LANG_HOUSE = (() => {
    const src = readFileSync(resolve(ROOT, "scripts", "fixers", "fix-provenance-block.py"), "utf8");
    const m = src.match(/^LANG_NAMES\s*=\s*\{([^}]*)\}/m);
    if (!m) throw new Error("cross-reference: essays: LANG_NAMES not found in scripts/fixers/fix-provenance-block.py (hook c259: the essays' language chip is named from that house list)");
    return Object.fromEntries([...m[1].matchAll(/['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g)].map((x) => [x[1], x[2]]));
  })();
  const essayLangChip = (e, filterable) => (typeof e.language === "string" && e.language
    ? `<span class="chip chip-language" data-language="${esc(e.language)}"${filterable ? essayQAttr("language", e.language) : ""}>${esc(ESSAY_LANG_HOUSE[e.language] || WING_LANGUAGE_LABELS[e.language] || e.language)}</span>`
    : "");
  // AN ESSAY SERVED IN A WING (hook c253): its line on essays.html links to the wing's page and says where it serves.
  const essayServedIn = (e) => {
    if (e.status !== "wing") return "";
    const p = promotions.find((q) => typeof q.page === "string" && q.page.endsWith("/") && String(e.page ?? "").startsWith(q.page));
    return p ? ` &middot; served in the ${esc(acronymLabel(p))} wing` : "";
  };

  const generateEssayPage = (e, prevE, nextE) => {
    const pagerHtml = pagerNav(
      "essays",
      prevE ? { href: prevE.page, label: prevE.title } : null,
      nextE ? { href: nextE.page, label: nextE.title } : null,
    );
    const lang = e.language && e.language !== "en" ? e.language : "";
    const notice = essayNoticeTpl.replace("{{LANGUAGE}}", lang && ESSAY_LANG_NAME[lang] ? `, in its original ${ESSAY_LANG_NAME[lang]}` : "");
    const marks = (String(e.text ?? "").match(/\[redacted (?:—|&mdash;)|\[(?:name|detail) withheld\]/g) ?? []).length;   // hook c208 (D480): both wordings
    const src = (e.sources ?? []).find((s) => s && (s.url || s.identifier)) ?? null;
    const srcCell = src ? (src.url ? `<a href="${esc(src.url)}">${esc(src.identifier || src.url)}</a>` : esc(src.identifier)) : "";
    const docDate = e.written ? essayDay(e.written) : essayDate(e.published);
    const firstPub = [e.venue ? esc(e.venue) : "", esc(essayDate(e.published))].filter(Boolean).join(", ");
    const prov = [
      e.collection ? `  <dt>Collection</dt><dd><a href="/collections/${esc(e.collection)}.html">Accession ${esc(e.collection)}</a></dd>` : "",
      srcCell ? `  <dt>Source</dt><dd>${srcCell}</dd>` : "",
      docDate ? `  <dt>Document date</dt><dd>${esc(docDate)}</dd>` : "",
      firstPub ? `  <dt>First published</dt><dd>${firstPub}</dd>` : "",
      `  <dt>Redactions</dt><dd>${marks ? `carries ${marks} redaction${marks === 1 ? "" : "s"}` : "carries no redactions"}</dd>`,
      e.served_since ? `  <dt>Served since</dt><dd>${esc(essayDay(e.served_since))}</dd>` : "",
    ].filter(Boolean).join("\n");
    const footerLine = `THE E-WRESTLING MUSEUM <span class="rule">/</span> Essays <span class="rule">/</span> ${esc(e.title)} <span class="rule">/</span>
    <a href="/essays.html">back to Essays</a>`;
    const main = `<p class="crumb"><a href="/">Museum</a> &nbsp;/&nbsp; <a href="/essays.html">Essays</a> &nbsp;/&nbsp; ${esc(e.title)}</p>

  <span class="kicker">Essays &mdash; ${ESSAY_FORM_LABEL[e.form] ?? "Essay"}</span>
  <div class="doc-head">
    <h1>${esc(e.title)}</h1>
    ${docDate ? `<span class="doc-date">${esc(docDate)}</span>` : ""}
  </div>
  <p class="subtitle">${essayCite(e)}</p>${essayAbout(e, "p")}
  ${notice}
  <div class="document"${lang ? ` lang="${esc(lang)}"` : ""}>${essayTextHtml(e.text)}</div>
<dl class="muted small provenance" data-doc-class="column">
${prov}
</dl>${essayMentioned(e)}
  ${pagerHtml}`;
    return pageShell({ title: `${esc(e.title)} &mdash; E-WRESTLING MUSEUM`, main, footerLine, rel: e.page.replace(/^\//, "") });
  };

  // A MUSEUM-OWN ESSAY'S PAGE (hook c142; CURATION.md v130(b)). The house shell, the crumb, the kicker, the doc-head with
  // its own date, then a subtitle carrying the writer's ATTESTED byline — the same <span class="attestor-flag"> the prose
  // they write on a memorial page wears (aiFlag() above, data/attestors.json). The body is the row's own `html`, placed as
  // it was written: not escaped, no content notice above it, and the only provenance under it is one muted line saying when
  // it was written here. The Janitor's ask, 2026-10-08: "Make sure All Fantasy* curation and about all get my Janitor slug
  // and date attached, similar to the memorial entries I've written".
  // hook c154: outbound links in a museum-own essay get rel="noopener nofollow" at render, the house convention for outbound
  // links (the Janitor, 2026-10-08: "Sure add no follow to the essay links."); the row's own html stays as written.
  const generateOwnEssayPage = (e, prevE, nextE) => {
    const pagerHtml = pagerNav(
      "essays",
      prevE ? { href: prevE.page, label: prevE.title } : null,
      nextE ? { href: nextE.page, label: nextE.title } : null,
    );
    const docDate = e.written ? essayDay(e.written) : essayDate(e.published);
    const footerLine = `THE E-WRESTLING MUSEUM <span class="rule">/</span> Essays <span class="rule">/</span> ${esc(e.title)} <span class="rule">/</span>
    <a href="/essays.html">back to Essays</a>`;
    const main = `<p class="crumb"><a href="/">Museum</a> &nbsp;/&nbsp; <a href="/essays.html">Essays</a> &nbsp;/&nbsp; ${esc(e.title)}</p>

  <span class="kicker">Essays &mdash; From the museum</span>
  <div class="doc-head">
    <h1>${esc(e.title)}</h1>
    ${docDate ? `<span class="doc-date">${esc(docDate)}</span>` : ""}
  </div>
  <p class="subtitle">by <span class="attestor-flag" title="human-written, attested">${esc(e.byline)}</span>${docDate ? ` <span class="muted small">&middot; ${esc(docDate)}</span>` : ""}</p>${essayAbout(e, "p")}
  ${String(e.html ?? "").replace(/<a href="(https?:\/\/[^"]+)"(?![^>]*\brel=)/g, '<a href="$1" rel="noopener nofollow"')}
  <p class="muted small">Written here, ${esc(docDate)}.</p>${essayMentioned(e)}
  ${pagerHtml}`;
    return pageShell({ title: `${esc(e.title)} &mdash; E-WRESTLING MUSEUM`, main, footerLine, rel: e.page.replace(/^\//, "") });
  };

  mkdirSync(resolve(ROOT, "essays"), { recursive: true });
  for (let i = 0; i < pageEssays.length; i++) {
    const e = pageEssays[i];
    const prevE = pageEssays[i - 1] ?? null, nextE = pageEssays[i + 1] ?? null;
    writeFileSync(resolve(ROOT, e.page.replace(/^\//, "")), e.status === "own" ? generateOwnEssayPage(e, prevE, nextE) : generateEssayPage(e, prevE, nextE));
    essayPageCount++;
  }

  // THE ROW'S QUERY FIELDS (hook c279). essays.html is filtered by the house machinery and nothing of its own: the search
  // box runs js/query.js's field:value engine, and js/query.js's fieldsFromElement reads EVERY data-* attribute on a row
  // mechanically into that engine's {field: [values]} shape (a multi-value attribute pipe-delimited, the roster-card
  // convention). So the row carries its shelf, the four `about` axes, its language, its published year and its status —
  // and nothing here is hand-wired per field.
  const essayYear = (e) => (essayDateStr(e).match(/^\d{4}/) ?? [""])[0];
  const essayRowAttrs = (e) => {
    const k = essayShelfKey(e);
    const blob = [e.title, e.byline, e.venue, essayDate(e.published), ESSAY_SHELF_LABEL.get(k) || k].filter(Boolean).join(" | ").toLowerCase();
    const out = [`data-search="${esc(blob)}"`];
    if (k) out.push(`data-shelf="${esc(k)}"`);
    for (const [axis] of ESSAY_ABOUT_AXES) {
      const vals = Array.isArray(e.about?.[axis]) ? e.about[axis] : [];
      if (vals.length) out.push(`data-${axis}="${esc(vals.join(" | "))}"`);
    }
    if (e.language) out.push(`data-language="${esc(e.language)}"`);
    if (essayYear(e)) out.push(`data-year="${esc(essayYear(e))}"`);
    if (e.status) out.push(`data-status="${esc(e.status)}"`);
    return out.join(" ");
  };
  // An item links to its own page here (own, served) or out to where the piece stands (linked). The list does not sort by
  // where a piece is kept, so a line that leaves the museum has to say so itself — quietly, at the end of the same muted
  // run that carries the byline (hook c142).
  const essayItem = (e, href, ext) => `    <li ${essayRowAttrs(e)}><a href="${esc(href)}"${ext ? ' rel="noopener nofollow"' : ""}>${esc(e.title)}</a> <span class="muted small">&mdash; ${essayCite(e)}${isEssayMedia(e) ? ` &middot; ${esc(e.form)}` : ""}${ext ? " &middot; offsite" : ""}${essayServedIn(e)}</span>${essayAbout(e, "div", true)}${essayInMuseum(e)}</li>`; // hook c112 (D428 default 3), c142 (the shelves, offsite), c247 (In the museum), c253 (served in a wing; the hobby chips), c279 (the query fields; the shelf chip)
  // ONE LIST, NO HEADINGS (hook c279). Every row of every shelf and every audio/video row, in one <ul>, newest first.
  // What were the section headings ride the rows as shelf chips, and the two controls below filter on them.
  const essayListHtml = `<ul id="essay-list">\n${allEssays.map((e) => essayItem(e, e.status === "linked" ? e.url : e.page, e.status === "linked")).join("\n")}\n  </ul>`;
  const essaysMain = `<p class="crumb"><a href="/">Museum</a> &nbsp;/&nbsp; Essays</p>

  <span class="kicker">Essays</span>
  <h1>Essays</h1>
  <p class="lede">This is the only part of the museum that steps out of the game. It's a collection of writing <i>about</i> fantasy wrestling, rather than participating within it. Some of this is unique to this site, but most originates with outside sites; in the latter case, we provide outbound links to those sites while they remain available online. Like everything else on this site, this remains a work-in-progress; if you have any recommendations, contact us at essays[at]ewmuseum.org or through the <a href="https://forum.ewmuseum.org">forum</a>!</p>

  <p>
    <label class="label-offscreen" for="q">Search the essays</label>
    <input id="q" class="filter-input filter-input--search" type="text" placeholder="Search by title, author, publication or shelf" autocomplete="off" spellcheck="false">
    <label class="label-offscreen" for="filter">Add a filter</label>
    <input id="filter" class="filter-input" type="text" list="filter-options" placeholder="Add a filter&hellip;" autocomplete="off" spellcheck="false">
    <datalist id="filter-options"></datalist>
  </p>
  <p id="status" class="muted small" aria-live="polite">${allEssays.length.toLocaleString("en-US")} essays</p>
  <div id="fields-help"></div>
  <div id="empty-note"></div>
  ${essayListHtml}
  <script src="/js/query.js?v=7"></script>
  <script src="/js/list.js?v=14"></script>
  <script>
(function () {
  "use strict";
  // hook c279: every row above is rendered with its own query fields as data-* attributes, so this page filters with the
  // two controls every list page carries and nothing else: the search box (js/query.js's field:value engine over those
  // attributes) and the filter typeahead over it. A chip's own data-q lands in the box through js/list.js's delegated
  // example-token handler, which wireDomFilter arms here.
  MuseumList.wireDomFilter({
    items: document.querySelectorAll("#essay-list > li"),
    input: document.getElementById("q"),
    filterInput: document.getElementById("filter"),
    filterDatalist: document.getElementById("filter-options"),
    status: document.getElementById("status"),
    fieldsHelp: document.getElementById("fields-help"),
    emptyNote: document.getElementById("empty-note"),
    noun: "essay"
  });
})();
  </script>`;
  writeFileSync(resolve(ROOT, "essays.html"), pageShell({
    title: "Essays &mdash; E-WRESTLING MUSEUM",
    main: essaysMain,
    footerLine: `THE E-WRESTLING MUSEUM <span class="rule">/</span> Essays <span class="rule">/</span> <a href="/">back to the museum</a>`,
    rel: "essays.html",
  }));
  console.log(`cross-reference: essays (v129/v130): ${ownEssays.length} own page(s), ${servedEssays.length} served page(s), ${linkedEssays.length} linked, ${v129Essays.filter((e) => e.status === "wing").length} served in a wing, ${mediaEssays.length} audio/video linked; essays.html is ONE list of ${allEssays.length}, newest first, headed by ${allEssays[0] ? `${allEssays[0].id} (${essayDateStr(allEssays[0]) || "undated"})` : "(nothing)"}, on ${ESSAY_SHELVES.filter(([key]) => essaysOnShelf(key).length).length + (mediaEssays.length ? 1 : 0)} shelf chip(s).`);
}

// ---------------------------------------------------------------------------
// EXTERNAL-FIGURE PAGES (CURATION.md v78(d), the Janitor, 2026-08-24) — "The
// figure's generated page reverse-lists every portrayal across the museum —
// the one place all portrayals of a given wrestler gather, and the search
// surface for them."
//
// What this page is allowed to be is narrower than what it could be, and the
// narrowness is the point. `curation.html`'s own portrayals paragraph binds
// it: a portrayal page documents the fan-written character, never the person
// or property behind it, referenced by public persona only. So this page
// carries the registry row and nothing else — the same three or four minimal
// fields registry-validate.mjs's own EXTERNAL_ALLOWED fences
// external-figures.json down to, plus the inbound edges. It is a NODE, not a
// biography, and there is no field on it a bio could arrive through.
//
// The two inbound lists are kept apart on purpose. "Portrayed in" is v78's
// own subject — a fed staging a real professional wrestler. "Named for"
// gathers every other borrowing, which the museum has more of: a tea-advert
// chimp, a Final Fantasy villain, a nu-metal band. Merging them would let
// the page imply a fed staged Koopa Troopa the way FAW staged Lex Luger, and
// those are different claims.
// ---------------------------------------------------------------------------
function figureRosterLine(entity) {
  const promos = (entity.tenures ?? []).map((t) => promoById.get(t.promotion)).filter(Boolean);
  const promoLabel = promos.length
    ? promos.map((p) => `<a href="${esc(p.page)}">${esc(acronymLabel(p) || p.name)}</a>`).join(", ")
    : "";
  const kind = entity.type === "unit" ? "Unit" : "Character";
  return `<li><a href="/characters/${esc(entity.id)}.html">${esc(entity.name)}</a>${promoLabel ? ` <span class="muted small">&mdash; ${promoLabel}</span>` : ""} <span class="muted small">&middot; ${kind}</span></li>`;
}
// FIGURE-PAGE LEDE, WHEN THERE IS NO `note` (entity-page QA sample,
// 2026-09-05, ranked defect #9): 61 of 541 figure pages carry no `note` at
// all and so render no lede sentence. A renderer cannot invent biography a
// row doesn't hold, but every one of those 61 DOES carry at least one
// `portrays` edge with facet "portrayal" — the same edges the "Portrayed
// in" section below is built from (verified: all 61 have >=1 such row, none
// rest on a namesake-only edge). So: derive a plain fact from those edges —
// which characters, in which wings, portray this figure — rather than
// leaving the page with nothing between its H1 and its Placard.
function figurePortraysLede(portrayals) {
  if (!portrayals.length) return "";
  if (portrayals.length > FIGURE_GROUP_MIN) return figurePortrayalSummary(portrayals, true); // hook c113: no run-on of every wing and name
  const wings = new Set();
  const names = new Set();
  for (const r of portrayals) {
    names.add(r.entity.name);
    for (const t of r.entity.tenures ?? []) {
      const p = promoById.get(t.promotion);
      if (p) wings.add(acronymLabel(p) || p.name);
    }
  }
  const wingList = [...wings].sort((a, b) => a.localeCompare(b));
  const nameList = [...names].sort((a, b) => a.localeCompare(b));
  if (!wingList.length) return `Portrayed as ${nameList.join(", ")}.`;
  return `Portrayed in ${wingList.join(", ")} as ${nameList.join(", ")}.`;
}
// Oxford "and": "A", "A and B", "A, B and C" -- the shape the task's own
// corrected examples use, and the one other multi-item join in this file
// (figurePortraysLede above) does NOT need, since it lists names/wings as a
// flat comma run rather than a final clause. Used only by
// resolvedFigureNote() below.
function joinOxfordAnd(list) {
  if (list.length <= 1) return list.join("");
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}
// THE AUTO-GENERATED PORTRAYAL-NOTE TEMPLATE (L162, entity-pages-qa-2-
// 2026-09-06 regression #2): a prior pass wrote `external-figures.json`'s
// own `note` field, for a figure that had none, using the fixed template
// "The real professional wrestler, staged under this ring name by X." --
// X being whichever ONE promotion using the figure's own exact ring name
// sorted first alphabetically, even where more than one promotion's own
// character carries the identical name. Recognising the template's own
// exact shape and recomputing its promotion list from the live
// `portrays[]` graph -- rather than editing the stored field, which is
// data this lane does not touch -- fixes the 5 of 14 pages where the
// stored list under-counts, and returns every other page's own stored
// text completely unchanged (see this function's own docstring at the top
// of this file's L162 edit for the full count).
function resolvedFigureNote(f, portrayals) {
  if (!f.note || !AUTO_PORTRAYAL_NOTE_RE.test(f.note)) return f.note;
  const matching = portrayals.filter((r) => r.entity.name === f.name);
  const wings = new Set();
  for (const r of matching) {
    for (const t of r.entity.tenures ?? []) {
      const p = promoById.get(t.promotion);
      if (p) wings.add(acronymLabel(p) || p.name);
    }
  }
  const wingList = [...wings].sort((a, b) => a.localeCompare(b));
  // Only ONE promotion (or none resolvable) -- the stored text already
  // credits the whole set correctly (or there's nothing to recompute from);
  // leave it byte-for-byte as authored rather than reformatting text that
  // was never wrong.
  if (wingList.length <= 1) return f.note;
  return `The real professional wrestler, staged under this ring name by ${joinOxfordAnd(wingList)}.`;
}
// THE FIGURE PAGE HOLDS EVERY PORTRAYAL, BY ERA (hook c113, 2026-10-07; the
// Janitor's ask at the character index above, "over time there would
// presumably be 1000 depictions of Austin"). With the character index listing
// a portrayed person once, this page is where each promotion's portrayal is
// listed: its character, the promotion that staged it and the years it was
// seen. Up to FIGURE_GROUP_MIN portrayals it is one list, oldest first (an
// undated portrayal files by its promotion's own first year). Past
// that it is grouped by decade (oldest first; "Undated" last), with a line of
// decade links and counts, and a small inline script offers the same list
// "by promotion" (grouped by the promotion's initial) — without the script
// the page reads complete, by decade. Every item carries its sort keys
// (data-y, data-p), so the script never re-derives one. Namesakes ("Named
// for") are unchanged.
const FIGURE_GROUP_MIN = 10;
function figurePortrayalItem(r) {
  const e = r.entity;
  const span = entityYearSpan(e);
  const promos = [...new Set((e.tenures ?? []).map((t) => t.promotion))].map((pid) => promoById.get(pid)).filter(Boolean);
  const promoLabel = promos.map((p) => `<a href="${esc(p.page)}">${esc(acronymLabel(p) || p.name)}</a>`).join(", ");
  const promoKey = promos.length ? sortKeyStr(acronymLabel(promos[0]) || promos[0].name) : "";
  // The era a portrayal files under: its own first year seen, else its promotion's own first year (the year the
  // promotion's label already shows), else Undated. Only a year the portrayal itself was seen is ever displayed.
  const era = span ? span[0] : (promos.length ? (firstYear(promos[0].years) ?? "") : "");
  const years = span ? (span[0] === span[1] ? span[0] : `${span[0]}–${span[1]}`) : "";
  const tail = [promoLabel, years ? esc(years) : "", e.type === "unit" ? "Unit" : ""].filter(Boolean).join(" &middot; ");
  return {
    y: era, p: promoKey, name: e.name,
    html: `<li data-y="${era}" data-p="${esc(promoKey)}"><a href="/characters/${esc(e.id)}.html">${esc(e.name)}</a>${tail ? ` <span class="muted small">&mdash; ${tail}</span>` : ""}</li>`,
  };
}
function figurePortrayalSummary(portrayals, asLede) {
  const promos = new Set(), ys = [];
  for (const r of portrayals) {
    for (const t of r.entity.tenures ?? []) if (promoById.has(t.promotion)) promos.add(t.promotion);
    const s = entityYearSpan(r.entity);
    if (s) ys.push(...s);
  }
  const n = portrayals.length, pn = promos.size;
  const span = ys.length ? (() => { const a = ys.reduce((x, y) => (y < x ? y : x)), b = ys.reduce((x, y) => (y > x ? y : x)); return a === b ? a : `${a}\u2013${b}`; })() : "";
  const inP = pn ? ` in ${pn} promotion${pn === 1 ? "" : "s"}` : "";
  return asLede
    ? `Portrayed${inP || ` ${n} time${n === 1 ? "" : "s"}`}${span ? `, ${span}` : ""}.`
    : `${n} portrayal${n === 1 ? "" : "s"}${inP}${span ? `, ${span}` : ""}.`;
}
function renderFigurePortrayalsSection(portrayals, lede) {
  if (!portrayals.length) return "";
  const items = portrayals.map(figurePortrayalItem).sort((a, b) => {
    const ya = a.y || "9999", yb = b.y || "9999";
    if (ya !== yb) return ya < yb ? -1 : 1;
    if (a.p !== b.p) return a.p < b.p ? -1 : 1;
    const ka = sortKeyStr(a.name), kb = sortKeyStr(b.name);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const head = `<h2>Portrayed in</h2>
  <p class="muted small">${esc(figurePortrayalSummary(portrayals, false))} ${lede}</p>`;
  if (items.length <= FIGURE_GROUP_MIN) return `${head}
  <ul class="archive-list">${items.map((it) => it.html).join("")}</ul>`;
  const groups = new Map();
  for (const it of items) {
    const k = it.y ? `${it.y.slice(0, 3)}0s` : "Undated";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const slug = (k) => `portrayals-${k.toLowerCase()}`;
  const nav = [...groups.entries()].map(([k, list]) => `<a href="#${slug(k)}">${k}</a> (${list.length})`).join(" &middot; ");
  const body = [...groups.entries()].map(([k, list]) => `<h3 id="${slug(k)}">${k} <span class="muted small">(${list.length})</span></h3>
  <ul class="archive-list">${list.map((it) => it.html).join("")}</ul>`).join("\n  ");
  return `${head}
  <div id="portrayals">
  <p class="muted small figure-sort" hidden>Order: <span data-sort="year">by year</span> &middot; <button type="button" class="query-chip" data-sort="promotion">by promotion</button></p>
  <div class="portrayal-groups">
  <p class="muted small">${nav}</p>
  ${body}
  </div>
  </div>
  <script>
(function () {
  var w = document.getElementById("portrayals"), bar = w && w.querySelector(".figure-sort"), g = w && w.querySelector(".portrayal-groups");
  if (!bar || !g) return;
  var items = [].slice.call(g.querySelectorAll("li[data-y]"));
  function key(li, by) { if (by === "year") { var y = li.getAttribute("data-y"); return y ? y.slice(0, 3) + "0s" : "Undated"; } var c = (li.getAttribute("data-p") || "").charAt(0).toUpperCase(); return /[A-Z]/.test(c) ? c : "#"; }
  function render(by) {
    var list = items.slice();
    if (by === "promotion") list.sort(function (a, b) { var x = a.getAttribute("data-p") || "~", z = b.getAttribute("data-p") || "~"; return x < z ? -1 : x > z ? 1 : 0; });
    var order = [], groups = {};
    list.forEach(function (li) { var k = key(li, by); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(li); });
    if (by === "promotion") order.sort(function (a, b) { return a === "#" ? 1 : b === "#" ? -1 : a < b ? -1 : a > b ? 1 : 0; });
    g.textContent = "";
    var nav = document.createElement("p"); nav.className = "muted small"; g.appendChild(nav);
    order.forEach(function (k, i) {
      var id = "portrayals-" + (by === "year" ? k.toLowerCase() : "p-" + (k === "#" ? "other" : k.toLowerCase()));
      if (i) nav.appendChild(document.createTextNode(" · "));
      var a = document.createElement("a"); a.href = "#" + id; a.textContent = k; nav.appendChild(a);
      nav.appendChild(document.createTextNode(" (" + groups[k].length + ")"));
      var h = document.createElement("h3"); h.id = id; h.textContent = k + " ";
      var c = document.createElement("span"); c.className = "muted small"; c.textContent = "(" + groups[k].length + ")"; h.appendChild(c);
      var ul = document.createElement("ul"); ul.className = "archive-list";
      groups[k].forEach(function (li) { ul.appendChild(li); });
      g.appendChild(h); g.appendChild(ul);
    });
    [].slice.call(bar.querySelectorAll("[data-sort]")).forEach(function (el) {
      var on = el.getAttribute("data-sort") === by, label = "by " + el.getAttribute("data-sort"), n;
      if (on && el.tagName === "BUTTON") { n = document.createElement("span"); n.setAttribute("data-sort", el.getAttribute("data-sort")); n.textContent = label; el.replaceWith(n); }
      else if (!on && el.tagName !== "BUTTON") { n = document.createElement("button"); n.type = "button"; n.className = "query-chip"; n.setAttribute("data-sort", el.getAttribute("data-sort")); n.textContent = label; el.replaceWith(n); }
    });
  }
  bar.addEventListener("click", function (ev) { var b = ev.target.closest("button[data-sort]"); if (b) render(b.getAttribute("data-sort")); });
  bar.hidden = false;
})();
  </script>`;
}
function renderFigureInboundSection(heading, rows, lede) {
  if (!rows.length) return "";
  const sorted = [...rows].sort((a, b) => sortKeyStr(a.entity.name).localeCompare(sortKeyStr(b.entity.name)));
  return `<h2>${heading}</h2>
  <p class="muted small">${lede}</p>
  <ul class="archive-list">${sorted.map((r) => figureRosterLine(r.entity)).join("")}</ul>`;
}
function generateFigurePage(f, prevF, nextF) {
  const rows = portrayedBy.get(f.id) ?? [];
  const portrayals = rows.filter((r) => r.facet === "portrayal");
  const namesakes = rows.filter((r) => r.facet !== "portrayal");
  // hook c101: a real promotion's page carries its names and span (the row's
  // own fields, nothing more) and the wings that portray it.
  const isRealPromotion = f.type === "real-promotion";
  const wings = [...(wingPortrayalsByFigure.get(f.id) ?? [])].sort((a, b) => sortKeyStr(a.name).localeCompare(sortKeyStr(b.name)));
  const placardLines = [
    metaRowFragment("Kind", esc(FIGURE_TYPE_LABEL[f.type] ?? f.type)),
    isRealPromotion && Array.isArray(f.aka) && f.aka.length ? metaRowFragment("Also known as", f.aka.map(esc).join(", ")) : null,
    isRealPromotion && f.years ? metaRowFragment("Years", esc(f.years)) : null,
    f.source ? metaRowFragment("From", esc(f.source)) : null,
    f.provenance ? metaRowFragment("Provenance", esc(f.provenance)) : null,
  ].filter(Boolean);
  const placard = `<div class="placard"><span class="placard-label">Placard</span>
      <p class="meta">${placardLines.join("<br>\n      ")}</p></div>`;
  const sections = [
    renderFigurePortrayalsSection( // hook c113: by era, sortable; renderFigurePortrayalsSection above
      portrayals,
      "Each of these is a separate character, staged by a separate promotion. They share this record and nothing else &mdash; one fed&rsquo;s portrayal of a wrestler is never another fed&rsquo;s.",
    ),
    renderFigureInboundSection(
      "Named for",
      namesakes,
      "Characters whose ring names derive from this record without staging it as a portrayal.",
    ),
    // THE WINGS THAT PORTRAY A REAL PROMOTION (hook c101; desk D400/D406): a
    // third list, apart from the two character lists, because a fan
    // federation staging a company is a different claim from a character
    // staging a person. Each is its own wing (v128 (c)): never the real
    // company, and never merged with another wing on the name they share.
    wings.length
      ? `<h2>Portrayed by</h2>
  <p class="muted small">Fan federations whose own fiction portrays this promotion. Each is its own wing: none is the real company, and none is another.</p>
  <ul class="archive-list">${wings.map((p) => `<li><a href="${esc(p.page)}">${esc(p.name)}</a>${p.years ? ` <span class="muted small">&mdash; ${esc(p.years)}</span>` : ""}</li>`).join("")}</ul>`
      : "",
  ].filter(Boolean).join("\n\n  ");
  const pagerHtml = pagerNav(
    "figures",
    prevF ? { href: `/figures/${prevF.id}.html`, label: prevF.name } : null,
    nextF ? { href: `/figures/${nextF.id}.html`, label: nextF.name } : null,
  );
  const footerLine = `THE E-WRESTLING MUSEUM <span class="rule">/</span> External figures <span class="rule">/</span> ${esc(f.name)}<br>
    Written 2026 &mdash; not backdated. See <a href="/curation.html">Curation</a>.`;
  const main = `<p class="crumb"><a href="/">Museum</a> &nbsp;/&nbsp; ${isRealPromotion ? `<a href="/promotions.html">Wings</a>` : `<a href="/characters.html">Characters</a>`} &nbsp;/&nbsp; ${esc(f.name)}</p>

  <span class="kicker">External figure</span>
  <h1>${esc(f.name)}</h1>
  ${f.note ? (() => { const v = servedText(resolvedFigureNote(f, portrayals)); return v ? `<p class="lede">${esc(v)}</p>` : ""; })() : (() => { const v = figurePortraysLede(portrayals); return v ? `<p class="lede">${esc(v)}</p>` : ""; })()}
  ${placard}

  ${sections}
  ${pagerHtml}`;
  return pageShell({ title: `${esc(f.name)} &mdash; E-WRESTLING MUSEUM`, main, footerLine, rel: `figures/${f.id}.html` });
}
const figurePages = externalFigures
  .filter((f) => figurePageIds.has(f.id))
  .sort((a, b) => sortKeyStr(a.name).localeCompare(sortKeyStr(b.name)));
mkdirSync(resolve(ROOT, "figures"), { recursive: true });
let figurePageCount = 0;
for (let i = 0; i < figurePages.length; i++) {
  writeFileSync(
    resolve(ROOT, "figures", `${figurePages[i].id}.html`),
    generateFigurePage(figurePages[i], figurePages[i - 1] ?? null, figurePages[i + 1] ?? null),
  );
  figurePageCount++;
}
// A figure page that stops being pointed at stops existing — the same
// stale-generated-page discipline every other generated directory here keeps.
for (const name of readdirSync(resolve(ROOT, "figures"))) {
  if (!name.endsWith(".html")) continue;
  if (!figurePageIds.has(name.replace(/\.html$/, ""))) {
    unlinkSync(resolve(ROOT, "figures", name));
  }
}

// ---------------------------------------------------------------------------
// 4. data/wanted.json — capitalized proper-noun-ish bigrams/names seen in
//    curated prose that match no registry entity. Heuristic, hand-filterable.
// ---------------------------------------------------------------------------
// Nav/header/footer/breadcrumb boilerplate repeats on every page and drowns
// out real hits — cut it before scanning, same as the linker does for footer.
function stripBoilerplate(mainHtml) {
  return mainHtml
    .replace(/<header[\s\S]*?<\/header>/, "")
    .replace(/<nav[\s\S]*?<\/nav>/g, "")
    // ATTRIBUTE-TOLERANT (v112(a), 2026-09-05): both carry lang="en" on a
    // page whose own language is not English; unwidened, this would stop
    // cutting the museum's own boilerplate out of a foreign wing's pages and
    // hand the name-scanner a header full of false candidates.
    .replace(/<p class="crumb"[^>]*>[\s\S]*?<\/p>/, "")
    .replace(/<footer\b[^>]*>[\s\S]*<\/footer>/, "");
}
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (ARTIFACT_RE.test(rel) || rel === "characters.html" || rel === "curation.html") continue;
  const html = readFileSync(file, "utf8");
  // c57: the wanted scan reads the page, STOP, EXCLUDE_NAMES/EXCLUDE_LINKS
  // (this file) and nameIndex's own key set, and writes nothing — so the
  // same bytes plus no moved name means the same candidates.  (Reusing the
  // moved-name set here is deliberately coarse: it is a superset of the key
  // set this pass actually depends on, which can only cost a re-scan.)
  const xwHash = XREF_NO_MANIFEST ? "" : xsha1(html);
  xWalkedWanted++;
  if (XINC) {
    const prev = xPrev.wanted[rel] ?? null;
    let ok = Boolean(prev) && prev.h === xwHash;
    if (ok) for (const n of xDelta) if (html.includes(n)) { ok = false; break; }
    if (ok) {
      const pageHref = "/" + rel.replace(/index\.html$/, "");
      for (const cand of prev.c) {
        const set = wantedHits.get(cand) ?? new Set();
        set.add(pageHref);
        wantedHits.set(cand, set);
      }
      xWanted[rel] = prev;
      xReusedWanted++;
      continue;
    }
  }
  const xwCands = [];
  const mainMatch = html.match(/<main[^>]*>[\s\S]*<\/main>/);
  if (!mainMatch) {
    if (!XREF_NO_MANIFEST) xWanted[rel] = { h: xwHash, c: [] };
    continue;
  }
  const text = stripBoilerplate(mainMatch[0])
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, " ") // already-linked (incl. entity links) — not wanted
    .replace(/<[^>]+>/g, " ")
    .replace(/&mdash;|&ndash;/g, "-").replace(/&rsquo;|&lsquo;/g, "'").replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " "); // collapse all whitespace/newlines to single spaces FIRST
  // 2–3 title-case words, optionally joined by a lowercase connector; must
  // not itself start a sentence after terminal punctuation (crude but cuts a
  // lot of false starts) and must contain a lowercase letter somewhere (cuts
  // ALL-CAPS shout text like "LIVE~!").
  const re = /\b[A-Z][a-z']+(?:\s+(?:the|of|de|van|a)\s+[A-Z][a-z']+|\s+[A-Z][a-z']+){1,2}\b/g;
  let m;
  while ((m = re.exec(text))) {
    const cand = m[0].trim();
    if (STOP.has(cand)) continue;
    if (nameIndex.has(cand)) continue;
    if (EXCLUDE_NAMES.has(cand)) continue;
    // Coordinator, 2026-09-02 (guard-batch-2026-09-02.md item A finding 1e):
    // this loop never consulted excludedOnPage — the same {page, name}
    // EXCLUDE_LINKS scoping the ordinary link pass already honours — so a
    // sitewide fed-name/tagline collision (NAWF's own name containing "New
    // Age") had no scoped instrument to clear it without also dropping the
    // genuine /titles/faw-tag-team.html hit a sitewide bar would destroy.
    if (excludedOnPage(rel, cand)) continue;
    if (/^(The|A|An)\s+\S+$/.test(cand)) continue; // two-word "The X" generic phrases — too noisy to be useful
    const set = wantedHits.get(cand) ?? new Set();
    set.add("/" + rel.replace(/index\.html$/, ""));
    wantedHits.set(cand, set);
    if (!xwCands.includes(cand)) xwCands.push(cand);
  }
  if (!XREF_NO_MANIFEST) xWanted[rel] = { h: xwHash, c: xwCands };
}
if (XINC) console.log(`cross-reference: incremental wanted scan — ${xReusedWanted}/${xWalkedWanted} pages reused unchanged.`);
// 2026-09-20 (cycle 149 gate red): a wanted row is a NAME TO IDENTIFY, never a person — any candidate carrying a
// redaction-ledger deny term (word-bounded, case-insensitive) is dropped before the file is written, so the
// generated list can never re-collect a ledgered real name off an in-fiction page and red the gate. The ledger
// is resolved the way privacy-check.mjs resolves it (PRIVACY_LEDGER, then WORKSHOP_ROOT, then ../archive).
const _ledgerPath = process.env.PRIVACY_LEDGER
  || (process.env.WORKSHOP_ROOT ? resolve(process.env.WORKSHOP_ROOT, "privacy", "redaction-ledger.tsv") : resolve(ROOT, "..", "archive", "privacy", "redaction-ledger.tsv"));
let _denyRe = null;
try {
  const terms = readFileSync(_ledgerPath, "utf8").split("\n").map((l) => l.split("\t")).filter((c) => c.length >= 3 && c[2] === "deny" && c[0].trim().length >= 4).map((c) => c[0].trim());
  if (terms.length) _denyRe = new RegExp("(?<![A-Za-z])(?:" + [...new Set(terms)].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(?![A-Za-z])", "i");
} catch (e) { console.warn(`cross-reference: ledger not read (${e.message}) — wanted list unfiltered`); }
let _wantedDropped = 0;
const wanted = [...wantedHits.entries()]
  .filter(([name]) => { if (_denyRe && _denyRe.test(name)) { _wantedDropped++; return false; } return true; })
  .map(([name, pages]) => ({ name, seen_on: [...pages] }))
  .sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(resolve(DATA, "wanted.json"), JSON.stringify({ _schema_version: 1, wanted }, null, 2));
if (_wantedDropped) console.log(`cross-reference: wanted list dropped ${_wantedDropped} ledgered name(s)`);


// ---------------------------------------------------------------------------
// THE FRONTIER QUEUE's connection-density bake (the Janitor's ranking,
// 2026-08-22: memorial > founding year > connection density): for every
// frontier row, count how many held-registry prose fields mention its name
// — the mechanical proxy for how hard the held graph is already pointing
// at it. Baked to data/frontier-index.json; frontier.html ranks with it.
// ---------------------------------------------------------------------------
{
  const frontierPath = resolve(DATA, "frontier.json");
  if (existsSync(frontierPath)) {
    const frontierRows = (JSON.parse(readFileSync(frontierPath, "utf8")).rows ?? []);
    const blobs = [];
    const push = (v) => { if (typeof v === "string" && v) blobs.push(v.toLowerCase()); };
    for (const e of [...characters, ...units]) {
      push(e.caption); push(e.notes);
      for (const t of e.tenures ?? []) { push(t.role); push(t.note); push(t.source); }
    }
    for (const sh of shows) { push(sh.notes); for (const m of sh.matches ?? []) push(m.note); }
    const bigBlob = blobs.join("\n");
    const index = frontierRows.map((r) => {
      const name = String(r.name || "").toLowerCase();
      let count = 0;
      if (name.length >= 3 && bigBlob.includes(name)) {
        const re = new RegExp(`(?<![a-z0-9])${name.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "g");
        count = (bigBlob.match(re) || []).length;
      }
      return { name: r.name, connections: count };
    });
    writeFileSync(resolve(DATA, "frontier-index.json"), JSON.stringify({ _schema_version: 1, frontier_index: index }, null, 2) + "\n");
    console.log(`cross-reference: frontier-index — ${index.filter((x) => x.connections > 0).length}/${index.length} rows with held-graph mentions.`);
  }
}

// ---------------------------------------------------------------------------
// PER-PROMOTION HOLDINGS REGISTERS (the orphan-audit fix, 2026-08-22; the
// THE JANITOR'S HOLDINGS AUDIT, 2026-09-13). A disk-derived register of every
// served document under a promotion's own archive/ and rp/ directories.
// Derived from DISK, not the registry, so a served file cannot exist
// unlisted — the completeness fallback for documents, the same role the A-Z
// and year registers play for entities and events. The Janitor's galleries
// lesson: a page nobody can reach is a page that serves nobody.
//
// THE 2026-09-13 REWRITE (the Janitor gavel, verbatim): the old register (a)
// titled an entry from the FIRST segment of its own <title>, which is
// always the wing's own name/acronym repeated as a prefix — a document
// whose <title> read "NCCW &mdash; Battle in Seattle results &mdash; NCCW
// &mdash; E-WRESTLING MUSEUM" served as the bare word "NCCW", discarding
// the one descriptive segment that made the title worth reading; and (b)
// grouped only by which disk folder a file happened to live in (archive/
// vs rp/), then split an oversized folder into alphabetical-by-FILENAME
// chunks — so a wing whose earliest filenames happened to be its own
// newsgroup-creation paperwork (RSPW-F's CFV/RFD posts) rendered a chunk
// heading naming that paperwork as if it were the group's own organising
// principle, when the chunk boundary was pure alphabetical accident and the
// 380 documents inside were of every kind the wing ever served. Fixed here:
// title comes from the document's OWN descriptive title (h1 first, since
// essentially every served page carries one; the <title> with the wing's
// own name/acronym and the site suffix stripped out as a second try; the
// matching shows.json/rps.json registry row's own name/title as a third;
// the bare filename only if nothing else yields text — never the bare wing
// name/acronym on its own). Grouping is by DOCUMENT CLASS (the same
// data-doc-class the provenance paragraph already carries on every served
// page — cards/results, roleplays, newsletters/news, rules, staff/roster,
// columns, boards, other), ordered by date within a class (undated last),
// never by an accession lot, workshop wave, or the order files happen to
// sit on disk. Same shell/markup the /shows/<year>/ no-JS registers already
// use elsewhere on the site: a "when" span ahead of each entry's link,
// muted small print for the per-group counts.
// ---------------------------------------------------------------------------
{
  const titleRe = /<title>([^<]*)/;
  const h1Re = /<h1[^>]*>([^<]*)<\/h1>/;
  const docClassRe = /data-doc-class\s*=\s*"([^"]+)"/i;
  // hook c189 (the Janitor's D466): a wing's own document register reads like the lists it feeds -- the month spelled out.
  const months = ["", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  // Registry rows carry a real name and a real (if sometimes imprecise)
  // date for the documents they cover — a card's own show row, a
  // roleplay's own rps row — keyed here by the site-relative path the
  // register already uses to link the served file, so a disk file matches
  // its row (if any) by nothing but the URL it's served at.
  const showByPage = new Map();
  for (const s of shows) if (s.page) showByPage.set(s.page, s);
  const rpByPage = new Map();
  for (const r of rps) if (r.served_url) rpByPage.set(r.served_url, r);
  // Raw data-doc-class value -> the group it renders under. Anything absent
  // or unrecognised (17 live files carry no data-doc-class at all) falls to
  // "other" rather than being dropped — a disk-derived register cannot
  // afford to silently drop a served file.
  const CLASS_GROUP = {
    charter: "charter", card: "cards", rp: "roleplays", roleplay: "roleplays", news: "news",
    poll: "polls", faq: "faqs", rules: "rules",
    staff: "staff", roster: "staff", column: "columns", board: "boards",
    other: "other", "machine-translation": "other",
  };
  // 2026-09-13 (RSPWF re-classing): the newsgroup's own creation postings, its polls/awards and its guides
  // are their own kinds of document; classifieds live on the boards row and the label says so.
  // "joint" is last and is the ONE group whose entries are not this wing's own
  // files: JOINT-WING SHOWS (v121(c)) — a pointer to a night this wing staged
  // and another wing holds. It never touches docCount, so the register's
  // disk-derived count stays exactly what the shelf says (v121(d)).
  const GROUP_ORDER = ["charter", "cards", "roleplays", "news", "polls", "faqs", "rules", "staff", "columns", "boards", "other", "joint"];
  const GROUP_LABEL = {
    charter: "Newsgroup charter &amp; votes", cards: "Cards &amp; results", roleplays: "Roleplays",
    news: "Newsletters &amp; news", polls: "Polls &amp; awards", faqs: "FAQs &amp; guides",
    rules: "Rules", staff: "Staff &amp; roster", columns: "Columns",
    boards: "Boards &amp; classifieds", other: "Other",
    joint: "Jointly staged, held on another wing",
  };
  // Undated sorts last, exactly like DATE_SORT_LAST already does for every
  // other date-ordered register on the site; a partial (year- or
  // month-only) date pads its missing places the same way rather than
  // sorting ahead of same-year documents that happen to carry a fuller one.
  const dateSortKey = (raw) => {
    if (!raw) return DATE_SORT_LAST;
    const parts = String(raw).split("-");
    return `${parts[0] || "9999"}-${(parts[1] || "99").padStart(2, "0")}-${(parts[2] || "99").padStart(2, "0")}`;
  };
  const humanDate = (raw) => {
    if (!raw) return "";
    const parts = String(raw).split("-");
    const y = parts[0], mo = parts[1] ? parseInt(parts[1], 10) : null, d = parts[2] ? parseInt(parts[2], 10) : null;
    if (!y || y === "9999") return "";
    if (mo && d) return `${d} ${months[mo]} ${y}`;
    if (mo) return `${months[mo]} ${y}`;
    return y;
  };
  // The filename-embedded date every dated document on this site already
  // names itself with (...-1999-08-07.html, ...-2003-08.html) — the
  // fallback once a file matches no shows/rps row (news, rules, staff,
  // column and board documents never get one).
  const filenameDate = (f) => {
    const m = f.match(/(\d{4})-(\d{2})-(\d{2})/) || f.match(/(\d{4})-(\d{2})(?!\d)/) || f.match(/(?<!\d)(\d{4})(?!\d)/);
    return m ? m.slice(1).join("-") : null;
  };
  const stripTitleChrome = (raw, promo) => {
    const promoNames = new Set([promo.name, promo.id].filter(Boolean).map((s) => String(s).toLowerCase()));
    const t = raw.replace(/\s*&mdash;\s*E-WRESTLING MUSEUM\s*$/i, "").trim();
    return t.split(/\s*&mdash;\s*/)
      .map((s) => s.trim())
      .filter((s) => s && !promoNames.has(s.toLowerCase()))
      .join(" — ")
      .trim();
  };
  let holdingsPages = 0;
  for (const promo of promotions) {
    const pdir = resolve(ROOT, "promotions", promo.id);
    if (!existsSync(pdir)) continue;
    const subFiles = new Map();
    // 2026-09-23 (preflight 171: 1,019 PCW newswire pages unreachable): a wing's served news/ folder is on its register too
    for (const sub of ["archive", "rp", "news"]) {
      const d = resolve(pdir, sub);
      if (!existsSync(d)) continue;
      const files = readdirSync(d).filter((f) => f.endsWith(".html")).sort();
      if (files.length) subFiles.set(sub, files);
    }
    const jointHere = jointByPromo.get(promo.id) || [];
    if (!subFiles.size && !jointHere.length) continue;
    // THE BRIDGE COUNT (THE ECOSYSTEM EXPANSION GAVEL, 2026-09-05, step 2;
    // CURATION.md v112(d); the coordinator's ruling 10 of the same day). A
    // bridge is a served file and belongs on this register — that is what a
    // DISK-DERIVED register is FOR, and hiding it would defeat the one
    // property that makes it trustworthy. But it is not a second document,
    // and left uncounted it doubles a non-English wing's apparent holdings.
    let bridgeCount = 0, docCount = 0;
    const groups = new Map(GROUP_ORDER.map((g) => [g, []]));
    for (const [sub, files] of subFiles) {
      const d = resolve(pdir, sub);
      const servedPath = `/promotions/${promo.id}/${sub}`;
      for (const f of files) {
        docCount++;
        const pagePath = `${servedPath}/${f}`;
        const row = sub === "rp" ? rpByPage.get(pagePath) : showByPage.get(pagePath);
        let label = "", rawDate = row?.date?.date || null, groupKey = "other";
        try {
          const src = readFileSync(resolve(d, f), "utf8");
          const cm = src.match(docClassRe);
          if (cm) groupKey = CLASS_GROUP[cm[1].toLowerCase()] || "other";
          if (/data-doc-class\s*=\s*"machine-translation"/i.test(src)) bridgeCount++;
          const h1m = src.match(h1Re);
          // 2026-09-13: an h1 that is only the wing's own name or acronym is not a document title — fall through
          // to the title tag / registry row / filename (189 entries were still bare after the first rebuild).
          const h1t = h1m ? h1m[1].trim() : "";
          const bareNames = new Set([String(promo?.name || ""), String(promo?.acronym || ""), String(promo?.id || "")].map((x) => x.toLowerCase()).filter(Boolean));
          if (h1t && !bareNames.has(h1t.replace(/&[a-z#0-9]+;/g, " ").trim().toLowerCase())) label = h1t;
          if (!label) {
            const tm = src.match(titleRe);
            if (tm && tm[1].trim()) label = stripTitleChrome(tm[1].trim(), promo);
          }
        } catch {}
        if (!label) label = row?.name || row?.title || "";
        if (!label) label = f.replace(/\.html$/, "");
        if (!rawDate) rawDate = filenameDate(f);
        groups.get(groupKey).push({ sub, f, label, rawDate, sortKey: dateSortKey(rawDate) });
      }
    }
    // JOINT-WING SHOWS (v121(c)): one pointer row per night this wing staged
    // that another wing holds the document for. `docCount` is deliberately
    // NOT incremented — this is a cross-reference, not a holding, and a
    // co-wing's own document count must not grow (v121(d)).
    for (const js of jointHere) {
      const home = promoById.get(js.promotion);
      const homeLabel = (home ? acronymLabel(home) : null) || home?.name || js.promotion;
      const rawDate = js.date?.date || null;
      groups.get("joint").push({
        href: js.page, label: `${js.name} — held on ${homeLabel}`,
        rawDate, sortKey: dateSortKey(rawDate), f: String(js.id || js.name || ""),
      });
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.f.localeCompare(b.f));
    }
    // Same page-budget discipline the old sub-keyed version used, now keyed
    // by document-class group instead of by disk folder: the budget
    // validate.mjs enforces is PER PAGE, not per group, so groups that each
    // fit on their own can still overflow holdings.html together — decide
    // inline-vs-chunked across every non-empty group at once, chunking the
    // largest still-inline group first and stopping as soon as the page fits.
    const chunkBudget = siteConfig.row_budget - 20;
    const activeGroups = GROUP_ORDER.filter((g) => groups.get(g).length);
    if (!activeGroups.length) continue;
    const chunked = new Set();
    const rowCost = (g) => chunked.has(g) ? Math.ceil(groups.get(g).length / chunkBudget) : groups.get(g).length;
    for (const g of activeGroups) if (groups.get(g).length > chunkBudget) chunked.add(g);
    const pageRows = () => activeGroups.reduce((n, g) => n + rowCost(g), 0);
    while (pageRows() > siteConfig.row_budget) {
      const next = activeGroups.filter((g) => !chunked.has(g)).sort((a, b) => rowCost(b) - rowCost(a))[0];
      if (!next) break;
      chunked.add(next);
    }
    const entryRow = (e) => {
      const when = humanDate(e.rawDate);
      const whenSpan = when ? `<span class="when">${esc(when)}</span>` : "";
      // e.href is set only by the "joint" group, whose entries live under
      // another wing's own path (v121(c)).
      const href = e.href || `/promotions/${promo.id}/${e.sub}/${e.f}`;
      return `<li>${whenSpan}<a href="${esc(href)}">${esc(e.label)}</a></li>`;
    };
    // 2026-09-13 (gate 139 run 3: 33 orphaned holdings-archive-N.html pages): every holdings chunk page is
    // regenerated below, so any chunk file from an earlier run — the old folder-keyed names or a class chunk
    // this run no longer needs — is removed first rather than left unlinked on disk.
    {
      const wdir = resolve(ROOT, "promotions", promo.id);
      try {
        for (const f of readdirSync(wdir)) {
          if (/^holdings-[a-z]+-\d+\.html$/.test(f)) unlinkSync(resolve(wdir, f));
        }
      } catch {}
    }
    const sections = [];
    for (const g of activeGroups) {
      const list = groups.get(g);
      const label = GROUP_LABEL[g];
      if (!chunked.has(g)) {
        sections.push(`<h2>${label} (${list.length})</h2><ul class="archive-list">${list.map(entryRow).join("\n")}</ul>`);
        continue;
      }
      const chunks = [];
      for (let i = 0; i < list.length; i += chunkBudget) chunks.push(list.slice(i, i + chunkBudget));
      const chunkLinks = chunks.map((chunk, i) => {
        const pageName = `holdings-${g}-${i + 1}.html`;
        const cmain = `<h1>${esc(promo.name)} &mdash; ${label.toLowerCase()}, part ${i + 1} of ${chunks.length}</h1>\n<p class="lede">${chunk.length} of ${list.length}, in date order (undated last).</p>\n<ul class="archive-list">${chunk.map(entryRow).join("\n")}</ul>\n<p class="muted small"><a href="/promotions/${promo.id}/holdings.html">All held documents</a></p>`;
        writeFileSync(resolve(pdir, pageName), pageShell({ title: `${esc(promo.name)} &mdash; ${label.toLowerCase()}, part ${i + 1} &mdash; E-WRESTLING MUSEUM`, main: cmain, footerLine: `THE E-WRESTLING MUSEUM <span class="rule">/</span> <a href="/promotions/${promo.id}/">${esc(promo.name)}</a> <span class="rule">/</span> <a href="/">back to the museum</a>`, rel: `promotions/${promo.id}/${pageName}` }));
        holdingsPages++;
        return `<li><a href="/promotions/${promo.id}/${pageName}">Part ${i + 1} of ${chunks.length} (${chunk.length})</a></li>`;
      }).join("\n");
      sections.push(`<h2>${label} (${list.length})</h2><ul class="archive-list">${chunkLinks}</ul>`);
    }
    if (!sections.length) continue;
    // RENDERS ONLY WHERE A BRIDGE EXISTS: a wing with none reads exactly as
    // it always has, so no English wing's register changes a byte.
    const countLine = bridgeCount
      ? `<p class="muted small">${docCount} document${docCount === 1 ? "" : "s"}, of which ${bridgeCount} ${bridgeCount === 1 ? "is an English bridge" : "are English bridges"} &mdash; a machine translation served beside its own document, never instead of it.</p>\n`
      : "";
    const main = `<h1>${esc(promo.name)} &mdash; held documents</h1>\n<p class="lede">Every document served under this promotion, listed from the shelf itself, grouped by kind and dated where the record allows.</p>\n${countLine}${sections.join("\n")}`;
    const footerLine = `THE E-WRESTLING MUSEUM <span class="rule">/</span> <a href="/promotions/${promo.id}/">${esc(promo.name)}</a> <span class="rule">/</span> <a href="/">back to the museum</a>`;
    writeFileSync(resolve(pdir, "holdings.html"), pageShell({ title: `${esc(promo.name)} &mdash; held documents &mdash; E-WRESTLING MUSEUM`, main, footerLine, rel: `promotions/${promo.id}/holdings.html` }));
    holdingsPages++;
  }
  console.log(`cross-reference: ${holdingsPages} holdings registers generated.`);
}

// ---------------------------------------------------------------------------
// c57: the manifest, written LAST and atomically.  A run that dies earlier
// leaves the previous manifest in place, which is safe by construction: every
// page the dead run rewrote now hashes differently from its entry, so the next
// run re-walks exactly those pages.
// ---------------------------------------------------------------------------
if (!XREF_NO_MANIFEST) {
  try {
    mkdirSync(dirname(XREF_MANIFEST_PATH), { recursive: true });
    const tmp = `${XREF_MANIFEST_PATH}.tmp-${process.pid}`;
    _rawWriteFileSync(tmp, JSON.stringify({
      schema: XREF_SCHEMA, root: ROOT, written: new Date().toISOString(),
      code: xCode, names: xNames, pages: xPages, wanted: xWanted,
    }));
    renameSync(tmp, XREF_MANIFEST_PATH);
    console.log(`cross-reference: manifest written — ${Object.keys(xPages).length} link entries, ${Object.keys(xWanted).length} wanted entries (${XREF_MANIFEST_PATH}).`);
  } catch (e) {
    console.warn(`cross-reference: manifest NOT written (${e.message}); the next run will be a full one.`);
  }
}
console.log(`cross-reference: ${linkedPages} pages linked, ${totalLinks} links inserted, ${personPageCount} per-entity pages generated, ${titlePageCount} per-title pages generated, ${awardPageCount} per-award pages generated, ${memorialPageCount} per-memorial pages generated, ${figurePageCount} external-figure pages generated, ${wanted.length} wanted-list candidates.`);
