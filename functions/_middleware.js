/**
 * THE E-WRESTLING MUSEUM site gate — Cloudflare Pages Functions middleware.
 *
 * The Museum is private: every request is checked for a signed cookie; without
 * one, visitors get the gate page and must enter an invite code. Codes live in
 * the INVITE_CODES env var (comma-separated, case- and whitespace-insensitive);
 * the cookie is an HMAC (Web Crypto, no deps) signed with GATE_SECRET, valid
 * for a year per browser.
 *
 * Threat model: keep strangers and crawlers out of a private memorial archive
 * of real people's youth. Not a vault — the material inside is history, not
 * money — but it is personal, and it is by appointment only.
 *
 * Rotate access: change INVITE_CODES to add/remove codes; change GATE_SECRET
 * to close the doors on EVERYONE at once (every cookie invalidates).
 *
 * Pattern adapted, deliberately and near-verbatim, from the game repo's proven
 * gate (wwv/functions/_middleware.js). Same crypto, Museum register.
 */

const COOKIE = "museum_gate";
const YEAR_S = 31536000;

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // THE ACCESSIONS FEED EXCEPTION (hook c221; desk D497): the switch worker/index.mjs carries (the Worker is the live front
  // door; this file is the Pages rollback). FEED_MODE "public" opens exactly /feed.xml, "private" exactly
  // /feed/<FEED_TOKEN>.xml; unset, nothing. Anything else falls through to the gate below, untouched.
  if (request.method === "GET" || request.method === "HEAD") {
    const feed = await ungatedFeed(request, env, url);
    if (feed) return feed;
  }

  // Already admitted? Carry on.
  const cookie = readCookie(request.headers.get("Cookie") || "", COOKIE);
  if (cookie && (await verifyToken(cookie, env.GATE_SECRET))) {
    return next();
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
    return gatePage("That code isn't on the appointment book. Ask the curator.");
  }

  // Everything else: the closed door.
  return gatePage(null);
}

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

// THE ACCESSIONS FEED (hook c221; desk D497): see worker/index.mjs, ACCESSIONS_FEED, for the switch and its two secrets.
const FEED_TOKEN_RE = /^[A-Za-z0-9_-]{24,256}$/;
const FEED_PRIVATE_RE = /^\/feed\/([A-Za-z0-9_-]{24,256})\.xml$/;
const FEED_SELF = 'href="https://ewmuseum.org/feed.xml" rel="self"';

function sameToken(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function ungatedFeed(request, env, url) {
  const mode = String(env.FEED_MODE ?? "").trim().toLowerCase();
  let isPrivate = false;
  if (mode === "public") {
    if (url.pathname !== "/feed.xml") return null;
  } else if (mode === "private") {
    const m = FEED_PRIVATE_RE.exec(url.pathname);
    const token = String(env.FEED_TOKEN ?? "");
    if (!m || !FEED_TOKEN_RE.test(token) || !sameToken(m[1], token)) return null;
    isPrivate = true;
  } else {
    return null;
  }
  const res = env.ASSETS ? await env.ASSETS.fetch(new Request(new URL("/feed.xml", url), { method: "GET" })) : null;
  if (!res || !res.ok) return gatePage(null);
  let body = await res.text();
  if (isPrivate) body = body.replace(FEED_SELF, () => `href="${url.origin}${url.pathname}" rel="self"`);
  const headers = { "content-type": "application/xml; charset=utf-8", "cache-control": (isPrivate ? "private" : "public") + ", max-age=1800" };
  if (isPrivate) Object.assign(headers, { "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" });
  return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
}
