#!/usr/bin/env bash
# RED HANDLER — the loop that turns a red gate green, or gives up honestly.
#
#     scripts/ops/red-handler.sh <label> [max-attempts]      (default 4)
#
# On a red gate: redact the privacy hits the gate itself named, run the fix set,
# re-run preflight, re-run the gate. Up to max-attempts times, then STOP and say
# so — the v1 handler exited after a single relaunch and standing fixes stopped
# persisting, which is why this loops (the Janitor 2026-09-12: fixes must persist).
#
# Never silently widens an allow and never edits a served artifact's own words:
# the two redactors act only on terms the ledger already carries and only on the
# pages the gate log named.
#
# c68 (D338, 2026-10-05): RETRIES THAT LOOK FIRST. Gate 256 re-ran the full 75–95 min gate three more times on the
# same single hit in a generated file the redactors cannot touch (CYCLE-TIME-AUDIT target 1: 3.8 h of 10.4 h lost).
#   * FINGERPRINT. Every red (gate run, privacy-only run, not-clean preflight) is reduced to a term-free fingerprint:
#     the failing step plus, for privacy, each hit's ledger source + row number + class + file (never the term, never
#     the quoted context, never a line number); for any other step, its failure lines (✗ / Traceback / TypeError /
#     Error / "N problem(s)"). The sha1 of the sorted items is the fingerprint. Kept per label in
#     $SCRATCH_ROOT/red-handler/<label>.state (the last decision), <label>.history.tsv (one row per red) and
#     <label>-<n>.fp (the term-free items of red n).
#   * INPUT SIGNATURE: md5s of what could fix a red without a person in the loop — the redaction ledger,
#     ledger-pending/, every file under scripts/ (generators, fixers, ORDER.txt, the checks themselves),
#     ops/config.env, package.json, data/memorials.json and data/documents.json — plus this round's redactor count.
#   * STOP RULE: when a red's fingerprint equals the last red's AND the input signature equals the one recorded then
#     AND the redactors changed 0 occurrences this round, the retry would start from the same inputs that already
#     produced this exact red: STOP at once with "identical red ... hand fix required" (exit 1, as GAVE UP).
#     A not-clean preflight is fingerprinted the same way, so an identical not-clean preflight is never retried.
#   * CHEAP RETRY: when the failing step is privacy, `npm run privacy` alone is re-run on the tree on disk (the gate
#     reached privacy, so the tree already carries this run's build:data/refresh:links/chrome/stats output) before
#     anything else; a red there is a new red for the loop above (15–18 min, not 75–95); only a pass goes on to
#     preflight and the full gate. The stamp still comes only from scripts/gate.sh.
#   * LABELS: run n is the first n free across gate<label>-run<n>.log, preflight<label>-r<n>.log and
#     privacy<label>-r<n>.log, so a not-clean preflight (which leaves no gate log to move) can no longer make the
#     next attempt reuse its label (248-r2 ran twice).
#   * OVERRIDE: RED_HANDLER_FORCE=1 skips the stop rule for this invocation's FIRST decision only — for a hand fix
#     the signature cannot see (a registry shard edited by hand, a wave pulled). A relaunched handler on the same
#     label reads the state, so it stops again at once unless something changed.
#
# c226 (hook c226-red-handler-targeted, 2026-10-09; the Janitor: "Let's do the targeted retry lane"): A PRIVACY RED IS
# RE-CHECKED WHERE IT IS, AND WAITS RATHER THAN GRINDS. Cycle 370 spent four whole-tree privacy scans (~55 min) on one ledger
# row on one file while its fix waited on a desk ruling.
#   * TARGETED: a privacy red whose term-free items all name a file (global, scoped, header-detail) writes those paths to
#     $SCRATCH_ROOT/red-handler/<label>-<n>.targets and re-checks them alone with the gate's own matcher
#     (`npm run privacy -- --only-files <list>`, privacy-check.mjs's file-list mode): seconds. Any item naming no file (over 40
#     hits, a disclosure line, no FAIL line) keeps the whole-tree re-check. A targeted red counts an attempt; a targeted pass
#     goes on to preflight and the FULL gate, which scans the whole tree and alone stamps green.
#   * PATIENT: where the stop rule fires on a privacy red (same fingerprint, same signature, redactors changed 0), the handler
#     WAITS instead, spending no attempt: every $RED_HANDLER_POLL s (60) it hashes what the re-check reads (the ledger, this
#     branch's fragment as privacy-check.mjs picks it, scripts/ + config + package.json, memorials + documents, the listed
#     files), and re-checks when one changes (that re-check is the attempt). Other lanes' ledger-pending/ fragments do not
#     wake it: privacy-check on main never reads them. HARD STOP: $RED_HANDLER_WAIT_MAX s (21600 = 6 h) of waiting in all,
#     then the identical-red stop below, unchanged. Non-privacy reds take exactly the path they always took.
# Exit 0 = green (a stamp exists, the chain may run). Exit 1 = still red (identical red, or max-attempts reached);
# that is a hand-fix, and it is correct for it to stop here rather than keep grinding.
set -u
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

