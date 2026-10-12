# Apply a minting lane's frontier deltas: data/frontier-new-rows.json (append rows) and data/enrich-frontier-<x>.json (append notes to an existing row). Usage: apply-frontier.py <delta/data dir> [--dry]
# PROPOSED (L221, not applied): the full enrichment text always goes to the
# workshop log (the frontier log's <row-key>.md), verbatim, uncapped. The
# public `notes` field is touched only when the enrichment states a plain
# visitor-facing fact (no process marker in the note text) -- never the old
# "ENRICHED <date> (<label>):" framing, which is exactly the workshop
# narration the served-text rule bars from a field visitors' browsers fetch
# directly. This also removes the silent-loss bug: notes no longer needs the
# [:6000] cap to protect against runaway growth, because growth now goes to
# the log instead of accumulating in notes.
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,sys,os,subprocess,re,datetime
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
sys.path.insert(0, f"{_TOOLS}")
from process_markers import PROCESS
D=sys.argv[1].rstrip("/"); dry="--dry" in sys.argv; M=f"{_ROOT}"
LOG_DIR=f"{_WORKSHOP}/frontier-log"
if not dry and _live_running("scripts/gate\\.sh", _ROOT): sys.exit("REFUSED: a gate is running")
P=f"{M}/data/frontier.json"; _c269_raw=open(P,encoding="utf-8").read(); fr=json.loads(_c269_raw); rows=fr["rows"]; by={r["name"]:r for r in rows}; added=[]; enriched=[]
p=f"{D}/frontier-new-rows.json"
if os.path.exists(p):
    _nr=json.load(open(p))  # 2026-10-01 (lane GATE-DETECTOR-FIX): the envelope {"rows": [...]} too, as the enrich branch below reads it (L394); wave-FW-HUB-H2-A/B/C crashed here every window since 189
    for r in (_nr["rows"] if isinstance(_nr, dict) and isinstance(_nr.get("rows"), list) else _nr):
        if r.get("name") in by: print("frontier row exists:",r["name"]); continue
        r={k:v for k,v in r.items() if v is not None}   # 2026-10-01 D149: a null field reds the validator; absent is the right shape
        rows.append(r); added.append(r.get("name"))

def row_key(name):
    s=name.lower(); s=re.sub(r"[^a-z0-9]+","-",s).strip("-"); s=re.sub(r"-+","-",s)
    return (s or "row")[:80]

def log_append(name, label, text):
    # Verbatim, uncapped, workshop-side. Idempotent-friendly: always appends
    # a new dated section rather than rewriting the file, so a re-run of the
    # same delta directory (this script's own docstring says nothing about
    # dedup on notes today either) just adds a second identical section --
    # acceptable for a log, unlike the old behavior which could double up
    # inside the capped, served notes field.
    os.makedirs(LOG_DIR, exist_ok=True)
    path=f"{LOG_DIR}/{row_key(name)}.md"
    if not os.path.exists(path):
        with open(path,"w",encoding="utf-8") as f:
            f.write(f"# {name}\n\nFull enrichment history for this frontier row, verbatim. The public `notes` field on the row carries only visitor-facing facts; this file is the workshop record apply-frontier.py writes every enrichment to.\n\n")
    with open(path,"a",encoding="utf-8") as f:
        f.write(f"## {label}\n\n{text}\n\n")


