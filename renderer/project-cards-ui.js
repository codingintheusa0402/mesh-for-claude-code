// Project cards on the Mac (2026-11-02; data: project-cards.js): a one-line intro + badges (waiting on you / a
// scheduled job failed) under each session in Sessions, the intro + next scheduled run when you hover a bubble, and
// the full card (What it does · Rules · Checks · To-do · Schedule · Activity) from the session menu → "Project card".
// The summary is fetched every 5 min (the main process caches it), the full card only when opened.
(function () {
  const api = window.api && window.api.cards; if (!api) return;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const two = n => String(n).padStart(2, '0');
  const when = t => { if (!t) return '—'; const d = new Date(t), now = new Date(), tm = `${two(d.getHours())}:${two(d.getMinutes())}`;
    if (d.toDateString() === now.toDateString()) return 'today ' + tm; const tmw = new Date(now.getTime() + 864e5); if (d.toDateString() === tmw.toDateString()) return 'tomorrow ' + tm;
    return `${d.getMonth() + 1}/${d.getDate()} ${tm}`; };
  window.projectCards = {};
  async function refresh() {
    if (document.visibilityState !== 'visible') return;
    try { const r = await api.summary(); if (r && JSON.stringify(r) !== JSON.stringify(window.projectCards)) { window.projectCards = r; if (typeof renderList === 'function') renderList(); } } catch { }
  }
  setTimeout(refresh, 5000); setInterval(refresh, 5 * 60e3);
  document.addEventListener('visibilitychange', refresh);

  // the Sessions row: intro line + badges (app.js srowHtml calls this)
  window.cardRowBits = s => {
    const c = window.projectCards[s.sid]; if (!c) return { badges: '', intro: '' };
    const b = (c.waitingN ? `<span class="pbadge wait" title="${c.waitingN} item(s) waiting on you — open the Project card">⚑${c.waitingN}</span>` : '')
      + (c.failedN ? `<span class="pbadge fail" title="${c.failedN} scheduled job(s) failed last run — open the Project card">✕${c.failedN}</span>` : '');
    return { badges: b, intro: c.intro ? `<div class="pintro" title="${esc(c.intro)}">${esc(c.intro)}</div>` : '' };
  };

  // the bubble tooltip: intro + next run
  const tip = document.createElement('div'); tip.id = 'ptip'; tip.className = 'hidden'; document.body.appendChild(tip);
  if (typeof Mesh !== 'undefined') {
    const move0 = Mesh.prototype.move;
    Mesh.prototype.move = function (e) {
      move0.call(this, e);
      const sid = this.hover && this.hover !== 'hub' && !String(this.hover).startsWith('grp:') ? this.hover : null, c = sid && window.projectCards[sid];
      if (!c || (!c.intro && !c.next) || this.drag || this.lite) { tip.classList.add('hidden'); return; }
      const s = (snap.sessions || []).find(x => x.sid === sid);
      tip.innerHTML = `<b>${esc(s ? s.name : '')}</b>${c.intro ? `<div>${esc(c.intro)}</div>` : ''}${c.next ? `<div class="pt-next">Next: ${esc(c.next.label.replace(/^com\./, ''))} · ${when(c.next.at)}</div>` : ''}`
        + (c.waitingN || c.failedN ? `<div class="pt-badges">${c.waitingN ? `⚑ ${c.waitingN} waiting on you` : ''}${c.waitingN && c.failedN ? ' · ' : ''}${c.failedN ? `✕ ${c.failedN} job failed` : ''}</div>` : '');
      tip.classList.remove('hidden');
      const w = tip.offsetWidth, h = tip.offsetHeight;
      tip.style.left = Math.min(innerWidth - w - 8, e.clientX + 16) + 'px'; tip.style.top = Math.min(innerHeight - h - 8, e.clientY + 18) + 'px';
    };
    document.getElementById('mesh').addEventListener('mouseleave', () => tip.classList.add('hidden'));
  }

  // the full card
  const TABS = [['what', 'What it does'], ['rules', 'Rules'], ['checks', 'Checks'], ['todo', 'To-do'], ['schedule', 'Schedule'], ['activity', 'Activity']];
  const srcLink = p => p ? (/^~\//.test(p) ? `<a class="psrc" data-open="${esc(p)}" title="Open ${esc(p)}">${esc(p.split('/').slice(-2).join('/'))}</a>` : `<span class="psrc">${esc(p)}</span>`) : '';
  function body(c, tab) {
    if (c.empty) return `<div class="pempty"><b>No project notes yet.</b><br>This project has no rule file (CLAUDE.md, PLAYBOOK.md…) and no scheduled jobs.<br><button class="primary" id="pAsk">Ask this session to write a short CLAUDE.md</button><div class="pdim">It will describe its job, rules, checks and schedule.</div></div>`;
    const list = (a, f) => a.length ? `<ul class="plist">${a.map(f).join('')}</ul>` : `<div class="pdim">${c.generating ? 'Reading the project…' : c.genFailed ? 'Couldn\'t read the project this time. Use refresh to try again.' : 'Nothing found.'}</div>`;
    if (tab === 'what') return `<p class="pintro-big">${esc(c.intro || (c.generating ? 'Reading the project…' : c.genFailed ? 'Couldn\'t read the project this time. Use refresh to try again.' : '—'))}</p><div class="pdim">Folders: ${c.folders.map(esc).join(', ')}</div>`
      + (c.ruleFiles.length ? `<div class="pdim" style="margin-top:6px">Rule files: ${c.ruleFiles.map(srcLink).join(' · ')}</div>` : '');
    if (tab === 'rules') return list(c.rules, r => `<li>${esc(r.text)} ${srcLink(r.src)}</li>`) + (c.ruleFiles.length ? `<div class="pdim">Full files: ${c.ruleFiles.map(srcLink).join(' · ')}</div>` : '');
    if (tab === 'checks') { const e = c.checks.filter(x => x.enforced), w = c.checks.filter(x => !x.enforced);
      return `<h4>Enforced in code <span class="pdim">(a script blocks the run)</span></h4>${list(e, r => `<li>${esc(r.text)} ${srcLink(r.src)}</li>`)}<h4>Written only</h4>${list(w, r => `<li>${esc(r.text)} ${srcLink(r.src)}</li>`)}`; }
    if (tab === 'todo') { const wt = c.todo.filter(x => x.waiting_on_owner), o = c.todo.filter(x => !x.waiting_on_owner);
      return `<h4>Waiting on you</h4>${list(wt, r => `<li class="pwait">${esc(r.text)} ${srcLink(r.src)}</li>`)}<h4>Open items</h4>${list(o, r => `<li>${esc(r.text)} ${srcLink(r.src)}</li>`)}`; }
    if (tab === 'schedule') return c.schedule.length ? `<table class="psched"><tr><th>Job</th><th>When</th><th>Next run</th><th>Last run</th><th>Result</th></tr>${c.schedule.map(j => `<tr class="${/^failed/.test(j.result) ? 'pfail' : ''}">
        <td>${esc(j.label.replace(/^com\./, ''))}</td><td>${esc(j.when)}</td><td>${esc(when(j.next))}</td><td>${esc(when(j.at))}</td><td title="${esc(j.line || '')}">${esc(j.result)}${j.log ? ' ' + srcLink(j.log) : ''}</td></tr>`).join('')}</table><div class="pdim">From ${[...new Set(c.schedule.map(j => j.src))].length} launchd / cron entries; next runs computed from each job's schedule, results from launchd and the job's log.</div>`
      : '<div class="pdim">No launchd job or cron entry runs anything in this project\'s folders.</div>';
    return list(c.activity, a => `<li><span class="pdim">${esc(when(Date.parse(a.time)))}</span> ${esc(a.text)} ${srcLink(a.src)}</li>`);
  }
  window.openProjectCard = async (sid, tab = 'what') => {
    const s = (snap.sessions || []).find(x => x.sid === sid); if (!s) return;
    const draw = (c, t) => {
      modal(`<div class="pcard"><div class="pc-h"><h3>${esc(s.name)} <span class="pdim">· Project card</span></h3>
          <span class="pdim">${c.generating ? 'updating…' : c.at ? 'updated ' + when(c.at) : ''}${c.refreshed ? ' · session refreshed ' + when(c.refreshed.at) : ' · never refreshed'}</span><button id="pRef" title="Read the project again">↻</button></div>
        ${c.empty ? '' : `<div class="pc-tabs">${TABS.map(([k, l]) => `<button data-t="${k}" class="${k === t ? 'on' : ''}">${l}${k === 'todo' && c.waitingN ? ` <span class="pbadge wait">⚑${c.waitingN}</span>` : ''}${k === 'schedule' && c.failedN ? ` <span class="pbadge fail">✕${c.failedN}</span>` : ''}</button>`).join('')}</div>`}
        <div class="pc-body">${body(c, t)}</div><div class="btns" style="justify-content:flex-end"><button id="mCancel">Close</button></div></div>`);
      $('#modalCard').classList.add('wide');
      document.querySelectorAll('.pc-tabs button').forEach(b => b.onclick = () => draw(c, b.dataset.t));
      document.querySelectorAll('.pcard [data-open]').forEach(a => a.onclick = async () => { const r = await api.open(a.dataset.open); if (r) toast(String(r)); });
      $('#pRef').onclick = async () => { toast('Reading the project again…'); draw(await api.get(sid, true), t); };
      const ask = $('#pAsk'); if (ask) ask.onclick = async () => { await api.ask(sid); toast(`Asked ${s.name} to write its CLAUDE.md`); closeModal(); };
    };
    let c = await api.get(sid, false); if (!c) return toast('No card for this session'); draw(c, tab);
    if (c.generating) { for (let i = 0; i < 40 && c.generating; i++) { await new Promise(r => setTimeout(r, 3000)); if ($('#modal').classList.contains('hidden')) return; c = await api.get(sid, false); } const on = document.querySelector('.pc-tabs button.on'); draw(c, on ? on.dataset.t : tab); refresh(); }
  };
})();
