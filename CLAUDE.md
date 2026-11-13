# Rules for agents working on this repo

These two rules come from a real incident (2026-11-09): a QA script ended every session on the host, and the
old-session cleanup moved transcripts of running sessions to the Trash. Follow them exactly.

## 1. Never kill the live tmux server
- Never run `tmux kill-server` or `tmux kill-session` against the real tmux server, from a shell, a script or test code.
  Inside a Mesh session `$TMUX` is set, and it wins over `TMUX_TMPDIR`, so a "throwaway" test without its own socket
  hits the live server and ends every session on it.
- Tests use an isolated socket only: `tmux -L mesh-test …` (or `mesh-test-<name>`), or a throwaway Mesh instance
  (own `MESH_USERDATA` and `TMPDIR`). Clean up with `tmux -L mesh-test kill-server`, or close only the windows you made.
- Hosts may run a guard (a Claude Code PreToolUse hook and a `tmux` wrapper first in PATH) that refuses these commands
  without `-L mesh-test`. Never work around it.

## 2. The old-session cleanup never touches a session that might be alive
- `hist:trash` (main.js, `trashBlocker`) only moves a transcript that is **older than 7 days** and whose session is
  **confirmed ended**: not in the snapshot, not named by any running process (`claude --resume <id>`), not in the
  restore list, not on the keep list (`trash-keep.json` in the app's data folder).
- Never loosen these checks. A resumed session can show under another id, and the other Mac may still be writing a
  synced copy, which is why the age check matters.

## Every change
QA in a throwaway instance with its own `MESH_USERDATA` and `TMPDIR` before shipping. A throwaway instance is a tmux guest (`MESH_PANES_GUEST`): it sees live panes by polling and never touches their pipes.
