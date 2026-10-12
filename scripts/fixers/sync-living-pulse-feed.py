#!/usr/bin/env python3
"""Standing preflight fixer (hook c100, lane LIVING-PULSE-ICS, 2026-10-06): carry the living pulse's public upcoming-shows feed
from the workshop into the served tree.

THE RULING. The Janitor, desk D408 (2026-10-07T03:03Z): "(b) a public feed on the ungated path". GAVELS 2026-10-06 (D406-D410):
the living pulse's upcoming-shows calendar is published as a public .ics outside the invite gate, beside /crawler; it carries the
fed name, the show title, the date and the fed's own link, and nothing of a living fed's content (living feds are
collect-never-serve, v75; this calendar is the one ruled exception).

WHAT. Source: $WORKSHOP_ROOT/living-preservation/upcoming.ics, written by the workshop's living-pulse.py
(weekly cron; `living-pulse.py ics` re-renders it with no network). Target: $MUSEUM_ROOT/crawler/upcoming.ics, served ungated at
/crawler/upcoming.ics by worker/index.mjs (PUBLIC_FEED, hook c100). No cron ever writes under museum/: this fixer is the only
way the feed reaches the tree, at preflight, inside the cycle.

THE SHAPE GUARD (collect-never-serve). The source is copied only if it is exactly the D408 shape: a VCALENDAR whose properties are
VERSION, PRODID, CALSCALE, METHOD, X-WR-CALNAME, and whose components are VEVENTs carrying ONLY UID, DTSTAMP, DTSTART;VALUE=DATE,
SUMMARY, URL (http/https) and DESCRIPTION equal to the one fixed sentence; CRLF lines; at most 512 KB and 1,000 events. Anything
else (a new property, a card, a result, a description of the show) is refused: the target is left as it is and the fixer exits
1 (fixers are advisory; preflight logs it). The guard reads the feed; it never rewrites a field.

PAST EVENTS DROP OFF HERE TOO. The pulse runs weekly; a show dated before today (this machine's date, as the pulse's) is dropped
at copy time so the served feed is never a week stale. The kept events are copied byte for byte.

IDEMPOTENT. The target is written (atomically) only when its bytes would change; a second run, or a run with an unchanged feed,
writes nothing. No source: the target is left as it is (exit 0).
"""
import datetime as _dt
import os as _os
import re as _re
import sys as _sys

_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
SRC = _os.path.join(_WORKSHOP, 'living-preservation', 'upcoming.ics')
DST = _os.path.join(_ROOT, 'crawler', 'upcoming.ics')
TAG = 'sync-living-pulse-feed'
DESCRIPTION = "Listed from the fed's own site by the E-Wrestling Museum"
CAL_PROPS = {'VERSION', 'PRODID', 'CALSCALE', 'METHOD', 'X-WR-CALNAME'}
EV_PROPS = {'UID', 'DTSTAMP', 'DTSTART', 'SUMMARY', 'URL', 'DESCRIPTION'}
MAX_BYTES, MAX_EVENTS = 512 * 1024, 1000


def refuse(why):
    print(f'{TAG}: REFUSED ({why}); {DST} left as it is')
    _sys.exit(1)


def main():
    today = _dt.date.today()
    if _os.environ.get('C100_TODAY'):   # scratch proof only: pin "today"
        today = _dt.date.fromisoformat(_os.environ['C100_TODAY'])
    if not _os.path.exists(SRC):
        print(f'{TAG}: no feed at {SRC}; nothing to do')
        return 0
    raw = open(SRC, 'rb').read()
    if len(raw) > MAX_BYTES:
        refuse(f'source is {len(raw)} bytes')
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        refuse('source is not UTF-8')
    if not text.endswith('\r\n') or _re.search(r'(?<!\r)\n|\r(?!\n)', text):
        refuse('source lines are not CRLF')
    phys = text[:-2].split('\r\n')
    # logical lines, each with its raw physical lines (kept byte for byte)
    logical = []
    for pl in phys:
        if pl[:1] in (' ', '\t') and logical:
            logical[-1][0] += pl[1:]
            logical[-1][1].append(pl)
        else:
            logical.append([pl, [pl]])
    def nv(s):
        m = _re.match(r'^([A-Za-z0-9-]+)((?:;[^:]*)?):(.*)$', s)
        return (m.group(1).upper(), m.group(2).upper(), m.group(3)) if m else (None, None, None)
    if not logical or logical[0][0] != 'BEGIN:VCALENDAR' or logical[-1][0] != 'END:VCALENDAR':
        refuse('not one VCALENDAR')
    head, events, cur = [], [], None
    for s, rawl in logical[1:-1]:
        name, params, value = nv(s)
        if name is None:
            refuse('a line that is not a content line')
        if cur is None:
            if name == 'BEGIN' and value == 'VEVENT':
                cur = {'raw': list(rawl), 'props': {}}
            elif name in CAL_PROPS and not params:
                if events:
                    refuse('a calendar property after the first event')
                head.extend(rawl)
            else:
                refuse(f'calendar-level {name}')
        else:
            cur['raw'].extend(rawl)
            if name == 'END' and value == 'VEVENT':
                p = cur['props']
                if set(p) != EV_PROPS:
                    refuse('an event without exactly UID, DTSTAMP, DTSTART, SUMMARY, URL, DESCRIPTION')
                if p['DESCRIPTION'] != ('', DESCRIPTION.replace(',', '\\,').replace(';', '\\;')):
                    refuse('an event DESCRIPTION other than the fixed sentence')
                if p['DTSTART'][0] != ';VALUE=DATE' or not _re.fullmatch(r'\d{8}', p['DTSTART'][1]):
                    refuse('an event DTSTART that is not a date')
                if not _re.match(r'^https?://[^\s"<>\\^`{|}]+$', p['URL'][1]) or p['URL'][0]:
                    refuse('an event URL that is not http(s)')
                if any(p[k][0] for k in ('UID', 'DTSTAMP', 'SUMMARY', 'DESCRIPTION')):
                    refuse('a parameter on an event property')
                events.append(cur)
                cur = None
            elif name in EV_PROPS and name not in cur['props']:
                cur['props'][name] = (params, value)
            else:
                refuse(f'event property {name}')
    if cur is not None:
        refuse('an unclosed VEVENT')
    if len(events) > MAX_EVENTS:
        refuse(f'{len(events)} events')
    keep = []
    for e in events:
        try:
            d = _dt.datetime.strptime(e['props']['DTSTART'][1], '%Y%m%d').date()
        except ValueError:
            refuse('an event DTSTART that is not a real date')
        if d >= today:
            keep.append(e)
    out_lines = ['BEGIN:VCALENDAR'] + head + [l for e in keep for l in e['raw']] + ['END:VCALENDAR']
    data = ('\r\n'.join(out_lines) + '\r\n').encode('utf-8')
    try:
        if open(DST, 'rb').read() == data:
            print(f'{TAG}: {len(keep)} upcoming, {len(events) - len(keep)} past dropped; unchanged')
            return 0
    except FileNotFoundError:
        pass
    _os.makedirs(_os.path.dirname(DST), exist_ok=True)
    tmp = f'{DST}.{_os.getpid()}.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    _os.replace(tmp, DST)
    print(f'{TAG}: {len(keep)} upcoming, {len(events) - len(keep)} past dropped; written to {DST}')
    return 0


if __name__ == '__main__':
    _sys.exit(main())
