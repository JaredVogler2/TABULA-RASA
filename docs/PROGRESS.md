# Progress

Status vocabulary: PASS · PARTIAL · BLOCKED · NOT RUN. A phase is PASS only when its gate is proven by executed
checks recorded in `EVIDENCE.md`. Execution order follows D-001.

| Phase | Title | Status | Date | Summary |
|---|---|---|---|---|
| 01 | Product and science | **PASS** | 2026-11-25 | Charter, pre-registered protocol (H1–H6), affordance registry (code + generated doc), five scenarios, acceptance matrix, UI flow. The bibliography followed with phase 03: `docs/LITERATURE.md`, 57 entries, each naming the record it was checked against (`docs/EVIDENCE.md` § Research inputs). |
| 02 | Architecture | **PASS** | 2026-11-25 | Next.js 16 + TS skeleton; lint-enforced engine purity and server isolation; deterministic core (keyed RNG, SHA-256, canonical JSON); Turbopack-bundled worker verified; Playwright desktop + phone emulation; CI observed green on GitHub; ADRs D-001–D-011; typed domain model and feasibility benchmark delivered with phase 03. World canvas delivered in phase 04; SQL migrations delivered and tested in phase 07 (`db/migrations/`, embedded at build time). |
| 03 | World engine | **PASS** | 2026-11-25 | Seeded island (terrain, drainage, biomes, nodes), seasons/weather, needs/illness/death, 20 physical actions with structural + semantic validation and fair arbitration, knowledge-limited pathfinding, local perception and beliefs, reflex baseline, events with causal parents, declared source/sink ledger, canonical snapshots, forks, migrations. 98 tests; five scenarios replay bit-identically; benchmarks at 50/100/250/500 agents. |
| 04 | Playable slice | **PASS** | 2026-11-25 | Title with a live attract-mode island → scenario/seed → 3D diorama → play/pause/step/six speeds → click or tap a citizen (needs, plan, memory, beliefs vs truth) → Chronicle with recorded causes → eight environmental interventions that fork history against an untouched twin → Compare (charts, table, caveat) → IndexedDB save/load/autosave → reload and continue. Engine in a Web Worker; renderer interpolates between ticks. Playwright walkthroughs with real clicks (1366×768) and taps (390×844 emulation) pass with no console errors, failed or cross-origin requests. Gaps: reflex baseline only (planner is phase 05); frame rates measured on a software renderer only; no physical device. |
| 05 | Agent cognition | **PASS** | 2026-11-25 | Perception → belief → memory → plan → intent → outcome, with provenance at every step (`docs/COGNITION.md`). Bounded-rational planner baseline whose every threshold traces to a trait, skill or lived experience; first-person promise, trust and hearsay bookkeeping; seasonal foresight from felt temperature only. Privacy-safe Observation, action mask, validated external decisions and a ledger that doubles as a replay tape; deterministic mock mind. Reference ecology retuned (D-014). 26 new tests (124 total): trait-driven differences, sentinel-leak privacy checks, trust dynamics, decision limits, replay from recorded intents, mixed-population competence, no institutional intent in the planner. Gaps: the mock mind is the only external mind so far (provider adapters are phase 06); observation size not yet measured in tokens. |
| 09 | Institution DSL | **PASS** | 2026-11-25 | Rule grammar v1 (`docs/INSTITUTIONS.md`): bounded integer formulas over public facts; charters with entry, bond, roles, a stated decision rule and five deontic rule forms; validator with path-and-reason diagnostics; interpreter with fuel, resumable period closings, motions and votes, sanctions limited to a member's own bond, unconditional exit; escrowed two-party pacts; custody counted by the conservation audit. Baseline civic mind (one judging rule for signing, voting, dues, leaving), grammar search as a labelled treatment, scripted positive control. Charters panel and Chronicle sentences generated from rules, with origin labels. 31 tests incl. fuzzing; snapshot schema 3. Gaps: no survival benefit of institutions demonstrated on development seeds (reported as such; H6a may fail); baseline agents do not yet use pacts. |
| 10 | Economy and society | **PASS** | 2026-11-25 | Society measures computed from the ledger (`metrics/society.ts`): cooperation, five-day reciprocity, trade volume, Newman modularity under greedy agglomeration, the E1–E4 ladder by origin, member-days, collective-action success, decision-influence concentration, exclusion. Baseline exchange from individual valuations (no price anywhere), weighed against self-provision. `docs/ODD.md`. 11 new tests with hand-computed cases (166 total), a tracker-versus-engine consistency run and a paired scarcity shock. Gaps: exchange among baseline agents is thin (hundreds of offers, a handful taken up); public speech is not a network tie because hearers are not logged; no births, kinship or inheritance (deliberately out of scope). |
| 06 | Claude API | **PASS** | 2026-11-25 | Provider contract with Mock, Replay, Baseline and a live Anthropic adapter (official SDK 1.14, its retries off, one request per decision, usage priced before anything else is done with the answer). A flat answer schema inside the documented structured-output limits, with charters carrying their formulas as text (D-019); prompt p1, published verbatim and generated from code (`docs/PROMPTS.md`, D-024); hostile-speech fixtures. Mock and replay run end to end through the real server and the browser. The one test that can make a paid call is skipped by name in every run. **Never exercised against the real API**: whether the provider accepts the schema, how a model behaves, and what a call costs are all unmeasured. |
| 07 | Budget and security | **PASS** | 2026-11-25 | PostgreSQL ledger in integer microdollars: atomic conditional reservation before dispatch, deterministic ids, settle / release / unknown, overage trips the kill switch, CHECK constraints as a second line (D-020, D-021). Zero authorized and the switch on by default; spending is authorized in typed words, twice (D-025). Owner sign-in (scrypt, signed HttpOnly SameSite=Strict cookie, origin and token checks), throttled; bounded bodies; audit log. 100 concurrent requests from two pools on PostgreSQL 16 cannot overspend; duplicates and re-ordered settlements charge once; unknown outcomes stay held; unauthenticated and forged requests never construct a provider; secret, bundle and log scans pass and each is shown to go red on a planted leak. Gaps: no second factor; the cap covers only what this application sends. |
| 08 | Orchestration | **PARTIAL** | 2026-11-25 | Three schedulers that read only a mind's own state, with a daily cap, a starvation bound and a stated reason for every mind (D-023); snapshot-parallel answers committed in id order; resumable epoch steps with a lease, stored answers and one commit per epoch (D-026); recordings that a browser rebuilds and checks against the record. Proven: fifty minds deciding independently, scheduling trace, deterministic replay, cancellation and resume under injected failures, a multi-epoch mock run through the real server, two instances racing on PostgreSQL. Policies compared on the same seeds for calls, fairness, time on own plan and the money that would have been held. **Open:** the *quality* of decisions under each policy cannot be compared without a model — that part of the gate is blocked on an authorized run (phase 17). Development observation: under a tight ration, minds spend 7–8% of their time on a plan of their own. |
| 11 | Art direction | **PARTIAL** | 2026-11-25 | Five screenshot-led critique passes; captures of four of them kept (`evidence/phase-11/cycles/`, passes 6 to 9). People stand beside what they work on and face it; tools and baskets are drawn only for those who own them; loads are shaped by what is carried; sleeves, belts, hats. Hidden people show as a stencil-gated shape (D-027). Fresh water by depth with gravel beds, damp banks, pebbles, current and still ponds; remodelled clay and shelters; smoke from lit fires, fish rises by stock, birds. Ratified agreements leave posts, cords and pennants (D-031). Wear calibrated to the engine's path threshold (D-032). Procedural sound (D-028). Rubric and weaknesses in `docs/ART_BIBLE.md`. **Open:** the 60/30 fps targets are unmeasured (software renderer only); nobody has heard the sound; rubric is self-scored. |
| 12 | Observer UX | **PARTIAL** | 2026-11-25 | What a citizen knows (unseen land washed out; arcs to acquaintances; D-029), what they set out to do and what came of it, atlas and almanac, field journal of witnessed events (D-030), keys for every instrument, audio sliders. E2E on desktop and phone emulation; axe scan of thirteen states with one real violation fixed; contrast computed from tokens with two fixes. Review and gaps in `docs/OBSERVER_UX.md`. **Open:** no human playtest, no screen reader, no physical device; timeline scrubbing is phase 13; no whole-society network view. |
| 13 | History and causality | **PARTIAL** | 2026-11-25 | Going back in a live world without losing anything (D-033): the start and every second morning are kept as compressed moments; *watch it again* re-applies the observer's interventions at their ticks and checks the state digest on arrival; *leave from there* starts a new line (same luck or new) and sets the old one aside with its hash; world lines as a tree. A world opened from a save lives its past again from its seed and keeps the result only if it arrives at exactly the loaded world; an edited save fails that check. Files with a manifest and SHA-256, refused if altered; a stored save is refused if it no longer matches its hash; the event ledger as JSON Lines. The twin on screen from the same camera at the same tick, and a twin for recordings (D-034); Compare with day-by-day differences, both worlds counted side by side and what happened in each by kind; recorded causes under Chronicle entries. Proven in the engine (`history.test.ts`), through the worker's protocol with no browser (`sim.worker.test.ts`) and end to end. Also fixed: a forked save reloaded as "Forked on day 1". **Open:** "offline and live recorded histories compare" is proven with a mock recording only — no live recording exists because nothing may be spent; lines set aside do not survive a reload; no continuous scrubber. |
| 14 | Experiment lab | **PASS** | 2026-11-25 | The six registered hypotheses as data, one runner, one analysis (D-036): conditions paired by seed, 95% bootstrap intervals, d_z and Cliff's δ, the registered rule applied to the interval, Holm across the family, missing cells listed, seed counts fixed from a pilot by precision. `pnpm study` is checkpointed, shardable, and refuses holdout seeds without a plan. **224 real offline runs** (development seeds 1–16, engine 0.6.0), every one with the hash of its final state; 12 re-run and reproduced. The Laboratory page shows the bundle as what it is, re-runs any cell in the reader's browser to the same hash, opens it as a world to watch, offers the raw tables, and prices live versions of the designs from the published price list. A planner clock makes cadence a real treatment (D-035). **What the pilot showed (D-037):** the scripted control does *not* raise survival (−0.058 [−0.114, 0.000]); H4 hits a ceiling; H3's interval spans zero; H5's manipulation is weaker than registered. Nothing was tuned in response. **Not built, and said so:** a wizard for starting studies in the browser, a hypothesis-suggesting agent, live studies (blocked with phase 17). **Pending:** the confirmatory batch on holdout seeds, once the engine is frozen after phases 15–16. |
| 15 | Scale and performance | **PARTIAL** | 2026-11-25 | Profiled before anything was optimized, and the profile found what a five-day benchmark had hidden: in a crowded, starving world three quarters of the time went to route searches that fail (41 ticks a second at 250 people, 13 at 500). An exact memory of failed searches — the same answers, proven by state hashes and by re-running 72 cells of the registered studies — brings those to about 250 and 100; the behaviour that caused it is a defect of the baseline planner and is left for the redesign (D-046). Thresholds were written down before the browser, load and request measurements (`docs/PERFORMANCE.md`): the reference world runs at 1,070–3,244 ticks a second headless, the ledger takes 1,059 reservations a second from 32 workers with nothing over-reserved, public routes answer in 3–5 ms. Saves are stored compressed (a tenth of their text). Resilience in a real browser: two tabs and one autosave slot, a hidden tab, an altered save, and a renderer that cannot keep up — whose fallback is shown to leave the world's state hash unchanged. The top bar now measures itself and fits at 25 widths with the longest labels it can show (D-045); every touch target on the phone project is measured. **Open:** no frame rate has been measured on a device with a graphics chip (threshold P8: not run), and the browser-side latency thresholds cannot be judged under a software renderer that takes over 300 ms a frame. |
| 16 | Adversarial QA | **PASS** | 2026-11-25 | Two independent read-only reviews by separate agents (`evidence/phase-16/review-*.md`): the security review found no critical or high issue, 8 medium and 16 low; the documentation audit found 5 high, 17 medium and 16 low claims the code did not support. Every finding is fixed or listed as accepted with its reason, finding by finding, in `docs/QA_REPORT.md`, each fix held by a named test (D-040, D-042, D-043). The engine was then frozen at 0.7.0 and the registered pilot re-run on it: all 224 runs end on the same state digest. **The confirmatory batch was run once** on holdout seeds 9000–9031 (448 runs) and is published as it came out: H1, H2, H3 and H5's first clause supported; H4 falsified by a ceiling; H5's manipulation weaker than registered; **H6a, the positive control, falsified** — so nothing here shows that agreements help anyone in this world (D-044). Two Shores now does what its card says (D-041); the charter describes the product that exists (D-039). Written last, the test of the database's time limits found two more defects, both fixed: a connection lost under a transaction would have ended the server process, and the limits were sent in a way a hosted database's pooler refuses — shown here against a real pooler, through which every server suite, the ledger load test and the owner's browser flow now pass (D-047). **Not run, and said so:** a human playtest, a physical device, a screen reader, any browser but Chromium, any request to the provider. |
| 17 | Live pilot | **BLOCKED** | 2026-11-25 | No spend authorized, and no key has ever been present. Everything the phase needs exists and is tested with canned responses: the adapter, the ledger, the smoke script (`pnpm live:smoke`: its reporting mode runs; its paid path never has). What the owner is asked for — the model, the price date, the most a call can hold, the number of calls, the upper bound, and the four acts that authorize — is in `docs/COST.md`. The words that authorize spending are the owner's to type; the developer agent does not type them. |
| 18 | Vercel release | **PASS** (the game alone) | 2026-11-26 | **Deployed at level 1: https://tabula-rasa-bay.vercel.app**, the production address of a Vercel project the owner made by importing this repository, built from `main` at `41a4ffa`. `pnpm release:check` against it: **25 of 25** — health, security headers, a stranger refused at all seven routes that could spend or change anything, another origin refused, the game on a desktop and as a phone (a world made, a day passed, the Chronicle, a save across a reload), the bundled recording replayed to a match, nothing asked of any other origin, nothing server-only sent to the browser (`evidence/phase-18/release-check-deployed.txt`, `deployed-by-hand.txt`, `deployment.txt`, stills). How it went: the owner approved; Vercel refused the assistant's call to create the project (403, `create-project-refused.txt`); the owner imported it; the assistant created and set nothing on Vercel. The phase's gate asks for a live address if authorized, the public offline path verified, the unauthenticated paid path denied, a release checklist, rollback, onboarding, known issues and a cost sheet: `docs/DEPLOYMENT.md`. **Not deployed, and not claimed:** the owner's console (level 2: it needs a database, a billable integration that has not been asked for) and live minds (level 3: phase 17). So nothing about a hosted database has been verified, D-047 included. **Not observed:** which Node.js the functions run on (the project's setting reads 26.x; `engines` says 22.x and by Vercel's documentation overrides it: D-048). |
| 19 | Fable benchmark | **PASS** | 2026-11-25 | `docs/SCORECARD.md`: a dated self-assessment against the phase's own weights and anchors, with the session as its own record has it (17 hours, five messages from the owner, 22 CI runs, token counts as recorded and unpriced), the four vetoes with the facts under each — none triggered, and two things disclosed that should be weighed: a command that would have supplied the owner's authorizing sentence, refused by the session's safety check before it ran with no key present; and 38 claims in earlier documents that an audit found the code did not support. **68 of 100**, with no criterion graded as independently stress-tested, because nothing was: the reviewers were models and no person or device has examined anything. It says nothing about how a model decides for citizens at run time — that has not been measured. Raw material in `evidence/phase-19/`. |
| 20 | Redesign and handoff | **PASS** | 2026-11-25 | The release build was reviewed against the original promise (`docs/HANDOFF.md`): five questions answered as far as stills and tests can answer them, and five improvements ranked. Two were made. **The aim on each scenario's card is counted** — open, met or lost on a named day, for the world and its untouched twin, from the state alone — after measuring that two of the aims as first written could not be met in any world and rewording them (D-049). **The Chronicle gathers repeated lines** of the same hour into one with a count. Three were recorded and not done, with reasons: a model has to be run (blocked), a person and a device have to look at it (not possible here), and the two defects the experiment and the long benchmark found need a new engine version. Handoff: `docs/HANDOFF.md` (status of every phase, what is the owner's to do and how, costs and risks), `CHANGELOG.md`, stills in `evidence/phase-20/`. **Not claimed:** any paid or human testing. |

