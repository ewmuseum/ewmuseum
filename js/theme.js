/* THE HOUSE LIGHTS (the Janitor, 2026-10-03: "Dark, with a toggle"; then "Make the light/dark mode default to
   the user's system setting"; 2026-10-05: "House up/down/auto takes a lot of real estate" -> one icon button).
   Loaded in <head> before the stylesheet paints anything, so no visitor sees a flash of the wrong theme. Until a
   visitor chooses, the lights follow their device ("auto": style.css carries the light tokens under
   prefers-color-scheme); "down" (dark) and "up" (light) are their own choices, remembered in this browser only
   (localStorage). A browser that refuses storage simply follows its device every time.
   The switch is ONE square button in the masthead's corner. Its icon shows the lights as they are set (a moon for
   down, a sun for up, a half-lit disc for auto); each press moves to the next setting, auto -> down -> up -> auto.
   Its accessible name says the current setting and what a press does. */
(function () {
  var KEY = "museum-house-lights";
  var MODES = ["auto", "down", "up"];
  var NAMES = { down: "down (dark)", up: "up (light)", auto: "auto (follows this device)" };
  var SVG = "http://www.w3.org/2000/svg";
  var ICONS = {
    down: [["path", { d: "M12.5 9.6A5 5 0 0 1 6.4 3.5a5 5 0 1 0 6.1 6.1z" }]],
    up: [["circle", { cx: "8", cy: "8", r: "2.75" }],
         ["path", { d: "M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06" }]],
    auto: [["circle", { cx: "8", cy: "8", r: "5.5" }],
           ["path", { d: "M8 2.5a5.5 5.5 0 0 0 0 11z", "class": "fill" }]]
  };
  var root = document.documentElement;

  function saved() {
    try {
      var v = window.localStorage.getItem(KEY);
      return MODES.indexOf(v) >= 0 ? v : "auto";
    } catch (e) {
      return "auto";
    }
  }
  function apply(mode) { root.setAttribute("data-theme", mode); }
  function remember(mode) {
    try { window.localStorage.setItem(KEY, mode); } catch (e) { /* storage refused: the choice lasts this page only */ }
  }
  function next(mode) { return MODES[(MODES.indexOf(mode) + 1) % MODES.length]; }

  apply(saved());

  function icon(mode) {
    var svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    ICONS[mode].forEach(function (part) {
      var el = document.createElementNS(SVG, part[0]);
      for (var k in part[1]) el.setAttribute(k, part[1][k]);
      svg.appendChild(el);
    });
    return svg;
  }

  function mount() {
    var inner = document.querySelector("header.masthead .inner");
    if (!inner || inner.querySelector(".house-lights")) return;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "house-lights";
    function sync() {
      var current = root.getAttribute("data-theme") || "auto";
      var label = "House lights: " + NAMES[current] + ". Press for " + NAMES[next(current)] + ".";
      b.setAttribute("aria-label", label);
      b.title = label;
      b.setAttribute("data-mode", current);
      while (b.firstChild) b.removeChild(b.firstChild);
      b.appendChild(icon(current));
    }
    b.addEventListener("click", function () {
      var mode = next(root.getAttribute("data-theme") || "auto");
      apply(mode);
      remember(mode);
      sync();
    });
    sync();
    inner.appendChild(b);
  }

  /* THE CURRENT PAGE IN THE NAV (hook c78): on a phone the gallery nav scrolls sideways, so the stamped current link
     (aria-current, set by scripts/stamp-chrome.mjs) is brought to the middle of the strip. Sideways only: the page never
     moves. A nav that does not overflow (desktop) is left alone. */
  function showHere() {
    var nav = document.querySelector("nav.gallery");
    var cur = nav && nav.querySelector("a[aria-current]");
    if (!cur || nav.scrollWidth <= nav.clientWidth) return;
    var x = cur.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft;
    nav.scrollLeft = Math.max(0, x - (nav.clientWidth - cur.offsetWidth) / 2);
  }
  function ready() { mount(); showHere(); }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();

/* The Janitor, 2026-10-09 (hook c211): for those who know the code. Nothing loads until it is entered. */
(function () {
  var SRC = "/js/r/b42f59.mp4", LIST = "/js/r/egg-videos.json", K = { ArrowUp: "U", ArrowDown: "D", ArrowLeft: "L", ArrowRight: "R", b: "B", B: "B", a: "A", A: "A" };
  var buf = "", box = null, sx = 0, sy = 0, last = null, busy = false;
  if (/^\/(memorials(\/|$)|in-memoriam(\.html|\/)?$)/.test(location.pathname)) return; /* hook c212: never on the memorial pages */
  function feed(c, e) {
    buf = (buf + c).slice(-10);
    if (buf === "UUDDLRLRBA" || buf === "UUDDLRLRTT") { buf = ""; if (e && e.cancelable) e.preventDefault(); pick(); }
  }
  /* hook c212: THE PLAYLIST. /js/r/egg-videos.json lists the served videos ({"videos": ["/js/r/<name>.mp4", ...]}); it is
     fetched only now, when the code is complete, and one entry is picked at random. Any failure, or no answer within
     1.5 s (a page still busy loading), plays SRC at once, so the video starts while the gesture still counts. */
  function pick() {
    if (box || busy) return;
    busy = true;
    var wait = setTimeout(function () { go(null); }, 1500);
    function go(list) {
      if (!busy) return;
      busy = false; clearTimeout(wait);
      var ok = [], i;
      for (i = 0; list && i < list.length; i++) if (typeof list[i] === "string" && /^\/js\/r\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.mp4$/.test(list[i])) ok.push(list[i]);
      show(ok.length ? ok[Math.floor(Math.random() * ok.length)] : SRC);
    }
    if (!window.fetch) return go(null);
    fetch(LIST, { cache: "no-cache", credentials: "same-origin", priority: "high" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { go(j && j.videos); }, function () { go(null); });
  }
  function close() {
    if (!box) return;
    var v = box.querySelector("video");
    v.pause(); v.removeAttribute("src"); v.load();
    box.parentNode.removeChild(box); box = null;
    if (last && last.focus) last.focus();
  }
  function show(src) {
    if (box) return;
    last = document.activeElement;
    var calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    box = document.createElement("div");
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Video");
    box.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.94);display:flex;align-items:center;justify-content:center;" +
      (calm ? "" : "opacity:0;transition:opacity .25s");
    var v = document.createElement("video");
    v.playsInline = true; v.setAttribute("playsinline", ""); v.controls = true; v.tabIndex = -1;
    v.style.cssText = "max-width:100%;max-height:100%;outline:0";
    v.addEventListener("ended", close);
    v.src = src || SRC;
    box.appendChild(v);
    var at = Date.now();
    box.addEventListener("click", function (e) { if (e.target === box && Date.now() - at > 400) close(); });
    document.body.appendChild(box);
    v.focus();
    if (!calm) requestAnimationFrame(function () { requestAnimationFrame(function () { if (box) box.style.opacity = "1"; }); });
    var p = v.play();
    if (p && p.catch) p.catch(function () {
      if (!box) return;
      v.muted = true;
      var q = v.play(); if (q && q.catch) q.catch(function () {});
      var b = document.createElement("button");
      b.type = "button"; b.textContent = "Sound on";
      b.style.cssText = "position:absolute;top:16px;right:16px;padding:10px 16px;font:600 14px/1 system-ui,sans-serif;color:#141210;background:#c8a24b;border:0;border-radius:4px;cursor:pointer";
      b.addEventListener("click", function () { v.muted = false; b.parentNode && b.parentNode.removeChild(b); });
      box.appendChild(b);
    });
  }
  document.addEventListener("keydown", function (e) {
    if (box) { if (e.key === "Escape") close(); return; }
    var t = e.target, n = t && t.nodeName;
    if (e.repeat || e.key === "Shift" || e.ctrlKey || e.metaKey || e.altKey || n === "INPUT" || n === "TEXTAREA" || n === "SELECT" || (t && t.isContentEditable)) return;
    feed(K[e.key] || "x", e);
  });
  document.addEventListener("touchstart", function (e) {
    if (box || e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener("touchend", function (e) {
    if (box || e.changedTouches.length !== 1) return;
    var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy, ax = Math.abs(dx), ay = Math.abs(dy);
    feed(ax < 12 && ay < 12 ? "T" : ax < 40 && ay < 40 ? "x" : ax > ay ? (dx > 0 ? "R" : "L") : (dy > 0 ? "D" : "U"), e);
  });
})();

/* The Janitor, 2026-10-09 (hook c212): the small eggs. "kayfabe" typed on a page puts it in its 1998 costume (again, or a
   reload, takes it off); three quick clicks on the wordmark ring the bell; the 404 page announces a fresh angle; the
   console has a note. None of it runs on the memorial pages (/in-memoriam, /memorials/); everywhere else, the front door
   included, it all works (the Janitor, 2026-10-10, hook c242). Nothing is fetched; the bell is synthesised here, the
   costume drawn here. */
(function () {
  var path = location.pathname;
  if (/^\/(memorials(\/|$)|in-memoriam(\.html|\/)?$)/.test(path)) return;
  var root = document.documentElement;
  function calm() { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); }

  try {
    console.log([
      " _________________________________________________",
      "/                                                 \\",
      "|  .---.  .-----------------------------.  .---.  |",
      "| / EWM \\ | UNDISPUTED CONSOLE CHAMPION | / EWM \\ |",
      "| | (*) | |  OF THE E-WRESTLING MUSEUM  | | (*) | |",
      "| \\ '98 / |           *  *  *           | \\ '98 / |",
      "|  '---'  '-----------------------------'  '---'  |",
      "\\_________________________________________________/",
      "",
      "The museum is always accepting applications.",
      "Apply in the forum: https://forum.ewmuseum.org  (how it works: https://ewmuseum.org/about.html)"
    ].join("\n"));
  } catch (e) { /* no console */ }

  var LINES = [
    "This page no-showed. Management is reviewing its contract.",
    "This page was released from its contract. We wish it well in its future endeavors.",
    "This page has been injured in a backstage altercation and is not medically cleared to compete.",
    "This page missed its flight and will not be at tonight's show.",
    "This page missed the roleplay deadline and forfeits its match.",
    "This page has jumped ship to a rival fed.",
    "This page was stripped of its title for failing to defend it within thirty days.",
    "This page has been suspended indefinitely pending a review by the commissioner.",
    "This page is under contract, but creative has nothing for it.",
    "This page's handler stopped answering e-mail. Its match has been cancelled."
  ];

  var TILE = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#000033"/><g fill="#fff"><rect x="7" y="9" width="1" height="1"/><rect x="40" y="5" width="2" height="2"/><rect x="22" y="30" width="1" height="1"/><rect x="55" y="38" width="1" height="1"/><rect x="12" y="51" width="2" height="2"/><rect x="47" y="58" width="1" height="1"/><rect x="31" y="47" width="1" height="1"/></g></svg>');
  var CONSTR = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="176" height="40" viewBox="0 0 176 40"><defs><pattern id="s" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="16" fill="#000"/><rect x="8" width="8" height="16" fill="#fc0"/></pattern></defs><rect width="176" height="40" fill="url(#s)"/><rect x="6" y="9" width="164" height="22" fill="#fc0" stroke="#000" stroke-width="2"/><text x="88" y="25" font-family="Times New Roman,Times,serif" font-size="13" font-weight="bold" text-anchor="middle" fill="#000">UNDER CONSTRUCTION</text></svg>');
  var CSS =
    "html.kayfabe[data-theme]{--bg:#000033;--bg-2:#000055;--bg-3:#00005e;--ink:#fff;--ink-soft:#ccf;--ink-bright:#ff0;--muted:#9cf;--line:#33a;--line-2:#66c;--brass:#ff0;--brass-bright:#0ff;--brass-dim:#fc0;--rust:#f66;--spot:transparent;--wash-mast:transparent}" +
    "html.kayfabe body{background:#000033 url(\"" + TILE + "\") repeat;color:#fff}" +
    "html.kayfabe body::before{display:none}" +
    "html.kayfabe body,html.kayfabe body *:not(svg):not(svg *):not(code):not(pre){font-family:\"Times New Roman\",Times,serif!important;letter-spacing:normal}" +
    "html.kayfabe a:visited{color:#f6f}" +
    ".kf-x{text-align:center;margin:12px 0}" +
    ".kf-tick{display:block;background:#000;color:#0f0;border:2px ridge #999;padding:4px 0;font-weight:bold}" +
    ".kf-uc{display:block;margin:0 auto;animation:kf-blink 1s steps(2,start) infinite}" +
    "@keyframes kf-blink{to{visibility:hidden}}" +
    ".kf-ring{border:3px ridge #999;background:#c0c0c0;color:#000;padding:6px;font-size:14px}" +
    ".kf-ring b{color:#000080}" +
    "html.kayfabe body .kf-x .kf-count{display:inline-block;background:#000;color:#0f0;font-family:\"Courier New\",monospace!important;padding:2px 6px;border:2px inset #999;letter-spacing:3px}" +
    "@media (prefers-reduced-motion: reduce){.kf-uc{animation:none}}";

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function kayfabe() {
    var main = document.querySelector("main") || document.body;
    if (!main) return;
    if (root.classList.contains("kayfabe")) {
      root.classList.remove("kayfabe");
      var old = document.querySelectorAll(".kf-x");
      for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
      return;
    }
    if (!document.getElementById("kf-css")) { var s = el("style"); s.id = "kf-css"; s.textContent = CSS; document.head.appendChild(s); }
    root.classList.add("kayfabe");
    var news = "+++ NEWS UPDATE +++ Best viewed in Netscape Navigator at 800x600 +++ Roleplay deadline is Friday at midnight EST +++ " +
      "Results from last night's show are UP +++ Sign the guestbook! +++ This site is kayfabe compliant +++";
    var top = el("div", "kf-x"); top.setAttribute("aria-hidden", "true");
    var tick;
    if (calm()) tick = el("p", "kf-tick", news);
    else { tick = el("marquee", "kf-tick", news); tick.setAttribute("scrollamount", "5"); }
    var uc = el("img", "kf-uc"); uc.src = CONSTR; uc.alt = ""; uc.width = 176; uc.height = 40;
    top.appendChild(tick); top.appendChild(uc);
    main.insertBefore(top, main.firstChild);
    var bot = el("div", "kf-x"); bot.setAttribute("aria-hidden", "true");
    var ring = el("div", "kf-ring");
    ring.appendChild(el("span", "", "[ << Prev ] [ ")); ring.appendChild(el("b", "", "The E-Fed Webring")); ring.appendChild(el("span", "", " ] [ Random ] [ Next >> ]"));
    var n = 1998; for (var j = 0; j < path.length; j++) n = (n * 31 + path.charCodeAt(j)) % 900000;
    var cnt = el("p", "", "You are visitor number "); cnt.appendChild(el("span", "kf-count", String(100000 + n)));
    bot.appendChild(ring); bot.appendChild(cnt);
    var foot = main.querySelector("footer");
    if (foot && foot.parentNode === main) main.insertBefore(bot, foot); else main.appendChild(bot);
  }

  var word = "";
  document.addEventListener("keydown", function (e) {
    var t = e.target, n = t && t.nodeName;
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || n === "INPUT" || n === "TEXTAREA" || n === "SELECT" || (t && t.isContentEditable)) return;
    if (!e.key || e.key.length !== 1) return;
    word = (word + e.key.toLowerCase()).slice(-7);
    if (word === "kayfabe") { word = ""; kayfabe(); }
  });

  var ac = null, clicks = 0, timer = 0;
  function ding() {
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    try {
      if (!ac) ac = new C();
      if (ac.state === "suspended" && ac.resume) ac.resume();
      var t0 = ac.currentTime + 0.02, out = ac.createGain();
      out.gain.value = 0.25; out.connect(ac.destination);
      for (var k = 0; k < 3; k++) {
        var at = t0 + k * 0.42, P = [[1, 1], [2.32, 0.5], [4.25, 0.3], [6.63, 0.16]];
        for (var q = 0; q < P.length; q++) {
          var o = ac.createOscillator(), g = ac.createGain();
          o.type = "sine"; o.frequency.value = 1180 * P[q][0];
          g.gain.setValueAtTime(0.0001, at);
          g.gain.exponentialRampToValueAtTime(P[q][1], at + 0.004);
          g.gain.exponentialRampToValueAtTime(0.0001, at + 1.4 / (1 + q));
          o.connect(g); g.connect(out); o.start(at); o.stop(at + 1.5);
        }
      }
    } catch (err) { /* no sound: the bell stays quiet */ }
  }
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest("header.masthead a.wordmark");
    if (!a || e.button !== 0 || !e.detail || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    clearTimeout(timer);
    if (++clicks >= 3) { clicks = 0; ding(); return; }
    var href = a.href;
    timer = setTimeout(function () { clicks = 0; location.href = href; }, 380);
  });

  function angle() {
    var spot = document.getElementById("angle-404");
    if (spot) spot.textContent = LINES[Math.floor(Math.random() * LINES.length)];
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", angle);
  else angle();
})();

/* The Janitor, 2026-10-09 (hook c216): THE COMMUNITY ASK. data/community-ask.json holds the current ask and
   scripts/stamp-community-ask.mjs builds it into the page (the home page and that person's memorial only), so it reads
   without this script. Here: a small dismiss button, remembered in this browser for that ask's id only (localStorage,
   "museum-ask-dismissed"; a browser that refuses storage just shows the ask again next time), and a panel whose
   data-ask-ends date has passed is taken down between builds. A dismissed ask is hidden from the head, before it paints. */
(function () {
  var KEY = "museum-ask-dismissed", OK = /^[a-z0-9][a-z0-9-]*$/;
  function gone() {
    try { return (window.localStorage.getItem(KEY) || "").split(" ").filter(function (x) { return OK.test(x); }); }
    catch (e) { return []; }
  }
  var off = gone();
  if (off.length) {
    try {
      var s = document.createElement("style");
      s.textContent = off.map(function (x) { return '.community-ask[data-ask-id="' + x + '"]'; }).join(",") + "{display:none}";
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { /* the panel is taken out below instead */ }
  }
  function today() {
    var d = new Date(), m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }
  function drop(el) { if (el.parentNode) el.parentNode.removeChild(el); }
  function ready() {
    var all = document.querySelectorAll(".community-ask[data-ask-id]");
    for (var i = 0; i < all.length; i++) (function (el) {
      var id = el.getAttribute("data-ask-id"), ends = el.getAttribute("data-ask-ends");
      if (off.indexOf(id) >= 0 || (ends && today() > ends)) { drop(el); return; }
      if (el.querySelector(".ask-dismiss")) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ask-dismiss";
      b.textContent = "×";
      b.setAttribute("aria-label", "Dismiss this request");
      b.title = "Dismiss this request";
      b.style.cssText = "float:right;margin:-0.5rem -0.75rem 0 0.75rem;padding:0.25rem 0.5rem;background:none;border:0;" +
        "color:var(--muted);font:inherit;font-size:1.25rem;line-height:1;cursor:pointer";
      b.addEventListener("click", function () {
        var now = gone();
        if (now.indexOf(id) < 0) now.push(id);
        try { window.localStorage.setItem(KEY, now.join(" ")); } catch (e) { /* storage refused: hidden for this page only */ }
        off = now;
        var to = document.getElementById("main-content");
        drop(el);
        if (to && to.focus) to.focus();
      });
      el.insertBefore(b, el.firstChild);
    })(all[i]);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
