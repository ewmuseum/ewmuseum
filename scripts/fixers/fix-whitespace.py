#!/usr/bin/env python3
"""Standing fixer (hook c160, 2026-10-08; the Janitor, 2026-09-12: "If we fix something once it needs to persist").
Takes out, before the gate, the two whitespace errors that halt a commit: TRAILING WHITESPACE and a BLANK LINE AT END OF FILE.
The commit hook runs `git diff --cached --check`, preflight runs `git diff --check` (and `--no-index` on every untracked
file); a blank line at the end of a stylesheet cost 40 minutes, a trailing space in a page 47, two hook-written EOF blanks
stopped a preflight. Every hook author had to get this right by hand; now the standing fix does it.

WHERE IT DRAWS THE LINE (each rule is the repo's own, none is invented here):
  1. WHICH FILES. Only files the commit would carry as a CHANGE: tracked files that differ from HEAD (`git diff HEAD`, staged or
     not) and untracked-unignored files (`git ls-files --others --exclude-standard`). A file that is the same as HEAD is never
     read (its content is already committed; git's own stat cache is the "skip unchanged files" test, so the cost is the size of
     the window's change, not of the 128k-file tree). Nothing under .git, node_modules or any ignored path is ever listed.
  2. WHICH LINES. In an untracked file: every line (git would flag every line of it). In a tracked file that differs from HEAD:
     only the lines the change ADDED (the `+` side of `git diff -U0 HEAD`), exactly the lines `git diff --check` can flag. An old
     trailing space in an unchanged line is left alone: that is another commit's whitespace diff, and a trailing space inside a
     script's own string or template literal is its content. (Contrast the gate's `sed` step, which strips the WHOLE of every touched
     .html: it stays, and runs after this.) A blank line at EOF is collapsed only when the change added one.
  3. WHICH PATHS ARE OURS. Whatever `git check-attr whitespace` says is the repo's default (unspecified, or plain `whitespace`).
     A path .gitattributes marks `-whitespace` is exempt from git's check and is a verbatim served artifact: today
     promotions/*/archive/*.html and promotions/*/rp/*.html (CURATION.md #verbatim-serving; CLAUDE.md invariant 4: a served
     document's own bytes are the record), so they are NEVER opened. A path carrying a custom `whitespace=...` setting
     (crawler/*.ics, whitespace=cr-at-eol: the CR is the format) is exempt as well. The list is read from git on every run, so a
     future exemption in .gitattributes is honoured with no edit here. Everything else is ours: CSS, JS, MJS, templates, the
     generated entity/index/list pages, data JSON, docs, ops and script files. Trailing whitespace outside a <pre> or a
     document body of the museum's own pages has no meaning, and the gate already strips it from every touched .html.
  4. WHAT IT NEVER DOES. It never touches a binary file (a NUL in the first 8000 bytes, git's own test), a symlink, a file that is
     only whitespace, or a file whose changed lines end in CR (CRLF is a decision, not a typo: reported, not converted). It never
     adds a final newline, never re-indents (git's "space before tab in indent" is REPORTED, not fixed: which tab width is a
     judgement), never touches a conflict marker, and never edits a file in place: each write is a sibling temp file, the mode
     copied, then os.replace. The change is idempotent; a second run finds nothing to do.

It refuses (exit 1, nothing written) under a running gate or build, like every fixer here. --dry counts and writes nothing.
Honours MUSEUM_ROOT only. Prints ONE summary line, plus at most ten file names for anything it could not fix."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
import re, subprocess, sys, time, shutil

M = _ROOT
DRY = '--dry' in sys.argv
TMP_SUFFIX = '.wsfix-tmp'
SPACE_BEFORE_TAB = re.compile(rb'^[ \t]* \t')


def git(*args, stdin=None):
    return subprocess.run(['git', '-C', M, '-c', 'core.quotePath=false', *args], input=stdin, capture_output=True, check=True).stdout


def unquote(p):
    """A path from a `+++ ` header: git C-quotes it when it holds a quote, backslash or control byte."""
    if not p.startswith(b'"'):
        return p
    body, out, i = p[1:-1], bytearray(), 0
    esc = {b'n': 10, b't': 9, b'r': 13, b'\\': 92, b'"': 34, b'a': 7, b'b': 8, b'f': 12, b'v': 11}
    while i < len(body):
        c = body[i:i + 1]
        if c == b'\\' and i + 1 < len(body):
            n = body[i + 1:i + 2]
            if n in esc:
                out.append(esc[n]); i += 2; continue
            if body[i + 1:i + 4].isdigit():
                out.append(int(body[i + 1:i + 4], 8)); i += 4; continue
        out += c; i += 1
    return bytes(out)


def changed_ranges():
    """{path: set(added 1-based line numbers)} for every tracked file that differs from HEAD (staged or not)."""
    ranges, cur = {}, None
    p = subprocess.Popen(['git', '-C', M, '-c', 'core.quotePath=false', 'diff', '-U0', '--no-renames', '--no-color', '--no-ext-diff', 'HEAD'],
                         stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    for line in p.stdout:
        if line.startswith(b'+++ '):
            name = line[4:].rstrip(b'\n').rstrip(b'\t')
            cur = None if name == b'/dev/null' else unquote(name)[2:]   # drop "b/"
            if cur is not None:
                ranges.setdefault(cur, set())
        elif line.startswith(b'@@ ') and cur is not None:
            m = re.match(rb'@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@', line)
            if m:
                start, cnt = int(m.group(1)), (1 if m.group(2) is None else int(m.group(2)))
                ranges[cur].update(range(start, start + cnt))
    if p.wait() != 0:
        raise RuntimeError('git diff HEAD failed')
    return ranges


def ours(paths):
    """The subset of `paths` whose `whitespace` attribute is git's default; and the count exempted."""
    if not paths:
        return [], 0
    out = git('check-attr', '-z', '--stdin', 'whitespace', stdin=b'\0'.join(paths) + b'\0').split(b'\0')
    keep, exempt = [], 0
    for i in range(0, len(out) - 2, 3):
        if out[i + 2] in (b'unspecified', b'set'):
            keep.append(out[i])
        else:
            exempt += 1
    return keep, exempt


