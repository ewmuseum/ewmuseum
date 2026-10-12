#!/usr/bin/env node
/**
 * worker/test-find-record.mjs — the exact-name lookup's own test (hook c136). No network, no Worker runtime, no wrangler:
 *
 *   node worker/test-find-record.mjs
 *
 * A small fixture index and a fake bucket drive the real route (findRecordApi) and the pure half (normalizeName, buildIndex,
 * lookup). Covers: the folds (case, accents, apostrophes, "&", "The", a "(year)" qualifier), id / exact / words tiers, the kind
 * and wing filters, the 20-result cap, the memorial register (D566: a memorial and In Memoriam are records of their own kind; a
 * memorial page is refused in any other kind's row, and a units listing or an a-z index in any row), the served-now check, the
 * limiter, the 400s, and the stale-index refresh.
 */
import {
  normalizeName, nameForms, buildIndex, lookup, allRows, resolveWing, isRecordPage, isMemorialPage, pageOkForKind, findRecordApi, _resetFindCache,
  FIND_INDEX_KEY, FIND_MAX_RESULTS,
} from "./find-record.mjs";

let fails = 0, passes = 0;
function ok(cond, what) { if (cond) passes++; else { fails++; console.log("FAIL: " + what); } }
function eq(a, b, what) { ok(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); }

// --- the pure half ---------------------------------------------------------
eq(normalizeName("  Dragón   O'Brien-Smith & Co. "), "dragon obrien smith and co", "folds accents, apostrophes, punctuation, &");
eq(normalizeName("Ørjan Łukasz ß"), "orjan lukasz ss", "folds letters NFKD leaves alone");
eq(normalizeName("???"), "", "no letters, no name");
eq(nameForms("The Ultimate internet Wrestling Federation (1999–2001)"), ["the ultimate internet wrestling federation 1999 2001", "the ultimate internet wrestling federation", "ultimate internet wrestling federation 1999 2001", "ultimate internet wrestling federation"], "forms");
ok(isRecordPage("/characters/x.html") && isRecordPage("/titles/x.html") && isRecordPage("/promotions/pcw/") && isRecordPage("/promotions/pcw/index.html"), "record pages pass");
ok(!isRecordPage("/memorials/ed-wilson.html") && !isRecordPage("/in-memoriam.html") && !isRecordPage("/units/a-z/a.html") && !isRecordPage("/characters/a-z/o.html") &&
   !isRecordPage("/promotions/pcw/archive/x.html") && !isRecordPage("/characters/../memorials/x.html") && !isRecordPage("/titles/x.html?a=1"), "other pages never pass");
// the memorial shapes (D566): a memorial's own page and In Memoriam itself, and only ever under kind "m"
ok(isMemorialPage("/memorials/ed-wilson.html") && isMemorialPage("/in-memoriam.html"), "the memorial pages pass as memorial pages");
ok(!isMemorialPage("/memorials/a-z/a.html") && !isMemorialPage("/memorials/ed-wilson.html?a=1") && !isMemorialPage("/characters/x.html") &&
   !isMemorialPage("/in-memoriam.html/x") && !isMemorialPage("/memorials/../x.html"), "nothing else is a memorial page");
ok(pageOkForKind("m", "/memorials/ed-wilson.html") && pageOkForKind("m", "/in-memoriam.html") && pageOkForKind("c", "/characters/x.html") &&
   pageOkForKind("t", "/titles/x.html") && pageOkForKind("w", "/promotions/pcw/"), "each kind's own shapes pass");
ok(!pageOkForKind("c", "/memorials/ed-wilson.html") && !pageOkForKind("c", "/in-memoriam.html") && !pageOkForKind("t", "/memorials/x.html") &&
   !pageOkForKind("m", "/characters/x.html") && !pageOkForKind("m", "/promotions/pcw/"), "no kind may carry another kind's page");

