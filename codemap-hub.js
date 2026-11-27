// Code map, all projects (2026-11-27): one picture of every session's project. Each project is a hub; its code areas
// (Graphify communities, not every item) hang off it, sized by how many items they hold. Hubs are linked where they
// really connect:
//   folder    one project's folder is inside another's (the outer map holds the inner one's files: "shares N files")
//   imports   one project imports a module that is a file of another project
//   names     both have the same distinct code files (same file names, at least 3)
//   messages  their sessions sent each other messages in the last 24 h (collector relays, counted on the sending side)
//   lineage   two running sessions are generations of the same handed-off work
// Several sessions on one folder share its hub. Only graph.json files that already exist are read (never a build), and
// each is summarised once per change (cached by mtime), so 20 projects with thousands of items each stay light.
const fs = require('fs'), path = require('path');

const MAX_AREAS = 18;            // areas drawn per project (the biggest); the rest are counted
const MAX_AREA_LINKS = 30;       // links between a project's own areas
const CODE_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|py|sh|gs|swift|go|rs|rb|java|kt|php|lua|c|cc|cpp|h|m)$/i;
// file names every project has: not a sign that two projects are related
const COMMON = new Set(('index main app utils util helpers helper common config constants types styles style server client cli build install setup '
  + 'start run test tests init __init__ __main__ lib core api code script scripts manifest package readme makefile update sync check deploy '
  + 'worker job jobs log logger db models model schema store state ui view views tools tool router routes handler handlers env settings').split(' '));
// modules any project may import (standard libraries, the usual packages)
const STD = new Set(('os sys json re time subprocess path fs http https url util crypto events child_process datetime typing logging random math '
  + 'shutil glob pathlib requests tempfile base64 hashlib collections argparse threading socket signal uuid csv io copy functools itertools '
  + 'traceback platform string struct textwrap html email zlib sqlite3 asyncio unittest pickle queue select fcntl contextlib dataclasses enum '
  + 'abc inspect operator decimal statistics secrets getpass mimetypes zipfile tarfile gzip configparser pprint warnings weakref types ssl '
  + 'electron react express axios lodash numpy pandas pil cv2 bpy playwright playwright_async_api playwright_sync_api urllib urllib_request '
  + 'urllib_parse readline net os_path child dotenv yaml toml openai anthropic google googleapiclient selenium bs4 lxml flask fastapi '
  + 'calendar locale gettext codecs unicodedata difflib heapq bisect array ctypes multiprocessing concurrent atexit stat errno '
  + 'subprocess_run exception basehttprequesthandler foundation swiftui uikit combine').split(' '));

const stemOf = f => path.basename(f).replace(/\.[^.]+$/, '').toLowerCase();
const cache = new Map();         // graph.json → { mtime, sum }

