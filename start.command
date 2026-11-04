#!/bin/bash
# Double-click this file in Finder to start Signal9 Print Studio.
# A Terminal window opens and the app opens in your browser.
# Close the Terminal window (or press Ctrl+C) to stop it.

cd "$(dirname "$0")" || exit 1

# Finder doesn't load your shell profile, so add the usual Node.js locations.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js is not installed yet."
  echo "  Your browser will open the download page: choose the macOS installer (LTS),"
  echo "  install it, then double-click start.command again."
  echo ""
  open "https://nodejs.org/en/download"
  read -n 1 -s -r -p "  Press any key to close this window."
  exit 1
fi

SIGNAL9_OPEN=1 node server.js