const DOC = {
  _schema_version: 1,
  wings: ["pcw", "ufw-ultra-2000", "uwf"],
  rows: [
    ["w", "pcw", "PCW", [0], { a: ["Pro Championship Wrestling"] }],
    ["w", "uwf", "UWF (2001–07)", [2]],
    ["w", "ufw-ultra-2000", "UFW (Ultra)", [1]],
    ["t", "pcw-world", "PCW World Heavyweight Championship", [0]],
    ["t", "pcw-world-tag", "PCW World Tag Team Championship", [0], { a: ["World Tag Titles"] }],
    ["t", "uwf-world", "UWF World Championship", [2]],
    ["c", "robosaurus-pcw", "Robosaurus", [0]],
    ["c", "dragon-obrien-uwf", "Dragón O'Brien", [2], { a: ["The Irish Dragon"] }],
    ["c", "chris-williams-pcw", "Chris Williams", [0]],
    ["c", "chris-williams-uwf", "Chris Williams", [2]],
    ["c", "the-hit-squad-pcw", "The Hit Squad", [0], { s: "tag-team" }],
    ["c", "aerith-heartilly", "Aerith Heartilly", []],     // a character whose page carries "In memoriam / Linked to ..." : ordinary
    ["c", "ed-wilson-pcw", "Ed Wilson", [0]],              // a character sharing a memorial subject's name: D566 returns both
    ["c", "ed-wilson", "Ed Wilson", [0], { p: "/memorials/ed-wilson.html" }],          // a memorial page in a CHARACTER row: dropped at load
    ["c", "units-a", "Units A", [0], { p: "/units/a-z/a.html" }],                        // a units listing: dropped at load
    ["c", "in-memoriam", "In Memoriam", [0], { p: "/in-memoriam.html" }],               // In Memoriam in a character row: dropped at load
    ["c", "mystery", "???", []],
    // THE MEMORIAL REGISTER (D566): kind "m", one row per data/memorials.json row, plus In Memoriam itself
    ["m", "ed-wilson", "Ed Wilson", []],
    ["m", "chris-williams", "Chris Williams", []],
    ["m", "daniel-quirk", "Daniel Quirk", [], { a: ["Dan Quirk"] }],
    ["m", "in-memoriam", "In Memoriam", [], { p: "/in-memoriam.html" }],
    ["m", "smuggled", "Smuggled", [], { p: "/characters/smuggled.html" }],   // a character page in a MEMORIAL row: dropped at load
  ],
};
for (let i = 0; i < 40; i++) DOC.rows.push(["c", "john-smith-" + i, "John Smith " + i, [0]]);
const idx = buildIndex(DOC);
eq(idx.count, 18 + 40, "rows kept (a memorial page in a character row, a character page in a memorial row, a units listing and In Memoriam under the wrong kind: all dropped)");
ok(!allRows(idx).some((r) => /^\/units\/|\/a-z\//.test(r.pagePath)), "no units listing and no a-z index in the index");
ok(allRows(idx).every((r) => (r.kind === "m") === /^\/(memorials\/|in-memoriam)/.test(r.pagePath)), "a memorial page is in the index only under kind m, and an m row has only a memorial page");
eq(allRows(idx).filter((r) => r.kind === "m").map((r) => r.pagePath).sort(),
   ["/in-memoriam.html", "/memorials/chris-williams.html", "/memorials/daniel-quirk.html", "/memorials/ed-wilson.html"], "the memorial rows and their pages");
const names = (q) => lookup(idx, q).results.map((h) => h.row.id + ":" + h.match);
eq(names({ q: "robosaurus" }), ["robosaurus-pcw:exact"], "a character by name");
eq(names({ q: "ROBOSAURUS" }), ["robosaurus-pcw:exact"], "case folded");
eq(names({ q: "Dragon O'Brien" }), ["dragon-obrien-uwf:exact"], "accent and apostrophe folded");
eq(names({ q: "dragon obrien" }), ["dragon-obrien-uwf:exact"], "apostrophe-less");
eq(names({ q: "irish dragon" }), ["dragon-obrien-uwf:exact"], "aka, leading The dropped");
ok(names({ q: "pcw" })[0] === "pcw:id" && names({ q: "pcw" }).includes("pcw-world:words"), "a bare id comes first, word matches follow");
eq(names({ q: "pcw", kind: "wing" }), ["pcw:id"], "kind=wing");
eq(names({ q: "uwf", kind: "wing" }), ["uwf:id"], "wing by the short name of a qualified wing");
eq(names({ q: "UWF 2001 07", kind: "wing" }), ["uwf:exact"], "wing by its full written name");
eq(names({ q: "world", kind: "title", wing: "pcw" }), ["pcw-world-tag:words", "pcw-world:words"], "words, kind and wing; fewest extra words (over name and aka) first");
eq(names({ q: "world", kind: "title" }), ["pcw-world-tag:words", "uwf-world:words", "pcw-world:words"], "world across wings");
eq(names({ q: "world tag titles" }), ["pcw-world-tag:exact"], "title by its aka");
eq(names({ q: "chris williams" }), ["chris-williams:exact", "chris-williams-pcw:exact", "chris-williams-uwf:exact"], "a name that is a memorial subject's and two characters' lists all three, the memorial first (D566)");
eq(names({ q: "chris williams", kind: "memorial" }), ["chris-williams:exact"], "kind=memorial");
eq(names({ q: "chris williams", kind: "character" }), ["chris-williams-pcw:exact", "chris-williams-uwf:exact"], "kind=character leaves the memorial out");
eq(names({ q: "Dan Quirk" }), ["daniel-quirk:exact"], "a memorial by the register's own aka");
eq(names({ q: "daniel-quirk" }), ["daniel-quirk:id"], "a memorial by its id");
eq(names({ q: "chris williams", wing: "uwf" }), ["chris-williams-uwf:exact"], "ambiguous name narrowed by wing");
eq(names({ q: "chris williams", kind: "title" }), [], "kind that does not fit");
eq(names({ q: "hit squad" }), ["the-hit-squad-pcw:exact"], "leading The");
eq(lookup(idx, { q: "john smith" }).total, 40, "total counts every match");
eq(lookup(idx, { q: "john smith", n: 500 }).results.length, FIND_MAX_RESULTS, "capped at 20");
eq(lookup(idx, { q: "john smith" }).results.length, 10, "default 10");
eq(lookup(idx, { q: "j" }).total, 0, "one letter finds nothing");
eq(lookup(idx, { q: "???" }).total, 0, "no letters finds nothing");
eq(lookup(idx, { q: "the" }).total, 0, "a query of only a common word finds nothing");
eq(names({ q: "the hit" }), ["the-hit-squad-pcw:words"], "a common word beside another still must match");
eq(names({ q: "ed wilson" }), ["ed-wilson:exact", "ed-wilson-pcw:exact"], "a memorial subject's name finds the memorial AND the character of that name (D566)");
eq(names({ q: "ed-wilson" }), ["ed-wilson:id", "ed-wilson-pcw:exact"], "the memorial's id is an id match, the character of that name follows");
eq(names({ q: "in memoriam" }), ["in-memoriam:exact"], "In Memoriam is a record of its own (D566)");
eq(names({ q: "in-memoriam" }), ["in-memoriam:id"], "In Memoriam by its id");
eq(names({ q: "in memoriam", kind: "memorial" }), ["in-memoriam:exact"], "In Memoriam under kind=memorial");
eq(names({ q: "aerith heartilly" }), ["aerith-heartilly:exact"], "a memorial-linked character is an ordinary character");
eq(resolveWing(idx, "PCW"), "pcw", "wing by id, any case");
eq(resolveWing(idx, "Pro Championship Wrestling"), "pcw", "wing by name");
eq(resolveWing(idx, "nope"), null, "unknown wing");

// --- the route, over a fake bucket ----------------------------------------
const served = new Set(["characters/robosaurus-pcw.html", "characters/chris-williams-pcw.html", "characters/chris-williams-uwf.html", "titles/pcw-world.html",
  "titles/pcw-world-tag.html", "promotions/pcw/index.html", "characters/dragon-obrien-uwf.html",
  "memorials/ed-wilson.html", "memorials/daniel-quirk.html", "in-memoriam.html", "characters/ed-wilson-pcw.html"]);
let docText = JSON.stringify(DOC), etag = "e1", gets = 0, heads = 0;
const bucket = {
  async head(key) { heads++; if (key === FIND_INDEX_KEY) return { etag }; return served.has(key) ? { key } : null; },
  async get(key) { gets++; if (key !== FIND_INDEX_KEY) return null; return { etag, text: async () => docText }; },
};
const lim = (allow) => ({ limit: async () => ({ success: allow.v }) });
const allowPer = { v: true }, allowSite = { v: true };
const env = { MUSEUM_BUCKET: bucket, FIND_LIMITER: lim(allowPer), FIND_LIMITER_SITE: lim(allowSite) };
const deps = {
  jsonResponse: (pathname, status, obj, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...extra } }),
  searchClientKey: () => "ip4:1.2.3.4", retryAfter: 60,
};
const call = async (qs, e = env) => {
  const u = new URL("https://x.test/api/find-record?" + qs);
  const r = await findRecordApi(new Request(u), e, u, deps);
  return { status: r.status, body: await r.json(), retry: r.headers.get("Retry-After") };
};
let r = await call("q=robosaurus");
eq([r.status, r.body.results.map((x) => x.page)], [200, ["/characters/robosaurus-pcw.html"]], "route: a character");
eq(r.body.results[0].wings, ["pcw"], "route: its wing");
r = await call("q=world&kind=title&wing=pcw");
eq(r.body.results.map((x) => x.id), ["pcw-world-tag", "pcw-world"], "route: titles of a wing");
r = await call("q=pcw&kind=wing");
eq(r.body.results.map((x) => x.page), ["/promotions/pcw/index.html"], "route: a wing's page");
r = await call("q=world&kind=title");
ok(!r.body.results.some((x) => x.id === "uwf-world"), "route: a record whose page is not served is dropped (uwf-world has no served page)");
eq(r.body.total, 3, "route: total is the index's count, not the served count");
r = await call("q=hit+squad");
eq(r.body.results, [], "route: unserved page dropped");
r = await call("q=ed+wilson");
eq([r.status, r.body.results.map((x) => [x.kind, x.page])], [200, [["memorial", "/memorials/ed-wilson.html"], ["character", "/characters/ed-wilson-pcw.html"]]],
   "route: a memorial subject's name answers with the memorial and the character of that name (D566)");
