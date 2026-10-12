#!/usr/bin/env python3
"""merge_evidence: carry a folded pair's identity evidence into the survivor's wing (hook c141, lane MERGE-EVIDENCE, 2026-10-08).

WHY. merge-character.py drops the pair's own presumed-same identity rows when it folds two records (and
fix-identity-unknown-ids.py drops a row that names a retired id after the fold). The two-sided reading those rows carried
("the same name and the same earlier fed, told from each side") then lived nowhere on the survivor: after
wave-IDENTITY-LEADS-1008B, mike-extreme ended with no identity list at all.

WHERE. A character row has no provenance_notes (docs/SCHEMA.md: the field belongs to the promotion row). The evidence goes
where the museum already keeps graded claims about a wing's characters: the SURVIVOR'S WING row in data/promotions.json,
provenance_notes[], as a typed record (validate-provenance-notes.mjs):
    {kind: "identity-guard", date: null, span: null, subject: <survivor>, related: [],
     sources: [] when grade is "presumed", else [{"kind": "unknown"}] (the validator wants a non-empty list above presumed),
     grade: <the row's own grade>, recorded: YYYY-MM-DD, summary: <= 160 characters}
`related` stays empty ON PURPOSE: merge-character.py and repoint-retired.py repoint every exact JSON string that names a
retired id museum-wide (promotions.json included), which would turn related: [<retired>] into the survivor itself. The folded
record is named in the summary's opening words BY ITS NAME AND ITS FED'S NAME, never by its id (hook c257, 2026-10-10: an id is
workshop text in served prose, and two ids carrying a process word would have redded preflight 382; c256 fixed those two by hand):
"Same unit as the Battling Ring Angels team of the same name (1999)", "Same unit as Twisted Chaos of EWWF (Surrender, 2002)".
See label_for(). The summary is a short preview (the 160 cap is the validator's); the FULL note is written to the workshop
narrative the converter already keeps for every typed record (<workshop>/desk/provenance-narrative/<wing>.md, never served), in
the converter's own claim/evidence/note shape (the narrative's claim line keeps the ids: it is never served).

IDEMPOTENT. A record is the same record when its kind, subject and the summary's opening words match (head_of): the name head
this writer builds now, OR the id head it built before c257 ("Same character as <ids>" / "Same unit as <ids>"), so a pair
filed under either text is never filed again. When the folded record is no longer in any shard (fix-identity-unknown-ids.py
runs after the fold), its name cannot be read: then any record of the same kind on the subject that opens "Same <noun> as "
counts as present (the merge itself filed it). The narrative entry is keyed on its claim line. promotions.json is written only
in its OWN indent (read from the file, and only when the file round-trips byte-for-byte at that indent; it is 1 today, c141
assumed 2 and so refused every filing) by an atomic rename, and only when a record is actually added.

SERVED-TEXT AND PRIVACY SAFE. The summary is built from the note's opening words; it is checked against scripts/text-markers.json's
process-text and process-marker regexes (the mirror text-markers.mjs emits), and against the workshop's redaction ledger: an opening
that holds a deny term which promotions.json does not already carry (word-bounded, case-insensitive: the privacy gate scans that
file) is not used. In either case, or if the mirror or the ledger cannot be read, the summary is the plain sentence naming the
folded record and the full note stays in the workshop narrative. The name head itself passes the same two checks, or falls back
to a plainer form that drops the tripping part ("a <fed> team under another name", "the team of the same name in another
federation", last "a second record now folded into this one").

CLI (backfill support):  merge_evidence.py --narratives FILE.jsonl   appends each {wing, subject, related (the retired ids),
    grade, recorded, assertion, note} line's full note to its wing's workshop narrative (idempotent; never fatal).
"""
import json
import os
import re
import sys

CAP = 160
ELL = "…"
RANK = {"primary-source": 3, "user-attested": 2, "presumed": 1}
FOLDS = ("merged", "presumed-same")


def _root(root=None):
    return root or os.environ.get("MUSEUM_ROOT") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _workshop(root, workshop=None):
    return workshop or os.environ.get("WORKSHOP_ROOT") or os.path.join(os.path.dirname(root), "archive")


_RE_CACHE = {}


