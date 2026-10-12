#!/usr/bin/env python3
"""
provenance_classify.py -- shared classification/extraction logic for the
PROVENANCE-NOTES-01 lane (2026-09-13).

Used by BOTH survey.py (read-only analysis -> survey.md/claims.tsv) and
convert-provenance-notes.py (the one-time converter), so the kind a claim
gets in the survey is *exactly* the kind it gets in the conversion -- no
separate reimplementation to drift out of sync.

Nothing in this module writes anything. Pure functions over one claim's
{claim, evidence, grade, note, with} dict.

MARKER SOURCE: reads museum/scripts/text-markers.json (the JSON mirror of
text-markers.mjs, PROSE-FIX-01/PROVENANCE-BACKFILL-01 precedent) rather than
hand-copying the regex list into a second Python string -- one source of
truth, per this lane's own the Janitor's gavel ("free prose... becomes TYPED
CLAIM RECORDS").
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json
import os
import re

MUSEUM_ROOT_DEFAULT = f"{_ROOT}"

MONTHS = [
    "January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December",
]
MONTH_RE = "(?:" + "|".join(MONTHS) + ")"

# ---------------------------------------------------------------------------
# Marker loading
# ---------------------------------------------------------------------------

def load_markers(museum_root=MUSEUM_ROOT_DEFAULT):
    """Load the shared marker regex sources from text-markers.json and
    compile them for Python's `re`. Returns a dict of compiled patterns.
    If the file is missing (lane running standalone, no museum checkout in
    reach), returns an empty-marker fallback so the rest of the pipeline
    still runs -- degraded, not broken."""
    path = os.path.join(museum_root, "scripts", "text-markers.json")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            tm = json.load(fh)
        return {
            "process_marker": re.compile(tm["process_marker_source"]),
            "source_marker": re.compile(tm["source_marker_source"]),
            "process_text": re.compile(tm["process_text_source"], re.I),
            "name_process_text": re.compile(tm["name_process_text_source"], re.I),
        }
    except Exception:
        empty = re.compile(r"(?!x)x")  # matches nothing
        return {
            "process_marker": empty,
            "source_marker": empty,
            "process_text": empty,
            "name_process_text": empty,
        }


# ---------------------------------------------------------------------------
# Extraction: dates, msg-ids, urls, paths, quoted "named documents", and the
# leaks.md-style name-shape count. Each extractor returns a list of
# (start, end, value) spans over the given text so callers can both report
# structured hits AND compute what's left over (the residual narrative).
# ---------------------------------------------------------------------------

DATE_ISO_EXACT = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
DATE_ISO_MONTH = re.compile(r"\b\d{4}-\d{2}\b")
DATE_ISO_YEAR_RANGE = re.compile(r"\b(1[89]\d{2}|20[0-3]\d)\s*[-–—]\s*(1[89]\d{2}|20[0-3]\d)\b")
DATE_ISO_YEAR = re.compile(r"\b(1[89]\d{2}|20[0-3]\d)\b")
# "24 August 2026" / "2 Feb 1999" / "1 December 1996"
DATE_D_MON_Y = re.compile(
    r"\b\d{1,2}\s+(?:" + "|".join(MONTHS + ["Jan", "Feb", "Mar", "Apr", "Jun", "Jul",
    "Aug", "Sep", "Sept", "Oct", "Nov", "Dec"]) + r")\.?\s+\d{4}\b"
)
# "August 24, 2026" / "March 2002"
DATE_MON_D_Y = re.compile(
    r"\b(?:" + "|".join(MONTHS) + r")\s+\d{1,2},?\s+\d{4}\b"
)
DATE_MON_Y = re.compile(r"\b(?:" + "|".join(MONTHS) + r")\s+\d{4}\b")

MSGID_RE = re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b")
URL_RE = re.compile(r"https?://\S+")
PATH_RE = re.compile(r"\b(?:promotions|data)/[\w./-]+\.(?:html|json|md|cgi|shtml|txt)\b")
# a bare filename mention not under a path prefix, e.g. "roster.cgi", "wwa-site.md"
BAREFILE_RE = re.compile(r"\b[\w-]+\.(?:cgi|shtml|html|md)\b")

# Quoted "named documents/pages": a run of 2+ words inside straight or
# curly double quotes, at least 6 chars long -- catches page/document
# titles ("BROTHERS WRESTLING (BBW) INFORMATION", "Crowning Glory") without
# trying to distinguish a title from a person's quoted words (a human
# reads the survey's redacted examples to judge that; the count alone
# drives the residual-length math, and titles are held ids/document names,
# not real names, so they are not subject to the no-names rule the same
# way -- still never copied verbatim into a report per this lane's rules).
NAMED_DOC_RE = re.compile(r"[“\"]([^”\"]{6,80})[”\"]")

# leaks.md's own convention: every two-to-four-word capitalized run.
NAME_SHAPE_RE = re.compile(
    r"\b(?:[A-Z][a-zA-Z'’-]*\s){1,3}[A-Z][a-zA-Z'’-]*\b"
)


def _spans(pattern, text):
    return [(m.start(), m.end(), m.group(0)) for m in pattern.finditer(text)]


def find_dates(text):
    """Returns a list of {value, precision, span:(start,end)}. Longer/more
    specific matches are taken first and shorter overlapping matches (e.g.
    a bare year inside an already-matched 'D Month YYYY') are dropped."""
    candidates = []
    for pat, prec in (
        (DATE_ISO_EXACT, "exact"),
        (DATE_D_MON_Y, "exact"),
        (DATE_MON_D_Y, "exact"),
        (DATE_ISO_MONTH, "month"),
        (DATE_MON_Y, "month"),
        (DATE_ISO_YEAR_RANGE, "year-range"),
        (DATE_ISO_YEAR, "year"),
    ):
        for start, end, val in _spans(pat, text):
            candidates.append((start, end, val, prec))
    # longest span first, then earliest start -- greedy non-overlap select
    candidates.sort(key=lambda c: (-(c[1] - c[0]), c[0]))
    chosen = []
    occupied = []
    for start, end, val, prec in candidates:
        if any(not (end <= o0 or start >= o1) for o0, o1 in occupied):
            continue
        occupied.append((start, end))
        chosen.append({"value": val, "precision": prec, "span": (start, end)})
    chosen.sort(key=lambda c: c["span"][0])
    return chosen


def find_msgids(text):
    return _spans(MSGID_RE, text)


def find_urls(text):
    return _spans(URL_RE, text)


def find_paths(text):
    spans = _spans(PATH_RE, text)
    covered = [(s, e) for s, e, _ in spans]
    for s, e, v in _spans(BAREFILE_RE, text):
        if not any(not (e <= c0 or s >= c1) for c0, c1 in covered):
            spans.append((s, e, v))
    return spans


def find_named_docs(text):
    return _spans(NAMED_DOC_RE, text)


def count_name_shapes(text):
    return len(NAME_SHAPE_RE.findall(text))


def marker_hits(text, markers):
    """Returns list of (regex-name, matched substring) for every marker
    regex that hits this text. Both the render list (PROCESS_MARKER_RE)
    and the broader gate list (NAME_PROCESS_TEXT_RE) are checked -- a claim
    destined for a `summary` field must clear both."""
    hits = []
    for name, key in (("process_marker", "process_marker"), ("gate", "name_process_text")):
        pat = markers[key]
        for m in pat.finditer(text):
            hits.append((name, m.group(0)))
    return hits


def strip_markers(text, markers):
    """Delete every marker-regex match from text (used when building a
    typed record's `summary`, which must carry zero marker hits)."""
    text = markers["process_marker"].sub(" ", text)
    text = markers["name_process_text"].sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def compute_residual(text, markers):
    """Remove every structured piece this module can extract (dates,
    msg-ids, urls, paths, quoted named docs, marker hits) from `text` and
    return what's left, collapsed to single spaces. This estimates how
    much of the claim is genuinely free narrative rather than parseable
    structure."""
    spans = []
    for s, e, _ in find_msgids(text):
        spans.append((s, e))
    for s, e, _ in find_urls(text):
        spans.append((s, e))
    for s, e, _ in find_paths(text):
        spans.append((s, e))
    for s, e, _ in find_named_docs(text):
        spans.append((s, e))
    for d in find_dates(text):
        spans.append(d["span"])
    for name, key in (("process_marker", "process_marker"), ("gate", "name_process_text")):
        for m in markers[key].finditer(text):
            spans.append((m.start(), m.end()))
    if not spans:
        residual = text
    else:
        spans.sort()
        merged = [list(spans[0])]
        for s, e in spans[1:]:
            if s <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], e)
            else:
                merged.append([s, e])
        out = []
        last = 0
        for s, e in merged:
            out.append(text[last:s])
            last = e
        out.append(text[last:])
        residual = " ".join(out)
    return re.sub(r"\s+", " ", residual).strip()


