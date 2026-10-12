#!/usr/bin/env node
/**
 * THE MUSEUM — machine-translation bridge stamper (THE ECOSYSTEM EXPANSION
 * GAVEL, the Janitor, 2026-09-05: "Aligned with everything for the
 * expansion. Gaveled!"; CURATION.md v111(c)/(e)).
 *
 * The gaveled translation doctrine's one bounded exception: a NON-English
 * primary document may carry a single English BRIDGE machine-translation
 * beside it — `promotions/<wing>/archive/foo.html` gets
 * `promotions/<wing>/archive/foo.en.html`, class `machine-translation`, into
 * English and only English, made in the workshop from the SERVED (that is,
 * already redacted) page. This script owns the two things about that pair
 * which must never be hand-typed:
 *
 *   1. THE AI BADGE on a bridge's own <h1>. The house convention since
 *      2026-08-22 is that the badge sits inside the section header and is
 *      STRIPPED AND RE-DERIVED on every run, never hand-written — exactly
 *      what stamp-promotion-headers.mjs does for a wing's epitaph and its
 *      storyline arcs. Here the field driving it is the bridge's own
 *      `data-translation-review`: `unreviewed` badges, `community-reviewed`
 *      does not (the `caption_asof.author === "human"` rule, one field
 *      over). A reviewed community translation replacing a machine one is
 *      therefore a one-attribute edit plus a re-stamp, which is what "may
 *      replace it as a document upgrade" should cost.
 *
 *   2. THE RECIPROCAL LINK on the primary. The primary's provenance
 *      paragraph carries `data-translation-en="<the bridge's path>"` (which
 *      scripts/validate.mjs hard-checks, so a pair that stops pointing both
 *      ways fails the gate), and its `<!-- translation:start/end -->` marker
 *      carries the visible link a reader actually follows.
 *
 *   3. THE MARKER PAIR ITSELF, and the control between it (THE CHROME I18N
 *      STEP, 2026-09-05, step 2 of the same gavel; CURATION.md v112(b)).
 *      This script used to COUNT AND SKIP a primary with no marker, on the
 *      epitaph precedent — a stamper never invents a marker. The coordinator
 *      ruled that precedent to be about PROSE (nothing mechanical knows
 *      where a wing's epitaph section belongs) and this marker to be
 *      FURNITURE AT A FIXED ANCHOR: immediately above the provenance
 *      paragraph every served document already carries. So the pair is now
 *      bootstrapped — but ONLY onto a page that owes a control (a served
 *      document under a wing whose registry language is not English, or a
 *      machine-translation bridge), and never onto a page with no anchor,
 *      which is counted instead. On the English tree that loop matches
 *      nothing. The alternative was a hand edit on every non-English
 *      document forever.
 *
 *   4. THE FURNITURE, marked back to English. On a page whose own language
 *      is not English the museum's own five elements — crumb, kicker,
 *      doc-date, archival notice, provenance — carry lang="en", because an
 *      English sentence left unmarked inside a Polish page is fed through a
 *      Polish-to-English translator by every browser that offers to
 *      translate the page and comes back as nonsense. Stripped and
 *      re-derived in BOTH directions on every run, so a page that stops
 *      being non-English returns byte-identical to an ordinary English one.
 *
 * Idempotent marker-patch discipline, same as every other stamper here:
 * safe to re-run any time, byte-identical output on a second run with no
 * change. Folded into `npm run chrome`, after stamp-promotion-headers.mjs.
 *
 * On a tree with no bridges — which is every tree until the first
 * non-English wing lands — this walks the served documents and does
 * nothing, by construction.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
// THE CHROME I18N STEP (2026-09-05, step 2; CURATION.md v112(a)) — ONE
// page-language ladder, two scripts. The resolver lives beside the template
// that stamps <html lang> from it; importing it here rather than copying it
// is what keeps a page's own language and the control it owes from drifting
// apart.
import { resolvePageLang } from "./stamp-chrome.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROMOTIONS = resolve(ROOT, "promotions");

// The one AI-authorship badge fragment this script stamps — same markup as
// stamp-promotion-headers.mjs's own AI_BADGE, kept local per the
// standalone-unit precedent every stamper here already sets.
const AI_BADGE = ` <span class="ai-flag">Written by AI, 2026</span>`;   // hook c187 (the Janitor's D466): the mark says what it means
const BADGE_ANYWHERE_RE = /\s*<span class="ai-flag"[^>]*>(?:AI|Written by AI, 2026)<\/span>/g;   // hook c187: either text, so a stale pill is re-stamped once and never doubled
const BRIDGE_CLASS_RE = /data-doc-class\s*=\s*"machine-translation"/i;
const PROVENANCE_OPEN_RE = /<p class="muted small provenance"([^>]*)>/i;

// THE READER-SIDE AFFORDANCE (CURATION.md v111(c)/v112(b), 2026-09-05).
// Four rules the markup obeys and the gate enforces:
//   1. PLAIN LINKS ONLY. No embedded widget, no third-party script, no
//      third-party stylesheet, no iframe — anywhere, ever (validate.mjs's NO
//      THIRD-PARTY EMBED rule now says so mechanically). A translation
//      widget would put a company's JavaScript between a reader and a museum
//      document; the whole doctrine exists to prevent that.
//   2. PROVIDER-AGNOSTIC. Three or more, listed alphabetically by name so
//      the order names no favourite, each one a bare <a href>. The floor is
//      enforced in validate.mjs. Which providers is a convenience; the
//      museum depends on none of them.
//   3. THE BROWSER FIRST. The sentence about the reader's own browser comes
//      BEFORE the provider row, because that is the layer the doctrine
//      actually rests on: it needs no company, sends nothing anywhere, and
//      Firefox does it locally with open models.
//   4. NOTHING DEAD. While `public:false`, an external provider cannot fetch
//      a museum URL — the invite gate answers it, not the document. So the
//      provider row renders ONLY when the public flag is true. The bridge
//      link and the browser sentence render either way, because both work
//      today.
const START = "<!-- translation:start -->";
const END = "<!-- translation:end -->";
const PROV_ANCHOR_RE = /^([ \t]*)<p class="muted small provenance"/m;

// The museum's furniture on a served document page: five single-class,
// enumerable elements, NAMED INDIVIDUALLY rather than matched by a pattern,
// because a rule that guessed which text is the museum's would eventually
// mark a document's own words and hand a reader a mistranslation of the
// record. The <h1> inside .doc-head is deliberately NOT here — it is the
// document's own title, transcribed — and neither is <div class="document">,
// which carries its own lang from the bridge contract.
const FURNITURE = [
  '<p class="crumb"',
  '<span class="kicker"',
  '<span class="doc-date"',
  '<div class="archival-notice"',
  '<p class="muted small provenance"',
];
const EN_ATTR_RE = / lang="en"/;
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Mirrors stamp-promotion-headers.mjs's own esc(), character for character —
// the standalone-unit precedent every stamper in this directory follows.
function esc(s) {
  return String(s ?? "")
    .replace(/&(?!\w+;)/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// Plain English names for the BCP-47 tags a scene may run in. A tag with no
// entry renders as the tag itself rather than as a guess — the same posture
// promotions.html's own label tables take.
const LANGUAGE_NAMES = {
  "de": "German", "it": "Italian", "pl": "Polish", "ko": "Korean", "fr": "French",
  "es": "Spanish", "pt": "Portuguese", "pt-BR": "Portuguese", "ja": "Japanese",
  "nl": "Dutch", "sv": "Swedish", "da": "Danish", "nb": "Norwegian", "fi": "Finnish",
  "ru": "Russian", "ar": "Arabic", "tr": "Turkish", "cs": "Czech", "hu": "Hungarian",
  "el": "Greek", "he": "Hebrew", "hi": "Hindi", "id": "Indonesian", "th": "Thai",
  "vi": "Vietnamese", "zh-Hans": "Chinese", "zh-Hant": "Chinese", "en": "English",
};
const languageName = (tag) => LANGUAGE_NAMES[tag] || tag;

const SITE = JSON.parse(readFileSync(resolve(ROOT, "data", "site-config.json"), "utf8"));
const PROVIDERS = Array.isArray(SITE.translate_providers) ? SITE.translate_providers : [];
const SITE_URL = String(SITE.site_url || "").replace(/\/+$/, "");

function providerRow(relPath) {
  if (SITE.public !== true || PROVIDERS.length < 3 || !SITE_URL) return "";
  const abs = encodeURIComponent(`${SITE_URL}/${relPath}`);
  const links = [...PROVIDERS]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `<a href="${escAttr(p.url_template.replace("{url}", () => abs))}" rel="external nofollow noopener">${esc(p.name)}</a>`)
    .join(" &middot; ");
  return `\n    <p class="muted small">Or open this page at ${links}. None of them is part of the museum, none is needed to read it, and nothing here depends on any of them continuing to exist.</p>`;
}

const attr = (html, name) => (html.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i")) || [])[1];

// Every served document under a wing's archive/ or rp/ — the same scope
// validate.mjs's own doc-class check uses, index pages (the holdings
// listing, not a document) excluded.
function servedDocuments() {
  const out = [];
  if (!existsSync(PROMOTIONS)) return out;
  for (const wing of readdirSync(PROMOTIONS)) {
    for (const sub of ["archive", "rp"]) {
      const dir = join(PROMOTIONS, wing, sub);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".html") || name === "index.html") continue;
        out.push(join(dir, name));
      }
    }
  }
  return out;
}

const documents = servedDocuments();

// A page OWES a reader-side control when the reader may not be able to read
// it (a non-English served document) or when it is the English way in (a
// bridge). Both halves are read off the page and the registry, never off a
// filename.
function owesControl(rel, html) {
  return resolvePageLang(rel, html) !== "en" || BRIDGE_CLASS_RE.test(html);
}

// 0. THE MARKER BOOTSTRAP (CURATION.md v112(b), 2026-09-05; L98's open
// question 2). Furniture at a fixed anchor — immediately before the
// provenance paragraph — and only ever on a page that owes a control. Its
// OWN counters: `markerMissing` below is declared inside the control pass,
// and reaching it from here would be a temporal-dead-zone error. On the
// English tree this loop matches nothing.
let markersBootstrapped = 0, anchorMissing = 0;
for (const file of documents) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  let html = readFileSync(file, "utf8");
  if (!owesControl(rel, html) || html.includes(START)) continue;
  const a = html.match(PROV_ANCHOR_RE);
  if (!a) { anchorMissing++; continue; }   // older Source-footer template: counted, never guessed
  html = html.replace(a[0], () => `${a[1]}${START}${END}\n\n${a[0]}`);
  writeFileSync(file, html);
  markersBootstrapped++;
}

// 0b. THE FURNITURE PASS (CURATION.md v112(a), 2026-09-05). STRIPPED AND
// RE-DERIVED on every run, in BOTH directions: a page that stops being
// non-English (a wing reclassified, a document's lang corrected) loses the
// attributes and returns byte-identical to an ordinary English page. That
// two-way property is what keeps this reversible without a backfill, and it
// is why the pass rewrites rather than only inserting. The footer's own line
// is NOT marked here — it sits inside the chrome footer block, which
// templates/chrome.html's {{chrome_lang}} already marks whole. A bridge's
// furniture is not marked either, because a bridge resolves to "en" and its
// furniture is already the page's own language: correct by construction, no
// special case.
let furnitureChanged = 0;
for (const file of documents) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  let html = readFileSync(file, "utf8");
  const before = html;
  const wantEn = resolvePageLang(rel, html) !== "en";
  for (const open of FURNITURE) {
    // The whole open tag, every occurrence: strip any lang="en" a previous run
    // wrote, then re-add it only if the page still wants one — INSERTED
    // IMMEDIATELY AFTER THE CLASS ATTRIBUTE, never appended at the end of the
    // tag. That position is not cosmetic: the reciprocal-link pass below
    // rewrites this same provenance open tag and appends data-translation-en to
    // it, so an end-inserted lang and that attribute would swap places on every
    // run — the bytes would settle but neither pass would ever report zero, and
    // "a second run produces no diff" is the contract every stamper here keeps.
    html = html.replace(new RegExp(reEsc(open) + "[^>]*>", "g"), (tag) => {
      const bare = tag.replace(EN_ATTR_RE, "");
      if (!wantEn) return bare;
      return bare.slice(0, open.length) + ' lang="en"' + bare.slice(open.length);
    });
  }
  if (html !== before) { writeFileSync(file, html); furnitureChanged++; }
}

// 1. Collect the bridges, and badge each one off its own review field.
const bridgesByPrimary = new Map(); // primary site-absolute path -> { path, review }
let badgesChanged = 0;
for (const file of documents) {
  let html = readFileSync(file, "utf8");
  if (!BRIDGE_CLASS_RE.test(html)) continue;
  const rel = "/" + relative(ROOT, file);
  const review = attr(html, "data-translation-review");
  const of = attr(html, "data-translation-of");
  if (of) {
    // A second bridge naming the same primary is a hard fail in
    // validate.mjs (ONE English bridge per primary, by the gavel); this
    // stamper is not the place to rule on it, so it links the first and
    // leaves the duplicate for the validator to name.
    if (!bridgesByPrimary.has(of)) bridgesByPrimary.set(of, { path: rel, review });
  }
  const m = html.match(/(<h1[^>]*>)([\s\S]*?)(<\/h1>)/);
  if (!m) continue;
  let inner = m[2].replace(BADGE_ANYWHERE_RE, "");
  if (review !== "community-reviewed") inner += AI_BADGE;
  if (inner === m[2]) continue;
  // hook c228 (2026-10-09): every replace in this file takes a FUNCTION when its replacement carries page or registry
  // text, so a "$" in a title or a path is literal (a string replacement reads "$1", "$&", "$$" as patterns).
  html = html.replace(m[0], () => `${m[1]}${inner}${m[3]}`);
  writeFileSync(file, html);
  badgesChanged++;
}

// 2. The machine-readable half of the reciprocal link, on every bridged
// primary's provenance paragraph. validate.mjs hard-checks it, so a pair
// that stops pointing both ways fails the gate.
let primariesStamped = 0;
for (const [primaryPath, bridge] of bridgesByPrimary) {
  const file = resolve(ROOT, primaryPath.replace(/^\//, ""));
  if (!existsSync(file)) continue; // validate.mjs names a bridge pointing nowhere
  let html = readFileSync(file, "utf8");
  const before = html;
  const prov = html.match(PROVENANCE_OPEN_RE);
  if (prov) {
    const existing = new RegExp(`\\sdata-translation-en\\s*=\\s*"[^"]*"`);
    const cleaned = prov[1].replace(existing, "");
    html = html.replace(prov[0], () => `<p class="muted small provenance"${cleaned} data-translation-en="${bridge.path}">`);
  }
  if (html !== before) { writeFileSync(file, html); primariesStamped++; }
}

// 3. THE CONTROL (CURATION.md v112(b), 2026-09-05) — the half a reader
// follows, stripped and re-derived between the markers on every run like
// every other badge in this house. Three shapes, and the quality caveat the
// gavel names ("1990s slang and kayfabe translate badly") is carried by the
// words themselves, never hidden behind a neutral "translation" link:
//
//   (a) a NON-ENGLISH PRIMARY: its bridge, if it has one; then the sentence
//       about the reader's own browser; then — only once the site is public
//       — the provider row.
//   (b) the same page with no bridge yet: everything but the bridge line. A
//       document a reader cannot read still owes that reader a way in.
//   (c) a BRIDGE: the link back to the record, and what made this page.
//
// A page that owes a control but carries no marker pair is COUNTED, not
// invented — the bootstrap above is the only thing that writes a marker, and
// it declines a page with no provenance anchor.
let controlsStamped = 0, markerMissing = 0;
for (const file of documents) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  let html = readFileSync(file, "utf8");
  if (!owesControl(rel, html)) continue;
  if (!html.includes(START)) { markerMissing++; continue; }
  const before = html;
  const isBridge = BRIDGE_CLASS_RE.test(html);
  let body;
  if (isBridge) {
    const of = attr(html, "data-translation-of") || "";
    const review = attr(html, "data-translation-review");
    const engine = attr(html, "data-translation-engine") || "";
    const date = attr(html, "data-translation-date") || "";
    let primaryLang = "";
    try {
      const th = readFileSync(resolve(ROOT, of.replace(/^\//, "")), "utf8");
      primaryLang = (th.match(/<div class="document"[^>]*\blang\s*=\s*"([^"]*)"/i) || [])[1] || "";
    } catch { /* validate.mjs names a bridge pointing nowhere */ }
    const name = primaryLang ? languageName(primaryLang) : "the original";
    const backLink = of
      ? `\n    <p><span class="k">Read this in</span> <a href="${escAttr(of)}"${primaryLang ? ` hreflang="${escAttr(primaryLang)}"` : ""}>${esc(name)} &mdash; the document itself, served verbatim &rarr;</a></p>`
      : "";
    const note = review === "community-reviewed"
      ? `\n    <p class="muted small">This page is an English translation reviewed by a member of the community (credited on the document itself). The ${esc(name)} page is still the record; this one is a way in. 1990s slang and kayfabe translate badly &mdash; wherever this reads oddly, the original is where to check.</p>`
      : `\n    <p class="muted small">This page is a machine translation into English, made in the workshop${date ? ` on ${esc(date)}` : ""}${engine ? ` with <span class="mono">${esc(engine)}</span>` : ""}, and nobody has reviewed it. The ${esc(name)} page is the record; this one is a way in. 1990s slang and kayfabe translate badly &mdash; wherever this reads oddly, the original is where to check.</p>`;
    body = backLink + note;
  } else {
    const pageLang = resolvePageLang(rel, html);
    const bridge = bridgesByPrimary.get("/" + rel);
    const label = bridge && bridge.review === "community-reviewed"
      ? "English &mdash; a translation reviewed by a community member"
      : "English &mdash; a machine-made bridge translation, unreviewed";
    const bridgeLink = bridge
      ? `\n    <p><span class="k">Read this in</span> <a href="${escAttr(bridge.path)}" hreflang="en">${label} &rarr;</a></p>`
      : "";
    const name = esc(languageName(pageLang));
    body = bridgeLink
      + `\n    <p class="muted small">The document above is served verbatim in ${name}, and always will be &mdash; a translation never replaces it. Your own browser can translate it where you would rather read English: Firefox translates on your own machine, with open models and no network; Chrome, Edge and Safari offer it on request.</p>`
      + providerRow(rel);
  }
  const inner = `\n  <aside class="translate" lang="en">${body}\n  </aside>\n  `;
  html = html.replace(new RegExp(`${START}[\\s\\S]*?${END}`), () => `${START}${inner}${END}`);
  if (html !== before) { writeFileSync(file, html); controlsStamped++; }
}

console.log(
  `stamp-translations: ${badgesChanged} bridge badge(s) stamped/changed, ` +
  `${primariesStamped} primary link(s) stamped, ` +
  `${markersBootstrapped} marker(s) bootstrapped (${anchorMissing} with no anchor), ` +
  `${furnitureChanged} page(s) with furniture marked, ` +
  `${controlsStamped} translation control(s) stamped, ` +
  `${markerMissing} page(s) owing a control with no translation marker.`,
);
