# SCHEMA — every `data/*.json` shape

> **Vocabulary note (THE PROMOTIONS-PATH WAVE, 2026-08-22):** "wing" in
> this document means *a promotion's own page section* — the term
> survives in marker ids (`wingcaption`, `winghousestyle`, ...) and in
> older passages below. The served path is `promotions/<id>/` (the
> `wings/` directory and the `wing` field are retired; the field is
> `page` now). Read "wing" as "promotion page" throughout.


Every file, field by field, with one honest real example row. This is the
practical companion to `CURATION.md`'s registry rule — read
that first for *why* the shapes are what they are; this doc is just
*what* they are.

**File-shape convention.** Every file (SCHEMA-HARDENING WAVE) carries a
top-level `_schema_version`. Array-shaped data is wrapped as
`{ _schema_version, <key>: [...] }`; `frontier.json` keeps its own extra
header fields (`_dead_only_rule`, `_status_values`) alongside its own
`rows` array. `scripts/registry-validate.mjs`'s `loadArray()` and
`js/list.js`'s `MuseumList.fetchJSON()` both unwrap either shape
transparently — find the sole non-`_`-prefixed array-valued key.

**The governing design principle — the graph and the bounded prose
surface.** The Janitor, on why every shape in this document is enforced
as mechanically as it is: *"the only way to scale this is to be as
systematic as possible. Everything we can reduced to simple and
repeatable edges and nodes. Common structure enforced everywhere. That's
what prevents me from having to hand review thousands of pages."* Every
`data/*.json` file is the GRAPH — structural facts (a tenure, a reign, an
affiliation, a memorial's own linked characters) mechanically rendered
from data the validators enforce, never hand-typed HTML repeated per
page. Set against it, deliberately small and named: the BOUNDED PROSE
SURFACE — epitaphs, captions, storyline recaps, notices, memorial pages —
the only hand-written, Janitor-reviewed layer, and the one place a
sentence is judged on its own merits rather than its shape. The test for
any new fact this registry needs to hold: **if it can be an edge, it's an
edge.** A fact that connects two nodes (two promotions, an entity and a
promotion, a memorial and a character) belongs in a typed, validated edge
— not a paragraph that happens to mention both — because an edge is
free to render everywhere it's true (a wing page, a search facet, a
backlink list) the moment it's added once, where a paragraph is one
sentence, in one place, that has to be found and updated by hand every
time the fact changes. THE LINEAGE-EDGES WAVE (2026-08-19) is the
worked example this principle produced directly: a promotion's own
predecessor/successor history used to live in a bespoke `lineage` field
found nowhere else in the schema; it's an ordinary `affiliations.json`
edge now, exactly like every other inter-promotion fact, because lineage
was never actually different in kind from an alliance or an ownership
stake — it only looked different because it had its own field instead of
the graph's own general mechanism.

**IDs are labels, not claims.** A slug is minted at a moment in time, with
whatever the record knew at that moment — a show date, a promotion
qualifier, a best guess at what a generic ring name would collide with
later. When a fact the slug embedded turns out wrong, or incomplete, or
superseded, **the slug is never renamed to match the correction.**
`uwf-thc` doesn't become `uwf-hardcore-championship` because that reads
better; a wrongly-dated `some-show-1999` doesn't get quietly renamed to
`some-show-2000` the day someone finds the real date. Two mechanisms
carry the weight a rename would otherwise be tempted to do: **fields
carry truth** — the record's actual, current, correctable belief about a
fact lives in a normal field (`won.date`, `full_name`, a `note`), never
in the spelling of an id — so correcting a fact is an ordinary edit, not
an identity change; and **`data/aliases.json` handles identity** — the
one and only escape hatch, for the rarer case where a slug itself turns
out to have been minted wrong in a way that actually matters (a collision
surfaces, a clean slug needs qualifying). An id that turns out to embed a
minting-time guess is not a bug to fix; it's a fact about *when* the
record was made, the same way a museum accession number never gets
renumbered just because a later curator learns more about the object.

