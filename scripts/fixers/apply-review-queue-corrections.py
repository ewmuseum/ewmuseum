#!/usr/bin/env python3
"""Standing preflight fixer (job J40b, 2026-09-27): lands a wave's delta/data/review-queue-corrections.json onto
the matching row of data/review-queue.json.

Nothing corrects an EXISTING review-queue row today. apply-review-queue-append.py (J38b) appends rows and updates a
row's status when a later wave closes the question it opened; no applier can fix a FIELD of a row already in the file.
That gap is why the bare-word repoint-retired.py damage in this file (138 tokens across 80 `note`, 46
`resolution_note` and 12 `name` readings — three rows' names left reading "<id> / <the same id>") had no way to be
repaired: every other surface the same fixer hit has an applier (served pages -> apply-page-corrections.py, shard
notes -> apply-shard-paths.py, promotions.json -> apply-corrections.py), and this one did not.

ROW SHAPE  {match: {...}, field, old, new, why?}
  match  — the queue row's own identity, as one or more of its live fields: id (if the row has one), name, type,
           status, candidates. EVERY key given must equal the live row's value and EXACTLY ONE live row must match,
           or the row is printed and left. `name` alone is enough today (all 386 live names are distinct), but a
           correction is free to give type/candidates as well and they are all checked, so a row can never land on
           a different question than the one it was written against.
  field  — the field to correct: a name from the correctable set below, optionally with a path
           (`resolution_note`, `note`, `candidates[2]`). The queue row's own identity keys (type, status) are NOT
           correctable here: a status change is a ruling, and apply-review-queue-append.py's own
           status-transition path (with its "a script never reopens a settled row" guard) is where it belongs.
  old    — the live value the correction was written against. **It must still match**, byte for byte, or the row
           is printed and left and the file is not marked (apply-affiliations-corrections.py's rule and the same
           reason: a correction whose premise has already changed is a ruling to re-take, not a write to force).
  new    — the corrected value.

Idempotent: a field that already equals `new` is reported as already-correct and skipped, and a `match` key whose
value THIS FILE also corrects (its own `name` row, or another row's) accepts the corrected value as well as the
original — otherwise a landed `name` correction would hide the row from the `note` correction beside it, and the
second run would report the wave as half-stale. Rows are matched against the file as loaded before any of this
file's own writes, so within one run the order of the rows cannot matter either.

Model: apply-aliases-additions.py — every APPLIED wave in WAVE_TREES, one .APPLIED marker per file and only when
every row in it landed or was already there, --dry writes nothing, the target rewritten in its OWN indent
(review-queue.json is indent 1; a wrong indent reflows the whole file — 2026-09-26).
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
import json, glob, re, time, sys

DRY = '--dry' in sys.argv
NAME = "review-queue-corrections.json"
# the fields of a review-queue row a correction may touch: its prose and its label, plus the candidate list.
# type/status are the row's own identity and its verdict — see the docstring.
FIELDS = ("note", "resolution_note", "name", "resolution", "gap_promotion", "candidates")
MATCH_KEYS = ("id", "name", "type", "status", "candidates")
_MISS = object()

cfg = open(f"{_ROOT}/ops/config.env", encoding="utf-8").read()
m = re.search(r'WAVE_TREES="\$\{WAVE_TREES:-(.*?)\}"', cfg, re.S)
trees = [t.strip() for t in (_os.environ.get('WAVE_TREES') or (m.group(1) if m else "")).split("\n") if t.strip()]

QP = f"{_ROOT}/data/review-queue.json"; raw = open(QP, encoding="utf-8").read(); Q = json.loads(raw)
rows = Q["review_queue"] if isinstance(Q, dict) else Q


def indent_of(text):
    """The file's own indent, so a rewrite is a one-row diff and not 400k lines (2026-09-26)."""
    obj = json.loads(text)
    for i in (1, 2, 4):
        if json.dumps(obj, ensure_ascii=False, indent=i) + ("\n" if text.endswith("\n") else "") == text:
            return i
    for line in text.split("\n")[1:]:
        if line.startswith(" "):
            return len(line) - len(line.lstrip(" "))
    return 1


def tokens(path):
    out = []
    for part in str(path).split("."):
        mm = re.match(r"^([^\[]+)((\[\d+\])*)$", part)
        if not mm:
            raise ValueError(path)
        out.append(mm.group(1)); out += [int(x) for x in re.findall(r"\[(\d+)\]", mm.group(2))]
    return out


def get(o, toks):
    for t in toks:
        o = o[t]
    return o


def setp(o, toks, v):
    for t in toks[:-1]:
        o = o[t]
    o[toks[-1]] = v


def label(c):
    mt = c.get("match") or {}
    return str(mt.get("id") or mt.get("name") or mt)[:70]


