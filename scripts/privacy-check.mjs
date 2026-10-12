#!/usr/bin/env node
// privacy-check.mjs — structural enforcement of the privacy rule (CURATION
// rule 3 / v74). Three checks, all hard fails:
//
//   1. LEDGER SCAN — every `deny` term in the workshop's redaction ledger
//      (the workshop's redaction-ledger.tsv) is grepped, word-bounded and
//      case-insensitive, across every tracked/untracked-unignored file in
//      the museum tree. A hit anywhere — served doc, museum-voice prose,
//      registry JSON, frontier note — is a red gate. The ledger lives in
//      the workshop and is never committed or served; if it cannot be
//      found this check FAILS CLOSED rather than silently passing.
//      Rows come from TWO sources: the main ledger, plus the pending
//      fragment for the CURRENT branch only (ledger-pending/<branch>.tsv),
//      which is how a lane files rows without reddening every other lane.
//      Failures name the source. Other branches' fragments are never read.
//
//   2. USENET HEADER SCAN — served documents that look like Usenet posts
//      (carry a Newsgroups: or Message-ID: header) must not carry an
//      unredacted email address or a bang-path login tail on their
//      Path:/From:/Reply-To:/Sender:/X-*: header lines. The redaction
//      marker on the line satisfies the check. (The Path-header-login class.)
//
//   3. DISCLOSURE CONSISTENCY — any served page carrying the house
//      redaction marker must disclose its redactions in its provenance
//      line, and the disclosed count must match the marker count.
//      (The nsw rules.html/faqs.html sibling-miss class.)
//
// Born 2026-08-31 after three same-day catches proved vigilance alone
// doesn't hold: a sibling doc missed by a redaction pass, a wing's own
// epitaph naming living people in museum voice, and a frontier note doing
// the same. See the workshop's GAVELS.md and the workshop's privacy/README.md.
//
// Invariant 13 honored: the scan is rooted in git's own file list, which
// never includes .git/, and .claude/ is excluded explicitly.

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { oocLineNumbers } from "./ooc-structures.mjs";

let failures = 0;
let infoCount = 0;
const fail = (msg) => { failures++; console.error("PRIVACY-FAIL: " + msg); };
const info = (msg) => { infoCount++; console.log("PRIVACY-INFO: " + msg); };
// THE FULL IN-CHARACTER LIST (hook c225-ooc-credit-nearmiss, 2026-10-09): the console caps the global in-character INFO lines
// at 40 ("...and N more"), and a real writer credit hid behind that cap for weeks. Every in-character ledgered-name hit, global
// and scoped, is ALSO collected here, term-free, and written to the workshop's scratch beside the gate log (see the end of this
// file). Nothing here changes a console line, a count or the verdict.
const infoRows = []; // [scope, page, line, ledger source, ledger row, fp, class, length]
const infoFp = (t) => createHash("sha1").update(String(t).trim().toLowerCase()).digest("hex").slice(0, 8); // privacy-lookup.py's fp()

// ---------- CONTEXT-FIRST PRIVACY (PRIVACY-CONTEXT-01, 2026-09-13; the Janitor
// ruling of the same date, LANE-RULES.md rule 6) --------------------------
// A page's own documents.json doc_class decides whether a denied name is
// even ELIGIBLE for the in-character carve-out — only "card", "roleplay"
// and "rp" (plus any page physically served under a promotion's own rp/
// folder, since that folder is fiction by construction even on the rare
// row this lookup can't find) ever get it. Every other class (news/staff/
// board/rules/faq/index/charter/poll/other/roster/...) keeps today's
// unconditional rule: any ledger hit anywhere on the page is a failure,
// full stop — this block changes NOTHING about those pages' own behavior.
const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FICTION_CLASSES = new Set(["card", "roleplay", "rp"]);
let docClassMap = new Map();
try {
  const docs = JSON.parse(readFileSync(join(SCRIPT_ROOT, "data", "documents.json"), "utf8"));
  for (const d of docs.documents || []) if (d.page) docClassMap.set(d.page, d.doc_class);
} catch {
  // FAILS CLOSED to the pre-existing behavior: with no documents.json to
  // consult, isFictionPage() below falls back to the rp/-folder shape
  // test only, so every page's ledger hits keep failing exactly as they
  // did before this lane — the carve-out only ever WIDENS what serves,
  // never narrows the privacy check's own coverage.
}
// ---------- THE MEMORIAL EXEMPTION, BY CONSTRUCTION (MEMORIAL-EXEMPTION-01,
// 2026-09-24) ---------------------------------------------------------------
// CURATION #privacy / v74, verbatim: "A memorial name — an entry in
// `data/memorials.json` — is **never redacted**, in any document, under either
// exception." The Janitor's standing ruling, GAVELS 2026-09-24 evening, D2: "anyone
// added to the memorial section should remove restrictions on naming them" — a
// person on the memorial register is named freely wherever the record names
// him, the exemption applied BY CONSTRUCTION, not page by page. D5b, on his own
// read of Sean's thReat application: "memorial exemption rules here."
//
// So the REGISTER is read here, and a `deny` row whose term IS a memorial
// subject's own recorded name never enters denyGlobal/denyScoped at all. Three
// things follow, and they are the whole mechanism:
//   - it can never red the gate;
//   - it can never be named in a gate log; and therefore
//   - it can never be picked up by scripts/ops/redact-gate-hits.py or
//     scripts/ops/gate-fail-redact.py, which both resolve their terms FROM that
//     log — so no redaction pass can mark a memorial name again (the Paul
//     Scanlan / ReV 244 class, hand-fixed 2026-09-24).
// The ledger row is NOT rewritten and NOT deleted: its own catch provenance
// (msg_id, page, ruling) stays exactly where it was, and every suppression is
// reported as PRIVACY-INFO on every run, so a name collision stays visible
// forever instead of being erased once by a mechanical rewrite.
//
// ONLY THE SUBJECT'S OWN NAME(S): the register's `name`, any `aka`, and the
// forename+surname short form of a three-or-more-part name ("Sean Williams" for
// "Sean Simon Williams" — the form the register's own served_docs labels use and
// the form land-check's L-MEM has always accepted). A relative, a fiancée, a
// fellow writer or anyone else named NEAR a memorial subject is a different
// term and is untouched: the 2026-09-24 ReV 244 tribute keeps its own four
// redactions, because none of those three terms is a memorial name.
//
// THE ONE ESCAPE HATCH, explicit on purpose: a deny row a curator has RULED to
// be a different person who happens to share the name (CURATION's own "James F"
// coincidence precedent) carries class `real-name-collision` or the literal
// token MEMORIAL-COLLISION in its note, and keeps denying. No row carries it
// today; it exists so a ruled namesake has somewhere to live other than a
// silent hole in the exemption.
//
// FAILS IN THE SAFE DIRECTION: if data/memorials.json cannot be read the
// exemption is EMPTY and every ledger row stands, exactly as before this block.
const memorialNames = new Set(); // lowercased
try {
  const mem = JSON.parse(readFileSync(join(SCRIPT_ROOT, "data", "memorials.json"), "utf8"));
  for (const r of (mem.memorials || mem || [])) {
    for (const n of [r?.name, ...(r?.aka || [])]) {
      if (!n) continue;
      memorialNames.add(String(n).toLowerCase());
      const parts = String(n).trim().split(/\s+/);
      if (parts.length > 2) memorialNames.add(`${parts[0]} ${parts[parts.length - 1]}`.toLowerCase());
    }
  }
} catch { /* empty exemption; every row stands */ }
const memorialSuppressed = []; // {row, cls, term, source} — reported after rowTag exists
const RP_FOLDER_RE = /^promotions\/[^/]+\/rp\//;
function isFictionPage(relPath) {
  const cls = docClassMap.get("/" + relPath);
  if (cls && FICTION_CLASSES.has(cls)) return true;
  return RP_FOLDER_RE.test(relPath);
}
// Per-file OOC-line-number cache (ooc-structures.mjs's own classifyLines()
// walks the whole file once; no reason to repeat that per ledger hit).
const oocLineCache = new Map();
function isOocLine(relPath, text, lineNumber1based) {
  let set = oocLineCache.get(relPath);
  if (!set) { set = oocLineNumbers(text); oocLineCache.set(relPath, set); }
  return set.has(lineNumber1based);
}
// Disclosure consistency is HARD law (the 2026-08-31 legacy sweep cleared
// all 146 debts; every marker-carrying page now discloses a matching count).
let disclosureWarns = 0;
const disclosure = fail;

