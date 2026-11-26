# Evidence ledger

Every claim of "works" in this repository should trace to an entry here. Each entry gives the command, where the
raw output is stored, the environment, and what the evidence does **not** show.

Environment for all entries unless stated: cloud development container, Linux x86-64, 4 vCPU (Intel Xeon
2.3 GHz), 15 GB RAM, Node v22.23.5, pnpm 10.28.0, headless Chromium (Playwright 1.63) rendering WebGL2 through
**SwiftShader (software)**. No GPU, no physical phone, no human testers. Frame rates measured here are software
renderer numbers and are never presented as device performance.

## Phase 02 — skeleton (2026-11-25)

| Claim | Command | Raw output | Result | Not shown by this evidence |
|---|---|---|---|---|
| Lint, typecheck, unit tests, affordance doc freshness, production build, E2E all pass on the skeleton | `pnpm lint && pnpm typecheck && pnpm test && pnpm gen:affordances --check && pnpm build && pnpm e2e` | `evidence/phase-02/checks.txt` | 21 unit tests pass; 4 E2E tests pass (desktop 1366×768, phone-emulation 390×844) | Anything about the game; CI on GitHub. |
| SHA-256 implementation is correct | `pnpm test` (`core.test.ts`: FIPS 180-4 vectors incl. one million "a") | same | pass | — |
| Keyed RNG is uniform, unbiased for non-power-of-two ranges, and streams are uncorrelated at the tested sample size | `pnpm test` (`core.test.ts`) | same | χ²(15) < 37.7 on 40k draws; \|cross-covariance\| < 0.003 | Not a full statistical test battery (no TestU01/PractRand run). |
| Node, browser main thread and Web Worker compute the same digest for a pinned seeded workload | `pnpm e2e` (`diagnostics.spec.ts`) | same | digests equal (`143d0f5b09ed8b06`) in Chromium desktop and phone emulation | Safari and Firefox engines untested. |
| WebGL2 is available in the test browser | `pnpm e2e` | same | pass (ANGLE / SwiftShader) | Real GPU behaviour. |
| Security headers present, `X-Powered-By` absent, health endpoint leaks no configuration | `pnpm e2e` | same | pass | Headers on the deployed platform (phase 18). |

## Phase 02 — CI (2026-11-25)

| Claim | Where | Result | Not shown |
|---|---|---|---|
| The workflow in `.github/workflows/ci.yml` (lint, typecheck, unit tests with a PostgreSQL 16 service, build, Playwright) passes on GitHub-hosted runners | GitHub Actions runs `45537321704` (push) and `45537354841` (pull_request) for commit `403d1ea` | both concluded `success` | Later commits — check the latest run on the PR. |

## Phase 03 — world engine (2026-11-25)

| Claim | Command | Raw output | Result | Not shown by this evidence |
|---|---|---|---|---|
| 50 agents run ≥ 1,000 ticks and replay to identical per-day digests, event counts and snapshot SHA-256 | `pnpm test` (`sim.test.ts` › phase 03 gate) | `evidence/phase-03/tests.txt` | pass (1,056 ticks, 11 daily digests) | Cross-browser-engine equality. |
| All five scenarios run a full year and a second run reproduces the same snapshot hash | `pnpm sim -- --scenario <id> --seed 1 --days 40 --policy reflex --replay` | `evidence/phase-03/sim-reflex-seed1.txt` | `replay IDENTICAL` ×5 | Other seeds (the property tests sample more). |
| Resources are conserved: on every tick, for every item, world holdings = declared sources − declared sinks; nothing is negative; the dead hold nothing | `pnpm test` (conservation properties: five scenarios × 384 ticks, plus 14 random configurations) | `evidence/phase-03/tests.txt` | pass | Exhaustive state space. |
| Invalid intents are rejected with a reason code and change nothing (16 hand-written cases incl. NaN/∞/fractional quantities, unknown verbs, self-gifts, off-map moves) | `pnpm test` | same | pass | — |
| Arbitrary intent objects (fuzzed, 40 scripts × 20–60 intents) never throw and never break invariants | `pnpm test` | same | pass | Model-generated adversarial content (phase 16). |
| Contested units are allocated without systematic privilege (two agents, 400 contests: each wins 40–60%; the loser always gets `contested`) | `pnpm test` | same | pass | Fairness among more than two contenders (follows from the keyed permutation; not separately tested). |
| Snapshots round-trip losslessly; save → restore → continue equals an uninterrupted run; corrupted / foreign / future-schema / terrain-drifted / invalid-config snapshots are refused with specific codes | `pnpm test` (snapshots) | same | pass | — |
| A fork with common random numbers retraces its parent exactly; an intervention diverges it; the parent is never mutated; a re-keyed fork is stochastically independent | `pnpm test` (branches) | same | pass | — |
| An agent's beliefs contain only nodes it could have seen; beliefs go stale; sleepers perceive nothing | `pnpm test` (knowledge is local) | same | pass | Testimony channels (phase 05). |
| Engine throughput, single thread | `pnpm bench -- --days 5 --json evidence/phase-03/bench.json` | `evidence/phase-03/bench.json` | 50 agents: 6,439 ticks/s (p50 0.14 ms, p95 0.43 ms per tick); 100: 3,740; 250 on 96²: 573; 500 on 128²: 198 (p95 22 ms) | Planner policy cost (phase 05), browser worker throughput (phase 15), other hardware. |
| Snapshot size | same | same | 771 KiB at 50 agents; 24,897 KiB (24.3 MiB) at 500 agents (belief arrays dominate) | Compressed size. Large-population snapshots need a sparse belief encoding (tracked for phase 15). |

**What the reflex baseline shows (and does not).** With purely myopic agents the reference world (seed 1) keeps
all 50 alive into late winter, then stocks collapse (commons minimum 0.2%) and famine begins; harsher scenarios end
near extinction. This is the model behaving as a commons dilemma under a deliberately short-sighted policy. It is a
development observation on a development seed — not a finding, and not the baseline the protocol's hypotheses use
(those use the planner policy of phase 05).

## Phase 04 — playable offline slice (2026-11-25)

| Claim | Command | Raw output | Result | Not shown by this evidence |
|---|---|---|---|---|
| A new player can go title → scenario and seed → world → step / play / speed / pause → click a citizen in the 3D view → follow → Chronicle → blight intervention (fork) → Compare with daily table → save → page reload → continue at the same tick with the fork intact | `pnpm e2e` (`play.spec.ts`, project `desktop`, 1366×768, real mouse clicks) | `evidence/phase-04/e2e-run.txt`, `evidence/phase-04/e2e/desktop/01…10.jpg` | pass (1.7 min) | A human's first-run comprehension; any browser other than headless Chromium. |
| The same loop with touch only on a phone-sized viewport | `pnpm e2e` (project `mobile`, 390×844, device scale 3, taps) | `evidence/phase-04/e2e/mobile/01…10.jpg` | pass (1.4 min) | A physical phone, Safari/WebKit, real touch latency. **Emulation only.** |
| The game is operable with the keyboard alone (new world, step, speed, play/pause, open and close panels) | `pnpm e2e` (`the keyboard alone can drive the game`) | `evidence/phase-04/e2e-run.txt` | pass | Screen-reader use. |
| No console errors, no failed requests, no request to any other origin during the whole loop | assertions at the end of `play.spec.ts` | same | pass on both projects | — |
| Paused means paused; one step advances exactly one tick | `play.spec.ts` (`tick` equality after 700 ms; step → 1 → 2) | same | pass | — |
| Screens show live state, not mock-ups: start (tick 0, 50/50 alive) and after evolution (tick > 130) | `03-world-start.jpg`, `04-world-evolved.jpg` in both projects | `evidence/phase-04/e2e/` | captured from the running production build | — |
| Art stills at 1920×1080, 1366×768, 390×844 and 844×390 come from the product's own renderer through `/studio` | `SHOTS_FORMAT=jpeg node scripts/shots.mjs evidence/phase-04/shots …` | `evidence/phase-04/shots/*.jpg` | captured; five critique passes logged in `docs/ART_BIBLE.md` | Appearance on a real GPU (anti-aliasing, colour, timing may differ). |
| Triangle budget per preset (triangles and instance counts per kind of object; draw calls were not recorded) | `/studio` → `window.__studio.budget()` | `evidence/phase-04/render-budget.txt` | low 249,190 triangles (was 549,974); see the file for medium and high | — |
| Frame cadence on the software renderer | scratch probe over `/studio` (requestAnimationFrame intervals, 6 s) | `evidence/phase-04/frame-cadence-swiftshader.txt` | low preset ≈ 3–4 frames/s at 1366×768 | **Any real device.** The 60/30 fps targets are unverified. |
| Chart colours for the two timelines are distinguishable under colour-vision deficiency and against the parchment surface | `node <dataviz skill>/scripts/validate_palette.js "#bf6a1d,#1b84a8" --mode light --surface "#f5ecd8"` | `evidence/phase-04/chart-palette.txt` | all checks pass (worst pair ΔE 18.3 under protanopia) | Dark mode (the panel has one surface). |
| Unit and property tests still pass; affordance document is fresh; production build succeeds | `pnpm check` | `evidence/phase-04/check.txt` | 98 tests pass; build lists `/`, `/studio`, `/diagnostics`, `/api/health` as static | — |

