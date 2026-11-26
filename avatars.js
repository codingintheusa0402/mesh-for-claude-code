// Profile pictures for sessions (2026-11-26). Pure files + ffmpeg, no Claude calls.
//   source   a folder of pictures and GIFs (cfg.dir, default ~/.mesh/avatars). A team can fill it from a shared cloud
//            folder with its own sync command (cfg.syncCmd, run every 15 min by the team's job and by "Sync now").
//   cache    <dir>/.cache: each picture cropped to a centred square (a 16:9 GIF loses its sides and corner marks) at
//            256 and 512 px; GIFs stay animated (ffmpeg palettegen/paletteuse). index.json there maps file → version.
//   picks    cfg.store (default ~/.mesh/avatars.json): { "<session name>": { file, t, by } } — keyed by the session's
//            NAME, so a handoff, refresh or new generation keeps its picture. file null = back to the initial letter.
//            Merged by name, last write wins (t), so a pick on either Mac survives: the file is re-read when it changes,
//            the peer's map comes in with every peer poll (peer.js), and a pick is pushed to the peer at once.
//   images   the app reads them through the meshav:// protocol (main.js), the phone through /api/avatar; a picture that
//            exists only on the other Mac is fetched from it once and kept in the cache.
// Env overrides for QA: MESH_AVATARS_DIR, MESH_AVATARS_JSON, MESH_AVATARS_SYNC.
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { execFile } = require('child_process');

const HOME = os.homedir();
const tilde = p => String(p || '').replace(/^~(?=\/|$)/, HOME);
const IMG = /\.(png|jpe?g|gif|webp)$/i;
const SIZES = [256, 512];
const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) || 'ffmpeg';

