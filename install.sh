#!/bin/bash
# Build the app with this install's name (mesh-name.js: MESH_NAME / mesh.local.json / "Mesh for Claude Code"), sign it
# with a stable local identity (so macOS keeps file-access permissions across rebuilds) and install it to /Applications.
# - Updates the installed app IN PLACE (rsync into the same bundle) — deleting and re-copying it made the Dock drop its
#   pinned icon on every update.
# - Safe to run from a Claude session living inside the app: builds into dist-install/ (never the dist/ copy you may be
#   running) and only quits/relaunches the app when no sessions run inside it.
set -e
cd "$(dirname "$0")"
NAME=$(node -p "require('./mesh-name').name")
ID=$(node -p "require('./mesh-name').signId")     # keychain code-signing identity (optional)
APP="/Applications/$NAME.app"
DATA_DIR=$(node -p "require('./mesh-name').dataDir || 'Claude Mesh'")
# what this build is: mainSig changes only when something outside the UI changed (updater.js)
COMMIT=${MESH_COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || date +%s)}
SUBJECT=${MESH_SUBJECT:-$(git log -1 --format=%s 2>/dev/null)}
MAINSIG=$( { find . -maxdepth 1 -type f \( -name '*.js' -o -name '*.json' \) ! -name build-info.json; find local scripts -type f -name '*.js' 2>/dev/null; } | sort | xargs md5 -q | md5 -q)
node -e "require('fs').writeFileSync('build-info.json',JSON.stringify({commit:process.argv[1],subject:process.argv[2],mainSig:process.argv[3]}))" "$COMMIT" "$SUBJECT" "$MAINSIG"
# every module the app requires must be packed (2026-11-07: a new file missing from package.json "files" made a build that couldn't start)
node -e "
const fs=require('fs'),f=require('./package.json').build.files,miss=[];
for(const j of fs.readdirSync('.').filter(x=>x.endsWith('.js')))for(const m of fs.readFileSync(j,'utf8').matchAll(/require\\('\\.\\/([\\w-]+)(\\.js)?'\\)/g))if(fs.existsSync(m[1]+'.js')&&!f.includes(m[1]+'.js'))miss.push(m[1]+'.js (required by '+j+')');
if(miss.length){console.error('Not in package.json build.files: '+[...new Set(miss)].join(', '));process.exit(1)}" || exit 1
mkdir -p dist-install
node scripts/builder-config.js > dist-install/builder.json
# the Electron already in node_modules when it's the same version: no download (GitHub's checksum file 504'd on 2026-11-08)
DIST=(); [[ "$(cat node_modules/electron/dist/version 2>/dev/null)" == "$(node -p "require('./node_modules/electron/package.json').version")" ]] && DIST=(-c.electronDist=node_modules/electron/dist)
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir --config dist-install/builder.json -c.directories.output=dist-install "${DIST[@]}"

# (ps, not pgrep: pgrep hides its own ancestors, i.e. the app this script may be running inside)
pids() { ps -axo pid=,command= | awk -v exe="$APP/Contents/MacOS/$NAME" '{ c = substr($0, index($0, $2)) } c == exe {print $1}'; }

# keep the version being replaced, for rollback
DATA="$HOME/Library/Application Support/$DATA_DIR"
if [ -d "$APP" ]; then mkdir -p "$DATA/prev/$NAME.app"; rsync -a --delete "$APP/" "$DATA/prev/$NAME.app/"; fi

mkdir -p "$APP"
rsync -a --delete "dist-install/mac-arm64/$NAME.app/" "$APP/"
xattr -cr "$APP"
if security find-identity -p codesigning | grep -q "$ID"; then
  codesign --force --deep -s "$ID" "$APP"
else
  echo "note: no '$ID' code-signing identity in the keychain — ad-hoc signing (macOS may ask for file access again after updates)"; codesign --force --deep -s - "$APP"
fi
touch "$APP"                               # nudge Finder/Dock to refresh the icon

# the running app takes it from here (updater.js): UI-only changes reload in place, the rest restart at a quiet moment
if [ -n "$(pids)" ]; then
  HOT="$DATA/hot/$COMMIT"; mkdir -p "$HOT/node_modules"
  rsync -a --delete renderer phone "$HOT/"
  for m in @xterm/xterm @xterm/addon-fit @xterm/addon-serialize animejs; do mkdir -p "$HOT/node_modules/$m"; rsync -a --delete "node_modules/$m/" "$HOT/node_modules/$m/"; done
  ls -1t "$DATA/hot" | tail -n +3 | while read -r old; do rm -r "$DATA/hot/$old"; done
  node -e "const b=require('./build-info.json');require('fs').writeFileSync(process.argv[1],JSON.stringify({...b,hot:process.argv[2],at:Date.now()}))" "$DATA/update.json" "$HOT"
  echo "Installed $COMMIT. The running app applies it at a quiet moment."
else
  open "$APP"
fi
