/**
 * THE E-WRESTLING MUSEUM — the text search's pure half (D289, D294).
 *
 * Imported by worker/index.mjs (its GET /api/search route) and by nothing in
 * the served tree. No I/O here: the query parser, the one request body every
 * backend gets, and the chunk -> page-row shaping, so a test can run them
 * without a Worker runtime.
 */

// characters; worker/index.mjs refuses a longer query (400) before any backend call (cost cap, hook c85 re-cut 2026-10-07)
export const SEARCH_MAX_QUERY = 200;
const SEARCH_DEFAULT_PAGES = 10;  // pages per answer
const SEARCH_MAX_PAGES = 20;
const SEARCH_SNIPPET = 280;       // characters
// words too common to place a passage by (the page's emphasis skips the same list)
const STOP = new Set("the and for are but not you all any can her was one our out his has him how its who did yes she they them then than that this with from have were what when where which will would there their your into about been some such only also very just over".split(" "));
const SEARCH_FILTER_FIELDS = { wing: "wing", promotion: "wing", class: "doc_class", doc_class: "doc_class" };

// THE RANKING (hook c120, the Janitor's D435 "work on speed and ranking before launch"; D289 (b) kept: retrieval options
// only, no rerank, no query rewrite, no generation). Measured 2026-10-07 on the 25 known-item questions
// (the workshop's quality-queries.tsv) and 10 held-out ones, full index (lane SEARCH-TUNE; the table is in
// the workshop's search-tune proof):
//   hybrid, rrf fusion, backend order (c85)   12/25 first, 22 top five; held-out 2/10 first; median ~7.3 s
//   keyword only, backend order               16/25 first, 23 top five; held-out 10/10;      median ~3.0 s
//   keyword only + the title nudge below      19/25 first, 23 top five; held-out 10/10;      median ~3.0 s   <- this
//   hybrid, max fusion + the title nudge      19/25 first, 24 top five; held-out 10/10;      median ~5.5 s
// The rrf fusion interleaved the vector leg's weak hits rank for rank with the keyword leg's strong ones (vector alone:
// 6/25 first), and the hybrid call was the slow one; keyword-only halves the wait. To trade speed for the vector leg's
// recall of paraphrased questions, set SEARCH_RETRIEVAL to { retrieval_type: "hybrid", fusion_method: "max" } (measured).
const SEARCH_RETRIEVAL = { retrieval_type: "keyword" };
// The title nudge: a page's best chunk score (the backend's own, 0..1) plus this much times the share of the query's
// words (3+ letters, not STOP) found in the page's own title (metadata.title). 0.05 and 0.25 measured the same top-1.
const SEARCH_TITLE_NUDGE = 0.1;

/** Split a raw query into free text and the two metadata filters. Pure. */
export function parseTextQuery(raw) {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_QUERY);
  const filters = {};
  const ignored = [];
  const words = [];
  // tokens: "quoted phrases" and bare words; a field:value token is a bare word
  for (const m of s.matchAll(/"[^"]*"|\S+/g)) {
    const t = m[0];
    const fv = /^-?([a-z_]+):(.+)$/i.exec(t);
    if (t[0] !== '"' && fv) {
      const field = SEARCH_FILTER_FIELDS[fv[1].toLowerCase()];
      const value = fv[2].replace(/^"|"$/g, "").trim().toLowerCase();
      if (field && !t.startsWith("-") && /^[a-z0-9][a-z0-9._-]{0,80}$/.test(value)) filters[field] = value;
      else ignored.push(t);
      continue;
    }
    words.push(t);
  }
  return { text: words.join(" ").trim(), filters, ignored };
}

/** The one request body every backend gets (binding or REST). Pure. */
export function searchRequestBody(parsed, pages = SEARCH_DEFAULT_PAGES) {
  const retrieval = {
    ...SEARCH_RETRIEVAL,
    // chunks, not pages: a page can return several chunks, so ask for more; never more than 50 (cost cap)
    max_num_results: Math.min(50, pages * 3),
    keyword_match_mode: "or",
  };
  const f = parsed.filters || {};
  if (Object.keys(f).length) {
    // the explicit {$eq} form (hook c120): the bare {field: value} shorthand failed the keyword leg outright
    // ("All search methods failed: keyword", measured 2026-10-07); {$eq} answers on both legs
    retrieval.filters = {};
    for (const [k, v] of Object.entries(f)) retrieval.filters[k] = { $eq: v };
  }
  return {
    query: parsed.text,
    ai_search_options: {
      retrieval,
      reranking: { enabled: false },
      query_rewrite: { enabled: false },
    },
  };
}

