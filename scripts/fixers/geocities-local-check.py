#!/usr/bin/env python3
"""GEOCITIES FLIP (the Janitor gavel 2026-09-07): resolve every geocities.com URL in the given TSV files against the local
Archive Team torrent listings BEFORE any Wayback queueing. Neighborhood-era addresses (www.geocities.com/Area/Sub/NNNN/...)
are looked up in the root listing (geocities-root-full-listing.txt); username-era addresses (geocities.com/USER/...,
also ~USER) in the YAHOOIDS bucket listings (full-listings/<CASE>__geocities-<c1>-<c2>.paths.txt.gz). Writes
<out>/hits.tsv (url, torrent_path, match_kind, n_paths_under) and <out>/misses.tsv (url, reason). Read-only on the torrent.
argv: --out DIR file.tsv [file.tsv ...]   (url column auto-detected: url | original_url)"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import sys, csv, gzip, os, re, urllib.parse, collections
G = f'{_WORKSHOP}/geocities-torrent'; L = f'{G}/full-listings'
args = sys.argv[1:]; out = args[args.index('--out') + 1]; files = [a for a in args if a != '--out' and a != out]
os.makedirs(out, exist_ok=True)
print('loading root listing ...', file=sys.stderr)
root = set(); rootdirs = collections.Counter(); neigh = collections.Counter()
with open(f'{G}/geocities-root-full-listing.txt', encoding='utf-8', errors='replace') as fh:
    for line in fh:
        i = line.find('geocities/www.geocities.com/')
        if i < 0: continue
        p = line[i:].rstrip('\n').lower().rstrip('/')
        root.add(p)
        segs = p.split('/')
        if len(segs) >= 3: neigh[segs[2]] += 1
        if len(segs) >= 5: rootdirs['/'.join(segs[:5])] += 1
NEIGH = {n for n, c in neigh.items() if c >= 200 and not n.startswith('~')}
print('root paths:', len(root), '| neighborhoods:', len(NEIGH), file=sys.stderr)
bucket_cache = {}; CASE = {}
def bucket_paths(user):
    c1, c2 = user[0], (user[1] if len(user) > 1 else '_')
    case = 'NUMBERS' if c1.isdigit() else ('UPPERCASE' if c1.isupper() else 'LOWERCASE')
    key = (case, c1.lower(), c2.lower())
    if key in bucket_cache: return bucket_cache[key]
    paths = set(); orig = {}
    for f in os.listdir(L):
        if f.endswith('.paths.txt.gz') and f.lower() == f'{case.lower()}__geocities-{c1.lower()}-{c2.lower()}.paths.txt.gz':
            with gzip.open(f'{L}/{f}', 'rt', encoding='utf-8', errors='replace') as fh:
                for line in fh:
                    l = line.strip().rstrip('/'); paths.add(l.lower()); orig[l.lower()] = (f.replace('.paths.txt.gz', ''), l)
    bucket_cache[key] = paths; CASE[key] = orig; return paths
def check(url):
    u = url.strip()
    if not re.match(r'^[a-z]+://', u): u = 'http://' + u
    if ' ' in u or not re.match(r'^[a-z]+://[A-Za-z0-9.-]+', u): return None  # placeholders such as 'withheld -- ...'
    try: pr = urllib.parse.urlparse(u)
    except ValueError: return None
    host = (pr.hostname or '').lower(); path = urllib.parse.unquote(pr.path or '/').strip('/')
    if 'geocities' not in host: return None
    segs = [s for s in path.split('/') if s]
    if not segs: return ('miss', 'root of geocities.com')
    first = segs[0].lstrip('~').lower()
    if first in NEIGH and not segs[0].startswith('~'):
        low = [x.lower() for x in segs]
        key = 'geocities/www.geocities.com/' + '/'.join(low)
        if key in root:
            d = '/'.join(key.split('/')[:5]); return ('hit', key, 'exact-page' if '.' in segs[-1] else 'dir', rootdirs.get(d, 1))
        for n in (3, 2):
            d = 'geocities/www.geocities.com/' + '/'.join(low[:n])
            if len(segs) >= n and d in root and (n == 2 and not re.match(r'^\d{3,5}$', low[1]) or n == 3 or (n == 2 and re.match(r'^\d{3,5}$', low[1]))):
                if n == 3 or re.match(r'^\d{3,5}$', low[1]): return ('hit', d, 'site-dir (page not listed)', rootdirs.get(d, 1))
        # relocation: the neighborhood tree re-homed under YAHOOIDS/<c1>/<c2>/<Neighborhood>/... (the root tar carries a
        # case-preserving symlink, e.g. www.geocities.com/Area51 -> /geocities/YAHOOIDS/A/r/Area51), so try the original case first
        for name in (segs[0], first):
            bp = bucket_paths(name)
            pref = f'geocities/yahooids/{name[0].lower()}/{name[1].lower()}/{name.lower()}'
            rel = pref + '/' + '/'.join(low[1:]) if len(low) > 1 else pref
            if rel in bp: return ('hit', rel, 'relocated exact', 1)
            n = 3 if len(low) >= 3 and re.match(r'^\d{3,5}$', low[2]) else 2
            reld = pref + '/' + '/'.join(low[1:n])
            if len(low) >= n and any(p == reld or p.startswith(reld + '/') for p in bp): return ('hit', reld, 'relocated site-dir', sum(1 for p in bp if p.startswith(reld + '/')))
        return ('miss', 'neighborhood address absent from root tar and YAHOOIDS relocation')
    user = segs[0].lstrip('~')
    bp = bucket_paths(user)
    pref = f'geocities/yahooids/{user[0].lower()}/{(user[1] if len(user)>1 else "_").lower()}/{user.lower()}'
    if pref in bp or any(p.startswith(pref + '/') for p in bp):
        exact = (pref + '/' + '/'.join(segs[1:]).lower()).rstrip('/') if len(segs) > 1 else pref
        if exact in bp: return ('hit', exact, 'exact-page', sum(1 for p in bp if p.startswith(pref + '/')))
        if len(segs) == 1: return ('hit', pref, 'user-dir', sum(1 for p in bp if p.startswith(pref + '/')))
        # the page's own directory (every segment but a trailing file) must exist; a parent alone is not a find
        dseg = [x.lower() for x in segs[1:]]
        if dseg and '.' in dseg[-1]: dseg = dseg[:-1]
        sub = pref + ('/' + '/'.join(dseg) if dseg else '')
        if any(p == sub or p.startswith(sub + '/') for p in bp): return ('hit', sub, 'site-dir (page not listed)', sum(1 for p in bp if p.startswith(sub + '/')))
        return ('miss', 'user dir present but the page path is absent')
    return ('miss', 'username absent from YAHOOIDS buckets')
seen = set(); hits = []; misses = []
for f in files:
    with open(f, encoding='utf-8', errors='replace') as fh:
        rd = csv.DictReader(fh, delimiter='\t')
        col = 'url' if 'url' in (rd.fieldnames or []) else ('original_url' if 'original_url' in (rd.fieldnames or []) else None)
        if not col: print('no url column:', f, file=sys.stderr); continue
        for r in rd:
            u = (r.get(col) or '').strip()
            if not u or u.lower() in seen: continue
            seen.add(u.lower()); res = check(u)
            if not res: continue
            if res[0] == 'hit': hits.append((u, res[1], res[2], res[3], os.path.basename(f)))
            else: misses.append((u, res[1], os.path.basename(f)))
with open(f'{out}/hits.tsv', 'w') as fh:
    fh.write('url\ttorrent_path\tmatch_kind\tn_paths_under\tsource_file\tbucket\tmember_path\n')
    for h in hits:
        b, m = '', ''
        for orig in CASE.values():
            if h[1] in orig: b, m = orig[h[1]]; break
        if not b and h[1].startswith('geocities/www.geocities.com/'): b, m = 'GEOCITIES__www.geocities.com', h[1]
        fh.write('\t'.join(map(str, h)) + f'\t{b}\t{m}\n')
with open(f'{out}/misses.tsv', 'w') as fh:
    fh.write('url\treason\tsource_file\n')
    for m in misses: fh.write('\t'.join(m) + '\n')
print(f'geocities urls: {len(hits)+len(misses)} | local hits: {len(hits)} | misses: {len(misses)}')
