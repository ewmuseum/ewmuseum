#!/usr/bin/env python3
"""Standing preflight fixer (PATH-SCRUB, hook c111, 2026-10-07; the Janitor, chat 2026-10-07 ~08:45 PDT: "The publicly exposed
frontier list exposes details of files and file structure on my local machine, which doesn't seem appropriate.").

The museum serves data/*.json. Source fields (evidence `source`, `first_seen_in`, `digest`, notes) carried the workshop's own
paths (<workshop>/top200/..., /home/<user>/...) and workshop file names (x.tsv). This fixer takes them out of the SOURCE files,
before build:data regenerates the served monoliths. It touches the path token and its own separator only:

  - a parenthetical that held only a path goes whole ("... 2001 (<workshop>/pcw/results/380.txt)" -> "... 2001");
  - a path inside a parenthetical or a list loses itself and its separator ("(rspwf.com/dirlisting.cfm, 2002 captures; <workshop>/top200/x.json)"
    -> "(rspwf.com/dirlisting.cfm, 2002 captures)");
  - a path that opened a value, followed by its description, loses itself and its separator;
  - a path that is the whole value (or the whole evidence once the rest is gone) becomes "a copy held in the workshop";
  - a path that is the object of a preposition in running prose becomes "the workshop" (a directory) or "a workshop file".

NEVER changed: a served page path (promotions/<wing>/archive/..., /promotions/...), a real http(s) URL or host-and-path
(rspwf.com/dirlisting.cfm), a wing-relative served page (archive/<one-segment>.html). A served path with a stray workshop prefix (`<workshop>/promotions/<wing>/...`) loses only the
prefix.

Edits are made on the RAW TEXT of each JSON string literal (never a re-serialise), so every other byte of the file, its indent included,
stays exactly as it was (memory: registry-json-indent). Idempotent: a clean second run reports zero changes. Files:
data/shards/*/*.json (the _headers too) and the top-level registries that are SOURCES. Never the generated files (the shard-type
monoliths, *-index.json, wanted.json): build:data and cross-reference regenerate those from what this fixes.

The paths taken out are NOT lost: each changed field's removed tokens go to the WORKSHOP ledger
$PATH_SCRUB_LEDGER (default $WORKSHOP_ROOT/desk/path-scrub-ledger.tsv; file, nearest row id or name, the tokens), never into the museum tree.

Usage: scrub-workshop-paths.py [--dry] [--report]   (MUSEUM_ROOT in the environment selects the museum; default the live one.)
 --dry   change nothing, print counts.   --report  also print every before/after pair (for review).
"""
import glob
import json
import os
import re
import sys

_ROOT = os.environ.get('MUSEUM_ROOT') or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_WORKSHOP = os.environ.get('WORKSHOP_ROOT') or os.path.join(os.path.dirname(os.path.abspath(_ROOT)), 'archive')

# The phrases avoid "the museum": text-markers.mjs treats it as curator voice (PROCESS_TEXT_RE), and the provenance-note validator
# rejects a summary that carries it. "workshop" alone is not a marker ("held in the workshop, not served" is already served text).
NEUTRAL = "a copy held in the workshop"
PH_DIR = "the workshop"
PH_FILE = "a workshop file"

