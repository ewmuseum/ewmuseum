#!/usr/bin/env python3
"""Polite whole-site mirror for LIVE sites (coordinator, 2026-09-14; living-preservation clause: collect, never serve while alive).
    python3 site-mirror.py <start-url> [--max-pages N] [--sleep S] [--key HOST] [--out DIR]
Crawls breadth-first within the start URL's host AND path prefix (http://fwrestling.com/host/xwa/ stays under /host/xwa/),
fetching every same-scope link (pages + assets: html, css, js, images, txt, pdf, zip) through the fusebox (key defaults to
the registrable domain so every vhost of one server shares one breaker), identified UA, default 3 s spacing, robots.txt
honoured, 429/403 = fusebox failure and stop. Saves raw bytes under <out>/<host>/<path> (index.html for directories, query
strings hashed), plus manifest.tsv (url, file, status, bytes, content-type, fetched) and a resume set — rerunning the same
start URL continues where it stopped. Never rewrites links; the manifest is the map."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import sys, os, re, time, hashlib, urllib.request, urllib.error, urllib.parse, argparse, html
sys.path.insert(0, _TOOLS); from politeness import Fusebox, TrippedError; from robots_ewbot import Robots
ap = argparse.ArgumentParser(); ap.add_argument('start'); ap.add_argument('--max-pages', type=int, default=4000)
ap.add_argument('--sleep', type=float, default=3.0); ap.add_argument('--key', default=None)
ap.add_argument('--out', default=f'{_WORKSHOP}/direct-collected/fwrestling'); a = ap.parse_args()
UA = {'User-Agent': 'EWMuseumBot/1.0 (+https://crawler.ewmuseum.org/)'}
start = a.start if a.start.endswith('/') or '.' in a.start.rsplit('/', 1)[-1] else a.start + '/'
u0 = urllib.parse.urlparse(start); host = u0.netloc.lower(); prefix = u0.path if u0.path.endswith('/') else u0.path.rsplit('/', 1)[0] + '/'
key = a.key or '.'.join(host.split('.')[-2:])
od = os.path.join(a.out, host + ('' if prefix == '/' else prefix.rstrip('/').replace('/', '__'))); os.makedirs(od, exist_ok=True)
man = os.path.join(od, 'manifest.tsv')
seen = set()
if os.path.exists(man):
    for l in open(man, encoding='utf-8').read().split('\n')[1:]:
        if l.strip(): seen.add(l.split('\t')[0])
else: open(man, 'w', encoding='utf-8').write('url\tfile\tstatus\tbytes\tcontent_type\tfetched\n')
rp = Robots()  # 2026-10-08: robots_ewbot.py -- the EWMuseumBot group, else '*'; read with OUR User-Agent
try: rp.read(f'{u0.scheme}://{host}/robots.txt', UA['User-Agent'])
except Exception: rp = None
def allowed(u):
    try: return rp is None or rp.can_fetch(u)
    except Exception: return True
def local_path(u):
    p = urllib.parse.urlparse(u); path = p.path or '/'
    if path.endswith('/'): path += 'index.html'
    if p.query: path += '__' + hashlib.sha1(p.query.encode()).hexdigest()[:10]
    return os.path.join(od, path.lstrip('/'))
def in_scope(u):
    p = urllib.parse.urlparse(u); h = p.netloc.lower()
    h = h[4:] if h.startswith('www.') else h
    hh = host[4:] if host.startswith('www.') else host
    return p.scheme in ('http', 'https') and h == hh and (p.path or '/').startswith(prefix)
LINK = re.compile(r'''(?:href|src|action|background)\s*=\s*["']?([^"'\s>]+)''', re.I)
CSSURL = re.compile(r'''url\(\s*["']?([^"')\s]+)''', re.I)
fb = Fusebox(); queue = [start]; qset = {start}; n = 0; t0 = time.time()
print(f'mirror {start} → {od} (scope {host}{prefix}, key {key}, {len(seen)} already fetched)', flush=True)
while queue and n < a.max_pages:
    u = queue.pop(0)
    if u in seen: continue
    if not allowed(u):
        open(man, 'a', encoding='utf-8').write(f'{u}\t\trobots\t0\t\t{time.strftime("%F %T")}\n'); seen.add(u); continue
    try: fb.require(key)
    except TrippedError as e: print('fusebox tripped, stopping:', e, flush=True); break
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=45) as r:
            body = r.read(); st = r.status; ct = r.headers.get('Content-Type', ''); fin = r.geturl()
        fb.record_success(key)
    except urllib.error.HTTPError as e:
        st, body, ct, fin = e.code, b'', '', u
        if e.code == 429 or (e.code == 403 and u == start):  # a 429, or a 403 on the START url, is a wall; a 403 on a sub-path is a page answer (forbidden listing)
            fb.record_failure(key, 'wall' if e.code == 429 else 'transient', str(e.code)); print(f'{e.code} on {u} — stopping', flush=True); open(man, 'a', encoding='utf-8').write(f'{u}\t\t{st}\t0\t\t{time.strftime("%F %T")}\n'); break
        fb.record_success(key)
    except Exception as e:
        st, body, ct, fin = 'err', b'', '', u; fb.record_failure(key, 'transient', str(e)[:40])
    seen.add(u); n += 1
    fp = ''
    if body:
        fp = local_path(fin if in_scope(fin) else u)
        d = os.path.dirname(fp)
        while d != od and os.path.isfile(d): d = os.path.dirname(d)  # a URL saved as a file blocks a same-named directory: rename the file
        if os.path.isfile(os.path.dirname(fp)): os.replace(os.path.dirname(fp), os.path.dirname(fp) + '__file')
        if os.path.isdir(fp): fp = fp + '__dir.html'
        os.makedirs(os.path.dirname(fp), exist_ok=True)
        with open(fp, 'wb') as f: f.write(body)
        if 'html' in ct or (not ct and body[:200].lower().find(b'<html') >= 0) or 'css' in ct:
            txt = body.decode('utf-8', 'replace')
            for m in list(LINK.finditer(txt)) + list(CSSURL.finditer(txt)):
                raw = html.unescape(m.group(1)).strip()
                if raw.startswith(('#', 'mailto:', 'javascript:', 'data:', 'tel:')): continue
                v = urllib.parse.urljoin(fin, raw).split('#')[0]
                if re.search(r'[?&]C=[A-Z];O=[AD]', v): continue  # Apache index sort variants: same listing, four extra requests
                if in_scope(v) and v not in seen and v not in qset: queue.append(v); qset.add(v)
    open(man, 'a', encoding='utf-8').write(f'{u}\t{os.path.relpath(fp, od) if fp else ""}\t{st}\t{len(body)}\t{ct.split(";")[0]}\t{time.strftime("%F %T")}\n')
    if n % 25 == 0 or n < 5: print(f'[{n}] {st} {len(body):>7} {u}  (queue {len(queue)})', flush=True)
    time.sleep(a.sleep)
print(f'done: {n} fetched this run, {len(queue)} left in queue, {time.time()-t0:.0f}s', flush=True)