**After phase 20 (2026-11-25).** Two browser tests failed once each in CI, on two commits. Neither was
re-run; each was followed to its cause. The first asked for more than the game promises, and behind it a page
slower than its world could fall behind it without limit (slowed twenty times at the fastest speed, "paused"
was shown more than half a minute late): both are fixed and measured before and after (D-050). The second
depended on where a world running at the fastest speed happened to stop, and now steps its world to a known
moment. A third failure, of a unit test on a commit that changed only documents, was a real edge of the engine's
bounded copy (a negative zero; D-051). And the release check's own picture of the live site as a phone showed a
notice sitting on the time controls: fixed, measured and held by a test. Measuring that found a fifth: a
notice was drawn half its width off-centre while it faded in, and jumped. Evidence for all five:
`evidence/after-20/`. Phase 18 became PASS for the game alone (above); phase 15 stays PARTIAL for the reason
it was — no device.

**What a phone showed (2026-11-26).** The owner opened the deployed game on their phone and within minutes
reported two things that every test and every still had passed over (interventions 17 and 18, below): the
Recordings sheet with its words crowded into a sliver and running off the screen, and a Follow that did not
appear to follow — on a phone the person followed was held behind their own card. Both are fixed, and four
more faults of Follow were found beside them: a tapped citizen hidden the same way, a zoom that ended the
follow without a word, a camera that went on tracking the first person after a second was chosen, and a
camera that trailed a walker at low frame rates (D-052). What changed in how things are tested matters as much
as the fixes: the flow test used to read that the button said "Following"; it now measures where the person is
drawn and what is on top of that point of the page. Evidence: `evidence/after-20/sight-before.md` (the
deployed build) against `sight-after.md`, `rows.txt`, `follow.txt`. The owner merged the fixes as pull request
7, and four minutes later the deployed site was measured the same way and showed neither fault
(`evidence/after-20/sight-live.md`); the release check passed again, 25 of 25
(`evidence/phase-18/release-check-after-pr7.txt`). The record, and three small changes made after the
fixes, followed as pull request 8; after it was merged the site passed the release check once more and the
two of those changes that can be seen were found on it (`evidence/after-20/after-pr8.txt`). Phases 11 and 12
stay PARTIAL: this was a few minutes of
one person on one phone, not a playtest or a pass over devices, and the fixes have been measured in Chromium
at a phone's size, not seen on a phone by the builder.