**Gaps, stated plainly.** (1) Citizens are driven by the reflex baseline only; the planner arrives in phase 05,
so long runs of First Light still end in the commons collapse described under phase 03. (2) No frame-rate
number here comes from a GPU. (3) No person other than the developer agent has used the interface, and no
physical phone has run it. (4) There is no sound yet. (5) The Chronicle shows notable events, not the complete
ledger: the page keeps the most recent 600 lines (`CHRONICLE_CAP` in `src/ui/game/controller.ts`, already 600 in
the phase-04 commit) and the panel lists the newest 220 that pass its filter. An earlier version of this entry
said 4,000; that is the cap on the worker's queue of events not yet sent to the page. Full export arrives with
phase 13.

## Phase 05 — agent cognition (2026-11-25)

| Claim | Command | Raw output | Result | Not shown by this evidence |
|---|---|---|---|---|
| Agents identical except for one trait choose differently, for the documented reason: generosity (feeds a starving neighbour or not), patience (leaves a thin bush or strips it), prudence (keeps provisioning with two days in hand or stops), conformity (repays when it hurts or not), sociability (tells where food is or stays quiet) | `pnpm test` (`cognition.test.ts` › distinct agents…) | `evidence/phase-05/tests.txt` | pass (8 cases) | That these traits matter as much in a whole society as in a staged pair. |
| A private remark is not heard by a bystander; sleepers hear nothing; testimony is recorded with its teller and ignored from a distrusted one | same (› private information…) | same | pass | — |
| An observation contains beliefs, not truth; only known places; and nothing of another person's needs, inventory, goal, memory or trust (sentinel values planted in other agents never appear) | same | same | pass | Inference attacks by a capable model from what *is* visible (phase 16). |
| Trust: gifts raise it; a kept promise raises it and is recorded by both; a broken promise lowers it by more and only for the person promised; hearsay scales with trust in the teller; self-praise does nothing | same (› trust is earned…) | same | pass | — |
| External decisions are proposals: malformed, unknown, masked and over-limit intents are refused with reasons; a refused decision changes no body, belief or plan (the test compares snapshots with only the bookkeeping left out: the next-deliberation tick, the feedback shown to that mind, the event counter and the count of refusals — it is recorded on the ledger, D-022 item 5); text is sanitized and bounded; only external agents accept them | same (› external decisions…) | same | pass | A real model's output (phase 06). |
| Replay uses recorded intents: a 12-agent, 4-day run driven by the mock mind replays from its ledger tape to an identical physical state and event sequence, with zero mind calls | same | same | pass | Longer runs; live-model tapes. |
| Planner runs are deterministic: all five scenarios, seed 1, 40 days, run twice | `pnpm sim -- --scenario <id> --seed 1 --days 40 --policy planner --replay` | `evidence/phase-05/replay-planner.txt` | `replay IDENTICAL` ×5 | Other seeds. |
| As individuals, planners outlive reflex-only neighbours on the same lean island | `pnpm exec tsx scripts/mixed.ts --seeds 1-8 --days 40 --set richness=1000 --set regrowth=1000 --set nodeDensity=1000` | `evidence/phase-05/lean-island-mixed-40d.txt` | 65.5% (133/203) vs 20.3% (40/197) alive | Holdout seeds. Development observation. |
| As whole societies on that lean island, they do not | `pnpm compare -- --seeds 1-8 --days 40 … (same overrides)` | `evidence/phase-05/lean-island-societies-40d.txt` | planners 18.6, reflex 18.8 of 50 alive (mean); medians 6 and 11 | Same caveat. Not a finding. |
| On the reference island, two years | `pnpm compare -- --seeds 1-8 --days 80 --checkpoints 30,40,60,80` | `evidence/phase-05/first-light-80d.txt`, `.json` | planners 50/50 on all 8 seeds; reflex mean 46.4, min 36; well-being 56.6% vs 63.8% | Same caveat. |
| Planner cost | `pnpm bench -- --days 5 --policy planner --json evidence/phase-05/bench-planner.json` | that file | 50 agents: 2,860 ticks/s (p95 0.92 ms/tick); 500 agents on 128²: 222 ticks/s (p95 9.9 ms) | Browser worker throughput; other hardware. |
| Snapshots written before this phase still load | `cognition.test.ts` › snapshot migration 1 → 2 | `tests.txt` | pass | — |

**Stated plainly.** The planner is a hand-written prior about sensible individual behaviour. It never proposes
a group, role, rule, vote or pact; nothing institutional existed in any baseline run at this phase (asserted
then). Since phase 09 that is true of `planner.ts` only: the civic layer lets a baseline agent put forward a
charter its own search of the grammar found (`docs/COGNITION.md`, first paragraph). Whatever
cooperation appears in these runs is thin: a few gifts per thousand person-days.

## Phase 09 — institution grammar (2026-11-25)

| Claim | Command | Raw output | Result | Not shown by this evidence |
|---|---|---|---|---|
| Formulas are bounded and total: saturating arithmetic, division by zero is zero, evaluation stops when fuel runs out; unknown facts and operations, oversized and self-referential trees are refused with a reason; validation returns a clean copy | `pnpm test` (`institutions.test.ts` › formulas) | `evidence/phase-09/tests.txt` | pass | — |
| The validator refuses 19 kinds of malformed or inexpressible charter with specific codes and messages, creates nothing when it refuses, and rebuilds accepted charters canonically (key order and stray fields do not matter) | same (› the validator is the only door) | same | pass | — |
| Fuzz: arbitrary JSON (300 runs × 5 embeddings) never throws and nothing outside the five rule forms is ever accepted | same (› fuzz) | same | pass | Adversarial model output (phase 16). |
| Fuzz: 40 random valid charters, lived under by depositing and withdrawing members and a non-member, never break the conservation audit (checked every tick), never take more than a posted bond, and never let the outsider draw common stock | same | same | pass | Longer horizons; larger memberships. |
| Privilege: no membership without a recorded act; cannot sign what one has not heard of; `off` refuses everything and nothing institutional ever exists; a lock needs every builder's consent and leaves prior contents open to all; outsiders cannot vote or move; late joiners do not vote on earlier motions; amendments cannot touch bond, entry or decision rule; exit is unconditional and returns the bond | same (› authority is bounded by consent) | same | pass | — |
| Capability, from scripted test proposals only: escrowed exchange (atomic, expiring, refusing third parties); a common larder with dues, a hunger-tested ration, a lock and suspension; a shelter raised under obligation and usable by members only | same (› capability) | same | pass | **That anyone would invent these.** This is not evidence of emergence. |
| Decision rules do what the charter says (majority, two thirds, unanimity, quorum, decision by a role); founder roles cannot be voted away; grants are spent when collected | same | same | pass | — |
| Harvest limits are breached only when a fellow member is in sight | same | same | pass (breach with a witness, none without) | — |
| A world with a living institution snapshots, restores and replays identically; the scripted control is labelled `scripted` and binds only signers | same | same | pass | — |
| Every charter the grammar search can draw validates; a proposer only proposes what it would sign; in a planner world institutions arise only through validated proposals and individual consent, with origin recorded; a model-driven mind uses the same door and is recorded as `llm` | same (› grammar search and the civic mind) | same | pass | — |
| The Charters panel shows rules in sentences generated from the charter, with origin "Scripted control · not emergence" | `pnpm e2e` (`charters are shown in plain words…`) | `evidence/phase-09/e2e-run.txt`, `evidence/phase-09/11-charters.jpg` | pass | A reader's comprehension. |
| What institutions did on development seeds | `pnpm exec tsx scripts/civics.ts --scenario long_winter --seeds 1-6 --days 30` (and `first_light`, 40 days) | `evidence/phase-09/civics-*.txt` | Long Winter: adopted (≥ 3 founders) on 6/6 seeds under search, 4/6 under the control; mean alive 35.3 off · 35.5 search · 31.2 control. First Light: all 50 alive in every arm | **Any effect.** See next row. |
| Six-seed differences of this size are not interpretable | isolation experiment (four arms) | `evidence/phase-09/isolation-experiment.txt` | a control charter nobody joined moved one seed by 13 survivors | — |

