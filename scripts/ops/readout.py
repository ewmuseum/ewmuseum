#!/usr/bin/env python3
"""Render the coordinator readout from files only (the Janitor 2026-09-08: no hand-maintained status pages). Every figure is
computed at render time; a section whose source is missing says so. Output: S/museum-readout.html (published by the
coordinator after each chain). Sources: museum git log + data, S/gate*/chain*/window* logs, wave dirs, the Janitor's pile
(entries without an ANSWERED line), the journal tail, the fusebox files."""
import os as _os
_ROOT = _os.environ.get('MUSEUM_ROOT') or _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
_WORKSHOP = _os.environ.get('WORKSHOP_ROOT') or _os.path.join(_os.path.dirname(_ROOT), 'archive')
_SCRATCH = _os.environ.get('SCRATCH_ROOT') or _os.path.join(_WORKSHOP, 'ops-scratch')
_TOOLS = _os.path.dirname(_os.path.abspath(__file__))
_NODEBIN = _os.environ.get('NODE_BIN') or ''
import glob, html, json, os, re, subprocess, time
S = f'{_SCRATCH}'
A = f'{_WORKSHOP}'; M = f'{_ROOT}'
now = time.time(); esc = html.escape
def rd(p):
    try: return open(p, encoding='utf-8', errors='replace').read()
    except OSError: return ''
def when(ts): return time.strftime('%a %d %b %H:%M', time.localtime(ts))
def ago(ts):
    d = int(now - ts); return f'{d//3600}h {d%3600//60}m ago' if d >= 3600 else f'{d//60}m ago'
# --- commit
try: log = subprocess.run(['git', '-C', M, 'log', '-1', '--format=%h%x09%ci%x09%s'], capture_output=True, text=True).stdout.strip().split('\t')
except Exception: log = []
# --- figures
# --- figures: AS PUBLISHED (git HEAD = what r2-sync served), plus the workshop delta awaiting the next green gate (the Janitor 2026-09-08)
import tempfile, shutil
def figures_from(root, served_count):
    def count(kind):
        n = 0
        for f in glob.glob(f'{root}/data/shards/*/{kind}.json'):
            try: n += len(json.load(open(f)))
            except Exception: pass
        return n
    P = json.load(open(f'{root}/data/promotions.json'))['promotions']
    types = {}
    for r in P: types[r.get('type') or '?'] = types.get(r.get('type') or '?', 0) + 1
    F = json.load(open(f'{root}/data/frontier.json')); frows = F if isinstance(F, list) else F.get('rows') or []
    lots = len(json.load(open(f'{root}/data/collections.json'))['collections'])
    return {'wings': len(P), 'types': types, 'lots': lots, 'served': served_count, 'characters': count('characters'), 'units': count('units'),
            'titles': count('titles'), 'reigns': count('reigns'), 'shows': count('shows'), 'rps': count('rps'), 'frontier': len(frows),
            'held': sum(1 for r in frows if r.get('status') == 'held')}
tmp = tempfile.mkdtemp(prefix='readout-head-')
subprocess.run(f'git archive HEAD data/promotions.json data/frontier.json data/collections.json data/shards | tar -x -C {tmp}', shell=True, cwd=M, check=True)
head_pages = subprocess.run(['git', 'ls-tree', '-r', '--name-only', 'HEAD', 'promotions/'], capture_output=True, text=True, cwd=M).stdout.split('\n')
pub = figures_from(tmp, sum(1 for x in head_pages if re.search(r'/(archive|rp)/[^/]+\.html$', x)))
shutil.rmtree(tmp, ignore_errors=True)
wt = figures_from(M, len(glob.glob(f'{M}/promotions/*/archive/*.html')) + len(glob.glob(f'{M}/promotions/*/rp/*.html')))
figs = [(pub['wings'], 'wings · ' + ' · '.join(f'{v} {k}' for k, v in sorted(pub['types'].items(), key=lambda x: -x[1]))), (pub['lots'], 'accession lots'),
        (pub['served'], 'served documents (cards, roleplays, records)'), (pub['characters'], f"characters · {pub['units']:,} units"),
        (pub['titles'], f"titles · {pub['reigns']:,} reigns"), (pub['shows'], f"shows · {pub['rps']:,} roleplay records"),
        (pub['frontier'] - pub['held'], f"open frontier leads · {pub['held']:,} more leads already promoted to wings")]
