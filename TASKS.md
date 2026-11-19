# Tasks

> Build backlog for RED STRING. Contract: `spec.md`; rules: `docs/product/red-string/design.md` (server) and
> `ux.md` (UI). `node .claude/harness/bin/next-task.js TASKS.md` lists ready tasks.
> All tasks are AFK. Three builders can run in parallel, one per group; a group edits only the files it owns.

**File ownership**
- Group A (pure logic): `src/normalize.js`, `src/hash.js`, `src/art.js`, `src/findings.js`, `src/score.js`,
  `src/detective.js`, `src/validate.js`, and `tests/{normalize,hash,art,findings,score,detective,validate}.test.js`.
- Group B (server): `package.json`, `src/main.js`, `src/server.js`, `src/router.js`, `src/http.js`, `src/store.js`,
  `src/persist.js`, `src/sse.js`, `src/ratelimit.js`, `src/static.js`, and their `tests/*.test.js`.
- Group C (front end + HTML): `public/*` and `src/pages.js`, `tests/pages.test.js`.
- Nobody edits `acceptance/`, `verify.config.json`, `spec.md`.

**Module interfaces (build against these; all CommonJS `module.exports = {...}`)**
- A `normalize.js`: `normalizePhrase(raw) -> {ok:true, value, key} | {ok:false, code}`; code is
  `phrase_invalid|phrase_empty|phrase_too_long`. `key = value.toLowerCase()`. `normalizeTitle(raw)` same shape
  with codes `title_empty|title_too_long` (non-string title -> `title_empty`).
- A `hash.js`: `fnv1a32(str) -> uint32`, `mulberry32(seed) -> () => float in [0,1)`.
- A `art.js`: `artSvg(phrase) -> string` (key derived internally via toLowerCase).
- A `findings.js`: `finding(phraseA, phraseB) -> string`, `TEMPLATES: string[]` (>= 16).
- A `score.js`: `score(wall) -> {score, level, status}`; `THRESHOLDS = [0,20,60,120,200]`,
  `STATUSES = ["Hunch","Theory","Pattern","Cover-up","They don't want you to know"]`. `wall` needs `{pins:[{id}], strings:[{a,b}]}`.
- A `detective.js`: `suggest(wall) -> {pair:[idA,idB]} | {decline:"too_few"|"all_connected"}` (ids in creation
  order); `message(result, wall) -> string` returns the design 4 detective copy.
- A `validate.js`: `coords(body) -> {ok:true, x, y} | {ok:true, absent:true} | {ok:false, code:"bad_coords"}`
  (both-or-neither, finite numbers, clamp 0..1000, round); `defaultPos(key, pinCount) -> {x, y}` (design 2.7);
  `isId(s) -> bool` (`^[A-Za-z0-9_-]{1,32}$`); `isPlainObject(v) -> bool`.
- B `store.js`: `createStore({onChange})`; methods return `{ok:true, ...result, meta}` or `{ok:false, code}`:
  `createWall({title?})`, `getWall(id) -> WallJson|null`, `setTitle(id, raw)`, `addPin(id, body)`,
  `movePin(id, pid, body)`, `removePin(id, pid)`, `addString(id, a, b)`, `removeString(id, sid)`,
  `detective(id)`, `toJSON() -> {format:1, walls}`, `load(data)`. `meta = {score, level, status, version}`.
  `onChange(wallId, eventName, data)` fires synchronously after each commit (data without `by`).
- B `sse.js`: `createHub({heartbeatMs})` with `subscribe(wallId, res, snapshot)`, `publish(wallId, event, data)`,
  `count(wallId)`, `closeAll()`.
- B `server.js`: `createServer({store, persist, rateLimit, publicDir}) -> http.Server` (no listen).
  `main.js`: `start({env}) -> Promise<{server, port, stop()}>`.
- C `pages.js`: `escapeHtml(s)`, `caseFileHtml(wallJson) -> string`, `notFoundHtml() -> string`,
  `wallShellHtml() -> string`, `homeHtml() -> string` (or B serves `public/index.html`). Server calls these;
  C does not touch server files. Front end uses only the HTTP API and SSE in design 4 / 4.1.

