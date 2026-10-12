# OPERATIONS — hosting, mirrors, the gate, and the calendar

Infrastructure, not content. Read this when you're touching deployment,
access control, or the workshop/repo boundary — most accession sessions
never need it; `docs/PROCESS.md` is the one that does.

## Table of contents

1. [Hosting](#hosting)
2. [The gate](#the-gate)
3. [Running a cycle](#running-a-cycle)
4. [Collection machinery](#collection-machinery)
5. [Mirrors](#mirrors)
6. [Cache and version-stamp conventions](#cache-and-version-stamp-conventions)
7. [The workshop, the digests, and the repo boundary](#the-workshop-the-digests-and-the-repo-boundary)
8. [Maintenance calendar](#maintenance-calendar)
9. [R2 MIGRATION — the Janitor's runbook](#r2-migration--the-janitors-runbook)

---

## Hosting

**Today: Cloudflare Pages.** Build-less — the repo root deploys straight,
no build step, `.assetsignore` keeps dev-only files (`.git`, `.github`,
`node_modules`, `scripts`, `package*.json`, `README.md`, and this doc
tree) out of the served bundle. Two ways it deploys:

- **CI, automatic**: `.github/workflows/ci.yml` runs `npm run check` on
  every push/PR; on a green push to `main`, the `deploy` job runs
  `wrangler pages deploy . --project-name wwv-museum`, gated on the
  `CLOUDFLARE_API_TOKEN` repo secret existing (the secrets context isn't
  legal directly in a workflow `if:` condition — it's mapped to job `env`
  first, then gated on that; this exact pattern exists because the naive
  version silently failed on every push before the fix, see the git
  history for `fc195fb`/`6fe681f`).
- **Manual, authenticated CLI**: `npx wrangler pages deploy . --project-name
  wwv-museum` from a machine with `wrangler` logged in — the fallback
  used before the CI secrets existed, still works any time.

**`promotions.html` and `promotions/` coexist, deliberately** (THE
PROMOTIONS-PATH WAVE, 2026-08-22 — the Janitor: the site structure is
promotions, not wings, i.e. `/promotions/giwf/`, not `/wings/giwf/`).
There is no filename collision on disk (a file and a directory can share
the stem), and none in serving either, on the documented Cloudflare Pages
routing assumption: `/promotions` (and its pretty-URL variants) resolves
to `promotions.html`, the flat listing instrument, while `/promotions/<id>/`
resolves to `promotions/<id>/index.html`, the promotion's own page — the
`promotions/` directory intentionally carries **no root `index.html`**, so
no route ever has two candidates. `validate.mjs`'s link check resolves
both shapes file-wise the same way. If hosting ever moves, re-verify this
assumption before anything else.

**Access gate**: `functions/_middleware.js`, a Cloudflare Pages Function —
see the gate section, below.

**THE FILE-COUNT CEILING, and the migration already built for it.** Pages
refuses a deploy of more than **20,000 files**. The museum is at **15,604
deployable files** and gains hundreds per accession wave; the deploy that
crosses the line fails outright, with no warning shot. The successor is
built, tested, and sitting inert in the repo: an R2 bucket plus
`worker/index.mjs`, a serving Worker carrying the same gate, the same
`_headers` policy, and the same pretty-URL routing. Nothing upstream of the
served tree changes. See the **R2 MIGRATION** section at the bottom of this
doc for the Janitor's step-by-step, the parity check, and the one-line
rollback.

**Caps to actually watch, on the free/starter tier this project runs on**:
Pages' own request/bandwidth ceilings are generous for a private,
invite-gated, low-traffic archive and not a near-term concern; the
Function invocation count (every request passes through the gate
middleware) is the one line item that scales with real traffic, not repo
size. Nothing here has come close to a cap in this project's own history
— this section exists so the *next* operator knows what to check before
assuming a slowdown is a code problem rather than a plan limit.

**VPS migration plan, sketched (not needed yet, but planned for):** if
Cloudflare Pages ever stops being the right fit (a cap actually bites, or
the project wants to run something Pages Functions can't), the whole
site is a static file tree plus one small edge-function gate — it moves
cleanly to any VPS running a static file server (nginx/Caddy) in front,
with the gate re-implemented as either (a) a tiny reverse-proxy check
using the same HMAC-cookie scheme (the algorithm in
`functions/_middleware.js` has zero Cloudflare-specific dependencies
beyond the Workers-flavored `crypto.subtle` API, which is standard Web
Crypto and portable to Node/Deno/Bun without changes) or (b) basic auth
at the proxy layer as a cruder stopgap during the move itself. The
migration is genuinely a repoint, not a rebuild: `git clone`, serve the
tree, port the gate, update DNS. Nothing about the registry, the
generators, or the validators cares what's serving the HTML.

**The clacks header.** `_headers` carries `X-Clacks-Overhead: GNU <name>`
lines, one per `data/memorials.json` entry — the Terry Pratchett Discworld
"GNU" convention, a response-header tradition from the real-world web
community that adopted it after his death: "a man is not dead while his
name is still spoken." BUILD-STAMPED by `scripts/stamp-stats.mjs`
(`npm run stats`) between the `# clacks:start` / `# clacks:end` markers in
`_headers`, same chrome-system pattern as the masthead/footer and the
lobby door counts; `scripts/registry-validate.mjs` recomputes the same
names from the same data and hard-fails the build if the file has
drifted. Future memorials join the overhead automatically — nothing to
hand-edit. **VPS migration checklist item**: `_headers` is a Cloudflare
Pages-specific mechanism; an nginx/Caddy front end needs the equivalent
`add_header X-Clacks-Overhead "GNU <name>";` directive(s) (nginx) or
`header` directive (Caddy) added to the migration's server config by
hand, sourced from the same `_headers` file's stamped block, since the
new server won't read `_headers` itself.

**Node's own install location, and why every session needs the PATH
line.** `node`/`npm` are user-installed at `~/.local/opt/node/bin`, not
on `PATH` by default in a non-interactive shell (a session's own Bash
tool, cron, CI-adjacent tooling) — only an interactive login shell picks
it up from `~/.bashrc`. Every session that's about to run any `npm run
...` command needs `export PATH="$HOME/.local/opt/node/bin:$PATH"` first
(see `README.md`'s own Local check section for the exact line) — a
session that skips this gets a bare `node: command not found` and, if
it's not immediately obvious why, can waste real time debugging a
phantom install problem that isn't one.

**Regeneration timing — don't mistake slow-but-running for stalled.**
The full gate chain (`npm run build:data && npm run refresh:links &&
npm run chrome && npm run stats && npm run check` — `npm run refresh`
runs the first four) takes **6–9+ minutes at this project's own current
scale** (thousands of pages, over a thousand characters, tens of
thousands of entity links) — `cross-reference.mjs`'s own regeneration
pass is the long pole, since it walks and re-links the entire served
site, not just what one session actually touched. Under real contention
— several worktree agents regenerating at once during the fleet era —
observed single-regen duration ran anywhere from 8 to 50+ minutes
depending on how many concurrent regens were competing for the same
machine. **This is normal, not a sign anything is broken**, and it's
exactly the situation `CLAUDE.md`'s own WAIT-PATTERN invariant is
written for: check disk/process state directly rather than ending a turn
on nothing but waiting for a regen that's genuinely still running.

---

## The gate

`functions/_middleware.js` — every request checked for a signed cookie;
no cookie, or an invalid one, gets the invite page instead of content.
Full mechanism (worth knowing exactly, not just "there's a password"):

- **`GATE_SECRET`** (Cloudflare Pages **secret**, never committed) signs
  an HMAC-SHA256 token embedded in the cookie: `<expiry-unix-ts>.<hmac-hex>`,
  stateless, self-expiring, valid one year from mint. Changing
  `GATE_SECRET` invalidates *every* existing cookie at once — the "log
  everyone out right now" lever.
- **`INVITE_CODES`** (also a Pages secret) — comma-separated, case- and
  whitespace-insensitive. Editing this list is the entire access-control
  surface; nothing else needs redeploying to add or remove a code.
- The gate page itself is inlined HTML in the middleware (not a served
  page in the repo) — deliberate, so the gate renders even if the static
  bundle itself somehow failed to deploy.
- Threat model, stated plainly in the file's own header comment: "keep
  strangers and crawlers out of a private memorial archive of real
  people's youth. Not a vault... but it is personal, and it is by
  appointment only." Size the effort you put into hardening this
  accordingly — it is a politeness gate, not a security boundary against
  a determined attacker, and treating it as more than that would be its
  own kind of dishonesty about what actually protects anyone here.

### Law enforcement (the ratchet)

Several rules of `CURATION.md` were gaveled and then enforced only by an
advisory warning the gate printed and nobody read — on 2026-09-19 the
validators between them printed 14,000 of those every run, and a week of
landings broke rules that were already written (epitaphs by tier, house
style by tier, storylines at tier 3, award recipients minted, source kinds
inside their enum, workshop narration in served fields, public source links
on served documents). The fix is a RATCHET rather than a new wall of hard
failures: `scripts/validate.mjs`, `scripts/registry-validate.mjs`,
`scripts/validate-documents.mjs` and `scripts/validate-provenance-notes.mjs`
each COUNT their share of those rules on every run and compare the counts
against `scripts/law-baseline.json`, the numbers recorded the day each rule
was wired. A `max` rule whose count rises above its baseline fails the gate;
a `min` rule — the shape that catches a regeneration silently stripping
authored prose — fails when its count falls. Every rule prints its count
beside its baseline on every run, so the debt is visible instead of buried.
Existing debt is therefore frozen, not forgiven: it can be paid down, never
added to. `npm run law:baseline` rewrites the file; that is a
**Janitor-or-coordinator act** taken after debt has actually been paid down
(or after a rule's own definition deliberately changed), never a routine
step and never a way past a red gate. The workshop's landing check
(the workshop's `land-check.py`) enforces the same
rules absolutely on a wave's own delta, where there is no debt to grandfather
— a wave that would raise any of these counts is sent back before it lands.

---

## Running a cycle

Everything in this section is in the repo. A fresh clone plus a local
collection runs a whole cycle with no scratchpad, no generated per-cycle
scripts, and nothing to edit first. That is the point of it: on 2026-09-15
the operation's own machinery lived in a session scratchpad (lost with the
session) and an unversioned workshop directory, and the Janitor's test was
whether anyone could pick up the repo and run it with equivalent
performance. This is the answer to that test.

### The one-page version

```
git clone <repo> museum && cd museum        # no npm ci: there is no lockfile,
                                           # the project has zero dependencies
export NODE_BIN=$HOME/.local/opt/node/bin  # only if node is off PATH
export WORKSHOP_ROOT=/path/to/archive      # only if it is not ../archive
cp <existing-checkout>/.git/hooks/pre-commit .git/hooks/   # hooks are not cloned

npm run standing-check      # is the machinery intact? (exit 0 = yes)
npm run cycle -- 148        # the whole cycle: preflight -> gate -> chain -> window
```

`npm run cycle -- N` is the entry point. N is an **argument**, not a token
substituted into a generated script. Everything else below is what that one
command does, in order, and how to run each step by hand when something
needs attention.

### The four steps

**1. Preflight** — `npm run preflight -- <label>`

Runs every fixer named in `scripts/fixers/ORDER.txt`, in that order, then
the regen chain in invariant-2 order: `build:data` → `refresh:links` →
`chrome` → `stats` → `check`. Writes `$SCRATCH_ROOT/preflight<label>.log`
and records `PREFLIGHT_RC` as its own line in that log.

Preflight is allowed to change the tree. The gate that follows is not.

- **rc 0** — the log is clean: no `✗`, no traceback. This is the only state
  from which the gate should be launched.
- **rc 1** — either the chain exited non-zero or the log carries failure
  lines. The last twenty are printed. Fix and re-run; nothing has committed.

`npm run fixers` runs step one alone, without the regen.

**2. Gate** — `npm run gate:cycle -- <label>`

A thin wrapper around `scripts/gate.sh`, which stays the one sanctioned
gate implementation. The wrapper adds exactly two things: `LC_ALL=C`, and a
log with a `GATE_RC` line.

The locale is not decoration. The pre-commit hook recomputes a digest over a
**sorted** file list; if the gate sorted under one locale and the commit
under another, the stamp can never match. Gate and commit share `LC_ALL=C`
or nothing works.

- **rc 0 — GREEN.** A stamp is written to `$GITDIR/gate-ok`. A commit of
  *this exact content* will pass the hook. Any further edit voids it.
- **rc ≠ 0 — RED.** No stamp. Commits are blocked, which is the correct
  outcome. A red gate is never a reason to commit, and `--no-verify` is
  prohibited by house law.

**What a red means, concretely.** Red is a content finding, not a machine
failure — the validators found something in the registry or on a page that
law or schema forbids. The red handler (`scripts/ops/red-handler.sh`, run
automatically by `cycle.sh`) redacts the privacy hits the gate log itself
named, on the pages it named, re-runs preflight, and gates again, up to four
times. Then it stops and says so. Stopping is the designed behaviour: the
one-shot version of this handler let standing fixes quietly stop persisting.
A handler that gives up is a hand-fix; a handler that grinds is a bug.

**3. Chain** — `npm run chain -- <label>`

Commits exactly the stamped tree and publishes it. In order:

1. refuse unless a green stamp exists — the stamp *is* the authorisation;
2. `npm run worker:headers` — `stamp-stats` rewrites `_headers` every cycle
   and `r2-sync` silently refuses a `headers.json` that is stale against it.
   That refusal cost three days of a stale live site between chains 133 and
   145. Regenerating them is a step of the chain now, not something someone
   remembers;
3. `git add -A && git commit -F ops/commit-stub.txt`;
4. `node scripts/r2-sync.mjs` — on failure, writes `ops/DEPLOY-FAILED`;
5. `git push` — on failure, writes `ops/PUSH-FAILED`;
6. the gate-free window (below).

The failure markers are files, deliberately: `standing-check` reddens on
them and the next heartbeat sees them. A publish that failed silently is the
failure mode this replaced.

`npm run chain -- --dry-run` prints the whole plan — the stub, the stamp,
how many paths would be staged, which waves would be applied — and changes
nothing.

**4. The window** — `npm run window -- <label>`

The gate-free edit window between one commit and the next gate. Two halves:
land every READY, unapplied wave delta under the configured wave trees, then
run the standing window fixers. It refuses outright while a gate is running,
because a fixer writing under a live gate voids its stamp.

### The commit-stub rule

`ops/commit-stub.txt` is tracked. It holds the next commit's subject, its
wave lines, and the standing trailer. `scripts/ops/append-commit-line.py`
appends one wave line to it, idempotently on the `(wave X)` tag.

**Stub N+1 carries only waves applied by chain N.** A wave's line belongs on
the stub of the commit that will actually carry it:

- the wave dir has `APPLIED` → its line belongs on the **next** commit;
- the wave dir has `READY` only → the one **after** (chain N+1 applies it,
  chain N+2 commits it).

Getting this backwards names a wave in a commit message that the tree does
not contain. `npm run standing-check` checks the live stub against the wave
dirs and reports any name that has no `APPLIED` marker.

### Where things are

One config file, `ops/config.env`, is read by every script:

| name | default | what it is |
|---|---|---|
| `MUSEUM_ROOT` | the repo, derived from the script's own location | the repo itself |
| `WORKSHOP_ROOT` | `$(dirname MUSEUM_ROOT)/archive` | the private collection beside it |
| `SCRATCH_ROOT` | `$WORKSHOP_ROOT/ops-scratch` | per-cycle logs; disposable |
| `NODE_BIN` | empty (use PATH) | directory holding node/npm |
| `WAVE_TREES` | the list in the file | wave trees the window scans |

Every one is overridable from the environment. Nothing under any one
person's home directory is written into any script; that is enforced by
grep, not by care.

`WAVE_TREES` deserves its own note. The old cycle scripts enumerated scratch
years literally, in eight derived copies each cycle. When a walk opened
`scratch-1996`, thirteen READY waves were named in a commit and never
applied, because six of those eight copies had never heard of 1996. A walk
that opens a new year now adds **one line** to `ops/config.env`.

**A clone with no local collection still works.** `WORKSHOP_ROOT` absent
means every wave step finds nothing and no-ops; preflight, gate, readout and
deploy-status all run. Only the landing of new material needs the
collection.

**A clone does not have to live beside the workshop.** The privacy scripts
— `privacy-check.mjs`, `ledger-fold.mjs`, `privacy-credit-warn.mjs` — used
to find the redaction ledger only at `../archive/privacy/`, the sibling
convention, so a clone anywhere else failed the gate with "ledger not found"
before reaching a single page. They now read `WORKSHOP_ROOT` when it is set
and fall back to the sibling path when it is not, so an existing checkout
behaves exactly as before and a clone in an arbitrary directory gates
correctly. (`PRIVACY_LEDGER` still overrides both, for pointing a test
harness at a scratch copy.)

**Two things a fresh clone does not get from git, and must be set up once:**

- **the pre-commit hook.** Hooks are not cloned. `.git/hooks/pre-commit` is
  what refuses a commit without a matching green stamp; until it is
  installed, a clone will happily commit an ungated tree. Copy it from an
  existing checkout, or point the clone at a shared hooks directory.
- **`npm ci` does not work** — there is no `package-lock.json`, because the
  project has **zero dependencies** on purpose (plain Node, no framework, no
  build step). `npm install` succeeds and installs nothing; you can also
  skip it entirely. Node itself is the only requirement.

### Why there is one script and not eight

The scratchpad era minted a fresh set of per-cycle scripts by substituting
the cycle number into the last set. It cost two chains outright: a bare
`s/95/96/g` rewrote the session id inside the scratchpad path, and a bare
`s/97/98/g` turned every `scratch-1997` wave glob into `scratch-1998`. Later
it stranded waiters on stale gate numbers for fourteen cycles. Half of the
old `standing-check` existed only to audit generated copies of scripts
against each other.

`cycle.sh` takes N as an argument. That entire class of failure is gone by
construction, and the checks that policed it are gone with it.

---

## Collection machinery

The fetchers, the circuit breaker they all consult, and the doctrine that
governs them. `scripts/fetch/`. These read and write the **workshop**, never
the repo's served content.

### The fusebox (`scripts/fetch/politeness.py`)

A persistent, shared, per-host circuit breaker. Every fetcher consults it;
none may bypass it. State lives on disk under `$WORKSHOP_ROOT/net/fusebox`,
one JSON file per host, so it survives process restarts — which is the whole
point. It was born 2026-08-31 after a retry storm got the museum's IP
dropped by a public index: the per-run stop rule worked exactly as designed,
and the failure was structural. Every restart reset the counter and
re-hammered the same wall.

    python3 scripts/fetch/politeness.py status          # every host's state
    python3 scripts/fetch/politeness.py trip <host> <hours> "<reason>"
    python3 scripts/fetch/politeness.py clear <host>    # Janitor-level reset

The five rules it encodes:

1. **A wall is an answer.** 429, 403, connection-drop (the HTTP-000 class)
   and 402 are never retried. They trip the breaker immediately.
2. **The breaker outlives the process.** A restarted fetcher sees the trip
   and refuses to run until the cool-off expires.
3. **Cool-offs escalate** (the ladder, below).
4. **A daily failure budget** caps total damage even when no single run
   trips: **25 failures per host per day** trips it to tomorrow.
5. **Transient is not a wall.** An ordinary timeout gets one polite retry
   after a real pause. A clean 404 or empty result is a *success* — an
   answer, not a failure — and the caller must record it as one.

### The ladder

| situation | cool-offs |
|---|---|
| transient (timeout, non-wall error) | 15 min |
| a wall (403 / conn-drop / http-000 / 402) | first of the local day 1 h, second the same day 24 h |
| a 429 | stop 2 min, then one retry; only 429s repeating inside the same rolling hour climb — 1 h, then 4 h, then 24 h for a fourth inside the hour |
| daily budget exhausted (25/host/day) | trips to tomorrow |

The 429 rule is deliberately gentler than the wall ladder, and it is gentler
because of evidence: every 429 in the week before 2026-09-09 was the *first*
request after hours of silence, and the same captures answered 200 the next
day. Per-host ladders exist for hosts that publish their own policy —
Arquivo.pt announces a permanent block for sustained excess, so its ladder
is steeper.

### The CDX ration

The Wayback CDX index API (`web.archive.org/cdx/`) is a separate and far
stricter service than playback: it can return 429 on a single request. Since
2026-09-03 the fusebox keys it as its *own* host (`web.archive.org:cdx`), so a
CDX wall trips only that key and never the playback crawl. It is spent as a
**ration**, not in bursts. The workshop's `cdx-ration.sh`
runs one prefix query from the URL walk's `cdx-ration-queue.tsv` per run (the Janitor
2026-09-20, one a night; 2026-09-23, two a day). Since 2026-09-26 the hourly
`cdx-ration-ramp.py` owns the schedule. After every six consecutive clean runs
it adds one run a day, spread evenly from 05:00. A wall steps it back one level
(never below two a day) and restarts the count. State lives in
the URL walk's `cdx-ration-ramp.json`, and `--status` shows it. (The Janitor:
"bumping up the allowance every six consecutive runs until we hit walls
again.") It skips a run whenever either `web.archive.org` key
is tripped. Everything else lists captures with timemaps: the per-URL timemap,
or the prefix timemap (`cdx-prefix.py --endpoint timemap`, its own key
`web.archive.org:timemap-prefix`). Neither spends the ration. Never call CDX
outside the ration.

### 403 classification (three tombstone shapes)

A 403 from the Archive is not one thing. The fetchers classify the body
before recording the failure, and the raw bodies are appended to
`$WORKSHOP_ROOT/fwrestling-census/ia-403-bodies.log` for audit:

- **excluded** — the capture exists but is withheld (robots/exclusion). A
  permanent answer about that URL: record it and move on, never retry.
- **blocked-memento** — the playback layer refused this particular memento.
  Also an answer about that capture, not about the host.
- **rate/soft-block** — a genuine wall. Trips the breaker on the wall ladder.

Only the third is a wall. Treating the first two as walls is what makes a
night end after one burst; treating the third as transient is what gets an
IP dropped.

### The daily budget and the trickle

Collection runs on a trickle, not a crawl: bursts of ten requests four
seconds apart, then a five-minute rest, inside two quiet shoulders
(20:30–02:00 and 04:30–08:00 PT, chosen from an hour-of-day probe map).

    bash scripts/fetch/ia-trickle-v2.sh          # one leg
    bash scripts/fetch/ia-trickle-shoulders.sh   # both shoulders in sequence
    bash scripts/fetch/arm-trickle-nightly.sh    # cron entry point

**The first-request wall.** After any 429 the cool-off runs its ladder step;
when it lifts, the trickle does *not* resume with a burst. It sends one
probe request. 200 resumes bursts; 429 steps the ladder up again and waits.

A `NIGHT-OFF-<date>` marker file in the census dir stops that night before
it starts.

### The other fetchers

| script | what it does |
|---|---|
| `fwrestling-census-fetch.py` | Wayback fetcher for the census plan; tiers a–e |
| `url-walk-fetch.py` | Wayback fetcher for the URL-leg queue; priorities 0–3 |
| `site-mirror.py` | polite mirror of one live site, one stream |
| `fwrestling-liveness.py` | direct DNS+HTTP liveness, never via the Archive |
| `fwrestling-mirror-all.sh` | mirror every alive target in a liveness TSV, resumable |
| `park-live-duplicates.py` | park Archive rows a live mirror has now covered |
| `character-first-census.py` | character-first census over a walk dump |

Each resolves its collection tree from `WORKSHOP_ROOT` (override a single
one with `FETCH_BASE_DIR`). Liveness is checked **directly** — DNS and HTTP
through the fusebox — and never through the Archive.

---

## Mirrors

**Canonical/replica law, stated once, applies forever:** GitHub
(`ewmuseum/ewmuseum`) is canonical. Every push to `main`
force-mirrors, whole — every branch, every tag, full history — to every
configured mirror remote via `.github/workflows/mirror.yml`
(`git push --mirror`). A mirror is a **read-only replica**, never an
additional home: **never push directly to a mirror** — its own history
gets silently overwritten by the next sync from GitHub regardless, so a
direct push there is invisible, wasted work that will vanish on the next
push to `main`.

**Adding a mirror**: create an empty repo on the target host, mint a
token with write/push scope, `gh secret set MIRROR_URL_<NAME>` with the
full authenticated URL (`https://oauth2:TOKEN@host/user/repo.git` for
GitLab-style hosts — check the target host's own auth-in-URL convention,
they differ). A missing/empty secret skips its own mirror step harmlessly
— a mirror activates the moment its secret exists, nothing else to wire
up. Add a new `steps:` entry in `mirror.yml` for a host beyond the two
already wired (GitLab, Codeberg).

**The incident this workflow's own current shape comes from**: secrets
aren't readable inside a workflow step's `if:` expression directly —
gating each mirror step on `${{ secrets.MIRROR_URL_X != '' }}` looked
right and failed silently on *every single push* until it was diagnosed
and fixed by mapping secrets to job-level `env` first, then gating on the
env var instead (same root cause and same fix pattern as the CI deploy
job's own `CLOUDFLARE_API_TOKEN` gating — see the Hosting section, above). If you're ever adding
a new conditional workflow step gated on a secret's presence, use the
`env:`-mapping pattern from the start; the direct `if: secrets.X` version
looks correct, passes review, and silently never runs.

**If GitHub itself ever dies**: promote whichever mirror is most current
to canonical, repoint `mirror.yml` (now mirroring *from* the new home)
and the CI/Cloudflare Pages deploy source at the new repo, and carry on.
The mirrors exist so that day is a repoint, not a reconstruction — that's
the entire reason the redundancy exists, so treat "keep the mirrors
actually current" (the Maintenance calendar section) as load-bearing, not optional housekeeping.

---

## Cache and version-stamp conventions

`style.css`, `js/list.js`, and `js/query.js` are all referenced with a
`?v=N` query string (`style.css?v=5`, `list.js?v=4`, `query.js?v=3` —
versions drift independently, that's fine) purely for cache-busting: a
browser that cached the old asset under the old URL won't see the new
one until the URL itself changes, and a bare re-deploy of an
unchanged-URL asset can leave visitors on stale CSS/JS for as long as
their cache honors it. `query.js` isn't loaded through
`templates/chrome.html` — every page that uses it (`search.html`,
`characters.html`, `promotions.html`, `championships.html`,
`halloffame.html`, `shows.html`, `rps.html`, `frontier.html`) hand-includes
its own `<script>` tag, so a `query.js` bump is a plain sitewide grep-and-
replace across those pages, not a chrome re-stamp. `matches.html` (THE
MATCH SECTION, 2026-08-20) joined this same list — a hand-authored
instrument page, same shape as `characters.html`/`shows.html`.

**The rule: bump the version number in `templates/chrome.html` (both the
`<link>` and, for `list.js`, wherever a page loads it) any time
`style.css` or `js/list.js` actually changes** — and, by the same rule,
every page's own `query.js?v=N` tag any time `js/query.js` changes — then
`npm run chrome` to
propagate the stylesheet link sitewide. A handful of pages load these
assets outside the normal chrome-stamped flow (redirect stubs, a couple
of legacy meta-refresh pages) — after bumping the version, grep for the
old version string across the repo and fix any stragglers by hand; this
project's own history has caught stale versions on redirect-stub pages
more than once because they're not chrome-stamped and don't get the bump
automatically.

**Do not** bump the version number for a change that doesn't touch
`style.css`/`list.js` themselves — an unnecessary bump forces every
visitor to re-fetch an asset that didn't change, for no benefit.

---

## The workshop, the digests, and the repo boundary

This repo (`wwv-museum`) is **only** the museum: the served site, the
registry, the constitution, the handbook. It is not where mining happens
and it never holds raw source material.

**One level up from this repo, on the same machine**: `archive/` — the
private workshop. Raw mined HTML/text/CDX dumps, conversion scratch
space, and the workshop's digests — the research digests
`docs/PROCESS.md`'s Digests section describes. **This directory is never committed to
this repo and never served.** The relationship, stated as plainly as
possible: **digests are accession paperwork, not museum content.** A
digest justifies and explains what ends up in `data/*.json` and
`promotions/*/archive/*.html` — it is the receipt, not the item. Nothing in
`archive/` is meant to survive on its own the way the museum repo is
built to; if the workshop directory vanished tomorrow, every already-
served page and every already-registered entity would be completely
unaffected (their receipts live in the museum's own `notes`/`source`
fields, quoting or citing the digest, not depending on the digest file
continuing to exist) — only *future* accession work would need the
workshop back.

If you're a fresh session with no access to the workshop machine: you can
still do everything `docs/PROCESS.md`'s REGISTRY, CROSS-REFERENCING, and
QA sections describe using only this repo. INTAKE, MINING, and DIGESTS
need the workshop; ask the coordinator for it rather than assuming it's
somewhere in this repo.

---

## Maintenance calendar

- **WEEKLY (from opening day; amended from monthly 2026-08-26 — the TWIW revival's deadline drives the cadence): the recurring preservation crawl** (CURATION
  v98) — incremental re-crawl of every verified-alive row's site under the
  EWMuseumBot user-agent; `last_checked` derives from the crawl itself.
- **WEEKLY (from opening day): the blocked-list ping** — light reachability
  check only, for rows whose robots.txt or anti-bot posture forecloses
  crawling; the ping is the fallback instrument, never the primary.

Nothing here runs on a strict cron — this is a punch list of the things
that expire or drift silently if nobody's watching, in the order they're
likely to actually bite:

- **`CLOUDFLARE_API_TOKEN`** — Cloudflare API tokens can be created with
  or without an expiry; if the one in use has one, it needs rotating
  before it lapses or CI's `deploy` job starts skipping cleanly (by
  design — a missing/invalid token skips, it doesn't fail loud) and
  nobody notices until someone asks why the live site is stale.
- **Mirror tokens** (`MIRROR_URL_GITLAB`/`MIRROR_URL_CODEBERG`, and any
  added later) — the auth token is embedded in the secret URL itself; a
  host-side token expiry silently breaks that one mirror's push step
  (same "skips cleanly" behavior, same silent-drift risk). Check mirrors
  are actually current periodically, not just assume the green CI check
  mark means they are — the CI `check` job passing only proves the site
  validates, not that a mirror push succeeded.
- **`GATE_SECRET` / `INVITE_CODES`** — no expiry by default (the cookie
  itself is one year, self-renewing on next visit within that window),
  but review the invite-code list periodically for anyone whose access
  should be revoked; removing a code takes effect on that visitor's next
  cookie expiry, not instantly (their existing cookie stays valid until
  it naturally expires unless `GATE_SECRET` itself is also rotated).
- **Workshop digest freshness** — not a token, but the same shape of
  risk: a digest is workshop scratch, and the workshop machine/directory
  isn't backed up by this repo's own git history. If workshop-side
  storage is ever migrated or reorganized, update the `digest` field
  paths in `data/collections.json`/`promotions.json.sources[]` (or at
  minimum confirm they still resolve) so a future session doesn't chase
  a citation to a file that moved.
- **Registry/gate drift** — covered structurally by `npm run check`
  itself (see `docs/PROCESS.md`'s QA section incident list) rather than a
  calendar item; the reason it's mentioned here at all is the reminder
  that `npm run build:data && npm run chrome && npm run stats` **before**
  `check`, every session, is what keeps this from ever becoming a
  calendar item in the first place. Since THE SHARDING MIGRATION (see
  `docs/SCHEMA.md`'s own "Sharding" section), `npm run check` itself
  hard-fails on a `data/shards/` edit that was never rebuilt (the
  rebuild-diff freshness check in `registry-validate.mjs`) — CI's own
  `npm run check` run on every push catches a forgotten `build:data` the
  same mechanical way it already caught stale chrome/stats, no workflow
  change needed.
- **The frontier's verified-alive re-check sweep** (THE ACTIVE-EFEDS
  REGISTER REFINEMENT, 2026-08-20) — `data/frontier.json`'s 81
  `verified-alive` rows are a standing watchlist, each carrying a
  `check_cadence` (`monthly` or `quarterly`, quarterly by default) and a
  `last_checked` date. On the cadence a row asks for: confirm the
  promotion is still resolving/running (the same ruin-vs-residence
  judgment call `docs/PROCESS.md`'s Intake section already documents —
  sample the body, don't trust a bare `200`), then update `last_checked`
  regardless of the outcome. A row that's actually gone dark moves to
  `verified-dead` per the ordinary dead-only-rule pipeline — that's a
  status change, not a calendar tick, and unblocks the row for real
  mining per `docs/PROCESS.md`'s own Intake section. This sweep never
  mines a living row's content, only checks whether it's still alive; the
  dead-only rule's own mining gate is unaffected either way.

## The opening-day runbook (established 2026-08-23, pre-open)

Everything that flips when the auth wall comes down, in order — one
sitting, no step skipped:

1. **The flag**: `data/site-config.json` → `"public": true` → `npm run
   refresh` → gates green → push. This alone strips noindex sitewide,
   opens robots.txt (search welcome, AI-training crawlers blocked by
   name), switches the X-Robots-Tag header to `nocache, noai,
   noimageai`, and advertises the sitemap — validate.mjs enforces the
   public state from that commit on.
2. **The gate**: retire `functions/_middleware.js` (the invite wall)
   and with it the gate cookie — the site's only cookie, sunsetting
   exactly as the no-tracking policy promised.
3. **The repos**: flip all three to public — GitHub
   (ewmuseum/ewmuseum, Settings → General → Danger Zone), GitLab
   (project AND group visibility), Codeberg (repo AND org). They stay
   private until the site opens, and open with it.
4. **The IA plumbing**: arm the Internet Archive snapshot piece
   (archive.org account + S3 keys; upload cadence per the maintenance
   calendar) — deliberately deferred to the open so the first public
   snapshot is the opened museum, not the gated shell.
5. **Discovery**: Search Console + Bing Webmaster verification,
   sitemap submission — Janitor-account tasks.
6. **The allowlist**: structure.html and essays.html leave the
   reachability allowlist (link them or retire them — the Janitor's
   editing pass decides which before this day arrives). essays.html is
   DONE as to the link (2026-10-08): the masthead links Essays (hook c144),
   so the page is reachable from the front door and its
   `DELIBERATELY_UNLINKED` entry in `scripts/validate.mjs` is now
   redundant (removing it is a separate validate.mjs edit). structure.html
   is still open.
7. **Last look**: the DRAFT stack (README, CONTRIBUTING, LICENSE,
   structure, search-help, About) must carry no DRAFT banners past
   this point — opening with a draft license is opening unlicensed.
8. **The translate-elsewhere row** (THE ECOSYSTEM EXPANSION GAVEL,
   2026-09-05, step 2; `CURATION.md` v112(b)): flipping the flag is
   also what makes the provider link-outs render on non-English
   documents for the first time — while the gate stands, an external
   provider cannot fetch a museum URL and the row is deliberately
   suppressed. Before the flip, two things get checked by hand, because
   neither is mechanical. **`site_url`** in `data/site-config.json`
   must be the origin this site actually answers on
   (`https://ewmuseum.org` today, taken from this file's own deploy
   notes) — it is the absolute URL handed to every provider, and it is
   in the Janitor's pile for confirmation at exactly this moment.
   **THE ENDPOINT TEST**: every entry in `translate_providers` must be
   a PAGE-translation endpoint — hand it a URL and the PAGE at that URL
   must be translated, not the URL STRING translated as text. Open each
   template by hand against one served page and look. A floor met on
   paper is not met: three PAGE-translation providers, or
   `scripts/stamp-translations.mjs` renders no row at all, which is the
   correct outcome and not a bug. (Step 1 seeded two text endpoints —
   DeepL's `#auto/en/{url}` fragment and Bing's `?text={url}` — and
   step 2 dropped both for that reason.)

---

## R2 MIGRATION — the Janitor's runbook

**Why this exists.** Cloudflare Pages refuses a deploy of more than **20,000
files**. The museum is at **15,604 deployable files** and gains hundreds per
accession wave. There is no warning shot: the deploy that crosses the line
fails outright, and it will be a Tuesday. R2 has no file-count ceiling, so
the served tree moves into an R2 bucket and a small Worker becomes the front
door.

**What actually changes, and what does not.** The Worker carries the invite
gate across verbatim, the `_headers` policy (clacks lines and all), the
pretty-URL routing, and the site's own `404.html`. Nothing upstream of the
served tree moves at all: the registry, the shards, the generators, every
`npm run` script, and `_headers` itself stay exactly as they are. A visitor
should not be able to tell the difference, and that is the whole design
goal — see "What parity means, honestly" below for the one place it is
asserted rather than observed.

**The pieces:**

| file | what it is |
|---|---|
| `worker/index.mjs` | the serving Worker — gate, routing, R2 fetch, headers |
| `worker/wrangler.toml` | its config; **routes are commented out until you arm them** |
| `worker/headers.json` | `_headers`, baked at build time; generated, never hand-edited |
| `scripts/build-worker-headers.mjs` | does that bake (`npm run worker:headers`) |
| `scripts/r2-sync.mjs` | the incremental deploy — path→sha256 manifest, uploads only the diff |
| `worker/test-parity.mjs` | 92 assertions against a real local Worker + real local R2 |
| `worker/test-sync.mjs` | 28 assertions over the add/no-op/change/delete cycle |
| `worker/probe-pages.mjs` | probes a live host and prints its routing table, for diffing |
| `.github/workflows/deploy-r2.yml` | the CI deploy path — **NOT ACTIVE**, three separate guards |

### The steps, in order

Each step is safe to stop after. Nothing before step 7 touches what visitors
see; the museum keeps serving from Pages the whole way.

**1. Make the bucket.** Cloudflare dashboard → R2 → Create bucket, named
`ewmuseum-site`. Location: automatic. No public access, no custom domain —
the Worker is the only thing that will ever read it, and the bucket staying
private is what keeps the gate meaningful. Make a second bucket,
`ewmuseum-site-staging`, at the same time; it is what `wrangler dev` binds to
(see the trap in step 5).

If you pick different names, change `bucket_name`/`preview_bucket_name` in
`worker/wrangler.toml` — `scripts/r2-sync.mjs` reads the name from there, so
that is the only edit.

**2. Mint a token.** Cloudflare dashboard → R2 → Manage API tokens → Create
API token. Permission: **Object Read & Write**, scoped to the two buckets
above and nothing else. This can be the same `CLOUDFLARE_API_TOKEN` the Pages
deploy already uses if you would rather add the R2 permission to that token
than juggle two — either is fine, but a token scoped to just these buckets is
the better habit.

For CI you need `CLOUDFLARE_API_TOKEN` (already set) to carry R2 Object Read
& Write, plus `CLOUDFLARE_ACCOUNT_ID`. For your own machine, `npx wrangler
login` once is enough and no token is needed at all.

**3. Set the Worker's secrets.** These must be the SAME VALUES the Pages
project already carries — especially `GATE_SECRET`. A different secret is not
a configuration difference, it is every existing visitor logged out at the
instant of cutover, because the cookie is an HMAC of nothing but the expiry
signed with that key.

```
npx wrangler secret put -c worker/wrangler.toml GATE_SECRET
npx wrangler secret put -c worker/wrangler.toml INVITE_CODES
```

You can read the current values from the Pages project's settings; if
`GATE_SECRET` was never written down anywhere, this is the moment to decide
whether to copy it or to accept a one-time sitewide re-signing (three people
re-enter a code — the invite-code list is unaffected either way).

**4. Seed the bucket.** The first upload is the only slow one.

```
node scripts/r2-sync.mjs --dry-run          # read the diff first, always
node scripts/r2-sync.mjs                    # ~1 hour for the first 15,600
```

`wrangler r2 object put` is one process per file; there is no bulk command.
At the default concurrency of 8 that is roughly an hour of wall clock, once,
ever. `--concurrency 16` roughly halves it if the machine is idle.

**If an hour is not acceptable**, `rclone` can do the same seed in a few
minutes over R2's S3 API (you would need an R2 *access key* pair, minted in
the same R2 → Manage API tokens screen, which is a different credential from
the Cloudflare API token above):

```
rclone copy . :s3:ewmuseum-site --s3-provider=Cloudflare \
  --s3-endpoint=https://<account-id>.r2.cloudflarestorage.com \
  --exclude-from <(printf '%s\n' .git/** .github/** .claude/** node_modules/** \
    scripts/** docs/** worker/** '.*' package.json package-lock.json \
    README.md CLAUDE.md _headers _redirects)
node scripts/r2-sync.mjs                    # writes the manifest; finds nothing to do
```

Either way, run `scripts/r2-sync.mjs` at the end: the manifest is what makes
every subsequent deploy incremental, and it is only written by that script.

Interrupting the seed is safe. The manifest is written last, so a killed run
leaves the bucket partly filled and the manifest still describing the old
state — the next run recomputes the same diff and finishes. The failure mode
is repeated work, never a manifest that lies.

**5. Deploy the Worker to staging and test it.**

```
npx wrangler deploy -c worker/wrangler.toml
```

With `routes` still commented out, this puts the Worker **only** on its
workers.dev subdomain. Nothing on `ewmuseum.org` changes. The gate applies
there exactly as it does anywhere else, so this is not an open back door.

Visit `https://ewmuseum-serve.<your-subdomain>.workers.dev/`, enter an invite
code, and walk around: the lobby, a wing, a character page, a roleplay, the
search page, a deliberate 404.

> **The trap, written down because it cost a debugging round:** `wrangler dev`
> binds the **preview** bucket (`preview_bucket_name`), not `bucket_name` —
> in local mode as well as remote. If you rehearse a sync and then find every
> page 404ing while the redirects still work, this is why. Sync to
> `ewmuseum-site-staging` when you want to test against `wrangler dev`.

**6. Run the parity check — the actual green light.**

```
export MUSEUM_GATE=<your museum_gate cookie value, from DevTools>

node worker/probe-pages.mjs https://ewmuseum.org > /tmp/pages.txt
node worker/probe-pages.mjs https://ewmuseum-serve.<subdomain>.workers.dev > /tmp/worker.txt
diff /tmp/pages.txt /tmp/worker.txt
```

Same 25 paths, same fields, both hosts. **An empty diff is the green light.**
Anything else is a decision to make now rather than after the route flips.

Two differences are expected and fine, and the probe omits neither by
accident: `/.allowed_signers` is not in the table (the Worker deliberately
does not serve dotfiles — see "Deliberate deviations" below), and body-byte
counts on the gate page are identical while `ETag`/`Date` are excluded from
the table entirely because they differ between any two hosts.

**7. Cut over.** In `worker/wrangler.toml`, uncomment the two `[[routes]]`
blocks, then:

```
npx wrangler deploy -c worker/wrangler.toml
```

From that moment `ewmuseum.org` is served by the Worker. Pages is still
sitting there, untouched, still deploying on every green push — that is
deliberate. Do not disable it today.

**8. Watch, then retire Pages.** Give it a few days of real use. When you are
satisfied: set the `R2_DEPLOY` repository variable to `true` (Settings →
Secrets and variables → Actions → Variables) so
`.github/workflows/deploy-r2.yml` will run, dispatch it once with
`dry_run: true` and read the diff, then dispatch with `dry_run: false`.
Only after that has worked twice, comment out or delete ci.yml's `deploy`
job.

### Rollback

**Comment the two `[[routes]]` blocks back out and redeploy.** That is the
whole thing:

```
npx wrangler deploy -c worker/wrangler.toml
```

Within seconds `ewmuseum.org` is served by Cloudflare Pages again, from the
same tree, with the same gate cookie still valid (same `GATE_SECRET`, same
cookie name, same token format — a cookie minted by either side verifies on
the other). Nothing in the repo needs reverting, no data moves, and the R2
bucket can sit there costing pennies while you work out what went wrong.

If the problem is the bucket rather than the Worker, the same rollback
applies — Pages does not read the bucket at all.

### The routing model, stated exactly

The Worker implements Cloudflare Pages' documented default asset routing
(`html_handling: "auto-trailing-slash"`), in this order:

```
/foo/index.html  -> 308 /foo/          canonicalize away the index
/index.html      -> 308 /
/foo.html        -> 308 /foo           canonicalize away the extension
/                -> index.html
/foo             -> foo.html, else foo/index.html via 308 /foo/
/foo/            -> foo/index.html, else foo.html via 308 /foo
anything else    -> 404.html at status 404
```

Query strings survive every redirect (`/rps.html?promo=mwe` → `/rps?promo=mwe`).

**The `.html` → pretty redirect is load-bearing at this site's scale.** 14,715
links in the served tree are written `href="/shows.html"` and 14,693
`href="/rps.html"`, so nearly every internal click already spends one 308 on
Pages today. This is not new cost, but it is worth knowing it is there — and
if it ever seems worth removing, the fix is a sitewide rewrite of those hrefs
to their pretty form, not a change to the router.

**The `.html`-before-directory order is also load-bearing**, and for a
sharper reason. Two stems exist as both a file and a directory with an index:

```
rps.html   ("Roleplays")   +  rps/index.html   ("Roleplays by year")
shows.html ("Shows")       +  shows/index.html ("Shows by year")
```

They are different pages, both linked, both live. `/rps` must be the flat
instrument and `/rps/` must be the by-year index. A router that preferred the
directory would still answer 200 — it would just quietly serve the wrong page
at a URL used thousands of times. This is the same coexistence the Hosting
section describes for `promotions.html` vs `promotions/`, and the parity test
asserts all four cases by body comparison, not by status code.

### Cache policy

`_headers` still decides, and it still says `Cache-Control: no-cache` for
`/*`, so the behavior on the wire after cutover is what it is today: browsers
may store, but must revalidate, and a matching revalidation costs a 304 with
no body. The Worker implements conditional requests (`If-None-Match`,
`If-Modified-Since`) and ranges natively through R2, which is what makes that
policy cheap rather than expensive — `_headers`' own comment names ETag 304s
as the reason the museum can update in place, and now they genuinely work.

Underneath, the Worker has per-class defaults for the day that `/*` rule is
ever narrowed: HTML and JSON `no-cache`, CSS/JS one hour, images and fonts one
day, everything else `no-cache`. All of them are marked `private`, because the
whole site sits behind an invite cookie and no shared cache should ever hold a
museum body. **`_headers` overrides every one of them** — the defaults only
surface where `_headers` is silent.

### Deliberate deviations from Pages

Four, all small, all flagged `DEVIATION` in `worker/index.mjs`:

1. **`_headers` applies to the gate page.** Pages' treatment of `_headers` for
   a Function-generated response is undocumented, so parity is unknowable
   rather than choosable; applying them is the safer half. The gate page picks
   up `X-Robots-Tag: noindex` (matching the `<meta>` it already carries) and
   the clacks lines, and keeps its own `no-store`.
2. **Dotfiles are not served.** In practice this is exactly one URL:
   `/.allowed_signers`, the SSH allowed-signers list, which Pages serves today
   and the Worker does not. It is repo metadata, not museum content. Flip
   `INCLUDE_DOTFILES` in `scripts/r2-sync.mjs` and `SERVE_DOTFILES` in
   `worker/index.mjs` to restore strict parity.
3. **Non-GET/HEAD requests to static paths answer 405**, where Pages would
   have served the asset. The site is static; nothing in it issues a non-GET
   request anywhere but `/gate`, which still works.
4. **`/_manifest.json` is refused.** The deploy manifest lives in the same
   bucket as the site and would otherwise be a complete path listing of a
   private archive at a guessable URL. The router 404s it as if it were not
   there.

### What parity means, honestly

`worker/test-parity.mjs` is green at **92/92** and `worker/test-sync.mjs` at
**28/28**, both run against real workerd and real (local) R2. But the
expectations divide into two kinds:

- **Verified** — everything derivable from this repo: the gate's cookie name,
  token format and status codes; the `_headers` policy including six discrete
  clacks lines on the wire; the served tree; the 404 page; the `rps`/`shows`
  collisions; content types; conditional and range requests.
- **Documented but not observed** — the `.html` → pretty 308 rules. They come
  from Cloudflare's documented Pages default, not from a captured live
  response, because the session that built this had neither a gate cookie nor
  Cloudflare credentials and the live site answers a stranger with the gate
  page.

Step 6's probe-and-diff is what converts the second category into the first,
and it takes about two minutes. Do not skip it. If a line differs, the fix
lives in `resolvePath()` in `worker/index.mjs` and nowhere else.

### Maintenance, after cutover

- **`worker/headers.json` is generated.** Never hand-edit it. `npm run stats`
  still stamps `_headers` (clacks, robots block) exactly as it does now; run
  `npm run worker:headers` after any `_headers` change and commit the result.
  `scripts/r2-sync.mjs` refuses to deploy if the bake is stale, and the CI
  workflow checks it before anything else, so this fails loudly rather than
  silently serving last month's memorial list.
- **A new memorial** still joins the clacks overhead automatically: add the
  row to `data/memorials.json`, `npm run stats`, `npm run worker:headers`,
  `npx wrangler deploy -c worker/wrangler.toml`. The Worker bundle is where
  those header lines now live, so a memorial needs a Worker redeploy, not just
  a bucket sync — that is the one new step in an otherwise unchanged routine.
- **Cost** is R2's Class A operations (writes) plus storage. An accession wave
  of a few hundred files is a few hundred writes; the free tier's monthly
  allowance is a million. Storage is measured in single-digit gigabytes.
- **`R2_DEPLOY`** is the arming variable for the CI path. Deleting it disarms
  the whole workflow, which is the rollback for step 8.