// one graph.json → what the overview needs: areas, links between them, file names, imported modules
async function summarize(file, labelsFile) {
  let st; try { st = fs.statSync(file); } catch { return null; }
  const hit = cache.get(file); if (hit && hit.mtime === st.mtimeMs) return hit.sum;
  let g; try { g = JSON.parse(await fs.promises.readFile(file, 'utf8')); } catch { return null; }
  let labels = {}; try { labels = JSON.parse(fs.readFileSync(labelsFile, 'utf8')) || {}; } catch { }
  const nodes = g.nodes || [], links = g.links || g.edges || [];
  const comm = new Map(), cOf = new Map(), files = new Set(), ext = new Set();
  for (const n of nodes) {
    const c = n.community; if (c === undefined || c === null) continue;
    cOf.set(n.id, c);
    let a = comm.get(c); if (!a) comm.set(c, a = { id: c, size: 0, names: new Map() });
    a.size++; if (n.community_name) a.names.set(n.community_name, (a.names.get(n.community_name) || 0) + 1);
    if (n.source_file) files.add(String(n.source_file).replace(/\\/g, '/'));
    else if (n.external || n.file_type === 'concept') ext.add(String(n.norm_label || n.label || '').toLowerCase());
  }
  const all = [...comm.values()].sort((a, b) => b.size - a.size), top = all.slice(0, MAX_AREAS), shown = new Set(top.map(a => a.id));
  const pairs = new Map();
  for (const l of links) {
    const a = cOf.get(l.source), b = cOf.get(l.target);
    if (a === undefined || b === undefined || a === b || !shown.has(a) || !shown.has(b)) continue;
    const k = a < b ? a + '|' + b : b + '|' + a; pairs.set(k, (pairs.get(k) || 0) + 1);
  }
  const nameOf = a => labels[a.id] || labels[String(a.id)] || [...a.names.entries()].sort((x, y) => y[1] - x[1]).map(x => x[0])[0] || 'Area ' + a.id;
  const sum = {
    nodes: nodes.length, edges: links.length, areas: all.length,
    comms: top.map(a => ({ id: a.id, name: String(nameOf(a)).slice(0, 60), size: a.size })),
    clinks: [...pairs.entries()].sort((x, y) => y[1] - x[1]).slice(0, MAX_AREA_LINKS).map(([k, w]) => { const [a, b] = k.split('|'); return [+a, +b, w]; }),
    files: [...files],
    stems: [...new Set([...files].filter(f => CODE_EXT.test(f)).map(stemOf))],
    ext: [...ext].filter(x => x.length >= 4 && !STD.has(x)),
  };
  cache.set(file, { mtime: st.mtimeMs, sum });
  return sum;
}

