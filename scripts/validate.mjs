#!/usr/bin/env node
/**
 * THE MUSEUM — build-less static-site validator.
 *
 * No framework, no dependencies: this is the whole "check" step. It walks every
 * .html file the site ships, pulls out internal href/src targets, and confirms
 * each one resolves to a file that actually exists in the repo. It also enforces
 * a couple of house rules that matter for a private, honest archive:
 *   - every page must be noindex (this site is not for search engines);
 *   - every page must link the shared stylesheet.
 *
 * Exit non-zero on any failure so CI blocks the deploy. Run: `npm run check`.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { stampAll, resolvePageLang } from "./stamp-chrome.mjs";
import { isAllowedTopLevel } from "./deploy-allowlist.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE_PUBLIC = JSON.parse(readFileSync(join(ROOT, "data", "site-config.json"), "utf8")).public === true;

// Pages served by the Pages Function, not files on disk — never link-checked.
const VIRTUAL = new Set(["/gate"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === ".claude" || name === "bot" || name === "node_modules" || name === "functions") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

function attrs(html, attr) {
  const re = new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, "gi");
  const found = [];
  let m;
  while ((m = re.exec(html))) found.push(m[1]);
  return found;
}

function resolveTarget(fileDir, target) {
  // strip query/hash
  const clean = target.replace(/[?#].*$/, "");
  if (clean === "") return null;
  if (clean === "/") return join(ROOT, "index.html");
  const rel = clean.startsWith("/") ? join(ROOT, clean.slice(1)) : resolve(fileDir, clean);
  // a directory-style link resolves to its index.html
  if (clean.endsWith("/")) return join(rel, "index.html");
  if (existsSync(rel) && statSync(rel).isDirectory()) return join(rel, "index.html");
  return rel;
}

const files = walk(ROOT);
const errors = [];
let linkCount = 0;

for (const file of files) {
  const html = readFileSync(file, "utf8");
  const rel = relative(ROOT, file);
  const dir = dirname(file);

  // House rules.
  // THE PUBLIC FLAG (phase-3 plumbing, 2026-08-22): gated -> every page
  // must carry noindex; public -> no page may (the flag flips what this
  // gate enforces, so a half-stamped state can never ship either way).
  if (rel.startsWith("templates/")) {
    // the chrome template is source, not a served page — its noindex line
    // is what the stamper strips at stamp time when public
  } else if (!SITE_PUBLIC && !/name="robots"\s+content="noindex/i.test(html))
    errors.push(`${rel}: missing <meta name="robots" content="noindex..."> (site is gated: public:false)`);
  else if (SITE_PUBLIC && /name="robots"\s+content="noindex/i.test(html))
    errors.push(`${rel}: carries noindex but data/site-config.json says public:true — restamp (npm run refresh)`);
  if (!/<link[^>]+href="\/style\.css(\?v=\d+)?"/i.test(html))
    errors.push(`${rel}: does not link /style.css`);
  if (!/<title>/i.test(html))
    errors.push(`${rel}: missing <title>`);
  // THE CONFLICT-MARKER CHECK (2026-08-26): git conflict markers shipped to
  // the LIVE FRONT PAGE when a merge was committed with unresolved conflicts
  // — the Janitor saw "<<<<<<< HEAD" on the museum itself. The gate now
  // fails hard on any marker in any checked page; the coordinator's own
  // merge discipline (git diff --diff-filter=U must be empty before any
  // post-merge commit) is the first line, this is the backstop.
  // Bare "=======" lines are PERIOD DECORATION in served e-fed text (scene
  // dividers — three verbatim artifacts carry them legitimately); a real git
  // conflict always ships the <<<<<<< and >>>>>>> pair, so require both.
  if (/^<{7} /m.test(html) && /^>{7} /m.test(html))
    errors.push(`${rel}: GIT CONFLICT MARKERS in served content — a merge was committed unresolved`);

  // NO THIRD-PARTY EMBED (THE ECOSYSTEM EXPANSION GAVEL, 2026-09-05, step 2;
  // CURATION.md v112(b)). The reader-side translation affordance is a row of
  // plain links and nothing more — and that is a rule about the WHOLE served
  // tree, not about one control. No script, stylesheet, frame or object may
  // be loaded from any origin but this one. The museum is a static site that
  // has never carried one (three first-party scripts, zero iframes, zero
  // external stylesheets, at the time this rule was written); saying so
  // mechanically means the first one has to argue with the gate instead of
  // slipping in behind a convenience. A translation widget would put a
  // company's code between a reader and a museum document, which is the
  // exact thing the doctrine was written to prevent.
  for (const m of html.matchAll(/<(script|iframe|frame|object|embed)\b[^>]*\b(?:src|data)\s*=\s*"([^"]*)"/gi)) {
    if (/^(?:https?:)?\/\//i.test(m[2]))
      errors.push(`${rel}: <${m[1].toLowerCase()}> loads "${m[2]}" from another origin — the museum serves no third-party code, and the translation affordance is plain links only (CURATION v112(b))`);
  }
  for (const m of html.matchAll(/<link\b[^>]*rel\s*=\s*"[^"]*stylesheet[^"]*"[^>]*>/gi)) {
    const href = (m[0].match(/\bhref\s*=\s*"([^"]*)"/i) || [])[1] || "";
    if (/^(?:https?:)?\/\//i.test(href))
      errors.push(`${rel}: <link rel="stylesheet"> loads "${href}" from another origin — the museum serves no third-party assets (CURATION v112(b))`);
  }

  // Internal link/asset targets. Strip inline <script> bodies first — a
  // vanilla-JS page (e.g. search.html) can contain string literals like
  // `href="` while building markup, which isn't a real HTML attribute and
  // shouldn't be link-checked as one.
  // 2026-09-20: a verbatim post that QUOTES html source serves it escaped (&lt;a href="…"&gt;) — text, not markup; never link-check it
  const htmlForLinks = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/&lt;[\s\S]*?&gt;/g, "");
  for (const target of [...attrs(htmlForLinks, "href"), ...attrs(htmlForLinks, "src")]) {
    if (/^(https?:|mailto:|tel:|\/\/|#|data:)/i.test(target)) continue; // external / anchor
    if (VIRTUAL.has(target.replace(/[?#].*$/, ""))) continue;
    linkCount++;
    const resolved = resolveTarget(dir, target);
    if (!resolved || !existsSync(resolved))
      errors.push(`${rel}: broken internal link -> "${target}"`);
  }
}

// The shared stylesheet must exist.
if (!existsSync(join(ROOT, "style.css")))
  errors.push("style.css is missing from the repo root");

// CSS-INTEGRITY VALIDATOR (the stylesheet incident's lesson: a doc-comment's
// own prose once contained a literal "*/" — closing the header comment
// early and silently corrupting the whole :root token block. Nothing
// caught it until a human noticed the site looked wrong. Cheap, permanent
// checks so that specific failure mode, and its two obvious cousins,
// can never ship silently again.
if (existsSync(join(ROOT, "style.css"))) {
  const css = readFileSync(join(ROOT, "style.css"), "utf8");

  // 1. Comment open/close balance — walk the raw text (not comment-stripped)
  // so a stray "*/" with no preceding open, or an "/*" never closed, is
  // caught exactly. CSS comments don't nest, so this is a simple two-token
  // state machine, not a counter (a counter alone would miss "*/ ... /*"
  // landing in the wrong order but still balanced in total count).
  {
    // CSS comments never nest: while inside one, only the NEXT "*/" matters
    // (a "/*" encountered mid-comment is just literal text). While outside
    // one, only the next "/*" matters. A single boolean walked left to
    // right, not a depth counter, is the correct model.
    let inComment = false, pos = 0, bad = null, opens = 0, closes = 0;
    while (pos < css.length) {
      if (!inComment) {
        const open = css.indexOf("/*", pos);
        if (open === -1) break;
        inComment = true; opens++; pos = open + 2;
      } else {
        const close = css.indexOf("*/", pos);
        if (close === -1) { bad = "unclosed /* comment — never finds a matching */ before EOF"; break; }
        inComment = false; closes++; pos = close + 2;
      }
    }
    if (bad) errors.push(`style.css: ${bad} (a "*/" inside a comment's own prose — e.g. describing a class like ".mt-*/.mb-*" — closes it early and corrupts everything after; opened ${opens}, closed ${closes})`);
  }

  // 2. Brace balance — a single unclosed/extra { or } anywhere in the file
  // (often the direct downstream symptom of the comment bug above, since an
  // early-closed comment turns the rest of that comment's TEXT into live
  // CSS, braces and all).
  {
    const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const opens = (cssNoComments.match(/\{/g) || []).length;
    const closes = (cssNoComments.match(/\}/g) || []).length;
    if (opens !== closes) errors.push(`style.css: brace mismatch — ${opens} "{" vs ${closes} "}" (comment-stripped)`);
  }

  // 3. Every var(--x) used must resolve to a --x: definition somewhere in
  // the file (almost always :root) — an undefined custom property silently
  // falls back to nothing rather than erroring, so this is the only way to
  // catch a renamed/deleted token that still has live callers.
  {
    const defined = new Set([...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((m) => m[1]));
    for (const name of used) {
      if (!defined.has(name)) errors.push(`style.css: var(${name}) is used but never defined (no "${name}:" declaration found)`);
    }
  }
}

// SCRIPT-DEPENDENCY GUARD (added after the 2026-08-17 stamp regression
// silently removed every list page's <script> tags): any page whose inline
// code calls MuseumList must also load /js/list.js — a page that uses the
// library without loading it renders an empty shell with a console error.
// THE CONSOLIDATED-SEARCH WAVE: js/list.js itself now depends on
// js/query.js (the shared field:value engine both it and search.html run)
// — the same failure mode applies one layer down, so a page loading
// list.js (or calling MuseumQuery directly, as search.html's own inline
// script does) must load query.js too.
for (const file of files) {
  const rel = relative(ROOT, file);
  const html = readFileSync(file, "utf8");
  if (/MuseumList\./.test(html) && !/<script[^>]+src="\/js\/list\.js/.test(html))
    errors.push(`${rel}: uses MuseumList but never loads /js/list.js`);
  const usesQuery = /MuseumQuery\./.test(html) || /<script[^>]+src="\/js\/list\.js/.test(html);
  if (usesQuery && !/<script[^>]+src="\/js\/query\.js/.test(html))
    errors.push(`${rel}: uses MuseumList/MuseumQuery but never loads /js/query.js`);
}

// ROW BUDGET (THE PAGINATION ARCHITECTURE WAVE, user gavel: "survives 500
// promotions") — no served page may bake more generated-list rows into its
// own HTML than data/site-config.json's row_budget. This is what forces a
// growing category (wrestlers, shows, ...) to split into A-Z / season pages
// instead of one ever-larger monolithic file. Counted heuristically: every
// `.roster-card` and every `<li` are the two row shapes the generators
// (cross-reference.mjs) and the archive-list pattern (shows/rps season
// pages) actually emit — a JS "instrument" page (wrestlers.html, shows.html)
// that fetches JSON and renders client-side bakes ~0 of either into its own
// HTML source, so it's exempt by construction, which is the point: the
// count only catches pages that are STATICALLY over budget.
const siteConfig = JSON.parse(readFileSync(join(ROOT, "data", "site-config.json"), "utf8"));
const ROW_BUDGET = siteConfig.row_budget;
// THE TRANSLATE-ELSEWHERE FLOOR (THE ECOSYSTEM EXPANSION GAVEL, the Janitor,
// 2026-09-05: "a provider-agnostic 'translate elsewhere' affordance (three or
// more providers by plain URL)"; CURATION.md v111(c)) — the gavel's own
// "three or more" made mechanical rather than remembered, so no single
// provider can quietly become load-bearing. OPTIONAL: absent is legal and
// the affordance simply does not exist. Nothing RENDERS this list in this
// step — the site is gated, so an external provider cannot fetch a museum
// URL and a rendered row of links would be a row of dead ones; the chrome
// i18n step renders it, and it works when the public flag flips.
//
// THE ENDPOINT TEST (the coordinator's ruling of 2026-09-05 on the chrome
// i18n design's Q4; recorded here and in docs/OPERATIONS.md). A floor met on
// paper is not met: every seeded provider must be a PAGE-translation
// endpoint — a URL handed to it must cause the PAGE at that URL to be
// translated, not the URL STRING to be translated as text. Two of the four
// providers step 1 seeded (DeepL's `#auto/en/{url}` fragment, Bing's
// `?text={url}`) are text endpoints and were dropped for that reason. The
// floor is therefore "THREE PAGE-TRANSLATION PROVIDERS OR THE ROW DOES NOT
// RENDER": the count is mechanical here, and the page-vs-text half is a
// documented check a lane performs by hand before adding one, because
// nothing in a URL template says which kind it is.
if ("translate_providers" in siteConfig) {
  const tp = siteConfig.translate_providers;
  if (!Array.isArray(tp) || tp.length < 3) {
    errors.push(`data/site-config.json: "translate_providers" must list THREE OR MORE providers (the gaveled doctrine's own floor — no single provider is ever load-bearing)`);
  } else {
    for (const [i, p] of tp.entries()) {
      if (!p || typeof p.name !== "string" || !p.name.trim() || typeof p.url_template !== "string" || !p.url_template.includes("{url}")) {
        errors.push(`data/site-config.json: translate_providers[${i}] must be { name, url_template } with a literal {url} placeholder`);
      }
    }
  }
  // THE CHROME I18N STEP (v112(b), 2026-09-05): a provider link-out hands a
  // third party an ABSOLUTE url, and the museum does not guess its own.
  if (typeof siteConfig.site_url !== "string" || !/^https:\/\/[^/]+$/.test(siteConfig.site_url)) {
    errors.push(`data/site-config.json: "translate_providers" needs a "site_url" — an https origin with no trailing slash (the value the deploy notes in docs/OPERATIONS.md carry)`);
  }
}
for (const file of files) {
  const rel = relative(ROOT, file);
  const html = readFileSync(file, "utf8");
  const rowCount = (html.match(/class="roster-card"/g) || []).length + (html.match(/<li[\s>]/g) || []).length;
  if (rowCount > ROW_BUDGET) {
    errors.push(`${rel}: ${rowCount} generated rows exceeds the row budget (${ROW_BUDGET}, data/site-config.json) — split this page (A-Z / season pages, see scripts/cross-reference.mjs)`);
  }
}

// INLINE-STYLE BAN (THE DESIGN SYSTEM WAVE, "presentation constitution" —
// user gavel: "consistent presentation everywhere now, so we can easily
// inherit it elsewhere") — no served page may carry a style="..." attribute.
// Every visual decision lives in style.css's own token/component system
// (the header comment there is the one-page spec) — a hand-typed inline
// style is exactly the kind of untracked, un-inheritable one-off this wave
// exists to kill. Same chrome-system pattern as everything else here:
// drift is a CI failure, not a style-guide suggestion.
//
// `data-style="..."` (the wrestler-roster search/filter attribute) is a
// completely different thing — plain data, not CSS — and is deliberately
// excluded by the negative lookbehind below.
//
// ALLOWLIST: a tiny, path-keyed escape hatch for the day something truly
// cannot be classed (an inline SVG's own geometry, e.g.) — empty right
// now, on purpose: the site is at zero. Add an entry ONLY with a comment
// directly above it justifying why a class genuinely can't do the job.
const INLINE_STYLE_ALLOWLIST = new Set([
  // (none — style.css's token/component system covers every current page)
]);
const INLINE_STYLE_RE = /(?<!data-)style\s*=\s*"[^"]*"/i;
for (const file of files) {
  const rel = relative(ROOT, file);
  if (INLINE_STYLE_ALLOWLIST.has(rel)) continue;
  const html = readFileSync(file, "utf8");
  if (INLINE_STYLE_RE.test(html)) {
    errors.push(`${rel}: inline style="..." attribute found — use a style.css component/utility class instead (see the stylesheet's own header comment), or add a justified entry to INLINE_STYLE_ALLOWLIST in scripts/validate.mjs`);
  }
}

// ---------------------------------------------------------------------------
// TOP-LEVEL ALLOWLIST (STRUCTURAL GUARDRAILS, 2026-09-03) — the
// scratch-directory incident: 62 lane scratch directories (raw mining
// dumps, build scripts, out-of-character names/contacts) were committed
// straight into the museum repo's top level and, absent from
// `.assetsignore`, UPLOADED TO THE R2 BUCKET by every r2-sync run for
// weeks — they only surfaced when a privacy hit inside one of them finally
// reddened a gate. `.gitignore` grew a `scratch-*/` rule that day, but a
// rule keyed on the one observed shape (a hyphenated directory) misses the
// next one — a root-level file, an underscore instead of a hyphen, a
// stray paperwork file dragged in by the very commit that did the
// cleanup. scripts/deploy-allowlist.mjs is the fixed, small, POSITIVE list
// of what belongs at the museum's top level; every tracked or
// untracked-unignored path (git's own file list — Invariant 13's `.claude/`
// exclusion honored, same as privacy-check.mjs) must resolve, at its first
// path segment, to something on that list. Anything else — a scratch dir,
// a dump, a stray worktree, an accidentally-committed workshop file — is a
// hard fail naming the exact path, every one, not just the first.
{
  const trackedOrUntracked = execSync("git ls-files -co --exclude-standard -z", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter((f) => f && !f.startsWith(".claude/"));
  const offendingPaths = new Map(); // top-level segment -> one example path
  for (const relPath of trackedOrUntracked) {
    const norm = relPath.split("/");
    const seg = norm[0];
    const isDir = norm.length > 1; // a path with more than one segment means seg is a directory
    if (!isAllowedTopLevel(seg, isDir)) {
      if (!offendingPaths.has(seg)) offendingPaths.set(seg, relPath);
    }
  }
  for (const [seg, example] of offendingPaths) {
    errors.push(`top-level path "${seg}" (e.g. ${example}) is not in scripts/deploy-allowlist.mjs's allowlist — scratch/dumps/worktrees never belong in the museum tree (lane scratch lives in archive/, one level up); add a reviewed entry to the allowlist ONLY if this is a genuine new top-level category`);
  }
}

// THE ECOSYSTEM EXPANSION GAVEL (the Janitor, 2026-09-05; CURATION.md
// v111(e)) — `machine-translation` is the TWELFTH document class: the one
// bounded English bridge per non-English primary the gaveled translation
// doctrine allows. Because that class slot then no longer says what KIND of
// document the bridge renders, a bridge additionally carries
// `data-doc-source-class` naming its primary's own class, so v109's serving
// rules still read mechanically off the page. Hoisted to module scope (it
// used to live inside the DOC-CLASS REQUIRED block below) so the bridge
// contract further down this file can read the same two sets rather than
// keeping a second copy that could drift.
const DOC_CLASSES = new Set([
  "card", "rp", "roster", "rules", "news", "staff",
  "credits", "guestbook", "board", "column", "other",
  "machine-translation", // v111(e), 2026-09-05 — the one bounded English bridge
  "poll", // the Janitor's gavel of 2026-09-19 — a year-end or community poll is its own class (GAVELS 2026-09-19 DOCUMENT CLASSES)
]);
const SOURCE_CLASSES = new Set([...DOC_CLASSES].filter((c) => c !== "machine-translation"));

// ---------------------------------------------------------------------------
// DOC-CLASS REQUIRED (CURATION v109(a), STRUCTURAL GUARDRAILS 2026-09-03) —
// every served document page carries `data-doc-class="…"` on its
// provenance paragraph so the serving rules in v109(b)-(e) can be read
// mechanically instead of trusted to memory. A "served document page" here
// is any page under promotions/<wing>/archive/ or promotions/<wing>/rp/
// that carries either the provenance paragraph
// (`<p class="muted small provenance">`, the current template) or an
// older-template footer citation naming a "Source:" — a wing's own
// archive/ or rp/ INDEX page (the holdings listing, not a document) is
// exempt, same as the reachability check's own index/instrument-page
// distinction elsewhere in this file. The class must be one of the ten
// v109(a) values.
// ---------------------------------------------------------------------------
{
  const PROVENANCE_PARA_RE = /<p class="muted small provenance"[^>]*>/i;
  const FOOTER_SOURCE_RE = /<footer[^>]*>[\s\S]*?Source:[\s\S]*?<\/footer>/i;
  const DOC_CLASS_ATTR_RE = /data-doc-class\s*=\s*"([^"]*)"/i;
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (!/^promotions\/[^/]+\/(archive|rp)\/.+\.html$/.test(rel)) continue;
    if (/\/(archive|rp)\/index\.html$/.test(rel)) continue; // holdings listing, not a document
    const html = readFileSync(file, "utf8");
    const looksLikeADocument = PROVENANCE_PARA_RE.test(html) || FOOTER_SOURCE_RE.test(html);
    if (!looksLikeADocument) continue;
    const m = html.match(DOC_CLASS_ATTR_RE);
    if (!m) {
      errors.push(`${rel}: served document carries a provenance paragraph/Source citation but no data-doc-class attribute (CURATION v109(a)) — classify it, or file "other" if a lane genuinely cannot decide`);
    } else if (!DOC_CLASSES.has(m[1])) {
      errors.push(`${rel}: data-doc-class="${m[1]}" is not one of the v109(a) classes (card | rp | roster | rules | news | staff | credits | guestbook | board | column | other | machine-translation | poll)`);
    }
  }
}

