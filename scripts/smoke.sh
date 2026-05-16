#!/usr/bin/env bash
# End-to-end smoke test. Runs after install.sh.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "==> smoke: REPO_ROOT=$REPO_ROOT"

echo "==> smoke: typecheck"
(cd "$REPO_ROOT" && bun --bun tsc --noEmit)

echo "==> smoke: unit tests"
(cd "$REPO_ROOT" && bun test)

echo "==> smoke: gbrain library importable"
if (cd "$REPO_ROOT" && bun -e "import('gbrain/engine-factory').then(()=>console.log('ok'))" 2>/dev/null | grep -q "ok"); then
  echo "  ok"
else
  echo "  warning: import 'gbrain/engine-factory' failed — run \`bun link gbrain\` first" >&2
fi

echo "==> smoke: plugin discoverable by gBrain"
if command -v gbrain >/dev/null 2>&1; then
  if gbrain doctor 2>&1 | grep -q "gbrain-personal-rss"; then
    echo "  gbrain doctor sees gbrain-personal-rss"
  else
    echo "  warning: gbrain doctor did not mention gbrain-personal-rss (check GBRAIN_PLUGIN_PATH)" >&2
  fi
else
  echo "  skipping: gbrain CLI not on PATH"
fi

echo "==> smoke: ok"
