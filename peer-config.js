// peer.json, the machines this Mesh shows besides itself. Three shapes are read:
//   { "url": …, "token": …, "kind": …, "label": …, "selfLabel": … }          one peer (the original format)
//   [ { …, "mode": "full" | "view", "name": … }, … ]                          a list
//   { "selfLabel": …, "peers": [ … ] }                                        a list plus this machine's own label
// The first "full" entry is the paired machine (peer.js: sessions, terminals, Resume here, Move, transcript sync).
// "view" entries (view-peers.js) only list their sessions and take send / stop: no terminals, no transcripts.
// An entry of kind "ssh-gate" is always view-only.
const fs = require('fs');
const path = require('path');

function readPeers(userData) {
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(path.join(userData, 'peer.json'), 'utf8')); } catch { }
  let list = [], selfLabel = null;
  if (Array.isArray(raw)) list = raw;
  else if (raw && Array.isArray(raw.peers)) { list = raw.peers; selfLabel = raw.selfLabel || null; }
  else if (raw && raw.url) list = [raw];
  list = list.filter(e => e && typeof e === 'object' && typeof e.url === 'string')
    .map(e => ({ ...e, mode: e.kind === 'ssh-gate' || e.mode === 'view' ? 'view' : 'full' }));
  const full = list.find(e => e.mode === 'full' && e.token) || null;
  if (!selfLabel && full && full.selfLabel) selfLabel = full.selfLabel;
  return { full: full ? { ...full, ...(selfLabel ? { selfLabel } : {}) } : null, views: list.filter(e => e.mode === 'view'), selfLabel };
}

module.exports = { readPeers };
