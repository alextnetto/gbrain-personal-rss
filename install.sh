#!/usr/bin/env bash
# Installs the personal-rss skill into a gBrain checkout so Claude Desktop
# (or any MCP client connected to `gbrain serve`) can talk about your briefs.
#
# Usage: ./install.sh /path/to/gbrain
#
# This does NOT run the daily script or set up cron. To run the script:
#   export ANTHROPIC_API_KEY=sk-ant-...
#   export PERSONAL_RSS_VAULT=/path/to/your/obsidian/vault
#   bun run daily

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

echo "==> symlinking skill into gbrain"
ln -sfn "$REPO_ROOT/skills/personal-rss" "$GBRAIN_ROOT/skills/personal-rss"
echo "  $GBRAIN_ROOT/skills/personal-rss → $REPO_ROOT/skills/personal-rss"

echo "==> done. Next steps:"
echo ""
echo "  1. Connect gBrain's MCP server to your IDE / Claude Desktop:"
echo "     Add to ~/Library/Application Support/Claude/claude_desktop_config.json:"
echo ""
echo '       { "mcpServers": { "gbrain": { "command": "gbrain", "args": ["serve"] } } }'
echo ""
echo "  2. Make sure your vault is synced into the brain DB:"
echo "     gbrain sync --repo /path/to/your/vault"
echo ""
echo "  3. Schedule the daily brief (cron, launchd, or manual):"
echo "     export ANTHROPIC_API_KEY=... PERSONAL_RSS_VAULT=/path/to/vault"
echo "     bun run daily"
echo ""
echo "  4. In Claude Desktop, ask 'what should I read today?'"
