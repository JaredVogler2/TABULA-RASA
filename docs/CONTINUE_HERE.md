# Continue here

Read `CLAUDE.md`, `prompts/00-MASTER.md`, `prompts/README.md`, then this file, then `docs/DECISIONS.md`.

## Current state (2026-11-25)

- **Branch:** `claude/friendly-gauss-kejb2m`
- **Phase:** 02 complete enough to build on (PARTIAL — see `ACCEPTANCE.md`); **next: phase 03, world engine.**
- **Last verified commit:** see `git log -1` (phase 02 skeleton).
- **Spend:** $0. No API key present. Live mode must stay disabled until the owner authorizes a capped run.

## Verify the tree

```bash
pnpm install --frozen-lockfile
pnpm check        # lint + typecheck + unit + affordance-doc freshness + build
pnpm e2e          # Playwright, production build, desktop + phone emulation
```

Expected at this commit: 21 unit tests and 4 E2E tests pass.

## Execution order (D-001)

01 ✔ → 02 (partial) → **03** → 04 → 05 → 09 → 10 → 06 → 07 → 08 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20

## Next actions

1. Phase 03: `src/engine/model` (state types, config, items, recipes), `src/engine/world` (terrain, hydrology,
   biomes, nodes, seasons, weather), `src/engine/sim` (tick pipeline, intents, validation, arbitration,
   application, events), reflex baseline policy, snapshot + hash + migrations, `scripts/sim.ts`,
   `scripts/bench.ts`, property tests. Gate: 50 agents, ≥ 1000 ticks, replay hash equality, conservation,
   invalid-intent rejection, benchmarks at 100/500 agents.
2. Fold the research files (`docs/LITERATURE.md`, `docs/research/*.md`) into the docs once the background
   research agents report; re-check D-009 against the platform facts.
3. Confirm the GitHub Actions run for the pushed commit.

## Blockers

None for offline work. Live API work (phase 17) is blocked on explicit owner authorization of a dollar ceiling.

## Conventions worth remembering

- Never use `Math.random`, `Date`, timers or transcendental `Math` functions under `src/engine` (lint error).
- Development seeds are 1–999; holdout seeds 9000–9999 are reserved for confirmatory studies.
- Bump `ENGINE_VERSION` when behaviour changes, `SCHEMA_VERSION` (with a migration) when saved shapes change,
  `AFFORDANCE_VERSION` (and the registry) when what agents can perceive or do changes.
- `docs/AFFORDANCES.md` is generated: `pnpm gen:affordances`.
- Next.js conventions: read `node_modules/next/dist/docs/` — this is Next 16 (Turbopack, `proxy.ts`, async
  request APIs, Cache Components).