# usenet-collected and usenet-retro: hook c122 (D433), the two usenet collection folders the first list missed
PREFIXES = r'(?:archive|url-walk|ops-scratch|fwrestling-census|direct-collected|usenet-collected|usenet-retro|desk|wwv-vault|digests|holdings)'
STOPCH = r'\s;,()<>"\'\u201c\u201d\u2018\u2019\u2014\u2013'
# a path piece after the prefix: segment(s) ending in "/", or one segment that looks like a file/dir name (has . _ - or a digit);
# a bare word ("<workshop>/museum") is prose and is never a token. Commas count only between digits ("1139,1141,1142.htm").
_PIECE = r'(?:[^' + STOPCH + r']|,(?=\d))*'
ABS_RE = re.compile(r'(?<![\w./:@-])/(?:home|tmp|mnt|var|root|Users)/(?:\d{1,2} [A-Z][a-z]+ \d{4}|[^' + STOPCH + r']|,(?=\d))*')
GEN_RE = re.compile(r'(?<![\w./:@-])' + PREFIXES + r'/' + _PIECE)
WEAK_PREFIX_RE = re.compile(r'^(?:digests|holdings|desk)/')   # words that are also ordinary prose or a served name: a token only with a file extension
EXT_END_RE = re.compile(r'\.\w{2,5}$')
NOT_WORKSHOP_RE = re.compile(r'^(?:archive)/index\.php')          # a forum URL shape (vBulletin archive/index.php/t-<id>.html), not a path
LOOKS_PATH_RE = re.compile(r'^[^/]+/|^[^/]*[._\d-]')    # after the prefix: more segments, or a name with . _ - or a digit
# a workshop file NAME (with any directories in front of it); museum repo paths (scripts/, data/, docs/) are the museum's own and stay
FILE_RE = re.compile(r'(?<![\w./:@%~-])(?:[\w-]+/)*[\w.-]+\.(?:tsv|jsonl|py|sh)\b(?![/?=\w])')
REPO_DIRS = ('scripts/', 'data/', 'docs/', 'museum/', 'tests/', 'ops/')
SERVED_REL_RE = re.compile(r'^archive/[^/\s]+\.html?$')            # wing-relative served page: kept
STRAY_RE = re.compile(r'^(?:archive|museum)/(promotions/[^/\s]+/archive/.+)$')  # a served path with a stray workshop/repo prefix: prefix only
MUSEUM_STRAY_RE = re.compile(r'(?<![\w./:@-])museum/(promotions/[^/\s]+/archive/[^\s;,()<>"]*)')
# Workshop names that hold spaces (the walk's own folders). Extended at run time from the workshop's top level, when it is there.
SPACE_NAMES = ["1 - UWF", "BUCK BROTHERS WRESTLING (BBW) INFORMATION & APPLICATION.md"]
try:
    for _n in os.listdir(_WORKSHOP):
        if ' ' in _n and _n not in SPACE_NAMES and not _n.lower().endswith('.pdf'):
            SPACE_NAMES.append(_n)
except OSError:
    pass
# Top-level workshop folders (snapshot 2026-10-07, plus whatever the workshop lists at run time): 'archive/<one of these>' with nothing after it
# is still a workshop path ("appears in <workshop>/pcw (89 MB)"). Any other bare '<workshop>/word' is prose and is left alone.
BARE_DIRS = set('''
4ww acw adw aol-members bbs-era bdw caw-talent-wiki ccwa ccw-wrestleonline collect-never-serve colosseum-chase
commoncrawl-census cornellverse cult cwfpro-boardhost desk diaries digests direct-collected dwo eighties-hunt epic
ewmuseum external fandom fandom-ewrestling fantasywrestling fb-probes fidonet freehost-liveness frontier-liveness
frontier-log frp-archives fw-hub-history fwrestling-census fwrestling-samples geocities geocities-colosseum
geocities-torrent geocities-vault gg-rgfrp-index gg-rgpbm-index gg-rspwf-index gg-rspw-index giwf giwf-yahoogroup gw
harddrive2 hubs ia-overnight iwf-web laptop2 living living-preservation low museum-scratch NAPW nccw net netnews-cds
Newsletters nfw ops-scratch osw osw-online paper-mayhem patches pbm57-campaign pbm-com pcw pfighting Phenomenons
playiwa playiwa-reference privacy prodigy prose-waves ptc ptc-beacons ptc-campaign pt-scene pure rec-games-triage
reddit-native r-efeds rescued research-ecosystem research-inbound retired-wings rpcommunity rspwf-founding
scoops-cyberslam spectre-leads squaredcircle-prep step3 tapatalk-probe textfiles-survey tools top200 tslams twiw
uiwf-web uiwf-yahoogroup url-walk usenet usenet-collected usenet-pbm usenet-retro usenet-rspwf-late utzoo
utzoo-recheck uwf uwf-org-uk uwf-rp-resurrections uwf-yahoogroup vault-corpora wce-chase wikipedia wikiteam-dumps
wrestleonline wrestling-world-magazine wwa wwo xuw xwf xwf-2001-nupes youtube-layer youtube-media yt-preservation
'''.split())
try:
    BARE_DIRS.update(n for n in os.listdir(_WORKSHOP) if ' ' not in n and os.path.isdir(os.path.join(_WORKSHOP, n)))