# ---------------------------------------------------------------------------
# Kind classification -- ONE priority-ordered pass over `claim` (falling
# back to `evidence` only when `claim` is empty, which does not happen in
# the live corpus but keeps this function total). Order matters: earlier
# rules are more specific and are checked first so a generic word inside a
# more specific sentence (e.g. "founded" inside a tier-change note) does
# not steal the classification.
#
# Enum (fixed order, matches the lane's brief):
#   founding, closure, rename, membership/alliance, title-lineage,
#   roster/character, document-served, document-collected, identity-guard,
#   correction, tier/depth-change, liveness/host, cross-reference, other
# ---------------------------------------------------------------------------

KIND_ENUM = [
    "founding", "closure", "rename", "membership-alliance", "title-lineage",
    "roster-character", "document-served", "document-collected",
    "identity-guard", "correction", "tier-depth-change", "liveness-host",
    "cross-reference", "other",
]

_RULES = [
    # --- tier/depth change: specific curatorial-scale language, checked
    # before the generic "corrected from" rule because its own wording
    # ("Depth note", "Depth corrected", "Tier N earned", "TIER-3 (") does
    # not always literally say "<field> corrected from".
    ("tier-depth-change", re.compile(
        r"^\s*Depth (note|corrected)\b"
        r"|\bTier \d+ earned\b"
        r"|\bTIER-\d+\b"
        r"|\b(?:tier|depth)\s+(?:corrected|moved)\b"
        r"|\btier[_ ]source corrected from\b",
        re.I)),
    # --- correction: a generic "<field> corrected from ..." row minted by
    # a census/normalization pass, OR one of the "moved from the placard /
    # served qualifier / source window" family -- a fixed grammar (found by
    # this survey to cover ~700 rows) recording free text that used to sit
    # in a served, length-capped field (medium_detail/qualifier/a source
    # window note) before it was trimmed for the gate and archived here as
    # an accountability trail. Both are museum-record edits, not in-fiction
    # facts, so both are "correction" -- checked early because these rows
    # are otherwise indistinguishable in bulk from "founding"/"title-lineage"
    # etc. by keyword alone (a corrected `name` field often just repeats
    # the promotion's own name, and a moved medium_detail note often talks
    # about the fed's own site/roster in passing).
    ("correction", re.compile(
        r"^\s*[A-Za-z_]+(?:[ _][A-Za-z_]+)?\s+corrected from\b"
        r"|^\s*(?:Medium detail|Source window note)\s*\(moved\b"
        r"|^\s*Removed from the served \w+\b"
        r"|^\s*URL-census audit\b.*\bCORRECTED\b",
        re.I)),
    # --- identity-guard: two promotions/records being told apart, or a
    # shared-acronym disclaimer. `with[]` on the record (checked by the
    # caller before falling back to this regex pass) is the strongest
    # signal; this regex covers the same shape when `with` is absent.
    ("identity-guard", re.compile(
        r"\bdistinct from\b|\bDISTINCT FROM\b"
        r"|\bshares? (?:the |this )?(?:bare )?acronym\b"
        r"|\bjoins? to (?:neither|none)\b"
        r"|\bnot the same (?:fed|promotion)\b"
        r"|\bunrelated (?:e-fed|promotion|federation)\b"
        r"|\bcollision doctrine\b"
        r"|\bdo[_-]not[_-]merge\b"
        r"|\bmisjoin\b|\bacronym-only join\b"
        r"|^\s*IDENTITY CHECK\b|\btwo axes plus chronology\b"
        r"|^\s*ENRICHED\b.*\bresolved to registry slug\b"
        r"|^\s*DO NOT MERGE\b|^\s*OVERLOADED ACRONYM\b"
        r"|\bno (?:wing|registry|held)\b[^.]{0,60}\b(?:collision|already held)\b"
        r"|\bshares its acronym\b|\bthis is a distinct fed\b|\brecorded separately from\b",
        re.I)),
    # --- document-collected: the "moved from the Provenance list" family
    # (raw source material being catalogued/relocated) and explicit
    # collection-not-serving language.
    ("document-collected", re.compile(
        r"^\s*Source note \(moved from the Provenance list"
        r"|\bthe Provenance list\b"
        r"|\bcollected but not served\b"
        r"|\bnewly collected\b"
        r"|\bdocuments? (?:are )?held\b.{0,20}\bnot served\b",
        re.I)),
    # --- document-served: a document/page now being read/served in full,
    # or a claim about what a served page does/doesn't carry.
    ("document-served", re.compile(
        r"\bnow served\b|\bserved in full\b|\bwing serves\b|\bnever captured\b"
        r"|\bfull text is read\b|\bread in the served\b|\bthe wing serves no document\b",
        re.I)),
    # --- founding: origin/launch facts.
    ("founding", re.compile(r"\bfound(?:ed|ing)\b|\blaunch(?:ed|ing)?\b|\bfirst (?:show|card)\b|\bopened\b", re.I)),
    # --- closure: end-of-run facts.
    ("closure", re.compile(r"\bclos(?:ed|ure)\b|\bwent dark\b|\bdefunct\b|\bstopped\b|\blast (?:show|card)\b", re.I)),
    # --- rename: an in-fiction or record name change (distinct from the
    # "correction" bucket above, which is a museum record fix, not an
    # in-universe event -- "correction" is checked first so a census-pass
    # "name corrected from ..." row never falls in here).
    ("rename", re.compile(r"\brenam(?:ed|ing)\b|\bname change\b|\brebrand(?:ed|ing)?\b|\brenamed itself\b", re.I)),
    # --- membership/alliance: affiliation/umbrella-group facts.
    ("membership-alliance", re.compile(
        r"\baffiliat\w*\b|\balliance\b|\bmember federation\b|\bmember address\b"
        r"|\bumbrella\b|\bsister (?:league|promotion)\b",
        re.I)),
    # --- title-lineage: championship/reign facts.
    ("title-lineage", re.compile(r"\btitle\b|\bchampionship\b|\breign(?:s|ed)?\b|\bbelt\b|\bHall of Champions\b", re.I)),
    # --- roster/character: roster, wrestler, on-screen-character facts.
    ("roster-character", re.compile(r"\broster\b|\bwrestlers?\b|\bcharacters?\b|\bbilled as\b|\bon[- ]screen\b", re.I)),
    # --- liveness/host: site/domain/capture-status facts.
    ("liveness-host", re.compile(
        r"\bdomain\b|\bsquatt\w*\b|\bparked\b|\blapse[ds]?\b|\bGeoCities\b|\bWayback\b"
        r"|\bcaptured?\b|\bhost(?:ed|ing)?\b|\bdead/parked\b",
        re.I)),
    # --- cross-reference: this record pointing at facts that live on
    # another wing's own served record.
    ("cross-reference", re.compile(
        r"\bthis collection (?:already )?(?:holds|records)\b|\bthe held wing\b"
        r"|\bown served record\b|\bcarried into\b|\brecites\b"
        r"|\bfrontier-vs-wing\b",
        re.I)),
]


