// Token usage in the main process: owns the database process (usage-proc.js), refreshes it every 5 minutes, pulls the other
// Mac's totals over the phone-server link, and raises the alerts. See usage-core.js for what is stored.
const path = require('path'), os = require('os'), { execFile } = require('child_process');
const { utilityProcess, Notification } = require('electron');
const NAME = require('./mesh-name');
const EVERY = 5 * 60e3;

function createUsage({ userData, machine, snapshot, limits, limitsPending, peer, mask, onAlert, models = () => ({}) }) {
  const home = os.homedir(), wait = new Map(); let seq = 0, proc = null, ready = null, sum = null, busy = false, scanned = false, scanErr = null, peerErr = null;
  function boot() {
    proc = utilityProcess.fork(path.join(__dirname, 'usage-proc.js'), [], { serviceName: 'Mesh token usage' });
    proc.on('message', m => { const w = wait.get(m.id); if (w) { wait.delete(m.id); m.err ? w.reject(new Error(m.err)) : w.resolve(m.r); } });
    proc.on('exit', () => { for (const w of wait.values()) w.reject(new Error('usage process stopped')); wait.clear(); proc = null; ready = null; });
    const RP = require('./session-refresh').paths;      // lineage files live next to the handoffs; the refresh log gives the backfill its chains
    ready = call('open', { file: path.join(userData, 'usage.sqlite'), home, machine, handoffs: RP.handoffs, refreshLogs: [RP.log] });
    return ready;
  }
  function call(op, ...args) {
    const a = op === 'open' ? args[0] : args;
    return new Promise((resolve, reject) => { const id = ++seq; wait.set(id, { resolve, reject }); proc.postMessage({ id, op, args: a }); });
  }
  const use = async (op, ...a) => { if (!proc) boot(); await ready; return call(op, ...a); };
  const liveLabels = () => {
    const S = (snapshot() || {}).sessions || [], byId = new Map(S.map(s => [s.sid, s]));
    return S.filter(s => !s.onPeer).map(s => ({ sid: s.sid, name: s.name, auto: !!s.auto, color: s.color || '', cwd: s.cwd, parentName: s.parent && byId.get(s.parent) ? byId.get(s.parent).name : '' }));
  };
  async function pullPeer() {
    if (!peer() || !peer().online()) { peerErr = null; return; }
    const since = (await use('peerSince', peer().name ? peer().name() : '')) || 0;
    const r = await peer().forward('GET', '/api/usage/rows', undefined, { since: String(since) }, 60000).catch(e => ({ error: e.message }));
    if (r && r.machine) { await use('importRows', r); peerErr = null; } else peerErr = (r && r.error) || 'no answer';    // (an older build there has no such route)
  }
  // alerts go out from one machine only (mesh.local.json "usageAlert": { host, cmd }); with none set, from this one
  async function runAlerts() {
    if (process.env.MESH_QA) return;                                       // a test copy never alerts anyone
    const cfg = NAME.usageAlert || null; if (cfg && cfg.host && !os.hostname().toLowerCase().includes(cfg.host.toLowerCase())) return;
    for (const a of await use('alerts', limits())) {
      try { new Notification({ title: a.title, body: a.body, silent: false }).show(); } catch { }
      onAlert && onAlert(a);
      if (cfg && Array.isArray(cfg.cmd)) { const c = cfg.cmd.map(x => String(x).replace(/^~(?=\/)/, home).replace('{title}', a.title).replace('{body}', a.body)); execFile(c[0], c.slice(1), { timeout: 30000 }, () => { }); }
    }
  }
  async function tick() {
    if (busy) return; busy = true;
    try { await use('scan', liveLabels()); await pullPeer(); sum = await use('summary', limits()); scanned = true; scanErr = null; await runAlerts(); }
    catch (e) { scanErr = String(e && e.message || e); } finally { busy = false; }
  }
  function start() { setTimeout(tick, 20e3); setInterval(tick, EVERY); }
  const sessionView = async (sids, opts) => { const d = await use('session', sids, opts || {}); for (const t of d.turns) t.text = mask ? mask(t.text) : t.text; return d; };
  // a session of the other Mac: its log is there, so it answers
  async function session(list) {
    const mine = list.filter(x => x.machine === machine).map(x => x.sid), theirs = list.filter(x => x.machine !== machine).map(x => x.sid);
    if (!theirs.length || !peer() || !peer().online()) return { ...(await sessionView(mine.length ? mine : theirs, { anyMachine: !mine.length })), partial: theirs.length > 0 };
    const r = await peer().forward('GET', '/api/usage/session', undefined, { sids: theirs.join(','), local: '1' }, 15000).catch(() => null);
    const d = r && r.days ? r : { days: [], turns: [], partial: true }; if (!mine.length) return d;
    const m = await sessionView(mine); m.partial = !!d.partial; m.days.forEach((x, i) => { if (d.days[i]) x.tok += d.days[i].tok; });
    m.turns = [...m.turns, ...d.turns].sort((a, b) => b.tok - a.tok).slice(0, 5); return m;
  }
  // Ollama's credits belong to the account, so either Mac can answer. Read while the board is open, at most once a minute
  // (Ollama allows 10 a minute); a failed read keeps the last good number and says how old it is.
  let credits = null, creditsAt = 0, creditsBusy = false;
  async function readCredits() {
    if (creditsBusy || Date.now() - creditsAt < 60e3) return; creditsBusy = true;
    try {
      let r = await require('./ollama-engine').credits().catch(e => ({ state: 'failed', error: e.message }));
      if (r.state !== 'ok' && peer() && peer().online()) { const o = await peer().forward('GET', '/api/ollama-credits', undefined, undefined, 12000).catch(() => null); if (o && (o.state === 'ok' || r.state === 'none')) r = o; }
      credits = r.state === 'ok' ? { ...r, at: Date.now() } : credits && credits.left != null ? { ...credits, stale: r.state } : r;
    } finally { creditsAt = Date.now(); creditsBusy = false; }
  }
  // Opening the board before this launch's first look at the logs starts that look now, and says so: stored numbers are
  // yesterday's and a new install has none, neither of which means nothing was used.
  async function dash() {
    if (!scanned && !busy) tick();
    readCredits();
    const d = await use('dash', { limits: limits(), models: models() });
    // one number for both Macs: the first time, wait for the other Mac's share too, and say so when it can't be had
    const p = peer(), other = p && p.label ? p.label() : '', synced = p && (d.peers[p.name()] || Object.values(d.peers)[0]) || 0;
    const peerInfo = p && p.configured() ? { label: other, online: p.online(), at: synced, err: peerErr } : null;
    return { ...d, ready: d.ready && !(busy && peerInfo && peerInfo.online && !synced), limits: limits() || [], limitsPending: !!(limitsPending && limitsPending()), refreshing: busy, scanErr, peerInfo, ollama: credits, ollamaPending: !credits };
  }
  return { start, tick, dash, session, sessionLocal: sessionView, rows: since => use('rows', since), setManual: async p => { await use('setManual', p); }, summary: () => sum };
}
module.exports = { createUsage };