def fix_bytes(data, only):
    """(new bytes or None, trailing-ws lines fixed, eof blanks dropped, cr_skip, space_before_tab). `only` = added line numbers, or None = every line."""
    lines = data.split(b'\n')
    ends_nl = lines[-1] == b''
    if ends_nl:
        lines.pop()
    n = len(lines)
    k = n
    while k > 0 and not lines[k - 1].strip(b' \t\r'):
        k -= 1
    if k == 0:
        return None, 0, 0, 2, 0                                   # a whitespace-only file: left as it is (reported)
    target = lambda i: only is None or (i + 1) in only
    sbt = sum(1 for i in range(n) if target(i) and SPACE_BEFORE_TAB.match(lines[i]))
    if any(target(i) and lines[i].endswith(b'\r') for i in range(n)):
        return None, 0, 0, 1, sbt                                 # CRLF on a changed line: reported, never converted
    out, fixed = list(lines), 0
    for i in range(k):                                            # content lines (a blank line that is dropped below is counted as an EOF blank)
        if target(i):
            s = lines[i].rstrip(b' \t')
            if s != lines[i]:
                out[i] = s; fixed += 1
    eof = 0
    if n > k and any(target(i) for i in range(k, n)):             # the change added a blank line (or more) at EOF
        eof = n - k
        out = out[:k]; ends_nl = True
    if not fixed and not eof:
        return None, 0, 0, 0, sbt
    return b'\n'.join(out) + (b'\n' if ends_nl else b''), fixed, eof, 0, sbt


