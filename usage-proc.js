// The token usage database's own low-priority process (usage-core.js): reading gigabytes of logs never touches the window.
const os = require('os');
const { openUsage } = require('./usage-core');
let u = null;
try { os.setPriority(process.pid, 10); } catch { }
process.parentPort.on('message', async ({ data: m }) => {
  const reply = (r, err) => process.parentPort.postMessage({ id: m.id, r, err });
  try {
    if (m.op === 'open') { u = openUsage(m.args); return reply(true); }
    reply(await u[m.op](...(m.args || [])));
  } catch (e) { reply(null, String(e && e.message || e)); }
});
