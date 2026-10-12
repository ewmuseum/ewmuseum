#!/usr/bin/env python3
"""Standing preflight fixer (job J38b, 2026-09-27): lands a wave's delta/data/review-queue-append.json and
delta/data/review-queue-additions.json into data/review-queue.json.

Nothing has read either filename since the one applier that ever existed (apply-review-queue-append.py, called by name
for one wave from per-cycle post-chain<N>-window.sh scripts) stopped being copied forward: 12 files across 12 waves
(11 of them stamped APPLIED, wave-WSO-SCW-C still only READY), 28 rows, none of them in the live queue
(kit-j38/CURRENT-HITS.md; spot-check: no rq--prefixed id exists in data/review-queue.json at all). Same model as
apply-aliases-additions.py: every APPLIED wave in WAVE_TREES,
skip a file with a .APPLIED marker beside it, append only what isn't there, mark it. --dry writes nothing.

TWO SHAPES. The live schema (docs/SCHEMA.md, review-queue.json) is {type, name, candidates[], note, status,
resolution_note?}. Half the waiting rows are in a lane dialect instead — {id, type, status, entities[], note, opened,
closed?/resolved?} — which the desk itself already cites by id (the Janitor's desk file names review row
`rq-ufw-ultra-2000-vp-l`). This applier normalises rather than refuses: entities[] -> candidates[], and the id is kept
as its own field (registry-validate.mjs's review-queue block reads type/name/candidates/status only and ignores extra
keys, so the id costs nothing and is what makes an update idempotent). Where a dialect row carries no `name` at all
(20 of the 28), the row's own id is used verbatim as the name: a required field filled from a value already in the
file, never a sentence this script invented. --require-name holds those rows instead of landing them, for a
coordinator who would rather write the 20 labels by hand first.

STATUS TRANSITIONS, not blind appends. These waves supersede each other: wave-UFW-A opens three questions and
wave-UFW-B closes the same three ids as merged/distinct; wave-WSO-SCW-A opens two and -B resolves them. So files are
read in the order their waves landed (the wave's own APPLIED marker mtime, path as tiebreak), and a row whose id (or,
with no id, whose type+name) is already in the queue UPDATES that row in place — which is what SCHEMA.md's own
"the entry gets updated" contemplates for this file. One guard: a settled row (merged/distinct/dismissed) is never
reopened to `open` by a script; that row is printed and left, and the file is not marked, so a coordinator rules on it.
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
import json, glob, re, time, sys

DRY = '--dry' in sys.argv
REQUIRE_NAME = '--require-name' in sys.argv
NAMES = ("review-queue-append.json", "review-queue-additions.json")
STATUS = ("open", "distinct", "merged", "dismissed", "deferred")   # registry-validate.mjs's own set
SETTLED = ("merged", "distinct", "dismissed")
KEEP = ("id", "type", "name", "candidates", "status", "note", "resolution_note", "resolution",
        "gap_promotion", "opened", "closed", "resolved")

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


# every id a candidate could resolve to, and every held promotion id (the live queue already carries 24
# promotion-id candidates that resolve to no entity — practice, checked, not a paraphrase)
live = set()
for f in glob.glob(f"{_ROOT}/data/shards/*/*.json"):
    if "/_headers/" in f:
        continue
    d = json.load(open(f, encoding="utf-8"))
    rs = d if isinstance(d, list) else next((v for v in d.values() if isinstance(v, list)), [])
    live |= {r.get("id") for r in rs if isinstance(r, dict)}
for n in ("memorials", "essays", "external-figures", "rp-catalog"):
    p = f"{_ROOT}/data/{n}.json"
    if not _os.path.exists(p):
        continue
    d = json.load(open(p, encoding="utf-8"))
    rs = d if isinstance(d, list) else next((v for v in d.values() if isinstance(v, list)), [])
    live |= {r.get("id") for r in rs if isinstance(r, dict)}
promos = {r.get("id") for r in json.load(open(f"{_ROOT}/data/promotions.json", encoding="utf-8"))["promotions"]}

by_id = {r["id"]: r for r in rows if isinstance(r, dict) and r.get("id")}
by_name = {(r.get("type"), (r.get("name") or "").strip().lower()): r for r in rows if isinstance(r, dict)}

files = []
for t in trees:
    base = t if _os.path.isabs(t) else _os.path.join(_WORKSHOP, t)
    for name in NAMES:
        for f in glob.glob(f"{base}/**/delta/data/{name}", recursive=True):
            wave = f.split("/delta/data/")[0]
            if not _os.path.exists(f"{wave}/APPLIED") or _os.path.exists(f + ".APPLIED"):
                continue
            files.append((_os.path.getmtime(f"{wave}/APPLIED"), f, wave))
files.sort()   # the order the waves landed, so a later verdict wins over the row it closes

added = updated = held = seen = 0
for _mt, f, wave in files:
    wn = _os.path.basename(wave)
    C = json.load(open(f, encoding="utf-8"))
    new = C.get("review_queue") if isinstance(C, dict) else C
    if isinstance(new, dict):
        new = [new]
    ok = True
    for r in new or []:
        seen += 1
        if not isinstance(r, dict):
            print(f"apply-review-queue-append: {wn}: row is not an object; left"); ok = False; continue
        r = {k: v for k, v in r.items() if k in KEEP or k == "entities"}
        if "candidates" not in r and "entities" in r:
            r["candidates"] = r.pop("entities")           # the lane dialect's own name for the same list
        r.pop("entities", None)
        rid = r.get("id")
        if not r.get("name"):
            if not rid:
                print(f"apply-review-queue-append: {wn}: row with neither name nor id; left"); ok = False; continue
            if REQUIRE_NAME:
                print(f"apply-review-queue-append: {wn}: {rid} has no name (--require-name); left"); ok = False; held += 1; continue
            r["name"] = rid
            print(f"apply-review-queue-append: {wn}: {rid} has no name — the id is used as the index label")
        if not r.get("type") or not r.get("status"):
            print(f"apply-review-queue-append: {wn}: {r.get('name')}: no type/status; left"); ok = False; continue
        if r["status"] not in STATUS:
            print(f"apply-review-queue-append: {wn}: {r.get('name')}: status {r['status']!r} is not one of {'|'.join(STATUS)}; left"); ok = False; continue
        if "candidates" not in r:
            print(f"apply-review-queue-append: {wn}: {r.get('name')}: no candidates/entities; left"); ok = False; continue
        if not isinstance(r["candidates"], list):
            print(f"apply-review-queue-append: {wn}: {r.get('name')}: candidates is not a list; left"); ok = False; continue
        for c in r["candidates"]:
            if c not in live and c not in promos:
                print(f"apply-review-queue-append: {wn}: {r.get('name')}: candidate {c!r} resolves to nothing held (landed; registry-validate soft-warns it)")
        # by id first, then by type+name: wave-WSO-SCW-B files a question with a name and no id and wave-WSO-SCW-C
        # re-files the SAME question with an id and status deferred — matching on the name too is what keeps that one
        # question one row
        cur = (by_id.get(rid) if rid else None) or by_name.get((r.get("type"), (r.get("name") or "").strip().lower()))
        if cur is not None:
            if all(cur.get(k) == v for k, v in r.items()):
                continue                                   # already there, byte for byte
            if cur.get("status") in SETTLED and r["status"] == "open":
                print(f"apply-review-queue-append: {wn}: {r.get('name')}: live row is {cur['status']}; a script does not reopen it — left for a ruling"); ok = False; held += 1; continue
            was = cur.get("status")
            cur.update(r)                                  # in memory either way, so --dry reports the real outcome
            if cur.get("id"):
                by_id[cur["id"]] = cur
            updated += 1
            print(f"apply-review-queue-append: {wn}: {r.get('name')[:70]} — {was} -> {r['status']} (updated in place)")
            continue
        row = {k: r[k] for k in KEEP if k in r}
        rows.append(row)                                   # in memory either way; only the FILE write is gated on --dry
        if rid:
            by_id[rid] = row
        by_name[(row.get("type"), (row.get("name") or "").strip().lower())] = row
        added += 1
        print(f"apply-review-queue-append: {wn}: + {row.get('name')[:70]} [{row.get('type')}/{row['status']}]")
    if ok and not DRY:
        open(f + ".APPLIED", "w").write(time.strftime("%Y-%m-%dT%H:%M:%S\n"))

if (added or updated) and not DRY:
    ind = indent_of(raw)
    open(QP, "w", encoding="utf-8").write(json.dumps(Q, ensure_ascii=False, indent=ind) + ("\n" if raw.endswith("\n") else ""))
print(("DRY " if DRY else "") + f"apply-review-queue-append: {added} row(s) added, {updated} updated, {held} held, "
      f"{seen} row(s) read from {len(files)} file(s)")
