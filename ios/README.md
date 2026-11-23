# iPhone app (native)

A small SwiftUI app that shows the live mesh on your iPhone. It is a native shell around the phone web app
(`phone/`) that the Mac app serves when phone access is on (📱 button), or that the server program
(`server/mesh-server.js`) serves on an always-on box. All the mesh, session and terminal UI comes from that page.
The native side handles pairing, picking a host, the keyboard, dialogs and links.

You don't need it: the same page also works as a home-screen web app in Safari. The native app adds QR pairing,
automatic switching between several hosts, and native alert/confirm/prompt dialogs.

## What it does
- **Pairing screen.** On first launch: **Scan QR code** (camera) or paste a pairing link and tap **Connect**.
  A valid link is `http(s)://<host>:47320/...?t=<key>`. If you paste text with extra characters around the link
  (chat formatting, a trailing dot), the app uses the first `http(s)://` link it finds.
- **Several hosts.** It saves one link per host, in order, e.g. the Mac over Tailscale, the Mac on Wi-Fi, then the
  server. Adding a link for a host you already paired replaces that host's old link. On launch it loads the first
  host that answers (12 s timeout per host).
- **Failover and fall-back.** If a page fails to load, or the page reports that its host stopped sending data
  (20 s without data, sent as `offline` through `window.webkit.messageHandlers.mesh`), the app tries the next host.
  On a fallback host it checks the hosts listed before it every 60 s (4 s timeout) and moves back to the first one
  that answers.
- **Can't connect.** When no host answers it shows "Can't reach your Mac" (or "…your Mac or the server" when you
  have more than one host) with **Retry** and **Hosts…**. It retries by itself when the app comes back to the
  foreground.
- **Connection menu.** Hold three fingers on the screen (about 0.6 s) to open it. One- and two-finger gestures
  still go to the mesh. The menu has **Reload**, **Connect to <host>** for each saved host,
  **Add a host (pairing link)** and **Forget all hosts**.
- **Keyboard.** The web view runs full screen. The app tells the page how much of the screen the keyboard covers
  (`window.meshKeyboard(height)`), so the page can keep the input above the keyboard.
- **Links.** `vnc://` (Screen Sharing buttons), `tel:`, `mailto:` and other non-web links open in the app that
  handles them. If no app can open `vnc://`, it asks you to install RVNC Viewer (RealVNC).
- Dark mode only, iPhone only, portrait and landscape. The pairing key and page data stay in the web view's
  storage on the phone.

## Requirements
- Xcode with an Apple ID signed in (Xcode → Settings → Accounts). A free Apple ID works.
- [XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen`
- iOS 17 or later on the iPhone.
- On the Mac: the Mesh app with phone access on (📱), or the server program running (`server/install.sh`).
  To connect when you're away from home, turn on Tailscale on the iPhone. The app allows plain `http`
  because the Mac and the server serve plain http on your Wi-Fi or tailnet.

## Setup
1. Optional: create `ios/Local.xcconfig` (gitignored) with your own name, bundle id and signing team:
   ```
   MESH_NAME = My Mesh
   MESH_BUNDLE_ID = com.example.mymesh.ios
   DEVELOPMENT_TEAM = ABCDE12345
   ```
   Without it the defaults in `Mesh.xcconfig` apply: name **Mesh for Claude Code**, bundle id
   `dev.meshforclaudecode.ios`. If you sign with your own Apple ID you will usually need your own `MESH_BUNDLE_ID`
   and `DEVELOPMENT_TEAM`.
2. Connect the iPhone by cable (or put it on the same Wi-Fi) and unlock it.
3. Build and install:
   ```bash
   bash ios/install.sh
   ```
   It finds the connected iPhone, runs `xcodegen generate`, builds the Release configuration into `ios/build/`,
   and installs the app with `xcrun devicectl`. With a free Apple ID the signature expires after 7 days. Run the
   script again to reinstall.

To work in Xcode instead: `cd ios && xcodegen generate && open ClaudeMesh.xcodeproj` (scheme **ClaudeMesh**).
`project.yml` is the source of truth. Edit it rather than the generated project.

## Pairing
- **Mac:** open the Mesh app, click 📱, turn on phone access and scan the QR code. Use the Tailscale code to
  connect from anywhere. You can pair both codes: they're saved as separate hosts.
- **Server:** run `node server/mesh-server.js --pair` on the server and paste the link it prints. If the app is
  already paired, hold three fingers → **Add a host (pairing link)**.

## Configuration
| Setting | Where | Default |
|---|---|---|
| `MESH_NAME` | `Local.xcconfig` | `Mesh for Claude Code` (app name on the home screen and in the app) |
| `MESH_BUNDLE_ID` | `Local.xcconfig` | `dev.meshforclaudecode.ios` |
| `DEVELOPMENT_TEAM` | `Local.xcconfig` | none: set it to your team ID to sign for a device |

The app only accepts pairing links on port **47320**, the phone server's default port.

## Files
```
project.yml              XcodeGen project (target ClaudeMesh, iOS 17, Info.plist keys and permission texts)
Mesh.xcconfig            public name + bundle id; includes your optional Local.xcconfig
install.sh               build + install on a connected iPhone
ClaudeMesh/
  ClaudeMeshApp.swift    app entry; Pairing = the saved host links (UserDefaults "pairing.urls")
  PairingView.swift      pairing screen + camera QR scanner
  MeshScreen.swift       full-screen WKWebView, host failover, connection menu, keyboard + dialog bridges
  Assets.xcassets        app icon
```
