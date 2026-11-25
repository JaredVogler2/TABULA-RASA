# Continue here

Read `CLAUDE.md`, `prompts/00-MASTER.md`, `prompts/README.md`, then this file, then `docs/DECISIONS.md`.

## Current state (2026-11-25)

- **Branch:** `claude/friendly-gauss-kejb2m` · PR: https://github.com/JaredVogler2/TABULA-RASA/pull/1
- **Phase:** 03 PASS. **Next: phase 04, playable offline slice** (worker host, renderer, HUD, saves, E2E).
- **Last verified commit:** see `git log -1`.
- **Spend:** $0. No API key present. Live mode must stay disabled until the owner authorizes a capped run.

## Verify the tree

```bash
pnpm install --frozen-lockfile
pnpm check        # lint + typecheck + unit + affordance-doc freshness + build
pnpm e2e          # Playwright, production build, desktop + phone emulation
pnpm sim -- --scenario first_light --seed 1 --days 40 --policy reflex --replay
pnpm bench
```

Expected at this commit: 98 unit/property tests and 4 E2E tests pass; `replay IDENTICAL`.

## Execution order (D-001)

01 ✔ → 02 (partial) → **03** → 04 → 05 → 09 → 10 → 06 → 07 → 08 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20

## Next actions

1. Phase 04: `src/worker/sim.worker.ts` (engine host, view frames, snapshots), `src/render/*` (terrain, water,
   vegetation, citizens, structures, sky, post), `src/ui/*` (title, HUD, timebar, inspector, chronicle,
   interventions, save/load, debrief), `src/persist/*` (IndexedDB), Playwright walkthroughs with screenshots.
2. Phase 05: bounded-rational planner (`src/engine/mind/planner.ts` is a stub that defers to reflex), trust,
   commitments, speech use; then tune ecology so the planner baseline is viable in First Light.
3. Engine notes for later phases:
   - `src/engine/institutions/hooks.ts` is the only seam between physical actions and institutions (phase 09).
   - External (model) decisions will enter through `adopt()` in `src/engine/mind/decide.ts` after
     `checkIntent()`; reflex decisions for external minds are already labelled `fallback`.
   - Reciprocity in `metrics/accumulate.ts` is cumulative; the protocol's 5-day window needs the event log
     (phase 10).
   - Snapshots at 500 agents are ~25 MiB (dense belief arrays): sparse encoding is a phase 15 item.

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
