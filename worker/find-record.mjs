/**
 * THE E-WRESTLING MUSEUM — the exact-name record lookup (D448, the Janitor, 2026-10-08: "the cheaper exact-name lookup instead").
 *
 * GET /api/find-record?q=<name>[&kind=character|title|wing][&wing=<wing id>][&n=<1..20>]
 *
 * Finds a character, a title or a wing by its name, with no AI index and no per-chain sync cost: a deterministic lookup over a
 * compact name index, data/find-record-index.json, which scripts/build-find-record-index.mjs regenerates in every gate from the
 * registry (so it cannot go stale) and r2-sync uploads with the site. The Worker reads that object from the bucket, parses it
 * once per isolate and checks it again every FIND_INDEX_TTL_MS.
 *
 * Imported by worker/index.mjs (the route) and by scripts/build-find-record-index.mjs (the generator's self-check). No other I/O
 * than the bucket binding passed in `env`. The pure half (normalizeName, buildIndex, lookup) runs under plain Node.
 *
 * WHAT IT RETURNS: records of three kinds only, each a page that is served: /characters/<id>.html (a character or a unit's own
 * page), /titles/<id>.html (a title; four wing-held titles have the wing's page as theirs), /promotions/<id>/index.html (a wing).
 * Matching, in this order: (1) "id": the query IS the record's id; (2) "exact": the query equals the record's name or one of its
 * aka names, after folding case, accents, apostrophes and punctuation (and a leading "The", and a trailing "(1999-2001)"-style
 * qualifier); (3) "words": every word of the query is a whole word of one of its names (so q=world&wing=pcw&kind=title lists the
 * PCW titles with "World" in the name). Nothing fuzzy, nothing semantic.
 *
 * CARE (binding, D448): the memorial pages (/memorials/*) and /in-memoriam are never records here. The generator refuses to write
 * them into the index, and this module refuses to answer with any page outside the three shapes above, whatever the index says.
 * The 51 character pages that carry "In memoriam / Linked to <name>" are ordinary character pages and are returned as such;
 * nothing in a result says anything about a memorial. Units listings (/units/a-z/*) and the a-z indexes are not records.
 */

export const FIND_PATH = "/api/find-record";
export const FIND_INDEX_KEY = "data/find-record-index.json";
export const FIND_MAX_QUERY = 120;         // characters; a longer query is refused (400)
export const FIND_DEFAULT_RESULTS = 10;
export const FIND_MAX_RESULTS = 20;        // the most one answer may hold, whatever ?n= says
export const FIND_INDEX_TTL_MS = 5 * 60 * 1000;   // how long a parsed index is trusted before the bucket is asked again (a HEAD)
export const FIND_KINDS = { character: "c", title: "t", wing: "w" };
const KIND_NAME = { c: "character", t: "title", w: "wing" };
const KIND_ORDER = { w: 0, t: 1, c: 2 };    // on a tie: the wing, then its titles, then people

const FIND_STOP = new Set(["the", "a", "an", "and", "of", "in", "on", "to", "for"]);
const FOLD = { "ø": "o", "đ": "d", "ł": "l", "æ": "ae", "œ": "oe", "ß": "ss", "ð": "d", "þ": "th", "ı": "i" };

/** Fold a name for matching: accents off, lower case, apostrophes dropped, "&" as "and", other punctuation to a space. Pure. */
export function normalizeName(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[øđłæœßðþı]/g, (c) => FOLD[c])
    .replace(/['’‘`´]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Every normalized form a name answers to: itself, without a trailing "(...)" qualifier, without a leading "the". Pure. */
export function nameForms(name) {
  const out = new Set();
  const add = (v) => { const n = normalizeName(v); if (n) out.add(n); };
  const s = String(name ?? "");
  add(s);
  const bare = s.replace(/\s*[(\[][^)\]]*[)\]]\s*$/, "").trim();
  if (bare && bare !== s) add(bare);
  for (const n of [...out]) if (n.startsWith("the ") && n.length > 6) out.add(n.slice(4));
  return [...out];
}

/** The page a stored row [kind, id, name, wings, extras?] answers with. Pure. */
export function pageOf(r) {
  const ex = r[4];
  if (ex && typeof ex === "object" && typeof ex.p === "string" && ex.p) return ex.p;
  if (r[0] === "c") return "/characters/" + r[1] + ".html";
  if (r[0] === "t") return "/titles/" + r[1] + ".html";
  return "/promotions/" + r[1] + "/index.html";
}

