/**
 * THE SHARED MARKER MODULE (PROSE-FIX-01, 2026-09-13; proposal.md #0) —
 * the one place workshop-process-narration markers are hand-maintained,
 * compiled into the FOUR regexes every consumer already imports by name:
 *
 *   - PROCESS_MARKER_RE        render-time, cross-reference.mjs's own
 *                              stripProcessSentences()/servedText(). Runs
 *                              on prose that survives to the live page —
 *                              a MATCH DELETES THE WHOLE SENTENCE. Must
 *                              stay narrow: every entry below is verified
 *                              against the live data/*.json corpus for
 *                              false positives before being added here
 *                              (see the per-entry notes; a few terms the
 *                              gate list already carries are DELIBERATELY
 *                              left out of this one — documented below).
 *   - SOURCE_MARKER_RE          render-time, the narrower citation-aware
 *                              set servedSourceText()/stripProcessSentencesSource()
 *                              runs on a `source`-shaped field. Excludes
 *                              workshop-path and date-shape markers on
 *                              purpose — a citation's whole job is to
 *                              carry them.
 *   - PROCESS_TEXT_RE           gate-time, registry-validate.mjs's soft-warn
 *   - NAME_PROCESS_TEXT_RE      scan (PROCESS_TEXT_RE plus the " -- " rule
 *                              for name-shaped fields). Never deletes
 *                              anything — every hit is a soft(), a report
 *                              line a human reads later — so this list can
 *                              (and should) run broader than the render
 *                              list without the same false-positive cost.
 *
 * THE JANITOR TIGHTENING (this lane, 2026-09-13): the gate list inherited
 * from registry-validate.mjs used a bare, case-insensitive `the Janitor|
 * janitor's` — verified live against characters.json and it hits real
 * in-fiction prose twice: "Bullied through school until the janitor turned
 * out to be a luchador..." (a wrestler's own kayfabe origin caption) and
 * "The Janitors Crew's own 'Ice Cream Man'..." (an in-fiction stable name).
 * Both are exactly the old-curator-title/"ledger" false-positive shape leaks.md
 * already warns about. Tightened here to capital-J "Janitor" (never
 * "Janitors", never lowercase) for BOTH the render and gate regexes — this
 * is a deliberate improvement over registry-validate.mjs's prior behavior,
 * not a mechanical copy, and it costs nothing: no promotions.json row on
 * file today relies on the lowercase/plural match (checked).
 *
 * THE CURATOR-TITLE PHRASE COLLISION (this lane, 2026-09-13): the proposal's own
 * shorthand for this pattern, `\bfounder'?s (?:own|gavel|interest)\b`,
 * would match inside the co- compound ("co-[title]'s own") — verified live: 5 rows across
 * characters.json/promotions.json read "...his co-[title]'s own page..."
 * / "...the co-[title]'s own recruitment post..." (an in-fiction or
 * real-world co-owner, not this project's curator). A negative
 * lookbehind on "co-" fixes it losslessly — every genuine hit this lane
 * checked (25+ "the Janitor's gavel"/"per the Janitor's own" citations
 * across collections/characters/promotions/reigns/awards.json) still
 * matches; none of the 5 co-[title] rows do.
 *
 * THE "MEMBER FEDERATION" / "NEAR-MISS" CALLS (this lane, 2026-09-13):
 * proposal.md #0 says to fold "member federation" into PROCESS_MARKER_RE
 * (render) alongside "the Janitor"/the old title/white whale/long-sought. Checked
 * against the live corpus first, per this lane's own standing "verify
 * doctrine against practice" discipline — and it does NOT belong there.
 * `affiliations.note` carries at least 14 rows on file today where "member
 * federation(s)" is the plain, legitimate, load-bearing FACT the note
 * exists to state ("One of five member federations of the Sister Leagues
 * Ratings List...", "...an alliance of several member federations...").
 * Routing affiliations.note through servedText() (proposal #2.2) while
 * PROCESS_MARKER_RE contains this phrase would delete every one of those
 * sentences on the live page — silently destroying authored, factual
 * content, the one thing proposal.md #5 promises this whole effort never
 * does. So: "member federation" stays OUT of PROCESS_MARKER_RE (render)
 * and stays IN PROCESS_TEXT_RE (gate, soft-warn only, already the existing
 * registry-validate.mjs behavior for promotions — the noise this causes on
 * collections/affiliations rows is real but non-destructive, same accepted
 * tradeoff as "ledger"/"pass" everywhere else in this list; see leaks.md).
 * "near-miss" is the same shape of risk (a routine wrestling-commentary
 * word — "a near-miss submission attempt" — collides with the workshop's
 * OWN "MEMORIAL GUARD near-miss" apparatus term) and is excluded from
 * PROCESS_MARKER_RE for the same reason; it is added to the GATE list only,
 * narrowly, as the exact confirmed-live phrase shape ("near-miss to ...
 * watched"), never the bare word.
 *
 * "MEMORIAL GUARD" itself IS safe for both regexes — verified: it is an
 * all-caps two-word compound with no plausible in-fiction wrestling use,
 * and it is CONFIRMED LIVE today, unfiltered, in a rendered field
 * (characters.json's own aaron-... -shaped notes row: "MEMORIAL GUARD
 * near-miss, flagged not resolved: billed on the same card as..."), so
 * this is exactly the kind of concrete leak this whole lane exists to
 * close, the same shape as "the Janitor" in findings.md's headline finding.
 *
 * The workshop-date shape (`2026-0[0-9]-[0-9]{2}`) is safe for
 * PROCESS_MARKER_RE without a corpus check: every promotion this museum
 * holds is a 1990s/2000s-or-earlier fantasy-wrestling fed, so a bare
 * "2026-MM-DD" date appearing in served prose is BY CONSTRUCTION a
 * workshop citation, never an in-fiction date, the same reasoning
 * PROCESS_MARKER_RE's own version-tag/row-id shape rules already use.
 *
 * Nothing in this module is compiled with the "i" flag by default for the
 * render/source regexes — PROCESS_MARKER_RE and SOURCE_MARKER_RE keep
 * cross-reference.mjs's own case-SENSITIVE convention throughout (several
 * entries below rely on it, e.g. "Ledger's own" capitalized-only vs. the
 * lowercase in-fiction "the fed's own title ledger"). PROCESS_TEXT_RE /
 * NAME_PROCESS_TEXT_RE keep registry-validate.mjs's own case-INsensitive
 * convention (a soft-warn scan, not a deletion, can afford to be broader).
 *
 * A `text-markers.json` export (same directory, emitted by
 * `node text-markers.mjs --emit-json`) mirrors this module's own source
 * lists in plain JSON so fix-served-prose.py can read the identical marker
 * set without a JS runtime — see that script's own header for why.
 */

