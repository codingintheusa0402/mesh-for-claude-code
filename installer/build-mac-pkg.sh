#!/bin/bash
# Build <Name>-mac-arm64.pkg: the app (ad-hoc signed) + a postinstall that installs Claude Code if missing.
# The name and bundle id come from mesh-name.js (MESH_NAME / mesh.local.json / "Mesh for Claude Code").
# Output: dist-pkg/<Name>-mac-arm64.pkg. Does not touch the installed /Applications copy.
set -e
cd "$(dirname "$0")/.."
NAME=$(node -p "require('./mesh-name').name"); APPID=$(node -p "require('./mesh-name').appId"); FILE="${NAME// /-}-mac-arm64.pkg"
mkdir -p dist-pkg && node scripts/builder-config.js > dist-pkg/builder.json
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir --config dist-pkg/builder.json -c.directories.output=dist-pkg
APP="dist-pkg/mac-arm64/$NAME.app"
codesign --force --deep -s - "$APP"
VER=$(node -p "require('./package.json').version")
rm -rf dist-pkg/root && mkdir -p dist-pkg/root && ditto "$APP" "dist-pkg/root/$NAME.app"
mkdir -p dist-pkg/postinstall-scripts && sed "s|__APP_NAME__|$NAME|g" installer/mac-pkg/scripts/postinstall > dist-pkg/postinstall-scripts/postinstall && chmod +x dist-pkg/postinstall-scripts/postinstall
sed "s|__APP_NAME__|$NAME|g" installer/mac-pkg/welcome.html > dist-pkg/welcome.html
pkgbuild --root dist-pkg/root --install-location /Applications --identifier "$APPID.pkg" --version "$VER" \
  --scripts dist-pkg/postinstall-scripts dist-pkg/component.pkg
cat > dist-pkg/distribution.xml <<XML
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>$NAME</title>
  <welcome file="welcome.html" mime-type="text/html"/>
  <options customize="never" require-scripts="false" hostArchitectures="arm64"/>
  <domains enable_localSystem="true"/>
  <volume-check><allowed-os-versions><os-version min="13.0"/></allowed-os-versions></volume-check>
  <choices-outline><line choice="app"/></choices-outline>
  <choice id="app" visible="false"><pkg-ref id="$APPID.pkg"/></choice>
  <pkg-ref id="$APPID.pkg">component.pkg</pkg-ref>
</installer-gui-script>
XML
productbuild --distribution dist-pkg/distribution.xml --resources dist-pkg --package-path dist-pkg "dist-pkg/$FILE"
ls -la "dist-pkg/$FILE"
