// Cleaning up (2026-11-04): click the black hole, or Clean up in Simple view, and it lists the sessions nobody has used
// for 24 or 48+ hours. Used = the last prompt or reply, so an app restart (which resumes every session) doesn't count.
// Sessions at work or waiting for an answer are never listed; ones with something waiting on you start unticked.
// Each one gets /exit: on the mesh it falls into the hole; anywhere else it just ends. Its history stays, so it can be
// reopened from History.
(function () {
  const old = s => { const h = age(s) / 3600; return h < 48 ? Math.round(h) + 'h' : Math.round(h / 24) + 'd'; };
  const pool = new Set();                    // sessions on their way into the hole (app.js onTrash sends these)
  const age = s => s.sinceUse ?? s.sinceWrite ?? 0;
  const stale = h => (snap.sessions || []).filter(s => !s.offline && age(s) >= h * 3600 && (s.health === 'idle' || s.health === 'error')).sort((a, b) => age(b) - age(a));
  const waits = s => (window.projectCards && window.projectCards[s.sid] && window.projectCards[s.sid].waitingN) || 0;
  const known = s => !!(window.projectCards && window.projectCards[s.sid]);
  const why = s => waits(s) ? `⚑ ${waits(s)} waiting on you, check first` : !known(s) ? 'Couldn\'t check for waiting items, tick it yourself' : s.headless ? 'A script\'s finished run' : s.auto ? 'Unnamed session' : s.subagents ? 'Sub-agents still running' : '';
  const ending = () => Number(store.get('cleanHours', 24)) === 48 ? 48 : 24;

  window.cleanupTake = s => { if (!pool.delete(s.sid)) return false; sessSend(s, '/exit'); return true; };
  window.cleanupBar = () => { const n = stale(ending()).filter(canControl).length;
    return `<div class="bclean"><span>${n ? `${n} session${n > 1 ? 's' : ''} unused for ${ending()} hours or more` : `No session unused for ${ending()} hours`}</span><button data-clean>Clean up…</button></div>`; };

  async function run(list) {
    closeModal(); let mesh = 0;
    for (const s of list) {
      if (viz.bhSwallow && viz.bhSwallow(s.sid)) { pool.add(s.sid); mesh++; setTimeout(() => { if (pool.delete(s.sid)) sessSend(s, '/exit'); }, 8000); await new Promise(r => setTimeout(r, 350)); }
      else { await sessSend(s, '/exit'); await new Promise(r => setTimeout(r, 120)); }
    }
    toast(`Ended ${list.length} session${list.length > 1 ? 's' : ''}. Reopen any of them from History.`);
  }

  window.openCleanup = () => {
    const off = new Set(); let hours = ending();
    const draw = () => {
      const all = stale(hours), can = all.filter(canControl), view = all.length - can.length, pick = can.filter(s => !off.has(s.sid));
      modal(`<div class="clean"><h2>Clean up sessions</h2>
        <div class="clean-h"><span>Unused for</span><span class="clean-seg">${[24, 48].map(h => `<button data-h="${h}" class="${h === hours ? 'on' : ''}">${h} hours+</button>`).join('')}</span></div>
        ${can.length ? `<div class="clean-list">${can.map(s => `<label class="clean-row"><input type="checkbox" data-s="${esc(s.sid)}" ${off.has(s.sid) ? '' : 'checked'}>
            <span class="clean-n"><b>${esc(s.name)}</b>${s.onPeer || s.hostLabel ? ' ' + peerTag(s) : ''}${why(s) ? `<i>${esc(why(s))}</i>` : ''}</span><span class="clean-a">${old(s)}</span></label>`).join('')}</div>
          <div class="clean-note">Each selected session gets /exit. You can reopen any of them from History.${view ? ` ${view} view-only session${view > 1 ? 's' : ''} can't be ended from here.` : ''}</div>`
        : `<div class="clean-none">No session has gone unused for ${hours} hours${view ? ` (${view} view-only)` : ''}.</div>`}
        <div class="btns" style="justify-content:flex-end"><button id="mCancel">Close</button>${can.length ? `<button class="primary" id="cGo" ${pick.length ? '' : 'disabled'}>End ${pick.length} session${pick.length === 1 ? '' : 's'}</button>` : ''}</div></div>`);
      document.querySelectorAll('.clean-seg button').forEach(b => b.onclick = () => { hours = +b.dataset.h; store.set('cleanHours', hours); off.clear(); seed(); draw(); });
      document.querySelectorAll('.clean-row input').forEach(c => c.onchange = () => { if (c.checked) off.delete(c.dataset.s); else off.add(c.dataset.s); draw(); });
      const go = $('#cGo'); if (go) go.onclick = () => run(pick);
    };
    const seed = () => { for (const s of stale(hours)) if (waits(s) || s.subagents || !known(s)) off.add(s.sid); };
    modal(`<div class="clean"><h2>Clean up sessions</h2><div class="clean-none">Checking sessions…</div></div>`);
    (window.api.cards ? window.api.cards.summary() : Promise.resolve(null)).then(r => { if (r) window.projectCards = r; }, () => { }).then(() => { seed(); draw(); });
  };
  viz.onHoleClick = () => window.openCleanup();
})();
