"""merge_hygiene: tidy what a merge's id repoint leaves behind (hook c281, lane MERGE-HYGIENE, 2026-10-11).

The repoint (merge-character.py step 3, merge-batch.py's unit pass, repoint-retired.py) rewrites every whole JSON string equal to a
retired id to its survivor, in place. When BOTH ids of the pair were named in one place, that leaves debris (found by lane
CHAD-DUPREE-MERGE, wave-CHAD-DUPREE-MERGE-1011 holdings/LEADS.tsv rows 1-2):
  1. a SELF-EDGE: a relationship row whose a and b were the two merged ids now reads a == b (the D438 same-handler edge between
     chad-dupree-gxw-2001 and euwc-chad-dupree). No applier removes a relationships row; the registry has no edge-retirement path.
  2. a DUPLICATE ID in a list: memorials.json chad-dupree.characters [euwc-chad-dupree, rob-sampson-cswa, chad-dupree-gxw-2001]
     became [chad-dupree-gxw-2001, rob-sampson-cswa, chad-dupree-gxw-2001]; the same can happen in any id list (unit members,
     appearances sides, involves, references, identity[].with ...).
tidy(before, after) compares the file's text before the repoint with its text after it and, ONLY where the repoint changed something:
  (a) removes a relationship row ({id, a, b, nature} object in a list) whose a and b were different before and are equal now; its id
      is returned for the caller's log;
  (b) in a list the repoint changed, removes each later copy of a value the repoint wrote there, keeping the first occurrence and
      the list's order. Strings are their own value; in a "members" list a member object's value is its character_id, else id,
      else unit_id (merge-batch.py's _mkey; its unit pass keeps the first member of a key and drops the later one, as here).
  (c) nothing else changes: removals are cut out of the TEXT (the element and the separator before it), so the file keeps its own
      layout byte for byte (shards are indent 1, 2 or 4, some with no final newline, some ASCII-escaped). A list or row the repoint
      did not touch is never examined for duplicates or self-edges, and a pre-existing duplicate is left alone.
A file that does not parse (before or after), or whose structure the repoint changed (it never should), is returned unchanged.
"""
import json
import re
from json.decoder import scanstring

_WS = re.compile(r'[ \t\n\r]*')
_NUM = re.compile(r'-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?')


class _N:
    __slots__ = ('k', 's', 'e', 'v', 'c')

    def __init__(self, k, s, e, v=None, c=None):
        self.k, self.s, self.e, self.v, self.c = k, s, e, v, c


def _parse(t):
    """A JSON value tree with character spans: k in obj/arr/str/lit; obj c = [(key, node)], arr c = [node]."""
    def ws(i):
        return _WS.match(t, i).end()

    def val(i):
        ch = t[i]
        if ch == '{':
            s = i; i = ws(i + 1); c = []
            if t[i] == '}': return _N('obj', s, i + 1, c=c), i + 1
            while True:
                if t[i] != '"': raise ValueError('key expected at %d' % i)
                key, i = scanstring(t, i + 1)
                i = ws(i)
                if t[i] != ':': raise ValueError(': expected at %d' % i)
                n, i = val(ws(i + 1)); c.append((key, n)); i = ws(i)
                if t[i] == ',': i = ws(i + 1); continue
                if t[i] == '}': return _N('obj', s, i + 1, c=c), i + 1
                raise ValueError(', or } expected at %d' % i)
        if ch == '[':
            s = i; i = ws(i + 1); c = []
            if t[i] == ']': return _N('arr', s, i + 1, c=c), i + 1
            while True:
                n, i = val(i); c.append(n); i = ws(i)
                if t[i] == ',': i = ws(i + 1); continue
                if t[i] == ']': return _N('arr', s, i + 1, c=c), i + 1
                raise ValueError(', or ] expected at %d' % i)
        if ch == '"':
            v, e = scanstring(t, i + 1)
            return _N('str', i, e, v=v), e
        for lit, v in (('true', True), ('false', False), ('null', None)):
            if t.startswith(lit, i): return _N('lit', i, i + len(lit), v=v), i + len(lit)
        m = _NUM.match(t, i)
        if not m: raise ValueError('value expected at %d' % i)
        return _N('lit', i, m.end(), v=m.group(0)), m.end()

    n, i = val(ws(0))
    if ws(i) != len(t): raise ValueError('trailing data at %d' % i)
    return n


def _child(n, key):
    for k, v in n.c:
        if k == key and v.k == 'str': return v.v
    return None


def _member_key(n):
    if n.k == 'str': return n.v
    if n.k == 'obj': return _child(n, 'character_id') or _child(n, 'id') or _child(n, 'unit_id')
    return None


def _edge(n):
    """(id, a, b) of a relationship row, else None."""
    if n.k != 'obj': return None
    keys = {k for k, _ in n.c}
    if not {'id', 'a', 'b', 'nature'} <= keys: return None
    a, b = _child(n, 'a'), _child(n, 'b')
    if a is None or b is None: return None
    return _child(n, 'id'), a, b


def _same_shape(x, y):
    if x.k != y.k: return False
    if x.k in ('obj', 'arr'): return len(x.c) == len(y.c)
    return True


def tidy(before, after):
    """(text, removed_edge_ids, duplicate_items_removed). text == after when there is nothing to tidy."""
    if before == after: return after, [], 0
    try:
        bt, at = _parse(before), _parse(after)
    except (ValueError, IndexError):
        return after, [], 0
    cuts = []   # (start, end) spans of `after` to delete
    edges = []
    dups = [0]

    def walk(b, a, key):
        if not _same_shape(b, a): return
        if a.k == 'obj':
            for (_, bv), (k, av) in zip(b.c, a.c): walk(bv, av, k)
            return
        if a.k != 'arr' or not a.c: return
        drop = set()
        # (a) self-edges the repoint made
        for j, (be, ae) in enumerate(zip(b.c, a.c)):
            ea, eb = _edge(ae), _edge(be)
            if ea and eb and ea[1] == ea[2] and eb[1] != eb[2]:
                drop.add(j); edges.append(ea[0] or '(no id)')
        # (b) later copies of a value the repoint wrote into this list
        keyf = _member_key if key == 'members' else (lambda n: n.v if n.k == 'str' else None)
        wrote = set()
        for be, ae in zip(b.c, a.c):
            kb, ka = keyf(be), keyf(ae)
            if ka is not None and kb != ka: wrote.add(ka)
        if wrote:
            seen = set()
            for j, ae in enumerate(a.c):
                if j in drop: continue
                ka = keyf(ae)
                if ka is None: continue
                if ka in wrote and ka in seen: drop.add(j); dups[0] += 1
                seen.add(ka)
        for j, (be, ae) in enumerate(zip(b.c, a.c)):
            if j not in drop: walk(be, ae, None)
        if not drop: return
        kept = [j for j in range(len(a.c)) if j not in drop]
        if not kept:
            cuts.append((a.s + 1, a.e - 1)); return
        lead = kept[0]
        if lead > 0: cuts.append((a.c[0].s, a.c[lead].s))
        for j in sorted(drop):
            if j > lead: cuts.append((a.c[j - 1].e, a.c[j].e))

    walk(bt, at, None)
    if not cuts: return after, [], 0
    out = after
    for s, e in sorted(cuts, reverse=True): out = out[:s] + out[e:]
    try:
        json.loads(out)
    except ValueError:
        return after, [], 0
    return out, edges, dups[0]


def summary(edges, dups):
    return 'self-edges removed %d%s, duplicate ids removed %d' % (len(edges), (' [' + ', '.join(edges) + ']') if edges else '', dups)
