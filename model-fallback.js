// Model fallback (2026-11-15): when Opus fails from an outage (repeated 5xx / overloaded / unavailable for 2+ minutes, or the
// public status page shows an Opus/API incident), each Opus session on this Mac is switched to Sonnet with /model; once Opus
// has answered normally for 10+ minutes (a tiny `claude -p` probe every 2 minutes), the sessions are switched back.
//   - only errors an outage causes count: login, sleep, network, usage-limit and safeguard errors never trigger it
//   - a session is switched only at a safe point: not mid-turn, nothing typed in its box (sendToSession waits for that)
//   - /model also saves the model as the default for NEW sessions (~/.claude/settings.json "model"), so the default is put
//     back exactly as it was right after each switch
//   - one alert when a fallback starts and one when it ends, listing the sessions (the alert command in mesh.local.json)
//   - the state is in <userData>/model-fallback.json; each session in the snapshot carries `fallback` {from,to,at,reason}
// Config (mesh.local.json, optional): "modelFallback": { "enabled": true, "to": "sonnet", "back": "opus" }
// QA hooks: MESH_FALLBACK_PROBE (a command: exit 0 = Opus works), MESH_FALLBACK_STATUS (a JSON file in place of the status page).
const fs = require('fs'), path = require('path'), os = require('os'), https = require('https'), { execFile } = require('child_process');

const OUTAGE = /\b5\d\d\b|overloaded|internal server error|temporarily unavailable|service unavailable|capacity|upstream/i;
const NOT_OUTAGE = /log ?in|logged|sleep|ENOTFOUND|ECONN|internet|DNS|usage|limit|credits|safeguard|aup|too long|image|does not support|400\b|401\b|403\b|429\b/i;
const K = +process.env.MESH_FALLBACK_SCALE || 1;          // QA: 0.01 runs the timers 100x faster
const MIN_FOR = 2 * 60e3 * K, BACK_AFTER = 10 * 60e3 * K, PROBE_EVERY = 2 * 60e3 * K, STATUS_EVERY = 3 * 60e3 * K;