except OSError:
    pass
SPACE_NAMES.sort(key=len, reverse=True)
SPACE_START_RE = re.compile(r'(?<![\w./:@-])archive/(' + '|'.join(re.escape(n) for n in SPACE_NAMES) + r')(?=/|$|[\s;,()<>"\'\u2014\u2013.])')


def _space_token_end(s, i):
    """The end of a path token that starts at s[i] with a space-bearing name (segments may hold spaces; the last one ends at ' (',
    ' —', ';', ')', ', ', a sentence stop or the end)."""
    j = i
    while True:
        k = j
        while k < len(s):
            c = s[k]
            if c in '/;)(\n—–' or s.startswith(', ', k) or (c == '.' and (k + 1 == len(s) or s[k + 1] in ' \n')):
                break
            k += 1
        if k < len(s) and s[k] == '/':
            j = k + 1
            continue
        return s[:k].rstrip(' '), k   # trailing space belongs to the prose, not the name


def _acceptable(tok, kind, s, b):
    """Is this regex hit a workshop token (and not prose, a URL shape, or a museum-repo path)?"""
    if kind == 'file':
        if tok.startswith(REPO_DIRS): return False
        return not re.search(r'https?://\S*' + re.escape(tok), s)
    if kind == 'path':
        if NOT_WORKSHOP_RE.match(tok) or s[b:b + 1] == '<': return False
        if WEAK_PREFIX_RE.match(tok) and not EXT_END_RE.search(tok): return False
        rest = tok.split('/', 1)[1]
        return bool(LOOKS_PATH_RE.match(rest)) or (tok.startswith('archive/') and rest in BARE_DIRS)
    return True


def find_token(s, start=0):
    """First token at or after `start`: (a, b, kind), kind in abs|path|file; None."""
    best = None
    for kind, rx in (('abs', ABS_RE), ('path', GEN_RE), ('file', FILE_RE)):
        pos = start
        while True:
            m = rx.search(s, pos)
            if not m: break
            a, b = m.start(), m.end()
            while b > a and s[b - 1] in '.:': b -= 1
            if _acceptable(s[a:b], kind, s, b):
                if best is None or a < best[0]: best = (a, b, kind)
                break
            pos = m.end()
    m = SPACE_START_RE.search(s, start)
    if m and (best is None or m.start() <= best[0]):
        name_end = m.end(1)
        _, end = _space_token_end(s, name_end)
        # a file-name SPACE_NAME ends where the name ends; a folder takes its '/...' tail
        if os.path.splitext(m.group(1))[1] and s[name_end:name_end + 1] != '/': end = name_end
        best = (m.start(), max(end, name_end), 'path')
    return best


def _paren_span(s, a, b):
    """Innermost '(' ... ')' pair wrapping s[a:b]: (open, close) or None."""
    depth = 0
    o = None
    for i in range(a - 1, -1, -1):
        c = s[i]
        if c == ')': depth += 1
        elif c == '(':
            if depth == 0: o = i; break
            depth -= 1
    if o is None: return None
    depth = 0
    for i in range(b, len(s)):
        c = s[i]
        if c == '(': depth += 1
        elif c == ')':
            if depth == 0: return (o, i)
            depth -= 1
    return None


