// Dockable panels, Premiere Pro style (2026-11-01). Every panel (Sessions, Mesh, Terminals, Details, one per MCP …)
// lives in a layout tree of resizable splits and tab stacks:
//   · drag a panel's tab onto another panel: its left / right / top / bottom edge splits there, its middle adds a tab;
//     onto the window's outer edge: a full-height / full-width column or row
//   · drag the gutters between panels to resize; double-click a tab (or `) to maximise that panel and back
//   · Window menu: show / hide each panel, Reset Panel Layout. The layout is saved per machine (localStorage).
// Only in the full-size window: the compact and mini window sizes keep their own layouts, so the dock hands the
// panels back to their original places there (mount / unmount on data-size changes).
//   meshDock.register(id, { title, el, closable, spot })   spot: { edge: 'right'|'left'|'bottom'|'top', size, group }
//   meshDock.show(id) / hide(id) / toggle(id) / maximize(id|null) / reset() / list() / onChange(fn)
(function () {
  const KEY = 'mesh.dock.v1', MIN = 110, GUT = 5;
  const panels = new Map();                 // id → { id, title, el, closable, spot, home: {parent, next} }
  let tree = null, hidden = new Set(), last = {}, max = null, mounted = false, root = null, listeners = [], drag = null, autoHidden = new Set();
  let uid = 0; const nid = () => 'n' + (++uid);

  // ---------- tree helpers ----------
  const stack = (ids, active) => ({ t: 'stack', id: nid(), panels: ids.slice(), active: active || ids[0] });
  const split = (dir, kids, sizes) => ({ t: dir, id: nid(), kids, sizes: sizes || kids.map(() => 1 / kids.length) });
  function walk(n, fn, parent) { if (!n) return; fn(n, parent); if (n.kids) n.kids.forEach(k => walk(k, fn, n)); }
  function findStackOf(pid) { let r = null; walk(tree, n => { if (n.t === 'stack' && n.panels.includes(pid)) r = n; }); return r; }
  function findNode(id) { let r = null, p = null; walk(tree, (n, par) => { if (n.id === id) { r = n; p = par; } }); return [r, p]; }
  function parentOf(node) { let p = null; walk(tree, (n, par) => { if (n === node) p = par; }); return p; }
  function prune(n) {                                         // empty stacks go, one-child splits collapse
    if (!n) return null;
    if (n.t === 'stack') return n.panels.length ? n : null;
    const kids = [], sizes = [];
    n.kids.forEach((k, i) => { const p = prune(k); if (p) { kids.push(p); sizes.push(n.sizes[i]); } });
    if (!kids.length) return null;
    if (kids.length === 1) return kids[0];
    const tot = sizes.reduce((a, b) => a + b, 0) || 1;
    // same-direction child splits merge into this one
    const fk = [], fs = [];
    kids.forEach((k, i) => { const s = sizes[i] / tot; if (k.t === n.t) k.kids.forEach((kk, j) => { fk.push(kk); fs.push(s * k.sizes[j]); }); else { fk.push(k); fs.push(s); } });
    n.kids = fk; n.sizes = fs; return n;
  }
  function removePanel(pid) {
    const s = findStackOf(pid); if (!s) return;
    last[pid] = { stack: s.id, siblings: s.panels.filter(x => x !== pid) };
    s.panels = s.panels.filter(x => x !== pid); if (s.active === pid) s.active = s.panels[0];
    tree = prune(tree);
  }
  // put panel pid next to node `target` (zone: left/right/top/bottom/center); target null = the window's edge
  function insert(pid, target, zone, size) {
    if (!tree) { tree = stack([pid]); return; }
    if (zone === 'center' && target && target.t === 'stack') { target.panels.push(pid); target.active = pid; return; }
    const dir = zone === 'left' || zone === 'right' ? 'row' : 'col', before = zone === 'left' || zone === 'top';
    const fresh = stack([pid]), f = Math.min(.6, Math.max(.15, size || .35));
    const node = target || tree, par = target ? parentOf(node) : null;
    if (par && par.t === dir) {
      const i = par.kids.indexOf(node), give = par.sizes[i] * f;
      par.sizes[i] -= give; par.kids.splice(before ? i : i + 1, 0, fresh); par.sizes.splice(before ? i : i + 1, 0, give);
    } else {
      const wrap = split(dir, before ? [fresh, node] : [node, fresh], before ? [f, 1 - f] : [1 - f, f]);
      if (!par) tree = wrap; else { const i = par.kids.indexOf(node); par.kids[i] = wrap; }
    }
  }
  function defaultLayout() {
    const W = innerWidth || 1440, sw = Math.min(.3, 250 / W), pw = Math.min(.35, 380 / W);
    const center = split('col', [stack(['mesh']), stack(['terminals'])], [.58, .42]);
    const kids = [stack(['sessions']), center], sizes = [sw, 1 - sw];
    if (panels.has('details')) { kids.push(stack(['details'])); sizes[1] -= pw; sizes.push(pw); }
    return split('row', kids, sizes);
  }

  // ---------- persistence ----------
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ tree, hidden: [...hidden], last, max })); } catch { } emit(); }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (!d || !d.tree) return false;
      tree = d.tree; hidden = new Set(d.hidden || []); last = d.last || {}; max = d.max || null;
      walk(tree, n => { const k = +String(n.id).slice(1); if (k > uid) uid = k; });
      return true;
    } catch { return false; }
  }

  // ---------- render ----------
  function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function render() {
    if (!mounted) return;
    // registered panels that are neither in the tree nor hidden (new MCP panels, a fresh install) find a spot
    for (const [id, p] of panels) if (!hidden.has(id) && !autoHidden.has(id) && !findStackOf(id)) place(id, p.spot);
    // panels in the tree that aren't registered (an MCP panel from last time) wait out of sight
    const parking = root.querySelector('.dk-park') || root.appendChild(el('div', 'dk-park'));
    for (const [, p] of panels) parking.appendChild(p.el);   // keep every element alive while the tree is rebuilt
    root.querySelectorAll(':scope > .dk-node').forEach(n => n.remove());
    root.classList.toggle('dk-maxed', !!max && !!findStackOf(max));
    if (tree) root.insertBefore(build(tree), parking);
    requestAnimationFrame(() => { dispatchEvent(new Event('resize')); });
  }
  function build(n) {
    if (n.t === 'stack') {
      const s = el('div', 'dk-node dk-stack'); s.dataset.id = n.id;
      const live = n.panels.filter(id => panels.has(id));
      if (!live.includes(n.active)) n.active = live[0];
      if (max && n.panels.includes(max)) { s.classList.add('dk-max'); n.active = max; }
      const head = el('div', 'dk-head');
      for (const id of n.panels) {
        const p = panels.get(id); if (!p) continue;
        const tab = el('div', 'dk-tab' + (id === n.active ? ' on' : '')); tab.dataset.pid = id;
        tab.innerHTML = `<span class="dk-tt"></span>` + (p.closable === false ? '' : `<button class="dk-x" title="Hide this panel (Window menu brings it back)">×</button>`);
        tab.querySelector('.dk-tt').textContent = p.title;
        tab.addEventListener('pointerdown', e => startDrag(e, id, tab));
        tab.addEventListener('dblclick', () => maximize(max === id ? null : id));
        const x = tab.querySelector('.dk-x'); if (x) { x.addEventListener('pointerdown', e => e.stopPropagation()); x.onclick = e => { e.stopPropagation(); hide(id); }; }
        head.appendChild(tab);
      }
      const body = el('div', 'dk-body');
      for (const id of n.panels) { const p = panels.get(id); if (!p) continue; p.el.classList.add('dk-panel'); p.el.classList.toggle('dk-off', id !== n.active); body.appendChild(p.el); }
      s.append(head, body); return s;
    }
    const box = el('div', `dk-node dk-split dk-${n.t}`); box.dataset.id = n.id;
    n.kids.forEach((k, i) => {
      const c = build(k); c.style.flex = `${n.sizes[i]} 1 0px`; box.appendChild(c);
      if (i < n.kids.length - 1) { const g = el('div', 'dk-gut'); g.addEventListener('pointerdown', e => startResize(e, n, i, box)); box.appendChild(g); }
    });
    return box;
  }
  function activate(id) { const s = findStackOf(id); if (!s) return; s.active = id; render(); save(); }

  // ---------- resizing ----------
  function startResize(e, n, i, box) {
    e.preventDefault(); const horiz = n.t === 'row', rect = box.getBoundingClientRect(), total = (horiz ? rect.width : rect.height) - GUT * (n.kids.length - 1);
    const a0 = n.sizes[i], b0 = n.sizes[i + 1], p0 = horiz ? e.clientX : e.clientY, minF = MIN / total;
    const kids = [...box.children].filter(c => c.classList.contains('dk-node'));
    document.body.classList.add(horiz ? 'dk-resizing-x' : 'dk-resizing-y');
    const mv = ev => {
      const d = ((horiz ? ev.clientX : ev.clientY) - p0) / total;
      const a = Math.max(minF, Math.min(a0 + b0 - minF, a0 + d));
      n.sizes[i] = a; n.sizes[i + 1] = a0 + b0 - a;
      kids[i].style.flex = `${n.sizes[i]} 1 0px`; kids[i + 1].style.flex = `${n.sizes[i + 1]} 1 0px`;
      dispatchEvent(new Event('resize'));
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); document.body.classList.remove('dk-resizing-x', 'dk-resizing-y'); save(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }

  // ---------- dragging a tab ----------
  function startDrag(e, id, tab) {
    if (e.button !== 0) return;
    const x0 = e.clientX, y0 = e.clientY; let started = false;
    const mv = ev => {
      if (!started) { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return; started = true; beginDrag(id); }
      moveDrag(ev);
    };
    const up = ev => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('keydown', esc, true);
      if (started) endDrag(ev); else activate(id); };
    const esc = ev => { if (ev.key === 'Escape' && drag) { ev.preventDefault(); cancelDrag(); removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('keydown', esc, true); } };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('keydown', esc, true);
  }
  function beginDrag(id) {
    const ghost = el('div', 'dk-ghost'); ghost.textContent = panels.get(id).title;
    const hint = el('div', 'dk-drop');
    document.body.append(ghost, hint); document.body.classList.add('dk-dragging');
    drag = { id, ghost, hint, target: null, zone: null };
  }
  function zoneFor(ev) {
    const r = root.getBoundingClientRect(), E = 18;               // the window's outer edge: a full column / row
    if (ev.clientX - r.left < E) return { node: null, zone: 'left', rect: { l: r.left, t: r.top, w: r.width * .25, h: r.height } };
    if (r.right - ev.clientX < E) return { node: null, zone: 'right', rect: { l: r.right - r.width * .25, t: r.top, w: r.width * .25, h: r.height } };
    if (r.bottom - ev.clientY < E) return { node: null, zone: 'bottom', rect: { l: r.left, t: r.bottom - r.height * .3, w: r.width, h: r.height * .3 } };
    const sEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.dk-stack'); if (!sEl || !root.contains(sEl)) return null;
    const [node] = findNode(sEl.dataset.id); if (!node) return null;
    const b = sEl.getBoundingClientRect(), fx = (ev.clientX - b.left) / b.width, fy = (ev.clientY - b.top) / b.height;
    const onHead = ev.clientY - b.top < 30;
    let zone = 'center';
    if (!onHead) { const m = Math.min(fx, 1 - fx, fy, 1 - fy); if (m < .25) zone = m === fx ? 'left' : m === 1 - fx ? 'right' : m === fy ? 'top' : 'bottom'; }
    const R = { center: { l: b.left, t: b.top, w: b.width, h: b.height }, left: { l: b.left, t: b.top, w: b.width / 2, h: b.height }, right: { l: b.left + b.width / 2, t: b.top, w: b.width / 2, h: b.height },
      top: { l: b.left, t: b.top, w: b.width, h: b.height / 2 }, bottom: { l: b.left, t: b.top + b.height / 2, w: b.width, h: b.height / 2 } }[zone];
    return { node, zone, rect: R };
  }
  function moveDrag(ev) {
    drag.ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 10}px)`;
    const z = zoneFor(ev);
    // dropping a panel onto its own lone stack changes nothing
    const self = z && z.node && z.node.t === 'stack' && z.node.panels.length === 1 && z.node.panels[0] === drag.id;
    drag.target = self ? null : z;
    if (!drag.target) { drag.hint.style.display = 'none'; return; }
    const R = drag.target.rect; Object.assign(drag.hint.style, { display: 'block', left: R.l + 'px', top: R.t + 'px', width: R.w + 'px', height: R.h + 'px' });
  }
  function endDrag() {
    const z = drag && drag.target, id = drag && drag.id; cancelDrag();
    if (!z) return;
    if (z.node && z.node.t === 'stack' && z.zone === 'center' && z.node.panels.includes(id)) return;
    const targetId = z.node ? z.node.id : null;
    removePanel(id);
    const target = targetId ? findNode(targetId)[0] : null;   // the target may have collapsed into its parent
    insert(id, target && target.t === 'stack' ? target : (target || null), target ? z.zone : z.zone, z.node ? .5 : .28);
    if (max === id) max = null;
    render(); save();
  }
  function cancelDrag() { if (!drag) return; drag.ghost.remove(); drag.hint.remove(); document.body.classList.remove('dk-dragging'); drag = null; }

  // ---------- show / hide ----------
  function place(id, spot) {
    const L = last[id], again = L && findNode(L.stack)[0];
    if (again && again.t === 'stack') { again.panels.push(id); again.active = id; return; }
    if (L && L.siblings) for (const s of L.siblings) { const st = findStackOf(s); if (st) { st.panels.push(id); st.active = id; return; } }
    spot = spot || { edge: 'right', size: .3 };
    if (spot.group) {                                          // e.g. MCP panels: stack up under the newest one of the group
      const mates = [...panels.values()].filter(p => p.id !== id && p.spot && p.spot.group === spot.group && findStackOf(p.id));
      if (mates.length) { insert(id, findStackOf(mates[mates.length - 1].id), 'bottom', .5); return; }
    }
    insert(id, null, spot.edge || 'right', spot.size || .3);
  }
  function show(id) { if (!panels.has(id)) return; hidden.delete(id); autoHidden.delete(id); if (!findStackOf(id)) place(id, panels.get(id).spot); else activate(id); render(); save(); }
  function hide(id) { if (!findStackOf(id)) { hidden.add(id); save(); return; } removePanel(id); hidden.add(id); if (max === id) max = null; render(); save(); }
  function toggle(id) { (findStackOf(id) && !hidden.has(id)) ? hide(id) : show(id); }
  // the app hiding a panel by itself (Details with nothing selected): out of the layout, but not "closed by you"
  function autoHide(id, on) {
    if (on) { autoHidden.add(id); if (findStackOf(id)) { removePanel(id); render(); } }
    else if (autoHidden.has(id)) { autoHidden.delete(id); if (!hidden.has(id)) { place(id, panels.get(id).spot); render(); } }
  }
  function maximize(id) { max = id && findStackOf(id) ? id : null; render(); save(); }
  function reset() {                                         // the default layout, plus the extra panels that were showing
    const extra = [...panels.keys()].filter(id => findStackOf(id) && !['sessions', 'mesh', 'terminals', 'details'].includes(id));
    max = null; hidden.clear(); last = {}; tree = defaultLayout();
    if (autoHidden.has('details')) removePanel('details');
    for (const id of extra) place(id, panels.get(id).spot);
    render(); save();
  }
  function list() { return [...panels.values()].map(p => ({ id: p.id, title: p.title, shown: !!findStackOf(p.id), group: p.spot && p.spot.group || null })); }
  function emit() { const l = list(); listeners.forEach(f => { try { f(l); } catch { } }); }

  // ---------- mount / unmount ----------
  function mount(host) {
    if (mounted) return; mounted = true;
    root = host; root.classList.add('dk-root');
    for (const [, p] of panels) if (!p.home) p.home = { parent: p.el.parentNode, next: p.el.nextSibling };
    if (!tree && !load()) tree = defaultLayout();
    document.body.classList.add('docked');
    render();
  }
  function unmount() {
    if (!mounted) return; mounted = false;
    for (const [, p] of panels) { p.el.classList.remove('dk-panel', 'dk-off'); if (p.home && p.home.parent) p.home.parent.insertBefore(p.el, p.home.next && p.home.next.parentNode === p.home.parent ? p.home.next : null); }
    root.querySelectorAll('.dk-node, .dk-park').forEach(n => n.remove()); root.classList.remove('dk-root', 'dk-maxed');
    document.body.classList.remove('docked'); requestAnimationFrame(() => dispatchEvent(new Event('resize')));
  }
  function register(id, opt) {
    const p = Object.assign(panels.get(id) || {}, { id, closable: true }, opt);
    panels.set(id, p);
    if (mounted) { if (!p.home) p.home = null; render(); } emit();
  }
  function unregister(id) { const p = panels.get(id); if (!p) return; panels.delete(id); if (p.el) p.el.remove(); if (mounted) render(); emit(); }
  function setTitle(id, title) { const p = panels.get(id); if (!p || p.title === title) return; p.title = title; const t = root && root.querySelector(`.dk-tab[data-pid="${CSS.escape(id)}"] .dk-tt`); if (t) t.textContent = title; emit(); }

  addEventListener('keydown', e => { if (e.key === '`' && mounted && !/^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || '') && !document.activeElement?.closest('.xterm')) {
    const hov = document.querySelector('.dk-stack:hover'); const n = hov && findNode(hov.dataset.id)[0]; if (n) { e.preventDefault(); maximize(max ? null : n.active); } } });

  window.meshDock = { register, unregister, setTitle, mount, unmount, show, hide, toggle, autoHide, maximize, reset, list, isMounted: () => mounted,
    isShown: id => !!findStackOf(id), onChange: f => listeners.push(f), _state: () => ({ tree, hidden: [...hidden], max }) };
})();