def _markers(root):
    if root in _RE_CACHE:
        return _RE_CACHE[root]
    res = None
    try:
        m = json.load(open(os.path.join(root, "scripts", "text-markers.json"), encoding="utf-8"))
        res = (re.compile(m["process_marker_source"]), re.compile(m["name_process_text_source"], re.I))
    except Exception:
        res = None
    _RE_CACHE[root] = res
    return res


def _trips(text, root):
    """True when the text would fail validate-provenance-notes' summary rules (or the rules cannot be read)."""
    m = _markers(root)
    if m is None:
        return True
    return bool(m[0].search(text) or m[1].search(text))


_DENY = {}


def _deny_terms(workshop):
    """The redaction ledger's deny terms (>= 4 characters, as land-check.py reads them), or None if the ledger cannot be read."""
    if workshop in _DENY:
        return _DENY[workshop]
    terms = None
    try:
        terms = set()
        paths = [os.path.join(workshop, "privacy", "redaction-ledger.tsv")]
        d = os.path.join(workshop, "privacy", "ledger-pending")
        if os.path.isdir(d):
            paths += [os.path.join(d, f) for f in sorted(os.listdir(d)) if f.endswith(".tsv")]
        for p in paths:
            for l in open(p, encoding="utf-8", errors="replace"):
                if l.startswith("#") or not l.strip():
                    continue
                c = l.rstrip("\n").split("\t")
                if len(c) >= 3 and c[2].strip() == "deny" and len(c[0].strip()) >= 4:
                    terms.add(c[0].strip().lower())
    except OSError:
        terms = None
    _DENY[workshop] = terms
    return terms


def _new_deny_hit(text, root, workshop):
    """True when text holds a deny term the live promotions.json does not already carry, or the ledger cannot be read."""
    terms = _deny_terms(workshop)
    if terms is None:
        return True
    low = text.lower()
    hit = [t for t in terms if t in low and re.search(r"(?<![A-Za-z0-9])" + re.escape(t) + r"(?![A-Za-z0-9])", low)]
    if not hit:
        return False
    try:
        ptxt = open(os.path.join(root, "data", "promotions.json"), encoding="utf-8").read().lower()
    except OSError:
        return True
    return any(not re.search(r"(?<![a-z0-9])" + re.escape(t) + r"(?![a-z0-9])", ptxt) for t in hit)


def fold_rows(a_identity, b_identity, a_id, b_id):
    """The identity entries the fold of b into a drops: a's entries naming b, b's entries naming a, folds only."""
    out = []
    for rows, other in ((a_identity or [], b_id), (b_identity or [], a_id)):
        for i in rows:
            if isinstance(i, dict) and i.get("assertion") in FOLDS and other in (i.get("with") or []):
                out.append(i)
    return out


def best_row(rows):
    """The strongest grade first, then the fuller note."""
    return max(rows, key=lambda i: (RANK.get(i.get("grade"), 0), len(str(i.get("note") or i.get("notes") or ""))))


def _note(row):
    return re.sub(r"\s+", " ", str(row.get("note") or row.get("notes") or "")).strip()


