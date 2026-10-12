#!/usr/bin/env python3
"""ai-search-sync.py -- keep the AI Search instance `museum-search` in step with what the museum SERVES (D294 item 2).

Installed by hook c85-ai-search-sync as museum/scripts/ops/ai-search-sync.py; chain.sh launches it DETACHED right after
r2-sync (rc 0 or 5), so it never holds up the commit, the publish, the push or the window, and its result never changes the
chain's. Drafted by lane AI-SEARCH-PAGE, 2026-10-05.

It reuses the full ingest's machinery (WORKSHOP_ROOT/tools/coordinator-2026-09-03/ai-search-ingest.py, imported, never
copied): the same REST calls through wrangler's login, the same <main> text extraction, the same four takedown checks
(libraries imported, never printed), the same withdrawn and pending-takedown-wave exclusions, the same keys, and the same
append-only progress.tsv, so the index the ingest built is the state this script diffs against.

ONE RUN:
  0. Refuses (rc 0, nothing done) while the full ingest is still running (its pid file names a live ai-search-ingest.py),
     while another sync holds the lock, or while WORKSHOP_ROOT/net/ai-search/SYNC-OFF exists.
  1. Reads the bucket's served manifest (path -> sha256 of the served bytes). Fail closed: unreadable -> rc 1, nothing done.
  2. For every document row (museum/data/documents.json) whose page is served:
       - the local file's sha256 must equal the served sha256, so the text indexed is exactly the text served. A page the
         window has already changed again locally ("in flux") is left as indexed if the served bytes are the ones it was
         indexed from (sync-state.tsv), and DELETED from the index otherwise (we cannot read what is served, so it is pulled
         until the next chain), never uploaded;
       - then the ingest's exclusions: withdrawn, a READY-unapplied takedown wave touches it, a takedown residual, empty text.
  3. DELETES first, all of them, unbudgeted: every indexed key whose page is no longer served (the r2-sync prune list is a
     subset of this: a pruned page leaves the served manifest), is excluded in step 2, or is in flux with changed bytes,
     plus every key whose changed text may WITHHOLD something the indexed text showed (hook c272: a newly redacted name or
     detail, or no marks.tsv record to compare against). Every successful delete writes a 'deleted' progress row, so no
     later run re-deletes the same key, and a failed delete BLOCKS that key's upload, so a 409 can never record stale text.
  4. UPLOADS the new and changed texts (text md5 differs from progress.tsv), paced on the instance's backlog like the
     ingest, within --budget minutes; whatever is left is picked up by the next chain's run (the diff is recomputed). A
     changed text that provably withholds nothing (same withheld-marker count, no visible character lost: the c208 marker
     rename, restored paragraph gaps) is REPLACED here item by item -- delete the old item, 'deleted' row, upload the new
     one -- so the index never loses thousands of documents for hours while the uploads trickle in (hook c272).
State: progress.tsv (shared with the ingest), sync-state.tsv (page -> served sha256 confirmed; only changed rows are
appended), marks.tsv (key -> md5, withheld-marker count, visible chars: the privacy test of hook c272), sync-last.txt (one line per
run), SYNC-FAILED (written on rc 1, removed on rc 0), all under WORKSHOP_ROOT/net/ai-search/. Never under museum/.
Usage: ai-search-sync.py [--label L] [--dry-run] [--budget MINUTES]   (proof only: --dry-run --manifest-file F --limit N)   rc 0 done/skipped, 1 failed (the chain ignores it).
Never prints a token, account id, e-mail, or any takedown/privacy term.
"""
import collections, concurrent.futures as cfu, contextlib, datetime, fcntl, hashlib, importlib.util, io, json, os, re, sys, time

MUSEUM = os.environ.get('MUSEUM_ROOT') or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORKSHOP = os.environ.get('WORKSHOP_ROOT') or os.path.join(os.path.dirname(MUSEUM), 'archive')
INGEST = os.path.join(WORKSHOP, 'tools/coordinator-2026-09-03/ai-search-ingest.py')
NET = os.path.join(WORKSHOP, 'net/ai-search')
STATE = os.path.join(NET, 'sync-state.tsv')
LAST = os.path.join(NET, 'sync-last.txt')
FAILED = os.path.join(NET, 'SYNC-FAILED')
OFF = os.path.join(NET, 'SYNC-OFF')
LOCK = os.path.join(NET, 'sync.lock')
MARKS = os.path.join(NET, 'marks.tsv')            # hook c272: key -> md5 + the privacy test's two numbers

