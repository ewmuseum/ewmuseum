#!/usr/bin/env python3
"""Landing checks for a census/accession delta dir. Usage: land-check.py <wave-dir>
Prints: privacy hits (term shown only by index into a masked list), shape problems, fragment scope problems, frontier_row target mismatches."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json as _j, os as _o, sys as _s
def _known_acc():
    ids=set()
    try:
        c=_j.load(open(f'{_ROOT}/data/collections.json',encoding='utf-8')); cl=c if isinstance(c,list) else next(v for v in c.values() if isinstance(v,list)); ids|={x['id'] for x in cl}
    except Exception: pass
    for a in _s.argv[1:]:
        p=_o.path.join(a,'delta/data/collections-rows.json')
        if _o.path.exists(p):
            try: ids|={r['id'] for r in _j.load(open(p,encoding='utf-8'))}
            except Exception: pass
    return ids
KNOWN_ACC=_known_acc()
import sys,os,json,re,glob,subprocess,collections
import os
W=sys.argv[1].rstrip("/")
if not os.path.isdir(W) or not os.path.isdir(W+"/delta"): sys.exit(f"LAND-CHECK: ERROR — {W} is not a wave directory (no delta/); a missing wave is never a clean one (2026-09-19)")
A=f"{_WORKSHOP}"; M=f"{_ROOT}"
name=os.path.basename(W)
# ---- MEMORIAL-EXEMPTION-01 (2026-09-24, the Janitor's standing ruling — GAVELS evening RULINGS D2:
# "anyone added to the memorial section should remove restrictions on naming them"; D5b "memorial
# exemption rules here"; CURATION #privacy v74: a name on data/memorials.json is NEVER redacted).
# The register — not a hand-filed allow row — is what exempts a memorial subject's OWN name, so
# the exempt set is built here, BEFORE any deny list, and every deny-list consumer in this file
# (L-PRIV's own term list below, L-MEM, L-MEMSCOPE) reads a list the register has already cleaned.
# ONLY the subject's own names: `name`, any `aka`, and the forename+surname short form of a
# three-or-more-part name ("Sean Williams" for "Sean Simon Williams"). A relative, a fiancée or
# anyone else named near them is a different term and stays denied.
# The relaxation is conditional on the gate actually carrying the exemption (the sentinel in
# museum/scripts/privacy-check.mjs), so land-check keeps today's stricter behaviour until the
# coordinator ports it, and relaxes the instant they do — the port is safe in either order.
_MEM_EXEMPT=set()
try:
    _MEM_EXEMPT_WIRED = "MEMORIAL-EXEMPTION-01" in open(f"{M}/scripts/privacy-check.mjs",encoding="utf-8",errors="replace").read()
except Exception:
    _MEM_EXEMPT_WIRED = False
if _MEM_EXEMPT_WIRED:
    for _src in (f"{M}/data/memorials.json", f"{W}/delta/data/memorials-append.json"):
        try:
            _d=json.load(open(_src,encoding="utf-8")); _rs=_d["memorials"] if isinstance(_d,dict) and "memorials" in _d else _d
            for _r in (_rs if isinstance(_rs,list) else []):
                for _n in [_r.get("name")]+list(_r.get("aka") or []):
                    if not _n: continue
                    _MEM_EXEMPT.add(str(_n).lower()); _pp=str(_n).split()
                    if len(_pp)>2: _MEM_EXEMPT.add(f"{_pp[0]} {_pp[-1]}".lower())
        except Exception: pass
def _mem_exempt(t,cls="",note=""):
    """True where a term is a memorial subject's own name AND has not been ruled a namesake
    (class real-name-collision / the token MEMORIAL-COLLISION — the one explicit escape hatch,
    CURATION's own "James F" coincidence precedent). Same predicate privacy-check.mjs uses."""
    return t.strip().lower() in _MEM_EXEMPT and cls.strip()!="real-name-collision" and "MEMORIAL-COLLISION" not in note
# ---- deny terms
terms=set()
# TAKEDOWN JOINED FORMS (hook c50, lane TAKEDOWN-MACHINERY 2026-10-04): a GLOBAL #takedown-policy deny row of two or more
# letter/digit runs is also searched with its runs joined by nothing, "-", "_", ".", "+" or "%20" (a full name fused into
# an image URL, a dot-joined speaker label), letters/digits only at its edges. The same rule as privacy-check.mjs (c50).
# Only takedown rows: every real-name row in joined forms would flood. term -> (compiled lowercase regex, prefilter run)
_TD_JOIN={}
_TD_SEP=r"(?:|[-_.+]|%20)"
def _td_joined(term):
    runs=re.findall(r"[^\W_]+",term.lower())
    if len(runs)<2: return None
    return (re.compile(r"(?<![^\W_])"+_TD_SEP.join(re.escape(r) for r in runs)+r"(?![^\W_])"), max(runs,key=len))
# WRAPPED TERMS (hook c274, lane PRIVACY-WRAPPED-TERMS, 2026-10-11). A served Usenet post is HARD-WRAPPED: lane IIWF-P02
# found a 1996 post whose first word ended one line and whose surname began the next, and every scan here read green,
# because a deny term is searched as written (one space) in text whose gap is "\n", "\n" plus indentation, "<br>" or a
# JSON "\n" escape. So a term of two or more whitespace-separated words is ALSO searched with its words joined by a gap
# of whitespace, non-breaking-space entities, escaped \n/\r/\t and whole tags, as long as that gap carries at least one
# real whitespace-like character: "A\nB", "A\n   B", "A<br>\nB", "A  B" and a JSON "A\nB" all match, while "AB" (fused,
# no gap -- that is the takedown-only joined form above) and "A said. B" (a word in the gap) do not. The gap is bounded
# (40 whitespace characters, entities or INLINE tags either side of the whitespace) so a term's words a page apart never
# fuse, and the tags allowed in the gap are inline only -- a block boundary (</p>, <hr>, <h2>, <td>) is not a wrap.
# The same rule as museum/scripts/privacy-check.mjs and the workshop's privacy-lookup.py carry (hook c274).
_FLEX_ENT=r"&nbsp;|&#160;|&#[xX]0*[aA]0;|\\[nrt]"
_FLEX_TAG=r"</?(?:strong|nobr|small|span|font|code|big|sup|sub|wbr|em|br|tt|b|i|u|a)(?=[\s/>])[^<>]{0,160}>"
# ONE deterministic parse of a gap (greedy whitespace, then an entity or inline tag, then whitespace again, bounded):
# this hook's first shape joined bounded TOKENS either side of one mandatory whitespace, which a 5+-word term made
# exponential (every way of splitting a whitespace run between the two sides) -- it hung a tree-wide scan for ten
# minutes at 100% CPU. There is no such choice here, so the cost is linear in the gap however long the term.
_FLEX_WSSEG=r"[^\S\n]{0,40}(?:\n[^\S\n]{0,40})?"   # at most ONE line break per gap segment: a wrap, never a blank line
_FLEX_GAP=r"(" + _FLEX_WSSEG + r"(?:(?:" + _FLEX_ENT + r"|" + _FLEX_TAG + r")" + _FLEX_WSSEG + r"){0,6})"
_FLEX_WSLIKE=re.compile(r"\s|&nbsp;|&#160;|&#[xX]0*[aA]0;|\\[nrt]|</?(?:br|wbr)(?=[\s/>])[^<>]{0,160}>", re.I)
_FLEX_MAX_WORDS=6   # a wrapped NAME, never a sentence: six ledger rows carry 46-924 words in column 1, and a long row's
                    # flexible walk costs words x positions on every page sharing its vocabulary (it hung a tree-wide
                    # scan). Such a row is still matched as written, and in its joined form, exactly as before.
_FLEX={}
_WRAPPED={}
def _flex_of(t):
    """(compiled lowercase regex, lowercased words) for a multi-word term, else None."""
    if t not in _FLEX:
        _w=[x for x in re.split(r"\s+",t.strip()) if x]
        if len(_w)>_FLEX_MAX_WORDS: _w=[]   # a wrapped NAME, never a sentence (see _FLEX_MAX_WORDS)
        _rs=_FLEX_RUN.findall(t.lower()); _m0=_FLEX_RUN.search(t.lower())
        _FLEX[t]=(re.compile(r"(?<![A-Za-z0-9])"+_FLEX_GAP.join(re.escape(x.lower()) for x in _w)+r"(?![A-Za-z0-9])"),
                  [x.lower() for x in _w], _rs, (_m0.start() if _m0 else 0)) if len(_w)>=2 and _rs else None
    return _FLEX[t]
def _flex_gap_ok(_m):
    """every gap between the term's words must carry a real whitespace-like character (a space, a newline, an &nbsp;
    entity, an escaped \n, a <br>/<wbr>) -- "AB" fused is the takedown-only joined form above, not a wrap"""
    return all(_FLEX_WSLIKE.search(_g) for _g in _m.groups())
# ANCHORED, never a scan of the whole text per term: one pass per text indexes every letter/digit run to its offsets
# and a term is tried only AT the offsets of its own first run. One scan per term is what stalled this lane's first
# tree-wide scan on data/appearances-index.json (62 MB x 8,351 multi-word rows).
_FLEX_RUN=re.compile(r"[^\W_]+",re.UNICODE)
_FLEX_IX=[None,None]   # an LRU of one: the caller loops its terms over a single text
def _flex_index(low):
    _k=(id(low),len(low))
    if _FLEX_IX[0]!=_k:
        _mp={}
        for _m in _FLEX_RUN.finditer(low): _mp.setdefault(_m.group(0),[]).append(_m.start())
        _FLEX_IX[0],_FLEX_IX[1]=_k,_mp
    return _FLEX_IX[1]
def _flex_hit(t,low):
    _f=_flex_of(t)
    if not _f: return False
    _rx,_ws,_runs,_off=_f
    _ix=_flex_index(low)
    if any(_x not in _ix for _x in _runs): return False
    for _p in _ix[_runs[0]]:
        if _p<_off: continue
        _m=_rx.match(low,_p-_off)
        if _m is not None and _flex_gap_ok(_m): return True
    return False
def load(p):
    for l in open(p,encoding="utf-8",errors="replace"):
        if l.startswith("#") or not l.strip(): continue
        c=l.rstrip("\n").split("\t")
        if len(c)>=3 and c[2].strip()=="deny" and len(c[0].strip())>=4 and not _mem_exempt(c[0],(c[1] if len(c)>1 else ""),(c[5] if len(c)>5 else "")):
            terms.add(c[0].strip())
            if len(c)>5 and "#takedown-policy" in c[5] and not (len(c)>3 and c[3].strip()):
                _j=_td_joined(c[0].strip())
                if _j: _TD_JOIN[c[0].strip()]=_j
load(f"{A}/privacy/redaction-ledger.tsv")
for f in glob.glob(f"{A}/privacy/ledger-pending/*.tsv"): load(f)
tl=sorted(terms); tf=f"{_SCRATCH}/deny-global-all.txt"
open(tf,"w").write("\n".join(tl)+"\n")
files=[p for p in glob.glob(f"{W}/**/*",recursive=True) if os.path.isfile(p)]
hits=collections.defaultdict(list)
for p in files:
    try: txt=open(p,encoding="utf-8",errors="replace").read()
    except: continue
    low=txt.lower()
    for t in tl:
        tlw=t.lower()
        if tlw in low and re.search(r'(?<![A-Za-z0-9])'+re.escape(tlw)+r'(?![A-Za-z0-9])',low):
            hits[t].append(os.path.relpath(p,W))
        elif t in _TD_JOIN and _TD_JOIN[t][1] in low and _TD_JOIN[t][0].search(low):   # hook c50: a takedown name, joined
            hits[t].append(os.path.relpath(p,W))
        elif _flex_hit(t,low):   # hook c274: the term WRAPPED across a line break, indentation, a tag or a JSON escape
            hits[t].append(os.path.relpath(p,W)); _WRAPPED.setdefault(t,[]).append(os.path.relpath(p,W))
print(f"== {name}: {len(files)} files, {len(tl)} deny terms")
print("-- privacy hits (term fingerprint | files):")
# 2026-10-03 (coordinator, hook c40): a term is never printed; cite it the privacy-lookup.py way, sha1 of the lowercased
# term [:8] and its length. LAND_CHECK_SHOW_TERMS=1 restores the old output.
import hashlib as _hl
for t,fs in sorted(hits.items(), key=lambda kv: _hl.sha1(kv[0].lower().encode()).hexdigest()):
    _lab = repr(t) if os.environ.get("LAND_CHECK_SHOW_TERMS") == "1" else f"sha1:{_hl.sha1(t.lower().encode()).hexdigest()[:8]} len {len(t)}"
    print(f"   {_lab:32} {len(fs)} file(s): {', '.join(fs[:4])}")
if _WRAPPED: print(f"   note (hook c274): {sum(len(_v) for _v in _WRAPPED.values())} of these hit(s), over {len(_WRAPPED)} term(s), are a term WRAPPED across a line break, indentation, a tag or a JSON escape - matching line by line, or as written, never saw them")
if not hits: print("   none")
# ---- shape
# 2026-09-23 (window 172, vault drive away: the reference wave lives on the vault and read EIO, holding every wave): the promotion-row
# key reference falls back to the museum's own registry when the reference wave cannot be read — never a crash that holds the window
try:
    ref=json.load(open(f"{A}/usenet-retro/scratch-1997/wave-W7-M01/delta/data/promotions-rows.json"))
    refkeys=set(ref[0].keys()) if isinstance(ref,list) else set(next(iter(ref.values())).keys())
except Exception:
    # 2026-09-23 (wave-PRIME-A): the union of every key over 400 live rows made a reference no honest mint can meet (five live rows
    # carry malformed keys). Fall back to a LANDED local mint wave first; failing that, the keys a majority of live rows carry.
    try:
        ref=json.load(open(f"{A}/desk/argyle/waves/wave-HOST-NEIGHBOURS-PURE/delta/data/promotions-rows.json"))
        refkeys=set(ref[0].keys()) if isinstance(ref,list) else set(next(iter(ref.values())).keys())
    except Exception:
        import collections as _rc
        _P0=json.load(open(f"{M}/data/promotions.json")); _P0=[r for r in (_P0 if isinstance(_P0,list) else _P0.get("promotions",_P0)) if isinstance(r,dict)]
        _kc=_rc.Counter(k for r in _P0 for k in r.keys()); refkeys={k for k,n in _kc.items() if n*2>len(_P0)}
P=json.load(open(f"{M}/data/promotions.json")); Prows=(P if isinstance(P,list) else P.get("promotions",P)); live={r["id"] for r in Prows}
liveaka={a:r["id"] for r in Prows for a in (r.get("aka") or [])}; livename={r.get("name"):r["id"] for r in Prows}
F=json.load(open(f"{M}/data/frontier.json")); fnames={r.get("name") for r in (F if isinstance(F,list) else F.get("rows",F))}
# 2026-09-29 (FRONTIER-RECONCILE proposal): open rows keyed by their bare name (a trailing parenthetical qualifier dropped,
# case-folded), so a new mint whose own full_name is an open row's bare name must say which way it rules (L-FRONTIER-LAPSE).
def _fbase(s): return re.sub(r"\s+"," ",re.sub(r"\s*\([^)]*\)\s*$","",str(s or ""))).strip().lower()
fopen={}
for _fr in (F if isinstance(F,list) else F.get("rows",F)):
    if isinstance(_fr,dict) and _fr.get("status") not in ("held","mined"): fopen.setdefault(_fbase(_fr.get("name")),[]).append(_fr.get("name"))
rp=f"{W}/delta/data/promotions-rows.json"; probs=[]
# PROSE-BY-TIER (CURATION (c): tier 2 owes a house_style, tier 3 owes Storylines) — registry-validate only soft-warns; a NEW mint must carry it (2026-09-15)
import glob as _pg
for _f in _pg.glob(f"{W}/delta/data/promotions-rows.json")+_pg.glob(f"{W}/delta/data/promotions-append*.json"):
    try: _rows=json.load(open(_f))
    except Exception: continue
    for _r in (_rows if isinstance(_rows,list) else []):
        _t=str(_r.get("tier"))
        if _t in ("2","3") and not (_r.get("house_style") or "").strip(): probs.append(f"LAW prose-by-tier: mint {_r.get('id')} is tier {_t} but carries no house_style (CURATION prose-by-tier doctrine)")
        if _t in ("1","2","3"):   # CURATION #promotion-epitaphs + prose-by-tier (c): every tier-1+ mint ships an Epitaph section on its own landing page (2026-09-19)
            _ep=f"{W}/delta/promotions/{_r.get('id')}/index.html"
            if not (os.path.exists(_ep) and re.search(r"<!-- epitaph:start -->\s*<[^!]", open(_ep).read())): probs.append(f"LAW prose-by-tier: mint {_r.get('id')} is tier {_t} but its delta landing page carries no Epitaph section (CURATION #promotion-epitaphs)")
        if _t=="3":
            _pg_=f"{W}/delta/promotions/{_r.get('id')}/index.html"
            if not (os.path.exists(_pg_) and re.search(r"<!-- storylines:start -->\s*<[^!]", open(_pg_).read())): probs.append(f"LAW prose-by-tier: mint {_r.get('id')} is tier 3 but its delta page carries no Storylines section")

if os.path.exists(rp):
    rows=json.load(open(rp)); rows=rows if isinstance(rows,list) else list(rows.values())
    for r in rows:
        sid=r.get("id"); ks=set(r.keys())
        RP={"roster_policy","roster_policy_grade","roster_policy_source"}; OPT={"type","language","country","caption_en","caption_en_author","depiction","band"}  # type = THE TYPE-AXIS GAVEL; language/country/caption_en/depiction = ecosystem step 1 (optional, non-English wings carry them); 2026-09-05 (optional in deltas; window default = federation)
        _OPTX={"identity","frontier_row","aka","house_style","house_style_grade","house_style_source","scale","scale_source","play","play_grade","play_source","community_presence","qualifier",
               "aka_unlinkable","type_note","authorship","authorship_grade","authorship_source","runs","frontier_rows","frontier_distinct"}  # + frontier_distinct (hook c88, 2026-10-06: SCHEMA "frontier_row / frontier_rows / frontier_distinct")  # + runs (2026-09-25, wave-GCW-A): SCHEMA THE INTERMITTENT-PROMOTIONS EXTENSION, registry-validate checks it  # + authorship trio (2026-09-24, wave-CWMC-AWARD): SCHEMA "never guessed ... absent means undetermined"  # 2026-09-24 (wave-SCCW-A): documented optional fields registry-validate checks (v77(b) aka_unlinkable; v111(f) type_note); no live row used them yet, so the reference could not know them
        # 2026-09-23 (wave-PRIME-A, tier 0): the optional keys are optional in both directions — prose-by-tier above owes house_style
        # from tier 2, so a missing house_style on a tier-0/1 mint is not a shape error
        miss=sorted((refkeys-ks)-RP-OPT-_OPTX); extra=sorted((ks-refkeys)-OPT-_OPTX)
        extra = [k for k in extra if k not in ("url", "notes")]
        extra = [k for k in extra if not k.startswith(("authorship", "form"))]  # medium/form + authorship axes (windows 107-108)
        if miss or extra: probs.append(f"{sid}: keys differ: missing {miss} extra {extra}")
        rpk=ks&RP
        if rpk and rpk!=RP: probs.append(f"{sid}: partial roster_policy keys {sorted(rpk)}")
        if r.get("roster_policy") not in (None,"real","fantasy","blended"): probs.append(f"{sid}: roster_policy {r.get('roster_policy')!r} invalid (real|fantasy|blended, or omit all three keys)")
        if "type" in r and r["type"] not in ("federation","community-hub","interfed-alliance","tournament","academy"): probs.append(f"{sid}: type {r['type']!r} not federation|community-hub|interfed-alliance|tournament|academy")  # + academy: CURATION v120 #academy-type (2026-09-24)
        if r.get("medium") in ("community-hub","interfed-alliance","house-network"): probs.append(f"{sid}: medium {r['medium']!r} is retired — medium is the platform; put the kind in type")
        if "roster_policy" in r and r.get("roster_policy_grade") not in ("primary-source","user-attested","presumed"): probs.append(f"{sid}: roster_policy_grade {r.get('roster_policy_grade')!r} invalid")
        if sid in live or os.path.isdir(f"{M}/promotions/{sid}"): probs.append(f"{sid}: SLUG COLLIDES with a live wing")
        if r.get("name") in liveaka and liveaka[r["name"]]!=sid: probs.append(f"{sid}: name {r['name']!r} equals the aka of live wing {liveaka[r['name']]} — qualify the name (e.g. 'GWF (1995)')")
        for a in (r.get("aka") or []):
            if (a in livename and livename[a]!=sid) or (a in liveaka and liveaka[a]!=sid): probs.append(f"{sid}: aka {a!r} equals another wing's name/aka")
        for g in r.get("identity",[]) or []:
            if not g.get("with"): probs.append(f"{sid}: identity assertion with empty with")
        fr=r.get("frontier_row")
        if fr and fr not in fnames: probs.append(f"{sid}: frontier_row not an exact frontier name: {fr!r}")
        _frs=r.get("frontier_rows") or []
        if not isinstance(_frs,list): probs.append(f"{sid}: frontier_rows must be a list of exact frontier names")
        else:
            for _x in _frs:
                if _x not in fnames: probs.append(f"{sid}: frontier_rows entry not an exact frontier name: {_x!r}")
        # FRONTIER-DISTINCT (hook c88, lane MACHINERY-FRONTIER-LAPSE, 2026-10-06): `frontier_distinct` is the machine twin of
        # frontier_row/frontier_rows pointing the other way — exact names of frontier rows this wing has been ruled NOT to be.
        # Never rendered; the row it names stays open on the served frontier. The evidence is served prose the wing already
        # carries: an identity[] note saying why (THE SERVED-TEXT RULE bans the workshop phrase the old marker used, so no
        # honest wave could carry it).
        _fds=r.get("frontier_distinct")
        _fdset=set()
        if _fds is not None:
            if not isinstance(_fds,list) or not _fds or not all(isinstance(_x,str) and _x for _x in _fds):
                probs.append(f"{sid}: frontier_distinct must be a non-empty list of exact frontier names")
            else:
                _fdset=set(_fds)
                for _x in _fds:
                    if _x not in fnames: probs.append(f"{sid}: frontier_distinct entry not an exact frontier name: {_x!r}")
                    if _x==fr or (isinstance(_frs,list) and _x in _frs): probs.append(f"{sid}: frontier_distinct names {_x!r}, which frontier_row/frontier_rows says this wing IS")
                if not any(isinstance(_g,dict) and str(_g.get("note") or "").strip() for _g in (r.get("identity") or [])):
                    probs.append(f"{sid}: frontier_distinct needs the evidence in an identity[] note (why this wing is not that row)")
        # L-FRONTIER-LAPSE: a mint named like an open frontier row either points at it (frontier_row / frontier_rows) or rules
        # it out (frontier_distinct, above). Otherwise the row stays open on the served frontier beside the wing that holds it
        # (the Janitor, 2026-09-29: "Are we retiring frontier rows as we collect them?"). The older marker — the phrase
        # `not the frontier row "<exact name>"` in a provenance or identity note — is still read, but _BANNED reds it.
        _pointed={fr}|set(_frs if isinstance(_frs,list) else [])
        _said=json.dumps([r.get("provenance_notes"),r.get("identity")],ensure_ascii=False)
        _nm=_fbase(r.get("full_name"))   # the full name only: a bare acronym (the `name` field) collides by design
        for _row in (fopen.get(_nm,[]) if len(_nm.split())>=2 else []):
            if _row in _pointed or _row in _fdset: continue
            if (f'not the frontier row \\"{_row}\\"' in _said) or (f'not the frontier row "{_row}"' in _said): continue
            probs.append(f"{sid}: L-FRONTIER-LAPSE: shares its name with the open frontier row {_row!r} — name it in frontier_row/frontier_rows if this wing IS that row, or in frontier_distinct if it is not (with the evidence in an identity[] note)")
        sd=f"{W}/delta/data/shards/{sid}"
        have=sorted(os.path.basename(x) for x in glob.glob(sd+"/*.json"))
        if len(have)!=7: probs.append(f"{sid}: shards {len(have)}/7")
        for src in r.get("sources",[]) or []:
            if src.get("accession") not in KNOWN_ACC: probs.append(f"{sid}: source accession {src.get('accession')}")
        if r.get("page") and r["page"]!=f"/promotions/{sid}/": probs.append(f"{sid}: page {r['page']}")
    print(f"-- registry rows: {len(rows)}")
for sd in glob.glob(f"{W}/delta/data/shards/*/units.json"):
    for u in json.load(open(sd)):
        if u.get("type")!="unit": probs.append(f"{sd.split('/')[-2]}: unit {u.get('id')} untyped")
for sd in glob.glob(f"{W}/delta/data/shards/*/characters.json"):
    for c in json.load(open(sd)):
        g=c.get("staged_gender_grade")
        if g not in (None,"bio-explicit","pronoun-observed"): probs.append(f"{sd.split('/')[-2]}: character {c.get('id')} gender grade {g}")
# pages: marker vs declared
for pg in glob.glob(f"{W}/delta/promotions/*/**/*.html",recursive=True):
    h=open(pg,encoding="utf-8",errors="replace").read()
    # hook c208 (the Janitor's D480, 2026-10-09): both wordings count. The marker count is what a page's "carries N
    # redactions" row declares, so it must not move while the words do; the old eight are accepted until the last wave
    # built before D480 has landed.
    mk=len(re.findall(r"\[redacted\s*(?:—|&mdash;)|\[(?:name|detail) withheld\]",h))
    WORD={"one":1,"two":2,"three":3,"four":4,"five":5,"six":6,"seven":7,"eight":8,"nine":9,"ten":10,"eleven":11,"twelve":12,"no":0,"zero":0}
    provs=re.findall(r'<p class="muted small(?: provenance)?"[^>]*>[\s\S]*?</p>',h); foot=re.search(r"<footer[\s\S]*?</footer>",h)
    provtext=" ".join(provs)+(foot.group(0) if foot else "")
    ms=re.findall(r"\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+redactions?\b",provtext,re.I)
    decn=[int(x) if x.isdigit() else WORD[x.lower()] for x in ms]
    if len(decn)>1: probs.append(f"{os.path.relpath(pg,W)}: {len(decn)} 'N redaction(s)' phrases in the provenance paragraph (the checker sums them: {decn}) — keep exactly one")
    # (2026-09-22) "N markers, no declaration found" retired: the standing provenance-block fixer writes the <dl> Redactions
    # row at preflight and L-DISCLOSE checks the sum at the gate; since 2026-09-13 the line was informational noise every lane
    # escalated (C02-DEDICATED-RCW, PCW-CAPTIONS-A). A declared count that disagrees with the markers still reports.
    if decn and sum(decn)!=mk: probs.append(f"{os.path.relpath(pg,W)}: {mk} markers vs declared {decn}")
    if "archive" "/digests/" in h: probs.append(f"{os.path.relpath(pg,W)}: literal workshop-digest path")
    # (2026-09-24, preflight 174 red: two PURE cards landed a period <EMBED> of a RealAudio file on another host; validate.mjs
    # refuses any script/iframe/frame/object/embed that loads from another origin — CURATION v112(b). Remove the element, keep the words.)
    for _om in re.finditer(r'<(script|iframe|frame|object|embed)\b[^>]*\b(?:src|data)\s*=\s*"((?:https?:)?//[^"]*)"', h, re.I):
        probs.append(f"LAW L-ORIGIN: {os.path.relpath(pg,W)}: <{_om.group(1).lower()}> loads {_om.group(2)[:80]!r} from another origin — remove the element (presentation), keep the words (v112(b))")
    # (2026-09-24, SITES-B3: three served cards kept a site's image-map <area href="…"> links into the dead site; validate.mjs
    # link-checks EVERY relative href/src and fails the gate on one that does not resolve.) A RELATIVE target (no scheme, no
    # leading "/", no "#") must resolve beside the page in the delta or in the museum — else it is dead-site residue: drop it.
    _hl = re.sub(r"<script\b[^>]*>[\s\S]*?</script>", "", h, flags=re.I)
    for _lm in re.finditer(r'\b(?:href|src)\s*=\s*"([^"]*)"', _hl, re.I):
        _t = _lm.group(1).strip()
        if not _t or re.match(r'(?:[a-z][a-z0-9+.-]*:|/|#|\?)', _t, re.I): continue
        _rel_pg = os.path.relpath(pg, f"{W}/delta")
        _cand = os.path.normpath(os.path.join(os.path.dirname(_rel_pg), _t.split("#")[0].split("?")[0]))
        if not (os.path.exists(os.path.join(f"{W}/delta", _cand)) or os.path.exists(os.path.join(M, _cand)) or os.path.exists(os.path.join(M, _cand, "index.html"))):
            probs.append(f"LAW L-LINK: {os.path.relpath(pg,W)}: relative link {_t[:80]!r} resolves nowhere (validate.mjs fails the gate on it) — drop the element or its href (dead-site residue), keep the words")
    # (2026-09-22, PCW shows waves: pages decoded as cp1252 though the capture was UTF-8 served "â€™" the original readers never
    # saw) — informational: a verbatim source can genuinely carry mojibake, so the coordinator reads the note, it never fails
    _mj = len(re.findall(r"â€|Ã[©¨ª«¢¡]|�", h))
    if _mj: print(f"MOJIBAKE-NOTE {os.path.relpath(pg,W)}: {_mj} mis-decoded sequence(s) — check the source's encoding before serving")

# ---- shard id uniqueness vs the live tree (titles/reigns/characters/units ids must not exist in any other shard)
liveids={}
for sf in glob.glob(f"{M}/data/shards/*/*.json"):
    wing=sf.split("/")[-2]
    try: data=json.load(open(sf))
    except Exception: continue
    for rec in (data if isinstance(data,list) else []):
        if isinstance(rec,dict) and rec.get("id"): liveids.setdefault(rec["id"],wing)
for sf in glob.glob(f"{W}/delta/data/shards/*/*.json"):
    wing=sf.split("/")[-2]
    try: data=json.load(open(sf))
    except Exception: probs.append(f"{sf.split('/delta/')[-1]}: invalid JSON"); continue
    for rec in (data if isinstance(data,list) else []):
        if isinstance(rec,dict) and rec.get("id") and rec["id"] in liveids and liveids[rec["id"]]!=wing:
            probs.append(f"{wing}/{sf.split('/')[-1]}: id {rec['id']!r} already exists in shard {liveids[rec['id']]} — prefix it with the wing slug")
        for t in (rec.get("tenures") or []) if isinstance(rec,dict) else []:
            if isinstance(t,dict) and "roles" in t and not t["roles"]: probs.append(f"{wing}: {rec.get('id')} tenure has empty roles (omit the key)")

# ---- L-PORTRAYAL-MERGE (hook c124, 2026-10-07; CURATION v78(c)). A verify recorded mark-jindrak-tna-total-nonstop-action-2008
# and mark-jindrak-wcw-nitro-2001 as presumed-same (one handler); window 322's merge pass (merge-batch.py) folded them and
# preflight 323 stopped on registry-validate 6a ("would merge a portrayal across promotions"). One fed's portrayal of a real
# wrestler and another fed's are two records, even with the same handler. So a wave that asserts presumed-same or merged
# (any grade) between two rows, where either row carries portrayal_of and their promotions differ, is held. The promotion
# is registry-validate's portrayalPromoOf (the first tenure promotion whose id suffixes the row id), else its suffix
# fallback (the longest promotion id that suffixes the id); an unreadable promotion counts as differing, as merge-batch.py
# skips it. Rows are read as the wave leaves them: its shard rows and appends over the live shards, then its
# characters/units corrections to identity, identity[...] and portrayal_of. An edge the live row already carries, word for
# word, is a NOTE (the live registry's own edges are the coordinator's list; merge-batch.py skips them since c124).
def _v78_promo(rid, row, promo_ids):
    for t in ((row.get("tenures") or []) if isinstance(row, dict) else []):
        p = t.get("promotion") if isinstance(t, dict) else None
        if isinstance(p, str) and p and rid.endswith("-" + p): return p
    s = [p for p in promo_ids if rid.endswith("-" + p)]
    return max(s, key=len) if s else None
def _v78_cross(a, ra, b, rb, promo_ids):
    if not ((isinstance(ra, dict) and ra.get("portrayal_of")) or (isinstance(rb, dict) and rb.get("portrayal_of"))): return None
    pa, pb = _v78_promo(a, ra, promo_ids), _v78_promo(b, rb, promo_ids)
    return None if (pa and pb and pa == pb) else f"{pa or '?'} / {pb or '?'}"
def _v78_with(i): return [x for x in i.get("with") if isinstance(x, str)] if isinstance(i, dict) and isinstance(i.get("with"), list) else []
_V78_PROMOS = {r.get("id") for r in Prows if isinstance(r, dict) and isinstance(r.get("id"), str)}
for _v78_f in glob.glob(f"{W}/delta/data/promotions-rows.json") + glob.glob(f"{W}/delta/data/promotions-append*.json"):
    try: _v78_d = json.load(open(_v78_f, encoding="utf-8")); _v78_d = _v78_d.get("promotions", _v78_d) if isinstance(_v78_d, dict) else _v78_d
    except Exception: continue                                      # reported by the mint-row checks (L-SHAPE)
    for _v78_r in (_v78_d if isinstance(_v78_d, list) else list(_v78_d.values()) if isinstance(_v78_d, dict) else []):
        if isinstance(_v78_r, dict) and isinstance(_v78_r.get("id"), str): _V78_PROMOS.add(_v78_r["id"])
try:
    import copy as _v78_copy
    _v78_live = {}; _v78_rev = collections.defaultdict(set)
    for _v78_f in glob.glob(f"{M}/data/shards/*/characters.json") + glob.glob(f"{M}/data/shards/*/units.json"):
        _v78_rows = json.load(open(_v78_f, encoding="utf-8"))
        for _v78_r in (_v78_rows if isinstance(_v78_rows, list) else []):
            if isinstance(_v78_r, dict) and isinstance(_v78_r.get("id"), str): _v78_live[_v78_r["id"]] = _v78_r
    for _v78_id, _v78_r in _v78_live.items():
        for _v78_i in (_v78_r.get("identity") or []) if isinstance(_v78_r.get("identity"), list) else []:
            if isinstance(_v78_i, dict) and _v78_i.get("assertion") in ("merged", "presumed-same"):
                for _v78_x in _v78_with(_v78_i): _v78_rev[_v78_x].add(_v78_id)
    _v78_wave = {}
    for _v78_f in sorted(glob.glob(f"{W}/delta/data/shards/*/characters.json") + glob.glob(f"{W}/delta/data/shards/*/units.json") + glob.glob(f"{W}/delta/data/characters-append-*.json") + glob.glob(f"{W}/delta/data/units-append-*.json")):
        try: _v78_rows = json.load(open(_v78_f, encoding="utf-8"))
        except Exception: continue                                  # reported by the aka-collision guard
        for _v78_r in (_v78_rows if isinstance(_v78_rows, list) else []):
            if isinstance(_v78_r, dict) and isinstance(_v78_r.get("id"), str): _v78_wave[_v78_r["id"]] = _v78_copy.deepcopy(_v78_r)
    for _v78_f in sorted(glob.glob(f"{W}/delta/data/characters-corrections-*.json") + glob.glob(f"{W}/delta/data/units-corrections-*.json")):
        try: _v78_rows = json.load(open(_v78_f, encoding="utf-8"))
        except Exception: continue                                  # reported by the corrections checks
        for _v78_c in (_v78_rows if isinstance(_v78_rows, list) else []):
            _v78_fld = str(_v78_c.get("field") or "") if isinstance(_v78_c, dict) else ""
            if not (_v78_fld == "portrayal_of" or _v78_fld.startswith("identity")) or "new" not in _v78_c: continue
            _v78_id = _v78_c.get("id"); _v78_base = _v78_wave.get(_v78_id) or _v78_copy.deepcopy(_v78_live.get(_v78_id))
            if not isinstance(_v78_base, dict): continue
            try:
                _v78_keys = [k if k else int(ix) for k, ix in re.findall(r"([A-Za-z_]\w*)|\[(\d+)\]", _v78_fld)]
                _v78_cur = _v78_base
                for _v78_k in _v78_keys[:-1]: _v78_cur = _v78_cur[_v78_k]
                _v78_cur[_v78_keys[-1]] = _v78_copy.deepcopy(_v78_c["new"])
            except Exception: continue                              # a path that does not land is the corrections checks' to report
            _v78_wave[_v78_id] = _v78_base
    def _v78_view(i): return _v78_wave[i] if i in _v78_wave else _v78_live.get(i)
    _v78_n = {"edges": 0, "held": 0, "carried": 0}; _v78_seen = set()
    def _v78_judge(src, srow, i, o):
        if o == src or (src, o, i.get("assertion")) in _v78_seen: return
        _v78_seen.add((src, o, i.get("assertion")))
        orow = _v78_view(o)
        if not isinstance(orow, dict): return                       # an unknown or retired id is L-UNKNOWN-REF's to report
        _v78_n["edges"] += 1
        x = _v78_cross(src, srow, o, orow, _V78_PROMOS)
        if not x: return
        _lv = _v78_live.get(src); _lo = _v78_live.get(o)
        _was = (isinstance(_lv, dict) and isinstance(_lo, dict) and bool(_v78_cross(src, _lv, o, _lo, _V78_PROMOS))
                and any(isinstance(j, dict) and j.get("assertion") == i.get("assertion") and o in _v78_with(j) for j in (_lv.get("identity") or [])))
        _who = " and ".join(sorted({r for r, w in ((src, srow), (o, orow)) if isinstance(w, dict) and w.get("portrayal_of")}))
        if _was:
            _v78_n["carried"] += 1
            print(f"   NOTE L-PORTRAYAL-MERGE: {src} -> {o} {i.get('assertion')} is already live (promotions {x}); merge-batch.py skips it (v78(c)); it is on the coordinator's list, not this wave's")
            return
        _v78_n["held"] += 1
        probs.append(f"L-PORTRAYAL-MERGE: {src} asserts {i.get('assertion')} with {o}, but {_who} carr{'ies' if ' and ' not in _who else 'y'} portrayal_of and the two rows belong to different promotions ({x}). One fed's portrayal of a real wrestler and another fed's are two records, even with one handler (CURATION v78(c)); the window's merge pass would fold them and registry-validate refuses the alias. Write the pair as distinct, with the shared handler in the note (hook c124)")
    for _v78_id, _v78_r in _v78_wave.items():
        for _v78_i in (_v78_r.get("identity") or []) if isinstance(_v78_r.get("identity"), list) else []:
            if isinstance(_v78_i, dict) and _v78_i.get("assertion") in ("merged", "presumed-same"):
                for _v78_x in _v78_with(_v78_i): _v78_judge(_v78_id, _v78_r, _v78_i, _v78_x)
        for _v78_src in sorted(_v78_rev.get(_v78_id, ())):           # a live row's edge INTO a row this wave changes
            if _v78_src in _v78_wave: continue
            for _v78_i in (_v78_live[_v78_src].get("identity") or []):
                if isinstance(_v78_i, dict) and _v78_i.get("assertion") in ("merged", "presumed-same") and _v78_id in _v78_with(_v78_i):
                    _v78_judge(_v78_src, _v78_live[_v78_src], _v78_i, _v78_id)
    if _v78_wave: print(f"   portrayal-merge guard (c124, v78(c)): {len(_v78_wave)} wave row(s), {_v78_n['edges']} merged/presumed-same edge(s) read, {_v78_n['held']} held, {_v78_n['carried']} already live (noted)")
except Exception as e:
    probs.append(f"the portrayal-merge guard (hook c124, v78(c)) could not run ({e}); a cross-promotion portrayal merge is never judged clean until it runs")
# ---- end L-PORTRAYAL-MERGE (hook c124)
# ---- new characters/units whose name equals an existing entity's name must carry identity[] naming it
# LANDCHECK-IDENTITY (hook c109, lane C109-LANDCHECK-IDENTITY, 2026-10-07). registry-validate's aka-collision guard (4f) as
# the next preflight will run it, after the window this wave lands in. Three blind spots of 10-06/07 closed together:
#  (1) NEW MEANS NOT IN HEAD. The validator counts every id that is not in `git show HEAD:data/{characters,units}.json` as
#      newly minted, whatever its aliases; only the one HEAD id an alias carries forward to it (its prior self) is exempt,
#      and only rows still live count against it. Ids already in HEAD are never re-judged, so neither are they here.
#      The window's merge pass (B4: merge-batch.py -> merge-character.py) runs before that preflight. When it folds a record
#      INTO this wave's new id, the survivor keeps the new id, takes the retired record's name and aka, and drops every
#      identity entry naming the retired id, note and all. TWW's goldfish-tww-2008 / the-mighty-impala-tww-2008 lost the only
#      entries that named their third same-name rows that way, and preflight 310 failed. So a wave record is judged as that
#      pass will leave it: merge-batch.py's own pair rule (merged, or presumed-same graded primary-source / user-attested /
#      presumed; never a roster_policy "real" wing, never two promotions' portrayals since hook c124), its survivor order (earliest first_seen, then more tenures, then the
#      shorter id; its SURVIVOR_OVERRIDES, read from the file; a memorial subject's character survives) and
#      merge-character.py's identity fold. A record the pass folds into another is counted and not judged (it is gone).
#  (2) EVERY ROW. Every live id under each normalized name/aka is listed, never only the first one found (Taurus +4,
#      The Beast +7, jackson-cwc-2008 behind jackson-wwa). Each one must be named by an identity entry that carries a note:
#      `with: [id]`, or a note naming the id (the validator's two forms; an entry with no note names nothing for it). The
#      validator passes a record once ANY noted entry names ANY of its collisions (exact, or its decorated near-names), so
#      each line says whether the next preflight would fail on it.
#  (3) THE SHARDS, NOT THE MONOLITH. Live rows are read from data/shards/*/{characters,units}.json, the source of truth, so
#      rows a window applied since the last build:data count (MAW-L01 checked 0 against the data/characters.json that
#      predated window 306, then was held by window 307). That is simpler than matching APPLIED stamps against build:data
#      runs, and as fast (about 0.2 s; L-UNKNOWN-REF reads the same files). A row applied since the last commit counts too:
#      the chain commits it before the window this wave lands in, so it is in HEAD when the validator runs.
# The HEAD id set is cached per commit in SCRATCH_ROOT (land-check-head-ids-<sha>.json; older ones are removed).
# LAND_CHECK_HEAD_REPO names another work tree to read HEAD from (a scratch museum that is not a git work tree). Without a
# readable HEAD the validator skips the guard; here the guard says so and judges every record not live in the shards as new.
# The same-name rows of this wave's own records never count against each other (none of them is in HEAD at that preflight).
import time as _ci_time
_ci_t0 = _ci_time.time()
try:
    def _ci_norm(s): return s.strip().lower() if isinstance(s, str) else ""
    def _ci_dnorm(s):        # registry-validate's normDecorated (4g)
        s = s.lower() if isinstance(s, str) else ""
        s = re.sub(r"[\"'‘’“”`]", "", s); s = re.sub(r"[.,!?;:()]", "", s)
        s = re.sub(r"^(the|a|an)\s+", "", s); return re.sub(r"\s+", " ", s).strip()
    def _ci_labels(r): return [x for x in [r.get("name")] + list(r.get("aka") or []) if isinstance(x, str)]
    def _ci_with(i): return [x for x in (i.get("with") or []) if isinstance(x, str)] if isinstance(i, dict) and isinstance(i.get("with"), list) else []
    def _ci_merges(i): return isinstance(i, dict) and (i.get("assertion") == "merged" or (i.get("assertion") == "presumed-same" and i.get("grade") in ("primary-source", "user-attested", "presumed")))
    # live rows, every id per label (the shards)
    _ci_live = {}; _ci_chars = {}; _ci_index = collections.defaultdict(list); _ci_mref = collections.defaultdict(set)
    for _ci_kind in ("characters", "units"):
        for _ci_f in sorted(glob.glob(f"{M}/data/shards/*/{_ci_kind}.json")):
            _ci_rows = json.load(open(_ci_f, encoding="utf-8"))      # an unreadable live shard stops the guard (below), never skips
            for _ci_r in (_ci_rows if isinstance(_ci_rows, list) else []):
                if not isinstance(_ci_r, dict) or not isinstance(_ci_r.get("id"), str): continue
                _ci_live[_ci_r["id"]] = (_ci_f.split("/")[-2], _ci_kind, _ci_r)
                for _ci_l in {_ci_norm(x) for x in _ci_labels(_ci_r)} - {""}: _ci_index[_ci_l].append(_ci_r["id"])
                if _ci_kind == "characters":
                    _ci_chars[_ci_r["id"]] = (_ci_live[_ci_r["id"]][0], _ci_r)
                    for _ci_i in (_ci_r.get("identity") or []):
                        if _ci_merges(_ci_i):
                            for _ci_x in _ci_with(_ci_i): _ci_mref[_ci_x].add(_ci_r["id"])
    # HEAD's ids, as the validator reads them
    _ci_repo = os.environ.get("LAND_CHECK_HEAD_REPO") or M; _ci_head = None; _ci_sha = "?"
    try:
        _ci_sha = subprocess.run(["git", "-C", _ci_repo, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        _ci_cache = f"{_SCRATCH}/land-check-head-ids-{_ci_sha}.json"
        try: _ci_head = set(json.load(open(_ci_cache, encoding="utf-8")))
        except Exception:
            _ci_head = set()
            for _ci_kind in ("characters", "units"):
                _ci_d = json.loads(subprocess.run(["git", "-C", _ci_repo, "show", f"HEAD:data/{_ci_kind}.json"], capture_output=True, check=True).stdout)
                _ci_k = next((k for k in _ci_d if k[:1] != "_" and isinstance(_ci_d[k], list)), None) if isinstance(_ci_d, dict) else None
                _ci_head.update(e["id"] for e in (_ci_d[_ci_k] if _ci_k else []) if isinstance(e, dict) and isinstance(e.get("id"), str))
            try:
                _ci_tmp = f"{_ci_cache}.{os.getpid()}.tmp"; json.dump(sorted(_ci_head), open(_ci_tmp, "w", encoding="utf-8")); os.replace(_ci_tmp, _ci_cache)
                for _ci_old in glob.glob(f"{_SCRATCH}/land-check-head-ids-*.json"):
                    if _ci_old != _ci_cache: os.remove(_ci_old)
            except Exception as _e: print(f"   identity guard: the HEAD id cache was not written ({_e}); next run reads HEAD again")
    except Exception as _e:
        _ci_head = None
        print(f"   NOTE identity guard: HEAD of {_ci_repo} is unreadable ({str(_e)[:120]}); registry-validate skips its guard there, and every wave record not live in the shards is judged as new here")
    # this wave's records (shards and appends; a wave's copy of a live id replaces it)
    _ci_wave = []
    for sf in glob.glob(f"{W}/delta/data/shards/*/characters.json")+glob.glob(f"{W}/delta/data/shards/*/units.json")+glob.glob(f"{W}/delta/data/characters-append-*.json")+glob.glob(f"{W}/delta/data/units-append-*.json"):
        _ci_b = os.path.basename(sf); _ci_kind = "characters" if _ci_b.startswith("characters") else "units"
        wing = sf.split("/")[-2] if "/delta/data/shards/" in sf else _ci_b[len(_ci_kind) + len("-append-"):-len(".json")]
        try: _ci_rows = json.load(open(sf, encoding="utf-8"))
        except Exception as _e: probs.append(f"{wing}: {_ci_b} cannot be read for the aka-collision guard ({_e})"); continue
        for rec in (_ci_rows if isinstance(_ci_rows, list) else []):
            if isinstance(rec, dict) and isinstance(rec.get("id"), str): _ci_wave.append((wing, _ci_kind, rec))
    _ci_own = {r["id"] for _, _, r in _ci_wave}
    if _ci_head is None: _ci_head = set(_ci_live) - _ci_own
    _ci_chars.update({r["id"]: (w, r) for w, k, r in _ci_wave if k == "characters"})
    for _, _ci_kind, _ci_r in _ci_wave:                             # a pair one of this wave's own records asserts
        if _ci_kind == "characters":
            for _ci_i in (_ci_r.get("identity") or []):
                if _ci_merges(_ci_i):
                    for _ci_x in _ci_with(_ci_i): _ci_mref[_ci_x].add(_ci_r["id"])
    # aliases: the validator's prior self (live aliases.json, then this wave's aliases-additions, in file order)
    _ci_prior = {}
    for _ci_f in [f"{M}/data/aliases.json"] + sorted(glob.glob(f"{W}/delta/data/aliases-additions*.json")):
        try: _ci_al = json.load(open(_ci_f, encoding="utf-8")); _ci_al = _ci_al.get("aliases", []) if isinstance(_ci_al, dict) else _ci_al
        except Exception as _e:
            if os.path.exists(_ci_f): probs.append(f"{os.path.basename(_ci_f)} cannot be read for the aka-collision guard's renames ({_e})")
            continue
        for _ci_a in (_ci_al if isinstance(_ci_al, list) else []):
            if isinstance(_ci_a, dict) and _ci_a.get("from") in _ci_head and isinstance(_ci_a.get("to"), str) and _ci_a["to"] not in _ci_head: _ci_prior[_ci_a["to"]] = _ci_a["from"]
    # merge-batch.py's survivor rules
    _ci_pol = {r.get("id"): r.get("roster_policy") for r in Prows if isinstance(r, dict)}
    for _ci_f in glob.glob(f"{W}/delta/data/promotions-rows.json") + glob.glob(f"{W}/delta/data/promotions-append*.json"):
        try: _ci_pr = json.load(open(_ci_f, encoding="utf-8")); _ci_pr = _ci_pr.get("promotions", _ci_pr) if isinstance(_ci_pr, dict) else _ci_pr
        except Exception: continue                                  # reported by the mint-row checks (L-SHAPE)
        for _ci_r in (_ci_pr if isinstance(_ci_pr, list) else list(_ci_pr.values()) if isinstance(_ci_pr, dict) else []):
            if isinstance(_ci_r, dict) and _ci_r.get("id"): _ci_pol[_ci_r["id"]] = _ci_r.get("roster_policy")
    _ci_over = {}
    try:
        for _ci_a, _ci_b2, _ci_s in re.findall(r"frozenset\(\('([^']+)',\s*'([^']+)'\)\)\s*:\s*'([^']+)'", open(f"{M}/scripts/fixers/merge-batch.py", encoding="utf-8").read()):
            _ci_over[frozenset((_ci_a, _ci_b2))] = _ci_s
    except Exception as _e: print(f"   NOTE identity guard: merge-batch.py's SURVIVOR_OVERRIDES unread ({_e}); the default survivor order is used")
    _ci_mem = set()
    for _ci_f in [f"{M}/data/memorials.json"] + glob.glob(f"{W}/delta/data/memorials-append*.json"):
        try: _ci_mj = json.load(open(_ci_f, encoding="utf-8")); _ci_mj = _ci_mj["memorials"] if isinstance(_ci_mj, dict) else _ci_mj
        except Exception: continue
        _ci_mem |= {c for m in (_ci_mj if isinstance(_ci_mj, list) else []) if isinstance(m, dict) for c in (m.get("characters") or []) if isinstance(c, str)}
    def _ci_first(c):
        _ds = [t.get("first_seen") or "9999" for t in (_ci_chars[c][1].get("tenures") or []) if isinstance(t, dict)]
        return min(str(x) for x in _ds) if _ds else "9999"
    def _ci_survivor(x, y):
        a, b = sorted((x, y))
        if frozenset((a, b)) in _ci_over: return _ci_over[frozenset((a, b))]
        if (a in _ci_mem) != (b in _ci_mem): return a if a in _ci_mem else b
        return sorted([a, b], key=lambda c: (_ci_first(c), -len(_ci_chars[c][1].get("tenures") or []), len(c)))[0]
    # SIBLING MINTS (hook c134, lane LANDCHECK-SIBLING-MINTS, 2026-10-08). The guard above compares a wave's records with LIVE
    # rows only, so two READY waves minting one name each passed alone, and the window held whichever it applied second: window
    # 328 held wave-SERVE-IWF-ENRICH (eddie-whisky-iwf, skylar-montgomery-iwf, michael-raves-iwf) after wave-SERVE-IGC-ENRICH,
    # landed earlier in the same window, minted the -igc rows. So every row a READY, not APPLIED sibling wave mints (its
    # delta/data/shards/*/{characters,units}.json and {characters,units}-append-*.json rows whose id is not live) is indexed
    # under the same normalized labels (_ci_norm of name + aka), and each of this wave's new records is judged against them by
    # the same test as a live row: the same skip set, the same _ci_named. A hit is the same line with "(minted by READY sibling
    # <wave>)". The siblings are L-SIBLING-FIELD's: the window's own WAVE_TREES (env, else ops/config.env) under WORKSHOP_ROOT,
    # os.scandir, READY and no APPLIED (an APPLIED wave's rows are live, judged above); a wave checked in place skips only
    # itself, a scratch copy checked from outside the trees skips its own name's wave. Symmetric, as L-SIBLING-FIELD: the
    # window's order is fixed, but each side is told; whichever lands second must name the other. Built once a run (the READY
    # set is small); a sibling file that cannot be read is skipped (its own land-check reports it); if the scan itself fails,
    # the guard says so and holds the wave. No other line of the guard changes.
    _c134_t0 = _ci_time.time(); _c134_idx = collections.defaultdict(list); _c134_rows = {}; _c134_err = None
    _c134_n = {"sibs": 0, "rows": 0, "lines": 0, "red": 0}
    try:
        _c134_trees = os.environ.get("WAVE_TREES")
        if _c134_trees is None:
            try:
                _c134_m = re.search(r'WAVE_TREES="\$\{WAVE_TREES:-(.*?)\}"', open(f"{M}/ops/config.env", encoding="utf-8").read(), re.S)
                _c134_trees = _c134_m.group(1) if _c134_m else ""
            except Exception: _c134_trees = ""
        _c134_me = os.path.realpath(W); _c134_myname = os.path.basename(_c134_me)
        _c134_tdirs = [os.path.join(_WORKSHOP, _t.strip()) for _t in _c134_trees.split("\n") if _t.strip()]
        _c134_scratchcopy = os.path.dirname(_c134_me) not in {os.path.realpath(_d) for _d in _c134_tdirs}
        _c134_seen = set()
        for _c134_td in _c134_tdirs:
            try: _c134_ents = sorted((_e.name, _e.path) for _e in os.scandir(_c134_td) if _e.name.startswith("wave-") and _e.is_dir())
            except OSError: continue
            for _c134_sn, _c134_sp in _c134_ents:
                _c134_sr = os.path.realpath(_c134_sp)
                if _c134_sr == _c134_me or (_c134_scratchcopy and _c134_sn == _c134_myname) or _c134_sr in _c134_seen: continue
                _c134_seen.add(_c134_sr)
                if not os.path.exists(os.path.join(_c134_sp, "READY")) or os.path.exists(os.path.join(_c134_sp, "APPLIED")): continue
                _c134_n["sibs"] += 1
                for _c134_kind in ("characters", "units"):
                    for _c134_f in sorted(glob.glob(f"{_c134_sp}/delta/data/shards/*/{_c134_kind}.json") + glob.glob(f"{_c134_sp}/delta/data/{_c134_kind}-append-*.json")):
                        try: _c134_rs = json.load(open(_c134_f, encoding="utf-8"))
                        except Exception: continue                  # its own land-check reports it
                        for _c134_r in (_c134_rs if isinstance(_c134_rs, list) else []):
                            if not isinstance(_c134_r, dict) or not isinstance(_c134_r.get("id"), str) or _c134_r["id"] in _ci_live: continue
                            _c134_n["rows"] += 1; _c134_rows[_c134_r["id"]] = _c134_r
                            for _c134_l in {_ci_norm(x) for x in _ci_labels(_c134_r)} - {""}: _c134_idx[_c134_l].append((_c134_r["id"], _c134_sn))
    except Exception as _e: _c134_err = _e
    _c134_dt = _ci_time.time() - _c134_t0
    _ci_n = {"new": 0, "head": 0, "folded": 0, "merged": 0, "lines": 0, "red": 0}
    for wing, _ci_kind, rec in _ci_wave:
        rid = rec["id"]
        if rid in _ci_head: _ci_n["head"] += 1; continue          # not newly minted: the validator never re-judges it
        _ci_n["new"] += 1
        labels = _ci_labels(rec); ident = [i for i in (rec.get("identity") or []) if isinstance(i, dict)]; _ci_into = []
        if _ci_kind == "characters":
            _ci_part = {x for i in ident if _ci_merges(i) for x in _ci_with(i)} | _ci_mref.get(rid, set())
            _ci_part = sorted(p for p in _ci_part if p != rid and p in _ci_chars and _ci_pol.get(_ci_chars[p][0]) != "real" and _ci_pol.get(wing) != "real"
                              and not _v78_cross(rid, rec, p, _ci_chars[p][1], _V78_PROMOS))   # hook c124: merge-batch.py never folds two promotions' portrayals (v78(c))
            if any(_ci_survivor(rid, p) != rid for p in _ci_part): _ci_n["folded"] += 1; continue   # folded into an older record
            for p in _ci_part:                                      # merge-character.py's fold, survivor = this record
                _pr = _ci_chars[p][1]
                ident = [i for i in ident if p not in _ci_with(i)]
                for i in (_pr.get("identity") or []):
                    if isinstance(i, dict) and rid not in _ci_with(i) and not any(set(_ci_with(i)) == set(_ci_with(j)) for j in ident): ident.append(i)
                labels += [x for x in _ci_labels(_pr) if x not in labels]
            _ci_into = _ci_part
            if _ci_part: _ci_n["merged"] += 1
        _ci_skip = {rid} | set(_ci_into) | ({_ci_prior[rid]} if rid in _ci_prior else set()) | _ci_own
        _ci_noted = [i for i in ident if isinstance(i.get("note"), str) and i["note"].strip()]
        def _ci_named(o): return any(o in _ci_with(i) or o in i["note"] for i in _ci_noted)
        _ci_hits = {}
        for nm in labels:
            _ci_l = _ci_norm(nm)
            if not _ci_l or _ci_l in _ci_hits: continue
            _ci_hits[_ci_l] = [o for o in dict.fromkeys(_ci_index.get(_ci_l, [])) if o not in _ci_skip]
        _ci_all = {o for v in _ci_hits.values() for o in v}
        _c134_hits = {}                                             # hook c134: (label, sibling wave) -> the ids it mints
        for _c134_nm in labels:
            _c134_l = _ci_norm(_c134_nm)
            for _c134_o, _c134_sn in _c134_idx.get(_c134_l, []) if _c134_l else []:
                if _c134_o in _ci_skip or _c134_o in _ci_live: continue
                _c134_v = _c134_hits.setdefault((_c134_l, _c134_sn), [])
                if _c134_o not in _c134_v: _c134_v.append(_c134_o)
        if not _ci_all and not _c134_hits: continue
        # would the validator pass it? any noted entry naming any exact collision, or a decorated near-name it names
        _ci_pass = any(_ci_named(o) for o in _ci_all)
        if not _ci_pass:
            _ci_own_d = [d for d in (_ci_dnorm(x) for x in labels) if len(d) >= 5]
            _ci_cand = {x for i in _ci_noted for x in _ci_with(i)} | {t for i in _ci_noted for t in re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)+", i["note"])}
            for o in _ci_cand - _ci_skip:
                if o in _ci_live and any(od in d or d in od for od in _ci_own_d for d in (_ci_dnorm(x) for x in _ci_labels(_ci_live[o][2])) if len(d) >= 5):
                    _ci_pass = True; break
        for _ci_l, _ci_os in _ci_hits.items():
            unc = [o for o in _ci_os if not _ci_named(o)]
            if not unc: continue
            _ci_n["lines"] += 1; _ci_n["red"] += (not _ci_pass)
            nm = next(x for x in labels if _ci_norm(x) == _ci_l)
            _ci_v = "the next preflight FAILS on it" if not _ci_pass else "the validator passes on the row already named, but every same-name row is named: no silent distinctness"
            _ci_m = f"; judged as the window's merge pass leaves it ({', '.join(_ci_into)} fold{'s' if len(_ci_into) == 1 else ''} into it, and every identity entry naming {'it' if len(_ci_into) == 1 else 'them'} goes)" if _ci_into else ""
            probs.append(f"{wing}: {rid} name/aka {nm.strip().lower()!r} equals existing entit{'y' if len(unc) == 1 else 'ies'} {', '.join(unc)} but identity[] does not name {'it' if len(unc) == 1 else 'them'} ({_ci_v}; registry-validate's aka-collision guard; cycle 149, hook c109{_ci_m})")
        if _c134_hits:                                              # hook c134: the same test against READY siblings' mints
            _c134_pass = any(_ci_named(o) for o in _ci_all) or any(_ci_named(o) for _c134_v in _c134_hits.values() for o in _c134_v)
            if not _c134_pass:
                _c134_own_d = [d for d in (_ci_dnorm(x) for x in labels) if len(d) >= 5]
                _c134_cand = {x for i in _ci_noted for x in _ci_with(i)} | {t for i in _ci_noted for t in re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)+", i["note"])}
                for o in _c134_cand - _ci_skip:
                    _c134_or = _ci_live[o][2] if o in _ci_live else _c134_rows.get(o)
                    if _c134_or is not None and any(od in d or d in od for od in _c134_own_d for d in (_ci_dnorm(x) for x in _ci_labels(_c134_or)) if len(d) >= 5):
                        _c134_pass = True; break
            _c134_m = f"; judged as the window's merge pass leaves it ({', '.join(_ci_into)} fold{'s' if len(_ci_into) == 1 else ''} into it, and every identity entry naming {'it' if len(_ci_into) == 1 else 'them'} goes)" if _ci_into else ""
            for (_c134_l, _c134_sn), _c134_os in _c134_hits.items():
                _c134_unc = [o for o in _c134_os if not _ci_named(o)]
                if not _c134_unc: continue
                _c134_n["lines"] += 1; _c134_n["red"] += (not _c134_pass)
                _c134_nm = next(x for x in labels if _ci_norm(x) == _c134_l)
                _c134_v = ("if this wave lands second, the next preflight FAILS on it" if not _c134_pass else
                           "the validator passes on the row already named, but every same-name row is named: no silent distinctness")
                _c134_one = len(_c134_unc) == 1
                probs.append(f"{wing}: {rid} name/aka {_c134_nm.strip().lower()!r} equals existing entit{'y' if _c134_one else 'ies'} {', '.join(_c134_unc)} (minted by READY sibling {_c134_sn}) but identity[] does not name {'it' if _c134_one else 'them'} ({_c134_v}; both waves are told and the window holds each until it names the other: name the id in an identity note (a `with` naming an unlanded id is L-IDENTITY-TARGET's), or fold the two waves into one, or move one to scratch/rebase-* until the other is APPLIED; registry-validate's aka-collision guard; hook c134{_c134_m})")
    print(f"   identity guard (c109): {len(_ci_wave)} wave record(s): {_ci_n['new']} new vs HEAD {_ci_sha[:8]}, {_ci_n['head']} already in HEAD (never re-judged), {_ci_n['folded']} folded away by the window's merge pass, {_ci_n['merged']} judged after a merge into them; {_ci_n['lines']} unnamed collision line(s), {_ci_n['red']} the next preflight fails on; {len(_ci_live)} live shard rows; {_ci_time.time() - _ci_t0:.2f}s")
    print(f"   identity guard, sibling mints (c134): {_c134_n['sibs']} READY unapplied sibling wave(s) minting {_c134_n['rows']} not-live row(s); {_c134_n['lines']} unnamed collision line(s) with them, {_c134_n['red']} the next preflight fails on if this wave lands second; index {_c134_dt:.2f}s")
    if _c134_err is not None:
        probs.append(f"the sibling-mint reach of the aka-collision guard (hook c134) could not read the READY sibling waves ({_c134_err}); a name two READY waves both mint is never judged clean until it runs")
except Exception as e:
    print("name-collision check skipped:",e)
    probs.append(f"the aka-collision guard could not run ({e}); registry-validate hard-fails a new record's unnamed name collision, so nothing is judged clean until it runs (hook c109)")

# ---- provenance notes: an empty sources[] is only lawful at grade "presumed" (validate-provenance-notes; IWF, cycle 158)
for _pf in glob.glob(f"{W}/delta/data/promotions-append*.json")+glob.glob(f"{W}/delta/data/promotions-rows.json")+glob.glob(f"{W}/delta/data/registry-corrections.json"):
    try: _pd=json.load(open(_pf))
    except Exception: continue
    _items=_pd.get("promotions",_pd) if isinstance(_pd,dict) else _pd
    for _row in (_items if isinstance(_items,list) else []):
        if not isinstance(_row,dict): continue
        _notes=_row.get("provenance_notes") if _row.get("field") is None else (_row.get("new") if _row.get("field")=="provenance_notes" else None)
        for _i,_n in enumerate(_notes or []):
            if isinstance(_n,dict) and not _n.get("sources") and _n.get("grade") and _n.get("grade")!="presumed":
                probs.append(f"{_pf.split('/delta/')[-1]}: {_row.get('id')} provenance_notes[{_i}] has empty sources[] but grade {_n.get('grade')!r} — only \"presumed\" may cite nothing (validate-provenance-notes refuses it)")
# ---- L-SPAN (2026-09-21, DWI/IW/GIW/RAW): a correction that widens a held wing's `years` must widen a name or qualifier
# that carries the old year too — "DWI (1999)" with years 1999 -> 1999–2000 files the name row "DWI (1999–2000)".
_rcf = f"{W}/delta/data/registry-corrections.json"
if os.path.exists(_rcf):
    try:
        _rc = json.load(open(_rcf)); _rc = _rc.get("corrections", _rc) if isinstance(_rc, dict) else _rc
        _live = {r.get("id"): r for r in json.load(open(f"{M}/data/promotions.json"))["promotions"]}   # hook c118: M (MUSEUM_ROOT, else this repo)
        _by = {}
        for _x in (_rc if isinstance(_rc, list) else []):
            if isinstance(_x, dict): _by.setdefault(_x.get("id"), {})[_x.get("field")] = _x
        for _id, _fs in _by.items():
            _y = _fs.get("years")
            if not _y or _id not in _live: continue
            _oldy = __import__("re").findall(r"(?:19|20)\d\d", str(_y.get("old") or ""))
            _newy = __import__("re").findall(r"(?:19|20)\d\d", str(_y.get("new") or ""))
            if not _oldy or not _newy or max(_newy) <= max(_oldy): continue
            for _fld in ("name", "qualifier"):
                _cur = str(_live[_id].get(_fld) or "")
                if max(_oldy) in _cur and max(_newy) not in _cur and _fld not in _fs:
                    probs.append(f"registry-corrections.json: {_id} widens years to {_y.get('new')!r} but its {_fld} {_cur!r} still carries only {max(_oldy)} — file the {_fld} row with the span (L-SPAN, the DWI precedent)")
    except Exception as _e:
        probs.append(f"registry-corrections.json: L-SPAN check could not run ({_e})")
# ---- L-AFFNAT / L-UNCOLL (2026-09-21, cycle 164 preflight): registry-validate's affiliation-nature enum and its receipts rule for uncollected shows
_AFF_NATURES = {"alliance-member","alliance-operator","shared-continuity","ownership","acquisition","academy","sister-promotion","invading-faction","crossover-booking","rivalry","affiliate-listing","shared-ownership","legal-action","successor-of","community-presence"}  # synced to registry-validate AFFIL_NATURES 2026-09-24 (lane UFW-B found the gap)
for _af in sorted(set(glob.glob(f"{W}/delta/data/affiliations-rows-*.json")+glob.glob(f"{W}/delta/data/affiliations-*.json"))):
    try: _ad = json.load(open(_af))
    except Exception: continue
    for _r in (_ad if isinstance(_ad, list) else _ad.get("affiliations", [])):
        if isinstance(_r, dict) and _r.get("nature") not in _AFF_NATURES:
            probs.append(f"{os.path.basename(_af)}: nature {_r.get('nature')!r} is not one of {'|'.join(sorted(_AFF_NATURES))} (registry-validate refuses it)")
        # L-AFFGRADE (2026-09-27, cycle 194 preflight stopped on affiliations[428] grade "secondary-source"): the grade enum
        if isinstance(_r, dict) and _r.get("grade") not in (None, "primary-source", "user-attested", "presumed"):
            probs.append(f"{os.path.basename(_af)}: grade {_r.get('grade')!r} is not one of primary-source|user-attested|presumed (registry-validate refuses it; cycle 194)")
for _sf in glob.glob(f"{W}/delta/data/shards/*/shows.json")+glob.glob(f"{W}/delta/data/shows-append-*.json"):
    try: _sd = json.load(open(_sf))
    except Exception: continue
    for _s in (_sd if isinstance(_sd, list) else []):
        if isinstance(_s, dict) and _s.get("collected") is False and not _s.get("evidence"):
            probs.append(f"{os.path.basename(_sf)}: show {_s.get('id')!r} is collected:false with no evidence[] — every uncollected row carries receipts [{{source, note}}] (registry-validate refuses it)")
# ---- shows: billed appearances need a source; tenures: roles within the enum
ROLES={"wrestler","manager","referee","authority-figure","commentator","mascot","other"}
for sf in glob.glob(f"{W}/delta/data/shards/*/shows.json")+glob.glob(f"{W}/delta/data/shows-append-*.json"):
    try: data=json.load(open(sf))
    except Exception: continue
    for sh in (data if isinstance(data,list) else []):
        for a in (sh.get("appearances") or []) if isinstance(sh,dict) else []:
            if isinstance(a,dict) and a.get("kind")=="billed" and not a.get("source"): probs.append(f"{sf.split('/delta/')[-1]}: show {sh.get('id')} has a billed appearance without `source`")
            if isinstance(a,dict) and a.get("kind") not in ("match","angle","billed"): probs.append(f"{sf.split('/delta/')[-1]}: show {sh.get('id')} appearance kind {a.get('kind')!r} is not match|angle|billed (registry-validate refuses it; SSCW, 2026-09-21)")
        for m in (sh.get("matches") or []) if isinstance(sh,dict) else []:
            if isinstance(m,dict) and "sides" in m and "winner" in m: probs.append(f"{sf.split('/delta/')[-1]}: show {sh.get('id')} match {m.get('order')}: a sides-shaped match names its winner with `winner_side` (the index of the winning side), not `winner` (SSCW, 2026-09-21)")
# ---- L-METHOD / L-SUBTYPE (the Janitor's gavels, 2026-09-27: D100 "add the interference subtype", D105 "a new field,
# method"; CURATION v125, #match-method-and-interference). matches[].method is HOW the match ended, in one of eleven
# controlled values slugged from Argyle's own decision codes; his code 0 ("no method") is ABSENCE, never a stored value.
# The set is CLOSED and registry-validate HARD-FAILS anything outside it, so a wave must not land a twelfth value — and a
# SENTENCE in `method` is the mistake to expect, because 2,062 rows already tell the same fact in prose under `finish`.
# `finish` itself is the TOLD SENTENCE and stays exactly as it is (v125(d)): it is NEVER measured against the eleven here
# or anywhere. The only thing checked of it is the empty/null shape L-SHAPE already checks. A slug-shaped `finish` is not
# an error either, but it is nearly always a wave that meant `method`, so it is NOTED once per row rather than failed.
# appearances[].subtype "interference" is the tenth subtype value; a subtype on a kind != "angle" row is the structural
# mismatch registry-validate already hard-fails, and an interferer is never also in the match's own sides/participants.
# Both run on the append/shard route AND on the shows-corrections route, because an existing show gains a method or an
# interference by correction, not by a fresh row (the corrections route is the house way to upgrade a held row).
_METHOD_OK={"pinfall","submission","dq","countout","knockout","stipulation","forfeit","time-limit","no-decision","reversed-decision","sleeper"}
import re as _d105re
_METHOD_SLUG=_d105re.compile(r"^[a-z][a-z0-9-]*$")
def _d105_matches(_where,_sid,_ms):
    for _m in (_ms or []):
        if not isinstance(_m,dict): continue
        if "method" in _m:
            _v=_m.get("method")
            if not isinstance(_v,str) or not _v.strip():
                probs.append(f"L-METHOD: {_where}: show {_sid} match {_m.get('order')}: `method` is {_v!r} — one of the eleven, or NO field where the text does not say (registry-validate refuses an empty one)")
            elif _v not in _METHOD_OK:
                if not _METHOD_SLUG.match(_v):
                    probs.append(f"L-METHOD: {_where}: show {_sid} match {_m.get('order')}: `method` is a SENTENCE ({_v[:50]!r}) — `method` is one of {'|'.join(sorted(_METHOD_OK))}; the told sentence goes in `finish`, which is free prose and is never checked against the eleven (CURATION v125(a),(d))")
                else:
                    probs.append(f"L-METHOD: {_where}: show {_sid} match {_m.get('order')}: method {_v!r} is not one of {'|'.join(sorted(_METHOD_OK))} (registry-validate HARD-FAILS it; the set is closed by gavel, CURATION v125(a))")
            elif _v=="stipulation" and not (isinstance(_m.get("stipulation"),str) and _m["stipulation"].strip()):
                probs.append(f"L-METHOD: {_where}: show {_sid} match {_m.get('order')}: method \"stipulation\" with no `stipulation` on the row — name the stipulation verbatim, or use the method the text describes (CURATION v125(a))")
        _f=_m.get("finish")
        if isinstance(_f,str) and _f.strip() and _METHOD_SLUG.match(_f.strip()):
            probs.append(f"L-METHOD: {_where}: show {_sid} match {_m.get('order')}: `finish` carries the slug {_f.strip()!r} — `finish` is the TOLD SENTENCE (free prose, v125(d)); a controlled value belongs in `method`. If the sentence really is one word, say so in the delivery and this line is a note, not a defect")
def _d105_apps(_where,_sid,_as):
    for _a in (_as or []):
        if not isinstance(_a,dict) or "subtype" not in _a: continue
        if _a.get("kind")!="angle":
            probs.append(f"L-SUBTYPE: {_where}: show {_sid} appearance {_a.get('who')!r} carries subtype {_a.get('subtype')!r} on kind {_a.get('kind')!r} — a subtype is meaningful only on kind \"angle\" (registry-validate HARD-FAILS it); an interference flattens to a plain angle row and its entity is never in the match's own sides/participants (CURATION v125(e))")
for sf in glob.glob(f"{W}/delta/data/shards/*/shows.json")+glob.glob(f"{W}/delta/data/shows-append-*.json"):
    try: data=json.load(open(sf))
    except Exception: continue
    for sh in (data if isinstance(data,list) else []):
        if not isinstance(sh,dict): continue
        _d105_matches(sf.split('/delta/')[-1],sh.get("id"),sh.get("matches"))
        _d105_apps(sf.split('/delta/')[-1],sh.get("id"),sh.get("appearances"))
for sf in sorted(set(glob.glob(f"{W}/delta/data/*corrections*.json"))):
    try: data=json.load(open(sf))
    except Exception: continue
    for _c in (data if isinstance(data,list) else []):
        if not isinstance(_c,dict) or not isinstance(_c.get("new"),list): continue
        if _c.get("field")=="matches": _d105_matches(sf.split('/delta/')[-1],_c.get("id"),_c["new"])
        elif _c.get("field")=="appearances": _d105_apps(sf.split('/delta/')[-1],_c.get("id"),_c["new"])
for sf in glob.glob(f"{W}/delta/data/shards/*/characters.json")+glob.glob(f"{W}/delta/data/shards/*/units.json")+glob.glob(f"{W}/delta/data/characters-append-*.json")+glob.glob(f"{W}/delta/data/units-append-*.json"):
    try: data=json.load(open(sf))
    except Exception: continue
    for rec in (data if isinstance(data,list) else []):
        for t in (rec.get("tenures") or []) if isinstance(rec,dict) else []:
            bad=[r for r in (t.get("roles") or []) if r not in ROLES] if isinstance(t,dict) else []
            if bad: probs.append(f"{sf.split('/delta/')[-1]}: {rec.get('id')} tenure role(s) outside the enum: {bad}")
# ---- NO TERMS ON THE CONSOLE (hook c222-landcheck-no-terms, 2026-10-09): a ledger term, and a contact detail or credited
# name read off a delivered page, is never printed. Each is cited as privacy-lookup.py cites a row: sha1 of the stripped,
# lowercased text [:8] and its length. The fingerprint is privacy-lookup.py's own fp(), imported on first use (never
# re-implemented); if that tool cannot be imported the line says so and still prints no term.
_c222_fpf = []
def _c222_lab(s):
    s = str(s)
    if not _c222_fpf:
        try:
            import importlib.util as _c222_ilu
            _c222_sp = _c222_ilu.spec_from_file_location("_c222_privacy_lookup", f"{_WORKSHOP}/tools/coordinator-2026-09-03/privacy-lookup.py")
            _c222_md = _c222_ilu.module_from_spec(_c222_sp); _c222_sp.loader.exec_module(_c222_md)
            _c222_fpf.append(_c222_md.fp)
        except Exception:
            _c222_fpf.append(None)
    if _c222_fpf[0] is None: return f"(fingerprint unavailable: privacy-lookup.py not importable) len {len(s.strip())}"
    return f"sha1:{_c222_fpf[0](s)} len {len(s.strip())}"
# fragment scopes
frag=f"{A}/privacy/ledger-pending/{name}.tsv"
_exact_denies=set()
for _lf in [f"{A}/privacy/redaction-ledger.tsv"]+glob.glob(f"{A}/privacy/ledger-pending/*.tsv"):
    try:
        for _l in open(_lf,encoding="utf-8",errors="replace"):
            _c=_l.rstrip("\n").split("\t")
            if len(_c)>=3 and _c[2].strip()=="deny": _exact_denies.add(_c[0].strip().lower())
    except Exception: pass
if os.path.exists(frag):
    for l in open(frag):
        if l.startswith("#") or not l.strip(): continue
        c=l.rstrip("\n").split("\t"); term,cls,st,sc=(c+["","","",""])[:4]
        # 2026-09-22: the gate reads status by exact equality (privacy-check.mjs: status === "allow" / "deny"); any other word enforces
        # nothing. "deny (standing, applied not refiled)" is the house's ANNOTATION of an existing deny (146 main-ledger rows — flipping
        # them to "deny" widened three scoped denies tree-wide and red the gate 20 times in a dry run), and flag/watch-note are notes.
        # The failure is a deny-worded row whose term has NO exact deny anywhere: a lane meant to deny it, and nothing does.
        if st.strip().lower().startswith("deny") and st.strip()!="deny" and term.strip().lower() not in _exact_denies:
            probs.append(f"LAW L-PRIVSTATUS: fragment row for a {cls or '?'} term has status {st[:40]!r} and no exact 'deny' row for the term exists in the ledger or this fragment — the gate enforces only the exact word 'deny', so nothing denies it. Write the status as deny (the rest goes in the note column)")
        if sc.startswith("archive/"): probs.append(f"fragment: {cls} row scoped to archive path ({sc[:60]})")
        # 2026-09-26 (packet B, D47): an ADDRESS-shaped contact detail (e-mail, URL, phone) is unique and denies tree-wide; a messenger
        # HANDLE is often a common word ("Floyd", "Bombay") that an unscoped deny reds on unrelated in-fiction pages (E4-2004B, "Pink
        # Floyd"). A handle row is scoped to the pages it was redacted on, like a bare name (the L12 hygiene).
        if cls=="contact-detail" and sc and ("@" in term or "://" in term or term.lower().startswith("www.") or re.fullmatch(r"[\d\s().+-]{7,}", term.strip())):
            probs.append(f"fragment: contact-detail row (an address) is scoped, should be tree-wide")
        # 2026-09-22 (CWO, IIWF, NJWA, OVWL, PFW, MPW): a self-portrayal allow reaches only the pages that stage the person
        # in the fiction. A wing-wide scope also covers every future out-of-character use on that wing.
        _note=(c[5] if len(c)>5 else "").lower()
        if st=="allow" and (cls=="self-portrayal" or "self-portray" in _note) and sc:
            for pref in sc.split(","):
                pref=pref.strip()
                if pref.startswith("promotions/") and not pref.endswith(".html"):
                    probs.append(f"fragment: {cls} allow for {_c222_lab(term)} is scoped wing-wide ({pref}); scope it to the pages that stage the person in the fiction")
        # widening a term over a HELD wing whose served pages already carry it (persona use) reddens the gate
        # bare names (single token, or forename/surname/partial classes) may not be wing-scoped — page-scope to the OOC document
        if st=="deny" and sc and (cls in ("forename","surname","real-name-partial","forename+initial") or (" " not in term.strip() and cls.startswith("real"))):
            for pref in sc.split(","):
                pref=pref.strip()
                if pref.startswith("promotions/") and not pref.endswith(".html"): probs.append(f"fragment: bare-name row {cls!r} scoped wing-wide ({pref}) — page-scope to the OOC document(s) or drop")
        if st=="deny" and sc:
            for pref in sc.split(","):
                pref=pref.strip()
                if pref.startswith("promotions/") and pref.count("/")==2 and os.path.isdir(f"{M}/{pref}"):
                    r=subprocess.run(["grep","-rliwF",term,f"{M}/{pref}"],capture_output=True,text=True)
                    if r.stdout.strip(): probs.append(f"fragment: {cls} row widened to {pref} but that wing's served pages already carry the string ({len(r.stdout.split())} file(s)) — persona? page-scope to the OOC document or drop the widening")
        if not sc and st=="deny":
            r=subprocess.run(["grep","-rliwF",term,M,"--exclude-dir=.git","--exclude-dir=node_modules"],capture_output=True,text=True)
            n=len(r.stdout.split())
            if n:
                # 2026-09-21 (HAMMER, DZW): the corrected-copy exception holds only when EVERY live hit is covered — a corrected
                # copy of that exact page in this delta, or a page-scoped allow row in this fragment reaching it
                _hits=[h.replace(M+'/','') for h in r.stdout.split()]
                _allows=[s2.strip() for l2 in open(frag) if not l2.startswith('#') for c2 in [l2.rstrip('\n').split('\t')] if len(c2)>3 and c2[0]==term and c2[2]=='allow' for s2 in c2[3].split(',') if s2.strip()]
                # 2026-09-23 (window 170 held PCW-NEWS-2003-04): an allow already in the MAIN ledger covers a live hit too — the gate
                # honours every ledger allow, not only this fragment's (a carve-out another wave filed and folded stands)
                _allows+=[s2.strip() for l2 in open(f"{A}/privacy/redaction-ledger.tsv",encoding="utf-8",errors="replace") if not l2.startswith('#') for c2 in [l2.rstrip('\n').split('\t')] if len(c2)>3 and c2[0]==term and c2[2]=='allow' for s2 in c2[3].split(',') if s2.strip()]
                # 2026-09-21 (NJWA): the two registry files are redacted against every tree-wide deny by the standing
                # scrub-registry-privacy.py at each preflight, so a hit there is covered for the classes it scrubs
                _scrubbed=("data/promotions.json","data/frontier.json") if cls in ("real-name","login-slug","contact-detail","contact","email","forename") else ()
                # 2026-09-26 (COORD-OOC-REDACT-0926): a page-corrections row that REMOVES the term from that exact live page
                # covers the hit too. This is the same simulation L-PCPRIV runs; a corrected copy is no longer the only cover.
                _pcclean=set(); _pcf=f"{W}/delta/data/page-corrections.json"
                if os.path.exists(_pcf):
                    try: _pcr=json.load(open(_pcf,encoding="utf-8")) or []
                    except Exception: _pcr=[]
                    _byp={}
                    for _r in _pcr:
                        if isinstance(_r,dict): _byp.setdefault(str(_r.get("page","")).lstrip("/"),[]).append(_r)
                    for _p,_rs in _byp.items():
                        try: _t=open(f"{M}/{_p}",encoding="utf-8",errors="replace").read()
                        except Exception: continue
                        for _r in _rs:
                            if _r.get("old") and _r["old"] in _t: _t=_t.replace(_r["old"],_r.get("new",""),1)
                        if not re.search(r"(?i)(?<![\w])"+re.escape(term)+r"(?![\w])", re.sub(r"<[^>]+>"," ",_t)): _pcclean.add(_p)
                _unc=[h for h in _hits if not os.path.exists(f"{W}/delta/{h}") and h not in _pcclean and not any(h.startswith(a) for a in _allows) and h not in _scrubbed]
                if _unc: probs.append(f"fragment: NEW GLOBAL term {_c222_lab(term)} already hits {n} museum file(s); {len(_unc)} NOT covered by a corrected copy in this delta or an allow row: {', '.join(_unc[:4])}")
                else: print(f"   note: NEW GLOBAL term {_c222_lab(term)} hits {n} live file(s), every one covered by this delta's corrected copies/allows (the acceptable exception)")
else: print("-- no ledger fragment for this wave")
# ---- L-ALLOW-GENERATED (hook c214, 2026-10-09; gate 369 red, desk D485; drafted by lane C213-AND-SCOPE-AUDIT, staged by lane
# L-ALLOW-GENERATED). A scoped allow for an in-fiction name reaches only the paths it names, but the build ALSO writes a record's
# name into files no wave delivers: characters/<id>.html, its characters/a-z/ bucket, data/characters.json and
# data/characters-index.json (a character record, a characters-corrections `new` value, a characters-enrich row),
# data/matches-index.json (a carded character) and data/rps.json + data/rps-index.json (a roleplay record); and (re-cut, D490)
# rps/<year>/, promotions/<wing>/holdings*, and the pages of the characters beside or naming this one.
# wave-CHARFIRST-1998-5-1009 folded allows scoped to the rp page, the shard and two record files, and gate 369 went red on the four
# generated ones. For every allow row in this wave's fragment whose term has a deny the gate enforces (the main ledger or this
# fragment; exact status 'deny'; a scoped deny counts where its scope reaches the path; a memorial subject's own name is exempt,
# as in privacy-check.mjs), each generated path the term will reach, predicted from the wave's OWN records, must be covered by an
# allow in the main ledger or this fragment (rows of other unlanded waves do not count: the gate does not read them). Prefixes
# match as the gate matches them (path.startsWith(prefix), no slash trimming). The a-z bucket counts as covered by any allow
# prefix under characters/a-z/. This check REFUSES; it never widens a row. Rows are cited by file:line with the term's
# sha1(lower)[:8] and length, records by file and index, never by term or id (an id can carry the name).
import os as _ag_os, re as _ag_re, json as _ag_json, glob as _ag_glob, hashlib as _ag_hl   # own names: earlier sections rebind short ones (_hl is a str by here)
_ag_rows = []   # (path, line, term lower, status, prefixes, class, note)
for _ag_f in [f"{A}/privacy/redaction-ledger.tsv"] + ([frag] if _ag_os.path.exists(frag) else []):
    try:
        for _ag_i, _ag_l in enumerate(open(_ag_f, encoding="utf-8", errors="replace"), 1):
            if _ag_l.startswith("#") or not _ag_l.strip(): continue
            _ag_c = _ag_l.rstrip("\n").split("\t")
            if len(_ag_c) < 3 or not _ag_c[0].strip(): continue
            _ag_rows.append((_ag_f, _ag_i, _ag_c[0].strip().lower(), _ag_c[2].strip(),
                             [x.strip() for x in (_ag_c[3] if len(_ag_c) > 3 else "").split(",") if x.strip()],
                             _ag_c[1] if len(_ag_c) > 1 else "", _ag_c[5] if len(_ag_c) > 5 else ""))
    except Exception as _ag_e:
        probs.append(f"LAW L-ALLOW-GENERATED: could not read {_ag_os.path.basename(_ag_f)} ({type(_ag_e).__name__}); the generated-file cover is unjudged")
_ag_mine = [r for r in _ag_rows if r[0] == frag and r[3] == "allow" and r[4]]
def _ag_strs(o):
    if isinstance(o, str): yield o
    elif isinstance(o, dict):
        for v in o.values(): yield from _ag_strs(v)
    elif isinstance(o, list):
        for v in o: yield from _ag_strs(v)
_ag_recs = None   # [(kind, delta-relative file, index, record, lowercased text the build carries)], read once, only when needed
def _ag_load():
    out = []
    for f in sorted(_ag_glob.glob(f"{W}/delta/data/**/*.json", recursive=True)):
        b = _ag_os.path.basename(f)
        kind = ("char" if b == "characters.json" or b.startswith("characters-append") else
                "rp" if b == "rps.json" or b.startswith("rps-append") else
                "corr" if b.startswith("characters-corrections") else
                "enrich" if b.startswith("characters-enrich") else None)
        if not kind: continue
        try: data = _ag_json.load(open(f, encoding="utf-8"))
        except Exception: continue   # an unreadable delta file is the shape checks' to report
        for k, r in enumerate(data if isinstance(data, list) else []):
            if not isinstance(r, dict): continue
            src = r.get("new") if kind == "corr" else ({x: y for x, y in r.items() if x != "id"} if kind == "enrich" else r)
            out.append((kind, f.split("/delta/", 1)[-1], k, r, "\n".join(_ag_strs(src)).lower()))
    return out
_ag_live_mx = None
def _ag_carded(rid):
    """a character id a show in this wave cards, or one already carded in the live match index: its name reaches matches-index"""
    global _ag_live_mx
    if _ag_live_mx is None:
        _ag_live_mx = ""
        for f in [f"{M}/data/matches-index.json"] + [g for g in _ag_glob.glob(f"{W}/delta/data/**/*.json", recursive=True)
                                                     if any(w in _ag_os.path.basename(g) for w in ("shows", "matches", "appearances"))]:
            try: _ag_live_mx += open(f, encoding="utf-8", errors="replace").read() + "\n"
            except Exception: pass
    return bool(rid) and rid in _ag_live_mx and _ag_re.search(r"(?<![a-z0-9-])" + _ag_re.escape(rid) + r"(?![a-z0-9-])", _ag_live_mx) is not None
# ---- re-cut 2026-10-09 (lane C214-LISTINGS; gate 369 red again, desk D490): three more families the build writes a record's text
# into, read from scripts/cross-reference.mjs. (a) the roleplay YEAR listing rps/<year>/ (index.html, 2.html, ...): every rp
# record's `title`, year = showDateKey(date)[0:4] or "undated". (b) the wing's HOLDINGS register promotions/<wing>/holdings.html,
# or promotions/<wing>/holdings-<group>-N.html once that group is chunked: one row per served file under
# promotions/<wing>/{archive,rp,news}/, labelled by the page's own <h1> (its <title> when the h1 is only the wing's name), grouped
# by data-doc-class (or, on a page that has none yet, its documents row's doc_class, which preflight stamps). (c) OTHER characters' pages: the prev/next PAGER on every character page names its two neighbours in the
# name-sorted entity list (sortKeyStr; the cause of the gate-369 "Psycho" pages), a record whose identity[] `with` names this
# character renders its name (renderIdentitySection), and a unit page lists its members by name (renderUnitsSection).
# Relationships are not rendered on character pages (only the instrument link), so they predict nothing.
_ag_GROUP = {"charter": "charter", "card": "cards", "rp": "roleplays", "roleplay": "roleplays", "news": "news", "poll": "polls",
             "faq": "faqs", "rules": "rules", "staff": "staff", "roster": "staff", "column": "columns", "board": "boards",
             "other": "other", "machine-translation": "other"}   # cross-reference.mjs CLASS_GROUP
def _ag_sk(n):   # cross-reference.mjs sortKeyStr
    return _ag_re.sub(r"[^a-z0-9]+", " ", _ag_re.sub(r"^the\s+", "", str(n or ""), flags=_ag_re.I).lower()).strip()
def _ag_year(d):   # cross-reference.mjs showDateKey, the year part; "undated" when it has none
    if not isinstance(d, dict) or d.get("precision") == "unknown": return "undated"
    m = _ag_re.search(r"(\d{4})", str(d.get("date") or ""))
    return m.group(1) if m else "undated"
def _ag_arr(p, key):
    try: d = _ag_json.load(open(p, encoding="utf-8"))
    except Exception: return []
    if isinstance(d, dict): d = d.get(key)
    return [x for x in (d or []) if isinstance(x, dict)]
_ag_reg = None   # the merged entity list (live registry + this wave's records), read once, only when a name carries a denied term
def _ag_registry():
    global _ag_reg
    if _ag_reg is not None: return _ag_reg
    chars = _ag_arr(f"{M}/data/characters.json", "characters"); units = _ag_arr(f"{M}/data/units.json", "units")
    pos = {str(e.get("id")): i for i, e in enumerate(chars)}
    for kind, rel, k, r, txt in _ag_recs:   # a landed wave's own records are already live; an unlanded one's join (new at the end)
        rid = str(r.get("id") or "")
        if not rid: continue
        if kind == "char":
            if rid in pos: chars[pos[rid]] = r
            else: pos[rid] = len(chars); chars.append(r)
        elif kind == "corr" and rid in pos and r.get("field") == "name" and isinstance(r.get("new"), str):
            chars[pos[rid]] = dict(chars[pos[rid]], name=r.get("new"))
    ents = chars + units
    flat = sorted(ents, key=lambda e: _ag_sk(e.get("name")))   # stable, as the JS sort is
    alias = {}
    for a in _ag_arr(f"{M}/data/aliases.json", "aliases"):
        if a.get("from") and a.get("to"): alias[str(a["from"])] = str(a["to"])
    def res(i):
        seen = set()
        while i in alias and i not in seen: seen.add(i); i = alias[i]
        return i
    xref = {}   # character id -> ids of OTHER records whose page names it (identity[] with, unit members)
    for e in ents:
        eid = str(e.get("id") or "")
        for a in e.get("identity") or []:
            for w in (a.get("with") or []) if isinstance(a, dict) else []:
                xref.setdefault(res(str(w)), set()).add(eid)
        for mem in e.get("members") or []:
            if isinstance(mem, dict) and mem.get("character_id"): xref.setdefault(str(mem["character_id"]), set()).add(eid)
    _ag_reg = ({str(e.get("id")): i for i, e in enumerate(flat)}, flat, xref)
    return _ag_reg
_ag_pages = None   # [(wing, group, lowercased holdings label, delta-relative file)] for the pages this wave delivers
def _ag_load_pages():
    out = []; promos = {}; dcls = {}
    # a delivered page often carries no data-doc-class yet: fix-provenance-block.py stamps it at preflight from the page's
    # documents row (doc_class, respelled as fix-doc-class-v109.py does), so the wave's own documents rows decide the group
    for g in sorted(_ag_glob.glob(f"{W}/delta/data/documents*.json")):
        for d in _ag_arr(g, "documents"):
            if d.get("page") and d.get("doc_class"):
                c = str(d["doc_class"]).lower(); dcls[str(d["page"]).lstrip("/")] = {"roleplay": "rp", "charter": "rules", "faq": "rules", "index": "other", "none": "other"}.get(c, c)
    for g in sorted(_ag_glob.glob(f"{W}/delta/promotions/*/*/*.html")):
        parts = g.split("/delta/", 1)[-1].split("/")
        if len(parts) != 4 or parts[2] not in ("archive", "rp", "news"): continue
        try: src = open(g, encoding="utf-8", errors="replace").read()
        except Exception: continue
        if not promos:
            promos = {str(p.get("id")): p for p in _ag_arr(f"{M}/data/promotions.json", "promotions")} or {"": {}}
        p = promos.get(parts[1]) or {}
        bare = {str(x).lower() for x in (p.get("name"), p.get("acronym"), p.get("id")) if x}
        cm = _ag_re.search(r'data-doc-class\s*=\s*"([^"]+)"', src, _ag_re.I)
        h1 = _ag_re.search(r"<h1[^>]*>([^<]*)</h1>", src); h1 = h1.group(1).strip() if h1 else ""
        label = h1 if h1 and _ag_re.sub(r"&[a-z#0-9]+;", " ", h1).strip().lower() not in bare else ""
        if not label:
            tm = _ag_re.search(r"<title>([^<]*)", src)
            if tm: label = " ".join(s for s in _ag_re.split(r"\s*&mdash;\s*", _ag_re.sub(r"\s*&mdash;\s*E-WRESTLING MUSEUM\s*$", "", tm.group(1).strip(), flags=_ag_re.I)) if s.strip() and s.strip().lower() not in bare)
        cls = cm.group(1).lower() if cm else dcls.get("/".join(parts), "other")
        out.append((parts[1], _ag_GROUP.get(cls, "other"), label.lower(), "/".join(parts)))
    return out
def _ag_targets(low):
    """{generated path or prefix: 'delta file record N'} the build will write this term into, from the wave's own records"""
    global _ag_recs, _ag_pages
    if _ag_recs is None: _ag_recs = _ag_load()
    rx = _ag_re.compile(r"(?<!\w)" + _ag_re.escape(low) + r"(?!\w)", _ag_re.I); out = {}
    for kind, rel, k, r, txt in _ag_recs:
        if low not in txt or not rx.search(txt): continue
        cite = f"{rel} record {k}"
        if kind == "rp":
            out.setdefault("data/rps.json", cite); out.setdefault("data/rps-index.json", cite)
            if isinstance(r.get("title"), str) and rx.search(r["title"]): out.setdefault(f"rps/{_ag_year(r.get('date'))}/", cite)
            continue
        rid = str(r.get("id") or "")
        for p in ([f"characters/{rid}.html"] if rid else []) + ["data/characters.json", "data/characters-index.json"]: out.setdefault(p, cite)
        if _ag_carded(rid): out.setdefault("data/matches-index.json", cite)
        if kind == "char": nm = [r.get("name")] + list(r.get("aka") or [])
        elif kind == "corr" and r.get("field") in ("name", "aka"): nm = list(_ag_strs(r.get("new")))
        else: nm = []
        if rx.search("\n".join(x for x in nm if isinstance(x, str))): out.setdefault("characters/a-z/", cite)
        # the page name only (entityLink and the pager label carry e.name, not an aka)
        own = r.get("name") if kind == "char" else (r.get("new") if kind == "corr" and r.get("field") == "name" else None)
        if rid and isinstance(own, str) and rx.search(own):
            ix, flat, xref = _ag_registry()
            i = ix.get(rid)
            others = set(xref.get(rid, ()))
            if i is not None:
                if i > 0: others.add(str(flat[i - 1].get("id")))
                if i + 1 < len(flat): others.add(str(flat[i + 1].get("id")))
            for o in sorted(others - {rid, "None", ""}): out.setdefault(f"characters/{o}.html", cite + " (pager or cross-reference)")
    if _ag_pages is None: _ag_pages = _ag_load_pages()
    for n, (wing, grp, label, rel) in enumerate(_ag_pages, 1):
        if low not in label or not rx.search(label): continue
        if rx.search(rel.replace("-", " ").replace("_", " ")): rel = f"delta/promotions/{wing}/ delivered page {n} in sorted order"
        p = (f"promotions/{wing}/holdings-{grp}" if _ag_os.path.exists(f"{M}/promotions/{wing}/holdings-{grp}-1.html")
             else f"promotions/{wing}/holdings.html")
        out.setdefault(p, f"{rel} (its holdings label)")
    return out
_ag_PFX = ("characters/a-z/", "rps/", "promotions/")   # targets judged as prefixes: any allow at or under them covers them
_ag_seen = set()
for _ag_src, _ag_line, _ag_low, _ag_st, _ag_sc, _ag_cls, _ag_note in _ag_mine:
    if _ag_low in _ag_seen: continue
    _ag_seen.add(_ag_low)
    _ag_same = [r for r in _ag_rows if r[2] == _ag_low]
    _ag_deny = [r for r in _ag_same if r[3] == "deny" and not _mem_exempt(_ag_low, r[5], r[6])]
    if not _ag_deny: continue
    _ag_dg = any(not r[4] for r in _ag_deny)
    _ag_ds = [p for r in _ag_deny for p in r[4]]
    _ag_al = [p for r in _ag_same if r[3] == "allow" for p in r[4]]
    _ag_rx = _ag_re.compile(r"(?<!\w)" + _ag_re.escape(_ag_low) + r"(?!\w)", _ag_re.I)
    _ag_open = []; _ag_add = []
    for _ag_p, _ag_from in sorted(_ag_targets(_ag_low).items()):
        if _ag_p.startswith(_ag_PFX):
            if not (_ag_dg or any(p.startswith(_ag_p) or _ag_p.startswith(p) for p in _ag_ds)): continue
            if any(p.startswith(_ag_p) or _ag_p.startswith(p) for p in _ag_al): continue
        else:
            if not (_ag_dg or any(_ag_p.startswith(p) for p in _ag_ds)): continue
            if any(_ag_p.startswith(p) for p in _ag_al): continue
        # a path that spells the term (a character id can) is named by its record, never written out
        _ag_show = _ag_p
        if _ag_rx.search(_ag_from.replace("-", " ").replace("_", " ")): _ag_from = "a wave record or page whose path spells the term"
        if _ag_p == "characters/a-z/": _ag_show = "characters/a-z/<the bucket page holding this name>.html"
        elif _ag_rx.search(_ag_p.replace("-", " ").replace("_", " ")): _ag_show = "characters/<the id of " + _ag_from.split(" (")[0] + ">.html"
        _ag_add.append(_ag_show); _ag_open.append(f"{_ag_show} (from {_ag_from})")
    if _ag_open:
        probs.append(f"LAW L-ALLOW-GENERATED: allow {_ag_os.path.basename(_ag_src)}:{_ag_line} (term sha1 {_ag_hl.sha1(_ag_low.encode('utf-8')).hexdigest()[:8]}, "
                     f"len {len(_ag_low)}) has a deny, and the build writes the term into {len(_ag_open)} generated file(s) or listing prefix(es) no "
                     f"allow covers. ADD TO THIS ALLOW'S SCOPE exactly: {', '.join(_ag_add[:24])}{' (+%d more)' % (len(_ag_add) - 24) if len(_ag_add) > 24 else ''}. "
                     f"Why each: {'; '.join(_ag_open[:24])}. That is the D485/D490 shape (an existing in-fiction allow widened to the "
                     f"pages built from the same record; desk-ruled when the deny is a real name, unless a standing D490b ruling covers it) or "
                     f"redact; the lane never widens on its own, and a bulk widening is not the fix (D317). rps/<year>/ and "
                     f"promotions/<wing>/holdings-<group> are prefixes (every part page); a pager neighbour moves if another landing wave "
                     f"inserts a name beside this one, so re-run the land-check after siblings land")
# ---- end L-ALLOW-GENERATED (hook c214)
# ---- SIBLING HAZARDS (2026-09-21): two unlanded waves must not deliver the same page, nor chain a correction on the other's unlanded value
_sib_root = os.path.dirname(W)
# 2026-09-22: siblings across every year's scratch tree, not only this wave's own (a 2002 wave and an unlanded 2001 wave
# can deliver the same live page or correct the same field)
_sibs = sorted({d for d in glob.glob(f"{_sib_root}/wave-*") + glob.glob(f"{os.path.dirname(_sib_root)}/scratch-*/wave-*")
                if os.path.realpath(d) != os.path.realpath(W) and os.path.isdir(f"{d}/delta") and not os.path.exists(f"{d}/APPLIED")})
_mine_pages = {os.path.relpath(pp, f"{W}/delta") for pp in glob.glob(f"{W}/delta/promotions/**/*.html", recursive=True)}
for _d in _sibs:
    for pp in glob.glob(f"{_d}/delta/promotions/**/*.html", recursive=True):
        _rel = os.path.relpath(pp, f"{_d}/delta")
        if _rel in _mine_pages and os.path.exists(f"{M}/{_rel}"):
            probs.append(f"sibling: {_rel} is also delivered by unlanded {os.path.basename(_d)} — two corrected copies of one live page overwrite each other; merge them into one wave")
_rc_mine = f"{W}/delta/data/registry-corrections.json"
if os.path.exists(_rc_mine):
    try:
        _rcm = json.load(open(_rc_mine)); _rcm = _rcm.get("corrections", _rcm) if isinstance(_rcm, dict) else _rcm
        _live_rows = {r.get("id"): r for r in json.load(open(f"{M}/data/promotions.json"))["promotions"]}
        # LANDCHECK-NOOP-SIBLING (hook c109, 2026-10-07): a row is keyed on the wing it lands on the way apply-corrections.py
        # reads it (`slug`, else `id`); keyed on `id` alone, every slug-keyed row was (None, field), matched any sibling's slug
        # rows on that field and compared with no live value at all. A no-op row (old == new, a pin) changes nothing and is
        # built on nothing: SWF-L02's pinned `years` was held against SWF-L03's identical pin (10-07), and siblings were parked
        # outside the waves dir all night to get past it.
        _c109_wing = lambda _x: _x["slug"] if "slug" in _x else _x.get("id")
        for _d in _sibs:
            _f = f"{_d}/delta/data/registry-corrections.json"
            if not os.path.exists(_f): continue
            try: _rs = json.load(open(_f)); _rs = _rs.get("corrections", _rs) if isinstance(_rs, dict) else _rs
            except Exception: continue
            _news = {(_c109_wing(x), x.get("field")): x.get("new") for x in _rs if isinstance(x, dict)}
            for x in (_rcm if isinstance(_rcm, list) else []):
                if not isinstance(x, dict): continue
                if x.get("old") == x.get("new"): continue          # a no-op pin is built on nothing (hook c109)
                k = (_c109_wing(x), x.get("field")); _live_v = (_live_rows.get(k[0]) or {}).get(k[1])
                if k in _news and x.get("old") != _live_v and x.get("old") == _news[k]:
                    probs.append(f"sibling: correction {k[0]}.{k[1]} is built on unlanded {os.path.basename(_d)}'s new value — it applies only after that wave lands (hold READY behind it)")
    except Exception as _e:
        probs.append(f"sibling: registry-corrections check could not run ({_e})")
# ---- SIBLING SAME-BASE (2026-09-21, HKW + PAW on jake-morgan-30mc-2001): two unlanded waves correcting the SAME field of
# the same record from the SAME old. List fields merge (registry provenance_notes/sources/aka; shard tenures that only add);
# any other field is a real conflict: registry scalars are overwritten by whichever lands last, shard fields apply once and
# the second is skipped. Merge the two into one wave, or rebase the later one on the earlier's new after it lands.
_LISTF = {"provenance_notes", "sources", "community_presence", "aliases", "aka", "tenures"}
def _corr_rows(dd):
    out = {}
    for f in glob.glob(f"{dd}/delta/data/*-corrections*.json"):
        if f.endswith(".APPLIED"): continue
        try: R = json.load(open(f)); R = R.get("corrections", R) if isinstance(R, dict) else R
        except Exception: continue
        kind = "registry" if os.path.basename(f).startswith("registry-") else os.path.basename(f).split("-corrections")[0]
        for x in (R if isinstance(R, list) else []):
            if isinstance(x, dict) and x.get("id") and x.get("field"): out[(kind, x["id"], x["field"])] = x.get("old"); _corr_new[(dd, kind, x["id"], x["field"])] = x.get("new")
    return out
_corr_new = {}
def _only_adds(_o, _n):
    # (2026-09-23, PURE-ROSTER + PURE-TITLES on the-hit.tenures) a list correction merges with a sibling's only when it ADDS
    # elements — every element of the shared old survives unchanged in its new. Rewriting an existing element (a tenure's role,
    # source, note, last_seen) is a scalar edit inside the list, and the second wave to land fails or overwrites the first.
    if not isinstance(_o, list) or not isinstance(_n, list): return False
    _ns = [json.dumps(e, sort_keys=True) for e in _n]
    return all(json.dumps(e, sort_keys=True) in _ns for e in _o)
_mine_c = _corr_rows(W)
if _mine_c:
    for _d in _sibs:
        for k, o in _corr_rows(_d).items():
            if k in _mine_c and o == _mine_c[k] and (k[2] not in _LISTF or not (_only_adds(o, _corr_new.get((W,) + k)) and _only_adds(o, _corr_new.get((_d,) + k)))):
                probs.append(f"sibling: {k[0]} correction {k[1]}.{k[2]} is also filed by unlanded {os.path.basename(_d)} from the same old — only one can apply; merge them or rebase this one after that wave lands")
# ---- L-APPLIED-PATHS (2026-09-22, JJG): a delta file no applier reads is silently dropped at landing. apply-delta.py
# copies delta/data/shards/<wing>/ files only under the seven kind names; the window's appliers read <kind>-append-*.json
# and <kind>-corrections-*.json at the TOP of delta/data only.
_KINDS7 = {"awards.json", "characters.json", "reigns.json", "rps.json", "shows.json", "titles.json", "units.json"}
for _root, _dirs, _files in os.walk(f"{W}/delta/data"):
    _rel = os.path.relpath(_root, f"{W}/delta/data")
    for _fn in _files:
        if _fn.endswith(".APPLIED"): continue
        if _rel.startswith("shards") and _rel != "shards" and _fn not in _KINDS7:
            probs.append(f"L-PATH: delta/data/{_rel}/{_fn} is never applied (shard folders take only the seven <kind>.json files; appends and corrections go at the top of delta/data)")
        elif _rel not in (".", "shards") and not _rel.startswith("shards"):
            probs.append(f"L-PATH: delta/data/{_rel}/{_fn} is never applied (no applier reads subfolders of delta/data other than shards/<wing>/)")

# ---- L-NOAPPLIER (job J38, 2026-09-27): L-PATH above only catches a wrong-shaped file inside a SUBFOLDER of
# delta/data. Twice today a wave would have been stamped APPLIED while landing nothing because a file sitting
# directly at the TOP of delta/data matched no reader at all: a *-linksout-*.json shape (no applier ever read it),
# and collections-corrections.json (which had none until today's J34 fix). The window never says "I did not read
# this file"; this does. The pattern list below is every filename window.sh (A1-A4), apply-delta.py, or an
# ORDER.txt preflight fixer (apply-aliases-additions.py, apply-aliases-corrections.py, apply-relationships-append.py, apply-documents-missing.py,
# add-frontier-rows.py — a pattern read only by one of these still counts: it lands a cycle later, not never) reads
# out of a wave's delta — derived file-by-file in the workshop's APPLIER-MAP.md; keep the two in
# sync. A file matching none of them is reported here, before it ever reaches a window.
_NOAPPLIER_TOP = [
    r'^collections-rows\.json$',                                        # apply-collections-rows.py (window A1 + standing §6b)
    r'^collections-append\.json$',                                      # apply-collections-append.py (window A1 + standing §6b)
    r'^collections-corrections\.json$',                                 # apply-collections-corrections.py (window A1 + standing §6b)
    r'^promotions-rows?\.json$',                                        # apply-delta.py itself (inline)
    r'^promotions-append.*\.json$',                                     # apply-promotions-append.py (window A3 + standing §6l)
    r'^registry-corrections\.json$',                                    # apply-corrections.py (window A3 + standing §6d)
    r'^(awards|characters|reigns|rps|shows|titles|units)-append-[^/]+\.json$',   # apply-shard-append.py (window A3 + standing §6g)
    r'^affiliations-rows-.*\.json$',                                    # apply-affiliation-rows.py (window A3 + standing §6h)
    r'^memorials-append.*\.json$',                                      # apply-memorials-append.py (window A3 ONLY — no standing backstop)
    r'^essays-append.*\.json$',                                         # apply-essays-append.py (window A3 ONLY; hook c108, CURATION.md v129)
    r'^frontier-rows\.json$',                                           # add-frontier-rows.py (ORDER.txt preflight + standing §4)
    r'^frontier-new-rows\.json$',                                       # apply-frontier.py (window A3)
    r'^frontier-corrections\.json$',                                    # apply-frontier.py (window A3)
    r'^enrich-frontier-.*\.json$',                                      # apply-frontier.py (window A3)
    r'^frontier-queue-year\.json$',                                     # apply-frontier-queue-year.py (window A3 + ORDER.txt
                                                                         # standing fixer fix-frontier-queue-year.py; hook c146)
    r'^external-figures\.json$',                                        # apply-delta.py itself (inline, whole-file)
    r'^external-figures-append\.json$',                                 # apply-external-figures.py (window A3 + standing §6h)
    r'^external-figures-enrich\.json$',                                 # apply-external-figures.py (window A3 + standing §6h)
    r'^inductions-append-[^/]+\.json$',                                 # apply-inductions.py (window A3 + standing §6h) — NOTE: bare
                                                                         # "inductions-append.json" (no -<slug>) is NOT read: window.sh's
                                                                         # own `ls` trigger is looser than the applier's own glob and
                                                                         # would stamp INDUCTIONS.APPLIED having landed nothing (left
                                                                         # unmatched here on purpose so that shape is caught)
    r'^page-corrections\.json$',                                        # apply-page-corrections.py + apply-docclass-to-registry.py (A3 + standing §6i)
    r'^documents-append.*\.json$',                                      # apply-documents-append.py (window A3 + standing §6k; both
                                                                         # documents-append.json and documents-append-<wing>.json)
    r'^aliases-additions\.json$',                                       # apply-aliases-additions.py (ORDER.txt preflight ONLY)
    r'^aliases-corrections\.json$',                                     # apply-aliases-corrections.py (ORDER.txt preflight ONLY; hook c81)
    r'^relationships-append-[^/]+\.json$',                              # apply-relationships-append.py (ORDER.txt preflight ONLY)
    r'^[a-z]+-corrections-[^/]+\.json$',                                # apply-shard-paths.py (path-shaped fields) and/or
                                                                         # apply-characters-corrections.py (plain fields) — window A3/A4
    r'^[a-z]+-delete-[^/]+\.json$',                                     # apply-shard-paths.py (window A3 + standing §6m)
    r'^(awards|characters|reigns|rps|shows|titles|units)-retire\.json$',  # apply-shard-paths.py's fixed retire list (window A3 + standing §6m)
    r'^(shows|characters|units|titles|reigns|awards|rps)-enrich-[^/]+\.json$',  # apply-shard-enrich.py — NOT in window.sh, ORDER.txt or
                                                                         # standing-window-fixers.sh; only ever invoked from the per-cycle,
                                                                         # hand-copied workshop tools' post-chain<N>-
                                                                         # window.sh scripts (checked through post-chain146-window.sh, the
                                                                         # latest non-retired one) — confirmed still landing (michael-manson's
                                                                         # backyard-wrestling-2005 tenure, wave-FW-BACKYARD) but on a fragile,
                                                                         # non-standing path; see APPLIER-MAP.md
    # ---- J38b (2026-09-27): six shapes that had no reader when this list was written and have a standing applier in
    # scripts/fixers/ from today (kit-j38b/README.md). Every one of them was already sitting in APPLIED waves having
    # landed nothing, so they are added here only WITH those appliers installed — never ahead of them, or the list
    # would claim a reader that does not exist.
    r'^review-queue-(append|additions)\.json$',                         # apply-review-queue-append.py (ORDER.txt preflight)
    r'^affiliations-append.*\.json$',                                   # apply-affiliations-append.py (ORDER.txt preflight)
    r'^affiliations-rows\.json$',                                       # apply-affiliations-append.py — the bare name apply-affiliation-rows.py's
                                                                         # own -<x> glob never matched (wave-FW-HUB)
    r'^affiliations-corrections\.json$',                                # apply-affiliations-corrections.py (ORDER.txt preflight)
    r'^frontier-leads-append\.json$',                                   # apply-frontier-leads-append.py (ORDER.txt preflight)
    r'^promotion-epitaph-authorship-append\.json$',                     # apply-epitaph-authorship-append.py (ORDER.txt preflight)
    # ---- J40b (2026-09-27): the review-queue CORRECTION shape. J38b's line above reads review-queue-append /
    # -additions (new rows and status transitions); nothing corrected a FIELD of a row already in the file until
    # apply-review-queue-corrections.py, which is what wave-REPOINT-REPAIR-0927-RQ's 113 restored tokens land
    # through. Add this line only WITH that applier installed (kit-j40b/README.md).
    r'^review-queue-corrections\.json$',                               # apply-review-queue-corrections.py (ORDER.txt preflight)
    r'^wing-merge\.json$',                                              # apply-wing-merge.py (window A3, after apply-shard-paths; hook c104)
    r'^pages-withdraw\.json$',                                          # apply-pages-withdraw.py (window A3, after the wing merge; hook c248)
]
_NOAPPLIER_TOP_RE = [re.compile(_p) for _p in _NOAPPLIER_TOP]
_noap_dd = f"{W}/delta/data"
if os.path.isdir(_noap_dd):
    for _noap_fn in sorted(os.listdir(_noap_dd)):
        _noap_fp = os.path.join(_noap_dd, _noap_fn)
        if not os.path.isfile(_noap_fp) or _noap_fn.endswith(".APPLIED"): continue
        if ".bak" in _noap_fn or "." not in _noap_fn: continue  # a deliberate backup rename, or a bare timestamp
                                                                 # marker (RETIRED, same convention as APPLIED/READY)
                                                                 # — neither is data a wave means to land
        if not any(_noap_r.match(_noap_fn) for _noap_r in _NOAPPLIER_TOP_RE):
            probs.append(f"L-NOAPPLIER: delta/data/{_noap_fn} matches no known landing pattern — nothing reads this file; it would land nothing (see kit-j38/APPLIER-MAP.md)")
# apply-delta.py's own walk copies ONLY .html under delta/memorials/ (anything else is silently `continue`d, not even
# reported), and only delta/epitaphs/<wing>.html is read by its epitaph block — same silent-drop shape as the
# delta/data case above, so it gets the same class. (delta/promotions/ already has this exact check under L-DELTAFILE,
# added 2026-09-26 — not duplicated here.)
for _noap_sub, _noap_label in (("epitaphs", "delta/epitaphs"), ("memorials", "delta/memorials")):
    _noap_base = f"{W}/delta/{_noap_sub}"
    if not os.path.isdir(_noap_base): continue
    for _noap_root, _noap_dirs, _noap_files in os.walk(_noap_base):
        for _noap_fn in _noap_files:
            if _noap_fn.endswith(".APPLIED") or _noap_fn.endswith(".html"): continue
            probs.append(f"L-NOAPPLIER: {os.path.relpath(os.path.join(_noap_root, _noap_fn), W)} is not a .html file — apply-delta.py copies only .html under {_noap_label}/; anything else is silently skipped, never reported until now")

_ENAMES = None
def _entity_names(eid, wdir):
    """Display name + akas for an entity id, from the live shards and the wave's own delta shards (L-WINNER)."""
    global _ENAMES
    if _ENAMES is None:
        _ENAMES = {}
        for _p in glob.glob(f"{M}/data/shards/*/characters.json") + glob.glob(f"{M}/data/shards/*/units.json") + \
                  glob.glob(f"{wdir}/delta/data/shards/*/characters.json") + glob.glob(f"{wdir}/delta/data/shards/*/units.json"):
            try: _d = json.load(open(_p))
            except Exception: continue
            for _e in (_d if isinstance(_d, list) else []):
                if isinstance(_e, dict) and _e.get("id"):
                    _ENAMES[_e["id"]] = [x for x in [_e.get("name")] + list(_e.get("aka") or []) if isinstance(x, str)]
    return _ENAMES.get(eid, [])
# ---- L-TENURE-WING (2026-09-26): an indexed tenure correction must land on a tenure of its own file's wing. E2C's
# characters-corrections-cswa.json aimed tenures[1].first_seen (old "?") at tom-adler, whose tenures[1] is his UWA stint
# (first_seen "?" too), so the byte-match passed and the wrong wing's date would have moved.
_lsh = None
for _cf in glob.glob(f"{W}/delta/data/characters-corrections-*.json") + glob.glob(f"{W}/delta/data/units-corrections-*.json"):
    _cw = os.path.basename(_cf).split("-corrections-", 1)[1][:-5]
    try: _CR = json.load(open(_cf))
    except Exception: continue
    for _r in (_CR if isinstance(_CR, list) else []):
        _mt = re.match(r"^tenures\[(\d+)\]", str(_r.get("field") or "")) if isinstance(_r, dict) else None
        if not _mt: continue
        if _lsh is None:
            _lsh = {}
            for _p in glob.glob(f"{M}/data/shards/*/characters.json") + glob.glob(f"{M}/data/shards/*/units.json"):
                try:
                    for _e in json.load(open(_p)):
                        if isinstance(_e, dict) and _e.get("id"): _lsh[_e["id"]] = _e
                except Exception: pass
        _rec = _lsh.get(_r.get("id")); _ti = int(_mt.group(1))
        if not _rec: continue
        _ten = _rec.get("tenures") or []
        _pr = _ten[_ti].get("promotion") if _ti < len(_ten) and isinstance(_ten[_ti], dict) else None
        if _pr != _cw:
            probs.append(f"L-TENURE-WING: {os.path.basename(_cf)}: {_r.get('id')} {_r.get('field')} lands on the live tenure of '{_pr}', not '{_cw}' (indexed paths shift; aim at the {_cw} stint by its own index)")
# ---- L-DOCROWS (2026-09-26, preflight 187 red 2): every page a wave serves needs its documents.json row in the wave's
# own delta/data/documents-append[-<wing>].json. The New ERA waves carried none; E4-2004A's 8 pages landed rowless,
# rendered "Source undetermined", and validate-documents stopped the cycle.
_served = ["/" + _p.split("/delta/", 1)[1] for _p in glob.glob(f"{W}/delta/promotions/*/archive/*.html") + glob.glob(f"{W}/delta/promotions/*/rp/*.html")]
if _served:
    _rowed = set()
    for _df in glob.glob(f"{W}/delta/data/documents-append*.json"):
        if _df.endswith(".APPLIED"): continue
        try: _rowed |= {r.get("page") for r in json.load(open(_df)) if isinstance(r, dict)}
        except Exception: pass
    _live_doc = None
    _missing = [p for p in _served if p not in _rowed]
    if _missing:
        try: _live_doc = {r.get("page") for r in json.load(open(f"{M}/data/documents.json"))["documents"]}
        except Exception: _live_doc = set()
        _missing = [p for p in _missing if p not in _live_doc]
    if _missing:
        probs.append(f"L-DOCROWS: {len(_missing)} served page(s) have no documents-append row in delta/data/documents-append-<wing>.json (e.g. {_missing[0]}); every served page needs its row (page, wing, doc_class, collection, sources with the linked url, document_date, parts, served_since, language)")
# ---- L-GATE-SHAPES (2026-09-22, preflight 165): three registry-validate rules lanes kept missing. Every title a wave
# delivers carries an `epitaph` (+ epitaph_asof.author); every match a numeric `order`; winner_side is an index or absent.
for _f in glob.glob(f"{W}/delta/data/titles-append-*.json") + glob.glob(f"{W}/delta/data/shards/*/titles.json"):
    try: _T = json.load(open(_f))
    except Exception: continue
    for _t in (_T if isinstance(_T, list) else []):
        if isinstance(_t, dict) and _t.get("id") and not _t.get("epitaph"):
            probs.append(f"L-SHAPE: title {_t['id']} has no \"epitaph\" (every title needs one; plain facts from its own reigns, with epitaph_asof {{written, evidence, author: 'ai'}})")
for _f in glob.glob(f"{W}/delta/data/shows-append-*.json") + glob.glob(f"{W}/delta/data/shards/*/shows.json"):
    try: _S = json.load(open(_f))
    except Exception: continue
    for _s in (_S if isinstance(_S, list) else []):
        for _i, _m in enumerate((_s.get("matches") or []) if isinstance(_s, dict) else []):
            if not isinstance(_m, dict): continue
            if not isinstance(_m.get("order"), (int, float)) or isinstance(_m.get("order"), bool):
                probs.append(f"L-SHAPE: show {_s.get('id')} match {_i}: needs a numeric \"order\""); break
            if "winner_side" in _m and _m["winner_side"] is None:
                probs.append(f"L-SHAPE: show {_s.get('id')} match {_i}: winner_side null (omit it for an unresolved match)"); break
            # L-WINNER (2026-09-26, preflight 187 red): winner_side is a 0-BASED index into sides. The New ERA lanes wrote
            # it 1-based, landing 16 out-of-range values and 14 in-range ones that named the LOSER. Range-check it, and
            # where the match's own note opens "<name> won/retained/defeated/pinned…" and that name belongs to exactly
            # one side, that side must be winner_side.
            _ws = _m.get("winner_side"); _sides = _m.get("sides") if isinstance(_m.get("sides"), list) else None
            if _ws is not None and _sides is not None:
                if not isinstance(_ws, int) or isinstance(_ws, bool) or not (0 <= _ws < len(_sides)):
                    probs.append(f"L-WINNER: show {_s.get('id')} match {_i}: winner_side {_ws!r} is not a 0-based index into its {len(_sides)} sides"); break
                _hm = None
                for _sent in re.split(r"(?<=[.;!?])\s+", str(_m.get("note") or "")):
                    _hm = re.match(r"\s*([^.;!?]{2,60}?)\s+(?:won|wins|retained|retains|defeated|defeats|pinned|pins)\b", _sent)
                    if _hm and re.search(r"\b(?:nearly|almost|never|not|would|could|should|if|until|before)\b", _hm.group(1), re.I): _hm = None
                    if _hm: break
                if _hm:
                    _head = _hm.group(1).lower(); _hit = []
                    for _k, _sd in enumerate(_sides):
                        for _eid in (_sd if isinstance(_sd, list) else [_sd]):
                            if any(_n and len(_n) >= 3 and re.search(r"(?<!\w)" + re.escape(_n.lower()) + r"(?!\w)", _head) for _n in _entity_names(_eid, W)):
                                _hit.append(_k); break
                    if len(set(_hit)) == 1 and _hit[0] != _ws:
                        probs.append(f"L-WINNER: show {_s.get('id')} match {_i}: the note names side {_hit[0]} as the winner (\"{_hm.group(0).strip()[:60]}\") but winner_side is {_ws} (0-based)"); break
            _emp=[k for k in ("stipulation","note","finish","how","title","method") if k in _m and (_m[k] is None or (isinstance(_m[k],str) and not _m[k].strip()))]
            _emp+=["eliminations.by" for e in (_m.get("eliminations") or []) if isinstance(e,dict) and "by" in e and (e["by"] is None or (isinstance(e["by"],str) and not e["by"].strip()))]
            if _emp:
                probs.append(f"L-SHAPE: show {_s.get('id')} match {_i}: empty or null {sorted(set(_emp))} (omit an optional field rather than leave it empty)"); break
# ---- tier-2+ federations owe a house_style (registry-validate ratchet house-style-missing-tier2plus; preflight 166)
_live_p = {r.get("id"): r for r in json.load(open(f"{M}/data/promotions.json"))["promotions"]}
_tier_new = {}
for _pf in glob.glob(f"{W}/delta/data/promotions-append*.json")+glob.glob(f"{W}/delta/data/promotions-rows*.json"):
    try: _pd = json.load(open(_pf)); _pd = _pd.get("promotions", _pd) if isinstance(_pd, dict) else _pd
    except Exception: continue
    for _r in (_pd if isinstance(_pd, list) else [_pd]):
        if isinstance(_r, dict) and _r.get("id"): _tier_new[_r["id"]] = dict(_r)
try:
    _rc = json.load(open(f"{W}/delta/data/registry-corrections.json")); _rc = _rc.get("corrections", _rc) if isinstance(_rc, dict) else _rc
except Exception: _rc = []
for _c in (_rc if isinstance(_rc, list) else []):
    if isinstance(_c, dict) and _c.get("field") in ("tier", "house_style", "type") and _c.get("id"):
        _tier_new.setdefault(_c["id"], dict(_live_p.get(_c["id"], {})))[_c["field"]] = _c.get("new")
for _id, _r in _tier_new.items():
    try: _t = int(_r.get("tier") or 0)
    except Exception: _t = 0
    if _t >= 2 and (_r.get("type") or "federation") == "federation" and not _r.get("house_style"):
        probs.append(f"L-SHAPE: {_id} is tier {_t} but carries no house_style (a graded, sourced house_style is owed at tier 2+)")
# ---- L-QUAL (2026-09-21): a date-only qualifier while the promotion's own full name offers a distinguishing word
_GENERIC = {"wrestling","federation","championship","alliance","association","league","council","organization","organisation","entertainment","world","international","pro","professional","e-wrestling","ewrestling","of","the","and","e","extreme","federations"}
def _qual_is_date_only(nm):
    m_ = __import__("re").search(r"\(([^)]*)\)\s*$", nm or "")
    if not m_: return False
    return bool(__import__("re").fullmatch(r"(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* )?\d{4}(?:[–-]\d{2,4})?(?:, \d{4}(?:[–-]\d{2,4})?)*", m_.group(1).strip()))
def _distinct_words(fn, acr):
    ws = [w for w in __import__("re").findall(r"[A-Za-z][A-Za-z'-]+", fn or "") if w.lower() not in _GENERIC]
    return ws
_qrows = []
for _pf in glob.glob(f"{W}/delta/data/promotions-append*.json")+glob.glob(f"{W}/delta/data/promotions-rows*.json"):
    try: _pd = json.load(open(_pf)); _pd = _pd.get("promotions", _pd) if isinstance(_pd, dict) else _pd
    except Exception: continue
    for r in (_pd if isinstance(_pd, list) else [_pd]):
        if isinstance(r, dict): _qrows.append((r.get("id"), r.get("name"), r.get("full_name")))
if os.path.exists(_rc_mine):
    try:
        _live_rows = {r.get("id"): r for r in json.load(open(f"{M}/data/promotions.json"))["promotions"]}
        for x in (_rcm if isinstance(_rcm, list) else []):
            if isinstance(x, dict) and x.get("field") == "name":
                fn = next((y.get("new") for y in _rcm if isinstance(y, dict) and y.get("id") == x.get("id") and y.get("field") == "full_name"), None) or (_live_rows.get(x.get("id")) or {}).get("full_name")
                _qrows.append((x.get("id"), x.get("new"), fn))
    except Exception: pass
for _id, _nm, _fn in _qrows:
    if _qual_is_date_only(_nm) and _distinct_words(_fn, None):
        probs.append(f"L-QUAL: {_id} is named {_nm!r} (date only) but its own full name {_fn!r} offers {', '.join(_distinct_words(_fn, None)[:3])!r} — the qualifier comes from the fed's own words before any date")
# ---- LAW-INDEX 2a / CURATION v105-v106: a real name served AS a character needs per-person participation evidence
import re as _re
_EVID=_re.compile(r"(msg_id|msgid|[A-Za-z0-9_-]{11}J\b|ledger[: ]|v105\(?[ab]\)?|public figure|participation\.tsv|parody mode|self-portrayal evidence)",_re.I)
_part=os.path.exists(f"{W}/participation.tsv")
# memorial exemption (CURATION #privacy, v74: a name on data/memorials.json is NEVER redacted; the memorial register is the evidence) — names on the register or on this wave's memorials-append.json need no participation evidence (coordinator, 2026-09-19)
_memnames=set()
try:
    import json as _mj
    for _src in (f"{M}/data/memorials.json", f"{W}/delta/data/memorials-append.json"):
        if os.path.exists(_src):
            _d=_mj.load(open(_src,encoding="utf-8")); _rows=_d["memorials"] if isinstance(_d,dict) and "memorials" in _d else _d
            for _r in (_rows if isinstance(_rows,list) else []):
                for _n in [_r.get("name")]+list(_r.get("aka") or []):
                    if _n: _memnames.add(str(_n).lower())
except Exception as _e: pass
if os.path.exists(frag):
    for l in open(frag):
        if l.startswith("#") or not l.strip() or l.startswith("term\t"): continue
        c=l.rstrip("\n").split("\t"); term,cls,st,sc,caught,note=(c+[""]*6)[:6]
        if st=="allow" and cls in ("in-character","self-portrayal","persona","public-figure","real-name") and not _EVID.search(note) and not _part and term.strip().lower() not in _memnames and not ("memorial" in (caught+note).lower() and sc and all(x.strip().startswith("memorials/") or x.strip()=="in-memoriam.html" for x in sc.split(","))):
            probs.append(f"LAW 2a: allow row for a real name as a character carries no participation evidence (msg_id / ledger row / v105 category) — {cls!r} scoped {sc[:50]}")

# ---- L-EPI: an EPITAPH wave (delta/epitaphs/<wing-id>.html = block inner) — CURATION #promotion-epitaphs, v68(c) prose-by-tier, v67(g) AI flag, LAW-INDEX §5 protagonist test (2026-09-19)
_EPD=f"{W}/delta/epitaphs"
if os.path.isdir(_EPD):
    import re as _er, json as _ej
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from process_markers import PROCESS as _PM
        # hook c165 (2026-10-09): the Janitor's D447 ruling 3 made the prose-hygiene rules law, and those rules
        # (the workshop's PROSE-HYGIENE-RULES-1008.tsv C02, D00-D04, H04, I03, I04) rewrite workshop narration INTO
        # "the held record" — the museum's own sanctioned phrase. So only the forms the E01 review wrote this pattern
        # for stay banned: held document(s), held corpus, a qualified "its own held record", the plural "held records".
        _PM=[_PM.pattern, r'\b(?:the|this|our) corpus\b', r'\bheld (?:document|corpus)\b', r'(?<!\bthe )\bheld record\b', r'\bheld records\b', r'\bposter[- ]fed\b', r'\bthe (?:museum|collection)\b', r'\baccession(?:ed)?\b']  # + served-text phrases the E01 review found (2026-09-19): the corpus, held record, the law's class word poster-fed  # PROCESS is one compiled pattern, not a list of raw strings — unwrap so re.search(pat, text, re.I) below works like the fallback list
    except Exception:
        _PM=[]
    # 2026-09-26: ALWAYS add the built-in list — the museum copy (scripts/ops) cannot import process_markers and used only
    # this list, while the workshop copy imported a shorter one; lanes passed what the READY watcher then refused.
    _PM=list(_PM)+[r"\bthis (collection|corpus|pass|pull|reading|walk|wave|lane)\b", r"\bthe museum\b", r"\bcoordinator\b", r"\bheld document", r"\bworkshop\b", r"\bledger\b", r"\bprovenance_notes\b", r"\bmsg_id\b", r"\b20\d\d-\d\d-\d\d\b"]
    _pj=_ej.load(open(f"{M}/data/promotions.json",encoding="utf-8")); _plist=_pj["promotions"] if isinstance(_pj,dict) else _pj
    _pmap={p["id"]:p for p in _plist}
    _acros={p["id"]:_er.sub(r"\s*\(.*$","",(p.get("name") or "")).strip() for p in _plist}  # 2026-09-19 (E06): compare the bare acronym, not "EWF (Mar 2003)"
    _n=0
    for _fn in sorted(os.listdir(_EPD)):
        if not _fn.endswith(".html"): continue
        _n+=1; _wid=_fn[:-5]; _txt=open(f"{_EPD}/{_fn}",encoding="utf-8",errors="replace").read()
        if _wid not in _pmap: probs.append(f"LAW L-EPI: {_wid}: no promotions.json row with that id"); continue
        if "<h2>Epitaph" not in _txt or 'class="ai-flag"' not in _txt: probs.append(f"LAW L-EPI: {_wid}: block must open with <h2>Epitaph <span class=\"ai-flag\" title=\"AI-generated prose\">AI</span></h2> (v67(g); house convention)")
        _paras=[_er.sub(r"<[^>]+>","",x).strip() for x in _er.findall(r"<p[^>]*>([\s\S]*?)</p>",_txt)]
        _paras=[x for x in _paras if x]
        if len(_paras)<3 or len(_paras)>6: probs.append(f"LAW L-EPI: {_wid}: {len(_paras)} paragraph(s) — an epitaph is 3–6 short paragraphs (#promotion-epitaphs)")
        _plain=" ".join(_paras)
        # registered character/unit names are the fiction, never narration (E03: the surname "Lane" tripped \blane\b) — mask them before the marker scan
        try:
            for _kind in ("characters","units"):
                _sf=f"{M}/data/shards/{_wid}/{_kind}.json"
                if os.path.exists(_sf):
                    for _row in _ej.load(open(_sf,encoding="utf-8")):
                        for _nm2 in [_row.get("name")]+list(_row.get("aka") or []):
                            if _nm2 and len(_nm2)>=3:
                                _q=_er.sub(r"[\"\u201c\u201d\u2018\u2019\x27]","",_nm2)  # names carry straight quotes in JSON; pages carry &ldquo;/&rdquo; entities — match on the quote-free form (E24: "Sweetstuff" Scott Lane)
                                _plain=_er.sub(r"\b"+_er.escape(_nm2)+r"\b","NAME",_plain)
                                if _q!=_nm2: _plain=_er.sub(r"\b"+_er.escape(_q)+r"\b","NAME",_plain)
                                for _tok in _q.split():
                                    if len(_tok)>=4 and _tok[0].isupper(): _plain=_er.sub(r"\b"+_er.escape(_tok)+r"\b","NAME",_plain)  # the surname alone
        except Exception: pass
        for _pat in _PM:
            _m=_er.search(_pat,_plain,_er.I)
            if _m: probs.append(f"LAW L-EPI: {_wid}: workshop narration in the epitaph ({_m.group(0)!r}) — the protagonist test, LAW-INDEX §5"); break
        _norm=lambda x:_er.sub(r"[^a-z0-9]","",x.lower())
        _ownset={_norm(_acros.get(_wid,""))}
        _fulln=(_pmap[_wid].get("full_name") or "")
        _ownset.add(_norm("".join(w[0] for w in _er.findall(r"[A-Za-z][A-Za-z0-9]*",_fulln) if w.lower() not in ("of","the","and","a","an","for","in","on"))))  # initials of the full name (Fantasy Wrestling America → FWA)
        for _oid,_nm in _acros.items():
            if _oid==_wid or len(_nm)<3 or _norm(_nm) in _ownset: continue  # a same-acronym namesake is this wing's own acronym, not a citation of the other wing  # a same-acronym namesake is this wing's own acronym, not a citation of the other wing
            _h=len(_er.findall(r"\b"+_er.escape(_nm)+r"\b",_plain))
            if _h>2: print(f"-- L-EPI NOTE (read it, do not fail it — PROCESS Prose: the lint's job is to make a human look): {_wid}: names another held promotion ({_nm}) {_h} times"); break
        if "<!-- epitaph:start" in _txt: probs.append(f"LAW L-EPI: {_wid}: ship the block INNER only — the applier writes the markers")
        if "<a " in _txt: probs.append(f"LAW L-EPI: {_wid}: no hand-written links — the auto-linker links registered names (PROCESS Cross-referencing)")
    print(f"-- epitaph wave: {_n} block(s) checked")

_pc=f"{W}/delta/data/page-corrections.json"
if os.path.exists(_pc):
    try: _rows=json.load(open(_pc))
    except Exception: _rows=[]
    # 2026-09-26 (COORD-OOC-BYLINES-2): only a row that REMOVES markers is a restore. A span-wrap or a wording repair
    # keeps the same number of markers in old and new, restores nobody, and needs no participation row.
    _nmk=lambda s: len(re.findall(r"\[redacted|\[(?:name|detail) withheld\]", str(s)))   # hook c208 (D480): both wordings
    _rest=[r for r in _rows if isinstance(r,dict) and _nmk(r.get("old","")) > _nmk(r.get("new",""))]
    if _rest and not _part: probs.append(f"LAW 2a: {len(_rest)} page-corrections rows restore redaction markers but the wave has no participation.tsv (name, category a/b/c, evidence) — restores are per person, never by structure alone")
# ---- show rows: page must start with "/"
import glob as _g
for f in _g.glob(f"{W}/delta/data/shards/*/shows.json")+_g.glob(f"{W}/delta/data/shows-append-*.json"):
    try: R=json.load(open(f))
    except Exception: continue
    for r in (R if isinstance(R,list) else []):
        if isinstance(r,dict) and isinstance(r.get("page"),str) and not r["page"].startswith("/"): print(f"   show {r.get('id')}: page without leading slash ({os.path.basename(f)})")
# ---- SERVED-TEXT RULE (the Janitor 2026-09-05): no process text in served fields; medium_detail ≤ 60
import re as _re, glob as _g
_PROC=_re.compile(r"distinct from|see provenance|provenance_notes|do-not-merge|operator signing|run by an operator|signing as|\bmember federation\b|the museum|this collection|frontier row|the frontier|\blane\b|wave-|\bledger\b|\bCOORDINATOR\b|interfed frontier|rule code|its own wing, id",_re.I)
for f in _g.glob(f"{W}/delta/data/promotions-rows.json")+_g.glob(f"{W}/delta/data/frontier-new-rows.json")+_g.glob(f"{W}/delta/data/affiliations-rows-*.json")+_g.glob(f"{W}/delta/data/*-append-*.json")+_g.glob(f"{W}/delta/data/captions.json"):
    try: R=json.load(open(f))
    except Exception: continue
    for r in (R if isinstance(R,list) else []):
        if not isinstance(r,dict): continue
        for k in ("name","full_name","caption","tagline","medium_detail","house_style","new_caption","epitaph","qualifier","depth"):
            v=r.get(k)
            _rx=_re.compile(_PROC.pattern+"|-- ",_re.I) if k in ("name","full_name","qualifier") else _PROC
            if isinstance(v,str) and _rx.search(v): print(f"   SERVED-TEXT: {os.path.basename(f)} {r.get('id') or r.get('slug') or ''} {k}: process text ({_rx.search(v).group(0)})")
        if isinstance(r.get("qualifier"),str) and len(r["qualifier"])>40: print(f"   SERVED-TEXT: {os.path.basename(f)} {r.get('id')} qualifier {len(r['qualifier'])} chars (> 40)")
        if isinstance(r.get("medium_detail"),str) and len(r["medium_detail"])>60: print(f"   SERVED-TEXT: {os.path.basename(f)} {r.get('id')} medium_detail {len(r['medium_detail'])} chars (> 60)")
        for side in ("a","b"):
            pt=r.get(side)
            if isinstance(pt,dict) and isinstance(pt.get("name"),str) and _PROC.search(pt["name"]): print(f"   SERVED-TEXT: {os.path.basename(f)} affiliation {side}.name: process text")
# ---- WORKSHOP-PATH: no served shard/registry field may carry a workshop path (validate.mjs reds on a workshop-digest path)
import glob as _g2
for f in _g2.glob(f"{W}/delta/data/**/*.json",recursive=True):
    try: raw=open(f,encoding="utf-8").read()
    except Exception: continue
    if "archive" "/digests/" in raw or "archive" "/usenet-retro/" in raw: print(f"   WORKSHOP-PATH: {os.path.relpath(f,W)} carries a workshop path — served fields cite sources in plain words")
# ---- UNIT-IN-CHARACTERS: a unit record (type "unit") inside a characters file/append skews the registers by one each way
import glob as _g3
for f in _g3.glob(f"{W}/delta/data/characters-append-*.json")+_g3.glob(f"{W}/delta/data/shards/*/characters.json"):
    try: R=json.load(open(f))
    except Exception: continue
    for r in (R if isinstance(R,list) else []):
        if isinstance(r,dict) and r.get("type")=="unit": print(f"   UNIT-IN-CHARACTERS: {os.path.relpath(f,W)} {r.get('id')} is a unit — file it in units.json / units-append")
# ---- CAPTION-SHAPE (2026-09-06, L150's IWF rows): caption must be a non-empty string; tenures carry only the schema keys (caption=['wrestler'] crashed preflight 64; `role` singular is a legitimate free-text field).
TENURE_KEYS={"promotion","roles","first_seen","last_seen","source","grade","entrance_music","finisher","height","hometown","note","notes","record_declared","role","style","weight","alignment","signature_moves","manager","relationships","record","observed_moves","bio","catchphrases","declared_moves","age","birth_date"}  # the live key set 2026-09-06 (role = free-text description, legitimate)
for f in glob.glob(f"{W}/delta/data/characters-append-*.json")+glob.glob(f"{W}/delta/data/units-append-*.json")+glob.glob(f"{W}/delta/data/shards/*/characters.json")+glob.glob(f"{W}/delta/data/shards/*/units.json"):
    try: rows=json.load(open(f))
    except Exception: continue
    for r in (rows if isinstance(rows,list) else []):
        if not isinstance(r,dict): continue
        if not isinstance(r.get("caption"),str) or not r.get("caption","").strip(): print(f"   CAPTION-SHAPE: {os.path.relpath(f,W)} {r.get('id')}: caption is {type(r.get('caption')).__name__}, must be a non-empty string")
        for t in r.get("tenures",[]) or []:
            extra=set(t)-TENURE_KEYS
            if extra: print(f"   CAPTION-SHAPE: {os.path.relpath(f,W)} {r.get('id')}: tenure carries non-schema keys {sorted(extra)}")

# ---- LAW-INDEX sections this wave touches (cite them in the landing journal line)
_secs=[]
D=f"{W}/delta/data"
if os.path.isdir(D):
    fs=os.listdir(D)
    if any("page-corrections" in f for f in fs): _secs.append("§1 (served bodies) / §2a (restores)")
    if any(f.startswith("promotions-append") for f in fs): _secs.append("§3 (new wing identity) / §4 (self-presentation)")
    if any("awards" in f for f in fs): _secs.append("§2b (honours by character) / rule 10")
    if any("documents-append" in f for f in fs): _secs.append("§2c (document class) / §2d (contextual value)")
    if any("characters" in f or "units" in f for f in fs): _secs.append("§3 / §3a (identity)")
    if any("frontier" in f for f in fs): _secs.append("§7 (per-item admission)")
if os.path.exists(frag): _secs.append("§2 / §2a (privacy rows)")
print("-- LAW-INDEX sections to cite:", "; ".join(_secs) or "none detected")

# ---- LAW-INDEX 2: a deny row scoped to a page this wave delivers must not leave the term on the delta page (gate 140 run 6)
_fragfile=frag if os.path.exists(frag) else (f"{W}/privacy-fragment.tsv" if os.path.exists(f"{W}/privacy-fragment.tsv") else None)
if _fragfile:
    for l in open(_fragfile):
        if l.startswith("#") or not l.strip() or l.startswith("term\t"): continue
        c=l.rstrip("\n").split("\t"); term,cls,st,sc=(c+[""]*4)[:4]
        if st!="deny" or not sc: continue
        for pref in sc.split(","):
            pref=pref.strip()
            if pref.endswith(".html"):
                dp=f"{W}/delta/{pref}"
                if os.path.exists(dp):
                    r=subprocess.run(["grep","-ciwF",term,dp],capture_output=True,text=True)
                    if r.stdout.strip() not in ("","0"): probs.append(f"LAW 2: deny row {cls!r} is scoped to {pref} but the wave's own delta page still carries the term ({r.stdout.strip()} line(s)) — redact before READY")


# ===========================================================================
# THE LAW BLOCK (LAW-ENFORCEMENT-01, 2026-09-19 — the Janitor: "stop walking
# and landing wings until you can adequately enforce the law as we've written
# it. This cannot be on me to ask about ad hoc.")
#
# Every check below enforces a rule that was ALREADY WRITTEN and was caught
# ad hoc, by the coordinator's eye, in the week of 2026-09-14..19. Each
# failure line carries a rule id so a send-back names the law, not a symptom.
# The ids and their law:
#
#   LAW L-SHAPE   the wave's own delta shape (the pre-existing checks above)
#   LAW L-PROV    SCHEMA provenance_notes[] — every mint carries typed records
#                 including a `founding` one (journal 2026-09-19 09:33)
#   LAW L-IDENT   CURATION #no-auto-merge-no-silent-distinctness + the Janitor's
#                 2026-09-04 ACRONYM IS NOT A JOIN: a mint sharing an acronym
#                 with a held wing carries an identity[] assertion naming it
#   LAW L-PAGE    SCHEMA promotions.page == /promotions/<id>/
#   LAW L-SHARD   SCHEMA sharding — seven shard files per wing
#   LAW L-TIER    CURATION #tier-and-storylines — tier is 0..3 with a tier_source
#   LAW L-EPITAPH CURATION #promotion-epitaphs + PROCESS "Frontier -> Tier 0"
#                 step 4 ("No epitaph is owed below Tier 1")
#   LAW L-HOUSE   PROCESS "Tier 1 -> Tier 2" step 4 — house_style, graded, sourced
#   LAW L-STORY   CURATION #tier-and-storylines — storylines are tier 3's output
#   LAW L-SKEL    PROCESS "Frontier -> Tier 0" step 3 — the full marker skeleton
#   LAW L-ROSTER  SCHEMA roster_policy enum + its grade
#   LAW L-DATES   CURATION #nothing-backdated / SCHEMA founded/closed + source
#   LAW L-ENUM    the Janitor's 2026-09-10 gavel — medium is the PLATFORM, form
#                 is what the canon is, play/authorship their own sets
#   LAW L-AKA     SCHEMA aka[] — a label, never a sentence about the label
#   LAW L-DEPTH   CURATION #depth-defined — the phrase comes from the vocabulary
#   LAW L-TEXT    THE SERVED-TEXT RULE (the Janitor 2026-09-05) + CURATION
#                 #protagonist-test — no workshop narration in a served field
#   LAW L-DOC     CURATION v109(a) doc_class + SCHEMA documents.json
#   LAW L-SRC     the Janitor's 2026-09-07 SOURCE LINKS gavel
#   LAW L-WSPATH  the same gavel — a public source, never a workshop file path
#   LAW L110      CURATION #serve-on-contextual-value (v110) — one value line
#                 per served document outside card/rp/roster
#   LAW L10       the Janitor's 2026-09-13 rule 10 — award recipients are minted
#   LAW L-CONTACT CURATION #privacy-redaction — contact details redact in ANY
#                 context; a personal-host path is a contact detail (v74 slug rule)
#   LAW L-CREDIT  CURATION #privacy v74 — an out-of-character handler credit
#   LAW L-MEM     the memorial rules — a memorial-wall name serves only where the
#                 wave's own ledger fragment allows it
#   LAW L-REF     SCHEMA shows/rps — a registry row cites a page the wave delivers
#   LAW L-MIRROR  the privacy protocol — the ledger fragment and its mirror in
#                 the ledger's pending folder are the same bytes
#   LAW L-READY   LANE-RULES rule 2 — a lane never writes READY/README; the
#                 coordinator marks a wave ready
#   LAW L-DRAFT   a draft is never landed (2026-09-25: wave-COORD-PLACARDS'
#                 page carried "PREVIEW ONLY — NOT FOR LANDING" into its delta)
#   LAW L-DELTAPATH apply-delta lands data/ promotions/ epitaphs/ memorials/
#                 only, and refuses a delta carrying anything else (2026-09-25);
#                 galleries/img/characters/ lands memorial gallery images only:
#                 a new .jpg/.jpeg/.png/.gif, never a changed copy (hook c98)
#   LAW L-UNKNOWN-REF every character/unit id a wave's shows/rps/reigns/awards/
#                 units delta references is live, minted by the wave, or an
#                 alias `from` (the Janitor, D225 call 3, 2026-10-02)
#   LAW L-IDENTITY-TARGET every identity `with` id a wave's characters/units
#                 rows, appends and corrections carry is live, minted by the
#                 wave, or an alias `from`; whichever wave lands second names the
#                 other (hook c125, 2026-10-07)
#   LAW L-WINGMERGE a wing merge (delta/data/wing-merge.json) names only live ids,
#                 edges and document rows of its two wings, and leaves nothing of
#                 the merged wing out (the Janitor's D413; hook c104)
#   LAW L-PAGESWITHDRAW a page withdrawal (delta/data/pages-withdraw.json) names
#                 only served pages whose documents row carries the row's msg_id,
#                 and leaves no shard record citing a withdrawn page (GAVELS
#                 2026-10-10, the IWA is living; hook c248)
#   LAW L-WITHHELD-COUNT a delivered page whose provenance block declares "N
#                 passages withheld, marked in place" carries exactly N
#                 "[withheld" markers (the content standard, D206; hook c180)
#   LAW L-ALLOW-GENERATED an allow row for a denied term reaches every file the
#                 build generates from the wave's records (characters/<id>.html,
#                 its a-z bucket, the character/match/rp indexes, the rps/<year>/
#                 and wing holdings listings, the pager and cross-reference
#                 neighbours' pages); refuses, never widens (gate 369, desk
#                 D485/D490; hook c214)
# ===========================================================================
import json as _lj, os as _lo, re as _lre, glob as _lg

def _prob(rid, msg):
    probs.append(f"LAW {rid}: {msg}")

_MUSEUM = M
_WAVE = W
_rel = lambda x: _lo.path.relpath(x, _WAVE)
# ---- L-DRAFT / L-DELTAPATH (coordinator, 2026-09-25): the placards' page was stamped APPLIED and never landed (a root
# page apply-delta did not copy), and carried the draft's own "PREVIEW ONLY — NOT FOR LANDING" comment besides.
if _lo.path.isdir(f"{_WAVE}/delta"):
    for _e in sorted(_lo.listdir(f"{_WAVE}/delta")):
        if _e not in ("data", "promotions", "epitaphs", "memorials", "galleries"):
            _prob("L-DELTAPATH", f"delta/{_e}: apply-delta lands only data/ promotions/ epitaphs/ memorials/ galleries/img/characters/ and refuses a delta carrying anything else")
    # galleries/ (hook c98, 2026-10-06; the Janitor's D409/D411): apply-delta lands memorial gallery images from
    # delta/galleries/img/characters/ only, and refuses the WHOLE wave on any other path under galleries/. The rules are
    # apply-delta.py's _gallery_plan, kept in step: a file only directly in galleries/img/characters/, named
    # [a-z0-9][a-z0-9._-]*, ending .jpg .jpeg .png .gif, with that format's leading bytes; no other file or directory, no
    # symlink; an image the museum already serves must be byte-identical (an image is never silently replaced).
    _gl_top = f"{_WAVE}/delta/galleries"
    if _lo.path.lexists(_gl_top):
        try:
            import filecmp as _gl_fc
            _GL_SUB = "galleries/img/characters"
            _GL_MAGIC = {".jpg": (b"\xff\xd8\xff",), ".jpeg": (b"\xff\xd8\xff",), ".png": (b"\x89PNG\r\n\x1a\n",), ".gif": (b"GIF87a", b"GIF89a")}
            _gl_ok_dirs = ("galleries/img", _GL_SUB)
            _gl_new = _gl_same = 0; _gl_bad = []
            if _lo.path.islink(_gl_top) or not _lo.path.isdir(_gl_top): _gl_bad.append("galleries: not a directory")
            else:
                for _gl_root, _gl_dirs, _gl_files in _lo.walk(_gl_top):
                    _gl_rel = _lo.path.relpath(_gl_root, f"{_WAVE}/delta")
                    for _x in sorted(_gl_dirs):
                        _r = f"{_gl_rel}/{_x}"
                        if _lo.path.islink(_lo.path.join(_gl_root, _x)): _gl_bad.append(f"{_r}: a symlink")
                        elif _r not in _gl_ok_dirs: _gl_bad.append(f"{_r}/: only {_GL_SUB}/ lands under galleries/")
                    _gl_dirs[:] = sorted(_x for _x in _gl_dirs if not _lo.path.islink(_lo.path.join(_gl_root, _x)) and f"{_gl_rel}/{_x}" in _gl_ok_dirs)
                    for _fn in sorted(_gl_files):
                        _src = _lo.path.join(_gl_root, _fn); _r = f"{_gl_rel}/{_fn}"; _ext = _lo.path.splitext(_fn)[1]
                        if _lo.path.islink(_src) or not _lo.path.isfile(_src): _gl_bad.append(f"{_r}: not a regular file"); continue
                        if _gl_rel != _GL_SUB: _gl_bad.append(f"{_r}: only image files directly in {_GL_SUB}/ land"); continue
                        if _ext not in _GL_MAGIC: _gl_bad.append(f"{_r}: not a .jpg .jpeg .png .gif image"); continue
                        if not _lre.fullmatch(r"[a-z0-9][a-z0-9._-]*", _fn): _gl_bad.append(f"{_r}: a served image name is lowercase a-z 0-9 . _ - only"); continue
                        with open(_src, "rb") as _fh: _head = _fh.read(8)
                        if not _head.startswith(_GL_MAGIC[_ext]): _gl_bad.append(f"{_r}: its bytes are not a {_ext[1:]} image"); continue
                        _dst = _lo.path.join(_MUSEUM, _GL_SUB, _fn)
                        if not _lo.path.lexists(_dst): _gl_new += 1
                        elif _lo.path.islink(_dst) or not _lo.path.isfile(_dst): _gl_bad.append(f"{_r}: the museum's {_GL_SUB}/{_fn} is not a regular file")
                        elif _gl_fc.cmp(_src, _dst, shallow=False): _gl_same += 1
                        else: _gl_bad.append(f"{_r}: differs from the image already served at /{_GL_SUB}/{_fn} (an image is never silently replaced)")
            for _b in _gl_bad: _prob("L-DELTAPATH", f"delta/{_b}; apply-delta refuses the wave")
            print(f"   L-DELTAPATH galleries: {_gl_new} new image(s), {_gl_same} identical to the served copy, {len(_gl_bad)} refused path(s)")
        except Exception as _e: _prob("L-DELTAPATH", f"delta/galleries could not be judged ({_e}); apply-delta would refuse what it cannot judge")
    for _f in _lg.glob(f"{_WAVE}/delta/**/*", recursive=True):
        if not _lo.path.isfile(_f) or not _f.endswith((".html", ".json", ".md", ".txt")): continue
        try: _dt = open(_f, encoding="utf-8", errors="replace").read()
        except Exception: continue
        if _lre.search(r"PREVIEW ONLY|NOT FOR LANDING", _dt):
            _prob("L-DRAFT", f"{_rel(_f)}: carries a draft marker (\"PREVIEW ONLY\" / \"NOT FOR LANDING\"); a draft is never landed")

# ---- the wave's own mint rows: BOTH shapes are accepted --------------------
_mint_files = sorted(set(_lg.glob(f"{_WAVE}/delta/data/promotions-rows.json") +
                         _lg.glob(f"{_WAVE}/delta/data/promotions-append*.json")))
_mints = []
for _f in _mint_files:
    if _lo.path.basename(_f).startswith("promotions-append"):
        print(f"   note: {_lo.path.basename(_f)} is the APPLIER's shape (append) — promotions-rows.json is the lane template's; both are read here")
    try:
        _rows = _lj.load(open(_f, encoding="utf-8"))
    except Exception as e:
        _prob("L-SHAPE", f"{_lo.path.basename(_f)} is not valid JSON ({e})")
        continue
    for _r in (_rows if isinstance(_rows, list) else list(_rows.values())):
        if isinstance(_r, dict):
            _mints.append((_lo.path.basename(_f), _r))

# ---- controlled vocabularies (docs/SCHEMA.md; mirrored from
#      museum/scripts/registry-validate.mjs — keep the two in step) ----------
_MEDIUM = {"newsgroup", "website", "forum", "bbs", "fidonet", "email", "mail", "online-service",
           "chat", "wiki", "virtual-world", "video", "audio", "social-media", "game", "in-person",
           "other", "unknown"}
_FORM = {"text", "figures", "avatars", "tabletop", "sim", "other", "unknown"}
_PLAY = {"competitive-rp", "strat", "angled", "generated", "hybrid", "unknown"}
_AUTHORSHIP = {"open-fed", "single-author", "troupe", "vote-league", "unknown"}
_TYPE = {"federation", "community-hub", "interfed-alliance", "tournament", "academy"}  # + tournament: CURATION v118 #tournament-type (2026-09-24); + academy: CURATION v120 #academy-type (2026-09-24)
_GRADES = {"primary-source", "user-attested", "presumed"}
_DEPTH = {"deeply documented", "documented", "partially recovered", "a single surviving document",
          "in preparation", "documented on its own terms"}
_DOC_CLASSES = {"card", "rp", "roster", "rules", "news", "staff", "credits", "guestbook",
                "board", "column", "other", "machine-translation", "poll"}  # v116 (2026-09-19): ONE vocabulary — `rp` everywhere, `poll` added
_STRUCTURED_CLASSES = {"card", "rp", "roster"}
_SOURCE_KINDS = {"newsgroup", "wayback", "arquivo", "geocities-torrent", "direct", "commoncrawl", "unknown", "forum"}  # forum: GAVELS 2026-09-23 (a post on the museum's own forum)
_PN_KINDS = {"founding", "closure", "rename", "membership-alliance", "title-lineage", "roster-character",
             "document-served", "document-collected", "identity-guard", "correction",
             "tier-depth-change", "liveness-host", "cross-reference", "other"}
# The skeleton PROCESS's "Frontier -> Tier 0" step 3 names, taken from the
# healthy peer it names (promotions/npw/index.html) minus the two chrome
# blocks the stamper adds after landing, and minus the epitaph block, which
# v110's own WING-PAGE CLEANUP says exists only where there is prose.
_SKELETON = ["wingheader", "wingcaption", "wingtier", "wingyears", "wingmedium",
             "wingplay", "wingscale", "winglocation", "winghousestyle", "wingdiscipline",
             "wingfandom", "browse", "connections", "affiliations", "provenance"]

# ---- SERVED-TEXT: the banned workshop-narration phrases --------------------
# The Janitor's own list (2026-09-05, restated 2026-09-08 DOORS CARRY NO
# NARRATION and 2026-09-08 PROMOTIONS ON THEIR OWN MERITS), plus the phrases
# this week's send-backs actually turned up. Applied to EVERY string in EVERY
# delta JSON and to every served page's caption/kicker.
_BANNED = _lre.compile(
    r"\bfindings\.md\b|\bdigests?/[\w-]+\.md\b|\bscratch-\d{4}\b|\bledger-pending\b|\bwave-[A-Z][A-Z0-9-]+\b|"  # workshop file pointers (proposed gavel 7, agreed 2026-09-19; GPW send-back)
    r"\bthis collection\b|\bthis corpus\b|\bthe corpus\b|\bthis held document\b|\bthis pull\b|"
    r"\bthis pass\b|\bthis reading\b|\bthis wave\b|\bthis walk\b|\bthis lane\b|\bthe museum\b|"
    r"\bdistinct from\b|\bnow-served\b|\bfrontier row\b|"  # 2026-09-20: registry-validate's served-text list — a caption carrying them raised the ratchet (napw-2000)
    r"\bthe collection'?s own\b|"
    # LANDCHECK-BANNED-NARROW (2026-10-05, D308, hook c62): lowercase lane(s)/wave(s) and coordinator are narrowed by FIXED-WIDTH
    # lookbehind/lookahead (the same patterns as c61's RENDER_BASE in text-markers.mjs) so in-fiction prose is not reddened
    # ("a wave of roster injuries", "the referee waves off", "memory lane", "talent coordinator"); every workshop sense
    # ("this wave", "the E1 and E2 waves", "lane XIV", "the coordinator", "(coordinator, date)") is still caught.
    r"(?<![A-Za-z-])(?<!\bmemory )(?<!\bfast )(?<!\bpassing )(?<!\bbowling )(?<!\bbike )(?<!\bslow )(?-i:lanes?)(?![A-Za-z])|"
    r"(?<![A-Za-z-])(?<!recruitment )(?-i:waves?)(?![A-Za-z])(?!\s+(?:off|it|them|him|her|goodbye|away|aside)\b)(?!\.[a-z])(?!(?<=\ba wave)\s+of\b(?!\s+unrelated\b))(?!(?<=\bfirst wave)\s+of\b)|"
    r"\b(?:the|this|a) walk\b|\bwalk census\b|"
    r"(?<!\btalent )(?<!\bprotest )(?<!\bevent )(?<!\bshow )(?<!\bbooking )(?<!\bproduction )(?<!\bExtreme )(?<!\bSports )\bcoordinator\b|"
    r"\bthe \x66ounder'?s\b|\bwhite whale\b|\blong-sought\b|"
    r"\bledger row\b|\bledger fragment\b|\baccession digest\b|\bfrontier row\b|\bdo-not-merge\b|"
    r"\bprovenance_notes\b|\bmsg_id\b|\bland-check\b|\bgate \d|\bpreflight\b|"
    r"\b2026-0\d-\d\d\b|\bv1[01]\d\([a-z]\)|(?<![A-Za-z0-9])v(?:7[4-9]|8\d|9\d|1\d{2})(?![A-Za-z0-9])",
    _lre.I)
# Fields that are STRUCTURALLY a date, an id or an address are not prose and
# are never read for narration: a caption_asof.written of "2026-09-19" is the
# curation timestamp the schema asks for, not a workshop citation smuggled
# into a sentence.
_CARD_VERBATIM_TENURE = {"finisher", "signature_moves", "entrance_music", "hometown", "style", "bio", "nicknames",
                         "manager", "height", "weight", "birth_date"}
_TEXT_FIELDS_SKIP = {"msg_id", "url", "source_url", "identifier", "citation_url", "served_since",
                     "recorded", "page", "id", "slug", "file", "path", "written", "date", "from",
                     "to", "last_checked", "first_seen", "last_seen", "class_year", "newsgroup",
                     "thread_id", "timestamp", "observed_by", "fandom", "collection", "wing",
                     "served_url", "image", "precision", "kind", "grade", "doc_class", "type",
                     "status", "medium", "form", "play", "authorship", "language", "country",
                     "commemorated_by", "note_author", "author", "years", "unit_kind", "handling",
                     "result", "role", "roles", "scale", "depth_grade", "precision",
                     # a correction row's own machinery keys name the registry
                     # field being corrected and the wave doing it — they are
                     # the applier's instructions, never served text
                     "field", "op", "target", "match", "reason", "digest"}

def _walk_strings(obj, path=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from _walk_strings(v, f"{path}.{k}" if path else str(k))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _walk_strings(v, f"{path}[{i}]")
    elif isinstance(obj, str):
        yield path, obj

# NOTES UNSERVED (D114) checks — the Janitor, desk D114 (2026-09-28; GAVELS 2026-09-28, D113-D115 row): a character's or
# unit's own top-level `notes` is a workshop note, no longer rendered (cross-reference.mjs UNSERVED_NOTES_TYPES), so the
# served-text checks (L-TEXT, L-SERVEDTEXT) skip it. Tenure notes and every other record's notes are still served and
# still judged; the privacy checks read every field regardless.
_UNSERVED_NOTES_FILE = _lre.compile(r"^(characters|units)(-(corrections|append)-[^/]*)?\.json$")
def _is_unserved_notes(_base, _d, _path):
    if not _UNSERVED_NOTES_FILE.match(_base): return False
    if _lre.fullmatch(r"\[\d+\]\.notes", _path): return True               # an appended/whole row's own notes
    _mm = _lre.fullmatch(r"(corrections)?\[(\d+)\]\.(new|old)", _path)   # a correction row whose field is `notes`
    if not _mm: return False
    _cs = _d.get("corrections", []) if isinstance(_d, dict) else _d
    try: return isinstance(_cs[int(_mm.group(2))], dict) and _cs[int(_mm.group(2))].get("field") == "notes"
    except (IndexError, TypeError): return False

# L-TEXT ID CARVE-OUT (hook c165, 2026-10-09): a served field whose WHOLE value is a registered wing id is an address,
# not prose. One real wing's id is `wave` (WAVE Puroresu, usenet 2003), so a liveness-host record naming it could never
# land -- wave-USENET-LEFTOVERS-1008 held its row 12 for exactly that. A record's own `subject` is exempt when it is that
# row's wing, which covers a wing the same wave mints and promotions.json does not carry yet.
_C165_SEG = _lre.compile(r"([^.\[\]]+)|\[(\d+)\]")
def _c165_own_wing(_root, _path):
    """The `wing` of the nearest enclosing object ([12].wing is the id, [12].record.subject the field)."""
    _cur, _w = _root, None
    for _nm, _ix in _C165_SEG.findall(_path):
        if isinstance(_cur, dict) and isinstance(_cur.get("wing"), str): _w = _cur["wing"]
        try: _cur = _cur[_nm] if _nm else _cur[int(_ix)]
        except Exception: return _w
    return _w

for _f in sorted(_lg.glob(f"{_WAVE}/delta/data/**/*.json", recursive=True)):
    try:
        _d = _lj.load(open(_f, encoding="utf-8"))
    except Exception:
        continue
    _base = _lo.path.basename(_f)
    _carried = set()
    if _base == "registry-corrections.json" or ("-corrections" in _base and _base.endswith(".json")):  # 2026-09-20 (2026-09-21: every *-corrections file, IGA): text carried forward verbatim from the live `old` value is not this wave's
        for _c in (_d if isinstance(_d, list) else _d.get("corrections", [])):
            if isinstance(_c, dict):
                for _p0, _v0 in _walk_strings(_c.get("old")): _carried.add(_v0)
    for _path, _val in _walk_strings(_d):
        _leaf = _path.rsplit(".", 1)[-1].split("[")[0]
        if _carried and (".old" in _path or _path.endswith("old") or _val in _carried): continue
        if _is_unserved_notes(_base, _d, _path): continue   # NOTES UNSERVED (D114) checks
        if _leaf in _TEXT_FIELDS_SKIP:
            continue
        if "tenures[" in _path and _leaf in _CARD_VERBATIM_TENURE:  # 2026-09-27: a tenure's card facts are the fed's own words
            continue
        if _base.startswith("rps-append") and _leaf == "title":  # 2026-09-22: a roleplay's title is the period text, verbatim, not narration
            continue
        if any(seg.split("[")[0].endswith("_asof") for seg in _path.split(".")):
            continue
        if _lre.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)+", _val):  # 2026-09-24 (SITES-B1): a bare id (lane-scotts-bdw) is never narration
            continue
        if _val in live:  # hook c165: the whole value IS a registered wing id (the wing whose id is `wave`) — an address, never narration
            continue
        if _leaf == "subject" and _val == _c165_own_wing(_d, _path):  # hook c165: a record's subject is its own wing
            continue
        _m0 = _BANNED.search(_val)
        if _m0 and "sources" in _path and _lre.match(r"^2026-0", _m0.group(0)):
            # a capture/collection date inside a sources[] entry is a citation,
            # which is exactly what that field is for (the SOURCE_MARKER_RE
            # carve-out museum/scripts/text-markers.mjs already makes)
            _val = _lre.sub(r"\b2026-0[0-9]-[0-9]{2}\b", "", _val)
        # a provenance note's own `summary` is served; its narrative is not in
        # the registry at all any more, so nothing here is workshop-private.
        _m = _BANNED.search(_val)
        if _m and _carried:
            # 2026-09-24 (wave-COORD-ALMASY-NOTES-REPAIR): a correction that REPAIRS a live string keeps its existing phrases — judge
            # only phrases the new value carries MORE often than the live `old` did (carried debt is not this wave's)
            _hits = {}
            for _mm in _BANNED.finditer(_val): _hits[_mm.group(0)] = _hits.get(_mm.group(0), 0) + 1
            _new_only = [p for p, n in _hits.items() if n > max((c.count(p) for c in _carried), default=0)]
            _m = next((mm for mm in _BANNED.finditer(_val) if mm.group(0) in _new_only), None)
        if _m:
            _prob("L-TEXT", f"{_base} {_path}: served field carries workshop narration ({_m.group(0)!r}) — the fact goes in the field, the reasoning stays in the workshop")

# ---- per-mint checks -------------------------------------------------------
# the acronym of a row = its leading all-caps token, plus every aka's own
_ACR = _lre.compile(r"^([A-Z][A-Za-z0-9&.]*)")
def _acronyms(row):
    out = set()
    for cand in [row.get("name") or ""] + [str(a) for a in (row.get("aka") or [])] + [row.get("full_name") or ""]:
        m = _ACR.match(cand.strip())
        if m and 2 <= len(m.group(1)) <= 8 and m.group(1).upper() == m.group(1):
            out.add(m.group(1).upper())
    return out

_live_acr = {}
for _r in Prows:
    for _a in _acronyms(_r):
        _live_acr.setdefault(_a, []).append(_r["id"])

for _src, _r in _mints:
    _id = _r.get("id") or "?"
    # L-PAGE
    if _r.get("page") != f"/promotions/{_id}/":
        _prob("L-PAGE", f"{_id}: page is {_r.get('page')!r}, must be '/promotions/{_id}/'")
    # L-SHARD
    _sd = f"{_WAVE}/delta/data/shards/{_id}"
    _have = sorted(_lo.path.basename(x) for x in _lg.glob(_sd + "/*.json"))
    if len(_have) != 7:
        _prob("L-SHARD", f"{_id}: {len(_have)}/7 shard files ({', '.join(_have) or 'none'}) — a wing ships all seven, empty arrays included")
    # L-TIER
    _t = _r.get("tier")
    if not isinstance(_t, int) or _t not in (0, 1, 2, 3):
        _prob("L-TIER", f"{_id}: tier is {_t!r} — every wing carries an integer 0-3")
        _t = -1
    if not (isinstance(_r.get("tier_source"), str) and _r["tier_source"].strip()):
        _prob("L-TIER", f"{_id}: no tier_source — the tier assignment carries its own receipt")
    # L-PROV
    _pn = _r.get("provenance_notes")
    if not isinstance(_pn, list) or not _pn:
        _prob("L-PROV", f"{_id}: provenance_notes[] is empty — a mint with no recorded founding (docs/SCHEMA.md; every mint this week was sent back for exactly this)")
    else:
        _kinds = {n.get("kind") for n in _pn if isinstance(n, dict)}
        if "founding" not in _kinds:
            _prob("L-PROV", f"{_id}: provenance_notes[] carries no `founding` record (kinds present: {sorted(k for k in _kinds if k)})")
        for _i, _n in enumerate(_pn):
            if not isinstance(_n, dict):
                _prob("L-PROV", f"{_id}: provenance_notes[{_i}] is not an object"); continue
            if "claim" in _n or "evidence" in _n:
                _prob("L-PROV", f"{_id}: provenance_notes[{_i}] is the legacy {{claim, evidence}} shape — convert to a typed record")
                continue
            if _n.get("kind") not in _PN_KINDS:
                _prob("L-PROV", f"{_id}: provenance_notes[{_i}] kind {_n.get('kind')!r} is outside the fourteen-value enum")
            if _n.get("grade") not in _GRADES:
                _prob("L-PROV", f"{_id}: provenance_notes[{_i}] grade {_n.get('grade')!r} is not primary-source|user-attested|presumed")
            _dt = _n.get("date")
            if _dt is not None:
                if not isinstance(_dt, dict) or _dt.get("precision") not in ("exact", "month", "year", "unknown"):
                    _prob("L-PROV", f"{_id}: provenance_notes[{_i}].date is {_dt!r} — a date object {{date, precision exact|month|year|unknown}} (validate-provenance-notes)")
                elif _dt.get("precision") == "unknown" and _dt.get("date") is not None:
                    _prob("L-PROV", f"{_id}: provenance_notes[{_i}].date has precision unknown but date {_dt.get('date')!r} — null, never the word (GCW, cycle 160)")
                elif _dt.get("precision") != "unknown" and not (isinstance(_dt.get("date"), str) and _re.fullmatch({"exact": r"\d{4}-\d\d-\d\d", "month": r"\d{4}-\d\d", "year": r"\d{4}"}[_dt["precision"]], _dt["date"])):
                    _prob("L-PROV", f"{_id}: provenance_notes[{_i}].date {_dt.get('date')!r} does not match precision {_dt.get('precision')!r}")
            _sp = _n.get("span")
            if isinstance(_sp, dict):
                for _k in ("from", "to"):
                    _e = _sp.get(_k)
                    if isinstance(_e, dict) and _e.get("precision") in ("exact", "month", "year") and not (isinstance(_e.get("date"), str) and _re.fullmatch({"exact": r"\d{4}-\d\d-\d\d", "month": r"\d{4}-\d\d", "year": r"\d{4}"}[_e["precision"]], _e["date"])):
                        _prob("L-PROV", f"{_id}: provenance_notes[{_i}].span.{_k} date {_e.get('date')!r} does not match precision {_e.get('precision')!r} (NEWF, cycle 164)")
            _srcs = _n.get("sources")
            if not isinstance(_srcs, list) or (not _srcs and _n.get("grade") != "presumed"):
                _prob("L-PROV", f"{_id}: provenance_notes[{_i}] has no sources[] and is not graded `presumed`")
            for _s in (_srcs or []):
                if not isinstance(_s, dict) or _s.get("kind") not in _SOURCE_KINDS:
                    _prob("L-PROV", f"{_id}: provenance_notes[{_i}] source kind {(_s or {}).get('kind')!r} is outside the enum ({'|'.join(sorted(_SOURCE_KINDS))})")
    # L-IDENT
    _mine = _acronyms(_r)
    _collide = sorted({w for a in _mine for w in _live_acr.get(a, []) if w != _id})
    if _collide:
        _named = {g for gd in (_r.get("identity") or []) if isinstance(gd, dict) for g in (gd.get("with") or [])}
        if not _named:
            _prob("L-IDENT", f"{_id}: shares an acronym ({', '.join(sorted(_mine))}) with {len(_collide)} held wing(s) — {', '.join(_collide[:6])} — and carries NO identity[] assertion (ACRONYM IS NOT A JOIN, the Janitor 2026-09-04: the collision is recorded, ruled, and named)")
        else:
            _unnamed = [w for w in _collide if w not in _named]
            if _unnamed:
                _prob("L-IDENT", f"{_id}: identity[] names {sorted(_named)} but leaves {len(_unnamed)} same-acronym wing(s) unaddressed — {', '.join(_unnamed[:6])}")
    # L-ROSTER
    if _r.get("roster_policy") is not None:
        if _r["roster_policy"] not in ("real", "fantasy", "blended"):
            _prob("L-ROSTER", f"{_id}: roster_policy {_r['roster_policy']!r} is not real|fantasy|blended")
        if _r.get("roster_policy_grade") not in _GRADES:
            _prob("L-ROSTER", f"{_id}: roster_policy is set but roster_policy_grade is {_r.get('roster_policy_grade')!r}")
    # L-DATES
    for _k in ("founded", "closed"):
        _d2 = _r.get(_k)
        if not isinstance(_d2, dict):
            _prob("L-DATES", f"{_id}: {_k} is {_d2!r} — every row carries {{date, precision, source}}"); continue
        _prec = _d2.get("precision")
        if _prec not in ("exact", "month", "year", "circa", "unknown"):
            _prob("L-DATES", f"{_id}: {_k}.precision {_prec!r} is not exact|month|year|circa|unknown")
        else:
            _shape = {"exact": r"^\d{4}-\d{2}-\d{2}$", "month": r"^\d{4}-\d{2}$", "year": r"^\d{4}$",
                      "circa": r"^\d{4}(-\d{2}(-\d{2})?)?$", "unknown": r"^(unknown)?$"}[_prec]
            _v = _d2.get("date")
            if _prec == "unknown":
                if _v not in (None, "", "unknown"):
                    _prob("L-DATES", f"{_id}: {_k}.precision is 'unknown' but date is {_v!r}")
            elif not (isinstance(_v, str) and _lre.match(_shape, _v)):
                _prob("L-DATES", f"{_id}: {_k}.date {_v!r} does not match precision {_prec!r}")
        if not (isinstance(_d2.get("source"), str) and _d2["source"].strip()):
            _prob("L-DATES", f"{_id}: {_k} carries no source — every date names its own receipt")
    # L-ENUM
    for _field, _set in (("medium", _MEDIUM), ("form", _FORM), ("play", _PLAY),
                         ("authorship", _AUTHORSHIP), ("type", _TYPE)):
        _v = _r.get(_field)
        if _v and _v not in _set:
            _prob("L-ENUM", f"{_id}: {_field} {_v!r} is outside the documented set ({'|'.join(sorted(_set))}) — the Janitor's 2026-09-10 gavel; a genuinely new value is a documented addition to docs/SCHEMA.md, never invented in a wave")
    if _r.get("play") and _r["play"] != "unknown" and _r.get("play_grade") not in _GRADES:
        _prob("L-ENUM", f"{_id}: play is set but play_grade is {_r.get('play_grade')!r}")
    # L-DEPTH
    _dp = (_r.get("depth") or "").strip()
    if _dp and _dp not in _DEPTH and not any(_dp.startswith(x) for x in _DEPTH):
        _prob("L-DEPTH", f"{_id}: depth {_dp[:60]!r} is not one of the defined phrases ({'; '.join(sorted(_DEPTH))}) — CURATION #depth-defined exists so a stranger's collection reads on the same scale")
    # L-AKA
    for _a in (_r.get("aka") or []):
        if not isinstance(_a, str):
            _prob("L-AKA", f"{_id}: aka entry {_a!r} is not a string"); continue
        _par = [m for m in _lre.finditer(r"\(([^)]*)\)", _a) if len(m.group(1).split()) >= 4]
        _why = (f"runs {len(_a)} characters" if len(_a) > 60 else
                f"carries a {len(_par[0].group(1).split())}-word parenthetical explanation" if _par else
                "carries sentence punctuation" if _lre.search(r"\s--\s|;|\.\s", _a) else None)
        if _why:
            _prob("L-AKA", f"{_id}: aka {_a[:70]!r} {_why} — an aka is a LABEL the fed itself used, not a note about it")
    # the landing page: skeleton, epitaph, storylines, house style
    _idx = f"{_WAVE}/delta/promotions/{_id}/index.html"
    _html = open(_idx, encoding="utf-8", errors="replace").read() if _lo.path.exists(_idx) else ""
    if not _html:
        _prob("L-SKEL", f"{_id}: no landing page in the delta (delta/promotions/{_id}/index.html) — a beacon is a complete museum object (PROCESS 'Frontier -> Tier 0' step 3)")
    else:
        _missing = [b for b in _SKELETON if f"<!-- {b}:start -->" not in _html]
        if _missing:
            _prob("L-SKEL", f"{_id}: landing page is missing marker block(s) {', '.join(_missing)} — copy the full skeleton from a healthy peer (promotions/npw/index.html)")
    if _t >= 1:
        _ep = _lre.search(r"<!--\s*epitaph:start\s*-->([\s\S]*?)<!--\s*epitaph:end\s*-->", _html)
        if not (_ep and _lre.sub(r"<[^>]*>", "", _ep.group(1)).strip()):
            _prob("L-EPITAPH", f"{_id}: tier {_t} and its landing page carries no written Epitaph section (CURATION #promotion-epitaphs; no epitaph is owed BELOW tier 1, one is owed at and above it)")
    if _t >= 2:
        _hs_exempt = _r.get("type") == "community-hub" or _r.get("medium") in ("usenet", "community-hub", "house-network")
        if not _hs_exempt:
            if not (isinstance(_r.get("house_style"), str) and _r["house_style"].strip()):
                _prob("L-HOUSE", f"{_id}: tier {_t} owes a house_style written from the shows actually read (PROCESS 'Tier 1 -> Tier 2' step 4)")
            else:
                if _r.get("house_style_grade") not in _GRADES:
                    _prob("L-HOUSE", f"{_id}: house_style carries grade {_r.get('house_style_grade')!r} — it is evidence-graded like every other claim")
                if not (isinstance(_r.get("house_style_source"), str) and _r["house_style_source"].strip()):
                    _prob("L-HOUSE", f"{_id}: house_style carries no house_style_source")
    if _t >= 3:
        if "<!-- storylines:start -->" not in _html and not _lre.search(r"<h2[^>]*>\s*Storylines", _html, _lre.I):
            _prob("L-STORY", f"{_id}: tier 3 and no Storylines section — storylines are the OUTPUT of the full crawl that earns the tier (CURATION #tier-and-storylines)")

# ---- documents-append rows -------------------------------------------------
_wave_wings = {r.get("id") for _s, r in _mints if r.get("id")}
_held_wings = set(live)
_served_nonstructured = []
_GG = _lre.compile(r"^https://groups\.google\.com/g/[^/]+/c/[^/]+/m/[^/]+$")
_WSPATH = _lre.compile(r"^(?:file:|/home/|/mnt/|\.{1,2}/)|(?:^|[/\"'\s])archive/(?:digests|usenet-retro|direct-collected|privacy|desk|collect-never-serve|geo-mirrors)/", _lre.I)
try:
    _mdj = _lj.load(open(f"{_MUSEUM}/data/documents.json", encoding="utf-8")); _mdj = _mdj.get("documents", _mdj) if isinstance(_mdj, dict) else _mdj
    _museum_doc_rows = {x.get("page"): x for x in _mdj if isinstance(x, dict)}
except Exception: _museum_doc_rows = {}
# 2026-09-21 (AWP, MRW): a corrected copy of an ALREADY-SERVED page carries the museum's own row unchanged; the forward
# source-link rules do not re-judge a grandfathered row — only rows the wave itself authors face them.
for _f in sorted(_lg.glob(f"{_WAVE}/delta/data/documents-append*.json")):
    try:
        _rows = _lj.load(open(_f, encoding="utf-8"))
    except Exception as e:
        _prob("L-DOC", f"{_lo.path.basename(_f)} is not valid JSON ({e})"); continue
    for _r in (_rows if isinstance(_rows, list) else []):
        if not isinstance(_r, dict):
            _prob("L-DOC", f"{_lo.path.basename(_f)}: a row is not an object"); continue
        _pg = _r.get("page") or ""
        _dp = f"{_WAVE}/delta{_pg}"
        _grandfathered = (_pg in _museum_doc_rows and _museum_doc_rows[_pg] == _r)
        if not _pg.startswith("/promotions/"):
            _prob("L-DOC", f"{_lo.path.basename(_f)}: page {_pg!r} is not a site-absolute /promotions/… path")
        elif not _lo.path.exists(_dp) and not _lo.path.exists(f"{_MUSEUM}{_pg}"):
            _prob("L-DOC", f"{_pg}: documents row names a page this wave does not deliver and the museum does not hold")
        _wing = _r.get("wing")
        if _wing not in _wave_wings and _wing not in _held_wings:
            _prob("L-DOC", f"{_pg}: wing {_wing!r} is neither held nor minted in this wave")
        if _r.get("parts") is not None and not isinstance(_r.get("parts"), dict): _prob("L-DOC", f"{_pg}: parts must be null or an object {{n, of}} (a bare integer crashed the provenance-block fixer at cycle 159)")
        _cls = _r.get("doc_class")
        if _cls not in _DOC_CLASSES:
            _prob("L-DOC", f"{_pg}: doc_class {_cls!r} is not one of the v109(a) classes ({'|'.join(sorted(_DOC_CLASSES))})")
        _srcs = _r.get("sources")
        if not isinstance(_srcs, list) or not _srcs:
            _prob("L-DOC", f"{_pg}: sources[] is empty — every served document names where it came from")
        for _s in (_srcs or []):
            if not isinstance(_s, dict) or _s.get("kind") not in _SOURCE_KINDS:
                _prob("L-DOC", f"{_pg}: source kind {(_s or {}).get('kind')!r} is outside the enum ({'|'.join(sorted(_SOURCE_KINDS))}) — an invented kind ('attachment') took 473 rows to the gate on 2026-09-15")
                continue
            _u = _s.get("url") or ""
            if _u and _WSPATH.search(_u):
                _prob("L-WSPATH", f"{_pg}: source url {_u[:80]!r} is a workshop file path, not a public source")
            if not _grandfathered and _s["kind"] == "newsgroup" and "/attach/" not in str(_s.get("url") or ""):  # 2026-09-21: post attachments (469 museum rows) carry the attachment URL, not a message URL
                if not _s.get("msg_id"):
                    _prob("L-SRC", f"{_pg}: a newsgroup source carries no msg_id")
                if not _GG.match(_u or ""):
                    _prob("L-SRC", f"{_pg}: a newsgroup source carries no Google Groups message URL (groups.google.com/g/<group>/c/<thread>/m/<msg_id>) — the Janitor's 2026-09-07 SOURCE LINKS gavel is a FORWARD rule")
        _dd = _r.get("document_date")
        if not isinstance(_dd, dict):
            _prob("L-DOC", f"{_pg}: document_date is {_dd!r} — every row carries {{date, precision}}")
        else:
            _prec = _dd.get("precision")
            if _prec not in ("exact", "month", "year", "circa", "unknown"):
                _prob("L-DOC", f"{_pg}: document_date.precision {_prec!r} is not recognised")
            elif _prec == "unknown":
                if _dd.get("date") is not None:
                    _prob("L-DOC", f"{_pg}: document_date precision 'unknown' but date is {_dd.get('date')!r}")
            else:
                _shape = {"exact": r"^\d{4}-\d{2}-\d{2}$", "month": r"^\d{4}-\d{2}$", "year": r"^\d{4}$",
                          "circa": r"^\d{4}(-\d{2}(-\d{2})?)?$"}[_prec]
                if not (isinstance(_dd.get("date"), str) and _lre.match(_shape, _dd["date"])):
                    _prob("L-DOC", f"{_pg}: document_date {_dd.get('date')!r} does not match precision {_prec!r}")
        if _cls not in _STRUCTURED_CLASSES and _cls != "machine-translation":
            _served_nonstructured.append((_pg, _cls))

# L110 — one value line per served document outside card/rp/roster. The line
# lives in the wave's own paperwork (findings.md / digest / holdings TSV); the
# check is that the page is NAMED there, which is the cheapest mechanical form
# of "somebody could write a sentence about why this serves".
if _served_nonstructured:
    _paper = ""
    for _cand in ("findings.md", "FINDINGS.md", "digest.md", "SUMMARY.md", "README.md"):
        _p2 = f"{_WAVE}/{_cand}"
        if _lo.path.exists(_p2):
            _paper += open(_p2, encoding="utf-8", errors="replace").read()
    for _h in _lg.glob(f"{_WAVE}/holdings/*.tsv"):
        _paper += open(_h, encoding="utf-8", errors="replace").read()
    _unjustified = [(_pg, _c) for _pg, _c in _served_nonstructured
                    if _lo.path.basename(_pg).replace(".html", "") not in _paper]
    if _unjustified:
        _prob("L110", f"{len(_unjustified)} served document(s) outside card/rp/roster carry no value line in the wave's own paperwork (CURATION #serve-on-contextual-value: 'a document nobody can write that sentence about does not serve') — e.g. " +
              "; ".join(f"{p} [{c}]" for p, c in _unjustified[:5]))

# ---- rule 10: every bestowal recipient resolves to a minted record ----------
_known_ids = set()
for _kind in ("characters", "units"):
    try:
        _kj = _lj.load(open(f"{_MUSEUM}/data/{_kind}.json", encoding="utf-8"))
        # 2026-09-24: the monolith is {_schema_version, <kind>: [...]}, not a bare array
        # (the same unwrap this file already does for collections.json above) — a bare
        # list load here silently iterated the dict's own keys and populated nothing,
        # so every bestowal recipient in the live registry read as unresolved.
        _klist = _kj if isinstance(_kj, list) else next((v for v in _kj.values() if isinstance(v, list)), [])
        for _rec in _klist:
            if isinstance(_rec, dict) and _rec.get("id"):
                _known_ids.add(_rec["id"])
    except Exception:
        pass
for _f in (_lg.glob(f"{_WAVE}/delta/data/shards/*/characters.json") + _lg.glob(f"{_WAVE}/delta/data/shards/*/units.json") +
           _lg.glob(f"{_WAVE}/delta/data/characters-append*.json") + _lg.glob(f"{_WAVE}/delta/data/units-append*.json")):
    try:
        for _rec in _lj.load(open(_f, encoding="utf-8")):
            if isinstance(_rec, dict) and _rec.get("id"):
                _known_ids.add(_rec["id"])
    except Exception:
        pass
for _f in (_lg.glob(f"{_WAVE}/delta/data/shards/*/awards.json") + _lg.glob(f"{_WAVE}/delta/data/awards-append*.json")):
    try:
        _rows = _lj.load(open(_f, encoding="utf-8"))
    except Exception:
        continue
    for _a in (_rows if isinstance(_rows, list) else []):
        if not isinstance(_a, dict):
            continue
        for _b in (_a.get("bestowals") or []):
            for _rc in (_b.get("recipient") or []):
                if not isinstance(_rc, dict):
                    _prob("L10", f"award {_a.get('id')}: a recipient entry is not an object"); continue
                _rid = _rc.get("id")
                if not _rid:
                    _prob("L10", f"award {_a.get('id')} ({_b.get('year')}): recipient {_rc.get('name')!r} carries no id — every bestowal recipient gets a character/unit record, even when the bestowal is all that is known (the Janitor's gavel, 2026-09-13)")
                elif _rid not in _known_ids:
                    _prob("L10", f"award {_a.get('id')} ({_b.get('year')}): recipient id {_rid!r} resolves to no record in this wave's shards or the museum's registry")

# ---- shows / rps rows cite a page the wave delivers -------------------------
for _f in (_lg.glob(f"{_WAVE}/delta/data/shards/*/shows.json") + _lg.glob(f"{_WAVE}/delta/data/shows-append*.json") +
           _lg.glob(f"{_WAVE}/delta/data/shards/*/rps.json") + _lg.glob(f"{_WAVE}/delta/data/rps-append*.json")):
    try:
        _rows = _lj.load(open(_f, encoding="utf-8"))
    except Exception:
        continue
    for _r in (_rows if isinstance(_rows, list) else []):
        if not isinstance(_r, dict):
            continue
        _pg = _r.get("page") or _r.get("served_url")
        if not _pg or _r.get("collected") is False:
            continue
        if not _lo.path.exists(f"{_WAVE}/delta{_pg}") and not _lo.path.exists(f"{_MUSEUM}{_pg}"):
            _prob("L-REF", f"{_lo.path.basename(_f)}: row {_r.get('id')!r} cites {_pg} — no such page in this delta or the museum (the IIEW diamondback shape, gate 140 run 5)")

# ---- served pages: contact lines, handler credits, personal-host paths ------
_CONTACT_LABEL = r"(?:AOL\s*IM|AOL\s*Instant\s*Messenger|AOLIM|AIM|ICQ|MSN(?:\s*Messenger)?|Yahoo!?\s*(?:Messenger|IM|ID)|E-?mail(?:\s*Address)?|Screen\s*Name)"
_CONTACT_VALUE = r"(?:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,6}|\d{5,12}|[A-Za-z][A-Za-z0-9]*[0-9_.][A-Za-z0-9._-]{0,18})"
_CONTACT_RE = _lre.compile(rf"\b{_CONTACT_LABEL}\b\s*(?:#|number|no\.?)?\s*[:=]+\s*({_CONTACT_VALUE})(?![A-Za-z0-9._@-])", _lre.I)
_EMAIL_RE = _lre.compile(r"(?<![\w.-])[A-Za-z0-9._%+-]{2,}@[A-Za-z0-9.-]+\.(?:com|net|org|edu|gov|uk|ca|au|de|fr|jp)(?![\w-])")
_MSGID_LINE = _lre.compile(r"^\s*(?:Message-ID|References|In-Reply-To|Path|NNTP-Posting-Host|Xref)\s*:", _lre.I | _lre.M)
# ---- L-CONTACT-MSGID (hook c241-lcontact-msgid-carveout, lane LC-MSGID, 2026-10-10). L-CONTACT's e-mail scan below read a
# Usenet Message-ID as an address: _MSGID_LINE strips only a header's LABEL, so the id behind it still matched, and the
# provenance Source line ("<group>, message <id>", plain or linked to Google Groups with the id in the URL) was never
# covered; any corrections wave re-serving such a page failed (wave-CARE-LIVE-CORRECTIONS-3-1010; LEADS L1). Narrow
# carve-out: only the message-id TOKEN is blanked before the scan, never a whole line or a whole header value:
#   (1) a Message-ID / References / In-Reply-To header line: each value token inside <...> or &lt;...&gt; (and a
#       Message-ID's value when it is one bare token); From, Reply-To, Sender, Path and every other header are scanned
#       as before, and so is any text on an id header outside the brackets;
#   (2) a provenance Source line (from "<dt>Source</dt><dd>" to the end of that line): the token right after
#       "<newsgroup or Usenet>, message " (an optional &lt; first; in a list, each next token after "&gt;, &lt;"), and,
#       inside a groups.google.com href only, the token right after /c/, /m/ or /d/msgid/<group>/ (an optional &lt; first).
# A token ends at whitespace, a quote, <, >, /, a comma or &gt;. Anything else on the line (link text, a source note, a
# second address) is scanned as before. No id is printed; the page gets one info line with the count it blanked.
_LCM_HDR = _lre.compile(r"^(\s*(?:Message-ID|References|In-Reply-To)\s*:)([^\n]*)$", _lre.I | _lre.M)
_LCM_BRACKET = _lre.compile(r"&lt;((?:(?!&gt;)[^<>\n])+)&gt;|<([^<>\n]+)>")
_LCM_SRC = _lre.compile(r"<dt>Source</dt><dd>[^\n]*")
_LCM_MSG = _lre.compile(r"(?:(?<![\w.+-])[A-Za-z0-9+_-]+(?:\.[A-Za-z0-9+_-]+)+|\bUsenet), message (?:&lt;|<)?")
_LCM_GG = _lre.compile(r"href=\"https?://groups\.google\.com/[^\"\s]*\"")
_LCM_URLID = _lre.compile(r"/(?:c|m|d/msgid/[A-Za-z0-9.+_-]+)/(?:&lt;|<)?")
_LCM_TOK = _lre.compile(r"(?:(?!&gt;)[^\s\"'<>/,])+")
_LCM_NEXT = _lre.compile(r"(?:&gt;|>),\s*(?:&lt;|<)")
def _lcm_spans(_t):
    """(start, end) spans in _t of Usenet message ids, per (1) and (2) above."""
    _sp = []
    for _hm in _LCM_HDR.finditer(_t):
        _v0, _v = _hm.start(2), _hm.group(2)
        _got = False
        for _bm in _LCM_BRACKET.finditer(_v):
            _g = 1 if _bm.group(1) is not None else 2
            _sp.append((_v0 + _bm.start(_g), _v0 + _bm.end(_g))); _got = True
        _bare = _v.strip()
        if not _got and _hm.group(1).strip().lower().startswith("message-id") and _bare and not _lre.search(r"\s", _bare):
            _s = _v0 + _v.index(_bare); _sp.append((_s, _s + len(_bare)))
    for _sm in _LCM_SRC.finditer(_t):
        _s0, _ln = _sm.start(), _sm.group(0)
        for _im in _LCM_MSG.finditer(_ln):
            _p = _im.end()
            while True:
                _tm = _LCM_TOK.match(_ln, _p)
                if not _tm: break
                _sp.append((_s0 + _tm.start(), _s0 + _tm.end()))
                _nm = _LCM_NEXT.match(_ln, _tm.end())
                if not _nm: break
                _p = _nm.end()
        for _gm in _LCM_GG.finditer(_ln):
            for _um in _LCM_URLID.finditer(_ln, _gm.start(), _gm.end() - 1):
                _tm = _LCM_TOK.match(_ln, _um.end(), _gm.end() - 1)
                if _tm: _sp.append((_s0 + _tm.start(), _s0 + _tm.end()))
    return _sp
def _lcm_blank(_t):
    """_t with every message-id token that holds an e-mail-shaped match blanked to spaces (offsets kept), and the count."""
    _sp = [_x for _x in _lcm_spans(_t) if _EMAIL_RE.search(_t, _x[0], _x[1])]
    if not _sp: return _t, 0
    _c = list(_t)
    for _a, _b in _sp:
        for _i in range(_a, _b): _c[_i] = " "
    return "".join(_c), len(_sp)
# ---- end L-CONTACT-MSGID builder (hook c241-lcontact-msgid-carveout)
# 2026-09-24 (PRIVACY-PTCPEDIA-HANDLERS): the LABEL is case-insensitive (18 credits read "handler |"; the name stays case-sensitive) and "|" joins the separators — the PTCpedia infobox credit is "Handler | <name>", which L-CREDIT never saw
_CREDIT_RE = _lre.compile(r"\b(?i:Handler(?:\s*Name)?|Handled\s*by|Written\s*by|Player\s*Name|Roleplayer|RPer)\b\s*[:=\-|]+\s*(?:<[^>]+>\s*)*([A-Z][a-z]{1,15}(?:[ \t]+[A-Z]\.?)?[ \t]+[A-Z][a-z]{1,19})(?![A-Za-z])")  # hook c178: name parts on one line only
# THE v74 SLUG RULE (the Janitor rider, 2026-09-02): "a URL whose path carries a
# real-name-shaped login slug is recorded with the slug marked (host + shape
# kept); handle-shaped slugs stand." So: a personal-ACCOUNT host, and a slug
# shaped like a person's name (forename+surname joined by ., _, - or nothing
# but reading as two name parts). A fed's own address on a free host
# (geocities.com/globalprowrestling) is the PROMOTION's site and stands.
_PERSONAL_HOST_RE = _lre.compile(
    r"https?://(?:www\.)?(?:members\.aol\.com|home\.earthlink\.net|users\.[a-z0-9.-]+|"
    r"home\.[a-z0-9.-]+|people\.[a-z0-9.-]+|[a-z0-9.-]*\.angelfire\.com|www\.geocities\.com)"
    r"/~?((?:[A-Za-z]{3,12}[._-][A-Za-z]{3,14})\d{0,3})(?![A-Za-z0-9])", _lre.I)
_MEMORIAL_NAMES = []
# MEMORIAL-CREDIT-AKA (hook c89, lane MACHINERY-C89, 2026-10-06): L-CREDIT's memorial exemption also reads every `aka` of every
# register row (DEVILLE-RECORD-2: "Handler Name: Jeff Ward" fired L-CREDIT although the row jeffrey-ward carries aka "Jeff Ward").
# An aka on the register is an exempt name form (memorial-name-exemption.py exempt_names() reads name + aka; CURATION
# #the-memorial-register). A bare forename or bare surname is never an aka (FOR-THE-JANITOR, wave-DEVILLE-MEMORIAL-DRAFT §1), so a
# one-word aka exempts nothing here. _MEMORIAL_NAMES (L-MEM's page scan below) is unchanged: it stays `name` only.
_MEMORIAL_CREDIT_FORMS = []
try:
    _mm = _lj.load(open(f"{_MUSEUM}/data/memorials.json", encoding="utf-8"))
    for _r in (_mm["memorials"] if isinstance(_mm, dict) else _mm):
        if _r.get("name"):
            _MEMORIAL_NAMES.append(_r["name"])
            _MEMORIAL_CREDIT_FORMS.append(_r["name"])
        for _ak in (_r.get("aka") or []) if isinstance(_r.get("aka"), list) else []:
            if isinstance(_ak, str) and len(_ak.split()) >= 2:
                _MEMORIAL_CREDIT_FORMS.append(_ak)
except Exception:
    pass
# ---- MEMORIAL-EXEMPTION-01 (2026-09-24, the Janitor's standing ruling — GAVELS evening RULINGS, D2:
# "anyone added to the memorial section should remove restrictions on naming them"; D5b "memorial
# exemption rules here"). L-MEM and L-MEMSCOPE below were both written for a world in which
# privacy-check.mjs had NO memorial exemption and a memorial name therefore served only where a
# hand-filed allow row reached it. Once the gate reads data/memorials.json itself (the sentinel
# MEMORIAL-EXEMPTION-01 in museum/scripts/privacy-check.mjs), a memorial subject's own name cannot
# be a live deny term anywhere, so demanding a per-wave allow row for it is demanding paperwork for
# a restriction that no longer exists — exactly the page-by-page mechanism the ruling retires.
# This flag is read from the museum's own script rather than assumed, so land-check keeps TODAY's
# behaviour (the allow row is required) for as long as the exemption is not actually ported, and
# relaxes the instant it is. CURATION #privacy v74, #the-memorial-register.
# `_MEM_EXEMPT_WIRED` and `_MEM_EXEMPT` are built once, at the top of this file, before the deny
# lists L-PRIV reads — see the MEMORIAL-EXEMPTION-01 block there.
_MEM_CREDITS, _MEM_PAGES = [], []   # MEMORIAL-EXEMPTION-01 report buffers (never problems)
_frag_text = ""
for _p3 in (frag, f"{_WAVE}/privacy-fragment.tsv"):
    if _lo.path.exists(_p3):
        _frag_text += open(_p3, encoding="utf-8", errors="replace").read()
# ---- L-CREDIT-BILLING (hook c238-lcredit-billing-carveout, lane LCREDIT-CARVEOUT, 2026-10-10). L-CREDIT below held
# "Handler: <name>" credits whose string IS a character's or unit's billing (a sign-off billing the character; a handler
# whose handle is the character's name: the ACW/OSW/FAW accessions and CHARFIRST-2001-1, 2026-10-09/10). A billing is
# in-fiction and stands; a plain handle stands (CURATION v74, v135 (b)). So a credit equal (case/space-normalized) to the
# name or an aka of a live character/unit (data/shards/*/{characters,units}.json, read directly: the find-record index lags)
# or of one this wave mints stands, with an info line -- UNLESS the same string has an exact 'deny' row that reaches the
# page (unscoped in the main ledger, a ledger-pending file or this wave's fragment; or scoped to a prefix of the page's
# served path): a billing that is also a denied real name (v117, staged as themselves) keeps its credit redacted. If either
# read fails the carve-out is off and L-CREDIT holds as before. Terms are read, never printed.
_lcb_norm = lambda _s: " ".join(str(_s).split()).lower()
_LCB_FORMS, _LCB_DENY, _LCB_STOOD, _LCB_ERR = {}, {}, [], None
try:
    _lcb_live = sorted(_lg.glob(f"{_MUSEUM}/data/shards/*/characters.json") + _lg.glob(f"{_MUSEUM}/data/shards/*/units.json"))
    _lcb_wave = sorted(_lg.glob(f"{_WAVE}/delta/data/shards/*/characters.json") + _lg.glob(f"{_WAVE}/delta/data/shards/*/units.json") +
                       _lg.glob(f"{_WAVE}/delta/data/characters-append-*.json") + _lg.glob(f"{_WAVE}/delta/data/units-append-*.json"))
    if not _lcb_live: raise RuntimeError("no live characters/units shards")
    _lcb_all = []
    for _lcb_f in _lcb_live + _lcb_wave:
        _lcb_rows = _lj.load(open(_lcb_f, encoding="utf-8"))   # an unreadable shard turns the carve-out off (below)
        if isinstance(_lcb_rows, list):                       # a dict-shaped shard carries no rows (the two _schema_version files)
            _lcb_all += [_lcb_r for _lcb_r in _lcb_rows if isinstance(_lcb_r, dict) and isinstance(_lcb_r.get("id"), str)]
    for _lcb_r in _lcb_all:                                   # names first, so the info line cites the record billed by that name
        if isinstance(_lcb_r.get("name"), str) and _lcb_r["name"].strip(): _LCB_FORMS.setdefault(_lcb_norm(_lcb_r["name"]), _lcb_r["id"])
    for _lcb_r in _lcb_all:
        for _lcb_n in (_lcb_r.get("aka") if isinstance(_lcb_r.get("aka"), list) else []):
            if isinstance(_lcb_n, str) and _lcb_n.strip(): _LCB_FORMS.setdefault(_lcb_norm(_lcb_n), _lcb_r["id"])
    _lcb_ledgers = [f"{A}/privacy/redaction-ledger.tsv"] + sorted(_lg.glob(f"{A}/privacy/ledger-pending/*.tsv")) + [f"{_WAVE}/privacy-fragment.tsv"]
    if not _lo.path.isfile(_lcb_ledgers[0]): raise RuntimeError("the main ledger is unreadable")
    for _lcb_lf in _lcb_ledgers:
        if not _lo.path.isfile(_lcb_lf): continue
        for _lcb_l in open(_lcb_lf, encoding="utf-8", errors="replace"):
            if _lcb_l.startswith("#") or not _lcb_l.strip(): continue
            _lcb_c = _lcb_l.rstrip("\n").split("\t")
            if len(_lcb_c) < 3 or _lcb_c[2].strip() != "deny": continue
            _lcb_k = _lcb_norm(_lcb_c[0])
            if _lcb_k not in _LCB_FORMS: continue           # only strings that are billings are kept
            _lcb_sc = [_lcb_p.strip().lstrip("/") for _lcb_p in (_lcb_c[3] if len(_lcb_c) > 3 else "").split(",") if _lcb_p.strip()]
            _LCB_DENY.setdefault(_lcb_k, []).append(_lcb_sc)   # [] = an unscoped (tree-wide) deny
except Exception as _lcb_e:
    _LCB_FORMS, _LCB_DENY, _LCB_ERR = {}, {}, f"{type(_lcb_e).__name__}"
    print(f"   note L-CREDIT-BILLING (hook c238): the billing carve-out is off for this run ({_LCB_ERR}); L-CREDIT holds every credit as before")
def _lcb_stands(_cred, _served):
    """The billing id when the credit is a billing no deny reaches on this page; else None."""
    _k = _lcb_norm(_cred)
    _id = _LCB_FORMS.get(_k)
    if not _id: return None
    for _sc in _LCB_DENY.get(_k, []):
        if not _sc or any(_served.startswith(_p) for _p in _sc): return None
    return _id
# ---- end L-CREDIT-BILLING builder (hook c238-lcredit-billing-carveout)

# hook c208 (the Janitor's D480, 2026-10-09: "(a) plain rename"): the three proximity tests below ask only "is this
# line already marked", so they read any marker wording -- the two D480 forms and, for the transition, the older eight.
_MARKED = _lre.compile(r"\[redacted|\[(?:name|detail) withheld\]")
for _pgf in sorted(_lg.glob(f"{_WAVE}/delta/promotions/*/**/*.html", recursive=True) +
                   _lg.glob(f"{_WAVE}/delta/memorials/**/*.html", recursive=True)):
    _h = open(_pgf, encoding="utf-8", errors="replace").read()
    _r2 = _rel(_pgf)
    for _m in _CONTACT_RE.finditer(_h):
        # netnews posting hosts (a Deja/NNTP message-id fragment such as 1...@nnrp1.deja.com) are machinery, not a person's address — privacy-check.mjs's own SYSTEM_ACCOUNT carve-out, coordinator ruling 2026-09-19 (DWF)
        if _lre.search(r"@(?:[a-z0-9.-]*\.)?(?:deja(?:news)?\.com|dejanews\.com)\b|@(?:nnrp|nntp|news)[a-z0-9.-]*\.", _m.group(0), _lre.I): continue
        _prob("L-CONTACT", f"{_r2}: an unredacted contact line (value {_c222_lab(_m.group(1))}) — a contact detail redacts in ANY context (CURATION #privacy-redaction)")
    # hook c241-lcontact-msgid-carveout: Usenet message-id tokens (Source line, id headers) are not addresses
    _lcm_h, _lcm_n = _lcm_blank(_h)
    if _lcm_n:
        print(f"   L-CONTACT-MSGID: {_r2}: {_lcm_n} Usenet message id(s) on its Source line / id headers stand (machinery, not an address; any other address still holds the page)")
    _body = _MSGID_LINE.sub("", _lcm_h)
    for _m in _EMAIL_RE.finditer(_body):
        if _MARKED.search(_body[max(0, _m.start() - 40):_m.start()]):   # hook c208 (D480)
            continue
        if _lre.search(r"@(?:[a-z0-9.-]*\.)?deja(?:news)?\.com\b|@(?:nnrp|nntp|news)[a-z0-9.-]*\.", _m.group(0), _lre.I): continue  # netnews posting host = a message-id fragment, machinery (coordinator 2026-09-19)
        _prob("L-CONTACT", f"{_r2}: an unredacted e-mail address ({_c222_lab(_m.group(0))}) on a served page")
    for _m in _CREDIT_RE.finditer(_h):
        # 2026-09-22 (PURE-ROSTER): "The Don" is a handle (an article + a word), not a forename + surname — v74's credit rule reaches a person's name
        if _m.group(1).split()[0] in ("The", "A", "An"): continue
        # a memorial-wall name is NEVER redacted (CURATION #privacy, v74), in full or as forename + surname ("Sean Williams" for
        # "Sean Simon Williams", the house's allow rows) — but only by an explicit allow in this wave's fragment (L-MEM's rule)
        _cn = _m.group(1)
        if any(_cn.lower() in (_nm.lower(), f"{_nm.split()[0]} {_nm.split()[-1]}".lower()) for _nm in _MEMORIAL_CREDIT_FORMS):
            # MEMORIAL-EXEMPTION-01: with the gate reading the register, the credit serves by
            # construction — no fragment row is owed. Reported, never a problem, because the v74
            # LINKING half still applies: a served document that credits a memorial name earns a
            # served_docs[] edge on that memorial's own row.
            if _MEM_EXEMPT_WIRED:
                _MEM_CREDITS.append((_r2, _cn))
            elif _cn not in _frag_text:
                _prob("L-MEM", f"{_r2}: a handler credit names the memorial subject {_cn!r} with no row for it in this wave's ledger fragment — a memorial name serves by an explicit allow, never by silence")
            continue
        # hook c238-lcredit-billing-carveout: a credit that IS a character's/unit's billing stands unless a deny reaches it
        _lcb_id = _lcb_stands(_m.group(1), _lo.path.relpath(_pgf, f"{_WAVE}/delta"))
        if _lcb_id:
            _LCB_STOOD.append((_r2, _lcb_id))
            print(f"   L-CREDIT-BILLING: {_r2}: the credit ({_c222_lab(_m.group(1))}) equals the billing of character {_lcb_id} and stands (in-fiction billing / plain handle, CURATION v74, v135; no deny reaches it)")
            continue
        _prob("L-CREDIT", f"{_r2}: an out-of-character handler credit naming a person ({_c222_lab(_m.group(1))}) — the persona serves, the credit redacts (CURATION v74)")
    # 2026-09-20 (NJPW): a path named for the FEDERATION itself (geocities.com/neo_japan for NeoJapan Puroresu) is the fed's own
    # address, not a person's login — the slug rider reaches personal account names only. The wing's own id/name/full_name/aka decide.
    def _fed_brand_ok(_url, _wing):
        try:
            _slug = _lre.sub(r"[^a-z]", "", (_lre.sub(r"^https?://[^/]+/~?", "", _url).split("/")[0] or "").lower())
            if len(_slug) < 4: return False
            _rows = [r for _s, r in _mints if r.get("id") == _wing]
            if not _rows:
                try: _rows = [r for r in _lj.load(open(f"{_MUSEUM}/data/promotions.json", encoding="utf-8"))["promotions"] if r.get("id") == _wing]
                except Exception: _rows = []
            _names = " ".join(str(x) for r in _rows for x in [r.get("id"), r.get("name"), r.get("full_name")] + list(r.get("aka") or []) if x)
            _norm = _lre.sub(r"[^a-z]", "", _names.lower())
            if _slug in _norm: return True
            for r in _rows:  # 2026-09-21 (IWA): a slug that is the fed's own acronym, repeated or doubled (geocities.com/iwa_iwa), is fed-branded
                _acr = _lre.sub(r"[^a-z]", "", str(r.get("name") or "").split(" (")[0].lower())
                if len(_acr) >= 2 and _slug and _slug == _acr * (len(_slug) // len(_acr)) and len(_slug) % len(_acr) == 0: return True
                # 2026-09-21 (ACE): the fed's own acronym joined to a generic word (geocities.com/ace_wrestling, /xwfonline, /thecew) is fed-branded
                _GEN = ("wrestling", "wrestle", "federation", "fed", "efed", "online", "league", "pro", "hq", "home", "web", "site", "net", "world", "official", "the", "main")
                if len(_acr) >= 3 and _slug.startswith(_acr) and _slug[len(_acr):] in _GEN: return True
                if len(_acr) >= 3 and _slug.endswith(_acr) and _slug[:-len(_acr)] in _GEN: return True
            for _tok in _lre.findall(r"[a-z]{4,}", _names.lower()):
                if _tok in _slug and _tok not in ("wrestling", "federation", "championship", "alliance", "association", "league", "council", "world", "national", "extreme", "international"): return True
        except Exception: pass
        return False
    _wing_of_page = _r2.split("/")[2] if _r2.startswith("delta/promotions/") else ""
    for _m in _PERSONAL_HOST_RE.finditer(_h):
        if _fed_brand_ok(_m.group(0), _wing_of_page): continue
        if _MARKED.search(_h[_m.start():_m.end() + 30]):   # hook c208 (D480)
            continue
        _prob("L-CONTACT", f"{_r2}: a personal-host path served whole ({_c222_lab(_m.group(0))}) — a real-name-shaped slug is marked per the v74 slug rule (host + shape kept)")
    for _nm in _MEMORIAL_NAMES:
        if _lre.search(r"(?<![A-Za-z])" + _lre.escape(_nm) + r"(?![A-Za-z])", _h):
            if _MEM_EXEMPT_WIRED:
                _MEM_PAGES.append((_r2, _nm))   # MEMORIAL-EXEMPTION-01: serves by the register
            elif _nm not in _frag_text:
                _prob("L-MEM", f"{_r2}: carries the memorial-wall name {_nm!r} with no row for it in this wave's ledger fragment — a memorial name serves in a primary source by an explicit allow, never by silence")

# ---- MEMORIAL-EXEMPTION-01 report (2026-09-24): what the register exempted on this wave's own
# pages. Never a problem — the Janitor's standing ruling is that a name on the register serves
# wherever the record names him. Printed so the coordinator can still see which served documents
# owe a served_docs[] edge back to the memorial (CURATION #privacy v74's linking half).
if _MEM_EXEMPT_WIRED and (_MEM_CREDITS or _MEM_PAGES):
    print("-- memorial exemption (register-driven; no allow row owed):")
    for _p, _n in sorted(set(_MEM_CREDITS)):
        print(f"   CREDIT {_p}: credits {_n!r} — owes a served_docs[] edge on that memorial's row (v74)")
    for _p, _n in sorted(set(_MEM_PAGES)):
        print(f"   NAMED  {_p}: names {_n!r}")

# ---- SOURCE LINKS, the forward rule ---------------------------------------
# GAVELS 2026-09-07: "ensure every document we add with a public source
# explicitly links to that source". Forward from 2026-09-08 this is a hard
# failure at landing; earlier pages are backfill debt and are only reported.
_SRC_DD = _lre.compile(r"<dt>Source</dt>\s*<dd>([\s\S]*?)</dd>", _lre.I)
_unlinked_fwd, _unlinked_old = [], []
# 2026-09-22: the gavel's own scope — "every document we add WITH A PUBLIC SOURCE" — a private donation's document (collections.json kind
# private-donation, e.g. lot 0159) with no source url has no public source to link; the same scope validate-documents.mjs reads.
try:
    _private_lots = {str(c.get("id")) for c in _lj.load(open(f"{M}/data/collections.json", encoding="utf-8"))["collections"] if c.get("kind") == "private-donation"}
except Exception:
    _private_lots = set()
# DONATION-LOT-IN-WAVE (hook c89, lane MACHINERY-C89, 2026-10-06; found by VERIFY-DONATION-GCW-A, lot 0192): a wave that brings its OWN
# private-donation lot (delta/data/collections-rows.json, kind "private-donation") is read too, so L-SRC gives the same answer before
# the wave applies as after. Only this wave's own file, only that one kind; no other wave and no other kind is read.
try:
    _wcr = _lj.load(open(f"{_WAVE}/delta/data/collections-rows.json", encoding="utf-8"))
    _private_lots |= {str(c.get("id")) for c in (_wcr if isinstance(_wcr, list) else []) if isinstance(c, dict) and c.get("kind") == "private-donation" and c.get("id")}
except Exception:
    pass
for _f in sorted(_lg.glob(f"{_WAVE}/delta/data/documents-append*.json")):
    try:
        _rows = _lj.load(open(_f, encoding="utf-8"))
    except Exception:
        continue
    for _r in (_rows if isinstance(_rows, list) else []):
        if not isinstance(_r, dict):
            continue
        _dp = f"{_WAVE}/delta{_r.get('page') or ''}"
        if not _lo.path.exists(_dp):
            continue
        _m = _SRC_DD.search(open(_dp, encoding="utf-8", errors="replace").read())
        if not _m or "<a href" in _m.group(1):
            continue
        if _museum_doc_rows.get(_r.get("page")) == _r: continue  # 2026-09-21: a corrected copy of an already-served page carries the museum's own grandfathered row
        if str(_r.get("collection")) in _private_lots and not any(isinstance(_s, dict) and _s.get("url") for _s in (_r.get("sources") or [])): continue  # no public source to link
        (_unlinked_fwd if str(_r.get("served_since") or "") >= "2026-09-08" else _unlinked_old).append(_r.get("page"))
if _unlinked_fwd:
    _prob("L-SRC", f"{len(_unlinked_fwd)} served page(s) carry a provenance Source line with no link, served on or after 2026-09-08 — the SOURCE LINKS gavel is a FORWARD rule: e.g. {', '.join(_unlinked_fwd[:4])}")
if _unlinked_old:
    print(f"   note (backfill debt, not a failure): {len(_unlinked_old)} page(s) served before 2026-09-08 carry an unlinked Source line")

# ---- the privacy mirror is byte-identical ----------------------------------
_local_frag = f"{_WAVE}/privacy-fragment.tsv"
_mirror = f"{A}/privacy/ledger-pending/{name}.tsv"
if _lo.path.exists(_local_frag) and _lo.path.exists(_mirror):
    if open(_local_frag, "rb").read() != open(_mirror, "rb").read():
        _prob("L-MIRROR", f"privacy-fragment.tsv and its mirror (the ledger's pending {name}.tsv) differ — the gate reads the mirror, the wave reads its own copy, and a divergence is a name that reds a later gate")
elif _lo.path.exists(_local_frag) and not _lo.path.exists(_mirror):
    # A wave that has already been APPLIED has had its fragment folded into
    # the main ledger and its ledger-pending mirror removed; the missing
    # mirror is then the correct end state, not a divergence.
    if _lo.path.exists(f"{_WAVE}/APPLIED") or _lo.path.exists(f"{_WAVE}/.APPLIED"):
        print("   note: fragment folded (wave is APPLIED) — no ledger-pending mirror expected")
    else:
        _prob("L-MIRROR", f"privacy-fragment.tsv has no mirror (the ledger's pending {name}.tsv) — the gate never sees a fragment that is only in the wave dir")

# ---- a lane never writes READY / README ------------------------------------
for _marker in ("READY", "README.md", "README"):
    _mp = f"{_WAVE}/{_marker}"
    if _lo.path.exists(_mp):
        try:
            _mt = open(_mp, encoding="utf-8", errors="replace").read()
        except Exception:
            _mt = ""
        if _marker.startswith("README"):
            _prob("L-READY", f"the wave carries a lane-written {_marker} — LANE-RULES rule 2: deltas only, no README")
        elif "coordinator" not in _mt.lower():
            print(f"   note: READY marker present ({len(_mt)} bytes) — the coordinator marks a wave ready, a lane never does")


# ===========================================================================
# THE GATE BLOCK (2026-09-20 — cycle 149 went red six times on checks the gate
# runs and land-check did not. Each is now a land-check rule, on the delta, so
# a wave is sent back to its lane before READY instead of costing a red gate.)
#   LAW L-SRC      SCHEMA sources[] (promotion level): kind in the documented
#                  vocabulary (usenet-post joined 2026-09-20; local-documents is a
#                  HELD document not online, never a newsgroup recovery),
#                  identifier + window, accession on tier >= 1 resolving to a lot
#   LAW L-PNSHAPE  SCHEMA provenance_notes[] record shape as validate-provenance-
#                  notes.mjs reads it: span.from/to are {date, precision}; date XOR
#                  span; precision exact|month|year|unknown; summary <= 160 chars
#                  and free of workshop process text
#   LAW L-WHO      shows[].appearances[].who is a character id string
#   LAW L-EVENT    a reign whose won date uniquely matches a served show of its
#                  wing wires `event` to that show (registry-validate's rule)
#   LAW L-PRIV     LAW-INDEX 2/2a: a ledger DENY term on a served page or epitaph
#                  this wave delivers, not covered by an ALLOW whose scope reaches
#                  that page or its wing, fails — it is a red gate, not a note
# ===========================================================================
_PROMO_SOURCE_KINDS = {"drive", "wayback", "live-site", "yahoo-group", "local-documents", "tabletop-notes",
                       "cd-archive", "wiki-dump", "common-crawl", "usenet-post"}
try:
    _lots = set()
    for _c in (_lj.load(open(f"{_MUSEUM}/data/collections.json", encoding="utf-8")) or {}).get("collections", []): _lots.add(str(_c.get("id")))
    for _f in _lg.glob(f"{_WAVE}/delta/data/collections-*.json"):
        try:
            _cj = _lj.load(open(_f, encoding="utf-8")); _cj = _cj.get("collections", _cj) if isinstance(_cj, dict) else _cj
            for _c in (_cj if isinstance(_cj, list) else []): _lots.add(str((_c or {}).get("id")))
        except Exception: pass
except Exception: _lots = set()
for _sf, _r in _mints:
    _id = _r.get("id"); _tier = _r.get("tier") if isinstance(_r.get("tier"), int) else 0
    _srcs = _r.get("sources")
    if not isinstance(_srcs, list) or not _srcs:
        _prob("L-SRC", f"{_id}: sources[] is missing or empty (docs/SCHEMA.md sources[]: one row per acquisition lot)")
        continue
    for _i, _s in enumerate(_srcs):
        if not isinstance(_s, dict): _prob("L-SRC", f"{_id}: sources[{_i}] is not an object"); continue
        _k = _s.get("kind")
        if _k not in _PROMO_SOURCE_KINDS: _prob("L-SRC", f"{_id}: sources[{_i}].kind {_k!r} is not a documented kind ({'|'.join(sorted(_PROMO_SOURCE_KINDS))}) — docs/SCHEMA.md; a kind is a deliberate, documented addition (CURATION #medium-defined)")
        if _k == "local-documents" and (_r.get("medium") in ("newsgroup", "usenet") or "usenet" in (_r.get("id") or "") or "rspwf" in _lj.dumps(_s).lower()):
            _prob("L-SRC", f"{_id}: sources[{_i}].kind is local-documents on a newsgroup-medium wing — local-documents means a HELD document not online (the Janitor, 2026-09-20); a newsgroup walk is usenet-post")
        for _need in ("identifier", "window"):
            if not _s.get(_need): _prob("L-SRC", f"{_id}: sources[{_i}] has no {_need}")
        if _tier >= 1 and not _s.get("accession"): _prob("L-SRC", f"{_id}: tier {_tier} but sources[{_i}] has no accession (registry-validate refuses it; a tier-0 beacon may omit it)")
        elif _s.get("accession") and _lots and str(_s.get("accession")) not in _lots: _prob("L-SRC", f"{_id}: sources[{_i}].accession {_s.get('accession')!r} resolves to no collections.json lot (museum or this wave)")
# ---- L-PNSHAPE over EVERY provenance record the wave writes or rewrites
# hook c255 (lane MACH-PNSHAPE-LIVING, 2026-10-10; cycle 381's preflight stopped on validate-provenance-notes
# "nticw-2000[1]: summary is 287 chars, exceeds 160"). wave-NTICW-CARDS-1 rewrote an EXISTING record's summary through a
# registry-corrections row of the shape provenance_notes[i].summary, which this check never read: it read mint rows and a
# list `new` on field "provenance_notes" only (and labelled them by `id`, where lanes file `slug`). Now every record a
# delta writes is checked: the mint rows; a correction's list `new` (each item the merge would add), a single-object
# `new` (appended to the list), a {wing, record} row (apply-corrections.py's norm()); and a provenance_notes[i].<key> row,
# applied to the record it lands on by apply-corrections.py's own rule (the record's <key> equal to the row's `old`, plus
# every key of its record_match; where that already reads `new`, that record). For a rewrite only the problems the rewrite
# ADDS are this wave's; a record carried forward unchanged is the museum's existing debt. A string `new` (and
# provenance_notes_append) lands as a legacy {claim, evidence} record that the converter types and caps: L-PROV's business.
# THE RULES ARE THE GATE'S: the kind/grade/source-kind vocabularies, the precisions and date shapes, the `recorded` shape
# and the summary cap are READ out of scripts/validate-provenance-notes.mjs at run time (never a second copy of a number);
# if they cannot be read, every record to check is refused rather than passed.
_PN_PATH = _lre.compile(r"^provenance_notes\[(\d+)\]\.([A-Za-z_][A-Za-z0-9_]*)$")   # apply-corrections.py's PN_PATH
def _pn_rules():
    _t = open(f"{_MUSEUM}/scripts/validate-provenance-notes.mjs", encoding="utf-8").read()
    def _arr(_name):
        _m = _lre.search(r"const\s+" + _name + r"\s*=\s*\[(.*?)\];", _t, _lre.S)
        _v = _lre.findall(r'"([^"]+)"', _m.group(1)) if _m else []
        if not _v: raise ValueError(f"{_name} not found")
        return set(_v)
    _ds = _lre.search(r"const\s+DATE_SHAPES\s*=\s*\{(.*?)\};", _t, _lre.S)
    _shapes = {_k: _lre.compile(_v) for _k, _v in _lre.findall(r"(\w+)\s*:\s*/([^/]+)/", _ds.group(1))} if _ds else {}
    _prec = _lre.search(r"\[([^\]]*)\]\.includes\(precision\)", _t)
    _cap = _lre.search(r"pn\.summary\.length\s*>\s*(\d+)", _t)
    _rec = _lre.search(r"!/([^/]+)/\.test\(pn\.recorded\)", _t)
    if not (_shapes and _prec and _cap and _rec): raise ValueError("DATE_SHAPES, the precision list, the summary cap or the recorded shape not found")
    return {"kind": _arr("KIND_ENUM"), "grade": _arr("GRADE_ENUM"), "src": _arr("KNOWN_SOURCE_KINDS"), "shapes": _shapes,
            "prec": set(_lre.findall(r'"([^"]+)"', _prec.group(1))), "cap": int(_cap.group(1)), "recorded": _lre.compile(_rec.group(1))}
try: _PN_R, _PN_RERR = _pn_rules(), None
except Exception as _e: _PN_R, _PN_RERR = None, _e
try:
    import sys as _ps; _ps.path.insert(0, f"{_MUSEUM}/scripts/fixers")
    from process_markers import PROCESS as _PN_PROC, NAME_PROCESS as _PN_NAMEPROC
except Exception:
    _PN_PROC = _PN_NAMEPROC = None
# 2026-09-23 (preflight 171 #3: "pending enrichment" passed here, failed validate-provenance-notes): test the summary against the
# SAME process-marker source the gate's JS checker builds from (scripts/text-markers.json), so the two lists cannot drift apart.
try: _PN_GATE = _lre.compile(_lj.load(open(f"{_MUSEUM}/scripts/text-markers.json", encoding="utf-8"))["process_marker_source"])
except Exception: _PN_GATE = None
_PN_WORDS = _lre.compile(r"\b(this pass|now-served|frontier row|ledger|redacted|lane|wave|coordinator|the museum grep)\b|-- ", _lre.I)
def _pn_check(_n):
    """validate-provenance-notes.mjs rules 1-11 on one record, as (field, message) pairs; [] for a clean or legacy record."""
    if not isinstance(_n, dict): return [("", "is not an object")]
    if "claim" in _n or "evidence" in _n: return []   # the legacy shape is L-PROV's business (the validator skips it too)
    R = _PN_R; out = []
    def _dobj(_f, _where, _d):
        if not isinstance(_d, dict): out.append((_f, f"{_where} is not a {{date, precision}} object, got {_lj.dumps(_d)[:60]}")); return
        _p, _v = _d.get("precision"), _d.get("date")
        if _p not in R["prec"]: out.append((_f, f"{_where}.precision {_p!r} is not {'|'.join(sorted(R['prec']))}")); return
        if _p == "unknown":
            if _v is not None: out.append((_f, f"{_where} has precision unknown but date {_v!r} — null, never the word"))
            return
        if not isinstance(_v, str) or _p not in R["shapes"] or not R["shapes"][_p].search(_v): out.append((_f, f"{_where}.date {_v!r} does not match precision {_p!r}"))
    if _n.get("kind") not in R["kind"]: out.append(("kind", f"kind {_n.get('kind')!r} is not in the validator's {len(R['kind'])}-value enum"))
    _d, _sp = _n.get("date"), _n.get("span")
    if _d is not None and _sp is not None: out.append(("date", "carries both date and span — at most one (the span, being more specific, wins)"))
    if _d is not None: _dobj("date", "date", _d)
    if _sp is not None:
        if not isinstance(_sp, dict): out.append(("span", "span is not an object"))
        else:
            if not _sp.get("from"): out.append(("span", "span has no `from`"))
            else: _dobj("span", "span.from", _sp["from"])
            if _sp.get("to") is not None: _dobj("span", "span.to", _sp["to"])
    _ss = _n.get("sources")
    if not isinstance(_ss, list): out.append(("sources", "sources is not an array"))
    elif not _ss and _n.get("grade") != "presumed": out.append(("sources", f"sources[] is empty but grade is {_n.get('grade')!r} (only presumed may cite nothing)"))
    else:
        for _s in _ss:
            if not isinstance(_s, dict) or not _s.get("kind"): out.append(("sources", "a sources[] entry has no kind"))
            elif _s.get("kind") not in R["src"]: out.append(("sources", f"source kind {_s.get('kind')!r} is not {'|'.join(sorted(R['src']))}"))
    if _n.get("grade") not in R["grade"]: out.append(("grade", f"grade {_n.get('grade')!r} is not {'|'.join(sorted(R['grade']))}"))
    if not isinstance(_n.get("recorded"), str) or not R["recorded"].search(_n.get("recorded")): out.append(("recorded", f"recorded {_n.get('recorded')!r} is not YYYY-MM-DD"))
    _sm = _n.get("summary")
    if not isinstance(_sm, str): out.append(("summary", "summary is not a string"))
    else:
        if len(_sm) > R["cap"]: out.append(("summary", f"summary is {len(_sm)} chars (max {R['cap']}, validate-provenance-notes rule 9)"))
        _m = (_PN_NAMEPROC.search(_sm) if _PN_NAMEPROC else None) or _PN_WORDS.search(_sm) or (_PN_GATE.search(_sm) if _PN_GATE else None)
        if _m: out.append(("summary", f"summary carries workshop process text ({_m.group(0)!r}) — served fields state the fact (THE SERVED-TEXT RULE)"))
    _rl = _n.get("related")
    if _rl is not None and (not isinstance(_rl, list) or any(not isinstance(_x, str) for _x in _rl)): out.append(("related", "related is present but not an array of strings"))
    return out
_PN_LIVE = None
def _pn_live():
    global _PN_LIVE
    if _PN_LIVE is None:
        try: _PN_LIVE = {r.get("id"): r for r in _lj.load(open(f"{_MUSEUM}/data/promotions.json", encoding="utf-8"))["promotions"] if isinstance(r, dict)}
        except Exception: _PN_LIVE = {}
        for _sf, _r in _mints: _PN_LIVE.setdefault(_r.get("id"), _r)   # a wing this same wave mints
    return _PN_LIVE
def _pn_records():
    """(label, index, record, problems-to-ignore) for every record the delta writes."""
    for _sf, _r in _mints:
        for _i, _n in enumerate(_r.get("provenance_notes") or []): yield (_r.get("id"), _i, _n, set())
    _cf = f"{_WAVE}/delta/data/registry-corrections.json"
    if not _lo.path.exists(_cf): return
    try:
        _cs = _lj.load(open(_cf, encoding="utf-8"))
        if isinstance(_cs, dict): _cs = _cs.get("corrections") or _cs.get("rows") or [_cs]
    except Exception as e:
        _prob("L-PNSHAPE", f"registry-corrections.json unreadable ({e})"); return
    for _c in (_cs if isinstance(_cs, list) else []):
        if not isinstance(_c, dict): continue
        _slug = next((_c.get(k) for k in ("slug", "id", "wing", "promotion", "promotion_id") if _c.get(k) is not None), None)
        _f, _new = _c.get("field"), _c.get("new")
        if _f is None and isinstance(_c.get("record"), dict): _f, _new = "provenance_notes", [_c["record"]]   # {wing, record}
        _mp = _PN_PATH.match(str(_f or ""))
        if _mp:
            _key = _mp.group(2); _mt = _c.get("record_match") if isinstance(_c.get("record_match"), dict) else {}
            _pn = (_pn_live().get(_slug) or {}).get("provenance_notes")
            _pn = _pn if isinstance(_pn, list) else []
            _ok = lambda rec: isinstance(rec, dict) and all(rec.get(k) == v for k, v in _mt.items())
            _hits = [i for i, rec in enumerate(_pn) if _ok(rec) and "old" in _c and rec.get(_key) == _c.get("old")] or \
                    [i for i, rec in enumerate(_pn) if _ok(rec) and rec.get(_key) == _new]
            if len(_hits) == 1:
                # before = the record as the row's own `old` describes it (the live record may already carry `new` once landed)
                _before = dict(_pn[_hits[0]]); _after = dict(_before); _after[_key] = _new
                if "old" in _c: _before[_key] = _c.get("old")
                yield (f"{_slug} (correction {_f})", _hits[0], _after, set(_pn_check(_before)))
            else:
                # the applier refuses a row it cannot pin to one record (exit 1, file left unstamped); the new value alone is still judged
                yield (f"{_slug} (correction {_f}; no single live record matches)", int(_mp.group(1)), {_key: _new}, {"__only__": _key})
            continue
        if _f != "provenance_notes" or isinstance(_new, str): continue
        _held = {_lj.dumps(x, sort_keys=True) for x in ((_pn_live().get(_slug) or {}).get("provenance_notes") or [])} if isinstance((_pn_live().get(_slug) or {}).get("provenance_notes"), list) else set()
        _old = _lj.dumps(_c.get("old") or [], sort_keys=True)
        for _i, _n in enumerate(_new if isinstance(_new, list) else [_new]):
            # records carried forward verbatim (from the row's `old`, or already on the live wing, which the merge skips) are the museum's existing debt, not this wave's
            _k = _lj.dumps(_n, sort_keys=True)
            if _k in _old or _k in _held: continue
            yield (f"{_slug} (correction)", _i, _n, set())
_pn_todo = list(_pn_records())
if _pn_todo and _PN_R is None:
    _prob("L-PNSHAPE", f"the rules could not be read from scripts/validate-provenance-notes.mjs ({_PN_RERR}); {len(_pn_todo)} provenance record(s) this wave writes cannot be judged, so none passes")
for _id, _i, _n, _skip in (_pn_todo if _PN_R is not None else []):
    for _fld, _msg in _pn_check(_n):
        if isinstance(_skip, dict):
            if _fld != _skip["__only__"]: continue
        elif (_fld, _msg) in _skip: continue
        _prob("L-PNSHAPE", f"{_id}: provenance_notes[{_i}] {_msg}")
# ---- L-WHO / L-EVENT over the wave's shows and reigns
_wave_shows = {}
for _f in _lg.glob(f"{_WAVE}/delta/data/shards/*/shows.json") + _lg.glob(f"{_WAVE}/delta/data/shows-append-*.json"):
    try: _rows = _lj.load(open(_f, encoding="utf-8"))
    except Exception: continue
    _rows = _rows.get("shows", _rows) if isinstance(_rows, dict) else _rows
    for _s in (_rows if isinstance(_rows, list) else []):
        if not isinstance(_s, dict): continue
        _wave_shows[_s.get("id")] = _s
        for _j, _a in enumerate(_s.get("appearances") or []):
            if isinstance(_a, dict) and not isinstance(_a.get("who"), str):
                _prob("L-WHO", f"show {_s.get('id')}.appearances[{_j}].who is {type(_a.get('who')).__name__}, must be a character id string")
        # L-MATCHAPP (coordinator, 2026-09-25): registry-validate reddens the gate when a matches[] entrant is not among the
        # show's kind:"match" appearances. A billed-only card (every appearance kind "billed") carries no matches[] at all:
        # a billing does not establish that a match took place (UFW-C2's and UFW-E's card-only rows, caught before landing).
        _mapp = {_a.get("who") for _a in (_s.get("appearances") or []) if isinstance(_a, dict) and _a.get("kind") == "match"}
        for _k, _m in enumerate(_s.get("matches") or []):
            if not isinstance(_m, dict): continue
            _ids = [i for _sd in (_m.get("sides") or []) if isinstance(_sd, list) for i in _sd] + list(_m.get("participants") or [])
            _miss = [i for i in _ids if isinstance(i, str) and i not in _mapp]
            if _miss:
                _prob("L-MATCHAPP", f"show {_s.get('id')}.matches[{_k}]: {_miss[:4]} not among the show's kind \"match\" appearances (registry-validate refuses it; a billed-only card carries no matches[])")
try:
    _live_shows = _lj.load(open(f"{_MUSEUM}/data/shows.json", encoding="utf-8")); _live_shows = _live_shows.get("shows", _live_shows) if isinstance(_live_shows, dict) else _live_shows
except Exception: _live_shows = []
def _show_date(_s):
    _d = _s.get("date"); return _d.get("date") if isinstance(_d, dict) else _d
_shows_by_wing_date = {}
for _s in list(_live_shows) + list(_wave_shows.values()):
    _sw = _s.get("wing") or _s.get("promotion") if isinstance(_s, dict) else None
    if _sw and _show_date(_s): _shows_by_wing_date.setdefault((_sw, str(_show_date(_s))), set()).add(_s.get("id"))
for _f in _lg.glob(f"{_WAVE}/delta/data/shards/*/reigns.json") + _lg.glob(f"{_WAVE}/delta/data/reigns-append-*.json"):
    try: _rows = _lj.load(open(_f, encoding="utf-8"))
    except Exception: continue
    _rows = _rows.get("reigns", _rows) if isinstance(_rows, dict) else _rows
    _wing = _f.split("/")[-2] if "/shards/" in _f else _lo.path.basename(_f).replace("reigns-append-", "").replace(".json", "")
    for _rg in (_rows if isinstance(_rows, list) else []):
        if not isinstance(_rg, dict) or _rg.get("event"): continue
        _w = _rg.get("won"); _wd = _w.get("date") if isinstance(_w, dict) else _w
        if isinstance(_w, dict) and _w.get("precision") != "exact": continue
        _cands = _shows_by_wing_date.get((_wing, str(_wd)), set())
        if len(_cands) == 1: _prob("L-EVENT", f"reign {_rg.get('id')} won {_wd} uniquely matches served show {next(iter(_cands))} but event is not wired (registry-validate refuses it — link it, or say in the row's note why not)")
# ---- L-PRIV: deny hits on delivered pages/epitaphs not covered by an allow reaching the page or its wing
_allows = collections.defaultdict(set)
for _lf in [f"{A}/privacy/redaction-ledger.tsv"] + glob.glob(f"{A}/privacy/ledger-pending/*.tsv"):
    try:
        for _l in open(_lf, encoding="utf-8", errors="replace"):
            _c = _l.rstrip("\n").split("\t")
            if len(_c) >= 4 and _c[2].strip() == "allow":
                for _sc in _c[3].split(","):
                    if _sc.strip(): _allows[_c[0].strip().lower()].add(_sc.strip().lstrip("/"))
    except Exception: pass
_deny_scopes = collections.defaultdict(set); _deny_global = set()
for _lf in [f"{A}/privacy/redaction-ledger.tsv"] + glob.glob(f"{A}/privacy/ledger-pending/*.tsv"):
    try:
        for _l in open(_lf, encoding="utf-8", errors="replace"):
            _c = _l.rstrip("\n").split("\t")
            if len(_c) >= 3 and _c[2].strip() == "deny" and len(_c[0].strip()) >= 4:
                _scs = [s.strip().lstrip("/") for s in (_c[3] if len(_c) > 3 else "").split(",") if s.strip()]
                if _scs: _deny_scopes[_c[0].strip().lower()].update(_scs)
                else: _deny_global.add(_c[0].strip().lower())
    except Exception: pass
for _t, _fs in hits.items():
    for _rf in _fs:
        if not (_rf.startswith("delta/promotions/") and _rf.endswith(".html") or _rf.startswith("delta/epitaphs/")): continue
        if _rf.startswith("delta/epitaphs/"): _wing = _lo.path.basename(_rf)[:-5]; _page = f"promotions/{_wing}/index.html"
        else: _page = _rf[len("delta/"):]; _wing = _page.split("/")[1] if "/" in _page else ""
        _tl = _t.lower()
        if _tl not in _deny_global and not any(_page.startswith(_s) or _page == _s for _s in _deny_scopes.get(_tl, set())): continue  # a scoped deny reaches only its own pages
        _scopes = _allows.get(_t.lower(), set())
        if any(_page.startswith(_s) or _page == _s or (_s.endswith("/") and _page.startswith(_s)) for _s in _scopes) or any(_s == f"promotions/{_wing}/" for _s in _scopes): continue
        _prob("L-PRIV", f"{_rf}: carries ledger deny term #{tl.index(_t) if _t in tl else '?'} (len {len(_t)}) with no allow whose scope reaches this page or promotions/{_wing}/ — redact it in the delta, or file a wing-scoped allow with the in-fiction evidence (LAW-INDEX 2a, CURATION v105(a))")


# ---- L-PRIVDATA (2026-09-22): a ledger DENY term in a delta DATA row, by the data file(s) it lands in. The gate reads data/*.json
# line by line and an allow covers a hit only where its scope PREFIX reaches that data path (privacy-check.mjs allowedHit) — a
# page-scoped allow never reaches data/. A term already present in the live landing file is existing debt, not this wave's.
_SHARDED = ("awards", "characters", "reigns", "rps", "shows", "titles", "units")
def _data_landing(_rf):
    _b = _lo.path.basename(_rf)
    if _b.endswith(".APPLIED") or not _b.endswith(".json"): return []
    if _rf.startswith("delta/data/shards/"):
        _k = _b[:-5]; return [_rf[len("delta/"):]] + ([f"data/{_k}.json"] if _k in _SHARDED else [])
    _mm = _lre.match(r"(awards|characters|reigns|rps|shows|titles|units)-(?:append|corrections)-(.+)\.json$", _b)
    if _mm: return [f"data/shards/{_mm.group(2)}/{_mm.group(1)}.json", f"data/{_mm.group(1)}.json"]
    for _pre, _dst in (("documents-", "documents"), ("memorials-", "memorials"), ("affiliations-", "affiliations"), ("collections-", "collections"),
                       ("frontier-", "frontier"), ("promotions-", "promotions"), ("registry-corrections", "promotions")):
        if _b.startswith(_pre): return [f"data/{_dst}.json"]
    return []
def _data_text(_f):
    _b = _lo.path.basename(_f)
    _raw = open(_f, encoding="utf-8", errors="replace").read()
    if "corrections" not in _b: return _raw
    try:   # a correction's "old" value is the text being replaced — only "new" lands
        _cs = _lj.loads(_raw); _cs = _cs if isinstance(_cs, list) else (_cs.get("corrections") or [])
        return "\n".join(_lj.dumps(_c.get("new"), ensure_ascii=False) for _c in _cs if isinstance(_c, dict))
    except Exception: return _raw
_live_cache = {}
for _t, _fs in hits.items():
    _tl = _t.lower(); _wre = _lre.compile(r"(?<!\w)" + _lre.escape(_tl) + r"(?!\w)" + ("|" + _TD_JOIN[_t][0].pattern if _t in _TD_JOIN else ""))  # the gate's boundary: no letter, digit or _ either side; hook c50: a takedown row's joined forms too; hook c274: the term wrapped across a line break or markup
    for _rf in _fs:
        if not _rf.startswith("delta/data/"): continue
        _lands = _data_landing(_rf)
        if not _lands: continue
        try:
            _dtxt = _data_text(f"{_WAVE}/{_rf}").lower()
            if not (_wre.search(_dtxt) or _flex_hit(_t, _dtxt)): continue   # hook c274: the term wrapped inside a data string too
        except Exception: continue
        for _lp in _lands:
            if _tl not in _deny_global and not any(_lp.startswith(_s) for _s in _deny_scopes.get(_tl, set())): continue
            if any(_lp.startswith(_s) for _s in _allows.get(_tl, set())): continue
            if _lp not in _live_cache:
                try: _live_cache[_lp] = open(f"{_MUSEUM}/{_lp}", encoding="utf-8", errors="replace").read().lower()
                except Exception: _live_cache[_lp] = ""
            if _wre.search(_live_cache[_lp]) or _flex_hit(_t, _live_cache[_lp]): continue   # hook c274: existing debt, wrapped too
            _prob("L-PRIVDATA", f"{_rf}: carries ledger deny term #{tl.index(_t) if _t in tl else '?'} (len {len(_t)}) and lands in {_lp}, which no allow for it reaches — the gate reads data/ too, and a page-scoped allow never covers it (in-fiction: add the house data scopes to the allow; museum voice or out-of-character: redact the row)")


# ---- L-VOICENAME (2026-09-22, HOST-NEIGHBOURS-PURE: a caption read "real name (…)" in the museum's own voice): LAW-INDEX §2 —
# "No living contributor's real name or handle appears in the Museum's own writing, ever" (CURATION #privacy). A museum-voice
# field (caption / note / epitaph / summary / house_style / description) that binds a character to a named person fails.
# Memorial subjects are the one open door (#the-memorial-register). The name is printed as initials only.
_VOICE_KEYS = {"caption", "note", "notes", "epitaph", "summary", "house_style", "description", "bio_note", "statement"}
_BIND_RE = _lre.compile(r"\b(real[- ]life name|real name|in real life|the (?:person|man|woman|player|writer) behind(?: (?:him|her|it|the character))?|played by|handled by|handler(?: was| is|:)?)"
                        r"\s*(?:was|is|of|:|,|—|-|\()?\s*([A-Z][a-z]+(?:\s+[A-Z]\.)?\s+[A-Z][a-z]+(?:-[A-Z][a-z]+)?)")
_MEM_FORMS = {f(_nm).lower() for _nm in _MEMORIAL_NAMES for f in (lambda s: s, lambda s: f"{s.split()[0]} {s.split()[-1]}")}
# "real name …" alone is also how a caption states a character's KAYFABE real name (the card's own real-name line, the coincidence
# clause) — so that phrase fails only on a name the ledger knows as a person; the out-of-character phrases fail on any name.
_LEDGER_NAMES = set()
for _lf in [f"{A}/privacy/redaction-ledger.tsv"] + _lg.glob(f"{A}/privacy/ledger-pending/*.tsv"):
    try:
        for _l in open(_lf, encoding="utf-8", errors="replace"):
            _c = _l.rstrip("\n").split("\t")
            if len(_c) >= 2 and not _l.startswith("#"): _LEDGER_NAMES.add(_c[0].strip().lower())
    except Exception: pass
def _binds(_m): return not _m.group(1).lower().startswith("real") or _m.group(2).lower() in _LEDGER_NAMES
def _voice_strings(_o, _key=""):
    if isinstance(_o, dict):
        for _k, _v in _o.items(): yield from _voice_strings(_v, _k if _k in _VOICE_KEYS else _key)
    elif isinstance(_o, list):
        for _v in _o: yield from _voice_strings(_v, _key)
    elif isinstance(_o, str) and _key: yield _key, _o
for _f in _lg.glob(f"{_WAVE}/delta/data/*.json") + _lg.glob(f"{_WAVE}/delta/data/shards/*/*.json"):
    try: _rows = _lj.load(open(_f, encoding="utf-8"))
    except Exception: continue
    _b = _lo.path.basename(_f)
    if "corrections" in _b:   # only a correction's new value lands, and only in a voice field
        _cs = _rows if isinstance(_rows, list) else (_rows.get("corrections") or [] if isinstance(_rows, dict) else [])
        _rows = [{str(_c.get("field")).split(".")[-1]: _c.get("new")} for _c in _cs if isinstance(_c, dict)]
    for _k, _s in _voice_strings(_rows):
        for _m in _BIND_RE.finditer(_s):
            if _m.group(2).lower() in _MEM_FORMS or not _binds(_m): continue
            _ini = "".join(_w[0] for _w in _m.group(2).split())
            _prob("L-VOICENAME", f"{_rel(_f)}: a museum-voice {_k!r} binds a character to a named person ({_m.group(1)!r} + a name, initials {_ini}) — the Museum's own writing never names a living contributor (LAW-INDEX §2, CURATION #privacy); state the role, or drop it")
for _f in _lg.glob(f"{_WAVE}/delta/epitaphs/*.html"):
    _h = _lre.sub(r"<[^>]+>", " ", open(_f, encoding="utf-8", errors="replace").read())
    for _m in _BIND_RE.finditer(_h):
        if _m.group(2).lower() in _MEM_FORMS or not _binds(_m): continue
        _prob("L-VOICENAME", f"{_rel(_f)}: the epitaph binds a character to a named person ({_m.group(1)!r} + a name, initials {''.join(_w[0] for _w in _m.group(2).split())}) — LAW-INDEX §2, CURATION #privacy")


# ---- L-SERVEDTEXT (2026-09-23, preflight 173: the PCW-REIGNS wave landed 29 reign notes narrating "the ledger" and citing the
# donated database's table names; the gate's served-text-narration ratchet rose +5 and stopped the cycle). THE SERVED-TEXT RULE
# (the Janitor 2026-09-05; CURATION #protagonist-test): a served field states the fact — the reasoning stays in the wave's findings.
# Same pattern the gate uses (text-markers.json process_text_source, case-insensitive, "Lois Lane" exempt as a name), plus a
# donated-database identifier (efed_…), which is workshop plumbing in any served field.
_SERVED_KEYS = {"note", "notes", "caption", "tagline", "medium_detail", "house_style", "depth", "summary", "epitaph", "blurb",
                "status_note", "vote_detail", "hub", "first_seen_in"}
try: _ST_RE = _lre.compile(_lj.load(open(f"{_MUSEUM}/scripts/text-markers.json", encoding="utf-8"))["process_text_source"], _lre.I)
except Exception: _ST_RE = None
_ST_DB = _lre.compile(r"\befed_[a-z_]+")
def _served_strings(_o, _key=""):
    if isinstance(_o, dict):
        for _k, _v in _o.items(): yield from _served_strings(_v, _k if _k in _SERVED_KEYS else ("" if _k not in ("tenures", "events", "bestowals", "community_presence", "gallery", "provenance_notes") else _key))
    elif isinstance(_o, list):
        for _v in _o: yield from _served_strings(_v, _key)
    elif isinstance(_o, str) and _key: yield _key, _o
def _st_hits(_s):
    _out = []
    for _m in (_ST_RE.finditer(_s) if _ST_RE else []):
        if _lre.fullmatch(r"Lanes?|Waves?", _m.group(0)) and _lre.search(r"[A-Z][a-z'’.-]*\s$", _s[:_m.start()]): continue
        if _lre.fullmatch(r"Lanes?|Waves?", _m.group(0)) and _m.group(0)[:1].isupper() and _lre.match(r"\s[A-Z][a-z]", _s[_m.end():]): continue  # LANE-BEFORE-NAME 2026-09-27 ("Lane Stevens")
        if _lre.fullmatch(r"LANES?|WAVES?", _m.group(0)) and _lre.match(r"\s[A-Z]{2,}\b", _s[_m.end():]): continue  # ALLCAPS-NAME 2026-09-28 ("LANE STEVENS")
        _out.append(_m.group(0))
    _out += [_m.group(0) for _m in _ST_DB.finditer(_s)]
    return _out
def _st_hit(_s):
    _h = _st_hits(_s); return _h[0] if _h else None
for _f in _lg.glob(f"{_WAVE}/delta/data/*.json") + _lg.glob(f"{_WAVE}/delta/data/shards/*/*.json"):
    try: _rows = _lj.load(open(_f, encoding="utf-8"))
    except Exception: continue
    _carried = set(); _carried_h = collections.Counter()
    if "corrections" in _lo.path.basename(_f):   # only a correction's new value lands
        _cs = _rows if isinstance(_rows, list) else (_rows.get("corrections") or [] if isinstance(_rows, dict) else [])
        # 2026-09-23 (wave-PRIME-A): a whole-list replacement carries the live list's existing text in both old and new — that is
        # existing debt (the gate's ratchet already counts it), not this wave's; only text the wave ADDS is judged here
        def _all_str(_o):
            if isinstance(_o, str): yield _o
            elif isinstance(_o, dict):
                for _v in _o.values(): yield from _all_str(_v)
            elif isinstance(_o, list):
                for _v in _o: yield from _all_str(_v)
        _carried = {_s for _c in _cs if isinstance(_c, dict) for _s in _all_str(_c.get("old"))}
        # 2026-09-27 (J40, wave-REPOINT-REPAIR-0927-NOTES): the exact-string exemption above misses a correction that
        # repairs ONE TOKEN inside a long PRE-EXISTING note — `new` is not byte-equal to `old`, so 49 identity notes
        # already live (and already counted by the gate's ratchet) were charged to the repair wave. Judge only what the
        # wave ADDS, as the line above says: a process-text hit the row's own `old` already carries is existing debt.
        # Text the wave actually adds still fails.
        _carried_h = collections.Counter(_h.lower() for _c in _cs if isinstance(_c, dict)
                                         for _s in _all_str(_c.get("old")) for _h in _st_hits(_s))
        if _UNSERVED_NOTES_FILE.match(_lo.path.basename(_f)):   # NOTES UNSERVED (D114) checks: a character/unit `notes` row is not served
            _cs = [_c for _c in _cs if not (isinstance(_c, dict) and _c.get("field") == "notes")]
        _rows = [{str(_c.get("field")).split(".")[-1].split("[")[0]: _c.get("new")} for _c in _cs if isinstance(_c, dict)]
    elif _UNSERVED_NOTES_FILE.match(_lo.path.basename(_f)) and isinstance(_rows, list):   # NOTES UNSERVED (D114) checks
        _rows = [{_k: _v for _k, _v in _r.items() if _k != "notes"} if isinstance(_r, dict) else _r for _r in _rows]
    _seen = 0
    for _k, _s in _served_strings(_rows):
        if _s in _carried: continue
        _h = None
        for _x in _st_hits(_s):
            if _carried_h.get(_x.lower(), 0) > 0: _carried_h[_x.lower()] -= 1; continue
            _h = _x; break
        if not _h: continue
        _seen += 1
        if _seen <= 8: _prob("L-SERVEDTEXT", f"{_rel(_f)}: a served {_k!r} carries workshop process text ({_h!r}) in \"{_s[:90]}…\" — served fields state the fact; the reasoning stays in findings.md (THE SERVED-TEXT RULE, CURATION #protagonist-test; the gate's served-text-narration ratchet)")
    if _seen > 8: _prob("L-SERVEDTEXT", f"{_rel(_f)}: … and {_seen - 8} more served fields with workshop process text")


# ---- L-RPSLINK (2026-09-23, preflight 171: SEWF/AWE rp pages linked /promotions/<wing>/rps.html, a page the house never
# generates — every wing's documents hang off /promotions/<wing>/holdings.html, the disk-derived register)
for _pg in _lg.glob(f"{_WAVE}/delta/promotions/**/*.html", recursive=True):
    try: _h = open(_pg, encoding="utf-8", errors="replace").read()
    except Exception: continue
    for _m in _lre.finditer(r'href="(/promotions/[a-z0-9-]+/rps\.html)"', _h):
        _prob("L-RPSLINK", f"{_rel(_pg)}: links {_m.group(1)}, which is never generated — a served document links its wing's register, /promotions/<wing>/holdings.html (validate reds a broken internal link)")


# ---- L-MEMSCOPE (2026-09-23, gates 171: the andrew-doran memorial red twice): a memorial whose name is a ledger DENY term needs an
# allow that reaches EVERY place the build renders a memorial's name — the register, the characters/units indexes, character and unit
# pages, every memorial page (each one's pager names its neighbours), in-memoriam.html, and the site's clacks header. privacy-check.mjs
# has no memorial exemption; the memorial register is the evidence (CURATION #the-memorial-register, #privacy v74).
_MEM_NEED = ["data/memorials.json", "data/characters-index.json", "data/units-index.json", "characters/", "units/", "memorials/",
             "in-memoriam.html", "_headers", "worker/headers.json"]
#
# MEMORIAL-EXEMPTION-01 (2026-09-24, the Janitor's D2): once the gate reads the register itself, a
# memorial name is never a live deny term, so there is no scope to enumerate and nothing to miss —
# the enumeration this check polices is the very page-by-page mechanism the ruling retires. The
# check stands unchanged for as long as the exemption is NOT ported, which is what makes the port
# safe to do in either order.
for _f in ([] if _MEM_EXEMPT_WIRED else _lg.glob(f"{_WAVE}/delta/data/memorials-append*.json")):
    try: _rows = _lj.load(open(_f, encoding="utf-8"))
    except Exception: continue
    for _r in _rows if isinstance(_rows, list) else []:
        _nm = (_r or {}).get("name") if isinstance(_r, dict) else None
        if not _nm: continue
        _tl = str(_nm).lower()
        if _tl not in _deny_global: continue
        _have = _allows.get(_tl, set())
        _miss = [s for s in _MEM_NEED if not any(s.startswith(h) or h == s for h in _have)]
        if _miss: _prob("L-MEMSCOPE", f"{_rel(_f)}: the memorial name (ledger deny term #{tl.index(_nm) if _nm in tl else '?'}) has no allow reaching {', '.join(_miss)} — every place a memorial's name renders needs it, or the gate reds")


# ---- L-FOUNDED / L-CAPTION (2026-09-20, cycle 151 run 2): registry-validate's own rules, on the delta
for _sf, _r in _mints:
    _id = _r.get("id")
    for _edge in ("founded", "closed"):
        _e = _r.get(_edge)
        if _e is None: continue
        if not isinstance(_e, dict) or not isinstance(_e.get("date"), str) or not _e.get("date").strip():
            _prob("L-FOUNDED", f"{_id}.{_edge}: date must be a non-empty string — the literal \"unknown\" paired with precision \"unknown\" when no date survives (docs/SCHEMA.md founded/closed)")
        elif _e.get("date") == "unknown" and _e.get("precision") != "unknown":
            _prob("L-FOUNDED", f"{_id}.{_edge}: date \"unknown\" must pair with precision \"unknown\"")
    if not (isinstance(_r.get("caption"), str) and _r["caption"].strip()):
        _prob("L-CAPTION", f"{_id}: missing caption — every promotion carries one museum-label sentence (docs/PROCESS.md page-skeleton doctrine; registry-validate refuses it)")


# ---- L-CORR (2026-09-20, AGW/AWMC): two READY waves correcting the same held field from the same live baseline — the
# second to apply fails its old-value match. A wave's correction must build on a sibling READY wave's `new`, or fold into it.
try:
    _mine = f"{_WAVE}/delta/data/registry-corrections.json"
    if _lo.path.exists(_mine):
        _cs = _lj.load(open(_mine, encoding="utf-8")); _cs = _cs if isinstance(_cs, list) else _cs.get("corrections", [])
        _mykeys = {((c.get("id") or c.get("slug")), c.get("field")): _lj.dumps(c.get("old"), sort_keys=True) for c in _cs if isinstance(c, dict)}
        _parent = _lo.path.dirname(_WAVE)
        for _sib in _lg.glob(f"{_parent}/wave-*/delta/data/registry-corrections.json"):
            _sw = _sib.split("/delta/")[0]
            if _sw == _WAVE or not _lo.path.exists(f"{_sw}/READY") or _lo.path.exists(f"{_sw}/APPLIED"): continue
            try:
                _scs = _lj.load(open(_sib, encoding="utf-8")); _scs = _scs if isinstance(_scs, list) else _scs.get("corrections", [])
            except Exception: continue
            for _c in _scs:
                if not isinstance(_c, dict): continue
                _k = ((_c.get("id") or _c.get("slug")), _c.get("field"))  # 2026-09-30: registry rows key by slug
                # 2026-09-22 (DWF + MOTR): apply-corrections MERGES list fields (every new item not held is appended,
                # whatever `old` says), so two waves adding records to the same list do not conflict. Scalars still do.
                if _k[1] in ("provenance_notes", "sources", "community_presence", "aliases", "aka"): continue
                if _k in _mykeys and _lj.dumps(_c.get("old"), sort_keys=True) == _mykeys[_k]:
                    _prob("L-CORR", f"{_k[0]}.{_k[1]}: sibling READY wave {_lo.path.basename(_sw)} corrects the same field from the same live baseline — build your `old` on its `new`, or fold your records into its row (the second applier run would fail its old-value match)")
except Exception as _e: print("L-CORR check skipped:", _e)


# ---- L-FRONTIER-RULE (hook c271, lane LANDCHECK-FRONTIER, 2026-10-10). Cycle 387 stopped at preflight 22:42 on
# registry-validate.mjs `frontier.rows[704] ("(GWS) Global Wrestling Society"): observed_year precedes founded_year`:
# wave-GERMAN-SCENE-FRONTIER-1010's frontier-corrections.json set observed_year 2009 onto a live row whose founded_year
# read 2011, and this landing check — which read the wave's frontier delta only for process text — passed it at 0. Now
# the row the delta would LEAVE ON FILE is held to the frontier rules the gate enforces (registry-validate section 6e).
# THE RULES ARE THE GATE'S: the status / cadence / medium vocabularies, the year bounds and the ISO-date, BCP-47 and
# ISO-3166 shapes are READ out of scripts/registry-validate.mjs at run time (never a second copy of a list); if they
# cannot be read, every row the wave touches is refused rather than passed. Only the validator's HARD rules (its warn(),
# the ones preflight fails the whole museum on) are here; its soft() advisories are not a landing bar.
# THE POST-APPLY ROW is simulated the way scripts/fixers/apply-frontier.py lands this delta: frontier-new-rows.json rows
# appended unless the name is already on file (the applier prints "frontier row exists" and skips), null fields dropped
# (D149); frontier-corrections.json and enrich-frontier-*.json items resolved to their target row the applier's way and
# applied through its own two branches (the notes_replace / fields-only branch, where one bad field refuses the whole
# item, and the enrich branch's setters). For a row the wave only corrects, only the problems the correction ADDS are
# reported — a live row's standing defect is the museum's existing debt, not this wave's.
# NOT HERE: delta/data/frontier-rows.json and frontier-leads-append.json land through add-frontier-rows.py /
# apply-frontier-leads-append.py, whose own normalisation (keys filtered to the live shape, the legacy-medium remap,
# status/memorial_linked defaults, a stamped last_checked) would have to be mirrored to judge them honestly.
import datetime as _frdt
_FR_SRC = f"{_MUSEUM}/scripts/registry-validate.mjs"
_FR_FILES = [_f for _f in ([f"{_WAVE}/delta/data/frontier-new-rows.json"] +
                           sorted(_lg.glob(f"{_WAVE}/delta/data/enrich-frontier-*.json")) +
                           [f"{_WAVE}/delta/data/frontier-corrections.json"]) if _lo.path.exists(_f)]
def _fr_rules():
    _t = open(_FR_SRC, encoding="utf-8").read()
    def _set(_n):
        _m = _lre.search(r"const\s+" + _n + r"\s*=\s*new Set\(\[(.*?)\]\)", _t, _lre.S)
        _v = set(_lre.findall(r'"([^"]*)"', _m.group(1))) if _m else set()
        if not _v: raise ValueError(_n + " not found")
        return _v
    def _num(_n):
        _m = _lre.search(r"const\s+" + _n + r"\s*=\s*(\d{4})\b", _t)
        if not _m: raise ValueError(_n + " not found")
        return int(_m.group(1))
    def _rx(_n):
        _m = _lre.search(r"const\s+" + _n + r"\s*=\s*/(.+?)/([a-z]*);", _t)
        if not _m: raise ValueError(_n + " not found")
        return _lre.compile(_m.group(1), _lre.I if "i" in _m.group(2) else 0)
    return {"status": _set("FRONTIER_STATUS"), "cadence": _set("FRONTIER_CADENCE"), "medium": _set("MEDIUM_VALUES"),
            "ymin": _num("DATE_YEAR_MIN"), "ymax": _num("DATE_YEAR_MAX"), "iso_date": _rx("ISO_DATE_RE"),
            "bcp47": _rx("BCP47_RE"), "cc": _rx("ISO3166_RE"), "cc_reserved": _rx("ISO3166_RESERVED")}
try: _FR_R, _FR_RERR = _fr_rules(), None
except Exception as _e: _FR_R, _FR_RERR = None, _e
def _fr_memorial_ids():
    """the ids registry-validate's own `memorial` rule resolves against — the live register plus the one this wave lands"""
    _ids = set()
    for _p in (f"{_MUSEUM}/data/memorials.json", f"{_WAVE}/delta/data/memorials-append.json"):
        try:
            _d = _lj.load(open(_p, encoding="utf-8"))
            _rs = (_d.get("memorials") if isinstance(_d, dict) else _d)
            if _rs is None and isinstance(_d, dict): _rs = next((_v for _v in _d.values() if isinstance(_v, list)), [])
            _ids |= {_x.get("id") for _x in (_rs if isinstance(_rs, list) else []) if isinstance(_x, dict) and _x.get("id")}
        except Exception: pass
    return _ids
_FR_WINGS = None
def _fr_wings():
    global _FR_WINGS
    if _FR_WINGS is None:
        try:
            _p = _lj.load(open(f"{_MUSEUM}/data/promotions.json", encoding="utf-8"))
            _ps = _p if isinstance(_p, list) else (_p.get("promotions") or [])
            _FR_WINGS = {_x.get("id") for _x in _ps if isinstance(_x, dict) and _x.get("id")}
        except Exception: _FR_WINGS = set()
        _FR_WINGS |= {_r.get("id") for _sf, _r in _mints if _r.get("id")}
    return _FR_WINGS
def _fr_check(_r):
    """registry-validate.mjs section 6e's HARD rules on one frontier row, in the validator's own words."""
    _R = _FR_R; _o = []
    def _yr(_v): return isinstance(_v, int) and not isinstance(_v, bool) and _R["ymin"] <= _v <= _R["ymax"]
    _bounds = f"{_R['ymin']}–{_R['ymax']}"
    _st = _r.get("status")
    if not _r.get("name") or not _r.get("first_seen_in") or not _st:
        _o.append('needs "name", "first_seen_in", and "status"')
    if _st and _st not in _R["status"]:
        _o.append(f'unknown status "{_st}"')
    _u = _r.get("url")
    if isinstance(_u, str) and _u:
        if not _lre.match(r"https?://", _u, _lre.I):
            _o.append(f'"url" has no http(s):// scheme ("{_u}") — frontier.html renders it as a bare href, which resolves as a broken relative link')
        elif _lre.search(r"\s", _u) or _lre.search(r"[{}|]", _u) or _lre.search(r"<[a-z]", _u, _lre.I):
            _o.append(f'"url" contains whitespace, "{{", "}}", "|", or an HTML tag ("{_u}") — looks like extraction residue (wikitext template syntax, a concatenated second URL/tag) past the real address rather than a clean link')
    if _st == "verified-alive":
        _lc = _r.get("last_checked")
        if "last_checked" in _r and not (isinstance(_lc, str) and _R["iso_date"].fullmatch(_lc)):
            _o.append('"last_checked" must be an ISO date string (YYYY-MM-DD)')
        if "check_cadence" in _r and _r.get("check_cadence") not in _R["cadence"]:
            _o.append('"check_cadence" must be "weekly", "monthly" or "quarterly"')
    if "medium" in _r and _r.get("medium") not in _R["medium"]:
        _o.append(f'"medium" must be one of the promotions media values (got "{_r.get("medium")}")')
    if "language" in _r:
        _lgv = _r.get("language")
        if not isinstance(_lgv, str) or not _R["bcp47"].fullmatch(_lgv):
            _o.append(f'"language" is not a well-formed BCP-47 tag (got "{_lgv}") — CURATION.md v111(c)')
    if "country" in _r:
        _cv = _r.get("country")
        if not isinstance(_cv, str) or not _R["cc"].fullmatch(_cv) or _R["cc_reserved"].fullmatch(_cv):
            _o.append(f'"country" is not an ISO 3166-1 alpha-2 code in upper case (got "{_cv}") — CURATION.md v111(c); this is the REAL-WORLD country of the community, never a kayfabe billing')
    if "aka" in _r:
        _ak = _r.get("aka")
        if not isinstance(_ak, list) or any(not isinstance(_x, str) for _x in _ak):
            _o.append('"aka" must be an array of strings')
    if "community_presence" in _r:
        _cp = _r.get("community_presence")
        if not isinstance(_cp, list):
            _o.append('"community_presence" must be an array')
        else:
            for _c in _cp:
                if not isinstance(_c, dict) or not isinstance(_c.get("hub"), str) or not _c.get("hub"):
                    _o.append('community_presence entry needs a "hub" string')
                for _yk in ("first_seen", "last_seen"):
                    if isinstance(_c, dict) and _yk in _c and not _yr(_c.get(_yk)):
                        _o.append(f"community_presence {_yk} must be a plausible year")
    if "observed_year" in _r:
        if not _yr(_r.get("observed_year")):
            _o.append(f'"observed_year" must be a plausible integer year ({_bounds})')
        if "founded_year" in _r and isinstance(_r.get("founded_year"), int) and not isinstance(_r.get("founded_year"), bool) \
           and isinstance(_r.get("observed_year"), int) and not isinstance(_r.get("observed_year"), bool) \
           and _r["observed_year"] < _r["founded_year"]:
            _o.append("observed_year precedes founded_year — one of the two is wrong")
    if "founded_year" in _r and not _yr(_r.get("founded_year")):
        _o.append(f'"founded_year" must be a plausible integer year ({_bounds})')
    if "kind" in _r and _r.get("kind") != "hub":
        _o.append(f'"kind" must be "hub" when present (got "{_r.get("kind")}") — promotions carry no kind field')
    if "memorial" in _r:
        _mm = _r.get("memorial")
        if not isinstance(_mm, str) or _mm not in (_FR_IDS or set()):
            _o.append(f'"memorial" must be a data/memorials.json id (got "{_mm}")')
        if not _r.get("memorial_linked"):
            _o.append('carries "memorial" but is not memorial_linked — set memorial_linked or drop the field')
    return _o
# ---- the post-apply rows, the way scripts/fixers/apply-frontier.py lands them
_FR_FIELD_KEYS = ("status", "held_as", "url", "last_checked", "last_activity", "site_online", "check_cadence")
_FR_C264 = ("last_checked", "last_activity", "site_online", "check_cadence")
def _fr_fields_only(_e):
    _ks = [_k for _k in _e if _k not in ("target_row", "target", "name")]
    return bool(_ks) and all(_k in _FR_FIELD_KEYS or _k == "notes_replace" for _k in _ks) and any(_k in _e for _k in _FR_FIELD_KEYS)
def _fr_c264_ok(_k, _v):
    if _k == "last_checked":
        if not (isinstance(_v, str) and _lre.fullmatch(r"\d{4}-\d{2}-\d{2}", _v)): return False
        try: return _frdt.date.fromisoformat(_v) <= _frdt.date.today()
        except ValueError: return False
    if _k == "last_activity": return isinstance(_v, int) and not isinstance(_v, bool) and 1970 <= _v <= _frdt.date.today().year
    if _k == "site_online": return isinstance(_v, bool)
    if _k == "check_cadence": return _v in ("weekly", "monthly", "quarterly")
    return False
def _fr_set_fields(_row, _e, _sv):
    """apply-frontier.py's _set_fields: every field is validated first, and one refusal changes nothing on the row."""
    _new = {}
    if _e.get("notes_replace"):
        _nt = str(_e["notes_replace"]).strip()
        if _nt != (_row.get("notes") or ""): _new["notes"] = _nt
    if _e.get("status") not in (None, ""):
        _s2 = str(_e["status"]).strip()
        if _s2 not in _sv: return False
        if _s2 != _row.get("status"): _new["status"] = _s2
    if "held_as" in _e:
        _ha = _e["held_as"].strip() if isinstance(_e["held_as"], str) else ""
        if not _ha or _ha not in _fr_wings(): return False
        if _ha != _row.get("held_as"): _new["held_as"] = _ha
    if "url" in _e:
        _u2 = _e["url"]
        if _u2 is None:
            if "url" in _row: _new["url"] = None
        elif isinstance(_u2, str) and _u2.strip():
            if _u2.strip() != _row.get("url"): _new["url"] = _u2.strip()
        else: return False
    for _k in _FR_C264:
        if _k not in _e: continue
        if not _fr_c264_ok(_k, _e[_k]): return False
        if not (_k in _row and type(_row[_k]) is type(_e[_k]) and _row[_k] == _e[_k]): _new[_k] = _e[_k]
    if _new.get("held_as", _row.get("held_as")) and _new.get("status", _row.get("status")) != "held": return False
    if not _new: return False
    for _k, _v in _new.items():
        if _v is None: _row.pop(_k, None)
        else: _row[_k] = _v
    return True
def _fr_apply(_row, _e, _sv):
    if _e.get("notes_replace") or _fr_fields_only(_e):
        _fr_set_fields(_row, _e, _sv); return
    if isinstance(_e.get("memorial_linked"), bool): _row["memorial_linked"] = _e["memorial_linked"]
    if isinstance(_e.get("memorial"), str) and _e["memorial"].strip(): _row["memorial"] = _e["memorial"].strip()
    for _k in ("status", "url", "founded_year", "country", "language", "first_seen_in", "last_checked", "observed_year", "check_cadence"):
        if _e.get(_k) not in (None, ""): _row[_k] = _e[_k]
    if "held_as" in _e or ("url" in _e and _e["url"] is None):
        _fr_set_fields(_row, {_k: _e[_k] for _k in ("status", "held_as", "url") if _k in _e}, _sv)
    if "last_activity" in _e or "site_online" in _e:
        _fr_set_fields(_row, {_k: _e[_k] for _k in ("last_activity", "site_online") if _k in _e}, _sv)
    if _e.get("language_remove"): _row.pop("language", None)
    _cpa = _e.get("community_presence_add")
    if _cpa: _row["community_presence"] = (_row.get("community_presence") or []) + ([_cpa] if not isinstance(_cpa, list) else _cpa)
def _fr_sim():
    """(label, the row before this delta or None for a mint, the row after) for every frontier row the delta writes."""
    _touch = []; _skip = []
    _f0 = _lj.load(open(f"{_MUSEUM}/data/frontier.json", encoding="utf-8"))
    _rows = [dict(_x) for _x in ((_f0.get("rows") if isinstance(_f0, dict) else _f0) or []) if isinstance(_x, dict)]
    _sv = (_f0.get("_status_values") if isinstance(_f0, dict) else None) or []
    _by = {_x.get("name"): _x for _x in _rows}; _held_names = set(_by)
    _np = f"{_WAVE}/delta/data/frontier-new-rows.json"
    if _lo.path.exists(_np):
        _nr = _lj.load(open(_np, encoding="utf-8"))
        _nr = _nr["rows"] if isinstance(_nr, dict) and isinstance(_nr.get("rows"), list) else _nr
        for _r in (_nr if isinstance(_nr, list) else []):
            if not isinstance(_r, dict): continue
            if _r.get("name") in _held_names: _skip.append(_r.get("name")); continue
            _r = {_k: _v for _k, _v in _r.items() if _v is not None}
            _rows.append(_r); _by.setdefault(_r.get("name"), _r)
            _touch.append((f"{_r.get('name')!r} (new row)", None, _r))
    for _f in [_x for _x in _FR_FILES if not _x.endswith("frontier-new-rows.json")]:
        _d = _lj.load(open(_f, encoding="utf-8"))
        _items = _d if isinstance(_d, list) else (_d.get("rows") or _d.get("enrichments") or _d.get("corrections") or [_d])
        for _e in (_items if isinstance(_items, list) else []):
            if not isinstance(_e, dict): continue
            _raw = str(_e.get("target_row") or _e.get("target") or _e.get("name") or "")
            _m = _lre.search(r'name="([^"]+)"', _raw); _tgt = _m.group(1) if _m else _raw.strip()
            _row = _by.get(_tgt)
            if not _row and _tgt:
                _row = next((_x for _x in _rows if str(_x.get("name") or "") == _tgt or str(_x.get("name") or "").startswith(_tgt + " ")), None)
            if not _row: continue   # "frontier target not found": the applier changes no row, so there is none to judge
            _before = dict(_row)
            _fr_apply(_row, _e, _sv)
            _touch.append((f"{_row.get('name')!r} ({_lo.path.basename(_f)})", _before, _row))
    return _touch, _skip
_FR_IDS = _fr_memorial_ids() if _FR_FILES else set()
if _FR_FILES and _FR_R is None:
    _prob("L-FRONTIER-RULE", f"the frontier rules could not be read from scripts/registry-validate.mjs ({_FR_RERR}); the {len(_FR_FILES)} frontier delta file(s) this wave carries cannot be judged, so none passes")
elif _FR_FILES:
    try:
        _fr_touch, _fr_skip = _fr_sim()
        for _lab, _was, _now in _fr_touch:
            _old = set(_fr_check(_was)) if _was is not None else set()
            for _msg in _fr_check(_now):
                if _msg in _old: continue
                _prob("L-FRONTIER-RULE", f"frontier row {_lab}: {_msg} (registry-validate.mjs section 6e, the rule preflight fails the whole museum on)")
        print(f"   L-FRONTIER-RULE: {len(_fr_touch)} frontier row(s) judged post-apply over {len(_FR_FILES)} delta file(s)"
              f"{'; ' + str(len(_fr_skip)) + ' new row(s) already on file (the applier skips them)' if _fr_skip else ''}")
    except Exception as _e:
        _prob("L-FRONTIER-RULE", f"the wave's frontier delta could not be judged ({_e}) — a frontier row the landing check cannot read is one the gate reads first")


# ---- L-FULLNAME (2026-09-20, cycle 152): full_name is a NAME ONLY (2026-08-18 gavel) — a parenthetical descriptor belongs on `qualifier`
for _sf, _r in _mints:
    _fn = _r.get("full_name")
    if isinstance(_fn, str) and "(" in _fn: _prob("L-FULLNAME", f"{_r.get('id')}: full_name {_fn!r} carries a parenthetical — full_name is a name only; put the descriptor on qualifier (registry-validate refuses it)")


# ---- L-KEYS (2026-09-20, cycle 152): registry-validate requires the KEYS id, name, band, visibility on every promotion row (band may be null)
for _sf, _r in _mints:
    for _k in ("id", "name", "type", "band", "visibility"):
        if _k not in _r: _prob("L-KEYS", f"{_r.get('id')}: missing required key {_k!r} (registry-validate refuses it; band may be null, visibility is normally \"gated\")")
    _fy = re.search(r"\d{4}", str((_r.get("founded") or {}).get("date") or "")) if isinstance(_r.get("founded"), dict) else None
    _yy = re.search(r"\d{4}", str(_r.get("years") or ""))
    if _fy and _yy and int(_fy.group(0)) > int(_yy.group(0)): _prob("L-YEARS", f"{_r.get('id')}: founded year {_fy.group(0)} is later than the first year of its years string {_r.get('years')!r} (registry-validate refuses it — a pre-launch announcement observed earlier does not start the span)")


# ---- L-DISCLOSE (2026-09-20, gate 152): the gate SUMS every "N redactions" phrase in a page's provenance text and compares it to
# the markers; a page declares its count exactly once (the <dl> Redactions row). Fourteen pages of one wave carried a prose line too.
_WORDNUM = {"one":1,"two":2,"three":3,"four":4,"five":5,"six":6,"seven":7,"eight":8,"nine":9,"ten":10,"eleven":11,"twelve":12}
for _pg in _lg.glob(f"{_WAVE}/delta/promotions/*/archive/*.html"):
    try: _t = open(_pg, encoding="utf-8", errors="replace").read()
    except Exception: continue
    _mk = len(_lre.findall(r"\[redacted\s*(?:—|&mdash;)|\[(?:name|detail) withheld\]", _t))   # hook c208 (D480): both wordings
    _ms = _lre.findall(r"(?:carries\s+)?\b(?:(\d+)|(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve))\s+redactions?\b", _t, _lre.I)
    _decl = sum(int(a) if a else _WORDNUM.get(b.lower(), 0) for a, b in _ms)
    _none = bool(_lre.search(r"carries no redactions", _t))
    # a page with markers and NO declaration is fine here — the standing provenance-block fixer writes the <dl> at preflight (LANE-TEMPLATE-provenance)
    if len(_ms) > 1 or (len(_ms) == 1 and _decl != _mk and not (_mk == 0 and _none)):
        _prob("L-DISCLOSE", f"{_rel(_pg)}: {_mk} marker(s) but the page declares {_decl} across {len(_ms)} phrase(s) — declare the count once, in the <dl> Redactions row (the gate sums every phrase)")


# ---- L-WITHHELD-COUNT (hook c180, 2026-10-09; the content standard, D206, CURATION v131 #content-standard): a delivered page's
# provenance block declares its cuts ("N passages withheld, marked in place", alone or after "carries M redactions;", hook c152) and the
# page carries exactly N house markers "[withheld &mdash; ...". Nothing compared the two. The phrases are read INSIDE the provenance
# block(s) only (a document's own prose may say anything), summed, and compared with the page's marker count; a page declares it once.
# A page with markers and NO phrase is fine here, as for L-DISCLOSE: the standing provenance-block fixer writes the row at preflight.
for _pg in sorted(_lg.glob(f"{_WAVE}/delta/**/*.html", recursive=True)):
    try: _t = open(_pg, encoding="utf-8", errors="replace").read()
    except Exception: continue
    if "withheld" not in _t: continue
    _wm = len(_lre.findall(r"\[withheld\s*(?:\u2014|&mdash;)", _t))
    _wd = [int(_x) for _b in _lre.finditer(r'<(dl|p) class="muted small provenance"[^>]*>[\s\S]*?</\1>', _t, _lre.I)
           for _x in _lre.findall(r"\b(\d+)\s+passages?\s+withheld\b", _b.group(0), _lre.I)]
    if len(_wd) > 1 or (len(_wd) == 1 and _wd[0] != _wm):
        _prob("L-WITHHELD-COUNT", f"{_rel(_pg)}: {_wm} withheld marker(s) but the provenance block declares {sum(_wd)} passage(s) withheld across {len(_wd)} phrase(s) \u2014 the Redactions row declares the true count, once")


# ---- L-TIER3 (2026-09-20; NAWC, GDWA, WWO were each sent back on it): CURATION #tier-and-storylines — a HELD tier-3 wing that gains served
# cards keeps its label only if those shows are structured (matches + appearances) in this wave; otherwise the wave files tier 3 → 2 with a
# served-voice tier_source. Checked per held wing this wave serves card-class documents for.
try:
    _liveP = {r["id"]: r for r in _lj.load(open(f"{_MUSEUM}/data/promotions.json", encoding="utf-8"))["promotions"]}
    _cards_by_wing = {}
    # (2026-09-27, J38d) a documents-append row whose page is already served is a CORRECTION of that row (the applier replaces it), not a
    # new card: it is not counted (wave-COORD-PAGEFIX-STICK-0927 corrected three already-structured UWF cards' dates)
    _dj = _lj.load(open(f"{_MUSEUM}/data/documents.json", encoding="utf-8")); _dj = _dj if isinstance(_dj, list) else _dj.get("documents", [])
    _livePages = {_d.get("page") for _d in _dj if isinstance(_d, dict)}
    for _f in _lg.glob(f"{_WAVE}/delta/data/documents-append*.json"):
        for _r in _lj.load(open(_f, encoding="utf-8")):
            if isinstance(_r, dict) and _r.get("doc_class") == "card" and _r.get("page") not in _livePages: _cards_by_wing[_r.get("wing")] = _cards_by_wing.get(_r.get("wing"), 0) + 1
    _tier_corr = set()
    _cf = f"{_WAVE}/delta/data/registry-corrections.json"
    if _lo.path.exists(_cf):
        _cs = _lj.load(open(_cf, encoding="utf-8")); _cs = _cs if isinstance(_cs, list) else _cs.get("corrections", [])
        for _c in _cs:
            if isinstance(_c, dict) and _c.get("field") == "tier" and _c.get("new") in (0, 1, 2): _tier_corr.add(_c.get("id") or _c.get("slug"))
    for _w, _n in _cards_by_wing.items():
        _row = _liveP.get(_w)
        if not _row or _row.get("tier") != 3 or _w in _tier_corr: continue
        _structured = 0
        for _sf in _lg.glob(f"{_WAVE}/delta/data/shows-append-{_w}.json") + _lg.glob(f"{_WAVE}/delta/data/shards/{_w}/shows.json"):
            try: _rows = _lj.load(open(_sf, encoding="utf-8")); _rows = _rows.get("shows", _rows) if isinstance(_rows, dict) else _rows
            except Exception: continue
            # (2026-09-22) a PARTIAL show (SCHEMA `partial`: partly held, the rest missing) whose row states why is structured as
            # far as the record goes — PCW's Fusion 96, whose own page is only its opening
            _structured += sum(1 for _s in _rows if isinstance(_s, dict) and (_s.get("matches") or _s.get("appearances")
                               or (_s.get("partial") and (_s.get("no_appearances_reason") or _s.get("notes")))))
        # (2026-09-23, PURE-SHOWS-2002) a held collected:false show UPGRADED in place — shows-corrections-<wing>.json giving it matches or
        # appearances — is a structured show row of this wave too (the corrections route is the house way to upgrade a held row)
        for _sf in _lg.glob(f"{_WAVE}/delta/data/shows-corrections-{_w}.json"):
            try: _cs3 = _lj.load(open(_sf, encoding="utf-8")); _cs3 = _cs3 if isinstance(_cs3, list) else _cs3.get("corrections", [])
            except Exception: continue
            _structured += len({_c.get("id") for _c in _cs3 if isinstance(_c, dict) and _c.get("field") in ("matches", "appearances") and _c.get("new")})
        # (2026-09-23, PURE-SHOWS-2003) a show served as several documents (card + results, a script in parts) carries ONE show row
        # whose evidence[] lists each served part ({source: page, note} — the house shape, e.g. dwo-1996-wrestlekade-x). A card
        # document listed in a wave show row's evidence[] (and not that row's own page) needs no show row of its own.
        _ev_pages = set(); _own_pages = set()
        for _sf in _lg.glob(f"{_WAVE}/delta/data/shows-append-{_w}.json") + _lg.glob(f"{_WAVE}/delta/data/shards/{_w}/shows.json"):
            try: _rows = _lj.load(open(_sf, encoding="utf-8")); _rows = _rows.get("shows", _rows) if isinstance(_rows, dict) else _rows
            except Exception: continue
            for _s in _rows if isinstance(_rows, list) else []:
                if not isinstance(_s, dict): continue
                if _s.get("page"): _own_pages.add(_s["page"])
                for _e in _s.get("evidence") or []:
                    if isinstance(_e, dict) and isinstance(_e.get("source"), str) and _e["source"].startswith("/promotions/"): _ev_pages.add(_e["source"])
        for _sf in _lg.glob(f"{_WAVE}/delta/data/shows-corrections-{_w}.json"):
            try: _cs4 = _lj.load(open(_sf, encoding="utf-8")); _cs4 = _cs4 if isinstance(_cs4, list) else _cs4.get("corrections", [])
            except Exception: continue
            for _c in _cs4:
                if isinstance(_c, dict) and _c.get("field") == "page" and _c.get("new"): _own_pages.add(_c["new"])
                if isinstance(_c, dict) and _c.get("field") == "evidence":
                    for _e in _c.get("new") or []:
                        if isinstance(_e, dict) and isinstance(_e.get("source"), str) and _e["source"].startswith("/promotions/"): _ev_pages.add(_e["source"])
        _n -= sum(1 for _f in _lg.glob(f"{_WAVE}/delta/data/documents-append*.json") for _r in _lj.load(open(_f, encoding="utf-8"))
                  if isinstance(_r, dict) and _r.get("doc_class") == "card" and _r.get("wing") == _w and _r.get("page") in _ev_pages and _r.get("page") not in _own_pages)
        if _structured < _n:
            _prob("L-TIER3", f"{_w}: a tier-3 wing gains {_n} served card(s) but only {_structured} structured show row(s) in this wave — structure them (matches + appearances) or file tier 3 → 2 with a served-voice tier_source (CURATION #tier-and-storylines)")
except Exception as _e: print("L-TIER3 check skipped:", _e)

# ---- L-CARE (2026-09-22; revised the same day by the Janitor's gavel "CARE MEANS COMPLETENESS, NOT HANDS-OFF"): the care
# records — Seymour Almasy, El Terrible and the H.I.T., and the Janitor's own ccw-classic-1996 / nccw-1998 and Lew Spectre —
# are ENRICHED like any record (tenures, dates, appearances, aka added, provenance, identity, new served documents, merges of
# probables). What a lane may NOT do to them: remove (deletes, retirements), rename (name / id / full_name), or rewrite their
# served prose (caption, notes, epitaph, a corrected copy of a live care-wing page). Those fail; every other care touch is
# listed as a CARE-NOTE line so the coordinator reads it and the Janitor's pile can say what changed.
_CARE_WINGS = {"nccw-1998", "ccw-classic-1996"}
_CARE_IDS = {"seymour-almasy", "the-hit", "el-terrible", "uwf-almasy-induction", "lew-spectre", "lew-spectre-nccw-1998", "lew-spectre-rspwf"}
_CARE_PROSE = {"name", "id", "full_name", "caption", "notes", "epitaph", "tier_source", "house_style"}
try:
    if not _lo.path.exists(f"{_WAVE}/CARE-CLEARED"):
        for _cw in _CARE_WINGS:
            for _sf in _lg.glob(f"{_MUSEUM}/data/shards/{_cw}/*.json"):
                try: _CARE_IDS.update(r.get("id") for r in _lj.load(open(_sf, encoding="utf-8")) if isinstance(r, dict) and r.get("id"))
                except Exception: pass
        _CARE_IDS |= _CARE_WINGS
        # (2026-09-22, the Janitor: "PCW's Jay Phoenix is the character of Jay Faulkner in the memorial … I am surprised it wasn't
        # flagged") — every memorial subject's character is a care record; the hand-kept list above predates memorials.json.
        try:
            _mj = _lj.load(open(f"{_MUSEUM}/data/memorials.json", encoding="utf-8"))
            for _mm in (_mj["memorials"] if isinstance(_mj, dict) else _mj):
                if isinstance(_mm, dict): _CARE_IDS.update(c for c in (_mm.get("characters") or []) if isinstance(c, str))
        except Exception: pass
        for _f in _lg.glob(f"{_WAVE}/delta/**/*", recursive=True):
            if not _lo.path.isfile(_f): continue
            _rf = _rel(_f); _b = _lo.path.basename(_f)
            _cw = next((w for w in _CARE_WINGS if f"/promotions/{w}/" in "/" + _rf or f"/epitaphs/{w}." in "/" + _rf), None)
            if _cw:
                _live = f"{_MUSEUM}/" + _rf.split("delta/", 1)[1]
                if f"/epitaphs/{_cw}." in "/" + _rf or _lo.path.exists(_live):
                    _prob("L-CARE", f"{_rf}: rewrites served prose of the care wing {_cw} (an epitaph or a live page) — that stays with the Janitor")
                else: print(f"CARE-NOTE {_rf}: a new document served on the care wing {_cw}")
                continue
            if not (_f.endswith(".json") and "/data/" in _f) or _b.startswith("documents-append"): continue
            try: _rows = _lj.load(open(_f, encoding="utf-8"))
            except Exception: continue
            _rows = _rows if isinstance(_rows, list) else [_rows]
            for _r in _rows:
                if not isinstance(_r, dict): continue
                _rid = _r.get("id") or ((_r.get("record") or {}).get("id") if isinstance(_r.get("record"), dict) else None)
                for _ie in (_r.get("identity") or []) if isinstance(_r.get("identity"), list) else []:
                    _tg = [t for t in ((_ie.get("with") or []) if isinstance(_ie, dict) else []) if t in _CARE_IDS]
                    if _tg: print(f"CARE-NOTE {_rf}: {_rid} files a '{_ie.get('assertion')}' identity edge against the care record(s) {', '.join(_tg)} — the coordinator reads the evidence (a care record's evidence-backed probables merge; a bare shared name gets a distinct guard, never a merge)")
                if _rid not in _CARE_IDS: continue
                if "-delete" in _b or "-retire" in _b:
                    _prob("L-CARE", f"{_rf}: removes from the care record {_rid} — that stays with the Janitor"); continue
                _fld = _r.get("field")
                if _fld in _CARE_PROSE:
                    _prob("L-CARE", f"{_rf}: {_fld} of the care record {_rid} rewritten — renaming or rewriting its prose stays with the Janitor"); continue
                if _fld == "aka" and isinstance(_r.get("old"), list) and not all(x in (_r.get("new") or []) for x in _r["old"]):
                    _prob("L-CARE", f"{_rf}: drops an aka from the care record {_rid}"); continue
                if "-append-" in _b:
                    _prob("L-CARE", f"{_rf}: delivers a second copy of the care record {_rid} — correct it in place instead"); continue
                print(f"CARE-NOTE {_rf}: enriches the care record {_rid} ({_fld or 'row'}) — note it on the Janitor's pile")
except Exception as _e: print("L-CARE check skipped:", _e)

# ---- L-SLUG-NAME (2026-09-22, MLW): a URL path segment spelled from a ledgered real name (an ISP account named for its owner, e.g. isp.example/<initials><surname>) is a
# personal account path, whatever the host — the v74 slug rider. The personal-host pattern above knows a few hosts and the
# first.last shape; this reaches any host by the ledger's own surnames. A fed-branded slug, or one already marked, stands.
# hook c131 (lane D441-APPLY, 2026-10-07): BOTH L-SLUG-NAME reaches YIELD TO THE URL RULING for addresses. The Janitor in chat,
# 2026-10-07 17:33 PDT (GAVELS 2026-10-07): "a URL cannot be private, it is public by definition", with one limit: the museum
# never writes that a named person operates a site (his example's names are left out of this source); D441 (desk send 2026-10-08T05:42Z): "serve the addresses (the URL
# ruling)": a person's own homepage address that spells their full real name run together SERVES; the in-text name redactions
# stay; the v74 slug rider and L-SLUG-NAME yield to it for addresses (GAVELS 2026-10-07). So an address spelling a ledgered
# name is now a SLUG-NAME-NOTE line (information, never a problem), EXCEPT where D439 still withholds it as a contact detail
# (v73): an AOL/AIM screen-name path (the name is also a mailbox), a mailing-list token or a referral account number. Those
# stay an L-SLUG-NAME problem when the address itself shows it: the host and referral patterns are the ones lane
# ADDRESS-RESTORE-2 classed D439's 22 pages by (its build.py B_HOST and referral test). A screen name on any other host is not
# visible from the address's shape; its own ledger row (a contact-detail deny) still holds it at L-PRIV. Neither line prints
# the address: the host and a sha1[:8] of the lowercased address only. The ruling's one limit (never write that a named
# person operates a site) is prose, not an address, and is not judged here.
_C131_LIST_HOST = _lre.compile(r"(?i)\b(aol\.com|aim\.com|topica\.com|egroups\.com|onelist\.com|listbot\.com|yahoogroups\.com)\b")
_C131_REFERRAL = _lre.compile(r"(?i)[?&;](ref|rid|aff|affiliate|referr|id)=")
def _c131_slug_name(_rf, _h, _a, _b, _what):
    import hashlib as _c131_hl
    _stop = " \t\r\n\"'<>()[]{}|\\"
    while _a > 0 and _h[_a - 1] not in _stop: _a -= 1
    while _b < len(_h) and _h[_b] not in _stop: _b += 1
    _tok = _h[_a:_b]
    _hm = _lre.match(r"(?i)(?:[a-z][a-z0-9+.-]*:)?/*([^/\s?#:]+)", _tok)
    _host = (_hm.group(1) if _hm else "?").lower()
    _fp = _c131_hl.sha1(_tok.lower().encode("utf-8")).hexdigest()[:8]
    _kind = ("an AOL/AIM screen-name or mailing-list host" if _C131_LIST_HOST.search(_tok)
             else "a referral-shaped query" if _C131_REFERRAL.search(_tok) else None)
    if _kind:
        _prob("L-SLUG-NAME", f"{_rf}: an address on {_host} (fp {_fp}) {_what} and carries {_kind}: it stays withheld as a contact detail (D439, v73); mark it with the withheld-detail marker")
    else:
        print(f"SLUG-NAME-NOTE {_rf}: an address on {_host} (fp {_fp}) {_what}; it serves (the URL ruling, GAVELS 2026-10-07 17:33 PDT; D441), and no served prose may say the named person operates it")
try:
    _SURN = set(); _SURN_SCOPES = collections.defaultdict(set); _SURN_GLOBAL = set()
    for _lf in [f"{A}/privacy/redaction-ledger.tsv"] + _lg.glob(f"{A}/privacy/ledger-pending/*.tsv"):   # real-name denies only
        try:
            for _l in open(_lf, encoding="utf-8", errors="replace"):
                _c = _l.rstrip("\n").split("\t")
                if len(_c) < 3 or _c[1].strip() != "real-name" or not _c[2].strip().startswith("deny"): continue
                _toks = _lre.findall(r"[a-z]+", _c[0].lower())
                if len(_toks) >= 2 and len(_toks[-1]) >= 5:
                    _sn0 = _toks[-1]; _SURN.add(_sn0)
                    # honour the ledger's own scope column (col 4), exactly as the page checks (L-PRIV/L-PRIVDATA) read it:
                    # a scoped deny is weaker and reaches only its own pages (CURATION #slugs-are-identifiers / v74 slug rider,
                    # LAW-INDEX §2a) — a surname can carry rows with different scopes, so union them and let any global row win.
                    _scs = [s.strip().lstrip("/") for s in (_c[3] if len(_c) > 3 else "").split(",") if s.strip()]
                    if _scs: _SURN_SCOPES[_sn0].update(_scs)
                    else: _SURN_GLOBAL.add(_sn0)
        except Exception: pass
    _SURN -= {"wrestling", "federation", "championship", "alliance", "association", "league", "council", "world", "national",
              "extreme", "international", "entertainment", "productions", "online", "power", "storm", "black", "steel",
              "knight", "hunter", "rider", "master", "savage", "slater", "flair", "young", "james", "thomas", "williams", "johnson", "xtreme", "wrestler", "fantasy", "hardcore",
              "story"}   # 2026-10-01 (FSW-VERIFY): a ledgered surname "Story" read thefsw.com/history ("hi"+"story") as a personal account
    # hook c118 (the Janitor's D429, the repositories go public): one more surname leaves the set, named by its privacy-ledger
    # fingerprint (sha1 of the lowercased term, first 8 hex, as privacy-lookup.py cites a row) so this source spells no ledgered name.
    import hashlib as _c118_hl
    _SURN -= {_n for _n in _SURN if _c118_hl.sha1(_n.encode("utf-8")).hexdigest()[:8] in {"e30bfd0c"}}
    _URL_RE = _lre.compile(r"https?://([A-Za-z0-9.-]+)/~?([A-Za-z0-9._-]{5,40})", _lre.I)
    for _f in _lg.glob(f"{_WAVE}/delta/**/*.html", recursive=True):
        _h = open(_f, encoding="utf-8", errors="replace").read(); _rf = _rel(_f)
        _wing = _rf.split("/")[2] if _rf.startswith("delta/promotions/") else ""
        _page = _rf[len("delta/"):] if _rf.startswith("delta/") else _rf
        for _m in _URL_RE.finditer(_h):
            _seg = _m.group(2); _slug = _lre.sub(r"[^a-z]", "", _seg.lower())
            if "." in _seg and _lre.search(r"\.(s?html?|php|asp|cgi|txt|jpe?g|gif|png)$", _seg, _lre.I): continue   # a file, not an account
            # the personal-account shape: the surname whole, with at most three initials before or after it (initials before or after the surname, e.g. <jq><surname> or <surname><j>)
            _sn = next((n for n in _SURN if _lre.fullmatch(r"[a-z]{0,3}" + n + r"[a-z]{0,3}", _slug)), None)
            if not _sn: continue
            # a deny row scoped to other pages does not reach this one — a tree-wide (unscoped) deny still refuses
            if _sn not in _SURN_GLOBAL and not any(_page.startswith(_s) or _page == _s for _s in _SURN_SCOPES.get(_sn, ())): continue
            if _fed_brand_ok(_m.group(0), _wing): continue
            if _MARKED.search(_h[_m.start():_m.end() + 30]): continue   # hook c208 (D480)
            _c131_slug_name(_rf, _h, _m.start(), _m.end(), "has a path spelled from a ledgered surname")   # hook c131: yields to the URL ruling (D441)
except Exception as _e: print("L-SLUG-NAME check skipped:", _e)
# ---- L-SLUG-NAME, second reach (coordinator, 2026-09-26, EWN-CARTO; scope fix J32 2026-09-27): a ledgered real name run
# together whole (first+last) inside a URL PATH segment (a personal account path, the v74 slug rider), in a served page OR a
# data row. Full names only, 10+ letters squashed. HOST names are NOT checked: the Janitor 2026-09-26, "a domain is similar
# to putting your name in a promotion name; privacy guarding isn't necessary" (GAVELS 2026-09-26). A deny row scoped to
# other pages does not reach this one, honouring the ledger's own scope column exactly as L-PRIV/L-PRIVDATA read it
# above and as privacy-check.mjs's page pass reads it — a tree-wide (unscoped) deny still refuses.
try:
    _FULL = {}; _FULL_SCOPES = collections.defaultdict(set); _FULL_GLOBAL = set()
    for _lf in [f"{A}/privacy/redaction-ledger.tsv"] + _lg.glob(f"{A}/privacy/ledger-pending/*.tsv"):
        try:
            for _l in open(_lf, encoding="utf-8", errors="replace"):
                _c = _l.rstrip("\n").split("\t")
                if len(_c) < 3 or _c[1].strip() != "real-name" or not _c[2].strip().startswith("deny"): continue
                _toks = _lre.findall(r"[a-z]+", _c[0].lower())
                if len(_toks) >= 2 and all(len(x) >= 3 for x in _toks[:2]) and len("".join(_toks)) >= 10:
                    _sq0 = "".join(_toks); _FULL[_sq0] = len(_toks[0])
                    _scs = [s.strip().lstrip("/") for s in (_c[3] if len(_c) > 3 else "").split(",") if s.strip()]
                    if _scs: _FULL_SCOPES[_sq0].update(_scs)
                    else: _FULL_GLOBAL.add(_sq0)
        except Exception: pass
    _U2 = _lre.compile(r"(?:https?://)?(?:www\.)?([A-Za-z0-9-]+)\.(?:com|net|org|info|biz|us|tk|co\.uk)(/[^\s\"'<>)]*)?", _lre.I)
    _srcs = _lg.glob(f"{_WAVE}/delta/**/*.html", recursive=True) + _lg.glob(f"{_WAVE}/delta/data/**/*.json", recursive=True)
    for _f in _srcs:
        _h = open(_f, encoding="utf-8", errors="replace").read(); _rf = _rel(_f)
        # the page(s)/record(s) this URL lands on, read exactly as L-PRIVDATA reads a data row's landing (_data_landing)
        # and as L-PRIV reads a served page's own path — a data file may land on more than one registry file
        if _rf.startswith("delta/data/"): _pages = _data_landing(_rf)
        elif _rf.startswith("delta/"): _pages = [_rf[len("delta/"):]]
        else: _pages = [_rf]
        for _m in _U2.finditer(_h):
            _parts = [s for s in (_m.group(2) or "").split("/") if s]  # path segments only; hosts stand (the Janitor 2026-09-26)
            for _seg in _parts:
                _sq = _lre.sub(r"[^a-z]", "", _seg.lower())
                _hit = next((n for n in _FULL if n in _sq), None)
                if not _hit: continue
                # a deny row scoped to other pages/records does not reach this one; a tree-wide deny still refuses
                if _hit not in _FULL_GLOBAL and not any(_p.startswith(_s) or _p == _s for _p in _pages for _s in _FULL_SCOPES.get(_hit, ())): continue
                _c131_slug_name(_rf, _h, _m.start(), _m.end(), "spells a ledgered full real name run together in its path")   # hook c131: yields to the URL ruling (D441)
except Exception as _e: print("L-SLUG-NAME (second reach) check skipped:", _e)

# ---- L-DUP-DOC (2026-09-22, the 2002 Mid-Year Top 100): one post served twice on ONE wing — two READY packets each built
# their own rspwf page for the same message. Per-wing excerpts of one post (a fed directory excerpted on each fed it lists) are
# the practice and stand; a second whole page on the same wing does not. Against the live registry always; against an unlanded
# sibling only when the sibling was marked READY first (the earlier READY keeps the document, so the pair never holds both).
try:
    def _doc_keys(_rows):
        _o = set()
        for _r in _rows if isinstance(_rows, list) else []:
            if not isinstance(_r, dict): continue
            _pg = _r.get("page") or ""; _wg = _r.get("wing") or (_pg.split("/")[2] if _pg.startswith("/promotions/") else "")
            for _s in _r.get("sources") or []:
                if isinstance(_s, dict) and _s.get("msg_id"): _o.add((_s["msg_id"], _wg, _pg))
        return _o
    _mine_docs = set()
    for _f in _lg.glob(f"{_WAVE}/delta/data/documents-append*.json"):
        try: _mine_docs |= _doc_keys(_lj.load(open(_f, encoding="utf-8")))
        except Exception: pass
    if _mine_docs:
        _my_pages = {k[2] for k in _mine_docs}
        try: _live_docs = _doc_keys(_lj.load(open(f"{_MUSEUM}/data/documents.json", encoding="utf-8")).get("documents", []))
        except Exception: _live_docs = set()
        _idx = {}
        for _k in _live_docs: _idx.setdefault((_k[0], _k[1]), set()).add(("the live registry", _k[2]))
        _my_ready = _lo.path.getmtime(f"{_WAVE}/READY") if _lo.path.exists(f"{_WAVE}/READY") else None
        for _d in _sibs:
            _sr = f"{_d}/READY"
            if not _lo.path.exists(_sr): continue
            if _my_ready is not None and _lo.path.getmtime(_sr) >= _my_ready: continue
            for _f in _lg.glob(f"{_d}/delta/data/documents-append*.json"):
                try:
                    for _k in _doc_keys(_lj.load(open(_f, encoding="utf-8"))): _idx.setdefault((_k[0], _k[1]), set()).add((_lo.path.basename(_d), _k[2]))
                except Exception: pass
        for _mid, _wg, _pg in sorted(_mine_docs):
            for _who, _opg in sorted(_idx.get((_mid, _wg), ())):
                if _opg != _pg and _opg not in _my_pages:
                    _prob("L-DUP-DOC", f"msg_id {_mid} is served on {_pg} and already on {_opg} ({_who}) — one post, one page per wing; drop this copy and cite that page")
except Exception as _e: print("L-DUP-DOC check skipped:", _e)

# ---- L-PNSRC (2026-09-22, preflight 166 on hiwf-entity-e-1998): a provenance_notes record's sources[] uses the RECORD kinds
# validate-provenance-notes knows (newsgroup, wayback, arquivo, geocities-torrent, direct, commoncrawl, unknown). "usenet-post" is the
# PROMOTION sources[] kind and fails the gate when carried into a record. (fix-pn-source-kinds.py repairs it; file it right.)
_PN_KINDS = {"newsgroup", "wayback", "arquivo", "geocities-torrent", "direct", "commoncrawl", "unknown", "forum"}
try:
    def _pn_lists():
        for _f in _lg.glob(f"{_WAVE}/delta/data/promotions-*.json") + [f"{_WAVE}/delta/data/registry-corrections.json"]:
            if not _lo.path.exists(_f): continue
            try: _rows = _lj.load(open(_f, encoding="utf-8"))
            except Exception: continue
            _rows = _rows.get("corrections", _rows.get("promotions", [_rows])) if isinstance(_rows, dict) else _rows
            for _r in _rows if isinstance(_rows, list) else []:
                if not isinstance(_r, dict): continue
                if _r.get("field") == "provenance_notes": yield _r.get("id"), _r.get("new") or []
                elif "provenance_notes" in _r: yield _r.get("id"), _r.get("provenance_notes") or []
    for _wid, _lst in _pn_lists():
        for _k, _rec in enumerate(_lst if isinstance(_lst, list) else []):
            for _s in (_rec.get("sources") or []) if isinstance(_rec, dict) else []:
                if isinstance(_s, dict) and _s.get("kind") not in _PN_KINDS:
                    _prob("L-PNSRC", f"{_wid} provenance_notes[{_k}]: source kind {_s.get('kind')!r} — a record source is {{\"kind\": \"newsgroup\", \"newsgroup\": ..., \"msg_id\": ...}} (\"usenet-post\" belongs only in the promotion's own sources[])")
except Exception as _e: print("L-PNSRC check skipped:", _e)

# ---- L-HOLDER / L-IDGRADE (2026-09-22, preflight 167): a reign carries "holder": [{"id": ...}] (never "champion"/"champions");
# an identity[] grade is one of primary-source | user-attested | presumed (never "asserted"). fix-champion-to-holder.py and
# fix-identity-grades.py repair both in preflight, but file them right.
try:
    for _f in _lg.glob(f"{_WAVE}/delta/data/*.json") + _lg.glob(f"{_WAVE}/delta/data/shards/*/*.json"):
        _b = _lo.path.basename(_f)
        try: _rows = _lj.load(open(_f, encoding="utf-8"))
        except Exception: continue
        for _r in (_rows if isinstance(_rows, list) else []):
            if not isinstance(_r, dict): continue
            if ("reigns" in _b and "-corrections" not in _b and "-delete" not in _b and "-retire" not in _b and _r.get("id")
                    and not isinstance(_r.get("holder"), list)):
                _prob("L-HOLDER", f"{_rel(_f)}: reign {_r.get('id')} has no holder list (use \"holder\": [{{\"id\": ...}}], never champion/champions)")
            for _i in (_r.get("identity") or []) if isinstance(_r.get("identity"), list) else []:
                if isinstance(_i, dict) and _i.get("grade") not in ("primary-source", "user-attested", "presumed"):
                    _prob("L-IDGRADE", f"{_rel(_f)}: {_r.get('id')} identity grade {_i.get('grade')!r} (valid: primary-source | user-attested | presumed)")
except Exception as _e: print("L-HOLDER/L-IDGRADE check skipped:", _e)

# ---- L-TENURE (2026-09-22, preflight 167: packet 67 wrote "promotions": [wing] — dropped as an unknown key, 67 records lost
# their only link to a wing): every NEW character or unit row a wave delivers carries a non-empty tenures[] list.
try:
    for _f in _lg.glob(f"{_WAVE}/delta/data/characters-append-*.json") + _lg.glob(f"{_WAVE}/delta/data/units-append-*.json") \
            + _lg.glob(f"{_WAVE}/delta/data/shards/*/characters.json") + _lg.glob(f"{_WAVE}/delta/data/shards/*/units.json"):
        try: _rows = _lj.load(open(_f, encoding="utf-8"))
        except Exception: continue
        for _r in (_rows if isinstance(_rows, list) else []):
            _wingless = ("/_unassigned/" in _f or _f.endswith("-_unassigned.json")) and "promotions" not in (_r if isinstance(_r, dict) else {})  # hook c181: D407 wingless characters carry no tenure
            if isinstance(_r, dict) and _r.get("id") and not _wingless and not (isinstance(_r.get("tenures"), list) and _r["tenures"]):
                _prob("L-TENURE", f"{_rel(_f)}: {_r.get('id')} has no tenures[] (a 'promotions' list is not the schema — use tenures: [{{promotion, roles, first_seen, last_seen, source}}])")
except Exception as _e: print("L-TENURE check skipped:", _e)

# ---- L-PCPRIV (coordinator, 2026-09-26): page-corrections change LIVE pages, which L-PRIV never sees (it reads delta pages).
# Packet B's D47 handles "Floyd" and "Bombay" were the players' own character billings: page-scoped denies would still hit
# "Brian Floyd" / "Jarred Bombay" on the same pages after the corrections, and red the gate. Simulate: apply this wave's
# page-corrections to the live pages, then look for each of THIS WAVE'S fragment deny terms on the pages its scope reaches.
# hook c50 (2026-10-04): the simulated pages are also read for every global takedown row, spaced or joined (raw text, so a
# name fused into a URL or attribute counts), whether or not the wave carries a fragment: a takedown name left on a page
# the wave corrects reds the gate with no in-character carve-out. Cited by sha1/length, never by the term.
try:
    _pcf = f"{_WAVE}/delta/data/page-corrections.json"; _frf = f"{_WAVE}/privacy-fragment.tsv"
    if _lo.path.exists(_pcf):
        _pcr = _lj.load(open(_pcf, encoding="utf-8")); _after = {}
        for _r in (_pcr if isinstance(_pcr, list) else []):
            _pg = str(_r.get("page", "")).lstrip("/"); _fp = f"{_MUSEUM}/{_pg}"
            if not _lo.path.exists(_fp): continue
            _t = _after.get(_pg) or open(_fp, encoding="utf-8", errors="replace").read()
            if _r.get("old") and _r["old"] in _t: _t = _t.replace(_r["old"], _r.get("new", ""), 1)
            _after[_pg] = _t
        import hashlib as _pchl
        for _term, (_jre, _key) in sorted(_TD_JOIN.items()):
            _pre = _lre.compile(r"(?<![^\W_])" + _lre.escape(_term.lower()) + r"(?![^\W_])")
            for _pg, _t in _after.items():
                _low = _t.lower()
                if _key not in _low: continue
                _form = "joined" if _jre.search(_low) else ("spaced" if _pre.search(_low) else None)
                if _form:
                    _prob("L-PCPRIV", f"{_pg}: after this wave's page-corrections the page still carries a takedown name (ledger sha1:{_pchl.sha1(_term.lower().encode()).hexdigest()[:8]} len {len(_term)}, {_form} form) — the gate will red, with no in-character carve-out (D177 (b)); correct it in this wave (hook c50)")
        for _l in (open(_frf, encoding="utf-8", errors="replace") if _lo.path.exists(_frf) else []):
            _c = _l.rstrip("\n").split("\t")
            if len(_c) < 3 or _c[0].startswith("#") or _c[2].strip() != "deny" or len(_c[0].strip()) < 3: continue
            _term = _c[0].strip(); _scs = [s.strip().lstrip("/") for s in (_c[3] if len(_c) > 3 else "").split(",") if s.strip()]
            for _pg, _t in _after.items():
                if _scs and not any(_pg == s or _pg.startswith(s) for s in _scs): continue
                _plain = _lre.sub(r"<[^>]+>", " ", _t)
                if _lre.search(r"(?i)(?<![\w])" + _lre.escape(_term) + r"(?![\w])", _plain):
                    _prob("L-PCPRIV", f"{_pg}: after this wave's page-corrections the page still carries its own fragment's deny term (len {len(_term)}) — the gate will red. If the term is also an in-fiction billing on that page, redact the contact row in place and file no deny (the aho.htm / D47 ruling, 2026-09-26)")
except Exception as _e: print("L-PCPRIV check skipped:", _e)

# ---- L-MARKER-CANON (coordinator, 2026-09-26; the Janitor D48: "normalize, and enforce normalization moving forward"): a
# served page this wave carries, or a page-correction's NEW text, may use only the canonical marker wordings
# (CURATION #privacy-redaction / v73 / v74 / v88), or a wording the standing fix-redaction-marker-canon.py rewrites
# after landing, or a Janitor-held one. Any other wording is a new variant and fails.
try:
    # hook c208 (the Janitor's D480, 2026-10-09: "(a) plain rename"): the canonical wordings are the TWO that name
    # nothing. The eight older ones are accepted for the transition only -- a wave is built once and lands later, and
    # the standing fix-redaction-marker-rename.py folds its pages at the next preflight. The content standard's own
    # marker is named here too: it is not a privacy redaction and D480 does not rename it, but it IS canonical, and
    # saying so is what lets the span capture widen. THE SPAN CAPTURE IS WIDER THAN IT WAS: it used to read only a
    # bracket beginning "[redacted", so a rogue "[something withheld]" inside a redacted span was invisible to this
    # check; it now reads any bracket carrying "withheld" as well, and a wording that is not one of the three fails.
    _canon = _lre.compile(r"\[(?:name|detail) withheld\]"
                          r"|\[withheld (?:&mdash;|\u2014) a passage held under the museum's content rule\]"
                          r"|\[redacted (?:&mdash;|\u2014) (?:a real name|a contact detail|a bereavement|an illness|a marriage|a family detail|a private-life detail|a private exchange), per the privacy rule\]")
    _mk = _lre.compile(r'class="redacted">(\[(?:redacted\b[^\]]*|[^\]]*\bwithheld\b[^\]]*)\])')
    _kv = _lj.load(open(_lo.path.join(_lo.path.dirname(_lo.path.abspath(__file__)), "d48-known-marker-variants.json"), encoding="utf-8")) \
          if _lo.path.exists(_lo.path.join(_lo.path.dirname(_lo.path.abspath(__file__)), "d48-known-marker-variants.json")) else {"normalised": [], "held": []}
    _known = set(_kv.get("normalised", [])) | set(_kv.get("held", []))
    def _mcheck(_txt, _where):
        for _b in _mk.findall(_txt):
            if not _canon.fullmatch(_b) and _b not in _known:
                _prob("L-MARKER-CANON", f"{_where}: redaction marker {_b[:90]!r} is not a canonical wording (the Janitor D480, 2026-10-09) — use one of the two forms in CURATION #redaction-marker-wordings (D480), or the content standard's own marker")
    # 2026-09-26 (COORD-OOC-BYLINES-2): a marker standing OUTSIDE its span in a delta page's <body> fails too. The reader
    # sees no mark, and fix-redaction-marker-canon.py never reads it. (<title> can't carry markup, so it's exempt.
    # Page-correction fragments are exempt, because their span may sit outside the fragment; the standing
    # fix-bare-redaction-markers.py wraps any that land.)
    _bare = _lre.compile(r'(?<!<span class="redacted">)(\[redacted\s*(?:&mdash;|\u2014)[^\]]{0,160}\]|\[(?:name|detail) withheld\])')   # hook c208 (D480)
    for _f in _lg.glob(f"{_WAVE}/delta/promotions/*/archive/*.html") + _lg.glob(f"{_WAVE}/delta/promotions/*/rp/*.html"):
        _ptxt = open(_f, encoding="utf-8", errors="replace").read()
        _mcheck(_ptxt, _rel(_f))
        _bpos = _ptxt.find("<body")
        for _b in (_bare.findall(_ptxt[_bpos:]) if _bpos >= 0 else []):
            _prob("L-MARKER-CANON", f"{_rel(_f)}: redaction marker {_b[:90]!r} stands outside a <span class=\"redacted\"> — wrap it in the span")
    _pcf2 = f"{_WAVE}/delta/data/page-corrections.json"
    if _lo.path.exists(_pcf2):
        for _r in (_lj.load(open(_pcf2, encoding="utf-8")) or []):
            if isinstance(_r, dict) and isinstance(_r.get("new"), str): _mcheck(_r["new"], f"page-corrections {_r.get('page')}")
except Exception as _e: print("L-MARKER-CANON check skipped:", _e)

# ---- L-LOTCLASH (coordinator, 2026-09-26): a lot id this wave mints that ANOTHER unlanded wave also mints. apply-collections-rows keeps
# the first row it sees, so the second wave's documents would file under the first wave's lot (EWN-DOCS and E2C both took 0166).
try:
    _cr = f"{_WAVE}/delta/data/collections-rows.json"
    if _lo.path.exists(_cr):
        _mine = {r.get("id") for r in (_lj.load(open(_cr, encoding="utf-8")) or []) if isinstance(r, dict)}
        _live = _lj.load(open(f"{_MUSEUM}/data/collections.json", encoding="utf-8"))
        _live = _live if isinstance(_live, list) else (_live.get("collections") or _live.get("lots") or [])
        _liveids = {r.get("id") for r in _live if isinstance(r, dict)}
        _roots = [f"{A}/desk/argyle/waves", f"{A}/fwrestling-census/waves",   # hook c118: under WORKSHOP_ROOT (ops/config.env)
                  f"{A}/usenet-retro", f"{A}/desk"]
        _me = _lo.path.realpath(_WAVE)
        for _root in _roots:
            for _o in _lg.glob(f"{_root}/**/delta/data/collections-rows.json", recursive=True):
                _od = _lo.path.realpath(_lo.path.dirname(_lo.path.dirname(_lo.path.dirname(_o))))
                if _od == _me or _lo.path.exists(f"{_od}/APPLIED"): continue
                try: _theirs = {r.get("id") for r in (_lj.load(open(_o, encoding="utf-8")) or []) if isinstance(r, dict)}
                except Exception: continue
                for _id in sorted((_mine & _theirs) - _liveids):
                    _prob("L-LOTCLASH", f"lot {_id} is also minted by unlanded {_lo.path.basename(_od)} — the first to land keeps it; take the next free id")
except Exception as _e: print("L-LOTCLASH check skipped:", _e)

# ---- L-FRAGROW / L-DELTAFILE (coordinator, 2026-09-26): E3A/E3B wrote their privacy "fragments" as notes tables (statuses
# WITHHELD / CLEAR / a "--" line), which fold-privacy-fragment would have added to the main ledger as non-rows; and E3A put
# a HOLDINGS tsv under delta/promotions/, which apply-delta would have published. The served tree under promotions/ is
# HTML only.
try:
    _ff = f"{_WAVE}/privacy-fragment.tsv"
    if _lo.path.exists(_ff):
        for _n, _l in enumerate(open(_ff, encoding="utf-8", errors="replace"), 1):
            _s = _l.rstrip("\n")
            if not _s.strip() or _s.startswith("#"): continue
            _c = _s.split("\t")
            if len(_c) < 3 or _s.lstrip().startswith("--"):
                _prob("L-FRAGROW", f"privacy-fragment.tsv line {_n}: not a ledger row (comments start with '#'; a row is term<TAB>class<TAB>status<TAB>scope…)"); continue
            if _c[2].strip() not in ("deny", "allow", "watch-note", "flag"):
                _prob("L-FRAGROW", f"privacy-fragment.tsv line {_n}: status {_c[2].strip()[:30]!r} is not deny/allow/watch-note/flag — the fold adds every row to the main ledger; put notes in findings or a '#' comment")
    for _f in _lg.glob(f"{_WAVE}/delta/promotions/**/*", recursive=True):
        if _lo.path.isfile(_f) and not _f.endswith(".html"):
            _prob("L-DELTAFILE", f"{_rel(_f)}: only .html pages belong under delta/promotions/ — apply-delta publishes everything there; workshop files go at the wave root")
except Exception as _e: print("L-FRAGROW/L-DELTAFILE check skipped:", _e)

# ---- L-FRAGSCOPE (hook c97, lane PRIVACY-SCOPE 2026-10-06): the gate (privacy-check.mjs) reads each comma part of a row's scope
# as a PREFIX of the repo-relative path ("promotions/..."). A part written as a site path ("/promotions/...") matches nothing, so
# the row is inert: a scoped deny denies nothing and a scoped allow covers nothing (four page-scoped denies in a wave fragment,
# 2026-10-06; eight such rows sat in the main ledger). Reported by file, line, class, status and part number only.
try:
    _fs_files = [(f"{_WAVE}/privacy-fragment.tsv", "privacy-fragment.tsv")]
    if not (_lo.path.exists(_fs_files[0][0]) and _lo.path.exists(frag) and open(frag, "rb").read() == open(_fs_files[0][0], "rb").read()):
        _fs_files.append((frag, f"ledger-pending {name}.tsv"))   # the mirror, when it is not a byte copy
    for _ff, _lab in _fs_files:
        if not _lo.path.exists(_ff): continue
        for _n, _l in enumerate(open(_ff, encoding="utf-8", errors="replace"), 1):
            _s = _l.rstrip("\n")
            if not _s.strip() or _s.startswith("#"): continue
            _c = _s.split("\t")
            if len(_c) < 4: continue
            _bad = [i for i, _p in enumerate(_c[3].split(","), 1) if _p.strip().startswith("/")]
            if _bad: _prob("L-FRAGSCOPE", f"{_lab} line {_n}: a {(_c[1].strip() or '?')[:30]} {(_c[2].strip() or '?')[:20]} row has scope part(s) {_bad} starting with \"/\" — the gate compares a scope as a prefix of the repo-relative path (\"promotions/...\"), so the row matches nothing; drop the leading slash")
except Exception as _e: print("L-FRAGSCOPE check skipped:", _e)

# ---- L-AKAUNLINK (coordinator, 2026-09-26, preflight 189 red): registry-validate refuses a promotion whose aka_unlinkable
# names an entry its own aka[] does not carry (wave-SITES-B10-PWA minted pwa-primetime with aka_unlinkable ["PWA"] and no "PWA" in aka).
try:
    for _pf in _lg.glob(f"{_WAVE}/delta/data/promotions-rows*.json") + _lg.glob(f"{_WAVE}/delta/data/promotions-append*.json"):
        _pr = _lj.load(open(_pf, encoding="utf-8")); _pr = _pr if isinstance(_pr, list) else (_pr.get("promotions") or [_pr])
        for _r in _pr:
            if not isinstance(_r, dict): continue
            _miss = [a for a in (_r.get("aka_unlinkable") or []) if a not in (_r.get("aka") or [])]
            if _miss: _prob("L-AKAUNLINK", f"{_rel(_pf)}: {_r.get('id')}: aka_unlinkable {_miss} not in its own aka[] — registry-validate refuses it; add them to aka[]")
except Exception as _e: print("L-AKAUNLINK check skipped:", _e)

# ---- L-EPIVOICE (coordinator, 2026-09-26, EPITAPH-T01 review): an Epitaph is the museum's OWN voice (CURATION #privacy:
# real names only in memoriam; a handler only by role description). A ledger real-name or handle DENY (full, multi-word
# form) inside a delta/epitaphs block fails, even where a served document carries the same name under a page allow.
# Names on the memorial register are exempt.
try:
    _epif = _lg.glob(f"{_WAVE}/delta/epitaphs/*.html")
    if _epif:
        _den = set()
        for _lf in [f"{A}/privacy/redaction-ledger.tsv"] + _lg.glob(f"{A}/privacy/ledger-pending/*.tsv"):
            try:
                for _l in open(_lf, encoding="utf-8", errors="replace"):
                    _c = _l.rstrip("\n").split("\t")
                    if len(_c) >= 3 and _c[1].strip() in ("real-name", "handle") and _c[2].strip().startswith("deny") and " " in _c[0].strip() and len(_c[0].strip()) >= 5:
                        _den.add(_c[0].strip())
            except Exception: pass
        try:
            _mm = _lj.load(open(f"{M}/data/memorials.json", encoding="utf-8")); _mm = _mm if isinstance(_mm, list) else _mm.get("memorials", [])
            _memn = {(_m.get("name") or "").strip() for _m in _mm}
        except Exception: _memn = set()
        _den -= _memn
        import html as _eh
        for _f in _epif:
            _tx = _eh.unescape(_lre.sub(r"<[^>]+>", " ", open(_f, encoding="utf-8", errors="replace").read()))
            for _n in _den:
                if _lre.search(r"(?<![\w])" + _lre.escape(_n) + r"(?![\w])", _tx):
                    _prob("L-EPIVOICE", f"{_rel(_f)}: the Epitaph names a person the ledger denies (a real name or handle) in the museum's own voice; use a role description")
except Exception as _e: print("L-EPIVOICE check skipped:", _e)

# ---- L-IDSHAPE (coordinator, 2026-09-26, preflight 190 red): identity is ALWAYS a list of assertion objects. wave-FW-MIRROR-
# E2D-CSWA's characters-corrections set four records' identity to one bare object and registry-validate crashed iterating it.
try:
    for _cf in _lg.glob(f"{_WAVE}/delta/data/*-corrections*.json"):
        _cr = _lj.load(open(_cf, encoding="utf-8"))
        for _r in (_cr if isinstance(_cr, list) else []):
            if isinstance(_r, dict) and _r.get("field") == "identity" and not isinstance(_r.get("new"), list):
                _prob("L-IDSHAPE", f"{_rel(_cf)}: {_r.get('id')}: identity 'new' is a {type(_r.get('new')).__name__}, not a list — write the WHOLE list (old entries plus the new assertion)")
    for _sf in _lg.glob(f"{_WAVE}/delta/data/shards/*/*.json"):
        _sr = _lj.load(open(_sf, encoding="utf-8"))
        for _r in (_sr if isinstance(_sr, list) else []):
            if isinstance(_r, dict) and "identity" in _r and not isinstance(_r["identity"], list):
                _prob("L-IDSHAPE", f"{_rel(_sf)}: {_r.get('id')}: identity is a {type(_r['identity']).__name__}, not a list of assertion objects")
except Exception as _e: print("L-IDSHAPE check skipped:", _e)

# ---- L-UNKNOWN-REF (lane LANDCHECK-UNKNOWN-REFS, 2026-10-02; the Janitor, D225 call 3: "Allow land-check to run the quick
# registry check … so a wave that would turn the next preflight red is caught before it's queued"). Window 237 landed 15 ACW
# shows waves whose appearances and match sides named 392 ids only the four HELD ACW rosters mint; preflight 238 failed with
# 5,218 "references unknown character/unit" lines. Every character/unit id this wave's delta references must be live (a
# characters/units shard row at check time), minted by this wave's own shard files or characters-/units-append files, or an
# alias `from` (data/aliases.json or this wave's aliases-additions.json; repoint-retired rewrites those). The references
# are registry-validate's own: shows appearances[].who, matches[] sides/participants/winner/winners/losers; rps involves and
# references; reigns holder[].id; awards bestowals[].recipient[].id; units members[].character_id/unit_id — in shard
# files, *-append-* rows and *-corrections-* `new` values. One line per (file, id); the window holds the wave until the
# minting wave has landed (window.sh's second pass retries a wave held on this law alone).
import time as _ur_t
_ur_t0 = _ur_t.time()
try:
    _UR_KINDS = ("shows", "rps", "reigns", "awards", "units")
    _ur_known = set()
    for _f in _lg.glob(f"{_MUSEUM}/data/shards/*/characters.json") + _lg.glob(f"{_MUSEUM}/data/shards/*/units.json"):
        try: _rows = _lj.load(open(_f, encoding="utf-8"))
        except Exception: continue
        _ur_known.update(_r["id"] for _r in (_rows if isinstance(_rows, list) else []) if isinstance(_r, dict) and isinstance(_r.get("id"), str))
    for _f in (_lg.glob(f"{_WAVE}/delta/data/shards/*/characters.json") + _lg.glob(f"{_WAVE}/delta/data/shards/*/units.json") +
               _lg.glob(f"{_WAVE}/delta/data/characters-append*.json") + _lg.glob(f"{_WAVE}/delta/data/units-append*.json")):
        try: _rows = _lj.load(open(_f, encoding="utf-8"))
        except Exception: continue
        _ur_known.update(_r["id"] for _r in (_rows if isinstance(_rows, list) else []) if isinstance(_r, dict) and isinstance(_r.get("id"), str))
    for _f in [f"{_MUSEUM}/data/aliases.json"] + _lg.glob(f"{_WAVE}/delta/data/aliases-additions*.json"):
        try: _al = _lj.load(open(_f, encoding="utf-8"))
        except Exception: continue
        _al = _al.get("aliases", []) if isinstance(_al, dict) else _al
        _ur_known.update(_a["from"] for _a in (_al if isinstance(_al, list) else []) if isinstance(_a, dict) and isinstance(_a.get("from"), str))

    def _ur_ids(_v):                       # a bare id, or a list of ids / {id} objects
        if isinstance(_v, str): return [_v]
        if isinstance(_v, dict): return [_v["id"]] if isinstance(_v.get("id"), str) else []
        if isinstance(_v, list): return [_x for _y in _v for _x in _ur_ids(_y)]
        return []

    def _ur_list(_v): return _v if isinstance(_v, list) else []

    def _ur_refs(_kind, _rec):            # (where, id) for every reference a record (or partial record) carries
        _out = []
        if not isinstance(_rec, dict): return _out
        if _kind == "shows":
            for _j, _a in enumerate(_ur_list(_rec.get("appearances"))):
                if isinstance(_a, dict) and isinstance(_a.get("who"), str): _out.append((f"appearances[{_j}].who", _a["who"]))
            for _j, _m in enumerate(_ur_list(_rec.get("matches"))):
                if not isinstance(_m, dict): continue
                for _k in ("sides", "participants", "winner", "winners", "losers"):
                    for _x in _ur_ids(_m.get(_k)): _out.append((f"matches[{_j}].{_k}", _x))
        elif _kind == "rps":
            for _k in ("involves", "references"):
                for _x in _ur_ids(_rec.get(_k)): _out.append((_k, _x))
        elif _kind == "reigns":
            for _x in _ur_ids(_rec.get("holder")): _out.append(("holder", _x))
        elif _kind == "awards":
            for _j, _b in enumerate(_ur_list(_rec.get("bestowals"))):
                if isinstance(_b, dict):
                    for _x in _ur_ids(_b.get("recipient")): _out.append((f"bestowals[{_j}].recipient", _x))
        elif _kind == "units":
            for _j, _mb in enumerate(_ur_list(_rec.get("members"))):
                if isinstance(_mb, dict):
                    for _k in ("character_id", "unit_id"):
                        if isinstance(_mb.get(_k), str) and _mb[_k]: _out.append((f"members[{_j}].{_k}", _mb[_k]))
        return _out

    def _ur_wrap(_field, _new):           # rebuild a partial record from a correction's indexed path, e.g. matches[0].sides
        _toks = _lre.findall(r"[^.\[\]]+|\[\d+\]", str(_field or ""))
        _v = _new
        for _t in reversed(_toks):
            _v = [_v] if _t.startswith("[") else {_t: _v}
        return _v if isinstance(_v, dict) else {}

    _ur_files = []
    for _kind in _UR_KINDS:
        _ur_files += [(_kind, "rows", _f) for _f in _lg.glob(f"{_WAVE}/delta/data/shards/*/{_kind}.json") + _lg.glob(f"{_WAVE}/delta/data/{_kind}-append*.json")]
        _ur_files += [(_kind, "corr", _f) for _f in _lg.glob(f"{_WAVE}/delta/data/{_kind}-corrections*.json")]
    _ur_n = 0
    for _kind, _shape, _f in sorted(set(_ur_files), key=lambda t: t[2]):
        if not _f.endswith(".json"): continue
        try: _rows = _lj.load(open(_f, encoding="utf-8"))
        except Exception: continue          # an unparseable file is reported by L-SHAPE / L-IDSHAPE
        _miss = {}
        for _r in (_rows if isinstance(_rows, list) else []):
            if not isinstance(_r, dict): continue
            _rec = _r if _shape == "rows" else _ur_wrap(_r.get("field"), _r.get("new"))
            for _where, _x in _ur_refs(_kind, _rec):
                if _x not in _ur_known: _miss.setdefault(_x, f"{_r.get('id')}.{_where}" if _shape == "rows" else f"{_r.get('id')} correction {_r.get('field')}")
        for _x, _at in list(_miss.items())[:60]:
            _prob("L-UNKNOWN-REF", f"{_rel(_f)}: references {_x!r} (first at {_at}) — not a live character/unit, not minted by this wave, not an alias `from`; land the wave that mints it first (D225 call 3)")
        if len(_miss) > 60:
            _prob("L-UNKNOWN-REF", f"{_rel(_f)}: … and {len(_miss) - 60} more unknown ids: {', '.join(list(_miss)[60:])}")
        _ur_n += len(_miss)
    print(f"   L-UNKNOWN-REF: {_ur_n} unknown id(s) over {len(_ur_files)} reference file(s), {len(_ur_known)} known ids, {_ur_t.time() - _ur_t0:.2f}s")
except Exception as _e: print("L-UNKNOWN-REF check skipped:", _e)

# ---- L-RPS-UNCLAIMED (hook c223-landcheck-rps-unclaimed, lane LANDCHECK-D407, 2026-10-09; the Janitor's D407). Wave
# CHARFIRST-1999-5 landed an rps row with "involves": [] and no "promotion"; land-check passed it and the next preflight's
# registry-validate (6d3, the character-first roleplay, hook c106) failed: 'no "promotion" and no resolving character/unit in
# "involves" — a roleplay no fed claims is attached to its character(s) by "involves" alone'. Cycle 370 stopped. The same rule
# here, at landing: every rps row this wave adds or replaces (delta/data/shards/*/rps.json and delta/data/rps-append*.json, the
# files apply-delta.py and apply-shard-append.py land; a row identical to its live row lands nothing and is skipped) needs a
# "promotion", or an "involves" string id that L-UNKNOWN-REF above knows (a live character/unit, one this wave mints, or an
# alias `from`). A READY sibling's mint does not count: L-UNKNOWN-REF holds such a wave until the minting wave has landed.
# "involves" not a list, or a "promotion" key holding null/"", fails registry-validate as well and is held here too. Lines cite
# the file and the row id only (never page text, never the involves ids). rps-corrections / rps-enrich are not judged here.
import time as _ru_t
_ru_t0 = _ru_t.time()
try:
    _ru_known = _ur_known                                  # L-UNKNOWN-REF's set; a NameError means it did not run (below)
    def _ru_rows(_d): return _d if isinstance(_d, list) else []   # the appliers land list-shaped files only
    _ru_live = {}
    for _f in _lg.glob(f"{_MUSEUM}/data/shards/*/rps.json"):
        try: _rows = _lj.load(open(_f, encoding="utf-8"))
        except Exception: continue
        for _r in _ru_rows(_rows):
            if isinstance(_r, dict) and isinstance(_r.get("id"), str): _ru_live[_r["id"]] = _r
    _ru_files = sorted(set(_lg.glob(f"{_WAVE}/delta/data/shards/*/rps.json") + _lg.glob(f"{_WAVE}/delta/data/rps-append*.json")))
    _ru_n = {"rows": 0, "same": 0, "bad": 0}
    for _f in _ru_files:
        try: _rows = _lj.load(open(_f, encoding="utf-8"))
        except Exception: continue                          # an unparseable file is reported by L-SHAPE
        _bad = []
        for _j, _r in enumerate(_ru_rows(_rows)):
            if not isinstance(_r, dict): continue
            _rid = _r.get("id") if isinstance(_r.get("id"), str) else f"rows[{_j}]"
            if _rid in _ru_live and _ru_live[_rid] == _r: _ru_n["same"] += 1; continue
            _ru_n["rows"] += 1
            _inv = _r.get("involves")
            if not isinstance(_inv, list):
                _bad.append((_rid, "\"involves\" is not a list")); continue
            if "promotion" in _r:
                if isinstance(_r["promotion"], str) and _r["promotion"]: continue
                _bad.append((_rid, "\"promotion\" is empty")); continue
            if any(isinstance(_x, str) and _x in _ru_known for _x in _inv): continue
            _bad.append((_rid, "no \"promotion\" and " + ("an empty \"involves\"" if not _inv else "no \"involves\" id that is a live character/unit, minted by this wave or an alias `from`")))
        for _rid, _why in _bad[:60]:
            _prob("L-RPS-UNCLAIMED", f"{_rel(_f)}: {_rid}: {_why} — a roleplay no fed claims is attached to its character(s) by \"involves\" alone, and the next preflight's registry-validate fails on it (the Janitor's D407; hook c223). Give it its fed's \"promotion\", or name its character in \"involves\" (land the wave that mints the character first)")
        if len(_bad) > 60:
            _prob("L-RPS-UNCLAIMED", f"{_rel(_f)}: … and {len(_bad) - 60} more unclaimed rps row(s): {', '.join(_x for _x, _ in _bad[60:])}")
        _ru_n["bad"] += len(_bad)
    print(f"   L-RPS-UNCLAIMED: {_ru_n['rows']} rps row(s) judged over {len(_ru_files)} file(s) ({_ru_n['same']} identical to live, skipped), {_ru_n['bad']} unclaimed, {_ru_t.time() - _ru_t0:.2f}s")
except Exception as _e:
    _prob("L-RPS-UNCLAIMED", f"the unclaimed-roleplay check (hook c223) could not run ({type(_e).__name__}); an rps row no fed claims is never judged clean until it runs")
# ---- end L-RPS-UNCLAIMED (hook c223-landcheck-rps-unclaimed)

# ---- L-IDENTITY-TARGET (hook c125, lane LC-IDENTITY-TARGETS, 2026-10-07). registry-validate (identity checks, 4) fails the
# preflight on 'identity assertion "with" references unknown entity', and L-UNKNOWN-REF above reads reference files only
# (shows, rps, reigns, awards, units members), never identity rows. On 10-07 a diary wave (TCW-L03) named a same-name row
# that sat in another, unlanded wave (MAW-L09); the coordinator caught it by hand. The diary builders read unlanded waves'
# ids into their name lookups and several chains land one a window, so the rule is: whichever wave lands second names the
# other. Every identity `with` id this wave carries (its characters/units shard rows and appends, and the `new` values of its
# characters/units corrections to identity, identity[...] or identity[...].with[...]) must resolve to a live character/unit
# (data/shards/*/{characters,units}.json at check time; a shard's top level may be a list or a dict), an id this wave mints,
# or an alias `from` (data/aliases.json or this wave's aliases-additions) whose chain ends at one of those. registry-validate's
# own idIndex takes no alias `from`; the window's fix-identity-unknown-ids.py (B1) resolves an aliased `with` id through
# data/aliases.json before that preflight, and drops any id still unknown, note folded into the record's notes, so the edge is
# lost silently. Promotions, titles and the other entity kinds are not targets here: that fixer drops them too. An unresolved
# target is a problem the window holds; the message names the id and, when another unlanded wave's delta mints it, that wave.
import time as _it_time
_it_t0 = _it_time.time()
try:
    def _it_rows(_d, _kind):              # a shard/append file's rows: a list, or a dict ({kind: [...]}, one list key, or {id: row})
        if isinstance(_d, list): return _d
        if not isinstance(_d, dict): return []
        if isinstance(_d.get(_kind), list): return _d[_kind]
        _ls = [_v for _k, _v in _d.items() if str(_k)[:1] != "_" and isinstance(_v, list)]
        if len(_ls) == 1: return _ls[0]
        return [_v for _v in _d.values() if isinstance(_v, dict) and isinstance(_v.get("id"), str)]
    def _it_ids(_rows): return {_r["id"] for _r in _rows if isinstance(_r, dict) and isinstance(_r.get("id"), str)}
    def _it_with(_e):                     # a string `with` is one id (fix-identity-unknown-ids.py reads it so)
        _w = _e.get("with") if isinstance(_e, dict) else None
        if isinstance(_w, str): return [_w] if _w else []
        return [_x for _x in _w if isinstance(_x, str) and _x] if isinstance(_w, list) else []
    def _it_wrap(_field, _new):           # a correction's indexed path as a partial record: identity[2].with[0] -> {identity: [{with: [x]}]}
        _toks = _lre.findall(r"[^.\[\]]+|\[\d+\]", str(_field or ""))
        _v = _new
        for _t in reversed(_toks): _v = [_v] if _t.startswith("[") else {_t: _v}
        return _v if isinstance(_v, dict) else {}
    _IT_KINDS = ("characters", "units")
    _it_live = set()
    for _kind in _IT_KINDS:
        for _f in _lg.glob(f"{_MUSEUM}/data/shards/*/{_kind}.json"):
            _it_live |= _it_ids(_it_rows(_lj.load(open(_f, encoding="utf-8")), _kind))   # an unreadable live shard stops the check (below)
    _it_mint = set(); _it_refs = []       # (file, source id, assertion, target)
    for _kind in _IT_KINDS:
        for _f in sorted(_lg.glob(f"{_WAVE}/delta/data/shards/*/{_kind}.json") + _lg.glob(f"{_WAVE}/delta/data/{_kind}-append*.json")):
            try: _rows = _it_rows(_lj.load(open(_f, encoding="utf-8")), _kind)
            except Exception: continue      # an unparseable file is reported by L-SHAPE / L-IDSHAPE
            _it_mint |= _it_ids(_rows)
            for _r in _rows:
                if not isinstance(_r, dict) or not isinstance(_r.get("identity"), list): continue
                for _e in _r["identity"]:
                    for _x in _it_with(_e): _it_refs.append((_f, _r.get("id"), _e.get("assertion"), _x))
        for _f in sorted(_lg.glob(f"{_WAVE}/delta/data/{_kind}-corrections*.json")):
            try: _rows = _lj.load(open(_f, encoding="utf-8"))
            except Exception: continue      # reported by the corrections checks
            for _c in (_rows if isinstance(_rows, list) else []):
                if not isinstance(_c, dict) or not str(_c.get("field") or "").startswith("identity") or "new" not in _c: continue
                _p = _it_wrap(_c.get("field"), _c.get("new")).get("identity")
                _p = _p if isinstance(_p, list) else [_p] if isinstance(_p, dict) else []
                for _e in _p:
                    for _x in _it_with(_e): _it_refs.append((_f, _c.get("id"), _e.get("assertion") if isinstance(_e, dict) else None, _x))
    _it_alias = {}
    for _f in [f"{_MUSEUM}/data/aliases.json"] + sorted(_lg.glob(f"{_WAVE}/delta/data/aliases-additions*.json")):
        try: _al = _lj.load(open(_f, encoding="utf-8"))
        except Exception: continue
        _al = _al.get("aliases", []) if isinstance(_al, dict) else _al
        for _a in (_al if isinstance(_al, list) else []):
            if isinstance(_a, dict) and isinstance(_a.get("from"), str) and isinstance(_a.get("to"), str): _it_alias.setdefault(_a["from"], _a["to"])
    _it_known = _it_live | _it_mint
    def _it_ok(_x):
        _seen = set()
        while _x not in _it_known and _x in _it_alias and _x not in _seen: _seen.add(_x); _x = _it_alias[_x]
        return _x in _it_known
    _it_miss = {}
    for _f, _src, _as, _x in _it_refs:
        if not _it_ok(_x): _it_miss.setdefault(_x, []).append((_f, _src, _as))
    _it_where = {}
    if _it_miss:                          # which other unlanded wave mints each unresolved id (read only when one is unresolved)
        _me = _lo.path.realpath(_WAVE)
        _it_dirs = sorted({_lo.path.realpath(_d) for _d in _lg.glob(f"{A}/*/waves/wave-*") + _lg.glob(f"{A}/desk/*/waves/wave-*") +
                           _lg.glob(f"{A}/usenet-retro/scratch-*/wave-*") + _lg.glob(f"{A}/pt-scene/wave-*") + _lg.glob(f"{A}/desk/provenance-clean/wave-*")})
        for _d in _it_dirs:
            if _d == _me or not _lo.path.isdir(f"{_d}/delta") or _lo.path.exists(f"{_d}/APPLIED"): continue
            for _kind in _IT_KINDS:
                for _f in _lg.glob(f"{_d}/delta/data/shards/*/{_kind}.json") + _lg.glob(f"{_d}/delta/data/{_kind}-append*.json"):
                    try: _raw = open(_f, encoding="utf-8").read()
                    except Exception: continue
                    _hit = [_x for _x in _it_miss if f'"{_x}"' in _raw]
                    if not _hit: continue
                    try: _ids = _it_ids(_it_rows(_lj.loads(_raw), _kind))
                    except Exception: continue
                    for _x in _hit:
                        if _x in _ids: _it_where.setdefault(_x, set()).add(f"{_lo.path.basename(_d)} ({'READY' if _lo.path.exists(f'{_d}/READY') else 'held'})")
        try: _it_retired = open(f"{A}/desk/retired-ids.tsv", encoding="utf-8").read()
        except Exception: _it_retired = ""
    for _x, _at in _it_miss.items():
        _f, _src, _as = _at[0]
        _more = f" (and {len(_at) - 1} more row(s) of this wave)" if len(_at) > 1 else ""
        if _x in _it_where:
            _w = "it is minted by unlanded " + ", ".join(sorted(_it_where[_x]))
        else:
            _w = "no unlanded wave under the workshop's wave folders mints it" + (" (it is listed in desk/retired-ids.tsv)" if _lre.search(r"(?m)^" + _lre.escape(_x) + r"\t", _it_retired) else "")
        _prob("L-IDENTITY-TARGET", f"{_rel(_f)}: {_src} identity {_as or '?'} names {_x!r}{_more}, which is not a live character/unit, not minted by this wave and not an alias `from`; {_w}. Whichever wave lands second names the other: this wave must not name {_x!r} until the wave that mints it has landed (rebuild it without the edge, and let the wave landing second carry it, or hold this wave behind that one). Left in, the window's fix-identity-unknown-ids.py drops the id silently, or the next preflight fails on registry-validate's 'identity assertion \"with\" references unknown entity' (hook c125)")
    print(f"   L-IDENTITY-TARGET: {len(_it_refs)} identity target(s) read, {len(_it_miss)} unresolved, {_it_time.time() - _it_t0:.2f}s")
except Exception as _e:
    _prob("L-IDENTITY-TARGET", f"the identity-target check (hook c125) could not run ({_e}); an identity row naming an unlanded id is never judged clean until it runs")
# ---- end L-IDENTITY-TARGET (hook c125)

# ---- L-SIBLING-FIELD (lane SIBLING-FIELD-HOOK, 2026-10-05, D308, hook c65): two READY waves correcting ONE record field.
# Window 256 (coordinator journal 2026-10-05 04:22): wave-FWO-SHOWS-CARE-SEAN replaced seymour-almasy's whole `tenures` while
# wave-COORD-GLOBAL-CARE path-edited tenures[8]; COORD-PARITY-PROBABLES-1005 replaced black-dragons-pure's whole `tenures` while
# OSW-ROSTER appended to it (old=null). Whichever lands second finds its `old` gone ("old no longer matches ... SKIPPED") and its
# wave still stamps APPLIED. Which one lands first is not the waves' choice: window.sh A3 (apply-shard-paths.py) lands every
# wave's PATH rows (tenures[8].note) before A4 (apply-characters-corrections.py) lands any wave's whole-field rows, and within a
# step the waves go in ops_wave_dirs order. The older sibling checks (SIBLING SAME-BASE, L-CORR) key on the exact field string
# and the same `old`, so a whole-field row and a path/append row on the same field never met.
# The rule: every (kind, record id, TOP-LEVEL field) this wave corrects (any delta/data/*-corrections*.json row with id/slug and
# field; "tenures[8].note" -> "tenures"; registry-corrections.json -> kind "registry") is compared with every OTHER wave in the
# window's own wave trees (WAVE_TREES, else ops/config.env's list, under WORKSHOP_ROOT; os.scandir, no recursive walk) that is
# READY and not APPLIED. A shared key is a problem naming both waves and both row shapes unless the two rows are identical
# (same field, old and new). A wave checked from outside the trees (a scratch copy) does not count its own name's wave as a sibling.
# It is symmetric on purpose: at window time BOTH waves are HELD (nothing lands half-way, both HELD lines name the clash);
# resolve by folding the rows into one wave or moving one side to scratch/rebase-* until the other is APPLIED.
try:
    import time as _sf_time
    _sf_t0 = _sf_time.time()
    def _sf_kind(fn):
        return "registry" if fn.startswith("registry-") else fn.split("-corrections", 1)[0]
    def _sf_shape(r):
        _f = r.get("field"); _o = r.get("old")
        _mode = "path edit" if ("." in _f or "[" in _f) else ("append (old=null)" if _o is None else "whole-field")
        _t = ("null" if _o is None else f"list[{len(_o)}]" if isinstance(_o, list) else "dict" if isinstance(_o, dict) else type(_o).__name__)
        return f"{_mode} `{_f}`, old {_t}"
    # SIBLING-PATH-ANCHORS (lane FALSE-ALARMS-1005, 2026-10-05, D308, hook c70): two PATH rows on DISJOINT paths of one field
    # never stale each other. apply-shard-paths.py reads each path row's `old` at its own full path (tenures[8].first_seen),
    # checks its anchor on that element, and never inserts or removes an element (an old=null append lands only at the list's
    # end), so tenures[8].first_seen (anchor gw) and tenures[0].last_seen (anchor uwf) land in either order. c65 paired them and
    # held wave-COORD-GLOBAL-CARE against wave-SEAN-UWF-DATES for a window for nothing. Still a clash: a whole-field row (no
    # path: whole value, or the old=null append) against ANY row on that field, and two path rows on the same path or where one
    # path is a prefix of the other (tenures[8] vs tenures[8].note).
    def _sf_toks(f):
        return [t for t in _lre.split(r"[.\[\]]+", f) if t != ""]
    def _sf_disjoint(fa, fb):
        if not isinstance(fa, str) or not isinstance(fb, str): return False
        if not (("." in fa or "[" in fa) and ("." in fb or "[" in fb)): return False   # a whole-field row clashes with anything
        ta, tb = _sf_toks(fa), _sf_toks(fb); n = min(len(ta), len(tb))
        return ta[:n] != tb[:n]
    # hook c285 (lane LC-ID-GOLDEN, 2026-10-11, board card landcheck-sibling-prints-id): a record id can be built from a person's
    # name (a v117 character minted under a real name has an id that spells it) and the clash line below printed the id to a
    # lane's screen. Never print a ledger term: an id that hits a ledger term is shown by its fingerprint in land-check's house
    # label, "sha1:<fp> len <n>" (_c222_lab, privacy-lookup.py's fp()), beside the field path; an id that hits none prints as
    # before. The test is privacy-lookup.py's own term_in() over the whole ledger (main + ledger-pending, any status), on the id
    # as written and with its - _ . joins read as spaces (an id is a slug of the name). If the tool cannot be imported or the
    # ledger cannot be read (or is empty) the id counts as a hit: fail closed.
    _sf_pl = []
    def _sf_idlab(_rid):
        try:
            if not _sf_pl:
                import importlib.util as _sf_ilu
                _sf_sp = _sf_ilu.spec_from_file_location("_c285_privacy_lookup", f"{_WORKSHOP}/tools/coordinator-2026-09-03/privacy-lookup.py")
                _sf_md = _sf_ilu.module_from_spec(_sf_sp); _sf_sp.loader.exec_module(_sf_md)
                _sf_md.PRIV = f"{_WORKSHOP}/privacy"; _sf_md.MAIN = _lo.path.join(_sf_md.PRIV, "redaction-ledger.tsv")
                _sf_md.PENDING = _lo.path.join(_sf_md.PRIV, "ledger-pending")
                _sf_rows_all = _sf_md.ledger()
                assert _sf_rows_all, "empty ledger"
                _sf_md._GUARD = list(_sf_rows_all); _sf_pl.append(_sf_md)
            _hit = any(_sf_pl[0].term_in(_f) for _f in {_rid, _lre.sub(r"[-_.]+", " ", _rid)})
        except (Exception, SystemExit):
            _hit = True
        return f"(record id {_c222_lab(_rid)})" if _hit else _rid
    def _sf_rows(wd):
        out = {}
        dd = _lo.path.join(wd, "delta", "data")
        try: ents = sorted(e.name for e in _lo.scandir(dd) if e.is_file())
        except OSError: return out
        for fn in ents:
            if "-corrections" not in fn or not fn.endswith(".json"): continue
            try: R = _lj.load(open(_lo.path.join(dd, fn), encoding="utf-8"))
            except Exception: continue          # an unparseable file is reported by L-SHAPE
            R = R.get("corrections", R) if isinstance(R, dict) else R
            for x in (R if isinstance(R, list) else []):
                if not isinstance(x, dict): continue
                rid = x.get("id") or x.get("slug"); fld = x.get("field")
                if not rid or not isinstance(rid, str) or not isinstance(fld, str) or not fld: continue
                out.setdefault((_sf_kind(fn), rid, _lre.split(r"[.\[]", fld, 1)[0]), []).append((fn, x))
        return out
    _sf_mine = _sf_rows(_WAVE)
    _sf_n_sibs = 0; _sf_n_hits = 0
    if _sf_mine:
        _sf_trees = _lo.environ.get("WAVE_TREES")
        if _sf_trees is None:
            try:
                _sf_m = _lre.search(r'WAVE_TREES="\$\{WAVE_TREES:-(.*?)\}"', open(f"{_MUSEUM}/ops/config.env", encoding="utf-8").read(), _lre.S)
                _sf_trees = _sf_m.group(1) if _sf_m else ""
            except Exception: _sf_trees = ""
        _sf_me = _lo.path.realpath(_WAVE); _sf_myname = _lo.path.basename(_sf_me)
        _sf_tdirs = [_lo.path.join(_WORKSHOP, t.strip()) for t in _sf_trees.split("\n") if t.strip()]
        # a copy checked from outside the trees (a lane's scratch rebuild of wave-X) is not wave-X's sibling; a wave checked in
        # place skips only itself (two distinct trees may hold one name: wave-FW-NWL)
        _sf_scratchcopy = _lo.path.dirname(_sf_me) not in {_lo.path.realpath(d) for d in _sf_tdirs}
        _sf_seen = set()
        for _td in _sf_tdirs:
            try: _ents = sorted((e.name, e.path) for e in _lo.scandir(_td) if e.name.startswith("wave-") and e.is_dir())
            except OSError: continue
            for _sn, _sp in _ents:
                _sr = _lo.path.realpath(_sp)
                if _sr == _sf_me or (_sf_scratchcopy and _sn == _sf_myname) or _sr in _sf_seen: continue
                _sf_seen.add(_sr)
                if not _lo.path.exists(_lo.path.join(_sp, "READY")) or _lo.path.exists(_lo.path.join(_sp, "APPLIED")): continue
                _sf_n_sibs += 1
                _theirs = _sf_rows(_sp)
                for _k in sorted(set(_sf_mine) & set(_theirs)):
                    _pairs = [(a, b) for a in _sf_mine[_k] for b in _theirs[_k]
                              if _lj.dumps([a[1].get("field"), a[1].get("old"), a[1].get("new")], sort_keys=True)
                              != _lj.dumps([b[1].get("field"), b[1].get("old"), b[1].get("new")], sort_keys=True)
                              and not _sf_disjoint(a[1].get("field"), b[1].get("field"))]
                    if not _pairs: continue
                    _sf_n_hits += 1
                    _a, _b = _pairs[0]
                    _more = f" (+{len(_pairs) - 1} more row pair(s))" if len(_pairs) > 1 else ""
                    _prob("L-SIBLING-FIELD", f"{_k[0]} {_sf_idlab(_k[1])}.{_k[2]}: this wave's {_a[0]} ({_sf_shape(_a[1])}) and READY unapplied {_sn}'s {_b[0]} ({_sf_shape(_b[1])}) correct the same field{_more} — the window lands one first and the other's `old` no longer matches (skipped, its wave still stamps APPLIED); fold them into one wave, or move this side to scratch/rebase-* until {_sn} is APPLIED")
    print(f"   L-SIBLING-FIELD: {len(_sf_mine)} corrected field(s), {_sf_n_sibs} READY unapplied sibling(s), {_sf_n_hits} clash(es), {_sf_time.time() - _sf_t0:.2f}s")
except Exception as _e: print("L-SIBLING-FIELD check skipped:", _e)

# ---- L-ESSAYS (hook c108, 2026-10-07; CURATION.md v129, #essays-reopened; the Janitor's D142 + D169): a wave's
# delta/data/essays-append*.json lands outside, human-written work on the Essays register through
# scripts/fixers/apply-essays-append.py (window A3). Judged here by the applier's own --check pass, so the row shape lives in
# ONE place (beside registry-validate.mjs's v129 block, the gate's own reading): a linked row is never copied, a served row
# carries its full text, collection and sources, and a row already on file is never changed by an append.
for _es in sorted(glob.glob(f"{_WAVE}/delta/data/essays-append*.json")):
    _es_ap = f"{_MUSEUM}/scripts/fixers/apply-essays-append.py"
    _es_n = _lo.path.basename(_es)
    if not _lo.path.isfile(_es_ap):
        _prob("L-ESSAYS", f"delta/data/{_es_n} needs scripts/fixers/apply-essays-append.py (hook c108), which is not installed")
        continue
    try:
        _es_r = subprocess.run([sys.executable, "-I", _es_ap, _es, "--check"], capture_output=True, text=True, timeout=300,
                               env=dict(_lo.environ, MUSEUM_ROOT=_MUSEUM))
        _es_lines = (_es_r.stdout or "").splitlines()
        _es_p = [_l[len("PROBLEM: "):] for _l in _es_lines if _l.startswith("PROBLEM: ")]
        for _l in _es_p: _prob("L-ESSAYS", f"{_es_n}: {_l}")
        if _es_r.returncode not in (0, 1) or (_es_r.returncode == 1 and not _es_p):
            _es_last = ((_es_r.stderr or _es_r.stdout or "").strip().splitlines() or [""])[-1]
            _prob("L-ESSAYS", f"{_es_n}: the applier's --check refused the file (rc {_es_r.returncode}): {_es_last[:240]}")
        print(f"   L-ESSAYS {_es_n}: " + next((_l for _l in _es_lines if _l.startswith("ESSAYS ")), "no summary line from the applier"))
    except Exception as _e: _prob("L-ESSAYS", f"delta/data/{_es_n} could not be judged ({_e})")

# ---- L-WINGMERGE (hook c104, 2026-10-06; the Janitor's D413): a wave's delta/data/wing-merge.json merges one wing into
# another through scripts/fixers/apply-wing-merge.py (window A3, after the shard and path appliers). Judged here by the
# applier's own --check pass, so the rules live in ONE place: every id, edge and document row the file names exists live, in
# the merged or the surviving wing only (never a third shard, never a contradictory half-move), and the merged wing's shard,
# documents rows and edges hold nothing the file leaves out. The tenure corrections the move needs land in the same window
# (A3, before the merge), so they are not judged here; the applier refuses the wave whole if they have not.
_wm = f"{_WAVE}/delta/data/wing-merge.json"
if _lo.path.isfile(_wm):
    _wm_ap = f"{_MUSEUM}/scripts/fixers/apply-wing-merge.py"
    if not _lo.path.isfile(_wm_ap):
        _prob("L-WINGMERGE", "delta/data/wing-merge.json needs scripts/fixers/apply-wing-merge.py (hook c104), which is not installed")
    else:
        try:
            _wm_r = subprocess.run([sys.executable, "-I", _wm_ap, _WAVE, "--check"], capture_output=True, text=True, timeout=900,
                                   env=dict(_lo.environ, MUSEUM_ROOT=_MUSEUM))
            _wm_lines = (_wm_r.stdout or "").splitlines()
            _wm_p = [_l[len("PROBLEM: "):] for _l in _wm_lines if _l.startswith("PROBLEM: ")]
            for _l in _wm_p: _prob("L-WINGMERGE", _l)
            if _wm_r.returncode not in (0, 1) or (_wm_r.returncode == 1 and not _wm_p):
                _wm_last = ((_wm_r.stderr or _wm_r.stdout or "").strip().splitlines() or [""])[-1]
                _prob("L-WINGMERGE", f"the applier's --check refused the file (rc {_wm_r.returncode}): {_wm_last[:240]}")
            print("   L-WINGMERGE: " + next((_l for _l in _wm_lines if _l.startswith("WING-MERGE ")), "no summary line from the applier"))
        except Exception as _e: _prob("L-WINGMERGE", f"delta/data/wing-merge.json could not be judged ({_e})")

# ---- L-REL-SCHEMA (hook c240-landcheck-relationship-schema, lane LC-SAMEHANDLER, 2026-10-10). Cycle 376 stopped at preflight:
# registry-validate.mjs refused three same-handler edges carrying "detail" (docs/SCHEMA.md: anonymous linkage only) that a
# wave's relationships-append file had landed through apply-relationships-append.py with a clean land-check. This rule holds
# every row of the wave's unapplied delta/data/relationships-append-*.json to the validator's own HARD rules for a
# relationships row: the file's shape; id/a/b/nature/grade/source present and truthy; an id unique in the wave and not used
# by a different live edge (the applier skips it: never lands); a and b in the validator's id namespace, read from the live
# shards/registers and this wave's mints (never data/find-record-index.json, which lags); nature in RELATIONSHIP_NATURES and
# grade in GRADES, both read from registry-validate.mjs (the applier's own source); no "detail" key on a same-handler edge;
# no same-handler edge naming a handling:"communal" entity; no local absolute path. One problem line per violation, naming
# the row id; no detail/source text is printed. An end that is not a character or unit is a note (the applier lands only
# character/unit ends). A file with a .APPLIED marker has landed and is skipped.
import json as _lrs_j, os as _lrs_o, re as _lrs_re, glob as _lrs_g
_lrs_all = sorted(_lrs_g.glob(f"{_WAVE}/delta/data/relationships-append-*.json"))
_lrs_files = [_lrs_f for _lrs_f in _lrs_all if not _lrs_o.path.exists(_lrs_f + ".APPLIED")]
for _lrs_f in _lrs_all:
    if _lrs_f not in _lrs_files: print(f"   L-REL-SCHEMA: delta/data/{_lrs_o.path.basename(_lrs_f)} carries a .APPLIED marker (landed); not judged again")
if _lrs_files:
    _lrs_n0 = len(probs); _lrs_rows_n = 0
    def _lrs_load(_p):
        """A registry file's rows: a list; or {_schema_version, <one list key>}; or one bare object with an id."""
        _d = _lrs_j.load(open(_p, encoding="utf-8"))
        if isinstance(_d, list): return _d
        if isinstance(_d, dict):
            _k = next((k for k in _d if k[:1] != "_" and isinstance(_d[k], list)), None)
            if _k is not None: return _d[_k]
            if isinstance(_d.get("id"), str): return [_d]
        return []
    def _lrs_falsy(_v):   # JS truthiness, as registry-validate's `!r.id || ...` reads it ([] and {} are truthy there)
        return _v is None or _v is False or _v == "" or (isinstance(_v, (int, float)) and not isinstance(_v, bool) and _v == 0)
    _lrs_PS_ABS = _lrs_re.compile(r'(?:(?<![\w./:@~%-])|(?<=\\[nt]))/(?:home|tmp|mnt|var|root|Users)/[^\s";,()<>]*', _lrs_re.A)
    try:
        _lrs_rv = open(f"{_MUSEUM}/scripts/registry-validate.mjs", encoding="utf-8").read()
        _lrs_m1 = _lrs_re.search(r'RELATIONSHIP_NATURES\s*=\s*new Set\(\[([^\]]*)\]', _lrs_rv)
        _lrs_m2 = _lrs_re.search(r'\bconst GRADES\s*=\s*new Set\(\[([^\]]*)\]', _lrs_rv)
        _LRS_NATURES = set(_lrs_re.findall(r'"([^"]+)"', _lrs_m1.group(1))) if _lrs_m1 else set()
        _LRS_GRADES = set(_lrs_re.findall(r'"([^"]+)"', _lrs_m2.group(1))) if _lrs_m2 else set()
        if not _LRS_NATURES or not _LRS_GRADES:
            raise RuntimeError("RELATIONSHIP_NATURES or GRADES could not be read from scripts/registry-validate.mjs")
        # the validator's id namespace (idIndex): live first, then this wave's mints (a wave copy of a live id replaces it)
        _LRS_KIND, _LRS_HANDLING, _lrs_src = {}, {}, []
        for _lrs_k in ("characters", "units", "titles", "shows", "rps"):
            _lrs_sh = sorted(_lrs_g.glob(f"{_MUSEUM}/data/shards/*/{_lrs_k}.json"))
            if not _lrs_sh and _lrs_k in ("characters", "units"): raise RuntimeError(f"no live data/shards/*/{_lrs_k}.json")
            _lrs_src += [(_lrs_k, _lrs_p) for _lrs_p in _lrs_sh]
        for _lrs_k in ("promotions", "memorials", "essays", "external-figures"):
            if _lrs_o.path.isfile(f"{_MUSEUM}/data/{_lrs_k}.json"): _lrs_src.append((_lrs_k, f"{_MUSEUM}/data/{_lrs_k}.json"))
            elif _lrs_k == "promotions": raise RuntimeError("no live data/promotions.json")
        for _lrs_k in ("characters", "units", "titles", "shows", "rps"):
            _lrs_src += [(_lrs_k, _lrs_p) for _lrs_p in sorted(_lrs_g.glob(f"{_WAVE}/delta/data/shards/*/{_lrs_k}.json")) + sorted(_lrs_g.glob(f"{_WAVE}/delta/data/{_lrs_k}-append-*.json"))]
        for _lrs_k, _lrs_pats in (("promotions", ("promotions-row.json", "promotions-rows.json", "promotions-append*.json")),
                                  ("memorials", ("memorials-append*.json",)), ("essays", ("essays-append*.json",)),
                                  ("external-figures", ("external-figures.json", "external-figures-append.json"))):
            for _lrs_pt in _lrs_pats: _lrs_src += [(_lrs_k, _lrs_p) for _lrs_p in sorted(_lrs_g.glob(f"{_WAVE}/delta/data/{_lrs_pt}"))]
        for _lrs_k, _lrs_p in _lrs_src:
            for _lrs_r in _lrs_load(_lrs_p):
                if not isinstance(_lrs_r, dict) or not isinstance(_lrs_r.get("id"), str) or not _lrs_r["id"]: continue
                _LRS_KIND[_lrs_r["id"]] = _lrs_k
                if _lrs_k in ("characters", "units"): _LRS_HANDLING[_lrs_r["id"]] = _lrs_r.get("handling")
        _LRS_LIVE_REL = {}
        if _lrs_o.path.isfile(f"{_MUSEUM}/data/relationships.json"):
            for _lrs_r in _lrs_load(f"{_MUSEUM}/data/relationships.json"):
                if isinstance(_lrs_r, dict) and isinstance(_lrs_r.get("id"), str): _LRS_LIVE_REL.setdefault(_lrs_r["id"], _lrs_r)
    except Exception as _lrs_e:
        _prob("L-REL-SCHEMA", f"the relationship rows of {len(_lrs_files)} file(s) could not be judged ({type(_lrs_e).__name__}: {str(_lrs_e)[:200]}); held until they can be")
        _lrs_files = []
    _lrs_seen = {}
    for _lrs_f in _lrs_files:
        _lrs_fn = _lrs_o.path.basename(_lrs_f)
        try:
            try: _lrs_C = _lrs_j.load(open(_lrs_f, encoding="utf-8"))
            except Exception as _lrs_e:
                _prob("L-REL-SCHEMA", f"delta/data/{_lrs_fn} does not parse ({type(_lrs_e).__name__}); apply-relationships-append.py cannot read it"); continue
            _lrs_rows = _lrs_C.get("relationships") if isinstance(_lrs_C, dict) else _lrs_C
            if not isinstance(_lrs_rows, list):
                _prob("L-REL-SCHEMA", f"delta/data/{_lrs_fn} carries no \"relationships\" list (a list, or {{\"relationships\": [...]}}); the applier lands nothing from it and still marks it applied"); continue
            for _lrs_i, _lrs_r in enumerate(_lrs_rows):
                _lrs_rows_n += 1
                if not isinstance(_lrs_r, dict):
                    _prob("L-REL-SCHEMA", f"{_lrs_fn}[{_lrs_i}]: a relationship row must be an object (the applier stops on this row)"); continue
                _lrs_id = _lrs_r.get("id") if isinstance(_lrs_r.get("id"), str) and _lrs_r.get("id") else f"{_lrs_fn}[{_lrs_i}]"
                _lrs_nat = _lrs_r.get("nature")
                if _lrs_nat == "same-handler" and "detail" in _lrs_r:
                    _prob("L-REL-SCHEMA", f"{_lrs_id}: a same-handler edge carries no \"detail\" (not even an empty one); anonymous linkage only (docs/SCHEMA.md; registry-validate.mjs refuses it)")
                _lrs_miss = [_lrs_k for _lrs_k in ("id", "a", "b", "nature", "grade", "source") if _lrs_falsy(_lrs_r.get(_lrs_k))]
                if _lrs_miss:
                    _prob("L-REL-SCHEMA", f"{_lrs_id}: needs \"id\", \"a\", \"b\", \"nature\", \"grade\" and \"source\"; missing or empty: {', '.join(_lrs_miss)} (registry-validate.mjs)"); continue
                if not isinstance(_lrs_r["id"], str):
                    _prob("L-REL-SCHEMA", f"{_lrs_id}: \"id\" must be a string (the applier and the page builder key edges by it)"); continue
                if _lrs_id in _lrs_seen:
                    _prob("L-REL-SCHEMA", f"{_lrs_id}: the id is used twice in this wave ({_lrs_seen[_lrs_id] if _lrs_seen[_lrs_id] != _lrs_fn else 'both in ' + _lrs_fn}{' and ' + _lrs_fn if _lrs_seen[_lrs_id] != _lrs_fn else ''}); the applier keeps the first, the second edge never lands")
                else: _lrs_seen[_lrs_id] = _lrs_fn
                _lrs_lv = _LRS_LIVE_REL.get(_lrs_id)
                if _lrs_lv is not None:
                    if (_lrs_lv.get("a"), _lrs_lv.get("b"), _lrs_lv.get("nature")) == (_lrs_r.get("a"), _lrs_r.get("b"), _lrs_nat):
                        print(f"   L-REL-SCHEMA: {_lrs_id}: already live with the same ends and nature; the applier skips it")
                    else:
                        _prob("L-REL-SCHEMA", f"{_lrs_id}: the id is already used by a different live edge in data/relationships.json; the applier skips the row, so this edge never lands (give it a new id)")
                for _lrs_end in ("a", "b"):
                    _lrs_v = _lrs_r[_lrs_end]
                    if not isinstance(_lrs_v, str) or _lrs_v not in _LRS_KIND:
                        _prob("L-REL-SCHEMA", f"{_lrs_id}: \"{_lrs_end}\" references unknown entity \"{_lrs_v}\" (neither live nor minted by this wave; registry-validate.mjs)")
                    elif _LRS_KIND[_lrs_v] not in ("characters", "units"):
                        print(f"   note L-REL-SCHEMA: {_lrs_id}: \"{_lrs_end}\" is a {_LRS_KIND[_lrs_v]} record; apply-relationships-append.py lands only character/unit ends, so this row would wait")
                    elif _lrs_nat == "same-handler" and _LRS_HANDLING.get(_lrs_v) == "communal":
                        _prob("L-REL-SCHEMA", f"{_lrs_id}: a same-handler edge names \"{_lrs_v}\", whose handling is \"communal\" (owned by no one hand); the two claims cannot both stand (registry-validate.mjs)")
                if not isinstance(_lrs_nat, str) or _lrs_nat not in _LRS_NATURES:
                    _prob("L-REL-SCHEMA", f"{_lrs_id}: nature \"{_lrs_nat}\" is not one of {'|'.join(sorted(_LRS_NATURES))} (registry-validate.mjs RELATIONSHIP_NATURES)")
                if not isinstance(_lrs_r["grade"], str) or _lrs_r["grade"] not in _LRS_GRADES:
                    _prob("L-REL-SCHEMA", f"{_lrs_id}: grade \"{_lrs_r['grade']}\" is not one of {'|'.join(sorted(_LRS_GRADES))} (registry-validate.mjs GRADES)")
                _lrs_abs = _lrs_PS_ABS.findall(_lrs_j.dumps(_lrs_r, ensure_ascii=False))
                if _lrs_abs:
                    _prob("L-REL-SCHEMA", f"{_lrs_id}: {len(_lrs_abs)} local absolute path(s) in the row; served data never carries one (registry-validate.mjs PATH-SCRUB)")
        except Exception as _lrs_e:
            _prob("L-REL-SCHEMA", f"delta/data/{_lrs_fn} could not be judged ({type(_lrs_e).__name__}: {str(_lrs_e)[:200]}); held until it can be")
    print(f"   L-REL-SCHEMA: {len(_lrs_files)} relationships-append file(s), {_lrs_rows_n} row(s), {len(probs) - _lrs_n0} problem(s)")
# ---- end L-REL-SCHEMA (hook c240-landcheck-relationship-schema)

# ---- L-PAGESWITHDRAW (hook c248, 2026-10-10; GAVELS 2026-10-10, the IWA is living): a wave's delta/data/pages-withdraw.json takes
# served pages off the live site through scripts/fixers/apply-pages-withdraw.py (window A3, after the shard and path appliers
# and the wing merge). Judged here by the applier's own --check pass, so the rules live in ONE place: every page is served now
# (or already withdrawn by the applier), its documents row carries the row's msg_id, no shard record of its wing still cites it
# unless the same wave retires that record, and no page-corrections row of the wave is aimed at it.
_pw = f"{_WAVE}/delta/data/pages-withdraw.json"
if _lo.path.isfile(_pw):
    _pw_ap = f"{_MUSEUM}/scripts/fixers/apply-pages-withdraw.py"
    if not _lo.path.isfile(_pw_ap):
        _prob("L-PAGESWITHDRAW", "delta/data/pages-withdraw.json needs scripts/fixers/apply-pages-withdraw.py (hook c248), which is not installed")
    else:
        try:
            _pw_r = subprocess.run([sys.executable, "-I", _pw_ap, _WAVE, "--check"], capture_output=True, text=True, timeout=900,
                                   env=dict(_lo.environ, MUSEUM_ROOT=_MUSEUM))
            _pw_lines = (_pw_r.stdout or "").splitlines()
            _pw_p = [_l[len("PROBLEM: "):] for _l in _pw_lines if _l.startswith("PROBLEM: ")]
            for _l in _pw_p: _prob("L-PAGESWITHDRAW", _l)
            if _pw_r.returncode not in (0, 1) or (_pw_r.returncode == 1 and not _pw_p):
                _pw_last = ((_pw_r.stderr or _pw_r.stdout or "").strip().splitlines() or [""])[-1]
                _prob("L-PAGESWITHDRAW", f"the applier's --check refused the file (rc {_pw_r.returncode}): {_pw_last[:240]}")
            print("   L-PAGESWITHDRAW: " + next((_l for _l in _pw_lines if _l.startswith("PAGES-WITHDRAW ")), "no summary line from the applier"))
        except Exception as _e: _prob("L-PAGESWITHDRAW", f"delta/data/pages-withdraw.json could not be judged ({_e})")

# ---- SUMMARY ---------------------------------------------------------------
_by_rule = {}
probs_fatal = [p for p in probs if "no declaration found" not in p]
for _p4 in probs_fatal:
    _rid = _p4.split(":", 1)[0].replace("LAW ", "") if _p4.startswith("LAW ") else "L-SHAPE"
    _by_rule[_rid] = _by_rule.get(_rid, 0) + 1
_docs_n = sum(len(_lj.load(open(f, encoding="utf-8"))) for f in _lg.glob(f"{_WAVE}/delta/data/documents-append*.json") if True)
print(f"-- SUMMARY {name}: {len(_mints)} mint(s), {_docs_n} document row(s), {len(hits)} privacy term hit(s), "
      f"{len(probs_fatal)} problem(s)" + (" [" + ", ".join(f"{k}={v}" for k, v in sorted(_by_rule.items(), key=lambda kv: -kv[1])) + "]" if _by_rule else " [clean]"))

# ---- the report ------------------------------------------------------------
# Every failure line carries a rule id. The pre-existing shape/fragment checks
# above predate the ids, so anything unprefixed is reported under LAW L-SHAPE.
print("-- shape/fragment problems:")
_out = [p if p.startswith("LAW ") else ("LAW L-SHAPE: " + p) for p in probs]
[print("   " + p) for p in _out] or print("   none")
import sys as _sys
_fatal = [p for p in probs if "no declaration found" not in p]   # legacy declaration warnings are informational since the structured provenance block (2026-09-13)
print(f"LAND-CHECK: {len(_fatal)} problems")
if _fatal: _sys.exit(1)