module.exports = function createFallback(ctx) {
  // ctx: userData, getSnap, sendToSession, alert(title, body), claudeBin(), log(line), conf
  const conf = Object.assign({ enabled: true, to: 'sonnet', back: 'opus' }, ctx.conf || {});
  const FILE = path.join(ctx.userData, 'model-fallback.json'), SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
  let st = { active: {}, startedAt: 0, alerted: false, okSince: 0, lastProbe: 0, incident: null, statusAt: 0, ended: [] };
  try { Object.assign(st, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch { }
  const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(st, null, 1)); } catch { } };
  const firstErr = {};                         // sid -> first time an outage error was seen (cleared after 5 quiet minutes)
  const log = m => { try { ctx.log && ctx.log(m); } catch { } };
  const isOpus = m => /opus/i.test(m || '');
  const outageErr = s => s.errors5m > 0 && OUTAGE.test(s.lastError || '') && !NOT_OUTAGE.test(s.lastError || '');
  const eligible = s => s && !s.onPeer && !s.watchOnly && s.kind !== 'hermes' && s.kind !== 'agent' && s.engine !== 'ollama' && !s.headless;

  // /model saves the default for new sessions too: put it back exactly
  async function switchModel(sid, model) {
    let before = null; try { before = fs.readFileSync(SETTINGS, 'utf8'); } catch { }
    const r = await ctx.sendToSession(sid, '/model ' + model);
    for (let i = 0; i < 10 && before != null; i++) {
      await new Promise(res => setTimeout(res, 800));
      let now = null; try { now = fs.readFileSync(SETTINGS, 'utf8'); } catch { }
      if (now != null && now !== before) {
        try { const a = JSON.parse(before), b = JSON.parse(now);           // only the model key: anything else that changed meanwhile stays
          if ('model' in a) b.model = a.model; else delete b.model;
          fs.writeFileSync(SETTINGS + '.tmp', JSON.stringify(b, null, 2) + '\n'); fs.renameSync(SETTINGS + '.tmp', SETTINGS);
        } catch { } break;
      }
    }
    return r;
  }

  function statusPage() {
    if (process.env.MESH_FALLBACK_STATUS) { try { return Promise.resolve(JSON.parse(fs.readFileSync(process.env.MESH_FALLBACK_STATUS, 'utf8'))); } catch { return Promise.resolve(null); } }
    return new Promise(res => {
      const rq = https.get('https://status.anthropic.com/api/v2/summary.json', { timeout: 10000 }, r => {
        let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } });
      });
      rq.on('error', () => res(null)); rq.on('timeout', () => { rq.destroy(); res(null); });
    });
  }
  // an incident that affects Opus or the API itself (not "operational", not a resolved one)
  function incidentOf(j) {
    if (!j) return null;
    const comp = (j.components || []).filter(c => /opus|claude api|api\b|claude code/i.test(c.name || '') && /major_outage|partial_outage/.test(c.status || ''));
    const inc = (j.incidents || []).filter(i => i.status !== 'resolved' && /opus|api|elevated errors|outage|unavailable/i.test(i.name || ''));
    if (!comp.length && !inc.length) return null;
    return (inc[0] && inc[0].name) || comp.map(c => `${c.name}: ${c.status}`).join(', ');
  }
  function probe() {
    return new Promise(res => {
      if (process.env.MESH_FALLBACK_PROBE) return execFile('/bin/sh', ['-c', process.env.MESH_FALLBACK_PROBE], { timeout: 90000 }, e => res(!e));
      execFile(ctx.claudeBin(), ['-p', '--model', conf.back, '--no-session-persistence', '--output-format', 'text', 'Reply with the single word OK.'],
        { timeout: 90000, env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'mesh-fallback-probe' } }, (e, out) => res(!e && /\bOK\b/i.test(String(out))));
    });
  }

  let busy = false;
  async function tick() {
    if (!conf.enabled || busy) return; busy = true;
    try {
      const snap = ctx.getSnap(); if (!snap) return;
      const ss = (snap.sessions || []).filter(eligible), now = Date.now();
      if (now - st.statusAt > STATUS_EVERY) { st.statusAt = now; st.incident = incidentOf(await statusPage()); }
      for (const s of ss) {
        if (outageErr(s)) firstErr[s.sid] = firstErr[s.sid] || now;
        else if (firstErr[s.sid] && !s.errors5m) delete firstErr[s.sid];
      }
      // 1. switch to the fallback
      const failing = ss.filter(s => outageErr(s) && now - firstErr[s.sid] >= MIN_FOR && s.errors5m >= 2);
      const anyOutage = failing.length > 0 || !!st.incident;
      if (anyOutage) for (const s of ss) {
        if (st.active[s.sid] || s.health === 'working') continue;
        const why = failing.includes(s) ? `Opus errors for ${Math.round((now - firstErr[s.sid]) / 60e3)} min: ${(s.lastError || '').slice(0, 80)}`
          : st.incident ? `status page: ${st.incident}` : `Opus is failing in ${failing.map(f => f.name).join(', ')}`;
        if (!isOpus(s.model) && !(firstErr[s.sid] && /<synthetic>/.test(s.model || ''))) continue;
        if (!st.incident && !failing.includes(s) && !outageErr(s)) continue;       // without an incident only the sessions that fail are moved
        const r = await switchModel(s.sid, conf.to);
        if (r && r.ok === false) { log(`FALLBACK ${s.name}: not switched yet (${r.err})`); continue; }
        st.active[s.sid] = { name: s.name, from: s.model || conf.back, to: conf.to, at: now, reason: why };
        if (!st.startedAt) { st.startedAt = now; st.alerted = false; }
        st.okSince = 0; save(); log(`FALLBACK ${s.name}: Opus → ${conf.to} (${why})`);
      }
      if (st.startedAt && !st.alerted && now - st.startedAt > 60e3 * K) {      // one alert, after a minute to gather the sessions
        const names = Object.values(st.active).map(a => a.name);
        ctx.alert(`Model fallback ON: ${names.length} session(s) moved to ${conf.to}`, `Opus is failing (${Object.values(st.active)[0].reason.slice(0, 120)}). Switched: ${names.join(', ')}. They go back to Opus after it works for 10 min.`);
        st.alerted = true; save();
      }
      // 2. switch back once Opus works for 10 minutes (and the status page is clear)
      if (Object.keys(st.active).length) {
        if (now - st.lastProbe > PROBE_EVERY) {
          st.lastProbe = now; const ok = !st.incident && await probe();
          st.okSince = ok ? (st.okSince || now) : 0; save();
        }
        if (st.okSince && now - st.okSince >= BACK_AFTER) {
          for (const [sid, a] of Object.entries(st.active)) {
            const s = (snap.sessions || []).find(x => x.sid === sid);
            if (!s) { delete st.active[sid]; st.ended.push(a.name); continue; }               // ended or refreshed meanwhile
            if (s.health === 'working') continue;
            const r = await switchModel(sid, /opus/i.test(a.from) ? conf.back : a.from);
            if (r && r.ok === false) continue;
            delete st.active[sid]; st.ended.push(a.name); log(`FALLBACK ${a.name}: back to Opus`);
          }
          if (!Object.keys(st.active).length) {
            const mins = Math.round((now - st.startedAt) / 60e3);
            if (st.alerted) ctx.alert(`Model fallback OFF: back on Opus`, `Opus worked normally for 10 min. Switched back after ${mins} min: ${[...new Set(st.ended)].join(', ')}.`);
            st = { ...st, active: {}, startedAt: 0, alerted: false, okSince: 0, ended: [] };
          }
          save();
        }
      }
    } catch (e) { log('FALLBACK error: ' + e.message); } finally { busy = false; }
  }

  return {
    tick,
    decorate(snap) { for (const s of (snap && snap.sessions) || []) if (st.active[s.sid]) s.fallback = st.active[s.sid]; },
    remap(from, to) { if (st.active[from]) { st.active[to] = st.active[from]; delete st.active[from]; save(); } },
    modelFor(name) { return Object.values(st.active).some(a => a.name === name) ? conf.to : null; },   // a refresh during a fallback starts on Sonnet
    state: () => JSON.parse(JSON.stringify(st)),
  };
};
module.exports.OUTAGE = OUTAGE; module.exports.NOT_OUTAGE = NOT_OUTAGE;