**Stated plainly.** Institutions can be proposed, validated, signed, used, amended and dissolved, and baseline
agents do all of that. No benefit of any institution to survival or well-being has been shown.

## Phase 10 — economy and society (2026-11-25)

| Claim | Command | Raw output | Result | Not shown by this evidence |
|---|---|---|---|---|
| Gini is 0 for equality, for no holdings and for n < 2, and (n−1)/n when one person holds everything | `pnpm test` (`society.test.ts`) | `evidence/phase-10/tests.txt` | pass | — |
| Modularity matches hand calculation: two triangles joined by a tie → 2 communities, Q = 5/14; a clique → 1 community, Q = 0; weighted pairs stay apart | same | same | pass | Optimality of greedy agglomeration on large graphs (it is a heuristic). |
| Reciprocity counts directed dyads answered within five days and only those; trade volume and cooperation use living agent-days from the ledger's own deaths | same | same | pass | — |
| The E1–E4 ladder is read from events, by origin; a scripted charter is counted apart; member-days integrate membership over time | same | same | pass | — |
| Influence concentration and exclusion are computed as defined | same | same | pass | — |
| On a real 24-day run the tracker's gifts, exchanges, proposals, ratifications, active institutions, agent-days and cooperation rate equal the engine's own counters | same (› the tracker agrees…) | same | pass | — |
| A drought leaves the commons poorer than in the untouched twin that shares its random draws | same (› a scarcity shock…) | same | pass | — |
| Exchange: two agents value the same item differently by need; two planners with complementary surpluses on bare land strike and execute a pact unprompted, with the conservation audit clean every tick | `institutions.test.ts` › exchange among baseline agents | same | pass | That exchange is common in full worlds: it is not (next row). |
| Society measures on development seeds | `pnpm exec tsx scripts/civics.ts --scenario first_light --seeds 1-6 --days 40 --modes off,grammar_search` | `evidence/phase-10/society-first-light-40d.txt` | hundreds of offers per run, a handful executed; cooperation a few per 1,000 agent-days | Any effect of exchange on outcomes. |

## Phase 06 — Claude API and structured decisions (2026-11-25)

**No request has been sent to the provider.** Everything below was run without a key.

| Claim | Command | Raw output | Result | Not shown by this evidence |
|---|---|---|---|---|
| Formulas written as text are read into the rule grammar's tree with the usual precedence; anything else is refused with a position; writing a tree out and reading it back gives the same tree (800 cases); no text makes the reader throw (1,500 cases) | `pnpm test` (`formula.test.ts`) | `evidence/phase-06/tests.txt` | pass | — |
| Both answer schemas satisfy every documented structured-output limit, and the linter goes red on each of eleven planted violations | same (`wire.test.ts` › the answer schema…) | same | pass | **That the provider's grammar compiler accepts the schema.** Needs a live call. |
| Every intent kind survives the wire unchanged (400 cases); 360 charters drawn from the grammar-search distribution survive unchanged, as proposals and as amendments; unreadable actions are dropped with reasons and the rest stands; a charter with one unreadable rule is dropped whole and the reason says where | same | same | pass | — |
| Fuzz: 300 hostile answers never make the reader throw, and whatever it returns can be offered to the world with the conservation audit clean | same | same | pass | Real model output. |
| Prices: the published example is reproduced to the microdollar; an unknown model has no price; a broken usage report is not priced; no usage inside the bound costs more than was reserved (3,000 cases, four models); the table goes stale after 45 days | same (› prices and reservations) | same | pass | That the provider's bill equals its usage report. |
| The rules text states the role, the limits of action, that speech is data and that the unknown is unknown; names no institution, gives no advice; a world without the agreement affordance is told nothing about agreements; it is the same text for everyone in a run | `prompt.test.ts` | same | pass | **Whether the wording primes a real model anyway.** That is an experiment (minimal vs rich context), not a test. |
| Hostile speech cannot add a line, a heading or an action to a page; a mind that obeys every hostile instruction has each forbidden act refused and recorded, nothing changes hands, no agreement is founded, the audit stays clean | same (› hostile speech) | same | pass | **That a real model resists the fixtures.** Shown instead: obeying them achieves nothing. |
| The live adapter sends exactly six fields (model, max_tokens, system, messages, output_config, inference_geo), none the model rejects; reads only text blocks; keeps no reasoning; prices the usage report first; classifies 25 failure shapes by what they mean for the money | `anthropic.test.ts` | same | pass | — |
| Through the **real SDK** with the network replaced by canned responses: one POST to `https://api.anthropic.com/v1/messages`, key in `Authorization: Bearer`, `anthropic-version: 2026-10-21`, no beta header; error responses arrive as typed errors and are sent exactly once; a timeout or lost connection is an unknown outcome and is not re-sent | same (› through the real SDK) | same | pass | The real server's behaviour. |
| The only test that can make a paid request is skipped, by name, and reports "NOT authorized" | `live.integration.test.ts` | same (lines marked ↓ and "NOT authorized") | skipped by design. (True of that commit. In phase 16 the test was deleted: a skipped test that an exported variable could un-skip was itself a finding. Its place is taken by a script outside the suite, `pnpm live:smoke`; D-042.) | Everything about live behaviour. |
| What a model is told is published verbatim and cannot drift from the code | `pnpm gen:prompts --check` (in `pnpm check` and CI) | `docs/PROMPTS.md` | up to date | — |

## Phase 07 — budget ledger and security (2026-11-25)

Database for the concurrency entries: PostgreSQL 16.15, local, through `pg` pools (two pools standing in for
two server instances). Everything else: PGlite in memory.

| Claim | Command | Raw output | Result | Not shown by this evidence |
|---|---|---|---|---|
| The ledger starts closed: nothing authorized, kill switch on; releasing the switch authorizes nothing; a budget without a daily allowance is still closed | `TEST_DATABASE_URL=… pnpm test` (`ledger.test.ts`) | `evidence/phase-07/tests.txt` | pass | — |
| **100 concurrent requests from two instances cannot hold more than was authorized** (exactly 20 of 100 five-cent holds granted against one dollar); the same for a run's cap and the day's cap | same (› under real concurrency) | same | pass | Other database engines; network partitions. |
| **Duplicates and re-ordering cannot double charge**: 100 concurrent copies of one request are granted once, 50 concurrent settlements of it charge once; settle-after-release and release-after-settle change nothing | same | same | pass | — |
| **Unknown outcomes do not free funds**: the money stays held against every ceiling until the owner decides, and can be settled for at most what was held; a reservation whose process died is shown as unknown, never given back | same | same | pass | — |
| **The kill switch works**: thrown mid-burst it lets nothing further through; in-flight settlements are not disturbed | same | same | pass | — |
| A request that costs more than was held is recorded as overage and stops everything; the database itself refuses an overspend written by wrong code | same | same | pass | — |
| Property: after any sequence of 5–40 random operations the books balance and every granted hold was inside every ceiling in force | same | same | pass (60 sequences) | — |
| Passphrase hashing (scrypt), session signing and expiry, the anti-forgery token, cookie attributes, origin judgement behind a proxy, body limits, rate limiting that refuses when it cannot count, live mode off unless all eight conditions hold | `auth.test.ts` | same | pass | A second factor: there is none. |
| **Unauthenticated requests never call a provider**: eight write endpoints × six kinds of forged request change nothing and never construct a provider; an expired session is no session; strangers see no unpublished run | `api.test.ts` | same | pass | — |
| Spending needs an authorized amount, a released switch and a run approved in words; a run is refused on another model than the one it was approved for; the owner can reconcile an unknown request | same | same | pass | — |
| No secret appears in any response, audit entry or server log line across the whole API suite; the database being down answers 503 without the error text | same | same | pass | Logs of a real deployment. |
| The scans go red on planted leaks (seven credential shapes, env files, template values, secret-named public variables, server markers in a bundle, a live secret value) | `tests/unit/scans.test.ts` | same | pass | — |
| The repository and the client bundle are clean | `pnpm scan:secrets`, `pnpm build && pnpm scan:bundle` | same (end of file) | pass: 261 tracked files; 139 client-facing files | — |
| The owner console against the real server: wrong passphrase refused; nothing can be spent as shipped; authorizing takes the typed phrase and does not release the switch | `TEST_DATABASE_URL=… pnpm e2e` (`owner.spec.ts`) | `evidence/phase-07/e2e-run.txt`, `evidence/phase-07/e2e/` | pass (desktop and phone emulation) | A physical phone; a real deployment behind a real proxy. |

