# Native iPhone app

A small SwiftUI app that shows the live mesh from **Mesh for Claude Code** full screen on your iPhone. It is a native
shell around the phone web app (`phone/`) that the Mac app serves when phone access is on (📱 button), or that
the always-on server program serves (`server/mesh-server.js`). It adds a QR-code pairing screen, remembers several
hosts and switches between them on its own.

You build and install it yourself; it is not on the App Store.

## What it does

- **Pairing.** On first launch it shows a pairing screen: **Scan QR code** (camera) or paste a pairing link and tap
  **Connect**. A link is accepted when it is `http(s)`, uses port **47320** and carries a non-empty `t=` key. Pasted
  text can contain other characters; the first `http(s)` link in it is used.
- **Several hosts.** Each host (the Mac over Tailscale, the Mac on Wi-Fi, the server…) keeps its own link and key.
  Adding a link for a host you already paired replaces that host's old link. Hosts are tried in the order you added them.
- **Automatic fallback.** If a host doesn't answer (12 s load timeout), or the page reports that it stopped getting data,
  the next host is tried. While on a fallback host, the app checks every 60 s whether an earlier host answers again and
  moves back to it. If no host answers, it shows **Can't reach your Mac** (or **…or the server**) with **Retry** and
  **Hosts…**. Coming back to the app after a failure retries automatically.
- **Connection menu.** Long-press with **three fingers** anywhere (about 0.6 s): **Reload**, **Connect to `<host>`** for
  each paired host, **Add a host (pairing link)**, **Forget all hosts**.
- **Keyboard.** The app tells the page how much of the screen the keyboard covers (`window.meshKeyboard`), so the
  typing area sits above it.
- **Native dialogs.** The page's alert / confirm / prompt dialogs are shown as iOS alerts.
- **Other links.** Links that aren't web pages (`vnc://` from the Screen Sharing buttons, `tel:`, `mailto:` …) open in the
  app that handles them. For `vnc://` without a viewer installed, it suggests installing RVNC Viewer (RealVNC).

The app runs in dark mode, iPhone only, portrait and landscape, iOS 17 or later.

## Setup

Needs a Mac with Xcode, [XcodeGen](https://github.com/yonaskolb/XcodeGen) and an Apple ID.

1. `brew install xcodegen`
2. Sign in with your Apple ID in Xcode → Settings → Accounts.
3. Optional: create `ios/Local.xcconfig` (gitignored) to set your own name, bundle id and signing team:
   ```
   MESH_NAME = My Mesh
   MESH_BUNDLE_ID = com.example.mymesh.ios
   DEVELOPMENT_TEAM = ABCDE12345
   ```
4. Connect the iPhone (cable or same Wi-Fi) and unlock it.
5. `bash ios/install.sh`

`install.sh` runs `xcodegen generate`, builds the Release configuration into `ios/build/` for the first connected
iPhone, and installs it with `xcrun devicectl`. With a free Apple ID the signature expires after 7 days; run it again.

To open the project in Xcode instead: `cd ios && xcodegen generate && open ClaudeMesh.xcodeproj`.

## Config

| Setting | Where | Default |
|---|---|---|
| `MESH_NAME` | `Mesh.xcconfig`, override in `Local.xcconfig` | `Mesh for Claude Code` (app name on the home screen and in the app's texts) |
| `MESH_BUNDLE_ID` | same | `dev.meshforclaudecode.ios` |
| `DEVELOPMENT_TEAM` | `Local.xcconfig` | none (Xcode picks your team with automatic signing) |

Permissions the app asks for: camera (scan the pairing QR code, take photos to attach), microphone (record a video
to attach), photo library (attach photos and videos), local network (reach the Mac). App Transport Security allows plain
`http`, because the Mac and the server serve the phone page over http on your Wi-Fi or Tailnet.

## Usage

1. On the Mac, open Mesh for Claude Code, click 📱 and turn on phone access. Scan the QR code with the app. Use the
   Tailscale code if you want to connect from outside your home network (turn Tailscale on on the iPhone).
2. Optional: for the server, run `node server/mesh-server.js --pair` on it and paste the printed link via the three-finger
   menu → **Add a host (pairing link)**.
3. Everything else (sessions, terminals, prompts) is the phone web app; see the main [README](../README.md).

## Files

```
project.yml          XcodeGen project (target ClaudeMesh, iOS 17, Info.plist keys)
Mesh.xcconfig        public name and bundle id; includes your Local.xcconfig if present
install.sh           build + install on a connected iPhone
ClaudeMesh/
  ClaudeMeshApp.swift  app entry; Pairing (saved host links in UserDefaults)
  PairingView.swift    pairing screen + camera QR scanner
  MeshScreen.swift     full-screen WKWebView, host fallback, three-finger menu, keyboard + dialogs
  Assets.xcassets      app icon
```