def now(): return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
def log(*a): print(now(), *a, flush=True)
def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default

def ingest_running():
    try: pid = int(open(os.path.join(NET, 'ingest.pid')).read().strip())
    except Exception: return False
    try: cmd = open(f'/proc/{pid}/cmdline', 'rb').read().replace(b'\0', b' ').decode('utf-8', 'replace')
    except Exception: return False
    return 'ai-search-ingest.py' in cmd

def load_ingest():
    if not os.path.isfile(INGEST): raise SystemExit(f'ingest module missing: {INGEST}')
    spec = importlib.util.spec_from_file_location('ais_ingest', INGEST); mod = importlib.util.module_from_spec(spec)
    with contextlib.redirect_stdout(io.StringIO()): spec.loader.exec_module(mod)
    if os.path.realpath(mod.M) != os.path.realpath(MUSEUM):
        raise SystemExit('the ingest module points at a different museum root; refusing')
    mod.NET = NET; mod.PROGRESS = os.path.join(NET, 'progress.tsv')  # one state dir, whoever runs
    return mod

def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest()

def read_state():
    st = {}
    if os.path.exists(STATE):
        for line in open(STATE):
            c = line.rstrip('\n').split('\t')
            if len(c) >= 2: st[c[0]] = c[1]
    return st
_slock = __import__('threading').Lock()
def write_state(rows):
    if not rows: return
    with _slock, open(STATE, 'a') as o:
        for page, sha in rows: o.write(f'{page}\t{sha}\t{now()}\n')

# hook c272 -- THE PRIVACY TEST. A page whose new text WITHHOLDS something the indexed text showed (a newly redacted name
# or detail) must leave the index before the new text goes up; it may never sit there with the old text until its turn in
# the upload loop. The test needs no copy of the old text: at upload time the sync records the text's withheld-marker count
# and the number of visible (non-space) characters outside those markers, in marks.tsv. A change withholds nothing only
# when the marker count is identical and no visible character was lost -- that is the c208 marker rename (the marker's own
# wording got shorter, nothing else) and restored paragraph gaps (whitespace only). An added marker, a shorter text, or no
# record to compare against is unsure, and unsure means delete first.
MARKER = re.compile(r'\[[^\[\]\n]{0,160}(?:withheld|redacted)[^\[\]\n]{0,160}\]', re.I)
def text_marks(body):
    t = body.decode('utf-8', 'replace') if isinstance(body, (bytes, bytearray)) else (body or '')
    return len(MARKER.findall(t)), len(re.sub(r'\s+', '', MARKER.sub('', t)))
def read_marks():
    m = {}
    if os.path.exists(MARKS):
        for line in open(MARKS):
            c = line.rstrip('\n').split('\t')
            if len(c) >= 4 and c[2].isdigit() and c[3].isdigit():
                m[c[0]] = {'md5': c[1], 'markers': int(c[2]), 'visible': int(c[3])}
    return m
_mlock = __import__('threading').Lock()
def write_marks(rows):
    if not rows: return
    with _mlock, open(MARKS, 'a') as o:
        for key, md5, n, vis in rows: o.write(f'{key}\t{md5}\t{n}\t{vis}\t{now()}\n')
def no_withholding(rec, indexed_md5, it):
    """True only when the new text provably withholds nothing the indexed text showed (anything else: delete first)."""
    if not rec or not indexed_md5 or rec['md5'] != indexed_md5: return False
    return it['mk'][0] == rec['markers'] and it['mk'][1] >= rec['visible']