## Phase 08 — orchestration (2026-11-25)

| Claim | Command | Raw output | Result | Not shown by this evidence |
|---|---|---|---|---|
| **Fifty minds decide independently** over three days under each of the three schedulers, each on its own page; every living person is in the trace every epoch with a reason; the same run twice gives the same digests | `pnpm test` (`run.test.ts`) | `evidence/phase-08/tests.txt` | pass | Model-driven minds. These are mock minds. |
| **Deterministic replay**: the tape alone, consulting no mind, reproduces every epoch's digest; a tampered tape is caught at the epoch where it was changed; replay through the provider interface keeps each agreement's recorded author | same | same | pass | — |
| Fairness: with six slots for fifty minds nobody exceeds the daily cap, everyone alive is consulted, nobody holds 8% of consultations; being talked at buys no more than the cap | same (› rationing deliberation fairly) | same | pass | — |
| **Cancellation and resume under injected errors**: a failure that may clear is tried once more, an unknown outcome never; an interrupted epoch resumes asking nobody twice and ends in the same world as an uninterrupted one; a deadline and a refusal before the call both leave minds for later | same (› when calls fail…) | same | pass | — |
| Server-side runs: a mock run advances by repeatable steps and its stored record replays; a paid run (stand-in provider) reserves before every call and settles each once; the kill switch stops it mid-epoch and it later finishes without asking anyone twice; it stops at its cap; an orphaned reservation is found and held; a stale lease is no obstacle and a held one turns a second stepper away; a tampered snapshot is refused | `TEST_DATABASE_URL=… pnpm test` (`runs.test.ts`) | same | pass | — |
| Two instances racing through a five-epoch paid run on PostgreSQL commit every epoch once and pay for every call once | same (› two instances stepping at once) | same | pass | — |
| A multi-epoch mock run through the real server and browser: created, advanced to the end, published; a visitor with no session replays it and every epoch matches the record; the bundled 24-epoch recording matches to the end; the inspector says either "Recorded decision by a MOCK mind (a deterministic test double, not a language model)" or, between decisions, "Acting on reflex until its mind is next consulted" — never "a language model" | `pnpm e2e` (`owner.spec.ts`) | `evidence/phase-07/e2e-run.txt`, `evidence/phase-07/e2e/` | pass (desktop and phone emulation) | — |
| The three policies on the same worlds (seeds 1–4, 50 people, six days, mock minds) | `pnpm schedulers -- --seeds 1-4 --days 6 --slots 8 --out evidence/phase-08/schedulers.json` | `evidence/phase-08/schedulers.txt`, `.json` | 8 slots per epoch: 179 / 170 / 153 calls (round-robin / event / voi), Gini of calls 0.15–0.19, nobody never asked, **7–8% of time on own plan**; upper bound on what would have been held: $49–57 on Fable 5.2, $0.61–0.71 on Haiku 5.5 | **Decision quality under each policy** (needs a model: phase 17). Mock plans are one or two actions long; a model's may be longer. |

**Stated plainly.** The machinery for model-driven minds is built and tested without a model. Nothing here is
evidence about what a model would do, what it would cost, or whether anything would emerge.

## Phase 11 — art direction (2026-11-25)

| Claim | Command | Raw output | Result | Not shown by this evidence |
|---|---|---|---|---|
| Five screenshot-led critique passes were made, each from a capture of the running product | `node scripts/shots.mjs …` against `next start` | `evidence/phase-11/cycles/` (captures of four of the five passes, reduced: two each for passes 6 to 9; none was kept of pass 10), `docs/ART_BIBLE.md` § Phase 11 passes | done | Any judgement but the builder's. |
| Final state at the vista, close up, at work, at dusk, at night, in winter, on a phone in both orientations and on the low preset | `SHOTS_FORMAT=jpeg node scripts/shots.mjs evidence/phase-11/shots …` | `evidence/phase-11/shots/*.jpg`, `evidence/phase-11/shots.txt` (draw calls, triangles, frame intervals per shot) | captured | How it looks or runs on a GPU or a phone: the renderer here is software. |
| People stand beside what they work on, carry a load shaped by what it is, and show a tool only if they own one | captures `forager`, `woodcutter`, `fisher`, `builder`; the frame carries `tools` and `partner` per person from the engine's inventory and intent | same | seen in the captures (the fisher owns no spear and is drawn without one) | Every action in every pose; walking gait under load. |
| A person hidden by scenery is still findable, and a visible person is drawn clean | captures `cycles/3-silhouette-smear.jpg` → `cycles/4-silhouette-clean.jpg` | same | fixed between passes 8 and 9 (D-027) | A GPU's stencil behaviour. |
| A ratified agreement leaves a post, cords and pennants; a proposal leaves nothing | capture `charter` (Long Winter, scripted control, day 15) | `evidence/phase-11/shots/charter.jpg` | seen | Agreements written by anyone but the designers' control: none has been captured. |
| Worn ground follows real traffic and the engine's own threshold | traffic measured on the reference world (seed 1): at most 17, 32 and 33 footfalls on any tile by days 6, 22 and 40; tiles past the old tint's half-way point: none | recorded here; mapping in `src/render/palette.ts` (`wearOf`) | recalibrated (D-032) | A striking image: in this world only a handful of tiles reach the threshold, and `paths.jpg` shows little. |
| Sound is produced only after it is asked for, follows the controls and stops | `pnpm e2e` (`observer.spec.ts`): level exactly 0 before; above 0.0005 RMS after; below 0.0002 with the overall slider at zero | `evidence/phase-12/e2e-run.txt` | pass, desktop and phone emulation | What it sounds like. Nobody has listened to it. |

**Stated plainly.** The rubric in `docs/ART_BIBLE.md` is the builder's own scoring of the builder's own
captures. Performance scores 1 of 4 because the only numbers are from a software renderer.

## Phase 12 — observer UX (2026-11-25)

| Claim | Command | Raw output | Result | Not shown by this evidence |
|---|---|---|---|---|
| Sound, the outcomes list, both knowledge views, the atlas, the almanac with its table and the field journal work from live state with real clicks and taps | `pnpm e2e` (`observer.spec.ts`) | `evidence/phase-12/e2e-run.txt`, `evidence/phase-12/e2e/{desktop,mobile}/30…32.jpg` | pass on desktop 1366×768 and 390×844 phone emulation | Comprehension by a person. |
| Every instrument has a key; the menu is reachable and operable from the keyboard | `pnpm e2e` (`play.spec.ts` › the keyboard alone can drive the game) | same | pass (desktop) | Screen-reader use. |
| No serious or critical machine-detectable accessibility violation on thirteen screens and panels | `pnpm e2e` (`a11y.spec.ts`, axe-core 4.x, WCAG 2.0/2.1 A and AA) | `evidence/phase-12/a11y-desktop.json`, `a11y-mobile.json` | pass after one fix (a scrollable page that could not take keyboard focus) | What a machine cannot detect. About five hundred text nodes could not be contrast-checked by the scanner (textured and translucent surfaces). |
| Text contrast meets 4.5:1 on every surface, with the glass composited over snow and over night | `pnpm test` (`tests/unit/contrast.test.ts`) | `evidence/phase-12/tests.txt` | pass after two fixes (muted text on glass over snow was 3.4:1; the warning red on the darkest paper was 4.48:1) | Contrast inside the 3D scene. |
| A sheet never covers the recording banner on a phone | `pnpm e2e` (`owner.spec.ts`, bounding-box assertion) | `evidence/phase-12/e2e-run.txt` | pass | — |
| On a phone the atlas is one column and nothing in it runs off the screen | `pnpm e2e` (`observer.spec.ts`, bounding boxes of the map and the seven charts against the viewport); `pnpm test` (`tests/unit/css-order.test.ts`) | `evidence/phase-12/e2e-run.txt`, `evidence/phase-12/tests.txt`, `evidence/phase-12/e2e/mobile/32-atlas.jpg` | pass after one fix. The first full run **passed with the layout broken**: the phone screenshot showed the almanac as a second column cut off at the right edge, because the one-column rule was written above the rule it was meant to override. Found by looking at the capture, not by a test; the assertion and a stylesheet check that fails on any such dead override were added with the fix | Other layouts that only an eye would catch. |

**Not done, and said so in `docs/OBSERVER_UX.md`:** no first-time player, no screen reader, no physical
device, no ears. Scrubbing a live world back in time belongs to phase 13.

## Phase 13 — history, branches, files, the twin (2026-11-25)

