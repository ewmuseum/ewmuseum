#!/usr/bin/env python3
"""
Resumable Wayback fetcher for the URL walk's fetch-plan.tsv.

Modeled directly on the fwrestling census's fetch.py -- same fusebox
discipline, same adaptive spacing, same manifest crash-safety. Adapted to
read THIS lane's plan columns instead of the census's tier/rank/family
schema.

- Reads fetch-plan.tsv (priority, row_name, original_url, wayback_ts,
  wayback_url, est_pages), in priority/row_name/timestamp order (the file
  is written pre-sorted; this script does not re-sort, so a hand-edited
  plan keeps its own order).
- Skips rows already present in manifest.tsv (matched by original_url +
  wayback_ts).
- Fetches the plan's own precomputed wayback_url (the .../<ts>id_/<url>
  form -- raw captured bytes, no Wayback chrome).
- One request at a time. Adaptive spacing: 4.0s base (this campaign's
  pacing law -- see the fwrestling census's fetch.py's SPACING_SECS note),
  doubling (to a 12s ceiling) on any 429/503 and decaying back only after
  50 clean fetches; backs off 15s per retry and pauses 3 minutes after
  three CONSECUTIVE 429/503s.
- Fusebox-gated (the workshop's politeness.py): the breaker is consulted
  before EVERY request and fed after it. A TrippedError halts the run
  cleanly -- do not restart early; check `python3 politeness.py status`.
- Honors an optional skip-ledger.tsv (url, ts) in this directory, same
  shape as the census lane's, for parity -- absent by default, harmless
  if never created.
- Retries each URL up to 5 times (covers all errors: HTTP, timeout,
  connection).
- Saves body under raw/<host>/<sanitized-path>__<ts>.html.
- Appends one manifest.tsv line immediately per fetch (crash-safe: url,
  ts, status, bytes, path, sha1, priority, row_name).
- Stops cleanly once --max-seconds has elapsed since start, prints a
  completion line with counts, and exits 0.

Invocation (see README.md): python3 fetch.py --max-seconds 3600
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import argparse
import hashlib
import os
import re
import sys
import time
import urllib.request
import urllib.error
import sys as _sys
_CONSEC_403 = 0
EXCLUSION_RE = re.compile(rb"(excluded from the Wayback Machine|robots\.txt|has not archived that URL|Page cannot be crawled or displayed due to robots|This content is not available|@licstart|<title>\s*Wayback Machine\s*</title>|Copyright \(C\) 20\d\d Internet Archive|<title>\s*403 Forbidden\s*</title>|You don.t have permission to access|<address>Apache[^<]*Server at|<center>\s*nginx)", re.I)  # 2026-09-17: an ARCHIVED 403 (the original host's Apache/nginx error page replayed by Wayback) is the capture's content, not a wall  # 2026-09-15 22:20: a 403 served by the Wayback APP SHELL (its own page with the AGPL banner) is a content answer; a block page is bare
_sys.path.insert(0, _TOOLS)
from politeness import Fusebox, TrippedError  # fusebox law (2026-08-31): every fetcher consults the breaker
FUSEBOX = Fusebox()


# The collection tree this fetcher works in. The script itself lives in the repo;
# its plan, manifest and raw captures live in the workshop, beside the material.
BASE_DIR = os.environ.get('FETCH_BASE_DIR') or os.path.join(_WORKSHOP, 'url-walk')
PLAN_PATH = os.path.join(BASE_DIR, "fetch-plan.tsv")
MANIFEST_PATH = os.path.join(BASE_DIR, "manifest.tsv")
RAW_DIR = os.path.join(BASE_DIR, "raw")

SPACING_SECS = 4.0       # the Janitor's pacing law (see census fetch.py) -- top of the 3.5-4.0s range
SPACING_MAX = 12.0       # adaptive ceiling
CLEAN_DECAY = 50         # clean fetches before spacing decays back toward base
BACKOFF_SECS = 15.0
LONG_PAUSE_SECS = 180.0
TIMEOUT_SECS = 60
MAX_RETRIES = 5
USER_AGENT = ("ewrestling-museum-collection-analyst/1.0 "
              "(+https://crawler.ewmuseum.org/; contact: crawler@ewmuseum.org)")
IA_HOST = "web.archive.org"


def sanitize_path_component(url):
    """Turn a full original URL into a filesystem-safe path suffix (no host)."""
    m = re.match(r"^https?://[^/]+(/.*)?$", url)
    tail = m.group(1) if m and m.group(1) else "/"
    tail = tail.lstrip("/")
    if not tail:
        tail = "index"
    safe = re.sub(r"[^A-Za-z0-9_.\-/]", "_", tail)
    safe = safe.replace("/", "__")
    if len(safe) > 180:
        h = hashlib.sha1(safe.encode("utf-8", "replace")).hexdigest()[:12]
        safe = safe[:160] + "__" + h
    return safe


def host_of(url):
    m = re.match(r"^https?://([^/:]+)", url)
    return m.group(1) if m else "unknown-host"


def load_manifest_keys():
    """Rows that succeeded (status < 400) are done for good. Failed rows
    (ERR or >=400) stay eligible so a resume retries them -- most failures
    here are transient network blips, not permanent 404s from a bad plan
    row."""
    seen = set()
    if os.path.exists(MANIFEST_PATH):
        with open(MANIFEST_PATH, encoding="utf-8", errors="replace") as f:
            for line in f:
                parts = line.rstrip("\n").split("\t")
                if len(parts) < 3:
                    continue
                url, ts, status = parts[0], parts[1], parts[2]
                if status in ("404", "410", "403"):
                    seen.add((url, ts))  # 2026-09-13: an exact-memento 403 (a capture Wayback refuses) is a tombstone too -- it tripped the breaker twice in one night at the head of every resume  # a Wayback 404/410 for an exact timestamp is a tombstone: permanent, never retried (2026-09-11: twelve trickle bursts burned on one dead 2009 GeoCities capture)
                    continue
                if status == "ERR" or (status.isdigit() and int(status) >= 400):
                    continue
                seen.add((url, ts))
    return seen


def load_skip_ledger():
    """(url, ts) rows retired by an optional skip-ledger.tsv, same shape
    as the census lane's. Absent by default -- harmless no-op then.
    Reversible: delete the file and every row is eligible again."""
    skips = set()
    path = os.path.join(BASE_DIR, "skip-ledger.tsv")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            f.readline()
            for line in f:
                parts = line.rstrip("\n").split("\t")
                if len(parts) >= 2:
                    skips.add((parts[0], parts[1]))
    return skips


def load_plan(priorities=None):
    rows = []
    with open(PLAN_PATH, encoding="utf-8") as f:
        header = f.readline()
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 6:
                continue
            priority, row_name, original_url, ts, wayback_url, est_pages = parts[0:6]
            if priorities and priority not in priorities:
                continue
            rows.append({"priority": priority, "row_name": row_name,
                         "url": original_url, "ts": ts,
                         "wayback_url": wayback_url, "host": host_of(original_url)})
    return rows


def fetch_one(wayback_url):
    """Return (status_code_or_None, body_bytes_or_None, error_str_or_None).
    Fusebox law: the breaker is consulted before EVERY request and fed
    after it -- 429/403/conn-drop trips instantly (a wall is an answer),
    transients count toward the consecutive/daily budgets, and a
    TrippedError propagates up to halt the run cleanly."""
    global _CONSEC_403
    FUSEBOX.require(IA_HOST)
    req = urllib.request.Request(wayback_url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECS) as resp:
            body = resp.read()
            FUSEBOX.record_success(IA_HOST)
            _CONSEC_403 = 0
            return resp.status, body, None
    except urllib.error.HTTPError as e:
        try:
            body = e.read()
        except Exception:
            body = None
        # 2026-09-14 (the Janitor): a Wayback 403 is usually a CONTENT answer — the site or capture is excluded (robots.txt / owner
        # request) — not a rate wall; only a 403 whose body carries no exclusion notice is treated as a wall.
        if e.code == 403:  # log every 403 body head so walls and exclusions can be told apart with evidence (2026-09-14)
            try:
                with open(f"{_WORKSHOP}/fwrestling-census/ia-403-bodies.log", "ab") as _f:
                    _f.write(f"== {time.strftime('%F %T')} {wayback_url}\n".encode() + (body or b"(empty body)")[:3000] + b"\n")
            except Exception:
                pass
        if e.code == 403 and ((body and EXCLUSION_RE.search(body[:20000])) or (not body and _CONSEC_403 == 0)):
            # an exclusion notice, or a lone EMPTY-body 403 on a raw (id_) request, is an answer about that capture — a tombstone.
            # Two 403s in a row with no success between them are treated as a wall (2026-09-15 00:19 ruling, ia-403-bodies.log).
            _CONSEC_403 += 1
            FUSEBOX.record_success(IA_HOST)
            return e.code, body, "HTTPError 403 (excluded capture — tombstone, not a wall)"
        if e.code in (429, 403):
            err = FUSEBOX.record_failure(IA_HOST, str(e.code), wayback_url[:100])
            if err:
                raise err
        else:
            FUSEBOX.record_success(IA_HOST)  # 404/500-class = an answer from a healthy server
        return e.code, body, f"HTTPError {e.code}"
    except TrippedError:
        raise
    except Exception as e:
        kind = "conn-drop" if any(k in str(e) for k in ("RemoteDisconnected", "Connection reset", "ConnectionReset")) else "transient"
        err = FUSEBOX.record_failure(IA_HOST, kind, f"{type(e).__name__}"[:60])
        if err:
            raise err
        return None, None, f"{type(e).__name__}: {e}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-seconds", type=float, default=540)
    ap.add_argument("--priorities", type=str, default=None,
                     help="comma-separated priority numbers to restrict to, e.g. 1,2")
    ap.add_argument("--limit", type=int, default=None,
                     help="stop after this many NEW fetch attempts (testing)")
    ap.add_argument("--errs-only", action="store_true",
                     help="restrict to rows currently at ERR status in the manifest -- "
                          "a quick priority pass to clear the retry backlog")
    args = ap.parse_args()

    priorities = set(args.priorities.split(",")) if args.priorities else None

    os.makedirs(RAW_DIR, exist_ok=True)

    start = time.monotonic()
    done_keys = load_manifest_keys()
    plan = load_plan(priorities)

    if args.errs_only:
        err_keys = set()
        if os.path.exists(MANIFEST_PATH):
            with open(MANIFEST_PATH, encoding="utf-8", errors="replace") as f:
                for line in f:
                    parts = line.rstrip("\n").split("\t")
                    if len(parts) < 3:
                        continue
                    if parts[2] == "ERR":
                        err_keys.add((parts[0], parts[1]))
        plan = [row for row in plan if (row["url"], row["ts"]) in err_keys]
        print(f"--errs-only: restricting to {len(plan)} ERR rows", file=sys.stderr)

    print(f"plan rows (priority filter={priorities}): {len(plan)}; already in manifest: {len(done_keys)}",
          file=sys.stderr)

    skip_keys = load_skip_ledger()
    # 2026-09-14 coordinator: a memento that has already failed 3+ times (manifest rows with status >= 400 or ERR)
    # is parked automatically -- one dead capture retried every burst starved every later leg on 2026-09-13/14.
    try:
        _fails = {}
        _mp = os.path.join(BASE_DIR, "manifest.tsv")
        if os.path.exists(_mp):
            with open(_mp, encoding="utf-8", errors="replace") as _f:
                _f.readline()
                for _line in _f:
                    _c = _line.rstrip("\n").split("\t")
                    if len(_c) >= 3 and (_c[2] == "ERR" or (_c[2].isdigit() and int(_c[2]) >= 400)):
                        _fails[(_c[0], _c[1])] = _fails.get((_c[0], _c[1]), 0) + 1
        _parked = {k for k, n in _fails.items() if n >= 3}
        if _parked:
            print(f"auto-park: {len(_parked)} capture(s) with 3+ failed attempts skipped this run", file=sys.stderr)
            skip_keys = set(skip_keys) | _parked
    except Exception as _e:
        print(f"auto-park: skipped ({_e})", file=sys.stderr)
    if skip_keys:
        print(f"skip ledger: {len(skip_keys)} rows retired", file=sys.stderr)

    attempted = 0
    fetched_ok = 0
    fetched_fail = 0
    skipped_done = 0
    skipped_policy = 0
    consecutive_wall = 0
    spacing = SPACING_SECS
    clean_streak = 0

    manifest_f = open(MANIFEST_PATH, "a", encoding="utf-8")

    try:
        for row in plan:
            if time.monotonic() - start > args.max_seconds:
                break
            if args.limit is not None and attempted >= args.limit:
                break

            key = (row["url"], row["ts"])
            if key in done_keys:
                skipped_done += 1
                continue
            if key in skip_keys:
                skipped_policy += 1
                continue

            attempted += 1
            status = None
            body = None
            err = None
            tripped = False
            trip_reason = ""
            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    try:
                        status, body, err = fetch_one(row["wayback_url"])
                    except TrippedError:
                        # 2026-09-15: record the walled attempt as an ERR row so a capture that walls on every attempt reaches
                        # the auto-park threshold (3) instead of tripping the breaker at the head of every burst
                        with open(MANIFEST_PATH, "a", encoding="utf-8") as _mf: _mf.write("\t".join([row["url"], row["ts"], "ERR", "0", "", "", str(row.get("priority", "")), "wall"]) + "\n")
                        raise
                except TrippedError as e:
                    print(f"[tripped] {e}")
                    tripped = True
                    trip_reason = e.reason
                    break
                if status is not None and status < 400:
                    consecutive_wall = 0
                    break
                if status in (429, 503):
                    clean_streak = 0
                    if spacing < SPACING_MAX:
                        spacing = min(SPACING_MAX, spacing * 2)
                        print(f"[adaptive] spacing -> {spacing:.1f}s after {status}",
                              file=sys.stderr)
                    consecutive_wall += 1
                    if consecutive_wall >= 3:
                        print(f"[pause] 3 consecutive 429/503s -- sleeping "
                              f"{LONG_PAUSE_SECS:.0f}s", file=sys.stderr)
                        time.sleep(LONG_PAUSE_SECS)
                        consecutive_wall = 0
                    else:
                        time.sleep(BACKOFF_SECS)
                else:
                    consecutive_wall = 0
                    time.sleep(min(BACKOFF_SECS, SPACING_SECS * attempt))
                if attempt < MAX_RETRIES:
                    continue

            if tripped:
                attempted -= 1  # this row never completed a fetch attempt -- stays eligible next run
                if "(403)" in str(trip_reason):
                    # 2026-09-13: a 403 on an exact memento is Wayback refusing THIS capture, not a rate
                    # wall; left eligible, the same row headed every resume and re-tripped the breaker
                    # (two trips on 2026-09-13, the second at the 24-hour ladder step). Tombstone it.
                    manifest_f.write("\t".join([row["url"], row["ts"], "403", "0", "", "",
                                                 row["priority"], row["row_name"]]) + "\n")
                    manifest_f.flush()
                    print(f"[tombstone] 403 memento quarantined: {row['url']} @{row['ts']}", file=sys.stderr)
                break

            host_safe = re.sub(r"[^A-Za-z0-9_.\-]", "_", row["host"] or "unknown-host")
            path_safe = sanitize_path_component(row["url"])
            out_rel = os.path.join(host_safe, f"{path_safe}__{row['ts']}.html")
            out_path = os.path.join(RAW_DIR, out_rel)

            sha1 = ""
            nbytes = 0
            if status is not None and status < 400 and body is not None:
                os.makedirs(os.path.dirname(out_path), exist_ok=True)
                with open(out_path, "wb") as bf:
                    bf.write(body)
                sha1 = hashlib.sha1(body).hexdigest()
                nbytes = len(body)
                fetched_ok += 1
                status_out = status
                path_out = out_rel
            else:
                fetched_fail += 1
                status_out = status if status is not None else "ERR"
                path_out = ""
                print(f"[fail] priority={row['priority']} {row['url']} @{row['ts']} -> "
                      f"{status_out} {err}", file=sys.stderr)

            manifest_f.write("\t".join([
                row["url"], row["ts"], str(status_out), str(nbytes), path_out, sha1,
                row["priority"], row["row_name"],
            ]) + "\n")
            manifest_f.flush()
            done_keys.add(key)

            if status is not None and status < 400:
                clean_streak += 1
                if clean_streak >= CLEAN_DECAY and spacing > SPACING_SECS:
                    spacing = max(SPACING_SECS, spacing * 0.75)
                    clean_streak = 0
                    print(f"[adaptive] spacing decays -> {spacing:.1f}s "
                          f"after {CLEAN_DECAY} clean fetches", file=sys.stderr)

            time.sleep(spacing)

    finally:
        manifest_f.close()

    elapsed = time.monotonic() - start
    print(f"COMPLETE elapsed={elapsed:.1f}s attempted={attempted} "
          f"ok={fetched_ok} fail={fetched_fail} skipped_already_done={skipped_done} "
          f"skipped_by_ledger={skipped_policy} final_spacing={spacing:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