/** The only page shapes a record may have. A memorial, In Memoriam, a units listing or an a-z index can never pass. Pure. */
export function isRecordPage(page) {
  if (typeof page !== "string" || page.includes("..") || page.includes("//") || page.includes("?") || page.includes("#")) return false;
  if (/^\/(characters|titles)\/(?!a-z\/)[^/]+\.html$/.test(page)) return true;
  return /^\/promotions\/[^/]+\/(index\.html)?$/.test(page);
}

/**
 * The stored file -> the lookup structure. The file (written by the generator):
 *   { _schema_version: 1, wings: [wing id, ...], rows: [ [kind "c|t|w", id, display name, [wing indexes], extras?], ... ] }
 * where extras is { a: [aka names], s: sub-kind (a unit's kind), p: page when it is not the default }. Pure; throws on a bad shape.
 *
 * MEMORY (a Worker isolate holds 128 MB): the rows stay the parsed arrays, with no object made per row, and the names are one flat
 * list of folded strings (" pcw world "), searched in a straight scan: 57,000 strings is a millisecond or two, and it costs about
 * a third of what word maps cost (measured 2026-10-08 on 42,895 rows: 18 MB settled and 35 MB at the peak of a load, against 63 MB).
 */
export function buildIndex(doc) {
  if (!doc || doc._schema_version !== 1 || !Array.isArray(doc.rows) || !Array.isArray(doc.wings)) throw new Error("find-record index: bad shape");
  const rows = [];
  for (const r of doc.rows) {
    if (!Array.isArray(r) || r.length < 4 || !KIND_NAME[r[0]] || typeof r[1] !== "string" || typeof r[2] !== "string" || !Array.isArray(r[3])) continue;
    if (!isRecordPage(pageOf(r))) continue;   // belt and braces: a memorial, units or other non-record page never enters
    rows.push(r);
  }
  const norms = [];   // " folded name " (padded, so a whole-word test is includes(" word "))
  const owner = [];   // norms[i] belongs to rows[owner[i]]
  rows.forEach((r, ri) => {
    const ex = r[4] && typeof r[4] === "object" ? r[4] : null;
    const seen = new Set();
    for (const nm of ex && Array.isArray(ex.a) ? [r[2], ...ex.a] : [r[2]]) {
      for (const norm of nameForms(nm)) {
        if (seen.has(norm)) continue;
        seen.add(norm);
        norms.push(" " + norm + " ");
        owner.push(ri);
      }
    }
  });
  const wingIndex = new Map(doc.wings.map((w, i) => [w, i]));   // wing id -> its index in wings[]
  const wingIds = new Set();
  const wingNames = new Map(); // folded wing name -> wing id (for ?wing=<a name>)
  for (const r of rows) {
    if (r[0] !== "w") continue;
    wingIds.add(r[1].toLowerCase());
    const ex = r[4] && typeof r[4] === "object" ? r[4] : null;
    for (const nm of ex && Array.isArray(ex.a) ? [r[2], ...ex.a] : [r[2]]) for (const f of nameForms(nm)) if (!wingNames.has(f)) wingNames.set(f, r[1]);
  }
  return { rows, norms, owner, wings: doc.wings, wingIndex, wingIds, wingNames, count: rows.length };
}

/** One stored row as a plain object (only ever made for the few rows an answer shows, and by tests and the generator). */
export function rowObject(idx, r) {
  const ex = r[4] && typeof r[4] === "object" ? r[4] : {};
  const row = {
    kind: r[0], id: r[1], name: r[2],
    wings: (r[3] || []).map((i) => idx.wings[i]).filter(Boolean),
    akas: Array.isArray(ex.a) ? ex.a.map(String) : [],
    sub: typeof ex.s === "string" ? ex.s : "",
  };
  row.pagePath = pageOf(r);
  return row;
}

/** Every row as an object (tests and the generator's self-check only: it makes 40,000 objects). */
export function allRows(idx) { return idx.rows.map((r) => rowObject(idx, r)); }

/** Resolve a ?wing= value to a wing id: an id, else the exact name of a wing. null if it is neither. Pure. */
export function resolveWing(idx, raw) {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  if (idx.wingIds.has(v.toLowerCase())) return v.toLowerCase();
  const byName = idx.wingNames.get(normalizeName(v));
  return byName ? byName.toLowerCase() : null;
}

