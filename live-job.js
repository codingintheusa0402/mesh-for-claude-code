// What a session's job is doing right now (2026-11-01) — for the Live panel (renderer/live-panels.js):
//   · running / recent tool calls (shell commands, file edits, MCP calls) from the transcript's end
//   · live output of its background commands (Claude Code writes them to tasks/<id>.output files)
//   · the processes it started (children of its claude process, MCP servers left out), with CPU and run time
//   · the script a running command executes (its source, so you can see the code that's running)
//   · whether it drives a Chrome (DevTools port 9222 / 9223) and which site, and which Google Sheet / Slides / Doc it
//     writes to — the Live panel then shows that browser tab or document instead of code
// Cheap: the transcript is re-read only when it grew; ps runs only when the Live panel asks (every 2 s while the
// Code view is on screen, rarely otherwise).
const fs = require('fs'), path = require('path'), { execFile } = require('child_process');

const TAIL = 3 * 1024 * 1024;
const MCP_PROC = /\bmcp\b|mcp-for-blender|rea-agents|npm exec|uvx|caffeinate/;
const DOC_URL = /docs\.google\.com\/(spreadsheets|presentation|document)\/d\/([A-Za-z0-9_-]{25,})/g;
const DOC_ID = /\b(spreadsheetId|presentationId|documentId|SPREADSHEET_ID|PRESENTATION_ID|DECK_ID|SHEET_ID|DOC_ID)\b['"]?\s*[:=]\s*['"]([A-Za-z0-9_-]{25,})['"]/g;
// which Chrome (DevTools port) a job drives: mesh.local.json "chromePorts": [{ "port": 9222, "match": "regex" }, …];
// default: anything that looks like browser automation → Chrome's usual debugging port 9222
const CHROME = ((() => { try { return require('./mesh-name').chromePorts; } catch { return null; } })()
  || [{ port: 9222, match: 'chrome|playwright|puppeteer|selenium|scrap|devtools|mcp__claude-in-chrome|mcp__playwright' }])
  .map(r => { try { return { port: +r.port, re: new RegExp(r.match, 'i') }; } catch { return null; } }).filter(r => r && r.port);