## Spend

Anthropic API: **$0.00** (no calls made, no key configured). Infrastructure: one Vercel project, made by the
owner for the game alone; no database and no paid add-on. The deployed site has no owner configured, so its
console cannot be signed in to and nothing on it can spend.

## Human interventions

Everything the owner did or said, from the session's own record (times in UTC, 2026-11-25 unless a date is given):

1. 02:35 — the initial instruction (`prompts/` and `CLAUDE.md` were committed by the owner beforehand).
2. about 07:25 — merged pull request 1 (phases 01–05, 09, 10) into `main`.
3. 12:48 — "Pull request errors 1 of 2": pointed at a failing check on pull request 2. It was fixed.
4. 13:41 — "Proceed I used a usage fable 5.2 reset": permission to go on after a usage limit.
5. about 13:42 — merged pull request 2 (phases 06–08, 11–14).
6. 16:57 — "Try again", sent while work was in progress; nothing had failed, and work went on.
7. 19:37 — "Try again", once more, likewise.
8. 21:07 — merged pull request 3 (phases 15–20).
9. 23:26 — merged pull request 4 (D-050), half a minute after its checks went green.
10. 2026-11-26, about 00:20 — asked whether to deploy the game to Vercel, chose "Deploy the game only": one new
    project, no database, no key, no variable. **The first outward action to be authorized.** Vercel refused
    the assistant's call to create the project (phase 18, above); nothing was created.
