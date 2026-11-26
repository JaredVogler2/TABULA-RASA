# Changelog

What changed, pull request by pull request. Dates are UTC. Versions named here are the engine's
(`src/engine/version.ts`): a world saved under one engine version is not continued under another. Why each
thing was done is in [`docs/DECISIONS.md`](docs/DECISIONS.md); what backs each claim is in
[`docs/EVIDENCE.md`](docs/EVIDENCE.md).

## Pull request 9 — the record brought up to date (2026-11-26)

Engine 0.7.0, unchanged. Nothing in the product changes. Written with the pull request: whether it has been
merged is on GitHub, not here.

- The whole-loop browser test now holds two things that pull request 8 mended. That a tapped card eases
  open on a phone: the browser is asked whether the card's height is in transition. And that the Follow
  button does not say "Following" after a Chronicle entry has sent the camera elsewhere: the camera and the
  button are each asked. Each fails with its line as it was before pull request 8.
- Recorded: the merges of pull requests 7 and 8; the checks of the live site after each; what was looked for
  on it after 8 and found; and two faults that pull request 7 brought in and 8 mended, live for forty minutes
  in between (`evidence/after-20/after-pr8.txt`, `docs/QA_REPORT.md`).

## Pull request 8 — the record of what the phone showed (2026-11-26, merged)

Engine 0.7.0, unchanged.

- D-052: the two reports from the owner's phone, what each was, the four further faults of Follow found
  beside them, what was decided, and how to undo it.
- Both reports measured the same way against the deployed site before the fixes, against the fixed build, and
  against the deployed site again once pull request 7 was merged: `node scripts/sight.mjs <address> <folder>`
  (`evidence/after-20/sight-before.md`, `sight-after.md`, `sight-live.md`, with stills). They are live.
- A card that is tapped or pulled up eases open instead of jumping.
- The Follow button no longer says "Following" when a Chronicle or journal entry has just sent the camera
  somewhere else.
- The arithmetic of what the interface covers is a function of its own, with tests.
- The documents now say that a person has used the game — once, on one phone — and what that found.

## Pull request 7 — what the owner's phone showed (2026-11-26, merged)

Engine 0.7.0, unchanged.

**For someone playing, on a phone**
- **Follow follows.** The person followed is drawn in the middle of the map that the bars and their card leave
  uncovered, and stays there as they walk. They used to be held at the middle of the screen, which on a phone
  is behind their own card: the button said "Following" and there was nobody to see (D-052).
- A tapped citizen stays in sight: the view turns to them and their card opens drawn back to its head — name,
  what they are doing, who decided, Follow. A tap on the card's head, a pull up or its arrow opens the whole
  card; a pull down or the cross closes it.
- Lists read as lists. In the Recordings sheet the name of a recording was squeezed into a sliver, one word to
  a line, with the rest of the row running off the screen; the list of saved worlds had the same fault. A
  name and what is said about it now sit side by side when they fit and one under the other when they do
  not.

**For someone playing, on any screen**
- Zooming, turning or tilting the view no longer ends a follow without a word; only moving the view away does.
- Choosing someone else while following lets go of the first person. The camera used to go on tracking them
  while the card and its button were about the second.
- On a slow device the camera keeps up with whoever it follows: it trailed a walker by a tile or more at a few
  frames a second.

**Under it**
- The browser tests measure where a citizen is drawn and what is on top of that point of the page, and every
  list of rows a flow meets (`tests/e2e/layout.ts`). Until now they read that a button said "Following".

**Not in it:** a look at any of this on a physical phone by the builder, or in any browser but Chromium. The
owner's phone is where both faults were seen; the fixes have been measured in Chromium at a phone's size.

## Pull request 6 — notices enter where they stay (2026-11-26, merged)

Engine 0.7.0, unchanged.

- A notice no longer slides in from the right: while it faded in it was drawn half its width to the right of
  the centre, and jumped to the middle when the fade ended. It now enters where it stays.
- The live site was checked again after pull request 5 was merged and it had rebuilt: 25 of 25, and the
  notice clears the time controls at every phone width.

## Pull request 5 — the release, and what looking at it found (2026-11-26, merged)

Engine 0.7.0: one line changed, no behaviour (D-051).

- A second browser test that failed once in CI, the charters test, depended on where a world running at the
  fastest speed happened to stop: in its world the scripted charter lapses and is offered again every three
  and a quarter days, and for a quarter of a day in between nothing is live. It now steps the world to a known
  moment and asserts the charter's state before reading its words.
- Recorded: the whole browser suite with D-050 in place, here and on GitHub's runners; how the window the
  failed run stopped in was worked out from the engine alone.
- **The game is deployed: https://tabula-rasa-bay.vercel.app** — a Vercel project made by the owner's import, from
  `main` at `41a4ffa`. The release check passes against it, 25 of 25. The owner's console and live minds are
  not deployed.
- On a phone a notice no longer sits on top of the time controls: it used to cover the step button and the
  clock for the five seconds it stays. Seen in the release check's own picture of the live site.
- A charter from a model can no longer carry a negative zero into a record (D-051). Found by a test that draws
  its cases at random, on a commit that had nothing to do with it.

## Pull request 4 — after phase 20: a page slower than its world (2026-11-25, merged)

Engine 0.7.0, unchanged. Snapshot schema 6. Affordances 2026.11-i. Prompt p2.

