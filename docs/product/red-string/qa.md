# RED STRING: QA (phase 7)

Commit 790eb57. Re-run: `node qa/walkthrough.js` (starts its own server, writes `docs/product/red-string/qa/results.json` and screenshots, exit 1 on any failure). Result: 48 pass, 4 fail, 1 skipped of 53 rows (rows include extra checks X1-X7 and J-level sub-checks).

## Results

| Check | Result | Evidence |
|---|---|---|
| J1 | pass | all of UC1, J1.live pass |
| J2 | pass | all of UC2, UC3, J2.extra pass |
| J3 | pass | all of UC4 pass |
| J4 | pass | all of UC5, UC6 pass |
| J5 | fail | failing checks: X6 |
| J6 | pass | all of UC9 pass |
| J7 | pass | all of UC10, J7.announce pass |
| J8 | pass | all of UC11, UC12 pass |
| J9 | pass | all of UC13 pass |
| J10 | pass | all of UC14, X1, J10.extra pass |
| J11 | pass | all of UC15, J11.sigterm pass |
| J12 | pass | all of UC16, UC17, UC18, X2 pass |
| J13 | pass | all of UC19, UC20, X3, X4 pass |
| J14 | fail | failing checks: X7 |
| J15 | pass | all of UC22 pass |
| J16 | pass | all of UC23 pass |
| UC1 | pass | POST 201, id=xO5tQPtbhf4j ; screenshot 01-home, 02-empty-wall |
| UC2 | pass |  |
| UC3 | pass |  |
| UC4 | pass | art identical x3; moon differs; 0 foreign requests |
| UC5 | pass | lean max 14deg mid-drag; data-x/y = card centre, 2.8 units from rect |
| UC6 | pass |  |
| UC7 | pass | A strange hum was recorded whenever pigeons met the moon. ; screenshot 05-finding-panel |
| UC8 | pass | score 14 -> 0 |
| UC9 | pass | A strange hum was recorded whenever pigeons met the moon. / pigeons is just ufo with better public relations. |
| UC10 | pass | 12 strings to level 4: 14/0 ... 216/4 |
| UC11 | pass | I like pigeons and the moon together. Nobody ever asks why. ; screenshot 06-detective-panel |
| UC12 | pass |  |
| UC13 | pass | SSE text/event-stream; B updated within 1500ms |
| UC14 | pass | one page for 3, 30 (and 100) pins ; screenshot 07-case-file |
| UC15 | pass | SIGTERM exit 0; score 31 kept |
| UC16 | pass | screenshot 08-404 |
| UC17 | pass |  |
| UC18 | pass |  |
| UC19 | pass | moved 315,399->345,439 |
| UC20 | pass | 14 tab stops outlined; string uses stroke ring ; screenshot 12-string-focus-ring |
| UC21 | pass | scrollWidth 390; gutter 16; targets >=44; sheet 188px (22% vh) inside viewport ; screenshot 09-wall-390, 10-finding-panel-390 |
| UC22 | pass | conn-status reconnecting then Live |
| UC23 | pass | score contrast 15.14; toggle persists; lean 0, 0 animations ; screenshot 11-wall-reduced-motion |
| UC20-axe | skipped | axe-core is not installed (no node_modules/axe-core); ux.md allows skipping. No automated axe scan was run. |
| X1 | pass |  |
| X2 | pass | {"lc":"2","ov":"hidden","to":"clip","h":42.913787841796875,"lh":16} |
| X3 | pass |  |
| X4 | pass |  |
| X5 | pass | {"inL":16,"inR":16,"bh":536.84375,"fh":188.03125,"pw":112} |
| X6 | pass (after fix; first run: fail, covered controls: pigeons:pin-tie) |  |
| X7 | pass (after fix; first run: fail, tie-hint covered 50% of the other pin's art) |  |

X1 = 100-pin case file one page; X2 = label clamp/title; X3 = tab order; X4 = keyboard delete focus, detective, close case; X5 = 390px layout metrics; X6 = new pins cover controls; X7 = tie-hint covers pins on phone. J rows roll up their UC and extra rows.

## Product defects

1. **D1 (medium): a new pin lands on top of the previous one and covers its "Tie string" button.** Repro: open a wall, pin "pigeons" then "the moon" on a 1280x800 window; the first pin's Tie button is under the second card (Playwright: "pin intercepts pointer events"). The person must drag first. Violates ux.md line 134 (always visible, reachable targets) and J5 (line 85). The walkthrough moves pins to free slots through the API so the other checks can proceed; X6 records the defect.
2. **D2 (medium): on a 390px phone the tie-hint covers about half of the other pin's art, and taps on the art are swallowed.** Repro: 390x844 touch, two pins, tap "Tie string" on one; tap the other pin's art: hint intercepts. Tapping the label works. ux.md line 28 says panels float over the board bottom, and line 146/166 says clicking a pin body picks B. X7 fails.

Not defects against ux.md but noted: none of the findings touch the spec otherwise. Deviation to confirm: `data-x/data-y` is the card centre, not the pushpin (ux.md does not define the anchor; the check accepts either).

## Visual notes (from screenshots 09, 10, 12 that I viewed)

- 390px: "Remove pin" text touches/overflows the right edge of its button ("Remove" almost clipped). Minor.
- 390px finding sheet is translucent; cork speckle shows through the text behind it. Text stays readable; minor.
- Strings between adjacent pins are mostly hidden behind the cards when pins sit close; the string focus ring is then only a short stub (my slot layout, but also the product's layering).
- Remote pin moves animate for about 600ms while `data-x` already holds the final value; harmless but geometry reads taken immediately are stale.
- Screenshots 01-08, 11 were captured but I only visually inspected 09, 10 and 12 in this session; contrast in them looks fine, no overlap beyond the above.

## Not tested

- UC20 axe-core: skipped, axe-core is not installed (recorded as skipped, not passed).
- Real print preview dialog: PDF page count via `page.pdf()` only; the 100-pin case checked with 40 strings.
- 200% browser zoom, real touch drag on devices, SSE heartbeat after 15 s, 50-subscriber cap, rate limiting (RATE_LIMIT=0).
- UC22 uses `context.setOffline`; other failure modes (server killed mid-session) not exercised.
- UC5 settle time: `data-lean` returns to 0 at mouse-up; the visual settle animation was waited for via getAnimations, not timed.

## Resolution (round trip 1 of 3, added by the orchestrator)

The table above is the first QA run on commit 790eb57, except X6 and X7, which show the re-run. Final state on the fixed code: **52 passed, 0 failed, 1 skipped of 53** (`docs/product/red-string/qa/results.json`), on two consecutive runs of `node qa/walkthrough.js`.

- **D1 fixed** (`public/wall.js` `freeSpot`): the client picks a free slot and sends `x`,`y` with the new pin. Covered only by walkthrough check X6; there is no unit test because the logic lives in the browser script.
- **D2 fixed** (`public/wall.css`): the tie hint ignores pointer events and, on phones, sits above the board instead of over it.
- **D3 found on re-run and fixed** (`src/main.js`): the server printed "listening" before installing its SIGTERM handler, so a stop signal sent at once killed it with no clean exit (about 1 in 5 in a direct test; `J11.sigterm` failed on two orchestrator re-runs after the fix agent had called it a flake). The announcement now comes after the handlers; 40 of 40 immediate stops exit 0.
- Visual notes: "Remove pin" label at 390px tightened; the panel rise animation no longer fades. Strings hidden behind close cards and the remote-move animation note are unchanged.
- The screenshots in `qa/` were re-captured by the final run and then colour-reduced to keep the repository small.

## Round trip 2 of 3: phone crowding (found by the orchestrator, not by the walkthrough)

- **D4 (medium):** check X6 only ran at 1280x800. On an emulated iPhone 13 the board held about four cards, so the fifth pin added through the UI covered an older card's buttons and a tap on "Tie string" was intercepted.
- **Fix** (`public/wall.js` `fitBoard`, `freeSpot`; `public/wall.css`): at phone width the board grows taller with the pin count and the page scrolls; the first pin goes top-left; a tapped or focused card comes to the front.
- **Measured after the fix** (orchestrator script, five fresh walls of 12 pins added through the UI on iPhone 13 emulation): 59 of 60 "Tie string" buttons tappable directly, 1 after one tap on the card to raise it, 0 unreachable. Page `scrollWidth` 390. Desktop 1280x800: 12 of 12.
- **Still open:** because positions are a fraction of the board box, growing the board moves earlier cards, so a new card can still partly cover an old one (the 1 in 60 above). A wall laid out on desktop and opened on a phone overlaps much more (the fix agent measured 7 of 12 buttons tappable directly); the raise-on-tap is the only help there. Neither case has an automated check.
- `node qa/walkthrough.js` after this fix: 52 passed, 0 failed, 1 skipped of 53.