def plan(ing, served, indexed, st):
    """-> (items to have indexed {key: item}, keys to pull now {key: reason}, keys to leave as they are)."""
    docs = json.load(open(os.path.join(MUSEUM, 'data/documents.json')))['documents']
    if arg('--limit'): docs = docs[:int(arg('--limit'))]            # proof runs only
    wd = ing.withdrawn_pages(); waves, tk = ing.pending_takedown_pages()
    want, pull, keep = {}, {}, set(); skip = collections.Counter(); confirmed = []
    for r in docs:
        p = r['page']; k = ing.key_for(p); sha = served.get(p.lstrip('/'))
        if sha is None: continue                                      # not served: pulled below if indexed
        if p in wd: pull[k] = 'withdrawn'; continue
        if p in tk: pull[k] = 'pending-takedown-wave'; continue
        f = MUSEUM + p
        if not os.path.isfile(f): pull[k] = 'no-local-file'; continue
        if sha256_file(f) != sha:                                     # the window changed it again after the publish
            if st.get(p) == sha: keep.add(k); skip['in-flux-unchanged'] += 1
            else: pull[k] = 'in-flux-changed'
            continue
        raw = open(f, encoding='utf-8', errors='replace').read()
        hit = ing.takedown_hit(raw, r.get('wing'))
        if hit: pull[k] = 'takedown-residual'; continue
        title, text = ing.extract(raw)
        if not text or len(text) < 20: pull[k] = 'empty-main'; continue
        body = f'# {title}\n\n{text}\n'.encode(); md5 = hashlib.md5(body).hexdigest()
        mk = text_marks(body)                                          # hook c272: the privacy test's two numbers, before
        if indexed.get(k, {}).get('md5') == md5: body = None           # unchanged: keep no text in memory (~1 GB in all)
        want[k] = {'key': k, 'page': p, 'wing': r.get('wing') or '', 'doc_class': r.get('doc_class') or '',
                   'title': title, 'body': body, 'md5': md5, 'sha': sha, 'mk': mk}
    log(f'plan: documents {len(docs)}; eligible {len(want)}; pull {dict(collections.Counter(pull.values()))}; '
        f'{dict(skip)}; pending takedown waves {len(waves)}')
    return want, pull, keep

