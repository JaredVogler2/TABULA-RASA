# Continue here

Read `CLAUDE.md`, `prompts/00-MASTER.md`, `prompts/README.md`, then this file, then `docs/DECISIONS.md`.

## Current state (2026-11-25)

- **Branch:** `claude/friendly-gauss-kejb2m` · PR: https://github.com/JaredVogler2/TABULA-RASA/pull/1
- **Phase:** 05 PASS. **Next: phase 09, institution grammar** (D-001 order), then 10, then 06–08.
- **Last verified commit:** see `git log -1`.
- **Spend:** $0. No API key present. Live mode must stay disabled until the owner authorizes a capped run.

## Verify the tree

```bash
pnpm install --frozen-lockfile
pnpm check        # lint + typecheck + unit + affordance-doc freshness + build
pnpm e2e          # Playwright, production build, desktop + phone emulation (about 4 minutes on a CPU renderer)
pnpm sim -- --scenario first_light --seed 1 --days 40 --policy planner --replay
pnpm bench
pnpm compare -- --seeds 1-4 --days 40                  # paired baselines, development seeds
pnpm exec tsx scripts/mixed.ts --seeds 1-4 --days 40   # planners and reflex agents on one island
# art stills (needs `pnpm build && pnpm exec next start -p 3210` in another shell)
node scripts/shots.mjs /tmp/shots vista closeup dusk night phone
```

Expected at this commit: 124 unit/property tests pass; E2E 7 passed, 1 skipped (keyboard test is desktop-only);
`replay IDENTICAL`.

## Execution order (D-001)

01 ✔ → 02 (partial) → 03 ✔ → 04 ✔ → 05 ✔ → **09** → 10 → 06 → 07 → 08 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20

## Where things live

- `src/engine/**` — pure deterministic simulation (no DOM, no time, no `Math.random`; lint-enforced).
- `src/worker/sim.worker.ts` — owns the world and its untouched twin; posts view frames; `protocol.ts` is the
  only contract with the page.
- `src/render/**` — imperative three.js (`WorldRenderer`); never imported by the engine, never imports React.
- `src/ui/game/**` — React HUD and panels; `controller.ts` is the single place that talks to worker + renderer.
- `src/store/game.ts` — zustand view state; `src/persist/saves.ts` — IndexedDB saves.
- `src/app/studio` + `scripts/shots.mjs` — capture harness for art QA (D-013).

## Next actions

1. Phase 09: institution grammar behind `src/engine/institutions/hooks.ts` (D-006, D-010, D-011): charters,
   membership, roles, decision rules, lockable stores, bonds, deontic rules, motions, sanctions, exit, pacts with
   escrow; validator, interpreter with fuel, lifecycle events, fuzz tests; `grammar_search` as a labelled
   treatment that plugs into `planner.ts` *outside* the baseline repertoire.
2. Phase 10: windowed reciprocity and the other protocol measures; `docs/ODD.md`.
3. Phase 06–08: provider adapters behind `src/engine/mind/external.ts` (`observe`, `submitDecision`,
   `dueForDecision`, `tapeFromEvents`, `replayTape` are the whole contract); `mock.ts` is the reference mind.
4. Engine notes:
   - Baselines and what they show: `docs/COGNITION.md`. Ecology calibration: D-014. Do not retune on holdout
     seeds (9000–9999); every tuning run so far used seeds 1–8.
   - Snapshots at 500 agents are ~36 MiB (dense belief arrays): sparse encoding is a phase 15 item.
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
