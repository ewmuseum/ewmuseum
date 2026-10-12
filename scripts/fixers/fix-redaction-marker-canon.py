#!/usr/bin/env python3
"""STANDING FIXER (D48, the Janitor 2026-09-26: "normalize, and enforce normalization moving forward"). Rewrites a
non-canonical redaction-marker wording, inside a class="redacted" span only, to a canonical form.
hook c208 (the Janitor's D480, 2026-10-09: "(a) plain rename"): THE CANONICAL FORMS ARE NOW TWO, "[name withheld]" and
"[detail withheld]", and no marker carries a category word. Every value in the mapping below moved with the ruling:
the variants that used to normalise to the real-name wording now normalise to the name form, and all the rest to the
detail form. The CLASS each variant was read as is still the thing that decides which, and is still in the mapping's
own left-hand column and in the privacy ledger -- it is simply never written on a page. The eight wordings this
replaced are renamed tree-wide by the standing fix-redaction-marker-rename.py, which runs from ORDER.txt immediately
after this fixer (CURATION #redaction-marker-wordings; D48 2026-09-26, D80 2026-09-26 added "a private exchange")
(CURATION #privacy-redaction / v73 / v74 / v88). It changes wording only: the same span stays redacted. The mapping is
inlined below from lane DESK-RULINGS-0926-B's survey, with coordinator corrections:
  - the three "affiliation" variants map to a private-life detail, not a real name;
  - the "personal e-mail exchange" variant is HELD.
Variants held for the Janitor's read (two categories in one marker, a section-level redaction, or too generic) are absent,
and are left exactly as written. Idempotent. Runs from ORDER.txt, after fix-redaction-marker-escape.py.

c67 SLOW-FIXERS-INCREMENTAL (2026-10-05, D308; CYCLE-TIME-AUDIT target 5: 40 s a preflight, 0 edits in 19 cycle logs).
A page's result is a pure function of its own bytes and of this file (MAPPING is inlined). The manifest records, for
every page a run left BYTE-UNCHANGED, the md5 of its bytes; the next run skips a page only when its bytes hash the same,
so a skip never skips a write and the summary line prints the same numbers. FULL RUN (and a fresh manifest) whenever:
--full, CANON_MODE=full or FIXERS_MODE=full; the manifest is missing, unreadable, of another shape, schema, museum root,
python or unicode version; or this file changed. --dry and --no-manifest never read or write it. The manifest lives
OUTSIDE the museum tree: $SCRATCH_ROOT/redaction-marker-canon-manifest.json (override CANON_MANIFEST); written last,
atomically."""

import glob, os, re, json, sys

