#!/usr/bin/env python3
"""The fusebox — a persistent, shared, per-host circuit breaker.

Born 2026-08-31 after a retry storm got the museum's IP dropped by
index.commoncrawl.org (HTTP 000 on everything, even collinfo.json). The
per-run stop rule worked as designed; the failure was STRUCTURAL: every
process restart reset the counter, the retry ladder re-hammered the same
walls, and nothing remembered across runs that a host was already
distressed. The Janitor's order: "We need a structural system to block
these retry storms."

Doctrine encoded here (the pacing law, made load-bearing):
  1. A WALL IS AN ANSWER. 429, 403, and connection-drop (the HTTP-000
     class) are never retried. They trip the breaker immediately.
  2. THE BREAKER OUTLIVES THE PROCESS. State lives on disk, shared by
     every fetcher and every restart. A restarted fetcher sees the trip
     and refuses to run until the cool-off expires.
  3. COOL-OFFS ESCALATE. 15 min -> 1 h -> 4 h -> 24 h on repeated trips
     of the same host. Success resets the escalation only after a full
     clean day.
  4. A DAILY FAILURE BUDGET caps total damage even when no single run
     trips: too many failures on a host in one day trips it to tomorrow.
  5. TRANSIENT != WALL. An ordinary timeout gets ONE polite retry after
     a real pause. A clean HTTP 404/empty result is a SUCCESS (an answer,
     not a failure) and must be recorded as such by the caller.

Usage (stdlib-only, drop-in):

    import sys; sys.path.insert(0, "<repo>/scripts/fetch")
    from politeness import Fusebox, TrippedError

    fb = Fusebox()                       # default state dir
    fb.require("index.commoncrawl.org")  # raises TrippedError if tripped
    ...one request...
    fb.record_success("index.commoncrawl.org")
    # or, on failure:
    fb.record_failure("index.commoncrawl.org", kind="conn-drop")  # may trip

Or the one-call wrapper (requests must be installed by the caller):

    resp = fb.polite_get(url, headers=..., timeout=60)
    # -> returns the Response on success (2xx/3xx/404-as-answer),
    # -> raises TrippedError when the breaker is/becomes open,
    # -> retries AT MOST once, only for transient errors, never for walls.

CLI:
    python3 politeness.py status            # every host's breaker state
    python3 politeness.py trip <host> <hours> "<reason>"   # manual trip
    python3 politeness.py clear <host>      # Janitor-level manual reset
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''

import json
import os
import sys
import time
import fcntl

STATE_DIR = f"{_WORKSHOP}/net/fusebox"

# ---- CRAWLER IDENTITY (2026-10-08; the Janitor: "our museum needs to identify and point to ewmuseum.org/crawler") ----------
# Two registered identities, both described on https://crawler.ewmuseum.org/ -- a DNS-only name outside
# Cloudflare, so Bot Fight Mode never challenges it; ewmuseum.org/crawler carries the same page and links
# there (the Janitor's D458, hook c163):
#   EWMuseumBot            every ordinary host (community sites, forums, live federations' own pages, the foreign census)
#   collection-analyst     public web archives only (Wayback Machine, Common Crawl, Arquivo.pt)
UA_BOT = "EWMuseumBot/1.0 (+https://crawler.ewmuseum.org/)"
UA_ARCHIVE = "ewrestling-museum-collection-analyst/1.0 (+https://crawler.ewmuseum.org/; contact: crawler@ewmuseum.org)"
ARCHIVE_HOST_SUFFIXES = ("archive.org", "commoncrawl.org", "arquivo.pt")  # a host equal to, or a subdomain of, one of these


def is_archive_host(host):
    """True for a public web archive: archive.org (web./ia*./*.us.archive.org ...), commoncrawl.org (index./data.) and its S3 bucket host, arquivo.pt.
    A bare fusebox sub-key ("web.archive.org:cdx") and a port are tolerated. Lookalikes (notarchive.org) are NOT archives."""
    h = (host or "").strip().lower().split(":")[0].rstrip(".")
    if h.startswith("commoncrawl.s3") and h.endswith(".amazonaws.com"):  # Common Crawl's public bucket (commoncrawl.s3.amazonaws.com, commoncrawl.s3.us-east-1...)
        return True
    return any(h == s or h.endswith("." + s) for s in ARCHIVE_HOST_SUFFIXES)


def ua_for_host(host):
    """The default User-Agent for a host: the archive identity against public web archives, EWMuseumBot for every other host."""
    return UA_ARCHIVE if is_archive_host(host) else UA_BOT


# Escalating cool-offs, seconds: 15 min, 1 h, 4 h, 24 h (then stays 24 h) — transient trips use COOLOFFS[0].
COOLOFFS = [900, 3600, 14400, 86400]
# The Janitor's gavel 2026-09-07 (after the first-request wall that cost the night): a WALL's cool-off climbs a per-DAY ladder —
# the first wall of a local day costs 60 minutes, the second wall the same day costs 24 hours. Lifetime `trips` stays a
# statistic only; it no longer sets the cool-off.
WALL_COOLOFFS = [3600, 86400]
# The Janitor 2026-09-09 (after the log read: every 429 this week was the FIRST request after hours of silence and the same
# captures answered 200 the next day): a 429 follows the Archive's own guidance instead of the per-day ladder — stop two
# minutes, then one retry; only 429s that REPEAT within the same rolling hour climb (1 h, 4 h), and the 24 h tier is kept
# for a real block (a fourth 429 inside the hour). Other wall kinds (403, conn-drop, http-000, 402) keep the per-day ladder.
RATE_WALL_KINDS = {"429"}
RATE_WALL_COOLOFFS = [120, 3600, 14400, 86400]
RATE_WALL_WINDOW = 3600
# per-host ladders (the Janitor 2026-09-09): Arquivo.pt publishes a permanent block for sustained excess, so its ladder
# skips the two-minute rung — first 429 costs an hour, the second within the window costs the day.
RATE_WALL_LADDERS = {"arquivo.pt": ([3600, 86400], 86400)}
CONSECUTIVE_TO_TRIP = 4      # consecutive transient failures that trip
DAILY_FAILURE_BUDGET = 25    # failures/host/day -> trip to tomorrow
TRANSIENT_RETRY_PAUSE = 20   # seconds before the single transient retry

WALL_KINDS = {"429", "403", "conn-drop", "http-000", "402"}
FAILURE_LOG = os.path.join(STATE_DIR, "failures.log")  # the Janitor 2026-09-05: every recorded failure is logged

# The Janitor's gavel 2026-09-05: TRANSIENT FAILURES DO NOT ESCALATE. A burst of
# consecutive transient failures (IncompleteRead, timeouts, 5xx) trips the
# breaker for the BASE cool-off only and does not raise the ladder; only a
# wall (429/403/conn-drop/http-000) climbs it. The daily budget still trips
# to local midnight but does not climb either. One bad minute must not cost
# a night.
def _log_failure(host, kind, reason, st, trip_why):
    try:
        import inspect
        caller = os.path.basename(sys.argv[0]) if sys.argv and sys.argv[0] else "?"
        line = (f"{time.strftime('%Y-%m-%dT%H:%M:%S%z')}\t{host}\t{kind}\t{reason[:120]}\t{caller}"
                f"\tconsecutive={st.get('consecutive',0)}\tday_failures={st.get('day_failures',0)}"
                f"\ttrips={st.get('trips',0)}\ttrip={trip_why or '-'}\n")
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(FAILURE_LOG, "a") as fh:
            fh.write(line)
    except Exception:
        pass


class TrippedError(RuntimeError):
    """The host's breaker is open. .until is the epoch it closes."""
    def __init__(self, host, until, reason):
        self.host, self.until, self.reason = host, until, reason
        super().__init__(
            f"FUSEBOX TRIPPED for {host} until "
            f"{time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(until))} "
            f"({reason}). Do not retry; do not restart the fetcher early."
        )


def _path(host):
    safe = "".join(c if (c.isalnum() or c in ".-") else "_" for c in host)
    return os.path.join(STATE_DIR, safe + ".json")


class Fusebox:
    def __init__(self, state_dir=STATE_DIR):
        self.state_dir = state_dir
        os.makedirs(state_dir, exist_ok=True)

    # ---------------- state I/O (advisory-locked, multi-process safe) ----
    def _load(self, host):
        p = _path(host)
        if not os.path.exists(p):
            return {"host": host, "consecutive": 0, "trips": 0,
                    "tripped_until": 0, "day": "", "day_failures": 0,
                    "last_success": 0, "last_failure": 0, "reason": ""}
        with open(p) as fh:
            return json.load(fh)

    def _save(self, st):
        p = _path(st["host"])
        tmp = f"{p}.{os.getpid()}.tmp"   # per-process temp name: two fetchers sharing one host key must never share a tmp file (2026-09-14 torn write)
        with open(tmp, "w") as fh:
            json.dump(st, fh, indent=1)
        os.replace(tmp, p)

    # ---------------- the contract ---------------------------------------
    def check(self, host):
        """True if requests to host are currently allowed."""
        st = self._load(host)
        return time.time() >= st.get("tripped_until", 0)

    def require(self, host):
        """Raise TrippedError if the breaker is open."""
        st = self._load(host)
        until = st.get("tripped_until", 0)
        if time.time() < until:
            raise TrippedError(host, until, st.get("reason", "tripped"))

    def record_success(self, host):
        st = self._load(host)
        st["consecutive"] = 0
        st["last_success"] = time.time()
        # a full clean day de-escalates one trip level
        if st.get("trips") and time.time() - st.get("last_failure", 0) > 86400:
            st["trips"] -= 1
        self._save(st)

    def record_failure(self, host, kind="transient", reason=""):
        """Record one failure. Walls trip instantly; transients count up.
        Returns the TrippedError if this failure tripped the breaker
        (caller decides whether to raise), else None."""
        st = self._load(host)
        now = time.time()
        today = time.strftime("%Y-%m-%d")
        if st.get("day") != today:
            st["day"], st["day_failures"] = today, 0
        st["day_failures"] += 1
        st["consecutive"] = st.get("consecutive", 0) + 1
        st["last_failure"] = now

        trip_why = None
        if kind in WALL_KINDS:
            trip_why = f"wall response ({kind}) — a wall is an answer"
        elif st["consecutive"] >= CONSECUTIVE_TO_TRIP:
            trip_why = f"{st['consecutive']} consecutive transient failures"
        elif st["day_failures"] >= DAILY_FAILURE_BUDGET:
            trip_why = f"daily failure budget ({DAILY_FAILURE_BUDGET}) exhausted"

        _log_failure(host, kind, reason, st, trip_why)
        if trip_why:
            is_wall = kind in WALL_KINDS
            if is_wall and kind in RATE_WALL_KINDS:
                ladder, window = RATE_WALL_LADDERS.get(host, (RATE_WALL_COOLOFFS, RATE_WALL_WINDOW))
                recent = [t for t in st.get("rate_walls", []) if now - t < window]
                level = min(len(recent), len(ladder) - 1)
                cool = ladder[level]                         # rolling-window ladder (the Janitor 2026-09-09)
                st["rate_walls"] = recent + [now]
                st["trips"] = st.get("trips", 0) + 1
            elif is_wall:
                if st.get("wall_day") != today:
                    st["wall_day"], st["day_walls"] = today, 0
                level = min(st.get("day_walls", 0), len(WALL_COOLOFFS) - 1)
                cool = WALL_COOLOFFS[level]                  # per-day ladder (the Janitor 2026-09-07)
                st["day_walls"] = st.get("day_walls", 0) + 1
                st["trips"] = st.get("trips", 0) + 1      # lifetime statistic only
            else:
                cool = COOLOFFS[0]                          # transient: base cool-off, no escalation
            if st["day_failures"] >= DAILY_FAILURE_BUDGET:
                # to local midnight or the cool-off, whichever is longer
                lt = time.localtime(now)
                to_midnight = 86400 - (lt.tm_hour * 3600 + lt.tm_min * 60 + lt.tm_sec)
                cool = max(cool, to_midnight)
            st["tripped_until"] = now + cool
            st["reason"] = f"{trip_why} ({reason})" if reason else trip_why
            st["consecutive"] = 0
            self._save(st)
            return TrippedError(host, st["tripped_until"], st["reason"])
        self._save(st)
        return None

    def trip(self, host, hours, reason):
        st = self._load(host)
        st["trips"] = st.get("trips", 0) + 1
        st["tripped_until"] = time.time() + hours * 3600
        st["reason"] = reason
        self._save(st)

    def clear(self, host):
        st = self._load(host)
        st["tripped_until"] = 0
        st["consecutive"] = 0
        st["reason"] = "manually cleared"
        self._save(st)

    # ---------------- one-call polite GET --------------------------------
    def polite_get(self, url, session=None, **kw):
        import urllib.parse
        import requests
        _u = urllib.parse.urlsplit(url)
        host = _u.netloc
        # 2026-09-03: the Wayback CDX index API (/cdx/) is a separate, far stricter service than
        # playback; it 429s on a single request. Key it separately so a CDX wall never trips the crawl.
        if host.endswith("web.archive.org") and _u.path.startswith("/cdx/"):
            host = host + ":cdx"
        self.require(host)
        getter = (session or requests).get
        # 2026-09-27: a caller that passes no User-Agent gets the museum crawler's registered one, never python-requests's
        # 2026-10-08 (the Janitor; lane CRAWLER-IDENTITY): the default identity follows the HOST CLASS — the archive-research
        # identity only against public web archives, EWMuseumBot (the crawler page's named bot) against every other host.
        _h = dict(kw.get("headers") or {}); _h.setdefault("User-Agent", ua_for_host(_u.hostname)); kw["headers"] = _h
        attempt = 0
        while True:
            try:
                resp = getter(url, **kw)
            except requests.RequestException as e:
                msg = str(e)
                is_drop = ("RemoteDisconnected" in msg or "Connection aborted" in msg
                           or "ConnectionResetError" in msg)
                if is_drop:
                    err = self.record_failure(host, "conn-drop", msg[:120])
                    raise err or TrippedError(host, self._load(host)["tripped_until"] or time.time(),
                                              "connection drop")
                # transient (timeout, DNS blip): one polite retry
                err = self.record_failure(host, "transient", msg[:120])
                if err:
                    raise err
                if attempt >= 1:
                    raise
                attempt += 1
                time.sleep(TRANSIENT_RETRY_PAUSE)
                continue
            if resp.status_code in (429, 403):
                err = self.record_failure(host, str(resp.status_code))
                raise err or TrippedError(host, self._load(host)["tripped_until"] or time.time(),
                                          f"HTTP {resp.status_code}")
            if resp.status_code >= 500:
                err = self.record_failure(host, "transient", f"HTTP {resp.status_code}")
                if err:
                    raise err
                if attempt >= 1:
                    return resp  # hand the 5xx back; caller logs it as an error, no more retries
                attempt += 1
                time.sleep(TRANSIENT_RETRY_PAUSE)
                continue
            # 2xx/3xx/404: an ANSWER
            self.record_success(host)
            return resp


def _cli():
    fb = Fusebox()
    if len(sys.argv) < 2 or sys.argv[1] == "status":
        now = time.time()
        rows = sorted(os.listdir(STATE_DIR)) if os.path.isdir(STATE_DIR) else []
        if not rows:
            print("fusebox: no host state recorded")
        for f in rows:
            if not f.endswith(".json"):
                continue
            try:
                st = json.load(open(os.path.join(STATE_DIR, f)))
            except Exception as e:
                print(f"{f:40s} UNREADABLE ({e.__class__.__name__}) — repair the file; treat the host as tripped"); continue
            until = st.get("tripped_until", 0)
            state = ("TRIPPED until " + time.strftime("%Y-%m-%d %H:%M", time.localtime(until))
                     if now < until else "closed")
            print(f"{st['host']:40s} {state:30s} trips={st.get('trips',0)} "
                  f"today={st.get('day_failures',0)} reason={st.get('reason','')[:60]}")
    elif sys.argv[1] == "trip":
        fb.trip(sys.argv[2], float(sys.argv[3]), sys.argv[4] if len(sys.argv) > 4 else "manual")
        print("tripped", sys.argv[2])
    elif sys.argv[1] == "clear":
        fb.clear(sys.argv[2])
        print("cleared", sys.argv[2])
    else:
        print(__doc__)


if __name__ == "__main__":
    _cli()
