/**
 * THE E-WRESTLING MUSEUM — the R2 serving Worker.
 *
 * WHY THIS EXISTS: Cloudflare Pages caps a deploy at 20,000 files. The museum
 * is past 15,600 and grows by hundreds per accession wave. R2 has no file-count
 * ceiling, so the served tree moves into an R2 bucket and this Worker becomes
 * the front door: the same invite gate, the same pretty-URL routing, the same
 * `_headers` policy, the same 404 page. Nothing about the registry, the
 * generators, or the validators changes — they still write a plain file tree;
 * `scripts/r2-sync.mjs` mirrors that tree into the bucket incrementally.
 *
 * THE PARITY MANDATE: this Worker's job is to be indistinguishable from Pages
 * to a visitor. Every deliberate deviation from Pages is listed in
 * docs/OPERATIONS.md's R2 MIGRATION section and flagged `DEVIATION:` in the
 * comments below. There are four, all small, all documented.
 *
 * ORDER OF OPERATIONS (identical to Pages, which runs
 * functions/_middleware.js before its own asset router):
 *
 *   0. open door — GATE_ENABLED = false (the Janitor's D429, launch; hook
 *                  c115): every path is served without the cookie and step 1
 *                  is skipped. Set it true to put the gate back as it stood.
 *   1. gate      — signed-cookie check; no cookie => the gate page, full stop.
 *                  An unauthenticated request never learns whether a path
 *                  exists, never sees a redirect, never reaches the bucket.
 *   2. route     — pretty-URL resolution against the bucket (Pages'
 *                  `html_handling: "auto-trailing-slash"` model).
 *   3. serve     — R2 fetch with conditional/range support.
 *   4. headers   — content type, cache policy, then the baked `_headers` rules
 *                  (clacks lines, X-Robots-Tag, Cache-Control) on top.
 *
 * BINDINGS (see wrangler.toml):
 *   MUSEUM_BUCKET  R2 bucket holding the served tree (default `ewmuseum-site`)
 *   GATE_SECRET    secret — HMAC key for the gate cookie
 *   INVITE_CODES   secret — comma-separated invite codes
 *   MUSEUM_SEARCH  AI Search instance `museum-search` (D289/D294) — answers
 *                  GET /api/search behind the gate; search results only
 *   SEARCH_LIMITER       rate limit (wrangler.toml [[ratelimits]]): /api/search
 *                        per client address, 20 per 60 s
 *   SEARCH_LIMITER_SITE  rate limit: /api/search for everyone at one Cloudflare
 *                        location together, 300 per 60 s
 */

import HEADERS_MANIFEST from "./headers.json";
import { parseTextQuery, searchRequestBody, shapeResults, SEARCH_MAX_QUERY } from "./search.mjs";
import { FIND_PATH, findRecordApi } from "./find-record.mjs";

// ---------------------------------------------------------------------------
// Tunables. Each one is a documented choice, not an accident.
// ---------------------------------------------------------------------------

/**
 * The R2 key `scripts/r2-sync.mjs` writes its manifest to. It lives in the
 * same bucket as the site, so it is reachable at `/_manifest.json` unless the
 * router refuses — and it must refuse: the manifest is a full path listing of
 * a private archive. Anything in this set 404s as if it were not there.
 */
const RESERVED_KEYS = new Set(["_manifest.json"]);

/**
 * Apply the `_headers` rules to the gate page as well as to bucket content.
 *
 * DEVIATION (1/4), deliberate: Pages' own treatment of `_headers` for a
 * Function-generated response is not documented either way, so parity here is
 * unknowable rather than choosable. Applying them is the strictly safer half
 * of the ambiguity — the gate page picks up `X-Robots-Tag: noindex` (matching
 * the `<meta name="robots">` it already carries) and the clacks lines, while
 * its own `Cache-Control: no-store` still wins, because endpoint-set headers
 * are applied after the manifest. Set false for the other reading.
 */
const APPLY_HEADERS_TO_GATE = true;

/**
 * Add `Vary: Cookie` to content responses.
 *
 * Off by default because Pages does not send it and this file's mandate is
 * parity. It is nonetheless correct — every content response depends on the
 * gate cookie — and worth arming if a shared cache is ever put in front of
 * this Worker. Today nothing is: responses are `private` and Workers do not
 * populate the Cloudflare edge cache without an explicit cache API call.
 */
const ADD_VARY_COOKIE = false;

/**
 * Serve dot-prefixed keys.
 *
 * DEVIATION (2/4), deliberate: `scripts/r2-sync.mjs` does not upload dotfiles,
 * so this is belt-and-braces rather than the actual mechanism. The one file it
 * changes versus Pages today is `/.allowed_signers` (the SSH allowed-signers
 * list for commit verification), which Pages serves and this does not. See the
 * serving-scope note in docs/OPERATIONS.md.
 */
const SERVE_DOTFILES = false;

/**
 * THE PUBLIC UPCOMING-SHOWS FEED (the Janitor, desk D408, 2026-10-07: "(b) a public feed on the ungated path"; GAVELS
 * 2026-10-06, D406-D410; hook c100). The living pulse's calendar of living feds' upcoming shows, published OUTSIDE the invite
 * gate beside /crawler: fed name, show title, date and the fed's own link, nothing of a fed's content. Exactly this one path is
 * ungated (GET/HEAD; see the entry point); its key is written by the standing fixer scripts/fixers/sync-living-pulse-feed.py.
 */
const PUBLIC_FEED = "/crawler/upcoming.ics";
const PUBLIC_FEED_KEY = "crawler/upcoming.ics";

