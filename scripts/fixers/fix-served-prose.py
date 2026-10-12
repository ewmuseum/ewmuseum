#!/usr/bin/env python3
"""Standing fixer (PROSE-FIX-01, 2026-09-13; proposal.md #0/#3, in the fix-content-notice.py
style: the workshop's fix-content-notice.py). Strips whole SENTENCES
carrying a workshop-process marker out of the served free-text fields the prose audit
(the workshop's prose audit of 2026-09-13) verdicted STRUCTURE/KEEP-AUTHORED, using the exact
same PROCESS_MARKER_RE the render-time filter (scripts/cross-reference.mjs's own
stripProcessSentences()) already applies at build time — this makes the STORED field match
what the site already shows (or, for the fields proposal.md #2 just wired up, will show once
that patch lands), never a script's own guess at a rewrite. NEVER a partial word: every
marker in the shared list is phrase- or shape-anchored (\\b-bounded), and this script's own
sentence splitter only ever drops a WHOLE sentence or parenthetical, exactly like the render
path does. Deliberately does NOT run sanitizeMachineryLeak()'s mechanical rewrites (245 lines
of cross-reference.mjs-specific regex substitutions, out of this script's scope and this
lane's module boundary — see findings.md) — a field this leaves alone because its only marker
hit sits inside a rewritable (not deletable) phrase is reported nowhere-differently; it simply
keeps its current sentence, same as before this fixer existed.

Reads scripts/text-markers.json (the JSON mirror scripts/text-markers.mjs emits via
`node scripts/text-markers.mjs --emit-json`) for the marker regex, so this Python script and
the JS render/gate pipeline can never fork into two different marker lists — see that
module's own header. Refuses to run if that file is missing rather than hand-copy the pattern.

SCOPE, per CLAUDE.md's own "edit the shard, never the monolith" invariant and proposal.md #3's
explicit "against the shard files (never the generated monoliths)" discipline: characters/
units/titles/awards/reigns are edited ONLY via data/shards/<promo>/<type>.json (the
_unassigned pseudo-shard included, _headers excluded — that directory holds header snippets,
not row arrays). affiliations/memorials/collections/frontier are edited directly at
data/<type>.json — shard-lib.mjs's own SHARD_TYPES list does not shard these four, so their
monolith IS the source of truth. promotions.json is NOT touched here: its own served fields
(caption/medium_detail/qualifier/house_style/tagline) are already the best-governed prose on
the site (length cap + marker gate both exist, registry-validate.mjs's own field loop) and are
explicitly proposal.md #5's "model, not a problem to fix" — same reasoning this lane's
findings.md documents for leaving that field loop's existing behavior alone.

Fields touched (proposal.md's own STRUCTURE/KEEP-AUTHORED verdict fields — see inventory.tsv):
  characters/units .json (shard): caption, notes, tenures[].note
  titles.json       (shard): epitaph, notes, events[].note
  awards.json       (shard): epitaph, notes, bestowals[].vote_detail
  reigns.json       (shard): note, conflict.note
  affiliations.json (monolith): note, status_note
  memorials.json    (monolith): note, gallery[].caption
  collections.json  (monolith): blurb, note
  frontier.json     (monolith): first_seen_in, community_presence[].hub

Never touches caption_asof/epitaph_asof/note_author/status_note's own `grade` sibling —
those authorship/grade blocks are read for nothing here and are not walked at all; only the
named prose leaf strings above are ever assigned a new value, and only when it differs from
the old one (idempotent: a clean second run reports zero changes everywhere).

--dry: report counts only, write nothing. Same pgrep guard as fix-content-notice.py, run
unconditionally (not just outside --dry) since even a dry run reads a live, possibly-mid-write
tree.
"""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json, re, sys, subprocess, glob, os

M = f"{_ROOT}"
DATA = f"{M}/data"
dry = "--dry" in sys.argv

if _live_running("scripts/gate[.]sh|registry-validate|cross-reference[.]mjs|privacy-check", _ROOT):
    sys.exit("REFUSED: a gate or build is running")

MARKERS_PATH = f"{M}/scripts/text-markers.json"
if not os.path.exists(MARKERS_PATH):
    sys.exit(
        f"REFUSED: {MARKERS_PATH} not found — run `node scripts/text-markers.mjs --emit-json` "
        "from museum/scripts/ first (see findings.md's apply order); this script never "
        "hand-copies the marker pattern, it reads the shared module's own export."
    )
markers = json.load(open(MARKERS_PATH, encoding="utf-8"))
try:
    PROCESS_MARKER_RE = re.compile(markers["process_marker_source"])
