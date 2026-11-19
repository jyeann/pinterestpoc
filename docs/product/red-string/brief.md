# RED STRING: product brief

## Problem and user
A pinboard for people who have "connected the dots". You type a word or phrase and get a pin with its own
generated art, pin it to a cork wall, tie red strings between pins, and the app announces, with a straight
face, how the two things are connected. Friends open the same wall by link and add evidence live.

- **Who:** friends who want a silly shared toy for a group chat, a party, a streaming night or a slow
  afternoon. No accounts, nothing to upload, nothing to learn.
- **Job:** "make something absurd together in five minutes, then show it off."
- **Why it is fun:** every phrase looks different and you can never guess the art; every string comes with a
  deadpan finding that is the same every time, so a running joke can be shown to someone else; the
  Conspiracy Score climbs and the case status gets more paranoid; the Detective nudges you toward
  connections you would not have made; and you finish with a case file you can print and pin up for real.

## Existing products (no web research this run, from general knowledge)
- **Pinterest:** an image feed and grid built for collecting things to buy or copy. It has no links between
  pins and no humour. RED STRING keeps the pin and drops everything else.
- **Miro / FigJam / tldraw:** live whiteboards with connectors. They are good at collaborating live, but
  they are blank tools: they need sign-up and make no content or jokes of their own.
- **Conspiracy-board meme generators:** single images you edit by hand. They are fun once, but nothing is
  live, nothing is made for you, and there is no shared wall.
- **Repository:** it is empty apart from docs, so there is nothing to reuse.

## Decision: build
**Build from scratch.** No existing product combines art made from a phrase, findings that come out the same
every time, and a shared live wall. The repo has no code to extend. The run's constraints (Node 22, zero
runtime dependencies, `node:test`) also rule out adopting a whiteboard framework.

## MVP scope
**In (one build run):**
1. **Walls:** create a wall and get a shareable link (`/w/<id>`). The wall is a cork background that fills
   the screen.
2. **Pins from phrases:** you type a phrase and a pin appears with SVG art generated from that phrase alone
   (seeded hash to shapes and palette). The same phrase always gives the same art, and nothing is uploaded
   or fetched. The pin shows its phrase as a label.
3. **Pins as objects:** drag a pin to move it. It hangs from a pushpin and leans slightly depending on how
   you moved it, then settles. Its position is saved and synced. You can also delete a pin.
4. **Red strings:** link two pins (pick pin A, then pin B) to draw a red string between them. The server
   produces a deadpan **finding** from templates, chosen by the pair of phrases (the order does not matter),
   so the same pair always gives the same text. Click a string to read its finding. Strings can be deleted.
5. **Conspiracy Score and case status:** the score is worked out from the number of pins and strings, with
   a bonus for pins that have several strings. The status steps up through Hunch, Theory, Pattern, Cover-up
   and "They don't want you to know" at fixed score levels. Both are always on screen.
6. **Ask the Detective:** a button that suggests the next string, picking a pair of pins that is not yet
   connected by a fixed rule and showing a teaser line. If you accept, the string is made.
7. **Shared live wall:** everyone who has the link sees new, moved and deleted pins and strings, plus the
   score, within about a second, through Server-Sent Events. Anyone with the link can edit.
8. **Close the case:** a case file page (`/w/<id>/case`) that fits one printed page. It shows the wall
   name, the status, the score, the list of evidence (pins with their art) and every finding, using
   print-friendly CSS.
9. **Storage:** walls live in memory. Optionally they are also saved to a JSON file (set by an environment
   variable) and loaded again when the server restarts.

**Out (explicitly):** accounts, logins and any personal data; image uploads or network images; payments;
moderation tools; private walls or permissions; undo history; showing other people's cursors; mobile
gestures beyond basic touch dragging; a database; LLM or external API calls; any runtime npm dependencies.

**Later:** a "throw" with momentum and bounce; exporting a wall to PNG; themes (evidence locker, X-files);
read-only share links; daily featured walls; sound effects.

