#!/usr/bin/env python3
"""fold-privacy-fragment.py <wave-dir> — THE FOLD (2026-09-20, cycle 151 gate red): when a wave is applied, its privacy
fragment (the lane's allow/deny rows, mirrored as the ledger's pending fragment <wave>.tsv) is appended to the main ledger
the workshop's redaction-ledger.tsv — exact-duplicate rows skipped — and the mirror removed. Until 2026-09-20 nothing did this
automatically: the gate reads only the main ledger, so a lane's wing-scoped allows were not in force and its denies not
enforced tree-wide (the epitaph lanes' fragments were folded by hand). Idempotent; a wave without a fragment is a no-op."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
import sys, os
W = sys.argv[1].rstrip("/"); name = os.path.basename(W)
L = f"{_WORKSHOP}/privacy/redaction-ledger.tsv"; frag = f"{W}/privacy-fragment.tsv"; mirror = f"{_WORKSHOP}/privacy/ledger-pending/{name}.tsv"
src = frag if os.path.exists(frag) else (mirror if os.path.exists(mirror) else None)
if not src: print(f"fold-privacy-fragment: {name}: no fragment"); sys.exit(0)
have = set(l.rstrip("\n") for l in open(L, encoding="utf-8", errors="replace"))
added = 0; skipped = 0
with open(L, "a", encoding="utf-8") as out:
    for l in open(src, encoding="utf-8", errors="replace"):
        s = l.rstrip("\n")
        if not s.strip() or s.startswith("#") or s.lower().startswith("term\t"): continue
        if s.split("\t")[0].strip() == "" or len(s.split("\t")) < 3: continue
        if s in have: skipped += 1; continue
        out.write(s + "\n"); have.add(s); added += 1
if os.path.exists(mirror): os.remove(mirror)
open(f"{W}/privacy-fragment.FOLDED", "w").write(f"folded into the main ledger: {added} row(s) added, {skipped} duplicate(s) skipped\n")
print(f"fold-privacy-fragment: {name}: {added} row(s) folded, {skipped} duplicate(s), mirror removed")