def _match_close(s, o):
    depth = 0
    for i in range(o, len(s)):
        if s[i] == '(': depth += 1
        elif s[i] == ')':
            depth -= 1
            if depth == 0: return i
    return -1


LEAD = r'(?:see(?: also)?|e\.g\.,?|cf\.|held (?:at|in)|now (?:at|in)|kept (?:at|in)|cited in|filed (?:at|in)|stored (?:at|in)|read (?:in|from)|per|from|in|at|under|via|the (?:file|folder|directory))'
LEAD_TAIL_RE = re.compile(r'(?:^|(?<=[\s(;,]))' + LEAD + r'\s+$', re.I)
PREP_TAIL_RE = re.compile(r'\b(?:in|at|from|per|to|via|under|into|on|of|with|by|using|read|named|called|and|or|plus|than|through|against|see)\s+$', re.I)
SEP_TAIL_RE = re.compile(r'\s*[;,:—–]\s*$')
SEP_HEAD_RE = re.compile(r'^\s*[;,:—–]\s*')
JUNK_RE = re.compile(r'[\s\W_]*$')


def _tidy_join(left, right):
    """Join two halves, fixing only the seam: no space before , ; : . ) and after (; one space otherwise."""
    if not left.strip():
        return right.lstrip()
    if not right.strip():
        return left.rstrip()
    if right[:1] in ',;:.)':
        return left.rstrip() + right
    if left.rstrip().endswith('(') :
        return left.rstrip() + right.lstrip()
    if left.endswith(' ') or right.startswith(' '):
        return left.rstrip() + ' ' + right.lstrip()
    return left + right


def _only_leadwords(t):
    t = re.sub(LEAD, '', t, flags=re.I)
    return not re.search(r'[A-Za-z0-9]', t)


def edit_one(s, a, b, kind):
    pre, post = s[:a], s[b:]
    tok = s[a:b]
    # served shorthand and the stray prefix are not scrubbed (stray: prefix only)
    m = STRAY_RE.match(tok)
    if m and kind == 'path':
        return pre + m.group(1) + post
    # 1. inside a parenthesis
    ps = _paren_span(s, a, b)
    if ps:
        o, c = ps
        inner_pre, inner_post = s[o + 1:a], s[b:c]
        mm = LEAD_TAIL_RE.search(inner_pre)
        if mm: inner_pre = inner_pre[:mm.start()]
        before_sep = SEP_TAIL_RE.search(inner_pre)
        after_sep = SEP_HEAD_RE.search(inner_post)
        if not inner_pre.strip() and not inner_post.strip():
            # the parenthesis held only the path: it goes whole, with the space before it
            return _tidy_join(s[:o].rstrip(' '), s[c + 1:])
        if not inner_pre.strip() and after_sep:        # (path, rest) / (path — rest)
            inner = inner_post[after_sep.end():]
        elif before_sep:                              # (rest; path) / (rest; path; more)
            inner = inner_pre[:before_sep.start()] + inner_post
        elif after_sep and inner_pre.strip():
            inner = inner_pre + inner_post[after_sep.end():]
        else:
            inner = None
        if inner is not None:
            if _only_leadwords(inner) or not inner.strip(' ;,:—–'):
                return _tidy_join(s[:o].rstrip(' '), s[c + 1:])
            return s[:o + 1] + inner + s[c:]
        # path embedded mid-clause inside the parenthesis: falls through to the prose rules below
    # 2. a path that opens the value (or a clause after ';')
    head_pre = pre.strip()
    if not head_pre:
        # path then a parenthetical: unwrap it ("path (a roster card)" -> "a roster card")
        pm = re.match(r'^\s*\(', post)
        if pm:
            o = b + post.index('(')
            c = _match_close(s, o)
            if c > 0:
                return _tidy_join('', s[o + 1:c] + s[c + 1:])
        sh = SEP_HEAD_RE.search(post)
        if sh:
            return post[sh.end():]
        if not post.strip(' .;,:)'):
            return ''
        # path then prose
        return PH_FILE_OR_DIR(tok, kind, pre, post)
    # 3. a path after a lead-in word ('see x', 'held in x'): prepositional object -> neutral noun phrase
    lead = LEAD_TAIL_RE.search(pre) or PREP_TAIL_RE.search(pre)
    if lead:
        # 'raw articles at <path>.' / 'recovered to <path>.': a closing locative clause is dropped with its preposition
        loc = re.search(r'(?:recovered|saved|copied|written|banked|parked|placed|mirrored) (?:to|into)\s+$', pre, re.I)
        if loc:
            left = pre[:loc.start() + len(loc.group(0).split()[0])].rstrip()
            if re.match(r'^\s*(?:[.;)]|$)', post):
                return _tidy_join(left, post)
        return pre + PH_FILE_OR_DIR(tok, kind, pre, post, bare=True) + post
    # 4. after a separator: the separator goes with the path
    sp = SEP_TAIL_RE.search(pre)
    if sp:
        if sp.group(0).strip() == ':' and not SEP_HEAD_RE.search(post):
            return pre + PH_FILE_OR_DIR(tok, kind, pre, post, bare=True) + post
        if sp.group(0).strip() == ':':
            sh = SEP_HEAD_RE.search(post)
            return pre + post[sh.end():]
        return _tidy_join(pre[:sp.start()], post)
    return pre + PH_FILE_OR_DIR(tok, kind, pre, post, bare=True) + post