# hook c217 (2026-10-09, lane FRONTIER-APPLIER): an enrich item may carry `status`, `held_as` and `url` alongside notes_replace
# or alone. held_as is a data/promotions.json wing id and goes only on a "held" row (the shape the held_as rows on file have);
# `url: null` removes a wrong address. Each field changes only when the row differs, so a re-run of the same wave is a
# no-op (no rewrite, no second log section); the frontier log notes each change once. An item that fails validation
# changes nothing on its row. (Before: a notes_replace item hit `continue` ahead of the setters, held_as had no setter and
# a url could not be cleared, so wave GCW-FRONTIER-FIX-1009 could correct only the notes.)
# hook c264 (2026-10-10, lane CORRECTIONS-1010-NIGHT): last_checked, last_activity, site_online and check_cadence are field
# keys too, type-checked in _set_fields (ISO date not after today; integer year 1970..this year; true/false; the validator's
# FRONTIER_CADENCE) and set only when the row differs in value and type. (Before: a notes_replace item's last_checked was
# dropped, and last_activity / site_online had no setter, so a row reopened as verified-alive kept a stale last_activity.)
_C264_KEYS=("last_checked","last_activity","site_online","check_cadence")
def _c264_ok(k, v):
    if k=="last_checked":
        if not (isinstance(v,str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}",v)): return False
        try: return datetime.date.fromisoformat(v)<=datetime.date.today()
        except ValueError: return False
    if k=="last_activity": return isinstance(v,int) and not isinstance(v,bool) and 1970<=v<=datetime.date.today().year
    if k=="site_online": return isinstance(v,bool)
    if k=="check_cadence": return v in ("weekly","monthly","quarterly")
    return False
_FIELD_KEYS=("status","held_as","url")+_C264_KEYS; _TARGET_KEYS=("target_row","target","name"); _WING_IDS=None
def _fields_only(e):
    ks=[k for k in e if k not in _TARGET_KEYS]
    return bool(ks) and all(k in _FIELD_KEYS or k=="notes_replace" for k in ks) and any(k in e for k in _FIELD_KEYS)
def _wing_ids():
    global _WING_IDS
    if _WING_IDS is None:
        _p=json.load(open(f"{M}/data/promotions.json",encoding="utf-8")); _ps=_p if isinstance(_p,list) else (_p.get("promotions") or [])
        _WING_IDS={x.get("id") for x in _ps if isinstance(x,dict) and x.get("id")}
    return _WING_IDS
def _set_fields(row, e, tgt):
    new={}
    if e.get("notes_replace"):
        nt=str(e["notes_replace"]).strip()
        if nt!=(row.get("notes") or ""): new["notes"]=nt
    if e.get("status") not in (None,""):
        st=str(e["status"]).strip()
        if st not in (fr.get("_status_values") or []): print("frontier field set refused:",tgt,"| unknown status",repr(st)); return False
        if st!=row.get("status"): new["status"]=st
    if "held_as" in e:
        ha=e["held_as"].strip() if isinstance(e["held_as"],str) else ""
        if not ha or ha not in _wing_ids(): print("frontier field set refused:",tgt,"| held_as is not a wing id:",repr(e["held_as"])); return False
        if ha!=row.get("held_as"): new["held_as"]=ha
    if "url" in e:
        u=e["url"]
        if u is None:
            if "url" in row: new["url"]=None
        elif isinstance(u,str) and u.strip():
            if u.strip()!=row.get("url"): new["url"]=u.strip()
        else: print("frontier field set refused:",tgt,"| url must be an address or null:",repr(u)); return False
    for k in _C264_KEYS:  # hook c264
        if k not in e: continue
        v=e[k]
        if not _c264_ok(k,v): print("frontier field set refused:",tgt,"|",k,"has a bad value:",repr(v)); return False
        if not (k in row and type(row[k]) is type(v) and row[k]==v): new[k]=v
    if new.get("held_as",row.get("held_as")) and new.get("status",row.get("status"))!="held":
        print("frontier field set refused:",tgt,"| held_as needs status held, the row would read",repr(new.get("status",row.get("status")))); return False
    if not new: return False
    today=datetime.date.today().isoformat()
    if "notes" in new:
        log_append(tgt, f"NOTES REPLACED {today} (previous text)", str(row.get("notes") or "")); row["notes"]=new.pop("notes")
    if new:
        log_append(tgt, f"FIELDS SET {today}", "\n".join(f"- {k}: {row.get(k) if row.get(k) not in (None,'') else '(none)'} -> {v if v is not None else '(cleared)'}" for k,v in new.items()))
        for k,v in new.items():
            if v is None: row.pop(k,None)
            else: row[k]=v
    return True

for fn in sorted(os.listdir(D)):
    if (fn.startswith("enrich-frontier-") and fn.endswith(".json")) or fn == "frontier-corrections.json":  # 2026-09-26: frontier-corrections.json had no applier
        loaded=json.load(open(f"{D}/{fn}")); items=loaded if isinstance(loaded,list) else (loaded.get("rows") or loaded.get("enrichments") or loaded.get("corrections") or [loaded])  # L394 (2026-09-06): envelope files {"rows": [...]}
        for e in items:
          raw=str(e.get("target_row") or e.get("target") or e.get("name") or "")
          m=re.search(r'name="([^"]+)"',raw); tgt=m.group(1) if m else raw.strip(); row=by.get(tgt)
          if not row and tgt: row=next((r for r in rows if r["name"].startswith(tgt+" ") or r["name"]==tgt),None)
          if not row: print("frontier target not found:",tgt,"keys:",list(e.keys())[:6]); continue
          if e.get("notes_replace") or _fields_only(e):  # L339 (2026-09-06): a QA lane's full rewrite of a row's notes; the old text goes to the workshop log. hook c217: status/held_as/url ride with it or alone, each set only when the row differs
              if _set_fields(row, e, tgt): enriched.append(tgt)
              continue
          note=e.get("notes_append") or e.get("notes_addition") or e.get("note") or e.get("summary") or json.dumps({k:v for k,v in e.items() if k not in ("target_row","target","name")},ensure_ascii=False)[:800]
          today=datetime.date.today().isoformat()
          label=f"ENRICHED {today} (1997 census accession)"
          # ALWAYS log the full text, verbatim, workshop-side -- fixes the
          # cap silently dropping evidence (NCCW/WOW/IWF-WOW/GIWF-twin/WIWF
          # all hit the old [:6000] cap on notes; see wave-C90-L221/digest.md).
          log_append(tgt, label, str(note))
          # Touch PUBLIC notes ONLY for a plain visitor-facing fact -- never
          # the "ENRICHED <date> (<label>):" framing, and never when the note
          # text itself still carries a process marker (lane/wave-/COORDINATOR/
          # ledger/accession/census/msg_id/"distinct from"/etc -- the served-
          # text rule's own list, the workshop tools'
          # process_markers.py). A note that's ALL process narration (a
          # do-not-merge identity check, a citation-only correction) adds
          # nothing to what a visitor is told, so it earns no notes edit at
          # all -- the log is where it belongs, in full.
          if not PROCESS.search(note):
              sep=" | " if row.get("notes") else ""
              row["notes"]=((row.get("notes") or "")+sep+str(note).strip())
          if isinstance(e.get("memorial_linked"), bool): row["memorial_linked"] = e["memorial_linked"]  # 2026-09-26
          if isinstance(e.get("memorial"), str) and e["memorial"].strip(): row["memorial"] = e["memorial"].strip()  # 2026-10-06 (hook c92): the memorial id (a data/memorials.json id) rides with memorial_linked; it was dropped before
          for k in ("status","url","founded_year","country","language","first_seen_in","last_checked","observed_year","check_cadence"):  # 2026-09-26: + last_checked/observed_year/check_cadence  # L394 (2026-09-06): first_seen_in rewrites  # L349 (2026-09-06): country/language setters
              if e.get(k) not in (None,""): row[k]=e[k]
          if "held_as" in e or ("url" in e and e["url"] is None): _set_fields(row, {k:e[k] for k in ("status","held_as","url") if k in e}, tgt)  # hook c217
          if "last_activity" in e or "site_online" in e: _set_fields(row, {k:e[k] for k in ("last_activity","site_online") if k in e}, tgt)  # hook c264
          if e.get("language_remove"): row.pop("language",None)  # L349: drop a language tag that has no country evidence
          cp=e.get("community_presence_add")
          if cp: row["community_presence"]=(row.get("community_presence") or [])+([cp] if not isinstance(cp,list) else cp)
          row["evidence_count"]=(row.get("evidence_count") or 0)+1
          enriched.append(tgt)
if not dry and (added or enriched): _c269_write(P,_c269_raw,fr,1)   # hook c269: the file's own indent (was a fixed indent), and only when the content changed
print("frontier rows added:",added,"| enriched:",enriched,"| dry:",dry)
