# RED STRING: UX

Voice: a tired detective who has seen it all and believes every word he says. Short, flat, certain. Never cute about the UI itself; only the evidence is absurd.
Vanilla JS + inline SVG, system fonts, no network fonts or images. Selectors below are `data-testid` values. Where a testid repeats (many pins), the element also carries `data-id` and, for pins, `data-phrase`.

## Visual direction
- **Wall:** cork made from CSS only (a warm brown base plus layered radial-gradient speckle, an inset vignette). Fills the viewport under a slim header. No image files.
- **Pins:** paper cards (off-white, small drop shadow, 1px darker edge), art on top (square SVG), typed label below. Each hangs from a round red/steel pushpin at top centre. Resting tilt is deterministic from the id, between -3deg and +3deg. Transform origin is the pushpin.
- **Red string:** SVG `<path>` quadratic curve between the two pushpins with a sag (control point dropped about 12% of the length, plus a minimum of 24 units), 3px, `--string` red, with a thin darker underlay for depth. A wide transparent hit path (20px) sits on top for clicking. The sag is recomputed while a pin is dragged.
- **Type:** `--font-type: "Courier New", Courier, "Nimbus Mono PS", ui-monospace, monospace` for labels, findings, status and score. `--font-ui: system-ui, -apple-system, "Segoe UI", sans-serif` for buttons and errors. Case file uses the typewriter stack and a stamp style for the status (uppercase, rotated -4deg, double border).
- **Themes:** Day (default) and "Night shift" (`prefers-color-scheme: dark`, and a header toggle `theme-toggle` that overrides and is remembered in `localStorage`, wrapped in try/catch). Night: dark cork, desk-lamp vignette, cards stay paper-coloured but slightly dimmed. All colours are CSS custom properties on `:root` and `:root[data-theme="dark"]`. The case file always prints in light colours.
- **Motion:** pin drop-in 250ms, lean on drag, settle 600ms, string draws in 300ms, status stamp 200ms. Under `prefers-reduced-motion: reduce` all of these are instant and the lean is not applied (`data-lean` stays `0`). Resting tilt is static, so it stays.

## Routes and screens
| Route | Screen | Root testid |
|---|---|---|
| `/` | Home | `home` |
| `/w/<id>` | Wall | `wall` |
| `/w/<id>/case` | Case file | `case` |
| any unknown wall id, either wall route (HTTP 404) | No such case | `notfound` |

### Home (`/`)
Title `home-title` ("RED STRING"), tagline `home-tagline`, button `home-new-case` ("Open a new case"), error line `home-error` (role=alert, hidden until used). Button is disabled and reads "Opening..." while the request runs. After success: navigate to `/w/<id>`.

### Wall (`/w/<id>`)
Header (left to right): `wall-title` (text input, the case name, max 60 chars, saves on blur/Enter), `wall-status` (stamp, `data-level` 0..4), `wall-score` (number, "Score" shown as a visible label), `conn-status` (`data-state` = `live` | `reconnecting` | `offline`), `theme-toggle`, `share-link` button ("Copy link", copies the URL, announces "Link copied"), `close-case` (link to `/case`, "Close the case").
Under the header, the tool bar: form `phrase-form` with `phrase-input` (label "What did you see?", maxlength not set so overlong text can be refused with the message), `phrase-submit` ("Pin it"), `phrase-error` (inline, `aria-describedby` of the input), and `detective-btn` ("Ask the Detective").
Board: `board` (role=group, aria-label "Evidence wall"), containing an SVG layer `string-layer` behind the pins and a pin layer. Panels float over the board bottom: `tie-hint`, `finding-panel`, `detective-panel`. Live region `announcer` (role=status, aria-live=polite, visually hidden); `phrase-error` and `wall-error` use role=alert.
Pin (`pin`, role=group, tabindex 0, aria-label "Pin: <phrase>. Position x <n>, y <n>. <k> strings."): `pin-art` (inline SVG, aria-hidden), `pin-label`, `pin-tie` ("Tie string"), `pin-delete` ("Remove pin"), `pin-push` (decorative pushpin). `data-id`, `data-phrase`, `data-x`, `data-y` (0..1000 normalised to board size, so every viewport agrees), `data-lean` (degrees, 0 at rest), `data-selected` (`true` when chosen as A).
String (`string`, SVG `<g role=button tabindex=0>`, aria-label "String between <A> and <B>. Show finding."): `data-id`, `data-a`, `data-b` (pin ids). Its hit path is `string-hit`.
Finding panel: `finding-panel` (role=dialog non-modal, labelled by `finding-heading`), `finding-text`, `finding-pair` (A and B phrases), `finding-delete` ("Cut the string"), `finding-close` ("Close").
Detective panel: `detective-panel`, `detective-message` (the teaser, or the decline), `detective-accept` ("Tie it"), `detective-dismiss` ("Not now"). Accept and dismiss are hidden when the detective declines.

