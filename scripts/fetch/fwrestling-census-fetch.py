#!/usr/bin/env python3
"""
Resumable Wayback fetcher for the fwrestling census's fetch-plan.tsv.

- Reads fetch-plan.tsv (tier, rank, url, timestamp, family, host, tenant,
  thread_id, forum_id, page, year, digest, length), in tier/rank order.
- Skips rows already present in manifest.tsv (matched by url + timestamp).
- Fetches https://web.archive.org/web/<ts>id_/<original> -- the id_ suffix
  serves raw captured bytes, no Wayback chrome (PROCESS.md's Wayback mechanics).
- One request at a time. Adaptive spacing: 3.0s base, doubling (to a 12s
  ceiling) on any 429/503 and decaying back only after 50 clean fetches;
  still backs off 15s per retry and pauses 3 minutes after three
  CONSECUTIVE 503s. Raise SPACING_SECS to 3.5 if pauses/ERRs warrant.
- Honors skip-ledger.tsv (same-day session-id dedupe, make-skip-ledger.py):
  retired rows are counted, never fetched; delete the ledger to restore them.
- Retries each URL up to 5 times (covers all errors: HTTP, timeout, connection).
- Saves body under raw/<host>/<sanitized-path>__<ts>.html.
- Appends one manifest.tsv line immediately per fetch (crash-safe: url, ts,
  status, bytes, path, sha1).
- Stops cleanly once --max-seconds has elapsed since start, prints a
  completion line with counts, and exits 0.
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
# NOTE: call FUSEBOX.require(host)/record_* around requests in this script's fetch loop.


# The collection tree this fetcher works in. The script itself lives in the repo;
# its plan, manifest and raw captures live in the workshop, beside the material.
BASE_DIR = os.environ.get('FETCH_BASE_DIR') or os.path.join(_WORKSHOP, 'fwrestling-census')
PLAN_PATH = os.path.join(BASE_DIR, "fetch-plan.tsv")
MANIFEST_PATH = os.path.join(BASE_DIR, "manifest.tsv")
RAW_DIR = os.path.join(BASE_DIR, "raw")

SPACING_SECS = 4.0
# 2026-09-03 LATE-WINDOW RAMP (the Janitor): the 04:51 PT wall came in the last hour of an 8-h window with
# per-chunk throughput already falling; from 02:30 PT the base spacing rises to 5 s (IA's US-East morning).
import datetime as _dt, zoneinfo as _zi
try:
    if _dt.datetime.now(_zi.ZoneInfo("America/Los_Angeles")).hour >= 2 and _dt.datetime.now(_zi.ZoneInfo("America/Los_Angeles")).hour < 6:
        SPACING_SECS = max(SPACING_SECS, 5.0)
except Exception:
    pass      # raised 3.5->4.0 (2026-08-31, the Janitor's pacing law: "aim for 3.5 or 4 seconds; I feel like the problems started when we went to 3 sec" -- top of range chosen for this campaign given its 429 history; prior note: raised 3.0->3.5 2026-08-24)
SPACING_MAX = 12.0      # adaptive ceiling
CLEAN_DECAY = 50        # clean fetches before spacing decays back toward base
BACKOFF_SECS = 15.0
LONG_PAUSE_SECS = 180.0
TIMEOUT_SECS = 60
MAX_RETRIES = 5
USER_AGENT = "ewrestling-museum-collection-analyst/1.0 (+https://crawler.ewmuseum.org/; contact: crawler@ewmuseum.org)"  # IA-facing: the archive-research identity (2026-08-29; the smartial-article review). This fetcher only touches web.archive.org, so it keeps the archive identity; live community sites are crawled as EWMuseumBot (2026-10-08, the crawler page crawler.ewmuseum.org).


def sanitize_path_component(url):
    """Turn a full original URL into a filesystem-safe path suffix (no host)."""
    # strip scheme+host, keep path+query for uniqueness
    m = re.match(r"^https?://[^/]+(/.*)?$", url)
    tail = m.group(1) if m and m.group(1) else "/"
    tail = tail.lstrip("/")
    if not tail:
        tail = "index"
    # replace unsafe chars, cap length
    safe = re.sub(r"[^A-Za-z0-9_.\-/]", "_", tail)
    safe = safe.replace("/", "__")
    if len(safe) > 180:
        h = hashlib.sha1(safe.encode("utf-8", "replace")).hexdigest()[:12]
        safe = safe[:160] + "__" + h
    return safe


def load_manifest_keys():
    """Rows that succeeded (status < 400) are done for good. Rows that failed after
    all retries (status ERR or >=400) are NOT treated as permanently done -- they
    stay eligible so the next resume retries them (most failures here are transient
    network blips, not permanent 404s from a bad plan row)."""
    seen = set()
    if os.path.exists(MANIFEST_PATH):
        with open(MANIFEST_PATH, encoding="utf-8", errors="replace") as f:
            for line in f:
                parts = line.rstrip("\n").split("\t")
                if len(parts) < 3:
                    continue
                url, ts, status = parts[0], parts[1], parts[2]
                if status in ("404", "410", "403"):
                    seen.add((url, ts))  # 2026-09-13: an exact-memento 403 is a tombstone too (see the URL walk's fetch.py)  # a Wayback 404/410 for an exact timestamp is a tombstone: permanent, never retried (2026-09-11: twelve trickle bursts burned on one dead 2009 GeoCities capture)
                    continue
                if status == "ERR" or (status.isdigit() and int(status) >= 400):
                    continue
                seen.add((url, ts))
    return seen


def load_skip_ledger():
    """(url, ts) rows retired by the same-day dedupe policy (make-skip-ledger.py).
    Reversible: delete skip-ledger.tsv and every row is eligible again."""
    skips = set()
    # Two ledgers, same key shape (url, plan-timestamp), both reversible by
    # deleting the file: skip-ledger.tsv (same-day session-token dedupe) and
    # cc-covered-ledger.tsv (rows already recovered from Common Crawl by the
    # Phase-2 supplement, 2026-08-24 — content lives in raw-cc/ + manifest-cc.tsv).
    # chrome-ledger.tsv (vBulletin chrome families, the Janitor's gavel 2026-08-31) and
    # spam-ledger.tsv (/site/ squat-spam era, same gavel) join the retirement set.
    for name in ("skip-ledger.tsv", "cc-covered-ledger.tsv", "chrome-ledger.tsv", "spam-ledger.tsv",
                 "tier-e-retire-high.tsv", "tier-e-retire-medium.tsv", "blog-dedup-ledger.tsv", "tier-d-retire-panel.tsv"):  # tier-e triage, the Janitor's gavel 2026-09-01; sample-verified
        path = os.path.join(BASE_DIR, name)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                f.readline()
                for line in f:
                    parts = line.rstrip("\n").split("\t")
                    if len(parts) >= 2:
                        skips.add((parts[0], parts[1]))
    return skips


def load_plan(tiers=None):
    rows = []
    with open(PLAN_PATH, encoding="utf-8") as f:
        header = f.readline()
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 13:
                continue
            tier, rank, url, ts, family, host = parts[0:6]
            if tiers and tier not in tiers:
                continue
            rows.append({"tier": tier, "rank": rank, "url": url, "ts": ts,
                         "family": family, "host": host})
    return rows


IA_HOST = "web.archive.org"


def fetch_one(url, ts):
    """Return (status_code_or_None, body_bytes_or_None, error_str_or_None).
    Fusebox law (2026-08-31): the breaker is consulted before EVERY request
    and fed after it — 429/403/conn-drop trips instantly (a wall is an
    answer), transients count toward the consecutive/daily budgets, and a
    TrippedError propagates up to halt the run cleanly. IA is the museum's
    most important collection relationship; it gets the strictest care."""
    global _CONSEC_403
    FUSEBOX.require(IA_HOST)
    wb_url = f"https://web.archive.org/web/{ts}id_/{url}"
    req = urllib.request.Request(wb_url, headers={"User-Agent": USER_AGENT})
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
                    _f.write(f"== {time.strftime('%F %T')} {wb_url}\n".encode() + (body or b"(empty body)")[:3000] + b"\n")
            except Exception:
                pass
        if e.code == 403 and ((body and EXCLUSION_RE.search(body[:20000])) or (not body and _CONSEC_403 == 0)):
            # an exclusion notice, or a lone EMPTY-body 403 on a raw (id_) request, is an answer about that capture — a tombstone.
            # Two 403s in a row with no success between them are treated as a wall (2026-09-15 00:19 ruling, ia-403-bodies.log).
            _CONSEC_403 += 1
            FUSEBOX.record_success(IA_HOST)
            return e.code, body, "HTTPError 403 (excluded capture — tombstone, not a wall)"
        if e.code in (429, 403):
            err = FUSEBOX.record_failure(IA_HOST, str(e.code), url[:100])
            if err:
                raise err
        else:
            FUSEBOX.record_success(IA_HOST)  # 404/500-class = an answer from a healthy server
        return e.code, body, f"HTTPError {e.code}"
    except TrippedError:
        raise
    except Exception as e:
        # 2026-09-05 (the holiday-weekend "strain"): every IncompleteRead that tripped the breaker was
        # Wayback's own "File Not Found" page for one capture, sent with a Content-Length one byte long —
        # an ANSWER from a healthy server, not strain. Treat a complete-looking short HTML body as the
        # 404 it is: record success, return 404, move on. Only a genuinely truncated body stays transient.
        partial = getattr(e, "partial", None)
        if partial is not None and (b"File Not Found" in partial or b"not found on this server" in partial.lower() or (len(partial) < 600 and b"</body>" in partial.lower())):
            FUSEBOX.record_success(IA_HOST)
            return 404, partial, "HTTPError 404 (short body, length off by one)"
        try:
            if partial is not None:
                with open("ia-partial-bodies.log", "a") as _d:
                    _d.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')}\t{wb_url[:160]}\t{len(partial)}\t{partial[:300]!r}\n")
        except Exception:
            pass
        kind = "conn-drop" if any(k in str(e) for k in ("RemoteDisconnected","Connection reset","ConnectionReset")) else "transient"
        err = FUSEBOX.record_failure(IA_HOST, kind, f"{type(e).__name__}"[:60])
        if err:
            raise err
        return None, None, f"{type(e).__name__}: {e}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-seconds", type=float, default=540)
    ap.add_argument("--tiers", type=str, default=None,
                     help="comma-separated tier letters to restrict to, e.g. a,b")
    ap.add_argument("--limit", type=int, default=None,
                     help="stop after this many NEW fetch attempts (testing)")
    ap.add_argument("--errs-only", action="store_true",
                     help="restrict to rows currently at ERR status in the manifest "
                          "(any tier) -- a quick priority pass to clear the retry "
                          "backlog without walking the whole plan in tier order")
    args = ap.parse_args()

    tiers = set(args.tiers.split(",")) if args.tiers else None

    os.makedirs(RAW_DIR, exist_ok=True)

    start = time.monotonic()
    done_keys = load_manifest_keys()
    plan = load_plan(tiers)

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

    print(f"plan rows (tier filter={tiers}): {len(plan)}; already in manifest: {len(done_keys)}",
          file=sys.stderr)

    skip_keys = load_skip_ledger()
    print(f"skip ledger: {len(skip_keys)} same-day-dupe rows retired", file=sys.stderr)

    attempted = 0
    fetched_ok = 0
    fetched_fail = 0
    skipped_done = 0
    skipped_policy = 0
    consecutive_503 = 0
    spacing = SPACING_SECS   # adaptive: doubles on 429/503, decays after CLEAN_DECAY clean fetches
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
            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    try:
                        status, body, err = fetch_one(row["url"], row["ts"])
                    except TrippedError:
                        # 2026-09-15: record the walled attempt as an ERR row so a capture that walls on every attempt reaches
                        # the auto-park threshold (3) instead of tripping the breaker at the head of every burst
                        with open(MANIFEST_PATH, "a", encoding="utf-8") as _mf: _mf.write("\t".join([row["url"], row["ts"], "ERR", "0", "", "", str(row.get("tier", "")), "wall"]) + "\n")
                        raise
                except TrippedError:
                    # 2026-09-06 (L157, after L155's ia-window-analysis): a TrippedError
                    # propagates straight out of main() before the per-row manifest_f.write()
                    # below ever runs, so the row that tripped the breaker stayed invisible
                    # to load_manifest_keys()/load_skip_ledger() on the next resume --
                    # indistinguishable from a never-tried row. That let the same dead
                    # capture burn through the retry ladder twice on 2026-09-05, once per
                    # window. Quarantine this exact row in skip-ledger.tsv (reversible: a
                    # human can delete the line) before propagating, so no future resume
                    # ever starts a fetch on it again.
                    try:
                        with open(os.path.join(BASE_DIR, "skip-ledger.tsv"), "a", encoding="utf-8") as _sk:
                            _sk.write("\t".join([
                                row["url"], row["ts"], row["tier"], "", "",
                                "auto-quarantined-on-breaker-trip",
                            ]) + "\n")
                    except Exception:
                        pass
                    raise
                if status is not None and status < 400:
                    consecutive_503 = 0
                    break
                if status in (429, 503):
                    clean_streak = 0
                    if spacing < SPACING_MAX:
                        spacing = min(SPACING_MAX, spacing * 2)
                        print(f"[adaptive] spacing -> {spacing:.1f}s after {status}",
                              file=sys.stderr)
                    consecutive_503 += 1
                    if consecutive_503 >= 3:
                        print(f"[pause] 3 consecutive 429/503s -- sleeping "
                              f"{LONG_PAUSE_SECS:.0f}s", file=sys.stderr)
                        time.sleep(LONG_PAUSE_SECS)
                        consecutive_503 = 0
                    else:
                        time.sleep(BACKOFF_SECS)
                else:
                    consecutive_503 = 0
                    time.sleep(min(BACKOFF_SECS, SPACING_SECS * attempt))
                if attempt < MAX_RETRIES:
                    continue

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
                print(f"[fail] tier={row['tier']} {row['url']} @{row['ts']} -> "
                      f"{status_out} {err}", file=sys.stderr)

            manifest_f.write("\t".join([
                row["url"], row["ts"], str(status_out), str(nbytes), path_out, sha1,
                row["tier"], row["family"],
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
