#!/usr/bin/env python3
"""Park IA fetch-plan rows whose exact page was already collected from the LIVE site (the Janitor 2026-09-15: don't duplicate the
fwrestling collection). A plan row is a duplicate when its host+path appears with status 200 in a direct-collected mirror
manifest. Default: park tier d and e duplicates only — tier a captures are the priority historical versions and an old capture
can hold content the live page has since lost; pass --tiers a,d,e to widen. Appends to the fwrestling census's skip-ledger.tsv
(url, ts, tier, kept_url, kept_ts, reason) which fetch.py honours. Re-run after every mirror-runner completion."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import csv, glob, os, sys, time, urllib.parse
A = f'{_WORKSHOP}'; tiers = set((sys.argv[sys.argv.index('--tiers') + 1] if '--tiers' in sys.argv else 'd,e').split(','))
live = set()
for m in glob.glob(f'{A}/direct-collected/fwrestling/*/manifest.tsv'):
    for r in csv.DictReader(open(m, encoding='utf-8'), delimiter='\t'):
        if r.get('status') == '200':
            u = urllib.parse.urlparse(r['url']); live.add((u.netloc.lower().replace('www.', ''), u.path.rstrip('/') or '/'))
sk = f'{A}/fwrestling-census/skip-ledger.tsv'
skipped = {l.split('\t')[0] for l in open(sk, encoding='utf-8') if l.strip()}
done = set()   # everything fetch.py already treats as done or retired — the same ledgers it loads (2026-09-15 correction)
for led in ('manifest.tsv', 'cc-covered-ledger.tsv', 'chrome-ledger.tsv', 'spam-ledger.tsv', 'tier-e-retire-high.tsv', 'tier-e-retire-medium.tsv', 'blog-dedup-ledger.tsv', 'tier-d-retire-panel.tsv'):
    p = f'{A}/fwrestling-census/{led}'
    if os.path.exists(p):
        for l in open(p, encoding='utf-8', errors='replace'):
            for tok in l.rstrip('\n').split('\t')[:3]:
                if tok.startswith('http'): done.add(tok)
n = 0
with open(sk, 'a', encoding='utf-8') as out:
    for r in csv.DictReader(open(f'{A}/fwrestling-census/fetch-plan.tsv', encoding='utf-8'), delimiter='\t'):
        if r['tier'] not in tiers or r['url'] in skipped or r['url'] in done: continue
        u = urllib.parse.urlparse(r['url']); key = (u.netloc.lower().split(':')[0].replace('www.', ''), u.path.rstrip('/') or '/')
        if key in live:
            out.write(f"{r['url']}\t{r['timestamp']}\t{r['tier']}\t\t\tduplicate of a page collected from the live site (the direct collection, {time.strftime('%F')})\n"); n += 1
print(f'park-live-duplicates: parked {n} tier {sorted(tiers)} row(s); live pages known {len(live):,}')
