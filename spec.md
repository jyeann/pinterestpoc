# Spec: RED STRING

## Goal
A zero-dependency Node 22 web app: shared, live conspiracy walls. Users create a wall (`/w/<id>`), pin
phrases that become deterministic SVG art, tie pins with red string to get deterministic "findings", watch a
score/status climb, ask the detective for a suggestion, and print a server-rendered case file. All viewers of a
wall see changes live over SSE.

## Sources of truth (implement exactly)
- `docs/product/red-string/design.md`: API, error codes and copy, deterministic rules, data model, limits,
  security, persistence, lifecycle. Authoritative for everything server-side.
- `docs/product/red-string/ux.md`: screens, `data-testid` values, copy, states, accessibility. Authoritative for the UI.
- `docs/product/red-string/adr/`: rationale; consult when a rule looks ambiguous.
- `TASKS.md`: build order, file ownership and the module interfaces between groups.

Do not restate or reinterpret the API here; read the design sections:
normalisation 2.1, hash/PRNG 2.2, art 2.3, findings 2.4, score/status 2.5, detective 2.6, default position and
clamping 2.7, data model and limits 3, HTTP API and validation order 4, SSE 4.1, pages and security 5,
persistence and lifecycle 6.

**Hidden tests** (`holdout/`) check the design's stated rules on inputs you have not seen: unseen phrases and
pairs, reversed pairs, boundary lengths in code points, clamping, validation order, body-size limits, corrupt
data files, restart determinism. Every rule in design.md must hold in general, not just for the visible tests.
Never special-case test inputs.

## Layout (repo root)
```
package.json      no dependencies, no devDependencies; "test": "node --test tests/ acceptance/"
src/              all logic (CommonJS). Module list: design.md section 1
public/           static front end: index.html, home.js, wall.js, wall.css, case.css, case.js (render only)
tests/            unit tests: tests/*.test.js, node:test + node:assert, require from ../src/
acceptance/       HTTP acceptance tests (read-only for the builder)
```

## Non-negotiables
1. Zero runtime and dev dependencies. Only Node 22 built-ins (`node:http`, `node:fs`, `node:crypto`, ...).
2. CommonJS (`require`/`module.exports`) in `src/`.
3. All logic with a branch lives in `src/`. `public/` only renders data the server sends; the browser never
   computes art, findings, score, status or detective picks (ADR 0001).
4. `node src/server.js` starts the server. `src/server.js` exports `createServer(opts)` and, when
   `require.main === module`, calls `require('./main').start()`. `node src/main.js` also starts it.
5. `PORT` env (default 3000); `PORT=0` picks a free port. After listening print exactly one stdout line:
   `listening on http://127.0.0.1:<port>`. `HOST` default `127.0.0.1`. `RED_STRING_DATA` enables persistence.
   `RATE_LIMIT=0` disables rate limiting.
6. SIGTERM and SIGINT: flush pending save, end SSE streams, close server, exit code 0 within 2 s.
7. Unit tests live in `tests/*.test.js`, use `node:test`, and `require('../src/<module>')`. Every `src/` module
   has a unit test file. Tests go through module interfaces, not internals.
8. No inline `<script>` or `<style>` anywhere; CSP and security headers on every response (design 5).
9. Never insert user text with `innerHTML`; escape all user text in server HTML.
10. No network fonts, images or third-party origins.

## Done definition
```
node .claude/harness/bin/verify.js
```
exits 0. `acceptance/`, `verify.config.json` and `spec.md` are read-only: do not edit them to make checks pass.
Also: every task in `TASKS.md` has `status: done`.

## Out of scope
Accounts, auth, image upload, external fetches, web fonts, a database, any npm package, a build step or bundler.

## Constraints
- Never commit secrets; config comes only from environment variables listed above.
- No user data in logs beyond ids.
