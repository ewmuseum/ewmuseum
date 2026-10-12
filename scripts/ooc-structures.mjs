/**
 * THE SHARED OUT-OF-CHARACTER STRUCTURE DETECTOR (PRIVACY-CONTEXT-01,
 * 2026-09-13; the Janitor ruling of the same date, LANE-RULES.md rule 6) —
 * the one place the OOC-structure pattern list is hand-maintained, so
 * privacy-check.mjs (the gate) and gate-fail-redact.py (the red handler)
 * can never fork into two different ideas of "in character" vs.
 * "out of character." Same convention as text-markers.mjs/.json: this
 * module is the source of truth; `node ooc-structures.mjs --emit-json`
 * writes ooc-structures.json, and the Python twin (ooc_structures.py)
 * reads that JSON and never hand-copies a pattern.
 *
 * THE RULING THIS CODIFIES (the Janitor, 2026-09-13): the privacy machinery is
 * NAME-KEYED — the ledger denies a string, the gate fails on that string
 * anywhere in the tree, the red handler redacts every hit unread — and
 * that has produced repeated misfires on fiction pages, where a denied
 * real name is also a wrestler's own billed persona, an on-screen
 * announcer, a promoter character, or a signing target named in kayfabe
 * dialogue. CONTEXT MUST DECIDE, BY STRUCTURE:
 *
 *   out-of-character = bylines ("From:", "Posted by", "By"),
 *                       "Written by"/production credits,
 *                       signatures and sig blocks,
 *                       copyright lines,
 *                       contact lines (e-mail, ICQ, AIM, phone, address),
 *                       application forms,
 *                       mastheads/staff lists.
 *
 *   everything else on a card or roleplay page is fiction and SERVES,
 *   even for a person denied elsewhere.
 *
 * This module answers exactly one question: for a given page's raw text
 * (the served HTML, tags and all — the same text privacy-check.mjs's own
 * line-oriented ledger scan already reads), which LINES are one of the
 * seven OOC structures above? It never looks at the ledger, never knows
 * what a "denied name" is, and never decides pass/fail — it only labels
 * structure. The caller (privacy-check.mjs / gate-fail-redact.py) is the
 * one that crosses that labeling against a ledger hit.
 *
 * GRANULARITY: privacy-check.mjs's own ledger scan already reports hits
 * as "path:line:text" (one physical line at a time — these served pages
 * use a real `\n` per visual line, ASCII-art padding and all; verified
 * against promotions/iiew-1997/archive/night-two-1998-03-01.html's own
 * "Written by:" lines, each on its own newline-terminated line despite
 * the ASCII-art banner sharing it). So this detector classifies at LINE
 * granularity — one label (or none) per line — which is both sufficient
 * for the gate's own per-line hit shape and trivial to keep byte-for-byte
 * identical between a JS and a Python implementation (no risk of the two
 * languages' regex engines disagreeing on a sub-line character offset).
 * `detectOocRanges()` below still returns CHARACTER ranges (this lane's
 * own brief asks for ranges, not just line numbers) — they are simply
 * derived by concatenating whichever contiguous run of OOC-labeled lines
 * shares a label, computed from the same per-line classification every
 * other export in this module uses. There is one classification
 * algorithm; every other function here is a view onto it.
 *
 * WHAT IS DELIBERATELY NOT HERE: doc_class lookup (documents.json),
 * ledger loading, allow-row logic, redaction-count logic, the review
 * queue. Those all stay in privacy-check.mjs / gate-fail-redact.py — this
 * module's only job is "is this line one of the seven shapes," and it
 * does that job the same way regardless of which promotion, which
 * ledger, or which gate run is asking.
 */

