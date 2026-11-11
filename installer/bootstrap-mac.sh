#!/bin/bash
# macOS prerequisites. The app needs only Claude Code; it is installed with the official installer
# (https://claude.ai/install.sh → ~/.local/bin/claude) if missing. Nothing else is touched.
# Usage: bootstrap-mac.sh [--check]   (run as the user, not root; the .pkg postinstall drops to the console user)
# APP_NAME: the app's name for the messages (the app / postinstall pass it in).
APP_NAME="${APP_NAME:-Mesh for Claude Code}"
CLAUDE=""
for p in "$HOME/.local/bin/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do [ -x "$p" ] && CLAUDE="$p" && break; done
[ -z "$CLAUDE" ] && CLAUDE="$(/bin/zsh -lic 'command -v claude' 2>/dev/null | tail -1)"
if [ "$1" = "--check" ]; then [ -n "$CLAUDE" ] && echo ok || echo "missing: claude"; exit 0; fi
echo
echo "  Checking what $APP_NAME needs."
echo
if [ -n "$CLAUDE" ]; then echo "  [found] Claude Code ($CLAUDE)"; echo; echo "  Everything is ready."; exit 0; fi
echo "  [needed] Claude Code (claude.ai)"
echo
echo "  ▶ Installing Claude Code… (official installer https://claude.ai/install.sh)"
if curl -fsSL https://claude.ai/install.sh | bash; then
  # make `claude` available in new Terminal windows too
  for rc in "$HOME/.zshrc" "$HOME/.bash_profile"; do
    grep -qs '.local/bin' "$rc" || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$rc"
  done
  echo; echo "  Done. The first time, open a session in $APP_NAME with + New and sign in to your Claude account."
else
  echo; echo "  The install failed. Check your internet connection; opening $APP_NAME again retries it."
fi
echo