root = os.environ.get("MUSEUM_ROOT") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import hashlib, io, unicodedata
_WORKSHOP = os.environ.get('WORKSHOP_ROOT') or os.path.join(os.path.dirname(root), 'archive')
_SCRATCH = os.environ.get('SCRATCH_ROOT') or os.path.join(_WORKSHOP, 'ops-scratch')
C67_SCHEMA = 1
C67_MANIFEST = os.environ.get('CANON_MANIFEST') or os.path.join(_SCRATCH, 'redaction-marker-canon-manifest.json')
# Sketch placement: the mapping JSON sits beside this script in the wave dir. Once installed as
# scripts/fixers/fix-redaction-marker-canon.py, the mapping should move to
# scripts/fixers/data/D48-MARKER-MAPPING.json (or be inlined) -- the coordinator's call.
MAPPING = {
# D80 (the Janitor 2026-09-26, "as recommended, with the eighth form 'a private exchange'"): the nine held variants, mapped.
"[redacted &mdash; a real name and contact detail, per the privacy rule]": "[name withheld]",
"[redacted &mdash; a real name and business address, per the privacy rule]": "[name withheld]",
"[redacted — handler details, per the privacy rule]": "[name withheld]",
"[redacted — the promotion's own roster-and-handler credits list]": "[name withheld]",
"[redacted &mdash; a personal identifier, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a private e-mail exchange (real names and contact details), per the privacy rule]": "[detail withheld]",
"[redacted — an out-of-character personal e-mail exchange, unrelated to the show, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a section of the posters' own out-of-character chat, per the privacy rule]": "[detail withheld]",
"[redacted — a section of the posters' own out-of-character chat, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a contact address, per the privacy rule]": "[detail withheld]",
"[redacted&mdash;a real name, per the privacy rule]": "[name withheld]",
"[redacted &mdash; real name]": "[name withheld]",
"[redacted &mdash; a contact address]": "[detail withheld]",
"[redacted — real name]": "[name withheld]",
"[redacted &mdash; a real name]": "[name withheld]",
"[redacted &mdash; contact detail]": "[detail withheld]",
"[redacted &mdash; a login slug, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a contact detail (an instant-messaging screen name), per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a real e-mail address, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a name]": "[name withheld]",
"[redacted &mdash; a real name, per the privacy rule (v105c)]": "[name withheld]",
"[redacted &mdash; a contact detail]": "[detail withheld]",
"[redacted &mdash; a contact handle, per the privacy rule]": "[detail withheld]",
"[redacted — a contact address]": "[detail withheld]",
"[redacted — a real name]": "[name withheld]",
"[redacted &mdash; a contact detail (an e-mail address)]": "[detail withheld]",
"[redacted &mdash; a staff credit, out of character]": "[name withheld]",
"[redacted &mdash; a contact detail (an instant-messaging screen name)]": "[detail withheld]",
"[redacted &mdash; an operator contact address]": "[detail withheld]",
"[redacted — a contact address, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a handler&#x27;s contact address]": "[detail withheld]",
"[redacted &mdash; out-of-character credit]": "[name withheld]",
"[redacted — contact detail]": "[detail withheld]",
"[redacted &mdash; the promotion&#x27;s own operator, self-disclosed]": "[name withheld]",
"[redacted &mdash; a contact detail (an instant-messaging number), per the privacy rule]": "[detail withheld]",
"[redacted &mdash; an out-of-character mention of the promotion&#x27;s president]": "[name withheld]",
"[redacted &mdash; a bare forename, per the privacy rule]": "[name withheld]",
"[redacted &mdash; a league president&#x27;s name, per the privacy rule]": "[name withheld]",
"[redacted &mdash; a committee member]": "[name withheld]",
"[redacted — a name, per the privacy rule]": "[name withheld]",
"[redacted &mdash; a third-party rules-writer, credited by name]": "[name withheld]",
"[redacted &mdash; a contact detail (a personal homepage address), per the privacy rule]": "[detail withheld]",
"[redacted &mdash; contact address]": "[detail withheld]",
"[redacted &mdash; a handler&#x27;s name, per the privacy rule]": "[name withheld]",
"[redacted &mdash; a segment-writer credit, out of character]": "[name withheld]",
"[redacted &mdash; an operator's name, per the privacy rule]": "[name withheld]",
"[redacted &mdash; a login slug embedding a real name]": "[detail withheld]",
"[redacted &mdash; an out-of-character writer credit]": "[name withheld]",
"[redacted &mdash; the promotion&#x27;s co-\x66ounder]": "[name withheld]",
"[redacted &mdash; a private third party, named in passing]": "[name withheld]",
"[redacted — a login slug, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a login handle, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; the president&#x27;s own contact address]": "[detail withheld]",
"[redacted &mdash; an out-of-character production credit]": "[name withheld]",
"[redacted &mdash; a login slug]": "[detail withheld]",
"[redacted — an operator's given name, per the privacy rule]": "[name withheld]",
"[redacted &mdash; a match writer]": "[name withheld]",
"[redacted &mdash; operator&#x27;s own real name]": "[name withheld]",
"[redacted &mdash; handler credit]": "[name withheld]",
"[redacted &mdash; a fellow operator, credited by name]": "[name withheld]",
"[redacted &mdash; a personal login slug, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a contact detail (an e-mail address), per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a contact number]": "[detail withheld]",
"[redacted &mdash; an operator's contact e-mail address, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a submitter's real name, per the privacy rule]": "[name withheld]",
"[redacted &mdash; a contact e-mail address, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a column byline, out of character]": "[name withheld]",
"[redacted &mdash; a bare forename, out of character]": "[name withheld]",
"[redacted &mdash; an operator instant-messenger screen name, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a personal account name]": "[detail withheld]",
"[redacted &mdash; the operator&#x27;s own byline]": "[name withheld]",
"[redacted &mdash; a real name used administratively, per the privacy rule]": "[name withheld]",
"[redacted &mdash; an out-of-character match-writer credit]": "[name withheld]",
"[redacted &mdash; an out-of-character mention of the promotion's president]": "[name withheld]",
"[redacted &mdash; an operator's given name, per the privacy rule]": "[name withheld]",
"[redacted &mdash; an operator's own name in an awards-list credit, per the privacy rule]": "[name withheld]",
"[redacted &mdash; the fed's own recruitment contact address]": "[detail withheld]",
"[redacted &mdash; the promotion&#x27;s president]": "[name withheld]",
"[redacted &mdash; a wrestler contact-address directory, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a personal domain address, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a name, out of character]": "[name withheld]",
"[redacted &mdash; an application contact address]": "[detail withheld]",
"[redacted &mdash; the promotion&#x27;s own out-of-character staff credit]": "[name withheld]",
"[redacted &mdash; a staff member&#x27;s name, per the privacy rule]": "[name withheld]",
"[redacted &mdash; a personal detail, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a sig-block byline, per the privacy rule]": "[name withheld]",
"[redacted &mdash; an operator's own name in a news bulletin's own closing credit, per the privacy rule]": "[name withheld]",
"[redacted &mdash; the promotion&#x27;s vice-president]": "[name withheld]",
"[redacted — a login-slug, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a contact handle]": "[detail withheld]",
"[redacted &mdash; a real name, out of character]": "[name withheld]",
"[redacted — operator's own surname]": "[name withheld]",
"[redacted &mdash; an e-mail address]": "[detail withheld]",
"[redacted &mdash; a personal login slug]": "[detail withheld]",
"[redacted &mdash; a bare surname, per the privacy rule]": "[name withheld]",
"[redacted &mdash; handle]": "[detail withheld]",
"[redacted &mdash; a guest match-writer's own name, per the privacy rule]": "[name withheld]",
"[redacted — a contact handle]": "[detail withheld]",
"[redacted &mdash; an operator instant-messenger screen name]": "[detail withheld]",
"[redacted &mdash; a login-slug]": "[detail withheld]",
"[redacted &mdash; the fed’s own \x66ounder, self-disclosed out of character]": "[name withheld]",
"[redacted &mdash; the tournament’s own submissions address]": "[detail withheld]",
"[redacted &mdash; a personal-account slug, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a name, per the privacy rule]": "[name withheld]",
"[redacted &mdash; a forename-plus-initial writing credit, per the privacy rule]": "[name withheld]",
"[redacted &mdash; an out-of-character sign-off]": "[name withheld]",
"[redacted &mdash; a real contact e-mail address]": "[detail withheld]",
"[redacted — a real-name identification, per the privacy rule]": "[name withheld]",
"[redacted &mdash; the operator's own personal contact address]": "[detail withheld]",
"[redacted &mdash; a private detail]": "[detail withheld]",
"[redacted &mdash; a personal account page on the promotion&#x27;s own host]": "[detail withheld]",
"[redacted — handler credit]": "[name withheld]",
"[redacted &mdash; a truncated contact address]": "[detail withheld]",
"[redacted — a real e-mail address, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a recruitment contact address]": "[detail withheld]",
"[redacted &mdash; credited real name]": "[name withheld]",
"[redacted &mdash; a messaging handle, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a forename-plus-initial writing credit for one segment]": "[name withheld]",
"[redacted &mdash; a former operator's name, per the privacy rule]": "[name withheld]",
"[redacted — an operator's name, per the privacy rule]": "[name withheld]",
"[redacted — an institutional affiliation, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a private individual&#x27;s real name, per the privacy rule]": "[name withheld]",
"[redacted &mdash; the promotion&#x27;s commissioner]": "[name withheld]",
"[redacted &mdash; the promotion&#x27;s angle manager]": "[name withheld]",
"[redacted &mdash; an operator's personal domain]": "[detail withheld]",
"[redacted &mdash; contact addresses, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a URL fragment that may encode a real name, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a personal contact identifier, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; one of the fed’s two \x66ounders, self-disclosed out of character]": "[name withheld]",
"[redacted &mdash; the fed’s other \x66ounder, self-disclosed out of character]": "[name withheld]",
"[redacted &mdash; a real handle, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a real name, in-character mention of a private individual]": "[name withheld]",
"[redacted — the promotion&#x27;s own segment-writer credits list]": "[name withheld]",
"[redacted — the promotion's own writer-credits list]": "[name withheld]",
"[redacted &mdash; the operator's real name, self-disclosed out of character]": "[name withheld]",
"[redacted &mdash; an institutional affiliation, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a submitter’s own contact address]": "[detail withheld]",
"[redacted &mdash; login credential]": "[detail withheld]",
"[redacted &mdash; an out-of-character real name; see provenance]": "[name withheld]",
"[redacted &mdash; a fed contact address]": "[detail withheld]",
"[redacted &mdash; a production contributor]": "[name withheld]",
"[redacted &mdash; a community member]": "[name withheld]",
"[redacted — a rights-holder credit, per the privacy rule]": "[name withheld]",
"[redacted &mdash; the promotion&#x27;s fed head]": "[name withheld]",
"[redacted &mdash; the poster]": "[name withheld]",
"[redacted &mdash; the promotion&#x27;s operator]": "[name withheld]",
"[redacted &mdash; an identifying affiliation, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; a handle, per the privacy rule]": "[detail withheld]",
"[redacted — a truncated contact address]": "[detail withheld]",
"[redacted &mdash; self-disclosed out of character, a poster&#x27;s real name]": "[name withheld]",
"[redacted &mdash; a real name, an out-of-character writing credit]": "[name withheld]",
"[redacted &mdash; a real-name reference to an unrelated federation's own head]": "[name withheld]",
"[redacted &mdash; an out-of-character handler credit]": "[name withheld]",
"[redacted — contact e-mail]": "[detail withheld]",
"[redacted &mdash; a wrestler&#x27;s own out-of-character name]": "[name withheld]",
"[redacted &mdash; the league&#x27;s own out-of-character presidential credit]": "[name withheld]",
"[redacted &mdash; a fellow e-wrestling operator credited by name for a borrowed FAQ template]": "[name withheld]",
"[redacted &mdash; a real name (an OOC art-macro credit), per the privacy rule]": "[name withheld]",
"[redacted &mdash; an operator's own gaming-service handle, per the privacy rule]": "[detail withheld]",
"[redacted &mdash; the reviewer&#x27;s own byline]": "[name withheld]",
"[redacted &mdash; contact details]": "[detail withheld]",
"[redacted — third-party name]": "[name withheld]",
# 2026-09-26 (COORD-OOC-BYLINES-2): wordings the bare-marker fixer newly brings inside a span
"[redacted — an out-of-character name, per the privacy rule]": "[name withheld]",
"[redacted — a bare forename, per the privacy rule]": "[name withheld]",
"[redacted — a contact handle, per the privacy rule]": "[detail withheld]",
"[redacted — a personal account slug, per the privacy rule]": "[detail withheld]",
"[redacted — an out-of-character sign-off and handler credit for an unrelated federation, per the privacy rule]": "[name withheld]",
"[redacted &mdash; a real name and contact details, per the privacy rule]": "[name withheld]",
# hook c208 (D480): two wordings the 2026-09-26 survey recorded in a spelling the mapping never carried, found still
# standing on four served pages by the D480 inventory -- a literal-dash variant with no trailing clause, and the
# entity-escaped apostrophe of the roster-credits variant above.
"[redacted \u2014 a login slug]": "[detail withheld]",
"[redacted \u2014 the promotion&#x27;s own roster-and-handler credits list]": "[name withheld]"
}
MARK_RE = re.compile(r'class="redacted">(\[redacted[^]]*\])')