// ---------------------------------------------------------------------------
// LINE PATTERNS — a line matching any of these is wholly one OOC structure.
// Each entry: { id, label, category, source (regex source, no delimiters),
// flags }. `category` is one of the seven Janitor-named shapes; `label` is
// the human-readable string this lane's INFO/FAIL reports cite.
//
// Every pattern below is anchored to a STRUCTURAL cue (a field label, a
// header keyword, a sign-off word, an address/contact shape) never to a
// bare name — the whole point of "context first" is that the SAME denied
// name reads differently depending on what surrounds it, so the detector
// must never key off the name itself.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// NEAR-MISS CREDIT LABELS (hook c225-ooc-credit-nearmiss, 2026-10-09). A real writer credit served for weeks on a card page
// because the source spelled its label "Written y -" and "credit-written-by" below needs the exact words; the line read as in
// character and dropped to PRIVACY-INFO. This pattern catches the credit LABEL in its typo'd and variant shapes, anchored the way
// a credit is laid out (never a bare word in prose): the label stands at the start of the line or of a cell, or right after a
// separator ("|", a tab, a tag's ">", two spaces, a spaced dash or colon), with only markup and punctuation before it, and a
// name-like span (a letter, digit, "&", a quote, a bracket) follows. Labels: the "written by" family misspelt or run together
// ("written y", "writen by", "wrtten by", "wriiten by", "writter by", "written b", "written-by", "Written&nbsp;by",
// "_Written by"), "Writer:"/"Writers -", "w/b:", and "<results|card|show|match|segment|promo|angle|edited|compiled|produced|
// booked|written|scripted> by". NOT "Booker:" (a speech tag for a wrestler named Booker on live cards) and NOT "Written:" (a
// date stamp on live roleplays). Measured on the live tree before install; see the hook.
// ---------------------------------------------------------------------------
const C225_LEAD = String.raw`(?:^|[|•·\t>]|\s[-–—=~*:]{1,3}\s|\s\s)(?:[\s*#=~|>_.:()\[\]-]|&nbsp;|&#160;|<[^>]*>)*`;
const C225_GAP = String.raw`(?:\s|&nbsp;|&#160;)*`;
const C225_DASH = String.raw`(?:[:\-–—]|&mdash;|&ndash;|&#8212;|&#8211;)`;
const C225_LABEL = [
  String.raw`wr[iy]{0,3}t{1,3}(?:en|er|e|n)(?:\s|&nbsp;|&#160;|[_.\-])*(?:by|b|y)(?![a-z0-9])`,
  String.raw`writers?` + C225_GAP + C225_DASH,
  String.raw`w\s*\/\s*b\s*` + C225_DASH,
  String.raw`(?:results?|cards?|shows?|match(?:es)?|segments?|promos?|angles?|edited|compiled|produced|booked|written|scripted)(?:\s|&nbsp;|&#160;|_)+by` + C225_GAP + C225_DASH,
  // without a colon or dash only on a short line ending in the name: "Results by Aa Bb", never "Show by show, he rose"
  String.raw`(?:results?|cards?|shows?)(?:\s|&nbsp;|&#160;)+by\s+(?=[^,;!?]{1,50}$)`,
].join("|");
const C225_SPAN = String.raw`(?:\s|&nbsp;|&#160;|<[^>]*>|[:_\-–—=.,])*(?:[a-z0-9&"'(\[]|&quot;|&amp;)`;
export const CREDIT_NEAR_MISS_SOURCE = C225_LEAD + "(?:" + C225_LABEL + ")" + C225_SPAN;

