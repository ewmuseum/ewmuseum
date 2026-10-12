#!/usr/bin/env python3
"""Standing preflight fixer (hook c81, 2026-10-05): lands a wave's delta/data/aliases-corrections.json onto existing rows of
data/aliases.json.

Why: no applier could re-point an alias row. apply-aliases-additions.py only appends (and skips a `from` that is already an
alias); fix-alias-chains.py touches only a `to` that no longer resolves. wave-VANESSA-PCW-SPLIT splits vanessa-pcw, so the retired
id vanessa-rush-2002 (forwarded to vanessa-pcw by a merge-batch fold) must forward to vanessa-matthews-rush-2002 instead.

Row shape: {from, field: "to", old, new, why}. (field "note" is also accepted; it cannot make a chain.)
  * the row is found by `from`; exactly one live alias row must carry it;
  * it applies ONLY when the live field equals `old` byte for byte; otherwise it is printed as SKIPPED and left (the file is not
    marked): a correction whose premise changed is a ruling to re-take, not a write to force;
  * idempotent: when the live field already equals `new` it is reported "already applied" and skipped;
  * a row is never deleted and never added;
  * a `to` change is REFUSED (printed, row left) when it would make a chain (`new` is itself an alias `from`), a cycle (`new` ==
    `from`), a twin (`from` is a live record id), or a dangling target (`new` is not a live record id);
  * aliases.json is rewritten in its OWN indent (byte round-trip proven first), via a temp file and an atomic rename;
  * every APPLIED wave in WAVE_TREES, a per-file .APPLIED marker once every row in the file is applied or already applied;
  * --dry prints and writes nothing. Refuses (skips) while a gate runs.
Env: MUSEUM_ROOT only (and WORKSHOP_ROOT / WAVE_TREES as the sibling appliers read them). Exit 0 always except a file that
cannot be rewritten (exit 4)."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); from gate_detect import live_running as _live_running
import json, glob, re, time, sys
NAME = "aliases-corrections.json"
FIELDS = ("to", "note")
DRY = '--dry' in sys.argv
P = "apply-aliases-corrections"
if _live_running("scripts/gate[.]sh", _ROOT):
    print(f"{P}: a gate is running - skipped"); sys.exit(0)
cfg = open(f"{_ROOT}/ops/config.env", encoding="utf-8").read()
m = re.search(r'WAVE_TREES="\$\{WAVE_TREES:-(.*?)\}"', cfg, re.S)
trees = [t.strip() for t in (_os.environ.get('WAVE_TREES') or (m.group(1) if m else "")).split("\n") if t.strip()]
AP = f"{_ROOT}/data/aliases.json"; raw = open(AP, encoding="utf-8").read(); A = json.loads(raw)
rows = A["aliases"] if isinstance(A, dict) else A
nl = "\n" if raw.endswith("\n") else ""
ind = next((i for i in (1, 2, 4) if json.dumps(A, ensure_ascii=False, indent=i) + nl == raw), None)
live = set()
for f in glob.glob(f"{_ROOT}/data/shards/*/characters.json") + glob.glob(f"{_ROOT}/data/shards/*/units.json") + glob.glob(f"{_ROOT}/data/shards/*/shows.json") + glob.glob(f"{_ROOT}/data/shards/*/titles.json"):
    d = json.load(open(f, encoding="utf-8")); rs = d if isinstance(d, list) else next((v for v in d.values() if isinstance(v, list)), [])
    live |= {r.get("id") for r in rs if isinstance(r, dict)}
try:
    _xf = json.load(open(f"{_ROOT}/data/external-figures.json", encoding="utf-8"))
    live |= {r.get("id") for r in (_xf.get("external_figures") if isinstance(_xf, dict) else _xf) or [] if isinstance(r, dict)}
except FileNotFoundError: pass
files = []
for t in trees:
    base = t if _os.path.isabs(t) else _os.path.join(_WORKSHOP, t)
    for f in sorted(glob.glob(f"{base}/**/delta/data/{NAME}", recursive=True)):
        wave = f.split("/delta/data/")[0]
        if not _os.path.exists(f"{wave}/APPLIED") or _os.path.exists(f + ".APPLIED"): continue
        files.append((f, wave))
changed = already = skipped = refused = seen = 0
for f, wave in files:
    wn = _os.path.basename(wave)
    C = json.load(open(f, encoding="utf-8"))
    new = C if isinstance(C, list) else (C.get("corrections") or C.get("rows") or [C])
    ok = True
    for c in new or []:
        seen += 1
        if not isinstance(c, dict) or not c.get("from") or c.get("field") not in FIELDS or "old" not in c or "new" not in c:
            print(f"{P}: {wn}: row without from/field(to|note)/old/new SKIPPED"); skipped += 1; ok = False; continue
        fr, fld, old, nw = c["from"], c["field"], c["old"], c["new"]
        hits = [r for r in rows if isinstance(r, dict) and r.get("from") == fr]
        if len(hits) != 1:
            print(f"{P}: {wn}: {fr}: {len(hits)} alias row(s) carry that from; SKIPPED"); skipped += 1; ok = False; continue
        r = hits[0]
        if r.get(fld) == nw:
            already += 1; print(f"{P}: {wn}: {fr}.{fld} already applied"); continue
        if r.get(fld) != old:
            print(f"{P}: {wn}: {fr}.{fld} is {r.get(fld)!r}, not the row's old {old!r}; SKIPPED (stale correction, left for a ruling)"); skipped += 1; ok = False; continue
        if fld == "to":
            froms = {x.get("from") for x in rows if isinstance(x, dict)}
            why = None
            if nw == fr: why = "a cycle (new == from)"
            elif nw in froms: why = f"a chain ({nw} is itself an alias from)"
            elif fr in live: why = f"a twin ({fr} is a live record id)"
            elif nw not in live: why = f"a dangling target ({nw} is not a live record id)"
            if why:
                print(f"{P}: {wn}: {fr} -> {nw} REFUSED: it would make {why}; row left"); refused += 1; ok = False; continue
        r[fld] = nw; changed += 1
        print(f"{P}: {wn}: {fr}.{fld}: {old!r} -> {nw!r}")
    if ok and not DRY: open(f + ".APPLIED", "w").write(time.strftime("%Y-%m-%dT%H:%M:%S\n"))
if changed and not DRY:
    if ind is None: print(f"{P}: aliases.json does not round-trip at indent 1, 2 or 4; refused whole, nothing written"); sys.exit(4)
    tmp = AP + ".c81tmp"
    open(tmp, "w", encoding="utf-8").write(json.dumps(A, ensure_ascii=False, indent=ind) + nl)
    _os.replace(tmp, AP)
print(("DRY " if DRY else "") + f"{P}: {changed} corrected, {already} already applied, {skipped} skipped, {refused} refused, {seen} row(s) from {len(files)} file(s)")
