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

// sessions: [{ sid, name, project (folder or null), peer, avatar, color, health, lineage, relays: [{name, pid}] }]
// where(project) → { graph, dir, own, meta } (codemap.js), jobs() → { running, queued }
async function build({ sessions, where, jobs, home }) {
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
  return {
    at: Date.now(), projects, links, slinks,
    sessions: sessions.map(s => ({ sid: s.sid, name: s.name, key: s.key, peer: !!s.peer, avatar: s.avatar || null, color: s.color || null, health: s.health || '' })),
  };
}

// the other Mac's half (its build() result) merged into this one: its projects keep their maps (opened and built there);
// a folder both Macs work in (same path under home) is one hub; a folder inside another counts across Macs too
function mergePeer(mine, theirs) {
  if (!theirs) return mine;
  const out = { ...mine, projects: mine.projects.slice(), links: mine.links.slice(), slinks: (mine.slinks || []).concat(theirs.slinks || []), sessions: mine.sessions.slice() };
  const byPath = new Map(out.projects.map(P => [P.path, P])), remap = new Map();
  const STAT = ['built', 'at', 'nodes', 'edges', 'areas', 'comms', 'clinks'];
  for (const T of theirs.projects || []) {
    const same = byPath.get(T.path);
    if (same) {
      same.sessions = same.sessions.concat(T.sessions); remap.set(T.key, same.key);
      if (!same.built && T.built) for (const k of STAT) same[k] = T[k];
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

module.exports = { build, summarize, mergePeer };
