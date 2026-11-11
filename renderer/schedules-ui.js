// ⏱ Schedules (only with a local add-on that provides it) — every scheduled job on the Mac (launchd) and the 24/7 server (cron): when it
// runs, what it does, which skills it uses, which machine runs it. Edit "when" inline, switch a
// job on/off, move it between machines (its state files travel with it), or run it now.
const DAYN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function whenText(s) {
  if (!s) return '—';
  if (s.every) return s.every % 60 === 0 && s.every >= 60 ? `Every ${s.every / 60} h` : `Every ${s.every} min`;
  const d = !s.days ? 'Every day' : s.days.join() === '1,2,3,4,5' ? 'Weekdays' : s.days.join() === '6,7' ? 'Weekends' : s.days.map(x => DAYN[x - 1]).join(', ');
  return `${d} ${s.at.join(' · ')}`;
}
function nextRun(s) {
  if (!s || s.every) return null;
  const now = new Date();
  for (let add = 0; add < 8; add++) for (const t of s.at) {
    const [h, m] = t.split(':').map(Number), d = new Date(now); d.setDate(d.getDate() + add); d.setHours(h, m, 0, 0);
    const dow = d.getDay() === 0 ? 7 : d.getDay();
    if (d > now && (!s.days || s.days.includes(dow))) return d;
  }
  return null;
}
const rel = t => { const s = (t - Date.now()) / 1000, a = Math.abs(s), v = a < 3600 ? Math.round(a / 60) + 'm' : a < 86400 ? (a / 3600).toFixed(1) + 'h' : Math.round(a / 86400) + 'd'; return s > 0 ? 'in ' + v : v + ' ago'; };
const WHERE = { mac: ['Mac', 'w-mac'], server: ['Server', 'w-srv'], both: ['⚠ Both', 'w-both'], off: ['Off', 'w-off'] };

