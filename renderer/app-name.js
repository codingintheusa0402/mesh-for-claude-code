// The app's name for the pages: the desktop gets it from the main process (mesh-name.js via preload); the phone page is
// served with the default below already swapped for the configured name (phone-server.js). Loaded before every script.
var APP_NAME = (window.api && window.api.appName) || 'Mesh for Claude Code';
(function () {
  const swap = s => s.split('Mesh for Claude Code').join(APP_NAME);
  document.title = swap(document.title);
  const fill = () => document.querySelectorAll('[data-app-name]').forEach(e => { if (e.textContent) e.textContent = swap(e.textContent); for (const a of ['title', 'content', 'alt', 'aria-label']) if (e.hasAttribute(a)) e.setAttribute(a, swap(e.getAttribute(a))); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fill); else fill();
})();