**Why slugs, not numbers — the settled rationale.** This repository bets
that it stays human-legible without tooling for decades — the same bet
`CURATION.md`'s verbatim-serving rule makes by keeping everything plain
HTML with no build step. A numeric id (`char_00482`) is opaque without a
lookup table; a slug (`seymour-almasy`) is legible in a raw `grep`, a git
diff, a broken link report, or a stranger's first read of the JSON with
no tooling running at all — closer to a museum's own accession number
with a mnemonic folded in than to a database primary key. The cost of
that bet is real and named, not hidden: a slug can rot into a
factually-wrong-sounding label (a qualifier that turns out to be
imprecise, a year that turns out to be a guess) in a way an opaque number
never could. That cost is bounded by three standing disciplines working
together, not by hoping it doesn't happen: slugs are **never renamed**
once minted (above), **`data/aliases.json`** carries any id forward that
genuinely must change, and **generic names are qualified at mint**
(`CURATION.md`'s registry rule) so the highest-collision-risk case is
handled before it ever becomes a problem instead of after. Written for
whoever is still maintaining this repository in 2040: the slugs will, by
then, contain some small guesses that aged badly. That is the bet's
known price, already paid for on purpose — read the field, not the id,
for the current truth.

## Table of contents

- [Sharding](#sharding)
- [promotions.json](#promotionsjson)
- [characters.json / units.json](#charactersjson--unitsjson)
- [titles.json / reigns.json](#titlesjson--reignsjson)
- [shows.json](#showsjson)
- [rps.json / rp-catalog.json](#rpsjson--rp-catalogjson)
- [affiliations.json](#affiliationsjson)
- [frontier.json](#frontierjson)
- [collections.json](#collectionsjson)
- [relationships.json / awards.json / inductions.json](#relationshipsjson--awardsjson--inductionsjson)
- [memorials.json / essays.json](#memorialsjson--essaysjson)
- [links_out[] (the holder's-own-site link-out)](#links_out-the-holders-own-site-link-out)
- [external-figures.json / aliases.json / review-queue.json](#external-figuresjson--aliasesjson--review-queuejson)
- [style-families.json](#style-familiesjson)
- [promotion-style-families.json](#promotion-style-familiesjson)
- [wanted.json / characters-index.json / matches-index.json / site-config.json](#wantedjson--characters-indexjson--matches-indexjson--site-configjson)

---

## Sharding

THE SHARDING MIGRATION (2026-08-19/20, the Janitor's gavel: *"Let's shard now
and run parallel extraction campaigns. It's time."*) — the trigger written
into the project's own scale plan at roughly 4,900 registry rows, to unblock
a five-to-seven-agent parallel-writer fleet with disjoint file sets. Every
`data/*.json` shape documented below is unchanged; this section documents
where each type's rows now physically LIVE, which is a storage-layout fact,
never a data-meaning one.

**Shards are the source of truth; monoliths are built artifacts.** Seven
promotion-scoped types — `characters`, `units`, `shows`, `rps`, `reigns`,
`titles`, `awards` — moved from one `data/<type>.json` file each to
`data/shards/<promotion-id>/<type>.json`, one bare JSON array per
(promotion, type) pair, no `_schema_version` wrapper (that lives once per
type in `data/shards/_headers/<type>.json` instead — hand-maintained, since
it changes far less often than any single row). `npm run build:data`
(`scripts/build-data.mjs`) concatenates every promotion's shard for a type,
stable-sorts the result, and writes the familiar `data/<type>.json` —
**every consumer of that file (client-side JS fetches, `cross-reference.mjs`,
the stampers, both validators) keeps reading it exactly as documented
below, unchanged.** `data/<type>.json` is a generated artifact from this
point on, the same relationship `characters/`/`titles/`/`collections/` already
have to the registry — don't hand-edit it; edit the shard and rebuild.

**The assignment rule** (`scripts/shard-lib.mjs`'s `shardOf()` — the one
function every script that cares shares, so the rule can never drift
between the script that assigns and the script that checks):

- `shows.json` / `rps.json` / `titles.json` / `awards.json` rows carry
  their own `promotion` field directly — the shard IS that field's value.
  An `rps.json` row with no `promotion` (the Janitor's D407, "(A) on the
  hub") shards on its `venue`, the community hub it was posted on
  (`promotion ?? venue ?? _unassigned`), and moves to its federation's shard
  when `promotion` is added (`fix-shard-assignment.py`), its `served_url`
  unchanged.
- `characters.json` / `units.json` rows shard on **`tenures[0].promotion`**
  — the FIRST tenure listed on the row, array-order-0, never a "which fed
  matters more" judgment call. A multi-tenure entity's row is **not**
  duplicated or split across shards — the whole row lives in one shard,
  unchanged, exactly like every other entity. A character with no tenures
  at all (a frontier-linked entity with no held promotion to shard on —
  four rows on file as of this migration, each carrying a `notes` field
  explaining why) goes to the reserved **`_unassigned`** pseudo-shard
  instead of forcing a guess.
- `reigns.json` rows carry no `promotion` field at all — never did. The
  shard is a **join**: `reign.title` looked up against `titles.json`'s own
  `promotion`. This is a lookup at build/migrate time only, never a new
  stored field — the reign row itself is written to its shard completely
  unchanged.
- `rp-catalog.json` is **NOT sharded.** Surveyed at migration time, 1,162
  of its 2,105 rows (55%) are `held: false` catalog entries with no
  `promotion` field, no `rps_id`/`show_id` to join through (the mechanism
  that resolves a `held: true` row's promotion), and no reliably
  domain-bearing `url` to infer one from (most `url` values on file are
  relative paths — `insider-viewer.php?rpid=1253` — not full URLs).
  Sharding it would mean inventing a fact the record doesn't currently
  hold, which the migration's own design principle forbids. It stays a
  cross-promotion monolithic source (below) until a future wave adds a
  real `promotion` field to every row — a schema change, not a storage
  migration.

**Deterministic concatenation.** `build-data.mjs` reads every shard
regardless of directory-listing order and then stable-sorts the combined
rows — by `id` for six of the seven types. **`reigns.json` is the one
exception: it sorts by `title` instead.** Reign ids mix two minting
schemes across the corpus's own history (a `<title>-rNNN` running counter
for one wave, a `<title>-<label>-<year>` slug for another) and don't
reproduce chronological order on a plain string sort — caught live during
migration: `napw-world-evan-cartwright-2006` id-sorts *before*
`napw-world-r001` despite winning the belt over a year later.
`registry-validate.mjs`'s own "dates run backwards" check depends on a
title's reigns staying array-adjacent in `won`-date order, so `reigns`
sorts on `title` (stable, grouping each belt's own reigns back together
while preserving their existing chronological order within the group).
See `scripts/shard-lib.mjs`'s `comparatorFor()`.

**Cross-promotion files stay monolithic sources** — low-conflict,
append-mostly, no single promotion owns a row: `relationships.json`,
`affiliations.json`, `review-queue.json`, `frontier.json`,
`memorials.json`, `collections.json`, `aliases.json`,
`external-figures.json`, `style-families.json`,
`promotion-style-families.json`, `stipulation-families.json`,
`promotions.json` itself, `rp-catalog.json` (see above), and
`wanted.json`/`characters-index.json` (already generated, untouched by this
migration). Edit these directly, exactly as documented in their own
sections below.

**Validation** (`scripts/registry-validate.mjs`, full detail in the
script's own comments): shard integrity (every row's id unique across a
type's shards), shard-assignment enforcement (every row filed under
`data/shards/<dir>/<type>.json` actually resolves to `<dir>` via the same
rule above), and rebuild-diff freshness (`data/<type>.json` on disk must
be byte-identical to what `build-data.mjs` would produce right now) — all
three hard fails, the same "gates catch drift mechanically, never by
eyeballing output" posture every other check in this repo uses.

**Pipeline order**: `build:data` runs FIRST, before `refresh:links`,
`chrome`, or `stats` — a shard edit has to become the monolith before
`cross-reference.mjs` (which reads the monolith) has anything new to
regenerate from. See `CLAUDE.md`'s invariants and `docs/PROCESS.md`'s
parallel-writer protocol for the full sequencing and the fleet's own
working discipline.

---

## `promotions.json`

One row per held promotion (12 today). Required: `id`, `name`, `band`,
`visibility`, and — THE PAGE SKELETON doctrine (`docs/PROCESS.md`'s Prose section:
"same skeleton at every scale is the right design") — `caption`, the exact
same one-hand-drafted-sentence requirement `characters.json`/`units.json`
already carry (hard fail if missing; soft warns for reading as more than
one sentence). `visibility` must be `"gated"` (nothing is public yet — the
field exists for the day that changes, per promotion). **Does not** carry
a bare `collection` field (dropped in the accession-lots correction —
provenance lives in `sources[]` instead, since a promotion routinely spans
several accession lots).

**`caption`** / **`caption_asof`** — same shape and same living-prose
discipline as the character/unit fields documented below, evidence-mapped
to a promotion's own analogues: `{wrestlers, shows, rps, awards}` (a
character/unit tenure count here, `shows.json`/`rps.json` rows naming this
promotion, `awards.json` rows) in place of the six character/unit counts.
`registry-validate.mjs` recomputes all four live and soft-warns on a 2+
drift, same non-blocking spirit. Rendered by
`scripts/stamp-promotion-headers.mjs` as a `.lede` paragraph directly after the
wing's own placard (`<!-- wingcaption:start/end -->`), per the skeleton:
name -> subtitle -> placard -> caption -> sections.

**`caption_en`** / **`caption_en_author`** (THE ECOSYSTEM EXPANSION GAVEL,
2026-09-05, step 2; `CURATION.md` v112(c), `#caption-en`) — the museum's own
label sentence written for an English reader, beside a `caption` written in
the scene's language. Optional, and legal ONLY on a row whose `language` is
set and is not `en`; REQUIRED on every such row that carries a `caption` at
all. It is a SECOND ORIGINAL, never a translation of the `caption` and never a
translation of a served document (the one bounded English rendering of a
document is the bridge page, v111(e)). `caption_en_author` is `"ai"` or
`"human"` on exactly `caption_asof.author`'s terms and absence means `"ai"`;
the `AI` badge renders off it wherever the sibling renders. There is no
`caption_en_asof` — both sentences make the same claims, and `caption_asof`'s
own evidence counts cover the pair. `registry-validate.mjs` carries all four
checks; the same two fields are legal on `characters.json`/`units.json` rows,
where legality is read off the languages of the wings the entity worked in.

**`qualifier`** and `full_name` being a NAME ONLY are documented just below
under "Other fields."

Controlled-but-soft fields (unrecognized values soft-warn, never hard-fail
— the vocabulary is expected to grow):

- `depth`: `deeply documented` · `documented` · `partially recovered` ·
  `a single surviving document` · `in preparation` · `documented on its
  own terms`
- `medium` (PLATFORM ONLY, the Janitor's gavel of 2026-09-10 — "where the promotion lived", nothing else): `newsgroup` · `website` · `forum` · `bbs` · `fidonet` · `email` · `mail` · `online-service` · `chat` · `wiki` · `virtual-world` · `video` · `audio` · `social-media` · `game` · `in-person` · `other` · `unknown`. The earlier compound values were decomposed on that date (website-efed → website, forum-efed → forum, bbs-efed → bbs, wiki-efed → wiki, fidonet-echo → fidonet, usenet → newsgroup, email-list and play-by-email → email, play-by-mail → mail, tabletop-rpg → in-person + form tabletop, figure-fed → video + form figures, discord-efed → chat, reddit- and facebook-group-efed → social-media, game-efed → game + form avatars); `interfed-alliance` and `community-hub` are `type` values and never media. The main-vehicle test still decides between platforms (a wiki beside a real site is `website`; the wiki as the booking surface is `wiki`). `media[]` keeps the plural shape for a promotion that moved.
- `form` (the Janitor's gavel of 2026-09-10 — what the canon physically IS, orthogonal to medium, play and authorship): `text` (written cards, roleplays and results — every Usenet, forum, website, e-mail and BBS fed) · `figures` (action figures performed on video) · `avatars` (performed inside a virtual world or a video game) · `tabletop` (a tabletop game played out, documented on audio, video or text) · `sim` (a booking simulator's output narrated by its player) · `other` · `unknown`. Set from the promotion's own record; text is by construction for every written-substrate fed.
- `scale` (the fed's own self-presented kayfabe scope, not a real-world
  size judgment — graded like a fact, subject to the staging-over-speech
  rule, see `docs/PROCESS.md`'s Prose section): `bingo-hall` · `local` · `regional` ·
  `national` · `global` · `unknown`. If `scale` is set, `scale_source`
  (a string explaining what in the record justifies it) is expected too.
- `type` (THE TYPE-AXIS GAVEL, the Janitor, 2026-09-05 — "both medium and
  type"): what the entity IS, orthogonal to `medium` (the platform it ran
  on). `federation` (books its own roster and cards — the default kind) ·
  `community-hub` (a newsgroup, portal, directory or hosting hub held as a
  wing: RSPWF and RSPW are `type: community-hub` with `medium: usenet`;
  Scoops and Titan Zone with `medium: website-efed`; the Prodigy WRESTLING BB
  with `medium: online-service`) · `interfed-alliance` (a structure over
  separately-run member feds, never itself a fed: PTC, UWOW, AOWF, ICBINR
  with `medium: website-efed`; the Summit of E-Wrestling, LEW, WIC and the
  two WIWAs with `medium: usenet`) · `tournament` (THE INDEPENDENT
  TOURNAMENT, the Janitor, 2026-09-24; `CURATION.md` v118 — an
  independent interfederation tournament: it stages a tournament across
  federations it does not own and carries no roster of its own, the
  Chris Williams Memorial Cup being the founding case, with `type_note`
  carrying the longer phrase "independent interfederation tournament") ·
  `academy` (THE TRAINING ACADEMY, the Janitor, 2026-09-24;
  `CURATION.md` v120 — a school whose subject is the hobby's own craft:
  it teaches and GRADES the writing against a published rubric, sits its
  students in classes, runs a card for them to be graded on, and sends
  its graduates to federations it does not own. The Primetime Wrestling
  Academy is the founding case, in its own words *"an ewrestling school
  and not an efed"*, with `type_note` carrying the longer phrase).
  Required on every row. The former medium
  values `community-hub`, `interfed-alliance` and `house-network` are
  RETIRED by this gavel — they named a kind, not a platform — and the
  validator warns on any row still carrying one.
  **A `tournament` wing carries no title and no reign** (v118(b)): nobody
  holds or defends the trophy between stagings, so its roll of winners is
  ONE `awards.json` award entity with one bestowal per staging (the
  `faw-joe-smallze-memorial-cup` / `ewo-aj-epic-memorial-cup` shape, one
  axis up), and each staging the tournament itself ran is an ordinary
  `shows.json` row on its own wing — a staging that survives only as a
  segment inside a member fed's card stays that fed's show and is
  referenced, never copied (the canonical-copy rule). A belt a
  FEDERATION named after the same person is that federation's title and
  files to that federation's wing (the PWW-era Chris Williams Television
  Title → `pww-worldwide-1999`). `registry-validate.mjs` soft-warns a
  title or reign filed to a `tournament` wing.
  **An `academy` wing, by contrast, carries titles and reigns like any
  federation** (v120(c)): it runs a standing roster week to week, so the
  tournament soft-warn above is deliberately NOT extended to it, and an
  academy whose record shows no belt simply carries no title row. Its
  graded cards are ordinary `shows.json` rows on its own wing — but a
  stated CADENCE is not a receipt, so no `collected: false` row is ever
  written from "one card a week" (v120(b)). Its students carry ordinary
  tenures; a name appearing only on a graduates list is served inside
  that list and never minted from it, and a held character joins an
  academy only on a receipt clearing the v104 bar (v120(d)). The
  academy-to-federation relation is `affiliations.json`'s own long-landed
  `academy` nature, unchanged. `house_style` is still owed by a Tier 2+
  academy — the hub/community exemption is for institutions that stage
  nothing, and an academy stages its own card.
- `type_note` (THE ECOSYSTEM EXPANSION GAVEL, the Janitor, 2026-09-05;
  `CURATION.md` v111(f)): optional free text, no enum — what a single `type`
  value cannot say, for the fed that is genuinely two things at once (the
  figure-fed anchor that is a federation and its scene's hub in the same
  breath). `type` stays required and stays exactly one value; a second stored
  type would make every filter, chip and placard ask which one was meant. It
  trails the type on the wing placard after an em-dash, the way
  `medium_detail` trails `medium`, and its presence is a second reason for
  the Type row to render at all (a plain `federation` otherwise renders none).
- `language` / `country` (THE ECOSYSTEM EXPANSION GAVEL, 2026-09-05;
  `CURATION.md` v111(c)): optional. `language` is a BCP-47 tag
  (`language[-Script][-REGION]`: `pl`, `de`, `ko`, `pt-BR`, `zh-Hans`) and
  ABSENT MEANS `en`; `country` is an ISO 3166-1 alpha-2 code in upper case
  (`PL`, `DE`, `KR`) with NO default and no `unknown`. Plural siblings
  `languages[]` / `countries[]` take the `media[]`/`plays[]` entry shape. See
  the paragraph below.
- `discipline`: `pro-wrestling` (the default) · `mma` · `mixed` · `other`
  — see the paragraph below.
- `play`: `competitive-rp` · `strat` (the Janitor, 2026-08-26 — a submitted written match strategy judged for a verdict, distinct from judged roleplay) · `angled` · `generated` · `hybrid` ·
  `unknown` — see the paragraph below.
- `roster_policy`: `real` · `fantasy` · `blended` — see the paragraph
  below. There is deliberately no `unknown`; absent means undetermined.
- `portrays`: `{figure, grade, source}` (or an array of that shape) naming a
  `real-promotion` row of `external-figures.json` — see the paragraph below.
  Absent means not determined.

  **Era vocabulary (2026-08-26, the Janitor's correction):** "pre-web" is
  reserved for material that literally predates the public web (~1993).
  Usenet, the BBSes, and the online services are distinguished by KIND of
  network, not period — usenet is the open internet's non-web discussion
  layer and ran beside the web for decades (RSPWF's whole life is web-era
  usenet); BBSes were dial-up boards mostly off the internet entirely; the
  online services were proprietary walled gardens that dissolved into ISPs
  by ~1997. The umbrella for that early stratum, where one is needed, is
  "the dial-up and walled-garden era." Prose should prefer the per-
  substrate `medium` terms; the hobby's own era map tracks the internet's
  conventional generations almost one-to-one, which is why this registry
  keeps accidentally writing network history.

**`authorship`** / **`authorship_grade`** / **`authorship_source`** (the Janitor's gavel, 2026-09-10 — who WRITES the canon, orthogonal to `medium` (where it lived) and `play` (how outcomes were decided)): `open-fed` (handlers sign up and write for their own characters; a booker compiles) · `single-author` (one person writes or performs the whole promotion — a forum or blog booking, a Total Extreme Wrestling diary, a one-person figure fed) · `troupe` (a small closed cast produces it together, nobody signs up from outside — a tabletop-game group and its podcast, a figure-fed crew, a Second Life company) · `vote-league` (an author stages the cards and the audience decides by ballot) · `unknown`. Same posture as `play`: never guessed, set only where the promotion's own record states it, absent means undetermined; a set value carries its grade and its source. `authorships[]` takes the `media[]`/`plays[]` plural shape for a promotion that changed form over its life. Draft and the ecosystem tests: the workshop's schema-amendment-authorship-2026-09-10.md.

**`discipline`** (the Janitor's ruling, 2026-08-23: *"Agreed with the
sport/discipline marker"*) — WHAT SPORT the promotion staged, and nothing
else. It is orthogonal to `medium` (how the promotion was played — a
website, a forum, a dial-up service) and to `style_family` (what kind of
booking its house style reads as): a website e-fed staging cage fights and
a website e-fed staging pro wrestling share a `medium` and differ here,
which is exactly the distinction neither of the other two fields could
express. Controlled-but-soft like `medium`: `pro-wrestling` is the DEFAULT
and **may be omitted entirely** — an absent `discipline` means
pro-wrestling, and the overwhelming majority of rows correctly carry no
field at all; `mma`, `mixed` (a promotion genuinely staging both) and
`other` are the deliberate values. Where the field IS set, an optional
`discipline_source` carries the receipt in the same shape
`scale_source`/`house_style_source` already use. Seeded once: `tf`
(TRAUMA:fighting), `mma` — its own Concept page frames the roster against
"UFC, PRIDE or any other fight organization" and stages every fight inside
a steel cage (`promotions/tf/archive/concept-2003.html`). Rendered on the
promotion placard ONLY when the value is not pro-wrestling
(`scripts/stamp-promotion-headers.mjs`, `<!-- wingdiscipline:start/end -->`)
— the default sport is not a fact worth a row on every promotion in the
collection.

**`play`** / **`play_grade`** / **`play_source`** / **`play_detail`** (the
Janitor's ruling, 2026-08-23) — HOW OUTCOMES WERE DECIDED, the other half
of the question `medium` only ever answered halfway. Shaped exactly like
`house_style`: `play` is the controlled value, `play_grade` the evidence
grade (`primary-source` · `user-attested` · `presumed`), `play_source` the
receipt, and an optional free-text `play_detail` for a promotion whose own
answer isn't uniform (a split by conference, a rule that changed mid-run).
The vocabulary:

- **`competitive-rp`** — judged roleplays decide who wins.
- **`angled`** — outcomes are booked collaboratively; the writing serves
  the story rather than competing for a verdict.
- **`generated`** — a dice roll, a simulator, or another random/derived
  engine decides.
- **`hybrid`** — genuinely more than one of the above at once.
- **`unknown`** — the record doesn't say. Absence means the same thing;
  the explicit value records that the question was actually checked and
  came back empty (`tf` carries it on exactly that basis).

**The naming receipt.** The vocabulary's two poles are not this project's
coinage — they are the hobby's own, and the clearest surviving statement of
the distinction is DEFIANCE Wrestling's own public "This is DEFIANCE" page
(defiancewrestling.com/ThisIsDEFIANCE, read once for cartography on
2026-08-23; DEFIANCE is a LIVING promotion and is NEVER served,
accessioned, or mined beyond that reading — see `CURATION.md`'s
dead-only rule and its v75 rider): *"The main difference between DEFIANCE
(and other angled groups) versus standard, competitive roleplay (RP)
efeds… Angled… is a collaborative experience where telling the best story
with one or more partners is the primary objective."* The same distinction
is propagated in-period inside this collection's own sources — NFW's own
Season 2 About page asks an applicant outright, "Would you rather
participate in a RP-based, or Angle-based environment?"
(`promotions/nfw/archive/about-new-frontier-wrestling-season-2-site.html`)
— so the field names a real, contemporaneous category, not a retrospective
one.

**Never guessed.** `play` is set ONLY where a promotion's own record states
it; every other promotion leaves it unset, and an unset field is not a gap
to be filled by reading the corpus's vibe. `registry-validate.mjs`
soft-warns an unrecognized value (same posture as `medium`) and HARD-fails
a `play` that is set to anything other than `unknown` with no `play_grade`
beside it. Rendered on the placard where set
(`<!-- wingplay:start/end -->`), `play_detail` appended after an em-dash the
same way `medium_detail` already trails `medium`. Three rows carry it
today: `nfw` (`hybrid`, primary-source — its Season 2 split its own two
conferences, one "completely RP-based," the other "hybrid-based"), `uwa`
(`generated`, primary-source — the Prodigy Wrestling BB's own league
register of 9 July 1997 lists it as a generated-roleplay league), and `tf`
(`unknown` — its served Concept page, origin serial and results document
were all read, and none of them says how a fight was decided).

**`media[]`** / **`plays[]` — THE PLURAL-MEDIUM SHAPE** (the Janitor's
gavel, 2026-08-26, verbatim: *"why should we [chain] promotions to one
medium? If they operated under multiple mediums we should just document all
of them. Same with play."*). Two OPTIONAL arrays that sit BESIDE `medium`
and `play`, never instead of them. The occasion is the CSWA, whose own
accession digest raised the shape and declined to invent it: one federation
that ran twenty-six years across four venues — dice and paper in a back room
from March 1988, the PRODIGY online service from 1992, its own web site at
fantasywrestling.com from March 1998, and that site's own board, renamed
fwrestling.com, from 2002 to the end — and whose `medium` could only ever be
"the least-wrong single value."

**PRIMARY PLUS ARRAY, not full replacement**, and the reasoning is worth
recording because the other design was genuinely available. Full replacement
— `media[]` alone, with `medium` DERIVED from it exactly as `founded`/
`closed` are derived from `runs[]` — is what the CSWA digest itself
proposed, and it has the tidier invariant. It was rejected on three of this
schema's own precedents:

1. **`runs[]` derives because dates have a mechanical first and last;
   media do not.** `founded` = `runs[0].founded` is a rule a script can
   check because runs are ordered in time and the envelope is arithmetic.
   Which of four venues is a fed's most-characteristic one is a CURATION
   CALL — sixteen of CSWA's twenty-six years at a web address, and almost
   the whole surviving record from it — and this schema does not let a
   script make curation calls (see `runs[]`'s own rule 5).
2. **The scalar is load-bearing across every instrument.**
   `promotions.html` pushes `medium` into a card sub; `stamp-promotion-
   headers.mjs` renders the placard's `Medium:` row; `HOUSE_STYLE_EXEMPT_
   MEDIA` and the frontier's own `medium` read it; `js/query.js` makes
   `medium:website-efed` a filter. A derived scalar keeps all of that
   working, but at the cost of making the one field everything reads the
   only field nobody may edit — for a gain of nothing, since the value
   would be identical either way.
3. **The two fields answer two different questions, and both are real.**
   The scalar answers *which venue was this fed's main vehicle* — the
   Janitor's own main-vehicle test of 2026-08-25, which is what `wiki-efed`
   was minted around. The array answers *what did this fed operate under*.
   OBW is the case that proves they must both exist: the main-vehicle test
   put OBW at `website-efed` and its wiki at "supplement, not vehicle," and
   the array records the wiki anyway, without reopening the ruling.

**Entry shape** — `{ medium, era?, note? }` in `media[]`, `{ play, era?,
note? }` in `plays[]`. The value key is the SAME NAME the scalar uses,
following `runs[]`, whose entries likewise reuse the parent field names
`founded`/`closed` rather than a generic `value`. That is not cosmetic:
`js/query.js`'s `flattenFields()` folds an array-of-objects' own keys up
UNPREFIXED, so keying on `medium` makes `medium:online-service` find CSWA
through its PRODIGY era, and `play:angled` find every fed whose `hybrid`
contains an angled half — for free, with nothing hand-wired on any page.
`era` is optional free text for the span or era label ("1992–1998",
"Season 2 — the West Conference"), at whatever precision the receipt
actually supports and **never invented**: a wing whose record names venues
without dating them simply omits it. `note` is optional free text carrying
the receipt in prose, the job `medium_detail` has always done.

**THE BAR FOR A SECOND ENTRY, stated once so a later sweep doesn't flood
the registry**: a `media[]` entry names an address the promotion MADE ITS
OWN — a home it ran from, or relocated to. It is not a place the fed merely
posted its output into, and not a message board, chat room or wiki bolted
onto a website e-fed, which is that website e-fed's own furniture (the
platform-is-the-address doctrine names ONE address). The receipted negative
is EMWA's, in the wing's own words: *"the newsgroup is where it was talked
about, not where it was played"* — which is why GDWA, a GeoCities fed that
posted its cards to rec.sport.pro-wrestling.fantasy, carries no `media[]`,
and why WMW's two AIM rooms and EWF's AIM room are not a `chat` medium.
GCWF is the other worked negative: its door game is not a second medium,
because CURATION.md v81 defines `bbs-efed` as *"message-base play, often
with a door game as its engine"* — both halves are the same BBS.

**`plays[]` and the word "hybrid".** `hybrid` is defined above as "genuinely
more than one of the above at once" — it is the SUMMARY of a multi-entry
`plays[]`, not a member of it, and this is the one place the two arrays'
rules differ. `registry-validate.mjs` HARD-fails a scalar `medium` that
doesn't appear among its own `media[]` entries (the primary is always one of
them); for `plays[]` it only soft-warns, and only when the scalar is neither
`hybrid` nor one of the entries. So `low` reads `play: "hybrid"` over
`plays: [competitive-rp, angled]` and that is the shape working, not drift.

**Validation** (`registry-validate.mjs`): entry values validate against the
same `MEDIUM_VALUES`/`PLAY_VALUES` the scalars use, with the same soft-warn
posture (the vocabularies are controlled-but-growing); `era`/`note` must be
non-empty strings when present; an unrecognized key soft-warns, the
`tenures[]` posture one level up; a single-entry array soft-warns, since the
plural shape exists to record plurality and one entry says nothing the
scalar didn't. An array with no scalar beside it hard-fails.

**Worked example — CSWA's own four eras**, the natural one, since this is
the row the shape was gaveled over:

```jsonc
"medium": "website-efed",          // the PRIMARY: sixteen of its twenty-six years,
                                   // and the era almost the whole record comes from
"medium_detail": "one value cannot hold this fed's life, and the least-wrong one is the address it kept longest...",
"media": [
  { "medium": "tabletop-rpg",   "era": "March 1988 – 1992",
    "note": "Dice and paper in a back room in Greensboro... A HOME-BREW tabletop game, not the published-system shape this value was minted for (ADW's own World Wide Wrestling) — the nearest existing value, carried here with the difference named rather than the era left off the array." },
  { "medium": "online-service", "era": "1992–1998",
    "note": "The PRODIGY online service's own Sports BB, then its WRESTLING BB... 21 documents served from this era." },
  { "medium": "website-efed",   "era": "March 1998 – 2002",
    "note": "Its own web site at fantasywrestling.com, which grew into a hub for other federations around it. 180 documents served..." },
  { "medium": "forum-efed",     "era": "2002–2014",
    "note": "That hub's board, renamed fwrestling.com, from 2002 to the last card it carded and roleplayed for, 11 January 2014. 34 documents served." }
],
"play": "hybrid",
"plays": [
  { "play": "generated",      "era": "1988 – c. 1998", "note": "dice out of a Dungeons & Dragons Basic Edition set..." },
  { "play": "competitive-rp", "era": "by 1998",        "note": "\"whoever gets the best of it will likely be declared the winner\"" },
  { "play": "angled",         "era": "by 1998",        "note": "\"the front office will look at the emerging and ongoing storyline\"" }
]
```

**`medium_detail` survives; `medium_note` is retired.** `medium_detail` is
still the free-text prose the placard renders after the `Medium:` value
(`stamp-promotion-headers.mjs`), and it stays on every row that has one —
`media[]` is the structured truth, `medium_detail` the sentence a reader
sees, and the redundancy is deliberate rather than a migration left half
done. `medium_note`, an ad-hoc field only ever on `obw` and read by nothing
in the pipeline, is folded into that row's own `media[]` note and gone.

**Where it is applied today** — nine rows, every one of them receipted, none
inferred: `media[]` on `cswa` (four eras), `obw` (site + its roster's wiki)
and `rspwf` (the newsgroup + RSPWF.com, its web face, December 2001 –
February 2006); `plays[]` on `cswa`, `nfw`, `low`, `4ww`, `ccw-cyberspace`,
`xcwf` and `bdw` — every `hybrid` on file whose own receipt names its
constituent halves. The one `hybrid` deliberately left un-split is `chz`,
whose two halves are a judged roleplay and a submitted "strat," a
distinction the `play` vocabulary has no second value for — see
the workshop's `multi-media-schema-2026-08-26.md`.


**`roster_policy`** / **`roster_policy_grade`** /
**`roster_policy_source`** (CURATION.md v78(f), the Janitor, 2026-08-24) —
WHOSE NAMES the fed booked. Early e-wrestling split into REAL feds, whose
rosters were actual WWF/WCW-era wrestlers played by handlers; FANTASY feds,
whose rosters were original characters; and blends. The museum documents
all three honestly, and this is where it records which. Shaped exactly like
`play`: `roster_policy` is the controlled value, `roster_policy_grade` the
evidence grade (`primary-source` · `user-attested` · `presumed`), and
`roster_policy_source` the receipt. Values:

- `real` — the roster is wrestlers taken off television.
- `fantasy` — the roster is the fed's own creations.
- `blended` — both, whether mixed on one roster or split across the fed's
  own life. FAW is the founding case and the second shape: its March–May
  2001 rosters run Bradshaw, Chyna, Trish Stratus, "TTP Lex Luger" and The
  Undertaker beside HaHaKlown and Jon The Bomb, and every FAW roster after
  that summer is original characters only.

**Never guessed, and no `unknown` value exists.** Unlike `play`, which can
honestly say "we read the record and it doesn't say," this field has no
such rung: v78(f)'s own words are *"Absent means not yet determined — never
guessed,"* so ABSENCE carries that meaning and the vocabulary offers no
other way to write it. Most rows correctly carry nothing.
`registry-validate.mjs` HARD-fails an unrecognized value (stricter than
`play`'s soft-warn, because there is no legitimate fourth answer), and
HARD-fails a set `roster_policy` missing either its grade or its source —
also stricter than `scale`'s soft source nudge, on the reasoning that a
roster policy is a claim about what a fed WAS and an unsourced one should
be impossible to write rather than merely discouraged. Filterable on the
wings listing, where `promotions.html` adds a fourth bucket the registry
itself cannot carry: `roster_policy:undetermined` matches every wing with
no value, since the wings nobody has read yet are the work queue and would
otherwise be the one group nobody could ask for. Not rendered on a card
unless it was actually determined.

**`portrays`** (hook c101; the Janitor, desk D400, 2026-10-07: *"(a) a
`portrays` field on the wing's row"*; D406: *"(a) the wing only"*;
`CURATION.md` v128 (c), `#real-promotion-fan-feds`) — WHICH REAL PROMOTION
the fed's fiction depicts, where `roster_policy` says only whose names it
booked. A fan federation of a real promotion (a fan ECW, a WWF simulated on
a board, a diary rebooking the real 1996) carries `{figure, grade, source}`,
or an ARRAY of that shape when its fiction portrays more than one company
(plural is opt-in, the character `portrays` precedent). `figure` is an
`external-figures.json` id of `type: "real-promotion"`; `grade` is the
ladder (`primary-source` · `user-attested` · `presumed`); `source` is the
receipt: the referent test's answer (v103) in the fed's own words, its
self-presentation as that promotion or its recognition of that promotion's
history as its own. It is never written from the fed's name alone.
**Absent means not determined**, and a resemblance is not a portrayal: a fed
that borrows a real company's initials for its own invented roster and its
own belts (`wwe-chaos-division`, `wcotw`) carries no edge, the 4WW Chris
Sanchez reading one level up. **The wing only** (D406): a fan federation's
titles, shows and reigns stay its own rows, and no title row ever carries
`portrays`; its "WWF Championship" is never the real belt and never another
fan federation's. Two fan federations of one real promotion are two wings
and never merge on what they portray (v96, one level up).
`registry-validate.mjs` HARD-fails a `portrays.figure` that does not resolve
or is not a `real-promotion` row, a grade off the ladder, a missing
`source`, the same figure twice on one row, and any title row carrying
`portrays`. **Rendering** (`cross-reference.mjs`): one plain line in the
museum's voice inside the wing's own `<!-- connections:start/end -->`
marker, *"This federation's fiction portrays the WWF."*, linking the figure
page, which lists the wing under **Portrayed by**. Nothing about the real
company is assembled anywhere (v100, v128 (e)).

**`location`** (2026-08-18, THE SEARCHABLE-FACTS WAVE) — optional, free
text, the fed's own STAGED home base (a broadcast dateline, a named venue,
a studio) — staging-sourced only, same discipline as `scale`: never a
real-world guess about where a promoter actually lived, and never invented
where the record simply doesn't name one (most promotions correctly carry
no `location` at all). Receipted in `provenance_notes[]` like any other
graded claim. Joins `scale`/`medium` on the wing's own placard (`Based
in:`, `scripts/stamp-promotion-headers.mjs`) and the mechanical search
flattening on `search.html` (`location:edmonton` finds NAPW).

**`language` / `languages[]` / `country` / `countries[]` — the scene fields**
(THE ECOSYSTEM EXPANSION GAVEL, the Janitor, 2026-09-05: *"Aligned with
everything for the expansion. Gaveled!"*; `CURATION.md` v111(c)). The two
fields the research pile's own best finding — parallel invention of this hobby
in four countries — could not be recorded without.

**`language`** — optional string, a **BCP-47 language tag**:
`language[-Script][-REGION]`, lower-case language subtag, title-case
four-letter script subtag, upper-case two-letter or three-digit region
subtag. `en`, `de`, `it`, `pl`, `ko`, `pt-BR`, `zh-Hans` are the shapes in
play. It records **the language the promotion conducted itself in** — the
language of its cards, its roleplays, its board, its own voice — not the
language of the museum's writing about it, and not the language of a document
that happens to quote English.

**`country`** — optional string, **ISO 3166-1 alpha-2, upper case** (`PL`,
`DE`, `IT`, `KR`, `BR`). It records **the real-world country of the community
that ran the promotion**. It is emphatically NOT `location`, which is the
fed's own STAGED home base and stays exactly what it is. A row may
legitimately carry both, and they may disagree — a Polish fed billing itself
from Texas is the normal case, not an error. The placard label is `Community
in:`, deliberately not `Based in:`, which is `location`'s.

**`languages[]` / `countries[]`** — optional arrays, entry shape
`{language|country, era?, note?}`: the exact `media[]`/`plays[]` plural shape,
with the entry key reusing the parent field name so `js/query.js`'s
`flattenFields()` folds it up unprefixed and `language:pl` finds the fed for
free. The scalar stays the PRIMARY every instrument reads; the array records
the plurality. Same bar for a second entry as `media[]`: a language the fed
actually **conducted itself in**, over an era its own record attests — never a
language it was merely discussed in, and never a single English word in a
Polish card.

**ABSENT `language` MEANS `en`, and there is no backfill.** Every row held at
the time of the gavel entered through an English-language corpus — the
RSPW/RSPWF Usenet dumps, the wiki dump, the r/efeds birth registry, the
fwrestling and AOL/Prodigy lines, the Common Crawl census — and so is every
document served beneath them. Writing `"language": "en"` onto all of them
would add hundreds of facts nobody checked individually in order to state one
fact that is true of the set. The precedents are the registry's own:
`frontier.json`'s `medium` (absent means web-era) and `discipline` (absent
means pro-wrestling). Three guards keep the default honest: a validator soft
warn when a row's `country` is outside the Anglophone set and no `language` is
set (the default would be making a claim nobody checked); a required
field pass on every non-English discovery/accession lane's brief; and the fact
that an explicit `"en"` is legal and never warns — an English-language fed
inside a non-English scene writes it **on purpose**, and that is worth
storing even though it equals the default.

**`country` gets NO default, and the asymmetry is deliberate.** The held rows
are English-language by construction, but they are not one country: the
Anglophone scene spans US, CA, GB, AU, IE and more, and the surviving record
usually does not say which. A `country` default of `US` would be exactly the
guess `roster_policy` refuses to let anyone write. So absence means
undetermined, and there is no other way to say it — no `unknown` value.

**Rendering.** A `Language` row on the wing placard, rendered only when
`language` is set and is not `en` (the `discipline` default-renders-nothing
contract), and a `Community in` row rendered whenever `country` is set — both
stamped inside the EXISTING `wingmedium` marker by
`scripts/stamp-promotion-headers.mjs`, so no wing page needs a new marker
bootstrapped onto it by hand (the Type row's own precedent). Values render
through label maps ("Polish", "Poland"), falling back to the raw tag or code.

**`house_style`** / **`house_style_grade`** / **`house_style_source`** /
**`style_family`** (2026-08-18, THE HOUSE-STYLE WAVE — the Janitor's gavel:
house style "belongs on the main promotion page. And should probably be
distilled down into a searchable style, the same way a hundred variations
of hardcore distill down for a wrestler"). `house_style` is one descriptive
sentence-fragment characterizing how a fed actually staged its own booking
— never invented where the corpus doesn't support one (a minority of
promotions correctly carry none, same as `tagline`/`location`); evidence-
graded like any other contested-adjacent claim via `house_style_grade`
(`primary-source` · `user-attested` · `presumed`) and receipted in
`house_style_source` (a string explaining what evidences it — a quoted
pitch document, a contributor's own attestation, or the museum's own read
of the served corpus). Staging-over-speech applies exactly as it does to
`scale`: a character's own in-fiction bravado never determines it, only
what the fed itself actually staged. Rendered on the wing's own placard
(`House style:`, `scripts/stamp-promotion-headers.mjs`, `<!--
winghousestyle:start/end -->`) and mechanically searchable via `js/query.js`'s
`flattenFields()` on `promotions.html`/`search.html` — no page-side code
needed for a new value to become queryable.

`style_family` is a NAVIGATION-ONLY array (`["Comedy", "Angle-Driven"]`,
...) over `house_style`, the exact same finding-aid doctrine as
`style-families.json`'s own per-wrestler grouping (`docs/PROCESS.md`'s Registry section):
a filter convenience, never a claim about the record, and the verbatim
`house_style` string is what ever DISPLAYS — `style_family` only widens
what a search facet matches. Stored directly on the promotion row (rather
than joined client-side at render time) because `promotions.html`/
`search.html` read `data/promotions.json` directly rather than a
server-baked card; the controlled vocabulary and the receipts for why each
promotion carries the families it does live in
`data/promotion-style-families.json`, mirroring `style-families.json`'s own
shape.

Other fields: `full_name`, `years`, `page` (the promotion's own
`/promotions/<id>/` path), `medium_detail` (free text), `media[]`/`plays[]`
(the plural-medium shape, documented above), `quirks[]` (`{text,
source}` — short receipted flavor traits), `provenance_notes[]`
(`{claim, grade, evidence, note?}` — individually graded founding-fact
claims, distinct from `sources[]`), `sources[]` (see below).

**`family`/`lineage`/`family_note` are RETIRED (A7, THE LINEAGE-EDGES
WAVE, 2026-08-19, the Janitor's gavel).** A promotion used to carry a bespoke
`family` label (a lineage-grouping string like `"iwf-line"`), a `lineage`
object (`{predecessors, successors, sisters}` — arrays of other promotion
ids), and a `family_note` (one sentence, rendered into a wing's own
"Connected history" section alongside a matching `essays.json` row keyed
to the same `family` value) — a bespoke, promotion-shaped mechanism doing
exactly what `affiliations.json` (see below) already does for every other
inter-promotion fact. The Janitor, verbatim: *"affiliations should just note
that it was the successor to IWF and the predecessor to the UWF. That's a
much more scalable format."* The whole apparatus is gone — no
`family`/`lineage`/`family_note` field survives on any `promotions.json`
row — replaced by ordinary `affiliations.json` edges carrying the new
`successor-of` nature (`a` = the later promotion, `b` = the earlier one it
continues from; see `affiliations.json` below). Every wing's own
"Connected history" section is retired sitewide along with it; the same
fact now renders as an ordinary "Successor to: X"/"Predecessor to: Y" row
inside the Affiliations section, the same place every other inter-
promotion fact already lives. `essays/iwf-line.html` (the essay the old
mechanism linked from every wing in the line) was de-linked from every
wing and then retired outright (THE ESSAYS RETIREMENT, below, and v49): the
page is gone from the tree, there is no file for it under `essays/` and no
row for it in `data/essays.json`.

**`full_name` is a NAME ONLY, never a name-plus-descriptor (2026-08-18
gavel — caught live: PTC's own `full_name` baked in "(interfed alliance)",
which then self-parenthesized against the wing-header stamper's own
`"Full Name (ACRO)"` format).** **`qualifier`** — optional free text for
exactly the descriptor that used to get baked into `full_name` (PTC's own:
`"interfed alliance"`, since it's a connection-hub, not a fed) — validator-
tolerated, no enum. Never rendered alone; every render that legitimately
wants the descriptor composes it explicitly (`full_name` + `" (" +
qualifier + ")"`, e.g. affiliation-list labels: "Primetime Central
(interfed alliance) (PTC (2002))") rather than finding it pre-baked into
the name. The wing header itself (`scripts/stamp-promotion-headers.mjs`)
deliberately does NOT compose the qualifier in — the h1 stays clean,
`"Primetime Central (PTC)"`.

**`aka[]`** / **`aka_unlinkable[]`** — THE PROMOTION-LEVEL aka (the
Janitor's gavel, 2026-08-23, verbatim: *"Should GWF just be an aka?"* —
yes; `CURATION.md` v78). Optional, a plain array of strings, the exact
same idea `characters.json`/`units.json`'s own `aka[]` carries one level
up: alternate labels the fed ITSELF used — a former name it renamed away
from, an alternate expansion or styling of its own acronym, a former
acronym. Never a nickname the record didn't use, never another fed's name
that happens to be similar, and never a correction — a fed that styled
itself three ways styled itself three ways, and all three are its own.
`registry-validate.mjs` soft-warns an aka that duplicates the row's own
`name` (an aka records a label `name` does not already carry) and HARD-
fails an aka that equals another promotion's own `name` or `aka`, case-
insensitively but exactly — the character mint guard's own collision check
one level up, and `CURATION.md`'s collision doctrine in mechanical form:
two held wings claiming one label is never resolved by picking a winner.
A `name`/`name` collision between two rows is deliberately NOT a failure
(`ewa-extreme` and `ewa-empire` are both "EWA"); the linker already leaves
a shared label unlinked, and the guard is about akas being ADDED.

**`fandom`** — THE FANDOM CROSS-CHECK WAVE (the Janitor's directive,
2026-08-24, the standing intake step in `docs/PROCESS.md`). Optional, a
plain string: the EXACT title of this wing's own article on the
e-wrestling fandom wiki, spelled as the wiki spells it, punctuation and
all (`"Extreme Wrestling Association(EWA)"` is a real one). Never a URL,
never a pre-underscored slug, never a pre-encoded path — the renderers
build the link (`https://ewrestling.fandom.com/wiki/<Title>`, spaces to
underscores, then `encodeURI`), and a hand-encoded title would
double-encode. `registry-validate.mjs` hard-fails a non-string or empty
value and soft-warns when two rows claim one article title, which is an
ADVISORY and not a fault: the wiki covers a character across every fed it
worked, so one article legitimately serves several of our per-fed rows.
**The museum links out; it never serves wiki content.** The wiki is a
secondary, community-authored source — nothing behind this link is a
source for anything on the page carrying it, and the row's own graded
`provenance_notes` and `sources[]` remain the only things the museum
stands behind. The bar for SETTING the field is the cross-check's own: an
exact title match corroborated by the article's own text (era, URLs,
roster names, structure) agreeing with this row, with every rejected
near-match logged — the dump is full of name-twins, and the founding case
(the workshop's `cyberslam-fandom-crosscheck.md`) is the worked example.
Rendered by `scripts/stamp-promotion-headers.mjs` as the placard's
`<!-- wingfandom:start/end -->` row, labelled "Elsewhere"; absent means no
row at all, per the OSW lesson — a wing with no article never says so.

**Linking.** Every aka enters `cross-reference.mjs`'s promotion-mention
auto-linker on exactly the terms `name` already does — same word-boundary
rule, same shared-label ambiguity rule, same caption surface (a promotion
mention is auto-linked in captions; that is the one place the site names a
promotion by bare acronym in free prose). `aka_unlinkable[]` — a subset of
the row's own `aka[]`, every entry required to appear there verbatim — is
the one exception, and it exists because RECORDING a label and ASSERTING
it are different acts: an aka listed there stays in the registry, stays
searchable, and is never turned into a link. Nothing in the display
pipeline reads either field: `stamp-promotion-headers.mjs`,
`stamp-pager.mjs` and `stamp-chrome.mjs` all derive their labels from
`name`/`full_name` alone, so a wing's own h1, subtitle, placard, crumb and
pager keep showing the CURRENT name and only the current name. An aka is a
way IN to a wing, never a second name the wing displays.

Three rows seeded at the gavel, one per shape the field exists for. `gw` —
a genuine RENAME: PTC's own member profile says the fed was *"Bourn as GWF
[Global Wrestling Federation]"* at a UCWF/FWL merger on 25 June 2000
(`promotions/ptc/archive/gw-profile-2002.html`), and PTC's own newsdesk of
14 April 2002 carries GW's own Kwik FX on *"its transition from GWF to GW
over this last month"* (`promotions/ptc/archive/news-2002-04.html`). BOTH
its akas are `aka_unlinkable`, and this is the field's own worked example
of why the sub-field exists: "GWF" is one of the most reused acronyms in
the record (`data/frontier.json` carries a 2006-founded GWF, an unresolved
"GWF (Global Wrestling Federation)" off PCW's Recognition Lineup, and a
2002 GeWA franchise GWF), and the served corpus mentions at least three
GWFs that are not this one — an early UWF bio's GWF that split into the
WWA, a NAPW-orbit GWF World Champion of 2006, a GeWA show-week GWF — so
auto-linking the acronym would silently merge four feds. `dwo` — three
STYLINGS of one name the fed used interchangeably ("Dominant Wrestling
On-Line" through 2002, "Dominant Wrestling Organization" through 2003,
"Dominate Wrestling OnLine" on two 2002 newsdesk pages), all linkable, all
distinctive. `rspwf` — a FORMER SCOPE's labels kept reachable: the wing
re-scoped from RSPWF.com to the newsgroup under v76's rider and its `name`
became "RSPW-F", which silently unlinked every "RSPWF" mention in the
corpus; "RSPWF" and "RSPWF.com" as akas restore them. The future case this
field is built for and hasn't met yet: CyberSlam's own tier-promotion
mechanic renamed its member feds as they moved up (IRWF → RWF, documented
from two preserved nav-widget snapshots) — a hub-wide class of renames
that will want exactly this field the day any of those feds is held.

**`frontier_row`** / **`frontier_rows[]`** / **`frontier_distinct[]`**
— a wing's own ruling on the frontier rows it might be (each entry an
EXACT `frontier.json` row name).
`frontier_row` (one string) and `frontier_rows[]` (the rest, where one wing
fulfils several rows; FRONTIER-RECONCILE, 2026-09-29) say this wing IS that
row: `scripts/fixers/fix-frontier-held-on-promotion.py` then sets the row
`held` (the Janitor's gavel of 2026-09-22, "Frontier promotions should be
retired as we hold them"). `frontier_distinct[]` (hook c88, 2026-10-06) says
the opposite: this wing has been ruled NOT to be that row, and the row
stays open on the served frontier exactly as it was, because it is a
different federation still unheld. Land-check's L-FRONTIER-LAPSE requires
one of the three on a new wing whose `full_name` matches an open row's bare
name (a trailing parenthetical dropped, case-folded), so no like-named row
is left unruled. `frontier_distinct[]` is a non-empty list of strings, never
names a row `frontier_row`/`frontier_rows[]` also names, and is filed beside
an `identity[]` note that gives the evidence in served prose. All three are
machine fields: no renderer reads them and `registry-validate.mjs` does not
reject them. Worked example: `cwf-chaotic` (Chaotic Wrestling Federation,
2003–2007, fwrestling.com) carries `frontier_distinct: ["Chaotic Wrestling
Federation (8 Sep 1999)"]`, the one-post Angelfire federation of 1999.

**`tagline`** — THE HEADER STANDARDIZATION WAVE (2026-08-18): the fed's own
sourced motto/slogan, free text, optional — omitted entirely for the (most
common) case where none survives in the record; never invented to fill the
slot. `scripts/stamp-promotion-headers.mjs` renders it as a `.subtitle` line
(style.css — the same shared component an entity page's own `aka` line
uses) directly under the wing's own `<h1>`, which that same script stamps
as `"Full Name (ACRO)"` from `name`/`full_name` alone (acronym ALONE, no
self-parenthesis, where `full_name` genuinely IS just the acronym) — NO
years in the h1 (HEADER REFINEMENT pass, same day: chronology unwieldied a
compound-era h1, so it moved to its own placard row instead, "Ran: " +
`years` verbatim, patched from a second marker,
`<!-- wingyears:start/end -->`, honest compound forms and all — it's data,
not headline prose). Both markers folded into `npm run chrome`, same
idempotent discipline as chrome/pager/connections — see
`docs/PROCESS.md`'s Cross-referencing section for the one-time migration this replaced (narrative
h1 prose relocated into each wing's own epitaph, never lost).

**`sources[]`** — THE PROVENANCE WAVE: a bibliography of what the
holdings were actually built from, one row per acquisition lot the
promotion draws from:

```jsonc
{
  "kind": "wayback",           // drive | wayback | live-site | yahoo-group
                                // | local-documents | tabletop-notes | cd-archive | wiki-dump | common-crawl
                                // | usenet-post
                                // (usenet-post: the Janitor, 2026-09-20 — holdings
                                // drawn from a newsgroup walk; identifier = the
                                // group and message-ids; the promotion-level twin
                                // of the document kind "newsgroup". 115 rows had
                                // carried it undocumented since the 09-04 grand
                                // accession; the 28 "usenet" spellings fold into it)
                                // (local-documents: the Janitor, 2026-09-20 — a HELD
                                // document not online: the Janitor's own files, a
                                // deposit, a disc read by hand. It is NOT the kind for
                                // holdings lifted off a newsgroup or a web archive;
                                // a source kind answers "what was this actually
                                // lifted off" (v83). Rows that used it for online
                                // recoveries are a bookkeeping tail owed to a data pass)
                                // | common-crawl
                                // (cd-archive: the Janitor, 2026-08-25 —
                                // holdings recovered from archived CD-ROM/disk-
                                // image media; NetNews-on-CD and the shareware
                                // CDs are the founding uses)
                                // (common-crawl: the Janitor, 2026-08-25 —
                                // holdings recovered from the Common Crawl web
                                // archive (a different crawler, a different
                                // index, a different capture mechanism than
                                // Wayback's own — range-request recovery
                                // against a WARC record, not a Wayback
                                // timestamp lookup) rather than from
                                // web.archive.org itself; the fwrestling.com
                                // multi-tenant census is the founding use, for
                                // tenant pages whose own Wayback captures were
                                // unreachable during a paused IA lane but
                                // whose bytes survive in a Common Crawl
                                // snapshot instead
  "identifier": "uwf.org.uk",  // the domain/folder/document, described plainly
  "window": "mined 2026-08-17; the site's own fed-era content runs 31 May – 21 Aug 2002",
  "accession": "0014",         // must resolve to a data/collections.json id
  "digest": "a copy held in the workshop"   // optional; the museum serves this file, so a workshop path is never written here (hook c111 scrubs one to this phrase)
}
```

**Row- and document-level `sources[].kind: "forum"`** (GAVELS 2026-09-23, the Janitor, verbatim: *"We should definitely use the
forum source kind and map the forum accession itself — which is what our discourse board is — to argyle's donation."*). A shows,
rps or documents row structured from the PTC forum cites the post on the museum's own forum, one object per post:
`{"kind": "forum", "url": "https://forum.ewmuseum.org/t/<topic_slug>/<topic_id>/<post_number>", "identifier": "PTC forum, <board>,
post <XenForo post id>", "accession": "0160"}` — lot 0160 is the forum itself, a private donation attested by Argyle (the same donor
as 0159). What is served follows the Janitor's amending ruling of the same day: CORE records drawn from the forum — a show's card
or results, a roleplay, a character's own card — are served as museum documents even though the post also lives on the forum;
SUPPLEMENTAL attachments to a wing (admin notes, announcements, news, discussion) are minimized — structured or linked, served only
in a handful. The document-level kinds are otherwise newsgroup | wayback | arquivo | geocities-torrent | direct | commoncrawl |
unknown (validate-documents.mjs, validate-provenance-notes.mjs, land-check.py).

**`founded`** / **`closed`** / optional **`runs[]`** — THE FOUNDING-EDGES
WAVE (2026-08-21, the Janitor's own directive, verbatim: *"every promotion
needs founded and closed date edges — which would make it so you could
sort promotions by which were founded the earliest or latest, filter down
to specific years for either, filter to tenure (give me all promotions
that lasted >=5 years), and when available (like with the fandom dump) to
prioritize the frontier based on founding year age."*) Two fields,
**required on every row** (`registry-validate.mjs` hard-fails a missing
one) — the dead-only rule means every held promotion has, in fact, ended,
so `closed` is never absent, only ever honestly imprecise. Same
`{date, precision, source}` shape `shows.json`'s own `date` and
`reigns.json`'s own `won`/`lost` already use (`exact`/`month`/`year`/
`circa`/`unknown`, the impossible-date guard's own precision vocabulary),
with one deliberate difference: **`source` is required here, never
optional** — the Janitor's own words, "no date invented from vibes...
every value carries a source naming its receipt." A genuinely unrecoverable
date (BBW, The X, NPW — three promotions with no surviving date of any
kind) is `{ "date": "unknown", "precision": "unknown", "source": "<why>" }`
— the literal string `"unknown"` as the date, exactly the shape
`rps.json` already uses elsewhere for a row with no recoverable date at
all (see `data/rps.json`'s own precision-`"unknown"` rows) — chosen over
omitting the field entirely because every promotion HAS a founding and a
closing fact in the abstract (the dead-only rule again), even where the
record simply doesn't preserve it; an absent field would read as "this
question doesn't apply," which isn't true here, where "the answer isn't
recoverable" is the honest state.

**The intermittent-promotions extension** (coordinator amendment under the
same gavel, same day) — a promotion that ran, went dark, and revived
can't be honestly represented by one continuous `founded`→`closed` span.
NAPW is the founding case: a classic era (31 Oct 2005 – Sept 2010) and a
revived era (c. 2013 – 2018) with a real multi-year dark gap between them,
both eras carrying actual shows/titles/RPs, not just a name persisting.
`runs[]` — optional, absent for the ordinary single-run case (12 of the
15 promotions on file today) — is one entry per run, the same
`tenures[]`-on-`characters.json` idiom one level up:

```jsonc
"runs": [
  { "founded": { "date": "2005-10-31", "precision": "exact", "source": "..." },
    "closed":  { "date": "2010-09",    "precision": "month", "source": "..." },
    "label": "the classic era" },
  { "founded": { "date": "2013", "precision": "circa",   "source": "..." },
    "closed":  { "date": "2018", "precision": "unknown", "source": "..." },
    "label": "the revived era" }
]
```

`label` is optional free text for the fed's own era name, where one
survives in its record — never invented. The semantics, stated once:

1. **`runs[]` absent = one continuous run**, `founded`→`closed` — the
   common case, no schema bloat for the promotions that don't need it.
2. **`runs[]` present = `founded`/`closed` are DERIVED, never
   independently editable drift.** Top-level `founded` must equal
   `runs[0].founded` exactly (date + precision); top-level `closed` must
   equal the last run's own `closed` exactly. `registry-validate.mjs`
   hard-fails a mismatch — the envelope is always a mechanical copy of
   the run array's own first/last edge, so it can never quietly drift out
   of sync with the runs it's supposed to summarize.
3. **Tenure has two honest meanings.** *Active* tenure — what the
   the Janitor's own "lasted >=5 years" means — is the SUM of each run's own
   span (a fed dark for 3 of its 6 calendar years didn't last 6); the
   *envelope* span (`closed` − `founded`) is a different, always-
   derivable number. `promotions.html`'s `tenure:` filter computes
   ACTIVE tenure (`js/list.js`'s `promotionTenureYears()` — sums
   `runs[]` when present, else the plain span); nothing currently exposes
   envelope tenure as a separate filterable field — a real gap, noted
   here rather than silently claimed as covered, should a future wave
   want it.
4. **Dark gaps are represented by the runs themselves** — the space
   between one run's `closed` and the next run's `founded` IS the dark
   period. There is no separate `dark: true` flag and no prose-only
   description of a gap; if a promotion has a real dark stretch worth
   recording, it has `runs[]`.
5. **Revival-vs-new-promotion is a curation call per case, not a rule a
   script can make.** The precedent, stated explicitly so a future wave
   doesn't collapse a real new promotion into an old one by analogy:
   NAPW's revival is the SAME promotion continuing (the fed's own record
   shows the same promoter, the same installed Commissioner, and the same
   `napw` id/site lineage picking back up) — `runs[]` on one row. UiWF is
   a SEPARATE promotion from UWF despite being built by a UWF veteran in
   direct response to UWF's own closure — its own founding manifesto
   frames itself as something new born from UWF's ending, not UWF
   continuing under a new name, so it correctly holds its own `uiwf` row
   with its own `founded`/`closed`, never folded into UWF's `runs[]`.
6. **Backfill discipline**: `runs[]` was populated for NAPW from its own
   receipts (the wing's own epitaph/placard and the workshop digest
   `napw-site.md`) at the precision those receipts actually support —
   the gap is transcribed, never smoothed away. The other 14 promotions'
   `years` strings were swept for the same comma/gap shape; none showed
   a second genuine intermittent case (WWA's own "...including a real,
   previously-unknown 2019 phpBB revival" was checked and deliberately
   NOT modeled as a second run — see `founded`'s own worked example below
   for why).

**Consistency against the prose `years` field.** `years` stays exactly
what it always was — a hand-authored, human-rendered span, free to carry
narrative detail (`"(never launched)"`, `"(cancelled; remaining roster
absorbed into WWA's unified banner 14 Jul 2004)"`) no machine-parsed date
range could hold — it is never derived/auto-generated FROM `founded`/
`closed`. What IS checked, mechanically, in `registry-validate.mjs`: only
the years mentioned BEFORE any parenthetical aside in `years` are read (a
parenthetical routinely carries a later, unrelated detail that would
otherwise poison the comparison — WWA's own trailing "...2019 phpBB
revival" is exactly this case); `founded`'s year must not be LATER than
the earliest year the string mentions, and `closed`'s year must not be
EARLIER than the latest. Founded/closed may always REFINE what the prose
already said (PCW's own `years` reads conservatively, "active by 2001,
snapshot 2004" — its receipted `founded` is September 2000, earlier and
more precise, and passes cleanly because refining backward/forward is
never a contradiction) but may never flatly contradict it. A `runs[]`
promotion is exempt from this specific check — an intermittent
promotion's `years` string legitimately encodes more than one sub-range
in a shape this simple leading-numbers check can't parse, and NAPW's own
`runs[]` structure already enforces its own internal consistency via
rule 2 above.

**Queryability** — `js/query.js`'s `flattenFields()` was generalized
(additively; every existing `date:`/`precision:`/`source:` match is
unchanged) so any nested `{date, ...}`-shaped field ALSO exposes its own
PARENT key as a directly filterable field, valued at the date string —
this is what makes `founded:`/`closed:` distinct, queryable tokens on
`promotions.html`/`search.html` instead of both collapsing into the same
generic `date:` every other date-shaped field already shares. `tenure:`
is the one genuinely computed field (no raw JSON key backs it) — wired by
hand in `promotions.html`/`search.html` via `js/list.js`'s
`promotionTenureYears()`, honestly ABSENT (never `0`) for a promotion
whose founded/closed can't be pinned to a real date, so an unknown-dated
promotion is excluded from `tenure:>=N` filtering rather than silently
counted as a zero-year run. `promotions.html` also gained a `Sort by`
control (Name / Founded / Closed / Tenure, each ascending or descending)
— display order only, layered on top of whatever the search box's own
`field:value` query currently shows; a promotion whose sort key can't be
pinned to a date always sorts last, in either direction, rather than
landing at an arbitrary position.

Example promotion row (trimmed):

```jsonc
{
  "id": "uwf", "name": "UWF", "full_name": "Universal Wrestling Federation",
  "years": "2001–2006", "depth": "deeply documented",
  "band": "gold", "page": "/promotions/uwf/", "visibility": "gated",
  "medium": "website-efed", "scale": "global",
  "scale_source": "Its own \"World Heavyweight Championship\" plus kayfabe international touring...",
  "founded": { "date": "2001-09", "precision": "month", "source": "The wing's own epitaph: uwf.org.uk ran alongside the uwf2k1 Yahoo group \"from the very start (Sep 2001)\" (promotions/uwf/index.html)." },
  "closed": { "date": "2007", "precision": "unknown", "source": "No closing post survives; the fed's later domain carried dated content into 2007 with no further show script behind it. SOURCES DISAGREE: UiWF's own founding manifesto separately frames UWF's own closure as September 2006 — both readings are recorded." },
  "sources": [
    { "kind": "drive", "identifier": "<the held drive folder> (...)", "window": "not separately dated", "accession": "0001" },
    { "kind": "wayback", "identifier": "uwfonline.com's own RP/promo message boards", "window": "mined 2026", "accession": "0002" },
    { "kind": "wayback", "identifier": "uwf.org.uk", "window": "mined 2026-08-17; ...", "accession": "0014" },
    { "kind": "yahoo-group", "identifier": "uwf2k1 (...)", "window": "founded Sep 2001; ...", "accession": "0012" }
  ]
}
```

---

**`links_out[]`** (v124, `#holders-site-links`) — optional. This wing's own
page on a living site the promotion’s own holder runs, as
`{url, label, kind, checked}` with `kind: "promotion"`. One shape and one set of
checks for all six record types that carry the field, documented under
[`links_out[]` (the holder’s-own-site link-out)](#links_out-the-holders-own-site-link-out).

## `characters.json` / `units.json`

One row per performer/character or team/stable. **Identity fields only**
at the entity level — kayfabe bio facts live inside `tenures[]` (see
below), never here, because different feds canonically disagree about
them for the same carried-over character.

Allowed entity-level fields (`ENTITY_ALLOWED` in
`scripts/registry-validate.mjs` — anything else is a hard-fail, the shape
is enforced): `id`, `type` (`character`/`unit`), `name`, `aka[]`,
`tenures[]`, `identity[]`, `handler`, `notes`, `boozler_rule`,
`relationship`, `members[]` (units only), `portrays`, `caption`,
`caption_asof`, `unit_kind` (units only), `membership_unknown` (units
only), `fandom`. (The list has drifted behind the allowlist itself more
than once — `ENTITY_ALLOWED` in the validator is the authority.)

- **`fandom`** — THE FANDOM CROSS-CHECK WAVE (the Janitor's directive,
  2026-08-24). Same field, same contract and same renderer-builds-the-link
  rule as `promotions.json`'s own `fandom` documented above: the EXACT
  e-wrestling fandom wiki article title, never a URL. The bar for setting
  it on an ENTITY is deliberately higher than for a wing — an exact,
  UNIQUE article title whose own text names a fed this entity is actually
  tenured in (an article "Judgement" reciting LOW's own Aftermath, Realm
  and Xtreme titles; an article "Rocky Stevens" dating tenures in both
  WrestleCrazy Entertainment and Mayhem Wrestling Entertainment). A bare
  acronym in a previous-feds list is NOT corroboration, and a generic
  ring name ("Storm", "Venom", "Tank") is left unset however clean the
  title match looks: a wrong link here would assert an identity the museum
  has not established, which is the collision doctrine's "when in doubt we
  do not merge" pointed outward. Optional — its absence means nothing, not
  a defect. Rendered by `cross-reference.mjs`'s `renderPlacard` as an
  "Elsewhere" row on the entity's own page.

- **`aka[]`** and the aka-collision mint guard, exact plus decorated
  (PERFECTION WAVE A, 2026-08-21). `aka[]` is a plain array of alternate
  names a character/unit was actually billed under (a ring-name change,
  an unmasking reveal, a nickname the fed's own text used interchangeably
  with the registered name). At mint time, `registry-validate.mjs`'s
  aka-collision guard (`CURATION.md`'s v45 changelog entry) hard-fails a
  NEW entity whose `name`/`aka` collides, case-insensitively but EXACTLY,
  with an already-registered entity's own `name`/`aka`. That check alone
  is an exact-match check only — it never caught a DECORATED aka, a
  nickname/moniker that reads, in fiction, as obviously the same
  character as an existing registered name without literally equaling or
  containing it (the fleet-era near-miss: a new `rabbi-of-pain-uwf` mint
  and the already-registered `rabbi-mort-schwartzman` are the same person
  under two different decorated names, self-caught at the time, not
  validator-caught). The SAME guard block now also normalizes every
  `name`/`aka` (lowercase; strips quotes/punctuation; drops one leading
  "the"/"a"/"an"; collapses whitespace) and flags a NEW entity whose
  normalized label contains, or is contained by, an existing entity's own
  normalized label — checked across every shard, characters and units
  alike. Deliberately a **soft warning, not a hard fail** (legitimate
  similar names exist at this scale — a short generic archetype two
  unrelated feds both landed on independently is a real, recurring
  pattern per the generic-names-qualified-at-mint rule, not always a
  duplicate), same posture as every other advisory check in this
  validator. An acknowledging `identity[]` entry (`with: [thatId]` or a
  `note` naming it) silences it exactly like the exact-match guard.
  Verified live against the real rabbi-of-pain-uwf/rabbi-mort-schwartzman
  case (decoy mint injected, confirmed to warn, confirmed silenced once
  given a matching `identity[]` note, fully reverted — the same
  validator-testing precedent `CURATION.md` v25's CSS-integrity checks
  and v45's own exact-match guard both used). The live test also
  surfaced and fixed an unrelated latent bug in the SAME code: the
  guard's `git show HEAD:...` read carried no `maxBuffer`, so Node's 1MB
  default silently truncated it — the whole guard, exact check included,
  had been silently never running once `data/characters.json` grew past
  a megabyte, the failure swallowed by the same catch block that quietly
  skips a genuinely non-git-repo case. Fixed with a 64MB `maxBuffer`.
  Hand-verifying a nickname-shaped new mint against similar-sounding
  existing entities in the same promotion (`docs/PROCESS.md`'s Registry
  section) is still good practice — the gate is a floor, not a
  substitute for reading the registry — but it's no longer the only line
  of defense, and it's no longer silently disabled.
- **`caption`** — THE CAPTIONS WAVE, required on every character/unit
  (hard fail if missing): one hand-drafted museum-label sentence. See
  `docs/PROCESS.md`'s Prose section for the standard — THE PAGE SKELETON doctrine
  (same section) extends this exact field, plus `caption_asof`'s staleness
  machinery, to `promotions.json` too (see that section below); one
  anatomy, every entity type.
- **`caption_asof`** — THE CAPTION-STALENESS WAVE: `{written: "YYYY-MM-DD",
  evidence: {tenures, reigns, appearances, rps, awards, relationships}}`,
  the six live counts (tenure count on the entity itself; reign/
  appearance/rp/award/relationship rows naming this entity's id across
  `data/reigns.json`/`shows.json`/`rps.json`/`awards.json`/
  `relationships.json`) a caption was checked against, stamped the day
  it was last written or deliberately re-reviewed. Optional — its
  absence means nothing (an entity minted before this wave, say), not a
  defect. `registry-validate.mjs` recomputes the same six counts live
  and soft-warns ("caption may be stale") when they've moved on
  materially — any count differing by 2 or more, or the tenure count
  increasing at all, since a new tenure is a new fed-era on its own and
  always worth a look even at a difference of exactly one. See
  `docs/PROCESS.md`'s "Caption refresh, on wave completion."
- **`caption_asof.author`** — THE AI-AUTHORSHIP FLAG (2026-08-22, the Janitor's
  gavel: "a small `AI` flag next to anything that is AI-generated
  prose... with the option that humans could manually write these as well
  and they'd drop the flag"). `"ai"` (the default for every caption on
  file, and the only correct value to set on a newly-minted one) or
  `"human"` — set `"human"` only when the Janitor or another human contributor
  actually wrote or rewrote the caption text themselves. Rendered by
  `cross-reference.mjs`'s `aiFlag()` as a small badge (`.ai-flag`,
  style.css) immediately after the caption on the entity's own page;
  `"human"` renders no badge at all. `registry-validate.mjs` soft-warns on
  a `caption` with no paired `author` (a housekeeping gap, not a hard
  fail) — the same paired-metadata convention `epitaph_asof.author` below
  and a memorial's own `note_author` both follow.
- **`caption_en`** / **`caption_en_author`** — THE ECOSYSTEM EXPANSION GAVEL,
  2026-09-05, step 2 (`CURATION.md` v112(c), `#caption-en`): the English
  sibling of a caption written in another language, and its own authorship
  flag on exactly the `caption_asof.author` convention (absence means `"ai"`).
  Optional and unused on every row held at the gavel. On an entity, legality
  is read off the wings its tenures name — the sibling is legal where at least
  one of them ran in a language other than English, since an entity row
  carries no `language` of its own. Rendered by `cross-reference.mjs`'s
  `captionEn()` on all four of its caption surfaces (the entity lede, the
  characters/units list row, and both memorial cards), and by
  `stamp-promotion-headers.mjs` on the wing placard.
- **`nonhuman`** / **`species`** — THE NONHUMAN DATATYPE WAVE: `nonhuman:
  true` flags an entity the era itself billed as not a human person —
  animal, object, or creature — staging-based, never appearance-based (a
  demon-gimmick human wrestler stays human; a literal table does not).
  `species` (optional, free text: `"camel"`, `"table"`, `"imp"`, ...)
  only means something alongside `nonhuman: true` — a hard fail if
  present without it. Renders as a plain "Species: camel (per the fed's
  own billing)" line on the entity's own page, and joins the characters.html
  search blob (name + aka + species) so "camel" or "chimpanzee" actually
  surfaces the right entities — not automatic; wired deliberately in
  `cross-reference.mjs`'s own `searchBlob` construction.
- **`staged_gender`** / **`staged_gender_grade`** — THE STAGED-GENDER WAVE
  (2026-08-19, the Janitor's rider mid-session: "that actually feels like it
  would be a really interesting datapoint, showing interest in women's
  wrestling among ewrestling over time"). The exact same doctrine as
  `nonhuman`/`species` one field pair over: `staged_gender` is the
  CHARACTER's gender as the fed itself staged it — a bio card's own field,
  the served show text's own pronouns, an explicit division carve-out (OSW's
  own Queen of Extreme) — never the handler's real gender (`CURATION.md`'s
  privacy rule forecloses that absolutely, no exception), and never
  inferred from a ring name alone. Controlled-but-soft (`male` · `female` ·
  `unknown` today, expected to grow — a soft warn, never a hard fail, for
  anything else). `staged_gender_grade` (`bio-explicit` · `pronoun-observed`)
  only means something alongside a real `male`/`female`/etc. value, same
  mutual-requirement shape as `species` needing `nonhuman: true` — omit
  both fields entirely for the (current, correct-for-most-of-the-registry)
  case where nothing's been checked; `unknown` is a real explicit value for
  a case that WAS checked and came back genuinely unclear, distinct from
  simply never having looked. Rendered on the entity's own placard only
  when actually known — no row at all for `unknown`, per the museum's own
  never-narrate-machinery rule. Seeded this wave for one promotion's own
  roster, verified from that promotion's own bio cards and served text; a
  dedicated future wave backfills the rest of the registry, not a sitewide
  sweep folded into unrelated accession work. **ROSTER-CARD STAMPS** (THE
  GRAPH-ENRICHMENT WAVE): `scripts/cross-reference.mjs`'s `entityCard()`
  stamps `data-roles` (every distinct tenure `roles[]` value across the
  entity, pipe-joined, the same aggregate-and-join convention `data-style`
  already uses one field over -- named plural to match the JSON field
  name exactly) and `data-staged-gender` (the raw `staged_gender` value,
  when present at all -- `unknown` included, since that's a real
  checked-and-recorded state, not an absent one; `js/query.js`'s
  `ATTR_FIELD_ALIASES` maps the attribute's hyphenated name back to the
  JSON field's own underscore) onto every generated roster card,
  list-page query parity with what `search.html`'s own live JSON join
  already supports.
- **`identity[]`** — evidence-graded assertions about this entity's own
  identity (usually a merge): `{assertion: "merged"|"distinct"|"presumed-same",
  grade, note, with?: [ids]}`. `presumed-same` (minted 2026-08-26, the Rocko
  Daymon shape): believed one person on name+adjacency evidence that clears
  presumption but not proof — the rows stay uncollapsed, `with[]` draws the
  graph edge, and the revisit trigger (typically the counterpart wing
  reaching tier 3) lives in the note.
  Grades: `primary-source` · `user-attested` · `presumed`.
- **`handler`** — a role description only, *never* a real name (the sole
  exceptions: the two dead-and-welcomed memorial names, which the field
  is allowed to carry because `CURATION.md`'s privacy rule's memorial clause
  specifically permits it). Not currently rendered anywhere in generated
  output; kept for future use.
- **`handling`** (THE COMMUNAL/PASSED HANDLING WAVE, the Janitor's rider on
  the same-handler edges item — the Corky Spectre question: "the reality
  is he was a shared character in our common universe, 'owned' by no
  one") — optional, `communal` (created and staged by more than one hand
  over the character's own life, owned by no one in particular) or
  `passed` (a gimmick/mask that changed hands in succession, one owner at
  a time — a future case, not yet seeded). Absence is the ordinary
  default assumption: a single hand throughout, no field needed to say
  so. Node-edge minimalism: no paired grade field — the evidence for a
  given `handling` value lives in the entity's own `notes`, the same
  free-text research-note field every other curator judgment already
  uses. **Hard contradiction guard**: `handling: "communal"` may not
  coexist with a `same-handler` edge naming this entity
  (`registry-validate.mjs` hard-fails it) — "owned by no one" and "one
  shared hand" can't both be true of the same character. Generalizes
  ahead of need, deliberately: a growing registry will keep meeting
  community-owned characters and passed gimmicks (the collection already
  holds at least one mask whose handler vanished mid-push), and this is
  the one small vocabulary addition that lets that be a structural fact
  instead of a caption-prose workaround each time.
- **`portrays`** — `{figure: "<external-figures.json id>", grade, note?}`,
  **or an ARRAY of that same shape** (THE ALMASY FUSION FIX, 2026-08-18) when
  a ring name honestly derives from more than one external figure — plural
  is opt-in per entity, never a forced migration of the single-object form.
  A real-person likeness played straight renders as "Portrays"; anything
  fictional, a presumed grade, or a brand mascot renders "Inspired by"
  (see `docs/PROCESS.md`'s staging-over-speech-adjacent portrayVerb logic
  in `cross-reference.mjs`), computed per entry and grouped by verb —
  `seymour-almasy`'s two entries (Final Fantasy VIII's Seifer Almasy for the
  surname/rival archetype, Final Fantasy X's Seymour for the given name and
  the staged Mount-Gagazet-and-Yevon gimmick) both read "Inspired by" and
  render as one row: "Inspired by: Seifer Almasy (FFVIII) &middot; Seymour
  (FFX)". THE PORTRAYAL-FORMAT WAVE: every portrayal renders sitewide as
  "Name (Source)" — see `external-figures.json`'s own `source` field below;
  grade/type are still validated and stored, just not repeated inline on
  every render. THE CANON PORTRAYAL (hook c101, JOBS CANON-PORTRAYAL-VERB):
  an entry whose figure is a `fictional-character` from a game world's own
  canon (`source: "CornellVerse"`, v99's canonical-portrayal clause) reads
  "Portrays", and the figure page lists it under **Portrayed in**: a diary
  staging that canon's figure in its own continuity portrays it.
  `portrayal_of` stays real people only; no field changes, and a new canon
  joins by its `source` tag in `cross-reference.mjs`. A `portrays` entry
  never names a `real-promotion` row (a wing portrays a company; a character
  portrays a person or a figure), and `registry-validate.mjs` hard-fails it.
- **`portrayal_of`** — a bare `external-figures.json` id (CURATION.md v78,
  the Janitor, 2026-08-24). The narrow facet for the one case v78 governs:
  a fed staging a REAL PROFESSIONAL WRESTLER under that wrestler's own
  name. It does not replace `portrays` and never appears without it — the
  figure named here must also be on the row's own `portrays[]`, which
  `registry-validate.mjs` hard-fails, so the general external-figure edge
  is never routed around. The division of labour: `portrays` is every kind
  of borrowing (a sitcom dad, a Nintendo enemy, a nu-metal band, a
  wrestler); `portrayal_of` marks the subset where the fed booked the
  figure AS the figure. 4WW's Chris Sanchez is the instructive contrast —
  his own career-history card answers the fed's "Wrestler most resembles in
  real life" field with "Chris Jericho," so he carries `portrays` and NOT
  `portrayal_of`: a resemblance is not a portrayal, because Chris Sanchez
  is still Chris Sanchez. Three further rules the validator enforces:
  the figure must be `type: "real-person"`; the character's own id must be
  promotion-qualified (`lex-luger-faw`, never bare `lex-luger`, per v78(b),
  so one fed's portrayal can never collide with another's); and
  `aliases.json` hard-refuses any entry that would merge two portrayals
  across promotions (v78(c), which gave itself no escape hatch — one fed's
  Lex Luger and another's are different characters, and the figure record
  is their only shared node). Its PRESENCE is the marker v78(e) filters
  on in both directions: `portrayal:yes` and `portrayal:no` on the
  character listing. On the entity's own page it renders one fixed placard
  line, the gavel's own words: *"A portrayal of the professional wrestler,
  staged by this promotion."*, or, for a person the fed staged in another
  role, the same sentence with that role's words (the Janitor's D430, *"(B)
  role words"*; CURATION.md v78(g)): "the wrestling manager", "the
  commentator", "the referee", "the authority figure" (from the portrayal's
  own `tenures[].roles` when no tenure records `wrestler`), or the
  `portrayal_role` below.
- **`portrayal_role`** — optional, on a row carrying `portrayal_of` only
  (hook c116, D430). The role the fed's own fiction gave the real person,
  where the tenures' `roles` cannot say it: `wrestler` · `manager` ·
  `commentator` · `referee` · `authority-figure` · `ring-announcer` ·
  `promoter` · `public-figure`. It sets the v78(g) placard's words ("the
  professional wrestler", "the wrestling manager", "the commentator", "the
  referee", "the authority figure", "the ring announcer", "the wrestling
  promoter", "the public figure") and wins over the tenures. Absent, a
  portrayal whose tenures record `wrestler`, no role, or only
  `other`/`mascot` reads "the professional wrestler"; otherwise the first of
  `manager`, `commentator`, `referee`, `authority-figure` its tenures
  record. Use it for a public figure the fed booked as a wrestler (tenures
  say `wrestler`; the person is not one) and for an announcer, interviewer
  or guest (tenures say `other`). `registry-validate.mjs` hard-fails any
  other value, and the field on a row without `portrayal_of`.
- **`boozler_rule`**: `true` flags a name whose own caricature the Museum
  records in the ledger but does not perform (`CURATION.md`'s Bum Boozler rule). The name
  stays; the caricature doesn't get re-enacted in new Museum prose.
- **units only** — `members[]`: `[{name, character_id?}]` (a member with
  no recovered individual identity gets `name` only, no `character_id` —
  not an oversight, an honest gap). `unit_kind`: `tag-team` · `trio` ·
  `stable` · `entourage` · `other`. `membership_unknown: true` is the
  explicit "we looked, no roster survives" companion to `members[]` — a
  unit must carry exactly one of the two, never both, never neither.

**`tenures[]`** — one entry per promotion this entity appeared in. Allowed
bio fields (`TENURE_BIO_FIELDS`): `height`, `hometown`, `alignment`,
`weight`, `finisher`, `entrance_music`, `style`, `manager`,
`signature_moves[]`. Plus: `promotion` (id, required), `first_seen` /
`last_seen` (honest precision — a bare year, `"?"`, `"c. 2008"`, whatever
the source actually supports), `role` (free text) and/or `roles[]`
(controlled: `wrestler` · `manager` · `referee` · `authority-figure` ·
`commentator` · `mascot` · `other`), `source` (citation string), `note`
(a tenure-specific research note — e.g. flagging an appearance-derived
date as mechanically inferred rather than bio-sourced),
`observed_moves[]` (`{move, count, sources[]}` — what the corpus shows
someone doing, distinct from the *declared* `finisher`/`signature_moves`
— the performed-vs-declared distinction), and `grade` (below).

**`tenures[].grade`** — an evidence grade on the TENURE ITSELF (THE
TENURE-DERIVATION WAVE), distinct from an identity assertion's own grade
since a tenure isn't claiming two entities are the same, it's claiming a
fed/period relationship exists at all: `primary-source` · `user-attested`
· `presumed`, plus **`billing`** (THE BILLED APPEARANCE, the Janitor's
gavel, 2026-08-23). `billing` is the weakest honest rung on the same
ladder the field was built for — the promotion's own card billed this
entity and nothing held says they ever worked it. The billing document is
a primary source; the working relationship it evidences is a promise, not
a record, and the grade says so rather than letting the tenure read like a
roster page. It pairs with the `kind: "billed"` appearance row that
receipts it (`shows.json`, above) — the appearance and the tenure make the
same modest claim, or neither is written. Registry-internal, like every
tenure grade: never rendered.

**`entrance_music` is structured (THE ENTRANCE MUSIC STRUCTURED WAVE, part
of THE GRAPH-ENRICHMENT WAVE).** No longer a bare string — `{title?,
artist?, verbatim}`. `verbatim` is always kept, always required, always
what a caption or rendered line quotes if it quotes anything: the field's
own original freetext exactly as recorded ("'Scarecrow' by Ministry"),
never edited or normalized. `title`/`artist` are populated only where a
conservative, mechanical parse of the verbatim string actually resolves
them cleanly (`"TITLE" by ARTIST`, `ARTIST - 'TITLE'`, and close variants)
— an unparseable string (no recognizable title/artist split, a run-on
stage direction tacked onto the end, a joke non-song answer) stays
verbatim-only, both fields simply absent, which is the honest and common
case, not a defect to chase down. The split exists to make two new
queries possible without touching a caption: an exact `artist:` facet, and
cover detection (the same `title` under two different `artist` values,
across feds or eras). Rendering always shows `verbatim`; `title`/`artist`
are indexed/filterable, not separately displayed prose.

**`corrected` (THE ENTRANCE MUSIC AGGREGATION WAVE, the Janitor's gavel,
2026-08-31).** A sibling of `verbatim`, not a replacement for it —
`verbatim` stays source-exact forever, per the verbatim-serving rule; a
typo in the original citation ("Metalica," "Limp Bizket") is exactly the
kind of thing that rule protects, and `corrected` never touches it.
`corrected` holds the same song/artist respelled in standard real-world
form — the Janitor's own stated reason is aggregation: a "most popular
entrance-music artist" query run straight off `verbatim` would undercount
an artist split across several misspellings. `corrected` mirrors
`verbatim`'s own phrasing shape (`"Track Title" by Artist` when both are
named, just the title or just the artist when that's all `verbatim`
gave) and normalizes nothing but spelling/capitalization/punctuation —
no artist added that the source never named, no enrichment of any kind.
Where `verbatim` is already correctly spelled, `corrected` mirrors it
exactly. Where the reference can't be confidently resolved to a real
song (an invented in-fiction theme, an unintelligible fragment, a joke
non-song answer) `corrected` is simply absent, same honest-gap
convention as an unparseable `title`/`artist`. Indexed/filterable for
aggregation, like `title`/`artist`; never separately displayed prose,
and never what a caption or rendered line quotes — that's `verbatim`'s
job alone.

**Win/loss records (THE RECORDS WAVE, 2026-08-18) — the same declared-
vs-observed pattern applied to a record, not a move.** Two DECLARED
shapes, never both on the same tenure: `record` (the flat-file breakdown
already documented above `Tenures[]`'s own example — `single_w/l/d`,
`tag_w/l/d`, `cluster_w/l`, `ppv_w/l/d`, `me_w/l/d`; `single`/`tag`/
`cluster` are mutually-exclusive match-FORMAT buckets, `ppv`/`me` are
cross-cutting tags on a SUBSET of those same matches — cross-reference.mjs's
own "Overall" total sums only the three exclusive buckets, never adding
`ppv`/`me` on top, which would double-count), or `record_declared`
(`{w, l, d?, source?}`, for a fed's own stated figure recovered outside
the flat-file shape — a roster page's own bare "W: 1 / L: 0" line, say).
Both are the fed's OWN claim, museum-transcribed, never museum-computed.
**OBSERVED records are never stored in `data/*.json` at all** — computed
fresh on every `cross-reference.mjs` run from `data/shows.json`'s own
`matches[]` (`sides`/`winner_side`), per entity per promotion, the same
"derived, never hand-maintained, recomputed every regen" discipline
`reigns.json`'s own lost-show chaining already uses. Three honesty
buckets: `sides` present + a valid `winner_side` → win or loss for
everyone in each side; `sides` present, no `winner_side` parsed →
"unresolved" (the outcome wasn't parsed, not zero); no `sides` at all (a
flat `participants` list) → not a W/L fact, skipped entirely, already
counted as an appearance elsewhere. Rendered as two clearly separate
sentences, "Record (fed's own): ..." and "Observed (from N parsed
matches): ...", never blended into one number and never implying
completeness the parse doesn't have — the observed line's own match
count is the honesty receipt.

Example (trimmed):

```jsonc
{
  "id": "coma", "type": "character", "name": "Coma", "aka": ["Joseph Rosso"],
  "caption": "Held the IWF North American Championship four or five times as leader of the Crash Team, then turned pro under his own name and built the GIWF around himself.",
  "handler": "the promotion's founding handler",
  "notes": "This handler went on to found and run the GIWF outright.",
  "identity": [{ "assertion": "merged", "grade": "user-attested", "note": "IWF roster: \"Carries forward into the GIWF as Commissioner Joseph Rosso.\"" }],
  "tenures": [
    { "promotion": "iwf", "first_seen": "1998", "last_seen": "1998",
      "role": "wrestler — North American Champion (4–5 reigns); Crash Team stable",
      "alignment": "Heel", "height": "6'7\"", "weight": "285 lbs", "style": "Submission",
      "finisher": "Flatliner Leg-Lock (a modified Sharpshooter)",
      "source": "the workshop's coma.htm (a dedicated 1998-99 IWF bio page)",
      "roles": ["wrestler"] },
    { "promotion": "giwf", "first_seen": "1999", "last_seen": "2001",
      "role": "commissioner (as Joseph Rosso)", "roles": ["authority-figure", "wrestler"] }
  ]
}
```

---

**`links_out[]`** (v124, `#holders-site-links`) — optional. This character or unit's own
page on a living site the promotion’s own holder runs, as
`{url, label, kind, checked}` with `kind: "bio"`. One shape and one set of
checks for all six record types that carry the field, documented under
[`links_out[]` (the holder’s-own-site link-out)](#links_out-the-holders-own-site-link-out).

## `titles.json` / `reigns.json`

`titles.json`: one row per championship. `{id, type: "title", name,
promotion, page, collection}` — titles still use the older single-
`collection` convention (not migrated to the accession-lot material model
the way `shows`/`rps` were; a future pass may revisit this). Optional:
`aka[]`, `restarted_from` (another title's id — the lineage this belt
picked up from, e.g. every UWF belt from its GIWF predecessor), `notes`
(free text; rendered plainly, never narrated).

**THE EPITAPH/NOTES DEDUPLICATION (2026-08-18):** a belt's `epitaph` is
the page's one piece of prose — the whole narration belongs there, once.
`notes` carries only what the epitaph doesn't: a source receipt/citation
(a served page's address, a bio-page reference, a quoted primary-source line; never a local or workshop file path: the museum
serves `data/*.json`, and `scripts/fixers/scrub-workshop-paths.py` takes any such path out of every served registry at each
preflight, hook c111), a
physical-belt fact the epitaph has no room for, or an evidence hedge (a
classic-era chain gap, an unresolved lineage question) — rendered as a
compact source line under the epitaph, not a second narration restating
it in smaller type. If a note's content is already said in the epitaph,
the note is empty (omit the key, don't render an echo). Filing-decision
machinery — "kept as its own registry row, honestly labeled, rather than
folded into...", "recorded separately... rather than merged on..." — never
belongs in a rendered note; that's curators narrating curation, forbidden
the same way a caption never narrates the Museum's own merge evidence
(`CURATION.md` v38). If the filing reasoning needs recording at all, it
belongs in the changelog or an internal comment, not a served field. Worked
example: `giwf-universal-tag-team-self-awarded`'s epitaph carries the
Phenomenons' foam-belt story in full; its note is one line, the bio-page
receipt (the workshop's `Phenomenons.htm`) and nothing else.

**`cadence`** — THE ANNUAL CHAMPIONSHIPS WAVE (2026-08-18, the Janitor's gavel:
"you can include annual honors like Stable Wars, Regal Rumble, and Contest
of Champions under Championships, just clarifying the distinction: they're
championships, just annual ones"): `standing` (the ordinary case — defended
on an open schedule, backfilled onto all pre-existing rows) or `annual`
(contested once on a fixed yearly clock rather than defended). Rendered
plainly on the title's own placard ("Cadence: contested annually") and
mechanically searchable everywhere `flattenFields()` already reads a title
row (`championships.html`, `search.html`) — no page-side code needed for
the value to become queryable. *(A note from the Janitor, received after this wave
shipped flagged the separate `status` field below for retirement; THE
TITLE-STATUS REFRAME below carried it out. `cadence` was unaffected then
and stands on its own now.)*

**`status` is RETIRED (THE TITLE-STATUS REFRAME, 2026-08-18, the Janitor's
gavel).** This registry used to carry a controlled-but-soft `status` field
— a one-word read of where a belt's lineage stood as of the surviving
record's own end (`active`/`retired`/`unified`/an outlier like
`self-awarded`). It no longer exists — see the changelog entry for the
full ruling ("if bar for entry is a dead promotion, every title is
retired by default"). It's gone from every `titles.json` row;
`registry-validate.mjs` now hard-fails if the key reappears on any row.
Two replacements, neither one a single soft-controlled word standing in
for "where does this belt's lineage stand":

- **`nature`** — a title that was never a sanctioned in-fed championship to
  begin with, so `active`/`retired` (or any lifecycle framing) misdescribes
  it regardless of when the fed ended. One value on file so far:
  `"self-awarded"` (`giwf-universal-tag-team-self-awarded` — a foam belt
  the Phenomenons gave themselves; the Museum never treats "born
  self-awarded" as a lifecycle state a title could enter or leave). Sits
  beside `cadence`, not instead of it — a title can be `annual` cadence and
  carry no `nature` at all, or `standing` cadence and carry `nature:
  "self-awarded"`; the two answer different questions.
- **`events[]`** — in-fed lifecycle events, present ONLY where the fed
  itself actually acted on the belt, each one dated and sourced against the
  surviving record. Never populated to describe the ordinary case (a
  promotion simply ending with the belt still live) — that case renders
  NOTHING: no label, no narration of the default, since the reign ledger
  already shows where the record ends. Each entry:
  `{type, date: {date, precision}, note, title?}` —
  - `type: "retired_by_fed"` — the fed's own record states the belt went
    dark before its promotion's own end (a ban, a plain retirement
    declaration), whether or not it was later revived — the event
    describes what happened at that date, not a permanent final-state
    claim. Worked example: `uwf-thc` carries one dated `2001-12-05`,
    "hardcore wrestling itself was banned," sourced from the fed's own
    2004 title-history revision — the same belt was later revived by
    Gurgles and continued for years after, which the reign ledger and
    epitaph already show; the event records the historical fact, not an
    assertion that the belt stayed dark.
  - `type: "unified_into"` — one title's own lineage was permanently
    absorbed into another still-running title. `title` names the
    surviving title's id. Worked example: `uwf-shoot-wrestling` carries
    one dated `2003-02-16`, `title: "uwf-thc"`, sourced from the winning
    reign row's own `how` text ("final Shoot Champion; title merged into
    the THC, 16 Feb 2003").
  - `type: "rename"` — the fed itself renamed a still-running belt on air;
    `title` names the id the renamed lineage now lives under (a NEW
    `titles.json` row, per this registry's existing one-id-per-name
    convention — this is not the same mechanism as `restarted_from`,
    which is for a belt restarting under a successor PROMOTION). Worked
    example: `xuw-cruiserweight` carries one dated `2002-01-31`, `title:
    "xuw-television"`, quoting the on-air rename call.
  A GIWF title's lineage continuing into its UWF successor via
  `restarted_from` is deliberately NOT modeled as an `events` entry on the
  GIWF side — that relationship already has its own field and its own
  epitaph prose; `events` is reserved for what the record shows the fed
  itself doing to the belt's own status, not for the ordinary GIWF→UWF
  restart every early title already carries. Unrecognized `events[].type`
  values soft-warn; a `title` reference that doesn't resolve to a real
  `titles.json` id hard-fails, same discipline as `restarted_from`.
  Rendered on the title's own placard as one row per event.

**`epitaph`** / **`epitaph_asof`** — THE PER-TITLE PAGES WAVE: the same
living-epitaph doctrine `CURATION.md`'s promotion-epitaphs rule already binds every promotion to,
scoped down to one belt instead of one promotion's whole run — a few
sentences (never a promotion-length essay), the belt's own arc from its
OWN record (protagonist test: PTC Global's tournament and judged-decision
final belong to that belt's own epitaph, not folded into a generic
"championships" sentence), absolutes never collection-relative, no
handler name unless the memorial exception (`CURATION.md`'s privacy rule) applies.
`epitaph_asof` mirrors `caption_asof`'s staleness shape exactly:
`{written: "YYYY-MM-DD", evidence: {reigns: N}}`, the live `reigns.json`
row count for this title id at the time the epitaph was last written or
reviewed — `registry-validate.mjs` recomputes it live and soft-warns on a
material drift, same non-blocking spirit as the character/unit check.
Both fields required going forward (hard fail if either is missing on a
titles.json row) — every title in the collection gets one, the same
"generated-from-registry is the structural fix for main-character-
syndrome" reasoning that drove the wrestler-page wave. `epitaph_asof` also
carries `author` — THE AI-AUTHORSHIP FLAG, see `caption_asof.author`
above for the full doctrine; same `"ai"`/`"human"` values, same rendered
badge, same soft-warn when unset. `awards.json`'s own optional
`epitaph`/`epitaph_asof` (below) follows the identical convention.

`reigns.json`: one row per title reign — the structured ledger.
`{id, title (titles.json id), label (holder's own billed name at the
time), holder: [{id}] (may be multiple for a tag reign), won: {date,
precision, source}, days, lost: {date, precision}, how (free text —
method/venue), event, note}`. `holder[].id` must resolve to a real
character/unit.

**`event`** — THE REIGN-SHOW LINKAGE INVARIANT (2026-08-18): the
`shows.json` id of the show this reign was *won* on, wherever that show
is served. It's the only stored direction — a reign's own *lost*-show
link is never stored separately; `cross-reference.mjs` derives it as the
NEXT reign row's own `event` (same title, chronological order), since
the night a reign ends is the same night the next one began. The user's
own invariant, verbatim: *"an unlinked date must MEAN the show is
missing."* `registry-validate.mjs` enforces this as a **hard fail**: any
reign with an exact `won` date and a promotion for which exactly one
served show shares that date, but no `event` wired, fails the build —
link it, or if the match is genuinely wrong, say why in `note`. A
same-date match against *more than one* served show (no disambiguator
recoverable — a PPV and a weekly show landing the same night, say) is
the one case that's correctly never flagged: leave `event` unset and
record the ambiguity in `note` instead of guessing.

---

### Reign endings: `end_how` and `end`

THE REIGN-END ENUM (extraction 2, 2026-08-22, prose-shadow audit item 7):
an optional reign-level `end_how` — how the reign concluded, as a
queryable value: `lost-in-match | stripped | vacated | forfeited |
awarded-on | retired | departed | still-champion-at-record-end`. Absent
means unrecorded (or an unremarkable in-match loss); the `how`/`note`
prose keeps the story, the enum keeps the query ("every stripped
champion" is a filter now). Seeded mechanically from unambiguous
stripped/vacated/forfeited/awarded language in existing how/note text —
48 rows at introduction. Separately, a rare pre-existing `end` field
carries an end-of-reign DATE object (same `{date, precision, source?}`
shape as won/lost) for a reign that concluded without a losing match —
wwa-diablo-r002 (Odium's departure) is the exemplar; both fields may
coexist on one row.

**`links_out[]`** (v124, `#holders-site-links`) — optional. This belt's own
page on a living site the promotion’s own holder runs, as
`{url, label, kind, checked}` with `kind: "titlehistory"`. One shape and one set of
checks for all six record types that carry the field, documented under
[`links_out[]` (the holder’s-own-site link-out)](#links_out-the-holders-own-site-link-out).

## `shows.json`

One row per served card/document. `{id, type: "show", name, promotion,
also_promotions[]?, date: {date, precision, source?}, page, collection,
appearances[], matches[]?, venue?, city?, no_appearances_reason?,
notes?}`.

- `collection` — THE PROVENANCE WAVE: now a string (or, for a genuinely
  mixed-provenance document, an array of strings) pointing at
  `collections.json` accession lot(s), **mechanically derived from the
  served page's own stated source**, never guessed.
- `also_promotions[]` (JOINT-WING SHOWS, the Janitor, 2026-09-24;
  `CURATION.md` v121, `#joint-wing-shows`) — optional, an array of HELD
  promotion ids naming the other wings that jointly staged or hosted this
  one night. It sits **beside** the singular `promotion`, never instead of
  it: `promotion` is still the row's canonical home and still the shard key
  `shard-lib.mjs` assigns on (`shardOf()` is untouched), because the
  canonical-copy rule's own reason has not changed — two records of one
  night drift apart the moment anyone edits one and not the other. Four
  things `registry-validate.mjs` enforces as HARD failures: every id
  resolves to a `data/promotions.json` row; no entry equals the row's own
  `promotion` (a wing does not co-host with itself); no entry repeats; and
  the field is absent on a `collected: false` row (the collected edge's
  forbidden-field list grows by one — there is no document for a second
  wing to point at). Never written from an inference or a shared date: the
  row carries it only where the served document itself stages both
  institutions, or another primary source says the night was jointly
  staged, and the row's own `note` says which. **What it renders, all
  mechanically:** the shows instrument's `data-promo` carries every named
  wing's acronym AND id in the one pipe-delimited attribute THE DEEP-LINK
  ID BUG's fix established (v67(b)), so `/shows.html?promo=<either>` and a
  typed `promotion:<either>` both return the row with no change to
  `js/query.js`; each co-staging wing's holdings register gains ONE
  labelled pointer group ("Jointly staged, held on <wing>") — a pointer,
  never a second copy, so the register stays disk-derived-complete and the
  wing's own document count does not move; and the show's own served page
  carries one generated, marker-delimited, links-only line naming every
  wing that staged it (`<!-- jointwings:start/end -->`), museum-inserted
  presentation under the verbatim rule's chrome carve-out (v64, v70), never
  a word of the document's own text. **What it is not:** not a second
  holding and not a second row — `page`, `collection`, `appearances[]` and
  `matches[]` all stay the canonical wing's, so nothing is counted twice;
  and not a replacement for `affiliations.json`'s `crossover-booking`
  nature, which records that two institutions worked together while this
  field records that one particular night was both of theirs. An UNHELD
  co-host is a fact for the row's own `note` until its wing exists — the
  worked case is `prime-2003-great-american-nightmare-2007-2007-11-04`,
  PRIME and GCW in one building in Boston on 4 Nov 2007, which gains its
  GCW entry the day GCW's wing lands and not before.
- `language` / `country` (THE ECOSYSTEM EXPANSION GAVEL, 2026-09-05;
  `CURATION.md` v111(c)) — optional, the same value shapes as
  `promotions.json`'s own. **Absent means the promotion's own value** (which
  is itself absent-means-`en` for language). They exist so a document's
  language is queryable from the instrument pages; they are **not** the source
  of truth. The PAGE is — the per-wing holdings register is disk-derived by
  design ("a served file cannot exist unlisted"), and most supplemental
  documents (news, staff, rules, column, board, other) have no registry row at
  all. A value identical to the promotion's own soft-warns: a document-level
  override exists to record a DIFFERENCE — a guest column in English inside a
  Polish fed, a bilingual board post.
- `appearances[]`: `{who (entity id), kind, subtype?, capacity?, source?}` — `kind` is
  typically `"match"` or `"angle"`.
  - **`kind: "billed"` (THE BILLED APPEARANCE, the Janitor's gavel,
    2026-08-23, `CURATION.md` v76: *"use the DWO Almasy billing to cut an
    appearance on an uncollected show edge. We have primary source evidence
    of an appearance on that show, we just didn't collect it. Or it never
    happened, which is also an interesting quirk: the promised show that
    could never take place."*).** The third kind, and the narrowest: a
    `billed` row asserts that a primary source BILLED this entity for this
    show, and asserts nothing else. It is not a claim that the entity
    worked the show, not a claim that the match happened, and not a claim
    that the show itself ever took place — a card is a promise, and the
    museum holds plenty of promises whose results were never captured and
    some that were never kept. Because the claim is about a DOCUMENT rather
    than about the show, a `billed` row carries its own **`source`**
    receipt — required, a non-empty string naming the served page that did
    the billing (`registry-validate.mjs` hard-fails without it) — and an
    optional `note` for what only prose can carry. It renders as
    `(billed)`, never as a match, in the Appearances instrument, and it is
    permitted in two places the other kinds are not: on a `collected:
    false` row (the ONE clause of the collected edge below that this gavel
    relaxes, and only for rows where EVERY appearance is `billed`) and on a
    held card-only row whose own results page was never captured. Where the
    entity is billed from outside the promotion's own roster, the tenure
    that goes with it is graded `billing` — the appearance and the tenure
    make the same modest claim or neither is written.
  - **Fresh-filmed vs. archival replay (THE ANTI-DOUBLE-COUNT STANDING
    RULING — full incident and extraction gotcha in `docs/PROCESS.md`'s
    Serving section).** A row here is for what a show's own text
    describes as happening ON that broadcast. Replayed/clip footage
    reused inside a live show (a recap, a highlight reel) never earns its
    own `appearances[]` row on the AIRING show — it's evidence for the
    ORIGINAL show/reign instead, cited there. A cold-open sketch or
    flashback beat shot FRESH for that broadcast is not replay footage,
    even when it's staged as a flashback, and gets an ordinary row like
    anything else on the card — the test is whether the text describes
    new material or reused footage, never "does this look like a recap."
  - **The `ensure()`-kind-aware gap, and where it's actually closed
    (PERFECTION WAVE A, verified 2026-08-21).** The same anti-double-count
    extraction gotcha above has a sibling bug, caught twice in the fleet
    era and documented as a standing caution in `docs/PROCESS.md`'s
    Registry section: an `ensure()`-style helper (a lane-local extraction
    pattern — a helper that skips creating a row if ANY row for that
    entity already exists on the show) needs to be KIND-AWARE, not just a
    `who`-only check, or a pre-existing `angle`/`commentary` row for an
    entity silently suppresses adding that same entity's own `kind:
    "match"` row when they *also* wrestled on the same card. That helper
    itself does not live anywhere in `scripts/` — it's a pattern inside
    whatever ad hoc extraction script a given accession lane wrote for its
    own pass, never committed to this repo's own tooling, so there is no
    single function here to "fix." **The enforcement point is
    `registry-validate.mjs`'s own `matches[]`-vs-`appearances[]`
    reconciliation hard fail** (below, and the worked check in that
    script's own §6h): every id named in a show's `matches[]` — from
    `sides[]` AND `participants[]` alike (both shapes), and transitively
    `winners[]`/`losers[]` (constrained to already be one of that match's
    own entrants, which are already checked) and `eliminations[]`'s own
    `who`/`by` (constrained the same way, for any entry that resolves to a
    registered id rather than a verbatim billed label) — must also appear
    in that SAME show's `appearances[]` with `kind: "match"`, or the build
    fails outright naming both the show and the missing id. A lane
    session's own `ensure()` bug can silently drop the appearances row at
    extraction time, but it can never silently ship: the gate catches the
    mismatch the moment `matches[]` and `appearances[]` disagree, whether
    the cause was a kind-unaware helper, a hand edit to one array without
    the other, or anything else. Verified against the live check (no gap
    found): the hard fail's own `allIds` collection already spans both
    `sides` and `participants`, and `winners`/`losers`/`eliminations`
    entrants are independently required to be a subset of `allIds` before
    the appearances check ever runs against them — there is no path for a
    registered match participant to skip the `kind: "match"` requirement
    under either shape or through either plural-outcome field.
  - **`subtype`** (THE ANGLE SUBTYPES WAVE, part of THE GRAPH-ENRICHMENT
    WAVE) — optional, meaningful only alongside `kind: "angle"`
    (`registry-validate.mjs` hard-fails a `subtype` on a `kind: "match"`
    row — a structural mismatch, not a vocabulary quibble). Controlled-
    but-soft: `turn-heel` · `turn-face` · `unmasking` · `kayfabe-death` ·
    `wedding` · `betrayal` · `debut` · `retirement` · `reveal` ·
    `interference` — a soft-warned, not hard-failed, value outside that
    set, since the corpus is expected to stage angle shapes this list doesn't
    name yet; a genuinely new one is a deliberate addition to the
    controlled set, not a value invented in the data and left
    undocumented (`medium`'s own doctrine, one level down). Framework-only
    where unpopulated — most `kind: "angle"` rows correctly carry no
    `subtype` at all, exactly like `stipulation` below on a plain match.
    - **`interference`** (the Janitor's gavel, 2026-09-27, verbatim: *"add
      the interference subtype"*; `CURATION.md` v125,
      `#match-method-and-interference`) — the tenth value, minted on the
      688 `interfered` credits Argyle's verified split carries. An
      interference FLATTENS to a plain angle, the same as a backstage
      segment: one `appearances[]` row, `kind: "angle"`, `subtype:
      "interference"`, on the show. It names **no match** — the appearance
      shape names none, and the gavel deliberately did not add one — and
      the entity in it is never also in that match's own
      `sides`/`participants`, both because a `subtype` on a `kind:
      "match"` row is the structural mismatch this field already
      hard-fails and because a competitor's own foul inside his own match
      is not this field at all (that is the match's own `note`, and
      `method: "dq"`). **Who counts**, as Argyle settled it across the UWF
      and FSW splits: a non-competitor who physically ACTS inside the
      match (a catapult, a spear, a kick, a frying pan); a non-competitor
      physically ACTED UPON in the match's action (his acted-upon rule —
      decapitated, spat on, buried under the bunnies); a DISTRACTION the
      served text ties to the finish (*"a distraction that decides the
      finish counts as interference"*); and a billed team or stable beside
      its own interfering members, where the unit's text names it. **Who
      does not**: presence alone (*"characters present on a match who
      don't interfere: drop them"*), words alone that do not decide the
      finish, urging a run-in on without landing a blow, official acts
      (setting a stipulation, ringing the bell, restarting a match),
      handing over a robe, a commentator called into the unit as a
      commentator, and a referee or other official bumped or shoved in the
      ordinary course — the one exception the acted-upon rule carries, and
      only for officials (*"the only exception is referees, not
      announcers"*). The rulings are quoted in full in `CURATION.md` v125(e)
      with their own show and unit receipts.
  - **`capacity`** (THE STAFF PRESENCES WAVE) — optional, the role a
    non-wrestler carried on this specific show: `commentary` · `referee`
    · `ring-announcer` · `authority` · `interviewer` · `manager` (minted
    2026-08-26 — six CSWA tier-3 extraction lanes independently hit the gap). Controlled-but-soft,
    same non-closed-list posture as `subtype`. Distinct from a tenure's
    own `roles[]` (`characters.json`/`units.json`, fed-wide across an
    entire tenure) the same way `appearances[]` itself is distinct from a
    tenure — this is what the record shows them doing on THIS show, not
    a standing classification of the entity. A referee or commentator's
    presence still gets an ordinary `appearances[]` row (`kind: "angle"`
    unless they're also in the match itself), `capacity` is the added
    facet that makes `roles:commentator`-style discovery findable per
    show, not just per tenure.
- `matches[]` (where structurally re-parsed): `{order, sides: [[ids],
  [ids]], winner_side?, stipulation?, method?, ...}` — the basis for the
  `opponent:`/`opponents` derived search fields and the
  observed-moves/opponent-frequency joins.
  - **The unminted-entrant asymmetry, stated explicitly (fleet-era
    convention, hard-enforced by `registry-validate.mjs`).**
    `sides[]`/`participants[]` hold **registered entity ids only** — an
    entrant who doesn't clear the mint bar (see `docs/PROCESS.md`'s
    Registry section) is never inserted as a raw string in either array;
    a scattered/battle-royal field is recorded either at the granularity
    the corpus actually supports (each resolvable entrant as its own
    `sides` singleton, an unresolvable one simply omitted — GIWF's own
    `giwf-global-1999-09-15` row is the worked precedent) or, once a
    match is over, via `winner`/`winner_side`. `eliminations[]` is the
    ONE array in this schema that deliberately allows the opposite: its
    own `who`/`by` fields accept either a registered id OR a verbatim
    billed label for an entrant who never meets the mint bar (see
    `eliminations` below) — because a battle royal is routinely full of
    one-off names that were never going to justify a full entity record,
    and the elimination SEQUENCE is still real, honest data worth keeping
    even when the eliminated entrant isn't. The asymmetry is deliberate,
    not an inconsistency: `sides`/`participants` describe WHO fought (a
    structural, validator-checked graph edge, so it only ever points at
    real registered entities), while `eliminations[]` describes WHAT
    HAPPENED, in order (a narrative sequence, which can honestly name an
    unminted entrant the same way a caption or an epitaph's own prose
    can). Never "solve" a thin battle-royal entrant by minting them just
    to satisfy `sides[]` — that's exactly the thin-mint pressure the
    `eliminations[]` label escape hatch exists to relieve.
  - **THE MATCH-SIDE CONVENTION: a side names the unit AND its members
    (the Janitor's gavel, 2026-09-02, the workshop's `GAVELS.md`).** The
    asymmetry above says which ids may go in a side; this says which ids
    must. Until this date the schema was silent on it — "registered
    entity ids" put `characters.json` and `units.json` ids side by side
    as peers with no tiebreak — and the corpus answered it both ways,
    wing by wing, almost exactly down the middle: 1,370 sides naming only
    the unit, 1,568 naming only the members, 33 naming both (the audit is
    the workshop's `match-side-convention-audit-2026-09-02.md`). **A
    side that includes a registered unit lists the unit id AND every
    member id that unit's own `members[]` roster gives — unit first, then
    members in roster order.** The gavel's reason is the graph, not
    tidiness: a side naming only the team hides that night from each
    wrestler's own record, a side naming only the wrestlers hides it from
    the team's, and the same match filed as two half-truths means neither
    query returns the whole run. Both facts are true at once; the side
    says both. **`appearances[]` mirrors `sides[]` 1:1** — which is not a
    new rule but the existing reconciliation hard fail above (~line 1514
    on) applied to the new shape, so a tag match now yields a `kind:
    "match"` row for the unit AND one for each member named in the side,
    and the build fails naming any id the two arrays disagree on. **The
    exception is honest absence, not an escape hatch:** a unit whose
    roster never survived — `membership_unknown: true`, or a `members[]`
    of name-only entries with no `character_id` — stands ALONE in the
    side, flagged, never filled in with names nobody recovered; 399 of
    the 1,370 unit-only side instances at the gavel were exactly this,
    listed in
    the workshop's `match-side-normalisation-skipped-2026-09-02.tsv`. A
    partially-recovered roster contributes the members it actually has.
    `registry-validate.mjs` carries the convention as a pair of SOFT,
    non-blocking advisories (a side naming a unit without its own
    members; a side naming 2+ characters who share a `units.json`
    membership with no unit id) — soft deliberately, because the
    roster-less exception is legitimate data and 166 wings of pre-gavel
    accession are honest history rather than a defect.
    `scripts/normalise-match-sides.mjs` is the idempotent mechanical arm
    that closes the gap wherever the roster supports closing it, so a
    wing re-processed later can be re-normalised without re-deriving the
    method.
  - **`stipulation`** (THE MATCH STIPULATIONS WAVE, the Janitor: "how else am
    I going to find all of the Venetian Home Rumbles?") — verbatim,
    copied byte-for-byte from how the fed's own card/show text staged the
    match ("Venetian Home Rumble," "Steel Cage," "Ladder Match," "Falls
    Count Anywhere") — never normalized, never invented. **Absence means
    a plain singles/tag match, and is never narrated as such** — a bare
    match with nothing distinguishing it about its own stipulation simply
    carries no field, the same honest-absence posture `no_appearances_
    reason` and `subtype` both already use. See `stipulation-
    families.json` immediately below for the finding-aid layer this
    verbatim field feeds.
  - **`stip`** (the Janitor's gavel, 2026-10-03 D249, verbatim: *"1. Add
    `matches[].stip` (his codes, a list; schema + converters; the families
    stay for wording)"*; `CURATION.md` v127, `#match-stip-codes`) —
    optional, a LIST of Argyle's own stipulation shortnames, copied verbatim
    from his database's key for the match (`["ironman"]`, `["ladder",
    "nodq"]`, `["standard"]`). It sits BESIDE `stipulation` and never
    replaces it: `stipulation` is how the fed worded the match, and it is what
    renders; `stip` is the code his database files the kind of match under,
    and it is what links the same kind of match across promotions. Every value
    must be a `code` in `data/stip-codes.json` (`registry-validate.mjs`
    HARD-FAILS any other, a duplicate, or a non-list): his list is the
    vocabulary, and a stipulation it lacks is a question for him, never a
    code of ours. `standard` is his code for a match with no special rules
    and stands alone (beside another code it is a soft line). **Absence means
    no code is known** and is never narrated; a fed whose database carries no
    key simply has no field. **Never inferred**: a value is copied from his
    committed rows (through a read-only export or the converters), never read
    off the wording of `stipulation`, never guessed from a family. Codes that
    are not match kinds (`nontitle`, `contender`, `debut`, the catch-all
    `stipulation`) are carried exactly as he filed them; they map to no
    family. The finding-aid layer below reads `stip` through
    `data/stip-codes.json`'s `families`, so a family filter finds a match by
    its code as well as by its string.
  - **`result`** (THE DECLARED-OUTCOME SCHEMA FIX, 2026-08-20, the Janitor's
    own words on the founding case: *"An explicitly declared draw should
    be logged as draw. An unresolved/unparsed finish as unset."*) —
    optional, meaningful only on a `sides`-shaped match. A **declared-
    outcome** representation, not a draw-only boolean, controlled to two
    values: `"draw"` (the served text explicitly resolves to a draw —
    "The Match is a Draw!," a double-countout call) and `"no-contest"`
    (the served text explicitly rules a no-contest — a referee's own
    on-page "the match is No Contest!" call, distinct from a draw).
    Generalized to `"no-contest"` the same day, one enum value past the
    the Janitor's own founding case, on the same principle stated once and
    applied twice: **a declared outcome is a fact, `winner_side` simply
    being ABSENT is reserved for the genuinely different third case — the
    outcome wasn't parsed at all, i.e. unset/unresolved.** Designed
    consistently with the existing `winner_side` shape rather than as a
    parallel mechanism: `winner_side` present means a resolved winner;
    `result` present means the served text explicitly declared a
    non-winner outcome; NEITHER present means what it always meant — the
    outcome wasn't parsed. A match never carries both `result` and
    `winner_side` at once (`registry-validate.mjs` hard-fails the
    contradiction) — a declared non-winner outcome and a resolved winner
    can't both be true of the same match. `result` is valid on EITHER
    match shape (amended 2026-08-20 after two served declared outcomes —
    a double-DQ and a double-knockout draw — landed on matches whose
    opponents never resolve to registered ids: the fed's own declared
    ruling is a fact regardless of whether every entrant is mintable; on
    a `participants` row the contradiction check runs against `winner`
    instead of `winner_side`). **What
    `result` is NOT for**: an interrupted or no-bell segment the served
    text never formally rules on at all (a squash cut short by a beatdown
    angle, say) stays exactly what it always was — `sides` present, no
    `winner_side`, genuinely unresolved — never a guessed `result` value;
    the field exists only for outcomes the served text explicitly
    DECLARES, not for every non-clean finish.

    **`"double-pin"` — the third value (2026-08-26, a coordinator-delegated
    dry mint on the NFW tier-3 crawl).** The served text explicitly rules
    that BOTH sides scored the fall at the same moment — a referee
    announcing a simultaneous three-count and declaring both competitors to
    have pinned. That is not `"draw"` (the fed did not call it a draw; it
    called it two pinfalls), not `"no-contest"` (the match resolved, and
    resolved twice), and not unset (nothing was left unparsed — the ruling
    is on the page). The receipt: `nfw-crash-tv-9-2002-04-25`, Steel Viper
    vs. Tempesta del Fuerte, where guest referee Adrenaline ruled both men's
    shoulders down and announced that both had scored the pinfall — and the
    fed booked a three-way between all three men off that ruling. Three
    extraction lanes hit the shape independently and left the field unset
    with the ruling in a match note, which is what a missing enum value
    looks like from the inside. Distinct from `winners[]`, which records
    plural VICTORS of one match: `double-pin` is the opposite reading, a
    match the fed declined to award to either side while refusing to call
    it a draw. A related shape the corpus also stages — a **double
    knockout** — maps to `"no-contest"` and not here: nobody scored a fall
    in it.
  - **`method`** (the Janitor's gavel, 2026-09-27 D105, verbatim: *"a new
    field, method"*; `CURATION.md` v125, `#match-method-and-interference`)
    — optional, HOW the match ended, in one controlled value, on either
    match shape. `result` says the fed declared no winner; `method` says by
    what means it ended, and the two are different questions that routinely
    ride one row. The eleven values are Argyle's own decision vocabulary
    (the eleven his verified split codes every finish as, each evidenced by
    a quoted paragraph), slugged the house way: `pinfall` · `submission` ·
    `dq` · `countout` · `knockout` · `stipulation` (the match's own
    stipulation was the method — a Last Man Standing count, a cage escape;
    `stipulation` above says which) · `forfeit` · `time-limit` ·
    `no-decision` · `reversed-decision` (an official reversed a decision
    already announced; the row's own winner is the fed's final word, never
    the first) · `sleeper` (his database's own eleventh code, kept rather
    than folded into `submission`: a named sleeper read out as the finish is
    `sleeper`, a hold the loser is shown consenting to is `submission`).
    **The set is CLOSED by gavel**: `registry-validate.mjs` HARD-FAILS a
    twelfth value, because a twelfth is a typo or an undocumented invention
    (`medium`'s own doctrine, one level down) and because `method` is minted
    empty — there is no legacy shape inside it to tolerate. **Absence is the
    twelfth case and is never narrated** — his code 0, "no method", is
    simply no field, the same honest-absence posture `stipulation`,
    `subtype` and `no_appearances_reason` hold. **Never inferred**: the
    value is written only where the served text (or the holder's own
    verified split, whose paragraph the lane quotes) says how the match
    ended — never from the fact that somebody won, never from a finisher's
    name, never from a stipulation's name alone, never from a title changing
    hands. **`method` and `result` coexist freely**, and no contradiction
    check forbids `method` beside `winner_side` or `winner`: a
    double-countout is `result: "draw"` + `method: "countout"`, a time-limit
    draw `result: "draw"` + `method: "time-limit"`, and a clean pinfall is
    `winner_side` + `method: "pinfall"` — that pairing is the whole reason
    the field exists (*"every title change by DQ"*). A segment the served
    text never rules on at all still carries neither field. The validator
    adds one SOFT line for `method: "stipulation"` on a row with no
    `stipulation`, because that value points at a stipulation the row then
    fails to name.
  - **`finish`** (accession-lane practice since the first structurally
    re-parsed wings; DOCUMENTED, not created, by the Janitor's D105 gavel of
    2026-09-27. His typed words were only *"a new field, method"* — the
    option he chose is the one that read "`finish` stays the told sentence,
    which is good material, and nothing has to move", against the
    alternative of keeping the name and migrating 2,062 sentences out;
    `CURATION.md` v125(d), `#match-method-and-interference`) — optional, FREE PROSE and
    deliberately uncontrolled: the museum's own one-sentence telling of how
    this match ended, the row-level sibling of a placard's narration. 2,062
    rows across fifteen wings carry it (empire-pro-wrestling 555, euwc 520,
    jpa-2000 353, war-1995 169, and eleven more) and every one holds a
    sentence — *"Dan Ryan hit the Humility Bomb for the pin."*, *"Champion
    Alucard Belmont retains by disqualification in 14:18 after Aero's
    ringside interference with a fire extinguisher backfires on Vic
    Valiant."* D105 chose a NEW field for the controlled value (`method`,
    above) precisely so that these sentences stay where they are and read as
    they read: `finish` is **never** checked against the eleven, never
    normalised, never regexed into a slug, never moved into the row's `note`,
    and never renamed. It may carry a method the eleven have no value for,
    name the move, name who interfered, give the time — that latitude is the
    field's purpose. The gate asks of it only what it asks of any optional
    string: present means a non-empty string. Where both ride one row they
    say different things and must not contradict each other: a lane writing
    `method` beside an existing `finish` READS the sentence first, and where
    the sentence says disqualification the method is `dq`. **Two informal
    siblings are NOT promoted and NOT documented as keys**: `win_method`
    (451 rows, near-controlled — `pin`, `pinfall`, `submission`,
    `disqualification`) and `how` (2,220 rows, a seventh slug-shaped and the
    rest prose, partly written by `scripts/fixers/fix-matches-shape.py`,
    which since 2026-09-09 parked an out-of-enum `result` in a `how` note
    reading `finish: dq`). Neither is a documented match key and neither
    ever was. A later lane MAPS their clean values into `method`, reading
    each row rather than regexing the column, and LEAVES THEIR PROSE WHERE
    IT IS; the fixer's ad-hoc convention is retired at the same time,
    because the fact it was parking in a note has a field now.
  - **`winner`** (THE BATTLE-ROYAL WINNER SCHEMA FIX, 2026-08-20,
    Janitor-gaveled) — optional, a single entity id, meaningful only on a
    `participants`-shaped match (never `sides`, which already has
    `winner_side` for exactly this). Exists for a many-entity field (a
    battle royal, a rumble) whose winner the corpus resolves cleanly even
    though the entrants themselves were never parsed into `sides` — the
    established convention for a battle royal WITH a known winner and
    resolvable sides is still `sides: [[id], [id], ...]` +
    `winner_side` (each entrant as its own singleton side, not every
    entrant needs to be resolved, just the ones you can plus the winner
    — GIWF's own `giwf-global-1999-09-15` row is the worked precedent);
    `winner` is for the narrower case where that shape genuinely doesn't
    fit — a scattered, no-ring, or otherwise un-sided battle royal
    (WWA's own "Bourbon Street Brawl" is the worked example: 15 entrants,
    fought across the city, structurally recorded as a flat
    `participants` list because there was never a "side" to assign, with
    the corpus's own text separately naming a winner) — the winner id
    must resolve to a real entity AND appear in the match's own
    `participants` array. Absence of `winner` on a `participants` row
    means what it always meant: the winner wasn't resolved, never
    guessed.
  - **`eliminations`** (THE ELIMINATION-SEQUENCE SCHEMA FIX, 2026-08-20,
    Janitor-gaveled after the WWA campaign's third large multi-team
    elimination match landed its sequence in a prose `note`) — optional,
    an ordered array on either match shape; **array order IS the
    elimination sequence**, first out first. Each entry:
    `{who, by?, time?, note?}`. `who` — required — is the eliminated
    entity's id when minted, else the verbatim billed label (battle
    royals are full of one-off entrants who never meet the mint bar; a
    label there is honest, not a dangling reference). `by` — optional,
    string or array — the eliminator(s), same id-or-label rule. `time` —
    optional — the verbatim elapsed/clock time when the served text
    gives one (the XUW corpus's own `0:33:36`-style elimination stamps
    are the worked example). `note` — optional — receipts-style, for
    what only prose can carry (a costume gimmick, a run-in that caused
    the elimination). Validation: an id-shaped `who`/`by` that resolves
    to a REGISTERED entity must also appear in the match's own
    `sides`/`participants` (a registered eliminator who isn't in the
    match is a typo, hard fail); an unresolvable label passes untouched.
    The final survivor is NOT an eliminations entry — the winner is
    already `winner_side`/`winner` (or `winners`, below); `eliminations`
    records the order of
    the falls, not the verdict. Finding candidates for retro-application
    is a stipulation-families query away (Battle Royal / Rumble /
    elimination families) — sequences previously recorded in match
    `note` fields convert whenever a pass touches them; the note stays
    if it carries anything the structured entries don't.
  - **`winners` / `losers`** (THE PLURAL-OUTCOME SCHEMA FIX, 2026-08-21,
    Janitor-gaveled after the corpus kept staging co-champion double-pins
    and a four-winner contract scramble) — symmetric optional arrays of
    entity ids, valid on either match shape, every id validator-checked
    against the match's own entrants. **Use only when the outcome is not
    derivable from the existing fields**: a single winner is
    `winner`/`winner_side`, and losers are ordinarily just
    everyone-who-isn't-the-winner and need no field at all — that
    derivability is why no losers field ever existed. `winners` (2+ ids)
    is for a match genuinely resolved with plural victors — the Vortex
    100 dual-three-count co-champions, Mayhem 35's double-pin co-IC
    reign, the Bridge Barnstormer's four contract-grabbers. `losers`
    (1+ ids) is for the rarer mirror — a match resolved by identifying
    who LOST rather than who won (last man eliminated is fired; everyone
    advances but one), where subtraction can't express it. The
    consequential fall-taker inside a losing side is NOT this field —
    that's `eliminations[]`/`note` territory. `winners` never coexists
    with `winner`/`winner_side` (mutually exclusive) nor with `result`
    (a resolved plural outcome and a declared non-winner outcome are a
    contradiction). Declared co-outcomes of the STAKES without match
    victory (the Sins of the Past co-#1-contenders, both eliminated
    simultaneously) stay in the unresolved-plus-note shape — `winners`
    records who won the match, never who won the consequences. The
    retro-application finding aid is mechanical: any SINGLES title reign
    with multiple holders marks a co-champion event whose staging match
    is a `winners` candidate.
- `venue` / `city` (THE SHOW VENUES WAVE) — optional, staged geography
  only: what the show's own text actually named ("the Polish Hall," "a
  Dublin pub," "a flea market"), copied as the fed staged it, not
  inferred from a promotion's general home turf. `venue` is the named
  place (a hall, a bar, an arena); `city`/region is the place-name
  alongside it where the source gives one (Tokyo, Guadalajara,
  Edmonton). Either, both, or neither — honest-absent is the default and
  correct state for the great majority of shows, whose own text never
  says where it happened.

Example:

```jsonc
{
  "id": "iwf-blood-bath-may22-1998", "type": "show", "name": "Saturday Night Blood Bath",
  "promotion": "iwf", "date": { "date": "1998-05-22", "precision": "exact" },
  "page": "/promotions/iwf/archive/may22.html", "collection": "0004",
  "appearances": [ { "who": "grim-reaper", "kind": "match" }, { "who": "rob-williams", "kind": "match" } ],
  "matches": [ { "order": 1, "sides": [["grim-reaper"], ["rob-williams"]], "stipulation": "Steel Cage" } ]
}
```

---

**`links_out[]`** (v124, `#holders-site-links`) — optional. This show's own
page on a living site the promotion’s own holder runs, as
`{url, label, kind, checked}` with `kind: "results"`. One shape and one set of
checks for all six record types that carry the field, documented under
[`links_out[]` (the holder’s-own-site link-out)](#links_out-the-holders-own-site-link-out).

## `stipulation-families.json`

THE MATCH STIPULATIONS WAVE — a NAVIGATION-ONLY finding-aid layer over the
verbatim `matches[].stipulation` strings documented above, the exact same
doctrine `style-families.json` already established one entity-field over
(see that file's own entry below for the full doctrine — grouping is
navigation, the verbatim string is always what renders). `{_schema_version,
families: {FamilyName: [verbatim variant, ...]}}` — every variant listed is
copied byte-for-byte from an actual `stipulation` string somewhere in
`data/shows.json`, never retyped/normalized by hand. Starting families (a
starting point, not a closed list, exactly like `style-families.json`'s
own): `Cage`, `Ladder`, `Battle Royal`, `Death Match`, `Falls Count
Anywhere`, `Rumble` (the family the Venetian Home Rumble — every one of
them, across every year the corpus stages — is the Janitor's own exemplar
for: "how else am I going to find all of the Venetian Home Rumbles?"). A
composite stipulation string may appear under more than one family (a
"Ladder Match, Falls Count Anywhere" bout is both); anything that can't be
honestly placed is simply left out of every family, same as
`style-families.json`'s own mojibake/data-artifact carve-out.

```jsonc
{
  "_schema_version": 1,
  "families": {
    "Rumble": [
      "Venetian Home Rumble"
    ]
  }
}
```

Consumed the same way `style-families.json` is: `scripts/cross-reference.mjs`
widens a match/show's own filterable attribute with every family a raw
stipulation resolves to; the verbatim string stays what actually renders.
`scripts/registry-validate.mjs` soft-warns on the same two hygiene
conditions style-families.json's own check already uses — a distinct
registry `stipulation` string no family claims, and a mapped variant no
current match row still carries.

A match's `stip` codes (above) widen the same attribute: every family
`data/stip-codes.json` gives a code is added beside the families the verbatim
string resolves to, so `stipulation:"iron man"` finds an Iron Man match by its
fed's wording or by Argyle's `ironman` code, whichever the row carries. The
codes themselves (and his display names, where known) ride a separate
`data-stip` attribute (`stip:ironman`).

---

## `stip-codes.json`

The known list `matches[].stip` is checked against (the Janitor's D249,
2026-10-03; `CURATION.md` v127, `#match-stip-codes`): one row per Argyle
stipulation shortname. `{_schema_version, _source, codes: [{code, name,
families}]}`. `code` is his shortname verbatim (lowercase letters and digits);
`name` is HIS display name for it (his `efed_list_stipulations` table), copied
from a read-only export, or `null` until that export arrives — never written by
us; `families` lists the `stipulation-families.json` families the code belongs
to, or `[]` for a code that is not a match kind (`standard`, the catch-all
`stipulation`, `nontitle`, `contender`, `debut`) or has no family yet. The list
is built by the workshop's `build-stip-codes.py` from the
crosswalk (the workshop's `CROSSWALK.tsv`);
a code his table gains is added there first, then here, never invented in the
data. `registry-validate.mjs` hard-fails a duplicate code or a malformed row,
and soft-warns a family the finding aid does not carry.

```jsonc
{
  "_schema_version": 1,
  "codes": [
    { "code": "ironman", "name": "Iron Man Match", "families": ["Iron Man", "Multi-Fall"] },
    { "code": "nontitle", "name": null, "families": [] }
  ]
}
```

---

## `rps.json` / `rp-catalog.json`

`rps.json`: one row per served roleplay/promo. `{id, type: "rp", title,
involves[] (entity ids — who's credited as writing/starring), references[]
(entity ids namedropped, not credited as author), promotion, date: {date,
precision, source?}, served_url, source, collection}`. `collection`
follows the same accession-lot rules as `shows.json`. `promotion` is
optional and set only when a held federation claims the text (the Janitor's
D407, 2026-10-06): a roleplay no held fed claims is served "(A) on the hub"
where it was posted, with the optional `venue` naming that hub's row
(`type: community-hub`) and its `involves` holding at least one resolving id
(both hard in `registry-validate.mjs`), its character gets "(A) none", no hub
tenure, and a roleplay naming a fed not yet held is "(A) serve now, add the
fed later", its `promotion` added through `rps-corrections` when the wing
lands and its `served_url` unchanged.

`language` / `country` (THE ECOSYSTEM EXPANSION GAVEL, 2026-09-05;
`CURATION.md` v111(c)) are optional on an `rps.json` row on exactly the terms
`shows.json` states above: same value shapes as `promotions.json`, absent
means the promotion's own value, the served page is the source of truth, and a
value identical to the promotion's own soft-warns because an override exists
to record a difference.

**THE RP DATE NORMALIZATION (REVIEW-FIXES WAVE, 2026-08-22)**: `date.date`
is STRUCTURED (ISO-shaped at whatever precision is honest), never verbatim
byline junk ("Today", "Sept 8th", "12/2") — the verbatim byline survives
in the date's own `source` field (`byline reads "Sept 8th"; year anchored
by the board's own numbered promo sequence`), and on the served page
itself, which keeps its own doc-date line. The UWF board's numbered promo
sequence is a legitimate dating receipt: a month/day byline inherits its
year from the surrounding dated promos (exact precision), an undated promo
is placed to month/year precision by majority vote of its nearest dated
neighbors, and a promo the sequence can't bracket stays honestly
`unknown` with the byline preserved. Instruments sort and display on the
structured field only.

`rp-catalog.json`: the wider, unserved-yet catalog of every RP the fed's
own database ever indexed, held or not. **Stays a monolithic cross-
promotion source (THE SHARDING MIGRATION's own "Sharding" section
above) — most rows carry no `promotion` field and no reliable way to
derive one.** `{title, author?, author_unknown?,
kind, board_number, location, held: boolean, url, rps_id?, show_id?}` —
`held: false` rows are exactly the "we know this existed, we don't have
the text" gap list; a resurrection pass (see `docs/PROCESS.md`'s Mining
section) flips rows toward `held: true` as they're recovered, pointing at
wherever the served document actually landed: **`rps_id`** (the original
shape — served onto `rps.json`) or **`show_id`** (THE SHOW_ID ALTERNATIVE,
OSW's final push — a `kind: "match-report"`/`"incard"` row served onto
`shows.json` instead, since a match result or backstage segment carries
`appearances[]` and belongs on the show record, not filed as a roleplay).
Exactly one of the two on a `held: true` row, never neither, never both.

**`author` is optional (THE AUTHOR-OPTIONALITY WAVE, OSW batch 6).** A
catalog row's whole point is "known to exist, from the fed's own results/
promo index" — and that index doesn't always name a writer (a bare
match-report title crediting no one, say). A row carries EITHER a
resolvable `author` (an id in `characters.json`/`units.json`) OR the
explicit `author_unknown: true` flag — never neither (a silent gap
`registry-validate.mjs` hard-fails on, hunting exactly the false-attribution
trap a title-guessing heuristic falls into), never both (soft-warned, drop
the flag once an author is actually known). This mirrors
`units.json`'s own `members[]`/`membership_unknown` mutual-exclusivity
doctrine exactly — the same "say plainly, in data, that it's not
recoverable yet" shape, on a scalar field instead of an array. Set `author`
whenever the source text actually names one; `author_unknown: true` is
never a shortcut to skip checking. Rendering (a wrestler page's own
"Roleplays" section, grouped by author) simply has nothing to show for an
`author_unknown` row until an attribution is found — the row still exists,
honestly, in the catalog itself.

---

**`links_out[]`** (v124, `#holders-site-links`) — optional. This roleplay's own
page on a living site the promotion’s own holder runs, as
`{url, label, kind, checked}` with `kind: "rp"`. One shape and one set of
checks for all six record types that carry the field, documented under
[`links_out[]` (the holder’s-own-site link-out)](#links_out-the-holders-own-site-link-out).

## `affiliations.json`

Edge list between promotions — every inter-promotion fact the registry
holds, lineage (`successor-of`) included as of A7 (see below); the earlier
distinction between "connection" here and "family" on a bespoke
`lineage`/`family` promotion field is retired. `{a: {id} | {name, unheld:
true}, b: {...}, nature, source, period?, status_note?, grade?}`.

`nature` (rendered with direction-aware labels — `a`/`b` are not
symmetric for most natures): `alliance-member` (`a` = member, `b` =
alliance), `alliance-operator`, `affiliate-listing`, `ownership`,
`acquisition`, `academy`, `sister-promotion`, `shared-continuity`,
`invading-faction`, `crossover-booking`, `rivalry`,
`shared-ownership` (A6, see below), `successor-of` (A7, see below),
`community-presence` (A8, see below).

**`shared-ownership` (A6, THE SHARED-OWNERSHIP EDGE, 2026-08-19).** A
genuine out-of-fiction common-owner fact — distinct from an in-fiction
alliance structure (`alliance-member`/`-operator`) or a narrative-
continuity claim (`shared-continuity`) — receipted against a real
document, never asserted as prose and never naming the operator (the
privacy rule). Symmetric; rendered GROUPED, one line per promotion naming
every other promotion it shares an owner with ("Shared ownership: A, B,
C"), never one line per pairwise edge. Seeded from the withheld OSW Rules
page (the workshop's `osw.ewmuseum.com_content.php_p_rules...txt`,
mirrored by ewmuseum.com, never served verbatim — a genuine out-of-
fiction copyright notice, not museum content) naming twelve promotions
under one real-world operator; held members (PCW, PTC, OSW) get pairwise
edges among themselves, unheld members get an enriched `frontier.json`
row citing the same receipt instead — deliberately NO family label and NO
operator name anywhere in the Museum's own voice.

**`successor-of` (A7, THE LINEAGE-EDGES WAVE, 2026-08-19, the Janitor's
gavel).** "`a` is successor-of `b`" — one continuous history under a
different name (`a` = the later promotion/name, `b` = the earlier one it
continues from). Replaces the retired `lineage`/`family`/`family_note`
promotion fields outright (see `promotions.json`'s own entry above) —
the same fact, expressed as an edge instead of a bespoke field, so a
promotion just "notes that it was the successor to IWF and the
predecessor to the UWF" the same way it notes any other connection.
Direction-aware labels: "Successor to" (as `a`) / "Predecessor to" (as
`b`). A promotion in the middle of a chain (GIWF: successor to IWF,
predecessor to both UWF and XUW) carries one edge per link, not a single
special-cased row.

**`community-presence` (A8, THE COMMUNITY-PRESENCE EDGE, the Janitor,
2026-08-24).** "`a` had a presence in the community `b`" — `a` = the
promotion, `b` = the community itself, which is held as an ordinary
promotion row like any other (`rspwf`, the newsgroup; `cyberslam`, a
house network). **Deliberately medium-agnostic.** The venue's own medium
is already recorded on the target's own `medium` field, so ONE nature
covers a fed posting to Usenet, advertising on a board, or turning up in
a subreddit — the relation being recorded is the *presence*, not the
channel it happened over, and a nature per medium would need a new token
every time the hobby moved house. **Advertising and recruitment count:** a
promotion does not have to have carded a show in the community to have
been present in it — GIWF, the founding case, recruited on
rec.sport.pro-wrestling.fantasy for two years and posted no card there at
all.

Why the edge exists: **the migration map.** A promotion's connection to
every community the collection holds, drawn as edges, is what makes it
possible to see communities rising and falling over time — which wings
lived on the newsgroup, which grew up on boards and hosted sites instead,
and when the hobby moved. That structure is only worth having if every
edge on it is a positive identification, so edges are drawn **one wing at
a time, on roster- or name-level evidence**. An acronym overlapping a
wing's recorded span is NOT an identification: the same pass that
produced the first edge found three different GIWFs in one index. Direction-
aware labels: the promotion's own page names the community ("Community —
{P} was present here"); the community's own page names the promotion
("Present in {P}").

An unheld party (`{name, unheld: true}`) points at `frontier.html`
instead of a wing; a bare acronym with no recovered expansion stays bare
rather than inventing one.

---

## `frontier.json`

Promotions named in the record but not (yet, or ever) held — the
expansion ledger. Object-shaped (not array-wrapped): `{_schema_version,
_dead_only_rule, _status_values, rows: [...]}`.

`_status_values` (`FRONTIER_STATUS`): `unverified` · `verified-dead` ·
`verified-alive` · `mined` · `held`. **Gated by the dead-only rule
exactly like everything else** — a frontier row is a place the record
points, not an invitation to go mine it; nothing is pursued until its
status reads `verified-dead`.

Row shape: `{name, first_seen_in, status, notes?, memorial_linked, last_checked?, check_cadence?, founded_year?}`.

`observed_year` (frontier rows, optional int): the earliest year a source *attests* the promotion operating — "operational as of X, so founding ≤ X." Weaker than `founded_year` and never a substitute: a dated directory listing, a capture, or a card qualifies. Added by the Janitor's ruling of 2026-08-24 on the DCLinks harvest, whose listings carried submission dates but no founding claims.

`queue_year` / `queue_year_basis` (frontier rows, optional int + string; 2026-10-08, the Janitor: *"priority should be based on the earlier year we observed them"*, *"there's no real harm in continuing to put every year at different priority numbers"*): the row's EARLIEST ATTESTED year, and the field that produced it. This is the ONE sort key the collection queue and `/frontier.html` share (the law is the workshop's `QUEUE-POLICY.md`; the key itself is one function in the workshop, `tools/year_key.py`, which also bands the Wayback and Common Crawl legs), so the served order and the order the collection actually runs cannot drift apart. `queue_year` is **ABSENT, never null**, when nothing on the row dates it — those rows sort after every year. `queue_year_basis` is always present and names its own evidence: `founded_year`, `observed_year`, `first_seen_in:<year>`, `name:<year>`, `held-wing:<id>`, `last_activity`, `notes:<year>`, or `unknown`. Both are DERIVED, never hand-written: a curator who learns a real year sets `founded_year`/`observed_year` and the key follows on the next preflight (`scripts/fixers/fix-frontier-queue-year.py`). The two BOUND bases say so: `held-wing` dates a row to the founding year of the held wing whose pages name it, and `last_activity` is an upper bound — both are read only when nothing better speaks.

`community_presence` (frontier rows, optional array): where and when we saw a promotion *advertised* in a community we track — each entry `{hub, first_seen (year), last_seen (year), source}`. The frontier-layer twin of the held-graph `community-presence` affiliation edge (a held wing carries the edge in affiliations.json, e.g. `giwf → rspwf`; a frontier row carries the relationship here). Added by the Janitor's ruling of 2026-08-24 — the frontier should say not just that a promotion existed but when we saw it and where it was advertised; feeds the migration map. First populated for the r/efeds birth-registry feds (`hub: "r-efeds"`).

`medium` (frontier rows, optional): a frontier row's medium, validated against the promotions media values. **Absent means web-era** — the default is never written (the no-redundant-narration rule). Set only for non-web entities; the first admitted values are `tabletop-rpg` (the ADW precedent) and `play-by-mail` (the mail-moderated league form, opened by the Janitor's print-era gavel of 2026-08-24: "Everything is welcome here").

`language` / `country` (frontier rows, optional; THE ECOSYSTEM EXPANSION GAVEL, 2026-09-05, `CURATION.md` v111(c), widened onto the frontier by the coordinator's ruling of the same day because the discovery lanes per non-English scene cannot record what they find without them): the same value shapes and the same postures as `promotions.json`'s own — BCP-47 and ISO 3166-1 alpha-2, `language` ABSENT MEANS `en` exactly as `medium` above means web-era, `country` with no default and no `unknown`, malformed hard-fails and well-formed-but-unknown soft-warns. Every row already on the frontier stays valid untouched; there is no backfill here either.

```jsonc
{
  "name": "NWF", "first_seen_in": "ADW's own material naming the network",
  "status": "unverified",
  "notes": "User attestation: \"the NWF was part of a broader game our DM was playing without us\"... Grade: user-attested. POTENTIAL-CONTRIBUTOR lead...",
  "memorial_linked": false
}
```

**`site_online` / `last_activity` (THE DIRECT LIVENESS GAVEL, 2026-09-08,
the Janitor: "Alive would probably require naming the promotion + maybe recent
activity? … if the page names the promotion but it hasn't run a show in six
years maybe that should be a collection priority, because we can collect the
dead without IA").** Liveness is checked directly against the row's own
address (one polite request per host through the fusebox; never via the
Wayback Machine). `last_activity` (int, year) is the newest year the page
itself mentions. THE LIVENESS LINE is one year both ways (CURATION v137;
the Janitor, 2026-10-12: "all three should move to one year"; it read six
months both ways from 2026-09-25, desk D70, which superseded this gavel's
six years for the alive finding): a page that names the promotion with the
fed's own dated activity within the last year is `verified-alive`; one
whose newest activity is older is a DORMANT site — the promotion is dead
though the host is up — and reads
`verified-dead` with `site_online: true`, which routes it to the direct-
collection queue (the URL walk's `direct-collect-queue.tsv`, oldest activity
first) rather than the Archive's timemap queues. A `verified-alive` row leaves
the Archive queues too: a living site is collected directly from its own host
and never served (THE LIVING-PRESERVATION CLAUSE, 2026-08-26) — it joins the
same direct-collection queue behind the dormant rows.

**`last_checked` / `check_cadence` (THE ACTIVE-EFEDS REGISTER REFINEMENT,
2026-08-20, the Janitor's own observation: "the frontier's 81 living-do-not-
touch rows already ARE the register").** A `verified-alive` row is
where the dead-only rule's own mining gate lives — but it's also, in the
the Janitor's own reading, a standing watchlist of real, currently-running
promotions this collection's own record already points at, worth
periodically re-checking for the day they end. `last_checked` (an ISO
date) and `check_cadence` (`"monthly"` or `"quarterly"`, default
`"quarterly"` where unset) are optional fields meaningful only on a
`verified-alive` row — a re-check sweep updates `last_checked`
without touching `status` (that only ever changes on an actual, evidenced
death-verification, never on a calendar tick). See
`docs/OPERATIONS.md`'s Maintenance calendar for the recurring sweep this
feeds. **The enum itself, and the dead-only mining gate it encodes, are
unchanged** — this is presentation and bookkeeping, not a relaxation of
when a living promotion may be touched. On the frontier page itself
(`/frontier.html`), a `verified-alive` row renders OUTWARDLY as an
active promotion — plain language, no internal enum spelled out loud —
per the Janitor's own words: "linking to them helps them." Where the
record already names the promotion's own outbound domain unambiguously
(not merely the domain where the reference was FOUND), an optional `url`
field carries it and the frontier page links out; most rows correctly
carry no `url` at all — an honest gap, since most living rows on file
were surfaced via a third-party wiki census that named the fed but not
its own site, and inventing one is exactly what this schema's own
never-guess discipline forbids.

**`founded_year`** (THE FOUNDING-EDGES WAVE, 2026-08-21) — optional, a
plain integer year (`registry-validate.mjs` bounds-checks it against the
same 1990–2027 window the impossible-date guard uses everywhere else),
part of the Janitor's own directive: *"when available (like with the
fandom dump) to prioritize the frontier based on founding year age."*
**Populated ONLY where the row's own `first_seen_in`/`notes` already
carry a receipt — never researched fresh for this field.** Three rows
carry it as of this wave, all Janitor-attested or primary-sourced
in-notes: the IWF and OSW "wiki name-twin" rows (the Janitor's own
verbatim quotes, "founded 2005 -- name twin" and "brief six month run in
2009," checked live against the eWrestling wiki), and FAW (PTC's own
served member-fed profile: "open Jan 2001"). Deliberately NOT populated:
the four `ewrestling.fandom.com` rows whose NAME already carries a
year-qualifier (`"National Wrestling Alliance (2018)"` and siblings) —
that year is the wiki's own article-title disambiguator, not a founding
fact this project's own research actually extracted; the workshop digest
`fandom-wiki-census.md` is explicit that the lean census pass that
surfaced these 316 names deliberately stopped at name+URL+status and
never fetched the individual articles' own infobox `Founded`/`Dissolved`
fields — doing so for all 316 (not just the 3 backfilled here) is exactly
the bulk-population path the Janitor's own directive names: *"a future
pass that wants founding/dissolution years... has a clear, repeatable
path"* — i.e., Phase 3's own Fandom-dump enrichment wave, not this one.

---

## The collected edge (`shows.json` rows with `collected: false`)

THE COLLECTED EDGE (the Janitor's gavel, 2026-08-22, CURATION.md v71 —
superseding the v55 standalone missing-shows ledger): a show the
surviving record proves ran but the collection does not hold is an
ordinary `shows.json` row in its own promotion's shard, carrying:

- `collected: false` — literal false; a held show simply omits the field.
- `evidence` — a non-empty array of `{source, note}` receipts.
  `registry-validate.mjs` hard-fails an empty or missing array — the
  structural enforcement of "no speculative rows."
- `notes` — optional plain fact (surrounding shows that ARE held, how the
  gap surfaced) — never apology, never machinery narration.
- `partial` — optional boolean for a show partly held (a served "Part
  One") where what's missing is a documented continuation.
- NONE of `page`/`collection`/`matches`/`also_promotions` — nothing is
  held to serve, register, or structure, and there is no document for a
  second wing to point at (JOINT-WING SHOWS, v121(b)); the validator
  rejects them on an uncollected row. `appearances` is rejected the same way with ONE exception, THE
  BILLED APPEARANCE (above, the Janitor's gavel, 2026-08-23): a row every
  one of whose appearances is `kind: "billed"` keeps them, because a
  billing is an assertion about a primary source and not about the show,
  and survives the show never having been collected — or, in the gavel's
  own framing, never having taken place.

Every instrument and register lists uncollected rows like any other —
unlinked, chipped "not collected" — and `collected:no` in any shows
search isolates them (`promotion:giwf collected:no` returns Christmas
Clash 1999). The same edge exists for roleplays via `rp-catalog.json`'s
`held: false` rows, which the roleplays instrument renders and filters
identically (promotion derived mechanically from each ghost's own
recorded address). The lobby's show count counts held shows only.

**THE INDEX OPENS PRE-FILTERED (the Janitor, 2026-09-25; `CURATION.md`
v122, `#index-opens-prefiltered`).** The two instruments that list
uncollected rows — `shows.html` and `rps.html` — OPEN with the collected
filter already applied, seeded into their own search box as the ordinary
query `collected:yes`, so each one's counter reads the same number its
own lobby door does (`stat:shows`, `stat:roleplays`). Three mechanics,
all of them in those two pages; `js/query.js`, `js/list.js` and this edge
are unchanged.

- **The filter is visible and removable.** It is a real token in the box —
  not a hidden default, not a second filter axis — so clearing the box
  lists every row the instrument has always listed and `collected:no`
  still isolates the uncollected ones.
- **The `collected` value each page renders is derived from the fact its
  own door counts**, never from a second fact that can drift from it. On
  `shows.html` that is the SERVED PAGE (`page`) — which is what
  `stamp-stats.mjs` counts and what the row's own "not collected" chip has
  always rendered — so a row with no `page` reads `collected:no` in the
  instrument whether or not it carries the registry's `collected: false`
  marker (258 structured-but-unserved rows were in exactly that state when
  this was ruled). On `rps.html` it is a `data/rps.json` row, which is what
  that door counts, with `rp-catalog.json`'s `held: false` ghosts as the
  `no` half. **The registry field is untouched**: `collected: false` is
  still the marker, still evidence-gated, still what both validators read.
  The instrument's value is a VIEW over two facts the registry already
  holds apart — collected, and served.
- **A deep link that names a filter wins.** An explicit `?q=` (any value,
  the empty one included) and any legacy single-field param the page
  already translates into a token (`?promo=`, `?involves=`, `?author=`,
  `?references=`) suppress the default, which is what keeps the collected
  edge's own founding sentence true: `shows.html?promo=giwf` still lists
  every GIWF show, Christmas Clash 1999 included.

The no-JS year registers (`/shows/<year>/`, `/rps/<year>/`) are NOT
pre-filtered and are not meant to be: a register is the completeness
fallback, it carries no box for a filter to be visible in, and one that
silently dropped rows would stop being what it is for.

---

## `collections.json`

THE PROVENANCE WAVE — the museum's own acquisition history, one row per
accession lot. `{_schema_version, _note, collections: [...]}`.

```jsonc
{
  "id": "0002", "kind": "web-recovery",
  "attestor": "janitor",         // optional — the contributor's chosen credit for contributed material: a handle registered in data/attestors.json (docs/ATTESTATION.md §2), rendered "Contributed by <display>" on the accession page and its index; the Janitor's own private-donation lots carry "janitor"; a deposit from a community member carries that member's handle (first: "argyle", 2026-09-21)
  "note": "The uwfonline.com board mine — the bulk recovery of the UWF's own RP and match-report message boards via the Wayback Machine.",
  "digest": "a copy held in the workshop"   // the museum serves this file: a workshop path is never written here (hook c111 scrubs one to this phrase)
}
```

`kind`: `private-donation` (exactly one lot, `0001`) or `web-recovery`
(one lot per bounded public mining campaign — see `docs/PROCESS.md`'s Intake section).
Every row here must have a generated `/collections/<id>.html` page
(`scripts/cross-reference.mjs` builds these from this file plus every
promotion's own `sources[]`); `registry-validate.mjs` checks the page
exists.

**`id` — width-proofing (2026-08-18, user foresight).** Accession ids
are decimal integers rendered as strings, 4-digit zero-padded
(`"0001"`..`"9999"`) by convention, not by permanent schema guarantee.
An id, once minted, keeps its own padding forever (slug-immutability
doctrine, `CURATION.md`'s registry rule) — but once natural growth reaches `9999`,
the next id is simply `"10000"`, with **no re-padding of the ones
already minted and no migration**. The one real trap this creates:
`"9999" > "10000"` as a LEXICAL/string comparison, backwards from the
numeric truth. Nothing in this codebase currently sorts accession ids
at all — every render surface (the collections index, a promotion's own
provenance panel, the pager) walks `data/collections.json`'s own file
order, which the "numbered in true acquisition order, append-only"
doctrine already guarantees is correct — so the trap is sidestepped by
construction rather than patched around. `registry-validate.mjs`
enforces the invariant that keeps this true: every row's own `id`,
parsed as an integer, must be strictly greater than the row before it.
If a future change ever needs to actually SORT or numerically compare
accession ids (rather than trust file order), `parseInt(id, 10)` first
— never `localeCompare`, never a bare string `<`.

---

## `relationships.json` / `awards.json` / `inductions.json`

`relationships.json`: declared (not observed) connections between two
characters/units. `{id, a, b, nature, detail?, grade, source}`. `nature`
examples: `kayfabe-kin`, `feud`, `ally`, `manager-of`. Declared vs.
observed is the same distinction as tenure `finisher` vs.
`observed_moves` — a relationship edge here is what the record *says*
the connection was, not a derived frequency count (that's the search
page's own `opponent:` join, computed live from `shows.json.matches[]`).

**`nature: "same-handler"` (THE SAME-HANDLER EDGES WAVE, the Janitor's gavel,
verbatim: "I do think a same-handler edge makes sense as well… So Lew
Spectre's relationships would point to the Phenomenons and hardkore
alike") — an OUT-OF-FICTION edge, unlike every other `nature` in this
file, which are all in-fiction/kayfabe facts. It records that two
characters/units were written by the same real person, without ever
naming that person — the direct extension of `CURATION.md` §3's own
role↔character-linkage doctrine ("connecting a role description to a
character is fine and encouraged... it's names and handles themselves
that are protected, not the linkage") one step further: connecting two
*characters* to each other, anonymously, is the same permitted shape one
level removed. **`detail` is forbidden on a `same-handler` edge**
(`registry-validate.mjs` hard-fails one present) — the whole point is
zero prose surface for a name or a biographical fact to leak into; `grade`
+ `source` carry the evidence exactly like every other edge, but `source`
must stay a role-safe citation (a session/interview reference, a document
path), never a name. **Rendering is cluster-wide, not pairwise**:
`scripts/cross-reference.mjs` computes connected components over every
`same-handler` edge (so a handful of spanning edges — not a full
pairwise mesh — correctly surfaces the *whole* cluster on every member's
own page) and renders one line, "Same handler: X · Y · Z," listing every
*other* entity in the same component, on each member's own Relationships
section. Seeded from receipted evidence only, per no-merge discipline
(primary-source > Janitor/user-attested > presumed, same three grades as
everywhere else); a plausible-but-unproven pairing goes to
`review-queue.json`, never a guessed edge.

`awards.json` — THE AWARD ENTITIES WAVE (2026-08-19, the Janitor's gavel:
"awards should be treated the same as championships: each award has its
own page, which documents the history of that award"): an award ENTITY,
one row per distinct `(promotion, name)` pair — `{id, type: "award",
promotion, name, page, epitaph?, epitaph_asof?, bestowals: [...]}` — the
same entity/ledger split `titles.json`/`reigns.json` already established
for championships, just nested one file deep instead of split across two
(a `bestowals[]` array under the award, rather than a sibling file keyed
by a foreign `title` id — awards never needed the cross-file join a title
reign's own show-linkage machinery does). `id` is mechanical:
`<promotion>-<slugified-name>` (`giwf-feud-of-the-year`). Each bestowal:
`{year, recipient: [{id}, ...], runner_up?, result?, vote_detail?,
source}` — `recipient`/`runner_up` share `reigns.json`'s own holder shape
(a real entity `{id}` or an honest `{name, unminted: true}`); `result:
"nominated"` marks a bestowal whose outcome the surviving record doesn't
settle (omitted entirely on a confirmed win — never a `"won"` value with
nothing to distinguish it from the default).

**`rank`** — THE RANKED BESTOWAL (the RSPWF Top 200 accession, 2026-08-23):
an OPTIONAL positive integer on a bestowal, for the award whose own bestowal
is a **place in an ordered field** rather than a single winner — a year-end
ranked poll, a tournament's own recorded finishing order. It is the same kind
of extension `cadence` was for titles: not a new datatype, one field that
lets an existing shape hold a fact it could otherwise only carry as prose.
Absent on every ordinary award, and its absence means exactly that — no place
was recorded — never an implied rank 0 or rank 1; a hard fail on anything
that isn't a positive integer. `year` stays required and keeps its own
meaning (the year the award is *for*), so one award entity holds many years
of a poll at once, one bestowal per (recipient, year).

Rendering, in both surfaces at once: a ranked bestowal renders its place
beside its year — `#168, 1999` — and a rank-less one renders exactly as it
always did, so no existing award's page moves. An award carrying ANY ranked
bestowal lists **in rank order within each year** on its own
`/awards/<id>.html` ledger (a countdown's own reading order is the fact; the
array order it happened to be extracted in is not), and its ledger heading
reads "Place" rather than "Year"; an award with none is left in ledger order,
untouched. The bestowals instrument (`data/awards-index.json`,
`/bestowals.html`) sorts the same way and bakes a `data-rank` attribute, so
`rank:1` finds every ranked poll's own winner across every year and every
promotion at once.

**`epitaph`/`epitaph_asof` are OPTIONAL** — the one deliberate difference
from `titles.json`'s own (required) epitaph: most awards are a single
bestowal with nothing more to say than the bestowal itself already says,
and a mint-only-where-the-record-supports-prose discipline beats a
one-line "epitaph" manufactured to fill the field on every one of a
hundred-plus rows. Where present, same shape and living-epitaph doctrine
as a title's own (`CURATION.md`'s promotion-epitaphs rule, scoped to one
award).

Every award entity gets a generated `/awards/<id>.html` page
(`scripts/cross-reference.mjs`, same "generate, don't hand-edit"
discipline as `titles/`/`characters/` — `registry-validate.mjs` hard-fails
if one is missing) — year-by-year bestowal history, each resolvable
winner linked to their own `/characters/<id>.html`. `/awards.html` lists
award ENTITIES (one row per award, not per bestowal — the same shape
`/championships.html` already uses for titles), acronym-prefixed
(`MuseumList.titleLabel`-style: "GIWF Stable of the Year" next to "IWF
Stable of the Year", never two bare "Stable of the Year" rows) so a
directory of many promotions' awards never reads as a wall of identical
names; `search.html`'s own Awards group mirrors it exactly, one row per
award entity, its `fields` mechanically widened by `flattenFields()`
walking into `bestowals[]` the same way it already walks any array of
sub-objects. A wrestler page's own Awards line links through to the
award's page, not straight to a bare mention of the honor's name.

`inductions.json`: Hall of Fame entries. `{inductee (entity id),
promotion, class_year, source, note?}`. `promotion` names the promotion
that RAN THE HALL — the inducting institution, not the fed the inductee is
best known for.

**An induction may be undated** (the Janitor's gavel, 2026-09-02, on the CSW
Hall of Fame: *"Hall of Fame entries may be added without a known year, with
an honest 'observed by <year>' note; a Hall of Fame is the Hall of Fame
section (inductions), not an awards bestowal."*). Where the record attests a
hall but no document dates the induction, `class_year` is `null` and an
`observed_by` (number) carries the year by which the induction IS attested —
the honest upper bound read off the document that carries the credit, never
a guessed class year. `note` then says what bounds it; the validator
soft-warns an undated row with no note. This is the same posture the
registry already takes to an unknown `closed` date: state the bound, never
invent the fact. The alternative — routing an undated honor through
`awards.json`, whose bestowals do hard-require a numeric year — is
deliberately closed off by the gavel's second half: a Hall of Fame is an
induction, not a bestowal.

**An inductee may be UNMINTED** (the Janitor's gavel, 2026-09-02, on
out-of-character inductions — `CURATION.md` v108 `#induct-by-character`).
`inductee` is EITHER an entity id string, as it always was, OR the same
honest `{ name, unminted: true, fed? }` shape `reigns.json`'s holders and
`awards.json`'s recipients already use for someone the registry holds no
row for. A hall inducts whoever it inducts, and the two dishonest ways out
are both closed: the museum does not mint a character to make a seat
fileable, and it does not drop the seat because the character is unheld.
`fed` is the free-text federation tag the inducting document itself gives —
never a promotion id, because the whole point of the field is that the wing
is not held. An unminted row has no entity page to land on, so
`registry-validate.mjs` hard-requires a `citation_url` on it, pointing at
the served document that carries the induction; `halloffame.html` renders
the name, tags the federation, and links there instead.

The same gavel governs a hall that inducted **real handlers under their own
names**: the seat is filed as an induction of the CHARACTER or characters
that handler wrote, with a per-row `note` saying that the community inducted
the handler and the museum carries the recognition through the character
while withholding the name. Where the record establishes no character, the
seat is recorded as an unminted `"a handler (name withheld under the privacy
rule)"` with the federation the document credits — the seat is never
silently dropped, because a lost seat is a lost fact.

---

## `memorials.json` / `essays.json`

`memorials.json` — governed by `CURATION.md`'s privacy rule's dead-and-welcomed
presumption-of-welcome clause, not the ordinary privacy default; the only
place a real name appears in Museum voice outside a served verbatim
artifact. `{id, name, years, commemorated_by, characters[] (linked
entity ids), note, note_author, gallery[]? ({image, caption}, a portrait
already held in /galleries/), served_docs[]? ({page, label}, a raw served
artifact — a tribute, an induction ceremony script — with no other
structured pointer to it), forum_accounts[]? ({url, label} — the subject's own account on a forum the museum hosts, e.g. the PTC Forum Archive; added 2026-09-23 on the Janitor's question "should we add links to the forum accounts for Sean and Jay on memorial pages?"), links_out[]? ({url, label} — an OUTBOUND link to a LIVING federation the museum will never hold, the Janitor's gavel of 2026-09-24: "We don't serve it but we should link to it"; `CURATION.md` v119, `#memorial-links-out`)}`. **`links_out[]`** is `forum_accounts`' shape pointed the other way, and the four things it requires are enforced in `registry-validate.mjs` rather than remembered: an `http`/`https` scheme; a non-empty `label` carrying the living institution's own name; NEVER a museum-hosted address (a museum-hosted account is what `forum_accounts` is for, and the two must not blur); and a target that a **`verified-alive` frontier row already carries**, host and path alike, so a memorial page never holds an address nobody checked and the frontier's own `last_checked`/`check_cadence` sweep is what keeps it from rotting. It renders under one line of museum voice ("Still online:") as plain outbound anchors with `rel="noopener nofollow"`, and no auto-link pass reaches inside one (the linker never touches text inside an anchor). A link is not a holding: the dead-only rule is unchanged, nothing about the living federation enters `data/` beyond its own frontier row, and the memorial's own `note` still never narrates why a character is or is not held here. A memorial row's `links_out[]` keeps exactly this two-key `{url, label}` shape and this host-AND-PATH frontier clause, unchanged by what follows it: the wider field the Janitor's gavel of 2026-09-27 put on promotion, show, character, unit, title and rp rows carries two more keys and reads the frontier at HOST level, and is documented on its own below (["`links_out[]` (the holder's-own-site link-out)"](#links_out-the-holders-own-site-link-out), `CURATION.md` v124, `#holders-site-links`). **A REFERENCE LINK-OUT** (hook c262; the Janitor, 2026-10-10, on Daniel Quirk: *"an outbound link to https://en.wikipedia.org/wiki/Daniel_Quirk on his memorial"*): one exception to the frontier clause. An `https` article about the memorial's own subject on a reference work in `MEMORIAL_REFERENCE_HOSTS` (today `en.wikipedia.org`, path under `/wiki/`; the constant is kept identical in `registry-validate.mjs` and `cross-reference.mjs`) is not a living federation, needs no frontier row, and renders on its own line, "Further reading:", never under "Still online:"; the scheme, label and never-museum-hosted clauses still apply, and the field keeps its two-key `{url, label}` shape. **THE MEMORIAL REGISTER** (`CURATION.md`
v65): a memorial page carries facts, links, images, and dedication only
— `note` is a Janitor-authored or museum-authored dedication line, placed
verbatim, never process narration, curation machinery, or a quote from a
working conversation. **`note_author`** — THE AI-AUTHORSHIP FLAG
(2026-08-22), the same `"ai"`/`"human"` convention `caption_asof.author`/
`epitaph_asof.author` use, just unwrapped (a memorial's `note` has no
`_asof` staleness companion to nest inside) — Jaymes Faulkner's own
dedication ("A father, husband, brother, uncle and all round amazing
person," `CURATION.md`'s changelog) is the one `"human"` row on file
today; every other memorial note is `"ai"`. The older `verification` field
(a Janitor-welcome
quote plus a real-world verification URL) is retired from this schema —
verification facts live in `CURATION.md`'s own changelog, never on a
served page. **THE SHOWS-SECTION RETIREMENT** (`CURATION.md` v66, second
rider): the `shows[]` field (a held show page merely mentioning or
staging something memorial-adjacent) is retired outright — the Janitor,
verbatim: *"You're still listing shows, though, and I'm not sure the
purpose."* `renderMemorialShowsSection()` is deleted from
`scripts/cross-reference.mjs`; a memorial page's final shape is
dedication, characters (live links, mechanically deriving each one's own
promotion links), gallery, and served memorial documents only —
`served_docs[]` stays, since those ARE the memorial register's own
material (an induction script, a death announcement, a tribute), not a
show the person merely happened to appear in or near. **THE MEMORIAL
CREDIT EDGE** (`CURATION.md` v74): `served_docs[]` also carries a served
document that **credits a memorial name as its writer**. A memorial name
is the one name never redacted under the privacy rule's real-name
exception, and the same ruling that exempted it requires the edge — the
Janitor, verbatim: *"credit to memorial names, like Sean Williams, should
not be redacted and should have edges linked to him."* Label form names
the credit first, then what was written: `"Written by <memorial name> —
<segment>, <show>, <date>"` (e.g. `"Written by Sean Williams — Rook Black
vs Seymour Almasy, Midnight Madness 1, 18 Jun 2005"`). The bar is a
**CREDIT OF ANY KIND**, verified in the document's own text — a writing
credit is the common case and the one the label form above is built for,
but an OWNERSHIP or founding credit qualifies on exactly the same basis
(the Janitor's own v74 words are broader than the writing example they
were given for: *"credit to memorial names, like Sean Williams, should not
be redacted and should have edges linked to him"*, and the wider
`served_docs[]` definition — a raw served artifact with no other structured
pointer to it — plainly covers it; the Hall of Fame induction script
already on Sean's own row is not a writing credit either). A non-writing
credit's label says what the credit actually was rather than forcing the
"Written by" form (`"Credited as co-owner — TRAUMA:fighting's own concept
page, March 2003"`). What still earns NO edge: a mention of the name in a
show's own prose, which is a mention and not a credit, and a character
appearance, which is a character.

`essays.json` — curatorial/narrative writing, its own datatype, distinct
from the database records everything else in `data/` holds. `{id, type:
"essay", title, summary, page, collection, written, linked: {promotions[],
characters[]?, ...}}`. Still uses the older single-`collection` field
(not migrated to the accession-lot model, same as `titles.json`). That is
the file's older row shape: a row carrying no `status` is judged by it
alone (every id in `linked` must resolve), and the file now also holds the
`status` rows documented below (v129, v130), each held to its own shape.

**THE ESSAYS RETIREMENT (the Janitor's gavel, 2026-08-19/20): the essay form
is reserved for human-written work.** The Janitor, verbatim: *"on a platform
that is mostly AI automated, I think Essays should be human written, just
as the shows, characters, etc. were."* Going forward, a new
`data/essays.json` row is only ever added for something the Janitor (or a
future contributor) actually wrote themselves — never curator/AI-authored
narrative, however essay-shaped. The front-door listing (`essays.html`)
and the nav's own Essays link were retired (redirect stub, the same
convention retired title-ledger pages already use; v129, below, reopened
both); the datatype and `data/essays.json` itself stayed in the schema,
ready the day a human wrote something that belonged in it. The wave's own inventory of the four rows
on file at the time: the IWF line connected-history essay retired
outright (already de-linked from every wing, and read, on review, as one
promotion's own narration of four others' history — the facts it carried
are ordinary `affiliations.json` successor-of/predecessor-of edges now,
per THE LINEAGE EDGES WAVE, rendered wing by wing instead of told from
any one of them). The other three (Jay Phoenix's, Seymour Almasy's, and
Danny Jaye's Hall of Fame induction write-ups) were left as an open
question for the Janitor at the time — **now closed (v50, `CURATION.md`):
all three retired too**, the Janitor verbatim: "we serve the ones we
recovered and leave the blank ones blank, the same way we wouldn't try to
rewrite a show that we didn't capture." `data/essays.json` was left empty by
this ruling, per the doctrine above, until v129 reopened it (below); it
now holds the Essays register's rows.

**THE ESSAYS REOPENED (the Janitor's D142 and D169, 2026-10-01; `CURATION.md`
v129, `#essays-reopened`).** Essays hold outside, human-written work about
e-wrestling again: a published article, or a paper. A row carrying
**`status`** is a v129 row; a row with none is judged as before.
`{id, type: "essay", status: "linked" | "served" | "own" | "wing", shelf:
"museum" | "academic" | "journalism" | "community" | "reviews", title,
byline, form:
"article" | "paper" (`"essay"` on an `own` row; `"audio"` | `"video"` on a
`linked` row only), venue, published: {date,
precision}, written?, language, ...}`. `published.precision` is `exact`,
`month`, `year` or `unknown`, and an `exact` date is YYYY-MM-DD;
`written` is YYYY, YYYY-MM or YYYY-MM-DD; `language` is a two- or
three-letter code; a `linked: {promotions[], ...}` object, when present,
must resolve as in the older shape above. The third status, `own`, is the
museum's own writing (v130, below); the first two are outside work.
**`linked`** (a live article, linked and never copied):
`url` (the article's own http(s) address, never a museum-hosted one) and
`checked` (YYYY-MM-DD, the day that address was last found live), or, in
its place, **`not_checked`** (a non-empty string, the reason, e.g.
"robots.txt keeps our crawler off this page"; a row carries one of the two,
never both). The Janitor's D428 default 3, in the ruled words: *"articles
we could not check are linked, marked not checked by us"*; such a row's line
on `essays.html` ends "not checked by us". `not_checked` belongs to a
linked row only. No
`page`, `text`, `collection`, `sources` or `served_since`. It is listed on
`essays.html`, on its row's shelf (below), as an outbound anchor with
`rel="noopener nofollow"`, its line ending "offsite". **`served`** (a dead article, served from our
copy, or a paper with no other home): `page` = `/essays/<id>.html`,
`text` (the full text, verbatim, plain; a privacy marker stands in it as
`[name withheld]` or `[detail withheld]`, the two wordings of D480), `collection` (the accession lot), `sources[]`
(where our copy came from, the documents rows' `{kind, url, identifier,
accession}` shape), `served_since` (stamped at landing when the row has
none). `scripts/cross-reference.mjs` renders the page from the row (the
document head, the byline and original publication, the house content
notice, the text in the house `<div class="document">`, a provenance
block: Collection, Source, Document date, First published, Redactions
counted from the text's own markers, Served since) and lists it on
`essays.html`, on its row's shelf (below), linking to its own
page; `essays/` is a verbatim artifact to
the linker and the wanted scan. `byline` and `venue` are required: the
byline is the author's own name on the author's own work (D402).
Rows land through a wave's `delta/data/essays-append*.json`
(`scripts/fixers/apply-essays-append.py`, window A3): a new id is
appended, the same row again is a no-op, and a changed row is refused
(a correction is made by hand on a ruling). `scripts/registry-validate.mjs`
holds each status to its own shape at the gate.

**THE MUSEUM'S OWN ESSAYS (the Janitor's gavel, 2026-10-08; `CURATION.md`
v130, `#museum-own-essays`).** A third class beside v129's two: an essay
written here by the Janitor or by Argyle under their own name. `status:
"own"`, `form: "essay"` (the one status that may carry that form), `venue`
the museum, `byline` the writer's own name, `page` = `/essays/<id>.html`,
and **`html`**, the body the writer wrote. `scripts/cross-reference.mjs`
renders the page from the row and places `html` UNESCAPED, so the gate
allows only these tags in it: `p`, `a`, `i`, `em`, `strong`, `br`; and
every `a` must carry an `href` that is an `http`/`https` address or begins
with `/` (site-relative). Links are placed as written. The page carries
the writer's attested byline (the same `attestor-flag` span a memorial's
human-written note wears) and one muted line saying when it was written;
it carries NO content notice (that notice warns a reader about a period
document the museum did not write) and NO provenance block (there is no
collection, no source of a copy and no served-since date to give). An
`own` row therefore carries none of `text`, `collection`, `sources`,
`served_since`, `url`, `checked` or `not_checked`. Like a served row, its
page must exist on disk (rendered by `cross-reference.mjs`; a stale row
is cured by `npm run refresh:links`).

**THE SHELVES (v130(c); the fifth shelf and the chips, hook c279).** Every
row with a `status`, of any of the four, carries a required **`shelf`**:
`museum`, `academic`, `journalism`, `community` or `reviews`. A piece is
shelved by what it is, never by where it is kept. **`reviews`** (the
Janitor, chat 2026-10-11: *"Maybe add a 'review' chip as well for game
reviews? I'm not sure 'journalism' exactly covers them"*) is for a piece
whose main purpose is to evaluate a specific game or product — a video
game, a tabletop RPG, a board game, a sim — a retrospective review
included; a feature, history, interview or news piece about a game is not
one.

Since hook c279 a shelf is not a section. `essays.html` is ONE list of
every row with a `status`, newest `published.date` first (ties by title,
undated rows after every dated one), and the shelf rides its row as the
first **chip** in the row's chip run, labelled with the heading its section
used to print ("From the museum", "Academic writing", "Journalism",
"Columns and blogs", "Reviews"; an audio/video row wears "Listen and
watch", shelf key `listen`). Every chip carries the query it stands for in
`data-q`, and the row carries its own query fields as `data-*` attributes
(`shelf`, the four `about` axes, `language`, `year`, `status`), so the
page's own search box (`js/query.js`'s engine, wired by
`MuseumList.wireDomFilter`) filters on any of them and a filtered view is
linkable through `?q=`. A line that leaves the museum says so itself
("offsite"). The four shapes side by side:

- **`linked`** needs `url` and `checked` (or `not_checked`); forbids
  `page`, `text`, `collection`, `sources` and `served_since`.
- **`served`** needs `page`, `text`, `collection` (an accession lot in
  `data/collections.json`), `sources[]` (each with a `kind`; a `url` in one
  must be http(s)) and `served_since`; forbids `checked` and `not_checked`.
- **`own`** needs `page` and `html`; forbids `text`, `collection`,
  `sources`, `served_since`, `url`, `checked` and `not_checked`.
- **`wing`** needs `page` (a `data/documents.json` row's own page, on
  disk, never `/essays/`); forbids `text`, `html`, `collection`, `sources`,
  `served_since`, `url`, `checked` and `not_checked`.

A `status` row's fields are limited to the names above (`id`, `type`,
`status`, `shelf`, `title`, `byline`, `form`, `venue`, `published`,
`written`, `url`, `checked`, `not_checked`, `page`, `text`, `html`,
`collection`, `sources`, `served_since`, `language`, `linked`, `about`); the gate
only soft-warns on any other. `apply-essays-append.py` refuses the same
shapes at landing.

**AN ESSAY SERVED IN A WING (the Janitor, chat 2026-10-10; the GAVELS ruling log,
the 2026-10-10 row answering whether fwrestling.com's "Where Did FW Come
From?", served in the fwrestling wing, should also be listed on the Essays
page; hook c253).** The ruling, verbatim: *"And yeah we should serve essays
there even when they're already tied to wings we hold"*. An essay the museum
already serves inside a wing (a hobby history, a what-is piece, a column or
guide written as an essay) is a fourth status, **`wing`**. Its `page` is
that wing document's own page: a `data/documents.json` row's `page`, on
disk, never under `/essays/`. It is not copied a second time:
`cross-reference.mjs` renders no `essays/<id>.html` for it and gives it no
place in the essay pager, and the wing's page is left as it is.
`essays.html` lists it on its row's shelf, linking to that page, its line
ending "served in the <wing> wing". Its provenance is its documents row's,
so a `wing` row carries none of `text`, `html`, `collection`, `sources`,
`served_since`, `url`, `checked` or `not_checked`; `title`, `byline`,
`venue`, `form` (`article` | `paper`), `published`, `language` and `shelf`
are required as on any status row, and two rows never point at one page.

**THE HOBBY CHIPS (the Janitor, chat 2026-10-10; the GAVELS ruling log, the
2026-10-10 row; hook c253).** Verbatim: *"We should tag/chip the essays with
what parts of the hobby they talk about, consistent with how our wings are
already labeled"*. Any status row may carry **`about`**: `{medium?: [],
form?: [], play?: [], authorship?: []}`, the parts of the hobby the piece
discusses, on the wings' own four axes and in their own vocabularies (the
[`promotions.json`](#promotionsjson) `medium`, `form`, `play` and
`authorship` values: `registry-validate.mjs` holds each to its own
`MEDIUM_VALUES`, `FORM_VALUES`, `PLAY_VALUES` and `AUTHORSHIP_VALUES`, and
`apply-essays-append.py` reads those same lists out of that file). Several
values per axis are allowed, each once; an axis the piece does not discuss
is left out, never `unknown`; an `about` with no axis is refused. It is a
separate field from the row's own `form` (`article` | `paper` | `essay`,
what the piece itself is), which it never replaces. `cross-reference.mjs`
renders it as the wings' own chips (`<span class="chip chip-medium"
data-medium="...">`, `chip-form`, `chip-play`, `chip-authorship`, labelled
from `WING_*_LABELS`), axis by axis in that order: in a `<div
class="essay-about">` under the row's line on `essays.html`, and in a `<p
class="essay-about">` under the subtitle on an essay's own page (`served`,
`own`). A row with no `about` renders as before.

**THE LANGUAGE CHIP (the Janitor, chat 2026-10-10; the GAVELS ruling log, the
2026-10-10 row beginning "Recommendations for the Google alerts?", applied
as (b); hook c259).** Verbatim: *"We should add a language chip on all
essays as well."* Every status row shows its `language` as a chip, English
rows too: the wings' own language-chip markup (`<span class="chip
chip-language" data-language="...">`), after the hobby chips in the same
`essay-about` container (which therefore renders for every row). The name
is read at build time from the house list the provenance block uses
(`scripts/fixers/fix-provenance-block.py`'s `LANG_NAMES`); a code that list
does not name falls back to the wings' own chip names
(`WING_LANGUAGE_LABELS` in `cross-reference.mjs`), then to the code. There
is no separate list for essays.

**LISTEN AND WATCH (the same row, applied as (c); hook c259).** Verbatim:
*"We could still link to podcasts?"*, applied as *"podcasts and other
audio/video pieces about the hobby are LINKED from the Essays page in their
own section, never served"*. A podcast episode or a video about the hobby is
an essays row with **`form: "audio"`** or **`form: "video"`**, and those two
forms are allowed on a **`linked`** row only (`registry-validate.mjs` and
`apply-essays-append.py` refuse them with any other status): it carries the
episode's own `url` and `checked` (or `not_checked`), its hosts as `byline`,
the show or channel as `venue`, and nothing of it is copied. It still
carries its `shelf` (what it is), but `essays.html` lists it in its own
section after the shelves, "Listen and watch", each line the house linked
line (the title out with `rel="noopener nofollow"`, byline, venue and date,
"audio" or "video", "offsite") with its chips.

---

## `links_out[]` (the holder's-own-site link-out)

THE HOLDER'S-OWN-SITE LINK-OUT (the Janitor's gavel, 2026-09-27, verbatim:
*"I feel like we should link to promotions, bios, etc on Argyle's site in the
placards"*; `CURATION.md` v124, `#holders-site-links`). One optional field,
documented once here because SIX record types carry it with one shape and one
set of checks: a **`promotions.json`** row, a **`shows.json`** row, a
**`characters.json`** or **`units.json`** row, a **`titles.json`** row and an
**`rps.json`** row. It is v119's field (`#memorial-links-out`) widened: a
memorial's own `links_out[]` keeps the narrower two-key shape and the
host-and-path frontier clause documented under
[memorials.json](#memorialsjson--essaysjson), and nothing below changes it.

**The shape** is `links_out[]? ({url, label, kind, checked})`, every key
required on every element:

- **`url`** — an `http`/`https` address, no whitespace, and NEVER a
  museum-hosted one (a museum-hosted account is `forum_accounts`' job, and the
  two must not blur).
- **`label`** — non-empty, and **the site's own name for the page it points
  at**, plainly: the e-wrestling.org Museum names its UWF pages
  `UWF · e-wrestling.org Museum`, so the label reads "UWF at the
  e-wrestling.org Museum", never a museum paraphrase of it.
- **`kind`** — the **route family the URL itself uses**, which is what makes it
  checkable against `url` instead of a label to be trusted:
  `promotion` (the site root, no route segment) · `results` (a card) · `bio` (a
  wrestler or a team) · `titlehistory` (a belt) · `rp` (a roleplay). A
  promotion row takes `promotion`, a show `results`, a character or unit `bio`,
  a title `titlehistory`, an rp `rp`.
- **`checked`** — the ISO date (`YYYY-MM-DD`) the address was verified by
  request. **It is never rendered**: it is the registry's own receipt for when
  the address was checked, not a claim the page makes to a reader today. The
  frontier's own `last_checked`/`check_cadence` sweep on the host is what keeps
  the link honest.

**The host rule** (v124(d), the one clause that moved): the target's **HOST**
must be covered by a **`verified-alive`** `frontier.json` row — satisfied by
that exact host or by its registrable parent domain, since v119's host-and-path
match cannot survive per-record links and a frontier row per record would
multiply the re-check sweep without telling the ledger anything new. It is
**not satisfied, or confused, by a `held` or `unverified` row** on the same or a
child host. That is not hypothetical: the frontier carries five `held`/
`unverified` rows on `*.e-wrestling.org` hosts, old dead feds hosted on that
domain before its present holder had it (`prime.e-wrestling.org` is the
sharpest — its row describes a site last active in 2012, while the same host
today serves its present holder's own page).

**Where a link may come from** (v124(c)): only the holder's own crosswalk, or
an exact id his own export carries, copied verbatim even where his spelling is
irregular. Never guessed, never inferred from a near-miss, never name-matched
across feds, never re-derived from a convention. Where his export marks a
record held with no write-up there is nothing on the far side and no element is
written at all; where our own record's `tenures[]` do not name the promotion the
row waits on the tenure (the tenure is the fix, not the link); where his own
data cannot tell two of his records apart, the question goes back to him.

**Rendering** (v124(e)): the placard's LAST row, after `Elsewhere` — two words
of museum voice, "Also at", then the labels as ordinary outbound anchors
carrying `rel="noopener nofollow"`, the label INSIDE the anchor so the
auto-linker never reaches it. A wing page renders it inside
`stamp-promotion-headers.mjs`'s existing `Elsewhere` slot; a served card or
roleplay page, which has no placard, carries it as a row of its own structured
provenance block, BELOW `Source`, because a link is not a source.

`scripts/registry-validate.mjs` enforces the shape, the scheme, the
museum-host bar, the `kind`↔`url` route match and the host rule at the gate —
hard, per record type, and unratcheted, exactly as it does v119's four clauses
for memorials.

---

## `external-figures.json` / `aliases.json` / `review-queue.json`

`external-figures.json` — real people or fictional figures a character
`portrays`, kept as their own record so the portrayal link has something
to point at without smuggling a real name into a character record.
`{id, type: "real-person" | ..., name, source?, note}`. **`source`** (THE
PORTRAYAL-FORMAT WAVE) — the short name of the work the figure is FROM
("FFVIII," "Married... with Children," "Hellblazer") — every portrayal
renders sitewide as "Name (Source)," so a figure lacking one renders bare
(`registry-validate.mjs` soft-warns, never hard-fails, since the field is
honestly optional for a figure that's never actually rendered via a
`portrays` link). An `id`/`name` must NEVER be seeded from the portraying
character's own name (the caught incident: `seymour-almasy-ff` was named
"Seymour Almasy," identical to the UWF character it was supposed to
explain, silently reading as inspired-by-itself; split into `seifer-almasy`
and `seymour-guado`, the two actual Final Fantasy sources the ring name
fuses) — an external figure's identity is independent of, and must stay
legible against, whatever it's cited from.

**`depictions[]` — the depiction record** (THE ECOSYSTEM EXPANSION GAVEL, the
Janitor, 2026-09-05; `CURATION.md` v111(d)). Optional. One more level of
specificity under a figure, so a portrayal can say whether it is Hulk Hogan,
Hogan's 1984 LJN figure, or one creator's CAW of Hogan. A **depiction** is a
NODE — a thing that exists — which a portrayal edge may point at.

```jsonc
{
  "id": "hulk-hogan-real", "name": "Hulk Hogan", "type": "real-person",
  "depictions": [
    { "id": "hulk-hogan-real-ljn-1984", "kind": "toy-figure",
      "line_or_maker": "the 1984 LJN Wrestling Superstars line", "year": 1984,
      "source": "The fed's own roster page photographs the figures it books, LJN packaging visible." }
  ]
}
```

- **`id`** — required, a lower-case hyphenated slug, unique across the WHOLE
  depiction record rather than per subject. Conventionally the parent's id
  plus a maker/line/year qualifier. Ids are labels, not claims: never renamed
  once minted.
- **`kind`** — required, and a CLOSED set: `person` · `toy-figure` · `caw` ·
  `drawn` · `canon-character`. Exactly the five the Janitor gaveled;
  `registry-validate.mjs` HARD-fails anything else (the `roster_policy`
  posture, not the `medium` posture: the five came down in a gavel, so a sixth
  needs a gavel and an unrecognised value is a typo).
- **`of`** — optional and redundant: nested under its subject, the parent row
  IS the `of`. A lane may write it for legibility, in which case it must equal
  the parent's own id — hard fail otherwise, so the redundancy can never drift
  into a second, wrong answer.
- **`line_or_maker`** — required and non-empty for `toy-figure`, `caw` and
  `drawn` (a depiction of those kinds without a line or a maker names
  nothing); optional for `person` and `canon-character`. **Privacy rider,
  `CURATION.md` v74:** the maker of a CAW is named **by handle or by role,
  never by real name**. `privacy-check.mjs` greps every ledger deny term
  across the registry JSON, so a real name here reddens the gate mechanically;
  this rule is what stops it being written in the first place.
- **`year`** — optional integer; soft-warns outside 1900–2100.
- **`source`** — required, non-empty, the receipt. The `roster_policy_source`
  posture: a depiction is a claim about a physical or digital artifact, and an
  unsourced one should be impossible to write, not merely discouraged.
- **`note`** — optional free text. Unrecognised keys soft-warn.

**Where a depiction hangs.** `depictions[]` is legal on an external-figures
row (the memo's own "a depiction record under a figure") and, per the
coordinator's ruling of 2026-09-05 on this amendment, on one of this
collection's OWN `characters.json` / `units.json` rows — which is where a CAW
of another federation's ORIGINAL character is recorded. The depiction points
at the character that already exists; no figure row is ever seeded from a
character's name, so v78 is untouched.

**How a portrayal points at one.** A `portrays[]` entry gains an optional
**`depiction`** naming a depiction id, and three invariants are hard: the
depiction must belong to the SAME figure that entry's own `figure` names (this
is what keeps `cross-reference.mjs` safe — it reads `pt.figure` and nothing
else, so a depiction pointer can never move a portrayal off the figure page it
already belongs on); `portrayal_of` is untouched and stays a BARE
external-figures id, never a depiction id (what a fed staged is a portrayal of
Hulk Hogan; the depiction says *through what*); and **absence means
`kind: person`** — the figure as themselves, which is what every portrayal on
file already meant, so nothing was migrated.

**A depiction nothing points at is fine, and gets no warning.** That is the
deliberate difference from an external-figures row itself, which generates no
page when unreferenced: the memo's character-commons case (CAW circulation
held at collection level, without a wing) is exactly a set of depictions with
no portrayal edge yet. Collected is not served; the record holds them.

**`type`** is `real-person` · `fictional-character` · `brand-mascot` ·
`musical-act` · `real-promotion`. `musical-act` (2026-08-24, paying the XWF
wing's own flagged debt for `limp-bizkit-xwf`) is a band or performer taken
as a ring name — neither a `real-person`, since an act is a group and a
brand rather than one figure the museum would be making claims about, nor a
`brand-mascot`, since nobody invented Limp Bizkit to sell anything.

**`real-promotion`** (hook c101; the Janitor, desk D400, 2026-10-07: *"(a) a
"real-promotion" type in the external-figures register"*; `CURATION.md`
v128) — a real wrestling company that a fan federation's fiction portrays:
the node a wing's own `portrays` points at (see `promotions.json` above).
One row per institution: a rename is an `aka` on the same row (the WWF that
became WWE is one row), and a different institution under a reused name is
its own row (the 1990s ECW and WWE's 2006 ECW brand would be two). Fields:
`id`, `type`, `name` (the name the portraying wings use), `source` (the
"From" line, `real-world professional wrestling`), `note`, and optionally
`years` (a plain string) and `aka[]`, which are legal on this type only.
NAMES AND EDGES ONLY: the note says in one line what the institution is,
and no field carries its history, because a living canon is never served by
assembly (v100, v128 (e)). A row is minted only when an edge needs it.
`registry-validate.mjs` hard-fails a real-promotion row with no `note`, and
any character or unit whose `portrays` or `portrayal_of` names one.

**Generated pages** (CURATION.md v78(d), 2026-08-24) — every figure
something actually points at gets `/figures/<id>.html`, built by
`cross-reference.mjs` alongside the character and title pages and subject
to the same never-hand-edit discipline. The page is a NODE, not a
biography: it renders the registry row's own minimal fields and two
inbound lists, and there is no field on it a bio could arrive through.
The lists are kept apart on purpose — **Portrayed in** is v78's own
subject (rows carrying `portrayal_of`, each a separate character staged by
a separate promotion, sharing this record and nothing else), while **Named
for** gathers every other `portrays` borrowing. Merging them would let the
page imply a fed staged Koopa Troopa the way FAW staged Lex Luger, and
those are different claims. A figure with NO inbound edge gets no page,
which is not tidiness: `validate.mjs`'s reachability audit fails the build
on any served page no link chain reaches, and nothing would link to it.
`lew-spectre-original` is the live case — a real figure held precisely
because this collection's Lew Spectre is *not* him. A `real-promotion`
figure's page (hook c101) carries a third list, **Portrayed by**: the wings
whose own `portrays` names it, each linked with its years, kept apart from
the two character lists for the same reason (a fan federation staging a
company is a different claim from a character staging a person). Its
placard adds the row's `aka` and `years`, and its crumb is Wings. A
character's `portrays` to a canon figure (THE CANON PORTRAYAL, above) is
listed under **Portrayed in**.

`aliases.json` — the *only* escape hatch for a slug that needs to change
after the fact (a clean generic slug that collides later, see
`docs/PROCESS.md`'s Registry section). `{from, to}` — old slug maps forward to the
current one. **One thing it may never do** (v78(c)): merge two characters
that both carry `portrayal_of` across different promotions.
`registry-validate.mjs` hard-refuses it, with no override flag, because
the gavel declined to give itself one. Bringing a pre-v78 bare portrayal
slug up to the qualified-slug bar (`hulk-hogan` → `hulk-hogan-nfw`) is the
opposite of a merge and passes fine.

`review-queue.json` — duplicate-candidate holding pen, and (since THE
CAPTION-STALENESS WAVE) the caption-refresh equivalent for the same
shape. `{type ("character-name-collision" · "caption-stale" · etc.),
name, candidates: [ids], note, status ("open" | "merged" | "distinct" | "dismissed" |
"deferred" — minted 2026-08-26: parked on a named revisit trigger, e.g.
"revisit at NFW tier 3", the trigger stated in the note),
resolution_note?}`. **A `candidates` array must only ever list ids that
currently resolve** — if a merge retires one of the listed ids, the
entry gets updated to list only the survivor (matching precedent),
never left pointing at a dead id. A `caption-stale` entry's own
`candidates` may be empty (`[]`) when the flag is about a *class* of
entities rather than named ones — e.g. a served-show wave that grew a
promotion's corpus without touching any individual entity's own tenure
records, so nothing can be honestly named without guessing.

---

## `style-families.json`

THE STYLE FAMILIES WAVE — a NAVIGATION-ONLY finding-aid layer over the
verbatim `tenures[].style` strings documented above; see `docs/PROCESS.md`'s
Registry section, "Controlled vocabulary over verbatim records" entry, for the full
doctrine. `{_schema_version, families: {FamilyName: [verbatim variant,
...]}}` — every variant listed is copied byte-for-byte from an actual
`style` string somewhere in `data/characters.json`/`data/units.json`
(never retyped/normalized by hand, which is how a mojibake apostrophe or a
stray character would quietly break the mapping); a composite string may
appear under more than one family. Anything that can't be honestly placed
(a manager note, a data-entry artifact, a bare mood word sitting in a
`style` field) is simply left out of every family — an intentional gap,
not an oversight, and never force-fit to make the census look complete.

```jsonc
{
  "_schema_version": 1,
  "families": {
    "Hardcore": [
      "Hardcore",
      "Hardcore/Grapple",
      "extreme, Luchador, Grappler"
    ],
    "Technical/Mat": [
      "Technical",
      "Mat Technician/High Flyer"
    ]
  }
}
```

Consumed two places, both navigation only: `scripts/cross-reference.mjs`'s
`entityCard()` widens each roster card's own `data-style` filter attribute
with every family a raw style resolves to (the verbatim strings stay first
in the same attribute and alone are what ever renders on any page);
`characters.html`'s style-filter `<datalist>` suggests the family list
instead of every verbatim variant, while typing a raw substring still works
unchanged. `scripts/registry-validate.mjs` soft-warns (never hard-fails) on
two hygiene conditions: a distinct registry `style` string no family
claims, and a mapped variant that no longer corresponds to any current
tenure's own `style` string.

---

## `promotion-style-families.json`

THE HOUSE-STYLE WAVE — the promotion-side counterpart to
`style-families.json`, same navigation-only doctrine, one level up: a
census of `data/promotions.json`'s own verbatim `house_style` strings,
grouped under a small controlled set of family names (`Comedy`,
`Angle-Driven`, `Hardcore-Heavy`, `Sports-Realism`, growing only as the
corpus honestly supports a new one — not a closed list). `{_schema_version,
_note, families: {FamilyName: [verbatim house_style string, ...]}}`. Unlike
`style-families.json` (which is consulted live at generation time in
`scripts/cross-reference.mjs`), a promotion's resolved membership is stored
directly on its own `data/promotions.json` row as `style_family` — see
that field's own entry above for why (the client-side search instruments
read the promotions JSON directly rather than a server-baked card) — this
file is the documented, receipted source of truth for what each family
name means and why a given promotion carries it, not a live join.

---

## `wanted.json` / `characters-index.json` / `matches-index.json` / `site-config.json`

`wanted.json` — **fully auto-generated**, never hand-edited.
`scripts/cross-reference.mjs` regenerates it every run: capitalized
proper-noun-ish bigrams seen in curated prose that match no registry
entity — the mining wish-list. `{_schema_version, wanted: [{name,
seen_on: [page paths]}]}`.

`characters-index.json` / `units-index.json` — **fully auto-generated**,
never hand-edited. The pre-rendered row HTML + filter attributes for
`characters.html` / `units.html` (THE 397/400 FUSE WAVE: an instrument
page fetches this at runtime instead of baking every row into its own HTML
source). **THE UNITS SPLIT (REVIEW-FIXES WAVE, 2026-08-22)**: one index
per entity type — characters only in the first, units only in the second
(a unit row carries `data-kind` plus its members inline), so each
instrument's own results counter reads a true per-type total;
`registry-validate.mjs` freshness-checks each against its own type's
registry count. **THE A-Z REGISTERS (PROMOTIONS-PATH WAVE, 2026-08-22)**:
the old merged `/characters/a-z/` register is split to match — every
ENTITY surface carries its own complete no-JS alphabetical register
(`/characters/a-z/`, `/units/a-z/`, `/promotions/a-z/`, `/titles/a-z/`,
`/awards/a-z/`), every EVENT surface a chronological one (`/shows/<year>/`,
`/rps/<year>/`, each with an undated bucket), all generated by
`scripts/cross-reference.mjs` and row-count freshness-checked by
`registry-validate.mjs`; each instrument page links its own register
through the `<!-- register:start/end -->` marker it carries.

`matches-index.json` — **fully auto-generated**, never hand-edited (THE
MATCH SECTION, 2026-08-20). One pre-rendered `<li>` row per
`data/shows.json` `matches[]` entry **with actual match content**, fetched
at runtime by `matches.html` — same "instrument fetches a pre-baked JSON
index" shape as `characters-index.json`. **THE MATCHES-INDEX PURITY RULE
(REVIEW-FIXES WAVE, 2026-08-22)**: a degenerate under-parsed `matches[]`
row (fewer than two entrants and no winner/result/stipulation/
eliminations/note) stays in the registry — honest partial data, the show
page is the record — but earns no instrument row; the freshness check and
the front door's own Matches count both apply the same rule
(`matchHasIndexableContent()` in `cross-reference.mjs`, mirrored in
`registry-validate.mjs` and `stamp-stats.mjs` — change all three
together). **THE CHRONOLOGICAL DEFAULT (same wave)**: every instrument
index (`matches`/`appearances`/`reigns`/`awards`) is baked in
chronological ascending order — precision-aware (year-only sorts within
its year, an unplaceable date sorts last, stable) — so the fetched
document order IS the default sort. `{_schema_version, matches_index:
[{id, html}]}`.
Every row's own `data-*` attributes (`promotion`, `show`, `date`,
`participant`, `winner`, `stipulation`, `title`) are baked directly into
its `html`, mechanically discoverable by `js/query.js` the same way every
other list page's filter fields already are — nothing hand-wired per
field. `title` is derived, never stored: a match is flagged as a title
match only when `data/reigns.json`'s own `event` linkage uniquely
identifies which match on that show it was (see `deriveMatchTitle()` in
`scripts/cross-reference.mjs`) — an unresolvable or ambiguous case is left
unflagged, never guessed. `scripts/registry-validate.mjs` recomputes the
live `matches[]` count and hard-fails if this file's own row count has
drifted, same discipline as `characters-index.json`'s own freshness check.

`site-config.json` — the one place `row_budget` (validate.mjs's hard cap
on a statically-generated page's own baked row count) and `window_chunk`
(list.js's windowed-rendering chunk size) live, shared by both sides of
the pagination system on purpose — bump either here, never in two places.
**`translate_providers[]`** (THE ECOSYSTEM EXPANSION GAVEL, 2026-09-05;
`CURATION.md` v111(c)) — the reader-side "translate elsewhere" affordance:
an optional array of `{name, url_template}`, each template carrying a literal
`{url}` placeholder. `validate.mjs` hard-fails a list of fewer than THREE, so
the gavel's own "three or more providers by plain URL" is a mechanical floor
rather than a remembered intention and no single provider is ever
load-bearing. **Nothing renders it yet**: the site is gated, so no external
provider can fetch a museum URL and a rendered row of links would be a row of
dead ones. The chrome i18n step renders it, and it works when the public flag
flips. **THE ENDPOINT TEST** (the coordinator, 2026-09-05; `CURATION.md`
v112(b)): every entry must be a PAGE-translation endpoint — a URL handed to it
must cause the PAGE at that URL to be translated, not the URL STRING to be
translated as text. A floor met on paper is not met, so the rendered floor is
three PAGE-translation providers or no row at all. Nothing in a URL template
says which kind it is; a lane adding one checks by hand and records the check
in this file's own `_translate_endpoint_note` and in `docs/OPERATIONS.md`.
**`site_url`** (same step; v112(b)) — the museum's own public origin
(`https://ewmuseum.org`, the value `docs/OPERATIONS.md`'s deploy notes already
carry), needed for exactly one thing: a link-out has to hand a provider an
ABSOLUTE url, and the museum will not guess its own. `validate.mjs` requires
it — an https origin, no trailing slash — wherever `translate_providers` is
present. Nothing else reads it, and no page embeds it while `public:false`.
The `recently_added[]` hand list it once carried is RETIRED (THE
PROMOTIONS-PATH WAVE, 2026-08-22): `index.html`'s "Recently added" block
is now fully mechanical — the newest `collections.json` accession lots
(accession ids are the acquisition sequence), each with a live fact line
(holding promotions via their own `sources[].accession`, shows/roleplays
via their own `collection` field) — see `scripts/stamp-stats.mjs`'s
`computeRecentlyAdded()`, the sole source of truth. Every rendered word
is computed at `npm run stats` time, never typed by hand;
`registry-validate.mjs` fails the build if `index.html`'s stamped block
drifts from a fresh recompute.


## `data/promotion-dates.json` — when a wing landed (2026-09-20)

One row per promotion id, `{added, updated}` (ISO dates), stamped by the landing machinery and never by hand: `added` is the day the wing's page or shard first entered the museum; `updated` is the last day a wave changed its holdings (a mint, a served document, a shard row, a correction, an epitaph) — the standing regen never counts. `scripts/fixers/stamp-promotion-dates.py` backfills from git history and the documents' own `served_since`; `scripts/ops/apply-delta.py` stamps the wings each wave touches. The promotions index sorts on both (the Janitor, 2026-09-20: a way to check what lands).
