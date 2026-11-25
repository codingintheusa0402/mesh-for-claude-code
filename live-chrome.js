// Chrome status + tabs + on-demand screenshots for the Live panel (2026-11-25). Pure reads, no Claude calls:
//   · the Chrome registry (which port is which profile / account), the tab-owner ledger and the health logs, all
//     named in mesh.local.json "liveChrome" (a build without it shows only the DevTools ports from "chromePorts")
//   · each port's DevTools /json endpoints (up / frozen / down, open tabs)
//   · one screenshot per call (Page.captureScreenshot), asked for only while a Live panel shows the Browser view;
//     nothing is kept, nothing written to disk. Read-only: it never clicks, types or navigates.
const fs = require('fs'), path = require('path'), { execFile } = require('child_process');

function createLiveChrome({ home, cfg = {}, ports = [] }) {
  const P = p => p ? String(p).replace(/^~(?=\/|$)/, home) : null;
  const C = { registry: P(cfg.registry), ledger: P(cfg.ledger), loginLog: P(cfg.loginLog), portLog: P(cfg.portLog),
    personal: (() => { try { return new RegExp(cfg.personal || '^$', 'i'); } catch { return /^$/; } })(),
    infra: (() => { try { return new RegExp(cfg.infraOwners || '^(script:)', 'i'); } catch { return /^script:/; } })(),
    loginKind: cfg.loginKind || 'work',
    loginSites: (() => { try { return new RegExp(cfg.loginSites || '.', 'i'); } catch { return /./; } })() };
  const cache = new Map();                                    // file → { mtime, v }
  function readJson(f, pick = x => x) {
    if (!f) return null;
    try { const st = fs.statSync(f), c = cache.get(f); if (c && c.mtime === st.mtimeMs) return c.v;
      const v = pick(JSON.parse(fs.readFileSync(f, 'utf8'))); cache.set(f, { mtime: st.mtimeMs, v }); return v; } catch { return null; }
  }
  function tailLines(f, n = 64 * 1024) {
    if (!f) return [];
    try { const st = fs.statSync(f), len = Math.min(n, st.size), b = Buffer.alloc(len), fd = fs.openSync(f, 'r');
      try { fs.readSync(fd, b, 0, len, st.size - len); } finally { fs.closeSync(fd); } return b.toString('utf8').split('\n'); } catch { return []; }
  }
  // kinds: [{ kind, port, label, account, udd, profile }] from the registry, else the configured DevTools ports
  function kinds() {
    const r = readJson(C.registry);
    if (r && r.kinds) return Object.entries(r.kinds).map(([kind, k]) => ({ kind, port: +k.port, label: k.label || `${k.port} · ${kind}`, account: k.account || '', udd: P(k.user_data_dir), profile: k.profile || 'Default' }));
    return [...new Set(ports.map(p => +p.port).filter(Boolean))].map(port => ({ kind: String(port), port, label: String(port), account: '', udd: null, profile: 'Default' }));
  }
  // who the profile is signed in as: the Chrome sign-in, else the first Google web account
  function accountOf(k) {
    if (!k.udd) return { chrome: '', web: [] };
    const ls = readJson(path.join(k.udd, 'Local State'), j => ((j.profile || {}).info_cache || {}));
    const chrome = ((ls || {})[k.profile] || {}).user_name || '';
    const web = readJson(path.join(k.udd, k.profile, 'Preferences'), j => (j.account_info || []).map(a => a.email).filter(Boolean)) || [];
    return { chrome, web };
  }
  const short = a => String(a || '').replace(/@.*$/, '');
  const ledger = () => readJson(C.ledger) || {};
  async function getJson(port, p, ms = 1500) {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { signal: AbortSignal.timeout(ms) }); return r.json();
  }
  const psList = () => new Promise(res => execFile('/bin/ps', ['-axo', 'command='], { maxBuffer: 8e6 }, (e, o) => res(e ? '' : o)));
  async function pages(port) {
    try { return (await getJson(port, '/json/list')).filter(t => t.type === 'page'); } catch { return null; }
  }
  // everything the tab picker needs, both ports: port badge, account, owner (ledger), short URL
  async function tabs() {
    const L = ledger(), out = [];
    for (const k of kinds()) {
      const list = await pages(k.port); if (!list) continue;
      const acc = accountOf(k);
      for (const t of list) out.push({ id: t.id, port: k.port, kind: k.kind, label: k.label, account: short(acc.chrome || acc.web[0] || ''),
        owner: (L[t.id] || {}).owner || '', title: String(t.title || '').slice(0, 90), url: shortUrl(t.url) });
    }
    return out;
  }
  function shortUrl(u) {
    u = String(u || ''); if (/^(about|chrome):/.test(u)) return u.slice(0, 60);
    try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname).replace(/\/$/, '').slice(0, 70); } catch { return u.slice(0, 70); }
  }
  // the strip on top of the Browser view
  async function status() {
    const now = new Date(), localDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const L = ledger(), portLines = tailLines(C.portLog, 256 * 1024).filter(l => l.startsWith(localDay));
    const login = {}, loginLines = tailLines(C.loginLog);
    let lastCheck = null;
    for (const l of loginLines) {
      // "<time> <site>: signed in" lines of the login checker (one per site it watches, e.g. "mail: signed in")
      const m = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) ([a-z][\w.-]*(?::[A-Za-z]{2,3})?): +(.*)$/.exec(l);
      if (m && C.loginSites.test(m[2])) { login[m[2]] = { ok: /signed in/i.test(m[3]) && !/not signed|signed out/i.test(m[3]), text: m[3].slice(0, 60), at: m[1] }; }
      const t = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) pending=/.exec(l); if (t) lastCheck = t[1];
    }
    const ps = await psList(), out = [];
    for (const k of kinds()) {
      let state = 'down', list = null;
      try { await getJson(k.port, '/json/version', 1500); list = await pages(k.port); state = list ? 'up' : 'frozen'; }
      catch { state = new RegExp(`remote-debugging-port=${k.port}\\b`).test(ps) ? 'frozen' : 'down'; }
      const owners = {}, misplaced = new Set();
      for (const t of list || []) { const o = (L[t.id] || {}).owner || 'untagged'; owners[o] = (owners[o] || 0) + 1;
        // a session's tab on the other kind's Chrome (a personal project's tab on work, or the reverse); helper owners aside
        if (o !== 'untagged' && !C.infra.test(o) && (k.kind === 'work' || k.kind === 'personal') && C.personal.test(o) !== (k.kind === 'personal')) misplaced.add(o); }
      const acc = accountOf(k), want = short(k.account), have = short(acc.chrome || acc.web[0] || '');
      out.push({ kind: k.kind, port: k.port, label: k.label, state, tabs: list ? list.length : 0, owners, misplaced: [...misplaced],
        restarts: portLines.filter(l => new RegExp(`\\blaunch ${k.kind}\\b`).test(l)).length,
        account: have, chromeSignedIn: !!acc.chrome, wantAccount: want, accountOk: !want || (have === want && (acc.web.length ? acc.web.every(a => short(a) === want) : true)),
        webAccounts: acc.web.map(short),
        login: k.kind === C.loginKind ? { google: { ok: !!acc.chrome && short(acc.chrome) === want, text: acc.chrome ? 'Chrome: ' + short(acc.chrome) : 'web only' }, ...login }
          : { google: { ok: !!(acc.chrome || acc.web.length), text: acc.chrome ? 'Chrome: ' + short(acc.chrome) : acc.web.length ? 'web: ' + acc.web.map(short).join(', ') : 'signed out' } } });
    }
    return { at: Date.now(), lastCheck, chromes: out };
  }
  // which Chrome a session should use (personal projects → the personal kind, everything else → work)
  function expectFor(name, cwd) {
    const ks = kinds(), personal = ks.find(k => k.kind === 'personal'), work = ks.find(k => k.kind === 'work');
    if (!personal || !work) return null;
    const k = C.personal.test(name || '') || C.personal.test(path.basename(cwd || '')) ? personal : work;
    return { kind: k.kind, port: k.port, label: k.label };
  }
  function kindOfPort(port) { const k = kinds().find(x => x.port === +port); return k ? { kind: k.kind, port: k.port, label: k.label } : null; }
  // one screenshot of a tab (≤ 1100 px wide JPEG) + whether the page shows something private
  const SENSITIVE_URL = /mail\.google|chat\.google|password|passwords|\/security|api[-_]?keys?|credentials|tokens?\b|secret|console\.(cloud|anthropic)|platform\.openai|\/settings\/(keys|tokens)|accounts\.google/i;
  async function shot(port, targetId) {
    port = +port; const list = await pages(port);
    if (!list) return { err: `No Chrome is answering on port ${port}.` };
    const t = list.find(x => x.id === targetId) || list.find(x => !/^(chrome|devtools|about):/.test(x.url)) || list[0];
    if (!t || !t.webSocketDebuggerUrl) return { err: 'No tab to show.' };
    return new Promise(res => {
      let id = 0, done = false, vp = null, sens = SENSITIVE_URL.test(t.url);
      const ws = new WebSocket(t.webSocketDebuggerUrl);
      const finish = v => { if (done) return; done = true; clearTimeout(to); try { ws.close(); } catch { } res({ targetId: t.id, port, url: shortUrl(t.url), title: t.title, sensitive: sens, ...v }); };
      const to = setTimeout(() => finish({ err: 'The tab did not answer (it may be frozen).' }), 5000);
      const call = (method, params = {}) => { ws.send(JSON.stringify({ id: ++id, method, params })); return id; };
      let mId = 0, sId = 0, cId = 0;
      ws.onopen = () => {
        mId = call('Page.getLayoutMetrics');
        cId = call('Runtime.evaluate', { returnByValue: true, expression: "(()=>{try{if(document.querySelector('input[type=password]'))return true;const t=(document.body&&document.body.innerText||'').slice(0,20000);return /\\b(api[ _-]?key|secret key|access token|auth token|password|private key|client secret)\\b/i.test(t)||/\\b(sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,})/.test(t)}catch(e){return false}})()" });
      };
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.id === cId && m.result && m.result.result && m.result.result.value === true) sens = true;
        if (m.id === mId) {
          const v = m.result && (m.result.cssVisualViewport || m.result.visualViewport || m.result.layoutViewport);
          vp = v && v.clientWidth ? { w: v.clientWidth, h: v.clientHeight } : null;
          const sc = vp ? Math.min(1, 1100 / vp.w) : 1;
          sId = call('Page.captureScreenshot', { format: 'jpeg', quality: 60, optimizeForSpeed: true, ...(vp ? { clip: { x: 0, y: 0, width: vp.w, height: vp.h, scale: sc } } : {}) });
        } else if (m.id === sId) finish(m.result && m.result.data ? { data: m.result.data, w: vp && vp.w, h: vp && vp.h } : { err: 'Chrome sent no picture.' });
      };
      ws.onerror = () => finish({ err: 'Could not attach to the tab.' });
    });
  }
  return { status, tabs, shot, expectFor, kindOfPort };
}
module.exports = { createLiveChrome };