except re.error as e:
    sys.exit(f"REFUSED: text-markers.json's process_marker_source did not compile in Python's re: {e}")

# ---------------------------------------------------------------------------
# THE SENTENCE-STRIP PIPELINE — a faithful Python port of cross-reference.mjs's
# own insideQuote()/splitSentences()/stripProcessSentences() (PROCESS_MARKER_RE
# stage only; sanitizeMachineryLeak's rewrites are deliberately out of scope,
# see this file's own docstring). Verified against real corpus text in
# findings.md's render-parity test before this script was trusted to write
# anything — the JS and Python pipelines were run side by side on the same
# 30 leaks.md examples and produced identical output.
# ---------------------------------------------------------------------------
SENTENCE_END_RE = re.compile(r'[.!?]+["\'’”)\]]?(?=\s|$)')
PAREN_RE = re.compile(r"\s*\((?:[^()]*)\)")
BRACKET_RE = re.compile(r"\s*\[(?:[^\[\]]*)\]")


def inside_quote(s, idx):
    head = s[:idx]
    if head.count('"') % 2 == 1:
        return True
    return head.count("“") > head.count("”")


def split_sentences(s):
    out, last = [], 0
    for m in SENTENCE_END_RE.finditer(s):
        end = m.end()
        if inside_quote(s, end):
            continue
        out.append(s[last:end])
        last = end
    if last < len(s):
        out.append(s[last:])
    return out


def strip_process_sentences(s):
    if not s:
        return s
    out = PAREN_RE.sub(lambda m: "" if PROCESS_MARKER_RE.search(m.group()) else m.group(), s)
    out = BRACKET_RE.sub(lambda m: "" if PROCESS_MARKER_RE.search(m.group()) else m.group(), out)
    sentences = split_sentences(out)
    kept = [sent for sent in sentences if sent.strip() and not PROCESS_MARKER_RE.search(sent)]
    if len(kept) == len(sentences):
        out = "".join(sentences)
    else:
        out = " ".join(sent.strip() for sent in kept if sent.strip())
    out = re.sub(r"[ \t]{2,}", " ", out)
    out = re.sub(r"\s+([.,;:])", r"\1", out)
    out = re.sub(r"^[\s;,:-]+", "", out).strip()
    if not re.search(r"[A-Za-z0-9]", out):
        return ""
    return out


# ---------------------------------------------------------------------------
# Field-path walker — "a.b", "a[].b", "a" — the small vocabulary proposal.md's
# own field table needs, nothing more.
# ---------------------------------------------------------------------------
def walk_and_strip(record, path, counters, key, would_empty, record_id=None):
    """Applies strip_process_sentences to every string leaf `path` names on
    `record`, in place. Returns True if anything on this record changed.

    NEVER blanks a field: if the stripped result would be empty but the
    original value was not, the field is left UNCHANGED and the hit is
    counted in `would_empty` instead — a whole-field marker hit needs a
    curator's read (is there really nothing else to keep, or does the
    marker regex need a narrower carve-out for this one row), not a
    silent deletion. Found necessary empirically before this script was
    trusted to write anything: 304 of 4342 live frontier.first_seen_in
    values (a REQUIRED field — registry-validate.mjs's own presence
    check) are entirely one workshop citation with nothing else to keep;
    silently blanking those would have turned a content-quality fix into
    a fresh batch of gate failures. See findings.md's dry-run counts for
    the full per-field would-empty tally."""
    segs = path.split(".")
    changed = [False]

    # segs like ["tenures[]", "note"] -> iterate tenures[], then set .note on each item
    def walk(obj, i):
        if obj is None or i >= len(segs):
            return
        seg = segs[i]
        if seg.endswith("[]"):
            name = seg[:-2]
            for item in obj.get(name) or []:
                walk(item, i + 1)
        elif i == len(segs) - 1:
            val = obj.get(seg)
            if isinstance(val, str) and val:
                new = strip_process_sentences(val)
                if new == val:
                    return
                if new == "":
                    would_empty[key] = would_empty.get(key, 0) + 1
                    return
                obj[seg] = new
                changed[0] = True
        else:
            nxt = obj.get(seg)
            if isinstance(nxt, dict):
                walk(nxt, i + 1)

    walk(record, 0)
    if changed[0]:
        counters[key] = counters.get(key, 0) + 1
    return changed[0]


def detect_indent(text, default=2):
    # 2026-10-03 (GTT-PASS2-LANDPREP, hook c28): the file's own indent is its SECOND line (the first nested line). The first
    # `\n<spaces>"` of a list-of-objects shard is a key line one level deeper, so every write doubled the indent (rush-2002 64).
    m = re.match(r"[\[{][ \t]*\n( +)\S", text)
    return len(m.group(1)) if m else default