delta = {k: wt[k] - pub[k] for k in ('wings', 'served', 'characters', 'units', 'titles', 'reigns', 'shows', 'rps', 'lots')}
delta_line = ', '.join(f"{v:+,} {k}" for k, v in delta.items() if v) or 'none'
# --- gates (from logs; newest first)
gates = {}
for f in glob.glob(f'{S}/gate*.log'):
    m = re.match(r'gate(\d+)(?:-run(\d+))?\.log$', os.path.basename(f))
    if not m: continue
    n = int(m.group(1)); g = gates.setdefault(n, {'runs': 0, 'verdict': '', 'stamp': '', 'when': 0, 'red': 0})
    txt = rd(f); g['runs'] += 1; mt = os.path.getmtime(f)
    if mt > g['when']:
        g['when'] = mt; s = re.search(r'GATE-GREEN — stamp (\w+)', txt)
        if 'GATE_RC=0' in txt: g['verdict'] = 'green'; g['stamp'] = s.group(1)[:10] if s else ''
        elif 'GATE_RC=' in txt: g['verdict'] = 'red'; g['red'] = len(re.findall(r'^✗|PRIVACY-FAIL', txt, re.M))
        else: g['verdict'] = 'running'
for f in glob.glob(f'{S}/chain*.log'):
    m = re.match(r'chain(\d+)\.log$', os.path.basename(f))
    if not m: continue
    n = int(m.group(1)); g = gates.setdefault(n, {'runs': 0, 'verdict': '', 'stamp': '', 'when': 0, 'red': 0}); txt = rd(f)
    c = re.search(r'committed (\w+)', txt); g['commit'] = c.group(1)[:10] if c else ''
    g['applied'] = len(re.findall(r'^applied delta', txt, re.M)); g['chain_when'] = os.path.getmtime(f)
    g['chain'] = 'done' if ('CHAIN_RC' in txt or 'DONE' in txt or now - g['chain_when'] > 3 * 3600) else 'running'
    if not g['verdict'] and g['commit']: g['verdict'] = 'green (gate log rotated)'
for f in glob.glob(f'{S}/window*.log'):
    m = re.match(r'window(\d+)\.log$', os.path.basename(f))
    if not m: continue
    n = int(m.group(1)); g = gates.setdefault(n, {'runs': 0, 'verdict': '', 'stamp': '', 'when': 0, 'red': 0}); txt = rd(f)
    g['window'] = 'done' if 'WINDOW_RC' in txt else 'running'; g['window_when'] = os.path.getmtime(f)
def gate_row(n, g):
    cells = [f'<td>{n}</td>', f"<td>{esc(g.get('verdict') or '—')}{(' · ' + str(g['runs']) + ' runs') if g.get('runs', 0) > 1 else ''}{(' · ' + str(g['red']) + ' ✗') if g.get('red') else ''}</td>",
             f"<td><code>{esc(g.get('commit') or '')}</code>{(' · ' + str(g.get('applied')) + ' waves') if g.get('applied') else ''}{' · ' + g['chain'] if g.get('chain') else ''}</td>",
             f"<td>{g.get('window') or '—'}</td>", f"<td>{when(max(g.get('when', 0), g.get('chain_when', 0), g.get('window_when', 0)))}</td>"]
    return '<tr>' + ''.join(cells) + '</tr>'
