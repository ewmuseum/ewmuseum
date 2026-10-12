#!/usr/bin/env node
// privacy-credit-warn.mjs — WARN-ONLY credit-context privacy detector.
//
// scripts/privacy-check.mjs is ledger-driven: it only catches a real name
// once someone has filed it as a `deny` row in
// the workshop's redaction-ledger.tsv. That misses names nobody has filed
// yet — a served "Contributors"/"Staff"/sig-block page can carry real-name
// credits for days before a human notices. A plain name-shape detector is
// useless here because nearly every fictional wrestler is name-shaped too;
// the discriminating signal is CONTEXT (a credit keyword nearby), not shape.
//
// This tool finds name-shaped strings sitting in credit context, then
// drops anything that STANDS for a structural reason (a known character
// persona/aka, a ledger `allow` row, or a term the ledger already `deny`s
// and privacy-check.mjs is already gating). Everything left is a WARNING —
// a READ REQUEST for a human, never a redaction order and never a gate.
// EXIT CODE IS ALWAYS 0.
//
// Born 2026-09-03 after a served PTCpedia "Contributors" page sat
// undetected for nine days with nineteen real-name credits, none of them
// yet in the ledger.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";

// ---------- ~400-forename list (inline, no network) -----------------------
// Common English forenames + widely-used nicknames, male and female. Used
// only as the FIRST token of a two-token name-shape; the second token is a
// capitalized word (surname) or a single capital letter with an optional
// period (surname-initial). Not a name-recognizer for the world — a coarse
// net wide enough to net "Kris B" and "John Smith" alike.
const FORENAMES = [
"Aaron","Adam","Adrian","Ahmed","Al","Alan","Albert","Alex","Alexander","Alexis",
"Ali","Alicia","Allan","Allen","Amanda","Amber","Amy","Andre","Andrea","Andrew",
"Andy","Angela","Angie","Anna","Anne","Anthony","Antonio","April","Ariel","Arnold",
"Art","Arthur","Ashley","Austin","Barbara","Barry","Becky","Ben","Benjamin","Bernard",
"Beth","Betty","Bill","Billy","Blake","Bob","Bobby","Brad","Bradley","Brandon",
"Brenda","Brendan","Brent","Brett","Brian","Brianna","Britney","Brittany","Bruce","Bryan",
"Cameron","Carl","Carla","Carlos","Carol","Caroline","Carolyn","Carrie","Casey","Cassandra",
"Catherine","Cathy","Cesar","Chad","Charlene","Charles","Charlie","Charlotte","Chase","Chelsea",
"Cheryl","Chris","Christian","Christina","Christine","Christopher","Cindy","Claire","Clara","Clarence",
"Clayton","Cliff","Clifford","Clint","Cody","Colin","Connie","Connor","Cory","Courtney",
"Craig","Crystal","Curtis","Cynthia","Dale","Dallas","Damon","Dan","Dana","Dane",
"Daniel","Danielle","Danny","Darren","Darryl","Dave","David","Dawn","Dean","Deanna",
"Debbie","Deborah","Debra","Denise","Dennis","Derek","Derrick","Desmond","Devin","Diana",
"Diane","Dolores","Dom","Dominic","Don","Donald","Donna","Doreen","Doris","Dorothy",
"Doug","Douglas","Drew","Duane","Dustin","Dwayne","Dwight","Earl","Ed","Eddie",
"Edgar","Edith","Edmund","Eduardo","Edward","Edwin","Elaine","Eleanor","Elena","Eli",
"Elizabeth","Ellen","Elliot","Elliott","Emily","Emma","Eric","Erica","Erik","Erika",
"Erin","Ernest","Ethan","Eugene","Evan","Evelyn","Fernando","Florence","Floyd","Francis",
"Francisco","Frank","Frankie","Franklin","Fred","Freddie","Frederick","Gabriel","Gail","Gary",
"Gavin","Gene","George","Georgia","Gerald","Gerard","Gina","Ginger","Glen","Glenn",
"Gloria","Gordon","Grace","Grant","Greg","Gregory","Guy","Harold","Harriet","Harry",
"Harvey","Heather","Hector","Helen","Henry","Herbert","Herman","Holly","Homer","Howard",
"Hugh","Ian","Ida","Irene","Iris","Irving","Isaac","Ivan","Jack","Jackie",
"Jacob","Jacqueline","Jaime","Jake","James","Jamie","Jan","Jane","Janet","Janice",
"Jared","Jarrod","Jasmine","Jason","Jay","Jean","Jeanette","Jeff","Jeffery","Jeffrey",
"Jenna","Jennifer","Jenny","Jeremy","Jerome","Jerry","Jesse","Jessica","Jill","Jim",
"Jimmy","Joan","Joanna","Joanne","Jodi","Jody","Joe","Joel","Joey","John",
"Johnny","Jon","Jonathan","Jordan","Jorge","Jose","Joseph","Josephine","Josh","Joshua",
"Joy","Joyce","Juan","Judith","Judy","Julia","Julian","Julie","June","Justin",
"Karen","Karl","Katherine","Kathleen","Kathryn","Kathy","Katie","Katrina","Kayla","Keith",
"Kelly","Ken","Kenneth","Kenny","Kevin","Kim","Kimberly","Kirk","Kris","Kristen",
"Kristin","Kristina","Kristine","Kurt","Kyle","Lance","Larry","Laura","Lauren","Laurie",
"Lawrence","Lee","Leo","Leon","Leonard","Leroy","Leslie","Lester","Lewis","Liam",
"Linda","Lindsay","Lindsey","Lionel","Lisa","Liz","Lloyd","Logan","Lois","Lonnie",
"Loretta","Lori","Lou","Louis","Louise","Lucas","Lucy","Luis","Luke","Lynn",
"Mandy","Marc","Marcia","Marcus","Margaret","Maria","Marie","Marilyn","Mario","Marion",
"Marjorie","Mark","Marsha","Marshall","Martha","Martin","Marty","Marvin","Mary","Mason",
"Matt","Matthew","Maureen","Maurice","Max","Maxine","Maxwell","Megan","Melanie","Melinda",
"Melissa","Melvin","Meredith","Michael","Michele","Michelle","Miguel","Mike","Mildred","Miranda",
"Mitch","Mitchell","Molly","Monica","Morgan","Muhammed","Muhammad","Nancy","Nathan","Nathaniel",
"Neil","Nelson","Nicholas","Nick","Nicole","Nikki","Nina","Noah","Nolan","Nora",
"Norman","Oliver","Omar","Oscar","Owen","Pablo","Pam","Pamela","Pat","Patricia",
"Patrick","Patsy","Patty","Paul","Paula","Pauline","Pedro","Peggy","Penny","Perry",
"Pete","Peter","Phil","Philip","Phillip","Phyllis","Preston","Rachel","Rafael","Ralph",
"Randall","Randy","Raul","Ray","Raymond","Rebecca","Regina","Reginald","Renee","Rex",
"Rhonda","Ricardo","Richard","Rick","Ricky","Rita","Rob","Robert","Roberta","Roberto",
"Robin","Rochelle","Rodney","Roger","Roland","Ron","Ronald","Ronnie","Rory","Rosa",
"Rose","Ross","Roy","Ruben","Russell","Ruth","Ryan","Sabrina","Sally","Sam",
"Samantha","Samuel","Sandra","Sandy","Sara","Sarah","Scott","Sean","Sergio","Seth",
"Shane","Shannon","Sharon","Shaun","Shawn","Sheila","Shelby","Shelley","Sherry","Shirley",
"Sidney","Simon","Sonya","Spencer","Stacey","Stacy","Stan","Stanley","Stephanie","Stephen",
"Steve","Steven","Stuart","Sue","Susan","Suzanne","Sylvia","Tamara","Tammy","Tanya",
"Tara","Ted","Teresa","Terrence","Terri","Terry","Theodore","Theresa","Thomas","Tiffany",
"Tim","Timothy","Tina","Todd","Tom","Tommy","Tony","Tonya","Tracey","Tracy",
"Travis","Trevor","Troy","Ty","Tyler","Tyrone","Valerie","Vanessa","Vera","Vernon",
"Veronica","Vicki","Vicky","Victor","Victoria","Vince","Vincent","Virginia","Vivian","Wade",
"Walt","Walter","Wanda","Warren","Wayne","Wendy","Wesley","Whitney","Will","William",
"Willie","Wilson","Winston","Yolanda","Yvonne","Zach","Zachary","Zack","Zoe","Katelyn",
];
const FORENAME_SET = new Set(FORENAMES.map((n) => n.toLowerCase()));
// Longest-first so e.g. "Christopher" isn't shadowed by an earlier partial.
const forenameAlt = [...new Set(FORENAMES)].sort((a, b) => b.length - a.length).join("|");
const NAME_RE = new RegExp(`\\b(${forenameAlt})[ \\t]+([A-Z][A-Za-z'-]{1,24}\\.?|[A-Z]\\.?)(?![A-Za-z])`, "g");

