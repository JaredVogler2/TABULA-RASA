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

One sentence for the title screen: *A living world. Fifty independent minds. No civilization blueprint.*

## 2. Design pillars

1. **The engine is the only source of truth.** Agents — heuristic or Claude — emit *proposals*. A deterministic
   engine validates, arbitrates and applies them, and writes every consequence to an append-only ledger.
   A story told by a model is not a world event unless it was executed and logged.
2. **Causality you can touch.** Every change the player makes creates a fork whose untouched twin keeps running,
   so the consequence of an intervention is something you can *see*, with the limits of a single comparison stated.
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
intervene · rewind · fork · compare · take on an optional challenge · save and resume.

### Lab mode (the instrument)
Register a study (hypotheses, independent and dependent variables, seed sets, run length) · run matched-seed
batches headlessly in workers · inspect effect sizes with uncertainty · replay any individual run · export a
reproducible bundle (manifest, per-run metrics, hashes). The Lab never contacts a paid service unless the owner has
authorized a specific budget.

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

All scenarios are win-less sandboxes with **optional** objectives. No scenario prescribes how an objective should be
met, and objectives are evaluated only from engine state.

| Scenario | Distinct conditions | Optional objective |
|---|---|---|
| **First Light** | Temperate island, moderate abundance, fifty adults dispersed across habitable land in early spring. The reference world for benchmarks and the default. | See four in five through the first winter. |
| **The Long Winter** | Starts in late summer; winter is longer and colder; food spoils. Roughly a season and a half to prepare. | Lose no one to cold or hunger before spring. |
| **Thin Commons** | Food is concentrated in a few fishing lagoons and berry groves that collapse if over-harvested and recover slowly. | Keep every commons above its collapse threshold for a year while four in five survive. |
| **Two Shores** | A strait with a single ford divides the island; stone and clay lie on one shore, timber and most food on the other. | Narrow the gap in well-being between the shores. |
| **Dry Year** | An ordinary start, then a drought of unannounced timing: streams shrink to pools and bushes fail. | Keep four in five alive through the drought. |

The first playable slice ships **First Light** and the resource-shock intervention; the others follow as the
ecology deepens.

## 6. What the player may and may not do

**May (environment and conditions):** trigger weather (rain, cold snap, drought), enrich or blight a resource,
wash a windfall ashore, bring newcomers to the shore, dampen or widen how far voices carry, and — in the Lab — set
starting conditions. Every intervention is recorded with observer provenance and marks its timeline as *treated*.

**May not:** set an agent's thoughts, force an action, edit an inventory, ratify or veto an institution, or
"suggest" behaviour through hidden prompts. A separately labelled *Puppeteer* mode is explicitly out of scope for
the release; if ever added it must be a distinct, clearly marked treatment.

**Forecasts:** the game never shows an invented prediction. "What might happen" is always answered by actually
running forks.

## 7. Controls

| Action | Desktop | Phone (portrait and landscape) |
|---|---|---|
| Orbit / tilt | Right-drag or Alt-drag | Two-finger twist / two-finger vertical drag |
| Pan | Left-drag, WASD / arrows | One-finger drag |
| Zoom | Wheel, `+` `-` | Pinch |
| Select / inspect | Click | Tap |
| Follow selected | `F` | Follow button in the bottom sheet |
| Play / pause | `Space` | Timebar button |
| Step one tick | `.` | Step button |
| Speed | `1`–`5` | Speed chip |
| Chronicle / Ledger / Compare | `C` / `L` / `K` | Tabs in the bottom sheet |
| Close panel | `Esc` | Swipe down or close button |

All interactive targets are at least 44 × 44 CSS px on touch devices. Every control is reachable by keyboard with
a visible focus ring; nothing depends on hover.

## 8. Accessibility, privacy and non-exploitative design

- **Reduced motion:** honours `prefers-reduced-motion` and an in-app switch: camera easing, particles and
  ambient animation are reduced; simulation speed is unaffected.
- **Contrast and redundancy:** text meets WCAG AA contrast on both parchment and forest surfaces; state is never
  conveyed by colour alone (icons, labels and patterns accompany colour).
- **Audio:** off until the player's first gesture; separate ambience, music and cue sliders and a master mute.
- **Privacy:** no accounts, analytics, advertising, trackers or third-party requests. Free play stores saves only
  in the player's browser (IndexedDB) and can be exported or deleted from the menu. No real personal data is used
  anywhere; citizens have invented names assembled from neutral syllables.
- **No dark patterns:** no timers that punish leaving, no streaks, no currencies, no purchases, no artificial
  scarcity of play. Sessions have natural stopping points (dusk, season's end) and a clear pause.
- **Depiction:** death from hunger, thirst or cold is a quiet state change (a figure lies down and a small cairn
  remains); there is no gore, no violence between agents, and no sensational content.
- **Fictional speech:** when model-driven agents use political or cultural language it is displayed as in-world
  fiction, attributed to the fictional speaker and never presented as the app's or the model's view.

## 9. UI flow

```
Title (live vista)
 ├─ Begin ─► Scenario & seed ─► World (Observer HUD)
 │                               ├─ Timebar: play / pause / step / speed / day–season clock / scrub history
 │                               ├─ Inspector: citizen · place · structure · institution · event
 │                               ├─ Chronicle (filterable event feed with causal links)
 │                               ├─ Ledger (proposals, institutions, rules in force, membership)
 │                               ├─ Overlays: social network · resources · knowledge of selected citizen
 │                               ├─ Interventions ─► fork ─► Compare (treated vs control) ─► Debrief
 │                               └─ Menu: save · load · export · settings · affordances · about
 ├─ Continue (local saves)
 ├─ Lab ─► study wizard ─► batch run ─► results ─► replay a run / export bundle
 ├─ Recordings (curated, zero-cost replays of real runs; empty until such runs exist)
 └─ Owner console (authenticated) ─► budget · live runs · kill switch
```

## 10. Unresolved decisions (tracked; none blocks the vertical slice)

| # | Question | Default taken | Revisit when |
|---|---|---|---|
| U1 | Should births / generations exist? | No (fixed cohort of adults); possible labelled optional treatment. | After phase 10 if runs feel static beyond year one. |
| U2 | Should agents be able to take from one another's bodies (coercion)? | No. Unattended and unbound stores can be taken from; carried items cannot. Documented as a designer limitation. | Phase 16 review. |
| U3 | Is engine-attested evidence for accusations too strong an affordance? | Evidence is checkable only when the accuser actually perceived the act. | Phase 09 fuzz + phase 14 treatment. |
| U4 | Live model for runtime cognition | Owner-configured; Fable 5.2 preferred; never substituted silently. | Phase 17 (owner authorization). |
| U5 | Public curated recordings | None exist until a real authorized run is recorded. | Phase 17. |

## 11. Vertical-slice priority

1. Deterministic 50-agent world with ecology, needs and validated actions (phase 03).
2. Playable observer loop with real rendering, inspection, one intervention, fork-compare, save/resume (phase 04).
3. Bounded minds, institution grammar, economy (phases 05, 09, 10).
4. Provider interface, budget ledger, orchestration (phases 06–08).
5. Art and UX depth, history tools, Lab, performance, adversarial QA, release (phases 11–20).