recent = sorted((n for n in gates if n >= max(gates) - 7), reverse=True)
# --- waves
wave_dirs = glob.glob(f'{A}/usenet-retro/scratch-*/wave-*') + glob.glob(f'{A}/fwrestling-census/waves/wave-*') + glob.glob(f'{A}/geocities-torrent/waves/wave-*')
applied, ready, landed, live = [], [], [], []
for w in wave_dirs:
    if not os.path.isdir(f'{w}/delta'): continue
    name = os.path.basename(w); _fs = [os.path.getmtime(p) for p in glob.glob(f'{w}/**', recursive=True) if os.path.isfile(p)]; mt = max(_fs) if _fs else os.path.getmtime(w)
    if os.path.exists(f'{w}/APPLIED'): applied.append((os.path.getmtime(f'{w}/APPLIED'), name))
    elif os.path.exists(f'{w}/READY'): ready.append((os.path.getmtime(f'{w}/READY'), name))
    elif (os.path.exists(f'{w}/findings.md') or os.path.exists(f'{w}/digest.md')) and os.path.isdir(f'{w}/delta'): landed.append((mt, name))  # read-only waves (no delta) have nothing to apply and are not 'parked' (2026-09-12)
    elif now - mt < 4 * 3600: live.append((mt, name))
applied.sort(reverse=True); ready.sort(reverse=True); landed.sort(reverse=True); live.sort(reverse=True)
# --- the Janitor pile: items not marked ANSWERED
pile = rd(f'{A}/desk/\x66ounder-pile-2026-09-06-unmasked.md'); open_items = []
blocks = re.split(r'\n(?=#{2,3} )', pile)
for b in blocks:
    h = b.split('\n', 1)[0]
    if not re.match(r'#{2,3} ', h): continue
    title = re.sub(r'^#+\s*', '', h).strip()
    if title.startswith(('ALREADY ANSWERED', 'OPEN QUESTIONS', 'Residual', 'Files', '2026-09-07 additions')): continue
    if re.search(r'^ANSWERED', b, re.M): continue
    body = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', b.split('\n', 1)[1] if '\n' in b else '')).strip()
    open_items.append((title, body[:420] + ('…' if len(body) > 420 else '')))
# --- fusebox
fuse = []
for f in glob.glob(f'{A}/net/fusebox/*.json'):
    try: d = json.load(open(f))
    except Exception: continue
    tu = d.get('tripped_until') or 0
    fuse.append((d.get('host', os.path.basename(f)), 'tripped until ' + when(tu) if tu > now else 'closed', d.get('trips', 0)))