function pageOfChunk(chunk) {
  const meta = (chunk && chunk.item && chunk.item.metadata) || {};
  let page = typeof meta.page === "string" ? meta.page : "";
  if (!page) {
    const key = chunk && chunk.item && chunk.item.key;
    // hashed keys (h/<sha1>.md) carry their page only in metadata
    if (typeof key === "string" && key.endsWith(".md") && !key.startsWith("h/")) page = "/" + key.slice(0, -3) + ".html";
  }
  if (!/^\/promotions\/[^?#]+\.html$/.test(page) || page.includes("..") || page.includes("//")) return "";
  return page;
}

function snippetOf(text, words) {
  // the indexed text opens with "# <title>" (the ingest's own shape); the title is shown apart
  let t = String(text || "").replace(/^# [^\n]*\n+/, "").replace(/\s+/g, " ").trim();
  if (t.length <= SEARCH_SNIPPET) return t;
  const low = t.toLowerCase();
  let at = -1;
  for (const w of words) {
    const i = low.indexOf(w);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  let start = at === -1 ? 0 : Math.max(0, at - Math.floor(SEARCH_SNIPPET / 3));
  if (start > 0) {
    const sp = t.indexOf(" ", start);
    start = sp !== -1 && sp - start < 30 ? sp + 1 : start;
  }
  let end = Math.min(t.length, start + SEARCH_SNIPPET);
  if (end < t.length) {
    const sp = t.lastIndexOf(" ", end);
    if (sp > start + SEARCH_SNIPPET / 2) end = sp;
  }
  const body = t.slice(start, end).replace(/^[\s.,;:!?)\]…-]+/, "");
  return (start > 0 ? "…" : "") + body + (end < t.length ? "…" : "");
}

function wordsOf(s) {
  return (String(s || "").toLowerCase().match(/[\p{L}\p{N}']{3,}/gu) || []).filter((w) => !STOP.has(w));
}

/** The share (0..1) of the query's words that the title holds. Pure. */
export function titleCover(words, title) {
  const q = [...new Set(words)];
  if (!q.length) return 0;
  const t = new Set(wordsOf(title));
  return q.filter((w) => t.has(w)).length / q.length;
}

/**
 * Chunks -> one row per page (hook c120). A page's score is its best chunk's own score plus the title nudge
 * (SEARCH_TITLE_NUDGE x titleCover); rows are sorted by that, the backend's order breaking ties, and each row's
 * snippet comes from its page's best chunk. A chunk without a numeric score is scored by its place in the
 * backend's order (1 for the first, falling evenly), so a result without scores keeps the backend's order. Pure.
 */
export function shapeResults(result, parsed, pages = SEARCH_DEFAULT_PAGES) {
  const chunks = (result && (result.chunks || (result.result && result.result.chunks) || result.data)) || [];
  const words = wordsOf(parsed.text);
  const best = new Map(); // page -> { chunk, score, order }
  chunks.forEach((c, i) => {
    const page = pageOfChunk(c);
    if (!page) return;
    const own = typeof c.score === "number" && Number.isFinite(c.score) ? c.score : 1 - i / Math.max(1, chunks.length);
    const had = best.get(page);
    if (!had) best.set(page, { chunk: c, score: own, order: best.size });
    else if (own > had.score) { had.chunk = c; had.score = own; }
  });
  const ranked = [...best.entries()].map(([page, b]) => {
    const meta = (b.chunk.item && b.chunk.item.metadata) || {};
    return { page, b, meta, rank: b.score + SEARCH_TITLE_NUDGE * titleCover(words, meta.title) };
  });
  ranked.sort((x, y) => y.rank - x.rank || x.b.order - y.b.order);
  return ranked.slice(0, pages).map(({ page, b, meta }) => ({
    page,
    title: String(meta.title || "").slice(0, 200),
    wing: String(meta.wing || ""),
    doc_class: String(meta.doc_class || ""),
    snippet: snippetOf(b.chunk.text, words),
  }));
}
