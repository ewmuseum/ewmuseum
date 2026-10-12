/**
 * THE MUSEUM — entity-page prev/next pager (THE SELFISH-REVIEWER FEATURE).
 *
 * No dependencies, no build step. Every entity page (characters, promotions,
 * accessions, essays) is BAKED with a plain-HTML prev/next nav.pager, in
 * sortKey order within its own type — that baked pair works with no JS at
 * all, same "the repo's own files ARE the served site" principle as chrome.
 *
 * This script adds three things on top of that baked default, for a visitor
 * who has JS:
 *
 *   1. LEFT/RIGHT ARROW KEYS follow prev/next — a fast, no-mouse way to
 *      page through hundreds of entries (guarded so typing in a text field
 *      never accidentally navigates away).
 *   2. FILTER INHERITANCE — if a list page (characters.html, promotions.html,
 *      ...) just rendered a filtered/sorted set and you clicked into one of
 *      its rows, prev/next here walk THAT set instead of the flat baked
 *      order, with a small "N of M in your filter — clear" indicator.
 *      List pages write the sequence via MuseumList.savePagerSequence()
 *      (js/list.js); this reads it back from sessionStorage. Absent or
 *      expired, prev/next stay exactly as baked — this script only ever
 *      REWIRES an existing baked pair, it never invents one.
 *   3. THE 'r' KEY jumps to a RANDOM entity of the same type — from the
 *      active filtered sequence if one applies (random-within-your-filter,
 *      the review-sprint power move this was built for), otherwise uniform
 *      over the type's own full category index. See randomJump() below.
 *
 * 2026-08-18 FILTER-INHERITANCE BUG HUNT, ROUND 2 — THE ACTUAL ROOT CAUSE:
 * the site serves pretty URLs via a 308 redirect that strips the ".html"
 * extension. A stored sequence item's own `href` is always built WITH the
 * extension ("/characters/a-table.html" — see js/list.js/cross-reference.mjs,
 * every href on the site is minted that way); the page a click actually
 * lands on, after the redirect, reports `location.pathname` WITHOUT it
 * ("/characters/a-table"). Round 1's own href-string comparison (a trailing-
 * slash-tolerant `samePath()`) could never match those two forms — an
 * exact-string (or near-exact-string) compare was never going to survive an
 * extension getting silently stripped in flight. THE FIX: compare by ID,
 * not by path string. Both sides are normalized through the SAME
 * `pathToId()` — the final path segment, extension stripped — so a stored
 * href, a redirected pathname, a trailing slash, or (were it ever to
 * change) the extension itself can drift independently and matching still
 * holds. `samePath()` is retired; every comparison in this file now goes
 * through `pathToId()` instead, mirrored by hand in js/list.js's own
 * savePagerSequence() (same no-shared-dependency reason as unwrapSchema/
 * PAGER_TTL_MS above — keep the two copies in sync by hand if either
 * changes). Both files' own version query strings are bumped.
 */
