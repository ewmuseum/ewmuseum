#!/usr/bin/env node
/**
 * scripts/deploy-allowlist.mjs — THE TOP-LEVEL ALLOWLIST (structural
 * guardrail, 2026-09-03).
 *
 * Born from the scratch-directory incident: 62 lane scratch directories
 * (raw mining dumps, build scripts, out-of-character names/contacts) were
 * committed straight into the museum repo's top level and, absent from
 * `.assetsignore`, uploaded to the R2 bucket by every `r2-sync` run for
 * weeks before a privacy hit in one of them (READ-06 ledgering two terms
 * that happened to stand in a dump) surfaced it. `.gitignore` grew a
 * a "scratch-" directory-name rule that day, but a rule keyed on one observed shape
 * (hyphenated directory names) is exactly the kind of fix that misses the
 * NEXT shape — a root-level file instead of a directory, an underscore
 * instead of a hyphen, a stray paperwork file dragged in by the same
 * commit that did the cleanup. The museum tree has a fixed, small set of
 * legitimate top-level members; anything else showing up there is drift
 * that deserves a name, every time, not a pattern match that only catches
 * what already burned someone once.
 *
 * This is a POSITIVE list (an allowlist), not a denylist: every top-level
 * path in the tree — tracked or untracked-unignored — must be named here
 * explicitly, or it fails. `scripts/validate.mjs` enforces this as a hard
 * gate check; `scripts/r2-sync.mjs` enforces the same list independently
 * (a served page and a deploy are two different failure surfaces, and a
 * deploy that runs without the gate — there is none today, but the
 * doubled check costs nothing and is the belt to validate's braces)
 * against re-exposing a scratch directory that somehow slipped past the
 * gate. Both scripts import this ONE module so the list is never allowed
 * to drift between them.
 *
 * Update this list only for a real, reviewed addition to the museum's own
 * top-level shape (a new served-content directory, a new root page) — an
 * accession lane's scratch space belongs in `archive/` on the machine one
 * level up, never here, no exceptions.
 */

/** Directories that are part of the served site or its registry/tooling. */
const ALLOWED_DIRS = new Set([
  "tests",  // guardrails smoke-test plan (2026-09-03); never deployed (.assetsignore)
  // Served content categories (docs/SCHEMA.md, CLAUDE.md's file map).
  "awards",
  "characters",
  "collections",
  "data",
  "figures",
  "galleries",
  "memorials",
  "promotions",
  "rps",
  "shows",
  "titles",
  "units",
  // The public upcoming-shows feed (the Janitor, desk D408, 2026-10-07; hook c100): crawler/upcoming.ics, the ONE file in it,
  // served ungated at /crawler/upcoming.ics beside crawler.html and written only by scripts/fixers/sync-living-pulse-feed.py.
  // Served, so .assetsignore does NOT list it.
  "crawler",
  // The Essays pages (the Janitor's D142 and D169, 2026-10-01; CURATION.md v129; hook c108): essays/<id>.html, a served
  // essay, rendered by scripts/cross-reference.mjs from its data/essays.json row. Served.
  "essays",
  // The sitemap children (hook c305, 2026-10-12): sitemaps/sitemap-N.xml, written by scripts/stamp-public.mjs. The
  // sitemaps protocol caps one file at 50,000 URLs and the museum serves 119,243 pages, so /sitemap.xml is a
  // <sitemapindex> over these. A REVIEWED new top-level category, not drift. Served (Search Console and every crawler
  // fetch them from the index), so .assetsignore does NOT list it.
  "sitemaps",
  // Assets served to the browser.
  "js",
  // Tooling / infrastructure — not served content, but legitimate repo
  // members (r2-sync.mjs's own ALWAYS_EXCLUDE / .assetsignore already
  // keep these out of the bucket and out of validate's page walk; they
  // still need to be ALLOWED at the top level or this check reddens on
  // the repo's own scripts).
  "bot",
  "docs",
  "functions",
  // The operation's own configuration and paperwork (2026-09-15 repo-portability
  // pass): ops/config.env (the one path config every scripts/ops script reads),
  // ops/commit-stub.txt (the next commit's message — see docs/PROCESS.md,
  // "Landing a wave"), ops/lane-rules/ (LANE-RULES, LAW-CHECKS and the lane and
  // brief templates), and the DEPLOY-FAILED / PUSH-FAILED markers chain.sh
  // writes. A REVIEWED new top-level category, not drift: this is machinery the
  // repo must carry for a fresh clone to run a cycle, it is deliberately not
  // served content, and .assetsignore keeps it out of the bucket.
  "ops",
  "scripts",
  "templates",
  "worker",
  // Repo plumbing tracked in git (dot-prefixed, so also gated by
  // r2-sync.mjs's own INCLUDE_DOTFILES rule — never uploaded regardless).
  ".github",
  // The design system's machine-readable sidecar (Impeccable: design.json; the Janitor's /impeccable document,
  // 2026-10-03; landed by hook c37). Dot-prefixed: never uploaded.
  ".impeccable",
]);