// ---------------------------------------------------------------------------
// NO SERVED CREDITS/GUESTBOOK (CURATION v109(d), STRUCTURAL GUARDRAILS
// 2026-09-03) — `credits` and `guestbook` are collect-never-serve BY
// DEFAULT: a page in either class is a list of real people by design, and
// v109(d) says it stays in the workshop unless "the Janitor's ruling on the
// specific document" serves it. The worked case was the PTCpedia
// Contributors page, found served nine days after a 322-document bulk
// accession put it live. This check makes the default structural: a
// served page of either class is a hard fail UNLESS it also carries
// `data-janitor-served="<date>"` — the specific ruling marker, not a
// lane's own judgment call. (Live tree note: the rspw mass-acknowledgement
// page is `credits`-classed and currently un-marked — it is HELD for the
// Janitor per the 2026-09-03 accession notes, not yet ruled on; this check
// is expected to catch it until that ruling lands, which is correct
// behavior, not a false positive.)
// ---------------------------------------------------------------------------
{
  const RESTRICTED_CLASS_RE = /data-doc-class\s*=\s*"(credits|guestbook)"/i;
  const JANITOR_SERVED_RE = /data-janitor-served\s*=\s*"[^"]+"/i;
  for (const file of files) {
    const rel = relative(ROOT, file);
    const html = readFileSync(file, "utf8");
    const m = html.match(RESTRICTED_CLASS_RE);
    if (m && !JANITOR_SERVED_RE.test(html)) {
      errors.push(`${rel}: data-doc-class="${m[1]}" is served without data-janitor-served="<date>" (CURATION v109(d) — credits/guestbook default to collect-never-serve; withdraw the page to the workshop, or get the specific Janitor ruling and stamp the marker)`);
    }
  }
}