ART_TAIL_RE = re.compile(r"(?:\b(?:a|an|the|own|this|that|its|their|these|those|another|each)|['\u2019]s)\s+$", re.I)


def PH_FILE_OR_DIR(tok, kind, pre, post, bare=False):
    """The neutral noun phrase for a path that is the object of a preposition in running prose."""
    isdir = kind != 'file' and (tok.endswith('/') or not re.search(r'\.\w{1,6}$', tok.split('/')[-1]))
    ph = PH_DIR if isdir else PH_FILE
    if ART_TAIL_RE.search(pre):                       # 'the' / 'own' / "lane's" already stands before it: no second article
        ph = 'workshop' if ph == PH_DIR else 'workshop file'
    if not pre.strip() or re.search(r'[.!?]\s+$', pre):
        ph = ph[:1].upper() + ph[1:]
    return ph if bare else pre + ph + post


def scrub(s):
    """The scrubbed string (or s itself when it holds no token)."""
    if not isinstance(s, str): return s
    out = MUSEUM_STRAY_RE.sub(r'\1', s)    # 'museum/promotions/<wing>/archive/x.html' -> the served address, prefix only
    pos = 0
    for _ in range(64):
        t = find_token(out, pos)
        if not t: break
        a, b, kind = t
        tok = out[a:b]
        if kind == 'path' and SERVED_REL_RE.match(tok):
            pos = b
            continue
        new = edit_one(out, a, b, kind)
        if new == out:
            pos = b
            continue
        out = new
        pos = 0
    if out != s:
        if not re.search(r'[A-Za-z0-9]', re.sub(LEAD, '', out, flags=re.I)) or not out.strip():
            out = NEUTRAL
        out = re.sub(r'[ \t]{2,}', ' ', out) if out != s and '  ' not in s else out
        out = out.strip(' ') if s == s.strip(' ') else out
    return out


# ---- file layer: raw-text, literal by literal -------------------------------------------------------------------------
LIT_RE = re.compile(r'"(?:[^"\\\n]|\\.)*"')
TRIGGER_RE = re.compile(PREFIXES + r'/|/(?:home|tmp|mnt|var|root|Users)/|\.(?:tsv|jsonl|py|sh)\b|\\u0020|1 - UWF')
GENERATED = re.compile(r'(-index\.json|wanted\.json)$')
SHARD_TYPE_MONOLITHS = {'characters', 'units', 'shows', 'rps', 'reigns', 'titles', 'awards'}


