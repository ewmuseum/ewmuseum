#!/usr/bin/env node
/**
 * THE MUSEUM — hand-authored-page pager stamper (THE SELFISH-REVIEWER
 * FEATURE, prev/next navigation wave).
 *
 * Characters and accessions are fully GENERATED pages — cross-reference.mjs
 * bakes their own prev/next inline, same file, same pass, always in sync
 * with the data. Wings' own index.html and essays/*.html are hand-authored
 * prose, not generated from scratch each run — this script is their
 * equivalent of stamp-chrome.mjs: it recomputes each type's own sortKey
 * order from the registry and patches a `<!--pager:start-->...
 * <!--pager:end-->` marker pair with the baked prev/next nav, same
 * idempotent contract as chrome (safe to re-run any time, only writes on
 * an actual change).
 *
 * Two types today:
 *   - "promotions": every promotions/<id>/index.html, ordered by display label
 *     (full_name if it differs from the acronym, else the acronym) —
 *     the same order promotions.html itself sorts by at rest.
 *   - "essays": every essays/*.html and any essay whose own `page` lives
 *     under a wing (the two Hall-of-Fame induction essays currently do),
 *     ordered by title.
 *
 * Run: `node scripts/stamp-pager.mjs` (folded into `npm run chrome`, same
 * "structural marker stamp" family as the masthead/footer and the
 * connections slot).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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

// Mirrors js/list.js's sortKey() / cross-reference.mjs's sortKeyStr() — kept
// in sync by hand across all three, same as every other duplicated-on-
// purpose sort helper in this repo (Node build step vs browser vs this
// second Node script, none of them share a module today).
function sortKeyStr(name) {
  return String(name ?? "").replace(/^the\s+/i, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function esc(s) {
  return (s ?? "")
    .replace(/&(?!\w+;)/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Mirrors cross-reference.mjs's own pagerNav() — same markup contract,
// duplicated rather than imported (this script has no other dependency on
// cross-reference.mjs and isn't worth wiring one up for a single function).
function pagerNav(type, prevItem, nextItem) {
  if (!prevItem && !nextItem) return "";
  const prev = prevItem
    ? `<a class="pager-prev" href="${esc(prevItem.href)}" rel="prev">&larr; ${esc(prevItem.label)}</a>`
    : "";
  const next = nextItem
    ? `<a class="pager-next" href="${esc(nextItem.href)}" rel="next">${esc(nextItem.label)} &rarr;</a>`
    : "";
  // no whitespace-only lines when prev/next is absent (git diff --check blocks the commit on them)
  const pagerLines = [prev, `<span class="pager-indicator" hidden></span>`, next].filter(Boolean).map((l) => `    ${l}`).join("\n");
  return `<nav class="pager" data-pager-type="${esc(type)}" aria-label="Browse ${esc(type)}">
${pagerLines}
  </nav>
  <script src="/js/pager.js?v=4"></script>`;
}

function pagerLabel(p) {
  return p.full_name && p.full_name !== p.name ? p.full_name : p.name;
}

function buildSequence(items) {
  return items.map((it, i) => ({
    ...it,
    prev: i > 0 ? items[i - 1] : null,
    next: i < items.length - 1 ? items[i + 1] : null,
  }));
}

function patchFile(relPath, html) {
  const p = resolve(ROOT, relPath);
  if (!existsSync(p)) {
    console.error(`stamp-pager: ${relPath} does not exist — skipped`);
    return false;
  }
  const raw = readFileSync(p, "utf8");
  const re = /<!--pager:start-->[\s\S]*?<!--pager:end-->/;
  if (!re.test(raw)) {
    console.error(`stamp-pager: ${relPath} has no <!--pager:start/end--> marker — skipped`);
    return false;
  }
  const newRaw = raw.replace(re, () => `<!--pager:start-->\n  ${html}\n  <!--pager:end-->`);   // hook c228: a function, so a "$" in a label is literal
  if (newRaw !== raw) {
    writeFileSync(p, newRaw, "utf8");
    return true;
  }
  return false;
}

export function stampPagers({ write = true } = {}) {
  const promotions = loadArray("promotions");
  const essays = loadArray("essays");

  let changed = 0, total = 0;

  // ---- promotions (promotions/<id>/index.html) ----
  const promoItems = promotions
    .filter((p) => p.page)
    .map((p) => ({ href: p.page, label: pagerLabel(p), file: `${p.page.replace(/^\//, "").replace(/\/$/, "")}/index.html` }))
    .sort((a, b) => {
      const ka = sortKeyStr(a.label), kb = sortKeyStr(b.label);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  for (const { prev, next, file } of buildSequence(promoItems)) {
    total++;
    const html = pagerNav("promotions", prev ? { href: prev.href, label: prev.label } : null, next ? { href: next.href, label: next.label } : null);
    if (write && patchFile(file, html)) changed++;
  }

  // ---- essays (essays/*.html, plus any essay whose page lives elsewhere) ----
  // hook c108 (CURATION.md v129): a v129 row (one carrying `status`) is left to cross-reference.mjs, which bakes the
  // pager into the essay page it renders, as it does for memorial pages (a one-page sequence here would stamp a
  // whitespace-only line between the pager markers).
  const essayItems = essays
    .filter((e) => e.page && e.status === undefined)
    .map((e) => ({ href: e.page, label: e.title, file: e.page.replace(/^\//, "") }))
    .sort((a, b) => {
      const ka = sortKeyStr(a.label), kb = sortKeyStr(b.label);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  for (const { prev, next, file } of buildSequence(essayItems)) {
    total++;
    const html = pagerNav("essays", prev ? { href: prev.href, label: prev.label } : null, next ? { href: next.href, label: next.label } : null);
    if (write && patchFile(file, html)) changed++;
  }

  return { total, changed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { total, changed } = stampPagers({ write: true });
  console.log(`stamp-pager: ${changed} of ${total} pages updated (promotions + essays).`);
}