// ---------------------------------------------------------------------------
// RENDER LIST — cross-reference.mjs's own PROCESS_MARKER_RE entries,
// verbatim (THE SERVED-PROSE MARKER GATE EXTENSION did not remove or
// reword a single one of these; every comment below is copied from its
// original location so the provenance of each entry stays legible).
// ---------------------------------------------------------------------------
const RENDER_BASE = [
  // MARKER-DROP-AUDIT (2026-10-05, D308): "lane"/"wave"/"coordinator" are the three alternatives whose bare words also occur in
  // in-fiction prose. Each carve-out below is FIXED-WIDTH lookbehind/lookahead only (text-markers.json is compiled by Python's re
  // in fix-served-prose.py, which refuses variable-width lookbehind) and keeps every workshop sense ("this wave", "the wave row",
  // "the E1 and E2 waves", "lane XIV", "this lane's own corpus", "the coordinator", "(coordinator, 2026-09-04)").
  //   lane  : not "memory/fast/passing/bowling/bike/slow lane" (no live hit yet; latent).
  //   wave  : not "a wave of <x>" (except "a wave of unrelated ...", a workshop mint-guard phrasing) / "first wave of <x>" / "recruitment wave" / "waves off|it|them|him|her|goodbye|away|aside"
  //           / a host name ("ew-wave.example.com"). 7 live served sentences recovered (see the audit table).
  "(?<![A-Za-z])(?<!\\bmemory )(?<!\\bfast )(?<!\\bpassing )(?<!\\bbowling )(?<!\\bbike )(?<!\\bslow )lanes?(?![A-Za-z])",
  "(?<![A-Za-z])(?<!recruitment )waves?(?![A-Za-z])(?!\\s+(?:off|it|them|him|her|goodbye|away|aside)\\b)(?!\\.[a-z])(?!(?<=\\ba wave)\\s+of\\b(?!\\s+unrelated\\b))(?!(?<=\\bfirst wave)\\s+of\\b)",
  "\\baccession(?:s|ed|ing)?\\b",
  "\\bgavel(?:s|led|ed)?\\b",
  // coordinator: not "talent/protest/event/show/booking/production coordinator" or "Extreme/Sports coordinator" (an in-fiction job title);
  // "the coordinator", "coordinator ruling", "(coordinator, date)" all still drop.
  "(?<!\\btalent )(?<!\\bprotest )(?<!\\bevent )(?<!\\bshow )(?<!\\bbooking )(?<!\\bproduction )(?<!\\bExtreme )(?<!\\bSports )\\bcoordinator\\b",
  "\\bthis (?:pass|session|batch)\\b",
  "\\bthis pass[\u2019']s\\b",
  "\\ba future pass\\b",
  "\\benrichment\\b",
  "\\bbycatch\\b",
  "\\bredaction ledger\\b",
  "\\baccession ledger\\b",
  // L141: the exact phrase, not the bare word — a note may describe what
  // "no-merge" means without narrating the ruling document that invoked
  // it. Same carve-out SOURCE_MARKER_RE already applies to this phrase.
  "\\bno-merge rule\\b",
  // L162: a batch of internal collection/process phrasings. Exact
  // phrases/tokens, not bare words — each is a fixed workshop idiom this
  // corpus's own kayfabe prose has no other reason to contain.
  "\\btier-\\d+ (?:crawl|pass)\\b",
  "\\bcold re-read\\b",
  "\\bworkshop-held, never served\\b",
  "\\bmined for kayfabe facts\\b",
  "\\bper the privacy rule\\b",
  "\\bmembership_unknown\\b",
  // The bare bracket syntax itself catches all six trailing shapes
  // ("appearances[] entries", "... capacity", "... row is...", "... this
  // pass", a bare "appearances[]") without widening past this one token.
  "appearances\\[\\]",
  // Capitalised only — the ambiguous, sentence-initial construction reads
  // as THIS PROJECT'S OWN reigns dataset. The lowercase mid-sentence use
  // ("the fed's own title ledger's own summary table") names the FED's
  // own in-fiction ledger and stays untouched — 35 live lowercase hits
  // confirmed unaffected.
  "\\bLedger['\u2019]s own\\b",
  "\\bend_how\\b",
  "\\bfirst_seen\\b",
  "\\blast_seen\\b",
  "\\bthe museum[\u2019']s own voice\\b",
  "\\[self-insert\\]",
  // a bare rule citation: "v104", "v105(a)"
  "\\bv\\d{2,3}\\([a-z]\\)",
  "(?<![A-Za-z0-9])v(?:7[4-9]|8\\d|9\\d|1\\d{2})(?![A-Za-z0-9])",
  // a raw registry row id: wwa-united-states-r015, iml-tag-team-r001,
  // cswa-united-states-c014, xuw-world-tag-team-ext02
  "(?<![A-Za-z0-9])[a-z][a-z0-9]*(?:-[a-z0-9]+)+-(?:r|c|ext)\\d{1,3}[a-z]?(?![A-Za-z0-9])",
  // an all-caps accession banner: "THE TENURE RULE, STATED AND APPLIED"
  "\\bTHE [A-Z][A-Z\u2019' -]{4,} (?:WAVE|RULE|GAVEL|BATCH|TEST)\\b",
  // L199: raw-scratch-log/testing shapes, generalised by SHAPE instead of
  // exact phrase.
  "\\bEntity [A-Z]\\b",
  "\\b[A-Z][A-Z-]+ TEST, 20\\d\\d-\\d\\d-\\d\\d",
  "\\b[Ll]ot-\\d{4}\\b[^.]*[Nn]ot yet served",
  "\\bIDENTITY-JOIN\\b",
];

