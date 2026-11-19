# RED STRING: design

Inputs: `brief.md`, `ux.md` (hard requirements). ADRs: `adr/0001`..`adr/0006`.
Node 22, CommonJS, zero runtime dependencies, `node:test`. All "MUST" text below is a contract between tests and server.

## 1. Repository layout (repo root)
```
package.json          "scripts": {"start":"node src/main.js","test":"node --test tests/ acceptance/"}, no dependencies
verify.config.json    srcDirs ["src"], testQuality.dirs ["tests","acceptance"], holdout -> holdout/*.test.js
src/
  main.js        entry: reads env, loads store, listens, SIGTERM/SIGINT -> flush + close + exit 0
  server.js      createServer({store, persist, rateLimit, publicDir}) -> http.Server (no listen)
  router.js      method+path matching, returns {handler, params} or 404/405
  http.js        readJsonBody(req, limit), sendJson, sendError, security headers
  normalize.js   normalizePhrase(raw) -> {ok, value} | {ok:false, code}
  hash.js        fnv1a32(string) over UTF-8 bytes; mulberry32(seed) PRNG
  art.js         artSvg(phrase) -> string (deterministic SVG)
  findings.js    finding(phraseA, phraseB) -> string; TEMPLATES
  score.js       score(wall) -> {score, level, status}; THRESHOLDS, STATUSES
  detective.js   suggest(wall) -> {pair:[idA,idB]} | {decline:"too_few"|"all_connected"}
  validate.js    coordinates, ids, title, pin/string bodies
  store.js       in-memory walls + mutations; emits change events; limits
  persist.js     load(file) / scheduleSave / flush (atomic write)
  sse.js         Hub: subscribe(wallId,res), publish(wallId,event,data), heartbeat
  ratelimit.js   token bucket per client IP
  pages.js       escapeHtml, caseFileHtml(wall), notFoundHtml(), wallShellHtml()
  static.js      safe static file serving from public/
public/          index.html, wall.js, wall.css, home.js, case.css (no inline script or style)
tests/           unit tests per src module
acceptance/      HTTP tests: spawn `node src/main.js` with PORT=0, read port from stdout
holdout/         hidden HTTP tests (same harness, different cases)
```
Rule: any logic with a branch lives in `src/`. `public/` only renders server data. The browser never computes art, findings, score or status; it receives them (ADR 0001).

## 2. Deterministic rules

### 2.1 Phrase normalisation (`normalize.js`)
Applied to pin phrases and wall titles, in order:
1. Not a string -> error `phrase_invalid` (400).
2. `s.normalize("NFC")`.
3. Remove every char in Unicode category Cc (`/\p{Cc}/gu`) except whitespace (tab, LF, CR are treated as whitespace in step 4). Also remove U+200B..U+200D, U+2060, U+FEFF.
4. Collapse every run of `/\s+/u` to one U+0020, then trim.
5. Empty -> `phrase_empty`. Length counted in code points (`[...s].length`); > 60 -> `phrase_too_long`.
Case is preserved for display. The **key** used for art and findings is `value.toLowerCase()`, so "Pigeons" and "pigeons" share art and findings.
Examples: `"  the\t\nmoon "` -> `"the moon"`; `"\u0007"` -> empty; 60 x "a" ok; 61 x "a" too long; `"é"` (e + U+0301) -> `"é"` (1 code point).

### 2.2 Hash and PRNG (`hash.js`, ADR 0005)
`fnv1a32(str)`: offset 2166136261, prime 16777619, over `Buffer.from(str,"utf8")`, `Math.imul`, result `>>> 0`.
`mulberry32(seed)` returns a function giving floats in [0,1). Standard algorithm.