// ---------------------------------------------------------------------------
// WITHDRAWN-PAGE CONSISTENCY (STRUCTURAL GUARDRAILS 2026-09-03) — the
// holdings-regeneration lesson: withdrawing a served page (git rm'ing it
// to collect-never-serve/) once left data/shards/<wing>/shows.json and
// rps.json still citing the withdrawn page's path, which produced 253
// dangling links from a regenerated wing holdings page and 2 dangling
// show-index rows before a gate caught it (gate run 11, 2026-09-03).
// withdraw-pages.py now drops those rows itself, but a shard file can
// still be hand-edited after the fact — this check makes the invariant
// structural instead of tool-dependent: no data/shards/*/shows.json or
// rps.json row may cite a promotions/... page (shows.json's `page` field,
// rps.json's `served_url`) that does not resolve to a real file. Link
// resolution mirrors resolveTarget() above (hash/query stripped,
// directory-style paths resolve to their index.html) so an anchor into a
// wing's own #storylines section is correctly NOT a dangling reference.
// A row with no page/served_url at all (an unserved/collected:false show)
// is untouched — nothing to resolve.
// ---------------------------------------------------------------------------
{
  const shardsDir = join(ROOT, "data", "shards");
  if (existsSync(shardsDir)) {
    const shardDirs = readdirSync(shardsDir).filter(
      (d) => existsSync(join(shardsDir, d)) && statSync(join(shardsDir, d)).isDirectory() && d !== "_headers",
    );
    for (const dir of shardDirs) {
      for (const [type, field] of [["shows", "page"], ["rps", "served_url"]]) {
        const p = join(shardsDir, dir, `${type}.json`);
        if (!existsSync(p)) continue;
        let rows;
        try { rows = JSON.parse(readFileSync(p, "utf8")); } catch { continue; } // registry-validate.mjs owns parse-failure reporting
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
          const url = row[field] || row.page; // rps.json rows may carry either shape (docs/SCHEMA.md)
          if (!url) continue;
          const resolved = resolveTarget(ROOT, url);
          if (!resolved || !existsSync(resolved)) {
            errors.push(`data/shards/${dir}/${type}.json: row "${row.id}" cites "${url}" — no such served page (withdrawn page left dangling in the shard; see withdraw-pages.py's own registry-row cleanup)`);
          }
        }
      }
    }
  }
}