// ---------- locate the ledger (works from main tree AND any worktree) ----
function findLedger() {
  if (process.env.PRIVACY_LEDGER) return process.env.PRIVACY_LEDGER;
  // WORKSHOP_ROOT (ops/config.env) is the general answer: it lets a clone live
  // anywhere instead of only beside an "archive" sibling. Without it we keep the
  // historical convention exactly, so nothing about an existing checkout changes.
  if (process.env.WORKSHOP_ROOT) return join(process.env.WORKSHOP_ROOT, "privacy", "redaction-ledger.tsv");
  // main repo root = parent of the COMMON git dir, even inside a worktree
  const commonDir = execSync("git rev-parse --path-format=absolute --git-common-dir", { encoding: "utf8" }).trim();
  return join(dirname(commonDir), "..", "archive", "privacy", "redaction-ledger.tsv");
}

const ledgerPath = findLedger();
if (!existsSync(ledgerPath)) {
  console.error("PRIVACY-FAIL: ledger not found at " + ledgerPath);
  console.error("The privacy check fails CLOSED. Set PRIVACY_LEDGER or restore the workshop ledger.");
  console.error("privacy-check: RED");
  process.exit(2);
}

// ---------- the current branch's pending fragment ------------------------
// A lane never appends to the main ledger: a deny row filed from one
// worktree reddens main and EVERY other worktree on that term until the
// lane's own redaction merges (the cross-lane ledger race, hit seven times
// on 2026-09-02). Lanes file their new rows in
// the ledger's pending fragment <branch>.tsv instead; the coordinator
// folds the fragment into the main ledger at merge time
// (scripts/ledger-fold.mjs). So this check loads the main ledger PLUS the
// fragment for the CURRENT branch only. On main, no fragment is read at
// all. A missing ledger-pending/ directory or fragment is a no-op.
function fragmentName(branch) { return branch.replace(/\//g, "-") + ".tsv"; }
function findFragment(ledger) {
  let branch = "";
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
  } catch { return null; }
  if (!branch || branch === "main" || branch === "HEAD") return null;
  return join(dirname(ledger), "ledger-pending", fragmentName(branch));
}

const denyGlobal = [];  // {term, source}
const denyScoped = [];  // {term, scope, source}
const allowTerms = [];  // lowercased; judged-servable handles/logins
const allowScoped = []; // {term, scope, source}: allow overrides deny only under these path prefixes
function loadRows(path, source) {
  const lines = readFileSync(path, "utf8").split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    // PRIVACY-SAFE ROW CITATION (2026-09-06, wave-C90-L188): 1-based
    // line number in THIS file (the main ledger, or the branch's own
    // ledger-pending fragment) — counted over every line including
    // comments/blanks, i.e. exactly what a human would see opening the
    // file in an editor and jumping to this line. This is the ONLY
    // thing any report below ever cites for a row from here on;
    // the term's own text is never printed.
    const row = li + 1;
    if (!line.trim() || line.startsWith("#")) continue;
    const cols = line.split("\t");
    const [term, cls, status, scope] = cols;
    if (!term) continue;
    // MEMORIAL-EXEMPTION-01: the register, not a hand-filed allow row, is what
    // exempts a memorial subject's own name. Suppressed BEFORE the deny row can
    // reach denyGlobal/denyScoped, so nothing downstream of this loop — the
    // scan, the gate log, the redaction handlers that read that log — can ever
    // see it. Allow rows are left alone (an unscoped one still feeds the Usenet
    // header check below, and a scoped one still carves out other terms).
    if (status && status.startsWith("deny") && memorialNames.has(term.trim().toLowerCase())) {
      const note = cols[5] || "";
      const ruledNamesake = (cls || "").trim() === "real-name-collision" || note.includes("MEMORIAL-COLLISION");
      if (!ruledNamesake) {
        memorialSuppressed.push({ term: term.trim(), row, source, cls: (cls || "").trim() });
        continue;
      }
    }
    if (status === "allow") {
      // SCOPED ALLOW (2026-09-04 guardrail): an allow row WITH a scope overrides a deny row for that term
      // only inside those path prefixes (a served in-fiction persona or a v105(a) self-insert carve-out);
      // an allow row without a scope keeps its old meaning (a judged-servable handle/login for header checks).
      if (scope && scope.trim()) allowScoped.push({ term: term.trim(), scope: scope.trim(), source, row, cls: (cls || "").trim() });
      else allowTerms.push(term.trim().toLowerCase());
      continue;
    }
    if (status !== "deny") continue;
    // TAKEDOWN ROWS (D177 (b), the Janitor 2026-10-01): a deny row filed for a takedown carries the CURATION anchor
    // "#takedown-policy" in its note column (every takedown row the hooks append does: #1 von Doom, #2, #3, #4). Such a
    // name was taken down at its owner's request, so the in-character carve-out below never applies to it: a hit on a
    // card/roleplay/rp page fails like any other page instead of dropping to PRIVACY-INFO.
    const takedown = (cols[5] || "").includes("#takedown-policy");
    if (scope && scope.trim()) denyScoped.push({ term: term.trim(), scope: scope.trim(), source, row, cls: (cls || "").trim(), takedown });
    else denyGlobal.push({ term: term.trim(), source, row, cls: (cls || "").trim(), takedown });
  }
}
loadRows(ledgerPath, "ledger");

const fragmentPath = findFragment(ledgerPath);
const fragmentLoaded = Boolean(fragmentPath && existsSync(fragmentPath));
if (fragmentLoaded) loadRows(fragmentPath, "fragment " + basename(fragmentPath));

const denyTerms = denyGlobal.map((d) => d.term); // global list feeds the bulk scan
// Which source(s) put a term in this line — so a red gate says whether it
// came from the shared ledger or from this branch's own pending fragment.
// UNICODE-AWARE WORD BOUNDARY (2026-09-05, wave-C90-L136): plain `\b` in a
// non-Unicode-flagged JS regex only treats ASCII [A-Za-z0-9_] as "word"
// characters, so a term that STARTS or ENDS with an accented Latin letter
// (à è ì ò ù, ñ, ç, ß, ł…) sits at a boundary the old regex could not see
// — two non-word characters (the accented letter, then a space/comma/EOF)
// on either side of the assertion point is not a `\b` transition, so the
// term silently fails to match text a human eye reads as the same word.
// Confirmed by direct reproduction (the workshop's
// wave-C90-L136/boundary-test.mjs): "Andrè " / "Andrè," / "José" at EOL /
// "Łukasz" / "Weiß" all missed under the old `\b…\b`, `i` regex. Lookaround
// assertions against `\p{L}\p{N}_` under the `u` flag treat every Unicode
// letter/number as a word character, matching the old ASCII behavior
// exactly for plain-ASCII terms (no regression there) while fixing the
// accented-edge case. See the workshop's italian-efed-wiki-plan-2026-09-05.md
// §3b for the original reasoned-risk flag this closes out.
const WORD_BEFORE = "(?<![\\p{L}\\p{N}_])";
const WORD_AFTER = "(?![\\p{L}\\p{N}_])";
const wordRe = (t) => new RegExp(WORD_BEFORE + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + WORD_AFTER, "iu");
const denyRes = denyGlobal.map((d) => ({ source: d.source, re: wordRe(d.term), row: d.row, cls: d.cls, term: d.term, takedown: d.takedown }));
// TAKEDOWN JOINED FORMS (hook c50, coordinator lane TAKEDOWN-MACHINERY 2026-10-04): wordRe sees a takedown name only as
// written with a space. On 2026-10-04 lanes found a full name fused into an image URL's album segment, a dot-joined
// speaker label and source-URL usernames on the served tree with every scan green. So a #takedown-policy deny row (and
// ONLY such a row; every real-name row would flood) of two or more letter/digit runs also matches those runs joined by
// nothing, "-", "_", ".", "+" or "%20". Its edges are letters/digits only ("_" and "." may touch it, as in a URL path or
// a file name). A joined hit is reported, tagged and redacted as its own row; a scoped allow covers it only where an
// allow for the same term reaches the page (none exist today); a takedown row never takes the in-character carve-out.
const JOIN_SEP = "(?:|[-_.+]|%20)";
const JOIN_BEFORE = "(?<![\\p{L}\\p{N}])";
const JOIN_AFTER = "(?![\\p{L}\\p{N}])";
const joinRuns = (t) => t.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const joinedRe = (t) => new RegExp(JOIN_BEFORE + joinRuns(t).map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(JOIN_SEP) + JOIN_AFTER, "iu");
const joinKey = (t) => joinRuns(t).reduce((a, b) => (b.length > a.length ? b : a), ""); // prefilter: every joined form contains its longest run
const joinedRes = denyGlobal.filter((d) => d.takedown && joinRuns(d.term).length >= 2)
  .map((d) => ({ source: d.source, re: joinedRe(d.term), row: d.row, cls: d.cls, term: d.term, takedown: true, joined: true, allowKey: String(wordRe(d.term)), key: joinKey(d.term) }));