let schedData = null, schedEdit = null;
async function openSchedules() {
  modal(`<div class="sc-h"><h2>Schedules</h2><span id="scSrv" class="sc-srv">checking server…</span><span style="flex:1"></span><button id="scRefresh">↻ Refresh</button><button id="mCancel">Close</button></div><div id="scBody"><div class="sc-dim">Loading…</div></div>`);
  $('#modalCard').classList.add('wide');
  $('#scRefresh').onclick = () => loadSchedules();
  await loadSchedules();
}
async function loadSchedules() {
  const b = $('#scBody'); if (!b) return;
  const [jobs, infra, gasC] = await Promise.all([window.api.sched.list(), window.api.sched.infra(), window.api.gas.cached()]);
  schedData = jobs; if (schedData && !schedData.error) { schedData.infra = infra; schedData.gas = gasC; schedData.gasDue = await window.api.gasDue?.list?.().catch(() => null); }
  if (schedData.error) { b.innerHTML = `<div class="sc-dim">Couldn't read schedules: ${esc(schedData.error)}</div>`; return; }
  const srv = $('#scSrv'); srv.textContent = schedData.server.reachable ? '● server online' : '● server unreachable — showing Mac only'; srv.className = 'sc-srv ' + (schedData.server.reachable ? 'ok' : 'bad');
  renderSchedules();
}
function renderSchedules() {
  const b = $('#scBody'); if (!b || !schedData) return;
  const rows = schedData.jobs.map(j => {
    const [wl, wc] = j.unknown ? ['Unknown', 'w-off'] : WHERE[j.where], nx = j.enabled && nextRun(j.schedule), other = j.home === 'mac' ? 'server' : 'mac';
    const editing = schedEdit && schedEdit.id === j.id;
    return `<div class="sc-row ${j.enabled ? '' : 'off'}" data-id="${j.id}">
      <div class="sc-main"><div class="sc-name">${esc(j.name)}</div><div class="sc-what">${esc(j.what)}</div>
        <div class="sc-skills">${(j.skills || []).map(s => `<span>${esc(s)}</span>`).join('') || '<em>no skill — plain script</em>'}<code>${esc(j.dir)}/${esc(j.cmd.replace(/^python3\s+/, ''))}</code></div></div>
      <div class="sc-col"><span class="sc-where ${wc}">${wl}</span>
        <button class="sc-mini" data-move="${other}" ${j.movable === false ? `disabled title="${esc(j.pinnedReason || '')}"` : ''}>→ ${other === 'mac' ? 'Mac' : 'Server'}</button></div>
      <div class="sc-col sc-when"><b>${esc(whenText(j.schedule))}</b><span>${nx ? 'next ' + rel(nx) : j.enabled && j.schedule && j.schedule.every ? 'repeating' : j.enabled ? '' : j.unknown ? 'server unreachable' : 'paused'}</span>
        <span>${j.last ? 'last log ' + rel(j.last) : ''}</span><button class="sc-mini" data-edit>✎ Edit</button></div>
      <div class="sc-col"><label class="sc-sw"><input type="checkbox" data-en ${j.enabled ? 'checked' : ''}><i></i></label><button class="sc-mini" data-run>▶ Run now</button></div>
      ${editing ? editorHtml(j) : ''}</div>`;
  }).join('');
  const sess = (schedData.sessions || []).map(s => `<div class="sc-row"><div class="sc-main"><div class="sc-name">${esc(s.name)}</div><div class="sc-what">${esc(s.what)}</div>
      <div class="sc-skills">${s.skills.map(x => `<span>${esc(x)}</span>`).join('')}<code>${esc(s.tmux)} · Remote Control ${esc(s.remote)}</code></div></div>
      <div class="sc-col"><span class="sc-where ${s.where === 'server' ? 'w-srv' : 'w-mac'}">${s.where === 'server' ? 'Server' : 'Mac'}</span></div>
      <div class="sc-col sc-when"><b>${esc(s.schedule)}</b><span>${s.running == null ? '' : s.running ? '● running' : '○ not running'}</span><span class="sc-dim">Change the interval inside that Claude session</span></div><div class="sc-col"></div></div>`).join('');
  const cloud = (schedData.cloud || []).map(c => `<div class="sc-cloud"><b>${esc(c.name)}</b> — ${esc(c.what)}</div>`).join('');
  b.innerHTML = `<h3 class="sc-sec">Scheduled jobs · Mac & server</h3>${rows}<h3 class="sc-sec">Claude session loops</h3>${sess}
    <h3 class="sc-sec">Silent background · runs with no Claude window open</h3>${infraHtml()}
    <h3 class="sc-sec">Apps Script triggers · Google cloud</h3>${gasHtml()}`;
  wireInfraGas(b);
  b.querySelectorAll('.sc-row[data-id]').forEach(row => {
    const id = row.dataset.id, j = schedData.jobs.find(x => x.id === id);
    row.querySelector('[data-edit]').onclick = () => { schedEdit = schedEdit && schedEdit.id === id ? null : { id, s: JSON.parse(JSON.stringify(j.schedule)) }; renderSchedules(); };
    row.querySelector('[data-en]').onchange = async e => { const on = e.target.checked; await act(window.api.sched.enable(id, on), `${j.name} ${on ? 'on' : 'paused'}`); };
    row.querySelector('[data-run]').onclick = async () => { if (!confirm(`Run "${j.name}" now on the ${j.where === 'server' ? 'server' : 'Mac'}?\n\nThis is a real run (jobs gate themselves, e.g. a broadcast won't re-send today's).`)) return; await act(window.api.sched.run(id), `Started ${j.name}`); };
    const mv = row.querySelector('[data-move]');
    if (mv) mv.onclick = async () => { const to = mv.dataset.move; if (!confirm(`Move "${j.name}" to the ${to === 'mac' ? 'Mac' : 'server'}?\n\nIt is switched off here first, its state files are copied over, then it's switched on there — so it never runs on both.`)) return; mv.disabled = true; mv.textContent = 'moving…'; await act(window.api.sched.move(id, to), `${j.name} → ${to === 'mac' ? 'Mac' : 'server'}`); };
    if (schedEdit && schedEdit.id === id) wireEditor(row, j);
  });
}
async function act(p, okMsg) {
  const r = await p.catch(e => ({ ok: false, err: String(e) }));
  if (r && r.ok === false) toast('Failed: ' + (r.err || 'unknown error')); else toast(okMsg);
  schedEdit = null; await loadSchedules();
}

