# Apply a minting lane's museum-safe delta tree to the museum (gate-free window only). Usage: apply-delta.py <wave-dir> [--dry]
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,os,sys,shutil,subprocess
def _c269_write(p, raw, obj, default_indent):
    """hook c269 (lane MERGE-EVIDENCE-WINDOW-A, 2026-10-10), c245's _c245_write for the window-A appliers: write a registry
    file only when its bytes change, in the file's OWN indent (memory registry-json-indent: promotions.json 2,
    collections.json and frontier.json 1), by an atomic rename. A window-A re-dump at indent 1 made merge_evidence refuse the
    same window's merged pairs ("refused-indent", merge-batch 2026-10-10 lines 122 and 172). True when written."""
    import os as _o, re as _r, json as _j
    m = _r.match(r"[\[{][ \t]*\n( +)\S", raw[:256])
    out = _j.dumps(obj, ensure_ascii=False, indent=len(m.group(1)) if m else default_indent) + "\n"
    if out == raw: return False
    tmp = "%s.c269.%d.tmp" % (p, _o.getpid())
    with open(tmp, "w", encoding="utf-8") as fh: fh.write(out)
    _o.chmod(tmp, _o.stat(p).st_mode & 0o7777); _o.replace(tmp, p); return True
W=sys.argv[1].rstrip("/"); dry="--dry" in sys.argv; M=f"{_ROOT}"; D=f"{W}/delta"
if not dry and _live_running("scripts/gate\\.sh", _ROOT): sys.exit("REFUSED: a gate is running")
assert os.path.isdir(D), "no delta dir"
# 2026-09-25 (coordinator): NO SILENT SKIPS. This applier lands data/, promotions/, epitaphs/ and memorials/ and nothing
# else, and it used to drop anything else without a word while window.sh stamped the wave APPLIED: wave-COORD-PLACARDS'
# delta/in-memoriam.html (the four placards the Janitor approved in D3) was marked APPLIED at window 180 and never
# reached the museum. A delta carrying any other top-level path is now REFUSED before anything is touched, so the wave
# stays unapplied and says why; a root page is the coordinator's to place by hand.
_unhandled = sorted(e for e in os.listdir(D) if e not in ("data", "promotions", "epitaphs", "memorials", "galleries"))
if _unhandled: sys.exit(f"REFUSED: {W} delta carries path(s) this applier does not land: {_unhandled} (nothing applied)")
# THE MEMORIAL GALLERY IMAGES (hook c98, 2026-10-06; the Janitor: "We only serve images on memorials"; D409 picked the
# images of wave-MEMORIAL-GALLERIES-1006, D411 approved this landing). delta/galleries/img/characters/<file> lands a
# memorial gallery image, and nothing else under galleries/ lands. The whole tree is judged HERE, before anything is
# touched, and any one bad path refuses the wave (nothing applied):
#   - a file only directly in galleries/img/characters/, named [a-z0-9][a-z0-9._-]*, ending .jpg .jpeg .png .gif, whose
#     first bytes are that format's signature (a renamed .svg or text file is refused); no other file, no other
#     directory under galleries/, no symlink;
#   - a NEW name lands (below, after the pages); an existing served file with the SAME bytes is a no-op;
#   - an existing served file with DIFFERENT bytes refuses the wave: an image is never silently replaced;
#   - nothing is ever deleted.
# scripts/ops/land-check.py's L-DELTAPATH reports the same refusals at check time; keep the two rule lists in step.
_GAL_SUB = "galleries/img/characters"
_GAL_MAGIC = {".jpg": (b"\xff\xd8\xff",), ".jpeg": (b"\xff\xd8\xff",), ".png": (b"\x89PNG\r\n\x1a\n",), ".gif": (b"GIF87a", b"GIF89a")}
def _gallery_plan(_d, _m):
    """(new, same, bad) for <_d>/galleries against the museum <_m>: new/same are file names, bad are reasons."""
    import re as _gre, filecmp as _gfc
    new, same, bad = [], [], []
    top = os.path.join(_d, "galleries")
    if not os.path.lexists(top): return new, same, bad
    if os.path.islink(top) or not os.path.isdir(top): return new, same, ["galleries: not a directory"]
    _ok_dirs = ("galleries/img", _GAL_SUB)
    for root, dirs, files in os.walk(top):
        rel = os.path.relpath(root, _d)
        for x in sorted(dirs):
            r = f"{rel}/{x}"
            if os.path.islink(os.path.join(root, x)): bad.append(f"{r}: a symlink")
            elif r not in _ok_dirs: bad.append(f"{r}/: only {_GAL_SUB}/ lands under galleries/")
        dirs[:] = sorted(x for x in dirs if not os.path.islink(os.path.join(root, x)) and f"{rel}/{x}" in _ok_dirs)
        for fn in sorted(files):
            src = os.path.join(root, fn); r = f"{rel}/{fn}"; ext = os.path.splitext(fn)[1]
            if os.path.islink(src) or not os.path.isfile(src): bad.append(f"{r}: not a regular file"); continue
            if rel != _GAL_SUB: bad.append(f"{r}: only image files directly in {_GAL_SUB}/ land"); continue
            if ext not in _GAL_MAGIC: bad.append(f"{r}: not a .jpg .jpeg .png .gif image"); continue
            if not _gre.fullmatch(r"[a-z0-9][a-z0-9._-]*", fn): bad.append(f"{r}: a served image name is lowercase a-z 0-9 . _ - only"); continue
            with open(src, "rb") as fh: head = fh.read(8)
            if not head.startswith(_GAL_MAGIC[ext]): bad.append(f"{r}: its bytes are not a {ext[1:]} image"); continue
            dst = os.path.join(_m, _GAL_SUB, fn)
            if not os.path.lexists(dst): new.append(fn)
            elif os.path.islink(dst) or not os.path.isfile(dst): bad.append(f"{r}: the museum's {_GAL_SUB}/{fn} is not a regular file")
            elif _gfc.cmp(src, dst, shallow=False): same.append(fn)
            else: bad.append(f"{r}: differs from the image already served at /{_GAL_SUB}/{fn} (an image is never silently replaced)")
    return new, same, bad
