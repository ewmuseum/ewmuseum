#!/usr/bin/env bash
# scripts/ops/publish-public.sh: publish a scanned snapshot of the museum's committed tree to the PUBLIC repository.
#
# THE RULINGS (the Janitor, archive of rulings 2026-10-07):
#   D429 "repos too, index from day one": the repositories open with the site, on a fresh history.
#   D433 "as recommended" (1A, 2a, 3 replace):
#     1A  the cycle keeps committing to the PRIVATE repository exactly as now; a separate, scanned step (this script)
#         publishes snapshots of the clean tree to the PUBLIC repository.
#     2a  the public repository leaves out CLAUDE.md, ops/lane-rules/ and the commit stub (ops/commit-stub.txt); it keeps the
#         site, its data, the scripts that build and check it, SCHEMA and the other docs, with workshop folder names scrubbed.
#   D463 (the Janitor, desk send 2026-10-09; hook c190), note verbatim: "I think curation.md should be limited to our private
#     repo and workshop and not served." So the snapshot ALSO leaves out CURATION.md and docs/LAW-INDEX.md -- the law finding
#     aid, which restates the principles and lists the withheld file's own anchors. The public law is curation.html.
#     3   the old personal GitHub account name is replaced by the museum's own organization everywhere it appears.
#
# WHAT IT DOES (nothing here touches the private repository, its working tree, its stamp or its remotes):
#   1. takes the private HEAD (every commit there passed the pre-commit hook, which refuses any tree the gate did not stamp
#      green; when the stamp file still holds HEAD's digest it says so);
#   2. exports it with `git archive` into a fresh directory under PUBLISH_WORK (outside both repositories);
#   3. removes the 2a exclusions (and any *.orig) and checks they are gone;
#   4. scans the export; ANY hit in a refusal class REFUSES (exit 3, nothing committed). The classes, never printing a match:
#        abs-local     the machine's own absolute paths (the museum, the workshop, $HOME, /home|/Users/<user>, the agent tmp),
#                      every file
#        home-path     any /home/<x>/ or /Users/<x>/ path, every non-served file
#        username      the local username as a word, every non-served file (the served prose may use the plain word)
#        workshop      a workshop path (archive/<x>, the workshop's own collection folders), every file; a served page's own
#                      address (promotions/<wing>/archive/...), a wing-relative page (archive/<x>.html) and a forum
#                      archive/index.php URL are not paths and never match
#        c111-data     the gate's PATH-SCRUB check (hook c111) on data/*.json and data/shards/*/*.json, both halves refusing
#        secret-shape  key/token shapes, private-key blocks, a high-entropy credential assignment, a key file by name
#        secret-value  the values of the local untracked secret files (.dev.vars, worker/.dev.vars, PUBLISH_SECRET_VALUES_FILE)
#        operator-word the word the operation once used for the Janitor (built below, never spelled), every non-served file
#        old-account   the old personal GitHub account name, by fingerprint (sha1), every file and the commit message
#        privacy-page  privacy-lookup.py `page` over every non-served file: a deny row (any deny status) with no covering
#                      allow and not memorial-exempt, or a takedown-library count; an annotation row (a deny wording that is
#                      not the exact word 'deny') defers to the exact deny row(s) for its term, checked on their own scope,
#                      and refuses only when no exact deny row for the term exists (land-check.py L-PRIVSTATUS; hook c164)
#        takedown      privacy-lookup.py `takedown`: a non-served file with any count refuses; a served file with a full-name
#                      hit refuses (bare/fused/residual counts on served pages are reported: those pages pass the live gate and
#                      the site already serves them); a full-name hit is the library's full-name form, plus an engine's "Mr."
#                      form only on its subject's own page (the engine's rewrite itself leaves a Mr. form on a page not about
#                      him: reported, not refused; hook c164); served files are scanned whole on the first snapshot and with --full,
#                      otherwise those new or changed since the last public snapshot
#        size          a file over 100 MB (GitHub refuses it)
#   5. writes ONE commit in the local public clone (PUBLIC_CLONE, a bare repository; created with `git init --bare` on the
#      first run, which makes a fresh root): its tree is exactly the scanned export, its parent the clone's main (later runs add
#      one commit on top; public history is never rewritten), authored and committed as the museum (the private repo's own
#      user.name/user.email, signed when the private repo signs), message "Museum snapshot <date> (<private HEAD short sha>)"
#      plus the attribution trailer the chain's HEAD commit carries;
#   6. prints what a push would send. Pushing is the separate flag --push: a plain fast-forward `git push origin main`, never
#      a force push, run only when the scans of this same run passed.
#
# Usage: publish-public.sh [--scan-only] [--full] [--keep] [--push]
#   --scan-only  scan, report, commit nothing.   --full  scan every served file with the takedown libraries.
#   --keep       keep the export directory.      --push  push main to the public remote after the commit (never default).
# Environment (no machine path is written in this file):
#   MUSEUM_ROOT          the private repository (default: the repository this script sits in)
#   WORKSHOP_ROOT        the workshop, for the privacy ledger (default: the folder named archive beside the repository)
#   PRIVACY_LOOKUP       privacy-lookup.py (required; the workshop's read-only lookup tool)
#   PUBLIC_CLONE         the local bare clone of the public repository (required; created on the first run)
#   PUBLIC_REMOTE_URL    the public repository's URL, set as the clone's origin when it is created (needed only for --push)
#   PUBLISH_WORK         where the export goes (default ${TMPDIR:-/tmp}; must be outside both repositories)
#   PUBLISH_SECRET_VALUES_FILE  optional: a local file, one secret value per line, scanned for and never printed
#   PUBLISH_MIN_FREE_GB  memory floor (default 4)     PUBLISH_JOBS  parallel takedown scanners (default 1)
#   PUBLISH_SKIP_SERVED_TAKEDOWN=1  allowed only with --scan-only (a quick read of the other classes)
# hook c164 (2026-10-08, the D460 launch scan): the annotation-row, engine Mr.-form and config.env rules above.
set -u
TAG=publish-public
die() { echo "$TAG: $*" >&2; exit "${RC:-1}"; }
SCAN_ONLY=0; FULL=0; KEEP=0; PUSH=0
for a in "$@"; do
  case "$a" in
    --scan-only) SCAN_ONLY=1 ;; --full) FULL=1 ;; --keep) KEEP=1 ;; --push) PUSH=1 ;;
    *) die "unknown argument $a (usage: [--scan-only] [--full] [--keep] [--push])" ;;
  esac