// Non-blocking findings (printed, never fail the build on their own) —
// declared here, ahead of the first check that populates it, so every
// check below the errors[] declaration can push into either array.
const warnings = [];

// ---------------------------------------------------------------------------
// THE LAW RATCHET (LAW-ENFORCEMENT-01, 2026-09-19) — see the long comment in
// scripts/registry-validate.mjs for the doctrine. Short version: rules the
// law already states but only a soft advisory ever enforced are COUNTED every
// run and compared against scripts/law-baseline.json; a count that rose above
// its baseline (or, for a `min` rule, fell below it) is a hard failure. Debt
// may be paid down, never added to. `npm run law:baseline` rewrites the file
// and is a Janitor-or-coordinator act, never routine. The helper is
// duplicated verbatim across the four validators on purpose (this lane's file
// scope was four validators plus the baseline JSON).
// ---------------------------------------------------------------------------
const LAW_SCOPE = "validate";
const LAW_BASELINE_PATH = resolve(ROOT, "scripts", "law-baseline.json");
const LAW_RULES = {
  "served-page-contact-line": { dir: "max", law: "CURATION #privacy-redaction / #privacy (v74): a living person's contact detail is redacted in ANY context — a served page may not carry an e-mail address, AIM/ICQ/MSN/Yahoo handle or screen name behind its own label" },
  "served-page-handler-credit": { dir: "max", law: "CURATION #privacy (v74, out-of-character structures) + LAW-INDEX 2a: a Handler / Handled by / Written by credit naming a person is out of fiction and redacts — the persona serves, the credit does not" },
  "live-site-served": { dir: "max", law: "CURATION #dead-only-rule as amended v75/v98 + GAVELS 2026-08-26 THE LIVING-PRESERVATION CLAUSE: a living promotion IS collected and NEVER served — a wing whose own frontier row is verified-alive may hold no served document" },
};
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

