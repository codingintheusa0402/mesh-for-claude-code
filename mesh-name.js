// The app's name and identity, from one place.
//   1. MESH_NAME (and MESH_APP_ID, MESH_DATA_DIR) in the environment, if set
//   2. mesh.local.json next to this file (gitignored; also bundled into a local build), e.g.
//        { "name": "SpongeBob Mesh", "appId": "com.example.spongebobmesh", "dataDir": "SpongeBob Mesh" }
//   3. the public defaults below
// Everything that shows the name (window titles, menus, the bundle, the phone page, notifications, logs) reads it here.
const fs = require('fs'), path = require('path');
const DEFAULTS = { name: 'Mesh for Claude Code', appId: 'dev.meshforclaudecode.app', dataDir: 'Mesh for Claude Code', signId: 'Mesh Local Signing', tmuxSession: 'mesh', guideUrl: '', serverHosts: [] };
function load() {
  let local = {};
  for (const dir of [__dirname, process.resourcesPath].filter(Boolean)) {
    try { local = JSON.parse(fs.readFileSync(path.join(dir, 'mesh.local.json'), 'utf8')); break; } catch { }
  }
  const cfg = { ...DEFAULTS, ...local };
  if (process.env.MESH_NAME) cfg.name = process.env.MESH_NAME;
  if (process.env.MESH_APP_ID) cfg.appId = process.env.MESH_APP_ID;
  if (process.env.MESH_DATA_DIR) cfg.dataDir = process.env.MESH_DATA_DIR;
  if (process.env.MESH_TMUX_SESSION) cfg.tmuxSession = process.env.MESH_TMUX_SESSION;
  if (!local.dataDir && !process.env.MESH_DATA_DIR) cfg.dataDir = cfg.name;
  return cfg;
}
module.exports = load();
module.exports.DEFAULTS = DEFAULTS;
