#!/usr/bin/env python3
"""apply-pages-withdraw.py <wave-dir> [--check] — withdraw served pages from the live site (hook c248, 2026-10-10).

THE OCCASION. The Janitor, 2026-10-10 (GAVELS, the IWA is living): "At the very least we could fix the dates and only serve
the comments to about it". A living promotion is never served (CURATION v75, v100); a wing whose promotion is found to be
alive keeps only the community's commentary about it. The house had no standing way for a WAVE to take a served page down:
the 2026-09-03 withdrawals (and BIOFILL's, 2026-10-02) ran the coordinator's own withdraw-pages.py on the live tree.

THE FILE. delta/data/pages-withdraw.json: [{page, wing, msg_id, reason}]
  page    "/promotions/<wing>/(archive|rp|news)/<file>.html", a page that is served now;
  wing    the wing that page belongs to (the path's own wing, and a promotions.json row);
  msg_id  a source identifier its documents.json row carries (sources[].msg_id, or .url/.identifier): the guard that the
          page withdrawn is the document the wave read, not a later page that took its name;
  reason  why, in plain words (workshop record; never served).

WHAT IT DOES, for each row, all or nothing:
  1. copies the page to the workshop's collect-never-serve/<wing>/ (a different file already there under that name is
     never overwritten: the copy takes a dated name beside it), reads the copy back byte for byte;
  2. removes the page from the museum tree (the chain's `git add -A` stages the removal; r2-sync prunes it);
  3. drops the page's documents.json row (the file's own indent; written once, through a temporary file).
  The wing's holdings pages are rebuilt from the directory by the gate's cross-reference build, so nothing else is edited.

WHAT IT REFUSES (nothing written; --check prints each as "PROBLEM: ..." and exits 1):
  - a malformed row, a page outside promotions/<wing>/(archive|rp|news)/, a wing with no promotions.json row;
  - a served page with no documents.json row, or whose row carries no source matching msg_id;
  - a page that is not served and was not withdrawn by this applier (no workshop copy, or its documents row remains);
  - a shard record of the wing (shows `page`, rps `served_url`, or any record naming the page) still citing the page,
    unless the same wave retires that record in delta/data/<kind>-retire.json (apply-shard-paths runs first in A3);
  - a page-corrections.json row of the same wave aimed at a page it also withdraws.
  A page already withdrawn (absent, its workshop copy present, no documents row) is "done" and skipped: idempotent.
Env: MUSEUM_ROOT (default: the museum this script sits in), WORKSHOP_ROOT (default: <museum>/../archive).
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
import json, os, re, sys, shutil, filecmp, datetime

PAGE_RE = re.compile(r"^/promotions/([a-z0-9][a-z0-9-]*)/(archive|rp|news)/([A-Za-z0-9][A-Za-z0-9._-]*\.html)$")
KINDS = ("awards", "characters", "reigns", "rps", "shows", "titles", "units")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    check = "--check" in sys.argv[1:]
    if len(args) != 1: sys.exit("usage: apply-pages-withdraw.py <wave-dir> [--check]")
    W = args[0].rstrip("/"); F = f"{W}/delta/data/pages-withdraw.json"
    if not os.path.isfile(F): sys.exit(f"REFUSED: {F} not found")
    if not check and _live_running("scripts/gate\\.sh", _ROOT): sys.exit("REFUSED: a gate is running")
    M = _ROOT; probs = []
    try:
        rows = json.load(open(F, encoding="utf-8"))
    except Exception as e:
        print(f"PROBLEM: pages-withdraw.json does not parse ({e})"); print("PAGES-WITHDRAW 0 row(s): unreadable"); sys.exit(1)
    if not isinstance(rows, list) or not rows: probs.append("pages-withdraw.json must be a non-empty list of {page, wing, msg_id, reason}")
    rows = rows if isinstance(rows, list) else []
    promos = {p.get("id") for p in json.load(open(f"{M}/data/promotions.json", encoding="utf-8"))["promotions"] if isinstance(p, dict)}
    DP = f"{M}/data/documents.json"; DRAW = open(DP, encoding="utf-8").read(); DJ = json.loads(DRAW)
    docs_by_page = {}
    for r in DJ["documents"]:
        if isinstance(r, dict): docs_by_page.setdefault(r.get("page"), []).append(r)
    retired = set()
    for k in KINDS:
        rf = f"{W}/delta/data/{k}-retire.json"
        if os.path.isfile(rf):
            try: retired |= {(k, x.get("id")) for x in json.load(open(rf, encoding="utf-8")) if isinstance(x, dict)}
            except Exception: probs.append(f"delta/data/{k}-retire.json does not parse")
    pc_pages = set()
    pcf = f"{W}/delta/data/page-corrections.json"
    if os.path.isfile(pcf):
        try: pc_pages = {"/" + str(x.get("page", "")).lstrip("/") for x in json.load(open(pcf, encoding="utf-8")) if isinstance(x, dict)}
        except Exception: probs.append("delta/data/page-corrections.json does not parse")
    todo, done, seen = [], [], set()
    for i, r in enumerate(rows):
        tag = f"row {i}"
        if not isinstance(r, dict) or set(r) - {"page", "wing", "msg_id", "reason"} or not all(isinstance(r.get(k), str) and r.get(k).strip() for k in ("page", "wing", "msg_id", "reason")):
            probs.append(f"{tag}: needs exactly {{page, wing, msg_id, reason}}, each a non-empty string"); continue
        page = r["page"]; tag = page; m = PAGE_RE.match(page)
        if not m: probs.append(f"{tag}: not a /promotions/<wing>/(archive|rp|news)/<file>.html page"); continue
        if m.group(1) != r["wing"]: probs.append(f"{tag}: the path's wing is {m.group(1)}, the row says {r['wing']}"); continue
        if r["wing"] not in promos: probs.append(f"{tag}: no promotions.json row {r['wing']}"); continue
        if page in seen: probs.append(f"{tag}: named twice"); continue
        seen.add(page)
        if page in pc_pages: probs.append(f"{tag}: the same wave also corrects this page (page-corrections.json); a withdrawn page takes no correction")
        live = os.path.join(M, page.lstrip("/")); keep = os.path.join(_WORKSHOP, "collect-never-serve", r["wing"], m.group(3))
        drows = docs_by_page.get(page, [])
        if os.path.lexists(live):
            if os.path.islink(live) or not os.path.isfile(live): probs.append(f"{tag}: not a regular file"); continue
            if len(drows) != 1: probs.append(f"{tag}: served, with {len(drows)} documents.json row(s) (exactly one expected)"); continue
            ids = set()
            for s in drows[0].get("sources") or []:
                if isinstance(s, dict): ids |= {str(s.get(k)) for k in ("msg_id", "url", "identifier") if s.get(k)}
            if r["msg_id"] not in ids and not any(r["msg_id"] in x for x in ids):
                probs.append(f"{tag}: its documents.json row carries no source {r['msg_id']} (is this still the document the wave read?)"); continue
            todo.append((r, live, keep))
        else:
            if drows: probs.append(f"{tag}: not served, but its documents.json row remains (withdrawn by hand? judge it before re-running)"); continue
            if not os.path.isfile(keep): probs.append(f"{tag}: not served and no workshop copy at collect-never-serve/{r['wing']}/{m.group(3)}: not withdrawn by this applier"); continue
            done.append(page)
    # shard records still citing a page this file withdraws (any string value equal to the page path)
    wp = {r["page"] for r, _, _ in todo} | set(done)
    def cites(o):
        if isinstance(o, str): return o.split("#")[0] in wp
        if isinstance(o, dict): return any(cites(v) for v in o.values())
        if isinstance(o, list): return any(cites(v) for v in o)
        return False
    for wing in sorted({PAGE_RE.match(p).group(1) for p in wp}):
        for k in KINDS:
            sp = f"{M}/data/shards/{wing}/{k}.json"
            if not os.path.isfile(sp): continue
            for rec in json.load(open(sp, encoding="utf-8")):
                if isinstance(rec, dict) and cites(rec) and (k, rec.get("id")) not in retired:
                    probs.append(f"data/shards/{wing}/{k}.json {rec.get('id')}: still cites a withdrawn page; retire it in the same wave ({k}-retire.json) or re-point it first")
    for p in probs: print(f"PROBLEM: {p}")
    print(f"PAGES-WITHDRAW {len(rows)} row(s): to withdraw {len(todo)}, already withdrawn {len(done)}, problems {len(probs)}")
    if probs: sys.exit(1)
    if check or not todo: sys.exit(0)
    # ---- write: copies first (all read back), then the removals, then the one documents.json write
    stamp = datetime.date.today().isoformat()
    for r, live, keep in todo:
        os.makedirs(os.path.dirname(keep), exist_ok=True)
        dst = keep
        if os.path.exists(dst) and not filecmp.cmp(live, dst, shallow=False):
            n = 1
            while os.path.exists(f"{keep[:-5]}.withdrawn-{stamp}-{n}.html"): n += 1
            dst = f"{keep[:-5]}.withdrawn-{stamp}-{n}.html"
        if not os.path.exists(dst): shutil.copy2(live, dst)
        if not filecmp.cmp(live, dst, shallow=False): sys.exit(f"REFUSED: the workshop copy {dst} did not read back; nothing removed")
    for r, live, keep in todo: os.remove(live)
    gone = {r["page"] for r, _, _ in todo}
    DJ["documents"] = [x for x in DJ["documents"] if not (isinstance(x, dict) and x.get("page") in gone)]
    ind = 1
    for line in DRAW.split("\n", 40)[1:]:
        if line.startswith(" "): ind = len(line) - len(line.lstrip(" ")); break
    tmp = DP + ".c248.tmp"
    open(tmp, "w", encoding="utf-8").write(json.dumps(DJ, ensure_ascii=False, indent=ind) + ("\n" if DRAW.endswith("\n") else ""))
    os.replace(tmp, DP)
    print(f"apply-pages-withdraw: {os.path.basename(W)} withdrew {len(todo)} page(s) (copies in collect-never-serve/), documents.json rows dropped {len(gone)}")


main()
