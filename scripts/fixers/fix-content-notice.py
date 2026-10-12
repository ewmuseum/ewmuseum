#!/usr/bin/env python3
"""Standing window fixer (the Janitor 2026-09-12: the content notice must be centrally managed). Every served document under
museum/promotions/*/archive and */rp carries one <div class="archival-notice">…</div> block; this rewrites each block from
museum/scripts/templates/content-notice.tpl, keeping only a per-page language clause (", in its original Polish") captured
from the existing block. A block marked data-notice="custom" is left alone. Pages with no block get one inserted after the
document head (<div class="doc-head">…</div>) when that head exists; otherwise they are reported. --dry counts only."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import re,glob,sys,subprocess
M=f'{_ROOT}'; dry='--dry' in sys.argv
if not dry and _live_running("scripts/gate[.]sh|registry-validate|cross-reference[.]mjs|privacy-check", _ROOT): sys.exit("REFUSED: a gate or build is running")
tpl=open(f'{M}/scripts/templates/content-notice.tpl',encoding='utf-8').read().strip()
# hook c185 (the Janitor's D466, 2026-10-09; finding C03 of the adversarial review): A PAGE THAT WITHHOLDS SOMETHING SAYS SO IN
# ITS OWN NOTICE. "served unedited" was false on 11,404 of 64,938 served pages -- the ones carrying a redaction marker -- and
# the only honest word about it sat thousands of words below, in the provenance block's "carries N redactions". A page with a
# marker takes the second template ("served as recovered; withheld details are marked"); a page with none keeps the first,
# word for word. Same central management, two templates.
tpl_red=open(f'{M}/scripts/templates/content-notice-redacted.tpl',encoding='utf-8').read().strip()
HAS_MARKER=re.compile(r'<span class="redacted">')
BLOCK=re.compile(r'<div class="archival-notice"(?P<attrs>[^>]*)>(?P<body>.*?)</div>',re.S)
LANG=re.compile(r'served unedited(?P<lang>, in its original [A-Z][a-z]+)?')
rewritten=inserted=custom=same=noplace=0; report=[]
# hook c184 (the Janitor's D466, 2026-10-09; finding C01 of the adversarial review): A MEMORIAL DOCUMENT CARRIES NO CONTENT
# NOTICE. The dedicatee's own death announcement opened under the site-wide warning that the document may be "crude, dated, or
# offensive" -- boilerplate that sits on 64,938 pages and that nobody chose for a condolence repost. In its place, one quiet
# line. Centrally managed here, beside the notice it replaces, so the next memorial document to serve gets the line and never
# the notice: an archival-notice block under memorials/*/ becomes the line, and a memorial document with no block gets it after
# its doc-head. The memorial PAGES themselves (memorials/*.html, one level up) are not documents and are not touched.
MEMORIAL_LINE='<p class="muted small">Recovered and served whole.</p>'
mem_set=mem_same=mem_noplace=0; mem_report=[]
for f in sorted(glob.glob(f'{M}/memorials/*/*.html')):
    s=open(f,encoding='utf-8',errors='replace').read(); m=BLOCK.search(s)
    if m:
        if not dry: open(f,'w',encoding='utf-8').write(s[:m.start()]+MEMORIAL_LINE+s[m.end():])
        mem_set+=1; continue
    if MEMORIAL_LINE in s: mem_same+=1; continue
    h=re.search(r'<div class="doc-head">.*?</div>\s*',s,re.S)
    if h:
        if not dry: open(f,'w',encoding='utf-8').write(s[:h.end()]+'\n  '+MEMORIAL_LINE+'\n'+s[h.end():])
        mem_set+=1
    else: mem_noplace+=1; mem_report.append(f.replace(M+'/',''))
print(f'fix-content-notice: memorial documents: {mem_set} given the quiet line | {mem_same} already quiet | {mem_noplace} with no place to put it'+(' (dry)' if dry else ''))
if mem_report: print('  memorial, unplaced:', ', '.join(mem_report[:10]), '...' if len(mem_report)>10 else '')
for f in glob.glob(f'{M}/promotions/*/archive/*.html')+glob.glob(f'{M}/promotions/*/rp/*.html'):
    s=open(f,encoding='utf-8',errors='replace').read(); m=BLOCK.search(s)
    if m:
        body=re.sub(r'^\s*<span class="flag">Content notice</span>','',m.group('body'))
        # hook c185: either wording is canonical, so this fixer stays idempotent over both templates
        std=re.match(r'A period document, served (?:unedited|as recovered)(, in its original [A-Z][a-z]+)?(?:; withheld details are marked)?\. It carries the humor, language, and content typical of its era and community',body)
        if 'data-notice="custom"' in m.group('attrs') or not std: custom+=1; report.append('custom: '+f.replace(M+'/','')); continue
        lang=std.group(1) or ''
        new=(tpl_red if HAS_MARKER.search(s) else tpl).replace('{{LANGUAGE}}',lang)   # hook c185
        if m.group(0)==new: same+=1; continue
        if not dry: open(f,'w',encoding='utf-8').write(s[:m.start()]+new+s[m.end():])
        rewritten+=1
    else:
        h=re.search(r'<div class="doc-head">.*?</div>\s*',s,re.S)
        if h:
            new=(tpl_red if HAS_MARKER.search(s) else tpl).replace('{{LANGUAGE}}','')   # hook c185
            if not dry: open(f,'w',encoding='utf-8').write(s[:h.end()]+'\n  '+new+'\n'+s[h.end():])
            inserted+=1
        else: noplace+=1; report.append(f.replace(M+'/',''))
print(f'fix-content-notice: rewritten {rewritten} | inserted {inserted} | already canonical {same} | custom kept {custom} | no place to insert {noplace}'+(' (dry)' if dry else ''))
if report: print('  kept/unplaced:', ', '.join(report[:10]), '…' if len(report)>10 else '')
