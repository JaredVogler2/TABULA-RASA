# Observer experience: what is there, how it was checked, what nobody has tried

Status: phases 12–14 (2026-11-25), with what a phone showed on 2026-11-26. This is a review by the builder
from executed tests and screenshots of the running product. **Until 2026-11-26 no person other than the builder
had played it. On that day the owner opened the deployed game on their phone and reported two defects that
every test and every still here had passed over; they are below. That is the only use by another person and
the only use on a physical device that this repository knows of. Nobody is known to have used it with a screen
reader or with sound through a speaker.** Those gaps are listed at the end and are the reason no criterion
here is scored as verified with people.

## What the observer has

| Instrument | What it shows | Where the data comes from | Keys |
|---|---|---|---|
| Time bar | play / pause, one tick, six speeds, hour and day | the worker's clock | Space, `.`, 1–6 |
| Chronicle | notable logged events in plain sentences, not the whole ledger: the worker forwards 44 of the engine's 60 event kinds and 38 of them have a line (routine acts such as gathering, eating, sleeping, single decisions and refused intents are left out); the page keeps the latest 600 lines and the panel lists the newest 220 that pass the filter; filtered by six groups of kinds or by the selected citizen, with the engine's recorded cause; click to go there | the engine's event ledger, through `UI_EVENTS` in `src/worker/sim.worker.ts` | C |
| Inspector | a citizen's needs, load, plan, **what they set out to do and what came of it** (refusals in plain words), what they believe against what is true, whom they know, what they remember, temperament, skills. On a phone it is a card that opens drawn back to its head, with the citizen in sight above it (D-052) | on-demand read of the citizen | click, F to follow |
| Follow | the camera stays on a citizen, drawn in the middle of the map the interface leaves uncovered; a pan, another choice or closing the card lets go; zoom, turn and tilt do not (D-052) | the renderer's own position of the citizen | F |
| What they know | the land the selected citizen has never seen is washed out, in the world and on the atlas | the citizen's own seen-tiles set | V |
| Who they know | arcs to the people they have dealt with, warm for trust, cool for distrust | the citizen's own record of others | T |
| Charters | every agreement, its rules as sentences, how it came to be proposed, who signed, how often it was used; its pennant colour | the institution engine | G |
| Atlas | relief map with people, hearths (lit or not), shelters, stores, plots, worn ground and agreements in force; click to look or to select | latest frame | L |
| Almanac | seven daily measures (living, welfare, food held, wild food, commons health, inequality, things built) with the numbers as a table | one sample per simulated day | L |
| The aim | the one sentence on the scenario's card, and where it stands: open, then met or lost on a named day, or a reading with no verdict (Two Shores); the same for the untouched twin once there is one; a notice on the morning it is decided. Not a score, and no citizen is told (D-049) | the world's own state — who is alive and when the others died, the calendar, the scheduled drought — read each morning and when the Atlas opens | L |
| Field journal | twenty-one questions, each answered by the first logged event of its kind (D-030) | the event stream | J |
| Intervene | eight changes to conditions (weather, scarcity, abundance, arrivals, how far voices carry); never to minds; no forecast | logged in the world's own ledger; history forks | I |
| Compare | your timeline against its untouched twin: charts with a marked fork day, the day-by-day difference, deltas, the two worlds counted side by side, what happened in each by kind, who is dead in only one, the daily table. Beside a recording: the record against the same island with the engine's own minds (D-034) | both worlds, same seed and luck | K |
| The twin | the other world on screen, from the same camera at the same tick; a banner says which world is shown; nothing can be done to it | the worker steps both worlds together | X |
| History | the start and every second morning as moments to return to: *watch it again* (exact, checked at the end), *leave from there* (a new line, same luck or new); world lines as a tree and a list; a loaded world's past lived again from its seed; export to a file with a manifest, import with an integrity check (D-033) | compressed keyframes in the worker; the engine's determinism | H |
| Why | under a Chronicle entry, the causes the engine recorded for it, nearest first | parent links in the event ledger | — |
| Laboratory | the registered studies as run: per-condition means with intervals, paired contrasts against the registered rule, the sizing of the confirmatory batch, raw tables to download, any cell re-run in this browser and compared by hash, and what a live version could cost at most (D-036) | a study bundle written by `pnpm study` | title screen |
| Recordings | replay of a recorded run, checked against its record epoch by epoch | config + tape + digests | — |
| Sound | weather, hour, season, nearby fire; tones for deaths, arrivals, agreements, forks | latest frame and camera (D-028) | M |

## Flows that are executed on every `pnpm e2e` (desktop 1366×768 and 390×844 phone emulation)