const denyResAll = denyRes.concat(joinedRes);
// A-Z CARD ANCHORS (hook c280, lane AZ-ALLOW-DURABLE 2026-10-11; board card az-bucket-allow-drift). Gates 376 and 394 went
// red on one allow (ledger row 16589, the Janitor's D485) because its scope named the A-Z roster PAGE that held the card
// (characters/a-z/ppo-ppy.html): the register's file names are chunk boundaries of a sorted list, so new mints re-split
// the bucket, the card moved to ppo-ppu.html and then ppo-pps.html, and the allow no longer reached it. A scope part
// "characters/a-z/#<character id>" therefore names that character's ROSTER CARD wherever it lives: it covers a hit only
// on a line of a characters/a-z/*.html page that the card with that id owns (the line that opens
// <div class="roster-card" id="<id>" at its start, through the line that closes it, when that line ends with the card's
// own </div>). It covers nothing else on the page -- not another card, not the page's header -- and nothing on any other
// path: as a path prefix it matches no file (no file name begins with "#"), so every prefix test below is unchanged. Only
// allow rows read it; a deny row's anchor is ignored as before. scripts/fixers/fix-az-allow-cards.py turns an allow's
// characters/a-z/<file>.html parts into anchors, each bound to the cards it covered on that page.
const AZ_DIR = "characters/a-z/";
const AZ_ANCHOR = AZ_DIR + "#";
function azCardsOf(scope) {
  return new Set(scope.split(",").map((x) => x.trim().replace(/^\/+/, "")).filter((x) => x.startsWith(AZ_ANCHOR) && x.length > AZ_ANCHOR.length).map((x) => x.slice(AZ_ANCHOR.length)));
}
const azSpanCache = new Map(); // a-z page -> per line, the id of the roster card that owns it (or null)
function azCardAt(path, lineNo) {
  if (!path.startsWith(AZ_DIR) || !path.endsWith(".html") || path.indexOf("/", AZ_DIR.length) !== -1) return null;
  let span = azSpanCache.get(path);
  if (span === undefined) {
    span = null;
    let text = null; try { text = readFileSync(path, "utf8"); } catch { text = null; }
    if (text !== null) {
      span = [];
      let cur = null, depth = 0;
      for (const ln of text.split("\n")) {
        const m = cur === null ? /^\s*<div class="roster-card" id="([^"]+)"/.exec(ln) : null;
        if (m) { cur = m[1]; depth = 0; }
        let owner = cur;
        if (cur !== null) {
          depth += (ln.match(/<div[\s>]/g) || []).length - (ln.match(/<\/div>/g) || []).length;
          if (depth <= 0) {
            if (!/<\/div>\s*$/.test(ln)) owner = null; // something after the card on its closing line: not the card's
            cur = null; depth = 0;
          }
        }
        span.push(owner);
      }
    }
    azSpanCache.set(path, span);
  }
  return span && lineNo >= 1 && lineNo <= span.length ? span[lineNo - 1] : null;
}
const azCovers = (cards, path, lineNo) => cards.size > 0 && lineNo !== null && cards.has(azCardAt(path, lineNo));
const allowRes = allowScoped.map((a) => ({ re: wordRe(a.term), prefixes: a.scope.split(",").map((x) => x.trim()).filter(Boolean), term: a.term.toLowerCase(), cards: azCardsOf(a.scope) }));
// SITEMAP ENTRIES UNDER THEIR PAGE'S SCOPE (hook c97, lane PRIVACY-SCOPE 2026-10-06; the Janitor's D401 (b)). Gate 297 went red
// because a character id spells a withheld surname: a global deny hit the two sitemap.xml <loc> lines that list that character's
// pages, while the allow covering those pages did not name sitemap.xml. A sitemap.xml line carrying exactly ONE <loc>...</loc>
// is therefore judged under the scope of the repo path its URL names as well as its own: /x/y.html -> x/y.html, /x/ ->
// x/index.html (scheme and host dropped, percent-decoded). An allow whose scope covers that page covers the line (allowedHit);
// a PAGE-scoped deny on that page applies to the line (the scoped pass below). A line with no or several <loc>, or a path with
// "..", is judged as before. Never narrower for a global deny: the strict every-term rule in allowedHit is unchanged, so a term
// in a sitemap URL whose page no allow covers still fails.
const SITEMAP = "sitemap.xml";
const sitemapPage = (path, text) => {
  if (path !== SITEMAP) return null;
  const locs = text.match(/<loc>[^<]*<\/loc>/g);
  if (!locs || locs.length !== 1) return null;
  let p = locs[0].slice(5, -6).trim().replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "").split(/[?#]/)[0];
  try { p = decodeURIComponent(p); } catch { /* keep it as written */ }
  p = p.replace(/^\/+/, "");
  if (p.split("/").includes("..")) return null;
  return p === "" || p.endsWith("/") ? p + "index.html" : p;
};
// A hit line "path:line:text" is allowed when a scoped allow row covers the path and its term is the (only) term on that line.
const allowedHit = (line) => {
  const path = line.split(":")[0];
  const text = line.slice(path.length + 1).replace(/^\d+:/, "");
  const page = sitemapPage(path, text); // hook c97: a sitemap entry is also covered where an allow covers its page
  const azLine = /^(\d+):/.exec(line.slice(path.length + 1)); // hook c280: the hit's line, for an A-Z card anchor
  const azNo = azLine ? parseInt(azLine[1], 10) : null;
  const cover = allowRes.filter((a) => (a.prefixes.some((pfx) => path.startsWith(pfx) || (page !== null && page.startsWith(pfx))) || azCovers(a.cards, path, azNo)) && a.re.test(text));
  if (!cover.length) return false;
  // strict: every deny term matching this line must be covered by an allow row
  // hook c72 (lane ALLOW-MISS-7018): compare the TERMS case-insensitively, as every match here is ("iu"). The old test compared
  // String(regex), whose source keeps each row's own casing, so an allow filed in a different case from its deny row never
  // covered it (ledger 14104 vs 3080, thReat news 7018, gate 257). A joined takedown form is covered by an allow of its own term.
  return denyResAll.filter((d) => d.re.test(text)).every((d) => cover.some((a) => a.term === d.term.toLowerCase()));
};
const sourcesFor = (line) => {
  const hit = [...new Set(denyResAll.filter((d) => d.re.test(line)).map((d) => d.source))];
  return hit.length ? ` [${hit.join(" + ")}]` : "";
};

// ---------- privacy-safe ledger-row tag (2026-09-06, wave-C90-L188) -------
// House rule (a pre-existing leak wave-C90-L166 flagged): stdout/stderr
// from this script must NEVER print ledger term text. Every place that
// used to interpolate a deny/allow term into a console.error/warn/log
// line now cites instead: the ledger ROW NUMBER (1-based line number in
// the ledger file or branch fragment the row came from), the row's
// `class` column, the term's length in characters, and a 6-hex-char
// sha1 prefix of the lowercased term. That is enough to find and verify
// the exact row against the ledger file directly (open the file, jump
// to the line, confirm class/length/hash match) — never enough to
// reconstruct the term from the log alone. File paths and the hit's own
// line number IN THE MUSEUM TREE (not the ledger row) are unchanged.
const shaPrefix = (t) => createHash("sha1").update(String(t).toLowerCase()).digest("hex").slice(0, 6);
const rowTag = (entry) => `ledger-row ${entry.row}${entry.cls ? ` class=${entry.cls}` : ""} len=${entry.term.length} sha1=${shaPrefix(entry.term)}${entry.joined ? " form=joined" : ""}`;
// Redact every ledger term's matched span inside a snippet of MUSEUM
// TREE text (never ledger text) with the literal marker "[term]", so a
// quoted line of surrounding context never carries the term either.
const redactContext = (text) => {
  let out = text;
  for (const d of denyResAll) {
    const re = new RegExp(d.re.source, d.re.flags.includes("g") ? d.re.flags : d.re.flags + "g");
    out = out.replace(re, "[term]");
  }
  return out;
};

// ---------- report the memorial exemption's own work (MEMORIAL-EXEMPTION-01) --
// Privacy-safe, same house rule as every other report here: the term is never
// printed, only its ledger-row tag. An inert deny row is worth saying out loud
// once per run — it is either a row to retire, or a namesake question for the
// desk, and either way a silent suppression is how the ledger would rot.
for (const s of memorialSuppressed) {
  info(`memorial exemption (CURATION #privacy v74; GAVELS 2026-09-24 D2): deny row suppressed by data/memorials.json {[${s.source}] ${rowTag(s)}} — the register is the exemption; this row is inert and wants retiring or a namesake ruling`);
}

// ---------- the file list (tracked + untracked-unignored, minus .claude) --
const fileListAll = execSync("git ls-files -co --exclude-standard -z", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\0")
  .filter((f) => f && !f.startsWith(".claude/") && !f.startsWith("node_modules/"));
// ---------- THE TARGETED RE-CHECK (hook c226-red-handler-targeted, 2026-10-09) -------------------------------------------
// `--only-files <list>` (one repo-relative path per line): every check below runs exactly as on the whole tree, over git's own
// file list INTERSECTED with the listed paths. scripts/ops/red-handler.sh uses it to re-check a privacy red on only the files
// that red named (seconds, not a whole-tree scan); a pass there is never a verdict: the handler goes on to preflight and the
// full gate, whose `npm run privacy` carries no flag and scans the whole tree. An argv flag, never an environment variable, so
// it cannot reach the gate's own run by inheritance. An unreadable or empty list FAILS CLOSED.
let onlyFiles = null;
{
  const oi = process.argv.indexOf("--only-files");
  if (oi !== -1) {
    let raw = null;
    try { raw = readFileSync(process.argv[oi + 1] || "", "utf8"); } catch { raw = null; }
    const want = raw === null ? [] : [...new Set(raw.split("\n").map((s) => s.trim()).filter(Boolean))];
    if (!want.length) {
      console.error("PRIVACY-FAIL: targeted re-check: the --only-files list is missing, unreadable or empty");
      console.error("privacy-check: RED");
      process.exit(2);
    }
    onlyFiles = new Set(want);
  }
}
const fileList = onlyFiles ? fileListAll.filter((f) => onlyFiles.has(f)) : fileListAll;
if (onlyFiles) console.log(`privacy-check: TARGETED re-check (hook c226): ${fileList.length} of ${onlyFiles.size} listed file(s) are in the tree's ${fileListAll.length}; not a gate verdict`);

// ---------- Aho–Corasick multi-pattern matcher (2026-09-06, wave-C90-L166) -
// wave-C90-L136's patch (see its digest.md §3) fixed the accented-boundary
// bug but left the denyGlobal candidate scan at O(files × terms): one
// `String#includes` call per term per file (~1,800 × ~39,000 ≈ 70M calls),
// measured there at ~6 minutes full-tree — too slow to fold into a gate
// that already runs 15 minutes. This automaton finds candidate hits for
// ALL global terms in ONE left-to-right scan per file — O(file length),
// not O(file length × terms) — by building a single trie over every
// case-folded global term with the standard Aho–Corasick failure-link
// construction (goto + fail + merged output sets), so every position in
// the text is visited exactly once regardless of how many terms exist.
// The boundary/verification step is UNCHANGED from L136's patch: a
// candidate is only ever a report if `wordRe` (the Unicode-aware
// lookaround) also matches on that specific line. The automaton only
// answers "which terms occur as a substring, and on which line" — the
// same question L136's per-file `includes` pre-filter answered, just in
// one pass instead of ~1,800.
class AhoCorasick {
  constructor(patterns) {
    // patterns: array of already-lowercased strings. Indexed by UTF-16
    // code unit throughout (both insert and search), matching the code-unit
    // semantics of String#includes/indexOf — no surrogate-pair mismatch
    // between insertion (which would otherwise iterate by code POINT via
    // `for...of`) and search (which indexes by code unit).
    this.children = [new Map()]; // trie node 0 = root
    this.fail = [0];
    this.output = [[]];          // output[node] = pattern indices ending here (after fail-merge)
    for (let i = 0; i < patterns.length; i++) this.insert(patterns[i], i);
    this.buildFailureLinks();
  }
  insert(pattern, idx) {
    let node = 0;
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      let next = this.children[node].get(ch);
      if (next === undefined) {
        next = this.children.length;
        this.children.push(new Map());
        this.fail.push(0);
        this.output.push([]);
        this.children[node].set(ch, next);
      }
      node = next;
    }
    this.output[node].push(idx);
  }
  buildFailureLinks() {
    const queue = [];
    for (const child of this.children[0].values()) {
      this.fail[child] = 0;
      queue.push(child);
    }
    let qi = 0;
    while (qi < queue.length) {
      const u = queue[qi++];
      for (const [ch, v] of this.children[u]) {
        queue.push(v);
        let f = this.fail[u];
        while (f !== 0 && !this.children[f].has(ch)) f = this.fail[f];
        const cand = this.children[f].get(ch);
        this.fail[v] = (cand !== undefined && cand !== v) ? cand : 0;
        if (this.output[this.fail[v]].length) this.output[v] = this.output[v].concat(this.output[this.fail[v]]);
      }
    }
  }
  // Single left-to-right scan of `lowerText`. Calls `onLine(lineIndex, patternIdxSet)`
  // once per line that has ANY candidate pattern ending on it (0-based line
  // index, counted by '\n' — computed in the SAME pass as the match scan,
  // so this is one true single pass over the text, not a scan plus a
  // separate newline-counting pass).
  scanLines(lowerText, onLine) {
    let node = 0;
    let line = 0;
    let curSet = null; // Set of pattern indices accumulated for the current line
    for (let i = 0; i < lowerText.length; i++) {
      const ch = lowerText[i];
      if (ch === "\n") {
        if (curSet) { onLine(line, curSet); curSet = null; }
        line++;
        node = 0; // a match can't span a line break (no ledger term contains '\n')
        continue;
      }
      while (node !== 0 && !this.children[node].has(ch)) node = this.fail[node];
      const next = this.children[node].get(ch);
      node = next !== undefined ? next : 0;
      const out = this.output[node];
      if (out.length) {
        if (!curSet) curSet = new Set();
        for (const idx of out) curSet.add(idx);
      }
    }
    if (curSet) onLine(line, curSet);
  }
}

// ---------- 1. ledger scan ------------------------------------------------
// 2026-09-05 (wave-C90-L136): this used to shell out to `grep -HniwF -f`
// over the whole tree via xargs. On the GNU grep build tested here that
// path happened to treat multi-byte UTF-8 letters as word-constituent (so
// it did NOT reproduce the accented-boundary miss on its own — verified
// empirically, see L136's digest.md), but that is an unspecified,
// build/locale-dependent grep behavior, not a documented contract; its `-i`
// case-fold ALSO silently stopped covering accented uppercase under
// LC_ALL=C (also in L136's digest.md) — and it meant denyGlobal (grep) and
// denyScoped (already pure `wordRe`, below) ran on two DIFFERENT, silently
// divergent boundary mechanisms. Folding denyGlobal onto the same
// Unicode-aware `wordRe` removes all of that: one formally-defined
// (ECMA-262 `\p{L}`/`\p{N}`, Unicode case-folding independent of OS locale)
// rule for every deny term.
//
// L136 replaced the grep shell-out with a per-file `String#includes`
// pre-filter (one call per term per file) — correct, but O(files × terms)
// (measured ~6 minutes full-tree, see its digest.md §3). This scan instead
// builds ONE Aho–Corasick automaton over every case-folded global term
// (built once, reused across all files) and walks each file's case-folded
// text exactly once (`AhoCorasick.scanLines`, above) to find every line
// that contains ANY term as a candidate substring — O(file length), not
// O(file length × terms). Only candidate lines then pay the `wordRe`
// boundary check, exactly as L136 did (same shape, same rule) — a false
// substring hit (glued to a longer word) still gets filtered by the
// boundary regex before ever becoming a report. Same hit-line shape
// ("path:line:text") feeds `allowedHit`/`sourcesFor` unchanged.
if (denyTerms.length) {
  // hook c50: the automaton also carries each takedown joined form's prefilter key (index >= denyTerms.length)
  const lowerTerms = denyTerms.map((t) => t.toLowerCase()).concat(joinedRes.map((j) => j.key));
  const automaton = new AhoCorasick(lowerTerms);
  const hits = [];
  for (const f of fileList) {
    let text; try { text = readFileSync(f, "utf8"); } catch { continue; }
    const lowerText = text.toLowerCase();
    const lines = text.split("\n");
    automaton.scanLines(lowerText, (lineIdx, candidateSet) => {
      const line = lines[lineIdx];
      if (line === undefined) return; // defensive; text.split("\n") always has >= line count seen
      for (const i of candidateSet) {
        if (i < denyTerms.length ? wordRe(denyTerms[i]).test(line) : joinedRes[i - denyTerms.length].re.test(line)) {
          hits.push(`${f}:${lineIdx + 1}:${line}`);
          return; // one hit per matching line, same as grep's own per-line report
        }
      }
    });
  }
  const kept = hits.filter((h) => !allowedHit(h));
  // PRIVACY-SAFE HIT REPORT (2026-09-06, wave-C90-L188): file path and
  // the hit's own line number in the MUSEUM TREE are unchanged; the
  // matched term itself is never printed, and the quoted context has
  // every ledger term's matched span replaced with the literal "[term]"
  // marker.
  //
  // CONTEXT-FIRST SPLIT (PRIVACY-CONTEXT-01, 2026-09-13): a hit on a
  // card/roleplay/rp page (or an rp/-folder page) whose own line is NOT
  // one of ooc-structures.mjs's seven out-of-character shapes is not a
  // failure — it is exactly the "wrestler billing / on-screen persona /
  // signing target named in dialogue" case the Janitor's ruling exists
  // to stop misreading as a leak. It still gets reported, as INFO, with
  // page:line, so a human can file a page-scoped ALLOW row later; it
  // never touches `failures` or the exit code. Every other page (every
  // other doc_class, and every fiction-class hit that DOES land inside
  // an OOC structure) fails exactly as before — nothing about their
  // reporting changed except, where useful, naming which structure a
  // fiction-class failure landed in.
  let infoCapped = 0, failCapped = 0;
  for (const h of kept) {
    const path = h.split(":")[0];
    const afterPath = h.slice(path.length + 1);
    const lineNoMatch = afterPath.match(/^(\d+):/);
    const lineNo = lineNoMatch ? parseInt(lineNoMatch[1], 10) : null;
    const text = afterPath.replace(/^\d+:/, "");
    const matched = denyResAll.filter((d) => d.re.test(h));
    const tagStr = matched.length
      ? matched.map((d) => `[${d.source}] ${rowTag(d)}`).join("; ")
      : "(no matching ledger row resolved)";
    const context = `${path}:${lineNo ?? "?"}:${redactContext(text.slice(0, 300))}`;

    let ooc = null; // null = context rule doesn't apply to this page at all
    if (lineNo !== null && isFictionPage(path)) {
      let fullText; try { fullText = readFileSync(path, "utf8"); } catch { fullText = null; }
      if (fullText !== null) ooc = isOocLine(path, fullText, lineNo);
    }

    const takedownHit = matched.some((d) => d.takedown); // D177 (b): a takedown row gets no in-character carve-out
    if (ooc === false && !takedownHit) {
      { const onLine = denyResAll.filter((d) => d.re.test(text)); // hook c225: the full list (rows matching the line itself)
        for (const d of (onLine.length ? onLine : matched)) infoRows.push(["global", path, lineNo ?? "?", d.source, d.row, infoFp(d.term), d.cls || "", d.term.length]); }
      if (infoCapped < 40) info(`in-character use of a ledgered name {${tagStr}}: ${context}`);
      infoCapped++;
    } else {
      const oocNote = ooc === true ? " [out-of-character structure]" : (ooc === false ? " [takedown row: no in-character carve-out]" : "");
      if (failCapped < 40) fail(`ledger term in tree {${tagStr}}${oocNote}: ${context}`);
      failCapped++;
    }
  }
  if (failCapped > 40) fail(`...and ${failCapped - 40} more ledger hits`);
  if (infoCapped > 40) info(`...and ${infoCapped - 40} more in-character ledgered-name hits`);
}
// SCOPED ROWS, ONE PASS (hook c69, lane D338B-PRIVACY-SINGLE-PASS 2026-10-05; the Janitor's D338). This loop used to run
// row-major: for each of ~6,400 scoped deny rows it filtered the whole ~112k-file list by prefix (~715M startsWith calls)
// and re-read and re-split every in-scope file once per row (~2.1M reads). WHAT IT CHECKS IS UNCHANGED; only how:
//   - the rows' scope prefixes are indexed once (prefix -> rows), and each file looks up only the prefix lengths that
//     exist, so a file meets exactly the rows whose scope covers it, minus the rows whose same-term scoped allow covers it
//     (the old per-row `scopedFiles` filter, row by row);
//   - each covered file is read and split ONCE, and its fiction class taken once;
//   - one alternation regex per distinct candidate-row set (cached), over each row's term (and joined form) WITHOUT the
//     boundary lookarounds and with the same flags (iu), is tested on the whole text first. Dropping a lookaround only
//     widens a match, so the gate can never skip a file where any candidate row would hit;
//   - a row is then tested against the file's whole text with the SAME regex (and joined regex). That is an exact
//     prefilter: a term (and a joined form) never spans "\n", and the word-boundary lookarounds see "\n" exactly as they
//     see a line's own start or end, so the whole text matches iff some line matches. Only a matching row runs the same
//     per-line loop as before, with the same INFO/FAIL rules and the same once-per-file FAIL;
//   - the report lines are BUFFERED per row and printed afterwards in row order, files in file-list order within a row,
//     so stdout, stderr, the counters and the exit code come out byte-identical to the row-major loop (proved on the live
//     tree and on perturbed scratch trees; see the workshop's c69-privacy-single-pass.sh).
{
  const scopedRows = denyScoped.map(({ term, scope, source, row, cls, takedown }) => ({
    term, source, row, cls, takedown,
    prefixes: scope.split(",").map((x) => x.trim()).filter(Boolean),
    allowPfx: allowScoped.filter((a) => a.term.toLowerCase() === term.toLowerCase()).flatMap((a) => a.scope.split(",").map((x) => x.trim()).filter(Boolean)),
    allowCards: new Set(allowScoped.filter((a) => a.term.toLowerCase() === term.toLowerCase()).flatMap((a) => [...azCardsOf(a.scope)])), // hook c280
    re: wordRe(term),
    // hook c50: a scoped takedown row of two or more runs is matched in its joined forms too (none exist today)
    jre: takedown && joinRuns(term).length >= 2 ? joinedRe(term) : null,
    // the gate's alternative for this row: the term itself (and its joined forms) WITHOUT the boundary lookarounds, so a
    // match of re/jre always implies a match of lit (a superset, never a narrowing)
    lit: (() => {
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const alts = [esc(term)];
      if (takedown && joinRuns(term).length >= 2) alts.push(joinRuns(term).map(esc).join(JOIN_SEP));
      return alts.map((a) => "(?:" + a + ")").join("|");
    })(),
  }));
  const GATE_CHUNK = 256;
  const gateCache = new Map(); // a file's candidate-row set -> one alternation regex over those rows' lits (flags iu)
  const byPrefix = new Map(); // scope prefix -> row indices
  for (let r = 0; r < scopedRows.length; r++) {
    for (const pfx of scopedRows[r].prefixes) {
      let list = byPrefix.get(pfx);
      if (!list) { list = []; byPrefix.set(pfx, list); }
      list.push(r);
    }
  }
  const pfxLengths = [...new Set([...byPrefix.keys()].map((p) => p.length))].sort((a, b) => a - b);
  const seenAt = new Int32Array(scopedRows.length); // dedupe a row reached through two of its own prefixes
  const reports = scopedRows.map(() => null);      // per row: [isFail, message] in file-list order
  for (let fi = 0; fi < fileList.length; fi++) {
    const f = fileList[fi];
    const stamp = fi + 1;
    const cand = [];
    for (const L of pfxLengths) {
      if (L > f.length) break;
      const list = byPrefix.get(f.slice(0, L));
      if (!list) continue;
      for (const r of list) {
        if (seenAt[r] === stamp) continue;
        seenAt[r] = stamp;
        if (scopedRows[r].allowPfx.some((pfx) => f.startsWith(pfx))) continue;
        cand.push(r);
      }
    }
    // hook c97 (D401 (b)): a sitemap <loc> line is judged under its page's scope too. A PAGE-scoped deny row (a scope part equal
    // to the page's own repo path, found in byPrefix by one lookup) is tested on the line that lists that page, unless a
    // same-term allow covers the page or sitemap.xml. A row whose own scope already covers sitemap.xml is judged on the whole
    // file below, as before. One FAIL per row per file; the page path is never printed (a slug can spell a term).
    if (f === SITEMAP) {
      let stext; try { stext = readFileSync(f, "utf8"); } catch { stext = null; }
      const done = new Set();
      const slines = stext === null ? [] : stext.split("\n");
      for (let li = 0; li < slines.length; li++) {
        const page = sitemapPage(f, slines[li]);
        const list = page === null ? null : byPrefix.get(page);
        if (!list) continue;
        for (const r of list) {
          if (done.has(r)) continue;
          const sr = scopedRows[r];
          if (sr.prefixes.some((pfx) => f.startsWith(pfx))) continue;
          if (sr.allowPfx.some((pfx) => f.startsWith(pfx) || page.startsWith(pfx))) continue;
          if (!sr.re.test(slines[li]) && !(sr.jre && sr.jre.test(slines[li]))) continue;
          (reports[r] || (reports[r] = [])).push([true, `scoped ledger term ${rowTag({ term: sr.term, row: sr.row, cls: sr.cls })} [${sr.source}] in ${f}:${li + 1} (sitemap entry, judged under its page's scope; hook c97)`]);
          done.add(r);
        }
      }
    }
    if (!cand.length) continue;
    let text; try { text = readFileSync(f, "utf8"); } catch { continue; }
    cand.sort((a, b) => a - b);
    const key = cand.join(",");
    let gate = gateCache.get(key);
    if (!gate) {
      gate = []; // chunks of GATE_CHUNK rows, so no single alternation grows past what the regex engine compiles well
      for (let i = 0; i < cand.length; i += GATE_CHUNK) gate.push(new RegExp(cand.slice(i, i + GATE_CHUNK).map((r) => scopedRows[r].lit).join("|"), "iu"));
      gateCache.set(key, gate);
    }
    if (!gate.some((g) => g.test(text))) continue; // no candidate row's term occurs at all, boundaries aside (superset gate)
    let lines = null;
    const fiction = isFictionPage(f);
    for (const r of cand) {
      const { term, source, row, cls, takedown, re, jre, allowCards } = scopedRows[r];
      if (!re.test(text) && !(jre && jre.test(text))) continue; // exact prefilter (see above)
      if (!lines) lines = text.split("\n");
      // PRIVACY-SAFE (wave-C90-L188): file path is unchanged; the term
      // itself is never printed — cited by ledger-row tag instead.
      //
      // CONTEXT-FIRST SPLIT (PRIVACY-CONTEXT-01, 2026-09-13): same rule as
      // the global scan above — a scoped deny term is only judged per LINE
      // now (it used to be a single whole-file boolean test), so a fiction-
      // class hit outside an OOC structure can be reported as INFO instead
      // of failing, while every other page (and every OOC-structure hit)
      // still fails on the first matching line, same as the old whole-file
      // test's own effect.
      //
      // `failReported` gates only the FAIL side, preserving the old
      // one-failure-per-file behavior for actual failures (no per-line
      // spam of the same scoped term across a long page) — it must NOT
      // stop the scan outright, or a later in-character line in the same
      // file would silently never get its own INFO report (a real bug
      // this lane's own synthetic fixture test caught before this comment
      // was written: a "Written by:" failure on line 4 was swallowing
      // three later in-fiction INFO-worthy lines below it).
      const out = reports[r] || (reports[r] = []);
      let failReported = false;
      for (let li = 0; li < lines.length; li++) {
        if (!re.test(lines[li]) && !(jre && jre.test(lines[li]))) continue;
        const lineNo = li + 1;
        if (azCovers(allowCards, f, lineNo)) continue; // hook c280: a same-term allow's A-Z card anchor owns this line
        const ooc = fiction ? isOocLine(f, text, lineNo) : null;
        if (ooc === false && !takedown) { // D177 (b): a takedown row gets no in-character carve-out
          infoRows.push(["scoped", f, lineNo, source, row, infoFp(term), cls || "", term.length]); // hook c225: the full list
          out.push([false, `in-character use of a ledgered name (scoped) ${rowTag({ term, row, cls })} [${source}] in ${f}:${lineNo}`]);
          continue; // keep scanning: a later line in the same file may land inside a structure
        }
        if (failReported) continue; // already failed this file/term once; keep scanning for more INFO lines only
        const oocNote = ooc === true ? " [out-of-character structure]" : (ooc === false ? " [takedown row: no in-character carve-out]" : "");
        out.push([true, `scoped ledger term ${rowTag({ term, row, cls })} [${source}]${oocNote} in ${f}:${lineNo}`]);
        failReported = true;
      }
    }
  }
  // the old loop's report order: row by row, and within a row file by file, line by line
  for (const out of reports) if (out) for (const [isFail, msg] of out) (isFail ? fail : info)(msg);
}

// ---------- WRAPPED TERMS (hook c274-privacy-wrapped-terms, lane PRIVACY-WRAPPED-TERMS, 2026-10-11) -------------------
// Every scan above matches a deny term AS WRITTEN, one line at a time: the automaton resets at "\n" ("a match can't span
// a line break"), and the scoped pass tests the term with its own single space. Served Usenet posts are HARD-WRAPPED, so
// lane IIWF-P02 found a 1996 post whose first word ended one line and whose surname began the next, with every scan green
// and privacy-lookup.py reporting no hit. The same hole covers "<br>" between the words, a run of two spaces, a
// non-breaking-space entity and a JSON "\n" escape inside a data/*.json string (the gate reads data/ too).
// THIS PASS closes it, and ADDS ONLY: a deny row of two or more whitespace-separated words is searched again with its
// words joined by a gap of whitespace, &nbsp;-class entities, escaped \n/\r/\t and INLINE tags, where the gap must carry
// at least one real whitespace-like character and is bounded at 40 tokens either side of it. A match whose own text is
// the term as written is skipped -- the passes above already have it -- so nothing here can change an existing line, a
// count or the verdict for a page that was already reported. "AB" fused (the takedown-only joined form) does not match;
// neither does "A said. B", nor a block boundary between the words (</p>, <hr>, <h2>, <td>): those are not a wrap.
// Everything else is the gate's own rule: global rows apply tree-wide, a scoped row only under its own prefixes, a
// same-term scoped allow covering the path carves it out, the memorial exemption already removed its rows upstream,
// a card/roleplay/rp line outside an OOC structure is INFO (never a takedown row), and the term is never printed. No
// context is quoted either: a snippet of a wrapped hit would carry the term, which redactContext cannot mask (it masks
// the as-written form only).
{
  const FLEX_ENT = "&nbsp;|&#160;|&#[xX]0*[aA]0;|\\\\[nrt]";
  const FLEX_TAG = "</?(?:strong|nobr|small|span|font|code|big|sup|sub|wbr|em|br|tt|b|i|u|a)(?=[\\s/>])[^<>]{0,160}>";
  // ONE deterministic parse of a gap (greedy whitespace, then an entity or inline tag, then whitespace again, bounded).
  // This hook's first shape joined bounded TOKENS either side of one mandatory whitespace, and a 5+-word term made that
  // exponential -- every way of splitting a whitespace run between the two sides -- which hung a tree-wide scan for ten
  // minutes at 100% CPU. There is no such choice here, so the cost stays linear in the gap however long the term.
  const FLEX_WSSEG = "[^\\S\\n]{0,40}(?:\\n[^\\S\\n]{0,40})?";   // at most ONE line break per gap segment: a wrap, never a blank line
  const FLEX_GAP = "(" + FLEX_WSSEG + "(?:(?:" + FLEX_ENT + "|" + FLEX_TAG + ")" + FLEX_WSSEG + "){0,6})";
  // the gap must carry a real whitespace-like character: a space, a newline, an &nbsp; entity, an escaped \n, or a
  // <br>/<wbr>. "AB" fused is the takedown-only joined form (hook c50), never a wrap.
  const FLEX_WSLIKE = new RegExp("\\s|&nbsp;|&#160;|&#[xX]0*[aA]0;|\\\\[nrt]|</?(?:br|wbr)(?=[\\s/>])[^<>]{0,160}>", "iu");
  const flexWords = (t) => t.trim().split(/\s+/).filter(Boolean);
  const flexEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flexRe = (t) => new RegExp(WORD_BEFORE + flexWords(t).map(flexEsc).join(FLEX_GAP) + WORD_AFTER, "giu");
  const flexGapOk = (m) => m.slice(1).every((g) => FLEX_WSLIKE.test(g));
  const flexAllow = (t) => allowScoped.filter((a) => a.term.toLowerCase() === t.toLowerCase())
    .flatMap((a) => a.scope.split(",").map((x) => x.trim()).filter(Boolean));
  // ANCHORED MATCHING, never a scan of the whole file per row: a file is tokenised ONCE into letter/digit runs with
  // their offsets, and a row's flexible form is tried only AT the offsets of its own first run, with the sticky flag.
  // One scan of the text per candidate row is what stalled this lane's first tree-wide scan on
  // data/appearances-index.json (62 MB, which the gate reads like any other file) -- the same O(files x terms) trap
  // wave-C90-L136 measured at ~6 minutes full-tree.
  const RUN_RE = /[\p{L}\p{N}]+/gu;
  const flexRuns = (t) => t.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const flexOff = (t) => { const m = /[\p{L}\p{N}]/u.exec(t); return m ? m.index : 0; };
  const flexSticky = (t) => new RegExp(WORD_BEFORE + flexWords(t).map(flexEsc).join(FLEX_GAP) + WORD_AFTER, "yiu");
  const wrapRows = [];
  for (const d of denyGlobal.concat(denyScoped)) {
    const ws = flexWords(d.term);
    // a wrapped NAME, never a sentence: six ledger rows carry 46-924 words in column 1, and such a row's flexible walk
    // costs words x positions on every page that shares its vocabulary. Those rows keep being matched as written, and
    // in their joined form, exactly as before.
    if (ws.length < 2 || ws.length > 6) continue;
    const runs = flexRuns(d.term);
    if (!runs.length) continue;
    wrapRows.push({
      ...d,
      prefixes: d.scope ? d.scope.split(",").map((x) => x.trim()).filter(Boolean) : null,
      allowPfx: flexAllow(d.term),
      allowCards: new Set(allowScoped.filter((a) => a.term.toLowerCase() === d.term.toLowerCase()).flatMap((a) => [...azCardsOf(a.scope)])), // hook c280
      runs,
      off: flexOff(d.term),
      re: flexSticky(d.term),
    });
  }
  if (wrapRows.length) {
    const byFirst = new Map();   // first run -> rows, so a file meets only the rows whose own first run it carries
    for (let i = 0; i < wrapRows.length; i++) {
      let l = byFirst.get(wrapRows[i].runs[0]); if (!l) { l = []; byFirst.set(wrapRows[i].runs[0], l); } l.push(i);
    }
    // IN WINDOWS of lines, so the run index stays small whatever the file: data/*.json carries fourteen files of 7-62 MB
    // (appearances-index, shows, characters, matches-index, wanted, documents, ...) which the gate reads like any other.
    // A match spans at most seven lines by construction (one line break per gap segment, six segments), so consecutive
    // windows overlap by twelve and nothing can fall between them; a hit found twice is reported once.
    const WIN_LINES = 400, WIN_OVER = 12;
    let wrapFail = 0, wrapInfo = 0, wrapHits = 0, wrapFiles = 0;
    for (const f of fileList) {
      let text; try { text = readFileSync(f, "utf8"); } catch { continue; }
      const ls = [0];   // line starts, once per file
      for (let z = 0; z < text.length; z++) if (text.charCodeAt(z) === 10) ls.push(z + 1);
      let fiction = null, hitHere = false;
      const failedRow = new Set(), seenHit = new Set();
      for (let w = 0; w < ls.length; w += Math.max(1, WIN_LINES - WIN_OVER)) {
        const base = ls[w];
        const endLine = w + WIN_LINES;
        const chunk = text.slice(base, endLine < ls.length ? ls[endLine] : text.length);
        const lower = chunk.toLowerCase();
        const at = new Map();   // letter/digit run -> ascending offsets inside this window
        RUN_RE.lastIndex = 0;
        for (let t2; (t2 = RUN_RE.exec(lower)) !== null; ) {
          let a = at.get(t2[0]); if (!a) { a = []; at.set(t2[0], a); } a.push(t2.index);
        }
        if (!at.size) continue;
        const cand = new Set();
        for (const k of at.keys()) for (const i of (byFirst.get(k) || [])) {
          if (wrapRows[i].runs.every((x) => at.has(x))) cand.add(i);
        }
        if (!cand.size) continue;
        for (const i of [...cand].sort((a, b) => a - b)) {
          const r = wrapRows[i];
          if (r.prefixes && !r.prefixes.some((pfx) => f.startsWith(pfx))) continue;   // a scoped row reaches only its own prefixes
          if (r.allowPfx.some((pfx) => f.startsWith(pfx))) continue;                  // a same-term scoped allow covers the path
          for (const p0 of at.get(r.runs[0])) {
            if (p0 < r.off) continue;
            r.re.lastIndex = p0 - r.off;
            const m = r.re.exec(chunk);
            if (m === null) continue;
            if (m[0].toLowerCase() === r.term.toLowerCase() || !flexGapOk(m)) continue;   // as written (the passes above report it), or a gapless/fused form
            const abs = base + m.index;
            const key = i + ":" + abs;
            if (seenHit.has(key)) continue;   // the window overlap can show the same hit twice
            seenHit.add(key);
            let lo = 0, hi = ls.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (ls[mid] <= abs) lo = mid + 1; else hi = mid; }
            const lineNo = lo;
            if (r.allowCards.size) { // hook c280: covered only when one anchored card owns the hit's first AND last line
              const endAbs = abs + Math.max(0, m[0].length - 1);
              let lo2 = 0, hi2 = ls.length; while (lo2 < hi2) { const mid = (lo2 + hi2) >> 1; if (ls[mid] <= endAbs) lo2 = mid + 1; else hi2 = mid; }
              if (azCovers(r.allowCards, f, lineNo) && azCardAt(f, lo2) === azCardAt(f, lineNo)) continue;
            }
            if (fiction === null) fiction = isFictionPage(f);
            const ooc = fiction ? isOocLine(f, text, lineNo) : null;
            const failReported = failedRow.has(i);
            wrapHits++; hitHere = true;
            if (ooc === false && !r.takedown) {   // D177 (b): a takedown row gets no in-character carve-out
              if (wrapInfo < 40) info(`in-character use of a WRAPPED ledgered name (hook c274) {[${r.source}] ${rowTag(r)}}: ${f}:${lineNo} — the term is split across a line break or inline markup; no context is quoted`);
              wrapInfo++;
              continue;   // keep scanning: a later line in the same file may land inside a structure
            }
            if (failReported) continue;   // one failure per row per file, as the scoped pass does; INFO lines keep coming
            if (wrapFail < 40) fail(`WRAPPED ledger term (hook c274) {[${r.source}] ${rowTag(r)}}${r.prefixes ? " [scoped row]" : ""}${ooc === false ? " [takedown row: no in-character carve-out]" : ""}: ${f}:${lineNo} — the term is split across a line break or inline markup; no context is quoted (a quoted span would carry the term)`);
            wrapFail++; failedRow.add(i);
          }
        }
      }
      if (hitHere) wrapFiles++;
    }
    if (wrapFail > 40) fail(`...and ${wrapFail - 40} more wrapped ledger hits (hook c274)`);
    if (wrapInfo > 40) info(`...and ${wrapInfo - 40} more in-character wrapped ledgered-name hits (hook c274)`);
    console.log(`privacy-check: wrapped-term pass (hook c274): ${wrapRows.length} multi-word deny row(s) searched across line breaks and inline markup — ${wrapHits} hit(s) on ${wrapFiles} file(s), ${wrapFail} failing, ${wrapInfo} in-character.`);
  }
}

