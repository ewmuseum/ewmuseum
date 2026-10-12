#!/usr/bin/env python3
"""Character-first census over the RSPWF corpus (the Janitor 2026-09-15): the wing-first walks leave character-first posts on the
floor — free agents, roleplay/promo/flash samples posted outside a fed, critique/feedback requests, character bios/profiles.
Census only: classify every post by subject conventions + body cues; no processing, no names (author fields are never written).
Output: desk/character-first-census-<date>/census.tsv (year, category, fed_tagged, msg_id, thread_id, date, subject),
by-year-category.tsv, SUMMARY.md."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json, re, glob, os, csv, collections, datetime
A = f'{_WORKSHOP}'; OUT = f'{A}/desk/character-first-census-{datetime.date.today()}'; os.makedirs(OUT, exist_ok=True)
FILES = sorted(set([f'{A}/usenet-retro/dumps/rec.sport.pro-wrestling.dedup.jsonl', f'{A}/usenet-retro/dumps/rec.sport.pro-wrestling.fantasy.dedup.jsonl', f'{A}/usenet-retro/dumps/rspwf-undated-recovered.dedup.jsonl'] + glob.glob(f'{A}/usenet-retro/scratch-1990s/rspwf-199[0-6].dedup.jsonl') + [f'{A}/usenet-retro/scratch-1996/wave-C96-PLAN-01/corpus-1996-union.jsonl'] + glob.glob(f'{A}/usenet-retro/dumps/rspwf-walk-*.dedup.jsonl')))  # the 1995 dump is rec.sport.pro-wrestling.fantasy.dedup.jsonl (the newsgroup starts May 1995); rspwf-undated-recovered = 1996 recovered
FED_TAG = re.compile(r'^\s*[\[\(\{]\s*[A-Z][A-Za-z0-9&/.\'-]{1,12}\s*[\]\)\}]')   # a leading [FED]-style tag
RULES = [  # (category, subject regex, body regex or None) — first match wins
 ('free-agent', re.compile(r'free\s*agent|\bF\.?A\.?\b\s*[\]\):-]|looking for (a |an |another )?(fed|federation|e-?fed|league|home)|seeking (a )?(fed|federation)|need(s)? a fed|available (wrestler|character|to join)|wants? (a|to join a) fed|\[rookie\]|\{rookie\}|for hire', re.I), None),
 ('critique-request', re.compile(r'critique|criticize|\brate (my|this|it)\b|\bgrade (my|this)\b|feedback|opinions?\??|thoughts\??|what do (you|ya) think|review (my|this)|honest opinion|any good\??|how (was|is) (this|it|my)', re.I), None),
 ('flash', re.compile(r'\bflash\b', re.I), None),
 ('rp-sample', re.compile(r'\b(sample|example|practice|test)\b.{0,20}\b(rp|roleplay|role-?play|promo)|\b(rp|roleplay|role-?play|promo)\b.{0,20}\b(sample|example|practice|test)\b|first (rp|roleplay|promo)|my (rp|roleplay|promo)', re.I), None),
 ('bio-profile', re.compile(r'\[(bio|profile|stats|character)\]|character (sheet|bio|profile)|wrestler (bio|profile)|\bbio:|\bprofile:', re.I), None),
 ('roleplay-untagged', re.compile(r'\b(rp|roleplay|role-?play|promo|interview|vignette)\b', re.I), None),
]
BODY_FA = re.compile(r'\b(i am|i\'m|im) (a |an )?(free agent|looking for a (fed|federation|e-?fed))|looking for a (new )?(fed|federation|e-?fed|home)|any feds? (looking|need|want)', re.I)
seen = set(); rows = []; tally = collections.Counter(); files_used = []
for f in FILES:
    if not os.path.exists(f): continue
    files_used.append(f); n = 0
    for l in open(f, encoding='utf-8', errors='replace'):
        try: r = json.loads(l)
        except Exception: continue
        mid = r.get('msg_id') or r.get('id')
        if not mid or mid in seen: continue
        seen.add(mid); n += 1
        subj = (r.get('subject') or '').strip(); body = (r.get('body') or '')[:4000]
        year = str(r.get('date_year') or r.get('year') or '')[:4]
        if not year:
            m = re.search(r'(19|20)\d\d', r.get('date') or ''); year = m.group(0) if m else '?'
        fed = bool(FED_TAG.match(subj))
        cat = None
        for name, sre, bre in RULES:
            if sre.search(subj): cat = name; break
        if cat is None and BODY_FA.search(body[:1500]): cat = 'free-agent'
        # a critique/feedback ask only counts when the thing being critiqued is a roleplay/promo/character (RSPW is a real-wrestling group: 'thoughts?' alone is discussion)
        if cat == 'critique-request' and not re.search(r'\b(rp|roleplay|role-?play|promo|flash|e-?fed|fed|character|wrestler|my guy|gimmick|interview|vignette)\b', subj + ' ' + body[:800], re.I): cat = None
        if cat == 'roleplay-untagged' and fed: cat = None   # a fed-tagged RP belongs to its wing
        if cat is None: continue
        corpus = 'RSPW' if os.path.basename(f) == 'rec.sport.pro-wrestling.dedup.jsonl' else 'RSPWF'
        rows.append((year, cat, 'yes' if fed else 'no', mid, r.get('thread_id') or '', (r.get('date') or '')[:20], subj[:140], corpus))
        tally[(year, cat)] += 1
rows.sort()
with open(f'{OUT}/census.tsv', 'w', newline='', encoding='utf-8') as fh:
    w = csv.writer(fh, delimiter='\t', lineterminator='\n'); w.writerow(['year', 'category', 'fed_tagged', 'msg_id', 'thread_id', 'date', 'subject', 'corpus']); w.writerows(rows)
years = sorted({y for y, _ in tally}); cats = [c for c, _, _ in RULES]
with open(f'{OUT}/by-year-category.tsv', 'w', newline='', encoding='utf-8') as fh:
    w = csv.writer(fh, delimiter='\t', lineterminator='\n'); w.writerow(['year'] + cats + ['total'])
    for y in years: w.writerow([y] + [tally[(y, c)] for c in cats] + [sum(tally[(y, c)] for c in cats)])
    w.writerow(['all'] + [sum(tally[(y, c)] for y in years) for c in cats] + [len(rows)])
with open(f'{OUT}/SUMMARY.md', 'w', encoding='utf-8') as fh:
    fh.write(f'# Character-first census of the RSPWF corpus — {datetime.date.today()}\n\nPosts read (deduplicated by msg_id): {len(seen):,} across {len(files_used)} files.\nCharacter-first posts found: {len(rows):,}. Census only — nothing processed, no author fields written.\n\n')
    fh.write('| year | ' + ' | '.join(cats) + ' | total |\n|---|' + '---|' * (len(cats) + 1) + '\n')
    for y in years: fh.write(f'| {y} | ' + ' | '.join(str(tally[(y, c)]) for c in cats) + f' | {sum(tally[(y, c)] for c in cats)} |\n')
    fh.write('\nCategories: free-agent (a character seeking a fed, by subject convention or an opening body line); critique-request (rate/critique/feedback asks); flash (flash roleplays); rp-sample (samples, first/test/practice RPs); bio-profile (character sheets); roleplay-untagged (RP/promo/interview posts with no leading [FED] tag — the fed-tagged ones belong to their wings and are excluded).\nFiles: ' + ', '.join(os.path.basename(f) for f in files_used) + '\nRSPW rows (corpus column) come from the RSPW 1990–95 dump, a selective walk that likely missed much of that newsgroup — treat its counts as a floor.\nCaveats: subject-convention classifier; first matching rule wins; a post can be a fed recruitment ad mislabelled as free-agent — the census keeps it, a later reading decides.\n')
print(f'read {len(seen):,} posts | character-first {len(rows):,} | files {len(files_used)}'); print(open(f'{OUT}/by-year-category.tsv').read())
