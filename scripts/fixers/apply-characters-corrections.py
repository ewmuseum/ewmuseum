#!/usr/bin/env python3
"""Apply a wave's delta/data/characters-corrections-*.json rows ({id, field, old, new}) to the museum shards.
tenures with old=null → append the new tenure(s) to the record (never at tenures[0]; the home wing stays first);
other fields → set when the current value equals `old`. Only records found by id are touched. Idempotent.
Usage: apply-characters-corrections.py <wave dir>… (skips waves without an APPLIED marker)."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,glob,sys,os
M=f'{_ROOT}/data/shards'
for W in sys.argv[1:]:
    if not os.path.exists(os.path.join(W,'APPLIED')): print(os.path.basename(W.rstrip('/')),'not applied yet, skipped'); continue
    # 2026-10-05 (lane FALSE-ALARMS-1005, hook c71; D308): window A4 re-runs this applier over every wave touched in three days
    # and keeps only its LAST line (window.sh: `| tail -1`). A row whose live value already EQUALS its `new` (it landed in an
    # earlier window) printed "old no longer matches ... SKIPPED" — 78 such lines in window 256, every one a rerun — and a
    # true skip printed before a later "updated" line was never seen at all. Now: live == new is counted "already applied"
    # (no line of its own); a true skip still prints its own SKIPPED line; and every wave ends with ONE summary line naming
    # each true skip and each id not found, so tail -1 always carries them. Shards are written exactly as before.
    _already=0; _skipped=[]; _missing=[]
    for cf in sorted(glob.glob(os.path.join(W,'delta/data/characters-corrections-*.json'))+glob.glob(os.path.join(W,'delta/data/titles-corrections-*.json'))+glob.glob(os.path.join(W,'delta/data/awards-corrections-*.json'))+glob.glob(os.path.join(W,'delta/data/units-corrections-*.json'))+glob.glob(os.path.join(W,'delta/data/reigns-corrections-*.json'))+glob.glob(os.path.join(W,'delta/data/shows-corrections-*.json'))+glob.glob(os.path.join(W,'delta/data/rps-corrections-*.json'))):
        kind=os.path.basename(cf).split('-corrections-')[0]
        rows=json.load(open(cf,encoding='utf-8')); want={}
        for r in rows:
            if isinstance(r,dict) and r.get('id'): want.setdefault(r['id'],[]).append(r)  # 2026-09-12: several corrections per id
        done=set()
        for sf in glob.glob(f'{M}/*/{kind}.json'):
            C=json.load(open(sf,encoding='utf-8')); ch=False
            for c in C:
                if not isinstance(c,dict) or c.get('id') not in want or c['id'] in done: continue
                for r in want[c['id']]:
                    fld=r.get('field')
                    if fld and ('[' in fld or '.' in fld): continue  # 2026-09-26: path fields belong to apply-shard-paths.py (an old=null new slot would otherwise become a literal key)
                    if fld=='tenures' and not r.get('old'):
                        have={t.get('promotion') for t in (c.get('tenures') or []) if isinstance(t,dict)}
                        newv=r.get('new') or []
                        if isinstance(newv,dict): newv=[newv]  # 2026-09-12: lanes file a single tenure object as often as a list
                        # 2026-09-22 (GLCW 2002: tommy-james-glcw, dj-willis-glcw): a SECOND stint for a wing the record already
                        # holds (1999, then 2002) was dropped silently by the promotion-only test. A tenure is new when no live
                        # tenure of the same wing starts on the same first_seen; identical rows are never re-added (idempotent).
                        cur=c.get('tenures') or []
                        add=[t for t in newv if isinstance(t,dict) and t not in cur
                             and (t.get('promotion') not in have
                                  or not any(isinstance(x,dict) and x.get('promotion')==t.get('promotion') and x.get('first_seen')==t.get('first_seen') for x in cur))]
                        if add: c['tenures']=(c.get('tenures') or [])+add; ch=True
                    elif fld=='tenures' and c.get(fld)==r.get('old') and isinstance(r.get('new'),list):
                        # 2026-09-22 (MPW, preflight 166): a correction that puts another wing's tenure FIRST moves the record's
                        # shard (shardOf reads tenures[0]) — kendall-trapp-awp and two IGA wrestlers ended in two shards at once.
                        # The home wing stays first; the rest keep the correction's order.
                        home=((c.get('tenures') or [{}])[0] or {}).get('promotion') if c.get('tenures') else None
                        newv=list(r['new'])
                        # 2026-10-03 (GTT-PASS2-LANDPREP, hook c27; D244 same-id re-homes): a row carrying "home": <wing> whose new
                        # tenures[0] IS that wing is a ruled re-home under the same id; its order stands, and fix-shard-assignment
                        # (ORDER.txt) moves the record. Without the key the home wing stays first, as before.
                        if r.get('home') and newv and isinstance(newv[0],dict) and newv[0].get('promotion')==r.get('home'):
                            print(c['id'],'tenures: re-homed to',r['home'],'(the row\'s own "home")'); home=r['home']
                        if home and newv and isinstance(newv[0],dict) and newv[0].get('promotion')!=home:
                            newv=[t for t in newv if isinstance(t,dict) and t.get('promotion')==home]+[t for t in newv if not (isinstance(t,dict) and t.get('promotion')==home)]
                            print(c['id'],'tenures: home wing',home,'kept first')
                        c[fld]=newv; ch=True
                    elif fld and c.get(fld)==r.get('old'): c[fld]=r.get('new'); ch=True
                    elif fld=='tenures' and isinstance(r.get('old'),list) and isinstance(r.get('new'),list) and all(
                            t in r['new'] or (isinstance(t,dict) and any(isinstance(n,dict) and n.get('promotion')==t.get('promotion') and n.get('first_seen')==t.get('first_seen') for n in r['new']))
                            for t in r['old']):   # 2026-09-22: an old stint the correction only widens still counts as kept
                        # 2026-09-21 (HKW + PAW on jake-morgan-30mc-2001): two sibling waves each filed old=<live tenures>,
                        # new=old+<own tenure>. The first landed; the second's old no longer matched and its tenure was
                        # silently dropped. A correction that only ADDS tenures merges onto whatever base it now finds.
                        have={t.get('promotion') for t in (c.get('tenures') or []) if isinstance(t,dict)}
                        cur_t=c.get('tenures') or []
                        # 2026-09-22 (IGA 2002: carl-blair, matt-allen): a tenure that only WIDENS a live stint (same wing, same
                        # first_seen; a later last_seen, a longer source) is updated in place — never added as a second stint.
                        widened=[]
                        for t in r['new']:
                            if not isinstance(t,dict) or t in r['old'] or t in cur_t: continue
                            x=next((x for x in cur_t if isinstance(x,dict) and x.get('promotion')==t.get('promotion') and x.get('first_seen')==t.get('first_seen')),None)
                            if x is not None: x.update(t); widened.append(t); ch=True
                        if widened: print(c['id'],'tenures widened in place:',[t.get('promotion') for t in widened])
                        # a new tenure for a wing the record lacks, or a SECOND stint for a wing it already holds (VWF 2001 + 2003)
                        add=[t for t in r['new'] if isinstance(t,dict) and t not in r['old'] and t not in cur_t and t not in widened
                             and (t.get('promotion') not in have or t.get('promotion') in {o.get('promotion') for o in r['old'] if isinstance(o,dict)})]
                        if add: c['tenures']=(c.get('tenures') or [])+add; ch=True; print(c['id'],'tenures merged onto a moved base:',[t.get('promotion') for t in add])
                    elif fld and c.get(fld)==r.get('new'): _already+=1   # landed before: the live value IS the row's new
                    elif fld: print(c['id'],fld,': old no longer matches the live value — SKIPPED (re-derive from the live record)'); _skipped.append(f"{c['id']} {fld}")
                done.add(c['id'])
            if ch:
                # 2026-09-29 (GCW-NAMELESS-0929 MACHINERY 1): keep the shard's OWN indent (shards are 1, 2 or 4; a hardcoded 1
                # reflowed a whole indent-2 GCW shard, 25,010 diff lines). _keep_indent
                import re as _re
                _m=_re.match(r"\[\s*\n( +)[{\[\"]",open(sf,encoding='utf-8').read(64)); _ind=len(_m.group(1)) if _m else 1
                json.dump(C,open(sf,'w',encoding='utf-8'),ensure_ascii=False,indent=_ind); open(sf,'a').write('\n'); print(os.path.basename(cf),'->',sf.split('/')[-2],'updated')
        miss=set(want)-done
        if miss: print(os.path.basename(cf),'ids not found:',sorted(miss)); _missing+=[f"{os.path.basename(cf)}: {i}" for i in sorted(miss)]
    if _already or _skipped or _missing:
        _s=f"apply-characters-corrections {os.path.basename(W.rstrip('/'))}: {_already} row(s) already applied"
        if _skipped: _s+=f"; {len(_skipped)} SKIPPED, old no longer matches the live value (re-derive from the live record): "+"; ".join(_skipped)
        if _missing: _s+=f"; {len(_missing)} id(s) not found: "+"; ".join(_missing)
        print(_s)
