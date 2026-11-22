// Server display: turn the always-on Mac's display off and on from either Mac or the phone, and show its live state.
// OFF = `pmset displaysleepnow` (only the display sleeps; every job keeps running), ON = `caffeinate -u -t 2`.
// The state is read live (CoreGraphics CGDisplayIsAsleep through JXA), never "the last click".
// Safety: OFF is refused with a warning, and nothing is changed, while system sleep is enabled (`pmset -g` sleep != 0)
// or the screen locks after the display turns off (System Settings > Lock Screen "Require password after screen saver
// begins or display is turned off"): a locked server can break jobs that need an unlocked session. Mesh never changes
// either setting. OFF also writes a flag file that keep-awake helpers (mouse jigglers) can check so they don't wake the
// display again; ON removes it.
// Config (mesh.local.json): "display": { "host": "<hostname part of the Mac that owns the display>", "label": "Mini display",
// "flag": "~/.mesh/display-off" }. Without "display" there is no button. On the other Mac every call goes to the peer.
const fs = require('fs'), os = require('os'), path = require('path'), { execFile } = require('child_process');

const run = (cmd, args, timeout = 8000) => new Promise(res => execFile(cmd, args, { timeout }, (e, out, err) => res({ ok: !e, out: String(out || ''), err: String(err || '') })));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const JXA = 'ObjC.import("CoreGraphics");ObjC.bindFunction("CGDisplayIsAsleep",["bool",["uint32"]]);ObjC.bindFunction("CGMainDisplayID",["uint32",[]]);String($.CGDisplayIsAsleep($.CGMainDisplayID()))';

function createDisplay({ peer, cfg }) {
  const c = cfg || {}, label = c.label || 'Server display';
  const tilde = p => p.replace(/^~(?=\/|$)/, os.homedir());
  const FLAG = tilde(c.flag || '~/.mesh/display-off');
  const isHost = () => !!c.host && os.hostname().toLowerCase().includes(String(c.host).toLowerCase());

  async function localState() {
    const [a, pm, lk] = await Promise.all([run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', JXA]), run('/usr/bin/pmset', ['-g']), run('/usr/sbin/sysadminctl', ['-screenLock', 'status'])]);
    const asleep = a.ok ? /true/.test(a.out) : null;
    const sm = /^\s*sleep\s+(\d+)/m.exec(pm.out), sleepMin = sm ? +sm[1] : null;
    const lt = lk.out + lk.err, lm = /delay is (\d+) seconds/.exec(lt);
    const lockSec = /screenLock is off/i.test(lt) ? null : lm ? +lm[1] : /immediate/i.test(lt) ? 0 : null;
    let warning = '';
    if (sleepMin !== 0) warning = `System sleep is on (pmset sleep ${sleepMin ?? '?'}): turning the display off could put the Mac to sleep. Set System Settings > Energy > "Prevent automatic sleeping when the display is off" first.`;
    else if (lockSec !== null) warning = `The Mac locks ${lockSec ? Math.round(lockSec / 60) + ' min' : 'right away'} after its display turns off. Set System Settings > Lock Screen > "Require password after screen saver begins or display is turned off" to Never first.`;
    return { ok: true, label, host: os.hostname(), asleep, sleepMin, lockSec, warning, wantOff: fs.existsSync(FLAG), at: Date.now() };
  }

  async function localSet(on, force) {
    if (on) {
      try { fs.unlinkSync(FLAG); } catch { }
      await run('/usr/bin/caffeinate', ['-u', '-t', '2'], 6000);
      await sleep(800);
      return localState();
    }
    const st = await localState();
    if (st.warning && !force) return { ...st, ok: false, err: st.warning };
    try { fs.mkdirSync(path.dirname(FLAG), { recursive: true }); fs.writeFileSync(FLAG, new Date().toISOString() + '\n'); } catch { }
    const r = await run('/usr/bin/pmset', ['displaysleepnow']);
    if (!r.ok) return { ...st, ok: false, err: 'pmset displaysleepnow failed: ' + (r.err || r.out).trim().slice(0, 200) };
    await sleep(1500);
    return localState();
  }

  const viaPeer = (method, body) => {
    if (!peer || !peer()) return Promise.resolve({ ok: false, err: 'the other Mac is not linked' });
    return peer().forward(method, '/api/display', body, method === 'GET' ? { hop: '1' } : undefined, 20000).catch(e => ({ ok: false, err: e.message }));
  };
  return {
    enabled: () => !!c.host,
    label,
    async get(hop) { if (!c.host) return { ok: false, err: 'no display configured' }; if (isHost()) return localState(); if (hop) return { ok: false, err: 'neither Mac owns the display' }; return viaPeer('GET'); },
    async set(on, force, hop) {
      if (!c.host) return { ok: false, err: 'no display configured' };
      if (typeof on !== 'boolean') return { ok: false, err: 'on must be true or false' };
      if (isHost()) return localSet(on, !!force);
      if (hop) return { ok: false, err: 'neither Mac owns the display' };
      return viaPeer('POST', { on, force: !!force, hop: 1 });
    },
  };
}
module.exports = { createDisplay };