dry = "--dry" in sys.argv
n_files = n_spans = 0

# ---- c67: the manifest (pages this fixer left byte-unchanged, by md5) ------------------------------------------------
def _c67_md5_path(q):
    try:
        with open(q, 'rb') as fh:
            return hashlib.md5(fh.read()).hexdigest()
    except OSError:
        return None
use_manifest = not (dry or '--no-manifest' in sys.argv)
head = {'schema': C67_SCHEMA, 'root': os.path.realpath(root), 'fixer': _c67_md5_path(os.path.abspath(__file__)),
        'python': '%d.%d' % sys.version_info[:2], 'unicode': unicodedata.unidata_version}
prev_pages, why = {}, None
if use_manifest:
    if '--full' in sys.argv or os.environ.get('CANON_MODE') == 'full' or os.environ.get('FIXERS_MODE') == 'full':
        why = 'full requested'
    else:
        try:
            prev = json.load(open(C67_MANIFEST, encoding='utf-8'))
            if not isinstance(prev, dict) or not isinstance(prev.get('pages'), dict):
                why = 'manifest of another shape'
            else:
                why = next((f'manifest {k} differs' for k, v in head.items() if prev.get(k) != v), None)
                if why is None:
                    prev_pages = prev['pages']
        except (OSError, ValueError):
            why = 'no readable manifest'
    print(f'fix-redaction-marker-canon: mode {"incremental" if why is None else "full (" + why + ")"}')
