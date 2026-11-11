// Slash-command menu for any session: right-click a session row or its mote, click the ⋯ on a
// row, or use the Commands section / "/" autocomplete in the session panel. Built-in Claude Code
// commands plus the user's own skills & commands (~/.claude and the session's project .claude).
// ui: opens an interactive screen or prints output in the terminal → bring that terminal forward.
const BUILTIN_CMDS = [
  { cmd: '/compact', desc: 'Summarize the conversation to free context', group: 'Session' },
  { cmd: '/clear', desc: 'Clear the conversation history', group: 'Session', danger: true },
  { cmd: '/resume', desc: 'Resume a previous conversation', group: 'Session', ui: true },
  { cmd: '/rewind', desc: 'Rewind conversation / code to an earlier point', group: 'Session', ui: true },
  { cmd: '/export', desc: 'Export the conversation', group: 'Session', ui: true },
  { cmd: '/remote-control', desc: 'Continue this session from phone / web', group: 'Session', ui: true },
  { cmd: '/exit', desc: 'Quit this Claude Code session', group: 'Session', danger: true },
  { cmd: '/context', desc: 'Show what is using the context window', group: 'Inspect', ui: true },
  { cmd: '/cost', desc: 'Token usage & cost of this session', group: 'Inspect', ui: true },
  { cmd: '/usage', desc: 'Plan usage limits', group: 'Inspect', ui: true },
  { cmd: '/status', desc: 'Version, model, account, connectivity', group: 'Inspect', ui: true },
  { cmd: '/todos', desc: 'Current todo list', group: 'Inspect', ui: true },
  { cmd: '/doctor', desc: 'Diagnose the Claude Code install', group: 'Inspect', ui: true },
  { cmd: '/help', desc: 'List available commands', group: 'Inspect', ui: true },
  { cmd: '/model', desc: 'Switch model', group: 'Configure', ui: true },
  { cmd: '/skills', desc: 'Browse available skills', group: 'Configure', ui: true },
  { cmd: '/agents', desc: 'Manage sub-agents', group: 'Configure', ui: true },
  { cmd: '/mcp', desc: 'MCP servers & tools', group: 'Configure', ui: true },
  { cmd: '/memory', desc: 'Edit memory files', group: 'Configure', ui: true },
  { cmd: '/config', desc: 'Open settings', group: 'Configure', ui: true },
  { cmd: '/permissions', desc: 'Allow / deny tool rules', group: 'Configure', ui: true },
  { cmd: '/hooks', desc: 'Manage hooks', group: 'Configure', ui: true },
  { cmd: '/plugin', desc: 'Manage plugins', group: 'Configure', ui: true },
  { cmd: '/statusline', desc: 'Set up the status line', group: 'Configure' },
  { cmd: '/add-dir', desc: 'Add a working directory…', group: 'Configure', arg: true },
  { cmd: '/init', desc: 'Create a CLAUDE.md for this project', group: 'Project' },
  { cmd: '/review', desc: 'Review a pull request', group: 'Project' },
  { cmd: '/release-notes', desc: 'What changed in this version', group: 'Project', ui: true },
];
const SESSION_ACTIONS = [
  { cmd: 'Rename…', desc: 'Give this session a name (shows in /resume)', group: 'Manage', action: s => renameSession(s.sid, s.name) },
  { cmd: 'Convert to agent…', desc: 'Continue it as a background agent', group: 'Manage', action: s => convertToAgent(s.sid) },
  { cmd: 'Switch engine', engine: true, desc: 'Same conversation, on Claude or on an open model through Ollama', group: 'Manage', action: s => switchEngine(s) },
  { cmd: 'Move to the other Mac', move: true, desc: 'Stop it here, copy it over and resume it there', group: 'Manage', action: s => moveSession(s) },
];
const QUICK_CMDS = ['/compact', '/context', '/cost', '/doctor', '/skills', '/model'];
const customCache = new Map();   // cwd -> [cmds]