function createAvatars({ cfg = {}, machine = os.hostname(), peer = () => null, onChange = () => { } } = {}) {
  const dir = tilde(process.env.MESH_AVATARS_DIR || cfg.dir || '~/.mesh/avatars');
  const store = tilde(process.env.MESH_AVATARS_JSON || cfg.store || '~/.mesh/avatars.json');
  const syncCmd = process.env.MESH_AVATARS_SYNC != null ? process.env.MESH_AVATARS_SYNC : (cfg.syncCmd || '');
  const cache = path.join(dir, '.cache'), indexFile = path.join(cache, 'index.json');
  let picks = {}, index = {}, ownWrite = 0, changeT = null;
  try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch { }
  const changed = () => { clearTimeout(changeT); changeT = setTimeout(() => onChange(), 150); };

  // ---------- picks (avatars.json) ----------
  const newer = (a, b) => !b || (a.t || 0) > (b.t || 0) || ((a.t || 0) === (b.t || 0) && String(a.file || '') > String(b.file || ''));
  function merge(entries) {
    let n = 0;
    for (const [name, e] of Object.entries(entries || {})) {
      if (!name || !e || typeof e !== 'object' || typeof e.t !== 'number') continue;
      const v = { file: e.file ? path.basename(String(e.file)) : null, t: e.t, by: String(e.by || '').slice(0, 40) };
      if (newer(v, picks[name]) && !(picks[name] && picks[name].t === v.t && picks[name].file === v.file)) { picks[name] = v; n++; }
    }
    return n;
  }
  function readStore() { try { return JSON.parse(fs.readFileSync(store, 'utf8')); } catch { return {}; } }
  function save() {
    // re-read first: a pick written by the other Mac's sync in the meantime is merged in, never overwritten
    merge(readStore());
    try {
      fs.mkdirSync(path.dirname(store), { recursive: true });
      const tmp = store + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(picks, null, 1)); fs.renameSync(tmp, store); ownWrite = Date.now();
    } catch (e) { console.warn('[avatars] save', e.message); }
  }
  merge(readStore());
  // the file changed (the other Mac's job, a hand edit): take it in; if we hold newer picks, write them back
  let lastM = 0;
  setInterval(() => {
    let m = 0; try { m = fs.statSync(store).mtimeMs; } catch { }
    if (!m || m === lastM) return; lastM = m;
    if (Date.now() - ownWrite < 1500) return;
    const disk = readStore(), n = merge(disk);
    if (Object.entries(picks).some(([k, v]) => newer(v, disk[k]) && !(disk[k] && disk[k].t === v.t))) save();
    if (n) { warm(); changed(); }
  }, 3000).unref();

  function set(name, file) {
    name = String(name || '').trim(); if (!name) return { ok: false, err: 'no session name' };
    file = file ? path.basename(String(file)) : null;
    if (file && !IMG.test(file)) return { ok: false, err: 'not a picture' };
    picks[name] = { file, t: Date.now(), by: machine };
    save(); changed();
    if (file) ensure(file).then(changed).catch(() => { });
    const p = peer(); if (p && p.online()) p.forward('POST', '/api/avatars', { merge: { [name]: picks[name] } }).catch(() => { });
    return { ok: true };
  }
  // from the other Mac (its poll snapshot or its push)
  function mergeRemote(entries) {
    const n = merge(entries); if (!n) return 0;
    save(); warm(); changed(); return n;
  }

  // ---------- the cropped copies ----------
  const sigOf = f => { try { const st = fs.statSync(path.join(dir, f)); return st.isFile() ? `${st.size}-${Math.round(st.mtimeMs)}` : null; } catch { return null; } };
  const slug = f => f.replace(/[^\w.-]+/g, '_').slice(0, 60) + '-' + crypto.createHash('sha1').update(f).digest('hex').slice(0, 8);
  const outOf = (f, size, ext) => path.join(cache, `${slug(f)}.${size}.${ext}`);
  const saveIndex = () => { try { fs.mkdirSync(cache, { recursive: true }); fs.writeFileSync(indexFile, JSON.stringify(index)); } catch { } };
  const ready = f => { const e = index[f]; return !!(e && SIZES.every(s => fs.existsSync(outOf(f, s, e.ext)))); };
  function crop(f) {
    const src = path.join(dir, f), gif = /\.gif$/i.test(f), ext = gif ? 'gif' : 'png';
    fs.mkdirSync(cache, { recursive: true });
    const sq = "crop='min(iw,ih)':'min(iw,ih)'";        // centred square: the sides of a 16:9 frame (and its corner marks) go
    const one = size => new Promise((res, rej) => {
      const out = outOf(f, size, ext), tmp = out + '.tmp.' + ext;
      const args = gif
        ? ['-y', '-v', 'error', '-i', src, '-filter_complex', `[0:v]${sq},scale=${size}:${size}:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`, '-loop', '0', tmp]
        : ['-y', '-v', 'error', '-i', src, '-vf', `${sq},scale=${size}:${size}:flags=lanczos`, '-frames:v', '1', tmp];
      execFile(FFMPEG, args, { timeout: 120e3 }, err => { if (err) { try { fs.unlinkSync(tmp); } catch { } return rej(err); } fs.renameSync(tmp, out); res(); });
    });
    return SIZES.reduce((p, s) => p.then(() => one(s)), Promise.resolve()).then(() => {
      const sig = sigOf(f);
      index[f] = { sig, ext, v: crypto.createHash('sha1').update(f + sig).digest('hex').slice(0, 10), from: 'local' }; saveIndex();
    });
  }
  // a picture that lives only on the other Mac: fetch its two cropped copies once
  async function fromPeer(f) {
    const p = peer(); if (!p || !p.online() || !p.fetchRaw) return false;
    let ext = null;
    for (const s of SIZES) {
      const r = await p.fetchRaw('/api/avatar', { f, s: String(s) }).catch(() => null);
      if (!r || r.status !== 200 || !r.buf.length) return false;
      ext = /gif/.test(r.type) ? 'gif' : 'png';
      fs.mkdirSync(cache, { recursive: true }); fs.writeFileSync(outOf(f, s, ext), r.buf);
    }
    index[f] = { sig: 'peer', ext, v: crypto.createHash('sha1').update(f + 'peer' + Date.now()).digest('hex').slice(0, 10), from: 'peer' }; saveIndex();
    return true;
  }
  const busy = new Map();
  function ensure(f) {
    f = path.basename(String(f || ''));
    if (!IMG.test(f)) return Promise.resolve(null);
    const sig = sigOf(f), e = index[f];
    if (e && ready(f) && (sig ? e.sig === sig : true)) return Promise.resolve(e);
    if (busy.has(f)) return busy.get(f);
    // one ffmpeg at a time: the queue is the chain of busy promises
    const prev = [...busy.values()].pop() || Promise.resolve();
    const job = prev.catch(() => { }).then(() => sig ? crop(f) : fromPeer(f)).then(() => index[f] && ready(f) ? index[f] : null)
      .catch(err => { console.warn('[avatars] crop', f, String(err.message || err).slice(0, 200)); return null; })
      .finally(() => { busy.delete(f); });
    busy.set(f, job); return job;
  }
  // crop what the picks need and what the folder holds, in the background
  function warm() {
    for (const e of Object.values(picks)) if (e.file && !ready(e.file)) ensure(e.file).then(r => r && changed());
    for (const x of files()) if (!x.v) ensure(x.file).then(r => r && changed());
  }

  function files() {
    let names = []; try { names = fs.readdirSync(dir).filter(n => !n.startsWith('.') && IMG.test(n)); } catch { }
    return names.map(file => { const st = fs.statSync(path.join(dir, file)), e = index[file], ok = e && e.sig === `${st.size}-${Math.round(st.mtimeMs)}` && ready(file);
      return { file, size: st.size, mtime: st.mtimeMs, v: ok ? e.v : null }; }).sort((a, b) => b.mtime - a.mtime);
  }
  function syncState() { try { return JSON.parse(fs.readFileSync(path.join(dir, '.sync.json'), 'utf8')); } catch { return null; } }

  return {
    dir, store,
    // for the snapshot: every pick with the version of its cropped copy here ('' = not ready yet)
    map() { const o = {}; for (const [k, e] of Object.entries(picks)) o[k] = { file: e.file, t: e.t, v: e.file && index[e.file] && ready(e.file) ? index[e.file].v : '' }; return o; },
    list() { const fl = files(); setTimeout(warm, 0); return { files: fl, picks: { ...picks }, dir, source: cfg.source || '', sourceUrl: (syncState() || {}).folderUrl || cfg.sourceUrl || '', sync: syncState(), canSync: !!syncCmd }; },
    set, merge: mergeRemote, ensure, warm,
    // a cropped copy for meshav:// and /api/avatar: { path, type } or null
    async image(f, size) {
      size = SIZES.includes(+size) ? +size : 256;
      const e = await ensure(f); if (!e) return null;
      return { path: outOf(path.basename(f), size, e.ext), type: e.ext === 'gif' ? 'image/gif' : 'image/png' };
    },
    sync() {
      if (!syncCmd) return Promise.resolve({ ok: false, err: 'no sync command set (mesh.local.json avatars.syncCmd)' });
      return new Promise(res => execFile('/bin/sh', ['-c', tilde(syncCmd)], { timeout: 180e3, env: { ...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:' + (process.env.PATH || '') } },
        (err, out, er) => { warm(); changed(); res({ ok: !err, out: String(out || '').trim().split('\n').pop().slice(0, 300), err: err ? String(er || err.message).trim().split('\n').pop().slice(0, 300) : undefined }); }));
    },
  };
}

module.exports = { createAvatars };
