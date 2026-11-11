// Mesh — the other machine. The Mac app and the server program each run a phone server; with a
// peer configured, each one also shows the OTHER machine's live sessions (fetched over Tailscale) and
// forwards send / interrupt / rename / details / terminal for them, so the iPhone sees one mesh whichever
// machine it is connected to. When the peer goes offline its last-seen sessions stay listed as offline
// (with "Resume here" once their transcript has been synced to this machine).
//
// Config: <userData>/peer.json  { "url": "http://100.x.y.z:47320", "token": "<the peer's phone token>",
//                                 "kind": "mac" | "server", "label": "mini" (optional display name),
//                                 "selfLabel": "MacMini" (optional — tags THIS machine's own sessions) }
// Nothing here touches Electron.
const fs = require('fs');
const path = require('path');
const http = require('http');

const POLL_MS = 4000, OFFLINE_KEEP_MS = 7 * 24 * 3600 * 1000;
const MISSES_OFFLINE = 3;                   // one slow/failed poll is a hiccup; three in a row (~12 s) is offline
const PREFIX = 'peer:';                     // terminal ids of the peer's panes, as seen by the phone

function createPeer({ userData, selfKind }) {
  const file = path.join(userData, 'peer.json');
  let cfg = null, last = null, lastOk = 0, online = false, timer = null, misses = 0;

  function loadCfg() {
    try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); cfg = c && c.url && c.token ? c : null; } catch { cfg = null; }
    return cfg;
  }
  const kind = () => (cfg && cfg.kind) || (selfKind === 'server' ? 'mac' : 'server');
  const label = () => (cfg && cfg.label) || (kind() === 'mac' ? 'Mac' : 'server');

  function request(method, p, { body, query, timeout = 6000, stream } = {}) {
    return new Promise((resolve, reject) => {
      if (!cfg) return reject(new Error('no peer configured'));
      const u = new URL(p, cfg.url);
      u.searchParams.set('t', cfg.token);
      for (const [k, v] of Object.entries(query || {})) u.searchParams.set(k, v);
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const req = http.request(u, { method, timeout, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, res => {
        if (stream) return resolve(res);
        let s = ''; res.setEncoding('utf8'); res.on('data', d => s += d);
        res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(s || '{}') }); } catch { resolve({ status: res.statusCode, json: {} }); } });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  async function poll() {
    if (!loadCfg()) { online = false; misses = 0; return; }
    let ok = false;
    try {
      const r = await request('GET', '/api/local-snapshot', { timeout: 3500 });
      if (r.status === 200 && r.json && Array.isArray(r.json.sessions)) { last = r.json; lastOk = Date.now(); ok = true; }
    } catch { }
    if (ok) { misses = 0; online = true; } else if (++misses >= MISSES_OFFLINE) online = false;
  }
  function start() { if (!timer) { poll(); timer = setInterval(poll, POLL_MS); } }

  const remoteSids = () => new Set(((last && last.sessions) || []).map(s => s.sid));
  // a conversation live on BOTH machines is listed twice; the peer's copy carries sid "peer:<sid>"
  const unprefix = sid => typeof sid === 'string' && sid.startsWith(PREFIX) ? sid.slice(PREFIX.length) : sid;
  const owns = sid => online && remoteSids().has(unprefix(sid));
  const ownsTerm = id => typeof id === 'string' && id.startsWith(PREFIX);

  const hostOf = u => { try { return new URL(u).hostname; } catch { return null; } };
  // local snapshot + the peer's sessions (marked remote; offline ones greyed) — never mutates `local`
  function merge(local) {
    if (!local) return local;
    const out = { ...local, peer: cfg ? { kind: kind(), label: label(), online, lastSeen: lastOk || null, caps: (last && last.caps) || [], mem: online && last ? last.mem || null : null, build: (last && last.build) || null, host: hostOf(cfg.url), selfLabel: cfg.selfLabel || null } : null };
    const selfLabel = cfg && cfg.selfLabel;
    out.sessions = local.sessions.map(s => ({ ...s, hostKind: selfKind, ...(selfLabel ? { hostLabel: selfLabel } : {}) }));
    if (!last || !cfg || (!online && Date.now() - lastOk > OFFLINE_KEEP_MS)) return out;
    const mine = new Set(out.sessions.map(s => s.sid));
    for (const s of last.sessions || []) {
      // live here too: while the peer is online both copies are shown (each machine's terminal is its own);
      // an offline peer's last-seen copy of a conversation that now runs here is just stale — hide it
      const both = mine.has(s.sid);
      if (both && !online) continue;
      out.sessions.push({ ...s, ...(both ? { sid: PREFIX + s.sid, remoteSid: s.sid } : {}), hostKind: kind(), hostLabel: label(), onPeer: true, offline: !online,
        owner: online && (s.owner || s.pane) ? PREFIX + (s.owner || s.pane) : null, pane: null,
        health: online ? s.health : 'offline', tps: online ? s.tps : 0 });
    }
    if (online) out.ptys = [...(local.ptys || []), ...((last.ptys || []).map(p => ({ ...p, id: PREFIX + p.id, onPeer: true })))];
    return out;
  }

  return {
    start, merge, owns, ownsTerm, online: () => online, configured: () => !!cfg, label, name: () => (last && last.machine) || '',
    configured: () => !!loadCfg(),
    config: () => loadCfg(),                                            // { url, token, … } (handoff.js streams files to it)
    // the peer's live sessions right now (a fresh fetch, not the last poll) — handoff.js waits on this
    sessionsNow: () => request('GET', '/api/local-snapshot', { timeout: 3500 }).then(r => (r.json && r.json.sessions) || []).catch(() => []),
    // forward a JSON API call for a peer session
    forward: (method, p, body, query, timeout) => request(method, p, {
      body: body && body.sid ? { ...body, sid: unprefix(body.sid) } : body,
      query: query && query.sid ? { ...query, sid: unprefix(query.sid) } : query, ...(timeout ? { timeout } : {}),
    }).then(r => r.json),
    // pipe the peer's terminal SSE stream for terminal `id` (with the peer: prefix) into `res`
    async pipeTerm(id, res, onClose) {
      const up = await request('GET', '/api/term/' + encodeURIComponent(id.slice(PREFIX.length)), { stream: true, timeout: 0 });
      res.writeHead(up.statusCode, { 'Content-Type': up.headers['content-type'] || 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      up.pipe(res);
      onClose(() => up.destroy());
    },
    // raw SSE response of the peer's terminal `id` (with the peer: prefix), for the desktop window's mirror
    openTerm: id => request('GET', '/api/term/' + encodeURIComponent(id.slice(PREFIX.length)), { stream: true, timeout: 0 }),
    upload: (name, b64) => request('POST', '/api/upload', { body: { name, b64 }, timeout: 30000 }).then(r => r.json),
    termResize: (id, cols, rows) => request('POST', '/api/term/' + encodeURIComponent(id.slice(PREFIX.length)), { body: { resize: { cols, rows } } }).then(r => r.json),
    termWrite: (id, data) => request('POST', '/api/term/' + encodeURIComponent(id.slice(PREFIX.length)), { body: { data } }).then(r => r.json),
  };
}

module.exports = { createPeer, PEER_PREFIX: PREFIX };
