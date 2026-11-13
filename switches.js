// Mode switches: ON/OFF flags another tool reads from a small JSON file on one machine, flipped from Mesh on either
// Mac or the phone. Each switch is set in mesh.local.json (never in code):
//   "switches": [{ "id": "autopilot", "label": "Autopilot", "file": "~/.tools/autopilot/mode.json",
//                  "host": "my-server",                     // machine that holds the file (hostname contains this)
//                  "short": "Pilot", "confirmOn": "Turn it on?", "confirmOff": "Turn it off?", "onLabel": "Turn on", "offLabel": "Turn off" }]
// The file is { "enabled": bool, "by": "mesh", "at": "<ISO time>", "from": "<machine or phone>" }; missing = OFF.
// On a machine that isn't the host, get/set go to the peer (peer.js) over /api/switches.
const fs = require('fs'), path = require('path'), os = require('os');

function createSwitches({ peer, machine }) {
  const fromEnv = () => { try { return process.env.MESH_SWITCHES_JSON ? JSON.parse(process.env.MESH_SWITCHES_JSON) : null; } catch { return null; } };   // QA instances: own switch list
  const list = () => (fromEnv() || require('./mesh-name').switches || []).filter(s => s && s.id && s.file);
  const isHost = s => !s.host || os.hostname().toLowerCase().includes(String(s.host).toLowerCase());
  const fileOf = s => s.file.replace(/^~(?=\/|$)/, os.homedir());
  const pub = s => ({ id: s.id, label: s.label || s.id, short: s.short || '', confirmOn: s.confirmOn || '', confirmOff: s.confirmOff || '', onLabel: s.onLabel || '', offLabel: s.offLabel || '' });
  function readLocal(s) {
    try { const j = JSON.parse(fs.readFileSync(fileOf(s), 'utf8')); return { ...pub(s), enabled: j.enabled === true, by: j.by || null, at: j.at || null, from: j.from || null }; }
    catch (e) { return { ...pub(s), enabled: false, by: null, at: null, from: null, missing: e.code === 'ENOENT' }; }
  }
  function writeLocal(s, enabled, from) {
    const f = fileOf(s), tmp = f + '.tmp-' + process.pid;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ enabled: !!enabled, by: 'mesh', at: new Date().toISOString(), from: from || machine }, null, 2) + '\n');
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
      if (isHost(s)) { try { return { ok: true, state: writeLocal(s, enabled, from) }; } catch (e) { return { ok: false, err: e.message }; } }
      if (hop) return { ok: false, err: 'neither machine holds this switch' };
      return viaPeer('POST', { id, enabled, from: from || machine, hop: 1 }).catch(e => ({ ok: false, err: 'Couldn\'t reach the other machine: ' + e.message }));
    },
  };
}
module.exports = { createSwitches };