# the Janitor 2026-09-09: the direct liveness leg registers every probed host with the fusebox — list only the real fetch targets and anything tripped or ever-tripped; fold the rest into one count
CORE = {'web.archive.org', 'web.archive.org:cdx', 'fwrestling.com', 'index.commoncrawl.org', 'cult.freeforums.net', 'www.uwm.edu'}
probe_hosts = [x for x in fuse if x[0] not in CORE and x[2] == 0 and x[1] == 'closed']
fuse = [x for x in fuse if x[0] in CORE or x[2] > 0 or x[1] != 'closed']
if probe_hosts: fuse.append((f'{len(probe_hosts)} other hosts', 'probed once by the direct liveness leg, all closed', 0))
# --- journal tail
jl = [l for l in rd(f'{A}/desk/coordinator-journal.md').split('\n') if l.strip()][-14:]
# --- render
out = [f'<title>Coordinator Readout</title>\n<style>\n:root{{--bg:#f6f4ee;--ink:#1e1c18;--mute:#6b665c;--rule:#d8d2c4;--acc:#7a4b1d;--ok:#2e6b3a;--bad:#9a2f2f;}}\n@media (prefers-color-scheme: dark){{:root:not([data-theme="light"]){{--bg:#171613;--ink:#ebe7dd;--mute:#a39d90;--rule:#3a3730;--acc:#d9a86c;--ok:#7fc48f;--bad:#e08a8a;}}}}\n:root[data-theme="dark"]{{--bg:#171613;--ink:#ebe7dd;--mute:#a39d90;--rule:#3a3730;--acc:#d9a86c;--ok:#7fc48f;--bad:#e08a8a;}}\nbody{{background:var(--bg);color:var(--ink);font:15px/1.5 Georgia,"Times New Roman",serif;margin:0;padding:2.5rem 1.25rem;}}\nmain{{max-width:52rem;margin:0 auto;}} h1{{font-size:1.5rem;margin:0 0 .25rem;}} h2{{font-size:1.05rem;letter-spacing:.04em;text-transform:uppercase;color:var(--acc);margin:2rem 0 .6rem;}}\n.mute{{color:var(--mute);font-size:.88rem;}} .figs{{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:.6rem 1rem;margin:1rem 0;}} .figs b{{display:block;font-size:1.5rem;font-variant-numeric:tabular-nums;}} .figs span{{font-size:.85rem;color:var(--mute);}}\n.tw{{overflow-x:auto;}} table{{border-collapse:collapse;width:100%;font-size:.9rem;}} td,th{{padding:.3rem .5rem;border-bottom:1px solid var(--rule);text-align:left;vertical-align:top;}} th{{color:var(--mute);font-weight:normal;font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;}}\ncode{{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.88em;}} ul{{padding-left:1.1rem;}} li{{margin:.25rem 0;}} .j li{{font-size:.86rem;color:var(--mute);}} .item b{{display:block;}}\n</style>\n<main>']
out.append(f'<h1>Coordinator readout</h1><p class="mute">Rendered {when(now)} PT from the museum tree, the cycle logs, the wave directories, the desk pile kept for the Janitor and the journal. Nothing on this page is typed by hand; a figure that cannot be computed is omitted.</p>')
if log and len(log) == 3: out.append(f'<p><b>Last commit</b> <code>{esc(log[0])}</code> · {esc(log[1][:16])} · {esc(log[2])}</p>')
out.append('<p class="mute">Figures are the site as published (commit <code>{{HEADSHORT}}</code>). Applied in the workshop but unpublished until the next green gate: {{DELTA}}.</p><div class="figs">' + ''.join(f'<div><b>{v:,}</b><span>{esc(l)}</span></div>' for v, l in figs) + '</div>')
import subprocess as _sp; _sp.run(['python3', f'{A}/tools/coordinator-2026-09-03/deploy-status.py'], capture_output=True)  # refresh the publish row at render time
# ---- Publish state (the Janitor 2026-09-15): the live site and the GitHub mirror, from desk/deploy-status.tsv + failure markers ----
try:
    _rows=[l.split('\t') for l in open(f'{A}/desk/deploy-status.tsv').read().strip().split('\n')[1:] if l.strip()]
    _r=_rows[-1] if _rows else None
except Exception: _r=None
_flags=[m for m in ('DEPLOY-FAILED','PUSH-FAILED') if os.path.exists(f'{A}/desk/{m}')]
if _r:
    _state=('<span style="color:var(--bad)">RED</span>' if _r[7]=='RED' else '<span style="color:var(--ok)">ok</span>')
    out.append('<h2>Publish</h2><p>'+_state+f' · checked {esc(_r[0])} · HEAD <code>{esc(_r[1])}</code> · last successful R2 sync {esc(_r[4])} · newest chain r2-sync rc {esc(_r[5])} ({esc(_r[6])}) · {esc(_r[2])} commit(s) unpushed to origin, {esc(_r[3])} behind'+(' · markers: '+', '.join(_flags) if _flags else '')+'</p><p class="mute">Source: tools/coordinator-2026-09-03/deploy-status.py, run by every standing check and after every chain. A red here means the site or the mirror is behind the registry.</p>')