### Case file (`/w/<id>/case`)
`case-title`, `case-status`, `case-score`, `case-evidence` (list) with `case-evidence-item` (`data-phrase`; art + phrase), `case-findings` (ordered list) with `case-finding` items, `case-print` ("Print the file"), `case-back` ("Back to the wall"). Print CSS: `@page` A4/Letter with 12mm margins, hides `case-print`, `case-back` and any button, black on white, evidence in a grid, thumbnails (<=56px) when more than 24 items, findings text 10pt. Content must fit one page at the 100-pin limit by shrinking thumbnails to 28px and findings to 8pt.

### No such case
`notfound-title` ("No such case"), `notfound-text`, `notfound-home` (link "Open a new case" to `/`). Served with HTTP 404.

### States
| Where | State | What the person sees |
|---|---|---|
| Wall | loading | `board` shows `wall-loading` ("Dusting for prints...") until the first snapshot; score and status show "-" |
| Wall | empty | `empty-state` over the board: "Nothing on the wall. Type something you saw." Gone at the first pin |
| Wall | one pin / <2 | tie buttons stay enabled but tying to the same pin is refused: "A pin cannot be linked to itself." |
| Wall | tie mode | `tie-hint` ("Pin A: <phrase>. Choose the second pin, or press Escape.") and A has `data-selected` |
| Wall | error | `wall-error` banner: "The wall would not talk. Reload and try again." with a `wall-retry` button |
| Wall | reconnecting | `conn-status` "Reconnecting..." (`data-state=reconnecting`), edits still queue to the server; on return a fresh snapshot replaces the view and the text goes back to "Live" |
| Wall | detective declines | see Copy; the panel shows only the message |
| Any text field/label | long or hostile text | Phrase labels clamp to 2 lines with ellipsis and full text in `title`; `<script>` and markup are shown as plain text, never parsed (use `textContent`) |
| Case | empty wall | `case-evidence` shows "No evidence. No case." |

## Copy
Status ladder in order (also `data-level` 0..4): **Hunch**, **Theory**, **Pattern**, **Cover-up**, **They don't want you to know**. Exact strings; case file prints them uppercase via CSS only (the text node is unchanged).
| Key | Text |
|---|---|
| Home tagline | Everything is connected. You just have not proved it yet. |
| Phrase label / placeholder | What did you see? / pigeons |
| Empty phrase (client and 400) | Say something. Even a hunch has a word in it. |
| Over 60 chars | Too long. Evidence must fit on a card: 60 characters, tops. |
| Pin limit (400) | The wall is full. 100 pins is where the trail goes cold. |
| Self link | A pin cannot be linked to itself. |
| Duplicate string | Those two are already connected. I checked. |
| Network failure on action | Could not reach the wall. Check your connection; nothing was saved. |
| Pin announced | Pinned: <phrase>. |
| Pin moved (keyboard) | <phrase> moved to x <n>, y <n>. |
| Pin removed | Removed <phrase> and <k> strings. |
| String announced | New string: <A> to <B>. Finding: <finding>. |
| Score announced | Score <n>. Status: <status>. (only when the status changes) |
| Detective teaser | I like <A> and <B> together. Nobody ever asks why. |
| Detective <2 pins | Two pins minimum. Even I cannot connect a single dot. |
| Detective all connected | Everything is already connected. That is what worries me. |
| Detective thinking | The Detective is thinking... |
| Remote change | A colleague pinned <phrase>. / A colleague moved <phrase>. / A colleague tied <A> to <B>. |
| Reconnecting / Live / Offline | Reconnecting... / Live / Offline. Changes will not be sent. |
| 404 title / text | No such case / Nobody filed that one, or somebody made it disappear. |
| Share | Copy link / Link copied |
Findings come from the server and are shown verbatim, always including both phrases.

