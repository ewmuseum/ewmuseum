/**
 * THE MUSEUM — shared fielded query engine (js/query.js).
 *
 * No dependencies, no build step. This is the ONE place the museum's
 * `field:value` query language lives — search.html and every list page
 * (wrestlers, promotions, championships, shows, frontier, roleplays, halls
 * of fame) run the SAME engine now, so a capability search.html has is a
 * capability every list page has, automatically, with nothing hand-wired
 * per page. Consolidates what used to be search.html's own inline
 * flattenFields/parseQuery/predicateMatches/rowMatches, plus the mechanical
 * facet discovery (js/list.js's old fillFilterOptions) folded into a single
 * "pick a field:value pair, it lands in the search box" instrument.
 *
 * THE QUERY LANGUAGE:
 *   - a bare word is a case-insensitive substring match against the row's
 *     own `search` text blob; `-word` (or `-"exact phrase"`) EXCLUDES rows
 *     whose blob contains it (THE NEGATION OPERATOR, 2026-08-22);
 *   - `field:value` narrows to rows whose `field` carries a matching value.
 *     The match rule is SHAPE-based, not per-field-hand-wired (founder
 *     catch: `promotion:iwf` returned 289 wrestlers — IWF, GIWF, and UiWF
 *     blended, because plain substring matching finds "iwf" inside "giwf"
 *     and "uiwf" too): a stored value that LOOKS id-like — a single token,
 *     optionally trailed by one parenthetical qualifier ("iwf", "iwf
 *     (1998)", "website-efed", "bingo-hall") — matches only at exact
 *     value-or-token (word-boundary) precision; a stored value that reads
 *     as prose (multiple bare words, no wrapping parenthetical — a
 *     caption, a `how`, a `notes` sentence) keeps ordinary substring
 *     matching, since partial-word search is exactly what free text wants.
 *     See `isIdLikeValue`/`predicateMatches` below for the actual rule. A
 *     quoted or otherwise space-containing query value always falls back
 *     to substring — quoting a value was always the phrase-search escape
 *     hatch, and stays one.
 *   - `field:"multi word value"` keeps the value's internal spaces
 *     (quote-aware tokenizing — search.html's own placeholder text always
 *     documented this; the tokenizer here is what actually honors it now,
 *     see parseQuery below);
 *   - `field:a|b` matches EITHER value — alternation, split on unquoted
 *     `|`, each alternative matched by the same shape rules as a single
 *     value (a quoted value keeps its `|` literal, the usual phrase escape
 *     hatch) (THE ALTERNATION OPERATOR, 2026-08-22);
 *   - `-field:value` EXCLUDES rows the predicate would match — same
 *     matching rules as the positive form, inverted, alternation included
 *     (`-field:a|b` = neither) (THE NEGATION OPERATOR, 2026-08-22);
 *   - `field:!value` (and `field:!a|b`) is SUGAR for `-field:value` (and
 *     `-field:a|b`) — parsed once, in parsePredicate, so every caller
 *     shares the one negation flag (THE BANG-NEGATION SUGAR, 2026-09-06);
 *   - `field:` (empty value) matches rows where the field is PRESENT with
 *     any value at all; `-field:` matches rows where the field is ABSENT
 *     entirely — the founder's driving case: `staged_gender` is only ever
 *     stamped where a fed's own record staged one (the silent-unknown
 *     doctrine — unknown IS absence), so `-gender:` finds the ungendered
 *     without anyone needing to know how "unknown" is represented (THE
 *     PRESENCE/ABSENCE OPERATORS, 2026-08-22);
 *   - PRESENCE STAYS EXPLICIT (2026-09-06): `field:`/`-field:` always read
 *     off the row's OWN stored data — a row that carries the field with
 *     any value at all is present, one that doesn't is absent — even for
 *     `language`, where an absent field is otherwise treated as English by
 *     the equality match below. `language:` (presence) therefore matches
 *     only the rows that explicitly stamp a `language`, never the
 *     English-by-silent-default rows;
 *   - a numeric field takes a comparator instead of substring matching:
 *     `reigns:>3`, `reigns:>=2`, `opponents:<10`, `class_year:<=2001` —
 *     and date-shaped values participate by their leading year
 *     (parseFloat("2003-12-28") is 2003, so `date:<2004` and `won:>=2003`
 *     behave year-precision-aware for free, a year-only "2003" comparing
 *     identically to any dated day inside 2003);
 *   - `field:2002..2004` is an inclusive numeric range — sugar over the
 *     comparator pair, same parseFloat rule, so date fields range by year
 *     (THE RANGE OPERATOR, 2026-08-22);
 *   - `language:`/`country:` match by ISO CODE OR NAME — a stored `pl`
 *     matches `language:pl`, `language:polish`, and `language:polski`
 *     alike, case-insensitively (LANG_NAMES/COUNTRY_NAMES below; a plain
 *     table, meant to grow) (THE LANGUAGE/COUNTRY NAME MATCH, 2026-09-06);
 *   - IMPLICIT ENGLISH (2026-09-06, schema ruling 4 —
 *     schema-amendment-rulings-2026-09-05.md: "`language` defaults to `en`
 *     by absence; `country` has no default"): a row with no `language`
 *     field is treated as `en` for this equality match only — so
 *     `language:english` matches it, and `language:!english`
 *     (`-language:english`) excludes it — but NOT for presence, which
 *     stays explicit (see above); `country` has no such default, so an
 *     absent `country` simply fails an equality predicate, same as any
 *     other missing field;
 *   - every predicate is ANDed together, and against every bare word.
 *
 * FIELD DISCOVERY, TWO SHAPES:
 *   - flattenFields(obj) walks an arbitrary registry JSON record (any
 *     depth — an array of sub-objects has ITS OWN keys folded up too) into
 *     a flat { field: [values] } map. A new field the data grows tomorrow
 *     is queryable tomorrow, with nothing hand-wired here for it. Used by
 *     pages that filter over freshly-fetched JSON (promotions, titles,
 *     shows, frontier, roleplays, inductions).
 *   - fieldsFromElement(el) does the same job for a row that's already a
 *     rendered DOM node (a .roster-card cross-reference.mjs baked, or an
 *     <li> a page's own script built) — every `data-*` attribute becomes a
 *     field, generically, with no attribute name hand-wired here either
 *     (except the tiny alias table below, which exists only so a legacy
 *     attribute name like `data-promo` reads as the same `promotion` field
 *     search.html already established, not to single out any one page).
 *     Used by wrestlers.html/shows.html, which render server-cheap DOM
 *     first and filter/window over what's already on the page.
 *
 * THE FILTER TYPEAHEAD (founder's own words, on the earlier value-
 * enumerating version: "should just be limited to the things you can
 * filter on, not the values... `awards:` or maybe `awards: {integer}`...
 * the more durable path"): wireFacetFilter mechanically enumerates every
 * FIELD NAME a page's rows carry — never a value — and offers each as a
 * "field:" stub through a <datalist>, labeled with a type hint mechanically
 * read off that field's own values ({integer} when every value on file is
 * a whole number, {text} otherwise). Picking one doesn't filter anything
 * itself — it inserts the "field:" token into the search box, which is the
 * ONLY state a list page carries, and leaves the value to be typed. Two
 * controls, total, on every list page: the search box and this discovery
 * aid over it. This supersedes the earlier facet-VALUE caps entirely — the
 * value-enumeration machinery is gone from the typeahead; queryability
 * itself is unchanged, since every field:value pair this used to suggest
 * still works exactly the same typed by hand.
 *
 * THE COMMON VALUES UNDER EACH FIELD (2026-10-03, the Impeccable critique's
 * heuristic 6: "the filter list shows field names but never their values" —
 * a visitor who has to already know that `medium` holds "newsgroup" is being
 * asked to recall, not to recognise). Every field stub above is unchanged
 * and still comes first; what is added under each one is a handful of that
 * field's own MOST COMMON values, as complete `field:value` tokens, counted
 * off the page's own rows at wire time. It is not the old capped
 * enumeration: nothing is kept by hand, a field whose values are all
 * numbers offers none (a comparator is something to type), and a value with
 * a space in it offers none (a quoted phrase is too). See commonFieldValues
 * below for the whole rule. THIS AMENDS A STANDING DIRECTIVE — if the
 * Janitor's words above are meant to rule values out of the typeahead
 * altogether, FACET_VALUES_PER_FIELD = 0 restores the field-stub-only list
 * with nothing else to unpick.
 *
 * ONE DOCUMENTATION SPOT, MECHANICALLY GENERATED (founder directive: "a
 * list of all of the fields it accepts searches on"): renderFieldHelp()
 * builds the one <details> block every page (list pages and search.html
 * alike) renders under its search box — same syntax prose everywhere,
 * plus a field LIST generated from that page's own rows at render time
 * (allFieldNames()), never hand-typed. search.html groups its reference by
 * entity type (Wrestlers/Promotions/Shows/...); a list page passes one
 * unnamed group, which is the natural caveat the founder asked for — a
 * page only ever documents the fields it actually carries.
 *
 * NO SILENT ZEROS: unknownFieldNote() is the other half of the same
 * mechanical field discovery — when a query names a field:value the
 * current page's rows carry NO SUCH FIELD for at all (as opposed to a
 * field it has but this particular value doesn't match), the empty result
 * says so in one plain line instead of just reading "0 shown."
 */
