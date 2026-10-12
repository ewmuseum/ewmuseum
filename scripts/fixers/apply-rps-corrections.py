#!/usr/bin/env python3
"""Standing preflight fixer (lane FORUM-MACHINERY, 2026-09-28): lands a wave's
delta/data/rps-corrections-<wing>.json onto the matching row of data/shards/<wing>/rps.json.

WHY. A served roleplay page is linked to the roleplay it serves by the row's own top-level `served_url`
(docs/SCHEMA.md, `rps.json`). Nothing filed that reliably: wave-PTC-FORUM-SERVE-1's 22 roleplay pages were
HELD on 2026-09-24 because "no window applier sets a top-level field on an rps row" — apply-shard-paths.py
takes dotted/indexed paths only, and the generic apply-characters-corrections.py (which HAS globbed
rps-corrections-*.json since 2026-09-24 08:18, commit f1cfefb6ab) reaches it from window A4 only for a wave
whose marker is under three days old, prints a stale row as a SKIPPED line the window pipes to `tail -1`,
and never fails — so a correction that did not land still left the wave stamped APPLIED (memory:
"APPLIED is not landed"). This applier is the guarded owner of the shape: every row lands or is reported,
the file is stamped only when the whole file landed, and a stale `old` exits 1.

Row shape — apply-corrections.py's, with the record's own id in place of a slug:
    {"id": "<rps id>", "field": "served_url", "old": null, "new": "/promotions/<wing>/rp/<slug>.html"}
  * The record is found by `id` across data/shards/*/rps.json; exactly one live row must match.
  * FIELDS below is the set this applier OWNS (plain scalar fields of an rps row). The shape is shared: five
    files in the wave trees already carry `references` rows (apply-characters-corrections.py's) and
    `date.<key>` path rows (apply-shard-paths.py's), all of them landed. Such a row is read, checked against
    the live record and counted, never written here and never silently passed over; one that has NOT landed is
    printed with its owner and leaves the file unstamped, so it is named again next run.
  * OLD-MATCHED. The row lands only where the live value still equals `old`; `old: null` matches a row that
    has no such key at all (the ordinary case for served_url). Where the value already equals `new` the row
    is reported already-correct and skipped (idempotent, and a no-op on a second run after window A4 has
    landed the same file). A stale `old` is printed and LEFT, the file is not stamped, and the script exits 1:
    a correction whose premise has moved is a ruling to re-take, not a write to force.
  * The shard is rewritten in ITS OWN indent, and only when its bytes actually change (memory:
    registry-json-indent — a wrong indent once made a 356k-line diff).
  * Nothing but the named field is ever written. No page is read or written; no id is minted.

SCOPE. Waves under WAVE_TREES (ops/config.env, overridable) that carry an APPLIED marker; a per-file
`<file>.APPLIED` marker means the file is done. `--dry` reads and reports, writes and stamps nothing.
Wave dirs may also be named as positional arguments, which skips the WAVE_TREES walk (they still need APPLIED).
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
import json, glob, re, time, sys

DRY = '--dry' in sys.argv
PATTERN = "rps-corrections-*.json"
# THE FIELDS THIS APPLIER OWNS: the link to the served page, the row's own source/collection paperwork, its
# title and the two ecosystem overrides — plain scalar fields of an rps row, set by value.
FIELDS = ("served_url", "source", "collection", "title", "language", "country")
# The shape is shared, so the rest of a file is read and accounted for, never silently passed over:
#   a dotted/indexed field (date.date, appearances[3].note) is apply-shard-paths.py's, window A3;
#   any other plain field (references, involves, notes) is apply-characters-corrections.py's, window A4.
# A foreign row whose live value already reads `new` has landed and is counted; one that has not is named
# with its owner and leaves this file unstamped (so it is read and named again), but never fails this run —
# it is not this applier's ruling to force. Only a row of this applier's OWN fields can exit 1.
OWNER_PATH = "apply-shard-paths.py (window A3)"
OWNER_PLAIN = "apply-characters-corrections.py (window A4)"

argv_waves = [a for a in sys.argv[1:] if not a.startswith('-')]


def resolve(rec, path):
    """The live value at a dotted/indexed path, or a sentinel when the path does not exist."""
    cur = rec
    for part in path.split('.'):
        m = re.match(r'^([^\[]+)((?:\[\d+\])*)$', part)
        if not m:
            return KeyError
        cur = cur.get(m.group(1), None) if isinstance(cur, dict) else None
        for ix in re.findall(r'\[(\d+)\]', m.group(2)):
            if not isinstance(cur, list) or int(ix) >= len(cur):
                return KeyError
            cur = cur[int(ix)]
        if cur is None and part != path.split('.')[-1]:
            return KeyError
    return cur


def indent_of(text, obj):
    """The file's own indent, so a landed correction is a one-row diff (memory: registry-json-indent)."""
    cand = []
    for line in text.split("\n", 40)[1:]:
        if line.startswith(" "):
            cand = [len(line) - len(line.lstrip(" "))]
            break
    for i in cand + [x for x in (1, 2, 4) if x not in cand]:
        if json.dumps(obj, ensure_ascii=False, indent=i) + ("\n" if text.endswith("\n") else "") == text:
            return i
    return cand[0] if cand else 1


def wave_trees():
    cfg = open(f"{_ROOT}/ops/config.env", encoding="utf-8").read()
    m = re.search(r'WAVE_TREES="\$\{WAVE_TREES:-(.*?)\}"', cfg, re.S)
    raw = _os.environ.get('WAVE_TREES') or (m.group(1) if m else "")
    return [t.strip() for t in raw.split("\n") if t.strip()]