_gal_new, _gal_same, _gal_bad = _gallery_plan(D, M)
if _gal_bad: sys.exit(f"REFUSED: {W} delta/galleries carries {len(_gal_bad)} path(s) this applier will not land: {_gal_bad[:8]}{' …' if len(_gal_bad) > 8 else ''} (nothing applied)")
# NO SILENT DROPS either: the shard merge below keeps the museum's row whenever an id already exists (bar a stub yielding
# to a full record), so a delta row that CHANGES an existing row was ignored without a word — wave-UFW-B's 124 reign
# holder re-points would have been (caught 2026-09-25 before landing; they now travel as reigns-corrections). A change
# to an existing row belongs in delta/data/<kind>-corrections-*.json. Refused here, before anything is touched.
import glob as _glob
_drops = []
for _src in sorted(_glob.glob(f"{D}/data/shards/*/*.json")):
    _dst = os.path.join(M, os.path.relpath(_src, D))
    if not os.path.exists(_dst): continue
    try: _cur = json.load(open(_dst, encoding="utf-8")); _new = json.load(open(_src, encoding="utf-8"))
    except Exception: continue
    if not (isinstance(_cur, list) and isinstance(_new, list)): continue
    _byid = {r.get("id"): r for r in _cur if isinstance(r, dict)}
    for r in _new:
        if not isinstance(r, dict): continue
        c = _byid.get(r.get("id"))
        if c is not None and c != r and not (r.get("page") and not c.get("page")): _drops.append(f"{os.path.relpath(_src, D)}:{r.get('id')}")
if _drops: sys.exit(f"REFUSED: {W} delta would CHANGE {len(_drops)} existing shard row(s), which the merge ignores — file them as "
                    f"<kind>-corrections instead: {_drops[:8]}{' …' if len(_drops) > 8 else ''} (nothing applied)")
P=f"{M}/data/promotions.json"; _c269_raw=open(P,encoding="utf-8").read(); promos=json.loads(_c269_raw); plist=promos if isinstance(promos,list) else promos["promotions"] if "promotions" in promos else next(v for v in promos.values() if isinstance(v,list))
ids={p.get("id") or p.get("slug") for p in plist}
rows=[]
for f in ("promotions-row.json","promotions-rows.json"):
    fp=f"{D}/data/{f}"
    if os.path.exists(fp): j=json.load(open(fp)); rows+= j if isinstance(j,list) else [j]
added=[]
for r in rows:
    rid=r.get("id") or r.get("slug")
    if rid in ids: print("registry row exists, skipped:",rid); continue
    plist.append(r); added.append(rid)
