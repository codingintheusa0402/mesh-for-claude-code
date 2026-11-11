// Project folders on the other Mac. A session's folder button works from either Mac: the same path under home if this Mac
// has it (a synced repo), otherwise a copy kept in iCloud Drive under "Mesh Folders/<machine>/".
// The copy is a one-way viewing copy, never the working folder: git repos, databases and running jobs don't survive being
// live in iCloud. Only folders the other Mac lacks are copied, without secrets, repos, dependencies, logs or big files, and
// edits made in the copy aren't overwritten (--update) but don't reach the original either. Off unless mesh.local.json sets
// "folderMirror": true.
const fs = require('fs'), path = require('path'), os = require('os'), { execFile } = require('child_process');
const HOME = os.homedir(), ROOT = path.join(HOME, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Mesh Folders');
const EVERY = 15 * 60e3, MAX_FILE = '25m';
const SKIP = ['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', 'DerivedData', '.build', '.next', '.cache', 'Pods', 'SourcePackages', 'logs', 'state',
  '.env', '.env.*', '*.env', '*.pem', '*.key', '*.p12', '*.mobileprovision', 'credentials*', 'secrets*', '*secret*', '*token*', '.npmrc', '.netrc', '*.sqlite*', '*.db', '*.log', '*.plist', '*cookie*', '*session*.json', 'Local.xcconfig', '.DS_Store'];

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
  const copy = rel => new Promise(res => {
    const dest = path.join(ROOT, machine, rel); try { fs.mkdirSync(dest, { recursive: true }); } catch { return res(false); }
    execFile('/usr/bin/nice', ['-n', '15', '/usr/bin/rsync', '-a', '--update', '--max-size=' + MAX_FILE, ...SKIP.map(s => '--exclude=' + s), path.join(HOME, rel) + '/', dest + '/'], { timeout: 10 * 60e3 }, e => res(!e));
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
