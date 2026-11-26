# TABULA RASA — product and design charter

Status: phase 01 deliverable · first written 2026-11-25 · living document (changes go through `docs/DECISIONS.md`).

## 1. What this is

TABULA RASA is an **observer / intervention sandbox**: a hand-sized island diorama inhabited by about fifty
independent minds who have been given bodies, needs, senses, a voice and a set of physical actions — and
nothing else. No one is assigned a job, a leader, a currency, a law or a faith. The player watches, inspects,
changes the conditions of the world, forks history and compares what happened with what would have happened.

It is **not** a city builder (the player never places buildings or issues orders), **not** an LLM chat room
(nothing an agent *says* happens unless the simulation engine validates and executes it), and **not** a claim
about real human societies (see `EXPERIMENT_PROTOCOL.md` §8).

One sentence for the title screen, as it stands there: *A living world. Fifty independent minds. No blueprint
for what they should become.*

## 2. Design pillars

1. **The engine is the only source of truth.** Agents — heuristic or Claude — emit *proposals*. A deterministic
   engine validates, arbitrates and applies them, and writes every consequence to an append-only ledger.
   A story told by a model is not a world event unless it was executed and logged.
2. **Causality you can touch.** The first change the player makes forks the world: an untouched twin with the
   same land, people, weather and luck keeps running beside it, and later changes go to the same changed world
   (D-012). The consequence of intervening is something you can *see*, with the limits of a single comparison
   stated.
3. **A place worth looking at.** The world is a museum diorama come alive: sculpted land, luminous shallows,
   figures that visibly walk, forage, carry, build, speak and rest. Art is built with the first slice, not after.
4. **Honest about what was designed.** Everything the designers supplied — every action, recipe, perception rule,
   cognitive prior, prompt and convention — is listed in a visible affordance registry (`AFFORDANCES.md`,
   mirrored in the app). Emergence is only ever claimed *within this designed model*.
5. **Free to play, impossible to overspend.** The public game runs entirely offline in the browser. Live Claude
   cognition is an owner-only, explicitly authorized, hard-capped mode.

## 3. Two experiences

### Observer mode (the game)
Watch · inspect · pause · step · accelerate · follow a citizen · read the Chronicle · open the institution ledger ·
intervene · rewind · fork · compare · read the field journal of what has been witnessed · save and resume. The
"optional challenge" first listed here was not built as one: each scenario states an aim on its card and nothing
checks or scores it; the journal took its place (D-030).

### Lab mode (the instrument)
As built (D-036): the registered studies are data in the repository (`src/lab/studies.ts`: conditions, measure
and the rule that would falsify each hypothesis) · matched-seed batches are run headlessly in Node from the
command line (`pnpm study`), not in the browser · the Laboratory page reads the resulting bundle and shows
per-condition means and paired contrasts with 95% intervals and effect sizes · any single cell can be re-run in
a browser worker and compared by hash, or opened as a world to watch · the bundle's files (a manifest with the
hash of every run, the report, the per-run table) can be downloaded. A study cannot be registered or started
from the browser. The Lab calls no paid service: live studies are not built, and the page shows only the most
they could cost.

## 4. The first fifteen minutes

| Minute | What the player does | What it teaches (through real state, never canned text) |
|---|---|---|
| 0–1 | Title screen with a live vista of a running world → **Begin** → picks a scenario or accepts the default; a seed is shown and can be typed. | The world is generated, reproducible and already alive. |
| 1–3 | Presses play. Dawn on day 1; fifty figures disperse toward water and food. Coach mark: *"Nobody here has been told what to do."* | Needs drive behaviour; the map matters. |
| 3–5 | Taps a citizen. The inspector shows needs, carried items, **what this citizen believes** versus **what is true**, and the stated reason for the current action. | Agents act on local, possibly stale knowledge. |
| 5–7 | Opens the Chronicle; taps an event to jump the camera to it and see its recorded causes. | Events are logged facts with causal parents. |
| 7–10 | Opens the intervention palette and changes the world (for example a cold snap or a blighted grove). The timeline forks; the untouched *control* keeps running in the background. | Interventions are environmental, never mind control. |
| 10–15 | Opens **Compare**: survival, stores, cooperation and any institutions in both timelines, with the warning that one pair is an anecdote. Saves; can resume later. | Counterfactual thinking; humility about n = 1. |