export const LINE_PATTERNS = [
  // --- byline: "From:", "Posted by", "By" -----------------------------
  // Usenet/board quoted-reply byline. The bare header-hygiene scan
  // (privacy-check.mjs check #2) already handles From:/Reply-To:/etc.
  // email/bang-path hygiene; this is the broader "this whole line
  // attributes authorship" structural call the context rule needs.
  { id: "byline-from", label: "byline (From:)", category: "byline",
    source: "^\\s*From:\\s*\\S", flags: "" },
  { id: "byline-posted-by", label: "byline (Posted by)", category: "byline",
    source: "\\bPosted\\s+By\\b", flags: "i" },
  // Line-initial "By <Name>" / "By: <Name>" attribution (a news/column
  // dateline shape) — anchored to line start and a following capitalized
  // token so it never fires on prose's own "pinned by the champion" or
  // "surrounded by fans" mid-sentence uses of the bare word.
  { id: "byline-by", label: "byline (By:)", category: "byline",
    source: "^\\s*By\\s*:?\\s+[A-Z]", flags: "" },

  // --- "Written by"/production credits --------------------------------
  // Covers every live shape seen on served cards: "Written by:",
  // "Written By-", "WRITTEN BY", dot-padded "written by ......", and the
  // ASCII-art banner lines that carry it mid-line (e.g. iiew-1997's own
  // night-two broadcast — the banner padding never matches this pattern
  // on its own, only the credit phrase does, so the WHOLE line is safely
  // classed OOC without also needing to parse the banner art itself).
  { id: "credit-written-by", label: "written-by/production credit", category: "credit",
    source: "\\bwritten\\s*by\\b", flags: "i" },
  { id: "credit-booked-by", label: "booked-by production credit", category: "credit",
    source: "\\bbooked\\s*by\\b", flags: "i" },
  { id: "credit-match-writer", label: "match-writer production credit", category: "credit",
    source: "\\bmatch\\s*writer\\s*:", flags: "i" },
  // Near-miss credit labels, anchored at a line/cell start or after a separator (hook c225; see CREDIT_NEAR_MISS_SOURCE above).
  { id: "credit-near-miss", label: "near-miss writer/production credit", category: "credit",
    source: CREDIT_NEAR_MISS_SOURCE, flags: "i" },

  // --- copyright lines --------------------------------------------------
  { id: "copyright", label: "copyright line", category: "copyright",
    source: "©|\\(c\\)\\s*\\d{4}|\\bcopyright\\b", flags: "i" },

  // --- contact lines (e-mail, ICQ, AIM, phone, address) -----------------
  { id: "contact-email-address", label: "contact line (e-mail address)", category: "contact",
    source: "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}", flags: "" },
  { id: "contact-label", label: "contact line (labeled field)", category: "contact",
    source: "\\b(?:e-?mail|icq|aim|msn)(?:\\s+name)?\\s*#?\\s*:", flags: "i" },
  { id: "contact-phone", label: "contact line (phone)", category: "contact",
    source: "\\bphone\\s*:", flags: "i" },
  { id: "contact-address", label: "contact line (mailing address)", category: "contact",
    source: "\\baddress\\s*:", flags: "i" },
  { id: "contact-send-to", label: "contact line (send-to instruction)", category: "contact",
    source: "\\bsend\\s+it\\s+to\\b|\\bsend\\s+to\\s*:", flags: "i" },

  // --- application forms --------------------------------------------------
  { id: "form-field", label: "application-form field", category: "form",
    source: "^\\s*(?:Real\\s+Name|Handler\\s+Name|Character\\s+Name|Name|Age|Gender|Experience|Height|Weight)\\s*:", flags: "i" },
  { id: "form-header", label: "application-form header", category: "form",
    source: "^\\s*APPLICATION\\s*$", flags: "i" },
];

// ---------------------------------------------------------------------------
// SIGNATURE / SIG-BLOCK — a two-part rule: a START line (an explicit
// sign-off word), then up to SIG_BLOCK_MAX_LINES following non-blank
// lines belong to the SAME block, stopping early at a blank line or at
// the start of a new HTML structural element (the served-page wrapper
// closing the document, a provenance block, or the chrome footer) so a
// signature block can never swallow the rest of the page.
//
// VERIFIED EXCLUSION (this lane, 2026-09-13): the bare Usenet "-- "
// dash-only sig delimiter is deliberately NOT a start trigger here, even
// though it is the textbook convention (confirmed live on
// promotions/iiew-1997/archive/proposal-1997-12-28.html: a lone "--"
// line followed by a name/contact/handler block). A bare standalone
// "--" line is ALSO this corpus's own common in-fiction SCENE-BREAK
// convention between match segments on broadcast cards — confirmed live
// on a rspwwcw card carrying five such dashes, none a signature, each
// simply separating one commentary segment from the next, with ordinary
// kayfabe dialogue on both sides every time (verified: neither the
// first, an interior, nor the LAST occurrence in that file introduces a
// sig block — the "last occurrence" heuristic was tried and also fails,
// since scene breaks keep occurring almost to the end of the card).
// Treating bare "--" as a sig-block start would mislabel that in-fiction
// dialogue as OOC on every card using the convention — a broader and
// more damaging false-positive than the sig blocks it would catch, most
// of which carry their own contact/e-mail line independently caught by
// the "contact" category regardless (see findings.md's residual-risk
// note on the resulting narrow gap: a bare sign-off NAME line with no
// contact detail of its own, immediately after a dash, is not classified
// OOC by this module alone).
// ---------------------------------------------------------------------------
export const SIG_START_SOURCE = "\\b(?:Sincerely|Regards|Yours\\s+truly|Yours\\s+in\\s+wrestling|Yours\\s+in\\s+kayfabe)\\s*,?\\s*$";
export const SIG_START_FLAGS = "i";
export const SIG_BLOCK_MAX_LINES = 5;
// A line matching any of these ends a signature block early (never
// consumed as part of it) — the page's own structural boundaries.
export const SIG_BLOCK_STOP_SOURCE = "^\\s*(?:<dl[ >]|<footer[ >]|</div>|<!--\\s*chrome:)";
export const SIG_BLOCK_STOP_FLAGS = "i";

