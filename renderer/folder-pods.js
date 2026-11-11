// A session's project folder (2026-11-01): the folder button in Sessions (app.js srowHtml) and the probe's
// "Open a session's folder…" menu (probe.js) open it in Finder. (Pods orbiting the bubbles were tried and removed:
// too small to click.) Which folder: project-folders.js. The list is fetched every 30 s and when sessions come or go;
// the main process caches it by transcript size. Not on the phone (it can't open the Mac's Finder).
(function () {
  if (typeof Mesh === 'undefined' || !window.api || !window.api.folders) return;
  window.sessionFolders = {};
  let key = '', count = -1;
  async function refresh() {
    if (document.visibilityState !== 'visible') return;
    try {
      const f = await window.api.folders(), k = JSON.stringify(f);
      if (k !== key) { key = k; window.sessionFolders = f; if (typeof viz !== 'undefined') viz.folders = f; if (typeof renderList === 'function') renderList(); }
    } catch { }
  }
  setTimeout(refresh, 2500); setInterval(refresh, 30000);
  setInterval(() => { const n = (window.snap && snap.sessions || []).length; if (n !== count) { count = n; refresh(); } }, 5000);
  window.openSessionFolder = async p => {
    if (!p) { if (window.toast) toast("This folder isn't on this Mac yet. A copy arrives through iCloud within about 15 minutes."); return; }
    const f = Object.values(window.sessionFolders).find(x => x.path === p);
    const r = await window.api.openFolder(p);
    if (window.toast) toast(r && r.ok ? `Opened ${f ? f.label : p} in Finder` : `Couldn't open the folder${r && r.err ? ': ' + r.err : ''}`);
  };

})();
