/**
 * THE MUSEUM — shared list/filter helper (THE CONSOLIDATED-SEARCH WAVE).
 *
 * No dependencies but ONE: js/query.js (loaded first — see the validator
 * guard in scripts/validate.mjs). Built to hold 500 rows exactly as cheaply
 * as 11: no page bakes in a grouping, a sort order, or a filter control
 * that gets more expensive or more biased as the collection grows.
 *
 * EVERY LIST PAGE CARRIES EXACTLY TWO CONTROLS NOW: one search box running
 * the same field:value query engine as search.html (js/query.js), and one
 * filter typeahead that mechanically discovers that page's own queryable
 * fields/values and inserts a token into the search box on pick — it never
 * filters on its own. The query string in the search box is the ONLY
 * state. The bespoke per-field widgets (a "Nonhuman only" checkbox, a
 * "min reigns" number input, one text field per facet) are retired — every
 * capability they had is a query token instead (`nonhuman:true`,
 * `reigns:>=2`), and it composes with everything else for free.
 *
 *   - MuseumList.wireList(...)      build+filter rows from a fetched JSON
 *     array, rendered as roster-card grid rows.
 *   - MuseumList.wireDomFilter(...) filter rows already rendered (server-
 *     side, cross-reference.mjs — wrestlers.html; or by the page's own
 *     script into a plain list shape — shows.html).
 *   - MuseumList.sortKey(...)       the one normalization every list sorts by
 *   - MuseumList.acronymLabel(...)  the one place "UWF (2001)" gets built
 */