/**
 * The lookup. params: { q, kind: "character|title|wing"|"", wing: wing id|"", n }. Returns { total, results: [ { row, match } ] },
 * best first: id, then exact, then words; within words, the name with the fewest extra words first; then wing < title < character;
 * then by name. `wing` must already be a resolved id (resolveWing). Pure.
 */
export function lookup(idx, params) {
  const n = Math.max(1, Math.min(FIND_MAX_RESULTS, Math.floor(Number(params.n)) || FIND_DEFAULT_RESULTS));
  const kind = params.kind ? FIND_KINDS[params.kind] : "";
  const wing = params.wing ? String(params.wing).toLowerCase() : "";
  const wi = wing ? idx.wingIndex.get(wing) : undefined;
  const qn = normalizeName(params.q);
  if (qn.length < 2) return { total: 0, results: [] };
  const ok = (r) => (!kind || r[0] === kind) && (!wing || (r[0] === "w" ? r[1].toLowerCase() === wing : wi !== undefined && r[3].includes(wi)));
  const hit = new Map(); // row -> { tier, extra }
  const put = (r, tier, extra) => {
    if (!ok(r)) return;
    const had = hit.get(r);
    if (!had || tier < had.tier || (tier === had.tier && extra < had.extra)) hit.set(r, { tier, extra });
  };
  // 0: the query is an id (ids are lower-case slugs)
  const rawId = String(params.q ?? "").trim().toLowerCase();
  if (/^[a-z0-9][a-z0-9._-]*$/.test(rawId)) for (const r of idx.rows) if (r[1] === rawId) put(r, 0, 0);
  // 1: exact name; 2: every query word is a whole word of one name. (A query made only of words too common to place a name
  // by, such as "the", has no words tier.)
  const sq = " " + qn + " ";
  const qt = [...new Set(qn.split(" "))];
  const wordsToo = !qt.every((t) => FIND_STOP.has(t));
  const pad = qt.map((t) => " " + t + " ");
  const { norms, owner, rows } = idx;
  for (let i = 0; i < norms.length; i++) {
    const nm = norms[i];
    if (nm === sq) { put(rows[owner[i]], 1, 0); continue; }
    if (!wordsToo) continue;
    let all = true;
    for (let k = 0; k < pad.length; k++) if (!nm.includes(pad[k])) { all = false; break; }
    if (all) put(rows[owner[i]], 2, nm.split(" ").length - 2 - qt.length);
  }
  const rank = [...hit.entries()].sort((a, b) =>
    a[1].tier - b[1].tier || a[1].extra - b[1].extra || KIND_ORDER[a[0][0]] - KIND_ORDER[b[0][0]] ||
    (a[0][2] < b[0][2] ? -1 : a[0][2] > b[0][2] ? 1 : a[0][1] < b[0][1] ? -1 : a[0][1] > b[0][1] ? 1 : 0));
  const MATCH = ["id", "exact", "words"];
  return { total: rank.length, results: rank.slice(0, n).map(([r, h]) => ({ row: rowObject(idx, r), match: MATCH[h.tier] })) };
}

/** A result row as the JSON answer shows it. */
export function shapeRow({ row, match }) {
  const out = { kind: KIND_NAME[row.kind], id: row.id, name: row.name, page: row.pagePath, match };
  if (row.wings.length) out.wings = row.wings.slice(0, 6);
  if (row.sub) out.unit = row.sub;
  if (row.akas.length) out.aka = row.akas.slice(0, 4);
  return out;
}

// ---------------------------------------------------------------------------
// The Worker half: the index cache and the route.
// ---------------------------------------------------------------------------

let CACHE = null;   // { idx, etag, at }
let LOADING = null; // a load in flight, shared

async function loadIndex(env, now = Date.now()) {
  if (CACHE && now - CACHE.at < FIND_INDEX_TTL_MS) return CACHE.idx;
  if (LOADING) return LOADING;
  LOADING = (async () => {
    try {
      const bucket = env.MUSEUM_BUCKET;
      if (CACHE) {
        // still the same object? then trust it for another window
        const head = await bucket.head(FIND_INDEX_KEY);
        if (head && head.etag === CACHE.etag) { CACHE.at = now; return CACHE.idx; }
      }
      const obj = await bucket.get(FIND_INDEX_KEY);
      if (!obj) throw new Error("find-record index not in the bucket");
      const doc = JSON.parse(await obj.text());
      const idx = buildIndex(doc);
      CACHE = { idx, etag: obj.etag, at: now };
      return idx;
    } finally {
      LOADING = null;
    }
  })();
  return LOADING;
}

