// What the New session dialog offers when a session runs on Ollama instead of Claude: the models on this Mac, and Ollama's
// cloud models. Never signs in or touches a key: cloud models need `ollama signin`, which you run yourself.
const fs = require('fs'), path = require('path'), os = require('os'), { execFile } = require('child_process');
const API = 'http://127.0.0.1:11434', CLOUD = 'https://ollama.com/api/tags';
const installed = () => ['/Applications/Ollama.app', path.join(os.homedir(), 'Applications', 'Ollama.app')].some(p => fs.existsSync(p)) || fs.existsSync(path.join(os.homedir(), '.local', 'bin', 'ollama')) || fs.existsSync('/usr/local/bin/ollama');
const get = async (url, opt) => { const r = await fetch(url, { signal: AbortSignal.timeout(4000), ...opt }); return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) }; };
const cloudName = n => (n.includes(':') ? n + '-cloud' : n + ':cloud');      // the CLI's name for a cloud model
let cloudList = [], cloudAt = 0;

async function status() {
  if (!installed()) return { installed: false, running: false, local: [], cloud: [] };
  let tags = await get(API + '/api/tags').catch(() => null);
  if (!tags && process.platform === 'darwin') {                               // installed but stopped: start it, hidden
    await new Promise(res => execFile('/usr/bin/open', ['-a', 'Ollama', '--args', 'hidden'], () => res()));
    for (let i = 0; i < 6 && !tags; i++) { await new Promise(r => setTimeout(r, 700)); tags = await get(API + '/api/tags').catch(() => null); }
  }
  if (!tags) return { installed: true, running: false, local: [], cloud: [] };
  if (Date.now() - cloudAt > 3600e3) {
    const r = await get(CLOUD).catch(() => null);
    if (r && r.ok) { cloudList = (r.json.models || []).map(m => cloudName(m.name)).sort(); cloudAt = Date.now(); }
  }
  const all = (tags.json.models || []).map(m => m.name), me = await get(API + '/api/me', { method: 'POST' }).catch(() => null);
  return { installed: true, running: true, signedIn: !!(me && me.ok), local: all.filter(n => !/[:-]cloud$/.test(n)).sort(), cloud: cloudList };
}
// What is left on the Ollama account, through the signed-in app on this Mac (no key needed). Reading it never starts Ollama.
// Ollama bills in dollars, so tokens left is an estimate from what its tokens have cost so far.
async function credits() {
  if (!installed()) return { state: 'none' };
  const b = await get(API + '/api/balance').catch(() => null);
  if (!b) return { state: 'stopped' };
  if (b.status === 401) return { state: 'signedOut' };
  if (!b.ok) return { state: 'failed', error: b.json.error || `HTTP ${b.status}` };
  const inc = b.json.included || {}, bought = (b.json.purchased || {}).balance_usd || 0, left = (inc.balance_usd || 0) + bought;
  const spent = async range => ((await get(API + '/api/usage?range=' + range).catch(() => null)) || { json: {} }).json.totals || null;
  const [month, day] = await Promise.all([spent('30d'), spent('24h')]);
  const perToken = month && month.usage_usd > 0 ? month.usage_usd / ((month.input_tokens || 0) + (month.output_tokens || 0)) : 0;
  return { state: 'ok', left, included: inc.balance_usd, allowance: inc.allowance_usd, bought, resetsAt: inc.period && inc.period.until ? Date.parse(inc.period.until) : 0,
    tokensLeft: perToken ? left / perToken : 0, perDay: day ? day.usage_usd || 0 : null, weeklyLeft: inc.weekly ? inc.weekly.remaining_percent : null, sessionLeft: inc.session ? inc.session.remaining_percent : null };
}
const hermesInstalled = () => ['.local/bin/hermes', '.hermes/hermes-agent/venv/bin/hermes'].some(p => fs.existsSync(path.join(os.homedir(), p))) || fs.existsSync('/opt/homebrew/bin/hermes') || fs.existsSync('/usr/local/bin/hermes');
module.exports = { status, credits, hermesInstalled };
