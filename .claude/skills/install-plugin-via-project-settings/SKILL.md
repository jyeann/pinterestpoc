---
name: install-plugin-via-project-settings
description: "Use when asked to install a Claude Code plugin from a session where /plugin slash commands can't be run (cloud or remote sessions, or the agent itself) — declare the marketplace and plugin in project .claude/settings.json"
metadata:
  origin: auto-extracted
---

# Install a Claude Code Plugin via Project Settings

**Extracted:** 2026-11-16
**Context:** The agent cannot execute interactive `/plugin ...` commands, but the user wants a plugin installed for a project.

## Problem
`/plugin marketplace add` and `/plugin install` are interactive slash commands.
The agent cannot run them, and each must be sent as its own prompt.

## Solution
1. Clone the plugin repo into the scratchpad (not the project) and read
   `.claude-plugin/marketplace.json` for the marketplace name and plugin name,
   plus `INSTALL.md` / README for config options. Check what its hooks need
   (e.g. Node on PATH).
2. Write the project's `.claude/settings.json`:
   - `extraKnownMarketplaces.<marketplace-name>.source` = `{source: "github", repo: "<owner>/<repo>"}`
   - `enabledPlugins["<plugin>@<marketplace>"]` = `true`
   - `env` for config the plugin reads from environment variables
3. Commit to the project so it applies to everyone who opens the repo
   (only when the user asks; a Stop hook may also request it).
4. Give the user the manual `/plugin` commands as fallback.

## Example
```json
{
  "extraKnownMarketplaces": {"ponytail": {"source": {"source": "github", "repo": "DietrichGebert/ponytail"}}},
  "enabledPlugins": {"ponytail@ponytail": true},
  "env": {"PONYTAIL_DEFAULT_MODE": "lite"}
}
```

## Caveats
- Unverified here: that Claude Code prompts to trust and install on next
  session start. Say so to the user instead of claiming the plugin is active.
- Find the default-mode mechanism in the plugin's config code (here:
  env var, then ~/.config/ponytail/config.json).
- Verify the plugin is the real upstream; forks reuse popular names.

## When to Use
User says "install <plugin>" and only a cloud/remote session is available.