### 2.3 Art (`art.js`)
`artSvg(phrase)`: `rnd = mulberry32(fnv1a32("art:" + key))`.
- Palette: one of 8 fixed 4-colour palettes, index `floor(rnd()*8)`; background = palette[0].
- Output exactly: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" focusable="false">` + `<rect width="100" height="100" fill="#xxxxxx"/>` + N shapes + `</svg>`, N = `3 + floor(rnd()*4)` (3..6).
- Each shape kind = `floor(rnd()*3)`: 0 `<circle cx cy r fill/>`, 1 `<rect x y width height fill transform="rotate(a 50 50)"/>`, 2 `<polygon points="x1,y1 x2,y2 x3,y3" fill/>`. Numbers in 0..100 printed with `toFixed(1)`; fill from palette[1..3]; optional `opacity` 0.5..1.0.
- Never contains the phrase, text, `href`, `url(`, `<script`, `on*` attributes, or any other origin. No whitespace between tags. Same key -> byte-identical string.

### 2.4 Findings (`findings.js`)
`finding(pA, pB)`: keys `kA, kB`; order the pair so `first` is the phrase whose key sorts lower (`<` on strings; ties keep both equal). `h = fnv1a32("finding:" + k1 + "\u0000" + k2)`; template = `TEMPLATES[h % TEMPLATES.length]` (at least 16 templates, each containing `{A}` and `{B}` once). Substitute `{A}`=first phrase, `{B}`=second phrase (display form as stored on each pin). Output is plain text (escaped where rendered). Example template: `"{A} and {B} were never seen in the same room. That is not an accident."` Pair order on the request never changes the text.

### 2.5 Score and status (`score.js`, ADR 0003)
Let `S` = strings, `deg(p)` = strings touching pin p, `C` = pins with `deg >= 1`.
`score = 10*S + 2*C + 5 * Σ max(0, deg(p) - 1)`.
Unconnected pins score 0 (required by ux UC1/UC8: a wall with pins and no strings shows 0).
| level | status | score >= |
|---|---|---|
| 0 | Hunch | 0 |
| 1 | Theory | 20 |
| 2 | Pattern | 60 |
| 3 | Cover-up | 120 |
| 4 | They don't want you to know | 200 |
Checks: 1 string = 14 (Hunch); 2 strings >= 24 (Theory); 4 strings on 8 pins >= 56. 8 pins all 28 strings = 280+16+240 = 536; star order (0-1..0-7, then 1-2..) reaches 200 at string 13 (130+16+5*(6+5+…)) well within 28. Score is monotone in adding strings, so `data-level` never drops in UC10. Deleting strings lowers score (allowed).

### 2.6 Detective (`detective.js`)
- Fewer than 2 pins -> decline `too_few`.
- Candidate pairs: all unordered pairs `(i<j)` by pin creation order, not yet tied. None -> decline `all_connected`.
- Pick the candidate with the lowest `deg(i)+deg(j)`; tie -> highest `fnv1a32("detective:"+k1+"\u0000"+k2)` (sorted keys as 2.4); tie -> earliest `(i,j)`. Pure function of wall state.

### 2.7 Pin position default
If `x`,`y` absent on create: `h = fnv1a32("pos:" + key + ":" + pinCount)`; `x = 100 + h % 801`, `y = 100 + (h >>> 12) % 801`.
Coordinates: must be finite JSON numbers (else 400 `bad_coords`); then clamped to 0..1000 and rounded to integer. Out-of-range is clamped, not refused (ux: dragging off the board clamps).

## 3. Data model
```
Wall   {id, title, createdAt, version, pins: Pin[], strings: Str[]}   // arrays in creation order
Pin    {id, phrase, x, y, art, createdAt}                              // art cached = artSvg(phrase)
Str    {id, a, b, finding, createdAt}                                  // a,b pin ids as given by first tie
```
Ids: `crypto.randomBytes(n).toString("base64url")`. Wall id 12 chars (9 bytes); pin `p` + 8 chars; string `s` + 8 chars. Id regex for routing: `^[A-Za-z0-9_-]{1,32}$`; others 404.
`version` increments on every mutation. Default title `Case #<id>`.
Limits: 100 pins/wall, 500 strings/wall, 10 000 walls/process (503 `capacity`), body 4096 bytes, phrase/title 60 code points.