/** Test hook: forget the cached index. */
export function _resetFindCache() { CACHE = null; LOADING = null; }

/** true = within both limits; false = over one; null = the limiter bindings are missing (refuse: never unmetered). */
async function findRateOk(request, env, clientKey) {
  const per = env.FIND_LIMITER;
  const site = env.FIND_LIMITER_SITE;
  if (!per || typeof per.limit !== "function" || !site || typeof site.limit !== "function") return null;
  const mine = await per.limit({ key: clientKey(request) });
  if (!mine || !mine.success) return false;
  const all = await site.limit({ key: "site" });
  return Boolean(all && all.success);
}

/**
 * GET /api/find-record. Reached only after the gate has admitted the request (or while the door is open). deps comes from
 * worker/index.mjs: { jsonResponse(pathname, status, obj, extraHeaders), searchClientKey(request), retryAfter }.
 */
export async function findRecordApi(request, env, url, deps) {
  const { jsonResponse, searchClientKey, retryAfter } = deps;
  const p = url.pathname;
  let rate;
  try { rate = await findRateOk(request, env, searchClientKey); } catch (e) {
    console.error("find-record limiter failed:", String((e && e.message) || e).slice(0, 200));
    rate = null;
  }
  if (rate === null) return jsonResponse(p, 503, { results: [], error: "unavailable" });
  if (!rate) return jsonResponse(p, 429, { results: [], error: "slow down" }, { "Retry-After": String(retryAfter) });

  const q = String(url.searchParams.get("q") ?? "").replace(/\s+/g, " ").trim();
  if (q.length > FIND_MAX_QUERY) return jsonResponse(p, 400, { results: [], error: "query too long", max: FIND_MAX_QUERY });
  const kindRaw = String(url.searchParams.get("kind") ?? "").trim().toLowerCase();
  if (kindRaw && !Object.prototype.hasOwnProperty.call(FIND_KINDS, kindRaw)) {
    return jsonResponse(p, 400, { results: [], error: "kind must be character, title or wing" });
  }
  const wingRaw = String(url.searchParams.get("wing") ?? "").trim();
  if (wingRaw.length > 120) return jsonResponse(p, 400, { results: [], error: "wing too long" });
  const nRaw = Number(url.searchParams.get("n"));
  const n = Math.max(1, Math.min(FIND_MAX_RESULTS, Number.isFinite(nRaw) && nRaw >= 1 ? Math.floor(nRaw) : FIND_DEFAULT_RESULTS));
  if (normalizeName(q).length < 2) return jsonResponse(p, 200, { q, kind: kindRaw || undefined, total: 0, results: [] });

  let idx;
  try { idx = await loadIndex(env); } catch (e) {
    console.error("find-record index failed:", String((e && e.message) || e).slice(0, 200)); // never echoed to the browser
    return jsonResponse(p, 502, { q, results: [], error: "unavailable" });
  }
  let wing = "";
  if (wingRaw) {
    wing = resolveWing(idx, wingRaw);
    if (wing === null) return jsonResponse(p, 200, { q, kind: kindRaw || undefined, wing: wingRaw, total: 0, results: [], note: "no wing has that id or name" });
  }
  const { total, results } = lookup(idx, { q, kind: kindRaw, wing, n });
  // Served-now check: a page withdrawn or taken down since the index was built is gone from the bucket, so it is dropped here.
  // All the HEADs run at once; a HEAD that fails drops its row, never shows it.
  const bucket = env.MUSEUM_BUCKET;
  const live = await Promise.all(results.map(({ row }) => bucket.head(row.pagePath.replace(/^\//, "").replace(/\/$/, "/index.html")).then((o) => o !== null, () => false)));
  const shown = results.filter((_, i) => live[i]).map(shapeRow);
  const body = { q, total, results: shown };
  if (kindRaw) body.kind = kindRaw;
  if (wing) body.wing = wing;
  if (total > results.length) body.more = "Narrow it with kind= and wing=, or add words to the name.";
  return jsonResponse(p, 200, body);
}
