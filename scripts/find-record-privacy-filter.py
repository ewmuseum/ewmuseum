#!/usr/bin/env python3
"""scripts/find-record-privacy-filter.py -- which lines of data/find-record-index.json would the gate's privacy scan or a takedown
library flag? (D448, hook c136; lane FIND-RECORD-ROUTE, 2026-10-08, after the coordinator's privacy-lookup run on the first cut.)

Called by scripts/build-find-record-index.mjs, which gives it the index text on stdin:

    python3 -I scripts/find-record-privacy-filter.py [--root MUSEUM] [--served data/find-record-index.json] < index-text

It answers with ONE JSON object on stdout and NEVER prints a term, a pattern, a matched span or a name:

    { "lines": N, "ledger_rows": <distinct ledger rows that hit>, "lib": {"vondoom": n, ...},
      "hit_lines": { "<line number>": [ "id" | "name" | "a:<i>" | "p" | "w:<i>" | "line", ... ], ... } }

The flags name only WHICH FIELD of that row hit (its id, its display name, its i-th aka, its page override, the i-th wing id in the wings
table, or "line" when only the whole line hits, as when two fields join into a match). Counts and field kinds only.

WHAT COUNTS AS A HIT (the same two things the coordinator checks with privacy-lookup.py, page mode and takedown mode):
  1. LEDGER (the gate's own rules, scripts/privacy-check.mjs loadRows/wordRe/joinedRe): every `deny` row of the main ledger and of every
     ledger-pending fragment, global or scoped to a prefix of the served path, MINUS the memorial register's own names (the gate
     suppresses those unless the row is a ruled namesake: class real-name-collision or MEMORIAL-COLLISION in the note). Matching is the
     gate's: word-bounded, case-insensitive, Unicode-aware; a #takedown-policy row of two or more runs also matches its joined forms.
     No ALLOW is honoured: no allow covers this file, and the point is that the index never needs one.
  2. THE TAKEDOWN LIBRARIES (von Doom, mack, matw, ayj; imported, never read or printed) through privacy-lookup.py's own loader and scanner:
     a line counts when any library reports a residual, a fused form or a full-name hit on it.
It fails CLOSED: a missing ledger, an unreadable library or a library that fails to import ends with exit 2 and a message that names the
kind of failure only. (The gate's privacy step fails closed on a missing ledger the same way.)
"""
import glob, hashlib, importlib.util, json, os, re, sys

sys.dont_write_bytecode = True

def die(msg):
    sys.stderr.write("find-record-privacy-filter: " + msg + "\n")
    sys.exit(2)

args = sys.argv[1:]
def opt(name, default):
    return args[args.index(name) + 1] if name in args and args.index(name) + 1 < len(args) else default

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(opt("--root", os.environ.get("MUSEUM_ROOT") or os.path.dirname(HERE)))
SERVED = opt("--served", "data/find-record-index.json").lstrip("/")
WORKSHOP = os.environ.get("WORKSHOP_ROOT") or os.path.join(os.path.dirname(ROOT), "archive")
LEDGER = os.environ.get("PRIVACY_LEDGER") or os.path.join(WORKSHOP, "privacy", "redaction-ledger.tsv")
PENDING = os.path.join(os.path.dirname(LEDGER), "ledger-pending")
LOOKUP = os.environ.get("PRIVACY_LOOKUP") or os.path.join(WORKSHOP, "tools", "coordinator-2026-09-03", "privacy-lookup.py")
if not os.path.isfile(LEDGER): die("the ledger is not found (set PRIVACY_LEDGER or WORKSHOP_ROOT); failing closed")
if not os.path.isfile(LOOKUP): die("privacy-lookup.py is not found (set PRIVACY_LOOKUP or WORKSHOP_ROOT); failing closed")

# --- the takedown libraries, by privacy-lookup.py's own importer -------------------------------------------------------------
os.environ["MUSEUM_ROOT"] = ROOT
os.environ["WORKSHOP_ROOT"] = WORKSHOP
try:
    spec = importlib.util.spec_from_file_location("plk_for_find_record", LOOKUP)
    plk = importlib.util.module_from_spec(spec); spec.loader.exec_module(plk)
    LIBS = plk.libs()
except Exception as e:
    die("privacy-lookup.py did not import (%s); failing closed" % type(e).__name__)
bad = [l for l, k, h in LIBS if k == "err"]
if bad or not LIBS: die("a takedown library failed to import (%s); failing closed" % ",".join(bad or ["none"]))

def lib_flags(text):
    """-> {label: n} of this text's residual / fused / full-name matches (counts only)."""
    out = {}
    for label, kind, h in LIBS:
        d = plk.lib_scan(label, kind, h, text)
        n = d["residual"] + d["residual_page"] + d["hits_full"] + (d["fused"] if isinstance(d["fused"], int) else 0)
        if n: out[label] = n
    return out