## Journeys
- **J1 Start a wall (SC1):** open `/`, click "Open a new case"; the URL becomes `/w/<id>`; cork board, empty state, phrase box focused, Score 0, status Hunch, Live.
- **J2 Conjure a pin (SC2):** type "pigeons" in the phrase box, press Enter; the box clears and keeps focus; a pin drops in with art and label "pigeons"; the announcer says "Pinned: pigeons." No reload.
- **J3 Art is deterministic (SC3):** pin "pigeons" on two different walls and again on the same wall; the art markup matches each time, and "the moon" differs. No request leaves the origin.
- **J4 Move a pin (SC4):** drag a pin to a new spot; it leans while moving (`data-lean` nonzero), then settles to 0; reload and it is at the same place.
- **J5 Tie a string (SC5):** click "Tie string" on pin A, then click pin B; a sagging red string appears, the finding panel opens naming both phrases; close it and click the string to read it again.
- **J6 Same finding either way (SC6):** tie A-B on one wall and B-A on another; the finding text is identical; a different pair gives different text.
- **J7 Escalation (SC7):** keep tying strings; score rises and the stamp climbs from Hunch to Theory and on to "They don't want you to know"; the announcer names the new status.
- **J8 Ask the Detective (SC8):** with 3+ pins and an open pair click "Ask the Detective"; a teaser names two pins; "Tie it" makes the string. With <2 pins or all pairs connected the Detective politely declines.
- **J9 Shared live wall (SC9):** two browsers open the same link; add, move and delete a pin and add a string in one; the other updates within 1 second and announces "A colleague ...".
- **J10 Close the case (SC10):** click "Close the case"; the case file shows status, score, every pin with art and every finding; print preview shows one page and no buttons.
- **J11 Survives restart (SC11):** with persistence on, restart the server, reload the wall link; same pins, positions, strings, score.
- **J12 Clear errors (SC12):** open `/w/nope` and see "No such case" (404); submit an empty phrase and a 61-character phrase and see the inline refusal; no pin appears.
- **J13 Keyboard only (all SCs):** do J2, J4, J5, J8 and J10 with no pointer (model below).
- **J14 Phone width:** J1, J2 and J5 at 390x844 with touch.
- **J15 Connection loss:** the event stream drops; "Reconnecting..." shows, then "Live" and the wall matches the server.
- **J16 Theme and motion:** Night shift toggle, and reduced motion.

## SC to journey to check
| SC | Journey | UI checks |
|---|---|---|
| SC1 | J1 | UC1 |
| SC2 | J2 | UC2, UC3 |
| SC3 | J3 | UC4 |
| SC4 | J4 | UC5, UC6 |
| SC5 | J5 | UC7, UC8 |
| SC6 | J6 | UC9 |
| SC7 | J7 | UC10 |
| SC8 | J8 | UC11, UC12 |
| SC9 | J9 | UC13 |
| SC10 | J10 | UC14 |
| SC11 | J11 | UC15 |
| SC12 | J12 | UC16, UC17, UC18 |
| (a11y) | J13 | UC19, UC20 |
| (responsive) | J14 | UC21 |
| (resilience) | J15 | UC22 |
| (themes) | J16 | UC23 |