| Claim | Command | Raw output | Result | Not shown by this evidence |
|---|---|---|---|---|
| Re-running a stretch of a world from an earlier state, with the observer's interventions re-applied at their ticks, ends byte-identical to the original (from a snapshot and from tick 0); leaving one out does not | `pnpm test` (`src/engine/save/history.test.ts`) | `evidence/phase-13/tests.txt` | pass | Worlds with model-driven minds (their replay is the recording path, phase 08). |
| A branch is its parent at the fork and for as long as nothing is done to it; what is done to one never reaches the other; two branches share nothing writable; new luck diverges | same | same | pass | — |
| A world file opens to the same world and twin; one altered character, an edited manifest, a foreign twin, a truncated or empty file are each refused | same | same | pass | Files from other engine versions beyond the migrations that exist. |
| The same guarantees through the worker's message protocol, with no browser: moments kept, exact re-run verified on arrival and refusing interventions meanwhile, new line and return to the old one hash for hash, twin on screen at the same tick with nothing done to it | `pnpm test` (`src/worker/sim.worker.test.ts`) | same | pass | The renderer. |
| A saved world's past is lived again from its seed and kept only because it arrives at exactly the loaded world and twin; a save whose intervention record was edited fails the check and nothing is kept; a stored save that no longer matches its hash is refused; a line that took new luck says why it cannot be rebuilt | same | same | pass | Saves from before this version carry no lineage: only the first line and same-luck branches can be rebuilt. |
| The event ledger is consecutive from the first event, never runs backwards, and every recorded cause precedes its effect; a loaded world's ledger says it is partial until its past is rebuilt | same | same | pass | Events older than the 40,000 kept in memory. |
| However time is driven — single steps, long steps, play at any speed and frame rate, pauses, a long suspension — the world at a given tick is the same world | same | same | pass (hash equal at tick 1,100) | Real browser timer throttling; this test drives a fake clock. |
| A recording of outside minds gets a twin of the same seed with the engine's planner, and the comparison is named for what it is | same | same | pass, with the bundled **mock** recording | **A live recording: none exists.** |
| All of it in the browser, with real clicks and taps: twin on screen and back; five days watched again, arriving exactly; a new line; a return; Compare with differences and event counts; save → reload → the past lived again → a re-run from a rebuilt morning arriving exactly; export; ledger download; a tampered file refused and the true one opened; a recorded cause | `pnpm e2e` (`tests/e2e/history.spec.ts`) | `evidence/phase-13/e2e-run.txt`, `evidence/phase-13/e2e/{desktop,mobile}/39…45.jpg` | pass on desktop 1366×768 and 390×844 phone emulation | Comprehension by a person. |
| The top bar's parts never overlap, leave the screen or spill, from 2560 to 320 px, in its widest state | `node scripts/topbar.mjs <url> <dir>`; assertions in `history.spec.ts` | `evidence/phase-13/topbar.txt`, `evidence/phase-13/topbar-*.jpg` | **24 of 25 widths** on the clean checkout, after a rebuild of the bar (see `docs/OBSERVER_UX.md`: the fork badge had been half hidden at 1366 px since phase 04). No part overlaps another or leaves the screen at any width. At 390 px the status row's content was 22 px wider than the row: it scrolls sideways there, so nothing is lost, but that is not the intent. An earlier run of the same code passed all 25 — the weather's name happened to be shorter. The script measured whatever the weather was; it did not force the widest text. Both are corrected in the next commit | Browsers other than Chromium; text scaled by the user; the widest labels (until the next commit). |
| A CI failure on the previous commit was a browser fault, not a product fault, and is handled at its cause | GitHub Actions runs 45602910761 (passed) and 45602902159 (failed) on the same commit, `8683652`: the failing run stopped at `page.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot` on the plain sign-in page | `tests/e2e/capture.ts` | every capture now goes through one helper that tries again and records the retry, and still fails the test if the screen can never be captured; no test or assertion was skipped or loosened. The browser suites now run as two parallel jobs, so that neither project starves the other's renderer | Whether it recurs: it has been seen once. |
| No serious or critical machine-detectable accessibility violation on seventeen states, now including History, Compare, the twin on screen and the Laboratory | `pnpm e2e` (`a11y.spec.ts`) | `evidence/phase-13/a11y-desktop.json`, `a11y-mobile.json` | pass | What a machine cannot detect. |

**Stated plainly.** "Offline and live recorded histories compare" is shown with a mock recording, because no
live recording exists. Lines set aside live in the page's memory and are lost on reload unless saved or
exported. There is no continuous scrubber: one can return to the start and to every second morning.

## Phase 14 — the laboratory (2026-11-25)

| Claim | Command | Raw output | Result | Not shown by this evidence |
|---|---|---|---|---|
| Every statistic has a fixture with a known answer: mean, SD, quantiles, paired differences, d_z, Cliff's δ, Holm (worked example), precision planning, difference in differences, Gini; the bootstrap is deterministic, narrows with n, and covers a known mean about as often as it claims | `pnpm test` (`src/lab/stats.test.ts`) | `evidence/phase-14/tests.txt` | pass | Coverage for distributions unlike the fixture's. |
| The registered rule is applied to the interval and to nothing else: each kind of prediction on synthetic runs with known answers; fewer than eight paired seeds get no verdict; missing cells are listed and never silently paired; a pilot's table never states a verdict; the registry's thresholds are the protocol's | `pnpm test` (`src/lab/analyse.test.ts`) | `evidence/phase-14/tests.txt` | pass | — |
| A confirmatory batch is the planned one or it is not run: the planned size, the first holdout seeds in order | same; enforced in `scripts/study.ts` | same | pass | The batch itself: not run at this phase. It was run once in phase 16 (below). |
| The society measures the studies report are computed correctly | `pnpm test` (`src/engine/metrics/society.test.ts`, phase 10) | `evidence/phase-10/` | pass | — |
| 224 real offline runs across all 14 registered conditions on 16 development seeds, none missing, each with the SHA-256 of its final state | `pnpm study -- --study all --seeds 1-16 --out evidence/phase-14/pilot` (two shards) | `evidence/phase-14/pilot/` (`runs.*.jsonl`, `runs.csv`, `report.md`, `report.json`, `manifest.json`, `plan.json`) | done; engine 0.6.0 | **Anything about the hypotheses: these are development seeds.** |
| Any run can be reproduced to the hash | `pnpm study -- --verify 12 --study all --seeds 1-16 --out evidence/phase-14/pilot` | `evidence/phase-14/verify.txt` | 12 of 12 reproduced | Other machines and runtimes (the browser check below is one other runtime). |
| The same in a reader's browser, from the page | `pnpm e2e` (`tests/e2e/lab.spec.ts`): a published cell re-run in a worker, hash compared | `evidence/phase-13/e2e-run.txt` (one run for both phases), `evidence/phase-14/e2e/{desktop,mobile}/50…52.jpg` | reproduced on both projects | Browsers other than Chromium. |
| The page says what the bundle is (a pilot that tests nothing), shows every contrast with the registered rule's reading marked as hypothetical, the sizing table, the raw files, and opens a cell as a world | same | same | pass | Whether a reader draws only the conclusions the page allows. |
| The planner's clock is off by default, binds when set, and old snapshots and configurations open as having none | `pnpm test` (`src/engine/mind/clock.test.ts`) | `evidence/phase-14/tests.txt` | pass | — |
| A live study's cost ceiling is the scheduler's call limit times the server's per-call bound, scales exactly with conditions and seeds, prices the largest outside-minded group, refuses an unpriced model, and sizes a design to a budget | `pnpm test` (`src/lab/cost.test.ts`) | same | pass | **What a call really costs: none has been made.** The ceilings assume no cache hit. |

### What the pilot showed (development seeds 1–16; sizing only, no hypothesis tested)

| Contrast | Paired estimate [95% interval] | What the registered rule would read |
|---|---|---|
| H1a cooperation, richness 0.7 − 1.3 | 0.0161 [0.0104, 0.0218] | supported |
| H1b cooperation, richness 0.7 − 0.4 | 0.0113 [0.0054, 0.0171] | supported |
| H2 specialization, movement cost 2.0 − 1.0 | 0.063 [0.055, 0.071] | supported |
| H3 reached E2, hearing radius 9 − 2 | 0.13 [−0.19, 0.44] | falsified (interval includes zero) |
| H4 survival after the blight, diversity 1.0 − 0.2 | −0.001 [−0.005, 0.003] | falsified — and uninformative: almost nobody dies in either condition |
| H5a welfare ratio, cadence 48 / 12 | 1.050 [1.025, 1.066] | supported |
| H5b deliberations ratio, cadence 48 / 12 | 0.483 [0.477, 0.488] | not supported: the manipulation is weaker than registered |
| H6a survival, scripted control − off (The Long Winter) | −0.058 [−0.114, 0.000] | **falsified: the positive control does not help** |
| H6b survival, grammar search − off | −0.041 [−0.101, 0.016] | reported (no prediction) |