if not dry and added: _c269_write(P,_c269_raw,promos,2)   # hook c269: the file's own indent (was a fixed indent), and only when the content changed
print("registry rows added:",added)
copied=0; pages=0
merged=0
for root,dirs,files in os.walk(D):
    rel=os.path.relpath(root,D)
    if rel.startswith("data/shards") or rel.startswith("promotions") or rel.startswith("memorials"):
        for fn in files:
            src=os.path.join(root,fn); dst=os.path.join(M,rel,fn)
            # 2026-09-07: lane bookkeeping never enters the museum tree — pages are .html, shards are the seven <kind>.json
            if (rel.startswith("promotions") or rel.startswith("memorials")) and not fn.endswith(".html"): continue
            if rel.startswith("data/shards") and fn not in ("awards.json","characters.json","reigns.json","rps.json","shows.json","titles.json","units.json"): continue
            if fn.endswith(".html"): pages+=1
            if not dry:
                os.makedirs(os.path.dirname(dst),exist_ok=True)
                if rel.startswith("data/shards") and fn.endswith(".json") and os.path.exists(dst):
                    # 2026-09-07: sibling lanes on one wing (EPW era lanes) ship ADDITION rows; merge by id, never overwrite
                    try:
                        cur=json.load(open(dst,encoding="utf-8")); new=json.load(open(src,encoding="utf-8"))
                        if isinstance(cur,list) and isinstance(new,list):
                            byid={r.get("id"):i for i,r in enumerate(cur) if isinstance(r,dict)}
                            add=[]; upgraded=0
                            for r in new:
                                if not isinstance(r,dict): continue
                                i=byid.get(r.get("id"))
                                if i is None: add.append(r)
                                elif r.get("page") and not cur[i].get("page"):  # a stub (no page) yields to the full record
                                    cur[i]=r; upgraded+=1
                            json.dump(cur+add,open(dst,"w",encoding="utf-8"),ensure_ascii=False,indent=1); open(dst,"a").write("\n"); merged+=len(add)+upgraded; copied+=1; continue
                    except Exception as e: print("shard merge fallback (copy):",rel,fn,e)
                shutil.copy2(src,dst)
            copied+=1
print("files copied:",copied,"| shard rows merged:",merged,"| served pages:",pages,"| dry:",dry)
# THE MEMORIAL GALLERY IMAGES (hook c98): the images judged above land here, new names only. Each is written to a temporary
# dot-name in the target directory (r2-sync never uploads a dotfile), mode 0644, renamed into place (never over a name that
# exists) and read back byte for byte. An identical served copy is left as it is; nothing is deleted.
if os.path.isdir(f"{D}/galleries"):
    import tempfile as _gtf, filecmp as _gfc2
    _gdir = os.path.join(M, _GAL_SUB)
    for _gfn in ([] if dry else _gal_new):
        os.makedirs(_gdir, exist_ok=True)
        _gsrc = os.path.join(D, _GAL_SUB, _gfn); _gdst = os.path.join(_gdir, _gfn)
        _gfd, _gtmp = _gtf.mkstemp(prefix=".c98-", dir=_gdir)
        try:
            os.close(_gfd); shutil.copyfile(_gsrc, _gtmp); os.chmod(_gtmp, 0o644)
            if os.path.lexists(_gdst): raise RuntimeError(f"{_gdst} appeared while the wave was landing")
            os.replace(_gtmp, _gdst)
        except BaseException:
            if os.path.lexists(_gtmp): os.remove(_gtmp)
            raise
        if not _gfc2.cmp(_gsrc, _gdst, shallow=False): sys.exit(f"REFUSED: {_gdst} did not read back as {_gsrc}; the wave's earlier steps have landed, so it is not APPLIED — the coordinator looks")
    print("gallery images:", len(_gal_new), "new" + (" (dry: none written)" if dry else " landed"), "| identical to the served copy, left as is:", len(_gal_same), "| dry:", dry)
ef=f"{D}/data/external-figures.json"
if os.path.exists(ef):
    mf=f"{M}/data/external-figures.json"; new=json.load(open(ef)); cur=json.load(open(mf)) if os.path.exists(mf) else []
    ids=lambda L:{(x.get("id") if isinstance(x,dict) else None) for x in (L if isinstance(L,list) else (L.get("external_figures") or L.get("figures") or []))}
    missing=ids(cur)-ids(new)
    if missing: print("external-figures.json NOT applied — delta drops existing ids:",sorted(x for x in missing if x)[:10])
    else:
        if not dry: shutil.copy2(ef,mf)
        print("external-figures.json applied: existing",len(ids(cur)),"→",len(ids(new)),"| dry:",dry)