## Success criteria (testable, user-visible)
- **SC1: Start a wall.** On the home page the user clicks "Open a new case" and lands on `/w/<id>`, which
  shows a cork wall, a phrase box, Score 0 and status "Hunch". `POST /api/walls` returns the new id.
- **SC2: Conjure a pin.** The user types "pigeons" and presses Enter. A pin with SVG art and the label
  "pigeons" appears on the wall without a page reload.
- **SC3: Art is deterministic.** On any wall, "pigeons" always draws the same art (the SVG markup is
  identical), and "the moon" draws different art. No request goes to another origin.
- **SC4: Pins move and stay put.** The user drags a pin to a new spot. It stays there after a reload, and
  it leans while moving and then settles.
- **SC5: Tie a red string.** The user picks two pins in turn. A red line joins them and a finding sentence
  that names both phrases appears. Clicking the line shows that finding again.
- **SC6: Findings are deterministic.** Tying "pigeons" to "the moon" on any wall, in either order, gives
  the same finding text. A different pair gives a different finding.
- **SC7: The score escalates.** As strings are added, the Conspiracy Score rises and the case status moves
  up from "Hunch" to at least "Theory". A wall with enough strings shows "They don't want you to know".
- **SC8: Ask the Detective.** With 3 or more pins and at least one unconnected pair, the user clicks "Ask
  the Detective" and sees a suggested pair with a teaser. Accepting it adds that string. With fewer than 2
  pins, or every pair already connected, the detective says so politely instead.
- **SC9: The wall is live and shared.** Two browsers open the same link. A pin added, moved or deleted, or
  a string added, in one browser shows up in the other within about 1 second without a reload
  (`GET /api/walls/<id>/events` is `text/event-stream`).
- **SC10: Close the case.** The user clicks "Close the case" and sees a one-page case file showing the
  status, the score, every pin with its art and every finding. In print preview it fits one page, with no
  buttons showing.
- **SC11: It survives a restart.** With JSON persistence turned on, the user restarts the server, reloads
  the wall link and sees the same pins, strings and score.
- **SC12: Clear errors.** Opening an unknown wall id shows a friendly "No such case" page (HTTP 404). An
  empty phrase or one over 60 characters is refused with an inline message, and the API returns 400.

## Decisions
| Decision | Options | Chosen | Why |
|---|---|---|---|
| Throw physics | full momentum and bounce / drag with lean | drag with lean | It fits one run and can be tested; throwing moves to Later |
| Where findings are made | client / server | server, from templates | One source of the truth, so they are the same for everyone, and it can be tested over HTTP |
| Status ladder | 3 levels / 5 levels | 5 (Hunch to "They don't want you to know") | It escalates more often, and it keeps the two named ends from the idea |
| Editing rights | owner only / anyone with the link | anyone with the link | There are no logins; the link is the invitation |
| Phrase limit | none / 60 characters | 60 characters | Keeps pins and the case file readable and limits abuse |
| How you tie a string | drag from pin to pin / pick A then B | pick A then B (dragging is optional) | It is reliable for tests and for touch screens |
| Persistence | always / optional | optional, set by an environment variable | Tests stay hermetic; demos survive restarts |

## Risks
- Absurd findings could turn offensive when combined with what users type. Templates are kept neutral and
  deadpan, and they insult nothing but the phrases.
- Walls that anyone with the link can edit could be vandalised. This is accepted for the MVP: ids are
  random and hard to guess.
- Sync with several people editing uses "last write wins" for pin positions, so pins can jump. This is
  acceptable for a toy.
- Fitting the case file on one page with many pins: past about 24 pins the art is shown as small thumbnails.

## Open questions with defaults
- What is the maximum number of pins per wall? Default 100 (the API returns 400 after that).
- Can the wall be renamed? Default: yes, there is an editable title, which starts as "Case #<id>".
- Should walls expire? Default: no, not in the MVP.
- No question needs a human: there is no spend, no legal issue and no real personal data.
