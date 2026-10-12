#!/usr/bin/env python3
"""Redact exactly what a gate log flagged: for every 'PRIVACY-FAIL: ledger term in tree {... ledger-row N class=C len=K ...}: <file>:<line>:' line,
take the ledger's row N (verifying the term length), and redact that term ON THAT EXACT LINE with the museum marker. Data files
(frontier/promotions/wanted) are handed to the registry scrub instead. Scoped-term lines ('scoped ledger term ... in <file>:<line>')
are redacted the same way. argv: <gate log>. Idempotent; gate-free window only.

CONTEXT-FIRST PRIVACY (PRIVACY-CONTEXT-01, 2026-09-13; the Janitor ruling of the same date, LANE-RULES.md rule 6): privacy-check.mjs
now reports two DIFFERENT kinds of ledger hit, and this handler treats them differently:

  - 'PRIVACY-FAIL: ...' lines (unchanged from before on any non-card/roleplay/rp page; on a card/roleplay/rp page these are ONLY
    the hits privacy-check.mjs found INSIDE an out-of-character structure -- see museum/scripts/ooc-structures.mjs) are
    redacted, and logged to the auto-redactions.tsv review queue with review=unreviewed, same as today.
  - 'PRIVACY-INFO: in-character use of a ledgered name ...' lines (a card/roleplay/rp hit OUTSIDE an out-of-character
    structure -- a wrestler billing, an on-screen persona, a signing target named in dialogue) are NEVER redacted: the
    the Janitor's rule is that in-character use of a name serves even when the same name is denied elsewhere, and only a human
    reader can confirm that call, not this handler. Every such occurrence is instead appended to the SAME review queue with
    review=in-character-candidate, so a human can file a page-scoped ALLOW row (or, on review, discover it actually was an
    out-of-character use the gate mis-scanned, and re-run the gate to redact it).

REDACTION IS NOW PER LINE, NOT PER FILE -- the single most important change this patch makes to the OLD script's own
behavior, and load-bearing for the context rule to mean anything at all: the old script resolved a (file, term) pair from
the gate log and then ran ONE regex substitution across the WHOLE FILE, redacting every occurrence of that term wherever it
sat. That was safe only because every occurrence in a flagged file used to be equally guilty (the pre-context-rule gate
never distinguished a byline from a wrestler billing). Under the context rule a single file can legitimately carry BOTH an
out-of-character occurrence (a 'Written by: <name>' credit -- must redact) and several in-character occurrences of the
EXACT SAME STRING two lines later (a wrestler's own on-screen billing, or a dialogue mention -- must never redact): this
lane's own synthetic fixture test caught the old whole-file-substitution code doing exactly that -- redacting three
in-fiction lines it was never told to touch, immediately below the one credit line the gate actually flagged. So every
FAIL/INFO line's own reported line number is now carried through and the substitution is applied to THAT LINE ONLY,
leaving every other line -- including other occurrences of the identical term elsewhere in the same file -- untouched
unless the gate log separately flagged that line too. The gate's own global-scan report cap (kept.slice-equivalent, still
40 per privacy-check.mjs run) is unchanged and pre-existing: a file with more than 40 flagged hits across an entire gate
run needs a second gate/redact cycle to clear the rest, exactly as the tool already required before this lane (it was
never a single-pass tool; "Idempotent; gate-free window only" says as much in its own docstring).

REDACTORS NEVER WRITE INTO MARKUP (hook c80, 2026-10-05; gate 258): on the flagged line, a match that sits inside a tag (its name,
attributes or attribute values) or inside a stamped chrome region (scripts/ops/markup_scope.py) is never replaced. It is printed as
"<file>:<line>: in markup|in chrome: not redacted — the generator must change", counted on the summary line of the same words, and
left alone, so the red stops visibly instead of corrupting the page. Matches in text between tags outside the chrome are redacted
exactly as before."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import re, sys, csv, subprocess, os, datetime
sys.path.insert(0, _TOOLS); from markup_scope import scope_mask, span_kind, KIND_NAME, TEXT   # hook c80
A = f'{_WORKSHOP}'; M = f'{_ROOT}'
QUEUE = f'{_WORKSHOP}/desk/auto-redactions.tsv'   # review queue: workshop state, never repo content
if _live_running("scripts/gate[.]sh", _ROOT): sys.exit("REFUSED: a gate is running")
L = list(csv.reader(open(f'{A}/privacy/redaction-ledger.tsv', encoding='utf-8'), delimiter='\t'))
def term_for(n, k, f=None):
    cands = [L[c] for c in (n - 1, n, n + 1) if 0 <= c < len(L) and L[c] and len(L[c][0]) == k and not L[c][0].startswith('#')]
    if f and os.path.exists(f'{M}/{f}'):
        text = open(f'{M}/{f}', encoding='utf-8', errors='replace').read().lower()
        present = [r for r in cands if r[0].lower() in text]
        if present: return present[0]
    return cands[0] if cands else None

# FAIL lines (redact). The '(?:\s*\[out-of-character structure\])?' bit is
# the only change from the pre-context-rule regex: privacy-check.mjs now
# sometimes annotates a fiction-class OOC-structure failure that way, and
# without tolerating it here the whole line would silently fail to match.
# Both FAIL regexes now capture the line number too (the global one always
# carried it in the text after the second colon; the scoped one is new --
# privacy-check.patch added a ':<line>' suffix to that message precisely
# so this handler could stop guessing which line to touch).
FAIL_GLOBAL_RE = re.compile(
    r'PRIVACY-FAIL: ledger term in tree \{.*?ledger-row (\d+) class=([\w-]+) len=(\d+).*?\}'
    r'(?:\s*\[out-of-character structure\])?: ([^:]+):(\d+):'
)
FAIL_SCOPED_RE = re.compile(
    r'PRIVACY-FAIL: scoped ledger term ledger-row (\d+) class=([\w-]+) len=(\d+) .*? in (\S+):(\d+)$'
)
# INFO lines (never redact; log to the review queue as in-character-candidate).
INFO_GLOBAL_RE = re.compile(
    r'PRIVACY-INFO: in-character use of a ledgered name \{.*?ledger-row (\d+) class=([\w-]+) len=(\d+).*?\}: ([^:]+):(\d+):'
)
INFO_SCOPED_RE = re.compile(
    r'PRIVACY-INFO: in-character use of a ledgered name \(scoped\) ledger-row (\d+) class=([\w-]+) len=(\d+) .*? in (\S+):(\d+)$'
)

redact_hits = {}  # file -> set of (term, cls, line_1based) to redact ON THAT LINE ONLY
info_hits = {}    # file -> set of (term, cls, line_1based) seen in-character, never redacted

def resolve(n, k, f):
    row = term_for(n, k, f)
    return row  # (term, cls) or None

for line in open(sys.argv[1], encoding='utf-8', errors='replace'):
    line = line.rstrip('\n')

    m = FAIL_GLOBAL_RE.search(line)
    if m:
        n, cls, k, f, ln = int(m.group(1)), m.group(2), int(m.group(3)), m.group(4), int(m.group(5))
        if not f.endswith('.html'): continue
        row = resolve(n, k, f)
        if not row: print('no ledger row matches', n, k); continue
        redact_hits.setdefault(f, set()).add((row[0], row[1], ln))
        continue

    m = FAIL_SCOPED_RE.search(line.strip())
    if m:
        n, cls, k, f, ln = int(m.group(1)), m.group(2), int(m.group(3)), m.group(4), int(m.group(5))
        if not f.endswith('.html'): continue
        row = resolve(n, k, f)
        if not row: print('no ledger row matches', n, k); continue
        redact_hits.setdefault(f, set()).add((row[0], row[1], ln))
        continue

    m = INFO_GLOBAL_RE.search(line)
    if m:
        n, cls, k, f, ln = int(m.group(1)), m.group(2), int(m.group(3)), m.group(4), int(m.group(5))
        if not f.endswith('.html'): continue
        row = resolve(n, k, f)
        if row: info_hits.setdefault(f, set()).add((row[0], row[1], ln))
        continue

    m = INFO_SCOPED_RE.search(line.strip())
    if m:
        n, cls, k, f, ln = int(m.group(1)), m.group(2), int(m.group(3)), m.group(4), int(m.group(5))
        if not f.endswith('.html'): continue
        row = resolve(n, k, f)
        if row: info_hits.setdefault(f, set()).add((row[0], row[1], ln))
        continue

# hook c208 (the Janitor's D480, 2026-10-09: "(a) plain rename"): the marker carries no category word, so this returns
# the whole marker instead of a label. The class still chooses which of the two forms is written -- a real name takes
# the name form, a contact detail or a login slug the detail form -- and stays in the privacy ledger, off the page.
def marker_for(cls):
    if cls in ('contact-detail', 'contact', 'email', 'login-slug', 'login', 'handle'): return '[detail withheld]'
    return '[name withheld]'

def sub_text_only(pat, repl, lines, idx, mask, base):
    """pat.subn on lines[idx], except a match inside markup or chrome (hook c80) is kept and its kind returned."""
    line = lines[idx]; out = []; last = 0; c = 0; kept = []
    for m in pat.finditer(line):
        kind = span_kind(mask, base + m.start(), base + m.end())
        if kind != TEXT: kept.append(kind); continue
        out.append(line[last:m.start()]); out.append(repl); last = m.end(); c += 1
    out.append(line[last:])
    return (''.join(out) if c else line), c, kept

done = 0
kept_total = 0
for f, hits in redact_hits.items():
    p = f'{M}/{f}'
    if not os.path.exists(p): continue
    lines = open(p, encoding='utf-8').read().split('\n')
    k = 0
    terms_touched = set()
    mask = None; kept_here = set()
    for term, cls, ln in hits:
        idx = ln - 1
        if not (0 <= idx < len(lines)): continue
        pat = re.compile(r'(?<![A-Za-z0-9])' + re.escape(term) + r'(?![A-Za-z0-9])', re.I)
        if mask is None: mask = scope_mask('\n'.join(lines))   # rebuilt after every line that changed
        base = sum(len(x) + 1 for x in lines[:idx])
        lines[idx], c, kept = sub_text_only(pat, marker_for(cls), lines, idx, mask, base)   # hook c208 (D480)
        for kind in kept: kept_here.add((ln, KIND_NAME[kind]))
        k += c
        if c: terms_touched.add((term, cls)); mask = None
    for ln, where in sorted(kept_here):
        kept_total += 1; print(f'{f}:{ln}: {where}: not redacted — the generator must change')
    if not k: continue
    # 2026-09-13: redaction counts are rendered from the page's own markers by the structured provenance block, so the
    # old declaration bump is gone. Every automatic redaction goes to a review queue: the Janitor's rule is that
    # in-character use of a name is never redacted, and only a reader can tell a wrestler billing from a byline.
    with open(QUEUE, 'a', encoding='utf-8') as q:
        for term, cls in terms_touched:
            q.write(f"{datetime.datetime.now().isoformat(timespec='minutes')}\t{f}\t{cls}\t{k}\tgate-fail-redact\tunreviewed\n")
    open(p, 'w', encoding='utf-8').write('\n'.join(lines)); done += k; print('redacted', k, 'on', f)
if kept_total: print('gate-flagged occurrences in markup / in chrome: not redacted — the generator must change:', kept_total)
print('gate-flagged occurrences redacted:', done)

# CONTEXT-FIRST PRIVACY: in-character hits are NEVER written to the served page --
# they are only logged, so a human can file a page-scoped ALLOW row (or, if the
# gate mis-scanned an actual out-of-character use, correct that and re-run).
skipped = 0
for f, hits in info_hits.items():
    p = f'{M}/{f}'
    if not os.path.exists(p): continue
    with open(QUEUE, 'a', encoding='utf-8') as q:
        for term, cls, ln in sorted(hits, key=lambda h: h[2]):
            q.write(f"{datetime.datetime.now().isoformat(timespec='minutes')}\t{f}:{ln}\t{cls}\t1\tgate-fail-redact\tin-character-candidate\n")
            skipped += 1
    print(f'logged {len(hits)} in-character occurrence(s) (not redacted) on', f)
print('gate-flagged in-character occurrences logged, not redacted:', skipped)
