#!/usr/bin/env python3
"""Standing preflight fixer (job J38b, 2026-09-27): lands a wave's delta/data/frontier-leads-append.json into
data/frontier.json's rows[].

Same content and same target as frontier-rows.json — add-frontier-rows.py's own shape — but that fixer's glob is the
literal filename `frontier-rows.json`, so wave-SCCW-A's three leads (XCW, Sin City Championship Wrestling's own
predecessor to Nov 2005; XOW behind it; UWA, XCW's rival) were stamped APPLIED and never reached the frontier. Checked:
none of the three names is on the live frontier, and the other XCW/XOW/UWA rows there are separate sightings that no
document ties to these (the file's own notes say so, citing CURATION v66(a)) — so this is three missing rows, not three
duplicates.

WHY A SECOND FIXER AND NOT A ONE-LINE GLOB WIDENING IN add-frontier-rows.py (the reuse question, asked and answered):
that fixer is the one thing that appends to a 4,412-row live file, it walks a hardcoded list of three wave trees rather
than WAVE_TREES, and it refuses while a gate runs by probing the process table — editing it is a bigger blast radius
than the three rows justify, and a lane must not be the one to test that edit against the live frontier. This fixer
carries the same row normalisation deliberately (keys filtered to the ones live rows use, status/memorial_linked
defaulted, last_checked stamped) and nothing else. If the coordinator would rather have ONE frontier appender, the
merge is: teach add-frontier-rows.py both filenames and WAVE_TREES, and delete this file. Stated here so the
duplication cannot quietly become two answers to the same question.

Model: apply-aliases-additions.py — every APPLIED wave in WAVE_TREES, a per-file .APPLIED marker, dedupe by name
(case-insensitive, as add-frontier-rows.py does) and by url, --dry writes nothing. A row's `status` is checked against
the live file's own _status_values.
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
import json, glob, re, time, sys, datetime

DRY = '--dry' in sys.argv
NAME = "frontier-leads-append.json"

cfg = open(f"{_ROOT}/ops/config.env", encoding="utf-8").read()
m = re.search(r'WAVE_TREES="\$\{WAVE_TREES:-(.*?)\}"', cfg, re.S)
trees = [t.strip() for t in (_os.environ.get('WAVE_TREES') or (m.group(1) if m else "")).split("\n") if t.strip()]

FP = f"{_ROOT}/data/frontier.json"; raw = open(FP, encoding="utf-8").read(); F = json.loads(raw)
rows = F["rows"]
STATUSES = set(F.get("_status_values") or []) or {"unverified", "verified-dead", "verified-alive", "mined", "held"}
keys = {k for r in rows for k in r} | {"language", "country", "kind"}
today = datetime.date.today().isoformat()


def indent_of(text):
    obj = json.loads(text)
    for i in (1, 2, 4):
        if json.dumps(obj, ensure_ascii=False, indent=i) + ("\n" if text.endswith("\n") else "") == text:
            return i
    for line in text.split("\n")[1:]:
        if line.startswith(" "):
            return len(line) - len(line.lstrip(" "))
    return 1


def nu(u):
    return (u or '').strip().lower().rstrip('/').replace('https://', 'http://').replace('http://www.', 'http://')


live = {(r.get("name") or "").strip().lower() for r in rows}
liveurl = {nu(r.get("url")) for r in rows if r.get("url")}

files = []
for t in trees:
    base = t if _os.path.isabs(t) else _os.path.join(_WORKSHOP, t)
    for f in glob.glob(f"{base}/**/delta/data/{NAME}", recursive=True):
        wave = f.split("/delta/data/")[0]
        if not _os.path.exists(f"{wave}/APPLIED") or _os.path.exists(f + ".APPLIED"):
            continue
        files.append((f, wave))
files.sort()

added = seen = 0
for f, wave in files:
    wn = _os.path.basename(wave)
    C = json.load(open(f, encoding="utf-8"))
    new = C if isinstance(C, list) else (C.get("rows") or C.get("frontier_rows") or C.get("candidates") or [C])
    ok = True
    for r in new or []:
        seen += 1
        if not isinstance(r, dict):
            print(f"apply-frontier-leads-append: {wn}: row is not an object; left"); ok = False; continue
        n = (r.get("name") or "").strip()
        if not n:
            print(f"apply-frontier-leads-append: {wn}: row without a name; left"); ok = False; continue
        if not r.get("first_seen_in"):
            print(f"apply-frontier-leads-append: {wn}: {n[:50]}: no first_seen_in (where the record points); left"); ok = False; continue
        st = r.get("status", "unverified")
        if st not in STATUSES:
            print(f"apply-frontier-leads-append: {wn}: {n[:50]}: status {st!r} is not one of the frontier's own; left"); ok = False; continue
        if n.lower() in live or (r.get("url") and nu(r["url"]) in liveurl):
            print(f"apply-frontier-leads-append: {wn}: {n[:60]} already on the frontier; skipped")
            continue
        row = {k: v for k, v in r.items() if k in keys and v is not None}
        row.setdefault("status", "unverified"); row.setdefault("memorial_linked", False); row["last_checked"] = today
        dropped = [k for k in r if k not in keys]
        if dropped:
            print(f"apply-frontier-leads-append: {wn}: {n[:50]}: key(s) no live frontier row uses, not landed: {dropped}")
        rows.append(row)                                   # in memory either way; only the FILE write is gated on --dry
        live.add(n.lower()); liveurl.add(nu(r.get("url"))); added += 1
        print(f"apply-frontier-leads-append: {wn}: + {n[:70]} [{row['status']}]")
    if ok and not DRY:
        open(f + ".APPLIED", "w").write(time.strftime("%Y-%m-%dT%H:%M:%S\n"))

if added and not DRY:
    ind = indent_of(raw)
    open(FP, "w", encoding="utf-8").write(json.dumps(F, ensure_ascii=False, indent=ind) + ("\n" if raw.endswith("\n") else ""))
print(("DRY " if DRY else "") + f"apply-frontier-leads-append: {added} frontier row(s) added from {seen} row(s) in {len(files)} file(s)")
