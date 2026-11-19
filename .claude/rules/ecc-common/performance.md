# Model and effort

Pick the model by role, not by a fixed ladder. Use the strongest available model for the orchestrating or judging session (planning, deciding what is done, reviewing results) and a fast, capable coding model for worker agents. Agent frontmatter `model:` sets the worker; the session model sets the orchestrator.

Reasoning is adaptive. Control it with effort, not a token budget:
- `/effort <level>` in a session, `--effort <level>` at launch, or `CLAUDE_CODE_EFFORT_LEVEL`. Save per-model levels in `modelSettings` in `~/.claude/settings.json`; the older `effortLevel` key does not apply to Opus 5.5 or newer.
- Option+T / Alt+T toggles thinking, but cannot disable it on Opus 5.5, Sonnet 5.5 or Fable models.
- `MAX_THINKING_TOKENS` is ignored on adaptive models.
- For hard problems raise effort and use plan mode.

Docs: https://code.claude.com/docs/en/model-config#adjust-effort-level

With a verify gate available, measure model x effort instead of guessing: `node .claude/harness/bin/tune.js`. A stronger model at low effort is often cheaper than a weaker one at high effort.
