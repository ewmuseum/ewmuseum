# Contributing to THE E-WRESTLING MUSEUM

> DRAFT — awaiting the Janitor's editing pass before the open.

The museum grows one collection at a time, and every collection arrives
the same way: through a contributor, bringing what their own vantage was
able to recover. That could be you. You don't need to know git, and you
don't need your material to be organized — you need to have been there,
or to hold what someone who was there left behind.

## What a contribution looks like

- **Material**: old hard drives, site exports, forum archives, saved
  shows and roleplays, Wayback links, screenshots, even a folder of
  images. Anything the record left behind.
- **Memory**: names, dates, and corrections. "That fed existed, it was
  called X, it ran 2002–2004, here's who ran it" is a real
  contribution — it becomes a frontier row that a future pass can chase.
- **Corrections**: if the museum states something wrong about a fed you
  were part of, say so. The registry records disagreements between
  sources rather than picking sides, and your firsthand account is a
  source.

## How to contribute

1. **Open an issue** (templates are provided: contribution offer,
   correction, takedown) or reach the curators however you're able.
   Describe what you have — no need to prepare anything.
2. A curator works with you on **consent and scope**: what gets shown,
   what stays sealed, and how you're credited (a handle, a role
   description, or not at all — never a real name unless you ask).
3. The material is accessioned through the museum's own process —
   mined, catalogued, verbatim-served, and cross-referenced. The full
   craft is documented in [docs/PROCESS.md](docs/PROCESS.md); the rules
   that govern it are [CURATION.md](CURATION.md), the museum's
   constitution. The short version of the law: verbatim material is
   never edited, privacy is absolute, nothing is backdated, and honest
   gaps beat invented completeness.

## Ground rules

- **Living feds are collected, never served.** A fed that is still
  running is never served, accessioned or mirrored here. The museum may
  read its public site politely — one request at a time, `robots.txt`
  honored — and keep what it collects in its private workshop, so the
  record already exists when that fed's era ends. Its own material is
  welcome in the museum once that era is over — the door policy. See
  [the dead-only rule](CURATION.md#dead-only-rule).
- **Characters, never people.** Real names appear only on memorial
  pages, for the dead and welcomed, at the asking of people who knew
  them.
- **Anyone with a stake can remove material.** The
  [Takedown & Privacy Policy](CURATION.md#takedown-policy) is honored
  without argument — no burden of proof beyond involvement.
- **Nothing here is for sale, and nothing here trains AI models.** See
  [LICENSE.md](LICENSE.md).

## For maintainers

Maintainer commits are signed — the durable authorship record behind
every change. The pipeline gates every push: `npm run refresh` (build,
cross-reference, stamp, validate) must exit green, and CI re-runs the
same gates. Read CLAUDE.md's invariants before touching anything;
CURATION.md before touching content.
