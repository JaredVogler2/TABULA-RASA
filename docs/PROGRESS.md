# Progress

Status vocabulary: PASS · PARTIAL · BLOCKED · NOT RUN. A phase is PASS only when its gate is proven by executed
checks recorded in `EVIDENCE.md`. Execution order follows D-001.

| Phase | Title | Status | Date | Summary |
|---|---|---|---|---|
| 01 | Product and science | **PASS** | 2026-11-25 | Charter, pre-registered protocol (H1–H6), affordance registry (code + generated doc), five scenarios, acceptance matrix, UI flow. Bibliography verification in progress. |
| 02 | Architecture | **PARTIAL** | 2026-11-25 | Next.js 16 + TS skeleton; lint-enforced engine purity and server isolation; deterministic core (keyed RNG, SHA-256, canonical JSON); Turbopack-bundled worker verified; Playwright desktop + phone emulation; CI observed green on GitHub; ADRs D-001–D-011; typed domain model and feasibility benchmark delivered with phase 03. World canvas delivered in phase 04. Still open: SQL migrations (phase 07). |
| 03 | World engine | **PASS** | 2026-11-25 | Seeded island (terrain, drainage, biomes, nodes), seasons/weather, needs/illness/death, 20 physical actions with structural + semantic validation and fair arbitration, knowledge-limited pathfinding, local perception and beliefs, reflex baseline, events with causal parents, declared source/sink ledger, canonical snapshots, forks, migrations. 98 tests; five scenarios replay bit-identically; benchmarks at 50/100/250/500 agents. |
| 04 | Playable slice | **PASS** | 2026-11-25 | Title with a live attract-mode island → scenario/seed → 3D diorama → play/pause/step/six speeds → click or tap a citizen (needs, plan, memory, beliefs vs truth) → Chronicle with recorded causes → eight environmental interventions that fork history against an untouched twin → Compare (charts, table, caveat) → IndexedDB save/load/autosave → reload and continue. Engine in a Web Worker; renderer interpolates between ticks. Playwright walkthroughs with real clicks (1366×768) and taps (390×844 emulation) pass with no console errors, failed or cross-origin requests. Gaps: reflex baseline only (planner is phase 05); frame rates measured on a software renderer only; no physical device. |
| 05 | Agent cognition | NOT RUN | | |
| 09 | Institution DSL | NOT RUN | | |
| 10 | Economy and society | NOT RUN | | |
| 06 | Claude API | NOT RUN | | |
| 07 | Budget and security | NOT RUN | | |
| 08 | Orchestration | NOT RUN | | |
| 11 | Art direction | NOT RUN | | |
| 12 | Observer UX | NOT RUN | | |
| 13 | History and causality | NOT RUN | | |
| 14 | Experiment lab | NOT RUN | | |
| 15 | Scale and performance | NOT RUN | | |
| 16 | Adversarial QA | NOT RUN | | |
| 17 | Live pilot | NOT RUN | | No spend authorized. |
| 18 | Vercel release | NOT RUN | | |
| 19 | Fable benchmark | NOT RUN | | |
| 20 | Redesign and handoff | NOT RUN | | |

## Spend

Anthropic API: **$0.00** (no calls made, no key configured). Billable infrastructure: **none**.

## Human interventions

None so far beyond the initial instruction.
