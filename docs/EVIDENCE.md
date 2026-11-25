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

## Research inputs

| Input | File | Status |
|---|---|---|
| Verified bibliography | `docs/LITERATURE.md` | 57 entries, each verified by a research sub-agent against Crossref / arXiv / publisher records on 2026-11-25; corrections and omissions are noted in the file |
| Vercel platform facts | `docs/research/vercel-platform.md` | compiled from official documentation on 2026-11-25; unconfirmed items listed at the end of the file; nothing tested live |
| Anthropic API facts and prices | `docs/research/anthropic-api.md` | compiled from official documentation on 2026-11-25; **no API calls made**; discrepancies with cached references listed in the file |
