#!/usr/bin/env python3
"""Standing preflight fixer (job J38b, 2026-09-27): the repo-resident, self-scanning version of
the workshop's apply-shard-enrich.py.

<kind>-enrich-<slug>.json (kind ∈ shows|characters|units|titles|reigns|awards|rps) merges fields by id into
data/shards/<slug>/<kind>.json: notes_append appends to notes; tenure_first_seen_correction sets tenures[0].first_seen;
<field>_append extends a list field; matches/appearances extend, never replace; members replaces members and drops
membership_unknown; tenures MERGES by promotion (hook c135, below; tenures_replace_all: true on the row sets it whole);
any other key is set directly. Rows are never created — a missing id is listed.

WHY THIS FILE EXISTS. The merge logic above is landing real content today (wave-FW-BACKYARD's characters-enrich-nfw.json
put michael-manson's backyard-wrestling-2005 tenure into the live nfw shard), but it has never been reachable from any
standing file: not window.sh, not ORDER.txt, not standing-window-fixers.sh. Its only caller is the one-line incantation
hand-copied into each cycle's own post-chain<N>-window.sh, whose wave-tree list differs from cycle to cycle and has
never included desk/argyle/waves or prose-waves. Nothing would announce it if a future cycle's script were generated
without that line: the waves would keep being stamped APPLIED and the enrichments would stop arriving, exactly the
failure the Janitor's 2026-09-12 rule is about ("if we fix something once it needs to persist"). Fifteen enrich files
exist in the reachable trees today and all fifteen already carry their .APPLIED marker, so installing this changes
nothing about the current tree — it only means the next one cannot be missed.

Differences from the workshop tools' original, all three of them:
  * the museum root comes from MUSEUM_ROOT / the script's own location, never the hardcoded absolute path it carried;
  * no argv: it walks every APPLIED wave in WAVE_TREES itself (apply-aliases-additions.py's model), which is what makes
    it standing rather than per-cycle, and covers the two trees the per-cycle loops never listed;
  * --dry prints what it would merge and writes nothing (the original had no dry mode);
  * hook c143 (2026-10-08): a shard is written in its OWN indent (it was written at 1 whatever the shard was).
The per-file <file>.APPLIED marker is unchanged and is what keeps the two safe to run side by side: a file the cycle
script already applied is skipped here, and vice versa.
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
import json, glob, re, sys

DRY = '--dry' in sys.argv
KINDS = ("shows", "characters", "units", "titles", "reigns", "awards", "rps")

cfg = open(f"{_ROOT}/ops/config.env", encoding="utf-8").read()
m = re.search(r'WAVE_TREES="\$\{WAVE_TREES:-(.*?)\}"', cfg, re.S)
trees = [t.strip() for t in (_os.environ.get('WAVE_TREES') or (m.group(1) if m else "")).split("\n") if t.strip()]


def save(p, o):
    # hook c143 (2026-10-08, lane APPLIER-DEBT): the shard's OWN indent, read off the file before the write. A fixed indent=1
    # reflowed every indent-2 or indent-4 shard an enrich row touched into a whole-file diff (live shards today: 2391 at 1,
    # 847 at 2, 32 at 4). Same detection as merge-character.py (hook c26) and fix-identity-unknown-ids.py (hook c141);
    # a file the pattern does not match (an empty "[]" shard) is written at 1, exactly as before.
    _m = re.match(r'[\[{][ \t]*\n( +)\S', open(p, encoding="utf-8").read(256))
    json.dump(o, open(p, "w"), ensure_ascii=False, indent=(len(_m.group(1)) if _m else 1)); open(p, "a").write("\n")


# TENURES MERGE BY WING (hook c135, lane C135-ENRICH-TENURES, 2026-10-08). `tenures` was set whole like any other key, so an
# enrich row cut for ONE wing erased every stint a merge survivor or cross-wing character holds in the others (wave-SERVE-GLCW-
# FORUM-S02's verify caught three such rows before they landed: jarod-poe, maelstrom and jean-rabesque, each re-cut to carry the
# other wings' stints by hand). What lanes mean by a row's `tenures` is "these are this record's stints in the promotion(s) I
# name", so the row now speaks only for the promotions it names:
#   * a promotion the record lacks: the row's stint(s) are appended, after every stint the record holds, ordered by first_seen
#     (the record's own order, and so tenures[0], the shard key, never moves);
#   * one row stint, one record stint of that promotion: replaced in place;
#   * one row stint, several record stints: the one with the same first_seen, else the first whose span overlaps, is replaced in
#     place; none matching is a new stint, appended;
#   * several row stints for a promotion the record holds: that promotion's whole set becomes the row's set, at the place of the
#     record's first stint of it;
#   * every stint of a promotion the row does not name is kept untouched.
# A record with no tenures takes the row's list as given (the old behaviour). `tenures_replace_all: true` on the row is the
# deliberate whole replace (the old behaviour); no wave filed before this hook uses it, and every enrich file on file lands
# the same under either rule against today's shards (the workshop's desk/between-cycles/c135-proof/real-waves.txt, d2).
def _ten_bound(s, hi):
    m = re.search(r"\d{4}(?:-\d{2}(?:-\d{2})?)?", str(s or ""))
    if not m:
        return None
    d = m.group(0)
    return d + ("-99-99" if hi else "-00-00")[len(d) - 4:]


def _ten_overlap(a, b):
    af, bf = _ten_bound(a.get("first_seen"), False), _ten_bound(b.get("first_seen"), False)
    if af is None or bf is None:
        return False
    al = _ten_bound(a.get("last_seen"), True) or _ten_bound(a.get("first_seen"), True)
    bl = _ten_bound(b.get("last_seen"), True) or _ten_bound(b.get("first_seen"), True)
    return af <= bl and bf <= al


def _ten_key(t):
    s = str(t.get("first_seen") or "") if isinstance(t, dict) else ""
    return (0, _ten_bound(s, False), s) if _ten_bound(s, False) else (1, "", s)


def merge_tenures(rec, row):
    """The record's tenures with the row's merged in by promotion; returns (new list, stints of other promotions kept)."""
    have = rec if isinstance(rec, list) else []
    if not have:
        return list(row), 0
    out = list(have); new = []
    promo = lambda t: t.get("promotion") if isinstance(t, dict) else None
    order = []
    for t in row:
        if promo(t) not in order:
            order.append(promo(t))
    for p in order:
        rs = [t for t in row if promo(t) == p]
        if p is None or not isinstance(p, str):
            new.extend(rs); continue
        idx = [i for i, t in enumerate(out) if promo(t) == p]
        if not idx:
            new.extend(rs)
        elif len(rs) == 1 and len(idx) == 1:
            out[idx[0]] = rs[0]
        elif len(rs) == 1:
            fs = str(rs[0].get("first_seen") or "").strip()
            hit = next((i for i in idx if fs and str(out[i].get("first_seen") or "").strip() == fs), None)
            if hit is None:
                hit = next((i for i in idx if _ten_overlap(rs[0], out[i])), None)
            if hit is None:
                new.extend(rs)
            else:
                out[hit] = rs[0]
        else:
            first = idx[0]; drop = set(idx)
            out = [t for i, t in enumerate(out) if i < first and i not in drop] + list(rs) + [t for i, t in enumerate(out) if i > first and i not in drop]
    named = {promo(t) for t in row}
    kept = sum(1 for t in out if promo(t) not in named)
    return out + sorted(new, key=_ten_key), kept


files = []
for t in trees:
    base = t if _os.path.isabs(t) else _os.path.join(_WORKSHOP, t)
    for f in glob.glob(f"{base}/**/delta/data/*-enrich-*.json", recursive=True):
        b = _os.path.basename(f)
        if b.startswith("enrich-") or _os.path.exists(f + ".APPLIED"):
            continue
        wave = f.split("/delta/data/")[0]
        if not _os.path.exists(f"{wave}/APPLIED"):
            continue
        files.append(f)

enriched = 0
for f in sorted(files):
    base = _os.path.basename(f)
    kind, slug = base[:-5].split("-enrich-", 1)
    if kind not in KINDS:
        continue
    sp = f"{_ROOT}/data/shards/{slug}/{kind}.json"
    if not _os.path.exists(sp):
        print("apply-shard-enrich: no shard file:", sp); continue
    S = json.load(open(sp)); by = {r["id"]: r for r in S if isinstance(r, dict)}
    rows = json.load(open(f)); rows = rows if isinstance(rows, list) else [rows]
    n = 0; missing = []; kept = 0
    for e in rows:
        r = by.get(e.get("id"))
        if not r:
            missing.append(e.get("id")); continue
        for k, v in e.items():
            if k in ("id", "_note", "_reassign_note", "tenures_replace_all"):
                continue
            if k == "notes_append":
                if isinstance(v, list):
                    v = " ".join(str(x) for x in v)          # window 68: lanes file notes_append as a list of sentences
                if isinstance(r.get("notes"), list):
                    r["notes"].append(v)
                else:
                    r["notes"] = ((r.get("notes") or "").rstrip() + " " + v).strip()
            elif k == "tenure_first_seen_correction":
                new = v if isinstance(v, str) else (v.get("new") or v.get("first_seen"))
                if new and r.get("tenures"):
                    r["tenures"][0]["first_seen"] = new
            elif k.endswith("_append") and k != "notes_append":   # L265 (2026-09-06): evidence_append etc. extend the list
                bk = k[:-len("_append")]; items = v if isinstance(v, list) else [v]
                if isinstance(r.get(bk), list):
                    r[bk].extend(x for x in items if x not in r[bk])
                elif r.get(bk) in (None, ""):
                    r[bk] = items
                else:
                    r[bk] = [r[bk]] + items
            elif k in ("appearances", "matches") and isinstance(r.get(k), list) and isinstance(v, list):
                r[k].extend(x for x in v if x not in r[k])       # extend, never replace, an existing list
            elif k == "members":
                r["members"] = v; r.pop("membership_unknown", None)
            elif k == "membership_unknown":
                if v:
                    r["membership_unknown"] = True
                else:
                    r.pop("membership_unknown", None)
            elif k == "tenures" and isinstance(v, list) and e.get("tenures_replace_all") is not True:   # hook c135
                r["tenures"], kk = merge_tenures(r.get("tenures"), v); kept += kk
            else:
                if k == "identity" and isinstance(r.get(k), list) and isinstance(v, list):   # hook c135: say what a whole set drops
                    tg = lambda L: {w for x in L if isinstance(x, dict) for w in (x.get("with") or [])}
                    gone = sorted(tg(r[k]) - tg(v))
                    if gone:
                        print(f"apply-shard-enrich: NOTE {base}: {e.get('id')}: identity set whole; with-target(s) no longer named: {gone}")
                elif k == "aka" and isinstance(r.get(k), list) and isinstance(v, list):
                    gone = [x for x in r[k] if x not in v]
                    if gone:
                        print(f"apply-shard-enrich: NOTE {base}: {e.get('id')}: aka set whole; aka no longer held: {gone}")
                r[k] = v
        n += 1
    if not DRY:
        save(sp, S); open(f + ".APPLIED", "w").write("applied\n")
    enriched += n
    print(("DRY " if DRY else "") + f"apply-shard-enrich: {base}: {n} row(s) enriched in {slug}/{kind}.json"
          + (f" | missing ids {missing}" if missing else ""))
    if kept:
        print(("DRY " if DRY else "") + f"apply-shard-enrich: {base}: tenures merged by promotion; {kept} stint(s) of promotions the rows do not name kept (hook c135)")
print(("DRY " if DRY else "") + f"apply-shard-enrich: {enriched} row(s) enriched from {len(sorted(files))} file(s)")