// ---- "when" editor: every N minutes, or times on chosen days ----
function editorHtml(j) {
  const s = schedEdit.s, every = !!s.every, at = s.at || ['09:00'], days = s.days || [];
  return `<div class="sc-edit">
    <label><input type="radio" name="scMode" value="every" ${every ? 'checked' : ''}> Every <input type="number" id="scEvery" min="1" max="1440" value="${s.every || 30}"> minutes</label>
    <label><input type="radio" name="scMode" value="at" ${every ? '' : 'checked'}> At</label>
    <div class="sc-times">${at.map((t, i) => `<span><input type="time" data-t="${i}" value="${t}"><button data-rm="${i}">×</button></span>`).join('')}<button id="scAddT">+ time</button></div>
    <div class="sc-days">${DAYN.map((d, i) => `<button data-d="${i + 1}" class="${!s.days || days.includes(i + 1) ? 'on' : ''}">${d}</button>`).join('')}
      <button id="scWk">Weekdays</button><button id="scAll">Every day</button></div>
    <div class="sc-edit-b"><span class="sc-dim">Applies on the ${j.where === 'server' ? 'server (crontab)' : 'Mac (launchd)'}${j.where === 'off' ? ' — stays paused' : ''}</span><span style="flex:1"></span><button id="scCancel">Cancel</button><button class="primary" id="scSave">Save</button></div></div>`;
}
function wireEditor(row, j) {
  const s = schedEdit.s, q = sel => row.querySelector(sel);
  const mode = () => row.querySelector('input[name=scMode]:checked').value;
  const read = () => {
    if (mode() === 'every') return { every: Math.max(1, +q('#scEvery').value || 30) };
    const at = [...row.querySelectorAll('[data-t]')].map(i => i.value).filter(Boolean);
    const days = [...row.querySelectorAll('[data-d].on')].map(b => +b.dataset.d);
    return { at: at.length ? at : ['09:00'], days: days.length === 7 || !days.length ? null : days };
  };
  const keep = () => { schedEdit.s = read(); };
  row.querySelectorAll('input[name=scMode]').forEach(r => r.onchange = () => { const v = read(); schedEdit.s = v.every ? v : { at: s.at || ['09:00'], days: s.days || null }; renderSchedules(); });
  row.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { b.classList.toggle('on'); row.querySelector('input[value=at]').checked = true; });
  q('#scWk').onclick = () => row.querySelectorAll('[data-d]').forEach(b => b.classList.toggle('on', +b.dataset.d <= 5));
  q('#scAll').onclick = () => row.querySelectorAll('[data-d]').forEach(b => b.classList.add('on'));
  q('#scAddT').onclick = () => { keep(); schedEdit.s = { at: [...(schedEdit.s.at || []), '12:00'], days: schedEdit.s.days || null }; renderSchedules(); };
  row.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { keep(); if (schedEdit.s.at) { schedEdit.s.at.splice(+b.dataset.rm, 1); if (!schedEdit.s.at.length) schedEdit.s.at = ['09:00']; } renderSchedules(); });
  q('#scCancel').onclick = () => { schedEdit = null; renderSchedules(); };
  q('#scSave').onclick = async () => { const v = read(); q('#scSave').disabled = true; q('#scSave').textContent = 'Saving…'; await act(window.api.sched.set(j.id, v), `${j.name}: ${whenText(v)}`); };
}