| Flow | Test | What it proves | What it does not |
|---|---|---|---|
| title → scenario and seed → world → step / play / speeds / pause → click a citizen in the 3D view → follow → Chronicle → intervene (fork) → compare → save → reload → continue | `play.spec.ts` | the loop works with real clicks and taps, with no network and no console errors | that a newcomer understands it |
| within that flow: a tapped citizen is in sight above their card (phone); the card opens and draws back by its arrow and its head; the person followed is drawn in the middle of the uncovered map; a drag lets go and Follow brings the camera back; a zoom keeps the follow; with time running they are never under a bar or the card; choosing someone else lets go of the first, in the camera as on the button | `play.spec.ts`, by measuring where the citizen is drawn and what is on top at that point of the page (`tests/e2e/layout.ts`) | Follow is the camera moving and the person visible, not a button changing its word | how it feels under a finger; a real phone |
| the Recordings sheet at four phone sizes and three wider ones; the lists of saved worlds, of world lines and of recordings wherever a flow meets them | `play.spec.ts`, `owner.spec.ts`, `history.spec.ts` | no name is squeezed and broken, nothing reaches past its list, no sheet scrolls sideways, no row is drawn over what is above it | a phone's own browser: only Chromium is installed here, and the picture of the defect came from what looks like an iPhone |
| the same world driven by keyboard alone | `play.spec.ts` (desktop) | every control has a key or is reachable by Tab | screen-reader use |
| charters in plain words with their origin | `play.spec.ts` (desktop) | the ledger reads as sentences and says "scripted control · not emergence" where true | comprehension |
| sound off → on → slider to zero → off; three days of play; journal pages; outcomes list; both knowledge views; atlas, almanac table, click-to-look | `observer.spec.ts` | each instrument reads live state and responds; sound really produces signal and really goes quiet | how any of it sounds or feels |
| a published run and the bundled recording replay and match their records; the banner never calls a mock a model; a sheet never covers the banner | `owner.spec.ts` | replay is exact and honestly labelled | — |
| play, intervene, look at the twin and back; watch five days again and arrive exactly; leave on a new line; return to the old one; compare; save, reload and live the past again from the seed; export; a tampered file refused and the true one opened; a recorded cause followed | `history.spec.ts` | going back never loses or silently changes anything, and the product says truthfully which world is on screen | whether the difference between a re-run and a new line is understood by a newcomer |
| the Laboratory from the title screen: the bundle named for what it is, every contrast with its reading, the sizing table, a published cell re-run in the browser to the same hash, raw tables | `lab.spec.ts` | the page says what the bundle says; reproduction is real | whether a reader draws only the conclusions the page allows |
| every screen and panel scanned with axe-core (WCAG 2.0/2.1 A and AA), now seventeen states, with History, Compare, the twin on screen and the Laboratory | `a11y.spec.ts` | no serious or critical machine-detectable violation | anything a machine cannot detect |

## Accessibility: what was checked and how

- **Automated scan** (`a11y.spec.ts`, results in `evidence/phase-12/a11y-desktop.json` and `-mobile.json`):
  thirteen states. First run found one serious violation — the "What was designed" page scrolled but could
  not take keyboard focus — which is fixed (the page itself is now a focusable region). The scan could not
  decide colour contrast for about five hundred text nodes, because the paper is textured and the glass is
  translucent.
- **Contrast, computed instead** (`tests/unit/contrast.test.ts`): every text token against every surface it
  appears on, with the glass composited over the brightest thing it can sit on (snow) and the darkest (night).
  This found two real shortfalls, both fixed: muted text on glass over snow (3.4:1 → 5.0:1, by making the
  glass 80% opaque and the muted text lighter) and the warning red on the darkest paper (4.48:1 → 4.98:1).
  All pairs now meet 4.5:1.
- **Keyboard**: every panel opens and closes by key; Escape closes the top panel, then clears the selection;
  nothing traps focus (the E2E walks it). The 3D view is one labelled element; everything in it is reachable
  through the Chronicle, the atlas and the inspector rather than by aiming a pointer.
- **Touch**: controls are at least 44 × 44 px (measured on every screen of the phone project by
  `a11y.spec.ts`); on a phone the journal and the sound switch move into the menu so
  that the remaining tools keep that size; sheets rise from the bottom and never cover the recording banner
  (asserted).
- **A layout bug that every test passed.** The atlas reached a 390-pixel screen as two columns, the almanac
  cut off at the right edge: its one-column rule sat above the rule it was meant to override, so it never
  applied. The flow test passed, because a clipped chart is still "visible" to a test. It was found by opening
  the phone capture. The fix comes with two guards: the flow test now measures the map and every chart against
  the viewport, and a unit test reads every stylesheet and fails on any responsive rule that a later
  unconditional rule cancels. Lesson kept: a passing flow is not a looked-at screen.