The tutorial is contextual (each coach mark appears when its subject is on screen), skippable at any time, and
never blocks input.

## 5. Scenarios

All scenarios are win-less sandboxes. Each states one **optional** aim on its card in the setup screen (the
last column below) and prescribes nothing about how to meet it. No citizen is told of it and nothing is
scored. Since phase 20 the aim is **counted**: the Atlas says, from the engine's own state, where it stands —
open until its day of reckoning, then met or lost — and says the same of the untouched twin once the observer
has made one (D-049; `src/worker/aims.ts`). Two of the aims were reworded then, because as first written they
could not be met in any world measured. The field journal is a different thing and is still there: twenty-one
questions, each answered by the first engine-logged event of its kind (D-030).

| Scenario | Distinct conditions | Optional aim, and how it is counted |
|---|---|---|
| **First Light** | Temperate island, moderate abundance, fifty adults dispersed across habitable land in early spring. The reference world for benchmarks and the default. | *See four in five through the first winter.* Of the fifty who began, those alive on the first morning of the following spring (day 41). |
| **The Long Winter** | Starts in late summer; winter is longer and colder; food spoils. Roughly a season and a half to prepare. | *Bring three in five through to spring.* Those alive on the morning spring comes (day 29). |
| **Thin Commons** | Food is concentrated in a few fishing lagoons and berry groves that collapse if over-harvested and recover slowly. | *See four in five through the year, on commons that can be stripped bare.* Those alive at the end of the first year; the commons' average fullness and emptiest morning are shown beside it. |
| **Two Shores** | A strait with a single ford divides the island; stone and clay lie on one shore, timber and most food on the other. | *Narrow the gap in well-being between the shores.* A reading with no day of reckoning: well-being of those who began on each shore, the dead counted as nought. Whether it is narrow is for the twin to say. |
| **Dry Year** | An ordinary start, then a drought of unannounced timing: streams shrink to pools and bushes fail. | *Keep four in five alive through the drought.* Those alive on the morning the drought ends; before it comes, the Atlas does not say when it will. |

All five scenarios and all eight interventions are in the product. (The first playable slice, phase 04,
shipped First Light alone.) Two Shores divides its resources between its shores as the table says since engine
0.7.0 (D-041); before that only the strait and the ford existed.

## 6. What the player may and may not do

**May (environment and conditions):** trigger weather (rain, cold snap, drought), enrich or blight wild resources
across the island, wash a windfall ashore, bring newcomers to the shore, and dampen how far voices carry (Hush).
Widening them was not built: an intervention can only lower the hearing radius (`hearingRadius` in
`src/engine/world/climate.ts`; D-039). Starting conditions are set when a world is made — scenario, seed, kind of
baseline mind and agreements on the setup screen — and, for the Lab, by the configuration overrides of each
registered study (`src/lab/studies.ts`, D-036), not by a visitor to the Laboratory page. Every intervention is
recorded with observer provenance and marks its timeline as *treated*.

**May not:** set an agent's thoughts, force an action, edit an inventory, ratify or veto an institution, or
"suggest" behaviour through hidden prompts. A separately labelled *Puppeteer* mode is explicitly out of scope for
the release; if ever added it must be a distinct, clearly marked treatment.

**Forecasts:** the game never shows an invented prediction. "What might happen" is always answered by actually
running forks.

## 7. Controls

| Action | Desktop | Phone (portrait and landscape) |
|---|---|---|
| Orbit / tilt | Right-drag or Alt-drag; `Q` and `E` turn the view (no key tilts it) | Two-finger twist / two-finger vertical drag |
| Pan | Left-drag, `W` `A` `S` `D` / arrows | One-finger drag |
| Zoom | Wheel; `+` or `=` in, `-` or `_` out | Pinch |
| Select / inspect | Click | Tap: the view turns to what was tapped and its card opens drawn back to its head, so that both can be seen. A tap on the card's head, a pull up or its arrow opens the whole card |
| Follow selected | `F` | Follow button in the bottom sheet |
| What the selected citizen knows / whom they know | `V` / `T` | Buttons in the bottom sheet |
| Play / pause | `Space` | Timebar button |
| Step one tick | `.` | Step button |
| Speed | `1`–`6` | Six speed buttons in the timebar |
| Chronicle / Intervene / Charters (the institution ledger) / Compare | `C` / `I` / `G` / `K` (Compare once the world has a twin) | Buttons in the top bar |
| Atlas and almanac / History / Field journal | `L` / `H` / `J` | Buttons in the top bar; in windows 560 px wide or less the journal is in the menu, and at 340 px or less History is too |
| Look at the twin and back | `X` (once there is one) | Twin button in the top bar |
| Sound on / off | `M` | Button in the top bar; in the menu at 560 px or less |
| Close panel | `Esc` | Swipe down or close button |

