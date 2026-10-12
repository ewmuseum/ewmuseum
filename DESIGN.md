---
name: THE E-WRESTLING MUSEUM
description: A museum of fantasy wrestling, built one collection at a time.
colors:
  arena-dark: "#141210"
  apron-dark: "#1b1815"
  ring-apron: "#221e1a"
  blackout: "#0f0d0b"
  program-paper: "#e9e2d4"
  faded-program: "#c3b9a6"
  spotlight-paper: "#f3ecdd"
  cheap-seats: "#938a7b"
  ring-rope: "#332d25"
  top-rope: "#453d31"
  belt-gold: "#c8a24b"
  champions-gold: "#e2c273"
  retired-gold: "#a2833e"
  turnbuckle-rust: "#c67149"
  green-room: "#4a9c6d"
typography:
  display:
    fontFamily: "Georgia, \"Iowan Old Style\", \"Palatino Linotype\", Palatino, serif"
    fontSize: "clamp(30px, 6vw, 46px)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.01em"
  headline:
    fontFamily: "Georgia, \"Iowan Old Style\", \"Palatino Linotype\", Palatino, serif"
    fontSize: "clamp(22px, 4vw, 28px)"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "Georgia, \"Iowan Old Style\", \"Palatino Linotype\", Palatino, serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.2
  lede:
    fontFamily: "Georgia, \"Iowan Old Style\", \"Palatino Linotype\", Palatino, serif"
    fontSize: "20px"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "Georgia, \"Iowan Old Style\", \"Palatino Linotype\", Palatino, serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "0.002em"
  body-row:
    fontFamily: "Georgia, \"Iowan Old Style\", \"Palatino Linotype\", Palatino, serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: "Georgia, \"Iowan Old Style\", \"Palatino Linotype\", Palatino, serif"
    fontSize: "14px"
    fontWeight: 400
  label:
    fontFamily: "\"IBM Plex Mono\", ui-monospace, \"SF Mono\", \"Cascadia Mono\", Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "0.1em"
  label-sm:
    fontFamily: "\"IBM Plex Mono\", ui-monospace, \"SF Mono\", \"Cascadia Mono\", Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "0.14em"
  wordmark:
    fontFamily: "\"IBM Plex Mono\", ui-monospace, \"SF Mono\", \"Cascadia Mono\", Menlo, Consolas, monospace"
    fontSize: "15px"
    fontWeight: 400
    letterSpacing: "0.34em"
  document:
    fontFamily: "\"IBM Plex Mono\", ui-monospace, \"SF Mono\", \"Cascadia Mono\", Menlo, Consolas, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.75
rounded:
  sm: "3px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "7": "32px"
  "8": "48px"
  "9": "64px"
  "10": "96px"
components:
  placard:
    backgroundColor: "{colors.ring-apron}"
    textColor: "{colors.program-paper}"
    rounded: "{rounded.sm}"
    padding: "20px 24px"
  roster-card:
    backgroundColor: "{colors.ring-apron}"
    textColor: "{colors.program-paper}"
    rounded: "{rounded.sm}"
    padding: "16px 20px"
  document:
    backgroundColor: "{colors.apron-dark}"
    textColor: "{colors.faded-program}"
    typography: "{typography.document}"
    rounded: "{rounded.sm}"
    padding: "24px"
  filter-input:
    backgroundColor: "{colors.apron-dark}"
    textColor: "{colors.program-paper}"
    rounded: "{rounded.sm}"
    padding: "9px 10px"
  chip:
    textColor: "{colors.retired-gold}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
  chip-stamp:
    backgroundColor: "{colors.program-paper}"
    textColor: "{colors.arena-dark}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.pill}"
    padding: "1px 8px"
  link:
    textColor: "{colors.belt-gold}"
  link-hover:
    textColor: "{colors.champions-gold}"
  nav-link:
    textColor: "{colors.cheap-seats}"
    typography: "{typography.label}"
  nav-link-here:
    textColor: "{colors.belt-gold}"
    typography: "{typography.label}"
---

# Design System: THE E-WRESTLING MUSEUM

## Overview

**Creative North Star: "The Lamplit Archive"**

A records room after hours. One warm light falls from above, onto brass fittings and parchment labels; everything else
sits in a warm, deep dark. The museum's job is to hold other people's history carefully, so the design stays out of the
way of the artifacts. The light at the top of every page is literal: a faint brass radial glow from above the masthead
(6% brass, fading by mid-page), the only source of "depth" anywhere on the site. Pages read like placards in a gallery,
never like posters: quiet, labelled, exact.