Sizing from these spreads: 32 holdout seeds per contrast, 448 runs (`plan.json`). At this phase nothing had
been run on holdout seeds: the confirmatory batch waited for the engine to be frozen (D-037). It was run once
in phase 16, on engine 0.7.0, and is reported below. Not built: a wizard for
starting studies in the browser, a hypothesis-suggesting agent, any live study.

## Phase 15 — performance, scale and resilience (2026-11-25)

Every number is for one machine: four cores of an Intel Xeon at 2.3 GHz in a cloud container, no graphics
chip, Node 22.23.5, headless Chromium with a software rasterizer. `docs/PERFORMANCE.md` has the thresholds,
the fallbacks and the tables; this is the index of what was run.

| Claim | Command | Raw output | Result | Not shown by this evidence |
|---|---|---|---|---|
| Headless throughput at 50, 100, 250 and 500 people, five days | `pnpm bench -- --days 5 --policy planner` (and `reflex`) | `evidence/phase-15/bench-planner.{txt,json}`, `bench-reflex.{txt,json}` | planner 3,244 · 2,106 · 595 · 234 ticks/s; reflex 6,021 · 2,532 · 712 · 493 | Other machines. Later days of a world, which cost more (next row). |
| The same over twenty days, three times | `pnpm bench -- --days 20 --policy planner` | `bench-planner-{1,2,3}.{txt,json}` | 50 people 1,070–1,579 ticks/s; 100: 665–819; 250: 240–278; 500: 97–102 | The spread between runs (up to a third at 50 people) is this machine's. |
| Profiling came first, and found something the five-day benchmark hid: in a crowded, starving world three quarters of the time went to route searches that fail | `node --cpu-prof --import tsx scripts/bench.ts -- --policy planner --days 20 --only 250`, `node scripts/cpuprofile-top.mjs` | `profile-planner-250-before-memo.txt`, `bench-planner-before-memo.{txt,json}`, `unreachable-refusals.txt` | before: 41 ticks/s at 250 people and 13 at 500, one tick in twenty over 130 ms and 280 ms; `findPath` 75% of the process | — |
| The repair is exact: the route finder answers every question as a fresh search does, and worlds arrive at the same state with it and without | `pnpm test` (`src/engine/sim/pathfind.test.ts`); four worlds before and after; `pnpm study -- --verify 48 … --confirmatory`, `--verify 24` on the pilot | `evidence/phase-15/pathfind-memo.txt`, `evidence/phase-16/confirmatory/verify.txt`, `evidence/phase-16/pilot/verify.txt` | pass; four worlds, lived with the memory and with it switched off, end on the same SHA-256 of their whole saved state; 48 of 48 and 24 of 24 cells reproduce their published SHA-256 | That agents now behave better: they do not. The behaviour that caused it is unchanged (D-046). |
| After it, no single hotspot: perception is about a quarter of the process | same profiler | `profile-planner-50.txt`, `profile-planner-250.txt` | `perceive` 24% at 50 people, 29% at 250; `findPath` 1% and 7% | — |
| The worker keeps the pace asked when nothing competes for the processor | `pnpm exec tsx scripts/worker-pace.ts` (the worker's own loop and timers, in Node) | `worker-pace.{txt,json}` | fastest speed, 128 ticks a second asked: 127.8 at 50 people, 128.0 at 100, 79 at 250; before a fix to how owed ticks are kept: 126.3, 116.1, 78.3 | A browser; a device. |
| In a browser: frame time, draw calls, triangles, the pace achieved, time per tick, answers from the worker, save size and time, heap | `node scripts/perf.mjs http://127.0.0.1:3210 evidence/phase-15` (and `--small-world --presets low --seconds 40`) | `perf-browser.{json,md}`, `perf-browser-small-world.{json,md}` | with the picture kept small and simple so that drawing does not take the worker's time: 128 of the 128 ticks a second asked in a desktop window and 121 in a phone's with 50 people, 110 and 117 with 100; beside a full-size software-drawn view, 70–130; a tick p95 1.6–2.4 ms; a save 262–325 KB; frame times are the software renderer's and are not a result | **Any device with a graphics chip.** Frame times are a software rasterizer's. A worker's heap (the browser does not report it). |
| The ledger under contention: 20,000 reservations attempted by 32 workers through two pools | `pnpm load` | `load.{txt,json}` (and `load-startup-limits.*`, before D-047) | 1,144 reservations/s; one reservation p50 22 ms, p95 38 ms, p99 110 ms; no ceiling exceeded at any sampled moment; no error; books balanced | A hosted database across a network. |
| The server's routes, timed | `pnpm requests` | `requests.{txt,json}` (and `requests-startup-limits.*`, before D-047) | public routes p95 2.9–4.6 ms on loopback; a mock epoch for 50 people 133 ms; sign-in 293 ms (scrypt, on purpose) | A deployment: cold starts, a network, a region. |
| Two tabs, a hidden tab, an altered save, a renderer that cannot keep up — in a real browser | `pnpm e2e` (`tests/e2e/resilience.spec.ts`) | `evidence/phase-20/e2e-run.txt` | both tests pass on this tree, run on their own; in the whole-suite run at `de2f0e1`: 28 passed, 5 skipped by design, one timed out (the renderer-fallback test, at a 300-second limit, nothing it asserts having failed; it passes on its own with ten minutes); the same commit's whole suite passed on GitHub's runners (`evidence/phase-20/ci.txt`) | Real suspension on a phone; real browsers' timer throttling. |
| The fallback changes how the world is drawn and nothing in it | same (the second test) | same | six hours on, the simplified world's saved-state hash equals that of the same seed drawn with the simplest preset from the start | — |
| The top bar's parts never overlap, leave the screen, spill, squeeze the name or drop to a row of their own, at 25 widths from 2560 to 320 px, three ways: untouched, forked, and with the longest labels it can show | `node scripts/topbar.mjs <url> <dir>` | `evidence/phase-15/topbar.txt`, `topbar-*.jpg` | no problem at any of 25 widths in any of the three states (75 measurements) | Text enlarged by the visitor; other fonts. |
| On the phone project every pressable target on every scanned screen is at least 44 × 44 px | `pnpm e2e --project=mobile` (`a11y.spec.ts`) | `evidence/phase-16/a11y-mobile.json` (`touchTargets`) | 150 targets on 17 screens; none too small; the narrowest and the shortest are 44 px | A finger. |

**Stated plainly.** P8, the frame-time threshold on a device with a graphics chip, was **not run** and cannot
be here. Nothing above says how the game runs on a phone. What can be said is that the simulation leaves room
(the reference world runs at eight to twenty-five times what the fastest speed asks, on one thread of this
machine) and that the fallbacks are tested for their logic.

## Phase 16 — adversarial QA (2026-11-25)

| Claim | Command | Raw output | Result | Not shown by this evidence |
|---|---|---|---|---|
| Two independent reviews were made, read-only, by agents with no part in the code: one attacking, one checking documents against code | — | `evidence/phase-16/review-security.md`, `review-documentation.md` (as returned) | security: no critical or high finding, 8 medium, 16 low, 8 informational; documents: 5 high, 17 medium, 16 low | **A person.** The reviewers are models. |
| Every finding was fixed or is listed as accepted, each fix with a test that would fail without it | `pnpm test`, `pnpm e2e`, `pnpm lint` | `docs/QA_REPORT.md` (finding by finding), `evidence/phase-16/tests.txt` | 26 security findings fixed and 6 accepted with reasons; 38 documentation findings fixed; 22 more found while fixing and in the phases after, 21 fixed | That no finding was missed. |
| A speaker can tell only of what they know; a hearer takes on belief, not truth; role names are quoted labels; text is cleaned the same on every engine; what a mind attaches is bounded | `pnpm test` (`institutions.test.ts`, `cognition.test.ts`, `core/text.test.ts`, `core/bounded.test.ts`, `providers/wire.test.ts`, `prompt.test.ts`) | `evidence/phase-16/tests.txt` | pass | That a model is not persuaded by quoted text: no model has been asked. |
| The engine changes left the registered studies' behaviour as it was | `pnpm study -- --study all --seeds 1-16 --out evidence/phase-16/pilot`, compared with the phase-14 pilot | `evidence/phase-16/pilot-compare.txt` | 224 of 224 runs: the same state digest and the same value of every measure | — |
| The confirmatory batch: 448 runs on holdout seeds 9000–9031, once, reported as it came out | `pnpm study -- --study all --seeds 9000-9031 --confirmatory --plan evidence/phase-16/pilot/plan.json --out evidence/phase-16/confirmatory` (three shards) | `evidence/phase-16/confirmatory/` (`runs.*.jsonl`, `runs.csv`, `manifest.json`, `report.md`, `report.json`, `verify.txt`); the same bundle at `/lab` | H1, H2, H3, H5 (first clause) supported; **H4 falsified; H5's manipulation check not met; H6a, the positive control, falsified**; H6b reported. Figures in `docs/EXPERIMENT_PROTOCOL.md` § 11 | Anything about language models or people. |
| Any cell of it can be reproduced to the hash | `pnpm study -- --verify 48 --study all --seeds 9000-9031 --confirmatory --plan … --out evidence/phase-16/confirmatory` | `verify.txt` | 16 of 16 when it was made; 48 of 48 after the route finder's memo | Other machines (the Laboratory page re-runs a cell in the reader's browser). |
| Two Shores divides its resources by shore, and what that does to the people | `pnpm exec tsx scripts/shores.ts --seeds 1-12 --days 80 --set shoreSplit=800` (and 0, 600, 400; 40 days) | `evidence/phase-16/two-shores.txt` | at 800‰: 96.6% / 100.0% alive at 40 days, 75.6% / 81.3% at 80, famine in three of twelve worlds | Holdout seeds. A development observation. |
| A file that is opened is checked field by field, tried, and labelled; a corrupted one is refused or runs, and never breaks the engine | `pnpm test` (`save/validate.test.ts`, `save/history.test.ts`, `worker/sim.worker.test.ts`), `FUZZ_RUNS=3000 pnpm exec vitest run src/engine/save/validate.test.ts`, `pnpm e2e` (`history.spec.ts`) | `evidence/phase-16/tests.txt`, `fuzz-validate.txt` | pass; at 3,000 cases, every corrupted save was refused or could be lived in, and none broke the engine | Every possible corruption. |
| The server: a ceiling the passphrase cannot raise; a smoke test that cannot be replayed; sign-in that strangers cannot lock; interrupted calls recovered; a failure without the provider's own format is never taken as free; overage counted; sessions ended by signing out | `TEST_DATABASE_URL=… pnpm test` (`src/server/*.test.ts`), `pnpm e2e` (`owner.spec.ts`) | `evidence/phase-16/tests.txt`, `e2e-run.txt` (owner console: both projects, also run through the pooler) | pass | **The real service.** Every provider test uses canned responses; the smoke script's paid path has never been run. |
| No credential in any file the next commit could contain, nor in any line any commit has ever added; nothing server-only in what browsers are sent | `pnpm scan:secrets`, `pnpm scan:history`, `pnpm build && pnpm scan:bundle`; `tests/unit/scans.test.ts` | `evidence/phase-16/scans.txt` | 421 files and 152,854 added lines in 15 diffs: nothing; 157 client-facing files: nothing | Pictures, fonts and sound are not read into. |
| No way of turning a string into markup or code exists under `src/` | `pnpm lint` (`no-injection-sinks`) | `evidence/phase-16/scans.txt` | clean; a probe file with nine sinks gets nine errors | Third-party code. |
| No known vulnerability in any dependency on the day; every dependency's licence listed | `pnpm audit`, `pnpm audit --prod`, `pnpm gen:licenses --check` | `evidence/phase-16/dependencies.txt`, `docs/THIRD_PARTY.md`, `/licenses.txt` | none known on 2026-11-25; manifest current | Tomorrow's advisories. |
| The database: every transaction runs under its limits; a connection lost under a transaction fails that transaction and not the process; nothing is sent that a transaction pooler refuses — and the server works through one | `pnpm test` (`db.test.ts`); then, with PgBouncer 1.22.0 in transaction mode in front of the test database: `vitest run src/server`, `pnpm load`, `pnpm requests`, `pnpm e2e tests/e2e/owner.spec.ts` | `evidence/phase-16/pooler.txt` | ten tests pass, and fail with the listener removed; through the pooler: 107 of 107 server tests, books balanced under load with no error, every route served, 11 owner browser tests pass on both projects (1 skipped by design); the former settings are refused with the error the provider documents | The provider's own pooler; a hosted database at all. |
| The keyboard alone drives the game: from the title by Tab and Enter, then every key the game reads, each checked, and never a pointer | `pnpm e2e --project=desktop` (`play.spec.ts`) | `evidence/phase-20/e2e-run.txt` | passes on this tree, run on its own; in the whole-suite run at `de2f0e1`: 28 passed, 5 skipped by design, one timed out (the renderer-fallback test, at a 300-second limit, nothing it asserts having failed; it passes on its own with ten minutes); the same commit's whole suite passed on GitHub's runners (`evidence/phase-20/ci.txt`) | A person who relies on a keyboard. A screen reader. |
| No serious or critical machine-detectable accessibility violation on seventeen states, both projects | `pnpm e2e` (`a11y.spec.ts`) | `evidence/phase-16/a11y-desktop.json`, `a11y-mobile.json` | no violation of any severity on either project | What a machine cannot detect. |
| The whole suite at the commit | `pnpm check`, `pnpm e2e` in a clean checkout | `evidence/phase-16/tests.txt`, `evidence/phase-20/e2e-run.txt` | `pnpm check` exits 0: 470 tests in 37 files, scans, build; in the whole-suite run at `de2f0e1`: 28 passed, 5 skipped by design, one timed out (the renderer-fallback test, at a 300-second limit, nothing it asserts having failed; it passes on its own with ten minutes); the same commit's whole suite passed on GitHub's runners (`evidence/phase-20/ci.txt`) | — |