The keys above are every key the game's own handler reads (`src/ui/game/Game.tsx`); the menu has no key. They
act while a world is being played and no panel other than the Chronicle is open: with any other panel open only
`Esc` is read. `Esc` closes the open panel, otherwise clears the selection, and on the setup screen goes back to
the title. Keys are ignored while typing in a field and while Ctrl, Alt or ⌘ is held; letters mean the same
with Shift held or Caps Lock on. Apart from that handler, a focused chart in
Compare reads `←` and `→`. The swipe is `src/ui/game/swipe.ts`: with touch or a pen, in windows up to 880 px
wide, a panel can be dragged down by its header to close it; the inspector's card, which opens drawn back
there, is also opened by a pull up, and opened or drawn back by a tap on its header or by its arrow. The rules
for when letting go closes or opens are unit-tested (`swipe.test.ts`), and the tap and the arrow are run in the
phone project of `play.spec.ts`; the pulls themselves have not been run in a browser test, and none of it has
been run on a physical device.

**Following.** While a citizen is followed the camera stays on them, and they are drawn in the middle of the
map that the interface leaves uncovered — on a phone, above their card. Moving the view across the ground lets
go of them; so does choosing someone or somewhere else, closing their card, or pressing Follow again. Zooming,
turning and tilting the view do not: none of them looks anywhere else (D-052).

On touch devices every pressable target is at least 44 × 44 CSS px. Links inside a sentence are exempt, as
they are in the guideline. This is measured, not asserted: the phone project of `tests/e2e/a11y.spec.ts`
measures every pressable thing on each of its seventeen screens, and the narrowest and the shortest it meets
are both 44 px (`evidence/phase-16/a11y-mobile.json`). (This sentence was false until phase 15 — for the speed
buttons, the fork badge, the banner buttons and, once everything was measured, six more kinds of control. On a
phone the six speeds now have a row of their own under the clock: beside the play button they cannot be 44
wide on a 390 px screen. The measurement is of that one screen size; a tablet gets the same rules by
`pointer: coarse` but has not been measured.) Every control is reachable by keyboard with
a visible focus ring; nothing depends on hover.

## 8. Accessibility, privacy and non-exploitative design

- **Reduced motion:** honours `prefers-reduced-motion` and an in-app switch: camera easing, particles and
  ambient animation are reduced; simulation speed is unaffected.
- **Contrast and redundancy:** text meets WCAG AA contrast on both parchment and forest surfaces; state is never
  conveyed by colour alone (icons, labels and patterns accompany colour).
- **Audio:** off until the player's first gesture; separate ambience, music and cue sliders and a master mute.
- **Privacy:** no accounts, analytics, advertising, trackers or third-party requests. Free play stores saves only
  in the player's browser (IndexedDB). A save is deleted from the menu; a world is exported to a file, and a file
  opened, from the History panel (D-033). Nothing about a player is sent to or kept by the server; citizens have
  invented names assembled from neutral syllables. One thing is kept about one kind of visitor: whoever tries
  to sign in at the owner's door has their network address (an IPv4 address, or the /64 of an IPv6 one) counted
  for a day and written to the owner's audit log (`docs/DEPLOYMENT.md` § Privacy).