## Accessibility and responsive rules (hard requirements)
**Keyboard model**
1. Tab order: `wall-title`, `share-link`, `theme-toggle`, `close-case`, `phrase-input`, `phrase-submit`, `detective-btn`, pins in creation order (each pin is one stop; its inner `pin-tie` and `pin-delete` buttons are the next stops), then strings in creation order, then any open panel. Nothing is skipped by a pointer-only element.
2. Pin focused: Arrow keys move it 10 units (1% of the board); Shift+Arrow 40 units. Position clamps to 0..1000. Moves are sent to the server after 250ms of no keys. Announce the final position once ("<phrase> moved to x, y").
3. Pin focused: Enter or Space (or the `pin-tie` button) starts a string with this pin as A (`data-selected=true`, `tie-hint` appears, announce "Pin A: <phrase>. Move to another pin and press Enter."). Tab to another pin and press Enter or Space to tie. Escape cancels and keeps focus. Enter on A again cancels.
4. Pin focused: Delete or Backspace (or `pin-delete`) removes the pin and its strings. Focus goes to the next pin, else the previous pin, else `phrase-input`.
5. String focused: Enter or Space opens the finding. Delete cuts the string; focus goes to `phrase-input`. Panel: focus moves to `finding-close`, Escape closes it and returns focus to the string (or the opener) that opened it; Tab stays reachable (non-modal, no trap).
6. `detective-btn`: Enter opens the panel; focus moves to `detective-accept`, or to the panel container (tabindex -1) when it declines. Escape or `detective-dismiss` closes it and returns focus to `detective-btn`.
7. After a pin is added by Enter in `phrase-input`, focus stays in the input. After a string is tied, focus moves to `finding-close`.
8. Dragging with a pointer is an addition, never the only way: touch and mouse use Pointer Events; a movement under 4px counts as a click, not a drag.

**Other rules**
- Visible focus: 3px outline `--focus` (offset 2px, 3:1 against both the card and the cork), never removed; selected pin A has a second, dashed ring.
- Live announcements go to `announcer` (polite), batched: at most one message per 500ms, remote edits collapsed ("3 changes from colleagues"). Errors use role=alert. Findings, new pins and new strings are all announced.
- Contrast: text 4.5:1 and UI parts 3:1 in both themes (paper text on paper, status stamp on its backdrop, string red against both corks, placeholder text, disabled buttons). Do not rely on colour alone: the selected pin also gets a ring and the hint text; `conn-status` has words.
- Accessible names for every control, never icon only. Pin art is decorative (aria-hidden); the phrase label is the name. The title input has a visible or `aria-label` name "Case name".
- Touch targets are at least 44x44 CSS px (`pin-tie`, `pin-delete`, buttons). Both are always visible, not hover-only.
- Responsive: layout works at 390px with no horizontal page scroll and a 16px gutter. Header wraps to two rows (title and status/score on row 1, controls on row 2). The tool bar stacks, the phrase box full width. Pins are 112px wide under 600px and 144px above. Panels become bottom sheets (full width, max 45vh, scroll). The board is the viewport minus header, bars and panels, never smaller than 360px high; the board itself does not pan or zoom (coordinates are normalised), and touch-action is `none` on pins only, so page scroll still works elsewhere.
- Meta viewport `width=device-width, initial-scale=1`; text uses rem and respects browser zoom to 200%.
- Reduced motion as above; no flashing; no sound.