const RANGE = /['"]((?:'[^']+'|[A-Za-z0-9_ ]+)![A-Z]{1,3}\d*(?::[A-Z]{1,3}\d*)?)['"]/;

function createLiveJobs({ findTranscript, home, tmpRoot }) {
  const cache = new Map(), scripts = new Map();
  const short = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => b && (b.type === 'text' ? b.text : '')).join('\n') : '';
  function parse(file) {
    let st; try { st = fs.statSync(file); } catch { return null; }
    const c = cache.get(file); if (c && c.size === st.size) return c.v;
    const start = Math.max(0, st.size - TAIL), len = st.size - start, buf = Buffer.alloc(len);
    const fd = fs.openSync(file, 'r'); try { fs.readSync(fd, buf, 0, len, start); } finally { fs.closeSync(fd); }
    const lines = buf.toString('utf8').split('\n'); if (start > 0) lines.shift();
    const calls = [], byId = new Map();
    for (const l of lines) {
      if (l.indexOf('tool_use') < 0 && l.indexOf('tool_result') < 0) continue;
      let j; try { j = JSON.parse(l); } catch { continue; }
      const t = Date.parse(j.timestamp || '') || 0, content = j.message && Array.isArray(j.message.content) ? j.message.content : [];
      for (const b of content) {
        if (b.type === 'tool_use') {
          const inp = b.input || {}, call = { id: b.id, name: b.name, t, state: 'running',
            cmd: typeof inp.command === 'string' ? inp.command : '', file: inp.file_path || inp.notebook_path || '', bg: !!inp.run_in_background,
            text: JSON.stringify(inp).slice(0, 4000) };
          calls.push(call); byId.set(b.id, call);
        } else if (b.type === 'tool_result' && byId.has(b.tool_use_id)) {
          const call = byId.get(b.tool_use_id), r = textOf(b.content);
          call.state = b.is_error ? 'error' : 'done'; call.done = t; call.result = r.slice(0, 4000);
          const m = /Output is being written to: (\S+\.output)/.exec(r); if (m) call.outFile = m[1];
        }
      }
    }
    const v = calls.slice(-60);
    cache.set(file, { size: st.size, v }); return v;
  }
  const ps = () => new Promise(res => execFile('/bin/ps', ['-axo', 'pid=,ppid=,pcpu=,etime=,command='], { maxBuffer: 4e6 }, (e, out) => res(e ? '' : out)));
  async function procsUnder(pid) {
    if (!pid) return [];
    const rows = (await ps()).split('\n').map(l => { const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.*)$/.exec(l); return m && { pid: +m[1], ppid: +m[2], cpu: +m[3], etime: m[4], cmd: m[5] }; }).filter(Boolean);
    const kids = new Map(); for (const r of rows) { if (!kids.has(r.ppid)) kids.set(r.ppid, []); kids.get(r.ppid).push(r); }
    const out = [], walk = (p, d) => { for (const r of kids.get(p) || []) { if (MCP_PROC.test(r.cmd)) continue; out.push({ ...r, depth: d, cmd: short(r.cmd.replace(home, '~'), 300) }); if (out.length < 40) walk(r.pid, d + 1); } };
    walk(+pid, 0); return out;
  }
  function tail(file, n = 6000) {
    try { const st = fs.statSync(file), len = Math.min(n, st.size), b = Buffer.alloc(len), fd = fs.openSync(file, 'r'); try { fs.readSync(fd, b, 0, len, st.size - len); } finally { fs.closeSync(fd); }
      return { text: b.toString('utf8').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''), mtime: st.mtimeMs, size: st.size }; } catch { return null; }
  }
  function scriptOf(cmds, cwd) {
    for (const c of cmds) {
      const m = /(?:^|[\s'"])((?:~|\/)[^\s'"]+\.(?:py|js|mjs|cjs|ts|sh|rb|gs|swift))(?=$|[\s'"])/.exec(c) || /(?:python3?|node|bash|zsh|sh)\s+([^\s'"]+\.(?:py|js|mjs|cjs|ts|sh|rb))/.exec(c);
      if (!m) continue;
      let p = m[1].startsWith('~') ? home + m[1].slice(1) : m[1]; if (!p.startsWith('/') && cwd) p = path.join(cwd, p);
      if (!p.startsWith(home) && !p.startsWith('/private/tmp') && !p.startsWith('/tmp')) continue;
      if (/\/\.claude\/(shell-snapshots|projects)\//.test(p)) continue;                 // Claude Code's own shell setup, not the job
      try {
        const st = fs.statSync(p); if (!st.isFile() || st.size > 2e6) continue;
        const k = scripts.get(p); if (k && k.mtime === st.mtimeMs) return k.v;
        const v = { path: p.replace(home, '~'), text: fs.readFileSync(p, 'utf8').split('\n').slice(0, 400).join('\n'), lang: path.extname(p).slice(1) };
        scripts.set(p, { mtime: st.mtimeMs, v }); return v;
      } catch { }
    }
    return null;
  }
  function docOf(calls) {
    let best = null;
    for (const c of calls) {
      const txt = c.text + '\n' + (c.result || '');
      for (const m of txt.matchAll(DOC_URL)) best = { kind: m[1], id: m[2], t: c.t, call: c };
      for (const m of txt.matchAll(DOC_ID)) best = { kind: /PRESENTATION|DECK|presentation/.test(m[1]) ? 'presentation' : /doc/i.test(m[1]) && !/sheet/i.test(m[1]) ? 'document' : 'spreadsheets', id: m[2], t: c.t, call: c };
      if (/mcp__claude_ai_Google_Drive__/.test(c.name)) { const m = /"(?:fileId|file_id|id)"\s*:\s*"([A-Za-z0-9_-]{25,})"/.exec(c.text); if (m) best = { kind: 'drive', id: m[1], t: c.t, call: c }; }
    }
    if (!best) return null;
    const range = RANGE.exec(best.call.text); const url = best.kind === 'drive' ? `https://drive.google.com/open?id=${best.id}` : `https://docs.google.com/${best.kind}/d/${best.id}/edit`;
    return { kind: best.kind, id: best.id, t: best.t, url, range: range ? range[1] : null };
  }
  function browserOf(calls) {
    let port = null, hosts = [], t = 0;
    for (const c of calls) {
      const txt = c.text;
      const ex = /(?:remote-debugging-port[= ]|localhost:|127\.0\.0\.1:)(9\d{3})\b/.exec(txt);   // a port the job names itself
      const hit = ex ? +ex[1] : (CHROME.find(r => r.re.test(txt)) || {}).port;
      if (hit) { port = hit; t = c.t; }
      for (const m of txt.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) if (!/googleapis|github|anthropic|claude\.ai|docs\.google|localhost|127\.0\.0\.1/.test(m[1])) hosts.push(m[1].toLowerCase());
    }
    return port ? { port, t, hosts: [...new Set(hosts.reverse())].slice(0, 6) } : null;
  }
  // what the newest action is about → the view the Live panel opens on
  function focusOf(calls) {
    const c = calls.slice().reverse().find(x => x.t > Date.now() - 15 * 60e3); if (!c) return 'calls';
    const txt = c.text + (c.result || '');
    if (/^mcp__(claude-in-chrome|playwright|chrome)/.test(c.name) || /remote-debugging-port|playwright|puppeteer|selenium|scrap/i.test(c.text) || CHROME.some(r => r.re.test(c.text))) return 'browser';
    if (DOC_URL.test(txt) || /spreadsheetId|presentationId|documentId|mcp__claude_ai_Google_Drive__|gws_shim|batchUpdate/.test(txt)) { DOC_URL.lastIndex = 0; return 'doc'; }
    DOC_URL.lastIndex = 0;
    if (/^mcp__blender/.test(c.name)) return 'window';
    if (c.name === 'Bash' || /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(c.name)) return 'code';
    return 'calls';
  }
  // → everything the Live panel shows for one session
  async function job(s, opts = {}) {
    const f = findTranscript(s.sid), calls = (f && parse(f)) || [];
    const recentWin = Date.now() - 30 * 60e3, recent = calls.filter(c => c.t > recentWin);
    const running = calls.filter(c => c.state === 'running' && c.t > Date.now() - 6 * 3600e3);
    // background commands: their output files (also ones started earlier that are still being written)
    const outs = [];
    for (const c of calls.slice().reverse()) if (c.outFile && outs.length < 3) { const tl = tail(c.outFile); if (tl && Date.now() - tl.mtime < 20 * 60e3) outs.push({ label: short(c.cmd || c.name, 140), ...tl, file: c.outFile.replace(home, '~') }); }
    const procs = opts.procs ? await procsUnder(s.pid) : [];
    const cmds = [...running.map(c => c.cmd), ...procs.map(p => p.cmd.replace(/^~/, home)), ...recent.slice(-6).map(c => c.cmd)].filter(Boolean);
    const lastEdit = calls.slice().reverse().find(c => /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(c.name) && c.file);
    return {
      sid: s.sid, name: s.name, health: s.health,
      running: running.slice(-6).map(c => ({ name: c.name, cmd: short(c.cmd, 600), file: c.file, t: c.t, bg: c.bg })),
      recent: calls.slice(-14).reverse().map(c => ({ id: c.id, name: c.name, cmd: short(c.cmd, 300), file: c.file, t: c.t, state: c.state, result: short(c.result, 400) })),
      outputs: outs, procs,
      script: opts.procs ? scriptOf(cmds, s.cwd) : null,
      edit: lastEdit ? { file: lastEdit.file.replace(home, '~'), t: lastEdit.t, text: short(lastEdit.text, 3000) } : null,
      browser: browserOf(recent),
      doc: docOf(recent.length ? recent : calls.slice(-12)),
      focus: focusOf(calls),
    };
  }
  return { job };
}
module.exports = { createLiveJobs };