- The simulation sends the page a picture only when the page has taken the last one. A page that could not
  keep up with a world at the fastest speed used to fall further and further behind it — pause could take
  half a minute to show; now it is shown the world as it is when it next looks, and nothing in between is
  lost from the Chronicle (D-050).
- Pressing play or pause shows at once on a slow page, instead of a turn later.
- The autosave is written at the first sight of the world on or after a second morning, so a page that sees
  the world rarely still keeps every one.
- The browser test that found this — it failed once in CI — now asserts what the game promises and says what
  it found when it fails. `node scripts/trail.mjs <address> <folder>` measures the delay.
- Evidence for the whole-suite run at the phase 20 commit; a ten-minute limit for the slowest browser test.

**Not in it:** any call to a model; any deployment; a person or a device.

## Pull request 3 — phases 15–20 (2026-11-25, merged)

Engine 0.7.0, frozen. Snapshot schema 6. Affordances 2026.11-i. Prompt p2.

**For someone playing**
- The aim on each scenario's card is counted. The Atlas says where it stands — open, met or lost on a named
  day — for your world and for its untouched twin, and there is a notice on the morning it is decided. Two
  aims that could not be met in any world measured were reworded: The Long Winter now asks for three in five
  by spring, Thin Commons for four in five through the year (D-049).
- The Chronicle gathers the same sentence at the same hour into one line with a count; it opens out again.
- A notice you have to be told is no longer replaced within a moment by a line of journal news.
- On a phone every pressable thing is at least 44 × 44 px, the six speeds have a row of their own, and the
  first-steps card no longer sits over the inspector.
- The top bar fits itself to whatever it has to show, at any width (D-045).
- The fastest speed is the speed it says: the simulation no longer drops ticks it owes.
- One tab keeps the autosave; a hidden tab stops time and saves; a renderer that cannot keep up simplifies
  its picture and says so.
- Two Shores has two unequal shores, as its card always said (D-041).
- A world file that is opened is checked field by field, tried, and labelled for what it is (D-043).
- The keyboard alone drives the whole game.

**For the laboratory**
- The confirmatory batch was run, once, on holdout seeds 9000–9031: 448 runs, published as it came out.
  H1, H2, H3 and the first clause of H5 supported; H4 falsified by a ceiling; **H6a, the positive control,
  falsified** (D-044). The laboratory opens on it; the pilot that sized it is one choice away.

**For the owner**
- A spending ceiling that lives in the deployment's configuration and that the passphrase cannot raise; a
  live smoke test that is a numbered, unreplayable script; sign-in that strangers cannot lock; sign-out that
  ends every session; recovery of calls interrupted in flight (D-042).
- The database's time limits travel with each transaction, so the ledger works through a hosted database's
  connection pooler, and a lost connection fails one transaction instead of the process (D-047).
- `docs/DEPLOYMENT.md`, and `pnpm release:check -- <address>` to check a running site.
- `engines.node` is 22.x, the version every test ran on (D-048).

**Under the bonnet**
- Citizens can tell one another only what they know; role names are quoted labels; what a mind may attach is
  bounded (engine 0.7.0, D-040).
- An exact memory of failed route searches: 250 people run at 240–278 ticks a second where they ran at 41,
  with identical state hashes (D-046).
- Two independent reviews, every finding fixed or accepted (`docs/QA_REPORT.md`); scans of every line any
  commit has added; a lint rule against turning strings into markup or code; a seeded mutation run; a licence
  manifest.

**Not in it:** any call to a model; any deployment; a person or a device.

## Pull request 2 — phases 06–08 and 11–14 (2026-11-25, merged)

- Minds outside the engine: one observation and one answer format for every external mind, a mock provider, a
  recording format anyone can replay at no cost, three schedulers for rationing deliberation (D-016, D-019,
  D-023).
- The Claude adapter and the budget ledger: every call reserved before it is sent, bounded by bytes, settled
  from the provider's own usage report; unknown outcomes stay held (D-020, D-021). The owner's console, with
  spending authorized in words (D-025). Server runs that step, lease and resume (D-026).
- A second art pass; synthesized sound that is silent until asked for (D-028); what a citizen knows drawn by
  washing out what they have not seen (D-029); the field journal (D-030); agreements marked in the world once
  ratified (D-031).
- History as moments and lines: return to a stored morning, re-run it exactly, or leave on a new line; a
  loaded world's past is trusted only if re-living it arrives where it left (D-033). The untouched twin can be
  looked at (D-034).
- The laboratory: paired seeds, intervals before tests, a runner that will not touch holdout seeds by
  accident; the pilot on development seeds (D-036, D-037).

## Pull request 1 — phases 01–05, 09, 10 (2026-11-25, merged)

- Charter, pre-registered experiment protocol, affordance registry, five scenarios.
- A deterministic engine: keyed randomness, integer state, restricted arithmetic (D-003); terrain, seasons and
  weather; needs, illness and death; twenty physical actions validated and arbitrated; knowledge-limited
  pathfinding; perception and belief.
- The playable slice: a 3D diorama, six speeds, an inspector, the Chronicle with recorded causes, eight
  interventions that fork an untouched twin (D-012), Compare, saves.
- Agent cognition and a bounded-rational planner baseline (D-015); the reference ecology (D-014).
- An institution grammar in which rules are proposed, ratified and executed by an interpreter, a labelled
  grammar search, and an honest positive control (D-006, D-017, D-018).
- Society measures computed from the engine's own ledger; baseline exchange; the ODD model description.
