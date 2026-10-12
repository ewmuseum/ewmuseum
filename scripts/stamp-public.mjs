#!/usr/bin/env node
/**
 * THE MUSEUM — public-plumbing stamper (PHASE-3 PLUMBING, the Janitor's
 * directive, 2026-08-22: "go ahead and do all of the plumbing for public,
 * even with the auth wall still there for now").
 *
 * Reads data/site-config.json's `public` flag and stamps three artifacts
 * so the whole open/gated state is ONE flag flip away, never a hand-edit
 * across files:
 *
 *   - sitemap.xml — every served page (404.html excluded), generated from
 *     the same page walk validate.mjs uses. Generated in BOTH states (it
 *     is inert behind the gate); robots.txt only advertises it when public.
 *   - robots.txt — gated: Disallow all (the gate 403s crawlers anyway;
 *     this just says so politely). Public: search crawlers welcome,
 *     sitemap advertised, and the settled crawler policy applied — bulk/AI
 *     training consumers are pointed at the repository mirror instead of
 *     the rendered site (CRAWLER POLICY, phase-3 design ledger).
 *   - _headers robots block ("# robots:start/end" markers, same chrome
 *     pattern as the clacks lines): gated -> X-Robots-Tag: noindex;
 *     public -> X-Robots-Tag: nocache (Bing/Copilot's own control: stay
 *     search-indexed, limit verbatim reuse in AI answers — the Janitor to
 *     confirm at the open).
 *
 * THE INDEXABLE FLAG (the Janitor, desk D429, 2026-10-07: "index from day
 * one" ... "the indexing should explicitly deny AI model training usage";
 * hook c115, launch day). data/site-config.json `indexable: true` opens
 * robots.txt and the `_headers` robots block to search engines on its own,
 * while `public` keeps governing the pages' own noindex meta (validate.mjs);
 * `public: true` implies it. The open robots.txt carries the Content-Signal
 * line (contentsignals.org: search=yes, ai-train=no), names the AI-training
 * crawlers it refuses, and keeps /api/ out.
 *
 * Run: folded into `npm run stats`. Idempotent. `--robots-only` stamps
 * robots.txt and _headers and leaves sitemap.xml alone (hook c115's install).
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(resolve(ROOT, "data", "site-config.json"), "utf8"));
const PUBLIC = cfg.public === true;
const INDEXABLE = PUBLIC || cfg.indexable === true; // D429 (hook c115): robots.txt + the _headers robots block
const ROBOTS_ONLY = process.argv.includes("--robots-only");
const ORIGIN = "https://ewmuseum.org";

// Same walk-exclusions as validate.mjs's reachability check.
const SKIP = new Set([".git", ".claude", "bot", "node_modules", "functions", "scripts", "js", "docs", "templates", "data"]);
const pages = [];
if (!ROBOTS_ONLY) (function collect(dir) { // --robots-only: no page walk, sitemap.xml untouched
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = resolve(dir, name);
    if (statSync(p).isDirectory()) collect(p);
    else if (name.endsWith(".html")) pages.push(relative(ROOT, p));
  }
})(ROOT);
pages.sort();

const urls = pages
  .filter((p) => p !== "404.html")
  .map((p) => {
    let path = "/" + p.replace(/\\/g, "/");
    if (path.endsWith("/index.html")) path = path.slice(0, -"index.html".length);
    return `  <url><loc>${ORIGIN}${path.replace(/&/g, "&amp;")}</loc></url>`;
  });
if (!ROBOTS_ONLY) writeFileSync(resolve(ROOT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`);

const robots = INDEXABLE
  ? `# THE E-WRESTLING MUSEUM — crawler policy
# Search crawlers are welcome: discoverability feeds collection, and
# "it will help people find the museum" (the Janitor, D429, 2026-10-07).
# AI-training use is NOT licensed, from here or from the repository —
# most of this collection is other people's creative work, held in
# trust; the museum cannot grant training rights it does not own.
# See LICENSE.md in the repository. No commercial use either way.
# Content-Signal (contentsignals.org): search=yes (index us, link us,
# show short excerpts); ai-train=no (no training or fine-tuning).

User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: Claude-Web
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: Applebot-Extended
Disallow: /

User-agent: PerplexityBot
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: meta-externalagent
Disallow: /

User-agent: cohere-ai
Disallow: /

User-agent: *
Content-Signal: search=yes, ai-train=no
Allow: /
Disallow: /api/

Sitemap: ${ORIGIN}/sitemap.xml
`
  : `# THE E-WRESTLING MUSEUM — the site is gated (public:false).
# Nothing to index yet; the gate answers 403 regardless.

User-agent: *
Disallow: /
`;
writeFileSync(resolve(ROOT, "robots.txt"), robots);

const headersPath = resolve(ROOT, "_headers");
const raw = readFileSync(headersPath, "utf8");
const block = INDEXABLE ? "  X-Robots-Tag: nocache, noai, noimageai" : "  X-Robots-Tag: noindex";
const re = /(  # robots:start\n)([\s\S]*?)(  # robots:end)/;
if (!re.test(raw)) throw new Error('_headers: no "# robots:start/end" marker pair found');
const out = raw.replace(re, (_w, a, _b, c) => `${a}${block}\n${c}`);
if (out !== raw) writeFileSync(headersPath, out);

console.log(`stamp-public: ${PUBLIC ? "PUBLIC" : INDEXABLE ? "gated pages, indexable" : "gated"} — sitemap.xml ${ROBOTS_ONLY ? "left as it is" : urls.length + " urls"}, robots.txt ${INDEXABLE ? "open" : "closed"}, X-Robots-Tag ${INDEXABLE ? "nocache" : "noindex"}.`);