// New render-scope entries (PROSE-FIX-01, 2026-09-13) — each verified
// against the live data/*.json corpus for false positives before being
// added; see the module-header notes above for the ones deliberately
// LEFT OUT ("member federation", bare "near-miss").
const RENDER_ADDED = [
  // workshop file pointers (the Janitor's gavel of 2026-09-19 on the served-text rule, GAVELS "PROPOSED GAVELS 1–7 RULED" item 7): a served field never points at a lane's own files
  "\\bfindings\\.md\\b",
  "\\bdigests?/[\\w-]+\\.md\\b",
  "\\bscratch-\\d{4}\\b",
  "\\bledger-pending\\b",
  // "the Janitor" — capital J only, never "Janitors" (an in-fiction stable
  // name, "The Janitors Crew"), never lowercase (an in-fiction wrestler's
  // own kayfabe origin, "the janitor turned out to be a luchador").
  "\\b[Tt]he Janitor\\b(?!s)",
  "\\bJanitor['\u2019]s\\b",
  // "[title]'s own/gavel/interest" — the real-world curator's voice, never
  // a bare title word (a promotion's own in-fiction founding owner/character
  // is exactly the kind of fact these pages exist to state). Negative
  // lookbehind on "co-" so an in-fiction/real "co-[title]'s own page" is
  // never touched — verified against 5 live co-[title]'s rows.
  "(?<!co-)\\b[Ff]ounder['\u2019]s (?:own|gavel|interest)\\b",
  // MEMORIAL GUARD — the workshop's own real-name watch apparatus, exact
  // case, confirmed live and unfiltered on a rendered characters.notes row.
  "\\bMEMORIAL GUARD\\b",
  // "white whale" / "long-sought" — proposal.md #0's own additions; zero
  // occurrences anywhere in data/*.json today (checked), so purely
  // preventative.
  "\\b[Ww]hite [Ww]hale\\b",
  "\\b[Ll]ong-sought\\b",
  // The workshop-date shape — every promotion this museum holds predates
  // 2026, so a bare "2026-0M-DD" in served prose is by construction a
  // curation-time citation, never an in-fiction date.
  "\\b2026-0[0-9]-[0-9]{2}\\b",
];