// ---------------------------------------------------------------------------
// SERVED-PAGE PRIVACY SHAPES (LAW-ENFORCEMENT-01, 2026-09-19) — two structures
// the ledger-driven privacy checker cannot see, because it only ever catches a
// name somebody already filed. These read the SHAPE instead:
//
//   (1) a contact label carrying a real value. Period application forms are
//       full of blank "E-mail Address: ____" labels, which are fine and must
//       not be flagged, so the value has to look like an actual address or
//       handle — an e-mail address, a five-to-twelve digit ICQ number, or a
//       token carrying a digit/underscore/dot (example_07). A plain
//       capitalised English word after the colon is the NEXT FORM LABEL, not
//       a value.
//   (2) an out-of-character handler credit naming a person. "Real Name:" on a
//       bio card is the CHARACTER's own kayfabe name and serves (v105(a));
//       "Handler:", "Handled by:", "Written by:" is the credit block v74
//       redacts. Heuristic by construction — a two-capitalised-word value can
//       be an in-fiction writer ("Written by: President Uss") — so it is
//       ratcheted, never hard-failed, and the count prints with the pages.
// ---------------------------------------------------------------------------
{
  const CONTACT_LABEL = String.raw`(?:AOL\s*IM|AOL\s*Instant\s*Messenger|AOLIM|AIM|ICQ|MSN(?:\s*Messenger)?|Yahoo!?\s*(?:Messenger|IM|ID)|E-?mail(?:\s*Address)?|Screen\s*Name)`;
  const CONTACT_VALUE = String.raw`(?:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,6}|\d{5,12}|[A-Za-z][A-Za-z0-9]*[0-9_.][A-Za-z0-9._-]{0,18})`;
  // 2026-09-20: the value must sit on the label's own line — a blank form field ("B. Your e-mail address:" followed by the next
  // line's "C. Wrestlers name") is not a contact detail
  const CONTACT_RE = new RegExp(String.raw`\b${CONTACT_LABEL}\b[ \t]*(?:#|number|no\.?)?[ \t]*[:=]+[ \t]*(${CONTACT_VALUE})(?![A-Za-z0-9._@-])`, "gi");
  const CREDIT_RE = /\b(?:Handler(?:\s*Name)?|Handled\s*[Bb]y|Written\s*[Bb]y|Player\s*Name|Roleplayer|RPer)\b[ \t]*[:=\-]+[ \t]*(?:<[^>]+>[ \t]*)*([A-Z][a-z]{1,15}(?:[ \t]+[A-Z]\.?)?[ \t]+[A-Z][a-z]{1,19})(?![A-Za-z])/g;  // 2026-09-20: the name sits on the label's own line — a bare forename/handle followed by the next line's capitalised word is not a credit
  const contactPages = [];
  const creditPages = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (!/^promotions\/[^/]+\/(archive|rp)\/.+\.html$/.test(rel)) continue;
    const html = readFileSync(file, "utf8");
    CONTACT_RE.lastIndex = 0;
    let m, nc = 0;
    while ((m = CONTACT_RE.exec(html))) nc++;
    if (nc) { lawHit("served-page-contact-line", nc); contactPages.push(`${rel} (${nc})`); }
    CREDIT_RE.lastIndex = 0;
    let k = 0;
    while ((m = CREDIT_RE.exec(html))) k++;
    if (k) { lawHit("served-page-handler-credit", k); creditPages.push(`${rel} (${k})`); }
  }
  if (contactPages.length) warnings.push(`served pages carrying an unredacted contact line (CURATION v74 — contact details redact in any context): ${contactPages.slice(0, 20).join(", ")}${contactPages.length > 20 ? `, ... and ${contactPages.length - 20} more` : ""}`);
  if (creditPages.length) warnings.push(`served pages carrying an out-of-character handler credit naming a person (CURATION v74 credit-block clause; heuristic — an in-fiction "Written by" is a false positive): ${creditPages.slice(0, 20).join(", ")}${creditPages.length > 20 ? `, ... and ${creditPages.length - 20} more` : ""}`);
}

// ---------------------------------------------------------------------------
// NOTHING LIVING IS SERVED (LAW-ENFORCEMENT-01, 2026-09-19) — CURATION's
// dead-only rule as amended at v75, and GAVELS 2026-08-26's LIVING-
// PRESERVATION CLAUSE as gaveled into law at v98: a living promotion IS
// collected (kindly, locally, into the workshop) and is NEVER SERVED. The
// mechanical form: a frontier row whose own liveness status is
// `verified-alive` names a promotion that is still running, so no wing
// carrying that promotion's name may hold a served document. Matched on the
// row's name against a promotion's name/full_name/aka — a NAME match is not
// an identity ruling (ACRONYM IS NOT A JOIN, and neither is a name), which is
// exactly why this is ratcheted and prints its hits: each one is a case for
// the coordinator to rule, and the count may not grow while they sit.
// ---------------------------------------------------------------------------
{
  const frontierPath = join(ROOT, "data", "frontier.json");
  const docsPath = join(ROOT, "data", "documents.json");
  if (existsSync(frontierPath) && existsSync(docsPath)) {
    const fr = JSON.parse(readFileSync(frontierPath, "utf8"));
    const frRows = Array.isArray(fr) ? fr : (fr.rows ?? []);
    const alive = new Set(frRows.filter((r) => r && r.status === "verified-alive").map((r) => String(r.name ?? "").trim().toLowerCase()).filter(Boolean));
    const dj = JSON.parse(readFileSync(docsPath, "utf8"));
    const docRows = Array.isArray(dj) ? dj : (dj.documents ?? []);
    const servedByWing = new Map();
    for (const d of docRows) if (d && d.wing) servedByWing.set(d.wing, (servedByWing.get(d.wing) ?? 0) + 1);
    const pj = JSON.parse(readFileSync(join(ROOT, "data", "promotions.json"), "utf8"));
    const pRows = Array.isArray(pj) ? pj : (pj.promotions ?? []);
    const hits = [];
    for (const p of pRows) {
      const served = servedByWing.get(p.id) ?? 0;
      if (!served) continue;
      const names = new Set([p.name, p.full_name, ...(p.aka ?? [])].filter(Boolean).map((x) => String(x).trim().toLowerCase()));
      for (const n of names) if (alive.has(n)) { lawHit("live-site-served"); hits.push(`${p.id} (${served} served, frontier row "${n}" is verified-alive)`); break; }
    }
    if (hits.length) warnings.push(`wings serving documents while a same-named frontier row is verified-alive (CURATION dead-only rule, v75/v98 — a living promotion is collected, never served; each needs a coordinator identity ruling): ${hits.join("; ")}`);
  }
}


// CHROME ENFORCEMENT: every page's masthead+footer must be exactly what
// templates/chrome.html would stamp (scripts/stamp-chrome.mjs, `npm run
// chrome`). Chrome drift — a hand-edited nav link, a page that missed a
// re-stamp — becomes a CI failure here, not a silent inconsistency someone
// has to notice by eye. Dry-run only: this check never writes, it just
// asks "would stamping change anything?"
//
// THE CHROME I18N STEP (v112(a), 2026-09-05): per-page <html lang> is
// STAMPED, not hand-written, so it is covered HERE and needs no rule of its
// own — a page whose lang attribute disagrees with scripts/stamp-chrome.mjs's
// resolvePageLang() shows up as ordinary chrome drift, by construction. A
// second rule would be a second copy of the same truth, free to drift.
const { touched: chromeDrift } = stampAll({ write: false });
for (const rel of chromeDrift) {
  errors.push(`${rel}: chrome is out of date — run \`npm run chrome\` (templates/chrome.html)`);
}

