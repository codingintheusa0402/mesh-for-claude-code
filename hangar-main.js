// The Endurance's hangar, main-process side (2026-10-29): remove an item (with undo), discover new ones, install them.
//   Remove: a skill / command is moved to ~/.claude/.hangar-trash (Undo moves it back); a plugin is uninstalled with
//   `claude plugin uninstall`; an MCP server with `claude mcp remove`; a claude.ai connector can only be removed on
//   claude.ai, so its settings page opens.
//   Discover (cached 1 h, search queries 10 min): Anthropic's skills (github anthropics/skills), Anthropic's plugin
//   directory by category (anthropics/claude-plugins-official), the most-starred GitHub repos tagged claude-skills and
//   mcp-server (`gh api`, your login), and the official MCP Registry.
//   Install: a skill repo → its SKILL.md folders copied into ~/.claude/skills (files only, nothing is run); a plugin →
//   `claude plugin install <name>@claude-plugins-official`; a registry server → `claude mcp add` (a hosted URL, or an
//   npm / PyPI package run by npx / uvx). GitHub MCP repos open on GitHub (no single install recipe).
const fs = require('fs'), path = require('path'), os = require('os'), { execFile } = require('child_process');

const H = os.homedir(), SKILLS = path.join(H, '.claude', 'skills'), CMDS = path.join(H, '.claude', 'commands'), TRASH = path.join(H, '.claude', '.hangar-trash');
const sh = (cmd, timeout = 120000) => new Promise(res => execFile('/bin/zsh', ['-lc', cmd], { timeout, maxBuffer: 8 << 20 }, (err, out, errOut) => res({ ok: !err, out: String(out || ''), err: String(errOut || (err && err.message) || '') })));
const q1 = s => `'${String(s).replace(/'/g, `'\\''`)}'`;                          // a shell-quoted argument
const inside = (p, dir) => { const r = path.relative(dir, p); return r && !r.startsWith('..') && !path.isAbsolute(r); };
const getJSON = async (url, ms = 15000) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); try { const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'Mesh-for-Claude-Code' } }); return r.ok ? await r.json() : null; } catch { return null; } finally { clearTimeout(t); } };
const getText = async (url, ms = 15000) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); try { const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'Mesh-for-Claude-Code' } }); return r.ok ? await r.text() : null; } catch { return null; } finally { clearTimeout(t); } };
// GitHub API: through `gh` (your login, higher limits) when it's installed, else the public API (60 / h, search 10 / min)
const gh = async p => { const r = await sh('gh api ' + q1(p), 30000); if (r.ok) { try { return JSON.parse(r.out); } catch { } } return getJSON('https://api.github.com/' + p); };

module.exports = ({ ipcMain, shell, frontMatterText, mcpStale }) => {
  // ---------------- remove / undo ----------------
  ipcMain.handle('hangar:remove', async (_e, it) => {
    if (!it || !it.name) return { ok: false, err: 'nothing to remove' };
    if (it.kind === 'connector') {
      if (/^claude\.ai\s/.test(it.name)) { shell.openExternal('https://claude.ai/settings/connectors'); return { ok: false, opened: true, err: 'claude.ai connectors are removed on claude.ai — its Connectors page is open' }; }
      let r = await sh(`claude mcp remove ${q1(it.name)} -s user`, 30000);
      if (!r.ok) r = await sh(`claude mcp remove ${q1(it.name)}`, 30000);
      mcpStale(); return r.ok ? { ok: true } : { ok: false, err: (r.err || r.out).trim().split('\n').pop() };
    }
    if (it.src === 'plugin') {
      if (!it.plugin) return { ok: false, err: 'unknown plugin' };
      const r = await sh(`claude plugin uninstall ${q1(it.plugin)}`, 60000);
      return r.ok ? { ok: true, plugin: it.plugin } : { ok: false, err: (r.err || r.out).trim().split('\n').pop() };
    }
    // a skill folder / a command file → the trash (Undo moves it back)
    const target = it.src === 'command' ? it.file : it.file && path.dirname(it.file);
    let real; try { real = fs.realpathSync(target); } catch { return { ok: false, err: 'not found' }; }
    const roots = [SKILLS, CMDS].map(d => { try { return fs.realpathSync(d); } catch { return d; } });
    if (!roots.some(r => inside(real, r))) return { ok: false, err: 'only your own skills and commands can be removed here' };
    fs.mkdirSync(TRASH, { recursive: true });
    const dest = path.join(TRASH, path.basename(real) + '.' + Date.now());
    try { fs.renameSync(real, dest); } catch (e) { return { ok: false, err: e.message }; }
    return { ok: true, undo: { from: dest, to: real } };
  });
  ipcMain.handle('hangar:undo', async (_e, u) => {
    if (!u || !u.from || !u.to || !inside(u.from, TRASH) || fs.existsSync(u.to)) return { ok: false };
    try { fs.renameSync(u.from, u.to); return { ok: true }; } catch (e) { return { ok: false, err: e.message }; }
  });

  // ---------------- discover ----------------
  let base = { at: 0, data: null }; const qCache = new Map();
  async function anthropicSkills() {
    const list = await gh('repos/anthropics/skills/contents/skills'); if (!list) return Object.assign([], { failed: true });
    return (await Promise.all(list.filter(x => x.type === 'dir').map(async x => {
      const t = await getText(`https://raw.githubusercontent.com/anthropics/skills/main/skills/${x.name}/SKILL.md`), fm = t ? frontMatterText(t) : {};
      return { kind: 'disc', src: 'anthropic-skill', name: fm.name || x.name, desc: fm.description || '', repo: 'anthropics/skills', path: 'skills/' + x.name, url: x.html_url };
    }))).sort((a, b) => a.name.localeCompare(b.name));
  }
  async function anthropicPlugins() {
    const m = await getJSON('https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json');
    if (!m) return Object.assign([], { failed: true });
    return (m.plugins || []).map(p => ({ kind: 'disc', src: 'anthropic-plugin', name: p.name, desc: p.description || '', category: p.category || 'other', url: `https://github.com/anthropics/claude-plugins-official/tree/main/plugins/${p.name}`, author: p.author && p.author.name }));
  }
  const repoItem = (r, src) => ({ kind: 'disc', src, name: r.name, repo: r.full_name, desc: r.description || '', stars: r.stargazers_count, url: r.html_url, updated: r.pushed_at, branch: r.default_branch });
  async function ghSearch(q, topic, n = 24) {
    const qq = (q ? q + ' ' : '') + 'topic:' + topic;
    const r = await gh(`search/repositories?q=${encodeURIComponent(qq)}&sort=stars&order=desc&per_page=${n}`);
    if (!r) return Object.assign([], { failed: true });
    return (r.items || []).map(x => repoItem(x, topic === 'mcp-server' ? 'github-mcp' : 'github-skill'));
  }
  async function registry(q) {
    const d = await getJSON(`https://registry.modelcontextprotocol.io/v0/servers?limit=40${q ? '&search=' + encodeURIComponent(q) : ''}`), seen = new Set(), out = [];
    if (!d) return Object.assign(out, { failed: true });
    for (const e of d.servers || []) {
      const s = e.server || e; if (!s || seen.has(s.name)) continue; seen.add(s.name);
      const remote = (s.remotes || []).find(r => /^https:/.test(r.url || '')), pkg = (s.packages || []).find(p => /npm|pypi/.test(p.registryType || p.registry_type || ''));
      out.push({ kind: 'disc', src: 'mcp-registry', name: s.title || s.name.split('/').pop(), id: s.name, desc: s.description || '', url: (s.repository && s.repository.url) || remote && remote.url || '', remote: remote && remote.url, transport: remote && remote.type, pkg: pkg && { type: /npm/.test(pkg.registryType || pkg.registry_type) ? 'npm' : 'pypi', id: pkg.identifier } });
    }
    return out;
  }
  ipcMain.handle('hangar:discover', async (_e, q) => {
    q = String(q || '').trim().slice(0, 80);
    if (!base.data || Date.now() - base.at > 3600000) {
      const [as, ap, gs, gm, rg] = await Promise.all([anthropicSkills(), anthropicPlugins(), ghSearch('', 'claude-skills'), ghSearch('', 'mcp-server'), registry('')]);
      const data = { anthropicSkills: as, anthropicPlugins: ap, githubSkills: gs, githubMcp: gm, registry: rg }, failed = Object.keys(data).filter(k => data[k].failed);
      base = { at: failed.length ? 0 : Date.now(), data: { ...data, failed } };                  // a source that didn't answer isn't an empty source: look again next time
    }
    if (!q) return base.data;
    const hit = qCache.get(q); if (hit && Date.now() - hit.at < 600000) return hit.data;
    const m = x => (x.name + ' ' + x.desc + ' ' + (x.category || '')).toLowerCase().includes(q.toLowerCase());
    const [gs, gm, rg] = await Promise.all([ghSearch(q, 'claude-skills'), ghSearch(q, 'mcp-server'), registry(q)]);
    const data = { anthropicSkills: base.data.anthropicSkills.filter(m), anthropicPlugins: base.data.anthropicPlugins.filter(m), githubSkills: gs, githubMcp: gm, registry: rg };
    data.failed = [...(gs.failed ? ['githubSkills'] : []), ...(gm.failed ? ['githubMcp'] : []), ...(rg.failed ? ['registry'] : []), ...base.data.failed.filter(k => k.startsWith('anthropic'))];
    if (!data.failed.length) qCache.set(q, { at: Date.now(), data }); return data;
  });

  // ---------------- install ----------------
  async function installSkillsFrom(repo, sub, branch) {
    const meta = branch ? null : await gh(`repos/${repo}`), br = branch || (meta && meta.default_branch) || 'main';
    const tree = await gh(`repos/${repo}/git/trees/${encodeURIComponent(br)}?recursive=1`); if (!tree || !tree.tree) return { ok: false, err: 'could not read the repo' };
    const files = tree.tree.filter(f => f.type === 'blob');
    let roots = files.filter(f => /(^|\/)SKILL\.md$/.test(f.path)).map(f => path.posix.dirname(f.path)).filter(d => !sub || d === sub || d.startsWith(sub + '/'));
    roots = roots.filter(d => !roots.some(o => o !== d && o !== '.' && d.startsWith(o + '/'))).slice(0, 20);   // outermost skill folders, at most 20
    if (!roots.length) return { ok: false, err: 'no SKILL.md in this repo — open it on GitHub instead' };
    const done = [];
    for (const d of roots) {
      const name = (d === '.' ? repo.split('/')[1] : path.posix.basename(d)).replace(/[^\w.-]/g, '-'), dest = path.join(SKILLS, name);
      if (fs.existsSync(dest)) { done.push(name + ' (already installed)'); continue; }
      const mine = files.filter(f => d === '.' ? true : f.path.startsWith(d + '/')).slice(0, 300); let bytes = 0;
      const tmp = dest + '.part-' + process.pid; fs.mkdirSync(tmp, { recursive: true });
      try {
        for (const f of mine) {
          const rel = d === '.' ? f.path : f.path.slice(d.length + 1); if (rel.includes('..') || /^\.git\//.test(rel)) continue;
          const t = await fetch(`https://raw.githubusercontent.com/${repo}/${br}/${f.path.split('/').map(encodeURIComponent).join('/')}`); if (!t.ok) continue;
          const buf = Buffer.from(await t.arrayBuffer()); bytes += buf.length; if (bytes > 20 << 20) throw new Error('over 20 MB');
          fs.mkdirSync(path.join(tmp, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(tmp, rel), buf);
        }
        fs.renameSync(tmp, dest); done.push(name);
      } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); return { ok: false, err: e.message }; }
    }
    return { ok: true, installed: done };
  }
  ipcMain.handle('hangar:install', async (_e, it) => {
    if (!it) return { ok: false };
    if (it.src === 'anthropic-skill') return installSkillsFrom('anthropics/skills', it.path, 'main');
    if (it.src === 'github-skill') return installSkillsFrom(it.repo, '', it.branch);
    if (it.src === 'anthropic-plugin') {
      const r = await sh(`claude plugin install ${q1(it.name + '@claude-plugins-official')}`, 180000);
      return r.ok ? { ok: true, installed: [it.name] } : { ok: false, err: (r.err || r.out).trim().split('\n').pop() };
    }
    if (it.src === 'mcp-registry') {
      const nm = String(it.name || it.id).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'mcp';
      const cmd = it.remote ? `claude mcp add -s user --transport ${it.transport === 'sse' ? 'sse' : 'http'} ${q1(nm)} ${q1(it.remote)}`
        : it.pkg && it.pkg.type === 'npm' ? `claude mcp add -s user ${q1(nm)} -- npx -y ${q1(it.pkg.id)}`
        : it.pkg ? `claude mcp add -s user ${q1(nm)} -- uvx ${q1(it.pkg.id)}` : null;
      if (!cmd) return { ok: false, err: 'no install recipe — open it instead' };
      const r = await sh(cmd, 60000); mcpStale();
      return r.ok ? { ok: true, installed: [nm] } : { ok: false, err: (r.err || r.out).trim().split('\n').pop() };
    }
    return { ok: false, err: 'open it on GitHub to install' };
  });
  ipcMain.handle('hangar:open', (_e, u) => /^https:\/\/(github\.com|claude\.ai|registry\.modelcontextprotocol\.io|[\w.-]+\.(smithery\.ai|npmjs\.com|pypi\.org))\//.test(String(u || '')) ? shell.openExternal(u) : false);
};