// ---- Detail view (2026-11-27): the real items and links of each project, sampled ----
// A project can hold 20k items and 35k links, so each graph.json is sampled once per change (cached by mtime): items are
// ordered so that any prefix is a fair sample (each area's best-linked items first, areas in proportion to their size,
// so small areas still show as islands), and links are ordered by their later end, so trimming to the first k items
// keeps exactly the links among them as a prefix too. trimDetail() then shares one budget across all projects.
const DETAIL_ITEMS = 1500, DETAIL_LINKS = 4000;        // per project, before the shared budget
const BUDGET_ITEMS = 9000, BUDGET_LINKS = 15000;       // the whole picture (both Macs)
const dcache = new Map();
async function sample(file, labelsFile) {
  let st; try { st = fs.statSync(file); } catch { return null; }
  const hit = dcache.get(file); if (hit && hit.mtime === st.mtimeMs) return hit.d;
  let g; try { g = JSON.parse(await fs.promises.readFile(file, 'utf8')); } catch { return null; }
  let labels = {}; try { labels = JSON.parse(fs.readFileSync(labelsFile, 'utf8')) || {}; } catch { }
  const nodes = g.nodes || [], links = g.links || g.edges || [], idx = new Map(), deg = new Int32Array(nodes.length);
  nodes.forEach((n, i) => idx.set(n.id, i));
  const L = [];
  for (const l of links) {
    const a = idx.get(typeof l.source === 'object' ? l.source.id : l.source), b = idx.get(typeof l.target === 'object' ? l.target.id : l.target);
    if (a === undefined || b === undefined || a === b) continue; deg[a]++; deg[b]++; L.push(a, b);
  }
  // areas (communities), biggest first: the area's index is its colour
  const comm = new Map();
  nodes.forEach((n, i) => { const c = n.community ?? -1; let a = comm.get(c); if (!a) comm.set(c, a = { id: c, items: [], names: new Map() }); a.items.push(i);
    if (n.community_name) a.names.set(n.community_name, (a.names.get(n.community_name) || 0) + 1); });
  const areas = [...comm.values()].sort((a, b) => b.items.length - a.items.length);
  const key = new Float64Array(nodes.length), areaOf = new Int32Array(nodes.length);
  areas.forEach((a, ai) => { a.items.sort((x, y) => deg[y] - deg[x]); a.items.forEach((i, r) => { key[i] = (r + .5) / a.items.length; areaOf[i] = ai; }); });
  // half the sample is the best-linked items overall (the connected core), half is spread over the areas (islands)
  const byDeg = nodes.map((_, i) => i).sort((x, y) => deg[y] - deg[x]); byDeg.forEach((i, r) => { key[i] = Math.min(key[i], (r + .5) / nodes.length); });
  const order = nodes.map((_, i) => i).sort((x, y) => key[x] - key[y] || deg[y] - deg[x]).slice(0, DETAIL_ITEMS);
  const pos = new Map(order.map((i, k) => [i, k]));
  const keep = [];
  for (let j = 0; j < L.length; j += 2) { const a = pos.get(L[j]), b = pos.get(L[j + 1]); if (a !== undefined && b !== undefined) keep.push([a, b]); }
  const seen = new Set(), ll = [];
  keep.sort((x, y) => Math.max(x[0], x[1]) - Math.max(y[0], y[1]));
  for (const [a, b] of keep) { const k = a < b ? a * 65536 + b : b * 65536 + a; if (seen.has(k)) continue; seen.add(k); ll.push(a, b); if (ll.length >= DETAIL_LINKS * 2) break; }
  // only the areas the sample uses, renumbered
  const used = new Map(), aOut = [];
  const area = order.map(i => { const ai = areaOf[i]; if (!used.has(ai)) { const a = areas[ai]; used.set(ai, aOut.length);
    aOut.push({ name: String(labels[a.id] || labels[String(a.id)] || [...a.names.entries()].sort((x, y) => y[1] - x[1]).map(x => x[0])[0] || (a.id === -1 ? 'Other' : 'Area ' + a.id)).slice(0, 60), size: a.items.length }); }
    return used.get(ai); });
  const files = [], fIdx = new Map();
  const file2 = order.map(i => { const f = nodes[i].source_file ? String(nodes[i].source_file).replace(/\\/g, '/') : ''; if (!f) return -1;
    let k = fIdx.get(f); if (k === undefined) { fIdx.set(f, k = files.length); files.push(f); } return k; });
  const d = { total: nodes.length, totalLinks: links.length, label: order.map(i => String(nodes[i].label || nodes[i].id || '').slice(0, 80)), file: file2, files, area, areas: aOut,
    deg: order.map(i => deg[i]), links: ll };
  dcache.set(file, { mtime: st.mtimeMs, d });
  return d;
}
// share one budget across projects: each gets min(what it has, t), with t chosen so the total fits (small projects whole)
function fill(have, budget) {
  const tot = have.reduce((a, b) => a + b, 0); if (tot <= budget) return have.slice();
  let lo = 0, hi = Math.max(...have);
  for (let i = 0; i < 40; i++) { const t = (lo + hi) / 2; if (have.reduce((a, b) => a + Math.min(b, t), 0) > budget) hi = t; else lo = t; }
  return have.map(h => Math.min(h, Math.floor(lo)));
}
function cut(D, k, m) {
  const ll = []; for (let j = 0; j < D.links.length && ll.length < m * 2; j += 2) { if (D.links[j] < k && D.links[j + 1] < k) ll.push(D.links[j], D.links[j + 1]); else if (Math.max(D.links[j], D.links[j + 1]) >= k) break; }
  return { ...D, label: D.label.slice(0, k), file: D.file.slice(0, k), area: D.area.slice(0, k), deg: D.deg.slice(0, k), links: ll };
}
function trimDetail(out, items = BUDGET_ITEMS, linkBudget = BUDGET_LINKS) {
  const P = (out.projects || []).filter(p => p.detail && p.detail.label);
  const ks = fill(P.map(p => p.detail.label.length), items);
  const avail = P.map((p, i) => { let n = 0; const L = p.detail.links; for (let j = 0; j < L.length; j += 2) { if (Math.max(L[j], L[j + 1]) >= ks[i]) break; n++; } return n; });
  const ms = fill(avail, linkBudget);
  P.forEach((p, i) => { p.detail = cut(p.detail, ks[i], ms[i]); });
  out.shown = P.reduce((a, p) => a + p.detail.label.length, 0); out.totalItems = P.reduce((a, p) => a + p.detail.total, 0);
  out.shownLinks = P.reduce((a, p) => a + p.detail.links.length / 2, 0);
  return out;
}

