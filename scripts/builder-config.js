// Prints the electron-builder config with this install's name and bundle id (mesh-name.js: MESH_NAME / mesh.local.json /
// the public defaults) swapped in for the public ones in package.json. Used by install.sh and the installer scripts:
//   node scripts/builder-config.js > dist-install/builder.json && electron-builder --config dist-install/builder.json
const path = require('path'), root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json')), M = require(path.join(root, 'mesh-name.js')), D = M.DEFAULTS;
const swap = v => typeof v === 'string' ? v.split(D.name).join(M.name).split(D.name.replace(/ /g, '-')).join(M.name.replace(/ /g, '-'))
  : Array.isArray(v) ? v.map(swap) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)])) : v;
const cfg = swap(pkg.build); cfg.appId = M.appId; cfg.productName = M.name;
cfg.extraMetadata = { productName: M.name };
process.stdout.write(JSON.stringify(cfg, null, 2));
