# Decisions: red-string

Agent decisions made without a human gate, per `orch-product-team`. The one human gate is final acceptance.

| # | Phase | Decision | Options | Chosen | Why | Decided by |
|---|-------|----------|---------|--------|-----|------------|
| 1 | setup | What "claude-setup" and "orch-team" mean | Ask the user; infer | Copy `jyeann/claude-setup` `.claude/` into this repo and run the `orch-product-team` skill | The repo `jyeann/claude-setup` exists and its only team-shaped `orch-*` skill is `orch-product-team` | orchestrator |
| 2 | setup | What "the app" is | Ask; rebuild a Pinterest clone; invent | Invent a new pinboard product | The repo held only a README, and the prompt said "wild, no idea limits" | orchestrator |
| 3 | discover | Product idea | Infinite moodboard; physics pin wall; conspiracy corkboard | RED STRING, a conspiracy corkboard (see `idea.md`) | It keeps the pin and board idea, needs no image uploads or network images, and the joke carries the product | orchestrator |
| 4 | setup | Where the app lives | `examples/red-string/` as in claude-setup; repo root | Repo root (`src/`, `public/`, `tests/`, `acceptance/`, `holdout/`) | This repo holds one product | orchestrator |
| 5 | setup | How to run the named agents | Stop and ask for a new session; emulate | `general-purpose` agents told to read and follow `.claude/agents/<name>.md`, with the model named in that file | Agent definitions copied mid-session are not registered as agent types here (`product-scoper` was refused). Hooks did load | orchestrator |
| 6 | discover | Build, adopt or extend | see `brief.md` | Build from scratch | see `brief.md` "Decisions" | product-scoper |
| 7 | design | Architect output handoff | Retype; writer agent; give Write | Architect given Write for `design.md` and `adr/` only | Retro of hello-overkill: a retyped design dropped a caveat and failed a gate | orchestrator |
| 8 | plan | Server entry point | `src/server.js` (brief); `src/main.js` (design) | Both: `src/main.js` listens, `src/server.js` exports `createServer` and starts when run directly | The design is authoritative and the test helper accepts either | planner, test owner |
| 9 | plan | Who writes tests | Builder; separate agent | Separate test owner wrote 107 acceptance and 19 hidden holdout tests before any code; red because no server exists | Skill phase 4 exit check | orchestrator |
| 10 | build | Harness limits | `--max 14 --stall 3` (skill default); looser | `--max 30 --stall 6` | Builders run in the background here, so each orchestrator stop while waiting costs an iteration | orchestrator |
| 11 | build | Protected paths | All of `docs/product/red-string/`; only the inputs | `brief.md`, `ux.md`, `design.md`, `adr/`, plus `acceptance/` and `verify.config.json` | The decision log and later phase outputs must stay writable | orchestrator |