// ---------- credit keywords ------------------------------------------------
const KEYWORDS = [
  "staff", "contributors", "contributor", "thanks", "thank you", "special thanks",
  "written by", "results by", "card by", "compiled by", "booked by", "webmaster",
  "maintained by", "editor", "commissioner", "president", "owner", "booker",
  "referee", "ring announcer", "commentator", "play-by-play", "color", "sig",
  "e-mail", "email", "contact", "handler", "handled by",
];
const KEYWORD_RE = new RegExp("\\b(" + KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b", "i");
const BOUNDARY_RE = /<h[1-6][ >]|<hr\b|<footer\b|<\/header>/i;
const LISTLIKE_RE = /<li\b|<tr\b|<td\b/i;

// ---------- HTML plain-ification (line-preserving) -------------------------
function stripLine(raw) {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;|&ndash;/g, "-")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

// ---------- repo roots -------------------------------------------------------
const REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const commonDir = execSync("git rev-parse --path-format=absolute --git-common-dir", { encoding: "utf8" }).trim();
const MAIN_ROOT = join(dirname(commonDir), "..");
const WORKSHOP_PRIVACY = process.env.WORKSHOP_ROOT
  ? join(process.env.WORKSHOP_ROOT, "privacy")          // ops/config.env: a clone may live anywhere
  : join(MAIN_ROOT, "archive", "privacy");              // historical sibling convention
const OUT_TSV = join(WORKSHOP_PRIVACY, "credit-warn-latest.tsv");

// ---------- ledger (allow / deny) -------------------------------------------
// Mirrors privacy-check.mjs's scope handling: an unscoped deny row applies
// tree-wide, a scoped one only under its path prefix(es) — a single-token
// scoped deny like "John" (promotions/cwf-continental/archive/...) must
// never suppress a warning for "John Smith" anywhere else in the tree.
const allowTerms = new Set();
const denyRows = []; // {re, scopePrefixes: string[]|null}
function loadLedgerRows(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [term, , status, scope] = line.split("\t");
    if (!term) continue;
    if (status === "allow") allowTerms.add(term.trim().toLowerCase());
    else if (status === "deny") {
      const re = new RegExp("\\b" + term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
      const scopePrefixes = scope && scope.trim() ? scope.split(",").map((s) => s.trim()).filter(Boolean) : null;
      denyRows.push({ re, scopePrefixes });
    }
  }
}
const ledgerPath = join(WORKSHOP_PRIVACY, "redaction-ledger.tsv");
loadLedgerRows(ledgerPath);
let branch = "";
try { branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim(); } catch { /* n/a */ }
if (branch && branch !== "main" && branch !== "HEAD") {
  loadLedgerRows(join(WORKSHOP_PRIVACY, "ledger-pending", branch.replace(/\//g, "-") + ".tsv"));
}
function isDenied(s, filePath) {
  return denyRows.some(({ re, scopePrefixes }) => {
    if (!re.test(s)) return false;
    if (!scopePrefixes) return true;
    if (!filePath) return false; // scoped row, no file context (e.g. JSON note scan) — don't claim it's covered
    return scopePrefixes.some((pfx) => filePath.startsWith(pfx));
  });
}

// ---------- character personas/akas (data/characters.json) -----------------
const personaSet = new Set();
try {
  const chars = JSON.parse(readFileSync(join(REPO_ROOT, "data", "characters.json"), "utf8")).characters || [];
  for (const c of chars) {
    if (c.name) personaSet.add(String(c.name).trim().toLowerCase());
    for (const a of c.aka || []) if (a) personaSet.add(String(a).trim().toLowerCase());
  }
} catch { /* characters.json missing/unreadable — persona STANDS reason just won't fire */ }

// A "list" line: a real <li>/<tr>/<td>, an explicit bullet/number marker,
// or part of a genuine run of 3+ short (<=6 words), non-sentence lines —
// deliberately NOT "any short line", which drowned in staccam kayfabe
// promo prose ("Legend! / Saved the company. / Beat the bad guys...") on
// the first pass over the live tree (30k+ warnings, almost all noise).
function computeListRuns(lines) {
  const n = lines.length;
  const isShort = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const t = stripLine(lines[i]).trim();
    if (!t) continue;
    const words = t.split(/\s+/).length;
    isShort[i] = words > 0 && words <= 6 && t.length <= 40;
  }
  const inRun = new Array(n).fill(false);
  let runStart = -1, blanksInRun = 0;
  const flushRun = (end) => {
    if (runStart === -1) return;
    let count = 0;
    for (let k = runStart; k <= end; k++) if (isShort[k]) count++;
    if (count >= 3) for (let k = runStart; k <= end; k++) if (isShort[k]) inRun[k] = true;
    runStart = -1; blanksInRun = 0;
  };
  for (let i = 0; i < n; i++) {
    const blank = !lines[i].trim();
    if (isShort[i]) {
      if (runStart === -1) runStart = i;
      blanksInRun = 0;
    } else if (blank && runStart !== -1 && blanksInRun < 1) {
      blanksInRun++; // tolerate one blank line inside a bulleted run
    } else {
      flushRun(i - 1);
    }
  }
  flushRun(n - 1);
  return inRun;
}

// ---------- candidate scan of one plain-text-with-lines document -----------
// Returns { warnings: [{line, keyword, matched, shape}], stands: {persona,allow,denied}, candidates }
const SECTION_DECAY = 12; // lines a keyword's context reaches forward before it stops counting
function scanDocument(lines, { isUsenet, pageHeadingHasKeyword, filePath }) {
  const n = lines.length;
  const keywordLine = new Array(n);
  for (let i = 0; i < n; i++) keywordLine[i] = KEYWORD_RE.test(stripLine(lines[i]));
  const listRun = computeListRuns(lines);

  // sig-block: last 6 non-blank lines of a Usenet-shaped document
  const sigLines = new Set();
  if (isUsenet) {
    let count = 0;
    for (let i = n - 1; i >= 0 && count < 6; i--) {
      if (lines[i].trim()) { sigLines.add(i); count++; }
    }
  }

  const warnings = [];
  const stands = { persona: 0, allow: 0, denied: 0 };
  let candidates = 0;
  let lastKeywordLine = -Infinity;
  for (let i = 0; i < n; i++) {
    const raw = lines[i];
    if (BOUNDARY_RE.test(raw)) lastKeywordLine = -Infinity; // a heading/hr/footer closes the section outright
    const plain = stripLine(raw);
    // local context: keyword on this line or any of the previous 3
    let localKeyword = null;
    for (let j = i; j >= Math.max(0, i - 3); j--) {
      if (keywordLine[j]) { const m = KEYWORD_RE.exec(stripLine(lines[j])); localKeyword = m ? m[1] : "keyword"; KEYWORD_RE.lastIndex = 0; break; }
    }
    const listLike = LISTLIKE_RE.test(raw) || /^\s*(?:[*\-•#]|\d+[.)])\s+\S/.test(plain) || listRun[i];
    const withinDecay = i - lastKeywordLine <= SECTION_DECAY;

    NAME_RE.lastIndex = 0;
    let m;
    while ((m = NAME_RE.exec(plain))) {
      const matched = `${m[1]} ${m[2]}`;
      candidates++;
      const shape = m[2].replace(/\.$/, "").length === 1 ? "initial" : "full";
      const lower = matched.toLowerCase();

      if (personaSet.has(lower)) { stands.persona++; continue; }
      if (allowTerms.has(lower)) { stands.allow++; continue; }
      if (isDenied(matched, filePath)) { stands.denied++; continue; }

      let keyword = null;
      if (localKeyword) keyword = localKeyword;
      else if (withinDecay && listLike) keyword = "nearby-heading";
      else if (pageHeadingHasKeyword && listLike) keyword = "page-heading";
      else if (isUsenet && sigLines.has(i)) keyword = "sig-block";

      if (keyword) warnings.push({ line: i + 1, keyword, matched, shape });
    }
    if (keywordLine[i]) lastKeywordLine = i;
  }
  return { warnings, stands, candidates };
}

function pageHeading(text) {
  const title = /<title>([^<]*)<\/title>/i.exec(text);
  const h1 = /<h1[^>]*>([^<]*)<\/h1>/i.exec(text);
  const t = (title ? title[1] : "") + " " + (h1 ? h1[1] : "");
  return KEYWORD_RE.test(t);
}

// ---------- file walk (git's own file list, restricted to promotions HTML) -
const argPath = process.argv[2];
let totalFiles = 0, totalWarnings = 0, totalCandidates = 0;
const standsTotal = { persona: 0, allow: 0, denied: 0 };
const perFileWarnCount = new Map();
const tsvRows = ["file\tline\tkeyword\tmatched\tshape"];
const reportGroups = [];

function processFile(relOrAbs, displayName) {
  let text;
  try { text = readFileSync(relOrAbs, "utf8"); } catch { return; }
  totalFiles++;
  const lines = text.split("\n");
  const isUsenet = /Newsgroups:|Message-ID:/.test(text);
  const headingHit = pageHeading(text);
  const { warnings, stands, candidates } = scanDocument(lines, { isUsenet, pageHeadingHasKeyword: headingHit, filePath: displayName });
  totalCandidates += candidates;
  standsTotal.persona += stands.persona;
  standsTotal.allow += stands.allow;
  standsTotal.denied += stands.denied;
  if (warnings.length) {
    totalWarnings += warnings.length;
    perFileWarnCount.set(displayName, warnings.length);
    for (const w of warnings) {
      tsvRows.push(`${displayName}\t${w.line}\t${w.keyword}\t${w.matched}\t${w.shape}`);
    }
    reportGroups.push({ file: displayName, warnings });
  }
}

function scanJsonNotes() {
  // data/frontier.json rows[].notes ; data/promotions.json free-text fields —
  // walked generically over each row's string leaves so any note/caption/
  // provenance field is covered without hand-listing every schema field.
  function walkStrings(node, path, out) {
    if (typeof node === "string") { out.push([path, node]); return; }
    if (Array.isArray(node)) { node.forEach((v, i) => walkStrings(v, `${path}[${i}]`, out)); return; }
    if (node && typeof node === "object") { for (const k of Object.keys(node)) walkStrings(node[k], `${path}.${k}`, out); }
  }
  for (const [jsonFile, arrKey] of [["data/frontier.json", "rows"], ["data/promotions.json", "promotions"]]) {
    const full = join(REPO_ROOT, jsonFile);
    if (!existsSync(full)) continue;
    let data;
    try { data = JSON.parse(readFileSync(full, "utf8")); } catch { continue; }
    const rows = data[arrKey] || [];
    totalFiles++;
    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const rowId = row && (row.id || row.name) || `#${idx}`;
      const strs = [];
      walkStrings(row, `${arrKey}[${idx}:${rowId}]`, strs);
      for (const [path, s] of strs) {
        if (s.length < 6) continue;
        const headingHit = KEYWORD_RE.test(s);
        const { warnings, stands, candidates } = scanDocument([s], { isUsenet: false, pageHeadingHasKeyword: headingHit, filePath: jsonFile });
        totalCandidates += candidates;
        standsTotal.persona += stands.persona;
        standsTotal.allow += stands.allow;
        standsTotal.denied += stands.denied;
        if (warnings.length) {
          const displayName = jsonFile;
          totalWarnings += warnings.length;
          perFileWarnCount.set(displayName, (perFileWarnCount.get(displayName) || 0) + warnings.length);
          for (const w of warnings) tsvRows.push(`${displayName}\t${path}\t${w.keyword}\t${w.matched}\t${w.shape}`);
          reportGroups.push({ file: `${displayName} :: ${path}`, warnings });
        }
      }
    }
  }
}

if (argPath) {
  processFile(argPath, argPath);
} else {
  const fileList = execSync("git ls-files -co --exclude-standard -z -- 'promotions/*.html' 'promotions/**/*.html'", {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd: REPO_ROOT,
  }).split("\0").filter(Boolean);
  for (const f of fileList) processFile(join(REPO_ROOT, f), f);
  scanJsonNotes();
}

// ---------- write full report to workshop ------------------------------------
try { writeFileSync(OUT_TSV, tsvRows.join("\n") + "\n"); } catch (e) {
  console.error("credit-warn: could not write " + OUT_TSV + " — " + e.message);
}

// ---------- console report (capped) ------------------------------------------
console.log(`credit-warn: scanned ${totalFiles} files/units, ${totalCandidates} name-shaped candidates found`);
console.log(`credit-warn: STANDS — persona/aka ${standsTotal.persona}, ledger-allow ${standsTotal.allow}, already ledger-deny ${standsTotal.denied}`);
console.log(`credit-warn: ${totalWarnings} warning(s)`);

let printed = 0;
const CAP = 200;
outer:
for (const g of reportGroups) {
  for (const w of g.warnings) {
    if (printed >= CAP) break outer;
    console.log(`  ${g.file}:${w.line}\t[${w.keyword}]\t${w.matched}\t(${w.shape})`);
    printed++;
  }
}
if (totalWarnings > printed) console.log(`  …and ${totalWarnings - printed} more`);

console.log(`credit-warn: ${totalWarnings} warnings — see the workshop's credit-warn-latest.tsv`);
process.exit(0);