(function (global) {
  "use strict";

  // ---------------------------------------------------------------------
  // MECHANICAL FIELD DISCOVERY — see file header. Identical in spirit to
  // search.html's original inline version (this IS that version, moved).
  // ---------------------------------------------------------------------
  function flattenFields(obj, out) {
    out = out || Object.create(null);
    if (!obj || typeof obj !== "object") return out;
    Object.keys(obj).forEach(function (k) {
      if (k.charAt(0) === "_" || k === "id") return;
      var v = obj[k];
      if (v === null || v === undefined) return;
      if (Array.isArray(v)) {
        if (v.length && typeof v[0] === "object") {
          v.forEach(function (item) { flattenFields(item, out); });
        } else if (v.length) {
          out[k] = (out[k] || []).concat(v.map(String));
        }
      } else if (typeof v === "object") {
        // THE FOUNDING-EDGES WAVE (2026-08-21): a nested object shaped
        // like the registry's own standard date object ({date, precision,
        // source} — shows.json's own `date`, reigns.json's `won`/`lost`,
        // promotions.json's new `founded`/`closed`) ALSO exposes its own
        // PARENT key as a field, valued at the date string — additive,
        // never instead of: the existing unprefixed recursion below still
        // runs too, so `date:`/`precision:`/`source:` keep matching
        // exactly as they always have. This is what makes `founded:`/
        // `closed:` distinct, queryable field names instead of both
        // collapsing into the same generic `date:` field every other
        // date-shaped object already shares — general (keyed off SHAPE,
        // not a hand-typed field-name list), so any future {date,...}
        // nested field gets the same treatment for free.
        if (typeof v.date === "string") {
          out[k] = (out[k] || []).concat([v.date]);
        }
        flattenFields(v, out);
      } else {
        out[k] = (out[k] || []).concat([String(v)]);
      }
    });
    return out;
  }

  // A small, fixed alias table — NOT a per-page hand-wiring list, a single
  // sitewide convention: an attribute named `data-promo` (the roster-card/
  // archive-list convention, predating this file) reads as field
  // "promotion" everywhere, matching search.html's own join field of the
  // same name, so `promotion:uwf` types identically on every page.
  var ATTR_FIELD_ALIASES = { promo: "promotion", "staged-gender": "staged_gender" };

  // THE SLIM-INDEX WAVE (2026-10-03) — the same mechanical read, one step
  // earlier: over a plain {name: value} map of what WOULD have been the
  // row's data-* attributes, instead of a live element's own. An instrument
  // page that builds a row only when the visitor actually scrolls to it has
  // no element to read at the moment the query runs, so its index carries
  // the map and this reads it. fieldsFromElement() below is a thin adapter
  // over this one now, so the DOM path and the index path can never drift.
  function fieldsFromAttrMap(map) {
    var out = Object.create(null);
    if (!map) return out;
    var names = Object.keys(map);
    for (var i = 0; i < names.length; i++) {
      var key = names[i];
      if (key === "search") continue; // reserved for the plain-word blob
      var raw = map[key];
      if (raw === null || raw === undefined || raw === "") continue;
      raw = String(raw);
      key = ATTR_FIELD_ALIASES[key] || key;
      // roster-card/archive-list convention for a multi-value attribute:
      // pipe-delimited ("uwf (2001) | iwf (1998)"); anything else is a
      // single value.
      var vals = raw.indexOf("|") !== -1
        ? raw.split("|").map(function (s) { return s.trim(); }).filter(Boolean)
        : [raw];
      if (!vals.length) continue;
      out[key] = (out[key] || []).concat(vals);
    }
    return out;
  }

  function fieldsFromElement(el) {
    var map = Object.create(null);
    var attrs = el.attributes;
    for (var i = 0; i < attrs.length; i++) {
      var name = attrs[i].name;
      if (name.slice(0, 5) !== "data-") continue;
      map[name.slice(5)] = attrs[i].value;
    }
    return fieldsFromAttrMap(map);
  }

  // ---------------------------------------------------------------------
  // QUERY PARSING
  // ---------------------------------------------------------------------
  // Query-side field aliases — the tiny, sitewide-conventional counterpart
  // of ATTR_FIELD_ALIASES below: `gender:` reads as the registry's own
  // `staged_gender` field everywhere (the stored name carries the
  // staged-not-real doctrine; the typed name is what a person reaches for).
  var FIELD_QUERY_ALIASES = { gender: "staged_gender" };

  // LANGUAGE / COUNTRY NAME TABLES (2026-09-06) — a plain table, meant to
  // grow: each ISO code maps to the names (English, then native/local,
  // plus an unaccented spelling where the native form carries diacritics
  // someone might not type) that should ALSO match it, so
  // `language:polish`, `language:polski`, and `language:pl` all find the
  // same stored "pl". An ISO code with no entry here still matches on its
  // own code, exactly as before — the table only widens what ALSO
  // matches, never narrows what already did.
  var LANG_NAMES = {
    en: ["english", "anglais"],
    pl: ["polish", "polski"],
    it: ["italian", "italiano"],
    de: ["german", "deutsch"],
    fr: ["french", "français", "francais"],
    es: ["spanish", "español", "espanol"],
    pt: ["portuguese", "português", "portugues"],
    ja: ["japanese", "日本語"],
    ko: ["korean", "한국어"],
    ar: ["arabic", "العربية"],
    zh: ["chinese", "中文"]
  };
  // COUNTRY_NAMES: the codes the ecosystem-expansion step-3 plan names
  // (schema-amendment-rulings-2026-09-05.md ruling 4: `country` has no
  // default the way `language` does — this table only helps MATCHING,
  // it never invents a value for an absent field).
  var COUNTRY_NAMES = {
    pl: ["poland", "polska"],
    it: ["italy", "italia"],
    de: ["germany", "deutschland"],
    fr: ["france"],
    es: ["spain", "españa", "espana"],
    pt: ["portugal"],
    br: ["brazil", "brasil"],
    jp: ["japan"],
    kr: ["korea"],
    us: ["united states", "usa"],
    ca: ["canada"],
    gb: ["united kingdom", "uk", "great britain", "britain"],
    au: ["australia"],
    mx: ["mexico", "méxico"]
  };
  function nameTableFor(field) {
    if (field === "language") return LANG_NAMES;
    if (field === "country") return COUNTRY_NAMES;
    return null;
  }
  // Resolves a language/country VALUE OR QUERY NEEDLE (a stored ISO code,
  // its English name, or its native name — case-insensitively) to the
  // stored CODE, so every spelling of the same language/country compares
  // equal to every other. Anything the table doesn't know (an ISO code
  // with no entry yet, or literally any other string) resolves to itself,
  // unmatched except against an identical spelling — the table only needs
  // entries for the codes the house cares to name, never a hand-wired
  // list of every ISO code that could ever appear.
  function resolveLangCountry(table, raw) {
    var lower = String(raw == null ? "" : raw).toLowerCase();
    if (table[lower]) return lower;
    for (var code in table) {
      if (table[code].indexOf(lower) !== -1) return code;
    }
    return lower;
  }

  function parsePredicate(token) {
    var m = token.match(/^([A-Za-z_][\w-]*):(.*)$/);
    if (!m) return null;
    var field = m[1].toLowerCase();
    field = FIELD_QUERY_ALIASES[field] || field;
    var rest = m[2];
    // `field:!value` (and `field:!a|b`) SUGAR (2026-09-06) — see the file
    // header, beside THE NEGATION OPERATOR. Identical to `-field:value`;
    // stripped here, once, so every predicate shape below (present,
    // comparator, range, equality/alternation) shares the one `negate`
    // flag with the leading-`-` form parseQuery already handles.
    var bangNegate = rest.charAt(0) === "!";
    if (bangNegate) rest = rest.slice(1);
    var pred;
    // `field:` — empty value — is the PRESENCE predicate (the field exists
    // with any value); its negation (a leading `-`, or `field:!`) is
    // absence. See the header.
    if (!rest) {
      pred = { field: field, op: "present" };
    } else {
      var opMatch = rest.match(/^(>=|<=|>|<)(.+)$/);
      if (opMatch) {
        pred = { field: field, op: opMatch[1], value: opMatch[2] };
      } else {
        // `field:2002..2004` — inclusive numeric range (dates by leading year).
        var rangeMatch = rest.match(/^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/);
        if (rangeMatch) {
          pred = { field: field, op: "..", lo: parseFloat(rangeMatch[1]), hi: parseFloat(rangeMatch[2]) };
        } else {
          var quoted = rest.match(/^"(.*)"$/);
          // Alternation: unquoted `a|b` is either-of; a quoted value keeps
          // its own `|` literal. `values` is always the array
          // predicateMatches runs.
          var values = quoted ? [quoted[1]] : rest.split("|").filter(Boolean);
          pred = values.length
            ? { field: field, op: ":", value: values[0], values: values }
            : { field: field, op: "present" };
        }
      }
    }
    if (bangNegate) pred.negate = true;
    return pred;
  }

  // Whitespace-splits EXCEPT inside a "..." span, so `field:"multi word
  // value"` survives as one token instead of shattering on its own
  // internal spaces (the one real behavior fix this extraction makes —
  // search.html's placeholder text always documented quoted values working
  // this way; the plain split(/\s+/) it shipped with never actually
  // honored them).
  var TOKEN_RE = /[^\s"]+"[^"]*"|"[^"]*"|[^\s]+/g;
  function parseQuery(raw) {
    var tokens = String(raw || "").trim().match(TOKEN_RE) || [];
    var predicates = [], words = [], notWords = [];
    tokens.forEach(function (t) {
      // THE NEGATION OPERATOR: a leading `-` inverts whatever the rest of
      // the token is — a predicate (`-field:value`, `-field:`), or a bare
      // word/quoted phrase. A lone "-" stays an ordinary word.
      var negate = t.length > 1 && t.charAt(0) === "-";
      var body = negate ? t.slice(1) : t;
      var p = parsePredicate(body);
      if (p) {
        if (negate) p.negate = true;
        predicates.push(p);
        return;
      }
      var quoted = body.match(/^"(.*)"$/);
      var word = (quoted ? quoted[1] : body).toLowerCase();
      if (!word) return;
      (negate ? notWords : words).push(word);
    });
    return { predicates: predicates, words: words, notWords: notWords };
  }

  // A stored value "looks id-like" when it's a single token optionally
  // trailed by one parenthetical qualifier — "iwf", "iwf (1998)",
  // "website-efed", "Angle-Driven/Comedy", "2001". Anything with a second
  // bare word outside parens ("Pinned Crow in singles competition") reads
  // as prose instead. Shape of the VALUE, never the field's name — the
  // same field can hold id-like values on one row and prose on another
  // (unlikely in practice, but the rule doesn't have to assume otherwise).
  var ID_LIKE_VALUE_RE = /^[^\s(]+(\s*\([^)]*\))?$/;
  function isIdLikeValue(v) { return ID_LIKE_VALUE_RE.test(v); }

  function valueMatches(v, needle, field) {
    // THE EXACT WING (hook c169, adversarial review 2026-10-09, finding B02): `field:=value` matches the
    // stored value and nothing else. The wing filter needed it. Every indexed row's `promotion` field carries
    // BOTH halves of a wing's identity, pipe-delimited -- its acronym label ("pcw (2000)") and its own id
    // ("pcw") -- because a visitor who types `promotion:pcw` means the acronym. But an acronym is not unique:
    // three wings read PCW, six read CWF, and the whole-token rule below matches the acronym's own head, so
    // /promotions/pcw/'s "All shows" listed another PCW's shows and its "All characters" returned 1,126 where
    // 1,002 are its own. The acronym is genuinely ambiguous, so no change to the rules below can tell those
    // wings apart; only the id can. A wing's own "Browse live" link therefore asks for the id exactly
    // (?promo=<id> seeds `promotion:=<id>`), and a typed `promotion:<acronym>` answers as it always has.
    // Checked before the name tables and before every rule below: an exact ask is exact.
    if (needle.charAt(0) === "=") return v.toLowerCase() === needle.slice(1);
    var table = field && nameTableFor(field);
    if (table) {
      // LANGUAGE/COUNTRY NAME MATCH (2026-09-06) — code-or-name, either
      // side: both the stored value and the typed needle resolve to the
      // same code before comparing, so `pl`/`polish`/`polski` are all the
      // same needle against a stored `pl`.
      return resolveLangCountry(table, v) === resolveLangCountry(table, needle);
    }
    var vLower = v.toLowerCase();
    if (/\s/.test(needle) || !isIdLikeValue(v)) {
      return vLower.indexOf(needle) !== -1; // prose, or an explicit quoted phrase
    }
    // id-like/short value: exact-or-word-boundary only, never a bare
    // substring — this is what keeps promotion:iwf from also catching
    // "giwf (1999)"/"uiwf (2010)" (both contain "iwf" as a substring,
    // neither as a whole token).
    if (vLower === needle) return true;
    // SLUG IDS MATCH WHOLE (2026-10-02, the Janitor: "if I click on a
    // promotion's live holdings ... I'm going to exclusively see that one
    // promotion" — /championships.html?promo=pcw also listed
    // pcw-paradise-2005, pcw-parliament-city-2001 and six more, because
    // the word split below broke "pcw-paradise-2005" into pcw/paradise/
    // 2005). A stored value whose head is a record-id slug — lowercase
    // letters/digits joined by hyphens — is ONE token: only the whole
    // slug matches (plus the words of a trailing parenthetical qualifier,
    // so "iwf (1998)" still answers iwf and 1998). The same fix keeps
    // promotion:iwf from also answering stw-iwf-1997, iwf-wow-1997 and
    // the other IWF-named feds. A query value with a space in it still
    // falls back to substring matching, as above.
    var slugHead = v.replace(/\s*\([^)]*\)\s*$/, "");
    if (SLUG_ID_RE.test(slugHead)) {
      if (slugHead.toLowerCase() === needle) return true;
      var qual = v.match(/\(([^)]*)\)\s*$/);
      return !!qual && qual[1].toLowerCase().split(/[^a-z0-9]+/).indexOf(needle) !== -1;
    }
    var tokens = vLower.split(/[^a-z0-9]+/).filter(Boolean);
    return tokens.indexOf(needle) !== -1;
  }
  var SLUG_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

  // NOTE ON NEGATION: this returns the POSITIVE answer only — rowMatches()
  // owns the `pred.negate` inversion, so `-field:value` keeps exactly the
  // matching rules of the positive form, and `-field:` (a negated
  // "present") is absence, with no second code path for either.
  function predicateMatches(fields, pred) {
    var vals = (fields || {})[pred.field];
    if (pred.op === "present") return !!(vals && vals.length);
    if (!vals || !vals.length) {
      // IMPLICIT ENGLISH (2026-09-06) — see file header. A row that
      // carries no `language` field at all still participates in the
      // equality match (`language:english`, `language:!english`) as if
      // stamped "en"; presence/absence above already returned, so this
      // never touches `language:`/`-language:` (presence stays explicit).
      // `country` has no such default (schema ruling 4) — an absent
      // `country` predicate just fails to match, as before.
      if (pred.field === "language" && pred.op === ":") {
        vals = ["en"];
      } else {
        return false;
      }
    }
    if (pred.op === ":") {
      var needles = (pred.values || [pred.value]).map(function (s) { return s.toLowerCase(); });
      return vals.some(function (v) {
        return needles.some(function (needle) { return valueMatches(v, needle, pred.field); });
      });
    }
    if (pred.op === "..") {
      return vals.some(function (v) {
        var n = parseFloat(v);
        return !isNaN(n) && n >= pred.lo && n <= pred.hi;
      });
    }
    var target = parseFloat(pred.value);
    if (isNaN(target)) return false;
    return vals.some(function (v) {
      var n = parseFloat(v);
      if (isNaN(n)) return false;
      if (pred.op === ">") return n > target;
      if (pred.op === "<") return n < target;
      if (pred.op === ">=") return n >= target;
      return n <= target; // "<="
    });
  }

  // row: { search: "lowercased plain-word blob", fields: {field: [values]} }
  function rowMatches(row, parsed) {
    for (var i = 0; i < parsed.predicates.length; i++) {
      var pred = parsed.predicates[i];
      var hit = predicateMatches(row.fields, pred);
      if (pred.negate ? hit : !hit) return false;
    }
    var hay = row.search || "";
    for (var j = 0; j < parsed.words.length; j++) {
      if (hay.indexOf(parsed.words[j]) === -1) return false;
    }
    var notWords = parsed.notWords || [];
    for (var k = 0; k < notWords.length; k++) {
      if (hay.indexOf(notWords[k]) !== -1) return false;
    }
    return true;
  }

  function isEmptyQuery(parsed) {
    return !parsed.predicates.length && !parsed.words.length && !(parsed.notWords || []).length;
  }

  // ---------------------------------------------------------------------
  // FACET DISCOVERY + THE FILTER TYPEAHEAD
  // ---------------------------------------------------------------------

  // fieldsList: array of {field: [values]} maps (one per row/element).
  // Returns [{field, type}], sorted by field name — FIELDS ONLY, never a
  // value (see the file header). `type` is a shape-derived hint, mechanical
  // and two-valued: "integer" when every value on file for that field
  // parses as a whole number, "text" otherwise (a field with no values at
  // all — shouldn't happen, since a field only exists because some row
  // carried it — falls back to "text").
  function fieldValueType(values) {
    if (!values || !values.length) return "text";
    for (var i = 0; i < values.length; i++) {
      if (!/^-?\d+$/.test(values[i])) return "text";
    }
    return "integer";
  }
  // A page's own rows, counted: field -> { value: how many rows carry it }.
  // One traversal, at wire time, shared by the typeahead below and by the
  // wing hint — neither re-walks the rows on a keystroke.
  function buildValueIndex(fieldsList) {
    var byField = Object.create(null);
    (fieldsList || []).forEach(function (fields) {
      if (!fields) return;
      Object.keys(fields).forEach(function (field) {
        var counts = byField[field] || (byField[field] = Object.create(null));
        var seen = Object.create(null);
        (fields[field] || []).forEach(function (v) {
          if (!v || seen[v]) return;
          seen[v] = true;
          counts[v] = (counts[v] || 0) + 1;
        });
      });
    });
    return byField;
  }

  // THE COMMON VALUES UNDER EACH FIELD — see the file header. The thresholds
  // are the whole rule, and they are deliberately conservative: a value only
  // appears if a visitor could have picked it out of the page themselves.
  var FACET_VALUES_PER_FIELD = 8;   // "common", by how many rows carry it
  var FACET_VALUE_MAX_LEN = 28;     // longer than this reads as prose in a one-line list
  var FACET_VALUE_MIN_SUPPORT = 2;  // never offer a filter that finds exactly one row
  // ONE FIELD IS HELD BACK BY NAME, and it is a care decision rather than a
  // shape one: `memorial` carries the name of a person the museum names on
  // their own memorial page and on their characters' cards, deliberately and
  // once each. A name is not a dropdown entry. (Every such name on file today
  // has a space in it and would be held back by the rule below anyway; this
  // is here so that stays true of the next one too.)
  var FACET_VALUE_SKIP_FIELDS = { memorial: true };
  // THE CLOSED-SET RULE, and it is the museum's own law doing the work rather
  // than a taste call. A field either holds a CLOSED SET of its own values
  // (kind, medium, roles, nature, status, portrayal — a vocabulary the
  // registry defines) or it holds a REFERENCE to another entity (promotion,
  // participant, holder, who, show, title, opponent, recipient — a name).
  // Offering the "most common" references would put the eight biggest
  // collections in front of every visitor on the page, which is exactly what
  // flat-and-fair indexes exist to prevent, and it would fail the
  // 500-promotion test (CLAUDE.md invariant 8) the day a 500th wing lands.
  // A page's own row count tells the two apart without naming a single field:
  // a closed set stays small however much lands, a reference set grows with
  // the registry. Over this many distinct values, only the "field:" stub is
  // offered — which is what the reference fields had before, and the wing
  // hint is how `promotion:` gets introduced instead.
  var FACET_VALUE_MAX_DISTINCT = 60;
  function commonFieldValues(counts, field) {
    if (field && FACET_VALUE_SKIP_FIELDS[field]) return [];
    if (Object.keys(counts || Object.create(null)).length > FACET_VALUE_MAX_DISTINCT) return [];
    var out = [];
    Object.keys(counts || Object.create(null)).forEach(function (v) {
      if (/\s/.test(v) || v.length > FACET_VALUE_MAX_LEN) return;
      if (/^-?\d+$/.test(v)) return;     // a number takes a comparator, not a pick
      if (/^\d{4}-\d{2}(-\d{2})?$/.test(v)) return; // and so does a date
      if (counts[v] < FACET_VALUE_MIN_SUPPORT) return;
      out.push(v);
    });
    out.sort(function (a, b) {
      return counts[b] - counts[a] || (a < b ? -1 : a > b ? 1 : 0);
    });
    return out.slice(0, FACET_VALUES_PER_FIELD);
  }

  // THE WING HINT (2026-10-03, the Impeccable critique's P1: "a bare fed name
  // only searches character names... their UWF spans three wings that neither
  // page shows"). A visitor who types a wing's acronym on its own has almost
  // always come looking for that wing's rows, and gets the rows whose own text
  // happens to carry those letters instead. The page states the one fact it
  // knows — that the word is also a wing it holds — and offers the token. It
  // never silently rewrites the query: a bare word stays a bare word.
  //
  // `valueIndex` is buildValueIndex's output; the match is against the page's
  // own `promotion` values at exact precision, so a wing with no rows on this
  // page is never offered. opts: { showing, plural } — the page's own words
  // ("names with" / "characters").
  var WING_WORD_RE = /^[a-z0-9][a-z0-9.-]{1,23}$/;
  function wingHint(parsed, valueIndex, opts) {
    if (!parsed || parsed.predicates.length !== 0) return "";
    if (parsed.words.length !== 1 || (parsed.notWords || []).length) return "";
    var word = parsed.words[0];
    if (!WING_WORD_RE.test(word)) return "";
    var promos = (valueIndex || Object.create(null))["promotion"];
    if (!promos || !promos[word]) return "";
    opts = opts || {};
    // An acronym is spoken as an acronym; a longer id stays as it is written.
    var display = /^[a-z]{2,6}$/.test(word) ? word.toUpperCase() : word;
    var token = "promotion:" + word;
    return "Showing " + escHtml(opts.showing || "rows with") + " \u201c" + escHtml(word) + "\u201d. Try " +
      '<button type="button" class="query-chip query-chip--token" data-q="' + escHtml(token) + '">' + escHtml(token) + "</button>" +
      " for " + escHtml(display) + "\u2019s " + escHtml(opts.plural || "rows") + ".";
  }

  function buildFieldFacets(fieldsList) {
    var byField = Object.create(null);
    (fieldsList || []).forEach(function (fields) {
      if (!fields) return;
      Object.keys(fields).forEach(function (field) {
        var arr = byField[field] || (byField[field] = []);
        (fields[field] || []).forEach(function (v) { if (v) arr.push(v); });
      });
    });
    return Object.keys(byField).sort().map(function (field) {
      return { field: field, type: fieldValueType(byField[field]) };
    });
  }

  // The token a pick inserts is always just "field:" — a stub, never a
  // value, left for the person to finish typing.
  function formatToken(field) {
    return field + ":";
  }

  // Wires a filter-typeahead <input list="datalistEl's id"> so picking a
  // mechanically-discovered FIELD (never a value — see the file header)
  // APPENDS its "field:" stub to searchInput's own value (the ONLY state a
  // list page carries) instead of filtering anything on its own, then
  // clears itself and re-fires searchInput's own "input" listeners.
  // `fieldsList` is computed once at wire time — callers with rows that
  // change shape at runtime (there are none today) would need to re-wire,
  // same contract fillFilterOptions always had.
  function wireFacetFilter(filterInput, datalistEl, fieldsList, searchInput, valueIndex) {
    if (!filterInput || !datalistEl || !searchInput) return;
    var byLabel = Object.create(null);
    var values = valueIndex || buildValueIndex(fieldsList);
    buildFieldFacets(fieldsList).forEach(function (t) {
      var label = t.field + ": {" + t.type + "}";
      byLabel[label] = formatToken(t.field);
      var opt = document.createElement("option");
      opt.value = label;
      datalistEl.appendChild(opt);
      // THE COMMON VALUES UNDER EACH FIELD — the field's own stub first, then
      // its handful of complete tokens, so typing part of a field name still
      // surfaces the field itself before any of its values.
      commonFieldValues(values[t.field], t.field).forEach(function (v) {
        var token = t.field + ":" + v;
        if (byLabel[token]) return;
        byLabel[token] = token;
        var o = document.createElement("option");
        o.value = token;
        datalistEl.appendChild(o);
      });
    });
    filterInput.addEventListener("input", function () {
      var picked = byLabel[filterInput.value];
      if (!picked) return; // still typing — not yet an exact datalist pick
      var current = searchInput.value.trim();
      searchInput.value = current ? current + " " + picked : picked;
      filterInput.value = "";
      searchInput.dispatchEvent(new Event("input"));
      searchInput.focus();
    });
  }

  // ---------------------------------------------------------------------
  // ONE DOCUMENTATION SPOT — see file header. Escapes text content the
  // small, local way (this file has no other need of list.js's own esc()
  // and shouldn't gain a dependency on it just for this).
  // ---------------------------------------------------------------------
  function escHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Every field name appearing across a fieldsList (same input shape as
  // buildFieldFacets — one {field: [values]} map per row), sorted.
  function allFieldNames(fieldsList) {
    var seen = Object.create(null);
    (fieldsList || []).forEach(function (fields) {
      if (!fields) return;
      Object.keys(fields).forEach(function (k) { seen[k] = true; });
    });
    return Object.keys(seen).sort();
  }

  // Renders the one shared "Fields this page can search" reference block
  // into `container` (any element — an unobtrusive collapsed <details>,
  // so it documents without narrating). `groups`: [{name, fields}] — a
  // single entry with a falsy `name` renders flat (an ordinary list
  // page's own fields); more than one, or a named single one, renders
  // each under its own heading (search.html's per-entity-type reference).
  // `opts.moreHref`/`opts.moreLabel` (optional): an extra line pointing at
  // the one complete reference (search.html) — omitted on search.html
  // itself, since it IS that reference.
  function renderFieldHelp(container, groups, opts) {
    if (!container) return;
    opts = opts || {};
    groups = (groups || []).filter(function (g) { return g && g.fields && g.fields.length; });
    // THE SEARCH-HELP LINK (2026-08-22, founder: "you can access the
    // documentation from all searches without hunting around") — one small,
    // always-visible line, rendered here so EVERY search surface that
    // renders field help carries it identically, nothing wired per page.
    var html = '<p class="muted small"><a href="/search-help.html">Search syntax</a></p>' +
      '<details class="field-help">' +
      "<summary>Fields this page can search</summary>" +
      '<p class="muted small">A plain word matches names as a substring. ' +
      "<code>field:value</code> narrows the same match to one field &mdash; " +
      "wrap a multi-word value in quotes, e.g. " +
      '<code>opponent:&quot;al crud&quot;</code>. A numeric field also takes ' +
      "<code>&gt;</code>, <code>&lt;</code>, <code>&gt;=</code>, <code>&lt;=</code> " +
      "(<code>reigns:&gt;3</code>) and ranges (<code>year:2002..2004</code>). " +
      "<code>a|b</code> matches either value; a leading <code>-</code> excludes " +
      "(<code>-word</code>, <code>-field:value</code>); bare <code>field:</code> " +
      "matches the field present, <code>-field:</code> absent. " +
      'Full reference: <a href="/search-help.html">search syntax</a>.</p>';
    if (!groups.length) {
      html += '<p class="muted small">No queryable fields on this page yet.</p>';
    } else if (groups.length === 1 && !groups[0].name) {
      html += '<p class="muted small">Fields here: ' +
        groups[0].fields.map(function (f) { return "<code>" + escHtml(f) + "</code>"; }).join(" ") +
        "</p>";
    } else {
      groups.forEach(function (g) {
        html += '<p class="muted small"><strong>' + escHtml(g.name) + ":</strong> " +
          g.fields.map(function (f) { return "<code>" + escHtml(f) + "</code>"; }).join(" ") +
          "</p>";
      });
    }
    if (opts.moreHref) {
      html += '<p class="muted small">Full search: <a href="' + escHtml(opts.moreHref) + '">' +
        escHtml(opts.moreLabel || opts.moreHref) + "</a></p>";
    }
    html += "</details>";
    container.innerHTML = html;
  }

  // NO SILENT ZEROS — see file header. `parsed` is a parseQuery() result;
  // `knownFields` the page's own allFieldNames() list. Returns "" when
  // every predicate names a field the page actually carries (an ordinary
  // zero-value-match empty result stays silent, per standing doctrine —
  // this is only for the actionable case: the field itself doesn't exist
  // here). One line, plain, factual — no apology, no machinery narrated.
  function unknownFieldNote(parsed, knownFields, opts) {
    if (!parsed || !parsed.predicates || !parsed.predicates.length) return "";
    opts = opts || {};
    var known = Object.create(null);
    (knownFields || []).forEach(function (f) { known[f] = true; });
    var unknown = [], seen = Object.create(null);
    parsed.predicates.forEach(function (p) {
      if (!known[p.field] && !seen[p.field]) { seen[p.field] = true; unknown.push(p.field); }
    });
    if (!unknown.length) return "";
    var quoted = unknown.map(function (f) { return '"' + f + '"'; }).join(", ");
    var here = (knownFields || []).length
      ? " — fields here: " + knownFields.join(", ")
      : " — this page has no queryable fields";
    var more = opts.moreHref ? " Full search: " + opts.moreHref + "." : "";
    return "No " + quoted + " " + (unknown.length === 1 ? "field" : "fields") +
      " on this page" + here + "." + more;
  }

  global.MuseumQuery = {
    flattenFields: flattenFields,
    fieldsFromAttrMap: fieldsFromAttrMap,
    fieldsFromElement: fieldsFromElement,
    parsePredicate: parsePredicate,
    parseQuery: parseQuery,
    predicateMatches: predicateMatches,
    rowMatches: rowMatches,
    isEmptyQuery: isEmptyQuery,
    buildFieldFacets: buildFieldFacets,
    buildValueIndex: buildValueIndex,
    commonFieldValues: commonFieldValues,
    wingHint: wingHint,
    formatToken: formatToken,
    wireFacetFilter: wireFacetFilter,
    allFieldNames: allFieldNames,
    renderFieldHelp: renderFieldHelp,
    unknownFieldNote: unknownFieldNote
  };
})(window);