def write_atomic(path, new):
    tmp = path + TMP_SUFFIX
    try:
        with open(tmp, 'wb') as fh:
            fh.write(new)
        shutil.copymode(path, tmp)
        _os.replace(tmp, path)
    finally:
        if _os.path.exists(tmp):
            _os.unlink(tmp)


def main():
    t0 = time.time()
    if not DRY and _live_running("scripts/gate[.]sh|registry-validate|cross-reference[.]mjs|privacy-check", _ROOT):
        sys.exit("REFUSED: a gate or build is running")
    try:
        top = git('rev-parse', '--show-toplevel').strip()
        git('rev-parse', '--verify', '-q', 'HEAD')
    except (subprocess.CalledProcessError, OSError):
        print('fix-whitespace: not a git work tree with a HEAD; nothing to do')
        return
    if _os.path.realpath(top.decode()) != _os.path.realpath(M):
        print('fix-whitespace: MUSEUM_ROOT is not the top of its git work tree; nothing to do')
        return
    ranges = changed_ranges()
    untracked = [p for p in git('ls-files', '--others', '--exclude-standard', '-z').split(b'\0') if p]
    for p in untracked:
        ranges[p] = None                                            # None = every line
    cand = sorted(ranges)
    keep, exempt = ours(cand)
    scanned = skipped = files_fixed = lines_fixed = eof_dropped = 0
    cr, sbt_files, wsonly, report = [], [], [], []
    for pb in keep:
        path = _os.path.join(M, _os.fsdecode(pb))
        try:
            st = _os.lstat(path)
            if not _os.path.isfile(path) or _os.path.islink(path):
                skipped += 1; continue
            with open(path, 'rb') as fh:
                data = fh.read()
        except OSError:
            skipped += 1; continue
        if b'\0' in data[:8000]:
            skipped += 1; continue                                  # binary: git does not check it, nor do we
        scanned += 1
        only = ranges[pb]
        # fast path: nothing a whitespace check could flag (the common case; no line split, no copy)
        if not (b' \n' in data or b'\t\n' in data or b'\r' in data or b' \t' in data or data.endswith((b' ', b'\t', b'\n\n'))):
            continue
        new, nfix, neof, crskip, sbt = fix_bytes(data, only)
        if crskip == 1:
            cr.append(pb)
        elif crskip == 2:
            wsonly.append(pb)
        if sbt:
            sbt_files.append(pb)
        if new is None or new == data:
            continue
        if not DRY:
            try:
                st2 = _os.lstat(path)
                if (st2.st_mtime_ns, st2.st_size) != (st.st_mtime_ns, st.st_size):
                    skipped += 1; report.append('changed while reading: ' + _os.fsdecode(pb)); continue   # never race a writer
                write_atomic(path, new)
            except OSError as e:
                report.append('write failed: %s (%s)' % (_os.fsdecode(pb), e)); continue
        files_fixed += 1; lines_fixed += nfix; eof_dropped += neof
    print('fix-whitespace: %d candidate(s) (%d changed vs HEAD, %d untracked) | exempt by .gitattributes %d | binary/unreadable %d | read %d | '
          'fixed %d file(s): %d trailing-whitespace line(s), %d EOF blank line(s) | left: %d CRLF, %d space-before-tab, %d whitespace-only | %.1fs%s'
          % (len(cand), len(cand) - len(untracked), len(untracked), exempt, skipped, scanned, files_fixed, lines_fixed, eof_dropped,
             len(cr), len(sbt_files), len(wsonly), time.time() - t0, ' (dry)' if DRY else ''))
    for tag, lst in (('CRLF on a changed line, not converted', cr), ('space before tab in indent, not re-indented', sbt_files), ('whitespace-only file, not emptied', wsonly)):
        if lst:
            print('  %s: %s%s' % (tag, ', '.join(_os.fsdecode(x) for x in lst[:10]), ' ...' if len(lst) > 10 else ''))
    for r in report[:10]:
        print('  ' + r)


if __name__ == '__main__':
    main()