11. 2026-11-26, about 00:25 — imported the repository in the Vercel dashboard: the project `tabula-rasa`, and
    its first production deployment from `main`.
12. 2026-11-26, about 00:30 — "Deployed and still has stuff pending in pull request I think": said so. The
    address was found and checked; pull request 5 was open, its checks running.
13. 2026-11-26, about 00:47 — "Pull request failed 2/5 pass": pointed at a failed check on pull request 5. It
    was a unit test, and right to fail (D-051); fixed.
14. 2026-11-26, about 00:55 — "Proceed with fable 5.2 max fast mode": a go-ahead, and a setting of theirs.
15. 2026-11-26, 01:38 — merged pull request 5, seven minutes after its last check went green. The site
    rebuilt by itself.
16. 2026-11-26, 02:19 — merged pull request 6 (a notice enters where it stays), its checks green. The site
    rebuilt by itself.
17. 2026-11-26, about 02:23 — "Minor formatting tweak needed with crowding words at opening of app", with a
    picture from their phone of the Recordings sheet on the deployed site. **The first report from a person
    using the game, and from a physical device.** It was a defect in every list of rows on a phone; fixed
    (D-052).
18. 2026-11-26, 02:29 — "Following a person doesn't seem to move the camera and track them unless I doing
    something wrong I do not think this functionality works as intended correct me if I am wrong". They were
    doing nothing wrong: on a phone the person followed was held behind their own card. Fixed, with four
    more defects of Follow found while looking (D-052).