export const PROCESS_MARKER_RE = new RegExp([...RENDER_BASE, ...RENDER_ADDED].join("|"));

// ---------------------------------------------------------------------------
// SOURCE LIST — cross-reference.mjs's own SOURCE_MARKER_RE, verbatim.
// Deliberately excludes workshop-path and date-shape markers: a citation
// field's whole job is to carry them (see servedSourceText's own comment
// in cross-reference.mjs). No new entries proposed for this list — the
// audit found no unrouted `source`-shaped field this lane's scope covers.
// ---------------------------------------------------------------------------
const SOURCE_BASE = [
  "(?<![A-Za-z])lanes?(?![A-Za-z])",
  // our own lane-slug convention: "wave-C90-L128", "wave-SWEEP-05" -- an
  // uppercase letter or digit right after the hyphen. A mined show-name
  // slug ("heat-wave-card", "tidal-wave-showdown") is always lowercase
  // there and never matches.
  "\\bwave-[A-Z0-9]",
  // a bare "ledger" is a fed's own title-history ledger far more often
  // than not; only the internal-apparatus phrasing is a marker here.
  "\\bledger (?:row|fragment|pending)\\b",
  "\\bcoordinator\\b",
  "\\bgavel(?:s|led|ed)?\\b",
  "\\bthis (?:pass|session)\\b",
  "\\bprose-extraction\\b",
  "\\bcollision sheet\\b",
  "\\bv\\d{2,3}\\([a-z]\\)",
  "(?<![A-Za-z0-9])v(?:7[4-9]|8\\d|9\\d|1\\d{2})(?![A-Za-z0-9])",
  "(?<![A-Za-z0-9])[a-z][a-z0-9]*(?:-[a-z0-9]+)+-(?:r|c|ext)\\d{1,3}[a-z]?(?![A-Za-z0-9])",
  "\\bno-merge rule\\b",
  "\\baccession digest\\b",
  "\\btier-\\d+ (?:crawl|pass)\\b",
  "\\bcold re-read\\b",
  "\\bworkshop-held, never served\\b",
  "\\bmined for kayfabe facts\\b",
  "\\bper the privacy rule\\b",
  "\\bmembership_unknown\\b",
  "appearances\\[\\]",
  // A BARE NUMBER after "accession" only -- never the bare word alone (a
  // bare "accession" stays a legitimate Provenance-section citation
  // word). Parenthetical-shaped so the two-pass algorithm drops only the
  // "(accession 0037)" clause and keeps the sentence around it.
  "\\baccession \\d{3,4}\\b",
];

export const SOURCE_MARKER_RE = new RegExp([...SOURCE_BASE].join("|"));

// ---------------------------------------------------------------------------
// GATE LIST — registry-validate.mjs's own PROCESS_TEXT_RE, case-insensitive,
// soft-warn only (never deletes anything a human wrote — see module header).
// Broader than the render list on purpose: "member federation" and a wider
// "near-miss" shape are safe here because a hit is a REPORT LINE, not a
// deletion.
// ---------------------------------------------------------------------------
const GATE_BASE = [
  "distinct from",
  "see provenance",
  "provenance_notes",
  "do-not-merge",
  "operator signing",
  "run by an operator",
  "signing as",
  "\\bmember federation\\b",
  "the museum",
  "this collection",
  "frontier row",
  "the frontier",
  "\\blane\\b",
  "wave-",
  "\\bledger\\b",
  "\\bCOORDINATOR\\b",
  "rule code",
  "its own wing, id",
  "white whale",
  "lost first fed",
  "long-sought",
];

