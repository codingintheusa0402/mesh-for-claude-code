// Which local folder a session keeps its work in (2026-11-01) — shown as a folder button in Sessions and a cargo pod
// orbiting the session's bubble; clicking either opens it in Finder.
//   · the session's working folder, when that isn't the home folder
//   · otherwise the project folder its tools touch most (file paths and paths in shell commands, last 4 MB of the
//     transcript), rolled up to the nearest folder that looks like a project (.git, README, package.json …) or to the
//     top-level folder under home. Hidden folders (~/.claude …), Library and temp folders don't count.
// Cached per transcript size, so a session is re-read only when it wrote something new.
const fs = require('fs'), path = require('path');

const TAIL = 4 * 1024 * 1024, MIN_HITS = 3;
const MARKERS = ['.git', 'README.md', 'readme.md', 'package.json', 'pyproject.toml', 'requirements.txt', '.clasp.json', 'project.yml', 'SKILL.md', 'Package.swift', 'go.mod', 'Cargo.toml'];
const CONTAINERS = new Set(['Desktop', 'Documents', 'Apps', 'Projects', 'Developer', 'code', 'src', 'repos', 'work']);
const SKIP_TOP = new Set(['Library', 'Applications', 'tmp', 'Pictures', 'Movies', 'Music', 'Public']);