// ---------------------------------------------------------------------------
// MASTHEAD / STAFF LIST — a line of the shape "<real-world production
// role>: <name>" is a candidate; the vocabulary is a fixed list of
// SITE-OPERATION roles (never a bare capitalized word before a colon,
// which would collide constantly with cards' own dialogue-attribution
// convention, e.g. "Walters:", "Riggins:", "CM:" as commentator/wrestler
// speech tags — none of those are in this vocabulary). Because a single
// stray role-title line could still be an in-fiction character's own
// billed title ("Commissioner: You're fired!" as a promo line), a
// candidate line is only classed OOC when the SAME page carries at least
// MASTHEAD_MIN_HITS of them — the shape of an actual masthead (several
// roles listed together), not a one-off in-fiction line. See findings.md
// for the residual false-negative/false-positive tradeoff this accepts.
//
// VERIFIED EXCLUSION (this lane, 2026-09-13, per the project's own
// "verify doctrine against practice" standing rule): "Ring Announcer",
// "Color Commentator", "Commentator", "Interviewer", "Backstage
// Correspondent" and "Ringside Correspondent" are deliberately LEFT OUT
// of this vocabulary even though a real staff masthead does use them
// (confirmed live: promotions/ewa-1998/archive/staff.html lists "Ring
// Announcer: Timothy Braddock", "Interviewer and Backstage
// Correspondent: Jay Lyons"). On a CARD page those exact same labels are
// the standard broadcast dialogue-attribution tag introducing a line of
// in-fiction commentary ("RING ANNOUNCER: Introducing first...", "Ring
// Announcer: \"Ladies and Gentlemen...\""), confirmed live on
// promotions/iiew-1997/archive/night-two-1998-03-01.html — six such
// lines on that one page alone, none a masthead, all match-commentary.
// Because staff pages (doc_class "staff") are OUT OF SCOPE for the
// relaxation this detector feeds (only card/roleplay/rp consult it — see
// privacy-check.patch), losing masthead recognition on THAT class costs
// nothing; keeping these roles in would instead mislabel real in-fiction
// commentary as OOC on every broadcast card that uses them, the opposite
// of the Janitor's ruling. Kept: pure executive/production roles that do
// not double as a live-commentary speech tag.
// ---------------------------------------------------------------------------
const MASTHEAD_ROLES = [
  "President(?:\\s+and\\s+CEO)?", "Co-President", "Vice\\s+President(?:\\s+of\\s+[A-Za-z]+)?",
  "CEO", "Commissioner", "Owner", "Head\\s+Booker", "Booker", "General\\s+Manager", "GM",
  "Webmaster", "Director\\s+of\\s+Operations", "Editor", "Head\\s+Writer",
];
export const MASTHEAD_ROLE_SOURCE = "^\\s*(?:" + MASTHEAD_ROLES.join("|") + ")\\s*:\\s*\\S";
export const MASTHEAD_ROLE_FLAGS = "i";
export const MASTHEAD_MIN_HITS = 2;

// ---------------------------------------------------------------------------
// classifyLines(text) — the one algorithm. Returns an array parallel to
// text.split("\n") (same 0-based index privacy-check.mjs's own hit lines
// use, +1 to become the 1-based "path:line:text" number it reports),
// each entry either null or { category, label }.
// ---------------------------------------------------------------------------
const compiled = LINE_PATTERNS.map((p) => ({ ...p, re: new RegExp(p.source, p.flags) }));
const sigStartRe = new RegExp(SIG_START_SOURCE, SIG_START_FLAGS);
const sigStopRe = new RegExp(SIG_BLOCK_STOP_SOURCE, SIG_BLOCK_STOP_FLAGS);
const mastheadRoleRe = new RegExp(MASTHEAD_ROLE_SOURCE, MASTHEAD_ROLE_FLAGS);

