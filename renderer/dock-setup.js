// Wires the app's panels into the dock (dock.js) — loaded after app.js (2026-11-01).
(function () {
  const D = window.meshDock; if (!D) return;
  const $ = s => document.querySelector(s);
  D.register('sessions', { title: 'Sessions', el: $('#side'), spot: { edge: 'left', size: .18 } });
  D.register('mesh', { title: 'Mesh', el: $('#meshWrap'), spot: { edge: 'top', size: .55 } });
  D.register('terminals', { title: 'Terminals', el: $('#dock'), spot: { edge: 'bottom', size: .42 } });
  D.register('details', { title: 'Details', el: $('#panel'), spot: { edge: 'right', size: .26 } });

  // Details comes and goes with the selection, as before — but wherever you docked it
  const panel = $('#panel');
  const syncDetails = () => D.autoHide('details', panel.classList.contains('hidden'));
  new MutationObserver(syncDetails).observe(panel, { attributes: true, attributeFilter: ['class'] });
  syncDetails();

  // the dock is the full-size window's layout; compact / mini keep theirs
  const host = $('#body');
  const viewSync = () => { if (!D.isMounted()) return; const v = document.body.dataset.view; D.maximize(v === 'mesh' ? 'mesh' : v === 'grid' ? 'terminals' : null); };
  let lastSize = null, lastView = null;
  const apply = () => {
    const size = document.body.dataset.size, view = document.body.dataset.view;
    if (size !== lastSize) { lastSize = size; size === 'full' ? D.mount(host) : D.unmount(); lastView = null; }
    if (view !== lastView) { lastView = view; viewSync(); }
  };
  new MutationObserver(apply).observe(document.body, { attributes: true, attributeFilter: ['data-size', 'data-view'] });
  apply();

  // ⌘0 / the sidebar button: show or hide the Sessions panel while docked
  const db = $('#drawerBtn'), orig = db.onclick;
  db.onclick = e => D.isMounted() ? D.toggle('sessions') : orig && orig.call(db, e);

  // Window menu ▸ Panels
  const send = l => { try { window.api.dockState && window.api.dockState(l); } catch { } };
  D.onChange(send); send(D.list());
  window.api.onDockCmd && window.api.onDockCmd(c => {
    if (!c) return;
    if (c.op === 'toggle') { if (!D.isMounted()) return window.toast ? toast('Panels can be moved in the full-size window') : null; D.toggle(c.id); }
    else if (c.op === 'reset') { if (D.isMounted()) D.reset(); }
  });
})();