out.append('<h2>Gates</h2><div class="tw"><table><tr><th>gate</th><th>verdict</th><th>chain</th><th>window</th><th>last activity</th></tr>' + ''.join(gate_row(n, gates[n]) for n in recent) + '</table></div>')
out.append('<h2>Waves</h2>')
out.append('<p><b>In flight</b> (wave directories active in the last four hours, no findings yet): ' + (', '.join(esc(n) + f' <span class="mute">({ago(t)})</span>' for t, n in live) or 'none') + '</p>')
fresh = [(t, n) for t, n in landed if now - t < 12 * 3600]
out.append('<p><b>Landed, in fixes</b> (last 12 hours): ' + (', '.join(esc(n) + f' <span class="mute">({ago(t)})</span>' for t, n in fresh) or 'none') + (f' <span class="mute">· {len(landed) - len(fresh)} older landed waves parked without READY</span>' if len(landed) > len(fresh) else '') + '</p>')
out.append('<p><b>READY for the next chain</b>: ' + (', '.join(esc(n) for t, n in ready) or 'none') + '</p>')
out.append('<p><b>Applied most recently</b>: ' + ', '.join(esc(n) + f' <span class="mute">({when(t)})</span>' for t, n in applied[:12]) + '</p>')
out.append('<h2>Calls only the Janitor can make</h2>' + ('<ul>' + ''.join(f'<li class="item"><b>{esc(t)}</b>{esc(b)}</li>' for t, b in open_items) + '</ul>' if open_items else '<p>None open.</p>') + f'<p class="mute">Source: the desk pile kept for the Janitor, in the workshop — an entry leaves this list when it carries an ANSWERED line.</p>')
# --- the YouTube slow burn (the workshop's YouTube preservation; the Janitor gavel 2026-09-02: same overnight schedule as the Archive window)
yt = ''
try:
    import csv as _csv, subprocess as _sp
    Y = f'{A}/yt-preservation'
    plan = list(_csv.DictReader(open(f'{Y}/download-plan.tsv', encoding='utf-8'), delimiter='\t'))
    done = {l.split()[1] for l in open(f'{Y}/downloaded.txt', encoding='utf-8') if l.startswith('youtube ')} if os.path.exists(f'{Y}/downloaded.txt') else set()
    skip = {l.strip() for l in open(f'{Y}/skip-terminal.txt', encoding='utf-8') if l.strip()} if os.path.exists(f'{Y}/skip-terminal.txt') else set()
    rem = sum(1 for r in plan if r.get('priority_tier') in ('2', '3') and r.get('video_id') not in done and r.get('video_id') not in skip)
    alive = bool(_sp.run(['pgrep', '-f', 'daily-burn[.]sh'], capture_output=True).stdout.strip())
    night = ''; lastclose = ''
    for line in open(f'{Y}/daily-burn.log', encoding='utf-8', errors='replace').read().split('\n'):  # whole log: chunk lines crowd out the night/window lines
        if '[burn] night' in line: night = line.split('night ')[1].split(':')[0]
        if '[window] close' in line: lastclose = line.split('close ')[1][:16].replace('T', ' ')
    yt = f'<li>YouTube slow burn: {"alive" if alive else "NOT RUNNING"} · night {esc(night) or "?"} of the campaign · {len(done):,} videos in the ledger · {rem:,} tier-2/3 videos remaining · last window closed {esc(lastclose) or "—"}</li>'
except Exception as e:
    yt = f'<li>YouTube slow burn: could not be read ({esc(str(e))})</li>'
out.append('<h2>Fetchers</h2><ul>' + ''.join(f'<li>{esc(h)}: {esc(s)} · {t} trips</li>' for h, s, t in sorted(fuse)) + yt + '</ul>')
out.append('<h2>Journal, last entries</h2><ul class="j">' + ''.join(f'<li>{esc(l)}</li>' for l in jl) + '</ul></main>')
open(f'{S}/museum-readout.html', 'w', encoding='utf-8').write('\n'.join(out).replace('{{HEADSHORT}}', esc(log[0]) if log and len(log) == 3 else 'HEAD').replace('{{DELTA}}', esc(delta_line))); print('readout rendered:', len('\n'.join(out)), 'bytes;', len(open_items), 'open Janitor items;', len(recent), 'gates')