19. 2026-11-26, about 04:43 — "Try again". Nothing had failed: pull request 7 had been open for three
    quarters of an hour with its checks green, and its second commit was still being made.
20. 2026-11-26, 04:44 — merged pull request 7, at its first commit (the fixes and their tests), twenty-seven
    minutes after its checks went green and about a minute before the second commit was pushed. The site
    rebuilt by itself; the record of the work became pull request 8.
21. 2026-11-26, 05:24 — merged pull request 8, a minute after its checks went green. The site rebuilt by
    itself.

22. 2026-11-27, about 13:07 — merged pull request 10 (citizen and island realism, D-053; made in another
    session).
23. 2026-11-27, 14:10 — asked whether the graphics could be made more realistic without costing speed,
    whether there were "genders and capability for having children", and for "developing civilizations,
    hospitals, power", pointing at their own Epoch60 repository, and said: *"with the current state
    civilizations only can die rather than progress."* **The second report from a person who had played, and
    the first about the game itself rather than a defect.** It was true (D-055).
24. 2026-11-27, within the next hour and a half, on reading the first plan: *"If we don't feel the need for children then that's
    fine if people don't age. I'm open to suggestions. Right now it doesn't feel like there is much of a goal
    when playing the game from a user perspective."* Births and ageing were set aside (D-057); the goal became
    the work (D-056).