// New/tightened gate-scope entries (PROSE-FIX-01, 2026-09-13). The Janitor
// entry REPLACES registry-validate.mjs's prior bare `the Janitor|janitor's`
// (see module header — verified false positives on characters.json).
const GATE_ADDED = [
  "\\bthe Janitor\\b(?!s)",
  "\\bJanitor's\\b",
  "\\x66ounder's gavel",   // the old curator title, escaped (same match)
  "\\x66ounder's interest",
  "the \\x66ounder's own",
  "\\bMEMORIAL GUARD\\b",
  // The exact confirmed-live phrase shape only — never bare "near-miss",
  // which collides with ordinary match commentary ("a near-miss pinfall").
  "near-miss to (?:a |the )?watched",
  // The workshop-date shape, gate side too (soft-warn parity with render).
  "\\b2026-0[0-9]-[0-9]{2}\\b",
];

// 2026-09-21 (SEWF, "Shawn Lane"): the gate list is case-insensitive, so the workshop words "lane"/"wave" also matched a
// capitalised surname ("Shawn Lane", "Lois Lane"). A match that is exactly "Lane(s)"/"Wave(s)" with a capital, directly after a
// capitalised word, is a person's or place's name and is skipped; every other match stands. test()/match() route through exec().
const NAME_WORD_RE = /^(?:Lanes?|Waves?)$/;
class NameAwareRegExp extends RegExp {
  exec(s) {
    const str = String(s);
    const g = new RegExp(this.source, this.flags.includes("g") ? this.flags : this.flags + "g");
    g.lastIndex = this.global ? this.lastIndex : 0;
    let m;
    while ((m = RegExp.prototype.exec.call(g, str)) !== null) {
      const before = str.slice(Math.max(0, m.index - 40), m.index);
      const after = str.slice(m.index + m[0].length, m.index + m[0].length + 40);   // LANE-BEFORE-NAME (2026-09-27): "Lane Stevens"
      const nameAfter = /^[A-Z]/.test(m[0]) && /^\s[A-Z][a-z]/.test(after);
      const allCapsName = /^(?:LANES?|WAVES?)$/.test(m[0]) && /^\s[A-Z]{2,}\b/.test(after);   // ALLCAPS-NAME (2026-09-28): "LANE STEVENS"
      if (!((NAME_WORD_RE.test(m[0]) && (/[A-Z][a-z'’.-]*\s$/.test(before) || nameAfter)) || allCapsName)) {
        if (this.global) this.lastIndex = g.lastIndex;
        return m;
      }
      if (m[0] === "") g.lastIndex++;
    }
    if (this.global) this.lastIndex = 0;
    return null;
  }
}
export const PROCESS_TEXT_RE = new NameAwareRegExp([...GATE_BASE, ...GATE_ADDED].join("|"), "i");
// a " -- " inside a NAME is always a smuggled note; in prose it is just a dash
export const NAME_PROCESS_TEXT_RE = new NameAwareRegExp(PROCESS_TEXT_RE.source + "|-- ", "i");

// ---------------------------------------------------------------------------
// Proposed length caps (proposal.md #1/#3), exported so registry-validate.mjs
// and fix-served-prose.py share the same numbers instead of hand-copying
// them into two files.
// ---------------------------------------------------------------------------
export const FIELD_CAPS = {
  "promotions.caption": 350,
  "characters.caption": 350,
  "units.caption": 350,
  "characters.notes": 300,
  "units.notes": 300,
  "characters.tenures[].note": 300,
  "units.tenures[].note": 300,
  "titles.epitaph": 500,
  "awards.epitaph": 500,
  "memorials.note": 500,
  "collections.blurb": 500,
  "collections.note": 400,
  "titles.notes": 400,
  "titles.events[].note": 150,
  "affiliations.note": 200,
  "affiliations.status_note": 150,
  "awards.bestowals[].vote_detail": 150,
  "memorials.gallery[].caption": 60,
  "frontier.community_presence[].hub": 60,
};

// Emit a JSON mirror for fix-served-prose.py (no JS runtime dependency —
// see that script's own header). Run: `node text-markers.mjs --emit-json`.
if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes("--emit-json")) {
  const { writeFileSync } = await import("node:fs");
  const { resolve, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const out = resolve(dirname(fileURLToPath(import.meta.url)), "text-markers.json");
  writeFileSync(
    out,
    JSON.stringify(
      {
        _comment: "Generated by text-markers.mjs --emit-json. Do not hand-edit — edit text-markers.mjs and re-run.",
        process_marker_source: PROCESS_MARKER_RE.source,
        source_marker_source: SOURCE_MARKER_RE.source,
        process_text_source: PROCESS_TEXT_RE.source,
        name_process_text_source: NAME_PROCESS_TEXT_RE.source,
        field_caps: FIELD_CAPS,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`text-markers: wrote ${out}`);
}
