#!/usr/bin/env python3
"""Standing fixer (2026-09-23, preflight 171): docs/SCHEMA.md's unminted-entrant asymmetry — sides[]/participants[] hold registered
ids only and an unresolvable entrant is simply omitted. (1) A match carrying NEITHER sides nor participants (every billed entrant
unresolved — 37 PCW rows from window 170) is not a structured match: its row is removed and its own words move to the show's notes as
"Also on the card: <billing> (<result>).". (2) A REGISTERED id named in a match's eliminations[] but
absent from its sides joins as its own singleton side (the battle-royal granularity SCHEMA names; winner_side indexes are unchanged)."""
import json, glob, os, re
def _dump(obj, path):
    # keep the file's own indent (shards are 1, promotions.json is 2) and write atomically
    try:
        with open(path, encoding="utf-8") as fh: fh.readline(); second = fh.readline()
        ind = (len(second) - len(second.lstrip(" "))) or 1
    except Exception: ind = 1
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh: json.dump(obj, fh, ensure_ascii=False, indent=ind); fh.write("\n")
    os.replace(tmp, path)
ROOT = os.environ.get("MUSEUM_ROOT") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ids = set()
for kind in ("characters", "units"):
    for f in glob.glob(f"{ROOT}/data/shards/*/{kind}.json"):
        try: ids |= {r.get("id") for r in json.load(open(f, encoding="utf-8")) if isinstance(r, dict)}
        except Exception: pass
moved = added = 0
for f in sorted(glob.glob(f"{ROOT}/data/shards/*/shows.json")):
    rows = json.load(open(f, encoding="utf-8")); changed = False
    for s in rows if isinstance(rows, list) else []:
        if not isinstance(s, dict) or not isinstance(s.get("matches"), list): continue
        keep, lines = [], []
        for m in s["matches"]:
            if isinstance(m, dict) and "sides" not in m and "participants" not in m:
                txt = str(m.get("note") or m.get("label") or "a bout").strip()
                txt = re.sub(r"^Billed on the card as\s+", "", txt).rstrip(".")
                bits = [txt]
                if m.get("result"): bits.append(f"({str(m['result']).replace('-', ' ')})")
                lines.append(" ".join(str(b) for b in bits)); moved += 1; continue
            if isinstance(m, dict) and isinstance(m.get("sides"), list):
                inside = {x for side in m["sides"] if isinstance(side, list) for x in side}
                for e in m.get("eliminations") or []:
                    w = e.get("who") if isinstance(e, dict) else None
                    if isinstance(w, str) and w in ids and w not in inside:
                        m["sides"].append([w]); inside.add(w); added += 1; changed = True
                        # 2026-09-30 (preflight 222 red): a new side is a match appearance too — this fixer runs after preflight126-fixes'
                        # appearance reconciliation, so Warpath 2006's five gauntlet entrants landed as sides with no appearance rows.
                        if not any(isinstance(a, dict) and a.get("who") == w and a.get("kind") == "match" for a in s.get("appearances") or []):
                            s.setdefault("appearances", []).append({"who": w, "kind": "match"})
            keep.append(m)
        if lines:
            s["matches"] = keep
            note = "Also on the card: " + "; ".join(lines) + "."
            s["notes"] = (s.get("notes") + " " if s.get("notes") else "") + note
            changed = True
    if changed:
        _dump(rows, f)
print(f"fix-sideless-matches: {moved} unresolvable match row(s) moved to show notes | {added} eliminated entrant(s) added as singleton sides")