done
[ "$SCAN_ONLY" = 1 ] && [ "$PUSH" = 1 ] && die "--push and --scan-only together make no sense; nothing done"
[ "${PUBLISH_SKIP_SERVED_TAKEDOWN:-0}" = 1 ] && [ "$SCAN_ONLY" != 1 ] && die "PUBLISH_SKIP_SERVED_TAKEDOWN=1 is for --scan-only; nothing done"

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
M=$(readlink -f "${MUSEUM_ROOT:-$(git -C "$HERE" rev-parse --show-toplevel 2>/dev/null)}") || die "no museum repository"
[ -n "$M" ] && git -C "$M" rev-parse --git-dir >/dev/null 2>&1 || die "MUSEUM_ROOT is not a git repository; nothing done"
WS=$(readlink -f "${WORKSHOP_ROOT:-$(dirname "$M")/archive}")
[ -n "${PRIVACY_LOOKUP:-}" ] && [ -f "$PRIVACY_LOOKUP" ] || die "PRIVACY_LOOKUP (privacy-lookup.py) is not set or missing; nothing done"
[ -f "$WS/privacy/redaction-ledger.tsv" ] || die "no privacy ledger under WORKSHOP_ROOT; nothing done"
[ -n "${PUBLIC_CLONE:-}" ] || die "PUBLIC_CLONE (the local bare clone of the public repository) is not set; nothing done"
PC=$(readlink -m "$PUBLIC_CLONE")
WORKBASE=$(readlink -f "${PUBLISH_WORK:-${TMPDIR:-/tmp}}") || die "PUBLISH_WORK missing"
[ -d "$WORKBASE" ] || die "PUBLISH_WORK $WORKBASE is not a directory; nothing done"
inside() { case "$1/" in "$2"/*) return 0 ;; esac; return 1; }
inside "$WORKBASE" "$M" && die "PUBLISH_WORK is inside the private repository; nothing done"
inside "$WORKBASE" "$PC" && die "PUBLISH_WORK is inside the public clone; nothing done"
inside "$PC" "$M" && die "PUBLIC_CLONE is inside the private repository; nothing done"
inside "$M" "$PC" && die "the private repository is inside PUBLIC_CLONE; nothing done"
MINGB=${PUBLISH_MIN_FREE_GB:-4}
AVAIL_KB=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
[ "${AVAIL_KB:-0}" -ge $((MINGB * 1024 * 1024)) ] || die "less than ${MINGB} GB of memory available; nothing done (one heavy run at a time)"
FREE_KB=$(df -Pk "$WORKBASE" | awk 'NR==2 {print $4}')
[ "${FREE_KB:-0}" -ge $((6 * 1024 * 1024)) ] || die "less than 6 GB free under PUBLISH_WORK; nothing done"

# one run at a time per public clone
mkdir -p "$(dirname "$PC")" || die "cannot create $(dirname "$PC")"
exec 9>"$PC.publish.lock" || die "cannot open the lock"
flock -n 9 || die "another publish-public run holds $PC.publish.lock; nothing done"

STAMP=$(date +%Y%m%d-%H%M%S); DAY=$(date +%F)
HEAD_SHA=$(git -C "$M" rev-parse --verify HEAD) || die "no HEAD"
SHORT=$(git -C "$M" rev-parse --short=11 "$HEAD_SHA")
WORK=$(mktemp -d "$WORKBASE/publish-public-$STAMP-XXXX") || die "mktemp failed"
TREE=$WORK/tree; REPORT=$WORKBASE/publish-public-$STAMP.scan.tsv
cleanup() { if [ "$KEEP" = 1 ]; then echo "$TAG: export kept at $TREE"; else rm -rf "$WORK"; fi; }
trap cleanup EXIT
echo "$TAG: private HEAD $SHORT; export under $WORK"

# 1-2. export the committed tree, then check it against the gate stamp (the pre-commit hook's own digest)
mkdir "$TREE" && git -C "$M" archive --format=tar "$HEAD_SHA" | tar -x -C "$TREE" || RC=4 die "git archive failed; nothing committed"
GITDIR=$(git -C "$M" rev-parse --absolute-git-dir)
DIGEST=$(cd "$TREE" && git -C "$M" ls-tree -r -z --name-only "$HEAD_SHA" | LC_ALL=C sort -z | (cd "$TREE" && LC_ALL=C xargs -0 sha1sum) | sha1sum | cut -d' ' -f1)
if [ -f "$GITDIR/gate-ok" ] && [ "$(cat "$GITDIR/gate-ok")" = "$DIGEST" ]; then
  echo "$TAG: the green gate stamp holds exactly this tree"
else
  echo "$TAG: the gate stamp has moved on since HEAD's commit (a gate ran or is running); HEAD itself was stamped green when committed (the pre-commit hook refuses any other tree)"
fi

# 3. the 2a exclusions (D433), and any editor leftover
rm -rf "$TREE/CLAUDE.md" "$TREE/ops/lane-rules" "$TREE/ops/commit-stub.txt"
rm -rf "$TREE/CURATION.md" "$TREE/docs/LAW-INDEX.md"   # hook c190 (the Janitor's D463): the law stays private; curation.html is the public law
find "$TREE" -name '*.orig' -type f -delete
rm -f "$TREE"/js/r/*.mp4   # hook c212: the easter-egg videos stay off the public repository (the listener code may go)
# hook c164 (D433 2a, workshop folder names scrubbed): ops/config.env's WAVE_TREES default lists the workshop's own wave folders.
# The public snapshot carries it EMPTY (a clone with no workshop applies no waves, the documented no-op; a clone that has one
# sets WAVE_TREES in its environment). The private file is untouched. Refuses unless the default is found exactly once.
if [ -f "$TREE/ops/config.env" ]; then
  python3 -I - "$TREE/ops/config.env" <<'PYW' || RC=4 die "ops/config.env: the WAVE_TREES default was not found exactly once; nothing committed"
import re, sys
p = sys.argv[1]; t = open(p, encoding="utf-8").read()
rx = re.compile(r'WAVE_TREES="\$\{WAVE_TREES:-(.*?)\}"', re.S)
if len(rx.findall(t)) != 1: sys.exit(1)
open(p, "w", encoding="utf-8").write(rx.sub(lambda m: 'WAVE_TREES="${WAVE_TREES:-}"', t))
PYW
fi
for x in CLAUDE.md ops/lane-rules ops/commit-stub.txt CURATION.md docs/LAW-INDEX.md; do [ -e "$TREE/$x" ] && RC=4 die "exclusion $x still present; nothing committed"; done   # hook c190
[ -n "$(find "$TREE" -name '*.orig' -print -quit)" ] && RC=4 die "an .orig file is still present; nothing committed"
[ -n "$(find "$TREE/js/r" -name '*.mp4' -print -quit 2>/dev/null)" ] && RC=4 die "an easter-egg video under js/r/ is still present; nothing committed"   # hook c212
NFILES=$(find "$TREE" \( -type f -o -type l \) | wc -l)
echo "$TAG: export ready, $NFILES files (CLAUDE.md, ops/lane-rules/, ops/commit-stub.txt, CURATION.md, docs/LAW-INDEX.md left out)"

# the commit message (scanned with the tree): the chain's attribution trailer, read from the private HEAD commit
MSG=$WORK/message.txt
{ printf 'Museum snapshot %s (%s)\n\n' "$DAY" "$SHORT"
  # hook c162 (the Janitor's D461): the co-author line only; the session link never goes public
  git -C "$M" log -1 --format=%B "$HEAD_SHA" | grep -E '^Co-Authored-By: ' ; } > "$MSG"

# the public clone (created on the first run: a fresh root)
if [ ! -e "$PC" ]; then
  [ "$SCAN_ONLY" = 1 ] || { git init -q --bare -b main "$PC" || RC=5 die "git init --bare failed"
    [ -n "${PUBLIC_REMOTE_URL:-}" ] && git --git-dir="$PC" remote add origin "$PUBLIC_REMOTE_URL"
    echo "$TAG: created the public clone (bare, empty: the first snapshot will be its root)"; }
fi
PARENT=""
if [ -d "$PC" ]; then
  git --git-dir="$PC" rev-parse --is-bare-repository 2>/dev/null | grep -qx true || RC=5 die "PUBLIC_CLONE is not a bare git repository; nothing done"
  PARENT=$(git --git-dir="$PC" rev-parse -q --verify refs/heads/main 2>/dev/null || true)
fi

# which served files the takedown libraries read: all on the first snapshot or with --full, else new/changed since main
CHANGED=$WORK/changed.z
if [ -n "$PARENT" ] && [ "$FULL" != 1 ]; then
  python3 -I - "$M" "$HEAD_SHA" "$PC" "$PARENT" "$CHANGED" <<'PY' || RC=4 die "changed-file list failed"
import subprocess, sys
M, head, pc, parent, out = sys.argv[1:]
def tree(args):
    d = {}
    for rec in subprocess.run(args, capture_output=True, check=True).stdout.split(b"\0"):
        if rec:
            meta, path = rec.split(b"\t", 1); d[path] = meta.split()[2]
    return d
new = tree(["git", "-C", M, "ls-tree", "-r", "-z", head])
old = tree(["git", "--git-dir", pc, "ls-tree", "-r", "-z", parent])
# hook c190 (the Janitor's D463): the two withheld law files are filtered here too, so an incremental snapshot never offers
# them to the takedown and privacy scans as changed paths, and never carries them into the public tree.
left_out = lambda p: p in (b"CLAUDE.md", b"ops/commit-stub.txt", b"CURATION.md", b"docs/LAW-INDEX.md") or p.startswith(b"ops/lane-rules/") or p.endswith(b".orig") or (p.startswith(b"js/r/") and p.endswith(b".mp4"))   # hook c212
open(out, "wb").write(b"".join(p + b"\0" for p, s in new.items() if old.get(p) != s and not left_out(p)))
PY
  echo "$TAG: incremental: $(tr -cd '\0' < "$CHANGED" | wc -c) path(s) new or changed since the last public snapshot"
else
  : > "$CHANGED"; echo "$TAG: full takedown read of every served file (first snapshot or --full)"
fi

# 4. the scans
export TREE M WS PRIVACY_LOOKUP REPORT MSG CHANGED FULL PARENT
export SKIP_SERVED_TD=${PUBLISH_SKIP_SERVED_TAKEDOWN:-0} JOBS=${PUBLISH_JOBS:-1} SECRET_FILE=${PUBLISH_SECRET_VALUES_FILE:-}
nice -n 10 python3 -I - <<'PY'
import collections, hashlib, math, os, pwd, re, sys
sys.dont_write_bytecode = True
T, M, WS, PL, REPORT, MSG = (os.environ[k] for k in ("TREE", "M", "WS", "PRIVACY_LOOKUP", "REPORT", "MSG"))
FULL = os.environ["FULL"] == "1"; PARENT = os.environ.get("PARENT", ""); SKIP_TD = os.environ["SKIP_SERVED_TD"] == "1"
JOBS = max(1, int(os.environ.get("JOBS") or 1))
hits = []                                   # (class, file, line, count): never the matched text
def hit(c, f, ln, n=1): hits.append((c, f, ln, n))
adv = collections.Counter()

# served / not served: the deploy's own rule (.assetsignore top-level names, dotfiles, functions/ and worker/)
ign = {"functions", "worker"}
try:
    for l in open(os.path.join(T, ".assetsignore"), encoding="utf-8"):
        l = l.strip()
        if l and not l.startswith("#"): ign.add(l.rstrip("/"))
except OSError: pass
def served(rel):
    top = rel.split("/")[0]
    return not (top in ign or top.startswith("."))

# runtime-derived machine strings (this file spells none of them)
user = pwd.getpwuid(os.getuid()).pw_name
home = os.path.realpath(os.path.expanduser("~"))
loc = {os.path.realpath(M), os.path.realpath(WS), os.path.dirname(os.path.realpath(M)), home, "/home/" + user, "/Users/" + user,
       "/tmp/claude-%d" % os.getuid()}
par = os.path.dirname(os.path.realpath(M))
if par.startswith(home + "/") and par.count("/") - home.count("/") >= 2:
    loc.add("/".join(par.split("/")[-2:]))            # the museum's parent, relative to home (two levels), e.g. a/b
loc = sorted((x for x in loc if len(x) >= 6 and x != "/"), key=len, reverse=True)
ABS_LOCAL = re.compile("|".join(re.escape(x) for x in loc))
HOME_PATH = re.compile(r"(?<![\w.~%-])/(?:home|Users)/[A-Za-z_][\w.-]*/")
USERNAME = re.compile(r"(?<![\w])" + re.escape(user) + r"(?![\w])", re.I) if len(user) >= 4 else None
WSP_NAMES = r"(?:archive|url-walk|ops-scratch|fwrestling-census|direct-collected|wwv-vault|usenet-retro|usenet-collected|usenet-rspwf-late|museum-scratch|prose-waves|frontier-log|ia-overnight|geocities-torrent)"
WORKSHOP = re.compile(r"(?<![\w./:@~%-])" + WSP_NAMES + r"/[^\s\"'`<>;,()\]\[{}|\\]*")
def workshop_ok(t):
    t = t.rstrip(".:")
    return re.match(r"^archive/[^/]+\.html?$", t) or t.startswith("archive/index.php") or t in ("archive/",)
# the gate's c111 check, as registry-validate.mjs spells it (PS_ABS, PS_WSP), both halves refusing here
PS_LB = r"(?:(?<![\w./:@~%-])|(?<=\\[nt]))"
PS_ABS = re.compile(PS_LB + r"/(?:home|tmp|mnt|var|root|Users)/[^\s\";,()<>]*")
PS_WSP = re.compile(PS_LB + r"(?:archive|url-walk|ops-scratch|fwrestling-census|direct-collected|wwv-vault)/[^\s\";,()<>]*")
SECRET = re.compile(r"(?<![\w-])(?:sk-[A-Za-z0-9_-]{20,}|sk-ant-[\w-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{40,}|glpat-[\w-]{20,}"
                    r"|AKIA[0-9A-Z]{16}|xox[baprs]-[\w-]{10,}|AIza[\w-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY-----)")
CRED = re.compile(r"(?i)\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|auth)\b[\"']?\s*[:=]\s*[\"']([A-Za-z0-9+/=_.-]{20,})[\"']")
def high_entropy(v):
    if not (re.search(r"\d", v) and re.search(r"[a-z]", v) and re.search(r"[A-Z]", v)): return False
    c = collections.Counter(v); return -sum(n / len(v) * math.log2(n / len(v)) for n in c.values()) >= 3.5
KEYFILE = re.compile(r"(?:^|/)(?:\.env(?:\..*)?|\.dev\.vars|id_(?:rsa|ed25519|ecdsa)|.*\.pem|.*\.p12|.*\.key)$")
OPWORD = re.compile(r"(?<![\w])" + "found" + "ers?" + r"(?![\w])", re.I)
# the old personal GitHub account name (D433 item 3), by sha1 of the lowercased name: the name itself is not written here
OLD_ACCOUNT_FP = {"31bb988b1393057e02cbedc230ca3c5cb64a7151"}
ACCT_SHAPE = re.compile(r"(?<![\w-])[A-Za-z]{3,20}[0-9]{2,6}(?![\w-])")
# secret values: the local untracked secret files and the optional list, never printed
vals = set()
for f in (os.path.join(M, ".dev.vars"), os.path.join(M, "worker", ".dev.vars")):
    try:
        for l in open(f, encoding="utf-8"):
            if "=" in l and not l.lstrip().startswith("#"):
                v = l.split("=", 1)[1].strip().strip("\"'")
                if len(v) >= 8: vals.add(v)
    except OSError: pass
if os.environ.get("SECRET_FILE"):
    try:
        for l in open(os.environ["SECRET_FILE"], encoding="utf-8"):
            v = l.strip()
            if len(v) >= 6 and not v.startswith("#"): vals.add(v)
    except OSError: print("publish-public: PUBLISH_SECRET_VALUES_FILE unreadable", file=sys.stderr); sys.exit(2)
VALS = re.compile("|".join(re.escape(v) for v in sorted(vals, key=len, reverse=True))) if vals else None

def lines_of(t, rx):
    out = collections.Counter()
    for m in rx.finditer(t): out[t.count("\n", 0, m.start()) + 1] += 1
    return out
def scan_text(rel, t, is_served, data_check):
    def each(c, rx, keep=None):
        n = collections.Counter()
        for m in rx.finditer(t):
            if keep and not keep(m): continue
            n[t.count("\n", 0, m.start()) + 1] += 1
        for ln, k in sorted(n.items()): hit(c, rel, ln, k)
    each("abs-local", ABS_LOCAL)
    each("workshop", WORKSHOP, lambda m: not workshop_ok(m.group(0)))
    each("secret-shape", SECRET)
    each("secret-shape", CRED, lambda m: high_entropy(m.group(1)))
    if VALS: each("secret-value", VALS)
    each("old-account", ACCT_SHAPE, lambda m: hashlib.sha1(m.group(0).lower().encode()).hexdigest() in OLD_ACCOUNT_FP)
    if not is_served:
        each("home-path", HOME_PATH)
        if USERNAME: each("username", USERNAME)
        each("operator-word", OPWORD)
    if data_check:
        each("c111-data", PS_ABS)
        each("c111-data", PS_WSP, lambda m: not re.match(r"^archive/[^/]+\.html?$", m.group(0).rstrip(".:")) and not m.group(0).startswith("archive/index.php"))

nonserved, servedf = [], []
for root, ds, fs in os.walk(T):
    ds.sort()
    for f in sorted(fs):
        p = os.path.join(root, f); rel = os.path.relpath(p, T)
        if KEYFILE.search(rel): hit("secret-shape", rel, 0)
        if os.path.islink(p):
            tgt = os.readlink(p)
            if os.path.isabs(tgt) or not os.path.realpath(p).startswith(os.path.realpath(T) + "/"): hit("abs-local", rel, 0)
            continue
        sz = os.path.getsize(p)
        if sz > 100 * 1024 * 1024: hit("size", rel, 0)
        s = served(rel); (servedf if s else nonserved).append(rel)
        b = open(p, "rb").read()
        if b"\0" in b[:8000]: continue
        dc = rel.startswith("data/") and rel.endswith(".json") and (rel.count("/") == 1 or rel.startswith("data/shards/"))
        scan_text(rel, b.decode("utf-8", "replace"), s, dc)
msg = open(MSG, encoding="utf-8").read()
scan_text("(commit message)", msg, False, False)

# privacy-lookup.py, imported once (the workshop's read-only tool: it never returns a term, only fingerprints and counts; the
# takedown libraries are reached only through its own import)
import importlib.util, multiprocessing as mp
os.environ["MUSEUM_ROOT"] = T; os.environ["WORKSHOP_ROOT"] = WS; os.chdir(T)
try:
    _spec = importlib.util.spec_from_file_location("privacy_lookup", PL); pl = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(pl)
    LROWS = pl.ledger(); MEM = pl.memorial_names()
    ROWBY = {(x.src, x.line): x for x in LROWS}; EXACT_DENY = {x.low for x in LROWS if x.status == "deny"}   # hook c164
except BaseException as e:
    print("publish-public: privacy-lookup.py failed to load (%s)" % type(e).__name__, file=sys.stderr); sys.exit(2)
def libs_of(rel):
    # (hits_full, hits_bare, fused, residual) per library, or None when a library failed to import or scan
    try: rows = pl.lib_rows(rel, pl.page_text(rel), pl.served_path(rel))
    except BaseException: return None
    out = []
    for r in rows:
        v = r[2:6]
        if any(isinstance(x, str) and (x.endswith("FAILED") or ":" in x) for x in v): return None
        out.append(tuple(x if isinstance(x, int) else 0 for x in v))
    return out
def td_one(rel): return rel, libs_of(rel)
def served_full(rel):
    # hook c164: on a served page, an engine's (mack/matw) "Mr." form is a full-name hit only on its subject's own page: the
    # engine's own rewrite leaves it on a page not about him ("MR LEFT"). Its full-name form always counts; vondoom and ayj as
    # before. -> (full, mr_left), or (None, 0) when a library failed to import or scan.
    try:
        text = pl.page_text(rel); sp = pl.served_path(rel); full = left = 0
        for label, kind, h in pl.libs():
            if kind == "err": return None, 0
            d = pl.lib_scan(label, kind, h, text); f = d["hits_full"] if isinstance(d["hits_full"], int) else 0
            if kind == "eng":
                mr = pl._n(getattr(h, "MR_RE", None), text)
                with pl._quiet(): his = bool(h.his_page(text, sp))
                if mr and not his: f -= mr; left += mr
            full += f
        return full, left
    except BaseException: return None, 0
def td_record(rel, res, strict):
    if res is None: hit("takedown", rel, 0); return
    full = sum(x[0] for x in res); rest = sum(sum(x[1:]) for x in res)
    if strict and (full or rest): hit("takedown", rel, 0, full + rest)
    elif not strict:
        if full:
            full, left = served_full(rel)
            if full is None: hit("takedown", rel, 0); return
            if left: adv["served pages with an engine's Mr. form on a page not about its subject (the engine leaves it; reported, not refused)"] += 1
        if full: hit("takedown", rel, 0, full)
        if rest: adv["served pages with takedown bare/fused/residual counts (they pass the live gate; reported, not refused)"] += 1

# page (ledger rows) + takedown over every non-served file: a deny row (any deny status) with no covering allow and not
# memorial-exempt refuses; any takedown-library count refuses
for rel in nonserved:
    try:
        for r in pl.page_rows(LROWS, MEM, rel, pl.served_paths(rel), pl.page_text(rel)):
            st, mem, cover = str(r[6]), r[9], r[12]
            if st.lower().startswith("deny") and cover == "none" and not mem:
                # hook c164: an annotation row defers to the exact deny row(s) for its term (land-check.py L-PRIVSTATUS)
                if st.strip() != "deny" and ROWBY.get((r[1], r[2])) is not None and ROWBY[(r[1], r[2])].low in EXACT_DENY:
                    adv["annotation deny rows on non-served files deferred to their exact deny row (land-check L-PRIVSTATUS)"] += 1
                    continue
                hit("privacy-page", rel, 0, 1)
    except BaseException: hit("privacy-page", rel, 0)
    td_record(rel, libs_of(rel), True)
# takedown over the served files in scope: a full-name hit refuses
changed = set(x.decode("utf-8", "surrogateescape") for x in open(os.environ["CHANGED"], "rb").read().split(b"\0") if x)
first = not PARENT
td_served = [] if SKIP_TD else [r for r in servedf if FULL or first or r in changed]
if JOBS > 1 and len(td_served) > 200:
    with mp.get_context("fork").Pool(JOBS) as pool:
        for rel, res in pool.imap_unordered(td_one, td_served, chunksize=64): td_record(rel, res, False)
else:
    for rel in td_served: td_record(rel, libs_of(rel), False)
if SKIP_TD: adv["served takedown read SKIPPED (--scan-only quick read)"] += 1

with open(REPORT, "w", encoding="utf-8") as o:
    o.write("class\tfile\tline\tcount\n")
    for h in hits: o.write("%s\t%s\t%s\t%s\n" % h)
by = collections.Counter(); files = collections.defaultdict(set)
for c, f, ln, n in hits: by[c] += n; files[c].add(f)
print("publish-public: scanned %d non-served + %d served files (takedown libraries read %d served); report %s"
      % (len(nonserved), len(servedf), len(td_served), REPORT))
for c in sorted(by): print("  REFUSE %-14s %6d hit(s) in %d file(s)" % (c, by[c], len(files[c])))
for k, n in sorted(adv.items()): print("  note   %s: %d" % (k, n))
sys.exit(3 if hits else 0)
PY
SRC=$?
if [ $SRC -ne 0 ]; then
  [ $SRC -eq 3 ] && { echo "$TAG: REFUSED: the export has scan hits (classes above; file:line in the report, no match text). Nothing committed."; exit 3; }
  echo "$TAG: the scan failed (rc $SRC); nothing committed"; exit 4
fi
echo "$TAG: 0 scan hits"
[ "$SCAN_ONLY" = 1 ] && { echo "$TAG: --scan-only: nothing committed"; exit 0; }

# 5. one commit in the public clone: exactly the scanned tree, on top of main (or a fresh root)
export GIT_INDEX_FILE=$WORK/index
G() { git --git-dir="$PC" --work-tree="$TREE" -c core.autocrlf=false -c core.safecrlf=false "$@"; }
(cd "$TREE" && G add -A -f .) || RC=5 die "git add failed; nothing committed"
NEWTREE=$(G write-tree) || RC=5 die "write-tree failed; nothing committed"
NIDX=$(G ls-files | wc -l)
[ "$NIDX" = "$NFILES" ] || RC=5 die "the index holds $NIDX files, the export $NFILES; nothing committed"
NAME=$(git -C "$M" config user.name); MAIL=$(git -C "$M" config user.email)
[ -n "$NAME" ] && [ -n "$MAIL" ] || RC=5 die "the private repository has no museum user.name/user.email; nothing committed"
SIGN=(); SFLAG=()   # commit-tree does not read commit.gpgsign: the private repo's signing setup is passed and -S asked for
if [ "$(git -C "$M" config --bool commit.gpgsign 2>/dev/null)" = true ]; then
  SIGN=(-c "gpg.format=$(git -C "$M" config gpg.format || echo openpgp)" -c "user.signingkey=$(git -C "$M" config user.signingkey)"); SFLAG=(-S)
fi
if [ -n "$PARENT" ] && [ "$(git --git-dir="$PC" rev-parse "$PARENT^{tree}")" = "$NEWTREE" ]; then
  echo "$TAG: the public main already holds exactly this tree; no new commit"
  NEWC=$PARENT
else
  PARG=(); [ -n "$PARENT" ] && PARG=(-p "$PARENT")
  NEWC=$(GIT_AUTHOR_NAME="$NAME" GIT_AUTHOR_EMAIL="$MAIL" GIT_COMMITTER_NAME="$NAME" GIT_COMMITTER_EMAIL="$MAIL" \
         git --git-dir="$PC" -c "user.name=$NAME" -c "user.email=$MAIL" "${SIGN[@]}" commit-tree "${SFLAG[@]}" "$NEWTREE" "${PARG[@]}" -F "$MSG") \
    || RC=5 die "commit-tree failed; nothing committed"
  git --git-dir="$PC" update-ref -m "$TAG $SHORT" refs/heads/main "$NEWC" "$PARENT" || RC=5 die "update-ref failed (main moved?); nothing committed"
  [ -z "$PARENT" ] && echo "$TAG: committed the FIRST snapshot (a fresh root)" || echo "$TAG: committed one snapshot on top of ${PARENT:0:11}"
fi
unset GIT_INDEX_FILE

# 6. what a push would send
PUB=$(git --git-dir="$PC" rev-parse -q --verify refs/published/main 2>/dev/null || true)
RANGE=main; [ -n "$PUB" ] && RANGE="$PUB..main"
echo "$TAG: public clone $PC"
echo "$TAG: origin $(git --git-dir="$PC" remote get-url origin 2>/dev/null || echo '(none set)')"
echo "$TAG: commits a push would send ($RANGE):"
git --git-dir="$PC" log --format='  %h %an <%ae> %ad %s' --date=short "$RANGE"
if [ -n "$PARENT" ] && [ "$NEWC" != "$PARENT" ]; then
  echo "$TAG: this snapshot vs the last: $(git --git-dir="$PC" diff-tree --no-commit-id --shortstat -r "$PARENT" "$NEWC")"
fi
echo "$TAG: tree $NEWTREE, $NIDX files"
if [ "$PUSH" != 1 ]; then
  echo "$TAG: not pushed. To push (a plain fast-forward, never forced): $0 --push   (or git --git-dir=$PC push origin main)"
  exit 0
fi
git --git-dir="$PC" remote get-url origin >/dev/null 2>&1 || RC=6 die "--push: the clone has no origin (set PUBLIC_REMOTE_URL before the first run, or git remote add origin); not pushed"
git --git-dir="$PC" push origin refs/heads/main:refs/heads/main || RC=6 die "push failed (never forced; if the remote moved, fetch and look before anything else); not pushed"
git --git-dir="$PC" update-ref refs/published/main "$NEWC"
echo "$TAG: pushed main ($(git --git-dir="$PC" rev-parse --short=11 main)) to origin"
exit 0
