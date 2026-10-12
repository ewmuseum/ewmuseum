#!/usr/bin/env bash
# STANDING CHECK — run at every heartbeat (the Janitor 2026-09-12).
#
#     scripts/ops/standing-check.sh        npm run standing-check
#
# Verifies that the standing machinery is intact and reports the state a stalled
# or drifting operation shows first. Exit 1 on any gap.
#
# In the scratchpad era half of this file audited DERIVED scripts: that the next
# three cycles' generated files still sourced the standing fixers, that no
# waiter carried a stale gate number, that a red handler still looped. None of
# that exists any more — there is one cycle script and it takes N as an
# argument — so those checks are gone by construction rather than by policy.
# What remains are the checks that are about STATE rather than about generated
# copies of scripts.
set -u
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

rc=0
cd "$MUSEUM_ROOT" || exit 1

# ---- 1. the machinery is present and runnable ----------------------------
for f in preflight.sh gate.sh chain.sh window.sh red-handler.sh cycle.sh; do
  [ -f "$OPS_DIR/$f" ] || { echo "GAP: scripts/ops/$f missing"; rc=1; }
done
[ -f "$MUSEUM_ROOT/ops/commit-stub.txt" ] || { echo "GAP: ops/commit-stub.txt missing — the chain has nothing to commit with"; rc=1; }
[ -f "$FIXERS_DIR/ORDER.txt" ] || { echo "GAP: scripts/fixers/ORDER.txt missing"; rc=1; }

missing=0
while IFS= read -r f; do
  case "$f" in ''|'#'*) continue ;; esac
  [ -f "$FIXERS_DIR/$f" ] || { echo "GAP: ORDER.txt names $f, which is not in scripts/fixers/"; missing=$((missing + 1)); rc=1; }
done < "$FIXERS_DIR/ORDER.txt"
echo "standing fixers: $(grep -vc '^#\|^$' "$FIXERS_DIR/ORDER.txt") in ORDER.txt, $missing missing"

# every shell script in the ops dir must parse
for f in "$OPS_DIR"/*.sh; do
  bash -n "$f" || { echo "GAP: $(basename "$f") does not parse"; rc=1; }
done

# ---- 2. the commit stub rule --------------------------------------------
# stub N+1 carries only waves applied by chain N. A stub naming a wave whose
# dir carries no APPLIED marker would commit a claim the tree does not hold.
if [ -d "$WORKSHOP_ROOT" ]; then
  python3 - "$MUSEUM_ROOT" "$WORKSHOP_ROOT" <<'PY'
import glob, os, re, sys
museum, workshop = sys.argv[1], sys.argv[2]
stub = os.path.join(museum, 'ops', 'commit-stub.txt')
if not os.path.exists(stub):
    raise SystemExit(0)
names = set(re.findall(r'^-?\s*([A-Z0-9][A-Z0-9-]{4,}):', open(stub, encoding='utf-8').read(), re.M))
miss = []
for n in sorted(names):
    ds = glob.glob(f'{workshop}/**/wave-{n}', recursive=True)
    if ds and not any(os.path.exists(f'{d}/APPLIED') for d in ds):
        miss.append(n)
print('commit stub:', len(names), 'wave(s) named;',
      'named-but-not-APPLIED:', miss if miss else 'none')
PY
fi

# ---- 3. publish state (the Janitor 2026-09-15: deploy and push failures are loud)
for m in DEPLOY-FAILED PUSH-FAILED; do
  [ -f "$MUSEUM_ROOT/ops/$m" ] && { echo "GAP: ops/$m is set ($(cat "$MUSEUM_ROOT/ops/$m")) — the last chain did not publish/push"; rc=1; }
done; true
python3 -I "$OPS_DIR/deploy-status.py" || { echo "STANDING-CHECK RED: publish state (see above)"; rc=1; }

# ---- 4. the registry row-count watchdog ---------------------------------
# A DROP means something overwrote a registry file with an older copy — that
# happened twice (chain 139, and 78 waves' document rows on 2026-09-14) and both
# times the count was the only evidence.
python3 - "$MUSEUM_ROOT" "$WORKSHOP_ROOT" <<'PY'
import json, os, sys, time
museum, workshop = sys.argv[1], sys.argv[2]
p = os.path.join(museum, 'data', 'documents.json')
st = os.path.join(workshop, 'desk', 'documents-rowcount.tsv')
if not os.path.exists(p):
    raise SystemExit(0)
d = json.load(open(p))
n = len(d['documents'] if isinstance(d, dict) else d)
prev = None
if os.path.exists(st):
    rows = [l for l in open(st).read().split('\n') if l.strip()]
    if rows:
        prev = int(rows[-1].split('\t')[1])
if os.path.isdir(os.path.dirname(st)):
    open(st, 'a').write(f"{time.strftime('%Y-%m-%dT%H:%M')}\t{n}\n")
print('documents.json rows:', n, '| previous:', prev, '|',
      'DROP — registry overwritten, investigate' if prev and n < prev else 'ok')
PY

[ "$rc" -eq 0 ] && echo "standing-check: OK"
exit "$rc"