(function (global) {
  "use strict";
  var Q = global.MuseumQuery;

  // Safe for text content AND inside double-quoted attribute values (several
  // callers build data-search="..." from recovered prose that itself
  // contains literal quote marks — an unescaped " there would break the
  // attribute, not just look wrong).
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // SCHEMA-HARDENING WAVE: every data/*.json file is now
  // { _schema_version, <key>: [...] } (frontier.json keeps extra header
  // fields alongside `rows`). Every caller here still wants the plain
  // array it always got — unwrap transparently rather than touch every
  // page that calls fetchJSON. Finds the sole non-underscore array-valued
  // key, so it needs no per-file key name hardcoded.
  function unwrapSchema(data) {
    if (Array.isArray(data) || !data || typeof data !== "object") return data;
    if (data._schema_version === undefined) return data;
    for (var k in data) {
      if (k.charAt(0) === "_") continue;
      if (Array.isArray(data[k])) return data[k];
    }
    return data;
  }
  // NEVER A SILENT FAILURE (2026-10-03) — fetchJSON resolves to null when a
  // file doesn't arrive, and every caller does `rows = rows || []`, so a
  // failed load and a genuinely empty registry looked identical downstream
  // ("0 of 0 shown"). The failures are recorded here instead, and wireList
  // below tells the two apart: an empty result set with a recorded failure
  // reads as a failure, with the route onward, never as a count.
  var loadFailures = [];
  function fetchJSON(path) {
    return fetch(path)
      .then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(unwrapSchema)
      .catch(function () {
        if (loadFailures.indexOf(path) === -1) loadFailures.push(path);
        return null;
      });
  }

  // SORT-KEY NORMALIZATION — the one function every list sorts by. Ignores
  // a leading "The " (so "The Plague" files under P), folds case and
  // punctuation. Display strings are never touched — this is comparison
  // only.
  function sortKey(name) {
    return String(name || "")
      .replace(/^the\s+/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }
  function byName(getName) {
    return function (a, b) {
      var ka = sortKey(getName(a)), kb = sortKey(getName(b));
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    };
  }

  // WINDOWED RENDERING (THE PAGINATION ARCHITECTURE WAVE) — shared by
  // wireList and wireDomFilter below. Neither function bakes more than
  // `windowSize` rows into the DOM/visible at rest; scrolling near the
  // bottom of the page reveals another windowSize-sized chunk of whatever
  // the CURRENT filtered result set is. `opts.windowSize` is optional and
  // defaults to unlimited (every prior caller's behavior is unchanged) —
  // only the big instrument pages (wrestlers/shows/rps) opt in. A single
  // shared scroll listener per wired list, armed only when windowing is on.
  function armWindowScroll(getRevealed, bump, rerender) {
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 400) {
          bump();
          rerender();
        }
      });
    }, { passive: true });
  }

  // THE SELFISH-REVIEWER FEATURE (prev/next filter inheritance) — a list
  // page that renders a filtered/sorted set stores the ORDERED sequence of
  // {href, label} it just showed into sessionStorage, keyed by `type`
  // ("wrestlers", "promotions", ...). An entity page's own js/pager.js
  // reads it back: if the entity you're currently viewing is IN that
  // sequence, prev/next walk the sequence you were just filtering instead
  // of the baked alphabetical default. sessionStorage (not localStorage) —
  // this is "your current filter, this tab, right now," not a saved view;
  // it expires with the tab and is capped with its own TTL below so a
  // week-old forgotten filter never silently hijacks navigation.
  var PAGER_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

  // ID-LEVEL MATCHING (2026-08-18 bug fix) — the site serves pretty URLs via
  // a 308 redirect that strips the ".html" extension, so a stored `href`
  // like "/wrestlers/a-table.html" never byte-matches the post-redirect
  // location.pathname ("/wrestlers/a-table") a visitor actually lands on.
  // Comparing by SLUG instead of by path string is immune to that (and to
  // any future trailing-slash/extension drift): take the final non-empty
  // path segment and strip a trailing ".html"/".htm" if present. Mirrored
  // by hand in js/pager.js (same no-shared-dependency reason as its own
  // unwrapSchema/PAGER_TTL_MS duplicates) — keep the two in sync.
  function pathToId(p) {
    if (!p) return null;
    var clean = String(p).split(/[?#]/)[0].replace(/\/+$/, "");
    var seg = clean.split("/").pop() || "";
    seg = seg.replace(/\.html?$/i, "");
    return seg || null;
  }
  function savePagerSequence(type, items) {
    // items: [{ href, label }] — already filtered/sorted, in display order.
    // A row with no href (a held entry with no page yet) is dropped; it
    // has nothing for prev/next to link to. Every surviving item gets its
    // own `id` computed from `href` right here, once, at save time — see
    // pathToId() above — so js/pager.js only ever has to compare id-to-id,
    // never re-derive anything from a possibly-redirected href itself.
    var clean = (items || [])
      .filter(function (it) { return it && it.href; })
      .map(function (it) { return { id: pathToId(it.href), href: it.href, label: it.label }; });
    if (!clean.length) return;
    try {
      sessionStorage.setItem(
        "museum_pager:" + type,
        JSON.stringify({ items: clean, savedAt: Date.now() })
      );
    } catch (e) {
      // sessionStorage unavailable (private-mode edge cases, storage full) —
      // prev/next just falls back to the baked default. Not fatal.
    }
  }

  // THE RESULTS COUNTER (2026-08-22, founder: no one should ever hand-count
  // a filtered set) — the ONE "N of M" readout every list/instrument page
  // renders, shared by wireList/wireDomFilter below (search.html composes
  // its own from the same shape): visible rows, of the current filtered
  // match set, of the page's own full total.
  // Thousands separators, locale-free (the museum reads en-US and loads no
  // Intl-dependent formatting): "29020" read as a serial number, not a
  // quantity, on every counter on the site.
  function num(n) {
    return String(n == null ? "" : n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function countLine(shown, matched, total) {
    // A COUNT, OR A STATE (2026-10-03, Impeccable clarify): "0 of 0 shown" is
    // the sentence the critique read as a broken page. A query that matches
    // nothing is a state, not a count — it says so, keeps the page's own total
    // so the visitor can see the list is still there, and the route onward
    // (clear the search, or the A-Z register) is rendered where the rows would
    // have been. A list that didn't ARRIVE says something different again; see
    // loadFailedHtml above.
    if (!matched) return "Nothing matches" + (total ? " — " + num(total) + " total" : "");
    return num(shown) + " of " + num(matched) + " shown" +
      (matched > shown ? " (scroll for more)" : "") +
      (matched !== total ? " — " + num(total) + " total" : "");
  }

  // THE ROUTE ONWARD (2026-10-03) — the two results that used to end in a
  // number and nothing else. A query that matches nothing says so and
  // offers the one move that gets the visitor somewhere (the query lives in
  // `?q=`, so clearing it is a plain link to the page's own path, no script
  // and no new control); a list that didn't arrive says that instead of
  // counting zero, and points at the page's own complete no-JavaScript
  // register where the page names one. `browseHtml` is the page's own
  // sentence fragment, so the wording stays in the page's voice.
  function clearHref() {
    try { return location.pathname; } catch (e) { return "#"; }
  }
  function noMatchHtml(browseHtml, note) {
    return '<p class="muted">' + (note ? esc(note) + " " : "Nothing matches that search. ") +
      '<a href="' + esc(clearHref()) + '">Clear the search</a>' +
      (browseHtml ? ", or browse " + browseHtml : "") + ".</p>";
  }
  function loadFailedHtml(browseHtml, noun) {
    return '<p class="muted">The list didn’t load. ' +
      (browseHtml
        ? "Every " + esc(noun || "entry") + " is still reachable, complete and unfiltered, from " + browseHtml + ". "
        : "") +
      '<a href="' + esc(clearHref()) + '">Try again</a>.</p>';
  }
  function loadFailed() { return loadFailures.length > 0; }

  // The status line is an aria-live region on every list page now, so it is
  // written only when its text actually changes — a scroll-reveal or a
  // keystroke that lands on the same count must not re-announce it.
  function setStatus(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
  }

  // THE EXAMPLE TOKENS (2026-10-03, Impeccable clarify) — one delegated
  // handler per page, so an example chip written into the page's own HTML and
  // a chip the wing hint renders at runtime both work with no per-chip wiring
  // and no inline handler (the validator refuses those anyway). A chip
  // carries the whole query it stands for in `data-q` and REPLACES what is in
  // the box, which is what an example is for; "Clear the search" and the
  // browser's own Back button both undo it, since the box round-trips to ?q=.
  function wireQueryTokens(input) {
    if (!input) return;
    document.addEventListener("click", function (ev) {
      var el = ev.target;
      while (el && el.getAttribute) {
        var q = el.getAttribute("data-q");
        if (q !== null) {
          ev.preventDefault();
          input.value = q;
          input.dispatchEvent(new Event("input"));
          try { input.focus(); } catch (e) {}
          return;
        }
        el = el.parentNode;
      }
    });
  }

  // THE WING HINT's one line, rendered into the page's own `hintEl` (an
  // element, the #query-hint div) and cleared the moment it no longer
  // applies. The sentence itself, and the rule for when there is one, live
  // in js/query.js — see wingHint there.
  function renderHint(opts, parsed) {
    if (!opts.hintEl) return;
    var html = (opts.hint && opts.valueIndex) ? Q.wingHint(parsed, opts.valueIndex, opts.hint) : "";
    var want = html ? '<p class="muted small">' + html + "</p>" : "";
    if (opts.hintEl.innerHTML !== want) opts.hintEl.innerHTML = want;
  }

  // THE QUERY URL ROUND-TRIP (2026-08-22, founder rider): the search box's
  // FULL query state is shareable — `?q=<query>` is read into the box at
  // wire time (superseding any single-field prefill param, which is just a
  // narrower spelling of the same state), and written back with
  // history.replaceState (debounced) as the visitor types, single-field
  // params dropped once `q` owns the state. Existing ?participant=/?promo=/
  // etc. deep links keep working exactly as before — each page still
  // translates them into query tokens before calling wire*, and this only
  // overrides that when an explicit ?q= is present.
  var LEGACY_QUERY_PARAMS = ["promo", "participant", "who", "holder", "recipient", "award", "involves", "author", "references", "collection"];
  function wireQueryUrl(input) {
    if (!input) return;
    try {
      var q = new URLSearchParams(location.search).get("q");
      if (q != null && q !== "") input.value = q;
    } catch (e) { /* URL APIs unavailable — the box still works, just unshared */ }
    var timer = null;
    input.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        try {
          var params = new URLSearchParams(location.search);
          var v = input.value.trim();
          if (v) params.set("q", v); else params.delete("q");
          LEGACY_QUERY_PARAMS.forEach(function (k) { params.delete(k); });
          var qs = params.toString();
          history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
        } catch (e) { /* same */ }
      }, 250);
    });
  }

  // Default row renderer — the roster-card shape every JSON-driven list
  // page (promotions, championships, frontier, halls of fame) already
  // used by hand: a linked (or, missing an href, plain-text) <h2> title
  // plus an optional single sub-line. `opts.renderRow` overrides this for
  // a page that wants more than one extra line (promotions.html's own
  // quirk/award lines) without re-implementing the filter/window/pager
  // plumbing around it.
  function defaultRenderRow(r) {
    var title = r.href ? '<a href="' + esc(r.href) + '">' + esc(r.label) + "</a>" : esc(r.label);
    var sub = r.sub ? '<div class="handle">' + esc(r.sub) + "</div>" : "";
    return '<div class="roster-card"><h2>' + title + "</h2>" + sub + "</div>";
  }

  // rows: [{ label, sub, href, search, fields }] — `fields` is a
  // {field: [values]} map (MuseumQuery.flattenFields over the row's own
  // JSON record, plus whatever cross-file joins the page's own script
  // adds, same convention search.html uses for its own groups).
  // opts: { input, filterInput, filterDatalist, container, rows, emptyText,
  //   status, windowSize, pagerType, renderRow, containerClass, fieldsHelp,
  //   moreHref }
  // The search box (`input`) runs js/query.js's field:value engine over
  // `search` + `fields`. `filterInput`/`filterDatalist` (both optional,
  // always given together) are wired via MuseumQuery.wireFacetFilter — a
  // discovery aid that inserts a token into `input`, never a second
  // filter axis. `pagerType` (optional): when set, every row in the
  // CURRENT full filtered set (not just the windowed-visible slice) is
  // saved via savePagerSequence() on every apply() — see above.
  //
  // ONE DOCUMENTATION SPOT / NO SILENT ZEROS: `fieldsHelp` (optional, an
  // element) renders this page's own "Fields this page can search"
  // reference once, mechanically discovered off `rows[].fields` — the
  // same discovery `filterInput` already runs, just without the
  // frequency/length thresholds that keep a rare field out of the
  // typeahead. `moreHref` (optional, defaults "/search.html", pass false
  // to omit) is the "Full search" pointer both that reference and an
  // unknown-field empty result carry.
  function wireList(opts) {
    var rows = opts.rows || [];
    var windowSize = opts.windowSize || null;
    var revealed = windowSize || Infinity;
    var renderRow = opts.renderRow || defaultRenderRow;
    var moreHref = opts.moreHref === false ? null : (opts.moreHref || "/search.html");
    if (opts.derive) rows.forEach(function (r) { r.fields = r.fields || {}; addFields(r.fields, opts.derive(r)); });
    var fieldsList = rows.map(function (r) { return r.fields || {}; });
    var knownFields = Q.allFieldNames(fieldsList);
    opts.valueIndex = Q.buildValueIndex(fieldsList);
    wireQueryUrl(opts.input);
    wireQueryTokens(opts.input);
    if (opts.filterInput && opts.filterDatalist) {
      Q.wireFacetFilter(opts.filterInput, opts.filterDatalist, fieldsList, opts.input, opts.valueIndex);
    }
    if (opts.fieldsHelp) {
      Q.renderFieldHelp(opts.fieldsHelp, [{ name: null, fields: knownFields }], { moreHref: moreHref });
    }
    function apply(resetWindow) {
      if (windowSize && resetWindow !== false) revealed = windowSize;
      var parsed = Q.parseQuery(opts.input ? opts.input.value : "");
      var shown = Q.isEmptyQuery(parsed) ? rows.slice() : rows.filter(function (r) {
        return Q.rowMatches(r, parsed);
      });
      var visible = shown.slice(0, revealed);
      var note = shown.length ? "" : Q.unknownFieldNote(parsed, knownFields, { moreHref: moreHref });
      var failed = !rows.length && loadFailed();
      var emptyHtml = null;
      if (!visible.length) {
        if (failed) emptyHtml = loadFailedHtml(opts.browseHtml, opts.noun);
        else if (note || !Q.isEmptyQuery(parsed)) emptyHtml = noMatchHtml(opts.browseHtml, note);
        else emptyHtml = '<p class="muted">' + esc(opts.emptyText || "No matches.") + "</p>";
      }
      opts.container.innerHTML = emptyHtml || visible.map(renderRow).join("");
      if (opts.containerClass) opts.container.className = visible.length ? opts.containerClass : "";
      setStatus(opts.status, failed
        ? "The list didn’t load."
        : (note || countLine(visible.length, shown.length, rows.length)));
      renderHint(opts, parsed);
      if (opts.pagerType) {
        savePagerSequence(opts.pagerType, shown.map(function (r) { return { href: r.href, label: r.label }; }));
      }
    }
    if (opts.input) opts.input.addEventListener("input", function () { apply(true); });
    if (windowSize) armWindowScroll(function () { return revealed; }, function () { revealed += windowSize; }, function () { apply(false); });
    apply(true);
    return apply;
  }

  // items: array (or NodeList) of elements already in the DOM, each
  // carrying data-search plus arbitrary other data-* attributes —
  // MuseumQuery.fieldsFromElement() reads every one of THOSE mechanically
  // into the same {field: [values]} shape wireList's `rows[].fields` uses,
  // so the exact same query engine runs over either row shape. Computed
  // ONCE per item at wire time (not on every keystroke).
  // opts: { input, filterInput, filterDatalist, items, searchAttr, status,
  //   windowSize, pagerType, fieldsHelp, moreHref }
  // opts.windowSize (optional): rows already in the DOM beyond the Nth
  // MATCHING one are display:none at rest — filtering/searching runs over
  // every item (the full set), only the reveal count is windowed.
  // Scrolling near the bottom of the page reveals another chunk of the
  // CURRENT match set.
  //
  // ONE DOCUMENTATION SPOT / NO SILENT ZEROS — see wireList's own header;
  // same `fieldsHelp`/`moreHref` contract, mechanically discovered here
  // off each DOM row's own data-* attributes (via fieldsFromElement)
  // instead of a fetched row's `.fields`.
  function wireDomFilter(opts) {
    var searchAttr = opts.searchAttr || "data-search";
    var rows = Array.prototype.slice.call(opts.items || []).map(function (el) {
      return { el: el, search: (el.getAttribute(searchAttr) || "").toLowerCase(), fields: Q.fieldsFromElement(el) };
    });
    var windowSize = opts.windowSize || null;
    var revealed = windowSize || Infinity;
    var moreHref = opts.moreHref === false ? null : (opts.moreHref || "/search.html");
    var fieldsList = rows.map(function (r) { return r.fields; });
    var knownFields = Q.allFieldNames(fieldsList);
    opts.valueIndex = Q.buildValueIndex(fieldsList);
    wireQueryUrl(opts.input);
    wireQueryTokens(opts.input);
    if (opts.filterInput && opts.filterDatalist) {
      Q.wireFacetFilter(opts.filterInput, opts.filterDatalist, fieldsList, opts.input, opts.valueIndex);
    }
    if (opts.fieldsHelp) {
      Q.renderFieldHelp(opts.fieldsHelp, [{ name: null, fields: knownFields }], { moreHref: moreHref });
    }
    function apply(resetWindow) {
      if (windowSize && resetWindow !== false) revealed = windowSize;
      var parsed = Q.parseQuery(opts.input ? opts.input.value : "");
      var empty = Q.isEmptyQuery(parsed);
      var shown = 0, matched = 0;
      var matchedItems = opts.pagerType ? [] : null;
      rows.forEach(function (r) {
        var match = empty || Q.rowMatches(r, parsed);
        if (match) matched++;
        var visible = match && matched <= revealed;
        r.el.style.display = visible ? "" : "none";
        if (visible) shown++;
        // THE SELFISH-REVIEWER FEATURE — every MATCHED row (not just the
        // windowed-visible slice) joins the saved sequence, keyed off the
        // row's own title link (same "<h2><a>Label</a></h2>" shape every
        // .roster-card row already uses).
        if (match && matchedItems) {
          var link = r.el.querySelector("h2 a, h3 a") || r.el.querySelector("a");
          if (link) matchedItems.push({ href: link.getAttribute("href"), label: link.textContent });
        }
      });
      var note = matched ? "" : Q.unknownFieldNote(parsed, knownFields, { moreHref: moreHref });
      setStatus(opts.status, note || countLine(shown, matched, rows.length));
      renderHint(opts, parsed);
      // THE ROUTE ONWARD — a query matching none of the rows already in the
      // DOM leaves the list blank; `emptyNote` (optional, an element) is
      // where the one next step goes, cleared again the moment anything
      // matches.
      if (opts.emptyNote) {
        opts.emptyNote.innerHTML = matched ? "" : noMatchHtml(opts.browseHtml, note);
      }
      if (opts.pagerType) savePagerSequence(opts.pagerType, matchedItems);
    }
    if (opts.input) opts.input.addEventListener("input", function () { apply(true); });
    if (windowSize) armWindowScroll(function () { return revealed; }, function () { revealed += windowSize; }, function () { apply(false); });
    apply(true);
    return apply;
  }

  // =====================================================================
  // THE SLIM-INDEX WAVE (2026-10-03) — wireIndexList: the instrument shape
  // for the six pages that read a pre-baked index (characters, units,
  // matches, appearances, reigns, bestowals).
  //
  // What it replaces. Those pages used to inject EVERY row with one
  // innerHTML and then hide all but 200 of them (fetchJSON + wireDomFilter):
  // 29,020 roster cards and ~246,000 DOM nodes for a page that shows 200,
  // after a 30 MB download that produced nothing visible at all while it
  // ran. Here the index carries each row's query fields as DATA (`a`, the
  // map js/query.js's fieldsFromAttrMap reads) and its card markup as a
  // fragment (`h`), and only the rows in the current window are ever built.
  // Search and filtering still run over every row — the whole set is in
  // memory, it is the DOM that is windowed.
  //
  // INDEX SHAPE v2, written by scripts/cross-reference.mjs:
  //   { "_schema_version": 2, "_rows": N,
  //     "_row_tag": "div", "_row_class": "roster-card",
  //     "<name>_index": [ {"i": id, "s": search blob, "a": {field: value},
  //                        "h": "<the card's inner markup>"}, ... ] }
  // One row per LINE, which is what lets the loader below hand the first
  // window to the page while the rest of the file is still arriving
  // (TextDecoder over the response's own stream, falling back to an
  // ordinary r.json() wherever streams aren't available).
  //
  // opts: { url, container, input, filterInput, filterDatalist, status,
  //   fieldsHelp, emptyNote, hintEl, hint, windowSize, pagerType, moreHref,
  //   browseHtml, noun, prefill }
  // `prefill` (optional, a function) runs BEFORE the fetch — the page's own
  // ?promo=/?who=/?holder= translation, which has to be in the box before
  // the first window is painted, not after. `browseHtml`/`noun` are the
  // page's own words for the route onward (see loadFailedHtml above).
  // =====================================================================
  function parseIndexHeader(text) {
    function pick(key, dflt) {
      var m = new RegExp('"' + key + '"\\s*:\\s*"([^"]*)"').exec(text);
      return m ? m[1] : dflt;
    }
    var rowsM = /"_rows"\s*:\s*(\d+)/.exec(text);
    return {
      tag: pick("_row_tag", "div"),
      cls: pick("_row_class", ""),
      total: rowsM ? parseInt(rowsM[1], 10) : null
    };
  }
  // `x` (hook c203, adversarial review 2026-10-09, finding B01's remainder):
  // the row's SORT-ONLY scalars, written by cross-reference.mjs's
  // writeIndexV2 for the two instruments that offer a sort control over
  // their own list (awards, wings) and read only by those pages' own
  // onReady handler below. Never a queryable field, never markup: an index
  // whose rows carry no `x` reads exactly as it did before.
  function indexRow(raw) {
    return { i: raw.i, h: raw.h || "", search: raw.s || "", fields: Q.fieldsFromAttrMap(raw.a), x: raw.x || null };
  }
  // The row's own title link, for THE SELFISH-REVIEWER FEATURE — read off
  // the markup fragment once per row and cached, where wireDomFilter read it
  // off the live element. Same first-<a> rule either way (every indexed row
  // leads with its own title link).
  var ENTITY_RE = /&(?:amp|lt|gt|quot|#39|apos);/g;
  var ENTITY_TEXT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };
  function unesc(s) {
    return String(s == null ? "" : s).replace(ENTITY_RE, function (m) { return ENTITY_TEXT[m] || m; });
  }
  function rowLink(r) {
    if (r._l === undefined) {
      var m = /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/.exec(r.h);
      r._l = m ? { href: unesc(m[1]), label: unesc(m[2].replace(/<[^>]*>/g, "")) } : null;
    }
    return r._l;
  }

  // Streams the index, line by line, handing the first `firstN` rows over as
  // soon as they have arrived. Resolves with every row once the file is
  // complete; rejects only when nothing usable arrived at all.
  function loadIndex(url, firstN, onFirst) {
    var meta = null, rows = [], fired = false, headSeen = "";
    function feedLine(line) {
      line = line.trim();
      if (!line) return;
      if (line.charAt(0) !== "{" || line.charAt(1) !== '"') {
        if (headSeen.length < 400) headSeen += line + "\n";
        return;
      }
      if (line.charAt(line.length - 1) === ",") line = line.slice(0, -1);
      var raw;
      try { raw = JSON.parse(line); } catch (e) { return; }
      rows.push(indexRow(raw));
      if (!fired && firstN && rows.length >= firstN) {
        fired = true;
        if (!meta) meta = parseIndexHeader(headSeen);
        onFirst(meta, rows);
      }
    }
    function whole() {
      // No streaming (or the stream broke before a single row landed): the
      // ordinary read, which every browser has.
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      }).then(function (text) {
        meta = parseIndexHeader(text.slice(0, 400));
        var data = JSON.parse(text);
        var arr = unwrapSchema(data) || [];
        return { meta: meta, rows: (Array.isArray(arr) ? arr : []).map(indexRow) };
      });
    }
    var canStream = false;
    try { canStream = !!(window.TextDecoder && window.ReadableStream); } catch (e) { canStream = false; }
    if (!canStream) return whole();

    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error(String(res.status));
      if (!res.body || !res.body.getReader) return whole();
      var reader = res.body.getReader();
      var decoder = new TextDecoder("utf-8");
      var buf = "";
      return new Promise(function (resolve, reject) {
        function pump() {
          reader.read().then(function (step) {
            if (step.done) {
              buf += decoder.decode();
              feedLine(buf);
              if (!meta) meta = parseIndexHeader(headSeen);
              resolve({ meta: meta, rows: rows });
              return;
            }
            buf += decoder.decode(step.value, { stream: true });
            var nl = buf.indexOf("\n");
            while (nl !== -1) {
              feedLine(buf.slice(0, nl));
              buf = buf.slice(nl + 1);
              nl = buf.indexOf("\n");
            }
            pump();
          }).catch(function (e) {
            if (rows.length) { resolve({ meta: meta || parseIndexHeader(headSeen), rows: rows }); }
            else reject(e);
          });
        }
        pump();
      });
    }).catch(function () { return whole(); });
  }

  function wireIndexList(opts) {
    var container = opts.container;
    var windowSize = opts.windowSize || 200;
    var revealed = windowSize;
    var moreHref = opts.moreHref === false ? null : (opts.moreHref || "/search.html");
    var rowTag = "div", rowClass = "", bakedTotal = null;
    var rows = [], knownFields = [], ready = false, apply = null;

    if (opts.prefill) opts.prefill();
    // hook c170 (adversarial review 1009, B12): the page ships its count only ("32,481 characters"); the script that is about to
    // fetch the list is the one that says so, so a visitor without JavaScript is never told a list is on its way.
    if (opts.status && opts.status.textContent.trim() && opts.status.textContent.indexOf("loading") < 0) setStatus(opts.status, opts.status.textContent.trim() + " — the list is loading.");
    wireQueryUrl(opts.input);
    wireQueryTokens(opts.input);
    var openQuery = opts.input ? opts.input.value.trim() : "";

    function renderRow(r) {
      return "<" + rowTag + (rowClass ? ' class="' + rowClass + '"' : "") +
        (r.i ? ' id="' + esc(r.i) + '"' : "") + ">" + r.h + "</" + rowTag + ">";
    }
    function paint(list) {
      container.innerHTML = list.map(renderRow).join("");
    }
    function takeMeta(meta) {
      if (!meta) return;
      rowTag = meta.tag || rowTag;
      rowClass = meta.cls == null ? rowClass : meta.cls;
      if (meta.total != null) bakedTotal = meta.total;
    }

    loadIndex(opts.url, openQuery ? 0 : windowSize, function (meta, partial) {
      // FIRST ROWS BEFORE THE LAST BYTE — the opening window, painted while
      // the rest of the file is still on the wire. Skipped outright for a
      // deep link that arrives with a query already in the box: a partial
      // set would answer it wrongly, and a wrong answer is worse than a
      // slower one.
      if (ready) return;
      takeMeta(meta);
      paint(partial.slice(0, windowSize));
      setStatus(opts.status, countLine(Math.min(windowSize, partial.length),
        bakedTotal == null ? partial.length : bakedTotal,
        bakedTotal == null ? partial.length : bakedTotal));
    }).then(function (res) {
      takeMeta(res.meta);
      rows = res.rows || [];
      if (!rows.length) {
        container.innerHTML = loadFailedHtml(opts.browseHtml, opts.noun);
        setStatus(opts.status, "The list didn’t load.");
        return;
      }
      ready = true;
      // opts.derive(row) -> {field: [values]}: extra queryable values computed once per row (the in-place
      // letter/year filter's `letter:` / `year:`; see the helper block above).
      if (opts.derive) rows.forEach(function (r) { addFields(r.fields, opts.derive(r)); });
      var fieldsList = rows.map(function (r) { return r.fields; });
      knownFields = Q.allFieldNames(fieldsList);
      opts.valueIndex = Q.buildValueIndex(fieldsList);
      if (opts.filterInput && opts.filterDatalist) {
        Q.wireFacetFilter(opts.filterInput, opts.filterDatalist, fieldsList, opts.input, opts.valueIndex);
      }
      if (opts.fieldsHelp) {
        Q.renderFieldHelp(opts.fieldsHelp, [{ name: null, fields: knownFields }], { moreHref: moreHref });
      }
      apply = function (resetWindow) {
        if (resetWindow !== false) revealed = windowSize;
        var parsed = Q.parseQuery(opts.input ? opts.input.value : "");
        var matched = Q.isEmptyQuery(parsed) ? rows : rows.filter(function (r) { return Q.rowMatches(r, parsed); });
        var visible = matched.slice(0, revealed);
        var note = matched.length ? "" : Q.unknownFieldNote(parsed, knownFields, { moreHref: moreHref });
        if (visible.length) paint(visible);
        else container.innerHTML = noMatchHtml(opts.browseHtml, note);
        setStatus(opts.status, note || countLine(visible.length, matched.length, rows.length));
        renderHint(opts, parsed);
        if (opts.pagerType) {
          savePagerSequence(opts.pagerType, matched.map(rowLink).filter(Boolean));
        }
      };
      if (opts.input) opts.input.addEventListener("input", function () { apply(true); });
      armWindowScroll(function () { return revealed; },
        function () { revealed += windowSize; },
        function () { if (apply) apply(false); });
      apply(true);
      // opts.onReady(rows, apply) (hook c203): the page's own hands on the
      // loaded set, once, after the first paint -- what a sort control needs
      // and what wireList gave a page by returning its own apply. `rows` is
      // the live array, so a page that sorts it in place and calls
      // apply(true) re-renders in that order. A page that passes no onReady
      // behaves exactly as it did before.
      if (opts.onReady) opts.onReady(rows, apply);
    }).catch(function () {
      container.innerHTML = loadFailedHtml(opts.browseHtml, opts.noun);
      setStatus(opts.status, "The list didn’t load.");
    });
  }

  // =====================================================================
  // THE IN-PLACE LETTER / YEAR FILTER (hook c145, the Janitor's site sweep,
  // 2026-10-08: "The A-Z filtering should function the same way it does on
  // wings"; "All filters, whether alphabetical or chronological, should
  // filter in the way wings does rather than creating distinct pages").
  //
  // WHAT IT IS. A row of browse links (A-Z, or years) that narrows the list on
  // THIS page, in place, instead of leaving for a static register page. It is
  // PROGRESSIVE ENHANCEMENT: the links keep their real hrefs (the static
  // /x/a-z/ or /x/<year>/ documents), so without JavaScript they still go
  // there, and with it a plain click is intercepted. A ctrl/cmd/shift/middle
  // click is left alone and opens the static page, as a link should.
  //
  // HOW. The filter is one QUERY TOKEN in the page's own search box
  // (`letter:b`, `year:1998`), run by the same js/query.js engine as every
  // other filter. It is deliberately not a DOM hide: wireList and
  // wireIndexList render only a window of 200 rows, so a letter whose rows
  // sit past the window would find nothing to show (the wings page's old
  // letter filter hid already-rendered cards and has exactly that weakness).
  // As a token it filters the whole set, windows the result, round-trips
  // through ?q= (shareable, Back-button safe), composes with every other
  // token, feeds the prev/next pager sequence, and the active link is read
  // back off the box, so typing the token or picking a chip keeps the row of
  // links honest. Clicking the active link clears the token.
  //
  // HOW A PAGE USES IT (three pieces):
  //   1. Give each row a `letter` (or `year`) FIELD VALUE. Rows built by the
  //      page itself (wireList): put it in row.fields, or pass opts.derive.
  //      Index rows (wireIndexList): opts.derive, e.g.
  //         MuseumList.wireIndexList({ ..., derive: MuseumList.linkLetterFields });
  //      (linkLetterFields files a row under the first letter of its own title
  //      link). A row can carry several values, so a relationship is found
  //      under the letter of EITHER character:
  //         fields.letter = [MuseumList.letterKey(nameA), MuseumList.letterKey(nameB)]
  //      A year page does the same with MuseumList.yearOf(date):
  //         derive: function (r) { return { year: [MuseumList.yearOf(r.fields.date[0])] }; }
  //      or, when the rows already carry a date field, uses it as the filter
  //      field instead (field: "date" matches by year token: date:1998).
  //   2. Mark the link row up as the register pages and instruments already do
  //      (<span class="az-row"><span class="az-letters"><a href=...>A</a>...),
  //      a letter link's value read from its text ("A", "0-9") or data-letter;
  //      a year link's from data-year, its /1998/ path, or its text.
  //   3. After the wire call, once:
  //         MuseumList.wireLetterLinks({ input: <the search box> });
  //         MuseumList.wireYearLinks({ input: <the search box>, root: <the links' element> });
  //      (wireTokenLinks is the general form: any field, any link-to-value rule.)
  //
  // THE LETTER RULE is the static register's own (cross-reference.mjs
  // generateAlphaRegister): sortKey() of the name, first character, a-z or
  // else "0-9", so a leading "The" is ignored and the in-place filter and the
  // /x/a-z/ pages can never disagree about where a name belongs.
  // =====================================================================
  var TOKEN_SPLIT_RE = /[^\s"]+"[^"]*"|"[^"]*"|[^\s]+/g;   // js/query.js's own tokenizer
  function letterKey(name) {
    var k = sortKey(name).charAt(0);
    return k >= "a" && k <= "z" ? k : "0-9";
  }
  function yearOf(date) {
    var m = /^\s*(?:circa\s*)?(\d{4})/i.exec(String(date == null ? "" : date));
    return m ? m[1] : null;
  }
  // Folds {field: [values]} into a row's own fields map (no duplicate values).
  function addFields(fields, extra) {
    if (!fields || !extra) return fields;
    Object.keys(extra).forEach(function (k) {
      var have = fields[k] || (fields[k] = []);
      (extra[k] || []).forEach(function (v) {
        if (v != null && v !== "" && have.indexOf(v) === -1) have.push(v);
      });
      if (!have.length) delete fields[k];
    });
    return fields;
  }
  // wireIndexList's ready-made `derive`: the row's own title link, first letter.
  function linkLetterFields(row) {
    var l = rowLink(row);
    return l ? { letter: [letterKey(l.label)] } : {};
  }
  function queryTokens(text) { return String(text || "").trim().match(TOKEN_SPLIT_RE) || []; }
  function tokenParts(t) {
    var m = /^(-?)([A-Za-z_][\w-]*):(.*)$/.exec(t);
    return m ? { neg: !!m[1], field: m[2].toLowerCase(), value: m[3] } : null;
  }
  // The value of the box's positive `field:value` token ("" when there is none).
  function queryTokenValue(input, field) {
    var toks = queryTokens(input.value);
    for (var i = 0; i < toks.length; i++) {
      var p = tokenParts(toks[i]);
      if (p && !p.neg && p.field === field && p.value && p.value.charAt(0) !== "!") return p.value.toLowerCase();
    }
    return "";
  }
  // Replaces every `field:` token in the box with `field:value` ("" clears it)
  // and tells the page, exactly as a typed edit would.
  function setQueryToken(input, field, value) {
    var kept = queryTokens(input.value).filter(function (t) {
      var p = tokenParts(t);
      return !(p && p.field === field);
    });
    if (value) kept.push(field + ":" + value);
    input.value = kept.join(" ");
    input.dispatchEvent(new Event("input"));
  }
  // opts: { input, root | selector, field, linkValue(a) -> string|null, activeClass }
  // `linkValue` returns the token value a link stands for, or null for a link
  // that is not a filter (it then navigates as normal). Returns the sync fn.
  function wireTokenLinks(opts) {
    var input = opts.input;
    var root = opts.root || (opts.selector ? document.querySelector(opts.selector) : null);
    if (!input || !root) return null;
    var field = opts.field, linkValue = opts.linkValue, cls = opts.activeClass || "is-active";
    function sync() {
      var cur = queryTokenValue(input, field);
      var links = root.querySelectorAll("a[href]");
      for (var i = 0; i < links.length; i++) {
        var v = linkValue(links[i]);
        var on = v !== null && cur !== "" && v === cur;
        links[i].classList.toggle(cls, on);
        if (on) links[i].setAttribute("aria-current", "true"); else links[i].removeAttribute("aria-current");
      }
    }
    root.addEventListener("click", function (ev) {
      if (ev.defaultPrevented || ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      var a = ev.target && ev.target.closest ? ev.target.closest("a[href]") : null;
      if (!a || !root.contains(a)) return;
      var v = linkValue(a);
      if (v === null) return;
      ev.preventDefault();
      setQueryToken(input, field, v === queryTokenValue(input, field) ? "" : v);
    });
    input.addEventListener("input", sync);
    window.addEventListener("pageshow", sync);
    root.classList.add("token-filter");
    sync();
    return sync;
  }
  function letterLinkValue(a) {
    var d = a.getAttribute("data-letter");
    if (d) return d.toLowerCase();
    var t = (a.textContent || "").replace(/\s+/g, "");
    if (/^[A-Za-z]$/.test(t)) return t.toLowerCase();
    if (/^0\W9$/.test(t)) return "0-9";
    return null;
  }
  function yearLinkValue(a) {
    var d = a.getAttribute("data-year");
    if (d) return d.toLowerCase();
    var m = /\/(\d{4})(?:\/|\.html|-\d+\.html)?(?:[?#].*)?$/.exec(a.getAttribute("href") || "");
    if (m) return m[1];
    var t = (a.textContent || "").trim();
    return /^\d{4}$/.test(t) ? t : null;
  }
  // opts: { input, root | selector (default ".az-letters"), field (default "letter") }
  function wireLetterLinks(opts) {
    return wireTokenLinks({
      input: opts.input, root: opts.root, selector: opts.selector || (opts.root ? null : ".az-letters"),
      field: opts.field || "letter", linkValue: opts.linkValue || letterLinkValue
    });
  }
  // opts: { input, root | selector, field (default "year") }
  function wireYearLinks(opts) {
    return wireTokenLinks({
      input: opts.input, root: opts.root, selector: opts.selector,
      field: opts.field || "year", linkValue: opts.linkValue || yearLinkValue
    });
  }

  // ACRONYM DISAMBIGUATION CONVENTION — a bare acronym never stands alone;
  // it carries its founding year: "UWF (2001)". Tolerates fuzzy years
  // ("c. 2008" -> 2008) and missing ones ("(year unknown)") without
  // breaking. Collision fallback, when two promotions share both name AND
  // first year: "(2)", "(3)"... assigned DETERMINISTICALLY by founding
  // date then alphabetical full name — NEVER by id, insertion order, or
  // any other stand-in for "who got added to the museum first." That
  // would just rebuild arrival bias inside the disambiguator.
  // THE FOUNDING-EDGES WAVE (2026-08-21) — a promotion's own founded/closed
  // ({date, precision, source}, or an intermittent promotion's runs[] of
  // the same pair) reduced to two small, reusable comparisons: a sortable
  // string (dateSortValue, month/year precision rounds to the first of
  // the period — sort ordering only, never displayed as a real day) and
  // an ACTIVE-tenure year count (promotionTenureYears — the Janitor's own
  // directive in the law, hook c190: "filter to tenure (give me all promotions that
  // lasted >=5 years)"). Tenure is the SUM of run spans when runs[] is
  // present (a fed dark for 3 of 6 years didn't last 6), or the plain
  // closed-minus-founded span otherwise. Returns null — never 0 — the
  // moment any span it needs is unpinnable to a real date, so an
  // honestly-unknown-dated promotion is excluded from tenure filtering
  // rather than silently counted as zero (the founder's own directive,
  // restated in docs/SCHEMA.md).
  function dateSortValue(d) {
    if (!d || typeof d.date !== "string") return null;
    var m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(d.date);
    if (!m) return null;
    return m[1] + "-" + (m[2] || "01") + "-" + (m[3] || "01");
  }
  function promotionTenureYears(p) {
    var spans = (p.runs && p.runs.length) ? p.runs : (p.founded && p.closed ? [p] : null);
    if (!spans) return null;
    var totalDays = 0;
    for (var i = 0; i < spans.length; i++) {
      var f = dateSortValue(spans[i].founded), c = dateSortValue(spans[i].closed);
      if (!f || !c) return null; // any unpinnable span -> honest null, never a partial/guessed total
      var fd = new Date(f + "T00:00:00Z"), cd = new Date(c + "T00:00:00Z");
      if (isNaN(fd.getTime()) || isNaN(cd.getTime())) return null;
      totalDays += Math.max(0, (cd - fd) / 86400000);
    }
    return Math.round(totalDays / 365.25);
  }

  function firstYear(yearsStr) {
    var m = String(yearsStr || "").match(/\d{4}/);
    return m ? m[0] : null;
  }
  function acronymLabel(promo, allPromos) {
    if (!promo) return "";
    var y = firstYear(promo.years);
    // L312 (C1d, rename-render-qa-2026-09-06): a name that already carries its
    // OWN trailing parenthetical renders AS IS.  The year is for a bare acronym
    // that would otherwise say nothing on its own -- never a second
    // parenthetical bolted onto a name that already has one.
    // cross-reference.mjs's acronymLabel() has carried this guard since L135;
    // this hand-mirrored browser copy never got it, so every wing whose L283
    // correction moved a disambiguator INTO the name rendered a double:
    // "ADW (All Desert Wrestling) (2021)", "BBW (2014) (2014)",
    // "GIWF (1999-2001) (1999)" -- 290 of 807 wings on the acro badge of
    // promotions.html alone, and the same function feeds the wing prefix on
    // awards, championships, halloffame, rps, search and shows.
    var base = /\([^)]*\)\s*$/.test(promo.name) ? promo.name : promo.name + " (" + (y || "year unknown") + ")";
    if (!allPromos || !allPromos.length) return base;
    var group = allPromos
      .filter(function (p) { return p.name === promo.name && firstYear(p.years) === y; })
      .sort(function (a, b) {
        // same first year by construction (that's what makes them collide);
        // the deterministic tiebreak is alphabetical full name.
        var fa = sortKey(a.full_name || a.name), fb = sortKey(b.full_name || b.name);
        return fa < fb ? -1 : fa > fb ? 1 : 0;
      });
    if (group.length < 2) return base;
    var idx = group.findIndex(function (p) { return p.id === promo.id; });
    return idx <= 0 ? base : base + " (" + (idx + 1) + ")";
  }
  // L312 (C1e): does the wing's own `name` ALREADY show its expansion?  The
  // browser-side twin of cross-reference.mjs's wingLabelFor() containment
  // guard, and the one test a listing page needs before printing `full_name` a
  // second time beside a name that already contains it.  Exported rather than
  // inlined per page: seven pages take their wing labels from this file, and a
  // hand-mirrored copy of a rule drifting out of sync is exactly what L319
  // caught here in the first place.
  function nameShowsFullName(promo) {
    if (!promo) return true;
    var name = String(promo.name || "").trim();
    var full = promo.full_name == null ? "" : String(promo.full_name).trim();
    if (!full || full === name) return true;
    return name.toLowerCase().indexOf(full.toLowerCase()) !== -1;
  }

  // SHOW-NAME PROMOTION PREFIX (PROFILE QUALITY WAVE, user review: "GIWF
  // Quake", never bare "Quake") — the sitewide convention for displaying a
  // show's name: a bare acronym prefix (promo.name, NOT the year-qualified
  // acronymLabel() form used for filter/disambiguation chips), except in
  // the rare case where two promotions share the exact same bare name, at
  // which point it falls back to the disambiguated year-form so the prefix
  // still means something on its own.
  function bareAcronym(promo, allPromos) {
    if (!promo) return "";
    if (allPromos && allPromos.length) {
      var dupes = allPromos.filter(function (p) { return p.name === promo.name; });
      if (dupes.length > 1) return acronymLabel(promo, allPromos);
    }
    return promo.name;
  }
  function showLabel(show, promoById, allPromos) {
    var promo = promoById[show.promotion];
    var prefix = bareAcronym(promo, allPromos) || String(show.promotion || "").toUpperCase();
    // Some shows' own `name` already carries the promotion acronym as part
    // of its own title ("GIWF Global — 4 May 1999") — don't double it.
    if (show.name.toUpperCase().indexOf(prefix.toUpperCase() + " ") === 0) return show.name;
    return prefix + " " + show.name;
  }

  // THE INDEX-FEEDBACK WAVE (2026-09-08, founder: "Shows... index: each row
  // shows the promotion name with a link to the wing") — showLabel() above
  // stays plain TEXT (search blobs still want an unlinked string); this is
  // the HTML twin used only where a row actually RENDERS the label,
  // splitting the promotion-prefix convention into two links instead of
  // one: the prefix points at the wing, the remainder of the show's own
  // name points at the show. Mirrors cross-reference.mjs's own Node-side
  // showLabelHtml() (browser run time vs. Node build time).
  function showLabelHtml(show, promoById, allPromos) {
    var promo = promoById[show.promotion];
    var prefix = bareAcronym(promo, allPromos) || String(show.promotion || "").toUpperCase();
    var rest = show.name;
    if (show.name.toUpperCase().indexOf(prefix.toUpperCase() + " ") === 0) {
      rest = show.name.slice(prefix.length).replace(/^\s+/, "");
    }
    var promoHtml = promo && promo.page ? '<a href="' + esc(promo.page) + '">' + esc(prefix) + "</a>" : esc(prefix);
    var showHtml = show.page ? '<a href="' + esc(show.page) + '">' + esc(rest) + "</a>" : esc(rest);
    return promoHtml + " " + showHtml;
  }

  // TITLE-DIRECTORY DISAMBIGUATION (founder's gavel, 2026-08-18: "so we
  // don't just end up with 400 consecutive 'World Championship' entries")
  // — the same showLabel() convention, one datatype over: a standalone
  // title-directory ROW (championships.html, search.html's title-group
  // results) never renders a bare title name alone; it carries a bare
  // acronym prefix ("UWF World Heavyweight Championship"), falling back to
  // the year-disambiguated acronymLabel() form only where two promotions
  // share the exact same bare acronym (same fallback bareAcronym() already
  // does for shows). A title page's own h1/placard is untouched by this —
  // the promotion is already named there in full; this is standalone-label
  // rendering only.
  function titleLabel(title, promoById, allPromos) {
    var promo = promoById ? promoById[title.promotion] : null;
    var prefix = bareAcronym(promo, allPromos) || String(title.promotion || "").toUpperCase();
    if (title.name.toUpperCase().indexOf(prefix.toUpperCase() + " ") === 0) return title.name;
    return prefix + " " + title.name;
  }

  global.MuseumList = {
    esc: esc,
    num: num,
    countLine: countLine,
    setStatus: setStatus,
    wireQueryTokens: wireQueryTokens,
    letterKey: letterKey,
    yearOf: yearOf,
    addFields: addFields,
    linkLetterFields: linkLetterFields,
    queryTokenValue: queryTokenValue,
    setQueryToken: setQueryToken,
    wireTokenLinks: wireTokenLinks,
    wireLetterLinks: wireLetterLinks,
    wireYearLinks: wireYearLinks,
    wireIndexList: wireIndexList,
    wireQueryUrl: wireQueryUrl,
    fetchJSON: fetchJSON,
    sortKey: sortKey,
    byName: byName,
    wireList: wireList,
    wireDomFilter: wireDomFilter,
    dateSortValue: dateSortValue,
    promotionTenureYears: promotionTenureYears,
    firstYear: firstYear,
    acronymLabel: acronymLabel,
    nameShowsFullName: nameShowsFullName,
    bareAcronym: bareAcronym,
    showLabel: showLabel,
    showLabelHtml: showLabelHtml,
    titleLabel: titleLabel,
    savePagerSequence: savePagerSequence,
    pathToId: pathToId,
    PAGER_TTL_MS: PAGER_TTL_MS
  };
})(window);