# hook c166 (2026-10-09, lane APPLIER-DEBT-2): A LEAD NEVER ARGUES AGAINST THE MERGE IT DESCRIBES.
# _lead returned the note's first sentence whatever it said, so a note that OPENS on a verdict against the merge was quoted as
# the summary of that merge (assaf-levavy: "The two-axis test does not clear the merge bar."; six of
# wave-MERGE-EVIDENCE-BACKFILL-2's 157 landed records quote one). Such a sentence is not quoted now, and neither is a note
# opening in block capitals (a lane's own headline; the museum's voice does not shout). build_record's own plain summary,
# "Same character as <ids>.", carries those records, and the full note reaches the workshop narrative as before.
# HARD: the museum is not making these one record. It fires wherever it appears in the sentence.
_ANTI_HARD = (
    r"\bnot\s+merged?\b", r"\bno\s+merge\b", r"\bnot\s+a\s+merge\b", r"\bdo(?:es)?\s+not\s+merge\b",
    r"\bwithout\s+merging\b", r"\brather\s+than\s+merg\w+\b", r"\binstead\s+of\s+merg\w+\b",
    r"\bnot\s+clear(?:ed)?\s+the\s+merge\s+bar\b", r"\bmerge\s+bar\s+is\s+not\s+cleared\b", r"\bfails?\s+the\s+merge\s+bar\b",
    r"\breject\w*\b", r"\bdeclin\w*\b", r"\bleft\s+open\b",
    r"\b(?:stay|stays|stayed|remain|remains|remained)\s+open\b", r"\bunresolved\b", r"\bpending\s+a\s+verdict\b",
    r"\b(?:stay|stays|stayed|stand|stands|standing|left|kept|keep|remain|remains|remained)\s+(?:apart|separately)\b",
)
# TWO: the two are two different people. It does NOT fire behind a negator -- "Not distinct: the IGC bio card bills him ..."
# and "the pair is not called distinct" are readings FOR the merge, and plain `distinct` is not a pattern because a note
# naming "this record's distinct filing" is talking about a past filing, not delivering a verdict.
_ANTI_TWO = (
    r"\b(?:are|is|were|was|stay|stays|stayed|remain|remains|remained|kept|keep|called|recorded|read|filed|treated|held)\s+(?:as\s+)?distinct\b",
    r"\bdistinct\s+(?:from|characters?|wrestlers?|persons?|people|handlers?|men|women|entit\w*|identit\w*)\b",
    r"\btwo\s+distinct\b", r"\bnot\s+the\s+same\b",
    r"\bdifferent\s+(?:person|man|woman|character|wrestler|handler|people|hands?)\b",
    r"\bnot\s+(?:one|the\s+same)\s+(?:character|wrestler|person|handler|man|woman)\b",
    r"\b(?:kept|keep|stay|stays|stayed|remain|remains|remained|held|are|is|were|was)\s+(?:as\s+)?separate\b",
    r"\bseparate\s+(?:record|records|character|characters|person|people|identit\w*|entit\w*|wrestler|wrestlers|handler|handlers)\b",
    r"\b(?:are|is|were|was|remains?|stays?)\s+unrelated\b",
    r"\b(?:merely|only|just|no\s+more\s+than|nothing\s+more\s+than)\s+(?:a\s+)?(?:bare[-\s]name\s+)?coincidence\b",
    r"\bis\s+a\s+bare[-\s]name\s+coincidence\b",
)
_HARD_RE = re.compile("|".join(_ANTI_HARD), re.I)
_TWO_RE = re.compile("|".join(_ANTI_TWO), re.I)
_NEG = re.compile(r"(?:\bnot\b|n['’]t\b|\bnever\b|\bno\s+longer\b|\bhardly\b|\bfar\s+from\b)[^.;:]{0,20}$", re.I)
_BOUND = re.compile(r"[.!?][\"'’”)]?\s+(?=[A-Z])")


def anti_merge(text):
    """The anti-merge verdict this text carries, or ''. A negated 'two different people' reading is not a verdict."""
    t = text or ""
    m = _HARD_RE.search(t)
    if m:
        return m.group(0)
    for m in _TWO_RE.finditer(t):
        if not _NEG.search(t[: m.start()]):
            return m.group(0)
    return ""


def _shouts(text):
    """True for a block-capital headline sentence: a real reading, but not the museum's voice."""
    L = [c for c in text if c.isalpha()]
    return len(L) > 12 and sum(c.isupper() for c in L) / len(L) > 0.6


_KIND = {"unit": "team", "character": "character"}
_GENERIC = "a second record now folded into this one"


def _norm_name(s):
    s = re.sub(r"^\s*the\s+", "", str(s or ""), flags=re.I).casefold()
    return re.sub(r"[^0-9a-z]+", "", s)


def _fed_parts(root, wing):
    """(the fed's served name, its founding year or '') for a wing id, or (None, '') if it has no promotions row."""
    try:
        d = json.load(open(os.path.join(root, "data", "promotions.json"), encoding="utf-8"))
    except (OSError, ValueError):
        return None, ""
    rows = d["promotions"] if isinstance(d, dict) else d
    r = next((x for x in rows if isinstance(x, dict) and x.get("id") == wing), None)
    if not r or not isinstance(r.get("name"), str) or not r["name"].strip():
        return None, ""
    f = r.get("founded") if isinstance(r.get("founded"), dict) else {}
    y = str(f.get("date") or "")[:4]
    if not re.fullmatch(r"1[89]\d\d|20\d\d", y):
        m = re.match(r"\s*((?:19|20)\d\d)", str(r.get("years") or ""))
        y = m.group(1) if m else ""
    return r["name"].strip(), y