- **A second one, older and worse.** Since phase 04 the "Forked on day N" badge had been partly hidden under
  the tool buttons at 1366 px — the commonest laptop width — and cut off at the edge of a phone screen; every
  flow test passed, because a test's click scrolls its target into view and a half-covered button is still
  "visible". It surfaced in phase 13 only because a new button beside it could not be clicked at all. The top
  bar was rebuilt around measured widths: the fork and its twin are a pill of their own; words give way in a
  stated order (Compare's label, the season and the weather's name, "Twin", the remaining tool labels, the
  world's label) before anything overlaps; below 1120 px the status takes its own row. `scripts/topbar.mjs`
  drives the real game into its widest state and measures 25 window widths from 2560 to 320 px (no overlap and
  nothing off screen at any of them; at one, 390 px, the status row still spilled by 22 px when the weather
  had a long name — see `docs/EVIDENCE.md`, phase 13), and `history.spec.ts` asserts the same at several widths
  on both projects.
- **And a third, of the same family.** That "widest state" was not the widest. In phase 15 the script was taught
  to write the longest labels the bar can ever be asked to show — a four-digit day, "Cold snap", a frost, five
  hundred citizens, a fork on a four-digit day — and found the game's name squeezed at three laptop widths, the
  tools two pixels off the screen at 1120 px, and the status row spilling on every phone. Fixed widths cannot
  promise a fit for text they were not measured with, and they had to assume that the fork pill was there, so
  an untouched world gave up words it had room for. The bar now measures itself (`src/ui/game/fit.ts`, D-045):
  it shows as many words as fit, in a stated order of giving way, and on a phone the status row and the fork
  pill shorten only as far as they must. The script measures 25 widths three ways — untouched, forked, and with
  the longest labels — and also fails on a squeezed name or a pill pushed onto a row of its own.
- **A fourth and a fifth, found by the owner on a phone (2026-11-26, D-052).** *The Recordings sheet* — the
  first thing a visitor can open — showed the name of the recording in a sliver at the left, one word to a
  line, and the rest of the row running off the right edge. A row was a grid of "what is left" and "as wide as
  its words", with the second forbidden to wrap: a long description took everything and the name got the
  remainder. The flow test found the name, read its words and pressed it. *Follow* did not appear to follow:
  the card is a sheet over the lower part of a phone's map, the camera drew whoever it followed at the middle
  of the canvas, and the middle of the canvas was behind the sheet; closing the sheet to look ended the
  follow. The flow test pressed Follow and read that the button said "Following". Both pass at a desk and both
  are wrong in the hand. What is now measured is in the two rows added to the table of flows above; what was
  found beside them, looking, is in `docs/QA_REPORT.md`. Lesson kept, again: a control that reports its own
  state has not been tested until the thing it controls has been looked at.
- **Motion and sound**: reduced motion (system setting or the menu) slows time-driven motion, stills the
  camera's easing and removes birds and fish rings; sound never starts on its own.
- **Not colour alone**: chart lines are named and tabulated; agreement colours come with the agreement's name;
  need bars carry a word ("uneasy", "suffering", "critical") when they matter.

## Review against the phase's brief

| Asked for | State | Note |
|---|---|---|
| Understated atlas / field-journal interface, the world as the main experience | done | parchment sheets, forest glass, one accent; HUD occupies the screen's edges |
| Title with a live 3D vista | done (phase 04) | a real simulation behind the wordmark |
| Timebar, inspector, Chronicle, institution ledger | done | |
| Settlement map; resource and population summaries | done | atlas and almanac |
| Social network overlay | partly | one citizen's ties at a time; no whole-society graph |
| Timeline scrub and replay; jump to moments and actors | done differently | jump-to from Chronicle, journal and atlas; replay of recordings; History returns to stored mornings (every second day, thinning to every fourth in long worlds) rather than to any tick — there is no continuous scrubber |
| Filter by causal event, group or resource | partly | by event group and by citizen; not by resource |
| What they know vs what the observer knows; rationale; witnessed events; intentions vs outcomes | done | D-029; outcomes list |
| Interventions: shocks, resources, migration, communication; observer vs treatment distinguished; no forecast | done | eight kinds; forked badge; "the only honest forecast is to run it" |
| Optional objectives, dilemmas, knowledge through observation | changed | D-030: a journal of things witnessed, not goals. D-049: the one aim on each scenario's card is counted in the Atlas, for the world and its untouched twin, and never scored |
| Portrait and landscape, bottom sheets, 44 px, keyboard, contrast, labels, reduced motion, pause, audio sliders | done | landscape phone is exercised by the art captures only, not by an E2E flow |
| Procedural ambient sound and event cues, no autoplay | done, unheard | D-028 |

## What nobody has tried (required before any claim about usability)

1. **A first-time player.** Whether the first fifteen minutes in `docs/CHARTER.md` §4 happen as written is
   unknown. The coach marks were written by the person who built the game.
2. **A screen reader.** Names, roles and live regions exist and pass the scan; whether the game can be
   followed by ear has not been tried.
3. **A physical phone or tablet, by the builder.** Touch targets, sheets and gestures are tested in emulation
   only, in Chromium only. The owner's phone is the one device the game is known to have been opened on; it
   found two defects at once (above), which says how much emulation had been missing. Their fixes have not
   been seen on a phone by the builder. Frame rate on a real phone is unmeasured (`docs/ART_BIBLE.md` §
   Performance).
4. **Ears.** The soundscape has been measured, not heard.
5. **Colour-vision deficiency in the 3D scene.** Charts are checked; the diorama's reds (berries, madder
   pennants) against greens are not. State there is always also shown by shape, and in the panels by words.
6. **Long sessions.** Nothing here was used for more than a few simulated weeks at a time by a person.
