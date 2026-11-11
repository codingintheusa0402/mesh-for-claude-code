// Keeps the app responsive when macOS stalls on its protected folders.
// macOS asks its permission service before any program opens something in Desktop, Documents, Downloads, iCloud Drive
// or a CloudStorage folder. That check can wedge until the Mac restarts (seen 2026-11-08: every open hung ~6 s and
// then failed with EINTR). The main process reads those folders synchronously (session folders, skills), so each
// read froze the whole window. This module checks those folders in the background (a child process, so a hang never
// touches this process) and, while one is stuck, makes sync fs calls into it fail at once: existsSync says false,
// the others throw EINTR, the way the stuck call would have ended anyway, only 6 s sooner.
// A sync call that itself takes over 2 s also marks its folder stuck, so a stall that starts mid-run costs one hiccup.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const SYNC = ['existsSync', 'statSync', 'lstatSync', 'readdirSync', 'readFileSync', 'openSync', 'opendirSync', 'accessSync',
  'realpathSync', 'readlinkSync', 'writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync', 'unlinkSync', 'rmSync',
  'copyFileSync', 'utimesSync', 'chmodSync', 'truncateSync'];

function createGuard({ home = os.homedir(), roots = null, probe = null, every = 15000, slowMs = 2000, onChange = () => { } } = {}) {
  const state = new Map();        // root -> 'ok' | 'stuck'
  const busy = new Set();         // roots with a probe in flight
  let aliases = [];               // [link path, target]: ~/.claude/skills -> ~/Desktop/repo/skills
  let list = roots || [];
  let timer = null;

  const defaultRoots = async () => {
    const L = path.join(home, 'Library');
    const out = ['Desktop', 'Documents', 'Downloads'].map(d => path.join(home, d)).concat(path.join(L, 'Mobile Documents'));
    try { for (const d of await fs.promises.readdir(path.join(L, 'CloudStorage'))) out.push(path.join(L, 'CloudStorage', d)); } catch { }
    return out;
  };
  // symlinks in ~ and ~/.claude: readlink reads the link itself and never opens the folder it points to
  const loadAliases = async () => {
    const out = [];
    for (const dir of [home, path.join(home, '.claude')]) {
      let es = []; try { es = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { }
      for (const e of es) if (e.isSymbolicLink()) {
        const p = path.join(dir, e.name);
        try { out.push([p, path.resolve(dir, await fs.promises.readlink(p))]); } catch { }
      }
    }
    return out.sort((a, b) => b[0].length - a[0].length);
  };
  const under = (p, r) => p === r || p.startsWith(r + path.sep);
  function rootOf(p) {
    if (typeof p !== 'string' || !list.length) return null;     // fds, Buffers, URLs: left alone
    let a = path.resolve(p);
    for (const [l, t] of aliases) if (under(a, l)) { a = t + a.slice(l.length); break; }
    for (const r of list) if (under(a, r)) return r;
    return null;
  }

  // default probe: open the folder in a child process; a stall shows as time, not as an error code
  const perl = fs.existsSync('/usr/bin/perl');
  const runProbe = probe || (root => new Promise(res => {
    const t = Date.now();
    const [cmd, args] = perl ? ['/usr/bin/perl', ['-e', 'opendir(D, $ARGV[0]) and readdir(D)', root]] : ['/bin/ls', ['-d', root + '/.']];
    execFile(cmd, args, { timeout: 2500 }, () => res(Date.now() - t < slowMs));
  }));
  function set(root, v, why) {
    if (state.get(root) === v) return;
    const was = state.get(root); state.set(root, v);
    if (was || v === 'stuck') onChange({ root, state: v, why, stuck: stuck() });
  }
  async function check(root) {
    if (busy.has(root)) return; busy.add(root);
    try { set(root, (await runProbe(root)) ? 'ok' : 'stuck', 'probe'); } finally { busy.delete(root); }
  }
  async function tick() {
    if (!roots) list = await defaultRoots().catch(() => list);
    aliases = await loadAliases().catch(() => aliases);
    await Promise.all(list.map(check));
  }
  const stuck = () => [...state].filter(([, v]) => v === 'stuck').map(([r]) => r);

  function wrap(target = fs) {
    for (const name of SYNC) {
      const orig = target[name]; if (typeof orig !== 'function' || orig.__fsGuard) continue;
      const g = function (p, ...rest) {
        const r = rootOf(p);
        if (!r) return orig.call(this, p, ...rest);
        if (state.get(r) === 'stuck') {
          if (name === 'existsSync') return false;
          const e = new Error(`EINTR: macOS folder access is stuck, skipped ${name} '${p}'`);
          e.code = 'EINTR'; e.errno = -4; e.syscall = name.replace(/Sync$/, ''); e.path = p; throw e;
        }
        const t = Date.now();
        try { return orig.call(this, p, ...rest); } finally { if (Date.now() - t > slowMs) { set(r, 'stuck', `${name} took ${Date.now() - t} ms`); check(r); } }
      };
      Object.assign(g, orig); g.__fsGuard = true;                // keeps realpathSync.native and friends
      target[name] = g;
    }
  }
  // the first check runs before the window opens (normally ~10 ms, at most ~2.5 s), so startup reads are covered
  const ready = tick();
  function start() { if (!timer) { timer = setInterval(() => tick().catch(() => { }), every); timer.unref && timer.unref(); } return ready; }
  function stop() { clearInterval(timer); timer = null; }
  return { wrap, start, stop, ready, rootOf, stuck, tick, state };
}

module.exports = { createGuard };
