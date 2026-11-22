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
// Picking an interval (even the current one) also writes "runNow": <ISO time>: the tool runs once right away, then every
// <interval> from that run. Optional "kick": "<launchd label>" starts the tool's job at once instead of at its next tick.
// On a machine that isn't the host, get/set go to the peer (peer.js) over /api/switches.
const fs = require('fs'), path = require('path'), os = require('os');

// Optional "vacation": true in a switch's config adds a vacation block to its menu, stored in the file as
// "vacation": { "enabled", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" (inclusive), "start": "HH:MM", "end": "HH:MM", "tz",
//   "admin": { "name", ...ids the tool needs, kept as written }, "interval": <sec>, "peak": { "start", "end", "interval" } | null }.
// The tool decides what it does with it (e.g. runs inside those dates and hours at that interval, asking the admin instead of
// the owner); Mesh only stores it, shows whether it is active and runs the tool once on save.
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function vacationNow(v, now = Date.now()) {
  if (!v || !v.enabled) return { vacationActive: false, vacationState: 'off' };
  try {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: v.tz || 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
    const g = t => f.find(x => x.type === t).value, day = `${g('year')}-${g('month')}-${g('day')}`, m = +g('hour') * 60 + +g('minute');
    if (day > v.to) return { vacationActive: false, vacationState: 'over' };
    if (day < v.from) return { vacationActive: false, vacationState: 'upcoming' };
    const a = hm(v.start), b = hm(v.end), on = a <= b ? a <= m && m < b : m >= a || m < b;
    const pk = v.peak && v.peak.interval ? (hm(v.peak.start) <= m && m < hm(v.peak.end)) : false;
    return { vacationActive: on, vacationState: on ? (pk ? 'peak' : 'on') : 'today-off-hours', vacationInterval: on ? (pk ? v.peak.interval : v.interval) : null };
  } catch { return { vacationActive: false, vacationState: 'off' }; }
}

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
    hasSchedule: !!s.schedule, scheduleTz: s.scheduleTz || 'Asia/Seoul', hasVacation: !!s.vacation });
  function readLocal(s) {
    try { const j = JSON.parse(fs.readFileSync(fileOf(s), 'utf8')); return { ...pub(s), enabled: j.enabled === true, by: j.by || null, at: j.at || null, from: j.from || null, interval: +j.interval || s.intervalDefault || null, lastRun: lastRun(s), schedule: j.schedule || null, ...scheduleNow(j.schedule), vacation: j.vacation || null, ...vacationNow(j.vacation) }; }
    catch (e) { return { ...pub(s), enabled: false, by: null, at: null, from: null, interval: s.intervalDefault || null, lastRun: lastRun(s), schedule: null, ...scheduleNow(null), vacation: null, ...vacationNow(null), missing: e.code === 'ENOENT' }; }
  }
  function writeLocal(s, patch, from) {
    const f = fileOf(s), tmp = f + '.tmp-' + process.pid;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    let old = {}; try { old = JSON.parse(fs.readFileSync(f, 'utf8')) || {}; } catch { }
    const next = 'enabled' in patch ? { ...old, enabled: !!patch.enabled, by: 'mesh', at: new Date().toISOString(), from: from || machine }
      : (k => ({ ...old, ...patch, [k + 'By']: from || machine, [k + 'At']: new Date().toISOString() }))(['schedule', 'vacation'].find(x => x in patch) || 'interval');
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
    // vacation mode (switch config "vacation": true): dates, daily hours, who stands in, how often (normal and peak)
    async setVacation(id, v, from, hop) {
      const s = list().find(x => x.id === id); if (!s) return { ok: false, err: 'no such switch: ' + id };
      if (isHost(s)) {
        if (!s.vacation) return { ok: false, err: 'this switch has no vacation mode' };
        if (!v || typeof v.enabled !== 'boolean') return { ok: false, err: 'vacation needs enabled' };
        if (!DATE.test(v.from || '') || !DATE.test(v.to || '') || v.from > v.to) return { ok: false, err: 'pick a start and end date (end not before start)' };
        if (!HM.test(v.start || '') || !HM.test(v.end || '') || v.start === v.end) return { ok: false, err: 'daily hours need a start and end (HH:MM), not the same' };
        const sec = x => Number.isInteger(+x) && +x >= 30 && +x <= 3600;
        if (!sec(v.interval)) return { ok: false, err: 'interval must be 30 s to 1 h' };
        let peak = null;
        if (v.peak && v.peak.interval) { if (!HM.test(v.peak.start || '') || !HM.test(v.peak.end || '') || hm(v.peak.start) >= hm(v.peak.end) || !sec(v.peak.interval)) return { ok: false, err: 'peak needs start < end (HH:MM) and an interval of 30 s to 1 h' };
          peak = { start: v.peak.start, end: v.peak.end, interval: +v.peak.interval }; }
        const name = String((v.admin && v.admin.name) || '').trim().slice(0, 60);
        if (v.enabled && !name) return { ok: false, err: 'name the admin who stands in for you' };
        const tz = String(v.tz || s.scheduleTz || 'Asia/Seoul'); try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { return { ok: false, err: 'unknown time zone: ' + tz }; }
        let old = {}; try { old = JSON.parse(fs.readFileSync(fileOf(s), 'utf8')).vacation || {}; } catch { }
        // the admin's ids (user, dm space, email) are the tool's: kept unless the name changes or the menu sends new ones
        const oldA = old.admin || {}, admin = { ...(oldA.name === name ? oldA : {}), ...Object.fromEntries(Object.entries(v.admin || {}).filter(([k, x]) => typeof x === 'string' && x.trim()).map(([k, x]) => [k, x.trim().slice(0, 200)])), name };
        const vac = { enabled: v.enabled, from: v.from, to: v.to, start: v.start, end: v.end, tz, admin, interval: +v.interval, peak };
        let state; try { state = writeLocal(s, { vacation: vac, runNow: new Date().toISOString() }, from); } catch (e) { return { ok: false, err: e.message }; }
        if (s.kick) try { require('child_process').execFile('launchctl', ['kickstart', `gui/${process.getuid()}/${s.kick}`], () => { }); } catch { }
        return { ok: true, state };
      }
      if (hop) return { ok: false, err: 'neither machine holds this switch' };
      return viaPeer('POST', { id, vacation: v, from: from || machine, hop: 1 }).catch(e => ({ ok: false, err: 'Couldn\'t reach the other machine: ' + e.message }));
    },
    // how often the tool runs: one of the switch's own "intervals" (seconds)
    async setInterval(id, sec, from, hop) {
      const s = list().find(x => x.id === id); if (!s) return { ok: false, err: 'no such switch: ' + id };
      sec = +sec;
      if (isHost(s)) { if (!pub(s).intervals.some(i => i.sec === sec)) return { ok: false, err: 'not one of this switch\'s intervals: ' + sec };   // the holder's list decides
        // a click also asks for one run right away ("runNow"), then the tool keeps the new interval from there (Kevin 11-16)
        let state; try { state = writeLocal(s, { interval: sec, runNow: new Date().toISOString() }, from); } catch (e) { return { ok: false, err: e.message }; }
        if (s.kick) try { require('child_process').execFile('launchctl', ['kickstart', `gui/${process.getuid()}/${s.kick}`], () => { }); } catch { }
        return { ok: true, state, runNow: true }; }
      if (hop) return { ok: false, err: 'neither machine holds this switch' };
      return viaPeer('POST', { id, interval: sec, from: from || machine, hop: 1 }).catch(e => ({ ok: false, err: 'Couldn\'t reach the other machine: ' + e.message }));
    },
  };
}
module.exports = { createSwitches, scheduleNow, vacationNow };