# --- the ledger, as the gate loads it ---------------------------------------------------------------------------------------
def memorial_names():
    names = set()
    try:
        d = json.load(open(os.path.join(ROOT, "data", "memorials.json"), encoding="utf-8"))
        for r in (d.get("memorials", []) if isinstance(d, dict) else d):
            for n in [r.get("name")] + list(r.get("aka") or []):
                if not n: continue
                names.add(str(n).lower()); pp = str(n).strip().split()
                if len(pp) > 2: names.add(("%s %s" % (pp[0], pp[-1])).lower())
    except Exception:
        pass   # empty exemption: every row stands (the gate's own direction)
    return names

MEM = memorial_names()
def word_re(t): return re.compile(r"(?<!\w)" + re.escape(t) + r"(?!\w)", re.I)
JOIN_SEP = r"(?:|[-_.+]|%20)"
def runs(t): return re.findall(r"[^\W_]+", t.lower())
def joined_re(t): return re.compile(r"(?<![^\W_])" + JOIN_SEP.join(re.escape(x) for x in runs(t)) + r"(?![^\W_])", re.I)

class Row:
    __slots__ = ("src", "line", "term", "td", "res", "keys")
    def __init__(s, src, line, term, td):
        s.src, s.line, s.term, s.td = src, line, term, td
        s.res = [word_re(term)]
        s.keys = [max(runs(term), key=len)] if runs(term) else [term.lower()]   # a word match contains its longest run as a whole token
        if td and len(runs(term)) >= 2: s.res.append(joined_re(term))   # joined forms: fused tokens, so the prefilter is a substring test
    def hit(s, text): return any(r.search(text) for r in s.res)

def load_rows(path, label):
    rows = []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for i, l in enumerate(fh, 1):
            if l.startswith("#") or not l.strip(): continue
            c = l.rstrip("\n").split("\t")
            if len(c) < 3 or not c[0].strip() or c[2].strip() != "deny": continue   # the gate enforces exactly status "deny"
            term, cls = c[0].strip(), (c[1].strip() if len(c) > 1 else "")
            note = c[5] if len(c) > 5 else ""
            if term.lower() in MEM and not (cls == "real-name-collision" or "MEMORIAL-COLLISION" in note): continue
            scope = [x.strip().lstrip("/") for x in (c[3] if len(c) > 3 else "").split(",") if x.strip()]
            if scope and not any(SERVED.startswith(p) for p in scope): continue   # a scoped deny that does not reach this file
            rows.append(Row(label, i, term, "#takedown-policy" in note))
    return rows

rows = load_rows(LEDGER, "ledger")
for f in sorted(glob.glob(os.path.join(PENDING, "*.tsv"))): rows += load_rows(f, os.path.basename(f))

text = sys.stdin.read()
lines = text.split("\n")
low = text.lower()
tokens = set(re.findall(r"[^\W_]+", low))
def prefilter(r):
    """A cheap, sound pre-test on the whole text: a word match contains its longest run as a whole token; a joined form as a substring."""
    if r.td and len(runs(r.term)) >= 2: return any(k in low for k in r.keys)
    return any(((k in tokens) if re.fullmatch(r"[^\W_]+", k) else (k in low)) for k in r.keys)
cand = [r for r in rows if prefilter(r)]

ledger_hit_rows = set()
def ledger_hit(txt):
    tl = txt.lower()
    for r in cand:
        if any(k in tl for k in r.keys) and r.hit(txt): return True
    return False

hit_lines = {}
lib_totals = {}
for ln, line in enumerate(lines, 1):
    if not line.strip(): continue
    ll = line.lower()
    lh = any(any(k in ll for k in r.keys) and r.hit(line) for r in cand)
    if lh:
        for r in cand:
            if any(k in ll for k in r.keys) and r.hit(line): ledger_hit_rows.add((r.src, r.line))
    lf = lib_flags(line)
    for k, v in lf.items(): lib_totals[k] = lib_totals.get(k, 0) + 1
    if not lh and not lf: continue
    flags = []
    body = line.strip().rstrip(",")
    try:
        r = json.loads(body)
    except Exception:
        r = None
    if isinstance(r, list) and len(r) >= 4 and isinstance(r[1], str):
        def bad(s): return bool(s) and (ledger_hit(s) or bool(lib_flags(s)))
        if bad(r[1]): flags.append("id")
        if bad(r[2]): flags.append("name")
        ex = r[4] if len(r) > 4 and isinstance(r[4], dict) else {}
        for i, a in enumerate(ex.get("a") or []):
            if isinstance(a, str) and bad(a): flags.append("a:%d" % i)
        if isinstance(ex.get("p"), str) and bad(ex["p"]): flags.append("p")
        if isinstance(ex.get("s"), str) and bad(ex["s"]): flags.append("s")
    elif body.startswith('"wings"'):
        try:
            ws = json.loads("{" + body + "}")["wings"]
            for i, w in enumerate(ws):
                if isinstance(w, str) and (ledger_hit(w) or lib_flags(w)): flags.append("w:%d" % i)
        except Exception:
            pass
    if not flags: flags.append("line")
    hit_lines[str(ln)] = flags

sys.stdout.write(json.dumps({"lines": len(lines), "ledger_rows": len(ledger_hit_rows), "lib": lib_totals, "hit_lines": hit_lines}, separators=(",", ":")) + "\n")