// ---------- 2 + 3. served-doc scans --------------------------------------
// hook c208 (the Janitor's D480, 2026-10-09: "(a) plain rename"): both wordings count. The marker count is what a
// page's "carries N redactions" row is checked against, so it must not move while the words do; the eight older
// wordings are accepted until the last wave built before D480 has landed.
const MARKER = /\[redacted\s*(?:—|&mdash;)|\[(?:name|detail) withheld\]/g;
const EMAILISH = /([A-Za-z0-9._%+-]+)@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const BANGTAIL = /!([A-Za-z0-9._-]{2,})\s*(?:\(.*\))?\s*$/; // a Path: line ending in !login
// Netnews/system accounts are machinery, not people — a prior curation pass
// judged them servable (one doc annotates its own "(netnews admin account)").
const SYSTEM_ACCOUNT = /^(?:usenet(?:usenet)?|news[a-z0-9.]*|nntp|postmaster|daemon|mailer-daemon|notes|ufgate|announce-moderator|root|uucp|gateway|bounce-back|not-for-mail|voting|(?:rec|alt|comp|soc|talk|misc)\.[a-z0-9.-]+)$/i;
// Pseudonymous handles the ledger allows are also servable in headers
// (allowTerms is loaded above, from the ledger and the branch fragment).
const HEADER = /^(?:Path|From|Reply-To|Sender|X-[A-Za-z-]+):/;
const WORDNUM = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12 };

