#!/usr/bin/env python3
"""Standing preflight fixer (job J38b, 2026-09-27): lands a wave's delta/data/promotion-epitaph-authorship-append.json
into data/promotion-epitaph-authorship.json.

The ONLY thing that has ever written that file is apply-delta.py's own epitaph block (D:97-119), and it writes a row
only for a wing whose delta actually carried delta/epitaphs/<wing>.html. wave-CWMC-AWARD shipped the authorship row on
its own, with no epitaph html beside it, so nothing ever read it: `cwmc` is still absent from the live file, while
promotions/cwmc/index.html does carry an <!-- epitaph:start --> block.

Why it still matters even though the badge already renders: stamp-promotion-headers.mjs defaults an unlisted wing to
"ai" (`authorByPromo.get(p.id) ?? "ai"`), so the AI badge on cwmc's epitaph is already correct today. The row is the
RECORD of who wrote it, and it is the only thing that could ever spare a human-written epitaph from the badge — an
absent row and an "ai" row are indistinguishable until the day someone writes one by hand, which is exactly when the
missing row would be read as a claim the museum never made.

Two guards, both because this file's whole job is to be true about authorship:
  * the promotion must be a held wing WITH an <!-- epitaph:start --> block on its own index.html — no authorship row
    for prose that does not exist;
  * `author` must be "ai" or "human" (the two values stamp-promotion-headers.mjs distinguishes); anything else is
    printed and left.
Model: apply-aliases-additions.py — every APPLIED wave in WAVE_TREES, a per-file .APPLIED marker, append-only (an
existing row is never rewritten: a change of authorship is a ruling, not an append), --dry writes nothing.
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
import json, glob, re, time, sys

DRY = '--dry' in sys.argv
NAME = "promotion-epitaph-authorship-append.json"
AUTHORS = ("ai", "human")

cfg = open(f"{_ROOT}/ops/config.env", encoding="utf-8").read()
m = re.search(r'WAVE_TREES="\$\{WAVE_TREES:-(.*?)\}"', cfg, re.S)
trees = [t.strip() for t in (_os.environ.get('WAVE_TREES') or (m.group(1) if m else "")).split("\n") if t.strip()]

FP = f"{_ROOT}/data/promotion-epitaph-authorship.json"; raw = open(FP, encoding="utf-8").read(); F = json.loads(raw)
rows = F["promotion_epitaph_authorship"] if isinstance(F, dict) else F
have = {r.get("promotion") for r in rows}
P = {r["id"]: r for r in json.load(open(f"{_ROOT}/data/promotions.json", encoding="utf-8"))["promotions"]}


def indent_of(text):
    obj = json.loads(text)
    for i in (1, 2, 4):
        if json.dumps(obj, ensure_ascii=False, indent=i) + ("\n" if text.endswith("\n") else "") == text:
            return i
    for line in text.split("\n")[1:]:
        if line.startswith(" "):
            return len(line) - len(line.lstrip(" "))
    return 1


def has_epitaph(pid):
    p = P.get(pid)
    if not p or not p.get("page"):
        return False
    page = _os.path.join(_ROOT, p["page"].lstrip("/"), "index.html")
    if not _os.path.exists(page):
        return False
    return "<!-- epitaph:start -->" in open(page, encoding="utf-8").read()


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
    new = C if isinstance(C, list) else (C.get("promotion_epitaph_authorship") or C.get("rows") or [C])
    ok = True
    for r in new or []:
        seen += 1
        pid = r.get("promotion") if isinstance(r, dict) else None
        au = r.get("author") if isinstance(r, dict) else None
        if not pid or not au:
            print(f"apply-epitaph-authorship-append: {wn}: row without promotion/author; left"); ok = False; continue
        if au not in AUTHORS:
            print(f"apply-epitaph-authorship-append: {wn}: {pid}: author {au!r} is not one of {'|'.join(AUTHORS)}; left"); ok = False; continue
        if pid in have:
            print(f"apply-epitaph-authorship-append: {wn}: {pid} already on the record; skipped")
            continue
        if pid not in P:
            print(f"apply-epitaph-authorship-append: {wn}: {pid} is not a held promotion; left"); ok = False; continue
        if not has_epitaph(pid):
            print(f"apply-epitaph-authorship-append: {wn}: {pid} has no epitaph block on its own wing page; left (no authorship row for prose that is not there)"); ok = False; continue
        rows.append({"promotion": pid, "author": au})       # in memory either way; only the FILE write is gated on --dry
        have.add(pid); added += 1
        print(f"apply-epitaph-authorship-append: {wn}: + {pid} = {au}")
    if ok and not DRY:
        open(f + ".APPLIED", "w").write(time.strftime("%Y-%m-%dT%H:%M:%S\n"))

if added and not DRY:
    ind = indent_of(raw)
    open(FP, "w", encoding="utf-8").write(json.dumps(F, ensure_ascii=False, indent=ind) + ("\n" if raw.endswith("\n") else ""))
print(("DRY " if DRY else "") + f"apply-epitaph-authorship-append: {added} row(s) added from {seen} row(s) in {len(files)} file(s)")
