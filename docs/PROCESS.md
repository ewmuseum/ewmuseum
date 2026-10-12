# PROCESS — the accession pipeline, end to end

The craft, not the law (`CURATION.md` is the law — read it first; this doc
assumes you have). Written to a stranger: someone with no memory of this
project's own history, arriving with a repo, a coordinator's brief, and
nothing else. Every convention here exists because something taught it —
the incidents are kept in, not trimmed out, because the incident is the
part that actually transfers.

## Table of contents

1. [Intake](#intake)
2. [Mining](#mining)
3. [Digests](#digests)
4. [Serving](#serving)
5. [Registry](#registry)
6. [Cross-referencing](#cross-referencing)
7. [Prose](#prose)
8. [QA](#qa)
9. [Landing a wave](#landing-a-wave)
10. [The wave-report format](#the-wave-report-format)
11. [The parallel-writer protocol](#the-parallel-writer-protocol)
12. [Onboarding a fresh executor](#onboarding-a-fresh-executor)
13. [Sequencing: the crawl before the storylines](#sequencing-the-crawl-before-the-storylines)
14. [Cartography vs. accession](#cartography-vs-accession)
15. [Hub processing](#hub-processing)
16. [The depth-tier ladder](#the-depth-tier-ladder)
17. [The tier transitions (the cold-start standard)](#the-tier-transitions-the-cold-start-standard)
18. [Coordinator craft](#coordinator-craft)

---

## Intake

**What gets accessioned next** is never a judgment call made fresh —
but the answer depends on what sits beside your clone. A workshop
(`../archive/`, machine-local, never committed) keeps its own standing
ranked queue at the workshop's `accession-queue.md` (memorial
relevance, then held-graph connection, then corpus quality): take from
the top; skip nothing without writing down why there. **No workshop
beside your clone?** Then there is no backlog to work — you are either
bringing your own material (see CONTRIBUTING.md; intake starts below)
or collecting from the public frontier — and the frontier IS a queue,
not just a ledger (the Janitor's ruling, 2026-08-22, verbatim: *"priority
#1 is documenting the fallen, priority #2 is documenting the oldest
material we can collect, priority #3 is documenting the most central
promotions"*, re-cut 2026-10-08 on the Janitor's own revision of the
second key: *"priority should be based on the earlier year we observed
them"*, and *"there's no real harm in continuing to put every year at
different priority numbers"*): `data/frontier.json` ships in this
repository with every known URL lead, and `/frontier.html` renders it in
standing queue order. Held and mined rows are off the page entirely —
it lists leads, not holdings. The rest read in bands: memorial-linked
first, then the community hubs whose own listings reveal many feds at
once, then ONE STEP PER YEAR by each row's earliest attested year,
oldest first, then the rows nothing dates at all, and last the ones
still running (listed as leads, but the dead-only rule means they cannot
be collected). Within a band, and within a year, rows read A–Z by name.
The year is the row's own `queue_year`, with the evidence that produced
it in `queue_year_basis`, and it comes from the SAME key the Wayback and
Common Crawl queues band by — one function in the workshop
(`tools/year_key.py`), under the queue law in
the workshop's `QUEUE-POLICY.md`, kept fresh on the rows by
`scripts/fixers/fix-frontier-queue-year.py` — so the served page and
the collection queue can never tell two different stories. The
tier-transition recipes later in this
document are the complete collection craft. "Accession the next
promotion in the queue," asked of a workshop-less clone, means the top
of that order.

Before a single byte is mined, two questions get answered in this order.

**Is it dead?** `CURATION.md`'s dead-only rule, restated operationally:
verify the promotion has actually stopped running before touching it. This
is not a formality — it's the gate the whole project hangs off. Two
clauses make the real record fit the rule instead of the other way round:

- **The ruin clause.** A dead promotion's old website still being
  reachable on the open web doesn't make it alive. "An unattended site
  left standing on the open web is a ruin, not a residence, and preserving
  the ruin is exactly the Museum's job." Don't let a resolving DNS record
  or a 200 status code talk you out of an otherwise-solid death
  verification.
- **The revival clause.** If a promotion the Museum already holds gets
  revived later, the holdings stay exactly what they are — the record of
  the era that already ended. The living revival is not tracked and
  nothing new is pulled from it, ever, unless and until *that* era also
  ends. Don't "helpfully" extend an accession forward because you notice
  the fed came back.

Verification in practice: a domain that no longer resolves is easy. A
domain that resolves to squatted/parked content is easy once you sample
the body (see the Mining section's placeholder-200 lesson — a resolving domain and a live
promotion are not the same fact). A domain that's genuinely still
running the fed is a hard stop **for accession** — log it in
`data/frontier.json` with `status: "verified-alive"` and collect
nothing from it until someone verifies otherwise. It is not a hard stop
for the map: under the v75 serve-not-read rider you may still read that
site politely, once, to record what it is and where it descends from on
its own frontier row. Nothing you read there becomes a holding.

**What accession lot does this belong to?** Every mining campaign is one
bounded acquisition lot, registered in `data/collections.json` *before*
the campaign's material starts landing in `data/shows.json`/`data/rps.json`
(a lot's `id` has to exist for those rows' `collection` field to validate
against it). Two kinds, and they are not interchangeable:

- **`private-donation`** — the promoter's own hard drives, or anything
  personally handed over alongside them rather than recovered from the
  public web (tabletop play-notes, a pitch document, a folder of someone's
  own saved promos). This project has exactly one such lot, `0001` — it
  is not "one per promotion," it's one gift, registered once.
- **`web-recovery`** — a single bounded public-archive mining campaign
  this project ran, with its own dates and its own research digest. One
  lot per campaign. Resist the temptation to lump multiple unrelated
  recovery efforts into one lot because they're both "from the internet"
  — a lot with a name like "everything we found on the web" isn't
  bookkeeping, it's a shrug. (This project got this wrong once — see
  `CURATION.md`'s v26 changelog entry, "the accession-lots correction" —
  and had to re-split a monolithic `0002` into thirteen real campaigns
  after the fact. Register lots granularly the first time.)

Once a lot exists, every promotion whose holdings draw from it gets a row
in that promotion's own `sources[]` array
(`kind`/`identifier`/`window`/`accession`/optional `digest` — see
`docs/SCHEMA.md`). A promotion routinely spans several lots (its own
private-donation material plus one or more separate web-recovery
campaigns) — that's normal, not a smell.

**Is this a memorial?** A third intake question, asked whenever a
contribution proposes naming a real, living-or-dead contributor by name
(`CURATION.md`'s privacy rule's memorial exception is the *only* place a real name
enters the Museum's own voice). The bar the memorial-verification-bar rule sets is
real, not a formality: this hobby staged deaths as angles routinely, and a
kayfabe death — however completely a fed's own in-fiction voice mourned
it — is never on its own enough to memorialize someone as actually,
really dead. In practice, verifying a candidate means finding at least
one of three things before the name goes anywhere in the Museum's own
voice: **in-period next-of-kin testimony** (a family member or cousin's
own tribute, written in their own voice — not a fed's staged newsdesk
running an in-fiction obituary angle), **an external public record** (an
obituary, a public memorial registry — something that exists independent
of the fed's own site), or **the Janitor's own verification**. A staged
in-fiction "memorial show," on its own, is exactly the kind of primary
source that reads most convincingly and is least sufficient — treat it as
what it is, evidence of what the fed staged, and go looking for the
out-of-fiction corroboration before treating a character's death as a
person's. The lean is still toward inclusion once that bar is cleared,
not toward suspicion — verification is a real step in the pipeline, not a
reason to hesitate on a candidate that has it.

---

### The fandom cross-check (standing intake step, the Janitor, 2026-08-24)

Before any accession's census is called done, search the local e-wrestling
fandom wiki dump (the workshop's `ewrestling_pages_current.xml`, stream it —
never load it whole) for the subject and its aliases. The wiki is a
**secondary, community-authored source**: nothing in it is served, nothing in
it overrides the corpus's own voice, and claims taken from it are graded
`presumed` with the dump cited. What it is for: **leads** — URLs, successor
and predecessor names, structural facts, and related-site constellations the
primary corpus never mentions. The CyberSlam accession is the founding case:
the dump's article carried the network's other three domains, the complete
52-fed league tree, the Hall of Fame classes, the successor (wrassle.net) and
the failed successor (CyberBrawls) — none of it in the mined corpus. Findings
go in a `<subject>-fandom-crosscheck` digest; leads go to the frontier with
the dump as `first_seen_in`.

## Mining

The actual recipe, assembled from real campaigns across this project's
own digests (the workshop's digests, outside this repo — see
`docs/OPERATIONS.md` for where that lives). Every piece below has an
incident or a specific campaign behind it; none of it is theoretical.

**The Wayback recipe, in order:**

1. **Full CDX inventory first, always** — never fetch page-by-page on a
   hunch. `web.archive.org/cdx/search/cdx?url=<domain-or-path>&matchType=<prefix|domain>&collapse=urlkey`
   gives you the complete list of what Wayback actually holds before you
   spend a single fetch. `matchType=domain` for a whole-site pull (used
   for the ewmuseum cluster: 1,791 URLs across 11 subdomains from one CDX
   call); `matchType=prefix` for a bounded path (used for the RP
   resurrection probe's three separate `roleplays/messages/`,
   `matches/messages/`, `incarders/messages/` prefixes). `collapse=urlkey`
   dedupes re-crawls of the same URL to one row — pull the row count down
   before you ever look at a body.
2. **Triage the CDX status codes before fetching anything.** `200` is a
   real capture worth fetching. `301`/`302` is usually a login-wall bounce
   (confirmed pattern on Yahoo Group captures: `games.groups.yahoo.com`
   returned 13 real `200`s against 41 `999`s and a pile of `301`/`302`
   auth-redirect bounces — the redirects were noise, not content). `999`
   is Yahoo's own rate-limit/block code specifically — expect it in bulk
   against Yahoo Group targets and don't mistake it for "temporarily
   down, try again," it's structural. A bulk **prefix CDX query beats
   hundreds of individual per-URL CDX queries** — the RP resurrection
   probe ran three prefix queries instead of 770 individual ones and
   still got a complete, correct picture in one pass.
3. **Fetch the raw form, not the rendered one:** `web.archive.org/web/<timestamp>id_/<url>`
   — the `id_` suffix returns the unmodified captured bytes (no Wayback
   toolbar injection, no link rewriting). Every real fetch in this
   project's own history uses `id_`.
4. **Pace it.** A short sleep between fetches (this project's own
   convention: 1 second) every time you're hitting archive.org's own
   infrastructure in bulk. Nobody has been rate-limited or blocked
   running this project's own campaigns at that pace; there's no recorded
   incident of it being too slow, but there's a real one (the OSW
   `ewmuseum.com` subdomain, first pass) of Wayback serving degraded
   placeholder content under load — see the false-positive lesson below,
   which a slower, more careful pass fixed on retry.
5. **A `200` status is not proof of content — sample the body.** The
   single most expensive lesson in this project's own mining history: the
   first `osw.ewmuseum.com` pass reported 0/106 captured, every fetch
   attempt returning Wayback's own generic `"503 Service Unavailable / No
   server is available to handle this request"` placeholder page —
   **wrapped in an HTTP 200**. Status-code-only triage saw 106 successes
   and moved on; the actual content recovered was zero. The gap was
   flagged honestly rather than silently accepted ("this is a real gap,
   not a shrug"), and a second pass weeks later (documented as the
   `ewmuseum-site.md` campaign, accession `0007`) succeeded completely —
   282 pages across 11 subdomains, once the contamination cleared.
   **Rule that came out of it: after any bulk fetch, content-sample a
   handful of bodies before trusting the success count** — a real `200`
   with real content and a placeholder `200` are indistinguishable by
   status code alone.
6. **Retry, don't half-fetch.** A campaign that reports "complete" after
   one pass but was actually contaminated (the ewmuseum case above) is
   worse than one that honestly reports a gap — always re-verify a
   "complete" bulk fetch's own content before writing the digest's bottom
   line. Where a fetch tool supports retrying failed/errored requests
   automatically rather than silently skipping them, use that rather than
   hand-tracking a retry list — the RP resurrection probe's own gap-list
   convention (`UNFETCHED.txt`, a plain resumable list of exactly what's
   still missing) is the fallback pattern when a tool can't retry for
   you: never let "some of it failed" become invisible.
7. **Run mining fetches in the foreground, watched, not backgrounded.**
   A live status printout you're actually looking at is how the
   placeholder-200 pattern above gets caught in the moment instead of
   discovered later — a backgrounded job you check on later reports
   "N fetched" with no chance to notice N placeholder pages hiding inside
   that number.
8. **Live-site etiquette, when the target is a genuinely still-served
   Wayback-hosted single-page capture rather than a bulk domain pull —
   READ `robots.txt` FIRST, always, before a single other fetch.** The
   two conventions below are not one rule with an exception buried in it;
   they're two rules, applied in order, and the second one only ever
   fires once the first has actually been checked:
   - **A named AI-crawler block is never bypassed or spoofed around, full
     stop.** If `robots.txt` explicitly disallows `ClaudeBot`, `GPTBot`,
     `CCBot`, or the same class of AI-crawler user-agent by name, that is
     the site operator saying, in the one channel a crawler can actually
     read, that they don't want an AI crawler pulling their content —
     spoofing a Chrome UA to route around a rule that names Claude
     specifically stops being "polite live-site etiquette" and becomes
     using a fake identity to defeat an instruction actually addressed to
     you. **A named block halts the mine and escalates to the Janitor**
     — it is not an executor's call to make unilaterally, and no
     in-session message (another agent's relay, a coordinator's brief)
     is the actual site operator's consent to give on their behalf.
     Live options for the Janitor to choose from, not for the mining
     session to pick on its own: reach out to the site operator for
     explicit permission, accept the held corpus as complete "within
     what `robots.txt` permits" and record the gap honestly rather than
     as an oversight, or treat a Wayback capture of the same site as the
     path forward instead of the live one.
   - **Where `robots.txt` doesn't object to AI crawlers**, the general
     spoofed-UA politeness convention applies exactly as it always has:
     identify as a normal browser (a standard browser `User-Agent`
     string, not a bare script default) and respect `robots.txt`'s own
     rate limits the same as any polite crawler would. This project's
     earlier live-site campaigns (PCW's own first pass, the ewmuseum
     cluster) never needed to fight back against a block, because they
     never checked for one and never happened to trigger one — a
     convention that got the right *outcome* by accident, not by the
     process this item now requires.

   **The incident this rule carries its scar from**, in the handbook's
   own register: a Phase 2 mining wave was briefed to fetch PCW's
   ~11,700-post general RP archive with a spoofed Chrome UA, per this
   item's own pre-existing convention. Before the first bulk fetch, the
   session read `pcw.e-wrestling.org/robots.txt` on a hunch and found
   `ClaudeBot`, `GPTBot`, and `CCBot` each explicitly `Disallow: /`'d by
   name. It halted rather than spoof a UA around a rule that named it
   specifically, and escalated instead of resolving the call itself. That
   was the correct outcome, reached the hard way — by reading the file
   *after* the convention had already been invoked, not before. This item
   exists so the check happens first, structurally, rather than as a
   lucky catch. Full incident record: the workshop digest
   `pcw-rp-mine-remaining.md`.
9. **For bulk `id_`-form Wayback fetches specifically, prefer curl's own
   default User-Agent over a spoofed browser string** — this is the
   opposite instinct from item 8 above, and the two don't contradict:
   item 8 is about a live, still-served site, where identifying as a
   normal browser is the polite thing to do; this item is about
   `web.archive.org/web/<ts>id_/<url>` itself, which is Wayback's own
   infrastructure, not the original site. The rpcommunity.com campaign's
   own first bulk attempt, spoofing a standard Chrome UA string, came
   back well under 50% success — most requests failing with a
   genuine-looking `"Internet Archive: Temporarily Offline"` HTTP `503`
   page. A slower retry at the same spoofed UA still failed the same
   way. Isolated by direct A/B test — the exact same `id_` URL, same
   timestamp, seconds apart: spoofed browser UA → the `503` outage page;
   curl's own bare default UA (no `-A` flag at all) → a clean `200` with
   real content, every time. The spoofed UA was the entire cause, not
   pacing: dropping `-A` entirely took the same campaign from well under
   50% to 100% success at a comfortable 2-second pace. At least one
   edge/cache path behind `web.archive.org` appears to soft-block or
   degrade a common spoofed-browser UA under load, serving this outage
   page instead of an honest rate-limit signal — sample a body (per item
   5's own rule) if a bulk `id_` pull's success rate looks suspiciously
   low with a spoofed UA in play, and try dropping it before assuming the
   archive itself is actually down.
10. **A `200` from an Invision Power Board (IPB) forum's own guest view is
    not proof of the requested content either — a related but distinct
    failure mode from item 5's placeholder-200.** Every guest-accessible
    deep link this project's own campaigns have tried against an
    IPB-powered forum (`showtopic=`, `showforum=`, `showuser=`, even
    `act=Stats&CODE=leaders`'s own leaderboard) renders the *same generic
    board-index shell* Wayback captured for that crawl, not the requested
    page — confirmed by diffing two `showtopic=` captures for genuinely
    different topic ids and finding them near-byte-identical (differing
    only in a sitewide post-counter ticking up by one). This isn't a
    Wayback capture failure: the crawler captured exactly what a
    logged-out visitor would have seen, which is the login-gated board
    index every time, regardless of which deep link it was pointed at.
    **Content-sample a handful of `showtopic=`/`showforum=` bodies from
    any IPB-powered target before a bulk fetch** — same discipline as
    item 5's placeholder-503-in-200, a different mechanism (a real,
    intentional guest-view shell instead of an outage page) producing the
    same practical lesson: a `200` and a URL whose own basename looks
    correct are still not proof the *requested* content came back. What
    IS genuinely recoverable from an IPB guest capture: board names,
    topic/reply counts, board leads, and last-poster/last-topic-title off
    the index shell itself — real, citable facts, just not the thread
    text a `showtopic=` URL's own basename promises. Full incident
    record: the workshop's `rpcommunity-forum-full.md`.

**Never reproduce a served document's own crude or era-typical corpus
text in your own working output** — this is a working-style rule for
whoever (human or Claude) is doing the mining and serving itself, not a
rule about what the Museum serves (`CURATION.md`'s verbatim-serving rule and
this section's own Serving discipline are unchanged and this doesn't narrow it). A mining/serving session's own
prose — digests, wave reports, commit messages, chat with a coordinator
— describes a document by title, date, and count; it moves the
document's own words from disk to served page mechanically, without
relaying them a second time in its own voice along the way. This
distinction matters operationally, not just editorially: an agent
session's own output is read by systems and processes that have no
reason to expect era-typical crude material and can react to it
appearing outside its proper served context — a session that quotes a
corpus passage at length in its own summary risks exactly that,
independent of whether the document itself is perfectly fine to serve
whole under `CURATION.md`'s verbatim-serving rule. Describe what a document is and where it went; let the
served page itself be the place its own words actually live.

**Local file conversion:**

- `.doc`/`.docx`/`.odt`/`.wps` files (a promoter's own drive material,
  never Wayback captures) convert via `libreoffice --headless
  --convert-to txt` — clean, reliable, no fallback needed in this
  project's own history. No throttling required for local drive material;
  the pacing rules above are for hitting someone else's server, not your
  own disk.
- Anything HTML/text scraped or downloaded gets **cp1252-tolerant**
  stripping to plain text, not a strict-UTF-8 parse. Early-2000s
  message-board software routinely wrote Windows-1252 bytes labeled as
  something else; a strict parse corrupts every smart quote, em dash, and
  accented character into mojibake (`â€™`, `â€œ`, `â€"` — the exact
  failure signature seen across multiple campaigns, e.g. PCW's own
  corpus) instead of failing loudly. Decode permissively, verify a sample
  by eye afterward. **Decode the bytes actually on disk, not the page's
  own label** (2026-09-22): PCW's live-site capture was saved as valid
  UTF-8 while every page still declares `windows-1252` in its own meta
  tag — reading those files as cp1252 manufactured the mojibake; UTF-8
  was right. Mojibake is corruption, not content: reversing a
  double-encoded sequence restores what the fed wrote. land-check prints
  a MOJIBAKE-NOTE for any served page still carrying the signature.

**A text flattener that drops `<img>` drops data.** LOW's own
`rivals.cgi`/`allies.cgi` pages and its front page's own latest-roleplays
credits strip both read as *empty* to a first pass because the content
lives entirely in `alt=`/`title=` attributes, not visible text — 34
relationship edges and 35 authorship credits were logged as an honest
negative before a second pass checked the attributes and found them all
sitting there. Before recording a page class as empty, check its
attributes, not just its text.

---

## Digests

the workshop's digests — one per mining campaign, written for the next
person doing the actual accession work, not for the museum's visitors.

**Workshop, not museum.** A digest is scratch-grade research prose. It can
speculate, flag unresolved conflicts, hedge, and think out loud in a way
the museum's own served pages never do. It lives entirely outside this
repo (see `docs/OPERATIONS.md`) precisely so that distinction never has to
be enforced by restraint — it's enforced by which filesystem the words are
on.

**Privacy still applies inside a digest**, though differently than on a
served page. A digest can name a real handler where that's genuinely
useful for the researcher doing the next pass (a museum-voice sentence
never can, full stop — see `CURATION.md`'s privacy rule) — but a digest is not a
license to gossip, and nothing in a digest's own phrasing is safe to
copy-paste into museum voice without passing it back through the privacy
rule first. Treat a digest as internal, not as a source you quote
verbatim into a wing page.

**Joy-finds are house culture, not noise to edit out.** When a mining pass
turns up something genuinely delightful — a fed's own self-aware joke
tagline, a wrestler billed as literally "Mystery Opponent," an inanimate
object holding a championship — the digest says so with the same
enthusiasm the discovery earned. This project's own digests are full of
exactly that register, and it's correct: the person doing the next
accession should know what kind of good time is waiting in the corpus,
not just its row counts.

**Schema friction is a first-class deliverable, not a bug to hide.** When
a mining pass surfaces a fact that doesn't fit the current registry shape
cleanly — two title lineages that disagree, a stable whose membership the
source itself contradicts, a name that reads as two different spellings
of the same thing — the digest records the friction explicitly rather
than picking a side to make the JSON cleaner. `data/review-queue.json`
and the "when sources disagree, the Museum records both" doctrine
(`CURATION.md`'s sources-disagree rule) exist because digests kept surfacing exactly this kind
of thing honestly instead of quietly resolving it.

---

## Serving

Turning mined material into a page under `promotions/<promo>/archive/` or
`promotions/<promo>/rp/`.

**The words are verbatim; the wrapping is not.** The single clearest
statement of this distinction in the project's own history: source files
from the era were frequently **hard-wrapped at a fixed column width** (a
holdover from how text editors/terminals of the time saved plain text),
and an early version of the conversion tooling (workshop-side,
`genshow.py` — lives with the mining tools, not in this repo) reproduced
every such source newline as a visible line break in the served HTML,
splitting sentences mid-thought (`"there are 2\nAce Thunders!"`). The fix
was **restoration, not editing** — "a folded letter flattened back out,
no words changed." A bare newline inside a block of source text now joins
with a space unless the next line opens with what reads like a new
speaker tag (`"Name: ..."`), in which case the break is kept — the safer
failure on inspection across both dialogue-heavy and list-heavy pages.
Structural HTML breaks (`<p>`/`<br>`/`<div>`/...) are always respected
regardless. **The rule this generalizes to: presentation artifacts of the
original medium (line wrap, whitespace runs, a stray editor artifact) are
fair game to repair; the actual words, spelling, and grammar of the
source text are never touched, no matter how tempting a typo is to fix.**

**The privacy redaction (v73, 2026-08-22) is the one byte-level exception
to "the words are verbatim."** A living person's own contact detail (an
e-mail address, a messenger handle, a phone number) inside an otherwise-
servable document is replaced by the marker `[detail withheld]` — the
smallest span only, never the sentence around it; the marker names neither
the person nor what came out (the Janitor's D480, 2026-10-09: *"(a) plain
rename"*; CURATION #redaction-marker-wordings, v133); the page's provenance
line says
the document carries a redaction; the accession digest logs which
document and why. It exists for exactly the case that produced it (an
OOC aside inside an MWE roleplay, topic 9211037) and for nothing else:
crude, dated, or embarrassing text is what the content notice is for,
and stays whole. Do not generalize it; if a new shape of privacy conflict
turns up inside a document, withhold and escalate, the way this one was.

**Every served document carries the content notice** (`CURATION.md`'s verbatim-serving rule,
quoted there in full) — a period document served unedited, carrying the
era's own humor/language/content including material that wouldn't be
written today, served whole because pretending it didn't happen would be
a worse dishonesty than being embarrassed by it. This is boilerplate, but
it's load-bearing boilerplate: don't paraphrase it per-page, use the
established wording.

**The served-page output shape** (XUW wave — this was reverse-engineered
from an already-served page rather than written down anywhere, which
cost a cycle). A card/show/ceremony page is **not** built from `<p>`/`<br>`
paragraphs. It's a single block, restored per the hard-wrap rule above,
dropped verbatim into one `<div class="document">` — `style.css`'s own
`.document` rule carries `white-space: pre-wrap; overflow-wrap: break-word`,
so the restored newlines render as line breaks with no markup needed
beyond the wrapping div itself. Minimal shape:

```html
<div class="document">Line one of the restored, HTML-escaped text
Speaker: a new line only where the source itself reads as a new
speaker tag or bracketed stage direction — everything else on one
logical line, however long
Next beat continues here…</div>
```

Escape with the numeric-entity convention already used sitewide
(`&#x27;` for `'`, `&quot;` for `"` — Python's `html.escape()`/
equivalent default output; don't hand-pick a different entity set).

**Serving scope is a curated, bounded selection by default, not
exhaustive.** Nothing in this document or `CURATION.md` requires every
surviving show/episode to be served — precedent (IWF: `depth:
"documented"`, nine archive pages served out of a larger surviving
corpus) is a curated selection, chosen for what it actually shows about
the fed, with the rest reachable live via `/shows.html?promo=<id>` once
`data/shows.json` rows exist for what *is* served. A wave that wants to
commit to *exhaustive* serving of an entire corpus (hundreds of
documents) is a large, multi-commit undertaking in its own right and
should be treated as its own deliberate wave, not folded silently into
a "full processing" pass — flag the scope explicitly rather than either
assuming it's required or ruling it out unilaterally.

**A roster/bio card IS served, with its Handler Information redacted (the
Janitor's ruling, 2026-08-23, verbatim: *"the character details are good if
handler details are redacted"*).** This paragraph used to say the opposite
— mine the card, never serve it — which was IWF's own unwritten precedent
and XUW's explicit rule, both written before the instrument existed to do
better. `CURATION.md` v73 and v74 supply that instrument, and the Janitor's
own v73 words are the reason it now points this way: *"an honest privacy
redaction is superior to not serving the content at all."* The craft, in
order:

- **Serve the card as its own archive document wherever it carries
  character content** — backstory prose, kayfabe fields (height, weight,
  hometown, alignment, style, finisher, moveset), title history, allies and
  rivals, quotes, entrance music. That is the fed's own writing about its
  own fiction, and it is exactly what this museum exists to keep.
- **Redact the Handler Information block** — a real first/last name, an
  AIM/MSN/ICQ screen name, an e-mail address, a phone number — under the
  v73/v74 markers, at the narrowest spans the redaction rule already
  defines. Where a lane judges the block itself to carry nothing but
  handler data, omitting the block whole under a provenance note is the
  permitted alternative; **say in the accession's own digest which of the
  two the lane chose**, so the decision is legible and reversible.
- **A kayfabe "Real Name" field is character content and STANDS.** A card's
  in-fiction "Real Name: Jack Blarny" is the fiction naming itself, not a
  document stepping out of fiction to say who wrote it — the
  characters-are-filed-as-characters coincidence clause reaches into a bio
  card exactly as it reaches into a credit block.
- **An empty template card is withheld** — a bio page whose every field is
  literally `...` (UWF's own captured submission template) has no character
  content to serve and gets no page.
- **Every redaction is logged** in the accession's workshop digest, name by
  name, the same as any other application of the privacy redaction.

Mine the kayfabe fields into the tenure and cite the card as the tenure's
`source` exactly as before — that half never changed; what changed is that
the card itself is no longer thrown away after being read. Precedent on the
ground: TF's own nine served roster cards (accession 0035, 19 marked
redactions), with LOW's in flight.

**A POSTER FED is served per person, and the read that decides it comes
before the serving pass.** Where a fed's roster IS the community it
posted into — the poster-fed rule, `CURATION.md`'s v105 rider — no
single decision covers the wing. The lane reads the corpus for the
participation test one name at a time and records the split in its own
digest before a document is converted: who answered his own booking in
character (serves verbatim, posting name and all), who was written in
by someone else (the marker serves in place of a persona that was only
ever his name), who objected on the record (redacted wing-wide, with a
note saying an objection is why), and which documents fuse real
harassment or abuse into the kayfabe (withheld whole at the document
level — a term-level deny row cannot do that job). Look first for the
fed's own consent convention, if it invented one: a period marker in
which a poster steps into and back out of character is the strongest
participation evidence a corpus can carry, and it settles the (a) cases
faster than any inference about them ever could.

**No live Wayback access from an agent session is the common case, not
the exception.** A session may not be able to reach `web.archive.org`
at all (sandboxed network access) even with a URL and a known path.
When a source document itself carries no date and a CDX lookup isn't
available: use `precision: "circa"` or `"unknown"` (never a guessed
exact date), and say plainly, in the page's own provenance paragraph,
*why* — internal evidence that bounds a window (a title reign, a
folder-year), or nothing at all. "Undated in the source; not otherwise
recoverable this pass" is a complete, honest `date` value.

**Territory-of-a-territory** (a developmental/feeder fed run *by* an
already-held promotion, e.g. XUW's own XUDF): the working precedent,
until a case argues otherwise, is to document it in prose on the parent
wing (Epitaph/Storylines) and via the existing `academy` affiliation to
an `unheld` frontier entry — not to mint it as its own `promotions.json`
row, and not to individually mint every name on its own roster that
doesn't also appear in the parent fed's own records. If a
territory-of-a-territory's own surviving record turns out deep enough to
stand as a holding in its own right (its own site, its own accession-
worthy corpus), that's a deliberate promotion-grade decision to make
explicitly, not a default.

**A community hub is processed differently from a promotion, and the
difference is what it has instead of shows (THE HUB-ENTITY GAVEL,
`CURATION.md` v76; first worked in the RSPWF.com accession, 2026-08-23).**
A hub stages nothing. It hosts, indexes or serves a community, and what
survives of it is its own PAPERWORK — a fed directory, a classified board,
a column series, a rankings page, a links wall. Process it in that order:

1. **Serve the paperwork whole, class by class.** Each class of page is
   one document type with one extraction, one privacy pass and one
   provenance line, and they are worth doing separately rather than as
   one sweep: a directory listing fails differently from a classified ad,
   and a column fails differently again. Serve every page in a class or
   say in the accession's own digest which subset you served and by what
   rule you chose it — "curated" is allowed and "curated by taste" is not.
2. **Give a `shows.json` row only to the documents something else
   cites.** A hub's dated, load-bearing documents (a year-end poll, a
   dated news item) are registered as documents, the same way PTC's own
   news archive and NFW's own About page already are. Its bulk paperwork
   is served, reachable from the wing's own generated holdings register,
   and unregistered — TF's own nine roster cards are the precedent. A hub
   that staged nothing must not report hundreds of shows.
3. **Structure the paperwork, not the calendar.** A hub reaches Tier 2 by
   turning its own ranked list, its own directory or its own ballot into
   real edges — an award with bestowals, a set of frontier rows — not by
   a show-by-show crawl of shows that never existed. Say the fraction in
   `tier_source` in those terms.
4. **Expect the privacy work to be front-loaded and administrative.** A
   hub's documents are where a community stepped OUT of fiction to say
   who ran what: an `Owner:` field, a byline, a compiler credit, a
   "contact me at". That is v73/v74 territory on almost every page, and
   it is cheaper to settle ONE uniform rule per field (and log it) than
   to make a hundred separate calls you cannot individually receipt.
5. **The community is not the hub.** Where a hub serves a newsgroup, a
   mailing list or a board that predates and outlives it, the wing is
   the hub; the community is stated in the wing's own prose and on its
   placard, and no edge is invented for something with no row on the
   other end.

**Appearances: fresh-filmed content vs. archival replay (THE ANTI-
DOUBLE-COUNT STANDING RULING).** A live broadcast routinely reuses
footage — a "previously on" recap, a replayed match, a highlight-reel
cold open — and the standing rule is anti-double-count: **replayed/clip
content sitting inside a live broadcast never generates a new
`appearances[]`/`matches[]` row on the AIRING show.** It IS
receipt-grade evidence for the ORIGINAL show and its own reign ledger
(a replayed title change is still evidence that title change happened,
cited to where it actually happened), just never a second appearance row
for the show that happened to air the replay. The corresponding
extraction gotcha, caught twice in the fleet era: a same-signature bug
(an `ensure()`-style helper that skips creating a row if ANY row for that
entity already exists on the show) needs to be KIND-AWARE, not just a
`who`-only check — a commentator who also wrestled on the same card, or
a name reused across a cold-open AND the live card proper, needs both
rows, and a bare existence check silently drops the second one.

**Fresh-filmed content is not archival content, even when it's staged as
a flashback or a sketch.** The anti-double-count rule above is about
REUSED footage specifically — a cold-open sketch shot FRESH for that
week's broadcast (new material, even if it's staged as a flashback beat
or an in-universe skit) is live content and earns an ordinary
`appearances[]` row on the show that aired it, same as anything else on
the card. The distinguishing question is never "does this look like a
recap" — it's whether the served text is describing something shot new
for this broadcast or something lifted whole from an earlier one; when
genuinely unclear, treat it as fresh (an honestly-added appearance is a
smaller error than a silently-dropped one) and note the ambiguity if it
matters to the record.

**THE REPLAY-DOCUMENT MODEL** (THE IDENTITY WAVE, 2026-08-22, confirming
existing doctrine in one clarifying sentence): a show that is itself
substantially or entirely a replay/fragment package — a "Best of" clip
special, a retrospective assembled from earlier footage, the same shape
an awards-ceremony page already gets served under — is still held and
linkable as its own `shows.json` document (its own `id`, its own served
page, citable from wherever it's relevant) exactly like any other show;
what it does NOT do, per the anti-double-count rule immediately above, is
generate new `appearances[]`/`matches[]` rows for the replayed content it
carries. The show exists as a document; its replayed content is evidence
for the ORIGINAL show it came from, never a second live card.

**A show's segment index may exist only in the raw capture.** LOW's own
shows carry `<a name="<segment title>">` anchors — a per-segment index
independent of any credits block — which the serving conversion strips; a
pass working only from the credits block correctly reported seven shows
had no index, missing that the anchors were a second index the credits
block never surfaced. The two overlap but neither substitutes for the
other; check both before recording a show as unindexed.

**The holdings register truncates a document's label at the first em
dash.** A `<title>` of "LOW &lt;name&gt; — LOW bio card" renders as "LOW
&lt;name&gt;" on the register, so a wrestler's own bio card and his own
career-history page collide there unless the distinguishing word comes
before the dash — write a served page's own `<title>` with that in mind.
ACW served three documents per wrestler (bio card, record card, allies
card) and would have produced a three-way label collision on `Alias`
alone had its titles followed the LOW-style "&lt;name&gt; — ACW bio card"
pattern; composing them as "ACW bio card: &lt;name&gt;" instead avoided
it. The general rule: put the distinguishing words before the first em
dash, not after it.

**Chrome and stats stamping happen after serving, not instead of it.**
`npm run chrome` re-stamps every page's masthead/footer from
`templates/chrome.html` and normalizes the archive-page crumb pattern
(`Museum / Promotions / <Acronym (year)> / Card Archive / <show>`) —
idempotent, safe to run repeatedly, and it must run before `npm run
check` or the gate fails on stale chrome by design. `npm run stats`
re-stamps the homepage's own build-time counts the same way. Neither is
optional and neither substitutes for the other — see the QA section for the two
incidents (the script-eating stamp, the stats drift) that made both of
these hard requirements rather than suggestions.

**The canonical-copy rule has two applications, same underlying
principle.** First, ownership: a show two promotions both legitimately
claim (an alliance supercard, a cross-promotion special) belongs to
exactly one promotion's row in `data/shows.json`; every other promotion
that was really there references that one row rather than getting a
duplicate (`CURATION.md`'s canonical-copy rule, in full there). Second, upgrades: when a
richer or fuller copy of an *already-served* document is later found —
this project's own recurring case: a page originally served from a
thinner Wayback nav-shell, or a "Part One only" partial recap, gets
replaced in place by the complete version once a fuller source turns up
— the upgrade happens at the same URL, not as a parallel "v2" page, and
the page's own provenance paragraph says plainly what was upgraded and
why ("This page previously served only Part One... upgraded 2026 to the
complete recap, per the canonical-copy rule"). Both applications share
one idea: **one true copy per document, never two versions quietly
drifting apart.** A **richness-mismatch upgrade** specifically means: the
old served copy and the newly-found source disagree not on facts but on
completeness — the new one is strictly fuller, so it replaces the old one
outright rather than getting merged sentence-by-sentence.

---

## Registry

Turning served documents and digest research into `data/*.json` rows —
full schema in `docs/SCHEMA.md`; this section is the *practice*.

**Minting.** A new character/unit/title/show gets a permanent slug id at
creation (`CURATION.md`'s slugs-are-identifiers rule). **Generic
archetype names get a promotion/year-qualified slug at mint time, always**
— "Wolf," "The Plague," "Grim Reaper," any name a second unrelated fed is
likely to reuse independently. This is a minting-time discipline, not a
retroactive renaming campaign: the ten-ish existing clean slugs already in
the registry (`the-prodigy`, `jay-phoenix`, `lew-spectre`, `grim-reaper`,
and a handful of others) are grandfathered and stay exactly as they are —
`registry-validate.mjs` soft-flags them forever as a reminder, never fails
the build over them. Get the *next* one right; don't go back and rename
the old ones.

**A blanket promotion-suffix on every mint is a per-lane choice, not a
new standing rule.** The ACW accession (lot 0037, 2026-08-23) suffixed
`-acw` onto every mint from that lane, including distinctive names that
would not have needed it under the generic-name test above — a
deliberate, more-aggressive-than-required call the lane brief itself
directed. It stands as accepted for that accession; it is not retroactively
applied to any other promotion's existing slugs, and it does not change
what the mint guard actually checks — its own collision test (exact
name/aka match, hard-fail; decorated-substring containment, soft warn) is
still the rule a lane's own naming choice has to satisfy, whether that
lane qualifies every slug up front or only the ones the guard would have
caught anyway.

**Run the join test at every accession, both directions (the RSPWF Top
200 accession, 2026-08-23).** The join test is the one method that has
repeatedly turned an unresolvable acronym into a named federation: a fed
acronym and a ranked wrestler's own name appearing in the SAME document
is worth more than any number of initials matches. Since the RSPWF Top
200 is held, the index it needs is a file rather than a research pass —
the workshop's `master_wrestlers.json` (1,026 ranked names) and
`master_acr.json` (317 fed tags), both spanning 1997–2004.

Two checks, both cheap, both at accession time rather than after:

- **Incoming corpus against the index.** Grep the newly-served corpus
  for the acronym you are accessioning under, and for every ranked name
  the index carries. A hit that puts a ranked wrestler inside the fed
  you are accessioning is a primary-source resolution for that acronym
  — record it on the frontier row and in the accession's own digest.
- **New mints against the ranked set.** Every name you mint gets checked
  against the 1,055 characters the Top 200 already carries. A match is
  NEVER a merge — the no-auto-merge rule is absolute and the poll gives
  a ring name and a federation tag and nothing else, so three of the
  collision doctrine's four signals are simply absent — but it IS a
  review-queue entry, and filing one at mint time costs a minute against
  an identity audit later.

The same check protects the privacy pass: a name that is also a ranked
wrestler's own billing STANDS in a credit block, per the coincidence
clause, and the index is how you know before you redact rather than
after.

**Tenures carry the facts; the entity carries the identity.** Height,
alignment, finisher, style, hometown — anything a fed's own telling could
disagree with a different fed's telling about the same carried-over
character — lives inside `tenures[]`, one entry per promotion the entity
appeared in, never on the entity record itself. Where a tenure's own
dating is genuinely uncertain, say so at the actual precision the source
supports (`"first_seen": "1998"` with no month, `"?"` where nothing
survives) rather than inventing a plausible-looking exact date. Honest
imprecision beats false precision every time this project has had to
choose.

**`tenures[].roles[]` has no interviewer/reporter value, while
`appearances[].capacity` does.** A character whose whole surviving record
is backstage interviewing has nowhere honest to file inside a tenure's own
`roles[]` and gets flattened to `other` — a live hard-fail the LOW
accession hit three times before finding the right field. Check
`appearances[].capacity` first for a backstage-only credit; it's the field
built for exactly this shape.

**`record`'s bucket model (`single`/`tag`/`cluster`, summed as mutually
exclusive) is not universal.** LOW's own W/L table treats Cluster, PPV,
and Main Event as cross-cutting tags over the same matches its Singles and
Tag rows already count, so recording `cluster_*` straight from a table
shaped like LOW's overcounts. Check whether a fed's own categories are
exclusive buckets or cross-cutting tags before mapping them onto `record`.

**Evidence grades, used everywhere identity or a contested fact needs
one:** `primary-source` (the fed's own contemporary record says so),
`user-attested` (a contributor's own memory or ruling says so),
`presumed` (a curator's best reading, held loosely). Every identity
assertion, every provenance-notes claim, every `portrays` link carries
one. Grade honestly — a `presumed` merge that turns out right is fine; a
`primary-source` grade on something that was actually a guess corrodes
the whole evidence system's credibility.

**No auto-merge, no silent distinctness.** Two records sharing a name are
never quietly treated as the same entity; two separate records are never
quietly treated as provably different just because nobody's said
otherwise. The only way identity changes is an explicit, graded assertion
— recorded, never applied silently. When the tooling notices a possible
duplicate (similar name, overlapping era) it writes the pair to
`data/review-queue.json` and stops there; a human verdict either merges
it (with a grade and a note) or closes it `distinct` (which permanently
stops that pair resurfacing — it does not mean "probably distinct, keep
asking"). **Never resolve a queue entry by guessing under time pressure**
— an open queue entry that stays open honestly is strictly better than a
wrong verdict recorded with false confidence.

**The aka-collision mint guard: an EXACT hard fail, plus a DECORATED
soft warning (PERFECTION WAVE A, 2026-08-21 — the gap closed).**
`registry-validate.mjs`'s mint guard (`CURATION.md`'s v45 changelog entry
has the full history) hard-fails a new entity whose name/aka collides,
case-insensitively but exactly, with an existing entity's own name/aka. A
near-duplicate mint self-caught in the fleet era slipped past it
precisely because the collision wasn't an exact string match: a new
`rabbi-of-pain-uwf` mint and the already-registered
`rabbi-mort-schwartzman` are the same character under two different
DECORATED names — a nickname/moniker ("Rabbi of Pain") that reads, in
fiction, as clearly the same person as a fuller registered name it
doesn't literally contain or equal. This stood as a known, documented gap
in the validator for a while; it's closed now. The same mint-guard block
also normalizes every name/aka (lowercase, strip quotes/punctuation, drop
a leading article, collapse whitespace) and checks CONTAINMENT BOTH
DIRECTIONS against every other entity in the registry — a new entity's
normalized label containing, or contained by, an existing one's. Unlike
the exact check, this is a **soft warning (`possible-duplicate`), never a
hard fail** — legitimate similar names exist at this scale (a short
generic archetype two unrelated feds both landed on, a real coincidence
the no-auto-merge rule already protects), so a decorated-substring match
is evidence worth a human's look, not proof of a duplicate worth blocking
a commit over. Verified live against the real rabbi-of-pain-uwf/
rabbi-mort-schwartzman case per the validator-testing precedent (a decoy
entity injected, confirmed to warn, confirmed silenced once given a
matching `identity[]` note, fully reverted) — see `docs/SCHEMA.md`'s
`aka[]` entry for the mechanical detail. The SAME pass also fixed a
latent, unrelated bug the live test surfaced: the mint guard's own `git
show HEAD:...` read had no `maxBuffer`, so Node's 1MB default silently
truncated it (an `ENOBUFS` swallowed by the same catch block that quietly
skips a non-git-repo) the moment `data/characters.json` grew past a
megabyte — the ENTIRE mint guard, exact check included, had been
silently never running for some stretch of the registry's own growth
before this fix. Hand-checking a new nickname-shaped name against
similar-sounding existing entities (a quick grep across
`data/shards/<promo>/characters.json`'s own `name`/`aka` values) is still
good practice, but the gate itself now backs it up.

**The `EXCLUDE_NAMES` hand-audit law.** `scripts/cross-reference.mjs`
auto-links every entity's name wherever it appears in curated (non-
verbatim) prose — powerful, and exactly the kind of mechanism that
produces a false positive the moment two different things share a common
word. `EXCLUDE_NAMES` is the hand-maintained escape hatch: a name goes on
the list, with a comment explaining exactly what it collided with, the
moment a real false positive is caught — never preemptively, never
"just in case." The project's own greatest hits, every one caught live in
served output before being added:

- **"Nobody"** — an NAPW wrestler literally billed as "Nobody," which
  auto-linked into ordinary English sentences ("Nobody will be able to
  stop him," "Nobody ever fixed it") across unrelated served documents
  the moment it was minted.
- **"Purple Haze"** — a UWF wrestler's ring name, which auto-linked into
  a resurrected roleplay's own opening stage direction — "['Purple Haze'
  by Jimi Hendrix hits the sound system.]" — the *song* playing a
  different wrestler to the ring, not this one.
- **"Flash"** — an IWF roster-page mint whose only other corpus hit was
  "Flash bulbs go off," ordinary prose, not the wrestler.
- **"Meltdown"** — an aka for a GIWF/UWF wrestler that's also WWA's own
  house-show brand name; caught live wiring itself into the WWA wing's
  own prose about WWA's *Meltdown* show.
- **"DDT"** (XUW wave) — a real, multi-time XUW champion's own ring name,
  but also one of the most common wrestling move names in the entire
  corpus; caught live wiring itself into GIWF/IWF/UWF roster and Hall of
  Fame pages and half a dozen served UWF RPs, none of which were this
  wrestler.
- **"Destroyer"**, **"Money"**, **"Rage"** (XUW wave) — three more thin
  XUW win/loss-table mints, each an ordinary word or (for Destroyer) a
  name already carrying an unrelated, well-established meaning elsewhere
  in the corpus (UWF's own "Dutch/Raving Jewish Destroyer" gimmick).

Read the full comment block above `EXCLUDE_NAMES` in
`scripts/cross-reference.mjs` for the complete list (also: Superstar,
Phoenix, Force, Cage, Freak, Havoc, Chris Storm, The Final Fantasy,
Angel) — every entry there is a real caught incident, not a hypothetical,
and the pattern repeats: **a short, common, or story-significant word
used as a ring name will eventually collide with ordinary prose or a
song lyric or another fed's own branding.** Check new mints against this
risk before they ship, not after a false link is discovered live —
diffing every file the toolchain touches (`git status` after `npm run
refresh:links`, before committing) is the cheapest way to catch one live,
since a collision always shows up as a link inserted somewhere it has no
business being.

**THE BARE-NAME RULE (MWE accession, 2026-08-22).** Promotion-context
narrowing only ever fired when a name had two or more candidates; a name
registered to exactly one entity in the whole registry linked wherever it
appeared, in every promotion's prose. Serving 628 MWE roleplays surfaced
83 false positives in one regen — "Sara" (XUW) wiring into MWE's own Sara
Patterson, "Shawn" (GIWF) into MWE's Shawn Spitzer, "Evil" into "Evil Dead
2", "Steel" into "Steel Cage", "Hammer" into "MC Hammer" — and 83
`EXCLUDE_NAMES` entries would not survive the 500-promotion test. The
linker now applies a structural rule on any page that belongs to a
promotion: a single resolved candidate with no tenure or appearance in
that promotion links ONLY when the matched name is more than one bare
word (a leading article doesn't count). Multi-word cross-promotion
mentions ("John Austin" from WHQ, "Rocky Stevens" from WcE, both named in
MWE promos) still link — that's the graph working; a lone first name or
common word from another fed's roster is a guess, and the linker never
guesses. `EXCLUDE_NAMES` stays the escape hatch for the cases this rule
can't reach (a bare word that IS in the page's own promotion but still
collides with ordinary prose — the Nobody/Flash/DDT class).

**The auto-linker's reach includes `promotions/*/rp/*.html`, deliberately —
this is stated here explicitly because it isn't stated anywhere else and
reads like an oversight until you check.** Only `promotions/*/archive/*.html`
(the `ARTIFACT_RE` pattern in `scripts/cross-reference.mjs`) is fenced
off from auto-linking; served roleplays under `rp/` get the same
entity-link treatment as curated prose (the "Purple Haze" incident above
happened *inside* a served roleplay's own stage direction, which is how
it was caught). The link itself is presentation, not a content edit — it
wraps existing text in an `<a>`, same discipline as a chrome/crumb
repair — but it means an `rp/` page needs the same false-positive
scrutiny a curated page does, not the blanket protection an `archive/`
page gets.

**Controlled vocabulary over verbatim records (THE STYLE FAMILIES WAVE,
2026-08-18, user gavel: the style filter was "ungainly with almost as many
styles as wrestlers").** `data/style-families.json` is a NAVIGATION-ONLY
finding-aid layer over the verbatim per-tenure `style` strings — a
library-subject-headings model, not a rewrite. It groups the corpus's
scores of distinct, hand-typed style strings ("Hardcore/Grapple," "extreme,
Luchador, Grappler," "Innovative (brawler, light technician, daredevil)")
under a small set of families (All-Around, Hardcore, Technical/Mat, High-
Flyer/Aerial, Powerhouse, Brawler, Martial Arts/Striker, Submission,
Showman/Entertainer) so a filter can surface "every current Hardcore
variation" without anyone having to already know all fifty spellings of it.
The doctrine, stated once so it doesn't need restating at every call site:
**grouping is a navigation device, never a claim about the record.** A
verbatim `style` string is never edited, normalized, or replaced by its
family name anywhere it's actually DISPLAYED (a tenure block, a placard, a
caption) — the family layer only ever widens what a FILTER matches, same
spirit as the `species`-joins-the-search-blob wiring above it in this doc.
A composite string ("Mat Technician/High Flyer") can honestly map to more
than one family; a string that doesn't honestly describe a fighting style
at all (a stray manager note, a data-entry artifact, a bare mood word) is
left unmapped rather than force-fit — `registry-validate.mjs` soft-warns on
both unmapped registry strings and mapped-but-nonexistent variants (mapping
hygiene), never hard-fails either, since a finding aid trailing a growing
corpus is the normal state of the thing, not a defect. See
`docs/SCHEMA.md`'s own entry for the file shape.

**THE STANDING ACCESSION STEP — the Top 200 roster join** (the Janitor,
2026-08-23). Every accession lane, on minting its own roster, greps that
minted roster against the workshop's `master_wrestlers.json` and
`master_acr.json` — the RSPWF Top 200 join index the hub-processing
lanes above already fold in, built once and reused everywhere. A name
hit is a RANK FACT for the character (a ranked-wrestler receipt worth a
tenure note, same as any other primary-source fact); a fed-tag hit is a
resolution VOTE for the tag (Hub processing's own framing above —
corroboration that a real e-fed used that acronym, never proof of
identity on its own). Both get reported in the lane's own wave-report or
digest, not silently folded into ordinary tenure prose with no trace of
where the fact came from.

---

## Cross-referencing

`scripts/cross-reference.mjs` is the single generator that turns the
registry into linked, browsable pages: every per-entity
`characters/<id>.html`, every `collections/<id>.html`, the A-Z and season
pages, the affiliations/provenance/browse-live sections on wing pages,
and the auto-links woven into curated prose. **`characters.html` itself is
NOT one of them** — THE 397/400 FUSE WAVE turned it into a hand-maintained
instrument page (fetches `data/characters-index.json` at runtime, filters/
windows client-side); a stale duplicate template inside this script kept
silently overwriting it on every run until THE CLOBBERING-BUG FIX (prev/
next navigation wave) found and removed it. If a future wave wants
`characters.html` machine-generated again, that's a real redesign
decision, not a one-line fix — say so explicitly, don't just resurrect
the old template. (Section renamed from `wrestlers.html`/`wrestlers/` to
`characters.html`/`characters/` — THE FRONT-ENTRANCE RENAME, 2026-08-20 —
everyone under the broad slug, wrestlers and non-wrestlers alike.)

**Idempotency is load-bearing, not a nicety.** Every marker-delimited
section it patches (`<!-- epitaph:start/end -->`,
`<!-- affiliations:start/end -->`, `<!-- provenance:start/end -->`,
`<!-- browse:start/end -->`, the chrome markers) is designed so running
the script twice in a row with no data change produces a byte-identical
result. This is what makes it safe to run after *any* registry edit
without first figuring out exactly what changed — always run it, always
check the diff makes sense, never skip it because "that edit probably
didn't touch anything it regenerates."

**Serving a show grows reign-link coverage automatically — but only if
you re-run the registry, not just drop the page.** THE REIGN-SHOW
LINKAGE INVARIANT (`docs/SCHEMA.md`'s `reigns.json.event`, user gavel:
"an unlinked date must MEAN the show is missing") means a reign's "won"
cell (and, via the next row's own `event`, the previous reign's "lost"
cell) only becomes a link once `data/reigns.json`'s own `event` field is
wired to the new show's id — serving the page alone doesn't do this,
`registry-validate.mjs` just starts hard-failing on it, correctly,
since a uniquely-matching served show with no `event` wired is now a
build-breaking regression, not a soft gap. Match by promotion + exact
`won` date; where more than one served show shares the date, look for a
disambiguator in the reign's own `how` text (an event-name fragment, an
initials match like "SAS"/"WNU") before giving up — never guess, and a
genuinely irresolvable tie gets an honest ambiguity note in the reign's
own `note` field instead of a link. This is exactly why the check is a
hard fail rather than a soft one: it's cheap to satisfy the moment it's
known about, and staying soft would let coverage quietly rot the same
way stale chrome or stale stats once did.

**Backlinks need the same care as forward links.** A per-entity page's
own "appears in" / relationships / affiliations sections are backlink
data, generated from the same registry the forward links come from —
when an entity gets merged, renamed, or its tenures change, both
directions need to end up consistent after the next regeneration, not
just the direction someone happened to be looking at. The recurring bug
class here (see the QA section, "same entity ends up on both sides of a match") comes
from exactly this: a merge's forward re-pointing succeeding while a
structural backward reference (a bare string sitting inside an array,
not a named object property) got silently missed by an incomplete
re-pointer. Test both directions after any identity change.

**A tenure-less mint's empty promotion set is a blind spot in THE
BARE-NAME RULE, not a second application of it (the RSPWF wing's
adversarial regen, 2026-08-23).** The bare-name rule (Registry, above)
only ever blocks a single bare word whose entity has no tenure in THAT
page's own promotion — but an entity with no tenure ANYWHERE satisfies
that condition on every page at once, so the rule never fires for it, on
any page, for any name length. The asymmetry this produces: a one-word
tenure-less mint is safe on promotion pages and only dangerous in
captions and other context-less registers, exactly like any other bare
word the rule already guards; a TWO-OR-MORE-word tenure-less mint gets no
guard at all and reaches every served roleplay in the collection, since
the bare-name rule's own multi-word exemption assumes a multi-word name
is a deliberate cross-promotion mention, an assumption that breaks the
moment the entity carries no promotion to be "cross" from. This asymmetry
produced all six of the RSPWF Top 200's own adversarial-regen
`EXCLUDE_NAMES` entries (Mike Manson, Deja Vu, Tommy Danger, Todd Bishop,
Noah Hanson, Kenny Rock) — none of them a single bare word, every one a
tenure-less mint. Check a large tenure-less mint wave's own multi-word
names against `promotions/*/rp/*.html` before shipping, the same
diff-after-`refresh:links` discipline the `EXCLUDE_NAMES` hand-audit law
already calls for.

### Name etymology (standing minting step, the Janitor, 2026-08-24)

When you mint a character or a unit — or read a fed's own name — **ask where
the name came from.** Fantasy wrestling names are thick with borrowed
language: a real person, a fictional character, a band, a film, wordplay, a
pop-culture reference the handler assumed you would catch. Where the
inspiration is **discernible with real confidence**, record it. The mechanism
has existed for a while and nobody was reaching for it on purpose; this makes
it deliberate rather than accidental, and it is scholarship the record
rewards — frankly one of the quiet joys of the collection.

**The mechanism already exists — use it.** Add (or reuse) a
`data/external-figures.json` entry for the source (`type`: `real-person` ·
`fictional-character` · `brand-mascot` · `musical-act`), with a `source` where
the work has a name (e.g. `"FFX"`) and an etymology `note`; link the entity to
it with a `portrays` edge. It renders under **"Named for"** on the figure
page — deliberately apart from v78's **"Portrayed in"**, which is the narrower
case of a fed *staging a real professional wrestler*. That case, and only that
case, also carries `portrayal_of`, and `portrayal_of` is exactly what the
placard verb keys on: carrying it reads "Portrays", everything else reads
"Inspired by". Named-for is the general, gentler relation — the character is
original; its *name* borrows.

**Worked examples already in the registry.** Sean Williams' `seymour-almasy`
fuses two distinct Final Fantasy characters — **Seymour** (Guado, FFX) and
**Seifer Almasy** (FFVIII) — and renders as one fused "Inspired by" row.
GDWA's `heidi-leick-gdwa` leans on **Hudson Leick's** own birth name (Heidi
Hudson Leick — Callisto on *Xena*), reaching past her billed stage name to her
true one, which is exactly the kind of clever borrowing worth catching.

**The discipline, both directions:**

- **Don't manufacture it.** A shared common word, a coincidental surname, a
  generic archetype is not an etymology — the same restraint as the
  "resemblance is not portrayal" ruling (4WW, v78). Mark a borrowing only when
  the signal is real: a distinctive full name, a sustained cosplay built
  around it, the handler's own acknowledgement, an unmistakable reference.
  When unsure, leave it.
- **It is a "when discernible" step, never a required field.** Most names will
  not yield one, and that is fine — no entity is incomplete for lacking an
  etymology note. This is a dimension you add *when you see it*, not a gate
  every mint has to pass.
- **Privacy is unchanged.** A real-person "Named for" entry records the public
  figure whose name is borrowed, facts only, per the external-figures
  precedent. It never becomes a channel for a community member's real name,
  which stays governed by v73/v74 exactly as everywhere else.

### The secondary-source pivot step (the Janitor, 2026-08-25)

A secondary source — a community wiki, an aggregator, a retrospective —
does two jobs in this workshop, in a fixed order of authority, and the
Janitor's own constraint governs both: **a secondary claim is never
treated as settled fact.**

1. **It annotates, graded.** A wiki-attested fact lands on a row or a
   digest explicitly attributed to the wiki, worded as the wiki's own
   claim ("the wiki's own classification, not independently verified"),
   never as the museum's. It never overrides a primary source, and where
   the two conflict, primary wins and the secondary claim stays recorded
   *as* the secondary source's claim — that disagreement is itself part
   of the record (the Scoops dossier's own "46 of 56" correction is the
   worked example: a fresh primary read overturned the dossier, and the
   dossier's claim is preserved as what it said).
2. **It pivots — every secondary claim naming a primary artifact spawns
   a hunt target at the moment it lands.** A URL gets a CDX probe on the
   queue; a date gets a capture-window check; a show or handler credit
   becomes a search term against held corpora. The secondary fact's job
   is to point at the primary record, and recording it without queueing
   the pivot is leaving the job half-done. (Worked example: OBW — the
   wiki's brand/roster facts annotate its row, and its own
   onlinebrutalwrestling.com goes on the CDX queue the same day.)

The step is deliberately cheap: the pivot is a queue entry, not an
immediate fetch — the hunt runs when its channel's lane runs.

### UI conventions

**The wing header, and the shared subtitle component (2026-08-18, refined
same day).** Every promotion wing's own `<h1>` is stamped, never
hand-typed, by `scripts/stamp-promotion-headers.mjs` (folded into `npm run
chrome`) from `data/promotions.json` alone: `"Full Name (ACRO)"` —
acronym ALONE where `full_name` genuinely is just the acronym, never a
self-parenthesis. Chronology does NOT live in the h1 — a compound era
("2005–2010, revived c. 2013–2016+") reads unwieldy as a headline, so
`years` gets its own placard row instead ("Ran: " + the field verbatim,
patched from a second marker, `<!-- wingyears:start/end -->`) where honest
compound forms are exactly the point, since it's data, not headline prose.
A wing whose own header used to carry narrative prose instead ("The fed
that died once and came back anyway.") had that sentence hand-relocated
into its own epitaph FIRST, once, before the marker replaced it — never
lost, never paraphrased, just moved to where free prose actually belongs.
Directly under the h1, a `.subtitle` line (style.css) renders the fed's own
sourced `tagline` where one survives in the record (never invented for a
wing that doesn't have one) — the SAME shared component an entity page's
own `aka`
line uses, one class, two consumers, italic and brass-tinted so it reads
as deliberately secondary rather than unformatted leftover text. One
placard component (a `.placard` box, `<p class="meta">` with `<br>`-joined
`<span class="k">Label</span> &nbsp; value` rows) is the identical
discipline one level down — the wing placards and the generated wrestler
placard (`cross-reference.mjs`'s `renderPlacard()`) share the exact same
markup shape on purpose; a consumer that grows its own tag structure
(a `<ul><li>` was tried once for the wrestler placard) is a bug, not a
variant.

**Prev/next (THE SELFISH-REVIEWER FEATURE).** Every entity page —
characters, promotions (wing `index.html`), accessions, essays — carries a
baked `<nav class="pager" data-pager-type="...">` right before its
footer: a plain `<a class="pager-prev">`/`<a class="pager-next">` pair in
that type's own sortKey order, working with no JS at all. Two types are
fully generated (`characters`, `collections` — `pagerNav()` in
cross-reference.mjs, computed inline from the same array the page loop
already walks); two are hand-authored pages stamped by a dedicated marker
pass (`promotions`, `essays` — `scripts/stamp-pager.mjs`, folded into
`npm run chrome`, same `<!--pager:start/end-->` marker contract as every
other patched section). `js/pager.js` (one shared script, loaded on every
page that has a `.pager`) layers two things on top of the baked default:
left/right arrow keys (guarded against firing while a text field has
focus), and FILTER INHERITANCE — a list page that just rendered a
filtered/sorted set (`js/list.js`'s `wireList`/`wireDomFilter`, passed
`pagerType: "..."`, or a custom renderer calling
`MuseumList.savePagerSequence()` directly, as `promotions.html` does)
stores the ordered `{href, label}` sequence into `sessionStorage`
(2-hour TTL); clicking into one of its rows makes that entity page's own
prev/next walk the sequence you were just filtering, not the flat
alphabet, with a small "N of M in your filter — clear" indicator.
Absent, expired, or the current page not IN the stored sequence: prev/
next stay exactly as baked, silently — that fallback is the contract, not
an error state. Adding a new entity-page type: bake the pager the same
way (generated pages compute it inline; hand-authored pages get a marker
pass), pick a `pagerType` string, wire the list page(s) that browse it to
save a sequence under that same string if one exists. Asset versions
(`style.css`, `js/list.js`) bump together, sitewide, whenever either
file's actual content changes — see `docs/OPERATIONS.md`'s Cache and
version-stamp conventions section; `js/pager.js` is versioned separately (now
`?v=2`) since nothing else references it.

**The filter-inheritance bug hunt, and what it actually found (2026-08-18).**
A priority user report — "prev/next works, filter inheritance doesn't" —
turned into a full end-to-end trace: whether `wireDomFilter`/`wireList`
actually write the full filtered set (not just the windowed-visible
slice) to `sessionStorage` on every apply, whether `js/pager.js` reads
the same key/shape back and finds the current page inside it, whether
both the links AND the keyboard handlers AND the indicator get rewired.
Traced with a harness that executes the real shipped source (not a
re-implementation of it, which would just re-prove the tester's own
assumptions) against constructed DOM fixtures. **Finding: no logic
defect in the mechanism itself** — `savePagerSequence()` correctly
stores the full matched set before any click can happen, and
`readSequence()`/`init()` correctly locate the current page in it. What
WAS real and IS now fixed: three `wrestlers/*.html` files were orphaned
leftovers from an old slug rename (`bondage-sex-fiend.html` →
`bondage-the-sex-fiend`, `lyle-in-style-wile.html` → `lyle-wile`, plus a
unit-membership one), predating THE SELFISH-REVIEWER FEATURE entirely
and missing its whole pager block — invisible to every existing check
because nothing links to an orphan and `cross-reference.mjs`'s own
`writeFileSync` only ever adds/overwrites a CURRENT entity's file, never
deletes a stale one. `registry-validate.mjs` now hard-fails on any
`characters/*.html` file (`wrestlers/*.html` at the time of this incident
— see THE FRONT-ENTRANCE RENAME, 2026-08-20) whose own basename doesn't
resolve to a live character/unit id, so a future rename can't leave the
same kind of orphan sitting unnoticed. `js/pager.js`'s own href comparison is
hardened regardless (tolerates a trailing-slash difference) and both it
and `style.css` were version-bumped, in case a stale cached asset
predating an earlier fix was ever the real explanation. **The lesson for
next time this pattern comes up:** trust a hand-simulation only as far
as it executes the actual file content — a re-implementation of the
logic under test proves nothing about whether the SHIPPED code matches
what you think it does.

**Random-jump (THE 'r' KEY, folded into the same wave).** Every entity
page's pager also answers `r`/`R` — same input-focus guard as the arrow
keys — with a jump to a random OTHER entity of the same type: drawn from
the active filtered sequence when one applies (random-within-your-filter,
the actual ask — a review-sprint tool for "show me something else in
this set," not "show me anything in the whole museum"), falling back to
the type's own full category index (fetched on demand from the same JSON
`wireList`/`wireDomFilter` already read at list-render time — `js/pager.js`
still carries no load-time dependency on `js/list.js`, so this fetch and
its own tiny schema-unwrap are duplicated by hand, same precedent as
`PAGER_TTL_MS`) when no filter is active. The current page is always
excluded from the draw. A small "random" button is constructed by the
script itself and appended into the baked `nav.pager` row (progressive
enhancement, not a template change — a no-JS visitor simply doesn't see
it, same as the arrow-key hint); prev/next/random all carry a `title`
attribute naming their own key (`←`/`→`/`r`) as the discoverability
affordance, no narration paragraph needed.

---

### The unbake gap (documented procedure, pending a real tool)

The auto-linker preserves existing `data-entity` anchors for
idempotency — which means a link that was WRONG when baked stays wrong
through every regen, rule changes included (first dogfood run: 83
false anchors from one accession's roleplay corpus). Until a
principled unbake pass exists in `cross-reference.mjs` (strip every
anchor the current rules would not produce, then relink), the
procedure is: scope the affected files precisely (only pages whose
anchors are entirely linker-made — never hand-authored prose), strip
`<a class="entity-link">` wrappers by regex in that scope, regen, and
diff the result against expectations before committing. `git revert`
is the fallback. Treat any linker-rule change as triggering this
question explicitly.

## Prose

The museum's own writing — epitaphs, captions, wing narrative — is
governed in full by `CURATION.md`, restated here as the practical
checklist to run every sentence through before it ships.

### The page skeleton

**Design law (2026-08-18 gavel, verbatim: "same skeleton at every scale is
the right design").** Every entity page — character, unit, promotion wing,
and (unless a future ruling says otherwise) whatever entity type arrives
next, accession pages and memorial placards included where the shape
applies — shares exactly ONE anatomy, top to bottom:

1. **Name** — the `<h1>`, generated from the entity's own identity fields
   (a character's `name`; a promotion's `full_name`/`name` composed as
   `"Full Name (ACRO)"` by `scripts/stamp-promotion-headers.mjs`). Never
   hand-typed narrative prose doing double duty as the title.
2. **Subtitle** — an `aka` or a sourced `tagline`, styled by the ONE shared
   `.subtitle` component (style.css: italic, brass-tinted, clearly
   secondary) — never invented for an entity that doesn't have one on
   record, never a second place the same fact repeats if the subtitle
   already carries it.
3. **Placard** — the facts, in the ONE shared `.placard` markup (a
   `<p class="meta">` with `<br>`-joined `<span class="k">Label</span>
   &nbsp; value` rows — never a `<ul><li>` local variant; see this doc's
   own "wing header" entry under UI conventions above). Chronology,
   domains/sites, and every other atomic fact live here, labeled, sourced,
   never buried inside a
   prose sentence where a reader would have to parse it back out.
4. **Caption** — ONE hand-drafted, one-sentence museum-label line, stored
   as data (`caption`, plus `caption_asof` for the living-prose staleness
   check — `registry-validate.mjs` recomputes live evidence counts and
   soft-warns on material drift, the same discipline for every entity type
   that carries it, characters/units/promotions alike). This is the "one
   true sentence" — not a bio, not a placard row restated, the single
   distillation a reader gets if they read nothing else on the page.
5. **Sections** — the record itself: tenures/reigns/relationships for an
   entity, epitaph/holdings/provenance for a wing. Everything that isn't
   name/subtitle/placard/caption lives here, in its own labeled section,
   never smuggled into an earlier slot because it was convenient to write
   that way in the moment.

**Why one skeleton, not a per-entity-type improvisation:** a reader (or a
future contributor) who's learned to read ONE entity page has learned to
read all of them — the same reason `.placard`/`.subtitle`/`.meta` are
literal shared CSS components, not five near-identical hand-rolled
variants that drift apart the moment nobody's looking. When a new page
type needs its own wrinkle, the wrinkle is a new SECTION, not a new
top-of-page anatomy.

### The salience-inversion warning

Read this before writing a single sentence of wing epitaph, whatever else
you skip. A live incident, diagnosed by the user directly: a context-free
agent — one with no memory of any prior session, working from nothing but
the repo and a research digest — wrote the XUW wing's own epitaph and
opened it "A full second house, not a sister down the road," then spent a
whole paragraph litigating the evidence that XUW was really the same
people behind the UWF and GIWF (same handler, same billing, same site
engine, same forum culture). Nobody told that agent to center the
connection. It did it anyway. The diagnosis, worth internalizing rather
than just patching around: **agents learn salience from a corpus's own
attention patterns, not from its stated rules.** The workshop digest for
XUW *headlined* the cross-fed connection, in bold, at the top — because
that connection was the exciting find *during mining*. Finding out a
promotion you're mining turns out to share a handler with something else
you already hold is a genuinely great research moment, and the digest is
right to lead with it. But a digest's own excitement is not a wing page's
own subject, and nothing about reading CURATION.md's rules in the
abstract stops that mining-excitement from leaking straight through into
finished museum prose — the rules say "absolutes, protagonist test," but
the corpus the agent actually read right before writing said "THIS IS
HUGE, LOOK AT THIS CONNECTION." Salience beat the stated rule, silently,
because nothing in the moment flagged that the two were in tension.

**The mechanism, stated plainly enough to recognize in yourself:** the
digests teach you what excited the collection; the law tells you what the
page is for; when they conflict, the law wins — but the law only wins if
you notice the conflict is happening. It usually doesn't announce itself.
If a sentence you're about to write would be more at home in a research
digest's own "look what I found" section than on the actual promotion's
own wing, that's the tell. Reread `CURATION.md`'s protagonist test
*immediately before* writing a wing epitaph, every time, precisely
because the digest you just finished reading was optimized for the
opposite emphasis.

**Worked example — before (from this project's own real history) and
after:**

> **BAD** (the XUW epitaph, as shipped and later caught): *"It is also,
> on the evidence, not a loosely-related sister but a second house for
> the same people behind the UWF and GIWF. Its own Al Crud was billed
> under the same name and run by the same handler as the GIWF's own Al
> Crud; its bio cards list 'UWF' among more than one wrestler's other-fed
> credits; it shared the very same roster-and-ranking engine ('I.M.
> Productions') as the UWF; and its forum carried the same community
> culture already familiar from the UWF and GIWF. Read together, XUW is
> where that same circle's world continued under a second name, not a
> fed it merely rubbed shoulders with."* Four sentences, and the
> grammatical subject of every one is the *connection*, not XUW. This is
> mining prose wearing a wing page's clothes.
>
> **GOOD** (the same fact, after the fix): the whole paragraph above is
> gone from the wing entirely. What replaced it is XUW's own scene — its
> annual awards ceremony, its "Most Lovable Jobber" category, its
> wrestler-database win-loss records — and, as the *only* remaining trace
> of the connection anywhere in free prose, one generated sentence in the
> new **connections slot** (below): *"The other house this line split
> into in 2001, run side by side with the UWF for years — sharing
> handlers, its site engine, and its community. See The IWF line: a
> connected history for the connected history in full."* The evidence
> chain itself (same handler, same billing, same engine, same forum
> culture) moved to where evidence belongs: a `shared-continuity`
> `data/affiliations.json` edge, an open `data/review-queue.json` entry
> for the two same-named Al Cruds (real evidence, not yet a merge — see
> the no-auto-merge-and-no-silent-distinctness rule, `CURATION.md`), and the connected-history essay itself,
> which is the one sanctioned place a multi-fed thesis gets to be the
> actual subject of a paragraph.
>
> A caption pair, same principle at smaller scale: a caption for XUW's
> own Al Crud that opens by explaining he's *probably* the same performer
> as another fed's Al Crud is the caption-level version of the same
> mistake — his own record (a finisher, a win-loss line, an awards
> nomination) is what a caption is for; the connection has its own home
> now (the review-queue entry, the affiliation edge) and doesn't need the
> caption to carry it too.

### The connections slot

A wing gets **one** fixed, data-rendered home for a connection fact: a
`<!-- connections:start/end -->` marker (same idempotent convention as
chrome/epitaph/affiliations/provenance/browse-live), seeded into every
wing's index by `scripts/fixers/gen-wing-index.py` and patched by
`scripts/cross-reference.mjs` (`renderConnectionsSection`). The mechanism
that first filled it, a promotion's `family` and `family_note` matched to
the `data/essays.json` row carrying the same `family`, is RETIRED (A7, THE
LINEAGE-EDGES WAVE, 2026-08-19; `docs/SCHEMA.md`, the `promotions.json`
entry): no `family`, `lineage` or `family_note` field is read, and no wing
renders a "Connected history" section. Today the slot renders one thing,
from the wing's own `portrays` edge (hook c101, `CURATION.md` v128 (c)):
one plain line in the museum's voice, *"This federation's fiction portrays
the WWF."*, linking the real promotion's figure page. A wing with no
`portrays` edge renders nothing, exactly like affiliations renders nothing
for an unconnected promotion. A lineage fact between held promotions
(successor-of, predecessor-of, shared-continuity) is a
`data/affiliations.json` edge and shows in the Affiliations section, not
here.

**With connections having a sanctioned structural home, free prose is
own-arc by construction — lineage material sitting in a wing's own
epitaph, roster, or titles prose outside this slot is a defect, not a
style choice**, to be moved into a `data/affiliations.json` edge (or,
for what a fed's fiction depicts, its `portrays` edge), the same way the XUW
fix moved it. This doesn't forbid every mention of another promotion
forever — a promotion's own record sometimes genuinely involves another
fed (a real crossover angle it staged, a character's own documented
tenure elsewhere) and that stays in the prose where it's a fact about
*this* promotion's own record, not an argument about what this promotion
*is*. The test is the same as always: is the sentence's grammatical
subject this promotion, or is it "the connection"?

### Centering-lint

`scripts/validate.mjs` soft-warns (never fails the build) on a wing's own
`<!-- epitaph:start/end -->` section when another held promotion's own
name/acronym appears more than twice, or when a known thesis-phrase shows
up ("second house," "same people behind," "the same circle," "this
collection," "the Museum's own"). This is the `EXCLUDE_NAMES` of prose —
a blunt, human-tuned trip-wire, not a grammar checker, and it will flag
real false positives on purpose rather than miss a real incident: a
promotion whose own documented history genuinely involves a lot of
cross-fed storyline (the WWA wing's own Eric Cameron/SCWF saga, which is
*WWA's own* scripted content quoting a character's real UWF/GIWF
backstory, not an out-of-character thesis about WWA's identity) will trip
the same-acronym-count check and should usually stay exactly as written
after a human reads it — the lint's job is to make a human look, not to
decide for them. Likewise, "the Museum's own" catches both the bad
pattern (centering the archive's importance) and a few good ones
(`CURATION.md`'s verbatim-serving rule's own sanctioned "the Museum's own writing declines to
[repeat era-typical cruelty]" pattern, which is about editorial policy,
not entity identity) — read every hit, keep the legitimate ones, fix the
rest. Tune the phrase list and the acronym threshold over time as new
patterns get caught live, the same way `EXCLUDE_NAMES` itself grew one
real incident at a time.

- **Absolutes, never collection-relative.** No "one of the collection's
  own..." A promotion or character is described on its own terms, the way
  its own record would describe it — run the **500-promotion test**
  (would this sentence still read true and non-awkward with 500
  promotions held?) on anything that feels like it's citing the Museum's
  own size or holdings.
- **The protagonist test.** An entity is never described by its
  importance *to the Museum* — "this collection's own primary tag team"
  centers the archive, not the team. Describe the actual subject; the
  Museum's presence in a sentence is a byline, never a stake.
- **Staging over speech.** A character's own in-fiction bravado or
  self-deprecation (a heel ranting about "this rinky-dink bingo hall," a
  fed shouting "GLOBAL" about itself) is never on its own determinative of
  a fact like scale — what the promotion actually *staged* (its own venue
  claims, its own card framing) outranks what a character *said*, unless
  a contributor's own attestation says the speech itself was the
  intended characterization (graded like any other claim).
- **Role descriptions, never handler names.** The Museum's own voice
  never speaks a real handler's name or handle — full stop, no
  exceptions (the last grandfathered exception, a single handle, was
  eliminated in this project's own v22 changelog entry precisely because
  "that's the kind of thing that doesn't scale"). Where the voice needs
  to gesture at a handler at all, it uses a role description, often
  anchored to the character they're best known for — connecting a role
  description *to a character* is fine and encouraged; it's the name or
  handle itself that's forbidden.
- **The record is living, not provisional.** There is no "provisional"
  marker anymore (`CURATION.md`, "the living record" — the Janitor: "I'm
  not sure there's any value to the provisional line anyway. Everything is
  always going to be in a state of flux as new data comes in. Everything
  is always provisional."). An Epitaph, caption, or any other page reads
  as an honest account of what's currently held, full stop — not a sketch
  awaiting a "complete" version, and not hedged in its own text about a
  future pass that will supersede it. When a promotion's own processing
  genuinely deepens later, the page is simply revised in place; nothing on
  the page itself narrates that it's mid-way there.
- **Resumable inventories are paperwork; served pages never carry them.**
  A processing wave's own running tally of what's left to do — file
  counts, "left genuinely open," a pointer at a research digest's own
  path — belongs in the private workshop (its digests), never on a
  served page. If a page needs to say a gap exists, it says the gap
  plainly, in the register the record itself supports ("how it ended
  isn't in the surviving record"), never as a work-log entry naming what
  the Museum still intends to go check.
  The same holds for the registries, which the museum serves as `data/*.json`: a `source`, `digest`, `first_seen_in` or note field
  never names a local or workshop file path. A path written there is taken out at the next preflight by
  `scripts/fixers/scrub-workshop-paths.py` (the path and its own separator go; the description of the evidence stays; a path that
  was the whole value becomes "a copy held in the workshop"; the removed paths are logged in the workshop, in
  the workshop's `path-scrub-ledger.tsv`), and `scripts/registry-validate.mjs` fails the gate on a local absolute path in any served registry.
- **Captions: one sentence, built from the actual record.** A caption is
  a distillation (reigns, roles, appearance span, RPs, relationships,
  quirks — whatever's actually on file), never a template
  ("X was a wrestler who..."). Vary sentence shape entity to entity.
  Honest thinness gets a complete, dignified one-liner, never padded and
  never apologetic — "Appeared once, on the 30 June 1999 Global, and
  never again" is a *complete* caption for a one-show jobber, not an
  admission of failure.
- **Captions point into the graph.** A caption is prose, and prose that
  names another entity or a promotion should let a reader follow that
  thread — captions render through the same entity/promotion auto-linker
  as any other curated page (the Cross-referencing section's idempotency discipline applies the same
  way). Write captions expecting this: naming a teammate, a promotion, or
  a connected character by their actual registered name (not a
  paraphrase) is what turns the sentence into a link, not extra markup
  added by hand.
- **The caption doctrine (THE CAPTION DOCTRINE WAVE, `CURATION.md` v38,
  the Janitor's own line-by-line review of all 634 captions on file).**
  Six standing rules, checked on every caption written from here on, not
  just the ones the Janitor happened to catch live:
  - **No curator/collection self-reference, ever.** Not "the man who
    would grow up to curate this museum," not any variant of the Museum
    noticing itself inside a caption. The Janitor, on exactly that sentence:
    "nope."
  - **Own arc, own promotion(s).** Another promotion earns a place in a
    caption only as part of the subject's own record there (a tenure it
    actually held) — never as comparison, never as lineage color reaching
    outside that record. A caption that spends half its length on a beat
    from a *different* fed than the one it's actually about has failed
    this test regardless of how interesting that other beat is.
  - **No curation machinery.** Placeholder history, merge evidence ("by a
    shared signature move"), filename/provenance lore — none of it
    belongs in the one sentence a reader actually sees. It lives in
    `source`/`note`/`identity[]`, where a curious reader can still find
    it; the caption states the fact, not the paperwork behind it.
  - **No negative-identity/disambiguation clauses.** Never "a separate
    entity from X despite the shared name," never "deliberately kept
    separate from Y." A generic-name collision is what qualified slugs,
    search, and the review queue are *for* — a caption doesn't need to
    also carry the disambiguation, and at scale (500+ promotions) trying
    to make every caption do that job is unsustainable on its face. If an
    underlying in-fiction fact is worth keeping (a feud, a rivalry) that
    happens to sit near a naming collision, keep the fact and drop the
    "separate from" clause built around it — they're not the same thing.
  - **No namedrop-level trivia.** A passing mention in another fed's
    record — never developed into an actual role there — doesn't earn
    caption space. Check solo captions for this exactly as often as unit
    captions; it isn't a units-only failure mode.
  - **No handler/sockpuppet narration.** Never states or implies who was
    "really" behind a cluster of characters, invented-handler-persona or
    otherwise — this is curation machinery *and* a privacy-rule violation
    at the same time (the privacy rule, `CURATION.md` v20–22).

  A related but distinct tic, swept the same wave and worth watching for
  sitewide, not just in captions: the **reflexive "own"** — "on XUW's own
  roster," "XUW's own..." — used as connective habit rather than to do
  real distinguishing work. This is not the same thing as the
  protagonist test's sanctioned "X's own" construction (naming the actual
  subject instead of centering the Museum, `CURATION.md`'s protagonist test) — that usage
  earns its keep. The tic is the same three words doing nothing, over and
  over; cut it wherever it isn't pulling weight.
- **The Boozler rule governs performance, never biography.** A
  `boozler_rule`-flagged entity gets captioned from its own record —
  reigns, appearance span, feds, documented moments — exactly like
  anyone else. The rule forecloses new performance of a caricature; it
  does not mean a character's entire existence boils down to "we can't
  even speak of this." A caption never describes the caricature's own
  content (that's what the rule forecloses) and never uses the rule's own
  existence as the caption's whole subject ("...but does not perform —
  see Curation" is exactly the failure mode to avoid) — silence about the
  caricature is not the same thing as making the silence the headline.
  The page-level flag box (`generatePersonPage`'s own boozler note) is
  the rule's actual home; the caption's job is the same as everyone
  else's — say what's actually on file.
- **Never narrate emptiness or machinery.** No "nothing here yet," no
  "this page was auto-generated," no visible seam from how the page was
  built. A gap in the record is stated as a plain fact if it needs
  stating at all, never apologized for or flagged as a confession.

### The recently-added block is generated, not written

`index.html`'s "Recently added" list used to be hand-authored one-line
blurbs — and two of them (the WWA and NAPW lines) turned out to center a
held *character's* own cameo appearance instead of the promotion's own
record, exactly the protagonist-test violation this section exists to catch.
The fix (THE GENERATED-BLURB GAVEL, 2026-08-18) wasn't rewriting the two
bad lines — it was removing the category of mistake structurally: every
word an entry actually renders (the promotion's full name/acronym/year,
the counts) is computed live by `scripts/stamp-stats.mjs`'s
`computeRecentlyAdded()`/`stampRecentlyAdded()` from the registry, the
same `<!-- marker:start/end -->`-plus-freshness-check pattern the door
counts and clacks header already use — folded into `npm run stats`, with
`registry-validate.mjs` failing the build if the stamped block drifts
from what the registry currently says. `data/site-config.json`'s own
`recently_added` array is the only hand-maintained part: which entries
appear, in what order, and what *kind* each one is (`wing` — a promotion,
counted in shows/roleplays/wrestlers/championships, falling back to the
promotion's own `depth` label when every count is zero; `essay`,
`worklist`, `restructured`, `framework` — the other categories this list
has needed so far, each with its own small fact computed from the
matching registry file). Adding a new entry never means writing a
description — it means adding one small config row and letting the next
`npm run stats` fill in what's actually true.

### The Storylines standard

THE STORYLINES DOCTRINE (2026-08-18, the Janitor's gavel, prompted by a review
of the XUW wing's own Storylines page): a Storylines page should be
**actually discussing storylines**. The Janitor's own diagnosis of the
XUW page as it stood: *"the first three sections are all promotion level
detail cluttering a storyline page. And the death angle section is so
incredibly threadbare: just noting the existence of a storyline from an
awards show."* Two failures, named separately because they call for
different fixes.

**Promotion-level detail doesn't belong on a Storylines page — it belongs
on the wing index, integrated.** Founding facts, the show/PPV calendar,
an inter-fed alliance's own shape — these are facts about the *promotion*,
not about a *storyline*, and a Storylines page that opens with three
sections of them is spending its own real estate on the wrong subject.
The fix is not a delete: it's a *move*, and the Janitor's own words on
how are precise — *"They should be integrated, not just three extra
paragraphs stuffed in and bloating the page."* Woven into the wing
index's existing prose (the Epitaph, the placard, wherever the fact
actually belongs), duplicates dropped once the fact lives in its new
home, the index staying one continuous piece of writing rather than
gaining a bolted-on fourth paragraph that repeats what the first three
already covered.

**An awards show is a lead, not a citation.** A fed that ran a
Storyline/Moment/Feud-of-the-Year award is *telling you, in its own
voice, exactly what it valued most* — that's the single best sourcing
signal a Storylines page can ask for. What it is **not** is a substitute
for the actual recap. The Janitor's own words, stated as the standard
directly: *"I do think the awards shows would be the best place to
SOURCE a storyline for this... but that should be the lead to go search
it in the primary sources and actually recap what it was, not just 'hey
there was an awards show and it said someone died.'"* The failed version
of the death-angle section did exactly the thing this forbids: it named
the award, named the category, and stopped. The standard: use the
awards ceremony (itself a served primary source, its own retrospective
narration often doing real work — see the XUW rebuild below) to find
which arcs the fed itself thought mattered, then open the actual served
shows that arc ran across and **recap what was staged**, beat by show,
every beat linked to the show page it happened on. A death angle staged
on a served card gets the same treatment as any other documented angle —
CURATION's own death-angle care conventions apply (report what was
staged, don't recite the goriest sentence at length; the protagonist test
still governs whose arc the paragraph is actually about) — but "handled
carefully" has never meant "handled thinly." An arc with no served show
to recap from stays a citation, honestly — the standard doesn't require
inventing beats a corpus gap doesn't support, only recapping the ones
that survive.

**The exemplar**: `promotions/xuw/shows.html`'s own rebuild (2026-08-18) —
its first three sections (founding, the show/PPV calendar, the PTC
crossover) integrated into `promotions/xuw/index.html`'s own Epitaph and
holdings prose; its award-recognized arcs (the 2002 Awards Ceremony's own
Best Feud, Match of the Year, and — via the 2003 nominee ballot's own
"Moment of the Year" field — the death angle) recapped from the served
corpus with show-by-show links; the death angle traced to its actual
served staging (Reborn 2003) rather than left as a one-line namedrop.
Read that page before writing another fed's Storylines page from
scratch — it's the worked example, not just the rule stated in the
abstract.

---

## QA

**The adversarial regen (named step, first dogfood run):** before an
accession's final commit, diff every page OUTSIDE the accessioned
promotion for newly inserted anchors. Raw roleplay text is the
adversarial input the auto-linker never sees in curated prose — this
diff is how 83 false links surfaced in one run. A clean cross-promotion
diff is part of accession-complete, not an optional flourish.

`npm run check` runs two scripts; know what each one actually guards and
why, because most of these checks exist because something specific broke.

**`scripts/validate.mjs`** — site-wide structural checker:

- Every page has `noindex`, a stylesheet link, and a `<title>`.
- Every internal link resolves to a real file.
- Row-budget enforcement (`data/site-config.json`'s `row_budget`) — no
  statically-generated page bakes more rows than the budget; a growing
  category has to split into A-Z/season pages instead of one
  ever-larger file (an instrument page that fetches JSON client-side is
  exempt by construction, since it bakes ~0 rows into its own source).
- The `MuseumList` script-dependency guard — any page whose inline script
  calls `MuseumList.*` must also load `/js/list.js`. **Added after a real
  incident**: a chrome-stamp regression once silently stripped every list
  page's own `<script>` tag while leaving the calling code behind,
  producing an empty page with a console error and no build failure to
  catch it. This check exists so that specific failure mode can never
  ship silently again.
- Inline-style ban (`INLINE_STYLE_RE`) — a `style="..."` attribute fails
  the build; use a `style.css` component/utility class, or add a
  justified entry to the (currently empty) allowlist.
- **CSS-integrity checks on `style.css`** (comment balance, brace
  balance, every `var()` resolves) — added after **the comment that ate
  the stylesheet**: a doc-comment's own prose, describing a CSS class
  named `.mt-*`/`.mb-*`, contained the literal characters `*/` — which
  closed the surrounding `/* ... */` header comment early and silently
  corrupted the entire `:root` design-token block. Nobody caught it until
  a human noticed the site looked wrong. These three checks are cheap
  and permanent so that specific class of self-inflicted wound can't
  recur unnoticed.
- Chrome-freshness check — every page's chrome must match what
  `templates/chrome.html` would currently stamp; this is why `npm run
  chrome` has to run *before* `npm run check`, not after.

**`scripts/registry-validate.mjs`** — registry consistency checker:

- Every slug is unique across the *entire* registry (one shared
  namespace across characters/units/titles/shows/promotions/external
  figures), every cross-reference (a tenure's `promotion`, a title's
  `promotion`, a show's `appearances[].who`, ...) resolves to something
  real.
- Every `collection`/`accession` value resolves to a real
  `data/collections.json` row; every `data/collections.json` row has a
  generated `/collections/<id>.html` page to link to.
- Controlled-but-soft vocabularies (`depth`, `medium`, `scale`,
  `unit_kind`, source `kind`) soft-warn on an unrecognized value rather
  than hard-failing — deliberately, since a genuinely new value showing
  up is expected as the registry grows; the check exists to catch a typo,
  not to freeze the vocabulary.
- The assertion graph gets checked for transitivity contradictions (A=B,
  B=C, but A≠C asserted somewhere) — this is what catches a merge that
  quietly contradicts an earlier "distinct" verdict on an overlapping
  pair.
- Every character/unit requires a `caption` (hard fail) since the
  captions wave; a caption that reads as more than one sentence
  soft-warns.
- The stats-freshness check compares the homepage's own stamped counts
  against a live recount of the registry. **Added after a real
  incident** (stats drift: the stamped homepage counts silently went
  stale after a registry edit that nobody re-ran `npm run stats` for,
  and it shipped that way until the mismatch was noticed by eye) — this
  is why `npm run stats` is a required pre-check step, same as chrome.

**The three incidents worth remembering by name**, because each one
produced a permanent structural fix rather than a one-time patch: **the
script-eating stamp** (chrome regression stripping `<script>` tags →
the `MuseumList` dependency guard), **the comment that ate the
stylesheet** (`*/` inside prose → the CSS-integrity validator), and
**the stats drift** (stale homepage counts → the stats-freshness check
plus the "stamp before check" ordering rule now baked into every
workflow, including `CLAUDE.md`'s own standing invariants). The pattern
across all three: a human noticed something looked wrong *after* it
shipped, and the fix was never "be more careful next time" — it was
"make the mistake structurally impossible to ship silently again."

### Caption refresh, on wave completion

THE CAPTION-STALENESS WAVE, 2026-08-18 (user gavel, verbatim: "as
evidence accumulates it should be updatable; I wouldn't want the
Phenomenons frozen as of what we had in the GIWF without the NAPW, WWA,
etc. eras acknowledged"). A caption is living prose, same doctrine as an
Epitaph ("revised as more of that promotion's own record surfaces,"
`CURATION.md`'s promotion-epitaphs rule) — not a write-once snapshot of whatever was on file
the day it was drafted. Every character/unit carries a `caption_asof`
(`{written, evidence: {tenures, reigns, appearances, rps, awards,
relationships}}`, `docs/SCHEMA.md`), the six counts its caption was last
actually checked against; `registry-validate.mjs` soft-warns when the
live counts have moved on materially (any count differing by 2+, or a
new tenure at all — a new fed-era is always worth a look, even a
difference of exactly one). **A wave that materially changes an
entity's own record — a new tenure, a title run, a fresh cluster of
roleplays — includes a caption-refresh pass over the entities it
touched, before the wave is called done, same as a wing's Epitaph gets
revisited when its own processing deepens.** The soft check is a prompt
to look, not a verdict either way: a caption drafted with the full
picture already in hand needs no change, and the check says so
correctly by staying quiet. What it can't see is real, and worth naming
in the wave's own report rather than assumed away: a wave that adds
volume WITHOUT touching individual entity records (a served-show batch
with appearance extraction deliberately deferred, e.g.) moves no
count at all, so nothing gets flagged even though the underlying corpus
grew — see `data/review-queue.json`'s own `caption-stale` entries for
a worked example of naming that gap honestly instead of either
force-flagging entities with no actual evidence they're affected, or
saying nothing.

---

## Landing a wave

A wave's work is not done when its delta is written. It is done when the
delta has been checked, marked READY, and named on the right commit stub.
Three steps, in order, none skippable.

The lane does step one. The coordinator does steps two and three — a lane
never marks its own wave READY and never writes under the museum root.

### 1. land-check

    python3 scripts/ops/land-check.py <wave-dir>

Reads the wave's whole delta and reports, before anything reaches the
registry:

- **privacy hits** — every deny term from the main ledger and every pending
  fragment, found anywhere in the wave's files. A hit is not automatically
  fatal, but it is never ignored: either the term is redacted in the delta or
  the allow is filed with its evidence (a msg_id or a ledger row). Standing
  denies and login slugs are not optional.
- **shape problems** — rows that do not match the live registry's own shape,
  measured against a reference row rather than against a schema paraphrase.
- **fragment scope problems** — a privacy fragment scoped wider than the
  wave that filed it.
- **frontier_row mismatches** — a `frontier_row` pointer naming a row that is
  not there, or naming a different wing than the mint claims.
  A new wing whose full name matches an OPEN frontier row's name must rule on
  it (L-FRONTIER-LAPSE): `frontier_row`/`frontier_rows` if it is that row,
  `frontier_distinct` if it is not (`docs/SCHEMA.md`, promotions.json).
- **prose by tier** — a new tier-2 or tier-3 mint with no `house_style`.
  land-check *refuses* these: the tier→prose convention is law (CURATION's
  prose-by-tier doctrine), and registry-validate only soft-warns, so a mint
  with no prose otherwise sails through the gate and becomes debt.

A wave with unresolved land-check findings does not get a READY marker. The
findings go in the wave's `findings.md` and the coordinator rules on them.

### 2. READY

    date > <wave-dir>/READY

The sentinel that tells the window this delta may be applied. The window
applies nothing without it — a delta directory with no READY is skipped and
said so, every cycle, which is how a half-finished wave sits safely in place
for days.

`APPLIED` is written by the window itself, never by hand. The two markers
together are the wave's whole state machine: `READY` and no `APPLIED` means
the next window will land it; both means it is in the tree.

### 3. The stub line

    python3 scripts/ops/append-commit-line.py "<WAVE-NAME>: <what it adds>"

Appends one line to `ops/commit-stub.txt`, idempotently on the `(wave X)`
tag, so re-running never duplicates it.

**Which stub.** A wave's line goes on the stub of the commit that will
actually carry it:

| the wave dir has | the line belongs on |
|---|---|
| `APPLIED` | the next commit — chain N |
| `READY` only | the one after — chain N+1 applies it, chain N+2 commits it |

Getting this backwards names a wave in a commit message that the tree does
not contain. It has happened: eleven lines had to be moved off a stub
minutes before its gate. `npm run standing-check` compares the live stub
against the wave dirs and reports any name with no `APPLIED` marker, so the
cheapest way to check is to run it.

### What the window then does with it

The window applies the delta's pages and registry rows (`apply-delta.py`),
then each per-kind file the delta carries — shard appends, registry
corrections, affiliation edges, frontier rows and enrichments, external
figures, inductions, page corrections, document rows, promotion rows,
indexed-path shard corrections. Each is marked applied beside itself, so a
re-run is a no-op rather than a duplicate.

Wave trees come from `WAVE_TREES` in `ops/config.env`. A walk that opens a
new year adds one line there — see `docs/OPERATIONS.md`, "Running a cycle".

---

## The wave-report format

A wave (one bounded unit of work — an accession, a fix pass, a
refactor) reports back the same shape every time, established across this
project's own history and expected by any coordinator reading the
report:

1. **What shipped** — plainly, in the order it happened, not a marketing
   summary.
2. **What broke and got fixed along the way** — a real accession never
   goes perfectly; the bugs found and fixed *during* the wave (not just
   the planned work) are exactly the material this handbook is built
   from. Naming them is not an admission of failure, it's the deliverable
   working as intended.
3. **Numbers that changed** — registry counts before/after, gate output,
   anything a future session would want to sanity-check against.
4. **Gates confirmed clean** — `npm run chrome && npm run stats && npm
   run check`, quoted or at minimum stated as run and green.
5. **What's left open** — a review-queue entry not resolved, a gap
   flagged honestly rather than papered over, a follow-up the next wave
   should pick up.

Report before compaction risk, not after — a wave's own report is the
thing that survives when context doesn't.

---

## The parallel-writer protocol

THE SHARDING MIGRATION exists for exactly one reason: to let several
agents write at once without stepping on each other. Before it, this
repo's own law was "one writer per worktree at a time" (`CLAUDE.md`'s
invariant #3) because every promotion's rows shared one monolithic
`data/*.json` file — two agents editing `characters.json` in the same
session was a guaranteed conflict, no matter how far apart the actual rows
were. Now that `characters`/`units`/`shows`/`rps`/`reigns`/`titles`/
`awards` live one file per (promotion, type) under `data/shards/`
(`docs/SCHEMA.md`'s own "Sharding" section has the full doctrine), a
fleet of agents each scoped to ONE promotion has genuinely disjoint file
sets — clean merges by construction, not by luck.

**The law, for every agent in the fleet:**

1. **One promotion, one worktree, one branch.** Each parallel agent works
   an isolated git worktree/branch scoped to exactly one promotion. Never
   two promotions in the same branch, never two agents on the same
   promotion at once.
2. **Write only your own files.** Your shard files
   (`data/shards/<your-promotion>/*.json`) and your wing's own pages
   (`promotions/<your-promotion>/`). Nothing else.
3. **Never touch shared files**, no matter how small the edit looks:
   - the cross-promotion monolithic sources (`docs/SCHEMA.md`'s own
     list — `relationships.json`, `affiliations.json`,
     `review-queue.json`, `frontier.json`,
     `memorials.json`, `collections.json`, `aliases.json`,
     `external-figures.json`, `style-families.json`,
     `promotion-style-families.json`, `stipulation-families.json`,
     `promotions.json`, `rp-catalog.json`),
   - shared scripts (`scripts/cross-reference.mjs` — its own
     `EXCLUDE_NAMES` list included — `scripts/build-data.mjs`,
     `scripts/registry-validate.mjs`, `scripts/validate.mjs`, every
     stamper, `scripts/shard-lib.mjs`),
   - `templates/chrome.html`,
   - `data/shards/_headers/*.json` (hand-maintained, not writer-scoped),
   - any other promotion's anything.

   A genuine need that touches one of these — a new cross-promotion
   affiliation edge, a name that needs adding to `EXCLUDE_NAMES`, a
   review-queue entry, a mint-guard collision against another shard's
   character name — is **never** applied directly. It's **logged** to
   a workshop digest `<your-promotion>-handoff.md` (plain prose: what the
   need is, what file it touches, why) for the coordinator to apply
   serially once every branch is back in one place. This is the whole
   point of the protocol: disjoint WRITES with a single, serial,
   human/coordinator-reviewed path for anything that isn't disjoint.

   **The scratchpad-handoff relay (documented fallback, fleet era).**
   `archive/` sits one level up from the repo root by design (`docs/
   OPERATIONS.md`'s workshop-boundary section) — but a worktree agent's
   own sandbox does not uniformly get write access up out of the repo
   tree the way the main checkout does; this varies by worktree, not by
   promotion, and isn't something a lane can assume either way going in.
   When a worktree can't write the workshop digest `<promo>-handoff.md`
   directly, the fallback, in order of preference: (1) write the handoff
   to the worktree's own scratchpad path instead, and say so plainly in
   the wave report so the coordinator knows to look there rather than at
   the expected workshop digest path; (2) if even a scratchpad write
   isn't available, relay the handoff content INLINE in the lane's own
   report back to the coordinator, who copies it into the real handoff
   file by hand. Either way, the coordinator — never the lane — is the
   one who actually writes into the workshop's digests, preserving the same
   single-serial-writer discipline the rest of this protocol runs on; the
   fallback changes where the draft starts, not who applies it.
   **Handoff files get REVISED IN PLACE on a later relay, not appended
   blindly** — a lane's own updated addendum replaces its prior section
   of the shared handoff file rather than stacking a second, overlapping
   copy underneath the first; diff the incoming draft against what's
   already there before deciding what changes, the same discipline any
   other merge gets.
4. **Gate inside your own worktree, every time, before every commit.**
   `npm run build:data && npm run refresh:links && npm run chrome && npm
   run stats && npm run check` (`npm run refresh` runs the whole chain) —
   full gates, not a partial check, even though your changes are scoped
   to one promotion. `refresh:links`/`chrome`/`stats` touch generated
   pages sitewide (backlinks, pagers, homepage counts) because entities
   link to each other across promotions even when their own rows don't;
   a promotion-scoped shard edit can still legitimately change another
   promotion's generated page (a cross-promotion backlink, say), and
   that's fine — it's the same regeneration discipline every non-sharded
   session already follows, just run inside your own worktree instead of
   the shared one.
5. **The coordinator merges branches serially**, not the agents. Disjoint
   file sets make the merges themselves mechanical (no conflicts to
   resolve by construction), but gates are re-run at each merge anyway —
   the same "never trust, always re-verify" posture this whole repo runs
   on. The coordinator is also the one who applies every logged
   handoff-digest need, in whatever order makes sense once every branch's
   own asks are visible together (two agents may have logged the same
   `EXCLUDE_NAMES` addition, say — the coordinator dedupes, the agents
   never needed to know about each other to log correctly).

**What this protocol deliberately does NOT allow**: an agent deciding a
shared file's edit is "small enough" to just make directly, an agent
merging its own branch, an agent working two promotions at once "for
efficiency," or an agent skipping the handoff-digest log because the
cross-promotion need seemed obvious. Every one of those is exactly the
kind of judgment call that was fine when there was one writer and is a
silent conflict risk the moment there are five to seven.

---

## Onboarding a fresh executor

**Onboarding must scale sublinearly with the project's own history.** A
fresh worktree executor arriving mid-fleet, with no memory of any prior
session, faces a growing pile of prior-lane digest material — and reading
all of it, every time, doesn't scale: THE ONBOARDING BOTTLENECK (fleet
era) was a real, observed failure mode, not a hypothetical one — a lane
that read a 4,400+-line predecessor digest in full before doing a single
line of new work burned roughly half its own working budget on reading
before it ever touched the corpus. The fix, adopted for every lane brief
from that point on:

- **`CURATION.md` is read in full, every time, no exception.** It's the
  law, it's not that long relative to a lane's own budget, and nothing in
  this doctrine narrows that — see `CLAUDE.md`'s own three-sacred-reads
  ordering.
- **A predecessor digest is read TARGETED, not cover to cover.** The
  latest one or two lane addenda (the most recent sessions' own sections,
  not the whole accumulated history underneath them) plus a
  keyword-targeted search run at the point a specific question actually
  comes up (a naming collision, a stipulation family, a title lineage
  gap) — not a preemptive full read "just in case it's relevant later."
- **The lane brief itself is the portable rulebook.** Every binding
  ruling, gavel, and convention an executor actually needs is restated
  directly in the brief that launches it — not left as "see the digest"
  or "see three sessions back." A brief that requires reading its own
  predecessor's predecessor to be usable has failed this rule; the brief
  is written so a genuinely fresh executor, reading only `CURATION.md`
  plus the brief itself, has everything binding it needs to work
  correctly from the first commit.

This is not a license to skip real onboarding — a lane that skips
`CURATION.md` or launches with a brief missing a binding ruling from two
sessions back will rediscover the same mistake the digest already paid
for once. The doctrine is about WHERE the accumulated knowledge lives
(hoisted into the brief, not re-derived from a growing pile of prior
prose) and HOW MUCH of the raw history gets re-read cover to cover
(targeted, not exhaustive) — not about reading less of what's actually
binding.

---

## Sequencing: the crawl before the storylines

**CRAWL-THEN-STORYLINES IS LAW, not a scheduling preference.** The Janitor,
verbatim, on why: *"storyline authoring should always occur after this
in-depth show by show crawl... I'm not sure we'd ever be able to tell the
story of say Nobbledy's death otherwise. In general, this show by show
crawl is long but I think it's the standard of care each promotion
deserves. It's the standard of care I want for my promotions, and what I
want for mine should be given to everyone else as well."* A Storylines
page (see the Storylines standard, above, in the Prose section) recaps
what a fed actually staged, beat by show, every beat linked to the show
page it happened on — and that's only possible once the show-by-show
crawl that produces those linkable beats has actually run. Writing
Storylines prose ahead of the crawl either produces a citation-only
placeholder (exactly the failure the Storylines standard already
forbids) or, worse, invites inventing beats the corpus doesn't yet prove
happened on a specific show.

**The equal-care principle, in the Janitor's own words, is the reason
this is a LAW and not just a convenience**: the standard of care applied
to the Janitor's own promotions (UWF, GIWF) is not a special case —
*"what I want for mine should be given to everyone else as well."* Every
promotion, personal-history or not, gets the full show-by-show crawl
before its Storylines page is written from it. See the depth-tier ladder,
below, for how this reconciles with promotions that will never receive a
full crawl at all (Tier 0/1 promotions don't get a Storylines page built
on an incomplete crawl either — they simply don't get one yet, honestly,
rather than getting a thin one out of sequence).

---

## Cartography vs. accession

**THE CARTOGRAPHY-VS-ACCESSION DOCTRINE** (the Janitor, 2026-08-21, near
verbatim): *"cartography doesn't need to wait for perfection and the
public museum shift, but accession does."* Two different activities that
this project's own history was at real risk of conflating, now named
separately so they never are again:

- **Cartography** — mapping what exists, from any source (a Fandom wiki
  dump, a Geocities link-harvest, a topsites directory, a wiki census, or
  a living promotion's own current site): name, URL, founding year,
  living/dead status, lineage, into `data/frontier.json` rows. This is
  bookkeeping about the shape of the wider hobby, not about any one
  promotion's own record, and it can run **anytime**, at any project
  phase. **A living promotion is cartography-readable and never
  accessionable** (`CURATION.md`'s dead-only rule, the v75 serve-not-read
  rider — the Janitor, verbatim: *"which would be less 'never mine' than
  'never serve.' If mining helps our cartography that's sufficient reason
  to mine IMO. It's what we do with it that matters, and it never goes
  into the museum."*): read its site if the map needs it, politely and
  serially, robots honored, never in bulk — then write what you learned
  into that row's own cartography fields and nowhere else. A
  `verified-alive` row is never mined FOR HOLDINGS and never served;
  reading it to keep the map honest is the ordinary case, not an
  exception.
- **Accession** — actually processing a promotion INTO the museum:
  mining, serving, minting, writing prose that becomes part of the
  collection. This is the perfection-pass-and-Phase-3-gated work every
  other section of this handbook describes, and it waits behind whatever
  phase gate is currently in force.

**Why the split matters operationally**: a wave that wants to go run a
frontier-enrichment pass (harvesting founding years, URLs, or name/status
facts from a bulk source) is doing cartography and doesn't need to wait
for a processing pause to end — it's free to run in parallel with
anything else, including a hold on new accessions. A wave that wants to
actually start mining/serving/minting a NEW promotion is doing accession
and is exactly the kind of work a Janitor-directed pause (see `CLAUDE.md`
and the project's own memory record for the standing pause boundary in
force at any given time) holds. Reading a directive that names one of
these two words tells you immediately which gate applies.

---

## Hub processing

**THE HUB-PROCESSING STEP** (the Janitor, 2026-08-23, near verbatim: hubs
"require intermediate processing steps as they'll enable accessions of
many promotions"). A community hub (`medium: "community-hub"`, THE
HUB-ENTITY GAVEL, `CURATION.md` v76) is not one promotion — it is a
directory, a game engine, a portal many member feds plug into — and
mining it like an ordinary promotion (collect, serve, done) throws away
exactly the structure that makes a hub worth accessioning at all: the
member-fed roster itself. RSPWF is where this pattern was first worked
out, before it had a name — Top 200 parses, directory joins, classifieds.
CyberSlam and fantasywrestling.com (FW Central) are the two hubs that got
it applied deliberately, after the fact, as a named four-step lane
(the workshop's `cyberslam-hub-dossier-2026-08-23.md`,
the workshop's `fw-hub-dossier-2026-08-23.md`).

Four steps, run after a hub's own corpus is collected and before, or
alongside, the hub's own wing accession (the beacon/placard/epitaph work
every promotion gets):

1. **Member-fed census**, built from the hub's own structures — nothing
   guessed, nothing crawled fresh. A `<select>` nav widget, a
   `/host/<fed>/`-style directory, a CGI `federation=<CODE>` URL scheme,
   a League Listing table, a "jump to conference" dropdown, a
   partner-sites page — whatever the hub's own machinery already
   enumerates its members with. CyberSlam's 64-row census came entirely
   from its own nav widget and CGI scheme; FW Central's 45-row census
   came from four such structures at once (two League Listings, a
   12-snapshot conference reconstruction, and a 15-league Prodigy
   register).
2. **Frontier expansion, with receipts.** Every member-fed code the
   census turns up that isn't already on `data/frontier.json` gets a new
   row — name as the hub's own widget/listing gives it, `first_seen_in`
   the census receipt, dated and tiered where the hub's own structure
   carries that. Every code that IS already on the ledger gets checked
   for collision (the four-signal test, `CURATION.md`'s collision
   doctrine) before anything is touched.
3. **Join-key extraction**, interoperating with the Top 200 join index
   (the workshop's top-200 resolve folder). Bio cards, standings tables, board-post
   attributions, simmed match prose — anything pairing a named wrestler
   with a named fed inside the hub's own corpus. The Janitor's own
   framing governs how this reads against the Top 200's unresolved
   acronyms: **every page placing a ranked wrestler inside a named fed
   casts a resolution VOTE for that fed's acronym** — corroboration that
   the acronym belongs to some real, independently-documented e-fed, not
   proof that the hub's own captured roster and the Top-200-tagged
   roster are the same promotion. A vote and a wrestler-level identity
   match are different findings and get reported as different findings
   (CyberSlam's own 11 acronym votes cast zero roster-level confirmations
   among them — the honest result, not a partial failure).
4. **A hub dossier digest** — one workshop digest,
   `<hub>-hub-dossier-<date>.md`, that a downstream accession lane reads instead of
   re-deriving any of the above. Census table, frontier diff
   (recommended, not applied — cartography stays cartography, per the
   doctrine above), join-key table and vote tally, a bio-card/board
   inventory for whoever builds the wing next, a memorial/Spectre
   watchlist re-run, and a QUEUE-REMAINING section naming what only a
   live crawl could still add.

None of the four steps mints, serves, or writes to `data/` on its own — a
hub-processing pass is cartography (see above), and its own output is a
digest plus a recommendations list. Applying those recommendations —
minting the new frontier rows, filing the collision notes, casting the
votes — is a separate, explicit pass, the same cartography/accession
split the rest of this section already draws.

---

## The depth-tier ladder

> **Harmonization note (2026-09-02, coordinator, after the phw ruling):** the
> tier definitions below describe the ladder in terms of shows because most
> wings have them — but CURATION.md's own controlling text ("Tier is a
> processing ladder, **not a content requirement**") governs where a corpus is
> proven exhausted and holds no shows at all: full cold processing of every
> surviving document earns the tier (GCWF/CBWF/revolution-wrestling/oww/xwf/phw
> precedents). Do not read the show-based wording as a content floor.


**THE DEPTH-TIER DOCTRINE** (Janitor-ratified, 2026-08-21) answers the
scaling dilemma the Janitor named directly: *"I will die of old age
before we'd complete this"* at uniform full-depth processing for every
promotion the project will ever touch, versus *"too shallow for me"* at
uniform shallow coverage for everything. The resolution is a tiered
standard — a promotion is honestly processed to WHICHEVER tier its own
record and this project's own priorities currently support, and that
tier is itself a fact worth stating, not a gap to apologize for:

- **Frontier (pre-tier)** — "we know it exists." A `data/frontier.json`
  row: name, and whatever cartography (see above) has surfaced about it.
  Not accessioned at all. The cheapest state in the whole system, and the
  correct resting state for the overwhelming majority of promotions this
  project will ever have any record of.
- **Tier 0 — Attested.** The-X-shape: a `promotions.json` row plus a wing
  placard, no holdings behind it — "a beacon." Enough to say the
  promotion existed and roughly what it was, sourced honestly, with
  nothing served or minted yet.
- **Tier 1 — Collected.** Full MECHANICAL processing: mine, dedupe,
  verbatim-serve, date-validate, auto-link. No deep per-show reading —
  the preservation floor, and the tier this project's own mechanical
  tooling scales to hundreds of promotions at, not dozens.
- **Tier 2 — Structured.** Selective structure: signal shows chosen
  MECHANICALLY, not by exhaustive reading — title-ledger change shows,
  PPV/name-pattern matches, length outliers, wanted-list reach. A fed's
  own paperwork (title histories, awards ceremonies) often yields real
  structure without a full show-by-show read.
- **Tier 3 — Full crawl.** The memorial standard — the current fleet-era
  standard for personal/memorial promotions: every show read, matches
  structured, appearances extracted, the full show-by-show crawl the
  Sequencing section above requires before Storylines prose gets written.

**Depth is a debt payable later; collection is a debt you can't pay at
all.** A promotion sitting at Tier 1 today can be deepened to Tier 2 or 3
whenever the project (or a future contributor) has the budget — but a
promotion never even mapped to the Frontier ledger, or never mined at all
while its last surviving copy decays, is a debt this project can never
go back and pay. This is why cartography and Tier 0/1 collection are
prioritized as the scalable floor, with Tier 2/3 depth applied
selectively rather than uniformly — the deep dives already run (GIWF,
UWF, XUW, WWA, NAPW, PTC, OSW) were themselves R&D: their yield is
encoded in the validators and this handbook, portable and not re-learned
per promotion, which is part of why going deep on the first several
promotions was worth the cost even though it won't be repeated
uniformly.

**The Janitor's own addendum, which is the forward-looking half of this
doctrine**: *"depth itself should be an edge for promotions, where we can
honestly name which depth tier each has been collected at to date."*
`promotions.json`'s existing prose `depth` field (`docs/SCHEMA.md`'s own
promotions section) is the natural home for a controlled tier value
alongside its free-text description — encode and render the tier
honestly on every wing as this doctrine gets applied going forward, the
same "if it can be an edge, it's an edge" discipline this project applies
everywhere else. **Contributor autonomy always overrides the ladder**:
per the Janitor's own ordering principle for the platform's future, *"if
someone picks up the repo in a year and decides to only do their own
promotion, it's their call"* — the tier ladder describes this project's
own default sequencing, not a ceiling on what any one contributor chooses
to do with their own promotion.

---

## The tier transitions (the cold-start standard)

The chapter below is the collection craft distilled from the collection
era's own digests (ia-overnight batches 1–4, the Usenet campaign, the
geocities and fandom frontier mines) — every rule was learned by an
incident on record. It is written to the cold-start standard: a fresh
session with only this repository must be able to execute any tier
transition from these recipes alone. The Mining section above covers
the same ground in narrative depth; this is the portable recipe card.



A fresh session with only this repository must be able to execute any
of these. Each recipe assumes the prior tier's state.

### Frontier → Tier 0 (attest)
1. Verify the frontier row's receipts (name + whatever dates/urls it
   carries). Apply the collision doctrine: acronym + full name + dates
   + URL; in doubt, a NEW promotion row — never merge identities on a
   name alone.
2. Mint the promotions.json row: founded/closed at honest precision
   (source required), tier 0 with tier_source, depth phrase from the
   defined vocabulary.
3. Create the one promotion page (promotions/<id>/index.html) from the
   full marker skeleton — copy a healthy Tier 0 peer (npw) and include
   EVERY marker block (browse, missingshows, provenance, pager): The X
   shipped without them and needed a later touch-up.
4. Placard capsule only. No epitaph is owed below Tier 1; write one
   only if the attestation evidence itself supports a sentence.
5. Pipeline, gates, commit. A beacon is a complete museum object.

### Tier 0 → Tier 1 (collect + serve)
The collection craft, distilled from ~12,700 pages across five batches:

WAYBACK MECHANICS
- https:// only (http fetches fail silently, curl exit 7).
- Always -L (bare downloads save the 302 body: zero-byte files).
- The `id_` timestamp suffix serves the original bytes without
  Wayback's chrome.
- CDX first, fetch second: census with collapse=urlkey + statuscode
  filters, THEN fetch from the census. For deep re-probes drop the
  collapse — the collapsed view missed the IWF homepage entirely.
- The CDX API caps around 8k rows; giant hosts need scoping before
  censusing.
- In-item filenames on archive.org items can differ from identifiers
  (parenthesized suffixes); URL-encode them.

POLITENESS AND PACING
- 2.5-3s spacing. SERIAL chains only — two concurrent fetch chains
  rate-limit even when each is individually polite.
- **ONE CRAWL AT A TIME, PROJECT-WIDE** (the Janitor, 2026-08-23,
  verbatim: *"All Wayback crawling needs to be kind. Make sure we're not
  doing multithreaded calls there. One crawl at a time, backing off when
  appropriate."*). This binds the coordinator, not just each lane: a
  fleet may hold only ONE Wayback-fetching lane at any moment — every
  other collection lane waits its turn or works local sources only, and
  the coordinator's own ad-hoc probes count as a crawl. The incident
  that earned it: a fleet session ran three collection lanes plus
  coordinator probes against Wayback at once, each "individually
  polite." No threads, no async, no `xargs -P`, ever; back off on the
  first 429/503 and slow down rather than retry harder.
- Foreground chunks sized under the ten-minute call window, resumable
  via a manifest.tsv; a killed chunk re-runs from the manifest.
- Live sites are never COLLECTED — never served, never accessioned, never
  mirrored (door policy, and `CURATION.md`'s dead-only rule as amended at
  v75). They may still be READ for cartography, one polite serial request
  at a time, robots honored, results going to the frontier row's own
  fields and nowhere near `promotions/`. Wayback's historical captures of
  a live site are fair for the map on the same terms; they are not a
  collection path around a living fed.
- **THE ROBOTS GAVEL** (the Janitor, 2026-08-23, verbatim: *"for live
  promotions, we honor Claude disallow. We can monitor for liveness over
  time and memorialize from IA if appropriate later. I suspect the block
  is for AI training, which we would also disallow, but we shouldn't
  infer that."*). A living site whose `robots.txt` disallows an AI agent
  by name (`ClaudeBot`, `Claude-Web`, `anthropic-ai`, `GPTBot`, `CCBot`,
  and the same class of user-agent) is **not read for cartography at
  all**, regardless of the user-agent this project declares in its own
  research fetches — a named block binds even where the literal declared
  UA string doesn't happen to match it. That row keeps liveness-only
  monitoring (a single HEAD per cadence is acceptable) and the Archive's
  own captures of the site remain available for memorialization if it
  later dies. The block is recorded as a fact on the row, full stop —
  its motive (AI-training avoidance, general crawler hostility, anything
  else) is never inferred, only the block itself. The incident this
  carries its scar from: the living-cartography pass on
  `wrestleworld.forumotion.com` found a combined block naming
  `ClaudeBot`/`Claude-Web`/`anthropic-ai` after two pages had already
  been fetched under this project's own `ewmuseum-cartography/1.0`
  research UA (which the block's literal string didn't match) — flagged
  rather than resolved unilaterally, and this gavel is the resolution.
- robots.txt and bot-challenges are honored, never spoofed around. A
  blocked archive is a Janitor-browser errand or a dead end, recorded
  as such.

CONTAMINATION DISCIPLINE
- Content-sample ACROSS THE CDX DATE SPREAD before any bulk fetch — a
  legitimate root page does not prove later captures aren't a squatted
  domain (CWO: 2 real pages out of 181; BOB's AdSense window; ESW's
  EduSoho squat predating any fed crawl).
- Exclude squat windows explicitly in the manifest; count only real
  pages in reports.
- Honest zeros fast: a never-crawled or junk-URL row gets recorded and
  passed in minutes, not dwelled on.
- Huge corpora cap at the ~300-400 most content-dense captures
  (prefer cards/results/rosters over images); the remainder stays
  census-listed for a future pass.

VERIFICATION
- A regen or fetch loop is DONE when its completion line and a
  captured exit code say so — never because the process is gone
  (buffered stdout makes killed and finished look identical).
- Never let a wait-loop's own pgrep pattern match itself.

HARVEST AS YOU GO
- Grep the held corpus for outbound links (geocities.com paths,
  partner-fed banners, topsites lists): the corpus-first method found
  the era's own fed directories. Log frontier facts; never edit
  frontier.json from a collection lane.
- Memorial vigilance on every page: the standing name list plus
  "Memorial Cup"/memorial language plus "Written by" credit blocks.
  Flag prominently, collect deeper around any hit, keep real-name
  material workshop-only.

SERVE
- Census by post-content, never by board name (first dogfood run: a
  "Results" board of 172 topics held 35 shows and 125 weekly award
  posts — a forum fed's board names are aspirational; only the shape
  of post #1 classifies a topic).
- Convert per the verbatim-serving rule (mined text never edited;
  museum-inserted presentation only), register rows with
  precision-aware dates sourced to document or capture, run the
  dedupe sweeps (checksum + the three duplicate-filing mechanisms:
  day/month format clash, stale-template dateline, adjacent-day
  double-filing), accession lot in collections.json, tier → 1.
- **A non-English document carries three things a peer's English page does
  not** (THE ECOSYSTEM EXPANSION GAVEL, 2026-09-05; `CURATION.md`
  v111(c)/v112(b)): `lang="<BCP-47>"` on its own `<div class="document">`,
  `<!-- translation:start --><!-- translation:end -->` immediately above the
  provenance paragraph, and — where a bridge exists — `foo.en.html` beside it.
  `npm run chrome` bootstraps the marker and fills the control; `npm run
  check` fails the page if the marker is missing, and fails an ENGLISH page
  that carries one by copy-paste. The wing's own row carries `language`,
  `country` and the `caption_en` sibling; nothing else about the recipe
  changes, because a primary document serves verbatim in its own language and
  a translation never replaces it.

### Tier 1 → Tier 2 (structure the signal)
1. Selection is mechanical, not editorial: title-ledger change shows,
   PPV/supercard name patterns, document-length outliers, wanted-list
   reach, the fed's own paperwork (title histories yield reigns
   without deep reads).
2. Structure matches[] per SCHEMA (result/winner/winners/losers/
   eliminations as the text supports; sides[] takes resolved ids only;
   unminted battle-royal entrants live in eliminations[] labels).
3. Reconcile appearances[] (every match-side entity gets kind:"match").
4. House style is now owed: write it from the shows actually read,
   graded and sourced.
5. Tier → 2 with the fraction in tier_source ("93/242 shows").

### Tier 2 → Tier 3 (the full crawl)
The fleet pattern, sixteen generations refined:
1. Work promotion-scoped, chronological, 2-3 ordinary shows per batch;
   supercards get dedicated unhurried batches, NEVER started at
   reduced care; close at honest capacity — a successor finishes.
2. The lane brief is the portable rulebook: restate the binding rules
   in it rather than requiring a full digest read (onboarding must
   scale sublinearly with project history; CURATION is always read in
   full — the law is never trimmed).
   Every brief carries one more line, verbatim (first dogfood run,
   2026-08-22 — it fired twice in one accession): "if the corpus
   contradicts this brief, the corpus wins and you say so." A brief is
   written before the census; the census outranks it.
3. Per-show doctrine: staged-announced results stand (retcons, thefts,
   fake-ref counts — legitimacy receipted in notes); declared outcomes
   are facts, unset is for silence; archival clip/montage content
   never generates rows on the airing show, fresh-filmed sketches do;
   banner/production graphics are distrusted for dates and venues;
   two-bells-one-match restarts are one row; sources-disagree means
   receipts to the queue, never picking a side; card headers claiming
   stipulations the text doesn't support are noted, not copied.
4. Duplicate vigilance before structuring any show whose content
   smells familiar; ledger cross-checks (reign brackets) resolve
   transposed dates; brand-day names are fiction, only in-text
   independent datelines count.
5. Mint discipline: full alias map + normalized decorated-aka check
   first; bare-common-first-name identities prefer not-linkable;
   generic-archetype names qualify at mint.
   Inspiration flags ride the mint (the Janitor ruling, 2026-08-22): when a
   bio, gimmick, or announce text names its real-world or pop-culture
   model OUTRIGHT, record it (an external-figures row where it earns
   one, a note otherwise) at the moment of reading — applied forward
   only, never retro-swept across an already-crawled corpus.
6. Storylines are owed only now — after the crawl, never before
   (crawl-then-storylines is law), because only the crawl makes the
   arcs tellable.
7. Handoffs: scratchpad relay when the workshop is sandbox-blocked;
   QUEUE-REMAINING sections; the coordinator folds verbatim and merges
   serially (lane-files theirs, generated ours, rebuild once, gate,
   push; never pull --rebase across merge commits).
8. Tier → 3; the promotion owes storylines and carries the full
   instrument surface.

### Standing cross-cutting rules (all tiers)
- One writer on main. Scope partitioning does not license concurrency;
  shared scripts break every partition.
- Gates guard the commit chain with &&, never precede it with ';'.
- Recursive file operations from the museum root exclude .claude/.
- Never end a turn whose only purpose is waiting; if you find yourself
  explaining why THIS wait is different, it isn't.
- Memory proposes, primary sources confirm — for the Janitor's
  recollections and the coordinator's briefs alike; seven briefs deep
  is not too deep for a primary-text correction.
- Cartography is unrestricted; accession waits for its process.
- The prose surface is tier-gated: capsule/epitaph/house style/
  storylines. AI-authored prose wears the badge; the Janitor edits earn
  the unmarked state. A community wing (`medium: "usenet"` or
  `"community-hub"`) owes no house style at all — the field describes
  staged booking, which an institution doesn't do, so its soft warning is
  expected and correct there, not a debt (the Janitor, 2026-08-23; RSPWF's
  own accession first hit this — `registry-validate.mjs`'s tier-owed
  soft-warn now skips those two media rather than nagging for a field the
  wing can never honestly fill).


## Coordinator craft

**Worktree base verification (first dogfood run, 2026-08-22):**
immediately after spawning a worktree lane, `git -C <worktree> log -1`
and compare against main's own tip; if the worktree is behind, the
lane merges main before its first gate. Worktrees can be cut a commit
behind main as a harness fact, not a lane's fault — unverified, it
costs red gates at merge time.

Lessons specific to running a fleet of parallel executors and merging
their work back — the coordinator's own job, distinct from any one
lane's.

**Verify before relaying — label a hypothesis as a hypothesis.** THE
PHANTOM-LINK SAGA: worktree lanes kept reporting mysterious cross-
promotion links appearing in their own uncommitted pages (a diablo/
widowmaker link, wanted-list entries pointing at other worktrees' cwd
paths). Two relayed "probably X" theories were both correctly REFUSED by
the lane receiving them — a lane trusts a founding brief unconditionally
and a mid-flight relay never, exactly as this handbook's own onboarding
discipline expects. The coordinator's own root-cause pass (`cross-
reference.mjs`'s own `walk()` lacking a `.claude/` exclusion — see
`CLAUDE.md`'s recursive-file-operation invariant) turned out to be
correct, but only after the coordinator verified it hands-on rather than
relaying a plausible-sounding theory as settled fact. **The standing
rule this earned**: a coordinator's own claim about root cause, merge
state, or "is this actually fixed" gets verified against the actual
filesystem/process state before it's relayed to a lane as fact — a
hypothesis is stated as a hypothesis until it's actually been checked,
never dressed up as a finding because it sounds right.

**Merge policy.** Every fleet-era merge that went cleanly followed the
same shape: on a conflict, **lane files (shard JSON, wing pages) resolve
"theirs"** (the branch's own work is the real content); **generated
files (monoliths, `characters/`, `titles/`, `wanted.json`, and the like)
resolve "ours" and then get a full rebuild** (`npm run build:data &&
npm run refresh:links && npm run chrome && npm run stats`) rather than
hand-merged, since a generated file's own "conflict" is really just two
snapshots of a derivation that a rebuild reconciles automatically;
**rebuild once per merge** (not once per lane-file resolved), then gate,
then push. **Never `git pull --rebase` in a merge-heavy coordinator flow**
— `pull --rebase` flattens merge commits (a real incident: it replayed
an already-merged branch's own commits back into conflict hell, on an
origin that hadn't even moved) — the coordinator's own flow is `git
fetch` + compare against origin, then a plain push; `pull --rebase`
stays exactly what `CLAUDE.md`'s own invariant #9 describes it for —
ordinary single-lane session start, not a coordinator reconciling
several just-merged branches. The distinction is about the flow, not the
branch: a single-writer session working linearly on `main` with no
pending merge commits of its own to flatten (a perfection wave, an
ordinary content session) is invariant #9's normal case and stays safe
even when it happens to run on `main` directly; the prohibition bites
only once a coordinator has actual merge commits on the branch that a
rebase could flatten.

**Close lanes at honest capacity, not at a target number.** A lane that
calls its own session done early, having correctly judged that pushing
further would mean working "at reduced care" (a real closing line from
this project's own fleet era) is doing exactly the right thing — an
honestly-scoped partial result banked cleanly is worth more than a
forced full quota delivered carelessly. The coordinator's own job is to
accept an honest early close the same way it accepts an honest gap in a
served record: state what was actually done, launch a fresh successor
from the honest stopping point (never guilt a lane into pushing past its
own judgment), and never treat "didn't finish the assigned batch" as a
failure on its own.

**Duplicate vigilance — the drive's three named duplicate-filing
mechanisms.** This project's own corpus produced the same show filed
twice under three genuinely distinct mechanisms, each requiring its own
detection method — conflating them (assuming one fix catches all
duplicates) misses real cases:

1. **DD/MM clash** — the drive's own root cause, per the Janitor: *"UWF
   run by a BRIT and an AMERICAN"* — a date written `03/08` read as 3
   August by one convention and 8 March by the other, producing two
   filenames for one show. Detectable by a sweep: both components ≤12 is
   the signature (an unambiguous date, day>12, can't fork this way);
   canonical reading confirmed British in every proven case this project
   has found.
2. **Stale-template dateline** — the served text's OWN in-page dateline
   is internally impossible (a "Sunday, November 18th" greeting where
   November 18th was actually a Tuesday) because the fed's own template
   carried a stale date forward from an earlier draft; the REAL date (the
   Sunday the ledger and the fed's own show-day convention agree on) is
   a different day than the one the filename or the greeting claims.
3. **Adjacent-day double-filing** — two filenames one calendar day apart,
   word-for-word the same show, with no digit-transposition or stale-
   template explanation — simply filed twice.

**The day-of-week method's real limits, stated so it's never
over-trusted**: a document's own stated day-of-week ("Sunday...") is
useful supporting evidence, but **brand day is fiction, not a calendar
claim** — a fed posts a show whenever it's actually finished, and a
byte-identical stock greeting ships with the script regardless of the
real posting date, so day-of-week fit has ZERO discriminating power
between two copies of the same document. What actually resolves a
duplicate pair: **independent, in-text evidence only** — a dateline that
names something independently datable (a real-world event mentioned in
passing, an explicitly-dated ledger cross-reference), or the promotion's
own title ledger disagreeing in a way that brackets the true date (see
the September-3-vs-March-9 resolution, this project's own worked
example: a neighboring show's own title changes made March impossible).
Day-of-week or acronym fit is corroborating at best, never
contradiction-grade, and is never sufficient on its own to retire a
show.


## The privacy ledger (structural enforcement)

**Scoped allow rows (guardrail, 2026-09-04).** An `allow` row that carries a `scope` overrides a `deny` row for the same term only under those path prefixes — the way to serve a term that is a real person's out-of-character name elsewhere but an in-fiction persona or a v105(a) self-insert on one wing's own pages. A hit line under an allow scope passes only if every deny term on that line is covered by an allow row; outside the scope the deny row is untouched. An `allow` row with no scope keeps its older meaning: a judged-servable handle or login for the header check. The row's note must say why the carve-out is lawful (persona billing with msg_ids, or the self-authorship reading).


Every redaction gets TWO acts, not one: the marker in the document, and a
row appended to the workshop's `redaction-ledger.tsv`. The
gate's own `scripts/privacy-check.mjs` (chained inside `npm run gate`,
2026-08-31) then greps every deny-row term across the whole museum tree on
every run — served docs, museum-voice prose, registry JSON, frontier notes
— and a hit is a red gate: the pre-commit hook and the r2-sync guard both
key off the same stamp. It also checks Usenet-post headers for unredacted
personal logins/emails (netnews system accounts are allowlisted) and that
every marker-carrying page's provenance line discloses a matching
redaction count (warn-only until the 2026-08-31 legacy sweep lands, then
strict).

Rows are filed per branch, not straight into the shared file. The ledger
lives outside git, so a lane appending a deny row the moment it redacted a
term in its own worktree turned main and every OTHER worktree red on that
term wherever it still stood — until that lane's redaction merged (seven
times on 2026-09-02). A lane now writes its rows to
the ledger's pending fragment `<branch>.tsv` (in the workshop), same columns as the ledger;
`privacy-check.mjs` loads the main ledger plus the CURRENT branch's fragment
only (on main, the ledger alone) and names the source of every failing term.
At merge the coordinator folds the fragment in with `node
scripts/ledger-fold.mjs <branch>`, which appends its rows, skips terms
already present, and deletes the fragment. A missing fragment is a no-op.

A redaction without a ledger row is half a redaction — the row is what
stops the same name resurfacing in a sibling document, a wing epitaph, or
a frontier note months later (all three happened on 2026-08-31, the day
this machinery was built; the seed audit then immediately caught a lane's
own paperwork re-quoting the names it had just redacted, and one more
unredacted Path-header login). When describing a redaction in notes or
digests, describe the CLASS, never quote the term. Scoped deny rows exist
for the one case a real name collides with a fictional namesake — note
why, every time.

### The credit-context warning (structural, warn-only)

`scripts/privacy-check.mjs` is ledger-driven: it only catches a name once
someone has filed it as a `deny` row. That has a blind spot — a name
nobody has filed yet is invisible to it, however plainly it's sitting in
the served tree. A PTCpedia "Contributors" page carrying nineteen
real-name credits sat served for nine days before a human noticed, simply
because nobody had filed those names yet. A plain name-shape detector
can't close that gap on its own: nearly every fictional wrestler is also
name-shaped. The signal that actually discriminates a real-name credit
from a kayfabe persona is CONTEXT — a credit keyword (`staff`,
`contributors`, `thanks`, `written by`, `webmaster`, `commissioner`,
`referee`, `e-mail`, and similar) sitting on the same line, heading a
list the name sits inside, or the sig-block position of a Usenet-shaped
document.

`node scripts/privacy-credit-warn.mjs` (`npm run privacy:credit-warn`)
scans every served promotion page plus the frontier/promotions registry
notes for name-shaped strings in credit context, drops anything that
STANDS for a structural reason — a known character persona/aka (v105(a)),
a ledger `allow` row, or a term the ledger already `deny`s (privacy-check
is already gating that one) — and reports everything left as a WARNING,
plus a full TSV at the workshop's `credit-warn-latest.tsv` (overwritten
every run) for triage.

**It is warn-only by design and EXITS 0 UNCONDITIONALLY.** `gate.sh` runs
it after the privacy chain with `|| true`, on its own line outside the
`&&` chain — it can never redden the gate. This is deliberate, not a
gap: several of the tool's own required keywords (`referee`,
`commissioner`, `president`, `owner`, `booker`) are also ordinary
in-universe wrestling roles, so a page recapping a fictional match's
officials trips the same keyword a real Usenet sig-block would. A
warning is a READ REQUEST, not a redaction order — it means "a human
should look at this line," never "this line is confirmed a real name."
Filing a ledger row (`allow` or `deny`, per the normal redaction
discipline above) is still how a warning gets resolved; the tool itself
never mints, edits, or redacts anything.

### Structural guardrails (2026-09-03)

A same-day set of hard-fail and warn-only checks, all born from incidents
in the privacy pass ahead of the grand accession — see the workshop's `JOURNAL.md`
2026-09-03 for the full incidents. All three share one shape: they make a
lesson STRUCTURAL (a script that checks every run) rather than something a
lane has to remember.

**(A) The top-level allowlist.** 62 lane scratch directories were once
committed straight into the museum repo's top level and, with no
`.assetsignore`/`.gitignore` line naming them, uploaded to the R2 bucket by
every `r2-sync` run for weeks — they only surfaced when a privacy hit
inside one finally reddened a gate. `scripts/deploy-allowlist.mjs` is a
small, shared, POSITIVE list of every legitimate top-level directory and
root file the museum tree is allowed to contain (derived from the current
tree — served-content directories, the sacred docs, build/site config,
tracked dotfiles). `scripts/validate.mjs` hard-fails, naming the exact
path, on any tracked or untracked-unignored top-level path NOT on that
list; `scripts/r2-sync.mjs` refuses to upload (same list, same module,
imported once so the two can never drift apart) rather than relying on
`validate.mjs` having caught it first. A denylist (`scratch-*/`, one
`.gitignore` line) only ever catches the shape that already burned
someone; an allowlist catches the next shape too, whatever it turns out
to be. Update the list only for a real, reviewed addition to the museum's
own top-level shape — a lane's scratch space belongs in `archive/`, on
the machine one level up, never here.

**(B) Doc-class is structurally required.** CURATION v109(a) says every
served document carries `data-doc-class="…"`; `scripts/validate.mjs` now
enforces it directly rather than trusting an accession lane to remember.
Any page under `promotions/<wing>/archive/` or `.../rp/` that carries a
provenance paragraph or an older-template `Source:` footer citation (a
wing's own `archive/`/`rp/` INDEX page — the holdings listing, not a
document — is exempt) must carry the attribute, and its value must be one
of the ten v109(a) classes. `credits` and `guestbook` get a second,
stricter check: v109(d) defaults both to collect-never-serve, so a page in
either class is a hard fail UNLESS it also carries
`data-janitor-served="<date>"` — the specific ruling marker, never a
lane's own judgment call. (The rspw mass-acknowledgement page is currently
`credits`-classed and unmarked, HELD for the Janitor per the 2026-09-03
accession notes — this check is *expected* to catch it until that ruling
lands and the marker is stamped; that is the check working, not a false
positive.)

**(C) Withdrawn pages can't dangle in the shards.** Withdrawing a served
page once left `data/shards/<wing>/shows.json`/`rps.json` still citing its
path, which produced 253 dangling holdings-page links and 2 dangling
show-index rows before a gate caught it (gate run 11, 2026-09-03).
`withdraw-pages.py` now drops those rows itself, but `scripts/validate.mjs`
makes the invariant structural instead of tool-dependent: no shard row's
`page` (shows.json) or `served_url` (rps.json) may cite a
`promotions/...` path that doesn't resolve to a real file — link
resolution reuses the same hash/query-stripping, directory-to-`index.html`
rule the site-wide link checker already uses, so a legitimate anchor into
a wing's own `#storylines` section is never a false positive.

**(D) Forename+initial ledger rows warn, never fail.**
`scripts/privacy-check.mjs` gained a warn-only pass alongside the
credit-context warning above: a global `deny` row shaped like a bare
forename plus a single initial (`Chris B`, `Alex Q`) is flagged as
"consider scoping," never failed. Gate run 6 on 2026-09-03 reddened when
exactly this shape collided with an unrelated public figure's name inside
an in-fiction show script — CURATION's own "James F" precedent already
says the fix is a scoped deny row or a specific `allow`, and this warning
just surfaces the candidates for that human triage before the next
collision, rather than after.


## Additions of 2026-09-04 (coordinator, from the grand accession's evening — see JOURNAL for the dated lessons)

### PROCESS.md additions — 2026-09-04

Ready-to-paste additions drafted from the workshop's `JOURNAL.md` (2026-09-04,
15:00 PT onward) and the workshop's `GAVELS.md` (2026-09-04 entries). Each block
below is headed with the PROCESS.md section it belongs in. Not written to
the museum tree or any ledger — hand these to the coordinator for folding
in during a gate-free window.

---

### Cross-referencing

**An accession lot's own held list chunks once it clears the row budget
(`data/site-config.json`'s `row_budget`), the same discipline the A-Z/
season pages already use.** `collections/<id>.html` stays the lot's index
page — its own placard, provenance, and holdings summary — and once its
held-wing list would bake past the budget, `scripts/cross-reference.mjs`
splits that list into `collections/<lot>/<letter>.html` chunk pages
(register-style sub-splits where one letter alone still overflows), wired
both ways by a stale sweep that drops chunk pages the current list no
longer needs and adds new ones the list has grown into. A contributor
never sees the seam: the lot page still reads as one holding, its own
list just paginates by letter once there's enough of it to need
pagination — the same shape a growing A-Z page already takes. The gap
this closed: the census lot (`collections/0148.html`, 467 held wings)
shipped with no chunking at all and reddened `validate.mjs`'s own
row-budget check the moment it crossed the budget; it now serves as 22
lettered chunks (JOURNAL, 2026-09-04).

---

### QA

**The gate and the commit it guards have to agree on locale, or the
pre-commit hook's own stamp digest lies.** The digest sorts the file list
it hashes; if the gate that produced the stamp ran under one locale's
sort order (`LC_ALL=C`, byte-order ASCII) and the hook itself runs under
the shell's own default (a UTF-8 locale, which can order punctuation and
case differently), the two digests disagree over a file list that never
actually changed — a commit blocked on "stamp mismatch, nothing changed"
that really is nothing changed, just sorted two different ways. Every
chain script now exports `LC_ALL=C` before running the gate, so the
digest a gate stamps and the digest a commit hook re-derives sort under
the same rule every time (JOURNAL, 2026-09-04).

---

### Coordinator craft

**A background wait loop can outlive the job it's watching, and then it
starts matching itself.** Coordinator edit scripts (the ones that touch
the museum tree during an apply window) guard themselves against running
mid-regen by grepping the process table for a still-live `node
scripts/...` job and refusing until it's gone. A lane's own wait loop
(`until ! pgrep -f "node scripts/cross-reference.mjs" ...`), left running
after its own job had actually finished, matched that same grep pattern
— including matching ITSELF, since a loop built on a broad `pgrep -f`
substring sees its own command line too — and never exited; every edit
script's apply-window guard read the identical stale "still running"
signal off it and refused to fire, on a window that was actually clear.
**Lanes never leave a background poller running past the point their own
job is done** — it doesn't just waste a slot, it can silently jam a
coordinator's own machinery for however long the orphan survives. The
guard itself is now anchored tighter (matching only an actual `node
scripts/` invocation, not a bare substring) so a stray shell wrapper
can't self-match the same way twice — a second line of defense, not a
reason to leave a wait loop running unattended (JOURNAL, 2026-09-04).

---

### The privacy ledger (structural enforcement)

**The ledger fold's duplicate check keys on the term alone, and a
page-scoped allow row for a globally-denied term reads as a duplicate of
the deny row it's meant to carve an exception into.** A fold that sees
the same term already present skips the incoming row outright — correct
for two deny rows on the same term, wrong for an allow row narrowing a
deny row's reach to specific pages, since the two rows aren't duplicates,
they're a rule and its exception. Two page-scoped allow rows were
silently dropped this way at a chain fold and had to be appended by hand
once the gap was noticed. The fix owed, not yet landed: the fold's
duplicate test needs to key on term+status+scope, not term alone, so an
allow row narrowing an existing deny survives the fold the same way a
second, genuinely-duplicate deny row correctly doesn't (JOURNAL,
2026-09-04).

**A bare forename or surname denied wing-wide collides with whatever the
wing's own fiction (or plain English) happens to be using that word
for.** A wing-scoped deny row for an out-of-character figure's bare
surname, filed to cover the pages where that figure's name genuinely
needed redacting, also matched an unrelated served ring persona's own
surname and the ordinary noun the two happen to share — thirteen pages
wide, none of them the actual redaction target. The fix scoped the row
down to the actual origin pages rather than leaving it wing-wide. **A
bare forename/surname deny row is filed page-scoped to the documents
where the out-of-character use was actually found and redacted, never
wing-wide by default** — a first or last name on its own is exactly the
shape most likely to already belong to a ring name, a stage direction,
or ordinary prose somewhere else in the same wing, and a wing-wide row
bets against that collision instead of checking for it (JOURNAL,
2026-09-04).

**`data/wanted.json` is generated from capitalised name-shaped strings
actually visible on served pages, so a page carrying a name under a
ruled allow (a persona, a v105(a) self-insert) puts that same name back
in front of the ledger the moment the page ships.** A fold that widens
such a name's row to the whole wing — or leaves it global — reintroduces
exactly the false hit the allow ruling was meant to settle, because the
generated wanted list keeps citing the served page by name regardless of
what the ledger says elsewhere. The fix: a name allowed on specific
served pages by ruling gets its row scoped to those served page roots,
not denied (or left standing) tree-wide — the scope has to match where
the name is actually being served, not the wing it happens to sit in
(JOURNAL, 2026-09-04).

---

### Intake

**Standing law from the Janitor's 2026-09-04 rulings, folded into the
memorial-verification practice above.** A storyline death or tribute told
entirely inside a fed's own fiction is ordinary in-fiction content, never
a memorial question — coordinators do not escalate a kayfabe memorial to
the Janitor on the memorial bar alone. Where a document is a genuine
memorial-wall primary source, the memorial subject's own name stays clear
on it; every OTHER real name the same document carries still redacts
under the ordinary privacy rule. And once the Janitor has actually ruled
a name match a collision rather than an identity (the same character/
wrestler name landing on an unrelated out-of-character figure), that
ruling is never re-litigated — it's flagged once, with its evidence,
ruled once, and then listed in the workshop's `memorial-cleared.tsv` so
no later pass re-raises the same pair. A NEW collision still gets flagged
with evidence the first time it's seen; the cleared list stops repeats,
not first sightings (the Janitor, verbatim: "Name collisions shouldn't be
entirely written off, but we don't need the same collisions being
repeatedly flagged" — GAVELS, 2026-09-04).

---

### Serving

**A fed's founding statement and its first (or only) recruitment ad carry
value on their own terms; a pile of reposts of the same ad does not
(the Janitor ruling, GAVELS, 2026-09-04).** Serve the founding post and the
earliest/only recruitment ad a fed ran — that's the fed announcing
itself, and it reads as exactly the kind of primary document this museum
exists to keep. Further reposts and near-duplicate ads of the same pitch
stay collected rather than served: repetition past the first instance
adds no contextual value the founding ad didn't already carry, the same
serve-on-contextual-value logic already governing supplemental-document
serving generally. A bare recruitment or fed-owner self-introduction with
nothing else around it — no memorial angle, no distinguishing content —
stays collected on that same value test, not served merely for existing.

---

### Registry

**Every `data/shards/<promo>/units.json` record needs its own `type:
"unit"` field — without it, `cross-reference.mjs` reads the row as a
character.** A dozen units minted across several wings shipped without
the field and were silently counted and rendered as characters instead
of units, which only surfaced as a registry-count mismatch at the gate
(the register and the registry disagreeing on both character and unit
totals) rather than at mint time. `fix-unit-type.py` back-filled the
missing field and is now folded into both the standing hygiene pass and
the minting templates themselves, so a unit mint carries its own type
from the start rather than depending on a gate catching its absence
after the fact (JOURNAL, 2026-09-04).