const servedDocs = fileList.filter((f) => /^promotions\/[^/]+\/(archive|rp)\/.*\.html$/.test(f));
for (const f of servedDocs) {
  let text;
  try { text = readFileSync(f, "utf8"); } catch { continue; }

  // 2: usenet header hygiene
  if (/Newsgroups:|Message-ID:/.test(text)) {
    for (const rawLine of text.split("\n")) {
      const line = rawLine.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'").trim();
      if (!HEADER.test(line)) continue;
      if (/\[redacted|\[(?:name|detail) withheld\]/.test(line)) continue;   // already redacted (hook c208, D480: either wording)
      if (/^Message-ID:|^X-(?:Newsreader|Mailer):/i.test(line.split(" ")[0] + ":")) continue;
      const em = line.match(EMAILISH);
      const bt = line.startsWith("Path:") ? line.match(BANGTAIL) : null;
      const local = em ? em[1] : bt ? bt[1] : null;
      if (!local) continue;
      if (SYSTEM_ACCOUNT.test(local)) continue;
      if (allowTerms.includes(local.toLowerCase())) continue;
      fail(`unredacted header detail in ${f}: "${line.slice(0, 120)}"`);
    }
  }

  // 3: disclosure consistency
  const markers = (text.match(MARKER) || []).length;
  if (markers > 0) {
    // Disclosure lives in the structured provenance <dl> (PROVENANCE-BACKFILL-01,
    // 2026-09-13 — museum/scripts/templates/provenance-block.tpl), the older
    // free-prose provenance <p>, or the <footer> citation block (oldest
    // template) — accept any of the three so pages not yet migrated by
    // fix-provenance-block.py keep passing during the rollout window.
    const provs = text.match(/<p class="muted small(?: provenance)?"[^>]*>[\s\S]*?<\/p>/g) || [];
    const dls = text.match(/<dl class="muted small(?: provenance)?"[^>]*>[\s\S]*?<\/dl>/g) || [];
    const foot = text.match(/<footer[\s\S]*?<\/footer>/);
    const provText = provs.join("\n") + dls.join("\n") + (foot ? foot[0] : "");
    const ms = [...provText.matchAll(/(?:carries\s+)?\b(?:(\d+)|(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve))\s+redactions?\b/gi)];
    const declared = ms.reduce((a, m) => a + (m[1] ? parseInt(m[1], 10) : (WORDNUM[m[2].toLowerCase()] ?? 0)), 0);
    if (!ms.length) {
      disclosure(`${f}: ${markers} redaction marker(s) but provenance discloses none`);
    } else if (declared !== markers) {
      disclosure(`${f}: ${markers} redaction marker(s) but provenance declares ${declared}`);
    }
  }
}

// ---------- FORENAME+INITIAL SHAPE WARNING (STRUCTURAL GUARDRAILS,
// 2026-09-03, warn-only, never fails) ---------------------------------------
// A global `deny` row shaped like a bare forename plus a single initial
// ("Chris B", "Alex Q") is too short to stand safely across a ~28,000-file
// tree: gate run 6 on 2026-09-03 reddened on exactly this shape colliding
// with an unrelated public figure's name that happened to sit inside an
// in-fiction show script. The fix each time is the same one CURATION's
// "James F" precedent already models — scope the row to the promotion(s)
// where the real disclosure actually sits, or add a specific `allow` row
// for the collision — but that is a human triage call, not something this
// script can safely do on its own (a scope narrowed wrong is a privacy
// miss, not a privacy win). This is a NUDGE to make that triage happen
// before the next collision, never a gate: it changes no exit code.
{
  const FORENAME_INITIAL_RE = /^[A-Za-z][A-Za-z'-]*\s+[A-Za-z]\.?$/;
  const shortShaped = denyGlobal.filter((d) => FORENAME_INITIAL_RE.test(d.term));
  if (shortShaped.length) {
    console.warn(`\nprivacy-check: ${shortShaped.length} global deny row(s) are forename+initial-shaped (two tokens, second a bare initial) — consider scoping (CURATION's "James F" precedent: scope: <promotions/wing/>, with a note why):`);
    for (const d of shortShaped) console.warn(`  ⚠ ${rowTag(d)} [${d.source}]`);
    console.warn("");
  }
}

// ---------- the full in-character list, term-free (hook c225-ooc-credit-nearmiss) ---------------------------------------
// Written to $SCRATCH_ROOT (exported by scripts/ops/_common.sh to the gate), else $WORKSHOP_ROOT/ops-scratch, else the
// historical <museum>/../archive/ops-scratch; never inside the museum tree (everything there is gated and published). Skipped
// with a note when no such directory exists (a worktree, a clone). A failure to write never changes the verdict.
{
  const { writeFileSync: c225Write, renameSync: c225Rename } = await import("node:fs");
  const env = process.env;
  const dir = env.SCRATCH_ROOT || (env.WORKSHOP_ROOT ? join(env.WORKSHOP_ROOT, "ops-scratch") : join(SCRIPT_ROOT, "..", "archive", "ops-scratch"));
  const absDir = resolve(dir);
  if (absDir === SCRIPT_ROOT || absDir.startsWith(SCRIPT_ROOT + "/") || !existsSync(absDir)) {
    console.log(`PRIVACY-INFO-LIST: ${infoRows.length} in-character ledgered-name hit(s); not written (no workshop scratch directory outside the museum tree)`);
  } else {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const out = join(absDir, `privacy-info-${stamp}.tsv`);
    const key = (r) => `${r[0]}\t${r[1]}\t${String(r[2]).padStart(9, "0")}\t${String(r[4]).padStart(9, "0")}`;
    const rows = infoRows.slice().sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    try {
      c225Write(out + ".tmp", "#scope\tpage\tline\tledger\trow\tfp\tclass\tlen\n" + rows.map((r) => r.join("\t")).join("\n") + (rows.length ? "\n" : ""));
      c225Rename(out + ".tmp", out);
      console.log(`PRIVACY-INFO-LIST: ${rows.length} in-character ledgered-name hit(s) (global + scoped, uncapped), term-free, in ${out}`);
    } catch (e) {
      console.log(`PRIVACY-INFO-LIST: ${rows.length} in-character ledgered-name hit(s); the list could not be written (${e.code || e.name})`);
    }
  }
}

// ---------- verdict -------------------------------------------------------
if (failures) {
  console.error(`privacy-check: RED — ${failures} failure(s).`);
  process.exit(1);
}
if (disclosureWarns) console.error(`privacy-check: ${disclosureWarns} disclosure warning(s) — legacy debt, not blocking until STRICT_DISCLOSURE=1.`);
// infoCount now covers two INFO classes: in-character ledgered-name hits (the context rule)
// and memorial-exemption suppressions (MEMORIAL-EXEMPTION-01). Neither fails; the line says so.
if (infoCount) console.log(`privacy-check: ${infoCount} INFO line(s), none failed — in-character ledgered-name hits (card/roleplay/rp context rule, LANE-RULES.md rule 6) and ${memorialSuppressed.length} memorial-exemption suppression(s) (CURATION #privacy v74).`);
const fragNote = fragmentLoaded ? `, incl. fragment ${basename(fragmentPath)}` : "";
const memNote = memorialNames.size
  ? `; memorial exemption: ${memorialNames.size} registered name form(s), ${memorialSuppressed.length} deny row(s) suppressed`
  : `; memorial exemption: EMPTY (data/memorials.json unreadable — every ledger row stands)`;
console.log(`privacy-check: OK — ${denyGlobal.length} global + ${denyScoped.length} scoped deny terms (${joinedRes.length} takedown rows also in joined forms) (${allowScoped.length} scoped allow carve-outs)${fragNote} across ${fileList.length} files; ${servedDocs.length} served docs header/disclosure-checked${memNote}.`);
