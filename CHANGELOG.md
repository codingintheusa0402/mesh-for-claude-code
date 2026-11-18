# Changelog

Newest first. Older changes are in the git log.

## 2026-11-18
- **Swipe to the session board.** A two-finger swipe from right to left over the Mesh shows the session board (Simple view). Left to right brings the Mesh back.
- **View-only machines.** `peer.json` can list several machines (`mode: "full"` or `"view"`). The old single-peer format still works. View machines (`kind: "ssh-gate"` over an SSH gate, or `kind: "http"`) show their sessions as cards with **Send** and **Stop job** only. They get no terminal, transcript, resume, move or sync. See README → View-only machines.