/** Root-level FILES (not directories) that belong in the tree. */
const ALLOWED_ROOT_FILES = new Set([
  // Hand-authored / generated instrument pages.
  "404.html", "about.html", "appearances.html", "awards.html",
  "bestowals.html", "championships.html", "characters.html",
  "crawler.html", "curation.html", "essays.html", "frontier.html",
  "halloffame.html", "in-memoriam.html", "index.html", "matches.html",
  "promotions.html", "reigns.html", "relationships.html", "rps.html",
  "search-help.html", "search.html", "shows.html", "structure.html",
  "units.html",
  // The sacred docs + repo meta (CLAUDE.md's own "Where everything lives").
  "CURATION.md", "README.md", "CONTRIBUTING.md", "LICENSE.md", "CLAUDE.md",
  // The design docs (the Janitor's /impeccable init + document, 2026-10-03; hooks c35, c37): repo meta, never
  // served (.assetsignore keeps them out of the bucket, as it does README.md and CLAUDE.md).
  "PRODUCT.md", "DESIGN.md",
  // Build / site config and assets.
  "package.json", "package-lock.json", "robots.txt", "sitemap.xml", "style.css",
  // The ring mark (the Janitor's D261, 2026-10-03; hook c44): favicon, phone icon, share image. Root files, because browsers and
  // iOS fetch /favicon.svg and /apple-touch-icon.png from the root unasked; served, so .assetsignore does NOT list them.
  "favicon.svg", "favicon-32.png", "favicon-16.png", "apple-touch-icon.png", "share.png",
  // The EWM ring mark for the desktop masthead (the Janitor, 2026-10-05, D345; hook c75): one file every page draws with
  // <use href="/ringmark.svg#ewm"> (renamed from mark.svg by c79). Served, so .assetsignore does NOT list it.
  "ringmark.svg",
  // The accessions feed (the Janitor, chat, 2026-10-09; hook c221): feed.xml, the newest accessions as RSS, written by
  // scripts/build-accessions-feed.mjs at every build. Served (behind the gate unless the Worker's FEED_MODE opens it, desk
  // D497), so .assetsignore does NOT list it.
  "feed.xml",
  // Cloudflare Pages control files (r2-sync.mjs's own PAGES_CONTROL_FILES —
  // kept in step here rather than imported, since that set also legitimately
  // matches non-root names there; ours is root-only by construction).
  "_headers", "_redirects", "_routes.json", "_worker.js",
  // Dotfiles tracked in git — repo/asset config, never served content.
  ".allowed_signers", ".assetsignore", ".gitattributes", ".gitignore",
]);

/** First path segment of a POSIX-style relative path. */
export function topLevelSegment(relPath) {
  const norm = String(relPath).replace(/\\/g, "/").replace(/^\/+/, "");
  const slash = norm.indexOf("/");
  return slash === -1 ? norm : norm.slice(0, slash);
}

/**
 * True if `seg` (a top-level path segment) is on the allowlist. A segment
 * that also appears as a root FILE (e.g. "index.html") is allowed only via
 * ALLOWED_ROOT_FILES — `isDir` tells the two sets apart so a directory
 * that happens to share a name with an allowed file (or vice versa) is
 * still judged correctly instead of accidentally passing either way.
 */
export function isAllowedTopLevel(seg, isDir) {
  return isDir ? ALLOWED_DIRS.has(seg) : ALLOWED_ROOT_FILES.has(seg);
}

export { ALLOWED_DIRS, ALLOWED_ROOT_FILES };
