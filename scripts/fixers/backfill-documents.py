#!/usr/bin/env python3
"""
PROVENANCE-BACKFILL-01: builds museum/data/documents.json ONCE from
the workshop's provenance-survey-2026-09-13/blocks.tsv, the shows.json/rps.json
registry rows, and collections.json — per the Janitor's gavel (2026-09-13):
the provenance block becomes structured data, not free-form prose.

Read-only against museum/ (only reads shards, collections.json, and runs
`git log` inside the museum repo to recover each page's accession date).
Writes documents.json + unparsed.tsv + a field-fill report into THIS
output directory, never into museum/.

Scope: museum/promotions/*/archive/*.html and museum/promotions/*/rp/*.html
only (18,011 pages per the survey) — the one out-of-scope memorial page
that also carries a provenance-style block is deliberately excluded, per
findings.md's own scope note.

Usage:
    backfill-documents.py [--museum-root PATH] [--blocks-tsv PATH] [--out DIR]
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import csv, json, os, re, glob, sys, html, subprocess, argparse
from collections import defaultdict, OrderedDict

WORDNUM = {'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,
           'eight':8,'nine':9,'ten':10,'eleven':11,'twelve':12}

MONTHS = {m.lower(): i for i, m in enumerate(
    ['January','February','March','April','May','June','July','August',
     'September','October','November','December'], start=1)}
MONTHS_ABBR = {m[:3].lower(): i for m, i in MONTHS.items()}

TAG = re.compile(r'<[^>]+>')
WS = re.compile(r'\s+')

# ---------------------------------------------------------------------------
# Fact-extraction regexes (extends extract_blocks.py's survey-grade set with
# the two tightenings findings.md's Risk 5 calls for: a bare-inline
# Message-ID list with no <code> wrap, and a couple of nonstandard date
# phrasings the survey's DATE_PATTERNS list didn't fully anticipate).
# ---------------------------------------------------------------------------

CODE_SPAN = re.compile(r'<code>([^<]+)</code>')
A_HREF = re.compile(r'<a\s+href="([^"]+)"[^>]*>([^<]*)</a>', re.I)

MSGID_NEAR = re.compile(
    r'(?:msg|message)[-_\s]?id[s]?\s*(?:is\s+)?(?:[:]\s*)?<code>([^<]+)</code>', re.I)
MSGID_LIST_CODE = re.compile(
    r'(?:msg|message)[-_\s]?ids?\s*[:]?\s*((?:<code>[^<]+</code>[,\s]*(?:and\s+)?)+)', re.I)

# RISK 5 tightening: bare-inline msg id(s), no <code> wrap at all, e.g.
# "(msg id q1BMo4R467gJ)" or "msg ids OtVAZPBXYioJ, yBXqWA-Sa2wJ and UPwfo6kH4XQJ"
BARE_MSGID_LIST = re.compile(
    r'\b(?:msg|message)[-_. ]?\s*ids?\b[^A-Za-z0-9]{0,12}'
    r'(<?[A-Za-z0-9._-]{6,64}(?:@[\w.-]+)?>?'
    r'(?:\s*(?:,|and)\s*<?[A-Za-z0-9._-]{6,64}(?:@[\w.-]+)?>?)*)',
    re.I)
BARE_TOKEN_SPLIT = re.compile(r'\s*(?:,|and)\s*', re.I)

NEWSGROUP_RE = re.compile(
    r'\b(?:rec|alt|misc|soc|talk)\.[a-z0-9][a-z0-9._+-]*[a-z0-9]\b', re.I)

WAYBACK_TS = re.compile(r'web\.archive\.org/web/(\d{4,14})/')
ARQUIVO_TS = re.compile(r'arquivo\.pt/wayback/(\d{4,14})')
COMMONCRAWL_TS = re.compile(r'\bcapture\s+(\d{8,14})\b', re.I)

LOT_HREF = re.compile(r'/collections/(\d{3,6})(?:\.html|/)')
LOT_TEXT = re.compile(r'\b(?:lot|accession)\s+#?0*(\d{1,6})\b', re.I)

# Document-own-date phrases (evaluated first, in priority order) vs.
# capture-only phrases (Wayback/Arquivo/Common Crawl fetch date, NOT the
# document's date) — kept as two separate pattern sets so a block that only
# states a capture date does not get mis-recorded as having a document date.
DOC_DATE_PATTERNS = [
    re.compile(r'\bdated\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})'),
    re.compile(r'\bdated\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})'),
    # the "to <sub-forum name>" middle segment must not cross a "captured"
    # clause — otherwise "posted to its sub-forum, captured 11 March 2026"
    # mistakes the WAYBACK CAPTURE date for the document's own posted date.
    re.compile(r'\bposted\s+(?:to\s+(?:(?!captured)[A-Za-z0-9 ,.\'\-])*?)?(?:on\s+)?(\d{1,2}\s+[A-Za-z]+\s+\d{4})'),
    re.compile(r'\bposted\s+(?:to\s+(?:(?!captured)[A-Za-z0-9 ,.\'\-])*?)?(?:on\s+)?([A-Za-z]+\s+\d{1,2},?\s+\d{4})'),
    re.compile(r'\btaping dated\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})'),
    re.compile(r'\bdateline\s+reads?\s+\S*(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})'),
    # RISK 5 tightening: "posted Mar 8, 1997, 12:00:00 AM" style (abbreviated
    # month, trailing clock time to discard) and a bare ISO date.
    re.compile(r'\bposted\s+([A-Za-z]{3,9}\.?\s+\d{1,2},\s+\d{4})(?:,\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M)?', re.I),
    # excludes 2026+ deliberately: every workshop/coordinator metadata
    # timestamp in this corpus ("per the 2026-09-02 gavel", "collection of
    # the ... corpus (2026-08-24)", "retroactive privacy pass, 2026-09-04")
    # is ISO-shaped and dated in the accession's own year — never a real
    # 1990s-2010s wrestling document's own date. A bare ISO date is only
    # trusted as the document's date when it predates the workshop itself.
    re.compile(r'\b((?:19|20)(?:[0-1]\d|2[0-5])-\d{2}-\d{2})\b'),
]
CAPTURE_DATE_PATTERNS = [
    re.compile(r'\bcaptured?\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})'),
    re.compile(r'\bcaptured?\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})'),
    re.compile(r'\bcapture\s+(\d{4}-\d{2}-\d{2})'),
]

PARTS_NOF = re.compile(
    r'\bpart\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+of\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b', re.I)
PARTS_N_TOTAL = re.compile(
    r'\bposted\s+in\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+parts\b', re.I)
PARTS_N_DASH = re.compile(
    r'\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)-part\b', re.I)
FILENAME_PART_N = re.compile(r'-p(?:ar)?t0*(\d{1,2})(?:-|\.)', re.I)
FILENAME_DATE = re.compile(r'(\d{4})-(\d{2})-(\d{2})')
FILENAME_YEAR = re.compile(r'(?<!\d)(19[5-9]\d|20[0-2]\d)(?!\d)')

REDACT_PHRASE = re.compile(
    r'(?:carries\s+)?\b(?:(\d+)|(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve))\s+redactions?\b',
    re.I)

# coordinator/workshop metadata timestamps that must never be mistaken for a
# document's own date (or leak into any field at all) — e.g. the 47
# two-block pages' second paragraph: "... (retroactive privacy pass,
# 2026-09-04)."
ADMIN_DATE_STRIP = re.compile(r'\(retroactive privacy pass,\s*\d{4}-\d{2}-\d{2}\)', re.I)


def num_word(s):
    if s is None:
        return None
    s = s.lower()
    return int(s) if s.isdigit() else WORDNUM.get(s)


def text_of(frag):
    t = TAG.sub(' ', frag)
    t = html.unescape(t)
    return WS.sub(' ', t).strip()


# ---------------------------------------------------------------------------
# Date normalisation: returns {"date": "YYYY[-MM[-DD]]"|None, "precision": ...}
# ---------------------------------------------------------------------------

def normalize_date_string(s):
    """Best-effort parse of a human date phrase into (iso, precision)."""
    s = s.strip().rstrip('.')
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', s)
    if m:
        return f'{m.group(1)}-{m.group(2)}-{m.group(3)}', 'exact'
    m = re.match(r'^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})$', s)
    if m:
        mon = MONTHS.get(m.group(2).lower()) or MONTHS_ABBR.get(m.group(2).lower()[:3])
        if mon:
            return f'{m.group(3)}-{mon:02d}-{int(m.group(1)):02d}', 'exact'
    m = re.match(r'^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$', s)
    if m:
        mon = MONTHS.get(m.group(1).lower()) or MONTHS_ABBR.get(m.group(1).lower()[:3])
        if mon:
            return f'{m.group(3)}-{mon:02d}-{int(m.group(2)):02d}', 'exact'
    m = re.match(r'^([A-Za-z]+)\.?\s+(\d{4})$', s)
    if m:
        mon = MONTHS.get(m.group(1).lower()) or MONTHS_ABBR.get(m.group(1).lower()[:3])
        if mon:
            return f'{m.group(2)}-{mon:02d}', 'month'
    m = re.match(r'^(\d{4})$', s)
    if m:
        return m.group(1), 'year'
    # MM/DD/YYYY or DD/MM/YYYY dateline groups handled by caller directly
    return None, None


def extract_document_date_from_text(plain):
    for pat in DOC_DATE_PATTERNS:
        m = pat.search(plain)
        if m:
            if len(m.groups()) == 3 and m.re is DOC_DATE_PATTERNS[5]:
                # dateline MM/DD/YYYY (site convention; treated as such per
                # the existing skeletons that state "MM/DD/YYYY convention")
                mm, dd, yy = m.groups()
                yy = ('20' + yy) if len(yy) == 2 else yy
                try:
                    return f'{int(yy):04d}-{int(mm):02d}-{int(dd):02d}', 'exact'
                except ValueError:
                    continue
            iso, prec = normalize_date_string(m.group(1))
            if iso:
                return iso, prec
    return None, None


def extract_capture_date_from_text(plain):
    for pat in CAPTURE_DATE_PATTERNS:
        m = pat.search(plain)
        if m:
            iso, prec = normalize_date_string(m.group(1))
            if iso:
                return iso
    return None


def date_from_filename(page_path):
    base = os.path.basename(page_path)
    m = FILENAME_DATE.search(base)
    if m:
        y, mo, d = m.groups()
        if 1990 <= int(y) <= 2026 and 1 <= int(mo) <= 12 and 1 <= int(d) <= 31:
            return f'{y}-{mo}-{d}', 'exact'
    m = FILENAME_YEAR.search(base)
    if m:
        return m.group(1), 'year'
    return None, None


# ---------------------------------------------------------------------------
# Source extraction
# ---------------------------------------------------------------------------

def extract_msgids(raw_html, plain):
    ids = []
    for m in MSGID_NEAR.finditer(raw_html):
        ids.append(m.group(1))
    for m in MSGID_LIST_CODE.finditer(raw_html):
        for c in CODE_SPAN.finditer(m.group(1)):
            ids.append(c.group(1))
    if not ids:
        for m in BARE_MSGID_LIST.finditer(plain):
            for tok in BARE_TOKEN_SPLIT.split(m.group(1)):
                tok = tok.strip().strip('.,;')
                if len(tok) >= 6:
                    ids.append(tok)
    cleaned, seen = [], []
    for i in ids:
        i2 = html.unescape(i).strip().strip('<>').strip()
        if i2 and i2 not in seen:
            seen.append(i2)
            cleaned.append(i2)
    return cleaned


def extract_newsgroup(raw_html):
    m = NEWSGROUP_RE.search(raw_html)
    return m.group(0) if m else None


def extract_urls(raw_html):
    urls = []
    for m in A_HREF.finditer(raw_html):
        href = m.group(1)
        if href.startswith('/') and not href.startswith('//'):
            continue
        urls.append(href)
    return urls


def google_groups_url_for(newsgroup, msg_id, urls):
    # Prefer an already-authored groups.google.com link from the page itself.
    for u in urls:
        if 'groups.google.com' in u:
            return u
    if newsgroup and msg_id:
        mid = msg_id.strip('<>')
        return f'https://groups.google.com/g/{newsgroup}/c/{mid}/m/{mid}'
    return None


def classify_and_build_sources(page_path, raw_html_concat, plain_concat, urls, wayback_ts_list,
                                msgids_tsv=None, newsgroup_tsv=None):
    """Returns a list of source dicts, per documents.json's schema."""
    sources = []
    lower = plain_concat.lower()

    # primary: the survey's own HTML-aware extraction (blocks.tsv columns,
    # already parsed against the real <code>/<a href> markup). Fall back to
    # this module's own plain-text regexes (bare-inline msg id lists, a
    # bare newsgroup mention) only when those columns came up empty.
    msgids = list(msgids_tsv) if msgids_tsv else extract_msgids(raw_html_concat, plain_concat)
    newsgroup = (newsgroup_tsv[0] if newsgroup_tsv else None) or extract_newsgroup(raw_html_concat)
    wb_ts = wayback_ts_list[0] if wayback_ts_list else None
    if not wb_ts:
        m = WAYBACK_TS.search(raw_html_concat)
        wb_ts = m.group(1) if m else None
    arq_ts = None
    m = ARQUIVO_TS.search(raw_html_concat)
    if m:
        arq_ts = m.group(1)

    is_newsgroup_source = bool(msgids) or bool(newsgroup) or 'google groups' in lower or 'usenet posting' in lower \
        or 'giganews' in lower or 'usenet census' in lower or 'usenet' in lower
    is_arquivo = 'arquivo.pt' in lower or bool(arq_ts)
    is_geocities_torrent = 'geocities' in lower and (
        'archive team' in lower or 'restorativland' in lower or 'vault mirror' in lower
        or 'geocities-extracted' in lower or 'torrent' in lower)
    is_commoncrawl = 'common crawl' in lower
    # a block that explicitly says the document was NEVER captured by the
    # Wayback Machine (the UWF flat-file-backend skeleton, 555 pages) must
    # not be classified as a wayback source just because the word appears.
    wayback_negated = bool(re.search(
        r'\b(?:never|not|no)\s+(?:crawled|captured|indexed|archived|preserved|held|reached)\s+(?:by|in|on)\s+the\s+wayback',
        lower))
    # broadened from the original 'wayback machine' literal: several
    # skeletons say "Wayback extraction"/"the Wayback" without "Machine".
    is_wayback = (not is_geocities_torrent and not is_commoncrawl and not is_arquivo and not wayback_negated
                  and ('wayback' in lower or bool(wb_ts)))
    is_wiki_dump = 'wikiteam' in lower or ('.fandom.com' in lower and 'wiki' in lower)
    is_direct_notes = (('own drive' in lower) or ('hard drive' in lower) or ('private donation' in lower)
                        or ("\x66ounder's own drive" in lower) or ('own hard drives' in lower)
                        or ('play notes' in lower) or ('pitch document' in lower) or ('own folder' in lower)
                        or ('personally provided' in lower) or ('flat-file' in lower) or ('flat file' in lower)
                        or wayback_negated)

    # newsgroup is orthogonal to the "physical capture method" categories
    # below (a Usenet post recovered THROUGH a Wayback-captured Google
    # Groups viewer is still, at heart, a newsgroup source — the capture
    # timestamp rides along on that one source entry rather than spawning
    # a second, competing source row).
    if is_newsgroup_source:
        src = {'kind': 'newsgroup'}
        if newsgroup:
            src['newsgroup'] = newsgroup
        if msgids:
            src['msg_id'] = msgids[0]
            url = google_groups_url_for(newsgroup, msgids[0], urls)
            if url:
                src['url'] = url
        elif urls:
            for u in urls:
                if 'groups.google.com' in u:
                    src['url'] = u
                    break
        if wb_ts:
            src['captured_at'] = ts_to_iso(wb_ts)
        sources.append(src)
        for extra in msgids[1:2]:
            if extra != msgids[0]:
                sources.append({'kind': 'newsgroup', 'newsgroup': newsgroup, 'msg_id': extra} if newsgroup
                                else {'kind': 'newsgroup', 'msg_id': extra})
        return sources

    # From here on, exactly one "how was this fetched" kind applies —
    # checked in specificity order so e.g. a geocities-torrent mention
    # doesn't also spawn a redundant generic wayback row.
    if is_geocities_torrent:
        src = {'kind': 'geocities-torrent'}
        m = re.search(r'\(([A-Za-z0-9_./ -]*(?:YAHOOIDS|geocities\.com)[A-Za-z0-9_./ -]*)\)', raw_html_concat, re.I)
        if not m:
            m = re.search(r'\b(YAHOOIDS/[A-Za-z0-9_./-]+)', plain_concat)
        if m:
            src['url'] = m.group(1).strip()
        sources.append(src)
    elif is_arquivo:
        src = {'kind': 'arquivo'}
        for u in urls:
            if 'arquivo.pt' in u:
                src['url'] = u
                break
        if arq_ts:
            src['captured_at'] = ts_to_iso(arq_ts)
        sources.append(src)
    elif is_commoncrawl:
        src = {'kind': 'commoncrawl'}
        m = re.search(r'\bfrom\s+([a-z0-9.-]+\.[a-z]{2,})\s+via\s+a\s+Common Crawl', plain_concat, re.I)
        if m:
            src['url'] = 'http://' + m.group(1) + '/'
        m2 = COMMONCRAWL_TS.search(plain_concat)
        if m2:
            src['captured_at'] = ts_to_iso(m2.group(1))
        sources.append(src)
    elif is_wayback:
        src = {'kind': 'wayback'}
        for u in urls:
            if 'web.archive.org' in u:
                src['url'] = u
                break
        else:
            for u in urls:
                if u.startswith('http'):
                    src['url'] = u
                    break
            else:
                m = re.search(r'\(\s*([a-z0-9.-]+\.[a-z]{2,}(?:/[^\s,;()]+)?)\s*[,)]', plain_concat, re.I)
                if m:
                    src['url'] = 'http://' + m.group(1)
        if wb_ts:
            src['captured_at'] = ts_to_iso(wb_ts)
        else:
            cap = extract_capture_date_from_text(plain_concat)
            if cap:
                src['captured_at'] = cap
        sources.append(src)
    elif is_wiki_dump:
        src = {'kind': 'direct'}
        m = re.search(r'([a-z0-9.-]+\.fandom\.com)\s*,\s*the article\s*[“"]([^”"]+)', plain_concat, re.I)
        if m:
            slug = m.group(2).strip().replace(' ', '_')
            src['url'] = f'https://{m.group(1)}/wiki/{slug}'
        else:
            m = re.search(r'([a-z0-9.-]+\.fandom\.com)', plain_concat, re.I)
            if m:
                src['url'] = f'https://{m.group(1)}/'
        sources.append(src)
    elif is_direct_notes:
        sources.append({'kind': 'direct'})
    elif urls:
        # generic external link none of the classifiers above recognised
        # (e.g. a fed's own live/dead site cited with no Wayback phrasing).
        sources.append({'kind': 'direct', 'url': urls[0]})
    else:
        # last resort: a bare "domain.tld/path" mention with no <a href> at
        # all — still worth carrying the domain as a lead even though the
        # capture method is unstated.
        m = re.search(r'\b((?:[a-z0-9-]+\.)+(?:com|net|org|co\.uk|info|tv)(?:/[^\s,;()]+)?)', plain_concat, re.I)
        if m and 'googlegroups' not in m.group(1).lower():
            sources.append({'kind': 'unknown', 'url': 'http://' + m.group(1).rstrip('.,;)')})

    return sources