function createFolders({ findTranscript, home }) {
  const cache = new Map(), markerCache = new Map();
  const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  const hasMarker = d => { if (!markerCache.has(d)) markerCache.set(d, MARKERS.some(m => fs.existsSync(path.join(d, m)))); return markerCache.get(d); };
  // a folder whose sub-folders are ≥ 5 separate projects (e.g. a team repo with GAS_*/Scrapers/* …)
  const mono = new Map();
  function isMonorepo(d) {
    if (mono.has(d)) return mono.get(d);
    let n = 0;
    try { for (const a of fs.readdirSync(d)) { const p1 = path.join(d, a); if (a.startsWith('.') || !isDir(p1)) continue; if (hasMarker(p1)) n++;
      else try { for (const b of fs.readdirSync(p1)) { const p2 = path.join(p1, b); if (!b.startsWith('.') && isDir(p2) && hasMarker(p2)) n++; if (n >= 5) break; } } catch { } if (n >= 5) break; } } catch { }
    mono.set(d, n >= 5); return n >= 5;
  }
  function root(p) {
    if (!p.startsWith(home + '/')) return null;
    const rel = p.slice(home.length + 1).split('/').filter(Boolean);
    if (!rel.length || rel[0].startsWith('.') || SKIP_TOP.has(rel[0])) return null;
    if (CONTAINERS.has(rel[0]) && rel.length <= 2) return null;            // a loose file in ~/Desktop, ~/Apps … isn't a project
    // the nearest folder above the file that looks like a project (but never home itself or a bare container)
    let d = isDir(p) ? p : path.dirname(p);
    while (d.length > home.length + 1) {
      const r = d.slice(home.length + 1).split('/');
      if (!(r.length === 1 && CONTAINERS.has(r[0])) && hasMarker(d)) {
        // a monorepo root (a repo whose folders are projects of their own) yields to the project inside it
        return d;
      }
      d = path.dirname(d);
    }
    const top = CONTAINERS.has(rel[0]) && rel.length > 2 ? path.join(home, rel[0], rel[1]) : path.join(home, rel[0]);
    return isDir(top) ? top : null;
  }
  function scan(file) {
    let st; try { st = fs.statSync(file); } catch { return null; }
    const c = cache.get(file); if (c && c.size === st.size) return c.best;   // (allOf() reads c.all)
    const start = Math.max(0, st.size - TAIL), len = st.size - start, buf = Buffer.alloc(len);
    const fd = fs.openSync(file, 'r'); try { fs.readSync(fd, buf, 0, len, start); } finally { fs.closeSync(fd); }
    const hits = new Map(), seenDir = new Map();
    const homeRe = new RegExp('(?:~|' + home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')/[^\\s\'"`;|&<>(),\\\\]+', 'g');
    for (const l of buf.toString('utf8').split('\n')) {
      if (l.indexOf('"tool_use"') < 0) continue;
      let j; try { j = JSON.parse(l); } catch { continue; }
      const content = j.message && Array.isArray(j.message.content) ? j.message.content : [];
      for (const b of content) {
        if (b.type !== 'tool_use' || !b.input) continue;
        const text = ['file_path', 'path', 'notebook_path', 'command', 'cwd'].map(k => typeof b.input[k] === 'string' ? b.input[k] : '').join('\n');
        for (const m of text.match(homeRe) || []) {
          const p = (m.startsWith('~') ? home + m.slice(1) : m).replace(/[.:]+$/, '');
          const key = path.dirname(p);
          let r = seenDir.get(key); if (r === undefined) { r = root(p); seenDir.set(key, r); if (seenDir.size > 400) break; }
          if (r) hits.set(r, (hits.get(r) || 0) + 1);
        }
      }
    }
    // every folder it works in, busiest first (a project can span several, e.g. ~/web + ~/api)
    const ranked = [...hits].filter(([, k]) => k >= MIN_HITS).sort((a, b) => b[1] - a[1]);
    // side folders: used ≥ 10% as much as the main one, and not a monorepo root (a folder holding many projects)
    const all = ranked.filter(([r, k], i) => i === 0 || (k >= ranked[0][1] * .1 && !isMonorepo(r))).slice(0, 4).map(([r]) => r);
    const best = (ranked[0] || [])[0] || null;
    cache.set(file, { size: st.size, best, all, hits });
    return best;
  }
  // all of a session's folders: its working folder (if not home) + the ones its tools touch most
  function allOf(sid, cwd) {
    const f = findTranscript(sid); if (f) scan(f);
    const c = f && cache.get(f), out = [];
    // a working folder that is a monorepo root says little: use the projects inside it the session actually works in
    const inside = cwd && isMonorepo(cwd) ? ((c && c.all) || []).filter(r => r.startsWith(cwd + '/')) : [];
    if (inside.length) out.push(...inside);
    else if (cwd && cwd !== home && cwd.startsWith(home) && isDir(cwd)) out.push(cwd);
    for (const r of (c && c.all) || []) if (!out.some(o => r === o || r.startsWith(o + '/') || o.startsWith(r + '/'))) out.push(r);
    // tidy: no trailing slashes, no duplicates, no monorepo root when a project inside it is listed, outermost of nested folders
    let L = [...new Set(out.map(x => x.replace(/\/+$/, '')))];
    L = L.filter(x => !(isMonorepo(x) && L.some(y => y !== x && y.startsWith(x + '/'))));
    L = L.filter(x => !L.some(y => y !== x && x.startsWith(y + '/')));
    return L.slice(0, 4);
  }
  // how much a session has worked in a folder (or inside it): tool calls touching it, in the transcript's tail
  function hitsIn(sid, folder) {
    const f = findTranscript(sid); if (f) scan(f);
    let n = 0; for (const [r, k] of (f && cache.get(f) && cache.get(f).hits) || []) if (r === folder || r.startsWith(folder + '/') || folder.startsWith(r + '/')) n += k;
    return n;
  }
  // [{ sid, cwd }] → { sid: { path, label, why } }
  function folders(list) {
    const out = {};
    for (const s of list || []) {
      let p = null, why = '';
      if (s.cwd && s.cwd !== home && s.cwd.startsWith(home) && isDir(s.cwd)) { p = s.cwd; why = 'its working folder'; }
      else { const f = findTranscript(s.sid); p = f ? scan(f) : null; why = 'the folder it works in'; }
      if (p) out[s.sid] = { path: p, label: '~' + p.slice(home.length), why };
    }
    return out;
  }
  // open only folders inside home that exist
  const safe = p => typeof p === 'string' && p.startsWith(home + '/') && !p.includes('/../') && isDir(p);
  return { folders, safe, allOf, hitsIn, rootOf: root };
}

module.exports = { createFolders };