def _clean(text, root, workshop):
    return not _trips(text, root) and not _new_deny_hit(text, root, _workshop(root, workshop))


def label_for(root, survivor_rec, retired_rec, retired_wing, noun="character", workshop=None):
    """hook c257: how a summary names the folded record -- its NAME and its FED'S NAME, never its id.
    Same name as the survivor (case, a leading 'the' and punctuation aside): "the <fed> team of the same name (<year>)";
    otherwise "<name> of <fed> (<year>)". The year is the fed's founding year, left out when the fed's own name already carries
    a parenthetical. A part that trips the served-text markers or brings in a new deny term is dropped, plainest last."""
    root = _root(root)
    kind = _KIND.get(noun, "record")
    rname = str((retired_rec or {}).get("name") or "").strip()
    same = bool(rname) and _norm_name(rname) == _norm_name((survivor_rec or {}).get("name"))
    fed, yr = _fed_parts(root, retired_wing) if retired_wing else (None, "")
    yr_s = " (%s)" % yr if yr and fed and "(" not in fed else ""
    cands = []
    if fed:
        cands.append("the %s %s of the same name%s" % (fed, kind, yr_s) if same else "%s of %s%s" % (rname, fed, yr_s))
        if not same and rname:
            cands.append("a %s %s under another name%s" % (fed, kind, yr_s))
    if rname:
        cands.append("the %s of the same name in another federation" % kind if same else "a %s under another name in another federation" % kind)
    for c in cands:
        if c and len("Same %s as %s." % (noun, c)) <= CAP and _clean("Same %s as %s" % (noun, c), root, workshop):
            return c
    return _GENERIC


_SHARD_IX = {}


def find_record(root, rid):
    """(record, wing, noun) for a live character or unit id, else (None, None, None). One shard scan per process."""
    root = _root(root)
    if root not in _SHARD_IX:
        ix = {}
        for noun, fn in (("character", "characters.json"), ("unit", "units.json")):
            sd = os.path.join(root, "data", "shards")
            for w in sorted(os.listdir(sd)) if os.path.isdir(sd) else []:
                p = os.path.join(sd, w, fn)
                if not os.path.isfile(p):
                    continue
                try:
                    d = json.load(open(p, encoding="utf-8"))
                except (OSError, ValueError):
                    continue
                for r in d if isinstance(d, list) else []:
                    if isinstance(r, dict) and r.get("id"):
                        ix.setdefault(r["id"], (r, w, noun))
        _SHARD_IX[root] = ix
    return _SHARD_IX[root].get(rid, (None, None, None))


class _Rec(dict):
    """A provenance record (serialises as a plain dict) that also carries the pre-c257 id heads it is the same record as."""
    alts = ()
    loose = None


def _legacy_heads(retired):
    """The heads c141/c166 wrote for these ids (both nouns): a pair filed under the old text is the same record."""
    h = _head_ids(retired)
    return {h, h.replace("Same character as ", "Same unit as ", 1)}


def _head(retired, noun="character", labels=None):
    """hook c257: "Same <noun> as <labels>" (label_for), never the ids; inside CAP like the old id head. Without labels (a caller
    that has none) the folded records are named generically, never by id."""
    lab = [x for x in (labels or []) if x] or [_GENERIC]
    full = "Same %s as %s" % (noun, ", ".join(lab))
    if len(full) + 1 <= CAP:
        return full
    taken = []
    for k in range(len(lab)):
        trial = "Same %s as %s and %d more" % (noun, ", ".join(lab[: k + 1]), len(lab) - k - 1)
        if len(trial) + 1 > CAP:
            break
        taken = lab[: k + 1]
    if not taken:
        return "Same %s as %s" % (noun, _GENERIC)
    return "Same %s as %s and %d more" % (noun, ", ".join(taken), len(lab) - len(taken))


def _head_ids(retired):
    """PRE-c257 (kept only to recognise records filed under it): "Same character as <ids>", short enough that _fit cannot return a summary past CAP.

    _fit only ever shortens the LEAD: with a head longer than the cap it returns head + "." at whatever length, and
    validate-provenance-notes.mjs rule 9 reds the gate on it. The ids that do not fit are named "and N more"; all of them stay
    in the workshop narrative (and in a backfill wave's holdings), and the trimmed head is deterministic, so it remains the
    idempotence key head_of() reads."""
    full = "Same character as " + ", ".join(retired)
    if len(full) + 1 <= CAP:
        return full
    taken = []
    for k in range(len(retired)):
        trial = "Same character as " + ", ".join(retired[: k + 1]) + " and %d more" % (len(retired) - k - 1)
        if len(trial) + 1 > CAP:
            break
        taken = retired[: k + 1]
    if not taken:
        taken = retired[:1]
    return "Same character as " + ", ".join(taken) + " and %d more" % (len(retired) - len(taken))