// Move a session between Claude and Ollama: it ends, then resumes as the same conversation in the same folder, on the Mac
// it runs on. Only while it's not working, so nothing it's doing gets cut off.
const onOllama = s => !!store.get('sessEngine', {})[s.sid] || !!s.model && !/^(claude-|<synthetic)/i.test(s.model) && !/\b(opus|sonnet|haiku|fable)\b/i.test(s.model);
async function switchEngine(s) {
  if (!canControl(s)) return toast('This session can\'t be restarted from here');
  if (s.health === 'working') return toast(`${s.name} is working. Switch it when it's idle.`);
  const toClaude = onOllama(s), sid = s.remoteSid || s.sid;
  modal(`<h2>Switch ${esc(s.name)} to ${toClaude ? 'Claude' : 'Ollama'}</h2>
    ${toClaude ? '' : `<label>Open model</label><select id="eModel" style="width:100%"><option value="">Checking Ollama…</option></select><div class="pdim" id="eNote" style="margin-top:6px"></div>`}
    <p class="pdim">It ends and resumes as the same conversation. Scripts it started in its shell stop too.</p>
    <div class="btns" style="justify-content:flex-end"><button id="mCancel">Cancel</button><button class="primary" id="eGo" ${toClaude ? '' : 'disabled'}>Switch</button></div>`);
  let st = null;
  const ok = () => { const m = $('#eModel').value; $('#eGo').disabled = !m || (/[:-]cloud$/.test(m) && !st.signedIn); };
  if (!toClaude) {
    st = await window.api.ollamaStatus(!!s.onPeer).catch(() => ({ installed: false }));
    if (!$('#eModel')) return;
    ollamaFill(st, $('#eModel'), $('#eNote'), store.get('newOpts', {}).ollamaModel); ok(); $('#eModel').onchange = ok;
  }
  $('#eGo').onclick = async () => {
    const opts = toClaude ? { engine: 'claude' } : { engine: 'ollama', ollamaModel: $('#eModel').value };
    closeModal(); toast(`Ending ${s.name}…`);
    await sessSend(s, '/exit');
    for (let i = 0; i < 30 && (snap.sessions || []).some(x => x.sid === s.sid && !x.offline); i++) await new Promise(r => setTimeout(r, 500));
    if ((snap.sessions || []).some(x => x.sid === s.sid && !x.offline)) return toast(`${s.name} didn't end. Nothing changed, try again.`);
    if (s.onPeer) { const r = await window.api.peer.resume(sid, { ...opts, by: `Mesh window on ${(snap.peer && snap.peer.selfLabel) || 'the other Mac'}` }); if (r && r.ok === false) return toast('Couldn\'t resume it there: ' + (r.err || 'no answer')); }
    else { window.api.engineLog(sid, toClaude ? 'claude' : opts.ollamaModel, 'Mesh window'); await newTerm({ kind: 'claude', cwd: s.cwd, flags: `${RESUME_FLAGS} --resume ${sid}`, title: s.name.slice(0, 40), ...opts }); }
    toast(`${s.name} now runs on ${toClaude ? 'Claude' : opts.ollamaModel}`);
  };
}

async function commandsFor(s) {
  const key = s.cwd || '';
  if (!customCache.has(key)) { const got = await window.api.listCommands(s.cwd).catch(() => null); if (got) customCache.set(key, got); }   // a failed read isn't "no commands": ask again next time
  const acts = SESSION_ACTIONS.filter(a => !a.move || canMove(s)).map(a => a.move ? { ...a, cmd: s.onPeer ? 'Move to this Mac' : 'Move to ' + snap.peer.label } : a.engine ? { ...a, cmd: onOllama(s) ? 'Switch to Claude' : 'Switch to Ollama…' } : a);
  return acts.concat(BUILTIN_CMDS, customCache.get(key) || []);
}
const canControl = s => s && !s.offline && (s.owner || (s.tty && s.kind !== 'bg'));

async function runCommand(s, item) {
  if (item.action) return item.action(s);
  if (!canControl(s)) return toast('Background session — view only');
  if (item.arg) { select(s.sid); requestAnimationFrame(() => { const ta = $('#cText'); if (ta) { ta.value = item.cmd + ' '; ta.focus(); } }); return; }
  if (item.danger && !await confirmCmd(s, item)) return;
  let r;
  r = await sessSend(s, item.cmd);
  if (r && (r.ok === false || r.out === 'notfound')) return toast(r.out === 'notfound' ? 'No Terminal.app tab for ' + s.tty : 'Send failed');
  viz.command(s.sid);
  if (item.ui && !s.onPeer) {                       // show the terminal where the command's screen/output appears
    if (termOf(s) && terms.has(termOf(s))) { if (document.body.dataset.view === 'mesh') setView('split'); activate(termOf(s)); }
    else await window.api.ext.focus(s.tty);
  }
  toast(`${item.cmd} → ${s.name}`);
}

function confirmCmd(s, item) {
  return new Promise(res => {
    modal(`<h2>${esc(item.cmd)}</h2><div style="color:var(--dim);line-height:1.6">${esc(item.desc)} in <b style="color:var(--text)">${esc(s.name)}</b>. This can't be undone.</div>
      <div class="btns" style="justify-content:flex-end"><button id="mCancel">Cancel</button><button class="primary danger-solid" id="cfOk">Run ${esc(item.cmd)}</button></div>`);
    $('#mCancel').onclick = () => { closeModal(); res(false); };
    $('#cfOk').onclick = () => { closeModal(); res(true); };
  });
}

