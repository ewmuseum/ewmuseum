#!/usr/bin/env python3
"""apply-essays-append.py <essays-append*.json> [--check] — the Essays register's applier (hook c108, 2026-10-07).

CURATION.md v129 (#essays-reopened; the Janitor's D142 and D169, 2026-10-01) reopened Essays to outside, human-written
work: a published article about e-wrestling, or a paper. A row is `status` "linked" (a live article: its own address and
the date it was last found live; nothing of it is copied) or "served" (a dead one, or a paper with no other home: the
full text, served on /essays/<id>.html, which scripts/cross-reference.mjs renders from the row). data/essays.json had no
applier: this is the smallest one, the memorial register's (apply-memorials-append.py) shape.

  * Every row is judged first; ONE bad row refuses the whole file (exit 1, nothing written, no APPLIED stamp), so a row
    the gate would red never lands. The judgement is the row shape docs/SCHEMA.md gives and registry-validate.mjs's v129
    block enforces at the gate (the gate stays the authority; this is the landing guard).
  * A NEW id is appended whole. A row whose id is already on file and reads the same is left alone (idempotent). A row
    whose id is on file and reads differently is REFUSED: changing an essay already listed (a live article whose site has
    died becoming a served one, say) is a correction, made by hand on a ruling, never by an append.
  * `served_since` is stamped with today's date on a served row that does not carry one, as documents rows carry theirs;
    the comparison above ignores a stamp the delta row never had.
  * --check judges and prints PROBLEM lines (rc 1 if any), writing nothing.
A linked row carries `checked` or `not_checked` (the reason we could not check; hook c112, D428 default 3), never both.
The window writes <file>.APPLIED beside the file on rc 0. Written in the file's own indent (2)."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import datetime, json, re, sys

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
CHECK = "--check" in sys.argv
if len(ARGS) != 1:
    sys.exit("usage: apply-essays-append.py <essays-append*.json> [--check]")
P = ARGS[0]
M = f"{_ROOT}/data/essays.json"
COLL = f"{_ROOT}/data/collections.json"

ALLOWED = {"id", "type", "status", "shelf", "title", "byline", "form", "venue", "published", "written", "url", "checked",
           "page", "text", "html", "collection", "sources", "served_since", "language", "not_checked", "linked"}
# hook c253 (the GAVELS ruling log, the Janitor's two 2026-10-10 chat rows): `about` (the parts of the hobby a piece discusses,
# on the wings' own axes) and a fourth status, "wing" (an essay already served inside a wing; its row points at that page).
# On its own line so hook c251's edit of the literal above and this one install in either order.
ALLOWED |= {"about"}
# hook c142 (CURATION.md v130, #museum-own-essays): a third status, "own" — the museum's own writing, by the Janitor or
# Argyle under their own name, its body the `html` they wrote. Every row is shelved by what it is (v130(c)). These are the
# same shapes scripts/registry-validate.mjs's 6c2 block holds a row to at the gate; the gate stays the authority.
# hook c279 (the Janitor, chat 2026-10-11): a fifth shelf, "reviews", for a piece whose main purpose is to evaluate a
# specific game or product. Kept in step with registry-validate.mjs's own ESSAY_SHELF.
SHELVES = {"museum", "academic", "journalism", "community", "reviews"}
OWN_TAGS = {"p", "a", "i", "em", "strong", "br"}
TAG_RE = re.compile(r"</?([a-zA-Z][a-zA-Z0-9]*)\b")
ANCHOR_RE = re.compile(r"<a\b([^>]*)>")
HREF_RE = re.compile(r"\bhref\s*=\s*\"([^\"]*)\"")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# hook c253: the `about` vocabularies are registry-validate.mjs's own promotions enums, read out of that file (never a list
# of ours); data/documents.json's pages are read only when a "wing" row is judged.
_ABOUT, _DOC_PAGES = None, None


def _about_axes():
    global _ABOUT
    if _ABOUT is None:
        t = open(f"{_ROOT}/scripts/registry-validate.mjs", encoding="utf-8").read()
        _ABOUT = {}
        for axis, name in (("medium", "MEDIUM_VALUES"), ("form", "FORM_VALUES"), ("play", "PLAY_VALUES"), ("authorship", "AUTHORSHIP_VALUES")):
            m = re.search(r"^const " + name + r" = new Set\(\[([^\]]*)\]\)", t, re.M)
            if not m:
                sys.exit(f"essays: REFUSED; {name} not found in scripts/registry-validate.mjs, so `about` cannot be judged; nothing written")
            _ABOUT[axis] = set(re.findall(r'"([^"]+)"', m.group(1)))
    return _ABOUT


def _doc_pages():
    global _DOC_PAGES
    if _DOC_PAGES is None:
        dj = json.load(open(f"{_ROOT}/data/documents.json", encoding="utf-8"))
        rows = dj if isinstance(dj, list) else dj.get("documents", [])
        _DOC_PAGES = {x.get("page") for x in rows if isinstance(x, dict) and x.get("page")}
    return _DOC_PAGES


def problems_of(r, coll_ids):
    out = []
    if not isinstance(r, dict):
        return ["a row that is not an object"]
    rid = r.get("id")
    at = f"row {rid!r}"
    if not isinstance(rid, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", rid):
        out.append(f"{at}: id must be a lowercase slug")
    for k in sorted(set(r) - ALLOWED):
        out.append(f"{at}: field {k!r} is not one the v129 row shape names")
    if r.get("type") != "essay":
        out.append(f"{at}: type must be \"essay\"")
    st = r.get("status")
    if st not in ("linked", "served", "own", "wing"):
        out.append(f"{at}: status must be \"linked\", \"served\", \"own\" or \"wing\"")
    if r.get("shelf") not in SHELVES:
        out.append(f"{at}: shelf must be one of {'|'.join(sorted(SHELVES))} (CURATION.md v130(c))")
    for k in ("title", "byline", "venue"):
        if not isinstance(r.get(k), str) or not r[k].strip():
            out.append(f"{at}: needs a non-empty {k!r}")
    # hook c259 (the GAVELS ruling log, the Janitor's 2026-10-10 chat row (c)): a podcast episode or video ("audio", "video")
    # is linked from the Essays page, never served, so those two forms are a linked row's only.
    media = ("audio", "video")
    forms = ("article", "paper", "essay") if st == "own" else ("article", "paper") + media if st == "linked" else ("article", "paper")
    if r.get("form") in media and st != "linked":
        out.append(f"{at}: form {r.get('form')!r} is linked from the Essays page, never served: status must be \"linked\"")
    elif r.get("form") not in forms:
        out.append(f"{at}: form must be one of {', '.join(forms)}")
    pub = r.get("published")
    if not isinstance(pub, dict) or "date" not in pub or pub.get("precision") not in ("exact", "month", "year", "unknown"):
        out.append(f"{at}: published must be {{date, precision}} (precision exact|month|year|unknown)")
    elif pub.get("precision") == "exact" and not DAY.match(str(pub.get("date"))):
        out.append(f"{at}: an exact published date is YYYY-MM-DD")
    if r.get("written") is not None and not re.fullmatch(r"\d{4}(-\d{2}(-\d{2})?)?", str(r.get("written"))):
        out.append(f"{at}: written is YYYY, YYYY-MM or YYYY-MM-DD")
    if not isinstance(r.get("language"), str) or not re.fullmatch(r"[a-z]{2,3}", r["language"]):
        out.append(f"{at}: needs a language code (en, fr, ...)")
    ab = r.get("about")  # hook c253: the parts of the hobby, on the wings' axes; "unknown" never (leave the axis out)
    if ab is not None:
        axes = _about_axes()
        if not isinstance(ab, dict) or not ab:
            out.append(f"{at}: about is {{medium?, form?, play?, authorship?}}, at least one axis, each a non-empty list")
        else:
            for axis, vals in ab.items():
                if axis not in axes:
                    out.append(f"{at}: about.{axis} is not a wing axis (medium|form|play|authorship)")
                elif not isinstance(vals, list) or not vals:
                    out.append(f"{at}: about.{axis} is a non-empty list")
                else:
                    if len(set(map(str, vals))) != len(vals):
                        out.append(f"{at}: about.{axis} names a value twice")
                    for v in vals:
                        if not isinstance(v, str) or v == "unknown" or v not in axes[axis]:
                            out.append(f"{at}: about.{axis} {v!r} is not one of {'|'.join(sorted(axes[axis] - {'unknown'}))}")
    url = r.get("url")
    if url is not None and (not isinstance(url, str) or not re.match(r"^https?://", url)):
        out.append(f"{at}: url must be an http(s) address")
    if st == "linked":
        if not url:
            out.append(f"{at}: a linked essay needs the article's own url")
        elif re.search(r"(^|[/.])ewmuseum\.(org|com)(/|$)", url.split("://", 1)[-1].split("?", 1)[0], re.I):
            out.append(f"{at}: a linked essay links out, never to a museum-hosted address")
        # hook c112 (the Janitor's D428 default 3): `checked` OR `not_checked` (the reason we could not check), never both
        nc = r.get("not_checked")
        if nc is not None:
            if not isinstance(nc, str) or not nc.strip():
                out.append(f"{at}: not_checked is a non-empty string, the reason we could not check")
            if r.get("checked") is not None:
                out.append(f"{at}: a linked essay carries checked or not_checked, never both")
        elif not DAY.match(str(r.get("checked") or "")):
            out.append(f"{at}: a linked essay needs checked (YYYY-MM-DD, the day its address was last found live), unless it carries not_checked")
        for k in ("page", "text", "collection", "sources", "served_since"):
            if r.get(k) is not None:
                out.append(f"{at}: a linked essay is never copied (v129(b)); {k!r} belongs to a served row only")
    elif st == "own":
        if r.get("page") != f"/essays/{rid}.html":
            out.append(f"{at}: a museum-own essay's page is /essays/<id>.html")
        body = r.get("html")
        if not isinstance(body, str) or not body.strip():
            out.append(f"{at}: a museum-own essay needs its own \"html\" body (v130(a))")
        else:
            for t in TAG_RE.findall(body):
                if t.lower() not in OWN_TAGS:
                    out.append(f"{at}: html carries <{t}> — a museum-own essay's body is {', '.join(sorted(OWN_TAGS))} only (it is rendered unescaped)")
            for a in ANCHOR_RE.findall(body):
                h = HREF_RE.search(a)
                if not h:
                    out.append(f"{at}: html carries an <a> with no href")
                elif not re.match(r"^(https?://|/)", h.group(1)):
                    out.append(f"{at}: html's link {h.group(1)!r} is neither an http(s) address nor site-relative")
        for k in ("text", "collection", "sources", "served_since", "url", "checked", "not_checked"):
            if r.get(k) is not None:
                out.append(f"{at}: a museum-own essay is the museum's own writing (v130); {k!r} belongs to an outside piece")
    elif st == "wing":
        # hook c253: an essay already served inside a wing; `page` is that wing document's own page, nothing is copied
        pg = r.get("page")
        if not isinstance(pg, str) or not pg.startswith("/") or pg.startswith("/essays/"):
            out.append(f"{at}: an essay served in a wing points at the wing document's own page, never /essays/")
        elif pg not in _doc_pages():
            out.append(f"{at}: page {pg!r} is not a served document (no data/documents.json row carries it)")
        elif not _os.path.isfile(_ROOT + pg):
            out.append(f"{at}: page {pg!r} is not on disk")
        for k in ("text", "html", "collection", "sources", "served_since", "url", "checked", "not_checked"):
            if r.get(k) is not None:
                out.append(f"{at}: an essay served in a wing is not copied; {k!r} belongs to another status")
    elif st == "served":
        if r.get("page") != f"/essays/{rid}.html":
            out.append(f"{at}: a served essay's page is /essays/<id>.html")
        if not isinstance(r.get("text"), str) or not r["text"].strip():
            out.append(f"{at}: a served essay needs its full text")
        if r.get("collection") not in coll_ids:
            out.append(f"{at}: collection {r.get('collection')!r} is not an accession lot in data/collections.json")
        src = r.get("sources")
        if not isinstance(src, list) or not src:
            out.append(f"{at}: a served essay needs sources[] (where our copy came from)")
        else:
            for i, s in enumerate(src):
                if not isinstance(s, dict) or not isinstance(s.get("kind"), str) or not s["kind"]:
                    out.append(f"{at}: sources[{i}] needs a kind")
                elif s.get("url") is not None and not re.match(r"^https?://", str(s["url"])):
                    out.append(f"{at}: sources[{i}].url must be an http(s) address")
        if r.get("served_since") is not None and not DAY.match(str(r["served_since"])):
            out.append(f"{at}: served_since is YYYY-MM-DD")
        if r.get("checked") is not None:
            out.append(f"{at}: checked belongs to a linked row only")
        if r.get("not_checked") is not None:
            out.append(f"{at}: not_checked belongs to a linked row only")
    return out


def same(cur, new):
    if cur == new:
        return True
    if "served_since" in cur and "served_since" not in new:
        c = dict(cur); c.pop("served_since")
        return c == new
    return False


d = json.load(open(M, encoding="utf-8"))
rows = d["essays"]
by = {r.get("id"): r for r in rows if isinstance(r, dict)}
cj = json.load(open(COLL, encoding="utf-8"))
coll_rows = cj if isinstance(cj, list) else next((v for k, v in cj.items() if isinstance(v, list)), [])
coll_ids = {c.get("id") for c in coll_rows if isinstance(c, dict)}

new = json.load(open(P, encoding="utf-8"))
new = new if isinstance(new, list) else new.get("essays", [new])
probs, seen = [], set()
for r in new:
    probs += problems_of(r, coll_ids)
    rid = r.get("id") if isinstance(r, dict) else None
    if rid in seen:
        probs.append(f"row {rid!r}: twice in the file")
    seen.add(rid)
    if rid in by and not same(by[rid], r):
        probs.append(f"row {rid!r}: already on file and reads differently; a change to a listed essay is a correction "
                     "made by hand on a ruling, never an append")
if probs:
    for p in probs:
        print("PROBLEM: " + p)
    print(f"essays: REFUSED, {len(probs)} problem(s) in {_os.path.basename(P)}; nothing written")
    sys.exit(1)
added = [r for r in new if r["id"] not in by]
if CHECK:
    print(f"ESSAYS {len(added)} to add, {len(new) - len(added)} already on file ({_os.path.basename(P)}; --check, nothing written)")
    sys.exit(0)
today = datetime.date.today().isoformat()
for r in added:
    r = dict(r)
    if r["status"] == "served" and not r.get("served_since"):
        r["served_since"] = today
    rows.append(r)
if added:
    tmp = M + ".tmp"
    open(tmp, "w", encoding="utf-8").write(json.dumps(d, ensure_ascii=False, indent=2) + "\n")
    _os.replace(tmp, M)
print(f"essays: {len(added)} added, {len(new) - len(added)} already on file ({_os.path.basename(P)})")