def _lead(note):
    """The note's opening sentence, unless that sentence argues against the merge or shouts (then no sentence is quoted)."""
    out, start = [], 0
    for m in _BOUND.finditer(note):
        out.append(note[start: m.start() + 1].strip())
        start = m.end()
    if note[start:].strip():
        out.append(note[start:].strip())
    if not out or anti_merge(out[0]) or _shouts(out[0]):
        return ""
    return out[0]


def _fit(head, lead):
    full = head + (": " + lead if lead else ".")
    if len(full) <= CAP:
        return full
    room = CAP - len(head) - 2 - 1   # ": " and the ellipsis
    if room < 24:
        return head + "."
    cut = lead[:room]
    if " " in cut and len(lead) > room:
        cut = cut[: cut.rfind(" ")]
    return head + ": " + cut.rstrip(" ,;:—-") + ELL


def build_record(survivor, retired, row, recorded, root=None, workshop=None, noun="character", labels=None):
    """The typed provenance record for one folded pair. `retired` is the list of ids that folded into `survivor`.
    hook c257: `labels` (label_for, one per retired id) name them in the summary; the ids never appear in it. A caller with no
    labels gets the generic head (and a loose idempotence match, see _same)."""
    root = _root(root)
    grade = row.get("grade") if row.get("grade") in RANK else "presumed"
    retired = [r for r in retired if r != survivor]
    head = _head(retired, noun, labels)   # hook c166: inside CAP even when the cluster is six records wide
    summary = _fit(head, _lead(_note(row)))
    if _trips(summary, root) or _new_deny_hit(summary, root, _workshop(root, workshop)):
        summary = _fit(head, "")
    rec = _Rec({
        "kind": "identity-guard", "date": None, "span": None, "subject": survivor, "related": [],
        "sources": [] if grade == "presumed" else [{"kind": "unknown"}],
        "grade": grade, "recorded": recorded, "summary": summary,
    })
    rec.alts = tuple(sorted(_legacy_heads(retired)))
    rec.loose = None if [x for x in (labels or []) if x] else "Same %s as " % noun
    return rec


def head_of(summary):
    """The summary's opening words, the idempotence key: "Same character as <names>" (before the first ': ', else minus the final '.')."""
    s = str(summary or "")
    return s.split(": ", 1)[0] if ": " in s else s.rstrip(".")


def _same(n, rec):
    """hook c257: the same record under this writer's name head, under the pre-c257 id head (rec.alts), or -- for a record built
    without labels (the folded record is gone, so its name cannot be read) -- any record on the subject opening "Same <noun> as "."""
    if not (isinstance(n, dict) and n.get("kind") == rec["kind"] and n.get("subject") == rec["subject"]):
        return False
    h = head_of(n.get("summary"))
    if h == head_of(rec["summary"]) or h in getattr(rec, "alts", ()):
        return True
    loose = getattr(rec, "loose", None)
    return bool(loose) and str(n.get("summary") or "").startswith(loose)


def _indent_of(raw, d):
    """hook c257: the file's OWN indent, and only when json.dumps at that indent reproduces the file byte for byte (so a filing
    never reflows it); else None. c141 hard-wired 2, and promotions.json is 1: every filing since was refused-indent."""
    m = re.match(r"[\[{][ \t]*\n( +)\S", raw[:256])
    if not m:
        return None
    i = len(m.group(1))
    return i if json.dumps(d, ensure_ascii=False, indent=i) + ("\n" if raw.endswith("\n") else "") == raw else None