// MARKER-PRESENCE GUARD (THE CHROME-COLLAPSE WAVE, 2026-08-19): the check
// above already catches a marker-less page indirectly (inserting the
// markers counts as a stamping "change," so a marker-less page always
// shows up as drift) — this says the same rule DIRECTLY, with its own
// specific message, so "every served page carries the markers" is an
// enforced invariant, not a side effect a reader has to infer from the
// drift check's own mechanics. No exempt class of page: a generated page
// (wrestlers/titles/awards/collections/memorials/a-z, all of which fell
// out of coverage before scripts/cross-reference.mjs's own pageShell()
// started emitting markers directly) is held to exactly the same rule as
// a hand-authored one. Scope matches stampAll's own "chrome-bearing page"
// definition: a page with no <!doctype html>/</header>/<footer> shape at
// all (a meta-refresh stub like who.html) is legitimately exempt — it was
// never a chrome-bearing page to begin with, not grandfathered out of one.
for (const file of files) {
  const rel = relative(ROOT, file);
  const html = readFileSync(file, "utf8");
  // ATTRIBUTE-TOLERANT (v112(a), 2026-09-05): a page whose own language is
  // not English carries <footer lang="en">, and an unwidened literal match
  // would quietly drop it out of this guard's coverage.
  const hasChromeShape = /<!doctype html>/i.test(html) && /<\/header>/.test(html) && /<footer\b[^>]*>[\s\S]*<\/footer>/.test(html);
  if (!hasChromeShape) continue;
  const hasMarkers =
    html.includes("<!-- chrome:head:start -->") && html.includes("<!-- chrome:head:end -->") &&
    html.includes("<!-- chrome:footer:start -->") && html.includes("<!-- chrome:footer:end -->");
  if (!hasMarkers) {
    errors.push(`${rel}: missing chrome:head/footer marker comments — every served page must carry them (run \`npm run chrome\`); a page without them silently falls out of the one-edit chrome system's coverage`);
  }
}

// DIGEST-PATH LEAK GUARD (retro-parity digest: a prior session found and
// fixed footer-level workshop-digest path leaks — a private-workshop path,
// per CLAUDE.md's own "digests are accession paperwork, not museum
// content... never served, never committed here," ending up in served
// text). HARD-FAIL (source-citation cleanup wave, 2026-08-19): the prior
// audit found the same leak class recurring at scale — 172
// wrestlers/*.html pages (172 tenure `source` citations across
// data/characters.json + data/units.json, rendered verbatim by
// cross-reference.mjs's renderTenuresSection). Every one of those 172 was
// traced back to what its digest itself cited as the underlying source
// (almost always a fed's own bio/title-history/RP-index page already
// named in the same citation string — the digest reference was a
// redundant paperwork parenthetical, not the only trail) and rewritten to
// name that real source, never the digest filename. The other 9
// data/*.json files carrying workshop-digest path strings were traced too
// (affiliations.json, awards.json, collections.json, promotions.json,
// reigns.json, relationships.json, review-queue.json, rp-catalog.json,
// shows.json) — none of their digest-bearing fields render onto any
// served page (confirmed against cross-reference.mjs's actual render
// calls, not assumed), so those are registry-internal paperwork and stay.
// This guard now fails the build on any regression — the 172 are clear
// and the render/non-render line has been checked, not guessed. DO NOT
// widen this into an allowlist if a new leak appears; trace and fix it
// the same way, or flag it honestly if the underlying source truly can't
// be recovered (cite the accession lot + source class instead).
{
  const digestLeaks = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    const html = readFileSync(file, "utf8");
    if (html.includes("archive" + "/digests/") || html.includes("archive" + "/privacy/")) digestLeaks.push(rel);
  }
  if (digestLeaks.length) {
    errors.push(`${digestLeaks.length} page(s) contain a literal workshop-digest or privacy-ledger path — a private workshop reference leaking into served content (see this check's own comment in scripts/validate.mjs): ${digestLeaks.slice(0, 5).join(", ")}${digestLeaks.length > 5 ? ", ..." : ""}`);
  }
}

// CENTERING-LINT (the salience-inversion incident: a context-free agent,
// working the XUW accession, wrote a wing epitaph whose real subject was
// XUW's *connection* to the UWF/GIWF rather than XUW itself — "a second
// house," a multi-sentence evidence chain, the works. Diagnosis: the
// workshop digests headline cross-fed connections because that was MINING
// salience (what was exciting to FIND); a wing page needs the opposite
// emphasis, and nothing in the corpus teaches that inversion by osmosis.
// This is the EXCLUDE_NAMES of prose — a soft, human-tuned trip-wire, not a
// grammar. Scoped to a wing's own <!-- epitaph:start/end --> section only
// (never a served artifact, never an essay — the connected-history essay
// and the new connections slot are the SANCTIONED places this material
// belongs, and both are exempt on purpose). Soft warnings, never a build
// failure — a real connection sometimes legitimately earns a mention; a
// human reads the warning and judges each one.
const promotionsData = JSON.parse(readFileSync(join(ROOT, "data", "promotions.json"), "utf8"));
// SELF-EXCLUSION FIX (QA-REGISTRY-AUDIT, 2026-08-28): self-exclusion used to
// compare a promotion's own NAME, lowercased, against the URL-derived slug
// (`ownAcronym`) — a string match that only works when a promotion's `name`
// already happens to be hyphenated exactly like its `id`. `wrestle-rpg`
// broke it: `name: "WRESTLE_RPG"` (underscored) vs. `id`/slug `wrestle-rpg`
// (hyphenated) never match, so the wing's OWN name searched its OWN
// epitaph as if it were a foreign promotion's acronym — a guaranteed false
// self-mention warning on every wing whose name isn't slug-shaped. Compare
// on `id` (the actual, unambiguous self-reference) instead of reconstructing
// a slug from `name` and hoping the two spellings agree.
const allPromoAcronyms = (promotionsData.promotions || [])
  .filter((p) => p.name)
  .map((p) => ({ id: p.id, name: p.name }));
const THESIS_PHRASES = [
  /second house/i, /same people behind/i, /the same circle/i,
  /this collection/i, /the museum'?s own/i,
];
for (const file of files) {
  const rel = relative(ROOT, file);
  if (!/^promotions\/[a-z0-9-]+\/index\.html$/.test(rel)) continue;
  const html = readFileSync(file, "utf8");
  const epitaphMatch = html.match(/<!-- epitaph:start -->([\s\S]*?)<!-- epitaph:end -->/);
  if (!epitaphMatch) continue;
  const epitaph = epitaphMatch[1];
  // THE MISSING-HEADING CHECK (2026-08-27): three lane-authored wings
  // (cswa, wce, whq) shipped epitaph prose without the <h2>Epitaph
  // heading the other 86 carry — caught by the Janitor's own eye, not a
  // gate. A wing's epitaph section must open with the heading; soft
  // warning so a deliberate future exception stays possible.
  if (!/<h2>Epitaph\b/.test(epitaph)) {
    warnings.push(`${rel}: epitaph section has prose but no <h2>Epitaph heading — the other wings all carry it (house convention; see any wing index)`);
  }
  const ownAcronym = rel.match(/^promotions\/([a-z0-9-]+)\//)[1];
  for (const { id: promoId, name: acro } of allPromoAcronyms) {
    if (promoId === ownAcronym) continue;
    const re = new RegExp(`(?<![A-Za-z0-9])${acro.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "g");
    const hits = (epitaph.match(re) || []).length;
    if (hits > 2) {
      warnings.push(`${rel}: epitaph mentions "${acro}" ${hits} times — a wing's own epitaph should run on its own arc; a connection this heavy usually belongs in the connections slot or the connected-history essay instead (see docs/PROCESS.md's Prose section)`);
    }
  }
  for (const phrase of THESIS_PHRASES) {
    if (phrase.test(epitaph)) {
      warnings.push(`${rel}: epitaph contains a thesis-phrase matching ${phrase} — usually a sign the sentence's real subject is "the user's other feds," not this promotion; see docs/PROCESS.md's Prose section, salience-inversion warning`);
    }
  }
}