# ---- the files to read -----------------------------------------------------
files = []
if argv_waves:
    roots = [w.rstrip('/') for w in argv_waves]
    for w in roots:
        for f in sorted(glob.glob(f"{w}/delta/data/{PATTERN}")):
            files.append((f, w))
else:
    for t in wave_trees():
        base = t if _os.path.isabs(t) else _os.path.join(_WORKSHOP, t)
        for f in glob.glob(f"{base}/**/delta/data/{PATTERN}", recursive=True):
            files.append((f, f.split("/delta/data/")[0]))
files = sorted(set(files))
files = [(f, w) for f, w in files
         if _os.path.exists(f"{w}/APPLIED") and not _os.path.exists(f + ".APPLIED")]

# ---- the live rows, per shard file -----------------------------------------
shards = {}          # path -> (raw text, parsed list)
where = {}           # rps id -> [(path, row), …]
for sf in sorted(glob.glob(f"{_ROOT}/data/shards/*/rps.json")):
    if _os.path.basename(_os.path.dirname(sf)) == '_headers':
        continue
    raw = open(sf, encoding="utf-8").read()
    try:
        rows = json.loads(raw)
    except ValueError:
        print(f"apply-rps-corrections: {sf} is not readable JSON; skipped")
        continue
    if not isinstance(rows, list):
        continue
    shards[sf] = (raw, rows)
    for r in rows:
        if isinstance(r, dict) and r.get('id'):
            where.setdefault(r['id'], []).append((sf, r))

fixed = already = seen = 0
stale = 0
elsewhere_done = 0
changed = set()
for f, wave in files:
    wn = _os.path.basename(wave.rstrip('/'))
    fn = _os.path.basename(f)
    try:
        C = json.load(open(f, encoding="utf-8"))
    except ValueError as e:
        print(f"apply-rps-corrections: {wn}/{fn}: not readable JSON ({e}); left"); stale += 1; continue
    rows = C if isinstance(C, list) else (C.get("corrections") or C.get("rows") or [C])
    ok = True                 # every row of THIS applier's own fields landed (or was already correct)
    pending_elsewhere = 0     # a foreign row that has not landed: named, and the file is left unstamped
    for c in rows or []:
        seen += 1
        if not isinstance(c, dict) or not c.get('id'):
            print(f"apply-rps-corrections: {wn}/{fn}: a row is not an object with an id; left"); ok = False; continue
        rid = c['id']; fld = c.get('field')
        if not isinstance(fld, str) or 'new' not in c:
            print(f"apply-rps-corrections: {wn}/{fn}: {rid}: no field/new; left"); ok = False; continue
        if fld not in FIELDS:
            # not this applier's field. Account for it against the live record and name its owner.
            owner = OWNER_PATH if ('.' in fld or '[' in fld) else OWNER_PLAIN
            hits = where.get(rid) or []
            live = resolve(hits[0][1], fld) if len(hits) == 1 else KeyError
            if live == c['new']:
                elsewhere_done += 1
            else:
                pending_elsewhere += 1
                print(f"apply-rps-corrections: {wn}/{fn}: {rid}: {fld} is {owner}'s field and has not landed "
                      f"(live {json.dumps(live) if live is not KeyError else '<no such path>'}) — left to it, not stamped")
            continue
        hits = where.get(rid) or []
        if len(hits) != 1:
            print(f"apply-rps-corrections: {wn}/{fn}: {rid}: {len(hits)} live rps row(s) carry that id; left")
            ok = False; continue
        sf, r = hits[0]
        if r.get(fld) == c['new']:
            already += 1
            print(f"apply-rps-corrections: {wn}/{fn}: {rid}: {fld} already reads the corrected value; skipped")
            continue
        if 'old' not in c:
            print(f"apply-rps-corrections: {wn}/{fn}: {rid}: no `old` to match against — nothing is written blind; left")
            ok = False; continue
        if r.get(fld) != c['old']:
            print(f"apply-rps-corrections: {wn}/{fn}: {rid}: live {fld} {json.dumps(r.get(fld))[:60]} does not match "
                  f"this row's own `old` {json.dumps(c['old'])[:60]} — stale correction, left for a ruling")
            ok = False; continue
        r[fld] = c['new']                      # in memory either way; only the FILE write is gated on --dry
        changed.add(sf); fixed += 1
        print(f"apply-rps-corrections: {wn}/{fn}: {rid}: {fld} -> {json.dumps(c['new'])[:80]} "
              f"({_os.path.basename(_os.path.dirname(sf))})")
    if not ok:
        stale += 1
    elif pending_elsewhere:
        pass                                  # nothing of this applier's failed, but the file is not finished
    elif not DRY:
        open(f + ".APPLIED", "w").write(time.strftime("%Y-%m-%dT%H:%M:%S\n"))

if not DRY:
    for sf in sorted(changed):
        raw, rows = shards[sf]
        out = json.dumps(rows, ensure_ascii=False, indent=indent_of(raw, rows)) + ("\n" if raw.endswith("\n") else "")
        if out != raw:
            tmp = sf + ".rpscorr.tmp"
            open(tmp, "w", encoding="utf-8").write(out); _os.replace(tmp, sf)
            print(f"apply-rps-corrections: wrote {_os.path.relpath(sf, _ROOT)}")

print(("DRY " if DRY else "") + f"apply-rps-corrections: {fixed} field(s) set, {already} already correct, "
      f"{elsewhere_done} landed by another applier, {seen} row(s) read from {len(files)} file(s)")
if stale:
    print(f"apply-rps-corrections: {stale} file(s) left unstamped (a row could not land) — the next preflight reads them again")
    sys.exit(1)
