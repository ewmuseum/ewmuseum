#!/usr/bin/env python3
"""Standing fixer (PROVENANCE-BACKFILL-01, 2026-09-13 — the Janitor gavel: the source block must be
structured, not free-form prose). For every served page under museum/promotions/*/archive and */rp:
looks up its museum/data/documents.json row and renders a single <dl class="muted small provenance">
block from museum/scripts/templates/provenance-block.tpl, replacing EVERY existing provenance
paragraph on the page (the current `<p class="muted small provenance"...>` form, the older
`<p class="muted small">Source:...`/`Recovered...` forms, and — on the 47 two-block pages and the
5-block osw page — every extra retroactive-redaction/segment paragraph, whose facts already live in
the row's own sources[]/redaction-count-from-markers). The redaction count is NEVER read from prose:
it is counted fresh from this page's own `[redacted —` markers every run, exactly mirroring
museum/scripts/privacy-check.mjs's own regex, so it can never drift from the page again. Idempotent —
a page whose block already renders byte-identical to what this run would produce is left untouched.
A page with no documents.json row still gets a block (kind "unknown") and a report line — never a
crash. --dry counts only; never touches disk.

c60 PREFLIGHT-INCREMENTAL (2026-10-05, D308; preflight 256 timed this fixer at 370 s, 93% of it in the five strip
regexes and the footer search, whose leading `\s*` makes the engine try every position of every 22 kB page). Two
changes, neither of which changes a byte this fixer writes:
  1. THE SAME REGEXES, STARTED WHERE THEY CAN FIRST MATCH. Every strip pattern is `[ \t]*\n?\s*` + a fixed opening
     tag, and the footer search is `\s*` + optional chrome comment + `<footer`. A match must contain that opening
     literal (searched with the same re.I flag), so a page without it is left exactly as subn would leave it, and on a
     page with it the pattern is run unchanged from the start of the whitespace (and comment) run in front of its
     FIRST occurrence: no match can begin earlier, the patterns carry no anchor or look-behind, so the matches, the
     replacement and the count are the ones a run from offset 0 finds.
  2. A PER-PAGE SKIP when nothing the page's block depends on has changed. A page's result is a pure function of its
     own bytes, its documents.json row, the links_out joined to it from the show/rp shards, the template and this
     file. The manifest records, for every page this run found ALREADY CANONICAL (left byte-unchanged), the md5 of
     its bytes and of its row+links; the next run reuses a page only when both match, so a reuse never skips a write.
     The report lines (no-row, fallback-place) are replayed, so the summary line prints the same numbers either way.
     FULL RUN (and a fresh manifest) whenever: --full or PROV_BLOCK_MODE=full; the manifest is missing, unreadable,
     of another schema, museum root, python or unicode version; this file or the template changed; or
     --documents-json/--template point anywhere but the defaults (then no manifest is read or written). --dry and
     --no-manifest never read or write it. The manifest lives OUTSIDE the museum tree:
     $SCRATCH_ROOT/provenance-block-manifest.json (override PROV_BLOCK_MANIFEST); written last and atomically."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import re, glob, sys, os, json, argparse, subprocess, html, hashlib, io, unicodedata

PROV_SCHEMA = 1
PROV_MANIFEST = os.environ.get('PROV_BLOCK_MANIFEST') or os.path.join(_SCRATCH, 'provenance-block-manifest.json')


def _md5_path(p):
    try:
        with open(p, 'rb') as fh:
            return hashlib.md5(fh.read()).hexdigest()
    except OSError:
        return None


MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July',
               'August', 'September', 'October', 'November', 'December']

# hook c208 (the Janitor's D480, 2026-10-09: "(a) plain rename"): both wordings count. This is the counter that WRITES
# "carries N redactions", and the ruling renamed the marker without changing how many there are, so the declared count
# on every page must come out the same before and after.
MARKER = re.compile(r'\[redacted\s*(?:—|&mdash;)|\[(?:name|detail) withheld\]')
# hook c152 (2026-10-08; drafted as wave-CARE-WITHHOLD-1's footer proposal): the house WITHHELD marker ("[withheld
# &mdash; a passage held under the museum's content rule]", serve-pass.py's WH, the Janitor's content standard D206;
# one page carries a privacy-rule variant) was never counted, so 55 of the 61 pages carrying one declared "carries no
# redactions". It is counted on its own and declared in a phrase that the "N redactions" sum of privacy-check.mjs,
# fix-disclosure-counts.py and land-check L-DISCLOSE does not match ("N passages withheld, marked in place"), so their
# privacy-marker disclosure checks are unchanged; "carries no redactions" now renders only when the page carries neither.
WITHHELD = re.compile(r'\[withheld\s*(?:—|&mdash;)')

# ---- every existing provenance-carrying shape this fixer must remove -------
PROV_NEW = re.compile(r'[ \t]*\n?\s*<p class="muted small provenance"[^>]*>[\s\S]*?</p>\s*', re.I)
PROV_OLD_SOURCE = re.compile(r'[ \t]*\n?\s*<p class="muted small">\s*Source:[\s\S]*?</p>\s*', re.I)
PROV_OLD_RECOVERED = re.compile(r'[ \t]*\n?\s*<p class="muted small">\s*Recovered[\s\S]*?</p>\s*', re.I)
FOOTER_SOURCE_LINE = re.compile(r'[ \t]*\n?\s*<div class="muted[^"]*">\s*Source:[\s\S]*?</div>\s*', re.I)
NEW_DL = re.compile(r'[ \t]*\n?\s*<dl class="muted small provenance"[^>]*>[\s\S]*?</dl>\s*', re.I)
STRIP_PATTERNS = (PROV_NEW, PROV_OLD_SOURCE, PROV_OLD_RECOVERED, FOOTER_SOURCE_LINE, NEW_DL)

DOC_HEAD = re.compile(r'<div class="doc-head">.*?</div>\s*', re.S)
ARCHIVAL_NOTICE = re.compile(r'<div class="archival-notice">.*?</div>\s*', re.S)
FOOTER_TAG = re.compile(r'\s*(?:<!-- chrome:footer:start -->\s*)?<footer', re.I)


def load_template(path):
    src = open(path, encoding='utf-8').read()
    rows = {}
    for m in re.finditer(r'<!-- ROW:(\S+) -->\n(.*?)<!-- /ROW:\1 -->', src, re.S):
        rows[m.group(1)] = m.group(2).strip('\n')
    open_m = re.search(r'<!-- OPEN -->\n(.*?)<!-- /OPEN -->', src, re.S)
    open_tag = open_m.group(1).strip('\n').splitlines()[0]  # just the <dl ...> opening tag
    return rows, open_tag


def esc(s):
    return html.escape(str(s), quote=True)


def date_long(date, precision):
    if not date or precision == 'unknown':
        return None
    # 2026-09-13: trust the date's own shape over a mismatched precision (the backfill left some bare years
    # marked month/exact); never crash on a served page's date.
    shape = 'exact' if len(date) == 10 else 'month' if len(date) == 7 else 'year' if len(date) == 4 else None
    if shape is None:
        return date
    if precision in ('exact', 'month', 'year') and precision != shape:
        precision = shape
    if precision == 'circa':
        return 'c. ' + date_long(date, shape)   # 2026-09-30 CIRCA-DOCDATE: house style "c. <date>" (was "circa <date>", never rendered)
    if precision == 'exact':
        y, mo, d = date.split('-')
        return f'{int(d)} {MONTH_NAMES[int(mo)]} {y}'
    if precision == 'month':
        y, mo = date.split('-')
        return f'{MONTH_NAMES[int(mo)]} {y}'
    if precision == 'year':
        return date
    return None


def render_source_row(rows, src):
    kind = src.get('kind')
    url = src.get('url')
    if kind == 'newsgroup':
        ng = src.get('newsgroup')
        mid = src.get('msg_id')
        if ng and mid:
            if url:
                return (rows['source-newsgroup'].replace('{{URL}}', esc(url))
                        .replace('{{NEWSGROUP}}', esc(ng)).replace('{{MSGID}}', esc(mid)))
            return rows['source-newsgroup-nourl'].replace('{{NEWSGROUP}}', esc(ng)).replace('{{MSGID}}', esc(mid))
        if ng:
            return rows['source-newsgroup-noid'].replace('{{NEWSGROUP}}', esc(ng))
        if mid:
            return rows['source-newsgroup-nourl'].replace('{{NEWSGROUP}}', 'Usenet').replace('{{MSGID}}', esc(mid))
        return rows['source-unknown-bare']
    if kind == 'wayback':
        cap = src.get('captured_at')
        dl = date_long(cap, 'exact') if cap else None
        if url and dl:
            return rows['source-wayback'].replace('{{URL}}', esc(url)).replace('{{DATE_LONG}}', dl)
        if url:
            return rows['source-wayback-nodate'].replace('{{URL}}', esc(url))
        if dl:
            return rows['source-wayback-nourl'].replace('{{DATE_LONG}}', dl)
        return rows['source-wayback-bare']
    if kind == 'arquivo':
        cap = src.get('captured_at')
        dl = date_long(cap, 'exact') if cap else None
        if url and dl:
            return rows['source-arquivo'].replace('{{URL}}', esc(url)).replace('{{DATE_LONG}}', dl)
        return rows['source-arquivo-bare']
    if kind == 'geocities-torrent':
        if url:
            return rows['source-geocities-torrent'].replace('{{PATH}}', esc(url))
        return rows['source-geocities-torrent-bare']
    if kind == 'commoncrawl':
        cap = src.get('captured_at')
        dl = date_long(cap, 'exact') if cap else None
        if url and dl:
            return rows['source-commoncrawl'].replace('{{URL}}', esc(url)).replace('{{DATE_LONG}}', dl)
        return rows['source-commoncrawl-bare']
    if kind == 'forum':
        # 2026-09-28: a post on a forum (GAVELS 2026-09-23 accepted the `forum` source kind; the museum's own
        # PTC forum, accession 0160, is the first). Rendered exactly as `newsgroup` and `wayback` are — from the
        # row's OWN url and its own `identifier` ("PTC forum, <board title>, post <n>"), with no prose of the
        # fixer's own and no account name anywhere (the forum converter never writes a handle into an identifier).
        ident = src.get('identifier')
        if url and ident:
            return rows['source-forum'].replace('{{URL}}', esc(url)).replace('{{IDENTIFIER}}', esc(ident))
        if ident:
            return rows['source-forum-nourl'].replace('{{IDENTIFIER}}', esc(ident))
        if url:
            return rows['source-forum-nolabel'].replace('{{URL}}', esc(url))
        return rows['source-forum-bare']
    if kind == 'direct':
        if url:
            return rows['source-direct'].replace('{{URL}}', esc(url))
        return rows['source-direct-bare']
    # unknown
    if url:
        return rows['source-unknown'].replace('{{URL}}', esc(url))
    return rows['source-unknown-bare']


LANG_NAMES = {'pl': 'Polish', 'pt': 'Portuguese', 'es': 'Spanish', 'fr': 'French', 'en': 'English'}


def render_block(rows, open_tag, doc, marker_count, page_links=(), withheld_count=0, author=None):
    lines = []
    anchors = []   # v124 #holders-site-links, filled from `page_links` at the end

    # hook c237 (CURATION v135, #author-credit): a single-author wing's documents name its author, first. The value is
    # the wing's own registry `author` (joined in main()), never page text; a wing without one renders exactly as before.
    if author and 'written-by' in rows:
        lines.append(rows['written-by'].replace('{{AUTHOR}}', esc(author)))

    collection = doc.get('collection')
    if collection:
        lines.append(rows['collection'].replace('{{LOT}}', esc(collection)))

    sources = doc.get('sources') or []
    if not sources:
        lines.append(rows['source-unknown-bare'])
    for src in sources:
        lines.append(render_source_row(rows, src))

    dd = doc.get('document_date') or {'date': None, 'precision': 'unknown'}
    prec = dd.get('precision', 'unknown')
    dl = date_long(dd.get('date'), prec)
    if dl and prec in ('exact', 'month', 'year'):
        lines.append(rows[f'date-{prec}'].replace('{{DATE_LONG}}', dl))
    elif dl and prec == 'circa':
        # 2026-09-30 CIRCA-DOCDATE: a circa date is a known approximate date, printed "c. <date>" (was "undated").
        # Uses the template's own date-circa row when it has one, else the plain exact-date row (same markup).
        lines.append(rows.get('date-circa', rows['date-exact']).replace('{{DATE_LONG}}', dl))
    else:
        lines.append(rows['date-unknown'])

    parts = doc.get('parts')
    if isinstance(parts, int): parts = {'n': None, 'of': parts}  # 2026-09-21 (KNI): a bare integer is the part count
    if isinstance(parts, dict) and parts.get('of'):
        if parts.get('n'):
            lines.append(rows['parts'].replace('{{N}}', str(parts['n'])).replace('{{OF}}', str(parts['of'])))
        else:
            lines.append(rows['parts-of-only'].replace('{{OF}}', str(parts['of'])))

    if marker_count > 0 and withheld_count > 0:
        lines.append(rows['redactions-and-withheld'].replace('{{COUNT}}', str(marker_count))
                     .replace('{{S}}', '' if marker_count == 1 else 's')
                     .replace('{{WCOUNT}}', str(withheld_count))
                     .replace('{{WS}}', '' if withheld_count == 1 else 's'))
    elif marker_count > 0:
        lines.append(rows['redactions'].replace('{{COUNT}}', str(marker_count))
                     .replace('{{S}}', '' if marker_count == 1 else 's'))
    elif withheld_count > 0:
        lines.append(rows['withheld'].replace('{{WCOUNT}}', str(withheld_count))
                     .replace('{{WS}}', '' if withheld_count == 1 else 's'))
    else:
        lines.append(rows['redactions-none'])

    served_since = doc.get('served_since')
    if served_since:
        y, mo, d = served_since.split('-')
        lines.append(rows['served-since'].replace('{{DATE_LONG}}', f'{int(d)} {MONTH_NAMES[int(mo)]} {y}'))

    lang = doc.get('language')
    if lang and lang != 'en':
        name = LANG_NAMES.get(lang, lang)
        mt = ' (machine-translated)' if doc.get('machine_translation') else ''
        lines.append(rows['language'].replace('{{LANGUAGE_NAME}}', name).replace('{{MT_SUFFIX}}', mt))

    # THE HOLDER'S-OWN-SITE LINK-OUT (the Janitor, 2026-09-27: "I feel like we should link to
    # promotions, bios, etc on Argyle's site in the placards"; CURATION.md v124,
    # #holders-site-links). A served card/rp page has no placard, so its link-out rides the one
    # structured block it does have. The links are NOT a per-document field and are never
    # hand-written onto a page: they come from the SHOW (or roleplay) registry record whose own
    # `page` is this page, joined in main() and passed in as `page_links` — so this row can only
    # ever say what the registry says, exactly as every other row here does.
    for l in page_links or ():
        if not (isinstance(l, dict) and l.get('url') and l.get('label')):
            continue
        anchors.append(f'<a href="{esc(l["url"])}" rel="noopener nofollow">{esc(l["label"])}</a>')
    if anchors:
        lines.append(rows['also-at'].replace('{{LINKS}}', ' &middot; '.join(anchors)))

    doc_class_tag = open_tag.replace('{{DOC_CLASS}}', esc(doc.get('doc_class') or 'none'))
    body = '\n'.join('  ' + l for l in lines)
    return f'{doc_class_tag}\n{body}\n</dl>'


# c60: the fixed opening literal every match of each strip pattern contains (same flag), and a one-char \s test.
_WS = re.compile(r'\s')
_STRIP_CORES = {
    PROV_NEW: re.compile(re.escape('<p class="muted small provenance"'), re.I),
    PROV_OLD_SOURCE: re.compile(re.escape('<p class="muted small">'), re.I),
    PROV_OLD_RECOVERED: re.compile(re.escape('<p class="muted small">'), re.I),
    FOOTER_SOURCE_LINE: re.compile(re.escape('<div class="muted'), re.I),
    NEW_DL: re.compile(re.escape('<dl class="muted small provenance"'), re.I),
}
_FOOTER_CORE = re.compile(re.escape('<footer'), re.I)
_FOOTER_COMMENT = '<!-- chrome:footer:start -->'
_FOOTER_COMMENT_RE = re.compile(re.escape(_FOOTER_COMMENT), re.I)


def _ws_run_start(src, k):
    while k > 0 and _WS.match(src, k - 1):
        k -= 1
    return k


def _subn_from_first(pat, src):
    m = _STRIP_CORES[pat].search(src)
    if not m:
        return src, 0
    k = _ws_run_start(src, m.start())
    tail, n = pat.subn('', src[k:])
    return (src[:k] + tail if n else src), n


def strip_old_blocks(src):
    n = 0
    for pat in STRIP_PATTERNS:
        src, k = _subn_from_first(pat, src)
        n += k
    return src, n


def _footer_search(src):
    m = _FOOTER_CORE.search(src)
    if not m:
        return None
    k = _ws_run_start(src, m.start())
    c = len(_FOOTER_COMMENT)
    if k >= c and _FOOTER_COMMENT_RE.fullmatch(src, k - c, k):
        k = _ws_run_start(src, k - c)
    return FOOTER_TAG.search(src, k)



# 2026-09-13 (gate 139 red, 109 pages): legacy footers carry their own numbered "carries N redactions" sentence; the
# structured block is now the only declaration the gate should sum, so the footer's number is dropped ("carries
# redactions"), which privacy-check's count regex no longer matches. The legacy footer prose itself is a separate
# clean-up (structured-source-block gavel).
LEGACY_FOOTER_DECL = re.compile(r'(carries\s+)(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(\s+redactions?\b)', re.I)
def neutralise_footer_declarations(html):
    # 2026-09-13 (gate 139 run 2): the legacy number can sit in any muted paragraph, not only the footer; the
    # structured block is rendered AFTER this pass, so its own number survives.
    return LEGACY_FOOTER_DECL.sub(lambda d: d.group(1) + d.group(2).lstrip(), html)

def find_insertion_point(src):
    # every observed page's provenance block sits immediately before its
    # <footer> — the one consistent anchor across every doc-class and both
    # the old and new templates (confirmed by direct read of iicw, 3dw, and
    # the osw 5-block compilation, whose LAST block also sits right before
    # its footer). Falls back to right after the archival-notice / doc-head
    # only for the ~85 pages (folder-index pages, mostly) with no <footer>
    # tag at all.
    m = _footer_search(src)   # c60: FOOTER_TAG.search(src), started where it can first match
    if m:
        return m.start()
    m = ARCHIVAL_NOTICE.search(src)
    if m:
        return m.end()
    m = DOC_HEAD.search(src)
    if m:
        return m.end()
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--museum-root', default=f'{_ROOT}')
    ap.add_argument('--documents-json', default=None)
    ap.add_argument('--template', default=None)
    ap.add_argument('--dry', action='store_true')
    ap.add_argument('--full', action='store_true', help='c60: ignore the manifest, walk every page (and record a fresh one)')
    ap.add_argument('--no-manifest', action='store_true', help='c60: walk every page; never read or write the manifest')
    args = ap.parse_args()

    M = args.museum_root
    docs_path = args.documents_json or os.path.join(M, 'data/documents.json')
    tpl_path = args.template or os.path.join(M, 'scripts/templates/provenance-block.tpl')

    if not args.dry:
        if _live_running("scripts/gate[.]sh|registry-validate|cross-reference[.]mjs|privacy-check", M):
            sys.exit("REFUSED: a gate or build is running")

    doc_rows = json.load(open(docs_path, encoding='utf-8'))['documents']
    by_page = {d['page']: d for d in doc_rows}
    # v124 #holders-site-links: a served page's link-out belongs to the SHOW or ROLEPLAY record
    # this page renders, not to the document row, so it is joined here by the record's own served page:
    # a show row's `page`, a roleplay row's `served_url` (docs/SCHEMA.md; rps rows carry no `page`).
    # Shows and roleplays are sharded per wing; a record with no links_out contributes nothing,
    # and a page whose record is missing behaves exactly as it did before this patch.
    links_by_page = {}
    for shard in sorted(glob.glob(f'{M}/data/shards/*/shows.json') + glob.glob(f'{M}/data/shards/*/rps.json')):
        try:
            recs = json.load(open(shard, encoding='utf-8'))
        except (OSError, ValueError):
            continue
        for r in recs if isinstance(recs, list) else []:
            # hook c126 (2026-10-07, wave-ARGYLE-LINKOUT-2): until c126 only `page` was read, so no roleplay row's
            # links_out ever reached its served rp page. Both keys have the form this loop looks pages up by
            # ('/promotions/<wing>/{archive,rp}/<slug>.html'); a show row keeps `page` first, as before.
            pg = (r.get('page') or r.get('served_url')) if isinstance(r, dict) else None
            if pg and r.get('links_out'):
                links_by_page.setdefault(pg, []).extend(r['links_out'])
    rows, open_tag = load_template(tpl_path)

    # hook c237 (CURATION v135, #author-credit): the wing's own credited author, from data/promotions.json. Only a
    # non-empty string counts; an unreadable registry leaves every block exactly as it was before c237.
    author_by_wing = {}
    try:
        _P = json.load(open(os.path.join(M, 'data/promotions.json'), encoding='utf-8'))
        for _p in (_P.get('promotions') if isinstance(_P, dict) else _P) or []:
            if isinstance(_p, dict) and isinstance(_p.get('author'), str) and _p['author'].strip():
                author_by_wing[_p.get('id')] = _p['author'].strip()
    except (OSError, ValueError):
        author_by_wing = {}

    rewritten = same = no_row = no_place = 0
    report = []

    # ---- c60: the manifest --------------------------------------------------------------------------------------
    use_manifest = not (args.dry or args.no_manifest or args.documents_json or args.template)
    head = {'schema': PROV_SCHEMA, 'root': os.path.realpath(M), 'fixer': _md5_path(os.path.abspath(__file__)),
            'template': _md5_path(tpl_path), 'python': '%d.%d' % sys.version_info[:2],
            'unicode': unicodedata.unidata_version}
    prev_pages, why = {}, None
    if use_manifest:
        if args.full or os.environ.get('PROV_BLOCK_MODE') == 'full':
            why = 'full requested'
        else:
            try:
                prev = json.load(open(PROV_MANIFEST, encoding='utf-8'))
                if not isinstance(prev, dict) or not isinstance(prev.get('pages'), dict):
                    why = 'manifest of another shape'
                else:
                    why = next((f'manifest {k} differs' for k, v in head.items() if prev.get(k) != v), None)
                    if why is None:
                        prev_pages = prev['pages']
            except (OSError, ValueError):
                why = 'no readable manifest'
        print(f'fix-provenance-block: mode {"incremental" if why is None else "full (" + why + ")"}')
    new_pages = {}
    reused = 0

    files = sorted(glob.glob(f'{M}/promotions/*/archive/*.html') + glob.glob(f'{M}/promotions/*/rp/*.html'))
    for f in files:
        rel = '/' + os.path.relpath(f, M)
        raw = open(f, 'rb').read()
        s = io.TextIOWrapper(io.BytesIO(raw), encoding='utf-8', errors='replace').read()   # = open(f, encoding=, errors=).read()
        o = s

        doc = by_page.get(rel)
        row_missing = doc is None
        page_links = links_by_page.get(rel) or []
        _wing = (doc or {}).get('wing') or (rel.split('/')[2] if rel.startswith('/promotions/') else None)
        author = author_by_wing.get(_wing)   # hook c237
        if use_manifest:
            ph = hashlib.md5(raw).hexdigest()
            ch = hashlib.md5(json.dumps([doc, page_links] + ([author] if author else []), sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()
            e = prev_pages.get(rel)
            if isinstance(e, list) and len(e) == 3 and e[0] == ph and e[1] == ch and e[2] in (0, 1):
                # unchanged since a run that found this page canonical: the same inputs give the same no-op
                if row_missing:
                    no_row += 1
                    report.append('no-row: ' + rel)
                if e[2]:
                    report.append('fallback-place: ' + rel)
                same += 1
                reused += 1
                new_pages[rel] = e
                continue
        fallback = 0
        if row_missing:
            no_row += 1
            report.append('no-row: ' + rel)
            doc = {'page': rel, 'doc_class': 'none', 'collection': None,
                   'sources': [], 'document_date': {'date': None, 'precision': 'unknown'},
                   'parts': None, 'served_since': None}

        s = neutralise_footer_declarations(s)
        stripped, n_removed = strip_old_blocks(s)
        marker_count = len(MARKER.findall(stripped))
        withheld_count = len(WITHHELD.findall(stripped))
        new_block = render_block(rows, open_tag, doc, marker_count, page_links, withheld_count, author)   # hook c237

        ins = find_insertion_point(stripped)
        if ins is None:
            # 2026-09-13: six pages carry no footer at all (truncated shells); place the block before </main> or
            # </body>, else at the end of the file, rather than leaving them un-migrated.
            m = re.search(r'\s*</main>|\s*</body>', stripped, re.I)
            ins = m.start() if m else len(stripped)
            report.append('fallback-place: ' + rel)
            fallback = 1
        # normalise the seam on both sides every run (not just when a prior
        # block's own trailing \s* happened to eat the pre-existing gap) —
        # otherwise the very first run on a page with no prior block glues
        # the new block to the previous tag and doubles blank lines against
        # the original gap, only settling into a stable byte sequence on
        # the SECOND run. Rstrip/lstrip here makes one run already stable.
        before = stripped[:ins].rstrip()
        after = stripped[ins:].lstrip('\n')
        new_s = before + '\n\n' + new_block + '\n\n' + after

        if new_s == o:
            same += 1
            if use_manifest:
                new_pages[rel] = [ph, ch, fallback]   # recorded ONLY for a page left byte-unchanged
            continue

        if not args.dry:
            open(f, 'w', encoding='utf-8').write(new_s)
        rewritten += 1

    if use_manifest:
        try:
            os.makedirs(os.path.dirname(PROV_MANIFEST), exist_ok=True)
            tmp = f'{PROV_MANIFEST}.tmp{os.getpid()}'
            with open(tmp, 'w', encoding='utf-8') as fh:
                json.dump(dict(head, pages=new_pages), fh)
            os.replace(tmp, PROV_MANIFEST)
            print(f'fix-provenance-block: {reused} of {len(files)} pages reused from the manifest; '
                  f'{len(new_pages)} recorded ({PROV_MANIFEST})')
        except OSError as e:
            print(f'fix-provenance-block: manifest not written ({e.__class__.__name__})')

    print(f'fix-provenance-block: rewritten {rewritten} | already canonical {same} | '
          f'no documents.json row {no_row} | no insertion point {no_place}' + (' (dry)' if args.dry else ''))
    if report:
        print('  first 15 report lines:')
        for line in report[:15]:
            print('   ', line)


if __name__ == '__main__':
    main()