files = []
for t in trees:
    base = t if _os.path.isabs(t) else _os.path.join(_WORKSHOP, t)
    for f in glob.glob(f"{base}/**/delta/data/{NAME}", recursive=True):
        wave = f.split("/delta/data/")[0]
        if not _os.path.exists(f"{wave}/APPLIED") or _os.path.exists(f + ".APPLIED"):
            continue
        files.append((f, wave))
files.sort()

fixed = already = seen = 0
to_stamp = []   # stamped only after review-queue.json is written (c14, 2026-10-02)
for f, wave in files:
    wn = _os.path.basename(wave)
    C = json.load(open(f, encoding="utf-8"))
    new = C if isinstance(C, list) else (C.get("corrections") or C.get("rows") or [C])
    ok = True
    plan = []                      # (live row, path tokens, new value, printable) — every match resolved BEFORE any write
    # every whole-field correction THIS FILE carries, so a match key already corrected by a sibling row still matches
    alt = {}
    for c in new or []:
        if not isinstance(c, dict) or "old" not in c or "new" not in c: continue
        try: tk = tokens(c.get("field"))
        except (ValueError, AttributeError): continue
        if len(tk) == 1 and tk[0] in MATCH_KEYS:
            alt[(tk[0], json.dumps(c["old"], sort_keys=True))] = c["new"]
    for c in new or []:
        seen += 1
        if not isinstance(c, dict):
            print(f"apply-review-queue-corrections: {wn}: row is not an object; left"); ok = False; continue
        mt = c.get("match")
        if not isinstance(mt, dict) or not mt:
            print(f"apply-review-queue-corrections: {wn}: row without a `match` object; left"); ok = False; continue
        bad = [k for k in mt if k not in MATCH_KEYS]
        if bad:
            print(f"apply-review-queue-corrections: {wn}: {label(c)}: match key(s) {bad} are not row identity; left"); ok = False; continue
        fld = c.get("field")
        try:
            toks = tokens(fld) if fld else None
        except ValueError:
            toks = None
        if not toks or toks[0] not in FIELDS or "new" not in c:
            print(f"apply-review-queue-corrections: {wn}: {label(c)}: field {fld!r} is not a correctable review-queue field, or no new value; left"); ok = False; continue
        # a match key this file itself corrects accepts the corrected value too (idempotency; see the docstring)
        def hit(r, _mt=mt):
            for k, v in _mt.items():
                cur = r.get(k)
                if cur == v:
                    continue
                a = alt.get((k, json.dumps(v, sort_keys=True)), _MISS)
                if a is not _MISS and cur == a:
                    continue
                return False
            return True
        hits = [r for r in rows if isinstance(r, dict) and hit(r)]
        if len(hits) != 1:
            print(f"apply-review-queue-corrections: {wn}: {label(c)}: {len(hits)} live queue row(s) match that `match`; left"); ok = False; continue
        r = hits[0]
        idx = rows.index(r)
        if c.get("index_at_filing") is not None and c["index_at_filing"] != idx:
            print(f"apply-review-queue-corrections: {wn}: {label(c)}: index moved {c['index_at_filing']} -> {idx} (matched on the row's own fields, which is the real key)")
        try:
            cur = get(r, toks)
        except (KeyError, IndexError, TypeError):
            print(f"apply-review-queue-corrections: {wn}: {label(c)}: no {fld} on queue[{idx}]; left"); ok = False; continue
        if cur == c["new"]:
            already += 1
            print(f"apply-review-queue-corrections: {wn}: queue[{idx}] {fld} already reads the corrected value; skipped")
            continue
        if "old" not in c:
            print(f"apply-review-queue-corrections: {wn}: {label(c)}: no old value to match against; left"); ok = False; continue
        if cur != c["old"]:
            print(f"apply-review-queue-corrections: {wn}: {label(c)}: live {fld} on queue[{idx}] does not match this row's own `old` — stale correction, left for a ruling"); ok = False; continue
        plan.append((r, toks, c["new"], f"queue[{idx}] {fld}"))
    for r, toks, v, where in plan:
        setp(r, toks, v)           # in memory either way; only the FILE write is gated on --dry
        fixed += 1
        print(f"apply-review-queue-corrections: {wn}: {where} corrected")
    if ok and not DRY:
        to_stamp.append(f)

if fixed and not DRY:
    ind = indent_of(raw)
    open(QP, "w", encoding="utf-8").write(json.dumps(Q, ensure_ascii=False, indent=ind) + ("\n" if raw.endswith("\n") else ""))
for f in ([] if DRY else to_stamp):
    open(f + ".APPLIED", "w").write(time.strftime("%Y-%m-%dT%H:%M:%S\n"))
print(("DRY " if DRY else "") + f"apply-review-queue-corrections: {fixed} field(s) corrected, {already} already correct, "
      f"{seen} row(s) read from {len(files)} file(s)")