## UI acceptance checks (Playwright)
Helpers: `pin(phrase)` = `[data-testid=pin][data-phrase="<phrase>"]`; `S(id)` = `[data-testid=id]`. Create walls through the UI unless noted. Tests that use extra pages use a second `browser.newContext()`.
- **UC1 (SC1):** goto `/`; click `home-new-case`; expect URL `/\/w\/[\w-]+$/`, `board` visible, `phrase-input` focused, `wall-score` text "0", `wall-status` text "Hunch", `empty-state` visible; `POST /api/walls` returned 201 or 200 with an `id` equal to the URL id.
- **UC2 (SC2):** fill `phrase-input` "pigeons", press Enter; expect exactly one `pin` with `data-phrase=pigeons`, its `pin-label` text "pigeons", `pin-art` containing an `svg`, input empty, `empty-state` hidden, `announcer` containing "Pinned: pigeons."; no navigation event (a `window.__marker` set before is still there).
- **UC3 (SC2):** the new pin is usable at once: it is visible in the viewport, `pin-tie` and `pin-delete` are enabled, and `pin-delete` removes it (count 0, `empty-state` shown, announcer "Removed pigeons and 0 strings.").
- **UC4 (SC3):** on two walls and again after a reload, read `outerHTML` of `pin(pigeons) [data-testid=pin-art]`; all three strings are equal; "the moon" markup differs from "pigeons". Collect every `request` URL and assert each has the app's origin.
- **UC5 (SC4):** read `data-x/data-y`; drag `pin(pigeons)` with `page.mouse` in steps from its centre by +200,+120px; mid-drag (before mouse up) expect `data-lean` not `0`; after mouse up and 1000ms expect `data-lean` `0`; `data-x/data-y` changed and equal to the position in the box rectangle (within 1%).
- **UC6 (SC4):** after UC5 and `page.reload()`, `data-x/data-y` equal the values from before the reload (within 5 units).
- **UC7 (SC5):** with pins "pigeons" and "the moon": click `pin-tie` in pigeons, `tie-hint` visible and pigeons `data-selected=true`; click the moon pin body; expect one `string` with `data-a`/`data-b` matching the pin ids, `finding-panel` visible, `finding-text` containing "pigeons" and "the moon", `announcer` containing "New string:".
- **UC8 (SC5):** click `finding-close` (panel hidden), click `string-hit` of that string, `finding-text` shows the same text; click `finding-delete`, string count 0 and score back to 0.
- **UC9 (SC6):** on wall 1 tie pigeons then the moon, store `finding-text`; on wall 2 tie the moon then pigeons, text equals the stored text; tie pigeons to "ufo" and the text differs.
- **UC10 (SC7):** create 8 pins; tie pairs in a loop (all pairs, in a fixed order) reading `wall-score` and `wall-status` after each; expect the score numbers to be non-decreasing and, strictly higher after the first string; status becomes "Theory" or higher by the time the score is first seen above 0 and 4 strings; the last status read must reach `data-level=4` ("They don't want you to know") before pairs run out, and `data-level` never decreases. (Thresholds are the architect's; the UI only reads them.)
- **UC11 (SC8):** with 3 pins and no strings click `detective-btn`; `detective-panel` shows `detective-message` containing two existing pin phrases; click `detective-accept`; expect one new string between exactly those two pins and the panel closed.
- **UC12 (SC8):** with 1 pin, `detective-message` is "Two pins minimum. Even I cannot connect a single dot." and `detective-accept` is absent; with every pair tied (3 pins, 3 strings) the message is "Everything is already connected. That is what worries me."
- **UC13 (SC9):** two contexts open the same wall URL; A adds "pigeons" => B sees `pin(pigeons)` within 1500ms (no reload; assert with `expect.poll`) and `announcer` contains "A colleague pinned"; A drags the pin => B `data-x/data-y` match within 1500ms; A ties two pins => B sees a `string`; A deletes a pin => B pin count drops. Also `fetch('/api/walls/<id>/events')` has `content-type` starting `text/event-stream`.
- **UC14 (SC10):** with 3 pins and 2 strings click `close-case`; URL ends `/case`; `case-status`, `case-score` match the wall, `case-evidence-item` count 3 with `svg`, `case-finding` count 2. `page.emulateMedia({media:'print'})`: `case-print`, `case-back` are hidden; `page.pdf()` has exactly one page (count of `/Type /Page\b` is 1); also with 30 pins (via API) one page.
- **UC15 (SC11):** (persistence env var set in this run) build a wall with 3 pins, 2 strings, note the score; restart the server process on the same file and port; reload; the same pins (phrases), strings, positions (within 5 units) and score.
- **UC16 (SC12):** goto `/w/doesnotexist` => response status 404, `notfound-title` text "No such case", `notfound-home` visible; same for `/w/doesnotexist/case`.
- **UC17 (SC12):** submit an empty phrase and a whitespace-only phrase: `phrase-error` shows the empty copy, `aria-invalid=true` on the input, no pin added, and the input keeps focus.
- **UC18 (SC12):** submit a 61-character phrase => `phrase-error` shows the over-60 copy, no pin; a 60-character phrase is accepted; `POST /api/walls/<id>/pins` with 61 characters returns 400 (via `request`); a phrase `<img src=x onerror=alert(1)>` shows as literal text in `pin-label` and no dialog event fires.
- **UC19 (J13):** keyboard only (no `mouse`): Tab to `phrase-input`, type and Enter for two pins; Tab to a pin; ArrowRight x3 changes `data-x` by +30 (+-1) and Shift+ArrowDown changes `data-y` by +40; wait 500ms, reload, value persists. Enter on pin A, Tab to pin B, Enter => one `string`, `finding-close` focused; Escape => panel closed and focus on the string; Delete => string removed, `phrase-input` focused.
- **UC20 (J13):** every focused element in a Tab sweep through the page has a visible outline (computed `outline-width` >= 2px or a box-shadow ring); `detective-btn` Enter => focus lands inside `detective-panel`; Escape returns focus to `detective-btn`. `announcer` text changes for pin, string and finding (assert each at least once). Run `axe-core` injected from `node_modules` if present, else skip with a note; expect no serious or critical violations in either theme.
- **UC21 (J14):** viewport 390x844, `hasTouch`: `document.documentElement.scrollWidth <= 390`; J1 and J2 pass; `pin-tie` and `pin-delete` bounding boxes are at least 44x44; tie two pins via `tap`; `finding-panel` is within the viewport (bottom sheet) and not covering `phrase-input` when closed.
- **UC22 (J15):** `context.setOffline(true)` or abort the events route: `conn-status` `data-state=reconnecting` within 5s; add a pin through a second context; go back online; within 5s `data-state=live` and the pin from the other context is present.
- **UC23 (J16):** `colorScheme: dark`: `body` background computed differs from the light run and `wall-score` text contrast is >= 4.5:1 (compute from computed colours); click `theme-toggle` flips `html[data-theme]` and the choice survives a reload; with `reducedMotion: reduce` dragging a pin leaves `data-lean` at `0` and no CSS animation runs (`getAnimations()` is empty on `pin` after 100ms).

## Decisions
- **Tie flow:** pick A, then B, via a visible "Tie string" button on each pin (also Enter/Space); a pointer click on a pin body in tie mode picks B. Dragging a string between pins is not built.
- **Pin positions** are normalised 0..1000 so desktop and phone share one wall; dragging off the board clamps.
- **Status thresholds** are not in the brief; the UI reads the status and level from the server and UC10 drives strings until it sees the top level, within 8 pins (28 possible strings).
- **The finding panel opens automatically** on a new string so the joke lands; it is non-modal so keyboard users are never trapped.
- **Delete has no confirm** (no undo is promised, but each removal is announced); the cost is small on a toy wall.
- **Renaming** the wall is a plain text input saved on blur; title is also the case-file title.
- **Remote edits** never steal focus or move a pin the local person is dragging or focusing; they are announced as "A colleague ..." and batched.
- **Theme** follows the system, with a manual override remembered per browser.
