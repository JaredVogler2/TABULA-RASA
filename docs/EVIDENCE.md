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
| Snapshot size | same | same | 771 KiB at 50 agents; 24.9 MiB at 500 agents (belief arrays dominate) | Compressed size. Large-population snapshots need a sparse belief encoding (tracked for phase 15). |

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
| Triangle and draw-call budget per preset | `/studio` → `window.__studio.budget()` | `evidence/phase-04/render-budget.txt` | low 249,190 triangles (was 549,974); see the file for medium and high | — |
| Frame cadence on the software renderer | scratch probe over `/studio` (requestAnimationFrame intervals, 6 s) | `evidence/phase-04/frame-cadence-swiftshader.txt` | low preset ≈ 3–4 frames/s at 1366×768 | **Any real device.** The 60/30 fps targets are unverified. |
| Chart colours for the two timelines are distinguishable under colour-vision deficiency and against the parchment surface | `node <dataviz skill>/scripts/validate_palette.js "#bf6a1d,#1b84a8" --mode light --surface "#f5ecd8"` | `evidence/phase-04/chart-palette.txt` | all checks pass (worst pair ΔE 18.3 under protanopia) | Dark mode (the panel has one surface). |
| Unit and property tests still pass; affordance document is fresh; production build succeeds | `pnpm check` | `evidence/phase-04/check.txt` | 98 tests pass; build lists `/`, `/studio`, `/diagnostics`, `/api/health` as static | — |

**Gaps, stated plainly.** (1) Citizens are driven by the reflex baseline only; the planner arrives in phase 05,
so long runs of First Light still end in the commons collapse described under phase 03. (2) No frame-rate
number here comes from a GPU. (3) No person other than the developer agent has used the interface, and no
physical phone has run it. (4) There is no sound yet. (5) The Chronicle shows notable events (the most recent
4,000), not the complete ledger; full export arrives with phase 13.

## Phase 05 — agent cognition (2026-11-25)

| Claim | Command | Raw output | Result | Not shown by this evidence |
|---|---|---|---|---|
| Agents identical except for one trait choose differently, for the documented reason: generosity (feeds a starving neighbour or not), patience (leaves a thin bush or strips it), prudence (keeps provisioning with two days in hand or stops), conformity (repays when it hurts or not), sociability (tells where food is or stays quiet) | `pnpm test` (`cognition.test.ts` › distinct agents…) | `evidence/phase-05/tests.txt` | pass (8 cases) | That these traits matter as much in a whole society as in a staged pair. |
| A private remark is not heard by a bystander; sleepers hear nothing; testimony is recorded with its teller and ignored from a distrusted one | same (› private information…) | same | pass | — |
| An observation contains beliefs, not truth; only known places; and nothing of another person's needs, inventory, goal, memory or trust (sentinel values planted in other agents never appear) | same | same | pass | Inference attacks by a capable model from what *is* visible (phase 16). |
| Trust: gifts raise it; a kept promise raises it and is recorded by both; a broken promise lowers it by more and only for the person promised; hearsay scales with trust in the teller; self-praise does nothing | same (› trust is earned…) | same | pass | — |
| External decisions are proposals: malformed, unknown, masked and over-limit intents are refused with reasons; a refused decision changes no state; text is sanitized and bounded; only external agents accept them | same (› external decisions…) | same | pass | A real model's output (phase 06). |
| Replay uses recorded intents: a 12-agent, 4-day run driven by the mock mind replays from its ledger tape to an identical physical state and event sequence, with zero mind calls | same | same | pass | Longer runs; live-model tapes. |
| Planner runs are deterministic: all five scenarios, seed 1, 40 days, run twice | `pnpm sim -- --scenario <id> --seed 1 --days 40 --policy planner --replay` | `evidence/phase-05/replay-planner.txt` | `replay IDENTICAL` ×5 | Other seeds. |
| As individuals, planners outlive reflex-only neighbours on the same lean island | `pnpm exec tsx scripts/mixed.ts --seeds 1-8 --days 40 --set richness=1000 --set regrowth=1000 --set nodeDensity=1000` | `evidence/phase-05/lean-island-mixed-40d.txt` | 65.5% (133/203) vs 20.3% (40/197) alive | Holdout seeds. Development observation. |
| As whole societies on that lean island, they do not | `pnpm compare -- --seeds 1-8 --days 40 … (same overrides)` | `evidence/phase-05/lean-island-societies-40d.txt` | planners 18.6, reflex 18.8 of 50 alive (mean); medians 6 and 11 | Same caveat. Not a finding. |
| On the reference island, two years | `pnpm compare -- --seeds 1-8 --days 80 --checkpoints 30,40,60,80` | `evidence/phase-05/first-light-80d.txt`, `.json` | planners 50/50 on all 8 seeds; reflex mean 46.4, min 36; well-being 56.6% vs 63.8% | Same caveat. |
| Planner cost | `pnpm bench -- --days 5 --policy planner --json evidence/phase-05/bench-planner.json` | that file | 50 agents: 2,860 ticks/s (p95 0.92 ms/tick); 500 agents on 128²: 222 ticks/s (p95 9.9 ms) | Browser worker throughput; other hardware. |
| Snapshots written before this phase still load | `cognition.test.ts` › snapshot migration 1 → 2 | `tests.txt` | pass | — |

**Stated plainly.** The planner is a hand-written prior about sensible individual behaviour. It never proposes
a group, role, rule, vote or pact; nothing institutional exists in any baseline run (asserted). Whatever
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
| The only test that can make a paid request is skipped, by name, and reports "NOT authorized" | `live.integration.test.ts` | same (lines marked ↓ and "NOT authorized") | skipped by design | Everything about live behaviour. |
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

## Research inputs

| Input | File | Status |
|---|---|---|
| Verified bibliography | `docs/LITERATURE.md` | 57 entries, each verified by a research sub-agent against Crossref / arXiv / publisher records on 2026-11-25; corrections and omissions are noted in the file |
| Vercel platform facts | `docs/research/vercel-platform.md` | compiled from official documentation on 2026-11-25; unconfirmed items listed at the end of the file; nothing tested live |
| Anthropic API facts and prices | `docs/research/anthropic-api.md` | compiled from official documentation on 2026-11-25; **no API calls made**; discrepancies with cached references listed in the file |
