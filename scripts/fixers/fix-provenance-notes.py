#!/usr/bin/env python3
"""Standing preflight fixer (the Janitor gavel 2026-09-13): convert any legacy {claim, evidence, grade} provenance note in
museum/data/promotions.json into a typed claim record, writing the narrative to the workshop's provenance narrative <wing>.md.
Idempotent (typed records are a no-op); deterministic. Wraps convert-provenance-notes.py with the standing arguments."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import subprocess,sys,os,datetime
T=os.path.dirname(os.path.abspath(__file__)); M=f'{_ROOT}'
r=subprocess.run([sys.executable,os.path.join(T,'convert-provenance-notes.py'),'--input',M+'/data/promotions.json','--output',M+'/data/promotions.json',
   '--notes-dir',f'{_WORKSHOP}/desk/provenance-narrative','--museum-root',M,'--as-of',datetime.date.today().isoformat()],capture_output=True,text=True)
out=(r.stdout+r.stderr).strip().split('\n'); print('fix-provenance-notes:', ' | '.join(l.strip() for l in out[-3:] if l.strip())[:300]); sys.exit(r.returncode)