LABEL="${1:?usage: red-handler.sh <label> [max-attempts]}"
MAX="${2:-4}"
GATELOG="$SCRATCH_ROOT/gate$LABEL.log"
RH_DIR="$SCRATCH_ROOT/red-handler"; RH_STATE="$RH_DIR/$LABEL.state"; RH_HIST="$RH_DIR/$LABEL.history.tsv"
FORCE="${RED_HANDLER_FORCE:-0}"
POLL="${RED_HANDLER_POLL:-60}"; WAIT_MAX="${RED_HANDLER_WAIT_MAX:-21600}"; WAITED=0   # hook c226: the privacy wait
mkdir -p "$RH_DIR"

[ -f "$GATELOG" ] || { ops_say "red-handler $LABEL: no gate log at $GATELOG"; exit 2; }
if grep -q 'GATE_RC=0' "$GATELOG"; then
  ops_say "red-handler $LABEL: gate is already green — nothing to do"
  exit 0
fi

# rh_py <fingerprint LOG OUT [STEP] | signature>  — term-free helpers; nothing they print carries a term or a quoted line.
rh_py() {
python3 -I - "$@" <<'PY'
import hashlib, os, re, sys
cmd = sys.argv[1]
if cmd == "fingerprint":
    log, out = sys.argv[2], sys.argv[3]
    L = open(log, encoding="utf-8", errors="replace").read().split("\n")
    step, lo, hi = None, 0, len(L)
    starts = {}
    for i, l in enumerate(L):
        m = re.search(r"gate-step (\S+) start$", l)
        if m: starts[m.group(1)] = i
        m = re.search(r"gate-step (\S+) done rc=(\d+)", l)
        if m and m.group(2) != "0": step, lo, hi = m.group(1), starts.get(m.group(1), 0), i
    if step is None and starts:            # a step that started and never reported (crash, kill)
        last = max(starts, key=starts.get)
        if not any(re.search(r"gate-step %s done" % re.escape(last), l) for l in L): step, lo = last, starts[last]
    if step is None and len(sys.argv) > 4: step = sys.argv[4]      # the caller knows the kind (a privacy-only log)
    if step is None:
        if any(l.startswith("PREFLIGHT_RC=") for l in L): step = "preflight"
        elif any("PRIVACY-FAIL" in l for l in L) and not any("✗" in l for l in L): step = "privacy"   # pre-c55 log: no step lines
        else: step = "unknown"
    sec = L[lo:hi + 1]
    items = []
    if step == "privacy":
        for l in sec:
            if "PRIVACY-FAIL" not in l: continue
            m = re.search(r"ledger term in tree \{(.*?)\}(\s*\[out-of-character structure\])?: ([^:]+):", l)
            if m:
                tags = re.findall(r"\[([\w-]+)\] ledger-row (\d+)(?: class=([\w-]+))?", m.group(1))
                ooc = "ooc" if m.group(2) else "-"
                for src, row, cls in (tags or [("unresolved", "-", "-")]):
                    items.append("privacy\tglobal\t%s:row%s\t%s\t%s\t%s" % (src, row, cls or "-", m.group(3), ooc))
                continue
            m = re.search(r"scoped ledger term ledger-row (\d+)(?: class=([\w-]+))?[^\[]*\[([^\]]*)\].*? in (\S+?):\d+\s*$", l)
            if m:
                items.append("privacy\tscoped\t%s:row%s\t%s\t%s" % (m.group(3), m.group(1), m.group(2) or "-", m.group(4))); continue
            m = re.search(r"unredacted header detail in ([^:]+):", l)
            if m: items.append("privacy\theader-detail\t%s" % m.group(1)); continue
            m = re.search(r"\.\.\.and (\d+) more ledger hits", l)
            if m: items.append("privacy\tmore-hits\t%s" % m.group(1)); continue
            if "ledger not found" in l: items.append("privacy\tledger-missing"); continue
            items.append("privacy\tother\t%s" % hashlib.sha1(l.split("PRIVACY-FAIL", 1)[1].encode()).hexdigest()[:12])
        if not items:   # privacy died without a FAIL line: hash its error lines, never print them
            err = [l.strip() for l in sec if re.search(r"Error|Traceback|RED", l)]
            items.append("privacy\tno-fail-line\t%s" % hashlib.sha1("\n".join(err).encode()).hexdigest()[:12])
    else:
        rx = re.compile(r"✗|Traceback|TypeError|Error:|[1-9][0-9]* problem\(s\)")
        for l in sec:
            if not rx.search(l) or re.search(r"stamped|recently-added", l): continue
            l = re.sub(r"^\d{4}-\d\d-\d\dT[\d:]+Z ", "", l).strip()
            l = re.sub(r"\s+", " ", l)
            items.append("%s\terr\t%s" % (step, l))
        if not items:
            rc = next((l for l in L if re.match(r"(PREFLIGHT|GATE)_RC=", l)), "rc=?")
            items.append("%s\tno-fail-line\t%s" % (step, rc.strip()))
    items = sorted(set(items))
    open(out, "w", encoding="utf-8").write("\n".join(items) + "\n")
    print("%s\t%s\t%d" % (hashlib.sha1("\n".join(items).encode()).hexdigest(), step, len(items)))
elif cmd == "signature":
    M, W = os.environ["MUSEUM_ROOT"], os.environ["WORKSHOP_ROOT"]
    def tree(*roots):
        fs = []
        for r in roots:
            if os.path.isfile(r): fs.append(r)
            elif os.path.isdir(r):
                for d, dn, fn in os.walk(r):
                    dn[:] = sorted(x for x in dn if x != "__pycache__")
                    fs += [os.path.join(d, f) for f in sorted(fn) if not f.endswith(".pyc")]
        h = hashlib.md5()
        for f in sorted(fs):
            h.update(f.encode() + b"\0")
            try: h.update(hashlib.md5(open(f, "rb").read()).digest())
            except OSError: h.update(b"unreadable")
        return h.hexdigest()[:16]
    comps = [("ledger", tree(W + "/privacy/redaction-ledger.tsv")),
             ("ledger-pending", tree(W + "/privacy/ledger-pending")),
             ("scripts", tree(M + "/scripts", M + "/ops/config.env", M + "/package.json")),
             ("registries", tree(M + "/data/memorials.json", M + "/data/documents.json"))]
    print(" ".join("%s=%s" % c for c in comps))
elif cmd == "targets":   # hook c226-red-handler-targeted: the files a privacy red's term-free items name, one per line
    items, out = sys.argv[2], sys.argv[3]
    files = []
    for l in open(items, encoding="utf-8").read().split("\n"):
        if not l.strip(): continue
        f = l.split("\t")
        if len(f) >= 5 and f[0] == "privacy" and f[1] in ("global", "scoped"): p = f[4]
        elif len(f) >= 3 and f[0] == "privacy" and f[1] == "header-detail": p = f[2]
        else: sys.exit(3)   # an item naming no file (more-hits, other, no-fail-line, ledger-missing): not targetable
        p = p.strip()
        if not p or p.startswith("/") or ".." in p.split("/"): sys.exit(3)
        files.append(p)
    if not files: sys.exit(3)
    files = sorted(set(files))
    open(out, "w", encoding="utf-8").write("\n".join(files) + "\n")
    print(len(files))
elif cmd == "waitsig":   # hook c226: what the (targeted) privacy re-check reads; [list] adds the listed files' contents
    import subprocess
    M, W = os.environ["MUSEUM_ROOT"], os.environ["WORKSHOP_ROOT"]
    def tree(*roots):
        fs = []
        for r in roots:
            if os.path.isfile(r): fs.append(r)
            elif os.path.isdir(r):
                for d, dn, fn in os.walk(r):
                    dn[:] = sorted(x for x in dn if x != "__pycache__")
                    fs += [os.path.join(d, f) for f in sorted(fn) if not f.endswith(".pyc")]
        h = hashlib.md5()
        for f in sorted(fs):
            h.update(f.encode() + b"\0")
            try: h.update(hashlib.md5(open(f, "rb").read()).digest())
            except OSError: h.update(b"unreadable")
        return h.hexdigest()[:16]
    try: br = subprocess.run(["git", "-C", M, "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True).stdout.strip()
    except OSError: br = ""
    frag = W + "/privacy/ledger-pending/" + br.replace("/", "-") + ".tsv" if br and br not in ("main", "HEAD") else ""
    comps = [("ledger", tree(W + "/privacy/redaction-ledger.tsv")), ("fragment", tree(frag) if frag else "none"),
             ("scripts", tree(M + "/scripts", M + "/ops/config.env", M + "/package.json")),
             ("registries", tree(M + "/data/memorials.json", M + "/data/documents.json"))]
    if len(sys.argv) > 2 and sys.argv[2]:
        names = [x for x in open(sys.argv[2], encoding="utf-8").read().split("\n") if x.strip()]
        h = hashlib.md5()
        for x in sorted(names):
            h.update(x.encode() + b"\0")
            try: h.update(hashlib.md5(open(os.path.join(M, x), "rb").read()).digest())
            except OSError: h.update(b"absent")
        comps.append(("files", h.hexdigest()[:16]))
    print(" ".join("%s=%s" % c for c in comps))
PY
}
rh_get() { [ -f "$RH_STATE" ] && sed -n "s/^$1=//p" "$RH_STATE" | tail -1; }
rh_next_n() {
  local n=1
  while [ -e "$SCRATCH_ROOT/gate$LABEL-run$n.log" ] || [ -e "$SCRATCH_ROOT/preflight$LABEL-r$n.log" ] \
     || [ -e "$SCRATCH_ROOT/privacy$LABEL-r$n.log" ]; do n=$((n + 1)); done
  echo "$n"
}
# hook c80: the redactors never write into markup or a stamped chrome region; such a hit is printed as "<file>:<line>: in markup|in
# chrome: not redacted — the generator must change" (no term) and surfaced here, so a red the redactors refuse is visible in the
# cycle log; the identical-red stop rule below then stops the loop (nothing changed, same fingerprint).
rh_kept() { printf '%s\n' "$1" | grep -F ': not redacted — the generator must change' | head -20 | sed 's/^/red-handler: /' >&2; }
rh_redact() {   # $1 = a log carrying PRIVACY-FAIL lines; prints the total occurrences the two redactors changed
  local out a b
  out=$(python3 -I "$OPS_DIR/redact-gate-hits.py" "$1" 2>&1); printf '%s\n' "$out" | tail -3 >&2; rh_kept "$out"
  a=$(printf '%s\n' "$out" | sed -n 's/^redacted \([0-9][0-9]*\) occurrence.*/\1/p' | tail -1)
  out=$(python3 -I "$OPS_DIR/gate-fail-redact.py" "$1" 2>&1); printf '%s\n' "$out" | tail -3 >&2; rh_kept "$out"
  b=$(printf '%s\n' "$out" | sed -n 's/^gate-flagged occurrences redacted: \([0-9][0-9]*\).*/\1/p' | tail -1)
  # an unparseable count is treated as a change: never stop on a guess
  [ -n "$a" ] && [ -n "$b" ] || { echo "unknown"; return; }
  echo $((a + b))
}

# hook c226-red-handler-targeted: rh_wait. An identical privacy red waits, spending no attempt, for an input its re-check reads
# to change (rh_py waitsig: the ledger, this branch's fragment, scripts, registries, the listed files), polling every $POLL s.
# 0 = one changed ($sig refreshed; the caller re-checks, and that is the attempt); 1 = $WAIT_MAX s of waiting in all have
# passed in this invocation (the caller stops exactly as the identical-red stop always has). Logs one line each way; no term.
rh_wsig() { if [ "$tg" = 1 ]; then rh_py waitsig "$TGT"; else rh_py waitsig; fi; }
rh_wait() {
  local w0 w t0 now moved left
  left=$((WAIT_MAX - WAITED)); [ "$left" -gt 0 ] || return 1
  w0=$(rh_wsig); [ -n "$w0" ] || return 1
  { echo "kind=$KIND"; echo "step=$step"; echo "fp=$fp"; echo "sig=$sig"; echo "verdict=waiting"; echo "at=$(date -u +%FT%TZ)"; } > "$RH_STATE"
  ops_say "red-handler $LABEL: identical privacy red (fingerprint ${fp:0:12}; no input changed; the redactors changed nothing) — WAITING for the ledger, this branch's fragment, scripts, registries$([ "$tg" = 1 ] && echo " or the $ntg named file(s)") to change; checking every ${POLL}s for up to ${left}s; no attempt spent"
  t0=$(date +%s)
  while :; do
    sleep "$POLL"
    now=$(date +%s); w=$(rh_wsig)
    if [ -n "$w" ] && [ "$w" != "$w0" ]; then
      WAITED=$((WAITED + now - t0))
      moved=$(for kv in $w; do case " $w0 " in *" $kv "*) ;; *) printf '%s ' "${kv%%=*}";; esac; done)
      sig=$(rh_py signature)
      ops_say "red-handler $LABEL: input changed after $((now - t0))s of waiting (changed: ${moved:-?}) — re-checking; this re-check is attempt $attempt of $MAX"
      return 0
    fi
    if [ $((WAITED + now - t0)) -ge "$WAIT_MAX" ]; then
      WAITED=$((WAITED + now - t0))
      ops_say "red-handler $LABEL: waited $((now - t0))s (${WAITED}s in all; the ceiling is ${WAIT_MAX}s) and no input changed"
      return 1
    fi
  done
}

