#!/usr/bin/env node
/**
 * THE MUSEUM — wing header stamper (HEADER STANDARDIZATION WAVE,
 * 2026-08-18, user gavel: the wing headers were disjointed — some bare
 * acronyms, some full narrative sentences doing double duty as the page
 * title; HEADER REFINEMENT pass, same day: chronology is "pedantic" enough
 * to unwieldy the h1 in a compound-era wing, so it leaves the h1 entirely
 * and moves to the placard as its own labeled row; LEDE-ANATOMY pass, same
 * day: the one-line summary a lede used to bury alongside years/domain/
 * tagline duplicates gets its own home too; THE SEARCHABLE-FACTS WAVE,
 * same day: scale/medium/location join the placard, machine-readably).
 *
 * Regenerates SIX marker-delimited slots per promotion, from
 * data/promotions.json ALONE, so none of them can drift per-wing by hand
 * again — THE PAGE SKELETON doctrine (docs/PROCESS.md's Prose section), stamped: name
 * (h1) -> subtitle -> placard -> caption -> sections.
 *
 *   1. `<!-- wingheader:start/end -->` — the ONE heading a wing carries
 *      (WING HEADING DEDUP, 2026-08-18, the Janitor's gavel — a separate
 *      `.kicker` line used to stamp right above this same h1, naming the
 *      fed twice: "ADW — All Desert Wrestling" over "All Desert Wrestling
 *      (ADW)". That kicker line is gone, hand-deleted from every wing this
 *      same wave; this h1 alone now carries the fact. THE HEADER
 *      UNIFICATION WAVE (2026-08-22) retired the `.page-heading` CSS
 *      class this h1 briefly carried (mono typeface, smaller scale,
 *      uppercase, brass-dim) — a wing's own h1 is now a bare, unstyled
 *      `<h1>`, identical to every other page type's title, per the
 *      the Janitor's own "one style format to rule them all." Text reads
 *      "ACRO &mdash; Full Name" (em-dash,
 *      acronym first — supersedes the "Full Name (ACRO)" order FOR WING
 *      HEADINGS ONLY; the promotions listing keeps full-names-primary so
 *      same-acronym feds never collapse there), or the bare name where
 *      full_name is genuinely just the acronym (the no-invention rule).
 *      Plus, where the fed's own tagline/motto is SOURCED
 *      (`promotions.json`'s own optional `tagline` field — never invented
 *      for a wing that doesn't have one on record), a `.subtitle` line
 *      right under it (THE SUBTITLE COMPONENT, style.css — shared with an
 *      entity page's own aka line). No years anywhere in this block.
 *   2. `<!-- wingyears:start/end -->` — a single placard row, "Ran: " +
 *      promotions.json's own `years` field VERBATIM (honest compound forms
 *      — "2005–2010, revived c. 2013–2016+" — are exactly what this row is
 *      for; it's data, not headline prose, so unwieldy is fine here).
 *   3. `<!-- wingscale:start/end -->` — "Scale: " + the fed's own
 *      self-presented kayfabe scope (`scale`), rendered bare — no
 *      "(self-billed)" tag (dropped 2026-08-18, the Janitor's ruling: every
 *      value here is self-billed by construction, so the tag was a
 *      needless point, not a distinguishing one). Always renders —
 *      `scale` is populated for every promotion today, `unknown` included
 *      as an honest status value (same family as `depth: "in
 *      preparation"`), not an absence.
 *   4. `<!-- wingmedium:start/end -->` — "Medium: " + `medium` (+
 *      " — " + `medium_detail` where present). Same always-renders
 *      reasoning as scale. Also carries the Type row (THE TYPE-AXIS GAVEL,
 *      2026-09-05) and, since THE ECOSYSTEM EXPANSION GAVEL of the same day
 *      (CURATION.md v111(c)/(f)), the "Language" and "Community in" rows —
 *      all stamped inside this EXISTING marker rather than new ones of
 *      their own, so no wing page needs a marker
 *      bootstrapped onto it by hand (the Type row's own precedent, days
 *      old). Every one of them obeys the OSW-lesson contract below: no
 *      value, no row. The `type_note` trail is NOT among them any more
 *      (hook c210, 2026-10-09, finding C13): it stays in the registry and
 *      off the placard. The Play row this slot stamped from the same field
 *      as slot 5b went with it, so a placard names Play exactly once.
 *   4b. `<!-- wingdiscipline:start/end -->` — "Discipline: " + `discipline`
 *      (THE DISCIPLINE FACET, the Janitor, 2026-08-23), rendered ONLY where
 *      the sport is not pro-wrestling. The field's own default is
 *      pro-wrestling and is normally absent from the data entirely; a row
 *      saying "pro-wrestling" on every promotion in a wrestling museum
 *      distinguishes nothing.
 *   5. `<!-- winglocation:start/end -->` — "Based in: " + `location`
 *      (optional, staging-sourced only) — renders ONLY when the field is
 *      actually set; most promotions correctly carry none at all, and
 *      this slot renders nothing rather than a placeholder for them (see
 *      the OSW self-catch below: a field with no value gets NO row, never
 *      a row narrating the absence).
 *   5b. `<!-- wingplay:start/end -->` — "Play: " + `play`'s own human
 *      label (+ " — " + `play_detail` where present), THE PLAY FACET (the Janitor,
 *      2026-08-23): how outcomes were decided. Renders wherever the field is
 *      set, an explicit `unknown` included — that value records a check that
 *      came back empty, which is a fact; an unset field renders nothing.
 *      THE ONE PLAY ROW (hook c210, 2026-10-09, finding C13: "a duplicated
 *      'Play' label"): slot 4 stamped a second Play row off the same field,
 *      so every wing with a `play` value named it twice — once as the
 *      label, once as the raw registry token beside its detail. Slot 4's
 *      row is gone and its label table came here, so this one row carries
 *      the label and the detail together.
 *   6. `<!-- wingcaption:start/end -->` — one hand-drafted museum-label
 *      sentence, `promotions.json`'s own `caption` field (same one-sentence
 *      discipline, and the same living-prose `caption_asof` staleness
 *      machinery, characters/units already carry) — rendered as a `.lede`
 *      paragraph directly AFTER the placard, before the epitaph/sections.
 *
 * Same idempotent marker-patch discipline as stamp-chrome.mjs/
 * stamp-pager.mjs: safe to re-run any time, byte-identical output on a
 * second run with no data change. Folded into `npm run chrome`.
 *
 * THE OSW SELF-CATCH (2026-08-18): an earlier pass gave OSW a hand-authored
 * "Site: none mined yet" placard row — caught live as a double violation of
 * the never-narrate-absence law: it narrated an absence (no site) AND used
 * a collection-relative qualifier ("yet" is a promise about the MUSEUM's
 * own future mining, not a fact about OSW). Deleted outright, no
 * replacement. The lesson generalized into rule 5 above: an optional field
 * with nothing in it renders NO row, full stop — never a row that exists
 * just to say the field is empty.
 *
 * ONE-TIME MIGRATION NOTE, not an ongoing concern: several wings' own h1
 * used to carry narrative prose ("The fed that died once and came back
 * anyway.") instead of this data-derived form — that prose was
 * hand-relocated into each wing's own `<!-- epitaph:start/end -->` section
 * before this script's first run (verbatim, never lost, never
 * paraphrased), which is why the marker exists to find in the first place.
 * Likewise, the OLD `<p class="lede">` block each wing used to hand-author
 * (a hodgepodge of years/domain/tagline/one-line-summary, all in one
 * paragraph) was hand-audited and its elements distributed by hand, and
 * any pre-existing hand-written Scale/Medium placard row (NAPW, WWA, ADW
 * all had one already, by hand) was replaced with the marker equivalent —
 * same data, mechanically guaranteed not to drift from it now. A wing
 * WITHOUT a given marker is left untouched for THAT slot only and logged —
 * bootstrapping a new wing's own header/placard-row/caption block is a
 * one-time hand edit (wrap the relevant spot in the marker pair once), not
 * something this script invents on its own.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// THE SHARED MARKER MODULE (PROSE-FIX-01, 2026-09-13; proposal.md #0/#2.9)
// — this script never imported cross-reference.mjs's own render-time
// filter (importing cross-reference.mjs itself is not an option: it is a
// standalone generator script with top-level writeFileSync side effects,
// not a library — importing it would run its entire page-regeneration
// pipeline). text-markers.mjs is different on purpose: a pure, side-
// effect-free data module (regexes + a length-cap table), safe to import
// the same "each stamp script is a standalone unit" way this file's own
// esc() above already is — only the MARKER DATA is shared, not the
// sentence-splitting machinery cross-reference.mjs's own sanitizeMachineryLeak()/
// stripProcessSentences() carry (245 lines, built and verified for
// multi-sentence note prose — these three placard fields are each one
// short clause, so a whole-field marker check is the right-sized fit, not
// a sentence splitter).
import { PROCESS_MARKER_RE } from "./text-markers.mjs";
// A marked short clause renders as nothing, not a mangled partial —
// the same "silence over a fragment" rule cross-reference.mjs's own
// stripProcessSentences() documents for a note that is entirely process
// narration. Verified against every live medium_detail/type_note/aka[]
// value before this patch shipped: zero hits today (see findings.md),
// so this is preventative and changes no current wing page.
function dropIfMarked(s) {
  if (typeof s !== "string" || !s) return s;
  return PROCESS_MARKER_RE.test(s) ? "" : s;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = resolve(ROOT, "data");

function loadArray(name) {
  const raw = JSON.parse(readFileSync(resolve(DATA, `${name}.json`), "utf8"));
  if (Array.isArray(raw)) return raw;
  const key = Object.keys(raw).find((k) => k[0] !== "_" && Array.isArray(raw[k]));
  return key ? raw[key] : [];
}
// Mirrors cross-reference.mjs's own esc() — kept local rather than shared,
// same "each stamp script is a standalone unit" precedent stamp-pager.mjs
// and stamp-chrome.mjs already set.
function esc(s) {
  return String(s ?? "")
    .replace(/&(?!\w+;)/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
// THE FANDOM CROSS-CHECK WAVE (2026-08-24) — a `fandom` field holds the
// EXACT article title as the wiki spells it ("Extreme Wrestling
// Association(EWA)", parentheses and all). MediaWiki's own URL form is
// spaces-to-underscores then percent-encoding, and `encodeURIComponent`
// would eat the slashes and colons a legitimate title can carry, so the
// path is encoded with `encodeURI` after the underscore swap — the same
// shape the wiki's own canonical links use.
function fandomUrl(title) {
  return "https://ewrestling.fandom.com/wiki/" + encodeURI(String(title).trim().replace(/ /g, "_"));
}
// THE PLACARD IS A LIST (the Janitor's D466, "fix the launch list" ->
// finding C13 of the adversarial review, 2026-10-09: "Placard rows are one
// paragraph with <br>... render the placard as a dl"). A placard row is a
// term and its definition, so it is stamped as a dt/dd pair inside the
// wing's own `<dl class="meta">` instead of a span, two spaces and a `<br>`
// inside one paragraph — a screen reader read the whole placard as a single
// run-on line before. The LOOK is unchanged, in style.css (hook c210): four
// `.placard dl.meta` rules put back the zero margins, the one line per row,
// the two spaces after the label and the break between rows. The `.k` class
// stays on the dt, so `.meta .k`'s own brass-dim small caps still style the
// label. The dt and the dd are adjacent on purpose: whitespace between them
// would render as a third space in the gap.
function metaRow(label, valueHtml) {
  return `<dt class="k">${esc(label)}</dt><dd>${valueHtml}</dd>`;
}
// The one AI-authorship badge fragment this script stamps — same markup as
// cross-reference.mjs's aiFlag(), kept local per the standalone-unit
// precedent above.
const AI_BADGE = ` <span class="ai-flag">Written by AI, 2026</span>`;   // hook c187 (the Janitor's D466): the mark says what it means

// Each slot: `build(p)` returns the INNER html for the marker (whatever
// goes between start/end, comment included), or null to render an empty
// marker pair (nothing — the OSW-lesson contract: no value, no row).
const SLOTS = [
  {
    name: "wingheader",
    build(p) {
      // WING HEADING DEDUP (2026-08-18): "ACRO — Full Name", em-dash,
      // acronym first — the kicker's own former order, now the only
      // heading a wing carries. Bare name where full_name is genuinely
      // just the acronym (no-invention rule, as before).
      // L312 (C2/M1, rename-qa-2026-09-06): the h1 shows the registry `name`
      // ONCE.  `full_name` is appended only where it is not already visible
      // inside that name -- L283's wave moved the expansion INTO the name on 97
      // wings ("ADW (All Desert Wrestling)"), which the old `full_name !==
      // p.name` guard could not see, so the h1 read "ADW (All Desert Wrestling)
      // - All Desert Wrestling" and the placard repeated it a third time.  The
      // same containment guard absorbs M1's 77 bare-acronym `full_name`
      // placeholders ("CWF (1996) - CWF") without waiting on the registry
      // correction, and tolerates a `full_name` removed by it.
      //
      // Mirrors cross-reference.mjs's wingLabelFor() by hand: the two run in
      // different Node processes, the same standalone-unit split every other
      // stamper/generator helper pair in this tree already has.
      const wingName = String(p.name ?? "").trim();
      const wingFull = p.full_name == null ? "" : String(p.full_name).trim();
      const showsFull = wingFull && wingFull !== wingName
        && !wingName.toLowerCase().includes(wingFull.toLowerCase());
      const headerText = showsFull
        ? `${esc(wingName)} &mdash; ${esc(wingFull)}`
        : esc(wingName);
      // THE HEADER UNIFICATION WAVE (2026-08-22, the Janitor's gavel: "revert
      // my nits on the promotion header... one style format to rule them
      // all") — a bare <h1>, no class, exactly like every other page type's
      // own title (character/title/award/memorial/instrument pages all use
      // a plain h1; a wing used to be the one page type styled differently,
      // via the now-deleted `.page-heading` CSS override — mono font,
      // smaller scale, uppercase, brass-dim color). One shared header rule,
      // one place in style.css, applies identically everywhere now.
      const h1 = `<h1>${headerText}</h1>`;
      // THE SUBTITLE UNIFICATION (REVIEW-FIXES WAVE, 2026-08-22, the Janitor:
      // the wing tagline must carry the SAME style as every other page
      // type's subtitle line — memorial years, entity aka). The
      // `.page-tagline` muted override is retired outright; one bare
      // `.subtitle` class governs the component sitewide, the h1
      // unification's own precedent one element down.
      const subtitle = p.tagline ? `\n  <p class="subtitle">&ldquo;${esc(p.tagline)}&rdquo;</p>` : "";
      // THE ALIAS LINE (the Janitor review 2026-09-05, UFWS: "used to be PWGeA but no
      // alias for it noted") — the registry's own aka[] rendered as one subtitle
      // line, same component as the tagline; nothing invented, nothing when empty.
      // AKA-TO-PLACARD (the Janitor 2026-09-06): akas are a placard row now (see the
      // wingmedium slot); the subtitle is for the promotion's own tagline only.
      return `\n  ${h1}${subtitle}\n  `;
    },
  },
  {
    name: "wingyears",
    build(p) {
      if (!p.years) return null;
      return metaRow("Ran", esc(p.years)) + "\n      ";
    },
  },
  {
    name: "wingfullname",
    build(p) {
      // L326: the placard's "Full name" row, promoted from hand-authored
      // HTML (no marker owned it -- see wave-C90-L324's diagnosis) to a
      // real slot. Renders under EXACTLY L312's own containment rule
      // (wave-C90-L312/digest.md, "(2) C2 + the placard": render the
      // expansion only when it differs from every string already in the
      // name) -- the identical `showsFull` test `wingheader`'s own h1
      // guard uses, two slots up. Mirrored by hand rather than shared,
      // same standalone-unit precedent as every other slot/generator pair
      // in this tree.
      const wingName = String(p.name ?? "").trim();
      const wingFull = p.full_name == null ? "" : String(p.full_name).trim();
      const showsFull = wingFull && wingFull !== wingName
        && !wingName.toLowerCase().includes(wingFull.toLowerCase());
      if (!showsFull) return null;
      return metaRow("Full name", esc(p.full_name)) + "\n      ";
    },
  },
  {
    name: "wingscale",
    build(p) {
      if (!p.scale) return null;
      return metaRow("Scale", esc(p.scale)) + "\n      ";
    },
  },
  {
    name: "wingmedium",
    build(p) {
      // THE TYPE-AXIS GAVEL (the Janitor, 2026-09-05: "both medium and
      // type"): what the wing IS is a separate axis from the platform it
      // ran on, so a community hub or an interfed alliance says so on its
      // own placard, ahead of Medium — rendered inside this slot so no wing
      // page needs a new marker bootstrapped. A plain federation renders
      // no Type row (the default kind distinguishes nothing, the same
      // reasoning as Discipline below).
      // "tournament" joins the axis at CURATION.md v118 (the Janitor, 2026-09-24):
      // the placard says "independent tournament" and type_note trails it with the
      // longer phrase, exactly as it trails every other type.
      // "academy" joins the axis at CURATION.md v120 (the Janitor, 2026-09-24,
      // "New academy type."): the placard reads "training academy" and
      // type_note trails it with the longer phrase, exactly as tournament does.
      const TYPE_LABELS = { "community-hub": "community hub", "interfed-alliance": "interfed alliance", "tournament": "independent tournament", "academy": "training academy" };
      // THE ECOSYSTEM EXPANSION GAVEL (the Janitor, 2026-09-05; CURATION.md
      // v111(f)) — `type_note` is where a fed that is genuinely two things at
      // once says so, since the axis itself stays exactly one value. It used
      // to TRAIL the type after an em-dash, the way `medium_detail` trails
      // `medium` one row down.
      // IT DOES NOT RENDER ANY MORE (hook c210, 2026-10-09, the Janitor's
      // D466 -> finding C13: "the fwrestling.com 'Type' row is a 90-word
      // sentence with '--'", an essay inside a row of facts). The field stays
      // exactly where it was in the registry — the receipt a curious reader
      // follows, the same place `house_style`'s own verbatim sentence has sat
      // since 2026-08-19 — and the row shows the axis value alone. With the
      // note off the page, a plain `federation` that carries one has nothing
      // left to say that the default does not already say, so it renders no
      // Type row at all, exactly like a federation without one.
      // AKA-TO-PLACARD (the Janitor 2026-09-06): the registry's own aka[] as a
      // labeled placard row ahead of Type/Medium; nothing invented, nothing when empty.
      const akas = Array.isArray(p.aka)
        ? p.aka.filter((a) => typeof a === "string" && a.trim() && a.trim() !== p.name).map(dropIfMarked).filter(Boolean)
        : [];
      const akaRow = akas.length ? metaRow("Also known as", akas.map(esc).join(", ")) + "\n      " : "";
      const typeRow = p.type && p.type !== "federation"
        ? metaRow("Type", esc(TYPE_LABELS[p.type] || p.type)) + "\n      "
        : "";
      // Placards show the taxonomy's human label, never the raw enum token
      // (wing-page audit, 2026-09-05: every wing rendered e.g. "website-efed").
      const MEDIUM_LABELS = { "newsgroup": "Newsgroup", "website": "Website", "forum": "Forum", "bbs": "BBS", "fidonet": "FidoNet", "email": "E-mail", "mail": "Postal mail", "online-service": "Online service", "chat": "Chat", "wiki": "Wiki", "virtual-world": "Virtual world", "video": "Video", "audio": "Audio", "social-media": "Social media", "game": "Video game", "in-person": "In person", "other": "Other medium", "unknown": "Medium unknown" };
      const mediumDetailText = dropIfMarked(p.medium_detail);
      const detail = mediumDetailText ? ` &mdash; ${esc(mediumDetailText)}` : "";
      const FORM_LABELS = { "text": "Text", "figures": "Figures", "avatars": "Avatars", "tabletop": "Tabletop", "sim": "Sim", "other": "Other form", "unknown": "Form unknown" };
      const AUTHORSHIP_LABELS = { "open-fed": "Open fed", "single-author": "Single author", "troupe": "Troupe", "vote-league": "Vote league", "unknown": "Authorship unknown" };
      const formRow = p.form ? metaRow("Form", esc(FORM_LABELS[p.form] || p.form)) + "\n      " : "";
      // THE PLAY ROW BELONGS TO SLOT 5b ALONE (hook c210, 2026-10-09,
      // finding C13: "a duplicated 'Play' label"). This slot used to stamp a
      // second row off the same `play` field, so a wing with a value named
      // Play twice on one placard — the human label here, the raw registry
      // token and its detail a few rows down. The row is gone and the label
      // table went with it, to the slot that carries the detail.
      const authorshipRow = p.authorship ? metaRow("Authorship", esc(AUTHORSHIP_LABELS[p.authorship] || p.authorship)) + "\n      " : "";
      // THE AUTHOR IS CREDITED (hook c237; CURATION v135, #author-credit, the Janitor in chat 2026-10-09): a
      // single-author work is credited to its author on its wing. `author` holds the credit exactly as the registry
      // decided it (the handle the work was posted under, or a real name's first name and last initial); its receipt
      // is `author_source`, which is not rendered. The row follows the Authorship row; no author, no row.
      const authorText = typeof p.author === "string" ? dropIfMarked(p.author.trim()) : "";
      const writtenByRow = authorText ? metaRow("Written by", esc(authorText)) + "\n      " : "";
      const mediumRow = p.medium ? metaRow("Medium", esc(MEDIUM_LABELS[p.medium] || p.medium) + detail) + "\n      " : "";
      // THE ECOSYSTEM EXPANSION GAVEL (the Janitor, 2026-09-05; CURATION.md
      // v111(c)) — the two scene rows.
      //
      // "Language" renders ONLY where `language` is set and is not "en": the
      // field's own default is English by ABSENCE (true of every row held at
      // the gavel, by the accession route each one entered through), and a
      // "Language: English" row on every wing in an English-language museum
      // distinguishes nothing — the Discipline row's reasoning exactly, one
      // axis over. An explicit `language: "en"` on a fed inside a
      // non-English scene is a fact worth STORING and still not worth
      // RENDERING, so it is stored and not rendered.
      //
      // "Community in" is `country`: the REAL-WORLD country of the community
      // that ran the fed. The label is deliberately not "Based in" — that
      // string belongs to `location`, the fed's own STAGED home base, and a
      // Polish fed billing itself from Texas is the normal case rather than
      // an error. Keeping the two labels apart is the whole point of the
      // field. No default: absent means undetermined, so absent renders
      // nothing at all.
      const LANGUAGE_LABELS = { "en": "English", "de": "German", "it": "Italian", "pl": "Polish", "ko": "Korean", "fr": "French", "es": "Spanish", "pt": "Portuguese", "pt-BR": "Portuguese (Brazil)", "ja": "Japanese", "nl": "Dutch", "sv": "Swedish", "da": "Danish", "nb": "Norwegian", "fi": "Finnish", "ru": "Russian", "ar": "Arabic", "tr": "Turkish", "cs": "Czech", "hu": "Hungarian", "el": "Greek", "he": "Hebrew", "hi": "Hindi", "id": "Indonesian", "th": "Thai", "vi": "Vietnamese", "zh-Hans": "Chinese (simplified)", "zh-Hant": "Chinese (traditional)" };
      const COUNTRY_LABELS = { "US": "the United States", "CA": "Canada", "GB": "the United Kingdom", "IE": "Ireland", "AU": "Australia", "NZ": "New Zealand", "ZA": "South Africa", "DE": "Germany", "AT": "Austria", "CH": "Switzerland", "IT": "Italy", "PL": "Poland", "FR": "France", "BE": "Belgium", "ES": "Spain", "MX": "Mexico", "AR": "Argentina", "PT": "Portugal", "BR": "Brazil", "NL": "the Netherlands", "SE": "Sweden", "NO": "Norway", "DK": "Denmark", "FI": "Finland", "RU": "Russia", "KR": "South Korea", "JP": "Japan", "CN": "China", "TW": "Taiwan", "TR": "Turkey", "IN": "India", "PH": "the Philippines", "ID": "Indonesia", "IL": "Israel", "GR": "Greece", "CZ": "Czechia", "HU": "Hungary" };
      const languageRow = p.language && p.language !== "en"
        ? metaRow("Language", esc(LANGUAGE_LABELS[p.language] || p.language)) + "\n      "
        : "";
      const countryRow = p.country
        ? metaRow("Community in", esc(COUNTRY_LABELS[p.country] || p.country)) + "\n      "
        : "";
      return (akaRow + typeRow + mediumRow + formRow + authorshipRow + writtenByRow + languageRow + countryRow) || null;   // hook c237: writtenByRow
    },
  },
  {
    name: "wingdiscipline",
    build(p) {
      // THE DISCIPLINE FACET (the Janitor's ruling, 2026-08-23) — what SPORT
      // the promotion staged, orthogonal to medium and style_family. Renders
      // ONLY where the value is not pro-wrestling: pro-wrestling is the
      // field's own default (and is normally omitted from the data
      // entirely), and "Discipline: pro-wrestling" on every promotion in a
      // wrestling museum is a row that says nothing. Same OSW-lesson
      // contract as every other slot otherwise: no value, no row.
      if (!p.discipline || p.discipline === "pro-wrestling") return null;
      return metaRow("Discipline", esc(p.discipline)) + "\n      ";
    },
  },
  {
    name: "winglocation",
    build(p) {
      // Optional, staging-sourced only — the OSW-lesson contract: no
      // value in the data means NO row, never a placeholder row saying so.
      if (!p.location) return null;
      return metaRow("Based in", esc(p.location)) + "\n      ";
    },
  },
  {
    name: "wingfandom",
    build(p) {
      // THE FANDOM CROSS-CHECK WAVE (the Janitor's directive, 2026-08-24) —
      // an OUTBOUND pointer to this wing's own article on the e-wrestling
      // fandom wiki, where the cross-check confirmed one. The museum links
      // out; it never serves wiki content, and nothing on the far side of
      // this link is a source for anything here: the wiki is secondary and
      // community-authored, and the row's own graded provenance is what
      // this museum stands behind. Same OSW-lesson contract as every other
      // slot: no value, no row — a wing with no article says nothing about
      // not having one.
      // THE HOLDER'S-OWN-SITE LINK-OUT (the Janitor, 2026-09-27: "I feel like
      // we should link to promotions, bios, etc on Argyle's site in the
      // placards"; CURATION.md v124, #holders-site-links) — the wing's own
      // `links_out[]` row renders HERE, inside this existing marker, so no
      // wing page needs a new marker bootstrapped by hand (the same choice
      // the type/scale/medium rows made, see this file's own header note).
      // Both rows are independent: a wing can carry either, both, or neither,
      // and the OSW-lesson contract holds — no value, no row.
      const alsoAt = (p.links_out ?? []).filter((l) => l && l.url && l.label);
      const alsoAtRow = alsoAt.length
        ? metaRow("Also at", `${alsoAt.map((l) => `<a href="${esc(l.url)}" rel="noopener nofollow">${esc(l.label)}</a>`).join(" &middot; ")} <span class="muted small">&mdash; the promotion's own surviving site, linked, not held.</span>`) + "\n      "
        : "";
      if (!p.fandom) return alsoAtRow || null;
      return metaRow("Elsewhere", `<a href="${esc(fandomUrl(p.fandom))}">On the e-wrestling fandom wiki</a> <span class="muted small">&mdash; a community-authored article, linked, not held.</span>`) + "\n      " + alsoAtRow;
    },
  },
  {
    name: "winghousestyle",
    build(p) {
      // A11 (THE HOUSE-STYLE DISPLAY WAVE, 2026-08-19, the Janitor's gavel):
      // the placard now shows the `style_family` FORM ("Angle-Driven/
      // Comedy") rather than the verbatim `house_style` sentence — the
      // the Janitor's own preference, a short navigable label over a full
      // quoted sentence repeated on every wing. The verbatim string stays
      // exactly where it always was (registry data — `house_style` +
      // `house_style_grade`/`house_style_source`, the receipt for a
      // curious reader), just no longer the thing rendered here.
      // `style_family` values are stored in canonical (alphabetical)
      // order (THE HOUSE-STYLE DISPLAY WAVE) so the same two-family
      // combination never renders as inverted twins across promotions
      // (GIWF/IWF both now read "Angle-Driven/Comedy").
      if (!p.style_family || !p.style_family.length) return null;
      // THE HEADER-BADGE CONVENTION (REVIEW-FIXES WAVE, 2026-08-22,
      // the Janitor: the badge sits on a section's own header wherever a whole
      // AI-authored unit has one — "house style headers too"): the House
      // style classification is museum-graded prose work (house_style,
      // graded `presumed`, no human author on record), so its placard
      // label carries the badge. Raw HTML label on purpose — metaRow()
      // escapes, and the badge is markup.
      // QA PASS (the Janitor, 2026-08-22): no badge here — the style-family label
      // is classification, not prose; the badge marks authored prose only.
      // The one row built by hand rather than through metaRow() (its label
      // used to carry the AI badge as raw markup). It is a dt/dd pair too
      // now — hook c210, finding C13's dl; see metaRow() above.
      return `<dt class="k">House style</dt><dd>${esc(p.style_family.join("/"))}</dd>\n      `;
    },
  },
  {
    name: "wingplay",
    build(p) {
      // THE PLAY FACET (the Janitor's ruling, 2026-08-23) — how outcomes
      // were decided (competitive-rp / angled / generated / hybrid /
      // unknown). Renders wherever the field is set, the honest "unknown"
      // included: an explicit unknown records that the question was checked
      // against the promotion's own record and came back empty, which is a
      // fact. `play_detail` trails after an em-dash exactly the way
      // `medium_detail` already trails `medium`.
      // THE ONE PLAY ROW (hook c210, 2026-10-09, finding C13): the human
      // label table came here from slot 4, with the duplicate row it used
      // to stamp. The fallback is the registry token itself, so a value
      // the table has not met yet still shows rather than vanishing.
      const PLAY_LABELS = { "competitive-rp": "Competitive roleplay", "strat": "Strat", "angled": "Angled", "generated": "Generated", "hybrid": "Hybrid play", "booked": "Booked", "blended": "Blended play", "unknown": "Play unknown" };
      if (!p.play) return null;
      const detail = p.play_detail ? ` &mdash; ${esc(p.play_detail)}` : "";
      return metaRow("Play", esc(PLAY_LABELS[p.play] || p.play) + detail) + "\n      ";
    },
  },
  {
    name: "wingcaption",
    build(p) {
      if (!p.caption) return null;
      // THE AI-AUTHORSHIP FLAG (REVIEW-FIXES WAVE, 2026-08-22, the Janitor:
      // promotion-page captions were missing the badge every other
      // caption surface carries) — trailing-badge shape, same as a
      // character caption (inline prose, no header of its own), driven by
      // the same caption_asof.author convention. "ai" and unset both
      // badge (the honest default); "human" renders nothing.
      const badge = p.caption_asof?.author === "human" ? "" : AI_BADGE;
      // THE CHROME I18N STEP (THE ECOSYSTEM EXPANSION GAVEL, 2026-09-05,
      // step 2; CURATION.md v112(c), #caption-en) — a wing that ran in
      // another language carries the museum's label sentence TWICE: once in
      // the scene's own language, marked so a browser reads it correctly,
      // and once in English beside it. Two originals, never a translation of
      // one: the English sibling may legitimately say a different thing
      // where a different thing is the true thing to say to an English
      // reader, and it carries its own authorship flag off its own field
      // (absence means "ai", the caption_asof.author convention exactly).
      // On a wing with no `language` — every wing held at the gavel — both
      // additions render the empty string and this is the line it always was.
      const sceneLang = p.language && p.language !== "en" ? ` lang="${esc(p.language)}"` : "";
      const enBadge = p.caption_en_author === "human" ? "" : AI_BADGE;
      const enLine = p.caption_en
        ? `<span class="caption-en" lang="en">${esc(p.caption_en)}${enBadge}</span>`
        : "";
      return `<p class="lede"${sceneLang}>${esc(p.caption)}${badge}${enLine}</p>\n  `;
    },
  },
  {
    name: "wingtier",
    build(p) {
      // THE WING COLLAPSE WAVE (2026-08-22) — docs/PROCESS.md's own
      // depth-tier ladder, rendered plainly on the placard: "Tier N —
      // Label". The Janitor's rider, verbatim: structural pages are AI-drafted,
      // Janitor-edited before going live — the tier explainer
      // (structure.html) is built and committed this wave but stays
      // UNLINKED until that editing pass, so this row renders as plain
      // text only, never a link, for now; wiring the link is a one-line
      // follow-up once structure.html goes live.
      if (typeof p.tier !== "number") return null;
      // THE TIER LABEL IS WHAT WE HAVE DONE, IN WORDS (the Janitor's D475,
      // 2026-10-09, "both as drafted"): the row said "Tier 2 — Structured",
      // which a visitor had no way to read, and the review's own rename
      // ("how much survives") described the DEPTH label instead. The label
      // is the Janitor's drafted line now — "How far we've got: known to
      // exist / pages collected / shows entered / whole site read" — with
      // the wing's own rung as the value and ONE legend for the whole
      // museum behind it, inside Rule Seven on the Curation page (the
      // sentence that names all three labels sits one line above it).
      // The DEPTH row, "how much of it survived", is a different scale and
      // keeps its own words; this row never was a ranking and still isn't.
      // The apostrophe is the character, not the entity: esc() turns a bare
      // "&" into "&amp;", so "&#8217;" would serve as "&amp;#8217;".
      const HOW_FAR = ["known to exist", "pages collected", "shows entered", "whole site read"];
      // An out-of-ladder tier still renders, under the same key and link: a
      // registry slip belongs on the page, not hidden by a dropped row.
      const words = HOW_FAR[p.tier] ?? `? (tier ${p.tier})`;
      return metaRow("How far we\u2019ve got", `<a href="/curation.html#how-far-weve-got">${esc(words)}</a>`) + "\n      ";
    },
  },
];

const promotions = loadArray("promotions");
let pagesChanged = 0, skipped = 0;
const missingMarkerCounts = Object.fromEntries(SLOTS.map((s) => [s.name, 0]));

for (const p of promotions) {
  if (!p.page) continue;
  const indexPath = resolve(ROOT, p.page.replace(/^\//, ""), "index.html");
  if (!existsSync(indexPath)) { skipped++; continue; }
  let current = readFileSync(indexPath, "utf8");
  let touched = false;

  for (const slot of SLOTS) {
    const startTag = `<!-- ${slot.name}:start -->`;
    const endTag = `<!-- ${slot.name}:end -->`;
    if (!current.includes(startTag)) {
      console.warn(`stamp-promotion-headers: ${p.page}index.html has no ${slot.name} marker yet — skipped (bootstrap it by hand once, see this script's own header comment)`);
      missingMarkerCounts[slot.name]++;
      continue;
    }
    const inner = slot.build(p);
    const block = inner === null ? `${startTag}${endTag}` : `${startTag}${inner}${endTag}`;
    const re = new RegExp(`${startTag}[\\s\\S]*?${endTag}`);
    // hook c228 (2026-10-09): a FUNCTION replacement, so a "$" in registry text is literal (a string replacement read
    // "$$", "$&", "$1".. as patterns: MDW-C's caption "MONEY $$$" served as "$$").
    const patched = current.replace(re, () => block);
    if (patched !== current) { current = patched; touched = true; }
  }

  if (touched) { writeFileSync(indexPath, current); pagesChanged++; }
}

const missingSummary = SLOTS.map((s) => `${missingMarkerCounts[s.name]} missing ${s.name}`).join(", ");
console.log(`stamp-promotion-headers: ${pagesChanged} wing page(s) stamped/changed, ${skipped} wing(s) with no index.html yet (${missingSummary}).`);

// ---------------------------------------------------------------------------
// THE AI-AUTHORSHIP FLAG (2026-08-22) — a wing's own epitaph
// (`<!-- epitaph:start/end -->`) is hand-authored prose, not a JSON field
// this script's own SLOTS mechanism renders from — so its authorship badge
// is driven by a small sibling registry file instead,
// data/promotion-epitaph-authorship.json ({promotion, author}), mechanical
// and idempotent exactly like every other marker patch here: the badge is
// stripped and re-derived fresh on every run, never hand-typed into a wing
// page directly, per the Janitor's own "the marker renders mechanically
// from the field, never hand-inserted."
// ---------------------------------------------------------------------------
{
  const authPath = resolve(DATA, "promotion-epitaph-authorship.json");
  if (existsSync(authPath)) {
    const authRaw = loadArray("promotion-epitaph-authorship");
    const authorByPromo = new Map(authRaw.map((r) => [r.promotion, r.author]));
    // THE HEADER-BADGE CONVENTION (REVIEW-FIXES WAVE, 2026-08-22, the Janitor:
    // "move the epitaph's badge onto the SECTION HEADER itself") — the
    // badge sits inside the epitaph's own <h2> heading, not trailing the
    // prose. Idempotent as ever: every badge inside the marker (heading or
    // legacy trailing line) is stripped, then re-derived fresh onto the
    // heading — never hand-typed into a wing page directly.
    const BADGE_ANYWHERE_RE = /\s*<span class="ai-flag"[^>]*>(?:AI|Written by AI, 2026)<\/span>/g;   // hook c187: either text, so a stale pill is re-stamped once and never doubled
    let epitaphChanged = 0, epitaphMissing = 0;
    for (const p of promotions) {
      if (!p.page) continue;
      const indexPath = resolve(ROOT, p.page.replace(/^\//, ""), "index.html");
      if (!existsSync(indexPath)) continue;
      let current = readFileSync(indexPath, "utf8");
      const startTag = "<!-- epitaph:start -->";
      const endTag = "<!-- epitaph:end -->";
      if (!current.includes(startTag)) { epitaphMissing++; continue; }
      const author = authorByPromo.get(p.id) ?? "ai";
      const re = new RegExp(`(${startTag})([\\s\\S]*?)(${endTag})`);
      const m = current.match(re);
      if (!m) continue;
      let inner = m[2].replace(BADGE_ANYWHERE_RE, "");
      // collapse the whitespace the old standalone trailing badge line left
      inner = inner.replace(/\n[ \t]*\n([ \t]*)$/, "\n$1");
      if (author !== "human") inner = inner.replace(/(<h2[^>]*>[\s\S]*?)(<\/h2>)/, (_w, head, close) => head + AI_BADGE + close);
      if (inner === m[2]) continue;
      // hook c228 (2026-10-09): THE EPITAPH-DOLLAR BUG. This was current.replace(re, `$1${inner}$3`), a STRING
      // replacement, so an epitaph's own "$100" read as "$1"+"00" (a second start marker), "$25" as "$2"+"5" (a whole
      // copy of the old epitaph), "$$" as "$": hook c187's badge change mangled 22 wings, eight of them doubling on
      // every run until the chrome step died ("RangeError: Invalid string length"). A function inserts text literally.
      const patched = current.replace(re, (_w, open, _old, close) => open + inner + close);
      if (patched !== current) { writeFileSync(indexPath, patched); epitaphChanged++; }
    }
    console.log(`stamp-promotion-headers: ${epitaphChanged} wing epitaph AI-flag(s) stamped/changed, ${epitaphMissing} wing(s) with no epitaph marker.`);
  }
}

// ---------------------------------------------------------------------------
// STORYLINES PER-ARC BADGES (REVIEW-FIXES WAVE, 2026-08-22, the Janitor: "EACH
// individual storyline sub-header carries its own AI marker (per-storyline,
// not one badge for the whole section)") — inside a wing's own
// `<!-- storylines:start/end -->` marker (THE WING COLLAPSE WAVE's folded
// recap prose), every <h3> arc heading carries the badge; any legacy
// whole-section trailing badge is stripped. All storylines prose on file is
// AI-recapped today — a future human-written arc would need its own
// authorship registry row before this stamp could spare it, the same shape
// promotion-epitaph-authorship.json already gives the epitaph.
// ---------------------------------------------------------------------------
{
  const BADGE_ANYWHERE_RE = /\s*<span class="ai-flag"[^>]*>(?:AI|Written by AI, 2026)<\/span>/g;   // hook c187: either text, so a stale pill is re-stamped once and never doubled
  let storylinesChanged = 0;
  for (const p of promotions) {
    if (!p.page) continue;
    const indexPath = resolve(ROOT, p.page.replace(/^\//, ""), "index.html");
    if (!existsSync(indexPath)) continue;
    const current = readFileSync(indexPath, "utf8");
    const re = /(<!-- storylines:start -->)([\s\S]*?)(<!-- storylines:end -->)/;
    const m = current.match(re);
    if (!m) continue;
    let inner = m[2].replace(BADGE_ANYWHERE_RE, "");
    inner = inner.replace(/\n[ \t]*\n([ \t]*)$/, "\n$1");
    inner = inner.replace(/(<h3[^>]*>[\s\S]*?)(<\/h3>)/g, (_w, head, close) => head + AI_BADGE + close);
    if (inner === m[2]) continue;
    const patched = current.replace(re, (_w, open, _old, close) => open + inner + close);   // hook c228: a "$" in the prose is literal
    if (patched !== current) { writeFileSync(indexPath, patched); storylinesChanged++; }
  }
  console.log(`stamp-promotion-headers: ${storylinesChanged} wing storylines section(s) re-badged per-arc.`);
}