def ts_to_iso(ts):
    ts = re.sub(r'\D', '', ts)
    if len(ts) >= 8:
        return f'{ts[0:4]}-{ts[4:6]}-{ts[6:8]}'
    if len(ts) == 4:
        return ts
    return None


def extract_parts(plain, page_path):
    m = PARTS_NOF.search(plain)
    if m:
        n, of = num_word(m.group(1)), num_word(m.group(2))
        if n and of:
            return {'n': n, 'of': of}
    of = None
    m = PARTS_N_TOTAL.search(plain) or PARTS_N_DASH.search(plain)
    if m:
        of = num_word(m.group(1))
    n = None
    fm = FILENAME_PART_N.search(os.path.basename(page_path))
    if fm:
        n = int(fm.group(1))
    if n and of:
        return {'n': n, 'of': of}
    if of and not n:
        return {'n': None, 'of': of}
    return None


def extract_collection(raw_html, plain):
    m = LOT_HREF.search(raw_html)
    if m:
        return m.group(1).zfill(4)
    m = LOT_TEXT.search(plain)
    if m:
        return m.group(1).zfill(4)
    return None


# ---------------------------------------------------------------------------
# Registry + git accession-date + collections id set
# ---------------------------------------------------------------------------

def load_registry(museum_root):
    by_page = {}
    for f in glob.glob(os.path.join(museum_root, 'data/shards/*/shows.json')):
        try:
            d = json.load(open(f, encoding='utf-8'))
        except Exception:
            continue
        rows = d if isinstance(d, list) else d.get('shows', [])
        for r in rows:
            pg = r.get('page')
            if pg:
                by_page[pg] = {'collection': r.get('collection'), 'date': r.get('date')}
    for f in glob.glob(os.path.join(museum_root, 'data/shards/*/rps.json')):
        try:
            d = json.load(open(f, encoding='utf-8'))
        except Exception:
            continue
        rows = d if isinstance(d, list) else d.get('rps', [])
        for r in rows:
            pg = r.get('served_url')
            if pg:
                by_page[pg] = {'collection': r.get('collection'), 'date': r.get('date')}
    return by_page