## T1: Tracer bullet: create a wall, add a pin with art, see it on /w/<id>
- type: AFK
- blocked-by: none
- status: todo

Done when: `node src/server.js` with PORT=0 prints the listening line; POST /api/walls then POST pins returns
201 with `pin.art`; GET /w/<id> shell loads and shows the pin. Minimal stubs in each group's files are allowed,
owned files only. Tests: one unit test per touched module plus acceptance smoke passes.
Group: B (with stubs for A/C entry points, replaced later by their owners).

## T2: Phrase normalisation and title validation
- type: AFK
- blocked-by: none
- status: todo

Done when: design 2.1 holds incl. NFC, Cc and zero-width removal, whitespace collapse, 60/61 code points.
Group: A. Tests: `tests/normalize.test.js`.

## T3: Hash, PRNG and deterministic art
- type: AFK
- blocked-by: none
- status: todo

Done when: design 2.2 vectors and 2.3 structure, determinism and forbidden-content rules hold.
Group: A. Tests: `tests/hash.test.js`, `tests/art.test.js`.

## T4: Findings
- type: AFK
- blocked-by: T3
- status: todo

Done when: design 2.4 symmetry, case-insensitive keys, >= 16 templates. Group: A. Tests: `tests/findings.test.js`.

## T5: Score, status and detective
- type: AFK
- blocked-by: T3
- status: todo

Done when: design 2.5 table at t-1/t, 8-pin loop reaches level 4 monotonically; design 2.6 declines and
tie-breaks; detective copy. Group: A. Tests: `tests/score.test.js`, `tests/detective.test.js`.

## T6: Coordinate and id validation
- type: AFK
- blocked-by: T3
- status: todo

Done when: design 2.7 default position, clamping (-5 -> 0, 1000.6 -> 1000), NaN/strings/one-axis refused.
Group: A. Tests: `tests/validate.test.js`.

## T7: Store and full JSON API with error codes and validation order
- type: AFK
- blocked-by: T1, T2, T4, T5, T6
- status: todo

Done when: every route and error code in design 4 incl. limits (100 pins, 500 strings, 10 000 walls),
validation order, cascade delete, 404/405 JSON, body 4096 -> 413, bad_json. Group: B.
Tests: `tests/store.test.js`, `tests/router.test.js`, `tests/http.test.js`.

## T8: Live updates over SSE
- type: AFK
- blocked-by: T7
- status: todo

Done when: design 4.1 snapshot first, events with `id`/`by`, heartbeat, 50-subscriber cap, cleanup on close.
Group: B. Tests: `tests/sse.test.js` (fake res).

## T9: Persistence, lifecycle, rate limit, static files, security headers
- type: AFK
- blocked-by: T7
- status: todo

Done when: design 6 atomic save, corrupt-file rename, reload recomputes art/finding, SIGTERM exit 0; design 5
rate limit, static path safety, CSP headers. Group: B.
Tests: `tests/persist.test.js`, `tests/ratelimit.test.js`, `tests/static.test.js`, `tests/main.test.js`.

## T10: Server-rendered case file and not-found page
- type: AFK
- blocked-by: T1
- status: todo

Done when: design 5 case file testids, escaping of `<img src=x onerror=alert(1)>`, `many` class over 24 pins,
empty-state copy; not-found page testids; `public/case.css`, `public/case.js` (print). Group: C.
Tests: `tests/pages.test.js`.

## T11: Home and wall front end: pins, drag, strings, score, detective, live sync
- type: AFK
- blocked-by: T1
- status: todo

Done when: every ux.md screen, testid, copy string, state and accessibility rule is implemented in `public/`
using only the API; art inserted via DOMParser; user text via textContent; reconnects SSE and applies snapshot.
Group: C. Tests: through the HTTP API in acceptance; no logic in `public/` to unit test.

## T12: Full verify green
- type: AFK
- blocked-by: T8, T9, T10, T11
- status: todo

Done when: `node .claude/harness/bin/verify.js` exits 0 and all tasks are done. Group: any (B by default).