new_pages = {}
reused = n_seen = 0

for p in glob.glob(f"{root}/promotions/*/archive/*.html") + glob.glob(f"{root}/promotions/*/rp/*.html"):
    n_seen += 1
    raw = open(p, 'rb').read()
    if use_manifest:
        rel = os.path.relpath(p, root); ph = hashlib.md5(raw).hexdigest()
        if prev_pages.get(rel) == ph:   # left byte-unchanged by a run of this same file: the same bytes give the same no-op
            new_pages[rel] = ph; reused += 1
            continue
    t = io.TextIOWrapper(io.BytesIO(raw), encoding='utf-8').read()   # = open(p, encoding="utf-8").read()
    changed = False
    for bracket, canon in MAPPING.items():
        old_full = f'class="redacted">{bracket}'
        new_full = f'class="redacted">{canon}'
        c = t.count(old_full)
        if c:
            t = t.replace(old_full, new_full)
            n_spans += c
            changed = True
    if changed:
        n_files += 1
        if not dry:
            open(p, "w", encoding="utf-8").write(t)
    elif use_manifest:
        new_pages[rel] = ph   # recorded ONLY for a page left byte-unchanged

if use_manifest:
    try:
        os.makedirs(os.path.dirname(C67_MANIFEST), exist_ok=True)
        tmp = f'{C67_MANIFEST}.tmp{os.getpid()}'
        with open(tmp, 'w', encoding='utf-8') as fh:
            json.dump(dict(head, pages=new_pages), fh)
        os.replace(tmp, C67_MANIFEST)
        print(f'fix-redaction-marker-canon: {reused} of {n_seen} pages reused from the manifest; {len(new_pages)} recorded ({C67_MANIFEST})')
    except OSError as e:
        print(f'fix-redaction-marker-canon: manifest not written ({e.__class__.__name__})')

print(f"fix-redaction-marker-canon: {'(DRY) ' if dry else ''}{n_spans} marker(s) normalised on {n_files} page(s)")