// ---------------- floating menu ----------------
let cmdMenu = null;
async function openCmdMenu(sid, x, y) {
  closeCmdMenu();
  const s = snap.sessions.find(q => q.sid === sid); if (!s) return;
  const refreshCmds = s.pane || s.onPeer ? [{ cmd: 'Refresh now', desc: 'Handoff, then a fresh session with the same name, folder and model', group: 'Session', grp: 'refresh' },
    { cmd: 'Session refresh…', desc: 'Nightly refresh, per-session schedule, last refresh times', group: 'Session', grp: 'refreshcfg' }] : [];
  const all = [{ cmd: 'Archify', desc: "Interactive diagram of this session's project (maps it the first time)", group: 'Project', grp: 'archify' },
    ...(s.onPeer ? [] : [{ cmd: 'Project card', desc: 'How this project runs: rules, checks, to-dos, schedule', group: 'Project', grp: 'card' }]), ...refreshCmds, ...groupCmds(s), ...await commandsFor(s)];
  const el = document.createElement('div'); el.id = 'cmdMenu';
  el.innerHTML = `<div class="cm-h"><span class="hdot h-${s.health}"></span>${esc(s.name)}</div>
    <input id="cmSearch" placeholder="${canControl(s) ? 'Type to filter…  ↑↓ ↩' : 'Background session — view only'}" ${canControl(s) ? '' : 'disabled'}>
    <div class="cm-list"></div>`;
  document.body.appendChild(el); cmdMenu = { el, s, all, idx: 0, items: [] };
  const render = () => {
    const q = $('#cmSearch').value.trim().toLowerCase().replace(/^\//, '');
    const items = all.filter(c => !q || c.cmd.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q));
    cmdMenu.items = items; cmdMenu.idx = Math.min(cmdMenu.idx, Math.max(0, items.length - 1));
    let g = '', html = '';
    items.forEach((c, i) => {
      if (c.group !== g) { g = c.group; html += `<div class="cm-g">${esc(g)}</div>`; }
      html += `<div class="cm-i ${i === cmdMenu.idx ? 'on' : ''} ${c.danger ? 'danger' : ''}" data-i="${i}"><b>${esc(c.cmd)}</b><span>${esc(c.desc)}</span>${c.ui ? '<em>opens terminal</em>' : ''}</div>`;
    });
    el.querySelector('.cm-list').innerHTML = html || '<div class="cm-g">No match</div>';
    el.querySelectorAll('.cm-i').forEach(n => { n.onclick = () => { const it = cmdMenu.items[+n.dataset.i]; closeCmdMenu(); pickCmd(s, it); }; n.onmouseenter = () => { cmdMenu.idx = +n.dataset.i; el.querySelectorAll('.cm-i').forEach(m => m.classList.toggle('on', m === n)); }; });
    el.querySelector('.cm-i.on')?.scrollIntoView({ block: 'nearest' });
  };
  render();
  const r = el.getBoundingClientRect();
  el.style.left = Math.min(x, innerWidth - r.width - 10) + 'px'; el.style.top = Math.min(y, innerHeight - r.height - 10) + 'px';
  const inp = $('#cmSearch'); inp.focus();
  inp.oninput = () => { cmdMenu.idx = 0; render(); };
  inp.onkeydown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); cmdMenu.idx = Math.min(cmdMenu.items.length - 1, cmdMenu.idx + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cmdMenu.idx = Math.max(0, cmdMenu.idx - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = cmdMenu.items[cmdMenu.idx]; if (it) { closeCmdMenu(); pickCmd(s, it); } }
    else if (e.key === 'Escape') closeCmdMenu();
  };
}
// grouping entries at the top of the menu (sessions in a group share a portal on the mesh — renderer/portal.js)
function groupCmds(s) {
  const G = snap.groups || {}, out = [{ cmd: 'Group ▸ New…', desc: 'Put this session in a new group (opens a portal on the mesh)', group: 'Group', grp: 'new' }];
  for (const [id, g] of Object.entries(G)) if (id !== s.group) out.push({ cmd: `Group ▸ ${g.name}`, desc: 'Move this session into this group', group: 'Group', grp: id });
  if (s.group && G[s.group]) out.push({ cmd: 'Ungroup', desc: `Take it out of ${G[s.group].name}`, group: 'Group', grp: 'none' });
  return out;
}
async function pickCmd(s, it) {
  if (!it.grp) return runCommand(s, it);
  if (it.grp === 'archify') return window.api.archify.open(s.sid, s.name).then(r => r && r.ok === false && toast("Archify: " + (r.err || 'could not open')));
  if (it.grp === 'card') return window.openProjectCard && window.openProjectCard(s.sid);
  if (it.grp === 'refresh') return window.refreshNow && window.refreshNow(s.sid);
  if (it.grp === 'refreshcfg') return window.openRefresh && window.openRefresh(!!s.onPeer);
  if (it.grp === 'new') return newGroup([s.sid], s.name);
  await window.api.groups.set(s.sid, it.grp === 'none' ? null : it.grp);
  toast(it.grp === 'none' ? `${s.name} ungrouped` : `${s.name} → ${snap.groups[it.grp].name}`);
}
function closeCmdMenu() { if (cmdMenu) { cmdMenu.el.remove(); cmdMenu = null; } }
addEventListener('mousedown', e => { if (cmdMenu && !cmdMenu.el.contains(e.target)) closeCmdMenu(); }, true);