// sessions: [{ sid, name, project (folder or null), peer, avatar, color, health, lineage, relays: [{name, pid}] }]
// where(project) → { graph, dir, own, meta } (codemap.js), jobs() → { running, queued }
// detail: also each project's sampled items and links (the Detail view; a separate, heavier call)
async function build({ sessions, where, jobs, home, detail }) {
  const tilde = p => p && home && (p === home || p.startsWith(home + path.sep)) ? '~' + p.slice(home.length) : p;
  const byKey = new Map(), J = jobs ? jobs() : { running: null, queued: [] };
  for (const s of sessions) {
    const key = s.project ? (s.peer ? 'peer:' : '') + s.project : null; s.key = key;
    if (!key) continue;
    let P = byKey.get(key);
    if (!P) byKey.set(key, P = { key, project: s.project, name: path.basename(s.project) || s.project, path: tilde(s.project), peer: !!s.peer, sessions: [] });
    P.sessions.push(s.sid);
  }
  const projects = [...byKey.values()];
  for (const P of projects) {
    if (P.peer) { P.built = null; continue; }      // the other Mac's maps are opened (and built) there
    const w = where(P.project), sum = await summarize(w.graph, path.join(w.dir, '.graphify_labels.json'));
    P.own = w.own; P.running = J.running === P.project; P.queued = J.queued.includes(P.project);
    if (!sum) { P.built = false; continue; }
    let at = w.meta && w.meta.at; if (!at) { try { at = fs.statSync(w.graph).mtimeMs; } catch { } }
    Object.assign(P, { built: true, at, nodes: sum.nodes, edges: sum.edges, areas: sum.areas, comms: sum.comms, clinks: sum.clinks });
    P._sum = sum;
    if (detail) P.detail = await sample(w.graph, path.join(w.dir, '.graphify_labels.json'));
  }
  // ---- links between projects ----
  const links = [], add = (a, b, type, label, w = 1) => { if (a !== b) links.push({ a, b, type, label, w }); };
  const local = projects.filter(p => !p.peer);
  for (const A of local) for (const B of local) {
    if (A === B) continue;
    const rel = path.relative(A.project, B.project);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {        // B lives inside A
      const pre = rel.split(path.sep).join('/') + '/';
      const shared = A._sum ? A._sum.files.filter(f => f.startsWith(pre)).length : 0;
      add(A.key, B.key, 'folder', `${B.name} is a folder inside ${A.name}` + (shared ? ` · ${A.name}'s map shares ${shared} of its files` : ''), 2);
    }
  }
  const nested = (a, b) => links.some(l => l.type === 'folder' && ((l.a === a && l.b === b) || (l.a === b && l.b === a)));
  for (let i = 0; i < local.length; i++) for (let j = 0; j < local.length; j++) {
    const A = local[i], B = local[j]; if (i === j || !A._sum || !B._sum || nested(A.key, B.key)) continue;
    const own = new Set(A._sum.stems), bs = new Set(B._sum.stems);
    const imp = A._sum.ext.filter(x => bs.has(x) && !own.has(x) && !COMMON.has(x));
    if (imp.length) add(A.key, B.key, 'imports', `${A.name} imports ${imp.length} module${imp.length > 1 ? 's' : ''} of ${B.name}: ${imp.slice(0, 4).join(', ')}${imp.length > 4 ? '…' : ''}`, 1 + Math.min(imp.length, 4) / 2);
    if (j > i) {
      const names = f => new Set(f.filter(x => CODE_EXT.test(x) && !COMMON.has(stemOf(x))).map(x => path.posix.basename(x).toLowerCase()));
      const bn = names(B._sum.files), same = [...names(A._sum.files)].filter(x => bn.has(x));
      if (same.length >= 3) add(A.key, B.key, 'names', `${same.length} same file names: ${same.slice(0, 4).join(', ')}${same.length > 4 ? '…' : ''}`, 1);
    }
  }
  // sessions: messages between them (24 h) and the same lineage
  const bySid = new Map(sessions.map(s => [s.sid, s]));
  const byName = new Map(sessions.map(s => [String(s.name || '').toLowerCase(), s])), byPid = new Map(sessions.filter(s => s.pid).map(s => [s.pid, s]));
  const msg = new Map();
  for (const s of sessions) for (const r of s.relays || []) {
    const o = byPid.get(r.pid) || (r.name && byName.get(String(r.name).toLowerCase())); if (!o || o === s || !o.key || !s.key) continue;
    const k = [s.sid, o.sid].sort().join('|'); msg.set(k, (msg.get(k) || 0) + 1);
  }
  const slinks = [];
  for (const [k, n] of msg) { const [a, b] = k.split('|'); slinks.push({ a, b, type: 'messages', label: `${bySid.get(a).name} and ${bySid.get(b).name}: ${n} message${n > 1 ? 's' : ''} sent in the last 24 h`, w: 1 + Math.min(n, 10) / 5 }); }
  const lin = new Map(); for (const s of sessions) if (s.lineage && s.key) lin.set(s.lineage, (lin.get(s.lineage) || []).concat(s));
  for (const g of lin.values()) for (let i = 1; i < g.length; i++) slinks.push({ a: g[0].sid, b: g[i].sid, type: 'lineage', label: `${g[0].name} and ${g[i].name}: the same handed-off work (lineage)`, w: 1.5 });
  for (const P of projects) delete P._sum;
  const out = {
    at: Date.now(), projects, links, slinks, detail: !!detail,
    sessions: sessions.map(s => ({ sid: s.sid, name: s.name, key: s.key, peer: !!s.peer, avatar: s.avatar || null, color: s.color || null, health: s.health || '' })),
  };
  return detail ? trimDetail(out) : out;
}

