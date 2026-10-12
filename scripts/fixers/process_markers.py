"""Shared: process-text markers that never belong in a served field (the Janitor 2026-09-05: accessions smuggle workshop narration into any free-text slot).
PROCESS      — for prose fields (caption, house_style, tagline, epitaph): reasoning and museum-machinery talk.
NAME_PROCESS — for name-shaped fields (name, full_name, qualifier, affiliation labels, frontier names): the same plus the " -- " note joiner, which in a name is always a smuggled note (in prose it is just a dash)."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import re
_P=r"(?:\bfindings\.md\b|\bdigests?/[\w-]+\.md\b|\bscratch-\d{4}\b|\bledger-pending\b|\bwave-[A-Z0-9-]+\b)|"+r"distinct from|see provenance|provenance_notes|do-not-merge|operator signing|run by an operator|signing as|\bmember federation\b|the museum|this collection|this wing|frontier row|the frontier|(?-i:\blane\b)|wave-|\bledger\b|\bCOORDINATOR\b|\baccession|\bredact|rule code|\bv\d{2,3}\b|held here|held ones|its own wing, id"
PROCESS=re.compile(_P,re.I)
NAME_PROCESS=re.compile(_P+r"|-- ",re.I)
