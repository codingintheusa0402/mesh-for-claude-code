// Claude sessions that live in tmux panes (a machine can keep them in a tmux session, so they survive app restarts).
// They get the same live terminal as in-app sessions: the pane is streamed only while someone watches it
// (tmux pipe-pane → file → ptyBus 'data'), opened on a snapshot of its screen (capture-pane), typed into with
// send-keys and resized with resize-window. Ported from server/mesh-server.js (the old Windows server).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, execFileSync } = require('child_process');
const { StringDecoder } = require('string_decoder');

module.exports = function createPanes({ ptyBus }) {
  const BIN = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux'].find(p => fs.existsSync(p)) || 'tmux';
  const DIR = path.join(os.tmpdir(), 'mesh-panes');
  // an app started from the Dock has no locale: tmux then turns tabs (and any non-ASCII text) into '_' — always UTF-8
  const env = { ...process.env, LANG: 'en_US.UTF-8', LC_CTYPE: 'en_US.UTF-8' };
  const tmux = args => new Promise(res => execFile(BIN, args, { timeout: 10000, env }, (err, so) => res(err ? null : String(so))));
  const tmuxSync = args => { try { return execFileSync(BIN, args, { timeout: 10000, env }).toString(); } catch { return ''; } };
  // send-keys/load-buffer get a minimal environment: tmux counts the client's environment against its command size limit
  // (with the app's full environment a send-keys -H of 1000 bytes was already "command too long"). Never for new-session:
  // the server it may start would hand that bare environment to every session.
  const keyEnv = Object.fromEntries(['HOME', 'USER', 'LOGNAME', 'PATH', 'TMPDIR', 'TMUX_TMPDIR', 'LANG', 'LC_CTYPE'].filter(k => env[k] != null).map(k => [k, env[k]]));
  const keysSync = args => { try { return execFileSync(BIN, args, { timeout: 10000, env: keyEnv }).toString(); } catch { return ''; } };

  let panes = new Map();          // pane id (%N) -> { id, pid, tty, cols, rows, title }
  const streams = new Map();      // pane id -> { n, file, pos, dec, timer }

  async function refresh() {
    const out = await tmux(['list-panes', '-a', '-F', '#{pane_id}|#{pane_pid}|#{pane_tty}|#{pane_width}|#{pane_height}|#{session_name}:#{window_name}']);
    if (out == null) { if (panes.size) gone(new Map()); return; }   // no tmux server
    const m = new Map();
    for (const l of out.split('\n')) {
      const [id, pid, tty, w, h, ...rest] = l.split('|'); if (!id) continue;
      const title = rest.join('|');
      const p = { id, pid: +pid, tty, cols: +w || 120, rows: +h || 32, title };
      const o = panes.get(id);
      if (o && (o.cols !== p.cols || o.rows !== p.rows)) ptyBus.emit('resize', id, p.cols, p.rows);
      m.set(id, p);
    }
    gone(m);
  }
  function gone(m) {
    for (const id of streams.keys()) if (!m.has(id)) { ptyBus.emit('exit', id); stop(id); }
    panes = m;
  }

  // keystrokes, pastes, mouse reports: the exact bytes, as hex, in ONE send-keys so the app reads them in one go.
  // (2026-10-26: sending control bytes one by one let a lone Esc reach Claude Code ~10 ms before the rest — it took
  // it as the Esc key, which broke ⌘V pastes (\e[200~ … \e[201~) and mouse-drag selection/copy from the other Mac)
  // (2026-11-09: tmux refuses a send-keys -H over ~1000 bytes (less with a big environment) with "command too long", so every
  // paste over ~1.4 KB was dropped (measured from the app: 900 bytes ok, 1000 too long). Pastes now go through a tmux buffer: one write of the whole text, any size.)
  const PASTE = /^\x1b\[200~([\s\S]*)\x1b\[201~$/;
  function write(id, data) {
    const s = String(data || ''); if (!s || !panes.has(id)) return;
    const m = PASTE.exec(s);
    if (m && m[1].length > 200) {
      // the viewer's xterm wrapped it in paste markers: hand tmux the bare text and let -p add the markers back
      // (only when the app turned bracketed paste on). paste-buffer writes the buffer in one go; -r keeps newlines as they are
      const buf = 'mesh-paste-' + id.replace(/\W/g, '');
      try {
        execFileSync(BIN, ['load-buffer', '-b', buf, '-'], { input: m[1], timeout: 10000, env: keyEnv });
        execFileSync(BIN, ['paste-buffer', '-d', '-r', '-p', '-b', buf, '-t', id], { timeout: 10000, env: keyEnv });
        return;
      } catch { }                                     // tmux without paste-buffer -p: fall back to keys below
    }
    // keystrokes and short typed bursts: the exact bytes, in chunks small enough for one tmux command, never cut
    // inside an escape sequence (a lone Esc would reach the app as the Esc key)
    const b = Buffer.from(s, 'utf8');
    for (let i = 0; i < b.length;) {
      let end = Math.min(i + 700, b.length);
      if (end < b.length) { const e = b.lastIndexOf(0x1b, end - 1); if (e > i && end - e < 32) end = e; }
      while (end < b.length && end > i + 1 && (b[end] & 0xc0) === 0x80) end--;          // nor inside a UTF-8 character
      keysSync(['send-keys', '-t', id, '-H', ...[...b.subarray(i, end)].map(x => x.toString(16).padStart(2, '0'))]);
      i = end;
    }
  }

  // what the pane shows now: scrollback, then exactly one screen, then the cursor where tmux has it
  function snapshot(id) {
    const p = panes.get(id); if (!p) return '';
    const hist = tmuxSync(['capture-pane', '-p', '-e', '-t', id, '-S', '-2000', '-E', '-1']).replace(/\n$/, '');
    const screen = tmuxSync(['capture-pane', '-p', '-e', '-t', id]).replace(/\n$/, '').split('\n');
    while (screen.length < p.rows) screen.push('');
    const [cx, cy] = tmuxSync(['display', '-p', '-t', id, '#{cursor_x} #{cursor_y}']).trim().split(' ').map(Number);
    // capture-pane carries no terminal modes. Claude Code, Hermes and zsh all turn bracketed paste on at start, and
    // without it the viewer sends a paste as typed keys: an image path then stays a raw path instead of [Image #n]
    return '\x1b[?2004h' + (hist ? hist.split('\n').join('\r\n') + '\r\n' : '') + screen.slice(-p.rows).join('\x1b[0m\r\n')
      + `\x1b[0m\x1b[${(cy || 0) + 1};${(cx || 0) + 1}H`;
  }

  const paneFile = id => path.join(DIR, id.replace(/[^\w]/g, '_') + '.raw');
  async function open(id) {
    let s = streams.get(id);
    if (s) { s.n++; return; }
    fs.mkdirSync(DIR, { recursive: true });
    const file = paneFile(id); try { fs.unlinkSync(file); } catch { }
    fs.writeFileSync(file, '');
    s = { n: 1, file, pos: 0, dec: new StringDecoder('utf8'), timer: null };
    streams.set(id, s);
    await tmux(['pipe-pane', '-t', id, `cat >> '${file}'`]);
    s.timer = setInterval(() => {
      let st; try { st = fs.statSync(file); } catch { return; }
      if (st.size <= s.pos) return;
      const fd = fs.openSync(file, 'r');
      try {
        const b = Buffer.alloc(Math.min(st.size - s.pos, 1 << 20)); const n = fs.readSync(fd, b, 0, b.length, s.pos); s.pos += n;
        const text = s.dec.write(b.subarray(0, n)); if (text) ptyBus.emit('data', id, text);
      } finally { fs.closeSync(fd); }
      if (s.pos > 64 << 20) { s.pos = 0; fs.truncateSync(file, 0); }     // long watch: don't let the file grow forever
    }, 80);
  }
  function close(id) { const s = streams.get(id); if (s && --s.n <= 0) stop(id); }
  function stop(id) {
    const s = streams.get(id); if (!s) return;
    clearInterval(s.timer); streams.delete(id);
    tmuxSync(['pipe-pane', '-t', id]);                                      // no command = stop piping
    try { fs.unlinkSync(s.file); } catch { }
  }
  function resize(id, c, r) {
    const p = panes.get(id); if (!p) return false;
    if (c !== p.cols || r !== p.rows) { tmuxSync(['resize-window', '-t', id, '-x', String(c), '-y', String(r)]); p.cols = c; p.rows = r; }
    return true;
  }
  // a crash while streaming would leave pipe-pane writing forever → clean up at start
  try { for (const f of fs.readdirSync(DIR)) { tmuxSync(['pipe-pane', '-t', '%' + f.replace(/^_/, '').replace(/\.raw$/, '')]); fs.unlinkSync(path.join(DIR, f)); } } catch { }

  // start a program in its own window of a detached tmux session: it keeps running when the app quits
  const available = () => fs.existsSync(BIN);
  async function spawnPane({ session, cwd, title, shell, args, env: extra, cols, rows }) {
    const has = tmuxSync(['has-session', '-t', session]) !== '' || (() => { try { execFileSync(BIN, ['has-session', '-t', session], { env, stdio: 'ignore' }); return true; } catch { return false; } })();
    const E = Object.entries(extra || {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]), name = String(title || 'session').replace(/[.:]/g, '-').slice(0, 40);
    const fmt = ['-P', '-F', '#{pane_id}', '-c', cwd, '-n', name, ...E];
    const out = has ? tmuxSync(['new-window', '-d', '-t', session + ':', ...fmt, shell, ...args])
      : tmuxSync(['new-session', '-d', '-s', session, '-x', String(cols || 120), '-y', String(rows || 32), ...fmt, shell, ...args]);
    if (!has) for (const o of [['status', 'off'], ['default-terminal', 'xterm-256color'], ['history-limit', '50000'], ['window-size', 'manual']]) tmuxSync(['set-option', '-t', session, ...o]);
    const id = out.trim(); if (!id) return null;
    tmuxSync(['resize-window', '-t', id, '-x', String(cols || 120), '-y', String(rows || 32)]);
    await refresh(); return panes.get(id) || null;
  }
  return {
    refresh, write, snapshot, open, close, resize, available, spawnPane,
    has: id => panes.has(id),
    list: () => [...panes.values()],
    // phone-server.js wants pty-like entries: { proc: { cols, rows, pid, write }, buf }
    proc: id => { const p = panes.get(id); return p && { proc: { cols: p.cols, rows: p.rows, pid: p.pid, write: d => write(id, d) }, get buf() { return snapshot(id); } }; },
    stopAll: () => { for (const id of [...streams.keys()]) stop(id); },
  };
};
