#!/usr/bin/env python3
"""Publish-state check (the Janitor 2026-09-15: silent deploy and push failures are not acceptable — track them).
Writes desk/deploy-status.tsv (one row per run) and prints RED lines when: the R2 manifest is older than HEAD (site behind the
registry); the newest chain's r2-sync rc ≠ 0; local main is ahead of origin/main; worker/headers.json is stale against _headers.
Exit 1 on any RED so standing-check.sh and the heartbeat surface it. Read-only."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json, os, subprocess, glob, re, time, datetime
os.environ['PATH'] = f'{_NODEBIN}:' + os.environ.get('PATH', '')   # node lives outside the default PATH here
M = f'{_ROOT}'; A = f'{_WORKSHOP}'; S = f'{_SCRATCH}'
def sh(c): return subprocess.run(c, shell=True, capture_output=True, text=True, cwd=M).stdout.strip()
head = sh('git log -1 --format=%h'); head_t = int(sh('git log -1 --format=%ct') or 0)
sh('git fetch -q origin 2>/dev/null')
ahead = sh('git rev-list --count origin/main..main'); behind = sh('git rev-list --count main..origin/main')
# the manifest lives in the bucket; the last SUCCESSFUL sync is the newest r2-sync-chain*.log that reached "r2-sync: done"
man = None; man_t = 0
for lg in sorted(glob.glob(f'{S}/r2-sync-chain*.log'), key=os.path.getmtime, reverse=True):
    if 'r2-sync: done' in open(lg, errors='replace').read(): man = lg; man_t = os.path.getmtime(lg); break
logs = sorted(glob.glob(f'{S}/chain1*.log'), key=os.path.getmtime)
last_rc = None; last_chain = None
for lg in reversed(logs):
    m = re.findall(r'r2-sync rc=(\d+)', open(lg, errors='replace').read())
    if m: last_rc = int(m[-1]); last_chain = os.path.basename(lg); break
hdr_stale = subprocess.run('node scripts/build-worker-headers.mjs --check', shell=True, capture_output=True, text=True, cwd=M).returncode != 0 if os.path.exists(f'{M}/scripts/build-worker-headers.mjs') else None
reds = []
if last_rc not in (None, 0): reds.append(f'RED deploy: newest chain r2-sync rc={last_rc} ({last_chain}) — the live site did NOT receive that commit')
if man and man_t and head_t and man_t < head_t - 3600: reds.append(f'RED deploy: R2 manifest {datetime.datetime.fromtimestamp(man_t):%F %H:%M} is older than HEAD {head} ({datetime.datetime.fromtimestamp(head_t):%F %H:%M}) — site behind the registry')
if ahead and ahead != '0': reds.append(f'RED push: local main is {ahead} commit(s) ahead of origin/main (GitHub mirror stale)')
if behind and behind != '0': reds.append(f'RED push: origin/main is {behind} commit(s) ahead of local main — pull --rebase before the next chain')
if hdr_stale: reds.append('RED deploy: worker/headers.json stale against _headers — r2-sync will refuse')
row = [time.strftime('%F %T'), head, str(ahead), str(behind), datetime.datetime.fromtimestamp(man_t).strftime('%F %H:%M') if man_t else 'no-manifest', str(last_rc), last_chain or '', 'RED' if reds else 'ok']
os.makedirs(f'{A}/desk', exist_ok=True); new = not os.path.exists(f'{A}/desk/deploy-status.tsv')
with open(f'{A}/desk/deploy-status.tsv', 'a') as f:
    if new: f.write('checked\thead\tahead_of_origin\tbehind_origin\tr2_manifest\tlast_r2sync_rc\tlast_chain\tstate\n')
    f.write('\t'.join(row) + '\n')
print('deploy-status:', ' | '.join(row)); [print(' ', r) for r in reds]
raise SystemExit(1 if reds else 0)
