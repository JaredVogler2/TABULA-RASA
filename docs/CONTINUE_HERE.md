# Continue here

Read `CLAUDE.md`, `prompts/00-MASTER.md`, `prompts/README.md`, then this file, then `docs/DECISIONS.md`.

## Current state (2026-11-25)

- **Branch:** `claude/friendly-gauss-kejb2m` · PR: https://github.com/JaredVogler2/TABULA-RASA/pull/1
- **Phase:** 04 PASS. **Next: phase 05, agent cognition** (bounded-rational planner baseline).
- **Last verified commit:** see `git log -1`.
- **Spend:** $0. No API key present. Live mode must stay disabled until the owner authorizes a capped run.

## Verify the tree

```bash
pnpm install --frozen-lockfile
pnpm check        # lint + typecheck + unit + affordance-doc freshness + build
pnpm e2e          # Playwright, production build, desktop + phone emulation (about 4 minutes on a CPU renderer)
pnpm sim -- --scenario first_light --seed 1 --days 40 --policy reflex --replay
pnpm bench
# art stills (needs `pnpm build && pnpm exec next start -p 3210` in another shell)
node scripts/shots.mjs /tmp/shots vista closeup dusk night phone
```

Expected at this commit: 98 unit/property tests pass; E2E 7 passed, 1 skipped (keyboard test is desktop-only);
`replay IDENTICAL`.

## Execution order (D-001)

01 ✔ → 02 (partial) → 03 ✔ → 04 ✔ → **05** → 09 → 10 → 06 → 07 → 08 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20

## Where things live

- `src/engine/**` — pure deterministic simulation (no DOM, no time, no `Math.random`; lint-enforced).
- `src/worker/sim.worker.ts` — owns the world and its untouched twin; posts view frames; `protocol.ts` is the
  only contract with the page.
- `src/render/**` — imperative three.js (`WorldRenderer`); never imported by the engine, never imports React.
- `src/ui/game/**` — React HUD and panels; `controller.ts` is the single place that talks to worker + renderer.
- `src/store/game.ts` — zustand view state; `src/persist/saves.ts` — IndexedDB saves.
- `src/app/studio` + `scripts/shots.mjs` — capture harness for art QA (D-013).

## Next actions

1. Phase 05: implement `planDecide` in `src/engine/mind/planner.ts` (currently returns null, so every agent is
   reflex-driven and the setup screen offers only "reflex"). Stockpiling, tools, fire/shelter/store, planting,
   sharing, requests/offers/promises, trust, commitments, deliberation cadence. Re-add the planner option to
   `src/ui/game/Title.tsx` when it exists. Then tune ecology on development seeds so First Light is survivable
   for planner agents.
2. Phase 09: institution grammar behind `src/engine/institutions/hooks.ts` (D-006, D-010, D-011).
3. Phase 10: windowed reciprocity and the other protocol measures; `docs/ODD.md`.
4. Engine notes for later phases:
   - External (model) decisions will enter through `adopt()` in `src/engine/mind/decide.ts` after
     `checkIntent()`; reflex decisions for external minds are already labelled `fallback`.
   - Snapshots at 500 agents are ~25 MiB (dense belief arrays): sparse encoding is a phase 15 item.
5. Art items carried to phase 11 are listed in `docs/ART_BIBLE.md` § Known weaknesses.

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
