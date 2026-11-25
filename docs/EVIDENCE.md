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

## Research inputs

| Input | File | Status |
|---|---|---|
| Verified bibliography | `docs/LITERATURE.md` | 57 entries, each verified by a research sub-agent against Crossref / arXiv / publisher records on 2026-11-25; corrections and omissions are noted in the file |
| Vercel platform facts | `docs/research/vercel-platform.md` | compiled from official documentation on 2026-11-25; unconfirmed items listed at the end of the file; nothing tested live |
| Anthropic API facts and prices | `docs/research/anthropic-api.md` | compiled from official documentation on 2026-11-25; **no API calls made**; discrepancies with cached references listed in the file |
