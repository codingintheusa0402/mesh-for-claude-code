// Mode switches: ON/OFF flags another tool reads from a small JSON file on one machine, flipped from Mesh on either
// Mac or the phone. Each switch is set in mesh.local.json (never in code):
//   "switches": [{ "id": "autopilot", "label": "Autopilot", "file": "~/.tools/autopilot/mode.json",
//                  "host": "my-server",                     // machine that holds the file (hostname contains this)
//                  "short": "Pilot", "confirmOn": "Turn it on?", "confirmOff": "Turn it off?", "onLabel": "Turn on", "offLabel": "Turn off",
//                  "intervals": [{ "sec": 60, "label": "1 min · Very high" }, …], "intervalDefault": 300,   // optional: how often the tool runs
//                  "tickFile": "~/.tools/autopilot/tick.json",   // optional: { "at": <epoch s of its last run> }, for the countdown
//                  "schedule": true, "scheduleTz": "Asia/Seoul" }]   // optional: hours it may run, edited in the pill's menu
// A schedule is stored as "schedule": { "enabled", "start": "HH:MM", "end": "HH:MM", "days": [Mon=0 … Sun=6], "tz" }; start > end
// is an overnight window that belongs to the day it starts. Outside the window the tool treats the switch as OFF.
// The file is { "enabled": bool, "by": "mesh", "at": "<ISO time>", "from": "<machine or phone>", "interval": <sec> }; missing = OFF.
// Writes keep the file's other keys (a flip keeps the interval, an interval change keeps the state); the interval needs no popup.
// On a machine that isn't the host, get/set go to the peer (peer.js) over /api/switches.
const fs = require('fs'), path = require('path'), os = require('os');

// is it inside the window at local weekday w (Mon=0) and minute m? (the same rule the tool applies)
const HM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const hm = x => +x.slice(0, 2) * 60 + +x.slice(3, 5);
function inWin(sc, w, m) {
  const a = hm(sc.start || '00:00'), b = sc.end === '24:00' || !sc.end ? 1439 : hm(sc.end), days = sc.days && sc.days.length ? sc.days : [0, 1, 2, 3, 4, 5, 6];
  if (a <= b) return days.includes(w) && a <= m && m < b;
  return (days.includes(w) && m >= a) || (days.includes((w + 6) % 7) && m < b);
}
// now (in the schedule's zone): inside or not, and when that next changes (epoch ms; null = never within 8 days)
function scheduleNow(sc, now = Date.now()) {
  if (!sc || !sc.enabled) return { scheduled: false, inWindow: true, nextChange: null };
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: sc.tz || 'Asia/Seoul', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
    const g = t => f.find(x => x.type === t).value, w0 = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(g('weekday')), m0 = +g('hour') * 60 + +g('minute');
    const cur = inWin(sc, w0, m0), base = now - (now % 60000);
    for (let k = 1; k <= 8 * 1440; k++) { const t = m0 + k; if (inWin(sc, (w0 + Math.floor(t / 1440)) % 7, t % 1440) !== cur) return { scheduled: true, inWindow: cur, nextChange: base + k * 60000 }; }
    return { scheduled: true, inWindow: cur, nextChange: null };
  } catch { return { scheduled: false, inWindow: true, nextChange: null }; }
}

function createSwitches({ peer, machine }) {
  const fromEnv = () => { try { return process.env.MESH_SWITCHES_JSON ? JSON.parse(process.env.MESH_SWITCHES_JSON) : null; } catch { return null; } };   // QA instances: own switch list
  const list = () => (fromEnv() || require('./mesh-name').switches || []).filter(s => s && s.id && s.file);
  const isHost = s => !s.host || os.hostname().toLowerCase().includes(String(s.host).toLowerCase());
  const fileOf = s => s.file.replace(/^~(?=\/|$)/, os.homedir());
  const lastRun = s => { if (!s.tickFile) return null; try { const a = +JSON.parse(fs.readFileSync(s.tickFile.replace(/^~(?=\/|$)/, os.homedir()), 'utf8')).at; return a > 0 ? Math.round(a * 1000) : null; } catch { return null; } };
  const pub = s => ({ id: s.id, label: s.label || s.id, short: s.short || '', confirmOn: s.confirmOn || '', confirmOff: s.confirmOff || '', onLabel: s.onLabel || '', offLabel: s.offLabel || '',
    intervals: Array.isArray(s.intervals) ? s.intervals.filter(i => i && i.sec > 0).map(i => ({ sec: +i.sec, label: String(i.label || i.sec + ' s') })) : [], intervalDefault: s.intervalDefault || null,
    hasSchedule: !!s.schedule, scheduleTz: s.scheduleTz || 'Asia/Seoul' });
  function readLocal(s) {
    try { const j = JSON.parse(fs.readFileSync(fileOf(s), 'utf8')); return { ...pub(s), enabled: j.enabled === true, by: j.by || null, at: j.at || null, from: j.from || null, interval: +j.interval || s.intervalDefault || null, lastRun: lastRun(s), schedule: j.schedule || null, ...scheduleNow(j.schedule) }; }
    catch (e) { return { ...pub(s), enabled: false, by: null, at: null, from: null, interval: s.intervalDefault || null, lastRun: lastRun(s), schedule: null, ...scheduleNow(null), missing: e.code === 'ENOENT' }; }
  }
  function writeLocal(s, patch, from) {
    const f = fileOf(s), tmp = f + '.tmp-' + process.pid;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    let old = {}; try { old = JSON.parse(fs.readFileSync(f, 'utf8')) || {}; } catch { }
    const next = 'enabled' in patch ? { ...old, enabled: !!patch.enabled, by: 'mesh', at: new Date().toISOString(), from: from || machine }
      : { ...old, ...patch, [('schedule' in patch ? 'schedule' : 'interval') + 'By']: from || machine, [('schedule' in patch ? 'schedule' : 'interval') + 'At']: new Date().toISOString() };
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
    // the hours it may run (checked on the machine that holds it; the other machine forwards)
    async setSchedule(id, sc, from, hop) {
      const s = list().find(x => x.id === id); if (!s) return { ok: false, err: 'no such switch: ' + id };
      if (isHost(s)) {
        if (!s.schedule) return { ok: false, err: 'this switch has no schedule' };
        if (!sc || typeof sc.enabled !== 'boolean' || !HM.test(sc.start || '') || !HM.test(sc.end || '') || sc.start === '24:00') return { ok: false, err: 'schedule needs enabled, start and end (HH:MM)' };
        if (sc.start === sc.end) return { ok: false, err: 'start and end are the same time' };
        const days = [...new Set((Array.isArray(sc.days) ? sc.days : []).map(Number))].filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort();
        if (sc.enabled && !days.length) return { ok: false, err: 'pick at least one day' };
        const tz = String(sc.tz || s.scheduleTz || 'Asia/Seoul'); try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { return { ok: false, err: 'unknown time zone: ' + tz }; }
        try { return { ok: true, state: writeLocal(s, { schedule: { enabled: sc.enabled, start: sc.start, end: sc.end, days, tz } }, from) }; } catch (e) { return { ok: false, err: e.message }; }
      }
      if (hop) return { ok: false, err: 'neither machine holds this switch' };
      return viaPeer('POST', { id, schedule: sc, from: from || machine, hop: 1 }).catch(e => ({ ok: false, err: 'Couldn\'t reach the other machine: ' + e.message }));
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
module.exports = { createSwitches, scheduleNow };