// ---- silent background infrastructure (server Windows tasks, WSL boot) ----
function infraHtml() {
  const I = schedData.infra; if (!I) return '<div class="sc-dim">—</div>';
  if (!I.items.length) return `<div class="sc-dim">Server not reachable${I.err ? ' — ' + esc(I.err) : ''}</div>`;
  return I.items.map(i => `<div class="sc-row ${i.enabled ? '' : 'off'}"><div class="sc-main"><div class="sc-name">${esc(i.name)}</div><div class="sc-what">${esc(i.what)}</div>
      <div class="sc-skills"><code>${i.kind === 'windows-task' ? 'Windows Task Scheduler' : esc(i.line || '')}</code></div></div>
    <div class="sc-col"><span class="sc-where ${i.where === 'server-windows' ? 'w-srv' : 'w-srv'}">${i.where === 'server-windows' ? 'Server · Windows' : 'Server · WSL'}</span></div>
    <div class="sc-col sc-when"><b>${esc(i.when)}</b><span>${i.last ? 'last run ' + rel(i.last) : ''}</span><span>${esc(i.state || '')}</span></div>
    <div class="sc-col"><label class="sc-sw"><input type="checkbox" data-infra="${esc(i.id)}" ${i.enabled ? 'checked' : ''}><i></i></label></div></div>`).join('');
}

