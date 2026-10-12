# Structural guardrails — smoke test plan (2026-09-03)

Proves each of the four `validate.mjs` checks, the `r2-sync.mjs` refusal,
and the `privacy-check.mjs` warning actually fire on a broken input AND
pass on the clean tree — without ever running `npm run gate` (that chain
regenerates + commits-adjacent state and is the coordinator's own gate to
run, not a smoke test's).

**Setup, once, before any case below.** These patches live at
`$WORKSHOP_ROOT/patches/guardrails-2026-09-03/new/scripts/` (and `docs/PROCESS.md`)
in the private workshop (`$WORKSHOP_ROOT`, ops/config.env). Every command runs from the real
museum checkout (`cd` there first) but INVOKES the patched script by its
absolute path in the patch directory — so the patched code runs against
the real, live tree without ever overwriting the museum's own copy of the
script. `$MUSEUM` and `$PATCH` below are placeholders for those two
absolute paths.

```bash
MUSEUM="${MUSEUM_ROOT:?set MUSEUM_ROOT to the museum checkout}"
PATCH="${WORKSHOP_ROOT:?set WORKSHOP_ROOT to the workshop}/patches/guardrails-2026-09-03/new"
```

None of these cases need `npm install` — the museum has no dependencies
(`validate.mjs`'s own header: "No framework, no dependencies").

---

## A(i) — TOP-LEVEL ALLOWLIST

**Pass case (the live tree, right now):**

```bash
cd "$MUSEUM"
node "$PATCH/scripts/validate.mjs"; echo "exit=$?"
```

Expected on the tree as found 2026-09-03: exit 1, with (among any other
findings) four `top-level path "…" is not in scripts/deploy-allowlist.mjs's
allowlist` lines naming `GAVELS.md`, `JOURNAL.md`, `extract.py`, and
`scratch_ewa_show_text.json` — four stray top-level files that landed in
the same commit that removed the 62 scratch directories. **This is a live
finding, not a smoke-test fixture** — see this lane's report. Once those
four are cleaned up (moved to `archive/`, `git rm`'d from the museum repo),
re-running the same command should show zero `top-level path` lines.

**Fail case (a fresh violation, proving the check fires on a NEW shape,
not just the one already found):**

```bash
cd "$MUSEUM"
mkdir -p scratch-smoketest-DELETE-ME
echo '{}' > scratch-smoketest-DELETE-ME/dump.json
node "$PATCH/scripts/validate.mjs" 2>&1 | grep 'scratch-smoketest-DELETE-ME'
# expect: a line naming "scratch-smoketest-DELETE-ME"
rm -rf scratch-smoketest-DELETE-ME   # clean up immediately — do not commit this
```

Note: `scratch-smoketest-DELETE-ME/` matches the OLD `.gitignore` rule
(`scratch-*/`) so `git status` won't even show it as untracked — proving
the allowlist check is doing real work independent of `.gitignore`, since
`validate.mjs`'s own file list comes from `git ls-files -co
--exclude-standard`, which DOES skip gitignored paths... **so this
specific fixture (a name matching `scratch-*/`) will NOT trigger the
check** — that is itself the intended lesson: the allowlist's git-based
walk shares `.gitignore`'s blind spot for genuinely-ignored paths (which
is fine — those never reach `git add` or the bucket either). Use the
UNDERSCORE fixture below instead to prove the check catches a shape
`.gitignore` does NOT already cover:

```bash
cd "$MUSEUM"
echo '{}' > scratch_smoketest_DELETE_ME.json    # underscore, not the ignored "scratch-*/" shape
git add -N scratch_smoketest_DELETE_ME.json     # intent-to-add, so git ls-files -co sees it without staging content
node "$PATCH/scripts/validate.mjs" 2>&1 | grep 'scratch_smoketest_DELETE_ME'
# expect: a line naming "scratch_smoketest_DELETE_ME.json"
git rm -f --cached scratch_smoketest_DELETE_ME.json >/dev/null   # un-stage
rm -f scratch_smoketest_DELETE_ME.json                            # delete — do not commit this
```

## A(ii) — DOC-CLASS REQUIRED

**Pass case (live tree):** the same `validate.mjs` run above currently
prints ZERO `data-doc-class` lines — confirms the 2026-09-03 DOC-CLASS
FINAL TABLE stamping pass is complete and holding.

**Fail case:**

```bash
cd "$MUSEUM"
cp promotions/4ww/archive/history-envidia.html /tmp/history-envidia.bak.html   # save a copy, restore after
sed -i 's/data-doc-class="card"//' promotions/4ww/archive/history-envidia.html
node "$PATCH/scripts/validate.mjs" 2>&1 | grep 'history-envidia'
# expect: "...served document carries a provenance paragraph/Source citation but no data-doc-class attribute..."
cp /tmp/history-envidia.bak.html promotions/4ww/archive/history-envidia.html  # RESTORE — do not leave this edited
git diff --stat -- promotions/4ww/archive/history-envidia.html               # must print nothing
```

Also prove the "invalid value" branch:

```bash
sed -i 's/data-doc-class="card"/data-doc-class="bogus"/' promotions/4ww/archive/history-envidia.html
node "$PATCH/scripts/validate.mjs" 2>&1 | grep 'history-envidia'
# expect: 'data-doc-class="bogus" is not one of the v109(a) classes'
cp /tmp/history-envidia.bak.html promotions/4ww/archive/history-envidia.html  # RESTORE
git diff --stat -- promotions/4ww/archive/history-envidia.html               # must print nothing
```

## A(iii) — NO SERVED CREDITS/GUESTBOOK

**Pass-through-fail case (the live tree, right now):**

```bash
cd "$MUSEUM"
node "$PATCH/scripts/validate.mjs" 2>&1 | grep 'mass-acknowledgement'
```

Expected: one line — `promotions/rspw/archive/mass-acknowledgement-1989-12-04.html:
data-doc-class="credits" is served without data-janitor-served="<date>"…`.
**This is a live finding** (the page is HELD for the Janitor, not yet
ruled on — see the lane report) — it is expected to keep firing until
either the Janitor's marker is stamped or the page is withdrawn.

**Clears when marked (verify the marker actually silences it, without
touching the real file):**

```bash
cd "$MUSEUM"
cp promotions/rspw/archive/mass-acknowledgement-1989-12-04.html /tmp/rspw.bak.html
sed -i 's/data-doc-class="credits"/data-doc-class="credits" data-janitor-served="2026-09-03"/' \
  promotions/rspw/archive/mass-acknowledgement-1989-12-04.html
node "$PATCH/scripts/validate.mjs" 2>&1 | grep -c 'mass-acknowledgement'
# expect: 0
cp /tmp/rspw.bak.html promotions/rspw/archive/mass-acknowledgement-1989-12-04.html  # RESTORE
git diff --stat -- promotions/rspw/archive/mass-acknowledgement-1989-12-04.html     # must print nothing
```

## A(iv) — WITHDRAWN-PAGE CONSISTENCY

**Pass case (live tree):** zero `does not resolve to a data/shards/...`
style lines from `validate.mjs`'s own new block on the current tree
(confirmed 2026-09-03 — see lane report; the 7 withdrawn-page rows the
brief anticipated have already been cleaned up by earlier passes).

**Fail case:**

```bash
cd "$MUSEUM"
SHOW_FILE=data/shards/4ww/shows.json
cp "$SHOW_FILE" /tmp/4ww-shows.bak.json
node -e '
const fs=require("fs");
const p=process.argv[1];
const rows=JSON.parse(fs.readFileSync(p,"utf8"));
rows[0].page = "/promotions/4ww/archive/DOES-NOT-EXIST-DELETE-ME.html";
fs.writeFileSync(p, JSON.stringify(rows, null, 2));
' "$SHOW_FILE"
node "$PATCH/scripts/validate.mjs" 2>&1 | grep 'DOES-NOT-EXIST-DELETE-ME'
# expect: a line naming data/shards/4ww/shows.json and the missing page
cp /tmp/4ww-shows.bak.json "$SHOW_FILE"   # RESTORE
git diff --stat -- "$SHOW_FILE"           # must print nothing
```

## B — r2-sync.mjs REFUSAL

`r2-sync.mjs`'s own gate-guard blocks a non-dry-run without a green gate
stamp, so exercise the refusal at the function level (no network, no
wrangler, no risk of touching the real bucket):

```bash
cd "$MUSEUM"
node --input-type=module -e '
process.argv.push("--dry-run");
const m = await import("'"$PATCH"'/scripts/r2-sync.mjs");
const ex = m.buildExclusions();
const keys = m.walkTree(ex, []);
const bad = m.disallowedTopLevel(keys);
console.log("disallowed:", bad.size, [...bad.keys()]);
'
```

Expected on the live tree right now: `disallowed: 4 [ ... four names ... ]`
— note `walkTree` (unlike `validate.mjs`'s git-based walk) SKIPS symlinks
by design (`r2-sync.mjs`'s own comment: "a symlink is not a file to
publish"), so this must run against a real checkout, not a symlink farm.

Full end-to-end proof (still no network — `--dry-run` never shells out to
wrangler for a put/delete, only for the headers pre-check, so this is
still read-only against the bucket):

```bash
cd "$MUSEUM"
node "$PATCH/scripts/r2-sync.mjs" --dry-run 2>&1 | grep -A5 'r2-sync REFUSED'
```

Expected: the refusal block naming the same four paths, process exits 1
BEFORE any hashing/diffing output — proving the refusal runs ahead of any
work, not just ahead of the actual uploads.

## C — privacy-check.mjs forename+initial WARNING (never fails)

```bash
cd "$MUSEUM"
node "$PATCH/scripts/privacy-check.mjs" > /tmp/privacy-smoke.log 2>&1
echo "exit=$?"   # expect 0 (or the pre-existing ledger-scan verdict — this
                  # warning never changes the exit code either way)
grep -A2 'forename+initial-shaped' /tmp/privacy-smoke.log
```

Expected: `privacy-check: 18 global deny row(s) are forename+initial-shaped
…` (count as of 2026-09-03; grows/shrinks as the ledger changes) followed
by one `⚠ "<term>" [ledger]` line per row — and the exit code is whatever
the ledger/disclosure checks alone would have produced, unaffected by this
block. To prove it truly never fails, temporarily add an obviously
forename+initial row to a THROWAWAY copy of the ledger (never the real
one) and confirm the process still exits 0:

```bash
cp "$WORKSHOP_ROOT/privacy/redaction-ledger.tsv" /tmp/ledger-smoke.tsv
printf 'Zzz Q\treal-name\tdeny\t\t2026-09-03 smoke test\tfixture row, never merged\n' >> /tmp/ledger-smoke.tsv
PRIVACY_LEDGER=/tmp/ledger-smoke.tsv node "$PATCH/scripts/privacy-check.mjs" > /tmp/privacy-smoke2.log 2>&1
echo "exit=$?"
grep 'Zzz Q' /tmp/privacy-smoke2.log
rm -f /tmp/ledger-smoke.tsv /tmp/privacy-smoke2.log /tmp/privacy-smoke.log
```

Expect the exit code to match a plain run with the real ledger (0 unless
the real ledger scan itself is already red for an unrelated reason) and a
line naming `"Zzz Q"` under the forename+initial warning — never under
`PRIVACY-FAIL`.

---

## Housekeeping

Every fixture above either (a) operates on a file OUTSIDE the museum tree
(`/tmp/...`), or (b) edits a real museum file IN PLACE and is immediately
followed by its own restore + a `git diff --stat` check that must print
nothing before moving to the next case. Run cases in order; do not skip a
restore step. None of these cases stage, commit, or push anything.