**Not run, and said so:** a human playtest; any physical device; a screen reader; any browser but Chromium; the
sound, by ear; any request to the Anthropic API; any deployment. `docs/QA_REPORT.md` § Not run.

## Research inputs

| Input | File | Status |
|---|---|---|
| Verified bibliography | `docs/LITERATURE.md` | 57 entries, each verified by a research sub-agent against Crossref / arXiv / publisher records on 2026-11-25; corrections and omissions are noted in the file |
| Vercel platform facts | `docs/research/vercel-platform.md` | compiled from official documentation on 2026-11-25; unconfirmed items listed at the end of the file; nothing tested live |
| Anthropic API facts and prices | `docs/research/anthropic-api.md` | compiled from official documentation on 2026-11-25; **no API calls made**; discrepancies with cached references listed in the file |

## Phase 18 — the release: prepared (2026-11-25), made by the owner and checked (2026-11-26)

| Claim | Command | Raw output | Result | Not shown by this evidence |
|---|---|---|---|---|
| With no variable set at all, the production build serves the game on a desktop and a phone, refuses a stranger at every route that could spend or change anything, refuses another origin, replays the bundled recording to a match, sends the browser nothing that belongs on the server and asks nothing of any other origin | `pnpm release:check -- http://127.0.0.1:3299 --fast --out <dir>`, against `next start` in an empty environment | `evidence/phase-18/release-check-local.{txt,json}`, `local-*.jpg` | 25 of 25 checks; a first visit transfers 697 KB | **A deployment.** Vercel's build and runtime; a network; a real device. |
| The platform facts the deployment document rests on are quotations | — | `docs/research/vercel-platform.md` (sources and dates beside each) | read 2026-11-25 | That they still hold on the day of deploying. |
| No project for this repository exists in the owner's Vercel account, and the account can see the repository | a read-only look at the account | — | none on 2026-11-25; the repository is visible, public, default branch `main` | — |

| The assistant could not create the project: Vercel refused the one call, and nothing else was tried | the session's Vercel connector, once | `evidence/phase-18/create-project-refused.txt` | `403 forbidden — You don't have permission to create the project` | — |
| The owner's import made a production deployment of `main` at `41a4ffa`, built with the pinned pnpm | read-only calls to the owner's Vercel account | `evidence/phase-18/deployment.txt` (the build's own log lines) | READY; built in 43 s; pnpm 10.28.0; Next.js 16.4.6; 17 static pages; region `iad1` | **Which Node.js runs it** (the project's setting reads 26.x, `engines` says 22.x); the project's variables (the connector may not list them) |
| The deployed site is what a release should be | `pnpm release:check -- https://tabula-rasa-bay.vercel.app --fast --out <dir>` | `evidence/phase-18/release-check-deployed.{txt,json}`, nine stills `deployed-*.jpg` | **25 of 25**: health and versions; security headers; `no-store` on the API; a stranger refused at 7 routes; another origin refused; the owner's door not configured; public files; on a desktop and as a phone a world is made, a day passes, the Chronicle has 218 lines, a save survives a reload; the bundled recording replays to a match; nothing asked of another origin; no page error; nothing server-only in 161 responses; 717 KB for a first visit | How it looks or moves on a device: run from a container without a graphics chip, in headless Chromium, with the game's simplest picture. The signed-in console: not deployed |
| The same by hand, as section 8 of the deployment document writes them | `curl` | `evidence/phase-18/deployed-by-hand.txt` | every answer as written: health; `{"signedIn":false,"signInPossible":false}`; no recordings; seven 401s; one 403; the headers. The platform adds `access-control-allow-origin: *` to what it serves as static content, and not to the functions | — |

