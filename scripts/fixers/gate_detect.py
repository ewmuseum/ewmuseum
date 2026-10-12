"""gate_detect: is a process matching a `pgrep -f` pattern working on THE LIVE MUSEUM?

Every fixer and applier refuses or skips while a gate or build runs. Until 2026-10-01 each did that with a bare
`pgrep -f <pattern>`, which also matched a lane rebuilding a SCRATCH copy (`cd <scratch-museum>; node
scripts/cross-reference.mjs`). During window 230 one such scratch run made the live window skip apply-shard-paths 551
times and refuse apply-corrections twice and fix-content-notice once.

Here a matching process counts only when it works on the caller's museum root (the live tree for the window's fixers):
  * its cwd (/proc/<pid>/cwd) resolves to the root or a directory inside it, OR
  * any argv element names the root or a path inside it.
If /proc can't be read for a matching pid (it exited mid-check, or belongs to another user), it COUNTS: fail safe.
The calling process itself never counts.

Python:  from gate_detect import live_running;  live_running(PATTERN, ROOT) -> bool
Shell:   python3 -I scripts/fixers/gate_detect.py [--root ROOT] [--list] PATTERN
         exit 0 = a live match, 1 = none, 2 = usage or pgrep error (callers treat anything but 1 as "running").
ROOT defaults to $MUSEUM_ROOT, else the museum this file sits in (scripts/fixers -> two levels up).
"""
import os
import re
import subprocess
import sys


def default_root():
    return os.environ.get("MUSEUM_ROOT") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _roots(root):
    root = (root or default_root()).rstrip("/") or "/"
    return {os.path.abspath(root), os.path.realpath(root)}


def _inside(path, roots):
    return any(path == r or path.startswith(r.rstrip("/") + "/") for r in roots)


def _names_root(arg, roots):
    # the root as a whole path component: ".../museum" or ".../museum/..." but never ".../museum-scratch"
    return any(re.search(re.escape(r.rstrip("/")) + r"(?![A-Za-z0-9._~+-])", arg) for r in roots)


def live_pids(pattern, root=None):
    """The pids matching `pattern` (pgrep -f) that work on `root`. Raises FileNotFoundError if pgrep is missing."""
    roots = _roots(root)
    out = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True)
    if out.returncode not in (0, 1):
        raise RuntimeError("pgrep failed (rc %d): %s" % (out.returncode, out.stderr.strip()))
    me = os.getpid()
    live = []
    for tok in out.stdout.split():
        if not tok.isdigit() or int(tok) == me:
            continue
        pid = int(tok)
        try:
            cwd = os.readlink("/proc/%d/cwd" % pid)
            with open("/proc/%d/cmdline" % pid, "rb") as fh:
                argv = [a.decode("utf-8", "replace") for a in fh.read().split(b"\0") if a]
        except OSError:
            live.append(pid)  # unreadable (a race, or another user's process): count it, fail safe
            continue
        if cwd.endswith(" (deleted)"):
            cwd = cwd[: -len(" (deleted)")]
        if _inside(cwd, roots) or _inside(os.path.realpath(cwd), roots) or any(_names_root(a, roots) for a in argv):
            live.append(pid)
    return live


def live_running(pattern, root=None):
    return bool(live_pids(pattern, root))


def _main(argv):
    root, show, pats = None, False, []
    it = iter(argv)
    for a in it:
        if a == "--root":
            root = next(it, None)
            if not root:
                print("gate_detect: --root needs a path", file=sys.stderr)
                return 2
        elif a == "--list":
            show = True
        else:
            pats.append(a)
    if len(pats) != 1:
        print("usage: gate_detect.py [--root ROOT] [--list] PATTERN", file=sys.stderr)
        return 2
    try:
        pids = live_pids(pats[0], root)
    except Exception as e:  # pgrep missing or failing: the caller treats rc 2 as "running"
        print("gate_detect: %s" % e, file=sys.stderr)
        return 2
    if show and pids:
        print(" ".join(str(p) for p in pids))
    return 0 if pids else 1


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
