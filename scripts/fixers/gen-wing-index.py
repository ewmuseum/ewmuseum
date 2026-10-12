# Generate promotions/<slug>/index.html for wings that lack one, from the registry row + the wing's served pages (gate-free window). Usage: gen-wing-index.py [--dry]
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys as _gd_sys; _gd_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'fixers')); from gate_detect import live_running as _live_running  # GATE-DETECTOR 2026-10-01: only the live museum's processes count
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import json,os,re,sys,html,glob,subprocess
M=f"{_ROOT}"; dry="--dry" in sys.argv
if not dry and _live_running("scripts/gate\\.sh", _ROOT): sys.exit("REFUSED: a gate is running")
tpl=open(f"{M}/promotions/wwo/index.html").read()
head=tpl.split("<!-- chrome:head:end -->")[0]+"<!-- chrome:head:end -->"
foot="<!-- chrome:footer:start -->"+tpl.split("<!-- chrome:footer:start -->")[1]
promos=json.load(open(f"{M}/data/promotions.json")); plist=promos if isinstance(promos,list) else next(v for v in promos.values() if isinstance(v,list))
def esc(s): return html.escape(str(s or ""),quote=False)
def title_of(path):
    t=open(path).read(); m=re.search(r"<title>(.*?)</title>",t,re.S); tt=html.unescape(m.group(1)) if m else os.path.basename(path)
    return re.sub(r"\s*(&mdash;|—)\s*E-WRESTLING MUSEUM.*$","",tt).strip()
# hook c210 (2026-10-09, finding C13): a new wing's placard is born as a <dl class="meta"> of dt/dd
# rows, the shape fix-wing-placard-dl.py put on every existing wing and style.css styles.
made=[]
for row in plist:
    slug=row.get("id") or row.get("slug"); d=f"{M}/promotions/{slug}"
    if slug and not os.path.isdir(d) and os.path.isdir(f"{M}/data/shards/{slug}"): os.makedirs(d)  # page-less beacons still need a landing page
    if not slug or not os.path.isdir(d) or os.path.exists(f"{d}/index.html"): continue
    name=row.get("name") or slug.upper(); full=row.get("full_name") or name
    years=f"{row.get('founded') or '?'}" + (f"–{row['closed']}" if row.get("closed") else "")
    pn=row.get("provenance_notes") or []; claims=[]
    for e in pn:
        if isinstance(e,dict) and e.get("claim"): claims.append(e["claim"])
        elif isinstance(e,str): claims.append(e)
    arch=sorted(glob.glob(f"{d}/archive/*.html")); rps=sorted(glob.glob(f"{d}/rp/*.html"))
    def li(p): return f'<li><a href="/promotions/{slug}/{os.path.relpath(p,d)}">{esc(title_of(p))}</a></li>'
    arch_html=("<h3>Archive</h3><ul class=\"archive-list\">"+"".join(li(p) for p in arch)+"</ul>") if arch else ""
    rp_html=("<h3>Roleplays</h3><ul class=\"archive-list\">"+"".join(li(p) for p in rps)+"</ul>") if rps else ""
    hold_link=(f'<a href="/promotions/{slug}/holdings.html">Full holdings list</a> &mdash; ' if os.path.exists(f"{d}/holdings.html") else "")
    claims_html="".join(f"<p>{esc(c)}</p>" for c in claims[1:4]); first_claim=esc(claims[0]) if claims else "Accessioned from the 1997 Usenet census; each served document names its own source post."
    h=head.replace("<title>WWO &mdash; E-WRESTLING MUSEUM</title>",f"<title>{esc(name)} &mdash; E-WRESTLING MUSEUM</title>")
    body=f'''
<main class="wrap">
  <p class="crumb"><a href="/">Museum</a> &nbsp;/&nbsp; <a href="/promotions.html">Wings</a> &nbsp;/&nbsp; {esc(name)}</p>
  <!-- wingheader:start -->
  <h1>{esc(name)}{"" if full==name else " &mdash; "+esc(full)}</h1>
  <!-- wingheader:end -->
  <div class="placard">
    <span class="placard-label">Placard</span>
    <dl class="meta">
      <!-- wingyears:start --><dt class="k">Ran</dt><dd>{esc(years)}</dd>
      <!-- wingyears:end -->
      <dt class="k">Full name</dt><dd>{esc(full)}</dd>
      <!-- wingscale:start --><!-- wingscale:end -->
      <!-- wingmedium:start --><dt class="k">Medium</dt><dd>{esc(row.get("medium") or "usenet")}{(" &mdash; "+esc(row.get("medium_detail"))) if row.get("medium_detail") else ""}</dd>
      <!-- wingmedium:end -->
      <!-- wingdiscipline:start --><!-- wingdiscipline:end -->
      <!-- winglocation:start --><!-- winglocation:end -->
      <!-- wingfandom:start --><!-- wingfandom:end -->
      <!-- winghousestyle:start --><!-- winghousestyle:end -->
      <!-- wingplay:start --><dt class="k">Play</dt><dd>{esc(row.get("play") or "unstated")}</dd>
      <!-- wingplay:end -->
      <!-- wingtier:start --><dt class="k">Tier</dt><dd>{esc(row.get("tier") if row.get("tier") is not None else (row.get("band") or "?"))}</dd>
      <!-- wingtier:end -->
      <dt class="k">Depth</dt><dd>{esc(row.get("depth") or "documented")}</dd>
    </dl>
  </div>
  <!-- wingcaption:start --><p class="lede">{esc(row.get("caption") or "A 1997 Usenet e-federation, accessioned from the rec.sport.pro-wrestling.fantasy census.")}</p>
  <!-- wingcaption:end -->
  <!-- storylines:start -->
  <!-- storylines:end -->
  <!-- connections:start -->
  <!-- connections:end -->
  <!-- affiliations:start -->
  <!-- affiliations:end -->
  <!-- browse:start -->
  <h2>Browse live</h2><p class="muted"><a href="/characters.html?promo={slug}">All characters</a> &middot; <a href="/units.html?promo={slug}">All units</a> &middot; <a href="/championships.html?promo={slug}">Championships</a> &middot; <a href="/shows.html?promo={slug}">Shows</a> &middot; <a href="/rps.html?promo={slug}">Roleplays</a></p>
  <!-- browse:end -->
  <!-- provenance:start -->
  <h2>Provenance</h2><p class="muted small">Built from:</p><ul class="meta"><li><span class="k">Usenet, 1997</span> &mdash; rec.sport.pro-wrestling.fantasy and its neighbours, via Google Groups captures; every served document cites its own message id. Accessioned 2026 in the grand accession from the 1997 census.</li></ul>
  <!-- provenance:end -->
  <!--pager:start-->
  <!--pager:end-->
'''
    f=foot.replace("THE E-WRESTLING MUSEUM <span class=\"rule\">/</span> WWO <span class=\"rule\">/</span>",f"THE E-WRESTLING MUSEUM <span class=\"rule\">/</span> {esc(name)} <span class=\"rule\">/</span>").replace("Source: the federation&#x27;s own site via the Wayback Machine.","Source: the 1997 Usenet census (Google Groups captures).")
    page=h+body+f
    if not dry: open(f"{d}/index.html","w").write(page)
    made.append(slug)
print("wing index pages generated:",len(made),made[:30],"| dry:",dry)
