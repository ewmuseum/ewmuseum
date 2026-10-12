#!/usr/bin/env node
/**
 * scripts/stamp-community-ask.mjs — THE COMMUNITY ASK (hook c216; the Janitor, chat and desk D489, 2026-10-09:
 * "some form on the main page where we can add the occasional ask for users ... with a donation to Jeff's family
 * being the current ask ... Something we could add when something important comes up, like the death of a community
 * member, but wouldn't need to regularly be seen.").
 *
 * THE ONE FILE: data/community-ask.json holds the current ask (its own _comment says how to change or end it).
 * This stamper runs at every build (`npm run stats`, inside the gate, after cross-reference has regenerated the
 * memorial pages) and:
 *   1. while the ask is live (active, started, not past `ends`), renders ONE quiet panel (the house .placard) into
 *      index.html, directly above the hero, and into memorials/<ask.memorial>.html, directly after its placard;
 *   2. otherwise, and on every other memorial page and in-memoriam.html always, removes any panel it finds.
 * Nothing else is touched: no other page carries the panel, nothing is fetched, nothing differs for any visitor.
 * The panel works without JavaScript; js/theme.js (hook c216's block) adds a per-ask dismiss and hides a panel whose
 * `ends` has passed between builds.
 * A malformed ask file FAILS the build (exit 1) rather than serve a half-checked ask.
 * Usage: node scripts/stamp-community-ask.mjs [--root <museum dir>] [--today YYYY-MM-DD] [--check]
 *   --check writes nothing and exits 1 when a page would change (the installing hook's own no-op proof).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
// a plain https address: no query string, no fragment (so no tracking parameters), nothing that could break the attribute
const URL_RE = /^https:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(\/[A-Za-z0-9._~%\/-]*)?$/;
// the panel as this stamper writes it: one <aside> on its own lines, found by its class (no marker comments on the page)
const PANEL_RE = /\n[ \t]*<aside class="placard community-ask"[^>]*>[\s\S]*?<\/aside>(?=\n)/g;

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export function todayUTC() { return new Date().toISOString().slice(0, 10); }

// Reads and checks data/community-ask.json; returns the ask object or null (no ask). Throws on anything malformed.
export function loadAsk(root) {
  const p = resolve(root, "data", "community-ask.json");
  if (!existsSync(p)) return null;
  const j = JSON.parse(readFileSync(p, "utf8"));
  const a = j && j.ask;
  if (a === null || a === undefined) return null;
  const bad = [];
  if (typeof a !== "object" || Array.isArray(a)) throw new Error("data/community-ask.json: 'ask' must be an object or null");
  if (typeof a.id !== "string" || !ID_RE.test(a.id)) bad.push("'id' must be lowercase letters, digits and hyphens");
  if (typeof a.active !== "boolean") bad.push("'active' must be true or false");
  if (typeof a.starts !== "string" || !DATE_RE.test(a.starts)) bad.push("'starts' must be YYYY-MM-DD");
  if (!(a.ends === null || (typeof a.ends === "string" && DATE_RE.test(a.ends)))) bad.push("'ends' must be YYYY-MM-DD or null");
  for (const k of ["lead", "text", "memorial_label"]) if (typeof a[k] !== "string" || !a[k].trim()) bad.push(`'${k}' must be a non-empty string`);
  if (!a.link || typeof a.link.url !== "string" || !URL_RE.test(a.link.url)) bad.push("'link.url' must be a plain https address with no query string or fragment");
  if (!a.link || typeof a.link.label !== "string" || !a.link.label.trim()) bad.push("'link.label' must be a non-empty string");
  if (typeof a.memorial !== "string" || !ID_RE.test(a.memorial)) bad.push("'memorial' must be a memorial id");
  else {
    const mem = JSON.parse(readFileSync(resolve(root, "data", "memorials.json"), "utf8")).memorials ?? [];
    if (!mem.some((m) => m && m.id === a.memorial)) bad.push(`'memorial' "${a.memorial}" is not in data/memorials.json`);
    if (!existsSync(resolve(root, "memorials", `${a.memorial}.html`))) bad.push(`memorials/${a.memorial}.html does not exist`);
  }
  if (bad.length) throw new Error("data/community-ask.json: " + bad.join("; "));
  return a;
}

export function askIsLive(a, today = todayUTC()) {
  return !!a && a.active === true && a.starts <= today && (a.ends === null || today <= a.ends);
}

// The panel. On the memorial page itself the link back to that page is left out.
export function renderAskPanel(a, { onMemorial = false, indent = "  " } = {}) {
  const ends = a.ends ? ` data-ask-ends="${esc(a.ends)}"` : "";
  const links = [`<a href="${esc(a.link.url)}" rel="noopener nofollow">${esc(a.link.label)}</a>`];
  if (!onMemorial) links.push(`<a href="/memorials/${esc(a.memorial)}.html">${esc(a.memorial_label)}</a>`);
  return `${indent}<aside class="placard community-ask" data-ask-id="${esc(a.id)}"${ends} aria-label="${esc(a.lead.replace(/[.\s]+$/, ""))}">\n` +
    `${indent}  <p><strong>${esc(a.lead)}</strong> ${esc(a.text)}</p>\n` +
    `${indent}  <p class="small">${links.join(" &middot; ")}</p>\n` +
    `${indent}</aside>`;
}

function strip(t) { return t.replace(PANEL_RE, ""); }

// Returns the new text of one page: every panel removed, then (when `panel` is given) one inserted at the page's anchor.
function stampPage(rel, t, panel) {
  const clean = strip(t);
  if (!panel) return clean;
  if (rel === "index.html") {
    const anchor = "\n  <div class=\"hero\">\n";
    if (clean.split(anchor).length !== 2) throw new Error("index.html: the hero (<div class=\"hero\">) is not on the page exactly once");
    return clean.replace(anchor, () => "\n" + panel + anchor);
  }
  // a memorial page: after its placard (the dedication comes first)
  const m = /\n  <div class="placard">\n[\s\S]*?\n  <\/div>\n/.exec(clean);
  if (!m) throw new Error(`${rel}: no placard to stand the ask after`);
  const at = m.index + m[0].length;
  return clean.slice(0, at) + panel + "\n" + clean.slice(at);
}

function memorialPages(root) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.isFile() && e.name.endsWith(".html")) out.push(relative(root, f));
    }
  };
  if (existsSync(resolve(root, "memorials"))) walk(resolve(root, "memorials"));
  return out.sort();
}

export function stampCommunityAsk(root, today = todayUTC(), { check = false } = {}) {
  const a = loadAsk(root);
  const live = askIsLive(a, today);
  const pages = ["index.html", "in-memoriam.html", ...memorialPages(root)];
  const changed = [];
  for (const rel of pages) {
    const p = resolve(root, rel);
    if (!existsSync(p)) continue;
    const t = readFileSync(p, "utf8");
    let panel = null;
    if (live && rel === "index.html") panel = renderAskPanel(a);
    if (live && rel === `memorials/${a.memorial}.html`) panel = renderAskPanel(a, { onMemorial: true });
    const n = stampPage(rel, t, panel);
    if (n !== t) { if (!check) writeFileSync(p, n); changed.push(rel); }
  }
  if (check) return { ask: a ? a.id : null, live, changed };
  // the care check: after stamping, the panel stands on the home page and the ask's own memorial page only
  for (const rel of pages) {
    const p = resolve(root, rel);
    if (!existsSync(p)) continue;
    const k = (readFileSync(p, "utf8").match(PANEL_RE) || []).length;
    const want = live && (rel === "index.html" || rel === `memorials/${a.memorial}.html`) ? 1 : 0;
    if (k !== want) throw new Error(`${rel}: carries ${k} community-ask panel(s) after stamping, wanted ${want}`);
  }
  return { ask: a ? a.id : null, live, changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const root = resolve(opt("--root") || resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  const today = opt("--today") || todayUTC();
  if (!DATE_RE.test(today)) { console.error("stamp-community-ask: --today must be YYYY-MM-DD"); process.exit(2); }
  try {
    const check = argv.includes("--check");
    const r = stampCommunityAsk(root, today, { check });
    console.log(`stamp-community-ask: ${r.ask ? `ask "${r.ask}" ${r.live ? "live" : "not live"}` : "no ask"} on ${today}; ` +
      (r.changed.length ? `${check ? "would update" : "updated"} ${r.changed.join(", ")}` : "no change (already fresh)"));
    if (check && r.changed.length) process.exit(1);
  } catch (e) {
    console.error("stamp-community-ask: FAILED: " + e.message);
    process.exit(1);
  }
}
