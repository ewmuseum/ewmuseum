#!/usr/bin/env python3
"""fix-az-allow-cards (hook c280, lane AZ-ALLOW-DURABLE 2026-10-11; board card az-bucket-allow-drift).

WHY. Gates 376 (10-10) and 394 (10-11) went red on the same allow: ledger row 16589 (the Janitor's D485) named the A-Z
roster page characters/a-z/ppo-ppy.html, new mints re-split the P buckets, the card moved to ppo-ppu.html and then to
ppo-pps.html, and the allow no longer reached it. The A-Z register's file names are chunk boundaries of a sorted list
(cross-reference.mjs generateAlphaRegister), so ANY mint ahead of a card can move it; a file name is never a durable
scope for one character's card.

WHAT. scripts/privacy-check.mjs (hook c280) reads a scope part of the form  characters/a-z/#<character id>  as "the
lines of that character's roster card on whichever characters/a-z/ page it lives" -- the card, not the page, so the
allow covers nothing else on that page. This fixer turns an ALLOW row's characters/a-z/<file>.html parts into such
card anchors, binding each to the cards it covers TODAY:
  * a named page that exists: every roster card on it whose lines carry the row's term (as written, in its takedown
    joined form, or wrapped across whitespace/markup -- a superset of the gate's own match, so no covered hit is
    dropped). If the term sits on a line of that page outside any roster card, the row is left exactly as it is;
  * a named page that is gone (the stale-split sweep deleted it), or exists but carries the term on no card: the cards
    of the characters whose own page characters/<id>.html the same row's scope names, whose card carries the term and
    sits under the same letter as the named page. A gone page with no such card stays as written (it matches no file);
    a page that exists with no such card stays as written too (the row's meaning there is unchanged).
Only allow rows of the main ledger, only their characters/a-z/<file>.html parts; DIR and letter-prefix parts
(characters/a-z/, characters/a-z/jj) are never touched. Each converted row gets one note line appended. Rows the
fixer cannot bind are reported by row number and left as written. Nothing is printed but row numbers, counts and A-Z
file names; never a term, a note or a character id (an id can spell a ledgered name).

Idempotent (a second run finds no file part to convert). Refuses while a gate or the privacy check runs on the
museum, and while privacy-check.mjs lacks the hook c280 card-anchor reader (an anchor the gate cannot read would
narrow the allow). The ledger is rewritten by line replacement, through a temp file and an atomic rename, only if it
is byte-identical to what was read.
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); from gate_detect import live_running as _live_running
import datetime, hashlib, os, re, sys

TAG = "fix-az-allow-cards"
AZ = "characters/a-z/"
ANCHOR = AZ + "#"
CHECKER_KEY = "// A-Z CARD ANCHORS (hook c280"
LEDGER = os.environ.get("AZ_CARDS_LEDGER") or f"{_WORKSHOP}/privacy/redaction-ledger.tsv"
AZDIR = os.path.join(_ROOT, "characters", "a-z")

for pat in ("scripts/gate[.]sh", "scripts/ops/gate[.]sh", "scripts/privacy-check[.]mjs"):
    if _live_running(pat, _ROOT):
        print(f"{TAG}: something matching {pat} is working on the museum; skipped"); sys.exit(0)
try:
    checker = open(os.path.join(_ROOT, "scripts", "privacy-check.mjs"), encoding="utf-8").read()
except OSError:
    checker = ""
if CHECKER_KEY not in checker:
    print(f"{TAG}: scripts/privacy-check.mjs has no hook c280 card-anchor reader; nothing converted"); sys.exit(0)
if not os.path.exists(LEDGER):
    print(f"{TAG}: no ledger; skipped"); sys.exit(0)
if not os.path.isdir(AZDIR):
    print(f"{TAG}: no {AZ} register; skipped"); sys.exit(0)

# ---- the register as rendered: card spans per page ----------------------------------------------------------------
CARD_OPEN = re.compile(r'^\s*<div class="roster-card" id="([^"]+)"')
DIV_OPEN = re.compile(r"<div[\s>]")
DIV_CLOSE = re.compile(r"</div>")
pages = {}      # file name -> (lines, span) ; span[i] = card id owning line i, or None
card_at = {}    # card id -> file name
for fn in sorted(os.listdir(AZDIR)):
    if not fn.endswith(".html") or fn == "index.html": continue
    try: lines = open(os.path.join(AZDIR, fn), encoding="utf-8").read().split("\n")
    except OSError: continue
    span, cur, depth = [], None, 0
    for ln in lines:
        m = CARD_OPEN.match(ln) if cur is None else None
        if m: cur, depth = m.group(1), 0
        owner = cur
        if cur is not None:
            depth += len(DIV_OPEN.findall(ln)) - len(DIV_CLOSE.findall(ln))
            if depth <= 0:
                if not re.search(r"</div>\s*$", ln): owner = None   # something after the card on its closing line: not the card's
                cur, depth = None, 0
        span.append(owner)
        if m and m.group(1) not in card_at: card_at[m.group(1)] = fn
    pages[fn] = (lines, span)

def letter_of(fn):
    c = fn[:1]
    return c if "a" <= c <= "z" else "0-9"

# ---- the term, matched as a SUPERSET of the gate's matching (scripts/privacy-check.mjs: wordRe, the takedown joined
# form, the hook c274 wrapped form): binding one card too many only anchors that card; binding one too few would drop
# a hit the page-level scope covers today.
GAP = r"(?:\s|&nbsp;|&#160;|&#[xX]0*[aA]0;|\\[nrt]|<[^<>]{0,200}>)+"
def matcher(term):
    words = [w for w in term.split() if w]
    runs = re.findall(r"[^\W_]+", term.lower())
    pats = [r"(?<!\w)" + re.escape(term) + r"(?!\w)"]
    if len(words) >= 2: pats.append(r"(?<!\w)" + GAP.join(re.escape(w) for w in words) + r"(?!\w)")
    if len(runs) >= 2: pats.append(r"(?<![^\W_])" + r"(?:|[-_.+]|%20)".join(re.escape(r) for r in runs) + r"(?![^\W_])")
    return re.compile("|".join("(?:%s)" % p for p in pats), re.I)

def term_lines(fn, rx):
    """line indices of page fn on which a match of rx starts or ends (a wrapped match spans two)"""
    lines, _ = pages[fn]
    text = "\n".join(lines)
    starts = [0]
    for i, ln in enumerate(lines[:-1]): starts.append(starts[-1] + len(ln) + 1)
    import bisect
    out = set()
    for m in rx.finditer(text):
        a = bisect.bisect_right(starts, m.start()) - 1
        b = bisect.bisect_right(starts, max(m.start(), m.end() - 1)) - 1
        out.update(range(a, b + 1))
    return out

def card_carries(cid, rx):
    fn = card_at.get(cid)
    if fn is None: return False
    lines, span = pages[fn]
    return bool(rx.search("\n".join(l for l, o in zip(lines, span) if o == cid)))

# ---- the ledger --------------------------------------------------------------------------------------------------
raw = open(LEDGER, "rb").read()
md5_read = hashlib.md5(raw).hexdigest()
L = raw.decode("utf-8").split("\n")
today = datetime.date.today().isoformat()
changed, held, dead, conv_parts = 0, [], [], 0
FILE_PART = re.compile(r"^" + re.escape(AZ) + r"([^/#,]+\.html)$")
for i, line in enumerate(L):
    if not line.strip() or line.startswith("#"): continue
    c = line.split("\t")
    if len(c) < 4 or c[2].strip() != "allow" or not c[0].strip() or AZ not in c[3]: continue
    parts = [p.strip() for p in c[3].split(",") if p.strip()]
    files = [(k, FILE_PART.match(p.lstrip("/")).group(1)) for k, p in enumerate(parts) if FILE_PART.match(p.lstrip("/")) and not p.lstrip("/").endswith("/index.html")]
    if not files: continue
    term = c[0].strip(); rx = matcher(term)
    char_pages = set(m.group(1) for p in parts for m in [re.match(r"^/?characters/([^/#,]+)\.html$", p)] if m)
    bound, drop, stuck = [], set(), False
    for k, fn in files:
        got = []
        if fn in pages:
            lines, span = pages[fn]
            tl = term_lines(fn, rx)
            if any(span[j] is None for j in tl):
                stuck = True; break          # the term on a line no card owns: this row stays as written
            got = sorted(set(span[j] for j in tl))
        if not got:   # gone, or no card on it carries the term: the row's own character pages under the same letter
            got = sorted(cid for cid in char_pages if cid in card_at and letter_of(card_at[cid]) == letter_of(fn) and card_carries(cid, rx))
        if got:
            bound += [g for g in got if g not in bound]; drop.add(k)
        else:
            dead.append((i + 1, fn, "gone" if fn not in pages else "no card carries the term"))
    if stuck:
        held.append(i + 1); continue
    if not drop: continue
    have = set(parts)
    new = [p for k, p in enumerate(parts) if k not in drop]
    new += [ANCHOR + b for b in bound if ANCHOR + b not in have]
    c[3] = ",".join(new)
    if len(c) >= 6:
        c[-1] = c[-1] + f" | {today} {TAG}: {len(drop)} A-Z page scope(s) -> {len(bound)} roster-card anchor(s) (hook c280; the card, wherever a re-split moves it)"
    L[i] = "\t".join(c); changed += 1; conv_parts += len(drop)
    print(f"{TAG}: ledger line {i+1}: {', '.join(fn for k, fn in files if k in drop)} -> {len(bound)} card anchor(s)")
for r in held:
    print(f"{TAG}: ledger line {r}: the term sits on a line of a named A-Z page outside any roster card; left as written")
for r, fn, why in dead:
    print(f"{TAG}: ledger line {r}: {AZ}{fn} ({why}; no card of the row's own characters carries the term under that letter); left as written")
# existing anchors whose card is gone from the register: reported, never removed (renamed or merged ids need a hand)
for i, line in enumerate(L):
    c = line.split("\t")
    if len(c) < 4 or line.startswith("#") or c[2].strip() != "allow" or ANCHOR not in c[3]: continue
    miss = [p for p in c[3].split(",") if p.strip().lstrip("/").startswith(ANCHOR) and p.strip().lstrip("/")[len(ANCHOR):] not in card_at]
    if miss: print(f"{TAG}: ledger line {i+1}: {len(miss)} card anchor(s) name no card on any {AZ} page (renamed or merged?); left as written")
if not changed:
    print(f"{TAG}: 0 allow rows converted"); sys.exit(0)
if hashlib.md5(open(LEDGER, "rb").read()).hexdigest() != md5_read:
    print(f"{TAG}: the ledger changed while this ran; nothing written (the next preflight retries)"); sys.exit(0)
tmp = f"{LEDGER}.{TAG}.{os.getpid()}.tmp"
with open(tmp, "w", encoding="utf-8", newline="") as fh: fh.write("\n".join(L))
os.chmod(tmp, os.stat(LEDGER).st_mode & 0o7777); os.replace(tmp, LEDGER)
print(f"{TAG}: {changed} allow row(s) converted ({conv_parts} A-Z page scope(s) -> roster-card anchors)")