The system has two registers and keeps them apart. A serif reads (prose, headings, the body of every page), and a
monospace labels (kickers, navigation, table headers, dates, chips, and the verbatim documents themselves, which keep
their source's typewritten feel). Density is generous for reading and tight for rows: one 760px reading column, an
18px body at 1.65, and one shared 16px row size for every list and table on the site.

It is plain CSS in one file, `style.css`, with every value read from tokens on `:root`; no framework, no build step, no
web fonts, and no inline styles anywhere (the validator refuses a `style=` attribute). Tens of thousands of generated pages
inherit the whole look by linking that one file, so the system changes in one place or not at all.

**Key Characteristics:**
- Two themes that follow the visitor's device until they choose: the lamplit dark (warm near-black grounds, parchment
  text, one gold accent family) and a daylight paper theme. A "House lights" switch in the masthead sets either,
  remembered per visitor.
- Two typefaces, two registers: serif to read, mono to label. No third font.
- Flat surfaces; depth is tonal layering, hairlines and a 2px gold left edge.
- One corner radius (3px) for every panel, card, input and chip.
- Brass is the only interactive colour; rust only flags; green only marks AI-written prose.
- Nothing animates.

## Colors

A warm, low-chroma dark palette built from the materials of a venue after the show: the arena's dark, the program's
paper, the belt's gold, a rusted turnbuckle, and one green door for the AI.

