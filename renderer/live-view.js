// Live view (2026-11-25), shared by the Mac Live panel (live-panels.js) and the iPhone page (phone.js): one layout.
//   header   session · status · model · context used vs cap · current tool / step · time since last activity · Chrome
//   Browser  Chrome strip (each logged-in Chrome: up / frozen / down, last health check, restarts today, tabs per owner, logins),
//            wrong port / account warnings, a tab picker grouped by port then owner, and the tab's picture (one
//            screenshot every 3 s at most, only while on screen; blurred by default on Gmail / Chat / pages with keys)
//   Document the Sheet / Slides / Doc it writes to (when the host can preview it)
//   Code     the real commands (Claude Code's shell wrapper stripped), live output, processes with run time and CPU
//   Calls    one line per call (time · tool · summary), tap to expand, errors in red, "errors only", repeats folded
//   Window   (Mac only) the desktop app an MCP drives
// Pure UI: no Claude calls; data comes from the host's files and DevTools (live-job.js, live-chrome.js).
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const two = n => String(n).padStart(2, '0');
  const hms = t => { const d = new Date(t); return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`; };
  const dur = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${two(s % 60)}s` : `${Math.floor(s / 3600)}h ${two(Math.floor(s / 60) % 60)}m`; };
  const ago = sec => sec == null ? '' : sec < 60 ? `${Math.round(sec)}s ago` : sec < 3600 ? `${Math.round(sec / 60)}m ago` : sec < 86400 ? `${Math.round(sec / 3600)}h ago` : `${Math.round(sec / 86400)}d ago`;
  const kTok = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : Math.round((n || 0) / 1e3) + 'k';
  const model = m => String(m || '').replace(/^claude-/, '').replace(/-(\d+)-(\d+)(?:-\d{8})?$/, ' $1.$2').replace(/-(\d+)$/, ' $1').replace(/^\w/, c => c.toUpperCase()) || '—';
  const tool = n => String(n || '').replace(/^mcp__claude_ai_/, '').replace(/^mcp__/, '').replace(/__/g, ' · ');
  const VIEWS = [['browser', 'Browser'], ['doc', 'Document'], ['code', 'Code'], ['calls', 'Calls'], ['window', 'Window']];
  const badge = k => k ? `<span class="lv-port k-${esc(k.kind)}">${esc(k.label)}</span>` : '';

  function header(job, s) {
    const h = (job && job.head) || {}, name = h.name || (s && s.name) || 'No session', health = h.health || (s && s.health) || 'idle';
    const run = job && job.running && job.running.length ? job.running[job.running.length - 1] : null, last = job && job.recent && job.recent[0];
    const step = run ? `<b>${esc(tool(run.name))}</b> ${esc(run.sum || run.cmd || run.file || '')} · ${dur(Date.now() - run.t)}`
      : last ? `last: <b>${esc(tool(last.name))}</b> ${esc(last.sum || '')}` : (s ? 'no tool calls yet' : 'select a session');
    const pct = h.cap ? Math.min(100, 100 * (h.ctx || 0) / h.cap) : 0;
    const port = h.uses || h.expect;
    const av = s && window.meshAvatars ? window.meshAvatars.html(s, { cls: 'lv-av' }) : '';   // the session's picture (renderer/avatars.js) or its initial
    return `<div class="lv-h1">${av}<span class="lv-dot h-${esc(health)}"></span><b class="lv-name">${esc(name)}</b><span class="lv-st">${esc(health)}</span>
        ${h.model ? `<span class="lv-model">${esc(model(h.model))}</span>` : ''}${port ? badge(port) : ''}</div>
      <div class="lv-h2">${h.cap ? `<span class="lv-ctx${pct > 90 ? ' hot' : pct > 75 ? ' warm' : ''}" title="context used / refresh cap"><i style="width:${pct.toFixed(1)}%"></i><em>${kTok(h.ctx)} / ${kTok(h.cap)}</em></span>` : ''}<span class="lv-step">${step}</span><span class="lv-ago" title="since its last activity">${esc(ago(h.sinceUse))}</span></div>`;
  }
  function available(job, opt) {
    const v = new Set(['code', 'calls']);
    if (opt.chrome) v.add('browser');                     // the Chrome strip is useful for every session
    if (job && job.doc && opt.doc) v.add('doc');
    if (opt.window && job && (job.focus === 'window' || (job.recent || []).some(c => /^mcp__blender/.test(c.name)))) v.add('window');
    return v;
  }
  function views(job, P, opt) { const av = available(job, opt); return VIEWS.filter(([v]) => av.has(v)).map(([v, l]) => `<button data-v="${v}" class="${P.view === v ? 'on' : ''}">${l}</button>`).join(''); }

  // ---------- Browser ----------
  function strip(st) {
    if (!st || !st.chromes || !st.chromes.length) return '<div class="lv-strip"><div class="lv-dim">No Chrome registry on this Mac.</div></div>';
    const L = (k, x) => !x ? '' : `<span class="lv-lg ${x.ok ? 'ok' : 'bad'}" title="${esc(x.text || '')}${x.at ? ' · ' + esc(x.at.slice(11, 16)) : ''}">${k}</span>`;
    return `<div class="lv-strip">${st.chromes.map(c => `<div class="lv-chrome">
        <div class="lv-c1">${badge(c)}<span class="lv-state s-${c.state}">${c.state}</span><span class="lv-acc${c.accountOk ? '' : ' bad'}">${esc(c.account || 'no account')}${c.chromeSignedIn ? '' : ' (web)'}</span>
          <span class="lv-sp"></span><span class="lv-dim">${c.restarts} restart${c.restarts === 1 ? '' : 's'} today</span></div>
        <div class="lv-c2">${Object.entries(c.login || {}).map(([k, x]) => L(k === 'google' ? 'Google' : k.replace(/^([a-z]+):/, (_, a) => a.toUpperCase() + ' ').replace(/^[a-z]/, c => c.toUpperCase()), x)).join('')}</div>
        <div class="lv-c3">${Object.entries(c.owners || {}).sort((a, b) => b[1] - a[1]).map(([o, n]) => `<span class="lv-own${o === 'untagged' ? ' un' : ''}">${esc(o)} ${n}</span>`).join('') || '<span class="lv-dim">no tabs</span>'}</div>
      </div>`).join('')}<div class="lv-dim lv-chk">last health check ${st.lastCheck ? esc(st.lastCheck.slice(11, 16)) : '—'}</div></div>`;
  }
  function warnings(job, st) {
    const w = [], h = (job && job.head) || {};
    if (h.uses && h.expect && h.uses.kind !== h.expect.kind) w.push(`${esc(h.name)} drives ${esc(h.uses.label)}, but its Chrome is ${esc(h.expect.label)}.`);
    for (const c of (st && st.chromes) || []) {
      if (!c.accountOk && c.wantAccount) w.push(`${esc(c.label)} is signed in as ${esc(c.webAccounts.length ? c.webAccounts.join(', ') : c.account || 'nobody')}; it should be ${esc(c.wantAccount)} only.`);
      if (c.state !== 'up') w.push(`${esc(c.label)} is ${c.state}.`);
      for (const o of c.misplaced || []) w.push(`${esc(o)} has a tab on ${esc(c.label)}, the wrong Chrome for it.`);
    }
    return w.length ? `<div class="lv-warn">${w.map(x => `<div>⚠ ${x}</div>`).join('')}</div>` : '';
  }
  function picker(tabs, sel, open) {
    const cur = (tabs || []).find(t => t.id === sel) || null;
    const head = cur ? `${badge(cur)}<span class="lv-tacc">${esc(cur.account)}</span><span class="lv-town">${esc(cur.owner || 'untagged')}</span><span class="lv-turl">${esc(cur.url)}</span>` : '<span class="lv-dim">pick a tab</span>';
    let list = '';
    if (open) {
      const byPort = new Map(); for (const t of tabs || []) { if (!byPort.has(t.label)) byPort.set(t.label, { t, own: new Map() }); const g = byPort.get(t.label).own, o = t.owner || 'untagged'; if (!g.has(o)) g.set(o, []); g.get(o).push(t); }
      list = `<div class="lv-tlist">${[...byPort.values()].map(({ t, own }) => `<div class="lv-tg">${badge(t)}<span class="lv-tacc">${esc(t.account)}</span></div>${[...own.entries()].map(([o, l]) =>
        `<div class="lv-to">${esc(o)}</div>${l.map(x => `<button class="lv-ti${x.id === sel ? ' on' : ''}" data-tab="${esc(x.id)}" data-port="${x.port}">${badge(x)}<span class="lv-tacc">${esc(x.account)}</span><span class="lv-town">${esc(x.owner || 'untagged')}</span><span class="lv-turl">${esc(x.url)}</span></button>`).join('')}`).join('')}`).join('') || '<div class="lv-dim">No tabs.</div>'}</div>`;
    }
    return `<div class="lv-bbar"><button class="lv-tsel">${head}<span class="lv-car">▾</span></button><button class="lv-blur" title="Blur the picture">◐</button></div>${list}`;
  }

  // ---------- Code / Calls ----------
  function code(job) {
    const p = [];
    for (const r of job.running) p.push(`<div class="lv-sec"><div class="lv-hh">Running · ${esc(tool(r.name))}${r.bg ? ' (background)' : ''} · ${dur(Date.now() - r.t)}</div>${r.cmd ? `<pre class="lv-cmd">${esc(r.cmd)}</pre>` : r.file ? `<div class="lv-file">${esc(r.file)}</div>` : ''}</div>`);
    for (const o of job.outputs) p.push(`<div class="lv-sec"><div class="lv-hh">Output · ${esc(o.label)} <span class="lv-dim">updated ${dur(Date.now() - o.mtime)} ago</span></div><pre class="lv-out">${esc(o.text.slice(-5000))}</pre></div>`);
    if (job.procs && job.procs.length) p.push(`<div class="lv-sec"><div class="lv-hh">Processes</div><table class="lv-procs"><tr><th>command</th><th>runtime</th><th>CPU</th></tr>${job.procs.map(x => `<tr><td style="padding-left:${x.depth * 10 + 4}px">${esc(x.cmd)}</td><td class="lv-dim">${esc(x.etime)}</td><td class="${x.cpu > 50 ? 'lv-hot' : ''}">${x.cpu.toFixed(0)}%</td></tr>`).join('')}</table></div>`);
    if (job.script) p.push(`<div class="lv-sec"><div class="lv-hh">Script · ${esc(job.script.path)}</div><pre class="lv-src">${esc(job.script.text).split('\n').map((l, i) => `<i>${i + 1}</i>${l}`).join('\n')}</pre></div>`);
    if (job.edit) p.push(`<div class="lv-sec"><div class="lv-hh">Last edit · ${esc(job.edit.file)} · ${hms(job.edit.t)}</div><pre class="lv-src">${esc(editText(job.edit.text))}</pre></div>`);
    return p.join('') || '<div class="lv-empty">Nothing running right now. The last calls are under Calls.</div>';
  }
  function editText(t) { try { const j = JSON.parse(t); return j.new_string || j.content || j.new_source || t; } catch { return t; } }
  function calls(job, P) {
    const rows = [], firstErr = new Map();
    for (const c of job.recent) {
      if (c.state === 'error') { const k = c.name + '|' + String(c.result || '').slice(0, 300); const f = firstErr.get(k); if (f) { f.n++; continue; } const r = { c, n: 1 }; firstErr.set(k, r); rows.push(r); }
      else if (!P.errOnly) rows.push({ c, n: 1 });
    }
    const nErr = job.recent.filter(c => c.state === 'error').length;
    return `<div class="lv-cbar"><label><input type="checkbox" class="lv-erronly"${P.errOnly ? ' checked' : ''}> errors only</label><span class="lv-dim">${job.recent.length} calls · ${nErr} error${nErr === 1 ? '' : 's'}</span></div>
      <div class="lv-calls">${rows.map(({ c, n }) => { const op = P.openCalls.has(c.id);
        return `<div class="lv-call ${c.state}${op ? ' open' : ''}" data-call="${esc(c.id)}"><div class="lv-cl"><span class="lv-dim">${hms(c.t)}</span><b>${esc(tool(c.name))}</b><span class="lv-sum">${esc(c.sum || '')}</span>${c.state === 'running' ? '<span class="lv-run">running</span>' : ''}${n > 1 ? `<span class="lv-cnt">×${n}</span>` : ''}</div>${op ? `<div class="lv-cx">${c.cmd ? `<pre class="lv-cmd">${esc(c.cmd)}</pre>` : c.file ? `<div class="lv-file">${esc(c.file)}</div>` : c.input ? `<pre class="lv-cmd">${esc(c.input)}</pre>` : ''}${c.result ? `<pre class="lv-res">${esc(c.result)}</pre>` : ''}${c.done ? `<div class="lv-dim">took ${dur(c.done - c.t)}</div>` : ''}</div>` : ''}</div>`; }).join('') || '<div class="lv-empty">No calls in the last stretch.</div>'}</div>`;
  }
  function doc(job, d) {
    if (!d) return `<div class="lv-wait">Reading ${esc(job.doc.kind)}…</div>`;
    return `<div class="lv-dh"><b>${esc(d.title || 'Document')}</b>${d.range ? `<span>${esc(d.range)}</span>` : ''}<a href="${esc(d.url || job.doc.url)}" target="_blank">Open ↗</a><button class="lv-dref" title="Read it again">↻</button></div>`
      + (d.kind === 'sheet' ? `<div class="lv-grid"><table>${(d.rows || []).map((r, i) => `<tr><th>${i + 1}</th>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>`
        : d.kind === 'slides' ? `<div class="lv-thumbs">${(d.thumbs || []).map(t => `<figure>${t.src ? `<img src="${t.src}" alt="">` : '<div class="lv-noimg"></div>'}<figcaption>Slide ${t.n} of ${d.count}</figcaption></figure>`).join('')}</div>`
        : d.kind === 'file' ? (d.thumb ? `<div class="lv-thumbs one"><img src="${d.thumb}" alt=""></div>` : '<div class="lv-wait">No preview for this file.</div>')
        : `<div class="lv-wait">${d.err ? esc(d.err) + '<br>' : ''}Open the document: <a href="${esc(d.url)}" target="_blank">${esc(d.url)}</a></div>`);
  }

  // ---------- controller: one Live view on an element ----------
  // api: { job(sid, opts), chrome(), tabs(), shot(port, id), doc?(d) }; hooks: { sid(), session(sid), visible(), window?: { start(P, box), stop(P) }, title?(P) }
  function create(el, api, hooks) {
    const opt = { chrome: !!api.chrome, doc: !!api.doc, window: !!hooks.window };
    el.classList.add('lv');
    el.innerHTML = `<div class="lv-head"></div><div class="lv-views"></div><div class="lv-body"></div>`;
    const P = { el, sid: null, job: null, view: null, manual: null, doc: null, docKey: '', st: null, stAt: 0, tabs: [], tabsOpen: false, sel: null, selPort: null, blur: new Map(),
      errOnly: false, openCalls: new Set(), lastHtml: '', timer: 0, shotTimer: 0, busy: false, shotBusy: false, sensitive: false };
    const $ = q => el.querySelector(q);
    el.addEventListener('click', e => {
      const v = e.target.closest('.lv-views button[data-v]'); if (v) { P.manual = v.dataset.v; setView(v.dataset.v); return; }
      if (e.target.closest('.lv-tsel')) { P.tabsOpen = !P.tabsOpen; P.lastHtml = ''; render(); if (P.tabsOpen) refreshTabs(); return; }
      const t = e.target.closest('.lv-ti'); if (t) { P.sel = t.dataset.tab; P.selPort = +t.dataset.port; P.manualTab = true; P.tabsOpen = false; P.sensitive = true; P.lastHtml = ''; P.lastTop = null; const im = $('.lv-shot img'); if (im) im.remove(); render(); if (P.shotLoop) shotNow(); else ensureShots(); return; }
      if (e.target.closest('.lv-blur')) { P.blur.set(P.sel, !blurred()); applyBlur(); return; }
      const c = e.target.closest('.lv-call .lv-cl'); if (c) { const id = c.parentElement.dataset.call; P.openCalls.has(id) ? P.openCalls.delete(id) : P.openCalls.add(id); P.lastHtml = ''; render(); return; }
      if (e.target.closest('.lv-dref')) { P.docKey = ''; tick(); }
    });
    el.addEventListener('change', e => { if (e.target.classList.contains('lv-erronly')) { P.errOnly = e.target.checked; P.lastHtml = ''; render(); } });
    const blurred = () => P.blur.has(P.sel) ? P.blur.get(P.sel) : P.sensitive;
    function applyBlur() { const img = $('.lv-shot img'); if (img) img.classList.toggle('blur', !!blurred()); const b = $('.lv-blur'); if (b) b.classList.toggle('on', !!blurred()); }
    function setView(v) { if (P.view === v) return; P.view = v; P.lastHtml = ''; if (v !== 'window' && hooks.window) hooks.window.stop(P); render(); tick(); }

    function render() {
      const s = hooks.session(P.sid), job = P.job;
      $('.lv-head').innerHTML = header(job, s);
      $('.lv-views').innerHTML = s ? views(job, P, opt) : '';
      if (hooks.title) hooks.title(P, s);
      const body = $('.lv-body');
      if (!s || !job) { if (P.lastHtml !== 'none') { body.innerHTML = `<div class="lv-empty">${s ? 'Reading what it does…' : 'Select a session to watch its job here.'}</div>`; P.lastHtml = 'none'; } return; }
      if (P.view === 'browser') {
        const top = warnings(job, P.st) + strip(P.st) + picker(P.tabs, P.sel, P.tabsOpen);
        if (top !== P.lastTop || !body.querySelector('.lv-shot')) {
          const img = body.querySelector('.lv-shot img');
          body.innerHTML = `<div class="lv-browser"><div class="lv-btop">${warnings(job, P.st) + strip(P.st)}</div>${picker(P.tabs, P.sel, P.tabsOpen)}<div class="lv-shot"><div class="lv-wait">${P.st ? 'Loading the tab…' : 'Reading Chrome…'}</div></div></div>`;
          if (img) { body.querySelector('.lv-shot').innerHTML = ''; body.querySelector('.lv-shot').appendChild(img); }
          P.lastTop = top; P.lastHtml = 'browser'; applyBlur();
        }
        return;
      }
      P.lastTop = null;
      if (P.view === 'window') { if (!body.querySelector('.lv-window')) body.innerHTML = '<div class="lv-window"><div class="lv-wait">Starting…</div></div>'; P.lastHtml = 'window'; return; }
      const html = P.view === 'doc' ? doc(job, P.doc) : P.view === 'code' ? code(job) : calls(job, P);
      if (html !== P.lastHtml) {
        const outs = [...body.querySelectorAll('pre.lv-out')].map(p => p.scrollHeight - p.scrollTop - p.clientHeight < 20), sc = body.scrollTop;
        body.innerHTML = html; P.lastHtml = html; body.scrollTop = sc;
        body.querySelectorAll('pre.lv-out').forEach((p, i) => { if (outs[i] !== false) p.scrollTop = p.scrollHeight; });
      }
    }
    async function refreshChrome(force) {
      if (!api.chrome || (!force && Date.now() - P.stAt < 10e3)) return;
      P.stAt = Date.now();
      try { const [st, tabs] = await Promise.all([api.chrome(), api.tabs()]); P.st = st; P.tabs = tabs || []; } catch { }
      // default tab: one the job is on (its port, its site), else the first real page on the port it uses / should use
      if (!P.manualTab || !P.tabs.some(t => t.id === P.sel)) {
        const h = (P.job && P.job.head) || {}, port = (P.job && P.job.browser && P.job.browser.port) || (h.expect && h.expect.port);
        const hosts = (P.job && P.job.browser && P.job.browser.hosts) || [], mine = P.tabs.filter(t => !port || t.port === port);
        const t = hosts.map(x => mine.find(m => m.url.includes(x))).find(Boolean) || mine.find(m => m.owner && h.name && m.owner.toLowerCase().includes(h.name.toLowerCase().split(' ')[0])) || mine.find(m => !/^(about|chrome)/.test(m.url)) || mine[0] || P.tabs[0];
        if (t && t.id !== P.sel) { P.sel = t.id; P.selPort = t.port; P.manualTab = false; }
      }
    }
    async function refreshTabs() { try { P.tabs = await api.tabs() || []; } catch { } P.lastHtml = ''; render(); }
    // one screenshot every 3 s at most, only while the Browser view is on screen
    function ensureShots() { if (!P.shotLoop && P.view === 'browser' && hooks.visible()) { P.shotLoop = true; shotNow(); } }
    async function shotNow() {
      clearTimeout(P.shotTimer);
      if (P.view !== 'browser' || !hooks.visible() || !P.sel) { P.shotLoop = false; return; }
      if (P.shotBusy) return;
      P.shotBusy = true; const id = P.sel;
      try {
        const r = await api.shot(P.selPort, id), box = $('.lv-shot');
        if (box && id === P.sel && r) {
          if (r.data) {
            P.sensitive = !!r.sensitive;
            let img = box.querySelector('img'); if (!img) { box.innerHTML = '<img alt="">'; img = box.querySelector('img'); }
            img.src = `data:image/jpeg;base64,${r.data}`; applyBlur();
          } else if (r.err) box.innerHTML = `<div class="lv-wait">${esc(r.err)}</div>`;
        }
      } catch { } finally { P.shotBusy = false; }
      if (P.view === 'browser' && hooks.visible()) P.shotTimer = setTimeout(shotNow, 3000); else P.shotLoop = false;
    }
    async function tick() {
      clearTimeout(P.timer);
      if (!el.isConnected) return;
      const sid = hooks.sid();
      if (sid !== P.sid) { P.sid = sid; P.job = null; P.doc = null; P.docKey = ''; P.manual = null; P.view = null; P.manualTab = false; P.sel = null; P.openCalls.clear(); if (hooks.window) hooks.window.stop(P); P.lastHtml = ''; P.lastTop = null; }
      if (!hooks.visible()) { clearTimeout(P.shotTimer); P.shotLoop = false; if (hooks.window) hooks.window.stop(P); P.lastHtml = ''; P.lastTop = null; return; }   // off screen: no work at all
      if (P.busy) return;
      P.busy = true;
      try {
        if (P.sid) {
          P.job = await api.job(P.sid, { procs: P.view === 'code' || P.view == null });
          const av = available(P.job, opt), want = P.manual && av.has(P.manual) ? P.manual : (av.has(P.job && P.job.focus) ? P.job.focus : 'calls');
          if (want !== P.view) { P.view = want; P.lastHtml = ''; if (want !== 'window' && hooks.window) hooks.window.stop(P); }
          if (P.view === 'browser') await refreshChrome(!P.st);
          if (P.view === 'doc' && P.job && P.job.doc && api.doc) {
            const k = P.job.doc.id + ':' + P.job.doc.t + ':' + (P.job.doc.range || '');
            if (k !== P.docKey) { P.docKey = k; P.doc = null; render(); P.doc = await api.doc({ ...P.job.doc, text: '' }) || { kind: 'link', url: P.job.doc.url }; }
          }
        }
        render();
        if (P.view === 'browser') ensureShots();
        if (P.view === 'window' && hooks.window) hooks.window.start(P, $('.lv-window'));
      } catch { } finally { P.busy = false; }
      P.timer = setTimeout(tick, P.view === 'code' ? 2000 : P.view === 'browser' ? 5000 : 4000);
    }
    return { P, tick, stop: () => { clearTimeout(P.timer); clearTimeout(P.shotTimer); P.shotLoop = false; if (hooks.window) hooks.window.stop(P); } };
  }
  window.LiveView = { create, esc, header, strip, warnings, picker, code, calls };
})();
