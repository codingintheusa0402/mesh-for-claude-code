# Changelog

Newest first. Older changes are in the git log.

## 2026-11-18
- **Terminal size from another device, fixed.** Opening a terminal tab last sized by the other Mac or the phone now takes this window's size right away, without a scroll first. Keys typed while it changes size wait until Claude Code has redrawn (at most about 1.2 s), so the text no longer lands over the old layout.
- **iPhone: swipe to the board.** Right to left shows the session board (Grid), and left to right on the board goes back, like the Mac window. Left to right anywhere else still opens the drawer.
- **iPhone drawer swipe from anywhere.** A swipe to the right opens the session drawer from anywhere, over the terminal too, with a parallax drawer and a smoother snap. The terminal font is crisper (system monospace) with a little more line spacing.
- **Swipe to the session board.** A two-finger swipe from right to left over the Mesh shows the session board (Simple view). Left to right brings the Mesh back.
- **View-only machines.** `peer.json` can list several machines (`mode: "full"` or `"view"`). The old single-peer format still works. View machines (`kind: "ssh-gate"` over an SSH gate, or `kind: "http"`) show their sessions as cards with **Send** and **Stop job** only. They get no terminal, transcript, resume, move or sync. See README → View-only machines.