def file_records(root, wing_recs, dry=False):
    """wing_recs: [(wing, record)]. One read, one atomic write. Returns {index into wing_recs: status}; status is
    filed (would-file when dry) | present | no-wing | refused-indent (promotions.json is only ever rewritten in its own indent,
    hook c257: read from the file and proved by a byte-for-byte round trip)."""
    p = os.path.join(root, "data", "promotions.json")
    raw = open(p, encoding="utf-8").read()
    d = json.loads(raw)
    rows = d["promotions"] if isinstance(d, dict) else d
    by = {r.get("id"): r for r in rows if isinstance(r, dict)}
    ind = _indent_of(raw, d)   # hook c257: before anything below touches d
    st, changed = {}, False
    for k, (wing, rec) in enumerate(wing_recs):
        r = by.get(wing)
        if r is None:
            st[k] = "no-wing"; continue
        pn = r.get("provenance_notes")
        if pn is None:
            pn = r["provenance_notes"] = []
        if not isinstance(pn, list):
            st[k] = "no-wing"; continue
        if any(_same(n, rec) for n in pn):
            st[k] = "present"; continue
        if ind is None:
            st[k] = "refused-indent"; continue
        pn.append(rec); st[k] = "would-file" if dry else "filed"; changed = True
    if changed and not dry:
        out = json.dumps(d, ensure_ascii=False, indent=ind) + ("\n" if raw.endswith("\n") else "")
        tmp = p + ".c141.tmp"
        open(tmp, "w", encoding="utf-8").write(out)
        os.replace(tmp, p)
    return st


def narrative(workshop, wing, rec, retired, assertion, note, index=None, dry=False):
    """Append the full note to the wing's workshop narrative, in the converter's claim/evidence/note shape. Idempotent."""
    claim = "%s is the same character as %s (folded into one record)" % (rec["subject"], ", ".join(retired))
    path = os.path.join(workshop, "desk", "provenance-narrative", wing + ".md")
    try:
        cur = open(path, encoding="utf-8").read() if os.path.exists(path) else None
        if cur is not None and "\nclaim: " + claim + "\n" in "\n" + cur:
            return "present"
        if dry:
            return "would-append"
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as fh:
            if cur is None:
                fh.write("# Provenance narrative -- %s\n\nWorkshop-only. Full original text for provenance_notes[] entries; never served.\n" % wing)
            fh.write("\n## entry%s -- kind=identity-guard grade=%s recorded=%s\n\nclaim: %s\nevidence: identity row, assertion %s, grade %s\nnote: %s\n"
                     % ((" %d" % index) if index is not None else "", rec["grade"], rec["recorded"], claim, assertion, rec["grade"], note))
        return "appended"
    except OSError as e:
        return "narrative-failed (%s)" % e


def carry(root, workshop, survivor_id, survivor_wing, retired_id, rows, recorded, dry=False):
    """The one call merge-character and the unknown-ids fixer make. Returns a short status string for their log line."""
    if not rows:
        return "none"
    row = best_row(rows)
    # hook c257: name the folded record by its name and its fed's name. merge-character calls this while both records are still
    # in their shards; the unknown-ids fixer calls it after the fold, when the retired record is gone (a generic head, loose match).
    srec, _sw, snoun = find_record(root, survivor_id)
    rrec, rwing, rnoun = find_record(root, retired_id)
    noun = snoun or rnoun or "character"
    labels = [label_for(root, srec, rrec, rwing, noun, workshop)] if rrec is not None else None
    rec = build_record(survivor_id, [retired_id], row, recorded, root, workshop, noun=noun, labels=labels)
    st = file_records(root, [(survivor_wing, rec)], dry=dry)[0]
    nar = ""
    if st in ("filed", "present"):
        nar = "; " + narrative(workshop, survivor_wing, rec, [retired_id], row.get("assertion"), _note(row), dry=dry)
    return "%s%s" % (st, nar)


def _main(argv):
    if len(argv) == 2 and argv[0] == "--narratives":
        root = _root(); ws = _workshop(root)
        n = ok = 0
        for line in open(argv[1], encoding="utf-8"):
            if not line.strip():
                continue
            e = json.loads(line); n += 1
            rec = {"subject": e["subject"], "grade": e["grade"], "recorded": e["recorded"]}
            s = narrative(ws, e["wing"], rec, e["related"], e.get("assertion"), e["note"])
            ok += s in ("appended", "present")
            print("%s %s <- %s: %s" % (e["wing"], e["subject"], ",".join(e["related"]), s))
        print("merge_evidence: %d narrative entr%s read, %d appended or already present" % (n, "y" if n == 1 else "ies", ok))
        return 0
    print(__doc__.split("CLI")[0].strip().splitlines()[0])
    return 2


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