def load_collection_ids(museum_root):
    d = json.load(open(os.path.join(museum_root, 'data/collections.json'), encoding='utf-8'))
    return {c['id'] for c in d.get('collections', [])}


def load_served_since(museum_root):
    """One `git log` walk over the whole promotions/ tree (fast: <1s), earliest
    add-commit date per path, read-only. Falls back to per-file `git log` for
    any path this bulk walk didn't cover (renames, etc.)."""
    out = {}
    try:
        res = subprocess.run(
            ['git', 'log', '--diff-filter=A', '--format=C %ad', '--date=short',
             '--reverse', '--name-only', '--', 'promotions'],
            cwd=museum_root, capture_output=True, text=True, timeout=120)
        cur_date = None
        for line in res.stdout.splitlines():
            if line.startswith('C '):
                cur_date = line[2:].strip()
            elif line.strip() and cur_date:
                if line not in out:
                    out[line] = cur_date
    except Exception as e:
        print('WARN: bulk git log failed:', e, file=sys.stderr)
    return out


def served_since_fallback(museum_root, rel_path):
    try:
        res = subprocess.run(
            ['git', 'log', '--diff-filter=A', '--format=%ad', '--date=short', '-1', '--', rel_path],
            cwd=museum_root, capture_output=True, text=True, timeout=15)
        d = res.stdout.strip()
        return d or None
    except Exception:
        return None