def main():
    dry = '--dry-run' in sys.argv; budget = float(arg('--budget', '150')) * 60; label = arg('--label', '')
    os.makedirs(NET, exist_ok=True)
    if os.path.exists(OFF): log('SYNC-OFF present; nothing done'); return 0
    if ingest_running(): log('the full ingest is still running; nothing done (the next chain tries again)'); return 0
    lk = open(LOCK, 'a')
    try: fcntl.flock(lk, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError: log('another sync holds the lock; nothing done'); return 0
    t0 = time.time(); ing = load_ingest()
    if arg('--manifest-file') and dry:                                # proof runs only: a saved copy of the manifest
        m = json.load(open(arg('--manifest-file'))); gen, served = m.get('generatedAt'), m['files']
    else:
        gen, served = ing.served_manifest()                           # fail closed inside (SystemExit)
    log(f'start label {label} dry {dry}; served manifest {gen} ({len(served)} objects)')
    prog = ing.read_progress()
    indexed = {k: v for k, v in prog.items() if v.get('status') == 'uploaded'}
    st0 = read_state(); marks = read_marks()                          # hook c272: read once (sync-state.tsv is huge)
    want, pull, keep = plan(ing, served, indexed, st0)
    dels = {}                                                         # key -> (reason, item id)
    for k, v in indexed.items():
        if k in keep: continue
        if k in pull: dels[k] = (pull[k], v.get('id', ''))
        elif k not in want: dels[k] = ('not-served-or-gone', v.get('id', ''))
        elif want[k]['md5'] != v.get('md5'): dels[k] = ('text-changed', v.get('id', ''))
    ups = [it for k, it in want.items() if not (k in indexed and indexed[k].get('md5') == it['md5'])]
    swaps = {}                                                        # hook c272: key -> old item id, replaced in the loop
    for k in [k for k, v in dels.items() if v[0] == 'text-changed']:
        if no_withholding(marks.get(k), indexed[k].get('md5', ''), want[k]): swaps[k] = dels.pop(k)[1]
    log(f'diff: delete {len(dels)} {dict(collections.Counter(r for r, _ in dels.values()))}; replace {len(swaps)}; '
        f'upload {len(ups)} (new {sum(1 for i in ups if i["key"] not in indexed)})')
    if dry: return 0
    # confirmations first: pages whose indexed text is the served text (only the rows that changed, hook c272)
    write_state([(it['page'], it['sha']) for k, it in want.items()
                 if k in indexed and indexed[k].get('md5') == it['md5'] and st0.get(it['page']) != it['sha']])
    write_marks([(k, it['md5'], it['mk'][0], it['mk'][1]) for k, it in want.items()
                 if k in indexed and indexed[k].get('md5') == it['md5'] and marks.get(k, {}).get('md5') != it['md5']])
    # 3. deletions, all of them, before any upload
    bad = 0; blocked = set()
    def drop(k):
        reason, iid = dels[k]
        ok = ing.delete_item(iid) if iid else False
        if not ok:
            got = None
            with contextlib.suppress(Exception): got = ing.lookup(k)
            ok = got is None or ing.delete_item(got.get('id', ''))
        if ok:                                                        # hook c272: a progress row for EVERY delete, so no
            ing.write_progress(k, indexed[k].get('page', ''), indexed[k].get('md5', ''), 'deleted', '')  # run re-deletes it
        else: blocked.add(k)                                          # a failed delete never gets an upload over it
        return ok
    with cfu.ThreadPoolExecutor(3) as ex:
        for ok in ex.map(drop, list(dels)): bad += 0 if ok else 1
    log(f'deletions done: {len(dels) - bad} ok, {bad} failed; {len(swaps)} changed text(s) replaced item by item below')
    # 4. uploads, paced and budgeted
    done = collections.Counter()
    def send(it):
        k = it['key']
        if k in blocked:                                              # hook c272: its delete failed; never upload over it
            log('upload-skipped-after-failed-delete', k); return 'fail'
        if k in swaps:                                                # replace in place: the old item goes first
            old = swaps[k]
            ok = ing.delete_item(old) if old else False               # a 404 counts as gone
            if not ok:
                got = None
                with contextlib.suppress(Exception): got = ing.lookup(k)
                ok = got is None or ing.delete_item(got.get('id', ''))
            if not ok:
                log('replace-delete-fail', k); return 'fail'          # a 409 would record stale text as current
            ing.write_progress(k, indexed[k].get('page', ''), indexed[k].get('md5', ''), 'deleted', '')
        status, iid, note = ing.upload(it)
        ing.write_progress(it['key'], it['page'], it['md5'], status, iid)
        if status == 'uploaded':
            write_state([(it['page'], it['sha'])]); write_marks([(k, it['md5'], it['mk'][0], it['mk'][1])])
        else: log('upload-fail', it['key'], note)
        return status
    with cfu.ThreadPoolExecutor(ing.THREADS) as ex:
        for b in range(0, len(ups), 30):
            if time.time() - t0 > budget: log(f'budget reached; {len(ups) - b} upload(s) left for the next run'); break
            waited_out = False                                  # hook c236: the backlog wait respects the budget too
            while True:
                r = ing.stats()
                if not r or ing.backlog(r) <= ing.QMAX: break
                if time.time() - t0 > budget: waited_out = True; break
                time.sleep(60)
            if waited_out: log(f'budget reached waiting on the index backlog; {len(ups) - b} upload(s) left for the next run'); break
            for s in ex.map(send, ups[b:b + 30]): done[s] += 1
    log(f'uploads: {dict(done)} of {len(ups)}; {time.time() - t0:.0f}s')
    rc = 1 if (bad or done['fail']) else 0
    with open(LAST, 'a') as o:
        o.write(f'{now()}\tlabel={label}\trc={rc}\tdeleted={len(dels) - bad}\treplace={len(swaps)}\tdelete_failed={bad}\t'
                f'uploaded={done["uploaded"]}\tupload_failed={done["fail"]}\tleft={len(ups) - sum(done.values())}\n')
    return rc

if __name__ == '__main__':
    try: rc = main()
    except SystemExit as e:
        log(f'stopped: {e}'); rc = 1
    except Exception as e:
        log(f'FAILED: {type(e).__name__}: {str(e)[:200]}'); rc = 1
    try:
        os.makedirs(NET, exist_ok=True)
        if rc: open(FAILED, 'w').write(f'{now()} rc={rc} (see the chain\'s ai-search-sync log)\n')
        elif os.path.exists(FAILED): os.remove(FAILED)
    except Exception: pass
    sys.exit(rc)
