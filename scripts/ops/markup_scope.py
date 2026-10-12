"""markup_scope: where on a served page may a redactor write? (hook c80, lane REDACTOR-SCOPE, 2026-10-05)

Gate 258 went red because a logo class name and file name in the stamped chrome line matched a page-scoped deny row, and the
two redactors (redact-gate-hits.py, gate-fail-redact.py) wrote their markers INSIDE the class and href attributes: the logo broke
and every re-check stayed red. A redactor now writes only in page TEXT. Two kinds of place are never written:

  * MARKUP  -- inside a tag: its name, its attributes and their values (<a href="...">, <svg class="...">), a doctype or other
              <!...> / <?...> declaration. A comment is not a tag: its inside stays text, as before.
  * CHROME  -- the regions scripts/stamp-chrome.mjs stamps from templates/chrome.html on every page:
              <!-- chrome:head:start --> ... <!-- chrome:head:end --> and <!-- chrome:footer:start --> ... <!-- chrome:footer:end -->,
              markers included. A start marker with no end protects to the end of the file (fail closed).

A gate hit in either place is never "fixed" by a redactor: the caller reports it as "in markup / in chrome: not redacted -- the
generator must change" and leaves it alone, so the cycle stops visibly instead of corrupting a page. Text between tags outside the
chrome -- including the raw text of <script>, <style>, <textarea> and <title> elements -- is redacted exactly as before.
This narrows only what a redactor TOUCHES; what the privacy check reports is unchanged.

    mask = scope_mask(text)        # bytearray, one byte per character of text: TEXT, MARKUP or CHROME
    kind = span_kind(mask, s, e)   # TEXT when [s, e) is all text, else the strongest protected kind inside it
"""
import re

TEXT, MARKUP, CHROME = 0, 1, 2
KIND_NAME = {MARKUP: "in markup", CHROME: "in chrome"}

CHROME_REGIONS = (("<!-- chrome:head:start -->", "<!-- chrome:head:end -->"),
                  ("<!-- chrome:footer:start -->", "<!-- chrome:footer:end -->"))

# A start or end tag: name, then attributes (bare, or = a quoted or unquoted value), optional self-closing slash. A quoted value
# may hold '>' and newlines, as browsers allow. Anything that does not parse as a tag is text (a lone '<' in prose).
_TAG_RE = re.compile(r"""</?([A-Za-z][A-Za-z0-9:_-]*)(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?|\s*/)*\s*/?>""")
_DECL_RE = re.compile(r"<[!?][^>]*>")          # <!doctype ...>, <![CDATA[ ...>, <?xml ...?>  (comments are handled first)
_RAW = ("script", "style", "textarea", "title", "xmp")   # raw/escapable text: their inside is text, never parsed for tags


def scope_mask(text):
    n = len(text)
    mask = bytearray(n)
    pos = 0
    while True:
        i = text.find("<", pos)
        if i == -1:
            break
        if text.startswith("<!--", i):                  # a comment: its inside is text, as before
            j = text.find("-->", i + 4)
            pos = n if j == -1 else j + 3
            continue
        m = _TAG_RE.match(text, i)
        if m:
            mask[i:m.end()] = b"\x01" * (m.end() - i)
            pos = m.end()
            name = m.group(1).lower()
            if name in _RAW and not text.startswith("</", i) and not m.group(0).endswith("/>"):
                k = re.compile("</" + name, re.I).search(text, pos)   # never text.lower(): it can change offsets
                pos = n if k is None else k.start()
            continue
        m = _DECL_RE.match(text, i)
        if m:
            mask[i:m.end()] = b"\x01" * (m.end() - i)
            pos = m.end()
            continue
        pos = i + 1
    for start, end in CHROME_REGIONS:
        p = 0
        while True:
            a = text.find(start, p)
            if a == -1:
                break
            b = text.find(end, a + len(start))
            b = n if b == -1 else b + len(end)
            mask[a:b] = b"\x02" * (b - a)
            p = b
    return mask


def span_kind(mask, s, e):
    seg = mask[s:e]
    if not seg:
        return TEXT
    return max(seg)


def line_of(text, offset):
    return text.count("\n", 0, offset) + 1
