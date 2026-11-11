#!/bin/bash
# Install / update the server program on an always-on Linux box (e.g. WSL Ubuntu), run as your user:
#   bash <checkout>/server/install.sh
# Dependencies (xterm for the phone page, qrcode for --pair) live in ~/.mesh-server/deps and are linked in as
# node_modules (gitignored) so the checkout stays clean.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
D=$HOME/.mesh-server
mkdir -p "$D/deps" "$HOME/.config/systemd/user"
cd "$D/deps"
[ -f package.json ] || echo '{"name":"mesh-server-deps","private":true}' > package.json
npm install --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error '@xterm/xterm@^6.0.0' '@xterm/addon-fit@^0.11.0' 'qrcode@^1.5.4'
[ -e "$ROOT/node_modules" ] && [ ! -L "$ROOT/node_modules" ] && rm -rf "$ROOT/node_modules"
ln -sfn "$D/deps/node_modules" "$ROOT/node_modules"
sed "s|__ROOT__|$ROOT|" "$ROOT/server/mesh.service" > "$HOME/.config/systemd/user/mesh.service"
systemctl --user daemon-reload
systemctl --user enable mesh >/dev/null 2>&1 || true
systemctl --user restart mesh
sleep 2
systemctl --user is-active mesh
node "$ROOT/server/mesh-server.js" --pair