- **No dark patterns:** no timers that punish leaving, no streaks, no currencies, no purchases, no artificial
  scarcity of play. Sessions have natural stopping points (dusk, season's end) and a clear pause.
- **Depiction:** death from hunger, thirst or cold is a quiet state change (a figure lies down and a small cairn
  remains); there is no gore, no violence between agents, and no sensational content.
- **Fictional speech:** when model-driven agents use political or cultural language it is displayed as in-world
  fiction, attributed to the fictional speaker and never presented as the app's or the model's view.

## 9. UI flow

```
Title (live vista)
 ├─ Begin ─► Scenario, seed, minds, agreements ─► World (Observer HUD)
 │                               ├─ Timebar: play / pause / step / six speeds / clock of the day
 │                               ├─ Top bar: day, season, weather, living · the fork and its twin · the panels below
 │                               ├─ Inspector: a citizen · a place (its resource, structure, ground, what lies there)
 │                               ├─ Chronicle (filterable event feed with causal links)
 │                               ├─ Charters, the institution ledger (proposals, institutions, rules in force, membership)
 │                               ├─ Overlays for the selected citizen: what they know · whom they know (D-029)
 │                               ├─ Atlas and almanac · Field journal (D-030)
 │                               ├─ Interventions ─► fork ─► Compare (the changed world against its untouched twin, D-012)
 │                               ├─ History: stored moments to watch again or leave from · world lines · files (D-033)
 │                               └─ Menu: save · load · delete · settings · sound · affordances · about
 ├─ Continue (the latest local save)
 ├─ Laboratory ─► a study bundle written by `pnpm study` ─► results ─► re-run a cell / open it as a world / download (D-036)
 ├─ Recordings (zero-cost replays checked against their record: one bundled MOCK recording, and runs the owner publishes)
 └─ What was designed (the affordance registry)

Owner console (`/owner`, authenticated; not linked from the title) ─► budget · live runs · kill switch
```

This is the flow as built. The first version of this section also listed things that were not built, or were
built differently:

- **Scrubbing history from the timebar.** History returns to the start and to every second morning instead;
  there is no continuous scrubber (D-033).
- **A social-network overlay.** Built for one citizen at a time: arcs to the people the selected citizen has
  dealt with (D-029). There is no view of the whole society's ties.
- **A resources overlay.** Not built (D-039). A resource's stock is shown by the thing itself in the world and
  by the inspector's place card; the almanac charts wild food and commons health.
- **A Debrief after Compare.** Not built (D-039). Compare is the last step, and says that one pair of worlds is
  an anecdote (D-012).
- **A study wizard and batch runs in the browser.** Not built (D-036): studies are run from the command line and
  read in the Laboratory.
- **Export from the menu.** A world is exported, and a file opened, from the History panel (D-033).
- **Institutions and events in the inspector.** Not built (D-039): they are read in the Charters panel and the
  Chronicle, and the inspector shows a citizen or a place.
- **Recordings of real model runs.** None exists: nothing has been spent. The one bundled recording is of mock
  minds and is labelled MOCK wherever it appears (D-026).

## 10. Unresolved decisions (tracked; none blocks the vertical slice)

| # | Question | Default taken | Revisit when |
|---|---|---|---|
| U1 | Should births / generations exist? | No (fixed cohort of adults); possible labelled optional treatment. | After phase 10 if runs feel static beyond year one. |
| U2 | Should agents be able to take from one another's bodies (coercion)? | No. Unattended and unbound stores can be taken from; carried items cannot. Documented as a designer limitation. | Phase 16 review. |
| U3 | Is engine-attested evidence for accusations too strong an affordance? | Evidence is checkable only when the accuser actually perceived the act. | Phase 09 fuzz + phase 14 treatment. |
| U4 | Live model for runtime cognition | Owner-configured; Fable 5.2 preferred; never substituted silently. | Phase 17 (owner authorization). |
| U5 | Public curated recordings | One recording of mock minds is bundled and labelled MOCK wherever it appears (D-026). No recording of a real model run exists until an authorized run is recorded. | Phase 17. |

## 11. Vertical-slice priority

1. Deterministic 50-agent world with ecology, needs and validated actions (phase 03).
2. Playable observer loop with real rendering, inspection, one intervention, fork-compare, save/resume (phase 04).
3. Bounded minds, institution grammar, economy (phases 05, 09, 10).
4. Provider interface, budget ledger, orchestration (phases 06–08).
5. Art and UX depth, history tools, Lab, performance, adversarial QA, release (phases 11–20).
