// Smoke test for a packaged build (CI): start the app with a throwaway data folder, wait for the main window to render,
// check the header is there, save a screenshot, quit. Fails if the window never renders or the main process crashes.
//   node scripts/smoke.js <path to the app executable> <screenshot.png>
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const [exe, shot = 'smoke.png'] = process.argv.slice(2);
const PORT = 9555, data = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-smoke-'));
const env = { ...process.env, MESH_QA: '1', MESH_NO_UPDATE: '1', MESH_USERDATA: data, MESH_NO_FSGUARD: '1' };
// SMOKE_APP=<source folder> runs a source checkout with the Electron binary given as <exe>
const app = spawn(exe, [...(process.env.SMOKE_APP ? [process.env.SMOKE_APP] : []), `--remote-debugging-port=${PORT}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '', exited = null;
app.stdout.on('data', d => { log += d; process.stdout.write(d); });
app.stderr.on('data', d => { log += d; process.stderr.write(d); });
app.on('exit', c => { exited = c; });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = m => { console.error('SMOKE FAIL:', m); try { app.kill(); } catch { } process.exit(1); };

(async () => {
  let page;
  for (let i = 0; i < 90 && !page; i++) {
    if (exited !== null) fail('app exited with code ' + exited);
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === 'page' && /renderer\/index\.html/.test(t.url)); } catch { }
    if (!page) await sleep(1000);
  }
  if (!page) fail('main window never appeared');
  const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const wait = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (wait[m.id]) wait[m.id](m); };
  await new Promise(r => ws.onopen = r);
  const call = (method, params = {}) => new Promise(r => { const i = ++id; wait[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async x => (await call('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.result.value;
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) { ok = await ev(`/New/.test(document.body.innerText) && !!document.querySelector('canvas')`); if (!ok) await sleep(1000); }
  // a built-in terminal works: open a shell the way "+ New" does, run a command, read its output back
  const term = await ev(`new Promise(res => {
    let out = '', id = null; const t = setTimeout(() => res({ ok: false, id, out: out.slice(-300) }), 30000);
    // the typed command never contains the digits; only the shell's own output does
    const cmd = /Win/.test(navigator.platform) ? 'Write-Output ("MESH_SMOKE_" + (6*7))\\r' : 'echo MESH_SMOKE_$((6*7))\\r';
    window.api.pty.onData((i, d) => { if (i !== id) return; out += d; if (/MESH_SMOKE_42/.test(out)) { clearTimeout(t); res({ ok: true, id, shell: cmd.split(' ')[0] }); } });
    window.api.pty.spawn({ kind: 'shell', title: 'smoke', cols: 100, rows: 30 }).then(p => {
      id = p && p.id; if (!id) { clearTimeout(t); return res({ ok: false, err: 'no terminal id', p }); }
      setTimeout(() => window.api.pty.write(id, cmd), 3000);
      setTimeout(() => window.api.pty.write(id, cmd), 9000);
    });
  })`);
  console.log('terminal:', JSON.stringify(term));
  if (!term || !term.ok) fail('built-in terminal did not run a command');
  await sleep(4000);
  const r = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(shot, Buffer.from(r.result.data, 'base64'));
  const info = await ev(`JSON.stringify({ title: document.title, header: document.body.innerText.slice(0, 160) })`);
  console.log('window:', info);
  ws.close(); app.kill();
  if (!ok) fail('header or canvas missing');
  if (/Uncaught|FATAL|Cannot find module/i.test(log)) fail('errors in the app log');
  console.log('SMOKE OK, screenshot', shot);
  process.exit(0);
})().catch(e => fail(e.stack || e));