// ---- Apps Script triggers (live from Google's My Triggers page) ----
const errPct = e => { const m = /([\d.]+)\s*%/.exec(e || ''); return m ? +m[1] : 0; };
function gasHtml() {
  const G = schedData.gas, due = schedData.gasDue;
  const head = `<div class="sc-gas-h"><span class="sc-dim">${G && G.at ? `Read ${rel(G.at)} from script.google.com · ${G.triggers.length} triggers` : 'Not loaded yet — ${APP_NAME} reads Google\'s “My Triggers” page with its own Google sign-in.'}${G && G.err ? ' · ⚠ ' + esc(G.err) : ''}</span>
    <button class="sc-mini" id="gasRefresh">${G && G.at ? '↻ Re-read from Google' : '🔑 Sign in & read triggers'}</button></div>`;
  if (!G || !G.triggers) return head;
  const by = new Map();
  for (const p of (due && due.projects) || []) if (p.dueDates.length) by.set(p.scriptId, { project: p.name, list: [] });   // date-driven projects even with no live trigger
  for (const t of G.triggers) { if (!by.has(t.scriptId)) by.set(t.scriptId, { project: t.project, list: [] }); by.get(t.scriptId).list.push(t); }
  const proj = [...by.entries()].sort((a, b) => a[1].project.localeCompare(b[1].project));
  return head + proj.map(([id, p]) => {
    const active = p.list.filter(t => !/Disabled/i.test(t.last)), off = p.list.length - active.length;
    const fnCount = {}; active.forEach(t => fnCount[t.fn + '|' + t.event] = (fnCount[t.fn + '|' + t.event] || 0) + 1);
    const dupes = Object.entries(fnCount).filter(([, n]) => n > 1);
    const meta = due && due.projects && due.projects.find(x => x.scriptId === id);
    const lastRun = active.map(t => Date.parse(t.last)).filter(Boolean).sort((a, b) => b - a)[0];
    return `<div class="sc-row ${active.length ? '' : 'off'}"><div class="sc-main"><div class="sc-name">${esc(p.project)}</div>
        ${meta && meta.what ? `<div class="sc-what">${esc(meta.what)}</div>` : ''}
        <div class="sc-trig">${Object.entries(p.list.reduce((m, t) => { const k = t.fn + ' · ' + t.event; (m[k] = m[k] || { n: 0, off: 0, err: t.errorRate }); m[k].n++; if (/Disabled/i.test(t.last)) m[k].off++; return m; }, {}))
          .map(([k, v]) => `<span class="${v.off === v.n ? 'dis' : ''}">${esc(k)}${v.n > 1 ? ` ×${v.n}` : ''}${v.off ? ` <i>(${v.off} disabled)</i>` : ''}${errPct(v.err) > 0 ? ` <b>${errPct(v.err)}% errors</b>` : ''}</span>`).join('')}</div>
        ${meta && meta.schedule ? `<div class="sc-dim">${esc(meta.schedule)}</div>` : ''}
        ${dupes.length ? `<div class="sc-warn">⚠ ${dupes.map(([k, n]) => `${esc(k.split('|')[0])} has ${n} active triggers`).join(' · ')} — possible duplicate runs</div>` : ''}
        ${meta && meta.dueDates && meta.dueDates.length ? meta.dueDates.map((d, i) => `<div class="sc-due"><span>📅 ${esc(d.label)}</span><input type="date" data-due="${esc(id)}" data-i="${i}" value="${esc(d.value)}"><button class="sc-mini" data-due-save="${esc(id)}" data-i="${i}">Save → Apps Script</button>${d.value && d.value < new Date().toISOString().slice(0, 10) ? '<b class="sc-past">date has passed</b>' : ''}<code>${esc(d.file)}</code>${d.note ? `<div class="sc-dim" style="flex-basis:100%">${esc(d.note)}</div>` : ''}</div>`).join('') : ''}
      </div>
      <div class="sc-col"><span class="sc-where w-cloud">Google</span></div>
      <div class="sc-col sc-when"><b>${active.length} active${off ? ` · ${off} off` : ''}</b><span>${lastRun ? 'last run ' + rel(lastRun) : 'no recent run'}</span></div>
      <div class="sc-col"><button class="sc-mini" data-gas-edit="${esc(id)}">✎ Edit triggers</button>${meta && meta.setupFn ? `<button class="sc-mini" data-gas-code="${esc(id)}" title="Open the editor to run ${esc(meta.setupFn)}">▶ Run setup</button>` : ''}</div></div>`;
  }).join('');
}
function wireInfraGas(b) {
  b.querySelectorAll('[data-infra]').forEach(cb => cb.onchange = async () => {
    const on = cb.checked, id = cb.dataset.infra;
    if (!on && !confirm(`Turn off "${id.replace(/^(win|cron):/, '')}" on the server?\n\nThis can stop the 24/7 jobs/sessions from coming back after a reboot.`)) { cb.checked = true; return; }
    await act(window.api.sched.infraEnable(id, on), `${id.replace(/^(win|cron):/, '')} ${on ? 'on' : 'off'}`);
  });
  const gr = b.querySelector('#gasRefresh'); if (gr) gr.onclick = async () => { gr.disabled = true; gr.textContent = 'Reading… (a Google window opens if you need to sign in)'; const r = await window.api.gas.refresh(); if (r && r.ok === false) toast(r.err); await loadSchedules(); };
  b.querySelectorAll('[data-gas-code]').forEach(btn => btn.onclick = () => { const m = schedData.gasDue.projects.find(x => x.scriptId === btn.dataset.gasCode); toast(`In the editor pick “${m.setupFn}” in the function list and press Run`); window.api.gas.open(`https://script.google.com/home/projects/${encodeURIComponent(m.scriptId)}/edit`); });
  b.querySelectorAll('[data-gas-edit]').forEach(btn => btn.onclick = async () => { toast('Opening the project’s triggers in Apps Script — re-reading when you close it'); await window.api.gas.edit(btn.dataset.gasEdit); await window.api.gas.refresh(); await loadSchedules(); });
  b.querySelectorAll('[data-due-save]').forEach(btn => btn.onclick = async () => {
    const id = btn.dataset.dueSave, i = +btn.dataset.i, inp = b.querySelector(`[data-due="${id}"][data-i="${i}"]`);
    const meta = schedData.gasDue.projects.find(x => x.scriptId === id), d = meta.dueDates[i];
    if (!confirm(`Change "${d.label}" in ${meta.name}\n${d.value} → ${inp.value}\n\nThis edits ${d.file}, pushes it to Apps Script (clasp push) and commits it to GitHub.`)) return;
    btn.disabled = true; btn.textContent = 'Pushing…';
    await act(window.api.gasDue.set(id, i, inp.value), `${meta.name}: ${d.label} → ${inp.value}`);
  });
}
$('#schedBtn').onclick = openSchedules;
