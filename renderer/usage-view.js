// The token usage dashboard (usage-core.js holds the numbers), drawn the same on the Mac and the phone with plain HTML.
// window.usageView.open(host): host = { box(html, wide), get(), session(list), setManual(pct), close() }.
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = n => { n = +n || 0; const a = Math.abs(n); return a >= 1e9 ? (n / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B' : a >= 1e6 ? (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M' : a >= 1e3 ? Math.round(n / 1e3) + 'K' : String(Math.round(n)); };
  const SLOT = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#e66767'], OTHER = '#6d6d76';   // validated on black, in this order
  const MODEL = { fable: 'Fable', mythos: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', other: 'Ollama and other' };
  const famColor = f => (window.FAMILY_COLOR && window.FAMILY_COLOR[f]) || OTHER;
  const barColor = s => (s.color && window.ORB_PAL && window.ORB_PAL[s.color] ? window.ORB_PAL[s.color].rim : famColor(s.family));
  const two = n => String(n).padStart(2, '0');
  const date = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const stamp = t => { const d = new Date(t), now = new Date(), hm = `${two(d.getHours())}:${two(d.getMinutes())}`; return d.toDateString() === now.toDateString() ? 'today ' + hm : `${date(t)} ${hm}`; };
  const whenFull = t => new Date(t).toLocaleString('en', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  function change(c) {
    if (!c.prev) return `<span class="uc-d">No data for ${esc(c.vs)}</span>`;
    const p = Math.round((c.tok - c.prev) / c.prev * 100);
    return `<span class="uc-d">${p === 0 ? 'Same as' : `${p > 0 ? '▲' : '▼'} ${Math.abs(p)}% vs`} ${esc(c.vs)}</span>`;
  }
  const cards = d => `<div class="u-cards">${['today', 'week', 'month'].map(k => { const c = d.cards[k]; return `<div class="u-card"><div class="uc-l">${esc(c.label)}</div><div class="uc-n">${fmt(c.tok)}</div>${change(c)}${c.note ? `<div class="uc-note">${esc(c.note)}</div>` : ''}</div>`; }).join('')}</div>`;

  // the plan limit: what Claude reports, or what you typed; never a guess
  function plan(d) {
    const w = (d.limits || []).find(l => l.kind === 'weekly_all'), m = d.manual, wk = { tok: d.claude ? d.claude.week : d.cards.week.tok }, last24 = d.claude ? d.claude.last24 : d.last24;   // Ollama's tokens don't use Claude's limit
    const pct = w ? w.used : m ? m.pct : null;
    let pace = '';
    if (pct != null && pct > 0 && wk.tok > 0) {
      const perPct = wk.tok / pct, now = pct + (w ? 0 : Math.max(0, wk.tok - (m.tok || wk.tok)) / perPct), perDay = last24 / perPct, left = 100 - now;
      pace = perDay > 0 ? ` At the last 24 hours' pace you'd use ${Math.round(perDay)}% a day${Date.now() + left / perDay * 864e5 < d.weekEnd ? `, reaching 100% about ${esc(whenFull(Date.now() + left / perDay * 864e5))}` : ', and stay under the limit until it resets'}.` : '';
    }
    const scoped = (d.limits || []).filter(l => l.group === 'weekly' && l.kind !== 'weekly_all' || /fable/i.test(l.label || '')).map(l => `${esc(l.label)} ${Math.round(l.used)}%`).join(' · ');
    if (!w && d.limitsPending) return `<div class="u-plan"><b>Reading your weekly limit…</b></div>`;
    if (w) return `<div class="u-plan"><b>Weekly limit ${Math.round(w.used)}% used</b> <span class="u-dim">read from Claude, resets ${esc(whenFull(w.resetsAt))}</span><div class="u-dim">${pace}${scoped ? ` ${scoped}.` : ''}</div></div>`;
    return `<div class="u-plan"><b>Weekly limit percent can't be read here</b><div class="u-dim">Showing tokens only.${pct != null ? ` You set ${Math.round(pct)}% on ${esc(stamp(m.at))}.${pace}` : ''}</div>
      <label class="u-man">I'm at <input id="uManual" type="number" min="0" max="100" inputmode="numeric" value="${pct != null ? Math.round(pct) : ''}"> % <button id="uManSave">Save</button></label></div>`;
  }
  // Ollama bills in dollars: its own balance first, then what that means in tokens, marked as the estimate it is
  function ollama(d) {
    const o = d.ollama, usd = n => `$${Number.isInteger(n) ? n : n.toFixed(2)}`, reset = t => new Date(t).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    if (!o) return d.ollamaPending ? `<div class="u-plan"><b>Reading Ollama credits…</b></div>` : '';
    if (o.state === 'none') return '';
    if (o.state !== 'ok') return `<div class="u-plan"><b>Ollama credits can't be read</b><div class="u-dim">${o.state === 'signedOut' ? 'Ollama is signed out on this Mac. Run ollama signin.' : o.state === 'stopped' ? "Ollama isn't running on this Mac." : `Ollama answered: ${esc(o.error || 'no answer')}.`}</div></div>`;
    if (o.allowance == null && o.weeklyLeft != null) return `<div class="u-plan"><b>Ollama ${Math.round(o.weeklyLeft)}% left this week</b>${o.sessionLeft != null ? ` <span class="u-dim">${Math.round(o.sessionLeft)}% left this session</span>` : ''}</div>`;
    const a = o.perDay > 0 ? ` At the last 24 hours' pace of ${usd(+o.perDay.toFixed(2))} a day`  : '', end = o.perDay > 0 ? Date.now() + o.left / o.perDay * 864e5 : 0;
    const pace = a && (o.resetsAt && end >= o.resetsAt ? `${a}, it lasts until the reset.` : `${a}, it runs out about ${esc(reset(end).split(',')[0])}.`);
    return `<div class="u-plan"><b>Ollama ${usd(o.left)} left${o.allowance ? ` of ${usd(o.allowance + (o.bought || 0))}` : ''}</b> <span class="u-dim">read from Ollama${o.resetsAt ? `, resets ${esc(reset(o.resetsAt))}` : ''}</span><div class="u-dim">${o.tokensLeft ? `About ${fmt(o.tokensLeft)} tokens at the cost per token so far.` : ''}${pace}${o.stale ? ` Couldn't update, from ${esc(stamp(o.at))}.` : ''}</div></div>`;
  }
  const seg = (id, items, on) => `<span class="u-seg" id="${id}">${items.map(([k, l]) => `<button data-k="${k}" class="${k === on ? 'on' : ''}">${l}</button>`).join('')}</span>`;
  function ranked(d, p) {
    const r = d.ranked[p], max = Math.max(1, ...r.top.map(s => s.tok));
    if (!r.top.length) return `<div class="u-empty">No tokens used in this period yet.</div>`;
    return r.top.map((s, i) => `<button class="u-row" data-i="${i}" title="${esc(s.project)} · ${fmt(s.tok)} tokens · ${Math.round(s.tok / r.total * 100)}%"><span class="u-name">${esc(s.name)}</span><span class="u-track"><span class="u-bar" style="width:${Math.max(.6, s.tok / max * 100)}%;background:${barColor(s)}"></span></span><span class="u-val">${fmt(s.tok)}<i>${Math.round(s.tok / r.total * 100)}%</i></span></button>`).join('')
      + (r.otherN ? `<div class="u-rest">${r.otherN} more session${r.otherN > 1 ? 's' : ''}: ${fmt(r.other)}</div>` : '');
  }
  function stacked(d) {
    const slot = Object.fromEntries(d.projects.map(p => [p.name, SLOT[p.slot % SLOT.length]])), max = Math.max(1, ...d.days.map(x => x.total)), top = niceTop(max), H = 170;
    const lines = [1, .5].map(f => `<div class="u-grid" style="bottom:${f * 100}%"><span>${fmt(top * f)}</span></div>`).join('');
    const col = x => { const parts = [...d.projects.map(p => p.name), 'Other'].filter(n => x.by[n]);
      const tip = `${date(x.day)}: ${fmt(x.total)}\n` + parts.map(n => `${n} ${fmt(x.by[n])}`).join('\n');
      return `<div class="u-col" title="${esc(tip)}" data-tip="${esc(tip)}">${parts.map(n => `<span style="height:${x.by[n] / top * H}px;background:${slot[n] || OTHER}"></span>`).join('')}</div>`; };
    const ticks = d.days.map((x, i) => `<span>${i % 5 === 4 || i === 29 ? date(x.day) : ''}</span>`).join('');
    const legend = [...d.projects.map(p => [p.name, slot[p.name], p.tok]), ...(d.otherTok ? [['Other', OTHER, d.otherTok]] : [])].map(([n, c, t]) => `<span class="u-key"><i style="background:${c}"></i>${esc(n)} <em>${fmt(t)}</em></span>`).join('');
    const table = `<details class="u-tbl"><summary>Show as a table</summary><table><tr><th>Day</th><th>Total</th>${d.projects.map(p => `<th>${esc(p.name)}</th>`).join('')}<th>Other</th></tr>${d.days.filter(x => x.total).reverse().map(x => `<tr><td>${date(x.day)}</td><td>${fmt(x.total)}</td>${d.projects.map(p => `<td>${x.by[p.name] ? fmt(x.by[p.name]) : ''}</td>`).join('')}<td>${x.by.Other ? fmt(x.by.Other) : ''}</td></tr>`).join('')}</table></details>`;
    return `<div class="u-legend">${legend}</div><div class="u-plot" style="height:${H}px">${lines}<div class="u-cols">${d.days.map(col).join('')}</div></div><div class="u-ticks">${ticks}</div>${table}`;
  }
  const niceTop = m => { const e = 10 ** Math.floor(Math.log10(m)), n = m / e; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * e; };
  function models(d) {
    const tot = d.models.reduce((a, m) => a + m.tok, 0) || 1, cr = d.models.reduce((a, m) => a + m.cr, 0);
    return `<div class="u-mbar">${d.models.map(m => `<span title="${esc(MODEL[m.family])} ${fmt(m.tok)}" style="width:${m.tok / tot * 100}%;background:${famColor(m.family)}"></span>`).join('')}</div>
      ${d.models.map(m => `<div class="u-mrow"><i style="background:${famColor(m.family)}"></i><span class="u-mn">${esc(MODEL[m.family])}</span><span class="u-val">${fmt(m.tok)}<i>${Math.round(m.tok / tot * 100)}%</i></span><span class="u-dim u-msplit">${fmt(m.out)} out · ${fmt(m.inp + m.cw)} in · ${fmt(m.cr)} cache read</span></div>`).join('')}
      ${d.models.length ? `<div class="u-dim u-note">This week. Cache reads are ${Math.round(cr / tot * 100)}% of all tokens. Fable uses the weekly limit faster than the others.</div>` : '<div class="u-empty">No tokens used this week yet.</div>'}`;
  }
  function detail(s, x) {
    const max = Math.max(1, ...x.days.map(d => d.tok)), T = 60;
    return `<div class="u-det"><h4>${esc(s.name)}</h4><div class="u-dim">${esc(s.project)}${s.sids.length > 1 ? `, ${s.sids.length} runs` : ''}</div>
      <div class="u-mini" style="height:${T}px">${x.days.map(d => `<span title="${date(d.day)}: ${fmt(d.tok)}" style="height:${Math.max(d.tok ? 2 : 0, d.tok / max * T)}px;background:${barColor(s)}"></span>`).join('')}</div>
      <div class="u-minit"><span>${date(x.days[0].day)}</span><span>Daily tokens, peak ${fmt(max)}</span><span>Today</span></div>
      ${x.partial ? '<div class="u-dim">The other Mac is offline, so its part of this session is missing.</div>' : ''}<h5>Heaviest turns</h5>${x.turns.length ? x.turns.map(t => `<div class="u-turn"><span class="u-tt">${esc(stamp(t.at))}</span><span class="u-tv">${fmt(t.tok)}</span><span class="u-tx">${esc(t.text || 'No prompt text on record')}${t.calls > 1 ? ` <em>${t.calls} calls</em>` : ''}</span></div>`).join('') : '<div class="u-empty">No turn details on record.</div>'}</div>`;
  }
  // both Macs are one total; when the other's share is missing or old, say that next to the total
  function peerGap(d) {
    const p = d.peerInfo; if (!p) return '';
    if (!p.at) return `<div class="u-plan u-dim">${esc(p.label)} isn't included yet: ${p.online ? (p.err ? `it couldn't answer (${esc(p.err)})` : 'reading it now') : 'it is offline'}. These totals are this Mac only.</div>`;
    if (!p.online || p.err) return `<div class="u-plan u-dim">${esc(p.label)} ${p.online ? "couldn't answer" : 'is offline'}: its share is from ${esc(stamp(p.at))}.</div>`;
    return '';
  }
  function foot(d) {
    const m = Object.entries(d.machines).sort((a, b) => b[1] - a[1]).map(([n, t]) => `${esc(n)} ${fmt(t)}`).join(' · ');
    const peers = Object.entries(d.peers || {}).map(([n, t]) => `${esc(n)} synced ${esc(stamp(t))}`).join(', ');
    return `<div class="u-foot">This month by machine: ${m || 'none yet'}${peers ? `. ${peers}` : ''}. Counts and session names only, stored on this Mac.</div>`;
  }

  let openRun = 0;
  window.usageView = { open(host) {
    let d = null, period = 'week', pick = null;
    const draw = () => {
      if (!d) return host.box(`<div class="uview"><div class="u-h"><h2>Token usage</h2></div><div class="u-empty">Reading…</div></div>`);
      if (d.failed || (!d.ready && d.scanErr)) { host.box(`<div class="uview"><div class="u-h"><h2>Token usage</h2></div><div class="u-empty">Couldn't read token usage${d.scanErr || d.failed ? ': ' + esc(d.scanErr || d.failed) : ''}. <button id="uRetry">Try again</button></div></div>`); const r = document.getElementById('uRetry'); if (r) r.onclick = () => { d = null; draw(); load(); }; return; }
      if (!d.ready) return host.box(`<div class="uview"><div class="u-h"><h2>Token usage</h2></div><div class="u-empty">${d.progress ? `Reading your logs the first time: ${Math.round(d.progress.done / (d.progress.total || 1) * 100)}%` : d.peerInfo && d.peerInfo.online ? `Adding ${esc(d.peerInfo.label)}'s usage…` : 'Reading…'}</div></div>`);
      host.box(`<div class="uview"><div class="u-h"><h2>Token usage</h2><span class="u-dim">${d.refreshing ? `Updating… last read ${esc(stamp(d.scanAt || d.at))}` : d.scanErr ? `Couldn't update, from ${esc(stamp(d.scanAt || d.at))}` : `Updated ${esc(stamp(d.scanAt || d.at))}`}</span></div>
        ${cards(d)}${peerGap(d)}${plan(d)}${ollama(d)}
        <section><div class="u-sh"><h3>Sessions</h3>${seg('uP', [['day', 'Day'], ['week', 'Week'], ['month', 'Month']], period)}</div><div id="uRank">${ranked(d, period)}</div><div id="uDet"></div></section>
        <section><div class="u-sh"><h3>Last 30 days by project</h3></div>${stacked(d)}</section>
        <section><div class="u-sh"><h3>By model</h3></div>${models(d)}</section>${foot(d)}</div>`, true);
      const root = document.querySelector('.uview');
      root.querySelectorAll('#uP button').forEach(b => b.onclick = () => { period = b.dataset.k; pick = null; draw(); });
      root.querySelectorAll('.u-row').forEach(b => b.onclick = async () => {
        const s = d.ranked[period].top[+b.dataset.i], el = root.querySelector('#uDet');
        root.querySelectorAll('.u-row').forEach(x => x.classList.toggle('on', x === b));
        if (pick === s.key) { pick = null; el.innerHTML = ''; b.classList.remove('on'); return; }
        pick = s.key; el.innerHTML = '<div class="u-empty">Reading…</div>';
        try { const x = await host.session(s.sids); if (pick === s.key) { el.innerHTML = detail(s, x); el.scrollIntoView({ block: 'nearest' }); } } catch { el.innerHTML = `<div class="u-empty">Couldn't read this session.</div>`; }
      });
      const save = root.querySelector('#uManSave');
      if (save) save.onclick = async () => { const v = root.querySelector('#uManual').value; await host.setManual(v === '' ? null : +v); d = await host.get(); draw(); };
    };
    draw();
    // keep looking while anything is still arriving, and keep what you had open when the numbers change
    const run = ++openRun;
    const pending = () => d && !d.failed && (!d.ready || d.refreshing || d.limitsPending || d.ollamaPending);
    const redraw = () => {
      const a = document.activeElement; if (a && a.id === 'uManual') return;
      const keep = pick, tbl = document.querySelector('.uview .u-tbl'), open = !!(tbl && tbl.open); pick = null; draw();
      const t = document.querySelector('.uview .u-tbl'); if (t && open) t.open = true;
      if (keep && d.ranked) { const i = d.ranked[period].top.findIndex(s => s.key === keep), b = document.querySelector(`.uview .u-row[data-i="${i}"]`); if (b) b.click(); }
    };
    const load = async () => {
      try { d = await host.get(); if (!d || !d.cards) d = { failed: (d && d.error) || 'no answer' }; } catch (e) { d = { failed: (e && e.message) || 'no answer' }; }
      if (run !== openRun || !document.querySelector('.uview')) return;
      redraw(); if (pending()) setTimeout(load, 1500);
    };
    load();
  } };
})();