def classify_kind(pn):
    """pn: a provenance_notes[] dict ({claim, evidence, grade, note?,
    with?}). Returns one of KIND_ENUM. `with[]` (an explicit list of
    related promotion ids used only for identity-guard rows in the live
    corpus, verified against the full data set before writing this rule)
    is checked before the text rules."""
    claim = pn.get("claim") or ""
    evidence = pn.get("evidence") or ""
    if pn.get("with"):
        return "identity-guard"
    haystack = claim if claim.strip() else evidence
    for kind, pat in _RULES:
        if pat.search(haystack):
            return kind
    return "other"


def first_sentence(text, limit=160):
    """The claim's first sentence, trimmed to `limit` chars (used for the
    'other' bucket's summary, per the lane brief)."""
    text = (text or "").strip()
    m = re.search(r"[.!?](?:\s|$)", text)
    sent = text[: m.end()].strip() if m else text
    if len(sent) > limit:
        sent = sent[:limit].rsplit(" ", 1)[0].rstrip(",;: ") + "…"
    return sent


def normalize_grammar(claim, max_words=6):
    """Collapses a claim's opening words into a template for the
    'most common claim grammars' survey stat: digits -> #, quoted spans ->
    "...", and only the first `max_words` words are kept."""
    s = claim or ""
    s = NAMED_DOC_RE.sub('"..."', s)
    s = re.sub(r"\d{4}-\d{2}-\d{2}", "<date>", s)
    s = re.sub(r"\d+", "#", s)
    words = s.split()
    return " ".join(words[:max_words])