**Not run:** the console or anything else on a hosted database; live minds. Phase 18 is PASS for the game
alone, and `docs/DEPLOYMENT.md` §12 is the checklist as it now stands.

## Phase 19 — scorecard (2026-11-25)

| Claim | Command | Raw output | Result | Not shown by this evidence |
|---|---|---|---|---|
| The session lasted about seventeen hours with five messages from the owner, none of them a correction of substance | read from the session's own transcript, as the file says | `evidence/phase-19/session-record.txt` | as listed there, with token counts as recorded | What any of it cost: the counts were not compared with a bill. The transcript is on the session's machine, not in the repository |
| CI ran on GitHub for every push | the repository's list of workflow runs | `evidence/phase-19/ci-runs.txt` | 22 runs when listed: 19 passed, 1 failed (transient, fixed forward), 1 cancelled, 1 in progress | — |
| The size of the build | `git ls-files` at `36ff011` | `evidence/phase-19/code-size.txt` | 42,754 lines of source in 180 files; 12,131 lines of tests in 45 | Anything about quality |
| The score | — | `docs/SCORECARD.md` | 68 of 100 by the builder's own grading; no veto triggered; two incidents disclosed | **An independent grade.** No criterion is graded as independently stress-tested |

## Phase 20 — redesign and handoff (2026-11-25)

| Claim | Command | Raw output | Result | Not shown by this evidence |
|---|---|---|---|---|
| Two of the five aims as first written could not be met in any world measured, and two could not be missed | `pnpm exec tsx scripts/aims.ts --seeds 1-10 --first-written` | `evidence/phase-20/aims-first-written.txt` | The Long Winter: 8 to 38 lost to cold or hunger before spring in every world; a commons below its collapse threshold by the eighth morning in every one of the hundred worlds | Worlds the observer changes |
| As reworded the aims can go either way, and the reading on the morning an aim is decided is the reading at the end | `pnpm exec tsx scripts/aims.ts --seeds 1-10` | `evidence/phase-20/aims-calibration.txt` | The Long Winter met in 4 of 10 worlds (planner) and 5 of 10 (reflex); Thin Commons 4 and 5; First Light and Dry Year 10 of 10; Two Shores a reading | Whether the observer's hand can save a world that would have lost: not measured |
| The aim is counted from the state alone — who counts, when it is decided, that a verdict does not move, that newcomers are not counted, that the drought is not foretold, that a saved world reads the same | `pnpm test` (`src/worker/aims.test.ts`, `src/worker/sim.worker.test.ts`) | `evidence/phase-20/tests.txt` | 11 and 3 tests pass | — |
| The Atlas shows it, for the world and for its untouched twin once there is one | `pnpm e2e` (`observer.spec.ts`, `play.spec.ts`) | `evidence/phase-20/e2e-run.txt`, `desktop-32a-the-aim.jpg`, `desktop-08b-aim-in-both-worlds.jpg` and the phone's | pass on both projects | That anyone finds it worth knowing |
| Lines of the Chronicle that say the same thing at the same hour are one line with a count, and nothing is dropped | `pnpm test` (`src/ui/game/runs.test.ts`) | `evidence/phase-20/tests.txt`, `desktop-chronicle-gathered.jpg`, `desktop-chronicle-opened-out.jpg` | 4 tests pass; in the production build a morning's two root patches read as one line "× 2" and open out again | — |
| The whole suite at the final commit | `pnpm check`, `pnpm e2e` in a clean checkout | `evidence/phase-20/tests.txt`, `e2e-run.txt` | clean checkout of `de2f0e1`: `pnpm check` exits 0 with 491 tests in 40 files; `pnpm e2e`: 28 passed, 5 skipped by design, one timed out (the renderer-fallback test, at a 300-second limit, nothing it asserts having failed; it passes on its own with ten minutes); the same commit's whole suite passed on GitHub's runners (`evidence/phase-20/ci.txt`) | **A person; a device; a deployment.** |

## After phase 20 — a failed test followed to its cause (D-050, 2026-11-25)

Same machine as phase 15: four cores of an Intel Xeon at 2.3 GHz, no graphics chip, headless Chromium with a
software rasterizer.

| Claim | Command | Raw output | Result | Not shown by this evidence |
|---|---|---|---|---|
| The two-tabs test could fail for a save that was newer than it asked for | a probe that plays as the old test did, with the page slowed ten times, against the build of `de2f0e1` (the probe is printed in the file) | `evidence/after-20/old-assertion.txt` | 5 of 10 runs fail the old assertion: in each the world stopped on an odd day (13, 15, 19, 23, 15) and the slot held a save from that same day — the newest there could be. What D-050 asserts instead holds in all ten | What the slot held in the CI run that failed: its log does not say |
| A page slower than its world fell behind it without limit | `node scripts/trail.mjs http://127.0.0.1:3298 evidence/after-20 --name trail-before`, against the build of `de2f0e1` | `evidence/after-20/trail-before.{md,json}` | page slowed 20×, world at 64×: "paused" shown after 30.9 and 38.9 s; the picture ran on 2,079 and 3,359 ticks; the page's own timer 16.9 and 26.9 s late. Slowed 10× or less: under 1.2 s | Any device. The slowing is Chromium's throttling of the page's main thread |
| With one frame on its way at a time it does not | the same script against the build with the change | `evidence/after-20/trail-after.{md,json}` | the same two rows: 0.7 and 0.9 s; 111 and 247 ticks; 1.2 and 1.1 s. The world lived at 118–128 ticks a second in every row of both tables | That a page which keeps up is drawn as smoothly as before: on a fast page frames are sent exactly as they were (next row), and no device has been looked at |
| The mechanism: one frame untaken at most; the world runs on; nothing a frame carries is lost; a page that keeps up is sent thirty a second; what the page looks at changes nothing in the world | `pnpm test` (`src/worker/sim.worker.test.ts` › "the world is lived at its own pace, the picture sent at the page's") | `evidence/after-20/tests.txt` | four tests pass; each of three deliberate breakages (frames sent regardless; an owed frame left to the loop; surplus answers banked) fails at least one | — |
| The worker still keeps the pace asked with a page that answers every frame | `pnpm exec tsx scripts/worker-pace.ts --json evidence/after-20/worker-pace.json` | `evidence/after-20/worker-pace.{txt,json}` | fastest speed, 128 ticks a second asked: 127.8 at 50 people, 127.3 at 100, 78 at 250 (phase 15: 127.8, 128, 79.3); frames sent 29, 26.9 and 20.7 a second (29, 26.6, 19.9) | A browser: this is the worker's loop in Node |
| A second test failed once in CI, on the commit before D-050, for where its world stopped: the charters test found no live charter, only a lapsed one folded away | the engine alone, three probes printed in the file; the CI log | `evidence/after-20/charters-test.txt` | in First Light seed 1 the scripted charter lapses every 312 ticks and is offered again 23 ticks later, eight times before it is signed on day 33; the charter the failed run found (`charter-157`) is first on the page only from tick 1826 to 1849 | — |
| That test now reaches a known moment by exact steps and passes | `pnpm exec playwright test tests/e2e/play.spec.ts --project=desktop` | `evidence/after-20/e2e-play.txt` | 3 passed in 5.5 m; the charters test in 1.4 m, at tick 624 with the charter on offer | — |
| The browser tests for this area pass with it | `pnpm exec playwright test tests/e2e/resilience.spec.ts --project=desktop` | `evidence/after-20/e2e-resilience.txt` | 2 passed (two tabs 3.2 m; the fallback 4.7 m) | — |
| The whole suite passes with it, here and on GitHub's runners | `pnpm e2e`; CI run 45717983573 on `b25d1b7` | `evidence/after-20/e2e-run.txt`, `ci.txt` | here: 29 passed, 5 skipped by design, none failed, in 42.0 m — the first whole-suite run on this machine in which nothing timed out. On GitHub: check, phone and desktop all green | The charters test in that local run was its earlier version (it was being rewritten meanwhile); its rewritten form is the row above |

**Not run, in any phase:** a request to a model; a deployment of the console or of anything that needs a
database; a person; a physical device.

