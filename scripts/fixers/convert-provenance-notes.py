#!/usr/bin/env python3
"""
convert-provenance-notes.py -- PROVENANCE-NOTES-01, 2026-09-13.

One-time converter: museum/data/promotions.json's provenance_notes[] free-prose
{claim, evidence, grade} objects (6,389 of them across 1,388 promotions, see
survey.md) become TYPED CLAIM RECORDS (schema.md), with every byte of the
original free text preserved verbatim in a per-wing workshop-only narrative
file (the workshop's provenance narrative <wing>.md) that this script also
writes. Nothing is deleted; see schema.md's "What's dropped, and where it
goes" section.

DETERMINISTIC: given the same input file, this script produces byte-identical
output every time (no randomness, no wall-clock dependence except the
`recorded` fallback -- see CLASSIFICATION RULES #5 below -- and `--as-of`
lets a test pin even that).

IDEMPOTENT: a provenance_notes[] entry that is ALREADY a typed record (has
`kind`+`recorded`+`summary` and no `claim` key) is passed through completely
unchanged -- not reclassified, not re-summarized -- and contributes nothing
new to its wing's notes.md file. Running this script twice on its own output
is a strict no-op: zero bytes change in promotions.json, and no notes.md file
is touched (see --dry's own "0 newly converted" line on a second run).

NEVER WRITES UNDER museum/. This script writes:
  - the converted promotions.json to --output (default: alongside --input,
    suffixed `.converted.json` -- it NEVER overwrites --input in place unless
    --output is explicitly set equal to --input, which only the coordinator
    should ever do, against the real museum/data/promotions.json, in a clear
    window per LANE-RULES.md #3/#9 discipline).
  - one workshop narrative file per converted wing under --notes-dir
    (default: the workshop's provenance narrative <wing>.md).
--dry prints counts only; writes nothing.

CLASSIFICATION RULES (full detail + every regex: provenance_classify.py,
imported below -- this header is a summary, not the source of truth):

  1. `kind` -- one priority-ordered regex pass per claim, see
     provenance_classify.KIND_ENUM / classify_kind(). Order matters: more
     specific grammars (a census "<field> corrected from ..." row, a
     "moved from the placard/qualifier/Provenance list" housekeeping note,
     an identity-guard "distinct from"/`with[]`-bearing row) are checked
     before generic keyword buckets (founding/closure/title-lineage/...) so
     a stray keyword inside a more specific sentence doesn't steal the
     classification. Unmatched claims get "other" -- a legitimate 14.9% of
     the corpus (survey.md), not a failure to fix later.
  2. `date`/`span` -- every ISO, "D Month YYYY", "Month D, YYYY", and
     "Month YYYY" date found in the claim (falling back to evidence if the
     claim has none) is a CANDIDATE. Any candidate whose year is 2026 is
     treated as a workshop/curation date (every promotion this museum holds
     predates 2026 -- text-markers.mjs's own reasoning, reused here) and
     goes toward `recorded`, never `date`/`span`. The first non-2026
     candidate becomes the claim's own `date` (or `span`, for a matched
     year-range like "1995-1997"). Every OTHER date mentioned in the claim
     (a citation's own capture date, a comparison date) is left in the
     notes.md prose -- this script does not attempt a full date-per-fact
     model; see schema.md's "What this schema does NOT do".
  3. `subject` -- defaults to the promotion's own id. Overridden to a
     `promotions/<wing>/{archive,rp}/*.html` page path ONLY when one
     matching this wing's own id is found in the claim text AND the kind is
     document-served or document-collected (the two kinds that are
     regularly about a specific page rather than the wing as a whole).
  4. `related` -- copied verbatim from the live `with[]` field when present
     (5 rows on file, all identity-guard). Never mined from free text --
     see schema.md's `related` field note for why.
  5. `sources` -- extracted from the claim+evidence text: a
     `promotions/<wing>/{archive,rp}/*.html` path becomes
     `{"kind": "unknown", "page": "/<path>"}`; a groups.google.com URL
     becomes `{"kind": "newsgroup", "url": ...}`; a web.archive.org URL
     becomes `{"kind": "wayback", "url": ...}`; any other URL becomes
     `{"kind": "unknown", "url": ...}`; a message-id-shaped token becomes
     `{"kind": "newsgroup", "msg_id": ...}`. If nothing is found: `grade
     == "presumed"` gets `sources: []` (schema/validator both allow this);
     any other grade gets the single-entry `[{"kind": "unknown"}]`
     placeholder LANE-TEMPLATE-provenance.md already uses for a page with
     no recoverable source, and the wing/index is listed in this run's
     "flagged for source review" report line.
  6. `recorded` -- the first 2026-dated candidate from rule #2, normalized
     to YYYY-MM-DD. If none is found (or none carries day-level precision),
     `recorded` falls back to `--as-of` (default: today), which is why a
     bulk conversion run's un-dated rows all carry one identical stamp --
     that stamp is how a human tells a "recovered" `recorded` date from a
     "this run's own date" fallback apart later.
  7. `summary` -- `first_sentence(claim, 160)` with every
     PROCESS_MARKER_RE/NAME_PROCESS_TEXT_RE hit deleted (both regexes,
     loaded from museum/scripts/text-markers.json -- no hand-copied second
     marker list in this file). Applied uniformly to every kind, not just
     "other" (the brief requires this for "other"; applying it everywhere
     keeps one code path and one guarantee: EVERY summary is marker-free
     and <=160 chars, which is exactly what the validator checks).
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import argparse
import datetime
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import provenance_classify as pc

MUSEUM_ROOT_DEFAULT = f"{_ROOT}"
NOTES_DIR_DEFAULT = f"{_WORKSHOP}/desk/provenance-narrative"
GATE_GUARD_RE = r"scripts/gate[.]sh|registry-validate|cross-reference[.]mjs|privacy-check"

MONTH_NUM = {}
for i, m in enumerate(pc.MONTHS, start=1):
    MONTH_NUM[m] = i
    MONTH_NUM[m[:3]] = i
MONTH_NUM["Sept"] = 9

KNOWN_SOURCE_KINDS = [
    "newsgroup", "wayback", "arquivo", "geocities-torrent", "direct", "commoncrawl", "unknown",
]


def refuse_if_gate_running(output_path, museum_root):
    """Only refuses when --output actually resolves under museum/ -- the
    guard's whole purpose is protecting a concurrent write to the SHARED
    museum data file while a gate/build reads it (fix-content-notice.py's
    own pattern, proposal.md #3). A run against a private work-dir copy
    (this lane's own tests; --output never under museum/) has nothing to
    conflict with, so it proceeds even while another lane's legitimate
    gate/build is running elsewhere -- verified live during this lane's own
    test run, 2026-09-13 (a concurrent `node scripts/cross-reference.mjs`
    from another lane was running throughout and never touched)."""
    out_real = os.path.realpath(output_path)
    museum_real = os.path.realpath(museum_root)
    if not (out_real == museum_real or out_real.startswith(museum_real + os.sep)):
        return
    try:
        if _live_running(GATE_GUARD_RE, museum_root):
            sys.exit("REFUSED: a gate or build appears to be running (pgrep matched) and --output is under museum/ -- re-run in a clear window")
    except FileNotFoundError:
        pass  # pgrep not available in this environment; proceed (test/dev boxes)


# ---------------------------------------------------------------------------
# Date normalization
# ---------------------------------------------------------------------------

def _norm_exact(raw):
    raw = raw.strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", raw)
    if m:
        return raw
    m = re.match(r"^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})$", raw)
    if m:
        day, mon, year = m.groups()
        mnum = MONTH_NUM.get(mon) or MONTH_NUM.get(mon.rstrip("."))
        if mnum:
            return f"{year}-{mnum:02d}-{int(day):02d}"
    m = re.match(r"^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$", raw)
    if m:
        mon, day, year = m.groups()
        mnum = MONTH_NUM.get(mon)
        if mnum:
            return f"{year}-{mnum:02d}-{int(day):02d}"
    return None


def _norm_month(raw):
    raw = raw.strip()
    m = re.match(r"^(\d{4})-(\d{2})$", raw)
    if m:
        return raw
    m = re.match(r"^([A-Za-z]+)\s+(\d{4})$", raw)
    if m:
        mon, year = m.groups()
        mnum = MONTH_NUM.get(mon)
        if mnum:
            return f"{year}-{mnum:02d}"
    return None


def _norm_year(raw):
    m = re.match(r"^(\d{4})$", raw.strip())
    return m.group(1) if m else None


def normalize_date(raw, precision):
    if precision == "exact":
        return _norm_exact(raw)
    if precision == "month":
        return _norm_month(raw)
    if precision == "year":
        return _norm_year(raw)
    return None


def split_year_range(raw):
    m = re.match(r"\s*(\d{4})\s*[-–—]\s*(\d{4})\s*", raw)
    if not m:
        return None, None
    return m.group(1), m.group(2)


def pick_subject_date(claim, evidence):
    """Returns (date_obj_or_None, span_obj_or_None, recorded_iso_or_None).
    Scans claim's date candidates first, then evidence's (claim-text
    candidates take priority since the claim is the sentence actually
    making the assertion). `date`/`span` = the first candidate whose year
    is NOT 2026 (every promotion this museum holds predates 2026, so a
    2026-dated candidate is by construction a workshop/curation date, not
    the claim's own subject date -- text-markers.mjs's own reasoning,
    reused here). `recorded` = the first EXACT-precision candidate whose
    year IS 2026, normalized to YYYY-MM-DD. Every other candidate found is
    left in the notes.md prose -- see schema.md's "What this schema does
    NOT do"."""
    subject_date = None
    subject_span = None
    recorded = None
    for text in (claim, evidence):
        if not text:
            continue
        for d in pc.find_dates(text):
            raw, prec = d["value"], d["precision"]
            if prec == "year-range":
                if subject_date is None and subject_span is None:
                    y1, y2 = split_year_range(raw)
                    if y1 and y1 != "2026":
                        subject_span = {
                            "from": {"date": y1, "precision": "year"},
                            "to": {"date": y2, "precision": "year"},
                        }
                continue
            norm = normalize_date(raw, prec)
            if norm is None:
                continue
            if norm.startswith("2026"):
                if recorded is None and prec == "exact":
                    recorded = norm
            elif subject_date is None and subject_span is None:
                subject_date = {"date": norm, "precision": prec}
    return subject_date, subject_span, recorded


# ---------------------------------------------------------------------------
# Sources extraction
# ---------------------------------------------------------------------------

def extract_sources(claim, evidence, wing_id, grade):
    text = (claim or "") + "\n" + (evidence or "")
    sources = []
    seen = set()

    for s, e, path in pc.find_paths(text):
        if not re.match(r"^promotions/[\w-]+/(?:archive|rp)/[\w./-]+\.html$", path):
            continue
        # NOT restricted to this wing's own promotions/<wing_id>/ prefix --
        # a cross-reference claim's whole point is citing ANOTHER wing's own
        # served page as the source (schema.md's `sources[].page` note); the
        # `subject` override below stays wing-restricted, but a citation is
        # a citation regardless of which wing's page it points at.
        key = ("page", path)
        if key in seen:
            continue
        seen.add(key)
        sources.append({"kind": "unknown", "page": "/" + path})

    for s, e, url in pc.find_urls(text):
        url = url.rstrip(").,;'\"")
        key = ("url", url)
        if key in seen:
            continue
        seen.add(key)
        if "groups.google.com" in url:
            sources.append({"kind": "newsgroup", "url": url})
        elif "web.archive.org" in url:
            sources.append({"kind": "wayback", "url": url})
        else:
            sources.append({"kind": "unknown", "url": url})

    for s, e, msgid in pc.find_msgids(text):
        key = ("msgid", msgid)
        if key in seen:
            continue
        seen.add(key)
        sources.append({"kind": "newsgroup", "msg_id": msgid})

    flagged = False
    if not sources:
        if grade == "presumed":
            sources = []
        else:
            sources = [{"kind": "unknown"}]
            flagged = True
    return sources, flagged


# ---------------------------------------------------------------------------
# Subject
# ---------------------------------------------------------------------------

def pick_subject(claim, evidence, wing_id, kind):
    if kind in ("document-served", "document-collected"):
        text = (claim or "") + "\n" + (evidence or "")
        for s, e, path in pc.find_paths(text):
            if re.match(rf"^promotions/{re.escape(wing_id)}/(?:archive|rp)/[\w./-]+\.html$", path):
                return "/" + path
    return wing_id


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

def _tidy_punctuation(text):
    """Cleans up the dangling punctuation marker-stripping leaves behind
    (e.g. "(census 1990-1996 v2, )" once its trailing 2026-date is
    deleted as a workshop-date marker hit)."""
    text = re.sub(r"\(\s*,\s*\)", "", text)
    text = re.sub(r"\(\s*\)", "", text)
    text = re.sub(r",\s*\)", ")", text)
    text = re.sub(r"\(\s*,", "(", text)
    text = re.sub(r"\s+([,.;:)])", r"\1", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip(" ,")


def build_summary(claim, evidence, markers):
    text = claim if (claim and claim.strip()) else (evidence or "")
    sent = pc.first_sentence(text, 160)
    cleaned = _tidy_punctuation(pc.strip_markers(sent, markers))
    if len(cleaned) > 160:
        cleaned = cleaned[:160].rsplit(" ", 1)[0].rstrip(",;: ") + "…"
    return cleaned


# ---------------------------------------------------------------------------
# Per-entry conversion
# ---------------------------------------------------------------------------

def already_typed(pn):
    return (
        isinstance(pn, dict)
        and "claim" not in pn
        and pn.get("kind") in pc.KIND_ENUM
        and "recorded" in pn
        and "summary" in pn
    )


def convert_entry(pn, wing_id, markers, as_of):
    claim = pn.get("claim") or ""
    evidence = pn.get("evidence") or ""
    note = pn.get("note")
    grade = pn.get("grade") or "presumed"

    kind = pc.classify_kind(pn)
    date_obj, span_obj, recorded = pick_subject_date(claim, evidence)
    if kind == "correction":
        # A "<field> corrected from ..." row's only real date is WHEN the
        # correction was recorded -- any year-range picked up from a
        # census-pass label like "census 1990-1996 v2" is a version
        # codename, not a temporal fact about the claim's subject (verified
        # live: every "corrected from" row on file names a census/audit
        # pass this way, never an actual founding/closure span). Keep
        # `recorded`, drop the spurious date/span.
        date_obj, span_obj = None, None
    sources, flagged = extract_sources(claim, evidence, wing_id, grade)
    subject = pick_subject(claim, evidence, wing_id, kind)
    related = list(pn.get("with")) if pn.get("with") else []
    summary = build_summary(claim, evidence, markers)

    record = {
        "kind": kind,
        "date": date_obj,
        "span": span_obj,
        "subject": subject,
        "related": related,
        "sources": sources,
        "grade": grade,
        "recorded": recorded or as_of,
        "summary": summary,
    }
    narrative_parts = [f"claim: {claim}"]
    if evidence:
        narrative_parts.append(f"evidence: {evidence}")
    if note:
        narrative_parts.append(f"note: {note}")
    narrative = "\n".join(narrative_parts)
    return record, narrative, flagged


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", default=os.path.join(MUSEUM_ROOT_DEFAULT, "data", "promotions.json"))
    ap.add_argument("--output", default=None, help="default: <input>.converted.json (never overwrites --input unless explicitly set equal to it)")
    ap.add_argument("--notes-dir", default=NOTES_DIR_DEFAULT)
    ap.add_argument("--museum-root", default=MUSEUM_ROOT_DEFAULT, help="for locating scripts/text-markers.json")
    ap.add_argument("--as-of", default=None, help="YYYY-MM-DD fallback for `recorded` when no date is recoverable (default: today)")
    ap.add_argument("--dry", action="store_true", help="print counts only; write nothing")
    args = ap.parse_args()

    as_of = args.as_of or datetime.date.today().isoformat()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", as_of):
        sys.exit(f"--as-of must be YYYY-MM-DD, got {as_of!r}")

    output_path = args.output or (args.input + ".converted.json")
    if not args.dry:
        refuse_if_gate_running(output_path, args.museum_root)

    markers = pc.load_markers(args.museum_root)

    with open(args.input, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    promos = data["promotions"] if isinstance(data, dict) else data

    n_total = 0
    n_converted = 0
    n_already_typed = 0
    n_flagged_sources = 0
    kind_counts = {}
    wings_touched = {}  # wing_id -> list of narrative strings for NEW conversions this run

    for p in promos:
        wing_id = p.get("id", "?")
        pns = p.get("provenance_notes")
        if not pns:
            continue
        new_pns = []
        for pn in pns:
            n_total += 1
            if already_typed(pn):
                n_already_typed += 1
                new_pns.append(pn)
                continue
            record, narrative, flagged = convert_entry(pn, wing_id, markers, as_of)
            n_converted += 1
            kind_counts[record["kind"]] = kind_counts.get(record["kind"], 0) + 1
            if flagged:
                n_flagged_sources += 1
            new_pns.append(record)
            wings_touched.setdefault(wing_id, []).append((len(new_pns) - 1, record, narrative))
        p["provenance_notes"] = new_pns

    print(f"convert-provenance-notes: {n_total} claim objects seen "
          f"({n_already_typed} already typed / passthrough, {n_converted} newly converted)")
    if kind_counts:
        print("  kind counts (newly converted only):")
        for k in pc.KIND_ENUM:
            if kind_counts.get(k):
                print(f"    {k}: {kind_counts[k]}")
    print(f"  {n_flagged_sources} newly converted claims flagged for source review "
          f"(non-presumed grade, no source found in text -- carries sources:[{{kind:unknown}}])")
    print(f"  {len(wings_touched)} wings have newly converted claims (notes.md will be written/appended for these)")

    if args.dry:
        print("--dry: nothing written")
        return

    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"wrote {output_path}")

    os.makedirs(args.notes_dir, exist_ok=True)
    for wing_id, entries in wings_touched.items():
        path = os.path.join(args.notes_dir, f"{wing_id}.md")
        is_new = not os.path.exists(path)
        with open(path, "a", encoding="utf-8") as fh:
            if is_new:
                fh.write(f"# Provenance narrative -- {wing_id}\n\n")
                fh.write(
                    "Workshop-only. Full original `claim`/`evidence`/`note` text for every "
                    f"`provenance_notes[]` entry converted off {wing_id}'s promotions.json row "
                    "by convert-provenance-notes.py (PROVENANCE-NOTES-01, 2026-09-13). Never "
                    "served; lives under archive/, not museum/. Each entry below is cross-"
                    "referenced by its typed record's own index in promotions.json.\n\n"
                )
            for idx, record, narrative in entries:
                fh.write(f"## entry {idx} -- kind={record['kind']} grade={record['grade']} recorded={record['recorded']}\n\n")
                fh.write(narrative + "\n\n")
    print(f"wrote/appended {len(wings_touched)} narrative files under {args.notes_dir}")


if __name__ == "__main__":
    main()
