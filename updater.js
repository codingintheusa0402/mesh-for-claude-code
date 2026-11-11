// Seamless updates. install.sh leaves <userData>/update.json beside the running app; nobody quits anything by hand.
//   UI only (same mainSig): the window reloads in place from <userData>/hot/<commit>, after 30 quiet seconds.
//   Anything else: a quiet restart once you've been away 10 minutes. Claude sessions live in tmux, so they keep running.
// Never while you're typing anywhere (this Mac, the other Mac's mirror, the phone) or a session waits for you.
// The restart runs in a detached helper: if the new version doesn't come up within 60 s it puts the previous one back.
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const QUIET_RELOAD = 30, QUIET_RESTART = 600, EVERY = 60e3, STATE_MAX_AGE = 15 * 60e3;

function createUpdater({ app, powerMonitor, getWin, userData, sessions, inAppBusy, beforeQuit, log }) {
  const file = n => path.join(userData, n), read = n => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return null; } };
  const write = (n, o) => { try { fs.writeFileSync(file(n), JSON.stringify(o)); } catch { } };
  let build = { commit: 'dev', subject: '', mainSig: '' }; try { build = require('./build-info.json'); } catch { }
  const appPath = () => { const m = /^(.*?\.app)\//.exec(process.execPath); return m ? m[1] : null; };
  let lastInput = 0, running = build.commit, pending = false, hotRoot = null, busy = false;
  // The last run left running.json behind without clean:true and its process is gone: it crashed or was force-quit.
  (() => {
    const prev = read('running.json'); if (!prev || !prev.pid || prev.pid === process.pid || prev.clean) return;
    try { process.kill(prev.pid, 0); return; } catch { }
    const rec = { at: Date.now(), pid: prev.pid, commit: prev.commit, since: prev.at };
    try { fs.appendFileSync(file('exits.jsonl'), JSON.stringify(rec) + '\n'); } catch { }
    log(`previous Mesh (pid ${prev.pid}, ${prev.commit}) ended without a clean quit: crash, force quit or power loss (see Console / DiagnosticReports)`);
  })();
  const stamp = extra => write('running.json', { commit: running, base: build.commit, pid: process.pid, at: Date.now(), ...extra });

  const noteInput = () => { lastInput = Date.now(); };
  const quietFor = () => { let sys = 1e9; try { sys = powerMonitor.getSystemIdleTime(); } catch { } return Math.min(sys, (Date.now() - lastInput) / 1000); };
  function blocker(need) {
    if (quietFor() < need) return 'you are active';
    const w = sessions().filter(s => s.health === 'waiting' && s.status !== 'shell'); if (w.length) return `${w[0].name} is waiting for you`;
    return null;
  }

  function hotReload(u) {
    const w = getWin(); if (!w) return;
    busy = true; log(`hot reload to ${u.commit}`);
    w.webContents.send('update:save', 'hot');
    pending = { u, go: () => {
      hotRoot = u.hot; running = u.commit; pending = false; busy = false;
      write('running.json', { commit: running, base: build.commit, pid: process.pid, at: Date.now() });
      write('update-note.json', { to: u.commit, subject: u.subject, kind: 'reload', at: Date.now() });
      w.loadFile(path.join(u.hot, 'renderer', 'index.html'));
    } };
  }

  function helper(wanted, mode) {
    const p = appPath(); if (!p) return log('no app bundle: not restarting');
    const prev = path.join(userData, 'prev', path.basename(p)), sh = file('mesh-restart.sh');
    fs.writeFileSync(sh, `#!/bin/zsh
# Waits for Mesh to quit, opens it again, and puts the previous version back if the new one doesn't come up.
PID=$1 APP=$2 PREV=$3 WANT=$4 DATA=$5 MODE=$6
for i in {1..60}; do kill -0 $PID 2>/dev/null || break; sleep 0.5; done
kill -9 $PID 2>/dev/null; sleep 1
back() { [[ -d "$PREV" ]] || return 1; rsync -a --delete "$PREV/" "$APP/"; xattr -cr "$APP"; print -r -- "{\\"commit\\":\\"$WANT\\"}" > "$DATA/update-hold.json"; }
if [[ $MODE == rollback ]]; then back; open "$APP"; exit 0; fi
rm -f "$DATA/running.json"; open "$APP"
for i in {1..60}; do grep -q "\\"commit\\":\\"$WANT\\"" "$DATA/running.json" 2>/dev/null && exit 0; sleep 1; done
pkill -f "$APP/Contents/MacOS/" ; sleep 2; back && open "$APP"
osascript -e 'display notification "The new version did not start, so the previous one was put back." with title "Mesh update"'
`);
    spawn('/bin/zsh', [sh, String(process.pid), p, prev, wanted, userData, mode], { detached: true, stdio: 'ignore' }).unref();
    log(`${mode} toward ${wanted}`); beforeQuit(); app.quit();
  }

  function restart(u) {
    const w = getWin(); busy = true;
    write('update-note.json', { to: u.commit, subject: u.subject, kind: 'restart', from: running, at: Date.now() });
    if (!w) return helper(u.commit, 'restart');
    w.webContents.send('update:save', 'restart');
    pending = { u, go: () => helper(u.commit, 'restart') };
    setTimeout(() => { if (pending && pending.u === u) { const g = pending.go; pending = false; g(); } }, 4000);      // a stuck window doesn't hold it up
  }

  function check() {
    if (busy) return;
    const u = read('update.json'); if (!u || !u.commit || u.commit === running) return;
    const hold = read('update-hold.json'); if (hold && hold.commit === u.commit) return;
    const ui = u.mainSig && u.mainSig === build.mainSig && u.hot && fs.existsSync(path.join(u.hot, 'renderer', 'index.html'));
    const why = blocker(ui ? QUIET_RELOAD : QUIET_RESTART) || (inAppBusy() ? 'an in-app session is working or a session refresh is running' : null);
    if (why) { if (why !== check.why) log(`update ${u.commit} waits: ${why}`); check.why = why; return; }
    ui ? hotReload(u) : restart(u);
  }

  function start() {
    if (process.env.MESH_NO_UPDATE) return;
    setInterval(check, EVERY);                       // a slow fallback; install.sh writing update.json wakes it at once
    try { fs.watch(userData, (_e, f) => { if (f === 'update.json') setTimeout(check, 2000); }); } catch { }
  }
  // the window is up: this build works
  function ready() {
    const r = read('running.json');
    if (!r || r.commit !== running || r.pid !== process.pid || r.clean) stamp();                  // a new process always takes it over
  }
  function quitting() { const r = read('running.json'); if (r && r.pid === process.pid) stamp({ clean: true }); }
  function saved(state, terms) {
    write('update-state.json', { at: Date.now(), state });
    if (pending) { const g = pending.go; pending = false; if (terms) saved.terms = terms; g(); }
  }
  function handoff() {
    const s = read('update-state.json'), note = read('update-note.json'), terms = saved.terms || [];
    saved.terms = null; try { fs.unlinkSync(file('update-state.json')); fs.unlinkSync(file('update-note.json')); } catch { }
    return { state: s && Date.now() - s.at < STATE_MAX_AGE ? s.state : null, terms, note: note && note.to === running ? { ...note, canRollback: fs.existsSync(path.join(userData, 'prev')) } : null };
  }
  // the app menu's "Restart": now, whatever you are doing. Opens the installed app, so a waiting update applies too;
  // the window keeps its terminals and layout the same way an update restart does
  function restartNow() {
    if (busy) return;
    const u = read('update.json'), hold = read('update-hold.json');
    const next = u && u.commit && u.commit !== running && !(hold && hold.commit === u.commit) ? u : { commit: running, subject: 'restart' };
    restart(next);
  }
  return { restartNow, start, ready, quitting, noteInput, quietFor, saved, handoff, check, rollback: () => helper(running, 'rollback'), info: () => ({ ...build, running, hotRoot }), hotRoot: () => hotRoot, blocker };
}
module.exports = { createUpdater };
