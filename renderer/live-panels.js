// Live panel (2026-11-01): what a session's job is doing, as it happens — it follows the session you select (or the
// busiest working one), and 📌 pins a second panel to one session so several jobs can be watched side by side.
// It opens on the view that fits the newest action (live-job.js `focus`); the strip on top switches by hand:
//   Browser  — the Chrome tab the job drives, streamed from Chrome's DevTools port (live-cdp.js); read-only
//   Document — the Google Sheet / Slides / Doc it writes to (team add-on; the public build shows the link)
//   Code     — the commands running now, live output of background commands, the processes it started, the
//              script being run, the last file it edited
//   Calls    — its recent tool calls, results included
//   Window   — the desktop app an MCP drives (Blender …), via screen capture (macOS Screen Recording permission)
// Light on CPU/GPU: nothing polls while no Live panel is on screen (one cheap check every 15 s decides whether to pop
// it up); the Code view refreshes every 2 s, the others every 5 s; the browser view gets frames only when the page
// repaints (≤ 6/s) and stops the moment the panel is hidden; the document preview is fetched only when the job
// writes to it again.
(function () {
  const D = window.meshDock, api = window.api && window.api.live; if (!D || !api) return;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const two = n => String(n).padStart(2, '0');
  const hms = t => { const d = new Date(t); return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`; };
  const dur = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${two(s % 60)}s` : `${Math.floor(s / 3600)}h ${two(Math.floor(s / 60) % 60)}m`; };
  const VIEWS = [['browser', 'Browser'], ['doc', 'Document'], ['code', 'Code'], ['calls', 'Calls'], ['window', 'Window']];
  const panels = new Map();        // panel id → state
  const frames = new Map();        // watch key → panel state (browser frames route here)
  const sessions = () => (typeof snap !== 'undefined' && snap.sessions) || [];
  const followSid = () => {
    const sel = typeof selected !== 'undefined' ? selected : null;
    if (sel && sessions().some(s => s.sid === sel)) return sel;
    const w = sessions().filter(s => s.health === 'working' && !s.onPeer).sort((a, b) => (b.tps || 0) - (a.tps || 0))[0];
    return w ? w.sid : null;
  };

  function make(id, pinnedSid) {
    const el = document.createElement('section'); el.className = 'live-panel';
    el.innerHTML = `<div class="lv-top"><span class="lv-dot"></span><b class="lv-name"></b><span class="lv-st"></span><span class="lv-sp"></span>
        <div class="lv-views"></div>${pinnedSid ? '' : '<button class="lv-pin" title="Pin a Live panel to this session (watch several jobs at once)">📌</button>'}</div>
      <div class="lv-body"></div>`;
    const P = { id, el, pinnedSid, sid: null, view: null, manual: null, job: null, docKey: '', doc: null, watchKey: null, timer: 0, busy: false, lastHtml: '' };
    panels.set(id, P);
    el.querySelector('.lv-views').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; P.manual = b.dataset.v; setView(P, b.dataset.v); });
    const pin = el.querySelector('.lv-pin'); if (pin) pin.onclick = () => { if (P.sid) openPinned(P.sid); };
    el.addEventListener('click', e => { const a = e.target.closest('[data-tab]'); if (a && P.watchKey && P.job && P.job.browser) { api.watch(P.watchKey, P.job.browser.port, [], a.dataset.tab); } });
    el.addEventListener('change', e => { if (e.target.classList.contains('lv-tabsel') && P.watchKey && P.job && P.job.browser) api.watch(P.watchKey, P.job.browser.port, [], e.target.value); });
    return P;
  }
  function openPinned(sid) {
    const id = 'live:' + sid, s = sessions().find(x => x.sid === sid);
    if (!panels.has(id)) { const P = make(id, sid); D.register(id, { title: 'Live · ' + (s ? s.name : 'session'), el: P.el, spot: { edge: 'right', size: .3, group: 'live' } }); }
    D.show(id); tick(panels.get(id));
  }
  const visible = P => P.el.isConnected && !P.el.classList.contains('dk-off') && P.el.offsetParent !== null && document.visibilityState === 'visible';
  function available(job) {
    const v = new Set(['code', 'calls']);
    if (job && job.browser) v.add('browser');
    if (job && job.doc) v.add('doc');
    if (job && (job.focus === 'window' || (job.recent || []).some(c => /^mcp__blender/.test(c.name)))) v.add('window');
    return v;
  }
  function setView(P, v) {
    if (P.view === v) return;
    P.view = v; P.lastHtml = '';
    if (v !== 'browser') stopBrowser(P);
    if (v !== 'window') stopWindow(P);
    render(P); tick(P);
  }

  // ---------- browser ----------
  function startBrowser(P) {
    const b = P.job && P.job.browser; if (!b) return;
    const key = P.id + ':' + P.sid + ':' + b.port; if (P.watchKey === key) return;
    stopBrowser(P); P.watchKey = key; frames.set(key, P);
    api.watch(key, b.port, b.hosts || []);
  }
  function stopBrowser(P) { if (!P.watchKey) return; api.unwatch(P.watchKey); frames.delete(P.watchKey); P.watchKey = null; }
  api.onMsg((key, m) => {
    const P = frames.get(key); if (!P || P.view !== 'browser') return;
    const box = P.el.querySelector('.lv-browser'); if (!box) return;
    if (m.frame) { const img = box.querySelector('img'); img.src = `data:${m.mime};base64,${m.frame}`; img.classList.remove('hidden'); box.querySelector('.lv-wait').classList.add('hidden'); }
    if (m.meta) {
      if (m.meta.title || m.meta.url) box.querySelector('.lv-bt').textContent = `${m.meta.title || ''}${m.meta.url ? '  ·  ' + m.meta.url : ''}`.slice(0, 200);
      if (m.meta.tabs) box.querySelector('.lv-tabsel').innerHTML = m.meta.tabs.map(t => `<option value="${esc(t.id)}"${t.id === m.meta.targetId ? ' selected' : ''}>${esc(t.title || t.url)}</option>`).join('');
    }
    if (m.err) { const w = box.querySelector('.lv-wait'); w.textContent = m.err; w.classList.remove('hidden'); }
  });

  // ---------- window (desktop app an MCP drives) ----------
  async function startWindow(P) {
    if (P.stream || P.starting) return; const mcp = window.api.mcp; if (!mcp) return;
    P.starting = true;
    try {
      const box = P.el.querySelector('.lv-window'); if (!box) return;
      const r = await mcp.sources(false);
      if (r.status !== 'granted') {
        box.innerHTML = `<div class="lv-perm">To see the app this job drives, allow screen recording for this app.<br><button class="lv-allow">Allow screen recording</button><div class="lv-howto">System Settings → Privacy &amp; Security → Screen &amp; System Audio Recording → turn on this app, then quit and reopen it.</div></div>`;
        box.querySelector('.lv-allow').onclick = async () => { await mcp.sources(true); mcp.screenSettings(); };
        return;
      }
      const src = (r.sources || []).find(s => /^Blender$/.test(s.owner)) || null;
      if (!src) { box.innerHTML = '<div class="lv-wait">The app this job drives isn\'t open on this Mac.</div>'; return; }
      if (!(await mcp.pick(src.id))) return;
      const stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: { frameRate: { ideal: 6, max: 8 }, width: { max: 1280 }, height: { max: 1280 } } });
      if (P.view !== 'window' || !visible(P)) { stream.getTracks().forEach(t => t.stop()); return; }
      P.stream = stream; box.innerHTML = '<video muted playsinline></video>'; const v = box.querySelector('video'); v.srcObject = stream; v.play().catch(() => { });
    } catch { stopWindow(P); } finally { P.starting = false; }
  }
  function stopWindow(P) { if (P.stream) { P.stream.getTracks().forEach(t => t.stop()); P.stream = null; } }

  // ---------- render ----------
  function render(P) {
    const s = sessions().find(x => x.sid === P.sid), job = P.job;
    P.el.querySelector('.lv-name').textContent = s ? s.name : 'No session';
    P.el.querySelector('.lv-dot').className = 'lv-dot h-' + (s ? s.health : 'idle');
    const run = job && job.running && job.running.length ? job.running[job.running.length - 1] : null;
    P.el.querySelector('.lv-st').textContent = !s ? 'select a session' : run ? `running ${run.name}${run.cmd ? ': ' + run.cmd.split('\n')[0].slice(0, 60) : ''} · ${dur(Date.now() - run.t)}` : s.health;
    const av = available(job);
    P.el.querySelector('.lv-views').innerHTML = VIEWS.filter(([v]) => av.has(v)).map(([v, l]) => `<button data-v="${v}" class="${P.view === v ? 'on' : ''}">${l}</button>`).join('');
    const body = P.el.querySelector('.lv-body');
    if (!s || !job) { if (P.lastHtml !== 'none') { body.innerHTML = `<div class="lv-empty">${s ? 'Reading what it does…' : 'Select a session (Sessions or the mesh) to watch its job here.'}</div>`; P.lastHtml = 'none'; } return; }
    let html;
    if (P.view === 'browser') {
      if (!body.querySelector('.lv-browser')) body.innerHTML = `<div class="lv-browser"><div class="lv-bh"><select class="lv-tabsel" title="Chrome tab"></select><span class="lv-bt"></span></div><div class="lv-wait">Connecting to Chrome (port ${job.browser.port})…</div><img class="hidden" alt=""></div>`;
      P.lastHtml = 'browser'; return;
    }
    if (P.view === 'window') { if (!body.querySelector('.lv-window')) body.innerHTML = '<div class="lv-window"><div class="lv-wait">Starting…</div></div>'; P.lastHtml = 'window'; return; }
    if (P.view === 'doc') {
      const d = P.doc;
      html = !d ? `<div class="lv-wait">Reading ${esc(job.doc.kind)}…</div>`
        : `<div class="lv-dh"><b>${esc(d.title || 'Document')}</b>${d.range ? `<span>${esc(d.range)}</span>` : ''}<a href="${esc(d.url || job.doc.url)}" target="_blank">Open ↗</a><button class="lv-dref" title="Read it again">↻</button></div>`
          + (d.kind === 'sheet' ? `<div class="lv-grid"><table>${(d.rows || []).map((r, i) => `<tr><th>${i + 1}</th>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>`
            : d.kind === 'slides' ? `<div class="lv-thumbs">${(d.thumbs || []).map(t => `<figure>${t.src ? `<img src="${t.src}" alt="">` : '<div class="lv-noimg"></div>'}<figcaption>Slide ${t.n} of ${d.count}</figcaption></figure>`).join('')}</div>`
            : d.kind === 'file' ? (d.thumb ? `<div class="lv-thumbs one"><img src="${d.thumb}" alt=""></div>` : '<div class="lv-wait">No preview for this file.</div>')
            : `<div class="lv-wait">${d.err ? esc(d.err) + '<br>' : ''}Open the document to see it: <a href="${esc(d.url)}" target="_blank">${esc(d.url)}</a></div>`);
    } else if (P.view === 'code') {
      const parts = [];
      for (const r of job.running) parts.push(`<div class="lv-sec"><div class="lv-h">Running · ${esc(r.name)}${r.bg ? ' (background)' : ''} · ${dur(Date.now() - r.t)}</div>${r.cmd ? `<pre class="lv-cmd">${esc(r.cmd)}</pre>` : r.file ? `<div class="lv-file">${esc(r.file)}</div>` : ''}</div>`);
      for (const o of job.outputs) parts.push(`<div class="lv-sec"><div class="lv-h">Output · ${esc(o.label)} <span class="lv-dim">${esc(o.file)} · updated ${dur(Date.now() - o.mtime)} ago</span></div><pre class="lv-out">${esc(o.text.slice(-5000))}</pre></div>`);
      if (job.procs.length) parts.push(`<div class="lv-sec"><div class="lv-h">Processes it started</div><table class="lv-procs">${job.procs.map(p => `<tr><td class="lv-dim">${p.pid}</td><td>${p.cpu.toFixed(0)}%</td><td class="lv-dim">${esc(p.etime)}</td><td style="padding-left:${p.depth * 10}px">${esc(p.cmd)}</td></tr>`).join('')}</table></div>`);
      if (job.script) parts.push(`<div class="lv-sec"><div class="lv-h">Script being run · ${esc(job.script.path)}</div><pre class="lv-src">${esc(job.script.text).split('\n').map((l, i) => `<i>${i + 1}</i>${l}`).join('\n')}</pre></div>`);
      if (job.edit) parts.push(`<div class="lv-sec"><div class="lv-h">Last file edit · ${esc(job.edit.file)} · ${hms(job.edit.t)}</div><pre class="lv-src">${esc(editText(job.edit.text))}</pre></div>`);
      html = parts.join('') || '<div class="lv-empty">Nothing running right now. The last calls are under Calls.</div>';
    } else {
      html = `<div class="lv-calls">${job.recent.map(c => `<div class="lv-call ${c.state}"><div><span class="lv-dim">${hms(c.t)}</span> <b>${esc(c.name.replace(/^mcp__/, 'MCP · ').replace(/__/g, ' · '))}</b>${c.state === 'running' ? ' <span class="lv-run">running…</span>' : c.state === 'error' ? ' <span class="lv-err">error</span>' : ''}</div>${c.cmd ? `<pre class="lv-cmd">${esc(c.cmd)}</pre>` : c.file ? `<div class="lv-file">${esc(c.file)}</div>` : ''}${c.result ? `<div class="lv-res">${esc(c.result)}</div>` : ''}</div>`).join('')}</div>`;
    }
    if (html !== P.lastHtml) {
      const outs = [...body.querySelectorAll('pre.lv-out')].map(p => p.scrollHeight - p.scrollTop - p.clientHeight < 20);   // keep live output pinned to its end
      body.innerHTML = html; P.lastHtml = html;
      body.querySelectorAll('pre.lv-out').forEach((p, i) => { if (outs[i] !== false) p.scrollTop = p.scrollHeight; });
      const r = body.querySelector('.lv-dref'); if (r) r.onclick = () => { P.docKey = ''; tick(P); };
    }
  }
  function editText(t) { try { const j = JSON.parse(t); return j.new_string || j.content || j.new_source || t; } catch { return t; } }

  // ---------- refresh ----------
  async function tick(P) {
    clearTimeout(P.timer);
    if (!P.el.isConnected) return;
    const sid = P.pinnedSid || followSid();
    if (sid !== P.sid) { P.sid = sid; P.job = null; P.doc = null; P.docKey = ''; P.manual = null; P.view = null; stopBrowser(P); stopWindow(P); P.lastHtml = ''; }
    if (!visible(P) || P.busy) { stopBrowser(P); stopWindow(P); return; }   // hidden: no work at all (onChange / selection brings it back)
    P.busy = true;
    try {
      if (P.sid) {
        P.job = await api.job(P.sid, { procs: P.view === 'code' || P.view == null });
        const av = available(P.job), want = P.manual && av.has(P.manual) ? P.manual : (av.has(P.job && P.job.focus) ? P.job.focus : 'code');
        if (want !== P.view) { P.view = want; P.lastHtml = ''; if (want !== 'browser') stopBrowser(P); if (want !== 'window') stopWindow(P); }
        if (P.view === 'doc' && P.job.doc) {
          const k = P.job.doc.id + ':' + P.job.doc.t + ':' + (P.job.doc.range || '');
          if (k !== P.docKey) { P.docKey = k; P.doc = null; render(P); P.doc = await api.doc({ ...P.job.doc, text: '' }) || { kind: 'link', url: P.job.doc.url }; }
        }
      }
      render(P);
      if (P.view === 'browser') startBrowser(P);
      if (P.view === 'window') startWindow(P);
    } catch { } finally { P.busy = false; }
    P.timer = setTimeout(() => tick(P), P.view === 'code' ? 2000 : 5000);
  }

  // the main Live panel follows your selection; it pops up by itself when a job starts doing visible work
  const main = make('live', null);
  D.autoHide('live', true);
  D.register('live', { title: 'Live', el: main.el, spot: { edge: 'right', size: .32, group: 'live' } });
  let lastSel = null;
  setInterval(() => { const s = typeof selected !== 'undefined' ? selected : null; if (s !== lastSel) { lastSel = s; for (const [, P] of panels) if (!P.pinnedSid) tick(P); } }, 700);   // a cheap compare
  async function watchForWork() {
    if (document.visibilityState === 'visible' && !D.isShown('live')) {
      const sid = followSid(), s = sid && sessions().find(x => x.sid === sid);
      if (s && s.health === 'working') { const j = await api.job(sid, {}); if (j && ['browser', 'doc', 'window'].includes(j.focus)) D.autoHide('live', false); }
    }
    setTimeout(watchForWork, 15000);
  }
  setTimeout(watchForWork, 4000);
  D.onChange(() => { for (const [, P] of panels) { clearTimeout(P.timer); P.timer = setTimeout(() => tick(P), 250); } });
  document.addEventListener('visibilitychange', () => { for (const [, P] of panels) tick(P); });
  window.liveWatch = sid => openPinned(sid);     // for a "Watch live" command elsewhere
})();
