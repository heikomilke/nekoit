#!/usr/bin/env bash
# Build the optimised binary and install it where the desktop launcher looks.
# Usage: scripts/release.sh   (takes about a minute; safe to run while the dev app is open)
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
nice -n 10 npm run tauri build -- --no-bundle
install -Dm755 target/release/nekoit "$HOME/.local/bin/nekoit"
echo "installed $(ls -la --time-style=+%H:%M "$HOME/.local/bin/nekoit" | awk '{print $6}') -> ~/.local/bin/nekoit"