## 4. HTTP API
All JSON responses: `content-type: application/json; charset=utf-8`. Request bodies are parsed as JSON regardless of content-type. Clients MAY send `X-Client-Id` (`^[A-Za-z0-9_-]{1,32}$`); it is echoed in SSE events as `by`.
**Error body (every 4xx/5xx JSON):** `{"error":{"code":"<code>","message":"<ux copy>"}}`.
| code | status | message |
|---|---|---|
| bad_json | 400 | Request body must be a JSON object. |
| too_large | 413 | Request body too large. |
| phrase_empty / title_empty | 400 | Say something. Even a hunch has a word in it. |
| phrase_too_long / title_too_long | 400 | Too long. Evidence must fit on a card: 60 characters, tops. |
| phrase_invalid | 400 | Say something. Even a hunch has a word in it. |
| wall_full | 400 | The wall is full. 100 pins is where the trail goes cold. |
| strings_full | 400 | No more string. 500 is where the trail goes cold. |
| bad_coords | 400 | Position must be numbers. |
| bad_pin | 400 | Both pins must be on this wall. |
| self_link | 400 | A pin cannot be linked to itself. |
| duplicate_string | 409 | Those two are already connected. I checked. |
| not_found | 404 | No such case |
| method_not_allowed | 405 | Method not allowed. (+ `Allow` header) |
| rate_limited | 429 | Slow down, detective. (+ `Retry-After: 1`) |
| capacity | 503 | The archive is full. |
| internal | 500 | The wall would not talk. |
Body must be a JSON object (not array/null) where a body is required; empty body on POST /api/walls is allowed. Unknown fields are ignored.

`Meta` = `{"score":n,"level":0..4,"status":"Hunch",...,"version":n}`. `WallJson` = `{id,title,createdAt,version,pins:[Pin],strings:[Str],score,level,status}`.