export function classifyLines(text) {
  const lines = text.split("\n");
  const labels = new Array(lines.length).fill(null);

  // Pass 1: single-line categories (byline/credit/copyright/contact/form).
  for (let i = 0; i < lines.length; i++) {
    for (const p of compiled) {
      if (p.re.test(lines[i])) { labels[i] = { category: p.category, label: p.label }; break; }
    }
  }

  // Pass 2: signature blocks — a start line pulls in up to
  // SIG_BLOCK_MAX_LINES following lines, stopping at a blank line or a
  // structural stop pattern. Does not overwrite a line pass 1 already
  // labeled (e.g. a sig block's own contact-detail line keeps its more
  // specific "contact" label, still OOC either way).
  for (let i = 0; i < lines.length; i++) {
    if (!sigStartRe.test(lines[i])) continue;
    if (!labels[i]) labels[i] = { category: "signature", label: "signature line" };
    let taken = 0;
    for (let j = i + 1; j < lines.length && taken < SIG_BLOCK_MAX_LINES; j++) {
      if (!lines[j].trim()) break;
      if (sigStopRe.test(lines[j])) break;
      if (!labels[j]) labels[j] = { category: "signature", label: "signature block" };
      taken++;
    }
  }

  // Pass 3: masthead/staff-list candidates, only classed OOC when the
  // page carries MASTHEAD_MIN_HITS or more of them (see module header).
  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    if (mastheadRoleRe.test(lines[i])) candidates.push(i);
  }
  if (candidates.length >= MASTHEAD_MIN_HITS) {
    for (const i of candidates) {
      if (!labels[i]) labels[i] = { category: "masthead", label: "masthead/staff-list line" };
    }
  }

  return labels;
}

// oocLineNumbers(text) — 1-based line numbers (matching privacy-check.mjs's
// own hit-report numbering) that classifyLines marked OOC.
export function oocLineNumbers(text) {
  const labels = classifyLines(text);
  const set = new Set();
  for (let i = 0; i < labels.length; i++) if (labels[i]) set.add(i + 1);
  return set;
}

// oocLabelForLine(text, lineNumber1based) — the label a specific 1-based
// line got, or null if it is not an OOC structure.
export function oocLabelForLine(text, lineNumber1based) {
  const labels = classifyLines(text);
  const l = labels[lineNumber1based - 1];
  return l ? l.label : null;
}

// detectOocRanges(text) — CHARACTER ranges (this lane's brief asks for
// ranges, not just line numbers): contiguous runs of lines sharing the
// same label are merged into one { start, end, label } span, with start/
// end being character offsets into `text` (end exclusive, spanning
// through the run's own trailing newline so the range covers the full
// lines it labels).
export function detectOocRanges(text) {
  const labels = classifyLines(text);
  const lines = text.split("\n");
  const lineStarts = new Array(lines.length);
  let offset = 0;
  for (let i = 0; i < lines.length; i++) { lineStarts[i] = offset; offset += lines[i].length + 1; }

  const ranges = [];
  let i = 0;
  while (i < labels.length) {
    if (!labels[i]) { i++; continue; }
    const label = labels[i].label;
    let j = i;
    while (j + 1 < labels.length && labels[j + 1] && labels[j + 1].label === label) j++;
    const start = lineStarts[i];
    const end = j + 1 < lineStarts.length ? lineStarts[j + 1] : text.length;
    ranges.push({ start, end, label, category: labels[i].category });
    i = j + 1;
  }
  return ranges;
}

// ---------------------------------------------------------------------------
// Emit a JSON mirror for ooc_structures.py (no JS runtime dependency —
// same convention as text-markers.mjs/.json). Run:
// `node ooc-structures.mjs --emit-json`.
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes("--emit-json")) {
  const { writeFileSync } = await import("node:fs");
  const { resolve, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const out = resolve(dirname(fileURLToPath(import.meta.url)), "ooc-structures.json");
  writeFileSync(
    out,
    JSON.stringify(
      {
        _comment: "Generated by ooc-structures.mjs --emit-json. Do not hand-edit — edit ooc-structures.mjs and re-run.",
        line_patterns: LINE_PATTERNS,
        sig_start_source: SIG_START_SOURCE,
        sig_start_flags: SIG_START_FLAGS,
        sig_block_max_lines: SIG_BLOCK_MAX_LINES,
        sig_block_stop_source: SIG_BLOCK_STOP_SOURCE,
        sig_block_stop_flags: SIG_BLOCK_STOP_FLAGS,
        masthead_role_source: MASTHEAD_ROLE_SOURCE,
        masthead_role_flags: MASTHEAD_ROLE_FLAGS,
        masthead_min_hits: MASTHEAD_MIN_HITS,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`ooc-structures: wrote ${out}`);
}