25. 2026-11-27, 16:17 — on reading how the first runs had gone: *"Is progression plan too easy — day of
    letters doesn't seem too hard to achieve for example. Run detailed in depth testing. I want some form of
    skill involved for user to influence progress, suggest ideas here."* It was too easy; the test and what
    it changed are D-058.
26. 2026-11-27, 18:13 — with pull request 11 open: *"Failure on one of five the long road ci pull request"*;
    and at 20:16 a picture of its card, still showing four checks of five. Two browser tests had failed in CI
    on two successive commits, each because of where the world happened to have stopped when the test reached
    a step, and neither because of the game: `evidence/long-road/observer-race.txt` and `someone-else.txt`.

Items 17, 18 and 23–25 are the only observations of the product by a person other than the builder. No design
direction, code, review, test result or decision came from a person beyond what is listed. A deployment of the
game alone was authorized, and made by the owner. No spend, key, database or other billable infrastructure has
been authorized.

**Citizen and island realism (D-053, 2026-11-27) — PARTIAL.** Rebuilt the citizens with articulated knees
and elbows, detailed faces, cloth, hands and boots. Updated ground, grass, foliage and sea rendering.
Production-build screenshots and check results are indexed in [Evidence](EVIDENCE.md#citizen-and-island-realism-d-053-2026-11-27).
Physical-device performance remains open.

**The Long Road: a people that can grow, a goal, and a hand that takes skill (D-055 to D-058, 2026-11-27) —
PARTIAL.** Asked for by the owner in three messages (interventions 23–25). Engine 0.8.0 adds know-how that has
to be found, six works it opens (among them a healing house and a mill), and newcomers drawn by a settlement
that can feed and house them; every earlier world is stepped as before, digest for digest. A new default
scenario gives the one who watches ages to reach, a legacy counted beside the untouched twin's, one change a
season, an aim — four in five of the first fifty brought to the Age of Letters by the end of the fifth year —
and a page that ends the story. The aim was first easier, the owner said so, and a test with scripted players
of different skill set it where an island left alone rarely meets it and a hand that reads the island usually
does. Evidence: [`docs/EVIDENCE.md`](EVIDENCE.md#the-long-road-d-055-to-d-058-2026-11-27). PARTIAL, not PASS,
because the thing this was built for — whether a person finds it a game worth playing — has not been tried by
anyone, and nothing was seen on a device.

**More realism at no cost in speed (D-054, 2026-11-27) — PARTIAL.** Asked for by the owner in the same message
(intervention 23): could the graphics be made more realistic "without damaging speed and run time". A frame was
made cheaper first — shadows redrawn every second frame and cast by coarse stand-ins, plainer crowns and
thinner grass far off, noise that was computed for every pixel read from three small textures made in the
browser — and what was saved was spent on softer, leafier crowns, clear streams over their beds, rain as rings
on the sea, a wet edge to the sand, dimmer hollows and ground under trees, and rock that shows its bedding.
The widest view on the high preset submits 746,236 triangles a frame on average where it submitted 1,773,875,
in no more draw calls; on a software renderer the processor time a frame takes is lower in five of the six
cases measured and level in the sixth. Evidence:
[`docs/EVIDENCE.md`](EVIDENCE.md#more-realism-at-no-cost-in-speed-d-054-2026-11-27). PARTIAL because there is
no frame rate to report (no graphics chip here), nothing was judged in motion or on a device, the wall clock
on a busy machine could not say which build was quicker, and the gain is plain close in and modest from far
off — the stills say so.
