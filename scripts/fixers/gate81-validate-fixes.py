#!/usr/bin/env python3
"""Gate 81 validate classes: served pages with empty hrefs or forum-relative hrefs (/fwc/…, index.php?…) copied from the source
— unwrap the anchor, keeping its text; data-doc-class values outside the v109(a) enum ("site") become "other". Museum pages
under promotions/ + the wave copies. Idempotent; gate-free window only."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import re, glob, subprocess, sys
M = f'{_ROOT}'; A = f'{_WORKSHOP}'
if _live_running("scripts/gate[.]sh", _ROOT): sys.exit("REFUSED: a gate is running")
ENUM = {'card','rp','roster','rules','news','staff','credits','guestbook','board','column','other','machine-translation'}
# empty, forum-relative (/fwc/…, index.php…, showthread.php…, ?…, #…) or any scheme-less, non-rooted href copied from the source.
# (2026-10-05, coordinator) never the chrome's own skip-link (href="#main-content", hook c78): unwrapping it on ~59k pages each
# preflight, only for the gate's chrome step to restore it, cost ~118k page writes a cycle since window 258.
bad = re.compile(r'<a\b(?![^>]*\bclass="skip-link")[^>]*\bhref="(?:|/fwc/[^"]*|index\.php[^"]*|/index\.php[^"]*|\?[^"]*|#[^"]*|(?![a-z]+:|/|mailto:)[^"]+)"[^>]*>(.*?)</a>', re.S)
# forum chrome images with relative src (quote icons, view-post buttons) are not part of the document
badimg = re.compile(r'<img\b[^>]*\bsrc="(?![a-z]+:|/|data:)[^"]*"[^>]*/?>', re.I)
cls = re.compile(r'data-doc-class="([a-z-]+)"')
n = k = 0
for f in glob.glob(f'{M}/promotions/*/*/*.html') + glob.glob(f'{A}/*/waves/wave-*/delta/promotions/*/*/*.html') + glob.glob(f'{A}/usenet-retro/scratch-199*/wave-*/delta/promotions/*/*/*.html'):
    s = open(f, encoding='utf-8', errors='replace').read(); s2, c = bad.subn(r'\1', s); s2, ci = badimg.subn('', s2); c += ci
    def fixcls(m):
        return m.group(0) if m.group(1) in ENUM else 'data-doc-class="other"'
    s3, c2 = cls.subn(fixcls, s2)
    if s3 != s: open(f, 'w', encoding='utf-8').write(s3); n += c; k += (s3 != s2)
print('empty/forum-relative anchors unwrapped:', n, '| doc-class values normalised on pages:', k)