(function () {
  "use strict";

  // Mirrors js/list.js's own PAGER_TTL_MS — this script intentionally
  // doesn't depend on list.js (entity pages don't otherwise load it), so
  // the constant is duplicated rather than shared. Keep the two in sync by
  // hand if either changes.
  var PAGER_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

  // THE RANDOM-JUMP RIDER: the full-category fallback source per pager
  // type, used only when 'r' is pressed with no active filtered sequence.
  // Mirrors js/list.js's own unwrapSchema() convention by hand for the
  // same "no dependency on list.js" reason as PAGER_TTL_MS above — every
  // data/*.json file is `{_schema_version, <key>: [...]}` and every caller
  // just wants the plain array.
  var CATEGORY_SOURCE = {
    characters: {
      url: "/data/characters-index.json",
      // THE SLIM-INDEX WAVE (2026-10-03): an index row's id is `i` in schema
      // v2 (it was `id` in v1, beside a second copy of every other field) —
      // both spellings read, so this keeps working either side of the
      // regeneration that rewrites the file.
      href: function (r) { return "/characters/" + (r.i || r.id) + ".html"; },
    },
    promotions: {
      url: "/data/promotions.json",
      href: function (r) { return r.page || null; },
    },
    essays: {
      url: "/data/essays.json",
      href: function (r) { return r.page || null; },
    },
    collections: {
      url: "/data/collections.json",
      href: function (r) { return r.id ? "/collections/" + r.id + ".html" : null; },
    },
    titles: {
      url: "/data/titles.json",
      href: function (r) { return "/titles/" + r.id + ".html"; },
    },
  };

  function unwrapSchema(data) {
    if (Array.isArray(data) || !data || typeof data !== "object") return data;
    if (data._schema_version === undefined) return data;
    for (var k in data) {
      if (k.charAt(0) === "_") continue;
      if (Array.isArray(data[k])) return data[k];
    }
    return data;
  }

  function readSequence(type) {
    var raw;
    try {
      raw = sessionStorage.getItem("museum_pager:" + type);
    } catch (e) {
      return null; // sessionStorage unavailable — fall back to baked default
    }
    if (!raw) return null;
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return null;
    }
    if (!parsed || !parsed.items || !parsed.items.length) return null;
    if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > PAGER_TTL_MS) return null;
    return parsed;
  }

  // ID-LEVEL MATCHING — mirrors js/list.js's own pathToId() by hand (see the
  // file-header comment above for why the two files don't share a module).
  // Immune to the .html-stripping 308 redirect, a trailing slash, or any
  // future extensionless-URL change: both sides reduce to the same bare
  // slug before ever being compared.
  function pathToId(p) {
    if (!p) return null;
    var clean = String(p).split(/[?#]/)[0].replace(/\/+$/, "");
    var seg = clean.split("/").pop() || "";
    seg = seg.replace(/\.html?$/i, "");
    return seg || null;
  }

  function init() {
    var nav = document.querySelector("nav.pager[data-pager-type]");
    if (!nav) return;
    var type = nav.getAttribute("data-pager-type");
    var prevEl = nav.querySelector(".pager-prev");
    var nextEl = nav.querySelector(".pager-next");
    var indicator = nav.querySelector(".pager-indicator");

    if (prevEl) prevEl.title = "Previous (←)";
    if (nextEl) nextEl.title = "Next (→)";

    var seq = readSequence(type);
    if (seq) {
      var curId = pathToId(location.pathname);
      var idx = -1;
      for (var i = 0; i < seq.items.length; i++) {
        // `.id` is stamped by js/list.js's savePagerSequence() at save time;
        // fall back to deriving it from `.href` here too, so a sequence
        // saved by a stale cached copy of list.js still matches rather than
        // silently missing.
        var itemId = seq.items[i].id || pathToId(seq.items[i].href);
        if (itemId && itemId === curId) { idx = i; break; }
      }
      // Current page isn't IN the saved filtered sequence (a direct visit,
      // or navigation that already walked off the end of it) — leave the
      // baked prev/next exactly as served. This is the documented fallback,
      // not an error state.
      if (idx !== -1) {
        applyFiltered(seq.items, idx, prevEl, nextEl, indicator, type);
      } else {
        seq = null; // not applicable to THIS page — random-jump falls back too
      }
    }

    var randomEl = buildRandomAffordance(nav, type, seq);

    document.addEventListener("keydown", function (e) {
      if (e.defaultPrevented) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      var t = document.activeElement;
      if (t) {
        var tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return;
      }
      if (e.key === "ArrowLeft" && prevEl && prevEl.href) {
        location.href = prevEl.href;
      } else if (e.key === "ArrowRight" && nextEl && nextEl.href) {
        location.href = nextEl.href;
      } else if (e.key === "r" || e.key === "R") {
        randomJump(type, seq);
      }
    });
  }

  function applyFiltered(items, idx, prevEl, nextEl, indicator, type) {
    var prevItem = idx > 0 ? items[idx - 1] : null;
    var nextItem = idx < items.length - 1 ? items[idx + 1] : null;

    if (prevEl) {
      if (prevItem) {
        prevEl.href = prevItem.href;
        prevEl.textContent = "← " + prevItem.label;
        prevEl.hidden = false;
      } else {
        prevEl.removeAttribute("href");
        prevEl.hidden = true;
      }
    }
    if (nextEl) {
      if (nextItem) {
        nextEl.href = nextItem.href;
        nextEl.textContent = nextItem.label + " →";
        nextEl.hidden = false;
      } else {
        nextEl.removeAttribute("href");
        nextEl.hidden = true;
      }
    }
    if (indicator) {
      indicator.hidden = false;
      indicator.textContent = (idx + 1) + " of " + items.length + " in your filter — ";
      var clear = document.createElement("button");
      clear.type = "button";
      clear.textContent = "clear";
      clear.addEventListener("click", function () {
        try { sessionStorage.removeItem("museum_pager:" + type); } catch (e) { /* noop */ }
        location.reload();
      });
      indicator.appendChild(clear);
    }
  }

  // THE RANDOM-JUMP RIDER — small visible affordance (discoverability, per
  // the brief) plus the actual draw. `seq` (possibly null) is the SAME
  // filtered-sequence object `init()` already resolved for prev/next, so
  // clicking "random" and pressing 'r' draw from identical pools — no
  // second source of truth to drift out of sync with the arrows.
  function buildRandomAffordance(nav, type, seq) {
    if (!CATEGORY_SOURCE[type] && !(seq && seq.items && seq.items.length)) return null;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pager-random";
    btn.textContent = "random";
    btn.title = "Random " + (seq ? "(in your filter) " : "") + "(r)";
    btn.addEventListener("click", function () { randomJump(type, seq); });
    nav.appendChild(btn);
    return btn;
  }

  function pickAndGo(items) {
    var curId = pathToId(location.pathname);
    var candidates = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !it.href) continue;
      var itemId = it.id || pathToId(it.href);
      if (itemId !== curId) candidates.push(it);
    }
    if (!candidates.length) return; // only entry in the pool — nothing to jump to
    var pick = candidates[Math.floor(Math.random() * candidates.length)];
    location.href = pick.href;
  }

  function randomJump(type, seq) {
    // Rule 1 (the brief's own priority): an active filter sequence draws
    // from ITSELF, not the full category — random-within-your-filter is
    // the review-sprint feature this was actually asked for.
    if (seq && seq.items && seq.items.length) {
      pickAndGo(seq.items);
      return;
    }
    var src = CATEGORY_SOURCE[type];
    if (!src) return;
    fetch(src.url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(unwrapSchema)
      .then(function (rows) {
        if (!rows || !rows.length) return;
        var items = [];
        for (var i = 0; i < rows.length; i++) {
          var href = src.href(rows[i]);
          if (href) items.push({ href: href });
        }
        pickAndGo(items);
      })
      .catch(function () { /* no network / bad response — no-op, same as an absent sequence */ });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