// ---------------------------------------------------------------------------
// REACHABILITY (the orphan audit made permanent, 2026-08-22): every served
// page must be reachable from the front door by following internal links.
// The galleries lesson, as the Janitor put it: a page nobody knows exists
// serves nobody. Deliberately-unlinked pages are the documented exceptions
// below — additions to that list are a ruling, not a convenience.
// ---------------------------------------------------------------------------
{
  const DELIBERATELY_UNLINKED = new Set([
    "crawler.html", // THE CRAWLER PAGE (CURATION v98): the one ungated path — reached from EWMuseumBot's own +URL and operators' server logs, deliberately not woven into the gated site's nav
    "structure.html", // AI-drafted structural page awaiting the Janitor's editing pass before link-wiring
    "404.html",       // Cloudflare Pages serves it on any missing path — reached by error, not by link
  ]);
  const allPages = new Set();
  (function collect(dir) {
    for (const name of readdirSync(dir)) {
      if (name === ".git" || name === ".claude" || name === "bot" || name === "node_modules" || name === "functions" || name === "scripts" || name === "js" || name === "docs" || name === "templates" || name === "data") continue;
      const p = resolve(dir, name);
      if (statSync(p).isDirectory()) collect(p);
      else if (name.endsWith(".html")) allPages.add(relative(ROOT, p));
    }
  })(ROOT);
  const hrefRe = /href="(\/[^"#?]*)/g;
  const normalize = (h) => {
    let p = h.replace(/\/$/, "").replace(/^\//, "");
    if (p === "") return "index.html";
    if (p.endsWith(".html")) return p;
    return allPages.has(p + "/index.html") ? p + "/index.html" : p + ".html";
  };
  const seen = new Set(["index.html"]);
  const queue = ["index.html"];
  while (queue.length) {
    const cur = queue.pop();
    let text;
    try { text = readFileSync(resolve(ROOT, cur), "utf8"); } catch { continue; }
    for (const m of text.matchAll(hrefRe)) {
      const n = normalize(m[1]);
      if (allPages.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  for (const page of allPages) {
    if (!seen.has(page) && !DELIBERATELY_UNLINKED.has(page)) {
      errors.push(`${page}: unreachable from the front door — no internal link chain leads here (link it, or add it to validate.mjs's DELIBERATELY_UNLINKED list with a ruling)`);
    }
  }
  for (const page of DELIBERATELY_UNLINKED) {
    if (!allPages.has(page)) errors.push(`DELIBERATELY_UNLINKED lists "${page}" but no such page exists — prune the list`);
  }
}

// ---------------------------------------------------------------------------
// DOCUMENT LANGUAGE + THE MACHINE-TRANSLATION BRIDGE (THE ECOSYSTEM
// EXPANSION GAVEL, the Janitor, 2026-09-05; CURATION.md v111(c)/(e)). Two
// rules:
//
//  (1) A served document belonging to a wing whose registry row says it ran
//      in a language other than English must SAY SO ON THE PAGE — `lang="…"`
//      on its own `<div class="document">`. That attribute is what browsers'
//      own local translators key on (Firefox translates locally, with open
//      models and no network), and it lives OUTSIDE every chrome marker,
//      which is the whole reason the language goes there and not on <html>:
//      templates/chrome.html used to stamp `<html lang="en">` onto every page
//      in the site from one template, so a per-page override would have been
//      undone by the next `npm run chrome`. THAT IS NO LONGER SO (the chrome
//      i18n step, 2026-09-05, v112(a)): <html lang> is now a token resolved
//      per page by scripts/stamp-chrome.mjs's resolvePageLang(), and the
//      document div below is the fourth rung that resolver reads. The div
//      stays the law all the same — it is what a browser's own translator
//      keys on inside the page. ABSENT means "same as the page"
//      — i.e. English today — so every document div already on file is
//      correct and none was edited.
//
//  (2) THE BRIDGE CONTRACT: one English machine translation per NON-English
//      primary, never the reverse, never into a third language, never a
//      bridge of a bridge, always pointing both ways. The bridge is made in
//      the workshop from the SERVED — that is, already redacted — page, and
//      it is unreviewed until a community member reviews it, credited by
//      HANDLE or ROLE and never by real name (CURATION.md v74).
// ---------------------------------------------------------------------------
{
  const promoById = new Map((promotionsData.promotions || []).map((p) => [p.id, p]));
  const DOC_DIV_RE = /<div class="document"([^>]*)>/i;
  const LANG_ATTR_RE = /\blang\s*=\s*"([^"]*)"/i;
  const attr = (html, name) => (html.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i")) || [])[1];
  const bridgeTargets = new Map();
  for (const file of files) {
    const rel = relative(ROOT, file);
    const m = rel.match(/^promotions\/([^/]+)\/(?:archive|rp)\/(.+)\.html$/);
    if (!m) continue;
    if (/\/(archive|rp)\/index\.html$/.test(rel)) continue; // holdings listing, not a document
    const html = readFileSync(file, "utf8");
    const docClass = attr(html, "data-doc-class");
    if (!docClass) continue;
    const promo = promoById.get(m[1]);

    // data-doc-country — OPTIONAL, beside data-doc-class on the provenance
    // paragraph; absent means the wing's own country.
    const docCountry = attr(html, "data-doc-country");
    if (docCountry !== undefined && !/^[A-Z]{2}$/.test(docCountry)) {
      errors.push(`${rel}: data-doc-country="${docCountry}" is not an ISO 3166-1 alpha-2 code in upper case (CURATION v111(c))`);
    }

    // THE TRANSLATION CONTROL IS STRUCTURAL (THE ECOSYSTEM EXPANSION GAVEL,
    // 2026-09-05, step 2; CURATION.md v112(b)). A document a reader may not
    // be able to read owes that reader a way in: the marker pair where the
    // control is stamped. The control's CONTENT is stamped
    // (scripts/stamp-translations.mjs, which also bootstraps the pair) —
    // what this rule enforces is that a hand-built accession page cannot
    // ship without one, and that an English page cannot carry one by
    // copy-paste. One ladder, one answer: the page language comes from the
    // same resolver the chrome stamps from.
    const pageLang = resolvePageLang(rel.replace(/\\/g, "/"), html);
    const hasControl = html.includes("<!-- translation:start -->") && html.includes("<!-- translation:end -->");
    const owesControl = pageLang !== "en" || docClass === "machine-translation";
    // FOOTER-ONLY NON-ENGLISH DOCUMENT WARNS (lane L144, coordinator's ruling
    // on L117's open question Q2, the workshop's chrome-i18n-implementation-
    // rulings-2026-09-05.md). scripts/stamp-translations.mjs bootstraps the
    // marker pair off the <p class="muted small provenance"> paragraph and
    // rightly declines to guess an anchor on an older Source-footer page
    // (its own anchorMissing count, never a hand-placed guess) — so a
    // footer-only document in a non-English wing can never be given the
    // marker mechanically, and a hard error here would be a gate `npm run
    // chrome` can never clear. The provenance paragraph is what the
    // stamper's own anchor is: its presence, not the page's language alone,
    // is what tells this rule whether the missing marker is a defect or a
    // known, un-mechanisable gap. A page with neither shape (no provenance
    // paragraph AND no footer Source line) is not a served document at all
    // by the DOC-CLASS REQUIRED block above and never reaches this branch
    // with a docClass set, so the two tests below are exhaustive over the
    // documents this rule actually runs on.
    const hasProvenancePara = /<p class="muted small provenance"[^>]*>/i.test(html);
    if (owesControl && !hasControl) {
      if (hasProvenancePara) {
        errors.push(`${rel}: a non-English document (or its English bridge) must carry the <!-- translation:start/end --> marker pair — the reader-side translation control lives there (CURATION v112(b)); run \`npm run chrome\` to bootstrap and fill it`);
      } else {
        warnings.push(`${rel}: a non-English document carries no <!-- translation:start/end --> marker and has no provenance paragraph for \`npm run chrome\` to bootstrap one from (older Source-footer template) — run the footer-provenance fixer first (the workshop tools' fix-footer-provenance.py), then \`npm run chrome\` (CURATION v112(b))`);
      }
    }
    if (!owesControl && hasControl) {
      errors.push(`${rel}: carries a translation marker but the page is English and is not a bridge — the control exists for a non-English document and its bridge, nowhere else (CURATION v112(b))`);
    }

    // (1) document language
    const wingLang = promo && promo.language ? promo.language : "en";
    if (docClass !== "machine-translation" && wingLang !== "en") {
      const div = html.match(DOC_DIV_RE);
      if (!div) {
        errors.push(`${rel}: wing "${m[1]}" runs in "${wingLang}" but this served document has no <div class="document"> to carry its language — a non-English document serves inside one or it does not serve (CURATION v111(c))`);
      } else if (!LANG_ATTR_RE.test(div[1])) {
        errors.push(`${rel}: wing "${m[1]}" runs in "${wingLang}" but the document div carries no lang attribute — write <div class="document" lang="${wingLang}"> so browsers' own translators can read it (CURATION v111(c))`);
      }
    }

    // (2) the bridge contract
    if (docClass === "machine-translation") {
      const src = attr(html, "data-doc-source-class");
      const of = attr(html, "data-translation-of");
      const into = attr(html, "data-translation-into");
      const engine = attr(html, "data-translation-engine");
      const date = attr(html, "data-translation-date");
      const review = attr(html, "data-translation-review");
      const credit = attr(html, "data-translation-credit");
      if (!src || !SOURCE_CLASSES.has(src)) errors.push(`${rel}: data-doc-class="machine-translation" needs a data-doc-source-class naming what the PRIMARY is (one of the eleven v109(a) classes) — got "${src}"`);
      if (src === "credits" || src === "guestbook") errors.push(`${rel}: a bridge of a "${src}" document cannot exist — those classes are collect-never-serve by default (v109(d)), so there is no served primary to bridge`);
      if (into !== "en") errors.push(`${rel}: data-translation-into="${into}" — the bridge is into English and only English (the gaveled translation doctrine: never the reverse, never into a third language)`);
      if (!engine || !engine.trim()) errors.push(`${rel}: machine-translation page needs data-translation-engine naming the tool or model that made it`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) errors.push(`${rel}: machine-translation page needs data-translation-date="YYYY-MM-DD"`);
      if (review !== "unreviewed" && review !== "community-reviewed") errors.push(`${rel}: data-translation-review must be "unreviewed" or "community-reviewed" — got "${review}"`);
      if (review === "community-reviewed" && !(credit || "").trim()) errors.push(`${rel}: a community-reviewed translation is credited by HANDLE or ROLE in data-translation-credit, never by real name (CURATION v74)`);
      if (review === "unreviewed" && credit) errors.push(`${rel}: an unreviewed machine translation carries no data-translation-credit — nobody has reviewed it`);
      const docDiv = html.match(DOC_DIV_RE);
      const docLang = docDiv ? (docDiv[1].match(LANG_ATTR_RE) || [])[1] : undefined;
      if (docLang !== "en") errors.push(`${rel}: a bridge's own document div is the English rendering — write <div class="document" lang="en">`);
      if (!of || !of.startsWith(`/promotions/${m[1]}/`)) {
        errors.push(`${rel}: data-translation-of="${of}" must be the site-absolute path of a primary in this same wing`);
      } else {
        const target = join(ROOT, of.replace(/^\//, ""));
        if (!existsSync(target)) {
          errors.push(`${rel}: data-translation-of="${of}" does not exist on disk`);
        } else {
          const th = readFileSync(target, "utf8");
          const tClass = attr(th, "data-doc-class");
          const tDiv = th.match(DOC_DIV_RE);
          const tLang = tDiv ? (tDiv[1].match(LANG_ATTR_RE) || [])[1] : undefined;
          if (tClass === "machine-translation") errors.push(`${rel}: data-translation-of points at another bridge — there is no bridge of a bridge`);
          if (!tLang || tLang === "en") errors.push(`${rel}: data-translation-of points at an English document — the bridge exists only for a NON-English primary (the gaveled doctrine's one bounded exception)`);
          if (tClass && tClass !== "machine-translation" && src && tClass !== src) errors.push(`${rel}: data-doc-source-class="${src}" disagrees with the primary's own data-doc-class="${tClass}"`);
          if (attr(th, "data-translation-en") !== "/" + rel) errors.push(`${of}: does not point back at its bridge — the primary carries data-translation-en="/${rel}" (run \`npm run chrome\`)`);
          if (bridgeTargets.has(of)) errors.push(`${rel}: "${of}" already has a bridge at ${bridgeTargets.get(of)} — ONE English bridge per primary, by the gavel`);
          else bridgeTargets.set(of, rel);
        }
      }
    }
  }
}

if (warnings.length) {
  console.warn(`\nvalidate: ${warnings.length} centering-lint warning${warnings.length > 1 ? "s" : ""} (non-blocking)\n`);
  for (const w of warnings) console.warn("  ⚠ " + w);
  console.warn("");
}

lawRatchet((m) => errors.push(m));

if (errors.length) {
  console.error(`\nvalidate: FAILED (${errors.length} issue${errors.length > 1 ? "s" : ""})\n`);
  for (const e of errors) console.error("  ✗ " + e);
  console.error("");
  process.exit(1);
}

console.log(
  `validate: OK — ${files.length} pages, ${linkCount} internal links, all resolve; ` +
  `robots-meta (per public flag) + stylesheet + title correct on every page.`,
);