| Method & path | Body | Success | Errors |
|---|---|---|---|
| POST /api/walls | `{}` or `{"title":s}` optional | 201 WallJson | 400 title_*, bad_json, 413, 429, 503 |
| GET /api/walls/:id | – | 200 WallJson | 404 |
| PATCH /api/walls/:id | `{"title":s}` | 200 `{title, ...Meta}` | 400 title_*, 404 |
| POST /api/walls/:id/pins | `{"phrase":s, "x"?:n, "y"?:n}` (both or neither; one alone = bad_coords) | 201 `{pin, ...Meta}` | 400 phrase_*, wall_full, bad_coords, 404 |
| PATCH /api/walls/:id/pins/:pid | `{"x":n,"y":n}` | 200 `{pin, ...Meta}` | 400 bad_coords, 404 (wall or pin) |
| DELETE /api/walls/:id/pins/:pid | – | 200 `{id, removedStrings:[sid], ...Meta}` | 404 |
| POST /api/walls/:id/strings | `{"a":pid,"b":pid}` | 201 `{string, ...Meta}` | 400 self_link, bad_pin (unknown/missing id), strings_full; 409 duplicate_string; 404 wall |
| DELETE /api/walls/:id/strings/:sid | – | 200 `{id, ...Meta}` | 404 |
| GET /api/walls/:id/detective | – | 200 `{"suggestion":{"a":pid,"b":pid,"message":s}}` or `{"suggestion":null,"reason":"too_few"|"all_connected","message":s}` | 404 |
| GET /api/walls/:id/events | – | 200 SSE | 404 |
| GET / | – | 200 home HTML | |
| GET /w/:id, /w/:id/ | – | 200 wall shell HTML | 404 notfound HTML |
| GET /w/:id/case | – | 200 server-rendered case file | 404 notfound HTML |
| GET /static/* | – | 200 file | 404 |
| GET /healthz | – | 200 `{"ok":true}` | |
Duplicate string = same unordered pair `{a,b}` already exists (either direction). Self check precedes existence check of B only if `a===b`. Validation order on POST strings: body -> wall 404 -> self_link -> bad_pin -> duplicate -> strings_full. On POST pins: body -> wall 404 -> phrase -> coords -> wall_full.
Detective messages: teaser `I like <A> and <B> together. Nobody ever asks why.` (A,B in creation order); `Two pins minimum. Even I cannot connect a single dot.`; `Everything is already connected. That is what worries me.` Accepting = client POSTs the string. The detective endpoint does not mutate.
Deleting a pin deletes its strings. Duplicate phrases on one wall are allowed (ADR 0006). DELETE of an already-deleted pin/string -> 404.
Unknown `/api/*` path -> 404 JSON; known path wrong method -> 405 JSON.

Example:
```
POST /api/walls/Ab3_x9QzLm0P/strings   {"a":"pK2l9xQ_a","b":"pZ0aa1b2c"}
201 {"string":{"id":"sQ1w2e3r4","a":"pK2l9xQ_a","b":"pZ0aa1b2c","finding":"pigeons and the moon were never seen in the same room. That is not an accident.","createdAt":"2026-11-19T10:00:00.000Z"},"score":14,"level":0,"status":"Hunch","version":3}
POST same pair reversed -> 409 {"error":{"code":"duplicate_string","message":"Those two are already connected. I checked."}}
```

### 4.1 Server-Sent Events
`GET /api/walls/:id/events`: headers `content-type: text/event-stream`, `cache-control: no-store`, `x-accel-buffering: no`. First write `retry: 1000\n\n`, then a `snapshot` event. Each event: `id: <version>\nevent: <name>\ndata: <json one line>\n\n`. Heartbeat `: ping\n\n` every 15 s. Published synchronously after the mutation commits, before the HTTP response is sent.
| event | data |
|---|---|
| snapshot | WallJson |
| pin-added | `{pin, by, ...Meta}` |
| pin-moved | `{id, x, y, by, ...Meta}` |
| pin-removed | `{id, phrase, removedStrings:[sid], by, ...Meta}` |
| string-added | `{string, by, ...Meta}` |
| string-removed | `{id, by, ...Meta}` |
| title | `{title, by, ...Meta}` |
`by` = request's `X-Client-Id` or `null`. On reconnect the client ignores `Last-Event-ID` resume: the server always sends a fresh `snapshot` (ux J15). Max 50 subscribers per wall (more -> 503 `capacity`). Closed sockets are removed on `close`.

## 5. Pages and security
- **Headers on every response:** `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. No inline script/style anywhere (SVG `fill` attributes are presentation attributes, allowed by CSP).
- **Escaping:** `escapeHtml` replaces `& < > " '` with entities. Case file and any server HTML escape phrases, titles and findings. Art SVG contains no user text, so it is embedded raw. The client sets user text with `textContent`/`setAttribute` only, and inserts art via `DOMParser(…,"image/svg+xml")` + `importNode`; never `innerHTML` with user text.
- **Wall shell** contains no user data; the client loads `GET /api/walls/:id`. Unknown id -> notfound page (404) with `notfound-title`, `notfound-text`, `notfound-home`.
- **Case file** (`pages.caseFileHtml`) renders `case-title`, `case-status` (`data-level`), `case-score`, `case-evidence` items (`data-phrase`, art, phrase), `case-findings` as `<ol>`, `case-print`, `case-back`; adds class `many` when pins > 24 for thumbnails; "No evidence. No case." when empty. `case-print` is wired by `/static/case.js`.
- **Static files:** only `GET /static/<name>` where name matches `^[A-Za-z0-9._-]+$` and is not `.`/`..`; resolved path must start with `publicDir + sep`; fixed MIME map (html, js, css, svg, ico); anything else 404. `/` serves `public/index.html`.
- **Rate limit:** token bucket per `req.socket.remoteAddress` on mutating requests (POST/PATCH/DELETE): capacity 120, refill 30/s. `RATE_LIMIT=0` disables. 429 on empty bucket. Buckets idle > 60 s are dropped.
- **Body:** read up to 4096 bytes; more -> 413 and stop reading (connection closed after response). Non-UTF-8 or non-JSON -> 400 `bad_json`.
- No user data in logs beyond ids.

## 6. Persistence and lifecycle (ADR 0004)
- `PORT` env (default 3000); `PORT=0` picks a free port. After listen, print exactly one line `listening on http://127.0.0.1:<port>` to stdout. `HOST` default `127.0.0.1`.
- `RED_STRING_DATA=<path>` enables persistence; unset = memory only.
- File format: `{"format":1,"walls":[Wall...]}`. On boot: missing file -> empty; unreadable/invalid JSON/wrong format -> log one line to stderr, rename to `<path>.corrupt-<epochms>`, start empty (never crash, never overwrite silently). Individual invalid walls/pins are skipped; `art` is recomputed from phrase and `finding` recomputed on load (so code fixes apply).
- Save: after each mutation, debounce 50 ms, write `<path>.tmp-<pid>` then `fs.renameSync` over the target (atomic on same filesystem). Write errors are logged; the server keeps serving.
- SIGTERM/SIGINT: flush pending save synchronously, end SSE streams, `server.close()`, `process.exit(0)` within 2 s (force-close lingering sockets). Required for coverage.
- Uncaught handler errors -> 500 `internal`, server keeps running.
- Failure modes: disk full -> memory still authoritative, warning logged; concurrent edits -> last write wins per field; SSE client dropped -> client reconnects (retry 1000 ms) and gets a snapshot.

## 7. Test strategy
- **Unit (`tests/`)**: normalize (each rule and boundary 60/61, NFC, controls, zero-width); hash vectors (`fnv1a32("")===2166136261`, `fnv1a32("a")===0xe40c292c`); art determinism, difference, structure regex, absence of `<script|href|url\(|on\w+=`; finding symmetry, case-insensitivity, both phrases present, distinct pairs differ for a fixed sample; score formula table incl. each threshold at `t-1` and `t` and the 8-pin loop reaching level 4; detective decline cases, lowest-degree pick, tie-breaks; validate coords (clamp, round, NaN/strings refused); store limits (100th ok, 101st wall_full; 500 strings), cascade delete; router 404/405; escapeHtml; static path traversal (`..%2f`, encoded, absolute); ratelimit bucket refill with injected clock; persist atomic write, corrupt file rename, reload equality; SSE hub publish/unsubscribe with fake res.
- **Acceptance (`acceptance/`)**: spawn server (`PORT=0`, temp `RED_STRING_DATA`), exercise every route in section 4 incl. each error code and body shape, SSE (`snapshot` then `pin-added` within 1 s with `by`), case file escaping of `<img src=x onerror=alert(1)>`, 404 pages, CSP header, restart persistence, SIGTERM exit code 0.
- **Holdout (`holdout/`)**: unseen phrases and pairs for determinism across walls and restarts, reversed-pair findings, UC10-style 8-pin loop via API with monotone level reaching 4, detective rule on a crafted wall, 61-code-point emoji phrase, 4097-byte body -> 413, duplicate reversed string 409, unknown pin in string 400, coordinate clamping (-5 -> 0, 1000.6 -> 1000), corrupt data file boot.

## 8. ux.md items flagged
- **Score of unconnected pins is 0.** brief says score counts pins; ux UC1/UC8 require 0 with pins and no strings, so only connected pins count (ADR 0003). Not a removal; a reconciliation.
- **Duplicate phrases are allowed**, so the Playwright helper `pin(phrase)` can match two pins; tests must use distinct phrases (ADR 0006).
- **UC20 axe-core** cannot come from `node_modules` under zero dependencies unless installed as a devDependency by the test runner; the check skips as ux.md already permits.
- **String cap 500** is new (brief only caps pins); it never limits UC10 (28 strings).
Everything else in ux.md is buildable as written.
