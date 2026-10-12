#!/usr/bin/env python3
"""data/promotion-dates.json — when each wing was ADDED to the museum and last UPDATED by a landing (the Janitor 2026-09-20:
"it would be nice to be able to sort promotions on when they were added or updated … I don't have a great way to manually
check anything as it lands"). One row per promotion id: {added: YYYY-MM-DD, updated: YYYY-MM-DD}.
  added   = the day the wing's page or shard first entered the repo (git history), or today for a wing not yet committed
  updated = the latest of: added, the newest served_since of the wing's documents, and any date apply-delta stamped when a
            wave touched the wing (apply-delta calls touch(wings) at apply time; the standing regen never counts as an update)
Idempotent; a standing fixer (ORDER.txt) so every cycle keeps it whole; never moves a date backwards."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import json, re, subprocess, sys, time
DF = f"{_ROOT}/data/promotion-dates.json"
def load():
    try: return json.load(open(DF, encoding="utf-8"))
    except Exception: return {"_schema_version": 1, "dates": {}}
def save(d):
    d["dates"] = dict(sorted(d["dates"].items()))
    json.dump(d, open(DF + ".tmp", "w", encoding="utf-8"), ensure_ascii=False, indent=1); open(DF + ".tmp", "a").write("\n"); _os.replace(DF + ".tmp", DF)
def touch(wings, day=None):
    """apply-delta.py calls this with the wings a wave touched: updated = today (added too, if new)."""
    day = day or time.strftime("%Y-%m-%d"); d = load(); n = 0
    for w in wings:
        if not w: continue
        r = d["dates"].setdefault(w, {"added": day, "updated": day})
        if r.get("updated", "") < day: r["updated"] = day; n += 1
    save(d); return n
def main():
    d = load(); dates = d["dates"]; today = time.strftime("%Y-%m-%d")
    P = json.load(open(f"{_ROOT}/data/promotions.json", encoding="utf-8"))["promotions"]; ids = [p["id"] for p in P]
    # git first/last dates per wing (one walk, ~1 s)
    first = {}
    try:
        out = subprocess.run(["git", "log", "--name-only", "--format=%H%x09%ad", "--date=short", "--", "promotions", "data/shards"], cwd=_ROOT, capture_output=True, text=True).stdout
        day = None
        for line in out.split("\n"):
            if re.match(r"^[0-9a-f]{40}\t", line): day = line.split("\t")[1]; continue
            m = re.match(r"^(?:promotions|data/shards)/([^/]+)/", line)
            if m and day: first[m.group(1)] = min(first.get(m.group(1), day), day)
    except Exception as e: print("stamp-promotion-dates: git walk failed:", e, file=sys.stderr)
    # newest served document per wing
    newest = {}
    try:
        D = json.load(open(f"{_ROOT}/data/documents.json", encoding="utf-8")); D = D["documents"] if isinstance(D, dict) else D
        for doc in D:
            w, s = doc.get("wing"), str(doc.get("served_since") or "")[:10]
            if w and re.match(r"^\d{4}-\d{2}-\d{2}$", s): newest[w] = max(newest.get(w, s), s)
    except Exception as e: print("stamp-promotion-dates: documents read failed:", e, file=sys.stderr)
    added_n = upd_n = 0
    for w in ids:
        r = dates.get(w)
        if r is None:
            r = dates[w] = {"added": first.get(w, today), "updated": first.get(w, today)}; added_n += 1
        cand = max(r["updated"], r["added"], newest.get(w, ""))
        if cand != r["updated"]: r["updated"] = cand; upd_n += 1
    for w in list(dates):
        if w not in set(ids): del dates[w]  # a withdrawn wing leaves the file
    save(d); print(f"stamp-promotion-dates: {len(dates)} wings | added {added_n} | updated {upd_n}")
if __name__ == "__main__": main()
