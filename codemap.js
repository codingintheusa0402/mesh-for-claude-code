// Code map (2026-11-12): an interactive knowledge graph of a session's project, from the session's menu.
// Built by Graphify (github.com/Graphify-Labs/graphify, Apache-2.0; install: `uv tool install graphifyy`): tree-sitter
// parses the code locally, then Graphify clusters it into areas and names them. It replaces Archify, which ran a Claude
// session for 3–15 minutes per diagram; a map takes seconds to half a minute.
// Where the graph lives:
//  - normally in ~/.mesh/codemap/<project>/ (Graphify's GRAPHIFY_OUT), so the project folder is never touched;
//  - a project that keeps its own graph (graphify-out/ from `graphify install --project`, refreshed by its git hook) is
//    refreshed and shown in place, so sessions and the map share one graph.
// One build at a time per machine; a session on the other Mac is mapped on that Mac (main.js forwards).
const fs = require('fs'), path = require('path'), os = require('os');
const { execFile, spawn } = require('child_process');

const MAX_RUN = 15 * 60e3;
const IS_WIN = process.platform === 'win32';
// third-party and generated code would swamp the map of the project's own code
const EXCLUDES = ['**/node_modules/**', '**/vendor/**', '**/third_party/**', '**/dist/**', '**/build/**', '**/out/**', '**/.venv/**', '**/venv/**',
  '**/__pycache__/**', '**/coverage/**', '**/*.min.js', '**/*.bundle.js', '**/*-bundle.js'];

