#!/bin/bash
# Build + install the app on the iPhone over the cable (free Apple ID signing expires every 7 days).
# Name, bundle id and DEVELOPMENT_TEAM come from Mesh.xcconfig + your gitignored Local.xcconfig.
# Needs: Apple ID signed in at Xcode → Settings → Accounts; iPhone connected (cable or same Wi-Fi), unlocked.
set -e
cd "$(dirname "$0")"
DEV=$(xcrun devicectl list devices 2>/dev/null | awk '/physical/ && / (connected|available) / {for(i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) print $i}' | head -1)
[ -z "$DEV" ] && { echo "Connect the iPhone (cable or same Wi-Fi) and unlock it."; exit 1; }
xcodegen generate >/dev/null
xcodebuild -project ClaudeMesh.xcodeproj -scheme ClaudeMesh -configuration Release -derivedDataPath build \
  -destination "id=$DEV" -allowProvisioningUpdates build | grep -E "error|BUILD (SUCCEEDED|FAILED)"
APP=$(ls -d build/Build/Products/Release-iphoneos/*.app | head -1)
xcrun devicectl device install app --device "$DEV" "$APP" | tail -1
echo "✅ Installed $(basename "$APP" .app) on iPhone $DEV"
