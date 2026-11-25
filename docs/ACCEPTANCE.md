# Release acceptance matrix (S04)

Status vocabulary: **PASS** (gate proven by an executed check with evidence) · **PARTIAL** · **BLOCKED** ·
**NOT RUN**. "Implemented" is never recorded as "tested", and "tested" is never recorded as "deployed".
Evidence paths are relative to the repository root; raw outputs live under `evidence/`.

Last updated: 2026-11-25 (phase 02).

| # | Criterion | Command(s) | Expected | Actual | Evidence | Status | Commit | Caveats |
|---|---|---|---|---|---|---|---|---|
| 1 | Fresh install, lint, typecheck, unit, build, E2E | `pnpm install --frozen-lockfile && pnpm check && pnpm e2e` | all exit 0 | lint, typecheck, 21 unit tests, build and 4 E2E tests pass on the skeleton | `evidence/phase-02/checks.txt` | PARTIAL | phase 02 | Skeleton only; re-run at every phase. CI run on GitHub not yet observed. |
| 2 | Headless seeded 50-agent world; resource/authority invariants; hash replay; invalid-intent tests | `pnpm test`, `pnpm sim` | — | — | — | NOT RUN | — | Phase 03. |
| 3 | Offline baseline playable with zero credentials; live state rendered; all core interactions real | `pnpm e2e` | — | — | — | NOT RUN | — | Phase 04. |
| 4 | Private observations, memory provenance, independent agents, no hidden scripted institution progression | `pnpm test` | — | — | — | NOT RUN | — | Phases 05, 09. |
| 5 | Institution DSL validated and executable; fuzz rejects escape, overflow, infinite evaluation, forged consent | `pnpm test` | — | — | — | NOT RUN | — | Phase 09. |
| 6 | Branching with identical history and no-cost replay; corrupt import safely rejected | `pnpm test`, `pnpm e2e` | — | — | — | NOT RUN | — | Phase 13. |
| 7 | Authenticated live endpoint only; keys excluded from browser/logs; all request paths share the ledger; race/timeout/retry tests; public cannot spend | `pnpm test`, `pnpm scan:bundle`, `pnpm scan:secrets` | — | — | — | NOT RUN | — | Phase 07. |
| 8 | Mock/replay integration verified; live smoke separately approved or BLOCKED | `pnpm test`, `pnpm e2e` | — | — | — | NOT RUN | — | Phases 06, 17. No spend is authorized. |
| 9 | Experiment lab: paired seeds, operational definitions, honest uncertainty, reproducible exports | `pnpm study` | — | — | — | NOT RUN | — | Phase 14. Protocol pre-registered in `docs/EXPERIMENT_PROTOCOL.md`. |
| 10 | Visual screenshot rubric and actual mobile/desktop browser flows; hardware/human tests distinguished | `pnpm e2e` + rubric | — | — | — | NOT RUN | — | Phases 04, 11, 12. |
| 11 | Performance measured with device, scenario, FPS and memory; graceful fallback | `pnpm bench` | — | — | — | NOT RUN | — | Phase 15. |
| 12 | Vercel preview/release verified if authorized; deployment status and rollback honest; extra costs disclosed | deployment checks | — | — | — | NOT RUN | — | Phase 18. |
| 13 | Independent adversarial review, evidence-backed scorecard, known issues, license manifest, owner setup guide | docs + tests | — | — | — | NOT RUN | — | Phases 16, 19, 20. |

## Phase gates

| Phase | Gate (abridged) | Status | Notes |
|---|---|---|---|
| 01 | Charter, experiment protocol, affordance register, scenarios, acceptance matrix, UI flow, unresolved decisions, slice priority | **PASS** | `docs/CHARTER.md`, `EXPERIMENT_PROTOCOL.md`, `AFFORDANCES.md` (generated), this file. Literature list is being verified separately (`LITERATURE.md`); the protocol cites no specific work until it is. |
| 02 | Runnable skeleton, CI, lockfile, typed interfaces, empty world canvas, seeded worker spike, data design, ADRs, commands; engine feasibility benchmark | **PARTIAL** | Done: skeleton, lockfile, lint-enforced boundaries, seeded worker spike with cross-runtime digest check, ADRs D-001…D-011, commands, CI workflow file. Open: CI not yet observed green on GitHub; domain interfaces and feasibility benchmark land with phase 03; world canvas with phase 04; SQL migrations with phase 07. |
| 03–20 | see `prompts/` | NOT RUN | |
