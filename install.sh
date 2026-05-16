#!/usr/bin/env bash
# Installs gbrain-personal-rss alongside an existing gBrain checkout.
# Usage: ./install.sh /path/to/gbrain

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 /path/to/gbrain" >&2
  exit 2
fi

GBRAIN_ROOT="$1"
if [[ ! -d "$GBRAIN_ROOT/skills" ]]; then
  echo "error: $GBRAIN_ROOT does not look like a gbrain checkout (no skills/ dir)" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "==> linking gbrain library so our orchestrator can import it"
(cd "$GBRAIN_ROOT" && bun link)
(cd "$REPO_ROOT" && bun link gbrain)

echo "==> installing our deps"
(cd "$REPO_ROOT" && bun install)

echo "==> installing skill (symlink)"
ln -sfn "$REPO_ROOT/skills/personal-rss" "$GBRAIN_ROOT/skills/personal-rss"

echo "==> registering plugin via GBRAIN_PLUGIN_PATH"
GBRAIN_RC="$HOME/.gbrainrc"
PLUGIN_LINE="export GBRAIN_PLUGIN_PATH=\"$REPO_ROOT:\${GBRAIN_PLUGIN_PATH:-}\""
if ! grep -qF "$REPO_ROOT" "$GBRAIN_RC" 2>/dev/null; then
  echo "$PLUGIN_LINE" >> "$GBRAIN_RC"
  echo "  added to $GBRAIN_RC (source it from your shell rc, e.g. .zshrc)"
else
  echo "  already present in $GBRAIN_RC"
fi

echo "==> generating sample launchd plist (macOS)"
PLIST_PATH="$HOME/Library/LaunchAgents/com.alextnetto.gbrain-personal-rss.plist"
cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.alextnetto.gbrain-personal-rss</string>
  <key>ProgramArguments</key>
  <array><string>$REPO_ROOT/bin/personal-rss-daily</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/tmp/personal-rss-daily.out</string>
  <key>StandardErrorPath</key><string>/tmp/personal-rss-daily.err</string>
</dict>
</plist>
EOF
echo "  wrote $PLIST_PATH (load with: launchctl load $PLIST_PATH)"

echo "==> running smoke test"
bash "$REPO_ROOT/scripts/smoke.sh"

echo "==> done. next steps:"
echo "  • source $GBRAIN_RC in your shell to pick up GBRAIN_PLUGIN_PATH"
echo "  • run 'gbrain doctor' to verify the new plugin loads"
echo "  • optionally: launchctl load $PLIST_PATH for nightly auto-run"
echo "  • ensure a gBrain worker is running (gbrain jobs work) for subagent invocation"
