#!/bin/bash
# Installs the ponytail plugin in Claude Code cloud sessions, where the
# marketplace/enabledPlugins settings alone do not trigger an install.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

MARKETPLACE_REPO="DietrichGebert/ponytail"
PLUGIN="ponytail@ponytail"

# Skip when already installed (hook runs on startup, resume, clear, compact)
if claude plugin list 2>/dev/null | grep -q "$PLUGIN"; then
  exit 0
fi

claude plugin marketplace add "$MARKETPLACE_REPO"
claude plugin install "$PLUGIN"
