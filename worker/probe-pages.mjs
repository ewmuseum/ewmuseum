#!/usr/bin/env node
/**
 * THE MUSEUM — probe a live host and print its routing behavior.
 *
 * THE GAP THIS CLOSES. `worker/test-parity.mjs` asserts the R2 Worker against
 * a model of Cloudflare Pages' routing: the documented default
 * (`html_handling: "auto-trailing-slash"`), plus what docs/OPERATIONS.md states
 * in its own words about `/promotions` vs `/promotions/<id>/`. That model is
 * documented, not observed — the live site is behind the invite gate, and the
 * session that wrote the Worker had no cookie and no Cloudflare credentials.
 *
 * This script is how the model gets checked against reality, by someone who
 * DOES have a cookie: the Janitor. Run it against the live Pages site, then run
 * it against the staging Worker, and diff the two outputs. Same table, same
 * order, same fields. If a line differs, that line is the parity bug — and the
 * fix belongs in resolvePath() in worker/index.mjs, not anywhere else.
 *
 * USAGE
 *
 *   # 1. Get your gate cookie. In the browser, on the live site, after signing
 *   #    in: DevTools -> Application -> Cookies -> copy the museum_gate value.
 *   export MUSEUM_GATE=<the cookie value>
 *
 *   # 2. Probe the live Pages site (what the museum does TODAY):
 *   node worker/probe-pages.mjs https://ewmuseum.org > /tmp/pages.txt
 *
 *   # 3. Probe the staging Worker (what it WOULD do after cutover):
 *   node worker/probe-pages.mjs https://ewmuseum-serve.<subdomain>.workers.dev > /tmp/worker.txt
 *
 *   # 4. The whole point:
 *   diff /tmp/pages.txt /tmp/worker.txt
 *
 * An empty diff is the green light for cutover. Anything else is a decision to
 * make before flipping the route, not after.
 *
 * FLAGS
 *   --cookie VALUE   the museum_gate value (or set MUSEUM_GATE in the env)
 *   --full           also print every response header, not just the ones that
 *                    are part of the parity contract
 *
 * It only ever issues GET and HEAD requests to paths that already exist in the
 * repo, and it never follows a redirect — the redirect IS the thing being
 * measured.
 */

const args = process.argv.slice(2);
const FULL = args.includes("--full");
const cookieFlag = args.indexOf("--cookie");
const COOKIE = cookieFlag !== -1 ? args[cookieFlag + 1] : process.env.MUSEUM_GATE || "";
const base = args.find((a) => /^https?:\/\//.test(a));

if (!base) {
  console.error("usage: node worker/probe-pages.mjs <https://host> [--cookie VALUE] [--full]\n(or set MUSEUM_GATE in the environment)");
  process.exit(2);
}
if (!COOKIE) {
  console.error("probe: no gate cookie. Set MUSEUM_GATE or pass --cookie; without one every path answers with the gate page and the table is meaningless.");
  process.exit(2);
}

/**
 * The probe table. Every line here corresponds to an assertion in
 * worker/test-parity.mjs, so the two can be read side by side.
 *
 * The paths are real: they exist in the served tree as of this writing. If a
 * future accession renames one, update BOTH this list and the SAMPLE list in
 * test-parity.mjs — a probe against a path that no longer exists proves that
 * two hosts agree about a 404, which is not the question being asked.
 */
const PROBES = [
  ["the lobby", "/"],
  ["the lobby, spelled out", "/index.html"],
  ["a wing listing, pretty", "/promotions"],
  ["a wing listing, spelled out", "/promotions.html"],
  ["a wing listing, with a query", "/promotions.html?promo=giwf"],
  ["a wing listing, trailing slash", "/promotions/"],
  ["a wing, pretty", "/promotions/giwf/"],
  ["a wing, no trailing slash", "/promotions/giwf"],
  ["a wing, spelled out", "/promotions/giwf/index.html"],
  ["a page inside a wing", "/promotions/giwf/holdings"],
  ["an archive document", "/promotions/nticw/archive/chapter-one-2003-02-19"],
  ["COLLISION: /rps (file wins?)", "/rps"],
  ["COLLISION: /rps/ (directory wins?)", "/rps/"],
  ["COLLISION: /shows", "/shows"],
  ["COLLISION: /shows/", "/shows/"],
  ["a stylesheet", "/style.css"],
  ["a versioned stylesheet", "/style.css?v=13"],
  ["a script", "/js/list.js"],
  ["a data JSON", "/data/aliases.json"],
  ["a directory with no index", "/data/"],
  ["a photograph", "/galleries/img/characters/seymour-almasy-posed.jpg"],
  ["a path that does not exist", "/no-such-wing-anywhere/"],
  ["a file that does not exist", "/no-such-page"],
  ["the deploy manifest (must NOT be readable)", "/_manifest.json"],
  ["the headers control file (must NOT be readable)", "/_headers"],
];

/** The headers that are part of the parity contract; everything else is noise. */
const CONTRACT = [
  "location",
  "content-type",
  "cache-control",
  "x-robots-tag",
  "x-clacks-overhead",
  "accept-ranges",
];

function fmt(name, value) {
  return `      ${name}: ${value}`;
}

console.log(`# probe of ${base}`);
console.log(`# ${new Date().toISOString()}`);
console.log(`# fields: status, then the parity-contract headers. ETag/Date/Age are deliberately`);
console.log(`# omitted — they differ between any two hosts and would drown the real diff.`);
console.log("");

let failures = 0;

for (const [label, path] of PROBES) {
  let res;
  try {
    res = await fetch(base + path, {
      method: "GET",
      redirect: "manual",
      headers: { Cookie: `museum_gate=${COOKIE}` },
    });
  } catch (e) {
    console.log(`${path}\n  [${label}]\n      ERROR: ${e.message}`);
    failures++;
    continue;
  }

  const body = await res.text();
  const gated = body.includes("By appointment only");
  console.log(`${path}`);
  console.log(`  [${label}]`);
  console.log(fmt("status", res.status));
  if (gated) {
    console.log(fmt("!! GATED", "this host did not accept the cookie — the rest of this table is meaningless"));
    failures++;
  }
  const names = FULL ? [...res.headers.keys()].sort() : CONTRACT;
  for (const name of names) {
    const value = res.headers.get(name);
    if (value != null) console.log(fmt(name, value));
  }
  // Body size, not body: a byte count catches "served the wrong page" without
  // dumping a museum page into a diff.
  console.log(fmt("body-bytes", Buffer.byteLength(body)));
  console.log("");
}

if (failures) {
  console.log(`# ${failures} probe(s) could not be read (see !! lines above).`);
  process.exit(1);
}
console.log("# probe complete.");
