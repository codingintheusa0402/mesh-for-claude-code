// Archify (2026-11-10): an interactive architecture diagram of a session's project, from the session's menu.
// Archify (github.com/tt-a1i/archify, Apache-2.0) is an agent skill: an agent reads the repository, writes a typed JSON
// candidate, and the skill's own CLI validates it and renders one standalone HTML file (checked in a real browser).
// Mesh keeps its own pinned copy of the skill (~/.mesh/tools/archify-<ver>, not in your skills folder) and runs the agent
// headless (`claude -p`) in the project folder, read-only there: everything it writes goes to ~/.mesh/archify/<project>/.
// One run at a time per machine; a session on the other Mac is mapped on that Mac (main.js forwards).
const fs = require('fs'), path = require('path'), os = require('os');
const { execFile, spawn } = require('child_process');

const VERSION = 'v3.2.0', REPO = 'https://github.com/tt-a1i/archify.git';
const MAX_RUN = 40 * 60e3;

function createArchify({ home = os.homedir(), claudeBin, env, projectOf, onChange = () => { } }) {
  const TOOL = path.join(home, '.mesh', 'tools', 'archify-' + VERSION), SKILL = path.join(TOOL, 'archify');
  const OUT = path.join(home, '.mesh', 'archify');
  const run = (cmd, args, opts = {}) => new Promise(res => execFile(cmd, args, { timeout: 120000, maxBuffer: 8e6, ...opts }, (err, so, se) => res({ ok: !err, out: String(so || '').trim(), err: String(se || (err && err.message) || '').trim() })));
  const slug = p => (path.relative(home, p) || 'home').replace(/[^\w.-]+/g, '_').slice(0, 120);
  const dirOf = project => path.join(OUT, slug(project));
  const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  let job = null;                           // { project, sid, started, step, steps, proc }
  const queue = [];

  // ---- the skill itself: a sparse clone of the archify/ folder at the pinned tag ----
  let installing = null;
  function ensureTool() {
    if (fs.existsSync(path.join(SKILL, 'bin', 'archify.mjs'))) return Promise.resolve({ ok: true });
    if (installing) return installing;
    installing = (async () => {
      const tmp = TOOL + '.tmp-' + Date.now(); fs.mkdirSync(path.dirname(TOOL), { recursive: true });
      let r = await run('git', ['clone', '-q', '--depth', '1', '--branch', VERSION, '--filter=blob:none', '--sparse', REPO, tmp]);
      if (r.ok) r = await run('git', ['-C', tmp, 'sparse-checkout', 'set', 'archify']);
      if (r.ok && fs.existsSync(path.join(tmp, 'archify', 'bin', 'archify.mjs'))) { fs.renameSync(tmp, TOOL); return { ok: true }; }
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
      return { ok: false, err: 'could not download Archify: ' + (r.err || 'unknown').slice(0, 200) };
    })().finally(() => { installing = null; });
    return installing;
  }

  async function gitInfo(project) {
    const top = await run('git', ['-C', project, 'rev-parse', '--show-toplevel', 'HEAD']);
    if (!top.ok) return { head: null };
    const [root, head] = top.out.split('\n'); return { root, head };
  }
  async function status(sid, cwd) {
    const project = projectOf(sid, cwd);
    if (!project) return { ok: false, err: 'no project folder for this session (it works in your home folder)' };
    const d = dirOf(project), meta = readJson(path.join(d, 'meta.json')), html = path.join(d, 'architecture.html');
    const st = { ok: true, project, name: path.basename(project), html: fs.existsSync(html) ? html : null, meta };
    if (meta && meta.head) {
      const g = await gitInfo(project);
      if (g.head && g.head !== meta.head) { const c = await run('git', ['-C', project, 'rev-list', '--count', `${meta.head}..${g.head}`]); st.behind = c.ok ? +c.out || 0 : null; }
      else st.behind = 0;
    }
    if (job && job.project === project) st.running = { started: job.started, step: job.step, steps: job.steps };
    else if (queue.some(q => q.project === project)) st.queued = true;
    st.lastError = (readJson(path.join(d, 'last-run.json')) || {}).error || null;
    return st;
  }

  function prompt(project, work, name) {
    return [
      `Make an interactive architecture diagram of the project "${name}" in this folder (${project}), using the Archify skill.`,
      `The skill is installed at ${SKILL}. Read ${SKILL}/SKILL.md first and follow it exactly, including references/repository-authoring.md for a source-backed diagram of a real codebase. Use node ${SKILL}/bin/archify.mjs for every Archify command.`,
      `Choose the diagram type that explains this project best as a whole (normally "architecture"): its main parts, how they connect, the data and the jobs/schedules it runs, so someone new understands the system at a glance.`,
      `This project folder is READ-ONLY for you: do not create, edit or delete anything in it and do not run its code, installs, builds or tests. Write the candidate JSON, the output HTML and every receipt only inside ${work} (use it instead of the .archify/ folder the skill mentions; meta.output and the finalize output path go there, and pass --repo-root ${project}).`,
      `Never read or copy secrets (.env files, tokens, credentials, keys): describe such files by role only.`,
      `When finalize passes, reply with exactly one line: ARCHIFY-DONE <absolute path of the output .html>. If it cannot pass after the repairs the skill allows, reply ARCHIFY-FAILED <one-line reason>.`,
    ].join('\n\n');
  }

  async function generate(sid, cwd) {
    const project = projectOf(sid, cwd); if (!project) return { ok: false, err: 'no project folder for this session' };
    if ((job && job.project === project) || queue.some(q => q.project === project)) return { ok: true, already: true };
    queue.push({ project, sid }); onChange(project); pump(); return { ok: true, queued: !!job && job.project !== project };
  }
  async function pump() {
    if (job || !queue.length) return;
    const { project, sid } = queue.shift(), d = dirOf(project), name = path.basename(project);
    job = { project, sid, started: Date.now(), step: 'Getting Archify ready…', steps: 0 }; onChange(project);
    const fail = error => { try { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'last-run.json'), JSON.stringify({ at: Date.now(), error })); } catch { } job = null; onChange(project, { error }); pump(); };
    const t = await ensureTool(); if (!t.ok) return fail(t.err);
    const work = path.join(d, 'run-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)); fs.mkdirSync(work, { recursive: true });
    const g = await gitInfo(project), bin = await claudeBin();
    job.step = 'Reading the project…'; onChange(project);
    const log = fs.createWriteStream(path.join(work, 'agent.jsonl'));
    const proc = spawn(bin, ['-p', prompt(project, work, name), '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions',
      '--add-dir', work, '--add-dir', SKILL], { cwd: project, env: { ...env(), ARCHIFY_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    job.proc = proc;
    let buf = '', last = '';
    const kill = setTimeout(() => { try { proc.kill('SIGTERM'); } catch { } }, MAX_RUN);
    proc.stdout.on('data', c => {
      log.write(c); buf += c; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.type === 'assistant') for (const b of (m.message && m.message.content) || []) {
          if (b.type === 'text' && b.text) last = b.text;
          if (b.type === 'tool_use' && job) { job.steps++; job.step = describe(b, project, work); onChange(project); }
        }
        if (m.type === 'result' && m.result) last = m.result;
      }
    });
    proc.stderr.on('data', c => log.write(c));
    proc.on('close', code => {
      clearTimeout(kill); log.end();
      const done = /ARCHIFY-DONE\s+(\S.*\.html)/.exec(last), failed = /ARCHIFY-FAILED\s+(.*)/.exec(last);
      const out = done && done[1].trim();
      if (job && job.cancelled) return fail('Cancelled');
      if (!out || !fs.existsSync(out)) return fail(failed ? failed[1].trim() : `the agent stopped (exit ${code}) without a finished diagram`);
      fs.copyFileSync(out, path.join(d, 'architecture.html'));
      fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ at: Date.now(), head: g.head || null, sid, project, run: work, version: VERSION }));
      try { fs.unlinkSync(path.join(d, 'last-run.json')); } catch { }
      for (const old of fs.readdirSync(d).filter(f => f.startsWith('run-')).sort().slice(0, -3)) try { fs.rmSync(path.join(d, old), { recursive: true, force: true }); } catch { }   // keep the last 3 runs
      job = null; onChange(project, { done: true }); pump();
    });
  }
  // one line for the progress view: what the agent is doing now
  function describe(b, project, work) {
    const i = b.input || {}, rel = p => String(p || '').replace(work, '(output)').replace(project + '/', '').replace(home, '~');
    if (b.name === 'Read') return 'Reading ' + rel(i.file_path);
    if (b.name === 'Grep' || b.name === 'Glob') return 'Searching ' + (i.pattern || '');
    if (b.name === 'Write' || b.name === 'Edit') return 'Writing ' + rel(i.file_path);
    if (b.name === 'Bash') { const c = String(i.command || ''); return /archify\.mjs\s+finalize/.test(c) ? 'Checking the diagram (finalize)…' : /archify\.mjs/.test(c) ? 'Running Archify…' : 'Looking around: ' + rel(c).slice(0, 80); }
    return b.name;
  }
  function cancel(sid, cwd) {
    const project = projectOf(sid, cwd); const i = queue.findIndex(q => q.project === project); if (i >= 0) queue.splice(i, 1);
    if (job && job.project === project && job.proc) { job.cancelled = true; try { job.proc.kill('SIGTERM'); } catch { } }
    return { ok: true };
  }
  const htmlOf = async (sid, cwd) => { const s = await status(sid, cwd); return s.html ? { ok: true, html: fs.readFileSync(s.html, 'utf8'), meta: s.meta } : { ok: false }; };
  return { status, generate, cancel, htmlOf, dirOf, ensureTool, OUT };
}

module.exports = { createArchify };