def source_files(root):
    fs = sorted(glob.glob(os.path.join(root, 'data', 'shards', '*', '*.json')))
    for f in sorted(glob.glob(os.path.join(root, 'data', '*.json'))):
        b = os.path.basename(f)
        if GENERATED.search(b) or b[:-5] in SHARD_TYPE_MONOLITHS: continue
        fs.append(f)
    return fs


def _enc(new, old_lit):
    """JSON string literal for `new`, in the escape style of the literal it replaces."""
    asc = ('\\u' in old_lit) and not re.search(r'[^\x00-\x7f]', old_lit)
    return json.dumps(new, ensure_ascii=asc)


def tokens_in(s):
    out, pos = [], 0
    while True:
        t = find_token(s, pos)
        if not t: return out
        out.append(s[t[0]:t[1]]); pos = t[1]


ID_RE = re.compile(r'"(?:id|name)":\s*"((?:[^"\\]|\\.)*)"')


def nearest_id(text, off):
    last = None
    for m in ID_RE.finditer(text, max(0, off - 20000), off): last = m.group(1)
    return last or ''


def scrub_text(text, ledger=None):
    """(new text, [(old, new)]); `ledger` (a list) collects (nearest id, removed tokens) per changed field."""
    changes = []
    parts = []
    last = 0
    for m in LIT_RE.finditer(text):
        lit = m.group(0)
        if not TRIGGER_RE.search(lit): continue
        # a key, not a value
        k = m.end()
        while k < len(text) and text[k] in ' \t\r\n': k += 1
        if k < len(text) and text[k] == ':': continue
        try:
            v = json.loads(lit)
        except ValueError:
            continue
        nv = scrub(v)
        if nv != v:
            parts.append(text[last:m.start()]); parts.append(_enc(nv, lit)); last = m.end()
            changes.append((v, nv))
            if ledger is not None:
                ledger.append((nearest_id(text, m.start()), ' | '.join(t for t in tokens_in(v) if not SERVED_REL_RE.match(t))))
    if not changes: return text, changes
    parts.append(text[last:])
    return ''.join(parts), changes


def main(argv):
    dry = '--dry' in argv
    rep = '--report' in argv
    total = 0
    per = []
    led_path = os.environ.get('PATH_SCRUB_LEDGER') or os.path.join(_WORKSHOP, 'desk', 'path-scrub-ledger.tsv')
    led_rows = []
    for f in source_files(_ROOT):
        with open(f, encoding='utf-8', newline='') as fh: text = fh.read()
        led = []
        new, ch = scrub_text(text, led)
        if not ch: continue
        led_rows += [(os.path.relpath(f, _ROOT), a, b) for a, b in led]
        total += len(ch)
        per.append((os.path.relpath(f, _ROOT), len(ch)))
        if rep:
            for o, n in ch: print('FILE', os.path.relpath(f, _ROOT), '\n  BEFORE:', o, '\n  AFTER: ', n)
        if not dry:
            json.loads(new)   # never write a file that is not valid JSON
            tmp = f + '.scrubnew'
            with open(tmp, 'w', encoding='utf-8', newline='') as fh: fh.write(new)
            os.chmod(tmp, os.stat(f).st_mode & 0o7777)   # the file keeps its own mode
            os.replace(tmp, f)
    if led_rows and not dry:
        try:
            os.makedirs(os.path.dirname(led_path), exist_ok=True)
            with open(led_path, 'a', encoding='utf-8') as fh:
                stamp = __import__('time').strftime('%Y-%m-%d %H:%M:%S')
                for r in led_rows: fh.write(stamp + '\t' + '\t'.join(x.replace('\t', ' ').replace('\n', ' ') for x in r) + '\n')
        except OSError as e:
            print(f'scrub-workshop-paths: ledger not written ({e}); the scrub itself is done')
    if per and not rep:
        for p, n in per: print(f'scrub-workshop-paths: {p}: {n} field(s)')
    print(f'scrub-workshop-paths: {"would change" if dry else "changed"} {total} field(s) in {len(per)} file(s)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