enr=[f for f in os.listdir(f"{D}/data") if f.startswith("enrich-") and not f.startswith("enrich-frontier-")] if os.path.isdir(f"{D}/data") else []
if enr: print("ENRICH files need manual application:",enr)
# 2026-09-19 (the Janitor: "Good to proceed on 2" — the epitaph debt, CURATION #promotion-epitaphs, v68(c) prose-by-tier): an EPITAPH wave ships
# delta/epitaphs/<wing-id>.html = the block INNER (an <h2>Epitaph …AI</h2> heading + paragraphs), never a page copy. Applied here by
# replacing the wing page's existing <!-- epitaph:start/end --> block or inserting one after <!-- wingcaption:end --> (the npw skeleton
# position), and by adding the wing to data/promotion-epitaph-authorship.json as "ai" (v67(g)). Idempotent.
EP=f"{D}/epitaphs"
if os.path.isdir(EP):
    import re as _re
    AF=f"{M}/data/promotion-epitaph-authorship.json"; aj=json.load(open(AF,encoding="utf-8")); arows=aj["promotion_epitaph_authorship"]; ahave={r["promotion"] for r in arows}
    ep_done=ep_skip=0
    for fn in sorted(os.listdir(EP)):
        if not fn.endswith(".html"): continue
        wid=fn[:-5]; page=f"{M}/promotions/{wid}/index.html"
        if not os.path.exists(page): print("epitaph: no wing page for",wid,"— skipped"); ep_skip+=1; continue
        inner=open(f"{EP}/{fn}",encoding="utf-8").read().strip("\n")
        block="  <!-- epitaph:start -->\n"+inner+"\n  <!-- epitaph:end -->\n"
        t=open(page,encoding="utf-8").read()
        if _re.search(r"[ \t]*<!-- epitaph:start -->[\s\S]*?<!-- epitaph:end -->[ \t]*\n?",t):
            new=_re.sub(r"[ \t]*<!-- epitaph:start -->[\s\S]*?<!-- epitaph:end -->[ \t]*\n?",lambda m:block,t,count=1)
        elif "<!-- wingcaption:end -->" in t:
            new=t.replace("<!-- wingcaption:end -->\n","<!-- wingcaption:end -->\n"+block,1)
        else: print("epitaph: no wingcaption marker on",wid,"— skipped"); ep_skip+=1; continue
        if not dry:
            open(page,"w",encoding="utf-8").write(new)
            if wid not in ahave: arows.append({"promotion":wid,"author":"ai"}); ahave.add(wid)
        ep_done+=1
    if not dry and ep_done: json.dump(aj,open(AF,"w",encoding="utf-8"),ensure_ascii=False,indent=2); open(AF,"a").write("\n")
    print("epitaphs applied:",ep_done,"| skipped:",ep_skip,"| dry:",dry)

# 2026-09-20 (the Janitor: sort by when added/updated): every wing this wave touched is stamped in data/promotion-dates.json
try:
    import sys as _s2, glob as _g2, os as _o2; _s2.path.insert(0, _o2.path.join(M, "scripts", "fixers"))
    import importlib as _il; _spd = _il.import_module("stamp-promotion-dates".replace("-", "_")) if False else None
    _spec = _il.util.spec_from_file_location("spd", _o2.path.join(M, "scripts", "fixers", "stamp-promotion-dates.py")); _spd = _il.util.module_from_spec(_spec); _spec.loader.exec_module(_spd)
    _touched = set()
    for _f in _g2.glob(f"{D}/data/promotions-row*.json") + _g2.glob(f"{D}/data/promotions-append*.json"):
        try:
            _rows = json.load(open(_f, encoding="utf-8")); _rows = _rows if isinstance(_rows, list) else list(_rows.values())
            _touched |= {r.get("id") for r in _rows if isinstance(r, dict)}
        except Exception: pass
    for _f in _g2.glob(f"{D}/data/documents-append*.json"):
        try: _touched |= {r.get("wing") for r in json.load(open(_f, encoding="utf-8")) if isinstance(r, dict)}
        except Exception: pass
    _touched |= {_o2.path.basename(_d) for _d in _g2.glob(f"{D}/data/shards/*")} | {_o2.path.basename(_d) for _d in _g2.glob(f"{D}/promotions/*")} | {_o2.path.basename(_e)[:-5] for _e in _g2.glob(f"{D}/epitaphs/*.html")}
    _cf = f"{D}/data/registry-corrections.json"
    if _o2.path.exists(_cf):
        try:
            _cs = json.load(open(_cf, encoding="utf-8")); _cs = _cs if isinstance(_cs, list) else _cs.get("corrections", [])
            _touched |= {c.get("id") for c in _cs if isinstance(c, dict)}
        except Exception: pass
    if not dry and _touched: print("promotion-dates stamped:", _spd.touch(sorted(w for w in _touched if w)))
except Exception as _e: print("promotion-dates stamp skipped:", _e)