// the other Mac's half (its build() result) merged into this one: its projects keep their maps (opened and built there);
// a folder both Macs work in (same path under home) is one hub; a folder inside another counts across Macs too
function mergePeer(mine, theirs) {
  if (!theirs) return mine;
  const out = { ...mine, projects: mine.projects.slice(), links: mine.links.slice(), slinks: (mine.slinks || []).concat(theirs.slinks || []), sessions: mine.sessions.slice() };
  const byPath = new Map(out.projects.map(P => [P.path, P])), remap = new Map();
  const STAT = ['built', 'at', 'nodes', 'edges', 'areas', 'comms', 'clinks', 'detail'];
  for (const T of theirs.projects || []) {
    const same = byPath.get(T.path);
    if (same) {
      same.sessions = same.sessions.concat(T.sessions); remap.set(T.key, same.key);
      if (!same.built && T.built) for (const k of STAT) same[k] = T[k];
      else if (!same.detail && T.detail) same.detail = T.detail;
      continue;
    }
    const key = 'peer:' + T.key; remap.set(T.key, key);
    const P = { ...T, key, peer: true }; out.projects.push(P); byPath.set(P.path, P);
  }
  const rk = k => remap.get(k) || k;
  for (const l of theirs.links || []) out.links.push({ ...l, a: rk(l.a), b: rk(l.b) });
  for (const s of theirs.sessions || []) out.sessions.push({ ...s, key: s.key ? rk(s.key) : s.key, peer: true });
  // folder inside another, across the two Macs (paths are written from home: ~/…)
  const mineKeys = new Set(mine.projects.map(P => P.key)), has = (a, b) => out.links.some(l => (l.a === a && l.b === b) || (l.a === b && l.b === a));
  for (const A of out.projects) for (const B of out.projects) {
    if (A === B || mineKeys.has(A.key) === mineKeys.has(B.key) || !A.path || !B.path) continue;
    if (B.path.startsWith(A.path.replace(/\/$/, '') + '/') && !has(A.key, B.key)) out.links.push({ a: A.key, b: B.key, type: 'folder', label: `${B.name} is a folder inside ${A.name}`, w: 2 });
  }
  return out;
}

module.exports = { build, summarize, mergePeer, sample, trimDetail };