/**
 * THE INVITE GATE SWITCH (hook c115, launch day). The Janitor, desk D429, 2026-10-07, verbatim: "repos too, index from day
 * one"; "Indexing from day one is fine for Google and Bing: it will help people find the museum which will ideally lead to
 * donations and community involvement. But the indexing should explicitly deny AI model training usage."
 *
 *   false — the museum is open: every path is served without the cookie (openDoor, below); a POST to /gate (an old tab, a
 *           back-button resubmit) is sent to "/"; anything but GET/HEAD is still 405; /api/search is still rate-limited
 *           (searchApi). The crawler policy is robots.txt plus the `_headers` robots block, both stamped by
 *           scripts/stamp-public.mjs (data/site-config.json "indexable": true).
 *   true  — the invite gate exactly as it stood before launch: the code below (the cookie, the gate page, the two ungated
 *           paths) is kept whole and unused while this is false, so re-gating is this one line and a Worker deploy.
 */
const GATE_ENABLED = false;

/**
 * THE ACCESSIONS FEED (hook c221; the Janitor, chat, 2026-10-09: "we should set up an RSS feed for the accession updates";
 * where it is served is the Janitor's desk D497). feed.xml (R2 key feed.xml), written by scripts/build-accessions-feed.mjs at
 * every build: the newest 50 accessions as RSS 2.0, every word already served on /collections/. ONE switch, the Worker
 * secret FEED_MODE (a secret, so no deploy ever drops it and its value is in no file):
 *   unset, or anything else  OFF: /feed.xml is served to admitted readers only, like every page.
 *   "public"                 GET/HEAD of exactly /feed.xml is served without the cookie.
 *   "private"                GET/HEAD of exactly /feed/<FEED_TOKEN>.xml is served without the cookie. FEED_TOKEN is a
 *                            second Worker secret, 24 to 256 characters of A-Z a-z 0-9 _ -, never written in the
 *                            repository; a missing or malformed token keeps the private path shut. The copy served there
 *                            names its own address as its atom self link, so a reader that follows it stays on that address.
 * Nothing else is opened: every other path under /feed/ and every other method meets the gate. An absent object answers the
 * gate page, never the site's 404 page.
 */
const ACCESSIONS_FEED = "/feed.xml";
const ACCESSIONS_FEED_KEY = "feed.xml";
const FEED_TOKEN_RE = /^[A-Za-z0-9_-]{24,256}$/;
const FEED_PRIVATE_RE = /^\/feed\/([A-Za-z0-9_-]{24,256})\.xml$/;
const FEED_SELF = 'href="https://ewmuseum.org/feed.xml" rel="self"';
const FEED_MAX_AGE = "max-age=1800";

// ---------------------------------------------------------------------------
// THE GATE — ported from functions/_middleware.js.
//
// Everything from here to the END OF GATE marker is the Pages middleware
// verbatim: same cookie name, same token format, same HMAC scheme, same
// INVITE_CODES semantics, same inlined gate page, same status codes. A cookie
// minted by Pages before cutover verifies here unchanged, and a cookie minted
// here verifies under Pages if the Janitor rolls back — the token is
// `<expiry>.<hmac(expiry)>` signed with GATE_SECRET and nothing else, so the
// two implementations are interchangeable as long as GATE_SECRET is.
//
// The ONLY edit is the admitted branch: Pages' `return next()` (hand off to
// the Pages asset router) becomes `return serve(...)` (hand off to R2).
// ---------------------------------------------------------------------------

const COOKIE = "museum_gate";
const YEAR_S = 31536000;

