#!/usr/bin/env python3
"""STANDING FIXER (hook c208, 2026-10-09; the Janitor's D480: "(a) plain rename"). THE REDACTION MARKER'S OWN WORDS.
Each of the EIGHT wordings fixed at D48/D80 ended "per the privacy rule" and named the kind of thing withheld -- "a
real name", "a contact detail", "a bereavement", "an illness", "a marriage", "a family detail", "a private-life
detail", "a private exchange". On a document about one named person that is a disclosure in itself. They become TWO
wordings that name nothing: "[name withheld]" where a living person's real name came out, "[detail withheld]"
everywhere else. CURATION #redaction-marker-wordings is the law. The class that decided the cut stays in the
workshop's redaction ledger, where it always governed from, and is never written on a served page again.

WHY A STANDING FIXER AND NOT A ONE-OFF: the builders in this repo, the two red-gate redactors and every wave built
before today can all still produce an older wording until each is rebuilt, and the house rule is that a fix made once
persists (the Janitor, 2026-09-12). So this runs at every preflight, from ORDER.txt, immediately after
fix-redaction-marker-canon.py -- which folds any NON-canonical wording into these two, so between them nothing else
survives. A marker already renamed is invisible to this fixer, so it is idempotent, and an interrupted run is
finished by the next one: every counter and detector in the machinery accepts BOTH forms during the transition, so a
part-renamed tree is still a green tree.

SCOPE: every .html under the museum root except .claude/ (invariant 13), .git/, functions/, node_modules/ and
scripts/ itself; plus data/*.json and data/shards/*/*.json, because the marker is served out of registry rows too
(an awards recipient, an essay's text, a show note) and a page generated from an unrenamed row would bring the old
wording back at the next regen.

BYTES, NOT TEXT. The substitution is on bytes. Both live spellings of the dash are in the table below (the HTML
entity and the literal em dash; "&#8212;" is carried for completeness), the two new forms are pure ASCII, and no file
is decoded -- so a page whose bytes are not clean UTF-8 is renamed safely instead of skipped, and no JSON file is
ever re-serialised (a registry file keeps its own indent; this museum learned that one the hard way). A substitution
cannot introduce trailing whitespace either: both new forms end in "]".

--dry reports and writes nothing. --manifest <path> writes a TSV of every file changed with a count per old wording,
which is what makes this rename auditable and reversible: "[detail withheld]" alone cannot say which of the seven
classes it was, and the manifest can."""
import os, sys, glob

NAME_CLASSES = ("a real name",)
DETAIL_CLASSES = ("a contact detail", "a bereavement", "an illness", "a marriage", "a family detail",
                  "a private-life detail", "a private exchange")
DASHES = ("&mdash;", "—", "&#8212;")
NEW = {True: b"[name withheld]", False: b"[detail withheld]"}
FORMS = [((("[redacted %s %s, per the privacy rule]" % (d, c)).encode("utf-8")), NEW[c in NAME_CLASSES], c)
         for c in NAME_CLASSES + DETAIL_CLASSES for d in DASHES]
# ONE WORDING OUTSIDE THE EIGHT, renamed here because nothing else can reach it. The D480 inventory found it standing
# once, on hhwo/archive/retirement-hhwo-president.html: a real-name marker carrying a lane's own reasoning inside the
# marker. fix-redaction-marker-canon.py cannot fold it (it sits OUTSIDE its span) and fix-bare-redaction-markers.py
# cannot wrap it (its inner text is longer than that fixer's 160-character limit). It is the clearest case the ruling
# reaches: it names the class AND narrates the judgement. The reasoning belongs in the wave's holdings, never on the
# page. Listed as an exact string so nothing else can match it.
FORMS.append((b"[redacted &mdash; a real name (a persona billed elsewhere on this fed's own broadcasts; this occurrence"
              b" is an ordinary OOC social mention, not a wrestling billing), per the privacy rule]",
              NEW[True], "a real name (an unspanned one-off)"))
# TWO MORE WORDINGS OUTSIDE THE EIGHT, renamed in this same pass rather than left for the canon fixer's next preflight
# (lane D480-FINISH, 2026-10-09). "a login slug" stood three times (nwc-1998's promo-tour page of 1997-12-09, twice;
# rspwf's looking-for-a-league page of 1997-08-17, once) and the entity-escaped roster-and-handler credits variant once
# (mcw-mentally-challenged-1999's weekly update of 1999-02-20). fix-redaction-marker-canon.py carries the same two keys
# for a page that arrives later with one inside its span; this table is what renames them on the day.
for _d in DASHES:
    FORMS.append((("[redacted %s a login slug]" % _d).encode("utf-8"), NEW[False], "a login slug"))
    FORMS.append((("[redacted %s the promotion&#x27;s own roster-and-handler credits list]" % _d).encode("utf-8"),
                  NEW[True], "a roster-and-handler credits list"))
# A TRUNCATED QUOTATION of a marker, cut off by its own ellipsis, inside a provenance note in data/promotions.json
# (the bswf row): "[redacted <dash> a contact<ellipsis>". It serves on that wing's provenance surface, and under D480 no
# category word serves, so it becomes "[detail withheld]" with its ellipsis kept. Bytes only: the row's indent and
# every other byte of the file stand.
for _d in DASHES:
    FORMS.append((("[redacted %s a contact…" % _d).encode("utf-8"), NEW[False] + "…".encode("utf-8"),
                  "a contact detail (a truncated quotation)"))
SKIP_DIRS = {".claude", ".git", "node_modules", "functions", "scripts"}

root = os.environ.get("MUSEUM_ROOT") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gate_detect import live_running as _live_running
dry = "--dry" in sys.argv
man = None
if "--manifest" in sys.argv:
    _i = sys.argv.index("--manifest")
    man = sys.argv[_i + 1] if _i + 1 < len(sys.argv) else None
if not dry and _live_running("scripts/gate[.]sh|registry-validate|cross-reference[.]mjs|privacy-check", root):
    sys.exit("REFUSED: a gate or build is running")

targets = []
for dp, dn, fn in os.walk(root):
    dn[:] = [d for d in dn if d not in SKIP_DIRS and not d.startswith(".")]
    targets += [os.path.join(dp, f) for f in fn if f.endswith(".html")]
targets += glob.glob(f"{root}/data/*.json") + glob.glob(f"{root}/data/shards/*/*.json")

n_files = n_marks = 0
rows = []
for p in sorted(set(targets)):
    try:
        with open(p, "rb") as fh:
            raw = fh.read()
    except OSError:
        continue
    if b"[redacted" not in raw:
        continue
    new = raw
    counts = {}
    for old, repl, label in FORMS:
        c = new.count(old)
        if c:
            new = new.replace(old, repl)
            counts[label] = counts.get(label, 0) + c
    if new == raw:
        continue
    n_files += 1
    n_marks += sum(counts.values())
    rows.append((os.path.relpath(p, root), counts))
    if not dry:
        tmp = "%s.c208tmp%d" % (p, os.getpid())
        with open(tmp, "wb") as fh:
            fh.write(new)
        os.chmod(tmp, os.stat(p).st_mode & 0o7777)
        os.replace(tmp, p)
if man and not dry:
    with open(man, "w", encoding="utf-8") as fh:
        for rel, counts in rows:
            for label in sorted(counts):
                fh.write("%s\t%s\t%d\n" % (rel, label, counts[label]))
    print("fix-redaction-marker-rename: manifest written (%s)" % man)
print("fix-redaction-marker-rename: %s%d marker(s) renamed on %d file(s)" % ("(DRY) " if dry else "", n_marks, n_files))
