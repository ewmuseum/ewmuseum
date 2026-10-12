#!/usr/bin/env node
/**
 * scripts/build-accessions-feed.mjs — THE ACCESSIONS FEED (hook c221; the Janitor, chat, 2026-10-09: "we should set up an
 * RSS feed for the accession updates"; where it is served is the Janitor's desk D497).
 *
 * Writes feed.xml at the museum root: an RSS 2.0 feed of the newest FEED_COUNT accessions, newest first. Every word in it is
 * already served on /collections/: each item is one row of data/collections-index.json (written by cross-reference.mjs's
 * generateAccessionIndex, the rows the Collections page paints), read back out of the row's own markup:
 *   title        "Accession NNNN: <the row's label>" (the kind, and the contributor credit where the row carries one)
 *   link, guid   https://ewmuseum.org/collections/NNNN.html
 *   description  the row's blurb, exactly as the row serves it (never the lot's note, never page text)
 *   pubDate      the day the lot's first served page went up (data/documents.json `served_since`), else the day its first wing
 *                was added (data/promotion-dates.json): the same derivation as the home page's "Recently added" dates
 *                (scripts/stamp-stats.mjs computeRecentlyAdded). A lot with neither takes the date of the nearest older lot
 *                that has one (it cannot have arrived before it), else of the nearest newer one. Dates are written at 12:00 UTC,
 *                so a reader in any zone from UTC-11 to UTC+11 shows the same calendar day the museum does.
 * lastBuildDate is the newest item's pubDate, never the clock: the file changes only when the accessions do, so a gate that
 * rebuilds it twice writes the same bytes.
 * Where it is served (the Worker, worker/index.mjs, FEED_MODE): unset = behind the invite gate like every page; "public" =
 * /feed.xml ungated; "private" = /feed/<FEED_TOKEN>.xml ungated, the token a Worker secret and never in this repository.
 *
 * Run: folded into `npm run stats` (after stamp-public.mjs). Idempotent. Reads only; writes feed.xml (or --out).
 * Usage: node scripts/build-accessions-feed.mjs [--root <museum dir>] [--out <file>] [--check]
 *   --check writes nothing and exits 1 when the file would change.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const FEED_COUNT = 50;
export const ORIGIN = "https://ewmuseum.org";
export const FEED_PATH = "/feed.xml";
const CHANNEL_TITLE = "The E-Wrestling Museum: new accessions";
const CHANNEL_DESC = "The newest accessions of the e-wrestling museum, each a lot numbered in the order it arrived.";

const ROW_RE = /^<span class="when">([^<]*)<\/span><a href="\/collections\/(\d{4})\.html">\2<\/a> &mdash; ([^<]*)$/;
const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", middot: "·",
  hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", eacute: "é", egrave: "è",
  aacute: "á", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü", ouml: "ö",
  auml: "ä", ccedil: "ç", times: "×", copy: "©", reg: "®", trade: "™", deg: "°",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// HTML text (as a served row carries it) -> plain text. An entity this table does not know is kept as written, and named.
const unknownEntities = new Set();
export function htmlText(s) {
  return String(s).replace(/&(#\d+|#x[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    if (Object.prototype.hasOwnProperty.call(NAMED, e)) return NAMED[e];
    unknownEntities.add(e);
    return whole;
  });
}

// Plain text -> XML character data. Characters XML 1.0 forbids are dropped.
export function xml(s) {
  return String(s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function rfc822(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() !== +m[2] - 1) return null;
  return `${DAYS[d.getUTCDay()]}, ${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} 12:00:00 +0000`;
}

function loadArray(root, name) {
  const p = resolve(root, "data", `${name}.json`);
  if (!existsSync(p)) return [];
  const raw = JSON.parse(readFileSync(p, "utf8"));
  if (Array.isArray(raw)) return raw;
  const key = Object.keys(raw).find((k) => k[0] !== "_" && Array.isArray(raw[k]));
  return key ? raw[key] : [];
}
const listOf = (c) => (Array.isArray(c) ? c : [c]);

// The lots' dates: stamp-stats.mjs computeRecentlyAdded's derivation, lot by lot (served_since first, then the wings' added
// dates). The registry's larger files are read only when some lot in the feed has no served page to date it by.
function lotDates(root, ids) {
  const want = new Set(ids);
  const dates = new Map();
  for (const d of loadArray(root, "documents")) {
    if (typeof d.served_since !== "string") continue;
    for (const c of listOf(d.collection)) {
      if (!want.has(c)) continue;
      const cur = dates.get(c);
      if (cur === undefined || d.served_since < cur) dates.set(c, d.served_since);
    }
  }
  const undated = ids.filter((id) => !dates.has(id));
  if (undated.length) {
    const pd = existsSync(resolve(root, "data", "promotion-dates.json"))
      ? (JSON.parse(readFileSync(resolve(root, "data", "promotion-dates.json"), "utf8")).dates ?? {}) : {};
    const promotions = loadArray(root, "promotions");
    const promoIds = new Set(promotions.map((p) => p.id));
    const wings = new Map(undated.map((id) => [id, new Set()]));
    const add = (lot, w) => { if (wings.has(lot) && promoIds.has(w)) wings.get(lot).add(w); };
    for (const p of promotions) for (const s of p.sources || []) add(s.accession, p.id);
    for (const s of loadArray(root, "shows")) for (const c of listOf(s.collection)) add(c, s.promotion);
    for (const r of loadArray(root, "rps")) for (const c of listOf(r.collection)) add(c, r.promotion ?? r.venue);
    for (const d of loadArray(root, "documents")) for (const c of listOf(d.collection)) add(c, d.wing);
    for (const [id, ws] of wings) {
      const first = [...ws].map((w) => (pd[w] || {}).added).filter((x) => typeof x === "string").sort()[0];
      if (first) dates.set(id, first);
    }
  }
  return dates;
}

export function buildFeed(root) {
  const idxPath = resolve(root, "data", "collections-index.json");
  if (!existsSync(idxPath)) return null;
  const rows = JSON.parse(readFileSync(idxPath, "utf8")).collections_index;
  if (!Array.isArray(rows) || !rows.length) throw new Error("data/collections-index.json carries no collections_index rows");
  const parsed = rows.map((r) => {
    const m = ROW_RE.exec(String(r && r.h));
    if (!m || m[2] !== r.i) throw new Error(`data/collections-index.json: row ${r && r.i} is not the row shape the Collections page serves`);
    return { id: m[2], label: htmlText(m[1]).trim(), blurb: htmlText(m[3]).trim() };
  });
  parsed.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)); // accession ids ARE the acquisition sequence
  const newest = parsed.slice(0, FEED_COUNT);
  const own = lotDates(root, newest.map((x) => x.id));
  // the fallback: the nearest older dated lot, else the nearest newer one
  const dateOf = newest.map((x, i) => {
    if (own.has(x.id)) return own.get(x.id);
    for (let j = i + 1; j < newest.length; j++) if (own.has(newest[j].id)) return own.get(newest[j].id);
    for (let j = i - 1; j >= 0; j--) if (own.has(newest[j].id)) return own.get(newest[j].id);
    return null;
  });
  if (dateOf.some((d) => !rfc822(d))) throw new Error("no date could be derived for some accession in the feed (data/documents.json served_since, data/promotion-dates.json)");
  const items = newest.map((x, i) => {
    const url = `${ORIGIN}/collections/${x.id}.html`;
    return [
      "  <item>",
      `    <title>${xml(`Accession ${x.id}: ${x.label}`)}</title>`,
      `    <link>${xml(url)}</link>`,
      `    <guid isPermaLink="true">${xml(url)}</guid>`,
      `    <pubDate>${rfc822(dateOf[i])}</pubDate>`,
      `    <description>${xml(x.blurb)}</description>`,
      "  </item>",
    ].join("\n");
  });
  const newestDate = dateOf.reduce((a, b) => (b > a ? b : a));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "<channel>",
    `  <title>${xml(CHANNEL_TITLE)}</title>`,
    `  <link>${ORIGIN}/collections/</link>`,
    `  <description>${xml(CHANNEL_DESC)}</description>`,
    "  <language>en</language>",
    `  <lastBuildDate>${rfc822(newestDate)}</lastBuildDate>`,
    `  <atom:link href="${ORIGIN}${FEED_PATH}" rel="self" type="application/rss+xml"/>`,
    ...items,
    "</channel>",
    "</rss>",
    "",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const root = resolve(opt("--root") || resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  const out = resolve(opt("--out") || resolve(root, "feed.xml"));
  const check = argv.includes("--check");
  try {
    const body = buildFeed(root);
    if (body === null) {
      console.log("build-accessions-feed: data/collections-index.json not built yet; skipped until refresh:links writes it");
      process.exit(0);
    }
    if (unknownEntities.size) console.log(`build-accessions-feed: kept as written, entity name(s) not in the table: ${[...unknownEntities].sort().join(", ")}`);
    const old = existsSync(out) ? readFileSync(out, "utf8") : null;
    const changed = old !== body;
    if (changed && !check) writeFileSync(out, body, "utf8");
    const n = (body.match(/<item>/g) || []).length;
    console.log(`build-accessions-feed: ${n} accessions; ${changed ? (check ? "would update" : "updated") : "no change (already fresh)"} ${out === resolve(root, "feed.xml") ? "feed.xml" : out}`);
    if (check && changed) process.exit(1);
  } catch (e) {
    console.error("build-accessions-feed: FAILED: " + e.message);
    process.exit(1);
  }
}