function normalize(v) {
  return String(v ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

function readCookie(header, name) {
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return "";
}

// Token: "<expiry>.<hmac(expiry)>" — stateless, self-expiring.
async function mintToken(secret) {
  const exp = String(Math.floor(Date.now() / 1000) + YEAR_S);
  return `${exp}.${await hmacHex(exp, secret)}`;
}

async function verifyToken(token, secret) {
  if (!secret) return false;
  const [exp, mac] = token.split(".");
  if (!exp || !mac) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacHex(exp, secret);
  // Length-safe, constant-time-ish comparison; timing isn't a realistic concern
  // for this gate, but the discipline is one line either way.
  if (mac.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function gatePage(error) {
  // hook c195 (finding A12 of the 2026-10-09 adversarial review, the Janitor's D466): the wrong-code message is an
  // identified, announced region, and the code box below points at it with aria-describedby ONLY when there is one to
  // point at -- an aria-describedby naming an absent id describes nothing. The message's own words are not this hook's.
  const err = error
    ? `<p id="gate-error" role="alert" style="color:#b5623a;font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:13px;margin:14px 0 0">${error}</p>`
    : "";
  const errRef = error ? ' aria-describedby="gate-error"' : "";
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>THE E-WRESTLING MUSEUM</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(120% 60% at 50% -10%,#221c12 0%,#141210 60%);color:#e9e2d4;font-family:Georgia,'Palatino Linotype',serif">
<form method="POST" action="/gate" style="text-align:center;padding:32px;max-width:440px">
<div style="font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:15px;letter-spacing:.34em;text-transform:uppercase;color:#e9e2d4">THE E-WRESTLING MUSEUM<span style="color:#c8a24b">.</span></div>
<p style="color:#938a7b;font-size:11px;font-family:'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;margin:10px 0 22px">By appointment only</p>
<p style="color:#c3b9a6;font-size:15px;line-height:1.6;margin:0 0 6px">A private preview of the e-wrestling museum: fantasy wrestling from 1985 to today.<br>Opening to everyone on Monday, October 12, at noon Pacific.<br>If you were invited, you have the word.</p>
${err}
<label for="gate-code" style="position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0">The word you were given</label>
<input id="gate-code" name="code" autofocus placeholder="the word" autocomplete="off"${errRef}
 style="width:100%;box-sizing:border-box;margin-top:22px;background:#1b1815;border:1px solid #453d31;border-radius:4px;color:#e9e2d4;padding:13px;font-size:15px;text-align:center;letter-spacing:.06em;font-family:'IBM Plex Mono',ui-monospace,monospace">
<button style="margin-top:12px;width:100%;padding:13px;background:#c8a24b;color:#141210;border:none;border-radius:4px;font-family:'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;font-size:13px;cursor:pointer">Sign the book</button>
<p style="margin-top:34px;color:#938a7b;font-size:11px;font-family:'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.14em;line-height:1.9">in memory of<br><span style="color:#c8a24b">SEAN SIMON WILLIAMS</span> &middot; 1985&ndash;2018<br><span style="color:#c8a24b">JAYMES FAULKNER</span> &middot; 1972&ndash;2022</p>
</form></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

// --- END OF GATE (verbatim from functions/_middleware.js) -------------------

// ---------------------------------------------------------------------------
// CONTENT TYPES
//
// r2-sync stamps Content-Type on upload too, but the Worker deciding from the
// extension is what makes the bucket re-seedable by any means (rclone, the S3
// API, the dashboard) without the site's types silently going wrong.
// ---------------------------------------------------------------------------

const TYPES = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  // Observed-Pages parity (probe-diff, 2026-08-26): Pages serves these two
  // classes with BARE types, no charset parameter. Cosmetic, but parity is
  // the contract.
  js: "application/javascript",
  mjs: "application/javascript",
  json: "application/json",
  map: "application/json",
  xml: "application/xml; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  yml: "text/yaml; charset=utf-8",
  yaml: "text/yaml; charset=utf-8",
  svg: "image/svg+xml",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
  zip: "application/zip",
  gz: "application/gzip",
  ics: "text/calendar; charset=utf-8", // the public upcoming-shows feed (D408, hook c100)
};

function extOf(key) {
  const base = key.slice(key.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

function contentTypeFor(key) {
  return TYPES[extOf(key)] || "application/octet-stream";
}

// ---------------------------------------------------------------------------
// CACHE POLICY — defaults only; `_headers` gets the last word.
//
// Today `_headers` carries a single `/*` rule setting `Cache-Control: no-cache`
// for everything, with its own written rationale ("the museum updates in place;
// a stale script against fresh data renders blank pages"). That rule wins over
// every default below, so the live cache behavior after cutover is byte-for-byte
// what it is now. These defaults exist for the day the Janitor narrows that
// `/*` rule — at which point the site still has a sane per-class policy instead
// of falling off a cliff into no policy at all.
//
// Everything is `private`. The entire site is behind an invite cookie; no
// shared or intermediary cache should ever hold a museum body. That is a
// property of the gate, not of any one file's freshness needs, so it applies to
// the long-lived classes too.
//
//   html, json  no-cache      — the instrument pages and the data they read
//                               must move together; revalidation (cheap, ETag
//                               304s) is the durable fix, per _headers' own note
//   css, js     1 hour        — versioned via ?v=N query strings already, so a
//                               real change gets a new URL; the hour is for the
//                               unversioned stragglers (redirect stubs) that
//                               docs/OPERATIONS.md's cache section warns about
//   images/fonts  1 day       — content-addressed in practice; nothing rewrites
//                               a photograph in place
//   everything else  no-cache — the conservative default for anything new
// ---------------------------------------------------------------------------

function defaultCacheControl(key) {
  const ext = extOf(key);
  if (ext === "css" || ext === "js" || ext === "mjs") return "private, max-age=3600, must-revalidate";
  if (["jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "ico", "woff", "woff2", "ttf", "otf"].includes(ext)) {
    return "private, max-age=86400";
  }
  return "private, no-cache";
}

// ---------------------------------------------------------------------------
// _headers — applied from the build-time bake (worker/headers.json).
//
// Shape produced by scripts/build-worker-headers.mjs:
//   { rules: [ { path, set: [[name, value], ...], unset: [name, ...] }, ... ] }
//
// `set` preserves duplicates in file order, which is the whole point: the six
// `X-Clacks-Overhead: GNU <name>` lines must arrive as six separate header
// lines, one per memorial, exactly as scripts/stamp-stats.mjs stamps them.
// Within one rule the first occurrence of a name replaces and the rest append;
// across rules a later rule replaces an earlier one's value for that name,
// which is Cloudflare's own last-match-wins ordering.
// ---------------------------------------------------------------------------

function segmentsOf(path) {
  return path.split("/").filter(Boolean);
}

/** Cloudflare `_headers` path matching: exact, `:placeholder`, trailing `*`. */
function ruleMatches(pattern, pathname) {
  const pat = segmentsOf(pattern);
  const got = segmentsOf(pathname);
  for (let i = 0; i < pat.length; i++) {
    const p = pat[i];
    if (p === "*") return true; // splat swallows the rest, including nothing
    if (i >= got.length) return false;
    if (p.startsWith(":")) continue; // placeholder: matches any one segment
    if (p !== got[i]) return false;
  }
  return pat.length === got.length;
}

function applyManifestHeaders(headers, pathname) {
  for (const rule of HEADERS_MANIFEST.rules || []) {
    if (!ruleMatches(rule.path, pathname)) continue;
    for (const name of rule.unset || []) headers.delete(name);
    const seen = new Set();
    for (const [name, value] of rule.set || []) {
      const lower = name.toLowerCase();
      if (seen.has(lower)) headers.append(name, value);
      else {
        headers.set(name, value);
        seen.add(lower);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// ROUTING — Cloudflare Pages' `html_handling: "auto-trailing-slash"` model,
// reimplemented against R2 keys.
//
// The rules, in the order they are tried:
//
//   /foo/index.html  -> 308 /foo/          (canonicalize away the index)
//   /index.html      -> 308 /
//   /foo.html        -> 308 /foo           (canonicalize away the extension)
//   /                -> index.html
//   /foo             -> foo.html, else foo/index.html via 308 /foo/
//   /foo/            -> foo/index.html, else foo.html via 308 /foo
//   anything else    -> 404.html at status 404
//
// The `.html` -> pretty 308 matters more here than it looks: 14,715 links in
// the served tree are written `href="/shows.html"` and 14,693 `href="/rps.html"`,
// so nearly every internal click already spends one 308 on Pages today. Getting
// this rule wrong in either direction (dropping the redirect, or redirecting the
// other way) would either change every URL in the address bar or, worse, loop.
// The parity test covers both directions plus the query-string carry.
//
// WHY THE `.html`-BEFORE-DIRECTORY ORDER IS LOAD-BEARING: two stems in this
// tree exist as BOTH a file and a directory with an index —
//   rps.html   + rps/index.html    ("Roleplays" vs "Roleplays by year")
//   shows.html + shows/index.html  ("Shows"     vs "Shows by year")
// and they are different pages with different content, both linked. So `/rps`
// must be the flat instrument and `/rps/` must be the by-year index; a router
// that preferred the directory would silently serve the wrong page at a URL
// used thousands of times. docs/OPERATIONS.md's promotions.html note describes
// the same coexistence for `/promotions` vs `/promotions/<id>/`; this ordering
// is what makes that documented assumption true here.
// ---------------------------------------------------------------------------

function isServable(key) {
  if (!key || key.endsWith("/")) return false;
  if (RESERVED_KEYS.has(key)) return false;
  if (key.includes("..")) return false;
  if (!SERVE_DOTFILES && key.split("/").some((s) => s.startsWith("."))) return false;
  return true;
}

async function exists(bucket, key) {
  if (!isServable(key)) return false;
  return (await bucket.head(key)) !== null;
}

/**
 * Resolve a request path against the bucket.
 * @returns {{kind:"serve",key:string}|{kind:"redirect",to:string}|{kind:"notfound"}}
 */
async function resolvePath(bucket, pathname) {
  // Collapse repeated slashes the way Pages does, and redirect if it changed
  // so the address bar shows the canonical form.
  const collapsed = pathname.replace(/\/{2,}/g, "/");
  if (collapsed !== pathname) return { kind: "redirect", to: collapsed };

  // 1. Canonicalize `/index.html` and `/foo/index.html` away.
  if (pathname === "/index.html") return { kind: "redirect", to: "/" };
  if (pathname.endsWith("/index.html")) {
    return { kind: "redirect", to: pathname.slice(0, -"index.html".length) };
  }

  // 2. Canonicalize `/foo.html` -> `/foo`.
  if (pathname.endsWith(".html") && pathname.length > ".html".length) {
    return { kind: "redirect", to: pathname.slice(0, -".html".length) };
  }

  // 3. The root.
  if (pathname === "/") {
    if (await exists(bucket, "index.html")) return { kind: "serve", key: "index.html" };
    return { kind: "notfound" };
  }

  const bare = pathname.slice(1); // no leading slash; R2 keys have none

  if (pathname.endsWith("/")) {
    // 4a. `/foo/` -> foo/index.html, else fall back to foo.html via 308 /foo.
    const idx = bare + "index.html";
    if (await exists(bucket, idx)) return { kind: "serve", key: idx };
    const stem = bare.slice(0, -1);
    if (await exists(bucket, stem + ".html")) {
      return { kind: "redirect", to: pathname.slice(0, -1) };
    }
    return { kind: "notfound" };
  }

  // 4b. `/foo` -> an exact object first (style.css, data/*.json, images),
  //     then foo.html, then foo/index.html via 308 /foo/.
  if (await exists(bucket, bare)) return { kind: "serve", key: bare };
  if (await exists(bucket, bare + ".html")) return { kind: "serve", key: bare + ".html" };
  if (await exists(bucket, bare + "/index.html")) return { kind: "redirect", to: pathname + "/" };
  return { kind: "notfound" };
}

// ---------------------------------------------------------------------------
// SERVING
// ---------------------------------------------------------------------------

/**
 * Assemble a response's headers in the one order that gets the precedence right:
 *
 *   1. class defaults from the key's extension (Content-Type, Cache-Control)
 *   2. `pre` — endpoint defaults for responses with no R2 key behind them
 *      (a redirect, the minimal 404, the gate page's content type)
 *   3. the baked `_headers` rules — which OVERRIDE both, because `_headers` is
 *      the site's own stated policy and a default must never beat it. This is
 *      what makes `/*  Cache-Control: no-cache` actually reach the wire on
 *      every response class, redirects and 404s included, exactly as Pages
 *      applies it today.
 *   4. `post` — the few headers that are properties of the endpoint itself
 *      rather than cache-tuning preferences, and so outrank even `_headers`.
 *      Today that is exactly one thing: the gate page's `no-store`. A gate
 *      page that a browser is allowed to reuse from cache is a gate page shown
 *      to someone who has since been let in — or worse, kept from someone who
 *      has since been shut out.
 */
function finishHeaders(headers, pathname, key, pre = {}, post = {}) {
  if (key) {
    headers.set("Content-Type", contentTypeFor(key));
    headers.set("Cache-Control", defaultCacheControl(key));
  }
  for (const [name, value] of Object.entries(pre)) headers.set(name, value);
  applyManifestHeaders(headers, pathname);
  // 3.5 THE OBSERVED-PAGES PARITY OVERRIDE (probe-diff against live Pages,
  // 2026-08-26). The design comment above assumed Pages applies the baked
  // `/* no-cache` to every response class. The probe proved it does not:
  // live Pages serves static assets (css/js/images/fonts) with
  // `max-age=14400` regardless of `_headers`, keeps `no-cache` on HTML/JSON,
  // and stamps `no-store` on gate/404 responses. Cutover safety means
  // mirroring what the live site actually does today, not what `_headers`
  // intended — so asset classes get the observed value here, AFTER the baked
  // rules. Narrowing this back to `_headers` intent is a post-cutover call.
  if (key) {
    const ext = extOf(key);
    if (["css", "js", "mjs", "jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "ico", "woff", "woff2", "ttf", "otf"].includes(ext)) {
      headers.set("Cache-Control", "max-age=14400");
    }
  }
  if (ADD_VARY_COOKIE) headers.set("Vary", "Cookie");
  // The public feed (D408, hook c100) is the one object any cache may hold: it carries no cookie-dependent body. An hour keeps
  // calendar clients polite; the feed itself changes at most once a day (preflight).
  if (key === PUBLIC_FEED_KEY) headers.set("Cache-Control", "public, max-age=3600");
  for (const [name, value] of Object.entries(post)) headers.set(name, value);
  return headers;
}

function redirectResponse(request, to) {
  const url = new URL(request.url);
  // `to` is computed from the DECODED path (so key lookups work); re-encode it
  // before it becomes a Location, or a path with a space or an accent would be
  // handed back to the browser in a form it has to guess at.
  const location = encodeURI(to) + url.search;
  const headers = new Headers({ Location: location });
  // Observed-Pages parity (probe-diff, 2026-08-26): Pages sends NO
  // Content-Type on its 308s; the body below is a courtesy anchor only.
  finishHeaders(headers, url.pathname, null, {
    "Cache-Control": "private, no-cache",
  });
  headers.delete("Content-Type");
  // 308, not 301/302: the method and body must be preserved, and Pages uses
  // 308 for exactly this canonicalization. NULL body on purpose (probe-diff,
  // 2026-08-26): live Pages sends bodiless 308s with no Content-Type, and the
  // runtime auto-stamps text/plain onto any string-bodied response that lacks
  // one — the only way to send no Content-Type is to send no body.
  return new Response(null, { status: 308, headers });
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const MINIMAL_404 = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Not found &mdash; THE E-WRESTLING MUSEUM</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#141210;color:#e9e2d4;font-family:Georgia,'Palatino Linotype',serif">
<div style="text-align:center;padding:32px"><div style="font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:13px;letter-spacing:.3em;text-transform:uppercase">THE E-WRESTLING MUSEUM<span style="color:#c8a24b">.</span></div>
<p style="color:#c3b9a6;font-size:15px;margin-top:18px">No such room in this wing.</p>
<p style="margin-top:8px"><a href="/" style="color:#c8a24b">Back to the lobby</a></p></div></body></html>`;

/** The site's own 404.html if the bucket has one; a minimal page if it does not. */
async function notFound(bucket, request, pathname, isHead) {
  const obj = await bucket.get("404.html");
  if (obj) {
    const headers = new Headers();
    // Observed-Pages parity (probe-diff, 2026-08-26): Pages stamps
    // `no-store` on its 404 responses; mirrored via post so it outranks
    // the baked `/*` rule, same as the gate page's own no-store.
    finishHeaders(headers, pathname, "404.html", {}, { "Cache-Control": "no-store" });
    headers.set("Content-Length", String(obj.size));
    return new Response(isHead ? null : obj.body, { status: 404, headers });
  }
  const headers = new Headers();
  finishHeaders(headers, pathname, null, {
    "Content-Type": "text/html; charset=utf-8",
  }, { "Cache-Control": "no-store" });
  return new Response(isHead ? null : MINIMAL_404, { status: 404, headers });
}

/**
 * Fetch a key from R2 and shape the response.
 *
 * Conditional requests are handed straight to R2 via `onlyIf`, which is what
 * makes `_headers`' `Cache-Control: no-cache` cheap rather than expensive: the
 * browser revalidates on every view, and a revalidation that matches costs one
 * 304 with no body. `_headers`' own comment names this ("ETag 304s keep it
 * fast") as the reason the museum can update in place; without it the no-cache
 * policy would mean re-downloading every page on every visit.
 */
async function serveKey(bucket, request, pathname, key) {
  const isHead = request.method === "HEAD";
  const rangeRequested = request.headers.has("Range");

  if (isHead) {
    const obj = await bucket.head(key);
    if (!obj) return notFound(bucket, request, pathname, true);
    const headers = new Headers();
    finishHeaders(headers, pathname, key);
    headers.set("ETag", obj.httpEtag);
    headers.set("Content-Length", String(obj.size));
    headers.set("Accept-Ranges", "bytes");
    if (obj.uploaded) headers.set("Last-Modified", new Date(obj.uploaded).toUTCString());
    return new Response(null, { status: 200, headers });
  }

  const obj = await bucket.get(key, {
    onlyIf: request.headers,
    range: rangeRequested ? request.headers : undefined,
  });
  if (obj === null) return notFound(bucket, request, pathname, false);

  const headers = new Headers();
  finishHeaders(headers, pathname, key);
  headers.set("ETag", obj.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  if (obj.uploaded) headers.set("Last-Modified", new Date(obj.uploaded).toUTCString());

  // No body means R2 evaluated `onlyIf` and the precondition short-circuited.
  // Which status depends on which precondition the client sent.
  if (!("body" in obj) || obj.body == null) {
    const negative = request.headers.has("If-None-Match") || request.headers.has("If-Modified-Since");
    if (negative) return new Response(null, { status: 304, headers });
    return new Response(null, { status: 412, headers });
  }

  if (rangeRequested && obj.range && "offset" in obj.range) {
    const offset = obj.range.offset ?? 0;
    const length = obj.range.length ?? obj.size - offset;
    const end = offset + length - 1;
    if (length < obj.size) {
      headers.set("Content-Range", `bytes ${offset}-${end}/${obj.size}`);
      headers.set("Content-Length", String(length));
      return new Response(obj.body, { status: 206, headers });
    }
  }

  headers.set("Content-Length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

async function serve(request, env) {
  const url = new URL(request.url);
  const bucket = env.MUSEUM_BUCKET;

  if (!bucket) {
    return new Response("MUSEUM_BUCKET binding is missing — check wrangler.toml.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    pathname = url.pathname; // malformed percent-encoding: use it raw, then 404
  }

  const result = await resolvePath(bucket, pathname);
  if (result.kind === "redirect") return redirectResponse(request, result.to);
  if (result.kind === "notfound") return notFound(bucket, request, pathname, request.method === "HEAD");
  return serveKey(bucket, request, pathname, result.key);
}

// ---------------------------------------------------------------------------
// TEXT SEARCH — GET /api/search?q=...  (D289 "search results only", D294)
//
// Reached ONLY after the gate has admitted the request (see the entry point):
// an unadmitted request for /api/search gets the gate page like any other path.
// It asks the AI Search instance `museum-search` (binding MUSEUM_SEARCH) for
// matching chunks — retrieval only: no generation, no rerank, no query rewrite,
// whatever the instance's defaults say; keyword retrieval, pages ranked by their
// best chunk plus a small title nudge (search.mjs, hook c120, D435) — and answers JSON:
//
//   { q, results: [ { page, title, wing, doc_class, snippet } ], ignored: [...] }
//
// TAKEDOWNS AND WITHDRAWALS. The index holds only served document pages and the
// deploy step (scripts/ops/ai-search-sync.py) deletes an item when its page
// leaves the bucket. Belt and braces, every result is checked against the
// bucket here before it is shown: a page that is no longer served is dropped at
// once, whatever the index says.
//
// The query language. The registry search (search.html, js/query.js) and this
// are different things: the registry's `field:value` tokens filter registry
// rows. Here two of them carry over as filters on the indexed page's own
// metadata — `wing:<id>` (alias `promotion:`) and `class:<doc_class>` (alias
// `doc_class:`); every other `field:value` token is ignored and named back in
// `ignored`, so the page can say it belongs to the registry search.
// ---------------------------------------------------------------------------

const SEARCH_PATH = "/api/search";
const SEARCH_DEFAULT_PAGES = 10;  // pages per answer
const SEARCH_MAX_PAGES = 20;      // the most one answer may ask for (?n=)

// THE COST CAPS AND THE RATE LIMIT (hook c85, re-cut 2026-10-07). Once the
// invite gate comes down (hook c115) /api/search answers anyone, and every
// backend call costs money. So, per request: at most ONE backend call (the
// REST fallback runs only when the binding itself fails), for at most 50
// chunks, with no generation, no rerank and no query rewrite (the one request
// body, search.mjs; D289 (b)); a query longer than SEARCH_MAX_QUERY characters
// is refused (400) before any call; a query under two letters costs no call;
// at most SEARCH_MAX_PAGES + 5 bucket HEADs. Per client: SEARCH_LIMITER allows
// 20 requests in 60 s, keyed on the client's address (CF-Connecting-IP; an IPv6
// address by its /64, the block one subscriber is handed). Per Cloudflare
// location: SEARCH_LIMITER_SITE allows 300 in 60 s on one shared key, the
// ceiling a crowd of addresses cannot pass. Over either: 429 {error:"slow down"}
// with Retry-After and no-store. Every /api/search request counts, the refused
// ones too. A Worker deployed without the two limiter bindings answers 503:
// the search is never unmetered.
const SEARCH_RETRY_AFTER_S = 60;  // the limiter's window (wrangler.toml: period = 60)

/**
 * The backend call: the binding if bound; the REST API (two secrets, never in a
 * file) if the binding is absent or throws and the secrets are set.
 */
async function searchBackend(env, body) {
  const rest = Boolean(env.AI_SEARCH_TOKEN && env.AI_SEARCH_ACCOUNT);
  if (env.MUSEUM_SEARCH && typeof env.MUSEUM_SEARCH.search === "function") {
    try {
      return await env.MUSEUM_SEARCH.search(body);
    } catch (e) {
      if (!rest) throw e;
      console.error("search binding failed; trying REST:", String((e && e.message) || e).slice(0, 200));
    }
  }
  if (rest) {
    const r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.AI_SEARCH_ACCOUNT}/ai-search/namespaces/default/instances/museum-search/search`,
      { method: "POST", headers: { Authorization: `Bearer ${env.AI_SEARCH_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    if (!r.ok) throw new Error(`search backend HTTP ${r.status}`);
    const j = await r.json();
    return j.result;
  }
  throw new Error("no search backend bound");
}

function jsonResponse(pathname, status, obj, extra = {}) {
  const headers = new Headers();
  finishHeaders(headers, pathname, null, {}, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    ...extra,
  });
  return new Response(JSON.stringify(obj), { status, headers });
}

/** The limiter key: the client's address; an IPv6 address by its /64. */
function searchClientKey(request) {
  const ip = String(request.headers.get("CF-Connecting-IP") || "").trim().toLowerCase();
  if (!ip) return "ip:unknown";
  if (!ip.includes(":")) return "ip4:" + ip;
  const v4 = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip); // an IPv4-mapped IPv6 address
  if (v4) return "ip4:" + v4[1];
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = ip.includes("::") ? [...h, ...new Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return "ip6:" + full.slice(0, 4).map((x) => (parseInt(x, 16) || 0).toString(16)).join(":") + "::/64";
}

/** true = within both limits; false = over one; null = the limiter bindings are missing (refuse: never unmetered). */
async function searchRateOk(request, env) {
  const per = env.SEARCH_LIMITER;
  const site = env.SEARCH_LIMITER_SITE;
  if (!per || typeof per.limit !== "function" || !site || typeof site.limit !== "function") return null;
  const mine = await per.limit({ key: searchClientKey(request) });
  if (!mine || !mine.success) return false;
  const all = await site.limit({ key: "site" });
  return Boolean(all && all.success);
}

async function searchApi(request, env, url) {
  let rate;
  try {
    rate = await searchRateOk(request, env);
  } catch (e) {
    console.error("search limiter failed:", String((e && e.message) || e).slice(0, 200));
    rate = null;
  }
  if (rate === null) return jsonResponse(url.pathname, 503, { results: [], error: "unavailable" });
  if (!rate) {
    return jsonResponse(url.pathname, 429, { results: [], error: "slow down" }, { "Retry-After": String(SEARCH_RETRY_AFTER_S) });
  }
  const raw = String(url.searchParams.get("q") ?? "").replace(/\s+/g, " ").trim();
  if (raw.length > SEARCH_MAX_QUERY) {
    return jsonResponse(url.pathname, 400, { results: [], error: "query too long", max: SEARCH_MAX_QUERY });
  }
  const parsed = parseTextQuery(raw);
  const n = Math.max(1, Math.min(SEARCH_MAX_PAGES, Number(url.searchParams.get("n")) || SEARCH_DEFAULT_PAGES));
  if (parsed.text.replace(/["\s]/g, "").length < 2) {
    return jsonResponse(url.pathname, 200, { q: parsed.text, results: [], ignored: parsed.ignored });
  }
  let result;
  const t0 = Date.now();
  try {
    result = await searchBackend(env, searchRequestBody(parsed, n));
  } catch (e) {
    // Never echo the backend's own words back to the browser.
    console.error("search backend failed:", String((e && e.message) || e).slice(0, 200));
    return jsonResponse(url.pathname, 502, { q: parsed.text, results: [], ignored: parsed.ignored, error: "unavailable" });
  }
  // a few spare rows, so a dropped page does not shorten the answer
  const rows = shapeResults(result, parsed, n + 5);
  // Served-now check: a page withdrawn or taken down since it was indexed is
  // gone from the bucket, so it is dropped here before anyone sees it.
  // All the HEADs run at once (one round trip, not n + 5); a HEAD that fails drops its row, never shows it.
  const t1 = Date.now();
  const bucket = env.MUSEUM_BUCKET;
  const live = await Promise.all(rows.map((r) => bucket.head(r.page.slice(1)).then((o) => o !== null, () => false)));
  // Where the time went (hook c120, D435): the backend call and the served-now check, in ms, for the browser's
  // network panel and for a timed curl. Durations only: no query, no key, no backend words.
  const timing = `backend;dur=${t1 - t0}, check;dur=${Date.now() - t1}`;
  return jsonResponse(url.pathname, 200, { q: parsed.text, results: rows.filter((_, i) => live[i]).slice(0, n), ignored: parsed.ignored }, { "Server-Timing": timing });
}

// ---------------------------------------------------------------------------
// THE ACCESSIONS FEED (hook c221; desk D497): see ACCESSIONS_FEED in the tunables.
// ---------------------------------------------------------------------------

/** "public" | "private" | null (off). Only the two exact words open anything. */
function feedMode(env) {
  const m = String(env.FEED_MODE ?? "").trim().toLowerCase();
  return m === "public" || m === "private" ? m : null;
}

/** Equal length, every character compared (the gate's own discipline, verifyToken above). */
function sameToken(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The feed served without the cookie, or null when this request is not the path FEED_MODE opens (the caller then gates it
 * like any other path). GET/HEAD only; the caller checks the method.
 */
async function ungatedFeed(request, env, url) {
  const mode = feedMode(env);
  if (!mode) return null;
  const bucket = env.MUSEUM_BUCKET;
  if (mode === "public") {
    if (url.pathname !== ACCESSIONS_FEED) return null;
    if (!bucket) return decorateGate(gatePage(null), url.pathname);
    const res = await serveKey(bucket, request, ACCESSIONS_FEED, ACCESSIONS_FEED_KEY);
    if (res.status === 404) return decorateGate(gatePage(null), url.pathname);
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", "public, " + FEED_MAX_AGE);
    return new Response(res.body, { status: res.status, headers });
  }
  const m = FEED_PRIVATE_RE.exec(url.pathname);
  const token = String(env.FEED_TOKEN ?? "");
  if (!m || !FEED_TOKEN_RE.test(token) || !sameToken(m[1], token)) return null;
  // The private copy: its self link names this address. Its pathname is never handed to the _headers matcher or a log line.
  const obj = bucket ? await bucket.get(ACCESSIONS_FEED_KEY) : null;
  if (!obj) return decorateGate(gatePage(null), ACCESSIONS_FEED);
  const headers = new Headers();
  finishHeaders(headers, ACCESSIONS_FEED, ACCESSIONS_FEED_KEY, {}, {
    "Cache-Control": "private, " + FEED_MAX_AGE,
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
  });
  if (obj.uploaded) {
    headers.set("Last-Modified", new Date(obj.uploaded).toUTCString());
    const since = Date.parse(request.headers.get("If-Modified-Since") || "");
    if (!Number.isNaN(since) && Math.floor(new Date(obj.uploaded).getTime() / 1000) <= Math.floor(since / 1000)) {
      return new Response(null, { status: 304, headers });
    }
  }
  const body = new TextEncoder().encode(
    (await obj.text()).replace(FEED_SELF, () => `href="${escapeAttr(url.origin + url.pathname)}" rel="self"`),
  );
  headers.set("Content-Length", String(body.length));
  return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
}

// ---------------------------------------------------------------------------
// THE OPEN DOOR (hook c115; GATE_ENABLED = false) — the museum without the
// invite gate. Same serving, same headers, same 405 for anything but a read;
// the search keeps its rate limit and its cost caps (searchApi).
// ---------------------------------------------------------------------------

async function openDoor(request, env, url) {
  // The old gate form, posted from a tab opened before launch: go inside.
  if (request.method === "POST" && url.pathname === "/gate") {
    return new Response(null, { status: 303, headers: { Location: "/", "Cache-Control": "no-store" } });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed.", {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  if (url.pathname === SEARCH_PATH) {
    if (!env.MUSEUM_BUCKET) return serve(request, env); // the missing-binding 500
    return searchApi(request, env, url);
  }
  return serve(request, env);
}

// ---------------------------------------------------------------------------
// ENTRY POINT — the gate first, exactly as functions/_middleware.js ran first
// under Pages (while GATE_ENABLED is true).
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // THE OPEN DOOR (the Janitor, D429; hook c115): no gate while GATE_ENABLED is false.
    if (!GATE_ENABLED) return openDoor(request, env, url);

    // --- gate, ported verbatim from functions/_middleware.js's onRequest ---

    // THE CRAWLER PAGE EXCEPTION (the Janitor's gavel, 2026-08-26, CURATION
    // v98): /crawler is the ONE ungated path — the public documentation the
    // EWMuseumBot user-agent's +URL points at, so any site operator who sees
    // the museum's crawler in their logs can read what it is and how to block
    // it WITHOUT holding an invite. Everything else stays behind the gate.
    if ((request.method === "GET" || request.method === "HEAD") &&
        (url.pathname === "/crawler" || url.pathname === "/crawler.html")) {
      return serve(request, env);
    }

    // THE PUBLIC FEED EXCEPTION (the Janitor, desk D408, 2026-10-07; hook c100): GET/HEAD of exactly /crawler/upcoming.ics,
    // the living pulse's upcoming-shows calendar, is served without the cookie. No other path under /crawler is: the match is
    // exact (no trailing slash, no case fold, no percent form). If the object is absent the visitor gets the gate page, never
    // the site's 404 page (which carries the gated site's chrome).
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === PUBLIC_FEED) {
      const res = await serve(request, env);
      if (res.status !== 404) return res;
      return decorateGate(gatePage(null), url.pathname);
    }

    // THE ACCESSIONS FEED EXCEPTION (hook c221; desk D497): OFF unless the Worker secret FEED_MODE is "public" (exactly
    // /feed.xml) or "private" (exactly /feed/<FEED_TOKEN>.xml); see ACCESSIONS_FEED in the tunables. Anything else falls
    // through to the gate below, untouched.
    if (request.method === "GET" || request.method === "HEAD") {
      const feed = await ungatedFeed(request, env, url);
      if (feed) return feed;
    }

    // Already admitted? Carry on.
    const cookie = readCookie(request.headers.get("Cookie") || "", COOKIE);
    if (cookie && (await verifyToken(cookie, env.GATE_SECRET))) {
      // Already signed in and re-posting the gate form (a back-button
      // resubmit): send them inside rather than 405ing at them.
      if (request.method === "POST" && url.pathname === "/gate") {
        return new Response(null, { status: 303, headers: { Location: "/", "Cache-Control": "no-store" } });
      }
      // DEVIATION (3/4), deliberate: the site is static, so anything other than
      // a read is a mistake or a probe. Pages would have answered a POST to a
      // static path with the asset; this answers 405. Nothing in the served
      // tree issues a non-GET request to anything but /gate.
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed.", {
          status: 405,
          headers: {
            Allow: "GET, HEAD",
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }
      // The text search (D294): admitted readers only, so it sits here, after
      // the cookie check, and never above it.
      if (url.pathname === SEARCH_PATH) {
        if (!env.MUSEUM_BUCKET) return serve(request, env); // the missing-binding 500
        return searchApi(request, env, url);
      }
      // THE RECORD LOOKUP (the Janitor, D448; hook c136): GET /api/find-record, an exact-name lookup over data/find-record-index.json
      // in the bucket (worker/find-record.mjs); behind the same door as the search, with its own rate limit.
      if (url.pathname === FIND_PATH) {
        if (!env.MUSEUM_BUCKET) return serve(request, env); // the missing-binding 500
        return findRecordApi(request, env, url, { jsonResponse, searchClientKey, retryAfter: SEARCH_RETRY_AFTER_S });
      }
      return serve(request, env);
    }

    // Code submission.
    if (request.method === "POST" && url.pathname === "/gate") {
      let code = "";
      try {
        const form = await request.formData();
        code = normalize(form.get("code"));
      } catch {
        /* fall through to the error page */
      }
      const codes = (env.INVITE_CODES || "")
        .split(",")
        .map(normalize)
        .filter(Boolean);
      if (code && codes.includes(code)) {
        const token = await mintToken(env.GATE_SECRET);
        return new Response(null, {
          status: 303,
          headers: {
            Location: "/",
            "Set-Cookie": `${COOKIE}=${token}; Path=/; Max-Age=${YEAR_S}; HttpOnly; Secure; SameSite=Lax`,
          },
        });
      }
      return decorateGate(gatePage("That code isn't on the appointment book. Ask the curator."), url.pathname);
    }

    // Everything else: the closed door.
    return decorateGate(gatePage(null), url.pathname);
  },
};

/**
 * DEVIATION (4/4), deliberate — see APPLY_HEADERS_TO_GATE above. The gate
 * page's own Content-Type and `Cache-Control: no-store` are re-set last so the
 * manifest can add to the response but never weaken it.
 */
function decorateGate(response, pathname) {
  if (!APPLY_HEADERS_TO_GATE) return response;
  const headers = new Headers(response.headers);
  finishHeaders(
    headers,
    pathname,
    null,
    { "Content-Type": "text/html; charset=utf-8" },
    { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  );
  return new Response(response.body, { status: response.status, headers });
}