attempt=1
CUR="$GATELOG"; KIND=gate
first=1
while [ "$attempt" -le "$MAX" ]; do
  ops_say "red-handler $LABEL: attempt $attempt of $MAX"
  n=$(rh_next_n)

  # keep each red gate's log under its own run number; the handler reads the newest one
  if [ "$KIND" = gate ]; then RUN="$SCRATCH_ROOT/gate$LABEL-run$n.log"; mv "$CUR" "$RUN"; CUR="$RUN"; fi

  # 0. fingerprint this red (term-free)
  FPOUT="$RH_DIR/$LABEL-$n.fp"
  hint=; [ "$KIND" = privacy ] && hint=privacy
  IFS=$'\t' read -r fp step nitems < <(rh_py fingerprint "$CUR" "$FPOUT" $hint)
  [ -n "$fp" ] || { fp="unfingerprinted-$n-$$"; step=${step:-unknown}; }   # a helper failure never matches: no stop on a guess
  ops_say "red-handler $LABEL: red $n ($KIND) step=$step fingerprint=${fp:0:12} items=$nitems (term-free items: $FPOUT)"
  # hook c226: a privacy red whose items all name a file is TARGETABLE; its re-check reads only those files
  TGT="$RH_DIR/$LABEL-$n.targets"; tg=0; ntg=0
  if [ "$step" = privacy ]; then
    if ntg=$(rh_py targets "$FPOUT" "$TGT" 2>/dev/null) && [ -n "$ntg" ]; then tg=1; else tg=0; ntg=0; fi
  fi

  # 1. the privacy hits the red named, on the pages it named (a preflight red names none)
  changed=0
  if [ "$KIND" != preflight ]; then changed=$(rh_redact "$CUR"); fi
  sig=$(rh_py signature)

  # 2. the stop rule: identical red, identical inputs, nothing redacted => the retry is futile
  last_fp=$(rh_get fp); last_sig=$(rh_get sig)
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$n" "$KIND" "$step" "${fp:0:12}" "$nitems" "$changed" "$sig" >> "$RH_HIST"
  if [ "$fp" = "$last_fp" ] && [ "$sig" = "$last_sig" ] && [ "$changed" = 0 ]; then
    if [ "$FORCE" = 1 ] && [ "$first" = 1 ]; then
      ops_say "red-handler $LABEL: identical red, but RED_HANDLER_FORCE=1 — retrying once"
    elif [ "$step" = privacy ] && rh_wait; then
      :   # hook c226: an input the re-check reads changed while it waited; re-check below (this attempt)
    else
      { echo "kind=$KIND"; echo "step=$step"; echo "fp=$fp"; echo "sig=$sig"; echo "verdict=identical-stop"; echo "at=$(date -u +%FT%TZ)"; } > "$RH_STATE"
      ops_say "red-handler $LABEL: IDENTICAL RED — step $step, fingerprint ${fp:0:12} as last time, no input changed (ledger, ledger-pending, scripts, registries) and the redactors changed nothing; a retry would reproduce it. STOPPED: hand fix required. Logs: $SCRATCH_ROOT/gate$LABEL-run*.log; items: $FPOUT"
      exit 1
    fi
  elif [ "$fp" = "$last_fp" ]; then
    moved=$(for kv in $sig; do case " $last_sig " in *" $kv "*) ;; *) printf '%s ' "${kv%%=*}";; esac; done)
    ops_say "red-handler $LABEL: same fingerprint as last time, but inputs changed (redactors changed $changed occurrence(s); changed inputs: ${moved:-none}) — retrying"
  fi
  first=0
  { echo "kind=$KIND"; echo "step=$step"; echo "fp=$fp"; echo "sig=$sig"; echo "verdict=retry"; echo "at=$(date -u +%FT%TZ)"; } > "$RH_STATE"

  # 3. a privacy red: re-check privacy alone on the tree on disk before paying for a full gate
  if [ "$step" = privacy ]; then
    PLOG="$SCRATCH_ROOT/privacy$LABEL-r$n.log"
    t0=$(date +%s)
    if [ "$tg" = 1 ]; then   # hook c226: only the file(s) this red named, by the gate's own matcher
      ops_say "red-handler $LABEL: TARGETED privacy re-check $LABEL-r$n on the $ntg file(s) this red named (list: $TGT; the gate's own matcher; no preflight, no gate)"
      ( cd "$MUSEUM_ROOT" && LC_ALL=C npm run privacy -- --only-files "$TGT" ) > "$PLOG" 2>&1
      prc=$?
    else
      ops_say "red-handler $LABEL: privacy-only re-check $LABEL-r$n on the tree on disk (no preflight, no gate)"
      ( cd "$MUSEUM_ROOT" && LC_ALL=C npm run privacy ) > "$PLOG" 2>&1
      prc=$?
    fi
    ops_rc_line PRIVACY "$prc" "$PLOG"
    if [ "$prc" -ne 0 ]; then
      ops_say "red-handler $LABEL: privacy-only $LABEL-r$n still red (rc=$prc, $(( $(date +%s) - t0 ))s$([ "$tg" = 1 ] && echo ", targeted")) — not gating"
      CUR="$PLOG"; KIND=privacy; attempt=$((attempt + 1)); continue
    fi
    ops_say "red-handler $LABEL: privacy-only $LABEL-r$n passed ($(( $(date +%s) - t0 ))s$([ "$tg" = 1 ] && echo ", targeted")) — preflight and the full gate"
  fi

  # 4. the standing fix set, then a fresh preflight (which runs ORDER.txt again)
  bash "$OPS_DIR/preflight.sh" "$LABEL-r$n"
  prc=$?
  if [ "$prc" -ne 0 ]; then
    ops_say "red-handler $LABEL: preflight $LABEL-r$n did not come back clean (rc=$prc) — not gating"
    CUR="$SCRATCH_ROOT/preflight$LABEL-r$n.log"; KIND=preflight
    [ -f "$CUR" ] || { CUR="$RH_DIR/$LABEL-r$n.nolog"; echo "PREFLIGHT_RC=$prc" > "$CUR"; }
    attempt=$((attempt + 1)); continue
  fi

  # 5. gate again
  bash "$OPS_DIR/gate.sh" "$LABEL" && { echo "verdict=green" >> "$RH_STATE"; ops_say "red-handler $LABEL: GREEN on attempt $attempt"; exit 0; }
  CUR="$GATELOG"; KIND=gate
  attempt=$((attempt + 1))
done

ops_say "red-handler $LABEL: GAVE UP after $MAX attempt(s) — hand fix required. Logs: $SCRATCH_ROOT/gate$LABEL-run*.log"
exit 1