### Primary
- **Belt Gold** (#c8a24b, `--brass`): links, the current nav item, timeline dots, the spotlight glow and every
  gold-tinted wash (at 3–8% alpha). The one interactive colour.
- **Champion's Gold** (#e2c273, `--brass-bright`): hover on links, and the current holder's row in a title ledger.
- **Retired Gold** (#a2833e, `--brass-dim`): the quiet gold. Kickers, placard labels, table headers, chip text, the 2px
  left edge on placards, cards, hall doors and blockquotes, and the subtitle line.

### Secondary
- **Turnbuckle Rust** (#c67149, `--rust`): curation flags only. The left edge and label of a `.note` and an
  `.archival-notice` (with a 5–6% rust wash), and the occasional ledger aside. Never decorative.

### Tertiary
- **Green Room** (#4a9c6d, `--ai-green`): the AI-authorship flag and nothing else: the small outlined pill beside
  AI-written captions, epitaphs and dedications. The one green on the site, so it can never read as a curation flag.

### Neutral
- **Arena Dark** (#141210, `--bg`): the page ground.
- **Apron Dark** (#1b1815, `--bg-2`): raised panels: verbatim document blocks, inputs, the dedication block, the 88×31
  button wall.
- **Ring Apron** (#221e1a, `--bg-3`): placards, roster cards, gallery figures.
- **Blackout** (#0f0d0b, `--canvas`): the darkest well, behind images (letterboxing).
- **Program Paper** (#e9e2d4, `--ink`): body text and headings.
- **Faded Program** (#c3b9a6, `--ink-soft`): secondary prose: ledes, list items, document text, emphasis.
- **Spotlight Paper** (#f3ecdd, `--ink-bright`): `strong` and other deliberate emphasis.
- **Cheap Seats** (#938a7b, `--muted`): labels, captions, nav at rest, crumbs, the footer, meta lines.
- **Ring Rope** (#332d25, `--line`): hairlines: rules, row dividers, panel borders.
- **Top Rope** (#453d31, `--line-2`): the stronger hairline: link underlines at rest, table header rules, input and note
  borders.

### House lights up (the light theme)
Until a visitor chooses, the lights follow their device (Auto; with no script, the device decides too). The masthead's
**House lights** switch (Down / Up / Auto, remembered in the visitor's own browser) sets `<html data-theme>` before the
page paints; Up, or a light device unless Down was chosen, swaps only the tokens, so no component is themed twice.
Daylight values:
- **Program Paper by daylight** (#f2ecdf, `--bg`), **the recessed well** (#e9e1d1, `--bg-2`: documents, inputs),
  **card stock** (#f8f4ea, `--bg-3`: placards), letterbox (#d9cfbc, `--canvas`).
- **Ink** (#2a2219), soft (#4b4134), bright (#16110b), **Cheap Seats** (#6b6151); hairlines #d8ceba and #c3b69c.
- **Belt Gold, darkened to read on paper** (#78591a), hover #5c440f, dim #735b22; rust #9c4a24; green #2b7049.
- The washes (spotlight, masthead, chip, rust note) are tokens too, retinted for paper.

**The House Lights Rule.** The visitor's device decides until the visitor does. A theme is a set of token values,
never a second set of component rules, and every text token clears 4.5:1 on every surface it sits on, in both themes.

### Named Rules
**The One Lamp Rule.** Gold is light, and there is one lamp. Belt Gold appears as text, a 1–3px edge or a wash at
10% alpha or less; never as a filled background, except the attestor credit badge.

**The Flag Colours Are Spoken For Rule.** Rust means a curation flag and green means AI-written prose. Neither is ever
used for anything else, and no new hue is introduced: a new component reuses these tokens.

## Typography

**Display Font:** Georgia (with Iowan Old Style, Palatino Linotype, Palatino, serif)
**Body Font:** the same serif stack
**Label/Mono Font:** IBM Plex Mono where the reader has it installed (no web font is loaded), then ui-monospace, SF Mono,
Cascadia Mono, Menlo, Consolas, monospace

**Character:** a book serif that reads like a catalogue entry, paired with a typewriter mono that stamps the labels and
carries the verbatim documents, so the museum's own voice and the artifacts' voices never look alike.

### Hierarchy
- **Display** (600, clamp(30px, 6vw, 46px), 1.2, +0.01em): the one page title. Every page type uses the same bare `h1`.
- **Headline** (600, clamp(22px, 4vw, 28px), 1.2): section heads, ruled underneath with a Ring Rope hairline.
- **Title** (600, 20px, 1.2): sub-sections and card names. The lineage timeline's era names step up to 23px, its one
  documented exception.
- **Lede** (400, 20px, 1.6, Faded Program): the intro paragraph. The **subtitle** (an aka line, a wing's tagline, a
  memorial's years) is the same size, italic, in Retired Gold.
- **Body** (400, 18px, 1.65; 17px under 560px): prose, in a 760px column (about 75 characters).
- **Row** (400, 16px, 1.6): every dense row and table on the site, one size everywhere.
- **Small** (400, 14px): meta prose, notes, inputs.
- **Label** (400, 12px mono, uppercase, +0.1em to +0.28em): kickers, nav, crumbs, table headers, dates. **Label-sm**
  (11px) for placard labels, captions and chips. Labels are always tracked out and almost always uppercase; never body
  copy.
- **Wordmark** (15px mono, uppercase, +0.34em; +0.16em on mobile): the logotype, exempt from both scales.
- **Document** (14px mono, 1.75, pre-wrap; 12px under 560px): served verbatim texts.

### Named Rules
**The Two Registers Rule.** Serif reads, mono labels. Every `font-family` in the stylesheet reads `--font-serif` or
`--font-mono`; there is no third stack and no web font.

**The One Row Size Rule.** Every list row, table cell and roster line uses the 16px row size, so sections sitting side by
side on one page never read as different sizes.

## Layout

One centred reading column (`--maxw` 760px) with 24px side padding and a 96px foot; under 560px the sides drop to 18px
and the foot to 72px. Spacing reads from one scale (4, 8, 12, 16, 20, 24, 32, 48, 64, 96px), while heading margins stay
in ems so they scale with their own text. Grids appear only where the content is a set of like items: the homepage's
category doors and hall indexes (auto-fill, 220px minimum), image galleries (auto-fill, 150px minimum, native-size 88×31
button walls), and the two-house split (two columns, one under 560px). Wide tables sit in a horizontally scrolling wrap
with a 440px minimum, never squeezed. The homepage hero alone is centred; every other page is flush left in the column.

**The Placard Column Rule.** Content lives in the one 760px column. A new page widens nothing; it uses the existing grids
or a scrolling table wrap.

## Elevation & Depth

Flat. The stylesheet has no `box-shadow` anywhere. Depth comes from four tonal steps (Blackout, Arena Dark, Apron Dark,
Ring Apron, darkest to lightest), hairline borders in Ring Rope and Top Rope, a 2–3px gold or rust left edge on panels,
and two light washes: the fixed spotlight glow from above the page (`radial-gradient(120% 60% at 50% -10%, rgba(200,162,75,0.06), transparent 55%)`)
and a 4% gold gradient under the masthead.

**The Lamplit Rule.** Light comes from above and only once. No drop shadows, no glows, no elevation on hover: a hover
changes colour or an edge, never depth.

## Shapes

One radius, 3px (`--radius`), on every panel, card, input, chip, note and document block: gently squared, archival
rather than soft. Two deliberate exceptions: the directory chips on roster rows (years, medium, tier, kind) are full
pills, and the AI flag is a pill. The recurring silhouette is the **left edge**: placards, roster cards, hall doors,
featured list rows and blockquotes carry a 2px Retired Gold bar on the left (3px when featured), notes carry a rust one.
The lineage timeline is the one place a circle appears: an 11px ring in Belt Gold on a vertical Top Rope line.

## Components

### Links
Belt Gold text with a Top Rope hairline underneath; on hover, Champion's Gold with a gold underline. Registry
cross-links (generated by the cross-referencer) use a dotted underline, ambiguous ones dashed, so a reader can tell a
generated link from a hand-cited one.

### Navigation
- **Gallery nav (masthead):** 12px mono, uppercase, +0.1em, Cheap Seats at rest; hover is Program Paper with a gold
  underline; the current page is Belt Gold with a Retired Gold underline. It wraps on small screens.
- **Sub-nav (inside a wing):** the same treatment at 11px, ruled off below with a hairline.
- **Crumbs:** 12px mono uppercase in Cheap Seats; links turn gold on hover.
- **Pager:** prev and next titles ellipsised at 38% width each, between hairlines, with a mono indicator and an
  underlined "random" button; it stacks under 560px.

### Placards
**The museum label.** Ring Apron ground, a Ring Rope border with a 2px Retired Gold left edge, 3px radius, 20px by 24px
padding. A placard label sits on top in 11px mono uppercase (+0.22em) Retired Gold. The `.feature` variant thickens the
edge to 3px. The **dedication** block is its centred cousin on Apron Dark under a 5% gold wash.

### Notes and archival notices
**The curator's flag.** Top Rope border, 2px Turnbuckle Rust left edge, a 5–6% rust wash, 14px text in Faded Program,
headed by a rust mono flag (11px, +0.2em, uppercase). The archival notice is the mono version that precedes a served
document.

### Ledger tables
A full-width, collapsed table at the 16px row size. Headers are 11px mono uppercase Retired Gold over a Top Rope rule,
cells are divided by Ring Rope hairlines, and numbers are tabular in Cheap Seats. The current holder's row turns Belt
Gold, its name Champion's Gold.

### Roster cards and chips
Placard-shaped rows for every index (wings, characters, units): the name as a title, a mono handle line, then facts.
The handle line carries the **directory chips**: pill-shaped, 11px mono, hairline-bordered. Years are the bold one in
Program Paper. Tier and kind are solid stamps (Program Paper fill, Arena Dark text). Medium is Retired Gold. A
language chip is dashed. The general `.chip` (a unit's kind, a relationship's nature) is a 3px-radius tag in Retired
Gold on an 8% gold wash. A one-sentence caption under a row clamps to two lines.

### Documents
**The artifact.** Served verbatim texts sit in a mono block on Apron Dark, 14px at 1.75, `pre-wrap` so the source's own
lines and paragraphs stand, with 24px padding (12px text, 16px padding under 560px). A dated head in mono Retired Gold
sits above it; provenance follows, ruled off.

### Inputs
Filter and search fields: 14px (search 16px) on Apron Dark, Program Paper text, Top Rope border, 3px radius, 9px by
10px padding. Width is the only variant (220px default, 120px small, 360px search, 640px wide search). A collapsed
"fields you can search" help sits under the box in 14px Cheap Seats.

### Hall doors
The homepage's category doors and hall indexes: bordered blocks with the 2px gold left edge, the name in Program Paper
and a count in 11px mono uppercase Retired Gold. Hover turns the edge and the name Belt Gold. A held entry with no page
yet keeps the shape, greys out, and does not hover.

### Flags: AI authorship and attestor credit
**The AI flag:** a small outlined pill in Green Room beside any AI-written prose (12px mono, 85% opacity). Deliberately
quiet, since most captions on the site carry it. Human-written prose carries no marker at all. **The attestor credit** is
its human sibling: the same small shape, filled in Retired Gold, carrying the attestor's own handle.

### The lineage timeline
A vertical Top Rope line with Belt Gold ring markers; each era has mono gold years, a 23px name, an italic muted
sub-line and row-size prose. It is the one place an era name gets marquee treatment.

## Do's and Don'ts

### Do:
- **Do** read every colour, size and space from the `:root` tokens in `style.css`; a new rule names a token, never a
  raw value.
- **Do** add a new component as a class in `style.css` built from existing tokens, and document it in the stylesheet's
  header vocabulary.
- **Do** keep the labels in the mono register: uppercase, tracked out (+0.08em to +0.34em), 11px or 12px.
- **Do** use the 2px Retired Gold left edge for a museum label and the rust left edge for a curator's flag.
- **Do** keep served documents in the mono document block with `pre-wrap`: formatting may be made more readable, the
  words never change.
- **Do** honour `prefers-reduced-motion`; nothing animates, and the stylesheet keeps that promise explicitly.

### Don't:
- **Don't** add a `style=` attribute to any page; the validator fails it.
- **Don't** load a web font or add a third font stack.
- **Don't** add a `box-shadow`, a glow or a hover lift.
- **Don't** introduce a new hue. Rust is only for flags and green is only for the AI flag.
- **Don't** fill a large surface with gold; gold is text, an edge or a wash of 8% or less.
- **Don't** bump the stylesheet's `?v=` query for purely additive rules; a bump re-stamps every page on the site.
- **Don't** theme a component directly; add or retint a token in both theme blocks instead.
