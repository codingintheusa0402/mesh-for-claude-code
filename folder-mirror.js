// Project folders on the other Mac. A session's folder button works from either Mac: the same path under home if this Mac
// has it (a synced repo), otherwise a copy kept in iCloud Drive under "Mesh Folders/<machine>/".
// The copy is a one-way viewing copy, never the working folder: git repos, databases and running jobs don't survive being
// live in iCloud. Only folders the other Mac lacks are copied, without secrets, repos, dependencies, logs, big files or media
// work products (frames, upscales, renders, masters, video/audio). The copy mirrors the filtered source exactly (--delete):
// edits made in the copy are lost on the next pass. A folder over 1 GB after filters isn't mirrored. Off unless
// mesh.local.json sets "folderMirror": true.
const fs = require('fs'), path = require('path'), os = require('os'), { execFile } = require('child_process');
const HOME = os.homedir(), ROOT = path.join(HOME, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Mesh Folders');
const EVERY = 15 * 60e3, MAX_FILE = '10m', MAX_TOTAL = 1e9;                   // per file / per mirrored folder (bytes)
const SKIP = ['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', 'DerivedData', '.build', '.next', '.cache', 'Pods', 'SourcePackages', 'logs', 'state',
  '.env', '.env.*', '*.env', '*.pem', '*.key', '*.p12', '*.mobileprovision', 'credentials*', 'secrets*', '*secret*', '*token*', '.npmrc', '.netrc', '*.sqlite*', '*.db', '*.log', '*.plist', '*cookie*', '*session*.json', 'Local.xcconfig', '.DS_Store',
  // media work products: frames, upscales, renders and masters are big, change constantly and are never needed to look at a project
  'frames', 'frames_*', '*_frames', 'frame_*', 'seq', 'up', 'up_*', 'upscale*', 'render', 'renders', '*_render*', 'out', 'masters', 'raw',
  'media', 'cache', 'tmp', 'work', '*.mp4', '*.mov', '*.mkv', '*.webm', '*.wav', '*.m4a', '*.mp3', '*.aac', '*.exr', '*.psd', '*.safetensors', '*.ckpt', '*.zip'];

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const relOf = p => (typeof p === 'string' && p.startsWith(HOME + '/') ? p.slice(HOME.length + 1) : null);
const goodRel = r => typeof r === 'string' && r && !r.startsWith('/') && !r.split('/').some(x => x === '..' || x === '');

// where a folder of the other Mac can be opened here; null = not here (yet)
function resolve(rel, machine) {
  if (!goodRel(rel)) return null;
  const same = path.join(HOME, rel); if (isDir(same)) return { path: same, label: '~/' + rel, why: 'the same folder on this Mac' };
  const copy = path.join(ROOT, machine || '', rel); if (machine && isDir(copy)) return { path: copy, label: rel.split('/').pop(), why: `iCloud copy from ${machine}` };
  return null;
}

function createMirror({ machine, peer, folders, enabled }) {
  let busy = false;
  // The mirror is a viewing copy: --delete + --delete-excluded keep it equal to the filtered source, so pruned or newly
  // skipped files leave iCloud too. A folder whose filtered size passes MAX_TOTAL is not mirrored, and its old copy goes.
  const rs = (extra, src, dest, cb) => execFile('/usr/bin/nice', ['-n', '15', '/usr/bin/rsync', '-a', '--update', '--delete', '--delete-excluded',
    '--max-size=' + MAX_FILE, ...SKIP.map(s => '--exclude=' + s), ...extra, src, dest], { timeout: 10 * 60e3, maxBuffer: 4 << 20 }, cb);
  const dropCopy = dest => { if (dest.startsWith(path.join(ROOT, machine) + '/')) try { fs.rmSync(dest, { recursive: true, force: true }); } catch { } };
  const copy = rel => new Promise(res => {
    const src = path.join(HOME, rel) + '/', dest = path.join(ROOT, machine, rel);
    rs(['-n', '--stats'], src, '/tmp/mesh-mirror-sizecheck-none/', (e, out) => {    // dry run against an empty target = full size
      const m = /Total file size: ([\d,]+)/.exec(out || ''), total = m ? +m[1].replace(/,/g, '') : NaN;
      if (e || !(total >= 0)) return res(false);
      if (total > MAX_TOTAL) { console.warn(`[mirror] ~/${rel}: ${(total / 1e9).toFixed(1)} GB after filters > cap, not mirrored`); dropCopy(dest); return res(false); }
      try { fs.mkdirSync(dest, { recursive: true }); } catch { return res(false); }
      rs([], src, dest + '/', e2 => res(!e2));
    });
  });
  async function tick() {
    const p = peer(); if (busy || !enabled || !p || !p.online()) return;
    busy = true;
    try {
      const rels = [...new Set(Object.values(folders()).map(f => relOf(f.path)).filter(goodRel))].filter(r => !r.startsWith('Library/'));
      for (const rel of rels) {
        const r = await p.forward('GET', '/api/folder-here', undefined, { rel }).catch(() => null);
        if (r && r.here === false) await copy(rel);                                  // (an older build there doesn't answer: nothing to do yet)
      }
    } finally { busy = false; }
  }
  function start() { if (!enabled) return; setTimeout(tick, 60e3); setInterval(tick, EVERY); }
  return { start, tick };
}
module.exports = { createMirror, resolve, relOf, goodRel, here: rel => goodRel(rel) && isDir(path.join(HOME, rel)) };
