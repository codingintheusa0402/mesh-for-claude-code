// Press-and-hold a session bubble → a dropdown with what the session does: its summarised context
// (latest /compact summary, else first/last prompt + latest reply), the skills, slash commands and
// tools it used, and the CLAUDE.md instructions it runs under.
let holdCard = null;
function closeHoldCard() { if (holdCard) { holdCard.remove(); holdCard = null; } }
addEventListener('mousedown', e => { if (holdCard && !holdCard.contains(e.target)) closeHoldCard(); }, true);
addEventListener('keydown', e => { if (e.key === 'Escape') closeHoldCard(); });

function detailsHtml(d, s) {
  const chips = (list, cls) => list.length ? `<div class="hd-chips">${list.map(([k, n]) => `<span class="hd-chip ${cls || ''}">${esc(k)}<i>${n}</i></span>`).join('')}</div>` : '<div class="hd-none">none</div>';
  const what = d.summary
    ? `<div class="hd-md">${mdToHtml(d.summary)}</div><div class="hd-note">From the session's latest /compact summary${d.summaryAt ? ' · ' + new Date(d.summaryAt).toLocaleString() : ''}</div>`
    : `<div class="hd-md">${d.first ? `<p><b>Started with:</b> ${esc(d.first)}</p>` : ''}${d.last && d.last !== d.first ? `<p><b>Latest ask:</b> ${esc(d.last)}</p>` : ''}${d.lastText ? `<p><b>Latest reply:</b></p>${mdToHtml(d.lastText)}` : ''}</div>`;
  return `<div class="hd-h"><span class="hdot h-${s ? s.health : 'idle'}"></span><b>${esc(s ? s.name : d.title || d.sid.slice(0, 8))}</b><button class="hd-x">×</button></div>
    <div class="hd-meta">${s ? esc((s.model || '').replace('claude-', '')) + ' · ' : ''}${esc((d.cwd || '').replace(/^\/Users\/[^/]+/, '~'))}</div>
    <details open><summary>Skills used · ${d.skills.length}</summary>${chips(d.skills, 'skill')}</details>
    <details ${d.cmds.length ? 'open' : ''}><summary>Slash commands · ${d.cmds.length}</summary>${chips(d.cmds)}</details>
    <details open class="hd-what"><summary>What this session does</summary>${what}</details>
    <details><summary>Tools · ${d.tools.length}</summary>${chips(d.tools, 'tool')}</details>
    ${d.instructions.map(f => `<details><summary>Instructions · ${esc(f.path)}</summary><div class="hd-md">${mdToHtml(f.text)}</div></details>`).join('')}`;
}

async function openHoldCard(sid, x, y) {
  closeHoldCard(); closeCmdMenu && closeCmdMenu();
  const s = snap.sessions.find(q => q.sid === sid);
  holdCard = document.createElement('div'); holdCard.id = 'holdCard';
  holdCard.innerHTML = `<div class="hd-h"><b>${esc(s ? s.name : sid.slice(0, 8))}</b></div><div class="hd-none">Reading the session…</div>`;
  document.body.appendChild(holdCard);
  const place = () => {
    const r = holdCard.getBoundingClientRect();
    holdCard.style.left = Math.max(10, Math.min(x + 14, innerWidth - r.width - 10)) + 'px';
    holdCard.style.top = Math.max(56, Math.min(y + 14, innerHeight - r.height - 10)) + 'px';
  };
  place();
  const d = await window.api.details(sid).catch(e => ({ ok: false, err: String(e) }));
  if (!holdCard) return;
  holdCard.innerHTML = d.ok ? detailsHtml(d, s) : `<div class="hd-h"><b>${esc(s ? s.name : '')}</b><button class="hd-x">×</button></div><div class="hd-none">${esc(d.err || 'No details')}</div>`;
  holdCard.querySelector('.hd-x').onclick = closeHoldCard;
  place();
}
viz.onHold = (sid, x, y) => openHoldCard(sid, x, y);