function createCodemap({ home = os.homedir(), env = () => process.env, projectOf, onChange = () => { } }) {
  const OUT = path.join(home, '.mesh', 'codemap');
  const run = (cmd, args, opts = {}) => new Promise(res => execFile(cmd, args, { timeout: 120000, maxBuffer: 8e6, ...opts }, (err, so, se) => res({ ok: !err, out: String(so || '').trim(), err: String(se || (err && err.message) || '').trim() })));
  const slug = p => (path.relative(home, p) || 'home').replace(/[^\w.-]+/g, '_').slice(0, 120);
  const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const ownDir = project => path.join(project, 'graphify-out');
  const owns = project => fs.existsSync(path.join(ownDir(project), 'graph.json'));
  const outOf = project => owns(project) ? ownDir(project) : path.join(OUT, slug(project));
  const notesOf = project => path.join(OUT, slug(project));                   // Mesh's own notes, never inside the project
  let job = null; const queue = [];

  // the graphify CLI: MESH_GRAPHIFY, the usual install places (uv / pipx / Homebrew), then PATH
  let bin = null;
  function graphifyBin() {
    if (bin && fs.existsSync(bin)) return bin;
    const exe = IS_WIN ? 'graphify.exe' : 'graphify';
    const dirs = [path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin',
      ...(IS_WIN ? [path.join(home, 'AppData', 'Roaming', 'uv', 'tools', 'graphifyy', 'Scripts')] : []),
      ...String(env().PATH || '').split(path.delimiter)];
    const hit = [process.env.MESH_GRAPHIFY, ...dirs.map(d => d && path.join(d, exe))].find(f => f && fs.existsSync(f));
    return (bin = hit || null);
  }

  async function gitHead(project) {
    const r = await run('git', ['-C', project, 'rev-parse', 'HEAD']);
    return r.ok ? r.out : null;
  }
  async function status(sid, cwd) {
    const project = projectOf(sid, cwd);
    if (!project) return { ok: false, err: 'no project folder for this session (it works in your home folder)' };
    const dir = outOf(project), html = path.join(dir, 'graph.html'), meta = readJson(path.join(notesOf(project), 'meta.json'));
    const st = { ok: true, project, name: path.basename(project), own: owns(project), html: fs.existsSync(html) ? html : null, meta,
      report: fs.existsSync(path.join(dir, 'GRAPH_REPORT.md')) ? path.join(dir, 'GRAPH_REPORT.md') : null, installed: !!graphifyBin() };
    if (meta && meta.head) {
      const now = await gitHead(project);
      if (now && now !== meta.head) { const c = await run('git', ['-C', project, 'rev-list', '--count', `${meta.head}..${now}`]); st.behind = c.ok ? +c.out || 0 : null; }
      else st.behind = 0;
    }
    if (job && job.project === project) st.running = { started: job.started, step: job.step };
    else if (queue.some(q => q.project === project)) st.queued = true;
    st.lastError = (readJson(path.join(notesOf(project), 'last-run.json')) || {}).error || null;
    return st;
  }

  async function generate(sid, cwd) {
    const project = projectOf(sid, cwd); if (!project) return { ok: false, err: 'no project folder for this session' };
    if (!graphifyBin()) return { ok: false, err: 'Graphify is not installed. Install it with: uv tool install graphifyy' };
    if ((job && job.project === project) || queue.some(q => q.project === project)) return { ok: true, already: true };
    queue.push({ project, sid }); onChange(project); pump(); return { ok: true, queued: !!job && job.project !== project };
  }

  async function pump() {
    if (job || !queue.length) return;
    const { project, sid } = queue.shift(), notes = notesOf(project), own = owns(project), out = outOf(project);
    fs.mkdirSync(notes, { recursive: true });
    job = { project, sid, started: Date.now(), step: 'Starting…' }; onChange(project);
    const fail = error => { try { fs.writeFileSync(path.join(notes, 'last-run.json'), JSON.stringify({ at: Date.now(), error })); } catch { } job = null; onChange(project, { error }); pump(); };
    const head = await gitHead(project);
    // a project with its own graph: Graphify's normal update, as its git hook does. Otherwise two steps into ~/.mesh:
    // read the code (local, seconds; vendored/minified/build output skipped), then cluster + name the areas (Graphify
    // names them with whatever model it finds, e.g. the Claude Code CLI; only area and symbol names are sent) + page.
    const steps = own ? [['update', project]]
      : [['extract', project, '--code-only', ...EXCLUDES.flatMap(x => ['--exclude', x])], ['cluster-only', project, '--graph', path.join(out, 'graph.json')]];
    const names = own ? ["Refreshing the project's own graph…"] : ['Reading the code…', 'Naming the areas and drawing the map…'];
    let log = '';
    const runStep = i => new Promise(resolve => {
      if (!job) return resolve(-1);
      job.step = names[i]; onChange(project);
      const proc = spawn(graphifyBin(), steps[i], { cwd: project, windowsHide: true,
        env: { ...env(), ...(own ? {} : { GRAPHIFY_OUT: out }), PYTHONIOENCODING: 'utf-8' }, stdio: ['ignore', 'pipe', 'pipe'] });
      job.proc = proc;
      const take = c => { log = (log + c).slice(-20000); };
      proc.stdout.on('data', take); proc.stderr.on('data', take);
      proc.on('error', e => { log += '\n' + e.message; resolve(-1); });
      proc.on('close', code => resolve(code));
    });
    const kill = setTimeout(() => { if (job && job.proc) try { job.proc.kill(); } catch { } }, MAX_RUN);
    let code = 0;
    for (let i = 0; i < steps.length && code === 0; i++) code = await runStep(i);
    clearTimeout(kill);
    if (job && job.cancelled) { job = null; onChange(project, { error: 'Cancelled' }); return pump(); }
    const graph = readJson(path.join(out, 'graph.json'));
    if (code !== 0 || !graph || !fs.existsSync(path.join(out, 'graph.html'))) return fail(`Graphify stopped (exit ${code}): ${log.trim().split('\n').slice(-3).join(' · ').slice(0, 300)}`);
    const nodes = graph.nodes || [], comms = new Set(nodes.map(n => n.community).filter(c => c !== undefined && c !== null));
    fs.writeFileSync(path.join(notes, 'meta.json'), JSON.stringify({ at: Date.now(), head, sid, project, own, nodes: nodes.length, edges: (graph.links || graph.edges || []).length,
      communities: comms.size, version: (graph.graph && graph.graph.graphify_version) || null }));
    try { fs.unlinkSync(path.join(notes, 'last-run.json')); } catch { }
    job = null; onChange(project, { done: true }); pump();
  }

  function cancel(sid, cwd) {
    const project = projectOf(sid, cwd); const i = queue.findIndex(q => q.project === project); if (i >= 0) queue.splice(i, 1);
    if (job && job.project === project && job.proc) { job.cancelled = true; try { job.proc.kill(); } catch { } }
    return { ok: true };
  }
  const htmlOf = async (sid, cwd) => { const s = await status(sid, cwd); return s.html ? { ok: true, html: fs.readFileSync(s.html, 'utf8'), meta: s.meta } : { ok: false }; };
  return { status, generate, cancel, htmlOf, OUT, graphifyBin };
}

module.exports = { createCodemap };
