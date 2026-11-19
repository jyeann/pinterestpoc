# RED STRING

RED STRING is a conspiracy corkboard. Type a word or phrase and it becomes a pin with its own generated art,
pinned to a shared cork wall. Tie pins together with red string and the app announces, with total confidence,
how they are connected. Share the wall link and your friends see every pin and string arrive live.

## Requirements

- Node.js 22 or later
- No dependencies and no install step. Clone the repo and run it.

## Run it

```sh
npm start                 # same as: node src/main.js
PORT=8080 npm start       # choose a port (default 3000; PORT=0 picks a free one)
```

Open `http://127.0.0.1:3000/` and the server prints the address it is listening on.

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `3000` | Port to listen on. `0` picks a free port. |
| `HOST` | `127.0.0.1` | Address to bind. Keep the default unless you know why not. |
| `RED_STRING_DATA` | unset | Path to a JSON file. Set it and walls are saved there and loaded on restart. Unset means memory only. |
| `RATE_LIMIT` | on | Set to `0` to turn off the limit on writes (120 burst, 30 per second per address). |

`SIGTERM` or `SIGINT` saves pending changes and stops the server with exit code 0.

## Use it

1. Open the home page and press **Open a new case**. You get a wall with its own link.
2. Type into **What did you see?** and press **Pin it**. Add at least two pins.
3. Press **Tie string** on one pin, then on another. A red string appears. Click it to read the finding.
4. Press **Ask the Detective** for a suggested connection. **Tie it** makes the string, **Not now** skips it.
5. Press **Copy link** to share the wall. Press **Close the case** for a printable one-page case file.

## Tests

```sh
npm test                                  # unit and HTTP acceptance tests (node:test)
node .claude/harness/bin/verify.js        # the full gate: tests, coverage, test quality, hidden holdout, mutation spot-check
node --test .claude/harness/test/*.test.js  # self-tests for the harness itself
```

The full gate is what CI runs (`.github/workflows/ci.yml`).

## Project layout

```
src/            server logic, CommonJS, Node built-ins only (main.js is the entry point)
public/         browser front end; it renders what the server sends and computes nothing
tests/          unit tests for each module in src/
acceptance/     HTTP tests that start the real server
docs/product/red-string/   brief, UX, design, ADRs, decisions and reviews
.claude/        agent workflow and verify gate (see below)
.github/workflows/ci.yml   CI: harness self-tests, verify gate, secret scan
spec.md, TASKS.md, verify.config.json   build contract, backlog and gate settings
```

## Known limits

From the review in `docs/product/red-string/reviews.md`:

- **Not hardened for the open internet.** Run it on your own network or machine. Do not expose it as is.
- **Walls are never evicted.** A process holds 10 000 walls; past that, creating a wall returns 503. One address can fill that in minutes.
- **Anyone with the link can edit.** There are no accounts, permissions or private walls.
- **Seat cap is only partly effective.** A wall allows 50 live viewers, but one client can take all of them, because the per-address stream cap defaults to 60.
- **The rate limit keys on the socket address only.** Proxies and IPv6 rotation are not handled.
- **Saving rewrites the whole file** on each change. Fine for a toy wall; the review puts the failure point near 512 MB of data.
- **No pointer "Move" control for pins.** Keyboard and screen-reader users have no non-drag way to move a pin yet.

## How it was made

RED STRING was built by an agent team using the `.claude/` workflow, copied from the `claude-setup` repo. The
product brief, UX, design, architecture decisions, the agents' decision log and the review findings are in
`docs/product/red-string/`: start with `brief.md`, then `design.md`, `decisions.md` and `reviews.md`. The
`adr/` folder records the key trade-offs. Release notes are in `CHANGELOG.md`.