def rewrite_json_file(path, obj, orig_text, dry):
    indent = detect_indent(orig_text)
    new_text = json.dumps(obj, indent=indent, ensure_ascii=False) + "\n"
    if new_text == orig_text:
        return False
    if not dry:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_text)
    return True


# ---------------------------------------------------------------------------
# SHARD TYPES — data/shards/<promo-or-_unassigned>/<type>.json, bare arrays.
# ---------------------------------------------------------------------------
SHARD_FIELD_SPECS = {
    "characters": ["caption", "notes", "tenures[].note"],
    "units": ["caption", "notes", "tenures[].note"],
    "titles": ["epitaph", "notes", "events[].note"],
    "awards": ["epitaph", "notes", "bestowals[].vote_detail"],
    "reigns": ["note", "conflict.note"],
}

# ---------------------------------------------------------------------------
# MONOLITH TYPES (never sharded, per shard-lib.mjs's own SHARD_TYPES list) —
# data/<type>.json, and the top-level array key each one wraps its rows in
# (frontier.json is the one shape with no type-named wrapper — its rows live
# directly under "rows").
# ---------------------------------------------------------------------------
MONOLITH_FIELD_SPECS = {
    "affiliations": ("affiliations", ["note", "status_note"]),
    "memorials": ("memorials", ["note", "gallery[].caption"]),
    "collections": ("collections", ["blurb", "note"]),
    "frontier": ("rows", ["first_seen_in", "community_presence[].hub"]),
}

counters = {}  # "type.field" -> records changed
would_empty = {}  # "type.field" -> records left UNCHANGED because stripping would blank them
files_written = 0
files_unchanged = 0
report_lines = []

# --- shards ---
shard_dirs = sorted(
    d for d in glob.glob(f"{DATA}/shards/*") if os.path.isdir(d) and os.path.basename(d) != "_headers"
)
for shard_dir in shard_dirs:
    for shard_type, fields in SHARD_FIELD_SPECS.items():
        path = os.path.join(shard_dir, f"{shard_type}.json")
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            orig_text = f.read()
        try:
            rows = json.loads(orig_text)
        except json.JSONDecodeError as e:
            report_lines.append(f"SKIPPED (does not parse): {path}: {e}")
            continue
        if not isinstance(rows, list):
            report_lines.append(f"SKIPPED (not a bare array): {path}")
            continue
        any_changed = False
        for row in rows:
            if not isinstance(row, dict):
                continue
            for field in fields:
                key = f"{shard_type}.{field}"
                if walk_and_strip(row, field, counters, key, would_empty, row.get("id")):
                    any_changed = True
        if any_changed:
            if rewrite_json_file(path, rows, orig_text, dry):
                files_written += 1
            else:
                files_unchanged += 1

# --- monoliths ---
for mono_type, (wrap_key, fields) in MONOLITH_FIELD_SPECS.items():
    path = os.path.join(DATA, f"{mono_type}.json")
    if not os.path.exists(path):
        continue
    with open(path, encoding="utf-8") as f:
        orig_text = f.read()
    try:
        obj = json.loads(orig_text)
    except json.JSONDecodeError as e:
        report_lines.append(f"SKIPPED (does not parse): {path}: {e}")
        continue
    rows = obj.get(wrap_key)
    if not isinstance(rows, list):
        report_lines.append(f"SKIPPED ({path} has no \"{wrap_key}\" array)")
        continue
    any_changed = False
    for row in rows:
        if not isinstance(row, dict):
            continue
        for field in fields:
            key = f"{mono_type}.{field}"
            if walk_and_strip(row, field, counters, key, would_empty, row.get("id")):
                any_changed = True
    if any_changed:
        if rewrite_json_file(path, obj, orig_text, dry):
            files_written += 1
        else:
            files_unchanged += 1

# ---------------------------------------------------------------------------
total = sum(counters.values())
total_would_empty = sum(would_empty.values())
print(f"fix-served-prose: {total} record(s) changed across {len(counters)} field(s), "
      f"{files_written} file(s) {'would be ' if dry else ''}written" + (" (dry)" if dry else ""))
for key in sorted(counters):
    print(f"  {key}: {counters[key]} record(s)")
if would_empty:
    print(f"\n  {total_would_empty} record(s) left UNCHANGED — stripping would have blanked the field "
          "entirely (needs a curator's read, not a script's guess):")
    for key in sorted(would_empty):
        print(f"    {key}: {would_empty[key]} record(s)")
for line in report_lines:
    print(f"  {line}")
