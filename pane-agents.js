// Watched agents (2026-11-13): a script loop in a tmux window (not a Claude or Hermes chat) shown in the Sessions list.
// Each one is set in mesh.local.json (never in code):
//   "paneAgents": [{ "window": "main:my-bot",            // tmux session:window name it runs in
//                    "name": "My Bot", "engine": "hermes", "model": "deepseek-v4-pro",   // shown on the card
//                    "log": "~/bots/my-bot/bot.log",      // optional: its log; recent lines show as the activity
//                    "cwd": "~/bots/my-bot", "busyWithin": 120,   // log written in the last N s = working
//                    "operator": true }]   // optional: a Hermes chat of the same name in cwd takes your commands for it
// View only: Mesh never types into it, interrupts, renames, moves, refreshes or stops it (watchOnly on the session,
// checked in main.js, handoff.js and session-refresh.js). Closing the window is left to whoever runs it.
const fs = require('fs'), path = require('path'), os = require('os');
const HOME = os.homedir();
const tilde = p => String(p || '').replace(/^~(?=\/|$)/, HOME);
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

module.exports = function createPaneAgents() {
  const list = () => {
    try { if (process.env.MESH_PANE_AGENTS_JSON) return JSON.parse(process.env.MESH_PANE_AGENTS_JSON) || []; } catch { return []; }   // QA instances
    return (require('./mesh-name').paneAgents || []).filter(a => a && a.window && a.name);
  };
  const tail = (f, n) => {           // the last n lines, from at most the last 16 KB
    try {
      const fd = fs.openSync(f, 'r'), size = fs.fstatSync(fd).size, len = Math.min(size, 16384), b = Buffer.alloc(len);
      fs.readSync(fd, b, 0, len, size - len); fs.closeSync(fd);
      return b.toString('utf8').split('\n').filter(l => l.trim()).slice(len < size ? 1 : 0).slice(-n);
    } catch { return []; }
  };
  const seen = {};                   // window -> first time Mesh saw it (when the log can't say)

  function sessions(paneList) {
    const out = [];
    for (const a of list()) {
      const p = paneList.find(x => x.title === a.window); if (!p) continue;
      const log = a.log ? tilde(a.log) : null; let mt = 0; try { mt = log ? fs.statSync(log).mtimeMs : 0; } catch { }
      const first = seen[a.window] || (seen[a.window] = Date.now());
      const busy = mt && Date.now() - mt < (+a.busyWithin || 120) * 1000;
      const lines = log ? tail(log, 40) : [];
      out.push({
        pid: p.pid, sessionId: 'agent-' + slug(a.window), cwd: tilde(a.cwd || (log ? path.dirname(log) : HOME)), kind: 'agent', engine: a.engine || undefined,
        model: a.model || a.engine || 'script', status: busy ? 'busy' : 'idle', pane: p.id, tty: p.tty, watchOnly: true, operator: !!a.operator,
        name: a.name, nameSource: 'user', startedAt: Math.min(first, mt || first), updatedAt: mt || first,
        agentLog: lines.map(l => { const m = /^(\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d)\s+(.*)$/.exec(l); const t = m ? Date.parse(m[1].replace(' ', 'T')) : NaN;
          return { t: isNaN(t) ? mt || Date.now() : t, kind: 'tool', text: (m ? m[2] : l).replace(/\s+/g, ' ').slice(0, 220) }; }),
      });
    }
    return out;
  }
  return { sessions, list };
};
