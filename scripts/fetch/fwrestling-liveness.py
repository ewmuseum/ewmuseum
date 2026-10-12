#!/usr/bin/env python3
"""fwrestling liveness probe (the Janitor 2026-09-14: many fwrestling subdomains and apex paths are still live while the primary
site is not). One polite GET per target through the fusebox (key: fwrestling.com — one server behind every vhost),
2.5 s spacing, identified UA, resume by target. Targets: every distinct *.fwrestling.com host in the fetch plan (cpanel.*
dropped, www. folded) + every apex path prefix (/host/<t>/, /site/<t>/, /fwc/<t>/, /content/, /news/, ...).
Verdict per target: alive (2xx, real body), parked/landing, page-gone (404/410), host-gone (DNS/connect fail), redirect-off
(3xx to another site), unclear (5xx/timeout). Output: liveness-<date>.tsv in the census's own workshop folder."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import csv, re, sys, time, socket, urllib.request, urllib.error, urllib.parse, os, html, datetime, collections
sys.path.insert(0, _TOOLS); from politeness import Fusebox, TrippedError
A = f'{_WORKSHOP}'; PLAN = f'{A}/fwrestling-census/fetch-plan.tsv'
OUT = f'{A}/fwrestling-census/liveness-{datetime.date.today()}.tsv'
UA = {'User-Agent': 'EWMuseumBot/1.0 (+https://crawler.ewmuseum.org/)'}
SLEEP = float(os.environ.get('SLEEP', '2.5')); LIMIT = int(os.environ.get('LIMIT', '0'))
hosts, prefixes = set(), set()
for r in csv.DictReader(open(PLAN, encoding='utf-8'), delimiter='\t'):
    h = r['host'].split(':')[0].lower()
    if not h.endswith('fwrestling.com') or h.startswith('cpanel.') or h.startswith('webmail.') or h.startswith('mail.'): continue
    h = h[4:] if h.startswith('www.') else h
    if h != 'fwrestling.com': hosts.add(h); continue
    p = urllib.parse.urlparse(r['url']).path
    segs = [s for s in p.split('/') if s]
    if not segs: continue
    if segs[0] in ('host', 'site', 'fwc', 'forums', 'forum', 'boards', 'members', 'feds', 'archives') and len(segs) > 1 and '.' not in segs[1]:
        prefixes.add(f'/{segs[0]}/{segs[1]}/')
    elif '.' not in segs[0]: prefixes.add(f'/{segs[0]}/')
targets = [f'http://{h}/' for h in sorted(hosts)] + [f'http://fwrestling.com{p}' for p in sorted(prefixes)]
done = set()
if os.path.exists(OUT): done = {r['target'] for r in csv.DictReader(open(OUT, encoding='utf-8'), delimiter='\t')}
else: open(OUT, 'w', encoding='utf-8').write('target\tverdict\tstatus\tfinal_url\tbytes\ttitle\tchecked\n')
todo = [t for t in targets if t not in done]
print(f'{len(hosts)} hosts + {len(prefixes)} apex prefixes = {len(targets)} targets, {len(todo)} to probe → {OUT}', flush=True)
fb = Fusebox(); KEY = 'fwrestling.com'
PARKED = re.compile(r'(domain (is|may be) for sale|buy this domain|parked|sedoparking|hugedomains|afternic|account suspended|site not found|this site can.t be reached|default web site page|web hosting by)', re.I)
def probe(t):
    host = urllib.parse.urlparse(t).netloc
    try: socket.gethostbyname(host)
    except Exception as e: return ('host-gone', 'dns', '', 0, '')
    try:
        with urllib.request.urlopen(urllib.request.Request(t, headers=UA), timeout=15) as r:
            body = r.read(300000); st = r.status; fin = r.geturl()
    except urllib.error.HTTPError as e:
        return ('page-gone' if e.code in (404, 410) else ('forbidden' if e.code in (401, 403) else 'unclear'), str(e.code), e.geturl() or '', 0, '')
    except (urllib.error.URLError, socket.timeout, ConnectionError, OSError) as e:
        return ('host-gone' if 'refused' in str(e).lower() or 'name' in str(e).lower() else 'unclear', 'err', '', 0, str(e)[:60])
    txt = body.decode('utf-8', 'replace'); m = re.search(r'<title[^>]*>(.*?)</title>', txt, re.I | re.S)
    title = html.unescape(re.sub(r'\s+', ' ', m.group(1))).strip()[:90] if m else ''
    fh = urllib.parse.urlparse(fin).netloc.lower()
    if not fh.endswith('fwrestling.com'): return ('redirect-off', str(st), fin, len(body), title)
    if PARKED.search(txt[:5000]) or len(body) < 200: return ('parked', str(st), fin, len(body), title)
    return ('alive', str(st), fin, len(body), title)
n = 0
for t in todo:
    if LIMIT and n >= LIMIT: break
    try: fb.require(KEY)
    except TrippedError as e: print('fusebox tripped:', e, flush=True); break
    v = probe(t)
    if v[0] in ('unclear',) and v[1] not in ('err',): fb.record_failure(KEY, 'transient', v[1])
    elif v[1] in ('429',): fb.record_failure(KEY, 'wall', '429')
    else: fb.record_success(KEY)
    with open(OUT, 'a', encoding='utf-8') as f: f.write('\t'.join([t, v[0], v[1], v[3] and v[2] or v[2], str(v[3]), v[4].replace('\t', ' '), time.strftime('%F %T')]) + '\n')
    n += 1; print(f'[{n}/{len(todo)}] {v[0]:12} {v[1]:>4} {t} {v[4][:40]}', flush=True)
    time.sleep(SLEEP)
c = collections.Counter(r['verdict'] for r in csv.DictReader(open(OUT, encoding='utf-8'), delimiter='\t'))
print('verdicts so far:', dict(c), flush=True)
