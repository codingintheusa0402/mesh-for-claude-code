// Session refresh (session-refresh.js in the main process): the settings dialog (app menu ▸ Session Refresh…, or a session's
// menu), "Refresh now" in each session's menu, and a refreshed session keeping its place on the mesh (its orbit moves to the
// new session id, which the snapshot links to the old one as prevSid).
(() => {
  const api = window.api.refresh;
  const MODE = [['nightly', 'Nightly'], ['weekends', 'Weekends only'], ['sunday', 'Sundays only'], ['exclude', 'Never']];
  const ago = t => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60e3); return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(t).toLocaleString(); };

  async function open(onPeer = false) {
    const d = await api.get(onPeer).catch(e => ({ err: e.message }));
    const peerOn = !!(snap && snap.peer && snap.peer.online), here = snap && snap.peer && snap.peer.selfLabel || 'This Mac', there = snap && snap.peer && snap.peer.label || 'Other Mac';
    if (!d || d.err) return toast("Couldn't read the refresh settings: " + ((d && d.err) || 'no answer'));
    modal(`<h2>Session refresh</h2>
      ${peerOn ? `<div class="choice" id="rfWhere"><button data-p="0" class="${onPeer ? '' : 'on'}">${esc(here)}</button><button data-p="1" class="${onPeer ? 'on' : ''}">${esc(there)}</button></div>` : ''}
      <div class="pdim" style="margin:8px 0 10px">Long sessions get slow and costly. A refresh has the session write HANDOFF.md, starts a fresh one with the same name, folder, engine and model, has it read the handoff, and closes the old one (its transcript is archived). Never while a session works, waits for you, runs background tasks or holds text you typed.</div>
      <label class="chk"><input type="checkbox" id="rfOn" ${d.enabled ? 'checked' : ''}> Refresh sessions automatically</label>
      <label>Nightly at</label><input type="time" id="rfTime" value="${esc(d.time || '04:00')}" style="width:120px">
      <div class="pdim" style="margin-top:4px">Also when a session's context passes <input type="number" id="rfCap" min="50" step="25" value="${Math.round((d.ctxCap || 300e3) / 1e3)}" style="width:64px">K tokens (<input type="number" id="rfLoop" min="50" step="25" value="${Math.round((d.loopCap || 200e3) / 1e3)}" style="width:64px">K for a session with a /loop), since every call re-reads the whole context, or when its tokens today are far above its normal (Nightly sessions only).
        A session nobody used for <input type="number" id="rfIdle" min="12" step="12" value="${d.idleHours || 48}" style="width:56px"> h with nothing running writes its handoff and closes to free memory; Resume below brings it back.</div>
      <table class="psched" style="margin-top:12px"><tr><th>Session</th><th>When</th><th>Model</th><th>Last refresh</th><th>Now</th><th></th></tr>
        ${d.list.map(s => `<tr><td>${esc(s.name)} <span class="pdim">${s.kind === 'hermes' ? 'Hermes' : 'Claude'} · ${s.ctxTok ? Math.round(s.ctxTok / 1e3) + 'K' : Math.round(100 * s.ctx) + '%'}${s.lineage && s.lineage.gen ? ' · gen ' + s.lineage.gen : ''}</span></td>
          <td><select data-s="${esc(s.name)}">${MODE.map(([k, l]) => `<option value="${k}" ${k === s.mode ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
          <td>${s.kind === 'hermes' ? '<span class="pdim">Hermes</span>' : `<select data-m="${esc(s.name)}">${[['', 'As it is'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']].map(([k, l]) => `<option value="${k}" ${k === (s.model || '') ? 'selected' : ''}>${l}</option>`).join('')}</select>`}</td>
          <td>${esc(ago(s.last && s.last.at))}</td><td class="pdim">${esc(s.why || 'ready')}</td>
          <td><button data-now="${esc(s.sid)}" ${s.why ? 'disabled' : ''}>Refresh now</button></td></tr>`).join('')}</table>
      ${(d.parked || []).length ? `<h3 style="margin-top:14px">Parked</h3><table class="psched">${d.parked.map(p => `<tr><td>${esc(p.name)} <span class="pdim">idle ${p.idleH} h, parked ${esc(ago(p.at))}</span></td><td><button data-unpark="${esc(p.name)}">Resume</button></td></tr>`).join('')}</table>` : ''}
      ${d.running ? `<div class="pdim" style="margin-top:8px">Refreshing ${esc(d.running.name)} (${esc(d.running.step)})…</div>` : ''}
      <div class="pdim" style="margin-top:8px">Log: ${esc((d.log || "").replace(/^\/Users\/[^/]+/, "~"))}</div>
      <div class="btns" style="justify-content:flex-end"><button id="mCancel">Close</button></div>`);
    $('#modalCard').classList.add('wide');
    document.querySelectorAll('#rfWhere button').forEach(b => b.onclick = () => open(b.dataset.p === '1'));
    $('#rfOn').onchange = async e => { await api.set({ enabled: e.target.checked }, onPeer); toast(`Session refresh ${e.target.checked ? 'on' : 'off'}`); };
    $('#rfTime').onchange = async e => { await api.set({ time: e.target.value }, onPeer); toast('Nightly refresh at ' + e.target.value); };
    document.querySelectorAll('select[data-s]').forEach(sel => sel.onchange = async () => { await api.set({ session: sel.dataset.s, mode: sel.value }, onPeer); toast(`${sel.dataset.s}: ${sel.selectedOptions[0].text}`); });
    document.querySelectorAll('button[data-now]').forEach(b => b.onclick = () => now(b.dataset.now));
    document.querySelectorAll('select[data-m]').forEach(sel => sel.onchange = async () => { await api.set({ session: sel.dataset.m, model: sel.value || null }, onPeer); toast(`${sel.dataset.m}: ${sel.selectedOptions[0].text} from its next refresh`); });
    for (const [id, k, mul] of [['#rfCap', 'ctxCap', 1e3], ['#rfLoop', 'loopCap', 1e3], ['#rfIdle', 'idleHours', 1]]) { const el = $(id); if (el) el.onchange = async () => { await api.set({ [k]: +el.value * mul }, onPeer); toast('Saved'); }; }
    document.querySelectorAll('button[data-unpark]').forEach(b => b.onclick = async () => { b.disabled = true; toast(`Resuming ${b.dataset.unpark} from its handoff…`); const r = await api.set({ unpark: b.dataset.unpark }, onPeer).catch(e => ({ ok: false, err: e.message })); toast(r && r.ok ? `${b.dataset.unpark} is back` : `Not resumed: ${(r && r.err) || 'unknown'}`); open(onPeer); });
  }
  async function now(sid) {
    const s = (snap.sessions || []).find(x => x.sid === sid); closeModal();
    toast(`Refreshing ${s ? s.name : 'session'}: handoff first, this takes a few minutes`);
    const r = await api.now(sid).catch(e => ({ ok: false, err: e.message }));
    toast(r && r.ok ? `${s ? s.name : 'Session'} refreshed` : `Not refreshed: ${(r && r.err) || 'unknown'}`);
  }
  api.onOpen(() => open(false));
  window.openRefresh = open; window.refreshNow = now;

  // a refreshed session keeps its orbit: copy the old id's saved orbit to the new id once
  const moved = new Set();
  window.refreshMigrate = sessions => {
    for (const s of sessions || []) {
      if (!s.prevSid || moved.has(s.sid)) continue; moved.add(s.sid);
      try { const o = viz.loadOrbits(); const k = s.onPeer ? s.prevSid : s.prevSid; if (o[k] && !o[s.sid]) { o[s.sid] = o[k]; viz.saveOrbits(); } } catch { }
      try { const m = store.get('sessEngine', {}); if (m[s.prevSid] && !m[s.sid]) { m[s.sid] = m[s.prevSid]; store.set('sessEngine', m); } } catch { }
    }
  };
})();
