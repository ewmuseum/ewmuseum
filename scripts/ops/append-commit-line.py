#!/usr/bin/env python3
"""Append one wave line to the tracked commit stub and normalise its shape:
subject, blank line, wave lines, blank line, trailer.

    append-commit-line.py "<line>" [--stub <path>]

Default stub: $MUSEUM_ROOT/ops/commit-stub.txt. Idempotent on the wave tag
(the "(wave X)" token) — re-running with the same wave never duplicates a line.

THE STUB RULE (cycle-script-derivation, addendum 2026-09-14): a wave's line
goes on the stub of the commit that will CARRY it. Append to the current stub
only while chain N has not yet run; once chain N has committed, a newly landed
wave belongs on the NEXT cycle's stub — chain N+1 applies it, chain N+2 commits
it. Check with the wave dir: it has APPLIED, its line belongs on the next
commit; READY only, the one after.
"""
import os, re, sys

ROOT = os.environ.get('MUSEUM_ROOT') or os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

args = [a for a in sys.argv[1:]]
stub = os.path.join(ROOT, 'ops', 'commit-stub.txt')
if '--stub' in args:
    i = args.index('--stub')
    stub = args[i + 1]
    del args[i:i + 2]
if not args:
    sys.exit(__doc__)
line = args[0].strip()

text = open(stub, encoding='utf-8').read()
lines = text.split('\n')
subj = lines[0]


def is_trailer(l):
    return l.startswith('Co-Authored-By') or l.startswith('Claude-Session')


body = [l for l in lines[1:] if l.strip() and not is_trailer(l)]
trailer = [l for l in lines if is_trailer(l)]

tag = re.search(r'\(wave [^)]+\)', line)
tag = tag.group(0) if tag else None
if not tag or not any(tag in b for b in body):
    body.append(line)

out = subj + '\n\n' + '\n'.join(body) + '\n'
if trailer:
    out += '\n' + '\n'.join(trailer) + '\n'
open(stub, 'w', encoding='utf-8').write(out)
print(f'{os.path.relpath(stub, ROOT)}: {len(body)} wave line(s)')
