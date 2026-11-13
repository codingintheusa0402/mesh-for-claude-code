// Mode switches: ON/OFF flags another tool reads from a small JSON file on one machine, flipped from Mesh on either
// Mac or the phone. Each switch is set in mesh.local.json (never in code):
//   "switches": [{ "id": "autopilot", "label": "Autopilot", "file": "~/.tools/autopilot/mode.json",
//                  "host": "my-server",                     // machine that holds the file (hostname contains this)
//                  "short": "Pilot", "confirmOn": "Turn it on?", "confirmOff": "Turn it off?", "onLabel": "Turn on", "offLabel": "Turn off",
//                  "intervals": [{ "sec": 60, "label": "1 min · Very high" }, …], "intervalDefault": 300,   // optional: how often the tool runs
//                  "tickFile": "~/.tools/autopilot/tick.json" }]   // optional: { "at": <epoch s of its last run> }, for the countdown
// The file is { "enabled": bool, "by": "mesh", "at": "<ISO time>", "from": "<machine or phone>", "interval": <sec> }; missing = OFF.
// Writes keep the file's other keys (a flip keeps the interval, an interval change keeps the state); the interval needs no popup.
// On a machine that isn't the host, get/set go to the peer (peer.js) over /api/switches.
const fs = require('fs'), path = require('path'), os = require('os');

function createSwitches({ peer, machine }) {
  const fromEnv = () => { try { return process.env.MESH_SWITCHES_JSON ? JSON.parse(process.env.MESH_SWITCHES_JSON) : null; } catch { return null; } };   // QA instances: own switch list
  const list = () => (fromEnv() || require('./mesh-name').switches || []).filter(s => s && s.id && s.file);
  const isHost = s => !s.host || os.hostname().toLowerCase().includes(String(s.host).toLowerCase());
  const fileOf = s => s.file.replace(/^~(?=\/|$)/, os.homedir());
  const lastRun = s => { if (!s.tickFile) return null; try { const a = +JSON.parse(fs.readFileSync(s.tickFile.replace(/^~(?=\/|$)/, os.homedir()), 'utf8')).at; return a > 0 ? Math.round(a * 1000) : null; } catch { return null; } };
  const pub = s => ({ id: s.id, label: s.label || s.id, short: s.short || '', confirmOn: s.confirmOn || '', confirmOff: s.confirmOff || '', onLabel: s.onLabel || '', offLabel: s.offLabel || '',
    intervals: Array.isArray(s.intervals) ? s.intervals.filter(i => i && i.sec > 0).map(i => ({ sec: +i.sec, label: String(i.label || i.sec + ' s') })) : [], intervalDefault: s.intervalDefault || null });
  function readLocal(s) {
    try { const j = JSON.parse(fs.readFileSync(fileOf(s), 'utf8')); return { ...pub(s), enabled: j.enabled === true, by: j.by || null, at: j.at || null, from: j.from || null, interval: +j.interval || s.intervalDefault || null, lastRun: lastRun(s) }; }
    catch (e) { return { ...pub(s), enabled: false, by: null, at: null, from: null, interval: s.intervalDefault || null, lastRun: lastRun(s), missing: e.code === 'ENOENT' }; }
  }
  function writeLocal(s, patch, from) {
    const f = fileOf(s), tmp = f + '.tmp-' + process.pid;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    let old = {}; try { old = JSON.parse(fs.readFileSync(f, 'utf8')) || {}; } catch { }
    const next = 'enabled' in patch ? { ...old, enabled: !!patch.enabled, by: 'mesh', at: new Date().toISOString(), from: from || machine }
      : { ...old, ...patch, intervalBy: from || machine, intervalAt: new Date().toISOString() };
    if (!('enabled' in next)) next.enabled = false;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
    fs.renameSync(tmp, f);                                  // atomic: the reader never sees half a file
    return readLocal(s);
  }
  const viaPeer = async (method, body, query) => {
    if (!peer || !peer()) throw new Error('the other machine is not linked');
    return peer().forward(method, '/api/switches', body, query, 15000);
  };
  return {
    // every switch with its state; remote ones are asked of the peer (one call), marked offline if it can't answer
    async get(hop) {
      const all = list(); if (!all.length) return [];
      const remote = all.filter(s => !isHost(s));
      let theirs = [];
      if (remote.length && !hop) theirs = await viaPeer('GET', undefined, { hop: '1' }).catch(e => ({ err: e.message }));
      return all.map(s => {
        if (isHost(s)) return readLocal(s);
        const r = Array.isArray(theirs) && theirs.find(x => x.id === s.id);
        return r && !r.offline ? r : { ...pub(s), enabled: null, offline: true, err: (theirs && theirs.err) || 'not answered by the other machine' };
      });
    },
    async set(id, enabled, from, hop) {
      const s = list().find(x => x.id === id); if (!s) return { ok: false, err: 'no such switch: ' + id };
      if (typeof enabled !== 'boolean') return { ok: false, err: 'enabled must be true or false' };
      if (isHost(s)) { try { return { ok: true, state: writeLocal(s, { enabled }, from) }; } catch (e) { return { ok: false, err: e.message }; } }
      if (hop) return { ok: false, err: 'neither machine holds this switch' };
      return viaPeer('POST', { id, enabled, from: from || machine, hop: 1 }).catch(e => ({ ok: false, err: 'Couldn\'t reach the other machine: ' + e.message }));
    },
    // how often the tool runs: one of the switch's own "intervals" (seconds)
    async setInterval(id, sec, from, hop) {
      const s = list().find(x => x.id === id); if (!s) return { ok: false, err: 'no such switch: ' + id };
      sec = +sec;
      if (isHost(s)) { if (!pub(s).intervals.some(i => i.sec === sec)) return { ok: false, err: 'not one of this switch\'s intervals: ' + sec };   // the holder's list decides
        try { return { ok: true, state: writeLocal(s, { interval: sec }, from) }; } catch (e) { return { ok: false, err: e.message }; } }
      if (hop) return { ok: false, err: 'neither machine holds this switch' };
      return viaPeer('POST', { id, interval: sec, from: from || machine, hop: 1 }).catch(e => ({ ok: false, err: 'Couldn\'t reach the other machine: ' + e.message }));
    },
  };
}
module.exports = { createSwitches };
