#!/usr/bin/env node
/**
 * THE MUSEUM — bake `_headers` into the serving Worker.
 *
 * Cloudflare Pages reads `_headers` off the deploy itself. A Worker cannot: it
 * has no filesystem, and `_headers` is not part of the R2 tree (it is a hosting
 * control file, not museum content). So this script parses the checked-in
 * `_headers` at BUILD time into `worker/headers.json`, which `worker/index.mjs`
 * imports and applies per request.
 *
 * THE POINT OF DOING IT THIS WAY: nothing upstream changes. `_headers` stays
 * the single source of truth, `scripts/stamp-stats.mjs` keeps stamping the
 * clacks lines between its `# clacks:start/end` markers, `scripts/stamp-public.mjs`
 * keeps stamping the robots block between its own, and
 * `scripts/registry-validate.mjs` keeps hard-failing on drift. This script
 * simply reads the result. A new memorial joins the overhead exactly as it does
 * today — one `npm run stats`, then a deploy.
 *
 * Run:
 *   node scripts/build-worker-headers.mjs           # write worker/headers.json
 *   node scripts/build-worker-headers.mjs --check   # fail if it is stale
 *
 * The `--check` mode is what the R2 deploy path runs first, so a deploy can
 * never ship a Worker whose baked headers lag the file the validators police.
 *
 * OUTPUT SHAPE
 *   {
 *     "_generated": "...",           // provenance, never hand-edit
 *     "sourceSha256": "<hex>",       // of _headers, for the staleness check
 *     "rules": [
 *       { "path": "/*", "set": [["Cache-Control","no-cache"], ...], "unset": [] }
 *     ]
 *   }
 *
 * `set` is an ORDERED ARRAY OF PAIRS, not an object, because the six
 * `X-Clacks-Overhead: GNU <name>` lines are six separate header lines under one
 * name — a man is not dead while his name is still spoken, and an object would
 * collapse five of them.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(ROOT, "_headers");
const OUT = resolve(ROOT, "worker", "headers.json");

/**
 * Parse Cloudflare's `_headers` format.
 *
 *   - A line starting at column 0 with `/` opens a rule for that path pattern.
 *   - Indented `Name: value` lines attach to the open rule.
 *   - An indented `! Name` line unsets that header (Cloudflare's removal syntax).
 *   - `#` starts a comment; blank lines are ignored.
 *
 * Path patterns support exact segments, `:placeholder` (one segment), and a
 * trailing `*` splat — the same three the Worker's matcher implements.
 */
export function parseHeaders(text) {
  const rules = [];
  const problems = [];
  let current = null;
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const stripped = line.trim();
    if (stripped.startsWith("#")) continue;

    const indented = /^\s/.test(raw);

    if (!indented) {
      if (!stripped.startsWith("/")) {
        problems.push(`line ${i + 1}: rule path must start with "/" — got ${JSON.stringify(stripped)}`);
        current = null;
        continue;
      }
      current = { path: stripped, set: [], unset: [] };
      rules.push(current);
      continue;
    }

    if (!current) {
      problems.push(`line ${i + 1}: header line with no rule above it — ${JSON.stringify(stripped)}`);
      continue;
    }

    if (stripped.startsWith("!")) {
      const name = stripped.slice(1).trim();
      if (name) current.unset.push(name);
      else problems.push(`line ${i + 1}: "!" with no header name`);
      continue;
    }

    const colon = stripped.indexOf(":");
    if (colon <= 0) {
      problems.push(`line ${i + 1}: expected "Name: value" — got ${JSON.stringify(stripped)}`);
      continue;
    }
    const name = stripped.slice(0, colon).trim();
    const value = stripped.slice(colon + 1).trim();
    if (!name) {
      problems.push(`line ${i + 1}: empty header name`);
      continue;
    }
    current.set.push([name, value]);
  }

  return { rules, problems };
}

function build() {
  if (!existsSync(SOURCE)) {
    throw new Error("_headers is missing — the Worker's header policy comes from it and nowhere else.");
  }
  const text = readFileSync(SOURCE, "utf8");
  const { rules, problems } = parseHeaders(text);

  if (problems.length) {
    throw new Error(`_headers did not parse cleanly:\n  - ${problems.join("\n  - ")}`);
  }
  if (!rules.length) {
    throw new Error("_headers parsed to zero rules — that would silently drop the clacks lines and X-Robots-Tag.");
  }

  // Guardrails against the two silent-failure modes this bake could have: the
  // clacks block or the robots block quietly not making it across.
  const allNames = rules.flatMap((r) => r.set.map(([n]) => n.toLowerCase()));
  if (/# clacks:start/.test(text) && !allNames.includes("x-clacks-overhead")) {
    throw new Error("_headers has a clacks block but no X-Clacks-Overhead line parsed out of it — run `npm run stats`.");
  }
  if (/# robots:start/.test(text) && !allNames.includes("x-robots-tag")) {
    throw new Error("_headers has a robots block but no X-Robots-Tag line parsed out of it — run `npm run stats`.");
  }

  return {
    _generated: "scripts/build-worker-headers.mjs — generated from _headers; never hand-edit",
    sourceSha256: createHash("sha256").update(text).digest("hex"),
    rules,
  };
}

const manifest = build();
const serialized = JSON.stringify(manifest, null, 2) + "\n";
const check = process.argv.includes("--check");

if (check) {
  const existing = existsSync(OUT) ? readFileSync(OUT, "utf8") : null;
  if (existing !== serialized) {
    console.error(
      "build-worker-headers: worker/headers.json is STALE (or missing) relative to _headers.\n" +
        "Run `npm run worker:headers` and commit the result before deploying.",
    );
    process.exit(1);
  }
  const clacks = manifest.rules.flatMap((r) => r.set.filter(([n]) => n.toLowerCase() === "x-clacks-overhead"));
  console.log(
    `build-worker-headers: OK — worker/headers.json matches _headers ` +
      `(${manifest.rules.length} rule(s), ${clacks.length} clacks line(s)).`,
  );
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, serialized);
  const clacks = manifest.rules.flatMap((r) => r.set.filter(([n]) => n.toLowerCase() === "x-clacks-overhead"));
  const robots = manifest.rules.flatMap((r) => r.set.filter(([n]) => n.toLowerCase() === "x-robots-tag"));
  console.log(
    `build-worker-headers: worker/headers.json written — ${manifest.rules.length} rule(s), ` +
      `${clacks.length} clacks line(s), X-Robots-Tag ${robots.map(([, v]) => v).join("|") || "none"}.`,
  );
}