r = await call("q=in+memoriam");
eq([r.status, r.body.results.map((x) => [x.kind, x.page])], [200, [["memorial", "/in-memoriam.html"]]], "route: In Memoriam");
r = await call("q=ed+wilson&kind=memorial");
eq(r.body.results.map((x) => x.id), ["ed-wilson"], "route: kind=memorial");
r = await call("q=chris+williams&kind=memorial");
eq([r.status, r.body.results], [200, []], "route: a memorial whose page is not in the bucket is dropped by the served-now check");
r = await call("q=x&kind=bad");
eq([r.status, r.body.error], [400, "kind must be character, title, wing or memorial"], "route: bad kind, and the message names all four");
r = await call("q=" + "a".repeat(121));
eq(r.status, 400, "route: query too long");
r = await call("q=a");
eq([r.status, r.body.results], [200, []], "route: one letter, no lookup");
r = await call("q=chris+williams&wing=Nowhere+Wrestling");
eq([r.status, r.body.results, r.body.note], [200, [], "no wing has that id or name"], "route: unknown wing");
r = await call("q=chris+williams&wing=PCW");
eq(r.body.results.map((x) => x.id), ["chris-williams-pcw"], "route: wing given in capitals");
// cached: no second GET inside the window
const g0 = gets; await call("q=robosaurus"); eq(gets, g0, "route: the parsed index is reused inside the window");
// limiter
allowPer.v = false; r = await call("q=robosaurus"); eq([r.status, r.retry], [429, "60"], "route: over the per-address limit"); allowPer.v = true;
allowSite.v = false; r = await call("q=robosaurus"); eq(r.status, 429, "route: over the site limit"); allowSite.v = true;
r = await call("q=robosaurus", { MUSEUM_BUCKET: bucket }); eq(r.status, 503, "route: no limiter bound, never unmetered");
// a changed index is picked up after the window (HEAD sees a new etag, GET reloads)
docText = JSON.stringify({ ...DOC, rows: [...DOC.rows, ["c", "new-person", "New Person", []]] }); etag = "e2"; served.add("characters/new-person.html");
r = await call("q=new+person"); eq(r.body.results.length, 0, "route: inside the window the old index answers");
_resetFindCache(); r = await call("q=new+person"); eq(r.body.results.map((x) => x.id), ["new-person"], "route: after the window (cache reset) the new index answers");
// a broken index: 502, no words from the error
docText = "{not json"; etag = "e3"; _resetFindCache();
r = await call("q=robosaurus"); eq([r.status, r.body.error], [502, "unavailable"], "route: a broken index is a 502 'unavailable'");
// a row whose page is not of its own kind is still refused at load, BOTH ways (D566: only an "m" row may carry a memorial page)
docText = JSON.stringify({ _schema_version: 1, wings: [], rows: [["c", "ed-wilson", "Ed Wilson", [], { p: "/memorials/ed-wilson.html" }],
  ["m", "smuggled", "Smuggled", [], { p: "/characters/smuggled.html" }], ["c", "units-a", "Units A", [], { p: "/units/a-z/a.html" }]] });
etag = "e4"; _resetFindCache(); served.add("memorials/ed-wilson.html"); served.add("characters/smuggled.html");
r = await call("q=ed+wilson"); eq(r.body.results, [], "route: a memorial page in a character row is refused at load");
r = await call("q=smuggled"); eq(r.body.results, [], "route: a character page in a memorial row is refused at load");
r = await call("q=units+a"); eq(r.body.results, [], "route: a units listing is refused at load");

console.log(fails ? `test-find-record: ${fails} FAILED, ${passes} passed` : `test-find-record: all ${passes} checks passed`);
process.exit(fails ? 1 : 0);