LANG_RE = re.compile(r'<html\s+lang="([a-z-]+)"', re.I)
MT_RE = re.compile(r'machine[- ]translat', re.I)


def read_lang_and_mt(full_path):
    try:
        with open(full_path, encoding='utf-8', errors='replace') as fh:
            head = fh.read(2000)
    except Exception:
        return None, False
    m = LANG_RE.search(head)
    lang = m.group(1) if m else None
    mt = bool(MT_RE.search(head)) or 'data-doc-class="machine-translation"' in head
    return lang, mt


def name_shape_redact(s, keep=100):
    """For unparsed.tsv: replace any Capitalized-Word(+Capitalized-Word) run
    with [name], per the task's privacy instruction for that report only."""
    s = s[:keep]
    return re.sub(r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b', '[name]', s)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--museum-root', default=f'{_ROOT}')
    ap.add_argument('--blocks-tsv',
                     default=f'{_WORKSHOP}/desk/provenance-survey-2026-09-13/blocks.tsv')
    ap.add_argument('--out', default=f'{_WORKSHOP}/desk/provenance-backfill-2026-09-13/out')
    ap.add_argument('--page-filter', default=None,
                     help='optional: only process pages under this prefix (for the 60-page test run)')
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)

    print('loading registry rows...', file=sys.stderr)
    registry = load_registry(args.museum_root)
    print(f'  {len(registry)} registry rows keyed by page/served_url', file=sys.stderr)

    print('loading collections.json ids...', file=sys.stderr)
    collection_ids = load_collection_ids(args.museum_root)
    print(f'  {len(collection_ids)} known collection ids', file=sys.stderr)

    print('loading served-since (git log) map...', file=sys.stderr)
    served_since_map = load_served_since(args.museum_root)
    print(f'  {len(served_since_map)} paths dated from bulk git log', file=sys.stderr)

    print('reading blocks.tsv...', file=sys.stderr)
    pages = OrderedDict()  # rel_page -> accumulated data
    with open(args.blocks_tsv, encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter='\t')
        for row in reader:
            rel = row['page']
            if not rel.startswith('museum/promotions/'):
                continue  # out of scope: the one memorial page etc.
            if '/rp/' not in rel and '/archive/' not in rel:
                continue
            if args.page_filter and args.page_filter not in rel:
                continue
            site_path = '/' + rel[len('museum/'):]
            if site_path not in pages:
                pages[site_path] = {'blocks': [], 'wing': row['wing']}
            pages[site_path]['blocks'].append(row)

    print(f'  {len(pages)} pages in scope', file=sys.stderr)

    documents = []
    unparsed = []
    stats = defaultdict(int)
    total = len(pages)

    for site_path, info in pages.items():
        blocks = info['blocks']
        rel_from_museum = site_path.lstrip('/')  # promotions/.../....html
        full_path = os.path.join(args.museum_root, rel_from_museum)

        # ---- doc_class: forced "roleplay" under /rp/, else first non-"none"
        # data-doc-class value seen across this page's block rows.
        if '/rp/' in site_path:
            doc_class = 'roleplay'
        else:
            doc_class = 'none'
            for b in blocks:
                if b['doc_class'] and b['doc_class'] != 'none':
                    doc_class = b['doc_class']
                    break
            if doc_class == 'none' and os.path.basename(site_path) == 'index.html':
                doc_class = 'index'

        # NOTE: blocks.tsv's own "raw_block" column is actually the block's
        # PLAIN text (extract_blocks.py strips tags before writing it) —
        # there is no live markup left to re-parse here. The survey script
        # already did that HTML-aware parsing once, against the real pages,
        # into the msg_ids/newsgroup_hub/source_urls/wayback_ts columns
        # below; those are the primary source for this backfill. The
        # BARE_MSGID_LIST/NEWSGROUP_RE fallbacks over the plain text (Risk
        # 5's tightening) only fire when a block's own columns came up
        # empty — e.g. a bare inline "msg ids X, Y and Z" with no <code>
        # wrap for the survey's own <code>-anchored regex to catch.
        raw_html_concat = ' '.join(b['raw_block'] for b in blocks)
        # strip coordinator/workshop metadata dates (a retroactive redaction
        # pass's own timestamp, not the document's) before ANY field
        # extraction runs on this text — otherwise a bare-ISO-date fallback
        # can mistake "(retroactive privacy pass, 2026-09-04)" on the
        # second/redaction-only paragraph of a two-block page for the
        # document's own date.
        raw_html_concat = ADMIN_DATE_STRIP.sub('', raw_html_concat)
        plain_concat = text_of(raw_html_concat)
        urls = []
        msgids_tsv = []
        newsgroup_tsv = []
        for b in blocks:
            for u in b['source_urls'].split('|'):
                if u and u not in urls:
                    urls.append(u)
            for mid in b['msg_ids'].split('|'):
                mid = mid.strip()
                if mid and mid not in msgids_tsv:
                    msgids_tsv.append(mid)
            for ng in b['newsgroup_hub'].split('|'):
                ng = ng.strip()
                if ng and NEWSGROUP_RE.match(ng) and ng not in newsgroup_tsv:
                    newsgroup_tsv.append(ng)
        wayback_ts_list = [b['wayback_ts'] for b in blocks if b['wayback_ts']]

        # ---- collection
        collection = registry.get(site_path, {}).get('collection')
        if isinstance(collection, list):
            collection = collection[0] if collection else None
        if not collection:
            collection = extract_collection(raw_html_concat, plain_concat)
        if collection and collection not in collection_ids:
            stats['collection_parsed_but_unknown_id'] += 1
            collection = None
        if collection:
            stats['collection_filled'] += 1
            if site_path in registry and registry[site_path].get('collection'):
                stats['collection_from_registry'] += 1
            else:
                stats['collection_from_parse'] += 1
        else:
            stats['collection_unknown'] += 1

        # ---- sources
        sources = classify_and_build_sources(site_path, raw_html_concat, plain_concat, urls, wayback_ts_list,
                                              msgids_tsv, newsgroup_tsv)
        truly_unsourced = not sources
        if sources:
            stats['sources_filled'] += 1
        else:
            stats['sources_empty'] += 1
            # validate-documents.mjs requires sources[] non-empty on every
            # row (a genuine data gap still needs a lane, not a silent
            # empty array) — store an explicit "unknown" placeholder while
            # unparsed.tsv (below) remains the authoritative follow-up queue.
            sources = [{'kind': 'unknown'}]

        # ---- document_date
        reg_date = registry.get(site_path, {}).get('date')
        document_date = None
        if reg_date and reg_date.get('date') and reg_date.get('date') != 'unknown':
            document_date = {'date': reg_date['date'], 'precision': reg_date.get('precision', 'unknown')}
            stats['date_from_registry'] += 1
        else:
            iso, prec = extract_document_date_from_text(plain_concat)
            if iso:
                document_date = {'date': iso, 'precision': prec}
                stats['date_from_block_text'] += 1
            else:
                iso, prec = date_from_filename(site_path)
                if iso:
                    document_date = {'date': iso, 'precision': prec}
                    stats['date_from_filename'] += 1
        if not document_date:
            document_date = {'date': None, 'precision': 'unknown'}
            stats['date_unknown'] += 1

        # ---- parts
        parts = None
        for b in blocks:
            if b['parts']:
                parts = extract_parts(plain_concat, site_path)
                break
        if not parts:
            parts = extract_parts(plain_concat, site_path)
        if parts:
            stats['parts_filled'] += 1

        # ---- served_since
        served_since = served_since_map.get(rel_from_museum)
        if not served_since:
            served_since = served_since_fallback(args.museum_root, rel_from_museum)
            stats['served_since_fallback_lookup'] += 1
        if served_since:
            stats['served_since_filled'] += 1
        else:
            stats['served_since_missing'] += 1

        # ---- language / machine_translation
        lang, mt = read_lang_and_mt(full_path)

        doc = {
            'page': site_path,
            'wing': info['wing'],
            'doc_class': doc_class,
            'collection': collection,
            'sources': sources,
            'document_date': document_date,
            'parts': parts,
            'served_since': served_since,
        }
        if lang and lang != 'en':
            doc['language'] = lang
        elif lang == 'en':
            doc['language'] = 'en'
        if mt:
            doc['machine_translation'] = True

        documents.append(doc)

        if truly_unsourced:
            unparsed.append((site_path, name_shape_redact(collapse(plain_concat))))

        stats['pages_done'] += 1
        if stats['pages_done'] % 3000 == 0:
            print(f'  {stats["pages_done"]}/{total}...', file=sys.stderr)

    out_doc = {'_schema_version': 1, 'documents': documents}
    out_path = os.path.join(args.out, 'documents.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out_doc, f, ensure_ascii=False, indent=1)
        f.write('\n')

    unparsed_path = os.path.join(args.out, 'unparsed.tsv')
    with open(unparsed_path, 'w', encoding='utf-8') as f:
        f.write('page\tblock_start\n')
        for p, snippet in unparsed:
            f.write(f'{p}\t{snippet}\n')

    report_path = os.path.join(args.out, 'field-fill-report.txt')
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write(f'PROVENANCE-BACKFILL-01 field-fill report\n')
        f.write(f'pages processed: {total}\n\n')
        for k in sorted(stats):
            f.write(f'{k}: {stats[k]}\n')
        f.write(f'\nunparsed (no source at all): {len(unparsed)}\n')

    print(f'wrote {out_path} ({len(documents)} documents)')
    print(f'wrote {unparsed_path} ({len(unparsed)} rows)')
    print(f'wrote {report_path}')
    for k in sorted(stats):
        print(f'  {k}: {stats[k]}')


def collapse(s):
    return WS.sub(' ', s.replace('\t', ' ').replace('\n', ' ')).strip()


if __name__ == '__main__':
    main()