// right-click on rows (delegated, the list re-renders every second) and on motes
$('#list').addEventListener('contextmenu', e => { const row = e.target.closest('.srow'); if (row) { e.preventDefault(); openCmdMenu(row.dataset.sid, e.clientX, e.clientY); } });
$('#list').addEventListener('click', e => { const m = e.target.closest('[data-more]'); if (m) { e.stopPropagation(); const r = m.getBoundingClientRect(); openCmdMenu(m.dataset.more, r.right + 6, r.top); } }, true);
$('#mesh').addEventListener('contextmenu', e => { const h = viz.hit(e); if (h && h !== 'hub') { e.preventDefault(); openCmdMenu(h, e.clientX, e.clientY); } });

// ---------------- panel: quick command chips + "/" autocomplete in the prompt box ----------------
function enhanceCtl() {
  const s = cur(), box = $('#pCtl'); if (!box || !s || box.querySelector('.cmd-chips')) return;
  const sec = box.querySelector('.sec');
  const chips = document.createElement('div'); chips.className = 'cmd-chips';
  chips.innerHTML = `<h3 style="margin-top:12px">Commands</h3><div class="btns">${QUICK_CMDS.map(c => `<button data-c="${c}">${c}</button>`).join('')}<button id="cAll">All commands…</button></div>
    <div class="btns" style="margin-top:6px"><button id="cRename">✎ Rename</button><button id="cAgent">⚙ Convert to agent</button></div>`;
  sec.appendChild(chips);
  chips.querySelectorAll('[data-c]').forEach(b => b.onclick = () => runCommand(cur(), BUILTIN_CMDS.find(c => c.cmd === b.dataset.c)));
  $('#cAll').onclick = e => { const r = e.target.getBoundingClientRect(); openCmdMenu(s.sid, r.left, r.bottom + 6); };
  if (!canControl(s)) chips.querySelectorAll('[data-c],#cAll').forEach(b => b.disabled = true);
  $('#cRename').onclick = () => renameSession(s.sid, s.name);
  $('#cAgent').onclick = () => convertToAgent(s.sid);
  const old = $('#cCompact'); if (old) old.remove();          // folded into the chips
  // "/" autocomplete
  const ta = $('#cText'), ac = document.createElement('div'); ac.className = 'cmd-ac'; ta.after(ac);
  let acItems = [], acIdx = 0;
  const hide = () => { ac.style.display = 'none'; acItems = []; };
  const show = async () => {
    const v = ta.value; if (!/^\/\S*$/.test(v)) return hide();
    const all = await commandsFor(s), q = v.slice(1).toLowerCase();
    acItems = all.filter(c => !c.action && c.cmd.slice(1).toLowerCase().startsWith(q)).slice(0, 8); acIdx = 0;
    if (!acItems.length) return hide();
    ac.innerHTML = acItems.map((c, i) => `<div class="${i === acIdx ? 'on' : ''}" data-i="${i}"><b>${esc(c.cmd)}</b> <span>${esc(c.desc)}</span></div>`).join('');
    ac.style.display = 'block';
    ac.querySelectorAll('div').forEach(d => d.onmousedown = ev => { ev.preventDefault(); ta.value = acItems[+d.dataset.i].cmd; hide(); ta.focus(); });
  };
  ta.addEventListener('input', show);
  ta.addEventListener('blur', () => setTimeout(hide, 100));
  ta.addEventListener('keydown', e => {
    if (!acItems.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); acIdx = (acIdx + (e.key === 'ArrowDown' ? 1 : acItems.length - 1)) % acItems.length; ac.querySelectorAll('div').forEach((d, i) => d.classList.toggle('on', i === acIdx)); }
    else if (e.key === 'Tab' || (e.key === 'Enter' && !e.metaKey)) { e.preventDefault(); ta.value = acItems[acIdx].cmd; hide(); }
    else if (e.key === 'Escape') hide();
  }, true);
}
new MutationObserver(() => enhanceCtl()).observe($('#panelBody'), { childList: true, subtree: true });
