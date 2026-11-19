# Reviews: red-string (commit be8f5c3)

Four reviewers ran in parallel, each given `ux.md` and `design.md` as hard requirements.
No reviewer reported a CRITICAL or HIGH finding.

Disposition key: FIX (sent to the fix round), ACCEPT (logged, not built, with the reason).

## Code review (code-reviewer)

| # | Sev | Where | Finding | Disposition |
|---|-----|-------|---------|-------------|
| C1 | MEDIUM | `public/wall.js` removePinLocal | A pin deleted by a colleague while you drag it leaves `dragging` set, so no pin can be dragged until reload | FIX |
| C2 | MEDIUM | `public/wall.js` initial load | A slow initial GET can overwrite newer state that already arrived over SSE | FIX |
| C3 | MEDIUM | `src/main.js` stop | A change accepted after the shutdown flush is never saved | FIX |
| C4 | MEDIUM | `src/persist.js` | A failed save clears the dirty flag, so it is never retried | FIX |
| C5 | LOW | `public/wall.js` phrase form | Double Enter creates two pins | FIX |
| C6 | LOW | `public/wall.js` send chain | One exception in the chain stops all later pin creation | FIX |
| C7 | LOW | `public/wall.js` 404 on removed item | Shows "No such case" for a pin or string a colleague already removed | FIX |
| C8 | LOW | `public/wall.js` title | The PATCH response overwrites text typed after Enter | FIX |
| C9 | LOW | `src/persist.js` | Whole-store synchronous write on each debounce tick | ACCEPT: see P3 |

## Security review (security-reviewer)

Checked and clean: HTML, SVG and DOM XSS, CSP on every response, path traversal, prototype pollution,
id predictability (72-bit wall ids), body limits, SSE frame injection.

| # | Sev | Where | Finding | Disposition |
|---|-----|-------|---------|-------------|
| S1 | MEDIUM | `src/sse.js`, `src/server.js` | No per-IP or global cap on SSE streams: one client can take all 50 seats on a wall | FIX: add a per-IP cap per wall and a global cap beside the designed 50 per wall |
| S2 | MEDIUM | `src/store.js` | 10 000 wall slots, never evicted: one address can fill them in about 6 minutes | ACCEPT: needs an eviction policy the design does not have. Listed as a known limit; do not expose to the internet as is |
| S3 | MEDIUM | `src/main.js` / server | Node default timeouts allow slow-client connection holding | FIX: set `requestTimeout`, `headersTimeout` |
| S4 | MEDIUM | `src/ratelimit.js` | Keyed on socket address only; no bucket cap; IPv6 rotation | FIX the bucket cap only. Proxy trust and /64 keying change the design: ACCEPT, logged |
| S5 | LOW | `src/persist.js` | Blocking full write | ACCEPT: see P3 |
| S6 | LOW | `src/persist.js` | Predictable temp file name | ACCEPT: single-user data directory |
| S7 | LOW | `src/store.js` load | `createdAt` copied from the file unchecked | FIX |
| S8 | LOW | headers | No extra hardening headers | ACCEPT: the header set is fixed by the design |
| S9 | LOW | logging | No counters for 429 or oversize bodies | ACCEPT |

## Performance review (performance-optimizer)

Measured at 100 pins and 500 strings: movePin 0.05 ms, getWall 0.06 ms, detective 2.6 ms. No HIGH.

| # | Sev | Where | Finding | Disposition |
|---|-----|-------|---------|-------------|
| P1 | MEDIUM | `public/wall.js` layoutStrings | Reads and writes interleaved; full-wall layout every frame after a drop; overlapping animation loops | FIX |
| P2 | MEDIUM | `public/wall.js` pointermove | Not throttled to animation frames | FIX |
| P3 | MEDIUM | `src/persist.js` | Whole dataset rewritten synchronously per save; fails past about 512 MB | ACCEPT: the design fixes "debounce 50 ms, atomic rename, whole file". Fine for a toy wall; a per-wall file is the follow-up |
| P4 | MEDIUM | `src/store.js` load | Quadratic duplicate checks per wall at boot | FIX: use sets |
| P5 | LOW | `public/wall.js` applySnapshot | One full string layout per string in a snapshot | FIX |
| P6 | LOW | `src/static.js` | No ETag or in-memory cache | ACCEPT |
| P7, P8 | LOW | SSE fan-out, art cache | No problem found | none |

## Accessibility review (a11y-architect)

Read from the code and CSS, not rendered; contrast computed from the hex values.

| # | Sev | Where | Finding | Disposition |
|---|-----|-------|---------|-------------|
| A1 | HIGH | `src/pages.js` 404 page | "Open a new case" link has class `primary` but only `.btn.primary` is styled: about 1.8:1 contrast in a dark OS theme, and under the 24px target size | FIX |
| A2 | HIGH (reviewer: likely, unrendered) | `public/wall.css` header at 390px | The controls row may overflow horizontally. Builder C measured `scrollWidth` 390 in a browser, so this is disputed | FIX if reproduced in the browser during the fix round |
| A3 | MEDIUM | `public/wall.css` string focus | Yellow ring on the Day cork is about 1.6:1; ux.md asks 3:1 | FIX |
| A4 | MEDIUM | `public/wall.css` `--string` | Day string red on cork is about 2.6:1; ux.md asks 3:1 | FIX |
| A5 | MEDIUM | panels | An open panel can cover the focused pin or string | FIX |
| A6 | MEDIUM | `conn-status`, `action-error` | Connection changes are not announced; the error toast disappears after 6 s | FIX |
| A7 | MEDIUM | Detective panel | The suggestion text is not read when focus lands on "Tie it" | FIX |
| A8 | MEDIUM, ESCALATE | pin widget | `role=group` and the literal button text are fixed by ux.md | FIX the additive parts only (`aria-describedby` key hints, `aria-roledescription`). Button names and role unchanged. A pointer "Move" control: ACCEPT, logged as a follow-up |
| A9 | MEDIUM | wall page | No `<main>` or heading | FIX |
| A10 | LOW, ESCALATE | string hit area | 22px against a 24px minimum; ux.md says 20px | ACCEPT: ux.md wins; strings are keyboard reachable |

## Fix round outcome

All findings marked FIX were fixed, with these exceptions and caveats:
- **S1 is only partly effective.** The global cap of 2000 streams is live. The per-address cap exists but defaults to 60, above the 50 per wall, so it never binds by default: an acceptance test opens 50 streams on one wall from one address and must pass. One client can still take every seat on a single wall. It is configurable lower (`maxPerAddr`).
- **A2 did not reproduce.** Measured in Chromium at 390x844 with every connection text: page `scrollWidth` is 390. No change made.
- **A8:** additive parts only, as planned. A pointer "Move" control for touch screen-reader users is still open.
- **C8** (title overwrite) and **A7** (Detective text read on focus) were fixed in code but not checked in a browser or with a screen reader.
- Contrast after A3/A4: Day string red 4.08:1 on the cork (was 2.59:1); string focus ring 8.34:1 (was 1.57:1).
